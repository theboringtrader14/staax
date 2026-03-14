"""EventLog model — persists every significant platform event."""
from sqlalchemy import Column, Integer, String, DateTime, Text
from app.core.database import Base

class EventLog(Base):
    __tablename__ = "event_log"
    id         = Column(Integer, primary_key=True, autoincrement=True)
    ts         = Column(DateTime(timezone=True), nullable=False)
    level      = Column(String(10),  nullable=False)
    msg        = Column(String(500), nullable=False)
    algo_name  = Column(String(100), nullable=True)
    algo_id    = Column(String(50),  nullable=True)
    account_id = Column(String(50),  nullable=True)
    source     = Column(String(50),  nullable=True)
    details    = Column(Text,        nullable=True)
