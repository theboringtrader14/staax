"""Add account_fy_margin table for per-account per-FY margin and brokerage tracking

Revision ID: 0037
Revises: 0036
Create Date: 2026-04-21
"""
from alembic import op
import sqlalchemy as sa

revision = '0037'
down_revision = '0036'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'account_fy_margin',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('account_id', sa.UUID(as_uuid=True), sa.ForeignKey('accounts.id', ondelete='CASCADE'), nullable=False),
        sa.Column('fy_start', sa.Date(), nullable=False),   # e.g. 2026-04-01
        sa.Column('fy_margin', sa.Numeric(precision=18, scale=2), nullable=True),
        sa.Column('fy_brokerage', sa.Numeric(precision=18, scale=2), nullable=True),
        sa.Column('stamped_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint('account_id', 'fy_start', name='uq_account_fy_margin'),
    )
    op.create_index('ix_account_fy_margin_account_id', 'account_fy_margin', ['account_id'])
    op.create_index('ix_account_fy_margin_fy_start',   'account_fy_margin', ['fy_start'])


def downgrade():
    op.drop_index('ix_account_fy_margin_fy_start',   table_name='account_fy_margin')
    op.drop_index('ix_account_fy_margin_account_id', table_name='account_fy_margin')
    op.drop_table('account_fy_margin')
