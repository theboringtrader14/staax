"""Add sl_type column to orders table

Revision ID: 0036
Revises: 0035
Create Date: 2026-04-21
"""
from alembic import op
import sqlalchemy as sa

revision = '0036'
down_revision = '0035'
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS "
        "sl_type VARCHAR(20) DEFAULT NULL"
    )


def downgrade():
    op.drop_column('orders', 'sl_type')
