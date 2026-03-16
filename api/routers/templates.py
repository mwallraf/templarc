"""
Templates router — template CRUD and analysis endpoints.

Mounted at /templates in main.py. Routes:
  GET    /templates                         — list templates (filter by project_id)
  GET    /templates/{id}                    — get template with full metadata
  POST   /templates                         — create template (writes .j2 to Git)
  PUT    /templates/{id}                    — update content + metadata (new Git commit)
  DELETE /templates/{id}                    — soft delete (is_active=False)
  GET    /templates/{id}/variables          — parsed variable refs with registry status
  GET    /templates/{id}/inheritance-chain  — full parent chain, root first
  GET    /templates/{id}/presets            — list render presets for a template
  POST   /templates/{id}/presets            — create a named render preset (admin)
  DELETE /templates/{id}/presets/{pid}      — delete a render preset (admin)

Auth:
  - GET endpoints: any authenticated user
  - POST/PUT/DELETE: admin only

GitService is shared with the catalog router via the same module-level singleton.
"""

from __future__ import annotations

import re
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import PlainTextResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.auth import TokenData, get_current_user, require_admin
from api.database import get_db
from api.dependencies import get_git_service
from api.models.parameter import Parameter, ParameterScope
from api.models.render_preset import RenderPreset
from api.schemas.catalog import (
    InheritanceChainItem,
    TemplateCreate,
    TemplateOut,
    TemplateUpdate,
    TemplateUpdateOut,
    TemplateUploadOut,
    VariableRefOut,
)
from api.schemas.render_preset import RenderPresetCreate, RenderPresetOut
from api.services import catalog_service
from api.services.audit_log_service import log_write
from api.services.git_service import GitService

_VALID_WIDGET_TYPES = frozenset(
    {"text", "number", "select", "multiselect", "textarea", "readonly", "hidden"}
)

router = APIRouter()


# ---------------------------------------------------------------------------
# Template list
# ---------------------------------------------------------------------------

@router.get(
    "",
    response_model=list[TemplateOut],
    summary="List templates",
    description=(
        "Return templates, optionally filtered by `project_id`. "
        "Only active templates are returned by default; pass `active_only=false` "
        "to include soft-deleted ones."
    ),
)
async def list_templates(
    project_id: str | None = None,
    active_only: bool = True,
    db: AsyncSession = Depends(get_db),
    _token: TokenData = Depends(get_current_user),
) -> list[TemplateOut]:
    templates = await catalog_service.list_templates(db, project_id=project_id, active_only=active_only)
    return [TemplateOut.model_validate(t) for t in templates]


# ---------------------------------------------------------------------------
# Template upload (multipart .j2 file import)
# ---------------------------------------------------------------------------

@router.post(
    "/upload",
    response_model=TemplateUploadOut,
    status_code=status.HTTP_201_CREATED,
    summary="Upload and import a .j2 template file",
    description=(
        "Upload a Jinja2 `.j2` file and import it into the specified project.\n\n"
        "- YAML frontmatter (`parameters`, `display_name`, `description`) is parsed "
        "and used to populate the template record and register parameters.\n"
        "- The template name is derived from the uploaded filename (sanitised to "
        "`[a-zA-Z0-9_]+`). A `409` is returned if a template with the same name "
        "already exists in the project.\n"
        "- Fragment files (`is_fragment: true` in frontmatter) are rejected with `400`.\n"
        "- `suggested_parameters` in the response lists Jinja2 variable references "
        "found in the body that were NOT declared in the frontmatter."
    ),
)
async def upload_template(
    file: UploadFile = File(..., description="A `.j2` Jinja2 template file"),
    project_id: str = Form(..., description="ID of the project to import into"),
    author: str = Form(default="", description="Git commit author (defaults to the authenticated username)"),
    db: AsyncSession = Depends(get_db),
    git_svc: GitService = Depends(get_git_service),
    token: TokenData = Depends(require_admin),
) -> TemplateUploadOut:
    raw_bytes = await file.read()
    try:
        content = raw_bytes.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="File is not valid UTF-8 text.")

    fm, body = git_svc.parse_frontmatter(content)

    if fm.get("is_fragment"):
        raise HTTPException(status_code=400, detail="Fragment files (is_fragment: true) cannot be imported as catalog templates.")

    # Derive template name from filename, sanitise to [a-zA-Z0-9_]+
    stem = Path(file.filename or "imported").stem
    name = re.sub(r"[^a-zA-Z0-9_]", "_", stem).strip("_") or "imported"
    name = name[:100]

    display_name: str = fm.get("display_name") or name.replace("_", " ").title()
    description: str | None = fm.get("description") or None

    data = TemplateCreate(
        project_id=project_id,
        name=name,
        display_name=display_name,
        description=description,
        content=content,
        author=author or token.sub,
    )

    try:
        tmpl = await catalog_service.create_template(db, data, git_svc)
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail=f"A template named '{name}' already exists in this project.",
        )

    # Register parameters declared in frontmatter
    params_data = fm.get("parameters") or []
    registered_names: set[str] = set()
    params_registered = 0
    for sort_idx, p_data in enumerate(params_data):
        if not isinstance(p_data, dict):
            continue
        p_name: str | None = p_data.get("name")
        if not p_name:
            continue
        w = str(p_data.get("widget", "text")).lower()
        widget = w if w in _VALID_WIDGET_TYPES else "text"
        default_raw = p_data.get("default")
        param = Parameter(
            name=p_name,
            scope=ParameterScope.template,
            template_id=tmpl.id,
            widget_type=widget,
            label=p_data.get("label"),
            description=p_data.get("description"),
            default_value=str(default_raw) if default_raw is not None else None,
            required=bool(p_data.get("required", False)),
            sort_order=sort_idx,
        )
        db.add(param)
        registered_names.add(p_name)
        params_registered += 1

    if params_registered:
        await db.flush()

    # Suggested parameters: AST variables not covered by frontmatter
    from api.services.jinja_parser import extract_variables
    suggested: list[VariableRefOut] = []
    try:
        for ref in extract_variables(body):
            if ref.full_path not in registered_names:
                suggested.append(VariableRefOut(
                    name=ref.name,
                    type=ref.type,
                    full_path=ref.full_path,
                    is_registered=False,
                ))
    except Exception:
        pass  # non-fatal: bad Jinja2 syntax won't block the import

    await log_write(db, token.sub, "create", "template", tmpl.id, {"via": "upload", "filename": file.filename})
    await db.commit()

    return TemplateUploadOut(
        template=TemplateOut.model_validate(tmpl),
        parameters_registered=params_registered,
        suggested_parameters=suggested,
    )


# ---------------------------------------------------------------------------
# Template detail
# ---------------------------------------------------------------------------

@router.get(
    "/{template_id}",
    response_model=TemplateOut,
    summary="Get template",
    description="Fetch a template record by ID.",
)
async def get_template(
    template_id: str,
    db: AsyncSession = Depends(get_db),
    _token: TokenData = Depends(get_current_user),
) -> TemplateOut:
    tmpl = await catalog_service.get_template(db, template_id)
    return TemplateOut.model_validate(tmpl)


# ---------------------------------------------------------------------------
# Template create
# ---------------------------------------------------------------------------

@router.post(
    "",
    response_model=TemplateOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create template",
    description=(
        "Create a template record and write its initial `.j2` file to Git.\n\n"
        "- `parent_template_id` must belong to the same project if provided.\n"
        "- `git_path` is auto-generated as `{project.git_path}/{name}.j2` if omitted.\n"
        "- If `content` is empty, a minimal frontmatter stub is written."
    ),
)
async def create_template(
    data: TemplateCreate,
    db: AsyncSession = Depends(get_db),
    git_svc: GitService = Depends(get_git_service),
    token: TokenData = Depends(require_admin),
) -> TemplateOut:
    tmpl = await catalog_service.create_template(db, data, git_svc)
    await log_write(db, token.sub, "create", "template", tmpl.id, data.model_dump(exclude={"content"}))
    await db.commit()
    return TemplateOut.model_validate(tmpl)


# ---------------------------------------------------------------------------
# Template update
# ---------------------------------------------------------------------------

@router.put(
    "/{template_id}",
    response_model=TemplateUpdateOut,
    summary="Update template",
    description=(
        "Update template metadata and, when `content` is provided, write a new "
        "Git commit with the updated `.j2` file.\n\n"
        "The response always includes a `suggested_parameters` list — variable "
        "references parsed from the new body, annotated with `is_registered` to "
        "show which are already in the parameter registry."
    ),
)
async def update_template(
    template_id: str,
    data: TemplateUpdate,
    db: AsyncSession = Depends(get_db),
    git_svc: GitService = Depends(get_git_service),
    token: TokenData = Depends(require_admin),
) -> TemplateUpdateOut:
    result = await catalog_service.update_template(db, template_id, data, git_svc)
    await log_write(db, token.sub, "update", "template", template_id, data.model_dump(exclude_none=True, exclude={"content"}))
    await db.commit()
    return result


# ---------------------------------------------------------------------------
# Template delete
# ---------------------------------------------------------------------------

@router.delete(
    "/{template_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
    summary="Delete template",
    description=(
        "Delete a template: removes the `.j2` file from Git and the DB record."
    ),
)
async def delete_template(
    template_id: str,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_admin),
    git_svc: GitService = Depends(get_git_service),
) -> None:
    await catalog_service.delete_template(db, template_id, git_svc, author=token.sub)
    await log_write(db, token.sub, "delete", "template", template_id)
    await db.commit()


# ---------------------------------------------------------------------------
# Template raw body (frontmatter stripped)
# ---------------------------------------------------------------------------

@router.get(
    "/{template_id}/content",
    response_class=PlainTextResponse,
    summary="Get template body",
    description=(
        "Return the raw Jinja2 body of the template's `.j2` file, with YAML "
        "frontmatter stripped. Returns an empty string if the file does not "
        "exist in the repository yet."
    ),
)
async def get_template_content(
    template_id: str,
    db: AsyncSession = Depends(get_db),
    git_svc: GitService = Depends(get_git_service),
    _token: TokenData = Depends(get_current_user),
) -> str:
    from api.services.git_service import TemplateNotFoundError
    tmpl = await catalog_service.get_template(db, template_id)
    try:
        raw = git_svc.read_template(tmpl.git_path)
        _, body = git_svc.parse_frontmatter(raw)
        return body
    except TemplateNotFoundError:
        return ""


# ---------------------------------------------------------------------------
# Template data sources (frontmatter)
# ---------------------------------------------------------------------------

@router.get(
    "/{template_id}/datasources",
    summary="Get template data sources",
    description=(
        "Parse the template's `.j2` frontmatter and return the raw `data_sources` "
        "list. Returns an empty list if the file has no data sources defined."
    ),
)
async def get_template_datasources(
    template_id: str,
    db: AsyncSession = Depends(get_db),
    git_svc: GitService = Depends(get_git_service),
    _token: TokenData = Depends(get_current_user),
) -> list[dict]:
    from api.services.git_service import TemplateNotFoundError
    tmpl = await catalog_service.get_template(db, template_id)
    try:
        raw = git_svc.read_template(tmpl.git_path)
        fm, _ = git_svc.parse_frontmatter(raw)
        return fm.get("data_sources") or []
    except TemplateNotFoundError:
        return []


# ---------------------------------------------------------------------------
# Template variables
# ---------------------------------------------------------------------------

@router.get(
    "/{template_id}/variables",
    response_model=list[VariableRefOut],
    summary="Get template variables",
    description=(
        "Parse the template's `.j2` file and return all Jinja2 variable "
        "references, each annotated with `is_registered` — whether a matching "
        "parameter exists in the registry (template-scope or project-scope)."
    ),
)
async def get_template_variables(
    template_id: str,
    db: AsyncSession = Depends(get_db),
    git_svc: GitService = Depends(get_git_service),
    _token: TokenData = Depends(get_current_user),
) -> list[VariableRefOut]:
    return await catalog_service.get_template_variables(db, template_id, git_svc)


# ---------------------------------------------------------------------------
# Inheritance chain
# ---------------------------------------------------------------------------

@router.get(
    "/{template_id}/inheritance-chain",
    response_model=list[InheritanceChainItem],
    summary="Get inheritance chain",
    description=(
        "Return the full parent chain for a template, from the root ancestor "
        "down to the requested template (inclusive), ordered root-first.\n\n"
        "This reflects the catalog hierarchy used for parameter inheritance "
        "(not Jinja2 `extends`)."
    ),
)
async def get_inheritance_chain(
    template_id: str,
    db: AsyncSession = Depends(get_db),
    _token: TokenData = Depends(get_current_user),
) -> list[InheritanceChainItem]:
    return await catalog_service.get_inheritance_chain(db, template_id)


# ---------------------------------------------------------------------------
# Render presets
# ---------------------------------------------------------------------------

@router.get(
    "/{template_id}/presets",
    response_model=list[RenderPresetOut],
    summary="List render presets",
    description="Return all named parameter presets saved for a template.",
)
async def list_presets(
    template_id: str,
    db: AsyncSession = Depends(get_db),
    _token: TokenData = Depends(get_current_user),
) -> list[RenderPresetOut]:
    # Verify template exists
    await catalog_service.get_template(db, template_id)
    result = await db.execute(
        select(RenderPreset)
        .where(RenderPreset.template_id == template_id)
        .order_by(RenderPreset.created_at)
    )
    presets = result.scalars().all()
    return [RenderPresetOut.model_validate(p) for p in presets]


@router.post(
    "/{template_id}/presets",
    response_model=RenderPresetOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create render preset",
    description=(
        "Save a named parameter preset for a template. "
        "The `params` dict is stored as-is and can be used to pre-fill the render form."
    ),
)
async def create_preset(
    template_id: str,
    data: RenderPresetCreate,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_admin),
) -> RenderPresetOut:
    await catalog_service.get_template(db, template_id)
    preset = RenderPreset(
        template_id=template_id,
        name=data.name,
        description=data.description,
        params=data.params,
        created_by=None,  # created_by user lookup would require a DB query; omit for now
    )
    db.add(preset)
    await db.flush()
    await db.refresh(preset)
    await log_write(db, token.sub, "create", "render_preset", preset.id, {"name": data.name})
    await db.commit()
    return RenderPresetOut.model_validate(preset)


@router.delete(
    "/{template_id}/presets/{preset_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
    summary="Delete render preset",
    description="Permanently delete a named render preset.",
)
async def delete_preset(
    template_id: str,
    preset_id: int,  # preset ID remains BigInteger
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_admin),
) -> None:
    result = await db.execute(
        select(RenderPreset).where(
            RenderPreset.id == preset_id,
            RenderPreset.template_id == template_id,
        )
    )
    preset = result.scalar_one_or_none()
    if preset is None:
        raise HTTPException(status_code=404, detail="Preset not found.")
    await db.delete(preset)
    await log_write(db, token.sub, "delete", "render_preset", preset_id)
    await db.commit()
