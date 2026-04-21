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
        self._aggregators:         Dict[str, Any] = {}   # bot_id → CandleAggregator (entry TF)
        self._channel_aggregators: Dict[str, Any] = {}   # bot_id → CandleAggregator (channel TF, if different)
        self._strategies:  Dict[str, Any] = {}           # bot_id → DTRStrategy | ChannelStrategy
        self._positions:   Dict[str, Optional[dict]] = {}  # bot_id → open position
        self._last_signal: Dict[str, str] = {}             # bot_id → last signal type+dir acted on
        self._in_session:  bool = False                     # tracks MCX session ON/OFF for transition detection

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
                # Skip positions with no entry_price to avoid corrupt P&L calculations
                if not bo.entry_price:
                    logger.error(
                        "[BOT] Position %s for bot %s has no entry_price — skipping restore to avoid corrupt P&L",
                        bo.id, bo.bot_id
                    )
                    continue
                # entry_price is valid
                entry_price_val = float(bo.entry_price)
                self._positions[bot_id] = {
                    "order_id":    str(bo.id),
                    "entry_price": entry_price_val,
                }
                logger.info(
                    "[BOT] Restored open position for bot %s: entry=%.2f",
                    bot_id, entry_price_val,
                )

        logger.info(f"[BOT] Loaded {len(self._bots)} active bots")
        for bot in self._bots:
            self._init_bot(bot)

        # Seed dedup dict from DB so restarts don't replay last session's signals
        try:
            from app.core.database import AsyncSessionLocal
            from app.models.bot import BotSignal
            from sqlalchemy import select as _sel, func as _func

            async with AsyncSessionLocal() as _db:
                # Latest signal per bot_id
                sub = (
                    _sel(
                        BotSignal.bot_id,
                        _func.max(BotSignal.created_at).label("max_created"),
                    )
                    .where(BotSignal.status == "fired")
                    .group_by(BotSignal.bot_id)
                    .subquery()
                )
                rows_result = await _db.execute(
                    _sel(BotSignal).join(
                        sub,
                        (BotSignal.bot_id == sub.c.bot_id)
                        & (BotSignal.created_at == sub.c.max_created),
                    )
                )
                rows = rows_result.scalars().all()
                for row in rows:
                    self._last_signal[str(row.bot_id)] = f"{row.signal_type}:{row.direction.lower()}"
                logger.info(f"[BOT] Seeded _last_signal for {len(rows)} bot(s) from DB")

                # FIX: if a bot has an open position, force _last_signal to "entry:buy"
                # so subsequent exit signals are never deduped against a prior exit
                for bot_id, pos in self._positions.items():
                    if pos is not None and self._last_signal.get(bot_id) == "exit:sell":
                        self._last_signal[bot_id] = "entry:buy"
                        logger.info(f"[BOT] Corrected _last_signal for bot {bot_id}: open position but last signal was exit:sell → reset to entry:buy")
        except Exception as _e:
            logger.warning(f"[BOT] Could not seed _last_signal from DB: {_e}")

        # Load DTR daily data at startup so DTR bots have levels immediately.
        await self.load_daily_data()

        # Pre-load historical intraday candles for Channel and TT Bands bots.
        await self._warmup_strategies()

    def _init_bot(self, bot):
        """Create CandleAggregator + strategy instance for one bot."""
        from app.engine.candle_fetcher import CandleAggregator
        from app.engine.indicators.dtr_strategy      import DTRStrategy
        from app.engine.indicators.channel_strategy  import ChannelStrategy
        from app.engine.indicators.tt_bands_strategy import TTBandsStrategy
        from app.models.bot import IndicatorType

        bot_id = str(bot.id)

        # Candle aggregator for this bot's entry timeframe
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
            # Separate channel aggregator when channel_tf differs from entry timeframe
            try:
                channel_tf_mins = int(bot.channel_tf) if bot.channel_tf else None
            except (ValueError, TypeError):
                channel_tf_mins = None
            if channel_tf_mins and channel_tf_mins != bot.timeframe_mins:
                self._channel_aggregators[bot_id] = CandleAggregator(channel_tf_mins)
                logger.info(
                    f"[BOT] Channel aggregator: entry={bot.timeframe_mins}m "
                    f"channel={channel_tf_mins}m × {num} candles for {bot.name}"
                )
        elif bot.indicator == IndicatorType.TT_BANDS:
            lookback = bot.tt_lookback or 5
            self._strategies[bot_id] = TTBandsStrategy(
                timeframe_mins=bot.timeframe_mins,
                lookback=lookback,
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

    def stop_bot(self, bot_id: str) -> None:
        """Remove bot from in-memory state and unsubscribe its LTP token if no other bot needs it."""
        bot = next((b for b in self._bots if str(b.id) == bot_id), None)
        if bot:
            token = MCX_TOKENS.get(bot.instrument)
            # Only unsubscribe if no other active bot watches the same instrument
            other_watchers = [
                b for b in self._bots
                if str(b.id) != bot_id and MCX_TOKENS.get(b.instrument) == token
            ]
            if not other_watchers and token and self._ltp_consumer:
                try:
                    self._ltp_consumer.unsubscribe([token])
                    logger.info(f"[BOT] Unsubscribed token {token} for {bot.instrument}")
                except Exception as e:
                    logger.warning(f"[BOT] Failed to unsubscribe token {token}: {e}")

        self._bots = [b for b in self._bots if str(b.id) != bot_id]
        for d in (self._aggregators, self._channel_aggregators, self._strategies, self._positions):
            d.pop(bot_id, None)
        self._last_signal.pop(bot_id, None)
        logger.info(f"[BOT] Bot {bot_id} stopped and removed from runner")

    # ── Tick processing ───────────────────────────────────────────────────────

    async def on_tick(self, token: int, price: float, ts: datetime):
        """
        Called on every LTP tick. Routes tick to each bot watching this token.
        When a candle completes, passes it to the bot's strategy.
        """
        # ── MCX session + holiday guard ───────────────────────────────────────
        from app.core.mcx_holidays import MCX_HOLIDAYS_2026
        from app.engine.candle_fetcher import CandleAggregator
        now = datetime.now(IST)
        t = (now.hour, now.minute)
        morning = (9, 0) <= t <= (11, 30)
        evening = (15, 30) <= t <= (23, 30)
        now_in_session = (morning or evening) and now.date().isoformat() not in MCX_HOLIDAYS_2026

        # Session OFF→ON transition: reset aggregators to discard stale cross-session candles
        if now_in_session and not self._in_session:
            logger.info("[BOT] MCX session started — resetting candle aggregators to discard stale data")
            for bot in self._bots:
                bid = str(bot.id)
                self._aggregators[bid] = CandleAggregator(bot.timeframe_mins)
                if bid in self._channel_aggregators:
                    try:
                        channel_tf_mins = int(bot.channel_tf) if bot.channel_tf else bot.timeframe_mins
                    except (ValueError, TypeError):
                        channel_tf_mins = bot.timeframe_mins
                    self._channel_aggregators[bid] = CandleAggregator(channel_tf_mins)
                # Reset TT Bands fractal state so overnight fractals don't contaminate the new session
                strat = self._strategies.get(bid)
                if strat is not None and hasattr(strat, 'reset_session'):
                    strat.reset_session()

        self._in_session = now_in_session

        if not now_in_session:
            logger.debug("MCX session closed — skipping tick")
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

            # Also feed tick to channel aggregator (if separate channel TF)
            ch_agg = self._channel_aggregators.get(bot_id)
            if ch_agg is not None:
                ch_agg.on_tick(price, ts)

            completed = agg.on_tick(price, ts)
            if completed:
                await self._on_candle_complete(bot, completed, price)

    async def _on_candle_complete(self, bot, candle, current_price: float):
        """A candle completed — run strategy and handle signal."""
        bot_id   = str(bot.id)
        strategy = self._strategies.get(bot_id)
        if strategy is None:
            return

        # Pass channel candles from higher-TF aggregator if available
        ch_agg   = self._channel_aggregators.get(bot_id)
        ch_candles = ch_agg.candles if ch_agg is not None else None
        signal = strategy.on_candle(candle, channel_candles=ch_candles)
        if signal is None:
            return

        logger.info(
            f"[BOT] Signal from {bot.name}: {signal.direction.upper()} "
            f"{signal.type} @ {signal.price:.2f} ({signal.reason})"
        )

        # ── Order decision (entry / exit) ─────────────────────────────────────
        has_position = self._positions.get(bot_id) is not None
        # Include candle timestamp in dedup key so re-entry on a new candle is not suppressed
        _candle_ts = candle.ts.isoformat() if hasattr(candle, 'ts') and candle.ts else str(getattr(candle, 'close_time', ''))
        sig_key      = f"{signal.type}:{signal.direction}:{_candle_ts}"

        acted = False
        if signal.type == "entry" and signal.direction == "buy" and not has_position:
            # Dedup: skip if we already acted on a buy entry this candle run
            if self._last_signal.get(bot_id) != sig_key:
                try:
                    await self._enter_trade(bot, current_price, signal)
                    self._last_signal[bot_id] = sig_key
                    # Only mark signal as fired if order placement succeeded
                    await self._save_signal(bot, signal, status="fired", candle=candle)
                    acted = True
                except Exception as e:
                    logger.error(
                        "[BOT] Order placement failed for bot %s: %s — signal will NOT be marked fired",
                        bot.name, e,
                    )
                    await self._save_signal(bot, signal, status="error", candle=candle)
            else:
                logger.debug("[BOT] Dedup: skipping duplicate %s signal for %s", sig_key, bot.name)
        elif signal.type in ("entry", "exit") and signal.direction == "sell" and has_position:
            if self._last_signal.get(bot_id) != sig_key:
                try:
                    await self._exit_trade(bot, current_price)
                    self._last_signal[bot_id] = sig_key
                    # Only mark signal as fired if order placement succeeded
                    await self._save_signal(bot, signal, status="fired", candle=candle)
                    acted = True
                except Exception as e:
                    logger.error(
                        "[BOT] Order placement failed for bot %s: %s — signal will NOT be marked fired",
                        bot.name, e,
                    )
                    await self._save_signal(bot, signal, status="error", candle=candle)
            else:
                logger.debug("[BOT] Dedup: skipping duplicate %s signal for %s", sig_key, bot.name)
        else:
            # Signal fired but no valid position state to act on (e.g. sell with no position).
            logger.info(
                "[BOT] Signal %s %s for %s — no action (has_position=%s)",
                signal.direction.upper(), signal.type, bot.name, has_position,
            )
            await self._save_signal(bot, signal, status="skipped", candle=candle)

        # ── Broadcast to frontend via WebSocket (only if acted) ───────────────
        if acted and self._ws_manager:
            asyncio.ensure_future(self._ws_manager.notify(
                "info",
                f"{bot.name} · {signal.direction.upper()} {signal.type} "
                f"{bot.instrument} @ {signal.price:.2f} ({signal.reason})",
                bot.name,
            ))

    # ── Signal persistence ────────────────────────────────────────────────────

    async def _save_signal(self, bot, signal, status: str = "fired", candle=None):
        """Persist signal to bot_signals table with dedup by (bot_id, signal_type, direction, candle_timestamp)."""
        try:
            from app.core.database import AsyncSessionLocal
            from app.models.bot import BotSignal
            from sqlalchemy import select as _select
            import uuid as uuid_lib

            candle_ts = getattr(candle, "timestamp", None) or getattr(candle, "close_time", None)

            async with AsyncSessionLocal() as db:
                # DB-level dedup: skip if identical signal for this candle already exists
                if candle_ts is not None:
                    existing_result = await db.execute(
                        _select(BotSignal).where(
                            BotSignal.bot_id == bot.id,
                            BotSignal.signal_type == signal.type,
                            BotSignal.direction == signal.direction.upper(),
                            BotSignal.candle_timestamp == candle_ts,
                        ).limit(1)
                    )
                    if existing_result.scalar_one_or_none():
                        logger.debug(f"[BOT] Dedup: signal for candle {candle_ts} already in DB — skipping")
                        return

                sig = BotSignal(
                    id=uuid_lib.uuid4(),
                    bot_id=bot.id,
                    signal_type=signal.type,
                    direction=signal.direction.upper(),
                    instrument=bot.instrument,
                    expiry=bot.expiry,
                    trigger_price=signal.price,
                    reason=getattr(signal, "reason", None),
                    status=status,
                    fired_at=datetime.now(timezone.utc),
                    candle_timestamp=candle_ts,
                    created_at=datetime.now(timezone.utc),
                )
                db.add(sig)
                await db.commit()
                logger.info(f"[BOT] Signal saved ({status}): {signal.reason} {signal.direction}")
        except Exception as e:
            logger.error(f"[BOT] Failed to save signal: {e}")

    # ── Trade entry / exit ────────────────────────────────────────────────────

    async def _enter_trade(self, bot, price: float, signal=None):
        """Record entry order for bot. Places real order if not is_practix."""
        import uuid as uuid_lib
        logger.info(f"[BOT] ENTRY — {bot.name} BUY {bot.lots} lots {bot.instrument} @ ~{price:.2f}")

        broker_order_id: Optional[str] = None

        # LIVE mode: place order via order_placer
        if not bot.is_practix and self._order_placer:
            try:
                token = MCX_TOKENS.get(bot.instrument)
                ikey = f"bot_{bot.id}_entry_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}"
                broker_order_id = await self._order_placer.place(
                    idempotency_key = ikey,
                    algo_id         = str(bot.id),
                    symbol          = bot.instrument,
                    exchange        = "MCX",
                    direction       = "BUY",
                    quantity        = bot.lots,
                    order_type      = "MARKET",
                    ltp             = price,
                    is_practix      = False,
                    broker_type     = "angelone",
                    symbol_token    = str(token) if token else "",
                    account_id      = str(bot.account_id) if bot.account_id else "",
                )
                logger.info(f"[BOT] LIVE order placed — broker_order_id={broker_order_id}")
            except Exception as e:
                logger.error(f"[BOT] LIVE order placement failed: {e}")
        else:
            logger.info(f"[BOT] PRACTIX / signal-only mode — order NOT placed")

        try:
            from app.core.database import AsyncSessionLocal
            from app.models.bot import BotOrder, BotOrderStatus

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
                    broker_order_id=broker_order_id,
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
        """Record exit order for bot. Places real close order if not is_practix."""
        position = self._positions.get(str(bot.id))
        if not position:
            return

        logger.info(f"[BOT] EXIT — {bot.name} SELL {bot.lots} lots {bot.instrument} @ ~{price:.2f}")

        # LIVE mode: place closing order via order_placer
        if not bot.is_practix and self._order_placer:
            try:
                token = MCX_TOKENS.get(bot.instrument)
                ikey = f"bot_{bot.id}_exit_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}"
                exit_order_id = await self._order_placer.place(
                    idempotency_key = ikey,
                    algo_id         = str(bot.id),
                    symbol          = bot.instrument,
                    exchange        = "MCX",
                    direction       = "SELL",
                    quantity        = bot.lots,
                    order_type      = "MARKET",
                    ltp             = price,
                    is_practix      = False,
                    broker_type     = "angelone",
                    symbol_token    = str(token) if token else "",
                    account_id      = str(bot.account_id) if bot.account_id else "",
                )
                logger.info(f"[BOT] LIVE exit order placed — broker_order_id={exit_order_id}")
            except Exception as e:
                logger.error(f"[BOT] LIVE exit order placement failed: {e}")

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
            else:
                # Mark strategy as failed so on_candle() logs warnings instead of silently returning None
                if hasattr(strategy, 'mark_data_failed'):
                    strategy.mark_data_failed(str(bot.id))
                # Schedule retry in 5 minutes
                asyncio.create_task(self._retry_daily_data(str(bot.id), delay=300))

        logger.info(f"[DTR] Daily data refreshed for {loaded}/{len(dtr_bots)} bots")

    async def _retry_daily_data(self, bot_id: str, delay: int = 300) -> None:
        """Retry load_daily_data for a single bot after delay seconds. Doubles delay up to 30min cap."""
        await asyncio.sleep(delay)
        logger.info("[DTR] Retrying daily data load for bot %s (delay was %ds)", bot_id, delay)
        from app.models.bot import IndicatorType

        broker = next(
            (b for b in self._angel_brokers if b.is_token_set()), None
        )
        if not broker:
            logger.warning("[DTR] _retry_daily_data: no angel broker with token — skipping retry for bot %s", bot_id)
            next_delay = min(delay * 2, 1800)
            asyncio.create_task(self._retry_daily_data(bot_id, delay=next_delay))
            return

        bot = next((b for b in self._bots if str(b.id) == bot_id), None)
        if not bot:
            logger.warning("[DTR] _retry_daily_data: bot %s not found in _bots — stopping retry", bot_id)
            return

        try:
            data = await self.fetch_daily_candles(bot.instrument, broker)
            if data:
                strategy = self._strategies.get(bot_id)
                if strategy:
                    strategy.set_daily_data(
                        day_open=data["day_open"],
                        prev_high=data["prev_high"],
                        prev_low=data["prev_low"],
                        prev_close=data["prev_close"],
                    )
                    logger.info("[DTR] Retry successful for bot %s", bot_id)
            else:
                logger.error("[DTR] Retry failed for bot %s: no data returned", bot_id)
                next_delay = min(delay * 2, 1800)  # cap at 30 minutes
                asyncio.create_task(self._retry_daily_data(bot_id, delay=next_delay))
        except Exception as e:
            logger.error("[DTR] Retry failed for bot %s: %s", bot_id, e)
            next_delay = min(delay * 2, 1800)  # cap at 30 minutes
            asyncio.create_task(self._retry_daily_data(bot_id, delay=next_delay))

    # ── Historical warmup (Channel / TT Bands) ────────────────────────────────

    async def _warmup_strategies(self) -> None:
        """
        Pre-load historical intraday candles for Channel and TT Bands bots so
        they can compute levels immediately instead of waiting for live bars.

        DTR has its own daily data loader — skipped here.
        Called once from load_bots() after _init_bot() for all bots.
        """
        from app.models.bot import IndicatorType
        from app.engine.candle_fetcher import Candle as _Candle

        broker = next((b for b in self._angel_brokers if b.is_token_set()), None)
        if not broker:
            logger.warning("[BOT] _warmup_strategies: no Angel broker with token — Channel/TT Bands cold-start")
            return

        _INTERVAL_MAP = {
            1:    "ONE_MINUTE",
            3:    "THREE_MINUTE",
            5:    "FIVE_MINUTE",
            10:   "TEN_MINUTE",
            15:   "FIFTEEN_MINUTE",
            30:   "THIRTY_MINUTE",
            60:   "ONE_HOUR",
            180:  "THREE_HOUR",
            1440: "ONE_DAY",
        }
        _avail = sorted(_INTERVAL_MAP)

        def _closest(tf: int) -> str:
            return _INTERVAL_MAP[min(_avail, key=lambda x: abs(x - tf))]

        def _parse_candles(raw: list) -> list:
            """Convert Angel One raw rows → Candle objects."""
            out = []
            for row in (raw or []):
                try:
                    ts_raw = row[0]
                    if isinstance(ts_raw, str):
                        ts = datetime.fromisoformat(ts_raw[:19])
                        if ts.tzinfo is None:
                            ts = ts.replace(tzinfo=IST)
                    elif isinstance(ts_raw, (int, float)):
                        ts = datetime.fromtimestamp(ts_raw, tz=IST)
                    else:
                        ts = ts_raw
                    out.append(_Candle(
                        open_=float(row[1]), high=float(row[2]),
                        low=float(row[3]),   close=float(row[4]),
                        ts=ts, is_complete=True,
                    ))
                except Exception as _e:
                    logger.debug("[BOT] warmup: skipping malformed candle row: %s", _e)
            return out

        async def _fetch(symbol: str, token_str: str, tf: int, days: int) -> list:
            now_ist = datetime.now(IST)
            from_dt = (now_ist - timedelta(days=days)).strftime("%Y-%m-%d %H:%M")
            to_dt   = now_ist.strftime("%Y-%m-%d %H:%M")
            interval = _closest(tf)
            if interval != _INTERVAL_MAP.get(tf):
                logger.warning("[BOT] No exact AO interval for %dmin — using %s", tf, interval)
            return await broker.get_candle_data(
                symbol=symbol, exchange="MCX", interval=interval,
                symbol_token=token_str, from_dt=from_dt, to_dt=to_dt,
            )

        for bot in self._bots:
            if bot.indicator == IndicatorType.DTR:
                continue

            bot_id       = str(bot.id)
            strategy     = self._strategies.get(bot_id)
            if strategy is None:
                continue

            tf_mins      = bot.timeframe_mins or 60
            symbol_token = str(MCX_TOKENS.get(bot.instrument, ""))
            indicator    = str(bot.indicator or "").lower()

            if "channel" in indicator:
                bars_needed = (bot.channel_candles or 1) + 5
            elif "tt" in indicator:
                bars_needed = (bot.tt_lookback or 5) + 10
            else:
                bars_needed = 20

            # Estimate days of history needed (MCX ≈ 14 tradeable hours per day)
            candles_per_day = max(1, (14 * 60) // tf_mins)
            days_needed = min(max(3, bars_needed // candles_per_day + 2), 10)

            try:
                # ── 1. Seed channel aggregator when TF differs ─────────────────
                ch_agg = self._channel_aggregators.get(bot_id)
                if ch_agg is not None:
                    try:
                        ch_tf = int(bot.channel_tf)
                    except (TypeError, ValueError):
                        ch_tf = tf_mins
                    if ch_tf != tf_mins:
                        raw_ch = await _fetch(bot.instrument, symbol_token, ch_tf, days_needed)
                        ch_parsed = _parse_candles(raw_ch)
                        feed_ch = ch_parsed[:-1] if len(ch_parsed) > 1 else ch_parsed
                        for c in feed_ch:
                            ch_agg._bars.append(c)
                        logger.info("[BOT] %s: channel agg seeded with %d %dmin candles",
                                    bot.name, len(ch_agg._bars), ch_tf)

                # ── 2. Fetch entry-TF historical candles ───────────────────────
                raw = await _fetch(bot.instrument, symbol_token, tf_mins, days_needed)
                parsed = _parse_candles(raw)
                if not parsed:
                    logger.warning("[BOT] %s: no historical candles returned — cold start", bot.name)
                    continue

                # Exclude the last bar (may still be forming)
                feed = parsed[:-1] if len(parsed) > 1 else parsed

                # ── 3. Seed main aggregator (powers /candles endpoint) ─────────
                agg = self._aggregators.get(bot_id)
                if agg is not None:
                    for c in feed:
                        agg._bars.append(c)

                # ── 4. Feed candles into strategy (warmup — signals discarded) ─
                discarded = 0
                for c in feed:
                    try:
                        if "channel" in indicator:
                            ch_live = self._channel_aggregators[bot_id].candles \
                                if bot_id in self._channel_aggregators else None
                            sig = strategy.on_candle(c, channel_candles=ch_live)
                        else:
                            sig = strategy.on_candle(c)
                        if sig is not None:
                            discarded += 1
                    except Exception as _e:
                        logger.debug("[BOT] %s: warmup candle error: %s", bot.name, _e)

                logger.info(
                    "[BOT] %s: warmup complete — %d historical %dmin candles, "
                    "%d warmup signals discarded — strategy ready",
                    bot.name, len(feed), tf_mins, discarded,
                )

            except Exception as e:
                logger.error("[BOT] %s: warmup failed: %s", bot.name, e, exc_info=True)

    async def _warmup_single_bot(self, bot_id: str) -> dict:
        """
        Run warmup for a single bot by ID.
        Extracts the single-bot logic from _warmup_strategies for on-demand use.
        Returns a dict with status, candle_count, etc.
        """
        from app.models.bot import IndicatorType
        from app.engine.candle_fetcher import Candle as _Candle

        bot = next((b for b in self._bots if str(b.id) == bot_id), None)
        if not bot:
            return {"status": "error", "message": f"Bot {bot_id} not found in runner"}

        if str(bot.indicator) == IndicatorType.DTR:
            return {"status": "skipped", "message": "DTR bots use load_daily_data(), not candle warmup"}

        broker = next((b for b in self._angel_brokers if b.is_token_set()), None)
        if not broker:
            return {"status": "error", "message": "No Angel One broker with valid token"}

        _INTERVAL_MAP = {
            1: "ONE_MINUTE", 3: "THREE_MINUTE", 5: "FIVE_MINUTE",
            10: "TEN_MINUTE", 15: "FIFTEEN_MINUTE", 30: "THIRTY_MINUTE",
            60: "ONE_HOUR", 180: "THREE_HOUR", 1440: "ONE_DAY",
        }
        _avail = sorted(_INTERVAL_MAP)

        def _closest(tf: int) -> str:
            return _INTERVAL_MAP[min(_avail, key=lambda x: abs(x - tf))]

        def _parse_candles(raw: list) -> list:
            out = []
            for row in (raw or []):
                try:
                    ts_raw = row[0]
                    if isinstance(ts_raw, str):
                        ts = datetime.fromisoformat(ts_raw[:19])
                        if ts.tzinfo is None:
                            ts = ts.replace(tzinfo=IST)
                    elif isinstance(ts_raw, (int, float)):
                        ts = datetime.fromtimestamp(ts_raw, tz=IST)
                    else:
                        ts = ts_raw
                    out.append(_Candle(
                        open_=float(row[1]), high=float(row[2]),
                        low=float(row[3]),   close=float(row[4]),
                        ts=ts, is_complete=True,
                    ))
                except Exception as _e:
                    logger.debug("[BOT] warmup: skipping malformed row: %s", _e)
            return out

        strategy = self._strategies.get(bot_id)
        if strategy is None:
            return {"status": "error", "message": "No strategy instance for this bot"}

        tf_mins      = bot.timeframe_mins or 60
        symbol_token = str(MCX_TOKENS.get(bot.instrument, ""))
        indicator    = str(bot.indicator or "").lower()

        if "channel" in indicator:
            bars_needed = (bot.channel_candles or 1) + 5
        elif "tt" in indicator:
            bars_needed = (bot.tt_lookback or 5) + 10
        else:
            bars_needed = 20

        candles_per_day = max(1, (14 * 60) // tf_mins)
        days_needed = min(max(3, bars_needed // candles_per_day + 2), 10)

        now_ist = datetime.now(IST)
        from_dt = (now_ist - timedelta(days=days_needed)).strftime("%Y-%m-%d %H:%M")
        to_dt   = now_ist.strftime("%Y-%m-%d %H:%M")
        interval = _closest(tf_mins)

        logger.info("[WARMUP] %s: fetching %d × %dmin candles (interval=%s, from=%s)",
                    bot.name, bars_needed, tf_mins, interval, from_dt)

        try:
            raw = await broker.get_candle_data(
                symbol=bot.instrument, exchange="MCX", interval=interval,
                symbol_token=symbol_token, from_dt=from_dt, to_dt=to_dt,
            )
            logger.info("[WARMUP] %s: got %d raw rows from AO historical API", bot.name, len(raw or []))

            parsed = _parse_candles(raw)
            if not parsed:
                return {"status": "warn", "message": "AO returned 0 candles — cold start remains", "candle_count": 0}

            feed = parsed[:-1] if len(parsed) > 1 else parsed

            # Re-seed channel aggregator
            ch_agg = self._channel_aggregators.get(bot_id)
            if ch_agg is not None:
                try:
                    ch_tf = int(bot.channel_tf)
                except (TypeError, ValueError):
                    ch_tf = tf_mins
                if ch_tf != tf_mins:
                    raw_ch = await broker.get_candle_data(
                        symbol=bot.instrument, exchange="MCX", interval=_closest(ch_tf),
                        symbol_token=symbol_token,
                        from_dt=(now_ist - timedelta(days=days_needed)).strftime("%Y-%m-%d %H:%M"),
                        to_dt=to_dt,
                    )
                    ch_parsed = _parse_candles(raw_ch)
                    ch_feed = ch_parsed[:-1] if len(ch_parsed) > 1 else ch_parsed
                    ch_agg._bars.clear()
                    for c in ch_feed:
                        ch_agg._bars.append(c)
                    logger.info("[WARMUP] %s: channel agg seeded with %d %dmin candles",
                                bot.name, len(ch_agg._bars), ch_tf)

            # Re-seed main aggregator
            agg = self._aggregators.get(bot_id)
            if agg is not None:
                agg._bars.clear()
                for c in feed:
                    agg._bars.append(c)

            # Re-feed strategy (reset first to avoid duplicate signals)
            if hasattr(strategy, '_completed'):
                strategy._completed.clear()
            if hasattr(strategy, '_prev_close'):
                strategy._prev_close = None

            discarded = 0
            for c in feed:
                try:
                    if "channel" in indicator:
                        ch_live = self._channel_aggregators[bot_id].candles \
                            if bot_id in self._channel_aggregators else None
                        sig = strategy.on_candle(c, channel_candles=ch_live)
                    else:
                        sig = strategy.on_candle(c)
                    if sig is not None:
                        discarded += 1
                except Exception as _e:
                    logger.debug("[WARMUP] candle error: %s", _e)

            logger.info("[WARMUP] %s: done — %d candles, %d warmup signals discarded",
                        bot.name, len(feed), discarded)
            return {
                "status": "ok",
                "bot_id": bot_id,
                "bot_name": bot.name,
                "candle_count": len(feed),
                "warmup_signals_discarded": discarded,
                "upper_channel": getattr(strategy, 'upper_channel', None),
                "lower_channel": getattr(strategy, 'lower_channel', None),
            }

        except Exception as e:
            logger.error("[WARMUP] %s failed: %s", bot.name, e, exc_info=True)
            return {"status": "error", "message": str(e)}

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
