"""bots_is_practix — add is_practix to bots

Revision ID: 0016
Revises: 0015
Create Date: 2026-03-31
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector

revision = '0016'
down_revision = '0015'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    columns = [c['name'] for c in inspector.get_columns('bots')]
    if 'is_practix' not in columns:
        op.add_column('bots', sa.Column(
            'is_practix', sa.Boolean(),
            nullable=False, server_default='true'
        ))


def downgrade():
    op.drop_column('bots', 'is_practix')
