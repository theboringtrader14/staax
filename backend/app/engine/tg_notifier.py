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
        "sl_hit":         {"inline_keyboard": [[{"text": "📍 View Trades",  "callback_data": "cmd_positions"}]]},
        "tp_hit":         {"inline_keyboard": [[{"text": "📍 View Trades",  "callback_data": "cmd_positions"}]]},
        "feed_down":      {"inline_keyboard": [[{"text": "💚 Health Check", "callback_data": "cmd_health"}]]},
        "feed_up":        {"inline_keyboard": [[{"text": "💚 Health Check", "callback_data": "cmd_health"}]]},
        "eod_report":     {"inline_keyboard": [[{"text": "📊 Full Report",  "callback_data": "cmd_eod"}]]},
    }

    async def notify(self, event_type: str, payload: dict) -> None:
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
        if event_type == "eod_report":
            closed = payload.get("closed", 0)
            return f"<b>EOD CLEANUP</b>\n{closed} algo(s) closed.\n<i>{ts}</i>"
        return ""


tg_notifier = TGNotifier()
