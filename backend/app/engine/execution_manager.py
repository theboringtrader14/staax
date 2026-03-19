"""
ExecutionManager — STAAX central order control layer (AR-1).

Architecture:
    AlgoRunner
        ↓
    ExecutionManager        ← this file
        ↓ (micro_delay + burst_control via ExecutionSignature)
    OrderRetryQueue
        ↓
    OrderPlacer

Responsibilities:
  - Generate and validate algo_tag on every live order
  - Apply global risk checks (kill switch, market hours)
  - Apply execution signature (micro delay, burst control)
  - Route all order placement through OrderRetryQueue
  - Write every decision to execution_logs (DB audit trail)
  - Enforce cancel rate guard on square-offs
"""
import logging
import uuid
from datetime import datetime
from typing import Optional
from zoneinfo import ZoneInfo

from app.engine import order_retry_queue
from app.engine.order_placer import OrderPlacer
from app.engine.global_kill_switch import is_activated as kill_switch_active
from app.engine.execution_signature import execution_signature, CancelRateExceeded

IST = ZoneInfo("Asia/Kolkata")
logger = logging.getLogger(__name__)

# ── Market hours ───────────────────────────────────────────────────────────────
MARKET_OPEN  = (9,  15)
MARKET_CLOSE = (15, 30)


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

    # ── Audit log (DB + structured logger) ────────────────────────────────────

    async def _log(
        self,
        db,
        action:     str,
        status:     str,
        algo_tag:   str  = "",
        algo_id:    str  = "",
        order_id:   str  = "",
        account_id: str  = "",
        reason:     str  = "",
    ) -> None:
        """
        Write one ExecutionLog row. Never raises — audit must not break execution.
        Also emits a structured logger line for log aggregation.
        """
        parts = [f"[EXEC] {action} status={status}"]
        if algo_tag:   parts.append(f"tag={algo_tag}")
        if algo_id:    parts.append(f"algo={algo_id}")
        if account_id: parts.append(f"account={account_id}")
        if order_id:   parts.append(f"order={order_id}")
        if reason:     parts.append(f"reason={reason}")
        logger.info(" | ".join(parts))

        if db is None:
            return

        try:
            from app.models.execution_log import ExecutionLog
            import uuid as _uuid

            def _to_uuid(v: str):
                if not v:
                    return None
                try:
                    return _uuid.UUID(v)
                except (ValueError, AttributeError):
                    return None

            log = ExecutionLog(
                id         = _uuid.uuid4(),
                algo_tag   = algo_tag   or None,
                algo_id    = _to_uuid(algo_id),
                order_id   = _to_uuid(order_id),
                account_id = _to_uuid(account_id),
                action     = action,
                status     = status,
                reason     = reason or None,
            )
            db.add(log)
            await db.flush()
        except Exception as e:
            logger.warning(f"[EM] ExecutionLog write failed (non-fatal): {e}")

    # ── Risk gate ─────────────────────────────────────────────────────────────

    def _check_risk(
        self,
        algo_id:    str,
        account_id: str,
        algo_tag:   str,
        is_practix: bool,
    ) -> Optional[str]:
        """Returns a block reason string if the order should be rejected, else None."""
        if kill_switch_active(account_id=account_id):
            return f"Kill switch active for account={account_id}"
        if not _is_market_open():
            return f"Outside market hours for algo={algo_id}"
        if not is_practix and not algo_tag:
            return f"algo_tag missing for live order algo={algo_id}"
        return None

    # ── Primary placement entry point ─────────────────────────────────────────

    async def place(
        self,
        db,
        idempotency_key: str,
        algo_id:         str,
        account_id:      str,
        symbol:          str,
        exchange:        str,
        direction:       str,
        quantity:        int,
        order_type:      str,
        ltp:             float,
        algo_tag:        str  = "",
        is_practix:      bool = True,
        is_overnight:    bool = False,
        limit_price:     Optional[float] = None,
        broker_type:     str  = "zerodha",
        symbol_token:    str  = "",
    ) -> Optional[str]:
        """
        Gate, sign, and route an order through RetryQueue → OrderPlacer.
        Returns broker_order_id on success, None on block or failure.
        """
        await self._log(db, "PLACE", "PENDING",
                        algo_tag=algo_tag, algo_id=algo_id,
                        account_id=account_id)

        # ── Risk gate ─────────────────────────────────────────────────────────
        block_reason = self._check_risk(algo_id, account_id, algo_tag, is_practix)
        if block_reason:
            await self._log(db, "PLACE", "BLOCKED",
                            algo_tag=algo_tag, algo_id=algo_id,
                            account_id=account_id, reason=block_reason)
            logger.error(f"[EM] ORDER BLOCKED — {block_reason}")
            return None

        if self._order_placer is None:
            reason = "OrderPlacer not wired"
            await self._log(db, "PLACE", "BLOCKED",
                            algo_tag=algo_tag, algo_id=algo_id,
                            account_id=account_id, reason=reason)
            logger.error(f"[EM] {reason}")
            return None

        # ── Execution signature: micro delay + burst control ──────────────────
        await execution_signature.micro_delay()
        await execution_signature.burst_control()

        # ── Route through retry queue ─────────────────────────────────────────
        result = await order_retry_queue.place(
            order_placer    = self._order_placer,
            idempotency_key = idempotency_key,
            algo_id         = algo_id,
            symbol          = symbol,
            exchange        = exchange,
            direction       = direction,
            quantity        = quantity,
            order_type      = order_type,
            ltp             = ltp,
            is_practix      = is_practix,
            is_overnight    = is_overnight,
            limit_price     = limit_price,
            broker_type     = broker_type,
            symbol_token    = symbol_token,
            algo_tag        = algo_tag,
        )

        if result:
            await self._log(db, "PLACE", "OK",
                            algo_tag=algo_tag, algo_id=algo_id,
                            account_id=account_id,
                            reason=f"broker_order_id={result}")
        else:
            await self._log(db, "PLACE", "FAILED",
                            algo_tag=algo_tag, algo_id=algo_id,
                            account_id=account_id)

        return result

    # ── Square-off entry point ────────────────────────────────────────────────

    async def square_off(
        self,
        db,
        idempotency_key: str,
        algo_id:         str,
        account_id:      str,
        symbol:          str,
        exchange:        str,
        direction:       str,       # direction of the OPEN order (will be reversed)
        quantity:        int,
        algo_tag:        str  = "",
        is_practix:      bool = True,
        broker_type:     str  = "zerodha",
        symbol_token:    str  = "",
    ) -> Optional[str]:
        """
        Place a square-off (opposite direction) order.
        Bypasses kill switch and market hours — SQ is always permitted.
        Cancel rate guard applied.
        """
        await self._log(db, "SQ", "PENDING",
                        algo_tag=algo_tag, algo_id=algo_id,
                        account_id=account_id)

        # Cancel rate guard
        try:
            execution_signature.check_cancel_rate()
        except CancelRateExceeded as e:
            await self._log(db, "SQ", "BLOCKED",
                            algo_tag=algo_tag, algo_id=algo_id,
                            account_id=account_id, reason=str(e))
            logger.error(str(e))
            return None

        if self._order_placer is None:
            reason = "OrderPlacer not wired"
            await self._log(db, "SQ", "BLOCKED",
                            algo_tag=algo_tag, algo_id=algo_id,
                            account_id=account_id, reason=reason)
            logger.error(f"[EM] {reason}")
            return None

        sq_direction = "sell" if direction.lower() in ("buy", "b") else "buy"

        result = await order_retry_queue.place(
            order_placer    = self._order_placer,
            idempotency_key = idempotency_key,
            algo_id         = algo_id,
            symbol          = symbol,
            exchange        = exchange,
            direction       = sq_direction,
            quantity        = quantity,
            order_type      = "MARKET",
            ltp             = 0.0,
            is_practix      = is_practix,
            is_overnight    = False,
            broker_type     = broker_type,
            symbol_token    = symbol_token,
            algo_tag        = algo_tag,
        )

        status = "OK" if result else "FAILED"
        await self._log(db, "SQ", status,
                        algo_tag=algo_tag, algo_id=algo_id,
                        account_id=account_id,
                        reason=f"broker_order_id={result}" if result else "")
        return result


# ── Singleton ──────────────────────────────────────────────────────────────────
execution_manager = ExecutionManager()
