from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
import uuid

from app.core.database import Base


class TelegramSubscription(Base):
    __tablename__ = "telegram_subscriptions"

    id           = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    chat_id      = Column(String(50), nullable=False, index=True)
    display_name = Column(String(100), nullable=True)
    user_id      = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    account_id   = Column(UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    notify_entry = Column(Boolean, default=True)
    notify_sl    = Column(Boolean, default=True)
    notify_tp    = Column(Boolean, default=True)
    notify_error = Column(Boolean, default=True)
    notify_eod   = Column(Boolean, default=True)
    is_active    = Column(Boolean, default=True)
    linked_at    = Column(DateTime(timezone=True), server_default=func.now())
