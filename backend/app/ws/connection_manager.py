"""
WebSocket Connection Manager — manages all live connections and broadcasts.

Three channels:
  /ws/pnl           — real-time P&L per open position (fires on every tick)
  /ws/status        — algo state transitions (WAITING→ACTIVE, SL HIT, etc.)
  /ws/notifications — info/warning/error events (same as notification panel)

Architecture:
  - ConnectionManager holds sets of active WebSocket connections per channel
  - Engine callbacks (SLTPMonitor, MTMMonitor) call broadcast() directly
  - Frontend connects on app load and reconnects on disconnect
  - Single-user platform — no per-user auth needed on WS (JWT checked on connect)

Message format (JSON):
  { "type": "pnl_update", "data": { "order_id": "...", "pnl": 1325.0, "ltp": 213.5 } }
  { "type": "algo_status", "data": { "algo_id": "...", "status": "active", "reason": "" } }
  { "type": "notification", "data": { "level": "error", "msg": "...", "time": "09:17" } }
"""
import json
import logging
from datetime import datetime
from typing import Set
from zoneinfo import ZoneInfo
from fastapi import WebSocket

IST = ZoneInfo("Asia/Kolkata")
logger = logging.getLogger(__name__)


class ConnectionManager:
    """
    Manages WebSocket connections for all three channels.
    One instance created at startup, shared across the app via dependency injection.
    """

    def __init__(self):
        self.pnl_connections:    Set[WebSocket] = set()
        self.status_connections: Set[WebSocket] = set()
        self.notif_connections:  Set[WebSocket] = set()
        self.ticker_connections: Set[WebSocket] = set()

    # ── Connection management ─────────────────────────────────────────────────

    async def connect_pnl(self, ws: WebSocket):
        await ws.accept()
        self.pnl_connections.add(ws)
        logger.info(f"WS /pnl connected ({len(self.pnl_connections)} total)")

    async def connect_status(self, ws: WebSocket):
        await ws.accept()
        self.status_connections.add(ws)
        logger.info(f"WS /status connected ({len(self.status_connections)} total)")

    async def connect_notif(self, ws: WebSocket):
        await ws.accept()
        self.notif_connections.add(ws)
        logger.info(f"WS /notifications connected ({len(self.notif_connections)} total)")

    async def connect_ticker(self, ws: WebSocket):
        await ws.accept()
        self.ticker_connections.add(ws)
        logger.info(f"WS /ticker connected ({len(self.ticker_connections)} total)")

    def disconnect(self, ws: WebSocket):
        self.pnl_connections.discard(ws)
        self.status_connections.discard(ws)
        self.notif_connections.discard(ws)
        self.ticker_connections.discard(ws)

    # ── Broadcast helpers ─────────────────────────────────────────────────────

    async def _send(self, connections: Set[WebSocket], message: dict):
        """Send to all connected clients on a channel. Remove dead connections."""
        dead = set()
        payload = json.dumps(message)
        for ws in connections:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.add(ws)
        connections -= dead

    # ── P&L channel ───────────────────────────────────────────────────────────

    async def broadcast_pnl(self, order_id: str, algo_id: str, pnl: float, ltp: float):
        """
        Called on every tick for open positions.
        Fired by MTMMonitor.update_pnl() and SLTPMonitor.on_tick().
        """
        await self._send(self.pnl_connections, {
            "type": "pnl_update",
            "data": {
                "order_id": order_id,
                "algo_id":  algo_id,
                "pnl":      round(pnl, 2),
                "ltp":      round(ltp, 2),
                "ts":       _now_ist(),
            }
        })

    async def broadcast_total_pnl(self, account_id: str, total_pnl: float):
        """Broadcast total account MTM — shown in TopBar."""
        await self._send(self.pnl_connections, {
            "type": "total_pnl",
            "data": {
                "account_id": account_id,
                "total_pnl":  round(total_pnl, 2),
                "ts":         _now_ist(),
            }
        })

    async def broadcast_ltp_batch(self, token_ltp: dict):
        """
        Broadcast a batch of LTP updates to Orders subscribers.
        token_ltp: { instrument_token: ltp_float, ... }
        Frontend matches by instrument_token to update leg LTP in real time.
        """
        if not self.pnl_connections:
            return
        await self._send(self.pnl_connections, {
            "type": "ltp_batch",
            "data": token_ltp,
        })

    async def broadcast_ticker(self, prices: dict):
        """
        Broadcast index LTPs to sidebar.
        prices: { "NIFTY": 22450.5, "BANKNIFTY": 48230.0, ... }
        """
        if not self.ticker_connections:
            return
        await self._send(self.ticker_connections, {
            "type": "ticker",
            "data": prices,
        })

    # ── Status channel ────────────────────────────────────────────────────────

    async def broadcast_algo_status(
        self, algo_id: str, grid_entry_id: str,
        status: str, reason: str = ""
    ):
        """
        Called on every AlgoState transition.
        Frontend uses this to update the grid cell status dot and Orders row.
        """
        await self._send(self.status_connections, {
            "type": "algo_status",
            "data": {
                "algo_id":       algo_id,
                "grid_entry_id": grid_entry_id,
                "status":        status,
                "reason":        reason,
                "ts":            _now_ist(),
            }
        })

    async def broadcast_sl_hit(
        self, symbol: str, sl_price: float, ltp: float, order_id: str
    ):
        """
        Send a structured sl_hit event on the status channel.
        Frontend useWebSocket.ts handles this to show a toast + play sound.
        """
        await self._send(self.status_connections, {
            "type": "sl_hit",
            "data": {
                "symbol":   symbol,
                "sl_price": sl_price,
                "ltp":      ltp,
                "order_id": order_id,
                "ts":       _now_ist(),
            }
        })

    async def broadcast_order_update(self, order_id: str, update: dict):
        """
        Called when an order's fill price, exit, or SL level changes.
        Frontend uses this to update the Orders table row in real time.
        """
        await self._send(self.status_connections, {
            "type": "order_update",
            "data": {"order_id": order_id, **update, "ts": _now_ist()}
        })

    # ── Notifications channel ─────────────────────────────────────────────────

    async def notify(self, level: str, msg: str, algo_name: str = ""):
        """
        Send a notification to the frontend notification panel.
        level: "info" | "warn" | "error" | "success"
        """
        logger.info(f"[{level.upper()}] {msg}")
        await self._send(self.notif_connections, {
            "type": "notification",
            "data": {
                "level":      level,
                "msg":        msg,
                "algo_name":  algo_name,
                "time":       datetime.now(IST).strftime("%H:%M"),
                "ts":         _now_ist(),
            }
        })

    async def notify_trade(self, algo_name: str, symbol: str, price: float, direction: str):
        await self.notify("success", f"{algo_name} · {direction.upper()} {symbol} @ {price}", algo_name)

    async def notify_sl_hit(self, algo_name: str, symbol: str, exit_price: float, pnl: float):
        sign = "+" if pnl >= 0 else ""
        await self.notify("error", f"{algo_name} · SL hit {symbol} @ {exit_price} · P&L {sign}₹{pnl:,.0f}", algo_name)

    async def notify_tp_hit(self, algo_name: str, symbol: str, exit_price: float, pnl: float):
        await self.notify("success", f"{algo_name} · TP hit {symbol} @ {exit_price} · P&L +₹{pnl:,.0f}", algo_name)

    async def notify_mtm_breach(self, algo_name: str, breach_type: str, mtm: float):
        level = "error" if breach_type == "sl" else "success"
        await self.notify(level, f"{algo_name} · MTM {breach_type.upper()} hit · ₹{mtm:,.0f}", algo_name)

    async def notify_error(self, algo_name: str, error: str):
        await self.notify("error", f"{algo_name} · {error}", algo_name)

    async def notify_reentry(self, algo_name: str, level: str):
        await self.notify("info", f"{algo_name} · Re-entry triggered — journey {level}", algo_name)

    async def notify_no_trade(self, algo_name: str, reason: str):
        await self.notify("warn", f"{algo_name} · No trade — {reason}", algo_name)

    async def notify_token_refresh(self, broker: str, success: bool):
        if success:
            await self.notify("info", f"{broker} token refreshed successfully")
        else:
            await self.notify("error", f"{broker} token refresh FAILED — manual login required")


# ── Singleton instance (created in main.py, shared via app.state) ─────────────
manager = ConnectionManager()


def _now_ist() -> str:
    return datetime.now(IST).isoformat()
