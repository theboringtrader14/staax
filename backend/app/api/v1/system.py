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
            if acc.broker == BrokerType.zerodha and hasattr(request.app.state, "zerodha"):
                registry[str(acc.id)] = request.app.state.zerodha
            elif acc.broker == BrokerType.angelone and acc.nickname == "Mom" and hasattr(request.app.state, "angelone_mom"):
                registry[str(acc.id)] = request.app.state.angelone_mom
            elif acc.broker == BrokerType.angelone and hasattr(request.app.state, "angelone_wife"):
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
async def get_dashboard_stats(db: AsyncSession = Depends(get_db)):
    """
    Returns stat card values for the Dashboard:
      active_algos    — grid entries today that have been triggered (not NO_TRADE/ERROR/CLOSED)
      open_positions  — orders with status=OPEN for today
      today_pnl       — sum of closed-order P&L for today
      fy_pnl          — sum of all closed-order P&L in the current financial year
    """
    from datetime import date as _date, datetime as _dt, timezone as _tz, timedelta as _td
    from sqlalchemy import func, select as sa_select
    from app.models.order import Order, OrderStatus

    today = _date.today()

    # IST midnight as UTC — used to scope active/open counts to today only
    _IST = _tz(_td(hours=5, minutes=30))
    today_start_ist = _dt.now(_IST).replace(hour=0, minute=0, second=0, microsecond=0)
    today_start_utc = today_start_ist.astimezone(_tz.utc)

    # ── Active algos: distinct algo_ids with OPEN orders created today (IST) ───
    active_result = await db.execute(
        sa_select(func.count(func.distinct(Order.algo_id))).where(
            Order.status == OrderStatus.OPEN,
            Order.created_at >= today_start_utc,
        )
    )
    active_algos = active_result.scalar() or 0

    # ── Open positions: OPEN orders created today (IST) ───────────────────────
    open_result = await db.execute(
        sa_select(func.count(Order.id)).where(
            Order.status == OrderStatus.OPEN,
            Order.created_at >= today_start_utc,
        )
    )
    open_positions = open_result.scalar() or 0

    # ── Today P&L: sum of pnl for closed orders with fill today ───────────────
    today_pnl_result = await db.execute(
        sa_select(func.coalesce(func.sum(Order.pnl), 0)).where(
            Order.status == OrderStatus.CLOSED,
            func.date(Order.exit_time) == today,
        )
    )
    today_pnl = float(today_pnl_result.scalar() or 0)

    # ── FY P&L: April 1 of current financial year to today ────────────────────
    # Indian FY: Apr 1 – Mar 31
    fy_start_year = today.year if today.month >= 4 else today.year - 1
    from datetime import datetime as _dt, timezone as _tz
    fy_start = _dt(fy_start_year, 4, 1, tzinfo=_tz.utc)

    fy_pnl_result = await db.execute(
        sa_select(func.coalesce(func.sum(Order.pnl), 0)).where(
            Order.status == OrderStatus.CLOSED,
            Order.exit_time >= fy_start,
        )
    )
    fy_pnl = float(fy_pnl_result.scalar() or 0)

    # ── MTM total: sum of unrealised P&L for currently OPEN orders ────────────
    mtm_result = await db.execute(
        sa_select(func.coalesce(func.sum(Order.pnl), 0)).where(
            Order.status == OrderStatus.OPEN,
            Order.pnl.isnot(None),
        )
    )
    mtm_total = float(mtm_result.scalar() or 0)

    return {
        "active_algos":   active_algos,
        "open_positions": open_positions,
        "today_pnl":      today_pnl,
        "fy_pnl":         fy_pnl,
        "mtm_total":      mtm_total,
    }


# ── NR-3: Instrument ticker — live LTP for sidebar display ───────────────────

# Zerodha instrument tokens for index instruments
TICKER_INSTRUMENTS = {
    "NIFTY":     256265,
    "BANKNIFTY": 260105,
    "SENSEX":    265,
    "FINNIFTY":  257801,
    "MIDCPNIFTY": 288009,
    "GOLDM":     58424839,   # MCX GOLDM continuous futures
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

    _NICKNAME_TO_BROKER_KEY = {
        "Karthik AO": "angelone_karthik",
        "Wife":       "angelone_wife",
        "Mom":        "angelone_mom",
    }
    _PRIORITY = ["Karthik AO", "Wife", "Mom"]

    result = await db.execute(
        select(Account).where(Account.broker == BrokerType.ANGELONE, Account.is_active == True)
    )
    ao_accounts = result.scalars().all()
    ao_map = {a.nickname: a for a in ao_accounts}

    chosen_acc = None
    for nick in _PRIORITY:
        acc = ao_map.get(nick)
        if not acc or not acc.access_token or not acc.token_generated_at:
            continue
        token_date = acc.token_generated_at.astimezone(timezone.utc).date()
        if token_date == date.today():
            chosen_acc = acc
            break

    if not chosen_acc:
        raise HTTPException(status_code=400, detail="No valid Angel One token found for today — login first")

    broker_key = _NICKNAME_TO_BROKER_KEY[chosen_acc.nickname]
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
