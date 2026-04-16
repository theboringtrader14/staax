"""journey_trigger column on algo_legs

Revision ID: 0035
Revises: 0034
Create Date: 2026-04-16
"""
from alembic import op
import sqlalchemy as sa

revision = '0035'
down_revision = '0034'
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "ALTER TABLE algo_legs ADD COLUMN IF NOT EXISTS "
        "journey_trigger VARCHAR(10) DEFAULT 'either'"
    )


def downgrade():
    op.drop_column('algo_legs', 'journey_trigger')
