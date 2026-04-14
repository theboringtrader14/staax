"""
Order model — individual leg orders placed (live or PRACTIX).

CHANGES vs previous version:
- ADDED: is_overnight — True for BTST/STBT legs (uses NRML product type at broker)
"""
from sqlalchemy import Column, String, Float, Integer, Boolean, DateTime, Enum, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
import uuid
import enum

from app.core.database import Base


class OrderStatus(str, enum.Enum):
    PENDING = "pending"
    OPEN    = "open"
    CLOSED  = "closed"
    ERROR   = "error"


class ExitReason(str, enum.Enum):
    SL         = "sl"
    TP         = "tp"
    TSL        = "tsl"
    MTM_SL     = "mtm_sl"
    MTM_TP     = "mtm_tp"
    GLOBAL_SL  = "global_sl"
    SQ         = "sq"          # manual square off
    AUTO_SQ    = "auto_sq"     # auto square off at exit_time
    ERROR      = "error"
    BTST_EXIT  = "btst_exit"   # next-day exit for BTST
    STBT_EXIT  = "stbt_exit"   # next-day exit for STBT


class Order(Base):
    __tablename__ = "orders"

    id             = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    grid_entry_id  = Column(UUID(as_uuid=True), ForeignKey("grid_entries.id"), nullable=False)
    algo_id        = Column(UUID(as_uuid=True), ForeignKey("algos.id"), nullable=False)
    leg_id         = Column(UUID(as_uuid=True), ForeignKey("algo_legs.id"), nullable=False)
    account_id     = Column(UUID(as_uuid=True), ForeignKey("accounts.id"), nullable=False)

    # ── Broker details ────────────────────────────────────────────────────────
    broker_order_id = Column(String(100), nullable=True)   # ID from broker API
    algo_tag        = Column(String(150), nullable=True)   # SEBI audit tag: STAAX_{account}_{algo}_{leg}_{ts}
    is_practix     = Column(Boolean, default=True)
    is_synced      = Column(Boolean, default=False)        # manually synced order
    is_overnight   = Column(Boolean, default=False)
    # is_overnight=True: BTST/STBT orders use PRODUCT_NRML instead of MIS at broker

    # ── Instrument ────────────────────────────────────────────────────────────
    symbol           = Column(String(50), nullable=False)    # e.g. NIFTY22000CE
    exchange         = Column(String(10), nullable=False)    # NFO, MCX
    expiry_date      = Column(String(20), nullable=True)
    instrument_token = Column(Integer, nullable=True)        # broker token for LTP lookup
    direction        = Column(String(4), nullable=False)     # "buy" or "sell"
    lots             = Column(Integer, nullable=False)
    quantity         = Column(Integer, nullable=False)

    # ── Entry ─────────────────────────────────────────────────────────────────
    entry_type      = Column(String(20), nullable=True)   # "direct", "orb", "wt"
    entry_reference = Column(String(100), nullable=True)  # e.g. "ORB High: 100.5"
    fill_price      = Column(Float, nullable=True)
    fill_time       = Column(DateTime(timezone=True), nullable=True)

    # ── Order latency (added 0015_order_latency) ──────────────────────────────
    placed_at  = Column(DateTime(timezone=True), nullable=True)   # when sent to broker
    filled_at  = Column(DateTime(timezone=True), nullable=True)   # when broker confirmed
    latency_ms = Column(Integer, nullable=True)                   # filled_at - placed_at in ms

    # ── Live tracking ─────────────────────────────────────────────────────────
    ltp           = Column(Float, nullable=True)
    sl_original   = Column(Float, nullable=True)
    sl_actual     = Column(Float, nullable=True)   # current level after TSL trails
    tsl_trail_count = Column(Integer, default=0)
    reentry_count      = Column(Integer, default=0)         # how many times this leg was re-entered
    reentry_type_used  = Column(String(20), nullable=True)  # "re_entry" | "re_execute" — recorded at re-entry time
    target        = Column(Float, nullable=True)

    # ── TSL runtime tracking ───────────────────────────────────────────────────
    # Persisted on every trail so position rebuilder can restore TSL state after restart.
    tsl_activated        = Column(Boolean, default=False)    # True once first trail fires
    tsl_activation_price = Column(Float, nullable=True)      # LTP when TSL first armed (= fill_price)
    tsl_current_sl       = Column(Float, nullable=True)      # last persisted TSL level (mirrors sl_actual)

    # ── TTP runtime tracking ───────────────────────────────────────────────────
    ttp_activated        = Column(Boolean, default=False)    # True once first trail fires
    ttp_activation_price = Column(Float, nullable=True)      # LTP when TTP first armed (= fill_price)
    ttp_current_tp       = Column(Float, nullable=True)      # last persisted TTP level (mirrors target)
    ttp_trail_count      = Column(Integer, default=0)        # number of TTP trails fired (mirrors tsl_trail_count)

    # ── Exit ──────────────────────────────────────────────────────────────────
    exit_price        = Column(Float, nullable=True)
    exit_price_manual = Column(Float, nullable=True)   # user-corrected exit (Phase 1E)
    exit_time         = Column(DateTime(timezone=True), nullable=True)
    exit_reason       = Column(Enum(ExitReason, values_callable=lambda x: [e.value for e in x]), nullable=True)

    # ── P&L ───────────────────────────────────────────────────────────────────
    pnl = Column(Float, nullable=True)

    # ── State ─────────────────────────────────────────────────────────────────
    status        = Column(Enum(OrderStatus, values_callable=lambda x: [e.value for e in x]), default=OrderStatus.PENDING)
    journey_level = Column(String(10), nullable=True)   # "1", "1.1", "2.1" etc.
    error_message    = Column(Text, nullable=True)
    retry_count      = Column(Integer, default=0)
    last_retry_time  = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class MarginHistory(Base):
    """FY margin records — used for ROI calculation in Reports."""
    __tablename__ = "margin_history"

    id             = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    account_id     = Column(UUID(as_uuid=True), ForeignKey("accounts.id"), nullable=False)
    financial_year = Column(String(10), nullable=False)    # e.g. "2024-25"
    margin_amount  = Column(Float, nullable=False)
    source         = Column(String(10), default="manual")  # "auto" or "manual"
    recorded_at    = Column(DateTime(timezone=True), server_default=func.now())
