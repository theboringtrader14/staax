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
                f"<b>ENTRY</b>\n"
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
                f"<b>SL HIT</b>\n"
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
                f"<b>TARGET HIT</b>\n"
                f"Algo: {payload.get('algo_name', '-')}\n"
                f"Account: {payload.get('account', '-')}\n"
                f"Exit: {payload.get('exit_price', 0):.2f}\n"
                f"P&amp;L: {sign}Rs{pnl:,.0f}\n"
                f"<i>{ts}</i>"
            )
        if event_type == "feed_down":
            return f"<b>FEED DOWN</b>\nSmartStream disconnected. Monitor manually.\n<i>{ts}</i>"
        if event_type == "feed_up":
            return f"<b>FEED UP</b>\nSmartStream reconnected.\n<i>{ts}</i>"
        return ""


tg_notifier = TGNotifier()
