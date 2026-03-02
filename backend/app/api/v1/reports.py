from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db

router = APIRouter()


@router.get("/equity-curve")
async def equity_curve(db: AsyncSession = Depends(get_db)):
    """Equity curve data for selected period."""
    return {"data": [], "message": "Equity curve — Phase 1E"}


@router.get("/metrics")
async def algo_metrics(db: AsyncSession = Depends(get_db)):
    """Per-algo performance metrics."""
    return {"metrics": [], "message": "Metrics — Phase 1E"}


@router.get("/calendar")
async def trade_calendar(db: AsyncSession = Depends(get_db)):
    """Daily P&L calendar heatmap data."""
    return {"calendar": [], "message": "Calendar — Phase 1E"}


@router.get("/download")
async def download_trades(db: AsyncSession = Depends(get_db)):
    """Download trade history as CSV."""
    return {"message": "Download — Phase 1E"}
