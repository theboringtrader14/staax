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
from sqlalchemy import select, and_, update

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
import app.engine.wa_notifier as _wa_mod
import app.engine.tg_notifier as _tg_mod
from app.engine.event_bus import event_bus as _event_bus, Events as _Events


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

IST = ZoneInfo("Asia/Kolkata")
logger = logging.getLogger(__name__)


def _snap_to_005(price: float) -> float:
    """Snap price to nearest 0.05 grid (Angel One options tick)."""
    return round(round(price / 0.05) * 0.05, 2)


async def _trigger_orb_freeze(grid_entry_id: str) -> None:
    """
    Scheduler-driven ORB range freeze — fires at exact orb_end_time via DateTrigger.

    This is the primary freeze path.  The tick-driven path in ORBTracker.on_tick()
    remains as a fallback (guards with is_fetching so both paths are safe to race).
    """
    from app.engine.algo_runner import algo_runner as _runner  # module-level singleton
    tracker = _runner._orb_tracker
    if tracker is None:
        return
    window = tracker._windows.get(grid_entry_id)
    if window is None:
        return  # already deregistered (triggered or no_trade)
    if window.is_range_set or window.is_fetching:
        return  # tick path already handled it
    window.is_fetching = True
    logger.info(f"[ORB] Scheduler-driven freeze triggered for {grid_entry_id[:8]}")
    await tracker._fetch_and_set_range(window)


# Explicit margin-error keywords — avoids false-positives from bare "margin" substring.
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


async def _handle_mslc_after_sl_hit(grid_entry_id: str, sl_monitor) -> None:
    """Thin delegation to exit_engine.handle_mslc_after_sl_hit (ARCH-6 Phase 2)."""
    from app.engine.exit_engine import handle_mslc_after_sl_hit
    return await handle_mslc_after_sl_hit(grid_entry_id, sl_monitor)


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

        # W&T arming cache — persists across SmartStream reconnects (but not process restarts).
        # Key: grid_entry_id (str)
        # Value: {instrument_token, symbol, reference_price, threshold, direction, wt_value, wt_unit, entry_time}
        # Populated in _place_leg() when W&T is armed; used in rearm_wt_monitors() to restore windows.
        self._wt_arming_cache: Dict[str, dict] = {}

        # Lot size cache — keyed by "EXCHANGE:SYMBOL".
        # Populated from Angel One instrument master (lotsize field).
        # Cleared by daily reset job at midnight.
        self._lot_size_cache: Dict[str, int] = {}

        # Double-exit guard — prevents concurrent SL/TP/MTM callbacks from
        # squaring the same order more than once when ticks arrive in quick
        # succession between the is_active=False flag and the broker call.
        self._exiting_orders: set = set()

        # P1: State reconciler — tracks last run timestamp
        self._reconciler_last_run: Optional[datetime] = None

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

        # Event bus — proof-of-concept subscriber (ARCH-16)
        async def _on_sl_hit_event(event_type: str, data: dict) -> None:
            pass  # Future: Telegram, WebSocket, analytics subscribe here

        _event_bus.subscribe(_Events.SL_HIT, _on_sl_hit_event)

        logger.info("✅ AlgoRunner engines wired")

    # ── Decision Trace ────────────────────────────────────────────────────────

    async def _log_decision(
        self, db, order, event_type: str, reason: str,
        trigger_value=None, threshold_value=None,
        ltp=None, metadata: dict | None = None
    ):
        """Record WHY an exit/entry decision was made. Non-fatal — never raises."""
        from app.engine.lifecycle_manager import log_decision
        await log_decision(
            db, order, event_type, reason,
            trigger_value=trigger_value,
            threshold_value=threshold_value,
            ltp=ltp,
            metadata=metadata,
        )

    # ── SmartStream reconnect — re-arm W&T monitors ───────────────────────────

    async def rearm_wt_monitors(self):
        """
        Called whenever SmartStream reconnects (via AngelOneTickerAdapter._on_open callback).
        Finds all grid_entries (today) in ALGO_ACTIVE + WAITING state with W&T legs
        and re-registers their WTWindows with WTEvaluator.

        This handles two cases:
          1. W&T window was never registered (SmartStream was down at entry time — pre-check
             returned FEED_INACTIVE → _set_waiting() was called before _place_leg()).
          2. W&T window was registered but lost (SmartStream disconnected mid-session and
             WTEvaluator in-memory state was cleared).
        """
        if not self._wt_evaluator:
            return

        from datetime import date as _date
        from zoneinfo import ZoneInfo as _ZI
        today = datetime.now(_ZI("Asia/Kolkata")).date()

        try:
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(AlgoState, GridEntry, Algo)
                    .join(GridEntry, AlgoState.grid_entry_id == GridEntry.id)
                    .join(Algo,      GridEntry.algo_id == Algo.id)
                    .where(
                        GridEntry.trading_date == today,
                        GridEntry.status        == GridStatus.ALGO_ACTIVE,
                        AlgoState.status        == AlgoRunStatus.WAITING,
                    )
                )
                rows = result.all()

            if not rows:
                logger.info("[REARM] No WAITING W&T algos to re-arm today")
                return

            # Get already-registered grid_entry_ids from WTEvaluator to avoid duplicates
            already_registered: set = set()
            if hasattr(self._wt_evaluator, "_windows"):
                already_registered = {w.grid_entry_id for w in self._wt_evaluator._windows}

            rearmed = 0
            for _state, ge, algo in rows:
                ge_id = str(ge.id)
                if ge_id in already_registered:
                    logger.debug(f"[REARM] {algo.name} already registered — skip")
                    continue

                # Load legs for this algo
                async with AsyncSessionLocal() as db:
                    legs_result = await db.execute(
                        select(AlgoLeg)
                        .where(AlgoLeg.algo_id == algo.id)
                        .order_by(AlgoLeg.leg_number)
                    )
                    legs = legs_result.scalars().all()
                    # Eagerly read needed attributes before session closes
                    wt_legs = [
                        {
                            "leg_number":   l.leg_number,
                            "wt_enabled":   l.wt_enabled,
                            "wt_value":     l.wt_value,
                            "wt_unit":      l.wt_unit,
                            "wt_direction": l.wt_direction,
                            "underlying":   l.underlying,
                        }
                        for l in legs
                        if l.wt_enabled and l.wt_value
                    ]

                if not wt_legs:
                    continue

                algo_name      = algo.name or ge_id
                algo_entry_time = algo.entry_time or "09:16"
                algo_id_str    = str(algo.id)

                # Use arming cache to restore W&T window with original option token + ref/threshold.
                # Cache is set in _place_leg() when W&T is first armed this session.
                _cached = self._wt_arming_cache.get(ge_id)
                if _cached:
                    # W&T is broker-side only — WTEvaluator not used for W&T arming
                    if self._ltp_consumer:
                        _cached_exch = _cached.get("exchange", "NFO")
                        if _cached_exch == "BFO":
                            self._ltp_consumer.register_bfo_tokens([_cached["instrument_token"]])
                            logger.info(
                                f"[REARM] BFO token {_cached['instrument_token']} "
                                f"registered for {_cached['symbol']}"
                            )
                        self._ltp_consumer.subscribe([_cached["instrument_token"]])
                    logger.info(
                        f"[REARM] ✅ Re-armed W&T for {algo_name} "
                        f"(grid={ge_id[:8]}, option={_cached['symbol']}, "
                        f"token={_cached['instrument_token']}, "
                        f"ref={_cached['reference_price']:.2f} threshold={_cached['threshold']:.2f})"
                    )
                    rearmed += 1
                    already_registered.add(ge_id)
                else:
                    # Cache miss (process restarted) — try to restore from DB
                    try:
                        from app.models.wt_armed_state import WTArmedState
                        from sqlalchemy import select as _sel
                        from zoneinfo import ZoneInfo as _ZI
                        _today_start = datetime.now(_ZI("Asia/Kolkata")).replace(hour=0, minute=0, second=0, microsecond=0)
                        async with AsyncSessionLocal() as _rdb:
                            _rr = await _rdb.execute(
                                _sel(WTArmedState)
                                .where(WTArmedState.grid_entry_id == ge.id)
                                .where(WTArmedState.status == 'ARMED')
                                .where(WTArmedState.armed_at >= _today_start)
                            )
                            _db_state = _rr.scalar_one_or_none()
                        if _db_state:
                            _cached = {
                                "instrument_token": int(_db_state.symbol_token),
                                "symbol":           _db_state.symbol,
                                "exchange":         _db_state.exchange,
                                "reference_price":  _db_state.ref_price,
                                "threshold":        _db_state.threshold,
                                "direction":        _db_state.direction,
                                "wt_value":         wt_legs[0]["wt_value"] if wt_legs else 0,
                                "wt_unit":          wt_legs[0]["wt_unit"] if wt_legs else "pts",
                                "entry_time":       algo_entry_time,
                                "algo_id":          algo_id_str,
                                "entry_reference":  str(_db_state.ref_price),
                                "broker_order_id":  _db_state.broker_sl_id,
                            }
                            self._wt_arming_cache[ge_id] = _cached
                            logger.info(
                                f"[REARM] Restored from DB: {_db_state.symbol} "
                                f"threshold={_db_state.threshold:.2f}"
                            )
                    except Exception as _rearm_db_err:
                        logger.warning(f"[REARM] DB restore failed for {algo_name}: {_rearm_db_err}")
                    if not self._wt_arming_cache.get(ge_id):
                        logger.warning(
                            f"[REARM] No arming cache for {algo_name} (grid={ge_id[:8]}) "
                            f"— W&T cannot be restored. Use RETRY to re-arm."
                        )

            logger.info(f"[REARM] Done — {rearmed} W&T window(s) re-armed after SmartStream reconnect")

        except Exception as e:
            logger.error(f"[REARM] rearm_wt_monitors failed: {e}", exc_info=True)

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
        """Thin delegation to entry_engine.enter (ARCH-6 Phase 3)."""
        from app.engine.entry_engine import enter as _enter
        return await _enter(self, grid_entry_id, reentry, original_order, force_direct=force_direct, force_immediate=force_immediate)

    async def _enter_with_db_wrap(self, grid_entry_id: str, force_direct: bool = False):
        """Thin delegation to entry_engine.enter_with_db_wrap (ARCH-6 Phase 3)."""
        from app.engine.entry_engine import enter_with_db_wrap
        return await enter_with_db_wrap(self, grid_entry_id, force_direct=force_direct)

    async def _enter_with_db(
        self,
        db: AsyncSession,
        grid_entry_id: str,
        reentry: bool,
        original_order: Optional[Order],
        force_direct: bool = False,
        force_immediate: bool = False,
    ):
        """Thin delegation to entry_engine.enter_with_db (ARCH-6 Phase 3)."""
        from app.engine.entry_engine import enter_with_db
        return await enter_with_db(self, db, grid_entry_id, reentry, original_order, force_direct=force_direct, force_immediate=force_immediate)

    async def _enter_with_db_inner(
        self,
        db: AsyncSession,
        grid_entry_id: str,
        reentry: bool,
        original_order: Optional[Order],
        force_direct: bool = False,
        force_immediate: bool = False,
    ):
        """Thin delegation to entry_engine._enter_with_db_inner (ARCH-6 Phase 3)."""
        from app.engine.entry_engine import _enter_with_db_inner
        return await _enter_with_db_inner(self, db, grid_entry_id, reentry, original_order, force_direct=force_direct, force_immediate=force_immediate)

    async def _pre_execution_check(
        self, algo: "Algo", grid_entry: "GridEntry", leg: "AlgoLeg", force_direct: bool = False,
    ) -> tuple[bool, "ExecutionErrorCode", bool]:
        """Thin delegation to entry_engine.pre_execution_check (ARCH-6 Phase 3)."""
        from app.engine.entry_engine import pre_execution_check
        return await pre_execution_check(self, algo, grid_entry, leg, force_direct=force_direct)

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
        Delegates to placement_engine.place_leg (ARCH-6 Ph4).
        """
        from app.engine.placement_engine import PlacementContext, place_leg
        ctx = PlacementContext(
            zerodha_broker=self._zerodha_broker,
            angel_broker_map=self._angel_broker_map,
            strike_selector=self._strike_selector,
            ltp_consumer=self._ltp_consumer,
            rate_limiter=self._rate_limiter,
            execution_manager=self._execution_manager,
            order_placer=self._order_placer,
            wt_arming_cache=self._wt_arming_cache,
            orb_levels=self._orb_levels,
            sl_tp_monitor=self._sl_tp_monitor,
            tsl_engine=self._tsl_engine,
            ttp_engine=self._ttp_engine,
            journey_engine=self._journey_engine,
            ul_subscribed_tokens=self._ul_subscribed_tokens,
            make_sl_callback=self._make_sl_callback,
            make_tp_callback=self._make_tp_callback,
            runner=self,
        )
        return await place_leg(
            ctx=ctx,
            db=db,
            leg=leg,
            algo=algo,
            algo_state=algo_state,
            grid_entry=grid_entry,
            reentry=reentry,
            original_order=original_order,
            account=account,
            force_direct=force_direct,
        )

    # ── Exit All ──────────────────────────────────────────────────────────────

    async def exit_all(
        self,
        grid_entry_id: str,
        reason:        str = "auto_sq",
        cancel_broker_sl: bool = True,
    ):
        """Thin delegation to exit_engine.exit_all (ARCH-6 Phase 2)."""
        from app.engine.exit_engine import exit_all as _exit_all
        return await _exit_all(self, grid_entry_id, reason, cancel_broker_sl_flag=cancel_broker_sl)

    async def _exit_all_with_db(
        self,
        db: AsyncSession,
        grid_entry_id: str,
        reason: str,
        cancel_broker_sl: bool,
    ):
        """Thin delegation to exit_engine.exit_all_with_db (ARCH-6 Phase 2)."""
        from app.engine.exit_engine import exit_all_with_db
        return await exit_all_with_db(self, db, grid_entry_id, reason, cancel_broker_sl)

    # ── F9: Cancel broker SL orders ───────────────────────────────────────────

    async def _cancel_broker_sl(self, order: Order):
        """Thin delegation to exit_engine.cancel_broker_sl (ARCH-6 Phase 2)."""
        from app.engine.exit_engine import cancel_broker_sl
        return await cancel_broker_sl(self, order)

    # ── SL/TP callbacks ───────────────────────────────────────────────────────

    def _make_sl_callback(self):
        """
        Returns an async callback for SLTPMonitor on_sl.
        Inner _on_sl_hit_inner delegates to exit_engine (ARCH-6 Phase 2).
        """
        async def on_sl_hit(order_id: str, ltp: float, reason: str):
            if order_id in self._exiting_orders:
                logger.info(f"[EXIT GUARD] SL suppressed — {order_id} already exiting")
                return
            self._exiting_orders.add(order_id)
            try:
                from app.engine.exit_engine import on_sl_hit_inner
                await on_sl_hit_inner(self, order_id, ltp, reason)
            finally:
                self._exiting_orders.discard(order_id)

        return on_sl_hit

    def _make_tp_callback(self):
        """
        Returns an async callback for SLTPMonitor on_tp.
        Inner logic delegates to exit_engine (ARCH-6 Phase 2).
        """
        async def on_tp_hit(order_id: str, ltp: float, reason: str):
            from app.engine.exit_engine import on_tp_hit_inner
            await on_tp_hit_inner(self, order_id, ltp, reason)

        return on_tp_hit

    # ── SL monitoring restoration after restart ──────────────────────────────

    async def restore_sl_monitoring(self) -> None:
        """
        Re-register all OPEN orders with SLTPMonitor after a restart.

        PositionRebuilder re-subscribes LTP tokens but skips SL/TP callback
        registration (Order model has sl_type + sl_original which is sufficient).
        This method fills that gap: for every OPEN order with sl_type set, it
        creates a PositionMonitor and overrides sl_actual with the DB-persisted
        value (which may have been trail-adjusted by TSLEngine before the restart).
        """
        if not self._sl_tp_monitor:
            logger.warning("[RESTORE-SL] SLTPMonitor not wired — skipping")
            return

        from app.models.algo import AlgoLeg as _AlgoLeg
        recovered = 0
        async with AsyncSessionLocal() as db:
            try:
                result = await db.execute(
                    select(Order, _AlgoLeg)
                    .join(_AlgoLeg, Order.leg_id == _AlgoLeg.id)
                    .where(Order.status == OrderStatus.OPEN)
                )
                rows = result.all()

                for order, leg in rows:
                    if not order.sl_type or not order.instrument_token or not order.fill_price:
                        continue
                    # Skip if already registered (e.g. fresh position placed after startup)
                    if str(order.id) in self._sl_tp_monitor._positions:
                        continue

                    pos_monitor = PositionMonitor(
                        order_id=str(order.id),
                        grid_entry_id=str(order.grid_entry_id),
                        algo_id=str(order.algo_id),
                        direction=order.direction,
                        instrument_token=int(order.instrument_token),
                        underlying_token=0,
                        entry_price=float(order.fill_price),
                        underlying_entry_price=0.0,
                        quantity=order.quantity or 1,
                        sl_type=order.sl_type,
                        sl_value=float(order.sl_original) if order.sl_original else None,
                        tp_type=leg.tp_type if leg else None,
                        tp_value=float(leg.tp_value) if leg and leg.tp_value else None,
                        symbol=order.symbol or "",
                    )
                    self._sl_tp_monitor.add_position(
                        pos_monitor,
                        on_sl=self._make_sl_callback(),
                        on_tp=self._make_tp_callback(),
                    )
                    # Override sl_actual with DB-persisted value (TSL may have trailed)
                    if order.sl_actual:
                        pos_monitor.sl_actual = float(order.sl_actual)
                    # Override tp_level with DB-persisted target
                    if order.target:
                        pos_monitor.tp_level = float(order.target)
                    # Re-subscribe token to SmartStream.
                    # For BFO (SENSEX/BANKEX options), register_bfo_tokens MUST be called
                    # before subscribe() so SmartStream uses exchangeType=4 (BFO) instead
                    # of exchangeType=2 (NFO).  Without this, Angel One sends back the
                    # SENSEX index LTP (~76000) for the option token, contaminating _ltp_map
                    # and triggering phantom TP/SL exits with a ~₹15L P&L error.
                    if self._ltp_consumer:
                        if getattr(order, "exchange", None) == "BFO":
                            self._ltp_consumer.register_bfo_tokens([int(order.instrument_token)])
                            logger.info(
                                f"[RESTORE-SL] BFO token {order.instrument_token} "
                                f"registered for {order.symbol}"
                            )
                        self._ltp_consumer.subscribe([int(order.instrument_token)])
                    recovered += 1
                    logger.info(
                        f"[RESTORE-SL] {order.symbol} dir={order.direction} "
                        f"fill={order.fill_price} sl_actual={pos_monitor.sl_actual}"
                    )

                logger.info(f"[RESTORE-SL] ✅ {recovered} positions re-registered in SLTPMonitor")

                # Immediate SL check for all restored positions
                if recovered > 0 and self._sl_tp_monitor and self._ltp_consumer:
                    for order, _ in rows:
                        if order.instrument_token and order.sl_type:
                            await self._sl_tp_monitor.check_now(str(order.id), self._ltp_consumer)

            except Exception as e:
                logger.error(f"[RESTORE-SL] failed: {e}")

    async def rebuild_orb_levels(self) -> None:
        """Rebuild _orb_levels from AlgoState DB on startup — restores ORB SL/TP after restart."""
        try:
            async with AsyncSessionLocal() as db:
                r = await db.execute(
                    select(AlgoState)
                    .where(AlgoState.orb_high.isnot(None))
                    .where(AlgoState.orb_low.isnot(None))
                    .where(AlgoState.status == AlgoRunStatus.ACTIVE)
                )
                states = r.scalars().all()
                for s in states:
                    self._orb_levels[str(s.grid_entry_id)] = (
                        float(s.orb_high or 0),
                        float(s.orb_low or 0),
                    )
                    logger.info(
                        f"[ORB] Restored levels for {str(s.grid_entry_id)[:8]}: "
                        f"high={s.orb_high} low={s.orb_low}"
                    )
            logger.info(f"[ORB] rebuild_orb_levels complete — {len(self._orb_levels)} entry(s)")
        except Exception as e:
            logger.error(f"[ORB] rebuild_orb_levels failed: {e}")

    async def rebuild_journeys(self) -> None:
        """Re-register WATCHING journey states from DB on restart."""
        try:
            from app.models.journey_state import JourneyState, JourneyStatus
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(JourneyState).where(JourneyState.status == JourneyStatus.WATCHING)
                )
                rows = result.scalars().all()
            _trigger_map = {
                "sl_hit": "sl",
                "tp_hit": "tp",
                "exit":   "either",
                "fill":   "either",
            }
            for row in rows:
                journey_trigger = _trigger_map.get(row.trigger_on.value if hasattr(row.trigger_on, 'value') else str(row.trigger_on), "either")
                self._journey_engine.register(
                    order_id=str(row.parent_leg_id) if row.parent_leg_id else str(row.id),
                    journey_config={},  # config not persisted — re-register watch key only
                    depth=1,
                    journey_trigger=journey_trigger,
                )
            if rows:
                logger.info(f"[JOURNEY] Rebuilt {len(rows)} watching journeys from DB")
        except Exception as e:
            logger.error(f"[JOURNEY] rebuild_journeys failed: {e}")

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
            # Double-exit guard: collect open order_ids for this algo and filter
            # out any that are already being exited by a concurrent SL/TP callback.
            _order_ids_to_exit: list = []
            try:
                async with AsyncSessionLocal() as _guard_db:
                    from sqlalchemy import select as _sel
                    _res = await _guard_db.execute(
                        _sel(Order.id).where(
                            Order.grid_entry_id == grid_entry_id,
                            Order.status == OrderStatus.OPEN,
                        )
                    )
                    _all_ids = [str(r) for r in _res.scalars().all()]
                _order_ids_to_exit = [oid for oid in _all_ids if oid not in self._exiting_orders]
                _already = [oid for oid in _all_ids if oid in self._exiting_orders]
                if _already:
                    logger.info(
                        f"[EXIT GUARD] MTM {reason} — suppressed {len(_already)} order(s) "
                        f"already exiting: {_already}"
                    )
                for oid in _order_ids_to_exit:
                    self._exiting_orders.add(oid)
            except Exception as _guard_err:
                logger.warning(f"[EXIT GUARD] MTM order fetch failed (proceeding anyway): {_guard_err}")
                _order_ids_to_exit = []

            try:
                await self.exit_all(grid_entry_id, reason=reason)
            finally:
                for oid in _order_ids_to_exit:
                    self._exiting_orders.discard(oid)

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
            # Mark ORBRangeState as TRIGGERED
            async def _mark_orb_triggered_task():
                try:
                    from app.models.orb_range_state import ORBRangeState
                    from sqlalchemy import update as _upd
                    import uuid as _uuid_t, pytz as _pytz_t
                    _IST_t = _pytz_t.timezone('Asia/Kolkata')
                    async with AsyncSessionLocal() as _tdb:
                        await _tdb.execute(
                            _upd(ORBRangeState)
                            .where(ORBRangeState.grid_entry_id == _uuid_t.UUID(eid))
                            .where(ORBRangeState.status == 'ARMED')
                            .values(status='TRIGGERED', triggered_at=datetime.now(_IST_t))
                        )
                        await _tdb.commit()
                except Exception as _te:
                    logger.warning(f"[ORB] Failed to mark triggered: {_te}")
            asyncio.create_task(_mark_orb_triggered_task())
            await self.enter(eid, reentry=False)

        return on_orb_entry

    def _make_wt_callback(self, grid_entry_id: str):
        """Returns a callback for WTEvaluator on_entry."""
        async def on_wt_entry(eid: str, entry_price: float):
            logger.info(f"[W&T] Threshold crossed for {eid} @ {entry_price:.2f} — scheduling order")
            # NOTE: do NOT clear _wt_arming_cache here — _place_leg reads it 2s later
            # (APScheduler fires enter() after a DateTrigger delay). Cache is cleared
            # inside _place_leg after reference_price is read.
            # Schedule via APScheduler's AsyncIOExecutor — this is the ONLY safe path.
            # asyncio.create_task() / ensure_future() / run_coroutine_threadsafe() all
            # lack SQLAlchemy's greenlet bridge and cause MissingGreenlet.
            # APScheduler's executor provides the greenlet context automatically.
            from app.engine.scheduler import get_scheduler as _get_sched
            _sched = _get_sched()
            if _sched:
                _sched.schedule_immediate_entry(eid, force_direct=True, force_immediate=True)
            else:
                logger.error(
                    f"[W&T] Scheduler not available for {eid} — entry cannot be placed safely. "
                    f"Check scheduler initialisation order in main.py."
                )

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

    async def register_orb(
        self,
        grid_entry_id: str,
        algo_id: str,
        algo_name: str,
        algo_orb_start_time: Optional[str],
        algo_orb_end_time: Optional[str],
        algo_account_id: Optional[str] = None,
        algo_dte: Optional[int] = None,
    ):
        """
        Register an ORB window at orb_start_time activation.
        Called from scheduler._job_activate_all when entry_type == ORB.

        IMPORTANT: Accepts only plain Python scalar values — NOT ORM objects.
        The caller must extract all needed fields from ORM objects while the
        session is still open, then pass them here as plain Python primitives.
        This prevents MissingGreenlet errors when called via asyncio.ensure_future()
        after the session context has closed.

        ORB tracks the UNDERLYING index token during the window,
        not the option itself. The option is selected at breakout time.
        Underlying is resolved from the first leg (Algo model has no underlying field).
        """
        if not self._orb_tracker:
            return

        # Load first leg to get underlying name — Algo model has no underlying field.
        # New session opened here; safe because this function owns its lifetime.
        async with AsyncSessionLocal() as _db:
            _legs_res = await _db.execute(
                select(AlgoLeg)
                .where(AlgoLeg.algo_id == algo_id)
                .order_by(AlgoLeg.leg_number)
            )
            _legs = _legs_res.scalars().all()
            # Capture all needed leg attributes INSIDE the session as plain Python values
            if _legs:
                _first_underlying    = _legs[0].underlying or "NIFTY"
                _first_instrument    = _legs[0].instrument or "ce"
                _first_expiry        = _legs[0].expiry or "current_weekly"
                _first_strike_type   = _legs[0].strike_type or "atm"
                _first_strike_value  = _legs[0].strike_value
                _first_orb_entry_at  = getattr(_legs[0], 'orb_entry_at', None)
                _first_direction     = _legs[0].direction or "buy"
                _first_orb_src       = getattr(_legs[0], 'orb_range_source', None) or "underlying"
                _first_wt_enabled    = getattr(_legs[0], 'wt_enabled', False) or False
                _first_wt_value      = float(_legs[0].wt_value or 0.0) if _first_wt_enabled else 0.0
                _first_wt_unit       = (_legs[0].wt_unit or "pts") if _first_wt_enabled else "pts"
            else:
                _first_underlying = None

        if not _first_underlying:
            logger.error(f"[ORB] Cannot register — no legs for algo {algo_name} ({algo_id})")
            return

        underlying = _first_underlying.upper()
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
                f"[ORB] Unknown underlying '{underlying}' for algo {algo_name} — "
                f"add to _ORB_UNDERLYING_TOKENS (NSE index) or MCX_TOKENS (MCX futures)"
            )
            return

        # Determine entry direction from orb_entry_at (Phase 2) or leg direction (fallback)
        if _first_orb_entry_at == "high":
            direction = "buy"
        elif _first_orb_entry_at == "low":
            direction = "sell"
        else:
            direction = _first_direction  # backward compat

        # ── ORB Phase 2: instrument range tracking ─────────────────────────────────
        # When orb_range_source == "instrument", pre-select the ATM option at window
        # registration time and track the option LTP during the window instead of
        # the underlying spot. Falls back to underlying if pre-selection fails.
        _orb_range_source = _first_orb_src
        _tracking_token = underlying_token  # default: track underlying index

        # OHLC symbol/exchange defaults — overridden below if instrument pre-selection succeeds
        _ohlc_symbol   = underlying   # e.g. "NIFTY", "BANKNIFTY"
        _ohlc_exchange = "NSE"        # NSE indices; overridden to NFO/BFO for options

        if _orb_range_source == "instrument" and self._strike_selector:
            try:
                # Pre-select strike now so we can subscribe and track its LTP
                _pre_instrument = await self._strike_selector.select(
                    underlying=_first_underlying,
                    instrument_type=_first_instrument,
                    expiry=_first_expiry,
                    strike_type=_first_strike_type,
                    strike_value=_first_strike_value,
                    dte=algo_dte,
                )
                if _pre_instrument:
                    _pre_token = _pre_instrument.get("instrument_token", 0)
                    _pre_symbol = _pre_instrument.get("tradingsymbol", "")
                    if _pre_token and _pre_token > 0:
                        _tracking_token = _pre_token
                        # Override OHLC symbol/exchange with the pre-selected option
                        _ohlc_symbol   = _pre_symbol
                        _ohlc_exchange = _pre_instrument.get("exchange", "NFO")
                        if self._ltp_consumer:
                            self._ltp_consumer.subscribe([_pre_token])
                        logger.info(
                            f"[ORB] Instrument pre-selection succeeded: "
                            f"{_pre_symbol} token={_pre_token} (tracking option LTP for range)"
                        )
                    else:
                        logger.warning(
                            f"[ORB] Instrument pre-selection failed — falling back to underlying. "
                            f"algo={algo_name}"
                        )
                else:
                    logger.warning(
                        f"[ORB] Instrument pre-selection failed — falling back to underlying. "
                        f"algo={algo_name}"
                    )
            except Exception as _orb_pre_err:
                logger.warning(
                    f"[ORB] Instrument pre-selection failed — falling back to underlying. "
                    f"algo={algo_name} error={_orb_pre_err}"
                )
        else:
            if _orb_range_source == "instrument" and not self._strike_selector:
                logger.warning(
                    f"[ORB] Instrument pre-selection failed — falling back to underlying "
                    f"(strike_selector not available). algo={algo_name}"
                )

        # ── Resolve symbol + exchange for OHLC candle fetch ────────────────────
        # _ohlc_symbol / _ohlc_exchange are set above (defaults: underlying/NSE,
        # overridden to option symbol/NFO if instrument pre-selection succeeded).
        today_ist = datetime.now(IST).strftime("%Y-%m-%d")
        _orb_start_str = f"{today_ist} {algo_orb_start_time or '09:15'}"
        _orb_end_str   = f"{today_ist} {algo_orb_end_time or '11:16'}"

        # Resolve broker for OHLC fetch: first available Angel One, else zerodha
        _ohlc_broker = (
            next(iter(self._angel_broker_map.values()), None)
            or self._zerodha_broker
        )

        # entry_at drives candle-close confirmation direction
        _entry_at = _first_orb_entry_at or ("high" if direction == "buy" else "low")

        window = ORBWindow(
            grid_entry_id=str(grid_entry_id),
            algo_id=str(algo_id),
            direction=direction,
            start_time=self._parse_time(algo_orb_start_time or "09:15"),
            end_time=self._parse_time(algo_orb_end_time or "11:16"),
            instrument_token=_tracking_token,
            orb_range_source=_orb_range_source,
            wt_value=_first_wt_value,
            wt_unit=_first_wt_unit,
            symbol=_ohlc_symbol,
            exchange=_ohlc_exchange,
            orb_start_str=_orb_start_str,
            orb_end_str=_orb_end_str,
            entry_at=_entry_at,
        )
        window._broker = _ohlc_broker

        # Persist CAPTURING state to DB — enables restart recovery
        try:
            from app.models.orb_range_state import ORBRangeState
            import uuid as _uuid_orb, pytz as _pytz_orb
            _IST_orb = _pytz_orb.timezone('Asia/Kolkata')
            _orb_state = ORBRangeState(
                grid_entry_id = _uuid_orb.UUID(str(grid_entry_id)),
                algo_id       = _uuid_orb.UUID(str(algo_id)),
                account_id    = _uuid_orb.UUID(str(algo_account_id)) if algo_account_id else None,
                symbol        = _ohlc_symbol,
                symbol_token  = str(_tracking_token),
                exchange      = _ohlc_exchange,
                orb_start_time = algo_orb_start_time or '09:15',
                orb_end_time  = algo_orb_end_time or '11:16',
                entry_at      = _entry_at,
                wt_buffer     = _first_wt_value,
                wt_unit       = _first_wt_unit,
                status        = 'CAPTURING',
                created_at    = datetime.now(IST),
            )
            async with AsyncSessionLocal() as _orb_db:
                _orb_db.add(_orb_state)
                await _orb_db.commit()
            logger.info(f"[ORB] CAPTURING state persisted: {_ohlc_symbol} ge={str(grid_entry_id)[:8]}")
        except Exception as _orb_persist_err:
            logger.warning(f"[ORB] CAPTURING DB persist failed (non-fatal): {_orb_persist_err}")

        self._orb_tracker.register(
            window,
            on_entry=self._make_orb_callback(str(grid_entry_id)),
        )

        # ── Schedule scheduler-driven range freeze at exact orb_end_time ──────
        # Primary freeze path: fires once at the precise end of the ORB window.
        # The tick-driven path in on_tick() is the fallback (is_fetching guard
        # prevents both paths from racing to call _fetch_and_set_range twice).
        try:
            from apscheduler.triggers.date import DateTrigger as _DateTrigger
            from app.engine.scheduler import get_scheduler as _get_sched_orb
            _sched_orb = _get_sched_orb()
            if _sched_orb:
                _end_str   = algo_orb_end_time or "11:16"
                _h, _m     = map(int, _end_str.split(":")[:2])
                _orb_end_dt = datetime.now(IST).replace(
                    hour=_h, minute=_m, second=0, microsecond=0
                )
                _sched_orb._scheduler.add_job(
                    _trigger_orb_freeze,
                    trigger=_DateTrigger(run_date=_orb_end_dt, timezone=IST),
                    args=[str(grid_entry_id)],
                    id=f"orb_freeze_{grid_entry_id}",
                    replace_existing=True,
                    misfire_grace_time=120,
                )
                logger.info(
                    f"[ORB] Freeze job scheduled at {_end_str} IST for {str(grid_entry_id)[:8]}"
                )
            else:
                logger.warning(
                    f"[ORB] Scheduler not available — freeze job not scheduled for "
                    f"{str(grid_entry_id)[:8]}; tick-path fallback active"
                )
        except Exception as _orb_sched_err:
            logger.warning(
                f"[ORB] Failed to schedule freeze job for {str(grid_entry_id)[:8]}: "
                f"{_orb_sched_err} — tick-path fallback active"
            )

        if self._ltp_consumer:
            self._ltp_consumer.subscribe([_tracking_token])
        logger.info(
            f"ORB registered: {algo_name} | underlying={underlying} token={_tracking_token} "
            f"direction={direction} orb_range_source={_orb_range_source} "
            f"window={algo_orb_start_time or '09:15'}–{algo_orb_end_time or '11:16'}"
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
                if not order.sl_actual:
                    continue
                ltp = 0.0
                if self._ltp_consumer and order.instrument_token:
                    ltp = self._ltp_consumer.get_ltp(int(order.instrument_token))
                if not ltp or ltp <= 0:
                    logger.warning(
                        f"[OVERNIGHT-SL] No live LTP for {order.symbol} — "
                        f"skipping (will retry next tick)"
                    )
                    continue
                sl_hit = (
                    ltp <= order.sl_actual if order.direction == "buy"
                    else ltp >= order.sl_actual
                )
                if sl_hit:
                    logger.info(
                        f"🔴 Overnight SL hit: {order.symbol} | "
                        f"ltp={ltp} sl={order.sl_actual}"
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
        from app.engine.lifecycle_manager import check_algo_complete
        await check_algo_complete(grid_entry_id, mtm_monitor=self._mtm_monitor)

    # ── Helpers ───────────────────────────────────────────────────────────────

    @classmethod
    def _resolve_exit_reason(cls, reason: str):
        """Return the ExitReason enum member for a raw reason string."""
        from app.engine.lifecycle_manager import resolve_exit_reason
        return resolve_exit_reason(reason)

    async def _close_order(
        self, db: AsyncSession, order: Order, exit_price: float, reason: str
    ):
        """Update Order to CLOSED in DB and compute P&L."""
        from app.engine.lifecycle_manager import close_order
        await close_order(db, order, exit_price, reason)

    def _compute_pnl(self, order: Order, exit_price: float) -> Optional[float]:
        from app.engine.lifecycle_manager import compute_pnl
        return compute_pnl(order, exit_price)

    async def _set_no_trade(self, db, algo_state, grid_entry, reason, algo_name: str = ""):
        from app.engine.lifecycle_manager import set_no_trade
        await set_no_trade(db, algo_state, grid_entry, reason, algo_name=algo_name)

    async def _set_error(self, db, algo_state, grid_entry, msg, algo_name: str = ""):
        from app.engine.lifecycle_manager import set_error
        await set_error(db, algo_state, grid_entry, msg, algo_name=algo_name)

    async def _set_waiting(self, db, algo_state, grid_entry, msg):
        """Mark algo as WAITING (not ERROR) — used when SmartStream is down for W&T/ORB.
        Algo stays in WAITING state; ticks will fire W&T/ORB once stream connects."""
        from app.engine.lifecycle_manager import set_waiting
        await set_waiting(db, algo_state, grid_entry, msg, sl_tp_monitor=self._sl_tp_monitor)

    async def _mark_error(self, grid_entry_id: str, msg: str):
        from app.engine.lifecycle_manager import mark_error
        await mark_error(grid_entry_id, msg)

    @staticmethod
    def _parse_time(time_str: str):
        """Parse 'HH:MM' into a datetime.time."""
        from datetime import time as dtime
        h, m = map(int, time_str.split(":")[:2])
        return dtime(h, m)

    # ── Lot size lookup ───────────────────────────────────────────────────────

    def _get_underlying_from_symbol(self, symbol: str) -> str:
        """Extract underlying name from a derivative symbol string.
        e.g. BANKNIFTY24APR26540PE → BANKNIFTY, NIFTY24APR2624000CE → NIFTY
        """
        for u in ("BANKNIFTY", "MIDCPNIFTY", "FINNIFTY", "NIFTY", "SENSEX"):
            if symbol.upper().startswith(u):
                return u
        return "NIFTY"

    async def _get_lot_size(self, symbol: str, exchange: str = "NFO") -> int:
        """Return lot size for a derivative symbol.

        Lookup order:
          1. In-memory _lot_size_cache (keyed by EXCHANGE:SYMBOL)
          2. Angel One instrument master (_master_cache, field = 'lotsize')
          3. Hardcoded fallback table (last resort — never silently wrong for known underlyings)

        Cache is cleared at midnight by the daily reset job.
        """
        cache_key = f"{exchange}:{symbol}"
        if cache_key in self._lot_size_cache:
            return self._lot_size_cache[cache_key]

        # Angel One instrument master — already in-memory after first download
        try:
            from app.brokers.angelone import AngelOneBroker
            master: list = AngelOneBroker._master_cache or []
            for item in master:
                if item.get("symbol") == symbol:
                    lot_size = int(item.get("lotsize", 1))
                    if lot_size > 1:  # sanity — master can have 1 for expired contracts
                        self._lot_size_cache[cache_key] = lot_size
                        return lot_size
        except Exception as _e:
            logger.warning(f"[LOT SIZE] Master lookup failed for {symbol}: {_e}")

        # Fallback — derive from underlying name in the symbol string
        underlying = self._get_underlying_from_symbol(symbol)
        fallback = {
            "NIFTY":       75,
            "BANKNIFTY":   35,
            "SENSEX":      20,
            "MIDCPNIFTY":  120,
            "FINNIFTY":    65,
        }.get(underlying, 1)
        self._lot_size_cache[cache_key] = fallback
        logger.warning(
            f"[LOT SIZE] Master miss for {symbol} — using fallback {fallback} "
            f"(underlying={underlying})"
        )
        return fallback

    # ── P1: Runtime State Reconciler ─────────────────────────────────────────

    async def _reconcile_state(self) -> None:
        """
        P1: Every 60s during market hours — reconcile DB open orders vs runtime monitor.

        For every Order with status=OPEN in DB:
          - If not in SLTPMonitor._positions → re-register via restore_sl_monitoring()
          - Log: [RECONCILER] Re-registered {symbol} for monitor — was missing

        For every position in SLTPMonitor._positions:
          - If DB order is CLOSED/ERROR → deregister from monitor
          - Log: [RECONCILER] Deregistered {symbol} — DB status is {status}

        Only runs during market hours (09:00–15:35 IST). Guard already enforced by scheduler.
        """
        now_ist = datetime.now(IST)
        _hour_float = now_ist.hour + now_ist.minute / 60.0
        if not (9.0 <= _hour_float < 15.6):
            return

        n_open = 0
        n_registered = 0
        n_fixed = 0

        try:
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(Order).where(Order.status == OrderStatus.OPEN)
                )
                open_orders = result.scalars().all()

                # Only process orders from today — ignore overnight/stale rows
                today = date.today()
                open_orders = [
                    o for o in open_orders
                    if o.fill_time is not None and o.fill_time.date() >= today
                ]
                n_open = len(open_orders)

                # ── Check: DB OPEN orders missing from monitor ────────────────
                re_registered: list = []
                if self._sl_tp_monitor:
                    monitored_ids = set(self._sl_tp_monitor._positions.keys())
                    n_registered = len(monitored_ids)

                    for order in open_orders:
                        oid = str(order.id)
                        if oid not in monitored_ids:
                            # Skip if no SL configured — BUY/non-SL orders don't need SLTPMonitor
                            has_sl = order.sl_type or order.sl_original
                            if not has_sl:
                                continue
                            # Real problem — has SL but missing from monitor
                            re_registered.append(order.symbol)
                            n_fixed += 1

                    # ── Check: monitor has positions not OPEN in DB ───────────
                    db_open_ids = {str(o.id) for o in open_orders}
                    stale_ids = monitored_ids - db_open_ids
                    for stale_id in stale_ids:
                        pm = self._sl_tp_monitor._positions.get(stale_id)
                        sym = pm.symbol if pm else stale_id
                        logger.warning(
                            f"[RECONCILER] {sym} (order {stale_id}) is in SLTPMonitor "
                            f"but NOT OPEN in DB — deregistering"
                        )
                        self._sl_tp_monitor.remove_position(stale_id)
                        n_fixed += 1

                    if re_registered:
                        await _ev.log(
                            "warn",
                            f"Re-registered {len(re_registered)} orders: {', '.join(re_registered)}",
                            source="reconciler",
                        )

            self._reconciler_last_run = datetime.now(IST)
            logger.info(
                f"[RECONCILER] State check: {n_open} DB open, {n_registered} monitored, "
                f"{n_fixed} resynced"
            )
            # Trigger full SL monitoring restore if any were missing
            if n_fixed > 0:
                await self.restore_sl_monitoring()

        except Exception as e:
            logger.error(f"[RECONCILER] State reconciliation failed: {e}", exc_info=True)

    # ── P3: Callback latency property ────────────────────────────────────────

    @property
    def _callback_latency(self) -> dict:
        """P3: Returns avg callback latencies from LTPConsumer (for /system/health)."""
        if self._ltp_consumer and hasattr(self._ltp_consumer, "get_callback_latencies"):
            return self._ltp_consumer.get_callback_latencies()
        return {}


# ── Singleton ─────────────────────────────────────────────────────────────────
algo_runner = AlgoRunner()
