# STAAX Redesign — Claude Code Instructions

## What this is
This scaffold contains the complete STAAX brand design system and page components.
Use the files in this folder to redesign the existing STAAX Next.js platform at `http://localhost:3000`.

---

## Plugins & packages to install

```bash
# Core (likely already installed)
npm install next react react-dom typescript

# Fonts (via Google Fonts in layout.tsx — no npm needed)
# Syne + JetBrains Mono are loaded via <link> in src/app/layout.tsx

# Optional: lightweight classname utility
npm install clsx
# If using clsx, replace the cn() in src/lib/utils.ts with:
# import { clsx } from 'clsx'; export { clsx as cn };

# Optional: Framer Motion for richer page transitions
npm install framer-motion
# Use <motion.div initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} transition={{duration:0.4}}> 
# on page root elements instead of CSS animation classes

# Optional: Recharts for charts in Analytics
npm install recharts
```

---

## Step-by-step redesign instructions

### 1. Copy design tokens
Copy `src/styles/globals.css` into your project's global CSS file.
All CSS custom properties (`--ox-radiant`, `--bg-void`, etc.) are the single source of truth.
Import this file in `src/app/layout.tsx`.

### 2. Copy design tokens TypeScript
Copy `src/lib/tokens.ts` — import `colors`, `fonts`, `animation` wherever you need inline styles.

### 3. Replace the layout
Replace your existing `src/app/layout.tsx` with the one in this scaffold.
It includes `<BgOrbs />`, `<Sidebar />`, `<TopBar />` and wraps `<main>` correctly.

### 4. Copy UI components
Copy all files from `src/components/ui/` into your project:
- `GlassCard.tsx` + `GlassCard.module.css` — the core card container
- `Button.tsx` + `Button.module.css` — all button variants
- `Chip.tsx` + `Chip.module.css` — chips, status labels, pulse dots
- `MetricCard.tsx` + `MetricCard.module.css` — P&L / metric cards with sparklines

### 5. Copy layout components
Copy all files from `src/components/layout/`:
- `Sidebar.tsx` + `.module.css` — icon sidebar with tooltip hover + active indicator
- `TopBar.tsx` + `.module.css` — sticky header with user, clock, P&L, broker badge
- `BgOrbs.tsx` + `.module.css` — fixed ambient orange orbs (CSS-only)

### 6. Copy dashboard components
Copy all files from `src/components/dashboard/`:
- `SystemLog.tsx` + `.module.css` — scrollable monospace log feed
- `ServiceRow.tsx` + `.module.css` — service status rows (start/stop)
- `SystemStatusBanner.tsx` + `.module.css` — health check grid

### 7. Redesign pages one by one
Replace each page using the scaffold files as reference:
- `src/app/dashboard/page.tsx` + `page.module.css`
- `src/app/grid/page.tsx` + `page.module.css`
- `src/app/analytics/page.tsx` + `page.module.css`

Keep your existing API calls and data fetching logic — just replace the JSX/CSS.

### 8. Tailwind config (if using Tailwind)
Merge `tailwind.config.ts` into your existing config to get STAAX tokens as Tailwind classes:
- `text-ox-radiant`, `bg-bg-void`, `font-display`, `font-mono`, etc.

---

## Design rules (always enforce these)

| Rule | Value |
|------|-------|
| Page background | `#0A0A0B` (--bg-void) — never change |
| Primary colour | `#FF6B00` (--ox-radiant) |
| Dual-tone partner | `#CC4400` (--ox-ember) — always paired with radiant |
| Headline font | Syne 800 |
| Data/prices font | JetBrains Mono |
| Card style | Glass — `rgba(22,22,25,0.72)` + `blur(20px)` + `0.5px rgba(255,107,0,0.22)` border |
| Container fill | Cloudy abstract — overlapping radial-gradient blobs (see `.cloud-fill` in globals.css) |
| Borders | Always `0.5px` — never `1px` or thicker (exception: `2px` left accent on service rows) |
| Animations | Entry: `fadeUp 400ms`. Hover: `220ms ease-smooth`. Active: `scale(0.97)`. |
| Buy/Profit | `#22DD88` (--sem-long) |
| Sell/Loss | `#FF4444` (--sem-short) |
| Active signal | `#4488FF` (--sem-signal) |
| Warning/Holiday | `#FFD700` (--sem-warn) |

---

## Animation reference

```css
/* Entry animation — use on page root */
animation: fadeUp 400ms cubic-bezier(0,0,0.2,1) both;

/* Stagger children */
.child:nth-child(1) { animation-delay: 0ms; }
.child:nth-child(2) { animation-delay: 60ms; }
.child:nth-child(3) { animation-delay: 120ms; }

/* Button hover glow */
.btn-primary:hover { box-shadow: 0 0 22px rgba(255,107,0,0.40); }

/* Card hover lift */
.glass:hover { transform: translateY(-1px); }

/* Pulse dot (live/status) */
animation: pulseLive 2s ease-out infinite;

/* Spring easing */
cubic-bezier(0.34, 1.56, 0.64, 1)
```

---

## File tree summary

```
src/
├── styles/
│   └── globals.css              ← ALL CSS tokens + base styles
├── lib/
│   ├── tokens.ts                ← TypeScript design tokens
│   └── utils.ts                 ← cn() helper
├── components/
│   ├── ui/
│   │   ├── GlassCard.tsx/.module.css
│   │   ├── Button.tsx/.module.css
│   │   ├── Chip.tsx/.module.css
│   │   └── MetricCard.tsx/.module.css
│   ├── layout/
│   │   ├── Sidebar.tsx/.module.css
│   │   ├── TopBar.tsx/.module.css
│   │   └── BgOrbs.tsx/.module.css
│   └── dashboard/
│       ├── SystemLog.tsx/.module.css
│       ├── ServiceRow.tsx/.module.css
│       └── SystemStatusBanner.tsx/.module.css
└── app/
    ├── layout.tsx               ← Root layout
    ├── dashboard/
    │   ├── page.tsx
    │   └── page.module.css
    ├── grid/
    │   ├── page.tsx
    │   └── page.module.css
    └── analytics/
        ├── page.tsx
        └── page.module.css
```

---
STAAX Design System v1.0 — LIFEX Intelligence Suite
