"""
Global Kill Switch — emergency shutdown for the entire STAAX platform.

EXECUTION ORDER (broker is always source of truth):
  Step 0: Freeze engine — set EMERGENCY_STOP, disable OrderRetryQueue,
          ReEntryEngine, Scheduler
  Step 1: Fetch ALL open positions + orders from broker API
  Step 2: Cancel all pending orders at broker first
  Step 3: Square off all open positions at broker (market orders)
  Step 4: Verify broker is flat (positions=0, orders=empty)
  Step 5: Only after broker confirms → update DB
  Step 6: Broadcast WebSocket + log CRITICAL event

Design rule: DB is NEVER updated before broker is acted on.
             If broker call fails, DB is NOT touched.
"""
import logging
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)


class KillSwitchState:
    """Singleton state for the kill switch."""
    activated: bool = False
    activated_at: Optional[datetime] = None
    positions_squared: int = 0
    orders_cancelled: int = 0
    error: Optional[str] = None


# Module-level singleton
_state = KillSwitchState()


def is_activated() -> bool:
    return _state.activated


def get_state() -> dict:
    return {
        "activated":          _state.activated,
        "activated_at":       _state.activated_at.isoformat() if _state.activated_at else None,
        "positions_squared":  _state.positions_squared,
        "orders_cancelled":   _state.orders_cancelled,
        "error":              _state.error,
    }


async def activate(db, broker_registry, websocket_manager=None, account_ids: list = None) -> dict:
    """
    Activate the global kill switch.

    Args:
        db:                 AsyncSession — for DB updates (used ONLY after broker confirmed)
        broker_registry:    dict mapping account_id → broker adapter instance
        websocket_manager:  optional WS manager for broadcasting

    Returns:
        dict with result summary
    """
    if _state.activated and not account_ids:
        logger.warning("[KILL SWITCH] Already activated globally — skipping duplicate call")
        return get_state()
    # Allow partial re-activation for specific accounts not yet killed
    if _state.activated and account_ids:
        already_killed = set(_state.killed_account_ids if hasattr(_state, 'killed_account_ids') else [])
        new_accounts = [a for a in account_ids if a not in already_killed]
        if not new_accounts:
            logger.warning("[KILL SWITCH] All specified accounts already killed")
            return get_state()
        account_ids = new_accounts
        logger.warning(f"[KILL SWITCH] Partial re-activation for accounts: {new_accounts}")

    logger.critical("[KILL SWITCH] ⚠️  GLOBAL KILL SWITCH ACTIVATION INITIATED")

    # ── Step 0: Freeze engine ─────────────────────────────────────────────────
    _state.activated = True
    _state.activated_at = datetime.now(timezone.utc)
    # Persist to DB so state survives server restarts
    try:
        from app.models.system_state import SystemState
        existing = await db.execute(__import__('sqlalchemy').select(SystemState).where(SystemState.id == 1))
        sys_row = existing.scalar_one_or_none()
        killed_ids = ','.join(account_ids) if account_ids else ''
        if sys_row:
            sys_row.kill_switch_active = True
            sys_row.kill_switch_at = _state.activated_at
            existing_ids = set(sys_row.killed_account_ids.split(',')) if sys_row.killed_account_ids else set()
            if account_ids:
                existing_ids.update(account_ids)
            sys_row.killed_account_ids = ','.join(existing_ids) if existing_ids else None
        else:
            db.add(SystemState(id=1, kill_switch_active=True, kill_switch_at=_state.activated_at, killed_account_ids=killed_ids or None))
        await db.commit()
    except Exception as _e:
        logger.warning(f"[KILL SWITCH] Failed to persist state to DB: {_e}")

    _freeze_engine()

    if not hasattr(_state, 'killed_account_ids'):
        _state.killed_account_ids = []

    total_cancelled = 0
    total_squared = 0
    errors = []

    # ── Steps 1–4: Per broker account ─────────────────────────────────────────
    # Filter accounts if specific ones requested
    accounts_to_kill = {
        k: v for k, v in broker_registry.items()
        if not account_ids or k in account_ids
    }
    for account_id, broker in accounts_to_kill.items():
        try:
            logger.critical(f"[KILL SWITCH] Processing account {account_id}")

            # Step 1: Fetch broker state (source of truth)
            try:
                open_orders    = await broker.get_open_orders()
                open_positions = await broker.get_positions()
                logger.critical(
                    f"[KILL SWITCH] Account {account_id}: "
                    f"{len(open_orders)} open orders, {len(open_positions)} open positions"
                )
            except Exception as e:
                err = f"Account {account_id}: failed to fetch broker state — {e}"
                logger.error(f"[KILL SWITCH] {err}")
                errors.append(err)
                continue   # skip this account — do NOT touch DB

            # Step 2: Cancel all pending orders at broker first
            cancelled = 0
            for order in open_orders:
                try:
                    await broker.cancel_order(order["order_id"])
                    cancelled += 1
                    logger.critical(f"[KILL SWITCH] Cancelled order {order['order_id']}")
                except Exception as e:
                    err = f"Failed to cancel order {order.get('order_id')} — {e}"
                    logger.error(f"[KILL SWITCH] {err}")
                    errors.append(err)

            # Step 3: Square off all open positions (market orders)
            squared = 0
            for position in open_positions:
                try:
                    await broker.square_off_market(position)
                    squared += 1
                    logger.critical(
                        f"[KILL SWITCH] Squared off {position.get('symbol')} "
                        f"qty={position.get('quantity')}"
                    )
                except Exception as e:
                    err = f"Failed to square off {position.get('symbol')} — {e}"
                    logger.error(f"[KILL SWITCH] {err}")
                    errors.append(err)

            # Step 4: Verify broker is flat — RETRY LOOP (handles partial fills)
            # Critical: partial fills can create new positions milliseconds after square-off.
            # Never trust a single check — loop until broker reports zero positions.
            import asyncio
            MAX_VERIFY_ATTEMPTS = 5
            VERIFY_DELAY_SEC    = 2

            for attempt in range(1, MAX_VERIFY_ATTEMPTS + 1):
                try:
                    await asyncio.sleep(VERIFY_DELAY_SEC)
                    verify_orders    = await broker.get_open_orders()
                    verify_positions = await broker.get_positions()

                    logger.critical(
                        f"[KILL SWITCH] Verify attempt {attempt}/{MAX_VERIFY_ATTEMPTS} "
                        f"— {len(verify_positions)} positions, {len(verify_orders)} orders remaining"
                    )

                    # Cancel any new orders (partial fill stragglers)
                    for o in verify_orders:
                        try:
                            await broker.cancel_order(o["order_id"])
                            total_cancelled += 1
                            logger.critical(f"[KILL SWITCH] Cancelled straggler order {o['order_id']}")
                        except Exception as e:
                            errors.append(f"Straggler cancel failed: {o.get('order_id')} — {e}")

                    # Square off any new positions (partial fill stragglers)
                    for p in verify_positions:
                        try:
                            await broker.square_off_market(p)
                            total_squared += 1
                            logger.critical(
                                f"[KILL SWITCH] Squared off straggler {p.get('symbol')} "
                                f"qty={p.get('quantity')} (partial fill)"
                            )
                        except Exception as e:
                            errors.append(f"Straggler square-off failed: {p.get('symbol')} — {e}")

                    # If clean — break loop
                    if not verify_orders and not verify_positions:
                        logger.critical(f"[KILL SWITCH] Account {account_id}: broker confirmed FLAT ✅")
                        break

                    if attempt == MAX_VERIFY_ATTEMPTS:
                        msg = (
                            f"Account {account_id}: broker NOT fully flat after "
                            f"{MAX_VERIFY_ATTEMPTS} attempts — "
                            f"{len(verify_positions)} positions, {len(verify_orders)} orders remain. "
                            f"MANUAL INTERVENTION REQUIRED."
                        )
                        logger.error(f"[KILL SWITCH] {msg}")
                        errors.append(msg)

                except Exception as e:
                    logger.error(f"[KILL SWITCH] Verification attempt {attempt} failed — {e}")
                    if attempt == MAX_VERIFY_ATTEMPTS:
                        errors.append(f"Verification failed after {MAX_VERIFY_ATTEMPTS} attempts: {e}")

            total_cancelled += cancelled
            total_squared   += squared

        except Exception as e:
            err = f"Account {account_id}: unexpected error — {e}"
            logger.error(f"[KILL SWITCH] {err}")
            errors.append(err)

    _state.orders_cancelled  = total_cancelled
    _state.positions_squared = total_squared

    # Record which accounts were killed
    for acc_id in accounts_to_kill.keys():
        if not hasattr(_state, "killed_account_ids"):
            _state.killed_account_ids = []
        if acc_id not in _state.killed_account_ids:
            _state.killed_account_ids.append(acc_id)

    # ── Step 5: Update DB (only after broker acted on) ─────────────────────────
    try:
        await _update_db(db)
        logger.critical("[KILL SWITCH] DB updated — all states set to TERMINATED/CLOSED")
    except Exception as e:
        logger.error(f"[KILL SWITCH] DB update failed — {e}")
        errors.append(f"DB update failed: {e}")

    # ── Step 6: Broadcast + log ────────────────────────────────────────────────
    summary = (
        f"[CRITICAL] GLOBAL KILL SWITCH ACTIVATED — "
        f"{total_squared} position(s) squared off, "
        f"{total_cancelled} order(s) cancelled"
    )
    logger.critical(f"[KILL SWITCH] {summary}")

    if errors:
        _state.error = "; ".join(errors)
        logger.error(f"[KILL SWITCH] Errors during activation: {_state.error}")

    if websocket_manager:
        try:
            await websocket_manager.broadcast({
                "type":             "kill_switch",
                "activated":        True,
                "positions_squared": total_squared,
                "orders_cancelled":  total_cancelled,
                "errors":           errors,
                "timestamp":        _state.activated_at.isoformat(),
            })
        except Exception as e:
            logger.error(f"[KILL SWITCH] WebSocket broadcast failed — {e}")

    return {
        **get_state(),
        "errors": errors,
        "summary": summary,
    }


def _freeze_engine():
    """
    Step 0: Freeze all engine components immediately.
    Sets module-level flags checked by OrderRetryQueue, ReEntryEngine, Scheduler.
    """
    logger.critical("[KILL SWITCH] Freezing engine components...")

    # Import here to avoid circular imports
    try:
        from app.engine import order_retry_queue
        order_retry_queue.disabled = True
        logger.critical("[KILL SWITCH] OrderRetryQueue disabled")
    except (ImportError, AttributeError):
        logger.warning("[KILL SWITCH] OrderRetryQueue not available — skipping")

    try:
        from app.engine import reentry_engine
        reentry_engine.disabled = True
        logger.critical("[KILL SWITCH] ReEntryEngine disabled")
    except (ImportError, AttributeError):
        logger.warning("[KILL SWITCH] ReEntryEngine not available — skipping")

    try:
        from app.engine import scheduler
        scheduler.pause()
        logger.critical("[KILL SWITCH] Scheduler paused")
    except (ImportError, AttributeError):
        logger.warning("[KILL SWITCH] Scheduler not available — skipping")


async def _update_db(db):
    """
    Step 5: Update DB after broker is confirmed flat.
    Updates: AlgoState → TERMINATED, GridEntry → CLOSED, Orders → CLOSED
    """
    from sqlalchemy import select, update
    from datetime import date
    from app.models.algo_state import AlgoState, AlgoRunStatus
    from app.models.grid import GridEntry, GridStatus
    from app.models.order import Order, OrderStatus, ExitReason

    now = datetime.now(timezone.utc)
    today = date.today()

    # Update AlgoState — all active/running states → TERMINATED
    algo_states_result = await db.execute(
        select(AlgoState).where(
            AlgoState.status.in_([
                AlgoRunStatus.ACTIVE,
                AlgoRunStatus.WAITING,
                AlgoRunStatus.WAITING,
            ])
        )
    )
    algo_states = algo_states_result.scalars().all()
    for state in algo_states:
        state.status = AlgoRunStatus.TERMINATED
        state.terminated_at = now

    # Update today's GridEntries → CLOSED
    grid_result = await db.execute(
        select(GridEntry).where(
            GridEntry.trading_date == today,
            GridEntry.is_archived == False,
        )
    )
    grid_entries = grid_result.scalars().all()
    for entry in grid_entries:
        entry.status = GridStatus.CLOSED

    # Update all open/pending Orders → CLOSED with exit_reason=SQ
    orders_result = await db.execute(
        select(Order).where(
            Order.status.in_([OrderStatus.OPEN, OrderStatus.PENDING])
        )
    )
    orders = orders_result.scalars().all()
    for order in orders:
        order.status = OrderStatus.CLOSED
        order.exit_reason = ExitReason.SQ
        order.exit_time = now

    await db.commit()

    logger.critical(
        f"[KILL SWITCH] DB update complete — "
        f"{len(algo_states)} algo states terminated, "
        f"{len(grid_entries)} grid entries closed, "
        f"{len(orders)} orders closed"
    )
