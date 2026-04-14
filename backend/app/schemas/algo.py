"""
Pydantic schemas for Algo API endpoints.

CHANGES vs previous version:
- REMOVED: wt_type, wt_value, wt_unit from AlgoCreate (W&T is per-leg)
- REMOVED: next_day_sl_check_time from AlgoCreate (hardcoded in scheduler)
- REMOVED: default_days from AlgoCreate (grid-only)
- REMOVED: reentry_config from AlgoCreate (now per-leg on AlgoLegCreate)
- ADDED:   dte to AlgoCreate
- ADDED:   wt_enabled, wt_direction, wt_value, wt_unit to AlgoLegCreate
- ADDED:   reentry_on_sl, reentry_on_tp, reentry_max to AlgoLegCreate
- EntryType now only "direct" | "orb"
"""
from pydantic import BaseModel, field_validator
from typing import Optional, List
from uuid import UUID


class AlgoLegCreate(BaseModel):
    leg_number:    int
    direction:     str           # "buy" or "sell"
    instrument:    str           # "ce", "pe", "fu"
    underlying:    str           # "NIFTY", "BANKNIFTY", etc.
    expiry:        str           # "current_weekly", "next_weekly", etc.
    strike_type:   str           # "atm", "itm3", "otm2", "premium", "straddle_premium"
    strike_offset: int = 0
    strike_value:  Optional[float] = None
    lots:          int = 1

    # SL / TP
    sl_type:  Optional[str]   = None    # "pts_instrument" | "pct_instrument" | "pts_underlying" | "pct_underlying"
    sl_value: Optional[float] = None
    tp_type:  Optional[str]   = None
    tp_value: Optional[float] = None

    # TSL
    tsl_x:    Optional[float] = None
    tsl_y:    Optional[float] = None
    tsl_unit: Optional[str]   = None   # "pts" or "pct"

    # TTP (Phase 1E)
    ttp_x:    Optional[float] = None
    ttp_y:    Optional[float] = None
    ttp_unit: Optional[str]   = None

    # W&T (per-leg)
    wt_enabled:   bool           = False
    wt_direction: Optional[str]  = None   # "up" or "down"
    wt_value:     Optional[float] = None
    wt_unit:      Optional[str]  = None   # "pts" or "pct"

    # Re-entry (per-leg)
    reentry_on_sl:   bool          = False
    reentry_on_tp:   bool          = False
    reentry_max:     int           = 0     # 0 = disabled, 1–5


class AlgoCreate(BaseModel):
    name:           str
    account_id:     UUID
    strategy_mode:  str           # "intraday" | "btst" | "stbt" | "positional"
    entry_type:     str           # "direct" | "orb" — only two valid values
    order_type:     str  = "market"

    # Timing
    entry_time:         Optional[str] = None   # HH:MM
    exit_time:          Optional[str] = None   # HH:MM — intraday SQ / BTST next-day
    orb_start_time:     Optional[str] = None   # HH:MM — ORB only
    orb_end_time:       Optional[str] = None   # HH:MM — ORB only
    next_day_exit_time: Optional[str] = None   # HH:MM — BTST/STBT only
    # NOTE: next_day_sl_check_time is computed automatically as entry_time - 2min

    # Positional
    dte: Optional[int] = None   # 1–30. NULL = exit on expiry day.

    # MTM
    mtm_sl:   Optional[float] = None
    mtm_tp:   Optional[float] = None
    mtm_unit: Optional[str]   = None   # "amt" or "pct"

    # Delays
    entry_delay_buy_secs:  int = 0
    entry_delay_sell_secs: int = 0
    exit_delay_buy_secs:   int = 0
    exit_delay_sell_secs:  int = 0

    # Error handling
    exit_on_margin_error:  bool = True
    exit_on_entry_failure: bool = True

    base_lot_multiplier: int = 1
    journey_config:      Optional[dict] = None   # Phase 1E

    legs: List[AlgoLegCreate] = []

    @field_validator("entry_type")
    @classmethod
    def validate_entry_type(cls, v: str) -> str:
        if v not in ("direct", "orb"):
            raise ValueError(f"entry_type must be 'direct' or 'orb', got '{v}'")
        return v

    @field_validator("strategy_mode")
    @classmethod
    def validate_strategy_mode(cls, v: str) -> str:
        if v not in ("intraday", "btst", "stbt", "positional"):
            raise ValueError(f"Unknown strategy_mode: {v}")
        return v

    @field_validator("dte")
    @classmethod
    def validate_dte(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and not (1 <= v <= 30):
            raise ValueError("dte must be between 1 and 30")
        return v


class AlgoUpdate(AlgoCreate):
    """All fields optional for PATCH-style updates."""
    name:          Optional[str]  = None
    account_id:    Optional[UUID] = None
    strategy_mode: Optional[str]  = None
    entry_type:    Optional[str]  = None


class AlgoLegResponse(BaseModel):
    id:            UUID
    leg_number:    int
    direction:     str
    instrument:    str
    underlying:    str
    expiry:        str
    strike_type:   str
    strike_offset: int
    lots:          int
    sl_type:       Optional[str]
    sl_value:      Optional[float]
    tp_type:       Optional[str]
    tp_value:      Optional[float]
    tsl_x:         Optional[float]
    tsl_y:         Optional[float]
    tsl_unit:      Optional[str]
    wt_enabled:    bool
    wt_direction:  Optional[str]
    wt_value:      Optional[float]
    wt_unit:       Optional[str]
    reentry_on_sl:   bool
    reentry_on_tp:   bool
    reentry_max:     int

    class Config:
        from_attributes = True


class AlgoResponse(BaseModel):
    id:             UUID
    name:           str
    account_id:     UUID
    strategy_mode:  str
    entry_type:     str
    order_type:     str
    is_active:      bool
    entry_time:     Optional[str]
    exit_time:      Optional[str]
    orb_start_time: Optional[str]
    orb_end_time:   Optional[str]
    next_day_exit_time: Optional[str]
    dte:            Optional[int]
    mtm_sl:         Optional[float]
    mtm_tp:         Optional[float]
    mtm_unit:       Optional[str]
    base_lot_multiplier: int
    legs:           List[AlgoLegResponse] = []

    class Config:
        from_attributes = True
