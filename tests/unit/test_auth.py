"""
Unit tests for api/core/auth.py — LocalAuthService, LDAPAuthService, JWT deps.

These tests mock all external I/O (DB queries, LDAP connections) so they run
without a live database or LDAP server.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import bcrypt as _bcrypt
import pytest
from fastapi import HTTPException
from jose import jwt

from api.core.auth import (
    LDAPAuthService,
    LocalAuthService,
    TokenData,
    UserInfo,
    _upsert_user,
    get_current_user,
    require_admin,
)


# ===========================================================================
# Helpers
# ===========================================================================

def _make_credentials(token: str) -> MagicMock:
    """Build a mock HTTPAuthorizationCredentials with the given token."""
    creds = MagicMock()
    creds.credentials = token
    return creds


def _build_jwt(
    sub: str = "alice",
    org_id: int = 1,
    is_admin: bool = False,
    secret: str = "testsecret",
    expires_in: int = 3600,
) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": sub,
        "org_id": org_id,
        "is_admin": is_admin,
        "iat": now,
        "exp": now + timedelta(seconds=expires_in),
    }
    return jwt.encode(payload, secret, algorithm="HS256")


# ===========================================================================
# get_current_user
# ===========================================================================

class TestGetCurrentUser:

    @patch("api.core.auth.get_settings")
    async def test_valid_token_returns_token_data(self, mock_settings):
        mock_settings.return_value.SECRET_KEY = "testsecret"
        token_str = _build_jwt(sub="alice", org_id=5, is_admin=True)

        result = await get_current_user(_make_credentials(token_str))

        assert result.sub == "alice"
        assert result.org_id == 5
        assert result.is_admin is True

    @patch("api.core.auth.get_settings")
    async def test_expired_token_raises_401(self, mock_settings):
        mock_settings.return_value.SECRET_KEY = "testsecret"
        token_str = _build_jwt(expires_in=-1)  # already expired

        with pytest.raises(HTTPException) as exc_info:
            await get_current_user(_make_credentials(token_str))
        assert exc_info.value.status_code == 401

    @patch("api.core.auth.get_settings")
    async def test_wrong_secret_raises_401(self, mock_settings):
        mock_settings.return_value.SECRET_KEY = "correct_secret"
        token_str = _build_jwt(secret="wrong_secret")

        with pytest.raises(HTTPException) as exc_info:
            await get_current_user(_make_credentials(token_str))
        assert exc_info.value.status_code == 401

    @patch("api.core.auth.get_settings")
    async def test_missing_sub_raises_401(self, mock_settings):
        mock_settings.return_value.SECRET_KEY = "testsecret"
        now = datetime.now(timezone.utc)
        payload = {"org_id": 1, "exp": now + timedelta(hours=1)}
        token_str = jwt.encode(payload, "testsecret", algorithm="HS256")

        with pytest.raises(HTTPException) as exc_info:
            await get_current_user(_make_credentials(token_str))
        assert exc_info.value.status_code == 401

    @patch("api.core.auth.get_settings")
    async def test_is_admin_defaults_to_false(self, mock_settings):
        mock_settings.return_value.SECRET_KEY = "testsecret"
        token_str = _build_jwt(is_admin=False)

        result = await get_current_user(_make_credentials(token_str))
        assert result.is_admin is False


# ===========================================================================
# require_admin
# ===========================================================================

class TestRequireAdmin:

    async def test_admin_token_passes(self):
        token = TokenData(sub="admin", org_id=1, is_admin=True)
        result = await require_admin(token)
        assert result is token

    async def test_non_admin_raises_403(self):
        token = TokenData(sub="user", org_id=1, is_admin=False)
        with pytest.raises(HTTPException) as exc_info:
            await require_admin(token)
        assert exc_info.value.status_code == 403


# ===========================================================================
# LocalAuthService
# ===========================================================================

class TestLocalAuthService:

    def _make_user(
        self,
        username: str = "alice",
        password: str = "secret",
        is_ldap: bool = False,
    ) -> MagicMock:
        """Create a mock User ORM object."""
        user = MagicMock()
        user.username = username
        user.email = f"{username}@example.com"
        user.is_admin = False
        user.is_ldap = is_ldap
        user.password_hash = _bcrypt.hashpw(password.encode(), _bcrypt.gensalt()).decode() if not is_ldap else None
        return user

    def _make_db(self, user_or_none) -> AsyncMock:
        """Create a mock AsyncSession that returns user_or_none on execute."""
        db = AsyncMock()
        result_mock = MagicMock()
        result_mock.scalar_one_or_none.return_value = user_or_none
        db.execute = AsyncMock(return_value=result_mock)
        return db

    async def test_correct_password_returns_user_info(self):
        user = self._make_user(password="secret")
        db = self._make_db(user)

        result = await LocalAuthService.authenticate("alice", "secret", db)

        assert result is not None
        assert result.username == "alice"
        assert result.email == "alice@example.com"
        assert result.is_admin is False

    async def test_wrong_password_returns_none(self):
        user = self._make_user(password="secret")
        db = self._make_db(user)

        result = await LocalAuthService.authenticate("alice", "wrong", db)
        assert result is None

    async def test_user_not_found_returns_none(self):
        db = self._make_db(None)
        result = await LocalAuthService.authenticate("unknown", "pass", db)
        assert result is None

    async def test_ldap_user_without_password_returns_none(self):
        user = self._make_user(is_ldap=True)
        user.password_hash = None
        db = self._make_db(None)  # query filters is_ldap=False, so returns None

        result = await LocalAuthService.authenticate("alice", "secret", db)
        assert result is None


# ===========================================================================
# LDAPAuthService — mocked ldap3
# ===========================================================================

class TestLDAPAuthService:

    def _make_svc(self, admin_group: str = "") -> LDAPAuthService:
        return LDAPAuthService(
            server_url="ldap://ldap.example.com",
            base_dn="dc=example,dc=com",
            admin_group=admin_group,
        )

    def _mock_ldap_success(
        self,
        email: str = "alice@example.com",
        member_of: list[str] | None = None,
    ):
        """
        Returns a mock ldap3 module where Connection.bound=True and
        search returns a single entry with the given attributes.
        """
        member_of = member_of or []
        entry = MagicMock()
        entry.mail = email
        entry.memberOf = member_of

        conn_mock = MagicMock()
        conn_mock.bound = True
        conn_mock.entries = [entry]

        ldap3_mock = MagicMock()
        ldap3_mock.Server.return_value = MagicMock()
        ldap3_mock.Connection.return_value = conn_mock
        ldap3_mock.AUTO_BIND_NO_TLS = "NO_TLS"
        ldap3_mock.AUTO_BIND_TLS_BEFORE_BIND = "TLS"
        ldap3_mock.SIMPLE = "SIMPLE"
        ldap3_mock.ALL = "ALL"
        ldap3_mock.core.exceptions.LDAPBindError = Exception
        return ldap3_mock

    def _mock_ldap_bind_failure(self):
        ldap3_mock = MagicMock()
        ldap3_mock.Server.return_value = MagicMock()

        # Simulate bind failure
        class FakeLDAPBindError(Exception):
            pass

        ldap3_mock.core = MagicMock()
        ldap3_mock.core.exceptions.LDAPBindError = FakeLDAPBindError
        ldap3_mock.Connection.side_effect = FakeLDAPBindError("bind failed")
        ldap3_mock.AUTO_BIND_NO_TLS = "NO_TLS"
        ldap3_mock.AUTO_BIND_TLS_BEFORE_BIND = "TLS"
        ldap3_mock.SIMPLE = "SIMPLE"
        ldap3_mock.ALL = "ALL"
        return ldap3_mock

    def _make_db_with_org(self, org_id: int = 42) -> AsyncMock:
        org = MagicMock()
        org.id = org_id

        db = AsyncMock()
        result_mock = MagicMock()
        result_mock.scalar_one_or_none.return_value = org
        db.execute = AsyncMock(return_value=result_mock)
        db.flush = AsyncMock()
        db.add = MagicMock()
        return db

    async def test_successful_bind_returns_user_info(self):
        svc = self._make_svc()
        ldap3_mock = self._mock_ldap_success(email="alice@example.com")
        db = self._make_db_with_org()

        with patch("api.core.auth._upsert_user", new_callable=AsyncMock) as mock_upsert:
            with patch.object(svc, "_sync_bind_and_search") as mock_sync:
                mock_sync.return_value = UserInfo(
                    username="alice",
                    email="alice@example.com",
                    groups=[],
                    is_admin=False,
                )
                result = await svc.authenticate("alice", "password", db)

        assert result is not None
        assert result.username == "alice"
        assert result.email == "alice@example.com"

    async def test_bind_failure_returns_none(self):
        svc = self._make_svc()
        db = self._make_db_with_org()

        with patch.object(svc, "_sync_bind_and_search", return_value=None):
            result = await svc.authenticate("alice", "wrong", db)

        assert result is None

    def test_is_admin_when_in_admin_group(self):
        svc = self._make_svc(admin_group="cn=admins,dc=example,dc=com")
        ldap3_mock = self._mock_ldap_success(
            email="alice@example.com",
            member_of=["cn=admins,dc=example,dc=com", "cn=users,dc=example,dc=com"],
        )

        with patch.dict("sys.modules", {"ldap3": ldap3_mock}):
            result = svc._sync_bind_and_search("alice", "secret")

        assert result is not None
        assert result.is_admin is True

    def test_is_not_admin_when_not_in_group(self):
        svc = self._make_svc(admin_group="cn=admins,dc=example,dc=com")
        ldap3_mock = self._mock_ldap_success(
            email="bob@example.com",
            member_of=["cn=users,dc=example,dc=com"],
        )

        with patch.dict("sys.modules", {"ldap3": ldap3_mock}):
            result = svc._sync_bind_and_search("bob", "secret")

        assert result is not None
        assert result.is_admin is False

    def test_bind_failure_returns_none_sync(self):
        svc = self._make_svc()
        ldap3_mock = self._mock_ldap_bind_failure()

        with patch.dict("sys.modules", {"ldap3": ldap3_mock}):
            result = svc._sync_bind_and_search("alice", "wrong")

        assert result is None
