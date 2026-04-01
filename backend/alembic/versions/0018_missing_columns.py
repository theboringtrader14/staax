"""Add columns present in models but missing from migrations.

Revision ID: 0018
Revises: 0017
Create Date: 2026-04-01

Changes:
  - accounts.totp_secret    TEXT NULL       — Angel One TOTP for auto-login
  - accounts.fy_margin      FLOAT NULL      — FY trading margin ₹ (ROI calc)
  - algos.recurring_days    JSON NULL       — ["MON","WED"] auto-grid days
  - algos.strategy_type     VARCHAR(50) NULL — already in 0010 (no-op guard)
  - algos.is_live           BOOLEAN NOT NULL — live vs paper flag (default false)
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)

    # ── accounts ──────────────────────────────────────────────────────────────
    acct_cols = [c["name"] for c in inspector.get_columns("accounts")]

    if "totp_secret" not in acct_cols:
        op.add_column("accounts", sa.Column("totp_secret", sa.Text(), nullable=True))

    if "fy_margin" not in acct_cols:
        op.add_column(
            "accounts",
            sa.Column("fy_margin", sa.Float(), nullable=True, server_default="0"),
        )

    # ── algos ─────────────────────────────────────────────────────────────────
    algo_cols = [c["name"] for c in inspector.get_columns("algos")]

    if "recurring_days" not in algo_cols:
        op.add_column("algos", sa.Column("recurring_days", sa.JSON(), nullable=True))

    # strategy_type was added in 0010 as String(20) — guard included as safety net
    # for any server that skipped 0010 or has a partial migration history.
    if "strategy_type" not in algo_cols:
        op.add_column(
            "algos", sa.Column("strategy_type", sa.String(50), nullable=True)
        )

    if "is_live" not in algo_cols:
        op.add_column(
            "algos",
            sa.Column("is_live", sa.Boolean(), nullable=False, server_default="false"),
        )


def downgrade():
    op.drop_column("accounts", "totp_secret")
    op.drop_column("accounts", "fy_margin")
    op.drop_column("algos", "recurring_days")
    op.drop_column("algos", "is_live")
    # strategy_type owned by 0010 — do not drop here to avoid breaking 0010 downgrade
