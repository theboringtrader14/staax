"""
ExpiryMonitor — handles automatic futures contract rollover.
Rule: if current contract expiry is <= 5 market days away, rollover to next contract.
Runs daily at market open check (09:10 IST via scheduler).
"""
import logging
from datetime import date, timedelta
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")
logger = logging.getLogger(__name__)

MARKET_HOLIDAYS_2026 = {
    date(2026, 1, 26), date(2026, 3, 25), date(2026, 4, 2),
    date(2026, 4, 6),  date(2026, 4, 14), date(2026, 5, 1),
    date(2026, 8, 15), date(2026, 10, 2), date(2026, 10, 21),
    date(2026, 10, 22), date(2026, 11, 5), date(2026, 12, 25),
}

def is_market_day(d: date) -> bool:
    return d.weekday() < 5 and d not in MARKET_HOLIDAYS_2026

def market_days_until(expiry: date) -> int:
    """Count market days from today until expiry."""
    today = date.today()
    count = 0
    d = today
    while d < expiry:
        d += timedelta(days=1)
        if is_market_day(d):
            count += 1
    return count

def parse_expiry(expiry_str: str) -> date:
    """Parse expiry string like '2026-03' to last Thursday of that month."""
    year, month = map(int, expiry_str.split('-'))
    # Find last Thursday of month
    if month == 12:
        next_month = date(year + 1, 1, 1)
    else:
        next_month = date(year, month + 1, 1)
    last_day = next_month - timedelta(days=1)
    while last_day.weekday() != 3:  # 3 = Thursday
        last_day -= timedelta(days=1)
    return last_day

def next_expiry(expiry_str: str) -> str:
    """Get next month expiry string."""
    year, month = map(int, expiry_str.split('-'))
    if month == 12:
        return f"{year+1}-01"
    return f"{year}-{month+1:02d}"

def needs_rollover(expiry_str: str, threshold_days: int = 5) -> bool:
    """Returns True if contract needs rollover."""
    try:
        expiry_date = parse_expiry(expiry_str)
        days_left = market_days_until(expiry_date)
        if days_left <= threshold_days:
            logger.info(f"[EXPIRY] {expiry_str} has {days_left} market days left — rollover needed")
            return True
        return False
    except Exception as e:
        logger.error(f"[EXPIRY] Error checking rollover for {expiry_str}: {e}")
        return False
