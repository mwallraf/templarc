"""Pydantic v2 schemas for the RenderWebhook endpoints."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


HttpMethod = Literal["POST", "PUT", "PATCH"]
TriggerOn = Literal["persist", "always"]
OnError = Literal["warn", "block"]


class RenderWebhookCreate(BaseModel):
    """Create a new render webhook."""

    name: str = Field(..., max_length=255, description="Human-readable label, e.g. 'Push to AWX'")
    is_active: bool = Field(True, description="Whether the webhook is active")

    # Scope — exactly one of project_id / template_id
    project_id: int | None = Field(None, description="Scope to all templates in this project")
    template_id: int | None = Field(None, description="Scope to a specific template")

    # Target
    url: str = Field(..., description="HTTP endpoint to POST/PUT/PATCH to")
    http_method: HttpMethod = Field("POST", description="HTTP verb: POST, PUT, or PATCH")

    # Auth
    auth_header: str | None = Field(
        None,
        description="Secret reference for Authorization header, e.g. 'secret:awx_token'. "
                    "Resolved value is sent as 'Authorization: Bearer <value>'.",
    )

    # Payload
    payload_template: str | None = Field(
        None,
        description="Jinja2 string rendered with the render context. "
                    "NULL uses the default JSON payload.",
    )

    # Behaviour
    trigger_on: TriggerOn = Field(
        "persist",
        description="'persist' fires only on real renders; 'always' fires on previews too",
    )
    on_error: OnError = Field(
        "warn",
        description="'warn' logs failure and continues; 'block' raises 502 on failure",
    )
    timeout_seconds: int = Field(10, ge=1, le=120, description="HTTP request timeout in seconds")

    @model_validator(mode="after")
    def validate_scope(self) -> "RenderWebhookCreate":
        if self.project_id is None and self.template_id is None:
            raise ValueError("Exactly one of project_id or template_id must be set")
        if self.project_id is not None and self.template_id is not None:
            raise ValueError("Only one of project_id or template_id may be set, not both")
        return self


class RenderWebhookUpdate(BaseModel):
    """Update fields on an existing webhook."""

    name: str | None = Field(None, max_length=255)
    is_active: bool | None = None
    url: str | None = None
    http_method: HttpMethod | None = None
    auth_header: str | None = None
    payload_template: str | None = None
    trigger_on: TriggerOn | None = None
    on_error: OnError | None = None
    timeout_seconds: int | None = Field(None, ge=1, le=120)


class RenderWebhookOut(BaseModel):
    """Webhook detail response."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    organization_id: int
    project_id: int | None
    template_id: int | None
    name: str
    is_active: bool
    url: str
    http_method: str
    auth_header: str | None
    payload_template: str | None
    trigger_on: str
    on_error: str
    timeout_seconds: int
    created_at: datetime
    updated_at: datetime


class RenderWebhookListOut(BaseModel):
    """Paginated list of webhooks."""

    model_config = ConfigDict(from_attributes=False)

    items: list[RenderWebhookOut]
    total: int


class WebhookTestResult(BaseModel):
    """Result of a /webhooks/{id}/test call."""

    model_config = ConfigDict(from_attributes=False)

    webhook_id: int
    success: bool
    status_code: int | None = None
    response_body: str | None = None
    error: str | None = None
