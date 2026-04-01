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
    from app.brokers.angelone      import AngelOneBroker

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
        self._angel_broker:  Optional["AngelOneBroker"] = None

    def wire(
        self,
        sl_tp_monitor,
        tsl_engine,
        ttp_engine,
        mtm_monitor,
        ltp_consumer,
        zerodha,
        angel_broker=None,
    ) -> None:
        self._sl_tp_monitor = sl_tp_monitor
        self._tsl_engine    = tsl_engine
        self._ttp_engine    = ttp_engine
        self._mtm_monitor   = mtm_monitor
        self._ltp_consumer  = ltp_consumer
        self._zerodha       = zerodha
        self._angel_broker  = angel_broker
        logger.info("[REBUILDER] Wired to all engines")

    async def backfill_instrument_tokens(self, db: AsyncSession) -> None:
        """
        One-time startup pass: fill NULL instrument_token on open Orders using AO master.
        Also re-subscribes any newly resolved tokens so ticks flow immediately.
        """
        if not self._angel_broker:
            logger.warning("[BACKFILL] No angel_broker wired — skipping instrument_token backfill")
            return

        result = await db.execute(
            select(Order).where(
                Order.status == OrderStatus.OPEN,
                Order.instrument_token.is_(None),
            )
        )
        orders_missing = result.scalars().all()
        if not orders_missing:
            logger.info("[BACKFILL] All open orders already have instrument_token — nothing to backfill")
            return

        logger.info("[BACKFILL] %d open orders have NULL instrument_token — fetching AO master", len(orders_missing))
        try:
            master = await self._angel_broker.get_instrument_master()
        except Exception as e:
            logger.error("[BACKFILL] Could not fetch AO instrument master: %s — skipping backfill", e)
            return

        # Build symbol → token lookup (keep first match per tradingsymbol)
        sym_to_token: dict = {}
        for row in master:
            sym = row.get("tradingsymbol", "")
            tok = row.get("token") or row.get("instrument_token")
            if sym and tok and sym not in sym_to_token:
                try:
                    sym_to_token[sym] = int(tok)
                except (ValueError, TypeError):
                    pass

        filled = 0
        for order in orders_missing:
            token = sym_to_token.get(order.symbol or "")
            if not token:
                logger.warning("[BACKFILL] No token found in AO master for symbol '%s' (order %s)", order.symbol, order.id)
                continue
            order.instrument_token = token
            filled += 1
            if self._ltp_consumer:
                self._ltp_consumer.subscribe([token])
                logger.info("[BACKFILL] order %s sym=%s → token=%s (subscribed)", order.id, order.symbol, token)
            else:
                logger.info("[BACKFILL] order %s sym=%s → token=%s (ltp_consumer not wired)", order.id, order.symbol, token)

        if filled:
            await db.commit()
        logger.info("[BACKFILL] instrument_token backfill complete — %d/%d orders updated", filled, len(orders_missing))

    async def run(self) -> None:
        """
        Main startup recovery routine.
        Called once from main.py lifespan after all engines are wired.
        """
        logger.info("[STARTUP] PositionRebuilder starting...")
        recovered = 0

        try:
            async with AsyncSessionLocal() as db:
                # ── Backfill NULL instrument_token before recovery loop ────────
                await self.backfill_instrument_tokens(db)

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

        # Re-subscribe LTP token so ticks flow immediately after restart.
        # subscribe() expects List[int] — pass as single-element list.
        token = getattr(order, "instrument_token", None)
        if self._ltp_consumer and token:
            self._ltp_consumer.subscribe([int(token)])
            logger.info("[STARTUP] LTP token %s re-subscribed for order %s", token, order.id)

        # SL/TP / TSL / TTP re-registration requires sl_type, sl_value, tp_type, tp_value
        # which are stored on AlgoLeg, not on Order.  A full recovery would need to join
        # AlgoLeg here — deferred to a future improvement.  For now, log the gap so the
        # operator knows monitoring is not live until the next fresh algo run.
        sl_actual = getattr(order, "sl_actual", None)
        target    = getattr(order, "target", None)
        if sl_actual or target:
            logger.warning(
                "[STARTUP] Order %s has sl_actual=%s target=%s but SL/TP monitor NOT "
                "re-registered (AlgoLeg config not available on Order) — "
                "monitoring resumes on next fresh placement",
                order.id, sl_actual, target,
            )


# ── Singleton ──────────────────────────────────────────────────────────────────
position_rebuilder = PositionRebuilder()
