# STAAX — Living Engineering Spec
**Version:** 1.7 | **Last Updated:** March 2026 — post codebase audit + routing corrections | **PRD Reference:** v1.2

This document is the single engineering source of truth. Read this at the start of every session — do not re-read transcripts for context.

---

## 1. Platform Summary

Personal F&O algo trading platform. Owner: Karthikeyan. Three broker accounts.

| Account | Broker | Scope | Phase |
|---------|--------|-------|-------|
| Karthik | Zerodha (KiteConnect) | NSE Index F&O | 1 |
| Mom | Angel One (SmartAPI) | NSE Index F&O | 1 |
| Wife | Angel One (SmartAPI) | MCX GOLDM Futures | 2 |

**Stack:** React 18 + TypeScript + Tailwind + Zustand | Python 3.12 + FastAPI + APScheduler | PostgreSQL 16 + Redis 7 | AWS EC2 t3.medium (ap-south-1)

**Theme:** Dark. Background `#2A2C2E`. Accent `#00B0F0` (cyan). Amber `#D77B12`. Fonts: ADLaM Display (headings) + Dubai (body).

---

## 2. Pages & Navigation

| Route | Page | Shown in Nav | Status |
|-------|------|-------------|--------|
| `/dashboard` | Dashboard | ✅ Yes | Built ✅ |
| `/grid` | Smart Grid | ✅ Yes | Built ✅ |
| `/orders` | Orders | ✅ Yes | Built ✅ |
| `/reports` | Reports | ✅ Yes | Built ✅ |
| `/accounts` | Accounts | ✅ Yes | Built ✅ |
| `/indicators` | Indicator Systems | ✅ Yes | Built ✅ |
| `/algo/new` | Algo Config (new) | ❌ No — accessed via Smart Grid "+ New Algo" button | Built ✅ |
| `/algo/:id` | Algo Config (edit) | ❌ No — accessed via Smart Grid cell click | Built ✅ |

---

## 3. Top Bar

- **Left:** STAAX logo + "ALGO TRADING" | Welcome, Karthikeyan | IST clock | Today P&L (live)
- **Right:** All Accounts dropdown | PRACTIX toggle button | Notification bell
- **PRACTIX toggle:** Global — affects all pages **except Smart Grid** (Smart Grid has per-cell toggle)
- **All Accounts dropdown:** Available on all pages. On Smart Grid, "All Accounts" is **disabled** — only individual account selection allowed (one account at a time)

---

## 4. Dashboard

**Purpose:** Morning startup panel + system health + session control. User opens this every morning between 8–9 AM.

### Stat Cards (top row)
- Active Algos count
- Open Positions count
- Today P&L
- FY P&L

### Services Panel
Four services with individual Start buttons + status indicator (STOPPED / RUNNING):
- PostgreSQL (localhost:5432)
- Redis (localhost:6379)
- Backend API (http://localhost:8000)
- Market Feed (NSE live tick data)

**Start Session button** — starts all services at once. User clicks this every morning.
**Stop All button** — stops all services.

### Zerodha Token Section (inside Services panel)
- Shows "Login required" warning when token not set
- **Login button** — opens Zerodha login URL in new tab. After login, user pastes request_token back.
- Shows "Connected today ✅" when token is valid.

### System Log
- Live log output panel. Shows startup messages, errors, key events.

### Account Status (bottom row)
Three account cards — Karthik, Mom, Wife:
- Broker name
- Status badge: LIVE (green) / LOGIN (amber) / PENDING (Phase 2 only)
- Today P&L per account

### Morning Workflow
1. User opens Dashboard at ~8–9 AM
2. Clicks **Start Session** (starts PostgreSQL, Redis, Backend API, Market Feed)
3. Clicks **Login** for Zerodha → completes browser login → token set
4. Angel One token refreshes automatically
5. Algos auto-activate at **9:15 AM** (engine ready, entry windows open)
6. SL condition check for open overnight positions (BTST/STBT/Positional) auto-starts at **9:18 AM**

---

## 5. Smart Grid

**Purpose:** Weekly visual scheduler. Create algos once, deployed to days via drag & drop.

### Layout
- Rows = Algos | Columns = Mon–Fri (Sat/Sun hidden by default, enabled via "Show Weekends" checkbox)
- Each cell = one algo on one day
- **Account is set at Algo Config level** — algo always belongs to one account. No per-cell account assignment.
- Account dropdown in top bar: **"All Accounts" is disabled for Smart Grid** — must select a specific account

### Algo Row (left panel)
- Algo name + account name
- Leg instrument badges (e.g. NFB, BNB)
- "→ Promote all to LIVE" button (visible in PRACTIX mode)
- Delete (trash) icon + reorder handle

### Cell Contents
- Status badge (top left): NO TRADE / ACTIVE / PENDING / OPEN / CLOSED / ERROR
- PRAC / LIVE badge (top right) — per-cell toggle
- **M:** lot multiplier
- **E:** entry time (cyan)
- **X:** exit time
- P&L value (when open or closed)
- × close button (remove from this day)

**What is NOT shown in cells:**
- Next-day SL check time — automatic at 9:18 AM, never shown in UI
- Account name — set at algo level

### Cell Status Colours
| Status | Colour |
|--------|--------|
| No Trade | Grey |
| Active | Blue |
| Pending | Amber |
| Open | Green |
| Closed | Dark Green |
| Error | Red |

### Grid Interactions
- Drag & drop cell to a different day
- Click M value — edit lot multiplier for that day only
- × button — remove algo from that day (does not delete algo config)
- Click cell — opens Algo Config (edit mode)
- + New Algo button — opens Algo Config (new)
- Archive button — archive/restore algos
- Show Weekends checkbox
- PRAC/LIVE toggle per cell
- → Promote all to LIVE — promotes all cells for this algo from PRACTIX to LIVE

---

## 6. Orders Page

**Purpose:** Live order book. Shows all algos scheduled for today by default.

### Day Tabs
- MON | TUE | WED | THU | FRI | SAT — each shows daily P&L
- **Default: today's tab active**
- Clicking a tab shows that day's algos and orders
- MTM total shown top right (e.g. MTM: +₹3,520)

### Algo Card Structure
**Card Header:**
- Algo name + Account tag
- MTM SL and TP (e.g. SL: ₹5,000 · TP: ₹10,000)
- Action buttons: **RUN | RE | SQ | T**
- Total P&L for this algo

**Two accounts, same algo = two separate cards** (same algo name, different account tag)

### Action Buttons
| Button | Colour | Behaviour |
|--------|--------|-----------|
| **RUN** | Cyan `#00B0F0` | Recovery — manually start an algo that **failed to auto-initiate** after 9:15 AM. NOT normal start. |
| **RE** | Amber `#F59E0B` | Retry a **failed/error** leg. Re-attempts after API failure, order rejection, connectivity issue. Auto-switches LIMIT↔MARKET on retry. NOT re-entry on a healthy closed position. |
| **SQ** | Green `#22C55E` | Square off **selected** open positions. Popup lists open legs — user picks which to close. Algo remains active. |
| **T** | Red `#EF4444` | **Terminate:** Square off ALL open positions + cancel ALL pending orders + cancel SL orders at broker + terminate algo for the day. |

### Orders Table Columns
| Column | Notes |
|--------|-------|
| **#** | Leg number. Parents: 1, 2, 3. Re-entry children: 1.1, 1.2, 2.1 etc. |
| **STATUS** | OPEN / CLOSED / PENDING / ERROR |
| **SYMBOL** | Instrument name. BUY or SELL shown below symbol in second row (not a separate column) |
| **LOTS** | e.g. 1 (50) — lots and total qty |
| **ENTRY / REF** | Entry condition (e.g. ORB High, W&T Up 5%, Direct) + Ref price below |
| **FILL** | Actual fill price |
| **LTP** | Live last traded price (WebSocket) |
| **SL (A/O)** | A = Adjusted/current SL (trails with TSL). O = Original SL at entry |
| **TARGET** | TP level if configured |
| **EXIT** | Exit price + timestamp |
| **REASON** | SL / TP / TSL / SQ / Error |
| **P&L** | Unrealised (open) or realised (closed) |

### Pending Implementations (Orders Page)
- **SYNC** — Manual order sync. Link untracked broker position to algo. Enter broker order ID, instrument, direction, qty, fill price, fill time → STAAX creates record and resumes monitoring. Tagged "Synced".
- **Manual exit price correction** — Click Exit Price cell on closed/error order, enter correct value, P&L recalculates, correction marker shown.
- **Hide P&L** — NOT required. Do not implement.

---

## 7. Algo Config

**Purpose:** Create and edit algo configurations. Not in nav — accessed via Smart Grid.

### Section 1A — IDENTITY (Algo Level)
- Algo Name
- Lot Multiplier (base)
- Strategy Mode: Intraday | BTST | STBT | Positional
- Order Type: MARKET | LIMIT

### Section 1B — ENTRY TYPE & TIMING (Algo Level)
- Entry Type: **Direct** | **ORB**
  - W&T is **per leg** — not an algo-level entry type
- Entry Time (E:)
- Exit Time (X:)
- **ORB End Time** — shown only when Entry Type = ORB
- **DTE (Days to Expiry)** — shown only when Strategy Mode = Positional. Range: 1–30. Meaning: position exits X days before expiry at exit time.

### Section 1C — MTM CONTROLS (Algo Level)
- Unit: Amount (₹) | Percentage (%)
- MTM SL value
- MTM TP value

### Section 2 — LEG CONFIGURATOR
Per leg:
- Direction: BUY | SELL
- Instrument Type: CE | PE | FU
- Underlying: NIFTY | BANKNIFTY | SENSEX | MIDCAPNIFTY | FINNIFTY
- Expiry: Current Weekly | Next Weekly | Current Monthly | Next Monthly
- Strike Selection: ATM | ITM1–ITM10 | OTM1–OTM10 | Premium | Straddle Premium | Delta (Phase 2)
- Lots
- SL: 4 variants — pts/instrument | %/instrument | pts/underlying | %/underlying
- TP: same 4 variants
- TSL: For every X move in favour, SL shifts Y. Activates from entry. X and Y same unit.
- **W&T** — per leg. Threshold (pts or %) above/below reference price at entry time.
- TTP (Trailing Target) — **PENDING IMPLEMENTATION**
- Re-entry: mode (AT_ENTRY_PRICE | IMMEDIATE | AT_COST) + max count (0–5)
- Journey config — **PENDING IMPLEMENTATION**

**Strike resolution:** At entry time, not config time. Multiples: NIFTY=50, BANKNIFTY=100, SENSEX=100, MIDCAPNIFTY=25, FINNIFTY=50.

### Section 3A — ORDER DELAYS (Algo Level)
- Entry Order Delay: 0–60 seconds
- Exit Order Delay: 0–60 seconds

### Section 3B — ERROR SETTINGS (Algo Level)
- On Margin Error: exit all open positions for this algo
- If Any Entry Fails: exit all open positions for this algo

### What Is NOT in Algo Config
- Day selection — assigned via Smart Grid drag & drop
- Account — set once (algo always belongs to one account)

### Pending Implementations (Algo Config)
- **TTP** — per leg
- **Journey feature** — collapsible child cards (1.1, 1.2, 2.1...) with independent SL/TP/TSL per re-entry level. Max 5 levels per parent leg. Unconfigured slots inherit parent rules.

---

## 8. Reports

- **FY Total P&L** — headline + equity curve (expandable)
- **Month P&L** — vs prev month %
- **Today P&L** — with active algo count
- **Full Year Calendar** — 12 mini month calendars, green/red dots per day, monthly total shown. Click to expand.
- **Per-Algo Metrics** — Overall P&L | Avg Day P&L | Max Profit | Max Loss | Win% | Loss% | Max Drawdown | ROI
- Filterable by FY / Month / Date / Custom
- PRACTIX badge when in PRACTIX mode
- ↓ CSV download

---

## 9. Accounts

**Purpose:** Broker account management, margin, global risk. Token/login management redirects to Dashboard.

**Karthik (Zerodha · F&O):** Status | FY Margin | FY P&L | API Token status | Global SL/TP
**Mom (Angel One · F&O):** Same. Token auto-refreshes.
**Wife (Angel One · MCX):** Status PENDING. Phase 2 only.

---

## 10. Indicator Systems

Phase 2 only. Three bots (PHASE 2 label): GOLDM Bot | SILVERM Bot | Crude Oil Bot. P&L widget coming soon.

---

## 11. Execution Engine

### Timing
- **9:15 AM:** All today's algos activate. Entry windows open.
- **9:18 AM:** SL condition check starts for open overnight positions (BTST/STBT/Positional)
- **Each algo's E: time:** Entry signal evaluation for that algo
- **Each algo's X: time:** Auto square-off (Intraday)
- **ORB End time:** No breakout → status = No Trade

### Re-entry (Automatic — not user-triggered)
| Mode | Behaviour |
|------|-----------|
| AT_ENTRY_PRICE | Checks every 1-min candle close. Fires when LTP returns to original entry price. Same strike + expiry. |
| IMMEDIATE | Re-runs original entry logic immediately. Strike re-evaluated at runtime. |
| AT_COST | Fires when LTP returns to entry price, only after TSL has trailed ≥ once. Same strike + expiry. |

Max 5 re-entries per leg per day.

**⚠️ RE button = retry error/failed leg. Re-entry above = automatic after healthy close. Completely different.**

---

## 12. REST API

### Services (Dashboard)
```
GET  /api/v1/services/status           status of all 4 services
POST /api/v1/services/start-all        Start Session button
POST /api/v1/services/stop-all         Stop All button
POST /api/v1/services/{name}/start     start one service
POST /api/v1/services/{name}/stop      stop one service
```

### Accounts
```
GET  /api/v1/accounts                           list all with status
GET  /api/v1/accounts/zerodha/login-url
POST /api/v1/accounts/zerodha/set-token
GET  /api/v1/accounts/zerodha/token-status
POST /api/v1/accounts/angelone/refresh-token
POST /api/v1/accounts/{id}/margin               update FY margin
POST /api/v1/accounts/{id}/global-risk          update global SL/TP
```

### Smart Grid
```
GET    /api/v1/grid                    list cells by account_id (no "all")
POST   /api/v1/grid                    create cell
GET    /api/v1/grid/{id}
PUT    /api/v1/grid/{id}               only when IDLE/SQ/TERMINATED
DELETE /api/v1/grid/{id}               only when IDLE
POST   /api/v1/grid/{id}/archive       toggle archive
POST   /api/v1/grid/{id}/mode          toggle PRACTIX ↔ LIVE
POST   /api/v1/grid/{id}/promote-live  promote all cells for algo to LIVE
```

### Algo Controls
```
GET  /api/v1/algos/{id}/status
POST /api/v1/algos/{id}/start          RUN: recovery start (failed to auto-initiate)
POST /api/v1/algos/{id}/re             RE: retry error leg (ERROR → WAITING)
POST /api/v1/algos/{id}/sq             SQ: selective sq-off {leg_ids:[...]}
POST /api/v1/algos/{id}/terminate      T: sq-all + cancel pending + cancel broker SL
```

### Orders
```
GET   /api/v1/orders                           filters: account_id, date (default today), is_practix, status
GET   /api/v1/orders/{id}
POST  /api/v1/orders/{id}/exit                 manual exit at market
POST  /api/v1/orders/square-off-all
POST  /api/v1/orders/{id}/sync                 [PENDING] manual sync
PATCH /api/v1/orders/{id}/exit-price           [PENDING] exit price correction
```

### Reports
```
GET /api/v1/reports/summary            params: date_from, date_to, account_id, is_practix
GET /api/v1/reports/daily-pnl          params: year, month, account_id, is_practix
GET /api/v1/reports/trades             paginated trade log
```

---

## 13. WebSocket Channels

```
ws://host/ws/pnl            real-time P&L per open position
ws://host/ws/status         algo state transitions
ws://host/ws/notifications  info/warning/error events
```

---

## 14. Data Models (key fields)

**Algo:** id, name, account_id, strategy_mode, order_type, entry_type, entry_time, exit_time, orb_end_time, dte, lot_multiplier, mtm_sl, mtm_tp, mtm_unit, entry_delay_seconds, exit_delay_seconds, on_margin_error, on_entry_fail

**AlgoLeg:** id, algo_id, leg_number, direction, instrument_type, underlying, expiry, strike_type, strike_value, lots, sl_type, sl_value, tp_type, tp_value, tsl_enabled, tsl_x, tsl_y, tsl_unit, wt_value, wt_unit, reentry_mode, reentry_max

**GridEntry:** id, algo_id, trading_date, day_of_week, lot_multiplier, is_practix, is_archived, account_id

**Order:** id, grid_entry_id, algo_id, leg_id, account_id, broker_order_id, symbol, exchange, instrument_token, direction, quantity, entry_price, entry_time, entry_underlying_price, exit_price, exit_time, exit_reason, pnl, is_manual_corrected, is_practix, is_overnight, journey_level, reentry_count, status, is_synced

**AlgoState:** id, grid_entry_id (unique), status, journey_level, reentry_count, reentry_max, entry_price_ref, current_order_id, updated_at

### State Machine
```
IDLE → WAITING        scheduler at E: time / RUN (recovery)
WAITING → ENTERED     entry fires (ORB/W&T/Direct)
WAITING → NO_TRADE    ORB window expired, no breakout
ENTERED → SQ          position closed (SL/TP/MTM/manual SQ)
ENTERED → ERROR       broker error
SQ → WAITING          re-entry triggers / next journey
SQ → TERMINATED       journeys exhausted / T button
ERROR → WAITING       RE button
ANY → TERMINATED      T button
```

---

## 15. Phase Build Status

| Phase | Name | Status |
|-------|------|--------|
| 1A | Foundation | ✅ Complete |
| 1B | Core Execution Engine | ✅ Complete |
| 1C | Full React UI | ✅ Complete |
| 1D | API + WebSocket + Scheduler + Re-entry | 🔄 In Progress |
| 1E | Reports, Notifications, Manual Controls | ⏳ Pending |
| 2 | MCX | ⏳ Pending |

### Phase 1D — Completed (pre-build cleanup)
- ✅ Data model corrections (audit findings — 9 model changes, new AlgoState model)
- ✅ Grid API rewritten — correct endpoint paths
- ✅ Algo control endpoints added — `/start`, `/re`, `/sq`, `/terminate`
- ✅ Services API created — `/services/` router with start/stop/status
- ✅ `main.py` updated — scheduler + WebSocket wired into lifespan
- ✅ `frontend/src/services/api.ts` rewritten — all paths correct

### Phase 1D — Completed (engine build)
- ✅ **AlgoScheduler** (`engine/scheduler.py`) — 08:30 token refresh, 09:15 activate all, 09:18 overnight SL, per-algo E:/X:/ORB-end jobs, BTST/STBT SL check at entry_time - 2min
- ✅ **WebSocket ConnectionManager** (`ws/connection_manager.py`) — 3 channels (pnl, status, notifications), broadcast helpers for all event types
- ✅ **WebSocket routes** (`ws/routes.py`) — `/ws/pnl`, `/ws/status`, `/ws/notifications`
- ✅ **ReentryEngine** (`engine/reentry_engine.py`) — AT_ENTRY_PRICE, IMMEDIATE, AT_COST modes, per-leg max, 1-min candle watcher

### Phase 1D — Still To Build
1. **Frontend wiring** — connect all pages to API + WebSocket (login, algo save, grid deploy, orders live)
2. **Global Risk API** — `POST /api/v1/accounts/{id}/global-risk` full DB implementation
3. **Angel One broker** — complete SmartAPI adapter (stubs exist, TOTP logic ready)
4. **AlgoRunner** — the entry logic orchestrator (calls ORBTracker / WTEvaluator / OrderPlacer based on entry_type)

### Phase 1D — Deferred to 1E
- SYNC (manual order sync)
- Manual exit price correction
- TTP per leg
- Journey feature in Algo Config
- NotificationService (Twilio WhatsApp + AWS SES)

---

## 16. Key Decisions Log

| Decision | Detail |
|----------|--------|
| Account at algo level | Algo always belongs to one account. No per-cell assignment. |
| Smart Grid: no All Accounts | Must pick one account. All Accounts disabled on grid page. |
| Global PRACTIX = all pages except Smart Grid | Smart Grid has per-cell toggle. |
| Orders default = today | Day tabs switch which day. Today is default. |
| Entry types: Direct + ORB at algo level | W&T is per-leg only. |
| Cells show E and X only | 9:18 AM overnight SL check is automatic. Never shown in UI. |
| RUN = recovery only | Scheduler does normal start. RUN only when algo failed to initiate. |
| RE = error retry only | Re-entry after close is automatic engine behaviour. |
| SQ = selective with popup | User picks which legs to close. |
| T = full terminate | Sq-all + cancel pending + cancel broker SL + TERMINATED state. |
| Hide P&L = not needed | Do not implement. |
| DTE range 1–30 | Required for monthly contracts. |
| Dashboard = morning ops panel | Start Session → Login → 9:15 auto-ready. |
| Services started from Dashboard | Not terminal scripts. User manages via UI daily. |

---

## 17. Environment Variables

```bash
ZERODHA_API_KEY, ZERODHA_API_SECRET, ZERODHA_USER_ID
ANGELONE_API_KEY, ANGELONE_CLIENT_ID, ANGELONE_MPIN, ANGELONE_TOTP_SECRET
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
JWT_SECRET_KEY, JWT_ALGORITHM=HS256
TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM, WHATSAPP_TO
AWS_SES_REGION, SES_FROM_EMAIL, NOTIFICATION_EMAIL
VITE_API_URL=http://localhost:8000/api/v1
VITE_WS_URL=ws://localhost:8000
```

---

---

## 19. API Routing Corrections (March 2026)

### Files changed
| File | Change |
|------|--------|
| `backend/app/api/v1/grid.py` | Full rewrite — correct endpoint paths |
| `backend/app/api/v1/algos.py` | Added RUN/RE/SQ/T control endpoints |
| `backend/app/api/v1/services.py` | Created — was missing entirely |
| `backend/main.py` | Registered services router |
| `frontend/src/services/api.ts` | Full rewrite — correct paths throughout |

### Grid endpoints (corrected)
```
GET    /api/v1/grid/                      get week grid
POST   /api/v1/grid/                      deploy algo to day
GET    /api/v1/grid/{id}                  get single entry
PUT    /api/v1/grid/{id}                  update multiplier / mode
DELETE /api/v1/grid/{id}                  remove from day
POST   /api/v1/grid/{id}/archive          archive algo
POST   /api/v1/grid/{id}/unarchive        restore archived algo
POST   /api/v1/grid/{id}/mode             toggle PRACTIX/LIVE for one cell
POST   /api/v1/grid/{algo_id}/promote-live  promote all cells to LIVE
```

### Algo control endpoints (added)
```
POST   /api/v1/algos/{id}/start           RUN button
POST   /api/v1/algos/{id}/re             RE button (error retry only)
POST   /api/v1/algos/{id}/sq             SQ button (selective square off)
POST   /api/v1/algos/{id}/terminate      T button (full termination)
```

### Services endpoints (new)
```
GET    /api/v1/services/                  status of all services
POST   /api/v1/services/start-all         Start Session button
POST   /api/v1/services/stop-all          Stop All button
POST   /api/v1/services/{id}/start        start one service
POST   /api/v1/services/{id}/stop         stop one service
```

---

## 18. Code Audit Findings (vs Repo — March 2026)

### 🔴 Must Fix Before Phase 1D Build

| # | File | Issue | Fix |
|---|------|-------|-----|
| 1 | `models/algo.py`, `types/index.ts` | `EntryType` enum has `WT` and `ORB_WT` — should not exist at algo level | ✅ Fixed |
| 2 | `models/algo.py`, `schemas/algo.py` | `wt_type`, `wt_value`, `wt_unit` columns on Algo table — W&T is per-leg only | ✅ Fixed |
| 3 | `models/algo.py`, `schemas/algo.py`, `types/index.ts` | `next_day_sl_check_time` field everywhere — 9:18 AM is hardcoded in scheduler, not configurable | ✅ Fixed |
| 4 | `models/algo.py`, `schemas/algo.py` | `default_days` on Algo — days are Smart Grid only | ✅ Fixed |
| 5 | `models/algo.py` | `dte` column missing — needed for Positional strategy | ✅ Fixed |
| 6 | `models/algo.py` (AlgoLeg) | W&T fields missing on AlgoLeg | ✅ Fixed |
| 7 | `models/algo.py` (AlgoLeg) | Re-entry config stored as JSON blob — should be per-leg columns | ✅ Fixed |
| 8 | `models/grid.py` | `is_archived` column missing on GridEntry | ✅ Fixed |
| 9 | `models/order.py` | `is_overnight` column missing on Order | ✅ Fixed |
| 10 | `models/` | `AlgoState` model does not exist anywhere | ✅ Fixed |
| 11 | `api/v1/grid.py` | Endpoint paths wrong | ✅ Fixed — Section 19 |
| 12 | `api/v1/orders.py` | RUN/RE/SQ/T controls inside orders router | ✅ Fixed — Section 19 |
| 13 | `api/v1/` | Services API entirely missing | ✅ Fixed — Section 19 |
| 14 | `engine/` | `AlgoRunner`, `AlgoScheduler`, `ReentryEngine` all stubs | ✅ Fixed — scheduler.py + reentry_engine.py built |
| 15 | `ws/` | WebSocket server does not exist | ✅ Fixed — connection_manager.py + ws/routes.py built |
| 16 | `frontend/src/services/api.ts` | Stale — wrong endpoint paths | ✅ Fixed — Section 19 |

### 🟡 Wire Up in Phase 1D (frontend)

| # | File | Issue |
|---|------|-------|
| 17 | `LoginPage.tsx` | No real auth — clicks go straight to `/grid`. Wire to `POST /auth/login`, store JWT. |
| 18 | `AlgoPage.tsx` | Save handler is a no-op (`addAlgo = (_:any)=>{}`). Wire to `algosAPI.create()` / `.update()`. |
| 19 | `AlgoPage.tsx` | Account dropdown hardcoded strings. Wire to accounts from Zustand store. |
| 20 | All pages | All data is hardcoded demo arrays. Wire every page to API + WebSocket in Phase 1D. |

*Note: `api.ts` is now correct (✅ Fixed in Section 19). The above are frontend component wiring tasks.*

### ✅ Confirmed Correct (code matches spec exactly)

- All 6 nav pages + correct routes
- Algo Config not in nav, accessed via `/algo/new` and `/algo/:id`
- "Indicator Systems" label correct in Sidebar
- PRACTIX toggle global in TopBar (per-cell in Smart Grid)
- Smart Grid: per-cell PRAC/LIVE toggle, E/X/M displayed in cells, status colours all correct
- Orders page: day tabs with P&L, MTM total right-aligned, RUN/RE/SQ/T buttons with correct colours, correct column order
- AlgoPage: Direct/ORB only at algo level, W&T per leg in UI, DTE conditional on Positional, ORB End conditional on ORB
- All engine components present and implemented: LTPConsumer, LTPCache, ORBTracker, WTEvaluator, SLTPMonitor, TSLEngine, MTMMonitor, VirtualOrderBook, OrderPlacer, StrikeSelector
- All 4 SL/TP variant types (pts/pct × instrument/underlying) correctly implemented in engine
- Zerodha broker fully implemented (token, LTP, option chain, order placement, WebSocket ticker)
- Angel One broker correctly stubbed for Phase 1
- Token refresh service complete for both Zerodha (manual) and Angel One (TOTP auto)
- MarginHistory + Trade models exist
- AccountsPage: 3 accounts, Wife PENDING, global SL/TP inputs, correct layout
- DashboardPage: 4 services, Start Session + Stop All, Zerodha Login, System Log, Account Status cards

---

## 20. User Flow (Platform Flow Document — March 2026)

*Source: STAAX - Platform Flow.rtf. This is the canonical user journey. Used as reference for validation rules, UI behaviour, and build prioritisation.*

---

### Flow 1 — Daily Session Start

| Step | Action | Notes |
|------|--------|-------|
| 1 | Login to platform | Single user but login required — platform carries sensitive broker credentials |
| 2 | Click **Start Session** on Dashboard | Should be done between 8–9 AM. If missed, session can start later but any algo whose entry time has already passed will NOT trigger for that day |
| 3 | Login all broker accounts | Zerodha requires manual daily login (request token flow). Angel One auto-refreshes via TOTP. **Future:** automate broker login via scheduler (noted as desired) |
| 4 | All 4 services running + broker tokens active → platform is live | Orders page now shows today's algos. Engine is watching. |

**Key rule:** Start Session = prerequisite for everything. No broker login = no trades. Partial login = only that broker's algos run.

---

### Flow 2 — Algo Creation

| Step | Action | Validation rule |
|------|--------|-----------------|
| 1 | Click **New Algo** on Smart Grid page | — |
| 2 | Enter name, lot multiplier, strategy, order type, account | All mandatory — show popup on Save if missing |
| 3 | Set entry type + entry time + exit time | Mandatory — popup if missing |
| 3.1 | If ORB selected → set ORB End Time | Mandatory when ORB — popup if missing |
| 3.2 | If Positional selected → set DTE | Mandatory when Positional — popup if missing |
| 4 | Configure legs | — |
| 4.1 | If W&T / SL / TP / TSL / RE enabled → fill their values | Mandatory when toggled on — popup if values missing |
| 5 | Entry/Exit order delays | Optional. Dropdown before each delay: **BUY legs** or **SELL legs** ← *new finding — currently missing from UI* |
| 6 | Error settings | Optional |
| 7 | Save algo → redirect to Smart Grid | — |
| 8 | Set PRACTIX or LIVE | Per-cell toggle in Smart Grid |
| 9 | Drag & drop algo into day columns | Assigns algo to trading days |

---

### Flow 3 — Algo Execution (Automatic)

| Step | What happens | Time |
|------|-------------|------|
| 1 | AlgoScheduler activates all today's GridEntries | 9:15 AM |
| 2 | Orders page shows all today's algos with live indicator | 9:15 AM |
| 3 | SL check for all open overnight positions (BTST/STBT/Positional) | 9:18 AM |
| 4 | Each algo fires at its configured entry time | Per-algo |
| 5 | Platform monitors open positions — SL/TP/TSL/MTM all automatic | Continuous |

---

### Flow 4 — Order Monitoring (Orders Page)

| Step | Behaviour |
|------|-----------|
| 1 | Default view: All Accounts. Account filter in header dropdown |
| 2 | Active day shown by default with a visual marker (indicator dot) |
| 2.1 | All algos for that day listed with their linked account |
| 2.2 | Algos go live at 9:15 AM — **green live indicator** shown per algo ← *new finding — needs implementation* |
| 3.1 | **RUN** — algo didn't trigger due to error/timeout → executes immediately |
| 3.2 | **RE** — a leg is in error → retries that leg (places order or re-places SL) |
| 3.3 | **SQ** — squares off selected open leg, cancels pending SL at broker, other legs stay active |
| 3.4 | **T** — squares off ALL positions, cancels ALL pending + SL orders at broker, terminates algo. No retry possible. |

---

### Flow 5 — Modifying an Algo

| Step | Behaviour |
|------|-----------|
| 1 | Click algo name in Smart Grid → redirected to Algo Config page |
| 2 | Make changes and save |
| 3.1 | **Algo cannot be edited when a trade is live** — edit only allowed during off-market hours/days ← *new finding — edit lock needs enforcement* |
| 4 | Saved changes apply from next day onward — does NOT affect today's running trades |

---

### Flow 6 — Reports

| Step | Behaviour |
|------|-----------|
| 1 | Default: All Accounts P&L. Account filter in header |
| 2 | Per-algo metrics: filter by FY / Month / Date / Custom period |
| 3 | **Download as Excel or CSV** ← *new finding — two format options needed, currently only one* |

---

### Flow 7 — Accounts

| Step | Behaviour |
|------|-----------|
| 1 | Set FY margin at start of financial year |
| 2 | Set global account-level SL and Target (₹ amount) |
| 3 | Save settings |

---

## 21. New Findings from Platform Flow Document

These items are NOT yet implemented and need to be added to the build backlog:

| # | Finding | Where | Priority |
|---|---------|-------|----------|
| F1 | **Broker auto-login via scheduler** — user wants automated broker login (Zerodha request token flow automation is hard due to OTP; Angel One already auto-refreshes) | Dashboard | Phase 1E |
| F2 | **Entry/Exit delay dropdown: BUY legs vs SELL legs** — currently the delay inputs have no scope selector. Need a dropdown before each delay field to choose whether delay applies to BUY legs or SELL legs | Algo Config | Phase 1D frontend wiring |
| F3 | **Green live indicator per algo on Orders page** — at 9:15 AM each algo that activates should show a green dot/indicator in the Orders table row | Orders page | Phase 1D frontend wiring |
| F4 | **Active day marker on Orders page** — today's tab should have a distinct visual marker (dot, badge, or highlight) beyond just being the selected tab | Orders page | Phase 1D frontend wiring |
| F5 | **Edit lock on live algos** — Algo Config page should detect if the algo has an active trade today and show a locked/read-only state with a message. Edit allowed only in off-market hours | Algo Config | Phase 1D frontend wiring |
| F6 | **Algo changes apply next day only** — when saving an algo that has a GridEntry for today, show a warning: "Changes will apply from tomorrow" | Algo Config | Phase 1D frontend wiring |
| F7 | **Reports download: Excel AND CSV** — currently spec says download. Need both format options (two buttons or a dropdown on the download button) | Reports | Phase 1E |
| F8 | **Start Session time window warning** — if user clicks Start Session after 9 AM, show a warning listing which algos have already passed their entry time and will not trigger today | Dashboard | Phase 1D frontend wiring |
| F9 | **SQ cancels broker SL order** — when SQ is triggered, must cancel the pending SL order at broker (not just close the position). Same for T (terminate). | Engine / OrderPlacer | Phase 1D engine |

---

## 22. Updated Build Backlog

### Phase 1D — Remaining

**Frontend wiring:**
- [ ] F2 — Entry/Exit delay: BUY/SELL scope dropdown on Algo Config
- [ ] F3 — Green live indicator per algo on Orders page (fires at 9:15 AM via WebSocket)
- [ ] F4 — Active day marker on Orders page day tabs
- [ ] F5 — Edit lock on Algo Config when trade is live today
- [ ] F6 — "Changes apply tomorrow" warning on algo save
- [ ] F8 — Late Start Session warning (list algos that missed their entry window)
- [ ] Wire LoginPage to `POST /auth/login`, store JWT
- [ ] Wire AlgoPage Save to `algosAPI.create()` / `.update()`
- [ ] Wire account dropdown on AlgoPage to Zustand accounts store
- [ ] Wire all pages to API + WebSocket (replace hardcoded demo data)

**Engine:**
- [ ] F9 — SQ and T must cancel pending SL orders at broker via `OrderPlacer`
- [ ] AlgoRunner — entry logic orchestrator (calls ORBTracker / WTEvaluator / OrderPlacer based on entry_type)

### Phase 1E — Planned

- [ ] F1 — Broker auto-login automation (investigate Zerodha TOTP/session feasibility)
- [ ] F7 — Reports download: Excel + CSV both formats
- [ ] SYNC — manual order sync
- [ ] Manual exit price correction
- [ ] TTP per leg
- [ ] Journey feature (multi-level re-entry config)
- [ ] NotificationService (Twilio WhatsApp + AWS SES)

---

*Update this document at the end of every phase before closing the session.*
