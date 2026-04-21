"""add instrument and expiry columns to bot_signals

Revision ID: 0038
Revises: 0037
Create Date: 2026-04-21
"""
from alembic import op
import sqlalchemy as sa

revision = '0038'
down_revision = '0037'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('bot_signals', sa.Column('instrument', sa.String(20), nullable=True))
    op.add_column('bot_signals', sa.Column('expiry',     sa.String(20), nullable=True))


def downgrade():
    op.drop_column('bot_signals', 'instrument')
    op.drop_column('bot_signals', 'expiry')
