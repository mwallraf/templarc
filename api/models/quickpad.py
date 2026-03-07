from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.models.base import Base


class Quickpad(Base):
    """
    A Quickpad is a lightweight, user-owned ad-hoc Jinja2 template stored
    entirely in the database (no Git backing, no parameter registry).

    Variables are extracted from the body on-the-fly via the Jinja2 AST
    parser. Renders are always ephemeral — never written to render_history.

    Ownership is stored as ``owner_username`` (JWT sub claim) rather than an
    integer FK to avoid a DB lookup per request.
    """

    __tablename__ = "quickpads"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    body: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    is_public: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False
    )
    owner_username: Mapped[str | None] = mapped_column(
        String(200), nullable=True, index=True
    )
    organization_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    def __repr__(self) -> str:
        return f"<Quickpad id={self.id!r} name={self.name!r}>"
