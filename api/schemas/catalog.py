"""
Pydantic v2 schemas for the Project and Template catalog resources.

Schema groups:
  Project  — ProjectCreate, ProjectUpdate, ProjectOut, ProjectDetailOut
  Template — TemplateCreate, TemplateUpdate, TemplateOut, TemplateUpdateOut
  Derived  — TemplateTreeNode, VariableRefOut, InheritanceChainItem

Routing note: project routes live under the /catalog prefix (catalog.py router),
template CRUD lives under /templates (templates.py router).
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Project schemas
# ---------------------------------------------------------------------------

class ProjectCreate(BaseModel):
    model_config = ConfigDict(json_schema_extra={
        "examples": [{
            "organization_id": 1,
            "name": "router_provisioning",
            "display_name": "Router Provisioning",
            "description": "Cisco IOS router configuration templates",
            "git_path": "router_provisioning",
            "output_comment_style": "!",
        }]
    })

    organization_id: int
    name: str = Field(..., max_length=100, description="Slug-style identifier, unique per org")
    display_name: str = Field(..., max_length=255)
    description: str | None = None
    git_path: str | None = Field(
        None, max_length=500,
        description="Subdirectory inside the templates repo. Defaults to `name` if omitted."
    )
    output_comment_style: str = Field(
        "#", max_length=10,
        description="Comment prefix used in rendered output headers: #, !, //, or none"
    )
    remote_url: str | None = Field(
        None, max_length=500,
        description="Remote Git clone URL (HTTPS or SSH). When set, enables pull/push via the git-remote admin endpoints."
    )
    remote_branch: str = Field(
        "main", max_length=100,
        description="Remote branch to track (default: main)."
    )
    remote_credential_ref: str | None = Field(
        None, max_length=500,
        description="Secret reference for remote auth (e.g. 'secret:my_git_token' or 'env:GIT_TOKEN')."
    )


class ProjectUpdate(BaseModel):
    display_name: str | None = Field(None, max_length=255)
    description: str | None = None
    git_path: str | None = Field(None, max_length=500)
    output_comment_style: str | None = Field(None, max_length=10)
    remote_url: str | None = Field(None, max_length=500)
    remote_branch: str | None = Field(None, max_length=100)
    remote_credential_ref: str | None = Field(None, max_length=500)


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True, json_schema_extra={
        "examples": [{
            "id": 1,
            "organization_id": 1,
            "name": "router_provisioning",
            "display_name": "Router Provisioning",
            "description": "Cisco IOS router configuration templates",
            "git_path": "router_provisioning",
            "output_comment_style": "!",
            "created_at": "2024-01-15T09:00:00Z",
            "updated_at": "2024-01-15T09:00:00Z",
        }]
    })

    id: int
    organization_id: int
    name: str
    display_name: str
    description: str | None
    git_path: str | None
    output_comment_style: str
    remote_url: str | None
    remote_branch: str
    remote_credential_ref: str | None
    created_at: datetime
    updated_at: datetime


class ProjectDetailOut(ProjectOut):
    """Project with its full template hierarchy tree."""
    templates: list[TemplateTreeNode] = []


# ---------------------------------------------------------------------------
# Template tree node (used in project detail and /templates tree endpoint)
# ---------------------------------------------------------------------------

class TemplateTreeNode(BaseModel):
    id: int
    name: str
    display_name: str
    git_path: str | None
    is_active: bool
    is_snippet: bool
    is_hidden: bool
    sort_order: int
    children: list[TemplateTreeNode] = []


# Forward reference resolution for the self-referential model
TemplateTreeNode.model_rebuild()
ProjectDetailOut.model_rebuild()


# ---------------------------------------------------------------------------
# Template schemas
# ---------------------------------------------------------------------------

class TemplateCreate(BaseModel):
    model_config = ConfigDict(json_schema_extra={
        "examples": [{
            "project_id": 1,
            "name": "cisco_891",
            "display_name": "Cisco 891",
            "description": "Cisco 891 router base configuration",
            "parent_template_id": None,
            "sort_order": 10,
            "content": "---\nparameters:\n  - name: router.hostname\n    widget: text\n    required: true\n---\nhostname {{ router.hostname }}\n",
            "author": "admin",
        }]
    })

    project_id: int
    name: str = Field(
        ...,
        max_length=100,
        pattern=r"^[a-zA-Z0-9_]+$",
        description="Alphanumeric + underscores only, unique per project",
    )
    display_name: str = Field(..., max_length=255)
    description: str | None = None
    git_path: str | None = Field(
        None, max_length=500,
        description="Path within the templates repo (e.g. 'project/snippets/foo.j2'). "
                    "Defaults to '{project_git_path}/{name}.j2' if omitted.",
    )
    parent_template_id: int | None = Field(
        None, description="Must belong to the same project if provided"
    )
    sort_order: int = 0
    is_snippet: bool = Field(False, description="Mark as include-only snippet (hidden from catalog, not directly renderable)")
    is_hidden: bool = Field(False, description="Hide from catalog without deactivating")
    content: str = Field(
        "",
        max_length=512_000,  # 500 KB max
        description="Initial body of the .j2 file. Frontmatter will be prepended if empty.",
    )
    author: str = Field("api", max_length=100, description="Git commit author name")


class TemplateUpdate(BaseModel):
    display_name: str | None = Field(None, max_length=255)
    description: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None
    is_snippet: bool | None = None
    is_hidden: bool | None = None
    content: str | None = Field(
        None,
        max_length=512_000,  # 500 KB max
        description="New .j2 file content (frontmatter + body). When provided, writes a new Git commit.",
    )
    commit_message: str | None = Field(
        None,
        description="Git commit message. Defaults to 'Update template <name>' when content is provided."
    )
    author: str = Field("api", max_length=100, description="Git commit author name")


class TemplateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True, json_schema_extra={
        "examples": [{
            "id": 5,
            "project_id": 1,
            "name": "cisco_891",
            "display_name": "Cisco 891",
            "description": "Cisco 891 router base configuration",
            "git_path": "router_provisioning/cisco_891.j2",
            "parent_template_id": None,
            "is_active": True,
            "sort_order": 10,
            "created_at": "2024-01-15T09:00:00Z",
            "updated_at": "2024-01-15T09:00:00Z",
        }]
    })

    id: int
    project_id: int
    name: str
    display_name: str
    description: str | None
    git_path: str | None
    parent_template_id: int | None
    is_active: bool
    is_snippet: bool
    is_hidden: bool
    sort_order: int
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------------
# Variable reference with registration status
# (returned by GET /templates/{id}/variables)
# ---------------------------------------------------------------------------

class VariableRefOut(BaseModel):
    name: str = Field(..., description="Root variable name (e.g. 'router', 'glob')")
    type: Literal["simple", "attribute"]
    full_path: str = Field(..., description="Full dotted path (e.g. 'router.hostname')")
    is_registered: bool = Field(
        ...,
        description=(
            "True when a Parameter with this exact name exists in the "
            "registry (template-scope or project-scope)."
        )
    )


# ---------------------------------------------------------------------------
# Update response — returned by PUT /templates/{id}
# Includes suggested parameters extracted from the updated template body.
# ---------------------------------------------------------------------------

class TemplateUpdateOut(BaseModel):
    template: TemplateOut
    suggested_parameters: list[VariableRefOut] = Field(
        default_factory=list,
        description=(
            "Variable references parsed from the updated template body. "
            "is_registered=False entries are candidates to add to the parameter registry."
        )
    )


# ---------------------------------------------------------------------------
# Upload response — returned by POST /templates/upload
# ---------------------------------------------------------------------------

class TemplateUploadOut(BaseModel):
    """Response returned when a .j2 file is uploaded and imported."""
    template: TemplateOut
    parameters_registered: int = Field(
        0,
        description="Number of parameters created from the YAML frontmatter 'parameters' list."
    )
    suggested_parameters: list[VariableRefOut] = Field(
        default_factory=list,
        description=(
            "Variable references found in the template body that were NOT declared in the "
            "frontmatter 'parameters' list — candidates to add to the parameter registry."
        )
    )


# ---------------------------------------------------------------------------
# Inheritance chain item (returned by GET /templates/{id}/inheritance-chain)
# ---------------------------------------------------------------------------

class InheritanceChainItem(BaseModel):
    id: int
    name: str
    display_name: str
    git_path: str | None
    description: str | None


# ---------------------------------------------------------------------------
# Product catalog schemas (returned by GET /catalog/{project_slug})
# ---------------------------------------------------------------------------

class CatalogProjectOut(BaseModel):
    """Minimal project summary embedded in the catalog response."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    display_name: str
    description: str | None


class CatalogTemplateItem(BaseModel):
    """
    One template entry in the product catalog.

    Includes enough information for a selection UI without requiring a
    second API call:
      - breadcrumb: display_names from root ancestor down to this node
      - parameter_count: number of active template-scope parameters registered
      - has_remote_datasources: True if the .j2 frontmatter declares data_sources
      - is_leaf: True when the template has no active children
    """
    id: int
    name: str
    display_name: str
    description: str | None
    breadcrumb: list[str] = Field(
        default_factory=list,
        description="Ordered list of display_names from root to this template (inclusive)."
    )
    parameter_count: int = Field(
        0,
        description="Count of active template-scope parameters registered for this template."
    )
    has_remote_datasources: bool = Field(
        False,
        description="True if the template's .j2 frontmatter declares one or more data_sources."
    )
    is_leaf: bool = Field(
        True,
        description="True when this template has no active child templates."
    )


class CatalogResponse(BaseModel):
    """Full product catalog response for a single project."""
    project: CatalogProjectOut
    templates: list[CatalogTemplateItem]
