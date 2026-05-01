"""
Account model — stores broker account details.
Accounts: Karthik (Zerodha F&O), Mom (Angel One F&O), Wife (Angel One MCX Phase 2)
"""
from sqlalchemy import Column, String, Float, Boolean, DateTime, Text, Enum, Integer, Date, Numeric, ForeignKey, UniqueConstraint
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
    access_token = Column(Text, nullable=True)                     # daily JWT token
    feed_token  = Column(Text, nullable=True)                      # Angel One SmartStream feed token
    totp_secret = Column(Text, nullable=True)                      # Angel One TOTP secret for auto-login
    token_generated_at = Column(DateTime(timezone=True), nullable=True)
    status      = Column(Enum(AccountStatus, values_callable=lambda x: [e.value for e in x]), default=AccountStatus.DISCONNECTED)
    global_sl   = Column(Float, nullable=True)                     # account-level SL ₹
    fy_brokerage = Column(Float, nullable=True)                     # FY brokerage expense ₹
    fy_margin   = Column(Float, nullable=True)                     # FY trading margin ₹ (for ROI calculation)
    global_tp   = Column(Float, nullable=True)                     # account-level TP ₹
    is_active   = Column(Boolean, default=True)
    scope       = Column(String(10), nullable=True, default='fo')   # 'fo' (F&O) or 'mcx'
    initial_capital        = Column(Numeric(14, 2), nullable=True)   # snapshot of net available used as baseline
    initial_capital_set_at = Column(DateTime(timezone=True), nullable=True)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())
    updated_at  = Column(DateTime(timezone=True), onupdate=func.now())


class AccountFYMargin(Base):
    """Per-account per-FY margin and brokerage tracking."""
    __tablename__ = "account_fy_margin"
    __table_args__ = (
        UniqueConstraint("account_id", "fy_start", name="uq_account_fy_margin"),
    )

    id            = Column(Integer, primary_key=True, autoincrement=True)
    account_id    = Column(UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    fy_start      = Column(Date, nullable=False)          # e.g. 2026-04-01
    fy_margin     = Column(Numeric(18, 2), nullable=True) # total capital deployed this FY
    fy_brokerage  = Column(Numeric(18, 2), nullable=True) # brokerage paid this FY
    stamped_at    = Column(DateTime(timezone=True), nullable=True)  # when auto-stamped from broker
    updated_at    = Column(DateTime(timezone=True), nullable=True)
