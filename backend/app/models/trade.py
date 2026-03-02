"""
Trade model — completed round-trip trades (entry + exit).
Used for all P&L reporting and equity curve calculations.
"""
from sqlalchemy import Column, Float, String, Boolean, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
import uuid

from app.core.database import Base


class Trade(Base):
    __tablename__ = "trades"

    id               = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id         = Column(UUID(as_uuid=True), ForeignKey("orders.id"), nullable=False)
    account_id       = Column(UUID(as_uuid=True), ForeignKey("accounts.id"), nullable=False)
    algo_id          = Column(UUID(as_uuid=True), ForeignKey("algos.id"), nullable=False)
    trading_date     = Column(String(10), nullable=False)  # YYYY-MM-DD
    financial_year   = Column(String(10), nullable=False)  # e.g. "2024-25"
    realised_pnl     = Column(Float, nullable=False)
    exit_reason      = Column(String(20), nullable=True)
    journey_level    = Column(String(10), nullable=True)   # "1", "1.1", etc.
    is_practix       = Column(Boolean, default=True)
    is_manual_exit   = Column(Boolean, default=False)      # manually corrected
    created_at       = Column(DateTime(timezone=True), server_default=func.now())
