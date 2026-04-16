"""
Smart Grid API — manages algo deployments per trading day.
Fully wired to PostgreSQL.
"""
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from pydantic import BaseModel
from typing import Optional
from datetime import date, timedelta, datetime
from zoneinfo import ZoneInfo
import uuid as uuid_lib
from app.core.database import get_db
from app.models.grid import GridEntry, GridStatus
from app.models.algo import Algo, StrategyMode
from app.models.algo_state import AlgoState, AlgoRunStatus

IST = ZoneInfo("Asia/Kolkata")

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

def _entry_to_dict(entry: GridEntry, algo_state: "AlgoState | None" = None, algo_name: "str | None" = None) -> dict:
    status = entry.status.value if entry.status else "no_trade"
    # Show "waiting" when AlgoState is WAITING but GridEntry is already ALGO_ACTIVE
    # (entry time not yet reached — activated at 09:15 but order not placed yet)
    if (
        algo_state is not None
        and algo_state.status == AlgoRunStatus.WAITING
        and status == "algo_active"
    ):
        status = "waiting"
    return {
        "id":             str(entry.id),
        "algo_id":        str(entry.algo_id),
        "algo_name":      algo_name,
        "account_id":     str(entry.account_id),
        "trading_date":   entry.trading_date.isoformat() if entry.trading_date else None,
        "day_of_week":    entry.day_of_week,
        "lot_multiplier": entry.lot_multiplier,
        "is_enabled":     entry.is_enabled,
        "is_practix":     entry.is_practix,
        "is_archived":    entry.is_archived,
        "status":         status,
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
    week_start:  Optional[str] = None,
    week_end:    Optional[str] = None,
    is_practix:  Optional[bool] = None,
    db: AsyncSession = Depends(get_db),
):
    monday = _get_week_monday(week_start)
    if week_end:
        try:
            range_end = datetime.strptime(week_end, "%Y-%m-%d").date()
        except ValueError:
            range_end = monday + timedelta(days=6)
    else:
        range_end = monday + timedelta(days=6)

    result = await db.execute(
        select(GridEntry, Algo).join(Algo, GridEntry.algo_id == Algo.id).where(
            GridEntry.trading_date >= monday,
            GridEntry.trading_date <= range_end,
            GridEntry.is_archived == False,
            *([] if is_practix is None else [GridEntry.is_practix == is_practix]),
        ).order_by(GridEntry.trading_date, GridEntry.created_at)
    )
    rows = result.all()
    entries = [r[0] for r in rows]
    algo_names: dict = {str(r[0].id): r[1].name for r in rows}

    # Bulk-fetch AlgoStates for today's entries so we can show WAITING status
    today = date.today()
    today_ids = [e.id for e in entries if e.trading_date == today]
    states: dict = {}
    if today_ids:
        states_result = await db.execute(
            select(AlgoState).where(AlgoState.grid_entry_id.in_(today_ids))
        )
        states = {str(s.grid_entry_id): s for s in states_result.scalars().all()}

    by_algo: dict = {}
    for entry in entries:
        algo_id = str(entry.algo_id)
        if algo_id not in by_algo:
            by_algo[algo_id] = []
        by_algo[algo_id].append(_entry_to_dict(entry, states.get(str(entry.id)), algo_names.get(str(entry.id))))

    return {
        "week_start": monday.isoformat(),
        "week_end":   range_end.isoformat(),
        "entries":    [_entry_to_dict(e, states.get(str(e.id)), algo_names.get(str(e.id))) for e in entries],
        "by_algo":    by_algo,
    }


@router.post("/")
async def deploy_algo(request: Request, body: DeployRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Algo).where(Algo.id == body.algo_id).with_for_update())
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
    # ── Update recurring_days (FOR UPDATE lock held on algo row) ──────────────
    day_upper = day_str.upper()
    existing_recurring = list(algo.recurring_days or [])
    if day_upper not in existing_recurring:
        algo.recurring_days = existing_recurring + [day_upper]

    if existing_entry:
        # Already deployed — update multiplier and practix flag instead of rejecting
        existing_entry.lot_multiplier = body.lot_multiplier
        existing_entry.is_practix = body.is_practix
        existing_entry.is_archived = False
        await db.commit()
        await db.refresh(existing_entry)
        result_dict = _entry_to_dict(existing_entry)
        result_dict["algo_recurring_days"] = algo.recurring_days or []
        return result_dict

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

    # ── Immediate activation if deployed today after 09:15 IST ───────────────
    import logging as _logging
    _log = _logging.getLogger(__name__)
    now_ist = datetime.now(IST)
    today_ist = now_ist.date()
    market_open = now_ist.replace(hour=9, minute=15, second=0, microsecond=0)

    if trading_date == today_ist and now_ist >= market_open:
        # Parse algo entry time
        try:
            _ep = (algo.entry_time or "09:15").split(":")
            entry_ist = now_ist.replace(hour=int(_ep[0]), minute=int(_ep[1]), second=int(_ep[2]) if len(_ep) > 2 else 0, microsecond=0)
        except Exception:
            entry_ist = now_ist.replace(hour=9, minute=15, second=0, microsecond=0)

        # Parse algo exit time to determine the upper bound for activation
        try:
            _xp = (algo.exit_time or "15:30").split(":")
            exit_ist = now_ist.replace(hour=int(_xp[0]), minute=int(_xp[1]), second=int(_xp[2]) if len(_xp) > 2 else 0, microsecond=0)
        except Exception:
            exit_ist = now_ist.replace(hour=15, minute=30, second=0, microsecond=0)

        if now_ist < exit_ist:
            # Still within the trading window — activate the entry
            existing_state = await db.execute(
                select(AlgoState).where(AlgoState.grid_entry_id == entry.id)
            )
            if not existing_state.scalar_one_or_none():
                algo_state = AlgoState(
                    id=uuid_lib.uuid4(),
                    algo_id=algo.id,
                    grid_entry_id=entry.id,
                    account_id=algo.account_id,
                    trading_date=str(trading_date),
                    status=AlgoRunStatus.WAITING,
                    is_practix=body.is_practix,
                    activated_at=now_ist,
                )
                db.add(algo_state)
                entry.status = GridStatus.ALGO_ACTIVE
                await db.commit()

                if now_ist < entry_ist:
                    # Entry time not yet reached — schedule the per-algo jobs so the
                    # entry fires at the configured entry_time
                    _log.info(
                        f"[GRID] Mid-day activation (pre-entry): {algo.name} for {trading_date} "
                        f"(entry={algo.entry_time}, now={now_ist.strftime('%H:%M:%S')})"
                    )
                    scheduler = getattr(request.app.state, "scheduler", None)
                    if scheduler:
                        scheduler.schedule_algo_jobs(str(entry.id), algo, trading_date)
                        _log.info(
                            f"[GRID] Scheduled entry/exit jobs for {algo.name} @ "
                            f"entry={algo.entry_time}, exit={algo.exit_time}"
                        )
                    else:
                        _log.warning(
                            f"[GRID] Scheduler not available — entry job NOT scheduled for {algo.name}"
                        )
                else:
                    # Entry time already passed but still before exit — fire entry immediately
                    _log.info(
                        f"[GRID] Mid-day activation (post-entry): {algo.name} for {trading_date} "
                        f"(entry={algo.entry_time}, now={now_ist.strftime('%H:%M:%S')}) — "
                        f"calling algo_runner.enter() immediately"
                    )
                    scheduler = getattr(request.app.state, "scheduler", None)
                    if scheduler:
                        # Schedule the exit job so the algo is squared off at exit_time
                        scheduler.schedule_algo_jobs(str(entry.id), algo, trading_date)
                        _log.info(
                            f"[GRID] Scheduled exit job for {algo.name} @ exit={algo.exit_time}"
                        )
                    algo_runner = getattr(request.app.state, "algo_runner", None)
                    if algo_runner:
                        import asyncio as _asyncio
                        _asyncio.ensure_future(algo_runner.enter(str(entry.id)))
                        _log.info(
                            f"[GRID] algo_runner.enter() queued for {algo.name} ({entry.id})"
                        )
                    else:
                        _log.warning(
                            f"[GRID] algo_runner not available — entry NOT fired for {algo.name}"
                        )
        else:
            # Past exit time — no activation possible today
            _log.warning(
                f"[GRID] Exit time {algo.exit_time} already passed for {algo.name} — no_trade"
            )

    result_dict = _entry_to_dict(entry)
    result_dict["algo_recurring_days"] = algo.recurring_days or []
    return result_dict


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
async def remove_entry(
    entry_id: str,
    remove_recurring: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(GridEntry).where(GridEntry.id == entry_id))
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=404, detail="Grid entry not found")

    updated_recurring: list = []
    if remove_recurring:
        algo_result = await db.execute(
            select(Algo).where(Algo.id == entry.algo_id).with_for_update()
        )
        algo = algo_result.scalar_one_or_none()
        if algo:
            day_upper = entry.day_of_week.upper()
            algo.recurring_days = [d for d in (algo.recurring_days or []) if d != day_upper]
            updated_recurring = algo.recurring_days

    await db.delete(entry)
    await db.commit()
    return {"status": "ok", "entry_id": entry_id, "algo_recurring_days": updated_recurring}


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


@router.post("/activate-now")
async def activate_now(request: Request):
    """
    Force-run the 09:15 activate_all job right now.
    Use after manually creating grid entries past 09:15 to create missing AlgoStates.
    """
    import logging as _log
    logger = _log.getLogger(__name__)
    scheduler = getattr(request.app.state, "scheduler", None)
    if not scheduler:
        return {"status": "error", "detail": "Scheduler not available"}
    try:
        await scheduler._job_activate_all()
        return {"status": "ok", "detail": "activate_all triggered — AlgoStates created and entry jobs scheduled"}
    except Exception as e:
        logger.error(f"[GRID/ACTIVATE-NOW] {e}")
        return {"status": "error", "detail": str(e)}


@router.post("/trigger-now")
async def trigger_now(request: Request, db: AsyncSession = Depends(get_db)):
    """
    Manually trigger grid evaluation for all active algos right now.
    Called from GridPage 'Trigger Now' button to force an immediate check.
    """
    import logging
    logger = logging.getLogger(__name__)
    today = date.today()

    try:
        scheduler = getattr(request.app.state, "scheduler", None)
        if scheduler and hasattr(scheduler, "_scheduler"):
            # Get all waiting AlgoStates for today and re-schedule their entry jobs
            result = await db.execute(
                select(AlgoState, GridEntry, Algo)
                .join(GridEntry, AlgoState.grid_entry_id == GridEntry.id)
                .join(Algo, GridEntry.algo_id == Algo.id)
                .where(
                    AlgoState.trading_date == str(today),
                    AlgoState.status == AlgoRunStatus.WAITING,
                )
            )
            rows = result.all()
            triggered = []
            from app.engine import event_logger as _ev_grid
            for algo_state, grid_entry, algo in rows:
                try:
                    scheduler.schedule_algo_jobs(str(grid_entry.id), algo, today)
                    triggered.append(algo.name)
                    logger.info(f"[GRID/TRIGGER-NOW] Re-scheduled: {algo.name}")
                    import asyncio as _asyncio
                    _asyncio.ensure_future(_ev_grid.info(
                        f"[RUN] {algo.name} — entry manually triggered by user",
                        algo_name=algo.name, source="grid_api",
                    ))
                except Exception as e:
                    logger.warning(f"[GRID/TRIGGER-NOW] Failed for {algo.name}: {e}")
            return {"status": "triggered", "detail": f"Re-scheduled {len(triggered)} waiting algos", "algos": triggered}
    except Exception as e:
        logger.warning(f"[GRID/TRIGGER-NOW] Scheduler unavailable: {e}")

    return {"status": "triggered", "detail": "Manual trigger queued — scheduler will pick up on next cycle"}


@router.post("/eod-cleanup")
async def eod_cleanup(request: Request, db: AsyncSession = Depends(get_db)):
    """
    Force-close all stale intraday AlgoStates for today.
    Handles cases where per-algo exit jobs were lost (server restart).
    Safe to call multiple times — only affects ACTIVE/WAITING/ERROR states.

    Usage: curl -X POST http://localhost:8000/api/v1/grid/eod-cleanup
    """
    today = date.today()
    algo_runner = getattr(request.app.state, "algo_runner", None)

    result = await db.execute(
        select(AlgoState, GridEntry, Algo)
        .join(GridEntry, AlgoState.grid_entry_id == GridEntry.id)
        .join(Algo, GridEntry.algo_id == Algo.id)
        .where(
            and_(
                AlgoState.trading_date == str(today),
                Algo.strategy_mode == StrategyMode.INTRADAY,
                AlgoState.status.in_([
                    AlgoRunStatus.ACTIVE,
                    AlgoRunStatus.WAITING,
                    AlgoRunStatus.ERROR,
                ])
            )
        )
    )
    rows = result.all()

    if not rows:
        return {"status": "ok", "closed": 0, "message": "No stale intraday algos found"}

    active_ids = []
    for algo_state, grid_entry, algo in rows:
        if algo_state.status == AlgoRunStatus.ACTIVE and algo_runner:
            # exit_all handles open orders + state update via its own DB session
            active_ids.append(str(grid_entry.id))
        else:
            # WAITING / ERROR — no open orders; directly mark closed
            algo_state.status     = AlgoRunStatus.CLOSED
            algo_state.exit_reason = "eod_cleanup"
            algo_state.closed_at  = datetime.now(IST)
            grid_entry.status     = GridStatus.ALGO_CLOSED

    await db.commit()

    # Fire exit_all for ACTIVE algos after committing WAITING/ERROR closures
    for geid in active_ids:
        await algo_runner.exit_all(geid, reason="auto_sq")

    return {
        "status":  "ok",
        "closed":  len(rows),
        "active_exited": len(active_ids),
        "date":    str(today),
    }
