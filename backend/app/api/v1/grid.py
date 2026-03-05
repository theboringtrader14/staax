"""
Smart Grid API — manages algo deployments per trading day.

Endpoints:
  GET    /grid              — get full week grid (default: current week)
  POST   /grid              — deploy algo to a day (drag & drop)
  GET    /grid/{id}         — get single grid entry
  PUT    /grid/{id}         — update entry (multiplier, mode)
  DELETE /grid/{id}         — remove entry from day
  POST   /grid/{id}/archive — archive algo (hidden but recoverable)
  POST   /grid/{id}/unarchive
  POST   /grid/{id}/mode    — toggle PRACTIX / LIVE for one cell
  POST   /grid/{id}/promote-live — promote all cells of an algo to LIVE
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional
from app.core.database import get_db

router = APIRouter()


# ── Request bodies ────────────────────────────────────────────────────────────

class DeployRequest(BaseModel):
    algo_id: str
    trading_date: str          # YYYY-MM-DD
    day_of_week: str           # "mon" | "tue" | "wed" | "thu" | "fri"
    lot_multiplier: int = 1
    is_practix: bool = True


class UpdateEntryRequest(BaseModel):
    lot_multiplier: Optional[int] = None
    is_practix: Optional[bool] = None
    is_enabled: Optional[bool] = None


class SetModeRequest(BaseModel):
    is_practix: bool            # True = PRACTIX, False = LIVE


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/")
async def get_week_grid(
    week_start: Optional[str] = None,   # YYYY-MM-DD, defaults to current week Monday
    db: AsyncSession = Depends(get_db),
):
    """
    Get the Smart Grid for a trading week.
    Returns all GridEntry rows grouped by day_of_week.
    week_start defaults to the Monday of the current week.
    """
    return {
        "week_start": week_start or "current",
        "days": {},
        "message": "Grid — Phase 1C"
    }


@router.post("/")
async def deploy_algo(
    body: DeployRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Deploy an algo to a specific day.
    Called when user drags an algo card and drops it on a day column.
    Creates a new GridEntry row.
    """
    return {
        "message": "Deployed",
        "algo_id": body.algo_id,
        "day": body.day_of_week,
        "trading_date": body.trading_date,
    }


@router.get("/{entry_id}")
async def get_entry(
    entry_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get a single GridEntry by ID."""
    return {"entry_id": entry_id, "message": "Phase 1C"}


@router.put("/{entry_id}")
async def update_entry(
    entry_id: str,
    body: UpdateEntryRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Update a grid cell.
    Used for: inline lot multiplier edit, enable/disable toggle.
    """
    return {"entry_id": entry_id, "updated": body.model_dump(exclude_none=True)}


@router.delete("/{entry_id}")
async def remove_entry(
    entry_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Remove an algo from a specific day. Permanently deletes the GridEntry."""
    return {"entry_id": entry_id, "message": "Removed"}


@router.post("/{entry_id}/archive")
async def archive_entry(
    entry_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Archive an algo. Sets is_archived=True on all GridEntry rows for this algo.
    Archived algos are hidden from the active grid but can be unarchived.
    """
    return {"entry_id": entry_id, "message": "Archived"}


@router.post("/{entry_id}/unarchive")
async def unarchive_entry(
    entry_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Restore an archived algo back to the active grid."""
    return {"entry_id": entry_id, "message": "Unarchived"}


@router.post("/{entry_id}/mode")
async def set_mode(
    entry_id: str,
    body: SetModeRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Toggle PRACTIX / LIVE mode for a single grid cell.
    Updates is_practix on the GridEntry.
    """
    mode = "PRACTIX" if body.is_practix else "LIVE"
    return {"entry_id": entry_id, "mode": mode}


@router.post("/{algo_id}/promote-live")
async def promote_to_live(
    algo_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Promote all grid cells for an algo to LIVE mode.
    Sets is_practix=False on every GridEntry row for this algo_id.
    Called from the 'Promote all to LIVE' button in the algo row.
    """
    return {"algo_id": algo_id, "message": "All cells promoted to LIVE"}
