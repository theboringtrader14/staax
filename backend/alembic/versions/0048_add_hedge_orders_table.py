"""add hedge_orders table

Revision ID: 0048
Revises: 0047
Create Date: 2026-05-14
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = '0048'
down_revision = '0047'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'hedge_orders',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('trading_date', sa.Date(), nullable=False),
        sa.Column('instrument', sa.String(20), nullable=False),
        sa.Column('option_type', sa.String(5), nullable=False),
        sa.Column('symbol', sa.String(50), nullable=False),
        sa.Column('symbol_token', sa.String(20), nullable=True),
        sa.Column('lots', sa.Integer(), nullable=False),
        sa.Column('quantity', sa.Integer(), nullable=False),
        sa.Column('fill_price', sa.Float(), nullable=True),
        sa.Column('ltp', sa.Float(), nullable=True),
        sa.Column('pnl', sa.Float(), nullable=True),
        sa.Column('broker_order_id', sa.String(50), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='OPEN'),
        sa.Column('placed_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('reason', sa.String(200), nullable=True),
        sa.Column('account_id', UUID(as_uuid=True), nullable=True),
    )
    op.create_index('ix_hedge_orders_trading_date', 'hedge_orders', ['trading_date'])


def downgrade():
    op.drop_index('ix_hedge_orders_trading_date', table_name='hedge_orders')
    op.drop_table('hedge_orders')
