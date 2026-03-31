"""
Execution Logs API — read-only audit trail for order decisions.

GET /api/v1/logs/
  ?algo_id=   filter by algo UUID
  ?date=      filter by date YYYY-MM-DD (IST)
  ?event_type= filter by event type (entry_attempt, entry_success, …)
  ?limit=50   max rows returned (default 50, max 500)
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc

from app.core.database import get_db
from app.models.execution_log import ExecutionLog

logger = logging.getLogger(__name__)
router = APIRouter()

IST = timezone(timedelta(hours=5, minutes=30))


@router.get("/")
async def list_execution_logs(
    db:         AsyncSession = Depends(get_db),
    algo_id:    Optional[str] = Query(None),
    date:       Optional[str] = Query(None),   # YYYY-MM-DD in IST
    event_type: Optional[str] = Query(None),
    is_practix: Optional[bool] = Query(None),
    limit:      int           = Query(50, ge=1, le=500),
):
    """
    Recent execution audit logs.
    Newest first. Max 500 rows per request.
    """
    import uuid as _uuid

    conditions = []

    if algo_id:
        try:
            conditions.append(ExecutionLog.algo_id == _uuid.UUID(algo_id))
        except ValueError:
            pass

    if date:
        try:
            day_start = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=IST)
            day_end   = day_start + timedelta(days=1)
            conditions.append(ExecutionLog.timestamp >= day_start)
            conditions.append(ExecutionLog.timestamp <  day_end)
        except ValueError:
            pass

    if event_type:
        conditions.append(ExecutionLog.event_type == event_type)

    if is_practix is not None:
        conditions.append(ExecutionLog.is_practix == is_practix)

    stmt = (
        select(ExecutionLog)
        .where(*conditions)
        .order_by(desc(ExecutionLog.timestamp))
        .limit(limit)
    )
    result = await db.execute(stmt)
    rows = result.scalars().all()

    return {
        "logs": [
            {
                "id":             str(row.id),
                "timestamp":      row.timestamp.isoformat() if row.timestamp else None,
                "algo_id":        str(row.algo_id)       if row.algo_id       else None,
                "order_id":       str(row.order_id)      if row.order_id      else None,
                "grid_entry_id":  str(row.grid_entry_id) if row.grid_entry_id else None,
                "account_id":     str(row.account_id)    if row.account_id    else None,
                "algo_tag":       row.algo_tag,
                "action":         row.action,
                "status":         row.status,
                "event_type":     row.event_type,
                "reason":         row.reason,
                "details":        row.details,
                "is_practix":     row.is_practix,
            }
            for row in rows
        ],
        "count": len(rows),
    }
