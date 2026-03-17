"""
Services API — start/stop/status for all backend services.

Services managed:
  db        PostgreSQL connection
  redis     Redis connection
  backend   FastAPI app itself (always running if this endpoint responds)
  ws        Market feed — Zerodha KiteTicker WebSocket

Endpoints:
  GET  /services              — status of all services
  POST /services/start-all    — start all services in order
  POST /services/stop-all     — stop all services in reverse order
  POST /services/{id}/start   — start one service
  POST /services/{id}/stop    — stop one service

These endpoints power the Dashboard Services panel.
The frontend polls GET /services every 5 seconds to update the status dots.
"""
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import Dict
from enum import Enum
import asyncio
import logging

logger = logging.getLogger(__name__)

router = APIRouter()


# ── Service registry ──────────────────────────────────────────────────────────

class ServiceStatus(str, Enum):
    RUNNING  = "running"
    STOPPED  = "stopped"
    STARTING = "starting"
    STOPPING = "stopping"
    ERROR    = "error"


# In-memory service state (single-user platform — no DB persistence needed)
_service_states: Dict[str, ServiceStatus] = {
    "db":      ServiceStatus.STOPPED,
    "redis":   ServiceStatus.STOPPED,
    "backend": ServiceStatus.RUNNING,   # always running if this endpoint responds
    "ws":      ServiceStatus.STOPPED,
}

SERVICE_DETAILS = {
    "db":      "localhost:5432",
    "redis":   "localhost:6379",
    "backend": "http://localhost:8000",
    "ws":      "NSE live tick data",
}

# Start order (dependencies first)
START_ORDER = ["db", "redis", "backend", "ws"]
STOP_ORDER  = ["ws", "backend", "redis", "db"]


# ── Response helpers ──────────────────────────────────────────────────────────

def _build_status_response():
    return {
        "services": [
            {
                "id":     svc_id,
                "name":   _display_name(svc_id),
                "status": _service_states[svc_id],
                "detail": SERVICE_DETAILS[svc_id],
            }
            for svc_id in START_ORDER
        ]
    }


def _display_name(svc_id: str) -> str:
    return {
        "db":      "PostgreSQL",
        "redis":   "Redis",
        "backend": "Backend API",
        "ws":      "Market Feed",
    }.get(svc_id, svc_id)


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/")
async def get_status():
    """
    Get status of all services.
    Frontend polls this every 5 seconds to update the Dashboard status dots.
    """
    return _build_status_response()


@router.post("/start-all")
async def start_all(request: Request):
    """
    Start all services in dependency order: db → redis → backend → ws.
    Called by 'Start Session' button on Dashboard.
    - db/redis: health check only (system daemons — always up in prod)
    - backend: already running
    - ws (Market Feed): starts LTP consumer if Zerodha token is available
    """
    from sqlalchemy import text
    from app.core.database import AsyncSessionLocal

    # ── DB health check ───────────────────────────────────────────────────────
    try:
        async with AsyncSessionLocal() as db:
            await db.execute(text("SELECT 1"))
        _service_states["db"] = ServiceStatus.RUNNING
        logger.info("[SVC] PostgreSQL: healthy")
    except Exception as e:
        _service_states["db"] = ServiceStatus.ERROR
        logger.error(f"[SVC] PostgreSQL health check failed: {e}")

    # ── Redis health check ────────────────────────────────────────────────────
    try:
        redis = getattr(request.app.state, "redis", None)
        if redis:
            await redis.ping()
            _service_states["redis"] = ServiceStatus.RUNNING
            logger.info("[SVC] Redis: healthy")
        else:
            _service_states["redis"] = ServiceStatus.STOPPED
    except Exception as e:
        _service_states["redis"] = ServiceStatus.ERROR
        logger.error(f"[SVC] Redis health check failed: {e}")

    # ── Backend: always running ───────────────────────────────────────────────
    _service_states["backend"] = ServiceStatus.RUNNING

    # ── Market Feed: start LTP consumer if token available ───────────────────
    try:
        from app.models.account import Account, BrokerType
        from sqlalchemy import select
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Account).where(Account.broker == BrokerType.ZERODHA, Account.is_active == True)
            )
            zerodha_acc = result.scalar_one_or_none()

        ltp_consumer = getattr(request.app.state, "ltp_consumer", None)
        zerodha = getattr(request.app.state, "zerodha", None)

        if zerodha_acc and zerodha_acc.access_token and ltp_consumer and zerodha:
            # Load token into broker if not already loaded
            if not zerodha._access_token:
                await zerodha.load_token(zerodha_acc.access_token)
            ticker = zerodha.get_ticker()
            ltp_consumer.set_ticker(ticker)
            _service_states["ws"] = ServiceStatus.RUNNING
            logger.info("[SVC] Market Feed: started with Zerodha token")

            # Pre-load NFO instrument cache so StrikeSelector works at entry time
            try:
                instruments = zerodha.kite.instruments("NFO")
                zerodha._nfo_cache = instruments
                logger.info(f"[SVC] NFO instrument cache loaded: {len(instruments)} instruments")
            except Exception as e:
                logger.warning(f"[SVC] NFO cache load failed: {e}")

            # Subscribe index tokens for ticker
            try:
                index_tokens = await zerodha.get_index_tokens()
                if index_tokens:
                    ltp_consumer.subscribe(list(index_tokens.values()))
                    logger.info(f"[SVC] Subscribed {len(index_tokens)} index tokens")
            except Exception as e:
                logger.warning(f"[SVC] Index token subscription failed: {e}")
        else:
            _service_states["ws"] = ServiceStatus.STOPPED
            logger.warning("[SVC] Market Feed: no Zerodha token — skipping feed start")
    except Exception as e:
        _service_states["ws"] = ServiceStatus.ERROR
        logger.error(f"[SVC] Market Feed start failed: {e}")

    return {
        "message": "Session started",
        "services": _build_status_response()["services"]
    }


@router.post("/stop-all")
async def stop_all(request: Request):
    """
    Stop all services in reverse order: ws → backend → redis → db.
    Called by 'Stop All' button on Dashboard.
    """
    # Stop Market Feed (LTP consumer)
    try:
        ltp_consumer = getattr(request.app.state, "ltp_consumer", None)
        if ltp_consumer and hasattr(ltp_consumer, "stop"):
            await ltp_consumer.stop()
        _service_states["ws"] = ServiceStatus.STOPPED
        logger.info("[SVC] Market Feed: stopped")
    except Exception as e:
        logger.error(f"[SVC] Market Feed stop failed: {e}")

    for svc_id in STOP_ORDER:
        if svc_id not in ("backend", "ws"):
            _service_states[svc_id] = ServiceStatus.STOPPED

    return {
        "message": "All services stopped",
        "services": _build_status_response()["services"]
    }


@router.post("/{service_id}/start")
async def start_service(service_id: str):
    """
    Start a single service.
    Called by individual 'Start' buttons on Dashboard.
    """
    if service_id not in _service_states:
        raise HTTPException(status_code=404, detail=f"Unknown service: {service_id}")

    if _service_states[service_id] == ServiceStatus.RUNNING:
        return {"message": f"{service_id} is already running"}

    # Delegate to start_all logic for individual services
    from fastapi import Request as _Req
    # For individual starts, just do a health check
    if service_id == "db":
        try:
            from app.core.database import AsyncSessionLocal
            from sqlalchemy import text
            async with AsyncSessionLocal() as db:
                await db.execute(text("SELECT 1"))
            _service_states[service_id] = ServiceStatus.RUNNING
        except Exception as e:
            _service_states[service_id] = ServiceStatus.ERROR
            raise HTTPException(status_code=503, detail=f"PostgreSQL not reachable: {e}")
    elif service_id == "redis":
        try:
            import redis.asyncio as aioredis
            r = aioredis.from_url("redis://localhost:6379")
            await r.ping()
            await r.aclose()
            _service_states[service_id] = ServiceStatus.RUNNING
        except Exception as e:
            _service_states[service_id] = ServiceStatus.ERROR
            raise HTTPException(status_code=503, detail=f"Redis not reachable: {e}")
    elif service_id == "ws":
        # Market Feed — same logic as start_all
        from app.core.database import AsyncSessionLocal
        from sqlalchemy import select
        from app.models.account import Account, BrokerType
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Account).where(Account.broker == BrokerType.ZERODHA, Account.is_active == True)
            )
            zerodha_acc = result.scalar_one_or_none()
        import sys
        app_state = None
        # Get app state from request context if available
        for name, module in sys.modules.items():
            if hasattr(module, 'app') and hasattr(getattr(module, 'app', None), 'state'):
                app_state = getattr(module, 'app').state
                break
        if zerodha_acc and zerodha_acc.access_token and app_state:
            zerodha = getattr(app_state, 'zerodha', None)
            ltp_consumer = getattr(app_state, 'ltp_consumer', None)
            if zerodha and ltp_consumer:
                if not zerodha._access_token:
                    await zerodha.load_token(zerodha_acc.access_token)
                ticker = zerodha.get_ticker()
                ltp_consumer.set_ticker(ticker)
                try:
                    instruments = zerodha.kite.instruments("NFO")
                    zerodha._nfo_cache = instruments
                    import logging
                    logging.getLogger(__name__).info(f"[SVC-WS] NFO cache loaded: {len(instruments)} instruments")
                except Exception as e:
                    import logging
                    logging.getLogger(__name__).warning(f"[SVC-WS] NFO cache failed: {e}")
        _service_states[service_id] = ServiceStatus.RUNNING
    else:
        _service_states[service_id] = ServiceStatus.RUNNING

    return {
        "service_id": service_id,
        "status": _service_states[service_id],
        "message": f"{_display_name(service_id)} started"
    }


@router.post("/{service_id}/stop")
async def stop_service(service_id: str):
    """
    Stop a single service.
    Called by individual 'Stop' buttons on Dashboard.
    """
    if service_id not in _service_states:
        raise HTTPException(status_code=404, detail=f"Unknown service: {service_id}")

    if service_id == "backend":
        raise HTTPException(status_code=400, detail="Cannot stop the backend API via API")

    if _service_states[service_id] == ServiceStatus.STOPPED:
        return {"message": f"{service_id} is already stopped"}

    # TODO Phase 1C: actually stop the service
    _service_states[service_id] = ServiceStatus.STOPPED

    return {
        "service_id": service_id,
        "status": ServiceStatus.STOPPED,
        "message": f"{_display_name(service_id)} stopped"
    }
