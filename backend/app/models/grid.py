"""
GridEntry model — deploys an algo to a specific trading day.
This is the Smart Grid's data model.
One GridEntry = one cell in the Smart Grid.

CHANGES vs previous version:
- ADDED: is_archived — supports archive/unarchive without deleting
"""
from sqlalchemy import Column, Integer, Boolean, DateTime, Date, String, Enum, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
import uuid
import enum

from app.core.database import Base


class GridStatus(str, enum.Enum):
    NO_TRADE     = "no_trade"
    ALGO_ACTIVE  = "algo_active"
    ORDER_PENDING = "order_pending"
    OPEN         = "open"
    ALGO_CLOSED  = "algo_closed"
    ERROR        = "error"


class GridEntry(Base):
    __tablename__ = "grid_entries"

    id           = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    algo_id      = Column(UUID(as_uuid=True), ForeignKey("algos.id"), nullable=False, index=True)
    account_id   = Column(UUID(as_uuid=True), ForeignKey("accounts.id"), nullable=False, index=True)
    trading_date = Column(Date, nullable=False, index=True)
    day_of_week  = Column(String(3), nullable=False)    # "mon", "tue", "wed", "thu", "fri"
    lot_multiplier = Column(Integer, default=1)          # M: value shown in the grid cell
    is_enabled      = Column(Boolean, default=True)
    mslc_triggered  = Column(Boolean, default=False)
    is_practix      = Column(Boolean, default=True)         # PRACTIX/LIVE toggle per cell
    is_archived  = Column(Boolean, default=False)        # archived algos hidden from active grid
    status       = Column(Enum(GridStatus, values_callable=lambda x: [e.value for e in x]), default=GridStatus.NO_TRADE, index=True)
    created_at   = Column(DateTime(timezone=True), server_default=func.now())
    updated_at   = Column(DateTime(timezone=True), onupdate=func.now())
