"""Pydantic v2 schemas for the rendering pipeline endpoints."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------

class RenderRequest(BaseModel):
    """Body for POST /templates/{id}/render."""
    model_config = ConfigDict(from_attributes=False, json_schema_extra={
        "examples": [{
            "params": {
                "router.hostname": "edge-01.dc.company.com",
                "router.loopback": "10.0.0.1",
                "router.site_id": "42",
            },
            "notes": "Production render for edge-01",
        }]
    })

    params: dict[str, Any] = Field(
        default_factory=dict,
        description=(
            "Template-local parameter values keyed by flat dot-notation name "
            "(e.g. 'router.hostname'). glob.* and proj.* keys are ignored."
        ),
    )
    notes: str | None = Field(None, description="Optional freeform render notes stored in history")


class OnChangeRequest(BaseModel):
    """Body for POST /templates/{id}/on-change/{param_name}."""
    current_params: dict[str, Any] = Field(
        default_factory=dict,
        description="Current form state — all param values known so far",
    )


class ReRenderRequest(BaseModel):
    """Body for POST /render-history/{id}/re-render."""
    template_id: int | None = Field(
        None,
        description=(
            "Override the original template. Useful for testing the same params "
            "against a new template version. Defaults to the original template."
        ),
    )
    notes: str | None = None
    persist: bool = True


# ---------------------------------------------------------------------------
# Enriched parameter (used in FormDefinitionOut)
# ---------------------------------------------------------------------------

class EnrichedParameterOut(BaseModel):
    """A resolved parameter enriched with any data-source prefills/options."""
    model_config = ConfigDict(from_attributes=False)

    name: str
    scope: str
    widget_type: str
    label: str | None
    description: str | None
    help_text: str | None
    default_value: str | None
    required: bool
    sort_order: int
    is_derived: bool

    # Enrichments from data sources
    prefill: Any | None = None
    options: list[dict] = Field(default_factory=list)
    readonly: bool = False
    source_id: str | None = None


# ---------------------------------------------------------------------------
# Form definition (resolve-params response)
# ---------------------------------------------------------------------------

class FormDefinitionOut(BaseModel):
    """Response from GET /templates/{id}/resolve-params."""
    model_config = ConfigDict(from_attributes=False)

    template_id: int
    parameters: list[EnrichedParameterOut]
    inheritance_chain: list[str]


# ---------------------------------------------------------------------------
# Render result
# ---------------------------------------------------------------------------

class RenderOut(BaseModel):
    """Response from POST /templates/{id}/render."""
    model_config = ConfigDict(from_attributes=False, json_schema_extra={
        "examples": [{
            "output": "! Rendered by admin at 2024-01-15T10:30:00Z\n! Template: cisco_891\nhostname edge-01.dc.company.com\n",
            "render_id": 42,
            "template_id": 5,
            "git_sha": "a1b2c3d4e5f6789012345678901234567890abcd",
        }]
    })

    output: str = Field(description="Full rendered output including the metadata header")
    render_id: int | None = Field(
        None,
        description="ID of the stored RenderHistory record; None when persist=false",
    )
    template_id: int
    git_sha: str


# ---------------------------------------------------------------------------
# Render history
# ---------------------------------------------------------------------------

class RenderHistoryOut(BaseModel):
    """A render history record."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    template_id: int | None
    template_git_sha: str
    resolved_parameters: dict
    raw_output: str
    rendered_by: int | None
    rendered_at: datetime
    notes: str | None


class RenderHistoryListOut(BaseModel):
    """Paginated list of render history records."""
    model_config = ConfigDict(from_attributes=False)

    items: list[RenderHistoryOut]
    total: int
