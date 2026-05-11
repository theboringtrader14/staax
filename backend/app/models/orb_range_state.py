from sqlalchemy import Column, String, Float, DateTime, Integer, Index
from sqlalchemy.dialects.postgresql import UUID
import uuid
from app.core.database import Base
from datetime import datetime


class ORBRangeState(Base):
    __tablename__ = "orb_range_state"

    id            = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    grid_entry_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    algo_id       = Column(UUID(as_uuid=True), nullable=False)
    account_id    = Column(UUID(as_uuid=True), nullable=True)
    symbol        = Column(String(50), nullable=False)
    symbol_token  = Column(String(20), nullable=False)
    exchange      = Column(String(10), nullable=False)
    orb_start_time = Column(String(10), nullable=False)
    orb_end_time  = Column(String(10), nullable=False)
    range_high    = Column(Float, nullable=True)
    range_low     = Column(Float, nullable=True)
    entry_at      = Column(String(10), nullable=False)
    wt_buffer     = Column(Float, nullable=False, default=0.0)
    wt_unit       = Column(String(5), nullable=True)
    status        = Column(String(20), nullable=False, default='CAPTURING')
    # CAPTURING | FROZEN | ARMED | TRIGGERED | EXPIRED | NO_TRADE
    frozen_at     = Column(DateTime(timezone=True), nullable=True)
    triggered_at  = Column(DateTime(timezone=True), nullable=True)
    expired_at    = Column(DateTime(timezone=True), nullable=True)
    created_at    = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    __table_args__ = (
        Index('idx_orb_range_status_date', 'status', 'created_at'),
    )
