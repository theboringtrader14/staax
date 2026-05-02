import logging
import os
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx

logger = logging.getLogger(__name__)
IST = ZoneInfo("Asia/Kolkata")


class WANotifier:
    def __init__(self):
        self._webhook_url   = os.getenv("N8N_WA_WEBHOOK_URL", "")
        self._allowed_phones = os.getenv("WA_ALLOWED_PHONES", "")

    async def notify(self, event_type: str, payload: dict) -> None:
        if not self._webhook_url:
            return
        body = {
            "event":     event_type,
            "payload":   payload,
            "timestamp": datetime.now(IST).strftime("%Y-%m-%d %H:%M:%S IST"),
        }
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.post(self._webhook_url, json=body)
                logger.info(f"[WA] {event_type} → status {resp.status_code}")
        except Exception as e:
            logger.error(f"[WA ERROR] {event_type}: {e}")

    @staticmethod
    def format_sl_hit(algo_name: str, account: str, exit_price: float, pnl: float) -> str:
        sign = "+" if pnl >= 0 else ""
        return (
            f"SL HIT\n"
            f"Algo: {algo_name}\n"
            f"Account: {account}\n"
            f"Exit: {exit_price:.2f}\n"
            f"P&L: {sign}Rs{pnl:,.0f}"
        )

    @staticmethod
    def format_tp_hit(algo_name: str, account: str, exit_price: float, pnl: float) -> str:
        sign = "+" if pnl >= 0 else ""
        return (
            f"TARGET HIT\n"
            f"Algo: {algo_name}\n"
            f"Account: {account}\n"
            f"Exit: {exit_price:.2f}\n"
            f"P&L: {sign}Rs{pnl:,.0f}"
        )

    @staticmethod
    def format_entry(algo_name: str, account: str, symbol: str, fill_price: float, lots: int) -> str:
        return (
            f"ENTRY\n"
            f"Algo: {algo_name}\n"
            f"Account: {account}\n"
            f"Symbol: {symbol}\n"
            f"Fill: {fill_price:.2f}\n"
            f"Lots: {lots}"
        )

    @staticmethod
    def format_feed_event(event: str) -> str:
        if event == "disconnected":
            return "FEED DOWN\nSmartStream disconnected. Monitor manually."
        return "FEED UP\nSmartStream reconnected successfully."


wa_notifier = WANotifier()
