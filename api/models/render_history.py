from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, Text, func, CheckConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.models.base import Base

if TYPE_CHECKING:
    from api.models.template import Template
    from api.models.user import User


class RenderHistory(Base):
    __tablename__ = "render_history"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )
    template_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("templates.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # 64 chars: forward-compatible with SHA-256 Git object hashes
    template_git_sha: Mapped[str] = mapped_column(String(64), nullable=False)
    # JSONB: full resolved param dict (glob + proj + template-local) at render time
    resolved_parameters: Mapped[dict] = mapped_column(JSONB, nullable=False)
    # raw_output includes the prepended metadata header
    raw_output: Mapped[str] = mapped_column(Text, nullable=False)
    rendered_by: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    rendered_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Phase 10: resolved value of template.history_label_param at render time (for fast search)
    display_label: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Phase 14: render outcome tracking
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="success")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        CheckConstraint("status IN ('success', 'error', 'partial')", name="ck_render_history_status"),
    )

    # Relationships — SET NULL FKs: history survives template/user deletion
    template: Mapped["Template | None"] = relationship(
        "Template",
        back_populates="render_history",
        foreign_keys=[template_id],
        lazy="raise",
    )
    rendered_by_user: Mapped["User | None"] = relationship(
        "User",
        back_populates="render_history",
        foreign_keys=[rendered_by],
        lazy="raise",
    )

    def __repr__(self) -> str:
        return f"<RenderHistory id={self.id} template_id={self.template_id}>"
