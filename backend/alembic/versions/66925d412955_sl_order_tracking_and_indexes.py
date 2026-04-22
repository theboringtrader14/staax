"""sl_order_tracking_and_indexes

Revision ID: 66925d412955
Revises: 0040
Create Date: 2026-04-22 19:08:21.632440

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '66925d412955'
down_revision: Union[str, None] = '0040'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add SL order tracking columns to orders table — appended at end so that
    # asyncpg positional binding ($N) aligns with the PostgreSQL column order
    # (ALTER TABLE ADD COLUMN always appends in PG; the model has them last too).
    op.add_column('orders', sa.Column('sl_order_id',     sa.String(length=50),  nullable=True))
    op.add_column('orders', sa.Column('sl_order_status', sa.String(length=20),  nullable=True))
    op.add_column('orders', sa.Column('sl_warning',      sa.String(length=200), nullable=True))

    # Add performance indexes (CREATE INDEX IF NOT EXISTS — idempotent)
    op.execute("CREATE INDEX IF NOT EXISTS ix_orders_account_id    ON orders (account_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_orders_algo_id       ON orders (algo_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_orders_grid_entry_id ON orders (grid_entry_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_orders_leg_id        ON orders (leg_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_orders_status        ON orders (status)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_orders_status")
    op.execute("DROP INDEX IF EXISTS ix_orders_leg_id")
    op.execute("DROP INDEX IF EXISTS ix_orders_grid_entry_id")
    op.execute("DROP INDEX IF EXISTS ix_orders_algo_id")
    op.execute("DROP INDEX IF EXISTS ix_orders_account_id")
    op.drop_column('orders', 'sl_warning')
    op.drop_column('orders', 'sl_order_status')
    op.drop_column('orders', 'sl_order_id')
