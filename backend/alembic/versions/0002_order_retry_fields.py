"""Add retry_count and last_retry_time to orders

Revision ID: 0002
Revises: 0001
Create Date: 2026-03-08
"""
from alembic import op
import sqlalchemy as sa

revision = '0002'
down_revision = '0001_initial_schema'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('orders', sa.Column('retry_count', sa.Integer(), nullable=True, server_default='0'))
    op.add_column('orders', sa.Column('last_retry_time', sa.DateTime(timezone=True), nullable=True))

def downgrade():
    op.drop_column('orders', 'retry_count')
    op.drop_column('orders', 'last_retry_time')
