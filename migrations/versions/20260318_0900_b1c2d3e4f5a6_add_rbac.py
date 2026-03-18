"""add_rbac

Revision ID: b1c2d3e4f5a6
Revises: 166d4c2dd442
Create Date: 2026-03-18 09:00:00.000000+00:00

Phase 11 — Role-Based Access Control.

Changes:
  1. Create enum types: org_role, project_role
  2. ALTER TABLE users: add role (org_role), add is_platform_admin; data-migrate is_admin → role;
     drop is_admin
  3. CREATE TABLE project_memberships
  4. ALTER TABLE api_keys: add role (org_role); data-migrate is_admin → role; drop is_admin
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'b1c2d3e4f5a6'
down_revision: Union[str, None] = '166d4c2dd442'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. Enum types
    # ------------------------------------------------------------------
    op.execute("""
        CREATE TYPE org_role AS ENUM ('org_owner', 'org_admin', 'member')
    """)
    op.execute("""
        CREATE TYPE project_role AS ENUM ('project_admin', 'project_editor', 'project_member', 'guest')
    """)

    # ------------------------------------------------------------------
    # 2. ALTER TABLE users
    # ------------------------------------------------------------------
    op.add_column(
        'users',
        sa.Column(
            'role',
            sa.String(50),
            nullable=False,
            server_default='member',
        ),
    )
    op.add_column(
        'users',
        sa.Column(
            'is_platform_admin',
            sa.Boolean(),
            nullable=False,
            server_default='false',
        ),
    )

    # Data migration: first is_admin=True user (MIN created_at) → org_owner;
    # remaining is_admin=True users → org_admin; everyone else stays 'member'.
    op.execute("""
        UPDATE users
        SET role = 'org_owner'
        WHERE id = (
            SELECT id FROM users WHERE is_admin = TRUE ORDER BY created_at ASC LIMIT 1
        )
    """)
    op.execute("""
        UPDATE users
        SET role = 'org_admin'
        WHERE is_admin = TRUE
          AND id != (
            SELECT id FROM users WHERE is_admin = TRUE ORDER BY created_at ASC LIMIT 1
          )
    """)

    op.drop_column('users', 'is_admin')

    # ------------------------------------------------------------------
    # 3. CREATE TABLE project_memberships
    # ------------------------------------------------------------------
    op.create_table(
        'project_memberships',
        sa.Column(
            'id',
            postgresql.UUID(as_uuid=False),
            primary_key=True,
            server_default=sa.text('gen_random_uuid()'),
            nullable=False,
        ),
        sa.Column(
            'user_id',
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey('users.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column(
            'project_id',
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey('projects.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column('role', sa.String(50), nullable=False),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.UniqueConstraint('user_id', 'project_id', name='uq_project_memberships_user_project'),
    )
    op.create_index('ix_project_memberships_user_id', 'project_memberships', ['user_id'])
    op.create_index('ix_project_memberships_project_id', 'project_memberships', ['project_id'])

    # ------------------------------------------------------------------
    # 4. ALTER TABLE api_keys
    # ------------------------------------------------------------------
    op.add_column(
        'api_keys',
        sa.Column(
            'role',
            sa.String(50),
            nullable=False,
            server_default='member',
        ),
    )

    # Data migration: is_admin=True keys → org_admin role
    op.execute("""
        UPDATE api_keys SET role = 'org_admin' WHERE is_admin = TRUE
    """)

    op.drop_column('api_keys', 'is_admin')


def downgrade() -> None:
    # ------------------------------------------------------------------
    # 4. Restore api_keys.is_admin
    # ------------------------------------------------------------------
    op.add_column(
        'api_keys',
        sa.Column('is_admin', sa.Boolean(), nullable=False, server_default='false'),
    )
    op.execute("""
        UPDATE api_keys SET is_admin = TRUE WHERE role IN ('org_admin', 'org_owner')
    """)
    op.drop_column('api_keys', 'role')

    # ------------------------------------------------------------------
    # 3. DROP project_memberships
    # ------------------------------------------------------------------
    op.drop_index('ix_project_memberships_project_id', table_name='project_memberships')
    op.drop_index('ix_project_memberships_user_id', table_name='project_memberships')
    op.drop_table('project_memberships')

    # ------------------------------------------------------------------
    # 2. Restore users.is_admin
    # ------------------------------------------------------------------
    op.add_column(
        'users',
        sa.Column('is_admin', sa.Boolean(), nullable=False, server_default='false'),
    )
    op.execute("""
        UPDATE users SET is_admin = TRUE WHERE role IN ('org_owner', 'org_admin')
    """)
    op.drop_column('users', 'is_platform_admin')
    op.drop_column('users', 'role')

    # ------------------------------------------------------------------
    # 1. Drop enum types
    # ------------------------------------------------------------------
    op.execute("DROP TYPE IF EXISTS project_role")
    op.execute("DROP TYPE IF EXISTS org_role")
