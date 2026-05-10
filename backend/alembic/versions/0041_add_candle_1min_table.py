"""add_candle_1min_table

Revision ID: 0041
Revises: b0a824b9af2f
Create Date: 2026-05-10 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '0041'
down_revision: Union[str, None] = 'b0a824b9af2f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'candle_1min',
        sa.Column('symbol_token', sa.String(20), nullable=False),
        sa.Column('ts', sa.DateTime(timezone=True), nullable=False),
        sa.Column('open', sa.Float(), nullable=False),
        sa.Column('high', sa.Float(), nullable=False),
        sa.Column('low', sa.Float(), nullable=False),
        sa.Column('close', sa.Float(), nullable=False),
        sa.Column('volume', sa.Float(), nullable=True, server_default='0'),
        sa.PrimaryKeyConstraint('symbol_token', 'ts'),
    )
    op.create_index('idx_candle_1min_token_ts', 'candle_1min', ['symbol_token', 'ts'])


def downgrade() -> None:
    op.drop_index('idx_candle_1min_token_ts', table_name='candle_1min')
    op.drop_table('candle_1min')
