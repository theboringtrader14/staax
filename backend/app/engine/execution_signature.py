"""
ExecutionSignature — broker-friendly execution behaviour.

Applies human-like timing variation and rate controls to every order to
avoid pattern-matching by broker surveillance systems.

Used by ExecutionManager before every order placement or cancellation.

Controls:
  micro_delay()         — random 50–250ms pause before each order
  burst_control()       — if >3 orders in last second, space them out
  retry_delay(attempt)  — randomised retry delays (2–3s / 5–7s)
  check_cancel_rate()   — block if >10 cancels per minute

All log entries use [EXEC_SIG] prefix for easy filtering.
"""
import asyncio
import logging
import random
from collections import deque
from time import monotonic

logger = logging.getLogger(__name__)


class CancelRateExceeded(Exception):
    """Raised when cancel rate guard trips (>10 cancels/min)."""


class ExecutionSignature:

    # ── Burst control: max orders per second before spacing kicks in ──────────
    BURST_THRESHOLD    = 3       # orders per second
    BURST_SPACING      = 0.35    # seconds added per order above threshold

    # ── Cancel rate: max cancels per rolling 60-second window ─────────────────
    CANCEL_RATE_LIMIT  = 10
    CANCEL_WINDOW_SECS = 60

    def __init__(self) -> None:
        self._order_timestamps:  deque = deque()   # monotonic timestamps of recent placements
        self._cancel_timestamps: deque = deque()   # monotonic timestamps of recent cancels

    # ── Micro delay ───────────────────────────────────────────────────────────

    async def micro_delay(self) -> None:
        """
        Random 50–250ms pause before placing an order.
        Makes order timing appear organic to broker surveillance.
        """
        delay = random.uniform(0.05, 0.25)
        logger.info(f"[EXEC_SIG] micro_delay={delay:.3f}s")
        await asyncio.sleep(delay)

    # ── Burst control ─────────────────────────────────────────────────────────

    async def burst_control(self) -> None:
        """
        Tracks orders placed in the last second.
        If ≥ BURST_THRESHOLD orders have gone out, adds spacing before allowing next.
        Call this immediately before routing to OrderRetryQueue.
        """
        now = monotonic()

        # Prune entries older than 1 second
        while self._order_timestamps and now - self._order_timestamps[0] > 1.0:
            self._order_timestamps.popleft()

        count = len(self._order_timestamps)
        logger.info(f"[EXEC_SIG] burst_control orders_last_sec={count}")

        if count >= self.BURST_THRESHOLD:
            spacing = self.BURST_SPACING * (count - self.BURST_THRESHOLD + 1)
            logger.warning(
                f"[EXEC_SIG] Burst threshold reached ({count}/s) — "
                f"spacing={spacing:.2f}s"
            )
            await asyncio.sleep(spacing)

        self._order_timestamps.append(monotonic())

    # ── Retry delay ───────────────────────────────────────────────────────────

    async def retry_delay(self, attempt: int) -> None:
        """
        Randomised delay before a retry attempt.
        attempt=1 → 2.0–3.0s  (first retry after immediate failure)
        attempt=2 → 5.0–7.0s  (second retry)
        attempt>2 → 5.0–7.0s  (capped at second-retry range)
        """
        if attempt <= 1:
            delay = random.uniform(2.0, 3.0)
        else:
            delay = random.uniform(5.0, 7.0)

        logger.info(f"[EXEC_SIG] retry_delay attempt={attempt} delay={delay:.2f}s")
        await asyncio.sleep(delay)

    # ── Cancel rate guard ─────────────────────────────────────────────────────

    def check_cancel_rate(self) -> None:
        """
        Raises CancelRateExceeded if >10 cancels have occurred in the last 60s.
        Call this before every order cancellation.
        Synchronous — does not sleep; caller decides whether to block or queue.
        """
        now = monotonic()

        # Prune entries outside rolling window
        while self._cancel_timestamps and now - self._cancel_timestamps[0] > self.CANCEL_WINDOW_SECS:
            self._cancel_timestamps.popleft()

        count = len(self._cancel_timestamps)
        logger.info(f"[EXEC_SIG] cancel_rate cancels_last_min={count}")

        if count >= self.CANCEL_RATE_LIMIT:
            raise CancelRateExceeded(
                f"[EXEC_SIG] Cancel rate limit exceeded: "
                f"{count}/{self.CANCEL_RATE_LIMIT} cancels in last 60s — order blocked"
            )

        self._cancel_timestamps.append(monotonic())


# ── Singleton ─────────────────────────────────────────────────────────────────
execution_signature = ExecutionSignature()
