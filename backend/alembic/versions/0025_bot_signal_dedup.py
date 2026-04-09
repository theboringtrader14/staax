"""Add candle_timestamp and dedup constraint to bot_signals

Revision ID: 0025
Revises: 0024
Create Date: 2026-04-09
"""
from alembic import op
import sqlalchemy as sa

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "bot_signals",
        sa.Column("candle_timestamp", sa.DateTime(timezone=True), nullable=True),
    )
    # Partial unique index — allows multiple NULLs (manual signals without candle context)
    op.create_index(
        "uq_bot_signal",
        "bot_signals",
        ["bot_id", "signal_type", "direction", "candle_timestamp"],
        unique=True,
        postgresql_where=sa.text("candle_timestamp IS NOT NULL"),
    )


def downgrade():
    op.drop_index("uq_bot_signal", table_name="bot_signals")
    op.drop_column("bot_signals", "candle_timestamp")
