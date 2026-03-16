from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.models.base import Base

if TYPE_CHECKING:
    from api.models.template import Template
    from api.models.user import User


class RenderPreset(Base):
    __tablename__ = "render_presets"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    template_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("templates.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    params: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_by: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    template: Mapped["Template"] = relationship(
        "Template",
        back_populates="render_presets",
        foreign_keys=[template_id],
        lazy="raise",
    )
    created_by_user: Mapped["User | None"] = relationship(
        "User",
        back_populates="render_presets",
        foreign_keys=[created_by],
        lazy="raise",
    )

    def __repr__(self) -> str:
        return f"<RenderPreset id={self.id} template_id={self.template_id} name={self.name!r}>"
