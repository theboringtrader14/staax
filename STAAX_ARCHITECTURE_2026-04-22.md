# STAAX Architecture — Post-Refactor
# Date: 22 April 2026
# Commit: ba853b8 (MissingGreenlet structural fix)
# Previous doc: STAAX_ARCHITECTURE.md

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Data Models](#2-data-models)
3. [Algo Lifecycle — End to End](#3-algo-lifecycle--end-to-end)
4. [Strategy Modes](#4-strategy-modes)
5. [Journey Legs](#5-journey-legs)
6. [Re-entry](#6-re-entry)
7. [Tick Pipeline — Data Flow](#7-tick-pipeline--data-flow)
8. [Bots Engine](#8-bots-engine)
9. [Broker Layer](#9-broker-layer)
10. [Known Issues and Status](#10-known-issues-and-status)
11. [Pending Optimizations](#11-pending-optimizations)
12. [Architecture Decisions and Rationale](#12-architecture-decisions-and-rationale)

---

## 1. SYSTEM OVERVIEW

### FastAPI Application — `backend/app/main.py`

Single-process FastAPI server with an `asynccontextmanager` lifespan that wires all
engine components. Startup runs **17 sequential steps** before yielding to the ASGI
server. Shutdown stops the scheduler, LTP consumer, and closes Redis.

**Startup sequence** (`main.py:78–357`):

| Step | What happens |
|------|-------------|
| 0 | File logging configured via `setup_logging()` |
| 1 | PostgreSQL: wait-retry (10 attempts × 2s), `Base.metadata.create_all` |
| 2 | Redis: `aioredis.from_url()` + `ping()` |
| 3 | WebSocket `ConnectionManager` created; `event_logger.wire(ws_manager)` |
| 4 | Broker instances created: `ZerodhaBroker`, `AngelOneBroker(account="mom")`, `AngelOneBroker(account="wife")`, `AngelOneBroker(account="karthik")` |
| 4b | Angel One instrument master pre-warmed (~40 MB, class-level cache) |
| 4c | `ExpiryCalendar` built from instrument master |
| 5 | `LTPCache(redis_client)`, `VirtualOrderBook`, `LTPConsumer(None, redis_client)` |
| 6 | Engine singletons: `OrderPlacer`, `SLTPMonitor`, `TSLEngine`, `TTPEngine`, `JourneyEngine`, `MTMMonitor`, `WTEvaluator`, `ORBTracker`, `StrikeSelector` |
| 7 | `algo_runner.wire_engines(...)` — wires all 14 engine references into singleton |
| 8 | `execution_manager.wire(order_placer)`, `position_rebuilder.wire(...)`, `order_reconciler.wire(...)` |
| 9 | `AlgoScheduler` created; `scheduler.set_algo_runner(algo_runner)` |
| 9b | LTP callbacks registered: `orb_tracker.on_tick`, `wt_evaluator.on_tick`, `tsl_engine_ins.on_tick`, `ttp_engine_ins.on_tick`, `sl_tp_monitor.on_tick` |
| 10 | Scheduler started; fixed daily jobs registered |
| 11 | Reconciler (15s), daily reset (08:00), MCX token refresh (06:00), bot daily data (09:00), FY margin stamp (Apr 1), auto-grid-entries (08:50) jobs registered |
| 11b | `scheduler.recover_today_jobs()` — re-register exit jobs for algos that survived restart |
| 11c | `scheduler.recover_multiday_jobs()` — restore BTST/STBT overnight positions |
| 12 | `position_rebuilder.run()` — rebuild in-memory monitors from DB state |
| 12b | `bot_runner.wire(...); bot_runner.load_bots()` |
| 13 | `_load_all_broker_tokens()` — load today's tokens from DB into broker instances |
| 13b | `_build_angel_broker_map()` — maps client_id → AngelOneBroker |
| 13b2 | `_register_global_mtm()` — register account-level MTM monitors |
| 13c | `_ao_startup_auto_login()` — auto-login AO accounts with stale/missing tokens |
| 13c2 | `_ensure_today_grid_entries()` — auto-create GridEntry rows for recurring algos |
| 13c3 | Catch-up activation if backend restarted after 09:15 IST |
| 14 | `_auto_start_market_feed()` — start SmartStream if broker token exists |
| 15 | Account status summary printed |
| 16 | `_run_startup_migrations()` — idempotent `ADD COLUMN IF NOT EXISTS` migrations |
| 17 | Fix today's orders with quantity=1 (lot-size bug fix, async task) |

**Route registration** (all under `/api/v1/`):

```
auth, accounts, algos, grid, orders, services, system, reports,
events, bots, holidays, logs, ai, mobile, analytics
```

---

### PostgreSQL — Tables and Purpose

All tables use SQLAlchemy ORM with UUID primary keys (except `event_log` integer PK,
`system_state` integer PK, `account_fy_margin` integer PK).

| Table | Model class | File | Purpose |
|-------|-------------|------|---------|
| `algos` | `Algo` | `models/algo.py` | Strategy configuration (timing, SL/TP, mode) |
| `algo_legs` | `AlgoLeg` | `models/algo.py` | Per-leg instrument, strike, SL/TP, W&T, re-entry config |
| `grid_entries` | `GridEntry` | `models/grid.py` | Deployment of an algo to a specific trading day |
| `algo_states` | `AlgoState` | `models/algo_state.py` | Runtime state machine for one algo on one day |
| `orders` | `Order` | `models/order.py` | Individual leg orders placed (live or PRACTIX) |
| `trades` | `Trade` | `models/trade.py` | Completed round-trip trades, P&L, FY attribution |
| `execution_logs` | `ExecutionLog` | `models/execution_log.py` | SEBI audit trail — every PLACE/CANCEL/RETRY decision |
| `accounts` | `Account` | `models/account.py` | Broker account credentials and tokens |
| `account_fy_margin` | `AccountFYMargin` | `models/account.py` | Per-account per-FY margin and brokerage tracking |
| `bots` | `Bot` | `models/bot.py` | Indicator bot configuration (MCX candle strategies) |
| `bot_signals` | `BotSignal` | `models/bot.py` | Signals generated by bots |
| `bot_orders` | `BotOrder` | `models/bot.py` | Orders placed by bots |
| `event_log` | `EventLog` | `models/event_log.py` | Frontend System Log entries (info/success/error) |
| `system_state` | `SystemState` | `models/system_state.py` | Global kill-switch state (single row, id=1) |
| `margin_history` | `MarginHistory` | `models/order.py` | FY margin records for ROI calculation |

---

### Redis — Actual Usage

Redis is connected at startup (`main.py:129`) and used for **exactly two things**:

1. **LTP tick cache** — `LTPConsumer._process_ticks()` writes every tick to Redis:
   `setex("ltp:{token}", 86400, str(ltp))`. TTL = 24 hours.
   Key prefix: `ltp:` (`ltp_consumer.py:26–27`).
2. **`LTPCache` read helper** — `LTPCache.get(token)` / `LTPCache.get_many(tokens)`
   for async reads (used in some monitors). Primary path uses `_ltp_map` in-memory dict.

Redis is NOT used for session management, pub/sub, task queues, or distributed locks.

---

### APScheduler (`AsyncIOScheduler`) — `engine/scheduler.py`

Role: **time-based dispatch ONLY**. APScheduler fires coroutines at configured
clock times. It does NOT serve as a greenlet bridge (despite the comment in the
pre-refactor code — that was the root cause of the MissingGreenlet bug).

`AlgoScheduler` class (`scheduler.py:101`). One instance per process.

**Fixed daily jobs** (registered in `_register_fixed_jobs`, `scheduler.py:140`):

| Time (IST) | Job ID | Function |
|-----------|--------|----------|
| 00:01 | `job_apply_pending_removals` | Apply pending recurring_day removals |
| 06:00 | `mcx_token_refresh` | Rotate MCX tokens on contract expiry |
| 08:00 | `daily_reset` | Clear kill switch; `daily_system_reset()` |
| 08:30 | `token_refresh` | Refresh Zerodha + Angel One tokens |
| 08:50 | `auto_grid_entries` | Auto-create GridEntry for today's recurring algos |
| 09:00 | `bot_daily_data` | Load previous-day OHLC for DTR bots (Mon-Fri) |
| 09:14 | `premarkt_sweep` | Pre-market validation sweep (warn-only) |
| 09:15 | `activate_all` | Create `AlgoState` WAITING for all today's GridEntries |
| 09:18 | `overnight_sl_check` | Check SL for all open overnight positions |
| 15:15 | `expiry_force_close` | Force-close expiring positions (safety net) |
| 15:35 | `eod_cleanup` | Close any stale intraday algos |
| every 3s | `broker_reconnect` | Check LTP feed staleness; reconnect if needed |
| every 15s | `order_reconciler` | Reconcile orders with broker book |
| Apr 1 09:05 | `fy_margin_stamp` | Auto-stamp FY starting margins for all accounts |

**Per-algo jobs** (registered per GridEntry in `schedule_algo_jobs`, `scheduler.py:222`):
- `entry_{grid_entry_id}` — `DateTrigger` at `algo.entry_time` (DIRECT only)
- `orb_end_{grid_entry_id}` — `DateTrigger` at `algo.orb_end_time` (ORB only)
- `exit_{grid_entry_id}` — `DateTrigger` at `algo.exit_time` (INTRADAY) or `next_day_exit_time` (BTST/STBT)
- `sl_check_{grid_entry_id}` — `DateTrigger` at `entry_time - 2 minutes` next trading day (BTST/STBT)

APScheduler passes only plain Python primitives (str `grid_entry_id`) as job args.
**Never ORM objects.** (see THE ONE RULE below)

---

### SmartStream — Angel One WebSocket (`engine/ltp_consumer.py`)

`AngelOneTickerAdapter` class (`ltp_consumer.py:30`). Wraps `SmartWebSocketV2` from
`smartapi-python`. WebSocket endpoint: `wss://smartapisocket.angelone.in/smart-stream`.

**Exchange segments subscribed:**

| exchangeType | Segment | Tokens |
|-------------|---------|--------|
| 1 | NSE cash (index) | NIFTY=99926000, BANKNIFTY=99926009, FINNIFTY=99926037, MIDCAPNIFTY=99926014, SENSEX=99919000 |
| 2 | NFO (NSE F&O) | All option/futures tokens not in other sets |
| 4 | BFO (BSE F&O) | SENSEX/BANKEX options — registered via `register_bfo_tokens()` |
| 5 | MCX | GOLDM, SILVERMIC futures — registered via `register_mcx_tokens()` |

Prices from Angel One are in **paise** — divided by 100 in `_on_data()` (`ltp_consumer.py:243`).

Reconnect: exponential backoff `[2, 4, 8, 16, 30, 30, 30, 60, 60, 60]` seconds,
max 10 attempts. On reconnect (`_on_open`), re-subscribes all queued tokens and fires
reconnect callbacks (e.g. `algo_runner.rearm_wt_monitors`).

---

### LTPConsumer — `engine/ltp_consumer.py`

`LTPConsumer` class (`ltp_consumer.py:362`). Wraps both `KiteTicker` (Zerodha) and
`AngelOneTickerAdapter`. Normalises ticks to `{instrument_token: int, last_price: float}`.

On every tick (`_process_ticks`, `ltp_consumer.py:558`):
1. Write to Redis via pipeline (`setex ltp:{token} 86400 {ltp}`)
2. Update in-memory `_ltp_map[token] = ltp` and `_ltp_timestamps[token]`
3. Broadcast index tickers and position LTPs to frontend via `ws_manager`
4. Fire all registered callbacks: `for cb in self._callbacks: await cb(token, ltp, tick)`

`get_ltp(token)` — synchronous, reads `_ltp_map` directly (zero-await, hot path safe).

---

### AlgoRunner — `engine/algo_runner.py`

`AlgoRunner` class (`algo_runner.py:99`). Central coordinator for all algo execution.
One singleton per process. Wired via `wire_engines()` (`algo_runner.py:150`) in
`main.py:201`.

Sub-engines held as instance attributes:
```
_strike_selector, _order_placer, _sl_tp_monitor, _tsl_engine, _ttp_engine,
_journey_engine, _mtm_monitor, _wt_evaluator, _orb_tracker, _reentry_engine,
_ltp_consumer, _ws_manager, _zerodha_broker, _angel_broker_map, _execution_manager
```

Runtime-only (non-DB) state:
- `_orb_levels: Dict[str, tuple]` — `grid_entry_id → (orb_high, orb_low)` set at ORB breakout
- `_wt_arming_cache: Dict[str, dict]` — W&T arming details per `grid_entry_id` (plain Python primitives: `instrument_token`, `symbol`, `reference_price`, `threshold`, `direction`, `wt_value`, `wt_unit`, `entry_time`, `algo_id`)
- `_ul_subscribed_tokens: set` — underlying tokens already registered for SL/TP callback
- `_lot_size_cache: Dict[str, int]` — `"EXCHANGE:SYMBOL" → lot_size`, cleared daily
- `_rate_limiter: TokenBucketRateLimiter` — 8 orders/sec cap (SEBI max = 10)

---

### BotRunner — `engine/bot_runner.py`

`BotRunner` class (`bot_runner.py:46`). Orchestrates all active MCX indicator bots.
One singleton per process. See Section 8 for full details.

---

### BrokerMap — `_angel_broker_map`

Defined in `AlgoRunner.__init__` (`algo_runner.py:122`):

```python
self._angel_broker_map: Dict[str, object] = {}  # client_id → AngelOneBroker
```

Populated in `wire_engines()` when `angel_brokers=[angelone_mom, angelone_wife, angelone_karthik]`
is passed from `main.py:215`. Three Angel One broker instances:

| Instance variable | `account` arg | Account holder | Scope |
|-------------------|--------------|----------------|-------|
| `angelone_mom` | `"mom"` | Mom | F&O (NFO) |
| `angelone_wife` | `"wife"` | Wife | MCX (Phase 2) |
| `angelone_karthik` | `"karthik"` | Karthik | F&O (NFO) |

Zerodha: one instance (`zerodha = ZerodhaBroker()`), stored as `_zerodha_broker`.

---

### THE ONE RULE — ORM Boundary

```python
# CORRECT: ORM objects ONLY inside async with AsyncSession() blocks
async with AsyncSessionLocal() as db:
    result = await db.execute(select(Algo).where(Algo.id == algo_id))
    algo = result.scalar_one_or_none()
    # ← capture all needed attributes as plain Python HERE ←
    algo_name = algo.name           # str — safe outside session
    algo_id_str = str(algo.id)      # str — safe outside session
    snap = snapshot_grid_entry_full(ge, algo, account, legs)  # ← THE CROSSING POINT
# ← session closed — never access `algo` object again ←

# CORRECT: runtime engine uses snapshots only
# GridEntrySnapshot, LegSnapshot, AccountSnapshot, AlgoSnapshot, OrderSnapshot
# ALL plain Python dataclasses — no SQLAlchemy dependency

# WRONG (causes MissingGreenlet):
# algo.legs[0].underlying  # lazy load on detached object — FATAL
# algo.account.nickname    # same — FATAL
```

**`snapshot_grid_entry_full(ge, algo, account, legs)`** (`snapshots.py:331`) —
the single crossing point from ORM → runtime. Called INSIDE an open session.
Returns `GridEntrySnapshot` with flat algo/account/leg fields copied as primitives.
All sub-snapshots (`LegSnapshot`, `AlgoSnapshot`, `AccountSnapshot`) are pure Python
dataclasses defined in `engine/snapshots.py`.

**APScheduler args**: only plain Python str IDs (e.g. `grid_entry_id: str`) are
passed as job args. Never ORM objects. This is enforced in `schedule_algo_jobs()`
(`scheduler.py:222`) where `first_leg_underlying: str` is pre-fetched and passed
rather than accessing `algo.legs` in the scheduler context.

---

## 2. DATA MODELS

### `Algo` — table `algos` (`models/algo.py:54`)

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | Unique identifier |
| `name` | String(100) UNIQUE | Human-readable name, e.g. "AWS-1" |
| `account_id` | UUID FK → accounts | Which broker account |
| `strategy_mode` | Enum | `intraday \| btst \| stbt \| positional` |
| `entry_type` | Enum | `direct \| orb` |
| `order_type` | Enum | `market \| limit` |
| `is_active` | Boolean | If False, skipped by scheduler |
| `is_live` | Boolean | Live vs PRACTIX default |
| `entry_time` | String(8) | "HH:MM:SS" — entry trigger time |
| `exit_time` | String(8) | "HH:MM:SS" — intraday SQ time |
| `orb_start_time` | String(8) | ORB window open |
| `orb_end_time` | String(8) | ORB window close |
| `next_day_exit_time` | String(8) | BTST/STBT next-day exit time |
| `dte` | Integer | Days to expiry (Positional only) |
| `mtm_sl/tp` | Float | Algo-level combined MTM stop |
| `mtm_unit` | String(5) | "amt" or "pct" |
| `entry_delay_buy/sell_secs` | Integer | Per-direction entry delay |
| `exit_delay_buy/sell_secs` | Integer | Per-direction exit delay |
| `exit_on_margin_error` | Boolean | Square all legs on margin error |
| `exit_on_entry_failure` | Boolean | Square placed legs if a later leg fails |
| `base_lot_multiplier` | Integer | Multiplied by leg.lots × grid.lot_multiplier |
| `recurring_days` | JSON | ["MON","WED","FRI"] — auto GridEntry days |
| `pending_day_removals` | JSON | Queued day removals (applied at 00:01) |
| `journey_config` | JSON | Legacy algo-level journey config |
| `notes` | Text | Free-form notes |

Lifecycle: Created via `POST /api/v1/algos/`. One record per strategy definition.
Does not hold runtime state — that lives in `AlgoState`.

---

### `AlgoLeg` — table `algo_legs` (`models/algo.py:121`)

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | Stable FK target for orders.leg_id |
| `algo_id` | UUID FK → algos | Parent algo |
| `leg_number` | Integer | Display order (1, 2, 3…) |
| `direction` | String(4) | "buy" or "sell" |
| `instrument` | String(5) | "ce", "pe", "fu" |
| `underlying` | String(20) | "NIFTY", "BANKNIFTY", etc. |
| `expiry` | String(20) | "current_weekly" \| "next_weekly" \| "current_monthly" \| "next_monthly" |
| `strike_type` | String(20) | "atm" \| "itm3" \| "otm2" \| "premium" \| "straddle_premium" |
| `strike_offset` | Integer | ITM/OTM offset (1–10) |
| `strike_value` | Float | ₹ for premium-based selection |
| `lots` | Integer | Number of lots |
| `sl_type/value` | String/Float | Per-leg SL: "pts_instrument" \| "pct_instrument" \| "pts_underlying" \| "pct_underlying" |
| `tp_type/value` | String/Float | Per-leg TP (same types as SL) |
| `tsl_enabled/x/y/unit` | Bool/Float/Float/String | Trailing stop loss config |
| `ttp_enabled/x/y/unit` | Bool/Float/Float/String | Trailing target profit config |
| `wt_enabled/direction/value/unit` | Bool/String/Float/String | Wait-and-Trade per leg |
| `orb_range_source` | String(15) | "underlying" or "instrument" |
| `orb_entry_at` | String(5) | "high" or "low" — breakout direction |
| `orb_sl_type/tp_type` | String(30) | ORB-specific SL/TP: "orb_high" \| "orb_low" \| "orb_range" \| etc. |
| `orb_buffer_value/unit` | Float/String | ± buffer for ORB SL/TP |
| `reentry_on_sl/tp` | Boolean | Re-entry flag per exit type |
| `reentry_max/max_sl/max_tp` | Integer | Max re-entries total/per-SL/per-TP |
| `reentry_type` | String(20) | "re_entry" or "re_execute" |
| `reentry_ltp_mode` | String(15) | "ltp" or "candle_close" |
| `journey_config` | JSON | Child leg to fire on exit |
| `journey_trigger` | String(10) | "sl" \| "tp" \| "either" |
| `instrument_token` | Integer | Set by engine after strike selection |
| `underlying_token` | Integer | Index token for pts_underlying/pct_underlying |

---

### `GridEntry` — table `grid_entries` (`models/grid.py:27`)

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | |
| `algo_id` | UUID FK → algos | Which algo |
| `account_id` | UUID FK → accounts | Which account (denorm from Algo) |
| `trading_date` | Date | The specific trading day |
| `day_of_week` | String(3) | "mon"–"fri" |
| `lot_multiplier` | Integer | Per-day lot multiplier (M column in grid) |
| `is_enabled` | Boolean | If False, skipped by scheduler |
| `is_practix` | Boolean | PRACTIX (paper) vs LIVE toggle per cell |
| `is_archived` | Boolean | Hidden from active grid |
| `status` | Enum | `no_trade \| algo_active \| order_pending \| open \| algo_closed \| error` |

Lifecycle: Created by `POST /api/v1/algos/` (for current week) or `POST /api/v1/grid/` (manual deploy).
One row = one cell in the Smart Grid. Created fresh each week via `recurring_days`.

---

### `AlgoState` — table `algo_states` (`models/algo_state.py:41`)

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | |
| `grid_entry_id` | UUID FK (UNIQUE) | One state per GridEntry |
| `algo_id` | UUID FK | |
| `account_id` | UUID FK | |
| `trading_date` | String(10) | YYYY-MM-DD |
| `status` | Enum | `inactive \| waiting \| active \| closed \| error \| terminated \| no_trade` |
| `is_practix` | Boolean | |
| `activated_at` | DateTime | When WAITING started |
| `first_fill_at` | DateTime | When ACTIVE started |
| `closed_at` | DateTime | When CLOSED/TERMINATED |
| `mtm_current` | Float | Live unrealised P&L |
| `mtm_realised` | Float | Locked-in P&L from closed legs |
| `reentry_count` | Integer | Total re-entries fired today |
| `sl_reentry_count` | Integer | SL-triggered re-entries |
| `tp_reentry_count` | Integer | TP-triggered re-entries |
| `journey_level` | String(10) | Current level "1", "1.1", etc. |
| `orb_high/low` | Float | Locked ORB range (populated at breakout) |
| `error_message` | Text | Last error detail |
| `exit_reason` | String(20) | "sl", "tp", "sq", etc. |

State machine: `INACTIVE → WAITING → ACTIVE → CLOSED` (or `ERROR` / `TERMINATED` / `NO_TRADE`)

---

### `Order` — table `orders` (`models/order.py:39`)

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | |
| `grid_entry_id` | UUID FK | Parent grid entry |
| `algo_id` | UUID FK | |
| `leg_id` | UUID FK → algo_legs | Which leg config |
| `account_id` | UUID FK | |
| `broker_order_id` | String(100) | Exchange-assigned order ID |
| `algo_tag` | String(150) | SEBI audit tag: `STAAX_{account}_{algo}_{leg}_{ts_ms}` |
| `is_practix` | Boolean | |
| `is_overnight` | Boolean | True → NRML product at broker |
| `symbol` | String(50) | e.g. `NIFTY22000CE` |
| `exchange` | String(10) | NFO, BFO, MCX |
| `instrument_token` | Integer | SmartStream token |
| `direction` | String(4) | "buy" or "sell" |
| `lots/lot_size/quantity` | Integer | Lots × lot_size × multipliers |
| `entry_type` | String(20) | "direct", "orb", "wt" |
| `entry_reference` | String(100) | W&T reference price float |
| `fill_price/fill_time` | Float/DateTime | Entry fill |
| `placed_at/filled_at/latency_ms` | DateTime/DateTime/Integer | Broker call timing |
| `ltp` | Float | Last known LTP (updated on tick) |
| `sl_type/sl_original/sl_actual` | String/Float/Float | SL tracking (sl_actual trails with TSL) |
| `tsl_activated/activation_price/current_sl/trail_count` | Bool/Float/Float/Integer | TSL state |
| `ttp_activated/activation_price/current_tp/trail_count` | Bool/Float/Float/Integer | TTP state |
| `target` | Float | TP level |
| `exit_price/exit_price_manual/exit_time` | Float/Float/DateTime | Exit details |
| `exit_reason` | Enum | `sl \| tp \| tsl \| mtm_sl \| mtm_tp \| global_sl \| sq \| auto_sq \| btst_exit \| stbt_exit \| superseded_by_retry` |
| `pnl` | Float | Realised P&L |
| `status` | Enum | `pending \| open \| closed \| error \| cancelled` |
| `journey_level` | String(10) | "1", "1.1", "2.1" |

---

### `Trade` — table `trades` (`models/trade.py:13`)

Completed round-trip trades created when an Order is closed. Used for all P&L
reporting and equity curve calculations.

Key columns: `order_id`, `account_id`, `algo_id`, `trading_date`, `financial_year`,
`realised_pnl`, `exit_reason`, `journey_level`, `is_practix`.

---

### `ExecutionLog` — table `execution_logs` (`models/execution_log.py:15`)

SEBI audit trail. One row per: PLACE attempt, CANCEL, RETRY, BLOCK, SQ.
Never deleted.

Key columns: `action` (PLACE/CANCEL/RETRY/BLOCK/SQ/RATE_LIMIT),
`status` (OK/BLOCKED/FAILED), `event_type` (entry_attempt/entry_success/
entry_failed/sl_hit/tp_hit/tsl_trail/reentry/kill_switch/pre_check_failed),
`details` (JSONB with broker response, prices, leg info).

---

### `Bot`, `BotSignal`, `BotOrder` — table `bots`, `bot_signals`, `bot_orders` (`models/bot.py`)

See Section 8 for full bot engine description.

---

### `Account` — table `accounts` (`models/account.py:25`)

Broker credentials, tokens, `global_sl/tp`, `scope` ('fo' or 'mcx').
Three Angel One instances (mom/wife/karthik) + one Zerodha.

### `AccountFYMargin` — table `account_fy_margin` (`models/account.py:49`)

Per-account per-FY margin (`fy_margin`) and brokerage (`fy_brokerage`) for ROI.
Stamped annually on April 1st 09:05 by scheduler or manually.

### `EventLog` — table `event_log` (`models/event_log.py:5`)

System Log entries written by `engine/event_logger.py`. Fields: `ts`, `level`,
`msg`, `algo_name`, `algo_id`, `account_id`, `source`, `details`.

### `SystemState` — table `system_state` (`models/system_state.py:9`)

Single row (id=1). Persists kill-switch state across restarts:
`kill_switch_active`, `kill_switch_at`, `killed_account_ids`.

---

## 3. ALGO LIFECYCLE — END TO END

### 3.1 Creation (API Layer)

**Endpoint**: `POST /api/v1/algos/` (`algos.py:368`)

On creation:
1. `Algo` row inserted into `algos`
2. `AlgoLeg` rows inserted into `algo_legs` (one per leg in `body.legs`)
3. For each day in `body.recurring_days`, a `GridEntry` row is created for the
   current week if `trading_date >= today` and no duplicate exists

Critical columns set at creation:
- `algo.is_active = True`, `algo.is_archived = False`
- `grid_entry.status = GridStatus.NO_TRADE`
- `grid_entry.is_practix = not body.is_live`

---

### 3.2 Daily Activation (09:15 IST)

**Function**: `AlgoScheduler._job_activate_all()` (`scheduler.py:574`)

For each `GridEntry` with `trading_date == today AND is_enabled=True AND algo.is_active=True`:

1. Skip if `AlgoState` already exists (idempotent)
2. Load first leg via explicit query to get `_act_underlying` (avoids lazy load)
3. Expiry skip check: STBT/BTST skip if `underlying` expires today
4. Create `AlgoState(status=WAITING, activated_at=now())`
5. Set `grid_entry.status = GridStatus.ALGO_ACTIVE`
6. Call `schedule_algo_jobs(str(grid_entry.id), algo, today, first_leg_underlying=_act_underlying)`
7. For ORB algos: `asyncio.ensure_future(_run_orb_safe(algo_runner.register_orb(...)))` —
   passing only pre-captured plain Python strings (not ORM objects)

GridEntry fields created/updated:
- `status`: `NO_TRADE → ALGO_ACTIVE`

AlgoState fields:
- `grid_entry_id`, `algo_id`, `account_id`, `trading_date`, `status=WAITING`,
  `is_practix`, `activated_at`

Jobs registered (examples for DIRECT INTRADAY):
- `entry_{ge_id}` at `algo.entry_time`
- `exit_{ge_id}` at `algo.exit_time`

---

### 3.3 Entry Flows

#### DIRECT Entry

```
scheduler._job_entry(grid_entry_id)             # scheduler.py:757 sync wrapper
  → _job_entry_coro(grid_entry_id)              # scheduler.py:770
    → check AlgoState.status == WAITING         # read-only session, closed after
    → algo_runner.enter(grid_entry_id)          # algo_runner.py:392
      → [entry_time gate check: open+close session, capture _gate_entry_time as str]
      → async with AsyncSessionLocal() as db:
          → _enter_with_db(db, grid_entry_id)   # algo_runner.py:488
            → _enter_with_db_inner(...)         # algo_runner.py:530
              → SELECT AlgoState+GridEntry+Algo (JOIN)
              → SELECT Account
              → Guard: status must be WAITING
              → SELECT AlgoLeg ORDER BY leg_number
              → _pre_execution_check(algo, grid_entry, leg) for each leg
              → AlgoState.status = ACTIVE; GridEntry.status = ORDER_PENDING
              → MTMMonitor.register_algo(...)
              → for each leg:
                  → _place_leg(db, leg, algo, ...)  # algo_runner.py:932
                    → resolve broker (angelone/zerodha by account.broker)
                    → StrikeSelector.select(underlying, instrument, expiry, strike_type, ...)
                    → [W&T check: if wt_enabled, arm WTEvaluator, cache in _wt_arming_cache, return None]
                    → entry_delay (asyncio.sleep if configured)
                    → _get_lot_size(symbol, exchange)
                    → _rate_limiter.acquire()
                    → Write PENDING Order to DB (db.flush())
                    → ExecutionManager.place(db, idempotency_key, ...)
                        → broker.place_order(symbol, exchange, direction, qty, "SL", ...)
                    → Update Order: status=OPEN, fill_price, broker_order_id, latency_ms
                    → Compute sl_actual from sl_type+fill_price
                    → LTPConsumer.subscribe([instrument_token])
                    → if BFO: register_bfo_tokens([instrument_token])
                    → SLTPMonitor.add_position(PositionMonitor, on_sl=..., on_tp=...)
                    → if tsl_enabled: TSLEngine.register(TSLState)
                    → if ttp_enabled: TTPEngine.register(TTPState)
                    → if journey_config: JourneyEngine.register(order_id, journey_cfg)
                    → return order
                  → db.commit()  # per-leg commit (G2 pattern)
                  → db.refresh(algo_state); db.refresh(grid_entry)
              → Update MTM combined_premium
              → GridEntry.status = OPEN (if orders placed)
              → db.commit()
              → WebSocket notifications
```

SL-Limit order type: ALL orders use `order_type = "SL"` regardless of leg config
(`algo_runner.py:1169`). Buffer: `max(1.0, ltp * 0.001)`.

#### ORB Entry

```
# At 09:15 (activate_all):
algo_runner.register_orb(grid_entry_id, algo_id, algo_name,
                          orb_start_time, orb_end_time, algo_dte)
  → ORBTracker.register(ORBWindow(...))

# During ORB window (tick path):
LTPConsumer._process_ticks → orb_tracker.on_tick(token, ltp, tick)
  → ORBTracker evaluates: is LTP crossing above orb_high OR below orb_low?

# orb_entry_at per leg:
#   "high" = enter when LTP crosses ORB High (bullish breakout)
#   "low"  = enter when LTP crosses ORB Low  (bearish breakdown)

# On breakout:
on_orb_entry(grid_entry_id, entry_price, orb_high, orb_low) callback fires
  → algo_runner._make_orb_callback(grid_entry_id)  (algo_runner.py:1940)
  → _orb_levels[grid_entry_id] = (orb_high, orb_low)
  → persist orb_high/orb_low to AlgoState
  → algo_runner.enter(grid_entry_id, force_direct=True, force_immediate=True)

# At orb_end_time (no breakout):
scheduler._job_orb_end(grid_entry_id)
  → if AlgoState still WAITING: set status=NO_TRADE
```

#### W&T (Wait and Trade) Entry

```
# At entry_time (for DIRECT algos with wt_enabled legs):
scheduler._job_entry → algo_runner.enter(grid_entry_id)
  → _enter_with_db_inner → _place_leg(...)
    → if leg.wt_enabled and leg.wt_value and not force_direct:
        → fetch live option LTP from LTPConsumer._ltp_map
        → compute threshold = ltp ± wt_value (pts or pct) in wt_direction
        → WTEvaluator.register(WTWindow(
              grid_entry_id, algo_id, direction, entry_time,
              instrument_token, wt_value, wt_unit,
              reference_price=ltp, threshold=threshold,
              is_ref_set=True
          ))
        → LTPConsumer.subscribe([instrument_token])
        → cache in _wt_arming_cache[ge_id] = {
              instrument_token, symbol, reference_price, threshold,
              direction, wt_value, wt_unit, entry_time, algo_id
          }  # plain Python primitives ONLY
        → return None  # leg deferred

# On tick (while monitoring):
LTPConsumer._process_ticks → wt_evaluator.on_tick(token, ltp, tick)
  → WTEvaluator: checks if ltp crosses threshold in wt_direction

# On trigger:
_make_wt_callback(grid_entry_id) fires
  → schedule_immediate_entry(grid_entry_id, force_direct=True, force_immediate=True)
    → APScheduler.add_job(algo_runner.enter, DateTrigger(now+2s), ...)
      → enter(grid_entry_id, force_direct=True, force_immediate=True)
        → _enter_with_db → _place_leg(force_direct=True)
          → W&T check skipped (force_direct=True)
          → fetches _wt_entry_ref from _wt_arming_cache
          → order.entry_reference = _wt_entry_ref (float)
          → place_order → OPEN

# At exit_time (W&T threshold never crossed):
For INTRADAY: scheduler._job_auto_sq fires → exit_all()
AlgoState stays WAITING → NO_TRADE if entry_time passes with no fill
```

---

### 3.4 Position Monitoring

#### SL/TP Monitoring

**Callback function**: `on_sl_hit` / `on_tp_hit` — closures returned by
`_make_sl_callback()` / `_make_tp_callback()` (`algo_runner.py:1804` / `1864`).

Registration: `SLTPMonitor.add_position(PositionMonitor(...), on_sl=..., on_tp=...)`
in `_place_leg()` (`algo_runner.py:1432`).

`PositionMonitor` fields: `order_id`, `grid_entry_id`, `algo_id`, `direction`,
`instrument_token`, `underlying_token`, `entry_price`, `underlying_entry_price`,
`quantity`, `sl_type`, `sl_value`, `tp_type`, `tp_value`, `orb_high`, `orb_low`, `symbol`.

`sl_actual` computation (`algo_runner.py:1341–1371`):
- `pts_instrument`: `sl_actual = fill_price ∓ sl_value`
- `pct_instrument`: `sl_actual = fill_price × (1 ∓ sl_value/100)`
- ORB-based: computed from `orb_high`, `orb_low`, `orb_range`
- Others: `sl_actual = sl_value` (raw; monitor computes dynamically)

#### TSL (Trailing Stop Loss)

Arm condition: `tsl_enabled=True AND tsl_x IS NOT NULL AND tsl_y IS NOT NULL`
(`algo_runner.py:1469`).

Trail logic: when profit ≥ `tsl_x`, shift SL by `tsl_y` in favour. Unit: "pts" or "pct".
Registered as `TSLState` in `TSLEngine`. On trail, updates `order.sl_actual` and
`order.tsl_current_sl` in DB.

Reference: `engine/tsl_engine.py` (not read in full but wired in main.py:191).

#### MTM SL/TP

Cross-leg monitoring via `MTMMonitor`. Tracks combined unrealised P&L across all
legs of an algo. Registered in `_enter_with_db_inner` (`algo_runner.py:624`).

`AlgoMTMState(algo_id, account_id, mtm_sl, mtm_tp, mtm_unit)`.
`mtm_unit`: "amt" (₹) or "pct" (% of combined premium).

On breach: `_make_mtm_callback(grid_entry_id)` fires → `exit_all(grid_entry_id, reason="sl"|"tp")`.

---

### 3.5 Exit

#### Scheduled Exit (INTRADAY)

`scheduler._job_auto_sq(grid_entry_id)` (`scheduler.py` — registered at `algo.exit_time`)
→ `algo_runner.exit_all(grid_entry_id, reason="auto_sq")` (`algo_runner.py:1515`)
→ `_exit_all_with_db(db, grid_entry_id, "auto_sq", cancel_broker_sl=True)`
→ for each OPEN order: get LTP → `ExecutionManager.square_off(...)` → `_close_order(db, order, ltp, "auto_sq")`
→ deregister from SLTPMonitor, TSLEngine, TTPEngine, JourneyEngine, MTMMonitor, ReentryEngine
→ `AlgoState.status = CLOSED`; `GridEntry.status = ALGO_CLOSED`

#### SL Hit

`on_sl_hit(order_id, ltp, reason)` callback (`algo_runner.py:1806`):
→ open fresh session `AsyncSessionLocal()`
→ fetch `Order` by `order_id`
→ `_close_order(db, order, ltp, "sl")`
→ deregister TSL/TTP
→ `JourneyEngine.on_exit(db, order, "sl", algo_runner)` if journey_config set
→ `db.commit()`
→ `ReentryEngine.on_exit(db, order, "sl")` if reentry_on_sl
→ `_check_algo_complete(grid_entry_id)` — if all legs closed, mark AlgoState CLOSED

#### Manual Controls (Orders Page)

| Button | Endpoint | Method | What it does |
|--------|----------|--------|-------------|
| SQ | `POST /api/v1/orders/{algo_id}/square-off` | orders.py:1880 | Squares off open orders for an algo today. Uses `ExecutionManager.square_off()` or direct broker call. Deregisters TSL/TTP engines. Updates AlgoState to 'closed' or 'active' (partial). |
| T (Terminate) | `POST /api/v1/algos/{algo_id}/terminate` | algos.py:952 | SQ all positions + cancel APScheduler jobs + deregister monitors + AlgoState=TERMINATED + GridEntry=ALGO_CLOSED |
| RETRY | `POST /api/v1/orders/{grid_entry_id}/retry` | orders.py:2093 | Reset grid_entry→ALGO_ACTIVE, algo_state→WAITING. Cancel existing ERROR orders (status=CANCELLED, exit_reason=SUPERSEDED_BY_RETRY). Schedules `enter()` via APScheduler in 2s (force_direct=not has_wt_legs, force_immediate=True). |
| REPLAY | `GET /api/v1/orders/replay?algo_id=&date=` | orders.py:287 | Read-only. Returns trade replay payload: ENTRY/EXIT events, running P&L curve, summary stats. |
| SYNC | `POST /api/v1/orders/{algo_id}/sync` | orders.py:1694 | Manually sync an untracked broker position. Creates an Order row from broker_order_id. |

---

## 4. STRATEGY MODES

### `INTRADAY` (`strategy_mode = "intraday"`)

| Property | Value |
|----------|-------|
| `is_overnight` | False |
| Exit fires | `exit_time` job (today) via `_job_auto_sq` |
| `next_day_exit_time` | Not used |
| Expiry handling | Options must not expire during the session; no special handling |

### `STBT` (Sell Today Buy Tomorrow) (`strategy_mode = "stbt"`)

| Property | Value |
|----------|-------|
| `is_overnight` | True → broker product = NRML |
| Exit fires | `next_day_exit_time` on next trading day (defaults to "09:15" if not set) |
| `next_day_exit_time` | Used for next-day exit (NOT `exit_time`) |
| SL check | `entry_time - 2 minutes` on next trading day (`sl_check_{ge_id}` job) |
| Expiry handling | Skips activation if underlying expires today |

### `BTST` (Buy Today Sell Tomorrow) (`strategy_mode = "btst"`)

Same as STBT with reversed direction convention. Same overnight/exit/expiry handling.

### `POSITIONAL` (`strategy_mode = "positional"`)

| Property | Value |
|----------|-------|
| `is_overnight` | True → broker product = NRML |
| Exit fires | When `dte` days before expiry (auto-exit) or manual |
| `next_day_exit_time` | Used if configured |
| `dte` | Days to expiry threshold (1–30); NULL = exit on expiry day |

For STBT/BTST: `_next_trading_day()` (`scheduler.py:215`) finds the next Mon–Fri day
not in `NSE_HOLIDAYS_2026_27` frozenset.

---

## 5. JOURNEY LEGS

Journey = a child leg that fires when a parent leg exits (SL or TP).

**Registration** (`algo_runner.py:1505–1510`):
```python
journey_cfg = getattr(leg, "journey_config", None)
if self._journey_engine and journey_cfg:
    journey_trigger = getattr(leg, "journey_trigger", None) or 'either'
    self._journey_engine.register(str(order.id), journey_cfg, depth=1, journey_trigger=journey_trigger)
```

`journey_trigger` values:
- `"either"` — fire child leg on either SL or TP exit
- `"sl"` — fire only on SL exit
- `"tp"` — fire only on TP exit

**On parent exit** (`on_sl_hit` / `on_tp_hit`, `algo_runner.py:1829` / `1890`):
```python
await self._journey_engine.on_exit(db, order, "sl"|"tp", self)
```

`JourneyEngine.on_exit` (`engine/journey_engine.py` — wired as singleton `journey_engine_singleton`):
- Checks `journey_trigger` matches exit reason
- Builds child `LegSnapshot` from `journey_config` dict
- Calls `algo_runner._place_leg(...)` with child leg config
- Sets `order.journey_level` tracking: parent = "1", child = "1.1", grandchild = "1.1.1"

Child order is placed inside the same DB session as the parent's close commit,
ensuring atomicity of parent-close + child-open.

---

## 6. RE-ENTRY

Per-leg configuration (`AlgoLeg`):
- `reentry_on_sl: bool` — re-enter after SL hit
- `reentry_on_tp: bool` — re-enter after TP hit
- `reentry_max_sl: int` — max SL re-entries (0 = disabled)
- `reentry_max_tp: int` — max TP re-entries (0 = disabled)
- `reentry_type`: `"re_entry"` (same config) or `"re_execute"` (re-run full strategy)
- `reentry_ltp_mode`: `"ltp"` or `"candle_close"` — when to re-enter

Counter tracking:
- `AlgoState.reentry_count` — total re-entries today (DB, persisted)
- `AlgoState.sl_reentry_count` / `tp_reentry_count` — split per type (DB)

**Flow** (`engine/reentry_engine.py` — wired via `reentry_engine` singleton):
- `ReentryEngine.on_exit(db, order, reason)` called after SL/TP close
- Checks `reentry_on_sl/tp` flag and counter vs `reentry_max_sl/tp`
- Waits for LTP to return to entry zone (`reentry_ltp_mode` determines timing)
- Calls `algo_runner.enter(grid_entry_id, reentry=True, original_order=order)`
  → for re-entries, same `symbol/token/expiry` from `original_order` is reused
    (bypasses strike selection, `algo_runner.py:983–988`)

---

## 7. TICK PIPELINE — Data Flow

```
SmartStream (Angel One WebSocket)
  → AngelOneTickerAdapter._on_data()     ltp_consumer.py:233
    → normalise: ltp_paise / 100.0       ltp_consumer.py:243
    → run_coroutine_threadsafe(
          LTPConsumer._process_ticks(normalized), loop
      )

OR

Zerodha KiteTicker (threaded)
  → LTPConsumer._on_ticks()              ltp_consumer.py:536
    → run_coroutine_threadsafe(
          LTPConsumer._process_ticks(ticks), loop
      )

LTPConsumer._process_ticks(ticks)        ltp_consumer.py:558
  1. Redis pipeline: setex ltp:{token} 86400 {ltp}  (all ticks in one pipeline)
  2. _ltp_map[token] = ltp               (in-memory sync cache)
  3. _ltp_timestamps[token] = monotonic  (staleness tracking)
  4. ws_manager.broadcast_ticker(ticker_prices)  (index names → frontend)
     ws_manager.broadcast_ltp_batch(ltp_batch)   (position tokens → frontend)
  5. for each callback:
       await orb_tracker.on_tick(token, ltp, tick)       engine/orb_tracker.py
       await wt_evaluator.on_tick(token, ltp, tick)      engine/wt_evaluator.py
       await tsl_engine_ins.on_tick(token, ltp, tick)    engine/tsl_engine.py
       await ttp_engine_ins.on_tick(token, ltp, tick)    engine/ttp_engine.py
       await sl_tp_monitor.on_tick(token, ltp, tick)     engine/sl_tp_monitor.py
       await _bot_runner_tick(token, ltp, ts)            main.py:293 wrapper
         → bot_runner.on_tick(token, price, ts)          engine/bot_runner.py:316
  6. (for underlying tokens): _underlying_tick_cb(token, ltp, tick)
         → sl_tp_monitor.update_underlying_ltp(token, ltp)
```

**`_ltp_map` memory growth note** (PENDING issue #5):
`LTPConsumer._ltp_map` accumulates one entry per unique instrument token ever seen.
During a trading session, options for all strikes are subscribed; across weeks, this
grows unbounded. The map is NEVER evicted or reset. Recommendation: add a daily reset
call in `daily_system_reset()` (e.g. at 08:00 IST) to clear `_ltp_map` and
`_ltp_timestamps` so only today's instruments accumulate.

---

## 8. BOTS ENGINE

### BotRunner.load_bots() — `engine/bot_runner.py:137`

Startup sequence:
1. `refresh_mcx_tokens()` — scan instrument master for nearest active FUTCOM contracts,
   update `MCX_TOKENS` dict in-place
2. DB query: `SELECT * FROM bots WHERE status IN ('active','live') AND is_archived=False`
3. Restore open positions from `bot_orders` (guards against corrupt P&L on restart)
4. Seed `_last_signal` dedup dict from latest `bot_signals` per bot
5. `load_daily_data()` — fetch previous-day OHLC for DTR bots
6. `_warmup_strategies()` — pre-load historical intraday candles for Channel/TT Bands bots

For each bot: `_init_bot(bot)` creates `CandleAggregator(timeframe_mins)` and a
strategy instance (`DTRStrategy` / `ChannelStrategy` / `TTBandsStrategy`).
Then subscribes MCX token: `LTPConsumer.subscribe([MCX_TOKENS[bot.instrument]])`.

### CandleAggregator — `engine/candle_fetcher.py`

Accumulates LTP ticks into OHLC candles of a fixed timeframe (e.g. 60-minute).
`on_tick(price, ts)` → returns completed `Candle` or `None`.
State: `current_candle`, `candles` list (historical window).

### Channel Strategy

Per-bot configuration:
- `entry_tf` (from `bot.timeframe_mins`) — timeframe for entry signals
- `channel_tf` (from `bot.channel_tf`) — separate aggregator for channel calculation
- `num_candles` (from `bot.channel_candles`) — lookback window for channel

When `channel_tf != entry_tf`, a **separate** `CandleAggregator` is created
(`_channel_aggregators[bot_id]`). Both aggregators receive every tick. Entry signals
fire on `entry_tf` candle completion; channel levels are read from the `channel_tf`
aggregator's `candles` list.

### DTR Strategy

Requires previous-day OHLC data (loaded by `load_daily_data()` at 09:00 IST).
Computes DTR (Daily True Range) levels from previous close/high/low.

### MCX Session Guard

`on_tick()` checks MCX session hours: morning (09:00–11:30), evening (15:30–23:30).
On session OFF→ON transition, all aggregators are reset to discard stale cross-session
candles (`bot_runner.py:331–345`).

### Warmup — `_warmup_single_bot()`

Pre-loads historical intraday candles so Channel and TT Bands strategies have a
filled candle window immediately at startup (no cold-start delay).

Channel_tf bug fix (committed before ba853b8): previously `channel_tf` was parsed as
string and compared directly to `bot.timeframe_mins` (int), causing always-mismatch
and duplicate aggregators. Fixed by explicit `int(bot.channel_tf)` conversion.

### `bot_signals` table

Signal fields: `bot_id`, `signal_type` (entry/exit/rollover), `direction` (BUY/SELL),
`instrument`, `expiry`, `trigger_price`, `reason`, `status`, `fired_at`,
`candle_timestamp`. Unique constraint on `(bot_id, signal_type, direction, candle_timestamp)`
prevents duplicate signals per candle.

---

## 9. BROKER LAYER

### Three Angel One Instances

| Instance | `account` arg | `client_id` from | Purpose |
|----------|--------------|-----------------|---------|
| `angelone_mom` | "mom" | `ANGELONE_MOM_CLIENT_ID` | F&O trading (primary) |
| `angelone_wife` | "wife" | `ANGELONE_WIFE_CLIENT_ID` | MCX (Phase 2) |
| `angelone_karthik` | "karthik" | `ANGELONE_KARTHIK_CLIENT_ID` | Instrument master source; F&O |

All share a **class-level** `_master_cache` and `_master_date` (`angelone.py:55–57`),
so the ~40 MB instrument master is downloaded once per day regardless of which
instance calls `get_instrument_master()`.

### PRACTIX Mode

When `grid_entry.is_practix = True`:
- `OrderPlacer` uses `VirtualOrderBook` instead of real broker API
- Fill price = current LTP (from SmartStream or REST fallback)
- No real orders placed at exchange
- P&L calculated the same way as LIVE orders (using exit_price vs fill_price)
- Pre-execution checks skip broker token validation
- Exit LTP is always fetched via REST (PRACTIX + LIVE-WS-stale path in `_exit_all_with_db`,
  `algo_runner.py:1600–1611`)

### SENSEX/BFO — exchangeType=4

SENSEX options trade on BSE F&O segment (BFO), not NFO. Fix (commit f7a4543):

In `_place_leg()` (`algo_runner.py:1395–1401`):
```python
if _instrument_exchange == "BFO":
    self._ltp_consumer.register_bfo_tokens([instrument_token])
    logger.info(f"[BFO] Registered BFO token {instrument_token} for {symbol}")
self._ltp_consumer.subscribe([instrument_token])
```

In `AngelOneTickerAdapter._build_token_list()` (`ltp_consumer.py:170`):
- BFO tokens → `exchangeType: 4` (not 2)
- NFO tokens → `exchangeType: 2`

Without this registration, SENSEX option ticks were subscribed with `exchangeType=2`
(NFO), which Angel One ignored — resulting in LTP stuck at fill price and P&L = 0.

### SmartStream Subscription: Token Registration

Token routing in `_build_token_list()` (`ltp_consumer.py:170`):
```python
index_set  → exchangeType=1  (NSE cash — NIFTY, BANKNIFTY, FINNIFTY, etc.)
mcx_tokens → exchangeType=5  (MCX — GOLDM, SILVERMIC)
bfo_tokens → exchangeType=4  (BFO — SENSEX/BANKEX options)
nfo_tokens → exchangeType=2  (NFO — all other options/futures)
```

Token sets must be registered BEFORE `subscribe()` is called. If `set_angel_adapter()`
is called after tokens are already subscribed, the adapter replays all tokens via
`set_angel_adapter()` (`ltp_consumer.py:393`).

### Order Placement Flow

```
algo_runner._place_leg()
  → ExecutionManager.place(db, idempotency_key, algo_id, account_id,
                            symbol, exchange, direction, quantity,
                            order_type="SL", ltp, limit_price, trigger_price,
                            algo_tag, is_practix, is_overnight, broker_type,
                            symbol_token)
    [ExecutionManager: dedup via idempotency_key, log to execution_logs]
    → OrderPlacer.place(...)
      → if is_practix: VirtualOrderBook.place(...)
      → elif broker_type == "angelone": AngelOneBroker.place_order(...)
          → SmartConnect.placeOrder(order_params)  [run_in_executor]
          → returns: order_id = data["data"]["orderid"]
      → elif broker_type == "zerodha": ZerodhaBroker.place_order(...)
    → returns order_id_str

  → fill_price parsed from: ltp (pre-fetched from SmartStream or REST)
  → [LIVE exits]: wait 2s + 1 retry → fetch averageprice from broker orderbook
  → order.fill_price = fill_price
  → order.broker_order_id = order_id_str
  → order.status = OPEN
```

Angel One response parsing (`angelone.py:669`):
```python
order_id = data.get("data", {}).get("orderid", "")
```

---

## 10. KNOWN ISSUES AND STATUS

### Issue 1 — MissingGreenlet — RESOLVED (commit ba853b8)

**Problem**: `sqlalchemy.exc.MissingGreenlet: greenlet_spawn has not been called`
crashing algo entries at 09:15.

**Root cause**: In the pre-refactor `scheduler.py:_job_activate_all()`, the code
accessed `algo.legs[0].underlying` on an ORM object after the SQLAlchemy session had
closed. SQLAlchemy 2.0 async sessions require a "greenlet bridge" to perform lazy
attribute loading. When called outside a session context (e.g. in a `create_task` or
`ensure_future` callback), no bridge exists → crash.

**Fix**:
1. `schedule_algo_jobs()` now takes `first_leg_underlying: str` as a parameter — the
   caller pre-fetches this value inside an open session before calling the function.
2. `snapshots.py` was completed with `snapshot_grid_entry_full()`, providing a clean
   crossing point from ORM to plain Python dataclasses.
3. All scheduler job args are now plain Python primitives (str IDs, never ORM objects).
4. Pattern `_algo_id_str = str(algo.id)` before any `try/except` in `_enter_with_db_inner`
   (`algo_runner.py:650–654`) ensures attributes captured before potential rollbacks.

**Current status**: RESOLVED. No MissingGreenlet errors in production.

---

### Issue 2 — Duplicate Legs on RETRY — RESOLVED (commit 35a813d)

**Problem**: Clicking RETRY created new OPEN orders alongside existing ERROR orders,
causing duplicate legs visible in the Orders page.

**Root cause**: The RETRY endpoint reset AlgoState to WAITING and fired `enter()`,
but did not cancel/supersede the existing ERROR order records. The engine then created
new orders, leaving both ERROR and OPEN rows for the same leg.

**Fix**: `retry_entry()` (`orders.py:2148–2154`) now runs an UPDATE before firing enter:
```python
await db.execute(
    update(Order)
    .where(Order.grid_entry_id == ge.id, Order.status == OrderStatus.ERROR)
    .values(status=OrderStatus.CANCELLED, exit_reason=ExitReason.SUPERSEDED_BY_RETRY)
)
```
New `ExitReason.SUPERSEDED_BY_RETRY` enum value added (`order.py:36`).
Migration 0040 added `superseded_by_retry` to the ExitReason enum.

**Current status**: RESOLVED.

---

### Issue 3 — SENSEX/BFO P&L = 0 — RESOLVED (commit f7a4543)

**Problem**: SENSEX option orders showed P&L = 0 throughout the session and at close.

**Root cause**: Angel One SmartStream was subscribing BFO tokens (SENSEX/BANKEX options)
with `exchangeType=2` (NFO). Angel One's WebSocket server ignores subscriptions with
the wrong exchange type, so no ticks were delivered for SENSEX options. LTP stayed
stuck at fill_price, giving P&L = 0.

**Fix**: Added `register_bfo_tokens([instrument_token])` call in `_place_leg()`
before `subscribe()` for instruments with `exchange == "BFO"`. The
`_build_token_list()` method now routes BFO tokens to `exchangeType=4`.

**Current status**: RESOLVED.

---

### Issue 4 — Cross-Day P&L Attribution — RESOLVED (commit 344ead5)

**Problem**: LTP polling on the Orders page was updating P&L display for all tabs
(e.g. yesterday's closed orders showed wrong P&L when viewed while today's tab was
open).

**Root cause**: Frontend `useEffect` for LTP polling lacked a date guard — it fired
even when the selected trading date was not today.

**Fix**: Added `isToday` guard to the LTP polling `useEffect` on the frontend.
Polling now only runs when `selected_date === today`.

**Current status**: RESOLVED.

---

### Issue 5 — LTPConsumer._ltp_map Never Evicted — PENDING

**Problem**: `_ltp_map: Dict[int, float]` in `LTPConsumer` accumulates entries for
every instrument token ever subscribed. Options tokens from previous weeks remain in
memory indefinitely. Over weeks/months, this could grow to tens of thousands of entries.

**Root cause**: No eviction or daily reset mechanism exists.

**Recommendation**: Add `ltp_consumer._ltp_map.clear(); ltp_consumer._ltp_timestamps.clear()`
to `daily_system_reset()` in `api/v1/system.py`. Run at 08:00 IST before market open.

**Current status**: PENDING.

---

### Issue 6 — N+1 Queries in `list_algos`, `_job_activate_all` — PENDING (HIGH-RISK)

**Problem**: `list_algos` endpoint executes a separate query per algo to fetch legs
and account details. `_job_activate_all` iterates over (GridEntry, Algo) rows and
issues a per-row query for AlgoLeg (leg lookup for expiry check).

**Root cause**: ORM queries not using `joinedload()` or bulk fetches.

**Risk**: At scale (50+ algos), this causes 50+ sequential DB round-trips at 09:15
activation, potentially delaying entry jobs.

**Recommendation**: Rewrite to use `selectinload` or bulk `IN` queries.

**Current status**: PENDING.

---

### Issue 7 — Alembic Indexes Migration — PENDING

**Problem**: Several foreign-key and status columns lack database indexes, causing
slow queries on large datasets (e.g. `orders` table filtered by `status` or
`grid_entry_id`).

**Root cause**: Agent 5 audit identified missing indexes not covered by existing
migrations.

**Fix pending**:
```bash
cd ~/STAXX/staax/backend
alembic revision --autogenerate -m "add_missing_indexes"
alembic upgrade head
```

**Current status**: PENDING.

---

## 11. PENDING OPTIMIZATIONS

From Agent 5 audit and current code review:

1. **N+1 in `list_algos`**: Use `selectinload` for legs. See Issue 6.

2. **N+1 in `_job_activate_all`**: Batch-fetch all first legs via `WHERE algo_id IN (...)`
   rather than one-per-algo query. See Issue 6.

3. **`_ltp_map` daily eviction**: Add clear() call at 08:00 IST. See Issue 5.

4. **`_chain_cache` TTL**: `AngelOneBroker._chain_cache` uses `time.monotonic()` TTL
   of 60 seconds. On process restart the cache is lost but a new download is not
   triggered until first trade attempt. Consider pre-warming on startup for all
   underlyings scheduled that day.

5. **Angel One instrument master stale check**: `_master_date == date.today()` guard
   means a restart before midnight uses a stale master. The disk cache meta file
   resolves this for day-boundary restarts but not mid-day restarts if the master was
   force-refreshed.

6. **`_wt_arming_cache` never cleared on CLOSED algos**: W&T arming cache entries
   for today's grid entries are only cleared in `_place_leg()` when force_direct=True
   (on W&T trigger). If a W&T algo goes to NO_TRADE (threshold never crossed), its
   cache entry remains until process restart.

7. **`OrderReconciler` interval**: Every 15 seconds — reasonable for development but
   may cause Angel One API rate limit pressure in production with many algos.
   Consider adaptive backoff (increase interval when no mismatches for N cycles).

8. **`position_rebuilder.run()` at startup**: Iterates all today's OPEN orders and
   re-registers monitors. For large order counts, this is sequential. Could be
   parallelized with `asyncio.gather()`.

9. **Missing DB indexes** (Issue 7): Alembic migration needed for composite indexes
   on `(grid_entry_id, status)`, `(algo_id, trading_date)`, `(account_id, status)`.

10. **`_lot_size_cache` clearing**: Cache clears daily (mentioned in comment,
    `algo_runner.py:148–149`). Verify this is called in `daily_system_reset()`.

---

## 12. ARCHITECTURE DECISIONS AND RATIONALE

### Why APScheduler for Entry Jobs (not `asyncio.create_task`)

`asyncio.create_task()` and `ensure_future()` schedule coroutines in the event loop
but do NOT provide the SQLAlchemy "greenlet bridge". SQLAlchemy async 2.0 requires
that every DB operation executes inside a greenlet context created by `greenlet_spawn`.
APScheduler's `AsyncIOExecutor` wraps each job invocation in a proper greenlet context.

The MissingGreenlet bug (Issue 1) was directly caused by code that accessed ORM
attributes outside a session context — either via lazy load on a detached object
or by crossing the session boundary without capturing plain Python values first.

`schedule_immediate_entry()` (`scheduler.py:337`) is the canonical pattern: always
use `APScheduler.add_job(..., DateTrigger(now+2s))` to schedule a coroutine that
needs DB access. **Never** use `asyncio.create_task()` for DB-touching coroutines
invoked from scheduler contexts.

### Why `snapshots.py` (not ORM Everywhere)

SQLAlchemy async sessions are intentionally short-lived — they must close promptly
to return connections to the pool. Holding a session open across engine callbacks,
SL/TP monitors, and tick handlers would exhaust the connection pool.

`snapshot_grid_entry_full()` creates an entirely plain Python `GridEntrySnapshot`
inside a session. Once the session closes, the snapshot is safe to use anywhere:
in callbacks, in APScheduler jobs, in monitor threads, in `asyncio.create_task()`.
This is "the crossing point" — ORM objects exist only inside their session; everything
outside the session boundary uses snapshots.

### Why Three Separate Broker Instances (not One Shared)

Each Angel One account has different API credentials (`api_key`, `client_id`,
`totp_secret`), different rate limits (Angel One enforces per-client-ID limits),
and different positions (mom's F&O vs wife's MCX). The `SmartConnect` SDK object
manages authentication state per-instance. Sharing a single instance would require
re-authenticating on every switch between accounts, which is error-prone and slow.

The `_angel_broker_map` keyed by `client_id` allows per-account routing in
`_place_leg()` and `_exit_all_with_db()` without any global mutable state.

### Why GridEntry Per Day (not Single Algo Object Managing State)

`GridEntry` + `AlgoState` gives:
1. **Clean daily reset**: Each trading day starts with a fresh `AlgoState`. Yesterday's
   error or P&L does not bleed into today.
2. **Audit trail**: Historical performance is queryable by `trading_date` without
   scanning all orders.
3. **Per-day overrides**: `lot_multiplier` and `is_practix` can differ per day without
   changing the algo config.
4. **Smart Grid UX**: The grid shows one cell per (algo, day), each with independent
   status, multiplier, and enable/disable toggles.

### Why SmartStream WebSocket (not REST Polling)

SEBI's algo trading regulations require sub-second response to SL triggers. REST polling
at even 1-second intervals introduces up to 1-second delay on SL breaches. At high
volatility (flash crashes, news events), this can result in significant additional loss.

Angel One SmartStream delivers ticks with sub-100ms latency (typical 5–30 ms end-to-end
from exchange match to callback execution). All SL/TP evaluation happens in-memory
(zero DB queries on tick path) in `SLTPMonitor.on_tick()`, enabling consistent
sub-100ms SL response time.

### Why Per-Leg Commit Pattern (G2) in `_enter_with_db_inner`

Multi-leg entries (straddles, strangles) can have partial failures. If leg 1 succeeds
but leg 2 fails, without per-leg commits:
- A rollback would undo leg 1's DB record while leg 1's order is live at the broker
- The reconciler would catch the orphan but only on its next 15-second cycle

With per-leg commits (`db.commit()` after each `_place_leg()`):
- Each successful leg is durably persisted independently
- A leg 2 failure only rolls back leg 2's uncommitted work
- `exit_on_entry_failure=True` can still square off leg 1 by fetching it from DB

### Why SEBI Mandates SL-Limit (not Market Orders)

SEBI's algo trading circular requires all algorithmic orders to use SL-Limit order
type (not market orders) to prevent runaway algo orders from moving the market.
STAAX enforces this unconditionally: `_order_type = "SL"` in `_place_leg()`
(`algo_runner.py:1169`) regardless of `leg.order_type` value.

Buffer: `max(1.0, ltp * 0.001)` — at least ₹1 or 0.1% of LTP, whichever is larger.
This ensures the limit price is far enough from the trigger to get filled in normal
market conditions while complying with SL-Limit requirements.

---

## 13. STATUS REFERENCE

### Order Status (per-leg, shown in Orders page only)
| Status | When it appears |
|--------|-----------------|
| OPEN | Order filled, position live and being monitored |
| CLOSED | Position fully exited for any reason |
| MISSED | Order never placed — expiry skip, ORB expired, mode guard |
| ERROR | Placement attempted but failed — strike not found, broker reject, engine error |
| CANCELLED | Superseded by retry — old error leg, hidden from default view |

### Exit Reason → Display Label
| DB value | Displayed as | What triggered it |
|----------|-------------|-------------------|
| sl | SL Hit | Per-leg SL breached |
| tsl | TSL Hit | Trailing SL breached |
| tp | TP Hit | Per-leg TP hit |
| ttp | TTP Hit | Trailing TP hit |
| mtm_sl | MTM SL | Combined algo P&L hit MTM stop loss |
| mtm_tp | MTM TP | Combined algo P&L hit MTM target |
| auto_sq | Exit Time | Scheduled exit_time job fired |
| sq | SQ | User clicked SQ button |
| manual | Manual | Manually marked as squared |
| terminate | Terminate | User terminated algo |
| expiry | Expiry | Force closed on expiry day |
| reconcile | Reconcile | Reconciliation job closed position |
| btst_exit | BTST Exit | Next-morning BTST exit job |
| stbt_exit | STBT Exit | Next-morning STBT exit job |

### Internal Engine States (backend only — never shown to user)
WAITING, MONITORING, RETRY, SQ are internal engine states managed
by AlgoRunner. They are never exposed in the API or frontend.

---

## 14. SLO Targets & Operational Thresholds

### 14.1 Tick-to-Signal Latency
| Path | Target | Alarm |
|------|--------|-------|
| SmartStream tick → Redis write | < 5ms | > 20ms |
| Redis write → SLTPMonitor check | < 10ms | > 50ms |
| SL breach → order dispatch | < 50ms | > 200ms |
| W&T threshold → entry dispatch | < 100ms | > 500ms |

### 14.2 Order Fill Latency
| Leg type | Target fill | Max acceptable |
|----------|-------------|----------------|
| Market order (NFO) | < 500ms | 2s |
| Market order (BFO) | < 1s | 3s |
| SL-M order placement | < 200ms | 1s |

### 14.3 System Availability
| Component | Target uptime | Recovery action |
|-----------|---------------|-----------------|
| Backend API | 99.5% (market hours) | Auto-restart via systemd |
| SmartStream WS | Best-effort | Reconnect with 5s backoff |
| PostgreSQL | 99.9% | RDS Multi-AZ failover |
| Redis | 99.5% | Restart; ltp_map rebuilt from ticks |

### 14.4 Data Integrity
- All orders have a DB record before broker dispatch
- All fills reconciled against broker trade book within 5 minutes of market close
- MTM P&L accuracy: within ±0.5% of broker's own P&L report
- No duplicate orders: `_exiting_orders` guard + DB unique constraint on (algo_id, entry_time, status='open')

### 14.5 Alert Thresholds
| Metric | Warning | Critical |
|--------|---------|----------|
| MissingGreenlet errors | 1/hour | 1/min |
| Consecutive order rejections | 3 | 5 |
| LTP staleness (no tick for token) | 30s | 2min |
| Memory growth | 200MB/hour | 500MB/hour |
| Unhandled exceptions in tick pipeline | 5/min | 20/min |

---

*End of STAAX_ARCHITECTURE_2026-04-22.md*
*Generated from code state as of commit ba853b8*
*Supersedes STAAX_ARCHITECTURE.md*
