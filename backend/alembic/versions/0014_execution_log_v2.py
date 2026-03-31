"""execution_log_v2 — add grid_entry_id, event_type, details (jsonb), is_practix

Revision ID: 0014
Revises: 0013
Create Date: 2026-03-31
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = '0014'
down_revision = '0013'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('execution_logs',
        sa.Column('grid_entry_id', UUID(as_uuid=True), nullable=True))
    op.add_column('execution_logs',
        sa.Column('event_type', sa.String(30), nullable=True))
    op.add_column('execution_logs',
        sa.Column('details', JSONB(), nullable=True))
    op.add_column('execution_logs',
        sa.Column('is_practix', sa.Boolean(), nullable=True))

    # FK for grid_entry_id — SET NULL on delete so logs survive entry deletion
    op.create_foreign_key(
        'fk_execution_logs_grid_entry_id',
        'execution_logs', 'grid_entries',
        ['grid_entry_id'], ['id'],
        ondelete='SET NULL',
    )

    op.create_index('ix_execution_logs_event_type',    'execution_logs', ['event_type'])
    op.create_index('ix_execution_logs_grid_entry_id', 'execution_logs', ['grid_entry_id'])


def downgrade():
    op.drop_index('ix_execution_logs_grid_entry_id', 'execution_logs')
    op.drop_index('ix_execution_logs_event_type',    'execution_logs')
    op.drop_constraint('fk_execution_logs_grid_entry_id', 'execution_logs', type_='foreignkey')
    op.drop_column('execution_logs', 'is_practix')
    op.drop_column('execution_logs', 'details')
    op.drop_column('execution_logs', 'event_type')
    op.drop_column('execution_logs', 'grid_entry_id')
