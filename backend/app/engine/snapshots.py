"""
Plain Python snapshots of SQLAlchemy ORM objects.
These are created INSIDE a session while it is open, then passed to background
tasks/schedulers safely — no lazy loading, no greenlet dependency.

FIELD NAMES match the actual STAAX models as of 2026-04-21:
  - Algo        → app/models/algo.py
  - AlgoLeg     → app/models/algo.py
  - GridEntry   → app/models/grid.py
  - Account     → app/models/account.py
  - Order       → app/models/order.py
"""
from dataclasses import dataclass, field
from typing import Optional
from datetime import date, time, datetime


@dataclass
class LegSnapshot:
    id: str
    leg_number: int
    direction: str          # "buy" | "sell"
    instrument: str         # "ce" | "pe" | "fu"
    underlying: str         # "NIFTY", "BANKNIFTY", etc.
    expiry: Optional[str]
    strike_type: Optional[str]
    strike_offset: int
    strike_value: Optional[float]
    lots: int
    # lot_size is NOT on AlgoLeg model — resolved at order time via _get_lot_size()
    sl_type: Optional[str]
    sl_value: Optional[float]
    tp_type: Optional[str]
    tp_value: Optional[float]
    tsl_enabled: bool
    tsl_x: Optional[float]
    tsl_y: Optional[float]
    tsl_unit: Optional[str]
    ttp_enabled: bool
    ttp_x: Optional[float]
    ttp_y: Optional[float]
    ttp_unit: Optional[str]
    wt_enabled: bool
    wt_value: Optional[float]
    wt_unit: Optional[str]
    wt_direction: Optional[str]
    orb_range_source: Optional[str]
    orb_entry_at: Optional[str]
    orb_sl_type: Optional[str]
    orb_tp_type: Optional[str]
    orb_buffer_value: Optional[float]
    orb_buffer_unit: Optional[str]
    reentry_on_sl: bool
    reentry_on_tp: bool
    reentry_max: int
    reentry_max_sl: int
    reentry_max_tp: int
    reentry_type: Optional[str]
    reentry_ltp_mode: Optional[str]
    journey_config: Optional[dict]
    journey_trigger: Optional[str]
    instrument_token: Optional[int]
    underlying_token: Optional[int]
    entry_type: str         # inherited from Algo at snapshot time (for convenience)


@dataclass
class AlgoSnapshot:
    id: str
    name: str
    account_id: str
    strategy_mode: str      # "intraday" | "btst" | "stbt" | "positional"
    entry_type: str         # "direct" | "orb"
    order_type: str         # "market" | "limit"
    is_active: bool
    is_live: bool
    entry_time: Optional[str]       # "HH:MM:SS" string (stored as String(8) in DB)
    exit_time: Optional[str]
    orb_start_time: Optional[str]
    orb_end_time: Optional[str]
    next_day_exit_time: Optional[str]
    dte: Optional[int]
    mtm_sl: Optional[float]
    mtm_tp: Optional[float]
    mtm_unit: str           # "amt" | "pct"
    entry_delay_buy_secs: int
    entry_delay_sell_secs: int
    exit_delay_buy_secs: int
    exit_delay_sell_secs: int
    exit_on_margin_error: bool
    exit_on_entry_failure: bool
    base_lot_multiplier: int
    journey_config: Optional[dict]
    legs: list = field(default_factory=list)    # list[LegSnapshot]


@dataclass
class GridEntrySnapshot:
    id: str
    algo_id: str
    account_id: str
    trading_date: date
    day_of_week: str
    lot_multiplier: int
    is_enabled: bool
    is_practix: bool
    is_archived: bool
    status: str
    algo: Optional[AlgoSnapshot] = None


@dataclass
class AccountSnapshot:
    id: str
    nickname: str
    broker: str             # "zerodha" | "angelone"
    client_id: str
    api_key: Optional[str]
    api_secret: Optional[str]
    access_token: Optional[str]
    feed_token: Optional[str]
    totp_secret: Optional[str]
    is_active: bool
    status: str
    scope: Optional[str]


@dataclass
class OrderSnapshot:
    id: str
    grid_entry_id: str
    algo_id: str
    leg_id: str
    account_id: str
    broker_order_id: Optional[str]
    algo_tag: Optional[str]
    is_practix: bool
    is_overnight: bool
    symbol: str
    exchange: str
    direction: str          # "buy" | "sell"
    lots: int
    lot_size: Optional[int]
    quantity: int
    entry_type: Optional[str]
    fill_price: Optional[float]
    ltp: Optional[float]
    sl_original: Optional[float]
    sl_actual: Optional[float]
    target: Optional[float]
    exit_price: Optional[float]
    status: str
    trading_date: Optional[date]
    instrument_token: Optional[int]
    journey_level: Optional[str]


# ── Conversion helpers ────────────────────────────────────────────────────────
# Call these INSIDE an open SQLAlchemy async session.
# Never call them after the session context manager has exited.

def snapshot_leg(leg, algo_entry_type: str = "direct") -> LegSnapshot:
    """Convert AlgoLeg ORM to LegSnapshot. MUST be called inside an open session."""
    return LegSnapshot(
        id=str(leg.id),
        leg_number=leg.leg_number,
        direction=leg.direction,
        instrument=leg.instrument,
        underlying=leg.underlying,
        expiry=leg.expiry,
        strike_type=leg.strike_type,
        strike_offset=int(leg.strike_offset or 0),
        strike_value=float(leg.strike_value) if leg.strike_value is not None else None,
        lots=int(leg.lots or 1),
        sl_type=leg.sl_type,
        sl_value=float(leg.sl_value) if leg.sl_value is not None else None,
        tp_type=leg.tp_type,
        tp_value=float(leg.tp_value) if leg.tp_value is not None else None,
        tsl_enabled=bool(leg.tsl_enabled),
        tsl_x=float(leg.tsl_x) if leg.tsl_x is not None else None,
        tsl_y=float(leg.tsl_y) if leg.tsl_y is not None else None,
        tsl_unit=leg.tsl_unit,
        ttp_enabled=bool(leg.ttp_enabled),
        ttp_x=float(leg.ttp_x) if leg.ttp_x is not None else None,
        ttp_y=float(leg.ttp_y) if leg.ttp_y is not None else None,
        ttp_unit=leg.ttp_unit,
        wt_enabled=bool(leg.wt_enabled),
        wt_value=float(leg.wt_value) if leg.wt_value is not None else None,
        wt_unit=leg.wt_unit,
        wt_direction=leg.wt_direction,
        orb_range_source=getattr(leg, 'orb_range_source', None),
        orb_entry_at=getattr(leg, 'orb_entry_at', None),
        orb_sl_type=getattr(leg, 'orb_sl_type', None),
        orb_tp_type=getattr(leg, 'orb_tp_type', None),
        orb_buffer_value=float(leg.orb_buffer_value) if getattr(leg, 'orb_buffer_value', None) is not None else None,
        orb_buffer_unit=getattr(leg, 'orb_buffer_unit', None),
        reentry_on_sl=bool(leg.reentry_on_sl),
        reentry_on_tp=bool(getattr(leg, 'reentry_on_tp', False)),
        reentry_max=int(leg.reentry_max or 0),
        reentry_max_sl=int(getattr(leg, 'reentry_max_sl', 0) or 0),
        reentry_max_tp=int(getattr(leg, 'reentry_max_tp', 0) or 0),
        reentry_type=getattr(leg, 'reentry_type', None),
        reentry_ltp_mode=getattr(leg, 'reentry_ltp_mode', None),
        journey_config=getattr(leg, 'journey_config', None),
        journey_trigger=getattr(leg, 'journey_trigger', 'either'),
        instrument_token=int(leg.instrument_token) if getattr(leg, 'instrument_token', None) is not None else None,
        underlying_token=int(leg.underlying_token) if getattr(leg, 'underlying_token', None) is not None else None,
        entry_type=algo_entry_type,
    )


def snapshot_algo(algo, legs=None) -> AlgoSnapshot:
    """
    Convert Algo ORM to AlgoSnapshot. MUST be called inside an open session.
    Pass pre-loaded legs list if available to avoid a second query.
    """
    legs_raw = legs or []
    entry_type = str(algo.entry_type.value if hasattr(algo.entry_type, 'value') else algo.entry_type or 'direct')
    return AlgoSnapshot(
        id=str(algo.id),
        name=algo.name,
        account_id=str(algo.account_id),
        strategy_mode=str(algo.strategy_mode.value if hasattr(algo.strategy_mode, 'value') else algo.strategy_mode or 'intraday'),
        entry_type=entry_type,
        order_type=str(algo.order_type.value if hasattr(algo.order_type, 'value') else algo.order_type or 'market'),
        is_active=bool(algo.is_active),
        is_live=bool(algo.is_live),
        entry_time=algo.entry_time,
        exit_time=algo.exit_time,
        orb_start_time=algo.orb_start_time,
        orb_end_time=algo.orb_end_time,
        next_day_exit_time=algo.next_day_exit_time,
        dte=int(algo.dte) if algo.dte is not None else None,
        mtm_sl=float(algo.mtm_sl) if algo.mtm_sl is not None else None,
        mtm_tp=float(algo.mtm_tp) if algo.mtm_tp is not None else None,
        mtm_unit=str(algo.mtm_unit or 'amt'),
        entry_delay_buy_secs=int(algo.entry_delay_buy_secs or 0),
        entry_delay_sell_secs=int(algo.entry_delay_sell_secs or 0),
        exit_delay_buy_secs=int(algo.exit_delay_buy_secs or 0),
        exit_delay_sell_secs=int(algo.exit_delay_sell_secs or 0),
        exit_on_margin_error=bool(algo.exit_on_margin_error),
        exit_on_entry_failure=bool(algo.exit_on_entry_failure),
        base_lot_multiplier=int(algo.base_lot_multiplier or 1),
        journey_config=getattr(algo, 'journey_config', None),
        legs=[snapshot_leg(leg, algo_entry_type=entry_type) for leg in legs_raw],
    )


def snapshot_grid_entry(ge, algo_snapshot: "AlgoSnapshot | None" = None) -> GridEntrySnapshot:
    """
    Convert GridEntry ORM to GridEntrySnapshot. MUST be called inside an open session.
    Pass a pre-built AlgoSnapshot if available to avoid redundant attribute access.
    """
    return GridEntrySnapshot(
        id=str(ge.id),
        algo_id=str(ge.algo_id),
        account_id=str(ge.account_id),
        trading_date=ge.trading_date,
        day_of_week=ge.day_of_week or '',
        lot_multiplier=int(ge.lot_multiplier or 1),
        is_enabled=bool(ge.is_enabled),
        is_practix=bool(ge.is_practix),
        is_archived=bool(ge.is_archived),
        status=str(ge.status.value if hasattr(ge.status, 'value') else ge.status or 'no_trade'),
        algo=algo_snapshot,
    )


def snapshot_account(account) -> AccountSnapshot:
    """Convert Account ORM to AccountSnapshot. MUST be called inside an open session."""
    return AccountSnapshot(
        id=str(account.id),
        nickname=account.nickname or '',
        broker=str(account.broker.value if hasattr(account.broker, 'value') else account.broker or 'angelone'),
        client_id=account.client_id or '',
        api_key=account.api_key,
        api_secret=account.api_secret,
        access_token=account.access_token,
        feed_token=account.feed_token,
        totp_secret=account.totp_secret,
        is_active=bool(account.is_active),
        status=str(account.status.value if hasattr(account.status, 'value') else account.status or 'disconnected'),
        scope=account.scope,
    )


def snapshot_order(order) -> OrderSnapshot:
    """Convert Order ORM to OrderSnapshot. MUST be called inside an open session."""
    return OrderSnapshot(
        id=str(order.id),
        grid_entry_id=str(order.grid_entry_id),
        algo_id=str(order.algo_id),
        leg_id=str(order.leg_id) if order.leg_id else '',
        account_id=str(order.account_id),
        broker_order_id=order.broker_order_id,
        algo_tag=order.algo_tag,
        is_practix=bool(order.is_practix),
        is_overnight=bool(order.is_overnight),
        symbol=order.symbol or '',
        exchange=order.exchange or 'NFO',
        direction=order.direction or 'buy',
        lots=int(order.lots or 0),
        lot_size=int(order.lot_size) if order.lot_size is not None else None,
        quantity=int(order.quantity or 0),
        entry_type=order.entry_type,
        fill_price=float(order.fill_price) if order.fill_price is not None else None,
        ltp=float(order.ltp) if order.ltp is not None else None,
        sl_original=float(order.sl_original) if order.sl_original is not None else None,
        sl_actual=float(order.sl_actual) if order.sl_actual is not None else None,
        target=float(order.target) if order.target is not None else None,
        exit_price=float(order.exit_price) if order.exit_price is not None else None,
        status=str(order.status.value if hasattr(order.status, 'value') else order.status or 'open'),
        trading_date=getattr(order, 'trading_date', None),
        instrument_token=int(order.instrument_token) if getattr(order, 'instrument_token', None) is not None else None,
        journey_level=order.journey_level,
    )
