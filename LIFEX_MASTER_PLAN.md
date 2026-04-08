# LIFEX — Personal Operating System
# Master Plan v1.0 — April 2026

## Vision
A unified personal financial OS where all modules share
data and a single AI layer (Gemma 4) provides cross-module
intelligence, daily briefings, and anomaly detection.

## Module Architecture

### EXISTING MODULES
- STAAX  — Algo Trading (F&O + MCX) — staax.lifexos.co.in
- INVEX  — Investment Portfolio — invex.lifexos.co.in
- BUDGEX — Expense Tracking — budgex.lifexos.co.in

### NEW MODULES (Phase 2)
- FINEX  — Personal CFO (intelligence layer) — finex.lifexos.co.in
  ├── Dashboard — Daily briefing, LIFEX Score, cross-module AI
  ├── /networth — NETEX (net worth engine)
  └── /goals   — GOALEX (goals & FI planning)

### NOT BUILDING
- No HEALTHEX (no wearables yet)
- No WORKEX (keeping personal only)

## FINEX — Personal CFO

### Purpose
Aggregates ALL module data. Command center of LIFEX.
Not another tracker — the intelligence layer.

### Pages
1. Dashboard — LIFEX Score, daily briefing, anomalies
2. Net Worth (NETEX tab) — full balance sheet
3. Goals & FI (GOALEX tab) — goals, FI calculator
4. Briefing History — past daily briefings

### LIFEX Score (0-100)
Financial Health 50%:
  Net worth growth     15% (NETEX)
  FI progress          15% (GOALEX)
  Budget adherence     10% (BUDGEX)
  Trading P&L trend    10% (STAAX)
Goal Progress 30%:
  Emergency fund       10% (G1)
  Car purchase          5% (G2)
  Retirement           15% (G3)
Portfolio Health 20%:
  Wealth Health Score  10% (NETEX)
  Asset allocation     10% (INVEX + NETEX)

### Daily Briefing (08:30 IST cron)
Section 1 — Today: trading algos, yesterday P&L, market
Section 2 — This week: budget burn, goal updates
Section 3 — Alerts: subscriptions due, overruns, milestones
Section 4 — AI insight: cross-module observation (1 sentence)

### LIFEX Score Formula Notes
Today estimated: ~72/100
- Financial health: moderate (PRACTIX phase, budget OK)
- Goal progress: poor (emergency fund 4% only)
- Portfolio health: high (Wealth Health Score 100)

## NETEX — Net Worth Engine (tab within FINEX)

### Asset Classes (from AURUM data)
Equity:
  - Indian stocks (34 stocks, from INVEX)
  - US stocks (8 stocks: AMZN, AAPL, GOOGL, TSLA etc.)
  - Mutual funds (6 funds)
  - Trading capital (Angel One + Zerodha)
Debt:
  - EPF: ₹5.85L
  - NPS: ₹4.14L
  - APY: ₹0.55L
  - Fixed deposits: ₹0.25L
  - Emergency fund: ₹1.6L
  - Travel fund: ₹1.4L
Alternatives:
  - Real estate: ₹60L (2 properties)
  - Gold: ₹0.10L
  - Silver: ₹0.13L
  - Platinum: ₹0.04L
Liabilities:
  - Home loan: ₹21.9L
  - Land loan: ₹4L

### Key Metrics
- Current net worth: ₹1.32Cr (April 2026)
- Genesis net worth: ₹95.5L
- Growth: +₹36.6L (38.4%)
- Wealth Health Score: 100/100
- Asset allocation: Equity 52%, Debt 9%, Alternatives 39%
- Leverage ratio: 0.17 (low, healthy)

### Data Sources
- Indian stocks + MFs: INVEX API (live)
- US stocks: NSE/forex API (live)
- EPF/NPS/Property: manual update (monthly)
- Trading capital: STAAX API (live)
- Loans: manual update (monthly)

## GOALEX — Goals & FI Planning (tab within FINEX)

### Current Goals (from AURUM)
G1: Emergency Fund — ₹6L by 2027, HIGH priority
    Status: 4% done (₹25K allocated — Federal Bank FD)
    Required monthly: ₹52,917 — UNACHIEVABLE at current pace
    
G2: Car Purchase — ₹12L by 2029, MEDIUM priority
    Status: 25% done (₹2.99L — JSWSTEEL allocation)
    Required monthly: ₹36,067
    
G3: Retirement — ₹5Cr by 2050, HIGH priority
    Status: 0.4% done (₹1.72L — IOC allocation)
    Required monthly: ₹1,70,942 — needs SIP setup

### FI Planning
FI Target: ₹1.8Cr (30x annual expenses of ₹6L)
Current: ₹1.32Cr
Gap: ₹49.5L
Estimated years to FI: 2.84 years (nearly there!)
FI Multiple: 30x (conservative)

### Features
- Goal creation: name, target, year, priority, asset link
- Inflation adjustment (10% assumed)
- Required monthly effort per goal
- SIP alignment check
- FI calculator with scenarios
- Goal stress testing (expense spike, income loss)

## BUDGEX Revamp Plan

### Architecture (confirmed)
Mobile (voice) → BUDGEX API → BUDGEX DB → Web (dashboard)
Web = read-only dashboard. No voice on web.

### New Pages
1. Dashboard — rich insights (6 sections)
2. Expenses — full list, grouped by day, search, filters
3. Budget — NEW: monthly budget per category, progress bars
4. Analytics — monthly/quarterly/yearly trends, AI insights
5. Subscriptions — enhanced with yearly total, due alerts
6. Accounts — bank accounts + credit cards

### Category Colors (consistent across LIFEX)
Food:        #FF6B35 orange
Travel:      #4488FF blue
Bills:       #FFD700 gold
Shopping:    #FF4488 pink
Health:      #22DD88 green
Others:      rgba(232,232,248,0.4) muted

### Budget Page (new)
- Monthly budget per category (user sets)
- Progress bars: spent/budget with % and color
- Over-budget alert in red
- Under-budget celebration in green

### Analytics Enhancements
- Yearly overview (all 12 months)
- Category trend lines (6 months)
- AI insights via Gemma 4
- Top merchants section

### API New Endpoints Needed
GET /api/v1/expenses/trends?months=6
GET /api/v1/budgets
POST /api/v1/budgets
GET /api/v1/budgets/status
GET /api/v1/analytics/insights

## Cross-Module Intelligence (Phase 2)

### Correlations to detect
- Trading win rate vs sleep quality
- Food spend increase vs STAAX drawdown weeks
- Budget overruns vs goal progress impact

### Intent Router (mobile voice)
"Log a run" → HEALTHEX (future)
"Swiggy 350" → BUDGEX expense
"What's my NIFTY position" → STAAX query
"How much food spend this month" → BUDGEX query
"What's my net worth" → NETEX
"Am I on track for FI" → GOALEX
"Summarize my week" → FINEX weekly review

### UPI/SMS Auto-capture (Phase 3)
Android: read SMS for UPI transactions
iPhone: Share extension → LIFEX mobile → auto-parse
Pattern: "₹350 debited from HDFC. UPI Ref: xxx"

## Roadmap

Phase 1 — Data completeness (now)
✅ STAAX PRACTIX testing
🔄 BUDGEX revamp
⏳ INVEX Analysis Phase 2
⏳ Mobile voice flow end-to-end
⏳ EAS Android build

Phase 2 — New modules (1-2 months)
⏳ FINEX scaffold + daily briefing
⏳ NETEX net worth engine
⏳ GOALEX goals & FI planning
⏳ LIFEX Score v1
⏳ AURUM data migration to NETEX/GOALEX

Phase 3 — Intelligence (3-6 months)
⏳ Cross-module correlations
⏳ Weekly/monthly auto-reports
⏳ Intent router
⏳ UPI/SMS auto-capture
⏳ STAAX LIVE trading

## Technical Architecture

Ports:
  STAAX:  backend 8000, frontend 3000
  INVEX:  backend 8001, frontend 3001
  BUDGEX: backend 8002, frontend 3002
  FINEX:  backend 8003, frontend 3003

Domains:
  lifexos.co.in      — LIFEX landing
  staax.lifexos.co.in
  invex.lifexos.co.in
  budgex.lifexos.co.in
  finex.lifexos.co.in (new)

Brand Colors:
  STAAX:  #FF6B00 orange
  INVEX:  #00C9A7 teal
  BUDGEX: #7C3AED purple
  FINEX:  #F59E0B gold/amber

AI: Gemma 4 (gemma-4-31b-it) via Google AI Studio
DB: PostgreSQL (Docker staax_db) — each module own DB
Cache: Redis (staax_redis)

## AURUM Migration Notes
Source: Google Sheets AURUM system (Jan 2026 data)
Seed data for NETEX:
  34 Indian stocks with qty + avg price
  8 US stocks with qty + avg price USD
  6 MFs with units + NAV
  EPF/NPS/APY/FD values
  2 properties, 3 precious metals
  2 loans (home + land)
Seed data for GOALEX:
  3 goals (G1 Emergency, G2 Car, G3 Retirement)
  Goal-to-asset allocations
  Monthly snapshot history (Jan 2026 baseline)
