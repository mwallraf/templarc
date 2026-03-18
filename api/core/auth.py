"""
JWT authentication utilities and auth service implementations for Templarc.

Authentication backends:
  - LocalAuthService  — bcrypt password check against the local users table
  - LDAPAuthService   — simple bind against an LDAP server (ldap3)

The active backend is selected by config:
  - LDAP_SERVER set → LDAPAuthService
  - LDAP_SERVER empty → LocalAuthService

FastAPI dependencies (for route-level enforcement):
  - get_current_user        — decodes a Bearer JWT or X-API-Key, returns TokenData
  - require_org_admin       — same + asserts org_role in (org_owner, org_admin)
  - require_project_role(r) — factory; checks project-level membership role ≥ r
  - require_admin           — alias for require_org_admin (backward compat)

Token payload structure (claims):
  sub              — string username
  org_id           — int organization ID
  org_role         — 'org_owner' | 'org_admin' | 'member'
  is_platform_admin — bool
  exp              — standard JWT expiry (handled by python-jose)

Usage in a router:
    from api.core.auth import require_org_admin, require_project_role, TokenData

    @router.post("/secrets")
    async def create_secret(
        payload: SecretCreate,
        token: TokenData = Depends(require_org_admin),
    ): ...

    @router.get("/templates/{template_id}")
    async def get_template(
        template_id: str,
        project_id: str,
        token: TokenData = Depends(require_project_role("guest")),
    ): ...
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import secrets
from dataclasses import dataclass, field
from datetime import datetime, timezone

import bcrypt as _bcrypt
from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import get_settings
from api.database import get_db

logger = logging.getLogger(__name__)

# Bearer is optional so we can fall through to X-API-Key when no Authorization header
_bearer = HTTPBearer(auto_error=False)

# ---------------------------------------------------------------------------
# Role constants & hierarchy
# ---------------------------------------------------------------------------

# Project role hierarchy — higher index = more privileged
_PROJECT_ROLE_RANK: dict[str, int] = {
    "guest": 0,
    "project_member": 1,
    "project_editor": 2,
    "project_admin": 3,
}

_ORG_ADMIN_ROLES = frozenset({"org_owner", "org_admin"})


# ---------------------------------------------------------------------------
# API key helpers (used by both auth core and auth router)
# ---------------------------------------------------------------------------

_KEY_PREFIX = "tmpl_"
_KEY_BYTES = 32  # 64 hex chars after the prefix


def generate_api_key() -> tuple[str, str, str]:
    """
    Generate a new API key.

    Returns (raw_key, key_prefix, key_hash):
      - raw_key    — the full key shown to the user once, e.g. "tmpl_<64 hex>"
      - key_prefix — first 12 chars stored in DB for display, e.g. "tmpl_a1b2c3"
      - key_hash   — SHA-256 hex digest stored for lookup
    """
    raw = _KEY_PREFIX + secrets.token_hex(_KEY_BYTES)
    prefix = raw[:12]
    digest = hashlib.sha256(raw.encode()).hexdigest()
    return raw, prefix, digest


def hash_api_key(raw_key: str) -> str:
    """Return the SHA-256 hex digest of a raw API key string."""
    return hashlib.sha256(raw_key.encode()).hexdigest()


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------

@dataclass
class TokenData:
    """Structured claims extracted from a validated JWT."""
    sub: str
    org_id: str
    org_role: str          # 'org_owner' | 'org_admin' | 'member'
    is_platform_admin: bool = False


@dataclass
class UserInfo:
    """Normalised user information returned by any auth backend."""
    username: str
    email: str
    groups: list[str] = field(default_factory=list)
    # True when LDAP reports the user is in the admin group → maps to org_admin on upsert
    is_admin: bool = False


# ---------------------------------------------------------------------------
# Role helpers
# ---------------------------------------------------------------------------

def is_org_admin(token: TokenData) -> bool:
    """Return True if the token holder has org-level admin privileges."""
    return token.is_platform_admin or token.org_role in _ORG_ADMIN_ROLES


# ---------------------------------------------------------------------------
# JWT dependency helpers
# ---------------------------------------------------------------------------

async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
    db: AsyncSession = Depends(get_db),
) -> TokenData:
    """
    Resolve caller identity from either a Bearer JWT or an X-API-Key header.

    Priority: X-API-Key → Bearer JWT → 401.
    """
    if x_api_key:
        return await _resolve_api_key(x_api_key, db)

    if credentials:
        return _decode_jwt(credentials.credentials)

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required — provide a Bearer token or X-API-Key header",
        headers={"WWW-Authenticate": "Bearer"},
    )


def _decode_jwt(token: str) -> TokenData:
    """Decode and validate a JWT, returning structured claims."""
    settings = get_settings()
    exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
        sub: str | None = payload.get("sub")
        org_id: str | None = payload.get("org_id")
        if sub is None or org_id is None:
            raise exc

        # New-style token: has org_role field
        if "org_role" in payload:
            org_role: str = payload["org_role"]
            is_platform_admin: bool = bool(payload.get("is_platform_admin", False))
        else:
            # Backward-compat: old tokens had is_admin boolean
            is_platform_admin = False
            org_role = "org_admin" if payload.get("is_admin", False) else "member"

        return TokenData(
            sub=sub,
            org_id=org_id,
            org_role=org_role,
            is_platform_admin=is_platform_admin,
        )
    except JWTError:
        raise exc


async def _resolve_api_key(raw_key: str, db: AsyncSession) -> TokenData:
    """Look up an API key by its hash and return TokenData. Updates last_used_at."""
    from api.models.api_key import ApiKey  # local import to avoid circular deps

    key_hash = hash_api_key(raw_key)
    result = await db.execute(select(ApiKey).where(ApiKey.key_hash == key_hash))
    api_key: ApiKey | None = result.scalar_one_or_none()

    if api_key is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key",
            headers={"WWW-Authenticate": "Bearer"},
        )

    now = datetime.now(timezone.utc)

    # Check expiry
    if api_key.expires_at is not None and api_key.expires_at < now:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="API key has expired",
        )

    # Update last_used_at (best-effort — don't let a write failure break the request)
    try:
        await db.execute(
            update(ApiKey)
            .where(ApiKey.id == api_key.id)
            .values(last_used_at=now)
        )
        await db.commit()
    except Exception:
        await db.rollback()

    return TokenData(
        sub=f"apikey:{api_key.name}",
        org_id=api_key.organization_id,
        org_role=api_key.role,
        is_platform_admin=False,
    )


async def require_org_admin(
    token: TokenData = Depends(get_current_user),
) -> TokenData:
    """Extends get_current_user — raises 403 if the caller is not an org admin."""
    if not is_org_admin(token):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Org-admin privileges required",
        )
    return token


# Backward-compatible alias — routers migrated in this phase use require_org_admin directly.
require_admin = require_org_admin


async def _check_project_membership(
    token: TokenData,
    project_id: str,
    min_role: str,
    db: AsyncSession,
) -> None:
    """
    Shared helper: verify that the caller has at least min_role on project_id.
    Raises 403 on failure. Org admins always pass.
    """
    from api.models.project_membership import ProjectMembership
    from api.models.user import User

    user_result = await db.execute(select(User).where(User.username == token.sub))
    user = user_result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Project access denied")

    mem_result = await db.execute(
        select(ProjectMembership).where(
            ProjectMembership.user_id == user.id,
            ProjectMembership.project_id == project_id,
        )
    )
    membership = mem_result.scalar_one_or_none()
    if membership is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this project",
        )

    actual_rank = _PROJECT_ROLE_RANK.get(membership.role, -1)
    required_rank = _PROJECT_ROLE_RANK.get(min_role, 0)
    if actual_rank < required_rank:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"This action requires at least '{min_role}' role in this project",
        )


def require_project_role(min_role: str):
    """
    Dependency factory for project-level access control.

    Reads project_id from the 'project_id' path parameter.
    Org-admins bypass the check automatically.
    """
    async def _dependency(
        request: Request,
        token: TokenData = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ) -> TokenData:
        if is_org_admin(token):
            return token

        project_id: str | None = request.path_params.get("project_id")
        if not project_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Project access denied",
            )

        await _check_project_membership(token, project_id, min_role, db)
        return token

    return _dependency


def require_project_role_for_template(min_role: str):
    """
    Dependency factory for template endpoints.

    Reads template_id from path params, looks up the template's project_id,
    then applies the same membership check as require_project_role.
    Org-admins bypass the check automatically.
    """
    async def _dependency(
        request: Request,
        token: TokenData = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ) -> TokenData:
        if is_org_admin(token):
            return token

        template_id: str | None = request.path_params.get("template_id")
        if not template_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Project access denied",
            )

        from api.models.template import Template
        tmpl_result = await db.execute(select(Template).where(Template.id == template_id))
        tmpl = tmpl_result.scalar_one_or_none()
        if tmpl is None:
            # Return 404 rather than 403 so callers know the resource doesn't exist
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")

        await _check_project_membership(token, tmpl.project_id, min_role, db)
        return token

    return _dependency


# ---------------------------------------------------------------------------
# Project ID helper for list endpoints
# ---------------------------------------------------------------------------

async def get_user_project_ids(token: TokenData, db: AsyncSession) -> list[str]:
    """
    Return the list of project IDs accessible to the caller.

    - org_admin / platform_admin: all projects in their org.
    - member: only projects where they have a membership row.
    """
    from api.models.project import Project
    from api.models.project_membership import ProjectMembership
    from api.models.user import User

    if is_org_admin(token):
        result = await db.execute(
            select(Project.id).where(Project.organization_id == token.org_id)
        )
        return [row[0] for row in result.all()]

    # Resolve user_id
    user_result = await db.execute(
        select(User.id).where(User.username == token.sub)
    )
    user_row = user_result.one_or_none()
    if user_row is None:
        return []

    mem_result = await db.execute(
        select(ProjectMembership.project_id).where(
            ProjectMembership.user_id == user_row[0]
        )
    )
    return [row[0] for row in mem_result.all()]


# ---------------------------------------------------------------------------
# Shared upsert helper
# ---------------------------------------------------------------------------

async def _upsert_user(
    db: AsyncSession,
    user_info: UserInfo,
    org_id: str,
    is_ldap: bool,
    password_hash: str | None = None,
) -> "User":  # type: ignore[name-defined]  # noqa: F821
    """
    Create or update a User row in the local database.

    - On first login: creates the row with the provided org_id.
    - On subsequent logins: updates email, role, and last_login.
    - Calls db.flush() so the row is visible within the transaction; the
      caller is responsible for committing.

    LDAP admin group membership (user_info.is_admin=True) maps to 'org_admin'.
    """
    from api.models.user import User  # local import to avoid circular deps

    result = await db.execute(
        select(User).where(User.username == user_info.username)
    )
    user: User | None = result.scalar_one_or_none()

    now = datetime.now(timezone.utc)
    # Map LDAP is_admin flag to org role (never demotes an existing org_owner)
    ldap_role = "org_admin" if user_info.is_admin else "member"

    if user is None:
        user = User(
            organization_id=org_id,
            username=user_info.username,
            email=user_info.email,
            role=ldap_role if is_ldap else "member",
            is_platform_admin=False,
            is_ldap=is_ldap,
            password_hash=password_hash,
            last_login=now,
        )
        db.add(user)
    else:
        user.email = user_info.email
        user.last_login = now
        if is_ldap:
            # For LDAP, update role (but never demote an existing org_owner)
            if user.role != "org_owner":
                user.role = ldap_role
        # Only update password_hash for local users if explicitly provided
        if not is_ldap and password_hash is not None:
            user.password_hash = password_hash

    await db.flush()
    return user


# ---------------------------------------------------------------------------
# Local auth service
# ---------------------------------------------------------------------------

class LocalAuthService:
    """Authenticates users via a bcrypt password stored in the local users table."""

    @staticmethod
    async def authenticate(
        username: str,
        password: str,
        db: AsyncSession,
    ) -> UserInfo | None:
        """
        Verify username + password against the local users table.

        Returns UserInfo on success, None on failure (wrong password, user not
        found, or user is an LDAP-only account).
        """
        from api.models.user import User  # local import

        result = await db.execute(
            select(User).where(User.username == username, User.is_ldap.is_(False))
        )
        user: User | None = result.scalar_one_or_none()

        if user is None or user.password_hash is None:
            # Constant-time dummy check to prevent user enumeration timing attacks
            _bcrypt.checkpw(b"dummy", _bcrypt.hashpw(b"dummy", _bcrypt.gensalt(4)))
            return None

        if not _bcrypt.checkpw(password.encode(), user.password_hash.encode()):
            return None

        return UserInfo(
            username=user.username,
            email=user.email,
            groups=[],
            is_admin=user.role in _ORG_ADMIN_ROLES,
        )


# ---------------------------------------------------------------------------
# LDAP auth service
# ---------------------------------------------------------------------------

class LDAPAuthService:
    """
    Authenticates users via a simple bind against an LDAP server (ldap3).

    All ldap3 I/O is synchronous; it is offloaded to a thread-pool executor
    so the asyncio event loop is not blocked.
    """

    def __init__(self, server_url: str, base_dn: str, admin_group: str = "") -> None:
        self._server_url = server_url
        self._base_dn = base_dn
        self._admin_group = admin_group

    def _sync_bind_and_search(
        self, username: str, password: str
    ) -> UserInfo | None:
        """Synchronous LDAP operation executed in a thread executor."""
        try:
            import ldap3
        except ImportError:
            raise RuntimeError("ldap3 is not installed; cannot use LDAP auth")

        server = ldap3.Server(self._server_url, get_info=ldap3.ALL)
        tls_mode = (
            ldap3.AUTO_BIND_TLS_BEFORE_BIND
            if self._server_url.startswith("ldaps://")
            else ldap3.AUTO_BIND_NO_TLS
        )

        # Step 1: anonymous search to resolve uid → actual DN
        try:
            anon_conn = ldap3.Connection(server, auto_bind=tls_mode)
            anon_conn.search(
                self._base_dn,
                f"(uid={username})",
                attributes=ldap3.NO_ATTRIBUTES,
            )
        except Exception as exc:
            logger.warning("LDAP anonymous search error for %r: %s", username, exc)
            return None

        if not anon_conn.entries:
            return None
        user_dn = anon_conn.entries[0].entry_dn
        anon_conn.unbind()

        # Step 2: bind as the resolved DN to verify the password
        try:
            conn = ldap3.Connection(
                server,
                user=user_dn,
                password=password,
                auto_bind=tls_mode,
                authentication=ldap3.SIMPLE,
            )
        except ldap3.core.exceptions.LDAPBindError:
            return None
        except Exception as exc:
            logger.warning("LDAP connection error for %r: %s", username, exc)
            return None

        if not conn.bound:
            conn.close()
            return None

        # Step 3: fetch email and memberOf
        conn.search(
            self._base_dn,
            f"(uid={username})",
            attributes=ldap3.ALL_ATTRIBUTES,
        )

        email = ""
        groups: list[str] = []

        if conn.entries:
            entry = conn.entries[0]
            if hasattr(entry, "mail") and entry.mail:
                email = str(entry.mail)
            if hasattr(entry, "memberOf") and entry.memberOf:
                raw = entry.memberOf
                groups = [str(g) for g in (raw if isinstance(raw, list) else [raw])]

        # Step 4: check admin group membership
        is_admin = False
        if self._admin_group:
            if any(self._admin_group.lower() in g.lower() for g in groups):
                is_admin = True
            elif not groups:
                try:
                    conn.search(
                        self._admin_group,
                        "(objectClass=*)",
                        search_scope=ldap3.BASE,
                        attributes=["member", "uniqueMember"],
                    )
                    if conn.entries:
                        grp = conn.entries[0]
                        members: list[str] = []
                        if hasattr(grp, "member") and grp.member:
                            raw = grp.member
                            members = [str(m) for m in (raw if isinstance(raw, list) else [raw])]
                        elif hasattr(grp, "uniqueMember") and grp.uniqueMember:
                            raw = grp.uniqueMember
                            members = [str(m) for m in (raw if isinstance(raw, list) else [raw])]
                        is_admin = any(user_dn.lower() == m.lower() for m in members)
                        groups = [self._admin_group] if is_admin else []
                except Exception:
                    pass

        conn.unbind()

        return UserInfo(
            username=username,
            email=email,
            groups=groups,
            is_admin=is_admin,
        )

    async def authenticate(
        self,
        username: str,
        password: str,
        db: AsyncSession,
    ) -> UserInfo | None:
        """
        Perform an async LDAP bind.  On success, upserts the user into the
        local DB (assigned to the first active org) and returns UserInfo.
        Returns None if bind fails.
        """
        from api.models.organization import Organization  # local import

        loop = asyncio.get_event_loop()
        user_info = await loop.run_in_executor(
            None, self._sync_bind_and_search, username, password
        )
        if user_info is None:
            return None

        # Resolve org: assign to first active organization
        org_result = await db.execute(
            select(Organization)
            .where(Organization.is_active.is_(True))
            .order_by(Organization.id)
            .limit(1)
        )
        org = org_result.scalar_one_or_none()
        if org is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="No active organization found — cannot authenticate LDAP user",
            )

        await _upsert_user(db, user_info, org_id=org.id, is_ldap=True)
        return user_info
