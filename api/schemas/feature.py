"""Pydantic v2 schemas for the Feature endpoints."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Feature parameter (sub-schema)
# ---------------------------------------------------------------------------

class FeatureParameterOut(BaseModel):
    """A parameter belonging to a feature."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    widget_type: str
    label: str | None
    description: str | None
    help_text: str | None
    default_value: str | None
    required: bool
    sort_order: int
    is_active: bool
    is_derived: bool
    derived_expression: str | None = None
    validation_regex: str | None = None
    options: list[dict] = Field(default_factory=list)


class FeatureParameterCreate(BaseModel):
    """Create a parameter scoped to a feature."""
    name: str = Field(..., description="Variable name (dot-notation, e.g. snmp.community)")
    widget_type: str = Field("text", description="Widget type for the render form")
    label: str | None = None
    description: str | None = None
    help_text: str | None = None
    default_value: str | None = None
    required: bool = False
    validation_regex: str | None = None
    is_derived: bool = False
    derived_expression: str | None = None
    sort_order: int = 0


class FeatureParameterUpdate(BaseModel):
    """Update a feature parameter."""
    widget_type: str | None = None
    label: str | None = None
    description: str | None = None
    help_text: str | None = None
    default_value: str | None = None
    required: bool | None = None
    validation_regex: str | None = None
    is_derived: bool | None = None
    derived_expression: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None


# ---------------------------------------------------------------------------
# Feature CRUD
# ---------------------------------------------------------------------------

class FeatureCreate(BaseModel):
    """Create a new feature."""
    project_id: int = Field(..., description="Project this feature belongs to")
    name: str = Field(..., max_length=100, description="Slug-style identifier (e.g. snmp_monitoring)")
    label: str = Field(..., max_length=255, description="Human-readable label shown in the render form")
    description: str | None = None
    sort_order: int = 0


class FeatureUpdate(BaseModel):
    """Update a feature's metadata."""
    label: str | None = Field(None, max_length=255)
    description: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class FeatureBodyUpdate(BaseModel):
    """Write or replace a feature's Jinja2 snippet body in Git."""
    body: str = Field(..., description="Jinja2 snippet body (no frontmatter)")
    commit_message: str = Field("Update feature snippet", description="Git commit message")
    author: str = Field("Templarc", description="Git author string")


class FeatureOut(BaseModel):
    """Feature detail with parameters."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    name: str
    label: str
    description: str | None
    snippet_path: str | None
    sort_order: int
    is_active: bool
    created_at: datetime
    updated_at: datetime
    parameters: list[FeatureParameterOut] = Field(default_factory=list)


class FeatureListOut(BaseModel):
    """Paginated list of features."""
    model_config = ConfigDict(from_attributes=False)

    items: list[FeatureOut]
    total: int


# ---------------------------------------------------------------------------
# Template ↔ Feature attachment
# ---------------------------------------------------------------------------

class TemplateFeatureOut(BaseModel):
    """An attachment record linking a template to a feature."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    template_id: int
    feature_id: int
    is_default: bool
    sort_order: int
    feature: FeatureOut


class TemplateFeatureUpdate(BaseModel):
    """Update the is_default / sort_order for an attached feature."""
    is_default: bool | None = None
    sort_order: int | None = None
