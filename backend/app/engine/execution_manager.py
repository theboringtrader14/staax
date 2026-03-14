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

    # ── Audit log ─────────────────────────────────────────────────────────────

    def _audit(self, event: str, **kwargs) -> None:
        """
        Structured audit log entry. Every order decision is recorded here.
        Events: REQUEST | RISK_PASS | RISK_BLOCK | ROUTED | BROKER_OK | BROKER_FAIL | SQ_REQUEST | SQ_OK | SQ_FAIL
        """
        parts = [f"[EXEC] {event}"]
        for k, v in kwargs.items():
            parts.append(f"{k}={v}")
        logger.info(" | ".join(parts))

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
        # AR-3: Structured audit log
        self._audit("REQUEST",
            algo=order.algo_id, account=account_id,
            dir=direction, qty=quantity,
            sym=instrument.get("symbol", "?"), tag=tag)

        # Risk gate
        block_reason = self._check_risk(str(order.algo_id), account_id)
        if block_reason:
            self._audit("RISK_BLOCK", reason=block_reason)
            return None

        self._audit("RISK_PASS", algo=order.algo_id, account=account_id)

        if self._order_placer is None:
            self._audit("RISK_BLOCK", reason="OrderPlacer not wired")
            logger.error("[EXEC] OrderPlacer not wired — cannot place order")
            return None

        self._audit("ROUTED", algo=order.algo_id, queue="OrderRetryQueue")

        # Route through retry queue
        result = await order_retry_queue.place(
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
        if result:
            self._audit("BROKER_OK", algo=order.algo_id, broker_order_id=result)
        else:
            self._audit("BROKER_FAIL", algo=order.algo_id, sym=instrument.get("symbol","?"))
        return result

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
        self._audit("SQ_REQUEST",
            algo=order.algo_id, account=account_id,
            qty=quantity, sym=instrument.get("symbol","?"), tag=tag)

        if self._order_placer is None:
            self._audit("SQ_FAIL", reason="OrderPlacer not wired")
            logger.error("[EXEC] OrderPlacer not wired — cannot square off")
            return None

        # Determine opposite direction for square-off
        sq_direction = "sell" if order.direction.lower() in ("buy", "b") else "buy"

        sq_result = await order_retry_queue.place(
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
        if sq_result:
            self._audit("SQ_OK", algo=order.algo_id, broker_order_id=sq_result)
        else:
            self._audit("SQ_FAIL", algo=order.algo_id, sym=instrument.get("symbol","?"))
        return sq_result


# ── Singleton ──────────────────────────────────────────────────────────────────
execution_manager = ExecutionManager()
