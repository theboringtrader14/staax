"""
ExecutionManager — STAAX central order control layer (AR-1).

Architecture:
    AlgoRunner
        ↓
    ExecutionManager        ← this file
        ↓
    OrderRetryQueue
        ↓
    OrderPlacer

Responsibilities:
  - Apply global risk checks before every order (kill switch, market hours)
  - Route all order placement through OrderRetryQueue
  - Coordinate RUN / SQ / T manual actions from Orders page
  - Maintain execution audit log (every order decision recorded)
  - Single control point for the entire order lifecycle
"""
import logging
from datetime import datetime
from typing import Optional
from zoneinfo import ZoneInfo

from app.engine import order_retry_queue
from app.engine.order_placer import OrderPlacer
from app.engine.global_kill_switch import is_activated as kill_switch_active

IST = ZoneInfo("Asia/Kolkata")
logger = logging.getLogger(__name__)

# ── Market hours ───────────────────────────────────────────────────────────────
MARKET_OPEN  = (9,  15)   # 09:15 IST
MARKET_CLOSE = (15, 30)   # 15:30 IST


def _is_market_open() -> bool:
    now = datetime.now(IST)
    t   = (now.hour, now.minute)
    return MARKET_OPEN <= t <= MARKET_CLOSE


class ExecutionManager:
    """
    Central order lifecycle manager.
    Instantiated once as a singleton in main.py.
    """

    def __init__(self) -> None:
        self._order_placer: Optional[OrderPlacer] = None
        logger.info("[EM] ExecutionManager initialised")

    # ── Wiring ────────────────────────────────────────────────────────────────

    def wire(self, order_placer: OrderPlacer) -> None:
        self._order_placer = order_placer
        logger.info("[EM] Wired to OrderPlacer")

    # ── Risk gate ─────────────────────────────────────────────────────────────

    def _check_risk(self, algo_id: str, account_id: str) -> Optional[str]:
        """
        Returns an error string if placement should be blocked, else None.
        """
        if kill_switch_active(account_id=account_id):
            return f"[EM] ORDER BLOCKED — Kill switch active for account {account_id}"
        if not _is_market_open():
            return f"[EM] ORDER BLOCKED — Outside market hours for algo {algo_id}"
        return None

    # ── Primary placement entry point ─────────────────────────────────────────

    async def place(
        self,
        order,              # Order model instance
        db,                 # AsyncSession
        instrument: dict,
        direction: str,
        quantity: int,
        order_type: str,
        price: float = 0.0,
        product: str = "MIS",
        tag: str = "",
        account_id: str = "",
    ) -> Optional[str]:
        """
        Gate + route an order through RetryQueue → OrderPlacer.
        Returns broker_order_id on success, None on block or failure.
        """
        # Audit log — every placement attempt recorded
        logger.info(
            "[EM] PLACE | algo=%s account=%s dir=%s qty=%d sym=%s tag=%s",
            order.algo_id, account_id, direction, quantity,
            instrument.get("symbol", "?"), tag,
        )

        # Risk gate
        block_reason = self._check_risk(str(order.algo_id), account_id)
        if block_reason:
            logger.warning(block_reason)
            return None

        if self._order_placer is None:
            logger.error("[EM] OrderPlacer not wired — cannot place order")
            return None

        # Route through retry queue
        return await order_retry_queue.place(
            order_placer=self._order_placer,
            order=order,
            db=db,
            instrument=instrument,
            direction=direction,
            quantity=quantity,
            order_type=order_type,
            price=price,
            product=product,
            tag=tag,
        )

    # ── Square-off entry point (SQ / T actions from Orders page) ─────────────

    async def square_off(
        self,
        order,
        db,
        instrument: dict,
        quantity: int,
        is_practix: bool,
        account_id: str = "",
        tag: str = "square_off",
    ) -> Optional[str]:
        """
        Place a square-off (opposite direction) order.
        Bypasses kill switch check — square-off is always allowed.
        Bypasses market hours check — allow late SQ for safety.
        """
        logger.info(
            "[EM] SQUARE_OFF | algo=%s account=%s qty=%d sym=%s tag=%s",
            order.algo_id, account_id, quantity,
            instrument.get("symbol", "?"), tag,
        )

        if self._order_placer is None:
            logger.error("[EM] OrderPlacer not wired — cannot square off")
            return None

        # Determine opposite direction for square-off
        sq_direction = "sell" if order.direction.lower() in ("buy", "b") else "buy"

        return await order_retry_queue.place(
            order_placer=self._order_placer,
            order=order,
            db=db,
            instrument=instrument,
            direction=sq_direction,
            quantity=quantity,
            order_type="MARKET",
            price=0.0,
            product="MIS",
            tag=tag,
        )


# ── Singleton ──────────────────────────────────────────────────────────────────
execution_manager = ExecutionManager()
