"""
Re-entry Engine — manages all three re-entry modes.
AT_ENTRY_PRICE: checks every 1-min candle close.
IMMEDIATE: re-runs entry logic immediately.
AT_COST: watches for LTP to return to original entry price.
Supports Journey hierarchy (1.1, 1.2, 2.1...) with per-level configs.
Max count: 5 per day.
"""
# TODO: Implement in Phase 1D
class ReentryEngine:
    """Manages post-exit re-entry logic for all three modes."""
    pass
