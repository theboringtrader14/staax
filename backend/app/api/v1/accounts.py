"""
accounts.py — Accounts API
Fully wired to PostgreSQL. Reads/writes real account data.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from pydantic import BaseModel
from typing import Optional
import uuid as _uuid
from app.core.database import get_db
from app.models.account import Account, AccountStatus, BrokerType
from app.models.order import MarginHistory

router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────

class MarginUpdate(BaseModel):
    financial_year: str          # e.g. "2024-25"
    margin_amount: float

class GlobalRiskUpdate(BaseModel):
    global_sl: Optional[float] = None
    global_tp: Optional[float] = None

class NicknameUpdate(BaseModel):
    nickname: str

class AccountCreate(BaseModel):
    broker:      str                    # "zerodha" | "angelone"
    nickname:    str
    client_id:   str                    # Zerodha user ID or AO client code
    api_key:     Optional[str] = None
    api_secret:  Optional[str] = None   # Zerodha: API secret | AO: PIN (password)
    totp_secret: Optional[str] = None   # AO only — TOTP secret for auto-login
    is_primary:  bool = False


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
        "fy_brokerage": acc.fy_brokerage,
        "fy_margin":    acc.fy_margin,
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


@router.post("/")
async def create_account(body: AccountCreate, db: AsyncSession = Depends(get_db)):
    """
    Add a new broker account.
    Status is set to DISCONNECTED — user must login after creation.
    """
    # Validate broker type
    try:
        broker_type = BrokerType(body.broker.lower())
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid broker '{body.broker}'. Use 'zerodha' or 'angelone'")

    # Reject duplicate nickname
    dup = await db.execute(select(Account).where(Account.nickname == body.nickname.strip()))
    if dup.scalar_one_or_none():
        raise HTTPException(status_code=400, detail=f"Account nickname '{body.nickname}' already exists")

    account = Account(
        id=_uuid.uuid4(),
        nickname=body.nickname.strip(),
        broker=broker_type,
        client_id=body.client_id.strip(),
        api_key=body.api_key,
        api_secret=body.api_secret,     # Zerodha: API secret | AO: PIN
        totp_secret=body.totp_secret,   # AO: TOTP secret
        status=AccountStatus.DISCONNECTED,
        is_active=True,
    )
    db.add(account)
    await db.commit()
    await db.refresh(account)
    return _account_to_dict(account)


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
    if hasattr(body, "fy_margin") and body.fy_margin is not None:
        account.fy_margin = body.fy_margin
    if hasattr(body, "fy_brokerage") and body.fy_brokerage is not None:
        account.fy_brokerage = body.fy_brokerage

    await db.commit()
    return {"status": "ok", "message": "Global risk settings saved"}


@router.patch("/{account_id}/nickname")
async def update_nickname(
    account_id: str,
    body: NicknameUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update the display nickname for an account."""
    result = await db.execute(select(Account).where(Account.id == account_id))
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    account.nickname = body.nickname.strip()
    await db.commit()
    return {"status": "ok", "nickname": account.nickname}


@router.get("/{account_id}")
async def get_account(account_id: str, db: AsyncSession = Depends(get_db)):
    """Fetch a single account by ID. Used for edit form pre-fill."""
    result = await db.execute(select(Account).where(Account.id == account_id))
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return _account_to_dict(account)


# ── Zerodha Token Flow ────────────────────────────────────────────────────────

@router.get("/zerodha/login-url")
async def zerodha_login_url():
    """Returns the Zerodha login URL for the frontend to open in a new tab."""
    from app.brokers.zerodha import ZerodhaBroker
    broker = ZerodhaBroker()
    return {"login_url": broker.get_login_url()}

@router.get("/zerodha/callback")
async def zerodha_callback(request: Request):
    """
    Catch Zerodha OAuth redirect (http://127.0.0.1/?request_token=XXX).
    Redirects to frontend callback page which completes token exchange.
    """
    from fastapi.responses import RedirectResponse
    params = str(request.url.query)
    return RedirectResponse(url=f"http://localhost:3000/zerodha-callback?{params}")


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

    from app.engine import event_logger as _ev
    await _ev.success("Zerodha token set", source="auth")
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

# Maps URL slug → (DB nickname, app.state key, settings PIN field)
_AO_ACCOUNT_MAP = {
    "mom":     ("Mom",       "angelone_mom",     "ANGELONE_MOM_PIN"),
    "wife":    ("Wife",      "angelone_wife",    "ANGELONE_WIFE_PIN"),
    "karthik": ("Karthik AO","angelone_karthik", "ANGELONE_KARTHIK_PASSWORD"),
}


async def _ao_perform_login(broker, pin: str, nickname: str, db) -> dict:
    """
    Core Angel One login: TOTP → jwt_token → DB persist → broker.load_token().

    Reusable from both the API endpoint (angelone_login) and startup auto-login
    (_ao_startup_auto_login in main.py).

    Returns: { jwt_token, feed_token, refresh_token, client_code }
    Raises:  RuntimeError / Exception from broker on failure — caller decides
             whether to raise HTTPException or log a warning.
    """
    from datetime import datetime, timezone

    result        = await broker.login_with_totp(password=pin)
    jwt_token     = result.get("jwt_token", "")
    feed_token    = result.get("feed_token", "")
    refresh_token = result.get("refresh_token", "")

    db_result = await db.execute(select(Account).where(Account.nickname == nickname))
    account   = db_result.scalar_one_or_none()
    if account:
        account.access_token       = jwt_token
        account.feed_token         = feed_token
        account.token_generated_at = datetime.now(timezone.utc)
        account.status             = AccountStatus.ACTIVE
        await db.commit()

    # Belt-and-suspenders: login_with_totp() already sets the token on the broker
    # instance, but load_token() ensures feed/refresh tokens are also synced.
    if jwt_token:
        await broker.load_token(jwt_token, feed_token, refresh_token)

    return result


@router.post("/angelone/{account_nickname}/login")
async def angelone_login(
    account_nickname: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Login to Angel One using TOTP (auto-generated from secret).
    account_nickname: "mom", "wife", or "karthik"
    Saves access_token + feed_token to DB.
    """
    from datetime import datetime, timezone
    from app.core.config import settings

    entry = _AO_ACCOUNT_MAP.get(account_nickname.lower())
    if not entry:
        raise HTTPException(status_code=400, detail="Invalid account. Use 'mom', 'wife', or 'karthik'")
    nickname, state_key, pin_attr = entry

    broker = getattr(request.app.state, state_key, None)
    if not broker:
        raise HTTPException(status_code=503, detail=f"Angel One broker ({account_nickname}) not initialised")

    pin = getattr(settings, pin_attr, "")
    try:
        result = await _ao_perform_login(broker, pin, nickname, db)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Angel One login failed: {str(e)}")

    jwt_token  = result.get("jwt_token", "")
    feed_token = result.get("feed_token", "")

    from app.engine import event_logger as _ev
    await _ev.success(f"Angel One ({nickname}) connected", source="auth")

    # Auto-start SmartStream if not already running — use first account that logs in
    try:
        ltp_consumer = getattr(request.app.state, "ltp_consumer", None)
        if ltp_consumer and jwt_token and feed_token:
            existing = getattr(ltp_consumer, "_angel_adapter", None)
            already_running = existing and getattr(existing, "_running", False)
            if not already_running:
                from app.engine.ltp_consumer import AngelOneTickerAdapter
                import asyncio as _aio
                import concurrent.futures as _cf
                adapter = AngelOneTickerAdapter(
                    auth_token=jwt_token,
                    api_key=broker.api_key,
                    client_code=broker.client_id,
                    feed_token=feed_token,
                )
                ltp_consumer.set_angel_adapter(adapter)
                all_tokens = list({str(t) for t in AngelOneTickerAdapter.INDEX_TOKENS.values()})
                # Add MCX bot tokens and register for exchangeType=5 routing
                try:
                    from app.engine.bot_runner import MCX_TOKENS
                    mcx_str_tokens = [str(t) for t in MCX_TOKENS.values()]
                    adapter.register_mcx_tokens(mcx_str_tokens)
                    all_tokens.extend(mcx_str_tokens)
                except Exception:
                    pass
                loop = _aio.get_event_loop()
                executor = _cf.ThreadPoolExecutor(max_workers=1, thread_name_prefix="ao_smartstream")
                loop.run_in_executor(executor, lambda: adapter.start(
                    tokens=all_tokens,
                    loop=loop,
                    on_tick=ltp_consumer._process_ticks,
                ))
                import logging as _log
                _log.getLogger(__name__).info(f"[AO-LOGIN] SmartStream auto-started via {nickname}")
    except Exception as _e:
        import logging as _log
        _log.getLogger(__name__).warning(f"[AO-LOGIN] SmartStream auto-start failed (non-fatal): {_e}")

    return {
        "status": "success",
        "message": f"✅ Angel One ({nickname}) connected for today",
        "token_generated_at": datetime.now(timezone.utc).isoformat(),
    }


@router.post("/angelone/{account_nickname}/auto-login")
async def angelone_auto_login(
    account_nickname: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Auto-login to Angel One using pyotp TOTP + PIN from .env.
    Identical to /login but exposed under /auto-login for the frontend Auto-Login button.
    account_nickname: "mom", "wife", or "karthik"
    """
    return await angelone_login(account_nickname, request, db)


@router.get("/angelone/{account_nickname}/token-status")
async def angelone_token_status(
    account_nickname: str,
    db: AsyncSession = Depends(get_db),
):
    """Check if today's Angel One token is valid for mom, wife, or karthik."""
    from datetime import datetime, timezone, date

    entry = _AO_ACCOUNT_MAP.get(account_nickname.lower())
    if not entry:
        raise HTTPException(status_code=400, detail="Invalid account. Use 'mom', 'wife', or 'karthik'")
    nickname = entry[0]

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
