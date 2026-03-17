"""
Strike Selector — selects the correct F&O strike at entry time.
Supports: ATM, ITM1–ITM10, OTM1–OTM10, Premium, Straddle Premium.
Delta-based selection: Phase 2.

Strike multiples: NIFTY=50, BANKNIFTY=100, SENSEX=100,
                  MIDCAPNIFTY=25, FINNIFTY=50

Broker-agnostic: accepts any BaseBroker (Zerodha or Angel One).
Normalises both broker option chain formats into a flat instrument list.
"""
import logging
from typing import Optional, List, Dict
from app.brokers.base import BaseBroker

logger = logging.getLogger(__name__)

STRIKE_MULTIPLES = {
    "NIFTY":       50,
    "BANKNIFTY":   100,
    "SENSEX":      100,
    "MIDCAPNIFTY": 25,
    "FINNIFTY":    50,
}


class StrikeSelector:

    def __init__(self, broker: BaseBroker):
        self.broker = broker

    async def select(
        self,
        underlying: str,
        instrument_type: str,        # "ce" or "pe"
        expiry: str,                 # "2024-02-29"
        strike_type: str,            # "atm", "itm3", "otm2", "premium", "straddle_premium"
        strike_value: Optional[float] = None,
        broker: Optional[BaseBroker] = None,
    ) -> Optional[Dict]:
        """
        Select the appropriate strike at the current moment.
        Returns the full instrument dict normalised for the engine.

        broker: optional per-call override — pass the account's broker so the
                correct option chain and LTP source is used.
        """
        active_broker = broker or self.broker
        spot     = await active_broker.get_underlying_ltp(underlying)
        multiple = STRIKE_MULTIPLES.get(underlying.upper(), 50)

        raw_chain   = await active_broker.get_option_chain(underlying, expiry)
        instruments = self._normalize_chain(raw_chain)
        opt_type    = instrument_type.upper()  # "CE" or "PE"
        filtered    = [i for i in instruments if i["instrument_type"] == opt_type]

        if not filtered:
            logger.error(f"No {opt_type} instruments for {underlying} {expiry}")
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
            logger.error(f"No instrument at strike {target}")
        return match

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

    async def _by_premium(
        self, instruments: List[Dict], target: float, broker: BaseBroker
    ) -> Optional[Dict]:
        symbols = [f"NFO:{i['tradingsymbol']}" for i in instruments]
        ltps    = await broker.get_ltp(symbols)
        best, best_diff = None, float("inf")
        for inst in instruments:
            ltp  = ltps.get(f"NFO:{inst['tradingsymbol']}", 0)
            diff = abs(ltp - target)
            if diff < best_diff:
                best_diff, best = diff, inst
        return best

    async def _by_straddle_premium(
        self,
        instruments: List[Dict],
        atm: float,
        multiple: int,
        target: float,
        broker: BaseBroker,
    ) -> Optional[Dict]:
        best_strike, best_diff = None, float("inf")
        for offset in range(-2, 3):
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
            ltps = await broker.get_ltp(
                [f"NFO:{ce['tradingsymbol']}", f"NFO:{pe['tradingsymbol']}"]
            )
            combined = (
                ltps.get(f"NFO:{ce['tradingsymbol']}", 0)
                + ltps.get(f"NFO:{pe['tradingsymbol']}", 0)
            )
            diff = abs(combined - target)
            if diff < best_diff:
                best_diff, best_strike = diff, strike
        return next(
            (i for i in instruments if i["strike"] == best_strike and i["instrument_type"] == "CE"),
            None,
        )
