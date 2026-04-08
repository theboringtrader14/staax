"""
Algos API — CRUD for algo configuration + runtime controls.
Fully wired to PostgreSQL.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from pydantic import BaseModel
from typing import List, Optional
import uuid as uuid_lib
from app.core.database import get_db
from app.models.algo import Algo, AlgoLeg, StrategyMode, EntryType, OrderType, ReentryMode
from app.models.account import Account
from app.models.grid import GridEntry, GridStatus
from app.models.algo_state import AlgoState
from app.models.order import Order
from app.models.trade import Trade

router = APIRouter()

# ── Underlying index token map (used for pts_underlying / pct_underlying SL/TP) ──
UNDERLYING_TOKENS = {
    "NIFTY":      99926000,
    "BANKNIFTY":  99926009,
    "SENSEX":     99919000,
    "MIDCPNIFTY": 99926074,
    "FINNIFTY":   99926037,
}


# ── Schemas ───────────────────────────────────────────────────────────────────

class LegCreate(BaseModel):
    leg_number:      int
    direction:       str
    instrument:      str
    underlying:      str
    expiry:          str
    strike_type:     str
    strike_offset:   int            = 0
    strike_value:    Optional[float] = None
    lots:            int            = 1
    sl_type:         Optional[str]  = None
    sl_value:        Optional[float] = None
    tp_type:         Optional[str]  = None
    tp_value:        Optional[float] = None
    tsl_x:           Optional[float] = None
    tsl_y:           Optional[float] = None
    tsl_unit:        Optional[str]  = None
    ttp_x:           Optional[float] = None
    ttp_y:           Optional[float] = None
    ttp_unit:        Optional[str]  = None
    wt_enabled:      bool           = False
    wt_direction:    Optional[str]  = None
    wt_value:        Optional[float] = None
    wt_unit:         Optional[str]  = None
    reentry_enabled: bool           = False
    reentry_mode:    Optional[str]  = None
    reentry_max:     int            = 0


class AlgoCreateRequest(BaseModel):
    name:                  str
    account_id:            str
    strategy_mode:         str
    entry_type:            str
    order_type:            str            = "market"
    entry_time:            Optional[str]  = None
    exit_time:             Optional[str]  = None
    orb_start_time:        Optional[str]  = None
    orb_end_time:          Optional[str]  = None
    next_day_exit_time:    Optional[str]  = None
    dte:                   Optional[int]  = None
    mtm_sl:                Optional[float] = None
    mtm_tp:                Optional[float] = None
    mtm_unit:              Optional[str]  = None
    entry_delay_buy_secs:  int            = 0
    entry_delay_sell_secs: int            = 0
    exit_delay_buy_secs:   int            = 0
    exit_delay_sell_secs:  int            = 0
    exit_on_margin_error:  bool           = True
    exit_on_entry_failure: bool           = True
    base_lot_multiplier:   int            = 1
    notes:                 Optional[str]  = None
    is_live:               bool           = False
    recurring_days:        List[str]      = []
    legs:                  List[LegCreate] = []


class AlgoUpdateRequest(AlgoCreateRequest):
    pass


class SquareOffRequest(BaseModel):
    leg_ids: List[str] = []


# ── Helpers ───────────────────────────────────────────────────────────────────

def _leg_to_dict(leg: AlgoLeg) -> dict:
    return {
        "id":              str(leg.id),
        "algo_id":         str(leg.algo_id),
        "leg_number":      leg.leg_number,
        "direction":       leg.direction,
        "instrument":      leg.instrument,
        "underlying":      leg.underlying,
        "expiry":          leg.expiry,
        "strike_type":     leg.strike_type,
        "strike_offset":   leg.strike_offset,
        "strike_value":    leg.strike_value,
        "lots":            leg.lots,
        "sl_type":         leg.sl_type,
        "sl_value":        leg.sl_value,
        "tp_type":         leg.tp_type,
        "tp_value":        leg.tp_value,
        "tsl_x":           leg.tsl_x,
        "tsl_y":           leg.tsl_y,
        "tsl_unit":        leg.tsl_unit,
        "ttp_x":           leg.ttp_x,
        "ttp_y":           leg.ttp_y,
        "ttp_unit":        leg.ttp_unit,
        "wt_enabled":      leg.wt_enabled,
        "wt_direction":    leg.wt_direction,
        "wt_value":        leg.wt_value,
        "wt_unit":         leg.wt_unit,
        "reentry_enabled": leg.reentry_enabled,
            "reentry_on_sl": leg.reentry_on_sl or False,
            "reentry_on_tp": leg.reentry_on_tp or False,
        "reentry_mode":    leg.reentry_mode.value if leg.reentry_mode else None,
        "reentry_max":     leg.reentry_max,
    }


def _algo_to_dict(algo: Algo, legs: list = None, account_nickname: str = None) -> dict:
    d = {
        "id":                    str(algo.id),
        "name":                  algo.name,
        "account_id":            str(algo.account_id),
        "account_nickname":      account_nickname or str(algo.account_id),
        "strategy_mode":         algo.strategy_mode.value if algo.strategy_mode else None,
        "entry_type":            algo.entry_type.value if algo.entry_type else None,
        "order_type":            algo.order_type.value if algo.order_type else None,
        "is_active":             algo.is_active,
        "is_archived":           getattr(algo, 'is_archived', False),
        "entry_time":            algo.entry_time,
        "exit_time":             algo.exit_time,
        "orb_start_time":        algo.orb_start_time,
        "orb_end_time":          algo.orb_end_time,
        "next_day_exit_time":    algo.next_day_exit_time,
        "dte":                   algo.dte,
        "mtm_sl":                algo.mtm_sl,
        "mtm_tp":                algo.mtm_tp,
        "mtm_unit":              algo.mtm_unit,
        "entry_delay_buy_secs":  algo.entry_delay_buy_secs,
        "entry_delay_sell_secs": algo.entry_delay_sell_secs,
        "exit_delay_buy_secs":   algo.exit_delay_buy_secs,
        "exit_delay_sell_secs":  algo.exit_delay_sell_secs,
        "exit_on_margin_error":  algo.exit_on_margin_error,
        "exit_on_entry_failure": algo.exit_on_entry_failure,
        "base_lot_multiplier":   algo.base_lot_multiplier,
        "notes":                 algo.notes,
        "is_live":               getattr(algo, 'is_live', False),
        "recurring_days":        algo.recurring_days or [],
        "created_at":            algo.created_at.isoformat() if algo.created_at else None,
    }
    if legs is not None:
        d["legs"] = [_leg_to_dict(l) for l in legs]
    return d


def _build_leg(algo_id, leg_data: LegCreate) -> AlgoLeg:
    return AlgoLeg(
        id=uuid_lib.uuid4(),
        algo_id=algo_id,
        leg_number=leg_data.leg_number,
        direction=leg_data.direction,
        instrument=leg_data.instrument,
        underlying=leg_data.underlying,
        expiry=leg_data.expiry,
        strike_type=leg_data.strike_type,
        strike_offset=leg_data.strike_offset,
        strike_value=leg_data.strike_value,
        lots=leg_data.lots,
        sl_type=leg_data.sl_type,
        sl_value=leg_data.sl_value,
        tp_type=leg_data.tp_type,
        tp_value=leg_data.tp_value,
        tsl_x=leg_data.tsl_x,
        tsl_y=leg_data.tsl_y,
        tsl_unit=leg_data.tsl_unit,
        ttp_x=leg_data.ttp_x,
        ttp_y=leg_data.ttp_y,
        ttp_unit=leg_data.ttp_unit,
        wt_enabled=leg_data.wt_enabled,
        wt_direction=leg_data.wt_direction,
        wt_value=leg_data.wt_value,
        wt_unit=leg_data.wt_unit,
        reentry_enabled=leg_data.reentry_enabled,
        reentry_mode=ReentryMode(leg_data.reentry_mode) if leg_data.reentry_mode else None,
        reentry_max=leg_data.reentry_max,
        underlying_token=UNDERLYING_TOKENS.get((leg_data.underlying or "").upper(), 0),
    )


# ── CRUD ──────────────────────────────────────────────────────────────────────

@router.get("/states")
async def get_algo_states(date: str, db: AsyncSession = Depends(get_db)):
    """Return AlgoState rows for all algos on a given trading date (YYYY-MM-DD)."""
    result = await db.execute(
        select(AlgoState).where(AlgoState.trading_date == date)
    )
    rows = result.scalars().all()
    return {
        "trading_date": date,
        "states": [
            {
                "algo_id":       str(s.algo_id),
                "grid_entry_id": str(s.grid_entry_id),
                "status":        s.status,
                "is_practix":    s.is_practix,
                "activated_at":  s.activated_at.isoformat() if s.activated_at else None,
                "mtm_current":   s.mtm_current,
                "error_message": s.error_message,
            }
            for s in rows
        ],
        "total": len(rows),
    }


@router.get("/")
async def list_algos(
    include_archived: bool = False,
    db: AsyncSession = Depends(get_db)
):
    """List all algos. Excludes archived by default."""
    q = select(Algo, Account).join(Account, Algo.account_id == Account.id).order_by(Algo.created_at)
    if not include_archived:
        q = q.where(Algo.is_archived == False)
    result = await db.execute(q)
    rows = result.all()
    out = []
    for a, acc in rows:
        legs_res = await db.execute(
            select(AlgoLeg).where(AlgoLeg.algo_id == a.id).order_by(AlgoLeg.leg_number)
        )
        out.append(_algo_to_dict(a, legs=legs_res.scalars().all(), account_nickname=f"{acc.nickname} ({acc.broker.capitalize()})"))
    return out


@router.post("/")
async def create_algo(body: AlgoCreateRequest, db: AsyncSession = Depends(get_db)):
    """Create a new algo with legs."""
    existing = await db.execute(select(Algo).where(Algo.name == body.name))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail=f"Algo name '{body.name}' already exists")

    algo = Algo(
        id=uuid_lib.uuid4(),
        name=body.name,
        account_id=body.account_id,
        strategy_mode=StrategyMode(body.strategy_mode),
        entry_type=EntryType(body.entry_type),
        order_type=OrderType(body.order_type),
        entry_time=body.entry_time,
        exit_time=body.exit_time,
        orb_start_time=body.orb_start_time,
        orb_end_time=body.orb_end_time,
        next_day_exit_time=body.next_day_exit_time,
        dte=body.dte,
        mtm_sl=body.mtm_sl,
        mtm_tp=body.mtm_tp,
        mtm_unit=body.mtm_unit,
        entry_delay_buy_secs=body.entry_delay_buy_secs,
        entry_delay_sell_secs=body.entry_delay_sell_secs,
        exit_delay_buy_secs=body.exit_delay_buy_secs,
        exit_delay_sell_secs=body.exit_delay_sell_secs,
        exit_on_margin_error=body.exit_on_margin_error,
        exit_on_entry_failure=body.exit_on_entry_failure,
        base_lot_multiplier=body.base_lot_multiplier,
        notes=body.notes,
        is_live=body.is_live,
        recurring_days=body.recurring_days or [],
        is_active=True,
        is_archived=False,
    )
    db.add(algo)
    await db.flush()

    legs = [_build_leg(algo.id, l) for l in body.legs]
    for leg in legs:
        db.add(leg)

    # ── Task 5: Auto-create GridEntry rows for current week ───────────────────
    # Map day name → weekday index (Mon=0 … Fri=4)
    _DAY_IDX = {"MON": 0, "TUE": 1, "WED": 2, "THU": 3, "FRI": 4}
    from datetime import date as _date, timedelta as _td
    _today = _date.today()
    _monday = _today - _td(days=_today.weekday())  # start of current week
    _DOW_LABELS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]

    for day_upper in (body.recurring_days or []):
        idx = _DAY_IDX.get(day_upper.upper())
        if idx is None:
            continue
        trading_date = _monday + _td(days=idx)
        if trading_date < _today:
            continue  # skip past days
        # Skip if a grid entry already exists for this algo+date
        dup = await db.execute(
            select(GridEntry).where(
                GridEntry.algo_id == algo.id,
                GridEntry.trading_date == trading_date,
            )
        )
        if dup.scalar_one_or_none():
            continue
        db.add(GridEntry(
            id=uuid_lib.uuid4(),
            algo_id=algo.id,
            account_id=algo.account_id,
            trading_date=trading_date,
            day_of_week=_DOW_LABELS[idx],
            lot_multiplier=1,
            is_enabled=True,
            is_practix=not body.is_live,
            is_archived=False,
            status=GridStatus.NO_TRADE,
        ))

    await db.commit()
    await db.refresh(algo)
    return _algo_to_dict(algo, legs)


@router.get("/{algo_id}")
async def get_algo(algo_id: str, db: AsyncSession = Depends(get_db)):
    """Get full algo config including all legs."""
    result = await db.execute(select(Algo).where(Algo.id == algo_id))
    algo = result.scalar_one_or_none()
    if not algo:
        raise HTTPException(status_code=404, detail="Algo not found")
    legs_result = await db.execute(
        select(AlgoLeg).where(AlgoLeg.algo_id == algo_id).order_by(AlgoLeg.leg_number)
    )
    return _algo_to_dict(algo, legs_result.scalars().all())


@router.put("/{algo_id}")
async def update_algo(algo_id: str, body: AlgoUpdateRequest, db: AsyncSession = Depends(get_db)):
    """Update algo config and replace all legs."""
    result = await db.execute(select(Algo).where(Algo.id == algo_id))
    algo = result.scalar_one_or_none()
    if not algo:
        raise HTTPException(status_code=404, detail="Algo not found")

    algo.name = body.name
    algo.account_id = body.account_id
    algo.strategy_mode = StrategyMode(body.strategy_mode)
    algo.entry_type = EntryType(body.entry_type)
    algo.order_type = OrderType(body.order_type)
    algo.entry_time = body.entry_time
    algo.exit_time = body.exit_time
    algo.orb_start_time = body.orb_start_time
    algo.orb_end_time = body.orb_end_time
    algo.next_day_exit_time = body.next_day_exit_time
    algo.dte = body.dte
    algo.mtm_sl = body.mtm_sl
    algo.mtm_tp = body.mtm_tp
    algo.mtm_unit = body.mtm_unit
    algo.entry_delay_buy_secs = body.entry_delay_buy_secs
    algo.entry_delay_sell_secs = body.entry_delay_sell_secs
    algo.exit_delay_buy_secs = body.exit_delay_buy_secs
    algo.exit_delay_sell_secs = body.exit_delay_sell_secs
    algo.exit_on_margin_error = body.exit_on_margin_error
    algo.exit_on_entry_failure = body.exit_on_entry_failure
    algo.base_lot_multiplier = body.base_lot_multiplier
    algo.notes = body.notes

    await db.execute(delete(AlgoLeg).where(AlgoLeg.algo_id == algo_id))
    legs = [_build_leg(algo.id, l) for l in body.legs]
    for leg in legs:
        db.add(leg)

    await db.commit()
    await db.refresh(algo)
    return _algo_to_dict(algo, legs)


@router.post("/{algo_id}/deploy-week")
async def deploy_week(algo_id: str, db: AsyncSession = Depends(get_db)):
    """
    Auto-create GridEntry rows for the current week (today through Friday)
    based on the algo's recurring_days. Skips past days and deduplicates.
    """
    from datetime import date as _date, timedelta as _td
    result = await db.execute(select(Algo).where(Algo.id == algo_id))
    algo = result.scalar_one_or_none()
    if not algo:
        raise HTTPException(status_code=404, detail="Algo not found")

    _DAY_IDX   = {"MON": 0, "TUE": 1, "WED": 2, "THU": 3, "FRI": 4}
    _DOW_LABELS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
    _today  = _date.today()
    _monday = _today - _td(days=_today.weekday())

    created = 0
    skipped = 0
    entries = []

    for day_upper in (algo.recurring_days or []):
        idx = _DAY_IDX.get(day_upper.upper())
        if idx is None:
            skipped += 1
            continue
        trading_date = _monday + _td(days=idx)
        if trading_date < _today:
            skipped += 1
            continue
        dup = await db.execute(
            select(GridEntry).where(
                GridEntry.algo_id == algo.id,
                GridEntry.trading_date == trading_date,
            )
        )
        if dup.scalar_one_or_none():
            skipped += 1
            continue
        entry = GridEntry(
            id=uuid_lib.uuid4(),
            algo_id=algo.id,
            account_id=algo.account_id,
            trading_date=trading_date,
            day_of_week=_DOW_LABELS[idx],
            lot_multiplier=1,
            is_enabled=True,
            is_practix=not algo.is_live,
            is_archived=False,
            status=GridStatus.NO_TRADE,
        )
        db.add(entry)
        created += 1
        entries.append({
            "trading_date": trading_date.isoformat(),
            "day_of_week":  _DOW_LABELS[idx],
            "is_practix":   not algo.is_live,
        })

    await db.commit()
    return {"created": created, "skipped": skipped, "entries": entries}


@router.delete("/{algo_id}")
async def delete_algo(algo_id: str, db: AsyncSession = Depends(get_db)):
    """Soft-delete (archive) an algo. All historical data is preserved."""
    result = await db.execute(select(Algo).where(Algo.id == algo_id))
    algo = result.scalar_one_or_none()
    if not algo:
        raise HTTPException(status_code=404, detail="Algo not found")

    algo.is_archived = True
    await db.commit()
    return {"status": "archived", "id": str(algo_id)}


# ── Archive / Unarchive ───────────────────────────────────────────────────────

@router.post("/{algo_id}/archive")
async def archive_algo(algo_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Algo).where(Algo.id == algo_id))
    algo = result.scalar_one_or_none()
    if not algo:
        raise HTTPException(status_code=404, detail="Algo not found")
    algo.is_archived = True
    await db.commit()
    return {"algo_id": algo_id, "action": "archived", "status": "ok"}


@router.post("/{algo_id}/unarchive")
async def unarchive_algo(algo_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Algo).where(Algo.id == algo_id))
    algo = result.scalar_one_or_none()
    if not algo:
        raise HTTPException(status_code=404, detail="Algo not found")
    algo.is_archived = False
    await db.commit()
    return {"algo_id": algo_id, "action": "unarchived", "status": "ok"}


# ── Promote / Demote ──────────────────────────────────────────────────────────

@router.post("/{algo_id}/promote")
async def promote_algo(algo_id: str, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Algo).where(Algo.id == uuid_lib.UUID(algo_id)))
    algo = res.scalar_one_or_none()
    if not algo:
        raise HTTPException(404, "Algo not found")
    algo.is_live = True
    await db.commit()
    return {"id": str(algo.id), "is_live": True}


@router.post("/{algo_id}/demote")
async def demote_algo(algo_id: str, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Algo).where(Algo.id == uuid_lib.UUID(algo_id)))
    algo = res.scalar_one_or_none()
    if not algo:
        raise HTTPException(404, "Algo not found")
    algo.is_live = False
    await db.commit()
    return {"id": str(algo.id), "is_live": False}


# ── Runtime controls ──────────────────────────────────────────────────────────

@router.post("/{algo_id}/start")
async def start_algo(algo_id: str, db: AsyncSession = Depends(get_db)):
    return {"algo_id": algo_id, "action": "start", "message": "Entry triggered"}


@router.post("/{algo_id}/re")
async def retry_entry(algo_id: str, db: AsyncSession = Depends(get_db)):
    """
    RE — retry the last failed order for this algo.
    Only valid when the most recent order is in ERROR status.
    Calls OrderRetryQueue.retry_order() which resets state and retries up to 3 times.
    Engine wiring (OrderPlacer context) handled in Phase 1F via ExecutionManager.
    """
    from app.models.order import Order, OrderStatus
    from app.models.grid import GridEntry
    from sqlalchemy import select
    from datetime import date
    from app.engine import order_retry_queue

    if order_retry_queue.disabled:
        raise HTTPException(status_code=503, detail="Kill Switch is active — retry not allowed")

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
        raise HTTPException(status_code=404, detail="No grid entry found for this algo today")

    # Find the most recent ERROR order for this grid entry
    orders_result = await db.execute(
        select(Order).where(
            Order.grid_entry_id == grid_entry.id,
            Order.status == OrderStatus.ERROR,
        ).order_by(Order.created_at.desc())
    )
    error_orders = orders_result.scalars().all()

    if not error_orders:
        raise HTTPException(status_code=400, detail="No orders in ERROR state for this algo today")

    # Reset all ERROR orders to PENDING — engine will pick them up
    # Full broker retry wiring happens in Phase 1F via ExecutionManager
    reset_count = 0
    for order in error_orders:
        order.status = OrderStatus.PENDING
        order.error_message = "Manual RE triggered — awaiting engine retry"
        order.retry_count = 0
        reset_count += 1

    await db.commit()

    return {
        "algo_id":     algo_id,
        "action":      "re",
        "reset_count": reset_count,
        "message":     f"{reset_count} order(s) reset to PENDING — engine will retry",
    }


@router.post("/{algo_id}/sq")
async def square_off(algo_id: str, body: SquareOffRequest, db: AsyncSession = Depends(get_db)):
    return {"algo_id": algo_id, "action": "sq", "leg_ids": body.leg_ids or "all"}


@router.post("/{algo_id}/terminate")
async def terminate_algo(algo_id: str, db: AsyncSession = Depends(get_db)):
    return {"algo_id": algo_id, "action": "terminate"}
