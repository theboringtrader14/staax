"""
Order Retry Queue — handles temporary broker/API failures during order placement.

Architecture:
    AlgoRunner → OrderRetryQueue → OrderPlacer

Retry rules:
    Attempt 1 → immediate
    Attempt 2 → retry after 2 seconds
    Attempt 3 → retry after 5 seconds
    All retries failed → Order status = ERROR

Kill Switch integration:
    If global_kill_switch.is_activated() → reject all new orders immediately.

Usage (in AlgoRunner._place_leg):
    Instead of: order_id = await self._order_placer.place(...)
    Use:        order_id = await order_retry_queue.place(order_placer, ...)
"""
import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional, Any

logger = logging.getLogger(__name__)

# ── Module-level disable flag (set by Kill Switch) ────────────────────────────
disabled: bool = False

# ── Retry schedule: (attempt_number → delay_seconds_before_attempt) ──────────
RETRY_DELAYS = {
    1: 0,   # Attempt 1 — immediate
    2: 2,   # Attempt 2 — 2s delay
    3: 5,   # Attempt 3 — 5s delay
}
MAX_ATTEMPTS = 3


async def place(
    order_placer,
    order,                  # Order model instance
    db,                     # AsyncSession
    instrument: dict,       # {symbol, exchange, token, ...}
    direction: str,         # "buy" | "sell"
    quantity: int,
    order_type: str,        # "MARKET" | "LIMIT"
    price: float = 0.0,
    product: str = "MIS",   # "MIS" | "NRML"
    tag: str = "",
) -> Optional[str]:
    """
    Place an order through the retry queue.

    Attempts up to MAX_ATTEMPTS times with escalating delays.
    Updates order.retry_count and order.last_retry_time on each attempt.
    Sets order.status = ERROR if all attempts fail.
    Sets order.status = OPEN if successful.

    Returns: broker_order_id (str) on success, None on failure.
    """
    from app.models.order import OrderStatus

    # ── Kill Switch check ─────────────────────────────────────────────────────
    if disabled:
        logger.error(
            f"[RETRY QUEUE] Order rejected — Kill Switch is active. "
            f"order_id={order.id} symbol={instrument.get('symbol')}"
        )
        order.status = OrderStatus.ERROR
        order.error_message = "Kill Switch active — order rejected"
        await db.commit()
        return None

    broker_order_id = None
    last_error = None

    for attempt in range(1, MAX_ATTEMPTS + 1):
        # ── Apply delay before attempt (except first) ─────────────────────────
        delay = RETRY_DELAYS.get(attempt, 5)
        if delay > 0:
            logger.warning(
                f"[RETRY QUEUE] Attempt {attempt}/{MAX_ATTEMPTS} — "
                f"waiting {delay}s before retry. "
                f"order_id={order.id} symbol={instrument.get('symbol')}"
            )
            await asyncio.sleep(delay)

        # ── Re-check Kill Switch before each attempt ──────────────────────────
        if disabled:
            logger.error(
                f"[RETRY QUEUE] Kill Switch activated during retry — aborting. "
                f"order_id={order.id}"
            )
            order.status = OrderStatus.ERROR
            order.error_message = "Kill Switch activated during retry"
            order.retry_count = attempt - 1
            order.last_retry_time = datetime.now(timezone.utc)
            await db.commit()
            return None

        try:
            logger.info(
                f"[RETRY QUEUE] Attempt {attempt}/{MAX_ATTEMPTS} — "
                f"placing order. order_id={order.id} "
                f"symbol={instrument.get('symbol')} qty={quantity} dir={direction}"
            )

            # ── Place order via OrderPlacer ───────────────────────────────────
            broker_order_id = await order_placer.place(
                order=order,
                instrument=instrument,
                direction=direction,
                quantity=quantity,
                order_type=order_type,
                price=price,
                product=product,
                tag=tag,
            )

            # ── Success ───────────────────────────────────────────────────────
            logger.info(
                f"[RETRY QUEUE] ✅ Order placed successfully on attempt {attempt}. "
                f"order_id={order.id} broker_order_id={broker_order_id}"
            )

            order.retry_count     = attempt - 1   # 0 = first try, 1 = one retry, etc.
            order.last_retry_time = datetime.now(timezone.utc) if attempt > 1 else None
            await db.commit()
            return broker_order_id

        except Exception as e:
            last_error = str(e)
            logger.warning(
                f"[RETRY QUEUE] Attempt {attempt}/{MAX_ATTEMPTS} FAILED — "
                f"order_id={order.id} error={last_error}"
            )

            order.retry_count     = attempt
            order.last_retry_time = datetime.now(timezone.utc)
            await db.commit()

            if attempt == MAX_ATTEMPTS:
                logger.error(
                    f"[RETRY QUEUE] ❌ All {MAX_ATTEMPTS} attempts failed. "
                    f"order_id={order.id} final_error={last_error}"
                )

    # ── All retries exhausted → mark ERROR ───────────────────────────────────
    order.status        = OrderStatus.ERROR
    order.error_message = f"Failed after {MAX_ATTEMPTS} attempts: {last_error}"
    await db.commit()

    logger.error(
        f"[RETRY QUEUE] Order marked ERROR. "
        f"order_id={order.id} symbol={instrument.get('symbol')} error={last_error}"
    )
    return None


async def retry_order(
    order_placer,
    order,
    db,
    instrument: dict,
    direction: str,
    quantity: int,
    order_type: str,
    price: float = 0.0,
    product: str = "MIS",
    tag: str = "",
) -> Optional[str]:
    """
    Manual retry for an order in ERROR state.
    Called from POST /api/v1/algos/{id}/re (RE button on Orders page).

    Resets retry_count to 0 and runs through the full retry queue again.
    Only valid for orders in ERROR status.
    """
    from app.models.order import OrderStatus

    if order.status != OrderStatus.ERROR:
        logger.warning(
            f"[RETRY QUEUE] Manual retry rejected — order is not in ERROR state. "
            f"order_id={order.id} current_status={order.status}"
        )
        return None

    if disabled:
        logger.error(
            f"[RETRY QUEUE] Manual retry rejected — Kill Switch is active. "
            f"order_id={order.id}"
        )
        return None

    logger.info(
        f"[RETRY QUEUE] Manual RE triggered for order_id={order.id}"
    )

    # Reset error state before retrying
    order.status        = OrderStatus.PENDING
    order.error_message = None
    order.retry_count   = 0
    await db.commit()

    return await place(
        order_placer=order_placer,
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


def get_status() -> dict:
    """Return current retry queue status — used by health checks and dashboard."""
    return {
        "disabled":     disabled,
        "max_attempts": MAX_ATTEMPTS,
        "retry_delays": RETRY_DELAYS,
    }
