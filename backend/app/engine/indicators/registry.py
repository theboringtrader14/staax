"""
Indicator Registry — plug-and-play system for adding new indicators.

To add a new indicator (e.g. YTR):
1. Create ytr_strategy.py implementing BaseIndicatorAdapter
2. Add one line to INDICATOR_REGISTRY below
Done.
"""
from abc import ABC, abstractmethod
from typing import Optional
from dataclasses import dataclass


@dataclass
class IndicatorBands:
    upper: Optional[float]
    lower: Optional[float]
    mid:   Optional[float] = None


class BaseIndicatorAdapter(ABC):
    """Standard interface every indicator must implement."""

    @abstractmethod
    def reset(self) -> None:
        """Reset internal state — called before replaying historical candles."""
        pass

    @abstractmethod
    def on_candle(self, candle) -> None:
        """Feed one candle. Returns nothing — use bands property."""
        pass

    @property
    @abstractmethod
    def bands(self) -> Optional[IndicatorBands]:
        """Current band values after on_candle. None if not enough data yet."""
        pass


# ── Adapters ──────────────────────────────────────────────────────────────────

class ChannelAdapter(BaseIndicatorAdapter):
    """Wraps ChannelStrategy. Exposes upper_channel / lower_channel."""

    def __init__(self, **kwargs):
        from app.engine.indicators.channel_strategy import ChannelStrategy
        self._s = ChannelStrategy(**kwargs)

    def reset(self) -> None:
        from app.engine.indicators.channel_strategy import ChannelStrategy
        self._s = ChannelStrategy()

    def on_candle(self, candle) -> None:
        self._s.on_candle(candle)

    @property
    def bands(self) -> Optional[IndicatorBands]:
        u = self._s.upper_channel
        l = self._s.lower_channel
        if u is None or l is None:
            return None
        return IndicatorBands(upper=u, lower=l, mid=(u + l) / 2)


class DTRAdapter(BaseIndicatorAdapter):
    """
    Wraps DTRStrategy. Handles daily data seeding during historical replay:
    tracks previous day's OHLC so set_daily_data() always receives correct values.
    """

    def __init__(self, **kwargs):
        from app.engine.indicators.dtr_strategy import DTRStrategy
        self._s = DTRStrategy(**kwargs)
        self._reset_state()

    def _reset_state(self) -> None:
        self._prev_date = None
        # Previous day accumulated OHLC (fed to set_daily_data on day change)
        self._pd_open  = None
        self._pd_high  = None
        self._pd_low   = None
        self._pd_close = None
        # Current day accumulation
        self._cd_open  = None
        self._cd_high  = None
        self._cd_low   = None
        self._cd_close = None

    def reset(self) -> None:
        from app.engine.indicators.dtr_strategy import DTRStrategy
        self._s = DTRStrategy()
        self._reset_state()

    def on_candle(self, candle) -> None:
        candle_date = candle.ts.date() if hasattr(candle.ts, "date") else candle.ts

        if self._prev_date != candle_date:
            # Day boundary: feed previous day's OHLC into strategy if available
            if self._pd_open is not None:
                self._s.set_daily_data(
                    self._pd_open, self._pd_high, self._pd_low, self._pd_close
                )
            # Save current day's accumulated values as previous for next crossing
            self._pd_open  = self._cd_open
            self._pd_high  = self._cd_high
            self._pd_low   = self._cd_low
            self._pd_close = self._cd_close
            # Start fresh current-day tracking
            self._cd_open  = candle.open
            self._cd_high  = candle.high
            self._cd_low   = candle.low
            self._cd_close = candle.close
            self._prev_date = candle_date
        else:
            # Update current day OHLC
            if self._cd_open is None:
                self._cd_open = candle.open
            self._cd_high  = max(self._cd_high, candle.high) if self._cd_high is not None else candle.high
            self._cd_low   = min(self._cd_low,  candle.low)  if self._cd_low  is not None else candle.low
            self._cd_close = candle.close

        self._s.on_candle(candle)

    @property
    def bands(self) -> Optional[IndicatorBands]:
        u = self._s.upper_pivot
        l = self._s.lower_pivot
        if u is None or l is None:
            return None
        return IndicatorBands(upper=u, lower=l)


class TTBandsAdapter(BaseIndicatorAdapter):
    """Wraps TTBandsStrategy. Exposes highline / lowline."""

    def __init__(self, **kwargs):
        from app.engine.indicators.tt_bands_strategy import TTBandsStrategy
        self._s = TTBandsStrategy(**kwargs)

    def reset(self) -> None:
        from app.engine.indicators.tt_bands_strategy import TTBandsStrategy
        self._s = TTBandsStrategy()

    def on_candle(self, candle) -> None:
        self._s.on_candle(candle)

    @property
    def bands(self) -> Optional[IndicatorBands]:
        u = self._s.highline
        l = self._s.lowline
        if u is None or l is None:
            return None
        return IndicatorBands(upper=u, lower=l)


# ── Registry ──────────────────────────────────────────────────────────────────
# To add YTR: create YTRAdapter above, add one line below. Nothing else changes.

INDICATOR_REGISTRY: dict[str, type[BaseIndicatorAdapter]] = {
    "channel":  ChannelAdapter,
    "dtr":      DTRAdapter,
    "tt_bands": TTBandsAdapter,
}


def get_indicator(indicator_type: str, **kwargs) -> BaseIndicatorAdapter:
    cls = INDICATOR_REGISTRY.get(indicator_type.lower())
    if not cls:
        raise ValueError(
            f"Unknown indicator: {indicator_type!r}. "
            f"Available: {list(INDICATOR_REGISTRY)}"
        )
    return cls(**kwargs)
