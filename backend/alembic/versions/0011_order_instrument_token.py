"""orders.instrument_token — broker token for LTP lookup at entry and exit

Revision ID: 0011
Revises: 0010
Create Date: 2026-03-19

Changes:
  - orders.instrument_token  INTEGER — stored at order creation so PRACTIX
                                        exit can fetch live LTP by token
"""
from alembic import op
import sqlalchemy as sa

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "orders",
        sa.Column("instrument_token", sa.Integer(), nullable=True),
    )


def downgrade():
    op.drop_column("orders", "instrument_token")
