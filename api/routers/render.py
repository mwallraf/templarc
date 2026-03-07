"""
Render router — template rendering, param resolution, and render history.

Mounted without a prefix in main.py.  Routes:

  GET  /templates/{id}/resolve-params          — enriched param list for UI form building
  POST /templates/{id}/render                  — render with provided params; ?persist=false
                                                 skips history storage (ephemeral preview)
  POST /templates/{id}/on-change/{param_name}  — re-resolve datasources after param edit
  GET  /render-history                         — list history (filter: template_id, dates)
  GET  /render-history/{id}                    — single history record with full context
  POST /render-history/{id}/re-render          — re-render from stored params

Auth: all endpoints require a valid JWT (any authenticated user).

All write operations (render, re-render) call db.commit() via the service.
Read-only operations leave the session untouched.
"""

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from api.core.rate_limit import limiter
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.auth import TokenData, get_current_user
from api.database import get_db
from api.dependencies import get_git_service
from api.models.render_history import RenderHistory
from api.models.template import Template
from api.schemas.render import (
    AvailableFeatureOut,
    EnrichedParameterOut,
    FeatureParamOut,
    FormDefinitionOut,
    OnChangeRequest,
    ReRenderRequest,
    RenderHistoryListOut,
    RenderHistoryOut,
    RenderOut,
    RenderRequest,
)
from api.services.environment_factory import EnvironmentFactory
from api.services.git_service import GitService
from api.services.template_renderer import TemplateRenderer

router = APIRouter()


# ---------------------------------------------------------------------------
# Dependency helper
# ---------------------------------------------------------------------------

def _make_renderer(db: AsyncSession, git_service: GitService) -> TemplateRenderer:
    return TemplateRenderer(db=db, git_service=git_service, env_factory=EnvironmentFactory(db))


async def _require_not_snippet(db: AsyncSession, template_id: int) -> None:
    """Raise 422 if the template is a snippet (include-only fragment)."""
    tmpl = await db.get(Template, template_id)
    if tmpl is not None and tmpl.is_snippet:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="This template is a snippet (include-only) and cannot be rendered directly.",
        )


# ---------------------------------------------------------------------------
# resolve-params
# ---------------------------------------------------------------------------

@router.get(
    "/templates/{template_id}/resolve-params",
    response_model=FormDefinitionOut,
    summary="Resolve parameters for form rendering",
    description=(
        "Returns the full enriched parameter set for a template, ready for the "
        "UI to build a dynamic input form.  Runs all `on_load` data sources in "
        "parallel and merges enrichments (prefill values, dropdown options, "
        "readonly overrides) into each parameter descriptor."
    ),
    tags=["Render"],
)
async def resolve_params(
    template_id: int,
    db: AsyncSession = Depends(get_db),
    git_service: GitService = Depends(get_git_service),
    _token: TokenData = Depends(get_current_user),
) -> FormDefinitionOut:
    await _require_not_snippet(db, template_id)
    renderer = _make_renderer(db, git_service)
    form_def = await renderer.resolve_params_for_form(template_id)
    return FormDefinitionOut(
        template_id=form_def.template_id,
        parameters=[
            EnrichedParameterOut(
                name=p.name,
                scope=p.scope,
                widget_type=p.widget_type,
                label=p.label,
                description=p.description,
                help_text=p.help_text,
                default_value=p.default_value,
                required=p.required,
                sort_order=p.sort_order,
                is_derived=p.is_derived,
                validation_regex=p.validation_regex,
                section=p.section,
                visible_when=p.visible_when,
                prefill=p.prefill,
                options=p.options,
                readonly=p.readonly,
                source_id=p.source_id,
            )
            for p in form_def.parameters
        ],
        inheritance_chain=form_def.inheritance_chain,
        features=[
            AvailableFeatureOut(
                id=f.id,
                name=f.name,
                label=f.label,
                description=f.description,
                is_default=f.is_default,
                sort_order=f.sort_order,
                parameters=[
                    FeatureParamOut(
                        name=fp.name,
                        widget_type=fp.widget_type,
                        label=fp.label,
                        description=fp.description,
                        help_text=fp.help_text,
                        default_value=fp.default_value,
                        required=fp.required,
                        sort_order=fp.sort_order,
                        options=fp.options,
                    )
                    for fp in f.parameters
                ],
            )
            for f in form_def.features
        ],
    )


# ---------------------------------------------------------------------------
# render
# ---------------------------------------------------------------------------

@router.post(
    "/templates/{template_id}/render",
    response_model=RenderOut,
    status_code=status.HTTP_200_OK,
    summary="Render a template",
    description=(
        "Render a template with provided parameter values.  "
        "Pass `?persist=false` to skip writing to `render_history` "
        "(useful for quick previews or CI dry-runs).  "
        "The response `output` includes the metadata header prepended to the "
        "rendered body."
    ),
    tags=["Render"],
)
@limiter.limit("10/minute")
async def render_template(
    request: Request,
    template_id: int,
    body: RenderRequest,
    persist: bool = Query(True, description="Set false to skip render_history storage"),
    db: AsyncSession = Depends(get_db),
    git_service: GitService = Depends(get_git_service),
    token: TokenData = Depends(get_current_user),
) -> RenderOut:
    await _require_not_snippet(db, template_id)
    renderer = _make_renderer(db, git_service)
    result = await renderer.render(
        template_id=template_id,
        provided_params=body.params,
        user=token.sub,
        notes=body.notes,
        persist=persist,
        feature_ids=body.feature_ids or [],
    )
    return RenderOut(
        output=result.output,
        render_id=result.render_id,
        template_id=result.template_id,
        git_sha=result.git_sha,
    )


# ---------------------------------------------------------------------------
# on-change
# ---------------------------------------------------------------------------

@router.post(
    "/templates/{template_id}/on-change/{param_name}",
    response_model=dict[str, Any],
    summary="Re-resolve datasources after a parameter change",
    description=(
        "Call this when the user edits a form field.  Returns updated enrichments "
        "(prefill values, dropdown options) for any parameters whose datasources "
        "are triggered by the changed param.  Cascading triggers are resolved "
        "automatically with loop detection.\n\n"
        "Response is a mapping of parameter name → enrichment object, e.g.:\n"
        "```json\n"
        '{"router.site_id": {"prefill": "42", "readonly": true, "source_id": "netbox"}}\n'
        "```"
    ),
    tags=["Render"],
)
async def on_change(
    template_id: int,
    param_name: str,
    body: OnChangeRequest,
    db: AsyncSession = Depends(get_db),
    git_service: GitService = Depends(get_git_service),
    _token: TokenData = Depends(get_current_user),
) -> dict[str, Any]:
    renderer = _make_renderer(db, git_service)
    return await renderer.resolve_on_change(
        template_id=template_id,
        changed_param=param_name,
        current_params=body.current_params,
    )


# ---------------------------------------------------------------------------
# render-history list
# ---------------------------------------------------------------------------

@router.get(
    "/render-history",
    response_model=RenderHistoryListOut,
    summary="List render history",
    description="Return render history records, newest first, with optional filters.",
    tags=["Render History"],
)
async def list_render_history(
    template_id: int | None = Query(None),
    date_from: datetime | None = Query(None),
    date_to: datetime | None = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    _token: TokenData = Depends(get_current_user),
) -> RenderHistoryListOut:
    q = select(RenderHistory)
    if template_id is not None:
        q = q.where(RenderHistory.template_id == template_id)
    if date_from is not None:
        q = q.where(RenderHistory.rendered_at >= date_from)
    if date_to is not None:
        q = q.where(RenderHistory.rendered_at <= date_to)

    total_result = await db.execute(select(func.count()).select_from(q.subquery()))
    total: int = total_result.scalar_one()

    items_result = await db.execute(
        q.order_by(RenderHistory.rendered_at.desc()).limit(limit).offset(offset)
    )
    items = list(items_result.scalars().all())
    return RenderHistoryListOut(
        items=[RenderHistoryOut.model_validate(h) for h in items],
        total=total,
    )


# ---------------------------------------------------------------------------
# render-history single
# ---------------------------------------------------------------------------

@router.get(
    "/render-history/{history_id}",
    response_model=RenderHistoryOut,
    summary="Get a single render history record",
    description=(
        "Fetch one render history record by ID. "
        "Includes the full resolved parameter set and the raw rendered output. "
        "Use this to inspect what was rendered and replay it via the re-render endpoint."
    ),
    tags=["Render History"],
)
async def get_render_history(
    history_id: int,
    db: AsyncSession = Depends(get_db),
    _token: TokenData = Depends(get_current_user),
) -> RenderHistoryOut:
    result = await db.execute(
        select(RenderHistory).where(RenderHistory.id == history_id)
    )
    history = result.scalar_one_or_none()
    if history is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"RenderHistory {history_id} not found",
        )
    return RenderHistoryOut.model_validate(history)


# ---------------------------------------------------------------------------
# re-render
# ---------------------------------------------------------------------------

@router.post(
    "/render-history/{history_id}/re-render",
    response_model=RenderOut,
    status_code=status.HTTP_200_OK,
    summary="Re-render using stored parameters",
    description=(
        "Re-runs a previous render using the exact same resolved parameters.  "
        "The template body is re-loaded from Git, so changes to the .j2 file "
        "are reflected in the output.  Pass `template_id` in the body to apply "
        "the stored params to a different template."
    ),
    tags=["Render History"],
)
@limiter.limit("10/minute")
async def re_render(
    request: Request,
    history_id: int,
    body: ReRenderRequest,
    db: AsyncSession = Depends(get_db),
    git_service: GitService = Depends(get_git_service),
    token: TokenData = Depends(get_current_user),
) -> RenderOut:
    renderer = _make_renderer(db, git_service)
    result = await renderer.re_render(
        history_id=history_id,
        override_template_id=body.template_id,
        notes=body.notes,
        persist=body.persist,
        user=token.sub,
    )
    return RenderOut(
        output=result.output,
        render_id=result.render_id,
        template_id=result.template_id,
        git_sha=result.git_sha,
    )
