from datetime import datetime

from pydantic import BaseModel, Field


class ApiKeyCreate(BaseModel):
    name: str = Field(..., max_length=200, description="Human-readable label for this key")
    is_admin: bool = Field(False, description="Grant admin privileges to this key")
    expires_at: datetime | None = Field(None, description="Optional expiry (null = never)")


class ApiKeyOut(BaseModel):
    id: int
    name: str
    key_prefix: str
    is_admin: bool
    created_by: int | None
    last_used_at: datetime | None
    expires_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ApiKeyCreatedOut(ApiKeyOut):
    """Returned once at creation time only — includes the raw key value."""
    raw_key: str
