"""
Engine Health API — GET /api/v1/engine/health

Returns a snapshot of live engine state:
  - smartstream: Angel One SmartStream WebSocket status
  - scheduler:   APScheduler status + job count
  - monitors:    Active SL/TP and MTM monitor counts
  - engine:      Tick callback latencies, orders today, open positions

Each section is wrapped in try/except so one broken section never fails
the whole response. Missing/untracked values are returned as null.
"""
import logging
import time
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Request

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/health")
async def engine_health(request: Request):
    """
    Snapshot of live engine state.

    Returns smartstream, scheduler, monitors, and engine sections.
    Each section degrades gracefully — one failure returns null fields
    for that section only.
    """

    # ── SmartStream section ───────────────────────────────────────────────────
    smartstream: dict = {
        "status": None,
        "last_tick_ago_ms": None,
        "reconnect_count": None,
        "subscribed_tokens": None,
    }
    try:
        ltp_consumer = getattr(request.app.state, "ltp_consumer", None)
        if ltp_consumer:
            adapter = getattr(ltp_consumer, "_angel_adapter", None)
            subscribed_tokens = len(getattr(ltp_consumer, "_subscribed_tokens", []) or [])

            # Determine status from adapter connection state
            if adapter is None:
                smartstream["status"] = "disconnected"
            elif getattr(adapter, "_connected", False):
                smartstream["status"] = "active"
            elif getattr(adapter, "_running", False):
                smartstream["status"] = "connecting"
            else:
                smartstream["status"] = "disconnected"

            # last_tick_ago_ms — from ltp_consumer.last_tick_time (monotonic)
            last_tick = getattr(ltp_consumer, "last_tick_time", None)
            if last_tick is not None:
                elapsed_ms = round((time.monotonic() - last_tick) * 1000)
                smartstream["last_tick_ago_ms"] = elapsed_ms

            # reconnect_count — from the adapter
            if adapter is not None:
                smartstream["reconnect_count"] = getattr(adapter, "_reconnect_count", None)

            smartstream["subscribed_tokens"] = subscribed_tokens
        else:
            smartstream["status"] = "disconnected"
    except Exception as e:
        logger.warning(f"[ENGINE HEALTH] smartstream section failed: {e}")

    # ── Scheduler section ─────────────────────────────────────────────────────
    scheduler_section: dict = {
        "status": None,
        "jobs_count": None,
        "last_heartbeat": None,
    }
    try:
        from app.engine.scheduler import get_scheduler
        scheduler = get_scheduler()
        if scheduler is not None:
            inner = getattr(scheduler, "_scheduler", None)
            if inner is not None:
                running = inner.running
                scheduler_section["status"] = "running" if running else "stopped"
                try:
                    jobs = inner.get_jobs()
                    scheduler_section["jobs_count"] = len(jobs)
                except Exception:
                    scheduler_section["jobs_count"] = None
            else:
                scheduler_section["status"] = "stopped"
            # Heartbeat: current UTC time as proxy (scheduler has no internal heartbeat var)
            scheduler_section["last_heartbeat"] = datetime.now(timezone.utc).isoformat()
        else:
            scheduler_section["status"] = "stopped"
    except Exception as e:
        logger.warning(f"[ENGINE HEALTH] scheduler section failed: {e}")

    # ── Monitors section ──────────────────────────────────────────────────────
    monitors: dict = {
        "active_sl_monitors": None,
        "active_mtm_monitors": None,
    }
    try:
        from app.engine.algo_runner import algo_runner
        # SLTPMonitor — access via wired engine reference on algo_runner
        sl_tp_monitor = getattr(algo_runner, "_sl_tp_monitor", None)
        if sl_tp_monitor is not None:
            positions = getattr(sl_tp_monitor, "_positions", {})
            monitors["active_sl_monitors"] = len(positions)

        # MTMMonitor — access via wired engine reference on algo_runner
        mtm_monitor = getattr(algo_runner, "_mtm_monitor", None)
        if mtm_monitor is not None:
            algos_watched = getattr(mtm_monitor, "_algos", {})
            monitors["active_mtm_monitors"] = len(algos_watched)
    except Exception as e:
        logger.warning(f"[ENGINE HEALTH] monitors section failed: {e}")

    # ── Engine section ────────────────────────────────────────────────────────
    engine: dict = {
        "tick_callback_avg_ms": None,
        "orders_today": None,
        "open_positions": None,
    }
    try:
        ltp_consumer = getattr(request.app.state, "ltp_consumer", None)
        if ltp_consumer is not None:
            latencies = ltp_consumer.get_callback_latencies()
            valid_latencies = [v for v in latencies.values() if v is not None]
            if valid_latencies:
                engine["tick_callback_avg_ms"] = round(
                    sum(valid_latencies) / len(valid_latencies), 1
                )
    except Exception as e:
        logger.warning(f"[ENGINE HEALTH] tick latency section failed: {e}")

    try:
        from app.core.database import AsyncSessionLocal
        from app.models.order import Order, OrderStatus
        from sqlalchemy import select, func
        from datetime import date
        from zoneinfo import ZoneInfo

        IST = ZoneInfo("Asia/Kolkata")
        today_start = datetime.now(IST).replace(
            hour=0, minute=0, second=0, microsecond=0
        )

        async with AsyncSessionLocal() as db:
            # Orders created today (all statuses)
            today_result = await db.execute(
                select(func.count()).select_from(Order).where(
                    Order.created_at >= today_start
                )
            )
            engine["orders_today"] = today_result.scalar() or 0

            # Open positions (status = OPEN)
            open_result = await db.execute(
                select(func.count()).select_from(Order).where(
                    Order.status == OrderStatus.OPEN
                )
            )
            engine["open_positions"] = open_result.scalar() or 0

    except Exception as e:
        logger.warning(f"[ENGINE HEALTH] orders/positions DB query failed: {e}")

    return {
        "smartstream": smartstream,
        "scheduler":   scheduler_section,
        "monitors":    monitors,
        "engine":      engine,
    }
