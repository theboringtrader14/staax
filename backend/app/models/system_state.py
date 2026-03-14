"""
SystemState — persists global platform state across server restarts.
Single row (id=1) — never deleted, only updated.
"""
from sqlalchemy import Column, Integer, Boolean, DateTime, String
from app.core.database import Base
from datetime import datetime, timezone

class SystemState(Base):
    __tablename__ = "system_state"

    id                  = Column(Integer, primary_key=True, default=1)
    kill_switch_active  = Column(Boolean, default=False, nullable=False)
    kill_switch_at      = Column(DateTime(timezone=True), nullable=True)
    positions_squared   = Column(Integer, default=0)
    orders_cancelled    = Column(Integer, default=0)
    kill_switch_error   = Column(String, nullable=True)
    killed_account_ids  = Column(String, nullable=True)  # comma-separated UUIDs
