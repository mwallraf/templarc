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

from pydantic import BaseModel, ConfigDict, Field, computed_field, model_validator


# ---------------------------------------------------------------------------
# Git sync — import report
# ---------------------------------------------------------------------------

class SyncErrorItem(BaseModel):
    """A single per-file error encountered during a sync run."""
    git_path: str
    error: str


class SyncImportedTemplate(BaseModel):
    """Summary of a template that was successfully imported from Git."""
    id: str
    name: str
    git_path: str


class SyncDeletedTemplate(BaseModel):
    """Summary of a template removed from the DB during a sync run."""
    id: str
    name: str
    git_path: str


class GitSyncRequest(BaseModel):
    """
    Optional request body for POST /admin/git-sync/{project_id}.

    When omitted, the default behaviour is:
      - import_paths=None → import ALL new git files
      - delete_paths=None → do not delete anything

    Supply explicit lists to apply only the selected actions from the
    review modal.
    """
    import_paths: list[str] | None = Field(
        None,
        description=(
            "Specific git paths to import into the DB. "
            "When None all new (in_git_only) files are imported."
        ),
    )
    delete_paths: list[str] | None = Field(
        None,
        description=(
            "git_paths of DB records to remove. "
            "When None no deletions are performed."
        ),
    )


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
    deleted: int = Field(0, description="DB records removed in this run.")
    errors: list[SyncErrorItem] = Field(
        default_factory=list,
        description="Per-file errors (invalid frontmatter, DB constraint violations, etc.).",
    )
    imported_templates: list[SyncImportedTemplate] = Field(
        default_factory=list,
        description="Templates successfully imported in this run.",
    )
    deleted_templates: list[SyncDeletedTemplate] = Field(
        default_factory=list,
        description="Templates removed from the DB in this run.",
    )


# ---------------------------------------------------------------------------
# Git sync — status / drift report
# ---------------------------------------------------------------------------

class SyncStatusItem(BaseModel):
    """Status of a single path in the drift comparison."""
    git_path: str
    status: Literal["in_sync", "in_db_only", "in_git_only", "fragment"]
    template_name: str | None = Field(
        None,
        description="DB template name — populated only for in_db_only entries.",
    )
    template_id: str | None = Field(
        None,
        description="DB template id — populated only for in_db_only entries.",
    )


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
    resource_id: str | None = Field(None, description="Primary key of the affected row.")
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
    project_id: str | None = Field(
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
    project_id: str | None
    is_active: bool
    created_at: datetime
    created_by: str | None


class CustomFilterUpdate(BaseModel):
    """Request body for PUT /admin/filters/{id}."""

    code: str = Field(..., min_length=10, max_length=65_536)
    description: str | None = Field(None, max_length=500)


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
            "scope": "global",
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
    scope: Literal["global", "project"] = Field(
        "global",
        description="'global' = available in all projects; 'project' = one project only.",
    )
    project_id: str | None = Field(
        None,
        description="Required when scope='project'; must be None for scope='global'.",
    )

    @model_validator(mode="after")
    def check_scope_consistency(self) -> "CustomObjectCreate":
        if self.scope == "project" and not self.project_id:
            raise ValueError("project_id is required when scope is 'project'")
        if self.scope == "global" and self.project_id is not None:
            raise ValueError("project_id must be None when scope is 'global'")
        return self


class CustomObjectOut(BaseModel):
    """A single custom context object entry."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    code: str
    description: str | None
    project_id: str | None
    is_active: bool
    created_at: datetime
    created_by: str | None

    @computed_field  # type: ignore[misc]
    @property
    def scope(self) -> str:
        return "project" if self.project_id is not None else "global"


class CustomObjectUpdate(BaseModel):
    """Request body for PUT /admin/objects/{id}."""

    code: str = Field(..., min_length=1, max_length=65_536)
    description: str | None = Field(None, max_length=500)


class CustomObjectDeleteOut(BaseModel):
    """Response for DELETE /admin/objects/{id}."""

    id: int


# ---------------------------------------------------------------------------
# Duplicate parameter detection
# ---------------------------------------------------------------------------

class DuplicateTemplateRef(BaseModel):
    """One occurrence of a duplicated parameter inside a specific template."""

    param_id: int
    template_id: str
    template_name: str
    template_display_name: str
    widget_type: str
    label: str | None
    required: bool


class DuplicateParameterGroup(BaseModel):
    """A parameter name that appears in more than one template within the same project."""

    name: str
    project_id: str
    project_display_name: str
    count: int
    has_conflicts: bool  # True when widget_type or required differs across occurrences
    templates: list[DuplicateTemplateRef]


class DuplicatesReport(BaseModel):
    groups: list[DuplicateParameterGroup]
    total_duplicate_names: int
    total_redundant_params: int  # sum of (count - 1) across all groups


# ---------------------------------------------------------------------------
# Parameter promote
# ---------------------------------------------------------------------------

class PromoteRequest(BaseModel):
    """Request body for POST /admin/parameters/promote."""

    from_name: str = Field(
        ...,
        max_length=200,
        description="Current template-scope parameter name (e.g. 'service_id').",
    )
    to_name: str = Field(
        ...,
        max_length=200,
        description="New promoted name — must start with 'proj.' or 'glob.' (e.g. 'proj.service_id').",
    )
    project_id: str = Field(
        ...,
        description="Project ID that owns the duplicate template parameters.",
    )


class PromoteTemplateRewrite(BaseModel):
    """Result of attempting to rewrite one .j2 file during a promote operation."""

    template_id: str
    template_name: str
    git_path: str | None
    rewritten: bool
    replacements: int = 0
    error: str | None = None


class PromoteReport(BaseModel):
    """Response for POST /admin/parameters/promote."""

    created_param_id: int
    deleted_param_ids: list[int]
    templates_updated: int
    git_files_rewritten: int
    template_rewrites: list[PromoteTemplateRewrite]


# ---------------------------------------------------------------------------
# Custom Macros
# ---------------------------------------------------------------------------

class CustomMacroCreate(BaseModel):
    """Request body for POST /admin/macros."""

    model_config = ConfigDict(json_schema_extra={
        "examples": [{
            "name": "interface_block",
            "body": "{% macro interface_block(name, ip) %}\ninterface {{ name }}\n  ip address {{ ip }}\n{% endmacro %}",
            "description": "Render a standard interface block",
            "scope": "global",
        }]
    })

    name: str = Field(
        ...,
        max_length=100,
        pattern=r"^[a-z][a-z0-9_]*$",
        description="Macro name — must match the macro name defined in the body.",
    )
    body: str = Field(
        ...,
        min_length=10,
        max_length=65_536,
        description=(
            "Complete Jinja2 macro definition. Must contain a "
            "``{%% macro <name>(...) %%}...{%% endmacro %%}`` block "
            "where the macro name matches the ``name`` field."
        ),
    )
    description: str | None = Field(None, max_length=500)
    scope: Literal["global", "project"] = Field(
        "global",
        description="'global' = available in all projects; 'project' = one project only.",
    )
    project_id: str | None = Field(
        None,
        description="Required when scope='project'; must be None for scope='global'.",
    )

    @model_validator(mode="after")
    def check_scope_consistency(self) -> "CustomMacroCreate":
        if self.scope == "project" and not self.project_id:
            raise ValueError("project_id is required when scope is 'project'")
        if self.scope == "global" and self.project_id is not None:
            raise ValueError("project_id must be None when scope is 'global'")
        return self


class CustomMacroOut(BaseModel):
    """A single custom macro entry."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    body: str
    description: str | None
    scope: str
    project_id: str | None
    is_active: bool
    created_at: datetime
    created_by: str | None


class CustomMacroUpdate(BaseModel):
    """Request body for PUT /admin/macros/{id}."""

    body: str = Field(..., min_length=1, max_length=65_536)
    description: str | None = Field(None, max_length=500)


class CustomMacroDeleteOut(BaseModel):
    """Response for DELETE /admin/macros/{id}."""

    id: int


# ---------------------------------------------------------------------------
# Remote Git schemas
# ---------------------------------------------------------------------------

class GitRemoteStatusOut(BaseModel):
    """Remote git status for a project."""

    has_remote: bool
    remote_url: str | None
    remote_branch: str
    local_sha: str | None
    remote_sha: str | None
    ahead: int
    behind: int
    status: str = Field(
        ...,
        description=(
            "One of: no_remote, not_cloned, in_sync, ahead, behind, diverged, error"
        ),
    )
    message: str | None


class GitRemoteActionOut(BaseModel):
    """Response for pull/push/clone operations."""

    success: bool
    message: str
    new_sha: str | None = None


class GitRemoteTestOut(BaseModel):
    """Response for the test-connection endpoint."""

    success: bool
    message: str
    branch_sha: str | None = None


# ---------------------------------------------------------------------------
# Phase 13A — Org settings + stats
# ---------------------------------------------------------------------------

class OrgSettingsOut(BaseModel):
    """Current organisation settings."""
    model_config = {"from_attributes": True}

    id: str
    name: str
    display_name: str
    description: str | None
    logo_url: str | None
    timezone: str
    retention_days: int | None
    is_active: bool


class OrgSettingsPatch(BaseModel):
    """Fields that org_admin may update."""
    display_name: str | None = None
    description: str | None = None
    logo_url: str | None = None
    timezone: str | None = None
    retention_days: int | None = None


class OrgStatsOut(BaseModel):
    """Aggregate usage statistics for the caller's organisation."""
    users_total: int
    projects_total: int
    templates_total: int
    renders_total: int
    renders_last_30d: int
    renders_last_7d: int
    api_keys_active: int
    storage_templates_count: int


# ---------------------------------------------------------------------------
# Phase 13A — Webhook delivery log
# ---------------------------------------------------------------------------

class WebhookDeliveryOut(BaseModel):
    """A single webhook delivery attempt."""
    model_config = {"from_attributes": True}

    id: str
    webhook_id: int
    event: str
    status_code: int | None
    error: str | None
    duration_ms: int | None
    created_at: str


class WebhookDeliveryListOut(BaseModel):
    items: list[WebhookDeliveryOut]
    total: int
