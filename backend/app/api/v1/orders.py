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
from datetime import date, datetime, timedelta, timezone
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
from app.models.execution_log import ExecutionLog

router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────

class ExitPriceRequest(BaseModel):
    exit_price: float


class SyncOrderRequest(BaseModel):
    broker_order_id: str   # Order ID from broker platform (Zerodha: Order ID, Angel One: Broker Order No.)
    account_id:      str   # which account this order belongs to (to pick correct broker)


class SquareOffRequest(BaseModel):
    order_ids: Optional[list] = None  # if None/empty → SQ all open legs
    reason: str = "manual_sq"


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

        IST = timezone(timedelta(hours=5, minutes=30))
        one_hour_ago = datetime.now(IST) - timedelta(hours=1)

        for aid, group_orders in by_algo.items():
            meta = algo_meta.get(aid, {})
            mtm  = round(sum((o.get("pnl") or 0.0) for o in group_orders), 2)

            # Fetch latest FAILED execution log in the past hour for this algo
            latest_error = None
            try:
                group_algo_id_uuid = _uuid.UUID(aid)
                err_result = await db.execute(
                    select(ExecutionLog)
                    .where(
                        ExecutionLog.algo_id == group_algo_id_uuid,
                        ExecutionLog.status == "FAILED",
                        ExecutionLog.timestamp >= one_hour_ago,
                    )
                    .order_by(ExecutionLog.timestamp.desc())
                    .limit(1)
                )
                err = err_result.scalar_one_or_none()
                latest_error = {
                    "reason":     err.reason,
                    "event_type": err.event_type,
                    "timestamp":  err.timestamp.isoformat() if err.timestamp else None,
                } if err else None
            except Exception as e:
                logger.warning(f"[orders] latest_error fetch failed for algo {aid}: {e}")

            groups.append({
                "algo_id":      aid,
                "algo_name":    meta.get("algo_name", ""),
                "account":      meta.get("account", ""),
                "mtm":          mtm,
                "mtm_sl":       meta.get("mtm_sl", 0),
                "mtm_tp":       meta.get("mtm_tp", 0),
                "latest_error": latest_error,
                "orders":       group_orders,
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
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Return a Trade Replay payload for a given algo_id and date.
    Fetches all orders for that algo on that day (using fill_time for date match),
    builds separate ENTRY and EXIT events, running P&L curve, and summary stats.
    """
    import uuid as _uuid_mod
    import datetime as _dt
    from zoneinfo import ZoneInfo

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

    # Convert IST date boundaries to UTC for the fill_time filter.
    # More reliable than PostgreSQL func.timezone casting across PG versions.
    _IST = ZoneInfo("Asia/Kolkata")
    _UTC = ZoneInfo("UTC")
    ist_start = _dt.datetime(target_date.year, target_date.month, target_date.day,
                             0, 0, 0, tzinfo=_IST)
    ist_end   = ist_start + _dt.timedelta(days=1)
    utc_start = ist_start.astimezone(_UTC)
    utc_end   = ist_end.astimezone(_UTC)

    result = await db.execute(
        select(Order).where(
            Order.algo_id == algo_uuid,
            Order.status == OrderStatus.CLOSED,
            Order.fill_time >= utc_start,
            Order.fill_time <  utc_end,
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

    # Build ENTRY and EXIT event lists separately.
    # Running P&L is only accumulated on exits (in exit_time order).
    # This ensures ENTRY events always show pnl_at_time=0 (no realized P&L
    # at the moment of entry), and EXIT pnl_at_time reflects the true
    # cumulative P&L after each leg closes — not the processing order.
    entry_events: list = []
    exit_raw: list = []

    for order in orders_raw:
        direction  = (order.direction or "").upper()
        symbol_str = order.symbol or ""

        if order.fill_time:
            entry_price = float(order.fill_price or 0)
            entry_events.append({
                "type":        "ENTRY",
                "description": f"{direction} {symbol_str} @{entry_price}",
                "price":       entry_price,
                "pnl_at_time": 0.0,
                "symbol":      symbol_str,
                "time":        _fmt_time(order.fill_time),
                "_sort_dt":    order.fill_time,
            })

        if order.exit_time and order.pnl is not None:
            exit_price = float(
                order.exit_price_manual if order.exit_price_manual is not None
                else (order.exit_price or 0)
            )
            exit_raw.append({
                "order":       order,
                "exit_price":  exit_price,
                "pnl_this":    float(order.pnl),
                "symbol":      symbol_str,
                "_sort_dt":    order.exit_time,
            })

    # Sort exits by exit_time, then accumulate running P&L
    exit_raw.sort(key=lambda x: x["_sort_dt"])
    running_pnl = 0.0
    cumulative_pnl_values = [0.0]
    exit_events: list = []
    for ex in exit_raw:
        pnl_this    = ex["pnl_this"]
        running_pnl = round(running_pnl + pnl_this, 2)
        cumulative_pnl_values.append(running_pnl)
        exit_type   = _map_exit_reason(ex["order"].exit_reason)
        pnl_sign    = "+" if pnl_this >= 0 else ""
        exit_events.append({
            "type":        exit_type,
            "description": f"{exit_type.replace('_', ' ')} {ex['symbol']} @{ex['exit_price']}  {pnl_sign}₹{pnl_this:.2f}",
            "price":       ex["exit_price"],
            "pnl_at_time": running_pnl,
            "symbol":      ex["symbol"],
            "time":        _fmt_time(ex["order"].exit_time),
        })

    # Strip internal sort key and combine
    for e in entry_events:
        del e["_sort_dt"]

    events = entry_events + exit_events
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

    # ── Per-leg candle fetch helpers ──────────────────────────────────────────
    _IST_zone = _dt.timezone(_dt.timedelta(hours=5, minutes=30))

    def _to_ist_api_str(utc_dt: _dt.datetime) -> str:
        if utc_dt.tzinfo is None:
            utc_dt = utc_dt.replace(tzinfo=_dt.timezone.utc)
        return utc_dt.astimezone(_IST_zone).strftime("%Y-%m-%d %H:%M")

    def _parse_candle_ts(ts_str: str) -> str:
        try:
            dt = _dt.datetime.fromisoformat(str(ts_str))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=_IST_zone)
            return dt.astimezone(_IST_zone).strftime("%H:%M:%S")
        except Exception:
            return "—"

    # Find any valid Angel One broker on app.state
    angel_broker = None
    for _key in ("angelone_karthik", "angelone_wife", "angelone_mom"):
        _b = getattr(request.app.state, _key, None)
        if _b and _b.is_token_set():
            angel_broker = _b
            break

    async def _fetch_candles(order) -> tuple[list[dict], str]:
        """Return (candle_pts, error_reason). error_reason='' means success."""
        if not angel_broker:
            return [], "no_broker"
        if not order.instrument_token:
            return [], "no_instrument_token"
        if not order.fill_time or not order.exit_time:
            return [], "no_times"
        try:
            raw = await angel_broker.get_candle_data(
                symbol       = order.symbol or "",
                exchange     = order.exchange or "NFO",
                interval     = "ONE_MINUTE",
                symbol_token = str(order.instrument_token),
                from_dt      = _to_ist_api_str(order.fill_time),
                to_dt        = _to_ist_api_str(order.exit_time),
            )
            if not raw:
                return [], "no_data"
            fp  = float(order.fill_price or 0)
            qty = float(order.quantity or 1)
            buy = (order.direction or "buy").lower() == "buy"
            pts = []
            for c in raw:
                if len(c) < 5:
                    continue
                close = float(c[4])
                c_pnl = (close - fp) * qty if buy else (fp - close) * qty
                pts.append({"time": _parse_candle_ts(c[0]), "ltp": close, "pnl": round(c_pnl, 2)})
            return pts, ""
        except Exception as e:
            logger.warning(f"[REPLAY] Candle fetch failed for order {order.id}: {e}")
            return [], "api_error"

    # ── Build legs with candles + SL/TP annotations ───────────────────────────
    legs: list[dict] = []
    for order in orders_raw:
        if not (order.fill_time and order.exit_time and order.pnl is not None):
            continue
        ep  = float(order.fill_price or 0)
        xp  = float(
            order.exit_price_manual if order.exit_price_manual is not None
            else (order.exit_price or 0)
        )
        op_pnl     = float(order.pnl)
        candles, candle_err = await _fetch_candles(order)

        # Anchor candles at exact entry (pnl=0) and exit (pnl=final)
        if candles:
            entry_pt = {"time": _fmt_time(order.fill_time), "ltp": ep, "pnl": 0.0}
            exit_pt  = {"time": _fmt_time(order.exit_time), "ltp": xp, "pnl": round(op_pnl, 2)}
            inner    = [c for c in candles if c["time"] not in (entry_pt["time"], exit_pt["time"])]
            candles  = [entry_pt] + inner + [exit_pt]

        # SL/TP P&L levels (pre-computed so frontend only needs toY(sl_pnl))
        qty = float(getattr(order, "quantity", None) or 1)
        buy = (order.direction or "buy").lower() == "buy"

        sl_actual = getattr(order, "sl_actual", None)
        sl_pnl    = None
        if sl_actual:
            sl_actual = float(sl_actual)
            sl_pnl = round((sl_actual - ep) * qty if buy else (ep - sl_actual) * qty, 2)

        ttp_activated = getattr(order, "ttp_activated", False)
        ttp_current_tp = getattr(order, "ttp_current_tp", None)
        tp_actual = float(ttp_current_tp) if (ttp_activated and ttp_current_tp) else None
        tp_pnl    = None
        if tp_actual:
            tp_pnl = round((tp_actual - ep) * qty if buy else (ep - tp_actual) * qty, 2)

        exit_reason_raw = getattr(order, "exit_reason", None)
        exit_reason_str = exit_reason_raw.value if hasattr(exit_reason_raw, "value") else str(exit_reason_raw or "")

        legs.append({
            "symbol":       order.symbol or "",
            "direction":    (order.direction or "").upper(),
            "entry_time":   _fmt_time(order.fill_time),
            "exit_time":    _fmt_time(order.exit_time),
            "entry_price":  ep,
            "exit_price":   xp,
            "pnl":          op_pnl,
            "candles":      candles,
            "candle_error": candle_err,
            "sl_pnl":       sl_pnl,
            "sl_level":     sl_actual,
            "tp_pnl":       tp_pnl,
            "tp_level":     tp_actual,
            "sl_hit":       exit_reason_str in ("sl", "tsl"),
            "tp_hit":       exit_reason_str == "tp",
            "auto_sq":      exit_reason_str in ("sq", "auto_sq"),
            "exit_reason":  exit_reason_str,
        })

    # ── Combined MTM curve ────────────────────────────────────────────────────
    mtm_curve: list[dict] = []
    if any(leg["candles"] for leg in legs):
        all_times: set[str] = set()
        for leg in legs:
            for c in leg["candles"]:
                all_times.add(c["time"])
        for t in sorted(all_times):
            combined = 0.0
            for leg in legs:
                et = leg["entry_time"]
                xt = leg["exit_time"]
                if t < et:
                    pass
                elif t >= xt:
                    combined += leg["pnl"]
                else:
                    before = [c for c in leg["candles"] if c["time"] <= t]
                    if before:
                        combined += before[-1]["pnl"]
            mtm_curve.append({"time": t, "pnl": round(combined, 2)})

    # ── Underlying index candles ──────────────────────────────────────────────
    def _detect_underlying(symbol: str) -> tuple[str, str, str]:
        s = (symbol or "").upper()
        if "BANKNIFTY" in s:
            return "BANKNIFTY", "99926009", "NSE"
        if "NIFTY" in s:
            return "NIFTY", "99926000", "NSE"
        if "SENSEX" in s:
            return "SENSEX", "99919000", "BSE"
        return "", "", ""

    underlying_name: str = ""
    underlying_candles: list[dict] = []

    if angel_broker and orders_raw and first_fill and last_exit:
        u_name, u_token, u_exchange = _detect_underlying(orders_raw[0].symbol or "")
        if u_name:
            try:
                u_raw = await angel_broker.get_candle_data(
                    symbol       = "",
                    exchange     = u_exchange,
                    interval     = "ONE_MINUTE",
                    symbol_token = u_token,
                    from_dt      = _to_ist_api_str(first_fill),
                    to_dt        = _to_ist_api_str(last_exit),
                )
                if u_raw:
                    ref_price = float(u_raw[0][4])
                    underlying_name = u_name
                    for c in u_raw:
                        if len(c) < 5:
                            continue
                        price = float(c[4])
                        pct   = round((price - ref_price) / ref_price * 100, 3) if ref_price else 0.0
                        underlying_candles.append({
                            "time":       _parse_candle_ts(c[0]),
                            "price":      price,
                            "pct_change": pct,
                        })
            except Exception as e:
                logger.warning(f"[REPLAY] Underlying fetch failed: {e}")

    # ── Trade statistics ──────────────────────────────────────────────────────
    pnl_series  = [p["pnl"] for p in mtm_curve] if mtm_curve else cumulative_pnl_values
    time_series = [p["time"] for p in mtm_curve] if mtm_curve else []

    stats: dict = {}
    if pnl_series:
        max_p = max(pnl_series)
        min_p = min(pnl_series)
        stats["max_profit"]       = round(max_p, 2)
        stats["max_drawdown"]     = round(min_p, 2)
        stats["avg_mtm"]          = round(sum(pnl_series) / len(pnl_series), 2)
        stats["duration_minutes"] = duration_minutes
        stats["time_at_peak"]     = time_series[pnl_series.index(max_p)] if time_series else "—"
        stats["time_at_trough"]   = time_series[pnl_series.index(min_p)] if time_series else "—"
        gross_profit = sum(leg["pnl"] for leg in legs if leg["pnl"] > 0)
        gross_loss   = abs(sum(leg["pnl"] for leg in legs if leg["pnl"] < 0))
        stats["profit_factor"]    = round(gross_profit / gross_loss, 2) if gross_loss > 0 else None

    return {
        "algo_name":           algo_name,
        "date":                date,
        "events":              events,
        "summary":             summary,
        "legs":                legs,
        "mtm_curve":           mtm_curve,
        "underlying_name":     underlying_name,
        "underlying_candles":  underlying_candles,
        "stats":               stats if stats else None,
    }


@router.get("/open-positions")
async def list_open_positions(
    request: Request,
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

    ltp_cache = getattr(request.app.state, "ltp_cache", None)

    # Group by algo_id
    by_algo: dict = {}
    ge_map: dict = {}
    open_orders_raw: list = []
    for order, ge in rows:
        aid = str(order.algo_id)
        if aid not in by_algo:
            by_algo[aid] = []
            ge_map[aid] = ge
        open_orders_raw.append((aid, order))

    # Enrich each order dict with live LTP from cache
    for aid, order in open_orders_raw:
        od = _order_to_dict(order)
        if ltp_cache and order.instrument_token:
            try:
                live_ltp = await ltp_cache.get(order.instrument_token)
                if live_ltp is not None:
                    od["ltp"] = live_ltp
                    if order.fill_price and order.quantity:
                        if order.direction == "sell":
                            od["pnl"] = round((order.fill_price - live_ltp) * order.quantity, 2)
                        else:
                            od["pnl"] = round((live_ltp - order.fill_price) * order.quantity, 2)
            except Exception as e:
                logger.warning(f"[open-positions] ltp_cache.get failed for token {order.instrument_token}: {e}")
        by_algo[aid].append(od)

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

    IST = timezone(timedelta(hours=5, minutes=30))
    one_hour_ago = datetime.now(IST) - timedelta(hours=1)

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
        # Fetch latest FAILED execution log in the past hour for this algo
        latest_error = None
        try:
            err_result = await db.execute(
                select(ExecutionLog)
                .where(
                    ExecutionLog.algo_id == a.id,
                    ExecutionLog.status == "FAILED",
                    ExecutionLog.timestamp >= one_hour_ago,
                )
                .order_by(ExecutionLog.timestamp.desc())
                .limit(1)
            )
            err = err_result.scalar_one_or_none()
            if err:
                latest_error = {
                    "reason":     err.reason,
                    "event_type": err.event_type,
                    "timestamp":  err.timestamp.isoformat() if err.timestamp else None,
                }
        except Exception as e:
            logger.warning(f"[waiting] latest_error fetch failed for algo {a.id}: {e}")

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
            "latest_error":   latest_error,
        })

    # Sort combined list by entry_time
    waiting.sort(key=lambda x: x["entry_time"] or "")

    return {
        "trading_date": target_date.isoformat(),
        "waiting":      waiting,
    }


@router.get("/ltp")
async def get_orders_ltp(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Returns live LTP and unrealised P&L for all OPEN orders.
    LTP is read from ltp_cache (Redis). P&L is computed on the fly.
    """
    from zoneinfo import ZoneInfo
    _IST = ZoneInfo("Asia/Kolkata")

    result = await db.execute(
        select(Order).where(Order.status == OrderStatus.OPEN)
    )
    open_orders = result.scalars().all()

    ltp_cache = getattr(request.app.state, "ltp_cache", None)

    ltp_map: dict = {}
    for order in open_orders:
        oid = str(order.id)
        live_ltp: Optional[float] = None
        if ltp_cache and order.instrument_token:
            try:
                live_ltp = await ltp_cache.get(order.instrument_token)
            except Exception as e:
                logger.warning(f"[orders/ltp] ltp_cache.get failed for token {order.instrument_token}: {e}")

        pnl: Optional[float] = None
        if live_ltp is not None and order.fill_price and order.quantity:
            if order.direction == "sell":
                pnl = round((order.fill_price - live_ltp) * order.quantity, 2)
            else:
                pnl = round((live_ltp - order.fill_price) * order.quantity, 2)

        ltp_map[oid] = {
            "order_id":   oid,
            "symbol":     order.symbol,
            "ltp":        live_ltp,
            "pnl":        pnl,
            "fill_price": order.fill_price,
        }

    now_ist = datetime.now(_IST).isoformat()
    return {"ltp": ltp_map, "timestamp": now_ist}


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
    from app.core.config import settings as _settings

    # 1. Get broker instance from app.state
    acc_result = await db.execute(select(Account).where(Account.id == body.account_id))
    account = acc_result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    broker = None
    if account.broker == BrokerType.ZERODHA:
        broker = getattr(request.app.state, "zerodha", None)
    elif account.broker == BrokerType.ANGELONE:
        # Resolve the correct Angel One broker instance using client_id → state key mapping.
        # This handles any number of AO accounts without hardcoding nicknames.
        _CLIENT_ID_TO_BROKER_KEY = {k: v for k, v in [
            (_settings.ANGELONE_MOM_CLIENT_ID,     "angelone_mom"),
            (_settings.ANGELONE_WIFE_CLIENT_ID,    "angelone_wife"),
            (_settings.ANGELONE_KARTHIK_CLIENT_ID, "angelone_karthik"),
        ] if k}
        broker_key = _CLIENT_ID_TO_BROKER_KEY.get(account.client_id)
        if broker_key:
            broker = getattr(request.app.state, broker_key, None)
    else:
        raise HTTPException(status_code=503, detail=f"Broker type '{account.broker}' not supported for sync")

    if not broker:
        raise HTTPException(status_code=503, detail="Broker not connected — login first")

    # 2. Fetch order details from broker
    try:
        broker_order = await broker.get_order_status(body.broker_order_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Broker fetch failed: {str(e)}")

    if not broker_order:
        raise HTTPException(status_code=404, detail="Order not found at broker")

    # 3. Validate fill price — reject sync if broker returned 0 or missing
    fill_price = broker_order.get("fill_price") or broker_order.get("averageprice") or broker_order.get("average_price", 0)
    fill_price = float(fill_price or 0)
    if fill_price <= 0:
        raise HTTPException(
            status_code=400,
            detail=f"Broker returned invalid fill price ({fill_price}) for order {body.broker_order_id}. Cannot sync."
        )

    # 4. Find unlinked order in DB for this algo today
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

    if not unlinked:
        raise HTTPException(
            status_code=404,
            detail="No unlinked order found for this algo today. The order may already be linked or doesn't exist in STAAX."
        )

    # 5. Re-link the order
    unlinked.broker_order_id = body.broker_order_id
    unlinked.fill_price      = fill_price
    unlinked.status          = OrderStatus.OPEN
    unlinked.is_synced       = True
    await db.commit()
    await db.refresh(unlinked)

    # 6. Subscribe LTP for the synced order so live price feed starts
    try:
        ltp_consumer = getattr(request.app.state, "ltp_consumer", None)
        if ltp_consumer and unlinked.instrument_token:
            ltp_consumer.subscribe([int(unlinked.instrument_token)])
            logger.info(f"[SYNC] Subscribed token {unlinked.instrument_token} for synced order {unlinked.id}")
    except Exception as e:
        logger.warning(f"[SYNC] Could not subscribe LTP: {e}")

    # 7. Update AlgoState — clear ERROR if no more error orders remain for this algo
    try:
        from sqlalchemy import func as _func
        error_count_result = await db.execute(
            select(_func.count(Order.id)).where(
                Order.algo_id == algo_id,
                Order.status == OrderStatus.ERROR,
            )
        )
        error_count = error_count_result.scalar()

        algo_state_result = await db.execute(
            select(AlgoState).where(
                AlgoState.algo_id == algo_id,
                AlgoState.trading_date == str(today),
            )
        )
        algo_state = algo_state_result.scalar_one_or_none()

        if algo_state and error_count == 0:
            algo_state.status = AlgoRunStatus.ACTIVE
            algo_state.error_message = None
            await db.commit()
            logger.info(f"[SYNC] AlgoState set to ACTIVE for algo {algo_id} after sync")
    except Exception as e:
        logger.warning(f"[SYNC] Could not update AlgoState: {e}")

    # 8. Register with TSL/TTP engines if the leg has trailing config
    try:
        from app.models.algo import AlgoLeg
        from app.engine.tsl_engine import TSLState
        from app.engine.ttp_engine import TTPState

        tsl_engine = getattr(request.app.state, "tsl_engine", None)
        ttp_engine = getattr(request.app.state, "ttp_engine", None)

        if (tsl_engine or ttp_engine) and unlinked.leg_id:
            leg_result = await db.execute(select(AlgoLeg).where(AlgoLeg.id == unlinked.leg_id))
            leg = leg_result.scalar_one_or_none()

            if leg and tsl_engine and getattr(leg, "tsl_enabled", False) and leg.tsl_x and leg.tsl_y:
                tsl_state = TSLState(
                    order_id=str(unlinked.id),
                    direction=unlinked.direction or "buy",
                    entry_price=fill_price,
                    current_sl=unlinked.sl_actual or (fill_price * 0.9),
                    tsl_x=leg.tsl_x,
                    tsl_y=leg.tsl_y,
                    tsl_unit=leg.tsl_unit or "pts",
                )
                tsl_engine.register(tsl_state)
                logger.info(f"[SYNC] TSL registered for synced order {unlinked.id}")

            ttp_enabled = getattr(leg, "ttp_enabled", False) if leg else False
            if leg and not ttp_enabled:
                ttp_enabled = bool(leg.ttp_x and leg.ttp_y and unlinked.target)
            if leg and ttp_engine and ttp_enabled and leg.ttp_x and leg.ttp_y:
                initial_tp = unlinked.target or fill_price * 1.1
                ttp_state = TTPState(
                    order_id=str(unlinked.id),
                    direction=unlinked.direction or "buy",
                    entry_price=fill_price,
                    current_tp=initial_tp,
                    ttp_x=leg.ttp_x,
                    ttp_y=leg.ttp_y,
                    ttp_unit=leg.ttp_unit or "pts",
                )
                ttp_engine.register(ttp_state)
                logger.info(f"[SYNC] TTP registered for synced order {unlinked.id}")
    except Exception as e:
        logger.warning(f"[SYNC] Could not register TSL/TTP: {e}")

    return {
        "status":  "ok",
        "message": f"✅ Order re-linked — {unlinked.symbol}",
        "order":   _order_to_dict(unlinked),
    }


@router.post("/{algo_id}/square-off")
async def square_off(
    algo_id: str,
    body: SquareOffRequest = SquareOffRequest(),
    request: Request = None,
    db: AsyncSession = Depends(get_db),
):
    """
    Square off open positions for an algo.
    - If body.order_ids is provided: only those specific orders are squared off.
    - Otherwise: all open orders for today's grid entry are squared off.
    Supports PRACTIX (no-broker, LTP-based) and LIVE (broker call) modes.
    Deregisters from TSL/TTP engines after closing each order.
    Updates AlgoState to 'closed' when all legs are gone, or 'active' if partial.
    """
    from sqlalchemy import func as sa_func
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

    # Build query for open orders
    base_query = select(Order).where(
        Order.grid_entry_id == grid_entry.id,
        Order.status == OrderStatus.OPEN,
    )
    if body.order_ids:
        base_query = base_query.where(Order.id.in_(body.order_ids))

    open_orders_result = await db.execute(base_query)
    open_orders = open_orders_result.scalars().all()

    now = datetime.now(timezone.utc)

    # Get engine references from app state
    tsl_engine = getattr(request.app.state, "tsl_engine", None) if request else None
    ttp_engine = getattr(request.app.state, "ttp_engine", None) if request else None
    ltp_cache  = getattr(request.app.state, "ltp_cache",  None) if request else None

    # Look up broker_type from account (all orders share the same account)
    sq_broker_type = "zerodha"
    if open_orders:
        try:
            acc_result = await db.execute(
                select(Account).where(Account.id == open_orders[0].account_id)
            )
            sq_account = acc_result.scalar_one_or_none()
            if sq_account and sq_account.broker:
                sq_broker_type = sq_account.broker.value
        except Exception as e:
            logger.warning(f"[SQ] Could not resolve broker_type from account: {e}")

    squared_off = []
    failed      = []

    for order in open_orders:
        order_id_str = str(order.id)

        if order.is_practix:
            # ── PRACTIX mode: no broker call, use LTP from cache ──────────────
            exit_price = order.fill_price  # fallback
            if ltp_cache and order.instrument_token:
                try:
                    ltp_val = await ltp_cache.get(order.instrument_token)
                    if ltp_val is not None:
                        exit_price = ltp_val
                except Exception as e:
                    logger.warning(f"[SQ] ltp_cache.get failed for token {order.instrument_token}: {e}")

            order.status      = OrderStatus.CLOSED
            order.exit_price  = exit_price
            order.exit_reason = ExitReason.SQ
            order.exit_time   = now

            # Deregister from TSL/TTP
            if tsl_engine:
                tsl_engine.deregister(order_id_str)
            if ttp_engine:
                ttp_engine.deregister(order_id_str)

            squared_off.append({"order_id": order_id_str, "exit_price": exit_price})

        else:
            # ── LIVE mode: call broker via ExecutionManager ───────────────────
            broker_ok = False
            try:
                result = await execution_manager.square_off(
                    db              = db,
                    idempotency_key = f"manualsq:{order.id}:{reason}",
                    algo_id         = str(order.algo_id),
                    account_id      = str(order.account_id),
                    symbol          = order.symbol,
                    exchange        = order.exchange or "NFO",
                    direction       = order.direction,
                    quantity        = order.quantity,
                    algo_tag        = order.algo_tag or "",
                    is_practix      = order.is_practix,
                    broker_type     = sq_broker_type,
                    symbol_token    = str(getattr(order, "instrument_token", None) or ""),
                    broker_order_id = order.broker_order_id,
                )
                broker_ok = True
                # result is the new exit broker_order_id (str) or None; use fill_price as exit_price
                exit_price = order.fill_price

                order.status      = OrderStatus.CLOSED
                order.exit_price  = exit_price
                order.exit_reason = ExitReason.SQ
                order.exit_time   = now

                # Deregister from TSL/TTP
                if tsl_engine:
                    tsl_engine.deregister(order_id_str)
                if ttp_engine:
                    ttp_engine.deregister(order_id_str)

                squared_off.append({"order_id": order_id_str, "exit_price": exit_price})

            except Exception as e:
                logger.warning(f"[SQ] Broker square-off failed for order {order.id}: {e}")
                if not broker_ok:
                    failed.append({"order_id": order_id_str, "error": str(e)})

    await db.commit()

    # ── Update AlgoState ──────────────────────────────────────────────────────
    algo_state = None
    try:
        today_str = today.isoformat()
        algo_state_result = await db.execute(
            select(AlgoState).where(
                AlgoState.algo_id == algo_id,
                AlgoState.trading_date == today_str,
            )
        )
        algo_state = algo_state_result.scalar_one_or_none()

        if algo_state:
            remaining_result = await db.execute(
                select(sa_func.count(Order.id)).where(
                    Order.grid_entry_id == grid_entry.id,
                    Order.status == OrderStatus.OPEN,
                )
            )
            remaining_count = remaining_result.scalar() or 0

            if remaining_count == 0:
                algo_state.status     = AlgoRunStatus.CLOSED
                algo_state.closed_at  = now
                algo_state.exit_reason = "sq"
            else:
                # Partial SQ — keep active (no partial_sq enum value)
                algo_state.status = AlgoRunStatus.ACTIVE

            await db.commit()
    except Exception as e:
        logger.warning(f"[SQ] AlgoState update failed for algo {algo_id}: {e}")

    # Trigger immediate reconciliation after square-off
    try:
        from app.engine.order_reconciler import order_reconciler
        import asyncio
        asyncio.ensure_future(order_reconciler.run())
    except Exception as e:
        logger.warning(f"[ORDERS] Post-SQ reconciliation trigger failed: {e}")

    return {
        "status":      "ok",
        "algo_id":     algo_id,
        "squared_off": squared_off,
        "failed":      failed,
        "algo_state":  algo_state.status.value if algo_state else None,
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
