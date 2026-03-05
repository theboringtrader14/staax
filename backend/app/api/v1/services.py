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
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Dict
from enum import Enum

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
async def start_all():
    """
    Start all services in dependency order: db → redis → backend → ws.
    Called by 'Start Session' button on Dashboard.
    """
    # TODO Phase 1C: actually start each service
    # For now: mark all as running
    for svc_id in START_ORDER:
        _service_states[svc_id] = ServiceStatus.RUNNING

    return {
        "message": "All services started",
        "services": _build_status_response()["services"]
    }


@router.post("/stop-all")
async def stop_all():
    """
    Stop all services in reverse order: ws → backend → redis → db.
    Called by 'Stop All' button on Dashboard.
    """
    for svc_id in STOP_ORDER:
        if svc_id != "backend":   # backend stops last — it's serving this request
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

    # TODO Phase 1C: actually start the service
    _service_states[service_id] = ServiceStatus.RUNNING

    return {
        "service_id": service_id,
        "status": ServiceStatus.RUNNING,
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
