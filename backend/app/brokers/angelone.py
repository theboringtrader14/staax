"""
Angel One SmartAPI Adapter.
Used for: Mom's F&O account + Wife's MCX account (Phase 2).
"""
from app.brokers.base import BaseBroker
from app.core.config import settings
# TODO: import smartapi and implement in Phase 1B


class AngelOneBroker(BaseBroker):

    def __init__(self, account: str = "mom"):
        """account: 'mom' or 'wife'"""
        if account == "mom":
            self.api_key   = settings.ANGELONE_MOM_API_KEY
            self.client_id = settings.ANGELONE_MOM_CLIENT_ID
            self.totp_secret = settings.ANGELONE_MOM_TOTP_SECRET
        else:
            self.api_key   = settings.ANGELONE_WIFE_API_KEY
            self.client_id = settings.ANGELONE_WIFE_CLIENT_ID
            self.totp_secret = settings.ANGELONE_WIFE_TOTP_SECRET
        self.smart_api = None  # SmartConnect instance — init in Phase 1B

    async def get_access_token(self) -> str:
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
