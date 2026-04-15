"""Bots API — Indicator Systems CRUD."""
import logging
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone, date, timedelta
from zoneinfo import ZoneInfo
from app.core.database import get_db
from app.models.bot import Bot, BotOrder, BotSignal, IndicatorType
import uuid as uuid_lib

logger = logging.getLogger(__name__)

router = APIRouter()

class BotCreate(BaseModel):
    name:            str
    account_id:      str
    instrument:      str
    exchange:        str = "MCX"
    expiry:          str
    indicator:       str
    timeframe_mins:  int = 60
    lots:            int = 1
    channel_candles: Optional[int] = None
    channel_tf:      Optional[str] = None
    tt_lookback:     Optional[int] = None
    is_practix:      bool = True

def _bot_dict(b: Bot) -> dict:
    return {
        "id":             str(b.id),
        "name":           b.name,
        "account_id":     str(b.account_id),
        "instrument":     b.instrument,
        "exchange":       b.exchange,
        "expiry":         b.expiry,
        "indicator": b.indicator,
        "timeframe_mins": b.timeframe_mins,
        "lots":           b.lots,
        "channel_candles":b.channel_candles,
        "channel_tf":     b.channel_tf,
        "tt_lookback":    b.tt_lookback,
        "status": b.status or "active",
        "is_archived":    b.is_archived,
        "is_practix":     b.is_practix if b.is_practix is not None else True,
        "pinescript_code": b.pinescript_code,
        "created_at":     b.created_at.isoformat() if b.created_at else None,
    }

@router.get("/")
async def list_bots(is_practix: bool = Query(True), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Bot).where(Bot.is_archived == False, Bot.is_practix == is_practix).order_by(desc(Bot.created_at)))
    return [_bot_dict(b) for b in result.scalars().all()]

@router.post("/")
async def create_bot(body: BotCreate, db: AsyncSession = Depends(get_db)):
    bot = Bot(
        id=uuid_lib.uuid4(),
        name=body.name,
        account_id=uuid_lib.UUID(body.account_id),
        instrument=body.instrument,
        exchange=body.exchange,
        expiry=body.expiry,
        indicator=body.indicator,
        timeframe_mins=body.timeframe_mins,
        lots=body.lots,
        channel_candles=body.channel_candles,
        channel_tf=body.channel_tf,
        tt_lookback=body.tt_lookback,
        status="active",
        is_archived=False,
        is_practix=body.is_practix,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db.add(bot)
    await db.commit()
    await db.refresh(bot)
    # Wire to bot_runner
    try:
        from app.engine.bot_runner import bot_runner
        bot_runner._bots.append(bot)
        bot_runner._init_bot(bot)
    except Exception as e:
        logger.warning(f"[BOTS] Failed to wire bot to runner: {e}")
    return _bot_dict(bot)

@router.get("/ltp")
async def get_bot_ltp(symbol: str = Query(..., description="MCX symbol, e.g. GOLDM"), request: Request = None):
    """
    Return current LTP from Redis cache for a bot instrument token.
    Exchange: MCX (exchangeType=5). Token sourced from MCX_TOKENS in bot_runner.
    """
    from app.engine.bot_runner import MCX_TOKENS
    symbol_upper = symbol.upper()
    token = MCX_TOKENS.get(symbol_upper)
    if token is None:
        raise HTTPException(status_code=404, detail=f"Unknown symbol: {symbol!r}. Known symbols: {list(MCX_TOKENS.keys())}")

    ltp_cache = getattr(request.app.state, "ltp_cache", None) if request else None
    if not ltp_cache:
        return {"symbol": symbol_upper, "token": token, "ltp": None, "last_updated": None, "reason": "LTP cache not available"}

    ltp = await ltp_cache.get(token)
    if ltp is None:
        return {"symbol": symbol_upper, "token": token, "ltp": None, "last_updated": None, "reason": "No tick data received yet — SmartStream may not be connected"}

    return {
        "symbol":       symbol_upper,
        "token":        token,
        "ltp":          ltp,
        "last_updated": datetime.now(ZoneInfo("Asia/Kolkata")).isoformat(),
    }


@router.patch("/{bot_id}")
async def update_bot(bot_id: str, body: dict, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Bot).where(Bot.id == bot_id))
    bot = result.scalar_one_or_none()
    if not bot: raise HTTPException(404, "Bot not found")
    for k, v in body.items():
        if hasattr(bot, k): setattr(bot, k, v)
    bot.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return _bot_dict(bot)

@router.delete("/{bot_id}")
async def delete_bot(bot_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Bot).where(Bot.id == bot_id))
    bot = result.scalar_one_or_none()
    if not bot: raise HTTPException(404, "Bot not found")
    await db.delete(bot)
    await db.commit()
    return {"status": "deleted"}

@router.post("/{bot_id}/archive")
async def archive_bot(bot_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Bot).where(Bot.id == bot_id))
    bot = result.scalar_one_or_none()
    if not bot: raise HTTPException(404, "Bot not found")
    bot.is_archived = True
    bot.status = "inactive"
    await db.commit()
    return {"status": "archived"}

@router.get("/orders")
async def list_all_bot_orders(db: AsyncSession = Depends(get_db)):
    """List all bot orders across all bots, newest first. Joins Bot for name + is_practix."""
    result = await db.execute(
        select(BotOrder, Bot.name.label("bot_name"), Bot.is_practix.label("is_practix"))
        .outerjoin(Bot, Bot.id == BotOrder.bot_id)
        .order_by(desc(BotOrder.entry_time))
    )
    rows = result.all()
    return [{
        "id":           str(o.id),
        "bot_name":     bot_name or "—",
        "is_practix":   is_practix if is_practix is not None else True,
        "instrument":   o.instrument,
        "direction":    o.direction,
        "lots":         o.lots,
        "entry_price":  o.entry_price,
        "exit_price":   o.exit_price,
        "entry_time":   o.entry_time.isoformat() if o.entry_time else None,
        "exit_time":    o.exit_time.isoformat() if o.exit_time else None,
        "pnl":          o.pnl,
        "status":       o.status or "open",
        "signal_type":  o.signal_type,
        "expiry":       o.expiry,
    } for o, bot_name, is_practix in rows]


@router.get("/{bot_id}/orders")
async def list_bot_orders(bot_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(BotOrder).where(BotOrder.bot_id == bot_id).order_by(desc(BotOrder.entry_time))
    )
    orders = result.scalars().all()
    return [{
        "id":           str(o.id),
        "direction":    o.direction,
        "lots":         o.lots,
        "entry_price":  o.entry_price,
        "exit_price":   o.exit_price,
        "entry_time":   o.entry_time.isoformat() if o.entry_time else None,
        "exit_time":    o.exit_time.isoformat() if o.exit_time else None,
        "pnl":          o.pnl,
        "status":       o.status or "open",
        "signal_type":  o.signal_type,
        "expiry":       o.expiry,
    } for o in orders]


@router.get("/{bot_id}/candles")
async def get_bot_candles(bot_id: str, limit: int = Query(5, ge=1, le=100)):
    """Return last N completed candles from the in-memory CandleAggregator for this bot."""
    from app.engine.bot_runner import bot_runner
    agg = bot_runner._aggregators.get(bot_id)
    if agg is None:
        raise HTTPException(404, detail=f"Bot {bot_id!r} not in bot_runner — may not be active or loaded")
    candles = agg.candles[-limit:]
    if not candles:
        return {
            "bot_id":        bot_id,
            "timeframe_mins": agg._tf,
            "candles":       [],
            "note": "No completed candles yet — waiting for first bar boundary",
        }
    return {
        "bot_id":         bot_id,
        "timeframe_mins": agg._tf,
        "count":          len(candles),
        "candles": [
            {
                "timestamp": c.ts.isoformat(),
                "open":      c.open,
                "high":      c.high,
                "low":       c.low,
                "close":     c.close,
            }
            for c in candles
        ],
    }


@router.post("/{bot_id}/fetch-daily-data")
async def fetch_bot_daily_data(bot_id: str, db: AsyncSession = Depends(get_db)):
    """
    Manually fetch daily OHLC from Angel One and load DTR pivots for this bot.
    Normally runs via scheduler at 09:00 IST. Use this to load data mid-session
    or verify pivot levels.
    """
    from app.engine.bot_runner import bot_runner
    from app.models.bot import IndicatorType

    result = await db.execute(select(Bot).where(Bot.id == bot_id))
    bot = result.scalar_one_or_none()
    if not bot:
        raise HTTPException(404, "Bot not found")
    if bot.indicator != IndicatorType.DTR:
        raise HTTPException(400, f"Bot indicator is {bot.indicator!r} — only DTR bots use daily data")

    broker = next((b for b in bot_runner._angel_brokers if b.is_token_set()), None)
    if not broker:
        raise HTTPException(503, "No Angel One broker with a valid token — complete login first")

    data = await bot_runner.fetch_daily_candles(bot.instrument, broker)
    if not data:
        raise HTTPException(502, f"fetch_daily_candles returned no data for {bot.instrument!r}")

    strategy = bot_runner._strategies.get(bot_id)
    if strategy:
        strategy.set_daily_data(
            day_open   = data["day_open"],
            prev_high  = data["prev_high"],
            prev_low   = data["prev_low"],
            prev_close = data["prev_close"],
        )

    upper_pivot = getattr(strategy, "upper_pivot", None) if strategy else None
    lower_pivot = getattr(strategy, "lower_pivot", None) if strategy else None

    return {
        "bot_id":          bot_id,
        "instrument":      bot.instrument,
        "day_open":        data["day_open"],
        "prev_high":       data["prev_high"],
        "prev_low":        data["prev_low"],
        "prev_close":      data["prev_close"],
        "upper_pivot":     upper_pivot,
        "lower_pivot":     lower_pivot,
        "strategy_loaded": strategy is not None,
    }


def _signal_dict(s: BotSignal) -> dict:
    return {
        "id":            str(s.id),
        "bot_id":        str(s.bot_id),
        "signal_type":   s.signal_type,
        "direction":     s.direction,
        "instrument":    s.instrument,
        "expiry":        s.expiry,
        "trigger_price": s.trigger_price,
        "reason":        s.reason,
        "status":        s.status or "fired",
        "bot_order_id":  str(s.bot_order_id) if s.bot_order_id else None,
        "error_message": s.error_message,
        "fired_at":      s.fired_at.isoformat() if s.fired_at else None,
    }

class BotSignalCreate(BaseModel):
    signal_type:   str
    direction:     Optional[str] = None
    instrument:    str
    expiry:        str
    trigger_price: Optional[float] = None
    status:        str = "fired"


class TVWebhookBody(BaseModel):
    bot_id:  str
    action:  str          # "buy" | "sell" | "exit"
    symbol:  str
    price:   float
    secret:  str


@router.post("/webhook/tradingview")
async def tradingview_webhook(body: TVWebhookBody, db: AsyncSession = Depends(get_db)):
    """
    TradingView alert webhook.
    Validates secret, deduplicates, fires bot_runner entry/exit.
    """
    from app.core.config import settings
    from app.engine.bot_runner import bot_runner as _bot_runner_instance
    from app.models.bot import BotSignal, Bot

    # 1. Secret validation
    if not settings.TRADINGVIEW_WEBHOOK_SECRET or body.secret != settings.TRADINGVIEW_WEBHOOK_SECRET:
        raise HTTPException(status_code=403, detail="Invalid webhook secret")

    # 2. Find bot
    try:
        bot_uuid = uuid_lib.UUID(body.bot_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid bot_id")

    result = await db.execute(select(Bot).where(Bot.id == bot_uuid))
    bot = result.scalar_one_or_none()
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")

    # 3. Map action to signal_type + direction
    action = body.action.lower()
    if action == "buy":
        signal_type, direction = "entry", "BUY"
    elif action == "sell":
        signal_type, direction = "entry", "SELL"
    elif action == "exit":
        signal_type, direction = "exit", "SELL"
    else:
        raise HTTPException(status_code=400, detail=f"Unknown action: {action}")

    # 4. Dedup: check if same signal already fired today
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    existing_result = await db.execute(
        select(BotSignal).where(
            BotSignal.bot_id == bot_uuid,
            BotSignal.signal_type == signal_type,
            BotSignal.direction == direction,
            BotSignal.fired_at >= today_start,
        ).limit(1)
    )
    if existing_result.scalar_one_or_none():
        return {"status": "duplicate", "skipped": True}

    # 5. Create signal
    sig = BotSignal(
        id=uuid_lib.uuid4(),
        bot_id=bot_uuid,
        signal_type=signal_type,
        direction=direction,
        instrument=bot.instrument,
        expiry=bot.expiry,
        trigger_price=body.price,
        status="fired",
        fired_at=datetime.now(timezone.utc),
        created_at=datetime.now(timezone.utc),
    )
    db.add(sig)
    await db.commit()

    # 6. Fire bot_runner action if runner is available
    try:
        if _bot_runner_instance and action in ("buy",):
            class _FakeSig:
                type = signal_type; direction_attr = direction.lower()
                price = body.price; reason = "tradingview"
                direction = direction.lower()
            await _bot_runner_instance._enter_trade(bot, body.price, _FakeSig())
        elif _bot_runner_instance and action in ("sell", "exit"):
            await _bot_runner_instance._exit_trade(bot, body.price)
    except Exception as _e:
        logger.warning(f"[TV-WEBHOOK] bot_runner action failed (signal still saved): {_e}")

    return {"status": "accepted"}


@router.post("/{bot_id}/signals")
async def create_signal(bot_id: str, body: BotSignalCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Bot).where(Bot.id == bot_id))
    bot = result.scalar_one_or_none()
    if not bot: raise HTTPException(404, "Bot not found")
    # Dedup: check if identical signal already fired today
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    dup_result = await db.execute(
        select(BotSignal).where(
            BotSignal.bot_id == uuid_lib.UUID(bot_id),
            BotSignal.signal_type == body.signal_type,
            BotSignal.direction == (body.direction or "").upper(),
            BotSignal.fired_at >= today_start,
        ).limit(1)
    )
    if dup_result.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Duplicate signal already fired today for this bot")
    sig = BotSignal(
        id=uuid_lib.uuid4(),
        bot_id=uuid_lib.UUID(bot_id),
        signal_type=body.signal_type,
        direction=body.direction,
        instrument=body.instrument,
        expiry=body.expiry,
        trigger_price=body.trigger_price,
        status=body.status,
        fired_at=datetime.now(timezone.utc),
        created_at=datetime.now(timezone.utc),
    )
    db.add(sig)
    await db.commit()
    await db.refresh(sig)
    return _signal_dict(sig)

@router.get("/{bot_id}/signals")
async def list_bot_signals(bot_id: str, limit: int = Query(50), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(BotSignal).where(BotSignal.bot_id == bot_id).order_by(desc(BotSignal.fired_at)).limit(limit)
    )
    return [_signal_dict(s) for s in result.scalars().all()]


@router.patch("/{bot_id}/pinescript")
async def update_bot_pinescript(bot_id: str, payload: dict, db: AsyncSession = Depends(get_db)):
    """Save or update the PineScript code for a bot."""
    result = await db.execute(select(Bot).where(Bot.id == bot_id))
    bot = result.scalar_one_or_none()
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")
    bot.pinescript_code = payload.get("pinescript_code", "")
    await db.commit()
    return {"message": "PineScript saved", "bot_id": bot_id}

@router.get("/signals/today")
async def list_signals_today(days: int = 7, db: AsyncSession = Depends(get_db)):
    since = datetime.combine(date.today() - timedelta(days=days - 1), datetime.min.time()).replace(tzinfo=timezone.utc)
    result = await db.execute(
        select(BotSignal, Bot.name.label("bot_name"))
        .outerjoin(Bot, Bot.id == BotSignal.bot_id)
        .where(BotSignal.fired_at >= since)
        .order_by(desc(BotSignal.fired_at))
    )
    rows = result.all()
    signals = []
    for sig, bot_name in rows:
        d = _signal_dict(sig)
        d["bot_name"] = bot_name or "—"
        signals.append(d)
    return {"signals": signals}
