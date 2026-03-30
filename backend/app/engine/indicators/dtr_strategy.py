"""
DTR Strategy — Daily Trading Range.

Translated from Pinescript to Python.

Logic:
  prev_range = prev_day_high - prev_day_low
  UPP1 = day_open + (prev_range * 0.5589)   ← upper pivot
  LPP1 = day_open - (prev_range * 0.5589)   ← lower pivot

  LONG  entry: close crossover  UPP1  (prev < UPP1 <= curr)
  SHORT entry: close crossunder LPP1  (prev > LPP1 >= curr)

set_daily_data() must be called once per day before market open
with previous day's OHLC data.
"""
import logging
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

        # Tracks previous candle close for crossover detection
        self._prev_close: Optional[float] = None

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

        logger.info(
            f"[DTR] Daily data set — open={day_open:.2f} "
            f"prev_H={prev_high:.2f} prev_L={prev_low:.2f} "
            f"UPP1={self.upper_pivot:.2f} LPP1={self.lower_pivot:.2f}"
        )

    # ── Pivots ────────────────────────────────────────────────────────────────

    @property
    def upper_pivot(self) -> Optional[float]:
        if self._day_open is None or self._prev_high is None or self._prev_low is None:
            return None
        return self._day_open + (self._prev_high - self._prev_low) * 0.5589

    @property
    def lower_pivot(self) -> Optional[float]:
        if self._day_open is None or self._prev_high is None or self._prev_low is None:
            return None
        return self._day_open - (self._prev_high - self._prev_low) * 0.5589

    # ── Signal generation ─────────────────────────────────────────────────────

    def on_candle(self, candle: Candle) -> Optional[Signal]:
        """
        Process a completed candle. Returns a Signal on crossover/crossunder,
        None otherwise.
        """
        curr = candle.close

        # Seed prev_close from first candle of the day
        if self._prev_close is None:
            self._prev_close = curr
            return None

        upp1 = self.upper_pivot
        lpp1 = self.lower_pivot

        if upp1 is None:
            # Daily data not yet set — skip
            self._prev_close = curr
            return None

        prev = self._prev_close
        self._prev_close = curr

        # LONG: close crosses above UPP1
        if self._longs and prev < upp1 <= curr:
            logger.info(
                f"[DTR] LONG signal — close {curr:.2f} crossed above UPP1 {upp1:.2f}"
            )
            return Signal(type="entry", direction="buy", price=curr, reason="L1")

        # SHORT: close crosses below LPP1
        if self._shorts and prev > lpp1 >= curr:
            logger.info(
                f"[DTR] SHORT signal — close {curr:.2f} crossed below LPP1 {lpp1:.2f}"
            )
            return Signal(type="entry", direction="sell", price=curr, reason="S1")

        return None
