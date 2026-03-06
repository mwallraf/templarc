"""
Admin router — maintenance and operational endpoints.

Mounted at /admin in main.py. Current routes:
  POST /admin/git-sync/{project_id}        — import unregistered .j2 files from Git
  GET  /admin/git-sync/{project_id}/status — non-destructive drift check
  GET  /admin/audit-log                    — paginated audit trail (filters: user, type, dates)
  POST /admin/filters                      — register a custom Jinja2 filter
  GET  /admin/filters                      — list custom filters
  POST /admin/filters/test                 — sandbox-test a filter without storing
  DELETE /admin/filters/{filter_id}        — soft-delete a filter (warns if still used)
  POST /admin/objects                      — register a custom Jinja2 context object
  GET  /admin/objects                      — list custom objects
  DELETE /admin/objects/{object_id}        — soft-delete a context object

Auth: all endpoints require admin privileges.
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.auth import TokenData, require_admin
from api.core.sandbox import SandboxError, sandbox_test, validate_and_compile
from api.database import get_db
from api.dependencies import get_git_service
from api.models.audit_log import AuditLog
from api.schemas.admin import (
    AuditLogListOut,
    AuditLogOut,
    CustomFilterCreate,
    CustomFilterDeleteOut,
    CustomFilterOut,
    CustomObjectCreate,
    CustomObjectDeleteOut,
    CustomObjectOut,
    FilterTestRequest,
    FilterTestResult,
    SyncReport,
    SyncStatusReport,
)
from api.services import custom_filter_service, git_sync_service
from api.services.audit_log_service import log_write
from api.services.git_service import GitService

router = APIRouter()


@router.post(
    "/git-sync/{project_id}",
    response_model=SyncReport,
    status_code=status.HTTP_200_OK,
    summary="Git sync — import templates",
    description=(
        "Scan the project's Git directory for ``.j2`` files and import any that "
        "are not yet registered in the database.\n\n"
        "**Idempotent** — safe to run multiple times. Already-registered files "
        "are reported as ``already_registered`` and left unchanged.\n\n"
        "**Fragment files** (``is_fragment: true`` in frontmatter) are counted "
        "in ``skipped_fragments`` and never imported as catalog templates.\n\n"
        "Per-file errors do not abort the entire run; they are collected in the "
        "``errors`` list of the response."
    ),
)
async def run_git_sync(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    git_svc: GitService = Depends(get_git_service),
    _token: TokenData = Depends(require_admin),
) -> SyncReport:
    report = await git_sync_service.run_git_sync(db, project_id, git_svc)
    await db.commit()
    return report


@router.get(
    "/git-sync/{project_id}/status",
    response_model=SyncStatusReport,
    summary="Git sync status — drift check",
    description=(
        "Non-destructive comparison between Git files and DB records.\n\n"
        "Reports:\n"
        "- ``in_sync`` — file exists in both Git and the DB\n"
        "- ``in_git_only`` — file exists in Git but has no DB record "
        "(candidate for import via the POST endpoint)\n"
        "- ``in_db_only`` — DB record exists but the Git file is absent "
        "(orphaned or soft-deleted)\n"
        "- ``fragment`` — file has ``is_fragment: true`` in its frontmatter "
        "(include-only, not a catalog template)\n\n"
        "Does **not** modify any data."
    ),
)
async def get_sync_status(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    git_svc: GitService = Depends(get_git_service),
    _token: TokenData = Depends(require_admin),
) -> SyncStatusReport:
    return await git_sync_service.get_sync_status(db, project_id, git_svc)


# ---------------------------------------------------------------------------
# Audit log
# ---------------------------------------------------------------------------

@router.get(
    "/audit-log",
    response_model=AuditLogListOut,
    summary="Audit log — list write operations",
    description=(
        "Return a paginated list of audit log entries for all write operations "
        "(create, update, delete) on templates, parameters, projects, and secrets.\\n\\n"
        "Supports filtering by `user_sub`, `resource_type`, and date range."
    ),
)
async def list_audit_log(
    user_sub: str | None = Query(None, description="Filter by username (JWT sub)"),
    resource_type: str | None = Query(None, description="Filter by resource type"),
    date_from: datetime | None = Query(None, description="Include entries on or after this UTC timestamp"),
    date_to: datetime | None = Query(None, description="Include entries on or before this UTC timestamp"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    _token: TokenData = Depends(require_admin),
) -> AuditLogListOut:
    q = select(AuditLog)
    if user_sub:
        q = q.where(AuditLog.user_sub == user_sub)
    if resource_type:
        q = q.where(AuditLog.resource_type == resource_type)
    if date_from:
        q = q.where(AuditLog.timestamp >= date_from)
    if date_to:
        q = q.where(AuditLog.timestamp <= date_to)

    total_result = await db.execute(select(func.count()).select_from(q.subquery()))
    total: int = total_result.scalar_one()

    items_result = await db.execute(
        q.order_by(AuditLog.timestamp.desc()).limit(limit).offset(offset)
    )
    items = list(items_result.scalars().all())
    return AuditLogListOut(
        items=[AuditLogOut.model_validate(entry) for entry in items],
        total=total,
    )


# ---------------------------------------------------------------------------
# Custom Filters
# ---------------------------------------------------------------------------

@router.post(
    "/filters",
    response_model=CustomFilterOut,
    status_code=status.HTTP_201_CREATED,
    summary="Register custom filter",
    description=(
        "Register a new custom Jinja2 filter. The Python code is validated "
        "through the sandbox (AST check + restricted exec + 100 ms test run) "
        "before being stored. On success, the filter becomes immediately "
        "available in the relevant project environment(s)."
    ),
)
async def create_filter(
    data: CustomFilterCreate,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_admin),
) -> CustomFilterOut:
    # Validate and test in sandbox before storing
    try:
        func = validate_and_compile(data.code)
        await sandbox_test(func)
    except SandboxError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Sandbox validation failed: {exc}",
        ) from exc

    cf = await custom_filter_service.create_filter(db, data, token.sub)
    await log_write(db, token.sub, "create", "custom_filter", cf.id, {"name": data.name, "scope": data.scope})
    await db.commit()
    return CustomFilterOut.model_validate(cf)


@router.get(
    "/filters",
    response_model=list[CustomFilterOut],
    summary="List custom filters",
    description="Return all active custom filters. Optionally filter by scope or project.",
)
async def list_filters(
    scope: str | None = Query(None, description="Filter by scope: 'global' or 'project'"),
    project_id: int | None = Query(None, description="Filter by project ID"),
    db: AsyncSession = Depends(get_db),
    _token: TokenData = Depends(require_admin),
) -> list[CustomFilterOut]:
    filters = await custom_filter_service.list_filters(db, scope=scope, project_id=project_id)
    return [CustomFilterOut.model_validate(f) for f in filters]


@router.post(
    "/filters/test",
    response_model=FilterTestResult,
    summary="Test filter code in sandbox",
    description=(
        "Validate and run a filter function in the sandbox without storing it. "
        "Useful for testing filter code from the UI before committing."
    ),
)
async def test_filter(
    data: FilterTestRequest,
    _token: TokenData = Depends(require_admin),
) -> FilterTestResult:
    try:
        func = validate_and_compile(data.code)
        result = await sandbox_test(func, test_input=data.test_input)
        return FilterTestResult(ok=True, output=repr(result))
    except SandboxError as exc:
        return FilterTestResult(ok=False, error=str(exc))


@router.delete(
    "/filters/{filter_id}",
    response_model=CustomFilterDeleteOut,
    summary="Delete custom filter",
    description=(
        "Soft-delete a custom filter. The filter is deactivated immediately and "
        "the Jinja2 environment cache is invalidated. The response includes a "
        "``used_in_templates`` list naming any templates that still reference "
        "this filter — these templates may fail to render until updated."
    ),
)
async def delete_filter(
    filter_id: int,
    db: AsyncSession = Depends(get_db),
    git_svc: GitService = Depends(get_git_service),
    token: TokenData = Depends(require_admin),
) -> CustomFilterDeleteOut:
    cf = await custom_filter_service.delete_filter(db, filter_id)
    used_in = await custom_filter_service.check_filter_usage(
        db, cf.name, cf.scope, cf.project_id, git_svc
    )
    await log_write(db, token.sub, "delete", "custom_filter", filter_id)
    await db.commit()
    return CustomFilterDeleteOut(id=filter_id, used_in_templates=used_in)


# ---------------------------------------------------------------------------
# Custom Objects
# ---------------------------------------------------------------------------

@router.post(
    "/objects",
    response_model=CustomObjectOut,
    status_code=status.HTTP_201_CREATED,
    summary="Register custom context object",
    description=(
        "Register a Python class or factory function as a Jinja2 context object. "
        "The object will be available in templates as a global variable named "
        "after the ``name`` field. Code is sandbox-validated before storing."
    ),
)
async def create_object(
    data: CustomObjectCreate,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_admin),
) -> CustomObjectOut:
    try:
        func = validate_and_compile(data.code)
        await sandbox_test(func)
    except SandboxError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Sandbox validation failed: {exc}",
        ) from exc

    co = await custom_filter_service.create_object(db, data, token.sub)
    await log_write(db, token.sub, "create", "custom_object", co.id, {"name": data.name})
    await db.commit()
    return CustomObjectOut.model_validate(co)


@router.get(
    "/objects",
    response_model=list[CustomObjectOut],
    summary="List custom context objects",
    description="Return all active custom objects. Optionally filter by project.",
)
async def list_objects(
    project_id: int | None = Query(None, description="Filter by project ID"),
    db: AsyncSession = Depends(get_db),
    _token: TokenData = Depends(require_admin),
) -> list[CustomObjectOut]:
    objects = await custom_filter_service.list_objects(db, project_id=project_id)
    return [CustomObjectOut.model_validate(o) for o in objects]


@router.delete(
    "/objects/{object_id}",
    response_model=CustomObjectDeleteOut,
    summary="Delete custom context object",
    description="Soft-delete a custom context object and invalidate the environment cache.",
)
async def delete_object(
    object_id: int,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_admin),
) -> CustomObjectDeleteOut:
    await custom_filter_service.delete_object(db, object_id)
    await log_write(db, token.sub, "delete", "custom_object", object_id)
    await db.commit()
    return CustomObjectDeleteOut(id=object_id)
