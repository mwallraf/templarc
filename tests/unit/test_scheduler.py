"""
Unit tests for api/core/scheduler.py — purge_old_render_history.

The SQL query already filters WHERE retention_days IS NOT NULL, so the
mock session only returns orgs that have a retention policy set.
All tests use a mocked DB session — no live database required.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from api.core.scheduler import purge_old_render_history


# ===========================================================================
# Helpers
# ===========================================================================

def _make_org(id_: int, retention_days: int) -> MagicMock:
    org = MagicMock()
    org.id = id_
    org.retention_days = retention_days
    return org


def _make_factory(orgs: list, delete_rowcount: int = 0):
    """Build a mock async_sessionmaker that returns a controlled session."""
    mock_session = AsyncMock()

    select_result = MagicMock()
    select_result.scalars.return_value.all.return_value = orgs

    delete_result = MagicMock()
    delete_result.rowcount = delete_rowcount

    mock_session.execute.side_effect = [select_result] + [delete_result] * len(orgs)

    factory = MagicMock()
    factory.return_value.__aenter__ = AsyncMock(return_value=mock_session)
    factory.return_value.__aexit__ = AsyncMock(return_value=False)

    return factory, mock_session


# ===========================================================================
# Tests
# ===========================================================================


@pytest.mark.asyncio
async def test_no_orgs_no_delete():
    """When no orgs are returned (none have retention_days set), no DELETE is issued."""
    factory, session = _make_factory([])

    await purge_old_render_history(factory)

    assert session.execute.call_count == 1
    session.commit.assert_called_once()


@pytest.mark.asyncio
async def test_single_org_issues_delete():
    """An org with retention_days=30 triggers SELECT + DELETE."""
    org = _make_org(42, 30)
    factory, session = _make_factory([org], delete_rowcount=5)

    await purge_old_render_history(factory)

    # SELECT orgs + DELETE old rows
    assert session.execute.call_count == 2
    session.commit.assert_called_once()


@pytest.mark.asyncio
async def test_multiple_orgs_multiple_deletes():
    """Two orgs with different retention_days each get their own DELETE."""
    orgs = [_make_org(1, 7), _make_org(2, 90)]
    factory, session = _make_factory(orgs, delete_rowcount=3)

    await purge_old_render_history(factory)

    # SELECT + 2 DELETE statements
    assert session.execute.call_count == 3
    session.commit.assert_called_once()


@pytest.mark.asyncio
async def test_zero_rows_deleted_no_error():
    """When no rows match the cutoff, rowcount=0, no error raised."""
    org = _make_org(10, 365)
    factory, session = _make_factory([org], delete_rowcount=0)

    await purge_old_render_history(factory)

    assert session.execute.call_count == 2
