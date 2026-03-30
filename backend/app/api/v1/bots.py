"""Bots API — Indicator Systems CRUD."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone, date
from app.core.database import get_db
from app.models.bot import Bot, BotOrder, BotSignal, IndicatorType
import uuid as uuid_lib

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
        bot_runner._subscribe_bot(bot)
    except Exception: pass
    return _bot_dict(bot)

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
        "status":       o.status.value if o.status else "open",
        "signal_type":  o.signal_type,
        "expiry":       o.expiry,
    } for o in orders]

def _signal_dict(s: BotSignal) -> dict:
    return {
        "id":            str(s.id),
        "bot_id":        str(s.bot_id),
        "signal_type":   s.signal_type,
        "direction":     s.direction,
        "instrument":    s.instrument,
        "expiry":        s.expiry,
        "trigger_price": s.trigger_price,
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

@router.post("/{bot_id}/signals")
async def create_signal(bot_id: str, body: BotSignalCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Bot).where(Bot.id == bot_id))
    bot = result.scalar_one_or_none()
    if not bot: raise HTTPException(404, "Bot not found")
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
async def list_bot_signals(bot_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(BotSignal).where(BotSignal.bot_id == bot_id).order_by(desc(BotSignal.fired_at))
    )
    return [_signal_dict(s) for s in result.scalars().all()]

@router.get("/signals/today")
async def list_signals_today(db: AsyncSession = Depends(get_db)):
    today_start = datetime.combine(date.today(), datetime.min.time()).replace(tzinfo=timezone.utc)
    result = await db.execute(
        select(BotSignal).where(BotSignal.fired_at >= today_start).order_by(desc(BotSignal.fired_at))
    )
    return {"signals": [_signal_dict(s) for s in result.scalars().all()]}
