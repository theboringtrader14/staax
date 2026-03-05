"""
AlgoState model — runtime state of a deployed algo for a given day.

This is separate from Algo (config) and GridEntry (deployment).
One AlgoState row per GridEntry — created when the algo activates at entry_time,
updated on every state transition, queried by Orders page for live status.

State machine:
  INACTIVE → WAITING → ACTIVE → CLOSED
                              ↘ ERROR
                              ↘ TERMINATED

  INACTIVE   : Before entry_time. Algo is scheduled but not yet running.
  WAITING    : entry_time reached. For ORB: waiting for range to lock + breakout.
               For W&T: waiting for threshold cross. For Direct: placing orders.
  ACTIVE     : At least one leg is open. Monitors (SL/TP/TSL/MTM) are running.
  CLOSED     : All legs exited. P&L is final.
  ERROR      : Entry failed / margin error. RE button enabled in UI.
  TERMINATED : Manually terminated via T button. Cannot be restarted today.
  NO_TRADE   : ORB window closed with no breakout, or W&T threshold not crossed by exit_time.
"""
from sqlalchemy import Column, String, Float, Boolean, DateTime, Enum, ForeignKey, Text, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
import uuid
import enum

from app.core.database import Base


class AlgoRunStatus(str, enum.Enum):
    INACTIVE   = "inactive"
    WAITING    = "waiting"
    ACTIVE     = "active"
    CLOSED     = "closed"
    ERROR      = "error"
    TERMINATED = "terminated"
    NO_TRADE   = "no_trade"


class AlgoState(Base):
    """
    Runtime state for one algo on one trading day.
    Created at 9:15 AM by AlgoScheduler for every GridEntry with is_enabled=True.
    """
    __tablename__ = "algo_states"

    id             = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    grid_entry_id  = Column(UUID(as_uuid=True), ForeignKey("grid_entries.id"), nullable=False, unique=True)
    algo_id        = Column(UUID(as_uuid=True), ForeignKey("algos.id"), nullable=False)
    account_id     = Column(UUID(as_uuid=True), ForeignKey("accounts.id"), nullable=False)
    trading_date   = Column(String(10), nullable=False)   # YYYY-MM-DD

    # ── Current state ─────────────────────────────────────────────────────────
    status         = Column(Enum(AlgoRunStatus), default=AlgoRunStatus.INACTIVE, nullable=False)
    is_practix     = Column(Boolean, default=True)

    # ── Timestamps ────────────────────────────────────────────────────────────
    activated_at   = Column(DateTime(timezone=True), nullable=True)   # when WAITING started
    first_fill_at  = Column(DateTime(timezone=True), nullable=True)   # when ACTIVE started
    closed_at      = Column(DateTime(timezone=True), nullable=True)   # when CLOSED/TERMINATED

    # ── MTM tracking ──────────────────────────────────────────────────────────
    mtm_current    = Column(Float, default=0.0)        # live unrealised P&L
    mtm_realised   = Column(Float, default=0.0)        # locked-in P&L from closed legs

    # ── Journey tracking ──────────────────────────────────────────────────────
    reentry_count  = Column(Integer, default=0)        # how many re-entries fired today
    journey_level  = Column(String(10), nullable=True) # current level: "1", "1.1", "2.1"

    # ── Error info ────────────────────────────────────────────────────────────
    error_message  = Column(Text, nullable=True)
    error_at       = Column(DateTime(timezone=True), nullable=True)

    # ── Exit reason ───────────────────────────────────────────────────────────
    exit_reason    = Column(String(20), nullable=True)  # "sl", "tp", "mtm_sl", "sq", etc.

    created_at     = Column(DateTime(timezone=True), server_default=func.now())
    updated_at     = Column(DateTime(timezone=True), onupdate=func.now())
