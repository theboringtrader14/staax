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

# ── AR-4: Smart retry classifier ──────────────────────────────────────────────
# Only retry temporary technical failures — never business-logic rejections.
_NO_RETRY_PATTERNS = [
    "insufficient margin",
    "insufficient funds",
    "margin",
    "invalid order",
    "invalid symbol",
    "instrument not tradable",
    "not tradable",
    "market closed",
    "outside market hours",
    "scrip is not available",
    "order quantity",
    "lot size",
    "freeze quantity",
    "invalid price",
    "order value",
    "duplicate order",
    "self trade",
]

def is_retryable(error: str) -> bool:
    """
    Returns True if the error is a temporary technical failure worth retrying.
    Returns False for business-logic rejections (margin, invalid params, etc).
    """
    if not error:
        return True
    error_lower = error.lower()
    for pattern in _NO_RETRY_PATTERNS:
        if pattern in error_lower:
            logger.warning(f"[RETRY] Non-retryable error detected ('{pattern}') — skipping retries: {error}")
            return False
    return True

MAX_ATTEMPTS = 3


async def place(
    order_placer,
    idempotency_key: str,
    algo_id:         str,
    symbol:          str,
    exchange:        str,
    direction:       str,
    quantity:        int,
    order_type:      str,
    ltp:             float,
    is_practix:      bool  = True,
    is_overnight:    bool  = False,
    limit_price      = None,
    trigger_price    = None,
    broker_type:     str   = "zerodha",
    symbol_token:    str   = "",
    algo_tag:        str   = "",
    account_id:      str   = "",
    # Legacy db/order params kept for callers that pass them — ignored here
    # (order persistence is handled by AlgoRunner, not retry queue)
    db               = None,
    order            = None,
) -> Optional[str]:
    """
    Place an order through the retry queue.

    Attempts up to MAX_ATTEMPTS times with randomised delays from ExecutionSignature.
    Returns: broker_order_id (str) on success, None on failure.

    Note: order DB state updates (retry_count, status) are handled by the caller
    (AlgoRunner) after this function returns, not here. This keeps retry logic
    stateless and reusable.
    """
    from app.engine.execution_signature import execution_signature

    # ── Kill Switch check ─────────────────────────────────────────────────────
    if disabled:
        logger.error(
            f"[RETRY QUEUE] Order rejected — Kill Switch active. "
            f"idempotency_key={idempotency_key} symbol={symbol}"
        )
        return None

    broker_order_id = None
    last_error      = None

    for attempt in range(1, MAX_ATTEMPTS + 1):
        # ── Apply randomised delay before retry attempts ──────────────────────
        if attempt > 1:
            await execution_signature.retry_delay(attempt - 1)

        # ── Re-check Kill Switch before each attempt ──────────────────────────
        if disabled:
            logger.error(
                f"[RETRY QUEUE] Kill Switch activated during retry — aborting. "
                f"idempotency_key={idempotency_key}"
            )
            return None

        try:
            logger.info(
                f"[RETRY QUEUE] Attempt {attempt}/{MAX_ATTEMPTS} — "
                f"symbol={symbol} qty={quantity} dir={direction} tag={algo_tag}"
            )

            broker_order_id = await order_placer.place(
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
                trigger_price   = trigger_price,
                broker_type     = broker_type,
                symbol_token    = symbol_token,
                algo_tag        = algo_tag,
                account_id      = account_id,
            )

            logger.info(
                f"[RETRY QUEUE] ✅ Placed on attempt {attempt}. "
                f"broker_order_id={broker_order_id}"
            )
            return broker_order_id

        except Exception as e:
            last_error = str(e)
            logger.warning(
                f"[RETRY QUEUE] Attempt {attempt}/{MAX_ATTEMPTS} FAILED — "
                f"symbol={symbol} error={last_error}"
            )

            if not is_retryable(last_error):
                logger.error(
                    f"[RETRY QUEUE] ❌ Non-retryable error — aborting. error={last_error}"
                )
                break

            if attempt == MAX_ATTEMPTS:
                logger.error(
                    f"[RETRY QUEUE] ❌ All {MAX_ATTEMPTS} attempts failed. "
                    f"final_error={last_error}"
                )

    logger.error(
        f"[RETRY QUEUE] Order failed after {MAX_ATTEMPTS} attempts. "
        f"symbol={symbol} last_error={last_error}"
    )
    return None


async def retry_order(
    order_placer,
    idempotency_key: str,
    algo_id:         str,
    symbol:          str,
    exchange:        str,
    direction:       str,
    quantity:        int,
    order_type:      str,
    ltp:             float,
    is_practix:      bool = True,
    is_overnight:    bool = False,
    limit_price      = None,
    broker_type:     str  = "zerodha",
    symbol_token:    str  = "",
    algo_tag:        str  = "",
    account_id:      str  = "",
) -> Optional[str]:
    """
    Manual retry — called from POST /api/v1/algos/{id}/re (RE button).
    Delegates directly to place() after kill switch check.
    Order state reset is handled by the API endpoint before calling here.
    """
    if disabled:
        logger.error(
            f"[RETRY QUEUE] Manual retry rejected — Kill Switch active. "
            f"idempotency_key={idempotency_key}"
        )
        return None

    logger.info(f"[RETRY QUEUE] Manual RE triggered for idempotency_key={idempotency_key}")

    return await place(
        order_placer    = order_placer,
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
        account_id      = account_id,
    )


def get_status() -> dict:
    """Return current retry queue status — used by health checks and dashboard."""
    return {
        "disabled":     disabled,
        "max_attempts": MAX_ATTEMPTS,
        "retry_delays": RETRY_DELAYS,
    }
