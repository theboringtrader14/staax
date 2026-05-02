"""
Telegram webhook router — inline keyboard bot.

Endpoints:
  POST /api/v1/telegram/webhook  — Incoming Telegram updates (messages + callback_query)
"""
import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import httpx
import redis.asyncio as aioredis
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select, func

from app.core.database import AsyncSessionLocal
from app.models.order import Order, OrderStatus

logger = logging.getLogger(__name__)
router = APIRouter()

IST = ZoneInfo("Asia/Kolkata")

_TG_TOKEN    = os.getenv("TG_BOT_TOKEN", "")
_TG_CHAT_ID  = os.getenv("TG_CHAT_ID", "")
TG_API       = f"https://api.telegram.org/bot{_TG_TOKEN}"
ALLOWED_CHAT  = str(_TG_CHAT_ID)

# ─── Redis (lazy init) ────────────────────────────────────────────────────────

_redis = None

async def _get_redis():
    global _redis
    if _redis is None:
        _redis = aioredis.from_url("redis://localhost:6379", decode_responses=True)
    return _redis


# ─── Keyboard builders ────────────────────────────────────────────────────────

def kb_main():
    return [
        [
            {"text": "📊 Trades",  "callback_data": "menu_trades"},
            {"text": "⚙️ System",  "callback_data": "menu_system"},
            {"text": "📈 Reports", "callback_data": "menu_reports"},
        ]
    ]

def kb_trades():
    return [
        [
            {"text": "📈 Positions",   "callback_data": "cmd_positions"},
            {"text": "💰 P&L Today",   "callback_data": "cmd_pnl"},
        ],
        [
            {"text": "⚠️ Errors",      "callback_data": "cmd_errors"},
            {"text": "🔁 Retry Errors","callback_data": "cmd_retry_list"},
        ],
        [{"text": "🔙 Main Menu", "callback_data": "menu_main"}],
    ]

def kb_system():
    return [
        [
            {"text": "🟢 Health",     "callback_data": "cmd_health"},
            {"text": "🚨 Kill Switch","callback_data": "cmd_kill_confirm"},
        ],
        [{"text": "🔙 Main Menu", "callback_data": "menu_main"}],
    ]

def kb_reports():
    return [
        [
            {"text": "📊 EOD Summary","callback_data": "cmd_eod"},
            {"text": "❌ Error Log",  "callback_data": "cmd_errors"},
        ],
        [{"text": "🔙 Main Menu", "callback_data": "menu_main"}],
    ]

def kb_kill_confirm():
    return [[{"text": "❌ Cancel", "callback_data": "menu_system"}]]

def kb_back_trades():
    return [[{"text": "🔙 Trades", "callback_data": "menu_trades"}]]

def kb_view_trades():
    return [[{"text": "📊 View Trades", "callback_data": "cmd_positions"}]]

def kb_health_check():
    return [[{"text": "🟢 Health Check", "callback_data": "cmd_health"}]]

def kb_eod():
    return [[{"text": "📊 Full Report", "callback_data": "cmd_eod"}]]


# ─── Send helpers ─────────────────────────────────────────────────────────────

async def tg_send(chat_id: str, text: str, keyboard: list = None):
    payload = {"chat_id": chat_id, "text": text, "parse_mode": "HTML"}
    if keyboard:
        payload["reply_markup"] = {"inline_keyboard": keyboard}
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            await client.post(f"{TG_API}/sendMessage", json=payload)
        except Exception as e:
            logger.error(f"[TG] send failed: {e}")


async def tg_edit(chat_id: str, message_id: int, text: str, keyboard: list = None):
    payload = {
        "chat_id":    chat_id,
        "message_id": message_id,
        "text":       text,
        "parse_mode": "HTML",
    }
    if keyboard is not None:
        payload["reply_markup"] = {"inline_keyboard": keyboard}
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            r = await client.post(f"{TG_API}/editMessageText", json=payload)
            data = r.json()
            if not data.get("ok"):
                logger.warning(
                    f"tg_edit failed ({data.get('error_code')}): {data.get('description')} "
                    f"— chat={chat_id} msg={message_id} preview={text[:40]!r} — falling back to send"
                )
                await tg_send(chat_id, text, keyboard)
        except Exception as e:
            logger.error(f"[TG] edit exception: {e} — falling back to send")
            await tg_send(chat_id, text, keyboard)


async def tg_answer(callback_query_id: str, text: str = ""):
    async with httpx.AsyncClient(timeout=3.0) as client:
        try:
            await client.post(f"{TG_API}/answerCallbackQuery",
                json={"callback_query_id": callback_query_id, "text": text})
        except Exception:
            pass


# ─── Command handlers (return str) ────────────────────────────────────────────

async def handle_health() -> str:
    from app.engine.broker_reconnect import broker_reconnect_manager, circuit_breaker
    status  = broker_reconnect_manager.get_status()
    cb      = circuit_breaker.get_status()
    ws      = status.get("ws_connected")
    age     = status.get("feed_age_seconds")
    age_s   = f"{age:.0f}s" if age is not None else "unknown"
    entries = "ALLOWED" if cb["entries_allowed"] else f"DISABLED ({cb['disabled_reason']})"
    return "\n".join([
        "<b>ENGINE HEALTH</b>",
        f"WS connected: {ws}",
        f"Feed age: {age_s}",
        f"Entries: {entries}",
        f"Reconnects: {status['reconnect_count']}",
        f"Consecutive failures: {status['consecutive_failures']}",
    ])


async def handle_positions() -> str:
    async with httpx.AsyncClient(timeout=5.0) as client:
        resp = await client.get("http://localhost:8000/api/v1/orders/open-positions")
        data = resp.json()

    groups = data.get("open_positions", [])
    if not groups:
        return "<b>POSITIONS</b>\n\nNo open positions."

    total_pnl = sum(g.get("pnl") or 0 for g in groups)
    sign      = "+" if total_pnl >= 0 else ""
    lines     = [f"<b>OPEN POSITIONS ({len(groups)} algos)</b>"]
    for g in groups[:15]:
        pnl   = g.get("pnl") or 0
        psign = "+" if pnl >= 0 else ""
        tag   = " [P]" if any(o.get("is_practix") for o in g.get("orders", [])) else ""
        lines.append(f"• {g['algo_name']}{tag} | {g['open_count']} pos | {psign}Rs{pnl:,.0f}")
    if len(groups) > 15:
        lines.append(f"... and {len(groups) - 15} more")
    lines.append(f"\nTotal P&amp;L: {sign}Rs{total_pnl:,.0f}")
    return "\n".join(lines)


async def handle_pnl() -> str:
    now_ist         = datetime.now(IST)
    today_start_ist = now_ist.replace(hour=0, minute=0, second=0, microsecond=0)
    today_start_utc = today_start_ist.astimezone(timezone.utc)
    today_end_utc   = today_start_utc + timedelta(days=1)

    async with AsyncSessionLocal() as db:
        q = await db.execute(
            select(Order).where(
                Order.status == OrderStatus.CLOSED,
                Order.exit_time >= today_start_utc,
                Order.exit_time <  today_end_utc,
                Order.is_practix == False,
            )
        )
        closed = q.scalars().all()

    day_pnl = sum(o.pnl or 0 for o in closed)
    wins    = sum(1 for o in closed if (o.pnl or 0) > 0)
    losses  = sum(1 for o in closed if (o.pnl or 0) < 0)
    sign    = "+" if day_pnl >= 0 else ""
    return "\n".join([
        f"<b>P&amp;L — {now_ist.strftime('%d %b %Y')}</b>",
        f"Day P&amp;L: {sign}Rs{day_pnl:,.0f}",
        f"Trades: {len(closed)}  Wins: {wins}  Losses: {losses}",
    ])


async def handle_eod() -> str:
    now_ist         = datetime.now(IST)
    today_start_ist = now_ist.replace(hour=0, minute=0, second=0, microsecond=0)
    today_start_utc = today_start_ist.astimezone(timezone.utc)
    today_end_utc   = today_start_utc + timedelta(days=1)

    async with AsyncSessionLocal() as db:
        closed_q = await db.execute(
            select(Order).where(
                Order.status == OrderStatus.CLOSED,
                Order.exit_time >= today_start_utc,
                Order.exit_time <  today_end_utc,
                Order.is_practix == False,
            )
        )
        closed_orders = closed_q.scalars().all()

        error_cnt = (await db.execute(
            select(func.count(Order.id)).where(
                Order.status == OrderStatus.ERROR,
                Order.created_at >= today_start_utc,
                Order.created_at <  today_end_utc,
            )
        )).scalar() or 0

        open_cnt = (await db.execute(
            select(func.count(Order.id)).where(
                Order.status == OrderStatus.OPEN,
                Order.is_practix == False,
            )
        )).scalar() or 0

    day_pnl      = sum(o.pnl or 0 for o in closed_orders)
    total_trades = len(set(o.grid_entry_id for o in closed_orders))
    wins         = sum(1 for o in closed_orders if (o.pnl or 0) > 0)
    losses       = sum(1 for o in closed_orders if (o.pnl or 0) < 0)
    sl_hits      = sum(1 for o in closed_orders if o.exit_reason == "sl")
    sign         = "+" if day_pnl >= 0 else ""
    return "\n".join([
        f"<b>EOD SUMMARY — {now_ist.strftime('%d %b %Y')}</b>",
        f"Day P&amp;L: {sign}Rs{day_pnl:,.0f}",
        f"Trades: {total_trades}  Wins: {wins}  Losses: {losses}",
        f"SL hits: {sl_hits}  Errors: {error_cnt}",
        f"Open positions: {open_cnt}",
    ])


async def handle_errors() -> tuple:
    """Returns (formatted_text, list_of_error_dicts)."""
    now_ist         = datetime.now(IST)
    today_start_ist = now_ist.replace(hour=0, minute=0, second=0, microsecond=0)
    today_start_utc = today_start_ist.astimezone(timezone.utc)
    today_end_utc   = today_start_utc + timedelta(days=1)

    async with AsyncSessionLocal() as db:
        q = await db.execute(
            select(Order).where(
                Order.status == OrderStatus.ERROR,
                Order.created_at >= today_start_utc,
                Order.created_at <  today_end_utc,
            ).order_by(Order.created_at.desc()).limit(10)
        )
        orders = q.scalars().all()

    if not orders:
        return "✅ No errors today.", []

    errors = []
    lines  = ["❌ <b>Error Orders</b>", "━━━━━━━━━━━━━━━"]
    for o in orders:
        t = o.created_at.astimezone(IST).strftime("%H:%M") if o.created_at else "-"
        lines.append(
            f"<b>{o.algo_tag or 'Unknown'}</b> · {t}\n"
            f"<code>{(o.error_message or 'No detail')[:80]}</code>"
        )
        errors.append({
            "grid_entry_id": str(o.grid_entry_id) if o.grid_entry_id else None,
            "algo_name":     o.algo_tag or "Unknown",
            "account":       str(o.account_id),
        })
    return "\n".join(lines), errors


async def handle_retry_list() -> tuple:
    """Returns (text, keyboard) with one retry button per error entry."""
    text, errors = await handle_errors()
    if not errors:
        return "✅ No errors to retry.", [[{"text": "🔙 Trades", "callback_data": "menu_trades"}]]

    keyboard = []
    for err in errors[:8]:
        if err["grid_entry_id"]:
            keyboard.append([{
                "text": f"🔁 Retry {err['algo_name']}",
                "callback_data": f"retry_{err['grid_entry_id']}",
            }])
    keyboard.append([{"text": "🔙 Trades", "callback_data": "menu_trades"}])

    msg = "🔁 <b>Retry Error Orders</b>\n━━━━━━━━━━━━━━━\nTap to retry individual algos:"
    return msg, keyboard


async def handle_retry_execute(grid_entry_id: str) -> str:
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            res = await client.post(
                f"http://localhost:8000/api/v1/orders/{grid_entry_id}/retry"
            )
            if res.status_code == 200:
                data = res.json()
                return f"✅ <b>Retry triggered</b>\n{data.get('message', 'Retry started.')}"
            return f"❌ Retry failed: {res.status_code}\n<code>{res.text[:100]}</code>"
        except Exception as e:
            return f"❌ Retry error: {str(e)[:100]}"


async def handle_kill_switch() -> str:
    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            res = await client.post(
                "http://localhost:8000/api/v1/system/kill-switch",
                json={"account_ids": []},
            )
            if res.status_code == 200:
                data = res.json()
                return (
                    "🚨 <b>Kill Switch Activated</b>\n"
                    "━━━━━━━━━━━━━━━\n"
                    f"Status: {data.get('status', 'done')}\n"
                    f"{data.get('message', '')}"
                )
            return f"❌ Kill switch failed: {res.status_code}"
        except Exception as e:
            return f"❌ Kill switch error: {str(e)[:100]}"


# ─── Callback router ──────────────────────────────────────────────────────────

async def handle_callback(chat_id: str, message_id: int, callback_id: str, data: str):
    await tg_answer(callback_id)

    if data == "menu_main":
        await tg_edit(chat_id, message_id,
            "LIFEX OS 🔶\n━━━━━━━━━━━━━━━\nWhat would you like to check?",
            kb_main())

    elif data == "menu_trades":
        await tg_edit(chat_id, message_id,
            "📊 <b>Trades</b>\nSelect an option:", kb_trades())

    elif data == "menu_system":
        await tg_edit(chat_id, message_id,
            "⚙️ <b>System</b>\nSelect an option:", kb_system())

    elif data == "menu_reports":
        await tg_edit(chat_id, message_id,
            "📈 <b>Reports</b>\nSelect an option:", kb_reports())

    elif data == "cmd_health":
        text = await handle_health()
        await tg_edit(chat_id, message_id, text, kb_system())

    elif data == "cmd_positions":
        text = await handle_positions()
        await tg_edit(chat_id, message_id, text, kb_back_trades())

    elif data == "cmd_pnl":
        text = await handle_pnl()
        await tg_edit(chat_id, message_id, text, kb_back_trades())

    elif data == "cmd_errors":
        text, _ = await handle_errors()
        await tg_edit(chat_id, message_id, text, [
            [{"text": "🔁 Retry Errors", "callback_data": "cmd_retry_list"}],
            [{"text": "🔙 Trades",        "callback_data": "menu_trades"}],
        ])

    elif data == "cmd_eod":
        text = await handle_eod()
        await tg_edit(chat_id, message_id, text,
            [[{"text": "🔙 Reports", "callback_data": "menu_reports"}]])

    elif data == "cmd_retry_list":
        text, keyboard = await handle_retry_list()
        await tg_edit(chat_id, message_id, text, keyboard)

    elif data.startswith("retry_"):
        grid_entry_id = data[len("retry_"):]
        await tg_edit(chat_id, message_id,
            f"🔄 Retrying <code>{grid_entry_id[:8]}…</code>", [])
        result = await handle_retry_execute(grid_entry_id)
        await tg_send(chat_id, result, [
            [{"text": "🔁 Retry More",    "callback_data": "cmd_retry_list"},
             {"text": "📊 Positions",     "callback_data": "cmd_positions"}],
        ])

    elif data == "cmd_kill_confirm":
        redis = await _get_redis()
        await redis.setex(f"tg:kill_pending:{chat_id}", 120, "1")
        await tg_edit(chat_id, message_id,
            "⚠️ <b>Kill Switch</b>\n"
            "━━━━━━━━━━━━━━━\n"
            "This will square off <b>ALL</b> open positions.\n\n"
            "Type exactly:\n<code>CONFIRM KILL</code>\n\n"
            "Code expires in 2 minutes.",
            kb_kill_confirm())

    else:
        await tg_edit(chat_id, message_id,
            f"Unknown action: <code>{data}</code>", kb_main())


# ─── Message router ───────────────────────────────────────────────────────────

async def handle_message(chat_id: str, text: str):
    text = text.strip()

    # Kill switch confirmation
    if text.upper() == "CONFIRM KILL":
        redis = await _get_redis()
        pending = await redis.get(f"tg:kill_pending:{chat_id}")
        if pending:
            await redis.delete(f"tg:kill_pending:{chat_id}")
            result = await handle_kill_switch()
            await tg_send(chat_id, result, kb_main())
        else:
            await tg_send(chat_id,
                "⚠️ No pending kill switch.\nUse the menu to initiate.", kb_main())
        return

    cmd = text.lower().split()[0] if text else ""

    if cmd in ["/start", "/menu", "hi", "hello", "menu"]:
        await tg_send(chat_id,
            "LIFEX OS 🔶\n━━━━━━━━━━━━━━━\nWhat would you like to check?",
            kb_main())

    elif cmd == "/health":
        await tg_send(chat_id, await handle_health(), kb_system())

    elif cmd == "/positions":
        await tg_send(chat_id, await handle_positions(), kb_back_trades())

    elif cmd == "/pnl":
        await tg_send(chat_id, await handle_pnl(), kb_back_trades())

    elif cmd == "/errors":
        t, _ = await handle_errors()
        await tg_send(chat_id, t, [
            [{"text": "🔁 Retry Errors", "callback_data": "cmd_retry_list"}],
            [{"text": "🔙 Main Menu",    "callback_data": "menu_main"}],
        ])

    elif cmd == "/retry":
        t, keyboard = await handle_retry_list()
        await tg_send(chat_id, t, keyboard)

    elif cmd == "/eod":
        await tg_send(chat_id, await handle_eod(), kb_main())

    elif cmd == "/kill":
        redis = await _get_redis()
        await redis.setex(f"tg:kill_pending:{chat_id}", 120, "1")
        await tg_send(chat_id,
            "⚠️ <b>Kill Switch</b>\n"
            "━━━━━━━━━━━━━━━\n"
            "This will square off <b>ALL</b> open positions.\n\n"
            "Type exactly:\n<code>CONFIRM KILL</code>\n\n"
            "Code expires in 2 minutes.",
            kb_kill_confirm())

    else:
        await tg_send(chat_id,
            f"Unknown command: <code>{text[:30]}</code>\nUse the menu to navigate:",
            kb_main())


# ─── Webhook endpoint ─────────────────────────────────────────────────────────

@router.post("/telegram/webhook")
async def telegram_webhook(request: Request):
    """Main Telegram webhook — handles messages and callback_query."""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"ok": True})

    # ── callback_query (button tap) ───────────────────────────────────────────
    cq = body.get("callback_query")
    if cq:
        chat_id = str(
            cq.get("from", {}).get("id") or
            cq.get("message", {}).get("chat", {}).get("id", "")
        )
        if ALLOWED_CHAT and chat_id != ALLOWED_CHAT:
            return JSONResponse({"ok": True})

        message_id  = cq.get("message", {}).get("message_id")
        callback_id = cq.get("id", "")
        data        = cq.get("data", "")
        asyncio.create_task(handle_callback(chat_id, message_id, callback_id, data))
        return JSONResponse({"ok": True})

    # ── regular message ───────────────────────────────────────────────────────
    msg = body.get("message") or body.get("edited_message", {})
    if msg:
        chat_id = str(msg.get("chat", {}).get("id", ""))
        if ALLOWED_CHAT and chat_id != ALLOWED_CHAT:
            return JSONResponse({"ok": True})

        text = (msg.get("text") or "").strip()
        if text:
            asyncio.create_task(handle_message(chat_id, text))

    return JSONResponse({"ok": True})
