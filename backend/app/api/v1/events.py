"""
Event Log API — retrieve and export the persistent notification/event log.
Used by the frontend notification panel for persistence + QA debugging export.
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from app.core.database import get_db
from app.models.event_log import EventLog
import json

router = APIRouter()

@router.get("/")
async def list_events(
    limit: int = Query(default=100, le=500),
    level: str = Query(default=None),
    db: AsyncSession = Depends(get_db)
):
    """List recent events — used by notification panel on page load."""
    q = select(EventLog).order_by(desc(EventLog.ts)).limit(limit)
    if level:
        q = q.where(EventLog.level == level)
    result = await db.execute(q)
    rows = result.scalars().all()
    return [
        {
            "id":         r.id,
            "ts":         r.ts.isoformat() if r.ts else None,
            "level":      r.level,
            "msg":        r.msg,
            "algo_name":  r.algo_name,
            "source":     r.source,
            "details":    r.details,
        }
        for r in rows
    ]

@router.get("/export")
async def export_events(db: AsyncSession = Depends(get_db)):
    """Export full event log as JSON — for QA debugging and sharing."""
    result = await db.execute(select(EventLog).order_by(desc(EventLog.ts)).limit(1000))
    rows = result.scalars().all()
    data = [
        {
            "id": r.id, "ts": r.ts.isoformat() if r.ts else None,
            "level": r.level, "msg": r.msg,
            "algo_name": r.algo_name, "algo_id": r.algo_id,
            "account_id": r.account_id, "source": r.source, "details": r.details,
        }
        for r in rows
    ]
    from fastapi.responses import JSONResponse
    from datetime import datetime
    return JSONResponse(
        content={"exported_at": datetime.utcnow().isoformat(), "events": data},
        headers={"Content-Disposition": "attachment; filename=staax_event_log.json"}
    )
