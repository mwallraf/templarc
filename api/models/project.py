from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, List

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.models.base import Base

if TYPE_CHECKING:
    from api.models.organization import Organization
    from api.models.template import Template
    from api.models.parameter import Parameter
    from api.models.feature import Feature
    from api.models.render_webhook import RenderWebhook


class Project(Base):
    __tablename__ = "projects"
    __table_args__ = (
        UniqueConstraint("organization_id", "name", name="uq_projects_org_name"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    organization_id: Mapped[int] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    git_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    remote_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    remote_branch: Mapped[str] = mapped_column(
        String(100), default="main", server_default="main", nullable=False
    )
    remote_credential_ref: Mapped[str | None] = mapped_column(String(500), nullable=True)
    output_comment_style: Mapped[str] = mapped_column(
        String(10), default="#", server_default="#", nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization", back_populates="projects", lazy="raise"
    )
    templates: Mapped[List["Template"]] = relationship(
        "Template", back_populates="project", cascade="all, delete-orphan", lazy="raise"
    )
    parameters: Mapped[List["Parameter"]] = relationship(
        "Parameter",
        back_populates="project",
        foreign_keys="Parameter.project_id",
        cascade="all, delete-orphan",
        lazy="raise",
    )
    features: Mapped[List["Feature"]] = relationship(
        "Feature", back_populates="project", cascade="all, delete-orphan", lazy="raise"
    )
    webhooks: Mapped[List["RenderWebhook"]] = relationship(
        "RenderWebhook", back_populates="project", cascade="all, delete-orphan", lazy="raise"
    )

    def __repr__(self) -> str:
        return f"<Project id={self.id} name={self.name!r}>"
