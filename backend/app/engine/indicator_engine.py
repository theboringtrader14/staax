"""
IndicatorEngine — computes signals for DTR, Channel, and TT Bands strategies.
Translated from Pine Script to Python.
Signals: BUY | SELL | HOLD
"""
import logging
from typing import Optional, List
from app.engine.candle_fetcher import CandleAggregator, Candle

logger = logging.getLogger(__name__)


def _crossover(current: float, prev: float, level: float) -> bool:
    """close crosses above level (was below, now above)."""
    return prev < level <= current

def _crossunder(current: float, prev: float, level: float) -> bool:
    """close crosses below level (was above, now below)."""
    return prev > level >= current


def compute_dtr_signal(
    agg: CandleAggregator,
    daily_open: float,
    prev_high: float,
    prev_low: float,
) -> str:
    """
    DTR Strategy — Daily Trading Range.
    Uses previous day OHLC to compute pivot levels.
    Entry: close crossover UPP1  → BUY
    Exit:  close crossunder LPP1 → SELL

    UPP1 = dopen + (prev_range * 0.5589)
    LPP1 = dopen - (prev_range * 0.5589)
    """
    candles = agg.candles
    if len(candles) < 2:
        return "HOLD"

    PR   = prev_high - prev_low
    UPP1 = daily_open + PR * 0.5589
    LPP1 = daily_open - PR * 0.5589

    current_close = candles[-1].close
    prev_close    = candles[-2].close

    if _crossover(current_close, prev_close, UPP1):
        logger.info(f"[DTR] BUY signal — close {current_close:.2f} crossed above UPP1 {UPP1:.2f}")
        return "BUY"
    if _crossunder(current_close, prev_close, LPP1):
        logger.info(f"[DTR] SELL signal — close {current_close:.2f} crossed below LPP1 {LPP1:.2f}")
        return "SELL"
    return "HOLD"


def compute_channel_signal(
    agg: CandleAggregator,
    num_candles: int,
) -> str:
    """
    Channel Strategy — Highest High / Lowest Low channel.
    Entry: close > upper_channel → BUY
    Exit:  close < lower_channel → SELL
    """
    candles = agg.candles
    if len(candles) < num_candles + 1:
        return "HOLD"

    # Use previous num_candles bars (excluding current)
    prev_bars = candles[-(num_candles+1):-1]
    upper = max(b.high for b in prev_bars)
    lower = min(b.low  for b in prev_bars)

    current = candles[-1].close
    prev    = candles[-2].close if len(candles) >= 2 else current

    if _crossover(current, prev, upper):
        logger.info(f"[CHANNEL] BUY signal — close {current:.2f} crossed above upper {upper:.2f}")
        return "BUY"
    if _crossunder(current, prev, lower):
        logger.info(f"[CHANNEL] SELL signal — close {current:.2f} crossed below lower {lower:.2f}")
        return "SELL"
    return "HOLD"


def _fractal_high(candles: List[Candle], i: int) -> bool:
    if i < 2 or i >= len(candles) - 2:
        return False
    h = candles[i].high
    return (h > candles[i-1].high and h > candles[i+1].high and
            h > candles[i-2].high and h > candles[i+2].high)

def _fractal_low(candles: List[Candle], i: int) -> bool:
    if i < 2 or i >= len(candles) - 2:
        return False
    l = candles[i].low
    return (l < candles[i-1].low and l < candles[i+1].low and
            l < candles[i-2].low and l < candles[i+2].low)

def compute_tt_bands_signal(
    agg: CandleAggregator,
    lookback: int = 5,
) -> str:
    """
    TT Bands Strategy — Fractal-based dynamic support/resistance bands.
    highline = avg of last `lookback` fractal highs
    lowline  = avg of last `lookback` fractal lows
    Entry: close crossover highline  → BUY
    Exit:  close crossunder lowline  → SELL
    """
    candles = agg.candles
    if len(candles) < 10:
        return "HOLD"

    # Find fractal highs and lows
    frac_highs = []
    frac_lows  = []
    for i in range(2, len(candles) - 2):
        if _fractal_high(candles, i):
            frac_highs.append(candles[i].high)
        if _fractal_low(candles, i):
            frac_lows.append(candles[i].low)

    if len(frac_highs) < lookback or len(frac_lows) < lookback:
        return "HOLD"

    highline = sum(frac_highs[-lookback:]) / lookback
    lowline  = sum(frac_lows[-lookback:])  / lookback

    current = candles[-1].close
    prev    = candles[-2].close

    if _crossover(current, prev, highline):
        logger.info(f"[TT_BANDS] BUY signal — close {current:.2f} crossed above highline {highline:.2f}")
        return "BUY"
    if _crossunder(current, prev, lowline):
        logger.info(f"[TT_BANDS] SELL signal — close {current:.2f} crossed below lowline {lowline:.2f}")
        return "SELL"
    return "HOLD"
