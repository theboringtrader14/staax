#!/usr/bin/env python3
"""
find_mcx_contract.py — Search instrument master cache for active MCX futures.

Run from ~/STAXX/staax/backend/:
    python3 scripts/find_mcx_contract.py

Used before contract rollover to find the next month's token.
Update MCX_TOKENS in bot_runner.py and MCX_CONTRACT_SCHEDULE in mcx_holidays.py.
"""
import json
import sys
from datetime import datetime
from pathlib import Path


def parse_expiry(s: str):
    """Parse MCX expiry string DDMMMYYYY (e.g. '05MAY2026') → datetime for sorting."""
    try:
        return datetime.strptime(s.upper(), "%d%b%Y")
    except ValueError:
        return datetime.max

CACHE = Path(__file__).parent.parent / "instrument_master_cache.json"

if not CACHE.exists():
    print(f"ERROR: instrument master cache not found at {CACHE}", file=sys.stderr)
    print("Trigger a download by calling broker.get_instrument_master() once.", file=sys.stderr)
    sys.exit(1)

data = json.loads(CACHE.read_text())
print(f"Loaded {len(data):,} instruments from cache\n")

CURRENT_EXPIRY = "03Apr2026"   # update this to current contract expiry before running
_cutoff = parse_expiry(CURRENT_EXPIRY)

for base_symbol in ["GOLDM", "SILVERMIC"]:
    futures = [
        x for x in data
        if x.get("exch_seg") == "MCX"
        and str(x.get("symbol", "")).startswith(base_symbol)
        and "FUT" in str(x.get("symbol", ""))
        and parse_expiry(x.get("expiry", "")) > _cutoff
    ]
    futures.sort(key=lambda x: parse_expiry(x.get("expiry", "")))

    print(f"{'─'*60}")
    print(f"{base_symbol} MCX futures after {CURRENT_EXPIRY}:")
    if not futures:
        print("  (none found — cache may be stale)")
    for f in futures[:5]:
        flag = "  ← NEXT (rollover to this)" if f == futures[0] else ""
        print(
            f"  token={f.get('token'):<12}"
            f"  symbol={f.get('symbol'):<28}"
            f"  expiry={f.get('expiry')}"
            f"{flag}"
        )
print()
print("Next steps:")
print("  1. Update MCX_TOKENS in backend/app/engine/bot_runner.py")
print("  2. Update MCX_CONTRACT_SCHEDULE in backend/app/core/mcx_holidays.py")
print("  3. Restart backend — SmartStream will subscribe to new token on next login")
