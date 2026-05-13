"""
Entry engine — algo entry coordination extracted from algo_runner (ARCH-6 Phase 3).

All functions accept `runner` (an AlgoRunner instance) as their first parameter.
This avoids circular imports: entry_engine never imports from app.engine.algo_runner —
the live instance is injected at call-time by the thin delegation stubs in algo_runner.py.
"""
import asyncio
import logging
from datetime import datetime
from typing import Optional, List
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models.grid import GridEntry, GridStatus
from app.models.algo import Algo, AlgoLeg
from app.models.algo_state import AlgoState, AlgoRunStatus
from app.models.order import Order
from app.models.account import Account, BrokerType
from app.engine import event_logger as _ev
from app.engine import push_sender as _push
from app.engine.mtm_monitor import AlgoMTMState
from app.engine.execution_errors import ExecutionErrorCode
import app.engine.wa_notifier as _wa_mod
import app.engine.tg_notifier as _tg_mod

IST = ZoneInfo("Asia/Kolkata")
logger = logging.getLogger(__name__)


# Explicit margin-error keywords (mirrors algo_runner.MARGIN_ERROR_KEYWORDS).
MARGIN_ERROR_KEYWORDS = [
    "insufficient margin",
    "insufficient funds",
    "insufficient account balance",
    "insufficient balance",
    "margin shortfall",
    "rms margin",
    "margin blocked",
    "not enough margin",
]


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


# ── Entry coordinator functions ───────────────────────────────────────────────

async def enter(
    runner,
    grid_entry_id:   str,
    reentry:         bool = False,
    original_order:  Optional[Order] = None,
    force_direct:    bool = False,
    force_immediate: bool = False,
):
    """
    Main entry point — executes all legs for a grid entry.
    Called by:
      - Scheduler._job_entry  (Direct algos)
      - on_orb_entry callback (ORB algos)
      - on_wt_entry callback  (W&T algos)
      - ReentryEngine._trigger_reentry (re-entries)
      - Manual RETRY endpoint (force_direct=not has_wt_legs, force_immediate=True)

    force_direct=True:   Skip W&T deferral — place immediately at current LTP.
    force_immediate=True: Fire enter_with_db now even if entry_time is in the future.
                          If False and entry_time is still ahead, schedule for that time.
    """
    from zoneinfo import ZoneInfo as _ZI
    IST_ZONE = _ZI("Asia/Kolkata")

    # ── Entry-time gate (only for non-immediate, non-reentry calls) ─────────
    if not force_immediate and not reentry:
        # Capture all ORM attributes INSIDE the session — accessing them after
        # the context exits may trigger await_only() on a detached object → MissingGreenlet.
        _gate_entry_time = None
        _gate_algo_name  = grid_entry_id
        async with AsyncSessionLocal() as _db:
            _res = await _db.execute(
                select(AlgoState, GridEntry, Algo)
                .join(GridEntry, AlgoState.grid_entry_id == GridEntry.id)
                .join(Algo, GridEntry.algo_id == Algo.id)
                .where(AlgoState.grid_entry_id == grid_entry_id)
            )
            _row = _res.one_or_none()
            if _row:
                _, _, _algo = _row
                _gate_entry_time = getattr(_algo, "entry_time", None)
                _gate_algo_name  = getattr(_algo, "name", grid_entry_id)
        if _gate_entry_time:
            _et = _gate_entry_time
            _h, _m = map(int, str(_et).split(":")[:2])
            _now = datetime.now(IST_ZONE).time()
            _entry_t = datetime.now(IST_ZONE).replace(
                hour=_h, minute=_m, second=0, microsecond=0
            ).time()
            if _now < _entry_t:
                logger.info(
                    f"[enter] {_gate_algo_name} entry_time {_et} "
                    f"still ahead ({_now} < {_entry_t}) — scheduling job instead of firing now"
                )
                from app.engine.scheduler import get_scheduler as _get_sched_gate
                _sched_gate = _get_sched_gate()
                if _sched_gate:
                    _sched_gate.schedule_immediate_entry(
                        grid_entry_id,
                        force_direct=force_direct,
                        force_immediate=True,
                    )
                else:
                    logger.error(
                        f"[enter] Scheduler not available — cannot reschedule {grid_entry_id} safely"
                    )
                return

    async with AsyncSessionLocal() as db:
        try:
            await enter_with_db(runner, db, grid_entry_id, reentry, original_order, force_direct=force_direct, force_immediate=force_immediate)
        except Exception as e:
            import traceback
            logger.error(
                f"[CRITICAL] AlgoRunner.enter failed for {grid_entry_id}: "
                f"{type(e).__name__}: {e}\n{traceback.format_exc()}"
            )
            try:
                await db.rollback()
            except Exception:
                pass
            await runner._mark_error(grid_entry_id, f"{type(e).__name__}: {str(e)[:200]}")


async def enter_with_db_wrap(runner, grid_entry_id: str, force_direct: bool = False):
    """Thin wrapper used when scheduling an enter from a threadsafe context."""
    async with AsyncSessionLocal() as db:
        try:
            await enter_with_db(runner, db, grid_entry_id, False, None, force_direct=force_direct)
        except Exception as e:
            logger.error(f"[enter_wrap] {grid_entry_id}: {e}", exc_info=True)
            try:
                await db.rollback()
            except Exception:
                pass
            await runner._mark_error(grid_entry_id, f"{type(e).__name__}: {str(e)[:200]}")


async def enter_with_db(
    runner,
    db: AsyncSession,
    grid_entry_id: str,
    reentry: bool,
    original_order: Optional[Order],
    force_direct: bool = False,
    force_immediate: bool = False,
):
    # Outer safety net: catch any unexpected exception (e.g. MissingGreenlet from
    # a detached ORM object) that occurs outside the per-leg try/except blocks.
    # Logs the FULL traceback to the frontend System Log so the exact line is visible,
    # marks the algo ERROR, and never crashes the server.
    try:
        await _enter_with_db_inner(
            runner, db, grid_entry_id, reentry, original_order, force_direct, force_immediate
        )
    except Exception as _outer_exc:
        import traceback as _tb
        _full_tb = _tb.format_exc()
        logger.error(
            f"[ENGINE] _enter_with_db unhandled exception for {grid_entry_id}: "
            f"{type(_outer_exc).__name__}: {_outer_exc}\n{_full_tb}"
        )
        # Write full traceback to event log so it surfaces in frontend System Log
        try:
            _outer_algo_name = grid_entry_id  # fallback if lookup fails
            try:
                async with AsyncSessionLocal() as _name_db:
                    _name_res = await _name_db.execute(
                        select(Algo)
                        .join(GridEntry, GridEntry.algo_id == Algo.id)
                        .where(GridEntry.id == grid_entry_id)
                    )
                    _name_algo = _name_res.scalar_one_or_none()
                    if _name_algo and _name_algo.name:
                        _outer_algo_name = _name_algo.name
            except Exception:
                pass
            await _ev.error(
                f"{_outer_algo_name} · {type(_outer_exc).__name__}: {str(_outer_exc)[:300]}\n"
                f"(Full traceback in server log)",
                source="engine",
            )
        except Exception:
            pass
        # Mark algo ERROR so it's visible in the UI
        try:
            await runner._mark_error(
                grid_entry_id,
                f"{type(_outer_exc).__name__}: {str(_outer_exc)[:200]}",
            )
        except Exception:
            pass
        raise  # re-raise so enter()'s handler also logs [CRITICAL] with full tb


async def _enter_with_db_inner(
    runner,
    db: AsyncSession,
    grid_entry_id: str,
    reentry: bool,
    original_order: Optional[Order],
    force_direct: bool = False,
    force_immediate: bool = False,
):
    # ── 1. Load state ──────────────────────────────────────────────────────
    result = await db.execute(
        select(AlgoState, GridEntry, Algo)
        .join(GridEntry, AlgoState.grid_entry_id == GridEntry.id)
        .join(Algo,      GridEntry.algo_id == Algo.id)
        .where(AlgoState.grid_entry_id == grid_entry_id)
    )
    row = result.one_or_none()
    if not row:
        logger.error(f"No AlgoState for grid_entry_id={grid_entry_id}")
        if force_immediate:
            await _ev.error(
                f"RETRY failed: no state found for {grid_entry_id[:8]}",
                source="engine",
            )
        return

    algo_state, grid_entry, algo = row

    # ── 1b. Load account for broker routing ───────────────────────────────
    account = None
    if algo.account_id:
        acc_result = await db.execute(
            select(Account).where(Account.id == algo.account_id)
        )
        account = acc_result.scalar_one_or_none()

    # ── 2. Guard: only enter in WAITING (or ACTIVE for re-entry) ──────────
    allowed = {AlgoRunStatus.WAITING}
    if reentry:
        allowed.add(AlgoRunStatus.ACTIVE)

    if algo_state.status not in allowed:
        logger.info(
            f"Skipping entry for {algo.name} — status={algo_state.status} "
            f"(reentry={reentry})"
        )
        if force_immediate:
            await _ev.error(
                f"RETRY failed: {algo.name} is in state {algo_state.status} — expected WAITING",
                algo_name=algo.name,
                source="engine",
            )
        return

    logger.info(
        f"{'↻ Re-entry' if reentry else '▶ Entry'}: {algo.name} "
        f"[{grid_entry_id}] practix={grid_entry.is_practix}"
    )

    # ── 2b. P2: Circuit Breaker — block live entries when feed is offline >5min ──
    if not grid_entry.is_practix:
        from app.engine.broker_reconnect import circuit_breaker as _cb
        if not _cb.entries_allowed:
            logger.warning(
                f"[CIRCUIT BREAKER] Entry BLOCKED for {algo.name}: {_cb._disabled_reason}"
            )
            await _ev.warn(
                f"Entry blocked by circuit breaker — {_cb._disabled_reason}",
                algo_name=algo.name,
                source="circuit_breaker",
            )
            return   # Leave algo in WAITING so it can retry when feed restores

    # ── 3. Load legs ───────────────────────────────────────────────────────
    legs_result = await db.execute(
        select(AlgoLeg)
        .where(AlgoLeg.algo_id == algo.id)
        .order_by(AlgoLeg.leg_number)
    )
    legs: List[AlgoLeg] = legs_result.scalars().all()

    if not legs:
        logger.error(f"No legs for algo {algo.name} ({algo.id})")
        await runner._set_no_trade(db, algo_state, grid_entry, "no_legs", algo_name=algo.name)
        return

    # ── 3b. Pre-execution validation ───────────────────────────────────────
    for leg in legs:
        ok, reason, is_waiting = await pre_execution_check(runner, algo, grid_entry, leg, force_direct=force_direct)
        if not ok:
            log_level = "warning" if is_waiting else "error"
            getattr(logger, log_level)(
                f"[{'WAITING' if is_waiting else 'BLOCKED'}] {algo.name} — {reason}"
            )
            # Write pre_check_failed to execution audit log
            if runner._execution_manager:
                await runner._execution_manager._log(
                    db            = db,
                    action        = "PLACE",
                    status        = "WAITING" if is_waiting else "BLOCKED",
                    algo_id       = str(algo.id),
                    account_id    = str(algo.account_id) if algo.account_id else "",
                    grid_entry_id = str(grid_entry.id),
                    reason        = reason,
                    event_type    = "pre_check_waiting" if is_waiting else "pre_check_failed",
                    is_practix    = grid_entry.is_practix,
                    details       = {"leg": leg.leg_number, "check": reason},
                )
            if is_waiting:
                await runner._set_waiting(db, algo_state, grid_entry, reason)
            else:
                await runner._set_error(db, algo_state, grid_entry, reason, algo_name=algo.name)
            return

    # ── 4. Transition AlgoState to ACTIVE ─────────────────────────────────
    algo_state.status       = AlgoRunStatus.ACTIVE
    algo_state.activated_at = datetime.now(IST)
    grid_entry.status       = GridStatus.ORDER_PENDING

    # ── 5. Set up MTM monitor for this algo ────────────────────────────────
    if runner._mtm_monitor:
        combined_premium = 0.0  # filled after orders placed
        mtm_state = AlgoMTMState(
            algo_id=str(algo.id),
            account_id=str(algo.account_id),
            mtm_sl=algo.mtm_sl,
            mtm_tp=algo.mtm_tp,
            mtm_unit=algo.mtm_unit or "amt",
        )
        runner._mtm_monitor.register_algo(
            mtm_state,
            on_breach=runner._make_mtm_callback(grid_entry_id),
        )

    # ── 6. Place orders for each leg ───────────────────────────────────────
    placed_orders: List[Order] = []
    # G2: cache plain Python values before per-leg commits expire ORM objects.
    # Keys are str(order.id); values are tuples of (ltp, fill_price, direction, symbol).
    _order_cache: dict = {}
    entry_error = False

    # G3: Snapshot plain-Python values from ORM objects HERE, before any
    # per-leg try/except.  After db.rollback() inside the except block SQLAlchemy
    # marks every ORM object "expired"; a subsequent attribute access (e.g. algo.id)
    # tries to lazy-load → MissingGreenlet because no greenlet bridge exists outside
    # the original await context.  Using these cached scalars avoids all lazy loads.
    _algo_id_str                 = str(algo.id)
    _algo_name_str               = str(algo.name or "")
    _algo_account_str            = str(algo.account_id) if algo.account_id else ""
    _algo_exit_on_entry_failure  = bool(getattr(algo, "exit_on_entry_failure", False))
    _algo_exit_on_margin_error   = bool(getattr(algo, "exit_on_margin_error", True))
    _ge_id_str                   = str(grid_entry.id)
    _ge_is_practix               = bool(grid_entry.is_practix)
    # Pre-cache broker type for auto-flatten calls (account ORM object expires after rollback)
    _algo_broker_type            = (
        "angelone"
        if account and getattr(account, "broker", None) == BrokerType.ANGELONE
        else "zerodha"
    )

    for leg in legs:
        # Capture plain Python values from ORM object before any try/except so that
        # accessing them in the except block (after a rollback expires ORM objects)
        # never triggers a lazy-load → MissingGreenlet.
        leg_number = leg.leg_number
        logger.info(
            f"[ENTER] Leg {leg_number}/{len(legs)} — "
            f"{leg.underlying} {leg.instrument} {leg.direction} "
            f"expiry={leg.expiry} strike={leg.strike_type} lots={leg.lots}"
        )
        try:
            order = await runner._place_leg(
                db, leg, algo, algo_state, grid_entry, reentry, original_order,
                account=account, force_direct=force_direct,
            )
            if order:
                # G2: cache attributes before commit expires them
                _oid = order.id
                _order_cache[str(_oid)] = (
                    order.ltp or 0.0,
                    order.fill_price or 0.0,
                    order.direction or "",
                    order.symbol or "",
                )
                placed_orders.append(order)
                logger.info(
                    f"[ENTER] Leg {leg_number} placed: "
                    f"symbol={_order_cache[str(_oid)][3]} fill={_order_cache[str(_oid)][1]} token={order.instrument_token}"
                )
                # G2: per-leg commit — each Order is durably persisted independently
                # of subsequent legs. A later leg failure rolls back only its own
                # uncommitted work; earlier legs' OPEN records survive.
                await db.commit()
                await db.refresh(algo_state)
                await db.refresh(grid_entry)
            else:
                logger.info(f"[ENTER] Leg {leg_number} deferred (W&T / ORB)")
        except Exception as e:
            # Reset session — a DB flush failure leaves it in PendingRollback state;
            # without this, every subsequent db operation raises PendingRollbackError.
            try:
                await db.rollback()
                # Re-attach expired objects after rollback so the loop can continue
                await db.refresh(algo_state)
                await db.refresh(grid_entry)
            except Exception:
                pass
            logger.error(
                f"[ENTER] Leg {leg_number} failed: {e}",
                exc_info=True,
            )
            entry_error = True

            if runner._execution_manager:
                await runner._execution_manager._log(
                    db            = db,
                    action        = "PLACE",
                    status        = "FAILED",
                    algo_id       = _algo_id_str,
                    account_id    = _algo_account_str,
                    grid_entry_id = _ge_id_str,
                    reason        = str(e),
                    event_type    = "entry_failed",
                    is_practix    = _ge_is_practix,
                    details       = {"leg": leg_number, "error": str(e)},
                )

            # Write to event_log so leg failure surfaces in System Log / notification bell
            # Use pre-captured plain-Python strings — algo/grid_entry ORM objects are
            # expired after db.rollback() and accessing their attributes would trigger
            # a lazy load → MissingGreenlet.
            await _ev.error(
                f"{_algo_name_str} · Leg {leg_number} failed: {str(e)[:200]}",
                algo_name=_algo_name_str,
                algo_id=_algo_id_str,
                source="engine",
            )

            # Margin-error branch — checked before exit_on_entry_failure
            _err_lower = str(e).lower()
            _is_margin = any(kw in _err_lower for kw in MARGIN_ERROR_KEYWORDS)
            if _is_margin:
                if _algo_exit_on_margin_error:
                    logger.warning(
                        f"[MARGIN_ERROR] {_algo_name_str} — margin error on leg {leg_number}, "
                        f"exiting all positions (exit_on_margin_error=True)"
                    )
                    await _ev.error(
                        f"{_algo_name_str} — margin error on leg {leg_number}, exiting all positions",
                        algo_name=_algo_name_str, algo_id=_algo_id_str, source="engine",
                    )
                    for placed in placed_orders:
                        _cached_ltp = _order_cache.get(str(placed.id), (0.0,))[0]
                        _p = await db.get(Order, placed.id)
                        if _p:
                            try:
                                if runner._execution_manager:
                                    await runner._execution_manager.square_off(
                                        db              = db,
                                        idempotency_key = f"auto_flatten:{placed.id}:margin_error",
                                        algo_id         = str(_p.algo_id),
                                        account_id      = str(_p.account_id),
                                        symbol          = _p.symbol,
                                        exchange        = _p.exchange or "NFO",
                                        direction       = _p.direction,
                                        quantity        = _p.quantity,
                                        algo_tag        = _p.algo_tag or "",
                                        is_practix      = _p.is_practix,
                                        broker_type     = "angelone" if (
                                            getattr(_p, "broker_type", None) == "angelone"
                                        ) else "zerodha",
                                        symbol_token    = str(getattr(_p, "instrument_token", None) or ""),
                                    )
                                logger.warning(
                                    f"[AUTO-FLATTEN] {_algo_name_str} leg {placed.id} squared off — margin_error auto-flatten"
                                )
                            except Exception as _sq_e:
                                logger.error(
                                    f"[AUTO-FLATTEN] FAILED to square off {placed.id}: {_sq_e}. MANUAL INTERVENTION REQUIRED."
                                )
                            await runner._close_order(db, _p, _cached_ltp, "margin_error")
                    # Deregister any armed W&T window for this grid entry
                    if runner._wt_evaluator:
                        runner._wt_evaluator.deregister(_ge_id_str)
                    await runner._set_error(
                        db, algo_state, grid_entry,
                        f"Margin error on leg {leg_number}: {str(e)}",
                        algo_name=_algo_name_str,
                    )
                    await db.commit()
                    return
                else:
                    logger.info(
                        f"[MARGIN_ERROR] {_algo_name_str} — margin error on leg {leg_number}, "
                        f"continuing other legs (exit_on_margin_error=False)"
                    )
                    await _ev.info(
                        f"{_algo_name_str} — margin error on leg {leg_number}, continuing",
                        algo_name=_algo_name_str, algo_id=_algo_id_str, source="engine",
                    )
                    continue

            if _algo_exit_on_entry_failure:
                logger.warning(
                    f"on_entry_fail=exit_all — squaring off {len(placed_orders)} placed legs"
                )
                for placed in placed_orders:
                    _cached_ltp = _order_cache.get(str(placed.id), (0.0,))[0]
                    _p = await db.get(Order, placed.id)
                    if _p:
                        try:
                            if runner._execution_manager:
                                await runner._execution_manager.square_off(
                                    db              = db,
                                    idempotency_key = f"auto_flatten:{placed.id}:entry_failure_auto_flatten",
                                    algo_id         = str(_p.algo_id),
                                    account_id      = str(_p.account_id),
                                    symbol          = _p.symbol,
                                    exchange        = _p.exchange or "NFO",
                                    direction       = _p.direction,
                                    quantity        = _p.quantity,
                                    algo_tag        = _p.algo_tag or "",
                                    is_practix      = _p.is_practix,
                                    broker_type     = _algo_broker_type,
                                    symbol_token    = str(getattr(_p, "instrument_token", None) or ""),
                                )
                            logger.warning(
                                f"[AUTO-FLATTEN] {_algo_name_str} leg {placed.id} squared off — entry_failure_auto_flatten"
                            )
                        except Exception as _sq_e:
                            logger.error(
                                f"[AUTO-FLATTEN] FAILED to square off {placed.id}: {_sq_e}. MANUAL INTERVENTION REQUIRED."
                            )
                        await runner._close_order(db, _p, _cached_ltp, "entry_fail")
                # Deregister any armed W&T window for this grid entry
                if runner._wt_evaluator:
                    runner._wt_evaluator.deregister(_ge_id_str)
                await runner._set_error(
                    db, algo_state, grid_entry, f"Leg {leg_number} failed: {str(e)}",
                    algo_name=_algo_name_str,
                )
                await db.commit()
                return

    # ── 7. Update MTM combined premium ─────────────────────────────────────
    # Use cached fill_prices (index 1) since per-leg commits expire ORM attrs.
    if runner._mtm_monitor and placed_orders:
        cp = sum(_order_cache.get(str(o.id), (0.0, 0.0))[1] for o in placed_orders)
        if str(algo.id) in runner._mtm_monitor._algos:
            runner._mtm_monitor._algos[str(algo.id)].combined_premium = cp
            runner._mtm_monitor._algos[str(algo.id)].order_ids = [
                str(o.id) for o in placed_orders
            ]
            # B11: warn when % MTM configured but all fills returned 0 premium
            if cp == 0.0 and runner._mtm_monitor._algos[str(algo.id)].mtm_unit == "pct":
                if getattr(algo, 'mtm_sl', None) or getattr(algo, 'mtm_tp', None):
                    logger.warning(
                        "[MTM] WARNING: combined_premium=0 for %s — "
                        "%% MTM SL/TP check disabled until premium is non-zero",
                        _algo_name_str,
                    )
                    asyncio.create_task(
                        _ev.warn(
                            "engine",
                            f"MTM % mode: combined_premium=0 for {_algo_name_str} — SL/TP check disabled",
                        )
                    )

    # ── 8. Finalise grid entry status ─────────────────────────────────────
    if placed_orders:
        grid_entry.status = GridStatus.OPEN
    elif not entry_error:
        # W&T or ORB — all legs deferred, waiting for trigger
        grid_entry.status  = GridStatus.ALGO_ACTIVE
        # algo_state was set to ACTIVE at line 436 (before leg placement).
        # Reset to WAITING so the /waiting endpoint can surface these algos.
        algo_state.status  = AlgoRunStatus.WAITING
        logger.info(
            f"[ENTER] {algo.name} — all legs deferred (W&T/ORB), "
            f"algo_state reset to WAITING"
        )

    await db.commit()

    # ── 9. WebSocket notifications ────────────────────────────────────────
    # Use cached attributes (per-leg commits expire ORM objects).
    for order in placed_orders:
        _cached = _order_cache.get(str(order.id), (0.0, 0.0, "", ""))
        _ltp, _fill, _dir, _sym = _cached
        sign = _dir.upper() if _dir else "?"
        await _ev.success(
            f"{algo.name} · {sign} {_sym} OPEN @ {_fill:.2f}",
            algo_name=algo.name, source="engine",
        )
        asyncio.create_task(_push.send_push(
            "⚡ Entry",
            f"{algo.name} {sign} {_sym} @ {_fill:.2f}",
        ))
        asyncio.create_task(_wa_notify("entry_executed", {
            "algo_name":  algo.name,
            "account":    "",
            "symbol":     _sym,
            "fill_price": _fill,
            "lots":       1,
        }))
        asyncio.create_task(_tg_notify("entry_executed", {
            "algo_name":  algo.name,
            "account":    "",
            "symbol":     _sym,
            "fill_price": _fill,
            "lots":       1,
        }))
    logger.info(
        f"✅ Entry complete: {algo.name} | {len(placed_orders)} orders placed"
    )


async def pre_execution_check(
    runner,
    algo,
    grid_entry,
    leg,
    force_direct: bool = False,
):
    """
    Returns (ok, ExecutionErrorCode, is_waiting).
    - ok=False, is_waiting=False  → hard block → _set_error
    - ok=False, is_waiting=True   → soft block → _set_waiting (W&T/ORB stream not up yet)
    Called before any leg is placed — gates on broker token + SmartStream.
    PRACTIX entries skip live-only checks.
    """
    is_practix = grid_entry.is_practix

    # 1. Broker token check for live orders
    if not is_practix:
        from app.models.account import BrokerType
        account_broker = None
        if hasattr(algo, "account_id") and algo.account_id:
            from app.models.account import Account
            from app.core.database import AsyncSessionLocal
            # Capture all _acc attributes INSIDE the session — accessing them after
            # the context exits may trigger await_only() on a detached object → MissingGreenlet.
            _acc_broker = None
            _acc_client_id = None
            async with AsyncSessionLocal() as _db:
                from sqlalchemy import select as _select
                _res = await _db.execute(_select(Account).where(Account.id == algo.account_id))
                _acc = _res.scalar_one_or_none()
                if _acc:
                    _acc_broker    = _acc.broker
                    _acc_client_id = _acc.client_id
            if _acc_broker == BrokerType.ANGELONE:
                account_broker = runner._angel_broker_map.get(_acc_client_id)
                if account_broker is None:
                    logger.error(
                        f"[BROKER] No broker found for client_id={_acc_client_id!r} "
                        f"— order blocked (AO broker not wired)"
                    )
                    return False, ExecutionErrorCode.TOKEN_INVALID, False
            else:
                account_broker = runner._zerodha_broker

        if account_broker is not None and not account_broker.is_token_set():
            return False, ExecutionErrorCode.TOKEN_INVALID, False

        # 1b. Live API key validation — is_token_set() only checks string is non-empty.
        # An expired/invalid token (AG8004) passes that check but fails on real API calls.
        # Test with a single underlying LTP call. Cost: ~200ms.
        if account_broker is not None and account_broker.is_token_set():
            _underlying = leg.underlying if hasattr(leg, "underlying") else "NIFTY"
            try:
                _spot = await account_broker.get_underlying_ltp(_underlying)
                if _spot == 0.0:
                    logger.warning(
                        f"⚠️ [PRE-CHECK] Broker API key invalid for {algo.name} "
                        f"— LTP returned 0.0 for {_underlying} "
                        f"(likely AG8004 / expired session). Check SmartAPI portal."
                    )
                    return False, ExecutionErrorCode.API_KEY_INVALID, False
            except Exception as _ltp_err:
                logger.warning(
                    f"⚠️ [PRE-CHECK] Broker API key check failed for {algo.name}: {_ltp_err}"
                )
                return False, ExecutionErrorCode.API_KEY_INVALID, False

    # 2. SmartStream check for W&T legs and ORB algos (live only)
    # Returns is_waiting=True so enter_with_db uses WAITING (not ERROR) status —
    # the algo will trigger once SmartStream connects and ticks arrive.
    # force_direct=True: W&T is bypassed in _place_leg, so no stream needed for W&T legs.
    if not is_practix and not force_direct:
        needs_stream = (
            getattr(leg, "wt_enabled", False)
            or getattr(algo, "entry_type", None) == "orb"
        )
        if needs_stream:
            ltp_running = (
                runner._ltp_consumer is not None
                and getattr(runner._ltp_consumer, "_running", False)
            )
            if not ltp_running:
                # Grace window: wait up to 8s (1s intervals) for feed to connect
                for _grace_attempt in range(8):
                    await asyncio.sleep(1)
                    ltp_running = (
                        runner._ltp_consumer is not None
                        and getattr(runner._ltp_consumer, "_running", False)
                    )
                    if ltp_running:
                        logger.info(
                            f"[FEED] SmartStream connected during grace window "
                            f"(attempt {_grace_attempt + 1}/8) for {algo.name} "
                            f"leg {leg.leg_number} — proceeding with entry"
                        )
                        break
            if not ltp_running:
                logger.warning(
                    f"⚠️ [FEED_ERROR] SmartStream not ready after 8s grace for {algo.name} "
                    f"leg {leg.leg_number} — leg deferred to WAITING state."
                )
                return False, ExecutionErrorCode.FEED_INACTIVE, True   # is_waiting=True

    return True, ExecutionErrorCode.UNKNOWN, False
