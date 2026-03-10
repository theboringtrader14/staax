"""
accounts.py — Accounts API
Fully wired to PostgreSQL. Reads/writes real account data.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from pydantic import BaseModel
from typing import Optional
from app.core.database import get_db
from app.models.account import Account, AccountStatus
from app.models.order import MarginHistory

router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────

class MarginUpdate(BaseModel):
    financial_year: str          # e.g. "2024-25"
    margin_amount: float

class GlobalRiskUpdate(BaseModel):
    global_sl: Optional[float] = None
    global_tp: Optional[float] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _account_to_dict(acc: Account) -> dict:
    return {
        "id":           str(acc.id),
        "nickname":     acc.nickname,
        "broker":       acc.broker.value if acc.broker else None,
        "client_id":    acc.client_id,
        "status":       acc.status.value if acc.status else "disconnected",
        "global_sl":    acc.global_sl,
        "global_tp":    acc.global_tp,
        "is_active":    acc.is_active,
        "token_generated_at": acc.token_generated_at.isoformat() if acc.token_generated_at else None,
        "token_valid_today": (
            acc.token_generated_at is not None and
            acc.token_generated_at.date() == __import__('datetime').date.today() and
            acc.status == AccountStatus.ACTIVE
        ),
    }


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/")
async def list_accounts(db: AsyncSession = Depends(get_db)):
    """List all configured broker accounts."""
    result = await db.execute(select(Account).order_by(Account.created_at))
    accounts = result.scalars().all()
    return [_account_to_dict(a) for a in accounts]


@router.get("/status")
async def account_status(db: AsyncSession = Depends(get_db)):
    """Connection status for all accounts."""
    result = await db.execute(select(Account).order_by(Account.created_at))
    accounts = result.scalars().all()
    return [
        {
            "id":       str(a.id),
            "nickname": a.nickname,
            "broker":   a.broker.value if a.broker else None,
            "status":   a.status.value if a.status else "disconnected",
            "token_generated_at": a.token_generated_at.isoformat() if a.token_generated_at else None,
        }
        for a in accounts
    ]


@router.post("/{account_id}/margin")
async def update_margin(
    account_id: str,
    body: MarginUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update FY margin for an account. Used for ROI calculation in Reports."""
    # Verify account exists
    result = await db.execute(select(Account).where(Account.id == account_id))
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    # Upsert margin_history record for this FY
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    existing = await db.execute(
        select(MarginHistory).where(
            MarginHistory.account_id == account_id,
            MarginHistory.financial_year == body.financial_year,
        )
    )
    record = existing.scalar_one_or_none()

    if record:
        record.margin_amount = body.margin_amount
        record.source = "manual"
    else:
        db.add(MarginHistory(
            account_id=account_id,
            financial_year=body.financial_year,
            margin_amount=body.margin_amount,
            source="manual",
        ))

    await db.commit()
    return {"status": "ok", "message": f"Margin updated for {body.financial_year}"}


@router.post("/{account_id}/global-risk")
async def update_global_risk(
    account_id: str,
    body: GlobalRiskUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update global SL and TP for an account."""
    result = await db.execute(select(Account).where(Account.id == account_id))
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    if body.global_sl is not None:
        account.global_sl = body.global_sl
    if body.global_tp is not None:
        account.global_tp = body.global_tp

    await db.commit()
    return {"status": "ok", "message": "Global risk settings saved"}


# ── Zerodha Token Flow ────────────────────────────────────────────────────────

@router.get("/zerodha/login-url")
async def zerodha_login_url():
    """Returns the Zerodha login URL for the frontend to open in a new tab."""
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
    Exchanges request_token for access_token, saves to DB, updates account status.
    """
    from app.brokers.zerodha import ZerodhaBroker
    broker = ZerodhaBroker()
    try:
        access_token = await broker.set_access_token(request_token)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Token exchange failed: {str(e)}")

    # Save token to DB account record
    result = await db.execute(
        select(Account).where(Account.nickname == "Karthik")
    )
    account = result.scalar_one_or_none()
    if account:
        from datetime import datetime, timezone
        account.access_token = access_token
        account.token_generated_at = datetime.now(timezone.utc)
        account.status = AccountStatus.ACTIVE
        await db.commit()

    return {"status": "success", "message": "✅ Zerodha connected for today"}


@router.get("/zerodha/token-status")
async def zerodha_token_status(db: AsyncSession = Depends(get_db)):
    """Check if today's Zerodha token is valid."""
    from datetime import datetime, timezone, date
    result = await db.execute(
        select(Account).where(Account.nickname == "Karthik")
    )
    account = result.scalar_one_or_none()
    if not account or not account.token_generated_at:
        return {"connected": False, "message": "Login required"}

    # Token valid if generated today
    token_date = account.token_generated_at.astimezone(timezone.utc).date()
    today = date.today()
    connected = (token_date == today) and (account.status == AccountStatus.ACTIVE)

    return {
        "connected": connected,
        "message": "Connected today ✅" if connected else "Login required",
        "token_generated_at": account.token_generated_at.isoformat() if connected else None,
    }


# ── Angel One Token Flow ──────────────────────────────────────────────────────

@router.post("/angelone/{account_nickname}/login")
async def angelone_login(
    account_nickname: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Login to Angel One using TOTP (auto-generated from secret).
    account_nickname: "mom" or "wife"
    Saves token to DB and wires app.state.angelone_mom / angelone_wife.
    """
    from datetime import datetime, timezone
    from app.core.config import settings

    nickname_map = {"mom": "Mom", "wife": "Wife"}
    state_key_map = {"mom": "angelone_mom", "wife": "angelone_wife"}
    nickname = nickname_map.get(account_nickname.lower())
    state_key = state_key_map.get(account_nickname.lower())

    if not nickname:
        raise HTTPException(status_code=400, detail="Invalid account. Use 'mom' or 'wife'")

    # Get broker from app.state
    broker = getattr(request.app.state, state_key, None)
    if not broker:
        raise HTTPException(status_code=503, detail=f"Angel One broker ({account_nickname}) not initialised")

    try:
        result = await broker.login_with_totp()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Angel One login failed: {str(e)}")

    # Save token to DB
    result_db = await db.execute(select(Account).where(Account.nickname == nickname))
    account = result_db.scalar_one_or_none()
    if account:
        account.access_token = result.get("jwtToken", "")
        account.token_generated_at = datetime.now(timezone.utc)
        account.status = AccountStatus.ACTIVE
        await db.commit()

    return {
        "status": "success",
        "message": f"✅ Angel One ({nickname}) connected for today",
        "token_generated_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/angelone/{account_nickname}/token-status")
async def angelone_token_status(
    account_nickname: str,
    db: AsyncSession = Depends(get_db),
):
    """Check if today's Angel One token is valid for mom or wife."""
    from datetime import datetime, timezone, date

    nickname_map = {"mom": "Mom", "wife": "Wife"}
    nickname = nickname_map.get(account_nickname.lower())
    if not nickname:
        raise HTTPException(status_code=400, detail="Invalid account. Use 'mom' or 'wife'")

    result = await db.execute(select(Account).where(Account.nickname == nickname))
    account = result.scalar_one_or_none()

    if not account or not account.token_generated_at:
        return {"connected": False, "message": "Login required"}

    token_date = account.token_generated_at.astimezone(timezone.utc).date()
    today = date.today()
    connected = (token_date == today) and (account.status == AccountStatus.ACTIVE)

    return {
        "connected": connected,
        "message": "Connected today ✅" if connected else "Login required",
        "token_generated_at": account.token_generated_at.isoformat() if connected else None,
    }
