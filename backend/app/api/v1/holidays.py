"""Market Holidays API — fetch, sync, and manage market holiday calendar."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from pydantic import BaseModel
from typing import Optional
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo
from app.core.database import get_db
from app.models.market_holiday import MarketHoliday
import uuid as uuid_lib

IST = ZoneInfo("Asia/Kolkata")

router = APIRouter()

# NSE segment → our internal segment name
_NSE_SEGMENT_MAP = {
    "CM":   "equity",
    "FO":   "fo",
    "CD":   "currency",
}

# Segments we care about (skip CMF, NDM, etc.)
_WANTED_SEGMENTS = {"equity", "fo"}


class HolidayCreate(BaseModel):
    date:        date
    segment:     str   # 'equity', 'fo', 'commodity'
    description: Optional[str] = ""


def _holiday_dict(h: MarketHoliday) -> dict:
    return {
        "id":          str(h.id),
        "date":        h.date.isoformat(),
        "segment":     h.segment,
        "description": h.description or "",
        "created_at":  h.created_at.isoformat() if h.created_at else None,
    }


@router.get("/today-is-holiday")
async def today_is_holiday(db: AsyncSession = Depends(get_db)):
    """
    Returns whether today (IST date) is a market holiday.
    Checks the 'fo' segment (F&O). Used by n8n workflows to skip automation on holidays.
    Response: {"is_holiday": bool, "name": str | null}
    """
    today_ist = datetime.now(IST).date()
    result = await db.execute(
        select(MarketHoliday).where(
            MarketHoliday.date == today_ist,
            MarketHoliday.segment == "fo",
        ).limit(1)
    )
    holiday = result.scalar_one_or_none()
    return {
        "is_holiday": holiday is not None,
        "name": holiday.description if holiday else None,
    }


@router.get("/")
async def list_holidays(year: Optional[int] = None, db: AsyncSession = Depends(get_db)):
    """List all holidays, optionally filtered by year."""
    q = select(MarketHoliday).order_by(MarketHoliday.date)
    result = await db.execute(q)
    holidays = result.scalars().all()
    if year:
        holidays = [h for h in holidays if h.date.year == year]
    return [_holiday_dict(h) for h in holidays]


@router.post("/")
async def create_holiday(body: HolidayCreate, db: AsyncSession = Depends(get_db)):
    """Manually add a holiday (for MCX or any manual entry)."""
    # Check for duplicate
    existing = await db.execute(
        select(MarketHoliday).where(
            MarketHoliday.date == body.date,
            MarketHoliday.segment == body.segment,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(400, f"Holiday already exists for {body.date} / {body.segment}")

    h = MarketHoliday(
        id=uuid_lib.uuid4(),
        date=body.date,
        segment=body.segment,
        description=body.description or "",
    )
    db.add(h)
    await db.commit()
    await db.refresh(h)
    return _holiday_dict(h)


@router.delete("/{holiday_id}")
async def delete_holiday(holiday_id: str, db: AsyncSession = Depends(get_db)):
    """Remove a holiday entry."""
    result = await db.execute(select(MarketHoliday).where(MarketHoliday.id == uuid_lib.UUID(holiday_id)))
    h = result.scalar_one_or_none()
    if not h:
        raise HTTPException(404, "Holiday not found")
    await db.delete(h)
    await db.commit()
    return {"status": "deleted"}


@router.post("/sync")
async def sync_holidays(db: AsyncSession = Depends(get_db)):
    """
    Fetch holidays from NSE API and upsert into DB.
    Returns count of holidays synced per segment.
    """
    import httpx

    url = "https://www.nseindia.com/api/holiday-master?type=trading"
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "application/json",
        "Referer": "https://www.nseindia.com/",
    }

    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        raise HTTPException(502, f"NSE API fetch failed: {e}")

    synced = 0
    skipped = 0
    by_segment: dict[str, int] = {}

    for nse_seg, our_seg in _NSE_SEGMENT_MAP.items():
        if our_seg not in _WANTED_SEGMENTS:
            continue
        entries = data.get(nse_seg, [])
        for entry in entries:
            raw_date = entry.get("tradingDate", "")
            description = entry.get("description", "")
            # Parse "26-Mar-2026" format
            try:
                holiday_date = datetime.strptime(raw_date, "%d-%b-%Y").date()
            except ValueError:
                skipped += 1
                continue

            # Upsert — check existing
            existing = await db.execute(
                select(MarketHoliday).where(
                    MarketHoliday.date == holiday_date,
                    MarketHoliday.segment == our_seg,
                )
            )
            existing_row = existing.scalar_one_or_none()
            if existing_row:
                # Update description if changed
                if existing_row.description != description:
                    existing_row.description = description
                skipped += 1
            else:
                h = MarketHoliday(
                    id=uuid_lib.uuid4(),
                    date=holiday_date,
                    segment=our_seg,
                    description=description,
                )
                db.add(h)
                synced += 1
                by_segment[our_seg] = by_segment.get(our_seg, 0) + 1

    await db.commit()
    return {
        "status":     "ok",
        "synced":     synced,
        "skipped":    skipped,
        "by_segment": by_segment,
    }
