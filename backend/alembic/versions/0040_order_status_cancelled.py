"""Add 'cancelled' to orderstatus enum and 'superseded_by_retry' to exitreason enum

Revision ID: 0040
Revises: 0039
Create Date: 2026-04-22

Adds the CANCELLED order status so retried error legs can be hidden from the UI,
and adds SUPERSEDED_BY_RETRY exit reason for audit trail.
"""
from alembic import op

revision = '0040'
down_revision = '0039'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TYPE orderstatus ADD VALUE IF NOT EXISTS 'cancelled'")
    op.execute("ALTER TYPE exitreason ADD VALUE IF NOT EXISTS 'superseded_by_retry'")


def downgrade():
    # PostgreSQL does not support removing enum values without recreating the type.
    pass
