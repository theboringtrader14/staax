"""
TT Bands Strategy — Fractal-based dynamic band with crossover signals.

Logic:
  Fractal HIGH at bar[-3]:  high[-3] > high[-2] AND high[-3] > high[-1]
                        AND high[-3] > high[-4] AND high[-3] > high[-5]
  Fractal LOW  at bar[-3]:  low[-3]  < low[-2]  AND low[-3]  < low[-1]
                        AND low[-3]  < low[-4]   AND low[-3]  < low[-5]

  highline = rolling mean of last `lookback` confirmed fractal highs
  lowline  = rolling mean of last `lookback` confirmed fractal lows

  BUY  signal: close crosses ABOVE highline  (prev_close < highline, curr_close >= highline)
  SELL signal: close crosses BELOW lowline   (prev_close > lowline,  curr_close <= lowline)

Requires at least 5 completed candles before the check bar to detect fractals.
Requires at least `lookback` fractals before emitting any signal.
"""
import logging
from collections import deque
from statistics import mean
from typing import Optional

from app.engine.candle_fetcher import Candle
from app.engine.indicators import Signal

logger = logging.getLogger(__name__)


class TTBandsStrategy:
    def __init__(
        self,
        timeframe_mins: int = 5,
        lookback: int = 5,
        long_only: bool = True,
    ):
        self._tf        = timeframe_mins
        self._lookback  = lookback
        self._long_only = long_only

        # Rolling window of completed candles — need at least 6 to check bar[-3]
        self._completed: deque = deque(maxlen=500)

        # Deques of confirmed fractal highs/lows (rolling, capped at lookback)
        self._fractal_highs: deque = deque(maxlen=lookback)
        self._fractal_lows:  deque = deque(maxlen=lookback)

        self._prev_close: Optional[float] = None

    # ── Band levels ───────────────────────────────────────────────────────────

    @property
    def highline(self) -> Optional[float]:
        if len(self._fractal_highs) < self._lookback:
            return None
        return mean(self._fractal_highs)

    @property
    def lowline(self) -> Optional[float]:
        if len(self._fractal_lows) < self._lookback:
            return None
        return mean(self._fractal_lows)

    # ── Session reset ─────────────────────────────────────────────────────────

    def reset_session(self) -> None:
        """
        Called at each MCX session boundary (09:00 IST).
        Clears fractal state so previous-day fractals don't contaminate the new session.
        Keeps _completed history — channel levels remain valid across sessions.
        """
        self._fractal_highs.clear()
        self._fractal_lows.clear()
        self._prev_close = None
        logger.info("[TT_BANDS] Session reset — fractal deques cleared, prev_close reset")

    # ── Fractal detection ─────────────────────────────────────────────────────

    def _check_fractal(self) -> None:
        """
        After appending the latest candle, check if bar[-3] (index -3 in the
        completed deque) is a confirmed fractal high or low.
        Requires at least 5 bars in the window (indices -1 … -5).
        """
        bars = list(self._completed)
        if len(bars) < 5:
            return

        # bar at index -3 is the candidate (confirmed by -2, -1 on the right
        # and -4, -5 on the left)
        b  = bars[-3]
        b1 = bars[-2]
        b2 = bars[-1]
        b4 = bars[-4]
        b5 = bars[-5]

        if (b.high > b1.high and b.high > b2.high and
                b.high > b4.high and b.high > b5.high):
            self._fractal_highs.append(b.high)
            logger.debug(f"[TT_BANDS] Fractal HIGH confirmed at {b.ts}: {b.high:.2f}")

        if (b.low < b1.low and b.low < b2.low and
                b.low < b4.low and b.low < b5.low):
            self._fractal_lows.append(b.low)
            logger.debug(f"[TT_BANDS] Fractal LOW confirmed at {b.ts}: {b.low:.2f}")

    # ── Signal generation ─────────────────────────────────────────────────────

    def on_candle(self, candle: Candle) -> Optional[Signal]:
        """
        Process a completed candle.
        1. Append it to the history.
        2. Check if bar[-3] is a fractal (updates fractal deques).
        3. Compute highline/lowline from the fractal deques.
        4. Detect crossover using prev_close vs curr_close.
        Returns a Signal on crossover, None otherwise.
        """
        curr = candle.close
        prev = self._prev_close

        # Append first so fractal check sees it as bar[-1]
        self._completed.append(candle)
        self._check_fractal()
        self._prev_close = curr

        high = self.highline
        low  = self.lowline

        if prev is None or high is None or low is None:
            return None

        # BUY: close crosses above highline
        if prev < high <= curr:
            logger.info(
                f"[TT_BANDS] BUY signal — close {curr:.2f} crossed above highline {high:.2f}"
            )
            return Signal(type="entry", direction="buy", price=curr, reason="TT_CROSS_HIGH")

        # SELL / exit
        if prev > low >= curr:
            if self._long_only:
                logger.info(
                    f"[TT_BANDS] EXIT signal — close {curr:.2f} crossed below lowline {low:.2f}"
                )
                return Signal(type="exit", direction="sell", price=curr, reason="TT_CROSS_LOW")
            else:
                logger.info(
                    f"[TT_BANDS] SELL signal — close {curr:.2f} crossed below lowline {low:.2f}"
                )
                return Signal(type="entry", direction="sell", price=curr, reason="TT_CROSS_LOW")

        return None
