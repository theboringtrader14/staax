"""
Broker Reconnect Manager — maintains stable market data WebSocket connectivity.

Runs every 10 seconds via APScheduler.

Logic:
    1. Market hours guard (IST 09:00–23:30) — no reconnect attempts outside window
    2. Direct _connected check — if SmartStream._connected=False → reconnect immediately
    3. Zombie detection — if _connected=True but no tick for 60s → force reconnect
    4. Staleness check — if no tick for 5s → reconnect
    5. 5-minute periodic status log (every 30 calls at 10s interval)

Root cause that was fixed (2026-04-24):
    _do_reconnect() previously called `await LTPConsumer.start()` which:
      a) is a sync function — await on non-coroutine
      b) requires `tokens` arg — called with no args → TypeError every run
    This caused silent failures every 3s until CRITICAL threshold.
    Fixed: call AngelOneTickerAdapter.restart() directly.

Integration:
    - Wired in Scheduler._register_fixed_jobs() as a 10s interval job
    - Reads LTPConsumer.last_tick_time to detect staleness
    - Calls AngelOneTickerAdapter.restart() to reconnect

Kill Switch integration:
    - If global_kill_switch.disabled is True → skip reconnect (engine is halted)
"""
import logging
import time as _time
from datetime import datetime, timezone
from typing import Optional
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

IST = ZoneInfo("Asia/Kolkata")
STALE_THRESHOLD_SECONDS  = 30   # Fix 2: raised from 5→30 — 5s was too aggressive, caused false reconnects
ZOMBIE_THRESHOLD_SECONDS = 60   # Connected but no tick for this long → force reconnect
_reconnecting: bool = False      # Guard against concurrent reconnect attempts


class BrokerReconnectManager:

    MIN_RESTART_INTERVAL = 60.0   # Fix 3: never restart more than once per minute

    def __init__(self):
        self._ltp_consumer = None
        self._last_reconnect_at: Optional[datetime] = None
        self._reconnect_count: int = 0
        self._consecutive_failures: int = 0
        self._max_consecutive_failures: int = 10   # After this → CRITICAL alert
        self._status_log_ticks: int = 0            # For 5-minute periodic log (30 × 10s = 300s)
        self._last_restart_at: float = 0.0         # Fix 3: monotonic timestamp of last restart

    def wire(self, ltp_consumer) -> None:
        """Wire the LTPConsumer instance. Called during engine startup."""
        self._ltp_consumer = ltp_consumer
        logger.info("[RECONNECT MGR] Wired to LTPConsumer")

    async def check(self) -> None:
        """
        Main check — called every 10 seconds by Scheduler.

        Steps:
          1. Skip if Kill Switch is active (engine halted)
          2. Skip if LTPConsumer not wired
          3. Skip outside market hours (IST 09:00–23:30)
          4. 5-minute periodic status log
          5. Fast path: if _connected=False → reconnect immediately
          6. Zombie detection: connected but tick stale > 60s → force reconnect
          7. Normal staleness check: no tick for 5s → reconnect
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

        # ── Guard: concurrent reconnect in progress ───────────────────────────
        if _reconnecting:
            return

        # ── Market hours guard (IST 09:00–23:30) ─────────────────────────────
        _now_ist = datetime.now(IST)
        _hour_float = _now_ist.hour + _now_ist.minute / 60.0
        if not (9.0 <= _hour_float < 23.5):
            return

        # ── Periodic 5-minute status log ──────────────────────────────────────
        self._status_log_ticks += 1
        if self._status_log_ticks >= 30:   # 30 × 10s = 5 minutes
            self._status_log_ticks = 0
            self._log_status()

        # ── Per-adapter staleness (Fix 4) ─────────────────────────────────────
        angel    = getattr(self._ltp_consumer, '_angel_adapter', None)
        now_mono = _time.monotonic()

        # Angel One last tick: read from adapter._last_ao_tick (stamped in _on_data)
        last_ao_tick = getattr(angel, '_last_ao_tick', 0.0) if angel else 0.0
        ao_age       = (now_mono - last_ao_tick) if last_ao_tick > 0 else None

        # ── Fast path: _connected=False → immediate reconnect ─────────────────
        is_ws_connected = getattr(angel, '_connected', True) if angel else True

        if not is_ws_connected:
            _reconnecting = True
            try:
                logger.warning("[RECONNECT MGR] SmartStream _connected=False — triggering reconnect")
                await self._do_reconnect()
            finally:
                _reconnecting = False
            return

        # ── Zombie detection: connected but AO tick stale > 60s ───────────────
        if ao_age is not None and ao_age > ZOMBIE_THRESHOLD_SECONDS:
            _reconnecting = True
            try:
                logger.warning(
                    f"[RECONNECT MGR] Zombie WebSocket — AO connected but no tick for "
                    f"{ao_age:.0f}s (>{ZOMBIE_THRESHOLD_SECONDS}s) — forcing reconnect"
                )
                await self._do_reconnect()
            finally:
                _reconnecting = False
            return

        # ── Fix 4: Angel One-specific staleness check ─────────────────────────
        # Use AO tick age independently — Zerodha ticks won't mask a dead AO feed.
        if ao_age is None:
            # AO never ticked — fall back to legacy last_tick_time for startup grace period
            started_at = getattr(self._ltp_consumer, '_started_at', None)
            if started_at is None or (now_mono - started_at) < STALE_THRESHOLD_SECONDS:
                return   # Not started yet or within startup grace
            # Started but no AO tick yet — will fall through to reconnect
        else:
            if ao_age < STALE_THRESHOLD_SECONDS:
                self._consecutive_failures = 0
                return   # AO is healthy

        # ── AO feed stale — apply cooldown guard (Fix 3) then reconnect ───────
        cooldown_remaining = self.MIN_RESTART_INTERVAL - (now_mono - self._last_restart_at)
        if cooldown_remaining > 0:
            logger.info(
                f"[RECONNECT MGR] Cooldown active — {cooldown_remaining:.0f}s remaining "
                f"(AO stale {ao_age:.0f}s)" if ao_age else
                f"[RECONNECT MGR] Cooldown active — {cooldown_remaining:.0f}s remaining"
            )
            return

        _reconnecting = True
        try:
            ao_age_str = f"{ao_age:.0f}s" if ao_age else "never"
            logger.warning(
                f"[RECONNECT MGR] AO stale ({ao_age_str}) — restarting "
                f"(attempt #{self._reconnect_count + 1})"
            )
            await self._do_reconnect()
        finally:
            _reconnecting = False

    async def _do_reconnect(self) -> None:
        """
        Execute the reconnect sequence.

        Prefers AngelOneTickerAdapter.restart() which:
          - Closes existing WebSocket cleanly (with _force_stopped guard)
          - Resets _reconnect_count so _MAX_RECONNECT_ATTEMPTS doesn't block
          - Fetches fresh auth_token + feed_token from DB
          - Recreates SmartWebSocketV2 and calls connect()
          - On _on_open: resubscribes all tokens from _subscribed list
        """
        try:
            # Prefer angel adapter restart — correct way to restart SmartStream
            angel = getattr(self._ltp_consumer, '_angel_adapter', None)
            if angel and hasattr(angel, 'restart'):
                await angel.restart()
            else:
                # Fallback for Zerodha or setups without angel adapter
                stop_fn = getattr(self._ltp_consumer, 'stop', None)
                if stop_fn:
                    try:
                        stop_fn()   # sync call
                    except Exception as e:
                        logger.debug(f"[RECONNECT MGR] stop error (expected): {e}")
                start_fn = getattr(self._ltp_consumer, 'start', None)
                if start_fn:
                    tokens = getattr(self._ltp_consumer, '_subscribed_tokens', [])
                    start_fn(tokens)   # sync call with tokens
                else:
                    logger.error("[RECONNECT MGR] LTPConsumer has no start method")
                    self._consecutive_failures += 1
                    return

            # ── Success ───────────────────────────────────────────────────────
            self._reconnect_count     += 1
            self._consecutive_failures = 0
            self._last_reconnect_at    = datetime.now(timezone.utc)
            self._last_restart_at      = _time.monotonic()   # Fix 3: stamp for cooldown

            logger.info(
                f"[RECONNECT MGR] ✅ Reconnect initiated "
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
                    f"reconnect failures. Market data feed is DOWN. Manual intervention required. "
                    f"Call POST /api/v1/system/smartstream/start"
                )

    def _log_status(self) -> None:
        """5-minute periodic SmartStream health log."""
        angel         = getattr(self._ltp_consumer, '_angel_adapter', None)
        is_connected  = getattr(angel, '_connected', None)
        ao_reconnects = getattr(angel, '_reconnect_count', 0)
        now_mono      = _time.monotonic()
        last_ao_tick  = getattr(angel, '_last_ao_tick', 0.0) if angel else 0.0
        last_zd_tick  = getattr(self._ltp_consumer, '_last_zd_tick', 0.0)
        ao_age        = round(now_mono - last_ao_tick, 1) if last_ao_tick > 0 else None
        zd_age        = round(now_mono - last_zd_tick, 1) if last_zd_tick > 0 else None
        logger.info(
            f"[RECONNECT MGR] 5-min status — ao_connected={is_connected} "
            f"ao_tick_age={ao_age}s zd_tick_age={zd_age}s "
            f"mgr_reconnects={self._reconnect_count} "
            f"adapter_reconnects={ao_reconnects} consecutive_failures={self._consecutive_failures}"
        )

    def get_status(self) -> dict:
        """Return current reconnect manager status — for health checks."""
        angel        = getattr(self._ltp_consumer, '_angel_adapter', None)
        is_connected = getattr(angel, '_connected', None)
        last_tick    = getattr(self._ltp_consumer, 'last_tick_time', None)
        now_mono     = _time.monotonic()
        feed_age     = (now_mono - last_tick) if last_tick is not None else None

        return {
            "reconnect_count":        self._reconnect_count,
            "consecutive_failures":   self._consecutive_failures,
            "last_reconnect_at":      self._last_reconnect_at.isoformat() if self._last_reconnect_at else None,
            "feed_age_seconds":       round(feed_age, 1) if feed_age is not None else None,
            "feed_healthy":           (
                feed_age is not None
                and feed_age < STALE_THRESHOLD_SECONDS
            ),
            "ws_connected":           is_connected,
        }


# ── Singleton ─────────────────────────────────────────────────────────────────
broker_reconnect_manager = BrokerReconnectManager()
