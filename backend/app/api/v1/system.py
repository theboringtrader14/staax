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
