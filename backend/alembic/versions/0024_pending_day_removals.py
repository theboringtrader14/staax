"""Add pending_day_removals to algos

Revision ID: 0024
Revises: 0023
Create Date: 2026-04-09
"""
from alembic import op
import sqlalchemy as sa

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "algos",
        sa.Column("pending_day_removals", sa.JSON(), nullable=True),
    )


def downgrade():
    op.drop_column("algos", "pending_day_removals")
