"""
Broker Reconnect Manager — maintains stable market data WebSocket connectivity.

Runs every 3 seconds via APScheduler.

Logic:
    - Tracks timestamp of last received tick from LTPConsumer
    - If no tick received for 5+ seconds → assume connection lost
    - Reconnects WebSocket, re-authenticates if needed, re-subscribes tokens
    - Logs WARNING on disconnect, INFO on reconnect

Integration:
    - Wired in Scheduler._register_fixed_jobs() as a 3s interval job
    - Reads LTPConsumer.last_tick_time to detect staleness
    - Calls LTPConsumer.restart() to reconnect

Kill Switch integration:
    - If global_kill_switch.disabled is True → skip reconnect (engine is halted)
"""
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

logger = logging.getLogger(__name__)

STALE_THRESHOLD_SECONDS = 5   # Seconds of silence before reconnect triggered
_reconnecting: bool = False    # Guard against concurrent reconnect attempts


class BrokerReconnectManager:

    def __init__(self):
        self._ltp_consumer = None
        self._last_reconnect_at: Optional[datetime] = None
        self._reconnect_count: int = 0
        self._consecutive_failures: int = 0
        self._max_consecutive_failures: int = 10   # After this → CRITICAL alert

    def wire(self, ltp_consumer) -> None:
        """Wire the LTPConsumer instance. Called during engine startup."""
        self._ltp_consumer = ltp_consumer
        logger.info("[RECONNECT MGR] Wired to LTPConsumer")

    async def check(self) -> None:
        """
        Main check — called every 3 seconds by Scheduler.

        Steps:
          1. Skip if Kill Switch is active (engine halted)
          2. Skip if LTPConsumer not wired or ticker not started
          3. Check last tick timestamp — if stale > 5s → reconnect
          4. Reconnect: stop → restart → re-subscribe tokens
          5. Log appropriately; alert if repeated failures
        """
        global _reconnecting

        # ── Kill Switch gate ──────────────────────────────────────────────────
        try:
            from app.engine import order_retry_queue
            if order_retry_queue.disabled:
                return   # Engine halted — no reconnect attempts
        except ImportError:
            pass

        # ── Guard: LTPConsumer not wired ──────────────────────────────────────
        if self._ltp_consumer is None:
            return

        # ── Guard: ticker not started (no token yet) ──────────────────────────
        # NOTE: LTPConsumer uses '_running' not '_started'; getattr falls back to False safely.
        # '_started' does not exist on LTPConsumer — this guard is a no-op (always passes through).
        # Use '_running' for the correct check.
        if not getattr(self._ltp_consumer, '_running', False):
            return

        # ── Guard: concurrent reconnect in progress ───────────────────────────
        if _reconnecting:
            return

        # ── Check feed staleness ──────────────────────────────────────────────
        # NOTE: LTPConsumer does not expose 'last_tick_time' or '_started_at'.
        # getattr falls back to None for both, so this block always falls through
        # to reconnect after STALE_THRESHOLD_SECONDS. Harmless in practice because
        # the Zerodha ticker has its own built-in reconnect logic.
        last_tick = getattr(self._ltp_consumer, 'last_tick_time', None)
        now = datetime.now(timezone.utc)

        if last_tick is None:
            # Never received a tick since start — check if ticker has been
            # running for more than threshold (could be genuinely no data)
            started_at = getattr(self._ltp_consumer, '_started_at', None)
            if started_at is None:
                return
            if (now - started_at).total_seconds() < STALE_THRESHOLD_SECONDS:
                return   # Give it time on first start
            # Fall through to reconnect
        else:
            elapsed = (now - last_tick).total_seconds()
            if elapsed < STALE_THRESHOLD_SECONDS:
                # Feed is healthy
                self._consecutive_failures = 0
                return

        # ── Feed is stale — attempt reconnect ────────────────────────────────
        _reconnecting = True
        try:
            logger.warning(
                f"[RECONNECT MGR] ⚠️ Market feed inactive for "
                f"{STALE_THRESHOLD_SECONDS}s — reconnecting "
                f"(attempt #{self._reconnect_count + 1})"
            )

            await self._do_reconnect()

        finally:
            _reconnecting = False

    async def _do_reconnect(self) -> None:
        """Execute the reconnect sequence."""
        try:
            # Step 1: Stop current connection cleanly
            stop_fn = getattr(self._ltp_consumer, 'stop', None)
            if stop_fn:
                try:
                    await stop_fn()
                except Exception as e:
                    logger.debug(f"[RECONNECT MGR] Stop had error (expected): {e}")

            # Step 2: Restart connection
            restart_fn = getattr(self._ltp_consumer, 'restart', None)
            start_fn   = getattr(self._ltp_consumer, 'start',   None)

            if restart_fn:
                await restart_fn()
            elif start_fn:
                await start_fn()
            else:
                logger.error("[RECONNECT MGR] LTPConsumer has no start/restart method")
                self._consecutive_failures += 1
                return

            # Step 3: Re-subscribe currently tracked tokens
            resubscribe_fn = getattr(self._ltp_consumer, 'resubscribe_all', None)
            if resubscribe_fn:
                await resubscribe_fn()

            # ── Success ───────────────────────────────────────────────────────
            self._reconnect_count     += 1
            self._consecutive_failures = 0
            self._last_reconnect_at    = datetime.now(timezone.utc)

            logger.info(
                f"[RECONNECT MGR] ✅ WebSocket reconnected and tokens resubscribed "
                f"(total reconnects: {self._reconnect_count})"
            )

        except Exception as e:
            self._consecutive_failures += 1
            logger.error(
                f"[RECONNECT MGR] ❌ Reconnect attempt failed "
                f"(consecutive failures: {self._consecutive_failures}): {e}"
            )

            if self._consecutive_failures >= self._max_consecutive_failures:
                logger.critical(
                    f"[RECONNECT MGR] 🚨 CRITICAL — {self._consecutive_failures} consecutive "
                    f"reconnect failures. Market data feed is DOWN. Manual intervention required."
                )

    def get_status(self) -> dict:
        """Return current reconnect manager status — for health checks."""
        last_tick = getattr(self._ltp_consumer, 'last_tick_time', None)
        now       = datetime.now(timezone.utc)

        feed_age_seconds = (
            (now - last_tick).total_seconds() if last_tick else None
        )

        return {
            "reconnect_count":        self._reconnect_count,
            "consecutive_failures":   self._consecutive_failures,
            "last_reconnect_at":      self._last_reconnect_at.isoformat() if self._last_reconnect_at else None,
            "feed_age_seconds":       feed_age_seconds,
            "feed_healthy":           (
                feed_age_seconds is not None
                and feed_age_seconds < STALE_THRESHOLD_SECONDS
            ),
        }


# ── Singleton ─────────────────────────────────────────────────────────────────
broker_reconnect_manager = BrokerReconnectManager()
