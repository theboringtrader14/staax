"""add channel_tf to bots

Revision ID: 0008
Revises: 0007
Create Date: 2026-03-14
"""
from alembic import op
import sqlalchemy as sa

revision = '0008'
down_revision = '0007'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('bots', sa.Column('channel_tf', sa.String(10), nullable=True))

def downgrade():
    op.drop_column('bots', 'channel_tf')
