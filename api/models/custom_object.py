"""
ORM model for admin-registered custom Jinja2 context objects.

Custom objects are Python classes or factory functions stored as source code
in the DB. They are compiled via the sandbox (api/core/sandbox.py) and
registered as env.globals[name] so templates can instantiate them directly.

Example usage in a template:
    {% set r = Router(router.site_id) %}
    loopback {{ r.loopback }}

Scope:
  project_id = None  — available in every project's environment (global)
  project_id = <id>  — available only in the specified project's environment
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from api.models.base import Base


class CustomObject(Base):
    __tablename__ = "custom_objects"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    code: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    project_id: Mapped[int | None] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=True
    )  # None = global across all projects
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="true", nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)

    __table_args__ = (
        UniqueConstraint("name", "project_id", name="uq_custom_object_name"),
    )

    def __repr__(self) -> str:
        return f"<CustomObject id={self.id} name={self.name!r} project_id={self.project_id!r}>"
