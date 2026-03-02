"""
Zerodha KiteConnect Adapter.
Used for: Karthik's F&O account (data + orders).
Also primary source for NSE market data (LTP WebSocket).
"""
from app.brokers.base import BaseBroker
from app.core.config import settings
# TODO: import kiteconnect and implement in Phase 1B


class ZerodhaBroker(BaseBroker):

    def __init__(self):
        self.api_key = settings.ZERODHA_API_KEY
        self.api_secret = settings.ZERODHA_API_SECRET
        self.user_id = settings.ZERODHA_USER_ID
        self.kite = None  # KiteConnect instance — init in Phase 1B

    async def get_access_token(self) -> str:
        # TODO: Implement daily token refresh
        raise NotImplementedError

    async def get_ltp(self, symbols: list):
        raise NotImplementedError

    async def get_option_chain(self, underlying: str, expiry: str):
        raise NotImplementedError

    async def place_order(self, symbol, exchange, direction, quantity, order_type, price=None):
        raise NotImplementedError

    async def cancel_order(self, order_id: str):
        raise NotImplementedError

    async def get_positions(self):
        raise NotImplementedError

    async def get_margins(self):
        raise NotImplementedError
