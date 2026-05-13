"""add sl_buffer_pct to algo_leg

Revision ID: 0046
Revises: 0045
Create Date: 2026-05-13
"""
from alembic import op
import sqlalchemy as sa

revision = '0046'
down_revision = '0045'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('algo_legs', sa.Column('sl_buffer_pct', sa.Float(), nullable=False, server_default='2.0'))

def downgrade():
    op.drop_column('algo_legs', 'sl_buffer_pct')
