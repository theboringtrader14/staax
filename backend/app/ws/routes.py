"""
WebSocket route handlers.
Registered in main.py at the app level (not under /api/v1).

Routes:
  ws://host/ws/pnl
  ws://host/ws/status
  ws://host/ws/notifications
"""
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.ws.connection_manager import manager

logger = logging.getLogger(__name__)
router = APIRouter()


@router.websocket("/ws/pnl")
async def ws_pnl(websocket: WebSocket):
    """
    Real-time P&L updates per open position.
    Frontend subscribes on app load.
    Receives: pnl_update, total_pnl message types.
    """
    await manager.connect_pnl(websocket)
    try:
        while True:
            # Keep connection alive — server pushes, client just listens
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        logger.info("WS /pnl disconnected")


@router.websocket("/ws/status")
async def ws_status(websocket: WebSocket):
    """
    Algo state transitions and order updates.
    Frontend subscribes on app load.
    Receives: algo_status, order_update message types.
    """
    await manager.connect_status(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        logger.info("WS /status disconnected")


@router.websocket("/ws/notifications")
async def ws_notifications(websocket: WebSocket):
    """
    Info/warning/error notifications.
    Frontend subscribes to populate the bell notification panel.
    Receives: notification message type.
    """
    await manager.connect_notif(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        logger.info("WS /notifications disconnected")
