# STAAX — Living Engineering Spec
**Version:** 4.7 | **Last Updated:** 14 March 2026 — SVG icons, Promote to LIVE bots, account dropdown fixed — readability improved, daily kill switch reset at 08:00 IST, logout/theme buttons fixed | **PRD Reference:** v1.2

This document is the single engineering source of truth. Read this at the start of every session — do not re-read transcripts for context.

---

## 0. North Star — Product Vision

This section exists so Claude never loses sight of the bigger picture across sessions.

### The Platform Family

A personal financial OS being built by Karthikeyan. Five modules planned, each independent but feeding into FINEX as the master layer:

| Module | Full Name | Purpose | Status |
|--------|-----------|---------|--------|
| **STAAX** | Algo Trading Platform | F&O algo trading — automated strategies, order management, live P&L | 🔄 Phase 1F active |
| **INVEX** | Portfolio Manager | Fetches investments across all mapped accounts (Karthik, Mom, Wife). Fundamental + tech analysis dashboards. Quick insights to manage equity/MF portfolio. AI-assisted flagging and rebalancing. | 🔭 Future |
| **BUDGEX** | Expense Tracker | Captures everyday expenditure, organises it, feeds structured data to FINEX and the AI Avatar for financial reasoning | 🔭 Future |
| **FINEX** | Financial OS | Sits atop all modules. Consolidates data from STAAX + INVEX + BUDGEX. Tax planning, advance tax computation, networth view, financial independence status, expense management | 🔭 Future |
| **Avatar** | AI Financial Companion | Animated human avatar (Karthikeyan's avatar) embedded in FINEX. Greets on login, speaks & listens, surfaces tasks and portfolio insights. Name TBD. Replaces the earlier "FINEY" concept. | 🔭 Future |

### Module relationships

```
BUDGEX ──────────────────────────────┐
STAAX  ──→ (P&L, positions, trades)  ├──→ FINEX ──→ Avatar (AI companion)
INVEX  ──→ (portfolio, returns)  ─────┘
```

FINEX is the umbrella. It pulls structured data from all modules and provides the consolidated financial picture: total wealth, tax liability, advance tax due, expense patterns, and financial independence progress.

### Why login is required
STAAX handles extremely sensitive data: live broker API tokens, trading positions, P&L, and account credentials. Even though Karthikeyan is the sole user, authentication is non-negotiable. All future modules will share the same auth layer.

### Design principles across all modules
- Single owner, personal use — never multi-tenant
- Dark, minimal, professional aesthetic (consistent across all modules)
- No ads, no third-party analytics, no data sharing
- All data stays on owner's infrastructure (AWS ap-south-1)
- No bank account connections ever — all financial inputs are manual
- No sensitive PII stored or computed

### Current scope
Everything below this section relates to **STAAX** only.

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
- **Ticker Bar:** Live instrument prices shown at bottom of sidebar/navbar. Editable and reorderable list of instruments. Clicking an instrument opens its TradingView chart. See Section 23.

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
- SL / TP values — these are algo-level config, not per-cell
- Account name — shown in algo row label only

### Pie Chart (drag handle)
- Each algo row has a pie chart on the left, showing worst cell status for that algo
- The pie is the drag handle — drag it to a day column to deploy the algo

### Status colours
| Status | Colour |
|--------|--------|
| NO TRADE | Grey |
| ACTIVE | Cyan |
| PENDING | Amber |
| OPEN | Green |
| CLOSED | Dark green |
| ERROR | Red |

---

## 6. Orders Page

**Purpose:** Live intraday view. Shows all algos running today (or any day via day tab).

### Day Tabs
- MON–FRI tabs (Sat/Sun hidden unless "Show Weekends" enabled)
- Active day has a **live indicator dot** (green pulsing)
- **F4 today marker** — today's tab has a distinct visual marker
- Clicking a past day shows that day's orders (read-only, no controls)

### Algo Group (per algo per day)
- Algo name | Account badge | SL: ₹X | TP: ₹X | MTM: ₹X (live)
- Action buttons: **RUN | RE | SQ | T** (right side)
- Total P&L for algo (right)

### Order Row (per leg)
| Column | Description |
|--------|-------------|
| # | Leg number (1.1 = re-entry of leg 1) |
| STATUS | OPEN / CLOSED / ERROR / PENDING |
| SYMBOL | Strike + expiry |
| LOTS | Quantity (lots) |
| ENTRY/REF | Entry type (ORB High, W&T Up 5%, Direct) + Ref price |
| FILL | Actual fill price |
| LTP | Live last traded price |
| SL (A/O) | Actual SL / Original SL |
| TARGET | TP price |
| EXIT | Exit price + time |
| REASON | SL / TP / Manual / Auto-SQ |
| P&L | Running P&L for this leg |

### Action Buttons
- **RUN** — trigger entry manually (skips entry time check)
- **RE** — retry failed entry (ERROR state only)
- **SQ** — square off selected open legs, cancel broker SL order
- **T** — terminate: square off all + cancel all SL orders + no more entries today

---

## 7. Reports Page

**Purpose:** P&L analysis. FY calendar + per-algo metrics.

### Sections
1. **FY P&L card** — total, equity curve sparkline, vs previous year
2. **Month P&L card** — current month, vs previous month
3. **Today P&L card** — today, active algos count
4. **FY Calendar** — 12 month grid, each day is a coloured dot (green/red). Click month to expand.
5. **Per-Algo Metrics table** — filterable by FY / Month / Date / Custom

### Metrics columns
Overall P&L, Avg Day P&L, Max Profit, Max Loss, Win %, Loss %, Max Drawdown, ROI

### Download
- **F7:** Two format buttons — Excel (.xlsx) and CSV (.csv)

### Brokerage-Adjusted ROI (new — Phase 2)
- At FY start, platform prompts for brokerage expense per account
- ROI computed = (P&L − Brokerage) / Margin
- See Section 23 for full spec

---

## 8. Accounts Page

**Purpose:** Per-account configuration and broker token management.

### Per-Account Card
- Account name + broker + scope (F&O / MCX)
- Status badge: ACTIVE / PENDING
- FY Margin input + Save
- Global SL / TP inputs (₹ amounts) + Save Settings
- API Token status row

### Brokerage Expense (new — Phase 2)
- New field: **FY Brokerage Expense** (₹) per account
- Prompted once at the start of each new FY (April 1)
- Used to compute adjusted ROI in Reports
- See Section 23 for full spec

---

## 9. Auth

Single-user platform. No user table needed.

- Username: `karthikeyan` (hardcoded in frontend `LoginPage.tsx`)
- Password: bcrypt hash stored in `.env` as `STAAX_PASSWORD_HASH`
- Default password: `staax2024`
- JWT: 24-hour expiry, stored in `localStorage`
- Login page: password-only UI (username is hardcoded)

---

## 10. Algo Config Page

**Purpose:** Create and edit algo strategies.

### Fields
- Name, Account, Strategy type
- Order type (Market / Limit)
- Entry type: Direct / ORB / W&T
  - ORB: requires ORB End Time
  - Positional: requires DTE
- Entry time, Exit time
- Lot multiplier
- Entry delay (with BUY/SELL scope — **F2**)
- Exit delay (with BUY/SELL scope — **F2**)

### Legs
Each leg has:
- Instrument (NF, BN, MN, etc.)
- Direction (BUY / SELL)
- Strike selection config
- W&T threshold (optional)
- SL / TP / TSL (optional)
- TTP — Trailing Take Profit (future)

### Edit Lock (F5)
- Algo with an active trade today → edit locked → read-only with message
- Edit allowed only in off-market hours

### Save Behaviour (F6)
- If algo has a GridEntry for today → warning: "Changes apply from tomorrow"

---

## 11. Engine Architecture

### LTP callback registration order (tick path)
1. `orb_tracker.on_tick` — ORB range tracking
2. `wt_evaluator.on_tick` — W&T threshold watch
3. `tsl_engine.on_tick` — TSL trail (updates SL before SL check)
4. `sl_tp_monitor.on_tick` — SL/TP hit detection

### Engine singletons (wired in main.py lifespan)
- `ltp_consumer` — Zerodha WebSocket tick feed
- `orb_tracker` — ORB window management
- `wt_evaluator` — Wait & Trade threshold
- `sl_tp_monitor` — SL/TP hit detection
- `tsl_engine` — Trailing SL
- `mtm_monitor` — MTM breach detection
- `order_placer` — broker order placement
- `strike_selector` — strike selection logic
- `reentry_engine` — re-entry orchestration
- `algo_runner` — top-level orchestrator
- `scheduler` — APScheduler job manager

### AlgoRunner entry path
1. Load AlgoState + GridEntry + Algo + legs
2. Guard: status must be WAITING (or ACTIVE for re-entry)
3. Per-leg: W&T deferred registration OR strike selection → entry delay (scoped BUY/SELL) → OrderPlacer.place() → persist Order → register SLTPMonitor + TSLEngine + MTMMonitor → subscribe LTP token
4. Update AlgoState→ACTIVE, GridEntry→OPEN
5. WebSocket broadcast

---

## 12. Database Models

### Core tables
- `accounts` — broker accounts (Karthik, Mom, Wife)
- `algos` — algo configs
- `algo_legs` — per-leg config per algo
- `grid_entries` — weekly grid deployments
- `algo_states` — daily runtime state per algo per grid entry
- `orders` — individual leg orders
- `trades` — completed round-trip trades (entry + exit pair)
- `margin_history` — FY margin snapshots

### Status enums
- AlgoState: `waiting | active | closed | error | terminated`
- Order: `pending | open | closed | error`
- GridEntry: `waiting | open | closed | no_trade | error`

---

## 13. API Routes

### Auth
- `POST /api/v1/auth/login` — returns JWT
- `GET /api/v1/auth/me` — current user info

### Accounts
- `GET /accounts/` — list all accounts
- `GET /accounts/status` — broker token status
- `POST /accounts/{id}/margin` — update FY margin
- `POST /accounts/{id}/global-risk` — update global SL/TP
- `GET /accounts/zerodha/login-url` — Zerodha OAuth URL
- `POST /accounts/zerodha/set-token` — set Zerodha request token
- `GET /accounts/zerodha/token-status` — token validity check

### Algos
- `GET /algos/` — list all algos
- `POST /algos/` — create algo
- `GET /algos/{id}` — get algo + legs
- `PUT /algos/{id}` — update algo
- `DELETE /algos/{id}` — delete algo
- `POST /algos/{id}/archive` — archive algo ✅
- `POST /algos/{id}/unarchive` — reactivate algo ✅
- `POST /algos/{id}/start` — RUN
- `POST /algos/{id}/re` — RE (retry error)
- `POST /algos/{id}/sq` — SQ (square off)
- `POST /algos/{id}/terminate` — T (terminate)

### Grid
- `GET /grid/` — list week entries (params: week_start, week_end)
- `POST /grid/` — deploy algo to day
- `GET /grid/{id}` — get entry
- `PUT /grid/{id}` — update (multiplier, practix flag)
- `DELETE /grid/{id}` — remove
- `POST /grid/{id}/archive` — archive entry
- `POST /grid/{id}/unarchive` — unarchive entry
- `POST /grid/{id}/mode` — toggle practix/live
- `POST /grid/{algoId}/promote-live` — promote all cells to live

### Orders
- `GET /orders/` — list orders (param: date)
- `PATCH /orders/{id}/exit-price` — correct exit price
- `POST /orders/{id}/sync` — manual sync

### Services
- `GET /services/` — service status
- `POST /services/start-all` — start all
- `POST /services/stop-all` — stop all
- `POST /services/{id}/start` — start one
- `POST /services/{id}/stop` — stop one

### Reports
- `GET /reports/equity-curve`
- `GET /reports/metrics`
- `GET /reports/calendar`
- `GET /reports/download` — blob (Excel/CSV)

### WebSocket channels
- `ws://localhost:8000/ws/pnl` — live P&L ticks
- `ws://localhost:8000/ws/status` — algo status updates
- `ws://localhost:8000/ws/notifications` — platform notifications

---

## 14. Frontend Services (api.ts)

All API calls are in `frontend/src/services/api.ts`. Key alignments confirmed:
- `gridAPI.list({ week_start, week_end })` ✅
- `gridAPI.deploy({ algo_id, trading_date, lot_multiplier, is_practix })` ✅ (no `day_of_week`)
- `gridAPI.setMode(entryId, { is_practix: boolean })` ✅
- `algosAPI.archive(id)` / `algosAPI.unarchive(id)` ✅

---

## 15. Auth Implementation

- `backend/app/api/v1/auth.py` — checks username + bcrypt hash
- `backend/app/core/security.py` — uses `bcrypt` directly (passlib removed due to version conflict)
- `backend/app/core/config.py` — `STAAX_USERNAME` + `STAAX_PASSWORD_HASH` fields added
- `.env` — `STAAX_USERNAME=karthikeyan`, `STAAX_PASSWORD_HASH=<bcrypt hash>`

---

## 16. Key File Locations

### Backend
```
backend/
├── main.py                          — FastAPI app + full lifespan wiring
├── app/
│   ├── core/
│   │   ├── config.py                — Settings (pydantic-settings, .env)
│   │   ├── database.py              — SQLAlchemy async engine
│   │   ├── security.py              — bcrypt + JWT (no passlib)
│   ├── api/v1/
│   │   ├── auth.py                  — login + /me
│   │   ├── algos.py                 — CRUD + archive + runtime controls
│   │   ├── grid.py                  — grid CRUD
│   │   ├── accounts.py              — accounts + broker tokens
│   │   ├── orders.py                — orders
│   │   ├── services.py              — service status
│   │   ├── reports.py               — reports
│   ├── engine/
│   │   ├── algo_runner.py           — top-level orchestrator ✅
│   │   ├── scheduler.py             — APScheduler jobs ✅
│   │   ├── reentry_engine.py        — re-entry logic ✅
│   │   ├── ltp_consumer.py          — Zerodha tick feed
│   │   ├── orb_tracker.py           — ORB window
│   │   ├── wt_evaluator.py          — W&T threshold
│   │   ├── sl_tp_monitor.py         — SL/TP detection
│   │   ├── tsl_engine.py            — Trailing SL
│   │   ├── mtm_monitor.py           — MTM breach
│   │   ├── order_placer.py          — broker order placement
│   │   ├── strike_selector.py       — strike selection
│   │   ├── virtual_order_book.py    — PRACTIX simulation
```

### Frontend
```
frontend/src/
├── pages/
│   ├── LoginPage.tsx
│   ├── DashboardPage.tsx
│   ├── GridPage.tsx                 — fully wired to API ✅
│   ├── OrdersPage.tsx
│   ├── ReportsPage.tsx
│   ├── AccountsPage.tsx
│   ├── AlgoPage.tsx
├── components/layout/
│   ├── TopBar.tsx                   — fixed (accounts array guard) ✅
│   ├── Layout.tsx
│   ├── Sidebar.tsx
├── services/
│   ├── api.ts                       — all API calls, fully aligned ✅
├── store/
│   ├── index.ts                     — Zustand store
```

---

## 17. Platform Flow Rules — Implementation Status

*Source: STAAX Platform Flow Document. Maps each rule to its implementation status.*

| Rule | Description | Status |
|------|-------------|--------|
| **F1** | Broker auto-login via scheduler | ✅ Complete Phase 1E |
| **F2** | Entry/Exit delay: BUY vs SELL scope dropdown | ✅ AlgoRunner `enter()` scopes delay |
| **F3** | Green live indicator per algo on Orders page | ✅ Frontend wired (Phase 1D) |
| **F4** | Active day marker on Orders page | ✅ Frontend wired (Phase 1D) |
| **F5** | Edit lock on Algo Config when trade is live | ✅ Frontend wired (Phase 1D) |
| **F6** | Warning when saving algo with today's GridEntry | ✅ Frontend wired (Phase 1D) |
| **F7** | Reports download: Excel + CSV both options | ✅ Complete Phase 1E |
| **F8** | Start Session late warning (past 9 AM) | ✅ Frontend wired (Phase 1D) |
| **F9** | SQ/T cancels broker SL orders | ✅ `_cancel_broker_sl()` in AlgoRunner |
| **Flow 1** | Daily session start: Start Session → broker login → 9:15 activate | ✅ Dashboard + Scheduler |
| **Flow 2** | Algo creation validation (all mandatory fields, popup on missing) | ✅ AlgoPage |
| **Flow 3** | Algo execution: 9:15 activate → per-algo entry → SL/TP/TSL monitoring | ✅ Engine complete |
| **Flow 4** | Orders page: RUN/RE/SQ/T buttons with correct semantics | ✅ Frontend + engine stubs |
| **Flow 5** | Edit lock + "changes apply tomorrow" warning | ✅ Frontend wired |
| **Flow 6** | Reports: FY/Month/Date/Custom filter + download | ✅ Frontend (download stub) |
| **Flow 7** | Accounts: FY margin + global SL/TP save | ✅ Frontend wired |

**Not yet implemented (requires DB phase):**
- All actual DB reads/writes (all endpoints currently return stubs)
- Real P&L flowing to Reports
- Brokerage expense tracking (new — Phase 2)

---

## 18. New Requirements — Future Phases

### NR-1 — AI Avatar (replaces FINEY concept)
**Phase:** FINEX (Future)

A human animated avatar — Karthikeyan's own avatar — embedded in FINEX as an AI financial companion. This replaces the earlier "FINEY chatbox" concept entirely.

**Behaviour:**
- Avatar enters the platform on login with an entry animation
- Greets the user by name and time of day
- Speaks and listens (voice interface — no chatbox)
- Immediately surfaces actionable items: portfolio tasks, tax deadlines, rebalancing alerts, algo P&L summaries, money management nudges
- Has a name (TBD — to be decided when FINEX build starts)
- Animations: idle, speaking, listening, thinking states
- Reasons across all module data (STAAX P&L + INVEX portfolio + BUDGEX expenses + FINEX tax)

**Technical considerations:**
- Animated avatar: could use Ready Player Me, custom 2D/3D, or illustrated character
- Voice: Web Speech API (listen) + TTS (speak)
- AI reasoning: Anthropic Claude API (same model family)
- Data context: pulls structured summaries from all modules

---

### NR-2 — Mac Menu Bar Widget / App Widget
**Phase:** Phase 2 (post-DB)

A lightweight native Mac menu bar component or iOS/macOS widget for quick actions without opening the full platform.

**Capabilities:**
- View today's P&L (per account + combined)
- Start the day's session (Start Session shortcut)
- View open positions count
- Quick notifications (SL hit, TP hit, algo error)

**Technical options:**
- Mac menu bar: Electron or Swift/SwiftUI menulet pulling from STAAX API
- iOS widget: SwiftUI WidgetKit pulling from STAAX API
- Both use the existing STAAX REST API — no new backend needed

---

### NR-3 — Live Instrument Ticker Bar
**Phase:** Phase 1E / Phase 2

A scrolling or fixed ticker bar showing live prices of all instruments being traded. Placed at the **bottom of the sidebar** (persistent across all pages).

**Behaviour:**
- Shows live LTP for each configured instrument (NIFTY, BANKNIFTY, MIDCPNIFTY, etc.)
- User can **edit and reorder** the instruments shown
- Clicking an instrument opens its **TradingView chart** (embedded or new tab)
- TradingView integration: use TradingView Lightweight Charts (free, open source) for embedded charts, or TradingView widget for full chart
- If TradingView API costs are prohibitive for charts, ticker prices still show (from existing LTP feed) — charts are optional

**Technical notes:**
- Prices come from existing `ltp_consumer` (Zerodha WebSocket) — no new data source needed
- Ticker instruments list stored in user settings (DB)
- TradingView Lightweight Charts is MIT licensed and free

---

### NR-4 — Brokerage Expense Tracking + Adjusted ROI
**Phase:** Phase 2

**Problem:** Current ROI calculation does not account for brokerage expenses, making it look better than reality.

**Behaviour:**
- On **April 1 each year** (FY start), platform shows a prompt on Dashboard or Accounts page: "Enter brokerage expense for FY 2025-26"
- User enters estimated or actual brokerage ₹ amount per account
- This is stored against the account for that FY
- **Adjusted ROI** = (P&L − Brokerage Expense) / FY Margin
- Shown in Reports page alongside raw ROI
- Also shown on Accounts page per account

**Fields to add to Accounts page:**
- FY Brokerage Expense (₹) — editable, per account
- Shown under Global SL/TP section

**Fields to add to Reports:**
- Adjusted ROI column in per-algo metrics table
- Brokerage expense row in FY summary

---

## 19. Live Trading Stability Enhancements

These four modules harden the platform against broker failures, network drops, and state mismatches during live trading. Designed and authored by Karthikeyan.

---

### SE-1 — Global Kill Switch (`engine/global_kill_switch.py`)
**Phase:** 1E
**Purpose:** Immediate emergency shutdown of the entire platform.

**When triggered, the system must:**
- Square off all open positions
- Cancel all pending broker orders
- Cancel all broker SL orders
- Mark all active algos as TERMINATED
- Prevent any new entries for the remainder of the session

**API Endpoint:** `POST /api/v1/system/kill-switch`

**Execution Flow — Broker First (critical design rule):**
```python
KillSwitch.activate()
# Step 0: freeze engine immediately
engine_state = EMERGENCY_STOP
disable OrderRetryQueue       # no retries during kill
disable ReEntryEngine         # no re-entries during kill
disable Scheduler entries     # no new scheduled tasks

# Step 1: fetch broker state (source of truth — NOT DB)
open_orders    = broker.get_open_orders()
open_positions = broker.get_positions()

# Step 2: cancel all pending orders at broker first
for order in open_orders:
    broker.cancel_order(order.id)

# Step 3: square off all open positions at broker (market orders)
for position in open_positions:
    broker.square_off_market(position)

# Step 4: VERIFICATION RETRY LOOP — handles partial fills
# Partial fills can create NEW positions milliseconds after square-off.
# Never rely on a single check. Loop up to 5 times until broker is flat.
for attempt in range(1, 6):
    sleep(2s)
    verify_orders    = broker.get_open_orders()
    verify_positions = broker.get_positions()
    for o in verify_orders:    broker.cancel_order(o.id)      # cancel stragglers
    for p in verify_positions: broker.square_off_market(p)    # square off partial fills
    if both empty: broker confirmed FLAT ✅ → break
    if attempt == 5: log CRITICAL — MANUAL INTERVENTION REQUIRED

# Step 5: only after broker confirmed → update DB
update AlgoState → TERMINATED
update GridEntry → CLOSED
update Orders    → CLOSED / CANCELLED

# Step 6: notify system
broadcast WebSocket kill-switch event
log [CRITICAL] GLOBAL KILL SWITCH ACTIVATED — N positions sq off, M orders cancelled
```

**Design principle:** DB is NEVER updated before broker is acted on. If broker API call fails, DB state is NOT modified. The broker terminal is always the source of truth.

**UI:** Prominent **KILL SWITCH** button on Dashboard with confirmation dialog before activation.

---

### SE-2 — Order Retry Queue (`engine/order_retry_queue.py`)
**Phase:** 1E
**Purpose:** Handle temporary broker/API failures during order placement.

**Architecture change:**
```
AlgoRunner → OrderRetryQueue → OrderPlacer
```

**Retry rules:**
- Attempt 1 → immediate
- Attempt 2 → retry after 2 seconds
- Attempt 3 → retry after 5 seconds
- All retries failed → Order status = ERROR

**Retry metadata fields on Order model:**
- `retry_count`
- `last_retry_time`

**UI:** Orders with ERROR status show **RE** button. Clicking RE calls `POST /api/v1/algos/{id}/re` → triggers retry via OrderRetryQueue. (RE button already exists in Orders page — SE-2 wires its backend behaviour.)

---

### SE-3 — Broker Reconnect Manager (`engine/broker_reconnect.py`)
**Phase:** 1E
**Purpose:** Maintain stable market data WebSocket connectivity.

**Monitoring logic:**
- Track timestamp of last received tick
- If no tick received for **5 seconds** → assume connection lost

**Reconnect flow:**
```
BrokerReconnectManager.check()
→ Detect stale feed
→ Reconnect WebSocket
→ Re-authenticate if needed
→ Re-subscribe tokens
→ Resume tick processing
```

**Scheduler:** Runs every 3 seconds via APScheduler.

**Log examples:**
```
[WARNING] Market feed inactive for 5s — reconnecting
[INFO] WebSocket reconnected and tokens resubscribed
```

---

### SE-4 — Order Reconciliation Engine (`engine/order_reconciler.py`)
**Phase:** 1F (after DB wiring and broker adapters complete)
**Purpose:** Ensure platform state always matches broker reality.

**Frequency:** Every 15 seconds via APScheduler.

**Data sources compared:** Broker orders + positions + trades vs STAAX DB state.

**Mismatch cases handled:**

| Case | DB State | Broker State | Action |
|------|----------|-------------|--------|
| 1 | OPEN | FILLED | Update DB → register SL/TP monitoring |
| 2 | OPEN | CANCELLED | Update order to ERROR |
| 3 | PENDING | FILLED | Update order to OPEN |
| 4 | No record | Position exists | Create recovery order entry → register monitoring |

**Log:** `[RECON] Order mismatch detected — state corrected`

**WebSocket:** Broadcasts reconciliation corrections to frontend.

---

### SE-5 — Engine Integration (main.py additions)
**Phase:** 1E (SE-1, SE-2, SE-3) | 1F (SE-4, ExecutionManager, PositionRebuilder)

New engine singletons to add to `backend/main.py`:
- `global_kill_switch`
- `order_retry_queue`
- `broker_reconnect_manager`
- `order_reconciler`
- `execution_manager` (Phase 1F)
- `position_rebuilder` (runs once on startup — Phase 1F)

Scheduler jobs:
- `order_reconciler` → every 15 seconds
- `broker_reconnect_manager` → every 3 seconds

---

## 21. Hidden Failure Scenarios

Critical failure scenarios identified for live trading. Each has a mitigation strategy built into the engine design.

---

### HF-1 — Partial Fill During Kill Switch
**Risk:** An order is partially filled when the kill switch activates. Remaining lots get filled milliseconds after the system cancels the order, creating a new unexpected position.

**Example:**
1. Order placed for 5 lots
2. Exchange fills 2 lots
3. Kill switch triggers → cancels order, squares off 2 lots
4. Remaining 3 lots fill at broker milliseconds later
5. New position appears after system believes everything is closed

**Mitigation:** Kill Switch step 4 is a **retry verification loop** (up to 5 attempts, 2s apart). Each attempt re-fetches broker positions and cancels/squares any stragglers. If broker is not flat after 5 attempts → CRITICAL log + manual intervention alert.

---

### HF-2 — Ghost Order (Network Response Loss)
**Risk:** Order reaches broker and executes, but network timeout prevents the response from reaching STAAX. Platform believes order failed and retry logic places a second order, creating a duplicate position.

**Example:**
1. STAAX sends order to broker
2. Broker executes successfully
3. Network timeout before response arrives
4. STAAX marks order as failed
5. Retry logic sends second order → duplicate position

**Mitigation:** Order Reconciliation Engine (SE-4) polls broker every 15 seconds and compares with DB. Uses broker order IDs as source of truth. Detects and corrects duplicate entries automatically.

---

### HF-3 — System Restart With Open Positions
**Risk:** Server restarts (crash or deploy) while trades are active. Engine restarts without awareness of existing positions → SL/TP monitoring stops → positions unmanaged.

**Mitigation:** Position Rebuilder (Architecture improvement AR-2) runs at startup. Fetches broker positions, rebuilds AlgoState, re-registers all SL/TP/TSL monitors.

---

## 22. Architecture Improvements

Planned improvements to platform architecture for production resilience.

---

### AR-1 — Execution Manager Layer (`engine/execution_manager.py`)
**Phase:** 1F
**Purpose:** Central coordination layer between AlgoRunner and broker order placement.

**Problem:** Without a central layer, execution logic spreads across AlgoRunner, OrderRetryQueue, and OrderPlacer — hard to control, debug, or enforce global risk rules consistently.

**Proposed Architecture:**
```
AlgoRunner
    ↓
ExecutionManager          ← new central control point
    ↓
OrderRetryQueue
    ↓
OrderPlacer
```

**Responsibilities:**
- Apply global risk checks before every order placement
- Handle Kill Switch integration (block all orders when activated)
- Route orders through retry queue
- Coordinate RUN / SQ / T manual actions from Orders page
- Maintain execution audit log (every order decision recorded)

**Benefits:** Single control point for the entire order lifecycle. Easier risk enforcement. Cleaner separation of concerns. Better observability.

---

### AR-2 — Position Rebuilder (`engine/position_rebuilder.py`)
**Phase:** 1F
**Purpose:** Recover full trading state after server restart or crash.

**Startup Flow:**
```
System boot
→ Fetch broker positions
→ Fetch broker open orders
→ Compare with STAAX DB state
→ Rebuild missing AlgoState entries
→ Recreate monitoring pipelines:
     SLTPMonitor
     TSLEngine
     MTMMonitor
→ Re-subscribe market data tokens for open positions
→ Log: [STARTUP] Position Rebuilder complete — N positions recovered
```

**Benefits:** Prevents orphan positions after restart. Maintains SL/TP protection continuously. Keeps DB synchronized with broker reality on every boot.

---

## 20. Build Backlog

### Phase 1E — Active (current)

**Status: API alignment complete. Next: PostgreSQL DB setup.**

**Completed this phase:**
- ✅ AlgoRunner (`engine/algo_runner.py`) — full entry orchestrator
- ✅ Scheduler wired (`scheduler.py`) — all TODO stubs replaced
- ✅ ReentryEngine wired (`reentry_engine.py`) — calls AlgoRunner
- ✅ main.py lifespan — all 9 engines wired, LTP callbacks registered
- ✅ GridPage fully wired to API (deploy, remove, setMode, multiplier, archive)
- ✅ api.ts fully aligned (gridAPI.list, setMode signature, algosAPI.archive/unarchive)
- ✅ algos.py — archive + unarchive endpoints added
- ✅ Auth fixed end-to-end (bcrypt direct, config.py fields, .env values)
- ✅ TopBar crash fixed (accounts array guard)
- ✅ security.py — passlib replaced with direct bcrypt (version conflict fix)

**Remaining:**
- ✅ **PostgreSQL setup** — installed, DB created, migrations run, 3 accounts seeded
- ✅ **accounts.py wired** — `GET /accounts/` reads real DB data (Karthik, Mom, Wife)
- ✅ **accounts.py margin + global-risk** — DB write implemented
- ✅ **accounts.py zerodha token** — token-status and set-token wired to DB
- ✅ **main.py fixed** — CORS_ORIGINS, create_ticker() deferred until after broker login
- ✅ **model enum fix** — `values_callable` added to all enum columns (account, algo, grid, algo_state, order models)
- ✅ **algos.py wired** — CRUD + archive/unarchive reading real DB ← verified returning `[]` cleanly
- ✅ **grid.py wired** — deploy/list/remove/setMode/promote-live real DB
- ✅ **orders.py wired** — list/get/exit-price/sync/square-off real DB
- ✅ **AlgoConfig button label** — "Save Algo" on `/algo/new`, "Update Algo" on `/algo/:id` (frontend only)
- ✅ **SE-1: GlobalKillSwitch** — `engine/global_kill_switch.py` + `POST /api/v1/system/kill-switch` + Dashboard UI (button + modal + result banner)
- ✅ **SE-2: OrderRetryQueue** — `engine/order_retry_queue.py` + RE endpoint wired + `retry_count`/`last_retry_time` DB columns (migration 0002)
- ✅ **SE-3: BrokerReconnectManager** — `engine/broker_reconnect.py` + scheduler every 3s + module-level import fix
- ✅ **Angel One broker** — complete SmartAPI implementation (login_with_totp, place_order, get_positions, get_margins, get_option_chain, cancel_order, get_order_book, get_profile)
- ✅ **UI-2: Kill Switch button height** — uses `className="btn"` to inherit base height; modal Cancel/Activate matched
- ✅ **UI-1: Global SL/TP in Accounts** — verified already working, not broken
- ✅ **§24: Account-Level Kill Switch** — modal shows per-account checkboxes; selective kill; KILLED badge on account cards; partial re-kill supported; backend tracks killed_account_ids
- ✅ **F1** — Broker auto-login (Zerodha: browser login button; Angel One: TOTP auto-login; Wife: Phase 2 deferred)
- ✅ **F7** — Reports download: CSV + Excel (FY filter, blob download, spinner, utf-8-sig encoding)
- ⬜ **NR-3 (ticker bar)** — live instrument prices in sidebar
- ✅ **SYNC** — re-link delinked orders via Broker Order ID (comma-separated multi-ID, fetches from broker API)
- ✅ **Manual exit price correction** — click dashed exit price on closed leg, modal saves via PATCH /orders/{id}/exit-price
- ✅ **TTP** — Trailing Take Profit per leg (backend + frontend complete — commit `15f1f82`, `b85538e`)
- ✅ **Journey feature** — multi-level child leg config (backend + frontend complete — commit `15f1f82`, `8869b67`)
- ⬜ **NotificationService** — Twilio WhatsApp + AWS SES

**Key fixes applied this session:**
- `backend/.env` — cleaned all duplicates, single DATABASE_URL (asyncpg), single STAAX_USERNAME
- `app/models/account.py` — `values_callable=lambda x: [e.value for e in x]` on BrokerType + AccountStatus enums
- `alembic/env.py` — sync-only (psycopg2), no asyncio
- `alembic/versions/0001_initial_schema.py` — all 8 tables + seed accounts

### Phase 1F — Next (after broker adapters complete)

- ⬜ **SE-4: OrderReconciler** — `engine/order_reconciler.py` + scheduler every 15s (HF-2 mitigation)
- ⬜ **AR-1: ExecutionManager** — `engine/execution_manager.py` — central order control layer
- ⬜ **AR-2: PositionRebuilder** — `engine/position_rebuilder.py` — startup state recovery (HF-3 mitigation)
- ⬜ **WebSocket wiring** — wire WS manager to Kill Switch broadcast
- ⬜ **orders.py square-off** — wire actual broker square-off call via ExecutionManager

### Phase 2 — Planned

- ⬜ **SE-4: OrderReconciler** — `engine/order_reconciler.py` + scheduler every 15s (after broker adapters complete)
- ⬜ **NR-2 (Mac widget)** — menu bar component for quick P&L + session start
- ⬜ **NR-3 (charts)** — TradingView chart integration on instrument click
- ⬜ **NR-4 (brokerage expense)** — FY brokerage tracking + adjusted ROI
- ⬜ **Wife account (MCX)** — Angel One SmartAPI for GOLDM futures
- ⬜ **INVEX** — portfolio manager (separate module)
- ⬜ **BUDGEX** — expense tracker (separate module)

### Phase 3 — Future

- ⬜ **FINEX** — financial OS consolidating all modules
- ⬜ **AI Avatar** — NR-1 animated companion in FINEX
- ⬜ **FINEY → Avatar rename** — name TBD when FINEX build starts

---

## 20. User Flow (Platform Flow Document)

### Flow 1 — Daily Session Start

| Step | Action | Notes |
|------|--------|-------|
| 1 | Login to platform | Single user, password: `staax2024` |
| 2 | Click **Start Session** on Dashboard | 8–9 AM. If late, algos past entry time won't fire today |
| 3 | Login all broker accounts | Zerodha: manual daily token. Angel One: auto-TOTP |
| 4 | All 4 services running + broker tokens active → platform is live | |

### Flow 2 — Algo Creation

| Step | Action | Validation |
|------|--------|-----------|
| 1 | Click **New Algo** on Smart Grid | — |
| 2 | Enter name, lot multiplier, strategy, order type, account | All mandatory |
| 3 | Set entry type + entry/exit time | Mandatory |
| 3.1 | ORB selected → set ORB End Time | Mandatory for ORB |
| 3.2 | Positional → set DTE | Mandatory for Positional |
| 4 | Configure legs | — |
| 4.1 | W&T / SL / TP / TSL / RE enabled → fill values | Mandatory when toggled on |
| 5 | Entry/Exit delays with BUY/SELL scope | Optional |
| 6 | Save → redirect to Smart Grid | — |
| 7 | Set PRACTIX or LIVE per cell | Per-cell toggle |
| 8 | Drag pie → day column to deploy | Assigns algo to days |

### Flow 3 — Algo Execution (Automatic)

| Step | What happens | Time |
|------|-------------|------|
| 1 | AlgoScheduler activates all today's GridEntries | 9:15 AM |
| 2 | Orders page shows all today's algos with live indicator | 9:15 AM |
| 3 | SL check for open overnight positions | 9:18 AM |
| 4 | Each algo fires at its configured entry time | Per-algo |
| 5 | Platform monitors: SL/TP/TSL/MTM all automatic | Continuous |

### Flow 4 — Orders Page

| Button | Behaviour |
|--------|-----------|
| RUN | Trigger entry now (bypasses entry time) |
| RE | Retry failed entry (ERROR state only) |
| SQ | Square off selected legs + cancel broker SL |
| T | Square off all + cancel all SL + terminate (no retry) |

### Flow 5 — Modifying an Algo

- Click algo name in Smart Grid → Algo Config page
- **Edit locked** if algo has active trade today
- Saved changes apply **next day only**
- **Save / Update button label rule:**
  - `/algo/new` → button label = **"Save Algo"**
  - `/algo/:id` (editing existing) → button label = **"Update Algo"**
  - This gives clear visual differentiation between create and edit modes

### Flow 6 — Reports

- FY / Month / Date / Custom filter
- Download as Excel OR CSV (F7)
- Adjusted ROI (when brokerage expense entered — Phase 2)

### Flow 7 — Accounts

- Set FY margin at FY start
- Set global account-level SL and TP (₹ amounts)
- Set FY brokerage expense (Phase 2) — used for adjusted ROI

---

*Update this document at the end of every phase before closing the session.*

---

## 30. Phase 1E — Completed Features

### §30.1 — TTP Engine (Trailing Take Profit)
**File:** `backend/app/engine/ttp_engine.py`
- Mirrors TSLEngine architecture — trails TP upward on every X pts/pct move
- `update_tp()` method added to `sl_tp_monitor.py`
- Wired in `algo_runner.py` via `wire_engines()`, registered in `_place_leg`, deregistered in `exit_all`
- `ttp_engine_ins` instantiated in `main.py`, registered as LTP callback
- DB columns: `ttp_x`, `ttp_y`, `ttp_unit` on `AlgoLeg`

### §30.2 — Journey Engine (Multi-level Child Leg Firing)
**File:** `backend/app/engine/journey_engine.py`
- `SyntheticLeg` + `JourneyEngine` singleton — fires child leg on parent exit
- Supports up to 3 levels: Child → Grandchild → Great-grandchild
- `journey_config` JSON column on `AlgoLeg` (already existed)
- Wired in `algo_runner.py` and `main.py`

### §30.3 — AlgoPage.tsx TTP + Journey UI
**Commits:** `b85538e`, `8869b67`, `943f845`, `910984e`, `0bb5baa`

**TTP UI:**
- Purple (`#A78BFA`) toggle chip per leg
- X → Y pts/% inputs, wired to `buildPayload`
- TSL guard: only activatable after SL is enabled AND has a value
- TTP guard: only activatable after TP is enabled AND has a value
- TSL auto-deactivates when SL is toggled off; TTP auto-deactivates when TP is toggled off

**Journey UI:**
- Collapsible `▸ JOURNEY` panel per leg
- `● ACTIVE` label when child leg enabled
- Child leg: full parity with parent — OP/FU, instrument, BUY/SELL, CE/PE, expiry, strikeMode, strike/premium, lots, all 6 feature toggles (W&T/SL/RE/TP/TSL/TTP) with value rows
- Feature chips inline in Row 1 (same row as instrument config), separated by `|` divider
- `buildJourneyConfig()` recursively serialises child config to JSON

**Time inputs (Entry/Exit/ORB):**
- Replaced native `<input type="time">` with a compact `TimeInput` component
- Custom wrapper with clock SVG icon (blue, non-clickable) + transparent inner time input
- `colorScheme: dark` to suppress white browser chrome
- Clock picker icon hidden via CSS (`.staax-time-input::-webkit-calendar-picker-indicator`)
- HH clamped to 09–15 on `onChange` + `onBlur`
- MM/SS 00–59 (native browser handles)
- Matches height (32px), background (`--bg-secondary`), border of all other inputs

**Leg select dropdowns:**
- All leg selects (instCode, expiry, strikeMode, strikeType) now use `className="staax-select"` for uniform chevron arrow
- `s` const stripped to `{ height, fontSize, fontFamily }` only — no inline bg/border overrides that would clobber the class's SVG arrow
- Active selection colour: instCode, expiry, strikeMode, strikeType, lots — dim (`--text-muted`) at default value, bright (`--text`) when user-changed

**Save validation rules:**
- All times must be within 09:15–15:30
- Intraday: exit time must be after entry time
- ORB: ORB end time must be after entry (ORB start) time
- Violations surface as save error banner (existing toast mechanism)

---

## 31. Phase 1E — Pending Checklist

All items below are pending implementation. Work through them in order unless instructed otherwise.

### UI Fixes (AlgoPage.tsx)

| # | Issue | Details |
|---|-------|---------|
| ~~UI-A~~ | ~~**White input cells in LEGS**~~ | ✅ Fixed — `s`/`cs` consts restored with `--bg-secondary` bg. Commit `02649be` |
| ~~UI-B~~ | ~~**Premium input showing for Straddle**~~ | ✅ Fixed — premium input hidden when `strikeMode = straddle`. Commit `02649be` |
| ~~UI-C~~ | ~~**Straddle mode — dedicated % dropdown**~~ | ✅ Fixed — 5–60% dropdown (multiples of 5), defaults to 20%, applied to parent + child legs. Commit `02649be` |
| ~~UI-D~~ | ~~**Leg select arrow uniformity**~~ | ✅ Fixed — all leg selects use `className="staax-select"`. Commit `0bb5baa` |

### Business Logic / Validation

| # | Issue | Details |
|---|-------|---------|
| ~~BL-A~~ | ~~**W&T / SL / RE / TP values required when toggled on**~~ | ✅ Fixed — `validate()` blocks save if any active feature has empty values. Commit `0444347` |
| ~~BL-B~~ | ~~**TSL: SL must have a value**~~ | ✅ Fixed — TSL chip blocked unless SL on AND value non-empty; save also validates. Commit `0444347` |
| ~~BL-C~~ | ~~**TTP: TP must have a value**~~ | ✅ Fixed — same as BL-B for TTP/TP. Commit `0444347` |

### Living Spec
| # | Item |
|---|------|
| LS-A | Update §20 Flow 2 (Algo Creation) with Straddle % definition and new time input rules |
| LS-B | Update §31 as items are checked off |

---

## 23. Open UI / UX Issues

### UI-1 — Margin Update, Global SL/TP hidden in Accounts page
**Reported:** Phase 1E | **Status:** ⬜ Open
**Problem:** The margin update, global SL, and global TP fields are no longer visible in the Accounts page.
**Fix:** Restore FY margin input, global SL (₹), and global TP (₹) fields in Accounts page and ensure they save via `POST /api/v1/accounts/{id}/margin`.

### UI-2 — Kill Switch button height mismatch on Dashboard
**Reported:** Phase 1E | **Status:** ⬜ Open
**Problem:** Kill Switch button is taller than Start Session / Stop All buttons. Cancel button in modal also has height mismatch.
**Fix:** Ensure Kill Switch uses identical height (`height: "34px"`) and padding as `btn btn-primary`. Cancel button in modal should match `btn btn-ghost` height.

---

## 24. Account-Level Kill Switch

**Spec status:** ✅ Complete — Phase 1E

### Requirement
The Kill Switch confirmation modal should list all active accounts with individual checkboxes, so Karthikeyan can selectively kill specific accounts while leaving others running.

### Kill Switch Modal — Enhanced Flow
```
1. Click ⚡ Kill Switch
2. Modal shows active accounts list with checkboxes (all checked by default)
3. Karthikeyan unchecks accounts to exclude
4. Clicks "Activate Kill Switch"
5. Engine kills only selected accounts' positions + orders
6. Result banner shows per-account breakdown
```

### Account Card Indication (Dashboard)
After kill switch activated for an account → show ⚡ red "Kill Switch Active" badge on that account's card in Account Status section. Persists until next session start.

### API Change
`POST /api/v1/system/kill-switch` — add optional `account_ids: list[str]` body.
- Empty → kill all (current behaviour)
- Provided → kill only those accounts

---

## 25. Account-Level Manual Deactivation

**Spec status:** ⬜ Phase 1F

### Requirement
Allow Karthikeyan to disable trading for a specific account for the day without invalidating the broker token. This is a planned "sit out today" action — distinct from the emergency Kill Switch.

### Behaviour
- Each account card in Dashboard gets a **"Deactivate for today"** button.
- Deactivated: no new algo entries for that account for the rest of the day. Existing positions unaffected.
- AlgoRunner skips deactivated accounts before placing any order.
- Resets automatically at midnight / market open (09:00 IST via Scheduler).
- Visual: account card shows grey "Inactive today" badge; Login button replaced with "Reactivate" button.

### DB Change
Add `is_deactivated_today: bool` (default False) + `deactivated_at: DateTime` to Account model.
Scheduler resets both fields daily at 09:00 IST.

### API
- `POST /api/v1/accounts/{id}/deactivate` — set deactivated for today
- `POST /api/v1/accounts/{id}/reactivate` — re-enable for today

---

## 26. Session Summary — Phase 1E (complete ✅)

### Commits
| Hash | Description |
|------|-------------|
| `531a727` | Phase 1E PostgreSQL wiring (21 files) |
| `01a649d` | AlgoConfig Save vs Update button |
| `717608b` | orders.py wired to real DB |
| `79ae80f` | SE-1: Global Kill Switch engine + Dashboard UI |
| `eb39320` | SE-2: Order Retry Queue + Living Spec v2.6 |
| `9756c04` | SE-3: Broker Reconnect Manager |
| `b251a66` | UI-2: Kill Switch button height fixes |
| `9a1cb01` | Angel One broker adapter (complete SmartAPI) |
| `8cb54a1` | SE-1 enhancement: Account-Level Kill Switch |
| `1c3ad59` | Fix: Kill Switch backend bugs + scheduler import |
| `5f55eff` | Fix: Kill Switch modal state bugs (partial re-kill) |
| `0bb5baa` | Phase 1E: UI polish — time input, leg select arrows, active colour dimming |
| `02649be` | Phase 1E §31: UI-A white inputs, UI-B/C straddle % dropdown |
| `0444347` | Phase 1E §31: BL-A/B/C validation — feature value guards + TSL/TTP value requirements |
| `b2bc7a9` | Phase 1E §31: UI-D leg select arrows + feature value row styling |
| `3914e64` | Phase 1E §31: Child leg style parity + Lots placeholder + blank lots validation |
| `86ee5b8` | Phase 1E: Lots input defaults to empty — shows dimmed placeholder, blocks save if blank |

### Phase 1E — All complete ✅
- ✅ SE-1 GlobalKillSwitch — engine + API + Dashboard UI + account-level modal
- ✅ SE-2 OrderRetryQueue — engine + RE endpoint + DB columns
- ✅ SE-3 BrokerReconnectManager — engine + scheduler 3s job
- ✅ Angel One adapter — full SmartAPI implementation
- ✅ §24 Account-Level Kill Switch — selective kill, KILLED badge, partial re-kill
- ✅ TTP engine — trailing take profit per leg
- ✅ Journey engine — multi-level child leg firing (3 levels)
- ✅ §31 UI polish — all UI-A/B/C/D + BL-A/B/C items complete
- ✅ Lots input — blank default, dimmed placeholder, save blocked if empty

---

## 27. Session Summary — Phase 1F (13 March 2026)

### Commits
| Hash | Description |
|------|-------------|
| `33c4272` | Phase 1F: AR-1 ExecutionManager, AR-2 PositionRebuilder, SE-4 OrderReconciler |
| `1a9a6de` | Phase 1F: Fix save flow — leg payload fields, validation messages, scheduler + OrderStatus fix |
| `5ba60f2` | Phase 1F: Smart Grid fixes — account nickname, leg chips, deploy upsert, Archive btn |

### Completed this session ✅
- ✅ **AR-1 ExecutionManager** — central order control layer, risk gate (kill switch + market hours), `place()` + `square_off()`, singleton wired in `main.py`
- ✅ **AR-2 PositionRebuilder** — startup recovery: re-registers SLTPMonitor/TSL/TTP/MTM, re-subscribes LTP tokens
- ✅ **SE-4 OrderReconciler** — every 15s: reconciles DB vs broker, corrects OPEN+CANCELLED→ERROR and PENDING+FILLED→OPEN, broadcasts via WebSocket
- ✅ **AlgoScheduler.add_reconciler_job()** — added to scheduler.py, registers 15s interval job
- ✅ **OrderStatus capitalisation fix** — `OrderStatus.OPEN` / `OrderStatus.PENDING` in position_rebuilder + order_reconciler
- ✅ **Algo save fixed** — `buildPayload()` now sends `instrument` (ce/pe/fu) and correct `underlying` (full INST_CODES name)
- ✅ **Validation messages** — comprehensive ❌ error messages for every missing field (algo-level + per-leg)
- ✅ **Smart Grid — account nickname** — algos API joins Account table, returns `account_nickname`
- ✅ **Smart Grid — leg chips** — list endpoint now includes legs; reverse-maps NIFTY→NF for chip display
- ✅ **Smart Grid — deploy upsert** — re-deploying an algo on same day updates multiplier instead of 400 error
- ✅ **Smart Grid — Archive button** — ghost style, larger icon, correct order: Show Weekends | Archive | + New Algo, aligned heights
- ✅ **Smart Grid — no stale flash** — initialised to `[]` instead of `DEMO_ALGOS`
- ✅ **Smart Grid — multiplier click area** — widened to full cell block

### Also completed 14 March 2026 ✅
| Commit | Description |
|--------|-------------|
| `ab84f21` | GR-1/2/3 fixes + sidebar collapse + STAAX logo + active/archive guards |

- ✅ **GR-1** — Grid entries persist on refresh: `DEMO_GRID` init replaced with `{}`, always rebuild from API, removed stale-data guard
- ✅ **GR-2** — Multiplier click area widened: full block display with padding
- ✅ **GR-3** — Date headers now `DD-MM` format (Indian convention)
- ✅ **Active cell remove guard** — cells with status `algo_active`, `open`, or `order_pending` cannot be removed from grid (before 09:15 removal is allowed; from 09:15 onwards once status transitions to active it is blocked)
- ✅ **Archive guard (correct rule)** — algo cannot be archived if ANY grid cell across the week has status `algo_active`, `open`, or `order_pending`. Rule: if Thursday has an open STBT position but Friday is inactive, archive is still blocked because Thursday is active. Archive is only allowed when ALL cells are in `no_trade`, `algo_closed`, or `error` state.
- ✅ **Sidebar collapse/expand** — smooth 0.18s transition, icon-only (56px) when collapsed, full (216px) when expanded
- ✅ **STAAX logo** — hexagonal SVG logo in sidebar; logo-only when collapsed, logo + name when expanded
- ✅ **Version footer** — updated to `v0.1.0 · Phase 1F`

### Also completed 14 March 2026 (afternoon) ✅
| Commit | Description |
|--------|-------------|
| `cb7fec2` | Zerodha token flow — callback page, route, Dashboard polling, Vite host |
| `34aa1fe` | Persist Zerodha token + Kill Switch state across refresh |
| `cacb2fc` | Full persistence — system_state DB, kill switch + Zerodha token survive restart |
| `4eda91f` | Full persistence audit + Dashboard button order + duplicate KS removed |

- ✅ **WS-1** — Kill Switch WebSocket broadcast wired (`ws_manager` from `app.state`)
- ✅ **SQ-1** — Square-off wires real broker call via ExecutionManager + triggers post-event reconciliation
- ✅ **Zerodha token flow** — full OAuth loop: Login → popup → Zerodha auth → `/zerodha/callback` backend → frontend `/zerodha-callback` → `postMessage` → Dashboard "Connected ✅"
- ✅ **Zerodha redirect URL** — set to `http://localhost:8000/api/v1/accounts/zerodha/callback` in Zerodha developer console
- ✅ **Persistence — system_state table** — migrations 0003 + 0004; stores `kill_switch_active`, `kill_switch_at`, `killed_account_ids`
- ✅ **Persistence — kill switch** — `global_kill_switch.py` writes to DB on activate; `kill-switch/status` reads from DB and restores in-memory state on restart
- ✅ **Persistence — Zerodha token** — Dashboard derives `zerodhaConnected` from `token_valid_today` on mount
- ✅ **Persistence — killed account IDs** — loaded from DB on mount, stored as comma-separated string
- ✅ **Persistence — Orders page** — init to `[]`, always replace from API (no DEMO_ORDERS on load)
- ✅ **Persistence — Accounts page** — init to `[]` instead of FALLBACK
- ✅ **Dashboard button order** — Kill Switch (left) | Stop All | Start Session (right)
- ✅ **Duplicate Kill Switch button removed**

### Persistence rule (applies to all future features)
> Any state that must survive a refresh must be stored in the DB and loaded on mount. React state is the display layer only — never the source of truth.

Checklist for every new stateful feature:
1. Store in DB (model + migration if new table/column)
2. Load on component mount via API call → set React state
3. Never initialise React state with DEMO/FALLBACK/MOCK data

### Services — Start Session wiring (pending)
Currently `Start Session` button calls `servicesAPI.startAll()` but the backend services (PostgreSQL, Redis, Market Feed) are not actually started by this call — it only reflects their status. Full wiring requires:
- PostgreSQL + Redis: system-level process management (out of scope for Phase 1F — these run as system services on the Mac/AWS)
- Market Feed: wire `startAll` to actually start `ltp_consumer` / WebSocket feed
- **Pragmatic approach:** On production (AWS), PostgreSQL + Redis run as daemons and are always up. `Start Session` should: (1) verify DB + Redis connectivity, (2) start Market Feed (LTP consumer), (3) trigger Zerodha token check
- Add to Phase 1G backlog

### QA Testing Milestone
**All prerequisites now met:**
1. ✅ Algo creation + Smart Grid deploy
2. ✅ ExecutionManager + PositionRebuilder + OrderReconciler wired
3. ✅ WS-1 — Kill Switch WebSocket broadcast
4. ✅ SQ-1 — Real broker square-off via ExecutionManager
5. ✅ Zerodha token flow (Dashboard login → token set → persists)

**Ready for dry-run QA** on next trading day (Mon–Fri, 09:15–15:30 IST) with Karthik's Zerodha account.

**QA test script:**
1. Dashboard → Start Session → verify Backend API running
2. Click Zerodha Login → complete auth in popup → verify "✅ Connected for today"
3. Create a simple NF DIRECT algo (1 lot, SL 50pts, entry 09:20, exit 15:10)
4. Deploy to today in Smart Grid (PRACTIX mode)
5. Verify algo activates at 09:15, status → ACTIVE
6. Verify entry fires at 09:20, status → PENDING → OPEN
7. Verify SL monitor triggers on 50pt adverse move
8. Verify P&L updates live in grid cell
9. Click SQ button → verify square-off, status → CLOSED
10. Verify Orders page shows correct state throughout
11. Refresh page → verify all state persists (grid cells, token, kill switch)

### Also completed 14 March 2026 (evening) ✅
| Commit | Description |
|--------|-------------|
| `ec4cf00` | AR-3 ExecutionManager audit log + AR-4 smart retry filtering |
| `89e7dae` | Sidebar: click logo to expand, persist collapse state to localStorage |
| `f6a1073` | Sidebar: smooth fade transition on text during collapse/expand |
| `d618bd9` | Sidebar: centre-align icons to full width when collapsed |
| `cacb2fc` through `4eda91f` | Full persistence — system_state DB, kill switch, button order |
| `2ec6660` | SVC-1 + AR-5 — real Start Session wiring + post-event reconciliation |
| `various` | Sidebar: icon alignment fix, logo click to toggle, arrow removed |

- ✅ **AR-3** — ExecutionManager structured audit log: `_audit()` helper, events REQUEST/RISK_PASS/RISK_BLOCK/ROUTED/BROKER_OK/BROKER_FAIL/SQ_REQUEST/SQ_OK/SQ_FAIL
- ✅ **AR-4** — OrderRetryQueue smart retry: `is_retryable()` classifier, breaks immediately on margin/param/instrument errors
- ✅ **AR-5** — Post-event reconciliation: Kill Switch + SQ both trigger `order_reconciler.run()` immediately
- ✅ **SVC-1** — Start Session real wiring: DB health check (SELECT 1), Redis ping, Market Feed starts if Zerodha token available
- ✅ **Sidebar** — collapse/expand persists to localStorage, logo row click to toggle, smooth fade on text/labels, icons centred, arrow removed
- ✅ **Sidebar** — STAAX hexagonal SVG logo, icon-only collapsed view (56px), full view (216px)
- ✅ **Persistence audit** — Orders/Accounts init to `[]`, kill switch + killed_account_ids loaded from DB on mount, Zerodha from `token_valid_today`
- ✅ **Dashboard button order** — Kill Switch | Stop All | Start Session (left to right)
- ✅ **system_state table** — migrations 0003+0004, persists kill_switch_active + killed_account_ids across restarts

### Remaining Phase 1F backlog
| # | Item | Priority |
|---|------|----------|
| F1  | Broker auto-login automation | Medium |
| F7  | Reports download — Excel + CSV | Medium |
| NR-3 | Ticker bar — live instrument prices in sidebar | Low |
| SYNC | Manual order sync | Low |
| EXIT | Manual exit price correction | Low |
| NOTIF | NotificationService — Twilio WhatsApp + AWS SES | Low |
| §25 | Account-Level Manual Deactivation | Low |

**📋 UI debt (minor, non-blocking):**
| # | Item |
|---|------|
| UI-1 | Accounts page — margin update, global SL/TP fields hidden |
| UI-2 | Vite CSS warning — `@import` must precede `@tailwind` in global CSS |
| UI-3 | GridPage duplicate `style` attribute warning (Vite) |
| UI-4 | ReportsPage duplicate `marginBottom` warning (Vite) |

### 🧪 QA Testing — READY
All prerequisites met. Next trading day (Mon–Fri 09:15–15:30 IST) run the full QA test script from §27.

---

## 28. Architecture Review — Recommendations (v3.0)

These recommendations were reviewed and accepted on 14 March 2026. Items marked ⬜ are in the Phase 1F backlog above.

### AR-1 — ExecutionManager Audit Log ⬜
Every order decision should be logged chronologically for debugging and post-trade analysis.

**Log flow:**
```
[EXEC] Order request received — algo_id, leg_no, direction, qty
[EXEC] Risk checks passed — kill switch OFF, market hours OK
[EXEC] Routed to OrderRetryQueue
[EXEC] Broker response received — order_id, status
[EXEC] Order status updated in DB
```
Implementation: add `_log(msg)` helper to `ExecutionManager` that writes to a rotating file log + broadcasts to WebSocket system log panel.

### AR-2 — Kill Switch Enforced Through ExecutionManager ✅
All order placement and square-off must go through `ExecutionManager`. No component interacts directly with `OrderRetryQueue` or `OrderPlacer`.

```
AlgoRunner → ExecutionManager → OrderRetryQueue → OrderPlacer
```

`ExecutionManager.place()` already enforces:
```python
if kill_switch_active:
    raise ExecutionBlocked("Kill switch active")
```
`square_off()` bypasses the kill switch (always allowed — emergency exits must go through).

### AR-3 — OrderRetryQueue Smart Retry Filtering ⬜
Retry only for temporary technical failures. Never retry for business-logic rejections.

| Retry ✅ | No Retry ❌ |
|----------|------------|
| Network timeout | Insufficient margin |
| Broker gateway timeout | Invalid order parameters |
| Temporary rate limit | Instrument not tradable |
| Temporary exchange unavailability | Market closed |

Implementation: inspect broker error code/message before enqueuing retry. Add `is_retryable(error)` classifier to `OrderRetryQueue`.

### AR-4 — Post-Event Reconciliation ⬜
Trigger `OrderReconciler.run()` immediately after:
- Kill switch activation
- Manual square-off (SQ button)
- Terminate (T button)
- Manual order sync

This detects broker-platform mismatches immediately without waiting for the 15s cycle.

### AR-5 — Execution Safety Monitoring ⬜ (logging)
Standard log prefixes for all engine components:
```
[EXEC]  ExecutionManager decisions
[RETRY] OrderRetryQueue attempts
[RECON] OrderReconciler corrections
[FEED]  WebSocket/LTP reconnect events
[BUILD] PositionRebuilder startup recovery
```

### AR-6 — Tick Processing Safety ✅ (design principle)
Tick pipeline must remain lightweight:
```
WebSocket Tick → ORB Tracker → W&T Evaluator → TSL Engine → SLTP Monitor
```
Rules (already followed in current implementation):
- No DB writes inside tick handlers — only price comparisons
- Trigger actions (SL hit, TSL update) are offloaded via `asyncio.ensure_future()`
- Heavy logic (position rebuilding, reconciliation) runs in scheduler jobs, not tick path

---

## 29. Claude Code Setup & Continuity Guide

### Purpose
Claude Code replaces the copy-paste workflow. It runs directly on your Mac inside `~/STAXX/staax`, reads/writes files, runs commands, restarts servers — you approve each action with `y/n`.

### Installation (one-time)

```bash
# Step 1: Verify Node 18+
node --version   # must be v18 or higher

# Step 2: Install Claude Code globally
npm install -g @anthropic-ai/claude-code

# Step 3: Verify install
claude --version
```

### Security — restrict to STAXX only

```bash
# Step 4: Create safe launcher script
cat > ~/launch-staax-claude.sh << 'EOF'
#!/bin/bash
cd ~/STAXX/staax
claude --add-dir ~/STAXX/staax
EOF
chmod +x ~/launch-staax-claude.sh

# Step 5: Create Claude Code project config
mkdir -p ~/STAXX/staax/.claude
cat > ~/STAXX/staax/.claude/settings.json << 'EOF'
{
  "allowedPaths": ["~/STAXX/staax"],
  "projectName": "STAAX"
}
EOF
```

**Rule:** Always launch via `~/launch-staax-claude.sh` — never `claude` from any other directory.

### First-session prompt (copy-paste this to Claude Code on first launch)

```
You are continuing development of STAAX — a personal F&O algo trading platform.

Read the full project context from: backend/STAAX_LIVING_SPEC.md
(or paste contents directly)

Key facts:
- Stack: FastAPI + PostgreSQL + Redis + React/Vite
- DB: postgresql+asyncpg://staax:staax_password@localhost:5432/staax_db
- Frontend: http://localhost:3000 | Backend: http://localhost:8000
- Login: karthikeyan / staax2024 | Auth: POST /api/v1/login (form data)
- GitHub: github.com/theboringtrader14/staax (always commit + push after each feature)
- Accounts: Karthik (Zerodha), Mom (Angel One), Wife (Angel One)

Current status: Phase 1F — see §27 in the spec for completed items and remaining backlog.
Next item to build: [F1 — Broker auto-login] or [F7 — Reports download] or whichever item I specify.
QA Testing is READY — run on next trading day (Mon–Fri 09:15–15:30 IST).

Rules:
- Always read the spec before starting any feature
- Commit after every completed feature with a clear message
- Ask me before any destructive DB operation
- Never touch files outside ~/STAXX/staax
```

### Continuity between sessions

The **Living Spec** (`STAAX_LIVING_SPEC.md`) is the memory. It lives at:
- Local: `~/STAXX/staax/backend/STAAX_LIVING_SPEC.md` (copy it there — see below)
- Backup: Claude.ai outputs folder

At the start of every Claude Code session, paste this one-liner:
```
Read STAAX_LIVING_SPEC.md and tell me the current status and next item.
```

### Copy spec to repo (run once)

```bash
cp /path/to/STAAX_LIVING_SPEC.md ~/STAXX/staax/STAAX_LIVING_SPEC.md
cd ~/STAXX/staax
git add STAAX_LIVING_SPEC.md
git commit -m "Add Living Spec to repo for Claude Code continuity"
git push origin main
```

### Approval flow in Claude Code

Every action Claude Code wants to take shows a prompt:
```
> Edit file backend/app/engine/order_retry_queue.py  [y/n]
> Run: python3 -m uvicorn app.main:app --reload      [y/n]
> Run: git commit -m "SE-2: Order Retry Queue"       [y/n]
```
You press `y` to approve, `n` to skip, or type a comment to redirect.

### What stays in this Claude.ai chat

Use this chat (or a new one with the extension) for:
- Visual browser testing and UI review
- Spec decisions and architecture questions  
- Debugging when Claude Code gets stuck
- Any feature requiring browser automation



### Post-QA Backlog
- **Dark mode readability:** `--text-muted` and `--text-dim` need further brightness tuning after QA testing on a live trading day. Active selections show accent blue correctly. Body text is fine. Only secondary/dim text needs polish.

## Session Notes — 16 March 2026

### Completed this session
- Daily reset at 08:00 IST now also resets all account statuses to disconnected
- Theme toggle fixed — shows ☀️/🌙 emoji clearly
- Logout button changed to proper text button
- Text readability improved (--text-muted, --text-dim brighter)
- Bot name clickable to edit (edit pencil button removed)
- Promote to LIVE working in Indicator Bots
- Indicator Bots: 4 cards per row (minmax 220px), TODAY stat box removed, stats grid 2-col (72px LOTS + LIVE P&L)
- CORS updated to allow ports 3001, 3002

### Pending (start of next session)
- Page header alignment: Orders, Reports, Accounts pages h1 is at y=75.5 vs Smart Grid/Dashboard at y=72
  - Root cause: these pages wrap content in `<div>` without `className="page-content"`
  - Fix: add `className="page-content"` to outer div of Orders, Reports, Accounts
  - CAUTION: Dashboard also needed this fix but adding it caused a scrollbar — investigate Layout.tsx first
  - Smart Grid is the reference page (y=72, uses page-content correctly)
- Indicator Bots page header alignment — needs investigation separately
- INVEX UI feel to be backported to STAAX (glassmorphism hero cards, refined typography)
- Dark mode readability polish (post-QA)

### Key file locations
- STAAX frontend: /Users/bjkarthi/STAXX/staax/frontend/src/
- STAAX backend: /Users/bjkarthi/STAXX/staax/backend/app/
- Layout.tsx: /Users/bjkarthi/STAXX/staax/frontend/src/components/layout/Layout.tsx
- index.css: /Users/bjkarthi/STAXX/staax/frontend/src/index.css
- page-content CSS: padding 20px 24px, defined in index.css
- Smart Grid (reference page): GridPage.tsx uses page-content correctly

### Design Principle
Always use proper SVG icons — never Unicode characters or emoji for functional UI elements.
Icons: 18px, stroke="currentColor", strokeWidth="1.8", strokeLinecap="round", strokeLinejoin="round"


## QA Bugs Found — 17 March 2026

### Bug 1: Edit algo resets all legs
- Steps: Open existing algo → click edit → all configured legs disappear, resets to single empty leg
- Root cause: AlgoPage.tsx uses `useState<Leg[]>([mkLeg(1)])` — on edit open, legs not loaded from existing algo data
- Fix: On edit open, populate legs state from existing algo.legs data
- Severity: High — cannot edit algos

### Bug 2: Algos dragged to grid after entry time show No Trade
- Steps: Create algo with entry_time 9:35 → drag to today's grid at 9:34 → algo shows Active briefly then No Trade
- Root cause: Runner evaluates entry_time on schedule — if dragged close to or after entry time, runner misses the window
- Fix: Add grace period (e.g. 2 min) — if current time is within grace_period of entry_time, still fire
- Severity: Medium — affects same-day late grid additions


### Bug 5 (CRITICAL): Algos added after 09:15 never fire
- Root cause: `_job_activate_all` in scheduler.py runs ONCE at 09:15 IST
- It creates AlgoState(status=WAITING) for all today's grid entries at that moment
- Any grid entry created after 09:15 never gets AlgoState created → runner never picks it up
- ALL test algos (Test 1-4) failed because they were all dragged to grid after 09:15
- Fix: In grid.py create_entry endpoint, if trading_date==today and current_time > 09:15 
  and entry_time > current_time → immediately call activate_single_algo()
- This is the #1 priority fix before next live QA session

### Bug 3 (revised): Entry time display in Smart Grid
- Entry time shows correctly when algo fires (Test 4 showed 09:55:00)
- BUT after going to NO TRADE it reverts to showing 09:16
- Likely the grid cell renders entry_time from AlgoState which defaults to 09:16
- Fix: render entry_time from algo.entry_time not from grid_entry/algo_state

### Summary of QA session — 17 March 2026
- Platform boots correctly, all services start
- Zerodha token login works after secret rotation
- Market feed connects
- Smart Grid drag-and-drop works
- PRACTIX mode correct
- Kill switch resets correctly
- CRITICAL: No algos fire if added after 09:15 IST (Bug 5)
- All other bugs secondary to Bug 5


### Bug 6: STBT/BTST/Positional exit time logic
- STBT: exit time should apply to NEXT trading day (not same day)
- BTST: exit on next day morning
- Positional: exit based on DTE (days to expiry) + exit time
- Currently all strategy modes show only exit time with no day logic
- Fix: AlgoPage wizard and runner need to handle multi-day exit scheduling

### Bug 7: Sidebar tickers showing null/dash
- Market Feed service running but all tickers (NIFTY/BN/SENSEX etc) show —
- Backend /api/v1/system/ticker returns all null values
- KiteTicker WebSocket likely not subscribing instruments after token refresh
- Fix: On Zerodha token refresh, re-subscribe ticker instruments in market feed service

### Note: INVEX Day P&L display
- Day P&L showing in INVEX hero card — this is actually correct data from Zerodha
- The value shown is (LTP - prev_close) * qty for each holding
- May appear large as it captures full day move not just today session
- Review calculation accuracy post-market


### Bug 15: Promote to LIVE — UI not refreshing after success
- PATCH /api/v1/bots/:id returns 200 OK but card still shows PRAC badge
- Root cause: onUpdate in IndicatorsPage updates bot in backend but does not re-fetch bot list
- Fix: After successful PATCH, refresh bots list from API

### Feature 16: Platform-wide soft notifications (CRITICAL UX)
- Every action should show a toast/snackbar notification
- Applies to STAAX, INVEX, and all future modules
- Examples: Promote to LIVE, Kill switch, Algo fired, Order filled, SL triggered, Token refresh, Errors
- Implementation: Global toast queue in Layout.tsx, bottom-right corner, auto-dismiss 3s, colour coded


### Bug 17: Entry/Exit time display reverts to 09:16 after page refresh
- After dragging algo to grid, E and X show correct times
- After page refresh, E reverts to 09:16
- Root cause: Grid cell reads entry_time from AlgoState not from Algo
- AlgoState doesn't store entry_time — it reads from algo.entry_time
- Fix: Grid cell display should always read from algo.entry_time, not algo_state

### Bug 18: Entry/Exit time format should be HH:MM (not HH:MM:SS) in grid display
- Grid currently shows 09:55:00 — should show 09:55
- Fix: truncate seconds in display

### Bug 19: TimeInput field only accepts 9 in HH section
- Cannot type 1 or other digits in the hours field of TimeInput
- Up/down arrow works but cannot directly type hours > 09
- Fix: TimeInput component needs to allow free text entry for HH

### Bug 20: Cannot delete Test Algo 1 (first algo created)
- Delete button on Test Algo 1 shows no response
- Need to investigate — possibly has grid_entries preventing deletion (FK constraint)
- Fix: Allow deletion with cascade or show proper error message

### Bug 21: Edit algo shows base settings (Bug 1 confirmed again)
- Editing existing algo shows default/empty leg configuration
- Does not load existing legs from DB
- Root cause confirmed: useState<Leg[]>([mkLeg(1)]) not populated on edit open
- Fix: On edit modal open, fetch algo.legs and setLegs(algo.legs)

### Bug 5 — PARTIAL FIX CONFIRMED
- After fix: Algo dragged to grid after 09:15 immediately shows ACTIVE with correct E/X times
- Remaining issue: After page refresh, E/X reverts to 09:16 (Bug 17)
- AlgoState WAITING is being created correctly — runner should now pick it up at entry time


### Feature 22: Algo status visual overhaul (Smart Grid + Orders)

**New status flow:**
```
WAITING → (entry time hit) → PENDING → (order filled) → ACTIVE/OPEN → (exit) → CLOSED
```

**Visual treatment per status:**
- WAITING: Dimmed card, amber pulsing dot, inline label "⏳ Waiting for 13:00"
- PENDING: Normal brightness, orange dot, "🔄 Order pending"  
- ACTIVE/OPEN: Full brightness, green dot, P&L showing
- CLOSED: Dimmed, grey, shows final P&L

**Orders page:**
- WAITING algos should appear in Orders page immediately after drag
- Show as dimmed row with "Waiting — 13:00:00" label
- Activates visually when order is placed

**Grid cell:**
- Map existing GridStatus values to new visual states
- ALGO_ACTIVE = WAITING (before entry), OPEN = ACTIVE (after fill)
- Pending = order sent but not yet confirmed fill

**Applies to:** Smart Grid, Orders page, Dashboard active algos count


### Feature 23: Input field validation — platform-wide
- All numeric input fields must only accept numbers (no letters or special chars)
- Time inputs (HH:MM): Allow full typing of all digits 0-9, not just 9
- Percentage fields: only 0-100 allowed
- Lot size: only positive integers
- Price fields: only positive numbers with up to 2 decimal places
- Applies to: AlgoPage, IndicatorsPage, AccountsPage, and all future modules in STAAX and INVEX
- TimeInput component specifically: Allow free typing of HH (00-23) and MM (00-59)


### Feature 24: System Log improvements
- System Log on Dashboard should persist across page refreshes (not reset)
- Each log entry should show timestamp in IST (HH:MM:SS format)
- Log should be stored in backend (last 100 entries) and fetched on page load
- Events to log: session start/stop, token login, kill switch, algo fired, service start/stop
- Log style: monospace font, colour coded by severity (info=dim, warn=amber, error=red)

### Bug 25: Market Feed instrument cache not loading
- After Zerodha token refresh, instruments() not called to populate cache
- Runner fails with "No CE instruments for NIFTY current_weekly"
- Fix: On market feed start, call kite.instruments("NFO") and cache results
- Also needed: Re-load instruments after every Zerodha token refresh


## QA Summary — 17 Mar 2026

### What works ✅
- Platform boots, all services start correctly
- Zerodha token login works (after secret rotation)
- Smart Grid drag and drop works
- PRACTIX mode correct
- Bug 5 FIXED: Algos dragged after 09:15 now get AlgoState=WAITING and scheduler job registered
- Runner fires at correct entry time (confirmed via DB and error log)

### What needs fixing before next live QA 🔴
1. Bug 25: Instrument cache not loaded — "No CE instruments for NIFTY"
   - Fix: Load instruments on Market Feed start AND after token refresh
2. Bug 7: Ticker sidebar null — KiteTicker not subscribing instruments  
3. Bug 17: Entry time display reverts to 09:16 after refresh
4. Bug 21: Edit algo resets all legs
5. Bug 19: TimeInput only accepts digit 9 for hours

### Next QA session prerequisites
- Instrument cache must load on startup
- Market Feed must auto-start with token
- Ticker subscription must work


### Bug 26: Service states reset on backend restart
- When backend hot-reloads (code change), all service states reset to STOPPED
- Services need to be manually restarted after every code change during development
- Fix: Persist service states in Redis or DB so they survive restarts
- Also: Add auto-restart for PostgreSQL and Redis on backend startup

### Bug 27: StrikeSelector fails when instrument cache empty
- Runner: "No CE instruments for NIFTY current_weekly"
- Root cause: Instrument cache (NFO chain) is only loaded when explicitly called
- Fix: Load instrument cache on Market Feed start AND on Zerodha token refresh
- The kite.instruments("NFO") call needs to populate a shared cache at startup


## Claude Code Handoff — 17 Mar 2026

### Current blocker (last thing to fix before trades execute)
**UUID not JSON serializable in ws_manager._send()**
- Error: `Object of type UUID is not JSON serializable`
- Occurs in: `algo_runner.py` → `_set_error()` → `ws_manager.notify_error()`
- The `notify_error` call has `str()` fix applied but error still occurs elsewhere
- Likely location: `broadcast_algo_status()` call at line 259 or 604 passes UUID objects
- Fix needed: Wrap ALL UUID values passed to ws_manager broadcast methods with `str()`
- File: `/Users/bjkarthi/STAXX/staax/backend/app/engine/algo_runner.py`
- Also check: `/Users/bjkarthi/STAXX/staax/backend/app/ws/routes.py` — `_send()` uses `json.dumps(message)`

### What IS working after today's QA
1. Bug 5 FIXED: Algos dragged after 09:15 get AlgoState=WAITING + scheduler job registered
2. NFO instrument cache loads: 49,784 instruments via `curl -X POST /api/v1/services/ws/reload-cache`
3. Scheduler fires at correct entry time (confirmed via DB error log)
4. Runner correctly finds the NIFTY CE/PE instruments (error changed from "No CE instruments" to UUID error)

### What needs fixing (priority order for Claude Code)

**P0 — Must fix before next QA (Thursday)**
1. UUID serialization in algo_runner.py broadcast calls
   - Check ALL calls to: broadcast_algo_status, broadcast_order_update, notify_error
   - Ensure all UUID fields are wrapped in str()
   
2. NFO cache auto-load on Market Feed start
   - Currently requires manual: `curl -X POST http://localhost:8000/api/v1/services/ws/reload-cache`
   - Add Dashboard button "Reload Instruments" OR auto-call after Market Feed start
   - The `start_all` in services.py already has the code, but `start_service` (individual) doesn't work
   - Proper fix: Add Request param to `start_service` endpoint OR call reload-cache from frontend

3. Entry time display showing 09:16 in grid (Bug 17)
   - Grid cell reads from AlgoState which doesn't store entry_time
   - Fix: GridPage.tsx should read entry_time from algo.entry_time not from grid cell

**P1 — Fix before next QA**
4. Edit algo loads empty legs (Bug 21)
   - AlgoPage.tsx: `useState<Leg[]>([mkLeg(1)])` not populated on edit
   - Fix: On edit open, call `setLegs(algo.legs.map(l => mkLeg from l))`

5. TimeInput only accepts 9 in HH field (Bug 19)
   - Fix TimeInput component to allow free typing 00-23

6. Promote to LIVE UI not refreshing (Bug 15)
   - PATCH returns 200 but card doesn't reload
   - Fix: After successful PATCH in IndicatorsPage, call fetchBots()

**P2 — Important but not blocking**
7. Delete first algo (Test Algo 1) fails (Bug 20)
   - Likely FK constraint — cascade delete or show error
   
8. Ticker sidebar null (Bug 7)
   - KiteTicker WebSocket not subscribing index instruments
   - Need to call ltp_consumer.subscribe(tokens) after ticker starts

9. Page header alignment — Orders/Reports/Accounts h1 at y=75.5 vs Grid/Dashboard y=72

### Key file paths
```
Backend:  /Users/bjkarthi/STAXX/staax/backend/app/
  engine/algo_runner.py     — main trading engine
  engine/scheduler.py       — job scheduler
  ws/routes.py              — WebSocket manager
  api/v1/grid.py            — grid deploy + immediate activation (Bug 5 fix here)
  api/v1/services.py        — service start/stop + NFO cache endpoint
  brokers/zerodha.py        — KiteConnect wrapper + _nfo_cache

Frontend: /Users/bjkarthi/STAXX/staax/frontend/src/
  pages/GridPage.tsx         — Smart Grid display
  pages/AlgoPage.tsx         — Algo create/edit (Bug 21, 19)
  pages/IndicatorsPage.tsx   — Indicator bots (Bug 15)
  pages/DashboardPage.tsx    — Dashboard + services
  components/layout/Sidebar.tsx — Ticker display (Bug 7)
```

### Running the platform
```bash
# Terminal 1 — STAAX backend
cd ~/STAXX/staax/backend && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Terminal 2 — STAAX frontend  
cd ~/STAXX/staax/frontend && npm run dev  # runs on port 3000

# Terminal 3 — INVEX backend
cd ~/STAXX/invex/backend && uvicorn app.main:app --reload --host 0.0.0.0 --port 8001

# Terminal 4 — INVEX frontend
cd ~/STAXX/invex/frontend && npm run dev  # runs on port 3001

# After starting, in Dashboard: Start PostgreSQL, Redis, Market Feed
# Then: curl -X POST http://localhost:8000/api/v1/services/ws/reload-cache
```

### DB credentials
```
postgresql+asyncpg://staax:staax_password@localhost:5432/staax_db
Redis: localhost:6379
```

### Git repos
- STAAX: github.com/theboringtrader14/staax
- INVEX: github.com/theboringtrader14/invex


## Claude Code fixes — 17 Mar 2026 (end of session)

Applied to algo_runner.py:
1. grid_entry_id=str(grid_entry_id) at lines 260 and 605 — UUID safe
2. notify_trade: renamed fill_price→price, removed lots= kwarg
3. notify_mtm_breach: renamed current_pnl→mtm, removed limit= kwarg

These 4 fixes unblock the full order execution path.
Next QA on Thursday — expect first clean trade execution.

### Thursday morning checklist
1. Start STAAX backend + frontend
2. Start INVEX backend + frontend
3. Login Zerodha in Dashboard
4. Start PostgreSQL, Redis, Market Feed
5. Run: curl -X POST http://localhost:8000/api/v1/services/ws/reload-cache
6. Verify tickers load (or use NFO cache directly — StrikeSelector will work)
7. Create test algo for 09:20, drag to Thursday grid
8. Watch for first clean PENDING → OPEN transition 🎯


## End of Day — 17 Mar 2026

### All 12 bugs cleared this session ✅
Backend (Claude Code + manual):
- UUID serialization in algo_runner.py
- NFO cache + index token subscription on Market Feed start
- Cascade delete algos (FK-safe order)

Frontend (Claude Code):
- Entry/exit time display in grid (Bug 17)
- Edit algo loads correct legs (Bug 21)
- TimeInput accepts full HH range 00-23 (Bug 19)
- Promote to LIVE refreshes card (Bug 15)
- Page header alignment all pages match (CSS)

### Platform status going into Thursday
- All known bugs fixed
- Thursday 09:15: First clean trade execution expected
- Use Thursday checklist in spec


## Additional fixes — end of 17 Mar 2026

### EOD cleanup (Claude Code)
- POST /api/v1/grid/eod-cleanup — manual endpoint to close stale ACTIVE/WAITING/ERROR intraday states
- Auto _job_eod_cleanup at 15:35 IST daily — safety net after market close
- recover_today_jobs() on startup — re-registers exit jobs for today's active algos after backend restart
- Files: api/v1/grid.py, engine/scheduler.py, main.py

### Total bugs fixed today: 12 + 1 EOD = 13 fixes


## Critical Platform Updates — 17 Mar 2026

### 1. Zerodha API Shutdown — Angel One as Primary Broker

**Situation:** Zerodha is building their own proprietary algo platform.
KiteConnect retail API will be discontinued — all retail algo users must migrate to Zerodha's platform.
**This means STAAX cannot use KiteConnect for order placement going forward.**

**Decision: Angel One SmartAPI becomes the primary broker for STAAX**

**Migration plan:**

| Phase | Scope | Priority |
|-------|-------|----------|
| Phase 1 | Add Angel One order placement in algo_runner | 🔴 Before next live session |
| Phase 2 | Angel One WebSocket for market data + tickers | 🔴 Before live trading |
| Phase 3 | Angel One instrument dump for strike selection | 🔴 Before live trading |
| Phase 4 | Zerodha removed as dependency | 🟡 After Phase 1-3 stable |

**What needs to change:**
- `backend/app/brokers/angelone.py` — add full order placement (currently only holdings)
- `backend/app/engine/algo_runner.py` — replace KiteConnect calls with Angel One
- `backend/app/engine/ltp_consumer.py` — replace KiteTicker with Angel One WebSocket
- `backend/app/engine/strike_selector.py` — replace kite.instruments() with Angel One instrument API
- `backend/app/api/v1/services.py` — replace market feed with Angel One feed

**Karthik's account:** Open Angel One account + create SmartAPI app
(Currently only Mom + Wife have Angel One accounts)

**Angel One SmartAPI key endpoints:**
- Login: POST /rest/auth/angelbroking/user/v1/loginByPassword (already working in INVEX)
- Place order: POST /rest/secure/angelbroking/order/v1/placeOrder
- Market data WebSocket: wss://smartapisocket.angelone.in/smart-stream
- Instrument master: GET /rest/secure/angelbroking/market/v1/getInstrumentData
- LTP: POST /rest/secure/angelbroking/market/v1/getMarketData

---

### 2. Order Rate Limiting — Max 8 Orders/Second

**SEBI requirement:** Max 10 orders/second per client
**Platform limit:** Max 8 orders/second (2 buffer below SEBI limit)

**Implementation:**
- Add rate limiter in `execution_router.py` or `algo_runner.py`
- Token bucket algorithm: 8 tokens/second, each order consumes 1 token
- If rate exceeded: queue order with small delay, log warning
- File: `backend/app/engine/algo_runner.py` — wrap `_place_leg()` with rate limiter
```python
# Token bucket rate limiter (pseudo-code)
MAX_ORDERS_PER_SEC = 8
# Use asyncio semaphore or token bucket
# Reject/queue if limit exceeded
```

---

### 3. Static IP Whitelisting

**SEBI requirement:** API access only via static IP whitelisting per broker
**Current status:** Not implemented

**What this means:**
- The machine running STAAX must have a static public IP
- That IP must be registered with Angel One SmartAPI dashboard
- Any request from unregistered IP will be rejected by broker API

**Action items:**
- Get static IP for the machine running STAAX (home router or VPS)
- Register static IP in Angel One SmartAPI app settings
- Document the IP in `.env` or config (for reference, not code use)
- Consider: if running on Mac at home, home router needs static IP from ISP
  OR deploy STAAX backend to a VPS (fixed IP)

**Note:** This is currently not blocking local development but MUST be done before any live trading.

---

### Updated Priority List for Next Development Session

**P0 — Must do before any live trading:**
1. Angel One order placement in algo_runner (replaces Zerodha)
2. Angel One WebSocket market feed (replaces KiteTicker)
3. Angel One instrument dump for strike selection
4. Order rate limiter — 8/sec max
5. Static IP setup + registration with Angel One

**P1 — Important:**
6. Karthik Angel One account setup
7. SEBI compliance: exchange order tagging
8. 2FA for API access
