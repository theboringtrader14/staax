"""AlgoState lifecycle transitions — extracted from AlgoRunner (ARCH-6 Phase 1).

These are standalone async functions that receive their dependencies as parameters
so AlgoRunner can delegate to them without creating circular imports.
"""
import asyncio
import json as _json
import logging
from datetime import datetime
from typing import Optional
from zoneinfo import ZoneInfo

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.models.algo import Algo
from app.models.algo_state import AlgoState, AlgoRunStatus
from app.models.grid import GridEntry, GridStatus
from app.models.order import Order, OrderStatus, ExitReason
from app.engine.execution_errors import ExecutionErrorCode
from app.engine import event_logger as _ev
from app.engine import push_sender as _push

IST = ZoneInfo("Asia/Kolkata")
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Exit-reason mapping (module-level so it is built once per process)
# ---------------------------------------------------------------------------

_REASON_TO_EXIT: dict = {}


def _build_reason_map() -> dict:
    return {
        "sl":              ExitReason.SL,
        "tp":              ExitReason.TP,
        "tsl":             ExitReason.TSL,
        "mtm_sl":          ExitReason.MTM_SL,
        "mtm_tp":          ExitReason.MTM_TP,
        "global_sl":       ExitReason.GLOBAL_SL,
        "sq":              ExitReason.SQ,
        "auto_sq":         ExitReason.AUTO_SQ,
        "terminate":       ExitReason.SQ,        # T button — treat as manual SQ
        "overnight_sl":    ExitReason.SL,
        "entry_fail":      ExitReason.ERROR,
        "error":           ExitReason.ERROR,
        "all_legs_closed": ExitReason.AUTO_SQ,
        "btst_exit":       ExitReason.BTST_EXIT,
        "stbt_exit":       ExitReason.STBT_EXIT,
    }


def resolve_exit_reason(reason: str) -> ExitReason:
    """Return the ExitReason enum member for a raw reason string."""
    global _REASON_TO_EXIT
    if not _REASON_TO_EXIT:
        _REASON_TO_EXIT = _build_reason_map()
    mapped = _REASON_TO_EXIT.get(reason)
    if mapped is not None:
        return mapped
    # Direct enum lookup for any enum value string not in the map
    try:
        return ExitReason(reason)
    except ValueError:
        logger.warning(f"[lifecycle] Unknown exit reason {reason!r} — storing as AUTO_SQ")
        return ExitReason.AUTO_SQ


# ---------------------------------------------------------------------------
# Decision log
# ---------------------------------------------------------------------------

async def log_decision(
    db: AsyncSession,
    order: Optional[Order],
    event_type: str,
    reason: str,
    trigger_value=None,
    threshold_value=None,
    ltp=None,
    metadata: Optional[dict] = None,
) -> None:
    """Record WHY an exit/entry decision was made. Non-fatal — never raises."""
    try:
        from sqlalchemy import text as _text
        await db.execute(_text('''
            INSERT INTO decision_log
            (user_id, algo_id, order_id, event_type, reason,
             trigger_value, threshold_value, ltp, sl_price, target_price,
             metadata, is_practix)
            VALUES
            (:uid, :aid, :oid, :et, :reason,
             :tv, :thv, :ltp, :sl, :target,
             :meta, :ip)
        '''), {
            "uid":    str(order.user_id)  if order and order.user_id  else None,
            "aid":    str(order.algo_id)  if order and order.algo_id  else None,
            "oid":    str(order.id)       if order                    else None,
            "et":     event_type,
            "reason": reason,
            "tv":     trigger_value,
            "thv":    threshold_value,
            "ltp":    ltp,
            "sl":     getattr(order, 'sl_actual', None) if order else None,
            "target": getattr(order, 'target',    None) if order else None,
            "meta":   _json.dumps(metadata) if metadata else None,
            "ip":     order.is_practix if order else True,
        })
    except Exception as e:
        logger.warning(f"decision_log write failed (non-fatal): {e}")


# ---------------------------------------------------------------------------
# P&L computation
# ---------------------------------------------------------------------------

def compute_pnl(order: Order, exit_price: float) -> Optional[float]:
    """Compute realised P&L for a closed order."""
    if order.fill_price is None or order.fill_price == 0:
        logger.warning(
            f"[ENGINE] Auto-square P&L unknown — fill_price missing for order {order.id} "
            f"({order.symbol}). Setting pnl=None."
        )
        return None
    qty = order.quantity or 0
    if order.direction == "buy":
        return (exit_price - order.fill_price) * qty
    else:
        return (order.fill_price - exit_price) * qty


# ---------------------------------------------------------------------------
# Order close
# ---------------------------------------------------------------------------

async def close_order(
    db: AsyncSession,
    order: Order,
    exit_price: float,
    reason: str,
) -> None:
    """Update Order to CLOSED in DB and compute P&L."""
    # Sanity guard: detect index LTP contamination.
    # For option orders (BFO/NFO), the exit_price must be an option premium
    # (small), not an underlying index value (large).  If exit_price is more
    # than 50× the entry fill_price the value is almost certainly the index
    # spot price leaking into the option's LTP slot — abort rather than
    # corrupt the DB with a phantom -₹15L P&L.
    _fill = float(order.fill_price or 0)
    if _fill > 0 and exit_price > _fill * 50:
        logger.error(
            f"[ENGINE] ABORTED close_order — suspicious exit_price {exit_price} "
            f"for {order.symbol} (fill={_fill}, ratio={exit_price/_fill:.1f}x). "
            f"Likely index LTP contamination (BFO option subscribed with wrong "
            f"exchangeType). Reason={reason}. Order NOT closed."
        )
        return
    order.status      = OrderStatus.CLOSED
    order.ltp         = exit_price   # snapshot LTP at close
    order.exit_price  = exit_price
    order.exit_time   = datetime.now(IST)        # datetime, not isoformat() string
    order.exit_reason = resolve_exit_reason(reason)
    order.pnl         = compute_pnl(order, exit_price)
    # Mark SL order as placed when a SL/TSL exit fires (broker square-off dispatched
    # by exit_all/on_sl_hit path). broker_order_id is set at entry, not exit.
    # sl_order_id is filled by the broker square-off caller when it has a response.
    if reason in ("sl", "tsl", "overnight_sl") and not getattr(order, "sl_order_status", None):
        order.sl_order_status = "placed"


# ---------------------------------------------------------------------------
# AlgoState transitions
# ---------------------------------------------------------------------------

async def set_no_trade(
    db: AsyncSession,
    algo_state: AlgoState,
    grid_entry: GridEntry,
    reason: str,
    algo_name: str = "",
) -> None:
    """Transition algo to NO_TRADE state."""
    algo_state.status      = AlgoRunStatus.NO_TRADE
    algo_state.exit_reason = reason
    grid_entry.status      = GridStatus.NO_TRADE
    await db.commit()
    try:
        name = algo_name or str(getattr(algo_state, 'algo_id', 'Algo'))
        asyncio.create_task(_push.send_push(
            "⏰ Missed",
            f"{name} — Entry window passed",
        ))
    except Exception:
        pass


async def set_error(
    db: AsyncSession,
    algo_state: AlgoState,
    grid_entry: GridEntry,
    msg: str,
    algo_name: str = "",
) -> None:
    """Transition algo to ERROR state."""
    algo_state.status        = AlgoRunStatus.ERROR
    algo_state.error_message = msg
    grid_entry.status        = GridStatus.ERROR
    await db.commit()
    await _ev.error(
        f"{getattr(algo_state, 'algo_id', '')} · {msg}",
        algo_name=str(getattr(algo_state, "algo_id", "")), source="engine",
    )
    try:
        name = algo_name or str(getattr(algo_state, 'algo_id', 'Algo'))
        asyncio.create_task(_push.send_push(
            "❌ Error",
            f"{name} — {str(msg)[:80]}",
        ))
    except Exception:
        pass


async def set_waiting(
    db: AsyncSession,
    algo_state: AlgoState,
    grid_entry: GridEntry,
    msg: str,
    sl_tp_monitor=None,
) -> None:
    """Mark algo as WAITING (not ERROR) — used when SmartStream is down for W&T/ORB.
    Algo stays in WAITING state; ticks will fire W&T/ORB once stream connects.

    sl_tp_monitor: optional SLTPMonitor instance — if provided, open positions are
    deregistered as a defensive guard against edge-cases with partial fills.
    """
    algo_state.status  = AlgoRunStatus.WAITING
    grid_entry.status  = GridStatus.ALGO_ACTIVE
    await db.commit()
    logger.warning(
        f"⚠️ [W&T/ORB] {getattr(algo_state, 'algo_id', '')} set to WAITING: {msg}"
    )
    is_feed_error = (msg == ExecutionErrorCode.FEED_INACTIVE or str(msg) == "FEED_INACTIVE")
    _wait_suffix = " (feed inactive)" if is_feed_error else ""
    await _ev.warn(
        f"{getattr(algo_state, 'algo_id', '')} · WAITING: {msg}{_wait_suffix}",
        algo_name=str(getattr(algo_state, "algo_id", "")),
        source="engine",
    )
    # Defensive: deregister any SL/TP monitors that may be armed for this algo.
    # In the normal W&T/ORB flow this runs before orders are placed (empty loop),
    # but guards edge-cases where WAITING is triggered after partial fills.
    if sl_tp_monitor:
        try:
            open_res = await db.execute(
                select(Order).where(
                    and_(
                        Order.grid_entry_id == grid_entry.id,
                        Order.status == OrderStatus.OPEN,
                    )
                )
            )
            for _ord in open_res.scalars().all():
                sl_tp_monitor.remove_position(str(_ord.id))
        except Exception as _e:
            logger.warning(f"[W&T] SL/TP deregister on set_waiting failed (non-fatal): {_e}")


async def check_algo_complete(
    grid_entry_id: str,
    mtm_monitor=None,
) -> None:
    """After a leg closes, check if all legs are done.
    If yes, close the AlgoState.

    mtm_monitor: optional MTMMonitor instance — if provided, algo tracking is
    deregistered on completion to prevent memory leaks over long uptime.
    """
    async with AsyncSessionLocal() as db:
        open_count_result = await db.execute(
            select(Order).where(
                and_(
                    Order.grid_entry_id == grid_entry_id,
                    Order.status == OrderStatus.OPEN,
                )
            )
        )
        open_orders = open_count_result.scalars().all()

        if not open_orders:
            state_result = await db.execute(
                select(AlgoState, GridEntry)
                .join(GridEntry, AlgoState.grid_entry_id == GridEntry.id)
                .where(AlgoState.grid_entry_id == grid_entry_id)
            )
            row = state_result.one_or_none()
            if row:
                algo_state, grid_entry = row
                if algo_state.status == AlgoRunStatus.ACTIVE:
                    algo_state.status      = AlgoRunStatus.CLOSED
                    algo_state.closed_at   = datetime.now(IST)
                    algo_state.exit_reason = "all_legs_closed"
                    grid_entry.status      = GridStatus.ALGO_CLOSED
                    await db.commit()
                    logger.info(f"✅ All legs closed — AlgoState closed: {grid_entry_id}")

                    # System Log: algo fully closed with total P&L
                    try:
                        closed_result = await db.execute(
                            select(Order).where(
                                Order.grid_entry_id == grid_entry_id,
                                Order.status == OrderStatus.CLOSED,
                            )
                        )
                        closed_orders = closed_result.scalars().all()
                        _total_pnl = sum(float(o.pnl or 0) for o in closed_orders)
                        _algo_result = await db.execute(
                            select(Algo).where(Algo.id == algo_state.algo_id)
                        )
                        _algo = _algo_result.scalar_one_or_none()
                        _algo_name = getattr(_algo, "name", str(algo_state.algo_id))
                        _sign = "+" if _total_pnl >= 0 else ""
                        await _ev.success(
                            f"{_algo_name} · ALL LEGS CLOSED | Total P&L {_sign}₹{_total_pnl:,.2f}",
                            algo_name=_algo_name, source="engine",
                        )
                    except Exception as _log_err:
                        logger.warning(f"[ev] all-legs-closed log failed: {_log_err}")

                    # Clean up MTM tracking to prevent memory leak over long uptime
                    if mtm_monitor:
                        mtm_monitor.deregister_algo(str(algo_state.algo_id))


async def mark_error(grid_entry_id: str, msg: str) -> None:
    """Open a fresh DB session and call set_error for the given grid entry."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(AlgoState, GridEntry)
            .join(GridEntry, AlgoState.grid_entry_id == GridEntry.id)
            .where(AlgoState.grid_entry_id == grid_entry_id)
        )
        row = result.one_or_none()
        if row:
            await set_error(db, row[0], row[1], msg)
