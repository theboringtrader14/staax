"""
TTP Engine — Trailing Take Profit (Stepped Logic).

Mirror of TSLEngine but on the profit side.
Activates immediately from entry.
For every X move in favour, TP shifts Y further in the same direction.
TTP only moves favourably — never reverses.

Requires TP to be set on the leg. When TP is hit, SLTPMonitor fires exit as normal.

Example: Buy @ 100, TP=130, TTP X=5pts Y=3pts
  Price 105 → TP=133
  Price 110 → TP=136
  Price 115 → TP=139
  Price falls to 139 → TP monitor fires exit ✅

DB persistence:
  On every trail, the new TP and trail_count are written to:
    orders.target           — so SLTPMonitor reads the correct level after restart
    orders.ttp_activated    — True once first trail fires
    orders.ttp_current_tp   — explicit TTP column (mirrors target)
"""
import logging
from typing import Dict
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class TTPState:
    order_id:           str
    direction:          str
    entry_price:        float
    current_tp:         float
    ttp_x:              float
    ttp_y:              float
    ttp_unit:           str        # "pts" or "pct"
    trail_count:        int   = 0
    last_trigger_price: float = 0.0

    def __post_init__(self):
        self.last_trigger_price = self.entry_price

    def check_and_trail(self, ltp: float) -> bool:
        """Check if TP should move. Returns True if updated."""
        x = self.ttp_x if self.ttp_unit == "pts" else self.entry_price * self.ttp_x / 100
        y = self.ttp_y if self.ttp_unit == "pts" else self.entry_price * self.ttp_y / 100

        if self.direction == "buy":
            steps = int((ltp - self.last_trigger_price) / x)
            if steps > 0:
                new_tp = self.current_tp + (steps * y)
                if new_tp > self.current_tp:
                    self.current_tp         = new_tp
                    self.last_trigger_price += steps * x
                    self.trail_count        += steps
                    logger.info(f"TTP trailed: {self.order_id} → TP={self.current_tp:.2f} (trail #{self.trail_count})")
                    return True
        else:
            steps = int((self.last_trigger_price - ltp) / x)
            if steps > 0:
                new_tp = self.current_tp - (steps * y)
                if new_tp < self.current_tp:
                    self.current_tp         = new_tp
                    self.last_trigger_price -= steps * x
                    self.trail_count        += steps
                    logger.info(f"TTP trailed: {self.order_id} → TP={self.current_tp:.2f} (trail #{self.trail_count})")
                    return True
        return False


class TTPEngine:
    """Manages TTP for all open positions. Registered as LTP callback."""

    def __init__(self, sl_monitor):
        self.sl_monitor = sl_monitor
        self._states: Dict[str, TTPState] = {}

    def register(self, state: TTPState):
        self._states[state.order_id] = state
        logger.info(f"TTP registered: {state.order_id} | X={state.ttp_x}{state.ttp_unit} Y={state.ttp_y}{state.ttp_unit} TP={state.current_tp:.2f}")

    def deregister(self, order_id: str):
        self._states.pop(order_id, None)

    async def _persist_trail(self, order_id: str, new_tp: float, trail_count: int):
        """Write updated TTP state to DB. Fire-and-forget — errors are logged, not raised."""
        try:
            from app.core.database import AsyncSessionLocal
            from app.models.order import Order
            from sqlalchemy import select
            async with AsyncSessionLocal() as db:
                result = await db.execute(select(Order).where(Order.id == order_id))
                order = result.scalar_one_or_none()
                if order:
                    order.target           = new_tp
                    order.ttp_current_tp   = new_tp
                    order.ttp_activated    = True
                    await db.commit()
        except Exception as e:
            logger.warning(f"[TTP] DB persist failed for {order_id}: {e}")

    async def on_tick(self, token: int, ltp: float, tick: dict):
        for order_id, state in list(self._states.items()):
            pos = self.sl_monitor._positions.get(order_id)
            if not pos or not pos.is_active or pos.instrument_token != token:
                continue
            if state.check_and_trail(ltp):
                self.sl_monitor.update_tp(order_id, state.current_tp)
                # Persist to DB so position rebuilder can restore state after restart
                import asyncio
                asyncio.ensure_future(
                    self._persist_trail(order_id, state.current_tp, state.trail_count)
                )
