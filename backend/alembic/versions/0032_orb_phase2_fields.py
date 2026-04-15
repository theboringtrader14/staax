"""ORB Phase 2 fields on algo_legs + orb_high/low on algo_states

Revision ID: 0032
Revises: 0030
Create Date: 2026-04-15

"""
from alembic import op
import sqlalchemy as sa

revision = '0032'
down_revision = '0030'
branch_labels = None
depends_on = None


def upgrade():
    # algo_legs — ORB Phase 2 fields
    op.add_column('algo_legs', sa.Column('orb_range_source', sa.String(15), nullable=True))
    op.add_column('algo_legs', sa.Column('orb_entry_at',     sa.String(5),  nullable=True))
    op.add_column('algo_legs', sa.Column('orb_sl_type',      sa.String(30), nullable=True))
    op.add_column('algo_legs', sa.Column('orb_tp_type',      sa.String(30), nullable=True))
    op.add_column('algo_legs', sa.Column('orb_buffer_value', sa.Float(),    nullable=True))
    op.add_column('algo_legs', sa.Column('orb_buffer_unit',  sa.String(5),  nullable=True))
    # algo_legs — re-entry max split
    op.add_column('algo_legs', sa.Column('reentry_max_sl', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('algo_legs', sa.Column('reentry_max_tp', sa.Integer(), nullable=False, server_default='0'))
    # algo_states — ORB levels + split re-entry counts
    op.add_column('algo_states', sa.Column('orb_high',         sa.Float(),   nullable=True))
    op.add_column('algo_states', sa.Column('orb_low',          sa.Float(),   nullable=True))
    op.add_column('algo_states', sa.Column('sl_reentry_count', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('algo_states', sa.Column('tp_reentry_count', sa.Integer(), nullable=False, server_default='0'))


def downgrade():
    op.drop_column('algo_legs', 'orb_range_source')
    op.drop_column('algo_legs', 'orb_entry_at')
    op.drop_column('algo_legs', 'orb_sl_type')
    op.drop_column('algo_legs', 'orb_tp_type')
    op.drop_column('algo_legs', 'orb_buffer_value')
    op.drop_column('algo_legs', 'orb_buffer_unit')
    op.drop_column('algo_legs', 'reentry_max_sl')
    op.drop_column('algo_legs', 'reentry_max_tp')
    op.drop_column('algo_states', 'orb_high')
    op.drop_column('algo_states', 'orb_low')
    op.drop_column('algo_states', 'sl_reentry_count')
    op.drop_column('algo_states', 'tp_reentry_count')
