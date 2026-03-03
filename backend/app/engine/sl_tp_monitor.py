"""
SL/TP Monitor — per-leg stop loss and target monitoring.
Evaluates on every tick for all open positions.

Four variants (SL and TP both):
  pts_instrument  — option/futures drops X pts from entry
  pct_instrument  — option/futures drops X% from entry
  pts_underlying  — underlying moves X pts against position
  pct_underlying  — underlying moves X% against position

TSLEngine updates sl_actual when trailing.
"""
import logging
from typing import Dict, Callable, Optional
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class PositionMonitor:
    order_id:          str
    grid_entry_id:     str
    algo_id:           str
    direction:         str          # "buy" or "sell"
    instrument_token:  int
    underlying_token:  int
    entry_price:       float
    sl_type:           Optional[str]
    sl_value:          Optional[float]
    tp_type:           Optional[str]
    tp_value:          Optional[float]
    sl_actual:         float = 0.0   # updated by TSLEngine
    tp_level:          float = 0.0
    is_active:         bool  = True
    tsl_trail_count:   int   = 0

    def compute_levels(self):
        """Compute initial SL and TP levels from entry price."""
        # SL
        if self.sl_type and self.sl_value:
            if self.sl_type == "pts_instrument":
                self.sl_actual = self.entry_price - self.sl_value if self.direction == "buy" else self.entry_price + self.sl_value
            elif self.sl_type == "pct_instrument":
                self.sl_actual = self.entry_price * (1 - self.sl_value/100) if self.direction == "buy" else self.entry_price * (1 + self.sl_value/100)
            # pts/pct_underlying computed dynamically

        # TP
        if self.tp_type and self.tp_value:
            if self.tp_type == "pts_instrument":
                self.tp_level = self.entry_price + self.tp_value if self.direction == "buy" else self.entry_price - self.tp_value
            elif self.tp_type == "pct_instrument":
                self.tp_level = self.entry_price * (1 + self.tp_value/100) if self.direction == "buy" else self.entry_price * (1 - self.tp_value/100)

    def is_sl_hit(self, ltp: float, ul_ltp: Optional[float] = None) -> bool:
        if not self.sl_type or not self.sl_value:
            return False
        if self.sl_type in ("pts_instrument", "pct_instrument"):
            return ltp <= self.sl_actual if self.direction == "buy" else ltp >= self.sl_actual
        if self.sl_type == "pts_underlying" and ul_ltp:
            ref = self.entry_price  # entry underlying price stored separately
            return ul_ltp <= ref - self.sl_value if self.direction == "buy" else ul_ltp >= ref + self.sl_value
        if self.sl_type == "pct_underlying" and ul_ltp:
            ref = self.entry_price
            return ul_ltp <= ref * (1 - self.sl_value/100) if self.direction == "buy" else ul_ltp >= ref * (1 + self.sl_value/100)
        return False

    def is_tp_hit(self, ltp: float, ul_ltp: Optional[float] = None) -> bool:
        if not self.tp_type or not self.tp_value:
            return False
        if self.tp_type in ("pts_instrument", "pct_instrument"):
            return ltp >= self.tp_level if self.direction == "buy" else ltp <= self.tp_level
        if self.tp_type == "pts_underlying" and ul_ltp:
            ref = self.entry_price
            return ul_ltp >= ref + self.tp_value if self.direction == "buy" else ul_ltp <= ref - self.tp_value
        if self.tp_type == "pct_underlying" and ul_ltp:
            ref = self.entry_price
            return ul_ltp >= ref * (1 + self.tp_value/100) if self.direction == "buy" else ul_ltp <= ref * (1 - self.tp_value/100)
        return False

    def unrealised_pnl(self, ltp: float) -> float:
        return (ltp - self.entry_price) if self.direction == "buy" else (self.entry_price - ltp)


class SLTPMonitor:
    """Monitors all open positions for SL/TP hits. Registered as LTP callback."""

    def __init__(self):
        self._positions: Dict[str, PositionMonitor] = {}
        self._sl_callbacks: Dict[str, Callable]     = {}
        self._tp_callbacks: Dict[str, Callable]     = {}
        self._underlying_ltps: Dict[int, float]     = {}

    def add_position(self, monitor: PositionMonitor, on_sl: Callable, on_tp: Callable):
        monitor.compute_levels()
        self._positions[monitor.order_id]    = monitor
        self._sl_callbacks[monitor.order_id] = on_sl
        self._tp_callbacks[monitor.order_id] = on_tp
        logger.info(f"Monitoring: {monitor.order_id} | SL={monitor.sl_actual:.2f} TP={monitor.tp_level:.2f}")

    def remove_position(self, order_id: str):
        self._positions.pop(order_id, None)
        self._sl_callbacks.pop(order_id, None)
        self._tp_callbacks.pop(order_id, None)

    def update_sl(self, order_id: str, new_sl: float):
        """Called by TSLEngine when trailing."""
        if order_id in self._positions:
            self._positions[order_id].sl_actual = new_sl

    def update_underlying_ltp(self, token: int, ltp: float):
        self._underlying_ltps[token] = ltp

    async def on_tick(self, token: int, ltp: float, tick: dict):
        for order_id, m in list(self._positions.items()):
            if not m.is_active or m.instrument_token != token:
                continue
            ul = self._underlying_ltps.get(m.underlying_token)

            if m.is_sl_hit(ltp, ul):
                m.is_active = False
                logger.info(f"🔴 SL HIT: {order_id} @ {ltp}")
                if cb := self._sl_callbacks.get(order_id):
                    await cb(order_id, ltp, "sl")

            elif m.is_tp_hit(ltp, ul):
                m.is_active = False
                logger.info(f"🟢 TP HIT: {order_id} @ {ltp}")
                if cb := self._tp_callbacks.get(order_id):
                    await cb(order_id, ltp, "tp")
