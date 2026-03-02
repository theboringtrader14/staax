from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db

router = APIRouter()


@router.get("/week")
async def get_week_grid(db: AsyncSession = Depends(get_db)):
    """Get the Smart Grid for the current trading week."""
    return {"grid": [], "message": "Smart Grid — Phase 1A"}


@router.post("/deploy")
async def deploy_algo_to_day(db: AsyncSession = Depends(get_db)):
    """Deploy an algo to a specific day (drag & drop)."""
    return {"message": "Deploy algo — Phase 1A"}


@router.patch("/{entry_id}/multiplier")
async def update_multiplier(entry_id: str, db: AsyncSession = Depends(get_db)):
    """Update lot multiplier for a grid cell."""
    return {"message": "Update multiplier — Phase 1A"}


@router.delete("/{entry_id}")
async def remove_from_day(entry_id: str, db: AsyncSession = Depends(get_db)):
    """Remove an algo from a specific day."""
    return {"message": "Remove from day — Phase 1A"}
