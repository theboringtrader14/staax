from pydantic import BaseModel
from typing import Optional, List, Any
from uuid import UUID


class AlgoLegCreate(BaseModel):
    leg_number: int
    direction: str
    instrument: str
    underlying: str
    expiry: str
    strike_type: str
    strike_offset: int = 0
    strike_value: Optional[float] = None
    lots: int = 1
    sl_type: Optional[str] = None
    sl_value: Optional[float] = None
    tp_type: Optional[str] = None
    tp_value: Optional[float] = None
    tsl_x: Optional[float] = None
    tsl_y: Optional[float] = None
    tsl_unit: Optional[str] = None


class AlgoCreate(BaseModel):
    name: str
    account_id: UUID
    strategy_mode: str
    entry_type: str
    order_type: str = "market"
    entry_time: Optional[str] = None
    exit_time: Optional[str] = None
    orb_start_time: Optional[str] = None
    orb_end_time: Optional[str] = None
    next_day_exit_time: Optional[str] = None
    next_day_sl_check_time: Optional[str] = None
    wt_type: Optional[str] = None
    wt_value: Optional[float] = None
    wt_unit: Optional[str] = None
    mtm_sl: Optional[float] = None
    mtm_tp: Optional[float] = None
    mtm_unit: Optional[str] = None
    default_days: List[str] = ["mon","tue","wed","thu","fri"]
    base_lot_multiplier: int = 1
    reentry_config: Optional[Any] = None
    journey_config: Optional[Any] = None
    legs: List[AlgoLegCreate] = []


class AlgoResponse(BaseModel):
    id: UUID
    name: str
    strategy_mode: str
    entry_type: str
    is_active: bool

    class Config:
        from_attributes = True
