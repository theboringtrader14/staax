"""Initial schema — all STAAX tables

Revision ID: 0001_initial_schema
Revises:
Create Date: 2026-03-07
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0001_initial_schema'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:

    # ── accounts ──────────────────────────────────────────────────────────────
    op.create_table('accounts',
        sa.Column('id',                   postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('nickname',             sa.String(50),  nullable=False, unique=True),
        sa.Column('broker',               sa.Enum('zerodha','angelone', name='brokertype'), nullable=False),
        sa.Column('client_id',            sa.String(100), nullable=False),
        sa.Column('api_key',              sa.String(255), nullable=True),
        sa.Column('api_secret',           sa.Text,        nullable=True),
        sa.Column('access_token',         sa.Text,        nullable=True),
        sa.Column('token_generated_at',   sa.DateTime(timezone=True), nullable=True),
        sa.Column('status',               sa.Enum('active','token_expired','disconnected', name='accountstatus'), nullable=True),
        sa.Column('global_sl',            sa.Float,       nullable=True),
        sa.Column('global_tp',            sa.Float,       nullable=True),
        sa.Column('is_active',            sa.Boolean,     default=True),
        sa.Column('created_at',           sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at',           sa.DateTime(timezone=True), nullable=True),
    )

    # ── algos ─────────────────────────────────────────────────────────────────
    op.create_table('algos',
        sa.Column('id',                   postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('name',                 sa.String(100), nullable=False, unique=True),
        sa.Column('account_id',           postgresql.UUID(as_uuid=True), sa.ForeignKey('accounts.id'), nullable=False),
        sa.Column('strategy_mode',        sa.Enum('intraday','btst','stbt','positional', name='strategymode'), nullable=False),
        sa.Column('entry_type',           sa.Enum('direct','orb', name='entrytype'), nullable=False),
        sa.Column('order_type',           sa.Enum('market','limit', name='ordertype'), nullable=True),
        sa.Column('is_active',            sa.Boolean, default=True),
        sa.Column('entry_time',           sa.String(8),  nullable=True),
        sa.Column('exit_time',            sa.String(8),  nullable=True),
        sa.Column('orb_start_time',       sa.String(8),  nullable=True),
        sa.Column('orb_end_time',         sa.String(8),  nullable=True),
        sa.Column('next_day_exit_time',   sa.String(8),  nullable=True),
        sa.Column('dte',                  sa.Integer,    nullable=True),
        sa.Column('mtm_sl',               sa.Float,      nullable=True),
        sa.Column('mtm_tp',               sa.Float,      nullable=True),
        sa.Column('mtm_unit',             sa.String(5),  nullable=True),
        sa.Column('entry_delay_buy_secs', sa.Integer,    default=0),
        sa.Column('entry_delay_sell_secs',sa.Integer,    default=0),
        sa.Column('exit_delay_buy_secs',  sa.Integer,    default=0),
        sa.Column('exit_delay_sell_secs', sa.Integer,    default=0),
        sa.Column('exit_on_margin_error', sa.Boolean,    default=True),
        sa.Column('exit_on_entry_failure',sa.Boolean,    default=True),
        sa.Column('base_lot_multiplier',  sa.Integer,    default=1),
        sa.Column('journey_config',       postgresql.JSON, nullable=True),
        sa.Column('is_archived',          sa.Boolean,    default=False),
        sa.Column('created_at',           sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at',           sa.DateTime(timezone=True), nullable=True),
        sa.Column('notes',                sa.Text,       nullable=True),
    )

    # ── algo_legs ─────────────────────────────────────────────────────────────
    op.create_table('algo_legs',
        sa.Column('id',              postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('algo_id',         postgresql.UUID(as_uuid=True), sa.ForeignKey('algos.id'), nullable=False),
        sa.Column('leg_number',      sa.Integer,    nullable=False),
        sa.Column('direction',       sa.String(4),  nullable=False),
        sa.Column('instrument',      sa.String(5),  nullable=False),
        sa.Column('underlying',      sa.String(20), nullable=False),
        sa.Column('expiry',          sa.String(20), nullable=False),
        sa.Column('strike_type',     sa.String(20), nullable=False),
        sa.Column('strike_offset',   sa.Integer,    default=0),
        sa.Column('strike_value',    sa.Float,      nullable=True),
        sa.Column('lots',            sa.Integer,    default=1),
        sa.Column('sl_type',         sa.String(20), nullable=True),
        sa.Column('sl_value',        sa.Float,      nullable=True),
        sa.Column('tp_type',         sa.String(20), nullable=True),
        sa.Column('tp_value',        sa.Float,      nullable=True),
        sa.Column('tsl_x',           sa.Float,      nullable=True),
        sa.Column('tsl_y',           sa.Float,      nullable=True),
        sa.Column('tsl_unit',        sa.String(5),  nullable=True),
        sa.Column('ttp_x',           sa.Float,      nullable=True),
        sa.Column('ttp_y',           sa.Float,      nullable=True),
        sa.Column('ttp_unit',        sa.String(5),  nullable=True),
        sa.Column('wt_enabled',      sa.Boolean,    default=False),
        sa.Column('wt_direction',    sa.String(5),  nullable=True),
        sa.Column('wt_value',        sa.Float,      nullable=True),
        sa.Column('wt_unit',         sa.String(5),  nullable=True),
        sa.Column('reentry_enabled', sa.Boolean,    default=False),
        sa.Column('reentry_mode',    sa.Enum('at_entry_price','immediate','at_cost', name='reentrymode'), nullable=True),
        sa.Column('reentry_max',     sa.Integer,    default=0),
        sa.Column('created_at',      sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ── grid_entries ──────────────────────────────────────────────────────────
    op.create_table('grid_entries',
        sa.Column('id',             postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('algo_id',        postgresql.UUID(as_uuid=True), sa.ForeignKey('algos.id'),    nullable=False),
        sa.Column('account_id',     postgresql.UUID(as_uuid=True), sa.ForeignKey('accounts.id'), nullable=False),
        sa.Column('trading_date',   sa.Date,       nullable=False),
        sa.Column('day_of_week',    sa.String(3),  nullable=False),
        sa.Column('lot_multiplier', sa.Integer,    default=1),
        sa.Column('is_enabled',     sa.Boolean,    default=True),
        sa.Column('is_practix',     sa.Boolean,    default=True),
        sa.Column('is_archived',    sa.Boolean,    default=False),
        sa.Column('status',         sa.Enum('no_trade','algo_active','order_pending','open','algo_closed','error', name='gridstatus'), nullable=True),
        sa.Column('created_at',     sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at',     sa.DateTime(timezone=True), nullable=True),
    )

    # ── algo_states ───────────────────────────────────────────────────────────
    op.create_table('algo_states',
        sa.Column('id',             postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('grid_entry_id',  postgresql.UUID(as_uuid=True), sa.ForeignKey('grid_entries.id'), nullable=False, unique=True),
        sa.Column('algo_id',        postgresql.UUID(as_uuid=True), sa.ForeignKey('algos.id'),        nullable=False),
        sa.Column('account_id',     postgresql.UUID(as_uuid=True), sa.ForeignKey('accounts.id'),     nullable=False),
        sa.Column('trading_date',   sa.String(10), nullable=False),
        sa.Column('status',         sa.Enum('inactive','waiting','active','closed','error','terminated','no_trade', name='algorunstatus'), nullable=False),
        sa.Column('is_practix',     sa.Boolean,    default=True),
        sa.Column('activated_at',   sa.DateTime(timezone=True), nullable=True),
        sa.Column('first_fill_at',  sa.DateTime(timezone=True), nullable=True),
        sa.Column('closed_at',      sa.DateTime(timezone=True), nullable=True),
        sa.Column('mtm_current',    sa.Float,      default=0.0),
        sa.Column('mtm_realised',   sa.Float,      default=0.0),
        sa.Column('reentry_count',  sa.Integer,    default=0),
        sa.Column('journey_level',  sa.String(10), nullable=True),
        sa.Column('error_message',  sa.Text,       nullable=True),
        sa.Column('error_at',       sa.DateTime(timezone=True), nullable=True),
        sa.Column('exit_reason',    sa.String(20), nullable=True),
        sa.Column('created_at',     sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at',     sa.DateTime(timezone=True), nullable=True),
    )

    # ── orders ────────────────────────────────────────────────────────────────
    op.create_table('orders',
        sa.Column('id',                   postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('grid_entry_id',        postgresql.UUID(as_uuid=True), sa.ForeignKey('grid_entries.id'), nullable=False),
        sa.Column('algo_id',              postgresql.UUID(as_uuid=True), sa.ForeignKey('algos.id'),        nullable=False),
        sa.Column('leg_id',               postgresql.UUID(as_uuid=True), sa.ForeignKey('algo_legs.id'),    nullable=False),
        sa.Column('account_id',           postgresql.UUID(as_uuid=True), sa.ForeignKey('accounts.id'),     nullable=False),
        sa.Column('broker_order_id',      sa.String(100), nullable=True),
        sa.Column('is_practix',           sa.Boolean,     default=True),
        sa.Column('is_synced',            sa.Boolean,     default=False),
        sa.Column('is_overnight',         sa.Boolean,     default=False),
        sa.Column('symbol',               sa.String(50),  nullable=False),
        sa.Column('exchange',             sa.String(10),  nullable=False),
        sa.Column('expiry_date',          sa.String(20),  nullable=True),
        sa.Column('direction',            sa.String(4),   nullable=False),
        sa.Column('lots',                 sa.Integer,     nullable=False),
        sa.Column('quantity',             sa.Integer,     nullable=False),
        sa.Column('entry_type',           sa.String(20),  nullable=True),
        sa.Column('entry_reference',      sa.String(100), nullable=True),
        sa.Column('fill_price',           sa.Float,       nullable=True),
        sa.Column('fill_time',            sa.DateTime(timezone=True), nullable=True),
        sa.Column('ltp',                  sa.Float,       nullable=True),
        sa.Column('sl_original',          sa.Float,       nullable=True),
        sa.Column('sl_actual',            sa.Float,       nullable=True),
        sa.Column('tsl_trail_count',      sa.Integer,     default=0),
        sa.Column('target',               sa.Float,       nullable=True),
        sa.Column('exit_price',           sa.Float,       nullable=True),
        sa.Column('exit_price_manual',    sa.Float,       nullable=True),
        sa.Column('exit_time',            sa.DateTime(timezone=True), nullable=True),
        sa.Column('exit_reason',          sa.Enum('sl','tp','tsl','mtm_sl','mtm_tp','global_sl','sq','auto_sq','error','btst_exit','stbt_exit', name='exitreason'), nullable=True),
        sa.Column('pnl',                  sa.Float,       nullable=True),
        sa.Column('status',               sa.Enum('pending','open','closed','error', name='orderstatus'), nullable=True),
        sa.Column('journey_level',        sa.String(10),  nullable=True),
        sa.Column('error_message',        sa.Text,        nullable=True),
        sa.Column('created_at',           sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at',           sa.DateTime(timezone=True), nullable=True),
    )

    # ── trades ────────────────────────────────────────────────────────────────
    op.create_table('trades',
        sa.Column('id',             postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('order_id',       postgresql.UUID(as_uuid=True), sa.ForeignKey('orders.id'),   nullable=False),
        sa.Column('account_id',     postgresql.UUID(as_uuid=True), sa.ForeignKey('accounts.id'), nullable=False),
        sa.Column('algo_id',        postgresql.UUID(as_uuid=True), sa.ForeignKey('algos.id'),    nullable=False),
        sa.Column('trading_date',   sa.String(10), nullable=False),
        sa.Column('financial_year', sa.String(10), nullable=False),
        sa.Column('realised_pnl',   sa.Float,      nullable=False),
        sa.Column('exit_reason',    sa.String(20), nullable=True),
        sa.Column('journey_level',  sa.String(10), nullable=True),
        sa.Column('is_practix',     sa.Boolean,    default=True),
        sa.Column('is_manual_exit', sa.Boolean,    default=False),
        sa.Column('created_at',     sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ── margin_history ────────────────────────────────────────────────────────
    op.create_table('margin_history',
        sa.Column('id',             postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('account_id',     postgresql.UUID(as_uuid=True), sa.ForeignKey('accounts.id'), nullable=False),
        sa.Column('financial_year', sa.String(10), nullable=False),
        sa.Column('margin_amount',  sa.Float,      nullable=False),
        sa.Column('source',         sa.String(10), default='manual'),
        sa.Column('recorded_at',    sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ── seed accounts ─────────────────────────────────────────────────────────
    op.execute("""
        INSERT INTO accounts (id, nickname, broker, client_id, status, is_active)
        VALUES
          (gen_random_uuid(), 'Karthik', 'zerodha',  'ZN6179', 'disconnected', true),
          (gen_random_uuid(), 'Mom',     'angelone', '',       'disconnected', true),
          (gen_random_uuid(), 'Wife',    'angelone', '',       'disconnected', false)
    """)


def downgrade() -> None:
    op.drop_table('margin_history')
    op.drop_table('trades')
    op.drop_table('orders')
    op.drop_table('algo_states')
    op.drop_table('grid_entries')
    op.drop_table('algo_legs')
    op.drop_table('algos')
    op.drop_table('accounts')

    # Drop enums
    for e in ['brokertype','accountstatus','strategymode','entrytype','ordertype',
              'reentrymode','gridstatus','algorunstatus','exitreason','orderstatus']:
        op.execute(f'DROP TYPE IF EXISTS {e}')
