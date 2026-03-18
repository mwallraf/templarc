"""
Integration tests for auth endpoints:
  POST /auth/login       — JSON login (local mode)
  POST /auth/login/local — local-only login
  POST /auth/token       — OAuth2 form login
  GET  /auth/me          — current user info
  POST /auth/users       — create local user (admin)

All DB writes are rolled back after each test.
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

from unittest.mock import patch

from api.config import Settings, get_settings
from api.core.auth import TokenData, get_current_user, require_admin
from api.database import get_db
from api.dependencies import get_git_service
from api.main import app
from api.models.organization import Organization
from api.models.user import User
from api.services.git_service import GitService


# ===========================================================================
# Infrastructure
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
    org = Organization(name="__auth_test_org__", display_name="Auth Test Org")
    api_db.add(org)
    await api_db.flush()
    return org


@pytest.fixture
async def local_user(api_db: AsyncSession, test_org: Organization) -> User:
    """A local user with a known password."""
    user = User(
        organization_id=test_org.id,
        username="localuser",
        email="local@example.com",
        role="member",
        is_ldap=False,
        password_hash=_bcrypt.hashpw(b"correct_password", _bcrypt.gensalt()).decode(),
    )
    api_db.add(user)
    await api_db.flush()
    return user


@pytest.fixture
async def admin_user(api_db: AsyncSession, test_org: Organization) -> User:
    """An admin local user with a known password."""
    user = User(
        organization_id=test_org.id,
        username="adminuser",
        email="admin@example.com",
        role="org_admin",
        is_ldap=False,
        password_hash=_bcrypt.hashpw(b"adminpass", _bcrypt.gensalt()).decode(),
    )
    api_db.add(user)
    await api_db.flush()
    return user


def _admin_token(org_id: int) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload = {
        "sub": "adminuser",
        "org_id": org_id,
        "org_role": "org_admin",
        "is_platform_admin": False,
        "iat": now,
        "exp": now + timedelta(hours=8),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm="HS256")


@pytest.fixture
async def client(api_db: AsyncSession, git_repo: GitService) -> httpx.AsyncClient:
    """Client with DB and git overrides but NO auth override (tests auth explicitly)."""
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


# ===========================================================================
# POST /auth/login (JSON body, local mode)
# ===========================================================================

class TestLoginJson:

    async def test_valid_credentials_returns_token(
        self, client: httpx.AsyncClient, local_user: User
    ) -> None:
        resp = await client.post(
            "/auth/login",
            json={"username": "localuser", "password": "correct_password"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"
        assert data["expires_in"] > 0

    async def test_wrong_password_returns_401(
        self, client: httpx.AsyncClient, local_user: User
    ) -> None:
        resp = await client.post(
            "/auth/login",
            json={"username": "localuser", "password": "wrong"},
        )
        assert resp.status_code == 401

    async def test_unknown_user_returns_401(
        self, client: httpx.AsyncClient, test_org: Organization
    ) -> None:
        resp = await client.post(
            "/auth/login",
            json={"username": "nobody", "password": "pass"},
        )
        assert resp.status_code == 401

    async def test_token_contains_correct_claims(
        self, client: httpx.AsyncClient, local_user: User
    ) -> None:
        resp = await client.post(
            "/auth/login",
            json={"username": "localuser", "password": "correct_password"},
        )
        token_str = resp.json()["access_token"]
        settings = get_settings()
        payload = jwt.decode(token_str, settings.SECRET_KEY, algorithms=["HS256"])
        assert payload["sub"] == "localuser"
        assert payload["org_id"] == local_user.organization_id
        assert payload["org_role"] == "member"

    async def test_admin_token_has_org_role_org_admin(
        self, client: httpx.AsyncClient, admin_user: User
    ) -> None:
        resp = await client.post(
            "/auth/login",
            json={"username": "adminuser", "password": "adminpass"},
        )
        assert resp.status_code == 200
        token_str = resp.json()["access_token"]
        settings = get_settings()
        payload = jwt.decode(token_str, settings.SECRET_KEY, algorithms=["HS256"])
        assert payload["org_role"] == "org_admin"


# ===========================================================================
# POST /auth/login/local
# ===========================================================================

class TestLoginLocal:

    async def test_local_login_works_without_ldap(
        self, client: httpx.AsyncClient, local_user: User
    ) -> None:
        resp = await client.post(
            "/auth/login/local",
            json={"username": "localuser", "password": "correct_password"},
        )
        assert resp.status_code == 200
        assert "access_token" in resp.json()

    async def test_wrong_password_returns_401(
        self, client: httpx.AsyncClient, local_user: User
    ) -> None:
        resp = await client.post(
            "/auth/login/local",
            json={"username": "localuser", "password": "bad"},
        )
        assert resp.status_code == 401


# ===========================================================================
# POST /auth/token (OAuth2 form)
# ===========================================================================

class TestLoginForm:

    async def test_form_login_works(
        self, client: httpx.AsyncClient, local_user: User
    ) -> None:
        resp = await client.post(
            "/auth/token",
            data={"username": "localuser", "password": "correct_password"},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        assert resp.status_code == 200
        assert "access_token" in resp.json()

    async def test_form_login_wrong_password_returns_401(
        self, client: httpx.AsyncClient, local_user: User
    ) -> None:
        resp = await client.post(
            "/auth/token",
            data={"username": "localuser", "password": "nope"},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        assert resp.status_code == 401


# ===========================================================================
# GET /auth/me
# ===========================================================================

class TestGetMe:

    async def test_returns_current_user_info(
        self, client: httpx.AsyncClient, test_org: Organization
    ) -> None:
        token_str = _admin_token(test_org.id)
        resp = await client.get(
            "/auth/me",
            headers={"Authorization": f"Bearer {token_str}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["username"] == "adminuser"
        assert data["org_id"] == test_org.id
        assert data["org_role"] == "org_admin"

    async def test_no_token_returns_403(
        self, client: httpx.AsyncClient
    ) -> None:
        resp = await client.get("/auth/me")
        assert resp.status_code == 403


# ===========================================================================
# POST /auth/users — create local user (admin only)
# ===========================================================================

class TestCreateUser:

    async def test_admin_can_create_user(
        self, client: httpx.AsyncClient, test_org: Organization
    ) -> None:
        token_str = _admin_token(test_org.id)
        resp = await client.post(
            "/auth/users",
            json={
                "username": "newuser",
                "email": "new@example.com",
                "password": "newpass123",
                "role": "member",
            },
            headers={"Authorization": f"Bearer {token_str}"},
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["username"] == "newuser"
        assert data["email"] == "new@example.com"
        assert data["is_ldap"] is False
        assert data["role"] == "member"
        assert data["organization_id"] == test_org.id
        # password_hash must NOT be in response
        assert "password_hash" not in data
        assert "password" not in data

    async def test_no_auth_returns_403(
        self, client: httpx.AsyncClient
    ) -> None:
        resp = await client.post(
            "/auth/users",
            json={
                "username": "x",
                "email": "x@example.com",
                "password": "pass",
            },
        )
        assert resp.status_code == 403

    async def test_non_admin_returns_403(
        self, client: httpx.AsyncClient, local_user: User
    ) -> None:
        # Get a token for the non-admin user
        login_resp = await client.post(
            "/auth/login",
            json={"username": "localuser", "password": "correct_password"},
        )
        token_str = login_resp.json()["access_token"]

        resp = await client.post(
            "/auth/users",
            json={
                "username": "dup",
                "email": "dup@example.com",
                "password": "pass",
            },
            headers={"Authorization": f"Bearer {token_str}"},
        )
        assert resp.status_code == 403

    async def test_duplicate_username_returns_409(
        self, client: httpx.AsyncClient, test_org: Organization, local_user: User
    ) -> None:
        token_str = _admin_token(test_org.id)
        resp = await client.post(
            "/auth/users",
            json={
                "username": "localuser",  # already exists
                "email": "other@example.com",
                "password": "pass",
            },
            headers={"Authorization": f"Bearer {token_str}"},
        )
        assert resp.status_code == 409

    async def test_created_user_can_log_in(
        self, client: httpx.AsyncClient, test_org: Organization
    ) -> None:
        token_str = _admin_token(test_org.id)
        # Create the user
        await client.post(
            "/auth/users",
            json={
                "username": "logintest",
                "email": "login@example.com",
                "password": "mypassword",
            },
            headers={"Authorization": f"Bearer {token_str}"},
        )
        # Now log in as that user
        resp = await client.post(
            "/auth/login",
            json={"username": "logintest", "password": "mypassword"},
        )
        assert resp.status_code == 200
        assert "access_token" in resp.json()


# ===========================================================================
# Auth enforcement on other endpoints
# ===========================================================================

class TestAuthEnforcement:
    """Spot-check that protected endpoints require auth."""

    async def test_list_projects_without_token_returns_403(
        self, client: httpx.AsyncClient
    ) -> None:
        resp = await client.get("/catalog/projects")
        assert resp.status_code == 403

    async def test_list_projects_with_valid_token_passes(
        self, client: httpx.AsyncClient, test_org: Organization
    ) -> None:
        token_str = _admin_token(test_org.id)
        resp = await client.get(
            "/catalog/projects",
            headers={"Authorization": f"Bearer {token_str}"},
        )
        # 200 (empty list is fine — just checking auth passes)
        assert resp.status_code == 200

    async def test_create_project_without_admin_returns_403(
        self, client: httpx.AsyncClient, test_org: Organization, local_user: User
    ) -> None:
        login_resp = await client.post(
            "/auth/login",
            json={"username": "localuser", "password": "correct_password"},
        )
        token_str = login_resp.json()["access_token"]
        resp = await client.post(
            "/catalog/projects",
            json={
                "organization_id": test_org.id,
                "name": "proj",
                "display_name": "Proj",
                "output_comment_style": "#",
            },
            headers={"Authorization": f"Bearer {token_str}"},
        )
        assert resp.status_code == 403
