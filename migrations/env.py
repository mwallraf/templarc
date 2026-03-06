from __future__ import annotations

import asyncio
import sys
from logging.config import fileConfig
from pathlib import Path

# Ensure the project root is on sys.path so `api` package is importable
# regardless of the working directory alembic is invoked from.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from alembic import context
from sqlalchemy.ext.asyncio import create_async_engine

# ---------------------------------------------------------------------------
# Import settings + ALL models.
# Model imports are MANDATORY: they register all Table objects in
# Base.metadata, which is what --autogenerate compares against the DB.
# ---------------------------------------------------------------------------
from api.config import get_settings
from api.models import Base  # noqa: F401 — side-effect: loads all models

config = context.config

# Set up logging from alembic.ini
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# The desired target schema for --autogenerate comparisons
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """
    Run migrations in 'offline' mode (generate SQL script without a live DB).
    Used for: alembic upgrade --sql > migration.sql
    """
    settings = get_settings()
    context.configure(
        url=settings.async_database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection) -> None:
    """Inner migration runner — called with an active (sync-bridged) connection."""
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    """
    Run migrations in 'online' mode using an async engine.

    asyncpg is used exclusively — no psycopg2 needed.
    run_sync() bridges the async connection to Alembic's synchronous runner.
    """
    settings = get_settings()
    connectable = create_async_engine(settings.async_database_url, pool_pre_ping=True)

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
