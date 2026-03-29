"""
reports.py — Reports API
"""
import csv
import io
from datetime import date, datetime, timezone, timedelta
from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.database import get_db
from app.models.order import Order, OrderStatus
from app.models.algo import Algo
from app.models.account import Account

router = APIRouter()
IST = timezone(timedelta(hours=5, minutes=30))

def _fy_range(fy: str):
    try:
        start_year = int(fy.split("-")[0])
    except Exception:
        start_year = date.today().year
    return (
        datetime(start_year,     4,  1, 0,  0,  0, tzinfo=IST),
        datetime(start_year + 1, 3, 31, 23, 59, 59, tzinfo=IST),
    )

def _base_query(fy: str, account_id: str | None, is_practix: bool | None = None):
    """Return base filter conditions for closed orders in FY."""
    fy_start, fy_end = _fy_range(fy)
    conditions = [
        Order.status == OrderStatus.CLOSED,
        Order.pnl.isnot(None),
        Order.fill_time >= fy_start,
        Order.fill_time <= fy_end,
    ]
    if account_id:
        import uuid as _uuid
        try:
            conditions.append(Order.account_id == _uuid.UUID(account_id))
        except ValueError:
            pass
    if is_practix is not None:
        conditions.append(Order.is_practix == is_practix)
    return conditions


@router.get("/metrics")
async def algo_metrics(
    db: AsyncSession = Depends(get_db),
    fy: str = Query("2024-25"),
    account_id: str | None = Query(None),
    is_practix: bool | None = Query(None),
):
    conditions = _base_query(fy, account_id, is_practix)
    result = await db.execute(
        select(Order, Algo)
        .join(Algo, Order.algo_id == Algo.id, isouter=True)
        .where(*conditions)
        .order_by(Order.fill_time)
    )
    rows = result.all()

    by_algo: dict = {}
    for order, algo in rows:
        aid = str(order.algo_id)
        if aid not in by_algo:
            by_algo[aid] = {"name": algo.name if algo else aid, "pnls": []}
        by_algo[aid]["pnls"].append(order.pnl or 0.0)

    metrics = []
    for aid, data in by_algo.items():
        pnls = data["pnls"]
        wins   = [p for p in pnls if p > 0]
        losses = [p for p in pnls if p <= 0]
        total  = round(sum(pnls), 2)
        metrics.append({
            "algo_id":    aid,
            "name":       data["name"],
            "trades":     len(pnls),
            "total_pnl":  total,
            "wins":       len(wins),
            "losses":     len(losses),
            "win_pct":    round(len(wins) / len(pnls) * 100, 1) if pnls else 0,
            "loss_pct":   round(len(losses) / len(pnls) * 100, 1) if pnls else 0,
            "max_profit": round(max(pnls), 2) if pnls else 0,
            "max_loss":   round(min(pnls), 2) if pnls else 0,
        })
    metrics.sort(key=lambda x: x["total_pnl"], reverse=True)

    # Fetch fy_margin for selected accounts
    if account_id:
        import uuid as _uuid
        try:
            acc_result = await db.execute(select(Account).where(Account.id == _uuid.UUID(account_id)))
            acc = acc_result.scalar_one_or_none()
            fy_margin = acc.fy_margin if acc and acc.fy_margin else 0
        except Exception:
            fy_margin = 0
    else:
        acc_result = await db.execute(select(Account))
        accs = acc_result.scalars().all()
        fy_margin = sum(a.fy_margin or 0 for a in accs)

    return {"metrics": metrics, "fy": fy, "fy_margin": fy_margin}


@router.get("/calendar")
async def trade_calendar(
    db: AsyncSession = Depends(get_db),
    fy: str = Query("2024-25"),
    account_id: str | None = Query(None),
    is_practix: bool | None = Query(None),
):
    conditions = _base_query(fy, account_id, is_practix)
    result = await db.execute(
        select(Order).where(*conditions).order_by(Order.fill_time)
    )
    orders = result.scalars().all()

    by_date: dict = {}
    for o in orders:
        if not o.fill_time:
            continue
        d = o.fill_time.astimezone(IST).date().isoformat()
        if d not in by_date:
            by_date[d] = {"pnl": 0.0, "trades": 0}
        by_date[d]["pnl"]    += o.pnl or 0.0
        by_date[d]["trades"] += 1

    calendar = [{"date": d, "pnl": round(v["pnl"], 2), "trades": v["trades"]}
                for d, v in sorted(by_date.items())]
    return {"calendar": calendar, "fy": fy}


@router.get("/equity-curve")
async def equity_curve(
    db: AsyncSession = Depends(get_db),
    fy: str = Query("2024-25"),
    account_id: str | None = Query(None),
    is_practix: bool | None = Query(None),
):
    conditions = _base_query(fy, account_id, is_practix)
    result = await db.execute(
        select(Order).where(*conditions).order_by(Order.fill_time)
    )
    orders = result.scalars().all()

    by_date: dict = {}
    for o in orders:
        if not o.fill_time:
            continue
        d = o.fill_time.astimezone(IST).date().isoformat()
        by_date[d] = by_date.get(d, 0.0) + (o.pnl or 0.0)

    cumulative = 0.0
    curve = []
    for d, pnl in sorted(by_date.items()):
        cumulative += pnl
        dt = datetime.fromisoformat(d)
        curve.append({"date": d, "month": dt.strftime("%b"),
                      "pnl": round(pnl, 2), "cumulative": round(cumulative, 2)})
    return {"data": curve, "fy": fy, "total": round(cumulative, 2)}




@router.get("/day-breakdown")
async def day_breakdown(
    db: AsyncSession = Depends(get_db),
    fy: str = Query("2024-25"),
    account_id: str | None = Query(None),
    is_practix: bool | None = Query(None),
):
    """Day-of-week P&L breakdown per algo — powers Risk Heatmap."""
    from sqlalchemy import extract, func as sa_func
    from app.models.algo import Algo
    conditions = _base_query(fy, account_id, is_practix)
    result = await db.execute(
        select(
            Algo.name,
            extract('dow', Order.fill_time).label('dow'),
            sa_func.sum(Order.pnl).label('pnl'),
            sa_func.count(Order.id).label('trades'),
        )
        .join(Algo, Order.algo_id == Algo.id)
        .where(*conditions)
        .group_by(Algo.name, extract('dow', Order.fill_time))
        .order_by(Algo.name)
    )
    rows = result.all()
    DOW = {0: 'SUN', 1: 'MON', 2: 'TUE', 3: 'WED', 4: 'THU', 5: 'FRI', 6: 'SAT'}
    data: dict = {}
    for name, dow, pnl, trades in rows:
        if name not in data:
            data[name] = {}
        data[name][DOW.get(int(dow), str(dow))] = {"pnl": float(pnl or 0), "trades": int(trades)}
    return {"breakdown": data, "fy": fy}


@router.get("/errors")
async def error_analytics(
    db: AsyncSession = Depends(get_db),
    fy: str = Query("2024-25"),
    account_id: str | None = Query(None),
    is_practix: bool | None = Query(None),
):
    """Historical error/failure analytics per algo."""
    from app.models.algo import Algo
    from app.models.order import OrderStatus
    fy_start, fy_end = _fy_range(fy)
    conditions = [
        Order.status == OrderStatus.ERROR,
        Order.created_at >= fy_start,
        Order.created_at <= fy_end,
    ]
    if account_id:
        import uuid as _uuid
        try:
            conditions.append(Order.account_id == _uuid.UUID(account_id))
        except ValueError:
            pass
    if is_practix is not None:
        conditions.append(Order.is_practix == is_practix)

    # Per-algo error counts
    agg = await db.execute(
        select(
            Algo.name,
            func.count(Order.id).label('errors'),
            func.max(Order.created_at).label('last_error'),
        )
        .join(Algo, Order.algo_id == Algo.id)
        .where(*conditions)
        .group_by(Algo.name)
        .order_by(func.count(Order.id).desc())
    )
    per_algo = [{"algo": r[0], "errors": r[1], "last_error": r[2].isoformat() if r[2] else None} for r in agg.all()]

    # Last 20 error orders
    recent = await db.execute(
        select(Order, Algo.name.label('algo_name'))
        .join(Algo, Order.algo_id == Algo.id)
        .where(*conditions)
        .order_by(Order.created_at.desc())
        .limit(20)
    )
    recent_rows = [
        {
            "id": str(r.Order.id),
            "algo": r.algo_name,
            "symbol": r.Order.symbol,
            "error_message": r.Order.error_message,
            "created_at": r.Order.created_at.isoformat() if r.Order.created_at else None,
        }
        for r in recent.all()
    ]

    # Total orders for error rate
    total_res = await db.execute(
        select(func.count(Order.id)).where(
            Order.created_at >= fy_start,
            Order.created_at <= fy_end,
            *([] if is_practix is None else [Order.is_practix == is_practix]),
        )
    )
    total = total_res.scalar() or 1

    return {
        "per_algo": per_algo,
        "recent": recent_rows,
        "total_errors": sum(r["errors"] for r in per_algo),
        "total_orders": total,
        "error_rate_pct": round(sum(r["errors"] for r in per_algo) / total * 100, 2),
        "fy": fy,
    }


@router.get("/slippage")
async def slippage_analytics(
    db: AsyncSession = Depends(get_db),
    fy: str = Query("2024-25"),
    account_id: str | None = Query(None),
    is_practix: bool | None = Query(None),
):
    """Historical slippage analytics — fill price vs reference price."""
    from app.models.algo import Algo
    conditions = _base_query(fy, account_id, is_practix)
    conditions.append(Order.fill_price.isnot(None))
    conditions.append(Order.entry_reference.isnot(None))

    result = await db.execute(
        select(Order, Algo.name.label('algo_name'))
        .join(Algo, Order.algo_id == Algo.id)
        .where(*conditions)
        .order_by(Order.fill_time.desc())
    )
    rows = result.all()

    per_algo: dict = {}
    all_slippages = []
    for r in rows:
        o = r.Order
        try:
            ref = float(o.entry_reference)
            fill = float(o.fill_price)
            slip = (fill - ref) if o.direction == 'buy' else (ref - fill)
            slip_inr = slip * (o.quantity or 1)
        except (TypeError, ValueError):
            continue

        all_slippages.append(slip)
        name = r.algo_name
        if name not in per_algo:
            per_algo[name] = {"slippages": [], "total_inr": 0.0}
        per_algo[name]["slippages"].append(slip)
        per_algo[name]["total_inr"] += slip_inr

    per_algo_out = [
        {
            "algo": name,
            "orders": len(v["slippages"]),
            "avg_slip_pts": round(sum(v["slippages"]) / len(v["slippages"]), 2),
            "total_slip_inr": round(v["total_inr"], 2),
            "best": round(min(v["slippages"]), 2),
            "worst": round(max(v["slippages"]), 2),
        }
        for name, v in per_algo.items()
    ]
    per_algo_out.sort(key=lambda x: abs(x["avg_slip_pts"]), reverse=True)

    return {
        "per_algo": per_algo_out,
        "avg_slippage_pts": round(sum(all_slippages) / len(all_slippages), 2) if all_slippages else 0,
        "total_orders_with_ref": len(all_slippages),
        "fy": fy,
    }


@router.get("/all-orders")
async def all_orders(
    db: AsyncSession = Depends(get_db),
    fy: str = Query("2024-25"),
    account_id: str | None = Query(None),
    is_practix: bool | None = Query(None),
    status: str | None = Query(None),
    limit: int = Query(500),
):
    """All historical orders without date filter — powers Analytics page."""
    from app.models.algo import Algo
    conditions = _base_query(fy, account_id, is_practix)
    if status:
        from app.models.order import OrderStatus
        try:
            conditions.append(Order.status == OrderStatus(status))
        except ValueError:
            pass

    result = await db.execute(
        select(Order, Algo.name.label('algo_name'))
        .join(Algo, Order.algo_id == Algo.id)
        .where(*conditions)
        .order_by(Order.fill_time.desc())
        .limit(limit)
    )
    rows = result.all()
    orders = [
        {
            "id": str(r.Order.id),
            "algo_name": r.algo_name,
            "algo_id": str(r.Order.algo_id),
            "symbol": r.Order.symbol,
            "direction": r.Order.direction,
            "status": r.Order.status.value if r.Order.status else None,
            "fill_price": float(r.Order.fill_price) if r.Order.fill_price else None,
            "entry_reference": r.Order.entry_reference,
            "exit_price": float(r.Order.exit_price) if r.Order.exit_price else None,
            "pnl": float(r.Order.pnl) if r.Order.pnl else None,
            "error_message": r.Order.error_message,
            "fill_time": r.Order.fill_time.isoformat() if r.Order.fill_time else None,
            "exit_time": r.Order.exit_time.isoformat() if r.Order.exit_time else None,
            "is_practix": r.Order.is_practix,
            "lots": r.Order.lots,
            "quantity": r.Order.quantity,
        }
        for r in rows
    ]
    return {"orders": orders, "total": len(orders), "fy": fy}

@router.get("/download")
async def download_trades(
    db: AsyncSession = Depends(get_db),
    fy: str = Query("2024-25"),
    format: str = Query("csv"),
    account_id: str | None = Query(None),
):
    conditions = _base_query(fy, account_id)
    # download uses created_at not fill_time range — override
    fy_start, fy_end = _fy_range(fy)
    dl_conditions = [
        Order.created_at >= fy_start,
        Order.created_at <= fy_end,
        Order.status.in_([OrderStatus.CLOSED, OrderStatus.ERROR]),
    ]
    if account_id:
        import uuid as _uuid
        try:
            dl_conditions.append(Order.account_id == _uuid.UUID(account_id))
        except ValueError:
            pass
    result = await db.execute(select(Order).where(*dl_conditions).order_by(Order.created_at))
    orders = result.scalars().all()

    headers = ["Date","Symbol","Side","Qty","Entry Price","Exit Price",
               "P&L","Status","Exit Reason","Broker Order ID"]
    rows = []
    for o in orders:
        rows.append([
            o.created_at.strftime("%Y-%m-%d %H:%M") if o.created_at else "",
            o.symbol or "", o.direction or "", o.lots or 0,
            o.fill_price or "", o.exit_price or "",
            round(o.pnl, 2) if o.pnl is not None else "",
            o.status.value if o.status else "",
            o.exit_reason.value if o.exit_reason else "",
            o.broker_order_id or "",
        ])
    filename_base = f"STAAX_trades_FY{fy}"
    if format == "excel":
        try:
            import openpyxl
            from openpyxl.styles import Font, PatternFill, Alignment
            wb = openpyxl.Workbook()
            ws = wb.active
            ws.title = f"FY {fy}"
            header_fill = PatternFill("solid", fgColor="1a1a2e")
            header_font = Font(bold=True, color="00B0F0")
            for col, h in enumerate(headers, 1):
                cell = ws.cell(row=1, column=col, value=h)
                cell.fill = header_fill; cell.font = header_font
                cell.alignment = Alignment(horizontal="center")
            for row_idx, row in enumerate(rows, 2):
                for col_idx, val in enumerate(row, 1):
                    ws.cell(row=row_idx, column=col_idx, value=val)
            for col in ws.columns:
                max_len = max((len(str(cell.value or "")) for cell in col), default=8)
                ws.column_dimensions[col[0].column_letter].width = min(max_len + 2, 30)
            buf = io.BytesIO()
            wb.save(buf); buf.seek(0)
            return StreamingResponse(buf,
                media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                headers={"Content-Disposition": f'attachment; filename="{filename_base}.xlsx"'})
        except ImportError:
            pass
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(headers); writer.writerows(rows); buf.seek(0)
    return StreamingResponse(io.BytesIO(buf.getvalue().encode("utf-8-sig")),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename_base}.csv"'})
