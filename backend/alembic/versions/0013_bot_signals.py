"""bot_signals table

Revision ID: 0013
Revises: 0012
Create Date: 2026-03-30
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = '0013'
down_revision = '0012'
branch_labels = None
depends_on = None

def upgrade():
    op.create_table('bot_signals',
        sa.Column('id',            UUID(as_uuid=True), primary_key=True),
        sa.Column('bot_id',        UUID(as_uuid=True), nullable=False),
        sa.Column('signal_type',   sa.String(20),  nullable=False),
        sa.Column('direction',     sa.String(5),   nullable=True),
        sa.Column('instrument',    sa.String(20),  nullable=False),
        sa.Column('expiry',        sa.String(20),  nullable=False),
        sa.Column('trigger_price', sa.Float(),     nullable=True),
        sa.Column('status',        sa.String(20),  nullable=False, server_default='fired'),
        sa.Column('bot_order_id',  UUID(as_uuid=True), nullable=True),
        sa.Column('error_message', sa.String(200), nullable=True),
        sa.Column('fired_at',      sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at',    sa.DateTime(timezone=True)),
    )
    op.create_index('ix_bot_signals_bot_id',  'bot_signals', ['bot_id'])
    op.create_index('ix_bot_signals_fired_at', 'bot_signals', ['fired_at'])

def downgrade():
    op.drop_table('bot_signals')
