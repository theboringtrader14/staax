"""
CandleFetcher — aggregates 1-minute tick prices into OHLC candles.
Used by IndicatorEngine to compute signals.
"""
import logging
from collections import defaultdict, deque
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from typing import Dict, List, Optional, Tuple

IST = ZoneInfo("Asia/Kolkata")
logger = logging.getLogger(__name__)

class Candle:
    def __init__(self, open_: float, high: float, low: float, close: float,
                 ts: datetime, is_complete: bool = True):
        self.open        = open_
        self.high        = high
        self.low         = low
        self.close       = close
        self.ts          = ts
        self.timestamp   = ts          # alias used by strategy classes
        self.is_complete = is_complete

    def __repr__(self):
        return f"Candle({self.ts.strftime('%H:%M')} O={self.open} H={self.high} L={self.low} C={self.close})"

class CandleAggregator:
    """
    Aggregates 1-minute ticks into candles of any timeframe.
    Maintains a rolling window of completed candles per instrument.
    """
    def __init__(self, timeframe_mins: int, max_candles: int = 100):
        self._tf     = timeframe_mins
        self._max    = max_candles
        self._bars: deque[Candle] = deque(maxlen=max_candles)
        self._current_open:  Optional[float]    = None
        self._current_high:  float = 0.0
        self._current_low:   float = float('inf')
        self._current_close: float = 0.0
        self._current_ts:    Optional[datetime] = None

    def _bar_start(self, ts: datetime) -> datetime:
        """Get the start of the current bar for this timestamp."""
        mins = ts.hour * 60 + ts.minute
        bar_start_mins = (mins // self._tf) * self._tf
        return ts.replace(hour=bar_start_mins // 60, minute=bar_start_mins % 60, second=0, microsecond=0)

    def on_tick(self, price: float, ts: datetime) -> Optional[Candle]:
        """
        Process a tick. Returns a completed candle if a new bar started.
        """
        bar_ts = self._bar_start(ts)

        if self._current_ts is None:
            # First tick
            self._current_ts    = bar_ts
            self._current_open  = price
            self._current_high  = price
            self._current_low   = price
            self._current_close = price
            return None

        if bar_ts > self._current_ts:
            # New bar — complete current and start new
            completed = Candle(
                open_=self._current_open,
                high=self._current_high,
                low=self._current_low,
                close=self._current_close,
                ts=self._current_ts,
            )
            self._bars.append(completed)
            # Start new bar
            self._current_ts    = bar_ts
            self._current_open  = price
            self._current_high  = price
            self._current_low   = price
            self._current_close = price
            return completed
        else:
            # Same bar — update
            self._current_high  = max(self._current_high, price)
            self._current_low   = min(self._current_low, price)
            self._current_close = price
            return None

    @property
    def candles(self) -> List[Candle]:
        """All completed candles, oldest first."""
        return list(self._bars)

    @property
    def latest(self) -> Optional[Candle]:
        return self._bars[-1] if self._bars else None

    def highs(self, n: int) -> List[float]:
        bars = list(self._bars)[-n:]
        return [b.high for b in bars]

    def lows(self, n: int) -> List[float]:
        bars = list(self._bars)[-n:]
        return [b.low for b in bars]

    def closes(self, n: int) -> List[float]:
        bars = list(self._bars)[-n:]
        return [b.close for b in bars]


class CandleStore:
    """Global store of CandleAggregators per (instrument_token, timeframe)."""

    def __init__(self):
        self._aggregators: Dict[Tuple[int, int], CandleAggregator] = {}

    def get_or_create(self, token: int, timeframe_mins: int) -> CandleAggregator:
        key = (token, timeframe_mins)
        if key not in self._aggregators:
            self._aggregators[key] = CandleAggregator(timeframe_mins)
        return self._aggregators[key]

    def on_tick(self, token: int, price: float, ts: datetime):
        """Process tick for all aggregators watching this token."""
        for (t, tf), agg in self._aggregators.items():
            if t == token:
                agg.on_tick(price, ts)


candle_store = CandleStore()
