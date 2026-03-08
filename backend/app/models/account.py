"""
Account model — stores broker account details.
Accounts: Karthik (Zerodha F&O), Mom (Angel One F&O), Wife (Angel One MCX Phase 2)
"""
from sqlalchemy import Column, String, Float, Boolean, DateTime, Text, Enum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
import uuid
import enum

from app.core.database import Base


class BrokerType(str, enum.Enum):
    ZERODHA = "zerodha"
    ANGELONE = "angelone"


class AccountStatus(str, enum.Enum):
    ACTIVE = "active"
    TOKEN_EXPIRED = "token_expired"
    DISCONNECTED = "disconnected"


class Account(Base):
    __tablename__ = "accounts"

    id          = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    nickname    = Column(String(50), unique=True, nullable=False)  # e.g. "Karthik"
    broker      = Column(Enum(BrokerType, values_callable=lambda x: [e.value for e in x]), nullable=False)
    client_id   = Column(String(100), nullable=False)
    api_key     = Column(String(255), nullable=True)               # encrypted
    api_secret  = Column(Text, nullable=True)                      # encrypted
    access_token = Column(Text, nullable=True)                     # daily token
    token_generated_at = Column(DateTime(timezone=True), nullable=True)
    status      = Column(Enum(AccountStatus, values_callable=lambda x: [e.value for e in x]), default=AccountStatus.DISCONNECTED)
    global_sl   = Column(Float, nullable=True)                     # account-level SL ₹
    global_tp   = Column(Float, nullable=True)                     # account-level TP ₹
    is_active   = Column(Boolean, default=True)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())
    updated_at  = Column(DateTime(timezone=True), onupdate=func.now())
