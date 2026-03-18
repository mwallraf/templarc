from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, List

from sqlalchemy import Boolean, DateTime, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.models.base import Base

if TYPE_CHECKING:
    from api.models.user import User
    from api.models.project import Project
    from api.models.parameter import Parameter
    from api.models.secret import Secret


class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # Phase 13A — org settings
    logo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, server_default="UTC", default="UTC")
    retention_days: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Relationships — lazy="raise" prevents accidental sync lazy-loads in async code
    users: Mapped[List["User"]] = relationship(
        "User", back_populates="organization", cascade="all, delete-orphan", lazy="raise"
    )
    projects: Mapped[List["Project"]] = relationship(
        "Project", back_populates="organization", cascade="all, delete-orphan", lazy="raise"
    )
    parameters: Mapped[List["Parameter"]] = relationship(
        "Parameter",
        back_populates="organization",
        foreign_keys="Parameter.organization_id",
        cascade="all, delete-orphan",
        lazy="raise",
    )
    secrets: Mapped[List["Secret"]] = relationship(
        "Secret", back_populates="organization", cascade="all, delete-orphan", lazy="raise"
    )

    def __repr__(self) -> str:
        return f"<Organization id={self.id} name={self.name!r}>"
