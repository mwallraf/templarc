from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, List

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.models.base import Base

if TYPE_CHECKING:
    from api.models.project import Project
    from api.models.template import Template
    from api.models.parameter import Parameter


class Feature(Base):
    """
    A Feature is a reusable Jinja2 snippet with its own parameters, managed
    entirely via the GUI. Features are project-scoped and can be attached to
    one or more templates. During rendering the user selects which features to
    include; the renderer appends each selected feature's output after the
    main template body.

    The snippet body lives in Git at ``snippet_path`` (relative to the repo
    root), e.g. ``router_provisioning/features/snmp/snmp.j2``. The file is a
    plain Jinja2 template with *no* YAML frontmatter.
    """

    __tablename__ = "features"
    __table_args__ = (
        UniqueConstraint("project_id", "name", name="uq_features_project_name"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Path relative to the Git repo root, e.g. router_provisioning/features/snmp/snmp.j2
    snippet_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationships
    project: Mapped["Project"] = relationship(
        "Project", back_populates="features", lazy="raise"
    )
    parameters: Mapped[List["Parameter"]] = relationship(
        "Parameter",
        back_populates="feature",
        foreign_keys="Parameter.feature_id",
        cascade="all, delete-orphan",
        lazy="raise",
    )
    template_features: Mapped[List["TemplateFeature"]] = relationship(
        "TemplateFeature",
        back_populates="feature",
        cascade="all, delete-orphan",
        lazy="raise",
    )

    def __repr__(self) -> str:
        return f"<Feature id={self.id} name={self.name!r}>"


class TemplateFeature(Base):
    """
    Join table connecting a Template to a Feature.

    ``is_default=True`` means the feature is pre-checked in the render form.
    ``sort_order`` controls the order features are rendered and displayed.
    """

    __tablename__ = "template_features"
    __table_args__ = (
        UniqueConstraint("template_id", "feature_id", name="uq_template_feature"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    template_id: Mapped[int] = mapped_column(
        ForeignKey("templates.id", ondelete="CASCADE"), nullable=False, index=True
    )
    feature_id: Mapped[int] = mapped_column(
        ForeignKey("features.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # When True the feature checkbox is pre-checked in the render form
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)

    # Relationships
    template: Mapped["Template"] = relationship(
        "Template", back_populates="template_features", lazy="raise"
    )
    feature: Mapped["Feature"] = relationship(
        "Feature", back_populates="template_features", lazy="raise"
    )

    def __repr__(self) -> str:
        return f"<TemplateFeature template_id={self.template_id} feature_id={self.feature_id}>"
