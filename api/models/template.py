from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, List

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.models.base import Base

if TYPE_CHECKING:
    from api.models.project import Project
    from api.models.user import User
    from api.models.parameter import Parameter
    from api.models.render_history import RenderHistory
    from api.models.render_preset import RenderPreset
    from api.models.feature import TemplateFeature


class Template(Base):
    __tablename__ = "templates"
    __table_args__ = (
        UniqueConstraint("project_id", "name", name="uq_templates_project_name"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    git_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    parent_template_id: Mapped[int | None] = mapped_column(
        ForeignKey("templates.id", ondelete="SET NULL"), nullable=True, index=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    is_snippet: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    is_hidden: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    created_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )

    # Relationships
    project: Mapped["Project"] = relationship(
        "Project", back_populates="templates", lazy="raise"
    )
    created_by_user: Mapped["User | None"] = relationship(
        "User",
        back_populates="created_templates",
        foreign_keys=[created_by],
        lazy="raise",
    )
    # Self-referential: parent ← many children
    parent_template: Mapped["Template | None"] = relationship(
        "Template",
        back_populates="child_templates",
        foreign_keys=[parent_template_id],
        remote_side="Template.id",
        lazy="raise",
    )
    child_templates: Mapped[List["Template"]] = relationship(
        "Template",
        back_populates="parent_template",
        foreign_keys="Template.parent_template_id",
        lazy="raise",
    )
    parameters: Mapped[List["Parameter"]] = relationship(
        "Parameter",
        back_populates="template",
        foreign_keys="Parameter.template_id",
        cascade="all, delete-orphan",
        lazy="raise",
    )
    render_history: Mapped[List["RenderHistory"]] = relationship(
        "RenderHistory", back_populates="template", lazy="raise"
    )
    render_presets: Mapped[List["RenderPreset"]] = relationship(
        "RenderPreset", back_populates="template", cascade="all, delete-orphan", lazy="raise"
    )
    template_features: Mapped[List["TemplateFeature"]] = relationship(
        "TemplateFeature", back_populates="template", cascade="all, delete-orphan", lazy="raise"
    )

    def __repr__(self) -> str:
        return f"<Template id={self.id} name={self.name!r}>"
