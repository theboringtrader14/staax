"""
Notifications API — mobile-facing endpoint that maps EventLog entries
to structured notification objects for the LIFEX mobile app.

EventLog fields: id, ts, level, msg, source, algo_name, algo_id, account_id, details
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from app.core.database import get_db
from app.models.event_log import EventLog

router = APIRouter()


def _derive_type(event: EventLog) -> str:
    msg_lower    = (event.msg    or "").lower()
    source_lower = (event.source or "").lower()

    if "sl_hit" in source_lower or "stop" in msg_lower:
        return "SL_HIT"
    if event.level == "ERROR":
        if "entry" in source_lower or "entry" in msg_lower:
            return "TRADE_ERROR"
        return "TRADE_ERROR"
    if event.level == "INFO":
        if "entry" in source_lower or "entry" in msg_lower:
            return "TRADE_ENTRY"
        if (
            "exit"   in source_lower or "exit"   in msg_lower
            or "sq"  in source_lower or "sq_off" in source_lower
        ):
            return "TRADE_EXIT"
    return "SYSTEM"


def _derive_title(event: EventLog, notif_type: str) -> str:
    name = event.algo_name or "Algo"
    if notif_type == "TRADE_ENTRY":
        return f"{name} entry fired"
    if notif_type == "TRADE_EXIT":
        return f"{name} exited"
    if notif_type == "TRADE_ERROR":
        return f"{name} entry failed"
    if notif_type == "SL_HIT":
        return f"SL hit on {name}"
    # SYSTEM — first 60 chars of msg
    return (event.msg or "System event")[:60]


@router.get("/")
async def get_notifications(
    limit: int = Query(default=20, le=100),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(EventLog).order_by(desc(EventLog.ts)).limit(limit)
    )
    events = result.scalars().all()

    notifications = []
    for e in events:
        notif_type = _derive_type(e)
        notifications.append({
            "id":        str(e.id),
            "type":      notif_type,
            "title":     _derive_title(e, notif_type),
            "subtitle":  e.source or (e.msg or "")[:80],
            "timestamp": e.ts.isoformat() if e.ts else None,
            "read":      False,
            "algo_id":   e.algo_id,
            "algo_name": e.algo_name,
        })

    return {"notifications": notifications, "unread_count": len(notifications)}
