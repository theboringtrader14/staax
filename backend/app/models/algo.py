"""
Algo model — stores strategy configuration.
Each algo is created once and deployed to days via GridEntry.

CHANGES vs previous version:
- REMOVED: EntryType.WT and EntryType.ORB_WT  — W&T is per-leg, not an entry type
- REMOVED: wt_type, wt_value, wt_unit on Algo  — W&T is per-leg only
- REMOVED: next_day_sl_check_time              — hardcoded 9:18 AM in scheduler, not configurable
- REMOVED: default_days                         — day assignment is Smart Grid only
- REMOVED: reentry_config (JSON blob)           — re-entry is per-leg (see AlgoLeg)
- ADDED:   dte                                  — Days To Expiry for Positional strategy (1–30)
- ADDED:   wt_direction on AlgoLeg             — "up" or "down"
- ADDED:   wt_value, wt_unit on AlgoLeg        — W&T per leg
- ADDED:   reentry_on_sl, reentry_on_tp, reentry_max on AlgoLeg — re-entry config per leg
"""
from sqlalchemy import Column, String, Float, Boolean, Integer, DateTime, JSON, Enum, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
import uuid
import enum

from app.core.database import Base


class StrategyMode(str, enum.Enum):
    INTRADAY   = "intraday"
    BTST       = "btst"
    STBT       = "stbt"
    POSITIONAL = "positional"


class StrategyType(str, enum.Enum):
    """SEBI algo classification — required for algorithm registration."""
    WHITE_BOX = "white_box"   # rule-based, fully auditable
    BLACK_BOX = "black_box"   # model-based / proprietary


class EntryType(str, enum.Enum):
    """
    Entry type is set at algo level.
    W&T is NOT an entry type — it is a per-leg feature toggle.
    ORB can be combined with per-leg W&T (the W&T buffer refines the ORB breakout level).
    """
    DIRECT = "direct"
    ORB    = "orb"


class OrderType(str, enum.Enum):
    MARKET = "market"
    LIMIT  = "limit"



class Algo(Base):
    __tablename__ = "algos"

    id           = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name         = Column(String(100), unique=True, nullable=False)   # e.g. "AWS-1"
    account_id   = Column(UUID(as_uuid=True), ForeignKey("accounts.id"), nullable=False)
    strategy_mode = Column(Enum(StrategyMode, values_callable=lambda x: [e.value for e in x]), nullable=False)
    entry_type   = Column(Enum(EntryType, values_callable=lambda x: [e.value for e in x]), nullable=False)            # direct or orb only
    order_type   = Column(Enum(OrderType, values_callable=lambda x: [e.value for e in x]), default=OrderType.MARKET)
    is_active    = Column(Boolean, default=True)
    is_archived  = Column(Boolean, default=False)
    is_live      = Column(Boolean, default=False, nullable=False)

    # ── Timing ────────────────────────────────────────────────────────────────
    entry_time      = Column(String(8), nullable=True)    # HH:MM:SS — E: time (all modes)
    exit_time       = Column(String(8), nullable=True)    # HH:MM:SS — intraday SQ time
    orb_start_time  = Column(String(8), nullable=True)    # HH:MM:SS — ORB window open
    orb_end_time    = Column(String(8), nullable=True)    # HH:MM:SS — ORB window close
    next_day_exit_time = Column(String(8), nullable=True) # HH:MM:SS — BTST/STBT next-day exit
    # NOTE: next_day_sl_check_time is NOT stored — hardcoded as entry_time - 2 minutes in scheduler

    # ── Positional ────────────────────────────────────────────────────────────
    dte = Column(Integer, nullable=True)
    # DTE = Days to Expiry before auto-exit. Range 1–30. NULL = exit on expiry day.
    # Only relevant when strategy_mode = 'positional'. Ignored for all other modes.

    # ── MTM controls (algo-level) ─────────────────────────────────────────────
    mtm_sl   = Column(Float, nullable=True)
    mtm_tp   = Column(Float, nullable=True)
    mtm_unit = Column(String(5), nullable=True)    # "amt" or "pct"

    # ── Order delays ──────────────────────────────────────────────────────────
    entry_delay_buy_secs  = Column(Integer, default=0)
    entry_delay_sell_secs = Column(Integer, default=0)
    exit_delay_buy_secs   = Column(Integer, default=0)
    exit_delay_sell_secs  = Column(Integer, default=0)

    # ── Error handling ────────────────────────────────────────────────────────
    exit_on_margin_error  = Column(Boolean, default=True)
    exit_on_entry_failure = Column(Boolean, default=True)

    # ── Lot sizing ────────────────────────────────────────────────────────────
    base_lot_multiplier = Column(Integer, default=1)
    # Per-day multiplier lives on GridEntry.lot_multiplier, not here.

    # ── SEBI classification ───────────────────────────────────────────────────
    strategy_type = Column(
        Enum(StrategyType, values_callable=lambda x: [e.value for e in x]),
        nullable=True,
    )  # "white_box" or "black_box" — required for algorithms_registry

    # ── Journey config (Phase 1E) ─────────────────────────────────────────────
    journey_config = Column(JSON, nullable=True)

    # ── Recurring grid days ────────────────────────────────────────────────────
    # ["MON","WED","FRI"] — GridPage auto-creates entries each week for these days.
    # Updated by POST /grid/ (deploy) and DELETE /grid/{id}?remove_recurring=true.
    recurring_days = Column(JSON, nullable=True, default=list)
    pending_day_removals = Column(JSON, nullable=True, default=list)
    # Days queued for removal after midnight. Set when user removes an active day.
    # Processed by scheduler at 00:01 IST and applied to recurring_days.

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    notes      = Column(Text, nullable=True)


class AlgoLeg(Base):
    """
    Individual legs within an algo.
    A straddle = 2 legs (CE + PE). A strangle = 2+ legs.

    W&T and Re-entry are stored per-leg — they are NOT algo-level concepts.
    """
    __tablename__ = "algo_legs"

    id         = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    algo_id    = Column(UUID(as_uuid=True), ForeignKey("algos.id"), nullable=False)
    leg_number = Column(Integer, nullable=False)    # display order: 1, 2, 3...
    direction  = Column(String(4), nullable=False)  # "buy" or "sell"
    instrument = Column(String(5), nullable=False)  # "ce", "pe", "fu"
    underlying = Column(String(20), nullable=False) # "NIFTY", "BANKNIFTY", etc.
    expiry     = Column(String(20), nullable=False) # "current_weekly", "next_weekly", "current_monthly", "next_monthly"
    strike_type   = Column(String(20), nullable=False) # "atm", "itm3", "otm2", "premium", "straddle_premium"
    strike_offset = Column(Integer, default=0)          # 1–10 for ITM/OTM
    strike_value  = Column(Float, nullable=True)        # ₹ for premium-based selection
    lots       = Column(Integer, default=1)

    # ── Per-leg SL / TP ───────────────────────────────────────────────────────
    # sl_type / tp_type values: "pts_instrument" | "pct_instrument" | "pts_underlying" | "pct_underlying"
    sl_type  = Column(String(20), nullable=True)
    sl_value = Column(Float, nullable=True)
    tp_type  = Column(String(20), nullable=True)
    tp_value = Column(Float, nullable=True)

    # ── Per-leg TSL (Trailing Stop Loss) ──────────────────────────────────────
    # For every X move in favour, shift SL by Y. Same unit for X and Y.
    tsl_enabled = Column(Boolean, default=False)   # toggle — must be True for engine to arm TSL
    tsl_x    = Column(Float, nullable=True)
    tsl_y    = Column(Float, nullable=True)
    tsl_unit = Column(String(5), nullable=True)    # "pts" or "pct"

    # ── Per-leg TTP (Trailing Target Profit — Phase 1E) ───────────────────────
    ttp_enabled = Column(Boolean, default=False)   # toggle — must be True for engine to arm TTP
    ttp_x    = Column(Float, nullable=True)
    ttp_y    = Column(Float, nullable=True)
    ttp_unit = Column(String(5), nullable=True)

    # ── Per-leg W&T (Wait and Trade) ──────────────────────────────────────────
    # At entry_time: capture reference price, then wait for threshold cross.
    # wt_direction: "up" → entry when LTP rises X above ref; "down" → falls X below ref
    wt_enabled   = Column(Boolean, default=False)
    wt_direction = Column(String(5), nullable=True)   # "up" or "down"
    wt_value     = Column(Float, nullable=True)
    wt_unit      = Column(String(5), nullable=True)   # "pts" or "pct"

    # ── Per-leg Re-entry ──────────────────────────────────────────────────────
    # reentry_max: 0 = disabled, 1–5 = max re-entries per day
    reentry_on_sl   = Column(Boolean, default=False)   # re-enter after SL hit
    reentry_on_tp   = Column(Boolean, default=False)   # re-enter after TP hit
    reentry_max     = Column(Integer, default=0)   # 0–5

    # ── Journey config (child leg to fire on exit — Phase 1E) ─────────────────
    journey_config = Column(JSON, nullable=True)

    # ── Runtime strike resolution (set by algo_runner after strike selection) ──
    # Stored so LTP tracking and position monitors can access it via leg reference.
    instrument_token  = Column(Integer, nullable=True)
    # Underlying index token for pts_underlying / pct_underlying SL/TP evaluation.
    # Populated on leg creation/update from UNDERLYING_TOKENS map.
    underlying_token  = Column(Integer, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
