"""
Notification Service — WhatsApp (Twilio) + Email (AWS SES).
All trade events, errors, and system alerts go through here.
See PRD Section 11 for full event list.
"""
from app.core.config import settings
# TODO: Implement Twilio + SES in Phase 1E


class NotificationService:

    async def send_whatsapp(self, message: str):
        """Send WhatsApp notification via Twilio."""
        raise NotImplementedError

    async def send_email(self, subject: str, body: str):
        """Send email via AWS SES."""
        raise NotImplementedError

    async def trade_triggered(self, algo_name: str, symbol: str, price: float, direction: str):
        msg = f"🟢 Trade Triggered\nAlgo: {algo_name}\nSymbol: {symbol}\nPrice: {price}\nSide: {direction}"
        await self.send_whatsapp(msg)

    async def sl_hit(self, algo_name: str, symbol: str, exit_price: float, pnl: float):
        msg = f"🔴 SL Hit\nAlgo: {algo_name}\nSymbol: {symbol}\nExit: {exit_price}\nP&L: ₹{pnl:,.0f}"
        await self.send_whatsapp(msg)

    async def error_alert(self, algo_name: str, error: str):
        msg = f"⚠️ Error\nAlgo: {algo_name}\nError: {error}"
        await self.send_whatsapp(msg)
        await self.send_email(f"STAAX Error — {algo_name}", msg)
