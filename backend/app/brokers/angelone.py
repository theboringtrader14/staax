"""
Angel One SmartAPI Adapter — complete implementation.

Used for:
  - Mom's F&O account (Zerodha equivalent for Angel One)
  - Wife's MCX account (Phase 2)

SmartAPI package: smartapi-python v1.4.1
Import: from SmartApi import SmartConnect

Auth flow:
  1. generateSession(client_id, password, totp) → jwtToken + refreshToken + feedToken
  2. Store tokens in DB via accounts.py (same pattern as Zerodha)
  3. setAccessToken(jwtToken) for subsequent API calls

TOTP: Generated locally using pyotp from TOTP secret stored in .env

Exchange codes (Angel One):
  NSE = "NSE", BSE = "BSE", NFO = "NFO", MCX = "MCX", BFO = "BFO"

Order varieties:
  NORMAL, STOPLOSS, AMO, ROBO

Product types:
  DELIVERY, CARRYFORWARD, MARGIN, INTRADAY, BO

Order types:
  MARKET, LIMIT, STOPLOSS_LIMIT, STOPLOSS_MARKET
"""
import asyncio
import logging
from typing import Optional, Dict, List

from app.brokers.base import BaseBroker
from app.core.config import settings

logger = logging.getLogger(__name__)


class AngelOneBroker(BaseBroker):

    # ── Exchange + product constants ──────────────────────────────────────────
    EXCHANGE_NFO  = "NFO"
    EXCHANGE_NSE  = "NSE"
    EXCHANGE_MCX  = "MCX"
    PRODUCT_INTRADAY = "INTRADAY"
    PRODUCT_CARRYFORWARD = "CARRYFORWARD"

    def __init__(self, account: str = "mom"):
        """
        account: 'mom' (F&O via Angel One) or 'wife' (MCX, Phase 2)
        """
        self.account = account

        if account == "mom":
            self.api_key      = settings.ANGELONE_MOM_API_KEY
            self.client_id    = settings.ANGELONE_MOM_CLIENT_ID
            self.totp_secret  = settings.ANGELONE_MOM_TOTP_SECRET
        elif account == "karthik":
            self.api_key      = settings.ANGELONE_KARTHIK_API_KEY
            self.client_id    = settings.ANGELONE_KARTHIK_CLIENT_ID
            self.totp_secret  = settings.ANGELONE_KARTHIK_TOTP_SECRET
        else:
            self.api_key      = settings.ANGELONE_WIFE_API_KEY
            self.client_id    = settings.ANGELONE_WIFE_CLIENT_ID
            self.totp_secret  = settings.ANGELONE_WIFE_TOTP_SECRET

        self._smart_api   = None   # SmartConnect instance
        self._access_token: Optional[str] = None
        self._feed_token:   Optional[str] = None
        self._refresh_token: Optional[str] = None

    # ── Initialise SmartConnect (lazy) ────────────────────────────────────────

    def _get_client(self):
        """Get or create SmartConnect instance."""
        if self._smart_api is None:
            from SmartApi import SmartConnect
            self._smart_api = SmartConnect(api_key=self.api_key)
            if self._access_token:
                self._smart_api.setAccessToken(self._access_token)
            if self._feed_token:
                self._smart_api.setFeedToken(self._feed_token)
        return self._smart_api

    # ── Auth ──────────────────────────────────────────────────────────────────

    # Angel One login URL — bypass SDK to avoid clientCode/clientcode casing bug
    _LOGIN_URL = "https://apiconnect.angelbroking.com/rest/auth/angelbroking/user/v1/loginByPassword"

    async def login_with_totp(self, password: str) -> dict:
        """
        Full login using TOTP. Called once per day after market open.

        Returns: { jwt_token, refresh_token, feed_token, client_code }

        Uses direct HTTP POST instead of SDK's generateSession() to avoid
        the SDK sending "clientCode" (camelCase) when Angel One API expects
        "clientcode" (lowercase). This matches the working approach for all accounts.

        Requires:
          - ANGELONE_{ACCOUNT}_TOTP_SECRET in .env (base32 secret from Angel One app)
          - ANGELONE_{ACCOUNT}_CLIENT_ID (your Angel One client ID, e.g. A123456)
          - password: Angel One PIN / password
        """
        try:
            import pyotp
        except ImportError:
            raise RuntimeError(
                "pyotp not installed — run: pip install pyotp\n"
                "Required for Angel One TOTP generation."
            )

        totp = pyotp.TOTP(self.totp_secret).now()

        headers = {
            "Content-Type":     "application/json",
            "Accept":           "application/json",
            "X-UserType":       "USER",
            "X-SourceID":       "WEB",
            "X-ClientLocalIP":  "127.0.0.1",
            "X-ClientPublicIP": "127.0.0.1",
            "X-MACAddress":     "00:00:00:00:00:00",
            "X-PrivateKey":     self.api_key,
        }
        payload = {
            "clientcode": self.client_id,
            "password":   password,
            "totp":       totp,
        }

        import httpx
        async with httpx.AsyncClient(timeout=15.0) as http:
            resp = await http.post(self._LOGIN_URL, json=payload, headers=headers)

        try:
            data = resp.json()
        except Exception:
            raise RuntimeError(
                f"Angel One login: invalid JSON response (status={resp.status_code})"
            )

        if not data.get("status") or data.get("status") is False:
            msg = data.get("message", "Unknown error")
            raise RuntimeError(f"Angel One login failed: {msg}")

        tokens = data.get("data", {})
        self._access_token  = tokens.get("jwtToken")
        self._refresh_token = tokens.get("refreshToken")
        self._feed_token    = tokens.get("feedToken")

        if not self._access_token:
            raise RuntimeError(
                f"Angel One login returned no jwtToken — response: {data}"
            )

        # Keep SDK instance in sync so subsequent API calls (orders, LTP) work
        client = self._get_client()
        client.setAccessToken(self._access_token)
        if self._feed_token:
            client.setFeedToken(self._feed_token)
        if self._refresh_token:
            client.setRefreshToken(self._refresh_token)

        logger.info(
            f"[ANGEL ONE] ✅ Login successful for account={self.account} "
            f"client_id={self.client_id}"
        )

        return {
            "jwt_token":     self._access_token,
            "refresh_token": self._refresh_token,
            "feed_token":    self._feed_token,
            "client_code":   self.client_id,
        }

    async def load_token(self, jwt_token: str, feed_token: str = "", refresh_token: str = "") -> None:
        """
        Load a previously saved JWT token (from DB) without doing a full login.
        Called at startup if a valid token exists in DB.
        """
        self._access_token  = jwt_token
        self._feed_token    = feed_token
        self._refresh_token = refresh_token

        client = self._get_client()
        client.setAccessToken(jwt_token)
        if feed_token:
            client.setFeedToken(feed_token)
        if refresh_token:
            client.setRefreshToken(refresh_token)

        logger.info(f"[ANGEL ONE] Token loaded for account={self.account}")

    def is_token_set(self) -> bool:
        return bool(self._access_token)

    async def get_access_token(self) -> str:
        if not self._access_token:
            raise RuntimeError(
                f"Angel One access token not set for account={self.account}. "
                "Complete broker login first."
            )
        return self._access_token

    # ── Underlying LTP (for StrikeSelector) ──────────────────────────────────

    # Angel One NSE index tokens
    _INDEX_TOKEN_MAP = {
        "NIFTY":       ("NSE", "Nifty 50",          "99926000"),
        "BANKNIFTY":   ("NSE", "Nifty Bank",         "99926009"),
        "FINNIFTY":    ("NSE", "Nifty Fin Service",  "99926037"),
        "MIDCAPNIFTY": ("NSE", "Nifty MidCap Select","99926014"),
        "SENSEX":      ("BSE", "Sensex",             "99919000"),
    }

    async def get_underlying_ltp(self, underlying: str) -> float:
        """
        Get current spot price for an index underlying.
        Uses Angel One ltpData with the known NSE/BSE index tokens.
        """
        info = self._INDEX_TOKEN_MAP.get(underlying.upper())
        if not info:
            raise ValueError(f"[ANGEL ONE] Unknown underlying: {underlying}")
        exchange, symbol, token = info
        return await self.get_ltp_by_token(exchange, symbol, token)

    # ── LTP ───────────────────────────────────────────────────────────────────

    async def get_ltp(self, symbols: List[str]) -> Dict[str, float]:
        """
        Get last traded price for a list of symbols.

        symbols format: ["NFO:NIFTY24DEC24500CE", "NFO:BANKNIFTY24DEC49000PE"]
        Returns: { "NFO:NIFTY24DEC24500CE": 125.50, ... }

        Uses ltpData() — fetches one at a time (SmartAPI limitation).
        For bulk LTP, use the WebSocket feed instead.
        """
        client = self._get_client()
        result: Dict[str, float] = {}
        loop = asyncio.get_event_loop()

        for symbol in symbols:
            try:
                # Parse "EXCHANGE:SYMBOL" format
                if ":" in symbol:
                    exchange, trading_symbol = symbol.split(":", 1)
                else:
                    exchange, trading_symbol = "NFO", symbol

                # ltpData needs exchange, tradingsymbol, symboltoken
                # For batch use, caller should pass symboltoken separately
                # Here we do a best-effort REST call
                data = await loop.run_in_executor(
                    None,
                    lambda ex=exchange, sym=trading_symbol: client.ltpData(ex, sym, "")
                )

                if data and data.get("status"):
                    ltp = data.get("data", {}).get("ltp", 0.0)
                    result[symbol] = float(ltp)
                else:
                    logger.warning(f"[ANGEL ONE] LTP fetch failed for {symbol}: {data}")
                    result[symbol] = 0.0

            except Exception as e:
                logger.error(f"[ANGEL ONE] LTP error for {symbol}: {e}")
                result[symbol] = 0.0

        return result

    async def get_ltp_by_token(self, exchange: str, symbol: str, token: str) -> float:
        """
        Get LTP using symbol token — preferred method for accuracy.
        token: Angel One instrument token (e.g. "26000" for NIFTY)
        """
        client = self._get_client()
        loop = asyncio.get_event_loop()

        try:
            data = await loop.run_in_executor(
                None,
                lambda: client.ltpData(exchange, symbol, token)
            )
            if data and data.get("status"):
                return float(data.get("data", {}).get("ltp", 0.0))
        except Exception as e:
            logger.error(f"[ANGEL ONE] LTP by token error {exchange}:{symbol}: {e}")

        return 0.0

    # ── Option chain ──────────────────────────────────────────────────────────

    async def get_option_chain(self, underlying: str, expiry: str) -> dict:
        """
        Get option chain for strike selection.

        underlying: "NIFTY" | "BANKNIFTY" | "FINNIFTY"
        expiry: "DDMMMYYYY" format e.g. "26DEC2024"

        Uses searchScrip to find option tokens.
        Returns dict keyed by strike: { 24500: { CE: {...}, PE: {...} } }

        Note: Angel One does not have a single option chain endpoint like Zerodha.
        Full option chain requires iterating strikes via searchScrip or
        using the instruments CSV download.
        """
        client = self._get_client()
        loop = asyncio.get_event_loop()

        try:
            # Search for all options for this underlying + expiry
            data = await loop.run_in_executor(
                None,
                lambda: client.searchScrip("NFO", f"{underlying}{expiry}")
            )

            if not data or not data.get("status"):
                logger.warning(f"[ANGEL ONE] Option chain search failed: {data}")
                return {}

            chain = {}
            for scrip in data.get("data", []):
                name = scrip.get("tradingsymbol", "")
                # Parse strike and option type from symbol name
                # e.g. "NIFTY26DEC2024C24500" or "NIFTY26DEC2024P24500"
                try:
                    if name.endswith("CE") or "C" in name[-7:]:
                        opt_type = "CE"
                    elif name.endswith("PE") or "P" in name[-7:]:
                        opt_type = "PE"
                    else:
                        continue

                    # Extract strike — last numeric portion before CE/PE
                    strike_str = "".join(filter(str.isdigit, name.split(expiry)[-1]))
                    if not strike_str:
                        continue
                    strike = int(strike_str)

                    if strike not in chain:
                        chain[strike] = {}

                    chain[strike][opt_type] = {
                        "symbol":   name,
                        "token":    scrip.get("symboltoken", ""),
                        "exchange": "NFO",
                        "expiry":   expiry,
                        "strike":   strike,
                    }

                except (ValueError, IndexError):
                    continue

            return chain

        except Exception as e:
            logger.error(f"[ANGEL ONE] Option chain error: {e}")
            return {}

    # ── Order placement ───────────────────────────────────────────────────────

    async def place_order(
        self,
        symbol: str,
        exchange: str,
        direction: str,      # "buy" | "sell"
        quantity: int,
        order_type: str,     # "MARKET" | "LIMIT"
        price: Optional[float] = None,
        product: str = "INTRADAY",
        symbol_token: str = "",
        tag: str = "",       # SEBI algo_tag — passed as Angel One order tag
    ) -> str:
        """
        Place an order on Angel One.

        Returns: Angel One order ID (string)

        Angel One order_type mapping:
          "MARKET" → "MARKET"
          "LIMIT"  → "LIMIT"
          "SL"     → "STOPLOSS_LIMIT"
          "SLM"    → "STOPLOSS_MARKET"
        """
        client = self._get_client()
        loop = asyncio.get_event_loop()

        # Map direction
        transaction_type = "BUY" if direction.lower() == "buy" else "SELL"

        # Map order type
        ao_order_type_map = {
            "MARKET": "MARKET",
            "LIMIT":  "LIMIT",
            "SL":     "STOPLOSS_LIMIT",
            "SLM":    "STOPLOSS_MARKET",
        }
        ao_order_type = ao_order_type_map.get(order_type.upper(), "MARKET")

        order_params = {
            "variety":          "NORMAL",
            "tradingsymbol":    symbol,
            "symboltoken":      symbol_token,
            "transactiontype":  transaction_type,
            "exchange":         exchange,
            "ordertype":        ao_order_type,
            "producttype":      product,
            "duration":         "DAY",
            "price":            str(price or 0),
            "squareoff":        "0",
            "stoploss":         "0",
            "quantity":         str(quantity),
            "ordertag":         tag,   # SEBI algo_tag — Angel One ordertag field
        }

        try:
            data = await loop.run_in_executor(
                None,
                lambda: client.placeOrder(order_params)
            )

            if not data or data.get("status") is False:
                msg = data.get("message", "Unknown error") if data else "No response"
                raise RuntimeError(f"Angel One order placement failed: {msg}")

            order_id = data.get("data", {}).get("orderid", "")
            if not order_id:
                raise RuntimeError(f"Angel One returned no order ID: {data}")

            logger.info(
                f"[ANGEL ONE] ✅ Order placed — order_id={order_id} "
                f"{exchange}:{symbol} {transaction_type} qty={quantity} "
                f"type={ao_order_type} price={price or 'MARKET'}"
            )
            return str(order_id)

        except RuntimeError:
            raise
        except Exception as e:
            raise RuntimeError(f"Angel One place_order exception: {e}") from e

    # ── Order cancellation ────────────────────────────────────────────────────

    async def cancel_order(self, order_id: str, variety: str = "NORMAL") -> bool:
        """Cancel a pending order. Returns True on success."""
        client = self._get_client()
        loop = asyncio.get_event_loop()

        try:
            data = await loop.run_in_executor(
                None,
                lambda: client.cancelOrder(variety, order_id)
            )

            if data and data.get("status"):
                logger.info(f"[ANGEL ONE] ✅ Order cancelled — order_id={order_id}")
                return True
            else:
                msg = data.get("message", "Unknown") if data else "No response"
                logger.warning(f"[ANGEL ONE] Cancel failed for order_id={order_id}: {msg}")
                return False

        except Exception as e:
            logger.error(f"[ANGEL ONE] cancel_order error order_id={order_id}: {e}")
            return False

    # ── Order status ──────────────────────────────────────────────────────────

    async def get_order_status(self, order_id: str) -> dict:
        """Get status of a specific order."""
        client = self._get_client()
        loop = asyncio.get_event_loop()

        try:
            data = await loop.run_in_executor(
                None,
                lambda: client.individual_order_details(order_id)
            )

            if data and data.get("status"):
                return data.get("data", {})

            return {}

        except Exception as e:
            logger.error(f"[ANGEL ONE] get_order_status error: {e}")
            return {}

    # ── Positions ─────────────────────────────────────────────────────────────

    async def get_positions(self) -> list:
        """
        Get all open positions.

        Returns list of dicts with standardised keys:
          { symbol, exchange, quantity, average_price, ltp, pnl, product }
        """
        client = self._get_client()
        loop = asyncio.get_event_loop()

        try:
            data = await loop.run_in_executor(None, client.position)

            if not data or not data.get("status"):
                return []

            positions = []
            for p in data.get("data") or []:
                net_qty = int(p.get("netqty", 0))
                if net_qty == 0:
                    continue  # Skip flat positions

                positions.append({
                    "symbol":        p.get("tradingsymbol", ""),
                    "exchange":      p.get("exchange", ""),
                    "token":         p.get("symboltoken", ""),
                    "quantity":      net_qty,
                    "average_price": float(p.get("netprice", 0)),
                    "ltp":           float(p.get("ltp", 0)),
                    "pnl":           float(p.get("unrealised", 0)),
                    "product":       p.get("producttype", ""),
                    "day_buy_qty":   int(p.get("buyqty", 0)),
                    "day_sell_qty":  int(p.get("sellqty", 0)),
                })

            return positions

        except Exception as e:
            logger.error(f"[ANGEL ONE] get_positions error: {e}")
            return []

    # ── Margins ───────────────────────────────────────────────────────────────

    async def get_margins(self) -> Dict[str, float]:
        """
        Get available margins.

        Returns: { "available": float, "used": float, "total": float }
        """
        client = self._get_client()
        loop = asyncio.get_event_loop()

        try:
            data = await loop.run_in_executor(None, client.rmsLimit)

            if not data or not data.get("status"):
                return {"available": 0.0, "used": 0.0, "total": 0.0}

            d = data.get("data", {})
            available = float(d.get("availablecash", 0))
            used      = float(d.get("utiliseddebits", 0))
            total     = available + used

            return {
                "available": available,
                "used":      used,
                "total":     total,
            }

        except Exception as e:
            logger.error(f"[ANGEL ONE] get_margins error: {e}")
            return {"available": 0.0, "used": 0.0, "total": 0.0}

    # ── Order book ────────────────────────────────────────────────────────────

    async def get_order_book(self) -> list:
        """Get full order book for today."""
        client = self._get_client()
        loop = asyncio.get_event_loop()

        try:
            data = await loop.run_in_executor(None, client.orderBook)
            if data and data.get("status"):
                return data.get("data") or []
            return []
        except Exception as e:
            logger.error(f"[ANGEL ONE] get_order_book error: {e}")
            return []

    # ── Profile ───────────────────────────────────────────────────────────────

    async def get_profile(self) -> dict:
        """Get account profile — used to verify login."""
        client = self._get_client()
        loop = asyncio.get_event_loop()

        try:
            data = await loop.run_in_executor(None, client.getProfile)
            if data and data.get("status"):
                return data.get("data", {})
            return {}
        except Exception as e:
            logger.error(f"[ANGEL ONE] get_profile error: {e}")
            return {}
