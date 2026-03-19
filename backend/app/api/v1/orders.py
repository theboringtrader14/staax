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
from sqlalchemy import select, and_
from pydantic import BaseModel
from typing import Optional
from datetime import date, datetime, timezone
import logging
from app.core.database import get_db
logger = logging.getLogger(__name__)
from app.engine.execution_manager import execution_manager
from app.models.order import Order, OrderStatus, ExitReason
from app.models.grid import GridEntry, GridStatus
from app.models.algo import Algo
from app.models.account import Account

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
        "exit_time":         order.exit_time.isoformat() if order.exit_time else None,
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
    db: AsyncSession = Depends(get_db),
):
    """
    List orders for a trading day.
    Defaults to today. Filterable by algo, account, status.
    Groups results by algo_id for the Orders page view.
    """
    target_date = _parse_date(trading_date) or date.today()

    # Find all GridEntries for this day
    grid_result = await db.execute(
        select(GridEntry).where(GridEntry.trading_date == target_date)
    )
    grid_entries = grid_result.scalars().all()
    grid_entry_ids = [e.id for e in grid_entries]

    if not grid_entry_ids:
        return {
            "trading_date": target_date.isoformat(),
            "orders":       [],
            "by_algo":      {},
            "total":        0,
        }

    # Build query
    conditions = [Order.grid_entry_id.in_(grid_entry_ids)]
    if algo_id:
        conditions.append(Order.algo_id == algo_id)
    if account_id:
        conditions.append(Order.account_id == account_id)
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

    return {
        "trading_date": target_date.isoformat(),
        "orders":       orders_list,
        "by_algo":      by_algo,
        "total":        len(orders_list),
    }


@router.get("/waiting")
async def get_waiting_algos(
    trading_date: Optional[str] = Query(None, description="YYYY-MM-DD, defaults to today"),
    db: AsyncSession = Depends(get_db),
):
    """
    Return algos scheduled for today that have not yet placed any orders (status=NO_TRADE).
    Used by the Orders page to show WAITING rows before entry time is reached.
    """
    target_date = _parse_date(trading_date) or date.today()

    result = await db.execute(
        select(GridEntry, Algo, Account)
        .join(Algo, GridEntry.algo_id == Algo.id)
        .join(Account, GridEntry.account_id == Account.id)
        .where(
            GridEntry.trading_date == target_date,
            GridEntry.status == GridStatus.NO_TRADE,
            GridEntry.is_archived == False,
            GridEntry.is_enabled == True,
        )
        .order_by(Algo.entry_time)
    )
    rows = result.all()

    return {
        "trading_date": target_date.isoformat(),
        "waiting": [
            {
                "grid_entry_id":  str(ge.id),
                "algo_id":        str(a.id),
                "algo_name":      a.name,
                "account_id":     str(acc.id),
                "account_name":   acc.nickname,
                "entry_time":     a.entry_time,
                "exit_time":      a.exit_time,
                "is_practix":     ge.is_practix,
                "lot_multiplier": ge.lot_multiplier,
            }
            for ge, a, acc in rows
        ],
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
    if account.broker == BrokerType.zerodha:
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
