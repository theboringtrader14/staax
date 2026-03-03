from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db

router = APIRouter()


@router.get("/")
async def list_accounts(db: AsyncSession = Depends(get_db)):
    """List all configured broker accounts."""
    return {"accounts": [], "message": "Phase 1A — implement in Phase 1C"}


@router.post("/")
async def create_account(db: AsyncSession = Depends(get_db)):
    return {"message": "Create account — Phase 1A"}


@router.get("/status")
async def account_status(db: AsyncSession = Depends(get_db)):
    """Connection status for all accounts."""
    return {"accounts": [], "message": "Status check"}


@router.post("/{account_id}/margin")
async def update_margin(account_id: str, db: AsyncSession = Depends(get_db)):
    """Update FY margin for ROI calculation."""
    return {"message": "Margin updated"}


# ── Zerodha Token Flow ────────────────────────────────────────────────────────

@router.get("/zerodha/login-url")
async def zerodha_login_url():
    """
    Returns the Zerodha login URL.
    Frontend opens this in a new browser tab.
    After login, Zerodha redirects to:
      http://127.0.0.1?request_token=XXXXX&action=login&status=success
    User copies the request_token and pastes into STAAX.
    """
    from app.brokers.zerodha import ZerodhaBroker
    broker = ZerodhaBroker()
    return {"login_url": broker.get_login_url()}


@router.post("/zerodha/set-token")
async def zerodha_set_token(
    request_token: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Called after user completes Zerodha login.
    Exchanges request_token for access_token and saves to DB.
    """
    from app.brokers.zerodha import ZerodhaBroker
    from app.services.token_refresh import TokenRefreshService
    broker  = ZerodhaBroker()
    service = TokenRefreshService(db, broker)
    await service.complete_zerodha_login(request_token)
    return {"status": "success", "message": "✅ Zerodha connected for today"}


@router.get("/zerodha/token-status")
async def zerodha_token_status(db: AsyncSession = Depends(get_db)):
    """Check if today's Zerodha token is valid."""
    from app.brokers.zerodha import ZerodhaBroker
    from app.services.token_refresh import TokenRefreshService
    broker  = ZerodhaBroker()
    service = TokenRefreshService(db, broker)
    token   = await service.load_zerodha_token_from_db()
    return {
        "connected": token is not None,
        "message": "Connected" if token else "Login required"
    }
