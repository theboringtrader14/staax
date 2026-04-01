"""algo_legs.instrument_token — broker token set at strike resolution

Revision ID: 0017
Revises: 0016
Create Date: 2026-04-01

Changes:
  - algo_legs.instrument_token  INTEGER nullable — set by algo_runner after
    strike selection so LTP tracking and position monitors can reference it.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    columns = [c["name"] for c in inspector.get_columns("algo_legs")]
    if "instrument_token" not in columns:
        op.add_column(
            "algo_legs",
            sa.Column("instrument_token", sa.Integer(), nullable=True),
        )


def downgrade():
    op.drop_column("algo_legs", "instrument_token")
