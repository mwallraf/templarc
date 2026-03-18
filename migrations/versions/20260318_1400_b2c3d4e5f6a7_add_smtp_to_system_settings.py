"""add smtp columns to system_settings

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-03-18 14:00:00.000000

Adds per-org SMTP override columns to system_settings.
NULL = use the env-var fallback (same DB-wins-over-env pattern as AI settings).
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "b2c3d4e5f6a7"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("system_settings", sa.Column("smtp_host", sa.String(255), nullable=True))
    op.add_column("system_settings", sa.Column("smtp_port", sa.Integer(), nullable=True))
    op.add_column("system_settings", sa.Column("smtp_user", sa.String(255), nullable=True))
    op.add_column("system_settings", sa.Column("smtp_password", sa.String(512), nullable=True))
    op.add_column("system_settings", sa.Column("smtp_from", sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column("system_settings", "smtp_from")
    op.drop_column("system_settings", "smtp_password")
    op.drop_column("system_settings", "smtp_user")
    op.drop_column("system_settings", "smtp_port")
    op.drop_column("system_settings", "smtp_host")
