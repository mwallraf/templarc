"""Pydantic schemas for the AI assistant endpoint."""

from __future__ import annotations

from pydantic import BaseModel, Field


class AIGenerateRequest(BaseModel):
    """Request body for POST /ai/generate."""

    prompt: str = Field(..., description="Natural-language description of what to generate")
    registered_params: list[str] = Field(
        default_factory=list,
        description="Parameter names already registered for this template/feature",
    )
    custom_filters: list[str] = Field(
        default_factory=list,
        description="Custom Jinja2 filter names available in this project",
    )
    existing_body: str | None = Field(
        None,
        description="Current template body — provided for 'improve this' mode",
    )
