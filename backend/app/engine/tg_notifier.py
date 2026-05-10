import asyncio
import logging
import os
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx

logger = logging.getLogger(__name__)
IST = ZoneInfo("Asia/Kolkata")

_TG_API = "https://api.telegram.org/bot{token}/sendMessage"


class TGNotifier:
    def __init__(self):
        self._token   = os.getenv("TG_BOT_TOKEN", "")
        self._chat_id = os.getenv("TG_CHAT_ID", "")
        self._pending_entries: dict = {}  # algo_name → {"legs": []}
        self._polling: bool = False
        self._offset:  int  = 0

    async def send(self, text: str, reply_markup: dict = None) -> None:
        if not self._token or not self._chat_id:
            return
        url = _TG_API.format(token=self._token)
        payload = {"chat_id": self._chat_id, "text": text, "parse_mode": "HTML"}
        if reply_markup:
            payload["reply_markup"] = reply_markup
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.post(url, json=payload)
                logger.info(f"[TG] send → status {resp.status_code}")
        except Exception as e:
            logger.error(f"[TG ERROR] send: {e}")

    _KEYBOARDS = {
        "entry_executed": {"inline_keyboard": [[{"text": "📍 View Trades",  "callback_data": "cmd_positions"}]]},
        "exit_executed":  {"inline_keyboard": [[{"text": "📍 View Trades",  "callback_data": "cmd_positions"}]]},
        "sl_hit":         {"inline_keyboard": [[{"text": "📍 View Trades",  "callback_data": "cmd_positions"}]]},
        "tp_hit":         {"inline_keyboard": [[{"text": "📍 View Trades",  "callback_data": "cmd_positions"}]]},
        "feed_down":      {"inline_keyboard": [[{"text": "💚 Health Check", "callback_data": "cmd_health"}]]},
        "feed_up":        {"inline_keyboard": [[{"text": "💚 Health Check", "callback_data": "cmd_health"}]]},
    }

    async def _flush_entry(self, algo_name: str) -> None:
        """Aggregation window: collect all legs for 5s, then send one message."""
        await asyncio.sleep(5)
        data = self._pending_entries.pop(algo_name, None)
        if not data:
            return
        legs = data.get("legs", [])
        if not legs:
            return
        ts  = datetime.now(IST).strftime("%H:%M:%S IST")
        msg = f"✅ <b>{algo_name}</b> — Entry\n"
        for leg in legs:
            sym = leg.get("symbol") or "-"
            fp  = leg.get("fill_price") or 0
            try:
                msg += f"  • {sym} @ ₹{float(fp):.2f}\n"
            except (TypeError, ValueError):
                msg += f"  • {sym}\n"
        msg += f"<i>{ts}</i>"
        kb = self._KEYBOARDS.get("entry_executed")
        await self.send(msg, reply_markup=kb)

    async def _fetch_eod_data(self) -> dict:
        from app.core.database import AsyncSessionLocal
        from app.models.order import Order, OrderStatus
        from sqlalchemy import select, and_, func, cast
        from sqlalchemy.types import Date

        today_ist = datetime.now(IST).date()

        async with AsyncSessionLocal() as db:
            closed = (await db.execute(
                select(Order).where(
                    and_(
                        Order.status == OrderStatus.CLOSED,
                        cast(func.timezone("Asia/Kolkata", Order.updated_at), Date) == today_ist,
                    )
                )
            )).scalars().all()

            errors = (await db.execute(
                select(Order).where(
                    and_(
                        Order.status == OrderStatus.ERROR,
                        cast(func.timezone("Asia/Kolkata", Order.created_at), Date) == today_ist,
                    )
                )
            )).scalars().all()

            open_orders = (await db.execute(
                select(Order).where(Order.status == OrderStatus.OPEN)
            )).scalars().all()

        day_pnl = sum(o.pnl or 0 for o in closed)
        wins    = sum(1 for o in closed if (o.pnl or 0) > 0)
        losses  = sum(1 for o in closed if (o.pnl or 0) < 0)
        sl_hits = sum(1 for o in closed if o.exit_reason == "sl")

        algo_pnl: dict = {}
        for o in closed:
            name = o.algo_tag or "Unknown"
            algo_pnl[name] = algo_pnl.get(name, 0) + (o.pnl or 0)

        best  = max(algo_pnl, key=algo_pnl.get) if algo_pnl else None
        worst = min(algo_pnl, key=algo_pnl.get) if algo_pnl else None

        error_lines = []
        for e in errors[:3]:
            error_lines.append(
                f"  • {e.algo_tag or 'Unknown'}: {(e.error_message or 'error')[:50]}"
            )

        return {
            "day_pnl":        day_pnl,
            "total_trades":   len(set(o.grid_entry_id for o in closed)),
            "wins":           wins,
            "losses":         losses,
            "sl_hits":        sl_hits,
            "error_count":    len(errors),
            "error_lines":    error_lines,
            "open_positions": len(open_orders),
            "best_algo":      f"{best} (+₹{algo_pnl[best]:,.0f})" if best else "—",
            "worst_algo":     f"{worst} (-₹{abs(algo_pnl[worst]):,.0f})" if worst and algo_pnl[worst] < 0 else "—",
        }

    async def notify(self, event_type: str, payload: dict) -> None:
        if event_type == "eod_report":
            try:
                data    = await self._fetch_eod_data()
                pnl     = data["day_pnl"]
                pnl_str = f"+₹{pnl:,.0f}" if pnl >= 0 else f"-₹{abs(pnl):,.0f}"
                msg = (
                    f"📊 <b>EOD Report</b>\n"
                    f"━━━━━━━━━━━━━━━\n"
                    f"Day P&amp;L: {pnl_str}\n"
                    f"Trades: {data['total_trades']} | W:{data['wins']} L:{data['losses']}\n"
                    f"SL hits: {data['sl_hits']} | Open: {data['open_positions']}\n"
                    f"Best: {data['best_algo']}\n"
                    f"Worst: {data['worst_algo']}\n"
                )
                if data["error_count"] > 0:
                    msg += f"\n❌ Errors ({data['error_count']}):\n"
                    msg += "\n".join(data["error_lines"])
                else:
                    msg += "\n✅ No errors today"
            except Exception as e:
                logger.error(f"EOD data fetch failed: {e}")
                msg = "📊 EOD Report\nData unavailable — check backend."
            await self.send(msg, reply_markup=None)
            return

        # Aggregate entry notifications per algo — one message after 5s window
        if event_type == "entry_executed":
            algo_name = payload.get("algo_name", "Unknown")
            if algo_name not in self._pending_entries:
                self._pending_entries[algo_name] = {"legs": []}
                asyncio.create_task(self._flush_entry(algo_name))
            self._pending_entries[algo_name]["legs"].append({
                "symbol":     payload.get("symbol"),
                "fill_price": payload.get("fill_price"),
            })
            return

        ts  = datetime.now(IST).strftime("%H:%M:%S IST")
        msg = self._format(event_type, payload, ts)
        if msg:
            kb = self._KEYBOARDS.get(event_type)
            await self.send(msg, reply_markup=kb)

    @staticmethod
    def _format(event_type: str, payload: dict, ts: str) -> str:
        if event_type == "entry_executed":
            sign = "BUY" if payload.get("lots", 0) >= 0 else "SELL"
            return (
                f"✅ <b>ENTRY</b>\n"
                f"Algo: {payload.get('algo_name', '-')}\n"
                f"Symbol: {payload.get('symbol', '-')}\n"
                f"Fill: {payload.get('fill_price', 0):.2f}\n"
                f"Lots: {payload.get('lots', '-')}\n"
                f"<i>{ts}</i>"
            )
        if event_type == "exit_executed":
            pnl    = payload.get("pnl", 0)
            reason = payload.get("exit_reason", "exit_time")
            reason_label = {
                "sl":              "🔴 SL Hit",
                "sl_hit":          "🔴 SL Hit",
                "tp":              "🎯 TP Hit",
                "tp_hit":          "🎯 TP Hit",
                "auto_sq":         "🏁 Exit Time",
                "btst_exit":       "🏁 BTST Exit",
                "stbt_exit":       "🏁 STBT Exit",
                "terminate":       "⛔ Manual SQ",
                "sq":              "⛔ Manual SQ",
                "global_sl":       "🔴 Global SL",
                "mslc":            "🔄 MSLC",
                "kill_switch":     "⛔ Kill Switch",
                "stale_exit_recovery": "🔧 Recovery",
            }.get(reason, f"🏁 {reason}")
            pnl_str = f"+₹{pnl:,.0f}" if pnl >= 0 else f"-₹{abs(pnl):,.0f}"
            return (
                f"{reason_label} — <b>{payload.get('algo_name', '-')}</b>\n"
                f"P&amp;L: {pnl_str}\n"
                f"<i>{ts}</i>"
            )
        if event_type == "sl_hit":
            pnl  = payload.get("pnl", 0)
            sign = "+" if pnl >= 0 else ""
            return (
                f"🔴 <b>SL HIT</b>\n"
                f"Algo: {payload.get('algo_name', '-')}\n"
                f"Account: {payload.get('account', '-')}\n"
                f"Exit: {payload.get('exit_price', 0):.2f}\n"
                f"P&amp;L: {sign}Rs{pnl:,.0f}\n"
                f"<i>{ts}</i>"
            )
        if event_type == "tp_hit":
            pnl  = payload.get("pnl", 0)
            sign = "+" if pnl >= 0 else ""
            return (
                f"🎯 <b>TARGET HIT</b>\n"
                f"Algo: {payload.get('algo_name', '-')}\n"
                f"Account: {payload.get('account', '-')}\n"
                f"Exit: {payload.get('exit_price', 0):.2f}\n"
                f"P&amp;L: {sign}Rs{pnl:,.0f}\n"
                f"<i>{ts}</i>"
            )
        if event_type == "feed_stale_trade":
            return (
                f"⚠️ <b>STALE LTP ORDER</b>\n"
                f"Bot: {payload.get('bot_name', '-')}\n"
                f"Signal: {payload.get('signal_type', '-')}\n"
                f"LTP age: {payload.get('age_s', '?')}s — order placed anyway\n"
                f"<i>{ts}</i>"
            )
        if event_type == "feed_down":
            return f"🔌 <b>FEED DOWN</b>\nSmartStream disconnected. Monitor manually.\n<i>{ts}</i>"
        if event_type == "feed_up":
            return f"🟢 <b>FEED UP</b>\nSmartStream reconnected.\n<i>{ts}</i>"
        return ""


    # ── Polling loop ──────────────────────────────────────────────────────────

    async def start_polling(self) -> None:
        """Background polling loop — receives commands and button callbacks."""
        if not self._token or not self._chat_id:
            logger.warning("[TG] Polling not started — TG_BOT_TOKEN or TG_CHAT_ID missing")
            return
        self._polling = True
        logger.info("[TG] Polling loop started")
        while self._polling:
            try:
                updates = await self._get_updates()
                for update in updates:
                    self._offset = update["update_id"] + 1
                    await self._handle_update(update)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning(f"[TG] Polling error: {e}")
            await asyncio.sleep(2)
        logger.info("[TG] Polling loop stopped")

    async def stop_polling(self) -> None:
        self._polling = False

    async def _get_updates(self) -> list:
        url = f"https://api.telegram.org/bot{self._token}/getUpdates"
        params = {
            "offset":          self._offset,
            "timeout":         10,
            "allowed_updates": ["message", "callback_query"],
        }
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, params=params)
            return resp.json().get("result", [])

    async def _handle_update(self, update: dict) -> None:
        if "callback_query" in update:
            query    = update["callback_query"]
            data     = query.get("data", "")
            query_id = query["id"]
            chat_id  = query["message"]["chat"]["id"]
            await self._answer_callback(query_id)
            if data == "cmd_positions":
                await self._send_positions(chat_id)
            elif data == "cmd_health":
                await self._send_health(chat_id)
            elif data == "cmd_pnl":
                await self._send_pnl(chat_id)
            return

        if "message" in update:
            msg     = update["message"]
            text    = msg.get("text", "")
            chat_id = msg["chat"]["id"]
            if text.startswith("/positions") or text.startswith("/pos"):
                await self._send_positions(chat_id)
            elif text.startswith("/pnl"):
                await self._send_pnl(chat_id)
            elif text.startswith("/status") or text.startswith("/health"):
                await self._send_health(chat_id)
            elif text.startswith("/help") or text.startswith("/start"):
                await self._send_help(chat_id)

    async def _answer_callback(self, query_id: str) -> None:
        url = f"https://api.telegram.org/bot{self._token}/answerCallbackQuery"
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                await client.post(url, json={"callback_query_id": query_id})
        except Exception as e:
            logger.error(f"[TG] _answer_callback failed: {e}")

    async def _send_to(self, chat_id, text: str, keyboard=None) -> None:
        url     = f"https://api.telegram.org/bot{self._token}/sendMessage"
        payload = {"chat_id": chat_id, "text": text, "parse_mode": "HTML"}
        if keyboard:
            payload["reply_markup"] = {"inline_keyboard": keyboard}
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                await client.post(url, json=payload)
        except Exception as e:
            logger.error(f"[TG] _send_to failed: {e}")

    # ── Command handlers ──────────────────────────────────────────────────────

    async def _send_help(self, chat_id) -> None:
        msg = (
            "🤖 <b>STAAX Bot</b>\n\n"
            "/positions — Open positions + live P&amp;L\n"
            "/pnl — Today's P&amp;L summary\n"
            "/status — Engine + feed health\n"
            "/help — This message"
        )
        await self._send_to(chat_id, msg)

    async def _send_health(self, chat_id) -> None:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get("http://localhost:8000/api/v1/engine/health")
                h    = resp.json()
            ss       = h.get("smartstream", {})
            eng      = h.get("engine", {})
            mon      = h.get("monitors", {})
            status   = ss.get("status", "unknown")
            tick_ms  = ss.get("last_tick_ago_ms", 0)
            open_pos = eng.get("open_positions", 0)
            sl_mon   = mon.get("active_sl_monitors", 0)
            ss_emoji = "🟢" if status == "active" else "🔴"
            msg = (
                f"{ss_emoji} <b>Engine Health</b>\n\n"
                f"Feed: {status} ({tick_ms}ms ago)\n"
                f"Open positions: {open_pos}\n"
                f"Active SL monitors: {sl_mon}"
            )
        except Exception as e:
            msg = f"⚠️ Health check failed: {e}"
        await self._send_to(chat_id, msg)

    async def _send_positions(self, chat_id) -> None:
        try:
            from app.core.database import AsyncSessionLocal
            from app.models.order import Order, OrderStatus
            from sqlalchemy import select
            async with AsyncSessionLocal() as db:
                r = await db.execute(
                    select(Order)
                    .where(Order.status == OrderStatus.OPEN)
                    .order_by(Order.algo_tag)
                )
                orders = r.scalars().all()
            if not orders:
                await self._send_to(chat_id, "📭 No open positions")
                return
            lines = ["📍 <b>Open Positions</b>\n"]
            for o in orders:
                pnl       = o.pnl or 0
                pnl_str   = f"+₹{pnl:,.0f}" if pnl >= 0 else f"-₹{abs(pnl):,.0f}"
                pnl_emoji = "🟢" if pnl >= 0 else "🔴"
                lines.append(
                    f"{pnl_emoji} <b>{o.algo_tag or '-'}</b> — {o.symbol or '-'}\n"
                    f"   Fill: ₹{o.fill_price or 0} | P&amp;L: {pnl_str}"
                )
            await self._send_to(chat_id, "\n".join(lines))
        except Exception as e:
            await self._send_to(chat_id, f"⚠️ Error fetching positions: {e}")

    async def _send_pnl(self, chat_id) -> None:
        try:
            from app.core.database import AsyncSessionLocal
            from app.models.order import Order, OrderStatus
            from sqlalchemy import select, cast, func
            from sqlalchemy.types import Date
            today_ist = datetime.now(IST).date()
            async with AsyncSessionLocal() as db:
                r = await db.execute(
                    select(Order).where(
                        cast(func.timezone("Asia/Kolkata", Order.created_at), Date) == today_ist
                    )
                )
                orders = r.scalars().all()
            closed     = [o for o in orders if o.status == OrderStatus.CLOSED]
            open_pos   = [o for o in orders if o.status == OrderStatus.OPEN]
            realized   = sum(o.pnl or 0 for o in closed)
            unrealized = sum(o.pnl or 0 for o in open_pos)
            total      = realized + unrealized
            emoji   = "🟢" if total >= 0 else "🔴"
            fmt     = lambda v: f"+₹{v:,.0f}" if v >= 0 else f"-₹{abs(v):,.0f}"
            msg = (
                f"{emoji} <b>Today's P&amp;L</b>\n\n"
                f"Realized:   {fmt(realized)} ({len(closed)} closed)\n"
                f"Unrealized: {fmt(unrealized)} ({len(open_pos)} open)\n"
                f"<b>Total: {fmt(total)}</b>"
            )
            await self._send_to(chat_id, msg)
        except Exception as e:
            await self._send_to(chat_id, f"⚠️ Error: {e}")


tg_notifier = TGNotifier()
