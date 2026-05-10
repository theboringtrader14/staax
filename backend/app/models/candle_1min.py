from sqlalchemy import Column, String, Float, DateTime, Index
from app.core.database import Base


class Candle1Min(Base):
    __tablename__ = "candle_1min"

    symbol_token = Column(String(20), primary_key=True)
    ts           = Column(DateTime(timezone=True), primary_key=True)
    open         = Column(Float, nullable=False)
    high         = Column(Float, nullable=False)
    low          = Column(Float, nullable=False)
    close        = Column(Float, nullable=False)
    volume       = Column(Float, default=0.0)

    __table_args__ = (
        Index('idx_candle_1min_token_ts', 'symbol_token', 'ts'),
    )
