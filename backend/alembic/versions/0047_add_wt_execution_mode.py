"""add wt_execution_mode to algo_legs

Revision ID: 0047
Revises: 0046
Create Date: 2026-05-14
"""
from alembic import op
import sqlalchemy as sa

revision = '0047'
down_revision = '0046'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('algo_legs',
        sa.Column('wt_execution_mode', sa.String(10), nullable=False, server_default='sl_limit')
    )

def downgrade():
    op.drop_column('algo_legs', 'wt_execution_mode')
