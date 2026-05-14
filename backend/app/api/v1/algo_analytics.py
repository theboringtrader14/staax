"""
GET /api/v1/analytics/algo-360
Multi-algo comparison analytics — KPIs, equity curve, monthly P&L.
"""
from __future__ import annotations

import math
import logging
from collections import defaultdict
from datetime import date, datetime
from typing import Optional, List

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.order import Order
from app.models.algo import Algo


router = APIRouter(prefix="/analytics", tags=["analytics"])
logger = logging.getLogger(__name__)

# ExitReason value sets (lower-case, matching DB enum values)
_SL_REASONS  = {"sl", "mtm_sl", "global_sl", "tsl"}
_TP_REASONS  = {"tp", "mtm_tp"}
_SQ_REASONS  = {"sq", "auto_sq"}


def _parse_period(period: str):
    """Return (from_date, to_date) as date objects, or (None, None) for 'all'."""
    if period == "all":
        return None, None

    if period.startswith("month:"):
        # month:2026-05
        ym = period[6:]
        try:
            y, m = int(ym[:4]), int(ym[5:])
        except (ValueError, IndexError):
            raise HTTPException(status_code=400, detail=f"Invalid month format: {period!r}. Use month:YYYY-MM")
        from_d = date(y, m, 1)
        to_d = date(y + 1, 1, 1) if m == 12 else date(y, m + 1, 1)
        return from_d, to_d

    if period.startswith("year:"):
        try:
            y = int(period[5:])
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid year format: {period!r}. Use year:YYYY")
        return date(y, 1, 1), date(y + 1, 1, 1)

    if period.startswith("fy:"):
        # fy:2025-26
        try:
            y = int(period[3:7])
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid FY format: {period!r}. Use fy:YYYY-YY")
        return date(y, 4, 1), date(y + 1, 4, 1)

    raise HTTPException(
        status_code=400,
        detail=f"Invalid period: {period!r}. Use 'all', 'month:YYYY-MM', 'year:YYYY', or 'fy:YYYY-YY'",
    )


def _compute_kpis(trades: List[dict]) -> dict:
    """
    Compute all KPIs from a list of closed trade dicts.
    Each dict must have 'pnl' (float) and 'exit_reason' (str or None).
    """
    zero_kpis = {
        "total_pnl": 0.0,
        "total_trades": 0,
        "wins": 0,
        "losses": 0,
        "win_rate": 0.0,
        "avg_win": 0.0,
        "avg_loss": 0.0,
        "best_trade": 0.0,
        "worst_trade": 0.0,
        "profit_factor": 0.0,
        "avg_pnl_per_trade": 0.0,
        "max_consecutive_wins": 0,
        "max_consecutive_losses": 0,
        "current_streak": 0,
        "max_drawdown": 0.0,
        "sharpe_ratio": 0.0,
        "sl_hit_count": 0,
        "tp_hit_count": 0,
        "sq_count": 0,
    }

    if not trades:
        return zero_kpis

    pnls = [t["pnl"] for t in trades]
    wins  = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p <= 0]

    # ── Streaks ───────────────────────────────────────────────────────────────
    max_win_streak = max_loss_streak = 0
    run = 0
    for p in pnls:
        if p > 0:
            run = run + 1 if run > 0 else 1
            max_win_streak = max(max_win_streak, run)
        else:
            run = run - 1 if run < 0 else -1
            max_loss_streak = max(max_loss_streak, abs(run))
    current_streak = run

    # ── Max drawdown (peak-to-trough on cumulative equity) ────────────────────
    equity = 0.0
    peak = 0.0
    max_dd = 0.0
    for p in pnls:
        equity += p
        peak = max(peak, equity)
        dd = peak - equity
        max_dd = max(max_dd, dd)

    # ── Sharpe ratio (trade-level, annualised √252) ───────────────────────────
    sharpe = 0.0
    if len(pnls) > 1:
        mean_p = sum(pnls) / len(pnls)
        variance = sum((p - mean_p) ** 2 for p in pnls) / len(pnls)
        std = math.sqrt(variance) if variance > 0 else 0.0
        if std > 0:
            sharpe = round((mean_p / std) * math.sqrt(252), 2)

    total_wins_sum  = sum(wins)
    total_loss_sum  = abs(sum(losses))

    # ── Exit reason counts ────────────────────────────────────────────────────
    sl_count = sum(
        1 for t in trades
        if str(t.get("exit_reason") or "").lower() in _SL_REASONS
    )
    tp_count = sum(
        1 for t in trades
        if str(t.get("exit_reason") or "").lower() in _TP_REASONS
    )
    sq_count = sum(
        1 for t in trades
        if str(t.get("exit_reason") or "").lower() in _SQ_REASONS
    )

    return {
        "total_pnl":               round(sum(pnls), 2),
        "total_trades":            len(trades),
        "wins":                    len(wins),
        "losses":                  len(losses),
        "win_rate":                round(len(wins) / len(trades) * 100, 1),
        "avg_win":                 round(total_wins_sum / len(wins), 2) if wins else 0.0,
        "avg_loss":                round(sum(losses) / len(losses), 2) if losses else 0.0,
        "best_trade":              round(max(pnls), 2),
        "worst_trade":             round(min(pnls), 2),
        "profit_factor":           round(total_wins_sum / total_loss_sum, 2) if total_loss_sum else 0.0,
        "avg_pnl_per_trade":       round(sum(pnls) / len(pnls), 2),
        "max_consecutive_wins":    max_win_streak,
        "max_consecutive_losses":  max_loss_streak,
        "current_streak":          current_streak,
        "max_drawdown":            round(-max_dd, 2),   # negative = drawdown below peak
        "sharpe_ratio":            sharpe,
        "sl_hit_count":            sl_count,
        "tp_hit_count":            tp_count,
        "sq_count":                sq_count,
    }


def _build_equity_curve(trades: List[dict]) -> List[dict]:
    """
    Build daily cumulative equity curve from closed trades.
    trades must be sorted by exit_time ascending.
    Returns list of {date: str, cumulative_pnl: float}.
    """
    daily: dict = defaultdict(float)
    for t in trades:
        if t["exit_time"]:
            day = t["exit_time"].date() if isinstance(t["exit_time"], datetime) else t["exit_time"]
            daily[day] += t["pnl"]

    cumulative = 0.0
    curve = []
    for d in sorted(daily.keys()):
        cumulative += daily[d]
        curve.append({"date": str(d), "cumulative_pnl": round(cumulative, 2)})
    return curve


def _build_monthly_pnl(trades: List[dict]) -> List[dict]:
    """
    Aggregate P&L by calendar month.
    Returns list of {month: "YYYY-MM", pnl: float, trades: int}, sorted ascending.
    """
    monthly: dict = defaultdict(lambda: {"pnl": 0.0, "trades": 0})
    for t in trades:
        if t["exit_time"]:
            dt = t["exit_time"] if isinstance(t["exit_time"], datetime) else datetime.combine(t["exit_time"], datetime.min.time())
            key = dt.strftime("%Y-%m")
            monthly[key]["pnl"]    += t["pnl"]
            monthly[key]["trades"] += 1

    return [
        {"month": k, "pnl": round(v["pnl"], 2), "trades": v["trades"]}
        for k, v in sorted(monthly.items())
    ]


@router.get("/algo-360")
async def get_algo_360(
    algo_ids: str = Query(..., description="Comma-separated algo UUIDs"),
    period: str = Query("all", description="'all' | 'month:YYYY-MM' | 'year:YYYY' | 'fy:YYYY-YY'"),
    db: AsyncSession = Depends(get_db),
):
    """
    Multi-algo comparison analytics.

    Returns per-algo: KPIs, equity curve, and monthly P&L breakdown.
    Only closed orders with a non-null pnl and exit_time are included.
    """
    # ── Parse algo_ids ────────────────────────────────────────────────────────
    ids = [aid.strip() for aid in algo_ids.split(",") if aid.strip()]
    if not ids:
        raise HTTPException(status_code=400, detail="algo_ids must contain at least one UUID")

    # ── Parse period ──────────────────────────────────────────────────────────
    from_date, to_date = _parse_period(period)

    # ── Fetch algos for name lookup ───────────────────────────────────────────
    algo_result = await db.execute(select(Algo).where(Algo.id.in_(ids)))
    algo_map: dict = {str(a.id): a.name for a in algo_result.scalars().all()}

    # ── Fetch closed orders for all requested algos ───────────────────────────
    conditions = [
        Order.algo_id.in_(ids),
        Order.status == "closed",
        Order.pnl.isnot(None),
        Order.exit_time.isnot(None),
    ]
    if from_date:
        conditions.append(Order.exit_time >= datetime.combine(from_date, datetime.min.time()))
    if to_date:
        conditions.append(Order.exit_time < datetime.combine(to_date, datetime.min.time()))

    order_result = await db.execute(
        select(
            Order.algo_id,
            Order.pnl,
            Order.exit_time,
            Order.exit_reason,
        ).where(*conditions).order_by(Order.exit_time)
    )
    rows = order_result.all()

    # ── Group orders by algo ──────────────────────────────────────────────────
    by_algo: dict = defaultdict(list)
    for row in rows:
        by_algo[str(row.algo_id)].append({
            "pnl":         row.pnl,
            "exit_time":   row.exit_time,
            "exit_reason": row.exit_reason.value if row.exit_reason else None,
        })

    # ── Build per-algo response ───────────────────────────────────────────────
    results = []
    for algo_id in ids:
        trades = by_algo.get(algo_id, [])
        results.append({
            "algo_id":      algo_id,
            "algo_name":    algo_map.get(algo_id, "Unknown"),
            "period":       period,
            "kpis":         _compute_kpis(trades),
            "equity_curve": _build_equity_curve(trades),
            "monthly_pnl":  _build_monthly_pnl(trades),
        })

    return {"algos": results}
