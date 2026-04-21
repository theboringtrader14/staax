"""Sync bot_signals schema — add trigger_price, bot_order_id, error_message

Revision ID: 0039
Revises: 0038
Create Date: 2026-04-21

The ORM model uses trigger_price / bot_order_id / error_message but the DB
still has the old column names (price / order_id) plus error_message missing.
Add the three missing columns as nullable so the ORM works without touching
the old columns (which may still hold historical data).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = '0039'
down_revision = '0038'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('bot_signals', sa.Column('trigger_price', sa.Float(),       nullable=True))
    op.add_column('bot_signals', sa.Column('bot_order_id',  UUID(as_uuid=True), nullable=True))
    op.add_column('bot_signals', sa.Column('error_message', sa.String(200),   nullable=True))
    # Copy existing data from old columns into new ones
    op.execute("UPDATE bot_signals SET trigger_price = price WHERE trigger_price IS NULL AND price IS NOT NULL")
    op.execute("UPDATE bot_signals SET bot_order_id  = order_id::uuid WHERE bot_order_id IS NULL AND order_id IS NOT NULL")


def downgrade():
    op.drop_column('bot_signals', 'error_message')
    op.drop_column('bot_signals', 'bot_order_id')
    op.drop_column('bot_signals', 'trigger_price')
