"""Add journey_state table for persistent journey trigger tracking

Revision ID: 0045
Revises: 0044
Create Date: 2026-05-12
"""
from typing import Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '0045'
down_revision: Union[str, None] = '0044'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'journey_state',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('parent_grid_entry_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('child_grid_entry_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('parent_leg_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('child_leg_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('trigger_on', sa.Enum('sl_hit', 'tp_hit', 'exit', 'fill', name='journeytriggeron'), nullable=False),
        sa.Column('status', sa.Enum('watching', 'triggered', 'cancelled', 'expired', name='journeystatus'), nullable=False, server_default='watching'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_journey_state_parent_grid_entry_id', 'journey_state', ['parent_grid_entry_id'])
    op.create_index('ix_journey_state_child_grid_entry_id', 'journey_state', ['child_grid_entry_id'])


def downgrade():
    op.drop_index('ix_journey_state_child_grid_entry_id', table_name='journey_state')
    op.drop_index('ix_journey_state_parent_grid_entry_id', table_name='journey_state')
    op.drop_table('journey_state')
    op.execute("DROP TYPE IF EXISTS journeytriggeron")
    op.execute("DROP TYPE IF EXISTS journeystatus")
