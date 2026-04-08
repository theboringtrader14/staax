"""Add underlying_token to algo_legs + backfill from algos.underlying.

Revision ID: 0021
Revises: 0020
Create Date: 2026-04-08

Changes:
  algo_legs table:
    - underlying_token  INTEGER  NULL
      Stores the NSE/BSE index token for the underlying instrument.
      Used by SLTPMonitor to evaluate pts_underlying / pct_underlying SL/TP.
      Populated on leg creation/update via UNDERLYING_TOKENS map in algos.py.

Backfill:
  Existing rows are populated using a CASE on algos.underlying so that
  pts_underlying / pct_underlying SL/TP triggers work for already-created algos.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    leg_cols = [c["name"] for c in inspector.get_columns("algo_legs")]

    if "underlying_token" not in leg_cols:
        op.add_column(
            "algo_legs",
            sa.Column("underlying_token", sa.Integer(), nullable=True),
        )

    # Backfill existing rows — map algo.underlying → index token
    conn.execute(sa.text("""
        UPDATE algo_legs
        SET underlying_token = CASE
            WHEN algo_id IN (SELECT id FROM algos WHERE underlying = 'NIFTY')      THEN 99926000
            WHEN algo_id IN (SELECT id FROM algos WHERE underlying = 'BANKNIFTY')  THEN 99926009
            WHEN algo_id IN (SELECT id FROM algos WHERE underlying = 'SENSEX')     THEN 99919000
            WHEN algo_id IN (SELECT id FROM algos WHERE underlying = 'MIDCPNIFTY') THEN 99926074
            WHEN algo_id IN (SELECT id FROM algos WHERE underlying = 'FINNIFTY')   THEN 99926037
            ELSE 0
        END
        WHERE underlying_token IS NULL
    """))

    # Also backfill from the leg's own underlying column for legs whose algo
    # does not have an `underlying` field but the leg itself carries the value.
    conn.execute(sa.text("""
        UPDATE algo_legs
        SET underlying_token = CASE underlying
            WHEN 'NIFTY'      THEN 99926000
            WHEN 'BANKNIFTY'  THEN 99926009
            WHEN 'SENSEX'     THEN 99919000
            WHEN 'MIDCPNIFTY' THEN 99926074
            WHEN 'FINNIFTY'   THEN 99926037
            ELSE 0
        END
        WHERE underlying_token IS NULL OR underlying_token = 0
    """))


def downgrade():
    op.drop_column("algo_legs", "underlying_token")
