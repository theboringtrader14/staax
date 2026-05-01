"""
Risk API — GET /api/v1/risk/live

Returns a live snapshot of open-position risk:
  - deployed capital, max loss if all SLs hit, unrealized P&L, risk %
  - per-position breakdown (by_algo)

Single-owner platform — no user_id filtering, just is_practix flag.
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from app.core.database import get_db
from app.models.order import Order, OrderStatus

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/live")
async def get_live_risk(
    is_practix: bool = Query(True),
    db: AsyncSession = Depends(get_db),
):
    """
    Live risk snapshot for all open positions.

    Returns:
      open_positions        — count of open orders with a fill price
      deployed_capital      — sum of fill_price * qty across open positions
      max_loss_if_sl_hit    — sum of abs(fill_price - sl_actual) * qty
      current_unrealized_pnl — sum of ltp-based P&L (uses order.pnl or 0)
      risk_pct              — max_loss / deployed_capital * 100
      by_algo               — per-position detail list
    """
    try:
        result = await db.execute(
            select(Order).where(
                and_(
                    Order.status == OrderStatus.OPEN,
                    Order.fill_price.isnot(None),
                    Order.is_practix == is_practix,
                )
            )
        )
        orders = result.scalars().all()
    except Exception as e:
        logger.warning(f"[RISK] DB query failed: {e}")
        return {
            "open_positions": 0,
            "deployed_capital": 0.0,
            "max_loss_if_sl_hit": 0.0,
            "current_unrealized_pnl": 0.0,
            "risk_pct": 0.0,
            "by_algo": [],
        }

    deployed_capital: float = 0.0
    max_loss: float = 0.0
    unrealized_pnl: float = 0.0
    by_algo: list = []

    for order in orders:
        qty = (order.lots or 1) * (order.lot_size or 1)
        fill = order.fill_price or 0.0

        deployed_capital += fill * qty

        if order.sl_actual and fill:
            max_loss += abs(fill - order.sl_actual) * qty

        # Best available P&L: stored pnl (updated by engine on each tick)
        unrealized_pnl += order.pnl or 0.0

        by_algo.append({
            "algo":   str(order.algo_id),
            "symbol": order.symbol,
            "fill":   fill,
            "sl":     order.sl_actual,
            "qty":    qty,
            "pnl":    order.pnl or 0.0,
        })

    risk_pct: float = 0.0
    if deployed_capital > 0:
        risk_pct = round(max_loss / deployed_capital * 100, 1)

    return {
        "open_positions":         len(orders),
        "deployed_capital":       round(deployed_capital, 2),
        "max_loss_if_sl_hit":     round(max_loss, 2),
        "current_unrealized_pnl": round(unrealized_pnl, 2),
        "risk_pct":               risk_pct,
        "by_algo":                by_algo,
    }
