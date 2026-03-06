"""
Catalog service — project and template business logic.

This module contains all database operations for:
  - Project CRUD (list, get, create, update)
  - Template CRUD (get, create, update content, soft delete)
  - Template tree building (nested parent/child structure)
  - Template inheritance chain resolution
  - Template variable extraction with registration status

Design decisions:
  - All functions accept an AsyncSession as the first argument; they never
    call db.commit() — that's the caller's (router's) responsibility.
  - Git writes are performed synchronously via GitService; they block the
    event loop. This is acceptable for Phase 3; async Git would require
    running writes in an executor pool, which can be done later.
  - HTTPException is raised here rather than returning sentinel values;
    services are tightly coupled to FastAPI in this project.
  - Parent validation for create_template is strict: the parent must exist
    AND belong to the same project.
"""

from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.parameter import Parameter
from api.models.project import Project
from api.models.template import Template
from api.schemas.catalog import (
    CatalogProjectOut,
    CatalogResponse,
    CatalogTemplateItem,
    InheritanceChainItem,
    ProjectCreate,
    ProjectUpdate,
    TemplateCreate,
    TemplateTreeNode,
    TemplateUpdate,
    TemplateUpdateOut,
    TemplateOut,
    VariableRefOut,
)
from api.services.git_service import GitService, TemplateNotFoundError
from api.services.jinja_parser import extract_variables


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

async def _get_project_or_404(db: AsyncSession, project_id: int) -> Project:
    proj = await db.get(Project, project_id)
    if proj is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project {project_id} not found.",
        )
    return proj


async def _get_template_or_404(db: AsyncSession, template_id: int) -> Template:
    tmpl = await db.get(Template, template_id)
    if tmpl is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Template {template_id} not found.",
        )
    return tmpl


def _build_initial_content(name: str) -> str:
    """Return minimal valid frontmatter + empty body for a new template."""
    return f"---\nparameters: []\n---\n# Template: {name}\n"


def _build_tree(templates: list[Template]) -> list[TemplateTreeNode]:
    """Build a nested TemplateTreeNode structure from a flat list of templates."""
    children_map: dict[int | None, list[Template]] = {}
    for t in templates:
        children_map.setdefault(t.parent_template_id, []).append(t)

    def build_node(t: Template) -> TemplateTreeNode:
        return TemplateTreeNode(
            id=t.id,
            name=t.name,
            display_name=t.display_name,
            is_active=t.is_active,
            sort_order=t.sort_order,
            children=[build_node(c) for c in children_map.get(t.id, [])],
        )

    return [build_node(r) for r in children_map.get(None, [])]


# ---------------------------------------------------------------------------
# Project operations
# ---------------------------------------------------------------------------

async def list_projects(
    db: AsyncSession,
    organization_id: int | None = None,
    search: str | None = None,
) -> list[Project]:
    """Return all projects, optionally filtered by org and/or name search."""
    stmt = select(Project).order_by(Project.display_name)
    if organization_id is not None:
        stmt = stmt.where(Project.organization_id == organization_id)
    if search:
        stmt = stmt.where(Project.name.ilike(f"%{search}%"))
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_project(db: AsyncSession, project_id: int) -> Project:
    return await _get_project_or_404(db, project_id)


async def get_project_with_tree(
    db: AsyncSession, project_id: int
) -> tuple[Project, list[TemplateTreeNode]]:
    """Return (project, template_tree) for the project detail endpoint."""
    proj = await _get_project_or_404(db, project_id)
    tree = await get_template_tree(db, project_id)
    return proj, tree


async def create_project(
    db: AsyncSession,
    data: ProjectCreate,
    git_svc: GitService,
) -> Project:
    """
    Create a project record and initialize its Git subdirectory.

    The git_path defaults to the project name if not provided.
    A .gitkeep file is committed to materialise the directory in Git.
    """
    git_path = data.git_path or data.name

    proj = Project(
        organization_id=data.organization_id,
        name=data.name,
        display_name=data.display_name,
        description=data.description,
        git_path=git_path,
        output_comment_style=data.output_comment_style,
    )
    db.add(proj)
    await db.flush()  # get proj.id assigned

    # Initialize the Git subdirectory with a .gitkeep
    git_svc.write_template(
        f"{git_path}/.gitkeep",
        "",
        message=f"Initialize project directory: {data.name}",
        author="api",
    )

    return proj


async def update_project(
    db: AsyncSession,
    project_id: int,
    data: ProjectUpdate,
) -> Project:
    """Partial update of project metadata (never changes name or org)."""
    proj = await _get_project_or_404(db, project_id)

    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(proj, field, value)

    await db.flush()
    await db.refresh(proj)
    return proj


# ---------------------------------------------------------------------------
# Template tree
# ---------------------------------------------------------------------------

async def get_template_tree(
    db: AsyncSession, project_id: int
) -> list[TemplateTreeNode]:
    """Return the full template hierarchy for a project as a nested tree."""
    stmt = (
        select(Template)
        .where(Template.project_id == project_id, Template.is_active == True)
        .order_by(Template.sort_order, Template.name)
    )
    result = await db.execute(stmt)
    templates = list(result.scalars().all())
    return _build_tree(templates)


# ---------------------------------------------------------------------------
# Template operations
# ---------------------------------------------------------------------------

async def list_templates(
    db: AsyncSession,
    project_id: int | None = None,
    active_only: bool = True,
) -> list[Template]:
    """Return templates, optionally filtered by project and/or active status."""
    stmt = select(Template).order_by(Template.sort_order, Template.display_name)
    if project_id is not None:
        stmt = stmt.where(Template.project_id == project_id)
    if active_only:
        stmt = stmt.where(Template.is_active.is_(True))
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_template(db: AsyncSession, template_id: int) -> Template:
    return await _get_template_or_404(db, template_id)


async def create_template(
    db: AsyncSession,
    data: TemplateCreate,
    git_svc: GitService,
) -> Template:
    """
    Create a template record and write an initial .j2 file to Git.

    Validates that parent_template_id (if given) belongs to the same project.
    git_path defaults to `{project.git_path}/{template.name}.j2`.
    """
    proj = await _get_project_or_404(db, data.project_id)

    # Validate parent is in the same project
    if data.parent_template_id is not None:
        parent = await db.get(Template, data.parent_template_id)
        if parent is None or parent.project_id != data.project_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"parent_template_id {data.parent_template_id} does not exist "
                    "or belongs to a different project."
                ),
            )

    project_dir = proj.git_path or proj.name
    git_path = f"{project_dir}/{data.name}.j2"

    initial_content = data.content if data.content.strip() else _build_initial_content(data.name)

    git_svc.write_template(
        git_path,
        initial_content,
        message=f"Add template: {data.name}",
        author=data.author,
    )

    tmpl = Template(
        project_id=data.project_id,
        name=data.name,
        display_name=data.display_name,
        description=data.description,
        git_path=git_path,
        parent_template_id=data.parent_template_id,
        sort_order=data.sort_order,
    )
    db.add(tmpl)
    await db.flush()
    return tmpl


async def update_template(
    db: AsyncSession,
    template_id: int,
    data: TemplateUpdate,
    git_svc: GitService,
) -> TemplateUpdateOut:
    """
    Update template metadata and, if content is provided, write a new Git commit.

    Returns a TemplateUpdateOut with the updated record and a list of variable
    references parsed from the new body, annotated with registration status.
    """
    tmpl = await _get_template_or_404(db, template_id)

    # Apply metadata updates
    for field in ("display_name", "description", "sort_order"):
        value = getattr(data, field)
        if value is not None:
            setattr(tmpl, field, value)

    suggested: list[VariableRefOut] = []

    if data.content is not None:
        if not tmpl.git_path:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Template has no git_path; cannot write content.",
            )
        message = data.commit_message or f"Update template: {tmpl.name}"
        git_svc.write_template(tmpl.git_path, data.content, message=message, author=data.author)

        # Extract variables from the new body and annotate with registration
        _, body = git_svc.parse_frontmatter(data.content)
        refs = extract_variables(body)

        # Load all parameter names registered for this template or its project
        stmt = select(Parameter.name).where(
            or_(
                Parameter.template_id == template_id,
                Parameter.project_id == tmpl.project_id,
            ),
            Parameter.is_active == True,
        )
        result = await db.execute(stmt)
        registered = {row[0] for row in result.all()}

        suggested = [
            VariableRefOut(
                name=ref.name,
                type=ref.type,
                full_path=ref.full_path,
                is_registered=ref.full_path in registered,
            )
            for ref in refs
        ]

    await db.flush()
    await db.refresh(tmpl)  # reload server-generated updated_at after flush
    return TemplateUpdateOut(
        template=TemplateOut.model_validate(tmpl),
        suggested_parameters=suggested,
    )


async def delete_template(db: AsyncSession, template_id: int) -> None:
    """Soft-delete a template (sets is_active=False). Does not touch Git."""
    tmpl = await _get_template_or_404(db, template_id)
    tmpl.is_active = False
    await db.flush()


# ---------------------------------------------------------------------------
# Template variables with registration status
# ---------------------------------------------------------------------------

async def get_template_variables(
    db: AsyncSession,
    template_id: int,
    git_svc: GitService,
) -> list[VariableRefOut]:
    """
    Parse the template's .j2 file and return all variable references,
    annotated with whether each is registered in the parameter registry.

    Registration is checked against template-scope and project-scope parameters.
    glob.* parameters (global scope) require a separate org lookup and are
    marked is_registered=False unless they happen to match a proj/template param.
    """
    tmpl = await _get_template_or_404(db, template_id)

    if not tmpl.git_path:
        return []

    try:
        content = git_svc.read_template(tmpl.git_path)
    except TemplateNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Git file not found for template {template_id}: {tmpl.git_path!r}",
        )

    _, body = git_svc.parse_frontmatter(content)
    refs = extract_variables(body)

    # Load registered parameter names (template + project scope)
    stmt = select(Parameter.name).where(
        or_(
            Parameter.template_id == template_id,
            Parameter.project_id == tmpl.project_id,
        ),
        Parameter.is_active == True,
    )
    result = await db.execute(stmt)
    registered = {row[0] for row in result.all()}

    return [
        VariableRefOut(
            name=ref.name,
            type=ref.type,
            full_path=ref.full_path,
            is_registered=ref.full_path in registered,
        )
        for ref in refs
    ]


# ---------------------------------------------------------------------------
# Inheritance chain
# ---------------------------------------------------------------------------

async def get_inheritance_chain(
    db: AsyncSession,
    template_id: int,
) -> list[InheritanceChainItem]:
    """
    Walk up the parent chain and return an ordered list from root to leaf.

    The requested template is included as the last item.
    A visited set guards against cycles (which the DB schema does not prevent).
    """
    chain: list[Template] = []
    current_id: int | None = template_id
    visited: set[int] = set()

    while current_id is not None:
        if current_id in visited:
            break  # cycle guard
        visited.add(current_id)

        tmpl = await db.get(Template, current_id)
        if tmpl is None:
            if current_id == template_id:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Template {template_id} not found.",
                )
            break  # broken parent reference; return what we have

        chain.append(tmpl)
        current_id = tmpl.parent_template_id

    chain.reverse()  # root first, requested template last

    return [
        InheritanceChainItem(
            id=t.id,
            name=t.name,
            display_name=t.display_name,
            git_path=t.git_path,
            description=t.description,
        )
        for t in chain
    ]


# ---------------------------------------------------------------------------
# Product catalog endpoint
# ---------------------------------------------------------------------------

def _has_remote_datasources(git_svc: GitService, git_path: str | None) -> bool:
    """
    Return True if the template's .j2 frontmatter declares a non-empty
    ``data_sources`` list.  Returns False on any error (missing file, bad YAML).
    """
    if not git_path:
        return False
    try:
        content = git_svc.read_template(git_path)
        fm, _ = git_svc.parse_frontmatter(content)
        return bool(fm.get("data_sources"))
    except Exception:
        return False


def _build_breadcrumb(
    template_id: int,
    by_id: dict[int, Template],
) -> list[str]:
    """
    Walk the parent chain in memory and return an ordered list of
    ``display_name`` values from root ancestor to the given template.

    A visited set guards against cycles.
    """
    crumbs: list[str] = []
    current_id: int | None = template_id
    visited: set[int] = set()

    while current_id is not None and current_id not in visited:
        visited.add(current_id)
        tmpl = by_id.get(current_id)
        if tmpl is None:
            break
        crumbs.append(tmpl.display_name)
        current_id = tmpl.parent_template_id

    crumbs.reverse()
    return crumbs


async def get_product_catalog(
    db: AsyncSession,
    project_slug: str,
    git_svc: GitService,
) -> CatalogResponse:
    """
    Build the product catalog for a project identified by its slug (name).

    All active templates are returned in a flat list, each enriched with:
      - breadcrumb   — ancestry chain of display_names (root first)
      - parameter_count — active template-scope parameters registered for it
      - has_remote_datasources — parsed from the .j2 frontmatter
      - is_leaf      — True when the template has no active children

    Database access:
      1. One SELECT to find the project by name.
      2. One SELECT to load all active templates for the project.
      3. One SELECT to aggregate template-scope parameter counts.
    Plus one synchronous git read per template (for has_remote_datasources).
    """
    # --- 1. Resolve project by slug ----------------------------------------
    stmt = select(Project).where(Project.name == project_slug)
    result = await db.execute(stmt)
    proj = result.scalar_one_or_none()
    if proj is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project {project_slug!r} not found.",
        )

    # --- 2. Load all active templates ---------------------------------------
    stmt = (
        select(Template)
        .where(Template.project_id == proj.id, Template.is_active == True)
        .order_by(Template.sort_order, Template.name)
    )
    result = await db.execute(stmt)
    templates: list[Template] = list(result.scalars().all())

    if not templates:
        return CatalogResponse(
            project=CatalogProjectOut.model_validate(proj),
            templates=[],
        )

    template_ids = [t.id for t in templates]
    by_id: dict[int, Template] = {t.id: t for t in templates}

    # --- 3. Build child sets (to determine is_leaf) -------------------------
    children_of: dict[int, list[int]] = {t.id: [] for t in templates}
    for t in templates:
        if t.parent_template_id is not None and t.parent_template_id in children_of:
            children_of[t.parent_template_id].append(t.id)

    # --- 4. Aggregate template-scope parameter counts in one query ----------
    param_stmt = (
        select(Parameter.template_id, Parameter.id)
        .where(
            Parameter.template_id.in_(template_ids),
            Parameter.is_active == True,
        )
    )
    param_result = await db.execute(param_stmt)
    param_counts: dict[int, int] = {}
    for tid, _ in param_result.all():
        param_counts[tid] = param_counts.get(tid, 0) + 1

    # --- 5. Build catalog items ---------------------------------------------
    items: list[CatalogTemplateItem] = []
    for t in templates:
        items.append(
            CatalogTemplateItem(
                id=t.id,
                name=t.name,
                display_name=t.display_name,
                description=t.description,
                breadcrumb=_build_breadcrumb(t.id, by_id),
                parameter_count=param_counts.get(t.id, 0),
                has_remote_datasources=_has_remote_datasources(git_svc, t.git_path),
                is_leaf=len(children_of.get(t.id, [])) == 0,
            )
        )

    return CatalogResponse(
        project=CatalogProjectOut.model_validate(proj),
        templates=items,
    )
