"""
Hedge orders API — GET /api/v1/hedge/orders
"""
from datetime import date, timedelta
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.hedge_order import HedgeOrder

router = APIRouter(prefix="/hedge", tags=["hedge"])


@router.get("/orders")
async def get_hedge_orders(db: AsyncSession = Depends(get_db)):
    """Return hedge orders from last 30 days with live LTP and P&L."""
    r = await db.execute(
        select(HedgeOrder)
        .where(HedgeOrder.trading_date >= date.today() - timedelta(days=30))
        .order_by(HedgeOrder.placed_at.desc())
    )
    orders = r.scalars().all()

    # Enrich with live LTP from market_state
    try:
        from app.engine.market_state import market_state as _ms
        get_ltp = _ms.get_ltp
    except Exception:
        get_ltp = lambda token: None  # noqa: E731

    result = []
    for o in orders:
        ltp = get_ltp(int(o.symbol_token)) if o.symbol_token else None
        pnl = None
        if ltp and o.fill_price and o.quantity:
            pnl = round((ltp - o.fill_price) * o.quantity, 2)
        result.append({
            "id": str(o.id),
            "trading_date": str(o.trading_date),
            "instrument": o.instrument,
            "option_type": o.option_type,
            "symbol": o.symbol,
            "lots": o.lots,
            "quantity": o.quantity,
            "fill_price": o.fill_price,
            "ltp": ltp,
            "pnl": pnl,
            "broker_order_id": o.broker_order_id,
            "status": o.status,
            "placed_at": o.placed_at.isoformat() if o.placed_at else None,
            "reason": o.reason,
        })
    return {"orders": result}
