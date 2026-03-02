"""
Token Refresh Service — daily API token management.
Runs at 08:30 IST to refresh Zerodha and Angel One tokens before market open.
Sends notification on success or failure.
"""
# TODO: Implement in Phase 1A (critical — needed before any trading)


class TokenRefreshService:

    async def refresh_zerodha_token(self):
        """Refresh Zerodha KiteConnect access token."""
        raise NotImplementedError

    async def refresh_angelone_token(self, account: str):
        """Refresh Angel One SmartAPI access token using TOTP."""
        raise NotImplementedError

    async def refresh_all(self):
        """Refresh all account tokens. Called by scheduler at 08:30 IST."""
        await self.refresh_zerodha_token()
        await self.refresh_angelone_token("mom")
        # Wife's account — Phase 2
