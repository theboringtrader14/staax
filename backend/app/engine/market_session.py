"""Shared market session time gates — single source of truth for all engines."""
from datetime import datetime as _dt, time as _time
try:
    from zoneinfo import ZoneInfo as _ZI
    _IST = _ZI("Asia/Kolkata")
except ImportError:
    import pytz as _pytz
    _IST = _pytz.timezone("Asia/Kolkata")


def is_sl_check_allowed() -> bool:
    """SL/TP/TSL/TTP/MTM checks: 09:18–15:30 IST (strict post-open window)."""
    now = _dt.now(_IST).time()
    return now > _time(9, 18) and now <= _time(15, 30)


def is_market_open() -> bool:
    """General NSE market hours: 09:15–15:30 IST."""
    now = _dt.now(_IST).time()
    return _time(9, 15) <= now <= _time(15, 30)


def is_mcx_open() -> bool:
    """MCX market hours: 09:00–23:30 IST."""
    now = _dt.now(_IST).time()
    return _time(9, 0) <= now <= _time(23, 30)


def is_pre_market() -> bool:
    """Pre-market window: 08:45–09:15 IST."""
    now = _dt.now(_IST).time()
    return _time(8, 45) <= now < _time(9, 15)
