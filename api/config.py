"""
Application settings for Templarc, loaded via pydantic-settings.

This module is the single source of truth for all environment-variable
configuration. It sits at the bottom of the dependency stack — imported by
database.py, main.py, and service modules — so it must never import from
other api.* modules (circular import risk).

Key design decision: DATABASE_URL is stored in its raw form (which may be
the bare ``postgresql://`` dialect used by psql / MCP tooling). Two computed
properties derive the asyncpg and sync variants needed by SQLAlchemy and
Alembic respectively, so callers never have to do string manipulation themselves.

Usage:
    from api.config import get_settings
    settings = get_settings()  # cached singleton after first call
"""

from __future__ import annotations

from functools import lru_cache
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Application settings loaded from environment variables / .env file.

    DATABASE_URL may be in the bare postgresql:// form (used by the MCP
    PostgreSQL tool and by psycopg2-based tooling). The computed properties
    below convert it to the driver-qualified forms required by SQLAlchemy
    async and Alembic.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # --- Database -----------------------------------------------------------
    DATABASE_URL: str  # Required. Accepts any postgresql:// variant; see computed properties below.

    # --- Security -----------------------------------------------------------
    SECRET_KEY: str  # Required. Used to sign/verify JWT tokens.

    # --- Template storage ---------------------------------------------------
    TEMPLATES_REPO_PATH: str = "./templates_repo"  # Path to the Git repo containing .j2 files.

    # --- LDAP (Phase 6) -----------------------------------------------------
    LDAP_SERVER: str = ""         # e.g. "ldap://your-ldap-server". Empty string disables LDAP auth.
    LDAP_BASE_DN: str = ""        # e.g. "dc=company,dc=com"
    LDAP_ADMIN_GROUP: str = ""    # CN of the LDAP group that grants is_admin=True (e.g. "cn=admins,dc=company,dc=com")

    # --- CORS ---------------------------------------------------------------
    CORS_ORIGINS: List[str] = ["http://localhost:5173"]  # Vite dev server default; extend for prod.

    # --- Data source security -----------------------------------------------
    # When False, the datasource_resolver rejects URLs that resolve to RFC-1918
    # private addresses to prevent SSRF attacks against internal services.
    ALLOW_PRIVATE_DATASOURCE_URLS: bool = False

    # --- Seed data ----------------------------------------------------------
    # When True, the API populates the database with demo data on startup.
    # Idempotent — skipped silently if the seed organisation already exists.
    SEED_ON_STARTUP: bool = False

    # --- Email (Phase 13A) --------------------------------------------------
    SMTP_HOST: str = ""                          # Empty = email disabled
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = "noreply@templarc.io"
    FRONTEND_URL: str = "http://localhost:5173"  # Used to build password reset links

    # --- AI assistant -------------------------------------------------------
    # Provider: "anthropic" | "openai" | "" (empty = disabled)
    AI_PROVIDER: str = ""
    # API key for the selected provider.
    AI_API_KEY: str = ""
    # Model name (e.g. "claude-sonnet-4-6", "gpt-4o", "llama3").
    AI_MODEL: str = "claude-sonnet-4-6"
    # Base URL — used only for openai-compatible providers.
    # Default points to OpenAI; override for Azure, local Ollama, etc.
    AI_BASE_URL: str = "https://api.openai.com/v1"

    # --- Logging (Phase 14) -------------------------------------------------
    LOG_LEVEL: str = "INFO"   # DEBUG | INFO | WARNING | ERROR
    LOG_FORMAT: str = "text"  # "text" for human-readable, "json" for log aggregators
    LOG_FILE: str = ""        # Absolute path for rotating file output (empty = stdout only)

    # --- Observability (Phase 14) -------------------------------------------
    APP_VERSION: str = "dev"               # Override in Docker with env var
    AUDIT_LOG_RETENTION_DAYS: int | None = None  # None = keep forever

    # -------------------------------------------------------------------------
    # Computed URL properties
    # -------------------------------------------------------------------------

    @property
    def async_database_url(self) -> str:
        """
        Return a postgresql+asyncpg:// URL for the SQLAlchemy async engine.

        Handles all common input forms from .env:
          postgresql://...           → postgresql+asyncpg://...
          postgresql+asyncpg://...   → unchanged
          postgresql+psycopg2://...  → postgresql+asyncpg://...
        """
        url = self.DATABASE_URL
        if url.startswith("postgresql+"):
            # Strip existing driver qualifier and re-apply asyncpg
            rest = url[len("postgresql+"):]
            rest = rest[rest.index("://"):]  # "://host/..."
            return f"postgresql+asyncpg{rest}"
        if url.startswith("postgresql://"):
            return url.replace("postgresql://", "postgresql+asyncpg://", 1)
        raise ValueError(
            f"DATABASE_URL must start with 'postgresql://': got {url!r}"
        )

    @property
    def sync_database_url(self) -> str:
        """
        Return a bare postgresql:// URL for synchronous tooling (psql, etc.).
        The application itself uses async_database_url exclusively.
        """
        url = self.DATABASE_URL
        if url.startswith("postgresql+"):
            rest = url[len("postgresql+"):]
            rest = rest[rest.index("://"):]
            return f"postgresql{rest}"
        return url


@lru_cache
def get_settings() -> Settings:
    """
    Cached settings singleton. Use as a FastAPI dependency or import directly.

    Route usage:
        async def my_route(settings: Settings = Depends(get_settings)): ...

    Service usage:
        from api.config import get_settings
        settings = get_settings()
    """
    return Settings()
