"""render_history_display_label

Revision ID: e6f7a8b9c0d1
Revises: d5e6f7a8b9c0
Create Date: 2026-03-15 09:00:00.000000

Adds:
  - templates.history_label_param VARCHAR(200): which parameter value to use as the
    render history display label (e.g. "router.hostname")
  - render_history.display_label VARCHAR(500): the extracted value at render time,
    stored for fast search and grouping even after template changes
  - Indexes for fast grouped/searched queries on render_history
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'e6f7a8b9c0d1'
down_revision = 'd5e6f7a8b9c0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Add history_label_param to templates
    op.add_column(
        'templates',
        sa.Column('history_label_param', sa.String(200), nullable=True),
    )

    # 2. Add display_label to render_history
    op.add_column(
        'render_history',
        sa.Column('display_label', sa.String(500), nullable=True),
    )

    # 3. Index for fast grouping queries: template_id + display_label
    op.create_index(
        'ix_render_history_display_label',
        'render_history',
        ['template_id', 'display_label'],
    )

    # 4. Index for rendered_by filter (IF NOT EXISTS to handle pre-existing index)
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_render_history_rendered_by ON render_history (rendered_by)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_render_history_rendered_by")
    op.drop_index('ix_render_history_display_label', table_name='render_history')
    op.drop_column('render_history', 'display_label')
    op.drop_column('templates', 'history_label_param')
