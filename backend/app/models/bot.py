"""Bot model — Indicator Systems bots."""
from sqlalchemy import Column, String, Integer, Float, Boolean, DateTime
from sqlalchemy.dialects.postgresql import UUID
import uuid
from app.core.database import Base

class IndicatorType:
    DTR      = "dtr"
    CHANNEL  = "channel"
    TT_BANDS = "tt_bands"

class BotStatus:
    ACTIVE   = "active"    # running, watching for signals
    LIVE     = "live"      # active + has open position
    INACTIVE = "inactive"  # paused
    ARCHIVED = "archived"

class BotOrderStatus:
    OPEN   = "open"
    CLOSED = "closed"
    ERROR  = "error"

class Bot(Base):
    __tablename__ = "bots"
    id             = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name           = Column(String(100), nullable=False)
    account_id     = Column(UUID(as_uuid=True), nullable=False)
    instrument     = Column(String(20),  nullable=False)   # GOLDM, SILVERMIC
    exchange       = Column(String(10),  nullable=False)   # MCX
    expiry         = Column(String(20),  nullable=False)   # e.g. "2026-03"
    indicator      = Column(String(20),  nullable=False)
    timeframe_mins = Column(Integer, nullable=False, default=60)  # 45,60,120,180
    lots           = Column(Integer, nullable=False, default=1)
    # Channel Strategy params
    channel_candles = Column(Integer, nullable=True)
    channel_tf      = Column(String(10),  nullable=True)  # Channel Strategy timeframe
    # TT Bands Strategy params
    tt_lookback    = Column(Integer, nullable=True)
    status         = Column(String(20), nullable=False, server_default='active')
    is_archived    = Column(Boolean, default=False)
    is_practix     = Column(Boolean, default=True, nullable=False)
    created_at     = Column(DateTime(timezone=True))
    updated_at     = Column(DateTime(timezone=True))

class BotSignalStatus:
    FIRED    = "fired"
    EXECUTED = "executed"
    MISSED   = "missed"
    ERROR    = "error"

class BotSignal(Base):
    __tablename__ = "bot_signals"
    id             = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    bot_id         = Column(UUID(as_uuid=True), nullable=False)
    signal_type    = Column(String(20),  nullable=False)   # entry / exit / rollover
    direction      = Column(String(5),   nullable=True)    # BUY / SELL
    instrument     = Column(String(20),  nullable=False)
    expiry         = Column(String(20),  nullable=False)
    trigger_price  = Column(Float,       nullable=True)
    status         = Column(String(20),  nullable=False, server_default='fired')
    bot_order_id   = Column(UUID(as_uuid=True), nullable=True)  # FK to bot_orders if executed
    error_message  = Column(String(200), nullable=True)
    fired_at       = Column(DateTime(timezone=True), nullable=False)
    created_at     = Column(DateTime(timezone=True))

class BotOrder(Base):
    __tablename__ = "bot_orders"
    id              = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    bot_id          = Column(UUID(as_uuid=True), nullable=False)
    account_id      = Column(UUID(as_uuid=True), nullable=False)
    instrument      = Column(String(20), nullable=False)
    expiry          = Column(String(20), nullable=False)
    direction       = Column(String(5),  nullable=False)   # BUY / SELL
    lots            = Column(Integer,    nullable=False)
    entry_price     = Column(Float,      nullable=True)
    exit_price      = Column(Float,      nullable=True)
    entry_time      = Column(DateTime(timezone=True), nullable=True)
    exit_time       = Column(DateTime(timezone=True), nullable=True)
    pnl             = Column(Float,      nullable=True)
    status          = Column(String(20), server_default='open')
    broker_order_id = Column(String(50), nullable=True)
    signal_type     = Column(String(20), nullable=True)    # entry / exit / rollover
    error_message   = Column(String(200), nullable=True)
