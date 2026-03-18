"""phase13a: add org settings columns + webhook_deliveries table

Revision ID: a1b2c3d4e5f6
Revises: 20260318_0900_b1c2d3e4f5a6_add_rbac
Create Date: 2026-03-18 12:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "a1b2c3d4e5f6"
down_revision = "b1c2d3e4f5a6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- Org settings columns ------------------------------------------------
    op.add_column(
        "organizations",
        sa.Column("logo_url", sa.String(500), nullable=True),
    )
    op.add_column(
        "organizations",
        sa.Column("timezone", sa.String(64), nullable=False, server_default="UTC"),
    )
    op.add_column(
        "organizations",
        sa.Column("retention_days", sa.Integer(), nullable=True),
    )

    # --- Webhook deliveries table --------------------------------------------
    op.create_table(
        "webhook_deliveries",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=False),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("webhook_id", sa.Integer(), sa.ForeignKey("render_webhooks.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("event", sa.String(100), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column("status_code", sa.Integer(), nullable=True),
        sa.Column("response_body", sa.Text(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_webhook_deliveries_webhook_created",
        "webhook_deliveries",
        ["webhook_id", sa.text("created_at DESC")],
    )


def downgrade() -> None:
    op.drop_index("ix_webhook_deliveries_webhook_created", table_name="webhook_deliveries")
    op.drop_table("webhook_deliveries")
    op.drop_column("organizations", "retention_days")
    op.drop_column("organizations", "timezone")
    op.drop_column("organizations", "logo_url")
