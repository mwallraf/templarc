from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, List

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.models.base import Base

if TYPE_CHECKING:
    from api.models.organization import Organization
    from api.models.template import Template
    from api.models.render_history import RenderHistory
    from api.models.render_preset import RenderPreset


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    organization_id: Mapped[int] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    username: Mapped[str] = mapped_column(String(150), unique=True, nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(254), nullable=False)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    is_ldap: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    password_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_login: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization", back_populates="users", lazy="raise"
    )
    created_templates: Mapped[List["Template"]] = relationship(
        "Template",
        back_populates="created_by_user",
        foreign_keys="Template.created_by",
        lazy="raise",
    )
    render_history: Mapped[List["RenderHistory"]] = relationship(
        "RenderHistory",
        back_populates="rendered_by_user",
        foreign_keys="RenderHistory.rendered_by",
        lazy="raise",
    )
    render_presets: Mapped[List["RenderPreset"]] = relationship(
        "RenderPreset",
        back_populates="created_by_user",
        foreign_keys="RenderPreset.created_by",
        lazy="raise",
    )

    def __repr__(self) -> str:
        return f"<User id={self.id} username={self.username!r}>"
