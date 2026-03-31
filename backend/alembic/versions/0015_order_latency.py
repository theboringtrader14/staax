"""order_latency — add placed_at, filled_at, latency_ms to orders

Revision ID: 0015
Revises: 0014
Create Date: 2026-03-31
"""
from alembic import op
import sqlalchemy as sa

revision = '0015'
down_revision = '0014'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('orders', sa.Column('placed_at',  sa.DateTime(timezone=True), nullable=True))
    op.add_column('orders', sa.Column('filled_at',  sa.DateTime(timezone=True), nullable=True))
    op.add_column('orders', sa.Column('latency_ms', sa.Integer(),               nullable=True))


def downgrade():
    op.drop_column('orders', 'latency_ms')
    op.drop_column('orders', 'filled_at')
    op.drop_column('orders', 'placed_at')
