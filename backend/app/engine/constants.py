"""Engine-level constants."""

# Angel One freeze quantities (max qty per order slice)
# Source: Angel One API documentation + NSE circular
FREEZE_QTY_MAP: dict[str, int] = {
    "NIFTY":       1800,
    "BANKNIFTY":    900,
    "SENSEX":       500,
    "MIDCAPNIFTY": 3600,
    "FINNIFTY":    2100,
    "GOLDM":        100,
    "SILVERMIC":    100,
    "CRUDEOILM":    100,
    "NATURALGAS":  1250,
}

DEFAULT_FREEZE_QTY = 1800  # Default to NIFTY freeze qty
