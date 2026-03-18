"""
Integration tests for API key management endpoints:
  POST   /auth/api-keys        — create an API key (admin only)
  GET    /auth/api-keys        — list API keys (admin only)
  DELETE /auth/api-keys/{id}   — revoke an API key (admin only)

Plus authentication via X-API-Key header (tested against GET /auth/me).

All DB writes are rolled back after each test via _FlushOnCommitSession.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import bcrypt as _bcrypt
import httpx
import pytest
from jose import jwt
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from api.config import get_settings
from api.core.auth import TokenData, generate_api_key, get_current_user, hash_api_key, require_admin
from api.database import get_db
from api.dependencies import get_git_service
from api.main import app
from api.models.api_key import ApiKey
from api.models.organization import Organization
from api.models.user import User
from api.services.git_service import GitService


# ===========================================================================
# Infrastructure (mirrors test_auth_endpoints.py pattern)
# ===========================================================================

class _FlushOnCommitSession(AsyncSession):
    async def commit(self) -> None:  # type: ignore[override]
        await self.flush()


@pytest.fixture
async def api_db() -> AsyncSession:
    settings = get_settings()
    engine = create_async_engine(settings.async_database_url, echo=False, pool_pre_ping=True)
    factory = async_sessionmaker(
        bind=engine,
        class_=_FlushOnCommitSession,
        expire_on_commit=False,
        autocommit=False,
        autoflush=False,
    )
    async with factory() as session:
        yield session
        await session.rollback()
    await engine.dispose()


@pytest.fixture(autouse=True)
def disable_ldap(monkeypatch):
    """
    Force LDAP_SERVER to empty so all auth tests use local authentication.
    The .env file may contain a placeholder LDAP_SERVER value; we clear it
    here to ensure tests are deterministic regardless of the environment.
    """
    settings = get_settings()
    monkeypatch.setattr(settings, "LDAP_SERVER", "")


@pytest.fixture
def git_repo(tmp_path: Path) -> GitService:
    return GitService(tmp_path / "templates_repo")


@pytest.fixture
async def test_org(api_db: AsyncSession) -> Organization:
    org = Organization(name="__apikey_test_org__", display_name="API Key Test Org")
    api_db.add(org)
    await api_db.flush()
    return org


@pytest.fixture
async def admin_user(api_db: AsyncSession, test_org: Organization) -> User:
    """An admin local user."""
    user = User(
        organization_id=test_org.id,
        username="apikeyAdmin",
        email="apikey_admin@example.com",
        role="org_admin",
        is_ldap=False,
        password_hash=_bcrypt.hashpw(b"adminpass", _bcrypt.gensalt()).decode(),
    )
    api_db.add(user)
    await api_db.flush()
    return user


@pytest.fixture
async def non_admin_user(api_db: AsyncSession, test_org: Organization) -> User:
    """A non-admin local user."""
    user = User(
        organization_id=test_org.id,
        username="apikeyRegular",
        email="apikey_regular@example.com",
        role="member",
        is_ldap=False,
        password_hash=_bcrypt.hashpw(b"userpass", _bcrypt.gensalt()).decode(),
    )
    api_db.add(user)
    await api_db.flush()
    return user


def _make_token(username: str, org_id: str, is_admin: bool) -> str:
    """Build a signed JWT for use in Authorization headers."""
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload = {
        "sub": username,
        "org_id": org_id,
        "org_role": "org_admin" if is_admin else "member",
        "is_platform_admin": False,
        "iat": now,
        "exp": now + timedelta(hours=8),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm="HS256")


@pytest.fixture
async def client(api_db: AsyncSession, git_repo: GitService) -> httpx.AsyncClient:
    """
    Test client with DB and git overrides but NO auth override.

    Most TestApiKeys tests inject auth via JWT headers or X-API-Key. Two tests
    that check non-admin enforcement also rely on real auth resolution so they
    also use this fixture with real tokens.
    """
    async def override_get_db():
        yield api_db

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_git_service] = lambda: git_repo

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest.fixture
async def admin_client(api_db: AsyncSession, git_repo: GitService, test_org: Organization) -> httpx.AsyncClient:
    """
    Test client where auth is always bypassed with an admin identity.

    Useful for tests that want to exercise the API key CRUD logic without
    worrying about auth mechanics.
    """
    async def override_get_db():
        yield api_db

    admin_token_data = TokenData(sub="apikeyAdmin", org_id=test_org.id, org_role="org_admin")

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_git_service] = lambda: git_repo
    app.dependency_overrides[get_current_user] = lambda: admin_token_data
    app.dependency_overrides[require_admin] = lambda: admin_token_data

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as ac:
        yield ac

    app.dependency_overrides.clear()


# ===========================================================================
# Tests
# ===========================================================================

@pytest.mark.asyncio
class TestApiKeys:

    # -----------------------------------------------------------------------
    # POST /auth/api-keys
    # -----------------------------------------------------------------------

    async def test_create_api_key(
        self,
        admin_client: httpx.AsyncClient,
        admin_user: User,
    ) -> None:
        """Admin can create an API key; raw_key and prefix are returned."""
        resp = await admin_client.post(
            "/auth/api-keys",
            json={"name": "my-ci-key", "role": "member"},
        )
        assert resp.status_code == 201

        data = resp.json()
        assert data["name"] == "my-ci-key"
        assert data["role"] == "member"

        # raw_key must be present and have the correct format
        raw_key: str = data["raw_key"]
        assert raw_key.startswith("tmpl_"), f"Expected 'tmpl_' prefix, got: {raw_key!r}"
        # tmpl_ (5) + 64 hex chars = 69 chars total
        assert len(raw_key) == 69, f"Unexpected key length: {len(raw_key)}"

        # key_prefix is the first 12 chars of the raw key
        assert data["key_prefix"] == raw_key[:12]

        # Metadata fields present
        assert "id" in data
        assert "created_at" in data

    async def test_create_api_key_with_expiry(
        self,
        admin_client: httpx.AsyncClient,
        admin_user: User,
    ) -> None:
        """API key creation accepts an optional expires_at timestamp."""
        expires = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        resp = await admin_client.post(
            "/auth/api-keys",
            json={"name": "expiring-key", "role": "org_admin", "expires_at": expires},
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["expires_at"] is not None
        assert data["role"] == "org_admin"

    # -----------------------------------------------------------------------
    # GET /auth/api-keys
    # -----------------------------------------------------------------------

    async def test_raw_key_not_returned_on_list(
        self,
        admin_client: httpx.AsyncClient,
        admin_user: User,
    ) -> None:
        """List endpoint returns keys without the raw_key field."""
        # Create a key first
        create_resp = await admin_client.post(
            "/auth/api-keys",
            json={"name": "list-test-key"},
        )
        assert create_resp.status_code == 201

        list_resp = await admin_client.get("/auth/api-keys")
        assert list_resp.status_code == 200

        keys = list_resp.json()
        assert isinstance(keys, list)
        assert len(keys) >= 1

        # None of the listed keys should have a raw_key field
        for key in keys:
            assert "raw_key" not in key, "raw_key must never appear in the list response"

        # But the expected metadata fields should be present
        for key in keys:
            for field in ("id", "name", "key_prefix", "role", "created_at"):
                assert field in key, f"Expected field {field!r} missing from list item"

    async def test_list_shows_created_key(
        self,
        admin_client: httpx.AsyncClient,
        admin_user: User,
    ) -> None:
        """A newly created key appears in the list with correct metadata."""
        create_resp = await admin_client.post(
            "/auth/api-keys",
            json={"name": "appear-in-list"},
        )
        created_id = create_resp.json()["id"]

        list_resp = await admin_client.get("/auth/api-keys")
        ids = [k["id"] for k in list_resp.json()]
        assert created_id in ids

    # -----------------------------------------------------------------------
    # DELETE /auth/api-keys/{id}
    # -----------------------------------------------------------------------

    async def test_delete_api_key(
        self,
        admin_client: httpx.AsyncClient,
        admin_user: User,
    ) -> None:
        """Admin can revoke (delete) an API key; it no longer appears in the list."""
        create_resp = await admin_client.post(
            "/auth/api-keys",
            json={"name": "to-be-deleted"},
        )
        assert create_resp.status_code == 201
        key_id = create_resp.json()["id"]

        delete_resp = await admin_client.delete(f"/auth/api-keys/{key_id}")
        assert delete_resp.status_code == 204

        # Confirm key is gone from the list
        list_resp = await admin_client.get("/auth/api-keys")
        ids = [k["id"] for k in list_resp.json()]
        assert key_id not in ids

    async def test_delete_nonexistent_key_returns_404(
        self,
        admin_client: httpx.AsyncClient,
        admin_user: User,
    ) -> None:
        """Attempting to delete a key that does not exist returns 404."""
        resp = await admin_client.delete("/auth/api-keys/999999999")
        assert resp.status_code == 404

    # -----------------------------------------------------------------------
    # Authentication via X-API-Key header
    # -----------------------------------------------------------------------

    async def test_authenticate_with_api_key(
        self,
        client: httpx.AsyncClient,
        api_db: AsyncSession,
        test_org: Organization,
    ) -> None:
        """
        A request with a valid X-API-Key header is authenticated successfully.

        We create an ApiKey row directly in the DB (with a known raw key and its
        hash), then use that raw key to call GET /auth/me and assert a 200.
        """
        raw_key, key_prefix, key_hash = generate_api_key()

        api_key = ApiKey(
            organization_id=test_org.id,
            created_by=None,
            name="test-auth-key",
            key_prefix=key_prefix,
            key_hash=key_hash,
            role="member",
        )
        api_db.add(api_key)
        await api_db.flush()

        resp = await client.get(
            "/auth/me",
            headers={"X-API-Key": raw_key},
        )
        assert resp.status_code == 200

        data = resp.json()
        # sub is set to "apikey:<name>" for API key callers
        assert data["username"] == "apikey:test-auth-key"

    async def test_api_key_sets_correct_org_and_admin_flag(
        self,
        client: httpx.AsyncClient,
        api_db: AsyncSession,
        test_org: Organization,
    ) -> None:
        """TokenData built from an API key carries the correct org_id and role."""
        raw_key, key_prefix, key_hash = generate_api_key()

        api_key = ApiKey(
            organization_id=test_org.id,
            created_by=None,
            name="admin-api-key",
            key_prefix=key_prefix,
            key_hash=key_hash,
            role="org_admin",
        )
        api_db.add(api_key)
        await api_db.flush()

        resp = await client.get(
            "/auth/me",
            headers={"X-API-Key": raw_key},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["org_id"] == test_org.id
        assert data["org_role"] == "org_admin"

    async def test_invalid_api_key_returns_401(
        self,
        client: httpx.AsyncClient,
        test_org: Organization,
    ) -> None:
        """Sending a garbage X-API-Key value returns 401."""
        resp = await client.get(
            "/auth/me",
            headers={"X-API-Key": "tmpl_thisisnotavalidkey000000000000000000000000000000000000000000000000"},
        )
        assert resp.status_code == 401

    async def test_expired_api_key_returns_401(
        self,
        client: httpx.AsyncClient,
        api_db: AsyncSession,
        test_org: Organization,
    ) -> None:
        """An expired API key is rejected with 401."""
        raw_key, key_prefix, key_hash = generate_api_key()

        expired_at = datetime.now(timezone.utc) - timedelta(hours=1)
        api_key = ApiKey(
            organization_id=test_org.id,
            created_by=None,
            name="expired-key",
            key_prefix=key_prefix,
            key_hash=key_hash,
            role="member",
            expires_at=expired_at,
        )
        api_db.add(api_key)
        await api_db.flush()

        resp = await client.get(
            "/auth/me",
            headers={"X-API-Key": raw_key},
        )
        assert resp.status_code == 401

    # -----------------------------------------------------------------------
    # Non-admin enforcement
    # -----------------------------------------------------------------------

    async def test_non_admin_cannot_create_key(
        self,
        client: httpx.AsyncClient,
        non_admin_user: User,
        test_org: Organization,
    ) -> None:
        """A non-admin user receives 403 when attempting to create an API key."""
        token_str = _make_token(
            username=non_admin_user.username,
            org_id=non_admin_user.organization_id,
            is_admin=False,
        )
        resp = await client.post(
            "/auth/api-keys",
            json={"name": "should-fail"},
            headers={"Authorization": f"Bearer {token_str}"},
        )
        assert resp.status_code == 403

    async def test_non_admin_cannot_list_keys(
        self,
        client: httpx.AsyncClient,
        non_admin_user: User,
        test_org: Organization,
    ) -> None:
        """A non-admin user receives 403 when attempting to list API keys."""
        token_str = _make_token(
            username=non_admin_user.username,
            org_id=non_admin_user.organization_id,
            is_admin=False,
        )
        resp = await client.get(
            "/auth/api-keys",
            headers={"Authorization": f"Bearer {token_str}"},
        )
        assert resp.status_code == 403

    async def test_non_admin_cannot_delete_key(
        self,
        client: httpx.AsyncClient,
        non_admin_user: User,
        test_org: Organization,
    ) -> None:
        """A non-admin user receives 403 when attempting to delete an API key."""
        token_str = _make_token(
            username=non_admin_user.username,
            org_id=non_admin_user.organization_id,
            is_admin=False,
        )
        resp = await client.delete(
            "/auth/api-keys/1",
            headers={"Authorization": f"Bearer {token_str}"},
        )
        assert resp.status_code == 403

    async def test_unauthenticated_cannot_access_api_keys(
        self,
        client: httpx.AsyncClient,
        test_org: Organization,
    ) -> None:
        """Requests with no credentials return 401 (unauthenticated) for all API key endpoints."""
        post_resp = await client.post("/auth/api-keys", json={"name": "anon"})
        assert post_resp.status_code == 401

        get_resp = await client.get("/auth/api-keys")
        assert get_resp.status_code == 401

        delete_resp = await client.delete("/auth/api-keys/1")
        assert delete_resp.status_code == 401
