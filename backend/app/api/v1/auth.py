from fastapi import APIRouter, HTTPException, status, Depends
from fastapi.responses import RedirectResponse, HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timezone
from kiteconnect import KiteConnect
from app.core.security import verify_password, create_access_token
from app.core.config import settings
from app.core.database import get_db
from app.schemas.auth import LoginRequest, TokenResponse
from app.models.account import Account, BrokerType, AccountStatus

router = APIRouter()

# Single-owner platform — one hardcoded user, no user table needed.
# Username and password hash come from .env via settings.
STAAX_USERNAME      = getattr(settings, "STAAX_USERNAME",      "karthik")
STAAX_PASSWORD_HASH = getattr(settings, "STAAX_PASSWORD_HASH", "")


@router.post("/login", response_model=TokenResponse)
async def login(data: LoginRequest):
    """Login — checks username + bcrypt password hash. Returns JWT."""

    # Check username
    if data.username != STAAX_USERNAME:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    # Check password against bcrypt hash
    if not STAAX_PASSWORD_HASH or not verify_password(data.password, STAAX_PASSWORD_HASH):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    token = create_access_token({"sub": data.username})
    return TokenResponse(access_token=token)


@router.get("/me")
async def me():
    """Returns current user info."""
    return {"username": STAAX_USERNAME, "platform": "STAAX", "version": "0.1.0"}


@router.get("/zerodha/login")
async def zerodha_login():
    """Redirect to Kite login page."""
    kite = KiteConnect(api_key=settings.ZERODHA_API_KEY)
    login_url = kite.login_url()
    return RedirectResponse(url=login_url)


@router.get("/zerodha/callback")
async def zerodha_callback(request_token: str, db: AsyncSession = Depends(get_db)):
    """Receive request_token from Kite, exchange for access_token, save to DB."""
    try:
        kite = KiteConnect(api_key=settings.ZERODHA_API_KEY)
        session_data = kite.generate_session(request_token, api_secret=settings.ZERODHA_API_SECRET)
        access_token = session_data["access_token"]

        # Find Zerodha account and update token
        result = await db.execute(
            select(Account).where(
                Account.broker == BrokerType.ZERODHA,
                Account.client_id == settings.ZERODHA_USER_ID
            )
        )
        account = result.scalar_one_or_none()

        if account:
            account.access_token = access_token
            account.token_generated_at = datetime.now(timezone.utc)
            account.status = AccountStatus.ACTIVE
            await db.commit()
            return HTMLResponse(content="""
<!DOCTYPE html>
<html>
<head><title>Zerodha Connected</title></head>
<body style="background:#0f0f12;color:#22DD88;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
  <div style="text-align:center;">
    <div style="font-size:48px;">✅</div>
    <p style="font-size:18px;margin-top:16px;">Zerodha connected successfully</p>
    <p style="color:rgba(255,255,255,0.4);font-size:13px;">This tab will close automatically...</p>
  </div>
  <script>
    if (window.opener) { window.opener.location.reload(); }
    setTimeout(() => window.close(), 1500);
  </script>
</body>
</html>
""")
        else:
            return {"status": "error", "message": "Zerodha account not found in DB"}

    except Exception as e:
        return {"status": "error", "message": str(e)}
