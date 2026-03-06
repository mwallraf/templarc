"""
Pydantic v2 schemas for admin / maintenance endpoints.

Currently covers:
  SyncReport           — returned by POST /admin/git-sync/{project_id}
  SyncStatusReport     — returned by GET  /admin/git-sync/{project_id}/status
  AuditLogOut          — single audit log entry
  AuditLogListOut      — paginated audit log list (GET /admin/audit-log)
  CustomFilterCreate   — POST /admin/filters request body
  CustomFilterOut      — single custom filter response
  CustomFilterDeleteOut — DELETE /admin/filters/{id} response (with usage warning)
  FilterTestRequest    — POST /admin/filters/test request body
  FilterTestResult     — POST /admin/filters/test response
  CustomObjectCreate   — POST /admin/objects request body
  CustomObjectOut      — single custom object response
  CustomObjectDeleteOut — DELETE /admin/objects/{id} response
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


# ---------------------------------------------------------------------------
# Git sync — import report
# ---------------------------------------------------------------------------

class SyncErrorItem(BaseModel):
    """A single per-file error encountered during a sync run."""
    git_path: str
    error: str


class SyncImportedTemplate(BaseModel):
    """Summary of a template that was successfully imported from Git."""
    id: int
    name: str
    git_path: str


class SyncReport(BaseModel):
    """
    Result of POST /admin/git-sync/{project_id}.

    Counts are mutually exclusive:
      scanned            = imported + already_registered + skipped_fragments + len(errors)
    """
    scanned: int = Field(0, description="Total .j2 files found (excluding .gitkeep).")
    imported: int = Field(0, description="New templates created in this run.")
    already_registered: int = Field(
        0, description="Files already present in the DB — skipped."
    )
    skipped_fragments: int = Field(
        0,
        description=(
            "Files with `is_fragment: true` in their frontmatter — "
            "listed but not imported as catalog templates."
        ),
    )
    errors: list[SyncErrorItem] = Field(
        default_factory=list,
        description="Per-file errors (invalid frontmatter, DB constraint violations, etc.).",
    )
    imported_templates: list[SyncImportedTemplate] = Field(
        default_factory=list,
        description="Templates successfully imported in this run.",
    )


# ---------------------------------------------------------------------------
# Git sync — status / drift report
# ---------------------------------------------------------------------------

class SyncStatusItem(BaseModel):
    """Status of a single path in the drift comparison."""
    git_path: str
    status: Literal["in_sync", "in_db_only", "in_git_only", "fragment"]


class SyncStatusReport(BaseModel):
    """
    Result of GET /admin/git-sync/{project_id}/status.

    Non-destructive drift check — compares DB records against Git files.
    """
    in_sync: int = Field(
        0,
        description="Files that exist in both Git and the DB.",
    )
    in_db_only: int = Field(
        0,
        description=(
            "DB records whose git_path no longer exists on disk "
            "(orphaned or soft-deleted)."
        ),
    )
    in_git_only: int = Field(
        0,
        description="Git files that have not been imported into the DB.",
    )
    skipped_fragments: int = Field(
        0,
        description="Git files identified as include-only fragments (is_fragment: true).",
    )
    items: list[SyncStatusItem] = Field(
        default_factory=list,
        description="Per-path breakdown of the drift status.",
    )


# ---------------------------------------------------------------------------
# Audit log
# ---------------------------------------------------------------------------

class AuditLogOut(BaseModel):
    """A single audit log entry representing one write operation."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    user_sub: str = Field(..., description="Username (JWT sub) of the caller.")
    action: str = Field(..., description="'create', 'update', or 'delete'.")
    resource_type: str = Field(..., description="Resource domain, e.g. 'template', 'parameter'.")
    resource_id: int | None = Field(None, description="Primary key of the affected row.")
    timestamp: datetime = Field(..., description="UTC timestamp of the operation.")
    changes: dict = Field(default_factory=dict, description="Request payload or diff.")


class AuditLogListOut(BaseModel):
    """Paginated audit log response."""

    items: list[AuditLogOut]
    total: int


# ---------------------------------------------------------------------------
# Custom Filters
# ---------------------------------------------------------------------------

class CustomFilterCreate(BaseModel):
    """Request body for POST /admin/filters."""

    model_config = ConfigDict(json_schema_extra={
        "examples": [{
            "name": "mb_to_kbps",
            "code": "def mb_to_kbps(value):\n    \"\"\"Convert megabits to kilobits per second.\"\"\"\n    return int(value) * 1000\n",
            "description": "Convert megabits to kilobits per second",
            "scope": "global",
        }]
    })

    name: str = Field(
        ...,
        max_length=100,
        pattern=r"^[a-z][a-z0-9_]*$",
        description="Filter name used in templates as ``| name``. Lowercase + underscores only.",
    )
    code: str = Field(
        ...,
        min_length=10,
        max_length=65_536,
        description="Python source code containing exactly one function definition.",
    )
    description: str | None = Field(None, max_length=500)
    scope: Literal["global", "project"] = Field(
        "global",
        description="'global' = available in all projects; 'project' = one project only.",
    )
    project_id: int | None = Field(
        None,
        description="Required when scope='project'; must be None for scope='global'.",
    )

    @model_validator(mode="after")
    def check_scope_consistency(self) -> "CustomFilterCreate":
        if self.scope == "project" and not self.project_id:
            raise ValueError("project_id is required when scope is 'project'")
        if self.scope == "global" and self.project_id is not None:
            raise ValueError("project_id must be None when scope is 'global'")
        return self


class CustomFilterOut(BaseModel):
    """A single custom filter entry."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    code: str
    description: str | None
    scope: str
    project_id: int | None
    is_active: bool
    created_at: datetime
    created_by: str | None


class CustomFilterDeleteOut(BaseModel):
    """Response for DELETE /admin/filters/{id}.

    The filter is soft-deleted regardless of usage.
    ``used_in_templates`` lists template names that still reference the
    filter so the caller can take corrective action.
    """

    id: int
    used_in_templates: list[str] = Field(
        default_factory=list,
        description="Names of templates that reference this filter (may need updating).",
    )


class FilterTestRequest(BaseModel):
    """Request body for POST /admin/filters/test."""

    model_config = ConfigDict(json_schema_extra={
        "examples": [{
            "code": "def mb_to_kbps(value):\n    return int(value) * 1000\n",
            "test_input": "100",
        }]
    })

    code: str = Field(..., min_length=10, max_length=65_536)
    test_input: str = Field(
        "test_value",
        description="Value passed as the sole argument to the filter function.",
    )


class FilterTestResult(BaseModel):
    """Response for POST /admin/filters/test."""

    ok: bool = Field(..., description="True if the function validated and ran without error.")
    output: str | None = Field(None, description="String representation of the return value.")
    error: str | None = Field(None, description="Error message if ok=False.")


# ---------------------------------------------------------------------------
# Custom Objects
# ---------------------------------------------------------------------------

class CustomObjectCreate(BaseModel):
    """Request body for POST /admin/objects."""

    model_config = ConfigDict(json_schema_extra={
        "examples": [{
            "name": "Defaults",
            "code": "class Defaults:\n    ntp_server = 'ntp.company.com'\n    dns_server = '8.8.8.8'\n",
            "description": "Company-wide default values available in all templates",
            "project_id": None,
        }]
    })

    name: str = Field(
        ...,
        max_length=100,
        pattern=r"^[A-Za-z][A-Za-z0-9_]*$",
        description="Object name as available in templates (e.g. 'Router').",
    )
    code: str = Field(
        ...,
        min_length=10,
        max_length=65_536,
        description="Python source code: one class or factory function.",
    )
    description: str | None = Field(None, max_length=500)
    project_id: int | None = Field(
        None,
        description="Restrict to one project. None = available in all projects.",
    )


class CustomObjectOut(BaseModel):
    """A single custom context object entry."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    code: str
    description: str | None
    project_id: int | None
    is_active: bool
    created_at: datetime
    created_by: str | None


class CustomObjectDeleteOut(BaseModel):
    """Response for DELETE /admin/objects/{id}."""

    id: int
