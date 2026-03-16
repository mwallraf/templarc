"""
Git sync service — import and drift-check templates between Git and the DB.

Public API:
  run_git_sync(db, project_id, git_svc)  → SyncReport
  get_sync_status(db, project_id, git_svc) → SyncStatusReport

Design decisions:
  - Each file import is wrapped in a savepoint (db.begin_nested()) so that a
    single bad file never aborts the rest of the sync run.
  - The service calls db.flush() but never db.commit() — the caller (router)
    is responsible for committing.
  - Fragment files (is_fragment: true in frontmatter) are enumerated in the
    report but never imported as catalog templates.
  - .gitkeep files are always silently skipped (they're directory placeholders).
  - Template names are derived from the file's stem relative to the project
    git_path; subdirectory separators are replaced with underscores.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import HTTPException, status
from sqlalchemy import delete as sql_delete
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.parameter import Parameter, ParameterScope
from api.models.parameter_option import ParameterOption
from api.models.project import Project
from api.models.template import Template
from api.schemas.admin import (
    SyncDeletedTemplate,
    SyncErrorItem,
    SyncImportedTemplate,
    SyncReport,
    SyncStatusItem,
    SyncStatusReport,
)
from api.services.git_service import GitService


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_VALID_WIDGET_TYPES = frozenset(
    {"text", "number", "select", "multiselect", "textarea", "readonly", "hidden"}
)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

async def _get_project_or_404(db: AsyncSession, project_id: str) -> Project:
    proj = await db.get(Project, project_id)
    if proj is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project {project_id} not found.",
        )
    return proj


def _derive_name(git_path: str, project_git_path: str) -> str:
    """
    Derive a slug-style template name from a git file path.

    The relative path within the project directory is flattened:
    subdirectory separators become underscores, and the ``.j2`` extension
    is stripped.

    Examples::

        _derive_name("cisco/cisco_891.j2", "cisco")         → "cisco_891"
        _derive_name("cisco/ios/base.j2",  "cisco")         → "ios_base"
        _derive_name("templates/foo.j2",   "templates")     → "foo"

    Returns at most 100 characters (the DB column limit).
    """
    rel = Path(git_path)
    if project_git_path:
        try:
            rel = rel.relative_to(project_git_path)
        except ValueError:
            pass  # use the full path as-is if relative_to fails

    parts = list(rel.parts)
    # Replace the last part (filename) with its stem (drop .j2)
    parts[-1] = rel.stem
    name = "_".join(parts)
    return name[:100]


def _parse_widget_type(raw: object) -> str:
    """Return a valid WidgetType string, defaulting to 'text' if unrecognised."""
    w = str(raw).lower() if raw is not None else "text"
    return w if w in _VALID_WIDGET_TYPES else "text"


# ---------------------------------------------------------------------------
# run_git_sync
# ---------------------------------------------------------------------------

async def run_git_sync(
    db: AsyncSession,
    project_id: str,
    git_svc: GitService,
    import_paths: list[str] | None = None,
    delete_paths: list[str] | None = None,
) -> SyncReport:
    """
    Scan the project's Git directory and import/delete templates selectively.

    Parameters
    ----------
    import_paths:
        When provided, only these git paths are imported (must be in_git_only).
        When None, all new git files are imported.
    delete_paths:
        When provided, DB records with these git_paths are deleted.
        When None, no deletions are performed.

    Each import is wrapped in a savepoint; an error on one file does not
    abort the rest of the run.

    The caller must call ``db.commit()`` to persist the changes.
    """
    proj = await _get_project_or_404(db, project_id)
    project_git_path = proj.git_path or proj.name

    # ---------------------------------------------------------------------------
    # Import project.yaml (project metadata + proj.* params)
    # Only imports fields/params not already present in DB (DB wins after first write).
    # project.yaml itself is a .yaml file and is never picked up as a template.
    # ---------------------------------------------------------------------------
    project_yaml = git_svc.read_project_yaml(project_git_path)
    if project_yaml:
        proj_updated = False
        if project_yaml.get("display_name") and proj.display_name == proj.name:
            proj.display_name = str(project_yaml["display_name"])
            proj_updated = True
        if project_yaml.get("description") and proj.description is None:
            proj.description = str(project_yaml["description"])
            proj_updated = True
        if project_yaml.get("output_comment_style") and proj.output_comment_style == "#":
            proj.output_comment_style = str(project_yaml["output_comment_style"])
            proj_updated = True
        if proj_updated:
            await db.flush()

        for sort_idx, p_data in enumerate(project_yaml.get("parameters") or []):
            if not isinstance(p_data, dict):
                continue
            p_name: str | None = p_data.get("name")
            if not p_name or not p_name.startswith("proj."):
                continue  # project.yaml only defines proj.* params
            exists = await db.execute(
                select(Parameter.id).where(
                    Parameter.name == p_name,
                    Parameter.scope == ParameterScope.project,
                    Parameter.project_id == project_id,
                )
            )
            if exists.scalar_one_or_none() is not None:
                continue  # already in DB — DB is authoritative
            default_raw = p_data.get("default_value") or p_data.get("default")
            param = Parameter(
                name=p_name,
                scope=ParameterScope.project,
                project_id=project_id,
                widget_type=_parse_widget_type(p_data.get("widget", "text")),
                label=p_data.get("label"),
                description=p_data.get("description"),
                default_value=str(default_raw) if default_raw is not None else None,
                required=bool(p_data.get("required", False)),
                sort_order=sort_idx,
            )
            db.add(param)
            await db.flush()

    git_files = git_svc.list_templates(project_git_path)

    # Load all git_paths already registered for this project
    stmt = select(Template.git_path).where(
        Template.project_id == project_id,
        Template.git_path.is_not(None),
    )
    result = await db.execute(stmt)
    existing_paths: set[str] = {row[0] for row in result.all()}

    # When import_paths is provided, restrict imports to that explicit set
    import_filter: set[str] | None = set(import_paths) if import_paths is not None else None

    scanned = 0
    imported = 0
    already_registered = 0
    skipped_fragments = 0
    errors: list[SyncErrorItem] = []
    imported_templates: list[SyncImportedTemplate] = []

    for git_path in git_files:
        # Always skip directory placeholder files
        if Path(git_path).name == ".gitkeep":
            continue

        scanned += 1

        # Already registered — idempotency
        if git_path in existing_paths:
            already_registered += 1
            continue

        # When a filter is active, skip files not explicitly selected
        if import_filter is not None and git_path not in import_filter:
            continue

        # Read + parse frontmatter (errors here skip the file)
        try:
            content = git_svc.read_template(git_path)
            fm, _ = git_svc.parse_frontmatter(content)
        except Exception as exc:
            errors.append(SyncErrorItem(git_path=git_path, error=str(exc)))
            continue

        # Fragment files — listed but not imported
        if fm.get("is_fragment"):
            skipped_fragments += 1
            continue

        # Import via savepoint so one bad file doesn't abort the whole run
        try:
            async with db.begin_nested():
                name = _derive_name(git_path, project_git_path)
                display_name: str = fm.get("display_name") or name.replace("_", " ").title()
                description: str | None = fm.get("description") or None

                # Auto-detect is_snippet: frontmatter flag OR path under snippets/
                is_snippet = bool(fm.get("is_snippet")) or f"{project_git_path}/snippets/" in git_path

                tmpl = Template(
                    project_id=project_id,
                    name=name,
                    display_name=display_name,
                    description=description,
                    git_path=git_path,
                    is_snippet=is_snippet,
                    sort_order=0,
                )
                db.add(tmpl)
                await db.flush()  # obtain tmpl.id

                # Register parameters declared in frontmatter.
                # Scope inferred from name prefix:
                #   glob.*  → global (organization)
                #   proj.*  → project
                #   others  → template
                # proj/glob params that already exist in the DB are skipped
                # (SELECT-first check avoids silent savepoint swallowing).
                params_data = fm.get("parameters") or []
                for sort_idx, p_data in enumerate(params_data):
                    if not isinstance(p_data, dict):
                        continue
                    p_name: str | None = p_data.get("name")
                    if not p_name:
                        continue

                    default_raw = p_data.get("default")

                    if p_name.startswith("glob."):
                        p_scope = ParameterScope.global_
                        p_kwargs: dict = {"organization_id": proj.organization_id}
                        exists_stmt = select(Parameter.id).where(
                            Parameter.name == p_name,
                            Parameter.scope == ParameterScope.global_,
                            Parameter.organization_id == proj.organization_id,
                        )
                    elif p_name.startswith("proj."):
                        p_scope = ParameterScope.project
                        p_kwargs = {"project_id": project_id}
                        exists_stmt = select(Parameter.id).where(
                            Parameter.name == p_name,
                            Parameter.scope == ParameterScope.project,
                            Parameter.project_id == project_id,
                        )
                    else:
                        p_scope = ParameterScope.template
                        p_kwargs = {"template_id": tmpl.id}
                        exists_stmt = None  # always new — template was just created

                    # Skip proj/glob params that already exist (idempotent)
                    if exists_stmt is not None:
                        existing = await db.execute(exists_stmt)
                        if existing.scalar_one_or_none() is not None:
                            continue

                    param = Parameter(
                        name=p_name,
                        scope=p_scope,
                        widget_type=_parse_widget_type(p_data.get("widget", "text")),
                        label=p_data.get("label"),
                        description=p_data.get("description"),
                        default_value=str(default_raw) if default_raw is not None else None,
                        required=bool(p_data.get("required", False)),
                        sort_order=sort_idx,
                        **p_kwargs,
                    )
                    db.add(param)
                    await db.flush()  # obtain param.id for options

                    options_data = p_data.get("options") or []
                    for opt_idx, opt in enumerate(options_data):
                        if not isinstance(opt, dict):
                            continue
                        opt_value = opt.get("value")
                        opt_label = opt.get("label")
                        if opt_value is None:
                            continue
                        db.add(ParameterOption(
                            parameter_id=param.id,
                            value=str(opt_value),
                            label=str(opt_label) if opt_label is not None else str(opt_value),
                            condition_param=opt.get("condition_param"),
                            condition_value=opt.get("condition_value"),
                            sort_order=opt_idx,
                        ))

            # Savepoint released (insert staged in outer transaction)
            imported += 1
            imported_templates.append(
                SyncImportedTemplate(
                    id=tmpl.id,
                    name=tmpl.name,
                    git_path=tmpl.git_path or git_path,
                )
            )

        except Exception as exc:
            errors.append(SyncErrorItem(git_path=git_path, error=str(exc)))
            # The savepoint was automatically rolled back on exception;
            # the outer transaction is still intact.

    # ---------------------------------------------------------------------------
    # Deletions
    # ---------------------------------------------------------------------------
    deleted = 0
    deleted_templates: list[SyncDeletedTemplate] = []

    if delete_paths:
        # Collect info before deleting (for the report)
        info_stmt = select(Template.id, Template.name, Template.git_path).where(
            Template.project_id == project_id,
            Template.git_path.in_(delete_paths),
        )
        info_result = await db.execute(info_stmt)
        for row in info_result.all():
            deleted_templates.append(
                SyncDeletedTemplate(id=row[0], name=row[1], git_path=row[2] or "")
            )

        if deleted_templates:
            await db.execute(
                sql_delete(Template).where(
                    Template.project_id == project_id,
                    Template.git_path.in_(delete_paths),
                )
            )
            deleted = len(deleted_templates)

    return SyncReport(
        scanned=scanned,
        imported=imported,
        already_registered=already_registered,
        skipped_fragments=skipped_fragments,
        deleted=deleted,
        errors=errors,
        imported_templates=imported_templates,
        deleted_templates=deleted_templates,
    )


# ---------------------------------------------------------------------------
# get_sync_status
# ---------------------------------------------------------------------------

async def get_sync_status(
    db: AsyncSession,
    project_id: str,
    git_svc: GitService,
) -> SyncStatusReport:
    """
    Non-destructive drift check: compare DB records against Git files.

    Classifies each path as one of:
    - ``in_sync``    — file exists in both Git and the DB
    - ``in_git_only`` — file exists in Git but has no DB record
    - ``in_db_only``  — DB record exists but the git file is missing
    - ``fragment``   — git file has ``is_fragment: true`` in frontmatter

    Does not modify any data.
    """
    proj = await _get_project_or_404(db, project_id)
    project_git_path = proj.git_path or proj.name

    # Collect git files (exclude .gitkeep)
    raw_git_files = git_svc.list_templates(project_git_path)
    git_file_set: set[str] = {
        f for f in raw_git_files if Path(f).name != ".gitkeep"
    }

    # Load all DB records (git_path + id + name) for this project
    stmt = select(Template.git_path, Template.id, Template.name).where(
        Template.project_id == project_id,
        Template.git_path.is_not(None),
    )
    result = await db.execute(stmt)
    # db_path_info: git_path → (id, name)
    db_path_info: dict[str, tuple[str, str]] = {
        row[0]: (row[1], row[2]) for row in result.all()
    }
    db_path_set: set[str] = set(db_path_info.keys())

    items: list[SyncStatusItem] = []
    skipped_fragments = 0

    # Evaluate each git file
    for git_path in sorted(git_file_set):
        # Check for fragment flag
        is_fragment = False
        try:
            content = git_svc.read_template(git_path)
            fm, _ = git_svc.parse_frontmatter(content)
            is_fragment = bool(fm.get("is_fragment"))
        except Exception:
            pass  # treat unreadable files as non-fragment

        if is_fragment:
            skipped_fragments += 1
            items.append(SyncStatusItem(git_path=git_path, status="fragment"))
            continue

        if git_path in db_path_set:
            items.append(SyncStatusItem(git_path=git_path, status="in_sync"))
        else:
            items.append(SyncStatusItem(git_path=git_path, status="in_git_only"))

    # DB paths that are absent from Git — include template id/name for the UI
    for git_path in sorted(db_path_set - git_file_set):
        tmpl_id, tmpl_name = db_path_info[git_path]
        items.append(
            SyncStatusItem(
                git_path=git_path,
                status="in_db_only",
                template_id=tmpl_id,
                template_name=tmpl_name,
            )
        )

    in_sync = sum(1 for i in items if i.status == "in_sync")
    in_db_only = sum(1 for i in items if i.status == "in_db_only")
    in_git_only = sum(1 for i in items if i.status == "in_git_only")

    return SyncStatusReport(
        in_sync=in_sync,
        in_db_only=in_db_only,
        in_git_only=in_git_only,
        skipped_fragments=skipped_fragments,
        items=items,
    )
