"""
Telegram webhook router.

Endpoints:
  POST /api/v1/telegram/webhook  — Incoming Telegram updates (commands)
"""
import logging
import os
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Request

from app.engine.tg_notifier import tg_notifier

logger = logging.getLogger(__name__)
router = APIRouter()

IST = ZoneInfo("Asia/Kolkata")

_COMMANDS = (
    "/health   — Engine + feed status\n"
    "/positions — Open positions\n"
    "/pnl      — Today's P&L summary\n"
    "/errors   — Recent error orders\n"
    "/eod      — EOD summary\n"
    "/menu     — Show this menu"
)


async def _reply(text: str) -> None:
    await tg_notifier.send(text)


@router.post("/telegram/webhook")
async def tg_incoming(request: Request):
    """Receive Telegram updates and respond to commands."""
    try:
        body = await request.json()
    except Exception:
        return {"ok": True}

    try:
        msg  = body.get("message") or body.get("edited_message", {})
        text = (msg.get("text") or "").strip()
        cmd  = text.split()[0].lower() if text else ""

        if cmd == "/health":
            await _handle_health()
        elif cmd == "/positions":
            await _handle_positions()
        elif cmd == "/pnl":
            await _handle_pnl()
        elif cmd == "/errors":
            await _handle_errors()
        elif cmd == "/eod":
            await _handle_eod()
        elif cmd in ("/menu", "/start"):
            await _reply(f"<b>STAAX Commands</b>\n\n{_COMMANDS}")
        elif text:
            await _reply(f"Unknown command: <code>{cmd}</code>\n\n{_COMMANDS}")
    except Exception as e:
        logger.error(f"[TG] command handling error: {e}")

    return {"ok": True}


async def _handle_health():
    from app.engine.broker_reconnect import broker_reconnect_manager, circuit_breaker
    status = broker_reconnect_manager.get_status()
    cb     = circuit_breaker.get_status()
    ws     = status.get("ws_connected")
    age    = status.get("feed_age_seconds")
    age_s  = f"{age:.0f}s" if age is not None else "unknown"
    entries = "ALLOWED" if cb["entries_allowed"] else f"DISABLED ({cb['disabled_reason']})"

    lines = [
        "<b>ENGINE HEALTH</b>",
        f"WS connected: {ws}",
        f"Feed age: {age_s}",
        f"Entries: {entries}",
        f"Reconnects: {status['reconnect_count']}",
        f"Consecutive failures: {status['consecutive_failures']}",
    ]
    await _reply("\n".join(lines))


async def _handle_positions():
    import httpx
    async with httpx.AsyncClient(timeout=5.0) as client:
        resp = await client.get("http://localhost:8000/api/v1/orders/open-positions")
        data = resp.json()

    groups = data.get("open_positions", [])
    if not groups:
        await _reply("<b>POSITIONS</b>\n\nNo open positions.")
        return

    total_pnl = sum(g.get("pnl") or 0 for g in groups)
    sign      = "+" if total_pnl >= 0 else ""
    lines     = [f"<b>OPEN POSITIONS ({len(groups)} algos)</b>"]
    for g in groups[:15]:
        pnl  = g.get("pnl") or 0
        psign = "+" if pnl >= 0 else ""
        tag  = " [P]" if any(o.get("is_practix") for o in g.get("orders", [])) else ""
        lines.append(
            f"• {g['algo_name']}{tag} | {g['open_count']} pos | {psign}Rs{pnl:,.0f}"
        )
    if len(groups) > 15:
        lines.append(f"... and {len(groups) - 15} more")
    lines.append(f"\nTotal P&amp;L: {sign}Rs{total_pnl:,.0f}")
    await _reply("\n".join(lines))


async def _handle_pnl():
    from app.core.database import AsyncSessionLocal
    from app.models.order import Order, OrderStatus
    from sqlalchemy import select

    now_ist         = datetime.now(IST)
    today_start_ist = now_ist.replace(hour=0, minute=0, second=0, microsecond=0)
    today_start_utc = today_start_ist.astimezone(timezone.utc)
    today_end_utc   = today_start_utc + timedelta(days=1)

    async with AsyncSessionLocal() as db:
        q = await db.execute(
            select(Order).where(
                Order.status == OrderStatus.CLOSED,
                Order.exit_time >= today_start_utc,
                Order.exit_time < today_end_utc,
                Order.is_practix == False,
            )
        )
        closed = q.scalars().all()

    day_pnl = sum(o.pnl or 0 for o in closed)
    wins    = sum(1 for o in closed if (o.pnl or 0) > 0)
    losses  = sum(1 for o in closed if (o.pnl or 0) < 0)
    sign    = "+" if day_pnl >= 0 else ""

    lines = [
        f"<b>P&amp;L — {now_ist.strftime('%d %b %Y')}</b>",
        f"Day P&amp;L: {sign}Rs{day_pnl:,.0f}",
        f"Trades: {len(closed)}  Wins: {wins}  Losses: {losses}",
    ]
    await _reply("\n".join(lines))


async def _handle_errors():
    from app.core.database import AsyncSessionLocal
    from app.models.order import Order, OrderStatus
    from sqlalchemy import select

    now_ist         = datetime.now(IST)
    today_start_ist = now_ist.replace(hour=0, minute=0, second=0, microsecond=0)
    today_start_utc = today_start_ist.astimezone(timezone.utc)
    today_end_utc   = today_start_utc + timedelta(days=1)

    async with AsyncSessionLocal() as db:
        q = await db.execute(
            select(Order).where(
                Order.status == OrderStatus.ERROR,
                Order.created_at >= today_start_utc,
                Order.created_at < today_end_utc,
            ).order_by(Order.created_at.desc()).limit(10)
        )
        errors = q.scalars().all()

    if not errors:
        await _reply("<b>ERRORS</b>\n\nNo error orders today.")
        return

    lines = [f"<b>ERROR ORDERS ({len(errors)})</b>"]
    for o in errors:
        t = o.created_at.astimezone(IST).strftime("%H:%M") if o.created_at else "-"
        lines.append(f"• {t} {o.symbol} — {o.error_reason or 'unknown'}")
    await _reply("\n".join(lines))


async def _handle_eod():
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
    sign         = "+" if day_pnl >= 0 else ""

    lines = [
        f"<b>EOD SUMMARY — {now_ist.strftime('%d %b %Y')}</b>",
        f"Day P&amp;L: {sign}Rs{day_pnl:,.0f}",
        f"Trades: {total_trades}  Wins: {wins}  Losses: {losses}",
        f"SL hits: {sl_hits}  Errors: {errors}",
        f"Open positions: {open_positions}",
    ]
    await _reply("\n".join(lines))
