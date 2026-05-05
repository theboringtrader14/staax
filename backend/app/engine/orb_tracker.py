"""
ORB Tracker — Opening Range Breakout engine.

For each active ORB algo:
  1. During ORB window: range is fetched from broker OHLC candle API after window closes
  2. After window closes: _fetch_and_set_range() fetches OHLC, locks range_high / range_low
  3. BUY  → entry when a 1-minute candle CLOSES above Range High
  4. SELL → entry when a 1-minute candle CLOSES below Range Low
  5. No range data from API → NO_TRADE

Entry fires on candle close confirmation — not on raw LTP cross.
"""
import asyncio
import logging
from datetime import datetime, time
from typing import Dict, Callable, Optional
from dataclasses import dataclass, field
from zoneinfo import ZoneInfo

from app.engine.candle_fetcher import CandleAggregator

IST = ZoneInfo("Asia/Kolkata")

logger = logging.getLogger(__name__)


@dataclass
class ORBWindow:
    grid_entry_id:    str
    algo_id:          str
    direction:        str        # "buy" or "sell"
    start_time:       time
    end_time:         time
    instrument_token: int
    wt_value:         float = 0.0
    wt_unit:          str   = "pts"  # "pts" or "pct"
    # "underlying" = fetch OHLC for underlying index (default)
    # "instrument" = fetch OHLC for pre-selected option/futures
    orb_range_source: str   = "underlying"
    # New fields for candle-based range fetch
    symbol:           str   = ""         # e.g. "BANKNIFTY2550645000CE" or "NIFTY"
    exchange:         str   = "NFO"      # exchange for broker API call
    orb_start_str:    str   = ""         # "YYYY-MM-DD HH:MM" IST for API from_dt
    orb_end_str:      str   = ""         # "YYYY-MM-DD HH:MM" IST for API to_dt
    entry_at:         str   = "high"     # 'high' (buy breakout) or 'low' (sell breakout)
    # Runtime
    range_high:       float = 0.0
    range_low:        float = float("inf")
    is_range_set:     bool  = False
    is_fetching:      bool  = False      # True while async OHLC fetch is in-flight
    is_triggered:     bool  = False
    is_no_trade:      bool  = False
    # Per-window broker reference (set at registration time by algo_runner)
    _broker:          object = field(default=None, repr=False)

    def entry_high(self) -> float:
        """BUY entry = ORB High + W&T buffer."""
        if self.wt_unit == "pct":
            return self.range_high * (1 + self.wt_value / 100)
        return self.range_high + self.wt_value

    def entry_low(self) -> float:
        """SELL entry = ORB Low - W&T buffer."""
        if self.wt_unit == "pct":
            return self.range_low * (1 - self.wt_value / 100)
        return self.range_low - self.wt_value


class ORBTracker:
    """Manages all active ORB windows. Registered as LTP callback."""

    def __init__(self, broker=None):
        self._windows: Dict[str, ORBWindow]   = {}
        self._callbacks: Dict[str, Callable]  = {}
        self._broker = broker  # global fallback broker; prefer window._broker
        self._candle_aggs: Dict[int, CandleAggregator] = {}  # token → 1-min aggregator

    def register(self, window: ORBWindow, on_entry: Callable):
        """on_entry(grid_entry_id, entry_price, orb_high, orb_low) called on breakout."""
        self._windows[window.grid_entry_id]   = window
        self._callbacks[window.grid_entry_id] = on_entry
        # One 1-minute aggregator per instrument token — shared across algos on same token
        if window.instrument_token not in self._candle_aggs:
            self._candle_aggs[window.instrument_token] = CandleAggregator(timeframe_mins=1)
        logger.info(f"ORB registered: {window.algo_id} | {window.start_time}–{window.end_time} | {window.direction}")

    def deregister(self, grid_entry_id: str):
        w = self._windows.pop(grid_entry_id, None)
        self._callbacks.pop(grid_entry_id, None)
        # Clean up the candle aggregator if no other windows use this token
        if w is not None:
            token = w.instrument_token
            if not any(win.instrument_token == token for win in self._windows.values()):
                self._candle_aggs.pop(token, None)

    async def on_tick(self, token: int, ltp: float, tick: dict):
        """
        Called on every tick.
        1. Detects window close → triggers async OHLC fetch.
        2. Feeds ticks into 1-min CandleAggregator → calls on_candle_close when bar completes.
        """
        now = datetime.now().time()
        for eid, w in list(self._windows.items()):
            if w.instrument_token != token or w.is_triggered or w.is_no_trade:
                continue

            # Inside window — nothing to do; range comes from broker OHLC API
            if w.start_time <= now <= w.end_time:
                continue

            # Window just closed — kick off async OHLC fetch (once)
            if not w.is_range_set and not w.is_fetching:
                w.is_fetching = True
                asyncio.create_task(self._fetch_and_set_range(w))

        # Feed registered tokens into their candle aggregator
        # on_candle_close filters windows by is_range_set so safe to call always
        if token in self._candle_aggs:
            candle = self._candle_aggs[token].on_tick(ltp, datetime.now(IST))
            if candle is not None:
                await self.on_candle_close(token, candle.close)

    async def _fetch_and_set_range(self, window: ORBWindow) -> None:
        """
        Fetch 1-minute OHLC candles for the ORB window from the broker API
        and lock range_high / range_low.  Marks is_no_trade on any failure.
        """
        try:
            # Prefer per-window broker set at registration time; fall back to global
            broker = window._broker or self._broker
            if not broker:
                logger.error(
                    f"[ORB] No broker set — cannot fetch OHLC for {window.algo_id}"
                )
                window.is_no_trade = True
                return

            candles = await broker.get_candle_data(
                symbol=window.symbol,
                exchange=window.exchange,
                interval="ONE_MINUTE",
                symbol_token=str(window.instrument_token),
                from_dt=window.orb_start_str,
                to_dt=window.orb_end_str,
            )
            if not candles:
                logger.warning(
                    f"[ORB] No candle data for {window.symbol} "
                    f"{window.orb_start_str}→{window.orb_end_str}"
                )
                window.is_no_trade = True
                return

            # Angel One returns [timestamp, open, high, low, close, volume]
            window.range_high = max(c[2] for c in candles)
            window.range_low  = min(c[3] for c in candles)
            window.is_range_set = True
            logger.info(
                f"[ORB] Range set via OHLC for {window.symbol}: "
                f"high={window.range_high:.2f} low={window.range_low:.2f} "
                f"({len(candles)} candles) "
                f"entry_at={window.entry_at}"
            )
        except Exception as e:
            logger.error(
                f"[ORB] Range fetch failed for {window.algo_id}: {e}"
            )
            window.is_no_trade = True

    async def on_candle_close(self, token: int, candle_close: float) -> None:
        """
        Called when a 1-minute candle closes for the given instrument token.
        Checks all registered ORB windows and fires the entry callback when
        the close confirms a breakout above range_high or below range_low.
        """
        for eid, w in list(self._windows.items()):
            if (
                w.instrument_token != token
                or not w.is_range_set
                or w.is_triggered
                or w.is_no_trade
            ):
                continue

            entry_high = w.entry_high()
            entry_low  = w.entry_low()

            if w.entry_at == "high" and candle_close > entry_high:
                w.is_triggered = True
                logger.info(
                    f"[ORB] CANDLE CLOSE BUY confirmed: {w.algo_id} "
                    f"close={candle_close:.2f} > {entry_high:.2f}"
                )
                cb = self._callbacks.get(eid)
                if cb:
                    await cb(eid, candle_close, w.range_high, w.range_low)
                self.deregister(eid)

            elif w.entry_at == "low" and candle_close < entry_low:
                w.is_triggered = True
                logger.info(
                    f"[ORB] CANDLE CLOSE SELL confirmed: {w.algo_id} "
                    f"close={candle_close:.2f} < {entry_low:.2f}"
                )
                cb = self._callbacks.get(eid)
                if cb:
                    await cb(eid, candle_close, w.range_high, w.range_low)
                self.deregister(eid)
