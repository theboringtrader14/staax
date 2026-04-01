"""Fix algos column types mismatched between local and server.

Revision ID: 0019
Revises: 0018
Create Date: 2026-04-01

Changes:
  - algos.recurring_days: text[] → json  (model uses JSON; server got ARRAY from 0018)
  - algos.is_live: add BOOLEAN NOT NULL default false (missing from server 0018)

Server had recurring_days as text[] (postgresql.ARRAY) but model uses Column(JSON).
Since all server rows had NULL recurring_days, we drop-and-recreate as json.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    algo_cols = {c["name"]: c for c in inspector.get_columns("algos")}

    # Fix recurring_days: text[] → json
    # Drop and recreate — all server rows were NULL, no data loss.
    if "recurring_days" in algo_cols:
        existing_type = str(algo_cols["recurring_days"]["type"])
        if "ARRAY" in existing_type.upper() or "[]" in existing_type:
            op.drop_column("algos", "recurring_days")
            op.add_column("algos", sa.Column("recurring_days", sa.JSON(), nullable=True))
    else:
        # Column didn't exist at all — add it
        op.add_column("algos", sa.Column("recurring_days", sa.JSON(), nullable=True))

    # Add is_live if missing
    if "is_live" not in algo_cols:
        op.add_column(
            "algos",
            sa.Column("is_live", sa.Boolean(), nullable=False, server_default="false"),
        )


def downgrade():
    op.drop_column("algos", "is_live")
    op.drop_column("algos", "recurring_days")
    op.add_column(
        "algos",
        sa.Column("recurring_days", sa.Text(), nullable=True),
    )
