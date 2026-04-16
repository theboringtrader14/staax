"""
AlgoRunner — STAAX Entry Orchestrator.

The single class that coordinates all engine components to execute an algo:
  1. Resolve strike via StrikeSelector
  2. Apply W&T watch via WTEvaluator  (if wt_enabled on leg)
  3. Apply entry delay (scoped to BUY/SELL legs)
  4. Place order via OrderPlacer       (PRACTIX or LIVE)
  5. Persist Order to DB
  6. Register with SLTPMonitor, TSLEngine, MTMMonitor
  7. Subscribe instrument token on LTPConsumer

Also handles:
  - exit_all()         — triggered by auto-SQ, terminate, MTM breach
  - on_sl_hit()        — callback from SLTPMonitor
  - on_tp_hit()        — callback from SLTPMonitor
  - on_mtm_breach()    — callback from MTMMonitor
  - on_orb_entry()     — callback from ORBTracker
  - on_wt_entry()      — callback from WTEvaluator
  - overnight_sl_check() — called by scheduler at 09:18

Architecture note:
  AlgoRunner is instantiated ONCE as a singleton (see bottom of file).
  It holds references to all engine singletons injected at startup in main.py.
  AlgoRunner.wire_engines(...) is called once in main.py lifespan.
"""
import asyncio
import logging
import uuid
from datetime import datetime, date
from typing import Optional, List, Dict
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from app.core.database import AsyncSessionLocal
from app.models.grid import GridEntry, GridStatus
from app.models.algo import Algo, AlgoLeg, StrategyMode, EntryType
from app.models.algo_state import AlgoState, AlgoRunStatus
from app.models.order import Order, OrderStatus
from app.models.account import Account, BrokerType

from app.engine.strike_selector import StrikeSelector
from app.engine.order_placer import OrderPlacer
from app.engine.execution_manager import ExecutionManager
from app.engine.sl_tp_monitor import SLTPMonitor, PositionMonitor
from app.engine.tsl_engine import TSLEngine, TSLState
from app.engine.ttp_engine import TTPEngine, TTPState
from app.engine.journey_engine import JourneyEngine
from app.engine.mtm_monitor import MTMMonitor, AlgoMTMState
from app.engine.wt_evaluator import WTEvaluator, WTWindow
from app.engine.orb_tracker import ORBTracker, ORBWindow
from app.engine.reentry_engine import ReentryEngine
from app.engine.execution_errors import ExecutionErrorCode
from app.engine.ltp_consumer import LTPConsumer
from app.engine import event_logger as _ev
from app.engine import push_sender as _push
from app.engine import order_audit as _audit

IST = ZoneInfo("Asia/Kolkata")
logger = logging.getLogger(__name__)


class TokenBucketRateLimiter:
    """
    Asyncio token bucket rate limiter.
    MAX_ORDERS_PER_SEC = 8 (SEBI limit is 10; we keep 2 as buffer).
    Each _place_leg() call acquires one token before placing an order.
    If the bucket is empty, the call waits the minimum time to refill one token.
    """
    MAX_ORDERS_PER_SEC = 8

    def __init__(self, rate: int = 8):
        self._rate       = rate
        self._tokens     = float(rate)
        self._last_refill = 0.0
        self._lock       = asyncio.Lock()

    async def acquire(self):
        async with self._lock:
            now     = asyncio.get_event_loop().time()
            elapsed = now - self._last_refill
            # Refill tokens based on elapsed time
            self._tokens = min(self._rate, self._tokens + elapsed * self._rate)
            self._last_refill = now
            if self._tokens >= 1:
                self._tokens -= 1
                return
            # Bucket empty — compute wait and release lock before sleeping
            wait = (1 - self._tokens) / self._rate
        logger.warning(
            f"[RATE LIMIT] Order rate {self._rate}/s exceeded — "
            f"queuing with delay={wait:.3f}s"
        )
        await asyncio.sleep(wait)


class AlgoRunner:
    """
    Central coordinator for algo execution.
    One instance per server process.
    """

    def __init__(self):
        # Injected at startup via wire_engines()
        self._strike_selector: Optional[StrikeSelector]  = None
        self._order_placer:    Optional[OrderPlacer]      = None
        self._sl_tp_monitor:   Optional[SLTPMonitor]      = None
        self._tsl_engine:      Optional[TSLEngine]        = None
        self._ttp_engine:      Optional[TTPEngine]        = None
        self._journey_engine:  Optional[JourneyEngine]    = None
        self._mtm_monitor:     Optional[MTMMonitor]       = None
        self._wt_evaluator:    Optional[WTEvaluator]      = None
        self._orb_tracker:     Optional[ORBTracker]       = None
        self._reentry_engine:  Optional[ReentryEngine]    = None
        self._ltp_consumer:    Optional[LTPConsumer]      = None
        self._ws_manager       = None   # app.ws.connection_manager.ConnectionManager

        # Broker references — keyed by broker client_id for multi-account routing
        self._zerodha_broker   = None
        self._angel_broker_map: Dict[str, object] = {}  # client_id → AngelOneBroker

        # ORB range levels — stored at breakout, keyed by grid_entry_id
        # Used to populate PositionMonitor.orb_high / orb_low for SL evaluation
        self._orb_levels: Dict[str, tuple] = {}  # grid_entry_id → (orb_high, orb_low)

        # Rate limiter — 8 orders/sec (SEBI max is 10)
        self._rate_limiter = TokenBucketRateLimiter(rate=8)

        # Execution layer — single control point (wired via wire_engines)
        self._execution_manager: Optional[ExecutionManager] = None

        # Track which underlying tokens already have an LTP callback registered
        # for pts_underlying / pct_underlying SL/TP (P0-3).
        # Prevents duplicate callback registration when multiple legs share the same underlying.
        self._ul_subscribed_tokens: set = set()

    def wire_engines(
        self,
        strike_selector:   StrikeSelector,
        order_placer:      OrderPlacer,
        sl_tp_monitor:     SLTPMonitor,
        tsl_engine:        TSLEngine,
        ttp_engine:        TTPEngine,
        journey_engine:    JourneyEngine,
        mtm_monitor:       MTMMonitor,
        wt_evaluator:      WTEvaluator,
        orb_tracker:       ORBTracker,
        reentry_engine:    ReentryEngine,
        ltp_consumer:      LTPConsumer,
        ws_manager,
        zerodha_broker     = None,
        angel_brokers      = None,
        execution_manager  = None,
    ):
        """Called once in main.py lifespan after all engines are initialised."""
        self._strike_selector = strike_selector
        self._order_placer    = order_placer
        self._sl_tp_monitor   = sl_tp_monitor
        self._tsl_engine      = tsl_engine
        self._ttp_engine      = ttp_engine
        self._journey_engine  = journey_engine
        self._mtm_monitor     = mtm_monitor
        self._wt_evaluator    = wt_evaluator
        self._orb_tracker     = orb_tracker
        self._reentry_engine  = reentry_engine
        self._ltp_consumer    = ltp_consumer
        self._ws_manager      = ws_manager

        # Broker registry for per-account order routing
        self._zerodha_broker  = zerodha_broker
        if angel_brokers:
            for b in angel_brokers:
                self._angel_broker_map[b.client_id] = b

        # Execution layer
        self._execution_manager = execution_manager

        logger.info("✅ AlgoRunner engines wired")

    # ── Entry ─────────────────────────────────────────────────────────────────

    async def enter_specific_legs(self, grid_entry_id: str, leg_ids: list):
        """
        Re-place only the specified legs (by AlgoLeg UUID) for a grid entry already in ERROR state.
        Called by the retry-legs endpoint when some legs succeeded and only a subset errored.
        Does NOT transition AlgoState — caller already reset it to ACTIVE.
        """
        import uuid as _uuid_mod
        leg_uuid_set = {_uuid_mod.UUID(lid) for lid in leg_ids}

        async with AsyncSessionLocal() as db:
            try:
                result = await db.execute(
                    select(AlgoState, GridEntry, Algo)
                    .join(GridEntry, AlgoState.grid_entry_id == GridEntry.id)
                    .join(Algo, GridEntry.algo_id == Algo.id)
                    .where(AlgoState.grid_entry_id == grid_entry_id)
                )
                row = result.one_or_none()
                if not row:
                    logger.error(f"[RETRY-LEGS] No AlgoState for {grid_entry_id}")
                    return
                algo_state, grid_entry, algo = row

                account = None
                if algo.account_id:
                    acc_res = await db.execute(select(Account).where(Account.id == algo.account_id))
                    account = acc_res.scalar_one_or_none()

                legs_result = await db.execute(
                    select(AlgoLeg)
                    .where(AlgoLeg.algo_id == algo.id, AlgoLeg.id.in_(leg_uuid_set))
                    .order_by(AlgoLeg.leg_number)
                )
                legs = legs_result.scalars().all()
                if not legs:
                    logger.error(f"[RETRY-LEGS] No matching legs found for {grid_entry_id}")
                    return

                placed: list = []
                any_error = False
                for leg in legs:
                    leg_number = leg.leg_number
                    try:
                        order = await self._place_leg(
                            db, leg, algo, algo_state, grid_entry,
                            reentry=False, original_order=None, account=account,
                        )
                        if order:
                            placed.append(order)
                            logger.info(f"[RETRY-LEGS] Leg {leg_number} placed: {order.symbol}")
                    except Exception as e:
                        try:
                            await db.rollback()
                        except Exception:
                            pass
                        logger.error(f"[RETRY-LEGS] Leg {leg_number} failed: {e}", exc_info=True)
                        any_error = True

                if placed:
                    grid_entry.status = GridStatus.OPEN
                await db.commit()

                for order in placed:
                    await _ev.success(
                        f"{algo.name} · {order.direction.upper()} {order.symbol} OPEN @ {order.fill_price or 0:.2f}",
                        algo_name=algo.name, source="engine",
                    )
                logger.info(f"[RETRY-LEGS] {len(placed)} legs placed, any_error={any_error}")

            except Exception as e:
                logger.error(f"[RETRY-LEGS] enter_specific_legs failed for {grid_entry_id}: {e}", exc_info=True)
                try:
                    await db.rollback()
                except Exception:
                    pass

    async def enter(
        self,
        grid_entry_id:  str,
        reentry:        bool = False,
        original_order: Optional[Order] = None,
        force_direct:   bool = False,
        force_immediate: bool = False,
    ):
        """
        Main entry point — executes all legs for a grid entry.
        Called by:
          - Scheduler._job_entry  (Direct algos)
          - on_orb_entry callback (ORB algos)
          - on_wt_entry callback  (W&T algos)
          - ReentryEngine._trigger_reentry (re-entries)
          - Manual RETRY endpoint (force_direct=True, force_immediate=True)

        force_direct=True:   Skip W&T deferral — place immediately at current LTP.
        force_immediate=True: Fire _enter_with_db now even if entry_time is in the future.
                              If False and entry_time is still ahead, schedule for that time.
        """
        from zoneinfo import ZoneInfo as _ZI
        IST_ZONE = _ZI("Asia/Kolkata")

        # ── Entry-time gate (only for non-immediate, non-reentry calls) ─────────
        if not force_immediate and not reentry:
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
                _et = getattr(_algo, "entry_time", None)
                if _et:
                    _h, _m = map(int, str(_et).split(":")[:2])
                    _now = datetime.now(IST_ZONE).time()
                    _entry_t = datetime.now(IST_ZONE).replace(
                        hour=_h, minute=_m, second=0, microsecond=0
                    ).time()
                    if _now < _entry_t:
                        logger.info(
                            f"[enter] {getattr(_algo, 'name', grid_entry_id)} entry_time {_et} "
                            f"still ahead ({_now} < {_entry_t}) — scheduling job instead of firing now"
                        )
                        if self._scheduler:
                            import asyncio as _aio
                            _loop = getattr(self._scheduler, "_loop", None)
                            if _loop and _loop.is_running():
                                import asyncio
                                asyncio.run_coroutine_threadsafe(
                                    self._enter_with_db_wrap(grid_entry_id, force_direct),
                                    _loop,
                                )
                        return

        async with AsyncSessionLocal() as db:
            try:
                await self._enter_with_db(db, grid_entry_id, reentry, original_order, force_direct=force_direct)
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
                await self._mark_error(grid_entry_id, f"{type(e).__name__}: {str(e)[:200]}")

    async def _enter_with_db_wrap(self, grid_entry_id: str, force_direct: bool = False):
        """Thin wrapper used when scheduling an enter from a threadsafe context."""
        async with AsyncSessionLocal() as db:
            try:
                await self._enter_with_db(db, grid_entry_id, False, None, force_direct=force_direct)
            except Exception as e:
                logger.error(f"[enter_wrap] {grid_entry_id}: {e}", exc_info=True)
                try:
                    await db.rollback()
                except Exception:
                    pass
                await self._mark_error(grid_entry_id, f"{type(e).__name__}: {str(e)[:200]}")

    async def _enter_with_db(
        self,
        db: AsyncSession,
        grid_entry_id: str,
        reentry: bool,
        original_order: Optional[Order],
        force_direct: bool = False,
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
            return

        logger.info(
            f"{'↻ Re-entry' if reentry else '▶ Entry'}: {algo.name} "
            f"[{grid_entry_id}] practix={grid_entry.is_practix}"
        )

        # ── 3. Load legs ───────────────────────────────────────────────────────
        legs_result = await db.execute(
            select(AlgoLeg)
            .where(AlgoLeg.algo_id == algo.id)
            .order_by(AlgoLeg.leg_number)
        )
        legs: List[AlgoLeg] = legs_result.scalars().all()

        if not legs:
            logger.error(f"No legs for algo {algo.name} ({algo.id})")
            await self._set_no_trade(db, algo_state, grid_entry, "no_legs", algo_name=algo.name)
            return

        # ── 3b. Pre-execution validation ───────────────────────────────────────
        for leg in legs:
            ok, reason, is_waiting = await self._pre_execution_check(algo, grid_entry, leg, force_direct=force_direct)
            if not ok:
                log_level = "warning" if is_waiting else "error"
                getattr(logger, log_level)(
                    f"[{'WAITING' if is_waiting else 'BLOCKED'}] {algo.name} — {reason}"
                )
                # Write pre_check_failed to execution audit log
                if self._execution_manager:
                    await self._execution_manager._log(
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
                    await self._set_waiting(db, algo_state, grid_entry, reason)
                else:
                    await self._set_error(db, algo_state, grid_entry, reason, algo_name=algo.name)
                return

        # ── 4. Transition AlgoState to ACTIVE ─────────────────────────────────
        algo_state.status       = AlgoRunStatus.ACTIVE
        algo_state.activated_at = datetime.now(IST)
        grid_entry.status       = GridStatus.ORDER_PENDING

        # ── 5. Set up MTM monitor for this algo ────────────────────────────────
        if self._mtm_monitor:
            combined_premium = 0.0  # filled after orders placed
            mtm_state = AlgoMTMState(
                algo_id=str(algo.id),
                account_id=str(algo.account_id),
                mtm_sl=algo.mtm_sl,
                mtm_tp=algo.mtm_tp,
                mtm_unit=algo.mtm_unit or "amt",
            )
            self._mtm_monitor.register_algo(
                mtm_state,
                on_breach=self._make_mtm_callback(grid_entry_id),
            )

        # ── 6. Place orders for each leg ───────────────────────────────────────
        placed_orders: List[Order] = []
        # G2: cache plain Python values before per-leg commits expire ORM objects.
        # Keys are str(order.id); values are tuples of (ltp, fill_price, direction, symbol).
        _order_cache: dict = {}
        entry_error = False

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
                order = await self._place_leg(
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

                if self._execution_manager:
                    await self._execution_manager._log(
                        db            = db,
                        action        = "PLACE",
                        status        = "FAILED",
                        algo_id       = str(algo.id),
                        account_id    = str(algo.account_id) if algo.account_id else "",
                        grid_entry_id = str(grid_entry.id),
                        reason        = str(e),
                        event_type    = "entry_failed",
                        is_practix    = grid_entry.is_practix,
                        details       = {"leg": leg_number, "error": str(e)},
                    )

                # Write to event_log so leg failure surfaces in System Log / notification bell
                await _ev.error(
                    f"{algo.name} · Leg {leg_number} failed: {str(e)[:200]}",
                    algo_name=algo.name,
                    algo_id=str(algo.id),
                    source="engine",
                )

                # Margin-error branch — checked before exit_on_entry_failure
                _err_lower = str(e).lower()
                _is_margin = any(kw in _err_lower for kw in ("insufficient margin", "insufficient funds", "margin"))
                if _is_margin:
                    if getattr(algo, "exit_on_margin_error", True):
                        logger.warning(
                            f"[MARGIN_ERROR] {algo.name} — margin error on leg {leg.leg_number}, "
                            f"exiting all positions (exit_on_margin_error=True)"
                        )
                        await _ev.error(
                            f"[MARGIN_ERROR] {algo.name} — margin error on leg {leg.leg_number}, exiting all positions",
                            algo_name=algo.name, algo_id=str(algo.id), source="engine",
                        )
                        for placed in placed_orders:
                            _cached_ltp = _order_cache.get(str(placed.id), (0.0,))[0]
                            _p = await db.get(Order, placed.id)
                            if _p:
                                await self._close_order(db, _p, _cached_ltp, "margin_error")
                        await self._set_error(
                            db, algo_state, grid_entry,
                            f"Margin error on leg {leg.leg_number}: {str(e)}",
                            algo_name=algo.name,
                        )
                        await db.commit()
                        return
                    else:
                        logger.info(
                            f"[MARGIN_ERROR] {algo.name} — margin error on leg {leg.leg_number}, "
                            f"continuing other legs (exit_on_margin_error=False)"
                        )
                        await _ev.info(
                            f"[MARGIN_ERROR] {algo.name} — margin error on leg {leg.leg_number}, continuing",
                            algo_name=algo.name, algo_id=str(algo.id), source="engine",
                        )
                        continue

                if algo.exit_on_entry_failure:
                    logger.warning(
                        f"on_entry_fail=exit_all — squaring off {len(placed_orders)} placed legs"
                    )
                    for placed in placed_orders:
                        _cached_ltp = _order_cache.get(str(placed.id), (0.0,))[0]
                        _p = await db.get(Order, placed.id)
                        if _p:
                            await self._close_order(db, _p, _cached_ltp, "entry_fail")
                    await self._set_error(
                        db, algo_state, grid_entry, f"Leg {leg.leg_number} failed: {str(e)}",
                        algo_name=algo.name,
                    )
                    await db.commit()
                    return

        # ── 7. Update MTM combined premium ─────────────────────────────────────
        # Use cached fill_prices (index 1) since per-leg commits expire ORM attrs.
        if self._mtm_monitor and placed_orders:
            cp = sum(_order_cache.get(str(o.id), (0.0, 0.0))[1] for o in placed_orders)
            if str(algo.id) in self._mtm_monitor._algos:
                self._mtm_monitor._algos[str(algo.id)].combined_premium = cp
                self._mtm_monitor._algos[str(algo.id)].order_ids = [
                    str(o.id) for o in placed_orders
                ]

        # ── 8. Finalise grid entry status ─────────────────────────────────────
        if placed_orders:
            grid_entry.status = GridStatus.OPEN
        elif not entry_error:
            # W&T or ORB — waiting for trigger
            grid_entry.status = GridStatus.ALGO_ACTIVE

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
        logger.info(
            f"✅ Entry complete: {algo.name} | {len(placed_orders)} orders placed"
        )

    async def _pre_execution_check(
        self, algo: "Algo", grid_entry: "GridEntry", leg: "AlgoLeg", force_direct: bool = False,
    ) -> tuple[bool, ExecutionErrorCode, bool]:
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
                async with AsyncSessionLocal() as _db:
                    from sqlalchemy import select as _select
                    _res = await _db.execute(_select(Account).where(Account.id == algo.account_id))
                    _acc = _res.scalar_one_or_none()
                if _acc and _acc.broker == BrokerType.ANGELONE:
                    account_broker = self._angel_broker_map.get(_acc.client_id)
                    if account_broker is None:
                        logger.error(
                            f"[BROKER] No broker found for client_id={getattr(_acc, 'client_id', '?')} "
                            f"— order blocked (AO broker not wired)"
                        )
                        return False, ExecutionErrorCode.TOKEN_INVALID, False
                else:
                    account_broker = self._zerodha_broker

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
        # Returns is_waiting=True so _enter_with_db uses WAITING (not ERROR) status —
        # the algo will trigger once SmartStream connects and ticks arrive.
        # force_direct=True: W&T is bypassed in _place_leg, so no stream needed for W&T legs.
        if not is_practix and not force_direct:
            needs_stream = (
                getattr(leg, "wt_enabled", False)
                or getattr(algo, "entry_type", None) == "orb"
            )
            if needs_stream:
                ltp_running = (
                    self._ltp_consumer is not None
                    and getattr(self._ltp_consumer, "_running", False)
                )
                if not ltp_running:
                    # Grace window: wait up to 8s (1s intervals) for feed to connect
                    for _grace_attempt in range(8):
                        await asyncio.sleep(1)
                        ltp_running = (
                            self._ltp_consumer is not None
                            and getattr(self._ltp_consumer, "_running", False)
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

    async def _place_leg(
        self,
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
        account_broker = self._zerodha_broker   # default
        if account and account.broker == BrokerType.ANGELONE:
            broker_type    = "angelone"
            account_broker = self._angel_broker_map.get(account.client_id)
            if not account_broker:
                logger.warning(
                    f"[BROKER] No Angel One broker found for client_id={account.client_id} — "
                    "falling back to order_placer default"
                )

        # ── Execution guard: broker session check ─────────────────────────────
        if account_broker and not account_broker.is_token_set():
            raise ValueError(
                f"Broker not initialized for {broker_type} — token not set "
                f"(account: {account.nickname if account else 'unknown'}). "
                "Complete broker login first."
            )

        # ── W&T: register watcher and defer — order placed when threshold hits ─
        # force_direct=True (manual RETRY): skip W&T, enter immediately at current LTP
        if leg.wt_enabled and leg.wt_value and not reentry and not force_direct:
            # W&T monitors the UNDERLYING INDEX, not the option premium.
            # Map the underlying name to its spot index token.
            wt_underlying = (leg.underlying or "").upper()
            # Primary lookup: _WT_UNDERLYING_TOKENS (canonical AlgoLeg.underlying names)
            wt_underlying_token = self._WT_UNDERLYING_TOKENS.get(wt_underlying, 0)
            if not wt_underlying_token:
                # Secondary: _ORB_UNDERLYING_TOKENS (covers MIDCAPNIFTY alias)
                wt_underlying_token = self._ORB_UNDERLYING_TOKENS.get(wt_underlying, 0)
            if not wt_underlying_token:
                # Fallback: MCX or unknown underlying
                try:
                    from app.engine.bot_runner import MCX_TOKENS as _MCX_WT
                    wt_underlying_token = _MCX_WT.get(wt_underlying, 0)
                except ImportError:
                    pass
            if self._wt_evaluator and wt_underlying_token:
                window = WTWindow(
                    grid_entry_id=str(grid_entry.id),
                    algo_id=str(algo.id),
                    direction=leg.wt_direction or "up",
                    entry_time=self._parse_time(algo.entry_time or "09:16"),
                    instrument_token=wt_underlying_token,
                    wt_value=leg.wt_value,
                    wt_unit=leg.wt_unit or "pts",
                )
                self._wt_evaluator.register(
                    window,
                    on_entry=self._make_wt_callback(str(grid_entry.id)),
                )
                # Ensure the underlying index token is subscribed so ticks flow
                if self._ltp_consumer:
                    self._ltp_consumer.subscribe([wt_underlying_token])
                # Check if index LTP is already in Redis; if not, wait up to 5s for first tick
                if self._ltp_consumer:
                    _wt_ltp = self._ltp_consumer.get_ltp(wt_underlying_token)
                    if not _wt_ltp or _wt_ltp <= 0:
                        logger.warning(
                            f"[W&T] No LTP for {wt_underlying} (token={wt_underlying_token}) in Redis yet "
                            f"— waiting up to 5s for first tick before W&T monitoring begins"
                        )
                        for _wt_wait in range(5):
                            await asyncio.sleep(1)
                            _wt_ltp = self._ltp_consumer.get_ltp(wt_underlying_token)
                            if _wt_ltp and _wt_ltp > 0:
                                logger.info(
                                    f"[W&T] LTP for {wt_underlying} available after {_wt_wait + 1}s "
                                    f"({_wt_ltp:.2f}) — W&T monitoring active"
                                )
                                break
                        else:
                            logger.warning(
                                f"[W&T] No LTP for {wt_underlying} after 5s — W&T will capture "
                                f"reference on first tick. Algo NOT marked as missed."
                            )
                logger.info(
                    f"W&T registered for leg {leg.leg_number}: {algo.name} | "
                    f"underlying={wt_underlying} token={wt_underlying_token}"
                )
            else:
                logger.error(
                    f"[W&T] underlying token not found for '{wt_underlying}' "
                    f"(leg {leg.leg_number}, {algo.name}) — "
                    f"add to _WT_UNDERLYING_TOKENS. W&T NOT registered."
                )
            return None  # deferred — order placed when W&T fires

        # ── Strike selection ───────────────────────────────────────────────────
        instrument = None
        if leg.instrument == "fu":
            # Futures — use underlying directly
            symbol        = f"{leg.underlying}FUT"
            instrument_token = getattr(leg, 'instrument_token', 0) or 0
            ltp           = 0.0
        else:
            # Options
            if reentry and original_order:
                # Same strike/expiry as original for these modes
                symbol           = original_order.symbol
                instrument_token = getattr(original_order, "instrument_token", None) or 0
                ltp              = original_order.fill_price or 0.0
            else:
                if self._strike_selector:
                    _strike_err: Exception | None = None
                    for _attempt in range(3):
                        try:
                            instrument = await self._strike_selector.select(
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
                        _msg = f"[TOKEN_ERROR] Strike selection failed after 3 attempts: {_strike_err}"
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

        # ── Entry delay ────────────────────────────────────────────────────────
        delay_secs = getattr(algo, "entry_delay_seconds", 0) or 0
        delay_scope = getattr(algo, "entry_delay_scope", "all") or "all"
        if delay_secs > 0:
            apply_delay = (
                delay_scope == "all"
                or (delay_scope == "buy"  and direction == "buy")
                or (delay_scope == "sell" and direction == "sell")
            )
            if apply_delay:
                logger.info(f"Entry delay: {delay_secs}s for {symbol}")
                await asyncio.sleep(delay_secs)

        # ── Lot size ───────────────────────────────────────────────────────────
        lot_size = instrument.get("lot_size", 1) if instrument else 1
        quantity = leg.lots * lot_size * (algo.base_lot_multiplier or 1) * grid_entry.lot_multiplier

        # ── Rate limit (SEBI: max 10/s; we cap at 8) ──────────────────────────
        await self._rate_limiter.acquire()

        # ── Generate algo_tag (SEBI audit tag) ────────────────────────────────
        account_nickname = account.nickname if account else "unknown"
        algo_name_safe   = algo.name.replace(" ", "_").replace("/", "_")
        ts_ms            = int(datetime.now(IST).timestamp() * 1000)
        algo_tag         = f"STAAX_{account_nickname}_{algo_name_safe}_{leg.leg_number}_{ts_ms}"

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
        _buffer = max(1.0, float(ltp) * 0.001)  # ₹1 or 0.1%, whichever larger
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
        journey_level = (
            f"{algo_state.reentry_count + 1}"
            if not reentry
            else f"{algo_state.journey_level or '1'}.{algo_state.reentry_count}"
        )
        order = Order(
            id=uuid.uuid4(),
            algo_id=algo.id,
            grid_entry_id=grid_entry.id,
            leg_id=leg.id,
            account_id=algo.account_id,
            algo_tag=algo_tag,
            symbol=symbol,
            exchange="NFO",
            direction=direction,
            lots=leg.lots * grid_entry.lot_multiplier,
            quantity=quantity,
            is_practix=grid_entry.is_practix,
            is_overnight=is_overnight,
            entry_type=algo.entry_type,
            status=OrderStatus.PENDING,
            journey_level=journey_level,
            instrument_token=instrument_token,
            sl_original=leg.sl_value,
        )
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
            if self._execution_manager:
                order_id_str = await self._execution_manager.place(
                    db              = db,
                    idempotency_key = idempotency_key,
                    algo_id         = str(algo.id),
                    account_id      = str(algo.account_id),
                    symbol          = symbol,
                    exchange        = "NFO",
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
                order_id_str = await self._order_placer.place(
                    idempotency_key = idempotency_key,
                    algo_id         = str(algo.id),
                    symbol          = symbol,
                    exchange        = "NFO",
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
            _orb_h, _orb_l = self._orb_levels.get(str(grid_entry.id), (0.0, 0.0))
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
            _orb_h, _orb_l = self._orb_levels.get(str(grid_entry.id), (0.0, 0.0))
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
        if self._ltp_consumer and instrument_token:
            self._ltp_consumer.subscribe([instrument_token])

        # ── Register SL/TP monitor ─────────────────────────────────────────────
        if self._sl_tp_monitor and (leg.sl_type or leg.tp_type):
            underlying_token = getattr(leg, "underlying_token", 0) or 0
            orb_high, orb_low = self._orb_levels.get(str(grid_entry.id), (0.0, 0.0))
            # For underlying-based SL/TP types, the reference price must be the
            # underlying spot LTP at entry, not the option fill price.
            _needs_ul_ref = leg.sl_type in ("pts_underlying", "pct_underlying") or \
                            leg.tp_type in ("pts_underlying", "pct_underlying")
            underlying_entry_price = 0.0
            if _needs_ul_ref and underlying_token and self._ltp_consumer:
                underlying_entry_price = self._ltp_consumer.get_ltp(underlying_token) or 0.0
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
            self._sl_tp_monitor.add_position(
                pos_monitor,
                on_sl=self._make_sl_callback(),
                on_tp=self._make_tp_callback(),
            )

            # ── Subscribe underlying token for pts_underlying / pct_underlying ─
            # When SL or TP is based on the underlying index move, we must receive
            # ticks for the underlying token and forward them to SLTPMonitor.
            _needs_ul = leg.sl_type in ("pts_underlying", "pct_underlying") or \
                        leg.tp_type in ("pts_underlying", "pct_underlying")
            if _needs_ul and underlying_token and self._ltp_consumer:
                self._ltp_consumer.subscribe([underlying_token])
                # Only register one callback per unique underlying token —
                # multiple legs on the same underlying share the same subscription.
                if underlying_token not in self._ul_subscribed_tokens:
                    self._ul_subscribed_tokens.add(underlying_token)
                    _ul_monitor = self._sl_tp_monitor   # capture for closure
                    _ul_token   = underlying_token

                    async def _underlying_tick_cb(token: int, ltp: float, tick: dict,
                                                  _monitor=_ul_monitor, _tok=_ul_token):
                        if token == _tok:
                            _monitor.update_underlying_ltp(_tok, ltp)

                    self._ltp_consumer.register_callback(_underlying_tick_cb)
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
        if self._tsl_engine and leg.tsl_enabled and leg.tsl_x and leg.tsl_y:
            tsl_state = TSLState(
                order_id=str(order.id),
                direction=direction,
                entry_price=fill_price,
                current_sl=order.sl_actual or (fill_price * 0.9),
                tsl_x=leg.tsl_x,
                tsl_y=leg.tsl_y,
                tsl_unit=leg.tsl_unit or "pts",
            )
            self._tsl_engine.register(tsl_state)
            # Record activation price so position rebuilder and UI can show it
            order.tsl_activation_price = fill_price
            order.tsl_current_sl       = order.sl_actual or (fill_price * 0.9)

        # ── Register TTP ───────────────────────────────────────────────────────
        # ttp_enabled is now a real DB column; fallback keeps backward compat with
        # algos saved before this migration that have ttp_x/y set but no flag.
        ttp_enabled = leg.ttp_enabled or (leg.ttp_x and leg.ttp_y and leg.tp_value)
        if self._ttp_engine and ttp_enabled and leg.ttp_x and leg.ttp_y:
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
            )
            self._ttp_engine.register(ttp_state)
            # Record activation price so position rebuilder and UI can show it
            order.ttp_activation_price = fill_price
            order.ttp_current_tp       = initial_tp

        # ── Register Journey ────────────────────────────────────────────────────
        journey_cfg = getattr(leg, "journey_config", None)
        if self._journey_engine and journey_cfg:
            self._journey_engine.register(str(order.id), journey_cfg, depth=1)

        return order

    # ── Exit All ──────────────────────────────────────────────────────────────

    async def exit_all(
        self,
        grid_entry_id: str,
        reason:        str = "auto_sq",
        cancel_broker_sl: bool = True,
    ):
        """
        Close all open orders for a grid entry.
        Called by:
          - scheduler._job_auto_sq   (intraday exit time)
          - on_mtm_breach            (MTM SL/TP hit)
          - API terminate endpoint   (T button)
          - overnight_sl_check       (next-day SL)
        """
        async with AsyncSessionLocal() as db:
            try:
                await self._exit_all_with_db(db, grid_entry_id, reason, cancel_broker_sl)
            except Exception as e:
                try:
                    await db.rollback()
                except Exception:
                    pass
                logger.error(f"[ENGINE] exit_all DB error, rolled back for {grid_entry_id}: {e}")

    async def _exit_all_with_db(
        self,
        db: AsyncSession,
        grid_entry_id: str,
        reason: str,
        cancel_broker_sl: bool,
    ):
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

        exit_delay_secs  = getattr(algo, "exit_delay_seconds",  0) or 0
        exit_delay_scope = getattr(algo, "exit_delay_scope",  "all") or "all"

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
                # Get current LTP — for PRACTIX fetch real market price so exit_price is meaningful
                ltp = order.ltp or order.fill_price or 0.0

                if order.is_practix and exit_broker_type == "angelone" and exit_account:
                    ao_broker = self._angel_broker_map.get(exit_account.client_id)
                    token = getattr(order, "instrument_token", None)
                    if ao_broker and token:
                        try:
                            ltp = await ao_broker.get_ltp_by_token(
                                exchange=order.exchange or "NFO",
                                symbol=order.symbol,
                                token=str(token),
                            )
                            logger.info(f"[PRACTIX EXIT] Live LTP for {order.symbol}: {ltp}")
                        except Exception as _e:
                            logger.warning(f"[PRACTIX EXIT] LTP fetch failed for {order.symbol}: {_e}")

                # Apply exit delay (scoped to BUY/SELL)
                if exit_delay_secs > 0:
                    apply = (
                        exit_delay_scope == "all"
                        or (exit_delay_scope == "buy"  and order.direction == "buy")
                        or (exit_delay_scope == "sell" and order.direction == "sell")
                    )
                    if apply:
                        logger.info(f"Exit delay: {exit_delay_secs}s for {order.symbol}")
                        await asyncio.sleep(exit_delay_secs)

                # Place closing order via ExecutionManager (single control point)
                if self._execution_manager:
                    await self._execution_manager.square_off(
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
                    await self._order_placer.place(
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

                # F9 — cancel broker SL orders
                if cancel_broker_sl and not order.is_practix and self._order_placer:
                    await self._cancel_broker_sl(order)

                await self._close_order(db, order, ltp, reason)

                # ── System Log: per-order exit event ──────────────────────────
                try:
                    _sym  = order.symbol or ""
                    _pnl  = float(order.pnl or 0)
                    _algo_name = getattr(algo, "name", "") or ""
                    _sign = "+" if _pnl >= 0 else ""
                    if reason in ("sl", "overnight_sl"):
                        await _ev.error(
                            f"{_algo_name} · {_sym} SL HIT @ {ltp:.2f} | P&L {_sign}₹{_pnl:,.2f}",
                            algo_name=_algo_name, source="engine",
                        )
                    elif reason == "tp":
                        await _ev.success(
                            f"{_algo_name} · {_sym} TP HIT @ {ltp:.2f} | P&L {_sign}₹{_pnl:,.2f}",
                            algo_name=_algo_name, source="engine",
                        )
                    elif reason == "tsl":
                        await _ev.info(
                            f"{_algo_name} · {_sym} TSL EXIT @ {ltp:.2f} | P&L {_sign}₹{_pnl:,.2f}",
                            algo_name=_algo_name, source="engine",
                        )
                    elif reason in ("auto_sq", "all_legs_closed", "btst_exit", "stbt_exit"):
                        await _ev.info(
                            f"{_algo_name} · {_sym} AUTO SQ @ {ltp:.2f} | P&L {_sign}₹{_pnl:,.2f}",
                            algo_name=_algo_name, source="engine",
                        )
                    elif reason in ("terminate", "sq"):
                        await _ev.info(
                            f"{_algo_name} · {_sym} MANUAL SQ @ {ltp:.2f} | P&L {_sign}₹{_pnl:,.2f}",
                            algo_name=_algo_name, source="engine",
                        )
                    elif reason in ("global_sl",):
                        await _ev.error(
                            f"{_algo_name} · {_sym} GLOBAL SL EXIT @ {ltp:.2f} | P&L {_sign}₹{_pnl:,.2f}",
                            algo_name=_algo_name, source="engine",
                        )
                except Exception as _log_err:
                    logger.warning(f"[ev] exit log failed: {_log_err}")

            except Exception as e:
                logger.error(f"Error closing order {order.id}: {e}")

        # Deregister monitors
        if self._sl_tp_monitor:
            for order in orders:
                self._sl_tp_monitor.remove_position(str(order.id))
        if self._tsl_engine:
            for order in orders:
                self._tsl_engine.deregister(str(order.id))
        if self._ttp_engine:
            for order in orders:
                self._ttp_engine.deregister(str(order.id))
        if self._journey_engine:
            for order in orders:
                self._journey_engine.deregister(str(order.id))
        if self._mtm_monitor and algo:
            self._mtm_monitor._algos.pop(str(algo.id), None)
        if self._reentry_engine:
            self._reentry_engine.clear_watchers(grid_entry_id)

        # Update AlgoState
        if algo_state:
            algo_state.status       = AlgoRunStatus.TERMINATED if reason == "terminate" else AlgoRunStatus.CLOSED
            algo_state.exit_reason  = reason
            algo_state.closed_at    = datetime.now(IST)
        if grid_entry:
            grid_entry.status = GridStatus.ALGO_CLOSED

        await db.commit()
        logger.info(f"✅ exit_all complete: {grid_entry_id} | reason={reason}")

    # ── F9: Cancel broker SL orders ───────────────────────────────────────────

    async def _cancel_broker_sl(self, order: Order):
        """
        F9 — Cancel any pending SL orders at the broker for this position.
        Routes to the correct broker based on the order's broker_order_id context.
        """
        try:
            broker_sl_order_id = getattr(order, "broker_sl_order_id", None)
            if not broker_sl_order_id or not self._order_placer:
                return

            # Determine which broker placed this order by loading account
            async with AsyncSessionLocal() as db:
                acc_res = await db.execute(
                    select(Account).where(Account.id == order.account_id)
                ) if getattr(order, "account_id", None) else None
                account = acc_res.scalar_one_or_none() if acc_res else None

            if account and account.broker == BrokerType.ANGELONE:
                ao_broker = self._angel_broker_map.get(account.client_id)
                if ao_broker:
                    await ao_broker.cancel_order(broker_sl_order_id)
                    logger.info(f"✅ F9: Angel One SL order cancelled: {broker_sl_order_id}")
            else:
                await self._order_placer.zerodha.cancel_order(broker_sl_order_id)
                logger.info(f"✅ F9: Zerodha SL order cancelled: {broker_sl_order_id}")
        except Exception as e:
            logger.warning(f"F9: SL cancel failed for {order.id}: {e}")
            # Non-fatal — position is already being closed

    # ── SL/TP callbacks ───────────────────────────────────────────────────────

    def _make_sl_callback(self):
        """Returns an async callback for SLTPMonitor on_sl."""
        async def on_sl_hit(order_id: str, ltp: float, reason: str):
            async with AsyncSessionLocal() as db:
                try:
                    result = await db.execute(
                        select(Order).where(Order.id == order_id)
                    )
                    order = result.scalar_one_or_none()
                    if not order:
                        return

                    tsl_trailed = (
                        self._tsl_engine.has_trailed(order_id)
                        if self._tsl_engine else False
                    )
                    await self._close_order(db, order, ltp, "sl")

                    # Deregister
                    if self._tsl_engine:
                        self._tsl_engine.deregister(order_id)
                    if self._ttp_engine:
                        self._ttp_engine.deregister(order_id)

                    # Journey: fire child leg before commit
                    if self._journey_engine and order:
                        await self._journey_engine.on_exit(db, order, "sl", self)
                        await _ev.info(
                            f"[JOURNEY] {order.algo_name or ''} — child leg fired after sl on {order.symbol}",
                            algo_name=order.algo_name or "", source="engine",
                        )

                    await db.commit()

                    # Notify WebSocket
                    _pnl = order.pnl or 0.0
                    _sign = "+" if _pnl >= 0 else ""
                    await _ev.error(
                        f"{order.algo_name or ''} · SL {order.symbol} @ {ltp} · P&L {_sign}₹{_pnl:,.0f}",
                        algo_name=order.algo_name or "", source="engine",
                    )
                    asyncio.create_task(_push.send_push(
                        "🔴 SL Hit",
                        f"{order.algo_name or 'Algo'} — SL triggered on {order.symbol}",
                    ))
                    # Re-entry check
                    if self._reentry_engine:
                        await self._reentry_engine.on_exit(
                            db, order, "sl", tsl_trailed=tsl_trailed
                        )

                    # Check if this was the last open leg
                    await self._check_algo_complete(str(order.grid_entry_id))

                except Exception as e:
                    await db.rollback()
                    logger.error(f"on_sl_hit failed for {order_id}: {e}")

        return on_sl_hit

    def _make_tp_callback(self):
        """Returns an async callback for SLTPMonitor on_tp."""
        async def on_tp_hit(order_id: str, ltp: float, reason: str):
            async with AsyncSessionLocal() as db:
                try:
                    result = await db.execute(
                        select(Order).where(Order.id == order_id)
                    )
                    order = result.scalar_one_or_none()
                    if not order:
                        return

                    await self._close_order(db, order, ltp, "tp")

                    # Capture TSL trail state BEFORE deregister clears in-memory state
                    tsl_trailed = (
                        self._tsl_engine.has_trailed(order_id)
                        if self._tsl_engine else False
                    )

                    if self._tsl_engine:
                        self._tsl_engine.deregister(order_id)
                    if self._ttp_engine:
                        self._ttp_engine.deregister(order_id)

                    # Journey: fire child leg before commit
                    if self._journey_engine and order:
                        await self._journey_engine.on_exit(db, order, "tp", self)
                        await _ev.info(
                            f"[JOURNEY] {order.algo_name or ''} — child leg fired after tp on {order.symbol}",
                            algo_name=order.algo_name or "", source="engine",
                        )

                    await db.commit()

                    _pnl_tp = order.pnl or 0.0
                    await _ev.success(
                        f"{order.algo_name or ''} · TP {order.symbol} @ {ltp} · P&L +₹{_pnl_tp:,.0f}",
                        algo_name=order.algo_name or "", source="engine",
                    )
                    asyncio.create_task(_push.send_push(
                        "✅ TP Hit",
                        f"{order.algo_name or 'Algo'} — Target reached on {order.symbol}!",
                    ))

                    if self._reentry_engine:
                        await self._reentry_engine.on_exit(
                            db, order, "tp", tsl_trailed=tsl_trailed
                        )

                    await self._check_algo_complete(str(order.grid_entry_id))

                except Exception as e:
                    await db.rollback()
                    logger.error(f"on_tp_hit failed for {order_id}: {e}")

        return on_tp_hit

    # ── MTM callback ─────────────────────────────────────────────────────────

    def _make_mtm_callback(self, grid_entry_id: str):
        """Returns an async callback for MTMMonitor on_breach."""
        async def on_mtm_breach(algo_id: str, reason: str, total_pnl: float):
            logger.info(f"MTM breach: {algo_id} | {reason} | pnl={total_pnl:.2f}")
            _level = "error" if reason == "sl" else "success"
            await _ev.log(
                _level,
                f"{algo_id} · MTM {reason.upper()} hit · ₹{total_pnl:,.0f}",
                algo_name=algo_id, source="engine",
            )
            await self.exit_all(grid_entry_id, reason=reason)

        return on_mtm_breach

    # ── ORB / W&T callbacks ───────────────────────────────────────────────────

    def _make_orb_callback(self, grid_entry_id: str):
        """Returns a callback for ORBTracker on_entry."""
        async def on_orb_entry(eid: str, entry_price: float, orb_high: float, orb_low: float):
            logger.info(f"ORB triggered for {eid} @ {entry_price} | H={orb_high} L={orb_low}")
            self._orb_levels[eid] = (orb_high, orb_low)
            # Persist to AlgoState so Orders page can display ORB levels after entry
            try:
                async with AsyncSessionLocal() as _db:
                    from app.models.algo_state import AlgoState
                    from sqlalchemy import select as _select
                    import uuid as _uuid
                    _st_res = await _db.execute(
                        _select(AlgoState).where(AlgoState.grid_entry_id == _uuid.UUID(eid))
                    )
                    _st = _st_res.scalar_one_or_none()
                    if _st:
                        _st.orb_high = orb_high
                        _st.orb_low  = orb_low
                        await _db.commit()
            except Exception as _orb_persist_err:
                logger.warning(f"[ORB] Failed to persist orb_high/orb_low to AlgoState: {_orb_persist_err}")
            await self.enter(eid, reentry=False)

        return on_orb_entry

    def _make_wt_callback(self, grid_entry_id: str):
        """Returns a callback for WTEvaluator on_entry."""
        async def on_wt_entry(eid: str, entry_price: float):
            logger.info(f"W&T triggered for {eid} @ {entry_price}")
            await self.enter(eid, reentry=False)

        return on_wt_entry

    # ── ORB Registration (called from Scheduler._job_activate_all) ───────────

    # Angel One index tokens for ORB underlying tracking.
    # For Zerodha the tokens differ; this map covers the Angel One feed which is
    # the active broker. Both token sets pass through the same LTPConsumer pipeline.
    _ORB_UNDERLYING_TOKENS = {
        "NIFTY":       99926000,
        "BANKNIFTY":   99926009,
        "FINNIFTY":    99926037,
        "MIDCAPNIFTY": 99926014,
        "SENSEX":      99919000,
    }

    # Angel One index tokens for W&T underlying tracking.
    # Uses the canonical underlying names stored in AlgoLeg.underlying.
    # MIDCPNIFTY (not MIDCAPNIFTY) is the value stored by AlgoLeg — token 99926074.
    _WT_UNDERLYING_TOKENS = {
        "NIFTY":       99926000,
        "BANKNIFTY":   99926009,
        "FINNIFTY":    99926037,
        "MIDCPNIFTY":  99926074,
        "SENSEX":      99919000,
    }

    async def register_orb(self, grid_entry_id: str, algo: Algo, grid_entry):
        """
        Register an ORB window at orb_start_time activation.
        Called from scheduler._job_activate_all when entry_type == ORB.

        ORB tracks the UNDERLYING index token during the window,
        not the option itself. The option is selected at breakout time.
        Underlying is resolved from the first leg (Algo model has no underlying field).
        """
        if not self._orb_tracker:
            return

        # Load first leg to get underlying name — Algo model has no underlying field
        async with AsyncSessionLocal() as _db:
            _legs_res = await _db.execute(
                select(AlgoLeg)
                .where(AlgoLeg.algo_id == algo.id)
                .order_by(AlgoLeg.leg_number)
            )
            _legs = _legs_res.scalars().all()

        if not _legs:
            logger.error(f"[ORB] Cannot register — no legs for algo {algo.name} ({algo.id})")
            return

        underlying = _legs[0].underlying.upper()
        underlying_token = self._ORB_UNDERLYING_TOKENS.get(underlying, 0)
        if not underlying_token:
            # MCX instruments (GOLDM etc.) use rolling futures tokens — look up from bot_runner
            try:
                from app.engine.bot_runner import MCX_TOKENS as _MCX
                underlying_token = _MCX.get(underlying, 0)
                if underlying_token:
                    logger.info(
                        f"[ORB] {underlying} resolved via MCX_TOKENS → {underlying_token} "
                        f"(rolls monthly — bot_runner.MCX_TOKENS is the source of truth)"
                    )
            except ImportError:
                pass
        if not underlying_token:
            logger.error(
                f"[ORB] Unknown underlying '{underlying}' for algo {algo.name} — "
                f"add to _ORB_UNDERLYING_TOKENS (NSE index) or MCX_TOKENS (MCX futures)"
            )
            return

        # Determine entry direction from orb_entry_at (Phase 2) or leg direction (fallback)
        _entry_at = getattr(_legs[0], 'orb_entry_at', None)
        if _entry_at == "high":
            direction = "buy"
        elif _entry_at == "low":
            direction = "sell"
        else:
            direction = _legs[0].direction or "buy"  # backward compat

        # ── ORB Phase 2: instrument range tracking ─────────────────────────────────
        # When orb_range_source == "instrument", pre-select the ATM option at window
        # registration time and track the option LTP during the window instead of
        # the underlying spot. Falls back to underlying if pre-selection fails.
        _orb_range_source = getattr(_legs[0], 'orb_range_source', None) or "underlying"
        _tracking_token = underlying_token  # default: track underlying index

        if _orb_range_source == "instrument" and self._strike_selector:
            try:
                # Pre-select strike now so we can subscribe and track its LTP
                _pre_instrument = await self._strike_selector.select(
                    underlying=_legs[0].underlying,
                    instrument_type=_legs[0].instrument or "ce",
                    expiry=_legs[0].expiry or "current_weekly",
                    strike_type=_legs[0].strike_type or "atm",
                    strike_value=_legs[0].strike_value,
                    dte=getattr(algo, "dte", None),
                )
                if _pre_instrument:
                    _pre_token = _pre_instrument.get("instrument_token", 0)
                    _pre_symbol = _pre_instrument.get("tradingsymbol", "")
                    if _pre_token and _pre_token > 0:
                        _tracking_token = _pre_token
                        if self._ltp_consumer:
                            self._ltp_consumer.subscribe([_pre_token])
                        logger.info(
                            f"[ORB] Instrument pre-selection succeeded: "
                            f"{_pre_symbol} token={_pre_token} (tracking option LTP for range)"
                        )
                    else:
                        logger.warning(
                            f"[ORB] Instrument pre-selection failed — falling back to underlying. "
                            f"algo={algo.name}"
                        )
                else:
                    logger.warning(
                        f"[ORB] Instrument pre-selection failed — falling back to underlying. "
                        f"algo={algo.name}"
                    )
            except Exception as _orb_pre_err:
                logger.warning(
                    f"[ORB] Instrument pre-selection failed — falling back to underlying. "
                    f"algo={algo.name} error={_orb_pre_err}"
                )
        else:
            if _orb_range_source == "instrument" and not self._strike_selector:
                logger.warning(
                    f"[ORB] Instrument pre-selection failed — falling back to underlying "
                    f"(strike_selector not available). algo={algo.name}"
                )

        window = ORBWindow(
            grid_entry_id=str(grid_entry_id),
            algo_id=str(algo.id),
            direction=direction,
            start_time=self._parse_time(algo.orb_start_time or "09:15"),
            end_time=self._parse_time(algo.orb_end_time or "11:16"),
            instrument_token=_tracking_token,      # was: underlying_token
            orb_range_source=_orb_range_source,    # NEW field
            wt_value=0.0,   # ORB uses range breakout, not W&T buffer
            wt_unit="pts",
        )
        self._orb_tracker.register(
            window,
            on_entry=self._make_orb_callback(str(grid_entry_id)),
        )
        if self._ltp_consumer:
            self._ltp_consumer.subscribe([_tracking_token])   # was: underlying_token
        logger.info(
            f"ORB registered: {algo.name} | underlying={underlying} token={_tracking_token} "
            f"direction={direction} orb_range_source={_orb_range_source} "
            f"window={algo.orb_start_time or '09:15'}–{algo.orb_end_time or '11:16'}"
        )

    # ── Overnight SL check ───────────────────────────────────────────────────

    async def overnight_sl_check(self, grid_entry_id: Optional[str] = None):
        """
        Called at 09:18 by scheduler.
        Check all (or one) overnight positions against their SL levels.
        If SL is hit → exit_all.
        """
        async with AsyncSessionLocal() as db:
            query = select(Order).where(
                and_(
                    Order.is_overnight == True,
                    Order.status == OrderStatus.OPEN,
                )
            )
            if grid_entry_id:
                query = query.where(Order.grid_entry_id == grid_entry_id)

            result = await db.execute(query)
            orders = result.scalars().all()
            logger.info(f"Overnight SL check: {len(orders)} open positions")

            for order in orders:
                if order.sl_actual and order.ltp:
                    sl_hit = (
                        order.ltp <= order.sl_actual if order.direction == "buy"
                        else order.ltp >= order.sl_actual
                    )
                    if sl_hit:
                        logger.info(
                            f"🔴 Overnight SL hit: {order.symbol} | "
                            f"ltp={order.ltp} sl={order.sl_actual}"
                        )
                        await self.exit_all(
                            str(order.grid_entry_id),
                            reason="overnight_sl",
                        )

    # ── Check if algo is fully done ───────────────────────────────────────────

    async def _check_algo_complete(self, grid_entry_id: str):
        """
        After a leg closes, check if all legs are done.
        If yes, close the AlgoState.
        """
        async with AsyncSessionLocal() as db:
            open_count_result = await db.execute(
                select(Order).where(
                    and_(
                        Order.grid_entry_id == grid_entry_id,
                        Order.status == OrderStatus.OPEN,
                    )
                )
            )
            open_orders = open_count_result.scalars().all()

            if not open_orders:
                state_result = await db.execute(
                    select(AlgoState, GridEntry)
                    .join(GridEntry, AlgoState.grid_entry_id == GridEntry.id)
                    .where(AlgoState.grid_entry_id == grid_entry_id)
                )
                row = state_result.one_or_none()
                if row:
                    algo_state, grid_entry = row
                    if algo_state.status == AlgoRunStatus.ACTIVE:
                        algo_state.status      = AlgoRunStatus.CLOSED
                        algo_state.closed_at   = datetime.now(IST)
                        algo_state.exit_reason = "all_legs_closed"
                        grid_entry.status      = GridStatus.ALGO_CLOSED
                        await db.commit()
                        logger.info(f"✅ All legs closed — AlgoState closed: {grid_entry_id}")

                        # System Log: algo fully closed with total P&L
                        try:
                            closed_result = await db.execute(
                                select(Order).where(
                                    Order.grid_entry_id == grid_entry_id,
                                    Order.status == OrderStatus.CLOSED,
                                )
                            )
                            closed_orders = closed_result.scalars().all()
                            _total_pnl = sum(float(o.pnl or 0) for o in closed_orders)
                            _algo_result = await db.execute(
                                select(Algo).where(Algo.id == algo_state.algo_id)
                            )
                            _algo = _algo_result.scalar_one_or_none()
                            _algo_name = getattr(_algo, "name", str(algo_state.algo_id))
                            _sign = "+" if _total_pnl >= 0 else ""
                            await _ev.success(
                                f"{_algo_name} · ALL LEGS CLOSED | Total P&L {_sign}₹{_total_pnl:,.2f}",
                                algo_name=_algo_name, source="engine",
                            )
                        except Exception as _log_err:
                            logger.warning(f"[ev] all-legs-closed log failed: {_log_err}")

                        # Clean up MTM tracking to prevent memory leak over long uptime
                        if self._mtm_monitor:
                            self._mtm_monitor.deregister_algo(str(algo_state.algo_id))

    # ── Helpers ───────────────────────────────────────────────────────────────

    # Maps raw reason strings → ExitReason enum.
    # Reasons NOT in ExitReason (e.g. "terminate", "overnight_sl") must be
    # mapped here or SQLAlchemy will fail the commit.
    _REASON_TO_EXIT: dict = {}   # populated lazily on first use

    @classmethod
    def _resolve_exit_reason(cls, reason: str):
        """Return the ExitReason enum member for a raw reason string."""
        if not cls._REASON_TO_EXIT:
            from app.models.order import ExitReason as _ER
            cls._REASON_TO_EXIT = {
                "sl":              _ER.SL,
                "tp":              _ER.TP,
                "tsl":             _ER.TSL,
                "mtm_sl":          _ER.MTM_SL,
                "mtm_tp":          _ER.MTM_TP,
                "global_sl":       _ER.GLOBAL_SL,
                "sq":              _ER.SQ,
                "auto_sq":         _ER.AUTO_SQ,
                "terminate":       _ER.SQ,        # T button — treat as manual SQ
                "overnight_sl":    _ER.SL,
                "entry_fail":      _ER.ERROR,
                "error":           _ER.ERROR,
                "all_legs_closed": _ER.AUTO_SQ,
                "btst_exit":       _ER.BTST_EXIT,
                "stbt_exit":       _ER.STBT_EXIT,
            }
        mapped = cls._REASON_TO_EXIT.get(reason)
        if mapped is not None:
            return mapped
        # Direct enum lookup for any enum value string not in the map
        from app.models.order import ExitReason as _ER
        try:
            return _ER(reason)
        except ValueError:
            logger.warning(f"[_close_order] Unknown exit reason {reason!r} — storing as AUTO_SQ")
            return _ER.AUTO_SQ

    async def _close_order(
        self, db: AsyncSession, order: Order, exit_price: float, reason: str
    ):
        """Update Order to CLOSED in DB and compute P&L."""
        order.status      = OrderStatus.CLOSED
        order.ltp         = exit_price   # snapshot LTP at close
        order.exit_price  = exit_price
        order.exit_time   = datetime.now(IST)        # datetime, not isoformat() string
        order.exit_reason = self._resolve_exit_reason(reason)
        order.pnl         = self._compute_pnl(order, exit_price)

    def _compute_pnl(self, order: Order, exit_price: float) -> float:
        if not order.fill_price:
            return 0.0
        qty = order.quantity or 0
        if order.direction == "buy":
            return (exit_price - order.fill_price) * qty
        else:
            return (order.fill_price - exit_price) * qty

    async def _set_no_trade(self, db, algo_state, grid_entry, reason, algo_name: str = ""):
        algo_state.status  = AlgoRunStatus.NO_TRADE
        algo_state.exit_reason = reason
        grid_entry.status  = GridStatus.NO_TRADE
        await db.commit()
        try:
            name = algo_name or str(getattr(algo_state, 'algo_id', 'Algo'))
            asyncio.create_task(_push.send_push(
                "⏰ Missed",
                f"{name} — Entry window passed",
            ))
        except Exception:
            pass

    async def _set_error(self, db, algo_state, grid_entry, msg, algo_name: str = ""):
        algo_state.status        = AlgoRunStatus.ERROR
        algo_state.error_message = msg
        grid_entry.status        = GridStatus.ERROR
        await db.commit()
        await _ev.error(
            f"{getattr(algo_state, 'algo_id', '')} · {msg}",
            algo_name=str(getattr(algo_state, "algo_id", "")), source="engine",
        )
        try:
            name = algo_name or str(getattr(algo_state, 'algo_id', 'Algo'))
            asyncio.create_task(_push.send_push(
                "❌ Error",
                f"{name} — {str(msg)[:80]}",
            ))
        except Exception:
            pass

    async def _set_waiting(self, db, algo_state, grid_entry, msg):
        """Mark algo as WAITING (not ERROR) — used when SmartStream is down for W&T/ORB.
        Algo stays in WAITING state; ticks will fire W&T/ORB once stream connects."""
        algo_state.status  = AlgoRunStatus.WAITING
        grid_entry.status  = GridStatus.ALGO_ACTIVE
        await db.commit()
        logger.warning(
            f"⚠️ [W&T/ORB] {getattr(algo_state, 'algo_id', '')} set to WAITING: {msg}"
        )
        is_feed_error = (msg == ExecutionErrorCode.FEED_INACTIVE or str(msg) == "FEED_INACTIVE")
        prefix = "[FEED_ERROR] " if is_feed_error else ""
        await _ev.warn(
            f"{prefix}{getattr(algo_state, 'algo_id', '')} · WAITING: {msg}",
            algo_name=str(getattr(algo_state, "algo_id", "")),
            source="engine",
        )
        # Defensive: deregister any SL/TP monitors that may be armed for this algo.
        # In the normal W&T/ORB flow this runs before orders are placed (empty loop),
        # but guards edge-cases where WAITING is triggered after partial fills.
        if self._sl_tp_monitor:
            try:
                open_res = await db.execute(
                    select(Order).where(
                        and_(
                            Order.grid_entry_id == grid_entry.id,
                            Order.status == OrderStatus.OPEN,
                        )
                    )
                )
                for _ord in open_res.scalars().all():
                    self._sl_tp_monitor.remove_position(str(_ord.id))
            except Exception as _e:
                logger.warning(f"[W&T] SL/TP deregister on _set_waiting failed (non-fatal): {_e}")

    async def _mark_error(self, grid_entry_id: str, msg: str):
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(AlgoState, GridEntry)
                .join(GridEntry, AlgoState.grid_entry_id == GridEntry.id)
                .where(AlgoState.grid_entry_id == grid_entry_id)
            )
            row = result.one_or_none()
            if row:
                await self._set_error(db, row[0], row[1], msg)

    @staticmethod
    def _parse_time(time_str: str):
        """Parse 'HH:MM' into a datetime.time."""
        from datetime import time as dtime
        h, m = map(int, time_str.split(":")[:2])
        return dtime(h, m)


# ── Singleton ─────────────────────────────────────────────────────────────────
algo_runner = AlgoRunner()
