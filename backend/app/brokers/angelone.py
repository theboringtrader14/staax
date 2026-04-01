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
from datetime import date as _date, datetime as _dt
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

    # ── Instrument master (public, no auth — bypasses IP-blocked option chain API) ──
    _INSTRUMENT_MASTER_URL = (
        "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json"
    )
    # Class-level cache shared across all instances (mom / wife / karthik use same file)
    _master_cache: Optional[List[dict]] = None
    _master_date:  Optional[_date]      = None

    # Per-call option chain cache — avoids double 209k-record scan for CE+PE legs
    # in a straddle entry. Key: (underlying, expiry_ao). TTL: 60 seconds.
    _chain_cache: dict = {}  # { (underlying, expiry): (timestamp, chain_dict) }

    # 'name' field in master differs from our underlying names in two cases
    UNDERLYING_TO_MASTER_NAME: Dict[str, str] = {
        "NIFTY":       "NIFTY",
        "BANKNIFTY":   "BANKNIFTY",
        "FINNIFTY":    "FINNIFTY",
        "MIDCAPNIFTY": "MIDCPNIFTY",   # AO master uses MIDCPNIFTY
        "SENSEX":      "SENSEX",
    }
    # SENSEX trades on BSE's derivative segment (BFO), everything else on NFO
    UNDERLYING_TO_EXCHANGE: Dict[str, str] = {
        "SENSEX": "BFO",
    }

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

        logger.info(
            f"[ANGEL ONE] Login attempt — account={self.account} "
            f"client_id={self.client_id} url={self._LOGIN_URL}"
        )

        import httpx
        async with httpx.AsyncClient(timeout=15.0) as http:
            resp = await http.post(self._LOGIN_URL, json=payload, headers=headers)

        logger.info(
            f"[ANGEL ONE] Login response — account={self.account} "
            f"http_status={resp.status_code}"
        )

        try:
            data = resp.json()
        except Exception:
            raise RuntimeError(
                f"Angel One login: invalid JSON response (status={resp.status_code})"
            )

        # Angel One returns status as bool True or string "true" — handle both
        raw_status = data.get("status")
        login_ok = raw_status is True or str(raw_status).lower() == "true"

        logger.info(
            f"[ANGEL ONE] Login response body — account={self.account} "
            f"status={raw_status!r} message={data.get('message')!r} "
            f"errorcode={data.get('errorcode')!r} "
            f"data_keys={list((data.get('data') or {}).keys())}"
        )

        if not login_ok:
            msg = data.get("message", "Unknown error")
            err = data.get("errorcode", "")
            raise RuntimeError(f"Angel One login failed [{err}]: {msg}")

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
        if not self.is_token_set():
            raise RuntimeError(
                f"[ANGEL ONE] Broker ({self.account}) is not logged in — "
                "call auto-login before trading"
            )
        info = self._INDEX_TOKEN_MAP.get(underlying.upper())
        if not info:
            raise ValueError(f"[ANGEL ONE] Unknown underlying: {underlying}")
        exchange, symbol, token = info
        logger.info(
            f"[ANGEL ONE] get_underlying_ltp: {underlying} → "
            f"exchange={exchange} symbol={symbol!r} token={token}"
        )
        result = await self.get_ltp_by_token(exchange, symbol, token)
        if result == 0.0:
            logger.error(
                f"[ANGEL ONE] LTP returned 0.0 for {underlying} ({exchange}:{symbol} token={token}) "
                f"— broker may not be logged in or token may be wrong"
            )
        else:
            logger.info(f"[ANGEL ONE] {underlying} spot LTP = {result}")
        return result

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
        token: Angel One instrument token (e.g. "99926000" for NIFTY 50)
        """
        client = self._get_client()
        loop = asyncio.get_event_loop()

        try:
            data = await loop.run_in_executor(
                None,
                lambda: client.ltpData(exchange, symbol, token)
            )
            raw_status = data.get("status") if data else None
            ok = raw_status is True or str(raw_status).lower() == "true"
            if data and ok:
                return float(data.get("data", {}).get("ltp", 0.0))
            else:
                logger.warning(
                    f"[ANGEL ONE] ltpData failed for {exchange}:{symbol} token={token}: "
                    f"status={raw_status!r} message={data.get('message') if data else None!r}"
                )
        except Exception as e:
            logger.error(f"[ANGEL ONE] LTP by token error {exchange}:{symbol} token={token}: {e}")

        return 0.0

    # ── Option chain ──────────────────────────────────────────────────────────

    async def get_instrument_master(self) -> List[dict]:
        """
        Download and cache the Angel One instrument master JSON.

        Public URL — no authentication required. ~40MB, 209k instruments.
        Cached as a class variable so all broker instances share one copy per day.
        """
        if AngelOneBroker._master_cache and AngelOneBroker._master_date == _date.today():
            logger.debug("[AO master] Using cached instrument master")
            return AngelOneBroker._master_cache

        # Check disk cache — avoids 40MB re-download on every backend restart
        import os, json as _json
        _cache_file = os.path.expanduser("~/STAXX/staax/backend/instrument_master_cache.json")
        _cache_meta = os.path.expanduser("~/STAXX/staax/backend/instrument_master_cache_date.txt")
        try:
            if os.path.exists(_cache_file) and os.path.exists(_cache_meta):
                with open(_cache_meta) as _f:
                    _cached_date = _f.read().strip()
                if _cached_date == str(_date.today()):
                    logger.info("[AO master] Loading from disk cache (today's data)")
                    with open(_cache_file) as _f:
                        AngelOneBroker._master_cache = _json.load(_f)
                    AngelOneBroker._master_date = _date.today()
                    return AngelOneBroker._master_cache
        except Exception as _ce:
            logger.warning(f"[AO master] Disk cache read failed: {_ce}")

        logger.info(f"[AO master] Downloading instrument master from {self._INSTRUMENT_MASTER_URL}")
        import httpx
        try:
            async with httpx.AsyncClient(timeout=60.0) as http:
                resp = await http.get(self._INSTRUMENT_MASTER_URL)
            data: List[dict] = resp.json()
            AngelOneBroker._master_cache = data
            AngelOneBroker._master_date  = _date.today()
            # Write to disk cache for fast reload on restart
            try:
                import os, json as _json
                _cache_file = os.path.expanduser("~/STAXX/staax/backend/instrument_master_cache.json")
                _cache_meta = os.path.expanduser("~/STAXX/staax/backend/instrument_master_cache_date.txt")
                with open(_cache_file, 'w') as _f:
                    _json.dump(data, _f)
                with open(_cache_meta, 'w') as _f:
                    _f.write(str(_date.today()))
                logger.info("[AO master] Disk cache written for tomorrow's fast load")
            except Exception as _we:
                logger.warning(f"[AO master] Disk cache write failed (non-fatal): {_we}")
            logger.info(f"[AO master] ✅ Cached {len(data):,} instruments")
            return data
        except Exception as e:
            logger.error(f"[AO master] Download failed: {e}")
            return AngelOneBroker._master_cache or []

    async def get_option_chain(self, underlying: str, expiry: str) -> dict:
        """
        Get option chain for strike selection using the instrument master file.

        underlying: "NIFTY" | "BANKNIFTY" | "FINNIFTY" | "MIDCAPNIFTY" | "SENSEX"
        expiry: ISO "YYYY-MM-DD" (resolved by StrikeSelector) or "DDMMMYYYY"

        Returns: { strike_int: { "CE": {...}, "PE": {...} } }

        Note: The Angel One option chain REST API is IP-blocked for non-static IPs.
        This implementation uses the public instrument master file instead.

        Strike note: master stores strike × 100 (e.g. 30000 → "3000000.000000")
        """
        master      = await self.get_instrument_master()
        master_name = self.UNDERLYING_TO_MASTER_NAME.get(underlying.upper(), underlying.upper())
        exchange    = self.UNDERLYING_TO_EXCHANGE.get(underlying.upper(), "NFO")

        # Convert ISO expiry "2026-03-24" → AO master format "24MAR2026"
        if expiry and "-" in expiry:
            expiry_ao = _dt.strptime(expiry, "%Y-%m-%d").strftime("%d%b%Y").upper()
        else:
            expiry_ao = expiry

        # Per-call 60s cache — CE and PE legs in a straddle share the same chain.
        # Key: (underlying, expiry_ao) — option_type is NOT in the key because
        # this function returns ALL strikes (CE + PE) in one dict.
        import time as _time
        _cache_key = (underlying.upper(), expiry_ao)
        _cached = AngelOneBroker._chain_cache.get(_cache_key)
        if _cached:
            _ts, _chain = _cached
            if _time.monotonic() - _ts < 60:
                logger.debug(
                    f"[AO master] chain cache hit: {underlying} {expiry_ao} "
                    f"({len(_chain)} strikes)"
                )
                return _chain

        logger.info(
            f"[AO master] get_option_chain: {underlying} expiry={expiry_ao} "
            f"master_name={master_name} exchange={exchange}"
        )

        # Filter master for this underlying + exact expiry
        candidates = [
            x for x in master
            if x["name"] == master_name
            and x["exch_seg"] == exchange
            and x["instrumenttype"] == "OPTIDX"
            and x["expiry"] == expiry_ao
        ]

        # Fallback: find nearest future expiry in master
        # (handles holiday shifts, and monthly-only underlyings like BANKNIFTY)
        if not candidates:
            logger.warning(
                f"[AO master] No instruments for {underlying} {expiry_ao} — "
                f"searching for nearest future expiry"
            )
            try:
                target_dt = _dt.strptime(expiry_ao, "%d%b%Y")
            except ValueError:
                target_dt = _dt.today()

            all_expiries = sorted(
                {
                    (_dt.strptime(x["expiry"], "%d%b%Y"), x["expiry"])
                    for x in master
                    if x["name"] == master_name
                    and x["exch_seg"] == exchange
                    and x["instrumenttype"] == "OPTIDX"
                    and x["expiry"]
                },
                key=lambda t: t[0],
            )
            next_exp = next((ao for dt, ao in all_expiries if dt >= target_dt), None)
            if next_exp:
                logger.info(f"[AO master] Using nearest available expiry: {next_exp}")
                candidates = [
                    x for x in master
                    if x["name"] == master_name
                    and x["exch_seg"] == exchange
                    and x["instrumenttype"] == "OPTIDX"
                    and x["expiry"] == next_exp
                ]
                expiry_ao = next_exp  # update for logging

        if not candidates:
            logger.error(
                f"[AO master] No instruments found for {underlying} — "
                f"master has {len(master):,} total records. "
                f"Check master_name={master_name!r} exchange={exchange!r}"
            )
            return {}

        logger.info(f"[AO master] {len(candidates)} raw instruments for {underlying} {expiry_ao}")

        chain: dict = {}
        for scrip in candidates:
            sym = scrip.get("symbol", "")
            if sym.endswith("CE"):
                opt_type = "CE"
            elif sym.endswith("PE"):
                opt_type = "PE"
            else:
                continue

            # Master stores strike × 100 — convert to actual strike
            try:
                strike = int(float(scrip["strike"]) / 100)
            except (ValueError, TypeError, KeyError):
                continue

            if strike not in chain:
                chain[strike] = {}

            chain[strike][opt_type] = {
                "symbol":   sym,
                "token":    scrip.get("token", ""),
                "exchange": exchange,
                "expiry":   expiry,
                "strike":   strike,
            }

        logger.info(
            f"[AO master] ✅ Option chain built: {len(chain)} strikes for {underlying} {expiry_ao}"
            + (f" — sample strike: {next(iter(chain))}" if chain else "")
        )
        if chain:
            AngelOneBroker._chain_cache[_cache_key] = (_time.monotonic(), chain)
        return chain

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

    # ── Historical candle data ────────────────────────────────────────────────

    async def get_candle_data(
        self,
        symbol: str,
        exchange: str = "MCX",
        interval: str = "ONE_DAY",
        days_back: int = 3,
        symbol_token: str = "",
    ) -> list:
        """
        Fetch OHLCV candle data via Angel One SmartAPI getCandleData.

        Returns list of [timestamp, open, high, low, close, volume] sorted ASC.
        Returns [] on failure.

        interval options: ONE_MINUTE, THREE_MINUTE, FIVE_MINUTE, TEN_MINUTE,
                          FIFTEEN_MINUTE, THIRTY_MINUTE, ONE_HOUR, ONE_DAY
        """
        from datetime import datetime, timedelta, timezone as _tz
        client = self._get_client()
        loop = asyncio.get_event_loop()

        # Date range: days_back days ago → today
        now      = datetime.now(_tz.utc)
        from_dt  = (now - timedelta(days=days_back)).strftime("%Y-%m-%d %H:%M")
        to_dt    = now.strftime("%Y-%m-%d %H:%M")

        # Resolve token from instrument master if not supplied
        if not symbol_token:
            try:
                master = await self.get_instrument_master()
                matched = [
                    r for r in master
                    if r.get("tradingsymbol", "").startswith(symbol)
                    and r.get("exch_seg") == exchange
                ]
                if matched:
                    symbol_token = str(matched[0].get("symboltoken", ""))
            except Exception as e:
                logger.warning(f"[ANGEL ONE] Token lookup failed for {symbol}: {e}")

        if not symbol_token:
            logger.error(f"[ANGEL ONE] No symbol token for {symbol}/{exchange} — cannot fetch candles")
            return []

        params = {
            "exchange":    exchange,
            "symboltoken": symbol_token,
            "interval":    interval,
            "fromdate":    from_dt,
            "todate":      to_dt,
        }
        try:
            data = await loop.run_in_executor(
                None, lambda: client.getCandleData(params)
            )
            if data and data.get("status"):
                return data.get("data") or []
            logger.warning(f"[ANGEL ONE] getCandleData returned non-success: {data}")
            return []
        except Exception as e:
            logger.error(f"[ANGEL ONE] get_candle_data error for {symbol}: {e}")
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
