from sqlalchemy import Column, String, Float, DateTime, Integer, Index
from sqlalchemy.dialects.postgresql import UUID
import uuid
from app.core.database import Base
from datetime import datetime


class WTArmedState(Base):
    __tablename__ = "wt_armed_state"

    id            = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    grid_entry_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    algo_id       = Column(UUID(as_uuid=True), nullable=False)
    account_id    = Column(UUID(as_uuid=True), nullable=False)
    leg_number    = Column(Integer, nullable=False)
    symbol        = Column(String(50), nullable=False)
    symbol_token  = Column(String(20), nullable=False)
    exchange      = Column(String(10), nullable=False)
    direction     = Column(String(10), nullable=False)   # 'up' or 'down'
    ref_price     = Column(Float, nullable=False)
    threshold     = Column(Float, nullable=False)
    limit_price   = Column(Float, nullable=False)
    broker_sl_id  = Column(String(50), nullable=True)    # Angel order ID for pending SL-Limit
    status        = Column(String(20), nullable=False, default='ARMED')  # ARMED|TRIGGERED|EXPIRED|CANCELLED
    armed_at      = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    triggered_at  = Column(DateTime(timezone=True), nullable=True)
    expired_at    = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index('idx_wt_armed_status_date', 'status', 'armed_at'),
    )
