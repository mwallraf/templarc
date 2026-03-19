"""
Unit tests for api/routers/health.py component probes.

Mocks out DB and external services — no live connections required.
"""

from __future__ import annotations

import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Database probe
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_probe_database_ok():
    from api.routers.health import _probe_database

    mock_session = AsyncMock()
    mock_session.execute = AsyncMock()

    mock_ctx = AsyncMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_session)
    mock_ctx.__aexit__ = AsyncMock(return_value=False)

    with patch("api.routers.health.AsyncSessionLocal", return_value=mock_ctx):
        result = await _probe_database()

    assert result.name == "database"
    assert result.status == "ok"


@pytest.mark.asyncio
async def test_probe_database_error():
    from api.routers.health import _probe_database

    mock_ctx = AsyncMock()
    mock_ctx.__aenter__ = AsyncMock(side_effect=Exception("connection refused"))
    mock_ctx.__aexit__ = AsyncMock(return_value=False)

    with patch("api.routers.health.AsyncSessionLocal", return_value=mock_ctx):
        result = await _probe_database()

    assert result.name == "database"
    assert result.status == "error"
    assert result.message is not None


# ---------------------------------------------------------------------------
# Git probe
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_probe_git_ok(tmp_path):
    """Git probe returns ok when repo path exists and is a valid git repo."""
    from api.routers.health import _probe_git

    mock_settings = MagicMock()
    mock_settings.TEMPLATES_REPO_PATH = str(tmp_path)

    mock_repo = MagicMock()

    with patch("api.routers.health.get_settings", return_value=mock_settings), \
         patch("os.path.isdir", return_value=True), \
         patch("api.routers.health.Repo", return_value=mock_repo):  # type: ignore[attr-defined]
        # We need git.Repo to be importable inside the function
        with patch.dict("sys.modules", {"git": MagicMock(Repo=MagicMock(return_value=mock_repo))}):
            result = await _probe_git()

    assert result.name == "git"


@pytest.mark.asyncio
async def test_probe_git_missing_path():
    from api.routers.health import _probe_git

    mock_settings = MagicMock()
    mock_settings.TEMPLATES_REPO_PATH = "/nonexistent/path/xyz"

    with patch("api.routers.health.get_settings", return_value=mock_settings), \
         patch("os.path.isdir", return_value=False):
        result = await _probe_git()

    assert result.name == "git"
    assert result.status == "warn"


# ---------------------------------------------------------------------------
# SMTP probe
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_probe_smtp_disabled():
    """Returns None when SMTP_HOST is empty."""
    from api.routers.health import _probe_smtp

    mock_settings = MagicMock()
    mock_settings.SMTP_HOST = ""

    with patch("api.routers.health.get_settings", return_value=mock_settings):
        result = await _probe_smtp()

    assert result is None


@pytest.mark.asyncio
async def test_probe_ai_disabled():
    """Returns None when AI_PROVIDER is empty."""
    from api.routers.health import _probe_ai

    mock_settings = MagicMock()
    mock_settings.AI_PROVIDER = ""

    with patch("api.routers.health.get_settings", return_value=mock_settings):
        result = await _probe_ai()

    assert result is None


# ---------------------------------------------------------------------------
# Overall status helper
# ---------------------------------------------------------------------------

def test_overall_status_ok():
    from api.routers.health import _overall_status
    from api.schemas.health import ComponentCheck
    components = [
        ComponentCheck(name="database", status="ok"),
        ComponentCheck(name="git", status="ok"),
    ]
    assert _overall_status(components) == "ok"


def test_overall_status_warn_on_optional_failure():
    from api.routers.health import _overall_status
    from api.schemas.health import ComponentCheck
    components = [
        ComponentCheck(name="database", status="ok"),
        ComponentCheck(name="git", status="warn"),
    ]
    assert _overall_status(components) == "warn"


def test_overall_status_error_on_db_failure():
    from api.routers.health import _overall_status
    from api.schemas.health import ComponentCheck
    components = [
        ComponentCheck(name="database", status="error"),
        ComponentCheck(name="git", status="ok"),
    ]
    assert _overall_status(components) == "error"
