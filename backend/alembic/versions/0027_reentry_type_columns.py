"""add reentry_type and reentry_ltp_mode to algo_legs; reentry_count and reentry_type_used to orders

Revision ID: 0027
Revises: 0026
Create Date: 2026-04-14
"""
from alembic import op
import sqlalchemy as sa

revision = '0027'
down_revision = '0026'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('algo_legs', sa.Column('reentry_type', sa.String(20), nullable=True))
    op.add_column('algo_legs', sa.Column('reentry_ltp_mode', sa.String(15), nullable=True))
    op.add_column('orders', sa.Column('reentry_count', sa.Integer(), nullable=True, server_default='0'))
    op.add_column('orders', sa.Column('reentry_type_used', sa.String(20), nullable=True))

def downgrade():
    op.drop_column('algo_legs', 'reentry_type')
    op.drop_column('algo_legs', 'reentry_ltp_mode')
    op.drop_column('orders', 'reentry_count')
    op.drop_column('orders', 'reentry_type_used')
