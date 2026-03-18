from datetime import datetime

from pydantic import BaseModel, Field


class ApiKeyCreate(BaseModel):
    name: str = Field(..., max_length=200, description="Human-readable label for this key")
    role: str = Field("member", description="Org-level role: 'org_owner' | 'org_admin' | 'member'")
    expires_at: datetime | None = Field(None, description="Optional expiry (null = never)")


class ApiKeyOut(BaseModel):
    id: int
    name: str
    key_prefix: str
    role: str
    created_by: str | None
    last_used_at: datetime | None
    expires_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ApiKeyCreatedOut(ApiKeyOut):
    """Returned once at creation time only — includes the raw key value."""
    raw_key: str
