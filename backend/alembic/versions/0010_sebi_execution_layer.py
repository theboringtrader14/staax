"""SEBI execution layer — algo_tag, execution_logs, algorithms_registry, strategy_type

Revision ID: 0010
Revises: 0009
Create Date: 2026-03-19

Changes:
  - orders.algo_tag          — SEBI audit tag on every live order
  - algos.strategy_type      — white_box / black_box classification
  - execution_logs table     — immutable audit trail for every order decision
  - algorithms_registry table — one row per registered algo
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0010'
down_revision = '0009'
branch_labels = None
depends_on = None


def upgrade():
    # ── 1. algo_tag on orders ────────────────────────────────────────────────
    op.add_column('orders',
        sa.Column('algo_tag', sa.String(150), nullable=True)
    )

    # ── 2. strategy_type on algos ────────────────────────────────────────────
    op.add_column('algos',
        sa.Column('strategy_type', sa.String(20), nullable=True)
    )

    # ── 3. execution_logs ────────────────────────────────────────────────────
    op.create_table(
        'execution_logs',
        sa.Column('id',         postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('timestamp',  sa.DateTime(timezone=True),    server_default=sa.func.now(), nullable=False),
        sa.Column('account_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('accounts.id', ondelete='SET NULL'), nullable=True),
        sa.Column('algo_id',    postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('algos.id',    ondelete='SET NULL'), nullable=True),
        sa.Column('order_id',   postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('orders.id',   ondelete='SET NULL'), nullable=True),
        sa.Column('algo_tag',   sa.String(150), nullable=True),
        sa.Column('action',     sa.String(30),  nullable=False),
        sa.Column('status',     sa.String(20),  nullable=False),
        sa.Column('reason',     sa.Text(),      nullable=True),
    )
    op.create_index('ix_execution_logs_timestamp', 'execution_logs', ['timestamp'])
    op.create_index('ix_execution_logs_algo_id',   'execution_logs', ['algo_id'])
    op.create_index('ix_execution_logs_order_id',  'execution_logs', ['order_id'])

    # ── 4. algorithms_registry ───────────────────────────────────────────────
    op.create_table(
        'algorithms_registry',
        sa.Column('id',            postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('algo_id',       postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('algos.id', ondelete='CASCADE'), nullable=False, unique=True),
        sa.Column('name',          sa.String(100), nullable=False),
        sa.Column('strategy_type', sa.String(20),  nullable=False),
        sa.Column('version',       sa.String(20),  nullable=False, server_default='1.0'),
        sa.Column('registered_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('exchange_ref',  sa.String(100), nullable=True),
    )


def downgrade():
    op.drop_table('algorithms_registry')
    op.drop_index('ix_execution_logs_order_id',  table_name='execution_logs')
    op.drop_index('ix_execution_logs_algo_id',   table_name='execution_logs')
    op.drop_index('ix_execution_logs_timestamp', table_name='execution_logs')
    op.drop_table('execution_logs')
    op.drop_column('algos',  'strategy_type')
    op.drop_column('orders', 'algo_tag')
