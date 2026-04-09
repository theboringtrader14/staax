"""Add journey_config to algo_legs.

Revision ID: 0023
Revises: 0022
Create Date: 2026-04-09

Changes:
  algo_legs table:
    - journey_config  JSON  NULL
      Stores child-leg config fired by JourneyEngine on parent exit.
      Previously incorrectly stored on algos table instead of algo_legs.
      Engine reads this via getattr(leg, "journey_config", None) in algo_runner._place_leg().
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "algo_legs",
        sa.Column("journey_config", postgresql.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("algo_legs", "journey_config")
