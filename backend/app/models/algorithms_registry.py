"""
AlgorithmRegistry — SEBI algorithm registration record.

One row per registered algo. Created when an algo is first deployed live.
strategy_type mirrors Algo.strategy_type — stored here for compliance snapshot
(so registry remains accurate even if the algo config changes later).
"""
from sqlalchemy import Column, String, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
import uuid

from app.core.database import Base


class AlgorithmRegistry(Base):
    __tablename__ = "algorithms_registry"

    id            = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    algo_id       = Column(UUID(as_uuid=True), ForeignKey("algos.id", ondelete="CASCADE"),
                           nullable=False, unique=True)
    name          = Column(String(100), nullable=False)
    strategy_type = Column(String(20),  nullable=False)   # "white_box" | "black_box"
    version       = Column(String(20),  nullable=False, default="1.0")
    registered_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    exchange_ref  = Column(String(100), nullable=True)    # broker-assigned registration ref (future)
