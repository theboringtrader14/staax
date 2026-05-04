"""
EventLogger — persistent notification log.
Writes every significant event to DB (event_log table) AND broadcasts via WebSocket.
Lazy wiring — reads ws_manager from app.state on first use, no explicit wire() needed.

Buffering: INFO/WARN events are batched and flushed to DB every 5 seconds.
ERROR events bypass the buffer and flush immediately — never lost.
Call start() in main.py lifespan startup and stop() in lifespan shutdown.
"""
import asyncio
import logging
from collections import deque
from datetime import datetime
from typing import Optional
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")
logger = logging.getLogger(__name__)

_ws_manager = None

# ── Buffer state ──────────────────────────────────────────────────────────────
_buffer: list[dict] = []
_buffer_lock: asyncio.Lock | None = None   # created in start() — avoids "no event loop" issues
_flush_task: asyncio.Task | None = None


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


# ── Lifecycle ─────────────────────────────────────────────────────────────────

async def start() -> None:
    """Start the background flush loop. Call from main.py lifespan startup."""
    global _buffer_lock, _flush_task
    _buffer_lock = asyncio.Lock()
    _flush_task = asyncio.create_task(_flush_loop())
    logger.info("[EVENT] EventLogger buffer started (5s flush interval)")


async def stop() -> None:
    """Flush remaining events and stop. Call from main.py lifespan shutdown."""
    global _flush_task
    if _flush_task:
        _flush_task.cancel()
        try:
            await _flush_task
        except asyncio.CancelledError:
            pass
    await _flush_all()
    logger.info("[EVENT] EventLogger stopped, buffer flushed")


async def _flush_loop() -> None:
    """Background task: flush buffer to DB every 5 seconds."""
    while True:
        await asyncio.sleep(5)
        await _flush_all()


async def _flush_all() -> None:
    """Write all buffered events to DB in a single batch INSERT."""
    global _buffer
    if _buffer_lock is None or not _buffer:
        return
    async with _buffer_lock:
        if not _buffer:
            return
        events = list(_buffer)
        _buffer.clear()
    try:
        from app.core.database import AsyncSessionLocal
        from app.models.event_log import EventLog
        async with AsyncSessionLocal() as db:
            db.add_all([EventLog(
                ts=e["ts"],
                level=e["level"],
                msg=e["msg"],
                algo_name=e.get("algo_name"),
                algo_id=e.get("algo_id"),
                account_id=e.get("account_id"),
                source=e.get("source", "engine"),
                details=e.get("details"),
            ) for e in events])
            await db.commit()
    except Exception as e:
        _err = str(e).lower()
        if "duplicate key" in _err or "uniqueviolation" in _err or "unique constraint" in _err:
            logger.warning(f"[EVENT] Duplicate key in batch ({len(events)} events) — clearing without retry")
        else:
            logger.warning(f"[EVENT] Batch flush failed ({len(events)} events): {e} — re-queuing for retry")
            async with _buffer_lock:
                _buffer[:0] = events  # prepend so new events follow original order


# ── Core log function ─────────────────────────────────────────────────────────

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

    DB writes are buffered (5s batch) except 'error' which flushes immediately.
    If an explicit db session is passed, writes directly (legacy path).
    """
    ts = datetime.now(IST)

    # Broadcast to frontend notification bell — always immediate
    ws = _get_ws()
    if ws:
        try:
            await ws.notify(level, msg, algo_name)
        except Exception as e:
            logger.warning(f"[EVENT] WS broadcast failed: {e}")

    event_data = {
        "ts": ts,
        "level": level,
        "msg": msg,
        "algo_name": algo_name or None,
        "algo_id": algo_id or None,
        "account_id": account_id or None,
        "source": source,
        "details": details or None,
    }

    # Explicit db session passed — write immediately (legacy/test path)
    if db:
        try:
            from app.models.event_log import EventLog
            db.add(EventLog(**event_data))
            await db.commit()
        except Exception as e:
            logger.warning(f"[EVENT] DB persist failed (explicit session): {e}")
        logger.info(f"[{level.upper()}] {msg}")
        return

    # Buffer the event (buffer not yet started → fallback to direct write)
    if _buffer_lock is not None:
        async with _buffer_lock:
            _buffer.append(event_data)
        # Error events flush immediately — never buffer errors
        if level == "error":
            await _flush_all()
    else:
        # Fallback: start() not yet called — write directly to DB
        try:
            from app.core.database import AsyncSessionLocal
            from app.models.event_log import EventLog
            async with AsyncSessionLocal() as _db:
                _db.add(EventLog(**event_data))
                await _db.commit()
        except Exception as e:
            logger.warning(f"[EVENT] DB persist failed (pre-start fallback): {e}")

    logger.info(f"[{level.upper()}] {msg}")


async def info(msg: str, **kw): await log("info", msg, **kw)
async def warn(msg: str, **kw): await log("warn", msg, **kw)
async def error(msg: str, **kw): await log("error", msg, **kw)
async def success(msg: str, **kw): await log("success", msg, **kw)
