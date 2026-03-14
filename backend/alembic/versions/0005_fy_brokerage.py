"""add fy_brokerage to accounts

Revision ID: 0005
Revises: 0004
Create Date: 2026-03-14
"""
from alembic import op
import sqlalchemy as sa

revision = '0005'
down_revision = '0004'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('accounts', sa.Column('fy_brokerage', sa.Float(), nullable=True))

def downgrade():
    op.drop_column('accounts', 'fy_brokerage')
