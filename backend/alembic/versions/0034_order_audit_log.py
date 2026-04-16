"""order_audit_log table

Revision ID: 0034
Revises: 0033
Create Date: 2026-04-16
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = '0034'
down_revision = '0033'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'order_audit_log',
        sa.Column('id',             UUID(as_uuid=True), primary_key=True),
        sa.Column('logged_at',      sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('order_id',       sa.String(36),  nullable=True, index=True),
        sa.Column('algo_id',        sa.String(36),  nullable=True, index=True),
        sa.Column('grid_entry_id',  sa.String(36),  nullable=True),
        sa.Column('account_id',     sa.String(36),  nullable=True),
        sa.Column('from_status',    sa.String(20),  nullable=True),
        sa.Column('to_status',      sa.String(20),  nullable=False),
        sa.Column('symbol',         sa.String(30),  nullable=True),
        sa.Column('direction',      sa.String(4),   nullable=True),
        sa.Column('fill_price',     sa.Float(),     nullable=True),
        sa.Column('broker_order_id', sa.String(50), nullable=True),
        sa.Column('is_practix',     sa.String(5),   nullable=True),
        sa.Column('note',           sa.Text(),      nullable=True),
    )


def downgrade():
    op.drop_table('order_audit_log')
