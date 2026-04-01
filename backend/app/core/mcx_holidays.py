"""
MCX trading holidays for 2026.

Source: Verify against the official MCX circular before going live.
  https://www.mcxindia.com/market-operations/market-timings/holidays

MCX sessions (IST):
  Morning : 09:00 – 11:30
  Evening : 15:30 – 23:30
"""

MCX_HOLIDAYS_2026 = [
    "2026-01-26",   # Republic Day
    "2026-03-25",   # Holi
    "2026-04-02",   # Ram Navami
    "2026-04-03",   # Good Friday
    "2026-04-14",   # Dr. Ambedkar Jayanti
    "2026-05-01",   # Maharashtra Day / May Day
    "2026-08-15",   # Independence Day
    "2026-10-02",   # Gandhi Jayanti / Dussehra
    "2026-10-20",   # Diwali (Laxmi Puja) — verify exact date
    "2026-11-03",   # Guru Nanak Jayanti — verify exact date
    "2026-12-25",   # Christmas
]


# ── MCX contract expiry warnings ──────────────────────────────────────────────
# Keep in sync with MCX_TOKENS in bot_runner.py whenever tokens are rolled over.
from datetime import date as _date  # noqa: E402

MCX_CONTRACT_SCHEDULE: dict = {
    "GOLDM": {
        "token":       477904,
        "expiry_date": _date(2026, 4, 3),    # GOLDM03APR26FUT
        "next_month":  "May 2026 (~GOLDM05MAY26FUT, token 487819)",
    },
    "SILVERMIC": {
        "token":       466029,
        "expiry_date": _date(2026, 4, 30),   # SILVERMIC30APR26FUT
        "next_month":  "May 2026 (~SILVERMIC29MAY26FUT)",
    },
}

EXPIRY_WARN_DAYS = 3


def check_mcx_expiry_warnings() -> list:
    """
    Returns warning strings for any MCX contract expiring within EXPIRY_WARN_DAYS.
    Call once at startup; log each string as WARNING.
    """
    today = _date.today()
    warnings = []
    for symbol, info in MCX_CONTRACT_SCHEDULE.items():
        days_left = (info["expiry_date"] - today).days
        if days_left <= EXPIRY_WARN_DAYS:
            if days_left < 0:
                urgency = f"EXPIRED {-days_left} day(s) ago"
            elif days_left == 0:
                urgency = "EXPIRES TODAY"
            else:
                urgency = f"expires in {days_left} day(s) ({info['expiry_date']})"
            warnings.append(
                f"⚠️  MCX {symbol} (token {info['token']}) {urgency} — "
                f"update MCX_TOKENS in bot_runner.py. "
                f"Next: {info['next_month']}"
            )
    return warnings
