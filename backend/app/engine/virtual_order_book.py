"""
Virtual Order Book — PRACTIX paper trading simulation.

Identical execution path to live. Only difference:
  order placement → here instead of broker API.

Fills simulated at LTP at signal time.
P&L tracked in real-time against live market prices.
"""
import logging
import uuid
from datetime import datetime
from typing import Dict, Optional
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class VirtualOrder:
    order_id:    str
    algo_id:     str
    symbol:      str
    direction:   str
    quantity:    int
    fill_price:  float
    fill_time:   datetime
    ltp:         float = 0.0
    exit_price:  float = 0.0
    exit_time:   Optional[datetime] = None
    exit_reason: str   = ""
    is_open:     bool  = True

    @property
    def pnl(self) -> float:
        price = self.exit_price if self.exit_price else self.ltp
        return (price - self.fill_price) * self.quantity if self.direction == "buy" \
               else (self.fill_price - price) * self.quantity


class VirtualOrderBook:

    def __init__(self):
        self._orders: Dict[str, VirtualOrder] = {}

    async def place_order(
        self, algo_id: str, symbol: str, direction: str,
        quantity: int, ltp: float, order_type: str = "market",
        limit_price: Optional[float] = None,
    ) -> str:
        fill = limit_price if (order_type == "limit" and limit_price) else ltp
        order_id = str(uuid.uuid4())
        self._orders[order_id] = VirtualOrder(
            order_id=order_id, algo_id=algo_id, symbol=symbol,
            direction=direction, quantity=quantity,
            fill_price=fill, fill_time=datetime.utcnow(), ltp=ltp,
        )
        logger.info(f"📄 PRACTIX: {direction.upper()} {quantity} {symbol} @ {fill}")
        return order_id

    async def close_order(self, order_id: str, exit_ltp: float, reason: str = "sq") -> Optional[float]:
        o = self._orders.get(order_id)
        if not o or not o.is_open:
            return None
        o.exit_price = exit_ltp
        o.exit_time  = datetime.utcnow()
        o.exit_reason = reason
        o.is_open    = False
        logger.info(f"📄 PRACTIX closed: {order_id} | P&L=₹{o.pnl:,.2f} | {reason}")
        return o.pnl

    async def update_ltp(self, order_id: str, ltp: float):
        if order_id in self._orders:
            self._orders[order_id].ltp = ltp

    def get_open_orders(self) -> Dict[str, VirtualOrder]:
        return {oid: o for oid, o in self._orders.items() if o.is_open}

    def get_total_pnl(self, algo_id: str) -> float:
        return sum(o.pnl for o in self._orders.values() if o.algo_id == algo_id)
