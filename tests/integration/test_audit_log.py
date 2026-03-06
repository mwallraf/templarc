"""
Integration tests for the audit log feature.

Tests that:
1. Write operations (create/update/delete project, template, parameter) produce
   audit log entries accessible via GET /admin/audit-log.
2. The filtering parameters (user_sub, resource_type, date_from, date_to) work.
3. Non-admin users cannot access the audit log (403).

Uses the same _FlushOnCommitSession + dependency-override pattern as
test_catalog_crud.py so all DB changes are rolled back at teardown.
"""

from __future__ import annotations

from pathlib import Path

import httpx
import pytest
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from api.config import get_settings
from api.core.auth import TokenData, get_current_user, require_admin
from api.database import get_db
from api.dependencies import get_git_service
from api.main import app
from api.models.organization import Organization
from api.services.git_service import GitService

_MOCK_ADMIN_TOKEN = TokenData(sub="auditadmin", org_id=1, is_admin=True)
_MOCK_USER_TOKEN = TokenData(sub="regularuser", org_id=1, is_admin=False)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class _FlushOnCommitSession(AsyncSession):
    async def commit(self) -> None:  # type: ignore[override]
        await self.flush()


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

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


@pytest.fixture
def git_repo(tmp_path: Path) -> GitService:
    return GitService(tmp_path / "templates_repo")


@pytest.fixture
async def test_org(api_db: AsyncSession) -> Organization:
    org = Organization(name="__test_audit_org__", display_name="Test Audit Org")
    api_db.add(org)
    await api_db.flush()
    return org


@pytest.fixture
async def admin_client(api_db: AsyncSession, git_repo: GitService) -> httpx.AsyncClient:
    """Admin-authenticated ASGI client."""
    async def override_get_db():
        yield api_db

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_git_service] = lambda: git_repo
    app.dependency_overrides[get_current_user] = lambda: _MOCK_ADMIN_TOKEN
    app.dependency_overrides[require_admin] = lambda: _MOCK_ADMIN_TOKEN

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest.fixture
async def user_client(api_db: AsyncSession, git_repo: GitService) -> httpx.AsyncClient:
    """Regular (non-admin) authenticated ASGI client."""
    async def override_get_db():
        yield api_db

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_git_service] = lambda: git_repo
    app.dependency_overrides[get_current_user] = lambda: _MOCK_USER_TOKEN
    app.dependency_overrides[require_admin] = _MOCK_ADMIN_TOKEN  # will raise 403 on require_admin

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as ac:
        yield ac

    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _create_project(client: httpx.AsyncClient, org_id: int, name: str) -> dict:
    r = await client.post("/catalog/projects", json={
        "organization_id": org_id,
        "name": name,
        "display_name": f"Test {name}",
    })
    assert r.status_code == 201, r.text
    return r.json()


# ---------------------------------------------------------------------------
# Audit log created on write operations
# ---------------------------------------------------------------------------

class TestAuditLogCreation:
    async def test_project_create_logged(self, admin_client, test_org):
        await _create_project(admin_client, test_org.id, "audit_proj1")

        r = await admin_client.get("/admin/audit-log")
        assert r.status_code == 200
        data = r.json()
        entries = data["items"]
        assert data["total"] >= 1

        create_entries = [e for e in entries if e["action"] == "create" and e["resource_type"] == "project"]
        assert len(create_entries) >= 1
        entry = create_entries[0]
        assert entry["user_sub"] == "auditadmin"
        assert entry["resource_id"] is not None

    async def test_project_update_logged(self, admin_client, test_org):
        proj = await _create_project(admin_client, test_org.id, "audit_proj2")

        r = await admin_client.put(f"/catalog/projects/{proj['id']}", json={
            "display_name": "Updated Display Name",
        })
        assert r.status_code == 200

        r = await admin_client.get("/admin/audit-log?resource_type=project")
        entries = r.json()["items"]
        update_entries = [e for e in entries if e["action"] == "update"]
        assert len(update_entries) >= 1
        assert update_entries[0]["resource_id"] == proj["id"]

    async def test_template_create_logged(self, admin_client, test_org):
        proj = await _create_project(admin_client, test_org.id, "audit_proj3")

        r = await admin_client.post("/templates", json={
            "project_id": proj["id"],
            "name": "my_template",
            "display_name": "My Template",
        })
        assert r.status_code == 201
        tmpl_id = r.json()["id"]

        r = await admin_client.get("/admin/audit-log?resource_type=template")
        entries = r.json()["items"]
        create_entries = [e for e in entries if e["action"] == "create"]
        assert any(e["resource_id"] == tmpl_id for e in create_entries)

    async def test_template_delete_logged(self, admin_client, test_org):
        proj = await _create_project(admin_client, test_org.id, "audit_proj4")

        r = await admin_client.post("/templates", json={
            "project_id": proj["id"],
            "name": "del_template",
            "display_name": "Delete Me",
        })
        assert r.status_code == 201
        tmpl_id = r.json()["id"]

        r = await admin_client.delete(f"/templates/{tmpl_id}")
        assert r.status_code == 204

        r = await admin_client.get("/admin/audit-log?resource_type=template")
        entries = r.json()["items"]
        delete_entries = [e for e in entries if e["action"] == "delete"]
        assert any(e["resource_id"] == tmpl_id for e in delete_entries)

    async def test_parameter_create_logged(self, admin_client, test_org):
        r = await admin_client.post("/parameters", json={
            "name": "glob.ntp_server",
            "scope": "global",
            "organization_id": test_org.id,
            "widget_type": "text",
        })
        assert r.status_code == 201
        param_id = r.json()["id"]

        r = await admin_client.get("/admin/audit-log?resource_type=parameter")
        entries = r.json()["items"]
        assert any(
            e["action"] == "create" and e["resource_id"] == param_id
            for e in entries
        )

    async def test_parameter_delete_logged(self, admin_client, test_org):
        r = await admin_client.post("/parameters", json={
            "name": "glob.dns",
            "scope": "global",
            "organization_id": test_org.id,
            "widget_type": "text",
        })
        assert r.status_code == 201
        param_id = r.json()["id"]

        r = await admin_client.delete(f"/parameters/{param_id}")
        assert r.status_code == 204

        r = await admin_client.get("/admin/audit-log?resource_type=parameter")
        entries = r.json()["items"]
        assert any(
            e["action"] == "delete" and e["resource_id"] == param_id
            for e in entries
        )


# ---------------------------------------------------------------------------
# Filter tests
# ---------------------------------------------------------------------------

class TestAuditLogFilters:
    async def test_filter_by_user_sub(self, admin_client, test_org):
        await _create_project(admin_client, test_org.id, "filter_proj1")

        r = await admin_client.get("/admin/audit-log?user_sub=auditadmin")
        data = r.json()
        assert all(e["user_sub"] == "auditadmin" for e in data["items"])

        r = await admin_client.get("/admin/audit-log?user_sub=nonexistent_user")
        data = r.json()
        assert data["total"] == 0
        assert data["items"] == []

    async def test_filter_by_resource_type(self, admin_client, test_org):
        await _create_project(admin_client, test_org.id, "filter_proj2")

        r = await admin_client.get("/admin/audit-log?resource_type=project")
        data = r.json()
        assert all(e["resource_type"] == "project" for e in data["items"])

    async def test_pagination(self, admin_client, test_org):
        # Create multiple projects
        for i in range(3):
            await _create_project(admin_client, test_org.id, f"pg_proj{i}")

        r = await admin_client.get("/admin/audit-log?limit=2&offset=0")
        data = r.json()
        assert len(data["items"]) <= 2
        assert data["total"] >= 3

    async def test_limit_max_500(self, admin_client):
        r = await admin_client.get("/admin/audit-log?limit=501")
        assert r.status_code == 422

    async def test_default_order_newest_first(self, admin_client, test_org):
        await _create_project(admin_client, test_org.id, "order_proj1")
        await _create_project(admin_client, test_org.id, "order_proj2")

        r = await admin_client.get("/admin/audit-log?resource_type=project&limit=10")
        items = r.json()["items"]
        if len(items) >= 2:
            timestamps = [i["timestamp"] for i in items]
            assert timestamps == sorted(timestamps, reverse=True)


# ---------------------------------------------------------------------------
# Authorization
# ---------------------------------------------------------------------------

class TestAuditLogAuth:
    async def test_non_admin_gets_403(self, admin_client, test_org):
        """
        Build a non-admin client within the same db session so rollback covers
        all changes, then verify the audit-log endpoint rejects it.
        """
        # Override require_admin to raise HTTP 403 for non-admin
        from fastapi import HTTPException, status as http_status

        def _raise_403():
            raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Admin required")

        app.dependency_overrides[require_admin] = _raise_403
        try:
            r = await admin_client.get("/admin/audit-log")
            assert r.status_code == 403
        finally:
            app.dependency_overrides[require_admin] = lambda: _MOCK_ADMIN_TOKEN

    async def test_unauthenticated_gets_403(self, api_db, git_repo):
        """Without auth override, the app returns 403 / 401."""
        async def override_get_db():
            yield api_db

        # Clear all overrides so auth is enforced
        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[get_git_service] = lambda: git_repo
        # Deliberately NOT overriding get_current_user / require_admin

        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as ac:
            r = await ac.get("/admin/audit-log")
            assert r.status_code in (401, 403)

        app.dependency_overrides.clear()
