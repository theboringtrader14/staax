"""
EventLogger — persistent notification log.
Writes every significant event to DB (event_log table) AND broadcasts via WebSocket.
Lazy wiring — reads ws_manager from app.state on first use, no explicit wire() needed.
"""
import logging
from datetime import datetime
from typing import Optional
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")
logger = logging.getLogger(__name__)

_ws_manager = None

def wire(ws_manager) -> None:
    """Optional explicit wiring. If not called, lazy wiring via _get_ws() is used."""
    global _ws_manager
    _ws_manager = ws_manager
    logger.info("[EVENT] EventLogger wired to WebSocket manager")

def _get_ws():
    """Lazily get ws_manager from app state if not explicitly wired."""
    global _ws_manager
    if _ws_manager is not None:
        return _ws_manager
    try:
        from app.main import app
        _ws_manager = getattr(app.state, "ws_manager", None)
    except Exception:
        pass
    return _ws_manager

async def log(
    level: str,
    msg: str,
    algo_name: str = "",
    algo_id: str = "",
    account_id: str = "",
    source: str = "engine",
    details: str = "",
    db=None,
) -> None:
    """
    Log an event to DB + broadcast to notification WebSocket.
    level: info | warn | error | success
    """
    ts = datetime.now(IST)

    # Broadcast to frontend notification bell
    ws = _get_ws()
    if ws:
        try:
            await ws.notify(level, msg, algo_name)
        except Exception as e:
            logger.warning(f"[EVENT] WS broadcast failed: {e}")

    # Persist to DB — auto-create session if none provided
    target_db  = db
    own_session = False
    if not target_db:
        try:
            from app.core.database import AsyncSessionLocal
            target_db  = AsyncSessionLocal()
            own_session = True
        except Exception:
            pass

    if target_db:
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
            target_db.add(entry)
            await target_db.commit()
        except Exception as e:
            logger.warning(f"[EVENT] DB persist failed: {e}")
        finally:
            if own_session:
                await target_db.aclose()

    logger.info(f"[{level.upper()}] {msg}")

async def info(msg: str, **kw): await log("info", msg, **kw)
async def warn(msg: str, **kw): await log("warn", msg, **kw)
async def error(msg: str, **kw): await log("error", msg, **kw)
async def success(msg: str, **kw): await log("success", msg, **kw)
