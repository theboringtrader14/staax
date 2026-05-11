from sqlalchemy import Column, String, Float, DateTime, Integer, Boolean, Index
from sqlalchemy.dialects.postgresql import UUID
import uuid
from app.core.database import Base
from datetime import datetime


class ReentryWatcherState(Base):
    __tablename__ = "reentry_watcher_state"

    id               = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    grid_entry_id    = Column(UUID(as_uuid=True), nullable=False, index=True)
    algo_id          = Column(UUID(as_uuid=True), nullable=False)
    order_id         = Column(UUID(as_uuid=True), nullable=False)
    leg_id           = Column(UUID(as_uuid=True), nullable=False)
    algo_state_id    = Column(UUID(as_uuid=True), nullable=False)
    direction        = Column(String(10), nullable=False)
    trigger_price    = Column(Float, nullable=False)
    exit_reason      = Column(String(20), nullable=False)
    reentry_count    = Column(Integer, nullable=False)
    ltp_mode         = Column(String(20), nullable=False, default='ltp')
    tsl_two_step     = Column(Boolean, nullable=False, default=False)
    sl_original      = Column(Float, nullable=True)
    instrument_token = Column(Integer, nullable=False)
    exit_time        = Column(String(10), nullable=True)
    status           = Column(String(20), nullable=False, default='WATCHING')
    # WATCHING | TRIGGERED | EXHAUSTED | CANCELLED | EXPIRED
    created_at       = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    triggered_at     = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index('idx_reentry_watcher_status', 'status', 'created_at'),
    )
