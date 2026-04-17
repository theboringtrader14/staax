"""
W&T Evaluator — Wait and Trade engine.

  1. At configured entry time (E:) — capture reference price (LTP)
  2. Compute threshold: ref ± X% or ± X pts
  3. Monitor every tick until threshold is crossed
  4. Fire entry signal immediately — no candle wait

Example: ATM CE = 133 at 9:35. W&T Up 10% → entry at 146.3.
"""
import logging
from datetime import datetime, time
from typing import Dict, Callable
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class WTWindow:
    grid_entry_id:    str
    algo_id:          str
    direction:        str       # "up" or "down"
    entry_time:       time      # time to capture reference price
    instrument_token: int
    wt_value:         float
    wt_unit:          str       # "pts" or "pct"
    # Runtime
    reference_price:  float = 0.0
    threshold:        float = 0.0
    is_ref_set:       bool  = False
    is_triggered:     bool  = False
    registered_at:    datetime = field(default_factory=datetime.now)

    def compute_threshold(self):
        if self.direction == "up":
            self.threshold = (
                self.reference_price * (1 + self.wt_value / 100)
                if self.wt_unit == "pct"
                else self.reference_price + self.wt_value
            )
        else:
            self.threshold = (
                self.reference_price * (1 - self.wt_value / 100)
                if self.wt_unit == "pct"
                else self.reference_price - self.wt_value
            )


class WTEvaluator:
    """Manages all active W&T windows. Registered as LTP callback."""

    def __init__(self):
        self._windows: Dict[str, WTWindow]   = {}
        self._callbacks: Dict[str, Callable] = {}

    def register(self, window: WTWindow, on_entry: Callable):
        self._windows[window.grid_entry_id]   = window
        self._callbacks[window.grid_entry_id] = on_entry
        logger.info(
            f"W&T registered: {window.algo_id} | "
            f"{window.direction} {window.wt_value}{window.wt_unit} at {window.entry_time}"
        )

    def deregister(self, grid_entry_id: str):
        self._windows.pop(grid_entry_id, None)
        self._callbacks.pop(grid_entry_id, None)

    async def on_tick(self, token: int, ltp: float, tick: dict):
        now = datetime.now().time()
        for eid, w in list(self._windows.items()):
            if w.instrument_token != token or w.is_triggered:
                continue

            # Capture reference at entry time
            if not w.is_ref_set:
                if now >= w.entry_time:
                    w.reference_price = ltp
                    w.compute_threshold()
                    w.is_ref_set = True
                    logger.info(f"W&T ref captured: {w.algo_id} | ref={ltp} threshold={w.threshold:.2f}")
                continue

            # Monitor threshold
            if w.direction == "up" and ltp >= w.threshold:
                w.is_triggered = True
                logger.info(f"🟢 W&T UP triggered: {w.algo_id} @ {ltp}")
                cb = self._callbacks.get(eid)
                if cb:
                    await cb(eid, ltp)

            elif w.direction == "down" and ltp <= w.threshold:
                w.is_triggered = True
                logger.info(f"🔴 W&T DOWN triggered: {w.algo_id} @ {ltp}")
                cb = self._callbacks.get(eid)
                if cb:
                    await cb(eid, ltp)
