"""
Algo model — stores strategy configuration.
Each algo is created once and deployed to days via GridEntry.
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


class EntryType(str, enum.Enum):
    DIRECT = "direct"
    ORB    = "orb"
    WT     = "wt"
    ORB_WT = "orb_wt"


class OrderType(str, enum.Enum):
    MARKET = "market"
    LIMIT  = "limit"


class Algo(Base):
    __tablename__ = "algos"

    id             = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name           = Column(String(100), unique=True, nullable=False)  # e.g. "AWS-1"
    account_id     = Column(UUID(as_uuid=True), ForeignKey("accounts.id"), nullable=False)
    strategy_mode  = Column(Enum(StrategyMode), nullable=False)
    entry_type     = Column(Enum(EntryType), nullable=False)
    order_type     = Column(Enum(OrderType), default=OrderType.MARKET)
    is_active      = Column(Boolean, default=True)

    # Timing
    entry_time     = Column(String(8), nullable=True)   # HH:MM:SS — E: time (all modes)
    exit_time      = Column(String(8), nullable=True)   # HH:MM:SS — intraday SQ time
    orb_start_time = Column(String(8), nullable=True)   # HH:MM:SS
    orb_end_time   = Column(String(8), nullable=True)   # HH:MM:SS
    next_day_exit_time = Column(String(8), nullable=True)  # E: for BTST/STBT
    next_day_sl_check_time = Column(String(8), nullable=True)  # N: for BTST/STBT

    # W&T config
    wt_type        = Column(String(10), nullable=True)  # "up" or "down"
    wt_value       = Column(Float, nullable=True)
    wt_unit        = Column(String(5), nullable=True)   # "pts" or "pct"

    # MTM controls
    mtm_sl         = Column(Float, nullable=True)
    mtm_tp         = Column(Float, nullable=True)
    mtm_unit       = Column(String(5), nullable=True)   # "amt" or "pct"

    # Order delays
    entry_delay_buy_secs  = Column(Integer, default=0)
    entry_delay_sell_secs = Column(Integer, default=0)
    exit_delay_buy_secs   = Column(Integer, default=0)
    exit_delay_sell_secs  = Column(Integer, default=0)

    # Error settings
    exit_on_margin_error  = Column(Boolean, default=True)
    exit_on_entry_failure = Column(Boolean, default=True)

    # Default days (stored as JSON array: ["mon","tue","wed","thu","fri"])
    default_days   = Column(JSON, default=["mon","tue","wed","thu","fri"])
    base_lot_multiplier = Column(Integer, default=1)

    # Re-entry config (JSON — see PRD Section 7.6)
    reentry_config = Column(JSON, nullable=True)

    # Journey config (JSON — see PRD Section 7.7)
    journey_config = Column(JSON, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    notes      = Column(Text, nullable=True)


class AlgoLeg(Base):
    """
    Individual legs within an algo.
    A straddle = 2 legs (CE + PE). A strangle = 2+ legs.
    """
    __tablename__ = "algo_legs"

    id           = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    algo_id      = Column(UUID(as_uuid=True), ForeignKey("algos.id"), nullable=False)
    leg_number   = Column(Integer, nullable=False)   # 1, 2 — parent leg number
    direction    = Column(String(4), nullable=False)  # "buy" or "sell"
    instrument   = Column(String(5), nullable=False)  # "ce", "pe", "fu"
    underlying   = Column(String(20), nullable=False) # "NIFTY", "BANKNIFTY", etc.
    expiry       = Column(String(20), nullable=False) # "current_week", "next_week", "monthly_current", "monthly_next"
    strike_type  = Column(String(10), nullable=False) # "atm", "itm", "otm", "premium", "straddle_premium"
    strike_offset = Column(Integer, default=0)        # 1-10 for ITM/OTM
    strike_value = Column(Float, nullable=True)       # for premium-based selection
    lots         = Column(Integer, default=1)

    # Per-leg risk params
    sl_type      = Column(String(20), nullable=True)  # "pts_instrument", "pct_instrument", "pts_underlying", "pct_underlying"
    sl_value     = Column(Float, nullable=True)
    tp_type      = Column(String(20), nullable=True)
    tp_value     = Column(Float, nullable=True)
    tsl_x        = Column(Float, nullable=True)       # TSL: for every X move
    tsl_y        = Column(Float, nullable=True)       # TSL: shift SL by Y
    tsl_unit     = Column(String(5), nullable=True)   # "pts" or "pct"
    ttp_x        = Column(Float, nullable=True)
    ttp_y        = Column(Float, nullable=True)
    ttp_unit     = Column(String(5), nullable=True)

    created_at   = Column(DateTime(timezone=True), server_default=func.now())
