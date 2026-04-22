"""
System API — platform-level controls.

Endpoints:
  POST /api/v1/system/kill-switch         — activate global kill switch
  GET  /api/v1/system/kill-switch/status  — check kill switch state
"""
import logging
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from pydantic import BaseModel
from app.engine import global_kill_switch

logger = logging.getLogger(__name__)
router = APIRouter()


class KillSwitchRequest(BaseModel):
    account_ids: list = []  # Empty = kill all; provide UUIDs to target specific accounts


@router.post("/kill-switch")
async def activate_kill_switch(request: Request, body: KillSwitchRequest = None, db: AsyncSession = Depends(get_db)):
    """
    Activate the Global Kill Switch.

    Execution order (broker is always source of truth):
      0. Freeze engine (disable OrderRetryQueue, ReEntryEngine, Scheduler)
      1. Fetch ALL open positions + orders from broker API
      2. Cancel all pending orders at broker
      3. Square off all open positions at broker (market orders)
      4. Verify broker is flat
      5. Update DB (only after broker confirmed)
      6. Broadcast WebSocket + log CRITICAL event
    """
    if global_kill_switch.is_activated():
        return {
            "status":  "already_activated",
            "message": "Kill switch was already activated this session",
            **global_kill_switch.get_state(),
        }

    logger.critical("[API] Kill switch activation requested")

    # Build broker registry from app state
    # broker_registry maps account_id → broker adapter
    # Currently wired for Zerodha — Angel One added in Phase 2
    try:
        # Build broker registry from app.state
        registry = {}
        # Get accounts from DB to map UUIDs to broker instances
        from app.models.account import Account, BrokerType
        from sqlalchemy import select
        accs_result = await db.execute(select(Account).where(Account.is_active == True))
        accs = accs_result.scalars().all()
        for acc in accs:
            if acc.broker == BrokerType.ZERODHA and hasattr(request.app.state, "zerodha"):
                registry[str(acc.id)] = request.app.state.zerodha
            elif acc.broker == BrokerType.ANGELONE and acc.nickname == "Mom" and hasattr(request.app.state, "angelone_mom"):
                registry[str(acc.id)] = request.app.state.angelone_mom
            elif acc.broker == BrokerType.ANGELONE and hasattr(request.app.state, "angelone_wife"):
                registry[str(acc.id)] = request.app.state.angelone_wife
    except (ImportError, Exception):
        registry = {}
        logger.warning("[KILL SWITCH] No broker registry available — DB-only update")

    result = await global_kill_switch.activate(
        account_ids=body.account_ids if body else [],
        db=db,
        broker_registry=registry,
        websocket_manager=request.app.state.ws_manager if hasattr(request.app.state, 'ws_manager') else None,
    )

    # AR-5: Trigger immediate reconciliation after kill switch
    try:
        from app.engine.order_reconciler import order_reconciler
        import asyncio
        asyncio.ensure_future(order_reconciler.run())
        logger.info("[KILL SWITCH] Post-event reconciliation triggered")
    except Exception as e:
        logger.warning(f"[KILL SWITCH] Post-event reconciliation failed: {e}")

    return {
        "status":  "activated" if not result.get("errors") else "activated_with_errors",
        "message": result.get("summary"),
        **result,
    }


@router.get("/kill-switch/status")
async def kill_switch_status(db: AsyncSession = Depends(get_db)):
    """Check current kill switch state — reads from DB for persistence across restarts."""
    from app.models.system_state import SystemState
    from sqlalchemy import select as sa_select
    try:
        result = await db.execute(sa_select(SystemState).where(SystemState.id == 1))
        row = result.scalar_one_or_none()
        if row and row.kill_switch_active and not global_kill_switch.is_activated():
            # Restore in-memory state from DB on first read after restart
            global_kill_switch._state.activated = True
            global_kill_switch._state.activated_at = row.kill_switch_at
            global_kill_switch._state.positions_squared = row.positions_squared or 0
            global_kill_switch._state.orders_cancelled = row.orders_cancelled or 0
        if row:
            return {
                "activated":          row.kill_switch_active,
                "activated_at":       row.kill_switch_at.isoformat() if row.kill_switch_at else None,
                "positions_squared":  row.positions_squared,
                "orders_cancelled":   row.orders_cancelled,
                "error":              row.kill_switch_error,
                "killed_account_ids": row.killed_account_ids.split(',') if row.killed_account_ids else [],
            }
    except Exception:
        pass
    return global_kill_switch.get_state()


# ── Dashboard stats ───────────────────────────────────────────────────────────

@router.get("/stats")
async def get_dashboard_stats(db: AsyncSession = Depends(get_db), is_practix: bool = False):
    """
    Returns stat card values for the Dashboard:
      active_algos    — grid entries today that have been triggered (not NO_TRADE/ERROR/CLOSED)
      open_positions  — orders with status=OPEN for today
      today_pnl       — sum of closed-order P&L for today
      fy_pnl          — sum of all closed-order P&L in the current financial year
    """
    from datetime import date as _date, datetime as _dt, timezone as _tz, timedelta as _td
    from sqlalchemy import func, select as sa_select, distinct, or_, and_
    from app.models.order import Order, OrderStatus
    from app.models.algo import Algo
    from app.models.algo_state import AlgoState, AlgoRunStatus
    from app.models.grid import GridEntry

    # IST date — used to scope counts to today (handles STBT/BTST correctly)
    _IST = _tz(_td(hours=5, minutes=30))
    today_start_ist = _dt.now(_IST).replace(hour=0, minute=0, second=0, microsecond=0)
    today_ist_date = today_start_ist.date()
    today_ist_str = str(today_ist_date)

    # ── Active algos: distinct algo_ids with OPEN orders today (via GridEntry.trading_date) ──
    # Order model has no trading_date — join through GridEntry to filter by date
    active_result = await db.execute(
        sa_select(func.count(distinct(Order.algo_id)))
        .join(GridEntry, Order.grid_entry_id == GridEntry.id)
        .where(
            Order.status == OrderStatus.OPEN,
            Order.is_practix == is_practix,
            GridEntry.trading_date == today_ist_date,
        )
    )
    active_algos = active_result.scalar() or 0

    # ── Total algos: all non-archived algos (denominator for "X of Y") ────────
    total_result = await db.execute(
        sa_select(func.count(Algo.id)).where(Algo.is_archived == False)
    )
    total_algos = total_result.scalar() or 0

    # ── Error algos: ERROR states OR NO_TRADE with error_message for today ────
    error_result = await db.execute(
        sa_select(func.count(AlgoState.id)).where(
            or_(
                AlgoState.status == AlgoRunStatus.ERROR,
                and_(
                    AlgoState.status == AlgoRunStatus.NO_TRADE,
                    AlgoState.error_message.isnot(None),
                    AlgoState.error_message != '',
                )
            ),
            AlgoState.trading_date == today_ist_str,
        )
    )
    error_algos = error_result.scalar() or 0

    # ── Open positions: all OPEN orders (no date filter — covers STBT/BTST) ───
    # Counts all currently open orders regardless of when they were created.
    open_result = await db.execute(
        sa_select(func.count(Order.id)).where(
            Order.status == OrderStatus.OPEN,
            Order.is_practix == is_practix,
        )
    )
    open_positions = open_result.scalar() or 0

    # ── Today P&L: skipped — returning 0 temporarily until dashboard is removed ──
    # Order model has no trading_date column; calculation will be rebuilt in the dashboard revamp.

    # ── FY P&L: April 1 of current financial year to today ────────────────────
    # Indian FY: Apr 1 – Mar 31
    fy_start_year = today_ist_date.year if today_ist_date.month >= 4 else today_ist_date.year - 1
    from datetime import datetime as _dt, timezone as _tz
    fy_start = _dt(fy_start_year, 4, 1, tzinfo=_tz.utc)

    fy_pnl_result = await db.execute(
        sa_select(func.coalesce(func.sum(Order.pnl), 0)).where(
            Order.status == OrderStatus.CLOSED,
            Order.is_practix == is_practix,
            Order.exit_time >= fy_start,
        )
    )
    fy_pnl = float(fy_pnl_result.scalar() or 0)

    # ── MTM total: skipped — returning 0 temporarily until dashboard is removed ──

    return {
        "active_algos":   active_algos,
        "total_algos":    total_algos,
        "error_algos":    error_algos,
        "open_positions": open_positions,
        "today_pnl":      0,       # temporary until dashboard removed
        "fy_pnl":         fy_pnl,
        "mtm_total":      0,       # temporary until dashboard removed
    }


# ── NR-3: Instrument ticker — live LTP for sidebar display ───────────────────

# Zerodha instrument tokens for index instruments
# GOLDM is pulled from bot_runner.MCX_TOKENS so it tracks the live rolling contract.
from app.engine.bot_runner import MCX_TOKENS as _MCX_TOKENS  # noqa: E402
TICKER_INSTRUMENTS = {
    "NIFTY":      256265,
    "BANKNIFTY":  260105,
    "SENSEX":     265,
    "FINNIFTY":   257801,
    "MIDCPNIFTY": 288009,
    "GOLDM":      _MCX_TOKENS.get("GOLDM", 477904),   # live rolling MCX contract
}

@router.get("/ticker")
async def get_ticker(request: Request):
    """
    Returns live LTP for all tracked instruments.
    Used by sidebar ticker bar (NR-3). Reads from LTP cache (Redis).
    """
    ltp_cache = getattr(request.app.state, "ltp_cache", None)
    result = {}
    if ltp_cache:
        try:
            prices = await ltp_cache.get_many(list(TICKER_INSTRUMENTS.values()))
            for name, token in TICKER_INSTRUMENTS.items():
                ltp = prices.get(token)
                result[name] = float(ltp) if ltp else None
        except Exception as e:
            logger.warning(f"[TICKER] LTP cache read failed: {e}")
            for name in TICKER_INSTRUMENTS:
                result[name] = None
    else:
        for name in TICKER_INSTRUMENTS:
            result[name] = None
    return result


@router.get("/smartstream/status")
async def smartstream_status(request: Request):
    """
    Returns current SmartStream (Angel One) connection state.
    connected     — True while WebSocket is open (set in _on_open / _on_close)
    subscribed_tokens — all integer tokens currently subscribed
    mcx_tokens    — subset routed as MCX (exchangeType=5)
    last_tick_at  — ISO timestamp of the most recent tick received (UTC), or null
    """
    ltp_consumer = getattr(request.app.state, "ltp_consumer", None)
    adapter      = getattr(ltp_consumer, "_angel_adapter", None) if ltp_consumer else None

    if adapter is None:
        return {
            "connected":          False,
            "subscribed_tokens":  [],
            "mcx_tokens":         [],
            "last_tick_at":       None,
            "detail":             "No SmartStream adapter — login to Angel One first",
        }

    subscribed_ints = []
    for t in getattr(adapter, "_subscribed", []):
        try:
            subscribed_ints.append(int(t))
        except (ValueError, TypeError):
            pass

    mcx_ints = []
    for t in getattr(adapter, "_mcx_tokens", set()):
        try:
            mcx_ints.append(int(t))
        except (ValueError, TypeError):
            pass

    return {
        "connected":           getattr(adapter, "_connected", False),
        "subscribed_tokens":   sorted(subscribed_ints),
        "mcx_tokens":          sorted(mcx_ints),
        "last_tick_at":        getattr(adapter, "_last_tick_at", None),
        "reconnect_count":     getattr(adapter, "_reconnect_count", 0),
        "last_reconnect_at":   getattr(adapter, "_last_reconnect_at", None),
    }


@router.post("/smartstream/start")
async def smartstream_start(request: Request, db: AsyncSession = Depends(get_db)):
    """
    Manually start SmartStream using the first AO account that has a valid
    feed_token for today.  Idempotent — returns 'already_running' if connected.
    """
    from app.models.account import Account, BrokerType
    from app.engine.ltp_consumer import AngelOneTickerAdapter
    from app.api.v1.services import _service_states, ServiceStatus
    from app.engine.bot_runner import MCX_TOKENS as _MCX_TOKENS
    from sqlalchemy import select
    from datetime import date, timezone
    import asyncio as _aio
    import concurrent.futures as _cf
    from app.core.config import settings as _settings

    ltp_consumer = getattr(request.app.state, "ltp_consumer", None)
    if not ltp_consumer:
        raise HTTPException(status_code=503, detail="ltp_consumer not initialised — restart backend")

    # If already connected, return early
    adapter = getattr(ltp_consumer, "_angel_adapter", None)
    if adapter and getattr(adapter, "_connected", False):
        return {"status": "already_running", "message": "SmartStream is already connected"}

    _CLIENT_ID_TO_BROKER_KEY = {k: v for k, v in [
        (_settings.ANGELONE_MOM_CLIENT_ID,     "angelone_mom"),
        (_settings.ANGELONE_WIFE_CLIENT_ID,    "angelone_wife"),
        (_settings.ANGELONE_KARTHIK_CLIENT_ID, "angelone_karthik"),
    ] if k}

    result = await db.execute(
        select(Account).where(Account.broker == BrokerType.ANGELONE, Account.is_active == True)
    )
    ao_accounts = result.scalars().all()

    chosen_acc  = None
    chosen_key  = None
    for acc in ao_accounts:
        if not acc.access_token or not acc.token_generated_at:
            continue
        if acc.token_generated_at.astimezone(timezone.utc).date() != date.today():
            continue
        feed_token = acc.feed_token or ""
        if not feed_token:
            continue
        bkey = _CLIENT_ID_TO_BROKER_KEY.get(acc.client_id)
        if not bkey:
            continue
        chosen_acc = acc
        chosen_key = bkey
        break

    if not chosen_acc:
        return {"status": "no_feed_token", "message": "No AO account with a valid feed_token for today — login first"}

    ao_broker = getattr(request.app.state, chosen_key, None)
    if ao_broker:
        await ao_broker.load_token(chosen_acc.access_token, chosen_acc.feed_token or "", "")

    new_adapter = AngelOneTickerAdapter(
        auth_token  = chosen_acc.access_token,
        api_key     = chosen_acc.api_key or "",
        client_code = chosen_acc.client_id,
        feed_token  = chosen_acc.feed_token or "",
    )
    ltp_consumer.set_angel_adapter(new_adapter)

    # Build token list: NSE indices + MCX bot tokens
    all_tokens: list = []
    try:
        all_tokens.extend(int(t) for t in AngelOneTickerAdapter.INDEX_TOKENS.values())
    except Exception as e:
        logger.warning(f"[SMARTSTREAM-START] Index token build failed: {e}")

    try:
        mcx_int_tokens = list(_MCX_TOKENS.values())
        all_tokens.extend(mcx_int_tokens)
        new_adapter.register_mcx_tokens([str(t) for t in mcx_int_tokens])
    except Exception as e:
        logger.warning(f"[SMARTSTREAM-START] MCX token registration failed: {e}")

    loop     = _aio.get_event_loop()
    executor = _cf.ThreadPoolExecutor(max_workers=1, thread_name_prefix="ao_smartstream_manual")
    loop.run_in_executor(executor, lambda: new_adapter.start(
        tokens  = [str(t) for t in all_tokens],
        loop    = loop,
        on_tick = ltp_consumer._process_ticks,
    ))

    _service_states["ws"] = ServiceStatus.RUNNING
    logger.warning(f"[SMARTSTREAM-START] Started via {chosen_acc.nickname} ({len(all_tokens)} tokens)")

    return {
        "status":  "started",
        "message": f"SmartStream started — {len(all_tokens)} tokens via {chosen_acc.nickname}",
    }


@router.post("/start-market-feed")
async def start_market_feed(request: Request, db: AsyncSession = Depends(get_db)):
    """
    Manually start (or restart) the Market Feed using the most recent valid Angel One token.
    Priority: Karthik AO → Wife → Mom.
    Idempotent — safe to call if feed is already running.
    """
    from app.models.account import Account, BrokerType
    from app.engine.ltp_consumer import AngelOneTickerAdapter
    from app.api.v1.services import _service_states, ServiceStatus
    from sqlalchemy import select
    from datetime import date, timezone

    ltp_consumer = getattr(request.app.state, "ltp_consumer", None)
    if not ltp_consumer:
        raise HTTPException(status_code=503, detail="ltp_consumer not initialised — restart backend")

    from app.core.config import settings as _settings

    _CLIENT_ID_TO_BROKER_KEY = {k: v for k, v in [
        (_settings.ANGELONE_KARTHIK_CLIENT_ID, "angelone_karthik"),
        (_settings.ANGELONE_WIFE_CLIENT_ID,    "angelone_wife"),
        (_settings.ANGELONE_MOM_CLIENT_ID,     "angelone_mom"),
    ] if k}
    _PRIORITY_CLIENT_IDS = [
        _settings.ANGELONE_KARTHIK_CLIENT_ID,
        _settings.ANGELONE_WIFE_CLIENT_ID,
        _settings.ANGELONE_MOM_CLIENT_ID,
    ]

    result = await db.execute(
        select(Account).where(Account.broker == BrokerType.ANGELONE, Account.is_active == True)
    )
    ao_accounts = result.scalars().all()
    ao_map = {a.client_id: a for a in ao_accounts}

    chosen_acc = None
    for cid in _PRIORITY_CLIENT_IDS:
        if not cid:
            continue
        acc = ao_map.get(cid)
        if not acc or not acc.access_token or not acc.token_generated_at:
            continue
        token_date = acc.token_generated_at.astimezone(timezone.utc).date()
        if token_date == date.today():
            chosen_acc = acc
            break

    if not chosen_acc:
        raise HTTPException(status_code=400, detail="No valid Angel One token found for today — login first")

    broker_key = _CLIENT_ID_TO_BROKER_KEY.get(chosen_acc.client_id)
    ao_broker  = getattr(request.app.state, broker_key, None)
    if not ao_broker:
        raise HTTPException(status_code=503, detail=f"Broker instance {broker_key!r} not found on app.state")

    feed_token    = chosen_acc.feed_token or ""
    refresh_token = getattr(chosen_acc, "refresh_token", "") or ""
    await ao_broker.load_token(chosen_acc.access_token, feed_token, refresh_token)

    adapter = AngelOneTickerAdapter(
        auth_token  = chosen_acc.access_token,
        api_key     = chosen_acc.api_key or "",
        client_code = chosen_acc.client_id,
        feed_token  = feed_token,
    )
    ltp_consumer.set_angel_adapter(adapter)

    # Collect tokens
    all_tokens = []
    try:
        index_tokens = [int(t) for t in AngelOneTickerAdapter.INDEX_TOKENS.values()]
        all_tokens.extend(index_tokens)
    except Exception as e:
        logger.warning(f"[START-MF] Index token build failed: {e}")

    # Actually start the SmartWebSocketV2 connection in a thread
    import asyncio as _aio
    import concurrent.futures as _cf
    loop = _aio.get_event_loop()
    executor = _cf.ThreadPoolExecutor(max_workers=1, thread_name_prefix="ao_smartstream")
    loop.run_in_executor(executor, lambda: adapter.start(
        tokens=[str(t) for t in all_tokens],
        loop=loop,
        on_tick=ltp_consumer._process_ticks,
    ))
    logger.info(f"[START-MF] adapter.start() dispatched — {len(all_tokens)} tokens")

    _service_states["ws"] = ServiceStatus.RUNNING
    logger.info(f"[START-MF] ✅ Market Feed started via {chosen_acc.nickname}")

    return {"status": "ok", "account": chosen_acc.nickname, "broker_key": broker_key}


@router.get("/health")
async def system_health(request: Request):
    """
    Comprehensive health check for all STAAX dependencies.

    Returns:
      status = "ready"     — DB + Redis + at least 1 broker OK
      status = "degraded"  — some checks fail
      status = "not_ready" — DB or Redis fail
    """
    import asyncio
    import time
    from datetime import datetime
    from zoneinfo import ZoneInfo
    from app.core.config import settings

    IST = ZoneInfo("Asia/Kolkata")
    checks: dict = {}
    state = request.app.state

    # ── Database ──────────────────────────────────────────────────────────────
    try:
        from app.core.database import engine as _db_engine
        from sqlalchemy import text as _text
        t0 = time.monotonic()
        async with _db_engine.connect() as _c:
            await _c.execute(_text("SELECT 1"))
        checks["database"] = {"ok": True, "latency_ms": round((time.monotonic() - t0) * 1000)}
    except Exception as e:
        checks["database"] = {"ok": False, "error": str(e)}

    # ── Redis ─────────────────────────────────────────────────────────────────
    redis = getattr(state, "redis_client", None)
    if redis:
        try:
            t0 = time.monotonic()
            await redis.ping()
            checks["redis"] = {"ok": True, "latency_ms": round((time.monotonic() - t0) * 1000)}
        except Exception as e:
            checks["redis"] = {"ok": False, "error": str(e)}
    else:
        checks["redis"] = {"ok": False, "error": "not initialised"}

    # ── Brokers ───────────────────────────────────────────────────────────────
    broker_map = {
        "broker_karthik_ao": getattr(state, "angelone_karthik", None),
        "broker_mom_ao":     getattr(state, "angelone_mom", None),
        "broker_wife_ao":    getattr(state, "angelone_wife", None),
    }
    broker_ok_count = 0
    for key, broker in broker_map.items():
        if broker is None:
            checks[key] = {"ok": False, "token_valid": False, "error": "not initialised"}
            continue
        try:
            token_ok = bool(broker.is_token_set())
            checks[key] = {"ok": token_ok, "token_valid": token_ok}
            if token_ok:
                broker_ok_count += 1
        except Exception as e:
            checks[key] = {"ok": False, "token_valid": False, "error": str(e)}

    # ── Zerodha: token_valid and ok are based on DB access_token (best-effort) ─
    # Live API calls fail when market is closed — check DB token existence only.
    try:
        from app.models.account import Account as _Account, BrokerType as _BrokerType
        from app.core.database import AsyncSessionLocal as _ASL
        from sqlalchemy import select as _sa_select
        async with _ASL() as _zdb:
            _zres = await _zdb.execute(
                _sa_select(_Account).where(
                    _Account.broker == _BrokerType.ZERODHA,
                    _Account.is_active == True,
                )
            )
            _zacc = _zres.scalar_one_or_none()
        token_valid = bool(_zacc and _zacc.access_token and _zacc.access_token.strip())
        checks["broker_zerodha"] = {"ok": token_valid, "token_valid": token_valid}
        if token_valid:
            broker_ok_count += 1
    except Exception as _ze:
        # Fall back to in-memory adapter check if DB query fails
        zerodha_broker = getattr(state, "zerodha", None)
        if zerodha_broker is None:
            checks["broker_zerodha"] = {"ok": False, "token_valid": False, "error": "not initialised"}
        else:
            try:
                token_ok = bool(zerodha_broker.is_token_set())
                checks["broker_zerodha"] = {"ok": token_ok, "token_valid": token_ok}
                if token_ok:
                    broker_ok_count += 1
            except Exception as _e2:
                checks["broker_zerodha"] = {"ok": False, "token_valid": False, "error": str(_e2)}

    # ── SmartStream (LTPConsumer) ─────────────────────────────────────────────
    ltp_consumer = getattr(state, "ltp_consumer", None)
    if ltp_consumer:
        angel_adapter = getattr(ltp_consumer, "_angel_adapter", None)
        if angel_adapter is not None:
            connected = bool(getattr(angel_adapter, "_connected", False))
            if not connected:
                # Fallback: during reconnect window _connected is False but
                # _running stays True — treat as connected if adapter is running
                connected = bool(getattr(angel_adapter, "_running", False))
        else:
            # Fallback: adapter not yet set, use LTPConsumer._running
            connected = bool(getattr(ltp_consumer, "_running", False))
        checks["smartstream"] = {"ok": connected, "connected": connected}
    else:
        checks["smartstream"] = {"ok": False, "connected": False, "error": "not initialised"}

    # ── Scheduler ────────────────────────────────────────────────────────────
    scheduler = getattr(state, "scheduler", None)
    if scheduler:
        try:
            jobs = scheduler._scheduler.get_jobs()
            checks["scheduler"] = {"ok": True, "jobs": len(jobs)}
        except Exception as e:
            checks["scheduler"] = {"ok": False, "error": str(e)}
    else:
        checks["scheduler"] = {"ok": False, "error": "not initialised"}

    # ── App environment ───────────────────────────────────────────────────────
    checks["app_env"] = settings.APP_ENV

    # ── Overall readiness ─────────────────────────────────────────────────────
    now_ist = datetime.now(IST)
    is_market_hours = (
        now_ist.weekday() < 5 and  # Mon–Fri
        (now_ist.hour, now_ist.minute) >= (9, 15) and
        (now_ist.hour, now_ist.minute) <= (15, 30)
    )

    any_broker_token_valid = (
        checks.get('broker_mom_ao', {}).get('token_valid', False) or
        checks.get('broker_karthik_ao', {}).get('token_valid', False) or
        checks.get('broker_wife_ao', {}).get('token_valid', False) or
        checks.get('broker_zerodha', {}).get('ok', False)
    )

    ready = (
        checks.get('database', {}).get('ok', False) and
        checks.get('redis', {}).get('ok', False) and
        any_broker_token_valid and
        checks.get('scheduler', {}).get('ok', True) and
        (not is_market_hours or checks.get('smartstream', {}).get('connected', False))
    )

    if not ready:
        if not checks.get('database', {}).get('ok', False):
            ready_reason = 'DB_DOWN'
        elif not checks.get('redis', {}).get('ok', False):
            ready_reason = 'REDIS_DOWN'
        elif not any_broker_token_valid:
            ready_reason = 'NO_BROKER_TOKENS'
        elif is_market_hours and not checks.get('smartstream', {}).get('connected', False):
            ready_reason = 'FEED_INACTIVE'
        else:
            ready_reason = 'NOT_READY'
    else:
        ready_reason = 'READY'

    status = "ok" if ready else "degraded"

    return {
        "ready":           ready,
        "ready_reason":    ready_reason,
        "is_market_hours": is_market_hours,
        "status":          status,
        "checks":          checks,
        "timestamp":       now_ist.isoformat(),
    }


@router.get("/expiry-calendar")
async def get_expiry_calendar():
    """
    Returns ExpiryCalendar contents: next expiries and today_is_expiry for each underlying.
    NIFTY + BANKNIFTY expire on Tuesdays; SENSEX expires on Thursdays.
    """
    from app.engine.expiry_calendar import ExpiryCalendar
    cal = ExpiryCalendar.get()
    if not cal.is_built():
        return {
            "built": False,
            "detail": "ExpiryCalendar not yet built — instrument master not loaded",
        }

    underlyings = ["NIFTY", "BANKNIFTY", "SENSEX"]
    result = {
        "built": True,
        "today_is_expiry": {},
        "next_expiries": {},
    }
    from datetime import date as _date
    today = _date.today()
    for u in underlyings:
        result["today_is_expiry"][u] = cal.is_expiry_today(u)
        try:
            cur = cal.get_current_weekly_expiry(u)
            result["next_expiries"][u] = cur.isoformat() if cur else None
        except Exception:
            result["next_expiries"][u] = None

    # Upcoming expiries per underlying (next 5 dates from today)
    result["upcoming_expiries"] = {}
    for u in underlyings:
        try:
            all_exp = cal._expiries.get(u.upper(), [])
            future = [e for e in all_exp if e >= today][:5]
            result["upcoming_expiries"][u] = [d.isoformat() for d in future]
        except Exception:
            result["upcoming_expiries"][u] = []

    return result


async def daily_system_reset():
    """
    Called at 08:00 IST every day.
    Resets kill switch and killed_account_ids so every trading day starts clean.
    """
    import logging
    from app.core.database import AsyncSessionLocal
    from app.models.system_state import SystemState
    from sqlalchemy import select as sa_select
    logger = logging.getLogger(__name__)
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(sa_select(SystemState).where(SystemState.id == 1))
            row = result.scalar_one_or_none()
            if row:
                row.kill_switch_active = False
                row.killed_account_ids = ""
                await db.commit()
                logger.info("[DAILY RESET] Kill switch cleared, all accounts reactivated")
            else:
                logger.info("[DAILY RESET] No system state found — nothing to reset")
    except Exception as e:
        logger.error(f"[DAILY RESET] Failed: {e}")

    # Clear lot size cache so fresh master data is used each trading day
    try:
        from app.engine.algo_runner import algo_runner as _ar_reset
        _ar_reset._lot_size_cache.clear()
        logger.info("[DAILY RESET] Lot size cache cleared")
    except Exception as _e:
        logger.warning(f"[DAILY RESET] Lot size cache clear failed: {_e}")

    # Evict stale tokens from LTP in-memory cache (tokens no longer subscribed)
    try:
        import app.main as _main_mod
        _ltp = getattr(_main_mod, "ltp_consumer", None)
        if _ltp:
            _evicted = _ltp.evict_stale_tokens()
            logger.info(f"[DAILY RESET] LTP eviction complete — {_evicted} stale tokens removed")
    except Exception as _e:
        logger.warning(f"[DAILY RESET] LTP eviction failed: {_e}")
