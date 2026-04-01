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

Usage:
  python3 backend/scripts/export_seed_data.py

Output:
  ~/STAXX/db_exports/seed_data.sql

Import on server (after scp):
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

# Ordered by FK dependency — accounts first, legs last
TABLES = [
    "accounts",
    "algos",
    "algo_legs",
    "market_holidays",
]


def run_pg_dump() -> str:
    cmd = [
        "docker", "exec", DOCKER_CONTAINER,
        "pg_dump",
        "-U", DB_USER,
        "-d", DB_NAME,
        "--data-only",
        "--column-inserts",   # include column names — safe if schema has minor drift
        "--no-privileges",
        "--no-tablespaces",
    ]
    for table in TABLES:
        cmd += ["-t", table]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"❌ pg_dump failed:\n{result.stderr}", file=sys.stderr)
        sys.exit(1)
    return result.stdout


def verify_row_counts() -> dict:
    counts = {}
    for table in TABLES:
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

    print(f"\nRunning pg_dump...")
    sql = run_pg_dump()

    header = (
        f"-- STAAX seed data export\n"
        f"-- Generated : {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
        f"-- Tables    : {', '.join(TABLES)}\n"
        f"-- Rows      : {', '.join(f'{t}={counts[t]}' for t in TABLES)}\n"
        f"-- Import    : psql -U staax -d staax_db < seed_data.sql\n"
        f"-- WARNING   : Contains credentials (api_key, totp_secret). Delete after import.\n"
        f"\n"
        f"SET client_encoding = 'UTF8';\n"
        f"SET standard_conforming_strings = on;\n"
        f"\n"
    )

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write(header)
        f.write(sql)

    size_kb = OUTPUT_FILE.stat().st_size // 1024
    print(f"\n✅ Written: {OUTPUT_FILE} ({size_kb} KB)")
    print(f"\n--- Next steps ---")
    print(f"1. scp {OUTPUT_FILE} ubuntu@13.202.164.243:~/")
    print(f"2. On server: psql -U staax -d staax_db < ~/seed_data.sql")
    print(f"3. Verify  : psql -U staax -d staax_db -c \"SELECT nickname, broker FROM accounts;\"")
    print(f"4. Cleanup : rm ~/seed_data.sql  (delete credentials from server)")


if __name__ == "__main__":
    main()
