from sqlalchemy import Column, String, Float, DateTime, Integer, Date
from sqlalchemy.dialects.postgresql import UUID
import uuid
from app.core.database import Base
from datetime import datetime


class HedgeOrder(Base):
    __tablename__ = "hedge_orders"

    id              = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    trading_date    = Column(Date, nullable=False, index=True)
    instrument      = Column(String(20), nullable=False)   # NIFTY, SENSEX
    option_type     = Column(String(5), nullable=False)    # CE, PE
    symbol          = Column(String(50), nullable=False)
    symbol_token    = Column(String(20), nullable=True)
    lots            = Column(Integer, nullable=False)
    quantity        = Column(Integer, nullable=False)
    fill_price      = Column(Float, nullable=True)
    ltp             = Column(Float, nullable=True)
    pnl             = Column(Float, nullable=True)
    broker_order_id = Column(String(50), nullable=True)
    status          = Column(String(20), nullable=False, default='OPEN')  # OPEN|CLOSED|ERROR
    placed_at       = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    reason          = Column(String(200), nullable=True)
    account_id      = Column(UUID(as_uuid=True), nullable=True)
