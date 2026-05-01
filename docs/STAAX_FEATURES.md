# STAAX Feature Inventory

**Generated:** 2026-05-01  
**Codebase:** `frontend/src/` (React 18 + TypeScript + Vite)  
**Backend:** FastAPI, base URL `/api/v1`  
**Design system:** Neumorphic — `var(--neu-raised)`, `var(--neu-inset)`, `var(--neu-raised-sm)` CSS variables

---

## Table of Contents

1. [GridPage — Algos](#gridpage--algos)
2. [OrdersPage](#orderspage)
3. [AlgoPage — New / Edit Algo](#algopage--new--edit-algo)
4. [ReportsPage](#reportspage)
5. [AnalyticsPage](#analyticspage)
   - [Performance Tab](#performance-tab)
   - [Failures Tab](#failures-tab)
   - [Slippage Tab](#slippage-tab)
   - [Latency Tab](#latency-tab)
6. [IndicatorsPage — Bots](#indicatorspage--bots)
7. [AccountsDrawer](#accountsdrawer)
8. [DashboardPanel](#dashboardpanel)
9. [Key Components](#key-components)
   - [AlgoAIAssistant](#algoaiassistant)
   - [AlgoDetailModal](#algodetailmodal)
   - [Layout & TopNav](#layout--topnav)

---

## GridPage — Algos

**Route:** `/grid`  
**File:** `frontend/src/pages/GridPage.tsx`

### Purpose

The primary algo scheduling grid. Shows all active algos for the current week, allows toggling which weekdays each algo runs (recurring schedule), adjusting lot multipliers, and launching algos into practix (paper) or live mode.

### Key Features & UI Elements

- **Algo cards** — one card per algo, grouped by primary underlying instrument (NIFTY, BANKNIFTY, SENSEX, MIDCAPNIFTY, FINNIFTY, OTHER). Groups are collapsible with a sticky header that follows scroll.
- **Day pills (M T W T F S S)** — seven circular buttons per algo. Pressing a pill toggles that day in the algo's recurring schedule. Active days are inset (pressed). A teal pulsing dot on a pill means the algo is in Watch-and-Trade (W&T) monitoring for that day.
- **Lot multiplier stepper** — `−` / `N×` / `+` inline stepper per algo card. Updates the `lot_multiplier` on the current-week grid entry immediately via API. Today's multiplier is shown by default.
- **Status KPI cards (6 + 1 bar chart)** — fixed row above the scroll list showing counts for: Buy Only, Sell Only, Buy & Sell, Intraday, STBT/BTST, Positional. Clicking a card applies that filter. A "By Index" mini bar chart shows algo count per underlying.
- **Archive panel** — toggled by the Archive button in the header (persisted to localStorage). Shows all archived algos as chips with a Reactivate button.
- **Filters** — Account filter dropdown (StaaxSelect) + stat-category filter via the KPI cards.
- **Mode separation** — in Practix mode only `is_live=false` algos are visible; in Live mode only `is_live=true` algos are visible.
- **Entry/exit time display** — Play/Stop icons with HH:MM times. STBT/BTST algos show an amber warning icon beside exit time because the exit is on the next trading day.

### Action Buttons (per card)

| Icon | Action |
|---|---|
| Sparkle (AI) | Opens AlgoAIAssistant in edit mode pre-loaded with this algo |
| Lightning | Promote to Live (Practix mode) / Demote to Practix (Live mode) |
| Archive | Opens archive confirmation modal |
| Copy | Duplicates the algo (`POST /algos/{id}/duplicate`) |
| Trash | Also opens archive confirmation modal |

### Modals

- **Archive confirm** — confirms archiving; warns if algo has active positions this week.
- **Cancel run confirm** — marks a specific day's grid entry as NO_TRADE.
- **Defer removal modal** — if trying to remove a day that is currently active (open/pending/waiting), offers "Yes, future only" which schedules the removal for after midnight via `POST /algos/{id}/schedule-removal`.

### Data Sources

| API | Purpose |
|---|---|
| `GET /algos/?include_archived=true` | Load all algos |
| `GET /grid/?week_start=&week_end=&is_practix=&account_id=` | Load week grid entries |
| `POST /grid/` | Deploy algo to a day |
| `PUT /grid/{entryId}` | Update multiplier |
| `PATCH /grid/{entryId}/cancel` | Cancel a day's run |
| `PATCH /algos/{id}/recurring-days` | Toggle day on/off |
| `POST /algos/{id}/schedule-removal` | Deferred day removal |
| `POST /algos/{id}/promote` / `demote` | Promote/demote to live |
| `POST /algos/{id}/archive` / `unarchive` | Archive management |
| `POST /algos/{id}/duplicate` | Duplicate |
| `POST /grid/activate-now` | Force mid-day activation |
| `GET /accounts/` | Load accounts for AI assistant |

### Notable Interactions

- Auto-fills recurring days on Practix mode if missing grid entries (background on load, shows success toast).
- Clicking an algo name navigates to `/algo/{id}` (edit mode).
- Sticky instrument group header is rendered as an absolutely-positioned overlay to avoid compositor z-index issues.

---

## OrdersPage

**Route:** `/orders`  
**File:** `frontend/src/pages/OrdersPage.tsx`

### Purpose

Live and historical order monitor. Shows all legs (individual option/futures orders) for every algo grouped by algo, for a selected trading date. Supports week navigation, real-time LTP polling, manual interventions (square off, retry), and exit price corrections.

### Key Features & UI Elements

- **Date tabs (week bar)** — M T W T F day pills at the top showing each weekday's ISO date. Active day is highlighted. Holiday dates are shown with a CalendarX icon. Weekend toggle shows SAT/SUN when needed.
- **Week navigation** — `◀` / `▶` arrow buttons to navigate to previous/next weeks. Defaults to Monday of historical weeks.
- **Waiting / Scheduled section** — appears above the orders table for the current day; shows algos in WAITING, MONITORING (W&T), SCHEDULED, MISSED, or ERROR states. Each waiting algo shows leg details including W&T thresholds and ORB high/low.
- **Algo group cards** — one expandable card per algo with:
  - Left-edge colored status bar (green=OPEN, gray=CLOSED, red=ERROR, amber=PENDING/WAITING).
  - Algo name, account, MTM P&L, MTM SL/TP thresholds.
  - Inline status message (e.g., "Square-off sent").
  - Smoothed SVG sparkline for closed-leg P&L curve with animated live dot during market hours.
  - Collapsed/expanded leg table.
- **Leg table columns** — Level · Status · Symbol · Lots · Entry (fill price + W&T ref or ORB range) · LTP · SL · Target · Exit · Exit Reason · P&L.
- **Status chips** — color-coded: OPEN (green), CLOSED (gray), WAITING (amber), W&T (teal), SCHED (blue), MISSED (amber), ERROR (red).
- **SL display** — shows `sl_actual` (engine-set price level) and the SL definition type (e.g., `I-50pts`, `TSL-30pt`). TSL shows original anchor → current level.
- **Exit price correction** — clicking the exit price on a closed leg opens an inline input. Saves via `PATCH /orders/{id}/exit-price`.
- **SL warning banner** — inline amber warning with a "Retry SL" button when an SL order placement failed. Button is disabled outside market hours.
- **Re-entry counter** — amber badge on the leg row showing `RE-ENTRY ×N` or `RE-EXECUTE ×N`.
- **SYNC badge** — shown when reconcile_status is set on a leg.
- **Account filter** — StaaxSelect dropdown to filter by account.
- **Status filter chips** — filter by OPEN / CLOSED / ERROR / WAITING.
- **Week summary stats** — fetched from `GET /orders/week-summary`; shown in the header area.

### Per-Algo Action Buttons

| Button | Action |
|---|---|
| Square Off | Opens modal with selectable legs → `POST /orders/{id}/square-off` |
| Retry | Opens retry modal for error legs → `POST /orders/{entryId}/retry-legs` |
| Terminate | Sends `POST /algos/{id}/terminate` |
| Broker Sync | Opens sync form (broker_order_id + account_id) → `POST /orders/{algoId}/sync` |
| Broadcast | Triggers the waiting retry → `POST /orders/{entryId}/retry` |

### Data Sources

| API | Purpose |
|---|---|
| `GET /orders/?trading_date=&is_practix=` | Load orders for a date |
| `GET /orders/waiting?trading_date=&is_practix=` | Load waiting/scheduled algos |
| `GET /orders/ltp` | Poll live LTP for open positions |
| `GET /orders/week-summary` | Week-level P&L summary |
| `PATCH /orders/{id}/exit-price` | Correct exit price |
| `POST /orders/{id}/square-off` | Manual square off |
| `POST /orders/{entryId}/retry` | Retry entry |
| `POST /orders/{entryId}/retry-legs` | Retry specific legs |
| `POST /orders/{algoId}/sync` | Sync with broker order |
| `POST /algos/{id}/terminate` | Terminate algo |
| `POST /api/v1/orders/{orderId}/retry-sl` | Retry failed SL placement |
| `GET /accounts/` | Account list for filter |
| `GET /holidays/` | Holiday calendar |
| `GET /system/health` | Market hours check |
| WebSocket `ws://.../orders/ws/live` | Real-time order updates |

---

## AlgoPage — New / Edit Algo

**Route:** `/algo/new` (create) · `/algo/:id` (edit)  
**File:** `frontend/src/pages/AlgoPage.tsx`

### Purpose

Full algo configuration form. Handles both creating new algos and editing existing ones. Accepts AI-generated configurations via router state (`location.state.aiConfig`).

### Key Features & UI Elements

**Header section:**
- Algo name input, account selector (StaaxSelect), strategy mode (Intraday / STBT / BTST / Positional).
- Entry type: Direct or ORB (Opening Range Breakout). ORB mode changes SL/TP options on leg rows.
- Entry time, exit time (or next-day exit time for STBT/BTST).
- MTM SL / MTM TP fields with unit selector (points / INR / percentage).
- Order type selector.
- Day-of-week recurring schedule chips.
- Lock icon shows if algo is deployed/active (prevents accidental edits).

**Leg builder:**
- Add Leg button creates a new leg row with default values.
- Each leg row has: instrument type toggle (OP/FU), instrument code selector (NF/BN/SX/MN/FN), direction toggle (BUY/SELL), option type toggle (CE/PE), expiry selector, strike mode (Strike / Premium / Straddle), strike type (ITM1–ITM10, ATM, OTM1–OTM10), lot count input.
- Drag-to-reorder (drag handle `⠿`), copy leg, remove leg buttons.
- Leg feature chip row: SL · TSL · TP · TTP · W&T · RE. Each chip is a toggle; TSL requires SL to be enabled, TTP requires TP.
- Feature value panel appears below each leg when features are enabled, showing the appropriate inputs (type + value for SL/TP, X→Y for TSL/TTP, direction + value + unit for W&T, type + trigger checkboxes for Re-entry).

**ORB mode per leg:**
- Entry At selector: ORB High (BUY) or ORB Low (SELL).
- SL and TP dropdowns show ORB-specific options: ORB Low, ORB High, ORB Range, Range±pts.

**Journey (child leg) panel:**
- Expandable per leg. Supports up to 4 levels deep (L1 child, L2 grandchild, L3 great-grandchild).
- Each level has its own full instrument + feature configuration.
- Trigger selector gates which exit of the parent fires the child: SL Hit / TP Hit / Either. Auto-resets if parent SL/TP becomes unavailable.

**AI Assistant integration:**
- Sparkle button opens AlgoAIAssistant in a slide-up overlay. On completion the AI config is applied to the form fields.

**Save / Cancel:**
- Save Algo button: `POST /algos/` (new) or `PUT /algos/{id}` (edit).
- Plays a success sound on save.
- Cancel navigates back to `/grid`.

### Data Sources

| API | Purpose |
|---|---|
| `GET /algos/{id}` | Load existing algo for edit |
| `POST /algos/` | Create new algo |
| `PUT /algos/{id}` | Update existing algo |
| `GET /accounts/` | Account list for selector |

---

## ReportsPage

**Route:** `/reports`  
**File:** `frontend/src/pages/ReportsPage.tsx`

### Purpose

Historical performance reports with a P&L calendar heatmap, FY summary KPIs, algo-level metrics table, and equity curve. Supports CSV/Excel export.

### Key Features & UI Elements

**Header KPIs (4-column grid):**
- **FY Total P&L** — large number + mini equity curve area chart (AreaChart from Recharts). Clicking opens the full equity curve modal.
- **Total Trades** — count + number of algos.
- **Win Rate** — percentage with green/red color coding.
- **Day-of-Week P&L bar chart** — mini bar chart showing Mon–Fri cumulative P&L.

**FY calendar heatmap:**
- 12 mini-calendar cards (one per month, Apr–Mar FY layout).
- Each calendar shows weekday trading days as colored squares: green (profit) for positive days, red (loss) for negative, intensity proportional to magnitude. Clicking a month card opens a larger month detail modal.
- Win/loss day progress bar at top of each card. Month P&L shown in k notation.

**Metrics filter bar:**
- Toggle chips: FY / Month / Date / Custom range.
- Corresponding selectors appear: FY selector, month dropdown (last 24 months), date picker inputs.

**Algo metrics table:**
- Columns: Algo Name · P&L · Wins · Losses · Win% · Loss% · Max Profit · Max Loss · Trades · Avg Day P&L · Max Drawdown · ROI%.
- Clicking an algo name opens AlgoDetailModal.
- Sortable columns.

**Export:**
- CSV and Excel buttons (two report types: algo metrics or day-wise logs).
- Download via `GET /reports/download` with `format=csv|excel` and `report_type=algo|daywise`. File is downloaded as a blob.

**Equity curve modal:**
- Full-page modal with larger Recharts AreaChart of cumulative P&L over the FY.

### Data Sources

| API | Purpose |
|---|---|
| `GET /reports/metrics` | Algo-level P&L metrics |
| `GET /reports/calendar` | Daily P&L data for calendar |
| `GET /reports/equity-curve` | Cumulative P&L time series |
| `GET /reports/download` | CSV/Excel export (blob) |

---

## AnalyticsPage

**Route:** `/analytics`  
**File:** `frontend/src/pages/AnalyticsPage.tsx`

### Purpose

Deep-dive analytics with four tabs. FY selector in the header applies to all tabs. Tab selection is persisted to localStorage.

**Tab bar:** sliding neumorphic pill indicator over four tabs: Performance · Failures · Slippage · Latency.

### Performance Tab

#### Purpose
Comprehensive algo performance overview for the selected FY.

#### Advanced Metrics Row (6 cards)
- **Trading Days** — total trading days in the FY.
- **Sharpe Ratio** — color-coded: green >1, amber 0–1, red <0.
- **Max Drawdown** — absolute INR value, plus recovery time in days (or "Ongoing").
- **Streak** — split card showing max win streak (days) and max loss streak (days).
- **Best Time** — mini bar chart of hourly P&L/trade performance showing which hour slots are most profitable.

#### Summary Cards Row (6 cards)
Best Algo · Worst Algo · Best Score · Avg Score · Most Consistent · Needs Attention. Cards are clickable to open AlgoDetailModal.

#### Cumulative P&L Chart
AreaChart of cumulative P&L over time. Green fill if positive, red if negative. Only renders when 2+ data points are available.

#### P&L Heatmap / Health Scores toggle
- **P&L Heatmap** — table with algos as rows and weekdays (Mon–Fri, weekend toggle available) as columns. Cells are colored squares with green/red intensity proportional to P&L magnitude. FY Total column on the right. Hovering shows tooltip with P&L + trade count.
- **Health Scores** — sortable table with columns: Algo · Grade (A/B/C/D chip) · Score (progress bar + number) · Trades · Win% · P&L. Score uses a red→amber→green gradient bar.

#### Strategy Type Breakdown
Table showing Intraday / STBT / BTST / Positional breakdown: Orders · Total P&L · Avg P&L · Win Rate (progress bar).

**Data sources:** `GET /reports/metrics`, `GET /orders/`, `GET /algos/`, `GET /reports/day-breakdown`, `GET /reports/health-scores`, `GET /reports/time-heatmap`, `GET /reports/strategy-breakdown`, `GET /analytics/advanced-metrics`.

---

### Failures Tab

#### Purpose
Error analysis — how many orders fail, which algos fail most, and what the error messages are.

#### Summary Cards (4)
Total Errors · CLOSED + ERROR Orders (of N closed) · Most Failed Algo · Algos with Errors.

#### Errors per Algo Table
Columns: Algo · Errors · Last Error Msg (truncated with tooltip) · Date/Time. Scrollable up to 480px.

**Data source:** `GET /reports/errors?fy=&is_practix=`.

---

### Slippage Tab

#### Purpose
Measures execution quality — how far actual fill prices deviate from expected SL/target prices on exits, and from market price on entries.

#### Summary Cards (4)
Avg Exit Slippage (pts) · Exit Orders with SL (count) · Best Trade (pts) · Worst Trade (pts).

#### Exit Slippage Table
Per-algo: Orders · Avg Slip (pts) · Total Impact (INR) · Best (pts) · Worst (pts).  
Info tooltip explains: positive = filled better than SL (good), negative = filled worse (adverse).

#### Entry Slippage Table
Same columns for market entry fills vs. reference price.

#### Slippage Trend Line Chart
Dual line chart (Recharts LineChart): Exit Slip (teal solid) and Entry Slip (orange dashed) over time. Reference line at 0.

**Data source:** `GET /reports/slippage?fy=&is_practix=`.

---

### Latency Tab

#### Purpose
Order execution timing analysis — measures time from signal to broker fill confirmation.

#### Summary Cards (4)
Orders with Timing (of N closed) · Avg Latency (ms, color-coded) · Fast Orders % (<150ms) · Success Rate %.

#### Latency Distribution
Four horizontal progress bars: Excellent <150ms · Good 150–250ms · Acceptable 250–400ms · Slow >400ms. Each shows count and percentage.

#### By Broker Table
Columns: Broker · Avg · P50 · P99 · Fast% · Orders. All timing values are color-coded by latency bucket.

#### By Algo Table
Columns: Algo · Avg (ms) · Orders · Bar (proportional progress bar).

#### Recent Orders Table
Time · Symbol · Broker · Latency (ms, color-coded) · Status.

**Data source:** `GET /reports/latency?fy=&is_practix=`.

---

## IndicatorsPage — Bots

**Route:** `/indicators`  
**File:** `frontend/src/pages/IndicatorsPage.tsx`

### Purpose

Algo-bot management for MCX commodity futures (GOLDM, SILVERMIC). Bots use indicator-based strategies (DTR, Channel, TT Bands) and trade automatically based on signals. Also called "Bots" page internally.

### Key Features & UI Elements

**Bot cards** — one neumorphic card per bot showing: name, instrument, indicator, timeframe, account, status chip, lot size. Collapsible to show the BotChart component.

**BotChart** — embedded Recharts ComposedChart displaying OHLC-style price data with indicator overlays (reference lines, reference dots for signals). Renders only when bot has order history.

**Create Bot wizard (BotConfigurator modal)** — 5-step flow:
1. Instrument (GOLDM or SILVERMIC)
2. Indicator (DTR Strategy / Channel Strategy / TT Bands Strategy)
3. Timeframe (15 / 30 / 45 / 60 / 120 / 180 min)
4. Parameters (indicator-specific: Channel TF + Candles for Channel, LookBack for TT Bands)
5. Config (bot name, account, lot size)

**Edit Bot modal** — inline edits to name, account, timeframe, lots, and indicator-specific parameters.

**Archive / Delete** — confirm modals before archiving or permanently deleting a bot.

**Bot orders section** — table below the bot list showing recent orders from bots: bot name, instrument, direction (BUY/SELL), entry/exit prices, P&L, status.

**Bot signals section** — shows recent indicator signals: signal type, instrument, direction.

**Archived bots toggle** — shows/hides archived bots.

**Practix toggle awareness** — bots respect the global `isPractixMode` store state.

### Data Sources

| API | Purpose |
|---|---|
| `GET /bots/` | Load all bots |
| `GET /bots/orders` | All bot orders |
| `POST /bots/` | Create bot |
| `PATCH /bots/{id}` | Update bot |
| `POST /bots/{id}/archive` | Archive bot |
| `DELETE /bots/{id}` | Delete bot |
| `GET /bots/{id}/orders` | Per-bot orders |
| `GET /bots/{id}/signals` | Per-bot signals |
| `GET /bots/signals/today` | Recent signals (7-day window) |
| `GET /accounts/` | Account selector |

---

## AccountsDrawer

**Component:** `frontend/src/components/panels/AccountsDrawer.tsx`  
**Trigger:** Profile icon in TopNav sets `isProfileOpen` store state  

### Purpose

Slide-in drawer (right side) for managing broker accounts. Three tabs: Broker, Margin, Risk.

### Broker Tab

- Account cards listing all accounts (Zerodha, Angel One) with status dot and broker badge.
- **Token status** — green/red indicator showing whether today's session token is valid.
- **AngelOne login** — "Auto Login" button using stored TOTP secret (`POST /accounts/angelone/{account}/auto-login`). Also manual login flow.
- **Zerodha OAuth** — "Connect" button opens OAuth popup window (`GET /accounts/zerodha/login-url`). Callback handled globally in App.tsx.
- **Edit credentials modal** — opens for API key, API secret, TOTP secret (masked). Saves via `PATCH /accounts/{id}/credentials`.
- **Edit nickname** — inline pencil icon → text input → floppy disk save (`PATCH /accounts/{id}/nickname`).
- **Add Account** — 2-step modal: Step 1 picks broker (Zerodha/AngelOne), Step 2 fills name, client ID, API key, secret, TOTP, scope. Creates via `POST /accounts/`.
- **Deactivate / Reactivate** — confirm modal to soft-delete an account.
- **All Funds panel** — fetches live fund data for all accounts (`GET /accounts/funds`). Shows cash, collateral, utilised, net per account.

### Margin Tab

- Per-account FY margin and brokerage inputs.
- Stamp FY Margin button to lock the current margin for the FY (`POST /accounts/fy-margin/stamp-all`).

### Risk Tab

- Per-account Global SL and Global TP inputs (in INR).
- Save button updates via `POST /accounts/{id}/global-risk`.

### Data Sources

| API | Purpose |
|---|---|
| `GET /accounts/` | Load accounts |
| `GET /accounts/status` | Token validity |
| `GET /accounts/funds` | Live funds |
| `GET /accounts/fy-margin` | FY margin data |
| `POST /accounts/fy-margin` | Save FY margin |
| `POST /accounts/fy-margin/stamp-all` | Stamp all margins |
| `PATCH /accounts/{id}/nickname` | Rename account |
| `PATCH /accounts/{id}/credentials` | Update API creds |
| `POST /accounts/{id}/global-risk` | Set global SL/TP |
| `POST /accounts/angelone/{a}/login` | AngelOne login |
| `POST /accounts/angelone/{a}/auto-login` | AngelOne TOTP auto-login |
| `GET /accounts/angelone/{a}/token-status` | Token check |
| `GET /accounts/zerodha/login-url` | Zerodha OAuth URL |
| `POST /accounts/zerodha/set-token` | Complete Zerodha OAuth |
| `POST /accounts/` | Create new account |

---

## DashboardPanel

**Component:** `frontend/src/components/panels/DashboardPanel.tsx`  
**Trigger:** Dashboard icon in TopNav sets `isDashboardOpen` store state  

### Purpose

Full-screen slide-in overlay showing system health, service controls, live event log, and the emergency kill switch.

### Key Features & UI Elements

**System health header:**
- Overall status dot (green/amber/red) and label: "System Ready" / "Feed Inactive" / "Not Ready".
- Four health chips: Database · Redis · Scheduler · SmartStream.

**Account token status:**
- List of all accounts with green/amber token validity dot for today.
- Login buttons to refresh tokens inline.

**Service controls:**
- Four service rows: PostgreSQL · Redis · Backend API · Market Feed.
- Each row has Start/Stop buttons. Overall Start All / Stop All.
- Late-start warning if attempting Start All after 09:15 IST (with an override option).

**Live event log:**
- Scrolling terminal-style log pulled from `GET /events/` (last 100 events).
- Date navigation buttons (`◀` / `▶`) for browsing past days' logs.
- Auto-polls every 5 seconds for today; static for past dates.
- Deduplication: consecutive identical messages within 30 seconds are collapsed to `message ×N`.
- Log lines are color-coded by level: `[ok]` green, `[err]` red, `[wrn]` amber, `[inf]` default.

**Kill Switch:**
- Red "Kill Switch" button with account checkboxes (select which accounts to kill, or kill all).
- Confirmation modal. Sends `POST /system/kill-switch` with selected account IDs.
- After activation: shows positions_squared and orders_cancelled counts. Affected accounts show a killed indicator.
- Kill switch state is persisted and checked on mount (`GET /system/kill-switch/status`).

### Data Sources

| API | Purpose |
|---|---|
| `GET /system/health` | Health checks (polls every 30s) |
| `GET /services/` | Service status (polls every 5s) |
| `POST /services/start-all` / `stop-all` | Start/stop all |
| `POST /services/{id}/start` / `stop` | Individual service |
| `GET /events/?limit=100&date=` | Event log |
| `POST /system/kill-switch` | Activate kill switch |
| `GET /system/kill-switch/status` | Kill switch state |
| `GET /accounts/` | Account list |

---

## Key Components

### AlgoAIAssistant

**File:** `frontend/src/components/ai/AlgoAIAssistant.tsx`

Slide-up chat overlay for creating or editing algos via natural language. Uses Google's **Gemma 4 (31B)** model via the GOOGLE_AI_API_KEY.

**Flow:**
1. User describes the algo in chat.
2. AI confirms understanding, asks for optional parameters (SL, TP, MTM SL/TP, W&T, TSL) in one message.
3. AI suggests a name (e.g., `NF-STRD-40`).
4. After name confirmation, AI outputs `FINAL_CONFIG:` followed by a JSON payload.
5. The component parses the JSON, validates required fields (`algo_name`, `underlying`, `entry_time`, `exit_time`, `legs[]`), and calls `onComplete(config, accountId, days)`.

**Modes:** `create` (blank chat) or `edit` (pre-loaded with existing algo data).

**UI:** Dark chat bubble interface with user/assistant message history, text input, and a microphone placeholder icon.

---

### AlgoDetailModal

**File:** `frontend/src/components/AlgoDetailModal.tsx`

Read-only modal showing the full configuration of an algo, opened by clicking an algo name in ReportsPage or AnalyticsPage.

**Displays:** Schedule (entry/exit time, strategy mode, entry type), leg details (instrument, direction, option type, strike, lots, SL, TP), MTM SL/TP, account, algo ID.

**Data source:** `GET /algos/?name={name}` to resolve ID, then `GET /algos/{id}` for full details.

---

### Layout & TopNav

**Files:** `frontend/src/components/layout/Layout.tsx`, `frontend/src/components/layout/TopNav.tsx`

**Layout:** Pathless route wrapper that renders TopNav + `<Outlet />` for all app routes.

**TopNav features:**
- STAAX logo / brand.
- Navigation links: Algos (`/grid`) · Orders (`/orders`) · Reports (`/reports`) · Analytics (`/analytics`) · Indicators (`/indicators`).
- **Practix / Live toggle** — pill toggle that switches the global `isPractixMode` state (Zustand store). Affects which algos and orders are shown across all pages.
- **Active account selector** — dropdown to filter all views to a specific account.
- **Dashboard icon** — opens DashboardPanel.
- **Profile/Accounts icon** — opens AccountsDrawer.
- **Notifications WebSocket** — connects to `ws://.../ws/notifications` for real-time toast notifications.

---

## Global State (Zustand Store)

**File:** `frontend/src/store/index.ts`

| State key | Type | Purpose |
|---|---|---|
| `isPractixMode` | boolean | Paper trading vs. live trading toggle, shared across all pages |
| `activeAccount` | string \| null | Currently selected account filter |
| `accounts` | Account[] | Loaded account list |
| `isDashboardOpen` | boolean | DashboardPanel visibility |
| `isProfileOpen` | boolean | AccountsDrawer visibility |

---

## API Summary

All API calls use `axios` via the shared `api` instance in `frontend/src/services/api.ts`. Base URL: `${VITE_API_URL}/api/v1` (defaults to `http://localhost:8000`). JWT token is attached from `localStorage.getItem('staax_token')` on every request.

| Module | Key Endpoints |
|---|---|
| `authAPI` | `POST /auth/login`, `GET /auth/me` |
| `accountsAPI` | `/accounts/` CRUD, funds, margin, credentials, broker login flows |
| `algosAPI` | `/algos/` CRUD + archive, promote/demote, duplicate, recurring-days, schedule-removal, terminate, re, sq |
| `gridAPI` | `/grid/` CRUD + cancel, mode toggle, activate-now |
| `ordersAPI` | `/orders/` list, waiting, ltp, correct exit price, sync, retry, week-summary |
| `reportsAPI` | equity-curve, metrics, calendar, download, day-breakdown, errors, slippage, health-scores, time-heatmap, latency, strategy-breakdown |
| `systemAPI` | kill-switch, ticker, stats, health |
| `botsAPI` | `/bots/` CRUD + orders, signals |
| `servicesAPI` | `/services/` status, start/stop individual and all |
| `holidaysAPI` | `/holidays/` list, sync, create, delete |
| `eventsAPI` | `/events/` list, export |
| WebSockets | `/orders/ws/live` (order updates), `/ws/notifications` (global notifications) |
