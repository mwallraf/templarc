"""AuditLog model — records all write operations for compliance and troubleshooting."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, String, func
from sqlalchemy import TIMESTAMP
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from api.models.base import Base


class AuditLog(Base):
    """
    Audit trail entry for a write operation.

    One row is appended per create / update / delete action on any resource.
    Rows are never updated or deleted — this table is append-only.

    Columns:
      user_sub       — JWT 'sub' of the authenticated caller
      action         — "create" | "update" | "delete"
      resource_type  — "template" | "parameter" | "project" | "secret"
      resource_id    — DB primary key of the affected row (nullable for bulk ops)
      timestamp      — UTC timestamp, set by the DB server default
      changes        — JSONB payload (request body for create/update, {} for delete)
    """

    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_sub: Mapped[str] = mapped_column(String(255), nullable=False)
    action: Mapped[str] = mapped_column(String(50), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(100), nullable=False)
    resource_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    timestamp: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    changes: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
