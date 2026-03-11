"""add remote git to projects

Revision ID: c4d5e6f7a8b9
Revises: b2c3d4e5f6a7
Create Date: 2026-03-10 09:00:00

Adds three columns to the projects table to support linking a project to
a remote Git repository:

  remote_url            — HTTPS or SSH clone URL (e.g. https://github.com/org/repo.git)
  remote_branch         — branch to track (default: main)
  remote_credential_ref — secret reference string for auth (e.g. "secret:my_git_token"
                          or "env:GIT_TOKEN"). Uses the existing SecretResolver.
"""

from alembic import op
import sqlalchemy as sa

revision = "c4d5e6f7a8b9"
down_revision = "b2c3d4e5f6a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("remote_url", sa.String(500), nullable=True))
    op.add_column(
        "projects",
        sa.Column(
            "remote_branch",
            sa.String(100),
            server_default="main",
            nullable=False,
        ),
    )
    op.add_column(
        "projects",
        sa.Column("remote_credential_ref", sa.String(500), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("projects", "remote_credential_ref")
    op.drop_column("projects", "remote_branch")
    op.drop_column("projects", "remote_url")
