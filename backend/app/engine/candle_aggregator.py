"""
CandleAggregator — public interface alias.

Re-exports CandleAggregator and Candle from candle_fetcher
so strategy code can import from either module.

Usage:
    from app.engine.candle_aggregator import CandleAggregator, Candle
    from app.engine.candle_fetcher    import CandleAggregator, Candle  # same
"""
from app.engine.candle_fetcher import (  # noqa: F401
    Candle,
    CandleAggregator,
    CandleStore,
    candle_store,
)

__all__ = ["Candle", "CandleAggregator", "CandleStore", "candle_store"]
