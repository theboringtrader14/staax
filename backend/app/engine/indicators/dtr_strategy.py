"""
DTR Strategy — Daily Trading Range.

Translated from Pinescript to Python.

Logic:
  PR   = prev_day_high - prev_day_low
  UPP  = day_open + (PR × 0.28657)   ← inner upper  (visual only)
  LPP  = day_open - (PR × 0.28657)   ← inner lower  (visual only)
  UPP1 = day_open + (PR × 0.55890)   ← outer upper  (signal line)
  LPP1 = day_open - (PR × 0.55890)   ← outer lower  (signal line)

  LONG  entry: ta.crossover(close, UPP1)  → prev_close <= UPP1 AND close > UPP1
  SHORT entry: ta.crossunder(close, LPP1) → prev_close >= LPP1 AND close < LPP1

set_daily_data() must be called once per day before market open
with previous day's OHLC data.
"""
import logging
from datetime import datetime, timezone
from typing import Optional

from app.engine.candle_fetcher import Candle
from app.engine.indicators import Signal

logger = logging.getLogger(__name__)


class DTRStrategy:
    def __init__(self, longs_enabled: bool = True, shorts_enabled: bool = False):
        self._longs   = longs_enabled
        self._shorts  = shorts_enabled

        # Set by set_daily_data() each morning
        self._day_open:  Optional[float] = None
        self._prev_high: Optional[float] = None
        self._prev_low:  Optional[float] = None

        # Pre-computed pivots (updated in set_daily_data)
        self._upp:  Optional[float] = None   # inner upper  (0.28657)
        self._lpp:  Optional[float] = None   # inner lower  (0.28657)
        self._upp1: Optional[float] = None   # outer upper  (0.55890) — signal line
        self._lpp1: Optional[float] = None   # outer lower  (0.55890) — signal line

        # Tracks previous candle close for crossover detection
        self._prev_close: Optional[float] = None

        # Failure tracking for rate-limited warnings
        self._data_load_failed: bool = False
        self._last_warn_ts: Optional[datetime] = None

    # ── Daily setup ───────────────────────────────────────────────────────────

    def set_daily_data(self, day_open: float, prev_high: float,
                       prev_low: float, prev_close: float) -> None:
        """
        Called once per morning before market open.
        Resets prev_close so crossovers are detected fresh each day.
        """
        self._day_open  = day_open
        self._prev_high = prev_high
        self._prev_low  = prev_low
        self._prev_close = None   # reset; first candle of the day seeds it

        pr = prev_high - prev_low
        self._upp  = day_open + pr * 0.28657
        self._lpp  = day_open - pr * 0.28657
        self._upp1 = day_open + pr * 0.55890
        self._lpp1 = day_open - pr * 0.55890

        # Clear failure flag on successful data load
        self._data_load_failed = False
        self._last_warn_ts = None

        logger.info(
            f"[DTR] Daily data set — open={day_open:.2f} "
            f"prev_H={prev_high:.2f} prev_L={prev_low:.2f} "
            f"UPP1={self._upp1:.2f} LPP1={self._lpp1:.2f} "
            f"UPP={self._upp:.2f} LPP={self._lpp:.2f}"
        )

    def mark_data_failed(self, bot_id: str) -> None:
        """Called when load_daily_data() fails — sets failure flag and logs error."""
        self._data_load_failed = True
        logger.error(
            "[DTR] Daily data load failed — bot %s will not fire signals until data is loaded",
            bot_id,
        )

    # ── Pivots ────────────────────────────────────────────────────────────────

    @property
    def upper(self) -> Optional[float]:
        """Inner upper band (PR × 0.28657) — visual only."""
        return self._upp

    @property
    def lower(self) -> Optional[float]:
        """Inner lower band (PR × 0.28657) — visual only."""
        return self._lpp

    @property
    def upper_pivot(self) -> Optional[float]:
        """Outer upper band (PR × 0.55890) — signal line."""
        return self._upp1

    @property
    def lower_pivot(self) -> Optional[float]:
        """Outer lower band (PR × 0.55890) — signal line."""
        return self._lpp1

    # ── Signal generation ─────────────────────────────────────────────────────

    def on_candle(self, candle: Candle, channel_candles=None) -> Optional[Signal]:
        """
        Process a completed candle. Returns a Signal on crossover/crossunder,
        None otherwise.

        Pine Script crossover semantics:
          ta.crossover(close, UPP1)  → prev_close <= UPP1 AND close > UPP1
          ta.crossunder(close, LPP1) → prev_close >= LPP1 AND close < LPP1
        """
        curr = candle.close

        # Seed prev_close from first candle of the day
        if self._prev_close is None:
            self._prev_close = curr
            return None

        if self._upp1 is None:
            # Rate-limit warning to once per minute
            now = datetime.now(timezone.utc)
            if self._data_load_failed:
                if self._last_warn_ts is None or (now - self._last_warn_ts).total_seconds() >= 60:
                    logger.warning("[DTR] Waiting for daily data — no signals will fire")
                    self._last_warn_ts = now
            self._prev_close = curr
            return None

        prev = self._prev_close
        self._prev_close = curr

        # LONG: ta.crossover — prev <= UPP1 AND curr > UPP1
        if self._longs and prev <= self._upp1 and curr > self._upp1:
            logger.info(
                f"[DTR] LONG signal — close {curr:.2f} crossed above UPP1 {self._upp1:.2f}"
            )
            return Signal(type="entry", direction="buy", price=curr, reason="DTR_LONG")

        # SHORT: ta.crossunder — prev >= LPP1 AND curr < LPP1
        if self._shorts and prev >= self._lpp1 and curr < self._lpp1:
            logger.info(
                f"[DTR] SHORT signal — close {curr:.2f} crossed below LPP1 {self._lpp1:.2f}"
            )
            return Signal(type="entry", direction="sell", price=curr, reason="DTR_SHORT")

        return None
