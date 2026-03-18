"""
Catalog router — project management endpoints.

Mounted at /catalog in main.py. All project routes are therefore:
  GET    /catalog/projects
  POST   /catalog/projects
  GET    /catalog/projects/{project_id}
  PUT    /catalog/projects/{project_id}
  DELETE /catalog/projects/{project_id}
  GET    /catalog/projects/{project_id}/templates
  GET    /catalog/{slug}

Auth:
  - GET /catalog/projects          — any authenticated user; filtered to visible projects
  - POST /catalog/projects         — require_org_admin
  - GET /catalog/projects/{id}     — require_project_role('guest')
  - PUT /catalog/projects/{id}     — require_project_role('project_admin')
  - DELETE /catalog/projects/{id}  — require_org_admin
  - GET /catalog/projects/{id}/templates → require_project_role('guest')

A shared GitService instance is constructed lazily from settings and injected
via the get_git_service dependency.
"""

# NOTE: do NOT add 'from __future__ import annotations' here — it breaks
# FastAPI's dependency introspection when using Request in require_project_role.

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.auth import (
    TokenData,
    _PROJECT_ROLE_RANK,
    get_current_user,
    get_user_project_ids,
    is_org_admin,
    require_org_admin,
    require_project_role,
)
from api.database import get_db
from api.dependencies import get_git_service
from api.models.project_membership import ProjectMembership
from api.models.user import User
from api.schemas.catalog import (
    CatalogResponse,
    ProjectCreate,
    ProjectDetailOut,
    ProjectOut,
    ProjectUpdate,
    TemplateTreeNode,
)
from api.schemas.project_membership import (
    ProjectMembershipCreate,
    ProjectMembershipOut,
    ProjectMembershipsListOut,
)
from api.services import catalog_service, project_yaml_service
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
        "Return projects accessible to the caller. "
        "Org-admins see all projects; members see only projects they have "
        "a membership in."
    ),
)
async def list_projects(
    organization_id: str | None = Query(None, description="Filter by organization"),
    search: str | None = Query(None, description="Partial match on project name"),
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(get_current_user),
) -> list[ProjectOut]:
    accessible_ids = await get_user_project_ids(token, db)
    projects = await catalog_service.list_projects(
        db,
        organization_id=organization_id,
        search=search,
        project_ids=accessible_ids,
    )
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
        "before any templates are written. Org-admin only.\n\n"
        "# Future: await check_project_quota(token.org_id, db)"
    ),
)
async def create_project(
    data: ProjectCreate,
    db: AsyncSession = Depends(get_db),
    git_svc: GitService = Depends(get_git_service),
    token: TokenData = Depends(require_org_admin),
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
    _token: TokenData = Depends(require_project_role("guest")),
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
        "`name` and `organization_id` are immutable after creation. "
        "Requires project_admin role."
    ),
)
async def update_project(
    project_id: str,
    data: ProjectUpdate,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_project_role("project_admin")),
    git_svc: GitService = Depends(get_git_service),
) -> ProjectOut:
    proj = await catalog_service.update_project(db, project_id, data)
    out = ProjectOut.model_validate(proj)
    await log_write(db, token.sub, "update", "project", project_id, data.model_dump(exclude_none=True))
    await db.commit()
    await project_yaml_service.write_project_yaml(db, project_id, git_svc, author=token.sub)
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
        "This action is irreversible. Git files are NOT removed from the repository. "
        "Org-admin only."
    ),
)
async def delete_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_org_admin),
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
    _token: TokenData = Depends(require_project_role("guest")),
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


# ---------------------------------------------------------------------------
# Project membership management
# ---------------------------------------------------------------------------

async def _build_membership_out(membership: ProjectMembership, db: AsyncSession) -> ProjectMembershipOut:
    """Enrich a ProjectMembership row with user details."""
    user_result = await db.execute(select(User).where(User.id == membership.user_id))
    user = user_result.scalar_one_or_none()
    return ProjectMembershipOut(
        id=membership.id,
        user_id=membership.user_id,
        project_id=membership.project_id,
        username=user.username if user else "",
        email=user.email if user else "",
        role=membership.role,
        created_at=membership.created_at,
    )


_VALID_PROJECT_ROLES = frozenset({"project_admin", "project_editor", "project_member", "guest"})


@router.get(
    "/projects/{project_id}/members",
    response_model=ProjectMembershipsListOut,
    summary="List project members",
    description="Return all members of a project with their roles. Requires project_admin or org_admin.",
)
async def list_project_members(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_project_role("project_admin")),
) -> ProjectMembershipsListOut:
    result = await db.execute(
        select(ProjectMembership)
        .where(ProjectMembership.project_id == project_id)
        .order_by(ProjectMembership.created_at)
    )
    memberships = result.scalars().all()
    items = [await _build_membership_out(m, db) for m in memberships]
    return ProjectMembershipsListOut(items=items, total=len(items))


@router.post(
    "/projects/{project_id}/members",
    response_model=ProjectMembershipOut,
    status_code=status.HTTP_201_CREATED,
    summary="Add or update project member",
    description=(
        "Add a user to the project or update their role. "
        "Upserts: if the user is already a member, updates their role. "
        "Requires project_admin or org_admin. "
        "Cannot set a role higher than your own project role (unless org_admin)."
    ),
)
async def upsert_project_member(
    project_id: str,
    body: ProjectMembershipCreate,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_project_role("project_admin")),
) -> ProjectMembershipOut:
    if body.role not in _VALID_PROJECT_ROLES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid role. Must be one of: {sorted(_VALID_PROJECT_ROLES)}",
        )

    # Non-org-admins cannot grant a higher project role than they hold
    if not is_org_admin(token):
        # Look up caller's own project membership rank
        caller_user = (await db.execute(select(User).where(User.username == token.sub))).scalar_one_or_none()
        if caller_user:
            caller_mem = (await db.execute(
                select(ProjectMembership).where(
                    ProjectMembership.user_id == caller_user.id,
                    ProjectMembership.project_id == project_id,
                )
            )).scalar_one_or_none()
            caller_rank = _PROJECT_ROLE_RANK.get(caller_mem.role if caller_mem else "guest", 0)
            target_rank = _PROJECT_ROLE_RANK.get(body.role, 0)
            if target_rank > caller_rank:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Cannot grant a role higher than your own project role",
                )

    # Verify user exists
    user_result = await db.execute(select(User).where(User.id == body.user_id))
    user = user_result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # Upsert membership
    mem_result = await db.execute(
        select(ProjectMembership).where(
            ProjectMembership.user_id == body.user_id,
            ProjectMembership.project_id == project_id,
        )
    )
    membership = mem_result.scalar_one_or_none()
    if membership is None:
        membership = ProjectMembership(
            user_id=body.user_id,
            project_id=project_id,
            role=body.role,
        )
        db.add(membership)
    else:
        membership.role = body.role

    await db.flush()
    await db.refresh(membership)
    await log_write(db, token.sub, "create", "project_membership", project_id, {
        "user_id": body.user_id, "role": body.role
    })
    await db.commit()
    return await _build_membership_out(membership, db)


@router.delete(
    "/projects/{project_id}/members/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
    summary="Remove project member",
    description=(
        "Remove a user's membership from the project. "
        "Cannot remove yourself if you are the last project_admin (unless org_admin)."
    ),
)
async def remove_project_member(
    project_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_project_role("project_admin")),
) -> None:
    mem_result = await db.execute(
        select(ProjectMembership).where(
            ProjectMembership.user_id == user_id,
            ProjectMembership.project_id == project_id,
        )
    )
    membership = mem_result.scalar_one_or_none()
    if membership is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Membership not found")

    # Guard: cannot remove yourself if last project_admin (unless org_admin)
    if not is_org_admin(token):
        caller_user = (await db.execute(select(User).where(User.username == token.sub))).scalar_one_or_none()
        if caller_user and caller_user.id == user_id and membership.role == "project_admin":
            # Check if there are other project_admins
            other_admins = (await db.execute(
                select(ProjectMembership).where(
                    ProjectMembership.project_id == project_id,
                    ProjectMembership.role == "project_admin",
                    ProjectMembership.user_id != user_id,
                )
            )).scalars().all()
            if not other_admins:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Cannot remove yourself: you are the last project_admin",
                )

    await db.delete(membership)
    await log_write(db, token.sub, "delete", "project_membership", project_id, {"user_id": user_id})
    await db.commit()
