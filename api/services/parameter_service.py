"""
Parameter service — CRUD and scoping enforcement.

All scoping rules are enforced here, not in the router layer:
- global: name starts with "glob.", organization_id set, project_id/template_id None
- project: name starts with "proj.", project_id set, organization_id/template_id None
- template: name has no "glob."/"proj." prefix, template_id set, others None

The validate_parameter_scoping() function is a pure helper with no DB dependency,
so it can be tested directly in unit tests without mocking.
"""

from __future__ import annotations

import math

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.models.parameter import Parameter, ParameterScope
from api.models.parameter_option import ParameterOption
from api.schemas.parameter import (
    ParameterCreate,
    ParameterOptionCreate,
    ParameterUpdate,
)


# ---------------------------------------------------------------------------
# Scoping validation (pure — no DB dependency)
# ---------------------------------------------------------------------------

def validate_parameter_scoping(
    name: str,
    scope: ParameterScope | str,
    organization_id: str | None,
    project_id: str | None,
    template_id: str | None,
) -> None:
    """
    Enforce the three-tier parameter scoping rules.

    Raises ValueError with a descriptive message on any violation.
    The service layer catches ValueError and converts to HTTP 422.
    """
    scope_val = scope.value if isinstance(scope, ParameterScope) else scope

    if scope_val == ParameterScope.global_.value:
        if not name.startswith("glob."):
            raise ValueError(
                "Global parameters must have names starting with 'glob.' "
                f"(got {name!r})."
            )
        if organization_id is None:
            raise ValueError(
                "Global parameters must have organization_id set."
            )
        if project_id is not None:
            raise ValueError(
                "Global parameters must not have project_id set "
                "(scope=global is organization-wide)."
            )
        if template_id is not None:
            raise ValueError(
                "Global parameters must not have template_id set "
                "(scope=global is organization-wide)."
            )

    elif scope_val == ParameterScope.project.value:
        if not name.startswith("proj."):
            raise ValueError(
                "Project parameters must have names starting with 'proj.' "
                f"(got {name!r})."
            )
        if project_id is None:
            raise ValueError(
                "Project parameters must have project_id set."
            )
        if organization_id is not None:
            raise ValueError(
                "Project parameters must not have organization_id set "
                "(use project_id instead)."
            )
        if template_id is not None:
            raise ValueError(
                "Project parameters must not have template_id set."
            )

    elif scope_val == ParameterScope.template.value:
        if name.startswith("glob."):
            raise ValueError(
                "Template-local parameters must not have names starting with 'glob.' "
                f"(got {name!r}); that prefix is reserved for global scope."
            )
        if name.startswith("proj."):
            raise ValueError(
                "Template-local parameters must not have names starting with 'proj.' "
                f"(got {name!r}); that prefix is reserved for project scope."
            )
        if template_id is None:
            raise ValueError(
                "Template parameters must have template_id set."
            )
        if organization_id is not None:
            raise ValueError(
                "Template parameters must not have organization_id set."
            )
        if project_id is not None:
            raise ValueError(
                "Template parameters must not have project_id set."
            )

    else:
        raise ValueError(f"Unknown scope {scope_val!r}.")


def _scoping_422(exc: ValueError) -> HTTPException:
    """Wrap a ValueError from scoping validation into HTTP 422."""
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail=str(exc),
    )


# ---------------------------------------------------------------------------
# Parameter CRUD
# ---------------------------------------------------------------------------

async def list_parameters(
    db: AsyncSession,
    *,
    scope: ParameterScope | None = None,
    organization_id: str | None = None,
    project_id: str | None = None,
    template_id: str | None = None,
    search: str | None = None,
    include_inactive: bool = False,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[Parameter], int]:
    """
    Return a page of parameters matching the given filters, plus total count.
    Options are NOT loaded here (use get_parameter for detail with options).
    """
    stmt = select(Parameter)

    if not include_inactive:
        stmt = stmt.where(Parameter.is_active.is_(True))
    if scope is not None:
        stmt = stmt.where(Parameter.scope == scope.value)
    if organization_id is not None:
        stmt = stmt.where(Parameter.organization_id == organization_id)
    if project_id is not None:
        stmt = stmt.where(Parameter.project_id == project_id)
    if template_id is not None:
        stmt = stmt.where(Parameter.template_id == template_id)
    if search:
        pattern = f"%{search}%"
        stmt = stmt.where(
            Parameter.name.ilike(pattern) | Parameter.label.ilike(pattern)
        )

    # Count before pagination
    count_stmt = select(func.count()).select_from(stmt.subquery())
    total: int = (await db.execute(count_stmt)).scalar_one()

    # Apply ordering, pagination, and eager-load options (required by ParameterOut)
    stmt = (
        stmt
        .options(selectinload(Parameter.options))
        .order_by(Parameter.scope, Parameter.sort_order, Parameter.name)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )

    rows = (await db.execute(stmt)).scalars().all()
    return list(rows), total


async def create_parameter(db: AsyncSession, data: ParameterCreate) -> Parameter:
    """Create a parameter, enforcing all scoping rules."""
    try:
        validate_parameter_scoping(
            name=data.name,
            scope=data.scope,
            organization_id=data.organization_id,
            project_id=data.project_id,
            template_id=data.template_id,
        )
    except ValueError as exc:
        raise _scoping_422(exc) from exc

    param = Parameter(
        name=data.name,
        scope=data.scope.value,
        organization_id=data.organization_id,
        project_id=data.project_id,
        template_id=data.template_id,
        widget_type=data.widget_type.value,
        label=data.label,
        description=data.description,
        help_text=data.help_text,
        default_value=data.default_value,
        required=data.required,
        validation_regex=data.validation_regex,
        is_derived=data.is_derived,
        derived_expression=data.derived_expression,
        sort_order=data.sort_order,
    )
    db.add(param)
    try:
        await db.flush()
    except Exception as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A parameter with this name already exists in the given scope: {exc}",
        ) from exc

    # Reload with options for a consistent return type
    return await _load_with_options(db, param.id)


async def get_parameter(db: AsyncSession, parameter_id: int) -> Parameter:
    """Fetch a single active parameter with its options. Raises 404 if not found."""
    param = await _load_with_options(db, parameter_id)
    if param is None or not param.is_active:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Parameter {parameter_id} not found.",
        )
    return param


async def update_parameter(
    db: AsyncSession, parameter_id: int, data: ParameterUpdate
) -> Parameter:
    """Partial update of a parameter's metadata. Name and scope are immutable."""
    param = await _load_with_options(db, parameter_id)
    if param is None or not param.is_active:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Parameter {parameter_id} not found.",
        )

    update_fields = data.model_dump(exclude_unset=True)
    for field, value in update_fields.items():
        if hasattr(param, field):
            # Enum fields: store the .value
            if field == "widget_type" and value is not None:
                setattr(param, field, value.value if hasattr(value, "value") else value)
            else:
                setattr(param, field, value)

    await db.flush()
    await db.refresh(param)
    return await _load_with_options(db, param.id)


async def delete_parameter(db: AsyncSession, parameter_id: int) -> None:
    """Soft-delete: set is_active=False. Raises 404 if not found or already inactive."""
    result = await db.execute(
        select(Parameter).where(
            Parameter.id == parameter_id, Parameter.is_active.is_(True)
        )
    )
    param = result.scalar_one_or_none()
    if param is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Parameter {parameter_id} not found.",
        )
    param.is_active = False
    await db.flush()


# ---------------------------------------------------------------------------
# ParameterOption CRUD
# ---------------------------------------------------------------------------

async def list_options(db: AsyncSession, parameter_id: int) -> list[ParameterOption]:
    """List all options for a parameter. Raises 404 if parameter not found."""
    await _assert_parameter_exists(db, parameter_id)
    result = await db.execute(
        select(ParameterOption)
        .where(ParameterOption.parameter_id == parameter_id)
        .order_by(ParameterOption.sort_order, ParameterOption.id)
    )
    return list(result.scalars().all())


async def create_option(
    db: AsyncSession, parameter_id: int, data: ParameterOptionCreate
) -> ParameterOption:
    """Add an option to a select/multiselect parameter."""
    await _assert_parameter_exists(db, parameter_id)
    option = ParameterOption(
        parameter_id=parameter_id,
        value=data.value,
        label=data.label,
        condition_param=data.condition_param,
        condition_value=data.condition_value,
        sort_order=data.sort_order,
    )
    db.add(option)
    await db.flush()
    await db.refresh(option)
    return option


async def delete_option(
    db: AsyncSession, parameter_id: int, option_id: int
) -> None:
    """Delete an option. Raises 404 if option or its parent parameter not found."""
    await _assert_parameter_exists(db, parameter_id)
    result = await db.execute(
        select(ParameterOption).where(
            ParameterOption.id == option_id,
            ParameterOption.parameter_id == parameter_id,
        )
    )
    option = result.scalar_one_or_none()
    if option is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Option {option_id} not found for parameter {parameter_id}.",
        )
    await db.delete(option)
    await db.flush()


# ---------------------------------------------------------------------------
# Pagination helper
# ---------------------------------------------------------------------------

def compute_pages(total: int, page_size: int) -> int:
    if page_size <= 0:
        return 0
    return max(1, math.ceil(total / page_size))


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------

async def _load_with_options(
    db: AsyncSession, parameter_id: int
) -> Parameter | None:
    """Load a parameter with its options eagerly."""
    result = await db.execute(
        select(Parameter)
        .where(Parameter.id == parameter_id)
        .options(selectinload(Parameter.options))
    )
    return result.scalar_one_or_none()


async def _assert_parameter_exists(db: AsyncSession, parameter_id: int) -> None:
    """Raise 404 if the parameter does not exist or is inactive."""
    result = await db.execute(
        select(Parameter.id).where(
            Parameter.id == parameter_id, Parameter.is_active.is_(True)
        )
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Parameter {parameter_id} not found.",
        )
