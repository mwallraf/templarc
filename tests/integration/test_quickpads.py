"""
Integration tests for the Quickpads router.

Routes under test:
  GET    /quickpads                  — list quickpads
  POST   /quickpads                  — create
  GET    /quickpads/{id}             — get one
  PUT    /quickpads/{id}             — update (owner or admin)
  DELETE /quickpads/{id}             — delete (owner or admin)
  GET    /quickpads/{id}/variables   — extract variable names
  POST   /quickpads/{id}/render      — render (always ephemeral)

All DB writes are rolled back after each test.
"""

from __future__ import annotations

import uuid
from pathlib import Path

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from api.config import get_settings
from api.core.auth import TokenData, get_current_user
from api.database import get_db
from api.dependencies import get_git_service
from api.main import app
from api.models.organization import Organization
from api.models.quickpad import Quickpad
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


@pytest.fixture
def git_repo(tmp_path: Path) -> GitService:
    return GitService(tmp_path / "templates_repo")


@pytest.fixture
async def test_org(api_db: AsyncSession) -> Organization:
    org = Organization(name=f"__quickpad_test_org_{uuid.uuid4().hex[:8]}__", display_name="Quickpad Test Org")
    api_db.add(org)
    await api_db.flush()
    return org


@pytest.fixture
async def test_quickpad(api_db: AsyncSession, test_org: Organization) -> Quickpad:
    """A public quickpad owned by 'testuser'."""
    pad = Quickpad(
        id=str(uuid.uuid4()),
        name="My Test Quickpad",
        description="A test quickpad",
        body="Hello {{ name }}",
        is_public=True,
        owner_username="testuser",
        organization_id=test_org.id,
    )
    api_db.add(pad)
    await api_db.flush()
    return pad


@pytest.fixture
async def client(api_db: AsyncSession, git_repo: GitService, test_org: Organization) -> httpx.AsyncClient:
    """Client with DB override and get_current_user overridden to 'testuser' (non-admin)."""

    async def override_get_db():
        yield api_db

    def override_current_user() -> TokenData:
        return TokenData(sub="testuser", org_id=test_org.id, org_role="member")

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_git_service] = lambda: git_repo
    app.dependency_overrides[get_current_user] = override_current_user

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as ac:
        yield ac

    app.dependency_overrides.clear()


# ===========================================================================
# TestQuickpadCRUD
# ===========================================================================


class TestQuickpadCRUD:

    async def test_create_quickpad(
        self, client: httpx.AsyncClient, test_org: Organization
    ) -> None:
        resp = await client.post(
            "/quickpads",
            json={
                "name": "My New Quickpad",
                "description": "Integration test quickpad",
                "body": "Hello {{ world }}",
                "is_public": False,
            },
        )
        assert resp.status_code == 201
        data = resp.json()
        assert "id" in data
        assert isinstance(data["id"], str)
        # organization_id is stored/returned as a UUID string
        assert isinstance(data["organization_id"], str)
        assert data["name"] == "My New Quickpad"
        assert data["owner_username"] == "testuser"

    async def test_list_quickpads(
        self, client: httpx.AsyncClient, test_quickpad: Quickpad
    ) -> None:
        resp = await client.get("/quickpads")
        assert resp.status_code == 200
        data = resp.json()
        ids = [item["id"] for item in data["items"]]
        assert test_quickpad.id in ids

    async def test_get_quickpad(
        self, client: httpx.AsyncClient, test_quickpad: Quickpad
    ) -> None:
        resp = await client.get(f"/quickpads/{test_quickpad.id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == test_quickpad.id
        assert data["name"] == test_quickpad.name

    async def test_update_quickpad(
        self, client: httpx.AsyncClient, test_quickpad: Quickpad
    ) -> None:
        resp = await client.put(
            f"/quickpads/{test_quickpad.id}",
            json={"name": "Updated Name"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Updated Name"

    async def test_delete_quickpad(
        self, client: httpx.AsyncClient, api_db: AsyncSession, test_org: Organization
    ) -> None:
        # Create a quickpad to delete (don't use test_quickpad fixture since other
        # tests may still reference it)
        pad = Quickpad(
            id=str(uuid.uuid4()),
            name="Quickpad To Delete",
            body="deleteme",
            is_public=True,
            owner_username="testuser",
            organization_id=test_org.id,
        )
        api_db.add(pad)
        await api_db.flush()
        pad_id = pad.id

        resp = await client.delete(f"/quickpads/{pad_id}")
        assert resp.status_code == 204

        # Verify it's gone
        get_resp = await client.get(f"/quickpads/{pad_id}")
        assert get_resp.status_code == 404

    async def test_get_variables(
        self, client: httpx.AsyncClient, api_db: AsyncSession, test_org: Organization
    ) -> None:
        pad = Quickpad(
            id=str(uuid.uuid4()),
            name="Variables Quickpad",
            body="{{ foo }} {{ bar }}",
            is_public=True,
            owner_username="testuser",
            organization_id=test_org.id,
        )
        api_db.add(pad)
        await api_db.flush()

        resp = await client.get(f"/quickpads/{pad.id}/variables")
        assert resp.status_code == 200
        data = resp.json()
        variables = data["variables"]
        assert "foo" in variables
        assert "bar" in variables

    async def test_render_quickpad(
        self, client: httpx.AsyncClient, api_db: AsyncSession, test_org: Organization
    ) -> None:
        pad = Quickpad(
            id=str(uuid.uuid4()),
            name="Render Quickpad",
            body="Hello {{ greeting }}",
            is_public=True,
            owner_username="testuser",
            organization_id=test_org.id,
        )
        api_db.add(pad)
        await api_db.flush()

        resp = await client.post(
            f"/quickpads/{pad.id}/render",
            json={"params": {"greeting": "world"}},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["output"] == "Hello world"

    async def test_render_missing_variable_renders_empty(
        self, client: httpx.AsyncClient, api_db: AsyncSession, test_org: Organization
    ) -> None:
        pad = Quickpad(
            id=str(uuid.uuid4()),
            name="Missing Var Quickpad",
            body="{{ missing }}",
            is_public=True,
            owner_username="testuser",
            organization_id=test_org.id,
        )
        api_db.add(pad)
        await api_db.flush()

        resp = await client.post(
            f"/quickpads/{pad.id}/render",
            json={"params": {}},
        )
        assert resp.status_code == 200
        data = resp.json()
        # Jinja2 Undefined renders as empty string
        assert data["output"] == ""

    async def test_other_user_cannot_edit(
        self, client: httpx.AsyncClient, api_db: AsyncSession, test_org: Organization
    ) -> None:
        """A quickpad owned by 'testuser' cannot be updated by 'otheruser' (non-admin)."""
        # Create a private quickpad owned by testuser
        pad = Quickpad(
            id=str(uuid.uuid4()),
            name="Testuser Private Pad",
            body="secret content",
            is_public=True,  # public so otheruser can see it
            owner_username="testuser",
            organization_id=test_org.id,
        )
        api_db.add(pad)
        await api_db.flush()
        pad_id = pad.id

        # Override get_current_user to return otheruser (non-admin)
        def override_other_user() -> TokenData:
            return TokenData(sub="otheruser", org_id=test_org.id, org_role="member")

        app.dependency_overrides[get_current_user] = override_other_user

        try:
            resp = await client.put(
                f"/quickpads/{pad_id}",
                json={"name": "Hijacked Name"},
            )
        finally:
            # Restore the original testuser override from the client fixture
            def restore_testuser() -> TokenData:
                return TokenData(sub="testuser", org_id=test_org.id, org_role="member")

            app.dependency_overrides[get_current_user] = restore_testuser

        assert resp.status_code == 403
