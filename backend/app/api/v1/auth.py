from fastapi import APIRouter, HTTPException, status, Depends
from fastapi.responses import RedirectResponse, HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timezone
from typing import Optional
from pydantic import BaseModel
import uuid as _uuid

from kiteconnect import KiteConnect
from app.core.security import verify_password, create_access_token, get_current_user, require_owner
from app.core.config import settings
from app.core.database import get_db
from app.schemas.auth import LoginRequest, TokenResponse
from app.models.account import Account, BrokerType, AccountStatus
from app.models.user import User

router = APIRouter()

# Fallback .env credentials — used if users table is empty (transition safety net)
_ENV_USERNAME      = getattr(settings, "STAAX_USERNAME",      "karthikeyan")
_ENV_PASSWORD_HASH = getattr(settings, "STAAX_PASSWORD_HASH", "")


# ── Schemas ────────────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    username: str
    password: str
    display_name: Optional[str] = None
    email: Optional[str] = None


class UserResponse(BaseModel):
    id: _uuid.UUID
    username: str
    display_name: Optional[str]
    is_owner: bool
    is_active: bool
    created_at: Optional[datetime]

    class Config:
        from_attributes = True


# ── Auth endpoints ─────────────────────────────────────────────────────────────

@router.post("/login", response_model=TokenResponse)
async def login(data: LoginRequest, db: AsyncSession = Depends(get_db)):
    """Login — checks users table first, falls back to .env if table is empty."""

    result = await db.execute(
        select(User).where(User.username == data.username, User.is_active == True)
    )
    user = result.scalar_one_or_none()

    if user:
        if not verify_password(data.password, user.password_hash):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    else:
        # Fallback: users table empty or user not found — check .env
        if data.username != _ENV_USERNAME or not _ENV_PASSWORD_HASH:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
        if not verify_password(data.password, _ENV_PASSWORD_HASH):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    token = create_access_token({"sub": data.username})
    return TokenResponse(access_token=token)


@router.get("/me")
async def me(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Returns current user info from DB."""
    return {
        "id":           str(current_user.id),
        "username":     current_user.username,
        "display_name": current_user.display_name,
        "is_owner":     current_user.is_owner,
        "is_active":    current_user.is_active,
        "platform":     "STAAX",
        "version":      "0.1.0",
    }


# ── User management (owner only) ───────────────────────────────────────────────

@router.post("/auth/register", response_model=UserResponse)
async def register(
    data: RegisterRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_owner),
):
    """Register a new user. Owner only."""
    from app.core.security import hash_password
    existing = await db.execute(select(User).where(User.username == data.username))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Username already exists")

    new_user = User(
        username=data.username,
        password_hash=hash_password(data.password),
        display_name=data.display_name,
        email=data.email,
        is_active=True,
        is_owner=False,
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)
    return new_user


@router.get("/auth/users")
async def list_users(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_owner),
):
    """List all users. Owner only."""
    result = await db.execute(select(User).order_by(User.created_at))
    users = result.scalars().all()
    return [
        {
            "id":           str(u.id),
            "username":     u.username,
            "display_name": u.display_name,
            "is_owner":     u.is_owner,
            "is_active":    u.is_active,
            "created_at":   u.created_at.isoformat() if u.created_at else None,
        }
        for u in users
    ]


@router.patch("/auth/users/{user_id}/deactivate")
async def deactivate_user(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_owner),
):
    """Deactivate a user. Owner only."""
    result = await db.execute(select(User).where(User.id == _uuid.UUID(user_id)))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot deactivate yourself")
    user.is_active = False
    await db.commit()
    return {"ok": True, "username": user.username}


# ── Zerodha OAuth ──────────────────────────────────────────────────────────────

@router.get("/zerodha/login")
async def zerodha_login():
    """Redirect to Kite login page."""
    kite = KiteConnect(api_key=settings.ZERODHA_API_KEY)
    return RedirectResponse(url=kite.login_url())


@router.get("/zerodha/callback")
async def zerodha_callback(request_token: str, db: AsyncSession = Depends(get_db)):
    """Receive request_token from Kite, exchange for access_token, save to DB."""
    try:
        kite = KiteConnect(api_key=settings.ZERODHA_API_KEY)
        session_data = kite.generate_session(request_token, api_secret=settings.ZERODHA_API_SECRET)
        access_token = session_data["access_token"]

        result = await db.execute(
            select(Account).where(
                Account.broker == BrokerType.ZERODHA,
                Account.client_id == settings.ZERODHA_USER_ID,
            )
        )
        account = result.scalar_one_or_none()
        if account:
            account.access_token = access_token
            account.token_generated_at = datetime.now(timezone.utc)
            account.status = AccountStatus.ACTIVE
            await db.commit()
            return HTMLResponse(content="""<!DOCTYPE html>
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
</html>""")
        return {"status": "error", "message": "Zerodha account not found in DB"}
    except Exception as e:
        return {"status": "error", "message": str(e)}
