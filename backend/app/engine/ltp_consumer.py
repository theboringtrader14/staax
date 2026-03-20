"""
LTP Consumer — WebSocket tick consumer for Zerodha KiteConnect and Angel One SmartStream.
Target: <100ms tick-to-decision.

Architecture:
  - KiteTicker WebSocket receives ticks from NSE feed (Zerodha)
  - AngelOneTickerAdapter wraps SmartWebSocketV2 (Angel One SmartStream)
  - Both adapters feed into the same _process_ticks() → Redis + callbacks
  - Callbacks: ORBTracker, WTEvaluator, SLTPMonitor, TSLEngine, MTMMonitor
  - All evaluation is in-memory — zero DB queries on tick path

Angel One token notes:
  - Tokens are numeric strings (e.g. "99926000" for NIFTY index)
  - Prices from Angel One are in paise — divided by 100 to get ₹
  - Stored in Redis as int(token) → consistent with Zerodha int tokens

LTPCache: Redis-backed read cache for all monitors.
"""
import asyncio
import logging
from typing import Dict, Callable, List, Optional
import redis.asyncio as aioredis

logger = logging.getLogger(__name__)

LTP_KEY_PREFIX  = "ltp:"
LTP_EXPIRY_SECS = 86400  # 24 hours


class AngelOneTickerAdapter:
    """
    Angel One SmartStream WebSocket adapter.

    Wraps SmartWebSocketV2 from smartapi-python to deliver ticks in the same
    normalised format used by KiteTicker: {instrument_token: int, last_price: float}.

    WebSocket endpoint: wss://smartapisocket.angelone.in/smart-stream
    Exchange types:  1=NSE, 2=NFO, 3=BSE, 4=BFO, 5=MCX
    Subscription mode: 1=LTP, 2=Quote, 3=Snap Quote
    """

    # Known NSE index tokens (exchange type 1)
    INDEX_TOKENS: Dict[str, str] = {
        "NIFTY":       "99926000",
        "BANKNIFTY":   "99926009",
        "FINNIFTY":    "99926037",
        "MIDCAPNIFTY": "99926014",
        "SENSEX":      "99919000",   # BSE — handled separately if needed
    }

    def __init__(
        self,
        auth_token: str,
        api_key: str,
        client_code: str,
        feed_token: str,
    ):
        self.auth_token  = auth_token
        self.api_key     = api_key
        self.client_code = client_code
        self.feed_token  = feed_token

        self._sws                           = None
        self._on_tick_cb: Optional[Callable] = None
        self._loop:       Optional[asyncio.AbstractEventLoop] = None
        self._subscribed: List[str]         = []
        self._running                       = False
        self._corr_id                       = "staax_ltp"

    def start(
        self,
        tokens: List[str],
        loop: asyncio.AbstractEventLoop,
        on_tick: Callable,
    ):
        """
        Start Angel One SmartStream WebSocket.
        tokens:  list of string tokens (e.g. ["99926000", "99926009"]).
        on_tick: async callable(ticks: list) — same signature as _process_ticks.
        """
        try:
            from SmartApi.SmartWebSocketV2 import SmartWebSocketV2
        except ImportError:
            logger.error(
                "[AO] SmartWebSocketV2 not available — install smartapi-python. "
                "Angel One market feed disabled."
            )
            return

        self._loop       = loop
        self._on_tick_cb = on_tick
        self._subscribed = list(tokens)

        self._sws = SmartWebSocketV2(
            self.auth_token,
            self.api_key,
            self.client_code,
            self.feed_token,
        )
        self._sws.on_open  = self._on_open
        self._sws.on_data  = self._on_data
        self._sws.on_error = self._on_error
        self._sws.on_close = self._on_close
        self._sws.connect()
        self._running = True
        logger.info(f"[AO] ✅ SmartStream started — {len(tokens)} tokens")

    def stop(self):
        self._running = False
        try:
            if self._sws:
                self._sws.close_connection()
        except Exception:
            pass
        logger.info("[AO] 🛑 SmartStream stopped")

    def subscribe(self, tokens: List[str]):
        """Subscribe additional string tokens while running."""
        new = [t for t in tokens if t not in self._subscribed]
        if not new:
            return
        self._subscribed.extend(new)
        if self._running and self._sws:
            try:
                self._sws.subscribe(self._corr_id, 1, self._build_token_list(new))
                logger.info(f"[AO] Subscribed {len(new)} new tokens")
            except Exception as e:
                logger.warning(f"[AO] Subscribe failed: {e}")

    def _build_token_list(self, tokens: List[str]) -> List[dict]:
        """
        Build Angel One subscription payload grouped by exchange type.
        Index tokens go to exchangeType=1 (NSE), all others to exchangeType=2 (NFO).
        """
        index_set  = set(self.INDEX_TOKENS.values())
        nse_tokens = [t for t in tokens if t in index_set]
        nfo_tokens = [t for t in tokens if t not in index_set]
        token_list = []
        if nse_tokens:
            token_list.append({"exchangeType": 1, "tokens": nse_tokens})
        if nfo_tokens:
            token_list.append({"exchangeType": 2, "tokens": nfo_tokens})
        return token_list

    def _on_open(self, ws):
        logger.info("[AO] ✅ SmartStream WebSocket connected")
        if self._subscribed and self._sws:
            try:
                self._sws.subscribe(self._corr_id, 1, self._build_token_list(self._subscribed))
                logger.info(f"[AO] Subscribed {len(self._subscribed)} tokens on connect")
            except Exception as e:
                logger.error(f"[AO] Subscription error on connect: {e}")

    def _on_data(self, ws, message):
        """Hot path — normalise Angel One tick and dispatch to async loop."""
        if not self._loop or not self._on_tick_cb:
            return
        try:
            token_str = str(message.get("token", ""))
            ltp_paise = message.get("last_traded_price", 0)
            ltp       = ltp_paise / 100.0          # Angel One sends prices in paise
            try:
                token_int = int(token_str)
            except (ValueError, TypeError):
                return
            normalized = [{
                "instrument_token": token_int,
                "last_price":       ltp,
            }]
            asyncio.run_coroutine_threadsafe(
                self._on_tick_cb(normalized), self._loop
            )
        except Exception as e:
            logger.error(f"[AO] Tick normalisation error: {e}")

    def _on_error(self, ws, error):
        logger.error(f"[AO] ❌ SmartStream error: {error}")

    def _on_close(self, ws):
        logger.warning("[AO] ⚠️ SmartStream connection closed")
        self._running = False


class LTPConsumer:

    def __init__(self, ticker, redis_client: aioredis.Redis):
        self.ticker    = ticker          # KiteTicker instance or None
        self.redis     = redis_client
        self._callbacks: List[Callable]       = []
        self._subscribed_tokens: List[int]    = []
        self._angel_adapter: Optional[AngelOneTickerAdapter] = None
        self._ws_manager                      = None   # injected via set_ws_manager()
        self._running  = False
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    # ── Broker adapter injection ───────────────────────────────────────────────

    def set_ticker(self, ticker):
        """Set or replace the KiteTicker instance. Called after Zerodha login."""
        self.ticker = ticker
        logger.info("[LTP] KiteTicker set")

    def set_angel_adapter(self, adapter: AngelOneTickerAdapter):
        """Attach Angel One SmartStream adapter. Called from services.py after AO login."""
        self._angel_adapter = adapter
        logger.info("[LTP] Angel One adapter registered")

    def set_ws_manager(self, manager):
        """Inject WebSocket manager for real-time broadcast to frontend."""
        self._ws_manager = manager
        logger.info("[LTP] WebSocket manager wired")

    # ── Callback registry ─────────────────────────────────────────────────────

    def register_callback(self, callback: Callable):
        """
        Register a callback fired on every tick.
        Signature: async def callback(instrument_token: int, ltp: float, tick: dict)
        """
        self._callbacks.append(callback)
        logger.info(f"LTP callback registered: {callback.__name__}")

    # ── Subscription ──────────────────────────────────────────────────────────

    def subscribe(self, tokens: List[int]):
        """Subscribe to instruments. Safe to call while running. Propagates to both adapters."""
        new = [t for t in tokens if t not in self._subscribed_tokens]
        if new:
            self._subscribed_tokens.extend(new)
            if self._running:
                if self.ticker:
                    self.ticker.subscribe(new)
                    self.ticker.set_mode(self.ticker.MODE_LTP, new)
                if self._angel_adapter:
                    self._angel_adapter.subscribe([str(t) for t in new])
                logger.info(f"Subscribed to {len(new)} new instruments")

    def unsubscribe(self, tokens: List[int]):
        self._subscribed_tokens = [t for t in self._subscribed_tokens if t not in tokens]
        if self._running and self.ticker:
            self.ticker.unsubscribe(tokens)

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def start(self, tokens: List[int]):
        """Start WebSocket(s). KiteTicker runs in a background thread (sync API)."""
        self._subscribed_tokens = tokens
        self._loop = asyncio.get_event_loop()

        if self.ticker:
            self.ticker.on_ticks     = self._on_ticks
            self.ticker.on_connect   = self._on_connect
            self.ticker.on_close     = self._on_close
            self.ticker.on_error     = self._on_error
            self.ticker.on_reconnect = self._on_reconnect
            self.ticker.connect(threaded=True)
            logger.info(f"✅ Zerodha KiteTicker started — {len(tokens)} instruments")

        if self._angel_adapter:
            self._angel_adapter.start(
                tokens=[str(t) for t in tokens],
                loop=self._loop,
                on_tick=self._process_ticks,
            )

        self._running = True
        logger.info(f"✅ LTP Consumer running — {len(tokens)} instruments")

    def stop(self):
        self._running = False
        if self.ticker:
            try:
                self.ticker.close()
            except Exception:
                pass
        if self._angel_adapter:
            self._angel_adapter.stop()
        logger.info("🛑 LTP Consumer stopped")

    # ── KiteTicker callbacks ──────────────────────────────────────────────────

    def _on_connect(self, ws, response):
        logger.info("✅ Zerodha WebSocket connected")
        if self._subscribed_tokens:
            ws.subscribe(self._subscribed_tokens)
            ws.set_mode(ws.MODE_LTP, self._subscribed_tokens)

    def _on_ticks(self, ws, ticks):
        """Hot path — dispatch Zerodha ticks to async loop."""
        if ticks and self._loop:
            asyncio.run_coroutine_threadsafe(
                self._process_ticks(ticks), self._loop
            )

    # Index token maps for WebSocket broadcast
    # Zerodha tokens → name, Angel One tokens → name
    _INDEX_TOKEN_NAMES: Dict[int, str] = {
        256265:   "NIFTY",
        260105:   "BANKNIFTY",
        257801:   "FINNIFTY",
        288009:   "MIDCPNIFTY",
        265:      "SENSEX",
        99926000: "NIFTY",
        99926009: "BANKNIFTY",
        99926037: "FINNIFTY",
        99926014: "MIDCPNIFTY",
        99919000: "SENSEX",
    }

    async def _process_ticks(self, ticks: list):
        """Write to Redis + fire all callbacks + broadcast via WebSocket."""
        pipe = self.redis.pipeline()
        for tick in ticks:
            pipe.setex(
                f"{LTP_KEY_PREFIX}{tick['instrument_token']}",
                LTP_EXPIRY_SECS,
                str(tick.get("last_price", 0))
            )
        await pipe.execute()

        # Broadcast batches — split index tickers from position LTPs
        if self._ws_manager:
            ticker_prices: Dict[str, float] = {}
            ltp_batch:     Dict[int, float]  = {}
            for tick in ticks:
                token = int(tick["instrument_token"])
                ltp   = float(tick.get("last_price", 0))
                name  = self._INDEX_TOKEN_NAMES.get(token)
                if name:
                    ticker_prices[name] = ltp
                else:
                    ltp_batch[token] = ltp
            try:
                if ticker_prices:
                    asyncio.ensure_future(self._ws_manager.broadcast_ticker(ticker_prices))
                if ltp_batch:
                    asyncio.ensure_future(self._ws_manager.broadcast_ltp_batch(ltp_batch))
            except Exception as e:
                logger.debug(f"[LTP] WS broadcast skipped: {e}")

        for tick in ticks:
            token = tick["instrument_token"]
            ltp   = tick.get("last_price", 0)
            for cb in self._callbacks:
                try:
                    await cb(token, ltp, tick)
                except Exception as e:
                    logger.error(f"Callback error in {cb.__name__}: {e}")

    def _on_close(self, ws, code, reason):
        logger.warning(f"⚠️ Zerodha WebSocket closed: {code} — {reason}")
        self._running = False

    def _on_error(self, ws, code, reason):
        logger.error(f"❌ Zerodha WebSocket error: {code} — {reason}")

    def _on_reconnect(self, ws, attempts):
        logger.info(f"🔄 Reconnecting (attempt {attempts})")


class LTPCache:
    """Redis-backed LTP cache. All monitors read from here."""

    def __init__(self, redis_client: aioredis.Redis):
        self.redis = redis_client

    async def get(self, token: int) -> Optional[float]:
        val = await self.redis.get(f"{LTP_KEY_PREFIX}{token}")
        return float(val) if val else None

    async def get_many(self, tokens: List[int]) -> Dict[int, float]:
        pipe = self.redis.pipeline()
        for t in tokens:
            pipe.get(f"{LTP_KEY_PREFIX}{t}")
        results = await pipe.execute()
        return {t: float(v) for t, v in zip(tokens, results) if v is not None}

    async def set(self, token: int, ltp: float):
        await self.redis.setex(f"{LTP_KEY_PREFIX}{token}", LTP_EXPIRY_SECS, str(ltp))
