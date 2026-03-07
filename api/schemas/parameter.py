"""Pydantic v2 schemas for the Parameter and ParameterOption resources."""

from __future__ import annotations

import re
from datetime import datetime
from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field, field_validator

from api.models.parameter import ParameterScope, WidgetType

T = TypeVar("T")


# ---------------------------------------------------------------------------
# Generic pagination wrapper
# ---------------------------------------------------------------------------

class PaginatedResponse(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int
    pages: int


# ---------------------------------------------------------------------------
# ParameterOption schemas
# ---------------------------------------------------------------------------

class ParameterOptionCreate(BaseModel):
    value: str = Field(..., max_length=500)
    label: str = Field(..., max_length=255)
    condition_param: str | None = Field(None, max_length=200)
    condition_value: str | None = Field(None, max_length=500)
    sort_order: int = 0


class ParameterOptionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    parameter_id: int
    value: str
    label: str
    condition_param: str | None
    condition_value: str | None
    sort_order: int


# ---------------------------------------------------------------------------
# Parameter schemas
# ---------------------------------------------------------------------------

_PARAM_NAME_RE = re.compile(
    r"^(glob|proj)?\.?[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$"
)


class ParameterCreate(BaseModel):
    model_config = ConfigDict(json_schema_extra={
        "examples": [
            {
                "name": "router.hostname",
                "scope": "template",
                "template_id": 5,
                "widget_type": "text",
                "label": "Router Hostname",
                "description": "Fully qualified domain name of the router",
                "required": True,
                "sort_order": 0,
            },
            {
                "name": "glob.ntp_server",
                "scope": "global",
                "organization_id": 1,
                "widget_type": "text",
                "label": "NTP Server",
                "default_value": "ntp.company.com",
                "required": False,
                "sort_order": 0,
            },
        ]
    })

    name: str = Field(..., max_length=200)
    scope: ParameterScope

    @field_validator("name")
    @classmethod
    def validate_parameter_name(cls, v: str) -> str:
        if not _PARAM_NAME_RE.match(v):
            raise ValueError(
                "Parameter name must match "
                r"^(glob|proj)?\.?[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$"
            )
        return v
    # Exactly one of these must be set, determined by scope
    organization_id: int | None = None
    project_id: int | None = None
    template_id: int | None = None

    widget_type: WidgetType = WidgetType.text
    label: str | None = Field(None, max_length=255)
    description: str | None = None
    help_text: str | None = None
    default_value: str | None = None
    required: bool = False
    validation_regex: str | None = Field(None, max_length=500)
    is_derived: bool = False
    derived_expression: str | None = None
    sort_order: int = 0
    section: str | None = Field(None, max_length=100)
    visible_when: dict | None = None


class ParameterUpdate(BaseModel):
    """All fields optional — only provided fields are updated."""
    widget_type: WidgetType | None = None
    label: str | None = Field(None, max_length=255)
    description: str | None = None
    help_text: str | None = None
    default_value: str | None = None
    required: bool | None = None
    validation_regex: str | None = Field(None, max_length=500)
    is_derived: bool | None = None
    derived_expression: str | None = None
    sort_order: int | None = None
    section: str | None = Field(None, max_length=100)
    visible_when: dict | None = None


class ParameterOut(BaseModel):
    model_config = ConfigDict(from_attributes=True, json_schema_extra={
        "examples": [{
            "id": 12,
            "name": "router.hostname",
            "scope": "template",
            "organization_id": None,
            "project_id": None,
            "template_id": 5,
            "widget_type": "text",
            "label": "Router Hostname",
            "description": "Fully qualified domain name of the router",
            "help_text": "e.g. edge-01.dc.company.com",
            "default_value": None,
            "required": True,
            "validation_regex": None,
            "is_derived": False,
            "derived_expression": None,
            "sort_order": 0,
            "is_active": True,
            "created_at": "2024-01-15T09:00:00Z",
            "updated_at": "2024-01-15T09:00:00Z",
            "options": [],
        }]
    })

    id: int
    name: str
    scope: ParameterScope
    organization_id: int | None
    project_id: int | None
    template_id: int | None

    widget_type: WidgetType
    label: str | None
    description: str | None
    help_text: str | None
    default_value: str | None
    required: bool
    validation_regex: str | None
    is_derived: bool
    derived_expression: str | None
    sort_order: int
    is_active: bool
    section: str | None
    visible_when: dict | None

    created_at: datetime
    updated_at: datetime

    options: list[ParameterOptionOut] = []
