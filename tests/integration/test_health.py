"""
Integration tests for GET /health and GET /health/detail endpoints.

Tests verify:
  - GET /health returns 200 with status + version + uptime_seconds (no auth)
  - GET /health/detail returns 200 for authenticated admin
  - GET /health/detail returns 401/403 for anonymous access
  - DB component is present and 'ok' when the test DB is reachable
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


class _FlushOnCommitSession(AsyncSession):
    async def commit(self) -> None:  # type: ignore[override]
        await self.flush()


@pytest.fixture
async def client() -> httpx.AsyncClient:
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


@pytest.mark.asyncio
async def test_health_summary_public(client: httpx.AsyncClient):
    """GET /health returns 200 with status, version, uptime_seconds — no auth needed."""
    resp = await client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert "status" in data
    assert "version" in data
    assert "uptime_seconds" in data
    # Should NOT have components list in summary
    assert "components" not in data


@pytest.mark.asyncio
async def test_health_detail_admin(client: httpx.AsyncClient):
    """GET /health/detail returns 200 for admin with component list."""
    resp = await client.get("/health/detail")
    assert resp.status_code == 200
    data = resp.json()
    assert "status" in data
    assert "components" in data
    assert isinstance(data["components"], list)
    assert len(data["components"]) >= 1
    # Database component should be present and ok
    db_comp = next((c for c in data["components"] if c["name"] == "database"), None)
    assert db_comp is not None
    assert db_comp["status"] == "ok"


@pytest.mark.asyncio
async def test_health_detail_unauthenticated():
    """GET /health/detail returns 401/403 for unauthenticated requests."""
    # Don't use the client fixture — no auth overrides
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
    ) as c:
        resp = await c.get("/health/detail")
    assert resp.status_code in (401, 403)
