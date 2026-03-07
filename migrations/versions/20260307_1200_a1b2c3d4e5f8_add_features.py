"""Add features, template_features, and feature_id on parameters.

Revision ID: a1b2c3d4e5f8
Revises: f6a1b2c3d4e5
Create Date: 2026-03-07 12:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "a1b2c3d4e5f8"
down_revision = "f6a1b2c3d4e5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Create features table
    op.create_table(
        "features",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("label", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("snippet_path", sa.String(500), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_id", "name", name="uq_features_project_name"),
    )
    op.create_index("ix_features_project_id", "features", ["project_id"])

    # 2. Create template_features join table
    op.create_table(
        "template_features",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("template_id", sa.Integer(), nullable=False),
        sa.Column("feature_id", sa.Integer(), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["template_id"], ["templates.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["feature_id"], ["features.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("template_id", "feature_id", name="uq_template_feature"),
    )
    op.create_index("ix_template_features_template_id", "template_features", ["template_id"])
    op.create_index("ix_template_features_feature_id", "template_features", ["feature_id"])

    # 3. Add 'feature' value to parameterscope enum.
    # ALTER TYPE ... ADD VALUE must be committed before any DDL in the same
    # transaction can reference the new value (PostgreSQL restriction).
    # Run it in an autocommit block so it is committed immediately.
    with op.get_context().autocommit_block():
        op.execute(sa.text("ALTER TYPE parameterscope ADD VALUE IF NOT EXISTS 'feature'"))

    # 4. Add feature_id column to parameters table
    op.add_column(
        "parameters",
        sa.Column(
            "feature_id",
            sa.Integer(),
            sa.ForeignKey("features.id", ondelete="CASCADE"),
            nullable=True,
            index=True,
        ),
    )

    # 5. Drop old check constraint (only referenced 3 scopes, no feature_id column)
    op.drop_constraint("scope_fk_mutual_exclusivity", "parameters", type_="check")

    # 6. Recreate check constraint with feature scope + feature_id IS NULL guards
    op.create_check_constraint(
        "scope_fk_mutual_exclusivity",
        "parameters",
        (
            "(scope = 'global'   AND organization_id IS NOT NULL AND project_id IS NULL    AND template_id IS NULL  AND feature_id IS NULL) OR "
            "(scope = 'project'  AND project_id IS NOT NULL       AND organization_id IS NULL AND template_id IS NULL AND feature_id IS NULL) OR "
            "(scope = 'template' AND template_id IS NOT NULL       AND organization_id IS NULL AND project_id IS NULL  AND feature_id IS NULL) OR "
            "(scope = 'feature'  AND feature_id IS NOT NULL        AND organization_id IS NULL AND project_id IS NULL  AND template_id IS NULL)"
        ),
    )

    # 7. Add partial unique index for feature-scoped parameters
    op.create_index(
        "uix_parameters_name_feature",
        "parameters",
        ["name", "feature_id"],
        unique=True,
        postgresql_where=sa.text("scope = 'feature'"),
    )


def downgrade() -> None:
    # Reverse in reverse order

    # Remove the feature partial index
    op.drop_index("uix_parameters_name_feature", "parameters")

    # Drop and recreate original check constraint (without feature scope)
    op.drop_constraint("scope_fk_mutual_exclusivity", "parameters", type_="check")
    op.create_check_constraint(
        "scope_fk_mutual_exclusivity",
        "parameters",
        (
            "(scope = 'global'   AND organization_id IS NOT NULL AND project_id IS NULL    AND template_id IS NULL)  OR "
            "(scope = 'project'  AND project_id IS NOT NULL       AND organization_id IS NULL AND template_id IS NULL)  OR "
            "(scope = 'template' AND template_id IS NOT NULL       AND organization_id IS NULL AND project_id IS NULL)"
        ),
    )

    # Remove feature_id column
    op.drop_column("parameters", "feature_id")

    # NOTE: PostgreSQL does not support removing enum values via ALTER TYPE.
    # The 'feature' value will remain in the parameterscope enum after downgrade.

    # Drop join table and features table
    op.drop_table("template_features")
    op.drop_table("features")
