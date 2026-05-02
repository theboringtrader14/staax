"""
WhatsApp webhook router.

Endpoints:
  GET  /api/v1/whatsapp/webhook      — Meta webhook verification
  POST /api/v1/whatsapp/webhook      — Incoming Meta events (log + acknowledge)
  GET  /api/v1/whatsapp/eod-summary  — EOD P&L summary (n8n internal use only)
"""
import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import httpx
from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import PlainTextResponse

logger = logging.getLogger(__name__)
router = APIRouter()

IST = ZoneInfo("Asia/Kolkata")
_WA_VERIFY_TOKEN = os.getenv("WA_VERIFY_TOKEN", "staax_wa_verify_2026")


@router.get("/whatsapp/webhook")
async def wa_verify(request: Request):
    """Meta webhook verification handshake."""
    mode      = request.query_params.get("hub.mode")
    token     = request.query_params.get("hub.verify_token")
    challenge = request.query_params.get("hub.challenge")
    if mode == "subscribe" and token == _WA_VERIFY_TOKEN:
        logger.info("[WA] Webhook verified by Meta")
        return PlainTextResponse(challenge)
    raise HTTPException(status_code=403, detail="Verification failed")


_N8N_INCOMING_URL = "http://localhost:5678/webhook/whatsapp-incoming"


@router.post("/whatsapp/webhook")
async def wa_incoming(request: Request):
    """Receive incoming Meta Cloud API events. Log + forward to n8n for processing."""
    body = {}
    try:
        body = await request.json()
        text = ""
        try:
            entry    = body.get("entry", [{}])[0]
            changes  = entry.get("changes", [{}])[0]
            value    = changes.get("value", {})
            messages = value.get("messages", [])
            if messages:
                msg  = messages[0]
                text = msg.get("text", {}).get("body", "") or msg.get("type", "")
        except Exception:
            pass
        logger.info(f"[WA] Incoming: {text!r}")
    except Exception as e:
        logger.warning(f"[WA] Incoming parse error: {e}")

    # Forward to n8n for command processing (fire-and-forget)
    async def _forward():
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                await client.post(_N8N_INCOMING_URL, json=body)
        except Exception as _fe:
            logger.warning(f"[WA] n8n forward failed: {_fe}")

    asyncio.create_task(_forward())
    return {"status": "ok"}


@router.get("/whatsapp/eod-summary")
async def wa_eod_summary(x_verify_token: str = Header(default="")):
    """
    EOD P&L summary for n8n WhatsApp report trigger.
    Protected by X-Verify-Token header matching WA_VERIFY_TOKEN.
    """
    if x_verify_token != _WA_VERIFY_TOKEN:
        raise HTTPException(status_code=403, detail="Forbidden")

    from app.core.database import AsyncSessionLocal
    from app.models.order import Order, OrderStatus
    from sqlalchemy import select, func

    now_ist         = datetime.now(IST)
    today_start_ist = now_ist.replace(hour=0, minute=0, second=0, microsecond=0)
    today_start_utc = today_start_ist.astimezone(timezone.utc)
    today_end_utc   = today_start_utc + timedelta(days=1)

    async with AsyncSessionLocal() as db:
        closed_q = await db.execute(
            select(Order).where(
                Order.status == OrderStatus.CLOSED,
                Order.exit_time >= today_start_utc,
                Order.exit_time < today_end_utc,
                Order.is_practix == False,
            )
        )
        closed_orders = closed_q.scalars().all()

        error_q = await db.execute(
            select(func.count(Order.id)).where(
                Order.status == OrderStatus.ERROR,
                Order.created_at >= today_start_utc,
                Order.created_at < today_end_utc,
            )
        )
        errors = error_q.scalar() or 0

        open_q = await db.execute(
            select(func.count(Order.id)).where(
                Order.status == OrderStatus.OPEN,
                Order.is_practix == False,
            )
        )
        open_positions = open_q.scalar() or 0

    day_pnl      = sum(o.pnl or 0 for o in closed_orders)
    total_trades = len(set(o.grid_entry_id for o in closed_orders))
    wins         = sum(1 for o in closed_orders if (o.pnl or 0) > 0)
    losses       = sum(1 for o in closed_orders if (o.pnl or 0) < 0)
    sl_hits      = sum(1 for o in closed_orders if o.exit_reason == "sl")

    algo_pnl: dict = {}
    for o in closed_orders:
        aid = str(o.algo_id)
        algo_pnl[aid] = algo_pnl.get(aid, 0) + (o.pnl or 0)

    best_algo  = max(algo_pnl, key=algo_pnl.get) if algo_pnl else None
    worst_algo = min(algo_pnl, key=algo_pnl.get) if algo_pnl else None

    sign = "+" if day_pnl >= 0 else ""
    msg = (
        f"EOD SUMMARY - {now_ist.strftime('%d %b %Y')}\n"
        f"Day P&L: {sign}Rs{day_pnl:,.0f}\n"
        f"Trades: {total_trades}  Wins: {wins}  Losses: {losses}\n"
        f"SL hits: {sl_hits}  Errors: {errors}\n"
        f"Open positions: {open_positions}\n"
        f"Best: {best_algo or '-'}  Worst: {worst_algo or '-'}"
    )

    return {
        "day_pnl":        round(day_pnl, 2),
        "total_trades":   total_trades,
        "wins":           wins,
        "losses":         losses,
        "sl_hits":        sl_hits,
        "errors":         errors,
        "best_algo":      best_algo,
        "worst_algo":     worst_algo,
        "open_positions": open_positions,
        "message":        msg,
        "date":           now_ist.strftime("%Y-%m-%d"),
    }
