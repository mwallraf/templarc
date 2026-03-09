"""Pydantic schemas for the system settings endpoints."""

from __future__ import annotations

from pydantic import BaseModel


class AISettingsSource(BaseModel):
    """Indicates whether each field comes from the DB override or the env fallback."""
    provider: str  # "db" | "env"
    api_key: str   # "db" | "env" | "none"
    model: str     # "db" | "env"
    base_url: str  # "db" | "env"


class AISettingsOut(BaseModel):
    """Effective AI settings as resolved (DB wins over env)."""
    provider: str
    model: str
    base_url: str
    api_key_configured: bool  # True if a key is available (from DB or env)
    source: AISettingsSource


class AISettingsUpdate(BaseModel):
    """
    Update AI settings stored in DB.

    Pass ``None`` to leave a field unchanged.
    Pass an empty string to clear the DB override (env fallback will be used).
    """
    provider: str | None = None
    api_key: str | None = None   # None = keep existing; "" = clear
    model: str | None = None
    base_url: str | None = None


class AITestResult(BaseModel):
    enabled: bool
    provider: str | None
    model: str | None
    error: str | None
