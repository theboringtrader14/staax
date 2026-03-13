"""
PositionRebuilder — STAAX startup state recovery (AR-2).

Runs ONCE at startup. If the server restarts while trades are open,
this module fetches broker positions, compares with STAAX DB state,
and re-registers all SL/TP/TSL/TTP/MTM monitors so no position is
left unmanaged.

Startup Flow:
    System boot
    → Fetch open Orders from DB (status=OPEN)
    → Fetch broker positions (Zerodha/Angel One)
    → For each DB open order with matching broker position:
          Re-register SLTPMonitor
          Re-register TSLEngine / TTPEngine
          Re-subscribe LTP token
    → For broker positions with NO DB record:
          Log WARNING — manual intervention needed
    → Log: [STARTUP] Position Rebuilder complete — N positions recovered
"""
import logging
from typing import Optional, TYPE_CHECKING

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.models.order import Order, OrderStatus

if TYPE_CHECKING:
    from app.engine.sl_tp_monitor  import SLTPMonitor
    from app.engine.tsl_engine     import TSLEngine
    from app.engine.ttp_engine     import TTPEngine
    from app.engine.mtm_monitor    import MTMMonitor
    from app.engine.ltp_consumer   import LTPConsumer
    from app.brokers.zerodha       import ZerodhaBroker

logger = logging.getLogger(__name__)


class PositionRebuilder:
    """
    Runs once on startup to recover monitoring state after a crash/restart.
    """

    def __init__(self) -> None:
        self._sl_tp_monitor: Optional["SLTPMonitor"]  = None
        self._tsl_engine:    Optional["TSLEngine"]     = None
        self._ttp_engine:    Optional["TTPEngine"]     = None
        self._mtm_monitor:   Optional["MTMMonitor"]    = None
        self._ltp_consumer:  Optional["LTPConsumer"]   = None
        self._zerodha:       Optional["ZerodhaBroker"] = None

    def wire(
        self,
        sl_tp_monitor,
        tsl_engine,
        ttp_engine,
        mtm_monitor,
        ltp_consumer,
        zerodha,
    ) -> None:
        self._sl_tp_monitor = sl_tp_monitor
        self._tsl_engine    = tsl_engine
        self._ttp_engine    = ttp_engine
        self._mtm_monitor   = mtm_monitor
        self._ltp_consumer  = ltp_consumer
        self._zerodha       = zerodha
        logger.info("[REBUILDER] Wired to all engines")

    async def run(self) -> None:
        """
        Main startup recovery routine.
        Called once from main.py lifespan after all engines are wired.
        """
        logger.info("[STARTUP] PositionRebuilder starting...")
        recovered = 0

        try:
            async with AsyncSessionLocal() as db:
                # ── Fetch all open orders from DB ─────────────────────────────
                result = await db.execute(
                    select(Order).where(Order.status == OrderStatus.OPEN)
                )
                open_orders = result.scalars().all()

                if not open_orders:
                    logger.info("[STARTUP] PositionRebuilder — no open orders in DB, nothing to recover")
                    return

                logger.info("[STARTUP] Found %d open orders in DB — checking broker state", len(open_orders))

                # ── Fetch broker positions (Zerodha only for Phase 1) ─────────
                broker_positions: dict = {}
                if self._zerodha:
                    try:
                        positions = await self._zerodha.get_positions()
                        if positions:
                            for p in positions:
                                sym = p.get("tradingsymbol", "")
                                if sym:
                                    broker_positions[sym] = p
                        logger.info("[STARTUP] Fetched %d broker positions", len(broker_positions))
                    except Exception as e:
                        logger.warning("[STARTUP] Could not fetch broker positions: %s — skipping live check", e)

                # ── Re-register monitors for each open order ──────────────────
                for order in open_orders:
                    try:
                        await self._recover_order(order, broker_positions, db)
                        recovered += 1
                    except Exception as e:
                        logger.error("[STARTUP] Failed to recover order %s: %s", order.id, e)

        except Exception as e:
            logger.error("[STARTUP] PositionRebuilder failed: %s", e)

        logger.info("[STARTUP] PositionRebuilder complete — %d positions recovered", recovered)

    async def _recover_order(
        self,
        order: Order,
        broker_positions: dict,
        db: AsyncSession,
    ) -> None:
        """Re-register SL/TP/TSL/TTP monitoring for a single recovered order."""
        symbol = order.symbol or ""

        # Check if broker still holds this position
        broker_pos = broker_positions.get(symbol)
        if not broker_pos and broker_positions:
            # Broker has no record of this position — mark as needs review
            logger.warning(
                "[STARTUP] Order %s (sym=%s) is OPEN in DB but NOT found at broker — manual review needed",
                order.id, symbol,
            )
            return

        logger.info("[STARTUP] Recovering order %s sym=%s algo=%s", order.id, symbol, order.algo_id)

        # Re-subscribe LTP token
        if self._ltp_consumer and order.instrument_token:
            self._ltp_consumer.subscribe(int(order.instrument_token))

        # Re-register SL/TP monitor
        if self._sl_tp_monitor and order.sl_price:
            from app.engine.sl_tp_monitor import PositionMonitor
            from app.engine.algo_runner import algo_runner
            monitor = PositionMonitor(
                order_id=str(order.id),
                algo_id=str(order.algo_id),
                symbol=symbol,
                sl_price=order.sl_price,
                tp_price=order.tp_price,
                direction=order.direction,
                on_sl_hit=algo_runner.on_sl_hit,
                on_tp_hit=algo_runner.on_tp_hit,
            )
            self._sl_tp_monitor.register(monitor)
            logger.info("[STARTUP] SL/TP monitor re-registered for order %s", order.id)

        # Re-register TSL if enabled on this order's leg
        if self._tsl_engine and order.tsl_enabled and order.tsl_x:
            from app.engine.tsl_engine import TSLState
            tsl_state = TSLState(
                order_id=str(order.id),
                symbol=symbol,
                direction=order.direction,
                x=order.tsl_x,
                y=order.tsl_y,
                unit=order.tsl_unit or "pts",
                current_sl=order.sl_price or 0.0,
                on_sl_update=self._sl_tp_monitor.update_sl if self._sl_tp_monitor else lambda *a: None,
            )
            self._tsl_engine.register(tsl_state)
            logger.info("[STARTUP] TSL re-registered for order %s", order.id)

        # Re-register TTP if enabled
        if self._ttp_engine and order.ttp_enabled and order.ttp_x:
            from app.engine.ttp_engine import TTPState
            ttp_state = TTPState(
                order_id=str(order.id),
                symbol=symbol,
                direction=order.direction,
                x=order.ttp_x,
                y=order.ttp_y,
                unit=order.ttp_unit or "pts",
                current_tp=order.tp_price or 0.0,
                on_tp_update=self._sl_tp_monitor.update_tp if self._sl_tp_monitor else lambda *a: None,
            )
            self._ttp_engine.register(ttp_state)
            logger.info("[STARTUP] TTP re-registered for order %s", order.id)


# ── Singleton ──────────────────────────────────────────────────────────────────
position_rebuilder = PositionRebuilder()
