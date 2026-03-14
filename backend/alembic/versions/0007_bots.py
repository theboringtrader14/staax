"""bots and bot_orders tables

Revision ID: 0007
Revises: 0006
Create Date: 2026-03-14
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = '0007'
down_revision = '0006'
branch_labels = None
depends_on = None

def upgrade():
    op.create_table('bots',
        sa.Column('id',              UUID(as_uuid=True), primary_key=True),
        sa.Column('name',            sa.String(100), nullable=False),
        sa.Column('account_id',      UUID(as_uuid=True), nullable=False),
        sa.Column('instrument',      sa.String(20),  nullable=False),
        sa.Column('exchange',        sa.String(10),  nullable=False),
        sa.Column('expiry',          sa.String(20),  nullable=False),
        sa.Column('indicator',       sa.String(20),  nullable=False),
        sa.Column('timeframe_mins',  sa.Integer(),   nullable=False, server_default='60'),
        sa.Column('lots',            sa.Integer(),   nullable=False, server_default='1'),
        sa.Column('channel_candles', sa.Integer(),   nullable=True),
        sa.Column('tt_lookback',     sa.Integer(),   nullable=True),
        sa.Column('status',          sa.String(20),  nullable=False, server_default='active'),
        sa.Column('is_archived',     sa.Boolean(),   server_default='false'),
        sa.Column('created_at',      sa.DateTime(timezone=True)),
        sa.Column('updated_at',      sa.DateTime(timezone=True)),
    )
    op.create_table('bot_orders',
        sa.Column('id',              UUID(as_uuid=True), primary_key=True),
        sa.Column('bot_id',          UUID(as_uuid=True), nullable=False),
        sa.Column('account_id',      UUID(as_uuid=True), nullable=False),
        sa.Column('instrument',      sa.String(20), nullable=False),
        sa.Column('expiry',          sa.String(20), nullable=False),
        sa.Column('direction',       sa.String(5),  nullable=False),
        sa.Column('lots',            sa.Integer(),  nullable=False),
        sa.Column('entry_price',     sa.Float(),    nullable=True),
        sa.Column('exit_price',      sa.Float(),    nullable=True),
        sa.Column('entry_time',      sa.DateTime(timezone=True), nullable=True),
        sa.Column('exit_time',       sa.DateTime(timezone=True), nullable=True),
        sa.Column('pnl',             sa.Float(),    nullable=True),
        sa.Column('status',          sa.String(20), server_default='open'),
        sa.Column('broker_order_id', sa.String(50), nullable=True),
        sa.Column('signal_type',     sa.String(20), nullable=True),
        sa.Column('error_message',   sa.String(200), nullable=True),
    )
    op.create_index('ix_bot_orders_bot_id', 'bot_orders', ['bot_id'])
    op.create_index('ix_bot_orders_status', 'bot_orders', ['status'])

def downgrade():
    op.drop_table('bot_orders')
    op.drop_table('bots')
