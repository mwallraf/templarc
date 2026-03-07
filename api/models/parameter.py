from __future__ import annotations

import enum
from datetime import datetime
from typing import TYPE_CHECKING, List

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import ENUM as PgEnum, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.models.base import Base

if TYPE_CHECKING:
    from api.models.organization import Organization
    from api.models.project import Project
    from api.models.template import Template
    from api.models.parameter_option import ParameterOption


class ParameterScope(str, enum.Enum):
    global_ = "global"    # trailing underscore: 'global' is a Python keyword
    project = "project"
    template = "template"


class WidgetType(str, enum.Enum):
    text = "text"
    number = "number"
    select = "select"
    multiselect = "multiselect"
    textarea = "textarea"
    readonly = "readonly"
    hidden = "hidden"


# PostgreSQL native ENUM types — create_type=True so Alembic emits CREATE TYPE
_scope_enum = PgEnum(
    "global", "project", "template",
    name="parameterscope",
    create_type=True,
)
_widget_enum = PgEnum(
    "text", "number", "select", "multiselect", "textarea", "readonly", "hidden",
    name="widgettype",
    create_type=True,
)


class Parameter(Base):
    __tablename__ = "parameters"
    __table_args__ = (
        # --- Scope ↔ FK mutual exclusivity -----------------------------------
        CheckConstraint(
            "(scope = 'global'   AND organization_id IS NOT NULL AND project_id IS NULL    AND template_id IS NULL)  OR "
            "(scope = 'project'  AND project_id IS NOT NULL       AND organization_id IS NULL AND template_id IS NULL)  OR "
            "(scope = 'template' AND template_id IS NOT NULL       AND organization_id IS NULL AND project_id IS NULL)",
            name="scope_fk_mutual_exclusivity",
        ),
        # --- Derived parameter must have an expression ----------------------
        CheckConstraint(
            "NOT is_derived OR derived_expression IS NOT NULL",
            name="derived_requires_expression",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    scope: Mapped[str] = mapped_column(_scope_enum, nullable=False, index=True)

    # Exactly one FK is non-NULL, determined by scope
    organization_id: Mapped[int | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True
    )
    project_id: Mapped[int | None] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=True, index=True
    )
    template_id: Mapped[int | None] = mapped_column(
        ForeignKey("templates.id", ondelete="CASCADE"), nullable=True, index=True
    )

    widget_type: Mapped[str] = mapped_column(_widget_enum, nullable=False, server_default="text")
    label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    help_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    default_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    required: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    validation_regex: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_derived: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    derived_expression: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    section: Mapped[str | None] = mapped_column(String(100), nullable=True)
    visible_when: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationships
    organization: Mapped["Organization | None"] = relationship(
        "Organization",
        back_populates="parameters",
        foreign_keys=[organization_id],
        lazy="raise",
    )
    project: Mapped["Project | None"] = relationship(
        "Project",
        back_populates="parameters",
        foreign_keys=[project_id],
        lazy="raise",
    )
    template: Mapped["Template | None"] = relationship(
        "Template",
        back_populates="parameters",
        foreign_keys=[template_id],
        lazy="raise",
    )
    options: Mapped[List["ParameterOption"]] = relationship(
        "ParameterOption",
        back_populates="parameter",
        cascade="all, delete-orphan",
        order_by="ParameterOption.sort_order",
        lazy="raise",
    )

    def __repr__(self) -> str:
        return f"<Parameter id={self.id} name={self.name!r} scope={self.scope!r}>"


# ---------------------------------------------------------------------------
# Partial unique indexes — must be defined OUTSIDE the class body.
# SQLAlchemy's __table_args__ does not support partial indexes via
# UniqueConstraint; use standalone Index() objects with postgresql_where=.
# ---------------------------------------------------------------------------

Index(
    "uix_parameters_name_org_global",
    Parameter.name,
    Parameter.organization_id,
    unique=True,
    postgresql_where=(Parameter.scope == "global"),
)

Index(
    "uix_parameters_name_project",
    Parameter.name,
    Parameter.project_id,
    unique=True,
    postgresql_where=(Parameter.scope == "project"),
)

Index(
    "uix_parameters_name_template",
    Parameter.name,
    Parameter.template_id,
    unique=True,
    postgresql_where=(Parameter.scope == "template"),
)
