"""add_reentry_watcher_state_table

Revision ID: 0044
Revises: 0043
Create Date: 2026-05-11 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '0044'
down_revision: Union[str, None] = '0043'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'reentry_watcher_state',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('grid_entry_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('algo_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('order_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('leg_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('algo_state_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('direction', sa.String(10), nullable=False),
        sa.Column('trigger_price', sa.Float(), nullable=False),
        sa.Column('exit_reason', sa.String(20), nullable=False),
        sa.Column('reentry_count', sa.Integer(), nullable=False),
        sa.Column('ltp_mode', sa.String(20), nullable=False, server_default='ltp'),
        sa.Column('tsl_two_step', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('sl_original', sa.Float(), nullable=True),
        sa.Column('instrument_token', sa.Integer(), nullable=False),
        sa.Column('exit_time', sa.String(10), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='WATCHING'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('triggered_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('idx_reentry_watcher_status', 'reentry_watcher_state', ['status', 'created_at'])
    op.create_index('idx_reentry_watcher_grid', 'reentry_watcher_state', ['grid_entry_id'])


def downgrade() -> None:
    op.drop_index('idx_reentry_watcher_grid', table_name='reentry_watcher_state')
    op.drop_index('idx_reentry_watcher_status', table_name='reentry_watcher_state')
    op.drop_table('reentry_watcher_state')
