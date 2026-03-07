"""
Quickpads router — lightweight ad-hoc Jinja2 templates.

Mounted at /quickpads in main.py. Routes:
  GET    /quickpads                    — list (public + own private)
  POST   /quickpads                    — create
  GET    /quickpads/{id}               — get one
  PUT    /quickpads/{id}               — update (owner or admin)
  DELETE /quickpads/{id}               — delete (owner or admin)
  GET    /quickpads/{id}/variables     — extract variable names from body
  POST   /quickpads/{id}/render        — render (always ephemeral)

Auth: all endpoints require an authenticated user (get_current_user).
      edit/delete additionally require owner == current_user OR is_admin.
"""

import uuid

import jinja2
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.auth import TokenData, get_current_user
from api.database import get_db
from api.models.quickpad import Quickpad
from api.schemas.quickpad import (
    QuickpadCreate,
    QuickpadListOut,
    QuickpadOut,
    QuickpadRenderOut,
    QuickpadRenderRequest,
    QuickpadUpdate,
    QuickpadVariablesOut,
)
from api.services.jinja_parser import extract_variables

router = APIRouter()

# Jinja2 bare environment for rendering quickpads — no custom filters, no
# project context, no Git loader. Missing variables render as empty string.
_render_env = jinja2.Environment(undefined=jinja2.Undefined)

# Jinja2 built-in names filtered from extracted variables.
_JINJA2_BUILTINS = frozenset(
    {
        "loop", "range", "lipsum", "dict", "class", "config",
        "true", "false", "none", "True", "False", "None",
        "namespace", "joiner", "cycler",
    }
)


def _extract_var_names(body: str) -> list[str]:
    """Return deduplicated variable full-paths, excluding Jinja2 builtins."""
    try:
        refs = extract_variables(body)
    except jinja2.TemplateSyntaxError:
        return []
    return [r.full_path for r in refs if r.name not in _JINJA2_BUILTINS]


def _assert_owner_or_admin(pad: Quickpad, token: TokenData) -> None:
    if pad.owner_username != token.sub and not token.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not the owner of this quickpad",
        )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("", response_model=QuickpadListOut, summary="List quickpads")
async def list_quickpads(
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(get_current_user),
) -> QuickpadListOut:
    """Return all public quickpads plus the caller's own private quickpads."""
    stmt = (
        select(Quickpad)
        .where(
            Quickpad.organization_id == token.org_id,
            or_(
                Quickpad.is_public == True,  # noqa: E712
                Quickpad.owner_username == token.sub,
            ),
        )
        .order_by(Quickpad.updated_at.desc())
    )
    result = await db.execute(stmt)
    items = list(result.scalars().all())
    return QuickpadListOut(items=items, total=len(items))


@router.post(
    "",
    response_model=QuickpadOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create quickpad",
)
async def create_quickpad(
    body: QuickpadCreate,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(get_current_user),
) -> QuickpadOut:
    pad = Quickpad(
        id=str(uuid.uuid4()),
        name=body.name,
        description=body.description,
        body=body.body,
        is_public=body.is_public,
        owner_username=token.sub,
        organization_id=token.org_id,
    )
    db.add(pad)
    await db.flush()
    await db.refresh(pad)
    await db.commit()
    return QuickpadOut.model_validate(pad)


@router.get("/{pad_id}", response_model=QuickpadOut, summary="Get quickpad")
async def get_quickpad(
    pad_id: str,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(get_current_user),
) -> QuickpadOut:
    pad = await _get_accessible(pad_id, db, token)
    return QuickpadOut.model_validate(pad)


@router.put("/{pad_id}", response_model=QuickpadOut, summary="Update quickpad")
async def update_quickpad(
    pad_id: str,
    body: QuickpadUpdate,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(get_current_user),
) -> QuickpadOut:
    pad = await _get_accessible(pad_id, db, token)
    _assert_owner_or_admin(pad, token)
    if body.name is not None:
        pad.name = body.name
    if body.description is not None:
        pad.description = body.description
    if body.body is not None:
        pad.body = body.body
    if body.is_public is not None:
        pad.is_public = body.is_public
    await db.flush()
    await db.refresh(pad)
    await db.commit()
    return QuickpadOut.model_validate(pad)


@router.delete(
    "/{pad_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
    summary="Delete quickpad",
)
async def delete_quickpad(
    pad_id: str,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(get_current_user),
) -> None:
    pad = await _get_accessible(pad_id, db, token)
    _assert_owner_or_admin(pad, token)
    await db.delete(pad)
    await db.commit()


@router.get(
    "/{pad_id}/variables",
    response_model=QuickpadVariablesOut,
    summary="Extract variables",
)
async def get_variables(
    pad_id: str,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(get_current_user),
) -> QuickpadVariablesOut:
    """Extract and return all variable names referenced in the quickpad body."""
    pad = await _get_accessible(pad_id, db, token)
    return QuickpadVariablesOut(variables=_extract_var_names(pad.body))


@router.post(
    "/{pad_id}/render",
    response_model=QuickpadRenderOut,
    summary="Render quickpad",
)
async def render_quickpad(
    pad_id: str,
    body: QuickpadRenderRequest,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(get_current_user),
) -> QuickpadRenderOut:
    """
    Render the quickpad body with the supplied params.
    Results are never stored — always ephemeral. Missing variables render as empty string.
    """
    pad = await _get_accessible(pad_id, db, token)
    variables = _extract_var_names(pad.body)
    try:
        tmpl = _render_env.from_string(pad.body)
        output = tmpl.render(**body.params)
    except jinja2.TemplateError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Template render error: {exc}",
        )
    return QuickpadRenderOut(output=output, variables_used=variables)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _get_accessible(pad_id: str, db: AsyncSession, token: TokenData) -> Quickpad:
    """Fetch a Quickpad the caller may access (public or own private)."""
    stmt = select(Quickpad).where(
        Quickpad.id == pad_id,
        Quickpad.organization_id == token.org_id,
        or_(
            Quickpad.is_public == True,  # noqa: E712
            Quickpad.owner_username == token.sub,
        ),
    )
    result = await db.execute(stmt)
    pad = result.scalar_one_or_none()
    if pad is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Quickpad not found")
    return pad
