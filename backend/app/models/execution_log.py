"""
ExecutionLog — SEBI audit trail for every order decision.

One row written for every: PLACE attempt, CANCEL, RETRY, BLOCK, SQ.
Never deleted. Used for compliance review and post-trade analysis.
"""
from sqlalchemy import Column, String, Text, DateTime, ForeignKey, Boolean
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import func
import uuid

from app.core.database import Base


class ExecutionLog(Base):
    __tablename__ = "execution_logs"

    id         = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    timestamp  = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Context — nullable so logs survive even partial data
    account_id    = Column(UUID(as_uuid=True), ForeignKey("accounts.id",      ondelete="SET NULL"), nullable=True)
    algo_id       = Column(UUID(as_uuid=True), ForeignKey("algos.id",         ondelete="SET NULL"), nullable=True)
    order_id      = Column(UUID(as_uuid=True), ForeignKey("orders.id",        ondelete="SET NULL"), nullable=True)
    grid_entry_id = Column(UUID(as_uuid=True), ForeignKey("grid_entries.id",  ondelete="SET NULL"), nullable=True)
    algo_tag      = Column(String(150), nullable=True)

    # What happened
    action = Column(String(30), nullable=False)
    # PLACE | CANCEL | RETRY | BLOCK | SQ | RATE_LIMIT | CANCEL_RATE_LIMIT

    status = Column(String(20), nullable=False)
    # OK | BLOCKED | FAILED

    reason = Column(Text, nullable=True)

    # Richer context (added in 0014_execution_log_v2)
    event_type  = Column(String(30), nullable=True)
    # entry_attempt | entry_success | entry_failed | exit_attempt | exit_success |
    # exit_failed | sl_hit | tp_hit | tsl_trail | reentry | kill_switch | pre_check_failed

    details    = Column(JSONB, nullable=True)    # broker response, prices, leg info etc.
    is_practix = Column(Boolean, nullable=True)
