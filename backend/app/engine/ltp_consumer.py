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
from typing import Dict, Callable, List, Optional, Set
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
        self._connected                     = False   # True while WebSocket is open
        self._last_tick_at: Optional[str]   = None    # ISO timestamp of last tick received
        self._corr_id                       = "staax_ltp"
        self._mcx_tokens: Set[str]          = set()   # tokens that need exchangeType=5
        self._bfo_tokens: Set[str]          = set()   # tokens that need exchangeType=4 (BFO — BSE F&O)
        self._reconnect_count               = 0
        self._last_reconnect_at: Optional[str] = None
        self._on_reconnect_callbacks: List[Callable] = []  # fired on every _on_open
        self._force_stopped: bool           = False   # True when restart() closes intentionally

        # Debug: log credential presence at construction time
        ft_preview = (feed_token[:10] + "...") if feed_token and len(feed_token) > 10 else (feed_token or "EMPTY")
        logger.info(
            f"[AO-DEBUG] AngelOneTickerAdapter init — "
            f"client_code={client_code!r}, api_key={api_key[:6]!r}..., "
            f"feed_token={ft_preview!r} (len={len(feed_token) if feed_token else 0})"
        )

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
            from SmartApi.smartWebSocketV2 import SmartWebSocketV2
        except ImportError:
            logger.error(
                "[AO] SmartWebSocketV2 not available — install smartapi-python. "
                "Angel One market feed disabled."
            )
            return

        self._loop       = loop
        self._on_tick_cb = on_tick
        # Merge with tokens pre-queued via subscribe() before start() was called
        for t in tokens:
            if t not in self._subscribed:
                self._subscribed.append(t)

        ft_preview = (self.feed_token[:10] + "...") if self.feed_token and len(self.feed_token) > 10 else (self.feed_token or "EMPTY")
        logger.info(
            f"[AO-DEBUG] SmartWebSocketV2 init — "
            f"client_code={self.client_code!r}, api_key={self.api_key[:6]!r}..., "
            f"feed_token={ft_preview!r} (len={len(self.feed_token) if self.feed_token else 0}), "
            f"tokens={tokens[:5]!r}{'...' if len(tokens) > 5 else ''}"
        )
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
        logger.info("[AO-DEBUG] Calling SmartWebSocketV2.connect() ...")
        self._sws.connect()
        self._running = True
        logger.info(f"[AO] ✅ SmartStream started — {len(tokens)} tokens")

    def stop(self):
        self._running = False
        try:
            if self._sws:
                self._sws.close_connection()
        except Exception as e:
            logger.error(f"[LTP] Error in AngelOneTickerAdapter.stop: {e}", exc_info=True)
        logger.info("[AO] 🛑 SmartStream stopped")

    def register_mcx_tokens(self, tokens: List[str]):
        """Register tokens that belong to MCX (exchangeType=5). Call before start()."""
        self._mcx_tokens.update(tokens)
        logger.info(f"[AO] Registered {len(tokens)} MCX tokens: {tokens}")

    def register_bfo_tokens(self, tokens: List[str]):
        """Register tokens that belong to BSE F&O (exchangeType=4). Call before subscribing."""
        self._bfo_tokens.update(tokens)
        logger.info(f"[AO] Registered {len(tokens)} BFO tokens: {tokens}")

    def subscribe(self, tokens: List[str]):
        """Subscribe additional string tokens while running."""
        new = [t for t in tokens if t not in self._subscribed]
        if not new:
            return
        self._subscribed.extend(new)
        # Use _connected (set in _on_open) not _running (set after connect() returns,
        # which is never while the WebSocket is alive — connect() blocks forever).
        if self._connected and self._sws:
            try:
                self._sws.subscribe(self._corr_id, 1, self._build_token_list(new))
                logger.info(f"[AO] Subscribed {len(new)} new tokens via live WebSocket: {new}")
            except Exception as e:
                logger.warning(f"[AO] Subscribe failed: {e}")
        else:
            logger.info(f"[AO] Queued {len(new)} tokens (not connected yet — will subscribe on _on_open): {new}")

    def _build_token_list(self, tokens: List[str]) -> List[dict]:
        """
        Build Angel One subscription payload grouped by exchange type.
          exchangeType=1 → NSE index tokens (NSE cash)
          exchangeType=2 → NFO (NSE F&O)
          exchangeType=4 → BFO (BSE F&O — SENSEX/BANKEX options)
          exchangeType=5 → MCX tokens (GOLDM, SILVERMIC, etc.)
        """
        index_set  = set(self.INDEX_TOKENS.values())
        nse_tokens = [t for t in tokens if t in index_set]
        mcx_tokens = [t for t in tokens if t not in index_set and t in self._mcx_tokens]
        bfo_tokens = [t for t in tokens if t not in index_set and t not in self._mcx_tokens and t in self._bfo_tokens]
        nfo_tokens = [t for t in tokens if t not in index_set and t not in self._mcx_tokens and t not in self._bfo_tokens]
        token_list = []
        if nse_tokens:
            token_list.append({"exchangeType": 1, "tokens": nse_tokens})
        if mcx_tokens:
            token_list.append({"exchangeType": 5, "tokens": mcx_tokens})
        if bfo_tokens:
            token_list.append({"exchangeType": 4, "tokens": bfo_tokens})
        if nfo_tokens:
            token_list.append({"exchangeType": 2, "tokens": nfo_tokens})
        return token_list

    def _on_open(self, ws):
        self._connected = True
        self._running   = True   # connect() blocks forever so the line after it is dead code; set here instead
        self._reconnect_count = 0  # Reset on every successful connect so _MAX_RECONNECT_ATTEMPTS resets per-session
        logger.info("[AO-DEBUG] _on_open fired — SmartStream connected ✅")
        if self._subscribed and self._sws:
            try:
                token_list = self._build_token_list(self._subscribed)
                # Verify GOLDM MCX routing
                goldm_str      = "58424839"
                goldm_in_sub   = goldm_str in self._subscribed
                goldm_in_mcx   = goldm_str in self._mcx_tokens
                logger.info(
                    f"[AO-DEBUG] Subscription payload ({len(self._subscribed)} tokens): {token_list}"
                )
                logger.info(
                    f"[AO-DEBUG] MCX tokens registered: {sorted(self._mcx_tokens)}"
                )
                logger.info(
                    f"[AO-DEBUG] GOLDM(58424839) in subscription={goldm_in_sub}, "
                    f"registered as MCX/exchangeType=5={goldm_in_mcx}"
                )
                if goldm_in_sub and not goldm_in_mcx:
                    logger.warning(
                        "[AO-DEBUG] ⚠️ GOLDM subscribed but NOT in MCX set — "
                        "will use exchangeType=2 (NFO) instead of 5 (MCX)!"
                    )
                self._sws.subscribe(self._corr_id, 1, token_list)
                logger.info(f"[AO] ✅ Subscribed {len(self._subscribed)} tokens on connect")
            except Exception as e:
                logger.error(f"[AO] Subscription error on connect: {e}")

        # Fire reconnect callbacks (e.g. AlgoRunner.rearm_wt_monitors)
        if self._on_reconnect_callbacks and self._loop and self._loop.is_running():
            for _cb in self._on_reconnect_callbacks:
                try:
                    asyncio.run_coroutine_threadsafe(_cb(), self._loop)
                except Exception as _cbe:
                    logger.warning(f"[AO] Reconnect callback {getattr(_cb, '__name__', '?')} failed: {_cbe}")

    def _on_data(self, ws, message):
        """Hot path — normalise Angel One tick and dispatch to async loop."""
        logger.debug(f"[AO-DEBUG] _on_data — raw message type={type(message).__name__}, len={len(message) if hasattr(message, '__len__') else 'N/A'}")
        from datetime import datetime, timezone
        self._last_tick_at = datetime.now(timezone.utc).isoformat()
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
        self._running   = False
        self._connected = False
        if self._force_stopped:
            logger.info("[AO] _on_close: intentional stop — no auto-reconnect")
            return
        if self._loop and self._loop.is_running():
            asyncio.run_coroutine_threadsafe(self._reconnect(), self._loop)

    def register_on_reconnect_callback(self, cb: Callable):
        """
        Register a callback fired each time the SmartStream WebSocket opens (including reconnects).
        cb must be an async function (no args). Dispatched via run_coroutine_threadsafe.
        Used by AlgoRunner.rearm_wt_monitors() to re-register W&T windows after disconnect.
        """
        self._on_reconnect_callbacks.append(cb)
        logger.info(f"[AO] Registered reconnect callback: {cb.__name__}")

    async def restart(self) -> None:
        """
        Hard-restart SmartStream: close the current WebSocket and reconnect from scratch.
        Called by BrokerReconnectManager when the feed is stale or _connected=False.
        Sets _force_stopped so _on_close does NOT trigger another _reconnect() loop.
        """
        logger.info("[AO] 🔄 restart() — closing WebSocket for hard reconnect...")
        self._force_stopped = True
        self._running       = False
        self._connected     = False
        try:
            if self._sws:
                self._sws.close_connection()
        except Exception as e:
            logger.debug(f"[AO] close_connection in restart (expected): {e}")
        await asyncio.sleep(1)  # Let the close propagate
        self._force_stopped   = False
        self._reconnect_count = 0  # Reset so _reconnect() doesn't think it already gave up
        await self._reconnect()

    def update_feed_token(self, new_token: str):
        """
        Update feed_token in-place on a live adapter.
        Ensures the next reconnect authenticates with the refreshed credential
        without restarting the current WebSocket connection.
        """
        if new_token and new_token != self.feed_token:
            self.feed_token = new_token
            logger.info("[AO] Feed token updated on live adapter")

    # Backoff schedule (seconds) — index = attempt number (0-based, capped at last)
    _RECONNECT_BACKOFF = [2, 4, 8, 16, 30, 30, 30, 60, 60, 60]
    _MAX_RECONNECT_ATTEMPTS = 10

    async def _reconnect(self):
        """
        Attempt to reconnect SmartStream with exponential backoff.
        Fetches fresh auth_token + feed_token from DB before reconnecting so
        a daily re-login never leaves the adapter with stale credentials.
        """
        if self._reconnect_count >= self._MAX_RECONNECT_ATTEMPTS:
            logger.critical(
                f"[AO] ❌ SmartStream gave up after {self._MAX_RECONNECT_ATTEMPTS} reconnect attempts. "
                "Manual intervention required — call POST /api/v1/system/smartstream/start"
            )
            return

        backoff = self._RECONNECT_BACKOFF[
            min(self._reconnect_count, len(self._RECONNECT_BACKOFF) - 1)
        ]
        logger.info(f"[AO] 🔄 SmartStream reconnect backoff {backoff}s (attempt #{self._reconnect_count + 1})...")
        await asyncio.sleep(backoff)
        if self._running:
            return   # already reconnected by another path

        from datetime import datetime, timezone
        self._reconnect_count   += 1
        self._last_reconnect_at  = datetime.now(timezone.utc).isoformat()
        logger.info(f"[AO] 🔄 SmartStream reconnect attempt #{self._reconnect_count}...")

        # ── Refresh credentials from DB ───────────────────────────────────────
        try:
            from app.core.database import AsyncSessionLocal
            from app.models.account import Account
            from sqlalchemy import select as _select
            async with AsyncSessionLocal() as _db:
                _res = await _db.execute(
                    _select(Account).where(Account.client_id == self.client_code)
                )
                _acc = _res.scalar_one_or_none()
                if _acc:
                    if _acc.access_token and _acc.access_token != self.auth_token:
                        self.auth_token = _acc.access_token
                        logger.info("[AO] Auth token refreshed from DB for reconnect")
                    if _acc.feed_token and _acc.feed_token != self.feed_token:
                        self.feed_token = _acc.feed_token
                        logger.info("[AO] Feed token refreshed from DB for reconnect")
        except Exception as _db_err:
            logger.warning(
                f"[AO] Could not fetch fresh tokens from DB — "
                f"reconnecting with cached tokens: {_db_err}"
            )

        # ── Recreate SmartWebSocketV2 with (possibly refreshed) credentials ──
        try:
            from SmartApi.smartWebSocketV2 import SmartWebSocketV2
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
            # connect() blocks forever — must run in executor to avoid freezing the event loop
            loop = self._loop or asyncio.get_event_loop()
            await loop.run_in_executor(None, self._sws.connect)
            # _running is set to True in _on_open when the WebSocket actually opens
            logger.info("[AO] ✅ SmartStream reconnect initiated (waiting for _on_open)")
        except Exception as e:
            logger.error(f"[AO] Reconnect failed: {e}")


class LTPConsumer:

    def __init__(self, ticker, redis_client: aioredis.Redis):
        self.ticker    = ticker          # KiteTicker instance or None
        self.redis     = redis_client
        self._callbacks: List[Callable]       = []
        self._subscribed_tokens: List[int]    = []
        self._bfo_token_set: Set[int]         = set()
        self._angel_adapter: Optional[AngelOneTickerAdapter] = None
        self._ws_manager                      = None   # injected via set_ws_manager()
        self._running  = False
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self.last_tick_time: Optional[float]  = None   # monotonic time of last tick — for BrokerReconnectManager
        self._started_at: Optional[float]     = None   # monotonic time feed was started
        self._ltp_map: Dict[int, float]       = {}     # in-memory cache for sync get_ltp()
        self._ltp_timestamps: Dict[int, float] = {}    # monotonic time of last tick per token
        self._angel_broker                    = None   # injected via set_angel_broker()

    # ── Broker adapter injection ───────────────────────────────────────────────

    def set_ticker(self, ticker):
        """Set or replace the KiteTicker instance. Called after Zerodha login."""
        self.ticker = ticker
        logger.info("[LTP] KiteTicker set")

    def set_angel_adapter(self, adapter: AngelOneTickerAdapter):
        """Attach Angel One SmartStream adapter. Called from services.py after AO login."""
        self._angel_adapter = adapter
        # Push all tokens already tracked by this consumer to the new adapter.
        # This handles the case where subscriptions were attempted before the adapter
        # existed (e.g. tokens added during a period when adapter was None after restart).
        if self._subscribed_tokens:
            adapter.subscribe([str(t) for t in self._subscribed_tokens])
            logger.info(f"[LTP] Replayed {len(self._subscribed_tokens)} existing tokens to new adapter")
        if self._bfo_token_set:
            adapter.register_bfo_tokens([str(t) for t in self._bfo_token_set])
            logger.info(f"[LTP] Replayed {len(self._bfo_token_set)} BFO tokens to new adapter")
        logger.info("[LTP] Angel One adapter registered")

    def set_ws_manager(self, manager):
        """Inject WebSocket manager for real-time broadcast to frontend."""
        self._ws_manager = manager
        logger.info("[LTP] WebSocket manager wired")

    def set_angel_broker(self, broker):
        """Inject Angel One broker for REST LTP fallback when SmartStream is stale."""
        self._angel_broker = broker
        logger.info("[LTP] Angel One broker wired for REST fallback")

    # ── Callback registry ─────────────────────────────────────────────────────

    def register_callback(self, callback: Callable):
        """
        Register a callback fired on every tick.
        Signature: async def callback(instrument_token: int, ltp: float, tick: dict)
        """
        self._callbacks.append(callback)
        logger.info(f"LTP callback registered: {callback.__name__}")

    # ── Subscription ──────────────────────────────────────────────────────────

    def register_bfo_tokens(self, tokens: List[int]):
        """Mark tokens as BFO (BSE F&O, exchangeType=4). Call before subscribe()."""
        self._bfo_token_set.update(tokens)
        if self._angel_adapter:
            self._angel_adapter.register_bfo_tokens([str(t) for t in tokens])

    def subscribe(self, tokens: List[int]):
        """Subscribe to instruments. Safe to call while running. Propagates to both adapters."""
        new = [t for t in tokens if t not in self._subscribed_tokens]
        if new:
            self._subscribed_tokens.extend(new)
            if self._running:
                if self.ticker:
                    self.ticker.subscribe(new)
                    self.ticker.set_mode(self.ticker.MODE_LTP, new)
            # Always push to AO adapter — adapter.subscribe() guards internally with its own
            # _running + _sws check, so this is safe even before SmartStream connects.
            if self._angel_adapter:
                self._angel_adapter.subscribe([str(t) for t in new])
            logger.info(f"Subscribed to {len(new)} new instruments")

    def unsubscribe(self, tokens: List[int]):
        self._subscribed_tokens = [t for t in self._subscribed_tokens if t not in tokens]
        if self._running and self.ticker:
            self.ticker.unsubscribe(tokens)

    def get_ltp(self, token: int) -> float:
        """Synchronous LTP lookup from in-memory tick cache. Returns 0.0 if not yet received."""
        return self._ltp_map.get(int(token), 0.0)

    def is_ltp_fresh(self, token: int, max_age_secs: float = 30.0) -> bool:
        """True if we received a tick for this token within the last max_age_secs seconds."""
        import time as _time
        ts = self._ltp_timestamps.get(int(token))
        if ts is None:
            return False
        return (_time.monotonic() - ts) <= max_age_secs

    async def get_ltp_with_fallback(
        self, token: int, exchange: str = "NFO", symbol: str = "", max_age_secs: float = 30.0
    ) -> float:
        """
        Get LTP, falling back to Angel One REST when SmartStream tick is stale or missing.
        Returns 0.0 only if both paths fail.
        """
        ltp = self._ltp_map.get(int(token), 0.0)
        if ltp > 0 and self.is_ltp_fresh(token, max_age_secs):
            return ltp
        # SmartStream stale or no tick — try Angel One REST
        if self._angel_broker and symbol:
            try:
                rest_ltp = await self._angel_broker.get_ltp_by_token(exchange, symbol, str(token))
                if rest_ltp and rest_ltp > 0:
                    logger.info(
                        f"[LTP] REST fallback for token={token} ({symbol}): {rest_ltp:.2f} "
                        f"(WS ltp={ltp:.2f}, fresh={self.is_ltp_fresh(token, max_age_secs)})"
                    )
                    # Warm the cache so subsequent sync callers benefit
                    import time as _time
                    self._ltp_map[int(token)]        = rest_ltp
                    self._ltp_timestamps[int(token)] = _time.monotonic()
                    return rest_ltp
            except Exception as _e:
                logger.warning(f"[LTP] REST fallback failed for token={token} ({symbol}): {_e}")
        return ltp  # best effort — may be 0.0

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def start(self, tokens: List[int]):
        """Start WebSocket(s). KiteTicker runs in a background thread (sync API)."""
        import time as _time
        self._subscribed_tokens = tokens
        self._started_at = _time.monotonic()
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
            except Exception as e:
                logger.error(f"[LTP] Error in LTPConsumer.stop (ticker.close): {e}", exc_info=True)
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
        import time as _time
        self.last_tick_time = _time.monotonic()
        pipe = self.redis.pipeline()
        for tick in ticks:
            pipe.setex(
                f"{LTP_KEY_PREFIX}{tick['instrument_token']}",
                LTP_EXPIRY_SECS,
                str(tick.get("last_price", 0))
            )
            # Update in-memory cache + staleness timestamps for sync get_ltp() callers
            _tok = int(tick['instrument_token'])
            self._ltp_map[_tok]        = float(tick.get('last_price', 0))
            self._ltp_timestamps[_tok] = self.last_tick_time  # monotonic
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

    def evict_stale_tokens(self) -> int:
        """Remove tokens from _ltp_map and _ltp_timestamps that are no longer subscribed.
        Call at EOD after daily_system_reset. Returns count of evicted tokens."""
        active = set(self._subscribed_tokens)
        stale = set(self._ltp_map.keys()) - active
        for t in stale:
            self._ltp_map.pop(t, None)
            self._ltp_timestamps.pop(t, None)
        if stale:
            logger.info(f"[LTP] Evicted {len(stale)} stale tokens from cache. Active: {len(self._ltp_map)}")
        return len(stale)


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
