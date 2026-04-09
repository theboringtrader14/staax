"""
Strike Selector — selects the correct F&O strike at entry time.
Supports: ATM, ITM1–ITM10, OTM1–OTM10, Premium, Straddle Premium.
Delta-based selection: Phase 2.

Strike multiples: NIFTY=50, BANKNIFTY=100, SENSEX=100,
                  MIDCAPNIFTY=25, FINNIFTY=50

Broker-agnostic: accepts any BaseBroker (Zerodha or Angel One).
Normalises both broker option chain formats into a flat instrument list.
"""
import calendar
import logging
from datetime import date, datetime, timedelta
from typing import Optional, List, Dict
from zoneinfo import ZoneInfo
from app.brokers.base import BaseBroker

IST = ZoneInfo("Asia/Kolkata")

logger = logging.getLogger(__name__)

STRIKE_MULTIPLES = {
    "NIFTY":       50,
    "BANKNIFTY":   100,
    "SENSEX":      100,
    "MIDCAPNIFTY": 25,
    "FINNIFTY":    50,
    # MCX commodity futures
    "GOLDM":       100,
    "GOLD":        100,
    "SILVERM":     1000,
    "CRUDEOIL":    100,
}

# MCX commodity underlyings — use futures (FUTCOM) path, not CE/PE options.
# These expire on the last working day of the contract month.
MCX_FUTURES = {"GOLDM", "GOLD", "SILVERM", "CRUDEOIL"}

# Weekday of (weekly) expiry for each underlying (Monday=0, Sunday=6).
# Used by _resolve_expiry() to produce an approximate ISO date.
# Angel One's get_option_chain() has a nearest-future-expiry fallback,
# so this only needs to be approximately correct.
#
# NSE changed expiry days in Nov 2024:
#   NIFTY weekly    → Tuesday
#   BANKNIFTY       → monthly only (last Tuesday of month)
#   FINNIFTY        → monthly only (last Tuesday of month)
#   MIDCAPNIFTY     → monthly only (last Monday of month)
#   SENSEX (BSE)    → Thursday
EXPIRY_WEEKDAY = {
    "NIFTY":       1,  # Tuesday
    "BANKNIFTY":   1,  # Tuesday (monthly — fallback handles this)
    "FINNIFTY":    1,  # Tuesday (monthly — fallback handles this)
    "MIDCAPNIFTY": 0,  # Monday  (monthly — fallback handles this)
    "SENSEX":      3,  # Thursday
}


class StrikeSelector:

    def __init__(self, broker: BaseBroker):
        self.broker = broker

    async def select(
        self,
        underlying: str,
        instrument_type: str,        # "ce" or "pe"
        expiry: str,                 # "current_weekly" | "next_weekly" | "current_monthly" | "next_monthly" | "YYYY-MM-DD"
        strike_type: str,            # "atm", "itm3", "otm2", "premium", "straddle_premium"
        strike_value: Optional[float] = None,
        broker: Optional[BaseBroker] = None,
        dte: Optional[int] = None,   # positional: Nth nearest monthly expiry (1-indexed)
    ) -> Optional[Dict]:
        """
        Select the appropriate strike at the current moment.
        Returns the full instrument dict normalised for the engine.

        broker: optional per-call override — pass the account's broker so the
                correct option chain and LTP source is used.
        """
        active_broker = broker or self.broker

        # ── MCX Futures path (GOLDM, GOLD, SILVERM, CRUDEOIL) ────────────────
        # Futures have no CE/PE distinction — select nearest upcoming FUTCOM contract.
        if underlying.upper() in MCX_FUTURES and instrument_type.lower() == "fu":
            return await self._select_mcx_futures(underlying, active_broker)

        # Resolve logical expiry labels ("current_weekly" etc.) to ISO date "YYYY-MM-DD"
        expiry_resolved = self._resolve_expiry(underlying, expiry, dte=dte)

        spot     = await active_broker.get_underlying_ltp(underlying)
        multiple = STRIKE_MULTIPLES.get(underlying.upper(), 50)

        logger.info(
            f"[STRIKE] select start — underlying={underlying} type={instrument_type.upper()} "
            f"expiry_label={expiry} expiry_resolved={expiry_resolved} "
            f"strike_type={strike_type} spot={spot}"
        )

        if spot == 0.0:
            logger.error(
                f"[STRIKE] Underlying LTP is 0 for {underlying} — broker may not be logged in"
            )
            return None

        raw_chain   = await active_broker.get_option_chain(underlying, expiry_resolved)
        instruments = self._normalize_chain(raw_chain)
        opt_type    = instrument_type.upper()  # "CE" or "PE"
        filtered    = [i for i in instruments if i["instrument_type"] == opt_type]

        logger.info(
            f"[STRIKE] chain={len(instruments)} instruments, "
            f"filtered {opt_type}={len(filtered)}"
            + (f", sample={instruments[0]}" if instruments else "")
        )

        if not filtered:
            logger.error(
                f"[STRIKE] No {opt_type} instruments for {underlying} expiry={expiry_resolved} "
                f"(raw chain keys={len(raw_chain)})"
            )
            return None

        atm_strike = round(spot / multiple) * multiple

        if strike_type.lower() == "atm":
            target = atm_strike

        elif strike_type.lower().startswith("itm"):
            n = int(strike_type[3:])  # "itm3" → 3
            target = atm_strike - (n * multiple) if opt_type == "CE" else atm_strike + (n * multiple)

        elif strike_type.lower().startswith("otm"):
            n = int(strike_type[3:])  # "otm2" → 2
            target = atm_strike + (n * multiple) if opt_type == "CE" else atm_strike - (n * multiple)

        elif strike_type.lower() == "premium":
            return await self._by_premium(filtered, strike_value or 0, active_broker)

        elif strike_type.lower() == "straddle_premium":
            return await self._by_straddle_premium(
                instruments, atm_strike, multiple, strike_value or 0, active_broker
            )

        else:
            logger.error(f"Unknown strike type: {strike_type}")
            return None

        match = next((i for i in filtered if i["strike"] == target), None)
        if not match:
            logger.error(
                f"[STRIKE] No instrument at strike {target} for {underlying} {opt_type} "
                f"expiry={expiry_resolved} — available strikes: "
                f"{sorted({i['strike'] for i in filtered})[:10]}"
            )
        else:
            logger.info(f"[STRIKE] ✅ Selected {match['tradingsymbol']} strike={target}")
        return match

    @staticmethod
    def _resolve_expiry(underlying: str, expiry: str, dte: Optional[int] = None) -> str:
        """
        Convert logical expiry labels to ISO date strings.

        Labels: "current_weekly", "next_weekly", "current_monthly", "next_monthly"
        Passthrough: ISO dates like "2026-03-27" or unknown strings.

        dte (Days to Expiry — positional mode):
            When provided, overrides expiry label and returns the Nth nearest
            upcoming monthly expiry for this underlying, where N = dte (1-indexed).
            dte=1 → nearest future monthly expiry
            dte=2 → the one after that, etc.
        """
        today = date.today()
        wd = EXPIRY_WEEKDAY.get(underlying.upper(), 3)  # default Thursday

        # ── DTE override (positional mode) ────────────────────────────────────
        if dte is not None and dte >= 1:
            # Generate upcoming monthly expiries (up to 24 months ahead)
            upcoming: List[str] = []
            y, m = today.year, today.month
            for _ in range(24):
                exp_str  = StrikeSelector._last_weekday_of_month(y, m, wd)
                exp_date = date.fromisoformat(exp_str)
                if exp_date > today:
                    upcoming.append(exp_str)
                if len(upcoming) >= dte:
                    break
                m += 1
                if m > 12:
                    m = 1
                    y += 1
            if upcoming and 1 <= dte <= len(upcoming):
                resolved = upcoming[dte - 1]
                logger.info(f"[STRIKE] DTE={dte} resolved to monthly expiry {resolved} for {underlying}")
                return resolved
            logger.warning(f"[STRIKE] DTE={dte} could not resolve expiry for {underlying} — falling through to label")

        if expiry not in ("current_weekly", "next_weekly", "current_monthly", "next_monthly"):
            return expiry

        days_ahead = (wd - today.weekday()) % 7
        # If today IS expiry day, only skip to next week after 15:20 IST.
        # Before 15:20, today's expiry is still valid and tradeable.
        if days_ahead == 0:
            now_ist = datetime.now(IST)
            market_near_close = now_ist.replace(hour=15, minute=20, second=0, microsecond=0)
            if now_ist >= market_near_close:
                days_ahead = 7
            # else: before 15:20 — days_ahead stays 0, resolves to today

        if expiry == "current_weekly":
            return (today + timedelta(days=days_ahead)).isoformat()

        if expiry == "next_weekly":
            return (today + timedelta(days=days_ahead + 7)).isoformat()

        if expiry == "current_monthly":
            return StrikeSelector._last_weekday_of_month(today.year, today.month, wd)

        # next_monthly
        if today.month == 12:
            return StrikeSelector._last_weekday_of_month(today.year + 1, 1, wd)
        return StrikeSelector._last_weekday_of_month(today.year, today.month + 1, wd)

    @staticmethod
    def _last_weekday_of_month(year: int, month: int, weekday: int) -> str:
        """Return ISO date of the last occurrence of <weekday> in <year>/<month>."""
        last_day  = calendar.monthrange(year, month)[1]
        last_date = date(year, month, last_day)
        days_back = (last_date.weekday() - weekday) % 7
        return (last_date - timedelta(days=days_back)).isoformat()

    async def _select_mcx_futures(
        self, underlying: str, broker: BaseBroker
    ) -> Optional[Dict]:
        """
        Select the nearest upcoming MCX futures contract (FUTCOM).
        MCX instruments expire on the last working day of the contract month.
        Calls get_option_chain() with an empty expiry string so the broker
        returns all available contracts for this underlying.
        """
        try:
            raw_chain = await broker.get_option_chain(underlying, "")
        except Exception as e:
            logger.error(f"[STRIKE] MCX get_option_chain failed for {underlying}: {e}")
            return None

        instruments = self._normalize_chain(raw_chain)

        # Filter: FUTCOM instruments whose symbol starts with the underlying name
        futures = [
            i for i in instruments
            if i.get("instrument_type", "").upper() == "FUTCOM"
            and i.get("tradingsymbol", "").upper().startswith(underlying.upper())
        ]

        if not futures:
            logger.error(
                f"[STRIKE] No FUTCOM instruments found for {underlying} "
                f"(total chain size={len(instruments)})"
            )
            return None

        # Select nearest upcoming expiry by comparing expiry_date fields
        today    = date.today()
        nearest  = None
        nearest_date: Optional[date] = None

        for inst in futures:
            raw_exp = inst.get("expiry_date") or inst.get("expiry") or ""
            try:
                exp_date = date.fromisoformat(str(raw_exp)[:10])
            except (ValueError, TypeError):
                continue
            if exp_date >= today:
                if nearest_date is None or exp_date < nearest_date:
                    nearest_date = exp_date
                    nearest = inst

        if nearest:
            logger.info(
                f"[STRIKE] ✅ MCX futures selected {nearest.get('tradingsymbol')} "
                f"expiry={nearest_date}"
            )
        else:
            logger.error(
                f"[STRIKE] No upcoming FUTCOM contract found for {underlying} "
                f"(checked {len(futures)} contracts)"
            )
        return nearest

    @staticmethod
    def _normalize_chain(raw_chain: dict) -> List[Dict]:
        """
        Normalise option chain to a flat list of instrument dicts.

        Zerodha format:   {"instruments": [list of kiteconnect instrument dicts]}
        Angel One format: {strike_int: {"CE": {symbol, token, ...}, "PE": {...}}}
        """
        if "instruments" in raw_chain:
            # Zerodha — already a flat list
            return raw_chain["instruments"]

        # Angel One — pivot from strike-keyed dict to flat list
        instruments = []
        for strike, opts in raw_chain.items():
            for opt_type, info in opts.items():
                token_raw = info.get("token", "")
                try:
                    token_int = int(token_raw)
                except (ValueError, TypeError):
                    token_int = 0
                instruments.append({
                    "tradingsymbol":    info.get("symbol", ""),
                    "instrument_token": token_int,
                    "instrument_type":  opt_type,       # "CE" or "PE"
                    "strike":           int(strike),
                    "last_price":       0.0,
                    "lot_size":         info.get("lot_size", 1),
                    "exchange":         info.get("exchange", "NFO"),
                })
        return instruments

    @staticmethod
    async def _get_ltp_for_instrument(inst: Dict, broker: BaseBroker) -> float:
        """
        Fetch LTP for a single instrument, using token-aware path when available.

        Angel One's get_ltp() passes symboltoken="" which returns LTP=0.
        When the broker has get_ltp_by_token() (AngelOneBroker) AND the
        instrument has a non-zero instrument_token, use that method instead.
        This ensures the correct symboltoken is passed to ltpData().

        Falls back to broker.get_ltp() for Zerodha and any instrument without a token.
        """
        token     = inst.get("instrument_token", 0)
        exchange  = inst.get("exchange", "NFO")
        symbol    = inst.get("tradingsymbol", "")

        if token and hasattr(broker, "get_ltp_by_token"):
            ltp = await broker.get_ltp_by_token(exchange, symbol, str(token))
            if ltp and ltp > 0:
                return ltp
            logger.warning(
                f"[STRIKE] get_ltp_by_token returned 0 for {exchange}:{symbol} "
                f"token={token} — falling back to get_ltp()"
            )

        # Zerodha path or fallback
        key  = f"{exchange}:{symbol}"
        ltps = await broker.get_ltp([key])
        return ltps.get(key, 0.0)

    async def _by_premium(
        self, instruments: List[Dict], target: float, broker: BaseBroker
    ) -> Optional[Dict]:
        """
        Select the strike whose premium is closest to target but >= target.
        Falls back to closest overall if no strike meets the minimum threshold.
        """
        best_above: Optional[Dict] = None
        best_above_excess          = float("inf")   # how much above target
        best_any:   Optional[Dict] = None
        best_any_diff              = float("inf")
        best_any_ltp               = 0.0

        for inst in instruments:
            ltp  = await self._get_ltp_for_instrument(inst, broker)
            diff = abs(ltp - target)
            if diff < best_any_diff:
                best_any_diff, best_any, best_any_ltp = diff, inst, ltp
            if ltp >= target:
                excess = ltp - target
                if excess < best_above_excess:
                    best_above_excess, best_above = excess, inst

        if best_above:
            logger.info(
                f"[STRIKE] _by_premium target={target} → "
                f"{best_above.get('tradingsymbol')} ltp={target + best_above_excess:.2f} "
                f"(excess={best_above_excess:.2f})"
            )
            return best_above

        # No strike at or above target — fall back to closest
        logger.warning(
            f"[STRIKE] No strike found at or above target premium {target} — "
            f"using closest available {best_any.get('tradingsymbol') if best_any else None} "
            f"ltp={best_any_ltp:.2f}"
        )
        return best_any

    async def _by_straddle_premium(
        self,
        instruments: List[Dict],
        atm: float,
        multiple: int,
        target: float,
        broker: BaseBroker,
    ) -> Optional[Dict]:
        """
        Find strike where combined CE+PE premium is closest to target.
        Searches ±5 strikes from ATM (expanded from ±2).
        """
        best_strike, best_diff = None, float("inf")
        for offset in range(-5, 6):   # ±5 strikes
            strike = atm + (offset * multiple)
            ce = next(
                (i for i in instruments if i["strike"] == strike and i["instrument_type"] == "CE"),
                None,
            )
            pe = next(
                (i for i in instruments if i["strike"] == strike and i["instrument_type"] == "PE"),
                None,
            )
            if not ce or not pe:
                continue
            ce_ltp = await self._get_ltp_for_instrument(ce, broker)
            pe_ltp = await self._get_ltp_for_instrument(pe, broker)
            combined = ce_ltp + pe_ltp
            diff = abs(combined - target)
            if diff < best_diff:
                best_diff, best_strike = diff, strike

        if best_strike is None:
            logger.warning(
                f"[STRIKE] Straddle target {target} not found within ±5 strikes of ATM {atm} "
                f"— no valid CE+PE pair found"
            )
            return None

        logger.info(
            f"[STRIKE] _by_straddle_premium target={target} → strike={best_strike} "
            f"combined_diff={best_diff:.2f}"
        )
        return next(
            (i for i in instruments if i["strike"] == best_strike and i["instrument_type"] == "CE"),
            None,
        )
