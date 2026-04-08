"""Add ttp_trail_count to orders.

Revision ID: 0022
Revises: 0021
Create Date: 2026-04-08

Changes:
  orders table:
    - ttp_trail_count  INTEGER  DEFAULT 0
      Tracks number of TTP trails fired per position.
      Mirrors tsl_trail_count pattern for TSL.
      Persisted by TTPEngine._persist_trail() on every trail.
"""
from alembic import op
import sqlalchemy as sa

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "orders",
        sa.Column("ttp_trail_count", sa.Integer(), nullable=True, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("orders", "ttp_trail_count")
