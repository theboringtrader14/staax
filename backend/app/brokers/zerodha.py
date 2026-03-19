"""
Zerodha KiteConnect Adapter — Full Implementation
Handles: token management, LTP, option chain, order placement.
Used for Karthik's F&O account + NSE market data for all accounts.
"""
import logging
from typing import Optional, Dict, List
from kiteconnect import KiteConnect, KiteTicker
from app.core.config import settings

logger = logging.getLogger(__name__)


class ZerodhaBroker:

    def __init__(self):
        self.api_key         = settings.ZERODHA_API_KEY
        self.api_secret      = settings.ZERODHA_API_SECRET
        self.user_id         = settings.ZERODHA_USER_ID
        self.kite            = KiteConnect(api_key=self.api_key)
        self._access_token: Optional[str] = None

    # ── Token Management ──────────────────────────────────────────────────────

    def get_login_url(self) -> str:
        """Returns Zerodha login URL. User opens this in browser each morning."""
        return self.kite.login_url()

    async def set_access_token(self, request_token: str) -> str:
        """
        Exchange request_token for access_token.
        Called after user completes browser login.
        request_token comes from the redirect URL: http://127.0.0.1?request_token=XXXX
        """
        try:
            session = self.kite.generate_session(
                request_token=request_token,
                api_secret=self.api_secret
            )
            self._access_token = session["access_token"]
            self.kite.set_access_token(self._access_token)
            logger.info(f"✅ Zerodha token set for {self.user_id}")
            return self._access_token
        except Exception as e:
            logger.error(f"❌ Token generation failed: {e}")
            raise

    async def load_token(self, token: str):
        """Load a saved token — called on server restart."""
        self._access_token = token
        self.kite.set_access_token(token)
        logger.info("✅ Zerodha token loaded from DB")

    async def get_access_token(self) -> str:
        if not self._access_token:
            raise ValueError("No access token — user must complete daily login")
        return self._access_token

    def is_token_set(self) -> bool:
        return self._access_token is not None

    # ── Market Data ───────────────────────────────────────────────────────────

    async def get_ltp(self, symbols: List[str]) -> Dict[str, float]:
        """
        Get last traded price for a list of symbols.
        symbols format: ["NSE:NIFTY 50", "NFO:NIFTY24FEB22000CE"]
        """
        try:
            data = self.kite.ltp(symbols)
            return {sym: data[sym]["last_price"] for sym in data}
        except Exception as e:
            logger.error(f"LTP fetch failed: {e}")
            return {}

    async def get_underlying_ltp(self, underlying: str) -> float:
        """Get current price of the underlying index."""
        symbol_map = {
            "NIFTY":       "NSE:NIFTY 50",
            "BANKNIFTY":   "NSE:NIFTY BANK",
            "SENSEX":      "BSE:SENSEX",
            "MIDCAPNIFTY": "NSE:NIFTY MID SELECT",
            "FINNIFTY":    "NSE:NIFTY FIN SERVICE",
        }
        symbol = symbol_map.get(underlying.upper())
        if not symbol:
            raise ValueError(f"Unknown underlying: {underlying}")
        result = await self.get_ltp([symbol])
        return result.get(symbol, 0.0)

    async def get_option_chain(self, underlying: str, expiry: str) -> dict:
        """Fetch option chain for strike selection at entry time."""
        try:
            instruments = getattr(self, '_nfo_cache', None) or self.kite.instruments("NFO")
            if not getattr(self, '_nfo_cache', None):
                self._nfo_cache = instruments
            chain = [
                i for i in instruments
                if i["name"] == underlying
                and str(i["expiry"]) == expiry
                and i["instrument_type"] in ("CE", "PE")
            ]
            return {"instruments": chain}
        except Exception as e:
            logger.error(f"Option chain fetch failed: {e}")
            return {}

    async def get_margins(self) -> Dict[str, float]:
        """Get available margins for Karthik's account."""
        try:
            margins = self.kite.margins()
            return {
                "equity": margins.get("equity", {}).get("available", {}).get("live_balance", 0),
            }
        except Exception as e:
            logger.error(f"Margin fetch failed: {e}")
            return {}

    # ── Order Placement ───────────────────────────────────────────────────────

    async def place_order(
        self,
        symbol: str,
        exchange: str,
        direction: str,
        quantity: int,
        order_type: str,
        price: Optional[float] = None,
        is_overnight: bool = False,
    ) -> str:
        """
        Place an order via KiteConnect.
        is_overnight=True uses PRODUCT_NRML for BTST/STBT.
        Returns broker order ID on success.
        """
        try:
            transaction = (
                self.kite.TRANSACTION_TYPE_BUY
                if direction.lower() == "buy"
                else self.kite.TRANSACTION_TYPE_SELL
            )
            kite_order_type = (
                self.kite.ORDER_TYPE_MARKET
                if order_type.lower() == "market"
                else self.kite.ORDER_TYPE_LIMIT
            )
            product = self.kite.PRODUCT_NRML if is_overnight else self.kite.PRODUCT_MIS

            params = {
                "tradingsymbol":    symbol,
                "exchange":         exchange,
                "transaction_type": transaction,
                "quantity":         quantity,
                "order_type":       kite_order_type,
                "product":          product,
                "validity":         self.kite.VALIDITY_DAY,
            }
            if order_type.lower() == "limit" and price:
                params["price"] = price

            order_id = self.kite.place_order(
                variety=self.kite.VARIETY_REGULAR,
                **params
            )
            logger.info(f"✅ Order placed: {order_id} | {direction} {quantity} {symbol}")
            return str(order_id)
        except Exception as e:
            logger.error(f"❌ Order placement failed: {e}")
            raise

    async def cancel_order(self, order_id: str) -> bool:
        try:
            self.kite.cancel_order(
                variety=self.kite.VARIETY_REGULAR,
                order_id=order_id
            )
            return True
        except Exception as e:
            logger.error(f"Cancel order failed: {e}")
            return False

    async def get_order_status(self, order_id: str) -> dict:
        """Check status of a placed order."""
        try:
            orders = self.kite.orders()
            for order in orders:
                if str(order["order_id"]) == str(order_id):
                    return order
            return {}
        except Exception as e:
            logger.error(f"Order status fetch failed: {e}")
            return {}

    async def get_positions(self) -> list:
        try:
            return self.kite.positions().get("net", [])
        except Exception as e:
            logger.error(f"Positions fetch failed: {e}")
            return []

    # ── WebSocket ─────────────────────────────────────────────────────────────

    def create_ticker(self) -> KiteTicker:
        """Create KiteTicker WebSocket for live tick streaming."""
        if not self._access_token:
            raise ValueError("Access token required to create ticker")
        return KiteTicker(self.api_key, self._access_token)

    def get_ticker(self) -> KiteTicker:
        """Alias for create_ticker() — used by services.py and main.py."""
        return self.create_ticker()

    # ── Index tokens ──────────────────────────────────────────────────────────

    # Zerodha instrument tokens for NSE/BSE index instruments
    _INDEX_TOKENS: Dict[str, int] = {
        "NIFTY":       256265,
        "BANKNIFTY":   260105,
        "FINNIFTY":    257801,
        "MIDCAPNIFTY": 288009,
        "SENSEX":      265,
    }

    async def get_index_tokens(self) -> Dict[str, int]:
        """
        Return instrument token map for NSE/BSE indices.
        Used by services.py and main.py to subscribe live index ticks.
        Returns: { "NIFTY": 256265, "BANKNIFTY": 260105, ... }
        """
        return dict(self._INDEX_TOKENS)
