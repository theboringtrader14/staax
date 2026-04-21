"""
ExpiryCalendar — builds expiry date lists from Angel One instrument master.
Refreshed daily at startup. No hardcoded expiry days — fetched from master.
"""
import logging
from datetime import date, datetime
from typing import Optional
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)
IST = ZoneInfo("Asia/Kolkata")

_instance = None


class ExpiryCalendar:
    def __init__(self):
        self._expiries: dict[str, list[date]] = {}
        self._built_on: Optional[date] = None

    @classmethod
    def get(cls) -> "ExpiryCalendar":
        global _instance
        if _instance is None:
            _instance = cls()
        return _instance

    async def build_from_master(self, master_rows: list[dict]) -> None:
        """
        Build expiry calendar from Angel One instrument master rows.
        master_rows: list of dicts with keys like: name, expiry, instrumenttype, exch_seg
        """
        expiry_map: dict[str, set[date]] = {}
        name_map = {
            "NIFTY": "NIFTY",
            "BANKNIFTY": "BANKNIFTY",
            "SENSEX": "SENSEX",
            "MIDCPNIFTY": "MIDCPNIFTY",
            "FINNIFTY": "FINNIFTY",
            "BANKEX": "BANKEX",
        }

        for row in master_rows:
            if row.get("instrumenttype") not in ("OPTIDX", "FUTIDX", "OPTSTK", "OPTFUT"):
                continue
            name = row.get("name", "").upper().strip()
            underlying = name_map.get(name)
            if not underlying:
                continue
            expiry_raw = row.get("expiry", "")
            if not expiry_raw:
                continue
            try:
                if isinstance(expiry_raw, str) and len(expiry_raw) == 9:
                    exp_date = datetime.strptime(expiry_raw, "%d%b%Y").date()
                elif isinstance(expiry_raw, str) and len(expiry_raw) >= 10:
                    exp_date = datetime.fromisoformat(expiry_raw[:10]).date()
                else:
                    continue
            except Exception:
                continue
            expiry_map.setdefault(underlying, set()).add(exp_date)

        self._expiries = {k: sorted(v) for k, v in expiry_map.items()}
        self._built_on = date.today()
        logger.info(
            f"[EXPIRY] Calendar built on {self._built_on}: "
            + str({k: f"{len(v)} expiries" for k, v in self._expiries.items()})
        )

    def is_expiry_today(self, underlying: str, today: Optional[date] = None) -> bool:
        today = today or date.today()
        return today in self._expiries.get(underlying.upper(), [])

    def get_current_weekly_expiry(self, underlying: str, today: Optional[date] = None) -> Optional[date]:
        today = today or date.today()
        expiries = self._expiries.get(underlying.upper(), [])
        weekly = [e for e in expiries if 0 <= (e - today).days <= 8]
        return weekly[0] if weekly else None

    def get_next_weekly_expiry(self, underlying: str, today: Optional[date] = None) -> Optional[date]:
        today = today or date.today()
        current = self.get_current_weekly_expiry(underlying, today)
        if not current:
            return None
        expiries = self._expiries.get(underlying.upper(), [])
        future = [e for e in expiries if (e - today).days > 8]
        return future[0] if future else None

    def get_current_monthly_expiry(self, underlying: str, today: Optional[date] = None) -> Optional[date]:
        today = today or date.today()
        expiries = self._expiries.get(underlying.upper(), [])
        this_month = [e for e in expiries if e.year == today.year and e.month == today.month]
        return max(this_month) if this_month else None

    def is_built(self) -> bool:
        return self._built_on is not None and bool(self._expiries)


def _parse_underlying_from_symbol(symbol: str) -> Optional[str]:
    """Extract underlying from option symbol. E.g. 'NIFTY21APR2624450CE' -> 'NIFTY'"""
    symbol = symbol.upper()
    for underlying in ['BANKNIFTY', 'MIDCPNIFTY', 'FINNIFTY', 'NIFTY', 'SENSEX', 'BANKEX']:
        if symbol.startswith(underlying):
            return underlying
    return None
