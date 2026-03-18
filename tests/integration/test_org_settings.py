"""
Integration tests for org settings and stats endpoints:
  GET  /admin/org
  PATCH /admin/org
  GET  /admin/stats

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

from api.config import get_settings
from api.core.auth import TokenData, get_current_user, require_admin, require_org_admin
from api.database import get_db
from api.dependencies import get_git_service
from api.main import app
from api.models.organization import Organization
from api.models.user import User
from api.services.git_service import GitService


# ===========================================================================
# Fixtures
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
    settings = get_settings()
    monkeypatch.setattr(settings, "LDAP_SERVER", "")


@pytest.fixture
def git_repo(tmp_path: Path) -> GitService:
    return GitService(tmp_path / "templates_repo")


@pytest.fixture
async def test_org(api_db: AsyncSession) -> Organization:
    org = Organization(name="__orgsettings_test__", display_name="OrgSettings Test")
    api_db.add(org)
    await api_db.flush()
    return org


@pytest.fixture
async def org_admin_user(api_db: AsyncSession, test_org: Organization) -> User:
    user = User(
        organization_id=test_org.id,
        username="orgsettings_admin",
        email="orgsettings_admin@example.com",
        role="org_admin",
        is_ldap=False,
        password_hash=_bcrypt.hashpw(b"adminpass", _bcrypt.gensalt()).decode(),
    )
    api_db.add(user)
    await api_db.flush()
    return user


@pytest.fixture
async def member_user(api_db: AsyncSession, test_org: Organization) -> User:
    user = User(
        organization_id=test_org.id,
        username="orgsettings_member",
        email="orgsettings_member@example.com",
        role="member",
        is_ldap=False,
        password_hash=_bcrypt.hashpw(b"memberpass", _bcrypt.gensalt()).decode(),
    )
    api_db.add(user)
    await api_db.flush()
    return user


@pytest.fixture
async def admin_client(api_db: AsyncSession, git_repo: GitService, test_org: Organization, org_admin_user: User) -> httpx.AsyncClient:
    """Client pre-authenticated as org_admin."""
    async def override_get_db():
        yield api_db

    async def override_auth():
        return TokenData(sub=org_admin_user.username, org_id=test_org.id, org_role="org_admin", is_platform_admin=False)

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_git_service] = lambda: git_repo
    app.dependency_overrides[get_current_user] = override_auth
    app.dependency_overrides[require_org_admin] = override_auth

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest.fixture
async def member_client(api_db: AsyncSession, git_repo: GitService, test_org: Organization, member_user: User) -> httpx.AsyncClient:
    """Client pre-authenticated as a regular member (no org_admin)."""
    async def override_get_db():
        yield api_db

    async def override_auth():
        return TokenData(sub=member_user.username, org_id=test_org.id, org_role="member", is_platform_admin=False)

    async def deny_org_admin():
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Forbidden")

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_git_service] = lambda: git_repo
    app.dependency_overrides[get_current_user] = override_auth
    app.dependency_overrides[require_org_admin] = deny_org_admin

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as ac:
        yield ac

    app.dependency_overrides.clear()


# ===========================================================================
# GET /admin/org
# ===========================================================================


class TestGetOrgSettings:

    async def test_returns_200_for_admin(self, admin_client: httpx.AsyncClient) -> None:
        resp = await admin_client.get("/admin/org")
        assert resp.status_code == 200
        data = resp.json()
        assert "timezone" in data

    async def test_defaults_timezone_utc(self, admin_client: httpx.AsyncClient) -> None:
        resp = await admin_client.get("/admin/org")
        assert resp.status_code == 200
        assert resp.json()["timezone"] == "UTC"

    async def test_forbidden_for_non_admin(self, member_client: httpx.AsyncClient) -> None:
        resp = await member_client.get("/admin/org")
        assert resp.status_code == 403


# ===========================================================================
# PATCH /admin/org
# ===========================================================================


class TestPatchOrgSettings:

    async def test_updates_display_name(self, admin_client: httpx.AsyncClient) -> None:
        resp = await admin_client.patch(
            "/admin/org",
            json={"display_name": "My Custom Org Name"},
        )
        assert resp.status_code == 200
        assert resp.json()["display_name"] == "My Custom Org Name"

    async def test_updates_timezone(self, admin_client: httpx.AsyncClient) -> None:
        resp = await admin_client.patch("/admin/org", json={"timezone": "Europe/Paris"})
        assert resp.status_code == 200
        assert resp.json()["timezone"] == "Europe/Paris"

    async def test_updates_retention_days(self, admin_client: httpx.AsyncClient) -> None:
        resp = await admin_client.patch("/admin/org", json={"retention_days": 90})
        assert resp.status_code == 200
        assert resp.json()["retention_days"] == 90

    async def test_clears_retention_days(self, admin_client: httpx.AsyncClient) -> None:
        await admin_client.patch("/admin/org", json={"retention_days": 30})
        resp = await admin_client.patch("/admin/org", json={"retention_days": None})
        assert resp.status_code == 200
        assert resp.json()["retention_days"] is None

    async def test_get_reflects_patch(self, admin_client: httpx.AsyncClient) -> None:
        await admin_client.patch("/admin/org", json={"display_name": "Patched Name"})
        resp = await admin_client.get("/admin/org")
        assert resp.json()["display_name"] == "Patched Name"

    async def test_forbidden_for_non_admin(self, member_client: httpx.AsyncClient) -> None:
        resp = await member_client.patch("/admin/org", json={"timezone": "UTC"})
        assert resp.status_code == 403


# ===========================================================================
# GET /admin/stats
# ===========================================================================


class TestGetOrgStats:

    async def test_returns_200_with_all_keys(self, admin_client: httpx.AsyncClient) -> None:
        resp = await admin_client.get("/admin/stats")
        assert resp.status_code == 200
        data = resp.json()
        expected_keys = {
            "users_total",
            "projects_total",
            "templates_total",
            "renders_total",
            "renders_last_30d",
            "renders_last_7d",
            "api_keys_active",
            "storage_templates_count",
        }
        assert expected_keys.issubset(data.keys())

    async def test_all_values_non_negative(self, admin_client: httpx.AsyncClient) -> None:
        resp = await admin_client.get("/admin/stats")
        assert resp.status_code == 200
        for key, val in resp.json().items():
            assert val >= 0, f"{key} should be >= 0, got {val}"

    async def test_forbidden_for_non_admin(self, member_client: httpx.AsyncClient) -> None:
        resp = await member_client.get("/admin/stats")
        assert resp.status_code == 403
