"""
CandleDBWriter — persists completed 1-min candles to candle_1min table.
Subscribes to CandleStore callbacks for MCX instruments only.
Batches writes every 60s to avoid DB hammering.
"""
import asyncio
import logging
from typing import Optional

from sqlalchemy import select, func
from sqlalchemy.dialects.postgresql import insert

from app.core.database import AsyncSessionLocal
from app.models.candle_1min import Candle1Min

logger = logging.getLogger(__name__)

# Symbol name → instrument token str — populated on startup
MCX_INSTRUMENTS: dict[str, Optional[str]] = {
    "GOLDM":      None,
    "SILVERMIC":  None,
    "CRUDEMINI":  None,
    "NATGASMINI": None,
}

# int token → str token (for DB storage)
_token_to_str: dict[int, str] = {}


class CandleDBWriter:
    def __init__(self):
        self._pending: list[dict] = []
        self._flush_task: Optional[asyncio.Task] = None
        self._running = False

    async def start(self, broker) -> None:
        """Resolve MCX tokens from instrument master + start flush loop."""
        self._running = True
        try:
            master = await broker.get_instrument_master()
            for name in MCX_INSTRUMENTS:
                matched = [
                    r for r in master
                    if r.get("tradingsymbol", "").startswith(name)
                    and r.get("exch_seg") == "MCX"
                ]
                if matched:
                    token_str = str(matched[0].get("symboltoken", ""))
                    MCX_INSTRUMENTS[name] = token_str
                    _token_to_str[int(token_str)] = token_str
                    logger.info(
                        f"[CANDLE] Resolved {name} → token {token_str} "
                        f"({matched[0].get('tradingsymbol')})"
                    )
                else:
                    logger.warning(f"[CANDLE] Could not resolve token for {name}")
        except Exception as e:
            logger.warning(f"[CANDLE] Token resolution failed: {e}")

        self._flush_task = asyncio.create_task(self._flush_loop())
        logger.info("[CANDLE] CandleDBWriter started")

    async def stop(self) -> None:
        self._running = False
        if self._flush_task:
            self._flush_task.cancel()
        await self._flush()

    def on_candle_complete(self, token: int, candle) -> None:
        """Called by CandleStore when a 1-min candle completes."""
        token_str = _token_to_str.get(token)
        if not token_str:
            return
        self._pending.append({
            "symbol_token": token_str,
            "ts":     candle.ts,
            "open":   candle.open,
            "high":   candle.high,
            "low":    candle.low,
            "close":  candle.close,
            "volume": getattr(candle, "volume", 0.0),
        })

    async def _flush_loop(self) -> None:
        while self._running:
            await asyncio.sleep(60)
            await self._flush()

    async def _flush(self) -> None:
        if not self._pending:
            return
        batch, self._pending = self._pending, []
        try:
            async with AsyncSessionLocal() as db:
                for row in batch:
                    stmt = (
                        insert(Candle1Min)
                        .values(**row)
                        .on_conflict_do_update(
                            index_elements=["symbol_token", "ts"],
                            set_={k: row[k] for k in ["open", "high", "low", "close", "volume"]},
                        )
                    )
                    await db.execute(stmt)
                await db.commit()
            logger.info(f"[CANDLE] Flushed {len(batch)} candle(s) to DB")
        except Exception as e:
            logger.error(f"[CANDLE] DB flush error: {e}")
            self._pending.extend(batch)  # put back on failure


async def run_mcx_backfill(broker) -> None:
    """
    Backfill up to 365 days of 1-min candles for MCX instruments.
    Skips if ≥360 days already stored. 30-day chunks, 350ms between each.
    """
    import pytz
    from datetime import datetime, timedelta
    IST = pytz.timezone("Asia/Kolkata")

    for name, token_str in MCX_INSTRUMENTS.items():
        if not token_str:
            logger.warning(f"[BACKFILL] No token for {name} — skipping")
            continue
        try:
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(func.min(Candle1Min.ts), func.count())
                    .where(Candle1Min.symbol_token == token_str)
                )
                oldest_ts, count = result.one()

            if count > 0 and oldest_ts:
                days_stored = (datetime.now(IST) - oldest_ts.astimezone(IST)).days
                if days_stored >= 360:
                    logger.info(f"[BACKFILL] {name}: {count} rows, {days_stored}d — skip")
                    continue
                logger.info(f"[BACKFILL] {name}: {days_stored}d stored — backfilling gap")
            else:
                logger.info(f"[BACKFILL] {name}: no data — full backfill")

            end_dt      = datetime.now(IST)
            start_dt    = end_dt - timedelta(days=365)
            chunk_start = start_dt
            total       = 0

            while chunk_start < end_dt:
                chunk_end = min(chunk_start + timedelta(days=30), end_dt)
                from_str  = chunk_start.strftime("%Y-%m-%d %H:%M")
                to_str    = chunk_end.strftime("%Y-%m-%d %H:%M")

                candles = await broker.get_candle_data(
                    symbol=name,
                    exchange="MCX",
                    interval="ONE_MINUTE",
                    symbol_token=token_str,
                    from_dt=from_str,
                    to_dt=to_str,
                )

                if candles:
                    async with AsyncSessionLocal() as db:
                        for c in candles:
                            ts = datetime.fromisoformat(c[0]).astimezone(IST)
                            stmt = (
                                insert(Candle1Min)
                                .values(
                                    symbol_token=token_str, ts=ts,
                                    open=c[1], high=c[2], low=c[3], close=c[4],
                                    volume=c[5] if len(c) > 5 else 0.0,
                                )
                                .on_conflict_do_nothing()
                            )
                            await db.execute(stmt)
                        await db.commit()
                    total += len(candles)
                    logger.info(f"[BACKFILL] {name}: {from_str}→{to_str} → {len(candles)} candles")

                chunk_start = chunk_end
                await asyncio.sleep(0.35)

            logger.info(f"[BACKFILL] {name}: done — {total} total candles stored")

        except Exception as e:
            logger.error(f"[BACKFILL] {name} failed: {e}")


# Singleton
candle_db_writer = CandleDBWriter()
