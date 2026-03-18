"""
Auth router — login and user/secret management endpoints.

Mounted at /auth in main.py.  Routes:

  POST   /auth/token           — obtain JWT (OAuth2 form, legacy / tooling compat)
  POST   /auth/login           — obtain JWT (JSON body, preferred)
  POST   /auth/login/local     — local-only login (disabled when LDAP_SERVER is set)
  GET    /auth/me              — return full profile for the authenticated caller
  PATCH  /auth/me              — update own email / password (local accounts only)
  GET    /auth/users           — list all users in the caller's org (org_admin only)
  POST   /auth/users           — create a local user with bcrypt password (org_admin only)
  PATCH  /auth/users/{id}      — update role and/or password (org_admin only)
  DELETE /auth/users/{id}      — delete a user (org_admin only, cannot self-delete)
  POST   /auth/secrets         — create a secret (org_admin only)
  GET    /auth/secrets         — list secrets for the caller's org (org_admin only)
  DELETE /auth/secrets/{id}    — delete a secret by ID (org_admin only)
  POST   /auth/api-keys        — create an API key (org_admin only)
  GET    /auth/api-keys        — list API keys (org_admin only)
  DELETE /auth/api-keys/{id}   — revoke an API key (org_admin only)

Login strategy:
  - When LDAP_SERVER is configured: /auth/login and /auth/token dispatch to
    LDAPAuthService.authenticate().
  - When LDAP_SERVER is empty (local mode): dispatch to LocalAuthService.authenticate().
  - /auth/login/local always uses LocalAuthService but is blocked (403) when
    LDAP_SERVER is configured, preventing LDAP bypass.

Secret values are never returned by any endpoint.  For db-type secrets the
plaintext value is encrypted with Fernet before storage.
"""

from datetime import datetime, timedelta, timezone

import bcrypt as _bcrypt
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from jose import jwt
from pydantic import BaseModel, EmailStr
from slowapi.util import get_remote_address
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.rate_limit import limiter

from api.config import get_settings
from api.core.auth import (
    LDAPAuthService,
    LocalAuthService,
    TokenData,
    UserInfo,
    _upsert_user,
    generate_api_key,
    get_current_user,
    is_org_admin,
    require_org_admin,
)
from api.models.api_key import ApiKey
from api.schemas.api_key import ApiKeyCreate, ApiKeyCreatedOut, ApiKeyOut
from api.core.secrets import encrypt_secret
from api.database import get_db
from api.models.secret import Secret, SecretType
from api.models.user import User
from api.schemas.secret import SecretCreate, SecretOut

router = APIRouter()

_TOKEN_EXPIRE_HOURS = 8

# Valid org-level roles
_ORG_ROLES = frozenset({"org_owner", "org_admin", "member"})


# ---------------------------------------------------------------------------
# Request / response schemas (local to auth router)
# ---------------------------------------------------------------------------

class LoginRequest(BaseModel):
    username: str
    password: str


class UserCreate(BaseModel):
    username: str
    email: EmailStr
    password: str
    role: str = "member"


class UserOut(BaseModel):
    id: str
    username: str
    email: str
    role: str
    is_platform_admin: bool
    is_ldap: bool
    organization_id: str
    last_login: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class UserUpdate(BaseModel):
    role: str | None = None
    password: str | None = None


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int = _TOKEN_EXPIRE_HOURS * 3600


class MeOut(BaseModel):
    username: str
    org_id: str
    org_role: str
    is_platform_admin: bool
    email: str | None = None
    is_ldap: bool = False
    last_login: datetime | None = None
    created_at: datetime | None = None


class MeUpdate(BaseModel):
    email: EmailStr | None = None
    current_password: str | None = None
    new_password: str | None = None


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _build_token(user: User) -> str:
    """Build a signed JWT for the given user."""
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user.username,
        "org_id": user.organization_id,
        "org_role": user.role,
        "is_platform_admin": user.is_platform_admin,
        "iat": now,
        "exp": now + timedelta(hours=_TOKEN_EXPIRE_HOURS),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm="HS256")


async def _dispatch_login(username: str, password: str, db: AsyncSession) -> TokenOut:
    """
    Authenticate using the active backend (LDAP or local) and return a JWT.

    LDAP mode: delegates to LDAPAuthService which also upserts the user.
    Local mode: delegates to LocalAuthService (user must exist with a password_hash).
    """
    settings = get_settings()

    user_info: UserInfo | None

    if settings.LDAP_SERVER:
        svc = LDAPAuthService(
            server_url=settings.LDAP_SERVER,
            base_dn=settings.LDAP_BASE_DN,
            admin_group=settings.LDAP_ADMIN_GROUP,
        )
        user_info = await svc.authenticate(username, password, db)
        if user_info is None:
            # LDAP auth failed (server unreachable, wrong password, user not in LDAP, etc.)
            # Fall back to local auth so local accounts remain accessible when LDAP is down.
            # LocalAuthService only matches users with is_ldap=False + a password_hash,
            # so pure LDAP accounts cannot bypass LDAP via this path.
            user_info = await LocalAuthService.authenticate(username, password, db)
    else:
        user_info = await LocalAuthService.authenticate(username, password, db)

    if user_info is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Fetch user row (guaranteed to exist after LDAP upsert or local lookup)
    result = await db.execute(select(User).where(User.username == username))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)

    # Update last_login
    user.last_login = datetime.now(timezone.utc)
    await db.commit()

    return TokenOut(access_token=_build_token(user))


# ---------------------------------------------------------------------------
# Login endpoints
# ---------------------------------------------------------------------------

@router.post(
    "/token",
    response_model=TokenOut,
    summary="Obtain a JWT access token (OAuth2 form)",
    description=(
        "OAuth2-compatible form-based login. "
        "Accepts `Content-Type: application/x-www-form-urlencoded` with "
        "`username` and `password` fields. "
        "Kept for backward compatibility and OpenAPI 'Authorize' button support. "
        "Prefer `POST /auth/login` for new clients.  "
        "Rate-limited via global middleware (100 req/min per user)."
    ),
)
async def login_form(
    form: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
) -> TokenOut:
    # Note: @limiter.limit() is not applied here because OAuth2PasswordRequestForm
    # combined with from __future__ import annotations breaks slowapi's introspection.
    # This endpoint is protected by the SlowAPIMiddleware default (100/min per user).
    return await _dispatch_login(form.username, form.password, db)


@router.post(
    "/login",
    response_model=TokenOut,
    summary="Obtain a JWT access token (JSON body)",
    description=(
        "Preferred login endpoint. Accepts a JSON body `{username, password}`. "
        "Dispatches to LDAP when `LDAP_SERVER` is configured, otherwise uses "
        "local bcrypt authentication."
    ),
)
@limiter.limit("5/minute", key_func=get_remote_address)
async def login_json(
    request: Request,
    body: LoginRequest,
    db: AsyncSession = Depends(get_db),
) -> TokenOut:
    return await _dispatch_login(body.username, body.password, db)


@router.post(
    "/login/local",
    response_model=TokenOut,
    summary="Local-only login",
    description=(
        "Authenticate with a local bcrypt password. "
        "Returns 403 when `LDAP_SERVER` is configured to prevent LDAP bypass. "
        "Use this endpoint in environments without LDAP."
    ),
)
@limiter.limit("5/minute", key_func=get_remote_address)
async def login_local(
    request: Request,
    body: LoginRequest,
    db: AsyncSession = Depends(get_db),
) -> TokenOut:
    settings = get_settings()
    if settings.LDAP_SERVER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Local login is disabled when LDAP is configured. Use POST /auth/login.",
        )
    user_info = await LocalAuthService.authenticate(body.username, body.password, db)
    if user_info is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    result = await db.execute(select(User).where(User.username == body.username))
    user = result.scalar_one()
    user.last_login = datetime.now(timezone.utc)
    await db.commit()
    return TokenOut(access_token=_build_token(user))


# ---------------------------------------------------------------------------
# Current user info
# ---------------------------------------------------------------------------

@router.get(
    "/me",
    response_model=MeOut,
    summary="Get current user profile",
    description="Return full profile info for the authenticated caller.",
)
async def get_me(
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(get_current_user),
) -> MeOut:
    result = await db.execute(select(User).where(User.username == token.sub))
    user = result.scalar_one_or_none()
    if user is None:
        return MeOut(
            username=token.sub,
            org_id=token.org_id,
            org_role=token.org_role,
            is_platform_admin=token.is_platform_admin,
        )
    return MeOut(
        username=user.username,
        org_id=user.organization_id,
        org_role=user.role,
        is_platform_admin=user.is_platform_admin,
        email=user.email,
        is_ldap=user.is_ldap,
        last_login=user.last_login,
        created_at=user.created_at,
    )


@router.patch(
    "/me",
    response_model=MeOut,
    summary="Update own profile",
    description=(
        "Update the caller's own email and/or password. "
        "Password changes require `current_password` for verification and are "
        "rejected for LDAP accounts."
    ),
)
async def update_me(
    body: MeUpdate,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(get_current_user),
) -> MeOut:
    result = await db.execute(select(User).where(User.username == token.sub))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if body.email is not None:
        user.email = body.email

    if body.new_password is not None:
        if user.is_ldap:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Password cannot be changed for LDAP accounts",
            )
        if not body.current_password:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="current_password is required to set a new password",
            )
        if not user.password_hash or not _bcrypt.checkpw(
            body.current_password.encode(), user.password_hash.encode()
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Current password is incorrect",
            )
        user.password_hash = _bcrypt.hashpw(body.new_password.encode(), _bcrypt.gensalt()).decode()

    await db.flush()
    await db.refresh(user)
    await db.commit()
    return MeOut(
        username=user.username,
        org_id=user.organization_id,
        org_role=user.role,
        is_platform_admin=user.is_platform_admin,
        email=user.email,
        is_ldap=user.is_ldap,
        last_login=user.last_login,
        created_at=user.created_at,
    )


# ---------------------------------------------------------------------------
# User management (local users only)
# ---------------------------------------------------------------------------

@router.post(
    "/users",
    response_model=UserOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a local user",
    description=(
        "Create a new local user with a bcrypt-hashed password. "
        "The user is assigned to the caller's organization. Org-admin only. "
        "Only platform_admin can assign the org_owner role."
    ),
)
async def create_user(
    body: UserCreate,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_org_admin),
) -> UserOut:
    if body.role not in _ORG_ROLES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid role. Must be one of: {sorted(_ORG_ROLES)}",
        )
    # Guard: only platform_admin can set org_owner role
    if body.role == "org_owner" and not token.is_platform_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only a platform admin can assign the org_owner role",
        )
    hashed = _bcrypt.hashpw(body.password.encode(), _bcrypt.gensalt()).decode()
    user = User(
        organization_id=token.org_id,
        username=body.username,
        email=body.email,
        role=body.role,
        is_platform_admin=False,
        is_ldap=False,
        password_hash=hashed,
    )
    db.add(user)
    try:
        await db.flush()
        await db.commit()
        await db.refresh(user)
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A user named {body.username!r} already exists",
        )
    return UserOut.model_validate(user)


@router.get(
    "/users",
    response_model=list[UserOut],
    summary="List users",
    description="Return all users in the caller's organization. Any authenticated user (needed for project-member management).",
)
async def list_users(
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(get_current_user),
) -> list[UserOut]:
    result = await db.execute(
        select(User)
        .where(User.organization_id == token.org_id)
        .order_by(User.username)
    )
    return [UserOut.model_validate(u) for u in result.scalars().all()]


@router.patch(
    "/users/{user_id}",
    response_model=UserOut,
    summary="Update a user",
    description="Update role and/or password for a user. Org-admin only.",
)
async def update_user(
    user_id: str,
    body: UserUpdate,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_org_admin),
) -> UserOut:
    result = await db.execute(
        select(User).where(User.id == user_id, User.organization_id == token.org_id)
    )
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if body.role is not None:
        if body.role not in _ORG_ROLES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Invalid role. Must be one of: {sorted(_ORG_ROLES)}",
            )
        # Guard: only platform_admin can set org_owner role
        if body.role == "org_owner" and not token.is_platform_admin:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only a platform admin can assign the org_owner role",
            )
        user.role = body.role
    if body.password is not None:
        user.password_hash = _bcrypt.hashpw(body.password.encode(), _bcrypt.gensalt()).decode()
    await db.commit()
    await db.refresh(user)
    return UserOut.model_validate(user)


@router.delete(
    "/users/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
    summary="Delete a user",
    description="Hard-delete a user. Cannot delete yourself. Org-admin only.",
)
async def delete_user(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_org_admin),
) -> None:
    result = await db.execute(
        select(User).where(User.id == user_id, User.organization_id == token.org_id)
    )
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.username == token.sub:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You cannot delete your own account",
        )
    await db.delete(user)
    await db.commit()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _get_secret_or_404(db: AsyncSession, secret_id: str, org_id: str) -> Secret:
    result = await db.execute(
        select(Secret).where(
            Secret.id == secret_id,
            Secret.organization_id == org_id,
        )
    )
    secret = result.scalar_one_or_none()
    if secret is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Secret not found")
    return secret


# ---------------------------------------------------------------------------
# Secret management
# ---------------------------------------------------------------------------

@router.post(
    "/secrets",
    response_model=SecretOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a secret",
    description=(
        "Create a new named secret for the caller's organization. "
        "For `db` type secrets the plaintext `value` is encrypted (Fernet/AES) "
        "before storage. The value is **never** returned by any API endpoint. "
        "Org-admin only."
    ),
)
async def create_secret(
    payload: SecretCreate,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_org_admin),
) -> SecretOut:
    if payload.secret_type == SecretType.vault and not payload.vault_path:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="vault_path is required for vault-type secrets",
        )
    if payload.secret_type in (SecretType.env, SecretType.db) and not payload.value:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"value is required for {payload.secret_type}-type secrets",
        )

    stored_value: str | None = payload.value
    if payload.secret_type == SecretType.db and payload.value:
        stored_value = encrypt_secret(payload.value)

    secret = Secret(
        organization_id=token.org_id,
        name=payload.name,
        secret_type=payload.secret_type,
        value=stored_value,
        vault_path=payload.vault_path,
        description=payload.description,
    )
    db.add(secret)
    try:
        await db.flush()
        await db.commit()
        await db.refresh(secret)
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A secret named {payload.name!r} already exists in this organization",
        )
    return SecretOut.model_validate(secret)


@router.get(
    "/secrets",
    response_model=list[SecretOut],
    summary="List secrets",
    description=(
        "Return metadata for all secrets in the caller's organization. "
        "Secret values are never included in the response. Org-admin only."
    ),
)
async def list_secrets(
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_org_admin),
) -> list[SecretOut]:
    result = await db.execute(
        select(Secret)
        .where(Secret.organization_id == token.org_id)
        .order_by(Secret.name)
    )
    secrets = result.scalars().all()
    return [SecretOut.model_validate(s) for s in secrets]


@router.delete(
    "/secrets/{secret_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
    summary="Delete a secret",
    description="Permanently delete a secret by ID. Org-admin only.",
)
async def delete_secret(
    secret_id: str,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_org_admin),
) -> None:
    secret = await _get_secret_or_404(db, secret_id, token.org_id)
    await db.delete(secret)
    await db.commit()


# ---------------------------------------------------------------------------
# API key management
# ---------------------------------------------------------------------------

@router.post(
    "/api-keys",
    response_model=ApiKeyCreatedOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create an API key",
    description=(
        "Generate a new API key for the caller's organization. "
        "The raw key is returned **once** — it cannot be retrieved again. "
        "Store it securely. Org-admin only. "
        "Cannot create a key with a higher role than your own."
    ),
)
async def create_api_key(
    body: ApiKeyCreate,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_org_admin),
) -> ApiKeyCreatedOut:
    key_role = getattr(body, "role", "member")
    if key_role not in _ORG_ROLES:
        key_role = "member"

    # Cannot escalate privileges beyond caller's own role
    _role_rank = {"member": 0, "org_admin": 1, "org_owner": 2}
    caller_rank = _role_rank.get(token.org_role, 0)
    key_rank = _role_rank.get(key_role, 0)
    if key_rank > caller_rank and not token.is_platform_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot create an API key with a higher role than your own",
        )

    raw_key, key_prefix, key_hash = generate_api_key()
    api_key = ApiKey(
        organization_id=token.org_id,
        created_by=None,
        name=body.name,
        key_prefix=key_prefix,
        key_hash=key_hash,
        role=key_role,
        expires_at=body.expires_at,
    )
    # Resolve the user ID for created_by
    from sqlalchemy import select as _select
    from api.models.user import User as _User
    user_result = await db.execute(_select(_User).where(_User.username == token.sub))
    user = user_result.scalar_one_or_none()
    if user:
        api_key.created_by = user.id

    db.add(api_key)
    await db.flush()
    await db.refresh(api_key)
    await db.commit()

    return ApiKeyCreatedOut(
        id=api_key.id,
        name=api_key.name,
        key_prefix=api_key.key_prefix,
        role=api_key.role,
        created_by=api_key.created_by,
        last_used_at=api_key.last_used_at,
        expires_at=api_key.expires_at,
        created_at=api_key.created_at,
        raw_key=raw_key,
    )


@router.get(
    "/api-keys",
    response_model=list[ApiKeyOut],
    summary="List API keys",
    description="Return all API keys for the caller's organization. Org-admin only.",
)
async def list_api_keys(
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_org_admin),
) -> list[ApiKeyOut]:
    from sqlalchemy import select as _select
    result = await db.execute(
        _select(ApiKey)
        .where(ApiKey.organization_id == token.org_id)
        .order_by(ApiKey.created_at.desc())
    )
    return [ApiKeyOut.model_validate(k) for k in result.scalars().all()]


@router.delete(
    "/api-keys/{key_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
    summary="Revoke an API key",
    description="Permanently delete (revoke) an API key by ID. Org-admin only.",
)
async def delete_api_key(
    key_id: int,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_org_admin),
) -> None:
    from sqlalchemy import select as _select
    result = await db.execute(
        _select(ApiKey).where(
            ApiKey.id == key_id,
            ApiKey.organization_id == token.org_id,
        )
    )
    api_key = result.scalar_one_or_none()
    if api_key is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="API key not found")
    await db.delete(api_key)
    await db.commit()


# ===========================================================================
# Phase 13A — Password reset via email
# ===========================================================================

class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


@router.post(
    "/forgot-password",
    summary="Request a password reset link",
    description=(
        "Send a password reset link to the given email address. "
        "Always returns 200 — never reveals whether the address exists."
    ),
)
async def forgot_password(
    body: ForgotPasswordRequest,
    db: AsyncSession = Depends(get_db),
) -> dict:
    settings = get_settings()

    # Look up user by email (no org scoping — email is globally unique)
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if user is not None:
        from api.core.email import EmailService
        from api.services import settings_service as _ss

        now = datetime.now(timezone.utc)
        payload = {
            "sub": user.username,
            "purpose": "password_reset",
            "iat": now,
            "exp": now + timedelta(minutes=15),
        }
        token = jwt.encode(payload, settings.SECRET_KEY, algorithm="HS256")
        reset_url = f"{settings.FRONTEND_URL}/reset-password?token={token}"

        cfg = await _ss.get_resolved_email_config(db, user.organization_id)
        email_svc = EmailService(**cfg)
        try:
            email_svc.send_password_reset(body.email, reset_url)
        except Exception:
            pass  # Already logged inside EmailService; don't reveal failure

    return {"message": "If that email exists, a reset link has been sent."}


@router.post(
    "/reset-password",
    summary="Reset password using a token",
    description="Verify the reset token and update the user's password.",
)
async def reset_password(
    body: ResetPasswordRequest,
    db: AsyncSession = Depends(get_db),
) -> dict:
    settings = get_settings()

    try:
        payload = jwt.decode(body.token, settings.SECRET_KEY, algorithms=["HS256"])
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    if payload.get("purpose") != "password_reset":
        raise HTTPException(status_code=400, detail="Invalid token purpose")

    username = payload.get("sub")
    if not username:
        raise HTTPException(status_code=400, detail="Invalid token")

    result = await db.execute(select(User).where(User.username == username))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=400, detail="User not found")

    if not body.new_password or len(body.new_password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters")

    user.password_hash = _bcrypt.hashpw(body.new_password.encode(), _bcrypt.gensalt()).decode()
    await db.commit()

    return {"message": "Password updated."}
