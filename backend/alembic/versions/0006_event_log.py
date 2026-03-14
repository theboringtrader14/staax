"""event_log table for persistent notifications

Revision ID: 0006
Revises: 0005
Create Date: 2026-03-14
"""
from alembic import op
import sqlalchemy as sa

revision = '0006'
down_revision = '0005'
branch_labels = None
depends_on = None

def upgrade():
    op.create_table(
        'event_log',
        sa.Column('id',         sa.Integer(),     primary_key=True, autoincrement=True),
        sa.Column('ts',         sa.DateTime(timezone=True), nullable=False),
        sa.Column('level',      sa.String(10),    nullable=False),   # info/warn/error/success
        sa.Column('msg',        sa.String(500),   nullable=False),
        sa.Column('algo_name',  sa.String(100),   nullable=True),
        sa.Column('algo_id',    sa.String(50),    nullable=True),
        sa.Column('account_id', sa.String(50),    nullable=True),
        sa.Column('source',     sa.String(50),    nullable=True),    # engine/api/scheduler
        sa.Column('details',    sa.Text(),         nullable=True),    # JSON extra data
    )
    op.create_index('ix_event_log_ts', 'event_log', ['ts'])

def downgrade():
    op.drop_table('event_log')
