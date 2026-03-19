"""
Order Placer — routes orders to broker or PRACTIX virtual book.
Handles MARKET and LIMIT orders.
Idempotent: tracks placed orders to prevent duplicates on retry.

Broker routing:
  is_practix=True             → VirtualOrderBook (paper trading)
  is_practix=False + zerodha  → ZerodhaBroker.place_order()
  is_practix=False + angelone → AngelOneBroker.place_order()
"""
import logging
from typing import Optional, TYPE_CHECKING
from app.brokers.zerodha import ZerodhaBroker
from app.engine.virtual_order_book import VirtualOrderBook

if TYPE_CHECKING:
    from app.brokers.angelone import AngelOneBroker

logger = logging.getLogger(__name__)


class OrderPlacer:

    def __init__(
        self,
        zerodha: ZerodhaBroker,
        virtual_book: VirtualOrderBook,
        angel_broker: Optional["AngelOneBroker"] = None,
    ):
        self.zerodha      = zerodha
        self.virtual_book = virtual_book
        self.angel_broker = angel_broker        # primary AO account (mom by default)
        self._placed: set = set()               # idempotency tracking

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
        broker_type: str = "zerodha",
        symbol_token: str = "",
        algo_tag: str = "",
    ) -> Optional[str]:
        """
        Place an order.
        Returns broker_order_id (live) or virtual_order_id (PRACTIX).
        Returns None if duplicate (idempotency key already used).

        broker_type:  "zerodha" | "angelone"
        symbol_token: Angel One symboltoken (required when broker_type="angelone")
        """
        if idempotency_key in self._placed:
            logger.warning(f"Duplicate order blocked: {idempotency_key}")
            return None

        # SEBI: every live order must carry an algo_tag
        if not is_practix and not algo_tag:
            logger.error(
                f"[ORDER PLACER] BLOCKED — algo_tag missing for live order "
                f"idempotency_key={idempotency_key} symbol={symbol}"
            )
            raise ValueError(f"algo_tag required for live orders (symbol={symbol})")

        self._placed.add(idempotency_key)

        try:
            if is_practix:
                order_id = await self.virtual_book.place_order(
                    algo_id=algo_id, symbol=symbol,
                    direction=direction, quantity=quantity,
                    ltp=ltp, order_type=order_type, limit_price=limit_price,
                )

            elif broker_type == "angelone" and self.angel_broker:
                order_id = await self.angel_broker.place_order(
                    symbol=symbol,
                    exchange=exchange,
                    direction=direction,
                    quantity=quantity,
                    order_type=order_type.upper(),
                    price=limit_price,
                    symbol_token=symbol_token,
                    tag=algo_tag,
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
