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
from typing import Optional, List
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from app.core.database import AsyncSessionLocal
from app.models.grid import GridEntry, GridStatus
from app.models.algo import Algo, AlgoLeg, StrategyMode, EntryType
from app.models.algo_state import AlgoState, AlgoRunStatus
from app.models.order import Order, OrderStatus

from app.engine.strike_selector import StrikeSelector
from app.engine.order_placer import OrderPlacer
from app.engine.sl_tp_monitor import SLTPMonitor, PositionMonitor
from app.engine.tsl_engine import TSLEngine, TSLState
from app.engine.ttp_engine import TTPEngine, TTPState
from app.engine.journey_engine import JourneyEngine
from app.engine.mtm_monitor import MTMMonitor, AlgoMTMState
from app.engine.wt_evaluator import WTEvaluator, WTWindow
from app.engine.orb_tracker import ORBTracker, ORBWindow
from app.engine.reentry_engine import ReentryEngine
from app.engine.ltp_consumer import LTPConsumer

IST = ZoneInfo("Asia/Kolkata")
logger = logging.getLogger(__name__)


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

    def wire_engines(
        self,
        strike_selector: StrikeSelector,
        order_placer:    OrderPlacer,
        sl_tp_monitor:   SLTPMonitor,
        tsl_engine:      TSLEngine,
        ttp_engine:      TTPEngine,
        journey_engine:  JourneyEngine,
        mtm_monitor:     MTMMonitor,
        wt_evaluator:    WTEvaluator,
        orb_tracker:     ORBTracker,
        reentry_engine:  ReentryEngine,
        ltp_consumer:    LTPConsumer,
        ws_manager,
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
        logger.info("✅ AlgoRunner engines wired")

    # ── Entry ─────────────────────────────────────────────────────────────────

    async def enter(
        self,
        grid_entry_id: str,
        reentry:       bool = False,
        original_order: Optional[Order] = None,
    ):
        """
        Main entry point — executes all legs for a grid entry.
        Called by:
          - Scheduler._job_entry  (Direct algos)
          - on_orb_entry callback (ORB algos)
          - on_wt_entry callback  (W&T algos)
          - ReentryEngine._trigger_reentry (re-entries)
        """
        async with AsyncSessionLocal() as db:
            try:
                await self._enter_with_db(db, grid_entry_id, reentry, original_order)
            except Exception as e:
                logger.error(f"AlgoRunner.enter failed for {grid_entry_id}: {e}")
                await self._mark_error(grid_entry_id, str(e))

    async def _enter_with_db(
        self,
        db: AsyncSession,
        grid_entry_id: str,
        reentry: bool,
        original_order: Optional[Order],
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
            logger.error(f"No legs for algo {algo.id}")
            await self._set_no_trade(db, algo_state, grid_entry, "no_legs")
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
        entry_error = False

        for leg in legs:
            try:
                order = await self._place_leg(
                    db, leg, algo, algo_state, grid_entry, reentry, original_order
                )
                if order:
                    placed_orders.append(order)
            except Exception as e:
                logger.error(f"Leg {leg.leg_number} entry failed: {e}")
                entry_error = True

                if algo.exit_on_entry_failure:
                    logger.warning(
                        f"on_entry_fail=exit_all — squaring off {len(placed_orders)} placed legs"
                    )
                    for placed in placed_orders:
                        await self._close_order(db, placed, placed.ltp or 0.0, "entry_fail")
                    await self._set_error(
                        db, algo_state, grid_entry, f"Leg {leg.leg_number} failed: {e}"
                    )
                    await db.commit()
                    return

        # ── 7. Update MTM combined premium ─────────────────────────────────────
        if self._mtm_monitor and placed_orders:
            cp = sum(o.fill_price or 0.0 for o in placed_orders)
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
        if self._ws_manager:
            for order in placed_orders:
                await self._ws_manager.notify_trade(
                    algo_name=algo.name,
                    symbol=order.symbol,
                    direction=order.direction,
                    fill_price=order.fill_price or 0.0,
                    lots=order.lots,
                )
            await self._ws_manager.broadcast_algo_status(
                algo_id=str(algo.id),
                grid_entry_id=grid_entry_id,
                status="active",
                reason="entry_complete",
            )

        logger.info(
            f"✅ Entry complete: {algo.name} | {len(placed_orders)} orders placed"
        )

    async def _place_leg(
        self,
        db:             AsyncSession,
        leg:            AlgoLeg,
        algo:           Algo,
        algo_state:     AlgoState,
        grid_entry:     GridEntry,
        reentry:        bool,
        original_order: Optional[Order],
    ) -> Optional[Order]:
        """
        Resolve strike, apply W&T/delay, place order, register monitors.
        Returns the created Order or None if deferred to a trigger (W&T / ORB).
        """
        direction = leg.direction  # "buy" or "sell"
        is_overnight = algo.strategy_mode in (StrategyMode.BTST, StrategyMode.STBT)

        # ── W&T: register watcher and defer — order placed when threshold hits ─
        if leg.wt_enabled and leg.wt_value and not reentry:
            if self._wt_evaluator and leg.instrument_token:
                window = WTWindow(
                    grid_entry_id=str(grid_entry.id),
                    algo_id=str(algo.id),
                    direction=leg.wt_direction or "up",
                    entry_time=self._parse_time(algo.entry_time or "09:16"),
                    instrument_token=leg.instrument_token,
                    wt_value=leg.wt_value,
                    wt_unit=leg.wt_unit or "pts",
                )
                self._wt_evaluator.register(
                    window,
                    on_entry=self._make_wt_callback(str(grid_entry.id)),
                )
                logger.info(f"W&T registered for leg {leg.leg_number}: {algo.name}")
            return None  # deferred — order placed when W&T fires

        # ── Strike selection ───────────────────────────────────────────────────
        instrument = None
        if leg.instrument == "fu":
            # Futures — use underlying directly
            symbol        = f"{leg.underlying}FUT"
            instrument_token = leg.instrument_token or 0
            ltp           = 0.0
        else:
            # Options
            if reentry and original_order and leg.reentry_mode in ("at_entry_price", "at_cost"):
                # Same strike/expiry as original for these modes
                symbol           = original_order.symbol
                instrument_token = original_order.instrument_token or 0
                ltp              = original_order.fill_price or 0.0
            else:
                if self._strike_selector:
                    instrument = await self._strike_selector.select(
                        underlying=leg.underlying,
                        instrument_type=leg.instrument,  # "ce" or "pe"
                        expiry=leg.expiry or "current_weekly",
                        strike_type=leg.strike_type or "atm",
                        strike_value=leg.strike_value,
                    )
                if not instrument:
                    raise ValueError(
                        f"Strike selection failed for leg {leg.leg_number}: "
                        f"{leg.underlying} {leg.instrument} {leg.strike_type}"
                    )
                symbol           = instrument.get("tradingsymbol", "")
                instrument_token = instrument.get("instrument_token", 0)
                ltp              = instrument.get("last_price", 0.0)

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
        quantity = leg.lots * lot_size * grid_entry.lot_multiplier

        # ── Place order ────────────────────────────────────────────────────────
        idempotency_key = f"{grid_entry.id}:{leg.id}:{algo_state.reentry_count}"
        order_id_str    = await self._order_placer.place(
            idempotency_key=idempotency_key,
            algo_id=str(algo.id),
            symbol=symbol,
            exchange="NFO",
            direction=direction,
            quantity=quantity,
            order_type=algo.order_type or "market",
            ltp=ltp,
            is_practix=grid_entry.is_practix,
            is_overnight=is_overnight,
        )

        if not order_id_str:
            logger.warning(f"Duplicate order blocked: {idempotency_key}")
            return None

        fill_price = ltp  # MARKET fill at LTP; LIMIT would use limit_price

        # ── Persist Order to DB ────────────────────────────────────────────────
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
            algo_name=algo.name,
            account_nickname=str(algo.account_id),  # resolved by AccountService
            symbol=symbol,
            exchange="NFO",
            direction=direction,
            lots=leg.lots * grid_entry.lot_multiplier,
            quantity=quantity,
            instrument_token=instrument_token,
            is_practix=grid_entry.is_practix,
            is_overnight=is_overnight,
            entry_type=algo.entry_type,
            fill_price=fill_price,
            fill_time=datetime.now(IST).isoformat(),
            ltp=fill_price,
            status=OrderStatus.OPEN,
            journey_level=journey_level,
        )

        # SL/TP stored on order for display
        order.sl_original = leg.sl_value
        order.sl_actual   = leg.sl_value
        order.target      = leg.tp_value
        db.add(order)
        await db.flush()  # get order.id before registering monitors

        # ── Subscribe LTP ──────────────────────────────────────────────────────
        if self._ltp_consumer and instrument_token:
            self._ltp_consumer.subscribe([instrument_token])

        # ── Register SL/TP monitor ─────────────────────────────────────────────
        if self._sl_tp_monitor and (leg.sl_type or leg.tp_type):
            underlying_token = getattr(leg, "underlying_token", 0) or 0
            pos_monitor = PositionMonitor(
                order_id=str(order.id),
                grid_entry_id=str(grid_entry.id),
                algo_id=str(algo.id),
                direction=direction,
                instrument_token=instrument_token,
                underlying_token=underlying_token,
                entry_price=fill_price,
                sl_type=leg.sl_type,
                sl_value=leg.sl_value,
                tp_type=leg.tp_type,
                tp_value=leg.tp_value,
            )
            self._sl_tp_monitor.add_position(
                pos_monitor,
                on_sl=self._make_sl_callback(),
                on_tp=self._make_tp_callback(),
            )

        # ── Register TSL ───────────────────────────────────────────────────────
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

        # ── Register TTP ───────────────────────────────────────────────────────
        ttp_enabled = getattr(leg, "ttp_enabled", False) or (leg.ttp_x and leg.ttp_y and leg.tp_value)
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
                logger.error(f"exit_all failed for {grid_entry_id}: {e}")

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

        for order in orders:
            try:
                # Get current LTP
                ltp = order.ltp or order.fill_price or 0.0

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

                # Place closing order (opposite direction)
                close_dir = "sell" if order.direction == "buy" else "buy"
                await self._order_placer.place(
                    idempotency_key=f"exit:{order.id}:{reason}",
                    algo_id=str(order.algo_id),
                    symbol=order.symbol,
                    exchange=order.exchange or "NFO",
                    direction=close_dir,
                    quantity=order.quantity,
                    order_type="market",
                    ltp=ltp,
                    is_practix=order.is_practix,
                    is_overnight=False,  # exit is always intraday
                )

                # F9 — cancel broker SL orders
                if cancel_broker_sl and not order.is_practix and self._order_placer:
                    await self._cancel_broker_sl(order)

                await self._close_order(db, order, ltp, reason)

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

        # Notify WebSocket
        if self._ws_manager and algo:
            await self._ws_manager.broadcast_algo_status(
                algo_id=str(algo.id),
                grid_entry_id=grid_entry_id,
                status=reason,
                reason=reason,
            )

    # ── F9: Cancel broker SL orders ───────────────────────────────────────────

    async def _cancel_broker_sl(self, order: Order):
        """
        F9 — Cancel any pending SL orders at the broker for this position.
        Zerodha places SL orders as LIMIT orders with trigger price.
        We look up open SL orders by tag (order.id) and cancel them.
        """
        try:
            broker_sl_order_id = getattr(order, "broker_sl_order_id", None)
            if broker_sl_order_id and self._order_placer:
                await self._order_placer.zerodha.cancel_order(broker_sl_order_id)
                logger.info(f"✅ F9: Broker SL order cancelled: {broker_sl_order_id}")
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

                    await db.commit()

                    # Notify WebSocket
                    if self._ws_manager:
                        await self._ws_manager.notify_sl_hit(
                            algo_name=order.algo_name or "",
                            symbol=order.symbol,
                            exit_price=ltp,
                            pnl=order.pnl or 0.0,
                        )
                        await self._ws_manager.broadcast_order_update(
                            order_id=str(order.id),
                            update={"status": "closed", "exit_reason": "sl", "exit_price": ltp},
                        )

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
                    if self._tsl_engine:
                        self._tsl_engine.deregister(order_id)
                    if self._ttp_engine:
                        self._ttp_engine.deregister(order_id)

                    # Journey: fire child leg before commit
                    if self._journey_engine and order:
                        await self._journey_engine.on_exit(db, order, "tp", self)

                    await db.commit()

                    if self._ws_manager:
                        await self._ws_manager.notify_tp_hit(
                            algo_name=order.algo_name or "",
                            symbol=order.symbol,
                            exit_price=ltp,
                            pnl=order.pnl or 0.0,
                        )

                    if self._reentry_engine:
                        tsl_trailed = (
                            self._tsl_engine.has_trailed(order_id)
                            if self._tsl_engine else False
                        )
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
            if self._ws_manager:
                await self._ws_manager.notify_mtm_breach(
                    algo_name=algo_id,
                    breach_type=reason,
                    current_pnl=total_pnl,
                    limit=0.0,
                )
            await self.exit_all(grid_entry_id, reason=reason)

        return on_mtm_breach

    # ── ORB / W&T callbacks ───────────────────────────────────────────────────

    def _make_orb_callback(self, grid_entry_id: str):
        """Returns a callback for ORBTracker on_entry."""
        async def on_orb_entry(eid: str, entry_price: float):
            logger.info(f"ORB triggered for {eid} @ {entry_price}")
            await self.enter(eid, reentry=False)

        return on_orb_entry

    def _make_wt_callback(self, grid_entry_id: str):
        """Returns a callback for WTEvaluator on_entry."""
        async def on_wt_entry(eid: str, entry_price: float):
            logger.info(f"W&T triggered for {eid} @ {entry_price}")
            await self.enter(eid, reentry=False)

        return on_wt_entry

    # ── ORB Registration (called from Scheduler._job_activate_all) ───────────

    async def register_orb(self, grid_entry_id: str, algo: Algo, grid_entry):
        """
        Register an ORB window at 09:15 activation.
        Called from scheduler._job_activate_all when entry_type == ORB.

        ORB tracks the UNDERLYING index token during the window,
        not the option itself. The option is selected at breakout time.
        The underlying token must already be subscribed via LTPConsumer.
        """
        if not self._orb_tracker:
            return

        underlying_token = getattr(algo, "underlying_token", 0) or 0
        window = ORBWindow(
            grid_entry_id=str(grid_entry_id),
            algo_id=str(algo.id),
            direction=algo.default_direction or "buy",
            start_time=self._parse_time("09:15"),
            end_time=self._parse_time(algo.orb_end_time or "11:16"),
            instrument_token=underlying_token,
            wt_value=0.0,   # ORB uses range breakout, not W&T buffer
            wt_unit="pts",
        )
        self._orb_tracker.register(
            window,
            on_entry=self._make_orb_callback(str(grid_entry_id)),
        )
        if self._ltp_consumer and underlying_token:
            self._ltp_consumer.subscribe([underlying_token])
        logger.info(f"ORB registered: {algo.name} | window closes {algo.orb_end_time}")

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

    # ── Helpers ───────────────────────────────────────────────────────────────

    async def _close_order(
        self, db: AsyncSession, order: Order, exit_price: float, reason: str
    ):
        """Update Order to CLOSED in DB and compute P&L."""
        order.status       = OrderStatus.CLOSED
        order.exit_price   = exit_price
        order.exit_time    = datetime.now(IST).isoformat()
        order.exit_reason  = reason
        order.pnl          = self._compute_pnl(order, exit_price)

    def _compute_pnl(self, order: Order, exit_price: float) -> float:
        if not order.fill_price:
            return 0.0
        qty = order.quantity or 0
        if order.direction == "buy":
            return (exit_price - order.fill_price) * qty
        else:
            return (order.fill_price - exit_price) * qty

    async def _set_no_trade(self, db, algo_state, grid_entry, reason):
        algo_state.status  = AlgoRunStatus.NO_TRADE
        algo_state.exit_reason = reason
        grid_entry.status  = GridStatus.NO_TRADE
        await db.commit()

    async def _set_error(self, db, algo_state, grid_entry, msg):
        algo_state.status        = AlgoRunStatus.ERROR
        algo_state.error_message = msg
        grid_entry.status        = GridStatus.ERROR
        await db.commit()
        if self._ws_manager:
            await self._ws_manager.notify_error(
                algo_name=getattr(algo_state, "algo_id", ""),
                error=msg,
            )

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
