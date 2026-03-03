"""
Order Placer — routes orders to broker or PRACTIX virtual book.
Handles MARKET and LIMIT orders.
Idempotent: tracks placed orders to prevent duplicates on retry.
"""
import logging
from typing import Optional
from app.brokers.zerodha import ZerodhaBroker
from app.engine.virtual_order_book import VirtualOrderBook

logger = logging.getLogger(__name__)


class OrderPlacer:

    def __init__(self, zerodha: ZerodhaBroker, virtual_book: VirtualOrderBook):
        self.zerodha      = zerodha
        self.virtual_book = virtual_book
        self._placed: set = set()  # idempotency tracking

    async def place(
        self,
        idempotency_key: str,
        algo_id: str,
        symbol: str,
        exchange: str,
        direction: str,
        quantity: int,
        order_type: str,
        ltp: float,
        is_practix: bool = True,
        is_overnight: bool = False,
        limit_price: Optional[float] = None,
    ) -> Optional[str]:
        """
        Place an order.
        Returns broker_order_id (live) or virtual_order_id (PRACTIX).
        Returns None if duplicate (idempotency key already used).
        """
        if idempotency_key in self._placed:
            logger.warning(f"Duplicate order blocked: {idempotency_key}")
            return None

        self._placed.add(idempotency_key)

        try:
            if is_practix:
                order_id = await self.virtual_book.place_order(
                    algo_id=algo_id, symbol=symbol,
                    direction=direction, quantity=quantity,
                    ltp=ltp, order_type=order_type, limit_price=limit_price,
                )
            else:
                order_id = await self.zerodha.place_order(
                    symbol=symbol, exchange=exchange,
                    direction=direction, quantity=quantity,
                    order_type=order_type, price=limit_price,
                    is_overnight=is_overnight,
                )
            return order_id

        except Exception as e:
            self._placed.discard(idempotency_key)  # allow retry on error
            logger.error(f"Order placement failed: {e}")
            raise
