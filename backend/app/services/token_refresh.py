"""
Token Refresh Service — daily API token management.

Zerodha flow (once per day, ~30 seconds):
  1. User clicks "Login to Zerodha" button in STAAX UI
  2. Browser opens Zerodha login page
  3. User enters password + Google Authenticator TOTP
  4. Zerodha redirects to http://127.0.0.1?request_token=XXXX
  5. Frontend captures request_token from URL and sends to backend
  6. Backend calls set_access_token() — token valid for the day

Angel One: Auto-refresh via TOTP using pyotp (no manual step needed).
"""
import logging
import pyotp
from datetime import datetime, date
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from app.core.config import settings
from app.brokers.zerodha import ZerodhaBroker
from app.models.account import Account, AccountStatus, BrokerType

logger = logging.getLogger(__name__)


class TokenRefreshService:

    def __init__(self, db: AsyncSession, zerodha_broker: ZerodhaBroker):
        self.db      = db
        self.zerodha = zerodha_broker

    # ── Zerodha ───────────────────────────────────────────────────────────────

    def get_zerodha_login_url(self) -> str:
        return self.zerodha.get_login_url()

    async def complete_zerodha_login(self, request_token: str) -> str:
        """
        Called after user completes browser login.
        Exchanges request_token → access_token and persists to DB.
        """
        access_token = await self.zerodha.set_access_token(request_token)

        await self.db.execute(
            update(Account)
            .where(Account.broker == BrokerType.ZERODHA)
            .values(
                access_token=access_token,
                token_generated_at=datetime.utcnow(),
                status=AccountStatus.ACTIVE,
            )
        )
        await self.db.commit()
        logger.info("✅ Zerodha token saved to DB")
        return access_token

    async def load_zerodha_token_from_db(self) -> Optional[str]:
        """
        On server startup: load today's token from DB if available.
        Returns None if no valid token → user must log in.
        """
        result = await self.db.execute(
            select(Account).where(Account.broker == BrokerType.ZERODHA)
        )
        account = result.scalar_one_or_none()
        if not account or not account.access_token:
            return None

        if account.token_generated_at:
            if account.token_generated_at.date() == date.today():
                await self.zerodha.load_token(account.access_token)
                logger.info("✅ Zerodha token restored from DB")
                return account.access_token

        # Token is stale
        await self.db.execute(
            update(Account)
            .where(Account.broker == BrokerType.ZERODHA)
            .values(status=AccountStatus.TOKEN_EXPIRED)
        )
        await self.db.commit()
        logger.warning("⚠️ Zerodha token expired — login required")
        return None

    # ── Angel One ─────────────────────────────────────────────────────────────

    async def refresh_angelone_token(self, account_name: str) -> Optional[str]:
        """
        Auto-refresh Angel One token using TOTP.
        account_name: 'mom' or 'wife'
        No manual step needed.
        """
        try:
            from smartapi import SmartConnect

            if account_name == "mom":
                api_key     = settings.ANGELONE_MOM_API_KEY
                client_id   = settings.ANGELONE_MOM_CLIENT_ID
                totp_secret = settings.ANGELONE_MOM_TOTP_SECRET
                nickname    = "Mom"
            else:
                api_key     = settings.ANGELONE_WIFE_API_KEY
                client_id   = settings.ANGELONE_WIFE_CLIENT_ID
                totp_secret = settings.ANGELONE_WIFE_TOTP_SECRET
                nickname    = "Wife"

            totp  = pyotp.TOTP(totp_secret).now()
            smart = SmartConnect(api_key=api_key)
            # Note: PIN stored in .env as ANGELONE_MOM_PIN — added in Phase 1A full auth
            pin   = getattr(settings, f"ANGELONE_{account_name.upper()}_PIN", "")
            session = smart.generateSession(client_id, pin, totp)
            access_token = session["data"]["jwtToken"]

            await self.db.execute(
                update(Account)
                .where(Account.nickname == nickname)
                .values(
                    access_token=access_token,
                    token_generated_at=datetime.utcnow(),
                    status=AccountStatus.ACTIVE,
                )
            )
            await self.db.commit()
            logger.info(f"✅ Angel One token refreshed — {nickname}")
            return access_token

        except Exception as e:
            logger.error(f"❌ Angel One token refresh failed ({account_name}): {e}")
            return None

    async def refresh_all(self):
        """
        Called by scheduler at 08:30 IST each morning.
        Zerodha: checks if token exists. If not, sends login reminder.
        Angel One: auto-refreshes via TOTP.
        """
        zerodha_token = await self.load_zerodha_token_from_db()
        if not zerodha_token:
            logger.warning("⚠️ Zerodha login required — sending notification")
            # NotificationService().send_login_reminder() — wired in Phase 1E

        await self.refresh_angelone_token("mom")
        # await self.refresh_angelone_token("wife")  # Phase 2
