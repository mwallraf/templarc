from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.models.base import Base

if TYPE_CHECKING:
    from api.models.organization import Organization
    from api.models.project import Project
    from api.models.template import Template


class RenderWebhook(Base):
    """
    An outbound HTTP webhook fired after a successful render.

    Scope: exactly one of ``project_id`` or ``template_id`` must be set.
    - project_id → webhook fires for every template in the project
    - template_id → webhook fires only for that specific template

    ``trigger_on``:
      'persist' — only fires on real renders (persist=True); skipped on previews
      'always'  — fires on every render, including previews

    ``on_error``:
      'warn'  — failure is logged, render result still returned normally
      'block' — failure raises HTTP 502; useful as a validation/approval gate

    ``auth_header``:
      A secret reference resolved via SecretResolver, e.g. "secret:awx_token".
      Resolved value is sent as the Authorization header.

    ``payload_template``:
      NULL → default JSON payload. Non-null → a Jinja2 string rendered with the
      full render context (render_id, template_name, parameters, output, …).
    """

    __tablename__ = "render_webhooks"
    __table_args__ = (
        CheckConstraint(
            "(project_id IS NOT NULL AND template_id IS NULL) OR "
            "(project_id IS NULL AND template_id IS NOT NULL)",
            name="ck_webhook_scope",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    organization_id: Mapped[int] = mapped_column(
        ForeignKey("organizations.id"), nullable=False, index=True
    )

    # Scope — exactly one must be set
    project_id: Mapped[int | None] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=True
    )
    template_id: Mapped[int | None] = mapped_column(
        ForeignKey("templates.id", ondelete="CASCADE"), nullable=True
    )

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="true", nullable=False
    )

    # Target
    url: Mapped[str] = mapped_column(Text, nullable=False)
    http_method: Mapped[str] = mapped_column(
        String(10), default="POST", server_default="POST", nullable=False
    )

    # Auth resolved via SecretResolver (e.g. "secret:awx_token")
    auth_header: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Optional Jinja2 payload template; NULL → default JSON payload
    payload_template: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Behaviour
    trigger_on: Mapped[str] = mapped_column(
        String(20), default="persist", server_default="persist", nullable=False
    )
    on_error: Mapped[str] = mapped_column(
        String(20), default="warn", server_default="warn", nullable=False
    )
    timeout_seconds: Mapped[int] = mapped_column(
        Integer, default=10, server_default="10", nullable=False
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationships (lazy="raise" — only FK columns used in queries)
    organization: Mapped["Organization"] = relationship(
        "Organization", lazy="raise"
    )
    project: Mapped["Project | None"] = relationship(
        "Project", back_populates="webhooks", lazy="raise"
    )
    template: Mapped["Template | None"] = relationship(
        "Template", back_populates="webhooks", lazy="raise"
    )

    def __repr__(self) -> str:
        scope = f"project={self.project_id}" if self.project_id else f"template={self.template_id}"
        return f"<RenderWebhook id={self.id} name={self.name!r} {scope}>"
