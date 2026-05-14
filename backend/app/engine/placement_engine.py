"""
Placement Engine — extracted from AlgoRunner._place_leg (ARCH-6 Ph4).
Contains the full leg placement logic as a standalone async function.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any, Dict, Optional, Set

import asyncio
import logging
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.models.grid import GridEntry
from app.models.algo import Algo, AlgoLeg, StrategyMode
from app.models.algo_state import AlgoState
from app.models.order import Order, OrderStatus
from app.models.account import Account, BrokerType
from app.engine.sl_tp_monitor import PositionMonitor
from app.engine.tsl_engine import TSLState
from app.engine.ttp_engine import TTPState
from app.engine import event_logger as _ev
from app.engine import order_audit as _audit

IST = ZoneInfo("Asia/Kolkata")
logger = logging.getLogger(__name__)


def _snap_to_005(price: float) -> float:
    """Snap price to nearest 0.05 grid (Angel One options tick)."""
    return round(round(price / 0.05) * 0.05, 2)


@dataclass
class PlacementContext:
    """All AlgoRunner dependencies needed by place_leg."""
    zerodha_broker: Any
    angel_broker_map: Dict[str, Any]
    strike_selector: Any
    ltp_consumer: Any
    rate_limiter: Any
    execution_manager: Any
    order_placer: Any
    wt_arming_cache: Dict[str, Any]
    orb_levels: Dict[str, Any]
    sl_tp_monitor: Any
    tsl_engine: Any
    ttp_engine: Any
    journey_engine: Any
    ul_subscribed_tokens: Set[str]
    make_sl_callback: Any   # callable, closes over runner
    make_tp_callback: Any   # callable, closes over runner
    runner: Any             # AlgoRunner ref for re-entry calls


async def place_leg(
    ctx:            PlacementContext,
    db:             AsyncSession,
    leg:            AlgoLeg,
    algo:           Algo,
    algo_state:     AlgoState,
    grid_entry:     GridEntry,
    reentry:        bool,
    original_order: Optional[Order],
    account:        Optional[Account] = None,
    force_direct:   bool = False,
) -> Optional[Order]:
    """
    Resolve strike, apply W&T/delay, place order, register monitors.
    Returns the created Order or None if deferred to a trigger (W&T / ORB).
    """
    direction = leg.direction  # "buy" or "sell"
    is_overnight = algo.strategy_mode in (StrategyMode.BTST, StrategyMode.STBT)

    # ── Resolve broker for this account ────────────────────────────────────
    # Must be resolved before W&T check so the broker is available for strike selection
    broker_type  = "zerodha"
    account_broker = ctx.zerodha_broker
    if account and account.broker == BrokerType.ANGELONE:
        broker_type    = "angelone"
        account_broker = ctx.angel_broker_map.get(account.client_id)
        if not account_broker:
            logger.error(
                f"[BROKER] No Angel One broker for client_id={account.client_id} "
                f"— aborting entry for {algo.name}"
            )
            asyncio.create_task(_ev.error(
                "engine",
                f"No broker found for account {account.client_id} — {algo.name} aborted",
            ))
            raise RuntimeError(
                f"No broker configured for Angel One account {account.client_id} "
                f"({account.nickname})"
            )

    # ── Execution guard: broker session check ─────────────────────────────
    if account_broker and not account_broker.is_token_set():
        raise ValueError(
            f"Broker not initialized for {broker_type} — token not set "
            f"(account: {account.nickname if account else 'unknown'}). "
            "Complete broker login first."
        )

    # ── Strike selection (always first — needed for both W&T and direct entry) ─
    instrument = None
    _instrument_exchange = "NFO"  # default; overridden below for BFO (SENSEX/BANKEX options)
    if leg.instrument == "fu":
        # Futures — use underlying directly
        symbol           = f"{leg.underlying}FUT"
        instrument_token = getattr(leg, 'instrument_token', 0) or 0
        ltp              = 0.0
    else:
        # Options
        if reentry and original_order:
            # Same strike/expiry as original for re-entries
            symbol           = original_order.symbol
            instrument_token = getattr(original_order, "instrument_token", None) or 0
            ltp              = original_order.fill_price or 0.0
            _instrument_exchange = getattr(original_order, "exchange", None) or "NFO"
        else:
            if ctx.strike_selector:
                _strike_err: Exception | None = None
                for _attempt in range(3):
                    try:
                        instrument = await ctx.strike_selector.select(
                            underlying=leg.underlying,
                            instrument_type=leg.instrument,  # "ce" or "pe"
                            expiry=leg.expiry or "current_weekly",
                            strike_type=leg.strike_type or "atm",
                            strike_value=leg.strike_value,
                            broker=account_broker,
                            dte=getattr(algo, "dte", None),
                        )
                        _strike_err = None
                        break  # success
                    except Exception as _se:
                        _strike_err = _se
                        logger.warning(
                            f"[TOKEN_ERROR] Strike selection attempt {_attempt + 1}/3 "
                            f"failed for {algo.name} leg {leg.leg_number}: {_se}"
                        )
                        if _attempt < 2:
                            await asyncio.sleep(1.5)
                if _strike_err is not None:
                    _msg = f"Strike selection failed after 3 attempts: {_strike_err}"
                    logger.error(_msg)
                    await _ev.error(
                        _msg,
                        algo_name=algo.name,
                        algo_id=str(algo.id),
                        source="engine",
                    )
                    raise ValueError(_msg)
            if not instrument:
                _token_ok = not account_broker or account_broker.is_token_set()
                if not _token_ok:
                    _reason = "broker session invalid (token not set)"
                else:
                    _reason = (
                        f"option chain empty or {leg.strike_type.upper()} strike not found "
                        f"— check [STRIKE] logs above for exact chain size"
                    )
                raise ValueError(
                    f"Strike selection failed for leg {leg.leg_number}: "
                    f"{leg.underlying} {leg.instrument.upper()} {leg.strike_type} — {_reason}"
                )
            symbol           = instrument.get("tradingsymbol", "")
            instrument_token = instrument.get("instrument_token", 0)
            ltp              = instrument.get("last_price", 0.0)
            # Capture exchange for BFO routing (SENSEX/BANKEX options use BFO not NFO)
            _instrument_exchange = instrument.get("exchange", "NFO")
            # Store resolved token on the leg so monitors/W&T callbacks
            # can access leg.instrument_token without AttributeError.
            leg.instrument_token = instrument_token

            # Angel One instrument master has no live prices — fetch LTP for ALL orders
            if ltp == 0.0 and broker_type == "angelone" and account_broker:
                ao_token = instrument.get("token", "") or str(instrument_token)
                ao_exch  = instrument.get("exchange", "NFO")
                if ao_token:
                    try:
                        ltp = await account_broker.get_ltp_by_token(
                            exchange=ao_exch, symbol=symbol, token=ao_token
                        )
                        logger.info(f"[ALGO RUNNER] Angel One live LTP for {symbol}: {ltp}")
                    except Exception as _e:
                        logger.warning(f"[ALGO RUNNER] LTP fetch failed for {symbol}: {_e}")

    # ── W&T: arm on OPTION token, defer until threshold ─────────────────────
    # Strike is already selected above — we monitor the option's own LTP, not the index.
    # force_direct=True (manual RETRY or W&T callback re-entry): skip W&T, place immediately.
    if leg.wt_enabled and leg.wt_value and not reentry and not force_direct:
        # Subscribe token FIRST — must happen before get_ltp() so SmartStream starts
        # delivering ticks. BFO registration must precede subscribe for correct exchange routing.
        if ctx.ltp_consumer and instrument_token:
            if _instrument_exchange == "BFO":
                ctx.ltp_consumer.register_bfo_tokens([int(instrument_token)])
                logger.info(f"[W&T/BFO] Registered BFO token {instrument_token} for {symbol}")
            ctx.ltp_consumer.subscribe([int(instrument_token)])

        # Resolve reference LTP: REST fetch (ltp) → SmartStream cache → first-tick wait
        _wt_option_ltp = ltp
        if ctx.ltp_consumer and instrument_token:
            _live = ctx.ltp_consumer.get_ltp(int(instrument_token))
            if _live and _live > 0:
                _wt_option_ltp = _live

        if (not _wt_option_ltp or _wt_option_ltp <= 0) and ctx.ltp_consumer and instrument_token:
            _first_tick_event = asyncio.Event()
            _first_ltp_holder = [0.0]

            def _on_first_tick(_tltp: float):
                if _tltp > 0:
                    _first_ltp_holder[0] = _tltp
                    _first_tick_event.set()

            ctx.ltp_consumer.register_once(int(instrument_token), _on_first_tick)
            logger.info(f"[W&T] Waiting for first tick on {symbol} (token={instrument_token}) ...")
            try:
                await asyncio.wait_for(_first_tick_event.wait(), timeout=30.0)
                _wt_option_ltp = _first_ltp_holder[0]
                logger.info(f"[W&T] First tick received for {symbol}: LTP={_wt_option_ltp:.2f}")
            except asyncio.TimeoutError:
                logger.error(
                    f"[W&T] No tick received for {symbol} (token={instrument_token}) "
                    f"within 30s — cannot arm W&T for {algo.name}"
                )
                raise ValueError(f"[W&T] Timeout waiting for first tick on {symbol}")

        if not _wt_option_ltp or _wt_option_ltp <= 0:
            logger.error(
                f"[W&T] No LTP for option {symbol} (token={instrument_token}) — "
                f"cannot arm W&T for {algo.name} leg {leg.leg_number}"
            )
            raise ValueError(
                f"[W&T] Option LTP unavailable for {symbol} — cannot arm W&T monitor"
            )

        _wt_dir  = leg.wt_direction or "up"
        _wt_unit = leg.wt_unit or "pts"
        if _wt_unit == "pct":
            _wt_threshold = (
                _wt_option_ltp * (1 + leg.wt_value / 100) if _wt_dir == "up"
                else _wt_option_ltp * (1 - leg.wt_value / 100)
            )
        else:
            _wt_threshold = (
                _wt_option_ltp + leg.wt_value if _wt_dir == "up"
                else _wt_option_ltp - leg.wt_value
            )
        _wt_threshold = _snap_to_005(_wt_threshold)

        # ── W&T execution mode branch ─────────────────────────────────────
        _wt_mode = getattr(leg, 'wt_execution_mode', 'sl_limit')

        if _wt_mode == 'market':
            logger.info(
                f"[WT_MARKET] {algo.name} leg {leg.leg_number}: "
                f"armed in MARKET mode — threshold={_wt_threshold} monitoring via engine"
            )
            # MARKET mode: engine monitors LTP and fires MARKET order at threshold
            # No broker-side SL-Limit placed — WTEvaluator handles trigger
            # TODO: wire WTEvaluator to fire MARKET order (future implementation)
            return  # skip broker SL-Limit placement
        # else: sl_limit mode — existing path continues unchanged

        # W&T: place SL-Limit directly at broker — broker holds and triggers on threshold
        _ge_id_str = str(grid_entry.id)

        # Quantity needed for broker call — calculate inline (mirrors later lot-size logic)
        _wt_lot_size = await ctx.runner._get_lot_size(symbol, _instrument_exchange)
        _wt_quantity = leg.lots * _wt_lot_size * (algo.base_lot_multiplier or 1) * grid_entry.lot_multiplier

        # SEBI algo_tag for broker order tracking
        _wt_account_nick = account.nickname if account else "unknown"
        _wt_algo_safe    = algo.name.replace(" ", "_").replace("/", "_")
        _wt_ts_ms        = int(datetime.now(IST).timestamp() * 1000)
        _wt_algo_tag     = _ge_id_str[:8]

        # Tick-size based buffer — replaces hardcoded 0.05 (B5 fix)
        _wt_tick = 0.05
        if hasattr(account_broker, 'get_tick_size'):
            _wt_tick = account_broker.get_tick_size(str(instrument_token))
        _wt_limit_price = (
            _snap_to_005(_wt_threshold + _wt_tick) if _wt_dir == "up"
            else _snap_to_005(_wt_threshold - _wt_tick)
        )

        logger.warning(
            f"[WT_SNAP] {algo.name} leg {leg.leg_number}: "
            f"ltp={_wt_option_ltp} wt_value={leg.wt_value} wt_unit={_wt_unit} wt_direction={_wt_dir} "
            f"threshold={_wt_threshold} limit_price={_wt_limit_price} tick={_wt_tick}"
        )

        if not account_broker:
            raise ValueError(f"[W&T] No broker available for {algo.name} leg {leg.leg_number}")

        logger.info(
            f"[W&T] Placing SL-Limit at broker: {symbol} "
            f"trigger={_wt_threshold:.2f} limit={_wt_limit_price:.2f} ref={_wt_option_ltp:.2f}"
        )
        # Refresh session before W&T placement — token may have expired since 08:45 login
        if hasattr(account_broker, '_refresh_session'):
            try:
                await account_broker._refresh_session()
                logger.info(f"[WT_SESSION] Session refreshed before W&T placement for {algo.name}")
            except Exception as _se:
                logger.warning(f"[WT_SESSION] Session refresh failed: {_se} — attempting placement anyway")
        # 2-attempt retry: if Angel One returns "No response" (expired
        # session), refresh the session token and try once more.
        _wt_broker_order_id = None
        for _wt_attempt in range(2):
            try:
                _wt_broker_order_id = await account_broker.place_order(
                    symbol=symbol,
                    exchange=_instrument_exchange,
                    direction=leg.direction,
                    quantity=_wt_quantity,
                    order_type="SL",
                    price=_wt_limit_price,
                    trigger_price=_wt_threshold,
                    product="INTRADAY",
                    symbol_token=str(instrument_token),
                    tag=_wt_algo_tag,
                )
                break  # success — exit retry loop
            except RuntimeError as _wt_exc:
                if _wt_attempt == 0 and "No response" in str(_wt_exc):
                    logger.warning(
                        f"[W&T] place_order attempt {_wt_attempt + 1} failed with "
                        f"'No response' — refreshing Angel One session and retrying "
                        f"(algo={algo.name}): {_wt_exc}"
                    )
                    await account_broker._refresh_session()
                else:
                    raise
        logger.info(
            f"[W&T] SL-Limit placed at broker: order_id={_wt_broker_order_id} "
            f"trigger={_wt_threshold:.2f} for {algo.name}"
        )

        # Cache arm details — fill callback uses reference_price for entry_reference
        ctx.wt_arming_cache[_ge_id_str] = {
            "instrument_token": int(instrument_token),
            "symbol":           symbol,
            "exchange":         _instrument_exchange,
            "reference_price":  _wt_option_ltp,
            "threshold":        _wt_threshold,
            "direction":        _wt_dir,
            "wt_value":         leg.wt_value,
            "wt_unit":          _wt_unit,
            "entry_time":       algo.entry_time or "09:16",
            "algo_id":          str(algo.id),
            "entry_reference":  str(_wt_option_ltp),
            "broker_order_id":  _wt_broker_order_id,
        }
        try:
            from app.models.wt_armed_state import WTArmedState
            _wt_state = WTArmedState(
                grid_entry_id = grid_entry.id,
                algo_id       = algo.id,
                account_id    = algo.account_id,
                leg_number    = leg.leg_number,
                symbol        = symbol,
                symbol_token  = str(instrument_token),
                exchange      = _instrument_exchange,
                direction     = _wt_dir,
                ref_price     = _wt_option_ltp,
                threshold     = _wt_threshold,
                limit_price   = _wt_limit_price,
                broker_sl_id  = _wt_broker_order_id,
                status        = 'ARMED',
                armed_at      = datetime.now(IST),
            )
            async with AsyncSessionLocal() as _wt_db:
                _wt_db.add(_wt_state)
                await _wt_db.commit()
            logger.info(f"[W&T] Armed state persisted: {symbol} threshold={_wt_threshold:.2f} broker_sl_id={_wt_broker_order_id}")
        except Exception as _wt_db_err:
            logger.warning(f"[W&T] DB persist failed (non-fatal): {_wt_db_err}")
        return None  # broker holds SL-Limit — fill recorded via order-status callback

    # ── Entry delay ────────────────────────────────────────────────────────
    delay_secs = (
        getattr(algo, "entry_delay_buy_secs", 0) or 0
        if direction == "buy"
        else getattr(algo, "entry_delay_sell_secs", 0) or 0
    )
    if delay_secs > 0:
        logger.info(f"Entry delay: {delay_secs}s for {symbol}")
        await asyncio.sleep(delay_secs)

    # ── Lot size ───────────────────────────────────────────────────────────
    # Prefer master-contract lookup (accurate for current SEBI lot sizes).
    # instrument.get("lot_size") is unreliable for Angel One (chain data has no lotsize field).
    _exch_for_lot = instrument.get("exchange", "NFO") if instrument else "NFO"
    lot_size = await ctx.runner._get_lot_size(symbol, _exch_for_lot)
    quantity = leg.lots * lot_size * (algo.base_lot_multiplier or 1) * grid_entry.lot_multiplier

    # ── Rate limit (SEBI: max 10/s; we cap at 8) ──────────────────────────
    await ctx.rate_limiter.acquire()

    # ── Generate algo_tag (SEBI audit tag) ────────────────────────────────
    account_nickname = account.nickname if account else "unknown"
    algo_name_safe   = algo.name.replace(" ", "_").replace("/", "_")
    ts_ms            = int(datetime.now(IST).timestamp() * 1000)
    algo_tag         = str(grid_entry.id)[:8]

    if not grid_entry.is_practix and not algo_tag:
        logger.error(
            f"[ALGO RUNNER] algo_tag generation failed for "
            f"algo={algo.name} leg={leg.leg_number} — blocking order"
        )
        raise ValueError("algo_tag generation failed")

    # ── Place order via ExecutionManager (single control point) ───────────
    idempotency_key = f"{grid_entry.id}:{leg.id}:{algo_state.reentry_count}"

    # SEBI mandates SL-Limit for all algo orders — compute trigger + limit prices
    _order_type = "SL"  # always SL-Limit regardless of DB value
    _buffer_pct = float(getattr(leg, 'sl_buffer_pct', 2.0)) / 100.0
    _buffer = max(0.50, round(float(ltp) * _buffer_pct, 2))  # per-leg SL buffer % or ₹0.50, whichever larger
    if direction.lower() in ("buy",):
        _trigger_price = float(ltp)
        _limit_price   = float(ltp) + _buffer
    else:
        _trigger_price = float(ltp)
        _limit_price   = float(ltp) - _buffer
    logger.info(
        f"[ALGO RUNNER] SL-Limit order — direction={direction} ltp={ltp:.2f} "
        f"trigger={_trigger_price:.2f} limit={_limit_price:.2f}"
    )

    # ── G3: Write PENDING order before broker call ─────────────────────────
    # Ensures a DB record exists even if the post-broker commit fails.
    fill_price = ltp  # market fill at LTP (set early for the pre-flight record)
    # Guard: if fill_price is 0 (e.g. Angel One instrument master returns no price),
    # fall back to live SmartStream LTP to avoid P&L = 0 display issue.
    if fill_price == 0 and ctx.ltp_consumer and instrument_token:
        _live_ltp = ctx.ltp_consumer.get_ltp(int(instrument_token))
        if _live_ltp and _live_ltp > 0:
            fill_price = _live_ltp
            logger.info(
                f"[FILL_PRICE] fill_price was 0 for {symbol} — using live LTP "
                f"{fill_price:.2f} from SmartStream as fallback"
            )
    journey_level = (
        f"{algo_state.reentry_count + 1}"
        if not reentry
        else f"{algo_state.journey_level or '1'}.{algo_state.reentry_count}"
    )
    # ── W&T entry_reference: option LTP at arm time ────────────────────────
    # entry_reference is VARCHAR(100) — MUST be stored as a string.
    # reports.py converts back to float via float(o.entry_reference).
    _wt_entry_ref: Optional[str] = None
    if leg.wt_enabled and force_direct:
        _ge_id_str_wt = str(grid_entry.id)
        _cached_wt = ctx.wt_arming_cache.get(_ge_id_str_wt)
        if _cached_wt and _cached_wt.get("reference_price"):
            _wt_entry_ref = str(float(_cached_wt["reference_price"]))
        # Clear cache here (not in on_wt_entry) — entry fires 2s after callback,
        # so clearing early caused entry_reference to always be null.
        ctx.wt_arming_cache.pop(_ge_id_str_wt, None)

    order = Order(
        id=uuid.uuid4(),
        algo_id=algo.id,
        grid_entry_id=grid_entry.id,
        leg_id=leg.id,
        account_id=algo.account_id,
        algo_tag=algo_tag,
        symbol=symbol,
        exchange=_instrument_exchange,
        direction=direction,
        lots=leg.lots * grid_entry.lot_multiplier,
        lot_size=lot_size,
        quantity=quantity,
        is_practix=grid_entry.is_practix,
        is_overnight=is_overnight,
        entry_type="wt" if leg.wt_enabled else algo.entry_type,
        entry_reference=_wt_entry_ref,
        status=OrderStatus.PENDING,
        journey_level=journey_level,
        instrument_token=instrument_token,
        sl_type=leg.sl_type,
        sl_original=leg.sl_value,
    )
    # BUG1+BUG2 belt-and-suspenders: ensure sl_type and target are always set
    # even if the constructor's keyword arg is ever changed. sl_type must survive
    # edge-cases where leg.sl_type is evaluated lazily after session expiry.
    order.sl_type = leg.sl_type
    order.sl_original = leg.sl_value
    order.target = leg.tp_value  # may be overwritten below for ORB-based TP
    db.add(order)
    await db.flush()  # persist PENDING record — order.id now set
    asyncio.create_task(_audit.log_transition(
        order_id=order.id, algo_id=algo.id, grid_entry_id=grid_entry.id,
        account_id=algo.account_id, from_status=None, to_status="pending",
        symbol=symbol, direction=direction, is_practix=grid_entry.is_practix,
    ))

    # ── Broker call ─────────────────────────────────────────────────────────
    _placed_at = datetime.now(IST)
    try:
        # B3: Freeze-quantity split using broker instrument master (lot-aware)
        _sym_tok = str(instrument_token)
        _freeze_qty = account_broker.get_freeze_qty(_sym_tok) if (
            account_broker and hasattr(account_broker, 'get_freeze_qty')
        ) else 1800
        _lot_size_from_master = account_broker.get_lot_size(_sym_tok) if (
            account_broker and hasattr(account_broker, 'get_lot_size')
        ) else lot_size or 1
        _lots_per_chunk = max(1, _freeze_qty // _lot_size_from_master)
        _total_lots = quantity // (_lot_size_from_master or 1)

        if _total_lots > _lots_per_chunk:
            _chunks, _rem = [], _total_lots
            while _rem > 0:
                _c = min(_rem, _lots_per_chunk)
                _chunks.append(_c)
                _rem -= _c
            logger.info(
                f"[SPLIT] {algo.name}: {_total_lots} lots → {len(_chunks)} orders "
                f"{_chunks} (freeze={_freeze_qty} lot_size={_lot_size_from_master} "
                f"lots_per_chunk={_lots_per_chunk})"
            )
            _broker_order_ids: list[str] = []
            for _i, _chunk_lots in enumerate(_chunks):
                _chunk_qty = _chunk_lots * _lot_size_from_master
                if _i > 0:
                    await asyncio.sleep(0.2)
                _chunk_idem_key = f"{idempotency_key}:chunk{_i}"
                if ctx.execution_manager:
                    _chunk_result = await ctx.execution_manager.place(
                        db              = db,
                        idempotency_key = _chunk_idem_key,
                        algo_id         = str(algo.id),
                        account_id      = str(algo.account_id),
                        symbol          = symbol,
                        exchange        = _instrument_exchange,
                        direction       = direction,
                        quantity        = _chunk_qty,
                        order_type      = _order_type,
                        ltp             = ltp,
                        limit_price     = _limit_price,
                        trigger_price   = _trigger_price,
                        algo_tag        = algo_tag,
                        is_practix      = grid_entry.is_practix,
                        is_overnight    = is_overnight,
                        broker_type     = broker_type,
                        symbol_token    = str(instrument_token),
                    )
                else:
                    logger.warning("[ALGO RUNNER] ExecutionManager not wired — falling back to OrderPlacer (split chunk)")
                    _chunk_result = await ctx.order_placer.place(
                        idempotency_key = _chunk_idem_key,
                        algo_id         = str(algo.id),
                        symbol          = symbol,
                        exchange        = _instrument_exchange,
                        direction       = direction,
                        quantity        = _chunk_qty,
                        order_type      = _order_type,
                        ltp             = ltp,
                        limit_price     = _limit_price,
                        trigger_price   = _trigger_price,
                        is_practix      = grid_entry.is_practix,
                        is_overnight    = is_overnight,
                        broker_type     = broker_type,
                        symbol_token    = str(instrument_token),
                        algo_tag        = algo_tag,
                        account_id      = str(algo.account_id),
                    )
                if _chunk_result:
                    _broker_order_ids.append(str(_chunk_result))
            order_id_str = _broker_order_ids[0] if _broker_order_ids else None
            if len(_broker_order_ids) > 1:
                logger.info(f"[SPLIT] {algo.name} additional broker_order_ids: {_broker_order_ids[1:]}")
        else:
            if ctx.execution_manager:
                order_id_str = await ctx.execution_manager.place(
                    db              = db,
                    idempotency_key = idempotency_key,
                    algo_id         = str(algo.id),
                    account_id      = str(algo.account_id),
                    symbol          = symbol,
                    exchange        = _instrument_exchange,
                    direction       = direction,
                    quantity        = quantity,
                    order_type      = _order_type,
                    ltp             = ltp,
                    limit_price     = _limit_price,
                    trigger_price   = _trigger_price,
                    algo_tag        = algo_tag,
                    is_practix      = grid_entry.is_practix,
                    is_overnight    = is_overnight,
                    broker_type     = broker_type,
                    symbol_token    = str(instrument_token),
                )
            else:
                # Fallback: direct OrderPlacer (execution_manager not wired)
                logger.warning("[ALGO RUNNER] ExecutionManager not wired — falling back to OrderPlacer")
                order_id_str = await ctx.order_placer.place(
                    idempotency_key = idempotency_key,
                    algo_id         = str(algo.id),
                    symbol          = symbol,
                    exchange        = _instrument_exchange,
                    direction       = direction,
                    quantity        = quantity,
                    order_type      = _order_type,
                    ltp             = ltp,
                    limit_price     = _limit_price,
                    trigger_price   = _trigger_price,
                    is_practix      = grid_entry.is_practix,
                    is_overnight    = is_overnight,
                    broker_type     = broker_type,
                    symbol_token    = str(instrument_token),
                    algo_tag        = algo_tag,
                    account_id      = str(algo.account_id),
                )
    except Exception as _broker_exc:
        # Broker call failed — mark the PENDING record as ERROR (visible in Orders page)
        order.status = OrderStatus.ERROR
        try:
            await db.flush()
        except Exception:
            pass
        raise  # outer handler in _enter_with_db will rollback + log

    _filled_at  = datetime.now(IST)
    _latency_ms = int((_filled_at - _placed_at).total_seconds() * 1000)

    if not order_id_str:
        order.status = OrderStatus.ERROR
        await db.flush()
        logger.warning(f"Order blocked or duplicate: {idempotency_key}")
        return None

    # ── Log exchange order ID ──────────────────────────────────────────────
    if not grid_entry.is_practix:
        logger.info(
            f"[ORDER] Exchange order ID: {order_id_str} | "
            f"{symbol} {direction.upper()} qty={quantity} "
            f"broker={broker_type} tag={algo_tag}"
        )

    # ── PENDING → OPEN: update with broker confirmation ──────────────────
    asyncio.create_task(_audit.log_transition(
        order_id=order.id, algo_id=algo.id, grid_entry_id=grid_entry.id,
        account_id=algo.account_id, from_status="pending", to_status="open",
        symbol=symbol, direction=direction, fill_price=fill_price,
        broker_order_id=order_id_str, is_practix=grid_entry.is_practix,
    ))
    order.status          = OrderStatus.OPEN
    order.fill_price      = fill_price
    order.fill_time       = datetime.now(IST)
    order.ltp             = fill_price
    order.broker_order_id = order_id_str
    order.placed_at       = _placed_at
    order.filled_at       = _filled_at
    order.latency_ms      = _latency_ms

    # ── SL/TP stored on order for display (sl_actual is PRICE, not value) ─
    # ── ORB SL/TP calculation ─────────────────────────────────────────────
    # When entry_type == "orb" and orb_sl_type is set, compute actual SL price
    # from orb range levels rather than using leg.sl_value.
    _effective_sl_type = None
    _effective_tp_type = None
    if getattr(algo, 'entry_type', None) == 'orb':
        _effective_sl_type = getattr(leg, 'orb_sl_type', None) or leg.sl_type
        _effective_tp_type = getattr(leg, 'orb_tp_type', None) or leg.tp_type

    if _effective_sl_type and _effective_sl_type.startswith('orb_'):
        _orb_h, _orb_l = ctx.orb_levels.get(str(grid_entry.id), (0.0, 0.0))
        _orb_range = (_orb_h - _orb_l) if _orb_h and _orb_l else 0.0
        _buf = getattr(leg, 'orb_buffer_value', None) or 0.0
        if _effective_sl_type == 'orb_high':
            order.sl_actual = _orb_h
        elif _effective_sl_type == 'orb_low':
            order.sl_actual = _orb_l
        elif _effective_sl_type == 'orb_range':
            order.sl_actual = (fill_price - _orb_range) if direction == 'buy' else (fill_price + _orb_range)
        elif _effective_sl_type == 'orb_range_plus_pts':
            order.sl_actual = (fill_price - (_orb_range + _buf)) if direction == 'buy' else (fill_price + (_orb_range + _buf))
        elif _effective_sl_type == 'orb_range_minus_pts':
            order.sl_actual = (fill_price - (_orb_range - _buf)) if direction == 'buy' else (fill_price + (_orb_range - _buf))
        else:
            order.sl_actual = _orb_h if direction == 'sell' else _orb_l
    elif leg.sl_value and fill_price:
        if leg.sl_type == "pts_instrument":
            order.sl_actual = (fill_price - leg.sl_value) if direction == "buy" else (fill_price + leg.sl_value)
        elif leg.sl_type == "pct_instrument":
            order.sl_actual = fill_price * (1 - leg.sl_value / 100) if direction == "buy" else fill_price * (1 + leg.sl_value / 100)
        else:
            order.sl_actual = leg.sl_value  # orb/underlying types: store raw value, monitor computes dynamically
    else:
        order.sl_actual = leg.sl_value

    # ── ORB TP calculation ─────────────────────────────────────────────────
    if _effective_tp_type and _effective_tp_type.startswith('orb_'):
        _orb_h, _orb_l = ctx.orb_levels.get(str(grid_entry.id), (0.0, 0.0))
        _orb_range = (_orb_h - _orb_l) if _orb_h and _orb_l else 0.0
        _buf = getattr(leg, 'orb_buffer_value', None) or 0.0
        if _effective_tp_type == 'orb_high':
            order.target = _orb_h
        elif _effective_tp_type == 'orb_low':
            order.target = _orb_l
        elif _effective_tp_type == 'orb_range':
            order.target = (fill_price + _orb_range) if direction == 'buy' else (fill_price - _orb_range)
        elif _effective_tp_type == 'orb_range_plus_pts':
            order.target = (fill_price + (_orb_range + _buf)) if direction == 'buy' else (fill_price - (_orb_range + _buf))
        elif _effective_tp_type == 'orb_range_minus_pts':
            order.target = (fill_price + (_orb_range - _buf)) if direction == 'buy' else (fill_price - (_orb_range - _buf))
        else:
            order.target = leg.tp_value
    else:
        order.target = leg.tp_value

    # ── Subscribe LTP ──────────────────────────────────────────────────────
    if ctx.ltp_consumer and instrument_token:
        # Register BFO tokens before subscribing so SmartStream uses exchangeType=4 (BFO)
        # instead of the default exchangeType=2 (NFO). Without this, SENSEX/BANKEX option
        # ticks are never delivered and LTP stays stuck at fill price (P&L = 0).
        if _instrument_exchange == "BFO":
            ctx.ltp_consumer.register_bfo_tokens([instrument_token])
            logger.info(f"[BFO] Registered BFO token {instrument_token} for {symbol}")
        ctx.ltp_consumer.subscribe([instrument_token])

    # ── Register SL/TP monitor ─────────────────────────────────────────────
    if ctx.sl_tp_monitor and (leg.sl_type or leg.tp_type):
        underlying_token = getattr(leg, "underlying_token", 0) or 0
        orb_high, orb_low = ctx.orb_levels.get(str(grid_entry.id), (0.0, 0.0))
        # For underlying-based SL/TP types, the reference price must be the
        # underlying spot LTP at entry, not the option fill price.
        _needs_ul_ref = leg.sl_type in ("pts_underlying", "pct_underlying") or \
                        leg.tp_type in ("pts_underlying", "pct_underlying")
        underlying_entry_price = 0.0
        if _needs_ul_ref and underlying_token and ctx.ltp_consumer:
            underlying_entry_price = ctx.ltp_consumer.get_ltp(underlying_token) or 0.0
        pos_monitor = PositionMonitor(
            order_id=str(order.id),
            grid_entry_id=str(grid_entry.id),
            algo_id=str(algo.id),
            direction=direction,
            instrument_token=instrument_token,
            underlying_token=underlying_token,
            entry_price=fill_price,
            underlying_entry_price=underlying_entry_price,
            quantity=quantity,   # lot_size × lots × multiplier — for ₹ MTM PNL
            sl_type=leg.sl_type,
            sl_value=leg.sl_value,
            tp_type=leg.tp_type,
            tp_value=leg.tp_value,
            orb_high=orb_high,
            orb_low=orb_low,
            symbol=symbol,
        )
        ctx.sl_tp_monitor.add_position(
            pos_monitor,
            on_sl=ctx.make_sl_callback(),
            on_tp=ctx.make_tp_callback(),
        )

        # Post-registration immediate check — catches fast moves during W&T gap
        if ctx.sl_tp_monitor and ctx.ltp_consumer:
            await ctx.sl_tp_monitor.check_now(str(order.id), ctx.ltp_consumer)

        # ── Subscribe underlying token for pts_underlying / pct_underlying ─
        # When SL or TP is based on the underlying index move, we must receive
        # ticks for the underlying token and forward them to SLTPMonitor.
        _needs_ul = leg.sl_type in ("pts_underlying", "pct_underlying") or \
                    leg.tp_type in ("pts_underlying", "pct_underlying")
        if _needs_ul and underlying_token and ctx.ltp_consumer:
            ctx.ltp_consumer.subscribe([underlying_token])
            # Only register one callback per unique underlying token —
            # multiple legs on the same underlying share the same subscription.
            if underlying_token not in ctx.ul_subscribed_tokens:
                ctx.ul_subscribed_tokens.add(underlying_token)
                _ul_monitor = ctx.sl_tp_monitor   # capture for closure
                _ul_token   = underlying_token

                async def _underlying_tick_cb(token: int, ltp: float, tick: dict,
                                              _monitor=_ul_monitor, _tok=_ul_token):
                    if token == _tok:
                        _monitor.update_underlying_ltp(_tok, ltp)

                ctx.ltp_consumer.register_callback(_underlying_tick_cb)
                logger.info(
                    f"[P0-3] Underlying LTP callback registered: "
                    f"underlying_token={underlying_token}"
                )
            logger.info(
                f"[P0-3] Underlying LTP wired: order={order.id} "
                f"underlying_token={underlying_token} sl_type={leg.sl_type} tp_type={leg.tp_type}"
            )

    # ── Register TSL ───────────────────────────────────────────────────────
    # tsl_enabled is now a real DB column — no more getattr fallback
    if ctx.tsl_engine and leg.tsl_enabled and leg.tsl_x and leg.tsl_y:
        tsl_state = TSLState(
            order_id=str(order.id),
            direction=direction,
            entry_price=fill_price,
            current_sl=order.sl_actual or (fill_price * 0.9),
            tsl_x=leg.tsl_x,
            tsl_y=leg.tsl_y,
            tsl_unit=leg.tsl_unit or "pts",
        )
        ctx.tsl_engine.register(tsl_state)
        # Record activation price so position rebuilder and UI can show it
        order.tsl_activation_price = fill_price
        order.tsl_current_sl       = order.sl_actual or (fill_price * 0.9)

    # ── Register TTP ───────────────────────────────────────────────────────
    # ttp_enabled is now a real DB column; fallback keeps backward compat with
    # algos saved before this migration that have ttp_x/y set but no flag.
    ttp_enabled = leg.ttp_enabled or (leg.ttp_x and leg.ttp_y and leg.tp_value)
    if ctx.ttp_engine and ttp_enabled and leg.ttp_x and leg.ttp_y:
        # TTP requires TP to be set — initial current_tp from PositionMonitor
        initial_tp = order.target or fill_price * 1.1
        ttp_state = TTPState(
            order_id=str(order.id),
            direction=direction,
            entry_price=fill_price,
            current_tp=initial_tp,
            ttp_x=leg.ttp_x,
            ttp_y=leg.ttp_y,
            ttp_unit=leg.ttp_unit or "pts",
            algo_name=algo.name or "",
            symbol=symbol,
        )
        ctx.ttp_engine.register(ttp_state)
        # Record activation price so position rebuilder and UI can show it
        order.ttp_activation_price = fill_price
        order.ttp_current_tp       = initial_tp

    # ── Register Journey ────────────────────────────────────────────────────
    journey_cfg = getattr(leg, "journey_config", None)
    if ctx.journey_engine and journey_cfg:
        journey_trigger = getattr(leg, "journey_trigger", None) or 'either'
        ctx.journey_engine.register(str(order.id), journey_cfg, depth=1, journey_trigger=journey_trigger)
        # Persist to DB for restart recovery
        from app.engine.journey_engine import _persist_journey_state
        asyncio.create_task(_persist_journey_state(
            parent_grid_entry_id=str(grid_entry.id),
            child_grid_entry_id=str(grid_entry.id),
            parent_leg_id=str(order.id),
            child_leg_id=None,
            trigger_on=journey_trigger,
        ))

    return order
