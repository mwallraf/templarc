"""
ORM model for admin-registered custom Jinja2 macros.

Custom macros are Jinja2 macro definitions stored as source code in the DB.
They are compiled at environment build time and registered as env.globals[name]
so templates can call them directly without needing an import statement.

The ``body`` field should contain a complete Jinja2 macro definition:

    {% macro interface_block(name, ip) %}
    interface {{ name }}
      ip address {{ ip }}
    {% endmacro %}

The macro name inside the body must match the ``name`` field in this record.

Scope rules:
  "global"  — available in every project's environment
  "project" — available only in the specified project's environment
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from api.models.base import Base


class CustomMacro(Base):
    __tablename__ = "custom_macros"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    scope: Mapped[str] = mapped_column(String(10), nullable=False)  # "global" | "project"
    project_id: Mapped[int | None] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="true", nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)

    __table_args__ = (
        UniqueConstraint("name", "scope", "project_id", name="uq_custom_macro_name"),
    )

    def __repr__(self) -> str:
        return f"<CustomMacro id={self.id} name={self.name!r} scope={self.scope!r}>"
