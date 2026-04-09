"""Mobile dashboard API — single-call endpoint for LIFEX mobile app home screen."""
import httpx
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from datetime import datetime, date, timezone, timedelta
from zoneinfo import ZoneInfo
from app.core.database import get_db
from app.core.config import settings
from app.models.algo import Algo
from app.models.order import Order, OrderStatus
from app.models.account import Account
from app.models.grid import GridEntry, GridStatus

router = APIRouter()

IST = ZoneInfo("Asia/Kolkata")
_IST_TZ = timezone(timedelta(hours=5, minutes=30))


async def _fetch_invex_networth() -> dict:
    """Fetch portfolio summary from INVEX and return networth fields.
    Returns nulls on any failure so the mobile dashboard still loads."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{settings.INVEX_API_URL}/api/v1/portfolio/summary")
            r.raise_for_status()
            data = r.json()
            total = data.get("total_portfolio_value")
            return {"value": total}
    except Exception:
        return {"value": None}


async def _fetch_budgex_summary() -> dict:
    """Fetch expenses summary from BUDGEX.
    Returns empty dict on any failure so the mobile dashboard still loads."""
    try:
        headers = {"x-api-key": settings.BUDGEX_API_KEY}
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get("http://localhost:8002/api/v1/expenses/summary", headers=headers)
            r.raise_for_status()
            return r.json()
    except Exception:
        return {}


@router.get("/config")
async def get_mobile_config():
    return {
        "budgex_api_key": settings.BUDGEX_API_KEY,
        "budgex_url": "http://localhost:8002",
    }


@router.get("/dashboard")
async def mobile_dashboard(
    db: AsyncSession = Depends(get_db),
):
    """Single-call response for mobile home screen.
    Returns networth snapshot (from INVEX), today's trading summary,
    active algo list, and system readiness flags.
    """
    now_ist = datetime.now(IST)
    today_ist = now_ist.date()

    # IST midnight as UTC — scope queries to today
    today_start_ist = now_ist.replace(hour=0, minute=0, second=0, microsecond=0)
    today_start_utc = today_start_ist.astimezone(timezone.utc)

    # ── Active algo count ─────────────────────────────────────────────────────
    try:
        result = await db.execute(
            select(func.count()).select_from(Algo).where(Algo.is_active == True)  # noqa: E712
        )
        active_algos = result.scalar() or 0
    except Exception:
        active_algos = 0

    # ── Today's P&L ───────────────────────────────────────────────────────────
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

    # ── FY P&L (Indian FY: April–March) ──────────────────────────────────────
    fy_pnl = 0.0
    try:
        fy_start_year = today_ist.year if today_ist.month >= 4 else today_ist.year - 1
        fy_start = datetime(fy_start_year, 4, 1, tzinfo=timezone.utc)
        fy_result = await db.execute(
            select(func.coalesce(func.sum(Order.pnl), 0)).where(
                Order.status == OrderStatus.CLOSED,
                Order.exit_time >= fy_start,
            )
        )
        fy_pnl = float(fy_result.scalar() or 0)
    except Exception:
        pass

    # ── Trading mode: PRACTIX if any today's grid entry is practix ────────────
    mode = "PRACTIX"
    try:
        mode_result = await db.execute(
            select(GridEntry).where(
                GridEntry.trading_date == today_ist,
                GridEntry.is_enabled == True,  # noqa: E712
                GridEntry.is_practix == False,  # noqa: E712
            ).limit(1)
        )
        if mode_result.scalar_one_or_none() is not None:
            mode = "LIVE"
    except Exception:
        pass

    # ── Today's active algos list (grid entries today that are active/open) ───
    algos_list = []
    try:
        active_statuses = [
            GridStatus.ALGO_ACTIVE,
            GridStatus.ORDER_PENDING,
            GridStatus.OPEN,
        ]
        grid_result = await db.execute(
            select(GridEntry, Algo).join(Algo, GridEntry.algo_id == Algo.id).where(
                GridEntry.trading_date == today_ist,
                GridEntry.is_enabled == True,  # noqa: E712
                GridEntry.status.in_(active_statuses),
            )
        )
        for grid_entry, algo in grid_result.all():
            # Use Algo.entry_time as display entry_time (HH:MM from HH:MM:SS)
            entry_time_raw = algo.entry_time or ""
            entry_time_display = entry_time_raw[:5] if entry_time_raw else None

            # Map grid status to mobile-friendly status label
            status_map = {
                GridStatus.ALGO_ACTIVE:   "waiting",
                GridStatus.ORDER_PENDING: "pending",
                GridStatus.OPEN:          "open",
            }
            status_label = status_map.get(grid_entry.status, grid_entry.status.value)

            algos_list.append({
                "name":       algo.name,
                "status":     status_label,
                "entry_time": entry_time_display,
            })
    except Exception:
        pass

    # ── System readiness ──────────────────────────────────────────────────────
    # market_hours: Mon–Fri, 09:00–15:30 IST
    is_market_hours = (
        now_ist.weekday() < 5
        and (now_ist.hour, now_ist.minute) >= (9, 0)
        and (now_ist.hour, now_ist.minute) <= (15, 30)
    )

    # smartstream: True if there are active algos (feed should be running)
    smartstream_up = active_algos > 0

    networth = await _fetch_invex_networth()
    summary_data = await _fetch_budgex_summary()

    expenses_monthly = (
        summary_data.get('this_month_total')
        or summary_data.get('monthly_total')
        or summary_data.get('monthly')
        or summary_data.get('total_this_month')
        or 0
    )

    return {
        "networth": networth,
        "trading": {
            "today_pnl":    round(today_pnl, 2),
            "fy_pnl":       round(fy_pnl, 2),
            "active_algos": active_algos,
            "mode":         mode,
        },
        "algos": algos_list,
        "expenses": {"monthly": expenses_monthly},
        "system": {
            "ready":        True,
            "smartstream":  smartstream_up,
            "market_hours": is_market_hours,
        },
    }


@router.get("/notifications")
async def get_notifications(
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
):
    """Mobile notifications endpoint — maps EventLog entries to structured notification objects."""
    from app.models.event_log import EventLog
    from sqlalchemy import desc as _desc

    result = await db.execute(
        select(EventLog).order_by(_desc(EventLog.ts)).limit(limit)
    )
    events = result.scalars().all()

    def _type(e: EventLog) -> str:
        msg_l = (e.msg or "").lower()
        src_l = (e.source or "").lower()
        if "sl_hit" in src_l or "stop" in msg_l:
            return "SL_HIT"
        if e.level == "ERROR":
            return "TRADE_ERROR"
        if "entry" in src_l or "entry" in msg_l:
            return "TRADE_ENTRY"
        if "exit" in src_l or "exit" in msg_l or "sq" in src_l:
            return "TRADE_EXIT"
        return "SYSTEM"

    def _title(e: EventLog, t: str) -> str:
        name = e.algo_name or "Algo"
        if t == "TRADE_ENTRY":  return f"{name} entry fired"
        if t == "TRADE_EXIT":   return f"{name} exited"
        if t == "TRADE_ERROR":  return f"{name} entry failed"
        if t == "SL_HIT":       return f"SL hit on {name}"
        return (e.msg or "System event")[:60]

    notifications = []
    for e in events:
        t = _type(e)
        notifications.append({
            "id":        str(e.id),
            "type":      t,
            "title":     _title(e, t),
            "subtitle":  e.source or (e.msg or "")[:80],
            "timestamp": e.ts.isoformat() if e.ts else None,
            "read":      False,
            "algo_id":   e.algo_id,
            "algo_name": e.algo_name,
        })

    return {"notifications": notifications, "unread_count": len(notifications)}
