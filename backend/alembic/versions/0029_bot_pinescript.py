"""add pinescript_code to bots

Revision ID: 0029
Revises: 0028
Create Date: 2026-04-14
"""
from alembic import op
import sqlalchemy as sa

revision = '0029'
down_revision = '0028'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('bots', sa.Column('pinescript_code', sa.Text(), nullable=True))

def downgrade():
    op.drop_column('bots', 'pinescript_code')
