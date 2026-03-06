"""
JWT authentication utilities and auth service implementations for Templarc.

Authentication backends:
  - LocalAuthService  — bcrypt password check against the local users table
  - LDAPAuthService   — simple bind against an LDAP server (ldap3)

The active backend is selected by config:
  - LDAP_SERVER set → LDAPAuthService
  - LDAP_SERVER empty → LocalAuthService

FastAPI dependencies (for route-level enforcement):
  - get_current_user  — decodes and validates a Bearer JWT, returns TokenData
  - require_admin     — same as above, additionally asserts is_admin=True

Token payload structure (claims):
  sub          — string username
  org_id       — int organization ID
  is_admin     — bool, True for admin users
  exp          — standard JWT expiry (handled by python-jose)

Usage in a router:
    from api.core.auth import require_admin, TokenData

    @router.post("/secrets")
    async def create_secret(
        payload: SecretCreate,
        token: TokenData = Depends(require_admin),
    ): ...
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone

import bcrypt as _bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import get_settings

logger = logging.getLogger(__name__)

_bearer = HTTPBearer(auto_error=True)


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------

@dataclass
class TokenData:
    """Structured claims extracted from a validated JWT."""
    sub: str
    org_id: int
    is_admin: bool


@dataclass
class UserInfo:
    """Normalised user information returned by any auth backend."""
    username: str
    email: str
    groups: list[str] = field(default_factory=list)
    is_admin: bool = False


# ---------------------------------------------------------------------------
# JWT dependency helpers
# ---------------------------------------------------------------------------

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> TokenData:
    """Decode a Bearer JWT and return structured token claims."""
    settings = get_settings()
    exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(
            credentials.credentials,
            settings.SECRET_KEY,
            algorithms=["HS256"],
        )
        sub: str | None = payload.get("sub")
        org_id: int | None = payload.get("org_id")
        if sub is None or org_id is None:
            raise exc
        is_admin: bool = bool(payload.get("is_admin", False))
        return TokenData(sub=sub, org_id=org_id, is_admin=is_admin)
    except JWTError:
        raise exc


async def require_admin(
    token: TokenData = Depends(get_current_user),
) -> TokenData:
    """Extends get_current_user — raises 403 if the caller is not an admin."""
    if not token.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required",
        )
    return token


# ---------------------------------------------------------------------------
# Shared upsert helper
# ---------------------------------------------------------------------------

async def _upsert_user(
    db: AsyncSession,
    user_info: UserInfo,
    org_id: int,
    is_ldap: bool,
    password_hash: str | None = None,
) -> "User":  # type: ignore[name-defined]  # noqa: F821
    """
    Create or update a User row in the local database.

    - On first login: creates the row with the provided org_id.
    - On subsequent logins: updates email, is_admin, and last_login.
    - Calls db.flush() so the row is visible within the transaction; the
      caller is responsible for committing.
    """
    from api.models.user import User  # local import to avoid circular deps

    result = await db.execute(
        select(User).where(User.username == user_info.username)
    )
    user: User | None = result.scalar_one_or_none()

    now = datetime.now(timezone.utc)

    if user is None:
        user = User(
            organization_id=org_id,
            username=user_info.username,
            email=user_info.email,
            is_admin=user_info.is_admin,
            is_ldap=is_ldap,
            password_hash=password_hash,
            last_login=now,
        )
        db.add(user)
    else:
        user.email = user_info.email
        user.is_admin = user_info.is_admin
        user.last_login = now
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
            is_admin=user.is_admin,
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
        # (bitnami/openldap uses cn= as RDN, not uid=, so we cannot build
        # the bind DN directly from the username)
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

        # Step 3: fetch email and memberOf (if overlay is enabled).
        # Use ALL_ATTRIBUTES to avoid LDAPAttributeError when the memberOf
        # overlay is not loaded in the server's schema.
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

        # Step 4: if memberOf overlay is absent, fall back to searching the
        # admin group directly for a 'member' attribute containing user_dn.
        is_admin = False
        if self._admin_group:
            if any(self._admin_group.lower() in g.lower() for g in groups):
                is_admin = True
            elif not groups:
                # memberOf overlay not available — query the group entry directly
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
                    pass  # group lookup failure is non-fatal

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
