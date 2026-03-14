"""add killed_account_ids to system_state

Revision ID: 0004
Revises: 0003
Create Date: 2026-03-14
"""
from alembic import op
import sqlalchemy as sa

revision = '0004'
down_revision = '0003'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('system_state', sa.Column('killed_account_ids', sa.String(), nullable=True))

def downgrade():
    op.drop_column('system_state', 'killed_account_ids')
