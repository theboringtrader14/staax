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
import logging
import asyncio
from datetime import datetime, timezone, date, timedelta
from zoneinfo import ZoneInfo
from typing import Dict, Optional, List, Any

IST = ZoneInfo("Asia/Kolkata")
logger = logging.getLogger(__name__)

# MCX instrument tokens (Angel One SmartStream)
# Verify these against the AO instrument master before going live.
MCX_TOKENS = {
    "GOLDM":     58424839,
    "SILVERMIC": 58457095,
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

    async def load_bots(self):
        """Load all active bots from DB and set up their strategy instances."""
        from app.core.database import AsyncSessionLocal
        from app.models.bot import Bot
        from sqlalchemy import select

        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Bot).where(Bot.status.in_(["active", "live"]),
                                  Bot.is_archived == False)
            )
            self._bots = list(result.scalars().all())

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

        # ── Save to bot_signals ───────────────────────────────────────────────
        await self._save_signal(bot, signal)

        # ── Broadcast to frontend via WebSocket ───────────────────────────────
        if self._ws_manager:
            asyncio.ensure_future(self._ws_manager.notify(
                "info",
                f"{bot.name} · {signal.direction.upper()} {signal.type} "
                f"{bot.instrument} @ {signal.price:.2f} ({signal.reason})",
                bot.name,
            ))

        # ── Order decision (entry / exit) ─────────────────────────────────────
        has_position = self._positions.get(bot_id) is not None

        if signal.type == "entry" and signal.direction == "buy" and not has_position:
            await self._enter_trade(bot, current_price, signal)
        elif signal.type in ("entry", "exit") and signal.direction == "sell" and has_position:
            await self._exit_trade(bot, current_price)

    # ── Signal persistence ────────────────────────────────────────────────────

    async def _save_signal(self, bot, signal):
        """Persist signal to bot_signals table."""
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
                    status="fired",
                    fired_at=datetime.now(timezone.utc),
                    created_at=datetime.now(timezone.utc),
                )
                db.add(sig)
                await db.commit()
                logger.info(f"[BOT] Signal saved: {signal.reason} {signal.direction}")
        except Exception as e:
            logger.error(f"[BOT] Failed to save signal: {e}")

    # ── Trade entry / exit ────────────────────────────────────────────────────

    async def _enter_trade(self, bot, price: float, signal=None):
        """Record entry order for bot."""
        logger.info(f"[BOT] ENTRY — {bot.name} BUY {bot.lots} lots {bot.instrument} @ ~{price:.2f}")
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
            candles = await broker.get_candle_data(
                symbol=symbol,
                exchange="MCX",
                interval="ONE_DAY",
                days_back=3,      # fetch 3 days so we always have prev + today
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
        Called at 09:00 IST each morning.
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

        for bot in self._bots:
            if bot.indicator != IndicatorType.DTR:
                continue

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
                logger.info(
                    f"[BOT] DTR daily data loaded for {bot.name}: "
                    f"open={data['day_open']:.2f} "
                    f"prev_H={data['prev_high']:.2f} prev_L={data['prev_low']:.2f}"
                )

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
