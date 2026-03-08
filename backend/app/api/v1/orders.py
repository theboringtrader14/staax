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
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from pydantic import BaseModel
from typing import Optional
from datetime import date, datetime, timezone
from app.core.database import get_db
from app.models.order import Order, OrderStatus, ExitReason
from app.models.grid import GridEntry
from app.models.algo import Algo

router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────

class ExitPriceRequest(BaseModel):
    exit_price: float


class SyncOrderRequest(BaseModel):
    symbol:       str
    exchange:     str
    direction:    str          # "buy" | "sell"
    lots:         int
    quantity:     int
    fill_price:   float
    fill_time:    Optional[str] = None   # ISO datetime string
    is_practix:   bool = False
    is_overnight: bool = False


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
    db: AsyncSession = Depends(get_db),
):
    """
    Manually sync an untracked broker position into the platform.
    Creates an Order record marked as is_synced=True.
    Used when a broker trade happened outside of STAAX (manual trade, etc.)
    """
    # Validate algo exists
    algo_result = await db.execute(select(Algo).where(Algo.id == algo_id))
    algo = algo_result.scalar_one_or_none()
    if not algo:
        raise HTTPException(status_code=404, detail="Algo not found")

    # Find today's grid entry for this algo
    today = date.today()
    grid_result = await db.execute(
        select(GridEntry).where(
            GridEntry.algo_id == algo_id,
            GridEntry.trading_date == today,
        )
    )
    grid_entry = grid_result.scalar_one_or_none()
    if not grid_entry:
        raise HTTPException(
            status_code=404,
            detail="No grid entry found for this algo today — deploy it to the grid first"
        )

    fill_time = None
    if body.fill_time:
        try:
            fill_time = datetime.fromisoformat(body.fill_time)
        except ValueError:
            fill_time = datetime.now(timezone.utc)

    import uuid as uuid_lib
    order = Order(
        id=uuid_lib.uuid4(),
        grid_entry_id=grid_entry.id,
        algo_id=algo_id,
        leg_id=uuid_lib.uuid4(),       # synthetic leg ID for synced orders
        account_id=algo.account_id,
        is_practix=body.is_practix,
        is_synced=True,
        is_overnight=body.is_overnight,
        symbol=body.symbol,
        exchange=body.exchange,
        direction=body.direction,
        lots=body.lots,
        quantity=body.quantity,
        fill_price=body.fill_price,
        fill_time=fill_time or datetime.now(timezone.utc),
        entry_type="sync",
        status=OrderStatus.OPEN,
    )
    db.add(order)
    await db.commit()
    await db.refresh(order)
    return {
        "status":   "ok",
        "message":  "Order synced",
        "order":    _order_to_dict(order),
    }


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
    for order in open_orders:
        order.status = OrderStatus.CLOSED
        order.exit_reason = ExitReason.SQ
        order.exit_time = now

    await db.commit()
    return {
        "status":        "ok",
        "algo_id":       algo_id,
        "squared_off":   len(open_orders),
        "message":       f"{len(open_orders)} order(s) marked for square off",
        "note":          "Broker square-off will be executed by engine (Phase 1F)",
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
