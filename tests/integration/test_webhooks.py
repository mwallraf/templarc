"""
Integration tests for the Webhooks router.

Routes under test:
  GET    /webhooks              — list (filter ?project_id= or ?template_id=)
  POST   /webhooks              — create
  GET    /webhooks/{id}         — get single
  PUT    /webhooks/{id}         — update
  DELETE /webhooks/{id}         — delete
  POST   /webhooks/{id}/test    — fire a test dispatch

All endpoints require admin. All DB writes are rolled back after each test.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from api.config import get_settings
from api.core.auth import TokenData, get_current_user, require_admin
from api.database import get_db
from api.dependencies import get_git_service
from api.main import app
from api.models.organization import Organization
from api.models.project import Project
from api.models.render_webhook import RenderWebhook
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
    import uuid
    org = Organization(
        name=f"__webhook_test_org_{uuid.uuid4().hex[:8]}__",
        display_name="Webhook Test Org",
    )
    api_db.add(org)
    await api_db.flush()
    return org


@pytest.fixture
async def test_project(api_db: AsyncSession, test_org: Organization, git_repo: GitService) -> Project:
    proj = Project(
        organization_id=test_org.id,
        name="__webhook_test_proj__",
        display_name="Webhook Test Project",
        git_path="webhook_test",
        output_comment_style="#",
    )
    api_db.add(proj)
    await api_db.flush()
    git_repo.write_template("webhook_test/.gitkeep", "", message="init", author="test")
    return proj


@pytest.fixture
async def test_project2(api_db: AsyncSession, test_org: Organization, git_repo: GitService) -> Project:
    proj = Project(
        organization_id=test_org.id,
        name="__webhook_test_proj2__",
        display_name="Webhook Test Project 2",
        git_path="webhook_test2",
        output_comment_style="#",
    )
    api_db.add(proj)
    await api_db.flush()
    git_repo.write_template("webhook_test2/.gitkeep", "", message="init", author="test")
    return proj


@pytest.fixture
async def client(api_db: AsyncSession, git_repo: GitService, test_org: Organization) -> httpx.AsyncClient:
    """Client with DB override and require_admin overridden (admin access for all endpoints)."""

    async def override_get_db():
        yield api_db

    def override_admin() -> TokenData:
        return TokenData(sub="adminuser", org_id=test_org.id, is_admin=True)

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_git_service] = lambda: git_repo
    app.dependency_overrides[require_admin] = override_admin
    app.dependency_overrides[get_current_user] = override_admin

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as ac:
        yield ac

    app.dependency_overrides.clear()


# ===========================================================================
# TestWebhookCRUD
# ===========================================================================


class TestWebhookCRUD:

    async def test_create_webhook(
        self, client: httpx.AsyncClient, test_project: Project
    ) -> None:
        resp = await client.post(
            "/webhooks",
            json={
                "name": "Test Webhook",
                "url": "https://example.com/hook",
                "project_id": test_project.id,
                "is_active": True,
            },
        )
        assert resp.status_code == 201
        data = resp.json()
        assert "id" in data
        assert isinstance(data["id"], int)
        assert data["url"] == "https://example.com/hook"
        assert data["is_active"] is True
        assert data["project_id"] == test_project.id

    async def test_list_webhooks(
        self, client: httpx.AsyncClient, api_db: AsyncSession, test_org: Organization, test_project: Project
    ) -> None:
        webhook = RenderWebhook(
            organization_id=test_org.id,
            name="Listed Webhook",
            url="https://example.com/listed",
            project_id=test_project.id,
            template_id=None,
        )
        api_db.add(webhook)
        await api_db.flush()
        webhook_id = webhook.id

        resp = await client.get("/webhooks")
        assert resp.status_code == 200
        data = resp.json()
        ids = [item["id"] for item in data["items"]]
        assert webhook_id in ids

    async def test_get_webhook(
        self, client: httpx.AsyncClient, api_db: AsyncSession, test_org: Organization, test_project: Project
    ) -> None:
        webhook = RenderWebhook(
            organization_id=test_org.id,
            name="Get Single Webhook",
            url="https://example.com/single",
            project_id=test_project.id,
            template_id=None,
        )
        api_db.add(webhook)
        await api_db.flush()

        resp = await client.get(f"/webhooks/{webhook.id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == webhook.id
        assert data["name"] == "Get Single Webhook"

    async def test_update_webhook(
        self, client: httpx.AsyncClient, api_db: AsyncSession, test_org: Organization, test_project: Project
    ) -> None:
        webhook = RenderWebhook(
            organization_id=test_org.id,
            name="Before Update",
            url="https://example.com/update",
            is_active=True,
            project_id=test_project.id,
            template_id=None,
        )
        api_db.add(webhook)
        await api_db.flush()

        resp = await client.put(
            f"/webhooks/{webhook.id}",
            json={"is_active": False},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["is_active"] is False

    async def test_delete_webhook(
        self, client: httpx.AsyncClient, api_db: AsyncSession, test_org: Organization, test_project: Project
    ) -> None:
        webhook = RenderWebhook(
            organization_id=test_org.id,
            name="To Delete",
            url="https://example.com/delete",
            project_id=test_project.id,
            template_id=None,
        )
        api_db.add(webhook)
        await api_db.flush()
        webhook_id = webhook.id

        resp = await client.delete(f"/webhooks/{webhook_id}")
        assert resp.status_code == 204

        get_resp = await client.get(f"/webhooks/{webhook_id}")
        assert get_resp.status_code == 404

    async def test_get_nonexistent_returns_404(
        self, client: httpx.AsyncClient
    ) -> None:
        resp = await client.get("/webhooks/999999")
        assert resp.status_code == 404

    async def test_filter_by_project_id(
        self,
        client: httpx.AsyncClient,
        api_db: AsyncSession,
        test_org: Organization,
        test_project: Project,
        test_project2: Project,
    ) -> None:
        webhook_a = RenderWebhook(
            organization_id=test_org.id,
            name="Webhook A",
            url="https://example.com/a",
            project_id=test_project.id,
            template_id=None,
        )
        webhook_b = RenderWebhook(
            organization_id=test_org.id,
            name="Webhook B",
            url="https://example.com/b",
            project_id=test_project2.id,
            template_id=None,
        )
        api_db.add(webhook_a)
        api_db.add(webhook_b)
        await api_db.flush()

        resp = await client.get(f"/webhooks?project_id={test_project.id}")
        assert resp.status_code == 200
        data = resp.json()
        returned_ids = [item["id"] for item in data["items"]]
        assert webhook_a.id in returned_ids
        assert webhook_b.id not in returned_ids

    async def test_fire_test_dispatch(
        self, client: httpx.AsyncClient, api_db: AsyncSession, test_org: Organization, test_project: Project
    ) -> None:
        """POST /webhooks/{id}/test should call dispatch_test and return its result."""
        webhook = RenderWebhook(
            organization_id=test_org.id,
            name="Test Dispatch Webhook",
            url="https://example.com/test-dispatch",
            project_id=test_project.id,
            template_id=None,
        )
        api_db.add(webhook)
        await api_db.flush()

        mock_result = {
            "success": True,
            "status_code": 200,
            "response_body": "OK",
            "error": None,
        }

        with patch(
            "api.routers.webhooks.dispatch_test",
            new_callable=AsyncMock,
            return_value=mock_result,
        ) as mock_dispatch:
            resp = await client.post(f"/webhooks/{webhook.id}/test")

        assert resp.status_code == 200
        mock_dispatch.assert_called_once()

        data = resp.json()
        assert data["webhook_id"] == webhook.id
        assert data["success"] is True
        assert data["status_code"] == 200
