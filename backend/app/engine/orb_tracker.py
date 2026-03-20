"""
ORB Tracker — Opening Range Breakout engine.

For each active ORB algo:
  1. During ORB window: track tick High and Low continuously
  2. After window closes: range is locked
  3. BUY  → entry when LTP crosses Range High (+ W&T buffer if set)
  4. SELL → entry when LTP crosses Range Low  (- W&T buffer if set)
  5. No breakout before orb_end_time → NO_TRADE

Entry fires on LTP cross — no candle close wait.
"""
import logging
from datetime import datetime, time
from typing import Dict, Callable, Optional
from dataclasses import dataclass

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
    # Runtime
    range_high:       float = 0.0
    range_low:        float = float("inf")
    is_range_set:     bool  = False
    is_triggered:     bool  = False
    is_no_trade:      bool  = False

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

    def __init__(self):
        self._windows: Dict[str, ORBWindow]   = {}
        self._callbacks: Dict[str, Callable]  = {}

    def register(self, window: ORBWindow, on_entry: Callable):
        """on_entry(grid_entry_id, entry_price, orb_high, orb_low) called on breakout."""
        self._windows[window.grid_entry_id]   = window
        self._callbacks[window.grid_entry_id] = on_entry
        logger.info(f"ORB registered: {window.algo_id} | {window.start_time}–{window.end_time} | {window.direction}")

    def deregister(self, grid_entry_id: str):
        self._windows.pop(grid_entry_id, None)
        self._callbacks.pop(grid_entry_id, None)

    async def on_tick(self, token: int, ltp: float, tick: dict):
        """Called on every tick — evaluate all ORB windows."""
        now = datetime.now().time()
        for eid, w in list(self._windows.items()):
            if w.instrument_token != token or w.is_triggered or w.is_no_trade:
                continue

            # Inside window — track range
            if w.start_time <= now <= w.end_time:
                w.range_high = max(w.range_high, ltp)
                w.range_low  = min(w.range_low, ltp)
                continue

            # Window just closed — lock range
            if not w.is_range_set:
                if w.range_high == 0 or w.range_low == float("inf"):
                    w.is_no_trade = True
                    logger.info(f"ORB no trade (no ticks): {w.algo_id}")
                    continue
                w.is_range_set = True
                logger.info(
                    f"ORB range locked: {w.algo_id} | "
                    f"H={w.range_high} L={w.range_low} | "
                    f"Entry H={w.entry_high():.2f} L={w.entry_low():.2f}"
                )

            # Monitor for breakout
            if w.direction == "buy" and ltp >= w.entry_high():
                w.is_triggered = True
                logger.info(f"🟢 ORB BUY triggered: {w.algo_id} @ {ltp} | H={w.range_high} L={w.range_low}")
                cb = self._callbacks.get(eid)
                if cb:
                    await cb(eid, w.entry_high(), w.range_high, w.range_low)

            elif w.direction == "sell" and ltp <= w.entry_low():
                w.is_triggered = True
                logger.info(f"🔴 ORB SELL triggered: {w.algo_id} @ {ltp} | H={w.range_high} L={w.range_low}")
                cb = self._callbacks.get(eid)
                if cb:
                    await cb(eid, w.entry_low(), w.range_high, w.range_low)
