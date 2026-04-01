#!/usr/bin/env python3
"""
export_seed_data.py — Export seed tables from local staax_db to SQL.

Exports in FK-safe order (parent tables before children):
  1. accounts       (no FK deps)
  2. algos          (FK → accounts)
  3. algo_legs      (FK → algos)
  4. market_holidays (no FK deps)

Skips all runtime tables: orders, grid_entries, execution_logs,
algo_states, bots, bot_orders, bot_signals, event_log, etc.

Uses explicit per-table column lists derived from the migration chain
(0001–0018). Columns added locally without a migration are never
auto-included, preventing import failures on the server.

Usage:
  python3 backend/scripts/export_seed_data.py

Output:
  ~/STAXX/db_exports/seed_data.sql

Import on server (run 'alembic upgrade head' on server first):
  psql -U staax -d staax_db < ~/seed_data.sql

NOTE: The SQL file contains credentials stored in the accounts table
(api_key, totp_secret). Treat the file as sensitive — delete from
server after import.
"""
import subprocess
import sys
from datetime import datetime
from pathlib import Path

DOCKER_CONTAINER = "staax_db"
DB_USER          = "staax"
DB_NAME          = "staax_db"

OUTPUT_DIR  = Path.home() / "STAXX" / "db_exports"
OUTPUT_FILE = OUTPUT_DIR / "seed_data.sql"

# Explicit column lists — derived from migration chain (0001–0018).
# Update these only when a new migration adds a column to a seed table.
# Never rely on SELECT * so that future local-only columns stay out of exports.
TABLE_COLUMNS = {
    "accounts": [
        # 0001 base
        "id", "nickname", "broker", "client_id", "api_key", "api_secret",
        "access_token", "token_generated_at", "status",
        "global_sl", "global_tp", "is_active", "created_at", "updated_at",
        # 0005
        "fy_brokerage",
        # 0009
        "feed_token",
        # 0018
        "totp_secret", "fy_margin",
    ],
    "algos": [
        # 0001 base
        "id", "name", "account_id", "strategy_mode", "entry_type", "order_type",
        "is_active", "entry_time", "exit_time", "orb_start_time", "orb_end_time",
        "next_day_exit_time", "dte", "mtm_sl", "mtm_tp", "mtm_unit",
        "entry_delay_buy_secs", "entry_delay_sell_secs",
        "exit_delay_buy_secs", "exit_delay_sell_secs",
        "exit_on_margin_error", "exit_on_entry_failure", "base_lot_multiplier",
        "journey_config", "is_archived", "created_at", "updated_at", "notes",
        # 0010
        "strategy_type",
        # 0018
        "recurring_days",
    ],
    "algo_legs": [
        # 0001 base
        "id", "algo_id", "leg_number", "direction", "instrument", "underlying",
        "expiry", "strike_type", "strike_offset", "strike_value", "lots",
        "sl_type", "sl_value", "tp_type", "tp_value",
        "tsl_x", "tsl_y", "tsl_unit", "ttp_x", "ttp_y", "ttp_unit",
        "wt_enabled", "wt_direction", "wt_value", "wt_unit",
        "reentry_enabled", "reentry_mode", "reentry_max", "created_at",
        # 0012
        "reentry_on_sl", "reentry_on_tp",
        # 0017
        "instrument_token",
    ],
    "market_holidays": [
        # stable table — all columns
        "id", "date", "segment", "description", "created_at",
    ],
}

# FK-safe export order (parents before children)
EXPORT_ORDER = ["accounts", "algos", "algo_legs", "market_holidays"]


def build_insert_query(table: str, columns: list) -> str:
    """
    Build a psql query that generates INSERT statements for the given table.

    Uses quote_nullable() so NULL values become the literal NULL token and
    strings are properly escaped and quoted. Output is one INSERT per row.
    """
    col_list = ", ".join(columns)
    # Build: quote_nullable(col1::text) || ', ' || quote_nullable(col2::text) || ...
    values_parts = " || ', ' || ".join(
        f"COALESCE(quote_nullable({col}::text), 'NULL')" for col in columns
    )
    return (
        f"SELECT 'INSERT INTO {table} ({col_list}) VALUES (' "
        f"|| {values_parts} "
        f"|| ');' "
        f"FROM {table} ORDER BY created_at NULLS LAST;"
    )


def export_table(table: str, columns: list) -> str:
    """Run the INSERT-generating query via psql and return the SQL lines."""
    query = build_insert_query(table, columns)
    cmd = [
        "docker", "exec", DOCKER_CONTAINER,
        "psql", "-U", DB_USER, "-d", DB_NAME,
        "--no-align", "--tuples-only", "--quiet",
        "-c", query,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"❌ Export failed for {table}:\n{result.stderr}", file=sys.stderr)
        sys.exit(1)
    lines = result.stdout.strip()
    return lines if lines else ""


def verify_row_counts() -> dict:
    counts = {}
    for table in EXPORT_ORDER:
        cmd = [
            "docker", "exec", DOCKER_CONTAINER,
            "psql", "-U", DB_USER, "-d", DB_NAME,
            "-t", "-c", f"SELECT COUNT(*) FROM {table};",
        ]
        r = subprocess.run(cmd, capture_output=True, text=True)
        try:
            counts[table] = int(r.stdout.strip())
        except ValueError:
            counts[table] = "?"
    return counts


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print("Verifying source row counts...")
    counts = verify_row_counts()
    for table, n in counts.items():
        print(f"  {table:<20} {n} rows")

    print("\nExporting tables with explicit column lists...")
    sections = []
    for table in EXPORT_ORDER:
        columns = TABLE_COLUMNS[table]
        print(f"  {table:<20} ({len(columns)} columns)")
        sql = export_table(table, columns)
        if sql:
            sections.append(f"-- {table}\n{sql}\n")
        else:
            sections.append(f"-- {table}: 0 rows\n")

    header = (
        f"-- STAAX seed data export\n"
        f"-- Generated : {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
        f"-- Tables    : {', '.join(EXPORT_ORDER)}\n"
        f"-- Rows      : {', '.join(f'{t}={counts[t]}' for t in EXPORT_ORDER)}\n"
        f"-- Columns   : explicit (migration 0001-0018)\n"
        f"-- Import    : psql -U staax -d staax_db < seed_data.sql\n"
        f"-- WARNING   : Contains credentials (api_key, totp_secret). Delete after import.\n"
        f"\n"
        f"SET client_encoding = 'UTF8';\n"
        f"SET standard_conforming_strings = on;\n"
        f"\n"
    )

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write(header)
        for section in sections:
            f.write(section)
            f.write("\n")

    size_kb = OUTPUT_FILE.stat().st_size // 1024
    print(f"\n✅ Written: {OUTPUT_FILE} ({size_kb} KB)")
    print(f"\n--- Next steps ---")
    print(f"1. On server: alembic upgrade head  (applies 0018 — adds missing columns)")
    print(f"2. scp {OUTPUT_FILE} ubuntu@13.202.164.243:~/")
    print(f"3. On server: psql -U staax -d staax_db < ~/seed_data.sql")
    print(f"4. Verify  : psql -U staax -d staax_db -c \"SELECT nickname, broker FROM accounts;\"")
    print(f"5. Cleanup : rm ~/seed_data.sql  (delete credentials from server)")


if __name__ == "__main__":
    main()
