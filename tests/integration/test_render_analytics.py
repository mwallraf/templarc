"""
Integration tests for render analytics endpoints (Phase 14).

Tests:
  - GET /admin/stats/renders-over-time → 200, series with date/total/errors
  - GET /admin/stats/renders-over-time?days=7 → series with <= 7 items
  - GET /admin/stats/top-templates → 200, items list
  - Non-admin → 403
"""

from __future__ import annotations

import pytest
import httpx
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from api.config import get_settings
from api.core.auth import TokenData, get_current_user, require_org_admin
from api.database import get_db
from api.main import app

_MOCK_ADMIN_TOKEN = TokenData(sub="testadmin", org_id="1", org_role="org_admin", is_platform_admin=True)
_MOCK_USER_TOKEN = TokenData(sub="testuser", org_id="1", org_role="member", is_platform_admin=False)


class _FlushOnCommitSession(AsyncSession):
    async def commit(self) -> None:  # type: ignore[override]
        await self.flush()


@pytest.fixture
async def admin_client() -> httpx.AsyncClient:
    settings = get_settings()
    engine = create_async_engine(settings.async_database_url, echo=False, pool_pre_ping=True)
    factory = async_sessionmaker(
        bind=engine,
        class_=_FlushOnCommitSession,
        expire_on_commit=False,
        autocommit=False,
        autoflush=False,
    )

    async def _db_override():
        async with factory() as session:
            yield session
            await session.rollback()

    app.dependency_overrides[get_db] = _db_override
    app.dependency_overrides[get_current_user] = lambda: _MOCK_ADMIN_TOKEN
    app.dependency_overrides[require_org_admin] = lambda: _MOCK_ADMIN_TOKEN

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
    ) as c:
        yield c

    app.dependency_overrides.clear()
    await engine.dispose()


@pytest.fixture
async def user_client() -> httpx.AsyncClient:
    settings = get_settings()
    engine = create_async_engine(settings.async_database_url, echo=False, pool_pre_ping=True)
    factory = async_sessionmaker(
        bind=engine,
        class_=_FlushOnCommitSession,
        expire_on_commit=False,
        autocommit=False,
        autoflush=False,
    )

    async def _db_override():
        async with factory() as session:
            yield session
            await session.rollback()

    app.dependency_overrides[get_db] = _db_override
    app.dependency_overrides[get_current_user] = lambda: _MOCK_USER_TOKEN
    # Do NOT override require_org_admin — let it reject the non-admin user

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
    ) as c:
        yield c

    app.dependency_overrides.clear()
    await engine.dispose()


@pytest.mark.asyncio
async def test_renders_over_time_default(admin_client: httpx.AsyncClient):
    """GET /admin/stats/renders-over-time returns 200 with correct structure."""
    resp = await admin_client.get("/admin/stats/renders-over-time")
    assert resp.status_code == 200
    data = resp.json()
    assert "days" in data
    assert "series" in data
    assert isinstance(data["series"], list)
    assert data["days"] == 30
    # Each item should have date, total, errors
    for item in data["series"]:
        assert "date" in item
        assert "total" in item
        assert "errors" in item


@pytest.mark.asyncio
async def test_renders_over_time_7_days(admin_client: httpx.AsyncClient):
    """With days=7, series has at most 7 items."""
    resp = await admin_client.get("/admin/stats/renders-over-time?days=7")
    assert resp.status_code == 200
    data = resp.json()
    assert data["days"] == 7
    assert len(data["series"]) <= 7


@pytest.mark.asyncio
async def test_top_templates(admin_client: httpx.AsyncClient):
    """GET /admin/stats/top-templates returns 200 with items list."""
    resp = await admin_client.get("/admin/stats/top-templates")
    assert resp.status_code == 200
    data = resp.json()
    assert "items" in data
    assert isinstance(data["items"], list)
    for item in data["items"]:
        assert "template_id" in item
        assert "display_name" in item
        assert "render_count" in item
        assert "error_count" in item


@pytest.mark.asyncio
async def test_renders_over_time_non_admin_forbidden(user_client: httpx.AsyncClient):
    """Non-admin gets 403 on analytics endpoints."""
    resp = await user_client.get("/admin/stats/renders-over-time")
    assert resp.status_code == 403
