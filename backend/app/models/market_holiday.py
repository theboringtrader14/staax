"""MarketHoliday model — stores NSE/MCX market holidays."""
from datetime import date, datetime
from sqlalchemy import String, Date, DateTime, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
import uuid
from app.core.database import Base


class MarketHoliday(Base):
    __tablename__ = "market_holidays"

    id:          Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    date:        Mapped[date]      = mapped_column(Date, nullable=False)
    segment:     Mapped[str]       = mapped_column(String(20), nullable=False)
    description: Mapped[str]       = mapped_column(String(200), default="")
    created_at:  Mapped[datetime]  = mapped_column(DateTime(timezone=True), server_default=func.now())
