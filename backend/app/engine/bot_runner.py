"""
BotRunner — orchestrates all active indicator bots.

Signal pipeline:
  LTP tick → CandleAggregator (per bot) → completed candle
            → Strategy.on_candle()       → Signal
            → save bot_signals            → broadcast WS
            → (future) place order

Each bot gets its own CandleAggregator and strategy instance so state
(prev_close, channel window, DTR daily levels) is isolated per bot.

Order placement is NOT implemented here — signals only.
"""
import json
import logging
import asyncio
from datetime import datetime, timezone, date, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
from typing import Dict, Optional, List, Any

IST = ZoneInfo("Asia/Kolkata")
logger = logging.getLogger(__name__)

# Path to Angel One instrument master (downloaded at broker login time).
_INSTRUMENT_MASTER = Path(__file__).parent.parent.parent / "instrument_master_cache.json"

# Roll to the next contract this many days before the near-month expires.
# E.g. 2 means: on Apr 1, skip Apr 3 expiry and move to May.
_MCX_ROLL_DAYS_BEFORE = 2

# MCX instrument tokens (Angel One SmartStream).
# Auto-updated at startup and 06:00 IST daily by refresh_mcx_tokens().
# Fallback values here are the last known-good tokens; they are overwritten
# immediately on first startup if the instrument master is present.
MCX_TOKENS = {
    "GOLDM":     487819,   # GOLDM05MAY26FUT — updated 2026-04-01 (Apr expired 03APR)
    "SILVERMIC": 466029,   # SILVERMIC30APR26FUT — current until 30APR, then auto-rotates
}

# MCX exchange type for Angel One SmartStream subscription
MCX_EXCHANGE_TYPE = 5   # MCX


class BotRunner:
    def __init__(self):
        self._bots: List         = []
        self._ltp_consumer       = None
        self._order_placer       = None
        self._ws_manager         = None
        self._db_factory         = None
        self._angel_brokers: List = []   # injected for daily OHLC fetch

        # Per-bot state
        self._aggregators: Dict[str, Any] = {}   # bot_id → CandleAggregator
        self._strategies:  Dict[str, Any] = {}   # bot_id → DTRStrategy | ChannelStrategy
        self._positions:   Dict[str, Optional[dict]] = {}  # bot_id → open position
        self._last_signal: Dict[str, str] = {}             # bot_id → last signal type+dir acted on

        logger.info("[BOT] BotRunner initialised")

    # ── Wiring ────────────────────────────────────────────────────────────────

    def wire(self, ltp_consumer, order_placer, ws_manager, db_factory,
             angel_brokers: Optional[List] = None):
        self._ltp_consumer = ltp_consumer
        self._order_placer = order_placer
        self._ws_manager   = ws_manager
        self._db_factory   = db_factory
        self._angel_brokers = angel_brokers or []
        logger.info(f"[BOT] BotRunner wired — {len(self._angel_brokers)} angel brokers")

    # ── Startup ───────────────────────────────────────────────────────────────

    async def refresh_mcx_tokens(self):
        """
        Scan instrument master for nearest active MCX FUTCOM contracts and
        update MCX_TOKENS in-place.

        Called at startup (inside load_bots) and via 06:00 IST cron so tokens
        rotate automatically on contract expiry without a manual deploy.
        """
        if not _INSTRUMENT_MASTER.exists():
            logger.warning("[BOT] refresh_mcx_tokens: instrument master not found at %s", _INSTRUMENT_MASTER)
            return

        try:
            with open(_INSTRUMENT_MASTER) as fh:
                master = json.load(fh)
        except Exception as e:
            logger.error("[BOT] refresh_mcx_tokens: failed to load instrument master: %s", e)
            return

        today = date.today()
        # Roll to next contract if near-month expires within _MCX_ROLL_DAYS_BEFORE days.
        roll_cutoff = today + timedelta(days=_MCX_ROLL_DAYS_BEFORE)
        for symbol in list(MCX_TOKENS.keys()):
            candidates = []
            for row in master:
                if row.get("exch_seg") != "MCX":
                    continue
                if row.get("instrumenttype") != "FUTCOM":
                    continue
                if row.get("name") != symbol:
                    continue
                try:
                    expiry = datetime.strptime(row["expiry"], "%d%b%Y").date()
                except (ValueError, KeyError):
                    continue
                # Skip contracts expiring within the roll window.
                if expiry > roll_cutoff:
                    candidates.append((expiry, int(row["token"]), row["symbol"]))

            if not candidates:
                logger.warning("[BOT] refresh_mcx_tokens: no future contracts found for %s", symbol)
                continue

            candidates.sort()
            new_expiry, new_token, new_sym = candidates[0]
            old_token = MCX_TOKENS[symbol]

            if new_token != old_token:
                MCX_TOKENS[symbol] = new_token
                logger.info(
                    "[BOT] MCX token auto-updated: %s %s → %s (%s, expires %s)",
                    symbol, old_token, new_token, new_sym, new_expiry,
                )
            else:
                logger.info(
                    "[BOT] MCX token current: %s %s (%s, expires %s)",
                    symbol, new_token, new_sym, new_expiry,
                )

    async def load_bots(self):
        """Load all active bots from DB and set up their strategy instances."""
        from app.core.database import AsyncSessionLocal
        from app.models.bot import Bot, BotOrder, BotOrderStatus
        from sqlalchemy import select

        # Refresh tokens from instrument master before subscribing bots.
        await self.refresh_mcx_tokens()

        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Bot).where(Bot.status.in_(["active", "live"]),
                                  Bot.is_archived == False)
            )
            self._bots = list(result.scalars().all())

            # Restore in-memory positions from any OPEN BotOrders.
            # Without this, a server restart wipes _positions → sell signals
            # fire but has_position=False → no exit orders created.
            open_result = await db.execute(
                select(BotOrder).where(BotOrder.status == BotOrderStatus.OPEN)
            )
            for bo in open_result.scalars().all():
                bot_id = str(bo.bot_id)
                self._positions[bot_id] = {
                    "order_id":    str(bo.id),
                    "entry_price": float(bo.entry_price or 0),
                }
                logger.info(
                    "[BOT] Restored open position for bot %s: entry=%.2f",
                    bot_id, bo.entry_price or 0,
                )

        logger.info(f"[BOT] Loaded {len(self._bots)} active bots")
        for bot in self._bots:
            self._init_bot(bot)

    def _init_bot(self, bot):
        """Create CandleAggregator + strategy instance for one bot."""
        from app.engine.candle_fetcher import CandleAggregator
        from app.engine.indicators.dtr_strategy     import DTRStrategy
        from app.engine.indicators.channel_strategy import ChannelStrategy
        from app.models.bot import IndicatorType

        bot_id = str(bot.id)

        # Candle aggregator for this bot's timeframe
        self._aggregators[bot_id] = CandleAggregator(bot.timeframe_mins)

        # Strategy instance
        if bot.indicator == IndicatorType.DTR:
            self._strategies[bot_id] = DTRStrategy(longs_enabled=True, shorts_enabled=False)
        elif bot.indicator == IndicatorType.CHANNEL:
            num = bot.channel_candles or 1
            self._strategies[bot_id] = ChannelStrategy(
                timeframe_mins=bot.timeframe_mins,
                num_candles=num,
                long_only=True,
            )
        else:
            self._strategies[bot_id] = None

        self._positions[bot_id] = None

        # Subscribe instrument to LTP feed
        self._subscribe_bot(bot)

        logger.info(
            f"[BOT] Init bot {bot.name} — "
            f"indicator={bot.indicator} tf={bot.timeframe_mins}m"
        )

    def _subscribe_bot(self, bot):
        """Subscribe bot's instrument to the LTP feed."""
        token = MCX_TOKENS.get(bot.instrument)
        if not token:
            logger.warning(f"[BOT] Unknown MCX token for {bot.instrument} — not subscribed")
            return
        if self._ltp_consumer:
            self._ltp_consumer.subscribe([token])
            logger.info(f"[BOT] Subscribed token {token} for {bot.instrument}")

    # ── Tick processing ───────────────────────────────────────────────────────

    async def on_tick(self, token: int, price: float, ts: datetime):
        """
        Called on every LTP tick. Routes tick to each bot watching this token.
        When a candle completes, passes it to the bot's strategy.
        """
        # ── MCX session + holiday guard ───────────────────────────────────────
        from app.core.mcx_holidays import MCX_HOLIDAYS_2026
        now = datetime.now(IST)
        t = (now.hour, now.minute)
        morning = (9, 0) <= t <= (11, 30)
        evening = (15, 30) <= t <= (23, 30)
        if not (morning or evening):
            logger.debug("MCX session closed — skipping tick")
            return
        if now.date().isoformat() in MCX_HOLIDAYS_2026:
            logger.info("MCX session closed — skipping tick")
            return

        bots_watching = sum(1 for b in self._bots if MCX_TOKENS.get(b.instrument) == token)
        logger.debug(f"[BOT TICK] token={token} price={price:.2f} bots_watching={bots_watching}")

        for bot in self._bots:
            if MCX_TOKENS.get(bot.instrument) != token:
                continue
            bot_id = str(bot.id)
            agg = self._aggregators.get(bot_id)
            if agg is None:
                continue

            completed = agg.on_tick(price, ts)
            if completed:
                await self._on_candle_complete(bot, completed, price)

    async def _on_candle_complete(self, bot, candle, current_price: float):
        """A candle completed — run strategy and handle signal."""
        bot_id   = str(bot.id)
        strategy = self._strategies.get(bot_id)
        if strategy is None:
            return

        signal = strategy.on_candle(candle)
        if signal is None:
            return

        logger.info(
            f"[BOT] Signal from {bot.name}: {signal.direction.upper()} "
            f"{signal.type} @ {signal.price:.2f} ({signal.reason})"
        )

        # ── Order decision (entry / exit) ─────────────────────────────────────
        has_position = self._positions.get(bot_id) is not None
        sig_key      = f"{signal.type}:{signal.direction}"

        acted = False
        if signal.type == "entry" and signal.direction == "buy" and not has_position:
            # Dedup: skip if we already acted on a buy entry this candle run
            if self._last_signal.get(bot_id) != sig_key:
                await self._enter_trade(bot, current_price, signal)
                self._last_signal[bot_id] = sig_key
                acted = True
            else:
                logger.debug("[BOT] Dedup: skipping duplicate %s signal for %s", sig_key, bot.name)
        elif signal.type in ("entry", "exit") and signal.direction == "sell" and has_position:
            if self._last_signal.get(bot_id) != sig_key:
                await self._exit_trade(bot, current_price)
                self._last_signal[bot_id] = sig_key
                acted = True
            else:
                logger.debug("[BOT] Dedup: skipping duplicate %s signal for %s", sig_key, bot.name)
        else:
            # Signal fired but no valid position state to act on (e.g. sell with no position).
            logger.info(
                "[BOT] Signal %s %s for %s — no action (has_position=%s)",
                signal.direction.upper(), signal.type, bot.name, has_position,
            )

        # ── Save to bot_signals (only when acted or new unique condition) ─────
        # "fired" = order action taken; "skipped" = condition met but no position
        signal_status = "fired" if acted else "skipped"
        await self._save_signal(bot, signal, status=signal_status)

        # ── Broadcast to frontend via WebSocket (only if acted) ───────────────
        if acted and self._ws_manager:
            asyncio.ensure_future(self._ws_manager.notify(
                "info",
                f"{bot.name} · {signal.direction.upper()} {signal.type} "
                f"{bot.instrument} @ {signal.price:.2f} ({signal.reason})",
                bot.name,
            ))

    # ── Signal persistence ────────────────────────────────────────────────────

    async def _save_signal(self, bot, signal, status: str = "fired"):
        """Persist signal to bot_signals table.

        status: "fired" = order action taken, "skipped" = condition met but no position.
        """
        try:
            from app.core.database import AsyncSessionLocal
            from app.models.bot import BotSignal
            import uuid as uuid_lib

            async with AsyncSessionLocal() as db:
                sig = BotSignal(
                    id=uuid_lib.uuid4(),
                    bot_id=bot.id,
                    signal_type=signal.type,
                    direction=signal.direction.upper(),
                    instrument=bot.instrument,
                    expiry=bot.expiry,
                    trigger_price=signal.price,
                    status=status,
                    fired_at=datetime.now(timezone.utc),
                    created_at=datetime.now(timezone.utc),
                )
                db.add(sig)
                await db.commit()
                logger.info(f"[BOT] Signal saved ({status}): {signal.reason} {signal.direction}")
        except Exception as e:
            logger.error(f"[BOT] Failed to save signal: {e}")

    # ── Trade entry / exit ────────────────────────────────────────────────────

    async def _enter_trade(self, bot, price: float, signal=None):
        """Record entry order for bot."""
        logger.info(f"[BOT] ENTRY — {bot.name} BUY {bot.lots} lots {bot.instrument} @ ~{price:.2f}")
        logger.info(f"[BOT] Signal-only mode — order NOT placed (observation only)")
        try:
            from app.core.database import AsyncSessionLocal
            from app.models.bot import BotOrder, BotOrderStatus
            import uuid as uuid_lib

            async with AsyncSessionLocal() as db:
                order = BotOrder(
                    id=uuid_lib.uuid4(),
                    bot_id=bot.id,
                    account_id=bot.account_id,
                    instrument=bot.instrument,
                    expiry=bot.expiry,
                    direction="BUY",
                    lots=bot.lots,
                    entry_price=price,
                    entry_time=datetime.now(timezone.utc),
                    status=BotOrderStatus.OPEN,
                    signal_type="entry",
                )
                db.add(order)
                bot.status = "live"
                await db.commit()
                await db.refresh(order)

            self._positions[str(bot.id)] = {
                "order_id":    str(order.id),
                "entry_price": price,
            }
        except Exception as e:
            logger.error(f"[BOT] Entry trade error: {e}")

    async def _exit_trade(self, bot, price: float):
        """Record exit order for bot."""
        position = self._positions.get(str(bot.id))
        if not position:
            return

        logger.info(f"[BOT] EXIT — {bot.name} SELL {bot.lots} lots {bot.instrument} @ ~{price:.2f}")
        try:
            from app.core.database import AsyncSessionLocal
            from app.models.bot import BotOrder, BotOrderStatus
            from sqlalchemy import select
            import uuid as uuid_lib

            pnl = (price - position["entry_price"]) * bot.lots

            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(BotOrder).where(BotOrder.id == uuid_lib.UUID(position["order_id"]))
                )
                order = result.scalar_one_or_none()
                if order:
                    order.exit_price  = price
                    order.exit_time   = datetime.now(timezone.utc)
                    order.pnl         = pnl
                    order.status      = BotOrderStatus.CLOSED
                    order.signal_type = "exit"
                bot.status = "active"
                await db.commit()

            self._positions[str(bot.id)] = None
            sign = "+" if pnl >= 0 else ""
            if self._ws_manager:
                asyncio.ensure_future(self._ws_manager.notify(
                    "success" if pnl >= 0 else "warn",
                    f"{bot.name} · EXIT {bot.instrument} @ {price:.2f} · P&L {sign}₹{pnl:,.0f}",
                    bot.name,
                ))
        except Exception as e:
            logger.error(f"[BOT] Exit trade error: {e}")

    # ── Daily data fetch (DTR) ────────────────────────────────────────────────

    async def fetch_daily_candles(self, symbol: str, broker) -> Optional[dict]:
        """
        Fetch last 2 days of daily candles via Angel One getCandleData API.
        Returns {day_open, prev_high, prev_low, prev_close} or None on failure.

        symbol: MCX symbol string e.g. "GOLDM"
        broker: AngelOneBroker instance with a valid session token
        """
        try:
            # Pass the known MCX token directly — instrument master lookup fails
            # for MCX (exch_seg mismatch or wrong contract picked).
            # MCX_TOKENS always holds the live rolling contract token.
            symbol_token = str(MCX_TOKENS.get(symbol, ""))
            candles = await broker.get_candle_data(
                symbol=symbol,
                exchange="MCX",
                interval="ONE_DAY",
                days_back=3,      # fetch 3 days so we always have prev + today
                symbol_token=symbol_token,
            )
            if not candles or len(candles) < 2:
                logger.warning(f"[BOT] <2 candles with days_back=3 for {symbol} — retrying days_back=5 (holiday?)")
                candles = await broker.get_candle_data(
                    symbol=symbol,
                    exchange="MCX",
                    interval="ONE_DAY",
                    days_back=5,
                    symbol_token=symbol_token,
                )
            if not candles or len(candles) < 2:
                logger.warning(f"[BOT] Not enough daily candles for {symbol}: {candles}")
                return None

            # candles are [timestamp, open, high, low, close, volume] sorted asc
            prev = candles[-2]   # previous completed day
            today = candles[-1]  # today (may be partial — we just need open)

            return {
                "day_open":   float(today[1]),    # today's open
                "prev_high":  float(prev[2]),
                "prev_low":   float(prev[3]),
                "prev_close": float(prev[4]),
            }
        except Exception as e:
            logger.error(f"[BOT] fetch_daily_candles failed for {symbol}: {e}")
            return None

    async def load_daily_data(self):
        """
        Called at 09:00 IST each morning and after AO login.
        Fetches previous day OHLC for all DTR bots and calls set_daily_data().
        Requires at least one Angel One broker with a valid token.
        """
        from app.models.bot import IndicatorType

        broker = next(
            (b for b in self._angel_brokers if b.is_token_set()), None
        )
        if not broker:
            logger.warning("[BOT] load_daily_data: no angel broker with token — DTR levels not set")
            return

        dtr_bots = [b for b in self._bots if b.indicator == IndicatorType.DTR]
        if not dtr_bots:
            logger.warning("[DTR] No DTR bots found — check bot configuration")
            return
        loaded = 0

        for bot in dtr_bots:
            bot_id   = str(bot.id)
            strategy = self._strategies.get(bot_id)
            if strategy is None:
                continue

            data = await self.fetch_daily_candles(bot.instrument, broker)
            if data:
                strategy.set_daily_data(
                    day_open=data["day_open"],
                    prev_high=data["prev_high"],
                    prev_low=data["prev_low"],
                    prev_close=data["prev_close"],
                )
                upper = getattr(strategy, "upper_pivot", None)
                lower = getattr(strategy, "lower_pivot", None)
                logger.info(
                    f"[DTR] Daily data loaded for {bot.name}: "
                    f"open={data['day_open']:.2f}, "
                    f"upper={upper:.2f}, lower={lower:.2f}"
                )
                loaded += 1

        logger.info(f"[DTR] Daily data refreshed for {loaded}/{len(dtr_bots)} bots")

    # ── Rollover ──────────────────────────────────────────────────────────────

    async def check_rollover(self):
        """Check all bots for expiry rollover. Called daily at 09:10."""
        from app.engine.expiry_monitor import needs_rollover, next_expiry
        from app.core.database import AsyncSessionLocal
        from app.models.bot import Bot
        from sqlalchemy import select

        for bot in self._bots:
            if not needs_rollover(bot.expiry):
                continue

            old_expiry = bot.expiry
            new_expiry = next_expiry(bot.expiry)
            logger.info(f"[BOT] ROLLOVER {bot.name}: {old_expiry} → {new_expiry}")

            has_position = self._positions.get(str(bot.id)) is not None
            if has_position:
                # Get latest close price as rollover price
                agg = self._aggregators.get(str(bot.id))
                price = agg.latest.close if (agg and agg.latest) else 0.0
                await self._exit_trade(bot, price)
                bot.expiry = new_expiry
                await self._enter_trade(bot, price)
            else:
                bot.expiry = new_expiry

            async with AsyncSessionLocal() as db:
                result = await db.execute(select(Bot).where(Bot.id == bot.id))
                db_bot = result.scalar_one_or_none()
                if db_bot:
                    db_bot.expiry = new_expiry
                await db.commit()

            if self._ws_manager:
                asyncio.ensure_future(self._ws_manager.notify(
                    "info",
                    f"{bot.name} · Rollover {old_expiry} → {new_expiry}",
                    bot.name,
                ))


bot_runner = BotRunner()
