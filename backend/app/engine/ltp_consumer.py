"""
LTP Consumer — Zerodha KiteConnect WebSocket tick consumer.
The most latency-critical component in STAAX. Target: <100ms tick-to-decision.

Architecture:
  - KiteTicker WebSocket receives ticks from NSE feed
  - Every tick: write LTP to Redis + fire all registered callbacks
  - Callbacks: ORBTracker, WTEvaluator, SLTPMonitor, TSLEngine, MTMMonitor
  - All evaluation is in-memory — zero DB queries on tick path

LTPCache: Redis-backed read cache for all monitors.
"""
import asyncio
import logging
from typing import Dict, Callable, List, Optional
import redis.asyncio as aioredis
from kiteconnect import KiteTicker

logger = logging.getLogger(__name__)

LTP_KEY_PREFIX  = "ltp:"
LTP_EXPIRY_SECS = 86400  # 24 hours


class LTPConsumer:

    def __init__(self, ticker: KiteTicker, redis_client: aioredis.Redis):
        self.ticker    = ticker
        self.redis     = redis_client
        self._callbacks: List[Callable]  = []
        self._subscribed_tokens: List[int] = []
        self._running  = False
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def register_callback(self, callback: Callable):
        """
        Register a callback fired on every tick.
        Signature: async def callback(instrument_token: int, ltp: float, tick: dict)
        """
        self._callbacks.append(callback)
        logger.info(f"LTP callback registered: {callback.__name__}")

    def subscribe(self, tokens: List[int]):
        """Subscribe to instruments. Safe to call while running."""
        new = [t for t in tokens if t not in self._subscribed_tokens]
        if new:
            self._subscribed_tokens.extend(new)
            if self._running:
                self.ticker.subscribe(new)
                self.ticker.set_mode(self.ticker.MODE_LTP, new)
                logger.info(f"Subscribed to {len(new)} new instruments")

    def unsubscribe(self, tokens: List[int]):
        self._subscribed_tokens = [t for t in self._subscribed_tokens if t not in tokens]
        if self._running:
            self.ticker.unsubscribe(tokens)

    def start(self, tokens: List[int]):
        """Start WebSocket. Runs in background thread (KiteTicker is sync)."""
        self._subscribed_tokens = tokens
        self._loop = asyncio.get_event_loop()

        self.ticker.on_ticks     = self._on_ticks
        self.ticker.on_connect   = self._on_connect
        self.ticker.on_close     = self._on_close
        self.ticker.on_error     = self._on_error
        self.ticker.on_reconnect = self._on_reconnect

        self.ticker.connect(threaded=True)
        self._running = True
        logger.info(f"✅ LTP Consumer started — {len(tokens)} instruments")

    def stop(self):
        self._running = False
        try:
            self.ticker.close()
        except Exception:
            pass
        logger.info("🛑 LTP Consumer stopped")

    def _on_connect(self, ws, response):
        logger.info("✅ Zerodha WebSocket connected")
        if self._subscribed_tokens:
            ws.subscribe(self._subscribed_tokens)
            ws.set_mode(ws.MODE_LTP, self._subscribed_tokens)

    def _on_ticks(self, ws, ticks):
        """Hot path — called on every tick. Dispatch to async loop."""
        if ticks and self._loop:
            asyncio.run_coroutine_threadsafe(
                self._process_ticks(ticks), self._loop
            )

    async def _process_ticks(self, ticks: list):
        """Write to Redis + fire all callbacks."""
        pipe = self.redis.pipeline()
        for tick in ticks:
            pipe.setex(
                f"{LTP_KEY_PREFIX}{tick['instrument_token']}",
                LTP_EXPIRY_SECS,
                str(tick.get("last_price", 0))
            )
        await pipe.execute()

        for tick in ticks:
            token = tick["instrument_token"]
            ltp   = tick.get("last_price", 0)
            for cb in self._callbacks:
                try:
                    await cb(token, ltp, tick)
                except Exception as e:
                    logger.error(f"Callback error in {cb.__name__}: {e}")

    def _on_close(self, ws, code, reason):
        logger.warning(f"⚠️ WebSocket closed: {code} — {reason}")
        self._running = False

    def _on_error(self, ws, code, reason):
        logger.error(f"❌ WebSocket error: {code} — {reason}")

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
