"""Mobile dashboard API — single-call endpoint for LIFEX mobile app home screen."""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from datetime import datetime, date
from zoneinfo import ZoneInfo
from app.core.database import get_db
from app.core.auth import get_current_user
from app.models.algo import Algo

router = APIRouter()

IST = ZoneInfo("Asia/Kolkata")


@router.get("/dashboard")
async def mobile_dashboard(
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """Single-call response for mobile home screen.
    Returns networth snapshot, today's trading summary, and expenses placeholder.
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
    fy_pnl = 0.0

    try:
        from app.models.order import Order
        orders_today = await db.execute(
            select(Order).where(
                Order.status == "closed",
                Order.pnl.isnot(None),
                func.date(Order.exit_time) == today_ist,
            )
        )
        for o in orders_today.scalars().all():
            today_pnl += float(o.pnl or 0)
    except Exception:
        pass

    return {
        "networth": {
            "value": None,  # Populated by INVEX; mobile will call invex-api separately
            "change": None,
            "change_pct": None,
            "source": "invex",
        },
        "trading": {
            "today_pnl": round(today_pnl, 2),
            "fy_pnl": round(fy_pnl, 2),
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
