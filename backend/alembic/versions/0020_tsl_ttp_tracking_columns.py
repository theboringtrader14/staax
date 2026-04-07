"""TSL/TTP tracking columns — orders table + algo_legs tsl_enabled/ttp_enabled.

Revision ID: 0020
Revises: 0019
Create Date: 2026-04-07

Changes:
  orders table — new TSL/TTP runtime tracking columns:
    - tsl_activated        BOOLEAN      NOT NULL DEFAULT false
    - tsl_activation_price FLOAT        NULL
    - tsl_current_sl       FLOAT        NULL     — mirrors sl_actual but explicit for TSL
    - ttp_activated        BOOLEAN      NOT NULL DEFAULT false
    - ttp_activation_price FLOAT        NULL
    - ttp_current_tp       FLOAT        NULL     — mirrors target but explicit for TTP
    NOTE: tsl_trail_count already exists (added in initial schema) — guarded, not re-added.

  algo_legs table — missing feature-enable flags:
    - tsl_enabled  BOOLEAN NULL DEFAULT false
    - ttp_enabled  BOOLEAN NULL DEFAULT false

Root cause fixed:
  AlgoLeg was missing tsl_enabled/ttp_enabled, so algo_runner.py line 795
  `getattr(leg, "tsl_enabled", False)` always returned False, making TSL/TTP dead.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)

    # ── orders ────────────────────────────────────────────────────────────────
    order_cols = [c["name"] for c in inspector.get_columns("orders")]

    if "tsl_activated" not in order_cols:
        op.add_column(
            "orders",
            sa.Column("tsl_activated", sa.Boolean(), nullable=False, server_default="false"),
        )

    if "tsl_activation_price" not in order_cols:
        op.add_column(
            "orders",
            sa.Column("tsl_activation_price", sa.Float(), nullable=True),
        )

    if "tsl_current_sl" not in order_cols:
        op.add_column(
            "orders",
            sa.Column("tsl_current_sl", sa.Float(), nullable=True),
        )

    # tsl_trail_count guard — already in initial schema, but guard for safety
    if "tsl_trail_count" not in order_cols:
        op.add_column(
            "orders",
            sa.Column("tsl_trail_count", sa.Integer(), nullable=False, server_default="0"),
        )

    if "ttp_activated" not in order_cols:
        op.add_column(
            "orders",
            sa.Column("ttp_activated", sa.Boolean(), nullable=False, server_default="false"),
        )

    if "ttp_activation_price" not in order_cols:
        op.add_column(
            "orders",
            sa.Column("ttp_activation_price", sa.Float(), nullable=True),
        )

    if "ttp_current_tp" not in order_cols:
        op.add_column(
            "orders",
            sa.Column("ttp_current_tp", sa.Float(), nullable=True),
        )

    # ── algo_legs ─────────────────────────────────────────────────────────────
    leg_cols = [c["name"] for c in inspector.get_columns("algo_legs")]

    if "tsl_enabled" not in leg_cols:
        op.add_column(
            "algo_legs",
            sa.Column("tsl_enabled", sa.Boolean(), nullable=True, server_default="false"),
        )

    if "ttp_enabled" not in leg_cols:
        op.add_column(
            "algo_legs",
            sa.Column("ttp_enabled", sa.Boolean(), nullable=True, server_default="false"),
        )


def downgrade():
    # orders
    op.drop_column("orders", "tsl_activated")
    op.drop_column("orders", "tsl_activation_price")
    op.drop_column("orders", "tsl_current_sl")
    op.drop_column("orders", "ttp_activated")
    op.drop_column("orders", "ttp_activation_price")
    op.drop_column("orders", "ttp_current_tp")
    # NOTE: tsl_trail_count is owned by initial schema — do NOT drop here

    # algo_legs
    op.drop_column("algo_legs", "tsl_enabled")
    op.drop_column("algo_legs", "ttp_enabled")
