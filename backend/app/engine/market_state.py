"""
MarketState — centralized market data store.
SmartStream updates this. All engine components read from this.
Single source of truth for LTP, tick freshness, instrument state.
"""

import time as _time
from typing import Optional, Dict
import pytz as _pytz
from datetime import datetime as _dt

_IST = _pytz.timezone('Asia/Kolkata')


class MarketState:
    def __init__(self):
        self._ltp: Dict[int, float] = {}
        self._last_update: Dict[int, float] = {}
        self._session_active: bool = False
        self._feed_connected: bool = False
        self._feed_last_tick: Optional[float] = None

    # ── Write (called by SmartStream only) ──
    def update_ltp(self, token: int, price: float) -> None:
        self._ltp[token] = price
        now = _time.monotonic()
        self._last_update[token] = now
        self._feed_last_tick = now

    # ── Read (called by all engine components) ──
    def get_ltp(self, token: int) -> Optional[float]:
        return self._ltp.get(token)

    def get_tick_age(self, token: int) -> Optional[float]:
        last = self._last_update.get(token)
        return (_time.monotonic() - last) if last else None

    def get_feed_age(self) -> Optional[float]:
        return (_time.monotonic() - self._feed_last_tick) if self._feed_last_tick else None

    def is_data_fresh(self, max_age_seconds: float = 30.0) -> bool:
        age = self.get_feed_age()
        return age is not None and age < max_age_seconds

    def set_feed_connected(self, connected: bool) -> None:
        self._feed_connected = connected

    def is_feed_connected(self) -> bool:
        return self._feed_connected

    def all_ltps(self) -> Dict[int, float]:
        return dict(self._ltp)

    def snapshot(self) -> dict:
        return {
            "feed_connected": self._feed_connected,
            "feed_age_ms": round((self.get_feed_age() or 0) * 1000),
            "token_count": len(self._ltp),
            "is_fresh": self.is_data_fresh(),
        }


# Singleton
market_state = MarketState()
