"""
Shared fixtures for integration tests.

Integration tests require a running PostgreSQL database with Alembic migrations
applied. Configure DATABASE_URL in .env before running:

    uv run pytest tests/integration/ -v

Event-loop isolation: each test function in pytest-asyncio (0.25.x) gets its
own event loop by default. asyncpg connections are bound to a specific event
loop, so we create a fresh engine (and therefore fresh connection pool) per
test. This avoids "Future attached to different loop" errors while still
giving each test a clean, rollback-able transaction.
"""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from api.config import get_settings


@pytest.fixture(autouse=True)
def disable_rate_limits():
    """
    Disable the slowapi rate limiter for all integration tests.

    Without this, tests that call login or render endpoints multiple times
    within a minute would hit the per-IP / per-user limits and receive 429
    responses instead of the expected 200/401/403.
    """
    from api.core.rate_limit import limiter

    original = limiter.enabled
    limiter.enabled = False
    yield
    limiter.enabled = original


@pytest.fixture
async def db() -> AsyncSession:
    """
    Yield an AsyncSession backed by a fresh engine for this test.

    A new engine + connection pool is created for every test so that asyncpg
    connections are always bound to the current test's event loop. The session
    is rolled back (never committed) at teardown, keeping the live database
    unmodified.
    """
    settings = get_settings()
    engine = create_async_engine(
        settings.async_database_url,
        echo=False,
        pool_pre_ping=True,
    )
    factory = async_sessionmaker(
        bind=engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autocommit=False,
        autoflush=False,
    )

    async with factory() as session:
        yield session
        await session.rollback()

    await engine.dispose()
