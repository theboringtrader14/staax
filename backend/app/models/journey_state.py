import enum
import uuid
from sqlalchemy import Column, String, Enum, DateTime, func
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base


class JourneyStatus(str, enum.Enum):
    WATCHING  = "watching"
    TRIGGERED = "triggered"
    CANCELLED = "cancelled"
    EXPIRED   = "expired"


class JourneyTriggerOn(str, enum.Enum):
    SL_HIT = "sl_hit"
    TP_HIT = "tp_hit"
    EXIT   = "exit"
    FILL   = "fill"


class JourneyState(Base):
    __tablename__ = "journey_state"

    id                   = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    parent_grid_entry_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    child_grid_entry_id  = Column(UUID(as_uuid=True), nullable=False, index=True)
    parent_leg_id        = Column(UUID(as_uuid=True), nullable=True)
    child_leg_id         = Column(UUID(as_uuid=True), nullable=True)
    trigger_on           = Column(Enum(JourneyTriggerOn, name="journeytriggeron"), nullable=False)
    status               = Column(Enum(JourneyStatus, name="journeystatus"), nullable=False, default=JourneyStatus.WATCHING)
    created_at           = Column(DateTime(timezone=True), server_default=func.now())
    updated_at           = Column(DateTime(timezone=True), onupdate=func.now())
