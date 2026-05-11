"""add_wt_armed_state_table

Revision ID: 0042
Revises: 0041
Create Date: 2026-05-11 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '0042'
down_revision: Union[str, None] = '0041'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'wt_armed_state',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('grid_entry_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('algo_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('account_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('leg_number', sa.Integer(), nullable=False),
        sa.Column('symbol', sa.String(50), nullable=False),
        sa.Column('symbol_token', sa.String(20), nullable=False),
        sa.Column('exchange', sa.String(10), nullable=False),
        sa.Column('direction', sa.String(10), nullable=False),
        sa.Column('ref_price', sa.Float(), nullable=False),
        sa.Column('threshold', sa.Float(), nullable=False),
        sa.Column('limit_price', sa.Float(), nullable=False),
        sa.Column('broker_sl_id', sa.String(50), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='ARMED'),
        sa.Column('armed_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('triggered_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('expired_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('idx_wt_armed_status_date', 'wt_armed_state', ['status', 'armed_at'])
    op.create_index('idx_wt_armed_grid_entry_id', 'wt_armed_state', ['grid_entry_id'])


def downgrade() -> None:
    op.drop_index('idx_wt_armed_grid_entry_id', table_name='wt_armed_state')
    op.drop_index('idx_wt_armed_status_date', table_name='wt_armed_state')
    op.drop_table('wt_armed_state')
