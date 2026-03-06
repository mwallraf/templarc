"""
Async SQLAlchemy engine and session management for Templarc.

This module creates the singleton async engine and session factory used by
every database-bound request. It also provides the ``get_db`` FastAPI
dependency that yields a managed session per request.

Architecture note: this module is imported directly by api/main.py (for
startup and the health endpoint) and injected into route handlers via
``Depends(get_db)``. Service classes receive the session as a constructor
argument rather than importing it directly, keeping services framework-agnostic.
"""

from __future__ import annotations

from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from api.config import get_settings

settings = get_settings()

# ---------------------------------------------------------------------------
# Async engine
# ---------------------------------------------------------------------------
# pool_pre_ping=True detects stale connections after DB restarts.
# echo=False in production; flip to True locally for query-level debugging.
# ---------------------------------------------------------------------------
engine = create_async_engine(
    settings.async_database_url,
    echo=False,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
)

# ---------------------------------------------------------------------------
# Session factory
# ---------------------------------------------------------------------------
# expire_on_commit=False is critical for async: after an async commit,
# SQLAlchemy must NOT try to lazy-refresh attributes (no active connection).
# ---------------------------------------------------------------------------
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


# ---------------------------------------------------------------------------
# FastAPI dependency
# ---------------------------------------------------------------------------
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    Yield a database session for use in FastAPI route dependencies.

        async def my_route(db: AsyncSession = Depends(get_db)):
            result = await db.execute(select(MyModel))

    Always rolls back on error and closes the session after the request.
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
