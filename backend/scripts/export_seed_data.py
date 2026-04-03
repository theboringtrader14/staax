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

UUID strategy:
  accounts  — UPSERT by nickname (unique constraint). Server's existing
              UUID is preserved; all other fields are updated.
  algos     — account_id is emitted as a subquery
              (SELECT id FROM accounts WHERE nickname=... AND broker=...)
              so the correct server UUID is resolved at import time.
  algo_legs — ON CONFLICT (id) DO NOTHING for idempotency.

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
        "recurring_days", "is_live",
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


# ── Query builders ────────────────────────────────────────────────────────────

def build_account_upsert_query() -> str:
    """
    Generate accounts UPSERT: ON CONFLICT (nickname) preserves the server's
    existing UUID; all other fields are overwritten with local values.

    nickname has a unique constraint from migration 0001.
    """
    columns = TABLE_COLUMNS["accounts"]
    col_list = ", ".join(columns)

    values_parts = " || ', ' || ".join(
        f"COALESCE(quote_nullable({col}::text), 'NULL')" for col in columns
    )

    # Update all cols except id (preserve server UUID) and nickname (conflict key)
    update_cols = [c for c in columns if c not in ("id", "nickname")]
    update_set = ", ".join(f"{c} = EXCLUDED.{c}" for c in update_cols)

    return (
        f"SELECT 'INSERT INTO accounts ({col_list}) VALUES (' "
        f"|| {values_parts} "
        f"|| ') ON CONFLICT (nickname) DO UPDATE SET {update_set};' "
        f"FROM accounts ORDER BY created_at NULLS LAST;"
    )


def build_algo_insert_query() -> str:
    """
    Generate algo INSERT...SELECT statements where account_id is replaced
    with a scalar subquery resolved at import time:

      (SELECT id FROM accounts WHERE nickname='Karthik' AND broker='zerodha')

    This avoids the UUID mismatch caused by gen_random_uuid() producing
    different IDs on local and server DBs.

    Uses ON CONFLICT (name) DO UPDATE SET ... for idempotency.
    Requires a JOIN to accounts to retrieve nickname+broker per algo.
    """
    columns = TABLE_COLUMNS["algos"]
    col_list = ", ".join(columns)

    # Build the SELECT expression for each column.
    # account_id is replaced with a literal subquery string.
    value_exprs = []
    for col in columns:
        if col == "account_id":
            # Produces: (SELECT id FROM accounts WHERE nickname='X' AND broker='Y')
            value_exprs.append(
                "'(SELECT id FROM accounts WHERE nickname=''' "
                "|| acc.nickname "
                "|| ''' AND broker=''' "
                "|| acc.broker::text "
                "|| ''')'"
            )
        else:
            value_exprs.append(
                f"COALESCE(quote_nullable(alg.{col}::text), 'NULL')"
            )

    values_concat = " || ', ' || ".join(value_exprs)

    # DO UPDATE SET: all cols except id (PK) and name (conflict key)
    update_cols = [c for c in columns if c not in ("id", "name")]
    update_set = ", ".join(f"{c} = EXCLUDED.{c}" for c in update_cols)

    return (
        f"SELECT 'INSERT INTO algos ({col_list}) SELECT ' "
        f"|| {values_concat} "
        f"|| ' ON CONFLICT (name) DO UPDATE SET {update_set};' "
        f"FROM algos alg "
        f"JOIN accounts acc ON alg.account_id = acc.id "
        f"ORDER BY alg.created_at NULLS LAST;"
    )


def build_insert_query(table: str, columns: list) -> str:
    """
    Build a psql query that generates INSERT statements for the given table.

    Uses quote_nullable() so NULL values become the literal NULL token and
    strings are properly escaped and quoted. Output is one INSERT per row.

    market_holidays — ON CONFLICT DO NOTHING (natural PK, safe to re-import).
    algo_legs       — ON CONFLICT (id) DO NOTHING for idempotency.
    """
    col_list = ", ".join(columns)
    values_parts = " || ', ' || ".join(
        f"COALESCE(quote_nullable({col}::text), 'NULL')" for col in columns
    )
    if table == "market_holidays":
        suffix = " ON CONFLICT DO NOTHING"
    elif table == "algo_legs":
        suffix = " ON CONFLICT (id) DO NOTHING"
    else:
        suffix = ""
    return (
        f"SELECT 'INSERT INTO {table} ({col_list}) VALUES (' "
        f"|| {values_parts} "
        f"|| '){suffix};' "
        f"FROM {table} ORDER BY created_at NULLS LAST;"
    )


def export_table(table: str) -> str:
    """Run the INSERT-generating query via psql and return the SQL lines."""
    if table == "accounts":
        query = build_account_upsert_query()
    elif table == "algos":
        query = build_algo_insert_query()
    else:
        query = build_insert_query(table, TABLE_COLUMNS[table])

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


# ── Row counts and verification ───────────────────────────────────────────────

def _psql_scalar(query: str) -> str:
    """Run a single-value psql query and return the stripped result."""
    cmd = [
        "docker", "exec", DOCKER_CONTAINER,
        "psql", "-U", DB_USER, "-d", DB_NAME,
        "-t", "-c", query,
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r.stdout.strip()


def verify_row_counts() -> dict:
    counts = {}
    for table in EXPORT_ORDER:
        try:
            counts[table] = int(_psql_scalar(f"SELECT COUNT(*) FROM {table};"))
        except ValueError:
            counts[table] = "?"
    return counts


def build_export_summary() -> dict:
    """
    Gather verification stats from the local DB:
      - total algos
      - algos per broker
      - algos with no resolvable account (JOIN mismatch — should always be 0)
    """
    try:
        total_algos = int(_psql_scalar("SELECT COUNT(*) FROM algos;"))
    except ValueError:
        total_algos = "?"

    broker_counts = {}
    rows = _psql_scalar(
        "SELECT acc.broker::text, COUNT(alg.id) "
        "FROM algos alg JOIN accounts acc ON alg.account_id = acc.id "
        "GROUP BY acc.broker ORDER BY acc.broker;"
    )
    for line in rows.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) == 2:
            broker_counts[parts[0]] = int(parts[1])

    try:
        joined_algos = int(_psql_scalar(
            "SELECT COUNT(*) FROM algos alg JOIN accounts acc ON alg.account_id = acc.id;"
        ))
        orphaned = total_algos - joined_algos if isinstance(total_algos, int) else "?"
    except ValueError:
        orphaned = "?"

    orphaned_names: list = []
    if orphaned and orphaned != "?" and int(orphaned) > 0:
        rows2 = _psql_scalar(
            "SELECT alg.name FROM algos alg "
            "LEFT JOIN accounts acc ON alg.account_id = acc.id "
            "WHERE acc.id IS NULL ORDER BY alg.name;"
        )
        orphaned_names = [r.strip() for r in rows2.splitlines() if r.strip()]

    return {
        "total_algos":   total_algos,
        "by_broker":     broker_counts,
        "orphaned":      orphaned,
        "orphaned_names": orphaned_names,
    }


def print_export_summary(counts: dict, summary: dict):
    print("\n── Export Verification Summary ──────────────────────────────")
    print(f"  accounts        : {counts['accounts']} rows")
    print(f"  algos           : {counts['algos']} rows")
    for broker, n in summary["by_broker"].items():
        print(f"    → {broker:<12}: {n} algos")
    print(f"  algo_legs       : {counts['algo_legs']} rows")
    print(f"  market_holidays : {counts['market_holidays']} rows")

    orphaned = summary["orphaned"]
    if orphaned == 0 or orphaned == "0":
        print(f"\n  ✅ All algos have a resolvable account (no UUID orphans)")
    else:
        print(f"\n  ❌ Algos with unresolvable account (will be MISSING from export): {orphaned}")
        for name in summary["orphaned_names"]:
            print(f"       - {name}")
    print("─────────────────────────────────────────────────────────────")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print("Verifying source row counts...")
    counts = verify_row_counts()
    for table, n in counts.items():
        print(f"  {table:<20} {n} rows")

    print("\nExporting tables...")
    sections = []
    for table in EXPORT_ORDER:
        cols = TABLE_COLUMNS[table]
        print(f"  {table:<20} ({len(cols)} columns)")
        sql = export_table(table)
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
        f"-- UUID fix  : accounts upsert by nickname; algos account_id via subquery\n"
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

    summary = build_export_summary()
    print_export_summary(counts, summary)

    print(f"\n--- Next steps ---")
    print(f"1. On server: alembic upgrade head  (applies missing columns)")
    print(f"2. scp {OUTPUT_FILE} ubuntu@13.202.164.243:~/")
    print(f"3. On server: psql -U staax -d staax_db < ~/seed_data.sql")
    print(f"4. Verify  : psql -U staax -d staax_db -c \"SELECT COUNT(*) FROM algos;\"")
    print(f"5. Verify  : psql -U staax -d staax_db -c \"SELECT name, acc.nickname FROM algos alg JOIN accounts acc ON alg.account_id = acc.id ORDER BY acc.broker, alg.name;\"")
    print(f"6. Cleanup : rm ~/seed_data.sql  (delete credentials from server)")


if __name__ == "__main__":
    main()
