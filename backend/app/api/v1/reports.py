"""
reports.py — Reports API
Endpoints for equity curve, metrics, calendar, and trade download.
"""
import csv
import io
from datetime import date, datetime, timezone
from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.database import get_db
from app.models.order import Order, OrderStatus

router = APIRouter()


@router.get("/equity-curve")
async def equity_curve(db: AsyncSession = Depends(get_db)):
    return {"data": [], "message": "Equity curve — Phase 1E"}


@router.get("/metrics")
async def algo_metrics(db: AsyncSession = Depends(get_db)):
    return {"metrics": [], "message": "Metrics — Phase 1E"}


@router.get("/calendar")
async def trade_calendar(db: AsyncSession = Depends(get_db)):
    return {"calendar": [], "message": "Calendar — Phase 1E"}


@router.get("/download")
async def download_trades(
    db: AsyncSession = Depends(get_db),
    fy: str = Query("2024-25", description="Financial year e.g. 2024-25"),
    format: str = Query("csv", description="csv or excel"),
):
    """
    Download trade history as CSV or Excel for a given FY.
    FY runs Apr 1 → Mar 31. e.g. fy=2024-25 → Apr 1 2024 to Mar 31 2025.
    """
    # Parse FY date range
    try:
        start_year = int(fy.split("-")[0])
    except Exception:
        start_year = date.today().year

    fy_start = datetime(start_year,     4,  1, tzinfo=timezone.utc)
    fy_end   = datetime(start_year + 1, 3, 31, 23, 59, 59, tzinfo=timezone.utc)

    # Fetch completed orders for FY
    result = await db.execute(
        select(Order).where(
            Order.created_at >= fy_start,
            Order.created_at <= fy_end,
            Order.status.in_([
                OrderStatus.CLOSED,
                OrderStatus.ERROR,
            ])
        ).order_by(Order.created_at)
    )
    orders = result.scalars().all()

    # Build rows
    headers = [
        "Date", "Symbol", "Side", "Qty", "Entry Price", "Exit Price",
        "P&L", "Status", "Exit Reason", "Algo", "Account", "Broker Order ID"
    ]
    rows = []
    for o in orders:
        rows.append([
            o.created_at.strftime("%Y-%m-%d %H:%M") if o.created_at else "",
            o.symbol or "",
            o.side or "",
            o.qty or 0,
            o.entry_price or "",
            o.exit_price_manual or o.exit_price or "",
            round(o.pnl, 2) if o.pnl is not None else "",
            o.status.value if o.status else "",
            o.exit_reason.value if o.exit_reason else "",
            str(o.grid_entry_id) if o.grid_entry_id else "",
            str(o.account_id) if hasattr(o, "account_id") and o.account_id else "",
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

            # Header row
            header_fill = PatternFill("solid", fgColor="1a1a2e")
            header_font = Font(bold=True, color="00B0F0")
            for col, h in enumerate(headers, 1):
                cell = ws.cell(row=1, column=col, value=h)
                cell.fill = header_fill
                cell.font = header_font
                cell.alignment = Alignment(horizontal="center")

            # Data rows
            for row_idx, row in enumerate(rows, 2):
                for col_idx, val in enumerate(row, 1):
                    ws.cell(row=row_idx, column=col_idx, value=val)

            # Auto-width
            for col in ws.columns:
                max_len = max((len(str(cell.value or "")) for cell in col), default=8)
                ws.column_dimensions[col[0].column_letter].width = min(max_len + 2, 30)

            buf = io.BytesIO()
            wb.save(buf)
            buf.seek(0)
            return StreamingResponse(
                buf,
                media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                headers={"Content-Disposition": f'attachment; filename="{filename_base}.xlsx"'}
            )
        except ImportError:
            # Fall back to CSV if openpyxl not installed
            pass

    # CSV (default)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(headers)
    writer.writerows(rows)
    buf.seek(0)
    return StreamingResponse(
        io.BytesIO(buf.getvalue().encode("utf-8-sig")),  # utf-8-sig for Excel compatibility
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename_base}.csv"'}
    )
