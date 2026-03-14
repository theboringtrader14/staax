"""
EventLogger — persistent notification log.
Writes every significant event to DB (event_log table) AND broadcasts via WebSocket.
This ensures the notification bell survives page refresh.
"""
import logging
from datetime import datetime, timezone
from typing import Optional
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")
logger = logging.getLogger(__name__)

_ws_manager = None   # injected from main.py

def wire(ws_manager):
    global _ws_manager
    _ws_manager = ws_manager
    logger.info("[EVENT] EventLogger wired")

async def log(
    level: str,
    msg: str,
    algo_name: str = "",
    algo_id: str = "",
    account_id: str = "",
    source: str = "engine",
    details: str = "",
    db=None,
):
    """
    Log an event to DB + broadcast to notification WebSocket.
    level: info | warn | error | success
    """
    ts = datetime.now(IST)

    # Broadcast to frontend bell
    if _ws_manager:
        try:
            await _ws_manager.notify(level, msg, algo_name)
        except Exception as e:
            logger.warning(f"[EVENT] WS broadcast failed: {e}")

    # Persist to DB
    if db:
        try:
            from app.models.event_log import EventLog
            entry = EventLog(
                ts=ts,
                level=level,
                msg=msg,
                algo_name=algo_name or None,
                algo_id=algo_id or None,
                account_id=account_id or None,
                source=source,
                details=details or None,
            )
            db.add(entry)
            await db.commit()
        except Exception as e:
            logger.warning(f"[EVENT] DB persist failed: {e}")

    logger.info(f"[{level.upper()}] {msg}")

# Convenience helpers
async def info(msg, **kw): await log("info", msg, **kw)
async def warn(msg, **kw): await log("warn", msg, **kw)
async def error(msg, **kw): await log("error", msg, **kw)
async def success(msg, **kw): await log("success", msg, **kw)
