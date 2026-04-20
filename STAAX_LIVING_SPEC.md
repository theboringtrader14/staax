
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

---

## Session — 18 April 2026 (v8.7)

### LIFEX Commercial Architecture
- Created `~/STAXX/LIFEX_COMMERCIAL_ARCHITECTURE.md` (413 lines, 9 sections)
- Tenancy model: Hybrid C+D — shared `lifex_core` DB + per-user schemas per module
- Domain strategy: `lifexos.co.in` (landing) + `app.lifexos.co.in` (dashboard) + per-module subdomains
- Pricing matrix documented:
  - Module tiers: STAAX 999/2499/4999, INVEX 299/799/1499, BUDGEX 199/499, FINEX 799/1499, TRAVEX 149/399
  - Add-ons: AI Layer +299, Mobile App +199, BYOK discount −99
  - Bundles: Premium 7999, Starter 4999, Trader 3299, Money 1799
- STAAX white-label path: users bring own broker credentials, no SEBI empanelment needed
- 7-phase migration roadmap documented

### lifex-landing repo (NEW)

- Repo: `~/STAXX/lifex-landing/`
- Stack: Vite + React 18 + TypeScript + Framer Motion, vanilla CSS tokens
- Design: variation-1 neumorphic (light default, dark toggle)
- Tokens: `--bg #1a1d25`, `--neu-raised/-sm/-lg/-inset/-pressed` shadow system, all module brand colours

#### Components built / polished this session

| Component | What changed |
|---|---|
| `Nav.tsx` | Center links absolutely positioned (true center), `scrollToSection` for all 3 links (80px offset + midpoint), ThemeToggle 34×34 |
| `Hero.tsx` | Stats → inset, "₹46.8L/Assets" → "1/Life", `hero-heading` CSS class (theme-aware gradient), "See modules" button removed, CTA centered |
| `ModuleCard.tsx` | Footer strip (Details+price) removed, price below name, glow 300×300 @ 25% opacity, neumorphic inset bullet dots |
| `ModuleModal.tsx` | TRAVEX icon box fixed — was using opaque gradient, now glassmorphic `color1a` |
| `BundleToggle.tsx` | Full rewrite — single persistent pill div, CSS `left` transition, `offsetLeft` measurement — no mount/unmount jank |
| `PricingSection.tsx` | IndividualView: HTML table → single neumorphic container + dividers; Add-ons: inset 3-col container + vertical "Add-ons" label; gaps tightened |
| `PricingCard.tsx` | "Most popular" → diagonal corner ribbon (rotate 45°), neumorphic inset bg + gradient text; `overflow:hidden` on card |
| `FAQ.tsx` | All items in single container (1200px wide); collapsed by default; accent label; tighter padding |
| `Footer.tsx` | Padding: top 60→45px, bottom margin 48→36px |
| `ThemeToggle.tsx` | Default → light mode |
| `App.tsx` | JS wheel-based section snap: jumps to next section at bottom boundary, previous at top boundary; 400ms cooldown + 750ms animation lock |

#### Animated SVG icons (ModuleIcons.tsx)

All icons redesigned to HEALTHEX quality bar (HEALTHEX unchanged):

| Icon | Visual | Animation |
|---|---|---|
| STAAX | Stock trend line, cubic-bezier ups/downs, area fill | Continuous draw L→R, `calcMode=linear` |
| INVEX | 3-bar portfolio chart | Bars grow from baseline staggered, quick reset |
| BUDGEX | Expense receipt, torn zigzag bottom | 3 line items appear staggered, 4s loop |
| FINEX | CFO silhouette + AI neural crown (3 nodes) | Data-flow dots travel from AI nodes → head |
| TRAVEX | Globe + Indian subcontinent (orthographic 82°E 22°N) + airplane | Plane on arc Gulf→SE Asia, destination pin pulse |
| HISTEX | Analog clock, 12 tick marks (4 major + 8 minor) | Counterclockwise rotation (history = rewind) |

Animation principle: all draw animations use `calcMode="linear" from="N" to="0"` — no hold/fade/reverse.

#### CSS / Tokens

| File | Change |
|---|---|
| `global.css` | Scrollbar hidden (`scrollbar-width:none`, `::-webkit-scrollbar display:none`); `overflow-y:scroll`; `.hero-heading` theme-aware gradient |
| `tokens.css` | Light mode `--status-live`: `#047857` → `#059669` (brighter emerald) |

### TRAVEX Globe upgrade
- Installed `react-globe.gl` — `NetworkGlobe.tsx` created (dotted hex continents, dashed arcs, pulse rings)
- User rejected dotted hex — needs proper admin boundaries
- Installed `mapbox-gl` — `MapboxGlobe.tsx` created
  - dark-v11 style, globe projection, frosted-white land fill (3.5% opacity)
  - Country borders 35%, state borders 18%, district borders 10% (minzoom 5)
  - Teal city pulse dots + labels, teal travel arcs with glow, RAF-based auto-rotation
  - India districts: datameet CDN 404 — layer skipped gracefully
  - Feature flag: `?globe=mapbox` URL param activates MapboxGlobe
  - Requires `VITE_MAPBOX_TOKEN` in `~/STAXX/travex/frontend/.env`
- `Globe3D.tsx` preserved as fallback

#### Platform Module Table (v8.7)

| Module | Purpose | Port (local) | Domain | Status |
|---|---|---|---|---|
| STAAX | Algo trading | FE:3000 BE:8000 | staax.lifexos.co.in | ✅ LIVE |
| INVEX | Investments | FE:3001 BE:8001 | invex.lifexos.co.in | ✅ LIVE |
| BUDGEX | Expense tracking | FE:3002 BE:8002 | budgex.lifexos.co.in | ✅ LIVE |
| TRAVEX | Travel tracker | FE:3004 BE:8004 | travex.lifexos.co.in | ✅ LIVE (DNS pending) |
| lifex-landing | Marketing site | :5173 | lifexos.co.in | 🔨 Local only |
| MT5 Bridge | MT5 broker adapter | 8765 | — | 🔨 Scaffolded |
| lifex-mobile | React Native | Expo | — | ✅ Published |

#### Pending — Monday 21 April 2026

1. **TRAVEX**: create `~/STAXX/travex/frontend/.env` with `VITE_MAPBOX_TOKEN`, verify Mapbox globe at `localhost:3004/?globe=mapbox`
2. **TRAVEX**: India districts alternative source (Natural Earth or similar)
3. **TRAVEX**: make MapboxGlobe default after approval, delete NetworkGlobe + Globe3D
4. **TRAVEX**: DNS A records + certbot SSL (`travex.lifexos.co.in`)
5. **STAAX**: MissingGreenlet permanent fix (W&T RETRY)
6. **STAAX**: W&T architecture fix (monitor option premium not underlying index)
7. **STAAX**: EC2 deploy (all 17+18 Apr changes)
8. **STAAX**: Orders page remaining revamp items
9. **lifex-landing**: GitHub repo + EC2 deploy under `lifexos.co.in`
10. **lifex-landing**: Phase 3 — `lifex-shared-ui` repo (navbar + tokens)
11. **lifex-landing**: Phase 4 — auth flow (`lifex-auth` repo)
12. **Android EAS build**
  12. **Android EAS build**

---

## Session — 19 April 2026 (v8.8)

### LIFEX Commercial Architecture
- LIFEX_COMMERCIAL_ARCHITECTURE.md reviewed and confirmed
- Pricing simplified: no Starter/Pro/Premium tiers — single flat price per module
- Module prices: STAAX ₹1,000/mo display (₹1,500 Lite / ₹4,000 Pro in modal), INVEX ₹800, BUDGEX ₹500, FINEX ₹800, TRAVEX ₹400
- Add-ons rounded: AI Layer +₹300, Mobile App +₹200, BYOK −₹100
- Bundles: LIFEX Premium ₹6,500, LIFEX Trader ₹4,750, LIFEX Money ₹2,150 (LIFEX Starter removed)
- STAAX modal: 2-plan selector (Lite ₹1,500/10 algos, Pro ₹4,000/30 algos)

### lifex-landing — Onboarding Flow (/start page)
- React Router installed, /start route added
- StartPage.tsx created: full 6-step onboarding page
- Stepper: fixed left-column SVG pipe (wavy S-curve, 5-layer inset groove effect)
- Steel ball rolls along pipe path using requestAnimationFrame + getPointAtLength
- Ball animation: 2200ms ease-in-out cubic, clockwise/counter-clockwise rotation for forward/back
- 6 step nodes: upcoming (inset, muted) / active (dark, pulsing glow ring) / completed (purple, ✓)
- Purple gradient fluid fill grows with progress (stroke-dashoffset)
- 6 steps: Choose Plan → Sign Up → Verify (OTP) → Review → Payment → Welcome
- Step content expand/collapse: max-height 600ms, content expands 400ms after ball arrives
- Scroll lock: non-passive wheel handler blocks manual scroll past current step
- Cart state lifted at page level: selectedModules, selectedBundle, selectedAddons, staaxPlan
- Sticky bottom bar: cost + module names + "3-day free trial" badge
- Mobile: pipe hidden, horizontal dot stepper instead
- StartPage.v1.tsx backed up before pipe redesign
- All landing page CTAs (Get Started, Start free trial) → Link to /start
- Nav, Hero, PricingCard, PricingSection CTAs updated

### lifex-landing — Pricing section
- PricingSection: Individual view restored to clean 2-column list (no card deck experiment)
- Bundle cards equal height (alignItems:stretch)
- Bundle selection: purple tint + inset shadow (no outline)
- Bundles view shows only BYOK add-on
- PricingCard: added selected, hideCta props

### lifex-landing — Design system
- Dark neumorphic tokens confirmed:
  NEU_RAISED: -8px -8px 16px rgba(255,255,255,0.03), 8px 8px 16px rgba(0,0,0,0.5)
  NEU_RAISED_SM: -4px -4px 8px rgba(255,255,255,0.03), 4px 4px 8px rgba(0,0,0,0.5)
  NEU_INSET: inset -4px -4px 8px rgba(255,255,255,0.03), inset 4px 4px 8px rgba(0,0,0,0.5)

### TRAVEX
- MapboxGlobe.tsx created with admin boundaries (country/state/district)
- Requires VITE_MAPBOX_TOKEN in ~/STAXX/travex/frontend/.env
- Feature flag: ?globe=mapbox activates MapboxGlobe (NetworkGlobe is default)
- Token issue: .env not persisting — recreate on Monday

### Design exploration
- 5 neumorphic variations created in design-references/
- Variation 1 (classic dark) selected as winning design
- Variation 6 (v1 + starfield) also created
- Card deck POC (card-deck-poc.html) built but not integrated — saved as reference
- Onboarding POC (onboarding-poc.html) built as reference — superseded by StartPage.tsx

#### Platform Module Table (v8.8)

| Module | Purpose | Port (local) | Domain | Status |
|---|---|---|---|---|
| STAAX | Algo trading | FE:3000 BE:8000 | staax.lifexos.co.in | ✅ LIVE |
| INVEX | Investments | FE:3001 BE:8001 | invex.lifexos.co.in | ✅ LIVE |
| BUDGEX | Expense tracking | FE:3002 BE:8002 | budgex.lifexos.co.in | ✅ LIVE |
| TRAVEX | Travel tracker | FE:3004 BE:8004 | travex.lifexos.co.in | ✅ LIVE (DNS pending) |
| lifex-landing | Marketing site | :5173 | lifexos.co.in | 🔨 Local only |
| MT5 Bridge | MT5 broker adapter | 8765 | — | 🔨 Scaffolded |
| lifex-mobile | React Native | Expo | — | ✅ Published |

#### Pending — Monday 21 April 2026

1. **STAAX**: Watch overnight exits (NF-STBT1, NF-STBT2, NF-TF, NF-BTST, SX-STBT) — `grep 'RECOVERY-BTST' ~/STAXX/logs/staax.log`
2. **STAAX**: MissingGreenlet permanent fix (W&T RETRY) — P0
3. **STAAX**: W&T architecture fix (monitor option premium not underlying index)
4. **STAAX**: EC2 deploy
5. **TRAVEX**: `echo 'VITE_MAPBOX_TOKEN=pk.eyJ...' > ~/STAXX/travex/frontend/.env`, verify globe
6. **TRAVEX**: DNS A records + certbot SSL (`travex.lifexos.co.in`)
7. **lifex-landing**: /start page — pipe redesign (straight vertical + rectangular connector bulges + liquid fill, no ball) — StartPage.v1.tsx backed up
8. **lifex-landing**: /start page — neumorphic shadows polish
9. **lifex-landing**: GitHub repo + EC2 deploy under `lifexos.co.in`
10. **lifex-landing**: Phase 3 — `lifex-shared-ui` repo
11. **lifex-landing**: Phase 4 — auth flow (`lifex-auth` repo)
12. **Claude Code**: `brew upgrade` once cask updates to v2.1.111+
13. **Android EAS build**

## Session — 20 April 2026 (v8.9)

### STAAX — P&L and Orders fixes
- Removed P&L header stat cards (Week P&L, Realized, Unrealized, Net) from Orders page
- Day tab P&L stays — each day shows own realized + unrealized
- Dashboard today_pnl and mtm_total zeroed (temporary until dashboard removed)
- SCHEDULED status fixed: past-date algos now always show MISSED (is_past_date check)
- Week-summary refetch: already correct (deps: isPractixMode, weekOffset — not selectedDate)
- FRI open_mtm correctly groups by trading_date, uses live LTP from SmartStream

### STAAX — MissingGreenlet permanent fix (commit c31e83c)
- Root cause: _enter_with_db() called outside APScheduler greenlet context
- Fix: schedule_immediate_entry() method routes ALL entry calls through APScheduler AsyncIOExecutor
- Three broken call sites replaced: W&T callback, entry-time gate, retry-legs
- All RETRY calls now route via schedule_immediate_entry()

### STAAX — SmartStream reconnect
- Was FEED_INACTIVE on Monday morning
- Fixed via POST /api/v1/system/smartstream/start
- LTP now flowing correctly

### LIFEX Phase 3 — lifex-shared-ui (commit 8265b12)
- New repo: ~/STAXX/lifex-shared-ui
- Components: Navbar, ThemeToggle, StatusChip
- Hooks: useTheme (localStorage-backed)
- Tokens: tokens.css (source of truth) + tokens.ts (TypeScript constants)
- Dark + light mode neumorphic shadow values for all modules
- Module brand colors: STAAX #FF6B00, INVEX #00C9A7, BUDGEX #7C3AED, FINEX #F59E0B, TRAVEX #2dd4bf
- lifex-landing wired: ThemeToggle.tsx thin wrapper using useTheme from @lifex/shared-ui
- Build: zero TS errors, 2177 modules

### STAAX Phase A — UI Revamp
- Sidebar removed, TopBar removed
- New TopNav: floating pill (border-radius 100px, max-width 1200px, sticky top 20px)
  - Left: "LIFEX OS · STAAX" (Syne 700, STAAX in #FF6B00)
  - Center: 5 text-only tabs — Algos | Bots | Orders | Reports | Analytics
  - Right: Activity icon (dashboard toggle), Theme toggle, KA avatar
  - No Kill Switch, no IST clock in nav
  - Dark/light neumorphic shadow matching platform tokens
- CosmicCanvas archived to src/components/archived/CosmicCanvas.tsx
- HoneycombBackground archived to src/assets/honeycomb-bg-reference.svg
- Background: clean var(--bg) — #1a1d25 dark / #e4e7ef light (matching landing page)
- Phosphor icons (@phosphor-icons/react) replacing lucide-react throughout
- lucide-react uninstalled from package.json

### STAAX Phase A — Notification System
- NotificationSystem.tsx: module-level toast store, 3 types (error/warning/info)
- Web Audio API tones: normal ascending tone, error descending double tone
- Full-sentence descriptions, no abbreviations
- Auto-dismiss: 4s info, 8s error (persists until dismissed)
- WebSocket /ws/system wired: errors → notify error, order events → notify warning

### STAAX Phase A — Dashboard Slide-Out Panel
- 380px panel slides from right, fixed position, starts at top: 88px
- System Health: real health dots from systemAPI.health() every 30s
- Engine Log: real events from eventsAPI.list(50)
- Kill Switch modal: copied verbatim from DashboardPage
- Start Session / Stop All: wired to servicesAPI
- /dashboard route → <Navigate to="/grid" replace />
- Panel position: top:88, right:52, width:475, borderRadius:'0 0 20px 20px'
- Pulse button in TopNav: inset shadow + accent color when panel open

### STAAX Phase A — User Profile Popup (neumorphic)
- background: var(--bg), boxShadow: var(--neu-raised), borderRadius: 20
- Position: top:88, right:20 (below nav pill)
- All borders → var(--border), text → var(--text-dim) / var(--text-mute)
- Avatar "BK", name Karthikeyan, role Admin · STAAX
- Action rows: Settings, Switch Account, Sign Out (→ lifexos.co.in)

### STAAX Phase A — Algos Page (full neumorphic)
- "Smart Cards" → "Algos", "Indicator Bots" → "Bots"
- Card shadows: conditional overflow (hidden when collapsed, visible when expanded)
- Archive badge: count pill (position:absolute, top:-5, right:-5)
- Expanded detail panel: removed click-to-expand feature entirely
- Scroll: fixed by removing flex/flexDirection:column from scroll container (plain block)
- AlgoPage.tsx full neumorphic redesign:
  - Outer padding: 0 28px 24px (matches algo cards container)
  - All inputs (sInp, inpSt, csSt, staax-input): neu-inset + var(--bg), no borders
  - Feature chips (SL/TP/TSL/TTP/W&T/RE): active=inset+color text, inactive=neu-raised-sm
  - Toggle buttons (entry type, reentry, journey trigger, ORB): inset/raised pattern
  - LegRow cards: neu-raised-sm, dragging=neu-inset
  - JourneyChildPanel cards: neu-raised-sm + colored left border per depth level
  - FeatVals value containers: neu-raised-sm, no tinted borders
  - Identity/Delays cards: neu-raised replacing card cloud-fill
  - Toast, F6 warning, locked state: neumorphic with color accent left borders
  - All var(--text-muted) → var(--text-dim), hardcoded dark values removed

### STAAX Phase A — AccountsDrawer (new global component)
- 3 left-edge fixed tab triggers: Broker / Margin / Risk
- Tabs: width:32px, height:120px, border-radius:0 12px 12px 0
- Rotated vertical labels (writing-mode:vertical-rl, rotate:180deg)
- neu-raised-sm → neu-inset when active, accent left border
- Single 400px panel slides from left (transform translateX), swaps content per tab
- Backdrop: rgba(0,0,0,0.25) + blur(2px), click-outside + Escape to close
- Panel 1 (Broker): account cards with token status dot (live/offline), live funds strip,
  Login/Refresh Token button, API Keys modal, Deactivate/Reactivate
- Panel 2 (Margin): summary stats (total margin, brokerage), per-account FY margin +
  brokerage edit (April-gated) + save
- Panel 3 (Risk): per-account global SL/TP edit + save
- All modals (Add Account, Edit API Keys, Confirm Action) fully neumorphic
- Registered globally in App.tsx (visible on all pages)

### AI Pricing tiers (updated)
- Gemma tier: ₹300/mo (free model)
- Claude Haiku tier: ₹1,000/mo (for AI Algo creation, HISTEX backtesting)
- BYOK: −₹100/mo discount

### Commercialization decisions
- Indicator Bots (renamed Bots): internal only, not in commercial tier
- HEALTHEX: internal only, not in commercial tier
- HISTEX: public, AI-powered backtesting (Phase C — last)
- Historical data source: Angel One API (1-min candles), not tick level

### STAAX Phase B (next) — AI Algo Creation
- Web: text/voice input → Claude Haiku parses → summary → confirm → creates algo
- AI assistant microphone/image in Algos page
- Mobile: voice input → STT → Haiku → confirm → create + enable for days
- Same endpoint as HISTEX AI backtesting

#### Platform Module Table (v8.9)

| Module | Purpose | Port (local) | Domain | Status |
|---|---|---|---|---|
| STAAX | Algo trading | FE:3000 BE:8000 | staax.lifexos.co.in | ✅ LIVE |
| INVEX | Investments | FE:3001 BE:8001 | invex.lifexos.co.in | ✅ LIVE |
| BUDGEX | Expense tracking | FE:3002 BE:8002 | budgex.lifexos.co.in | ✅ LIVE |
| TRAVEX | Travel tracker | FE:3004 BE:8004 | travex.lifexos.co.in | ✅ LIVE (DNS pending) |
| lifex-landing | Marketing site | :5173 | lifexos.co.in | 🔨 Local only |
| MT5 Bridge | MT5 broker adapter | 8765 | — | 🔨 Scaffolded |
| lifex-mobile | React Native | Expo | — | ✅ Published |
| lifex-shared-ui | Design tokens + shared components | — | — | ✅ v1 |

#### Pending — Tuesday 22 April 2026

1. **STAAX**: Verify MissingGreenlet fix — RETRY any ERROR algo, watch log for `[ENGINE] Immediate entry scheduled via APScheduler` (must NOT see MissingGreenlet)
2. **STAAX**: Phase B — AI Algo creation (Claude Haiku integration, mic/AI assistant UI)
3. **STAAX**: EC2 deploy
4. **lifex-landing**: /start page — pipe redesign (straight pipe + liquid fill)
5. **lifex-landing**: /start page — neumorphic shadows complete fix
6. **lifex-landing**: GitHub repo + EC2 deploy under lifexos.co.in
7. **TRAVEX**: Mapbox token env + DNS A records + certbot SSL
8. **Android EAS build**
