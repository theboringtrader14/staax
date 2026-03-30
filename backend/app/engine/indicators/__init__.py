"""Indicator strategy classes for STAAX bot engine."""
from dataclasses import dataclass
from typing import Optional

@dataclass
class Signal:
    """A trading signal emitted by a strategy."""
    type:      str    # 'entry' | 'exit'
    direction: str    # 'buy'   | 'sell'
    price:     float
    reason:    str    # 'L1' | 'S1' | 'CHANNEL_LONG' | 'CHANNEL_EXIT' | 'CHANNEL_SHORT'
