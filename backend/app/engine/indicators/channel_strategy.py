"""
Channel Strategy — Highest High / Lowest Low channel breakout.

Translated from Pinescript to Python.

Logic:
  upper_channel = highest HIGH of last num_candles completed candles
  lower_channel = lowest  LOW  of last num_candles completed candles

  LONG  entry: close crosses above upper_channel
  LONG  exit:  close crosses below lower_channel  (long_only mode)
  SHORT entry: close crosses below lower_channel  (when long_only=False)

The channel is computed from closed candles EXCLUDING the current bar.
Default num_candles=1 (as in the Pinescript).
"""
import logging
from collections import deque
from typing import Optional

from app.engine.candle_fetcher import Candle
from app.engine.indicators import Signal

logger = logging.getLogger(__name__)


class ChannelStrategy:
    def __init__(
        self,
        timeframe_mins: int = 240,
        num_candles: int = 1,
        long_only: bool = True,
    ):
        self._tf        = timeframe_mins
        self._num       = num_candles
        self._long_only = long_only

        # Rolling window of completed candles (max needed = num_candles)
        self._completed: deque = deque(maxlen=max(num_candles, 100))
        self._prev_close: Optional[float] = None

    # ── Channel levels ────────────────────────────────────────────────────────

    @property
    def upper_channel(self) -> Optional[float]:
        if len(self._completed) < self._num:
            return None
        recent = list(self._completed)[-self._num:]
        return max(c.high for c in recent)

    @property
    def lower_channel(self) -> Optional[float]:
        if len(self._completed) < self._num:
            return None
        recent = list(self._completed)[-self._num:]
        return min(c.low for c in recent)

    # ── Signal generation ─────────────────────────────────────────────────────

    def on_candle(self, candle: Candle) -> Optional[Signal]:
        """
        Process a completed candle. Channel is computed BEFORE appending the
        current candle (Pinescript: uses previous bars, excluding current).
        Returns a Signal on breakout, None otherwise.
        """
        upper = self.upper_channel
        lower = self.lower_channel

        curr  = candle.close
        prev  = self._prev_close

        # Append current candle to completed window AFTER reading channel
        self._completed.append(candle)
        self._prev_close = curr

        # Need at least one prior close to detect crossover
        if prev is None or upper is None or lower is None:
            return None

        # LONG entry: close crosses above upper channel
        if prev < upper <= curr:
            logger.info(
                f"[CHANNEL] LONG entry — close {curr:.2f} crossed above upper {upper:.2f}"
            )
            return Signal(type="entry", direction="buy", price=curr, reason="CHANNEL_LONG")

        # Lower channel cross — exit long (or short entry if not long_only)
        if prev > lower >= curr:
            if self._long_only:
                logger.info(
                    f"[CHANNEL] LONG exit — close {curr:.2f} crossed below lower {lower:.2f}"
                )
                return Signal(type="exit", direction="sell", price=curr, reason="CHANNEL_EXIT")
            else:
                logger.info(
                    f"[CHANNEL] SHORT entry — close {curr:.2f} crossed below lower {lower:.2f}"
                )
                return Signal(type="entry", direction="sell", price=curr, reason="CHANNEL_SHORT")

        return None
