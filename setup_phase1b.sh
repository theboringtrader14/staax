#!/bin/bash
# STAAX Phase 1B — Zerodha Integration + Core Execution Engine
# Run from inside your staax directory: bash setup_phase1b.sh

echo "🚀 Setting up Phase 1B — Zerodha Integration + Core Engine..."

# ─── ZERODHA BROKER (Full Implementation) ────────────────────────────────────

cat > backend/app/brokers/zerodha.py << 'EOF'
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
            instruments = self.kite.instruments("NFO")
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
EOF

# ─── TOKEN REFRESH SERVICE ────────────────────────────────────────────────────

cat > backend/app/services/token_refresh.py << 'EOF'
"""
Token Refresh Service — daily API token management.

Zerodha flow (once per day, ~30 seconds):
  1. User clicks "Login to Zerodha" button in STAAX UI
  2. Browser opens Zerodha login page
  3. User enters password + Google Authenticator TOTP
  4. Zerodha redirects to http://127.0.0.1?request_token=XXXX
  5. Frontend captures request_token from URL and sends to backend
  6. Backend calls set_access_token() — token valid for the day

Angel One: Auto-refresh via TOTP using pyotp (no manual step needed).
"""
import logging
import pyotp
from datetime import datetime, date
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from app.core.config import settings
from app.brokers.zerodha import ZerodhaBroker
from app.models.account import Account, AccountStatus, BrokerType

logger = logging.getLogger(__name__)


class TokenRefreshService:

    def __init__(self, db: AsyncSession, zerodha_broker: ZerodhaBroker):
        self.db      = db
        self.zerodha = zerodha_broker

    # ── Zerodha ───────────────────────────────────────────────────────────────

    def get_zerodha_login_url(self) -> str:
        return self.zerodha.get_login_url()

    async def complete_zerodha_login(self, request_token: str) -> str:
        """
        Called after user completes browser login.
        Exchanges request_token → access_token and persists to DB.
        """
        access_token = await self.zerodha.set_access_token(request_token)

        await self.db.execute(
            update(Account)
            .where(Account.broker == BrokerType.ZERODHA)
            .values(
                access_token=access_token,
                token_generated_at=datetime.utcnow(),
                status=AccountStatus.ACTIVE,
            )
        )
        await self.db.commit()
        logger.info("✅ Zerodha token saved to DB")
        return access_token

    async def load_zerodha_token_from_db(self) -> Optional[str]:
        """
        On server startup: load today's token from DB if available.
        Returns None if no valid token → user must log in.
        """
        result = await self.db.execute(
            select(Account).where(Account.broker == BrokerType.ZERODHA)
        )
        account = result.scalar_one_or_none()
        if not account or not account.access_token:
            return None

        if account.token_generated_at:
            if account.token_generated_at.date() == date.today():
                await self.zerodha.load_token(account.access_token)
                logger.info("✅ Zerodha token restored from DB")
                return account.access_token

        # Token is stale
        await self.db.execute(
            update(Account)
            .where(Account.broker == BrokerType.ZERODHA)
            .values(status=AccountStatus.TOKEN_EXPIRED)
        )
        await self.db.commit()
        logger.warning("⚠️ Zerodha token expired — login required")
        return None

    # ── Angel One ─────────────────────────────────────────────────────────────

    async def refresh_angelone_token(self, account_name: str) -> Optional[str]:
        """
        Auto-refresh Angel One token using TOTP.
        account_name: 'mom' or 'wife'
        No manual step needed.
        """
        try:
            from smartapi import SmartConnect

            if account_name == "mom":
                api_key     = settings.ANGELONE_MOM_API_KEY
                client_id   = settings.ANGELONE_MOM_CLIENT_ID
                totp_secret = settings.ANGELONE_MOM_TOTP_SECRET
                nickname    = "Mom"
            else:
                api_key     = settings.ANGELONE_WIFE_API_KEY
                client_id   = settings.ANGELONE_WIFE_CLIENT_ID
                totp_secret = settings.ANGELONE_WIFE_TOTP_SECRET
                nickname    = "Wife"

            totp  = pyotp.TOTP(totp_secret).now()
            smart = SmartConnect(api_key=api_key)
            # Note: PIN stored in .env as ANGELONE_MOM_PIN — added in Phase 1A full auth
            pin   = getattr(settings, f"ANGELONE_{account_name.upper()}_PIN", "")
            session = smart.generateSession(client_id, pin, totp)
            access_token = session["data"]["jwtToken"]

            await self.db.execute(
                update(Account)
                .where(Account.nickname == nickname)
                .values(
                    access_token=access_token,
                    token_generated_at=datetime.utcnow(),
                    status=AccountStatus.ACTIVE,
                )
            )
            await self.db.commit()
            logger.info(f"✅ Angel One token refreshed — {nickname}")
            return access_token

        except Exception as e:
            logger.error(f"❌ Angel One token refresh failed ({account_name}): {e}")
            return None

    async def refresh_all(self):
        """
        Called by scheduler at 08:30 IST each morning.
        Zerodha: checks if token exists. If not, sends login reminder.
        Angel One: auto-refreshes via TOTP.
        """
        zerodha_token = await self.load_zerodha_token_from_db()
        if not zerodha_token:
            logger.warning("⚠️ Zerodha login required — sending notification")
            # NotificationService().send_login_reminder() — wired in Phase 1E

        await self.refresh_angelone_token("mom")
        # await self.refresh_angelone_token("wife")  # Phase 2
EOF

# ─── LTP CONSUMER ────────────────────────────────────────────────────────────

cat > backend/app/engine/ltp_consumer.py << 'EOF'
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
EOF

# ─── STRIKE SELECTOR ─────────────────────────────────────────────────────────

cat > backend/app/engine/strike_selector.py << 'EOF'
"""
Strike Selector — selects the correct F&O strike at entry time.
Supports: ATM, ITM1–ITM10, OTM1–OTM10, Premium, Straddle Premium.
Delta-based selection: Phase 2.

Strike multiples: NIFTY=50, BANKNIFTY=100, SENSEX=100,
                  MIDCAPNIFTY=25, FINNIFTY=50
"""
import logging
from typing import Optional, List, Dict
from app.brokers.zerodha import ZerodhaBroker

logger = logging.getLogger(__name__)

STRIKE_MULTIPLES = {
    "NIFTY":       50,
    "BANKNIFTY":   100,
    "SENSEX":      100,
    "MIDCAPNIFTY": 25,
    "FINNIFTY":    50,
}


class StrikeSelector:

    def __init__(self, broker: ZerodhaBroker):
        self.broker = broker

    async def select(
        self,
        underlying: str,
        instrument_type: str,        # "ce" or "pe"
        expiry: str,                 # "2024-02-29"
        strike_type: str,            # "atm", "itm3", "otm2", "premium", "straddle_premium"
        strike_value: Optional[float] = None,
    ) -> Optional[Dict]:
        """
        Select the appropriate strike at the current moment.
        Returns the full instrument dict from KiteConnect.
        """
        spot     = await self.broker.get_underlying_ltp(underlying)
        multiple = STRIKE_MULTIPLES.get(underlying.upper(), 50)

        chain    = await self.broker.get_option_chain(underlying, expiry)
        instruments = chain.get("instruments", [])
        opt_type = instrument_type.upper()  # "CE" or "PE"
        filtered = [i for i in instruments if i["instrument_type"] == opt_type]

        if not filtered:
            logger.error(f"No {opt_type} instruments for {underlying} {expiry}")
            return None

        atm_strike = round(spot / multiple) * multiple

        if strike_type.lower() == "atm":
            target = atm_strike

        elif strike_type.lower().startswith("itm"):
            n = int(strike_type[3:])  # "itm3" → 3
            target = atm_strike - (n * multiple) if opt_type == "CE" else atm_strike + (n * multiple)

        elif strike_type.lower().startswith("otm"):
            n = int(strike_type[3:])  # "otm2" → 2
            target = atm_strike + (n * multiple) if opt_type == "CE" else atm_strike - (n * multiple)

        elif strike_type.lower() == "premium":
            return await self._by_premium(filtered, strike_value or 0)

        elif strike_type.lower() == "straddle_premium":
            return await self._by_straddle_premium(instruments, atm_strike, multiple, strike_value or 0)

        else:
            logger.error(f"Unknown strike type: {strike_type}")
            return None

        match = next((i for i in filtered if i["strike"] == target), None)
        if not match:
            logger.error(f"No instrument at strike {target}")
        return match

    async def _by_premium(self, instruments: List[Dict], target: float) -> Optional[Dict]:
        symbols = [f"NFO:{i['tradingsymbol']}" for i in instruments]
        ltps    = await self.broker.get_ltp(symbols)
        best, best_diff = None, float("inf")
        for inst in instruments:
            ltp  = ltps.get(f"NFO:{inst['tradingsymbol']}", 0)
            diff = abs(ltp - target)
            if diff < best_diff:
                best_diff, best = diff, inst
        return best

    async def _by_straddle_premium(
        self, instruments: List[Dict], atm: float, multiple: int, target: float
    ) -> Optional[Dict]:
        best_strike, best_diff = None, float("inf")
        for offset in range(-2, 3):
            strike = atm + (offset * multiple)
            ce = next((i for i in instruments if i["strike"] == strike and i["instrument_type"] == "CE"), None)
            pe = next((i for i in instruments if i["strike"] == strike and i["instrument_type"] == "PE"), None)
            if not ce or not pe:
                continue
            ltps     = await self.broker.get_ltp([f"NFO:{ce['tradingsymbol']}", f"NFO:{pe['tradingsymbol']}"])
            combined = ltps.get(f"NFO:{ce['tradingsymbol']}", 0) + ltps.get(f"NFO:{pe['tradingsymbol']}", 0)
            diff     = abs(combined - target)
            if diff < best_diff:
                best_diff, best_strike = diff, strike
        return next((i for i in instruments if i["strike"] == best_strike and i["instrument_type"] == "CE"), None)
EOF

# ─── ORB TRACKER ─────────────────────────────────────────────────────────────

cat > backend/app/engine/orb_tracker.py << 'EOF'
"""
ORB Tracker — Opening Range Breakout engine.

For each active ORB algo:
  1. During ORB window: track tick High and Low continuously
  2. After window closes: range is locked
  3. BUY  → entry when LTP crosses Range High (+ W&T buffer if set)
  4. SELL → entry when LTP crosses Range Low  (- W&T buffer if set)
  5. No breakout before orb_end_time → NO_TRADE

Entry fires on LTP cross — no candle close wait.
"""
import logging
from datetime import datetime, time
from typing import Dict, Callable, Optional
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class ORBWindow:
    grid_entry_id:    str
    algo_id:          str
    direction:        str        # "buy" or "sell"
    start_time:       time
    end_time:         time
    instrument_token: int
    wt_value:         float = 0.0
    wt_unit:          str   = "pts"  # "pts" or "pct"
    # Runtime
    range_high:       float = 0.0
    range_low:        float = float("inf")
    is_range_set:     bool  = False
    is_triggered:     bool  = False
    is_no_trade:      bool  = False

    def entry_high(self) -> float:
        """BUY entry = ORB High + W&T buffer."""
        if self.wt_unit == "pct":
            return self.range_high * (1 + self.wt_value / 100)
        return self.range_high + self.wt_value

    def entry_low(self) -> float:
        """SELL entry = ORB Low - W&T buffer."""
        if self.wt_unit == "pct":
            return self.range_low * (1 - self.wt_value / 100)
        return self.range_low - self.wt_value


class ORBTracker:
    """Manages all active ORB windows. Registered as LTP callback."""

    def __init__(self):
        self._windows: Dict[str, ORBWindow]   = {}
        self._callbacks: Dict[str, Callable]  = {}

    def register(self, window: ORBWindow, on_entry: Callable):
        """on_entry(grid_entry_id, entry_price) called on breakout."""
        self._windows[window.grid_entry_id]   = window
        self._callbacks[window.grid_entry_id] = on_entry
        logger.info(f"ORB registered: {window.algo_id} | {window.start_time}–{window.end_time} | {window.direction}")

    def deregister(self, grid_entry_id: str):
        self._windows.pop(grid_entry_id, None)
        self._callbacks.pop(grid_entry_id, None)

    async def on_tick(self, token: int, ltp: float, tick: dict):
        """Called on every tick — evaluate all ORB windows."""
        now = datetime.now().time()
        for eid, w in list(self._windows.items()):
            if w.instrument_token != token or w.is_triggered or w.is_no_trade:
                continue

            # Inside window — track range
            if w.start_time <= now <= w.end_time:
                w.range_high = max(w.range_high, ltp)
                w.range_low  = min(w.range_low, ltp)
                continue

            # Window just closed — lock range
            if not w.is_range_set:
                if w.range_high == 0 or w.range_low == float("inf"):
                    w.is_no_trade = True
                    logger.info(f"ORB no trade (no ticks): {w.algo_id}")
                    continue
                w.is_range_set = True
                logger.info(
                    f"ORB range locked: {w.algo_id} | "
                    f"H={w.range_high} L={w.range_low} | "
                    f"Entry H={w.entry_high():.2f} L={w.entry_low():.2f}"
                )

            # Monitor for breakout
            if w.direction == "buy" and ltp >= w.entry_high():
                w.is_triggered = True
                logger.info(f"🟢 ORB BUY triggered: {w.algo_id} @ {ltp}")
                cb = self._callbacks.get(eid)
                if cb:
                    await cb(eid, w.entry_high())

            elif w.direction == "sell" and ltp <= w.entry_low():
                w.is_triggered = True
                logger.info(f"🔴 ORB SELL triggered: {w.algo_id} @ {ltp}")
                cb = self._callbacks.get(eid)
                if cb:
                    await cb(eid, w.entry_low())
EOF

# ─── W&T EVALUATOR ───────────────────────────────────────────────────────────

cat > backend/app/engine/wt_evaluator.py << 'EOF'
"""
W&T Evaluator — Wait and Trade engine.

  1. At configured entry time (E:) — capture reference price (LTP)
  2. Compute threshold: ref ± X% or ± X pts
  3. Monitor every tick until threshold is crossed
  4. Fire entry signal immediately — no candle wait

Example: ATM CE = 133 at 9:35. W&T Up 10% → entry at 146.3.
"""
import logging
from datetime import datetime, time
from typing import Dict, Callable
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class WTWindow:
    grid_entry_id:    str
    algo_id:          str
    direction:        str       # "up" or "down"
    entry_time:       time      # time to capture reference price
    instrument_token: int
    wt_value:         float
    wt_unit:          str       # "pts" or "pct"
    # Runtime
    reference_price:  float = 0.0
    threshold:        float = 0.0
    is_ref_set:       bool  = False
    is_triggered:     bool  = False

    def compute_threshold(self):
        if self.direction == "up":
            self.threshold = (
                self.reference_price * (1 + self.wt_value / 100)
                if self.wt_unit == "pct"
                else self.reference_price + self.wt_value
            )
        else:
            self.threshold = (
                self.reference_price * (1 - self.wt_value / 100)
                if self.wt_unit == "pct"
                else self.reference_price - self.wt_value
            )


class WTEvaluator:
    """Manages all active W&T windows. Registered as LTP callback."""

    def __init__(self):
        self._windows: Dict[str, WTWindow]   = {}
        self._callbacks: Dict[str, Callable] = {}

    def register(self, window: WTWindow, on_entry: Callable):
        self._windows[window.grid_entry_id]   = window
        self._callbacks[window.grid_entry_id] = on_entry
        logger.info(
            f"W&T registered: {window.algo_id} | "
            f"{window.direction} {window.wt_value}{window.wt_unit} at {window.entry_time}"
        )

    def deregister(self, grid_entry_id: str):
        self._windows.pop(grid_entry_id, None)
        self._callbacks.pop(grid_entry_id, None)

    async def on_tick(self, token: int, ltp: float, tick: dict):
        now = datetime.now().time()
        for eid, w in list(self._windows.items()):
            if w.instrument_token != token or w.is_triggered:
                continue

            # Capture reference at entry time
            if not w.is_ref_set:
                if now >= w.entry_time:
                    w.reference_price = ltp
                    w.compute_threshold()
                    w.is_ref_set = True
                    logger.info(f"W&T ref captured: {w.algo_id} | ref={ltp} threshold={w.threshold:.2f}")
                continue

            # Monitor threshold
            if w.direction == "up" and ltp >= w.threshold:
                w.is_triggered = True
                logger.info(f"🟢 W&T UP triggered: {w.algo_id} @ {ltp}")
                cb = self._callbacks.get(eid)
                if cb:
                    await cb(eid, ltp)

            elif w.direction == "down" and ltp <= w.threshold:
                w.is_triggered = True
                logger.info(f"🔴 W&T DOWN triggered: {w.algo_id} @ {ltp}")
                cb = self._callbacks.get(eid)
                if cb:
                    await cb(eid, ltp)
EOF

# ─── SL/TP MONITOR ───────────────────────────────────────────────────────────

cat > backend/app/engine/sl_tp_monitor.py << 'EOF'
"""
SL/TP Monitor — per-leg stop loss and target monitoring.
Evaluates on every tick for all open positions.

Four variants (SL and TP both):
  pts_instrument  — option/futures drops X pts from entry
  pct_instrument  — option/futures drops X% from entry
  pts_underlying  — underlying moves X pts against position
  pct_underlying  — underlying moves X% against position

TSLEngine updates sl_actual when trailing.
"""
import logging
from typing import Dict, Callable, Optional
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class PositionMonitor:
    order_id:          str
    grid_entry_id:     str
    algo_id:           str
    direction:         str          # "buy" or "sell"
    instrument_token:  int
    underlying_token:  int
    entry_price:       float
    sl_type:           Optional[str]
    sl_value:          Optional[float]
    tp_type:           Optional[str]
    tp_value:          Optional[float]
    sl_actual:         float = 0.0   # updated by TSLEngine
    tp_level:          float = 0.0
    is_active:         bool  = True
    tsl_trail_count:   int   = 0

    def compute_levels(self):
        """Compute initial SL and TP levels from entry price."""
        # SL
        if self.sl_type and self.sl_value:
            if self.sl_type == "pts_instrument":
                self.sl_actual = self.entry_price - self.sl_value if self.direction == "buy" else self.entry_price + self.sl_value
            elif self.sl_type == "pct_instrument":
                self.sl_actual = self.entry_price * (1 - self.sl_value/100) if self.direction == "buy" else self.entry_price * (1 + self.sl_value/100)
            # pts/pct_underlying computed dynamically

        # TP
        if self.tp_type and self.tp_value:
            if self.tp_type == "pts_instrument":
                self.tp_level = self.entry_price + self.tp_value if self.direction == "buy" else self.entry_price - self.tp_value
            elif self.tp_type == "pct_instrument":
                self.tp_level = self.entry_price * (1 + self.tp_value/100) if self.direction == "buy" else self.entry_price * (1 - self.tp_value/100)

    def is_sl_hit(self, ltp: float, ul_ltp: Optional[float] = None) -> bool:
        if not self.sl_type or not self.sl_value:
            return False
        if self.sl_type in ("pts_instrument", "pct_instrument"):
            return ltp <= self.sl_actual if self.direction == "buy" else ltp >= self.sl_actual
        if self.sl_type == "pts_underlying" and ul_ltp:
            ref = self.entry_price  # entry underlying price stored separately
            return ul_ltp <= ref - self.sl_value if self.direction == "buy" else ul_ltp >= ref + self.sl_value
        if self.sl_type == "pct_underlying" and ul_ltp:
            ref = self.entry_price
            return ul_ltp <= ref * (1 - self.sl_value/100) if self.direction == "buy" else ul_ltp >= ref * (1 + self.sl_value/100)
        return False

    def is_tp_hit(self, ltp: float, ul_ltp: Optional[float] = None) -> bool:
        if not self.tp_type or not self.tp_value:
            return False
        if self.tp_type in ("pts_instrument", "pct_instrument"):
            return ltp >= self.tp_level if self.direction == "buy" else ltp <= self.tp_level
        if self.tp_type == "pts_underlying" and ul_ltp:
            ref = self.entry_price
            return ul_ltp >= ref + self.tp_value if self.direction == "buy" else ul_ltp <= ref - self.tp_value
        if self.tp_type == "pct_underlying" and ul_ltp:
            ref = self.entry_price
            return ul_ltp >= ref * (1 + self.tp_value/100) if self.direction == "buy" else ul_ltp <= ref * (1 - self.tp_value/100)
        return False

    def unrealised_pnl(self, ltp: float) -> float:
        return (ltp - self.entry_price) if self.direction == "buy" else (self.entry_price - ltp)


class SLTPMonitor:
    """Monitors all open positions for SL/TP hits. Registered as LTP callback."""

    def __init__(self):
        self._positions: Dict[str, PositionMonitor] = {}
        self._sl_callbacks: Dict[str, Callable]     = {}
        self._tp_callbacks: Dict[str, Callable]     = {}
        self._underlying_ltps: Dict[int, float]     = {}

    def add_position(self, monitor: PositionMonitor, on_sl: Callable, on_tp: Callable):
        monitor.compute_levels()
        self._positions[monitor.order_id]    = monitor
        self._sl_callbacks[monitor.order_id] = on_sl
        self._tp_callbacks[monitor.order_id] = on_tp
        logger.info(f"Monitoring: {monitor.order_id} | SL={monitor.sl_actual:.2f} TP={monitor.tp_level:.2f}")

    def remove_position(self, order_id: str):
        self._positions.pop(order_id, None)
        self._sl_callbacks.pop(order_id, None)
        self._tp_callbacks.pop(order_id, None)

    def update_sl(self, order_id: str, new_sl: float):
        """Called by TSLEngine when trailing."""
        if order_id in self._positions:
            self._positions[order_id].sl_actual = new_sl

    def update_underlying_ltp(self, token: int, ltp: float):
        self._underlying_ltps[token] = ltp

    async def on_tick(self, token: int, ltp: float, tick: dict):
        for order_id, m in list(self._positions.items()):
            if not m.is_active or m.instrument_token != token:
                continue
            ul = self._underlying_ltps.get(m.underlying_token)

            if m.is_sl_hit(ltp, ul):
                m.is_active = False
                logger.info(f"🔴 SL HIT: {order_id} @ {ltp}")
                if cb := self._sl_callbacks.get(order_id):
                    await cb(order_id, ltp, "sl")

            elif m.is_tp_hit(ltp, ul):
                m.is_active = False
                logger.info(f"🟢 TP HIT: {order_id} @ {ltp}")
                if cb := self._tp_callbacks.get(order_id):
                    await cb(order_id, ltp, "tp")
EOF

# ─── TSL ENGINE ───────────────────────────────────────────────────────────────

cat > backend/app/engine/tsl_engine.py << 'EOF'
"""
TSL Engine — Trailing Stop Loss (Stepped Logic).

Rules:
  - Activates immediately from entry — no lock-in period
  - For every X move in favour, SL shifts Y in the same direction
  - X and Y in same unit (pts or %)
  - TSL only moves favourably — never reverses

Example: Buy @ 100, TSL X=5pts Y=3pts, initial SL=90
  Price 105 → SL=93  (trail #1)
  Price 110 → SL=96  (trail #2)
  Price 115 → SL=99  (trail #3)
  Price falls to 99  → SL Monitor fires exit
"""
import logging
from typing import Dict
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class TSLState:
    order_id:           str
    direction:          str
    entry_price:        float
    current_sl:         float
    tsl_x:              float
    tsl_y:              float
    tsl_unit:           str        # "pts" or "pct"
    trail_count:        int   = 0
    last_trigger_price: float = 0.0

    def __post_init__(self):
        self.last_trigger_price = self.entry_price

    def check_and_trail(self, ltp: float) -> bool:
        """Check if SL should move. Returns True if updated."""
        x = self.tsl_x if self.tsl_unit == "pts" else self.entry_price * self.tsl_x / 100
        y = self.tsl_y if self.tsl_unit == "pts" else self.entry_price * self.tsl_y / 100

        if self.direction == "buy":
            steps = int((ltp - self.last_trigger_price) / x)
            if steps > 0:
                new_sl = self.current_sl + (steps * y)
                if new_sl > self.current_sl:
                    self.current_sl         = new_sl
                    self.last_trigger_price += steps * x
                    self.trail_count        += steps
                    logger.info(f"TSL trailed: {self.order_id} → SL={self.current_sl:.2f} (trail #{self.trail_count})")
                    return True
        else:
            steps = int((self.last_trigger_price - ltp) / x)
            if steps > 0:
                new_sl = self.current_sl - (steps * y)
                if new_sl < self.current_sl:
                    self.current_sl         = new_sl
                    self.last_trigger_price -= steps * x
                    self.trail_count        += steps
                    logger.info(f"TSL trailed: {self.order_id} → SL={self.current_sl:.2f} (trail #{self.trail_count})")
                    return True
        return False


class TSLEngine:
    """Manages TSL for all open positions. Registered as LTP callback."""

    def __init__(self, sl_monitor):
        self.sl_monitor = sl_monitor
        self._states: Dict[str, TSLState] = {}

    def register(self, state: TSLState):
        self._states[state.order_id] = state
        logger.info(f"TSL registered: {state.order_id} | X={state.tsl_x}{state.tsl_unit} Y={state.tsl_y}{state.tsl_unit}")

    def deregister(self, order_id: str):
        self._states.pop(order_id, None)

    def has_trailed(self, order_id: str) -> bool:
        """True if TSL has moved at least once — used by AT_COST re-entry check."""
        s = self._states.get(order_id)
        return s is not None and s.trail_count > 0

    async def on_tick(self, token: int, ltp: float, tick: dict):
        for order_id, state in list(self._states.items()):
            pos = self.sl_monitor._positions.get(order_id)
            if not pos or not pos.is_active or pos.instrument_token != token:
                continue
            if state.check_and_trail(ltp):
                self.sl_monitor.update_sl(order_id, state.current_sl)
EOF

# ─── MTM MONITOR ─────────────────────────────────────────────────────────────

cat > backend/app/engine/mtm_monitor.py << 'EOF'
"""
MTM Monitor — algo-level and account-level MTM P&L tracking.

Algo level:
  - Sums all open leg P&Ls for one algo
  - Fires square-off when MTM SL or MTM TP breached
  - MTM % base = combined entry premium of all legs

Account level (Global):
  - Sums all algo MTMs for the account
  - Fires stop-all on global SL/TP breach
"""
import logging
from typing import Dict, Callable, List, Optional
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class AlgoMTMState:
    algo_id:          str
    account_id:       str
    mtm_sl:           Optional[float]
    mtm_tp:           Optional[float]
    mtm_unit:         str   = "amt"    # "amt" or "pct"
    combined_premium: float = 0.0      # sum of all leg entry premiums
    order_ids:        List[str] = field(default_factory=list)


class MTMMonitor:

    def __init__(self):
        self._algos: Dict[str, AlgoMTMState]     = {}
        self._sq_callbacks: Dict[str, Callable]  = {}
        self._global_sl: Dict[str, float]        = {}
        self._global_tp: Dict[str, float]        = {}
        self._global_cbs: Dict[str, Callable]    = {}
        self._live_pnls: Dict[str, Dict[str, float]] = {}  # algo_id → {order_id: pnl}

    def register_algo(self, state: AlgoMTMState, on_breach: Callable):
        self._algos[state.algo_id]        = state
        self._sq_callbacks[state.algo_id] = on_breach
        self._live_pnls[state.algo_id]    = {}

    def register_global(self, account_id: str, global_sl: Optional[float],
                        global_tp: Optional[float], on_breach: Callable):
        if global_sl: self._global_sl[account_id] = global_sl
        if global_tp: self._global_tp[account_id] = global_tp
        self._global_cbs[account_id] = on_breach

    async def update_pnl(self, algo_id: str, order_id: str, pnl: float):
        """Called on every tick with updated unrealised P&L for one leg."""
        if algo_id not in self._live_pnls:
            return
        self._live_pnls[algo_id][order_id] = pnl
        total = sum(self._live_pnls[algo_id].values())

        state = self._algos.get(algo_id)
        if not state:
            return

        sl_thresh = self._threshold(state, state.mtm_sl)
        tp_thresh = self._threshold(state, state.mtm_tp)

        if sl_thresh and total <= -abs(sl_thresh):
            logger.info(f"🔴 MTM SL HIT: {algo_id} | total={total:.2f}")
            if cb := self._sq_callbacks.get(algo_id):
                await cb(algo_id, "mtm_sl", total)

        elif tp_thresh and total >= tp_thresh:
            logger.info(f"🟢 MTM TP HIT: {algo_id} | total={total:.2f}")
            if cb := self._sq_callbacks.get(algo_id):
                await cb(algo_id, "mtm_tp", total)

    def _threshold(self, state: AlgoMTMState, value: Optional[float]) -> Optional[float]:
        if not value:
            return None
        if state.mtm_unit == "amt":
            return value
        if state.mtm_unit == "pct" and state.combined_premium > 0:
            return state.combined_premium * (value / 100)
        return None
EOF

# ─── VIRTUAL ORDER BOOK (PRACTIX) ────────────────────────────────────────────

cat > backend/app/engine/virtual_order_book.py << 'EOF'
"""
Virtual Order Book — PRACTIX paper trading simulation.

Identical execution path to live. Only difference:
  order placement → here instead of broker API.

Fills simulated at LTP at signal time.
P&L tracked in real-time against live market prices.
"""
import logging
import uuid
from datetime import datetime
from typing import Dict, Optional
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class VirtualOrder:
    order_id:    str
    algo_id:     str
    symbol:      str
    direction:   str
    quantity:    int
    fill_price:  float
    fill_time:   datetime
    ltp:         float = 0.0
    exit_price:  float = 0.0
    exit_time:   Optional[datetime] = None
    exit_reason: str   = ""
    is_open:     bool  = True

    @property
    def pnl(self) -> float:
        price = self.exit_price if self.exit_price else self.ltp
        return (price - self.fill_price) * self.quantity if self.direction == "buy" \
               else (self.fill_price - price) * self.quantity


class VirtualOrderBook:

    def __init__(self):
        self._orders: Dict[str, VirtualOrder] = {}

    async def place_order(
        self, algo_id: str, symbol: str, direction: str,
        quantity: int, ltp: float, order_type: str = "market",
        limit_price: Optional[float] = None,
    ) -> str:
        fill = limit_price if (order_type == "limit" and limit_price) else ltp
        order_id = str(uuid.uuid4())
        self._orders[order_id] = VirtualOrder(
            order_id=order_id, algo_id=algo_id, symbol=symbol,
            direction=direction, quantity=quantity,
            fill_price=fill, fill_time=datetime.utcnow(), ltp=ltp,
        )
        logger.info(f"📄 PRACTIX: {direction.upper()} {quantity} {symbol} @ {fill}")
        return order_id

    async def close_order(self, order_id: str, exit_ltp: float, reason: str = "sq") -> Optional[float]:
        o = self._orders.get(order_id)
        if not o or not o.is_open:
            return None
        o.exit_price = exit_ltp
        o.exit_time  = datetime.utcnow()
        o.exit_reason = reason
        o.is_open    = False
        logger.info(f"📄 PRACTIX closed: {order_id} | P&L=₹{o.pnl:,.2f} | {reason}")
        return o.pnl

    async def update_ltp(self, order_id: str, ltp: float):
        if order_id in self._orders:
            self._orders[order_id].ltp = ltp

    def get_open_orders(self) -> Dict[str, VirtualOrder]:
        return {oid: o for oid, o in self._orders.items() if o.is_open}

    def get_total_pnl(self, algo_id: str) -> float:
        return sum(o.pnl for o in self._orders.values() if o.algo_id == algo_id)
EOF

# ─── ORDER PLACER ─────────────────────────────────────────────────────────────

cat > backend/app/engine/order_placer.py << 'EOF'
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
EOF

# ─── UPDATE ACCOUNTS API WITH TOKEN ENDPOINTS ─────────────────────────────────

cat > backend/app/api/v1/accounts.py << 'EOF'
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db

router = APIRouter()


@router.get("/")
async def list_accounts(db: AsyncSession = Depends(get_db)):
    """List all configured broker accounts."""
    return {"accounts": [], "message": "Phase 1A — implement in Phase 1C"}


@router.post("/")
async def create_account(db: AsyncSession = Depends(get_db)):
    return {"message": "Create account — Phase 1A"}


@router.get("/status")
async def account_status(db: AsyncSession = Depends(get_db)):
    """Connection status for all accounts."""
    return {"accounts": [], "message": "Status check"}


@router.post("/{account_id}/margin")
async def update_margin(account_id: str, db: AsyncSession = Depends(get_db)):
    """Update FY margin for ROI calculation."""
    return {"message": "Margin updated"}


# ── Zerodha Token Flow ────────────────────────────────────────────────────────

@router.get("/zerodha/login-url")
async def zerodha_login_url():
    """
    Returns the Zerodha login URL.
    Frontend opens this in a new browser tab.
    After login, Zerodha redirects to:
      http://127.0.0.1?request_token=XXXXX&action=login&status=success
    User copies the request_token and pastes into STAAX.
    """
    from app.brokers.zerodha import ZerodhaBroker
    broker = ZerodhaBroker()
    return {"login_url": broker.get_login_url()}


@router.post("/zerodha/set-token")
async def zerodha_set_token(
    request_token: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Called after user completes Zerodha login.
    Exchanges request_token for access_token and saves to DB.
    """
    from app.brokers.zerodha import ZerodhaBroker
    from app.services.token_refresh import TokenRefreshService
    broker  = ZerodhaBroker()
    service = TokenRefreshService(db, broker)
    await service.complete_zerodha_login(request_token)
    return {"status": "success", "message": "✅ Zerodha connected for today"}


@router.get("/zerodha/token-status")
async def zerodha_token_status(db: AsyncSession = Depends(get_db)):
    """Check if today's Zerodha token is valid."""
    from app.brokers.zerodha import ZerodhaBroker
    from app.services.token_refresh import TokenRefreshService
    broker  = ZerodhaBroker()
    service = TokenRefreshService(db, broker)
    token   = await service.load_zerodha_token_from_db()
    return {
        "connected": token is not None,
        "message": "Connected" if token else "Login required"
    }
EOF

# ─── UPDATE .ENV.EXAMPLE WITH MISSING FIELDS ──────────────────────────────────

cat > .env.example << 'EOF'
# ── App ───────────────────────────────────────────
APP_ENV=development
APP_SECRET_KEY=change-this-to-a-random-secret-key-min-32-chars
APP_PORT=8000

# ── Database ──────────────────────────────────────
DATABASE_URL=postgresql://staax:staax_password@localhost:5432/staax_db

# ── Redis ─────────────────────────────────────────
REDIS_URL=redis://localhost:6379

# ── Zerodha (Karthik account) ─────────────────────
ZERODHA_API_KEY=
ZERODHA_API_SECRET=
ZERODHA_USER_ID=

# ── Angel One (Mom account) ───────────────────────
ANGELONE_MOM_API_KEY=
ANGELONE_MOM_CLIENT_ID=
ANGELONE_MOM_PIN=
ANGELONE_MOM_TOTP_SECRET=

# ── Angel One (Wife account — Phase 2 MCX) ────────
ANGELONE_WIFE_API_KEY=
ANGELONE_WIFE_CLIENT_ID=
ANGELONE_WIFE_PIN=
ANGELONE_WIFE_TOTP_SECRET=

# ── JWT ───────────────────────────────────────────
JWT_SECRET_KEY=change-this-to-another-random-secret-min-32-chars
JWT_ALGORITHM=HS256
JWT_EXPIRE_MINUTES=1440

# ── Notifications ─────────────────────────────────
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
ALERT_WHATSAPP_TO=whatsapp:+91XXXXXXXXXX
ALERT_EMAIL_TO=your@email.com
AWS_SES_REGION=ap-south-1
EOF

# ─── DOCKER-COMPOSE (start DB + Redis locally) ────────────────────────────────

cat > docker-compose.yml << 'EOF'
version: '3.9'

services:
  db:
    image: postgres:16-alpine
    container_name: staax_db
    environment:
      POSTGRES_USER: staax
      POSTGRES_PASSWORD: staax_password
      POSTGRES_DB: staax_db
    ports:
      - "5432:5432"
    volumes:
      - staax_pgdata:/var/lib/postgresql/data
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    container_name: staax_redis
    ports:
      - "6379:6379"
    volumes:
      - staax_redisdata:/data
    restart: unless-stopped

volumes:
  staax_pgdata:
  staax_redisdata:
EOF

echo ""
echo "✅ Phase 1B files created!"
echo ""
echo "Next — start the database and Redis:"
echo "  docker-compose up -d"
echo ""
echo "Then install Python dependencies:"
echo "  cd backend"
echo "  pip3 install -r requirements.txt"
echo ""
echo "Then start the backend:"
echo "  uvicorn main:app --reload"
echo ""
echo "Then commit:"
echo "  cd .."
echo "  git add ."
echo "  git commit -m 'Phase 1B: Zerodha integration + core execution engine'"
echo "  git push origin feature/zerodha-integration"
