"""system_state table

Revision ID: 0003
Revises: 0002_order_retry_fields
Create Date: 2026-03-14
"""
from alembic import op
import sqlalchemy as sa

revision = '0003'
down_revision = '0002'
branch_labels = None
depends_on = None

def upgrade():
    op.create_table(
        'system_state',
        sa.Column('id',                 sa.Integer(),   primary_key=True),
        sa.Column('kill_switch_active', sa.Boolean(),   nullable=False, server_default='false'),
        sa.Column('kill_switch_at',     sa.DateTime(timezone=True), nullable=True),
        sa.Column('positions_squared',  sa.Integer(),   nullable=False, server_default='0'),
        sa.Column('orders_cancelled',   sa.Integer(),   nullable=False, server_default='0'),
        sa.Column('kill_switch_error',  sa.String(),    nullable=True),
    )
    # Insert the single system state row
    op.execute("INSERT INTO system_state (id, kill_switch_active, positions_squared, orders_cancelled) VALUES (1, false, 0, 0)")

def downgrade():
    op.drop_table('system_state')
