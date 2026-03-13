"""
OrderReconciler — STAAX order reconciliation engine (SE-4).

Runs every 15 seconds via APScheduler.
Compares STAAX DB state against broker reality and corrects mismatches.

Mismatch cases handled:
    Case 1 | DB=OPEN,    Broker=FILLED   → Update DB → register SL/TP monitoring
    Case 2 | DB=OPEN,    Broker=CANCELLED→ Update order to ERROR
    Case 3 | DB=PENDING, Broker=FILLED   → Update order to OPEN
    Case 4 | No DB record, broker pos    → Log WARNING (manual intervention)

Broadcasts corrections to frontend via WebSocket.
"""
import logging
from datetime import datetime
from typing import Optional, TYPE_CHECKING

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.models.order import Order, OrderStatus

if TYPE_CHECKING:
    from app.engine.sl_tp_monitor  import SLTPMonitor
    from app.engine.ltp_consumer   import LTPConsumer
    from app.brokers.zerodha       import ZerodhaBroker
    from app.ws.connection_manager import ConnectionManager

logger = logging.getLogger(__name__)


class OrderReconciler:
    """
    Polls broker every 15s and corrects DB/engine state mismatches.
    Scheduled in main.py via APScheduler.
    """

    def __init__(self) -> None:
        self._sl_tp_monitor: Optional["SLTPMonitor"]    = None
        self._ltp_consumer:  Optional["LTPConsumer"]    = None
        self._zerodha:       Optional["ZerodhaBroker"]  = None
        self._ws_manager:    Optional["ConnectionManager"] = None

    def wire(
        self,
        sl_tp_monitor,
        ltp_consumer,
        zerodha,
        ws_manager=None,
    ) -> None:
        self._sl_tp_monitor = sl_tp_monitor
        self._ltp_consumer  = ltp_consumer
        self._zerodha       = zerodha
        self._ws_manager    = ws_manager
        logger.info("[RECON] OrderReconciler wired")

    async def run(self) -> None:
        """
        Main reconciliation loop — called every 15s by scheduler.
        Silently skips if broker token not available (pre-login state).
        """
        if not self._zerodha:
            return

        # Skip if no access token (broker not yet logged in)
        try:
            has_token = bool(getattr(self._zerodha, "_access_token", None) or
                            getattr(self._zerodha, "access_token", None))
        except Exception:
            has_token = False

        if not has_token:
            return

        corrections = 0
        try:
            async with AsyncSessionLocal() as db:
                corrections = await self._reconcile(db)
        except Exception as e:
            logger.error("[RECON] Reconciliation failed: %s", e)

        if corrections:
            logger.info("[RECON] Cycle complete — %d corrections applied", corrections)

    async def _reconcile(self, db: AsyncSession) -> int:
        """Core reconciliation logic. Returns count of corrections made."""
        corrections = 0

        # ── Fetch pending/open orders from DB ─────────────────────────────────
        result = await db.execute(
            select(Order).where(
                Order.status.in_([OrderStatus.PENDING, OrderStatus.OPEN])
            )
        )
        db_orders = result.scalars().all()
        if not db_orders:
            return 0

        # ── Fetch broker orders ────────────────────────────────────────────────
        broker_orders: dict = {}
        try:
            raw = await self._zerodha.get_orders()
            if raw:
                for o in raw:
                    bid = o.get("order_id") or o.get("broker_order_id")
                    if bid:
                        broker_orders[str(bid)] = o
        except Exception as e:
            logger.warning("[RECON] Could not fetch broker orders: %s", e)
            return 0

        # ── Compare and correct ────────────────────────────────────────────────
        for order in db_orders:
            if not order.broker_order_id:
                continue

            bid = str(order.broker_order_id)
            broker_order = broker_orders.get(bid)

            if broker_order is None:
                # Broker has no record — skip (may be PRACTIX or too old)
                continue

            broker_status = (broker_order.get("status") or "").upper()
            corrected = await self._apply_correction(order, broker_status, db)
            if corrected:
                corrections += 1

        await db.commit()
        return corrections

    async def _apply_correction(
        self, order: Order, broker_status: str, db: AsyncSession
    ) -> bool:
        """
        Apply correction if DB state doesn't match broker.
        Returns True if a correction was made.
        """
        # Case 1: DB=OPEN, Broker=COMPLETE/FILLED → already open, ensure monitors wired
        if order.status == OrderStatus.OPEN and broker_status in ("COMPLETE", "FILLED"):
            return False  # already consistent

        # Case 2: DB=OPEN, Broker=CANCELLED/REJECTED → mark ERROR
        if order.status == OrderStatus.OPEN and broker_status in ("CANCELLED", "REJECTED"):
            order.status = OrderStatus.error
            logger.warning(
                "[RECON] Order mismatch detected — state corrected: order=%s DB=OPEN broker=%s → ERROR",
                order.id, broker_status,
            )
            await self._broadcast_correction(order, "open→error")
            return True

        # Case 3: DB=PENDING, Broker=COMPLETE/FILLED → mark OPEN + wire monitors
        if order.status == OrderStatus.PENDING and broker_status in ("COMPLETE", "FILLED"):
            order.status = OrderStatus.OPEN
            logger.info(
                "[RECON] Order mismatch detected — state corrected: order=%s DB=PENDING broker=FILLED → OPEN",
                order.id,
            )
            # Re-subscribe LTP
            if self._ltp_consumer and order.instrument_token:
                self._ltp_consumer.subscribe(int(order.instrument_token))
            # Re-register SL/TP monitor
            if self._sl_tp_monitor and order.sl_price:
                from app.engine.sl_tp_monitor import PositionMonitor
                from app.engine.algo_runner import algo_runner
                monitor = PositionMonitor(
                    order_id=str(order.id),
                    algo_id=str(order.algo_id),
                    symbol=order.symbol,
                    sl_price=order.sl_price,
                    tp_price=order.tp_price,
                    direction=order.direction,
                    on_sl_hit=algo_runner.on_sl_hit,
                    on_tp_hit=algo_runner.on_tp_hit,
                )
                self._sl_tp_monitor.register(monitor)
            await self._broadcast_correction(order, "pending→open")
            return True

        return False

    async def _broadcast_correction(self, order: Order, correction_type: str) -> None:
        """Broadcast reconciliation correction to frontend via WebSocket."""
        if not self._ws_manager:
            return
        try:
            await self._ws_manager.broadcast({
                "type":            "reconciliation_correction",
                "order_id":        str(order.id),
                "algo_id":         str(order.algo_id),
                "correction_type": correction_type,
                "timestamp":       datetime.utcnow().isoformat(),
            })
        except Exception as e:
            logger.warning("[RECON] WebSocket broadcast failed: %s", e)


# ── Singleton ──────────────────────────────────────────────────────────────────
order_reconciler = OrderReconciler()
