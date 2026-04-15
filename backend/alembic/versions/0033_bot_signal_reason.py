"""bot_signal reason column

Revision ID: 0033
Revises: 0032
Create Date: 2026-04-15
"""
from alembic import op
import sqlalchemy as sa

revision = '0033'
down_revision = '0032'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('bot_signals', sa.Column('reason', sa.String(50), nullable=True))


def downgrade():
    op.drop_column('bot_signals', 'reason')
