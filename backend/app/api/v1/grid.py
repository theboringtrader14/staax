"""
Smart Grid API — manages algo deployments per trading day.
Fully wired to PostgreSQL.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional
from datetime import date, timedelta, datetime
import uuid as uuid_lib
from app.core.database import get_db
from app.models.grid import GridEntry, GridStatus
from app.models.algo import Algo

router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────

class DeployRequest(BaseModel):
    algo_id:        str
    trading_date:   str
    lot_multiplier: int  = 1
    is_practix:     bool = True


class UpdateEntryRequest(BaseModel):
    lot_multiplier: Optional[int]  = None
    is_practix:     Optional[bool] = None
    is_enabled:     Optional[bool] = None


class SetModeRequest(BaseModel):
    is_practix: bool


# ── Helpers ───────────────────────────────────────────────────────────────────

def _entry_to_dict(entry: GridEntry) -> dict:
    return {
        "id":             str(entry.id),
        "algo_id":        str(entry.algo_id),
        "account_id":     str(entry.account_id),
        "trading_date":   entry.trading_date.isoformat() if entry.trading_date else None,
        "day_of_week":    entry.day_of_week,
        "lot_multiplier": entry.lot_multiplier,
        "is_enabled":     entry.is_enabled,
        "is_practix":     entry.is_practix,
        "is_archived":    entry.is_archived,
        "status":         entry.status.value if entry.status else "no_trade",
    }


def _get_week_monday(date_str: Optional[str]) -> date:
    if date_str:
        d = datetime.strptime(date_str, "%Y-%m-%d").date()
    else:
        d = date.today()
    return d - timedelta(days=d.weekday())


def _day_of_week(d: date) -> str:
    return ["mon", "tue", "wed", "thu", "fri", "sat", "sun"][d.weekday()]


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/")
async def get_week_grid(
    week_start: Optional[str] = None,
    week_end:   Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    monday = _get_week_monday(week_start)
    friday = monday + timedelta(days=4)

    result = await db.execute(
        select(GridEntry).where(
            GridEntry.trading_date >= monday,
            GridEntry.trading_date <= friday,
            GridEntry.is_archived == False,
        ).order_by(GridEntry.trading_date, GridEntry.created_at)
    )
    entries = result.scalars().all()

    by_algo: dict = {}
    for entry in entries:
        algo_id = str(entry.algo_id)
        if algo_id not in by_algo:
            by_algo[algo_id] = []
        by_algo[algo_id].append(_entry_to_dict(entry))

    return {
        "week_start": monday.isoformat(),
        "week_end":   friday.isoformat(),
        "entries":    [_entry_to_dict(e) for e in entries],
        "by_algo":    by_algo,
    }


@router.post("/")
async def deploy_algo(request: Request, body: DeployRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Algo).where(Algo.id == body.algo_id))
    algo = result.scalar_one_or_none()
    if not algo:
        raise HTTPException(status_code=404, detail="Algo not found")

    trading_date = datetime.strptime(body.trading_date, "%Y-%m-%d").date()
    day_str = _day_of_week(trading_date)

    existing_result = await db.execute(
        select(GridEntry).where(
            GridEntry.algo_id == body.algo_id,
            GridEntry.trading_date == trading_date,
        )
    )
    existing_entry = existing_result.scalar_one_or_none()
    if existing_entry:
        # Already deployed — update multiplier and practix flag instead of rejecting
        existing_entry.lot_multiplier = body.lot_multiplier
        existing_entry.is_practix = body.is_practix
        existing_entry.is_archived = False
        await db.commit()
        await db.refresh(existing_entry)
        return _entry_to_dict(existing_entry)

    entry = GridEntry(
        id=uuid_lib.uuid4(),
        algo_id=body.algo_id,
        account_id=algo.account_id,
        trading_date=trading_date,
        day_of_week=day_str,
        lot_multiplier=body.lot_multiplier,
        is_enabled=True,
        is_practix=body.is_practix,
        is_archived=False,
        status=GridStatus.NO_TRADE,
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)

    # ── Immediate activation if dragged to today after 09:15 IST ──────────────
    from zoneinfo import ZoneInfo
    IST = ZoneInfo("Asia/Kolkata")
    now_ist = datetime.now(IST)
    today_ist = now_ist.date()
    market_open = now_ist.replace(hour=9, minute=15, second=0, microsecond=0)

    if trading_date == today_ist and now_ist >= market_open:
        # Parse algo entry time
        try:
            entry_h, entry_m, entry_s = map(int, (algo.entry_time or "09:15:00").split(":"))
            entry_ist = now_ist.replace(hour=entry_h, minute=entry_m, second=entry_s, microsecond=0)
        except Exception:
            entry_ist = now_ist.replace(hour=9, minute=15, second=0, microsecond=0)

        if now_ist < entry_ist:
            # Entry time not yet reached — activate immediately so runner can pick it up
            from app.models.algo_state import AlgoState, AlgoRunStatus
            import uuid as _uuid
            existing_state = await db.execute(
                select(AlgoState).where(
                    AlgoState.grid_entry_id == entry.id
                )
            )
            if not existing_state.scalar_one_or_none():
                algo_state = AlgoState(
                    id=_uuid.uuid4(),
                    algo_id=algo.id,
                    grid_entry_id=entry.id,
                    account_id=algo.account_id,
                    trading_date=str(trading_date),
                    status=AlgoRunStatus.WAITING,
                    is_practix=body.is_practix,
                )
                db.add(algo_state)
                entry.status = GridStatus.ALGO_ACTIVE
                await db.commit()
                import logging
                logging.getLogger(__name__).info(
                    f"[GRID] Immediate activation: {algo.name} for {trading_date} "
                    f"(entry={algo.entry_time}, now={now_ist.strftime('%H:%M:%S')})"
                )
                # Schedule the entry time job immediately
                scheduler = getattr(request.app.state, "scheduler", None)
                if scheduler:
                    scheduler.schedule_algo_jobs(str(entry.id), algo, trading_date)
                    logging.getLogger(__name__).info(
                        f"[GRID] Scheduled entry job for {algo.name} @ {algo.entry_time}"
                    )
        else:
            # Entry time already passed — mark as no_trade
            import logging
            logging.getLogger(__name__).warning(
                f"[GRID] Entry time {algo.entry_time} already passed for {algo.name} — no_trade"
            )

    return _entry_to_dict(entry)


@router.get("/{entry_id}")
async def get_entry(entry_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(GridEntry).where(GridEntry.id == entry_id))
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=404, detail="Grid entry not found")
    return _entry_to_dict(entry)


@router.put("/{entry_id}")
async def update_entry(entry_id: str, body: UpdateEntryRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(GridEntry).where(GridEntry.id == entry_id))
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=404, detail="Grid entry not found")
    if body.lot_multiplier is not None:
        entry.lot_multiplier = body.lot_multiplier
    if body.is_practix is not None:
        entry.is_practix = body.is_practix
    if body.is_enabled is not None:
        entry.is_enabled = body.is_enabled
    await db.commit()
    return _entry_to_dict(entry)


@router.delete("/{entry_id}")
async def remove_entry(entry_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(GridEntry).where(GridEntry.id == entry_id))
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=404, detail="Grid entry not found")
    await db.delete(entry)
    await db.commit()
    return {"status": "ok", "entry_id": entry_id}


@router.post("/{entry_id}/archive")
async def archive_entry(entry_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(GridEntry).where(GridEntry.id == entry_id))
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=404, detail="Grid entry not found")
    entry.is_archived = True
    await db.commit()
    return {"status": "ok", "entry_id": entry_id, "action": "archived"}


@router.post("/{entry_id}/unarchive")
async def unarchive_entry(entry_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(GridEntry).where(GridEntry.id == entry_id))
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=404, detail="Grid entry not found")
    entry.is_archived = False
    await db.commit()
    return {"status": "ok", "entry_id": entry_id, "action": "unarchived"}


@router.post("/{entry_id}/mode")
async def set_mode(entry_id: str, body: SetModeRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(GridEntry).where(GridEntry.id == entry_id))
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=404, detail="Grid entry not found")
    entry.is_practix = body.is_practix
    await db.commit()
    return {
        "status":     "ok",
        "entry_id":   entry_id,
        "mode":       "PRACTIX" if body.is_practix else "LIVE",
        "is_practix": entry.is_practix,
    }


@router.post("/{algo_id}/promote-live")
async def promote_to_live(algo_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(GridEntry).where(GridEntry.algo_id == algo_id))
    entries = result.scalars().all()
    for entry in entries:
        entry.is_practix = False
    await db.commit()
    return {"status": "ok", "algo_id": algo_id, "updated": len(entries)}
