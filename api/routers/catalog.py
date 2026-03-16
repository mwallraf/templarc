"""
Catalog router — project management endpoints.

Mounted at /catalog in main.py. All project routes are therefore:
  GET    /catalog/projects
  POST   /catalog/projects
  GET    /catalog/projects/{id}
  PUT    /catalog/projects/{id}
  DELETE /catalog/projects/{id}
  GET    /catalog/projects/{id}/templates
  GET    /catalog/{slug}

Auth:
  - GET endpoints: any authenticated user
  - POST/PUT/DELETE: admin only

A shared GitService instance is constructed lazily from settings and injected
via the get_git_service dependency.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.auth import TokenData, get_current_user, require_admin
from api.database import get_db
from api.dependencies import get_git_service
from api.schemas.catalog import (
    CatalogResponse,
    ProjectCreate,
    ProjectDetailOut,
    ProjectOut,
    ProjectUpdate,
    TemplateTreeNode,
)
from api.services import catalog_service
from api.services.audit_log_service import log_write
from api.services.git_service import GitService

router = APIRouter()


# ---------------------------------------------------------------------------
# Project list
# ---------------------------------------------------------------------------

@router.get(
    "/projects",
    response_model=list[ProjectOut],
    summary="List projects",
    description=(
        "Return all projects. Optionally filter by organization and/or a "
        "name search string."
    ),
)
async def list_projects(
    organization_id: str | None = Query(None, description="Filter by organization"),
    search: str | None = Query(None, description="Partial match on project name"),
    db: AsyncSession = Depends(get_db),
    _token: TokenData = Depends(get_current_user),
) -> list[ProjectOut]:
    projects = await catalog_service.list_projects(db, organization_id=organization_id, search=search)
    return [ProjectOut.model_validate(p) for p in projects]


# ---------------------------------------------------------------------------
# Project create
# ---------------------------------------------------------------------------

@router.post(
    "/projects",
    response_model=ProjectOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create project",
    description=(
        "Create a new project. Initialises a Git subdirectory at `git_path` "
        "(defaults to `name`) with a .gitkeep commit so the directory exists "
        "before any templates are written."
    ),
)
async def create_project(
    data: ProjectCreate,
    db: AsyncSession = Depends(get_db),
    git_svc: GitService = Depends(get_git_service),
    token: TokenData = Depends(require_admin),
) -> ProjectOut:
    proj = await catalog_service.create_project(db, data, git_svc)
    await log_write(db, token.sub, "create", "project", proj.id, data.model_dump())
    await db.commit()
    return ProjectOut.model_validate(proj)


# ---------------------------------------------------------------------------
# Project detail (includes template tree)
# ---------------------------------------------------------------------------

@router.get(
    "/projects/{project_id}",
    response_model=ProjectDetailOut,
    summary="Get project",
    description="Fetch a project by ID, including its full template hierarchy tree.",
)
async def get_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    _token: TokenData = Depends(get_current_user),
) -> ProjectDetailOut:
    proj, tree = await catalog_service.get_project_with_tree(db, project_id)
    base = ProjectOut.model_validate(proj)
    return ProjectDetailOut(**base.model_dump(), templates=tree)


# ---------------------------------------------------------------------------
# Project update
# ---------------------------------------------------------------------------

@router.put(
    "/projects/{project_id}",
    response_model=ProjectOut,
    summary="Update project",
    description=(
        "Partial update of project metadata. "
        "`name` and `organization_id` are immutable after creation."
    ),
)
async def update_project(
    project_id: str,
    data: ProjectUpdate,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_admin),
) -> ProjectOut:
    proj = await catalog_service.update_project(db, project_id, data)
    out = ProjectOut.model_validate(proj)
    await log_write(db, token.sub, "update", "project", project_id, data.model_dump(exclude_none=True))
    await db.commit()
    return out


# ---------------------------------------------------------------------------
# Project delete
# ---------------------------------------------------------------------------

@router.delete(
    "/projects/{project_id}",
    response_model=None,
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete project",
    description=(
        "Hard-delete a project and all its templates and parameters. "
        "This action is irreversible. Git files are NOT removed from the repository."
    ),
)
async def delete_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_admin),
) -> None:
    await log_write(db, token.sub, "delete", "project", project_id)
    await catalog_service.delete_project(db, project_id)
    await db.commit()


# ---------------------------------------------------------------------------
# Project template tree
# ---------------------------------------------------------------------------

@router.get(
    "/projects/{project_id}/templates",
    response_model=list[TemplateTreeNode],
    summary="List templates as tree",
    description=(
        "Return the template hierarchy for a project as a nested tree. "
        "Only active templates are included. Nodes are ordered by sort_order "
        "then name within each level."
    ),
)
async def get_project_templates(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    _token: TokenData = Depends(get_current_user),
) -> list[TemplateTreeNode]:
    return await catalog_service.get_template_tree(db, project_id)


# ---------------------------------------------------------------------------
# Product catalog — must be declared AFTER /projects routes so that the
# literal path segment "projects" is not matched as a project_slug.
# ---------------------------------------------------------------------------

@router.get(
    "/{project_slug}",
    response_model=CatalogResponse,
    summary="Get product catalog",
    description=(
        "Return the full product catalog for a project, identified by its "
        "slug (`name` field). Intended for end-user selection UIs.\n\n"
        "Each template entry includes:\n"
        "- `breadcrumb` — ordered list of display names from root ancestor to this node\n"
        "- `parameter_count` — active template-scope parameters registered\n"
        "- `has_remote_datasources` — whether the `.j2` frontmatter declares `data_sources`\n"
        "- `is_leaf` — `true` when the template has no active child templates\n\n"
        "Both leaf templates (selectable by end users) and intermediate nodes "
        "(for hierarchical display) are included."
    ),
)
async def get_product_catalog(
    project_slug: str,
    db: AsyncSession = Depends(get_db),
    git_svc: GitService = Depends(get_git_service),
    _token: TokenData = Depends(get_current_user),
) -> CatalogResponse:
    return await catalog_service.get_product_catalog(db, project_slug, git_svc)
