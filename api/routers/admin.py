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

import inspect
import re
from collections import defaultdict
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.auth import TokenData, require_org_admin
from api.core.sandbox import SandboxError, sandbox_test, validate_and_compile
from api.database import get_db
from api.dependencies import get_git_service
from api.models.audit_log import AuditLog
from api.models.parameter import Parameter
from api.models.parameter_option import ParameterOption
from api.models.project import Project
from api.models.template import Template
from api.schemas.admin import (
    AuditLogListOut,
    AuditLogOut,
    CustomFilterCreate,
    CustomFilterDeleteOut,
    CustomFilterOut,
    CustomFilterUpdate,
    CustomMacroCreate,
    CustomMacroDeleteOut,
    CustomMacroOut,
    CustomMacroUpdate,
    CustomObjectCreate,
    CustomObjectDeleteOut,
    CustomObjectOut,
    CustomObjectUpdate,
    DuplicateParameterGroup,
    DuplicateTemplateRef,
    DuplicatesReport,
    FilterTestRequest,
    FilterTestResult,
    GitRemoteActionOut,
    GitRemoteStatusOut,
    GitRemoteTestOut,
    GitSyncRequest,
    PromoteReport,
    PromoteRequest,
    PromoteTemplateRewrite,
    SyncReport,
    SyncStatusReport,
)
from api.core.secrets import SecretNotFoundError, SecretResolver
from api.services import custom_filter_service, git_sync_service
from api.services.audit_log_service import log_write
from api.services.git_service import GitService, GitServiceError, parse_frontmatter

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
    project_id: str,
    body: GitSyncRequest = GitSyncRequest(),
    db: AsyncSession = Depends(get_db),
    git_svc: GitService = Depends(get_git_service),
    _token: TokenData = Depends(require_org_admin),
) -> SyncReport:
    report = await git_sync_service.run_git_sync(
        db,
        project_id,
        git_svc,
        import_paths=body.import_paths,
        delete_paths=body.delete_paths,
    )
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
    project_id: str,
    db: AsyncSession = Depends(get_db),
    git_svc: GitService = Depends(get_git_service),
    _token: TokenData = Depends(require_org_admin),
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
    _token: TokenData = Depends(require_org_admin),
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
    token: TokenData = Depends(require_org_admin),
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
    project_id: str | None = Query(None, description="Filter by project ID"),
    db: AsyncSession = Depends(get_db),
    _token: TokenData = Depends(require_org_admin),
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
    _token: TokenData = Depends(require_org_admin),
) -> FilterTestResult:
    try:
        func = validate_and_compile(data.code)
        result = await sandbox_test(func, test_input=data.test_input)
        return FilterTestResult(ok=True, output=repr(result))
    except SandboxError as exc:
        return FilterTestResult(ok=False, error=str(exc))


@router.put(
    "/filters/{filter_id}",
    response_model=CustomFilterOut,
    summary="Update custom filter",
    description="Update the code and/or description of an existing custom filter. Code is re-validated in the sandbox.",
)
async def update_filter(
    filter_id: int,
    data: CustomFilterUpdate,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_org_admin),
) -> CustomFilterOut:
    try:
        func = validate_and_compile(data.code)
        await sandbox_test(func)
    except SandboxError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Sandbox validation failed: {exc}",
        ) from exc
    cf = await custom_filter_service.update_filter(db, filter_id, data)
    await log_write(db, token.sub, "update", "custom_filter", filter_id, {"description": data.description})
    await db.commit()
    return CustomFilterOut.model_validate(cf)


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
    token: TokenData = Depends(require_org_admin),
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
    token: TokenData = Depends(require_org_admin),
) -> CustomObjectOut:
    try:
        func = validate_and_compile(data.code)
        # Classes are used as namespace objects (not called with arguments),
        # so skip the argument-passing test — syntax/AST validation is enough.
        if not inspect.isclass(func):
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
    project_id: str | None = Query(None, description="Filter by project ID"),
    db: AsyncSession = Depends(get_db),
    _token: TokenData = Depends(require_org_admin),
) -> list[CustomObjectOut]:
    objects = await custom_filter_service.list_objects(db, project_id=project_id)
    return [CustomObjectOut.model_validate(o) for o in objects]


@router.put(
    "/objects/{object_id}",
    response_model=CustomObjectOut,
    summary="Update custom context object",
    description="Update the code and/or description of an existing custom context object. Code is re-validated in the sandbox.",
)
async def update_object(
    object_id: int,
    data: CustomObjectUpdate,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_org_admin),
) -> CustomObjectOut:
    try:
        func = validate_and_compile(data.code)
        if not inspect.isclass(func):
            await sandbox_test(func)
    except SandboxError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Sandbox validation failed: {exc}",
        ) from exc
    co = await custom_filter_service.update_object(db, object_id, data)
    await log_write(db, token.sub, "update", "custom_object", object_id, {"description": data.description})
    await db.commit()
    return CustomObjectOut.model_validate(co)


@router.delete(
    "/objects/{object_id}",
    response_model=CustomObjectDeleteOut,
    summary="Delete custom context object",
    description="Soft-delete a custom context object and invalidate the environment cache.",
)
async def delete_object(
    object_id: int,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_org_admin),
) -> CustomObjectDeleteOut:
    await custom_filter_service.delete_object(db, object_id)
    await log_write(db, token.sub, "delete", "custom_object", object_id)
    await db.commit()
    return CustomObjectDeleteOut(id=object_id)


# ---------------------------------------------------------------------------
# Custom Macros
# ---------------------------------------------------------------------------

@router.post(
    "/macros",
    response_model=CustomMacroOut,
    status_code=status.HTTP_201_CREATED,
    summary="Register custom Jinja2 macro",
    description=(
        "Register a reusable Jinja2 macro. The body must contain a complete "
        "``{%% macro <name>(...) %%}...{%% endmacro %%}`` definition where the "
        "macro name matches the ``name`` field. The macro is compiled and validated "
        "before storing, then becomes immediately available as a global callable in "
        "the relevant project environment(s)."
    ),
)
async def create_macro(
    data: CustomMacroCreate,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_org_admin),
) -> CustomMacroOut:
    import jinja2 as _jinja2

    # Validate that the body compiles and contains a macro with the given name
    try:
        env = _jinja2.Environment(undefined=_jinja2.Undefined, autoescape=False)
        tmpl = env.from_string(data.body)
        if not hasattr(tmpl.module, data.name):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    f"Macro body does not define a macro named '{data.name}'. "
                    f"Make sure the {{% macro {data.name}(...) %}} ... {{% endmacro %}} block is present."
                ),
            )
    except _jinja2.exceptions.TemplateSyntaxError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Jinja2 syntax error: {exc}",
        ) from exc

    cm = await custom_filter_service.create_macro(db, data, token.sub)
    await log_write(db, token.sub, "create", "custom_macro", cm.id, {"name": data.name, "scope": data.scope})
    await db.commit()
    return CustomMacroOut.model_validate(cm)


@router.get(
    "/macros",
    response_model=list[CustomMacroOut],
    summary="List custom macros",
    description="Return all active custom macros. Optionally filter by scope or project.",
)
async def list_macros(
    scope: str | None = Query(None, description="Filter by scope: 'global' or 'project'"),
    project_id: str | None = Query(None, description="Filter by project ID"),
    db: AsyncSession = Depends(get_db),
    _token: TokenData = Depends(require_org_admin),
) -> list[CustomMacroOut]:
    macros = await custom_filter_service.list_macros(db, scope=scope, project_id=project_id)
    return [CustomMacroOut.model_validate(m) for m in macros]


@router.put(
    "/macros/{macro_id}",
    response_model=CustomMacroOut,
    summary="Update custom macro",
    description="Update the body and/or description of an existing custom macro. Body is re-validated before saving.",
)
async def update_macro(
    macro_id: int,
    data: CustomMacroUpdate,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_org_admin),
) -> CustomMacroOut:
    import jinja2 as _jinja2

    # Load existing macro to get its name for validation
    from sqlalchemy import select as _select
    from api.models.custom_macro import CustomMacro as _CustomMacro
    result = await db.execute(
        _select(_CustomMacro).where(_CustomMacro.id == macro_id, _CustomMacro.is_active.is_(True))
    )
    existing = result.scalar_one_or_none()
    if existing is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Custom macro {macro_id} not found")

    try:
        env = _jinja2.Environment(undefined=_jinja2.Undefined, autoescape=False)
        tmpl = env.from_string(data.body)
        if not hasattr(tmpl.module, existing.name):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Macro body does not define a macro named '{existing.name}'.",
            )
    except _jinja2.exceptions.TemplateSyntaxError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Jinja2 syntax error: {exc}",
        ) from exc

    cm = await custom_filter_service.update_macro(db, macro_id, data)
    await log_write(db, token.sub, "update", "custom_macro", macro_id, {"description": data.description})
    await db.commit()
    return CustomMacroOut.model_validate(cm)


@router.delete(
    "/macros/{macro_id}",
    response_model=CustomMacroDeleteOut,
    summary="Delete custom macro",
    description="Soft-delete a custom macro and invalidate the environment cache.",
)
async def delete_macro(
    macro_id: int,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_org_admin),
) -> CustomMacroDeleteOut:
    await custom_filter_service.delete_macro(db, macro_id)
    await log_write(db, token.sub, "delete", "custom_macro", macro_id)
    await db.commit()
    return CustomMacroDeleteOut(id=macro_id)


# ---------------------------------------------------------------------------
# Duplicate parameter detection
# ---------------------------------------------------------------------------

@router.get(
    "/parameters/duplicates",
    response_model=DuplicatesReport,
    summary="Find duplicate template-scope parameters",
    description=(
        "Scans all active template-scope parameters within a project (or across all "
        "projects if no project_id is given) and returns groups of parameter names "
        "that appear in more than one template. Each group flags whether the definitions "
        "are consistent (same widget_type, required flag) or conflicting."
    ),
    tags=["Admin"],
)
async def find_duplicate_parameters(
    project_id: str | None = Query(None, description="Limit scan to a single project"),
    db: AsyncSession = Depends(get_db),
    _token: TokenData = Depends(require_org_admin),
) -> DuplicatesReport:
    # Load all active template-scope parameters joined to template + project
    stmt = (
        select(
            Parameter.id,
            Parameter.name,
            Parameter.widget_type,
            Parameter.label,
            Parameter.required,
            Template.id.label("template_id"),
            Template.name.label("template_name"),
            Template.display_name.label("template_display_name"),
            Template.project_id,
            Project.display_name.label("project_display_name"),
        )
        .join(Template, Parameter.template_id == Template.id)
        .join(Project, Template.project_id == Project.id)
        .where(Parameter.scope == "template")
        .where(Parameter.is_active.is_(True))
        .order_by(Template.project_id, Parameter.name, Template.display_name)
    )
    if project_id is not None:
        stmt = stmt.where(Template.project_id == project_id)

    rows = (await db.execute(stmt)).all()

    # Group by (project_id, param_name) in Python
    key_to_rows: dict[tuple[int, str], list] = defaultdict(list)
    for row in rows:
        key_to_rows[(row.project_id, row.name)].append(row)

    groups: list[DuplicateParameterGroup] = []
    for (proj_id, name), occurrences in sorted(key_to_rows.items()):
        if len(occurrences) < 2:
            continue

        widget_types = {r.widget_type for r in occurrences}
        required_flags = {r.required for r in occurrences}
        has_conflicts = len(widget_types) > 1 or len(required_flags) > 1

        groups.append(DuplicateParameterGroup(
            name=name,
            project_id=proj_id,
            project_display_name=occurrences[0].project_display_name,
            count=len(occurrences),
            has_conflicts=has_conflicts,
            templates=[
                DuplicateTemplateRef(
                    param_id=r.id,
                    template_id=r.template_id,
                    template_name=r.template_name,
                    template_display_name=r.template_display_name,
                    widget_type=r.widget_type,
                    label=r.label,
                    required=r.required,
                )
                for r in occurrences
            ],
        ))

    total_redundant = sum(g.count - 1 for g in groups)
    return DuplicatesReport(
        groups=groups,
        total_duplicate_names=len(groups),
        total_redundant_params=total_redundant,
    )


# ---------------------------------------------------------------------------
# Parameter promote
# ---------------------------------------------------------------------------

@router.post(
    "/parameters/promote",
    response_model=PromoteReport,
    status_code=status.HTTP_200_OK,
    summary="Promote template parameters to project/global scope",
    description=(
        "Promote a duplicate template-scope parameter to project or global scope.\n\n"
        "**Steps performed atomically:**\n"
        "1. Validate all occurrences are consistent (same widget_type and required flag).\n"
        "2. Create a new parameter with the promoted name and scope.\n"
        "3. Copy parameter options from the first occurrence.\n"
        "4. Soft-delete all template-scope copies.\n"
        "5. Rewrite each affected `.j2` file body, replacing `{{ from_name }}` with "
        "`{{ to_name }}` (including filter chains).\n\n"
        "The `to_name` must start with `proj.` (project scope) or `glob.` (global scope)."
    ),
    tags=["Admin"],
)
async def promote_parameter(
    data: PromoteRequest,
    db: AsyncSession = Depends(get_db),
    git_svc: GitService = Depends(get_git_service),
    token: TokenData = Depends(require_org_admin),
) -> PromoteReport:
    # 1. Find all matching template-scope parameters in the project
    stmt = (
        select(
            Parameter.id,
            Parameter.widget_type,
            Parameter.label,
            Parameter.description,
            Parameter.help_text,
            Parameter.default_value,
            Parameter.required,
            Parameter.validation_regex,
            Parameter.is_derived,
            Parameter.derived_expression,
            Template.id.label("template_id"),
            Template.name.label("template_name"),
            Template.git_path,
        )
        .join(Template, Parameter.template_id == Template.id)
        .where(Parameter.scope == "template")
        .where(Parameter.is_active.is_(True))
        .where(Parameter.name == data.from_name)
        .where(Template.project_id == data.project_id)
    )
    rows = (await db.execute(stmt)).all()

    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No active template-scope parameters named {data.from_name!r} found in project {data.project_id}.",
        )

    # 2. Reject if definitions conflict
    widget_types = {r.widget_type for r in rows}
    required_flags = {r.required for r in rows}
    if len(widget_types) > 1 or len(required_flags) > 1:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "Parameter definitions have conflicts (different widget_type or required flag). "
                "Resolve conflicts manually before promoting."
            ),
        )

    # 3. Determine new scope from name prefix
    if data.to_name.startswith("proj."):
        new_scope = "project"
    elif data.to_name.startswith("glob."):
        new_scope = "global"
    else:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Promoted parameter name must start with 'proj.' (project scope) or 'glob.' (global scope).",
        )

    # 4. Load project to get organization_id
    project_obj = (
        await db.execute(select(Project).where(Project.id == data.project_id))
    ).scalar_one_or_none()
    if not project_obj:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Project {data.project_id} not found.")

    first = rows[0]

    # 5. Create promoted parameter
    new_param = Parameter(
        name=data.to_name,
        scope=new_scope,
        organization_id=project_obj.organization_id if new_scope == "global" else None,
        project_id=data.project_id if new_scope == "project" else None,
        widget_type=first.widget_type,
        label=first.label,
        description=first.description,
        help_text=first.help_text,
        default_value=first.default_value,
        required=first.required,
        validation_regex=first.validation_regex,
        is_derived=first.is_derived,
        derived_expression=first.derived_expression,
        sort_order=0,
        is_active=True,
    )
    db.add(new_param)
    await db.flush()
    await db.refresh(new_param)

    # 6. Copy options from first occurrence
    source_options = (
        await db.execute(
            select(ParameterOption)
            .where(ParameterOption.parameter_id == first.id)
            .order_by(ParameterOption.sort_order)
        )
    ).scalars().all()
    for opt in source_options:
        db.add(ParameterOption(
            parameter_id=new_param.id,
            value=opt.value,
            label=opt.label,
            condition_param=opt.condition_param,
            condition_value=opt.condition_value,
            sort_order=opt.sort_order,
        ))
    await db.flush()

    # 7. Soft-delete old template-scope parameters
    param_ids = [r.id for r in rows]
    for pid in param_ids:
        p = (await db.execute(select(Parameter).where(Parameter.id == pid))).scalar_one()
        p.is_active = False
    await db.flush()

    # 8. Rewrite .j2 files — replace {{ from_name }} with {{ to_name }} in body only
    #    Pattern: word-boundary match so "service_id" ≠ "some_service_id"
    escaped = re.escape(data.from_name)
    var_pattern = re.compile(
        r"(?<![a-zA-Z0-9_.])" + escaped + r"(?![a-zA-Z0-9_.])"
    )
    fm_re = re.compile(r"^(---\r?\n.*?\r?\n---\r?\n?)", re.DOTALL)

    seen_paths: set[str] = set()
    template_rewrites: list[PromoteTemplateRewrite] = []
    git_files_rewritten = 0

    for row in rows:
        if not row.git_path or row.git_path in seen_paths:
            continue
        seen_paths.add(row.git_path)

        try:
            content = git_svc.read_template(row.git_path)
            _, body = parse_frontmatter(content)
            new_body, count = var_pattern.subn(data.to_name, body)

            if count > 0:
                # Preserve raw frontmatter block, swap in updated body
                fm_match = fm_re.match(content)
                raw_fm = fm_match.group(1) if fm_match else ""
                new_content = raw_fm + new_body
                git_svc.write_template(
                    row.git_path,
                    new_content,
                    message=f"promote: {data.from_name} → {data.to_name}",
                    author=token.sub,
                )
                git_files_rewritten += 1
                template_rewrites.append(PromoteTemplateRewrite(
                    template_id=row.template_id,
                    template_name=row.template_name,
                    git_path=row.git_path,
                    rewritten=True,
                    replacements=count,
                ))
            else:
                template_rewrites.append(PromoteTemplateRewrite(
                    template_id=row.template_id,
                    template_name=row.template_name,
                    git_path=row.git_path,
                    rewritten=False,
                    replacements=0,
                ))
        except Exception as exc:
            template_rewrites.append(PromoteTemplateRewrite(
                template_id=row.template_id,
                template_name=row.template_name,
                git_path=row.git_path,
                rewritten=False,
                replacements=0,
                error=str(exc),
            ))

    await log_write(db, token.sub, "create", "parameter", new_param.id, {
        "action": "promote",
        "from_name": data.from_name,
        "to_name": data.to_name,
        "project_id": data.project_id,
        "deleted_param_ids": param_ids,
        "git_files_rewritten": git_files_rewritten,
    })
    await db.commit()

    return PromoteReport(
        created_param_id=new_param.id,
        deleted_param_ids=param_ids,
        templates_updated=len(rows),
        git_files_rewritten=git_files_rewritten,
        template_rewrites=template_rewrites,
    )


# ---------------------------------------------------------------------------
# Remote Git operations
# ---------------------------------------------------------------------------

async def _get_project_or_404(project_id: str, db: AsyncSession) -> "Project":
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


async def _resolve_remote_credential(
    project: "Project",
    db: AsyncSession,
    token: TokenData,
) -> str | None:
    """Resolve the project's remote_credential_ref to a plaintext value, or None."""
    if not project.remote_credential_ref:
        return None
    resolver = SecretResolver(db=db, org_id=token.org_id)
    try:
        return await resolver.resolve(project.remote_credential_ref)
    except SecretNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Cannot resolve remote credential: {exc}",
        ) from exc


@router.get(
    "/git-remote/{project_id}/status",
    response_model=GitRemoteStatusOut,
    summary="Remote Git status — ahead/behind check",
    description=(
        "Fetch the configured remote and compare local HEAD with "
        "``origin/<branch>``.\n\n"
        "Returns one of the following statuses:\n"
        "- ``no_remote`` — project has no ``remote_url`` configured\n"
        "- ``not_cloned`` — project directory has not been cloned yet\n"
        "- ``in_sync`` — local and remote are at the same commit\n"
        "- ``ahead`` — local has commits not on remote (push available)\n"
        "- ``behind`` — remote has commits not locally (pull available)\n"
        "- ``diverged`` — both sides have unique commits\n"
        "- ``error`` — fetch or comparison failed\n\n"
        "Does **not** modify any data."
    ),
)
async def get_remote_status(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    git_svc: GitService = Depends(get_git_service),
    token: TokenData = Depends(require_org_admin),
) -> GitRemoteStatusOut:
    project = await _get_project_or_404(project_id, db)

    if not project.remote_url:
        return GitRemoteStatusOut(
            has_remote=False,
            remote_url=None,
            remote_branch=project.remote_branch,
            local_sha=None,
            remote_sha=None,
            ahead=0,
            behind=0,
            status="no_remote",
            message="No remote_url configured for this project.",
        )

    credential = await _resolve_remote_credential(project, db, token)
    git_path = project.git_path or project.name
    result = git_svc.get_remote_status(
        project_git_path=git_path,
        remote_url=project.remote_url,
        branch=project.remote_branch,
        credential=credential,
    )

    return GitRemoteStatusOut(
        has_remote=True,
        remote_url=project.remote_url,
        remote_branch=project.remote_branch,
        **result,
    )


@router.post(
    "/git-remote/{project_id}/clone",
    response_model=GitRemoteActionOut,
    summary="Remote Git — initial clone",
    description=(
        "Clone the project's ``remote_url`` into the local ``git_path`` "
        "directory.\n\n"
        "**Idempotent** — safe to call multiple times; if the directory is "
        "already a Git repository the call is a no-op.\n\n"
        "Requires ``remote_url`` to be set on the project."
    ),
)
async def clone_remote(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    git_svc: GitService = Depends(get_git_service),
    token: TokenData = Depends(require_org_admin),
) -> GitRemoteActionOut:
    project = await _get_project_or_404(project_id, db)

    if not project.remote_url:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Project has no remote_url configured.",
        )

    credential = await _resolve_remote_credential(project, db, token)
    git_path = project.git_path or project.name
    try:
        git_svc.clone_from_remote(
            project_git_path=git_path,
            remote_url=project.remote_url,
            branch=project.remote_branch,
            credential=credential,
        )
    except GitServiceError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc

    await log_write(db, token.sub, "create", "project", project_id, {"action": "git_clone", "remote_url": project.remote_url})
    await db.commit()

    return GitRemoteActionOut(success=True, message="Clone completed successfully.")


@router.post(
    "/git-remote/{project_id}/pull",
    response_model=GitRemoteActionOut,
    summary="Remote Git — pull (fast-forward only)",
    description=(
        "Fetch from the remote and merge using ``--ff-only``.\n\n"
        "Returns an error if the local branch has diverged from the remote "
        "(force-push is never performed).\n\n"
        "Requires the project to be cloned first (``POST /admin/git-remote/{id}/clone``)."
    ),
)
async def pull_remote(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    git_svc: GitService = Depends(get_git_service),
    token: TokenData = Depends(require_org_admin),
) -> GitRemoteActionOut:
    project = await _get_project_or_404(project_id, db)

    if not project.remote_url:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Project has no remote_url configured.",
        )

    credential = await _resolve_remote_credential(project, db, token)
    git_path = project.git_path or project.name
    try:
        result = git_svc.pull_remote(
            project_git_path=git_path,
            remote_url=project.remote_url,
            branch=project.remote_branch,
            credential=credential,
        )
    except GitServiceError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    await log_write(db, token.sub, "update", "project", project_id, {"action": "git_pull", "new_sha": result["new_sha"]})
    await db.commit()

    return GitRemoteActionOut(
        success=True,
        message="Pull successful.",
        new_sha=result["new_sha"],
    )


@router.post(
    "/git-remote/{project_id}/push",
    response_model=GitRemoteActionOut,
    summary="Remote Git — push",
    description=(
        "Push local commits to the remote.\n\n"
        "Checks that local is not behind remote before pushing. Returns "
        "an error if the local branch is behind (pull first to resolve).\n\n"
        "Force-push is **never** performed."
    ),
)
async def push_remote(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    git_svc: GitService = Depends(get_git_service),
    token: TokenData = Depends(require_org_admin),
) -> GitRemoteActionOut:
    project = await _get_project_or_404(project_id, db)

    if not project.remote_url:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Project has no remote_url configured.",
        )

    credential = await _resolve_remote_credential(project, db, token)
    git_path = project.git_path or project.name
    try:
        result = git_svc.push_remote(
            project_git_path=git_path,
            remote_url=project.remote_url,
            branch=project.remote_branch,
            credential=credential,
        )
    except GitServiceError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    await log_write(db, token.sub, "update", "project", project_id, {"action": "git_push", "new_sha": result["new_sha"]})
    await db.commit()

    return GitRemoteActionOut(
        success=True,
        message="Push successful.",
        new_sha=result["new_sha"],
    )


@router.post(
    "/git-remote/{project_id}/test",
    response_model=GitRemoteTestOut,
    summary="Remote Git — test connection",
    description=(
        "Verify that the configured remote URL is reachable and the target branch "
        "exists, using ``git ls-remote`` (no local clone required).\n\n"
        "Safe to call at any time — does **not** modify any local or remote state."
    ),
)
async def test_remote_connection(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    git_svc: GitService = Depends(get_git_service),
    token: TokenData = Depends(require_org_admin),
) -> GitRemoteTestOut:
    project = await _get_project_or_404(project_id, db)

    if not project.remote_url:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Project has no remote_url configured.",
        )

    credential = await _resolve_remote_credential(project, db, token)
    result = git_svc.test_remote_connection(
        remote_url=project.remote_url,
        branch=project.remote_branch,
        credential=credential,
    )

    return GitRemoteTestOut(**result)
