"""add_orb_range_state_table

Revision ID: 0043
Revises: 0042
Create Date: 2026-05-11 13:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '0043'
down_revision: Union[str, None] = '0042'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'orb_range_state',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('grid_entry_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('algo_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('account_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('symbol', sa.String(50), nullable=False),
        sa.Column('symbol_token', sa.String(20), nullable=False),
        sa.Column('exchange', sa.String(10), nullable=False),
        sa.Column('orb_start_time', sa.String(10), nullable=False),
        sa.Column('orb_end_time', sa.String(10), nullable=False),
        sa.Column('range_high', sa.Float(), nullable=True),
        sa.Column('range_low', sa.Float(), nullable=True),
        sa.Column('entry_at', sa.String(10), nullable=False),
        sa.Column('wt_buffer', sa.Float(), nullable=False, server_default='0'),
        sa.Column('wt_unit', sa.String(5), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='CAPTURING'),
        sa.Column('frozen_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('triggered_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('expired_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index('idx_orb_range_status_date', 'orb_range_state', ['status', 'created_at'])
    op.create_index('idx_orb_range_grid_entry_id', 'orb_range_state', ['grid_entry_id'])


def downgrade() -> None:
    op.drop_index('idx_orb_range_grid_entry_id', table_name='orb_range_state')
    op.drop_index('idx_orb_range_status_date', table_name='orb_range_state')
    op.drop_table('orb_range_state')
