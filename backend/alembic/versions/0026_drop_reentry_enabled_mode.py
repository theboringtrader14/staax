"""Drop reentry_enabled and reentry_mode columns from algo_legs

Revision ID: 0026
Revises: 0025
Create Date: 2026-04-14
"""
from alembic import op
import sqlalchemy as sa

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_column("algo_legs", "reentry_enabled")
    op.drop_column("algo_legs", "reentry_mode")


def downgrade():
    op.add_column(
        "algo_legs",
        sa.Column("reentry_enabled", sa.Boolean(), nullable=True, server_default="false"),
    )
    op.add_column(
        "algo_legs",
        sa.Column("reentry_mode", sa.String(length=50), nullable=True),
    )
