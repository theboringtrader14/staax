"""add is_archived to algo_legs

Revision ID: 0030
Revises: 0029
Create Date: 2026-04-15
"""
from alembic import op
import sqlalchemy as sa

revision = '0030'
down_revision = '0029'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'algo_legs',
        sa.Column('is_archived', sa.Boolean(), nullable=False, server_default='false')
    )


def downgrade() -> None:
    op.drop_column('algo_legs', 'is_archived')
