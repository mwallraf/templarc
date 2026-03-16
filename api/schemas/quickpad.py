from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class QuickpadCreate(BaseModel):
    name: str = Field(..., max_length=200, description="Display name for the quickpad")
    description: str | None = Field(None, description="Optional description")
    body: str = Field("", description="Jinja2 template body")
    is_public: bool = Field(False, description="Visible to all org users when True; private to owner when False")


class QuickpadUpdate(BaseModel):
    name: str | None = Field(None, max_length=200)
    description: str | None = None
    body: str | None = None
    is_public: bool | None = None


class QuickpadOut(BaseModel):
    id: str
    name: str
    description: str | None
    body: str
    is_public: bool
    owner_username: str | None
    organization_id: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class QuickpadListOut(BaseModel):
    items: list[QuickpadOut]
    total: int


class QuickpadVariablesOut(BaseModel):
    variables: list[str]


class QuickpadRenderRequest(BaseModel):
    params: dict[str, str] = Field(default_factory=dict, description="Variable values keyed by variable name")


class QuickpadRenderOut(BaseModel):
    output: str
    variables_used: list[str]
