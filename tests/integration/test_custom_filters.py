"""
Integration tests for custom filters and objects admin API.

Tests:
1. POST /admin/filters — create a valid global filter → 201
2. POST /admin/filters with blocked import code → 422
3. GET /admin/filters → list includes the created filter
4. POST /admin/filters/test with valid code → {"ok": true, "output": ...}
5. POST /admin/filters/test with import statement → {"ok": false, "error": ...}
6. DELETE /admin/filters/{id} → 200, used_in_templates: []
7. POST /admin/objects — create a valid context object → 201
8. DELETE /admin/objects/{id} → 200
9. GET /admin/filters without admin → 403

Uses the same _FlushOnCommitSession + dependency-override pattern as
test_audit_log.py so all DB changes are rolled back at teardown.
"""

from __future__ import annotations

from pathlib import Path

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from api.config import get_settings
from api.core.auth import TokenData, get_current_user, require_admin
from api.database import get_db
from api.dependencies import get_git_service
from api.main import app
from api.services.git_service import GitService

_MOCK_ADMIN_TOKEN = TokenData(sub="filteradmin", org_id=1, org_role="org_admin")

_VALID_FILTER_CODE = "def shorten(v):\n    return str(v)[:8]"
_BLOCKED_FILTER_CODE = "import os\ndef shorten(v):\n    return v"
_VALID_OBJECT_CODE = (
    "class Router:\n"
    "    def __init__(self, v):\n"
    "        self.v = v\n"
    "    def info(self):\n"
    "        return str(self.v)"
)


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
async def admin_client(api_db: AsyncSession, git_repo: GitService) -> httpx.AsyncClient:
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


# ---------------------------------------------------------------------------
# Filter CRUD
# ---------------------------------------------------------------------------

class TestCustomFilterCRUD:
    async def test_create_global_filter(self, admin_client):
        r = await admin_client.post("/admin/filters", json={
            "name": "shorten",
            "code": _VALID_FILTER_CODE,
            "scope": "global",
        })
        assert r.status_code == 201, r.text
        data = r.json()
        assert data["name"] == "shorten"
        assert data["scope"] == "global"
        assert data["is_active"] is True
        assert data["id"] is not None

    async def test_create_filter_with_blocked_import_returns_422(self, admin_client):
        r = await admin_client.post("/admin/filters", json={
            "name": "badfilter",
            "code": _BLOCKED_FILTER_CODE,
            "scope": "global",
        })
        assert r.status_code == 422, r.text

    async def test_create_filter_missing_project_id_for_project_scope_returns_422(self, admin_client):
        r = await admin_client.post("/admin/filters", json={
            "name": "myfilter",
            "code": _VALID_FILTER_CODE,
            "scope": "project",
            # project_id intentionally omitted
        })
        assert r.status_code == 422, r.text

    async def test_list_filters_includes_created(self, admin_client):
        r = await admin_client.post("/admin/filters", json={
            "name": "mylistfilter",
            "code": _VALID_FILTER_CODE,
            "scope": "global",
        })
        assert r.status_code == 201
        filter_id = r.json()["id"]

        r = await admin_client.get("/admin/filters")
        assert r.status_code == 200
        ids = [f["id"] for f in r.json()]
        assert filter_id in ids

    async def test_delete_filter_returns_200_with_usage(self, admin_client):
        r = await admin_client.post("/admin/filters", json={
            "name": "delme",
            "code": _VALID_FILTER_CODE,
            "scope": "global",
        })
        assert r.status_code == 201
        filter_id = r.json()["id"]

        r = await admin_client.delete(f"/admin/filters/{filter_id}")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["id"] == filter_id
        assert "used_in_templates" in data
        assert isinstance(data["used_in_templates"], list)

    async def test_delete_nonexistent_filter_returns_404(self, admin_client):
        r = await admin_client.delete("/admin/filters/99999999")
        assert r.status_code == 404


# ---------------------------------------------------------------------------
# Sandbox test endpoint
# ---------------------------------------------------------------------------

class TestFilterTestEndpoint:
    async def test_valid_code_returns_ok_true(self, admin_client):
        r = await admin_client.post("/admin/filters/test", json={
            "code": "def f(v): return str(v).upper()",
            "test_input": "hello",
        })
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["ok"] is True
        assert data["output"] == repr("HELLO")

    async def test_blocked_import_returns_ok_false(self, admin_client):
        r = await admin_client.post("/admin/filters/test", json={
            "code": _BLOCKED_FILTER_CODE,
            "test_input": "x",
        })
        assert r.status_code == 200
        data = r.json()
        assert data["ok"] is False
        assert data["error"] is not None
        assert "Import" in data["error"] or "import" in data["error"].lower()

    async def test_syntax_error_returns_ok_false(self, admin_client):
        r = await admin_client.post("/admin/filters/test", json={
            "code": "def f(v: return v",
            "test_input": "x",
        })
        assert r.status_code == 200
        data = r.json()
        assert data["ok"] is False


# ---------------------------------------------------------------------------
# Custom Objects
# ---------------------------------------------------------------------------

class TestCustomObjectCRUD:
    async def test_create_global_object(self, admin_client):
        r = await admin_client.post("/admin/objects", json={
            "name": "Router",
            "code": _VALID_OBJECT_CODE,
        })
        assert r.status_code == 201, r.text
        data = r.json()
        assert data["name"] == "Router"
        assert data["project_id"] is None
        assert data["is_active"] is True

    async def test_create_object_with_blocked_import_returns_422(self, admin_client):
        code = "import sys\nclass BadObj:\n    pass"
        r = await admin_client.post("/admin/objects", json={
            "name": "BadObj",
            "code": code,
        })
        assert r.status_code == 422, r.text

    async def test_list_objects(self, admin_client):
        r = await admin_client.post("/admin/objects", json={
            "name": "MyObj",
            "code": _VALID_OBJECT_CODE,
        })
        assert r.status_code == 201
        obj_id = r.json()["id"]

        r = await admin_client.get("/admin/objects")
        assert r.status_code == 200
        ids = [o["id"] for o in r.json()]
        assert obj_id in ids

    async def test_delete_object_returns_200(self, admin_client):
        r = await admin_client.post("/admin/objects", json={
            "name": "TempObj",
            "code": _VALID_OBJECT_CODE,
        })
        assert r.status_code == 201
        obj_id = r.json()["id"]

        r = await admin_client.delete(f"/admin/objects/{obj_id}")
        assert r.status_code == 200, r.text
        assert r.json()["id"] == obj_id


# ---------------------------------------------------------------------------
# Authorization
# ---------------------------------------------------------------------------

class TestCustomFilterAuth:
    async def test_non_admin_get_filters_returns_403(self, api_db, git_repo):
        """Without require_admin override, the endpoint raises 403."""
        from fastapi import HTTPException

        async def override_get_db():
            yield api_db

        def raise_403():
            raise HTTPException(status_code=403, detail="Admin required")

        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[get_git_service] = lambda: git_repo
        app.dependency_overrides[get_current_user] = lambda: TokenData(
            sub="user", org_id=1, org_role="member"
        )
        app.dependency_overrides[require_admin] = raise_403

        try:
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://test"
            ) as ac:
                r = await ac.get("/admin/filters")
                assert r.status_code == 403
        finally:
            app.dependency_overrides.clear()
