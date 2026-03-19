"""add feed_token to accounts

Revision ID: 0009
Revises: 0008
Create Date: 2026-03-19

Angel One SmartStream (WebSocket) requires feedToken separately from jwtToken.
This column stores it alongside access_token for use by AngelOneTickerAdapter.
"""
from alembic import op
import sqlalchemy as sa

revision = '0009'
down_revision = '0008'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('accounts', sa.Column('feed_token', sa.Text(), nullable=True))


def downgrade():
    op.drop_column('accounts', 'feed_token')
