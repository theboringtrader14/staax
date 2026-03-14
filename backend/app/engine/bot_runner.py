"""
BotRunner — orchestrates all active bots.
- Subscribes to LTP feed for bot instruments
- On each tick: updates candle aggregators
- On each completed candle: computes indicator signal
- On BUY signal + no open position: place entry order
- On SELL signal + open position: place exit order
- Runs expiry rollover check daily
"""
import logging
import asyncio
from datetime import datetime, timezone, date
from zoneinfo import ZoneInfo
from typing import Dict, Optional, List

IST = ZoneInfo("Asia/Kolkata")
logger = logging.getLogger(__name__)

# MCX instrument tokens (approximate — verify against Zerodha instrument dump)
MCX_TOKENS = {
    "GOLDM":    58424839,
    "SILVERMIC": 58457095,
}

# Account for MCX (default: Wife's Angel One account)
MCX_DEFAULT_ACCOUNT = "8995745a-fbd5-4ca5-80cf-461e72e9fd0a"


class BotRunner:
    def __init__(self):
        self._bots: List = []
        self._ltp_consumer = None
        self._order_placer = None
        self._ws_manager   = None
        self._db_factory   = None
        self._candle_store = None
        self._bot_positions: Dict[str, Optional[dict]] = {}  # bot_id → open position
        logger.info("[BOT] BotRunner initialised")

    def wire(self, ltp_consumer, order_placer, ws_manager, db_factory):
        self._ltp_consumer = ltp_consumer
        self._order_placer = order_placer
        self._ws_manager   = ws_manager
        self._db_factory   = db_factory
        from app.engine.candle_fetcher import candle_store
        self._candle_store = candle_store
        logger.info("[BOT] BotRunner wired")

    async def load_bots(self):
        """Load all active bots from DB and subscribe to their instruments."""
        from app.core.database import AsyncSessionLocal
        from app.models.bot import Bot, BotStatus
        from sqlalchemy import select
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Bot).where(Bot.status.in_(["active", "live"]))
            )
            self._bots = result.scalars().all()

        logger.info(f"[BOT] Loaded {len(self._bots)} active bots")
        for bot in self._bots:
            self._subscribe_bot(bot)

    def _subscribe_bot(self, bot):
        """Subscribe to LTP feed for this bot's instrument."""
        token = MCX_TOKENS.get(bot.instrument)
        if token and self._ltp_consumer:
            self._ltp_consumer.subscribe([token])
            # Register candle aggregator
            self._candle_store.get_or_create(token, bot.timeframe_mins)
            logger.info(f"[BOT] Subscribed {bot.instrument} ({bot.timeframe_mins}m) for bot {bot.name}")

    async def on_tick(self, token: int, price: float, ts: datetime):
        """Called on every LTP tick. Check if any candle completed and compute signals."""
        if not self._candle_store:
            return
        for bot in self._bots:
            bot_token = MCX_TOKENS.get(bot.instrument)
            if bot_token != token:
                continue
            agg = self._candle_store.get_or_create(token, bot.timeframe_mins)
            completed = agg.on_tick(price, ts)
            if completed:
                await self._process_signal(bot, agg, price)

    async def _process_signal(self, bot, agg, current_price: float):
        """Compute signal and act on it."""
        from app.models.bot import IndicatorType
        from app.engine.indicator_engine import (
            compute_dtr_signal, compute_channel_signal, compute_tt_bands_signal
        )

        signal = "HOLD"

        if bot.indicator == IndicatorType.DTR:
            # Need daily OHLC — fetch from cache
            daily_open, prev_high, prev_low = await self._get_daily_ohlc(bot.instrument)
            if daily_open:
                signal = compute_dtr_signal(agg, daily_open, prev_high, prev_low)

        elif bot.indicator == IndicatorType.CHANNEL:
            num = bot.channel_candles or 1
            signal = compute_channel_signal(agg, num)

        elif bot.indicator == IndicatorType.TT_BANDS:
            lb = bot.tt_lookback or 5
            signal = compute_tt_bands_signal(agg, lb)

        if signal == "HOLD":
            return

        bot_id = str(bot.id)
        has_position = self._bot_positions.get(bot_id) is not None

        if signal == "BUY" and not has_position:
            await self._enter_trade(bot, current_price)
        elif signal == "SELL" and has_position:
            await self._exit_trade(bot, current_price)

    async def _enter_trade(self, bot, price: float):
        """Place entry order for bot."""
        logger.info(f"[BOT] ENTRY — {bot.name} BUY {bot.lots} lots {bot.instrument} @ ~{price:.2f}")
        from app.core.database import AsyncSessionLocal
        from app.models.bot import BotOrder, BotOrderStatus, BotStatus
        from datetime import datetime, timezone

        async with AsyncSessionLocal() as db:
            order = BotOrder(
                bot_id=bot.id, account_id=bot.account_id,
                instrument=bot.instrument, expiry=bot.expiry,
                direction="BUY", lots=bot.lots,
                entry_price=price, entry_time=datetime.now(timezone.utc),
                status=BotOrderStatus.OPEN, signal_type="entry",
            )
            db.add(order)
            # Update bot status to LIVE
            bot.status = "live"
            await db.commit()
            await db.refresh(order)

        self._bot_positions[str(bot.id)] = {"order_id": str(order.id), "entry_price": price}

        if self._ws_manager:
            await self._ws_manager.notify("success", f"{bot.name} · BUY entry {bot.instrument} @ {price:.2f}", bot.name)

    async def _exit_trade(self, bot, price: float):
        """Place exit order for bot."""
        position = self._bot_positions.get(str(bot.id))
        if not position:
            return

        logger.info(f"[BOT] EXIT — {bot.name} SELL {bot.lots} lots {bot.instrument} @ ~{price:.2f}")
        from app.core.database import AsyncSessionLocal
        from app.models.bot import BotOrder, BotOrderStatus, BotStatus
        from sqlalchemy import select

        pnl = (price - position["entry_price"]) * bot.lots

        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(BotOrder).where(BotOrder.id == position["order_id"])
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

        self._bot_positions[str(bot.id)] = None
        sign = "+" if pnl >= 0 else ""
        if self._ws_manager:
            await self._ws_manager.notify(
                "success" if pnl >= 0 else "warn",
                f"{bot.name} · EXIT {bot.instrument} @ {price:.2f} · P&L {sign}₹{pnl:,.0f}", bot.name
            )

    async def _get_daily_ohlc(self, instrument: str):
        """Get daily open, prev_high, prev_low from LTP cache or fallback."""
        # TODO: implement daily OHLC from historical data
        # For now return None — DTR needs daily data
        return None, None, None

    async def check_rollover(self):
        """Check all bots for expiry rollover. Called daily at 09:10."""
        from app.engine.expiry_monitor import needs_rollover, next_expiry
        from app.core.database import AsyncSessionLocal
        from app.models.bot import BotStatus

        for bot in self._bots:
            if needs_rollover(bot.expiry):
                old_expiry = bot.expiry
                new_expiry = next_expiry(bot.expiry)
                logger.info(f"[BOT] ROLLOVER {bot.name}: {old_expiry} → {new_expiry}")

                # If position open: exit current, enter next
                has_position = self._bot_positions.get(str(bot.id)) is not None
                if has_position:
                    # Get current LTP
                    from app.engine.candle_fetcher import candle_store, MCX_TOKENS
                    token = MCX_TOKENS.get(bot.instrument)
                    agg = candle_store.get_or_create(token, bot.timeframe_mins) if token else None
                    price = agg.latest.close if agg and agg.latest else 0.0
                    await self._exit_trade(bot, price)
                    bot.expiry = new_expiry
                    await self._enter_trade(bot, price)
                else:
                    bot.expiry = new_expiry

                async with AsyncSessionLocal() as db:
                    from sqlalchemy import select
                    from app.models.bot import Bot
                    result = await db.execute(select(Bot).where(Bot.id == bot.id))
                    db_bot = result.scalar_one_or_none()
                    if db_bot:
                        db_bot.expiry = new_expiry
                    await db.commit()

                if self._ws_manager:
                    await self._ws_manager.notify(
                        "info",
                        f"{bot.name} · Rollover {old_expiry} → {new_expiry}",
                        bot.name
                    )


bot_runner = BotRunner()
