"""
CRUD and helper operations for custom Jinja2 filters and context objects.

All write functions call ``db.flush()`` only — the calling router must
``await db.commit()`` to persist.

Cache invalidation
------------------
Whenever a filter or object is added or removed, the Jinja2 environment
cache for the affected project(s) must be evicted so the next render picks
up the change.  ``_invalidate_caches`` handles this.

Usage-check
-----------
``check_filter_usage`` scans the Git-backed .j2 files for a given filter
name using ``jinja_parser.extract_filters_used``.  This is called *after*
a soft-delete so the response can warn the caller which templates still
reference the removed filter.
"""

from __future__ import annotations

import logging

from fastapi import HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.custom_filter import CustomFilter
from api.models.custom_macro import CustomMacro
from api.models.custom_object import CustomObject
from api.models.project import Project
from api.models.template import Template
from api.schemas.admin import CustomFilterCreate, CustomMacroCreate, CustomObjectCreate
from api.services.environment_factory import EnvironmentFactory
from api.services.git_service import GitService, parse_frontmatter
from api.services.jinja_parser import extract_filters_used

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Custom Filters
# ---------------------------------------------------------------------------

async def list_filters(
    db: AsyncSession,
    scope: str | None = None,
    project_id: int | None = None,
) -> list[CustomFilter]:
    """Return all active custom filters, optionally filtered by scope / project."""
    q = select(CustomFilter).where(CustomFilter.is_active.is_(True))
    if scope is not None:
        q = q.where(CustomFilter.scope == scope)
    if project_id is not None:
        q = q.where(CustomFilter.project_id == project_id)
    result = await db.execute(q.order_by(CustomFilter.name))
    return list(result.scalars().all())


async def create_filter(
    db: AsyncSession,
    data: CustomFilterCreate,
    user_sub: str,
) -> CustomFilter:
    """
    Persist a new custom filter.

    The caller is responsible for sandbox-validating *data.code* before
    calling this function (via ``validate_and_compile`` + ``sandbox_test``).
    """
    cf = CustomFilter(
        name=data.name,
        code=data.code,
        description=data.description,
        scope=data.scope,
        project_id=data.project_id,
        created_by=user_sub,
    )
    db.add(cf)
    await db.flush()
    await _invalidate_caches(db, data.scope, data.project_id)
    return cf


async def delete_filter(db: AsyncSession, filter_id: int) -> CustomFilter:
    """
    Soft-delete a custom filter (sets ``is_active = False``).

    Raises ``HTTPException(404)`` if not found or already inactive.
    """
    result = await db.execute(
        select(CustomFilter).where(
            CustomFilter.id == filter_id,
            CustomFilter.is_active.is_(True),
        )
    )
    cf = result.scalar_one_or_none()
    if cf is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Custom filter {filter_id} not found",
        )
    cf.is_active = False
    await db.flush()
    await _invalidate_caches(db, cf.scope, cf.project_id)
    return cf


async def check_filter_usage(
    db: AsyncSession,
    filter_name: str,
    scope: str,
    project_id: int | None,
    git_svc: GitService,
) -> list[str]:
    """
    Scan .j2 files and return names of templates that reference *filter_name*.

    For project-scoped filters, only the filter's project is scanned.
    For global filters, all projects are scanned.
    Template files that cannot be read are silently skipped.
    """
    q = select(Template.git_path, Template.name).where(
        Template.is_active.is_(True),
        Template.git_path.isnot(None),
    )
    if scope == "project" and project_id is not None:
        q = q.where(Template.project_id == project_id)

    result = await db.execute(q)
    templates = result.all()

    used_in: list[str] = []
    for git_path, tmpl_name in templates:
        try:
            content = git_svc.read_template(git_path)
            _, body = parse_frontmatter(content)
            filters_used = extract_filters_used(body)
            if filter_name in filters_used:
                used_in.append(tmpl_name)
        except Exception:
            # Missing file, parse error, etc. — skip silently
            continue

    return used_in


# ---------------------------------------------------------------------------
# Custom Objects
# ---------------------------------------------------------------------------

async def list_objects(
    db: AsyncSession,
    project_id: int | None = None,
) -> list[CustomObject]:
    """Return all active custom objects, optionally filtered by project."""
    q = select(CustomObject).where(CustomObject.is_active.is_(True))
    if project_id is not None:
        q = q.where(
            or_(
                CustomObject.project_id.is_(None),
                CustomObject.project_id == project_id,
            )
        )
    result = await db.execute(q.order_by(CustomObject.name))
    return list(result.scalars().all())


async def create_object(
    db: AsyncSession,
    data: CustomObjectCreate,
    user_sub: str,
) -> CustomObject:
    """Persist a new custom context object."""
    co = CustomObject(
        name=data.name,
        code=data.code,
        description=data.description,
        project_id=data.project_id,
        created_by=user_sub,
    )
    db.add(co)
    await db.flush()
    scope = "project" if data.project_id else "global"
    await _invalidate_caches(db, scope, data.project_id)
    return co


async def delete_object(db: AsyncSession, object_id: int) -> CustomObject:
    """Soft-delete a custom object. Raises 404 if not found."""
    result = await db.execute(
        select(CustomObject).where(
            CustomObject.id == object_id,
            CustomObject.is_active.is_(True),
        )
    )
    co = result.scalar_one_or_none()
    if co is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Custom object {object_id} not found",
        )
    co.is_active = False
    await db.flush()
    scope = "project" if co.project_id else "global"
    await _invalidate_caches(db, scope, co.project_id)
    return co


# ---------------------------------------------------------------------------
# Custom Macros
# ---------------------------------------------------------------------------

async def list_macros(
    db: AsyncSession,
    scope: str | None = None,
    project_id: int | None = None,
) -> list[CustomMacro]:
    """Return all active custom macros, optionally filtered by scope / project."""
    q = select(CustomMacro).where(CustomMacro.is_active.is_(True))
    if scope is not None:
        q = q.where(CustomMacro.scope == scope)
    if project_id is not None:
        q = q.where(CustomMacro.project_id == project_id)
    result = await db.execute(q.order_by(CustomMacro.name))
    return list(result.scalars().all())


async def create_macro(
    db: AsyncSession,
    data: CustomMacroCreate,
    user_sub: str,
) -> CustomMacro:
    """Persist a new custom Jinja2 macro."""
    cm = CustomMacro(
        name=data.name,
        body=data.body,
        description=data.description,
        scope=data.scope,
        project_id=data.project_id,
        created_by=user_sub,
    )
    db.add(cm)
    await db.flush()
    await _invalidate_caches(db, data.scope, data.project_id)
    return cm


async def delete_macro(db: AsyncSession, macro_id: int) -> CustomMacro:
    """Soft-delete a custom macro. Raises 404 if not found."""
    result = await db.execute(
        select(CustomMacro).where(
            CustomMacro.id == macro_id,
            CustomMacro.is_active.is_(True),
        )
    )
    cm = result.scalar_one_or_none()
    if cm is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Custom macro {macro_id} not found",
        )
    cm.is_active = False
    await db.flush()
    await _invalidate_caches(db, cm.scope, cm.project_id)
    return cm


# ---------------------------------------------------------------------------
# Cache invalidation helper
# ---------------------------------------------------------------------------

async def _invalidate_caches(
    db: AsyncSession,
    scope: str,
    project_id: int | None,
) -> None:
    """
    Evict Jinja2 environment cache entries for all affected projects.

    - ``scope="project"``: evict only the given project
    - ``scope="global"``: evict all projects (global filters affect every env)
    """
    if scope == "project" and project_id is not None:
        EnvironmentFactory.invalidate(project_id)
    else:
        # Global scope — must evict every project's cached environment
        result = await db.execute(select(Project.id))
        for pid in result.scalars().all():
            EnvironmentFactory.invalidate(pid)
