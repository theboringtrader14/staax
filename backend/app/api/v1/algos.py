from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db

router = APIRouter()


@router.get("/")
async def list_algos(db: AsyncSession = Depends(get_db)):
    """List all configured algos."""
    return {"algos": [], "message": "Algos endpoint — Phase 1A"}


@router.post("/")
async def create_algo(db: AsyncSession = Depends(get_db)):
    """Create a new algo configuration."""
    return {"message": "Create algo — Phase 1A"}


@router.get("/{algo_id}")
async def get_algo(algo_id: str, db: AsyncSession = Depends(get_db)):
    """Get full algo config including legs."""
    return {"algo_id": algo_id, "message": "Get algo — Phase 1A"}


@router.put("/{algo_id}")
async def update_algo(algo_id: str, db: AsyncSession = Depends(get_db)):
    """Update algo configuration."""
    return {"message": "Update algo — Phase 1A"}


@router.delete("/{algo_id}")
async def delete_algo(algo_id: str, db: AsyncSession = Depends(get_db)):
    """Delete an algo."""
    return {"message": "Delete algo — Phase 1A"}
