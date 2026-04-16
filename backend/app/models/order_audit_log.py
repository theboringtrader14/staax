"""
OrderAuditLog — write-only table recording Order lifecycle transitions.

One row per status change: PENDING → OPEN, PENDING → ERROR, OPEN → CLOSED, etc.
No FK constraints so writes never fail due to cascade/referential issues.
Uses a completely independent AsyncSession — never rolled back by caller.
"""
from sqlalchemy import Column, String, Text, Float, DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
import uuid

from app.core.database import Base


class OrderAuditLog(Base):
    __tablename__ = "order_audit_log"

    id            = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    logged_at     = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Identifiers — stored as strings, no FK constraints
    order_id      = Column(String(36), nullable=True, index=True)
    algo_id       = Column(String(36), nullable=True, index=True)
    grid_entry_id = Column(String(36), nullable=True)
    account_id    = Column(String(36), nullable=True)

    # Transition
    from_status   = Column(String(20), nullable=True)   # e.g. "pending"
    to_status     = Column(String(20), nullable=False)  # e.g. "open", "error"

    # Context snapshot
    symbol        = Column(String(30), nullable=True)
    direction     = Column(String(4),  nullable=True)
    fill_price    = Column(Float,      nullable=True)
    broker_order_id = Column(String(50), nullable=True)
    is_practix    = Column(String(5),  nullable=True)   # "true" / "false"
    note          = Column(Text,       nullable=True)
