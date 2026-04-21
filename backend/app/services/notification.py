"""
Notification Service — WhatsApp (Twilio) + Email (AWS SES).
All trade events, errors, and system alerts go through here.
See PRD Section 11 for full event list.
"""
import logging

from app.core.config import settings

# TODO: Implement Twilio + SES in Phase 1E

logger = logging.getLogger(__name__)


class NotificationService:

    async def send_whatsapp(self, message: str) -> None:
        """Send WhatsApp notification via Twilio."""
        logger.debug("[NOTIFY] send_whatsapp called (not implemented)")

    async def send_email(self, subject: str, body: str) -> None:
        """Send email via AWS SES."""
        logger.debug("[NOTIFY] send_email called (not implemented)")

    async def trade_triggered(self, algo_name: str, symbol: str, price: float, direction: str) -> None:
        logger.debug("[NOTIFY] trade_triggered called (not implemented)")

    async def sl_hit(self, algo_name: str, symbol: str, exit_price: float, pnl: float) -> None:
        logger.debug("[NOTIFY] sl_hit called (not implemented)")

    async def error_alert(self, algo_name: str, error: str) -> None:
        logger.debug("[NOTIFY] error_alert called (not implemented)")
