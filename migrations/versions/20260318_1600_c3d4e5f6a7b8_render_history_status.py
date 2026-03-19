"""Add status and error_message columns to render_history

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-03-18 16:00:00.000000

Phase 14: render error tracking.
- status: VARCHAR(20) NOT NULL DEFAULT 'success' with CHECK constraint
- error_message: TEXT NULLABLE (truncated traceback on render failure)
- Index: ix_render_history_status on (template_id, status) for error filtering
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "c3d4e5f6a7b8"
down_revision = "b2c3d4e5f6a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "render_history",
        sa.Column(
            "status",
            sa.String(20),
            nullable=False,
            server_default="success",
        ),
    )
    op.add_column(
        "render_history",
        sa.Column("error_message", sa.Text, nullable=True),
    )
    op.create_check_constraint(
        "ck_render_history_status",
        "render_history",
        "status IN ('success', 'error', 'partial')",
    )
    op.create_index(
        "ix_render_history_status",
        "render_history",
        ["template_id", "status"],
    )


def downgrade() -> None:
    op.drop_index("ix_render_history_status", table_name="render_history")
    op.drop_constraint("ck_render_history_status", "render_history", type_="check")
    op.drop_column("render_history", "error_message")
    op.drop_column("render_history", "status")
