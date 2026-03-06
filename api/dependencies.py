"""
Shared FastAPI dependency providers.

Centralised here so that multiple routers can import the same singletons
without creating duplicates or circular imports.
"""

from __future__ import annotations

from api.config import get_settings
from api.services.git_service import GitService

_git_service: GitService | None = None


def get_git_service() -> GitService:
    """
    Return a cached module-level GitService instance.

    Constructed on first call using TEMPLATES_REPO_PATH from settings.
    Thread-safe for reads; writes serialise naturally under Python's GIL.
    """
    global _git_service
    if _git_service is None:
        settings = get_settings()
        _git_service = GitService(settings.TEMPLATES_REPO_PATH)
    return _git_service
