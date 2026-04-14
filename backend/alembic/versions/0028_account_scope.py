"""add scope column to accounts

Revision ID: 0028
Revises: 0027
Create Date: 2026-04-14
"""
from alembic import op
import sqlalchemy as sa

revision = '0028'
down_revision = '0027'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('accounts', sa.Column('scope', sa.String(10), nullable=True, server_default='fo'))

def downgrade():
    op.drop_column('accounts', 'scope')
