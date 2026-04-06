"""
Orders API — live intraday order view + manual controls.
Fully wired to PostgreSQL.

Endpoints:
  GET    /orders/             — list orders (today by default, filterable by date/algo/account)
  GET    /orders/{order_id}   — single order detail
  PATCH  /orders/{order_id}/exit-price  — manually correct exit price
  POST   /orders/{algo_id}/sync         — manually sync an untracked broker position
  POST   /orders/{algo_id}/square-off   — square off all positions for an algo
  WS     /orders/ws/live                — push live order/MTM updates to frontend
"""
from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_
from pydantic import BaseModel
from typing import Optional
from datetime import date, datetime, timezone
import logging
import uuid as _uuid
from app.core.database import get_db
logger = logging.getLogger(__name__)
from app.engine.execution_manager import execution_manager
from app.models.order import Order, OrderStatus, ExitReason
from app.models.grid import GridEntry, GridStatus
from app.models.algo import Algo
from app.models.account import Account
from app.models.algo_state import AlgoState, AlgoRunStatus

router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────

class ExitPriceRequest(BaseModel):
    exit_price: float


class SyncOrderRequest(BaseModel):
    broker_order_id: str   # Order ID from broker platform (Zerodha: Order ID, Angel One: Broker Order No.)
    account_id:      str   # which account this order belongs to (to pick correct broker)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _order_to_dict(order: Order) -> dict:
    return {
        "id":                str(order.id),
        "grid_entry_id":     str(order.grid_entry_id),
        "algo_id":           str(order.algo_id),
        "leg_id":            str(order.leg_id),
        "account_id":        str(order.account_id),
        "broker_order_id":   order.broker_order_id,
        "is_practix":        order.is_practix,
        "is_synced":         order.is_synced,
        "is_overnight":      order.is_overnight,
        "symbol":            order.symbol,
        "exchange":          order.exchange,
        "expiry_date":       order.expiry_date,
        "direction":         order.direction,
        "lots":              order.lots,
        "quantity":          order.quantity,
        "entry_type":        order.entry_type,
        "entry_reference":   order.entry_reference,
        "instrument_token":  order.instrument_token,
        "fill_price":        order.fill_price,
        "fill_time":         order.fill_time.isoformat() if order.fill_time else None,
        "ltp":               order.ltp,
        "sl_original":       order.sl_original,
        "sl_actual":         order.sl_actual,
        "tsl_trail_count":   order.tsl_trail_count,
        "target":            order.target,
        "exit_price":        order.exit_price_manual if order.exit_price_manual else order.exit_price,
        "exit_price_raw":    order.exit_price,
        "exit_price_manual": order.exit_price_manual,
        "exit_time":         order.exit_time.isoformat() if order.exit_time and order.status == OrderStatus.CLOSED else None,
        "exit_reason":       order.exit_reason.value if order.exit_reason else None,
        "pnl":               order.pnl,
        "status":            order.status.value if order.status else "pending",
        "journey_level":     order.journey_level,
        "error_message":     order.error_message,
        "created_at":        order.created_at.isoformat() if order.created_at else None,
        "updated_at":        order.updated_at.isoformat() if order.updated_at else None,
    }


def _parse_date(date_str: Optional[str]) -> Optional[date]:
    if not date_str:
        return None
    try:
        return datetime.strptime(date_str, "%Y-%m-%d").date()
    except ValueError:
        return None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/")
async def list_orders(
    trading_date: Optional[str] = Query(None, description="YYYY-MM-DD, defaults to today"),
    algo_id:      Optional[str] = Query(None),
    account_id:   Optional[str] = Query(None),
    status:       Optional[str] = Query(None),   # pending|open|closed|error
    is_practix:   Optional[bool] = Query(None),  # true=PRACTIX, false=LIVE, None=all
    db: AsyncSession = Depends(get_db),
):
    """
    List orders for a trading day.
    Defaults to today. Filterable by algo, account, status.
    Groups results by algo_id for the Orders page view.
    """
    target_date = _parse_date(trading_date) or date.today()

    # Find all GridEntries for this day
    day_name = target_date.strftime('%a').lower()  # 'mon', 'tue', etc.

    grid_result = await db.execute(
        select(GridEntry).where(
            GridEntry.trading_date == target_date,
            GridEntry.status != GridStatus.NO_TRADE,
        )
    )
    grid_entries = grid_result.scalars().all()
    grid_entry_ids = [e.id for e in grid_entries]

    # Also include open orders from same day_of_week (BTST/STBT/Positional carry-forwards)
    open_ge_result = await db.execute(
        select(GridEntry).where(
            GridEntry.day_of_week == day_name,
            GridEntry.trading_date != target_date,
            GridEntry.status != GridStatus.NO_TRADE,
        )
    )
    open_ge_ids = [e.id for e in open_ge_result.scalars().all()]

    # We'll include orders from open_ge_ids only if they have open status
    all_grid_entry_ids = list(set(grid_entry_ids + open_ge_ids))

    if not all_grid_entry_ids:
        return {
            "trading_date": target_date.isoformat(),
            "orders":       [],
            "by_algo":      {},
            "groups":       [],
            "total":        0,
        }

    # Build query
    conditions = [
        or_(
            Order.grid_entry_id.in_(grid_entry_ids),  # today's entries — all statuses
            and_(
                Order.grid_entry_id.in_(open_ge_ids),  # carry-forward entries — open only
                Order.status == OrderStatus.OPEN,
            )
        )
    ]
    if algo_id:
        conditions.append(Order.algo_id == algo_id)
    if account_id:
        conditions.append(Order.account_id == account_id)
    if is_practix is not None:
        conditions.append(Order.is_practix == is_practix)
    if status:
        try:
            conditions.append(Order.status == OrderStatus(status))
        except ValueError:
            pass  # ignore invalid status filter

    result = await db.execute(
        select(Order).where(and_(*conditions)).order_by(Order.created_at)
    )
    orders = result.scalars().all()

    orders_list = [_order_to_dict(o) for o in orders]

    # Group by algo_id
    by_algo: dict = {}
    for o in orders_list:
        aid = o["algo_id"]
        if aid not in by_algo:
            by_algo[aid] = []
        by_algo[aid].append(o)

    # Build groups: AlgoGroup-shaped list for the Orders page
    groups = []
    if by_algo:
        try:
            algo_uuid_ids = [_uuid.UUID(aid) for aid in by_algo.keys()]
            algo_result = await db.execute(
                select(Algo, Account)
                .join(Account, Algo.account_id == Account.id, isouter=True)
                .where(Algo.id.in_(algo_uuid_ids))
            )
            algo_meta: dict = {}
            for a, acc in algo_result.all():
                algo_meta[str(a.id)] = {
                    "algo_name": a.name,
                    "account":   acc.nickname if acc else "",
                    "mtm_sl":    a.mtm_sl or 0,
                    "mtm_tp":    a.mtm_tp or 0,
                }
        except Exception as e:
            logger.warning(f"[orders] groups metadata fetch failed: {e}")
            algo_meta = {}

        for aid, group_orders in by_algo.items():
            meta = algo_meta.get(aid, {})
            mtm  = round(sum((o.get("pnl") or 0.0) for o in group_orders), 2)
            groups.append({
                "algo_id":   aid,
                "algo_name": meta.get("algo_name", ""),
                "account":   meta.get("account", ""),
                "mtm":       mtm,
                "mtm_sl":    meta.get("mtm_sl", 0),
                "mtm_tp":    meta.get("mtm_tp", 0),
                "orders":    group_orders,
            })

    return {
        "trading_date": target_date.isoformat(),
        "orders":       orders_list,
        "by_algo":      by_algo,
        "groups":       groups,
        "total":        len(orders_list),
    }



@router.get("/replay")
async def get_trade_replay(
    algo_id: str,
    date: str,  # YYYY-MM-DD
    db: AsyncSession = Depends(get_db),
):
    """
    Return a Trade Replay payload for a given algo_id and date.
    Fetches all orders for that algo on that day (using fill_time for date match),
    builds separate ENTRY and EXIT events, running P&L curve, and summary stats.
    """
    from sqlalchemy import cast, Date as SADate
    import uuid as _uuid_mod
    import datetime as _dt

    target_date = _parse_date(date)
    if not target_date:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")

    try:
        algo_uuid = _uuid_mod.UUID(algo_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid algo_id UUID.")

    # Fetch algo name
    algo_result = await db.execute(select(Algo).where(Algo.id == algo_uuid))
    algo_obj = algo_result.scalar_one_or_none()
    algo_name = algo_obj.name if algo_obj else algo_id

    # Fetch all orders for this algo on the given date using fill_time
    result = await db.execute(
        select(Order).where(
            Order.algo_id == algo_uuid,
            cast(Order.fill_time, SADate) == target_date,
        ).order_by(Order.fill_time)
    )
    orders_raw = result.scalars().all()

    empty_summary = {
        "entry_time": None,
        "exit_time": None,
        "total_pnl": 0,
        "peak_pnl": 0,
        "max_drawdown": 0,
        "duration_minutes": 0,
    }

    if not orders_raw:
        return {
            "algo_name": algo_name,
            "date": date,
            "events": [],
            "summary": empty_summary,
        }

    IST = _dt.timezone(_dt.timedelta(hours=5, minutes=30))

    def _fmt_time(dt) -> str:
        if dt is None:
            return "—"
        if dt.tzinfo is not None:
            dt = dt.astimezone(IST)
        return dt.strftime("%H:%M:%S")

    def _map_exit_reason(reason) -> str:
        if reason is None:
            return "EXIT"
        val = reason.value if hasattr(reason, "value") else str(reason)
        mapping = {
            "sq":     "AUTO_SQ",
            "sl":     "SL_HIT",
            "tsl":    "SL_HIT",
            "tp":     "TP_HIT",
            "direct": "EXIT",
            "manual": "EXIT",
        }
        return mapping.get(val.lower(), "EXIT")

    events = []
    running_pnl = 0.0
    cumulative_pnl_values = [0.0]

    for order in orders_raw:
        direction  = (order.direction or "").upper()
        symbol_str = order.symbol or ""

        # ── ENTRY event (from fill_time) ──────────────────────────────────────
        if order.fill_time:
            entry_price = float(order.fill_price or 0)
            events.append({
                "type":        "ENTRY",
                "description": f"{direction} {symbol_str} @{entry_price}",
                "price":       entry_price,
                "pnl_at_time": round(running_pnl, 2),
                "symbol":      symbol_str,
                "time":        _fmt_time(order.fill_time),
            })

        # ── EXIT event (from exit_time) ───────────────────────────────────────
        if order.exit_time:
            exit_price = float(
                order.exit_price_manual if order.exit_price_manual is not None
                else (order.exit_price or 0)
            )
            pnl_this   = float(order.pnl or 0)
            running_pnl = round(running_pnl + pnl_this, 2)
            cumulative_pnl_values.append(running_pnl)
            exit_type  = _map_exit_reason(order.exit_reason)
            pnl_sign   = "+" if pnl_this >= 0 else ""
            events.append({
                "type":        exit_type,
                "description": f"{exit_type.replace('_', ' ')} {symbol_str} @{exit_price}  {pnl_sign}₹{pnl_this:.2f}",
                "price":       exit_price,
                "pnl_at_time": running_pnl,
                "symbol":      symbol_str,
                "time":        _fmt_time(order.exit_time),
            })

    # Sort all events chronologically
    events.sort(key=lambda e: e["time"])

    # Summary
    first_fill = orders_raw[0].fill_time if orders_raw else None
    last_exit  = next((o.exit_time for o in reversed(orders_raw) if o.exit_time), None)

    total_pnl    = round(running_pnl, 2)
    peak_pnl     = round(max(cumulative_pnl_values), 2)
    max_drawdown = round(min(cumulative_pnl_values), 2)

    duration_minutes = 0
    if first_fill and last_exit:
        try:
            duration_minutes = int((last_exit - first_fill).total_seconds() / 60)
        except Exception:
            duration_minutes = 0

    summary = {
        "entry_time":       _fmt_time(first_fill),
        "exit_time":        _fmt_time(last_exit) if last_exit else None,
        "total_pnl":        total_pnl,
        "peak_pnl":         peak_pnl,
        "max_drawdown":     max_drawdown,
        "duration_minutes": duration_minutes,
    }

    return {
        "algo_name": algo_name,
        "date":      date,
        "events":    events,
        "summary":   summary,
    }


@router.get("/open-positions")
async def list_open_positions(
    db: AsyncSession = Depends(get_db),
    is_practix: bool | None = Query(None),
):
    """
    Returns ALL open orders across all dates, grouped by algo.
    Used by the Open Positions Panel on the Orders page.
    Includes day_of_week so frontend knows which tab to navigate to.
    """
    result = await db.execute(
        select(Order, GridEntry)
        .join(GridEntry, Order.grid_entry_id == GridEntry.id)
        .where(
            Order.status == OrderStatus.OPEN,
            *([] if is_practix is None else [Order.is_practix == is_practix]),
        )
        .order_by(Order.created_at)
    )
    rows = result.all()

    if not rows:
        return {"open_positions": [], "total": 0}

    # Group by algo_id
    by_algo: dict = {}
    ge_map: dict = {}
    for order, ge in rows:
        aid = str(order.algo_id)
        if aid not in by_algo:
            by_algo[aid] = []
            ge_map[aid] = ge
        by_algo[aid].append(_order_to_dict(order))

    # Fetch algo + account metadata
    try:
        algo_ids = [_uuid.UUID(aid) for aid in by_algo.keys()]
        algo_result = await db.execute(
            select(Algo, Account)
            .join(Account, Algo.account_id == Account.id, isouter=True)
            .where(Algo.id.in_(algo_ids))
        )
        algo_meta = {}
        for a, acc in algo_result.all():
            algo_meta[str(a.id)] = {
                "algo_name":     a.name,
                "account":       acc.nickname if acc else "",
                "strategy_mode": a.strategy_mode.value if a.strategy_mode else "intraday",
            }
    except Exception as e:
        logger.warning(f"[open-positions] metadata fetch failed: {e}")
        algo_meta = {}

    groups = []
    for aid, orders_list in by_algo.items():
        ge = ge_map[aid]
        meta = algo_meta.get(aid, {})
        pnl = round(sum((o.get("pnl") or 0.0) for o in orders_list), 2)
        # Format entry date
        entry_date = ""
        if orders_list and orders_list[0].get("fill_time"):
            try:
                from datetime import datetime
                dt = datetime.fromisoformat(orders_list[0]["fill_time"].replace("Z", "+00:00"))
                entry_date = dt.strftime("%d %b")
            except Exception:
                entry_date = ""
        groups.append({
            "algo_id":       aid,
            "algo_name":     meta.get("algo_name", ""),
            "account":       meta.get("account", ""),
            "strategy_mode": meta.get("strategy_mode", "intraday"),
            "day_of_week":   ge.day_of_week.upper() if ge.day_of_week else "",
            "entry_date":    entry_date,
            "open_count":    len(orders_list),
            "pnl":           pnl,
            "orders":        orders_list,
        })

    return {"open_positions": groups, "total": len(groups)}


@router.get("/waiting")
async def get_waiting_algos(
    trading_date: Optional[str] = Query(None, description="YYYY-MM-DD, defaults to today"),
    is_practix:   Optional[bool] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """
    Return algos that have been activated today but not yet placed any orders.
    GridEntry.status=ALGO_ACTIVE with AlgoState.status=WAITING
    (entry time not yet reached / no order placed).
    Pre-09:15 NO_TRADE entries are excluded — they clutter the Orders page.
    """
    target_date = _parse_date(trading_date) or date.today()

    # Post-09:15: ALGO_ACTIVE grid entries with a WAITING AlgoState
    activated_result = await db.execute(
        select(GridEntry, Algo, Account, AlgoState)
        .join(Algo, GridEntry.algo_id == Algo.id)
        .join(Account, GridEntry.account_id == Account.id)
        .join(AlgoState, AlgoState.grid_entry_id == GridEntry.id)
        .where(
            GridEntry.trading_date == target_date,
            GridEntry.status == GridStatus.ALGO_ACTIVE,
            GridEntry.is_archived == False,
            GridEntry.is_enabled == True,
            AlgoState.status == AlgoRunStatus.WAITING,
            *([] if is_practix is None else [GridEntry.is_practix == is_practix]),
        )
        .order_by(Algo.entry_time)
    )
    activated_rows = activated_result.all()

    waiting = []

    for ge, a, acc, _state in activated_rows:
        waiting.append({
            "grid_entry_id":  str(ge.id),
            "algo_id":        str(a.id),
            "algo_name":      a.name,
            "account_id":     str(acc.id),
            "account_name":   acc.nickname,
            "entry_time":     a.entry_time,
            "exit_time":      a.exit_time,
            "is_practix":     ge.is_practix,
            "lot_multiplier": ge.lot_multiplier,
            "phase":          "activated",   # post-09:15, waiting for entry_time
        })

    # Sort combined list by entry_time
    waiting.sort(key=lambda x: x["entry_time"] or "")

    return {
        "trading_date": target_date.isoformat(),
        "waiting":      waiting,
    }


@router.get("/{order_id}")
async def get_order(order_id: str, db: AsyncSession = Depends(get_db)):
    """Get a single order by ID."""
    result = await db.execute(select(Order).where(Order.id == order_id))
    order = result.scalar_one_or_none()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return _order_to_dict(order)


@router.patch("/{order_id}/exit-price")
async def correct_exit_price(
    order_id: str,
    body: ExitPriceRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Manually correct an order's exit price.
    Stores in exit_price_manual. Used when broker reported a wrong fill.
    Recalculates P&L based on corrected price.
    """
    result = await db.execute(select(Order).where(Order.id == order_id))
    order = result.scalar_one_or_none()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status not in (OrderStatus.CLOSED, OrderStatus.ERROR):
        raise HTTPException(status_code=400, detail="Can only correct exit price on closed or error orders")

    order.exit_price_manual = body.exit_price

    # Recalculate P&L if we have fill price
    if order.fill_price and order.quantity:
        if order.direction == "buy":
            order.pnl = (body.exit_price - order.fill_price) * order.quantity
        else:
            order.pnl = (order.fill_price - body.exit_price) * order.quantity

    await db.commit()
    return {
        "status":            "ok",
        "order_id":          order_id,
        "exit_price_manual": order.exit_price_manual,
        "pnl":               order.pnl,
    }


@router.post("/{algo_id}/sync")
async def sync_order(
    algo_id: str,
    body: SyncOrderRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Re-link a broker order that got delinked from STAAX.
    Fetches order details from broker using the Broker Order ID,
    then links it to the matching unconfirmed Order in DB.
    """
    from app.models.account import Account, BrokerType

    # 1. Get broker instance from app.state
    acc_result = await db.execute(select(Account).where(Account.id == body.account_id))
    account = acc_result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    broker = None
    if account.broker == BrokerType.ZERODHA:
        broker = getattr(request.app.state, "zerodha", None)
    elif account.nickname == "Mom":
        broker = getattr(request.app.state, "angelone_mom", None)
    elif account.nickname == "Wife":
        broker = getattr(request.app.state, "angelone_wife", None)

    if not broker:
        raise HTTPException(status_code=503, detail="Broker not connected — login first")

    # 2. Fetch order details from broker
    try:
        broker_order = await broker.get_order_status(body.broker_order_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Broker fetch failed: {str(e)}")

    if not broker_order:
        raise HTTPException(status_code=404, detail="Order not found at broker")

    # 3. Find unlinked order in DB for this algo today
    # Match by algo_id + no broker_order_id yet (delinked) + today
    today = date.today()
    orders_result = await db.execute(
        select(Order).where(
            Order.algo_id == algo_id,
            Order.broker_order_id == None,
            Order.status.in_([OrderStatus.PENDING, OrderStatus.OPEN]),
        ).order_by(Order.created_at.desc())
    )
    unlinked = orders_result.scalars().first()

    if unlinked:
        # Re-link existing order
        unlinked.broker_order_id = body.broker_order_id
        unlinked.fill_price      = broker_order.get("fill_price") or broker_order.get("averageprice") or unlinked.fill_price
        unlinked.status          = OrderStatus.OPEN
        unlinked.is_synced       = True
        await db.commit()
        await db.refresh(unlinked)
        return {
            "status":  "ok",
            "message": f"✅ Order re-linked — {unlinked.symbol}",
            "order":   _order_to_dict(unlinked),
        }
    else:
        raise HTTPException(
            status_code=404,
            detail="No unlinked order found for this algo today. The order may already be linked or doesn't exist in STAAX."
        )


@router.post("/{algo_id}/square-off")
async def square_off(
    algo_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Square off all open positions for an algo.
    Updates all OPEN orders for today's grid entry to CLOSED with exit_reason=SQ.
    Note: actual broker square-off is handled by the engine — this endpoint
    marks the intent and updates DB state. Engine wiring in Phase 1F.
    """
    today = date.today()
    grid_result = await db.execute(
        select(GridEntry).where(
            GridEntry.algo_id == algo_id,
            GridEntry.trading_date == today,
        )
    )
    grid_entry = grid_result.scalar_one_or_none()
    if not grid_entry:
        raise HTTPException(status_code=404, detail="No grid entry found for this algo today")

    # Find all open orders for this grid entry
    open_orders_result = await db.execute(
        select(Order).where(
            Order.grid_entry_id == grid_entry.id,
            Order.status == OrderStatus.OPEN,
        )
    )
    open_orders = open_orders_result.scalars().all()

    now = datetime.now(timezone.utc)

    # ── SQ-1: Wire real broker square-off via ExecutionManager ────────────────
    broker_sq_results = []
    for order in open_orders:
        try:
            # Get broker adapter from app state via request
            broker = None
            if hasattr(order, 'account_id'):
                from app.models.account import Account, BrokerType
                from sqlalchemy import select as sa_select
                acc_res = await db.execute(sa_select(Account).where(Account.id == order.account_id))
                acc = acc_res.scalar_one_or_none()
                if acc:
                    from fastapi import Request as _Req
                    import inspect
                    # Use execution_manager.square_off if order_placer is wired
                    result = await execution_manager.square_off(
                        broker_order_id=order.broker_order_id,
                        order_placer=execution_manager._order_placer,
                    )
                    broker_sq_results.append({"order_id": str(order.id), "result": result})
        except Exception as e:
            logger.warning(f"[SQ] Broker square-off failed for order {order.id}: {e}")
            broker_sq_results.append({"order_id": str(order.id), "error": str(e)})

        # Always update DB regardless of broker result
        order.status = OrderStatus.CLOSED
        order.exit_reason = ExitReason.SQ
        order.exit_time = now

    await db.commit()

    # Trigger immediate reconciliation after square-off
    try:
        from app.engine.order_reconciler import order_reconciler
        import asyncio
        asyncio.ensure_future(order_reconciler.run())
    except Exception:
        pass

    return {
        "status":      "ok",
        "algo_id":     algo_id,
        "squared_off": len(open_orders),
        "message":     f"{len(open_orders)} order(s) squared off",
        "broker_results": broker_sq_results,
    }


# ── WebSocket ─────────────────────────────────────────────────────────────────

@router.websocket("/ws/live")
async def live_orders_ws(websocket: WebSocket):
    """
    WebSocket — push live order/MTM updates to frontend.
    TODO (Phase 1F): Subscribe to Redis pub/sub channel for live updates.
    Currently accepts connection and keeps it alive.
    """
    await websocket.accept()
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
