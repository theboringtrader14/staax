"""
Exit engine — SL/TP/time-based exit processing extracted from algo_runner (ARCH-6 Phase 2).

All functions accept `runner` (an AlgoRunner instance) as their first parameter.
This avoids circular imports: exit_engine never imports from app.engine.algo_runner —
the live instance is injected at call-time by the thin delegation stubs in algo_runner.py.
"""
import asyncio
import logging
import uuid
from datetime import datetime
from typing import Optional, List
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, update

from app.core.database import AsyncSessionLocal
from app.models.grid import GridEntry, GridStatus
from app.models.algo import Algo
from app.models.algo_state import AlgoState, AlgoRunStatus
from app.models.order import Order, OrderStatus
from app.models.account import Account, BrokerType
from app.engine import event_logger as _ev
from app.engine import push_sender as _push
from app.engine.event_bus import event_bus as _event_bus, Events as _Events
import app.engine.wa_notifier as _wa_mod
import app.engine.tg_notifier as _tg_mod

IST = ZoneInfo("Asia/Kolkata")
logger = logging.getLogger(__name__)


# ── Notify helpers (mirrors the module-level helpers in algo_runner) ──────────

async def _wa_notify(event: str, payload: dict) -> None:
    try:
        await _wa_mod.wa_notifier.notify(event, payload)
    except Exception:
        pass


async def _tg_notify(event: str, payload: dict) -> None:
    try:
        await _tg_mod.tg_notifier.notify(event, payload)
    except Exception:
        pass


# ── MSLC: move remaining legs' SL to fill price after an SL hit ──────────────

async def handle_mslc_after_sl_hit(grid_entry_id: str, sl_monitor) -> None:
    """
    Move SL to cost (fill_price) for all remaining OPEN legs in the same grid entry.
    Extracted from module-level _handle_mslc_after_sl_hit in algo_runner (ARCH-6 Phase 2).
    """
    try:
        async with AsyncSessionLocal() as db:
            ge_result = await db.execute(
                select(GridEntry).where(GridEntry.id == uuid.UUID(grid_entry_id))
            )
            ge = ge_result.scalar_one_or_none()
            if not ge or ge.mslc_triggered:
                return

            algo_result = await db.execute(
                select(Algo).where(Algo.id == ge.algo_id)
            )
            algo = algo_result.scalar_one_or_none()
            if not algo or not getattr(algo, 'mslc_enabled', False):
                return

            orders_result = await db.execute(
                select(Order).where(
                    and_(
                        Order.grid_entry_id == ge.id,
                        Order.status == OrderStatus.OPEN,
                    )
                )
            )
            open_orders = orders_result.scalars().all()
            for o in open_orders:
                if o.fill_price and o.fill_price > 0 and sl_monitor:
                    sl_monitor.update_sl(str(o.id), o.fill_price)
                    # Persist sl_actual so a restart doesn't revert to original SL
                    await db.execute(
                        update(Order)
                        .where(Order.id == o.id)
                        .values(sl_actual=o.fill_price)
                    )

            ge.mslc_triggered = True
            await db.commit()
    except Exception as _e:
        logger.warning(f"[MSLC] failed for grid_entry {grid_entry_id}: {_e}")


# ── F9: Cancel broker SL orders ───────────────────────────────────────────────

async def cancel_broker_sl(runner, order: Order) -> None:
    """
    F9 — Cancel any pending SL orders at the broker for this position.
    Routes to the correct broker based on the order's broker_order_id context.
    Extracted from AlgoRunner._cancel_broker_sl (ARCH-6 Phase 2).
    """
    try:
        broker_sl_order_id = getattr(order, "broker_sl_order_id", None)
        if not broker_sl_order_id or not runner._order_placer:
            return

        # Determine which broker placed this order by loading account
        async with AsyncSessionLocal() as db:
            acc_res = await db.execute(
                select(Account).where(Account.id == order.account_id)
            ) if getattr(order, "account_id", None) else None
            account = acc_res.scalar_one_or_none() if acc_res else None

        # W&T orders are placed as STOPLOSS variety — Angel One requires the same
        # variety on cancel. Sending NORMAL for a STOPLOSS order returns an error
        # and leaves a dangling SL-Limit at the broker.
        _cancel_variety = "STOPLOSS" if getattr(order, "entry_type", "") == "wt" else "NORMAL"

        if account and account.broker == BrokerType.ANGELONE:
            ao_broker = runner._angel_broker_map.get(account.client_id)
            if ao_broker:
                await ao_broker.cancel_order(broker_sl_order_id, variety=_cancel_variety)
                logger.info(f"✅ F9: Angel One SL order cancelled: {broker_sl_order_id} (variety={_cancel_variety})")
        else:
            await runner._order_placer.zerodha.cancel_order(broker_sl_order_id)
            logger.info(f"✅ F9: Zerodha SL order cancelled: {broker_sl_order_id}")
    except Exception as e:
        logger.warning(f"F9: SL cancel failed for {order.id}: {e}")
        # Non-fatal — position is already being closed


# ── Core exit function ────────────────────────────────────────────────────────

async def exit_all(
    runner,
    grid_entry_id: str,
    reason:        str = "auto_sq",
    cancel_broker_sl_flag: bool = True,
) -> None:
    """
    Close all open orders for a grid entry.
    Called by:
      - scheduler._job_auto_sq   (intraday exit time)
      - on_mtm_breach            (MTM SL/TP hit)
      - API terminate endpoint   (T button)
      - overnight_sl_check       (next-day SL)
    Extracted from AlgoRunner.exit_all (ARCH-6 Phase 2).
    """
    async with AsyncSessionLocal() as db:
        try:
            await exit_all_with_db(runner, db, grid_entry_id, reason, cancel_broker_sl_flag)
        except Exception as e:
            try:
                await db.rollback()
            except Exception:
                pass
            logger.error(f"[ENGINE] exit_all DB error, rolled back for {grid_entry_id}: {e}")


async def exit_all_with_db(
    runner,
    db: AsyncSession,
    grid_entry_id: str,
    reason: str,
    cancel_broker_sl_flag: bool,
) -> None:
    """
    Inner DB-session-scoped exit logic.
    Extracted from AlgoRunner._exit_all_with_db (ARCH-6 Phase 2).
    """
    from app.engine.lifecycle_manager import close_order, log_decision

    # Load all OPEN orders for this entry
    result = await db.execute(
        select(Order).where(
            and_(
                Order.grid_entry_id == grid_entry_id,
                Order.status == OrderStatus.OPEN,
            )
        )
    )
    orders: List[Order] = result.scalars().all()

    if not orders:
        logger.info(f"exit_all: no open orders for {grid_entry_id}")
    else:
        logger.info(f"exit_all: closing {len(orders)} orders | reason={reason}")

    # Load algo for delay config
    state_result = await db.execute(
        select(AlgoState, GridEntry, Algo)
        .join(GridEntry, AlgoState.grid_entry_id == GridEntry.id)
        .join(Algo,      GridEntry.algo_id == Algo.id)
        .where(AlgoState.grid_entry_id == grid_entry_id)
    )
    row = state_result.one_or_none()
    algo_state, grid_entry, algo = row if row else (None, None, None)

    exit_delay_buy_secs  = getattr(algo, "exit_delay_buy_secs",  0) or 0
    exit_delay_sell_secs = getattr(algo, "exit_delay_sell_secs", 0) or 0

    # Load account for exit broker routing
    exit_account = None
    if algo and algo.account_id:
        acc_res = await db.execute(
            select(Account).where(Account.id == algo.account_id)
        )
        exit_account = acc_res.scalar_one_or_none()

    exit_broker_type = "zerodha"
    if exit_account and exit_account.broker == BrokerType.ANGELONE:
        exit_broker_type = "angelone"

    for order in orders:
        try:
            # Get current LTP — prefer fresh SmartStream tick, fall back to REST
            ltp = order.ltp or order.fill_price or 0.0
            ao_broker = None
            if exit_broker_type == "angelone" and exit_account:
                ao_broker = runner._angel_broker_map.get(exit_account.client_id)

            if exit_broker_type == "angelone" and exit_account:
                token = getattr(order, "instrument_token", None)
                if ao_broker and token:
                    # PRACTIX: always fetch live LTP for meaningful exit price
                    # LIVE: fetch REST if SmartStream was down (ltp == 0)
                    if order.is_practix or ltp == 0:
                        try:
                            rest_ltp = await ao_broker.get_ltp_by_token(
                                exchange=order.exchange or "NFO",
                                symbol=order.symbol,
                                token=str(token),
                            )
                            if rest_ltp and rest_ltp > 0:
                                # Sanity guard: REST ltpData("BFO",...) sometimes returns
                                # the SENSEX index price (~80000) instead of the option
                                # premium (<2000).  If rest_ltp is more than 50× the
                                # fill_price we almost certainly got the index LTP —
                                # discard it and keep the fallback fill_price-based value.
                                _fill_for_guard = float(order.fill_price or 0)
                                if _fill_for_guard > 0 and rest_ltp > _fill_for_guard * 50:
                                    logger.error(
                                        f"[CORRUPT LTP GUARD] {order.symbol}: REST ltpData "
                                        f"returned {rest_ltp} which is "
                                        f"{rest_ltp/_fill_for_guard:.0f}× fill={_fill_for_guard} "
                                        f"— looks like index price contamination (BFO/exchangeType). "
                                        f"Discarding REST LTP; using fill_price as exit fallback."
                                    )
                                else:
                                    label = "PRACTIX" if order.is_practix else "LIVE (WS stale)"
                                    logger.info(f"[{label} EXIT] REST LTP for {order.symbol}: {rest_ltp}")
                                    ltp = rest_ltp
                        except Exception as _e:
                            logger.warning(f"[EXIT] LTP REST fetch failed for {order.symbol}: {_e}")

            # Apply exit delay (direction-scoped)
            exit_delay_secs = exit_delay_buy_secs if order.direction == "buy" else exit_delay_sell_secs
            if exit_delay_secs > 0:
                logger.info(f"Exit delay: {exit_delay_secs}s for {order.symbol}")
                await asyncio.sleep(exit_delay_secs)

            # Place closing order via ExecutionManager (single control point)
            if runner._execution_manager:
                await runner._execution_manager.square_off(
                    db              = db,
                    idempotency_key = f"exit:{order.id}:{reason}",
                    algo_id         = str(order.algo_id),
                    account_id      = str(order.account_id),
                    symbol          = order.symbol,
                    exchange        = order.exchange or "NFO",
                    direction       = order.direction,
                    quantity        = order.quantity,
                    algo_tag        = order.algo_tag or "",
                    is_practix      = order.is_practix,
                    broker_type     = exit_broker_type,
                    symbol_token    = str(getattr(order, "instrument_token", None) or ""),
                )
            else:
                # Fallback: direct OrderPlacer (execution_manager not wired)
                logger.warning("[ALGO RUNNER] ExecutionManager not wired — falling back to OrderPlacer for exit")
                close_dir = "sell" if order.direction == "buy" else "buy"
                await runner._order_placer.place(
                    idempotency_key = f"exit:{order.id}:{reason}",
                    algo_id         = str(order.algo_id),
                    symbol          = order.symbol,
                    exchange        = order.exchange or "NFO",
                    direction       = close_dir,
                    quantity        = order.quantity,
                    order_type      = "market",
                    ltp             = ltp,
                    is_practix      = order.is_practix,
                    is_overnight    = False,
                    broker_type     = exit_broker_type,
                    symbol_token    = str(getattr(order, "instrument_token", None) or ""),
                    account_id      = str(order.account_id),
                    algo_tag        = order.algo_tag or "",
                )

            # ── For LIVE exits: fetch actual fill from broker orderbook ──────
            # Wait up to 5s for Angel One to update the fill (2s + 1 retry after 3s).
            if not order.is_practix and exit_broker_type == "angelone" and ao_broker:
                _broker_oid = getattr(order, "broker_order_id", None)
                if _broker_oid:
                    _actual_fill: Optional[float] = None
                    for _wait in (2, 3):
                        await asyncio.sleep(_wait)
                        try:
                            _ob = await ao_broker.get_order_book()
                            for _ob_row in (_ob or []):
                                if str(_ob_row.get("orderid", "")) == str(_broker_oid):
                                    _avg = float(_ob_row.get("averageprice", 0) or 0)
                                    if _avg > 0:
                                        _actual_fill = _avg
                                        break
                        except Exception as _ob_err:
                            logger.warning(f"[LIVE EXIT] Orderbook fetch failed: {_ob_err}")
                        if _actual_fill:
                            break
                    if _actual_fill and _actual_fill != ltp:
                        logger.info(
                            f"[LIVE EXIT] Corrected exit_price from broker fill: "
                            f"{order.symbol} {ltp:.2f} → {_actual_fill:.2f}"
                        )
                        ltp = _actual_fill

            # F9 — cancel broker SL orders
            if cancel_broker_sl_flag and not order.is_practix and runner._order_placer:
                await cancel_broker_sl(runner, order)

            await close_order(db, order, ltp, reason)
            if reason in ("terminate", "sq"):
                await log_decision(db, order, "MANUAL_SQ",
                    "Manual square-off triggered by user", ltp=ltp)

            # ── System Log: per-order exit event ──────────────────────────
            try:
                _sym  = order.symbol or ""
                _algo_name = getattr(algo, "name", "") or ""
                _raw_pnl = order.pnl  # may be None when fill_price was missing
                if _raw_pnl is None:
                    _pnl_str = "unknown (fill_price missing)"
                else:
                    _pnl = float(_raw_pnl)
                    _sign = "+" if _pnl >= 0 else ""
                    _pnl_str = f"{_sign}₹{_pnl:,.2f}"
                if reason in ("sl", "overnight_sl"):
                    await _ev.error(
                        f"{_algo_name} · {_sym} SL HIT @ {ltp:.2f} | P&L {_pnl_str}",
                        algo_name=_algo_name, source="engine",
                    )
                elif reason == "tp":
                    await _ev.success(
                        f"{_algo_name} · {_sym} TP HIT @ {ltp:.2f} | P&L {_pnl_str}",
                        algo_name=_algo_name, source="engine",
                    )
                elif reason == "tsl":
                    await _ev.info(
                        f"{_algo_name} · {_sym} TSL EXIT @ {ltp:.2f} | P&L {_pnl_str}",
                        algo_name=_algo_name, source="engine",
                    )
                elif reason in ("auto_sq", "all_legs_closed", "btst_exit", "stbt_exit"):
                    _exit_label = "BTST EXIT" if reason == "btst_exit" else ("STBT EXIT" if reason == "stbt_exit" else "EXIT TIME")
                    await _ev.info(
                        f"{_algo_name} · {_sym} {_exit_label} @ {ltp:.2f} | P&L {_pnl_str}",
                        algo_name=_algo_name, source="engine",
                    )
                elif reason in ("terminate", "sq"):
                    await _ev.info(
                        f"{_algo_name} · {_sym} MANUAL SQ @ {ltp:.2f} | P&L {_pnl_str}",
                        algo_name=_algo_name, source="engine",
                    )
                elif reason in ("global_sl",):
                    await _ev.error(
                        f"{_algo_name} · {_sym} GLOBAL SL EXIT @ {ltp:.2f} | P&L {_pnl_str}",
                        algo_name=_algo_name, source="engine",
                    )
            except Exception as _log_err:
                logger.warning(f"[ev] exit log failed: {_log_err}")

        except Exception as e:
            logger.error(f"Error closing order {order.id}: {e}")

    # Deregister monitors
    if runner._sl_tp_monitor:
        for order in orders:
            runner._sl_tp_monitor.remove_position(str(order.id))
    if runner._tsl_engine:
        for order in orders:
            runner._tsl_engine.deregister(str(order.id))
    if runner._ttp_engine:
        for order in orders:
            runner._ttp_engine.deregister(str(order.id))
    if runner._journey_engine:
        for order in orders:
            runner._journey_engine.deregister(str(order.id))
    if runner._mtm_monitor and algo:
        runner._mtm_monitor._algos.pop(str(algo.id), None)
    if runner._reentry_engine:
        runner._reentry_engine.clear_watchers(grid_entry_id)

    # Update AlgoState
    if algo_state:
        algo_state.status       = AlgoRunStatus.TERMINATED if reason == "terminate" else AlgoRunStatus.CLOSED
        algo_state.exit_reason  = reason
        algo_state.closed_at    = datetime.now(IST)
    if grid_entry:
        grid_entry.status = GridStatus.ALGO_CLOSED

    await db.commit()

    # Notify Telegram + WhatsApp on exit
    if algo and orders:
        try:
            _total_pnl = sum(o.pnl or 0 for o in orders)
            _algo_name = getattr(algo, "name", "Unknown")
            if reason == "overnight_sl":
                pass  # skip Telegram/WA — expected overnight exit, not actionable
            else:
                asyncio.create_task(_wa_notify("exit_executed", {
                    "algo_name":   _algo_name,
                    "exit_reason": reason,
                    "pnl":         _total_pnl,
                    "legs_count":  len(orders),
                }))
                asyncio.create_task(_tg_notify("exit_executed", {
                    "algo_name":   _algo_name,
                    "exit_reason": reason,
                    "pnl":         _total_pnl,
                    "legs_count":  len(orders),
                }))
        except Exception as _n_err:
            logger.warning(f"[EXIT] Notify failed: {_n_err}")

    logger.info(f"exit_all complete: {grid_entry_id} | reason={reason}")


# ── SL hit inner handler ──────────────────────────────────────────────────────

async def on_sl_hit_inner(runner, order_id: str, ltp: float, reason: str) -> None:
    """
    Inner SL-hit handler — DB work, close order, notify.
    Called from the on_sl_hit closure in AlgoRunner._make_sl_callback.
    Extracted from AlgoRunner._make_sl_callback._on_sl_hit_inner (ARCH-6 Phase 2).
    """
    from app.engine.lifecycle_manager import close_order, log_decision, check_algo_complete

    async with AsyncSessionLocal() as db:
        try:
            result = await db.execute(
                select(Order).where(Order.id == order_id)
            )
            order = result.scalar_one_or_none()
            if not order:
                return

            # Resolve algo name — Order has no algo_name column, load from Algo
            _algo_name_res = await db.execute(select(Algo.name).where(Algo.id == order.algo_id))
            _algo_name = _algo_name_res.scalar_one_or_none() or ""
            _acct_res = await db.execute(select(Account.nickname).where(Account.id == order.account_id))
            _acct_name = _acct_res.scalar_one_or_none() or str(order.account_id)

            tsl_trailed = (
                runner._tsl_engine.has_trailed(order_id)
                if runner._tsl_engine else False
            )

            # Bug B+A: Place broker square-off with SL-LIMIT order type
            _broker_sq_id: Optional[str] = None
            if not order.is_practix and runner._execution_manager:
                _exit_broker_type = getattr(order, "broker_type", None) or "zerodha"
                try:
                    _broker_sq_id = await runner._execution_manager.square_off(
                        db              = db,
                        idempotency_key = f"exit:{order.id}:sl",
                        algo_id         = str(order.algo_id),
                        account_id      = str(order.account_id),
                        symbol          = order.symbol,
                        exchange        = order.exchange or "NFO",
                        direction       = order.direction,
                        quantity        = order.quantity,
                        algo_tag        = order.algo_tag or "",
                        is_practix      = order.is_practix,
                        broker_type     = _exit_broker_type,
                        symbol_token    = str(getattr(order, "instrument_token", None) or ""),
                        reason          = "sl_hit",
                        sl_price        = order.sl_actual,
                    )
                except Exception as _sq_err:
                    logger.error(f"[SL] square_off failed for {order_id} (continuing DB close): {_sq_err}")

            # Bug C: fetch actual fill price from broker order book
            exit_price = ltp
            if not order.is_practix and _broker_sq_id:
                _exit_broker_type = getattr(order, "broker_type", None) or "zerodha"
                if _exit_broker_type == "angelone":
                    # Load account to find the AO broker instance
                    try:
                        _acc_res = await db.execute(
                            select(Account).where(Account.id == order.account_id)
                        )
                        _acc = _acc_res.scalar_one_or_none()
                        _ao = runner._angel_broker_map.get(_acc.client_id) if _acc else None
                        if _ao:
                            _actual_fill: Optional[float] = None
                            for _wait in (2, 3):
                                await asyncio.sleep(_wait)
                                try:
                                    _ob = await _ao.get_order_book()
                                    for _ob_row in (_ob or []):
                                        if str(_ob_row.get("orderid", "")) == str(_broker_sq_id):
                                            _avg = float(_ob_row.get("averageprice", 0) or 0)
                                            if _avg > 0:
                                                _actual_fill = _avg
                                                break
                                except Exception as _ob_err:
                                    logger.warning(f"[SL FILL] Orderbook fetch failed: {_ob_err}")
                                if _actual_fill:
                                    break
                            if _actual_fill:
                                logger.info(
                                    f"[SL FILL] Corrected exit_price from broker fill: "
                                    f"{order.symbol} {ltp:.2f} → {_actual_fill:.2f}"
                                )
                                exit_price = _actual_fill
                    except Exception as _fill_err:
                        logger.warning(f"[SL FILL] Fill fetch error for {order.symbol}: {_fill_err}")

            await close_order(db, order, exit_price, "sl")
            await log_decision(db, order, "SL_TRIGGERED",
                f"LTP {exit_price} crossed SL {order.sl_actual}",
                trigger_value=exit_price, threshold_value=order.sl_actual, ltp=exit_price)

            # Deregister
            if runner._tsl_engine:
                runner._tsl_engine.deregister(order_id)
            if runner._ttp_engine:
                runner._ttp_engine.deregister(order_id)

            # Journey: fire child leg before commit
            if runner._journey_engine and order:
                _child_fired = await runner._journey_engine.on_exit(db, order, "sl", runner)
                if _child_fired:
                    await _ev.info(
                        f"{_algo_name} — child leg fired after sl on {order.symbol}",
                        algo_name=_algo_name, source="engine",
                    )

            await db.commit()

            # Notify WebSocket — event_logger broadcast (notifications panel)
            _pnl = order.pnl or 0.0
            _sign = "+" if _pnl >= 0 else ""
            await _ev.error(
                f"{_algo_name} · SL {order.symbol} @ {exit_price} · P&L {_sign}₹{_pnl:,.0f}",
                algo_name=_algo_name, source="engine",
            )
            asyncio.create_task(_push.send_push(
                "🔴 SL Hit",
                f"{_algo_name or 'Algo'} — SL triggered on {order.symbol}",
            ))
            asyncio.create_task(_wa_notify("sl_hit", {
                "algo_name":  _algo_name,
                "account":    _acct_name,
                "exit_price": exit_price,
                "pnl":        order.pnl or 0.0,
            }))
            asyncio.create_task(_tg_notify("sl_hit", {
                "algo_name":  _algo_name,
                "account":    _acct_name,
                "exit_price": exit_price,
                "pnl":        order.pnl or 0.0,
            }))
            # Bug B: broadcast sl_hit event for frontend toast + sound
            if runner._ws_manager:
                try:
                    await runner._ws_manager.broadcast_sl_hit(
                        symbol   = order.symbol,
                        sl_price = order.sl_actual or exit_price,
                        ltp      = exit_price,
                        order_id = str(order.id),
                    )
                except Exception as _ws_err:
                    logger.warning(f"[SL] ws broadcast_sl_hit failed: {_ws_err}")
            # ARCH-16: publish SL_HIT to internal event bus
            asyncio.create_task(_event_bus.publish(_Events.SL_HIT, {
                'algo_name': _algo_name,
                'symbol':    order.symbol,
                'price':     exit_price,
                'pnl':       order.pnl or 0.0,
            }))

            # Re-entry check
            if runner._reentry_engine:
                await runner._reentry_engine.on_exit(
                    db, order, "sl", tsl_trailed=tsl_trailed
                )

            # MSLC: move remaining open legs' SL to their fill price
            asyncio.create_task(
                handle_mslc_after_sl_hit(str(order.grid_entry_id), runner._sl_tp_monitor)
            )

            # Check if this was the last open leg
            await check_algo_complete(str(order.grid_entry_id), mtm_monitor=runner._mtm_monitor)

        except Exception as e:
            await db.rollback()
            logger.error(f"on_sl_hit failed for {order_id}: {e}")


# ── TP hit handler ────────────────────────────────────────────────────────────

async def on_tp_hit_inner(runner, order_id: str, ltp: float, reason: str) -> None:
    """
    TP-hit handler — DB work, close order, notify.
    Called from the on_tp_hit closure in AlgoRunner._make_tp_callback.
    Extracted from AlgoRunner._make_tp_callback.on_tp_hit (ARCH-6 Phase 2).
    """
    from app.engine.lifecycle_manager import close_order, log_decision, check_algo_complete

    async with AsyncSessionLocal() as db:
        try:
            result = await db.execute(
                select(Order).where(Order.id == order_id)
            )
            order = result.scalar_one_or_none()
            if not order:
                return

            # Resolve algo name — Order has no algo_name column, load from Algo
            _algo_name_res = await db.execute(select(Algo.name).where(Algo.id == order.algo_id))
            _algo_name = _algo_name_res.scalar_one_or_none() or ""

            await close_order(db, order, ltp, "tp")
            await log_decision(db, order, "TARGET_TRIGGERED",
                f"LTP {ltp} reached target {order.target}",
                trigger_value=ltp, threshold_value=order.target, ltp=ltp)

            # Capture TSL trail state BEFORE deregister clears in-memory state
            tsl_trailed = (
                runner._tsl_engine.has_trailed(order_id)
                if runner._tsl_engine else False
            )

            if runner._tsl_engine:
                runner._tsl_engine.deregister(order_id)
            if runner._ttp_engine:
                runner._ttp_engine.deregister(order_id)

            # Journey: fire child leg before commit
            if runner._journey_engine and order:
                _child_fired = await runner._journey_engine.on_exit(db, order, "tp", runner)
                if _child_fired:
                    await _ev.info(
                        f"{_algo_name} — child leg fired after tp on {order.symbol}",
                        algo_name=_algo_name, source="engine",
                    )

            await db.commit()

            _pnl_tp = order.pnl or 0.0
            await _ev.success(
                f"{_algo_name} · TP {order.symbol} @ {ltp} · P&L +₹{_pnl_tp:,.0f}",
                algo_name=_algo_name, source="engine",
            )
            asyncio.create_task(_push.send_push(
                "✅ TP Hit",
                f"{_algo_name or 'Algo'} — Target reached on {order.symbol}!",
            ))
            asyncio.create_task(_wa_notify("tp_hit", {
                "algo_name":  _algo_name,
                "account":    str(order.account_id),
                "exit_price": ltp,
                "pnl":        order.pnl or 0.0,
            }))
            asyncio.create_task(_tg_notify("tp_hit", {
                "algo_name":  _algo_name,
                "account":    str(order.account_id),
                "exit_price": ltp,
                "pnl":        order.pnl or 0.0,
            }))

            if runner._reentry_engine:
                await runner._reentry_engine.on_exit(
                    db, order, "tp", tsl_trailed=tsl_trailed
                )

            await check_algo_complete(str(order.grid_entry_id), mtm_monitor=runner._mtm_monitor)

        except Exception as e:
            await db.rollback()
            logger.error(f"on_tp_hit failed for {order_id}: {e}")
