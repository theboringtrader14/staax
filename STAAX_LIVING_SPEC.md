# STAAX — Living Engineering Spec
**Version:** 8.4 | **Last Updated:** 16 April 2026 — Batch 30: P0 data loss prevention — G2 per-leg DB session isolation (commit after each leg + refresh algo_state/grid_entry; error paths reload orders by ID from cache); G3 write-before-broker (Order(PENDING) flushed before broker call → PENDING→OPEN on confirm, PENDING→ERROR on broker failure); G4 order_audit_log table + order_audit.py module (fire-and-forget audit writes per transition); RETRY ORB-awareness (isOrbWindowPast computed from orb_end_time IST, RETRY button greyed with "ORB ✕" label, W&T info line in row 2); waiting card 2-row layout (row 1: name+chips+time; row 2: full error/missed detail); GridPage no_trade pill → dim grey; /waiting endpoint adds entry_type + orb_end_time; §32 RETRY rules table added | **PRD Reference:** v1.2

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

**Theme:** Dark. Background `#0A0A0B` (--bg-void pure black). Primary accent `#FF6B00` (--ox-radiant orange). Amber `#D77B12`. Fonts: ADLaM Display (headings) + Dubai (body). Note: NO cyan/blue anywhere — #00B0F0 and #38bdf8 are replaced with orange throughout.

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
- **E:** entry time (orange #FF6B00)
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
- AI reasoning: Gemma 4 (gemma-4-31b-it) via Google AI — NOT Claude API. ElevenLabs TTS for voice output.
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

### UI-3 — Journey child leg config not saving
**Reported:** 15 Apr 2026 | **Status:** ⬜ Open
**Problem:** When editing a Journey algo, the child leg configuration (journey_config JSON) is not persisted on AlgoLeg update. Changes to child leg appear to save but revert on next load.
**Fix:** Ensure `journey_config` JSON field is included in AlgoLeg PATCH/PUT payload and correctly written to DB on update.

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

## 25a. Journey Trigger Selector

**Spec status:** ⬜ Phase 1F backlog — migration 0034

### Requirement
When a parent leg has **both SL and TP enabled**, show a **"Journey Trigger"** dropdown below the journey toggle in AlgoPage. This lets Karthikeyan choose which exit event fires the child (journey) leg.

### UI
- Dropdown: **SL Hit | TP Hit | Either**
- Visible only when: leg has journey child configured AND both SL and TP are enabled on parent
- Default: **Either**
- Label: "Journey Trigger"

### Data Model
New field on `AlgoLeg`:
```
journey_trigger: String, nullable, default "either"
# Values: "sl_hit" | "tp_hit" | "either"
```

### Engine Logic
In `bot_runner.py` / algo runner — when parent leg exits:
- `"sl_hit"` → fire child only if exit reason = SL
- `"tp_hit"` → fire child only if exit reason = TP
- `"either"` → fire child on any exit (current behaviour)

### Migration
**0034_journey_trigger** — `down_revision = 0033`
```sql
ALTER TABLE algo_legs ADD COLUMN journey_trigger VARCHAR DEFAULT 'either';
```

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
| 0034 | Journey trigger selector (`journey_trigger` field on AlgoLeg) | Low |

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


## Angel One Migration Complete — 17 Mar 2026 (Claude Code)

### 7 files changed — full broker-agnostic architecture

| File | Change |
|------|--------|
| brokers/angelone.py | Added get_underlying_ltp() with Angel One index tokens |
| engine/strike_selector.py | Now broker-agnostic — accepts any BaseBroker, normalizes both chain formats |
| engine/order_placer.py | Routes orders to Angel One or Zerodha based on broker_type param |
| engine/ltp_consumer.py | Added set_ticker(), AngelOneTickerAdapter, dual-feed support |
| engine/algo_runner.py | TokenBucketRateLimiter (8/sec), broker routing per account, stores broker_order_id |
| api/v1/services.py | Starts Angel One market feed alongside Zerodha |
| main.py | Wires angel_broker into OrderPlacer and AlgoRunner |

### Thursday QA — test with Karthik AO account
- Create test algo → assign to "Karthik AO" account
- This will route orders via Angel One SmartAPI
- Zerodha remains as fallback for "Karthik" account

### Remaining before full Zerodha cutover
- Account.feed_token column migration (needed for Angel One WebSocket auth)
- Test Angel One order placement end-to-end
- Test Angel One market data feed (tickers)
- Once confirmed working: rename "Karthik AO" → "Karthik", archive Zerodha account


## Claude Code Batch 2 — Next Session

### Trading account rules
- Karthik AO (PEAN1003): testing only — no live trades yet
- Mom (KRAH1029): live trading ✅
- Wife (KRAH1008): live trading ✅
- Karthik Zerodha (ZN6179): fallback only — Zerodha API shutting down end of March

### P0 — Before Thursday QA
1. Account.feed_token column + migration (Angel One WebSocket needs feedToken)
2. Angel One auto-login endpoint + AccountsPage button for Mom/Wife/Karthik AO
3. Account dropdown in AlgoPage shows all 4 accounts correctly

### P1 — Before live trading
4. Dashboard account status shows real token validity not just DB status
5. FY Margin save fix (currently shows Failed)
6. Single Save button for account settings (Margin + SL/TP + Brokerage)

### P2 — Nice to have
7. Nickname edit on Accounts page
8. Add new account flow



## AI-Assisted Engineering System — STAAX Ecosystem

### Philosophy
Personal platform — one person, family accounts. Keep it simple, cost-efficient, human-controlled.

- Manual trigger only — no continuous AI loops
- Human approval before any execution
- Claude (chat + Claude Code) is the AI system — no custom agent framework needed
- Critical trading logic always uses Claude, never cheaper models

---

### v1 — Manual AI Assist (CURRENT — active)
**Trigger:** You ask  
**Tools:** This chat (planning, review, visual QA) + Claude Code (implementation)  
**Workflow:**
```
Issue / feature needed
→ Discuss + plan in this chat
→ Claude Code implements (batched tasks)
→ Review here + visual check in browser
→ Commit if approved
→ Update Living Spec
```
No agent files. No custom framework. Works today.

---

### v2 — Structured Debugging (after INVEX complete)
**Trigger:** Manual  
**Add:**
- Backend writes structured errors to log file
- `/api/v1/debug/snapshot` endpoint — dumps current system state (algo states, open orders, service status)
- Claude reads snapshot or log paste → diagnoses issue → proposes fix
- Still manual — you share the snapshot or error

---

### v3 — Log Intelligence + Observability (after BUDGEX complete)
**Trigger:** Manual — run when needed  
**Add two lightweight Python utility scripts (not autonomous agents):**

`backend/app/agents/log_analyzer.py`
- Reads structured JSON logs from `~/STAXX/logs/`
- Detects: order execution failures, retry spikes, broker/API error patterns
- Output: plain text summary of anomalies with timestamps

`backend/app/agents/health_reporter.py`
- Daily health snapshot: orders placed, errors, MTM, reconciliation status
- Detects: reconciliation mismatches, stale positions, missed exits
- Output: summary report (print to terminal or write to file)

**Trading observability coverage:**
- Order failures (placement, partial fills, rejections)
- Retry queue behaviour (spikes, loops, cancel rate)
- Broker/API error patterns (Angel One throttling, auth failures)
- Reconciliation mismatches (orders in DB vs broker book)
- Missed exits (positions open after 15:30)

**Structured log format (backend writes this):**
```json
{
  "ts": "2026-03-17T09:20:01+05:30",
  "level": "ERROR",
  "module": "algo_runner",
  "event": "order_failed",
  "algo": "Test New 8",
  "account": "Mom",
  "reason": "Insufficient margin",
  "broker_code": "AMO_REJECTED"
}
```

---

### v4 — Approval-gated Automation (after FINEX complete)
**Trigger:** Manual  
- Claude Code proposes and stages changes automatically based on log analysis
- You review diff → approve → deploy
- Never auto-deploys
- User approval required at every step

---

### v5 — Not applicable for personal platform
Autonomous self-healing is not appropriate for a live trading system with real money.

---

### AI Model Rules
- **Claude (chat + Claude Code):** all trading logic, architecture, execution engine, risk
- **Cheaper models (optional):** UI copy, documentation only — never trading logic
- **Rule:** Any code touching orders, risk, or financial data = Claude only

### Cost Control
1. Claude Code only during active work sessions
2. Batch tasks — not individual API calls per bug
3. No background agents or continuous loops
4. Log-based observability — not real-time AI monitoring

### Future agent directory (v3 onwards)
```
backend/app/agents/
  log_analyzer.py      — anomaly detection from structured logs
  health_reporter.py   — daily trading health summary
```
Simple Python scripts. Manual trigger. No autonomous execution.


## Claude Code Batch 2 — Execution Summary

### Pre-existing bugs found during analysis
1. accounts.py angelone_login: missing password arg + wrong key "jwtToken" vs "jwt_token" + feed_token never saved
2. api.ts updateMargin: sends {margin: val} but backend expects {financial_year, margin_amount} — root cause of Bug 12

### 9 files changed (11 changes total)

| Priority | File | Change |
|----------|------|--------|
| P0 | models/account.py | Add feed_token column |
| P0 | alembic/versions/0009_add_feed_token.py | New migration |
| P0 | brokers/angelone.py | Add "karthik" account branch |
| P0 | main.py | Add angelone_karthik to app.state |
| P0 | api/v1/accounts.py | Fix login bugs + add /auto-login endpoint |
| P0 | api/v1/services.py | Read feed_token from DB column |
| P0 | services/api.ts | Add angeloneAutoLogin function |
| P0 | pages/AccountsPage.tsx | Fix slug mapping + wire Auto-Login + single Save + margin fix |
| P0 | pages/AlgoPage.tsx | Clear hardcoded account fallback |
| P1 | pages/DashboardPage.tsx | Bug 8: use token_valid_today |
| P1 | pages/AccountsPage.tsx | Bug 12: correct margin payload, Feature 13: single Save |


## Health Module — WHOOP Integration
**Status:** Planned | **Module:** STAAX (later migrates to FINEX)
**Trigger:** After core STAAX trading engine is stable and tested

### Objective
Integrate WHOOP health data to provide decision support for trading.
Health data never blocks trading — it informs, not controls.
Manual override always available.

### DB Schema
```sql
CREATE TABLE health_daily_metrics (
    id UUID PRIMARY KEY,
    account_id UUID NOT NULL,
    date DATE NOT NULL,
    recovery_score INT,        -- 0-100, WHOOP recovery
    strain_score FLOAT,        -- 0-21, WHOOP strain
    sleep_score INT,           -- 0-100, WHOOP sleep
    sleep_hours FLOAT,
    sleep_efficiency FLOAT,    -- %
    resting_hr INT,
    hrv FLOAT,
    calories_burned INT,
    source VARCHAR(20) DEFAULT 'whoop',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(account_id, date)
);

CREATE TABLE health_insights (
    id UUID PRIMARY KEY,
    account_id UUID,
    date DATE,
    insight_type VARCHAR(50),  -- recovery/sleep/hrv/strain
    message TEXT,
    severity VARCHAR(10),      -- low/medium/high
    suggested_action TEXT,     -- e.g. "reduce lot size 50%"
    applied BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Backend Structure
```
backend/app/health/
    whoop_loader.py     — OAuth2 token management + WHOOP API calls + upsert to DB
    health_engine.py    — rules engine, generates insights
    routes.py           — API endpoints
```

### WHOOP OAuth2
- WHOOP uses OAuth2 — need to store whoop_access_token + whoop_refresh_token per user
- Add whoop_access_token, whoop_refresh_token columns to accounts table (or separate whoop_credentials table)
- Token refresh: WHOOP tokens expire — auto-refresh before fetching data

### Health Engine Rules
Default thresholds (personalise over time):
- recovery_score < 33 → HIGH RISK — suggest: "Consider skipping high-risk trades today"
- recovery_score 33-66 → MEDIUM — suggest: "Reduce position size by 25%"
- recovery_score > 66 → GOOD — normal trading
- sleep_hours < 6 → "Reduced focus likely — avoid complex multi-leg strategies"
- hrv < personal_baseline × 0.8 → "HRV below baseline — reduce exposure"
- strain_score > 18 → "High physical strain — monitor emotional discipline"

Personal baseline: computed from 30-day rolling average of hrv

### API Endpoints
```
GET  /api/v1/health/daily?date=YYYY-MM-DD     — today's metrics
POST /api/v1/health/whoop/fetch               — trigger WHOOP data fetch
POST /api/v1/health/run-daily-analysis        — generate insights for today
GET  /api/v1/health/insights?date=YYYY-MM-DD  — today's insights
```

### Scheduler (runs before market open)
- 08:00 IST: whoop_loader — fetch yesterday's final + today's current data
- 08:05 IST: health_engine — run analysis, generate insights
- Insights available on Dashboard before 09:15 trading start

### Dashboard Integration
- Show recovery score + sleep hours in Dashboard header or widget
- Color coded: green (>66), amber (33-66), red (<33)
- Click to see full insights
- "Override" button — dismiss all health warnings for the day

### Future: STAAX Risk Engine Integration
- health_insights feeds into algo_runner
- Low recovery → auto-reduce lot_multiplier for algos (e.g. 50% reduction)
- User sets preferences: "At recovery < 33, reduce all lots by 50%"
- Still requires user to set the preference — not fully autonomous

### Constraints
- Never block trading due to health data — trading is fully automated and systematic
- Health data is observational only — never influences order placement or lot sizing
- Missing WHOOP data = normal trading (fail open, not fail closed)
- No risk engine integration — STAAX is rules-based, not biased by daily state
- Health module is for personal awareness and journaling, not trading decisions

### What it IS for
- Personal health tracking alongside trading performance
- Correlation analysis: "How did I trade on high vs low recovery days?" (retrospective)
- Journaling: understand patterns over time without acting on them in real-time
- Future FINEX integration: health as one lens in overall financial wellness view

### What it is NOT for
- Reducing lot sizes based on recovery score
- Blocking or modifying algos based on health state
- Any real-time intervention in the trading engine

### Build Phase (deferred — start after BUDGEX)
- Phase 1: whoop_loader + health_daily_metrics table + Dashboard widget (view only)
- Phase 2: health_engine + retrospective insights (weekly/monthly patterns)
- Phase 3: Migrate to FINEX as shared wellness module
- No Phase for risk engine integration — by design


## Claude Code Batch 4+5 — 19 Mar 2026 (Thursday QA)

### Batch 4 completed
- Angel One direct POST login (bypasses SDK bug)
- Market Feed auto-recover on startup
- Orders page WAITING algos rows
- Dashboard Active Algos count
- get_ticker alias fix
- WAITING→NO_TRADE transition after missed entry

### Batch 5 in progress
- get_index_tokens() added to ZerodhaBroker
- Angel One login debug logging + status check fix
- Wife Auto-Login button (was hidden by !isWife guard)
- recover_today_jobs: immediate NO_TRADE for past-entry WAITING algos
- /orders/waiting query fix (join AlgoState not GridEntry status)
- Numeric-only inputs in AlgoPage.tsx

### QA findings today
- Karthik AO auto-login: working ✅
- Mom auto-login: still failing (Angel One API rejecting clientcode)
- Wife auto-login: no button (Batch 5 fix)
- Market Feed: auto-recover needed (Batch 5 fix)
- AO-NF1/NF2: stuck ACTIVE after missed entry (Batch 5 fix)
- AO-NF3 (10:15): first clean test pending


## QA Status — 19 Mar 2026 (Thursday)

### What is CONFIRMED WORKING ✅
- Scheduler fires at exact entry time (confirmed at 10:15:09)
- Bug 5 fixed: algos dragged after 09:15 get activated immediately
- Bug B fixed: WAITING algos past entry time → NO TRADE on restart
- AO-NF3 entry triggered correctly at 10:15
- Karthik AO auto-login working
- NFO cache loads (52,308 instruments)
- Entry/exit time display correct in grid
- Page alignment fixed
- Promote to LIVE UI fix
- Edit algo loads correct legs
- EOD cleanup at 15:35 IST
- Cascade delete algos
- Execution safety layer: readiness flag (`ready` + `ready_reason` in health endpoint), ExecutionErrorCode enum (10 codes), `_pre_execution_check` in algo_runner uses error codes
- Pre-market validation sweep at 09:14 IST (scheduler)
- SmartStream auto-start on AO login uses `_connected` (WebSocket open) not `_running` (start() called) — prevents double-start during handshake

### What is FAILING ❌
1. **Strike selection fails for Angel One** — root cause of every ERROR
   - Error: "Strike selection failed for leg 1: NIFTY ce atm"
   - Root cause: AngelOneBroker.get_option_chain() returns different format than Zerodha
   - StrikeSelector._normalize_chain() added in Batch 3 but not working correctly
   - Angel One format: {strike_price: {"CE": {...}, "PE": {...}}}
   - Expected after normalization: [{instrument_type, strike, tradingsymbol, instrument_token, ...}]
   - Also: get_underlying_ltp() needs to return correct NIFTY spot for ATM calculation

2. **Mom/Wife Angel One auto-login failing**
   - Error: "Invalid clientcode parameter name" — persists despite direct POST fix
   - Karthik AO works (PEAN1003) but Mom (KRAH1029) and Wife (KRAH1008) fail
   - Possible: Mom/Wife API keys need regeneration or are wrong
   - Credentials: Mom API_KEY=dt2aDQm4, Wife API_KEY=CAXbaPcv
   - Need to verify credentials manually and check Angel One dashboard

3. **Market Feed ERROR after restart**
   - get_index_tokens added but Market Feed still shows ERROR
   - Need to verify auto-start in main.py lifespan is working

### Claude Code Batch 6 — Priority Tasks

P0 — Critical (blocks every trade):
1. Fix StrikeSelector for Angel One option chain format
2. Verify/fix AngelOneBroker.get_underlying_ltp() returns correct spot price
3. Debug Mom/Wife auto-login — test credentials directly

P1 — Important:
4. Market Feed auto-start on startup — verify and fix
5. Orders page WAITING rows still showing NO TRADE algos — filter fix

P2 — Pending from backlog:
6. STBT/BTST exit time logic
7. Soft notifications (Feature 16)


## Angel One Instrument Master — Key Findings (19 Mar 2026)

- URL: https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json (public, no auth)
- Size: 40MB, 209,641 instruments
- NIFTY expiry weekday: Tuesday (changed from Thursday in 2024)
- BANKNIFTY/FINNIFTY/MIDCAPNIFTY: monthly only (no weekly)
- SENSEX: BFO exchange (not NFO)
- MIDCAPNIFTY name in master: "MIDCPNIFTY"
- Strike stored ×100: divide by 100 to get actual strike
- Angel One option chain API (/market/v1/optionChain) is IP-blocked — returns HTML rejection
- Solution: use instrument master JSON instead of option chain API
- Cache once per day as class-level cache shared across all broker instances


## Claude Code Batch 7 — Token Loading + UX + Logging + Reports

### P0 — Critical (every trade fails):

1. Angel One broker token not loaded into app.state after auto-login
   - auto-login saves token to DB but app.state.angelone_karthik has no token
   - algo_runner uses app.state broker object → "Invalid Token" error
   - Fix: after auto-login saves token to DB, also call broker.load_token() on app.state instance
   - Also: on startup, if DB has valid token for today → load into broker instance
   - Files: api/v1/accounts.py (auto-login endpoint), main.py (_auto_start_market_feed)

2. LTP fails silently when broker token is not loaded
   - get_underlying_ltp() returns 0.0 → strike selection fails → no error surfaced to user
   - Fix: raise explicit error when broker.is_token_set() is False before LTP call
   - Files: brokers/angelone.py

### P1 — UX and observability:

3. Smart Grid — show WAITING status (Feature 22 part 2)
   - Currently shows ACTIVE for algos with AlgoState=WAITING
   - Should show WAITING (dimmed, amber dot) when entry time not yet reached
   - ACTIVE/OPEN only after order is filled
   - Status: WAITING → PENDING → OPEN → CLOSED
   - File: frontend/src/pages/GridPage.tsx

4. System Log — persistent with timestamps (Feature 24)
   - Resets on every page refresh
   - Add system_logs table: id, timestamp, level, message, source
   - Backend: write to system_logs on all key events
   - Frontend: fetch on load, append via WebSocket, persist all day
   - Files: new model, new migration, ws/routes.py, DashboardPage.tsx

5. Platform errors in System Log
   - Errors only visible in backend terminal
   - Write to system_logs table with level=ERROR
   - Show in red in System Log panel
   - Notification bell shows count of today's errors

6. Account nickname edit (Feature 10)
   - Inline edit on Accounts page
   - PATCH /accounts/{id} with {nickname}
   - Updates everywhere: Grid, Orders, Reports, Algo dropdown
   - Files: backend/app/api/v1/accounts.py, frontend/src/pages/AccountsPage.tsx

7. Indicator Bots signal observability
   - No way to see if bot is scanning
   - Add signal_log table: bot_id, timestamp, signal_type, value
   - Bot runner writes on every scan
   - Frontend: last 10 signals per bot on IndicatorsPage

8. Start Session — auto-start all services reliably
   - Currently Start Session sometimes partially fails
   - Should: start services in sequence with retry
   - Auto reload NFO cache after Market Feed starts
   - File: frontend/src/pages/DashboardPage.tsx

### P2 — Reports page:

9. Reports page — build it
   - Weekly P&L summary by account
   - Trade history table: date, algo, account, entry, exit, P&L
   - Filters: date range, account
   - Data: orders table + execution_logs

### Bug from today:
- Mom/Wife auto-login: "Invalid clientcode" — needs fresh API keys from Angel One dashboard
  (Business action: regenerate API keys for KRAH1029 and KRAH1008)


## Claude Code Batch 8 — Token Loading + Re-Login

### Root cause of all trade failures today
- uvicorn --reload restarts Python process on file change
- In-memory broker token is wiped on every hot-reload
- _auto_start_market_feed() runs but may fail silently for some accounts
- Result: broker.is_token_set() = False → every trade fails

### Fix
1. New _load_all_broker_tokens(app) in main.py
   - Runs BEFORE _auto_start_market_feed
   - Loads ALL accounts with valid today token into broker instances
   - Each account in own try/except
   - Clear logging per account
2. AccountsPage — always show Auto-Login/Re-Login button
   - Connected: shows "Re-Login" (allows refresh after hot-reload)
   - Not connected: shows "Auto-Login"

### Today's QA results
- Scheduler fires at exact entry time ✅
- WAITING status in grid ✅
- System Log persistent with timestamps ✅
- All 3 Angel One accounts can login ✅
- Mom/Wife .env credentials fixed ✅
- Every trade still failing due to token loss on hot-reload ❌
- Sidebar tickers still not showing ❌


## 🎉 FIRST PRACTIX TRADE — 19 Mar 2026

**Time:** 15:09 IST  
**Account:** Karthik AO (Angel One, PEAN1003)  
**Strategy:** NIFTY Short Straddle  
**Legs:** NIFTY24MAR2622950CE SELL + NIFTY24MAR2622950PE SELL  
**Entry:** 15:09 | **Exit:** 15:12 | **Mode:** PRACTIX

This marks the first successful end-to-end algo trade on STAAX.

### Bugs fixed today to get here (19 Mar QA session)
- Token loading on startup (_load_all_broker_tokens)
- Order model fields: removed algo_name, account_nickname, instrument_token
- fill_time string → datetime
- account_id null → algo.account_id
- tsl_enabled missing → getattr with default
- notify_trade missing algo_name arg
- Angel One instrument master for option chain (IP-blocked API workaround)
- EXPIRY_WEEKDAY: NIFTY=Tuesday (NSE Nov 2024 change)
- is_activated() wrong kwarg in execution_manager

## Claude Code Batch 9 — Orders page fix, RECON fix, LIVE fill_price

### Fixed (19 Mar 2026)
- P0: Orders page crash — `group.mtm.toLocaleString` on undefined
  - Root cause: API returned flat Order dicts; frontend expected AlgoGroup objects
  - Fix: `list_orders` now joins Algo+Account and returns `groups` array in AlgoGroup shape
  - Fix: Frontend transforms `data.groups` → `AlgoGroup[]` with Leg field mapping
  - Fix: Null-guarded `g.legs.map` in doSQ and doTerminate
- P0: ZerodhaBroker.get_orders() added — resolves RECON errors every 30s
  - Wraps `self.kite.orders()` with error guard, returns `[]` on failure
- P1: Mom/Wife API keys — already correct in .env (PDoWMhNz / aWzOhIkY)
  - AngelOneBroker reads from settings (not DB), so no SQL needed
- P1: broker_order_id — code at algo_runner:533 already stores it correctly
  - PRACTIX: stores virtual_book ID; LIVE: stores real broker order ID
  - ⚠️ Gap: OrderPlacer wired with only angelone_mom; Wife LIVE orders would use Mom's broker
    → Must fix before Wife goes LIVE (add angel_broker_map to OrderPlacer)
- P1: fill_price=0.0 for Angel One LIVE orders
  - Root cause: Angel One instrument master has no `last_price` field
  - Fix: algo_runner._place_leg() fetches live LTP via get_ltp_by_token() after strike selection
    (only when ltp==0.0 and is_practix=False and broker_type=="angelone")

## Claude Code Batch 10 — Exit flow fix, Orders display, Multi-account routing

### Fixed
- P0: Exit flow not updating Order records
  - Root cause: `_close_order()` assigned `datetime.now(IST).isoformat()` (string) to a
    `DateTime(timezone=True)` column → asyncpg TypeError → entire transaction rolled back
    → orders stayed `status='open'` with NULL exit fields forever
  - Fix: `order.exit_time = datetime.now(IST)` (datetime object, not string)
  - Fix: Added `_resolve_exit_reason()` classmethod — maps raw strings like `"terminate"`,
    `"overnight_sl"`, `"entry_fail"` to valid `ExitReason` enum members. SQLAlchemy
    previously rejected these at commit time causing the same rollback.
  - ⚠️ Existing bad data (2 PRACTIX orders from 19 Mar): run this SQL once after deploy:
    ```sql
    UPDATE orders
    SET status = 'closed', exit_price = fill_price,
        exit_time = NOW(), exit_reason = 'auto_sq', pnl = 0.0
    WHERE status = 'open' AND is_practix = true
      AND DATE(created_at AT TIME ZONE 'Asia/Kolkata') = '2026-03-19';
    ```
- P0: Orders page early return lacked `"groups": []` key — added
- P0: Dashboard open positions = 2 — auto-fixed by exit flow fix above
- P1: OrderPlacer multi-account Angel One routing
  - `OrderPlacer` now holds `angel_broker_map: Dict[str, AngelOneBroker]` keyed by account DB UUID
  - `place()` accepts `account_id` and routes to the correct broker instance
  - `account_id` threaded through: `execution_manager → order_retry_queue → order_placer`
  - `algo_runner._exit_all_with_db` passes `account_id=str(order.account_id)` on exit
  - `main.py` builds the map at startup via `_build_angel_broker_map()` after `_load_all_broker_tokens`
  - Fallback: if `account_id` not in map, uses `self.angel_broker` (angelone_mom) — safe

### Pending for Batch 11
- P1: Sidebar tickers (Angel One WebSocket)
- P2: Orders page live MTM (currently shows sum of closed P&L, not live MTM)
- P2: Start Session reliability


## Claude Code Batch 12 — Smart Grid + Algo Config UX

### P0 — Live trading verification
1. Karthik AO LIVE mode test (no cash, will get margin error — that is OK)
   - Confirms order actually reaches Angel One broker
   - Verifies broker_order_id is returned and stored

### P1 — Smart Grid improvements
2. Add algo to all weekdays at once
   - "Add to all days" button or drag-to-week option in Smart Grid
   - Currently have to drag to each day individually
   - File: frontend/src/pages/GridPage.tsx

3. Sticky header in Smart Grid
   - Page header + New Algo button disappear when scrolling down
   - Make header sticky so New Algo button always visible
   - File: frontend/src/pages/GridPage.tsx

4. Sort algos in Smart Grid
   - Sort by: name, date created, buy/sell, underlying
   - Add sort dropdown to Smart Grid header
   - File: frontend/src/pages/GridPage.tsx

### P2 — Algo configuration
5. Disable weekly expiry for BANKNIFTY/FINNIFTY/MIDCAPNIFTY
   - These have no weekly expiry (monthly only since Nov 2024)
   - In leg config expiry dropdown: hide "Current Weekly" / "Next Weekly" when underlying is BNF/FINNIFTY/MIDCAP
   - File: frontend/src/pages/AlgoPage.tsx

6. ORB SL provisions
   - ORB entry: sell straddle enters at ORB low, buy enters at ORB high
   - New SL option: "ORB High" and "ORB Low" as SL levels
   - ORB High = SL for sell trades, ORB Low = SL for buy trades
   - Backend: store orb_high and orb_low on AlgoState when ORB fires
   - File: engine/algo_runner.py, frontend/src/pages/AlgoPage.tsx

### P0 — LTP feed for open positions
- When order is placed, subscribe instrument_token to ltp_consumer
- LTP updates must flow to Orders page LTP column and MTM/P&L
- File: engine/algo_runner.py

### P1 — System Log date filter
- Show only today's logs by default (filter by today's date on load)
- If showing older logs, prepend a date stamp: "── 19 Mar 2026 ──"
- Backend: /events/ endpoint already has timestamp — filter by date on frontend
- File: frontend/src/pages/DashboardPage.tsx

### Notes
- Karthik AO: testing only (no cash, margin errors expected and OK)
- Mom + Wife: live trading when ready
- Living Spec = memory file (no separate CLAUDE.md needed)


## Batch 13 — UX polish + Live data

### Completed in Batch 12+
- Sticky headers (Grid + Orders) — z-index fix
- Sort dropdown on Grid
- Add algo to all weekdays button
- ORB SL provisions (orb_high/orb_low)
- BNF weekly expiry disabled
- BTST/STBT next-day scheduling fix

### In progress (this batch)
- P0: Sticky header overlay fix (background #1A1C1E, isolation, z-index 50)
- P1: Sort dropdown moved to beside Show Weekends on Grid
- P1: Sort added to Orders page
- P1: Unsaved algo confirmation dialog (useBlocker + isDirty)
- P2: Live LTP + P&L in Orders page via ws/pnl WebSocket
- P2: Sidebar tickers via ws/ticker WebSocket

### Known errors from today (20 Mar)
- Algo-3 ERROR: NF Sell straddle with SL% — PE leg not firing (logging added)
- Algo-6 ERROR: NF Sell straddle W&T — W&T entry failing
- Algo-9 ERROR: NF Buy CE/PE W&T — W&T entry failing  
- Algo-7, 10, 12 NO TRADE: ORB algos — ORB breakout not detected (no real market feed)
- Algo-14 NO TRADE: Missed due to backend restart
- Algo-15 STBT: Exit time wrong (same day instead of next day) — fixed in this batch


## Batch 16 — UX Fixes + Stability

### Completed today (20 Mar)
- Containerized Grid + Orders scroll ✅
- Nickname edit ✅
- Fill price + LTP in Orders page ✅
- BTST/STBT next-day scheduling ✅
- Premium strike buildPayload fix ✅
- DTE edge case fix ✅

### P0 — Algo Config crash
- useBlocker incompatible with BrowserRouter
- Replace with useEffect + window.beforeunload only
- File: AlgoPage.tsx

### P0 — _subscribe_open_position_tokens NameError  
- Market feed auto-start fails at startup
- Function defined at 367, called at 455/538 inside _auto_start_market_feed (391)
- Error: caught inside try/except, logged as non-fatal
- Fix: inline the function or ensure it is found in scope

### P0 — Angel One SmartStream not connecting
- feedToken exists in DB (confirmed)
- No [AO-DEBUG] logs — adapter start() never called
- Market feed auto-start is failing before reaching Angel One path
- Fix: resolve _subscribe_open_position_tokens first, then debug SmartStream

### P1 — Grid + Orders UX (from today)
1. Grid table first row (ALGO/MON/TUE) should be sticky within container
2. Add "All" chip button in table header row beside ALGO column
3. Hide scrollbar visually (scrollbar-width: none)
4. Algo card: 4 rows — Name | Account+Tags | Promote+All chips
5. Rename chips: "Promote" and "All"

### P1 — Orders page display fixes
6. SL/Target show % — should show calculated price value
   BUY SL: entry_price * (1 - sl_pct/100)
   SELL SL: entry_price * (1 + sl_pct/100)
7. MTM shows "0" when not set — hide if null/zero
8. Exit time shows 9:31 default — show actual exit time
9. REASON shows auto_sq for all — should show exit_time when exit by time
10. MTM not showing in topbar or browser tab

### P1 — System Log
11. Date grouping wrong (IST vs UTC issue partially fixed)
12. Recent events should be on top, date separators correct

### P2 — Stability (from ChatGPT analysis — all valid)
1. Execution lock per (algo_id, leg_id) — prevent duplicate orders
2. Kill switch enforcement in retry queue
3. Event-based reconciliation after place/SQ/kill switch
4. Orphan position handling (external positions)
5. Smart retry classifier (don't retry margin errors)
6. Broker reconnect subscription verification
7. Portfolio-level daily loss guard

### Known errors
- Algo-3: PE leg not firing (SL% straddle) — logging added
- Algo-6: W&T failing (no LTP feed)
- Algo-9: W&T failing (no LTP feed)
- Algo-7/10/12: ORB no trade (no LTP feed)
- Algo-18: DTE positional error


## Batch 18 — Orders UX + Indicator Bots + Sidebar Tickers

### P0 — Critical fixes
1. AlgoPage: unsaved changes popup (useBlocker alternative)
   - Current: banner shows but navigation not blocked
   - Fix: intercept sidebar NavLink clicks when isDirty=true
   - Show confirmation modal "Unsaved changes — Leave anyway?"
   - Use useNavigate + local pendingPath state

2. Active algos count wrong (Dashboard shows 1 when 0)
   - Check /api/v1/system/stats active_algos count
   - Likely counting grid entries not actual running algos

3. Exit time shows 09:31 (default algo exit time, not actual exit)
   - Orders page shows configured exit_time not actual order.exit_time
   - Fix: use order.exit_time from DB not algo config

### P1 — Orders page improvements  
4. Algo name click → show strategy popup (not navigate)
   - Show popup modal with algo parameters (hide empty ones)
   - Close button returns user to Orders page

5. Historical orders filter
   - Intraday closed orders: only show on the day they were traded
   - STBT/BTST: show on exit day not entry day
   - Add is_historical flag or filter by fill_time date

6. SL/TP/W&T display consolidation
   - Show calculated values with setting in parenthesis
   - O: = Original (configured level price)
   - A: = Actual (current adjusted level, e.g. after TSL moves)
   - Only show A/O when TSL/TTP is active
   - Plain vanilla: just show price (no A/O prefix)
   - W&T: show trigger price
   - Format: "23150 (50%)" or "23150 (50pts)"

7. Entry/Fill consolidation  
   - ENTRY/REF: the reference price (ATM strike price at time of selection)
   - FILL: actual avg fill price (may differ from entry due to slippage)
   - Consolidate into one column: show FILL as primary, ENTRY as secondary
   - Format: "Fill: 23150 / Ref: 23100"

8. MTM in topbar + browser tab still not updating
   - Check TopBar polling + setLivePnl wiring

### P2 — Indicator Bots page
9. Add Signal Tracker section below indicator cards
   - Shows active signals being tracked
   - Columns: Signal, Underlying, Direction, Triggered At, Status

10. Add Orders section below Signal Tracker
    - Shows orders placed by indicator bots
    - Columns: #, STATUS, SYMBOL, LOTS, ENTRY/FILL + date, LTP, EXIT + date, REASON, P&L
    - Containerized scroll like Orders page (no day tabs)
    - Simple cards without day-wise grouping

11. Move Indicator Bots tab after Orders in sidebar

### P2 — Sidebar tickers (TradingView alternative)
12. Use TradingView free widget API for index prices
    - Replace Angel One SmartStream attempt
    - TradingView provides free real-time index quotes via widget
    - Embed TradingView ticker widget in sidebar
    - Show: NIFTY, BANKNIFTY, SENSEX, FINNIFTY, MIDCAP, GOLDM


## 20 Mar 2026 — End of Day Summary

### Session accomplishments
- 15 PRACTIX strategies tested (Algo-1 through Algo-19)
- Algo-4 OTM2 ✅ correct strike at 23400, premium 201
- Algo-1 ATM ✅ correct at 23250
- Orders page: real fill prices, IST timestamps, SL calculated values
- Smart Grid: containerized scroll, sticky column headers, All+Promote chips
- Algo Config: loads correctly, unsaved changes banner
- Dashboard: Today P&L +₹271 showing correctly
- Topbar MTM fallback to today_pnl ✅
- Active algos + open positions: IST date filter applied
- Sidebar: TradingView broken iframes removed, static tickers with links
- System Log: IST timestamps, newest first

### Known pending (Monday)
- Algo-3 PE leg failure (SL% straddle) — needs log analysis
- Algo-6/9 W&T failures — need live LTP feed
- Algo-7/10/12 ORB no trade — need live LTP feed  
- Angel One SmartStream not connecting — root cause: _subscribe_open_position_tokens
  called inside _auto_start_market_feed try/except, fails silently
- Sidebar live tickers — blocked on SmartStream
- SEBI April 1: static IP required for Angel One Smart API

### Monday morning checklist
1. cd ~/STAXX/staax && ./debug_log.sh
2. Auto-login all 3 AO accounts
3. Run: ./show_errors.sh
4. Create test algos: one per strategy type
5. Watch Orders page for real fill prices


## STAAX Roadmap — Post 20 Mar 2026

### Phase 1F — UX Enhancements (Next)

#### 1. Platform-wide
- P&L live in topbar (fallback to today_pnl working, live MTM pending SmartStream)
- Move "+ New Algo" from Smart Grid to a dedicated sidebar nav item with distinct icon/color
- Sidebar live tickers (blocked on Angel One SmartStream fix)
- Documentation popup: user workflow guide + algo config guide with screenshots

#### 2. Dashboard
- Active Algos count: IST date filter applied (pending restart to take effect)

#### 3. Smart Grid
- Rename "All → Today" chip to "All" 
- Add Delete + Archive buttons beside "All" chip in table header row
- Both require confirmation popup before executing (grid-level destructive actions)

#### 4. Algo Config
- RESL/RETP split (re-entry on SL vs TP independently) — queued in Batch 14

#### 5. Orders Page
- RUN/RE/SYNC/SQ/T button styling improvement (currently too plain)
- P&L alignment: fixed-width right side so buttons stay aligned across all cards
  (currently P&L value causes zig-zag misalignment)

#### 6. Indicator Bots
- Section order: Bots cards → Signal Tracker → Orders
- Activate real signal tracking per underlying + indicator defined per bot

#### 7. Reports
- Wire real trade data to Reports page
- Fix P&L legend and "Click to Expand" alignment/spacing
- Show/hide algos in PER-ALGO METRICS based on date period (include deleted algos)
- Sort buttons on each column header in PER-ALGO METRICS table

### Phase 2 — Platform Deployment

#### Infrastructure
- Multi-app URL structure:
  - STAAX → URL/STAAX
  - INVEX → URL/INVEX  
  - BUDGEX → URL/BUDGEX
  - FINEX → URL/FINEX
- AWS EC2 server with Elastic IP (static IP required for Angel One Smart API)
- SSL certificate + domain name (good URL TBD)
- Security hardening (env secrets, HTTPS, CORS lockdown)

#### SEBI Compliance (April 1 2026 deadline)
- Static IP registration on Angel One Smart API dashboard (all 3 accounts)
- New API key generation after IP registration
- Family account compliance flow (Angel One working on this for same-WiFi accounts)

### Phase 3 — Premium Redesign
- Glassmorphism + liquid glass effects throughout
- Different visual language per module (Grid, Orders, Dashboard, Reports each unique)
- Single-user platform — performance is not a constraint
- Premium dark UI with proper design system and CSS variables
- Target: "institutional trading terminal" aesthetic not "generic SaaS"

### Known Bugs (Monday priority)
1. Angel One SmartStream not connecting → blocks tickers, W&T, ORB, live P&L
   Root: _subscribe_open_position_tokens NameError in _auto_start_market_feed
2. Algo-3 PE leg failure (SL% straddle)
3. Algo-6/9 W&T failures (need live LTP)
4. Algo-7/10/12 ORB no trade (need live LTP)
5. Algo-18 DTE positional error
6. Wife order routing (safe in PRACTIX, must fix before LIVE)


## Batch 20 — Errors, System Log, Grid Reset

### P0 — Grid entries reset (urgent)
- All algos dragged to Mon-Fri have disappeared from the grid
- Need to investigate: were grid_entries deleted from DB or is it a frontend bug?
- Check: SELECT COUNT(*) FROM grid_entries WHERE is_active=true
- If entries exist in DB but grid shows empty: frontend week date calculation bug
- If entries deleted: check what triggered the deletion

### P1 — Leg error display in Orders page
- Errors for each leg should show inline below that leg
- Light red background highlight on the leg row
- Red font for error message text
- Show error_message field from Order record
- If entire algo errored: show in algo header row as inline comment
- File: frontend/src/pages/OrdersPage.tsx

### P1 — System Log as universal action capture
- Ditch the notifications bell/section entirely
- System Log (on Dashboard) should capture ALL platform actions:
  - Scheduler: entry fired, exit fired
  - Auth: login/logout per account
  - Orders: placed, failed, closed, SL hit, TP hit
  - Kill switch: activated/deactivated
  - Market feed: started/stopped
  - Any error with [ERROR] prefix
- Remove notifications icon from TopBar
- Remove notifications dropdown/panel
- File: backend/app/engine/algo_runner.py (add event logging for all order events)
  frontend/src/components/layout/TopBar.tsx (remove bell icon)
  frontend/src/pages/DashboardPage.tsx (System Log already shows events)


## 25 Mar 2026 — Session Summary

### Completed This Session

#### Batch 20 — Recurring Grid + System Log + Orders Errors
- recurring_days JSON column added to algos table (migration run)
- Grid entries auto-populate missing recurring days on page mount
- X button on grid cell shows "Just Today / Remove Recurring" modal
- Bell icon removed from TopBar entirely
- System Log captures all platform events (auth, scheduler, orders, errors)
- Orders page: leg error rows show inline with left red border + group error badge

#### Sidebar
- New Algo nav item added between Smart Grid and Orders — amber #D77B12, + icon
- Logout button moved to sidebar bottom, red on hover
- Static ticker instruments removed from sidebar

#### AlgoPage — RESL / RETP
- RE split into RE-SL and RE-TP independent toggles
- New DB columns: reentry_on_sl, reentry_on_tp on algo_legs (migration 0012)
- Button order all levels: W&T > SL > TSL > RE-SL > TP > TTP > RE-TP
- Blocked logic uniform: TSL/RE-SL blocked unless SL enabled+value; TTP/RE-TP blocked unless TP enabled+value
- Cascades: SL off resets TSL+RE-SL; TP off resets TTP+RE-TP
- RE-SL/RE-TP panels: mode (@Entry/Now/@Cost) + count 1-3x (max 3)
- Journey children: RE-SL and RE-TP panels wired on all levels

#### SmartStream Debug
- [AO-CONNECT] logging added around AngelOneTickerAdapter creation in main.py
- Full traceback on failure via [AO-CONNECT FAILED]

### Pending
- SmartStream actual fix — debug logs ready, test tomorrow with valid AO token
- Recurring auto-fill — test tomorrow morning when scheduler fires
- TradingView ticker deferred — not needed for systematic trading


## 25 Mar 2026 — SmartStream Debug Session

### Root cause found and fixed
- `smartapi-python` was NOT installed — this was the core blocker for all SmartStream sessions
- Installed: smartapi-python 1.5.5 + logzero + websocket-client
- Import path fixed: `SmartApi.smartWebSocketV2` (lowercase w) not `SmartApi.SmartWebSocketV2`
- `asyncio` import confirmed at line 17 of main.py

### Architecture fix
- `_auto_start_market_feed()` at startup no longer attempts SmartStream (tokens always stale at startup)
- SmartStream now auto-starts from `angelone_login()` after fresh token obtained
- `adapter.start()` wired in both `accounts.py` and `system.py` start-market-feed endpoint
- Flow: morning auto-login → fresh JWT + feed_token → adapter.start() → SmartWebSocketV2.connect()

### Tomorrow morning test
1. Start backend: ./debug_log.sh
2. Run auto-login for all 3 accounts
3. Watch logs for: [AO-LOGIN] SmartStream auto-started
4. Then watch for: [AO-DEBUG] _on_open fired
5. If _on_open fires → SmartStream working → tickers, W&T, ORB all unblocked


---

## STAAX — Living Backlog & Status (updated 25 Mar 2026)

> This section is the SSOT for all pending work. Updated every session. Supersedes all prior backlog entries above.

---

### 🔴 P0 — Blockers (nothing works without these)

| # | Item | Status | Blocked by |
|---|------|--------|------------|
| P0-1 | **SmartStream `_on_open` confirmation** | ⏳ Test tomorrow morning | Need fresh tokens during market hours |
| P0-2 | **SEBI April 1 static IP** | ⏳ Do before live deployment | AWS EC2 + Elastic IP required |

**SmartStream current state:**
- `smartapi-python` 1.5.5 installed ✅
- Import path fixed: `SmartApi.smartWebSocketV2` ✅
- `adapter.start()` wired in `angelone_login()` — auto-starts on every morning login ✅
- Startup SmartStream attempt removed (tokens always stale at startup) ✅
- Tomorrow: login → watch logs for `[AO-LOGIN] SmartStream auto-started` → then `[AO-DEBUG] _on_open fired`

---

### 🟡 P1 — Active Phase 1F Backlog

#### Engine / Backend
| # | Item | Notes |
|---|------|-------|
| P1-1 | Algo-3 PE leg failure | SL% straddle, CE fires but PE fails silently. Needs log analysis |
| P1-2 | Algo-6/9 W&T failures | Blocked on SmartStream |
| P1-3 | Algo-7/10/12 ORB no trade | Blocked on SmartStream |
| P1-4 | Algo-18 DTE positional error | Needs investigation |
| P1-5 | Wife order routing | Safe in PRACTIX, must fix before LIVE |
| P1-6 | Recurring auto-fill test | Deploy to Thursday — verify auto-fill at mount tomorrow |

#### Frontend / UX
| # | Item | Notes |
|---|------|-------|
| P1-7 | Orders page button styling | RUN/RE/SYNC/SQ/T too plain |
| P1-8 | Orders P&L alignment | Fixed-width right side to stop zig-zag misalignment |
| P1-9 | Orders exit time fix | Shows configured exit_time not actual order.exit_time |
| P1-10 | Orders algo name click → popup | Show strategy params modal, don't navigate |
| P1-11 | Reports page — wire real data | Currently stub. Wire to orders table + execution_logs |
| P1-12 | Reports fixes | P&L legend, Click to Expand spacing, PER-ALGO sort buttons |
| P1-13 | Grid: Delete + Archive buttons | Beside "All" chip, with confirmation popup |
| P1-14 | Dashboard: Active Algos IST filter | Needs restart to take effect |
| P1-15 | Indicator Bots: Signal Tracker + Orders | Below bot cards, per spec §6 |
| P1-16 | Documentation popup | User workflow guide + algo config guide |

---

### 🟢 Phase 2 — Deployment (after platform stable)

| # | Item | Notes |
|---|------|-------|
| PH2-1 | AWS EC2 + Elastic IP | Required for SEBI static IP compliance |
| PH2-2 | SSL + domain | Good URL TBD |
| PH2-3 | Multi-app URLs | /STAAX /INVEX /BUDGEX /FINEX |
| PH2-4 | Security hardening | HTTPS, CORS lockdown, env secrets |
| PH2-5 | SEBI Angel One registration | Register static IP on all 3 accounts, regenerate API keys |

---

### 🔵 INVEX — Phase 2 (SIP Engine)

| # | Item | Notes |
|---|------|-------|
| INV-1 | SIP frontend page | Tables + API routes already exist in invex/ |
| INV-2 | SIP scheduler job | 09:20 IST daily, market order CNC |
| INV-3 | SIP order execution | Via Angel/Zerodha execution_router |

---

### ✅ Completed This Session (25 Mar 2026) — commit `baa9b93`

- Recurring grid entries: `recurring_days` column, auto-fill on mount, Just Today/Remove Recurring modal
- Bell icon removed from TopBar — System Log is universal action capture
- Orders page: leg error inline display with red left border + group badge
- New Algo in sidebar (amber #D77B12, + icon)
- Logout moved to sidebar bottom, red on hover
- Static tickers removed from sidebar
- RE split into RE-SL + RE-TP: independent toggles, blocked logic, panels with mode + count 1-3x
- reentry_on_sl + reentry_on_tp columns migrated (migration 0012)
- Button order W&T > SL > TSL > RE-SL > TP > TTP > RE-TP on all levels
- SmartStream: smartapi-python installed, import fixed, adapter.start() wired on login

---

### 📋 Tomorrow Morning Checklist

1. `cd ~/STAXX/staax && ./debug_log.sh`
2. Auto-login all 3 AO accounts
3. Watch logs for `[AO-LOGIN] SmartStream auto-started` and `[AO-DEBUG] _on_open fired`
4. Check Grid — recurring days should auto-fill Thursday entries
5. Run `./show_errors.sh`
6. Next task from backlog: P1-7 Orders button styling OR P1-1 Algo-3 PE leg failure analysis



---

## STAAX — Living Backlog & Status (updated 26 Mar 2026)

> Supersedes all prior backlog entries. Updated every session.

---

### ✅ Completed This Session (26 Mar 2026) — commit TBD

#### Orders Page
- Open Positions Panel — compact cards above day tabs, groups by algo, shows entry date + strategy type + open count + P&L
- Clicking card navigates to correct day tab
- list_orders API fixed — open orders from same day_of_week always show on that day tab (BTST/Positional carry-forward)
- New GET /orders/open-positions endpoint
- Day tabs full-width equal spacing
- TRADING DAY header with inline MTM (plain text, green/red)
- Button style: pill shape with glow on hover
- P&L fixed min-width — no button shift

#### Performance
- Instrument master disk cache — avoids 40MB re-download on every backend restart
- First restart downloads and saves cache; subsequent restarts load from disk in <1s

---

### 🔴 P0 — Blockers

| # | Item | Status |
|---|------|--------|
| P0-1 | SmartStream _on_open confirmation | ⏳ Test tomorrow morning with fresh tokens |
| P0-2 | SEBI April 1 static IP | ⏳ Before live deployment |

---

### 🟡 P1 — Active Backlog

| # | Item | Status | Notes |
|---|------|--------|-------|
| P1-1 | Algo-3 PE leg failure | ⏳ | SL% straddle, needs log analysis |
| P1-2 | W&T failures (Algo-6/9) | ⏳ | Blocked on SmartStream |
| P1-3 | ORB no trade (Algo-7/10/12) | ⏳ | Blocked on SmartStream |
| P1-4 | Algo-18 DTE positional error | ⏳ | Needs investigation |
| P1-5 | Wife order routing | ⏳ | Fix before LIVE |
| P1-6 | Recurring auto-fill test | ⏳ | Verify tomorrow morning |
| P1-7 | Orders button styling | ✅ Done | Pill + glow |
| P1-8 | Orders P&L alignment | ✅ Done | Fixed min-width |
| P1-9 | Orders exit time | ✅ Verified | Uses actual order.exit_time |
| P1-10 | Orders algo name → popup | ✅ Verified | Already wired |
| P1-11 | Reports page wire real data | ⏳ | Next task |
| P1-12 | Reports fixes | ⏳ | P&L legend, sort buttons |
| P1-13 | Grid: Delete + Archive buttons | ⏳ | With confirmation popup |
| P1-14 | Remove New Algo button from Smart Grid | ⏳ | Now in sidebar, remove from grid |
| P1-15 | Dashboard: Active Algos IST filter | ⏳ | |
| P1-16 | Indicator Bots: Signal Tracker + Orders | ⏳ | |
| P1-17 | Documentation popup | ⏳ | |
| P1-18 | api.ts env TypeScript error | ⏳ | Needs vite-env.d.ts fix |
| P1-19 | Backend slow startup | ✅ Done | Disk cache for instrument master |
| P1-20 | Open Positions Panel | ✅ Done | Compact cards above day tabs |

---

### 🔵 INVEX Phase 2
| # | Item | Status |
|---|------|--------|
| INV-1 | SIP frontend page | ⏳ |
| INV-2 | SIP scheduler 09:20 IST | ⏳ |
| INV-3 | SIP order execution | ⏳ |

---

### 📋 Tomorrow Morning Checklist
1. `./debug_log.sh`
2. Auto-login all 3 AO accounts
3. Watch for `[AO-LOGIN] SmartStream auto-started` → `[AO-DEBUG] _on_open fired`
4. Check Grid — Thursday recurring auto-fill
5. Check FRI tab — Algo-3 and Algo-18 open positions should show
6. Next task: P1-11 Reports page OR P1-13 Grid Delete/Archive


---

## STAAX — Living Backlog & Status (updated 26 Mar 2026)

> Supersedes all prior backlog entries. Updated every session.

---

### ✅ Completed This Session (26 Mar 2026) — commit 4af9f2e

#### Orders Page
- Open Positions Panel — compact cards above day tabs, groups by algo, shows entry date + strategy type + open count + P&L
- Clicking card navigates to correct day tab
- list_orders API fixed — open orders from same day_of_week always show (BTST/Positional carry-forward)
- New GET /orders/open-positions endpoint
- Day tabs full-width equal spacing
- TRADING DAY header with inline MTM (plain text, green/red)
- Button style: pill shape with glow on hover
- P&L fixed min-width — no button shift

#### Performance
- Instrument master disk cache — avoids 40MB re-download on every restart

---

### 🔴 P0 — Blockers

| # | Item | Status |
|---|------|--------|
| P0-1 | SmartStream _on_open confirmation | ⏳ Test tomorrow morning |
| P0-2 | SEBI April 1 static IP | ⏳ Before live deployment |

---

### 🟡 P1 — Active Backlog

| # | Item | Status | Notes |
|---|------|--------|-------|
| P1-1 | Algo-3 PE leg failure | ⏳ | Needs log analysis |
| P1-2 | W&T failures Algo-6/9 | ⏳ | Blocked on SmartStream |
| P1-3 | ORB no trade Algo-7/10/12 | ⏳ | Blocked on SmartStream |
| P1-4 | Algo-18 DTE positional error | ⏳ | Needs investigation |
| P1-5 | Wife order routing | ⏳ | Fix before LIVE |
| P1-6 | Recurring auto-fill test | ⏳ | Verify tomorrow morning |
| P1-7 | Orders button styling | ✅ | Pill + glow |
| P1-8 | Orders P&L alignment | ✅ | Fixed min-width |
| P1-9 | Orders exit time | ✅ | Uses actual order.exit_time |
| P1-10 | Orders algo name popup | ✅ | Already wired |
| P1-11 | Reports page wire real data | ⏳ | Next task |
| P1-12 | Reports fixes | ⏳ | P&L legend, sort buttons |
| P1-13 | Grid Delete + Archive buttons | ⏳ | With confirmation popup |
| P1-14 | Remove New Algo button from Smart Grid | ⏳ | Now in sidebar, remove from grid |
| P1-15 | Dashboard Active Algos IST filter | ⏳ | |
| P1-16 | Indicator Bots Signal Tracker + Orders | ⏳ | |
| P1-17 | Documentation popup | ⏳ | |
| P1-18 | api.ts env TypeScript error | ⏳ | Needs vite-env.d.ts fix |
| P1-19 | Backend slow startup | ✅ | Disk cache for instrument master |
| P1-20 | Open Positions Panel | ✅ | Compact cards above day tabs |

---

### 🔵 INVEX Phase 2

| # | Item | Status |
|---|------|--------|
| INV-1 | SIP frontend page | ⏳ |
| INV-2 | SIP scheduler 09:20 IST | ⏳ |
| INV-3 | SIP order execution | ⏳ |

---

### 📋 Tomorrow Morning Checklist
1. ./debug_log.sh
2. Auto-login all 3 AO accounts
3. Watch for [AO-LOGIN] SmartStream auto-started → [AO-DEBUG] _on_open fired
4. Check Grid — Thursday recurring auto-fill
5. FRI tab — Algo-3 and Algo-18 open positions should show
6. Next: P1-11 Reports OR P1-13 Grid Delete/Archive OR P1-14 Remove New Algo from Grid

---

## ⚠️ CRITICAL RULES (added 26 Mar 2026 after data loss incident)

1. **ALWAYS run `~/STAXX/backup_db.sh` before ANY DB schema changes**
2. Daily auto-backup runs at 6pm → `~/STAXX/db_backups/`
3. Never run `ALTER TYPE RENAME VALUE` without backup first
4. Never share API credentials in chat — add to `.env` directly
5. Verify `.gitignore` before every `git add` — `.env` must never be committed

## DB Recovery Notes (26 Mar 2026)
- All data was lost due to enum renames without backup
- Enum values corrected to lowercase: orderstatus, strategymode, brokertype, algorunstatus, accountstatus
- Missing columns added: orders.instrument_token, algos.dte, accounts.fy_margin etc
- Accounts re-inserted: Karthik AO (angelone), Karthik (zerodha)
- Algos and grid entries need to be re-entered manually

## Pending After Data Loss
- Re-enter all 19 algos via Algo page
- Re-populate Smart Grid for the week
- Add Mom and Wife accounts once credentials are available
- PRACTIX orders from 20 Mar are permanently lost (test data only)

## Session Update — 2026-03-28

### Completed This Session
- ✅ FO-2: Accounts load on app init (App.tsx) — dropdown works on all pages
- ✅ FO-3: Open positions cards show account name chip
- ✅ FO-4: Smart Grid filters by is_practix mode
- ✅ FO-5: Open positions filtered by mode
- ✅ FO-6: Dashboard stats filtered by mode (active_algos, open_positions, today_pnl, fy_pnl)
- ✅ FO-7: Dashboard counts now show correctly (removed today-only scope)
- ✅ FO-8: P&L by Day widget redesigned — proportional bars, single letters, no numbers
- ✅ FO-9: fy_pnl filtered by is_practix
- ✅ FO-10: PRACTIX/LIVE chip uniform across all pages (Dashboard, Grid, Orders, Reports, Indicators)
- ✅ FO-11: Reports top widgets uniform height (127px)
- ✅ BUG-1: Recurring deploy loop fixed — auto-deploy disabled in LIVE mode
- ✅ P1-13: Archive confirmation modal added to Smart Grid
- ✅ isPractixMode persists to localStorage (survives refresh)
- ✅ Mom AO + Wife AO accounts created in DB (KRAH1029, KRAH1008)
- ✅ BUDGEX: Full backend built (expenses, accounts, subscriptions, dashboard, voice APIs)
- ✅ BUDGEX: Frontend built by Claude Code, redesigning to match INVEX style

### Pending
- 🔄 FO-1: Promote to LIVE — in progress (Claude Code)
- 🔄 BUDGEX: UI redesign to match INVEX (Claude Code)
- ❌ P1-1: Algo-3 PE leg failure — needs log analysis
- ❌ P1-5: Wife order routing — DB accounts created, needs testing
- ❌ SmartStream WebSocket adapter — blocks live tickers (Monday morning test)
- ❌ SEBI April 1 static IP — required before LIVE deployment

### DB State
- staax_db: 4 accounts (Karthik/Zerodha, Karthik AO, Mom AO, Wife AO)
- No duplicate grid entries
- 2 open PRACTIX positions (Algo-3, Algo-15/18)

### Start Commands
```bash
# Backend (no --reload)
cd ~/STAXX/staax/backend && uvicorn app.main:app --host 0.0.0.0 --port 8000

# Frontend
cd ~/STAXX/staax/frontend && npm run dev

# BUDGEX Backend
cd ~/STAXX/budgex/backend && uvicorn app.main:app --host 0.0.0.0 --port 8002

# BUDGEX Frontend  
cd ~/STAXX/budgex/frontend && npm run dev -- --port 3002
```


## Session Update — 2026-03-28 (continued)

### Additional fixes this session
- ✅ P1-1: Algo-3 CE stuck order closed via SQL (NIFTY24MAR2623250CE)
- ✅ P1-4: Algo-18 BNF stuck order closed via SQL (BANKNIFTY28APR2654400CE)
- ✅ Thursday holiday grid entries reset to no_trade
- ✅ Mom AO + Wife AO DB accounts created
- ✅ BUDGEX: Full backend + frontend built, INVEX-style redesign applied
- 🔄 F-1: Market holidays feature (Claude Code building)

### Systematic bug identified (not yet fixed)
get_option_chain called once per leg (not cached per enter() call).
A straddle = 2x 40MB downloads, iron condor = 4x. Any AO API hiccup
between calls causes PE/subsequent legs to fail and CE to get stuck.
Fix: cache get_option_chain result keyed by underlying+expiry for
duration of single enter() call.

### INVEX Updates
- ✅ SIP page built by Claude Code
- ✅ JWT fix: invex_token → staax_token (shared auth with STAAX)
- ✅ Logout moved to sidebar
- ✅ Page transition animations unified
- ✅ SIP page design matches Portfolio page
- 🔄 Portfolio data loading (JWT secret alignment in progress)

### Pending Items
| ID | Item | Status |
|----|------|--------|
| P0-1 | SmartStream WebSocket | Monday morning test |
| P0-2 | SEBI April 1 static IP | ⚠️ URGENT — 4 days |
| get_option_chain cache | Systematic PE leg fix | Next session |
| F-1 | Market holidays | Claude Code building |
| BUDGEX GitHub | Create repo | Pending |
| INVEX portfolio | JWT secret alignment | In progress |


## End of Session — 2026-03-28

### Committed This Session
- 7fb7274: Demote button, LIVE tag fix, bots is_practix, algo-level promote
- Latest: F-1 Market holidays (NSE sync, dashboard widget, grid column highlight)

### Critical Items for Monday
1. SmartStream WebSocket test (P0-1) — blocks live tickers
2. Server setup planning post-Monday session
3. get_option_chain caching fix (systematic PE leg bug)
4. Wife/Mom order routing test after Monday login

### BUDGEX Start Commands
```bash
docker start budgex_db
cd ~/STAXX/budgex/backend && uvicorn app.main:app --host 0.0.0.0 --port 8002 &
cd ~/STAXX/budgex/frontend && npm run dev -- --port 3002
```


## Session Update — 2026-03-29 (Morning)

### Completed This Session
- ✅ Analytics page — 4 tabs: Performance, Risk Heatmap, Failures, Slippage
- ✅ Performance tab: 5 summary cards (Total Trades, Win Rate, Total P&L, Best Algo, Worst Algo)
- ✅ Best/Worst Algo cards show W/L breakdown
- ✅ Tab state persists to localStorage across page refreshes
- ✅ All warning/limitation badges removed from Analytics tabs
- ✅ 4 new backend report endpoints:
    - GET /reports/day-breakdown — Day×Algo P&L for Risk Heatmap
    - GET /reports/errors — Historical failure analytics
    - GET /reports/slippage — Historical slippage analytics  
    - GET /reports/all-orders — All historical orders without date filter
- ✅ Timeframe selector: 2 rows (15/30/45 min | 1/2/3 hr)
- ✅ Reports page: Calendar → Per-Algo Metrics gap fixed
- ✅ Indicator Bots: refetch on PRACTIX/LIVE toggle fixed
- ✅ Market holidays: NSE sync, dashboard widget, grid highlight

### Analytics Page — Known Limitations
- Risk Heatmap shows FY P&L per algo (not day×algo) — day breakdown 
  endpoint exists but Analytics page not yet wired to it
- Failures/Slippage show today's orders only — need to wire to new 
  /reports/errors and /reports/slippage endpoints

### Next Steps (post-Monday live session)
1. Wire Analytics tabs to new backend endpoints (day-breakdown, errors, slippage)
2. Execution guard (Item 7) + Startup safety check (Item 8)
3. get_option_chain caching fix (systematic PE leg bug)
4. Intelligent alerting — Telegram bot
5. Server setup + static IP

### Monday Checklist
1. ~/STAXX/backup_db.sh
2. Start backend: cd ~/STAXX/staax/backend && uvicorn app.main:app --host 0.0.0.0 --port 8000
3. Start frontend: cd ~/STAXX/staax/frontend && npm run dev
4. Login → auto-loads broker tokens
5. Watch for SmartStream _on_open in logs
6. Test PRACTIX session with all algos
7. Test Mom's account order routing
8. If SmartStream works → test 1 algo in LIVE mode

### Live Trading Plan
- Phase 1: Mom's Angel One account first
- Phase 2: Wife's account (MCX via Indicator Bots)  
- Phase 3: Zerodha (needs static IP from Zerodha)
- Static IP: Angel One allows family mapping post 2-3 months (single IP)


## Pending Items — Post-Monday Session

### 🔴 Bug Fixes
| # | Item | Details |
|---|------|---------|
| B-1 | Holiday highlight transparent | Shows algos below it in Smart Grid (see screenshot) — needs solid background |
| B-2 | Algo created in LIVE mode not showing | Saved successfully but doesn't appear in LIVE or PRACTIX grid |
| B-3 | Weekend entries reset on refresh | Adding algo to Sat/Sun resets after refresh in Smart Grid |
| B-4 | Show Weekends checkbox resets | Doesn't retain state on refresh in Smart Grid (works in Orders page) |
| B-5 | All→Today chip errors on weekend | "Today is not a trading day" when clicked on Sat/Sun |
| B-6 | Reports filters not wired | Month/Date/Custom filters in Per-Algo Metrics don't work |
| B-7 | Remove "Click to Expand" text | In Full Year Calendar section in Reports page |
| B-8 | PRAC/LIVE toggle chip on cells | Should be removed — algo-level promote/demote makes cell-level toggle redundant |
| B-9 | Indicator Bots toggle not reactive | Toggling PRACTIX/LIVE requires refresh (unlike Smart Grid which is dynamic) |

### 🟡 UI/UX Improvements
| # | Item | Details |
|---|------|---------|
| U-1 | Smart Grid table header border | Bottom border missing — needed for clear demarcation while scrolling |
| U-2 | Consolidate Performance + Heatmap | Performance tab is replica of Reports page. Merge Best/Worst Algo + P&L bar into single Analytics view. Evaluate Algo Health Score addition |
| U-3 | Add Account button | Replace "Zerodha manual login available in Dashboard" text with Add Account button in Accounts page |
| U-4 | Add Account functionality | New accounts page with Add Account button — full CRUD for broker accounts |

### 🟠 New Features
| # | Item | Details |
|---|------|---------|
| F-1 | Indicator Bot Signal API | Backend endpoint to record/retrieve bot signals |
| F-2 | Signal Tracker orders | Show orders triggered by each signal in Signal Tracker table |
| F-3 | MCX holidays | NSE API endpoint shows MCX holidays too. MCX has session-based holidays (morning/evening). Required for Indicator Bots |
| F-4 | Global SL/TP verification | Check if Global SL and Global TP settings are wired and working |
| F-5 | Algo Health Score | Score based on P&L, drawdown, win rate, consistency — for Analytics page |

### 🔵 Phase 2 Features (Analytics + Architecture)
- Wire Analytics tabs to new backend endpoints (day-breakdown, errors, slippage endpoints built, not yet wired)
- Risk Heatmap: proper Day×Algo matrix using /reports/day-breakdown
- Failure Analytics: wire to /reports/errors endpoint
- Slippage Report: wire to /reports/slippage endpoint
- Trade Replay: store LTP snapshots (5s, 90-day FIFO), replay engine
- Latency Tracker: order placement time vs broker response time
- **ZMQ-1**: ZeroMQ message bus for market data — replace direct SmartStream with pub/sub architecture (ref: OpenAlgo https://github.com/marketcalls/openalgo)
- **PSM-1**: Python Strategy Manager — upload .py strategy files, run in process isolation, signals flow to bot_runner (ref: OpenAlgo)
- **HST-1**: ⬜ Deferred — historical OHLCV data engine. OpenAlgo + Historify evaluated; will build natively, no external dependency.
- **MCP-1**: MCP Server for STAAX — expose order placement and algo management via MCP protocol for LIFEX AI
- **MOB-2**: Mobile app enhanced notifications — trade fill alerts with symbol/price, SL/TP hit with P&L, daily briefing

### 🔵 Phase 3 Features (Infrastructure + Long Term)
- Server setup + static IP registration with SEBI
- Angel One family account mapping (post 2-3 months)
- Execution Guard: check kill switch, duplicate orders, retry state before ANY order
- Startup Safety Check: validate broker vs DB positions on startup
- get_option_chain caching: cache per underlying+expiry for duration of single enter() call
- Native mobile app (iOS/Android) — Phase 4
- **FVB-1**: Flow Visual Strategy Builder — React Flow node editor replacing AlgoPage form
- **PRC-1**: PRACTIX DB isolation — separate schema/DB for paper trading, ₹1Cr virtual capital

### Dropped Items
- Telegram Bot — mobile app is superior for this use case, already integrated

### Live Trading Plan
- Phase 1: Mom's Angel One account (after Monday testing)
- Phase 2: Wife's account — MCX only via Indicator Bots
- Phase 3: Zerodha — needs static IP (purchase from Zerodha or third party)
- Static IP: Angel One allows family mapping post 2-3 months (single IP for all AO accounts)
- Accounts for live: Zerodha (Karthik), Mom AO, Wife AO (MCX)

## CURRENT SYSTEM STATE (2026-04-02)

> **This section replaces all session logs below it. It reflects actual current state.**

---

### Execution Safety Layer — FULLY IMPLEMENTED
All checks run inside `_pre_execution_check()` in `algo_runner.py` BEFORE any order is placed.

| Check | Implementation | Status |
|-------|---------------|--------|
| Broker token loaded in runtime | `is_token_set()` on broker instance | ✅ Done |
| API key valid (not expired/AG8004) | `get_underlying_ltp()` returns 0 → blocks with `[PRE-CHECK]` log | ✅ Done |
| SmartStream active (W&T/ORB only) | Returns `is_waiting=True` → algo set to WAITING not ERROR | ✅ Done |
| Option chain available | Returns None → blocks entry, logs clearly | ✅ Done |
| Strike selection returns valid token | `leg.instrument_token` set after strike resolution | ✅ Done |
| `instrument_token` on AlgoLeg | Column exists (migration 0017), backfilled on startup | ✅ Done |
| DB healthy | `/api/v1/system/health` checks DB latency | ✅ Done |

**Log format for blocked executions:**
```
⚠️  [PRE-CHECK] Karthik AO API key invalid — AG8004 / expired session
[BLOCKED] Algo-3 entry blocked: TOKEN_INVALID
```

**Design note:** Non-W&T/ORB algos do NOT require SmartStream active — they use option chain LTP directly from broker API. This is intentional.

---

### Broker Token Injection — IMPLEMENTED
- On startup: `_ao_startup_auto_login()` in `main.py` logs into all AO accounts with valid TOTP
- Token stored in DB AND injected into runtime broker instance via `broker.load_token()`
- `client_id` and `api_key` backfilled to DB row on each successful login
- All routing uses `client_id` (not nickname) — `_CLIENT_ID_TO_BROKER_KEY` dict
- Zerodha routing uses `Account.broker == BrokerType.ZERODHA` (not hardcoded "Karthik")
- Startup prints account status summary:
```
=== Account Status (09:00:03 IST) ===
✅ Mom AO (KRAH1029) — token valid, feed_token ready
⚠️  Karthik AO — client_id not in .env (inactive)
⚠️  Wife AO — client_id not in .env (inactive)
❌ Zerodha — no token today
```

---

### SmartStream (Angel One WebSocket) — IMPLEMENTED
- Connects automatically after auto-login using fresh `feed_token`
- 7 tokens subscribed: NIFTY, BANKNIFTY, FINNIFTY, SENSEX, MIDCPNIFTY + GOLDM + SILVERMIC
- `_connected` flag: set True in `_on_open`, False in `_on_close`
- `_last_tick_at`: ISO timestamp updated on every tick in `_on_data`
- Root cause of past failures: stale MCX contract tokens (expired March 2026 contracts) → fixed
- Manual endpoints:
  - `GET /api/v1/system/smartstream/status` → connected, subscribed_tokens, mcx_tokens, last_tick_at
  - `POST /api/v1/system/smartstream/start` → start using first valid AO feed_token

---

### MCX Token Auto-Rotation — IMPLEMENTED
- `MCX_TOKENS` dict in `bot_runner.py` holds current contract tokens
- `refresh_mcx_tokens()` scans `instrument_master_cache.json`, picks nearest expiry ≥ today, skips within 2 days of expiry (`_MCX_ROLL_DAYS_BEFORE = 2`)
- Called: on startup in `load_bots()` + daily at 06:00 IST via scheduler
- `check_mcx_expiry_warnings()` on startup: logs warning if contract expires within 3 days
- MCX session guard in `bot_runner.on_tick()`: skips signal generation outside 09:00–11:30 / 15:30–23:30 IST
- MCX holiday list: `backend/app/core/mcx_holidays.py`

**Current tokens (2026-04-02):**
| Symbol | Token | Contract | Expiry |
|--------|-------|----------|--------|
| GOLDM | 487819 | GOLDM05MAY26FUT | May 5, 2026 |
| SILVERMIC | 466029 | SILVERMIC30APR26FUT | Apr 30, 2026 |
| GOLDM (next) | 491727 | GOLDM05JUN26FUT | Jun 5, 2026 |
| SILVERMIC (next) | 477177 | SILVERMIC30JUN26FUT | Jun 30, 2026 |

---

### Global MTM SL/TP — IMPLEMENTED (fixed 2026-04-01, was silently dead)
- `MTMMonitor` wired into `SLTPMonitor.on_tick()` — receives LTP on every tick
- `PositionMonitor` has `quantity` field for correct ₹ P&L
- `sl_tp_monitor.set_mtm_monitor(mtm_monitor)` called at startup in `main.py`
- Breach fires `exit_all()` — full algo exit
- Debug log: `[SLTPMON] tick {symbol}: ltp={ltp}, sl={sl_actual}, tp={tp_level}`

---

### W&T (Wait and Trade) — IMPLEMENTED
- When SmartStream not connected: algo set to `WAITING` not `ERROR`
- `_pre_execution_check()` returns 3-tuple `(ok, reason, is_waiting)`
- `_enter_with_db()` routes to `_set_waiting()` vs `_set_error()`
- Log: `⚠️  [W&T] SmartStream not connected — entry WAITING`

---

### ORB (Opening Range Breakout) — IMPLEMENTED (3 bugs fixed 2026-04-01)
- `_ORB_UNDERLYING_TOKENS` dict: NIFTY→99926000, BANKNIFTY→99926009, FINNIFTY→99926037, SENSEX→99919000, MIDCAPNIFTY→99926014
- MCX underlyings fall back to `MCX_TOKENS` (GOLDM→487819)
- `default_direction` reads from `legs[0].direction` (was AttributeError)
- `orb_start_time` reads from `algo.orb_start_time` (was hardcoded "09:15")
- ORB range stored per `grid_entry_id` (not global)

---

### Option Chain — IMPLEMENTED
- 60s TTL cache keyed by `(underlying, expiry)` — CE+PE share same cache
- Empty results never cached (retry gets fresh fetch)
- Eliminates double 209k-record master scan for straddle entries

---

### Execution Audit Log — IMPLEMENTED
All events logged to `execution_logs` table:
- `entry_attempt`, `entry_success`, `entry_failed`, `pre_check_failed`
- Exceptions before `ExecutionManager` also log `entry_failed`

---

### Indicator Bot Pipeline — IMPLEMENTED
```
SmartStream tick
  → ltp_consumer._process_ticks()
    → _bot_runner_tick() [registered in main.py]
      → bot_runner.on_tick()
        → MCX session guard (09:00–11:30 / 15:30–23:30 IST)
          → CandleAggregator.on_tick()
            → bar boundary hit → completed Candle
              → DTRStrategy.on_candle() / ChannelStrategy.on_candle()
                → Signal → bot_signals DB + WebSocket
```

**Endpoints:**
- `GET /api/v1/bots/ltp?symbol=GOLDM` — current LTP from Redis
- `GET /api/v1/bots/{bot_id}/candles?limit=5` — in-memory candles
- `POST /api/v1/bots/{bot_id}/fetch-daily-data` — manually load DTR daily pivots

**DTR fetch_daily_candles:** Fixed for MCX — passes `symbol_token` from `MCX_TOKENS` directly (instrument master lookup fails for MCX futures).

---

### Position Rebuilder — IMPLEMENTED
- `backfill_instrument_tokens()` on startup: fills NULL instrument_token on open orders using AO master
- After backfill: re-subscribes each resolved token to ltp_consumer

---

## ACTIVE ACCOUNTS (2026-04-02)

| Account | Broker | client_id | Status | Notes |
|---------|--------|-----------|--------|-------|
| Mom | Angel One | KRAH1029 | ✅ Fully operational | Auto-login + SmartStream |
| Wife | Angel One | KRAH1008 | ⚠️ Token loads | IP not whitelisted for server |
| Karthik AO | Angel One | PEAN1003 | ❌ AG8004 | Needs new SmartAPI app |
| Karthik | Zerodha | — | ❌ Manual | Needs static IP |

**Rule:** Only Mom's AO account is fully operational. Each AO account needs its own static IP whitelisted in SmartAPI portal.

---

## SERVER (13.202.164.243)

| Item | Value |
|------|-------|
| Instance | EC2 t3.small, ap-south-1 |
| Static IP | 13.202.164.243 (Elastic) |
| SSH | `ssh -i ~/.ssh/lifex-key.pem ubuntu@13.202.164.243` |
| Backend | uvicorn via systemd (`staax-backend.service`) |
| Frontend | nginx port 80, serving `~/staax/frontend/dist/` |
| DB | postgres:16-alpine Docker container (`staax_db`) |
| Migrations | 0001–0019 applied |
| Data | 4 accounts, 21 algos, 37 legs, 40 holidays |
| APP_ENV | production |

**Deploy command (run on server):**
```bash
cd ~/staax && git pull && cd backend && source venv/bin/activate && alembic upgrade head && sudo systemctl restart staax-backend && cd ../frontend && npm run build && sudo systemctl reload nginx
```

---

## MIGRATIONS

| # | Description | Status |
|---|-------------|--------|
| 0001–0009 | Initial schema | ✅ |
| 0010 | SEBI layer, strategy_type, execution_logs | ✅ |
| 0011 | orders.instrument_token | ✅ |
| 0012 | algo_legs.reentry_on_sl/tp | ✅ |
| 0013 | bot_signals | ✅ |
| 0014 | execution_log_v2 | ✅ |
| 0015 | order_latency | ✅ |
| 0016 | bots.is_practix (idempotent) | ✅ |
| 0017 | algo_legs.instrument_token | ✅ |
| 0018 | accounts.totp_secret, fy_margin; algos.recurring_days, is_live | ✅ |
| 0019 | Fix algos column types (recurring_days JSON, is_live bool) | ✅ |

---

## PENDING ITEMS (2026-04-02)

### 🔴 Critical
None.

### 🟠 High Priority
| # | Item | Notes |
|---|------|-------|
| H-1 | Test Mom Test-1 algo in PRACTIX mode | Deferred to Tuesday April 7 — NSE closed today |
| H-2 | Verify Channel strategy signals end-to-end | Pipeline wired, not verified |
| H-3 | DTR signal verification | Daily data works, signal output not verified |

### 🟡 Medium
| # | Item | Notes |
|---|------|-------|
| M-1 | Fix Zerodha UUID mismatch in export_seed_data.py | 2 algos missing on server |
| M-2 | Wife AO | Needs separate static IP |
| M-3 | Karthik AO | Needs new SmartAPI app with server IP |
| M-4 | Zerodha | Needs static IP |
| M-5 | Bot candle verification | Verify after 1 full timeframe boundary |

### 🎨 UI Backlog (deferred)
- Blue accent remnants (popups, algo chips, Orders page buttons)
- Account card left neon line
- Orders page buttons (RUN/RE/SYNC/SQ/T) styling
- Sparklines, ring blur, font inconsistency

---

## KEY FACTS

| Item | Value |
|------|-------|
| Local backend | port 8000 |
| Local frontend | port 3000 (npm run dev) |
| DB backup | `~/STAXX/backup_db.sh` |
| Local DB | Docker `staax_db`, TCP 127.0.0.1:5432 |
| NSE tokens | NIFTY=99926000, BANKNIFTY=99926009, FINNIFTY=99926037, SENSEX=99919000 |
| MCX exchange type | 5 (not NFO=2) |
| Instrument master | `backend/instrument_master_cache.json` |
| Git org | github.com/theboringtrader14 |
| Repos | staax, invex, budgex |

## Audit Findings — 2026-04-02

### Features That Are DEAD (not wired, not working)
These show in UI but do not execute:

| Feature | Status | Root Cause | Fix ETA |
|---------|--------|-----------|---------|
| TSL (Trailing SL) | ❌ Dead | AlgoLeg missing tsl_enabled/ttp_enabled columns | Next session |
| TTP (Trailing TP) | ❌ Dead | Same as above | Next session |
| Journey/child legs | ❌ Dead | journey_config read from wrong model (AlgoLeg instead of Algo) | Next session |
| Re-entry AT_ENTRY_PRICE | ❌ Dead | on_candle_close() never called | Next session |
| Re-entry AT_COST | ❌ Dead | Same as above | Next session |
| Account-level Global MTM SL/TP | ❌ Dead | register_global() never called in main.py | Fixed in this session |

### Indicator Bots — SIGNALS ONLY
BotRunner (_enter_trade) creates BotOrder DB records but
does NOT call order_placer.place(). Bot signals are
observation-only — no real orders are placed.
This is by design. Bots show signals in IndicatorsPage.

### Fixes Applied (2026-04-02 audit)
- main.py: _ao_startup_auto_login uses _connected not _running
- main.py: Global MTM SL/TP wired via register_global()
- algo_runner.py: broker_map None → hard block + error log
- algo_runner.py: _set_waiting() deregisters SL/TP monitors
- accounts.py: update_feed_token guard (skip if empty string)
- mtm_monitor.py: deregister_algo() to prevent memory leak
- bot_runner.py: Signal-only log + DTR 0-bots warning
- main.py: Startup log corrected (connecting not started)

## STAAX v5.0 — Brand Redesign (2026-04-02)

### New Design System
- **Primary:** #FF6B00 (--ox-radiant orange) + #CC4400 (--ox-ember dual-tone)
- **Background:** #0A0A0B (--bg-void pure black)
- **Fonts:** Syne 800 (display/headings) + JetBrains Mono (prices/data)
- **Cards:** Glass — rgba(22,22,25,0.72) + blur(20px) + 0.5px orange border
- **Ambient:** Fixed orange orbs with orbDrift animation
- **Semantic:** #22DD88 profit, #FF4444 loss, #4488FF signal, #FFD700 warning

### Pages Redesigned
All 8 pages + Layout shell (Sidebar, TopBar, Layout)

### Brand Reference Files
~/STAXX/staax/files/ — complete scaffold with components + CLAUDE_CODE_PROMPT.md
Use these as source of truth for any future UI work.

### Design Rules (enforce always)
- Background: #0A0A0B — never change
- Borders: always 0.5px (never 1px except 2px left accent)
- No blue (#00B0F0 / #38bdf8) anywhere — replaced with orange
- Animations: fadeUp 400ms entry, 220ms hover, spring easing

## Session Update — 2026-04-03

### LIFEX Platform Status
- LIFEX landing: lifex.in (local: localhost:3000)
  - INVEX module card → opens localhost:3001
  - Launch STAAX button removed
  - Enter LIFEX → /dashboard
- STAAX: localhost:3000 (orange brand v5.0) ✅
- INVEX: localhost:3001 (teal brand v1.0) ✅
  - Direct to /portfolio, no auth
  - 5 metric cards, holdings table, sector allocation, equity curve

### Smart Grid Redesign (in progress)
- Replacing table with per-algo horizontal cards
- Status strip (4px left bar), day pills, lot stepper
- Design reference: DashboardPage

### Pending
- Smart Grid card redesign (Claude Code in progress)
- Orders, Reports, Analytics, Indicators page polish
- INVEX: connect to live portfolio data
- Server deploy of v5.0 frontend

## Session Update — 2026-04-03

### LIFEX Platform Status
- LIFEX landing: lifex.in (local: localhost:3000)
  - INVEX module card → opens localhost:3001
  - Launch STAAX button removed
  - Enter LIFEX → /dashboard
- STAAX: localhost:3000 (orange brand v5.0) ✅
- INVEX: localhost:3001 (teal brand v1.0) ✅
  - Direct to /portfolio, no auth
  - 5 metric cards, holdings table, sector allocation, equity curve

### Smart Grid Redesign (in progress)
- Replacing table with per-algo horizontal cards
- Status strip (4px left bar), day pills, lot stepper
- Design reference: DashboardPage

### Pending
- Smart Grid card redesign (Claude Code in progress)
- Orders, Reports, Analytics, Indicators page polish
- INVEX: connect to live portfolio data
- Server deploy of v5.0 frontend

## Session Update — 2026-04-03 (Night)

### STAAX v5.0 — Pages Status
- Dashboard: ✅ Complete — orange brand, live data
- Smart Cards: ✅ Complete — algo cards, groups, tall buttons, portal dropdown
- AlgoPage: ✅ Complete — StaaxSelect, orange theme, cloud-fill
- Landing: ✅ Complete — cosmos background, roadmap, live status

### INVEX v1.0 — Pages Status  
- Portfolio: ✅ Complete — ₹46.8L live, Redis cache (instant load)
- SIP Engine: ✅ Live — sip_engine.py, scheduler 09:20 IST Mon-Fri, migration 0002 applied 2026-04-15, execute-now endpoint, Run Now button in UI
- Watchlist: ✅ Built (UI only, backend pending)
- IPO Bot: ✅ Placeholder
- Analysis: ✅ Placeholder

### INVEX Data Status
- Zerodha: ❌ Token expired — needs daily login in STAAX
- Angel One: ❌ API keys invalid — PDoWMhNz rejected
- Existing DB holdings: 37 stocks, 9 MF (from previous load)
- Redis cache: instant load from cached data ✅

### Pending Next Session
- STAAX: Orders page redesign
- STAAX: Reports page redesign  
- STAAX: Indicators page redesign
- INVEX: SIP backend wiring
- INVEX: Fix Angel One API keys for live data
- Server: Deploy all latest commits

## Session Update — 2026-04-04

### Commits This Session (STAAX)
- b1f2543: Backend SL-Limit SEBI compliance
- 80eb23e: Frontend UX overhaul (Orders/Grid/Dashboard/Reports) + Infra files
- 268a927: Domain rename → lifexos.co.in + VITE_INVEX_URL env var
- 0b00313: Batch 20 — SmartStream debug + recurring remove modal
- 1ba4095: Living Spec update

### Domain
- lifexos.co.in purchased from Namecheap — ₹99 yr1, ₹725/yr renewal
- DNS A records to add: @ staax invex api invex-api → 13.202.164.243
- nginx config ready at infra/nginx-lifex.conf
- SSL setup docs at infra/SSL_SETUP.md
- Add to frontend/.env.production: VITE_INVEX_URL=https://invex.lifexos.co.in

### Pages Status (STAAX v5.0)
- Dashboard ✅ — FY P&L + equity curve from /reports/equity-curve
- Smart Cards ✅ — instrument groups, expand, day pills, portal dropdown
- AlgoPage ✅ — StaaxSelect, orange, cloud-fill, no order type field
- Landing ✅ — cosmos, roadmap, live status, BUDGEX, lifexos.co.in URLs
- Orders ✅ — MON-FRI tabs, instrument groups, sparklines, stats strip
- Reports 🔄 — redesign in progress
- Indicators ⏳ — not started

### SEBI Compliance
- SL-Limit hardcoded in algo_runner.py (order_type = "SL")
- Angel One: STOPLOSS_LIMIT mapped in angelone.py
- Zerodha: ORDER_TYPE_SL mapped in zerodha.py
- Order Type removed from AlgoPage UI

### Next Session Priorities
1. DNS setup on Namecheap (add A records)
2. Server deploy: git pull + nginx + certbot + SSL
3. Reports page redesign completion
4. Indicators page redesign
5. INVEX SIP + Watchlist backend wiring
6. Mom Test-1 PRACTIX test (April 7 — next trading day)
7. Angel One API keys fix for INVEX

## Session Update — 2026-04-04 (Final)

### Commits This Session
- STAAX 6b01d78: Batch 24 — Analytics v5.0, FY utility getCurrentFY()
- STAAX 83b51c4: Batch 23 — Reports, Indicators, Accounts polish
- INVEX 433d1bb: Missing deps, alembic fix
- BUDGEX e39e89c: Initial backend scaffold (pushed to GitHub)

### Platform Status
- STAAX: All 9 pages done ✅ (Dashboard, Smart Cards, AlgoPage,
  Landing, Orders, Reports, Indicators, Accounts, Analytics)
- INVEX: Portfolio live ₹46.8L, all pages built ✅
- BUDGEX: Backend done, frontend in progress 🔄
- lifexos.co.in: All subdomains live with SSL ✅
- FY 2026-27: Now default across platform ✅
- AI Orb: Rule-based, free, on landing page ✅

### Monday April 7 CRITICAL
- Mom Test-1 PRACTIX test on NIFTY
- Check SmartStream at 09:15 IST
- Monitor backend logs for [AO-DEBUG]

### BUDGEX
- Color: #7C3AED purple
- Backend: ~/STAXX/budgex/backend/ (port 8002)
- Frontend: ~/STAXX/budgex/frontend/ (port 3002, in progress)
- Domain: budgex.lifexos.co.in (DNS added, nginx pending)
- Mobile: React Native, neumorphic dark design (future batch)

### Pending
- BUDGEX web frontend (Batch in progress)
- BUDGEX server nginx + SSL
- INVEX Angel One API keys fix
- INVEX SIP + Watchlist backend wiring
- Mom Test-1 April 7

## Session Final Update — 2026-04-05

### STAAX v5.0 — ALL PAGES COMPLETE ✅
Dashboard | Smart Cards | AlgoPage | Landing | Orders | Reports | Indicators | Accounts | Analytics

### Design System Applied Consistently:
- Orange h1 headers on all pages
- PRACTIX/LIVE chip matching Dashboard
- Cloud-fill glassmorphic cards throughout
- StaaxSelect with portal rendering (no overflow:hidden clipping)
- JetBrains Mono for all numbers
- Syne for all labels/headings
- FY 2026-27 as default (getCurrentFY() utility)
- No thick orange borders on card headers

### BUDGEX v0.1 ✅
- Backend: port 8002, budgex_db, 6 endpoints
- Frontend: port 3002, purple brand (#7C3AED), 6 pages
- Domain: budgex.lifexos.co.in (DNS live, nginx configured)
- GitHub: theboringtrader14/budgex (private)
- Status: local ✅, server pending GitHub PAT for private repo deploy

### Pending (Next Session)
- Server: Deploy BUDGEX (needs GitHub PAT for private repo)
- Server: git pull latest STAAX + INVEX and rebuild
- INVEX: Angel One API keys fix
- Mom Test-1: April 7 Monday 09:15 IST — CRITICAL
- BUDGEX: Voice expense capture testing
- Mobile app: React Native scaffold (separate repo lifex-mobile)

### Monday April 7 — Morning Checklist
1. Start all backends: staax (8000), invex (8001), budgex (8002)
2. Start Redis: docker start staax_redis
3. Start DB: docker start staax_db
4. Watch SmartStream logs at 09:15 for Mom AO connection
5. If SmartStream connects → PRACTIX test on NIFTY straddle
6. Monitor backend for [AO-DEBUG] errors

## Session Update — 2026-04-06

### STAAX Batch 27 — Audit Fixes + Replay/Sparkline

#### Commits This Session
- `39a5cee` — 5 CRITICAL audit fixes (AI imports, localStorage key, BrokerType enum, LandingPage health keys, AccountsPage pin→api_secret)
- `9fb6375` — reports.py FY default staleness fix (get_current_fy())
- `fd92ac8` — Replay crosshair bezier (bezierTForX binary search), sparkline P&L cumulative fix
- `7fe9284` — LIFEX AI: Gemma 4 lazy init, SVG avatar, UX polish
- `8a67ca0` — Batch 27b: replay date filter IST→UTC range boundary fix
- `76b7083` — lifex-mobile v0.3: mobile app design polish

#### Audit Report (AUDIT_REPORT.md)
- 40 issues audited: 5 CRITICAL, 15 HIGH, 12 MEDIUM, 8 LOW
- All 5 CRITICAL fixed this session
- HIGH/MEDIUM/LOW remain — see AUDIT_REPORT.md

#### Replay Equity Curve — Production-Ready
- Crosshair: continuous bezier tracking via binary search (bezierTForX, 20 iterations)
- Marker snaps exactly to bezier curve (analytical bezierY formula)
- Tooltip: foreignObject with edge-flip (left/right) logic
- Date filter: IST boundary → UTC range (ZoneInfo), reliable across PG versions
- Open leg pnl=None: skipped to prevent None arithmetic crash

#### Sparkline Fix
- Was: plotted [fillPrice, exitPrice] per leg → ↑↓↑↓ wavy wrong shape
- Now: cumulative realized P&L [0, leg1_pnl, leg1+leg2, ...]

#### Monday April 7 — CRITICAL
1. `docker start staax_redis staax_db`
2. Start all backends: staax (8000), invex (8001), budgex (8002)
3. Watch SmartStream at 09:15 for Mom AO connection
4. If Mom AO connects → test 1 PRACTIX paper trade NIFTY straddle
5. Monitor [AO-DEBUG] logs in backend

### Pending
- HIGH audit items from AUDIT_REPORT.md (orders WebSocket, algo runtime stubs, etc.)
- EAS Android build: `sudo npm install -g eas-cli && eas build --platform android --profile preview`
- INVEX Analysis tab (Fundamental + Technical)
- iOS simulator test
- Server: final deploy with Batch 27 changes

---

## Session Update — 2026-04-07

### Commits This Session
- d669dcd: HIGH audit — triggerNow, updateCredentials, ROI calc, Gemma-first, services stop
- 88220e4: STAAX audit — AIAgentPage token key, IndicatorsPage localhost, ai_agent settings
- b2739fa: system.py today filter fix
- ec96a61: lifex-mobile — 9 criticals + voice flow

### Infrastructure
- All 3 backends systemd enabled (survive reboots) ✅
- Daily Angel One auto-login cron 08:45 IST weekdays ✅
- budgex_db created on server ✅
- All 5 domains 200 OK ✅

### Platform Status
- System READY from mobile browser ✅
- Mom AO token valid ✅
- LIFEX AI Gemma 4 responding ✅
- Mobile app voice flow implemented ✅
- All CRITICAL + HIGH audit items resolved ✅

### Remaining
- MEDIUM + LOW audit items (STAAX + Mobile)
- INVEX Analysis tab data wiring
- EAS Android build
- SmartStream test (market hours)
- Three.js avatar (Option B)

## Session Update — 2026-04-08 (Live Trading Day 1)

### First PRACTIX Trade ✅
NF-STBT NIFTY Straddle:
CE SELL @372 → Exit @420.10 = -₹48.10
PE SELL @381.8 → Exit @276.15 = +₹105.65
NET: +₹57.55 | Auto-sq at 15:00 IST ✅

### Commits This Session
- 95e8ae0: P0 engine fixes (W&T token, premium selector,
  BTST exits, ORB recovery, underlying_token migration)
- 0b9627c: SQ/T/RE/SYNC buttons production-ready,
  RUN button removed, P1 fixes

### P0 Engine Bugs Fixed (8 total)
All critical engine bugs resolved — platform ready
for proper PRACTIX testing tomorrow.

### Button Status
SQ ✅ | T ✅ | RE ✅ | SYNC ✅ | RUN 🗑️ removed

### Issues Found During Live Session
- S-STBT not showing WAITING (fixed: auto-grid on startup)
- SmartStream health chip stale (fixed: _running fallback)
- LTP not updating (fixed: 1s polling with auth headers)
- Next Algo card empty (fixed: reads from algos list)
- Orders page no WAITING cards (fixed: new WAITING section)

### Pending Next Session
- Karthik AO + Wife AO API keys (regenerate from portal)
- INVEX Analysis tab real data (Phase 2 Screener.in)
- BUDGEX audit (not done yet)
- P2 bug: ExecutionManager.square_off() kwarg mismatch
  (surfaced during PRACTIX SQ — needs fix for LIVE mode)
- TSL/TTP testing in PRACTIX
- W&T testing now that token fix is deployed
- Premium selector testing (NF-BTST picked wrong strike,
  fix is deployed — verify tomorrow)
- ORB algo testing (fix deployed — verify tomorrow)

### Monday April 13 — Next Live Session
All PRACTIX algos to test:
NF-STBT ✅ (tested today) | S-STBT | S-WIDE
NF-INT (W&T fixed) | NF-BTST (premium fixed)
BNF-BTST | BNF-ORB (ORB fixed)

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

## Session Update — 2026-04-09

### Commits
- 2d1fc58: Critical safety — underlying entry_price,
  NSE holidays, kill switch, base_lot_multiplier, TOTP retry
- 0b9627c: SQ/T/RE/SYNC buttons production-ready
- 54f5a78: LIFEX AI natural voice, conversational prompt
- b895f96: Living Spec EOD April 8

### LIFEX AI Improvements
- Natural voice: Neural → Google en-IN → Samantha priority
- Sentence chunking with 100ms gaps between sentences
- Conversational prompt: 2-3 sentences, warm tone, ₹ symbol
- No markdown/bullets in responses (optimized for speech)

### Platform Status
STAAX: All pages ✅ | All buttons ✅ | Engine P0+P1 fixed ✅
Critical safety fixes deployed ✅
PRACTIX tested: NF-STBT +₹57.55 ✅

## Session Update — 2026-04-09 (Final)

### Trade Replay — Complete Enhancement
- Brownian bridge synthetic MTM (realistic wavy curves)
- Per-leg toggle buttons with glow
- Scrubber synced to progress line
- Timeline deduplication
- cloud-fill modal background
- 4-stat cards: Duration, Total P&L, Peak P&L, Max Drawdown
- Angel One 1-min candle data (precise) with fallback

### FINEX v0.1 — Live
finex.lifexos.co.in ✅
finex-api.lifexos.co.in ✅
DNS: finex + finex-api A records added

### BUDGEX — Complete Revamp
6 pages: Dashboard, Expenses, Budget (new),
Analytics, Subscriptions, Accounts
Budget model + Gemma AI insights

### LIFEX Master Plan
Saved to ~/STAXX/staax/LIFEX_MASTER_PLAN.md
7 modules: STAAX, INVEX, BUDGEX, FINEX, NETEX, GOALEX + Mobile

### Pending Next Session
1. FINEX: wire real data (STAAX + INVEX + BUDGEX APIs)
2. LIFEX Score computation
3. Daily Briefing cron at 08:30 IST
4. NETEX: net worth engine + AURUM data migration
5. GOALEX: goals & FI planning
6. EAS Android build
7. INVEX Analysis Phase 2 (Screener.in)


## 25 Mar 2026 — Session 2 Summary

### Completed

#### Journey fix (critical)
- journey_config was on Algo model but engine read from AlgoLeg — Journey never fired in production
- Fixed: journey_config column added to AlgoLeg, migration 0013, _build_leg() now saves it
- Journey child placement now appears in System Log as [JOURNEY]

#### RE-SL / RE-TP engine wiring
- reentry_on_sl / reentry_on_tp were stored but never checked in reentry_engine.on_exit()
- Fixed: SL exit skips re-entry if reentry_on_sl=False; TP exit skips if reentry_on_tp=False
- Legacy path preserved: if both False, fires on any exit (backward compatible)

#### Strike Selector fixes
- MCX GOLDM futures: completely broken (wrong multiple, wrong expiry, empty chain) — fixed via _select_mcx_futures() with FUTCOM filter and nearest expiry logic
- Expiry day trading: algos can now trade on expiry day until 15:20 IST (was blocked all day)
- Premium strike: now picks closest strike >= target (was picking closest regardless)
- Straddle premium: search window expanded from ±2 to ±5 strikes

#### DTE Positional
- dte column was saved but never consumed — dead field
- Fixed: _resolve_expiry() now resolves DTE to Nth upcoming monthly expiry when strategy_mode=positional

#### System Log completeness
- [RETRY] / [RETRY_FAILED]: order retry queue attempts now visible
- [RUN] [SQ] [SYNC] [TERMINATE]: all manual button actions now in System Log
- [JOURNEY]: child leg placements visible
- [FEED_ERROR] prefix on SmartStream WAITING events

### Mobile Push Notifications (Phase 2 — after AWS deployment)
All events flow to event_log. FCM integration planned for:
- Critical: [ERROR], [RETRY_FAILED], [TERMINATE], [SL_HIT], [FEED_ERROR]
- Important: [ENTRY], [EXIT], [TP_HIT], [ENTRY_MISSED]
- Info (toggleable): [RETRY], [SQ], [SYNC], [JOURNEY]

### Known Gaps (deferred)
- Premium strike sequential LTP calls slow for large chains (optimization later)
- Journey trigger (SL only / TP only / any) — currently hardcoded to "any"
- Strike_value / strike_offset not supported in Journey child legs
- ExecutionMode brainstorm (support not restrict) — design session pending


## 09 Apr 2026 — Session Summary

### Completed

#### Execution philosophy — support not restrict
- exit_on_margin_error wired in engine (was stored but never read)
- Platform now has two user-controlled error behaviours per algo:
  exit_on_margin_error: True = exit all on margin error, False = skip leg and continue
  exit_on_entry_failure: True = exit all on any entry fail, False = continue other legs

#### Unified button row on Orders page
- All algo cards now show: RE | SYNC | SQ | T | RETRY ALGO
- Enable/disable driven by consistent state matrix (not ad-hoc conditions)
- RETRY ALGO: new amber button, fires full algo re-entry from scratch
  Enabled: allLegsError, missed, no_trade, waiting-past-entry
  Disabled: ORB window passed, closed, terminated
- mapGroup() helper centralises group serialisation — eliminates triple duplication

#### grid_entry_id, entry_type, orb_end_time in orders API response
- Frontend can now correctly gate RETRY ALGO for ORB algos

### Pending
- ExecutionMode design session (support not restrict — remaining items)
- Journey trigger (SL only / TP only) — hardcoded to "any"
- INVEX Phase 2 SIP Engine
- AWS deployment + static IP for Wife and Karthik AO accounts
- Mobile push notifications via FCM (Phase 2)
- Google AI API key issue in Claude Code (.env path mismatch)


## 09 Apr 2026 — Session 3 Summary

### Completed

#### Grid Day Pill — Smart Removal Logic
- BLOCK + DEFER: active/open/waiting/algo_closed-today shows confirmation modal
- "Remove future weeks" → POST /algos/{id}/schedule-removal queues day
- Scheduler job at 00:01 IST auto-removes pending_day_removals from recurring_days
- ALLOW immediately: algo_closed on past days, no_trade, error, future days
- PATCH /algos/{id}/recurring-days — safe endpoint, no destructive leg recreation

#### Indicator Bots — Dedup + TradingView Webhook
- BotSignal unique constraint on (bot_id, signal_type, direction, candle_timestamp)
- bot_runner seeds _last_signal from DB on startup — dedup survives restarts
- POST /bots/webhook/tradingview — webhook with TRADINGVIEW_WEBHOOK_SECRET validation
- Manual signal API now returns 409 on duplicate

#### Analytics Failures Tab
- /reports/errors rewritten to query event_log (system_events) not orders table
- Filters by: [ERROR] [MARGIN_ERROR] [TOKEN_ERROR] [RETRY_FAILED] [ENTRY_MISSED] [FEED_ERROR]
- Analytics gauge truncation fixed (overflow: visible)

#### Journey Engine
- SyntheticLeg now reads wt_enabled/direction/value/unit from child config
- Algo-level exits (mtm_sl, mtm_tp, global_sl, auto_sq) skip child firing
- REPLAY button restored — 6-button row: RE | SYNC | SQ | T | RETRY | REPLAY

### Pending
- BUDGEX living spec review (~/STAXX/budgex/BUDGEX_LIVING_SPEC.md)
- LIFEX_MASTER_PLAN.md review
- INVEX Phase 2 SIP backend wiring
- Angel One API keys for INVEX (expired)
- Wife + Karthik AO static IP registration
- Mobile push notifications via FCM (Phase 2)
- FINEX data wiring (STAAX + INVEX + BUDGEX APIs)

## 09 Apr 2026 — Session 4 Updates

### Fixed This Session
- Grid day pill PATCH endpoint 404 — backend restart required for new route to register. Now working ✅
- Logs double /api/v1/ prefix — GridPage.tsx line 246 fixed: '/api/v1/logs/' → '/logs/'
- INVEX zerodha_loader reads token from staax_db not invex_db (separate connection, same host)
- Analytics Failures tab — /reports/errors now queries event_log (system_events) not orders table
- Analytics gauge truncation — overflow: visible fix on Health Scores card
- exit_on_margin_error wired in engine
- Orders unified 6-button row: RE | SYNC | SQ | T | RETRY | REPLAY
- Journey SyntheticLeg W&T fields wired from child config
- Journey algo-level exits (mtm_sl, mtm_tp, global_sl, auto_sq) skip child firing
- Grid day pill smart removal: BLOCK+DEFER modal for active days, ALLOW immediately for safe days
- Bots dedup: DB-level unique constraint + startup seed from DB
- TradingView webhook endpoint added: POST /bots/webhook/tradingview
- Migrations 0024 (pending_day_removals) + 0025 (bot_signal dedup) applied

### Known Issues
- Karthik AO + Wife AO: Invalid API Key — need new SmartAPI apps with server IP 13.202.164.243
- INVEX Angel One API keys expired — need portal regeneration
- SmartStream _on_open — verify tomorrow morning after Mom auto-login

### Commits
- 5e807bb: Grid day pill, bots dedup, analytics errors, journey fixes
- Plus logs fix + INVEX zerodha fix (commit these now)


## 10 Apr 2026 — Session Summary

### Completed

#### Mobile Responsive — STAAX Web
- Bottom navigation bar added (Layout.tsx) — fixed at bottom on mobile, hidden on desktop
  6 tabs: Dashboard, Smart Grid, Orders, Reports, Bots, Accounts
  Orange accent on active tab, safe-area-inset padding for iOS
- Smart Cards page: horizontal swipe carousel on mobile
  algo-cards-container → flex-direction: row, overflow-x: auto, scroll-snap
  Each card: 300px wide, vertical stack inside, scrollable day pills, wrapped action buttons
- Orders page: horizontal scroll table (overflow:hidden parents changed to overflow:visible)
  table.staax-table min-width: 900px, scrolls inside orders-table-wrapper
  All 11 columns retained — no hidden columns
- Topbar: IST clock hidden on mobile (.topbar-clock display:none at ≤768px)
- LandingPage module cards: now clickable, navigate to correct module URLs
- nginx: staax.lifexos.co.in now has dedicated server block (separate from lifexos.co.in)
  Routes to /home/ubuntu/staax/frontend/dist with SPA fallback

#### Push Notifications (Mobile)
- iOS push token registered: ExponentPushToken[ED0WidAQwUYvC94-ohZiUq]
- Backend push_sender.py wired to algo_runner.py on SL/TP/entry/error/missed events
- Android: needs new EAS build (prod URL config fix not in current APK)

#### Start Session Button (Mobile)
- STAAX tab in LIFEX mobile app has START button
- Taps auto-login Mom AO + starts market feed
- Shows STARTING... → ACTIVE states

### Commits
- 697e138: Mobile responsive v1 (initial)
- 84864c3: Horizontal carousel, orders scroll, bottom nav, topbar compact
- 080c842: LandingPage module cards clickable
- nginx: staax.lifexos.co.in dedicated block (server-side change)

### Pending
- Android EAS build with production URLs
- Android push token registration
- Apple Developer account for iOS standalone build
- INVEX SIP backend wiring
- INVEX Angel One API keys regeneration
- FINEX data wiring


## Batch 21-22 — 14 April 2026

### Batch 21 — Completed

- Recurring grid entries: migration 0025, `recurring_days` JSON on Algo, auto-create weekly entries
- Soft delete on algos: `is_archived` flag, algos hidden from UI but data retained
- SmartStream confirmed working — `_on_open` log was normal, not a bug
- Notifications use algo name not UUID — display now human-readable
- NSE holiday guard in scheduler — skips auto-entry on exchange holidays
- RESL/RETP columns added: `reentry_on_sl`, `reentry_on_tp`, `reentry_max` on AlgoLeg
- `reentry_enabled` / `reentry_mode` dropped — migration 0026
- Dashboard stars 50% opacity fix
- Analytics Failures tab fix — queries event_log not orders table
- Health Score gauge fix — overflow: visible
- Grid error badge hidden when collapsed
- Missed algo full card restored
- Accounts padding fix

### Batch 22 — Completed

**Dashboard 8 fixes:**
1. Karthik AO removed from dashboard (was showing despite no live session)
2. Re-Login button logic fixed — only shown when token expired, hidden when already live
3. Stat cards equal width — CSS grid repeat(4, 1fr)
4. Market Context merged card — combined Market/VIX/Session into single glass card
5. System Log dedup — `dedupeLog()` function prevents duplicate entries
6. Kill Switch separator added — visual divider in control panel
7. Label consistency pass across cards
8. (Subsumed in fix 4)

**Backend additions:**
- Migration 0027: `reentry_type`, `reentry_ltp_mode` on AlgoLeg; `reentry_count`, `reentry_type_used` on Order
- Migration 0028: `scope` (fo/mcx) on Account
- Migration 0029: `pinescript_code` (Text) on Bot
- `reentry_engine.py` full rewrite: RE-ENTRY (price-watcher, same strike, LTP/candle-close mode, TSL two-step interaction) + RE-EXECUTE (immediate, fresh strike); gates: count < max, time < exit_time, no kill switch
- Account deactivate/reactivate endpoints: `PATCH /accounts/{id}/deactivate` + `/reactivate`
- `/metrics` endpoint: added `avg_day_pnl`, `max_drawdown`, `roi` per algo
- New `analytics.py`: `GET /api/v1/analytics/advanced-metrics` (Sharpe Ratio, Max Drawdown, Days to Recovery, Max/Min Win/Loss Streak, Total Trading Days)
- Bot `PATCH /bots/{id}/pinescript` endpoint for saving PineScript code per bot

**Frontend additions:**
- `AccountsPage.tsx`: scope dropdown (F&O / MCX) in Add Account modal; Deactivate/Reactivate buttons with confirmation modal
- `AnalyticsPage.tsx`: Advanced Metrics glass card (6-metric grid: Sharpe, MDD, Recovery, Win/Loss Streak, Trading Days)
- `IndicatorsPage.tsx`: per-bot PineScript textarea + save button; `BotSignalLog` collapsible per-bot
- `ReportsPage.tsx`: METRIC_ROWS extended with avg_day_pnl, max_drawdown, roi
- `OrdersPage.tsx`: amber RE-ENTRY ×N / RE-EXECUTE ×N pill tags in LegRow
- `AlgoPage.tsx`: unified re-entry sub-row replacing separate resl/retp toggles (Type: Re-Entry / Re-Execute, Watch Mode: LTP / Candle Close, On SL, On TP, Max)

### Infrastructure Notes

**Active live account:** Mom Angel One only. Karthik AO + Wife AO API keys expired — need new SmartAPI apps registered with server IP `13.202.164.243`.

**Pending migrations (created, not yet run):** 0027 → 0028 → 0029 (chain from 0026).

### Re-entry Engine Spec (Finalised)

| Mode | Trigger | Strike | Price Watch |
|------|---------|--------|-------------|
| RE-ENTRY | SL or TP hit | Same as original | Watches LTP or candle_close until price retraces to fill_price (± W&T offset). TSL two-step: if TSL was trailing, first wait for LTP to touch `sl_original` before watching trigger. |
| RE-EXECUTE | SL or TP hit | Fresh strike selection | Immediate — no price watch. Fires `enter()` with `reentry=False`. |

Gates (both modes): `reentry_count < reentry_max`, `current_time < exit_time`, kill switch inactive.

### Backlog

- Groups A–E follow-up: deeper account management, reports drill-down, analytics filters, bot management
- n8n automation integration
- Backtesting module (Phase 2)
- Position reconciliation chip in Orders
- Android EAS build with production URLs
- INVEX SIP backend wiring + Angel One API key regeneration
- FINEX data wiring (STAAX + INVEX + BUDGEX APIs)

## Session Update — 2026-04-15 (Batch 23/24)

### STAAX Backend
- FK violation fix: PUT /algos/{id} now updates legs in-place (never deletes)
  - `is_archived` column added to AlgoLeg (migration 0030 applied)
  - `LegCreate.id` optional field — frontend passes backend UUID to enable in-place match
  - PUT: match by id → UPDATE, new → INSERT, missing → archive (is_archived=True)
  - Filtered from all GET responses
- Backend restart required to pick up new code (was failing until process restart)
- [ALGO-SAVE] error logging with full exception on PUT handler
- STBT/BTST: next_day_exit_time now correctly wired through frontend → backend → scheduler
- W&T engine: LTP availability check with 5s retry loop before monitoring begins

### STAAX Frontend (AlgoPage.tsx)
- TIME_MIN/MAX format fixed: '09:15:00' → '09:15' (was causing false validation failures)
- STBT exit range check skipped for STBT/BTST strategies
- validate() now has console.error instrumentation via fail() helper
- nextDayExitTime state added; Exit Time field routes to correct state per strategy
- buildPayload(): delay fields now use correct backend field names
  (entry_delay_buy/sell_secs, exit_delay_buy/sell_secs — not entry_delay_seconds)
- Extra leg fields removed (opt_type, tsl_enabled, ttp_enabled not in LegCreate schema)
- catch block improved: shows status code + parses Pydantic detail array
- Entry Type & Timing + MTM Controls merged into single row with vertical separator
- Exit Time label: STBT/BTST shows ⚠ symbol with hover tooltip (no chip below)
- MTM Controls: labels added above Unit/MTM SL/MTM TP matching Entry Time style
- Direct/ORB chips height fixed to 32px to match TimeInput
- leg backendId stored and sent in PUT payload to enable in-place update

### STAAX Frontend (GridPage.tsx)
- Algo card: xt (exit time) now shows next_day_exit_time for STBT/BTST strategies
- ⚠ tooltip indicator on exit time for STBT/BTST

### INVEX Phase 2 — SIP Engine (committed 59b445a)
- sip_engine.py: NSE LTP fetch, Zerodha/Angel order placement, NSE holiday guard
- Scheduler: _scheduled_sip_run at 09:20 IST Mon-Fri in main.py
- Migration 0002: last_executed_at column on invex_sips (applied)
- POST /sips/execute-now: manual trigger endpoint
- Frontend: Run Now button + Last Run field in SIPCard
- sipsAPI.executeNow() added to api.ts
- Angel One order placement guarded (API keys currently expired)

### BUDGEX — Confirmed Live
- Both subdomains live: budgex.lifexos.co.in + budgex-api.lifexos.co.in
- No deployment work needed — already running on server

### n8n Automation
- Container: staax_n8n on port 5678, Asia/Kolkata timezone, auto-restart
- 3 workflows created (all inactive — activate manually):
  1. Angel One Auto-Login (08:45 IST) — id: itzEGvulzNGr2RAe
  2. Zerodha Token Reminder (08:50 IST) — id: Lbq2Hnh0sN2pFmPo  
  3. EOD P&L Summary (15:35 IST) — id: 3IOdIX8pQW2RDZ2o
- Expo push token: reads from push_tokens.json (populated by mobile register-push)
- URL: http://localhost:5678 | admin@staax.local / Staax@2024

### Brand Corrections (canonical, enforce always)
- Primary color: #FF6B00 orange (NOT #00B0F0 cyan — that was old spec error)
- Background: #0A0A0B (NOT #2A2C2E — that was old spec error)
- LIFEX AI uses Gemma 4 (gemma-4-31b-it) — NOT Claude API
- ElevenLabs TTS for LIFEX AI voice output (confirmed direction)


## Session Update — 2026-04-15 (Batch 25)

### STAAX Core Fixes

- `system.py` active_algos: counts `is_active=True AND is_archived=False` algos (was counting today's orders → always showed 0)
- `system.py` open_positions: removed `created_at >= today` filter (was excluding overnight STBT positions)
- `orders.py` `GET /orders/position-check`: new endpoint → `{total_open, reconciled, message}`
- `OrdersPage.tsx` reconciliation chip in header: calls `/orders/position-check`, shows ✓ Synced (green) or ⚠ N open (amber)
- `api.ts` `ordersAPI.positionCheck()` added
- Debug log removal: removed stray `print()` from backend

### INVEX — Watchlist Live Prices
- `watchlist.py` `GET /watchlist/prices`: NSE session-seeded httpx fetch, 30s Redis cache, per-symbol null on failure
- `WatchlistPage.tsx`: live LTP/change in teal #00C9A7, Refresh button
- `api.ts` `watchlistAPI.getPrices()` added

### BUDGEX — Endpoint Audit + Gemma 4 Analytics
- `analytics.py` rewritten: fetches 30d expenses by category → Gemma 4 prompt → `{insights: [...]}`, rule-based fallback when GOOGLE_AI_API_KEY missing
- `AnalyticsPage.tsx`: reads `insights` array (was `insight` string), renders bullet list

### LIFEX Mobile — Error Banners (all 5 screens)
- All 5 screens (index, portfolio, trading, budget, ai): styled error banners `View+Text` with `rgba(255,68,68,0.12)` background + `#FF4444` border/text

### FINEX Scaffold (new module)
- Backend: port 8003, `GET /api/v1/score` stub (72/100 with breakdown), `GET /api/v1/networth` (April 2026 static baseline + live INVEX equity + STAAX trading capital)
- Frontend: port 3003, SVG gauge for LIFEX Score, three breakdown rows, Net Worth card with breakdown tiles
- Brand color: #F59E0B amber (distinct from STAAX orange and INVEX teal)

### n8n Workflow Fix
- PUT /rest/workflows/{id} returns 404 in n8n v2.16.1 — fixed to use PATCH
- Login credentials corrected: theboringtrader14@gmail.com / Staax@2024 (not admin@staax.local)

### Commits
- Backend+Frontend Batch 25 (hash TBD): all above changes

---

## Session Update — 2026-04-15 (Batch 26) — ORB Phase 2 + Re-entry Split

### New AlgoLeg Columns (migration 0032)
```
orb_range_source   String(15)  — "underlying" | "instrument"
orb_entry_at       String(5)   — "high" | "low"
orb_sl_type        String(30)  — ORB or standard sl_type values
orb_tp_type        String(30)  — ORB or standard tp_type values
orb_buffer_value   Float       — buffer magnitude
orb_buffer_unit    String(5)   — "pts" | "pct"
reentry_max_sl     Integer     default 0
reentry_max_tp     Integer     default 0
```
`reentry_max` KEPT (not dropped — backward compat). `is_archived` was added in 0030.

### New AlgoState Columns (migration 0032)
```
orb_high           Float       — persisted from _make_orb_callback
orb_low            Float       — persisted from _make_orb_callback
sl_reentry_count   Integer     default 0
tp_reentry_count   Integer     default 0
```
`reentry_count` kept and synced to `sl_count + tp_count`.

### Migration Chain
0029 → 0030 (is_archived on AlgoLeg) → 0032 (ORB Phase 2 + reentry split). **0031 does NOT exist.**

### Engine Changes
- `orb_tracker.py`: `orb_range_source` field added to ORBWindow dataclass
- `algo_runner.py register_orb()`: entry direction from `orb_entry_at`; instrument pre-selection with conservative fallback (log warning + fall back to underlying on failure); persists `orb_high`/`orb_low` to AlgoState
- `algo_runner.py _place_single_leg()`: full ORB SL/TP calculation — 5 variants each: `orb_high`, `orb_low`, `orb_range`, `orb_range_plus_pts`, `orb_range_minus_pts`
- `reentry_engine.py`: `_SL_EXIT_REASONS` + `_TP_EXIT_REASONS` frozensets; Gate 2 split into `sl_reentry_count`/`tp_reentry_count`; `exit_reason` param threaded through `_do_re_execute` and `_watch_and_re_enter`

### API Changes (algos.py)
- `LegCreate`: all 8 new optional fields added
- `_leg_to_dict()`, `_build_leg()`, `_update_leg_fields()`: all updated

### Frontend Changes (AlgoPage.tsx)
- Leg vals interface: `orb` sub-object (entryAt, slType, tpType, bufferValue, bufferUnit), `reentry.maxSl` + `reentry.maxTp` split
- `orbRangeSource` state: Range Source toggle (Underlying / Instrument) in ORB config section
- Per-leg Entry At toggle: ORB High (BUY) / ORB Low (SELL) when `entryType === 'orb'`
- ORB SL/TP: 9-option dropdowns with buffer inputs when range±pts selected
- `buildPayload()`: sends all ORB fields; excludes `sl_type`/`sl_value` for ORB algos; sends `reentry_max = Math.max(maxSl, maxTp)` for backward compat
- `validate()`: wraps sl/tp value checks in `if (entryType !== 'orb')` guard

### Frontend Changes (OrdersPage.tsx)
- `AlgoGroup` interface: `orbHigh?: number | null`, `orbLow?: number | null`
- `mapGroup()`: adds `orbHigh`, `orbLow`
- `LegRow` ENTRY/REF cell: 3 ORB display branches — (1) waiting with range locked (shows H/L/Range), (2) waiting range not yet locked, (3) open ORB leg shows levels in muted text

### Migrations Run
- `alembic upgrade head` applied 0032 locally ✅
- `npm run build` zero TypeScript errors ✅

### Commits
- Backend Batch 26: `f17b224` — feat: Batch 26 — ORB Phase 2 (range source, entry_at, ORB SL/TP), re-entry max split
- Frontend Batch 26: `89e93a7` — feat: Batch 26 — ORB UI config section, re-entry separate max counts

---

## Session Update — 2026-04-15 (Batch 27) — TT Bands, LIVE Bot Orders, Signal Reason, Algo Duplicate

### New Files
- `backend/app/engine/indicators/tt_bands_strategy.py` — fractal HIGH/LOW detection (bar[-3] with 5-bar window), rolling mean of last `lookback` fractals → highline/lowline; crossover above highline → BUY (`TT_CROSS_HIGH`), crossunder below lowline → EXIT/SELL (`TT_CROSS_LOW`); `lookback` default 5; `long_only=True` default

### Backend Changes

**bot_runner.py**
- `_init_bot()`: new `elif bot.indicator == IndicatorType.TT_BANDS` branch → `TTBandsStrategy(timeframe_mins, lookback=bot.tt_lookback or 5, long_only=True)`
- `_enter_trade()`: LIVE mode (when `not bot.is_practix` and `_order_placer` wired) calls `order_placer.place()` with `exchange=MCX`, `broker_type=angelone`, `symbol_token` from MCX_TOKENS; saves `broker_order_id` to BotOrder
- `_exit_trade()`: same LIVE mode branch for closing order (direction=SELL)
- `_save_signal()`: persists `signal.reason` to BotSignal.reason column

**models/bot.py**
- `BotSignal`: added `reason = Column(String(50), nullable=True)` — stores strategy reason string (e.g. `CHANNEL_LONG`, `TT_CROSS_HIGH`)

**bots.py (API)**
- `_signal_dict()`: includes `"reason": s.reason` in response

**algos.py**
- `POST /algos/{algo_id}/duplicate` — deep-copies Algo + all non-archived AlgoLeg rows; `name = f"{name} (Copy)"`, `recurring_days = []`, `is_live = False`; returns full `_algo_to_dict()` response

**migration 0033** — `reason` column on `bot_signals` (down_revision=0032)
- Chain: 0029 → 0030 → 0032 → 0033
- Applied locally: `Running upgrade 0032 -> 0033`

### Frontend Changes

**IndicatorsPage.tsx**
- **Prod URL bug fixed** (line 7): `'https://api.lifexos.co.in'` → `'http://localhost:8000'` — all bot API calls now hit localhost in dev
- `PerBotSignal` interface: added `reason: string | null`
- `BotSignalLog` signal row: direction chip with colour coding (BUY=#22DD88, SELL=#FF4444, EXIT=#FFB300), `signal_type` label, `reason` mono tag, status pill with full colour set (filled/failed/skipped/fired), error message on next line indented

**api.ts**
- `algosAPI.duplicate(id)` → `POST /algos/{id}/duplicate`

**GridPage.tsx**
- `duplicateAlgo()` handler: calls `algosAPI.duplicate()` then `loadData()`
- COPY button added to algo card action bar (orange, copy icon, between Archive and Remove)

### Migrations Run
- `alembic upgrade head` applied 0033 locally ✅
- `npm run build` zero TypeScript errors ✅

### Commits
- Backend Batch 27: `da56f31` — feat: Batch 27 — TT Bands strategy, LIVE bot orders, signal reason, algo duplicate (backend)
- Frontend Batch 27: `d2ebb1b` — feat: Batch 27 — prod URL fix, signal log UI, algo duplicate button (frontend)

---

## Session Update — 2026-04-15 (Batch 28) — Orders/Signals UI, Holiday Endpoint, n8n Guards, EC2 Deploy

### Backend Changes (STAAX)

**bots.py**
- `GET /bots/orders` — global orders endpoint; joins BotOrder + Bot → returns bot_name, is_practix, instrument, entry_time; newest first; fixes 405 on the old per-bot-only pattern
- `list_bot_orders` per-bot endpoint — bug fix: `o.status.value` → `o.status or "open"` (status is String, not Enum)

**holidays.py**
- `GET /holidays/today-is-holiday` — checks today IST date against MarketHoliday fo segment; returns `{"is_holiday": bool, "name": str|null}` for n8n holiday guard

### Frontend Changes (STAAX)

**IndicatorsPage.tsx — Signals tab**
- `BotSignal` type: added `reason: string | null`
- Direction cells: chips with coloured bg (BUY=#22DD88, SELL=#FF4444, EXIT=#FFB300 when signal_type=exit)
- Time: `HH:MM:SS` format (added `second: '2-digit'`)
- Added Reason column: mono tag pill; `—` when absent
- colSpan 7 → 8

**IndicatorsPage.tsx — Orders tab**
- `BotOrder` type: added `bot_name`, `is_practix`, `instrument`, `entry_time`
- `AggOrder = BotOrder` (removed per-bot N-call aggregator)
- Single `botsAPI.orders()` call replaces per-bot loop
- Table columns: Time (IST HH:MM) | Bot + PRACTIX/LIVE badge | Symbol | Dir chip | Lots | Entry ₹ | Exit ₹ | P&L | Status — 9 columns

**AlgoPage.tsx**
- Line 970 parent flex row: `alignItems: 'flex-start'` → `alignItems: 'stretch'`
- Entry Type & Timing container (line 972): added `height: '100%'`
- MTM Controls container (line 1033): added `height: '100%'`

**api.ts**
- `botsAPI.orders()` → `GET /bots/orders` (global all-bots orders)
- `botsAPI.botOrders(id)` → `GET /bots/{id}/orders` (renamed from duplicate `orders`)

### n8n Workflows — Holiday Guard (all 3)
Added to each workflow: Schedule Trigger → HTTP GET `/holidays/today-is-holiday` → IF is_holiday → true: stop / false: continue to original first node
- Angel One Auto-Login: Schedule → Holiday Check → Is Holiday? → false → Auto-Login Request
- Zerodha Token Reminder: Schedule → Holiday Check → Is Holiday? → false → Check Token
- EOD P&L Summary: Schedule → Holiday Check → Is Holiday? → false → Fetch Stats

### BUDGEX
- `analytics.py`: added 3-line comment block at top documenting `GOOGLE_AI_API_KEY` requirement
- Fallback (no key): returns `_build_fallback_insights()` — 3 rule-based sentences from real DB data
- `GOOGLE_AI_API_KEY` added to EC2 BUDGEX `.env` by Karthik ✅

### EC2 Deploy — 2026-04-15

**DB Backup:** `~/backup_staax_20260415_2015.sql` (177K) ✅

**STAAX** (migrations 0025→0033 applied):
- 0026: drop reentry_enabled/mode | 0027: reentry_type/ltp_mode | 0028: account scope
- 0029: bot pinescript | 0030: algo_leg is_archived | 0032: ORB Phase 2 | 0033: bot_signal reason
- Frontend built ✅ | `systemctl restart staax-backend` ✅
- Health: `ready:True | db:True | env:production` ✅

**INVEX:**
- git pull ✅ | migrations already at head | frontend built ✅ | `systemctl restart invex-backend` ✅
- Health: `{"status":"ok","service":"invex"}` ✅

**BUDGEX:**
- git pull ✅ | no alembic (no migrations) | frontend built ✅ | `systemctl restart budgex-backend` ✅
- Health: `{"status":"ok","service":"budgex","version":"2.0.0"}` ✅

**Task 4 — Start Session on EC2:**
- `POST /services/start-all` returns: PostgreSQL: running, Redis: running, Backend API: running, Market Feed: running ✅
- Market Feed auto-picked Mom's active AO token; no subprocess calls in services.py ✅

### Commits
- STAAX backend: `bff9c42` — feat: Batch 28 — global bot orders endpoint, holiday check endpoint
- STAAX frontend: `ed41f87` — feat: Batch 28 — signals tab improvements, orders tab, AlgoPage height fix
- BUDGEX: `4f91120` — docs: GOOGLE_AI_API_KEY requirement comment

---

## PENDING (as of 2026-04-15)

### Business Actions Required
- Karthik AO + Wife AO: new SmartAPI apps with server IP 13.202.164.243 (token expired)
- INVEX: Angel One API keys expired — regenerate from portal for all 3 accounts
- n8n: update push tokens once mobile app registers (POST /api/v1/mobile/register-push)
- Android EAS build: new build needed with prod URLs
- Apple Developer account: needed for iOS TestFlight / App Store

### STAAX ORB — Verify Next Session
- Test ORB algo with `orb_entry_at` = "high" → confirm BUY fires on ORB High breakout
- Test `orb_range_source` = "instrument" → confirm instrument pre-selected at window open with fallback
- Test `orb_sl_type` = "orb_low" → confirm SL set to ORB low level
- Verify `orb_high`/`orb_low` appear in Orders page for ORB waiting legs

---

## Session Notes — 15 April 2026 (Batch 28 Post-Fixes)

### Completed this session

**GridPage.tsx — Card layout fixed-width columns**
- Card body gap `20px → 16px`, padding `20px 24px → 16px 20px`
- All columns now fixed width (no `flex:1` fluid): Name `120px` | Strategy+chip `100px` | Entry/Exit time `90px` | Lot multiplier `90px` (marginLeft 12px) | Day pills `252px` (marginLeft 12px)
- Removes uneven spacing between algo cards regardless of content length

**IndicatorsPage.tsx — Orders tab live P&L**
- `ltpMap` state + 5s polling interval (`ltpTimerRef`) fetches `/bots/ltp?symbol=X` for each unique open instrument
- P&L cell: `(ltp − entry_price) × lots`, green if ≥0, red if <0, "LIVE" badge in 8px text
- TIME column: added date (`day:'2-digit', month:'short'`) — was time-only

**IndicatorsPage.tsx — Signals tab layout**
- Fired At column moved to first position, `whiteSpace:'nowrap'`, year added to format
- Column padding refined: Bot+Signal `20px`, Instrument+Trigger `32px`, Dir+Reason `10px`, Status `20px`
- Tab persistence: `useState` reads `localStorage.getItem('indicatorsTab')` on mount; click writes back

**Backend bot_runner.py — Four engine fixes**
- **FIX 3 (MCX session reset):** `_in_session` flag — on OFF→ON transition, replace all `CandleAggregator` instances (entry-TF and channel-TF) with fresh ones to avoid spurious signals from stale bars
- **FIX A (channel_strategy.py):** `on_candle(candle, channel_candles=None)` — accepts optional external candles list for two-TF architecture; computes `upper`/`lower` from `channel_candles` when provided
- **FIX B (bot_runner.py):** `_channel_aggregators: Dict[str, Any]` — separate `CandleAggregator` per bot for channel TF; fed every tick in parallel with entry-TF aggregator; completed channel candles passed as `channel_candles=` to `strategy.on_candle()`
- **FIX C (bot_runner.py):** `_last_signal` override after seeding — if `_positions[bot_id]` is open but `_last_signal == "exit:sell"` (from prior session DB signal), reset to `"entry:buy"` to prevent exit dedup blocking next exit
- **FIX D (bot_runner.py):** `await self.load_daily_data()` called at end of `load_bots()` — DTR levels now set at startup, not only at 09:00 IST scheduler; fixes DTR bots generating zero signals after any restart after market open

### Bot Test Matrix (as of session end)
| Bot | TF | Channel TF | Issue | Fix Applied |
|-----|----|-----------|-------|-------------|
| Test 1 — DTR 3h | 180min | — | No signals (daily data null at startup) | FIX D |
| Test 2 — Channel 240×1 | 45min | 240min | Wrong channel (used 45min instead of 240min) | FIX B |
| Test 3 — Channel 60×7 | 15min | 60min | Wrong channel (used 15min instead of 60min) | FIX B |

### Pending (start of next session)
- Monitor first signals from Test 1 (18:00 IST, first 3h bar), Test 2 (19:30 IST, first 4h bar), Test 3 (needs 7×60min bars)
- Verify channel levels match TradingView reference for Test 2 and Test 3
- Journey child leg config not saving (UI-3 above) — investigate `journey_config` JSON in AlgoLeg update
- Journey trigger selector (§25a) — implement after Journey config bug fixed

### Key file locations
- Bot runner: `backend/app/engine/bot_runner.py`
- Channel strategy: `backend/app/engine/indicators/channel_strategy.py`
- Indicators page: `frontend/src/pages/IndicatorsPage.tsx`
- Grid page: `frontend/src/pages/GridPage.tsx`

---

## Session Update — 2026-04-16 (Batch 29) — MissingGreenlet Root Cause + Retry Reliability + UI Polish

### Root Cause: MissingGreenlet (P0)

The true root cause was **NOT** the scheduler sync wrapper. The full chain:
1. `_place_leg()` called `self._ltp_consumer.get_ltp(wt_underlying_token)` — method did not exist
2. `AttributeError` raised inside the try block
3. `except` block accessed `leg.leg_number` on an ORM object that had already been **expired by `await db.rollback()`**
4. SQLAlchemy lazy-load triggered synchronously without greenlet context → `MissingGreenlet`

### Fixes Applied

**`ltp_consumer.py`**
- Added `self._ltp_map: Dict[int, float] = {}` populated in `_process_ticks` on every tick
- Added `get_ltp(self, token: int) -> float` — sync lookup from in-memory map, returns 0.0 if unseen

**`algo_runner.py`**
- Captured `leg_number = leg.leg_number` as a plain Python `int` **before** the `try` block in the legs loop in `_enter_with_db` — all `except` references use this captured value, never touch the expired ORM object
- Added `enter_specific_legs(grid_entry_id, leg_ids)` — re-places only specified legs (by AlgoLeg UUID); does NOT transition AlgoState (caller already sets to ACTIVE); used by the retry-legs endpoint

**`scheduler.py`**
- `recover_today_jobs()` WHERE clause extended to include `AlgoRunStatus.ERROR`
- ERROR algos with `entry_time` in future: reset to WAITING, clear `error_message` + `closed_at`, set `grid_entry.status = ALGO_ACTIVE`, register `_job_entry`
- ERROR/WAITING algos with `entry_time` in past: mark NO_TRADE immediately

**`orders.py` (API)**
- `_parse_date()` default: `date.today()` → `datetime.now(ZoneInfo("Asia/Kolkata")).date()` — fixes wrong date after midnight UTC on server
- Retry endpoint: cancels `entry_expiry_{grid_entry_id}` APScheduler job before firing `enter()` — prevents stale expiry from marking algo NO_TRADE right after manual retry resets to WAITING
- New `POST /orders/{grid_entry_id}/retry-legs`: validates all specified leg_ids are in ERROR state, resets AlgoState to ACTIVE, sets `grid_entry.status = OPEN`, fires `enter_specific_legs()` via `run_coroutine_threadsafe`

**`grid.py` (API)**
- New `PATCH /grid/{entry_id}/cancel`: validates state is WAITING or ERROR (400 otherwise), sets AlgoState → NO_TRADE, sets GridEntry → NO_TRADE, removes `entry_{id}` and `entry_expiry_{id}` APScheduler jobs

### Frontend Changes

**`OrdersPage.tsx`**
- **RE-RUN button removed** from both order cards (BTNS array) and waiting cards (missedBtns array)
- **Unified smart RETRY**: if all legs ERROR or algo is NO_TRADE → `retryEntry` (full re-run); if some legs ERROR → opens partial retry modal; modal confirm calls `retryLegs`
- **Past-day filter**: `l.fillPrice != null` condition extended to also require `l.status === 'open' || l.status === 'closed'` — prevents errored-but-unfilled legs from making historic days appear as traded
- **Empty state** message now includes day name (e.g. "No trades executed on Wednesday, 16 Apr.")

**`GridPage.tsx`**
- WAITING, ALGO_ACTIVE, and ERROR pills: on hover, show a `×` overlay (dark background, red ×)
- Clicking `×` calls `window.confirm()` then `PATCH /grid/{entry_id}/cancel` — marks run as NO_TRADE without touching recurring_days
- Existing defer modal still fires for OPEN/ORDER_PENDING/today-ALGO_CLOSED when pill is clicked normally

**`api.ts`**
- `ordersAPI.retryLegs(gridEntryId, legIds)` → `POST /orders/{id}/retry-legs`
- `gridAPI.cancel(entryId)` → `PATCH /grid/{id}/cancel`

### Commits
- `505fa44` — backend: ltp_consumer, algo_runner, scheduler, orders, grid
- `ed2be09` — frontend: OrdersPage, GridPage, api.ts

---

## 32. RETRY Rules — Entry Type Behaviour

RETRY re-enters an algo that missed its original entry window (MISSED) or errored during entry (ERROR). The behaviour at re-entry differs by entry type.

### RETRY eligibility

| Condition | RETRY allowed? |
|-----------|---------------|
| `algo_state_status == 'error'` | ✅ Yes |
| `algo_state_status == 'no_trade' AND error_message present` | ✅ Yes (engine error caused NO_TRADE) |
| `is_missed == True` (NO_TRADE + activated_at + no error) | ✅ Yes |
| ORB algo + current IST time ≥ orb_end_time | ❌ No — ORB window passed; button shows "ORB ✕" greyed |
| Any other state | ❌ No |

### Behaviour by entry_type

| entry_type | Strike selection at RETRY | Reference price | Notes |
|------------|--------------------------|-----------------|-------|
| **direct** | Fresh ATM/OTM/ITM selection from current option chain | Current LTP | Same as original entry, just at current market levels |
| **orb** | Only if within ORB window (entry_time ≤ now < orb_end_time); else RETRY disabled | ORB high/low recaptured | If orb_end_time has passed, RETRY button is greyed with "ORB ✕" label |
| **wt** (W&T legs) | W&T trigger re-armed; strike + ref price captured fresh at trigger fire | Current underlying LTP when W&T fires | Info line shown: "⚡ Will re-capture strike and ref price at current market levels" |
| **stbt/btst** | Treated same as `direct` for retry purposes | Current LTP | Overnight legs — retry only valid same session day |

### Frontend display rules (OrdersPage waiting card)

- Row 1: `[algo name] [account pill] [ERROR|MISSED|WAITING chip] ... [Entry HH:MM]`
- Row 2: Full error/missed detail (no truncation)
  - ERROR: full `error_message` or `latest_error.reason`
  - MISSED: `⏭ Missed entry at HH:MM`
  - ORB window passed: `ORB window passed (HH:MM) — RETRY disabled` (dim grey italic)
  - W&T legs: `⚡ Will re-capture strike and ref price at current market levels` (light blue)

### Backend RETRY endpoint

`POST /orders/{grid_entry_id}/retry` — calls `enter_specific_legs()` with all legs (full re-entry). The scheduler re-registers the entry job with immediate trigger. Cancels any stale expiry APScheduler job before re-arming.

`POST /orders/{grid_entry_id}/retry-legs` — partial retry for specific leg IDs only.

### ORB window passed detection

Frontend: `isOrbWindowPast = isOrbAlgo && orb_end_time && (IST.hours*60 + IST.minutes) >= (HH*60 + MM)`

The `orb_end_time` field is returned by `/waiting` as `"HH:MM"` (truncated from `"HH:MM:SS"` stored in DB).

