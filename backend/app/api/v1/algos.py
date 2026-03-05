"""
Algos API — CRUD for algo configuration + runtime controls.

CRUD endpoints:
  GET    /algos              — list all algos
  POST   /algos              — create new algo
  GET    /algos/{id}         — get full algo config + legs
  PUT    /algos/{id}         — update algo config
  DELETE /algos/{id}         — delete algo

Runtime control endpoints (called from Orders page action buttons):
  POST   /algos/{id}/start      — RUN: manually trigger entry now
  POST   /algos/{id}/re         — RE: retry a failed entry (error state only)
  POST   /algos/{id}/sq         — SQ: square off selected open legs
  POST   /algos/{id}/terminate  — T: square off all + terminate for today

NOTE: RE is NOT the same as re-entry.
  RE       = manual retry of a failed entry order (algo in ERROR state)
  Re-entry = automatic re-entry after an exit (handled by ReentryEngine)
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import List, Optional
from app.core.database import get_db

router = APIRouter()


# ── Request bodies ────────────────────────────────────────────────────────────

class AlgoCreateRequest(BaseModel):
    """Full algo config — see schemas/algo.py for AlgoCreate."""
    pass   # wired in Phase 1C — using schemas.algo.AlgoCreate


class SquareOffRequest(BaseModel):
    leg_ids: List[str]          # specific leg order IDs to square off
    # Empty list = square off ALL open legs


class RERequest(BaseModel):
    """Retry entry — only valid when algo is in ERROR state."""
    pass


# ── CRUD ──────────────────────────────────────────────────────────────────────

@router.get("/")
async def list_algos(db: AsyncSession = Depends(get_db)):
    """List all configured algos."""
    return {"algos": [], "message": "Phase 1C"}


@router.post("/")
async def create_algo(db: AsyncSession = Depends(get_db)):
    """Create a new algo with legs."""
    return {"message": "Phase 1C"}


@router.get("/{algo_id}")
async def get_algo(algo_id: str, db: AsyncSession = Depends(get_db)):
    """Get full algo config including all legs."""
    return {"algo_id": algo_id, "message": "Phase 1C"}


@router.put("/{algo_id}")
async def update_algo(algo_id: str, db: AsyncSession = Depends(get_db)):
    """Update algo configuration."""
    return {"message": "Phase 1C"}


@router.delete("/{algo_id}")
async def delete_algo(algo_id: str, db: AsyncSession = Depends(get_db)):
    """Delete an algo permanently."""
    return {"message": "Phase 1C"}


# ── Runtime controls ──────────────────────────────────────────────────────────

@router.post("/{algo_id}/start")
async def start_algo(
    algo_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    RUN — manually trigger entry for this algo right now.
    Bypasses the scheduled entry_time.
    Valid from any non-terminated state.
    Creates an AlgoState row if one doesn't exist for today.
    """
    return {
        "algo_id": algo_id,
        "action": "start",
        "message": "Entry triggered — Phase 1D"
    }


@router.post("/{algo_id}/re")
async def retry_entry(
    algo_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    RE — retry a failed entry.
    Only valid when AlgoState.status == 'error'.
    Clears the error and re-attempts the entry logic.

    This is NOT automatic re-entry (ReentryEngine handles that).
    This is a manual recovery from a failed order placement.
    """
    # TODO Phase 1D: check AlgoState.status == 'error' before proceeding
    return {
        "algo_id": algo_id,
        "action": "re",
        "message": "Retry entry — Phase 1D"
    }


@router.post("/{algo_id}/sq")
async def square_off(
    algo_id: str,
    body: SquareOffRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    SQ — square off open legs.
    If body.leg_ids is empty, squares off ALL open legs for this algo.
    If body.leg_ids is provided, squares off only those specific legs.
    Places exit orders at market price immediately.
    """
    return {
        "algo_id": algo_id,
        "action": "sq",
        "leg_ids": body.leg_ids or "all",
        "message": "Square off — Phase 1D"
    }


@router.post("/{algo_id}/terminate")
async def terminate_algo(
    algo_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    T — terminate algo for today.
    1. Squares off ALL open positions immediately
    2. Cancels any pending orders
    3. Sets AlgoState.status = 'terminated'
    4. Algo cannot be restarted today after termination
    """
    return {
        "algo_id": algo_id,
        "action": "terminate",
        "message": "Terminated — Phase 1D"
    }
