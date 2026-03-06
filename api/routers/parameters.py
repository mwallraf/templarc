"""
Parameters router — CRUD for the three-scoped parameter registry.

Endpoints:
  GET    /parameters                    — paginated list with filters
  POST   /parameters                    — create parameter
  GET    /parameters/{id}               — get single parameter with options
  PUT    /parameters/{id}               — partial update (metadata only)
  DELETE /parameters/{id}               — soft delete
  GET    /parameters/{id}/options       — list options
  POST   /parameters/{id}/options       — add option
  DELETE /parameters/{id}/options/{oid} — delete option

Auth:
  - GET endpoints: any authenticated user
  - POST/PUT/DELETE: admin only
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.auth import TokenData, get_current_user, require_admin
from api.database import get_db
from api.models.parameter import ParameterScope
from api.schemas.parameter import (
    PaginatedResponse,
    ParameterCreate,
    ParameterOptionCreate,
    ParameterOptionOut,
    ParameterOut,
    ParameterUpdate,
)
from api.services import parameter_service
from api.services.audit_log_service import log_write
from api.services.parameter_service import compute_pages

router = APIRouter()


# ---------------------------------------------------------------------------
# Parameter list
# ---------------------------------------------------------------------------

@router.get(
    "",
    response_model=PaginatedResponse[ParameterOut],
    summary="List parameters",
    description=(
        "Return a paginated list of parameters. Filter by scope, project, "
        "template, organization, or a search string (name/label)."
    ),
)
async def list_parameters(
    scope: ParameterScope | None = Query(None, description="Filter by scope"),
    organization_id: int | None = Query(None),
    project_id: int | None = Query(None),
    template_id: int | None = Query(None),
    search: str | None = Query(None, description="Search in name or label"),
    include_inactive: bool = Query(False, description="Include soft-deleted parameters"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _token: TokenData = Depends(get_current_user),
) -> PaginatedResponse[ParameterOut]:
    items, total = await parameter_service.list_parameters(
        db,
        scope=scope,
        organization_id=organization_id,
        project_id=project_id,
        template_id=template_id,
        search=search,
        include_inactive=include_inactive,
        page=page,
        page_size=page_size,
    )
    return PaginatedResponse(
        items=[ParameterOut.model_validate(p) for p in items],
        total=total,
        page=page,
        page_size=page_size,
        pages=compute_pages(total, page_size),
    )


# ---------------------------------------------------------------------------
# Parameter create
# ---------------------------------------------------------------------------

@router.post(
    "",
    response_model=ParameterOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create parameter",
    description=(
        "Create a new parameter. Scoping rules are enforced:\n"
        "- `global`: name must start with `glob.`, `organization_id` required\n"
        "- `project`: name must start with `proj.`, `project_id` required\n"
        "- `template`: name must NOT start with `glob.` or `proj.`, `template_id` required"
    ),
)
async def create_parameter(
    data: ParameterCreate,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_admin),
) -> ParameterOut:
    param = await parameter_service.create_parameter(db, data)
    await log_write(db, token.sub, "create", "parameter", param.id, data.model_dump())
    await db.commit()
    return ParameterOut.model_validate(param)


# ---------------------------------------------------------------------------
# Parameter detail
# ---------------------------------------------------------------------------

@router.get(
    "/{parameter_id}",
    response_model=ParameterOut,
    summary="Get parameter",
    description="Fetch a single parameter by ID, including all its options.",
)
async def get_parameter(
    parameter_id: int,
    db: AsyncSession = Depends(get_db),
    _token: TokenData = Depends(get_current_user),
) -> ParameterOut:
    param = await parameter_service.get_parameter(db, parameter_id)
    return ParameterOut.model_validate(param)


# ---------------------------------------------------------------------------
# Parameter update
# ---------------------------------------------------------------------------

@router.put(
    "/{parameter_id}",
    response_model=ParameterOut,
    summary="Update parameter",
    description=(
        "Partial update of a parameter's metadata. "
        "Name and scope are immutable after creation."
    ),
)
async def update_parameter(
    parameter_id: int,
    data: ParameterUpdate,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_admin),
) -> ParameterOut:
    param = await parameter_service.update_parameter(db, parameter_id, data)
    await log_write(db, token.sub, "update", "parameter", parameter_id, data.model_dump(exclude_none=True))
    await db.commit()
    return ParameterOut.model_validate(param)


# ---------------------------------------------------------------------------
# Parameter delete (soft)
# ---------------------------------------------------------------------------

@router.delete(
    "/{parameter_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
    summary="Delete parameter",
    description="Soft-delete a parameter by setting is_active=False.",
)
async def delete_parameter(
    parameter_id: int,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_admin),
) -> None:
    await parameter_service.delete_parameter(db, parameter_id)
    await log_write(db, token.sub, "delete", "parameter", parameter_id)
    await db.commit()


# ---------------------------------------------------------------------------
# Options — list
# ---------------------------------------------------------------------------

@router.get(
    "/{parameter_id}/options",
    response_model=list[ParameterOptionOut],
    summary="List options",
    description="List all options for a select/multiselect parameter.",
)
async def list_options(
    parameter_id: int,
    db: AsyncSession = Depends(get_db),
    _token: TokenData = Depends(get_current_user),
) -> list[ParameterOptionOut]:
    options = await parameter_service.list_options(db, parameter_id)
    return [ParameterOptionOut.model_validate(o) for o in options]


# ---------------------------------------------------------------------------
# Options — create
# ---------------------------------------------------------------------------

@router.post(
    "/{parameter_id}/options",
    response_model=ParameterOptionOut,
    status_code=status.HTTP_201_CREATED,
    summary="Add option",
    description=(
        "Add an option to a select/multiselect parameter. "
        "Optionally specify condition_param + condition_value to show this "
        "option only when another parameter has a particular value."
    ),
)
async def create_option(
    parameter_id: int,
    data: ParameterOptionCreate,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_admin),
) -> ParameterOptionOut:
    option = await parameter_service.create_option(db, parameter_id, data)
    await log_write(db, token.sub, "create", "parameter_option", option.id, {"parameter_id": parameter_id, **data.model_dump()})
    await db.commit()
    return ParameterOptionOut.model_validate(option)


# ---------------------------------------------------------------------------
# Options — delete
# ---------------------------------------------------------------------------

@router.delete(
    "/{parameter_id}/options/{option_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
    summary="Delete option",
    description="Delete a specific option from a parameter.",
)
async def delete_option(
    parameter_id: int,
    option_id: int,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_admin),
) -> None:
    await parameter_service.delete_option(db, parameter_id, option_id)
    await log_write(db, token.sub, "delete", "parameter_option", option_id)
    await db.commit()
