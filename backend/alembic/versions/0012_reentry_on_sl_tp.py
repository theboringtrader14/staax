"""add reentry_on_sl reentry_on_tp to algo_legs

Revision ID: 0012
Revises: 0011
"""
from alembic import op
import sqlalchemy as sa

revision = '0012'
down_revision = '0011'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('algo_legs', sa.Column('reentry_on_sl', sa.Boolean(), nullable=True, server_default='false'))
    op.add_column('algo_legs', sa.Column('reentry_on_tp', sa.Boolean(), nullable=True, server_default='false'))

def downgrade():
    op.drop_column('algo_legs', 'reentry_on_tp')
    op.drop_column('algo_legs', 'reentry_on_sl')
