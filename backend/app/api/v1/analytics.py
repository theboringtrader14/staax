"""
Analytics API — advanced portfolio metrics.
GET /api/v1/analytics/advanced-metrics
"""
import math
import logging
from datetime import datetime
from typing import Optional, List
from collections import defaultdict

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.models.order import Order
from app.models.algo import Algo
from app.api.v1.auth import require_admin

router = APIRouter(prefix="/analytics", tags=["analytics"])
logger = logging.getLogger(__name__)


def _sharpe_ratio(daily_pnls: List[float], risk_free_annual: float = 0.07) -> Optional[float]:
    """Annualised Sharpe ratio. Returns None if insufficient data."""
    if len(daily_pnls) < 5:
        return None
    n = len(daily_pnls)
    mean = sum(daily_pnls) / n
    variance = sum((x - mean) ** 2 for x in daily_pnls) / (n - 1)
    std = math.sqrt(variance)
    if std == 0:
        return None
    risk_free_daily = risk_free_annual / 252
    return round((mean - risk_free_daily) / std * math.sqrt(252), 3)


def _max_drawdown_and_recovery(pnl_series: List[float]):
    """
    Returns (max_drawdown, days_to_recovery).
    max_drawdown: absolute peak-to-trough loss (positive number).
    days_to_recovery: number of days from trough to recovery of peak (or None if not recovered).
    """
    cumulative = 0.0
    peak = 0.0
    peak_idx = 0
    trough = 0.0
    trough_idx = 0
    max_dd = 0.0
    max_dd_peak_idx = 0
    max_dd_trough_idx = 0

    for i, pnl in enumerate(pnl_series):
        cumulative += pnl
        if cumulative > peak:
            peak = cumulative
            peak_idx = i
        dd = peak - cumulative
        if dd > max_dd:
            max_dd = dd
            max_dd_peak_idx = peak_idx
            max_dd_trough_idx = i
            trough = cumulative

    # Days to recovery: count how many days after trough until cumulative >= peak_value_at_max_dd
    if max_dd == 0:
        return 0.0, 0

    recovery_value = peak  # the peak value before the biggest drawdown
    cumulative2 = 0.0
    for i, pnl in enumerate(pnl_series):
        cumulative2 += pnl
        if i > max_dd_trough_idx and cumulative2 >= recovery_value:
            return round(max_dd, 2), i - max_dd_trough_idx

    return round(max_dd, 2), None  # not yet recovered


def _win_loss_streaks(daily_pnls: List[float]):
    """Returns (max_win_streak, max_loss_streak)."""
    max_win = 0
    max_loss = 0
    cur_win = 0
    cur_loss = 0
    for p in daily_pnls:
        if p > 0:
            cur_win += 1
            cur_loss = 0
        elif p < 0:
            cur_loss += 1
            cur_win = 0
        else:
            cur_win = 0
            cur_loss = 0
        if cur_win > max_win:
            max_win = cur_win
        if cur_loss > max_loss:
            max_loss = cur_loss
    return max_win, max_loss


@router.get("/advanced-metrics")
async def get_advanced_metrics(
    algo_id: Optional[str] = Query(None, description="Filter by algo UUID (optional)"),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_admin),
):
    """
    Returns advanced portfolio metrics:
    - Sharpe Ratio (annualised, risk-free=7%)
    - Max Drawdown (₹)
    - Days to Recovery (from worst drawdown trough, None if not yet recovered)
    - Max Win Streak (consecutive profitable days)
    - Max Loss Streak (consecutive losing days)
    - Total Trading Days
    """
    # Query completed orders
    query = select(Order).where(Order.status == "complete")
    if algo_id:
        # Filter by algo via join with GridEntry → Algo
        from app.models.grid import GridEntry
        query = (
            select(Order)
            .join(GridEntry, Order.grid_entry_id == GridEntry.id)
            .where(GridEntry.algo_id == algo_id, Order.status == "complete")
        )

    result = await db.execute(query)
    orders = result.scalars().all()

    if not orders:
        return {
            "sharpe_ratio": None,
            "max_drawdown": 0.0,
            "days_to_recovery": None,
            "max_win_streak": 0,
            "max_loss_streak": 0,
            "total_trading_days": 0,
        }

    # Aggregate PnL by day
    day_pnl: dict = defaultdict(float)
    for o in orders:
        if o.filled_at and o.pnl is not None:
            day_pnl[o.filled_at.date()].append(o.pnl) if isinstance(day_pnl[o.filled_at.date()], list) else None

    # Re-build properly
    day_pnl_map: dict = defaultdict(float)
    for o in orders:
        if o.filled_at and o.pnl is not None:
            day_pnl_map[o.filled_at.date()] += o.pnl

    sorted_days = sorted(day_pnl_map.keys())
    daily_pnls = [day_pnl_map[d] for d in sorted_days]

    sharpe = _sharpe_ratio(daily_pnls)
    max_dd, recovery_days = _max_drawdown_and_recovery(daily_pnls)
    max_win_streak, max_loss_streak = _win_loss_streaks(daily_pnls)

    return {
        "sharpe_ratio": sharpe,
        "max_drawdown": max_dd,
        "days_to_recovery": recovery_days,
        "max_win_streak": max_win_streak,
        "max_loss_streak": max_loss_streak,
        "total_trading_days": len(sorted_days),
    }
