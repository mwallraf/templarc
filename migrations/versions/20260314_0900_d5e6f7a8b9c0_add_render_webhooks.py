"""Add render_webhooks table.

Revision ID: d5e6f7a8b9c0
Revises: c4d5e6f7a8b9
Create Date: 2026-03-14 09:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "d5e6f7a8b9c0"
down_revision = "c4d5e6f7a8b9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "render_webhooks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=True),
        sa.Column("template_id", sa.Integer(), nullable=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("http_method", sa.String(10), server_default="POST", nullable=False),
        sa.Column("auth_header", sa.Text(), nullable=True),
        sa.Column("payload_template", sa.Text(), nullable=True),
        sa.Column("trigger_on", sa.String(20), server_default="persist", nullable=False),
        sa.Column("on_error", sa.String(20), server_default="warn", nullable=False),
        sa.Column("timeout_seconds", sa.Integer(), server_default="10", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["template_id"], ["templates.id"], ondelete="CASCADE"),
        sa.CheckConstraint(
            "(project_id IS NOT NULL AND template_id IS NULL) OR "
            "(project_id IS NULL AND template_id IS NOT NULL)",
            name="ck_webhook_scope",
        ),
    )
    op.create_index(
        "ix_render_webhooks_organization_id",
        "render_webhooks",
        ["organization_id"],
    )
    op.create_index(
        "ix_render_webhooks_project_id",
        "render_webhooks",
        ["project_id"],
        postgresql_where=sa.text("project_id IS NOT NULL"),
    )
    op.create_index(
        "ix_render_webhooks_template_id",
        "render_webhooks",
        ["template_id"],
        postgresql_where=sa.text("template_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_render_webhooks_template_id", table_name="render_webhooks")
    op.drop_index("ix_render_webhooks_project_id", table_name="render_webhooks")
    op.drop_index("ix_render_webhooks_organization_id", table_name="render_webhooks")
    op.drop_table("render_webhooks")
