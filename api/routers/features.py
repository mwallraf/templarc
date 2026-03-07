"""
Features router — GUI-managed Jinja2 snippets that can be attached to templates.

Mounted at /features in main.py. Routes:

  GET    /features                                  — list features (filter by project_id)
  POST   /features                                  — create a feature
  GET    /features/{id}                             — get feature detail (with parameters)
  PUT    /features/{id}                             — update feature metadata
  DELETE /features/{id}                             — delete feature
  GET    /features/{id}/body                        — read feature snippet body from Git
  PUT    /features/{id}/body                        — write feature snippet body to Git

  GET    /features/{id}/parameters                  — list feature parameters
  POST   /features/{id}/parameters                  — create feature parameter
  PUT    /features/{id}/parameters/{param_id}       — update feature parameter
  DELETE /features/{id}/parameters/{param_id}       — delete feature parameter

  GET    /templates/{template_id}/features          — list features attached to a template
  POST   /templates/{template_id}/features/{fid}   — attach feature to template
  PUT    /templates/{template_id}/features/{fid}    — update attachment (is_default, sort_order)
  DELETE /templates/{template_id}/features/{fid}   — detach feature from template

Auth: read endpoints require get_current_user; write endpoints require require_admin.
"""

import os

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.core.auth import TokenData, get_current_user, require_admin
from api.database import get_db
from api.dependencies import get_git_service
from api.models.feature import Feature, TemplateFeature
from api.models.parameter import Parameter
from api.models.parameter_option import ParameterOption
from api.models.project import Project
from api.models.template import Template
from api.schemas.feature import (
    FeatureBodyUpdate,
    FeatureCreate,
    FeatureListOut,
    FeatureOut,
    FeatureParameterCreate,
    FeatureParameterOut,
    FeatureParameterUpdate,
    FeatureUpdate,
    TemplateFeatureOut,
    TemplateFeatureUpdate,
)
from api.services.git_service import GitService, TemplateNotFoundError

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _get_feature(feature_id: int, db: AsyncSession) -> Feature:
    result = await db.execute(
        select(Feature)
        .where(Feature.id == feature_id)
        .options(
            selectinload(Feature.parameters).selectinload(Parameter.options)
        )
    )
    feature = result.scalar_one_or_none()
    if feature is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feature not found")
    return feature


def _feature_to_out(feature: Feature) -> FeatureOut:
    params = [
        FeatureParameterOut(
            id=p.id,
            name=p.name,
            widget_type=p.widget_type,
            label=p.label,
            description=p.description,
            help_text=p.help_text,
            default_value=p.default_value,
            required=p.required,
            sort_order=p.sort_order,
            is_active=p.is_active,
            is_derived=p.is_derived,
            derived_expression=p.derived_expression,
            validation_regex=p.validation_regex,
            options=[
                {"value": o.value, "label": o.label, "sort_order": o.sort_order}
                for o in sorted(p.options, key=lambda o: o.sort_order)
            ],
        )
        for p in sorted(feature.parameters, key=lambda p: (p.sort_order, p.name))
        if p.is_active
    ]
    return FeatureOut(
        id=feature.id,
        project_id=feature.project_id,
        name=feature.name,
        label=feature.label,
        description=feature.description,
        snippet_path=feature.snippet_path,
        sort_order=feature.sort_order,
        is_active=feature.is_active,
        created_at=feature.created_at,
        updated_at=feature.updated_at,
        parameters=params,
    )


def _snippet_path_for(project_git_path: str | None, feature_name: str) -> str:
    """Derive the canonical Git-relative snippet path for a feature."""
    base = project_git_path.rstrip("/") if project_git_path else "features"
    return f"{base}/features/{feature_name}/{feature_name}.j2"


# ---------------------------------------------------------------------------
# Feature CRUD
# ---------------------------------------------------------------------------

@router.get("", response_model=FeatureListOut, summary="List features")
async def list_features(
    project_id: int | None = Query(None, description="Filter by project ID"),
    include_inactive: bool = Query(False, description="Include inactive features"),
    db: AsyncSession = Depends(get_db),
    _token: TokenData = Depends(get_current_user),
) -> FeatureListOut:
    q = select(Feature).options(
        selectinload(Feature.parameters).selectinload(Parameter.options)
    )
    if project_id is not None:
        q = q.where(Feature.project_id == project_id)
    if not include_inactive:
        q = q.where(Feature.is_active.is_(True))
    q = q.order_by(Feature.sort_order, Feature.name)

    result = await db.execute(q)
    features = list(result.scalars().all())
    items = [_feature_to_out(f) for f in features]
    return FeatureListOut(items=items, total=len(items))


@router.post(
    "",
    response_model=FeatureOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create feature",
)
async def create_feature(
    body: FeatureCreate,
    db: AsyncSession = Depends(get_db),
    _token: TokenData = Depends(require_admin),
) -> FeatureOut:
    # Verify project exists
    proj_result = await db.execute(select(Project).where(Project.id == body.project_id))
    project = proj_result.scalar_one_or_none()
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    snippet_path = _snippet_path_for(project.git_path, body.name)

    feature = Feature(
        project_id=body.project_id,
        name=body.name,
        label=body.label,
        description=body.description,
        snippet_path=snippet_path,
        sort_order=body.sort_order,
    )
    db.add(feature)
    await db.flush()
    await db.refresh(feature)
    await db.commit()
    return await _get_feature_out(feature.id, db)


@router.get("/{feature_id}", response_model=FeatureOut, summary="Get feature")
async def get_feature(
    feature_id: int,
    db: AsyncSession = Depends(get_db),
    _token: TokenData = Depends(get_current_user),
) -> FeatureOut:
    feature = await _get_feature(feature_id, db)
    return _feature_to_out(feature)


@router.put("/{feature_id}", response_model=FeatureOut, summary="Update feature")
async def update_feature(
    feature_id: int,
    body: FeatureUpdate,
    db: AsyncSession = Depends(get_db),
    _token: TokenData = Depends(require_admin),
) -> FeatureOut:
    feature = await _get_feature(feature_id, db)
    if body.label is not None:
        feature.label = body.label
    if body.description is not None:
        feature.description = body.description
    if body.sort_order is not None:
        feature.sort_order = body.sort_order
    if body.is_active is not None:
        feature.is_active = body.is_active
    await db.flush()
    await db.refresh(feature)
    await db.commit()
    return await _get_feature_out(feature_id, db)


@router.delete(
    "/{feature_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
    summary="Delete feature",
)
async def delete_feature(
    feature_id: int,
    db: AsyncSession = Depends(get_db),
    _token: TokenData = Depends(require_admin),
) -> None:
    feature = await _get_feature(feature_id, db)
    await db.delete(feature)
    await db.commit()


# ---------------------------------------------------------------------------
# Feature body (Git-backed)
# ---------------------------------------------------------------------------

@router.get("/{feature_id}/body", summary="Read feature snippet body from Git")
async def get_feature_body(
    feature_id: int,
    db: AsyncSession = Depends(get_db),
    git_service: GitService = Depends(get_git_service),
    _token: TokenData = Depends(get_current_user),
) -> dict:
    feature = await _get_feature(feature_id, db)
    if not feature.snippet_path:
        return {"body": "", "snippet_path": None}
    try:
        content = git_service.read_template(feature.snippet_path)
        return {"body": content, "snippet_path": feature.snippet_path}
    except TemplateNotFoundError:
        return {"body": "", "snippet_path": feature.snippet_path}


@router.put("/{feature_id}/body", summary="Write feature snippet body to Git")
async def update_feature_body(
    feature_id: int,
    body: FeatureBodyUpdate,
    db: AsyncSession = Depends(get_db),
    git_service: GitService = Depends(get_git_service),
    _token: TokenData = Depends(require_admin),
) -> dict:
    feature = await _get_feature(feature_id, db)
    if not feature.snippet_path:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Feature has no snippet_path — update feature first",
        )

    # Ensure parent directory exists in the repo
    abs_path = os.path.join(git_service._repo.working_dir, feature.snippet_path)
    os.makedirs(os.path.dirname(abs_path), exist_ok=True)

    git_service.write_template(
        git_path=feature.snippet_path,
        content=body.body,
        message=body.commit_message,
        author=body.author,
    )
    return {"snippet_path": feature.snippet_path, "ok": True}


# ---------------------------------------------------------------------------
# Feature parameters
# ---------------------------------------------------------------------------

@router.get(
    "/{feature_id}/parameters",
    response_model=list[FeatureParameterOut],
    summary="List feature parameters",
)
async def list_feature_parameters(
    feature_id: int,
    db: AsyncSession = Depends(get_db),
    _token: TokenData = Depends(get_current_user),
) -> list[FeatureParameterOut]:
    await _get_feature(feature_id, db)  # 404 guard
    result = await db.execute(
        select(Parameter)
        .where(Parameter.feature_id == feature_id, Parameter.scope == "feature")
        .options(selectinload(Parameter.options))
        .order_by(Parameter.sort_order, Parameter.name)
    )
    params = list(result.scalars().all())
    return [
        FeatureParameterOut(
            id=p.id,
            name=p.name,
            widget_type=p.widget_type,
            label=p.label,
            description=p.description,
            help_text=p.help_text,
            default_value=p.default_value,
            required=p.required,
            sort_order=p.sort_order,
            is_active=p.is_active,
            is_derived=p.is_derived,
            derived_expression=p.derived_expression,
            validation_regex=p.validation_regex,
            options=[
                {"value": o.value, "label": o.label, "sort_order": o.sort_order}
                for o in sorted(p.options, key=lambda o: o.sort_order)
            ],
        )
        for p in params
    ]


@router.post(
    "/{feature_id}/parameters",
    response_model=FeatureParameterOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create feature parameter",
)
async def create_feature_parameter(
    feature_id: int,
    body: FeatureParameterCreate,
    db: AsyncSession = Depends(get_db),
    _token: TokenData = Depends(require_admin),
) -> FeatureParameterOut:
    await _get_feature(feature_id, db)  # 404 guard

    param = Parameter(
        name=body.name,
        scope="feature",
        feature_id=feature_id,
        widget_type=body.widget_type,
        label=body.label,
        description=body.description,
        help_text=body.help_text,
        default_value=body.default_value,
        required=body.required,
        validation_regex=body.validation_regex,
        is_derived=body.is_derived,
        derived_expression=body.derived_expression,
        sort_order=body.sort_order,
    )
    db.add(param)
    await db.flush()
    await db.refresh(param)
    await db.commit()

    # Reload with options (empty for new param)
    result = await db.execute(
        select(Parameter).where(Parameter.id == param.id).options(selectinload(Parameter.options))
    )
    p = result.scalar_one()
    return FeatureParameterOut(
        id=p.id,
        name=p.name,
        widget_type=p.widget_type,
        label=p.label,
        description=p.description,
        help_text=p.help_text,
        default_value=p.default_value,
        required=p.required,
        sort_order=p.sort_order,
        is_active=p.is_active,
        is_derived=p.is_derived,
        derived_expression=p.derived_expression,
        validation_regex=p.validation_regex,
        options=[],
    )


@router.put(
    "/{feature_id}/parameters/{param_id}",
    response_model=FeatureParameterOut,
    summary="Update feature parameter",
)
async def update_feature_parameter(
    feature_id: int,
    param_id: int,
    body: FeatureParameterUpdate,
    db: AsyncSession = Depends(get_db),
    _token: TokenData = Depends(require_admin),
) -> FeatureParameterOut:
    result = await db.execute(
        select(Parameter)
        .where(Parameter.id == param_id, Parameter.feature_id == feature_id)
        .options(selectinload(Parameter.options))
    )
    param = result.scalar_one_or_none()
    if param is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parameter not found")

    for field_name in ("widget_type", "label", "description", "help_text",
                       "default_value", "required", "validation_regex",
                       "is_derived", "derived_expression", "sort_order", "is_active"):
        val = getattr(body, field_name)
        if val is not None:
            setattr(param, field_name, val)

    await db.flush()
    await db.refresh(param)
    await db.commit()
    return FeatureParameterOut(
        id=param.id,
        name=param.name,
        widget_type=param.widget_type,
        label=param.label,
        description=param.description,
        help_text=param.help_text,
        default_value=param.default_value,
        required=param.required,
        sort_order=param.sort_order,
        is_active=param.is_active,
        is_derived=param.is_derived,
        derived_expression=param.derived_expression,
        validation_regex=param.validation_regex,
        options=[
            {"value": o.value, "label": o.label, "sort_order": o.sort_order}
            for o in sorted(param.options, key=lambda o: o.sort_order)
        ],
    )


@router.delete(
    "/{feature_id}/parameters/{param_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
    summary="Delete feature parameter",
)
async def delete_feature_parameter(
    feature_id: int,
    param_id: int,
    db: AsyncSession = Depends(get_db),
    _token: TokenData = Depends(require_admin),
) -> None:
    result = await db.execute(
        select(Parameter).where(Parameter.id == param_id, Parameter.feature_id == feature_id)
    )
    param = result.scalar_one_or_none()
    if param is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parameter not found")
    await db.delete(param)
    await db.commit()


# ---------------------------------------------------------------------------
# Template ↔ Feature attachment (mounted under /templates/{id}/features)
# ---------------------------------------------------------------------------

@router.get(
    "/templates/{template_id}/features",
    response_model=list[TemplateFeatureOut],
    summary="List features attached to a template",
    tags=["Features"],
)
async def list_template_features(
    template_id: int,
    db: AsyncSession = Depends(get_db),
    _token: TokenData = Depends(get_current_user),
) -> list[TemplateFeatureOut]:
    result = await db.execute(
        select(TemplateFeature)
        .where(TemplateFeature.template_id == template_id)
        .options(
            selectinload(TemplateFeature.feature).selectinload(Feature.parameters).selectinload(Parameter.options)
        )
        .order_by(TemplateFeature.sort_order, TemplateFeature.id)
    )
    tfs = list(result.scalars().all())
    return [
        TemplateFeatureOut(
            id=tf.id,
            template_id=tf.template_id,
            feature_id=tf.feature_id,
            is_default=tf.is_default,
            sort_order=tf.sort_order,
            feature=_feature_to_out(tf.feature),
        )
        for tf in tfs
    ]


@router.post(
    "/templates/{template_id}/features/{feature_id}",
    response_model=TemplateFeatureOut,
    status_code=status.HTTP_201_CREATED,
    summary="Attach a feature to a template",
    tags=["Features"],
)
async def attach_feature(
    template_id: int,
    feature_id: int,
    is_default: bool = Query(False, description="Pre-check this feature in the render form"),
    sort_order: int = Query(0),
    db: AsyncSession = Depends(get_db),
    _token: TokenData = Depends(require_admin),
) -> TemplateFeatureOut:
    # Verify template exists
    tmpl = await db.get(Template, template_id)
    if tmpl is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")

    # Verify feature exists and belongs to same project
    feat_result = await db.execute(
        select(Feature)
        .where(Feature.id == feature_id)
        .options(selectinload(Feature.parameters).selectinload(Parameter.options))
    )
    feature = feat_result.scalar_one_or_none()
    if feature is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feature not found")
    if feature.project_id != tmpl.project_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Feature and template must belong to the same project",
        )

    # Check not already attached
    existing = await db.execute(
        select(TemplateFeature).where(
            TemplateFeature.template_id == template_id,
            TemplateFeature.feature_id == feature_id,
        )
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Feature is already attached to this template",
        )

    tf = TemplateFeature(
        template_id=template_id,
        feature_id=feature_id,
        is_default=is_default,
        sort_order=sort_order,
    )
    db.add(tf)
    await db.flush()
    await db.refresh(tf)
    await db.commit()

    return TemplateFeatureOut(
        id=tf.id,
        template_id=tf.template_id,
        feature_id=tf.feature_id,
        is_default=tf.is_default,
        sort_order=tf.sort_order,
        feature=_feature_to_out(feature),
    )


@router.put(
    "/templates/{template_id}/features/{feature_id}",
    response_model=TemplateFeatureOut,
    summary="Update feature attachment (is_default, sort_order)",
    tags=["Features"],
)
async def update_template_feature(
    template_id: int,
    feature_id: int,
    body: TemplateFeatureUpdate,
    db: AsyncSession = Depends(get_db),
    _token: TokenData = Depends(require_admin),
) -> TemplateFeatureOut:
    result = await db.execute(
        select(TemplateFeature)
        .where(
            TemplateFeature.template_id == template_id,
            TemplateFeature.feature_id == feature_id,
        )
        .options(
            selectinload(TemplateFeature.feature).selectinload(Feature.parameters).selectinload(Parameter.options)
        )
    )
    tf = result.scalar_one_or_none()
    if tf is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Feature not attached to this template",
        )
    if body.is_default is not None:
        tf.is_default = body.is_default
    if body.sort_order is not None:
        tf.sort_order = body.sort_order
    await db.flush()
    await db.refresh(tf)
    await db.commit()

    return TemplateFeatureOut(
        id=tf.id,
        template_id=tf.template_id,
        feature_id=tf.feature_id,
        is_default=tf.is_default,
        sort_order=tf.sort_order,
        feature=_feature_to_out(tf.feature),
    )


@router.delete(
    "/templates/{template_id}/features/{feature_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
    summary="Detach a feature from a template",
    tags=["Features"],
)
async def detach_feature(
    template_id: int,
    feature_id: int,
    db: AsyncSession = Depends(get_db),
    _token: TokenData = Depends(require_admin),
) -> None:
    result = await db.execute(
        select(TemplateFeature).where(
            TemplateFeature.template_id == template_id,
            TemplateFeature.feature_id == feature_id,
        )
    )
    tf = result.scalar_one_or_none()
    if tf is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Feature not attached to this template",
        )
    await db.delete(tf)
    await db.commit()


# ---------------------------------------------------------------------------
# Private helper
# ---------------------------------------------------------------------------

async def _get_feature_out(feature_id: int, db: AsyncSession) -> FeatureOut:
    feature = await _get_feature(feature_id, db)
    return _feature_to_out(feature)
