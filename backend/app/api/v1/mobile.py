"""Mobile dashboard API — single-call endpoint for LIFEX mobile app home screen."""
import httpx
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from datetime import datetime, date
from zoneinfo import ZoneInfo
from app.core.database import get_db
from app.core.config import settings
from app.models.algo import Algo
from app.models.order import Order, OrderStatus

router = APIRouter()

IST = ZoneInfo("Asia/Kolkata")


async def _fetch_invex_networth() -> dict:
    """Fetch portfolio summary from INVEX and return networth fields.
    Returns nulls on any failure so the mobile dashboard still loads."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{settings.INVEX_API_URL}/api/v1/portfolio/summary")
            r.raise_for_status()
            data = r.json()
            total = data.get("total_portfolio_value")
            day_pnl = data.get("day_pnl")
            prev = (total - day_pnl) if (total is not None and day_pnl is not None) else None
            change_pct = round(day_pnl / prev * 100, 2) if (prev and prev != 0) else None
            return {
                "value": total,
                "change": day_pnl,
                "change_pct": change_pct,
                "source": "invex",
            }
    except Exception:
        return {"value": None, "change": None, "change_pct": None, "source": "invex"}


@router.get("/dashboard")
async def mobile_dashboard(
    db: AsyncSession = Depends(get_db),
):
    """Single-call response for mobile home screen.
    Returns networth snapshot (from INVEX), today's trading summary, and expenses placeholder.
    """
    today_ist = datetime.now(IST).date()

    # Active algos count
    try:
        result = await db.execute(
            select(func.count()).select_from(Algo).where(Algo.is_active == True)  # noqa: E712
        )
        active_algos = result.scalar() or 0
    except Exception:
        active_algos = 0

    # Today's P&L — pulled from orders if available
    today_pnl = 0.0

    try:
        orders_today = await db.execute(
            select(Order).where(
                Order.status == OrderStatus.CLOSED,
                Order.pnl.isnot(None),
                func.date(Order.exit_time) == today_ist,
            )
        )
        for o in orders_today.scalars().all():
            today_pnl += float(o.pnl or 0)
    except Exception:
        pass

    networth = await _fetch_invex_networth()

    return {
        "networth": networth,
        "trading": {
            "today_pnl": round(today_pnl, 2),
            "active_algos": active_algos,
        },
        "expenses": {
            "monthly": 0,
            "currency": "INR",
            "source": "budgex",  # future integration
        },
        "timestamp": datetime.now(IST).isoformat(),
        "date": str(today_ist),
    }
