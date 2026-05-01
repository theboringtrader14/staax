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
from sqlalchemy import select, and_, or_, update
from pydantic import BaseModel
from typing import Optional
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import logging
import uuid as _uuid
from app.core.database import get_db
logger = logging.getLogger(__name__)
from app.engine.execution_manager import execution_manager
from app.models.order import Order, OrderStatus, ExitReason
from app.models.grid import GridEntry, GridStatus
from app.models.algo import Algo, AlgoLeg
from app.models.account import Account
from app.models.algo_state import AlgoState, AlgoRunStatus
from app.models.execution_log import ExecutionLog

router = APIRouter()

# ── In-memory retry timestamps (set by explicit user RETRY, cleared on exit) ──
# Key: grid_entry_id (str), Value: datetime of retry. Used by /waiting to
# suppress "effectively missed" for W&T algos that were just manually retried.
_retry_timestamps: dict = {}


# ── Schemas ───────────────────────────────────────────────────────────────────

class ExitPriceRequest(BaseModel):
    exit_price: float


class SyncOrderRequest(BaseModel):
    broker_order_id: str   # Order ID from broker platform (Zerodha: Order ID, Angel One: Broker Order No.)
    account_id:      str   # which account this order belongs to (to pick correct broker)


class SquareOffRequest(BaseModel):
    order_ids: Optional[list] = None  # if None/empty → SQ all open legs
    reason: str = "manual_sq"


class RetryLegsRequest(BaseModel):
    leg_ids: list  # AlgoLeg UUIDs (order.leg_id values) to retry


# ── Helpers ───────────────────────────────────────────────────────────────────

def _live_pnl(order: Order) -> Optional[float]:
    """
    Return the best available P&L for an order:
    - CLOSED: use stored order.pnl (broker-confirmed exit price)
    - OPEN:   compute from order.ltp (last tick written by engine)
              formula mirrors _compute_pnl in algo_runner: (exit - fill) * qty
              Returns None if fill_price or ltp is missing.
    """
    if order.status != OrderStatus.OPEN:
        return order.pnl
    if not order.fill_price or not order.ltp:
        return None
    qty = order.quantity or 0
    if order.direction == "buy":
        return round((order.ltp - order.fill_price) * qty, 2)
    else:
        return round((order.fill_price - order.ltp) * qty, 2)


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
        "lot_size":          order.lot_size or 1,
        "quantity":          order.quantity,
        "entry_type":        order.entry_type,
        "entry_reference":   order.entry_reference,
        "instrument_token":  order.instrument_token,
        "fill_price":        order.fill_price,
        "fill_time":         order.fill_time.isoformat() if order.fill_time else None,
        "ltp":               order.ltp,
        "sl_original":       order.sl_original,
        "sl_actual":         order.sl_actual,
        "sl_type":           getattr(order, 'sl_type', None),  # on AlgoLeg, not Order — safe fallback
        "tsl_trail_count":   order.tsl_trail_count,
        "target":            order.target,
        "exit_price":        order.exit_price_manual if order.exit_price_manual else order.exit_price,
        "exit_price_raw":    order.exit_price,
        "exit_price_manual": order.exit_price_manual,
        "exit_time":         order.exit_time.isoformat() if order.exit_time and order.status == OrderStatus.CLOSED else None,
        "exit_reason":       order.exit_reason.value if order.exit_reason else None,
        "pnl":               _live_pnl(order),
        "reconcile_status":  order.reconcile_status,
        "status":            order.status.value if order.status else "pending",
        "journey_level":     order.journey_level,
        "error_message":     order.error_message,
        "created_at":        order.created_at.isoformat() if order.created_at else None,
        "updated_at":        order.updated_at.isoformat() if order.updated_at else None,
        "sl_order_id":       getattr(order, "sl_order_id",     None),
        "sl_order_status":   getattr(order, "sl_order_status", None),
        "sl_warning":        getattr(order, "sl_warning",      None),
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
    request:      Request,
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
    target_date = _parse_date(trading_date) or datetime.now(ZoneInfo("Asia/Kolkata")).date()

    # Find all GridEntries strictly for this trading date
    grid_result = await db.execute(
        select(GridEntry).where(
            GridEntry.trading_date == target_date,
            GridEntry.status != GridStatus.NO_TRADE,
        )
    )
    grid_entries = grid_result.scalars().all()
    grid_entry_ids = [e.id for e in grid_entries]
    algo_to_ge: dict = {str(ge.algo_id): ge for ge in grid_entries}

    if not grid_entry_ids:
        return {
            "trading_date": target_date.isoformat(),
            "orders":       [],
            "by_algo":      {},
            "groups":       [],
            "total":        0,
        }

    # Build query — strictly this date's grid entries; overnight/BTST orders stay
    # under their own entry date and never bleed into subsequent days
    conditions = [
        Order.grid_entry_id.in_(grid_entry_ids)
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

    # ── Enrich open orders with live LTP from cache ───────────────────────────
    # order.ltp in DB may be stale or None for open legs; ltp_cache (Redis) has
    # the most recent tick written by LTPConsumer on every market tick.
    ltp_cache = getattr(request.app.state, "ltp_cache", None)
    if ltp_cache:
        # Build token→order-dict map for open orders that have an instrument_token
        token_to_open: dict = {}
        for od, o in zip(orders_list, orders):
            if od.get("status") == "open" and o.instrument_token:
                token_to_open[int(o.instrument_token)] = (od, o)
        if token_to_open:
            try:
                live_ltps = await ltp_cache.get_many(list(token_to_open.keys()))
                for token, live_ltp in live_ltps.items():
                    od, o = token_to_open[token]
                    od["ltp"] = live_ltp
                    if o.fill_price and o.quantity:
                        if o.direction == "sell":
                            od["pnl"] = round((o.fill_price - live_ltp) * o.quantity, 2)
                        else:
                            od["pnl"] = round((live_ltp - o.fill_price) * o.quantity, 2)
            except Exception as _ltp_err:
                logger.warning(f"[orders] live LTP enrichment failed: {_ltp_err}")
    # ─────────────────────────────────────────────────────────────────────────

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
                    "algo_name":    a.name,
                    "account":      acc.nickname if acc else "",
                    "mtm_sl":       a.mtm_sl or 0,
                    "mtm_tp":       a.mtm_tp or 0,
                    "entry_type":   a.entry_type.value if a.entry_type else "",
                    "orb_end_time": a.orb_end_time or None,
                    "exit_time":    a.exit_time,  # algo-configured exit time (HH:MM) for display
                }
        except Exception as e:
            logger.warning(f"[orders] groups metadata fetch failed: {e}")
            algo_meta = {}

        IST = timezone(timedelta(hours=5, minutes=30))
        one_hour_ago = datetime.now(IST) - timedelta(hours=1)

        for aid, group_orders in by_algo.items():
            meta = algo_meta.get(aid, {})
            closed_pnl = round(sum((o.get("pnl") or 0.0) for o in group_orders if o.get("status") == "closed"), 2)
            open_pnl   = round(sum((o.get("pnl") or 0.0) for o in group_orders if o.get("status") == "open"),   2)
            mtm  = round(closed_pnl + open_pnl, 2)

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

            ge = algo_to_ge.get(aid)
            _algo_exit_time = meta.get("exit_time")  # HH:MM — algo configured exit time
            groups.append({
                "algo_id":        aid,
                "algo_name":      meta.get("algo_name", ""),
                "account":        meta.get("account", ""),
                "closed_pnl":     closed_pnl,
                "open_pnl":       open_pnl,
                "total_pnl":      mtm,   # alias — open legs use ltp-based pnl, closed use exit pnl
                "mtm":            mtm,   # keep for backwards compat
                "mtm_sl":         meta.get("mtm_sl", 0),
                "mtm_tp":         meta.get("mtm_tp", 0),
                "latest_error":   latest_error,
                "orders":         group_orders,
                "grid_entry_id":  str(ge.id) if ge else None,
                "entry_type":     meta.get("entry_type", ""),
                "orb_end_time":   meta.get("orb_end_time", None),
                "algo_exit_time": _algo_exit_time,  # algo-configured exit time for display
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
    target_date = _parse_date(trading_date) or datetime.now(ZoneInfo("Asia/Kolkata")).date()

    IST = timezone(timedelta(hours=5, minutes=30))
    one_hour_ago = datetime.now(IST) - timedelta(hours=1)

    # Four conditions for surfacing an algo in the waiting section:
    # 1. ALGO_ACTIVE + WAITING  → entry time not yet reached, genuinely waiting
    # 2. ERROR (grid or state)  → hard error before/during placement
    # 3. NO_TRADE + error_msg   → engine failure (MissingGreenlet, PendingRollbackError, etc.)
    # 4. NO_TRADE + activated_at + no error_msg → ENTRY_MISSED (backend restarted after window)
    activated_result = await db.execute(
        select(GridEntry, Algo, Account, AlgoState)
        .join(Algo, GridEntry.algo_id == Algo.id)
        .join(Account, GridEntry.account_id == Account.id)
        .join(AlgoState, AlgoState.grid_entry_id == GridEntry.id)
        .where(
            GridEntry.trading_date == target_date,
            GridEntry.is_archived == False,
            GridEntry.is_enabled == True,
            Algo.is_archived == False,   # never surface archived algos in waiting
            *([] if is_practix is None else [GridEntry.is_practix == is_practix]),
            or_(
                # 1. Genuinely waiting — entry time not reached yet
                and_(
                    GridEntry.status == GridStatus.ALGO_ACTIVE,
                    AlgoState.status == AlgoRunStatus.WAITING,
                ),
                # 2. Hard error on grid entry or algo state
                GridEntry.status == GridStatus.ERROR,
                AlgoState.status == AlgoRunStatus.ERROR,
                # 3. Engine failure — NO_TRADE with error recorded
                and_(
                    GridEntry.status == GridStatus.NO_TRADE,
                    AlgoState.status == AlgoRunStatus.NO_TRADE,
                    AlgoState.error_message.isnot(None),
                ),
                # 4. ENTRY_MISSED — NO_TRADE with activation record but no error
                and_(
                    GridEntry.status == GridStatus.NO_TRADE,
                    AlgoState.status == AlgoRunStatus.NO_TRADE,
                    AlgoState.activated_at.isnot(None),
                    AlgoState.error_message.is_(None),
                ),
            ),
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

        # Fetch legs for this algo
        legs_data = []
        try:
            legs_result = await db.execute(
                select(AlgoLeg)
                .where(AlgoLeg.algo_id == a.id)
                .order_by(AlgoLeg.leg_number)
            )
            for leg in legs_result.scalars().all():
                legs_data.append({
                    "leg_number":  leg.leg_number,
                    "direction":   leg.direction,
                    "instrument":  leg.instrument,
                    "underlying":  leg.underlying,
                    "lots":        leg.lots,
                    "strike_type": leg.strike_type,
                    "wt_enabled":  leg.wt_enabled,
                    "wt_value":    leg.wt_value,
                    "wt_unit":     leg.wt_unit,
                    "wt_direction": leg.wt_direction,
                })
        except Exception as _le:
            logger.warning(f"[waiting] legs fetch failed for algo {a.id}: {_le}")

        # Enrich W&T legs with live ref_price / threshold from WTEvaluator in-memory state
        _wt_ev = None  # initialise here so display_status block can reference it safely
        try:
            from app.engine.algo_runner import algo_runner as _ar_wt
            _wt_ev = getattr(_ar_wt, '_wt_evaluator', None)
            if _wt_ev:
                _window = _wt_ev._windows.get(str(ge.id))
                if _window and _window.is_ref_set:
                    for _ld in legs_data:
                        if _ld.get("wt_enabled"):
                            _ld["wt_ref_price"] = round(_window.reference_price, 0)
                            _ld["wt_threshold"] = round(_window.threshold, 0)
        except Exception as _wte:
            logger.debug(f"[waiting] wt_evaluator enrich skipped: {_wte}")

        _is_missed = (
            _state.status == AlgoRunStatus.NO_TRADE
            and _state.activated_at is not None
            and not _state.error_message
        )

        # Check if any non-error orders have been placed for this grid entry
        _has_placed_orders = False
        try:
            _placed_r = await db.execute(
                select(Order.id).where(
                    Order.grid_entry_id == ge.id,
                    Order.status != OrderStatus.ERROR,
                ).limit(1)
            )
            _has_placed_orders = _placed_r.scalar_one_or_none() is not None
        except Exception:
            pass

        # Compute display_status — more precise than algo_state_status for UI display
        from datetime import time as _time_type
        now_ist = datetime.now(ZoneInfo("Asia/Kolkata"))
        now_time = now_ist.time()

        def _parse_time(t_str):
            if not t_str:
                return None
            try:
                parts = t_str.split(':')
                if len(parts) == 2:
                    return _time_type(int(parts[0]), int(parts[1]))
                elif len(parts) == 3:
                    return _time_type(int(parts[0]), int(parts[1]), int(parts[2]))
            except Exception:
                return None
            return None

        entry_time_parsed = _parse_time(a.entry_time)

        # Detect if W&T monitor is armed for this entry
        _wt_monitor_armed = False
        if _wt_ev:
            _window = _wt_ev._windows.get(str(ge.id))
            if _window is not None and getattr(_window, 'is_ref_set', False):
                _wt_monitor_armed = True

        # Detect if this entry was explicitly retried by the user within the last 90s.
        # This suppresses "effectively missed" while the W&T monitor re-arms after RETRY.
        # Unlike WTWindow.registered_at, this is ONLY set by explicit user action —
        # not by SmartStream reconnects / rearm_wt_monitors().
        _just_retried = False
        _ge_id_str = str(ge.id)
        _retry_ts = _retry_timestamps.get(_ge_id_str)
        if _retry_ts is not None:
            try:
                _retry_age = (datetime.now(ZoneInfo("Asia/Kolkata")) - _retry_ts).total_seconds()
                if _retry_age < 90:
                    _just_retried = True
                else:
                    # Expired — clean up
                    _retry_timestamps.pop(_ge_id_str, None)
            except Exception:
                pass

        # Detect ORB active monitoring
        _is_orb_monitoring = False
        _is_orb_missed = False
        if getattr(a, 'entry_type', None) is not None and hasattr(a.entry_type, 'value') and a.entry_type.value == 'orb' and getattr(a, 'orb_end_time', None):
            orb_end_parsed = _parse_time(a.orb_end_time)
            if orb_end_parsed:
                if now_time > orb_end_parsed:
                    _is_orb_missed = True
                elif entry_time_parsed and now_time >= entry_time_parsed:
                    _is_orb_monitoring = True  # within ORB window

        # "Effectively missed": entry time has passed, still WAITING in state machine,
        # no orders placed, and W&T monitor (if any) is stale from a previous run.
        # WTWindow has no creation timestamp, so we use a 10-min grace period:
        # if entry_time + 10min has passed with no fills, the W&T window is stale.
        # Catches BNF-JRN (09:21 entry, 12:30 now), BNF-TF (09:36), BNF-BTST (12:15).
        _entry_mins = entry_time_parsed.hour * 60 + entry_time_parsed.minute if entry_time_parsed else None
        _now_mins   = now_time.hour * 60 + now_time.minute
        _past_grace = (_entry_mins is not None) and ((_now_mins - _entry_mins) > 10)

        if (
            not _is_missed
            and _state.status == AlgoRunStatus.WAITING
            and entry_time_parsed is not None
            and now_time > entry_time_parsed
            and not _has_placed_orders
            and (_past_grace or not _wt_monitor_armed)   # stale W&T or no monitor at all
            and not _is_orb_monitoring
            and not _just_retried                        # user explicitly retried — give W&T time to re-arm
        ):
            _is_missed = True

        # Past date algos can only be MISSED or ERROR — never SCHEDULED or MONITORING
        algo_trading_date = ge.trading_date  # date object from GridEntry
        today_ist_date_for_status = datetime.now(ZoneInfo("Asia/Kolkata")).date()
        is_past_date = algo_trading_date < today_ist_date_for_status

        # Only show MONITORING when algo actually has W&T legs configured.
        # Prevents algos like NF-BTST (wt_enabled=False) from showing MONITORING after retry.
        _has_wt_legs_flag = any(ld.get("wt_enabled") for ld in legs_data)

        # expiry_skip is a deliberate skip, not an engine failure — show SKIPPED not ERROR.
        _is_expiry_skip = bool(_state.error_message and _state.error_message.startswith('expiry_skip'))

        # Priority order (top = highest priority):
        if (_state.error_message and not _is_expiry_skip) or (hasattr(_state, 'status') and str(_state.status).endswith('error')):
            _display_status = "ERROR"
        elif _is_expiry_skip:
            _display_status = "SKIPPED"
        elif _is_missed or _is_orb_missed or is_past_date:
            _display_status = "MISSED"
        elif (_wt_monitor_armed or (_just_retried and _has_wt_legs_flag)) and not is_past_date:
            _display_status = "MONITORING"
        elif _is_orb_monitoring and not is_past_date:
            _display_status = "MONITORING"
        elif entry_time_parsed and now_time < entry_time_parsed and not is_past_date:
            _display_status = "SCHEDULED"
        else:
            _display_status = "WAITING"

        waiting.append({
            "grid_entry_id":      str(ge.id),
            "algo_id":            str(a.id),
            "algo_name":          a.name,
            "account_id":         str(acc.id),
            "account_name":       acc.nickname,
            "entry_time":         a.entry_time,
            "exit_time":          a.exit_time,
            "is_practix":         ge.is_practix,
            "lot_multiplier":     ge.lot_multiplier,
            "phase":              "activated",
            "latest_error":       latest_error,
            "legs":               legs_data,
            "algo_state_status":  _state.status.value,
            "error_message":      (_state.error_message or "")[:200] or None,
            "is_missed":          _is_missed,
            # Override to 'wt' if any leg has wt_enabled — entry_type on Algo is algo-level
            # (direct/orb), while W&T is a leg-level flag. Leg data takes precedence for display.
            "entry_type":         "wt" if any(l.get("wt_enabled") for l in legs_data)
                                  else (a.entry_type.value if a.entry_type else "direct"),
            "orb_end_time":       a.orb_end_time[:5] if a.orb_end_time else None,
            "display_status":     _display_status,
        })

    # Sort combined list by entry_time
    waiting.sort(key=lambda x: x["entry_time"] or "")

    return {
        "trading_date": target_date.isoformat(),
        "waiting":      waiting,
    }


async def _get_ltp_with_fallback(
    token: int,
    exchange: str,
    symbol: str,
    ltp_cache,
    angel_broker,
) -> tuple:
    """
    Returns (ltp: float | None, source: str) for a given instrument token.

    Priority:
      1. Redis (SmartStream tick — real-time, sub-second)
      2. Angel One REST ltpData (fallback for illiquid tokens with no tick stream)
      3. None / "unavailable" if both miss
    """
    # 1. Redis cache (populated by SmartStream ticks — always preferred)
    if ltp_cache and token:
        try:
            redis_val = await ltp_cache.get(token)
            if redis_val is not None:
                return float(redis_val), "smartstream"
        except Exception as e:
            logger.warning(f"[orders/ltp] Redis get failed for token {token}: {e}")

    # 2. Angel One REST API fallback
    if angel_broker and angel_broker.is_token_set() and token:
        try:
            ltp_val = await angel_broker.get_ltp_by_token(
                exchange or "NFO",
                symbol or "",
                str(token),
            )
            if ltp_val:
                return float(ltp_val), "rest"
        except Exception as e:
            logger.warning(f"[orders/ltp] REST LTP fallback failed for {symbol} (token={token}): {e}")

    return None, "unavailable"


@router.post("/subscribe-tokens")
async def subscribe_open_tokens(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Manually subscribe all open order instrument tokens to SmartStream.
    Call this after start-market-feed to ensure open positions receive ticks.
    """
    result = await db.execute(select(Order).where(Order.status == OrderStatus.OPEN))
    open_orders = result.scalars().all()

    ltp_consumer = getattr(request.app.state, "ltp_consumer", None)
    if not ltp_consumer:
        raise HTTPException(status_code=503, detail="ltp_consumer not initialised")

    adapter = getattr(ltp_consumer, "_angel_adapter", None)
    if not adapter:
        raise HTTPException(status_code=503, detail="SmartStream adapter not set — call start-market-feed first")

    tokens = [int(o.instrument_token) for o in open_orders if o.instrument_token]
    if not tokens:
        return {"subscribed": 0, "tokens": [], "detail": "No open orders"}

    # ltp_consumer.subscribe() dedupes against _subscribed_tokens — tokens already tracked
    # by the consumer but never pushed to a fresh adapter won't be re-sent. Force-push
    # directly to the adapter to bypass that dedup.
    token_strs = [str(t) for t in tokens]
    connected = getattr(adapter, "_connected", False)

    # Register BFO tokens FIRST so _build_token_list uses exchangeType=3 when subscribe() fires
    _bfo_toks = [int(o.instrument_token) for o in open_orders if o.instrument_token and (o.exchange or '').upper() in ('BFO', 'BSE') or (o.symbol or '').upper().startswith(('SENSEX', 'BANKEX'))]
    if _bfo_toks:
        ltp_consumer.register_bfo_tokens(_bfo_toks)

    if connected:
        # Clear the adapter's internal set so all tokens are treated as new
        adapter._subscribed = [t for t in getattr(adapter, "_subscribed", []) if t not in token_strs]
        adapter.subscribe(token_strs)
        pushed = "live WebSocket"
    else:
        # Not connected yet — queue them; _on_open will subscribe
        for t in token_strs:
            if t not in adapter._subscribed:
                adapter._subscribed.append(t)
        pushed = "queued for _on_open"

    # Also ensure LTPConsumer tracks them
    ltp_consumer.subscribe(tokens)

    after_adapter = getattr(adapter, "_subscribed", [])
    matched = [t for t in after_adapter if t in token_strs]
    logger.info(f"[subscribe-tokens] {len(tokens)} tokens → adapter ({pushed}), {len(matched)} confirmed in adapter._subscribed")

    return {
        "subscribed": len(tokens),
        "tokens": tokens,
        "adapter_connected": connected,
        "push_method": pushed,
        "tokens_in_adapter": len(matched),
    }


@router.get("/ltp")
async def get_orders_ltp(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Returns live LTP and unrealised P&L for all OPEN orders.
    LTP is read from ltp_cache (Redis) first; falls back to Angel One REST
    ltpData for illiquid tokens (e.g. far OTM options) that receive no ticks.
    Response includes a `source` field: "live" | "rest" | "unavailable".
    """
    from zoneinfo import ZoneInfo
    _IST = ZoneInfo("Asia/Kolkata")

    result = await db.execute(
        select(Order).where(Order.status == OrderStatus.OPEN)
    )
    open_orders = result.scalars().all()

    ltp_cache = getattr(request.app.state, "ltp_cache", None)

    # Ensure open order tokens are subscribed to SmartStream so Redis stays warm.
    # No-op if already subscribed; safe to call on every poll.
    ltp_consumer = getattr(request.app.state, "ltp_consumer", None)
    _tokens: list = []
    if ltp_consumer and open_orders:
        _tokens = [int(o.instrument_token) for o in open_orders if o.instrument_token]
        # Register BFO tokens FIRST so _build_token_list uses exchangeType=3 when subscribe() fires
        _bfo_tokens = [int(o.instrument_token) for o in open_orders if o.instrument_token and (o.exchange or '').upper() in ('BFO', 'BSE') or (o.symbol or '').upper().startswith(('SENSEX', 'BANKEX'))]
        if _bfo_tokens:
            ltp_consumer.register_bfo_tokens(_bfo_tokens)
        if _tokens:
            ltp_consumer.subscribe(_tokens)

    # If SmartStream adapter is not set (e.g. after backend restart without calling
    # start-market-feed), attempt to auto-start the market feed — once every 30s.
    if ltp_consumer and not getattr(ltp_consumer, '_angel_adapter', None):
        import time as _time
        logger.warning("[LTP] SmartStream adapter not set — cannot subscribe tokens")
        _now  = _time.monotonic()
        _last = getattr(request.app.state, '_feed_start_last_attempt', 0.0)
        if _now - _last > 30.0:
            request.app.state._feed_start_last_attempt = _now
            logger.info("[LTP] Attempting auto-start of market feed...")
            try:
                from app.api.v1.system import start_market_feed as _smf
                await _smf(request=request, db=db)
                # Re-register BFO tokens on fresh adapter
                _bfo_restart = [int(o.instrument_token) for o in open_orders if o.instrument_token and (o.exchange or '').upper() in ('BFO', 'BSE') or (o.symbol or '').upper().startswith(('SENSEX', 'BANKEX'))]
                if _bfo_restart:
                    ltp_consumer.register_bfo_tokens(_bfo_restart)
                # Re-subscribe open order tokens now that adapter is attached
                if _tokens:
                    ltp_consumer.subscribe(_tokens)
                logger.info("[LTP] ✅ Market feed auto-started successfully")
            except Exception as _mf_err:
                logger.warning(f"[LTP] Auto-start market feed failed: {_mf_err}")

    # Resolve any logged-in Angel One broker instance from app state
    angel_broker = None
    for _key in ("angelone_karthik", "angelone_wife", "angelone_mom"):
        _b = getattr(request.app.state, _key, None)
        if _b and _b.is_token_set():
            angel_broker = _b
            break

    def _effective_exchange(order) -> str:
        """SENSEX/BANKEX options trade on BFO even if DB stores 'NFO'."""
        sym = (order.symbol or '').upper()
        if sym.startswith(('SENSEX', 'BANKEX')):
            return 'BFO'
        return order.exchange or 'NFO'

    # Fetch all LTPs concurrently — avoids sequential 15s REST timeouts
    import asyncio as _asyncio
    ltp_results = await _asyncio.gather(*[
        _get_ltp_with_fallback(
            token=order.instrument_token,
            exchange=_effective_exchange(order),
            symbol=order.symbol,
            ltp_cache=ltp_cache,
            angel_broker=angel_broker,
        )
        for order in open_orders
    ])

    ltp_map: dict = {}
    for order, (live_ltp, source) in zip(open_orders, ltp_results):
        oid = str(order.id)

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
            "source":     source,
        }

    now_ist = datetime.now(_IST).isoformat()
    return {"ltp": ltp_map, "timestamp": now_ist}


@router.get("/broker-orderbook")
async def broker_orderbook(request: Request):
    """
    Fetch raw Angel One order book for all logged-in accounts.
    Returns normalized list of orders across all active broker instances.
    """
    ACCOUNT_KEYS = [
        ("angelone_karthik", "Karthik"),
        ("angelone_mom",     "Mom"),
        ("angelone_wife",    "Wife"),
    ]
    results = []
    for state_key, label in ACCOUNT_KEYS:
        broker = getattr(request.app.state, state_key, None)
        if broker is None or not broker.is_token_set():
            continue
        try:
            raw = await broker.get_order_book()
        except Exception:
            raw = []
        for o in (raw or []):
            results.append({
                "account":    label,
                "time":       o.get("updatetime") or o.get("exchorderupdatetime") or "",
                "order_id":   o.get("orderid") or o.get("uniqueorderid") or "",
                "symbol":     o.get("tradingsymbol") or o.get("symboltoken") or "",
                "type":       o.get("transactiontype") or "",
                "qty":        o.get("quantity") or o.get("filledshares") or 0,
                "price":      o.get("price") or o.get("averageprice") or 0,
                "status":     (o.get("status") or "").upper(),
                "product":    o.get("producttype") or "",
                "order_type": o.get("ordertype") or "",
            })
    results.sort(key=lambda x: x["time"], reverse=True)
    return {"orders": results, "count": len(results)}


# ── Position reconciliation — MUST be before /{order_id} catch-all ────────────

@router.get("/position-check")
async def position_check(
    is_practix: Optional[bool] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """
    Stub reconciliation check.
    Returns total open orders count and a reconciled flag.
    reconciled=True when total_open==0 (Phase 2 will compare against broker positions).
    """
    conditions = [Order.exit_time == None]  # noqa: E711
    if is_practix is not None:
        conditions.append(Order.is_practix == is_practix)

    result = await db.execute(
        select(Order).where(and_(*conditions))
    )
    open_orders = result.scalars().all()
    total_open = len(open_orders)
    reconciled = total_open == 0
    message = "All positions closed" if reconciled else f"{total_open} open position{'s' if total_open != 1 else ''} found"
    return {
        "total_open": total_open,
        "reconciled": reconciled,
        "message":    message,
    }


@router.get("/week-summary")
async def get_week_summary(
    week_start: Optional[str] = Query(None, description="YYYY-MM-DD Monday of the week, defaults to current week Monday"),
    is_practix: Optional[bool] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns P&L breakdown per trading date for the given week.
    Each date returns: {closed_pnl, open_mtm, total}
      - closed_pnl: sum of realised P&L from closed orders on that date
      - open_mtm:   sum of unrealised MTM for open orders on that date
                    (computed from order.ltp, order.fill_price, order.direction, order.quantity)
      - total:      closed_pnl + open_mtm, or null if no activity on that date
    Used by frontend day pills to colour-code each trading day.
    """
    from datetime import date as _date_type, timedelta
    IST = ZoneInfo("Asia/Kolkata")

    # Resolve week_start — default to Monday of current IST week
    if week_start:
        try:
            _ws = datetime.strptime(week_start, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="week_start must be YYYY-MM-DD")
    else:
        _today = datetime.now(IST).date()
        _dow = _today.weekday()   # 0=Mon, 6=Sun
        _ws = _today - timedelta(days=_dow)

    _we = _ws + timedelta(days=6)  # Sunday of that week

    # Find all GridEntries in this date range
    _ge_result = await db.execute(
        select(GridEntry.id, GridEntry.trading_date).where(
            GridEntry.trading_date >= _ws,
            GridEntry.trading_date <= _we,
        )
    )
    _ge_rows = _ge_result.all()
    _ge_ids = [r[0] for r in _ge_rows]
    _ge_date_map = {str(r[0]): r[1] for r in _ge_rows}  # grid_entry_id → trading_date

    if not _ge_ids:
        # Return null for each weekday — no grid entries means no activity
        result_map = {}
        for _i in range(5):
            result_map[(_ws + timedelta(days=_i)).isoformat()] = None
        return {"week_start": _ws.isoformat(), "mtm_by_date": result_map}

    # Build base filter conditions (shared for both closed and open queries)
    _base_conditions = [Order.grid_entry_id.in_(_ge_ids)]
    if is_practix is not None:
        _base_conditions.append(Order.is_practix == is_practix)

    # ── 1. Fetch all CLOSED orders for these grid entries ────────────────────
    _closed_result = await db.execute(
        select(
            Order.grid_entry_id,
            Order.pnl,
            Order.exit_price,
            Order.fill_price,
            Order.direction,
            Order.quantity,
        ).where(
            and_(*_base_conditions, Order.status == OrderStatus.CLOSED)
        )
    )

    # Aggregate closed_pnl by trading_date; track which dates have closed orders
    _closed_pnl_by_date: dict = {}   # date_str → float
    _has_closed_by_date: dict = {}   # date_str → bool
    for _ge_id, _pnl, _exit_price, _fill_price_c, _direction_c, _quantity_c in _closed_result.all():
        _td = _ge_date_map.get(str(_ge_id))
        if _td:
            _td_str = _td.isoformat()
            _has_closed_by_date[_td_str] = True
            if _pnl is not None:
                _closed_pnl_by_date[_td_str] = _closed_pnl_by_date.get(_td_str, 0.0) + _pnl
            elif _exit_price is not None and _fill_price_c is not None:
                # Manually SQ'd order: pnl not saved but exit_price is set — compute on the fly
                _dir_c = (_direction_c or "").lower()
                _dir_mult = -1 if _dir_c == "sell" else 1
                _computed = (_exit_price - _fill_price_c) * _dir_mult * (_quantity_c or 1)
                _closed_pnl_by_date[_td_str] = _closed_pnl_by_date.get(_td_str, 0.0) + _computed
            # else: truly unknown — skip

    # ── 2. Fetch all OPEN orders for these grid entries ───────────────────────
    _open_result = await db.execute(
        select(
            Order.grid_entry_id,
            Order.direction,
            Order.instrument_token,   # use token for live in-memory LTP lookup
            Order.fill_price,
            Order.quantity,
        ).where(
            and_(*_base_conditions, Order.status == OrderStatus.OPEN)
        )
    )

    # Get live LTP consumer from in-memory algo_runner (ltp is NOT persisted to DB in real-time)
    try:
        from app.engine.algo_runner import algo_runner as _ar_ws
        _ltp_cons = getattr(_ar_ws, '_ltp_consumer', None)
    except Exception:
        _ltp_cons = None

    # Aggregate open_mtm by trading_date; track which dates have open orders
    _open_mtm_by_date: dict = {}     # date_str → float
    _has_open_by_date: dict = {}     # date_str → bool
    for _ge_id, _direction, _token, _fill_price, _quantity in _open_result.all():
        _td = _ge_date_map.get(str(_ge_id))
        if not _td:
            continue
        _td_str = _td.isoformat()
        _has_open_by_date[_td_str] = True

        # Get live LTP from in-memory consumer — get_ltp() returns 0.0 if not in cache
        _live_ltp = None
        if _ltp_cons and _token and _token > 0:
            _raw_ltp = _ltp_cons.get_ltp(int(_token))
            if _raw_ltp and _raw_ltp > 0:
                _live_ltp = _raw_ltp

        # Compute unrealized MTM only when live LTP is available and non-zero
        if _live_ltp and _fill_price and _quantity:
            _dir = (_direction or "").lower()
            if _dir == "sell":
                _mtm = (_fill_price - _live_ltp) * _quantity
            else:
                _mtm = (_live_ltp - _fill_price) * _quantity
            _open_mtm_by_date[_td_str] = _open_mtm_by_date.get(_td_str, 0.0) + _mtm
        # If live LTP unavailable — skip this order (do NOT count as 0)

    # ── 3. Build result map for Mon–Fri ──────────────────────────────────────
    result_map = {}
    for _i in range(5):
        _d = (_ws + timedelta(days=_i)).isoformat()

        _has_closed  = _has_closed_by_date.get(_d, False)
        _has_open    = _has_open_by_date.get(_d, False)
        _closed_pnl  = round(_closed_pnl_by_date.get(_d, 0.0), 2)
        _open_mtm    = round(_open_mtm_by_date.get(_d, 0.0), 2)

        # Null sentinel: no activity at all on this date
        if not _has_closed and not _has_open:
            result_map[_d] = None
            continue

        # Has some trades — compute total
        if _closed_pnl == 0.0 and _open_mtm == 0.0:
            _total = 0.0   # trades exist but all P&L is exactly zero
        else:
            _total = round(_closed_pnl + _open_mtm, 2)

        result_map[_d] = {
            "closed_pnl": _closed_pnl,
            "open_mtm":   _open_mtm,
            "total":      _total,
        }

    return {"week_start": _ws.isoformat(), "mtm_by_date": result_map}


async def _run_reconcile_internal(db: AsyncSession, app_state=None) -> dict:
    """
    Core reconcile logic — compare open STAAX orders against broker order books.
    Updates reconcile_status in DB for mismatches found.
    Returns {"checked": N, "mismatches": [...]} dict.
    Can be called from the REST endpoint (has app_state) or from the background loop (no app_state).
    """
    from app.models.account import Account, BrokerType
    from app.core.config import settings as _cfg

    # 1. Fetch all open orders with a broker_order_id set
    open_result = await db.execute(
        select(Order).where(
            Order.status == OrderStatus.OPEN,
            Order.broker_order_id != None,  # noqa: E711
        )
    )
    open_orders = open_result.scalars().all()

    if not open_orders:
        return {"checked": 0, "mismatches": []}

    # 2. Group by account_id
    from collections import defaultdict
    by_account: dict = defaultdict(list)
    for o in open_orders:
        by_account[str(o.account_id)].append(o)

    # 3. For each account fetch broker order book and match
    mismatches = []
    total_checked = 0

    # Build client_id → broker_key mapping once
    _CLIENT_ID_TO_BROKER_KEY = {k: v for k, v in [
        (_cfg.ANGELONE_MOM_CLIENT_ID,     "angelone_mom"),
        (_cfg.ANGELONE_WIFE_CLIENT_ID,    "angelone_wife"),
        (_cfg.ANGELONE_KARTHIK_CLIENT_ID, "angelone_karthik"),
    ] if k}

    for account_id, orders_for_acct in by_account.items():
        # Fetch account to determine broker type
        acc_result = await db.execute(select(Account).where(Account.id == account_id))
        account = acc_result.scalar_one_or_none()
        if not account:
            continue

        # Resolve broker instance from app_state (None when called from background loop without request)
        broker = None
        if app_state is not None:
            if account.broker == BrokerType.ZERODHA:
                broker = getattr(app_state, "zerodha", None)
            elif account.broker == BrokerType.ANGELONE:
                broker_key = _CLIENT_ID_TO_BROKER_KEY.get(account.client_id)
                if broker_key:
                    broker = getattr(app_state, broker_key, None)
        else:
            # Background loop: try to import app and get state
            try:
                from main import app as _main_app
                if account.broker == BrokerType.ZERODHA:
                    broker = getattr(_main_app.state, "zerodha", None)
                elif account.broker == BrokerType.ANGELONE:
                    broker_key = _CLIENT_ID_TO_BROKER_KEY.get(account.client_id)
                    if broker_key:
                        broker = getattr(_main_app.state, broker_key, None)
            except Exception:
                pass

        if not broker:
            logger.debug(f"[RECONCILE] Broker not connected for account {account_id}, skipping")
            continue

        # Fetch broker order book
        try:
            broker_book = await broker.get_order_book()
        except Exception as e:
            logger.warning(f"[RECONCILE] Failed to fetch order book for account {account_id}: {e}")
            continue

        if not broker_book:
            broker_book = []

        # Build lookup: broker_order_id → broker order dict
        broker_map: dict = {}
        for b_order in broker_book:
            bid = b_order.get("order_id") or b_order.get("orderid") or b_order.get("norenordno")
            if bid:
                broker_map[str(bid)] = b_order

        # Match each open STAAX order
        for staax_order in orders_for_acct:
            total_checked += 1
            bid = str(staax_order.broker_order_id)
            b_order = broker_map.get(bid)

            if b_order is None:
                # Not found in broker book — might be too old, skip
                continue

            broker_status = (b_order.get("status") or "").upper()
            broker_fill = float(b_order.get("fill_price") or b_order.get("averageprice") or b_order.get("average_price") or 0)
            staax_fill = float(staax_order.fill_price or 0)

            mismatch_type = None
            detail = None

            if broker_status in ("COMPLETE", "CANCELLED", "REJECTED"):
                mismatch_type = "mismatch"
                detail = f"STAAX=open but broker={broker_status}"
            elif broker_fill > 0 and staax_fill > 0 and abs(broker_fill - staax_fill) > 0.5:
                mismatch_type = "price_mismatch"
                detail = f"STAAX fill={staax_fill} broker fill={broker_fill}"

            if mismatch_type:
                staax_order.reconcile_status = mismatch_type
                mismatches.append({
                    "order_id": str(staax_order.id),
                    "broker_order_id": bid,
                    "type": mismatch_type,
                    "detail": detail,
                })
            else:
                # Matches — clear any previous reconcile_status flag
                staax_order.reconcile_status = None

    await db.commit()
    return {"checked": total_checked, "mismatches": mismatches}


@router.get("/reconcile")
async def reconcile_orders(
    request: Request,
    is_practix: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    """Compare open STAAX orders against broker order book. Updates reconcile_status."""
    try:
        result = await _run_reconcile_internal(db, app_state=request.app.state)
        return result
    except Exception as e:
        logger.warning(f"[RECONCILE] Endpoint error: {e}")
        return {"checked": 0, "mismatches": [], "error": str(e)}


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
        # client_id → state key avoids hardcoding nicknames across the codebase
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

    # Log to System Log
    try:
        from app.engine import event_logger as _ev_r
        _sync_algo_result = await db.execute(select(Algo).where(Algo.id == algo_id))
        _sync_algo = _sync_algo_result.scalar_one_or_none()
        _sync_name = _sync_algo.name if _sync_algo else algo_id
        await _ev_r.info(
            f"[SYNC] {_sync_name} — orders synced with broker",
            algo_name=_sync_name, source="orders_api",
        )
    except Exception as e:
        logger.warning(f"[SYNC] Event log failed: {e}")

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
            # BUG4: compute pnl on manual PRACTIX SQ
            if order.fill_price and exit_price:
                order.pnl = (exit_price - order.fill_price) * (order.quantity or 1) if order.direction == "buy" else (order.fill_price - exit_price) * (order.quantity or 1)
            else:
                order.pnl = None

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
                # Use LTP at exit time for pnl (broker fills at market; LTP is best approximation)
                exit_price = order.fill_price  # fallback
                if ltp_cache and order.instrument_token:
                    try:
                        ltp_val = await ltp_cache.get(order.instrument_token)
                        if ltp_val is not None:
                            exit_price = ltp_val
                    except Exception as _ltp_e:
                        logger.warning(f"[SQ] ltp_cache.get failed for LIVE order {order.instrument_token}: {_ltp_e}")

                order.status      = OrderStatus.CLOSED
                order.exit_price  = exit_price
                order.exit_reason = ExitReason.SQ
                order.exit_time   = now
                # Compute pnl: (exit - fill) * qty for buy; (fill - exit) * qty for sell
                if order.fill_price and exit_price:
                    order.pnl = (exit_price - order.fill_price) * (order.quantity or 1) if order.direction == "buy" else (order.fill_price - exit_price) * (order.quantity or 1)
                else:
                    order.pnl = None

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

    # Log to System Log
    try:
        from app.engine import event_logger as _ev_r
        algo_result = await db.execute(select(Algo).where(Algo.id == algo_id))
        _sq_algo = algo_result.scalar_one_or_none()
        _sq_name = _sq_algo.name if _sq_algo else algo_id
        await _ev_r.info(
            f"[SQ] {_sq_name} — manually squared off",
            algo_name=_sq_name, source="orders_api",
        )
    except Exception as e:
        logger.warning(f"[SQ] Event log failed: {e}")

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


# ── Retry entry (manual re-trigger for WAITING/NO_TRADE algos) ───────────────

@router.post("/{grid_entry_id}/retry")
async def retry_entry(
    grid_entry_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Manually re-trigger entry for a WAITING or NO_TRADE grid entry.
    Resets grid_entry → ALGO_ACTIVE and algo_state → WAITING, then fires algo_runner.enter().
    Blocked for ORB algos when the ORB window has already closed.
    """
    from app.engine import event_logger as _ev_r
    from datetime import datetime, timezone, timedelta
    from zoneinfo import ZoneInfo

    IST = ZoneInfo("Asia/Kolkata")

    try:
        ge_uuid = _uuid.UUID(grid_entry_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid grid_entry_id")

    # Fetch GridEntry + Algo
    result = await db.execute(
        select(GridEntry, Algo)
        .join(Algo, GridEntry.algo_id == Algo.id)
        .where(GridEntry.id == ge_uuid)
    )
    row = result.one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Grid entry not found")
    grid_entry, algo = row

    # ORB window check
    if getattr(algo, "entry_type", None) == "orb":
        now_ist = datetime.now(IST)
        orb_end_str = algo.orb_end_time or "11:16"
        h_end, m_end = map(int, orb_end_str.split(":")[:2])
        orb_end_dt = now_ist.replace(hour=h_end, minute=m_end, second=0, microsecond=0)
        if now_ist > orb_end_dt:
            return {"error": "ORB_WINDOW_PASSED", "message": f"ORB window has closed (ended {orb_end_str})"}

    # Fetch AlgoState
    state_result = await db.execute(
        select(AlgoState).where(AlgoState.grid_entry_id == ge_uuid)
    )
    algo_state = state_result.scalar_one_or_none()

    # Reset states
    grid_entry.status = GridStatus.ALGO_ACTIVE
    if algo_state:
        algo_state.status = AlgoRunStatus.WAITING
        algo_state.closed_at = None
    await db.commit()

    # Mark existing error orders as superseded — prevents duplicate rows in SX-WIDE after RETRY
    await db.execute(
        update(Order)
        .where(Order.grid_entry_id == ge.id, Order.status == OrderStatus.ERROR)
        .values(status=OrderStatus.CANCELLED, exit_reason=ExitReason.SUPERSEDED_BY_RETRY)
    )
    await db.commit()

    # Record explicit retry timestamp — used by /waiting to suppress effectively-missed
    # for W&T algos for a short grace window while the W&T monitor re-arms.
    # Unlike registered_at on WTWindow, this is only set by user action, not SmartStream re-arm.
    _retry_timestamps[grid_entry_id] = datetime.now(IST)

    # Log the manual retry
    await _ev_r.info(
        f"[RETRY] {algo.name} manually retried by user",
        algo_name=algo.name,
        algo_id=str(algo.id),
        source="orders_api",
    )

    _scheduler = getattr(request.app.state, "scheduler", None)

    # Cancel any existing expiry job — prevents a stale expiry from marking NO_TRADE
    # while enter() is in flight or if entry succeeds on retry.
    if _scheduler:
        _expiry_job = _scheduler._scheduler.get_job(f"entry_expiry_{grid_entry_id}")
        if _expiry_job:
            _expiry_job.remove()
            logger.info(f"[RETRY] Removed stale expiry job for {grid_entry_id}")

    # Determine if any legs are W&T — if so, do NOT force_direct.
    # force_direct=True skips W&T logic entirely; W&T algos must go through
    # _place_leg()'s W&T branch so they capture ref_price and arm the monitor.
    # force_immediate=True always bypasses the entry_time gate (window already past).
    _legs_result = await db.execute(select(AlgoLeg).where(AlgoLeg.algo_id == algo.id))
    _algo_legs   = _legs_result.scalars().all()
    _has_wt_legs = any(getattr(_l, 'wt_enabled', False) for _l in _algo_legs)
    _force_direct = not _has_wt_legs  # False for W&T algos → W&T logic runs on retry

    # Schedule enter() via APScheduler's AsyncIOExecutor — fires in 2 seconds.
    # This is the ONLY way to get proper SQLAlchemy greenlet context outside of
    # the scheduler's own job runners. Direct await / ensure_future / run_coroutine_threadsafe
    # all fail because they run outside the greenlet bridge that AsyncIOExecutor provides.
    if _scheduler:
        from datetime import timedelta
        from apscheduler.triggers.date import DateTrigger
        from app.engine.algo_runner import algo_runner as _algo_runner
        # Idempotency: if a retry job is already pending, don't schedule another.
        # Prevents double-placement when user clicks RETRY twice in quick succession.
        _retry_job_id = f"retry_{grid_entry_id}"
        if _scheduler._scheduler.get_job(_retry_job_id):
            logger.warning(f"[RETRY] Job already pending for {grid_entry_id} — ignoring duplicate click")
            return {"status": "already_scheduled", "algo_name": algo.name, "grid_entry_id": grid_entry_id}
        _run_at = datetime.now(IST) + timedelta(seconds=2)
        _scheduler._scheduler.add_job(
            _algo_runner.enter,
            DateTrigger(run_date=_run_at, timezone=IST),
            kwargs={"grid_entry_id": grid_entry_id, "force_direct": _force_direct, "force_immediate": True},
            id=_retry_job_id,
            replace_existing=False,
        )
        logger.info(
            f"[RETRY] Scheduled enter() via APScheduler in 2s for {grid_entry_id} "
            f"(force_direct={_force_direct}, has_wt_legs={_has_wt_legs})"
        )
    else:
        logger.error(f"[RETRY] Scheduler not available — cannot schedule retry for {grid_entry_id}")

    return {"status": "ok", "algo_name": algo.name, "grid_entry_id": grid_entry_id}


# ── Retry specific errored legs (partial re-entry) ────────────────────────────

@router.post("/{grid_entry_id}/retry-legs")
async def retry_specific_legs(
    grid_entry_id: str,
    body: RetryLegsRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Re-place only the specified errored legs for a grid entry where some legs succeeded.
    leg_ids: list of AlgoLeg UUIDs (order.leg_id values that are in error state).
    Returns 400 if any leg_id is not in error state.
    """
    try:
        ge_uuid = _uuid.UUID(grid_entry_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid grid_entry_id")

    if not body.leg_ids:
        raise HTTPException(status_code=400, detail="leg_ids must not be empty")

    # Validate all specified legs are in error state
    try:
        leg_uuids = [_uuid.UUID(lid) for lid in body.leg_ids]
    except (ValueError, AttributeError):
        raise HTTPException(status_code=400, detail="Invalid leg_id in list")

    error_orders = await db.execute(
        select(Order)
        .where(
            Order.grid_entry_id == ge_uuid,
            Order.leg_id.in_(leg_uuids),
        )
    )
    orders_found = error_orders.scalars().all()

    non_error = [o for o in orders_found if o.status != OrderStatus.ERROR]
    if non_error:
        raise HTTPException(
            status_code=400,
            detail=f"Legs not in error state: {[str(o.leg_id) for o in non_error]}",
        )

    # Load grid entry + algo state
    ge_result = await db.execute(
        select(GridEntry, Algo)
        .join(Algo, GridEntry.algo_id == Algo.id)
        .where(GridEntry.id == ge_uuid)
    )
    ge_row = ge_result.one_or_none()
    if not ge_row:
        raise HTTPException(status_code=404, detail="Grid entry not found")
    grid_entry, algo = ge_row

    state_result = await db.execute(select(AlgoState).where(AlgoState.grid_entry_id == ge_uuid))
    algo_state = state_result.scalar_one_or_none()

    # Reset algo state to ACTIVE (not WAITING — other legs already filled)
    if algo_state:
        algo_state.status = AlgoRunStatus.ACTIVE
        algo_state.error_message = None
    grid_entry.status = GridStatus.OPEN
    await db.commit()

    # Fire enter_specific_legs via APScheduler — the ONLY greenlet-safe path.
    # run_coroutine_threadsafe() and ensure_future() lack SQLAlchemy's greenlet bridge
    # and cause MissingGreenlet. APScheduler's AsyncIOExecutor provides it automatically.
    algo_runner = getattr(request.app.state, "algo_runner", None)
    _scheduler  = getattr(request.app.state, "scheduler", None)
    if _scheduler and algo_runner:
        from apscheduler.triggers.date import DateTrigger as _DateTriggerRL
        leg_id_strs = [str(lid) for lid in leg_uuids]
        _rl_job_id  = f"retry_legs_{grid_entry_id}"
        _scheduler._scheduler.add_job(
            algo_runner.enter_specific_legs,
            _DateTriggerRL(
                run_date=datetime.now(ZoneInfo("Asia/Kolkata")) + timedelta(seconds=2),
                timezone=ZoneInfo("Asia/Kolkata"),
            ),
            args=[grid_entry_id, leg_id_strs],
            id=_rl_job_id,
            replace_existing=True,
            misfire_grace_time=60,
        )
        logger.info(
            f"[RETRY-LEGS] Scheduled enter_specific_legs via APScheduler for {grid_entry_id} "
            f"({len(leg_uuids)} legs)"
        )
    else:
        logger.error(
            f"[RETRY-LEGS] Scheduler or algo_runner not available — "
            f"cannot safely schedule retry-legs for {grid_entry_id}"
        )

    return {"status": "queued", "algo_name": algo.name, "leg_count": len(leg_uuids)}


# ── Retry SL endpoint ─────────────────────────────────────────────────────────

@router.post("/{order_id}/retry-sl")
async def retry_sl_order(order_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    """
    Re-place SL exit order when sl_order_status == 'rejected'.
    Requires the order to still be open (should not be called on closed positions).
    """
    import uuid as _uuid_mod
    try:
        _oid = _uuid_mod.UUID(order_id)
    except ValueError:
        raise HTTPException(400, "Invalid order_id format")

    result = await db.execute(select(Order).where(Order.id == _oid))
    order = result.scalar_one_or_none()
    if not order:
        raise HTTPException(404, "Order not found")

    sl_status = getattr(order, "sl_order_status", None)
    if sl_status != "rejected":
        raise HTTPException(400, f"Cannot retry SL — current sl_order_status: {sl_status!r}")

    try:
        # Re-place exit via ExecutionManager (single control point for all broker calls)
        from app.engine.execution_manager import execution_manager as _em
        from app.models.account import Account, BrokerType
        from app.engine.algo_runner import algo_runner as _ar

        # Resolve broker type for this order's account
        _broker_type = "zerodha"
        _acc_res = await db.execute(select(Account).where(Account.id == order.account_id))
        _acc = _acc_res.scalar_one_or_none()
        if _acc and _acc.broker == BrokerType.ANGELONE:
            _broker_type = "angelone"

        # Get current LTP as exit price
        _ltp = 0.0
        if _ar._ltp_consumer and order.instrument_token:
            _ltp = _ar._ltp_consumer.get_ltp(int(order.instrument_token))
        if not _ltp and order.ltp:
            _ltp = float(order.ltp)
        if not _ltp and order.sl_actual:
            _ltp = float(order.sl_actual)
        if not _ltp:
            raise HTTPException(400, "Cannot retry SL — no current LTP available")

        broker_resp = await _em.square_off(
            db              = db,
            idempotency_key = f"retry-sl:{order.id}",
            algo_id         = str(order.algo_id),
            account_id      = str(order.account_id),
            symbol          = order.symbol,
            exchange        = order.exchange or "NFO",
            direction       = order.direction,
            quantity        = order.quantity,
            algo_tag        = order.algo_tag or "",
            is_practix      = order.is_practix,
            broker_type     = _broker_type,
            symbol_token    = str(order.instrument_token or ""),
        )

        order.sl_order_status = "placed"
        order.sl_warning      = None
        await db.commit()

        return {"status": "ok", "sl_order_status": "placed"}

    except HTTPException:
        raise
    except Exception as e:
        try:
            order.sl_warning = f"Retry failed: {str(e)[:100]}"
            await db.commit()
        except Exception:
            pass
        raise HTTPException(500, str(e))


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
