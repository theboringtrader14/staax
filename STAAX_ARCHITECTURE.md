# STAAX Architecture

> Derived from actual source code as of 2026-04-22. Current DB revision: **0039**.

---

## 1. System Overview

STAAX is a FastAPI-based algo trading platform with a single-process architecture where all engine singletons share the same event loop.

### Component Map

```
┌─────────────────────────────────────────────────────────────────────┐
│                        FastAPI Process                               │
│                                                                      │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐  │
│  │   REST API   │    │  WebSocket   │    │   APScheduler        │  │
│  │  /api/v1/    │    │  /ws/        │    │  (AsyncIOScheduler)  │  │
│  └──────┬───────┘    └──────┬───────┘    └──────────┬───────────┘  │
│         │                   │                        │               │
│  ┌──────▼───────────────────▼────────────────────────▼───────────┐  │
│  │                       AlgoRunner (singleton)                   │  │
│  │  wire_engines() receives all singletons at startup             │  │
│  └───┬──────┬──────┬──────┬──────┬──────┬──────┬──────┬─────────┘  │
│      │      │      │      │      │      │      │      │             │
│  SLTPMonitor TSL  TTP  MTM   ORB   W&T  Reentry Journey            │
│              Engine Engine Monitor Tracker Eval  Engine Engine      │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  LTPConsumer  ← SmartStream (Angel One WebSocket, thread)     │  │
│  │  LTPConsumer  ← KiteTicker  (Zerodha WebSocket, if Zerodha)   │  │
│  │  Callbacks: ORBTracker, WTEvaluator, TSLEngine, TTPEngine,    │  │
│  │             SLTPMonitor, BotRunner                            │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────────────────┐  │
│  │ Zerodha  │  │  Angel One   │  │  ExecutionManager (idempotent) │  │
│  │ Broker   │  │  (mom/wife/  │  │  → OrderPlacer                │  │
│  │          │  │   karthik)   │  │  → VirtualOrderBook (PRACTIX) │  │
│  └──────────┘  └──────────────┘  └───────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
         │                                 │
  ┌──────▼──────┐                   ┌──────▼──────┐
  │ PostgreSQL  │                   │    Redis     │
  │ (async SA)  │                   │  (LTPCache)  │
  └─────────────┘                   └─────────────┘
```

### Component Descriptions

| Component | Module | Role |
|---|---|---|
| **AlgoRunner** | `engine/algo_runner.py` | Central orchestrator. Resolves strikes, places orders, registers monitors. One singleton. |
| **AlgoScheduler** | `engine/scheduler.py` | APScheduler `AsyncIOScheduler`. Fires all time-based jobs (09:15 activation, entry, exit, ORB end). |
| **LTPConsumer** | `engine/ltp_consumer.py` | Receives WebSocket ticks from Angel One SmartStream or Zerodha KiteTicker. Maintains `LTPCache` in Redis. Dispatches to registered callbacks. |
| **SLTPMonitor** | `engine/sl_tp_monitor.py` | Per-order SL/TP watcher. Receives ticks from LTPConsumer and fires `on_sl` / `on_tp` callbacks. |
| **TSLEngine** | `engine/tsl_engine.py` | Trailing Stop Loss. On each tick: if profit moved ≥ tsl_x, shift SL by tsl_y. |
| **TTPEngine** | `engine/ttp_engine.py` | Trailing Target Profit. Mirrors TSL logic for targets. |
| **MTMMonitor** | `engine/mtm_monitor.py` | Tracks per-algo mark-to-market P&L. Fires `on_breach` when mtm_sl or mtm_tp is hit. |
| **ORBTracker** | `engine/orb_tracker.py` | During ORB window: records high/low of underlying. On breakout: fires `on_orb_entry` callback. |
| **WTEvaluator** | `engine/wt_evaluator.py` | Wait-and-Trade. Watches option token LTP. Fires `on_entry` when threshold crossed. |
| **JourneyEngine** | `engine/journey_engine.py` | Fires child legs after parent leg exits. Supports up to 3 levels deep. |
| **ReentryEngine** | `engine/reentry_engine.py` | Re-entry after SL/TP exit. Two modes: `re_entry` (price watcher) and `re_execute` (immediate fresh strike). |
| **ExecutionManager** | `engine/execution_manager.py` | Single control point for all order placement/cancellation. Handles idempotency keys. |
| **OrderPlacer** | `engine/order_placer.py` | Routes orders to Zerodha or Angel One broker API. |
| **VirtualOrderBook** | `engine/virtual_order_book.py` | PRACTIX (paper trading) fill simulation. |
| **StrikeSelector** | `engine/strike_selector.py` | Resolves ATM/ITM/OTM/premium strikes from broker instrument master. |
| **PositionRebuilder** | `engine/position_rebuilder.py` | At startup: re-registers open positions with SLTPMonitor/TSL/TTP/MTM after server restart. |
| **OrderReconciler** | `engine/order_reconciler.py` | Every 15s: checks broker order book against DB, flags mismatches. |
| **BotRunner** | `engine/bot_runner.py` | MCX commodity bots. Receives candle ticks via LTPConsumer. Separate from algo lifecycle. |
| **BrokerReconnectManager** | `engine/broker_reconnect.py` | Every 3s: checks LTP feed staleness, triggers reconnect if stale. |

### Startup Order (lifespan in `main.py`)

1. DB + Redis connect
2. Broker instances created (Zerodha, AO mom/wife/karthik)
3. Angel One instrument master pre-warmed (~40 MB)
4. Expiry calendar built from instrument master
5. LTPConsumer + LTPCache created (ticker injected later)
6. Engine singletons created and wired
7. `AlgoRunner.wire_engines()` called
8. Scheduler created, `set_algo_runner()` called
9. LTP callbacks registered: ORBTracker, WTEvaluator, TSLEngine, TTPEngine, SLTPMonitor
10. Scheduler started, fixed daily jobs registered
11. Recovery jobs: `recover_today_jobs()`, `recover_multiday_jobs()`
12. `PositionRebuilder.run()` — re-registers live open positions
13. BotRunner wired and bots loaded
14. All broker tokens loaded from DB
15. Angel One broker map built (client_id → broker instance)
16. Global MTM monitors registered for accounts with global SL/TP
17. Angel One auto-login for stale/missing tokens (TOTP from .env)
18. Grid entries auto-created for today's recurring algos
19. Catch-up activation if restarted after 09:15 IST
20. Market feed auto-started if valid token exists in DB

---

## 2. Algo Lifecycle

### 2.1 DB Tables

| Table | Purpose |
|---|---|
| `algos` | Strategy configuration (timing, SL/TP modes, MTM limits) |
| `algo_legs` | Individual legs (instrument, strike, SL, TP, W&T, re-entry, journey) |
| `grid_entries` | Deploys an algo to a specific trading date (`trading_date`, `lot_multiplier`, `is_practix`) |
| `algo_states` | Runtime state for one grid_entry on one day (`WAITING → ACTIVE → CLOSED`) |
| `orders` | Individual leg orders placed (fill_price, sl_actual, target, pnl) |

### 2.2 Algo Creation

**Endpoint:** `POST /api/v1/algos/` (`api/v1/algos.py`)

Creates rows in `algos` + `algo_legs`. Does NOT create `grid_entries` — deployment is a separate step.

**Deploying to a day (grid):** `POST /api/v1/grid/` creates a `GridEntry` row linking the algo to a specific `trading_date`, with `lot_multiplier` and `is_practix` toggle.

### 2.3 GridEntry Daily Activation

Two triggers call `_ensure_today_grid_entries()`:

1. **Startup** (step 18 above): runs for every active algo whose `recurring_days` includes today's weekday.
2. **Cron at 08:50 IST Mon–Fri**: `auto_grid_entries` job in scheduler.

Logic (idempotent):
```python
# main.py: _ensure_today_grid_entries()
entry = GridEntry(
    algo_id=algo.id,
    trading_date=today,
    day_of_week=today_day.lower(),
    lot_multiplier=1,
    is_practix=True,
    status=GridStatus.NO_TRADE,
)
```

### 2.4 09:15 Activation (`_job_activate_all`)

For each enabled `GridEntry` for today:
1. Create `AlgoState(status=WAITING, activated_at=now)`
2. Set `GridEntry.status = ALGO_ACTIVE`
3. Call `schedule_algo_jobs()` — adds APScheduler `DateTrigger` jobs for entry/exit/ORB-end
4. For ORB algos: call `algo_runner.register_orb()` via `asyncio.ensure_future()`

**Expiry skip:** STBT/BTST algos are marked `NO_TRADE` (not activated) if today is the underlying's expiry day, using `ExpiryCalendar`.

### 2.5 Entry Modes

#### DIRECT

```
09:15  _job_activate_all → AlgoState WAITING, schedules entry_{geid} job
HH:MM  _job_entry → _job_entry_coro → algo_runner.enter(grid_entry_id)
       → _enter_with_db_inner()
         → _pre_execution_check() (broker token + SmartStream gate)
         → AlgoState ACTIVE
         → for each leg: _place_leg()
```

`_place_leg()` for DIRECT:
1. StrikeSelector resolves symbol + instrument_token + ltp
2. If `leg.wt_enabled` and NOT `force_direct` → arm WTWindow, return None (deferred)
3. Apply entry delay
4. Compute lot size × lots × base_lot_multiplier × grid_lot_multiplier
5. Rate limiter: 8 orders/sec (SEBI cap 10)
6. Write PENDING order to DB (flush)
7. ExecutionManager.place() → broker API (SL-Limit order; trigger = ltp, limit = ltp ± buffer)
8. Update order: OPEN, fill_price, broker_order_id, latency_ms
9. Compute sl_actual + target (from leg config)
10. Subscribe instrument_token on LTPConsumer
11. Register SLTPMonitor, TSLEngine, TTPEngine, JourneyEngine

#### ORB (Opening Range Breakout)

```
09:15  _job_activate_all → AlgoState WAITING, register_orb() called
       ORBTracker subscribes underlying_token, records high/low during window
HH:MM  _job_orb_end → if still WAITING → NO_TRADE
OR
tick   ORBTracker.on_tick() detects breakout → on_orb_entry callback
       → algo_runner.enter(grid_entry_id, reentry=False)
         (force_direct not set; goes through normal _place_leg)
```

ORB SL/TP computation uses `orb_sl_type`/`orb_tp_type` on `AlgoLeg`:
- `orb_high` / `orb_low` — set to the locked range boundary
- `orb_range` — SL = fill ± (orb_high - orb_low)
- `orb_range_plus_pts` / `orb_range_minus_pts` — add/subtract `orb_buffer_value`

#### W&T (Wait and Trade)

W&T is a **per-leg** feature, not an entry type. Set `AlgoLeg.wt_enabled = True`.

```
entry_time reached → _place_leg() sees wt_enabled=True, force_direct=False
  → StrikeSelector resolves option symbol (to get option's own LTP)
  → reference_price = option LTP at that moment
  → threshold = ref ± wt_value (pts or pct)
  → WTWindow registered with WTEvaluator
  → instrument_token subscribed on LTPConsumer
  → return None (leg deferred)

LTP tick → WTEvaluator.on_tick() → threshold crossed
  → on_wt_entry callback → scheduler.schedule_immediate_entry(force_direct=True)
  → APScheduler fires enter() in 2s → _place_leg(force_direct=True)
  → order placed immediately at current LTP
```

W&T arming details cached in `AlgoRunner._wt_arming_cache[grid_entry_id]` for reconnect recovery.

### 2.6 Position Monitoring

All monitoring is tick-driven via the LTPConsumer callback chain.

#### Per-leg SL/TP (`SLTPMonitor`)

`PositionMonitor` registered per order with:
- `sl_type`: `pts_instrument` | `pct_instrument` | `pts_underlying` | `pct_underlying` | `orb_*`
- `sl_value`, `tp_value`, `orb_high`, `orb_low`
- `underlying_token`: required for `pts_underlying` / `pct_underlying`

On each tick, `SLTPMonitor.on_tick(token, ltp, tick)` computes the effective SL/TP price and fires `on_sl(order_id, ltp, reason)` or `on_tp(order_id, ltp, reason)` callbacks.

For underlying-based types, a separate callback is registered on `ltp_consumer` to forward index ticks to `sl_tp_monitor.update_underlying_ltp()`.

#### TSL (Trailing Stop Loss)

`TSLState` per order. On tick:
- If profit moved ≥ `tsl_x`, shift `sl_actual` by `tsl_y` (same unit)
- Updates `SLTPMonitor` SL level
- Persists `tsl_current_sl`, `tsl_trail_count` on Order

#### TTP (Trailing Target Profit)

`TTPState` per order. Mirror of TSL but trails the target upward (buy) or downward (sell).

#### MTM SL/TP (`MTMMonitor`)

`AlgoMTMState` registered per algo (not per order). `SLTPMonitor` forwards per-leg PNL to `MTMMonitor` via `set_mtm_monitor()` wiring. When combined unrealised + realised P&L crosses `mtm_sl` or `mtm_tp`, fires `on_breach(algo_id, reason, total_pnl)` → `algo_runner.exit_all(grid_entry_id, reason=reason)`.

#### Global MTM

`MTMMonitor.register_global(account_id, global_sl, global_tp, on_breach)` — fires a CRITICAL log alarm when account-level MTM is breached. Manual operator intervention required (no auto-exit wired yet).

### 2.7 Exit Triggers

| Trigger | Source | Path |
|---|---|---|
| **Intraday exit_time** | Scheduler `_job_auto_sq` | `algo_runner.exit_all(grid_entry_id, reason="auto_sq")` |
| **SL hit** | `SLTPMonitor.on_tick` | `on_sl_hit` callback → `_close_order` → check journey/reentry → `_check_algo_complete` |
| **TP hit** | `SLTPMonitor.on_tick` | `on_tp_hit` callback → `_close_order` → check journey/reentry |
| **TSL exit** | `TSLEngine.on_tick` updates SL → `SLTPMonitor` fires | Same as SL path |
| **MTM breach** | `MTMMonitor` | `on_mtm_breach` → `exit_all(reason="mtm_sl"/"mtm_tp")` |
| **Manual SQ (T button)** | `POST /{algo_id}/square-off` | `exit_all(reason="sq")` → AlgoState CLOSED |
| **Terminate** | API endpoint | `exit_all(reason="terminate")` → AlgoState TERMINATED |
| **BTST/STBT auto-exit** | Scheduler `_job_auto_sq` (next trading day) | `exit_all(reason="auto_sq")` |
| **Expiry force-close** | Scheduler 15:15 `_force_close_expiring_positions` | `exit_all(reason="expiry_force_close")` |
| **EOD cleanup** | Scheduler 15:35 `_job_eod_cleanup` | INTRADAY ACTIVE → `exit_all`; WAITING → NO_TRADE |

`_close_order()` updates: `status=CLOSED`, `exit_price=ltp`, `exit_reason`, `pnl`, deregisters TSL/TTP/journey monitors.

---

## 3. Strategy Modes

| Mode | Exit Timing | Product Type | Next-Day Job |
|---|---|---|---|
| **INTRADAY** | `algo.exit_time` same day (APScheduler `DateTrigger`) | MIS | None |
| **BTST** (Buy Today Sell Tomorrow) | `algo.next_day_exit_time` on next trading day | NRML (`is_overnight=True`) | Exit + SL-check jobs scheduled on activation day |
| **STBT** (Sell Today Buy Tomorrow) | `algo.next_day_exit_time` on next trading day | NRML (`is_overnight=True`) | Same as BTST |
| **POSITIONAL** | Configured via `dte` (days to expiry) or manual | NRML | No scheduled exit; relies on SL/TP or manual SQ |

For BTST/STBT, two additional jobs are registered by `schedule_algo_jobs()`:
- `sl_check_{geid}` — fires at `entry_time - 2 minutes` on next trading day
- `exit_{geid}` — fires at `next_day_exit_time` on next trading day

`_next_trading_day()` skips weekends and NSE holidays (`NSE_HOLIDAYS_2026_27` frozenset).

On overnight SL check: `algo_runner.overnight_sl_check(grid_entry_id)` evaluates open positions against their SL at 09:18 (or 2 min before entry for BTST/STBT).

---

## 4. Journey Legs (Chained Execution)

Journey config is stored as JSON on `AlgoLeg.journey_config`:

```json
{
  "level": 1,
  "trigger": "any",
  "child": {
    "instrument": "ce",
    "underlying": "NIFTY",
    "direction": "buy",
    "strike_type": "atm",
    "lots": 1,
    "sl_type": "pts_instrument",
    "sl_value": 20.0,
    "journey_config": null
  }
}
```

`AlgoLeg.journey_trigger` controls which exit fires the child:
- `"sl"` — only SL exits trigger the child
- `"tp"` — only TP exits trigger the child
- `"either"` (default) — any exit triggers the child

**How it works:**

1. When an order is placed, `JourneyEngine.register(order_id, journey_config, depth=1, journey_trigger=...)` is called.
2. When `on_sl_hit` or `on_tp_hit` fires, `JourneyEngine.on_exit(db, order, exit_reason, algo_runner)` is called before `db.commit()`.
3. JourneyEngine checks `journey_trigger` against `exit_reason`. If matched:
   - Creates a `SyntheticLeg` from the child config (duck-types `AlgoLeg`)
   - Calls `algo_runner._place_leg(db, synthetic_leg, ...)` directly
   - Max depth: 3 levels (parent → child → grandchild; great-grandchild's `journey_config` is ignored)

---

## 5. Re-entry Logic

Re-entry is per-leg, controlled by `AlgoLeg` fields:

| Field | Description |
|---|---|
| `reentry_on_sl` | Enable re-entry after SL exit |
| `reentry_on_tp` | Enable re-entry after TP exit |
| `reentry_max_sl` | Max SL re-entries per day (0 = disabled) |
| `reentry_max_tp` | Max TP re-entries per day (0 = disabled) |
| `reentry_max` | Legacy combined max (deprecated but preserved) |
| `reentry_type` | `"re_entry"` (price watcher) or `"re_execute"` (immediate fresh strike) |
| `reentry_ltp_mode` | `"ltp"` (live LTP) or `"candle_close"` (candle close price) |

**Gates (both modes):**
1. `exit_reason` matches configured `reentry_on_sl` / `reentry_on_tp`
2. `algo_state.sl_reentry_count` (or `tp_reentry_count`) < `reentry_max_sl` (or `reentry_max_tp`)
3. Current time < `algo.exit_time`
4. Global kill switch not active

**RE_ENTRY mode:** Creates an `asyncio.create_task` watcher that polls LTP (from Redis `ltp_cache`) until it returns to `trigger_price` (= original `fill_price`). TSL two-step: if TSL was actively trailing at exit, watcher first waits for LTP to touch `sl_original` before watching `trigger_price`.

**RE_EXECUTE mode:** Immediately calls `algo_runner.enter(grid_entry_id, reentry=False)` — fresh strike selection, brand-new order.

**Counts** are tracked separately on `AlgoState.sl_reentry_count` and `AlgoState.tp_reentry_count`, with `AlgoState.reentry_count` kept as the combined total for backward compatibility.

---

## 6. Orders Page Actions

### SYNC — `POST /api/v1/orders/{algo_id}/sync`

Re-links a broker order that got delinked from STAAX (e.g. network failure during placement).

1. Fetches order details from broker using `broker_order_id` provided by user
2. Validates fill price > 0
3. Finds unlinked PENDING/OPEN order for this algo (no `broker_order_id` in DB)
4. Updates: `broker_order_id`, `fill_price`, `status=OPEN`, `is_synced=True`
5. Subscribes instrument token on LTPConsumer
6. Clears AlgoState ERROR if no remaining error orders
7. Re-registers TSL/TTP engines for the synced order

### SQ (Square Off) — `POST /api/v1/orders/{algo_id}/square-off`

Manual square-off of all (or selected) open orders for an algo.

- **PRACTIX**: uses `ltp_cache.get(instrument_token)` as exit price, no broker call
- **LIVE**: calls `ExecutionManager.square_off()` → broker API; fetches actual fill from broker orderbook
- Deregisters TSL/TTP engines
- Updates `AlgoState` to CLOSED (all legs gone) or keeps ACTIVE (partial SQ)
- Triggers immediate `order_reconciler.run()`

### T (Target/Terminate) — `POST /api/v1/orders/{algo_id}/terminate` (via exit_all)

Forces `algo_runner.exit_all(grid_entry_id, reason="terminate")`. Sets `AlgoState.status = TERMINATED`. Cannot be restarted today.

Also used for manual SQ from the T button — `exit_all` handles both, differentiated by reason string.

### RETRY — `POST /api/v1/orders/{grid_entry_id}/retry`

Re-triggers entry for a WAITING or NO_TRADE grid entry.

1. Resets `GridEntry.status = ALGO_ACTIVE`, `AlgoState.status = WAITING`
2. Cancels any stale `entry_expiry_{geid}` APScheduler job
3. Checks if algo has W&T legs — if yes, `force_direct=False` (W&T logic runs); if no, `force_direct=True`
4. Schedules `algo_runner.enter()` via APScheduler `DateTrigger` in 2 seconds

**Why APScheduler (not `asyncio.create_task`)?** APScheduler's `AsyncIOExecutor` provides SQLAlchemy's required greenlet context. Direct `create_task()` / `ensure_future()` / `run_coroutine_threadsafe()` all lack this bridge and cause `MissingGreenlet`.

ORB algos: blocked if ORB window has already closed (`now > orb_end_time`).

### REPLAY — `GET /api/v1/orders/replay?algo_id=...&date=...`

Read-only. Returns a trade replay payload:
- All CLOSED orders for that algo on that date (IST-bounded UTC query on `fill_time`)
- ENTRY events + EXIT events with timestamps
- Running P&L curve (accumulated on exits only)
- Summary: entry_time, exit_time, total_pnl, peak_pnl, max_drawdown, duration_minutes

### RETRY-LEGS — `POST /api/v1/orders/{grid_entry_id}/retry-legs`

Re-places only specific errored legs (subset of legs that failed while others succeeded).

1. Validates all specified `leg_id`s are in ERROR state
2. Resets `AlgoState.status = ACTIVE` (not WAITING — other legs already filled)
3. Schedules `algo_runner.enter_specific_legs(grid_entry_id, leg_id_strs)` via APScheduler in 2 seconds

---

## 7. Data Flow: Tick → Monitors

```
SmartStream (Angel One WebSocket, in ThreadPoolExecutor thread)
  │
  └── AngelOneTickerAdapter.start() → on_tick → ltp_consumer._process_ticks()
                                                        │
KiteTicker (Zerodha WebSocket, optional)               │
  └── ltp_consumer.set_ticker(ticker)                  │
      ticker.on_ticks → ltp_consumer._on_ticks()       │
                                                        │
                                 ┌──────────────────────▼──────────────────────┐
                                 │           LTPConsumer._process_ticks()       │
                                 │  - Updates LTPCache (Redis)                  │
                                 │  - Broadcasts to WebSocket (WS price feed)   │
                                 │  - Calls each registered callback:           │
                                 │      1. orb_tracker.on_tick(token, ltp, tick)│
                                 │      2. wt_evaluator.on_tick(token, ltp, tick│
                                 │      3. tsl_engine.on_tick(token, ltp, tick) │
                                 │      4. ttp_engine.on_tick(token, ltp, tick) │
                                 │      5. sl_tp_monitor.on_tick(token,ltp,tick)│
                                 │      6. bot_runner._on_tick_wrapper(...)     │
                                 │      7. _underlying_tick_cb (per-underlying) │
                                 └───────────────────────────────────────────────┘
```

**Callback responsibilities:**

| Callback | On tick |
|---|---|
| `ORBTracker.on_tick` | Tracks high/low during ORB window; on breakout fires `on_orb_entry` → `algo_runner.enter()` |
| `WTEvaluator.on_tick` | Checks if option LTP crossed threshold; fires `on_wt_entry` → `scheduler.schedule_immediate_entry()` |
| `TSLEngine.on_tick` | Per order: if profit ≥ tsl_x, shift SL by tsl_y via `sl_tp_monitor.update_sl()` |
| `TTPEngine.on_tick` | Per order: if profit ≥ ttp_x, shift target by ttp_y via `sl_tp_monitor.update_tp()` |
| `SLTPMonitor.on_tick` | Per order: compare LTP to `sl_actual`/`target`; fire `on_sl` or `on_tp` callbacks; forward leg PNL to `MTMMonitor` |
| `BotRunner._on_tick_wrapper` | Routes MCX ticks to candle aggregators; fires bot signals |
| `_underlying_tick_cb` (inline) | Forwards underlying index ticks to `sl_tp_monitor.update_underlying_ltp()` for `pts_underlying`/`pct_underlying` SL/TP |

**LTPConsumer startup:** `LTPConsumer.start()` is NOT called at startup. The ticker is injected lazily:
- Zerodha: via `POST /api/v1/accounts/zerodha/set-token` → `ltp_consumer.set_ticker(ticker)`
- Angel One: via `_ao_startup_auto_login()` or manual login → `ltp_consumer.set_angel_adapter(adapter)`

---

## 8. Known Issues and Fixes

### MissingGreenlet Error

**Root cause:** SQLAlchemy 2.0 async sessions require a `greenlet` context to execute awaitable DB operations. After `db.rollback()` is called inside a per-leg `except` block, SQLAlchemy marks all ORM objects (including `algo`, `grid_entry`, `algo_state`) as **expired**. Any subsequent attribute access (e.g. `algo.id`, `algo.name`) attempts a lazy-load, which requires a new `await` — but this `await` runs outside the greenlet bridge. This raises `MissingGreenletError: greenlet_spawn has not been called; can't call await_only() here`.

The same error occurs when async code is invoked via `asyncio.create_task()`, `ensure_future()`, or `run_coroutine_threadsafe()` without APScheduler's `AsyncIOExecutor`, which automatically provides the greenlet bridge.

**Fix (G3 pattern, in `_enter_with_db_inner`):**

```python
# Pre-cache plain Python scalars BEFORE the per-leg loop and any try/except
_algo_id_str      = str(algo.id)
_algo_name_str    = str(algo.name or "")
_algo_account_str = str(algo.account_id) if algo.account_id else ""
_ge_id_str        = str(grid_entry.id)
_ge_is_practix    = bool(grid_entry.is_practix)

for leg in legs:
    leg_number = leg.leg_number  # capture before try block
    try:
        order = await self._place_leg(...)
        await db.commit()
        await db.refresh(algo_state)
        await db.refresh(grid_entry)
    except Exception as e:
        await db.rollback()
        await db.refresh(algo_state)  # re-attach after rollback
        await db.refresh(grid_entry)
        # Use pre-captured scalars — never access algo.id or grid_entry.id here
        await _ev.error(f"{_algo_name_str} · Leg {leg_number} failed: ...")
```

The same issue affects Scheduler jobs that access ORM attributes after the session closes. Fix: capture all needed ORM values as plain Python scalars **before** any `asyncio.ensure_future()` call (see `_job_activate_all` ORB registration block).

**RETRY and W&T callbacks** must schedule `enter()` via APScheduler `DateTrigger` (not `create_task`/`ensure_future`) to get the greenlet bridge. `schedule_immediate_entry()` is the canonical helper.

### snapshots.py — Dead Code

`engine/snapshots.py` defines `LegSnapshot`, `AlgoSnapshot`, `GridEntrySnapshot`, `AccountSnapshot`, `OrderSnapshot` dataclasses with conversion helpers (`snapshot_leg`, `snapshot_algo`, etc.).

**Status: Never imported or used anywhere in the codebase.** The module was designed to pre-cache ORM attributes as plain dataclasses before session close (exactly the problem that G3 pattern solves inline). It was built as a systemic fix but not integrated. The G3 scalar-caching pattern in `_enter_with_db_inner` is the active solution.

The snapshots module is safe to ignore or delete; it does not affect runtime behaviour.

### Current DB Revision

**0039** (`0039_bot_signals_schema_sync.py`)

Migration history tail:
- 0035 — `journey_trigger` column on `algo_legs`
- 0036 — `order.sl_type` column
- 0037 — `account` FY margin stamping
- 0038 — instrument + expiry fields on bot signals
- 0039 — bot signals schema sync

---

## Appendix: Key File Paths

| File | Role |
|---|---|
| `backend/app/main.py` | FastAPI lifespan, all startup wiring |
| `backend/app/engine/algo_runner.py` | Central entry/exit orchestrator |
| `backend/app/engine/scheduler.py` | APScheduler jobs, daily lifecycle |
| `backend/app/engine/ltp_consumer.py` | WebSocket tick pipeline |
| `backend/app/engine/sl_tp_monitor.py` | Per-order SL/TP watcher |
| `backend/app/engine/tsl_engine.py` | Trailing stop loss |
| `backend/app/engine/ttp_engine.py` | Trailing target profit |
| `backend/app/engine/mtm_monitor.py` | Algo-level MTM breach |
| `backend/app/engine/orb_tracker.py` | ORB window tracking |
| `backend/app/engine/wt_evaluator.py` | Wait and Trade threshold |
| `backend/app/engine/journey_engine.py` | Chained leg execution |
| `backend/app/engine/reentry_engine.py` | Re-entry after SL/TP |
| `backend/app/engine/snapshots.py` | Dead code — never imported |
| `backend/app/api/v1/algos.py` | Algo CRUD endpoints |
| `backend/app/api/v1/orders.py` | Orders page actions (SYNC, SQ, RETRY, REPLAY) |
| `backend/app/models/algo.py` | `Algo`, `AlgoLeg`, `StrategyMode`, `EntryType` |
| `backend/app/models/grid.py` | `GridEntry`, `GridStatus` |
| `backend/app/models/algo_state.py` | `AlgoState`, `AlgoRunStatus` state machine |
| `backend/app/models/order.py` | `Order`, `OrderStatus`, `ExitReason` |
