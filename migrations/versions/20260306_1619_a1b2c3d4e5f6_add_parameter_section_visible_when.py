"""add_parameter_section_visible_when

Revision ID: a1b2c3d4e5f6
Revises: c6743f47e62d
Create Date: 2026-03-06 16:19:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = 'c6743f47e62d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('parameters', sa.Column('section', sa.String(length=100), nullable=True))
    op.add_column('parameters', sa.Column('visible_when', postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column('parameters', 'visible_when')
    op.drop_column('parameters', 'section')
