"""
TSL Engine — Trailing Stop Loss (Stepped Logic).

Rules:
  - Activates immediately from entry — no lock-in period
  - For every X move in favour, SL shifts Y in the same direction
  - X and Y in same unit (pts or %)
  - TSL only moves favourably — never reverses

Example: Buy @ 100, TSL X=5pts Y=3pts, initial SL=90
  Price 105 → SL=93  (trail #1)
  Price 110 → SL=96  (trail #2)
  Price 115 → SL=99  (trail #3)
  Price falls to 99  → SL Monitor fires exit
"""
import logging
from typing import Dict
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class TSLState:
    order_id:           str
    direction:          str
    entry_price:        float
    current_sl:         float
    tsl_x:              float
    tsl_y:              float
    tsl_unit:           str        # "pts" or "pct"
    trail_count:        int   = 0
    last_trigger_price: float = 0.0

    def __post_init__(self):
        self.last_trigger_price = self.entry_price

    def check_and_trail(self, ltp: float) -> bool:
        """Check if SL should move. Returns True if updated."""
        x = self.tsl_x if self.tsl_unit == "pts" else self.entry_price * self.tsl_x / 100
        y = self.tsl_y if self.tsl_unit == "pts" else self.entry_price * self.tsl_y / 100

        if self.direction == "buy":
            steps = int((ltp - self.last_trigger_price) / x)
            if steps > 0:
                new_sl = self.current_sl + (steps * y)
                if new_sl > self.current_sl:
                    self.current_sl         = new_sl
                    self.last_trigger_price += steps * x
                    self.trail_count        += steps
                    logger.info(f"TSL trailed: {self.order_id} → SL={self.current_sl:.2f} (trail #{self.trail_count})")
                    return True
        else:
            steps = int((self.last_trigger_price - ltp) / x)
            if steps > 0:
                new_sl = self.current_sl - (steps * y)
                if new_sl < self.current_sl:
                    self.current_sl         = new_sl
                    self.last_trigger_price -= steps * x
                    self.trail_count        += steps
                    logger.info(f"TSL trailed: {self.order_id} → SL={self.current_sl:.2f} (trail #{self.trail_count})")
                    return True
        return False


class TSLEngine:
    """Manages TSL for all open positions. Registered as LTP callback."""

    def __init__(self, sl_monitor):
        self.sl_monitor = sl_monitor
        self._states: Dict[str, TSLState] = {}

    def register(self, state: TSLState):
        self._states[state.order_id] = state
        logger.info(f"TSL registered: {state.order_id} | X={state.tsl_x}{state.tsl_unit} Y={state.tsl_y}{state.tsl_unit}")

    def deregister(self, order_id: str):
        self._states.pop(order_id, None)

    def has_trailed(self, order_id: str) -> bool:
        """True if TSL has moved at least once — used by AT_COST re-entry check."""
        s = self._states.get(order_id)
        return s is not None and s.trail_count > 0

    async def on_tick(self, token: int, ltp: float, tick: dict):
        for order_id, state in list(self._states.items()):
            pos = self.sl_monitor._positions.get(order_id)
            if not pos or not pos.is_active or pos.instrument_token != token:
                continue
            if state.check_and_trail(ltp):
                self.sl_monitor.update_sl(order_id, state.current_sl)
