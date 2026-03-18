"""
SystemSettings ORM model.

One row per organization — stores runtime-configurable settings that admins
can change via the UI without redeploying. When a field is NULL the application
falls back to the corresponding environment variable.

Currently covers:
  - AI assistant configuration (provider, api_key, model, base_url)

Future sections can be added as new nullable columns on this table.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func  # Integer already here
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.models.base import Base


class SystemSettings(Base):
    __tablename__ = "system_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # One row per org — enforced by the UNIQUE constraint below.
    org_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )

    # ── AI assistant ────────────────────────────────────────────────────────
    # NULL means "use the env var fallback" for each field independently.
    ai_provider: Mapped[str | None] = mapped_column(String(50), nullable=True)
    ai_api_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    ai_model: Mapped[str | None] = mapped_column(String(100), nullable=True)
    ai_base_url: Mapped[str | None] = mapped_column(String(512), nullable=True)

    # ── SMTP / Email ─────────────────────────────────────────────────────────
    # NULL means "use the env var fallback" for each field independently.
    smtp_host: Mapped[str | None] = mapped_column(String(255), nullable=True)
    smtp_port: Mapped[int | None] = mapped_column(Integer, nullable=True)
    smtp_user: Mapped[str | None] = mapped_column(String(255), nullable=True)
    smtp_password: Mapped[str | None] = mapped_column(String(512), nullable=True)
    smtp_from: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # ── Audit ────────────────────────────────────────────────────────────────
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    updated_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
