
## Session Update — 2026-04-08 (End of Day)

### Critical Safety Fixes — Pre-LIVE Required
All 5 fixes committed — platform now safe for LIVE:

1. pts_underlying entry_price — was using option fill
   price instead of underlying spot price for SL/TP
   trigger. Now correctly uses underlying LTP at fill time.

2. NSE holiday calendar — BTST/STBT exits now skip
   NSE holidays (13 holidays added for FY 2026-27).
   Previously would try to exit on market holidays.

3. Kill switch — scheduler.pause() was hitting module
   not live instance (silent fail). Fixed with singleton
   pattern. Kill switch now actually stops all jobs.

4. base_lot_multiplier — was silently ignored in quantity
   formula. Now: lots × lot_size × base_multiplier × 
   grid_multiplier. Position sizes were understated.

5. TOTP retry — 3 attempts with window boundary check.
   30-second TOTP window handled correctly.
   No more silent login failures at window boundaries.

### Documentation
STAAX_PLATFORM_DOCUMENTATION.md — 1,399 lines
DOCUMENTATION_GAP_REPORT.md — 10 items verified
ENGINE_AUDIT_REPORT.md — all P0/P1 fixed
BUTTON_AUDIT_REPORT.md — all 4 buttons fixed

### Platform Status — Ready for PRACTIX
All engine bugs fixed. Safe for extended PRACTIX testing.
NOT ready for LIVE until:
- Karthik AO + Wife AO IP registered in Angel One portal
- All PRACTIX algos tested: NF-STBT ✅ | S-STBT | S-WIDE
  NF-INT (W&T) | NF-BTST (premium) | BNF-BTST | BNF-ORB

### Tomorrow (April 9)
- Monitor auto-login cron at 08:45 IST
- Test S-STBT + S-WIDE in PRACTIX
- Verify W&T fix with NF-INT
- Verify premium selector with NF-BTST
- Verify ORB with BNF-ORB

## Session Update — 2026-04-16 (TRAVEX Scaffold)

### TRAVEX — New Module Added to LIFEX
Module: TRAVEX — Travel Intelligence
Status: BUILDING
Port:   Backend :8004 | Frontend :3004
Domain: travex.lifexos.co.in (reserved)
DB:     travex_db (in staax_db Docker container)

Architecture:
- FastAPI backend, same pattern as INVEX/BUDGEX
- SQLAlchemy 2.0 async, asyncpg, Alembic (version_table: travex_alembic_version)
- Two tables: cities (11 Indian cities seeded via migration), trips
- REST API: /trips, /cities, /stats, /stats/arcs, /health
- 5 demo trips seeded on first startup

Frontend:
- Vite 5 + React 18 + TypeScript strict, port 3004
- Three.js r167 globe with ShaderMaterial, arc animations, city markers
- 5 pages: Globe (default), Trips, Budget, Buddy, Stats
- Brand: sky #38bdf8 / teal #2dd4bf / forest #34d399 / deep #040d0a

LandingPage updated:
- NETEX + GOALEX cards removed (folded into FINEX as tabs)
- TRAVEX card added (gradient featured card, building: true flag)
- HISTEX card added (coming soon, blue #4488FF)
- FINEX description updated to mention net worth + goals
- System status: NETEX/GOALEX → TRAVEX/HISTEX
- Roadmap: TRAVEX in Phase 2, HISTEX in Phase 3

## Session Update — 2026-04-16 Evening (v8.5)

### Journey J1 + J2 — Complete (migration 0035)

**J1 — fromJourneyConfig() round-trip fix**
- Root cause: AlgoPage.tsx edit load path (line 676) always called `mkJourneyChild()` — discarded the `journey_config` returned by `_leg_to_dict()`. Fix: added `fromJourneyConfig()` function that reverses `buildJourneyConfig()`. Edit load now calls `fromJourneyConfig(l.journey_config)` when present. Full round-trip confirmed.

**J2 — journey_trigger field**
- New field on AlgoLeg: `journey_trigger` — values: `sl | tp | either` (default: either)
- Migration 0035 applied: `ALTER TABLE algo_legs ADD COLUMN journey_trigger VARCHAR(10) DEFAULT 'either'`
- Engine: `journey_engine.py` gates child-leg firing — sl-only fires on SL exits, tp-only fires on TP exits, either always fires
- Frontend: 3-chip selector (SL Hit / TP Hit / Either) shown only when parent leg has both SL and TP enabled simultaneously

Files changed: `alembic/versions/0035_journey_trigger.py`, `models/algo.py`, `api/v1/algos.py` (5 changes), `engine/journey_engine.py`, `engine/algo_runner.py`, `AlgoPage.tsx` (6 changes)

---

### Analytics Latency Tab — Upgraded
- Backend: `/api/v1/reports/latency` now returns `success_rate`, `fast_pct`, `distribution` (excellent/good/acceptable/slow), per-broker P50/P99/fast%, recent 20 orders
- Frontend: 4 stat cards, color-coded distribution bars, broker comparison table, recent orders table

### Orders Page — Broker View
- `GET /api/v1/orders/broker-orderbook` — fetches raw Angel One orderbook, normalized
- Frontend: "Broker View" toggle, raw broker orders panel, color-coded status (COMPLETE=green, REJECTED=red, OPEN=amber)

### Accounts Page — Funds Strip
- `GET /api/v1/accounts/angelone/{slug}/funds` — calls `get_margins()` + `get_positions()`, Redis 60s cache, `?refresh=true` busts cache
- Frontend: 4-metric strip per account (Cash, Used, Total, Unrealized P&L), Refresh button

### Positions Endpoint
- `GET /api/v1/accounts/positions` — aggregates from all logged-in Angel One accounts
- Placed BEFORE `/{account_id}` catch-all (FastAPI routing rule)

### CSS Brightness Fix — 4 Modules
- STAAX / INVEX / BUDGEX: `--gs-muted` #8A8A94 → #ABABAF, `--gs-light` #5A5A61 → #868690
- TRAVEX: `--muted` rgba(45,212,191,0.35) → rgba(45,212,191,0.60)

### INVEX — per-SIP Execute + Watchlist Auto-refresh
- `POST /sips/{sip_id}/execute` — runs single SIP immediately (literal route placed BEFORE `/{sip_id}` PATCH catch-all)
- WatchlistPage: 30s auto-refresh polling + "Live · HH:MM:SS" pill badge

### EC2 — Full Deploy (all 4 modules)
- All modules deployed to 13.202.164.243
- STAAX migrations 0033→0035 applied on server
- TRAVEX first EC2 deploy (port 8004, systemd service, nginx block, travex_db created)
- CORS fix: `ALLOWED_ORIGINS` set in `/home/ubuntu/staax/backend/.env`
- Algo sync: replaced old Algo-1..19 with 12 Mom algos (NF-BTST, BNF-BTST, SX-STBT, SX-WIDE, etc.)
- **PENDING:** `services.py` fix — on production (`APP_ENV=production`) skip subprocess start for postgresql/redis (managed by Docker)
- **PENDING:** DNS — add A records `travex.lifexos.co.in` + `travex-api.lifexos.co.in` → 13.202.164.243, then certbot SSL

### OpenAlgo — Scrapped
- Removed from `start.sh`, Living Spec, STAAX `.env`
- `backend/app/api/v1/historical.py` deleted
- Repo kept at `~/STAXX/openalgo/` for reference only
- Items moved to Phase 2/3 backlog: ZMQ-1 (ZeroMQ bus), PSM-1 (Python Strategy Manager), MCP-1 (MCP Server), FVB-1 (Flow Visual Builder)

### Globe3D — Rebuild (TRAVEX)
- TopoJSON country boundaries via CDN (world-atlas@2, topojson-client) — 286 lines
- India state boundaries via CDN (opacity 0.2); silent skip on CDN failure
- India approximate box fallback removed entirely
- Transport icons: emoji sprites → geometric Three.js shapes (air=diamond ShapeGeometry, train=box, bus=wider box); oriented along arc tangent via `quaternion.setFromUnitVectors`
- Train arcs: dashed crosshatch track lines
- Arc traveller speed: `progress += 0.003`, staggered starts `(i * 0.3) % 1.0`
- Slow rotation: `elapsed * 0.03`
- Globe layout: `position: relative` + ResizeObserver on container (not window.resize)
- City marker race condition fixed: cities added to `useEffect` deps

### Pending (carry forward)
- `services.py` production fix (APP_ENV=production → skip pg/redis subprocess)
- TRAVEX DNS + SSL (travex.lifexos.co.in)
- Android EAS build: `eas build --platform android --profile preview`
- HIGH audit items: live WebSocket stub, algo runtime stubs, AI chat fallback
- INVEX Analysis tab — Fundamental + Technical

---

## STAAX Living Spec — v8.6
**Date:** 17 April 2026
**Status:** LIVE (PRACTIX mode) — overnight positions active

---

### Session Update — 17 April 2026 (v8.6)

#### Critical Engine Fixes

**Scheduler — recover_today_jobs() over-squaring (FIXED)**
- Bug: `recover_today_jobs()` included STBT/BTST/POSITIONAL modes → overnight positions auto-squared same day on restart
- Fix: restricted to INTRADAY only + guard before exit job registration

**_next_trading_day() helper**
- Weekend-aware exit scheduling: Friday positions correctly schedule Monday exits

**SQL revert — wrongly closed orders**
- 6 NIFTY overnight orders + 2 SENSEX (SX-STBT) restored CLOSED → OPEN
- `grid_entries` + `algo_states` reverted to active
- Monday 20 Apr: NF-STBT1, NF-STBT2, NF-TF, NF-BTST, SX-STBT exit via `recover_multiday_jobs()`

**MissingGreenlet (partial fix)**
- ORM attribute access moved inside session context (`_pre_execution_check`, `enter()`)
- Outer try/except in `_enter_with_db()` — full traceback now logged to System Log
- **Pending:** W&T RETRY + scheduled entries still affected

**W&T Architecture Bug (identified, fix pending)**
- Engine monitors underlying index (BANKNIFTY spot), not option premium
- 15% W&T on 56,000 = trigger at 64,800 — never fires intraday
- Fix: strike selection must happen BEFORE W&T registration; monitor option LTP

**NF-INT:** reset from `algo_closed` → `no_trade`, now shows as MISSED with RETRY

**SX-STBT P&L corrected:** CE exit ₹815 (-₹57.75×20) + PE exit ₹653.4 (+₹121.90×20) = net +₹1,283

---

#### Lot Size Fix

| Item | Detail |
|---|---|
| Bug | All orders: `quantity=1`, `lot_size=1` — P&L wrong by 20-75× |
| Fix | `lot_size` column added to orders table |
| Method | `_get_lot_size()` in `algo_runner.py` — fetches Angel One master contracts, in-memory cache, fallback: NIFTY=75, BANKNIFTY=35, SENSEX=20 |
| Retroactive | 7-day P&L recalculated for all closed orders |

---

#### Orders Page Revamp

**Removed elements:**
- PRACTIX chip (all pages: OrdersPage, GridPage, ReportsPage, AnalyticsPage, AccountsPage)
- Header chips: "⚠ N open", "Open P&L"
- Header buttons: "Open Positions", "Broker View"
- Open Positions modal, Broker View panel

**Added:**
- Mode toggle toast in navbar: amber "Switched to PRACTIX" / green "Switched to LIVE" (auto-dismiss 2.5s)
- Two rows of stat cards (11 total):
  - Row 1: Week P&L · Realized · Unrealized · Net
  - Row 2: Open Algos · Closed Algos · Open Positions · Closed Positions · MISSED · ERROR · WAITING
  - Single-filter-at-a-time; sessionStorage persistence
- Auto-reconciliation background task (60s during market hours) replaces Broker View
- `GET /orders/reconcile` — compares STAAX open orders vs Angel One orderbook, flags mismatches
- SL column: actual SL price + definition (I-40%, I-40pt) as second line
- Per-date order cache — no tab bleed between days
- `useRef` for `selectedDate` in Refresh button — always calls correct date
- Smart Cards: MONITORING pill teal + pulsing dot; left status bar matches badge color
- MONITORING correct: only when WTEvaluator `is_ref_set=True`; 90s grace after RETRY
- Week P&L: day pills use `closed_pnl + open_mtm` (LTPConsumer in-memory LTP)

---

#### Indicator Bots — Track A (Complete)

All 6 engine fixes + UI revamp:

| Fix | Description |
|---|---|
| Fix 1 | DTR `_data_load_failed` flag + per-minute warning + exponential backoff retry (5m→30m) |
| Fix 2 | Dedup key includes candle timestamp — re-entry on new candles no longer suppressed |
| Fix 3 | Order placement synced before signal marked fired |
| Fix 4 | NULL `entry_price` guard on position restore |
| Fix 5 | `GET /bots/{bot_id}/chart-data` + recharts chart in BotCard |
| Fix 6 | WebSocket push on signal fire → `/ws/notifications` → instant frontend update |

UI Revamp: New BotCard (colored left bar, status chip, levels row, position/P&L chip, last signal row), Orders tab (Today/Open/All sub-tabs), redesigned Signals table.

---

#### MT5 Integration — Track B (Scaffolded)

| Component | Detail |
|---|---|
| Bridge | `~/STAXX/mt5-bridge/` — FastAPI (port 8765), socket client |
| EA | MQL5 EA template at `mt5-bridge/ea/StaaxBridge.mq5` (socket server port 8766) |
| Broker adapter | `backend/app/brokers/mt5.py` — BaseBroker interface |
| Account model | `BrokerType.MT5`, 4 new columns: `mt5_bridge_url`, `mt5_bridge_token`, `mt5_account_no`, `mt5_server` |
| Migration | `add_mt5_broker_columns` |
| Bot runner | `MT5_INSTRUMENTS` set, instrument→broker routing, `MT5TickFeed` (500ms polling) |
| UI | Accounts page: MT5 card with bridge status, balance/equity/margin/open positions |
| start.sh | MT5 bridge health check (non-blocking) |
| **Pending** | Install MQL5 EA in MT5, test socket, configure The5%ers account |

---

#### Honeycomb Background

- SVG: 643 hexagons extracted → `frontend/public/honeycomb-bg.svg`
- `HoneycombBackground.tsx`: `position:fixed`, `inset:0`, `z-index:0`, `opacity:0.55` — all pages
- Canvas overlay: glowing orange sparkline tracer via `requestAnimationFrame`

---

#### Migrations Applied (17 Apr)

| Migration | Type |
|---|---|
| `add_mt5_broker_columns` | New Alembic migration |
| `lot_size` column on orders | ALTER TABLE |
| `reconcile_status` column on orders | ALTER TABLE |

---

#### Platform Module Table (v8.6)

| Module | Purpose | Port (local) | Domain | Status |
|---|---|---|---|---|
| STAAX | Algo trading | FE:3000 BE:8000 | staax.lifexos.co.in | ✅ LIVE |
| INVEX | Investments | FE:3001 BE:8001 | invex.lifexos.co.in | ✅ LIVE |
| BUDGEX | Expense tracking | FE:3002 BE:8002 | budgex.lifexos.co.in | ✅ LIVE |
| TRAVEX | Travel tracker | FE:3004 BE:8004 | travex.lifexos.co.in | ✅ LIVE (DNS pending) |
| MT5 Bridge | MT5 broker adapter | 8765 | — | 🔨 Scaffolded |
| lifex-mobile | React Native | Expo | — | ✅ Published |

---

#### Pending — Monday 20 April 2026

1. **MissingGreenlet permanent fix** — W&T RETRY + scheduled entries
2. **W&T architecture fix** — monitor option premium not underlying index
3. **MT5 EA installation** — install in MT5, test socket connection, configure The5%ers
4. **Orders page revamp final** — FRI P&L `open_mtm` from LTPConsumer
5. **EC2 deploy** — all 17 Apr changes
6. **NF-STBT1, NF-STBT2, NF-TF, NF-BTST, SX-STBT** — monitor exits at configured times
7. **TRAVEX DNS** — A records + certbot SSL
8. **Android EAS build**
- TRAVEX Phase 2: Gmail sync (travel confirmation emails → auto-create trips), IRCTC SMS parsing, FlightAware flight status
