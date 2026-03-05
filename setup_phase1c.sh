#!/bin/bash
# STAAX Phase 1C — Complete UI
# Run from inside your staax directory: bash setup_phase1c.sh

echo "🚀 Setting up Phase 1C — STAAX UI..."

# ─── INITIALISE REACT APP ─────────────────────────────────────────────────────
cd frontend

# Install dependencies
npm install

# Install tailwind
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p

cd ..

# ─── TAILWIND CONFIG ──────────────────────────────────────────────────────────

cat > frontend/tailwind.config.js << 'EOF'
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        bg:      { primary: "#2A2C2E", secondary: "#1E2022", surface: "#353739", border: "#3F4143" },
        accent:  { blue: "#00B0F0", amber: "#D77B12" },
        status:  { green: "#22C55E", red: "#EF4444", amber: "#F59E0B", grey: "#6B7280" },
        text:    { primary: "#F0F0F0", muted: "#9CA3AF", dim: "#6B7280" },
      },
      fontFamily: {
        display: ["'ADLaM Display'", "Calibri", "serif"],
        body:    ["'Dubai'", "'Dubai Light'", "Calibri", "sans-serif"],
      },
    },
  },
  plugins: [],
}
EOF

# ─── GLOBAL CSS ───────────────────────────────────────────────────────────────

cat > frontend/src/index.css << 'EOF'
@tailwind base;
@tailwind components;
@tailwind utilities;

@import url('https://fonts.googleapis.com/css2?family=ADLaM+Display&display=swap');

:root {
  --bg-primary:   #2A2C2E;
  --bg-secondary: #1E2022;
  --bg-surface:   #353739;
  --bg-border:    #3F4143;
  --accent-blue:  #00B0F0;
  --accent-amber: #D77B12;
  --green:        #22C55E;
  --red:          #EF4444;
  --amber:        #F59E0B;
  --text:         #F0F0F0;
  --text-muted:   #9CA3AF;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  background: var(--bg-primary);
  color: var(--text);
  font-family: 'Dubai Light', 'Calibri', sans-serif;
  font-size: 13px;
  -webkit-font-smoothing: antialiased;
}

::-webkit-scrollbar       { width: 5px; height: 5px; }
::-webkit-scrollbar-track  { background: var(--bg-secondary); }
::-webkit-scrollbar-thumb  { background: var(--bg-border); border-radius: 3px; }

.status-dot {
  width: 8px; height: 8px; border-radius: 50%; display: inline-block;
}

/* Table styles */
.staax-table { width: 100%; border-collapse: collapse; }
.staax-table th {
  background: var(--bg-secondary);
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 8px 12px;
  text-align: left;
  border-bottom: 1px solid var(--bg-border);
  white-space: nowrap;
}
.staax-table td {
  padding: 9px 12px;
  border-bottom: 1px solid rgba(63,65,67,0.5);
  font-size: 12px;
  white-space: nowrap;
}
.staax-table tr:hover td { background: rgba(255,255,255,0.02); }

/* Tag/badge */
.tag {
  display: inline-flex; align-items: center;
  padding: 2px 8px; border-radius: 4px;
  font-size: 11px; font-weight: 600; letter-spacing: 0.03em;
}

/* Button */
.btn {
  display: inline-flex; align-items: center; justify-content: center;
  gap: 6px; padding: 6px 14px; border-radius: 5px;
  font-size: 12px; font-weight: 600; cursor: pointer;
  border: none; transition: all 0.15s; white-space: nowrap;
}
.btn-primary  { background: var(--accent-blue); color: #000; }
.btn-primary:hover  { background: #00c8ff; }
.btn-danger   { background: rgba(239,68,68,0.15); color: var(--red); border: 1px solid rgba(239,68,68,0.3); }
.btn-danger:hover   { background: rgba(239,68,68,0.25); }
.btn-ghost    { background: rgba(255,255,255,0.06); color: var(--text-muted); }
.btn-ghost:hover    { background: rgba(255,255,255,0.1); color: var(--text); }
.btn-amber    { background: rgba(215,123,18,0.15); color: var(--accent-amber); border: 1px solid rgba(215,123,18,0.3); }

/* Input */
.staax-input {
  background: var(--bg-secondary); border: 1px solid var(--bg-border);
  color: var(--text); border-radius: 5px; padding: 7px 10px;
  font-size: 12px; font-family: inherit; width: 100%;
  transition: border-color 0.15s;
}
.staax-input:focus { outline: none; border-color: var(--accent-blue); }
.staax-input::placeholder { color: var(--text-muted); }

/* Select */
.staax-select {
  background: var(--bg-secondary); border: 1px solid var(--bg-border);
  color: var(--text); border-radius: 5px; padding: 7px 10px;
  font-size: 12px; font-family: inherit; cursor: pointer;
  appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239CA3AF' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 10px center;
  padding-right: 28px;
}
.staax-select:focus { outline: none; border-color: var(--accent-blue); }

/* Card */
.card {
  background: var(--bg-surface); border: 1px solid var(--bg-border);
  border-radius: 8px; padding: 16px;
}

/* Grid cell status colours */
.cell-no_trade    { border-left: 3px solid var(--text-muted); }
.cell-algo_active { border-left: 3px solid var(--accent-blue); }
.cell-open        { border-left: 3px solid var(--green); }
.cell-algo_closed { border-left: 3px solid #16a34a; }
.cell-error       { border-left: 3px solid var(--red); }
.cell-order_pending { border-left: 3px solid var(--amber); }
EOF

# ─── MAIN.TSX ─────────────────────────────────────────────────────────────────

cat > frontend/src/main.tsx << 'EOF'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
EOF

# ─── APP.TSX ──────────────────────────────────────────────────────────────────

cat > frontend/src/App.tsx << 'EOF'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from '@/components/layout/Layout'
import GridPage from '@/pages/GridPage'
import OrdersPage from '@/pages/OrdersPage'
import AlgoPage from '@/pages/AlgoPage'
import ReportsPage from '@/pages/ReportsPage'
import AccountsPage from '@/pages/AccountsPage'
import LoginPage from '@/pages/LoginPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/grid" replace />} />
          <Route path="grid"     element={<GridPage />} />
          <Route path="orders"   element={<OrdersPage />} />
          <Route path="algo"     element={<AlgoPage />} />
          <Route path="reports"  element={<ReportsPage />} />
          <Route path="accounts" element={<AccountsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
EOF

# ─── LAYOUT ───────────────────────────────────────────────────────────────────

cat > frontend/src/components/layout/Layout.tsx << 'EOF'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import TopBar from './TopBar'

export default function Layout() {
  return (
    <div style={{ display:'flex', height:'100vh', overflow:'hidden', background:'var(--bg-primary)' }}>
      <Sidebar />
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', minWidth:0 }}>
        <TopBar />
        <main style={{ flex:1, overflow:'auto', padding:'20px 24px' }}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
EOF

cat > frontend/src/components/layout/Sidebar.tsx << 'EOF'
import { NavLink } from 'react-router-dom'

const nav = [
  { path:'/grid',     label:'Smart Grid',  icon:'⊞' },
  { path:'/orders',   label:'Orders',      icon:'≡' },
  { path:'/algo',     label:'Algo Config', icon:'⚙' },
  { path:'/reports',  label:'Reports',     icon:'◈' },
  { path:'/accounts', label:'Accounts',    icon:'◉' },
]

export default function Sidebar() {
  return (
    <nav style={{
      width:'200px', minWidth:'200px',
      background:'var(--bg-secondary)',
      borderRight:'1px solid var(--bg-border)',
      display:'flex', flexDirection:'column',
      paddingTop:'0',
    }}>
      {/* Logo */}
      <div style={{
        padding:'20px 20px 24px',
        borderBottom:'1px solid var(--bg-border)',
      }}>
        <div style={{
          fontFamily:"'ADLaM Display', serif",
          fontSize:'24px', fontWeight:'400',
          color:'var(--accent-blue)',
          letterSpacing:'0.05em',
        }}>STAAX</div>
        <div style={{ fontSize:'10px', color:'var(--text-muted)', marginTop:'2px', letterSpacing:'0.1em' }}>
          ALGO TRADING
        </div>
      </div>

      {/* Nav items */}
      <div style={{ flex:1, paddingTop:'8px' }}>
        {nav.map(item => (
          <NavLink key={item.path} to={item.path} style={({ isActive }) => ({
            display:'flex', alignItems:'center', gap:'12px',
            padding:'11px 20px',
            textDecoration:'none',
            color: isActive ? 'var(--accent-blue)' : 'var(--text-muted)',
            background: isActive ? 'rgba(0,176,240,0.08)' : 'transparent',
            borderLeft: isActive ? '2px solid var(--accent-blue)' : '2px solid transparent',
            fontSize:'13px',
            transition:'all 0.12s',
            fontWeight: isActive ? '600' : '400',
          })}>
            <span style={{ fontSize:'16px', lineHeight:1 }}>{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </div>

      {/* Version */}
      <div style={{ padding:'16px 20px', borderTop:'1px solid var(--bg-border)' }}>
        <div style={{ fontSize:'10px', color:'var(--text-dim)', letterSpacing:'0.05em' }}>v0.1.0 — Phase 1C</div>
      </div>
    </nav>
  )
}
EOF

cat > frontend/src/components/layout/TopBar.tsx << 'EOF'
import { useState } from 'react'

export default function TopBar() {
  const [isPractix, setIsPractix] = useState(true)
  const now = new Date()
  const timeStr = now.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', timeZone:'Asia/Kolkata' })

  return (
    <header style={{
      height:'52px', minHeight:'52px',
      background:'var(--bg-secondary)',
      borderBottom:'1px solid var(--bg-border)',
      display:'flex', alignItems:'center',
      justifyContent:'space-between',
      padding:'0 24px', gap:'16px',
    }}>
      {/* Left */}
      <div style={{ display:'flex', alignItems:'center', gap:'16px' }}>
        <span style={{ color:'var(--text-muted)', fontSize:'13px' }}>
          Good morning, <span style={{ color:'var(--text)', fontWeight:600 }}>Karthikeyan</span>
        </span>
        <span style={{ color:'var(--bg-border)' }}>|</span>
        <span style={{ fontSize:'12px', color:'var(--text-muted)' }}>IST {timeStr}</span>
      </div>

      {/* Right */}
      <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>

        {/* PRACTIX / LIVE toggle */}
        <button
          onClick={() => setIsPractix(!isPractix)}
          style={{
            display:'flex', alignItems:'center', gap:'8px',
            background: isPractix ? 'rgba(215,123,18,0.12)' : 'rgba(34,197,94,0.12)',
            border: `1px solid ${isPractix ? 'rgba(215,123,18,0.4)' : 'rgba(34,197,94,0.4)'}`,
            borderRadius:'5px', padding:'4px 12px',
            color: isPractix ? 'var(--accent-amber)' : 'var(--green)',
            fontSize:'11px', fontWeight:'700', letterSpacing:'0.08em',
            cursor:'pointer',
          }}
        >
          <span style={{
            width:'6px', height:'6px', borderRadius:'50%',
            background: isPractix ? 'var(--accent-amber)' : 'var(--green)',
            boxShadow: isPractix ? '0 0 6px var(--accent-amber)' : '0 0 6px var(--green)',
          }} />
          {isPractix ? 'PRACTIX' : 'LIVE'}
        </button>

        {/* Account indicator */}
        <div style={{
          display:'flex', alignItems:'center', gap:'6px',
          background:'var(--bg-surface)', border:'1px solid var(--bg-border)',
          borderRadius:'5px', padding:'4px 10px',
          fontSize:'12px', color:'var(--text-muted)',
        }}>
          <span style={{ color:'var(--accent-blue)', fontWeight:600 }}>2</span>
          <span>/3 Accounts</span>
        </div>

        {/* Notification bell */}
        <button style={{
          background:'var(--bg-surface)', border:'1px solid var(--bg-border)',
          borderRadius:'5px', width:'32px', height:'32px',
          display:'flex', alignItems:'center', justifyContent:'center',
          cursor:'pointer', color:'var(--text-muted)', fontSize:'14px',
          position:'relative',
        }}>
          🔔
          <span style={{
            position:'absolute', top:'4px', right:'4px',
            width:'7px', height:'7px', borderRadius:'50%',
            background:'var(--red)',
          }} />
        </button>
      </div>
    </header>
  )
}
EOF

# ─── SMART GRID PAGE ──────────────────────────────────────────────────────────

cat > frontend/src/pages/GridPage.tsx << 'EOF'
import { useState } from 'react'

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI']

const SAMPLE_ALGOS: Record<string, any[]> = {
  MON: [
    { id:'1', name:'AWS-1',  multiplier:1, entry:'09:16', nextSL:'09:18', status:'open',        practix:true  },
    { id:'2', name:'TF-BUY', multiplier:2, entry:'09:30', nextSL:null,    status:'algo_active', practix:true  },
    { id:'3', name:'S1',     multiplier:1, entry:'09:20', nextSL:null,    status:'no_trade',    practix:true  },
  ],
  TUE: [
    { id:'4', name:'AWS-1',  multiplier:1, entry:'09:16', nextSL:'09:18', status:'algo_closed', practix:false },
    { id:'5', name:'MDS-1',  multiplier:3, entry:'09:30', nextSL:null,    status:'error',       practix:true  },
  ],
  WED: [
    { id:'6', name:'TF-BUY', multiplier:1, entry:'09:30', nextSL:null,    status:'order_pending', practix:true },
  ],
  THU: [
    { id:'7', name:'S1',     multiplier:2, entry:'09:20', nextSL:null,    status:'open',        practix:true  },
    { id:'8', name:'AWS-1',  multiplier:1, entry:'09:16', nextSL:'09:18', status:'algo_active', practix:true  },
  ],
  FRI: [
    { id:'9', name:'MDS-1',  multiplier:1, entry:'09:30', nextSL:null,    status:'no_trade',    practix:true  },
  ],
}

const STATUS_CONFIG: Record<string, { label:string, color:string, bg:string }> = {
  no_trade:      { label:'No Trade',    color:'#6B7280', bg:'rgba(107,114,128,0.12)' },
  algo_active:   { label:'Active',      color:'#00B0F0', bg:'rgba(0,176,240,0.12)'  },
  order_pending: { label:'Pending',     color:'#F59E0B', bg:'rgba(245,158,11,0.12)' },
  open:          { label:'Open',        color:'#22C55E', bg:'rgba(34,197,94,0.12)'  },
  algo_closed:   { label:'Closed',      color:'#16a34a', bg:'rgba(22,163,74,0.12)'  },
  error:         { label:'Error',       color:'#EF4444', bg:'rgba(239,68,68,0.12)'  },
}

function AlgoCell({ algo }: { algo: any }) {
  const s = STATUS_CONFIG[algo.status] || STATUS_CONFIG.no_trade
  return (
    <div style={{
      background:'var(--bg-secondary)',
      border:`1px solid var(--bg-border)`,
      borderLeft:`3px solid ${s.color}`,
      borderRadius:'6px', padding:'10px 12px',
      marginBottom:'6px', cursor:'pointer',
      transition:'all 0.12s',
    }}
    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
    onMouseLeave={e => (e.currentTarget.style.background = 'var(--bg-secondary)')}
    >
      {/* Header row */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'6px' }}>
        <span style={{ fontWeight:700, fontSize:'13px', color:'var(--text)' }}>{algo.name}</span>
        <span style={{
          fontSize:'10px', fontWeight:700, letterSpacing:'0.05em',
          color: s.color, background: s.bg,
          padding:'2px 6px', borderRadius:'3px',
        }}>{s.label}</span>
      </div>

      {/* Info row */}
      <div style={{ display:'flex', gap:'12px', fontSize:'11px', color:'var(--text-muted)' }}>
        <span style={{ color:'var(--accent-blue)', fontWeight:600 }}>M: {algo.multiplier}</span>
        <span>E: {algo.entry}</span>
        {algo.nextSL && <span style={{ color:'var(--accent-amber)' }}>N: {algo.nextSL}</span>}
      </div>

      {/* Practix tag */}
      {algo.practix && (
        <div style={{ marginTop:'6px' }}>
          <span style={{
            fontSize:'9px', fontWeight:700, letterSpacing:'0.08em',
            color:'var(--accent-amber)', background:'rgba(215,123,18,0.1)',
            padding:'1px 5px', borderRadius:'3px',
          }}>PRACTIX</span>
        </div>
      )}
    </div>
  )
}

export default function GridPage() {
  const [showWeekends, setShowWeekends] = useState(false)

  const algoCounts = DAYS.reduce((acc, d) => {
    acc[d] = (SAMPLE_ALGOS[d] || []).length
    return acc
  }, {} as Record<string, number>)

  return (
    <div>
      {/* Page header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'20px' }}>
        <div>
          <h1 style={{ fontFamily:"'ADLaM Display', serif", fontSize:'22px', color:'var(--text)', fontWeight:400 }}>
            Smart Grid
          </h1>
          <p style={{ fontSize:'12px', color:'var(--text-muted)', marginTop:'3px' }}>
            Week of {new Date().toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' })}
          </p>
        </div>
        <div style={{ display:'flex', gap:'10px', alignItems:'center' }}>
          <label style={{ display:'flex', alignItems:'center', gap:'8px', fontSize:'12px', color:'var(--text-muted)', cursor:'pointer' }}>
            <input type="checkbox" checked={showWeekends} onChange={e => setShowWeekends(e.target.checked)}
              style={{ accentColor:'var(--accent-blue)' }} />
            Show Weekends
          </label>
          <button className="btn btn-primary" style={{ fontSize:'12px' }}>+ New Algo</button>
        </div>
      </div>

      {/* Grid */}
      <div style={{
        display:'grid',
        gridTemplateColumns: `repeat(${showWeekends ? 7 : 5}, 1fr)`,
        gap:'12px',
      }}>
        {DAYS.map(day => (
          <div key={day}>
            {/* Day header */}
            <div style={{
              background:'var(--bg-secondary)',
              border:'1px solid var(--bg-border)',
              borderRadius:'7px 7px 0 0',
              padding:'10px 14px',
              display:'flex', alignItems:'center', justifyContent:'space-between',
              marginBottom:'6px',
            }}>
              <span style={{ fontWeight:700, fontSize:'12px', letterSpacing:'0.08em', color:'var(--text-muted)' }}>{day}</span>
              <span style={{
                fontSize:'11px', fontWeight:600,
                color: algoCounts[day] > 0 ? 'var(--accent-blue)' : 'var(--text-dim)',
              }}>
                {algoCounts[day] > 0 ? `${algoCounts[day]} algo${algoCounts[day] > 1 ? 's' : ''}` : '—'}
              </span>
            </div>

            {/* Algo cells */}
            <div style={{ minHeight:'120px' }}>
              {(SAMPLE_ALGOS[day] || []).map(algo => (
                <AlgoCell key={algo.id} algo={algo} />
              ))}

              {/* Drop zone hint */}
              {(SAMPLE_ALGOS[day] || []).length === 0 && (
                <div style={{
                  border:'1px dashed var(--bg-border)', borderRadius:'6px',
                  padding:'20px', textAlign:'center',
                  color:'var(--text-dim)', fontSize:'11px',
                }}>
                  Drop algo here
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Weekend columns */}
        {showWeekends && ['SAT','SUN'].map(day => (
          <div key={day}>
            <div style={{
              background:'var(--bg-secondary)',
              border:'1px solid var(--bg-border)',
              borderRadius:'7px 7px 0 0',
              padding:'10px 14px',
              display:'flex', alignItems:'center', justifyContent:'space-between',
              marginBottom:'6px', opacity:0.6,
            }}>
              <span style={{ fontWeight:700, fontSize:'12px', letterSpacing:'0.08em', color:'var(--text-muted)' }}>{day}</span>
              <span style={{ fontSize:'10px', color:'var(--text-dim)' }}>Rare</span>
            </div>
            <div style={{
              border:'1px dashed rgba(63,65,67,0.5)', borderRadius:'6px',
              padding:'20px', textAlign:'center',
              color:'var(--text-dim)', fontSize:'11px',
            }}>
              Drop algo here
            </div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div style={{ display:'flex', gap:'16px', marginTop:'20px', flexWrap:'wrap' }}>
        {Object.entries(STATUS_CONFIG).map(([key, s]) => (
          <div key={key} style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'11px', color:'var(--text-muted)' }}>
            <span style={{ width:'8px', height:'8px', borderRadius:'50%', background:s.color, display:'inline-block' }} />
            {s.label}
          </div>
        ))}
      </div>
    </div>
  )
}
EOF

# ─── ORDERS PAGE ──────────────────────────────────────────────────────────────

cat > frontend/src/pages/OrdersPage.tsx << 'EOF'
import { useState } from 'react'

const DAYS = ['MON','TUE','WED','THU','FRI']

const SAMPLE_ORDERS = [
  {
    algoName:'AWS-1', account:'Karthik', mtm: 4320, mtmSL:-5000, mtmTP:10000,
    legs:[
      { id:'L1', status:'open',   symbol:'NIFTY 22500CE NFO 27MAR25', dir:'BUY',  lots:'1 (50)',  entry:'ORB High: 187.0', fillPrice:187.0, fillTime:'09:17:32', ltp:213.5, slOrig:150, slActual:175, target:280, exitPrice:null, exitTime:null, reason:null, pnl:1325,  journeyLevel:'1'  },
      { id:'L2', status:'open',   symbol:'NIFTY 22500PE NFO 27MAR25', dir:'BUY',  lots:'1 (50)',  entry:'ORB Low:  142.5', fillPrice:142.5, fillTime:'09:17:32', ltp:118.2, slOrig:110, slActual:110, target:200, exitPrice:null, exitTime:null, reason:null, pnl:-1215, journeyLevel:'2'  },
      { id:'L3', status:'closed', symbol:'NIFTY 22400CE NFO 27MAR25', dir:'BUY',  lots:'1 (50)',  entry:'Direct',          fillPrice:155.0, fillTime:'09:30:00', ltp:null,  slOrig:120, slActual:null,target:220, exitPrice:120,  exitTime:'10:15:22', reason:'SL', pnl:-1750, journeyLevel:'1.1'},
    ]
  },
  {
    algoName:'TF-BUY', account:'Mom', mtm: -800, mtmSL:-3000, mtmTP:6000,
    legs:[
      { id:'L4', status:'open',   symbol:'BANKNIFTY 48000CE NFO 26MAR25', dir:'BUY', lots:'2 (30)', entry:'W&T Up 5%: 210.0', fillPrice:210.0, fillTime:'09:45:10', ltp:198.5, slOrig:180, slActual:185, target:280, exitPrice:null, exitTime:null, reason:null, pnl:-575, journeyLevel:'1' },
    ]
  },
]

const STATUS_STYLE: Record<string, { color:string, bg:string }> = {
  open:   { color:'#22C55E', bg:'rgba(34,197,94,0.12)'  },
  closed: { color:'#6B7280', bg:'rgba(107,114,128,0.12)'},
  error:  { color:'#EF4444', bg:'rgba(239,68,68,0.12)'  },
  pending:{ color:'#F59E0B', bg:'rgba(245,158,11,0.12)' },
}

export default function OrdersPage() {
  const [activeDay, setActiveDay] = useState('MON')
  const [hidePnl, setHidePnl] = useState(false)

  const totalMTM = SAMPLE_ORDERS.reduce((s, g) => s + g.mtm, 0)

  return (
    <div>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'16px' }}>
        <h1 style={{ fontFamily:"'ADLaM Display', serif", fontSize:'22px', fontWeight:400 }}>Orders</h1>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <span style={{ fontSize:'12px', color:'var(--text-muted)' }}>Total MTM:</span>
          <span style={{
            fontSize:'16px', fontWeight:700,
            color: totalMTM >= 0 ? 'var(--green)' : 'var(--red)',
          }}>
            {hidePnl ? '₹ ••••' : `${totalMTM >= 0 ? '+' : ''}₹${totalMTM.toLocaleString('en-IN')}`}
          </span>
          <button className="btn btn-ghost" style={{ fontSize:'11px' }} onClick={() => setHidePnl(!hidePnl)}>
            {hidePnl ? '👁 Show' : '🙈 Hide'} P&L
          </button>
        </div>
      </div>

      {/* Day tabs */}
      <div style={{ display:'flex', gap:'4px', marginBottom:'20px', borderBottom:'1px solid var(--bg-border)', paddingBottom:'0' }}>
        {DAYS.map(d => (
          <button key={d} onClick={() => setActiveDay(d)} style={{
            padding:'8px 16px', fontSize:'12px', fontWeight:600,
            border:'none', cursor:'pointer', borderRadius:'5px 5px 0 0',
            background: activeDay === d ? 'var(--bg-surface)' : 'transparent',
            color: activeDay === d ? 'var(--accent-blue)' : 'var(--text-muted)',
            borderBottom: activeDay === d ? '2px solid var(--accent-blue)' : '2px solid transparent',
          }}>{d}</button>
        ))}
      </div>

      {/* Algo groups */}
      {SAMPLE_ORDERS.map((group, gi) => (
        <div key={gi} style={{ marginBottom:'16px' }}>
          {/* Group header */}
          <div style={{
            background:'var(--bg-secondary)',
            border:'1px solid var(--bg-border)',
            borderRadius:'7px 7px 0 0',
            padding:'10px 16px',
            display:'flex', alignItems:'center', gap:'16px',
          }}>
            <span style={{ fontWeight:700, fontSize:'14px', color:'var(--accent-blue)' }}>{group.algoName}</span>
            <span style={{ fontSize:'12px', color:'var(--text-muted)' }}>{group.account}</span>
            <span style={{ fontSize:'11px', color:'var(--text-dim)' }}>
              MTM SL: <span style={{ color:'var(--red)' }}>₹{group.mtmSL.toLocaleString('en-IN')}</span>
              &nbsp;&nbsp;MTM TP: <span style={{ color:'var(--green)' }}>₹{group.mtmTP.toLocaleString('en-IN')}</span>
            </span>
            <div style={{ marginLeft:'auto', display:'flex', gap:'8px' }}>
              {['RUN','RE','SQ','SYNC'].map(action => (
                <button key={action} className="btn btn-ghost" style={{ fontSize:'10px', padding:'3px 8px' }}>{action}</button>
              ))}
              <span style={{
                fontWeight:700, fontSize:'14px',
                color: group.mtm >= 0 ? 'var(--green)' : 'var(--red)',
                marginLeft:'8px',
              }}>
                {hidePnl ? '₹••••' : `${group.mtm >= 0 ? '+' : ''}₹${group.mtm.toLocaleString('en-IN')}`}
              </span>
            </div>
          </div>

          {/* Orders table */}
          <div style={{ border:'1px solid var(--bg-border)', borderTop:'none', borderRadius:'0 0 7px 7px', overflow:'hidden' }}>
            <table className="staax-table">
              <thead>
                <tr>
                  {['Leg','Status','Symbol / Strike','Lots','Entry Cond.','Fill Price','LTP','SL (A/O)','Target','Exit','Reason','P&L'].map(h => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {group.legs.map(leg => {
                  const st = STATUS_STYLE[leg.status] || STATUS_STYLE.open
                  return (
                    <tr key={leg.id}>
                      <td style={{ color:'var(--text-muted)', fontSize:'11px' }}>{leg.journeyLevel}</td>
                      <td>
                        <span className="tag" style={{ color:st.color, background:st.bg, fontSize:'10px' }}>
                          {leg.status.toUpperCase()}
                        </span>
                      </td>
                      <td>
                        <div style={{ fontSize:'12px', color:'var(--text)' }}>{leg.symbol}</div>
                        <div style={{ fontSize:'10px', color: leg.dir==='BUY' ? 'var(--green)' : 'var(--red)', marginTop:'1px' }}>{leg.dir}</div>
                      </td>
                      <td style={{ color:'var(--text-muted)' }}>{leg.lots}</td>
                      <td style={{ color:'var(--text-muted)', fontSize:'11px' }}>{leg.entry}</td>
                      <td style={{ fontWeight:600 }}>{leg.fillPrice}</td>
                      <td style={{ color: leg.ltp && leg.ltp > leg.fillPrice ? 'var(--green)' : 'var(--red)', fontWeight:600 }}>
                        {leg.ltp || '—'}
                      </td>
                      <td style={{ fontSize:'11px' }}>
                        {leg.slActual && <span style={{ color:'var(--amber)' }}>A: {leg.slActual}</span>}
                        {leg.slActual && <br />}
                        <span style={{ color:'var(--text-muted)' }}>O: {leg.slOrig}</span>
                      </td>
                      <td style={{ color:'var(--text-muted)' }}>{leg.target}</td>
                      <td style={{ color:'var(--text-muted)', fontSize:'11px' }}>
                        {leg.exitPrice ? `${leg.exitPrice}` : '—'}
                        {leg.exitTime && <div style={{ fontSize:'10px', color:'var(--text-dim)' }}>{leg.exitTime}</div>}
                      </td>
                      <td>
                        {leg.reason
                          ? <span className="tag" style={{ color:'var(--red)', background:'rgba(239,68,68,0.1)', fontSize:'10px' }}>{leg.reason}</span>
                          : <span style={{ color:'var(--text-dim)' }}>—</span>
                        }
                      </td>
                      <td style={{ fontWeight:700, color: (leg.pnl||0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                        {hidePnl ? '••••'
                          : leg.pnl != null
                          ? `${leg.pnl >= 0 ? '+' : ''}₹${Math.abs(leg.pnl).toLocaleString('en-IN')}`
                          : '—'
                        }
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}
EOF

# ─── ALGO CONFIG PAGE ─────────────────────────────────────────────────────────

cat > frontend/src/pages/AlgoPage.tsx << 'EOF'
import { useState } from 'react'

function Field({ label, children }: { label:string, children:React.ReactNode }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'5px' }}>
      <label style={{ fontSize:'11px', color:'var(--text-muted)', fontWeight:600, letterSpacing:'0.04em', textTransform:'uppercase' }}>{label}</label>
      {children}
    </div>
  )
}

function Section({ title, children }: { title:string, children:React.ReactNode }) {
  return (
    <div style={{ marginBottom:'20px' }}>
      <div style={{
        fontSize:'11px', fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase',
        color:'var(--accent-blue)', marginBottom:'12px',
        paddingBottom:'6px', borderBottom:'1px solid var(--bg-border)',
      }}>{title}</div>
      {children}
    </div>
  )
}

export default function AlgoPage() {
  const [entryType, setEntryType] = useState('orb')
  const [stratMode, setStratMode] = useState('intraday')
  const [reentryMode, setReentryMode] = useState('at_entry_price')
  const [hasReentry, setHasReentry] = useState(false)
  const [hasJourney, setHasJourney] = useState(false)

  return (
    <div style={{ maxWidth:'1100px' }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'20px' }}>
        <div>
          <h1 style={{ fontFamily:"'ADLaM Display', serif", fontSize:'22px', fontWeight:400 }}>Algo Configuration</h1>
          <p style={{ fontSize:'12px', color:'var(--text-muted)', marginTop:'3px' }}>Configure strategy logic, entry conditions, and risk parameters</p>
        </div>
        <div style={{ display:'flex', gap:'10px' }}>
          <button className="btn btn-ghost">Cancel</button>
          <button className="btn btn-primary">Save Algo</button>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'20px' }}>

        {/* LEFT COLUMN */}
        <div>
          <Section title="Identity">
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px' }}>
              <Field label="Algo Name"><input className="staax-input" placeholder="e.g. AWS-1" /></Field>
              <Field label="Account">
                <select className="staax-select">
                  <option>Karthik (Zerodha)</option>
                  <option>Mom (Angel One)</option>
                </select>
              </Field>
              <Field label="Strategy Mode">
                <select className="staax-select" value={stratMode} onChange={e => setStratMode(e.target.value)}>
                  <option value="intraday">Intraday</option>
                  <option value="btst">BTST</option>
                  <option value="stbt">STBT</option>
                  <option value="positional">Positional</option>
                </select>
              </Field>
              <Field label="Order Type">
                <select className="staax-select">
                  <option>MARKET</option>
                  <option>LIMIT</option>
                </select>
              </Field>
              <Field label="Base Lot Multiplier"><input className="staax-input" type="number" defaultValue={1} min={1} /></Field>
              <Field label="PRACTIX / Live">
                <select className="staax-select">
                  <option>PRACTIX (Paper)</option>
                  <option>Live</option>
                </select>
              </Field>
            </div>
          </Section>

          <Section title="Leg Configuration">
            <div style={{ background:'var(--bg-secondary)', border:'1px solid var(--bg-border)', borderRadius:'7px', padding:'14px', marginBottom:'10px' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'12px' }}>
                <span style={{ fontSize:'12px', fontWeight:700, color:'var(--accent-blue)' }}>Leg 1</span>
                <div style={{ display:'flex', gap:'6px' }}>
                  <span className="tag" style={{ background:'rgba(34,197,94,0.1)', color:'var(--green)', fontSize:'10px' }}>BUY</span>
                  <span className="tag" style={{ background:'rgba(0,176,240,0.1)', color:'var(--accent-blue)', fontSize:'10px' }}>CE</span>
                </div>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px' }}>
                <Field label="Direction">
                  <select className="staax-select"><option>BUY</option><option>SELL</option></select>
                </Field>
                <Field label="Instrument">
                  <select className="staax-select"><option>CE</option><option>PE</option><option>FU</option></select>
                </Field>
                <Field label="Underlying">
                  <select className="staax-select">
                    <option>NIFTY</option><option>BANKNIFTY</option><option>SENSEX</option>
                    <option>MIDCAPNIFTY</option><option>FINNIFTY</option>
                  </select>
                </Field>
                <Field label="Expiry">
                  <select className="staax-select">
                    <option>Current Week</option><option>Next Week</option>
                    <option>Monthly Current</option><option>Monthly Next</option>
                  </select>
                </Field>
                <Field label="Strike">
                  <select className="staax-select">
                    <option>ATM</option>
                    {[...Array(10)].map((_,i) => <option key={i}>ITM{i+1}</option>)}
                    {[...Array(10)].map((_,i) => <option key={i}>OTM{i+1}</option>)}
                    <option>Premium</option><option>Straddle Premium</option>
                  </select>
                </Field>
                <Field label="Lots"><input className="staax-input" type="number" defaultValue={1} min={1} /></Field>
              </div>
            </div>
            <button className="btn btn-ghost" style={{ width:'100%', fontSize:'12px' }}>+ Add Leg</button>
          </Section>

          <Section title="Entry Type">
            <div style={{ display:'flex', gap:'8px', marginBottom:'14px', flexWrap:'wrap' }}>
              {[['direct','Direct'],['orb','ORB'],['wt','W&T'],['orb_wt','ORB + W&T']].map(([v,l]) => (
                <button key={v} onClick={() => setEntryType(v)} style={{
                  padding:'6px 14px', borderRadius:'5px', fontSize:'12px',
                  fontWeight:600, cursor:'pointer', border:'none',
                  background: entryType===v ? 'var(--accent-blue)' : 'var(--bg-surface)',
                  color: entryType===v ? '#000' : 'var(--text-muted)',
                }}>{l}</button>
              ))}
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px' }}>
              <Field label="Entry Time (E:)"><input className="staax-input" type="time" defaultValue="09:16" /></Field>
              {stratMode !== 'intraday' && (
                <Field label="Next Day SL Check (N:)"><input className="staax-input" type="time" defaultValue="09:18" /></Field>
              )}
              {stratMode === 'intraday' && (
                <Field label="Exit Time"><input className="staax-input" type="time" defaultValue="15:10" /></Field>
              )}
              {(entryType==='orb'||entryType==='orb_wt') && (
                <Field label="ORB End Time"><input className="staax-input" type="time" defaultValue="11:16" /></Field>
              )}
              {(entryType==='wt'||entryType==='orb_wt') && <>
                <Field label="W&T Direction">
                  <select className="staax-select"><option>Up</option><option>Down</option></select>
                </Field>
                <Field label="W&T Value"><input className="staax-input" type="number" placeholder="e.g. 10" /></Field>
                <Field label="W&T Unit">
                  <select className="staax-select"><option>Points</option><option>Percent (%)</option></select>
                </Field>
              </>}
            </div>
          </Section>
        </div>

        {/* RIGHT COLUMN */}
        <div>
          <Section title="Stop Loss">
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'10px' }}>
              <Field label="SL Type">
                <select className="staax-select">
                  <option>Points (Instrument)</option>
                  <option>% (Instrument)</option>
                  <option>Points (Underlying)</option>
                  <option>% (Underlying)</option>
                </select>
              </Field>
              <Field label="SL Value"><input className="staax-input" type="number" placeholder="e.g. 30" /></Field>
            </div>
          </Section>

          <Section title="Target (TP)">
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px' }}>
              <Field label="TP Type">
                <select className="staax-select">
                  <option>Points (Instrument)</option>
                  <option>% (Instrument)</option>
                  <option>Points (Underlying)</option>
                  <option>% (Underlying)</option>
                </select>
              </Field>
              <Field label="TP Value"><input className="staax-input" type="number" placeholder="e.g. 60" /></Field>
            </div>
          </Section>

          <Section title="Trailing Stop Loss (TSL)">
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'10px' }}>
              <Field label="For every X"><input className="staax-input" type="number" placeholder="e.g. 5" /></Field>
              <Field label="Move SL by Y"><input className="staax-input" type="number" placeholder="e.g. 3" /></Field>
              <Field label="Unit">
                <select className="staax-select"><option>Points</option><option>Percent (%)</option></select>
              </Field>
            </div>
          </Section>

          <Section title="MTM Controls (Algo Level)">
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'10px' }}>
              <Field label="MTM SL"><input className="staax-input" type="number" placeholder="e.g. 5000" /></Field>
              <Field label="MTM TP"><input className="staax-input" type="number" placeholder="e.g. 10000" /></Field>
              <Field label="Unit">
                <select className="staax-select"><option>Amount (₹)</option><option>Percent (%)</option></select>
              </Field>
            </div>
          </Section>

          <Section title="Re-entry">
            <div style={{ marginBottom:'12px' }}>
              <label style={{ display:'flex', alignItems:'center', gap:'8px', cursor:'pointer', fontSize:'12px' }}>
                <input type="checkbox" checked={hasReentry} onChange={e => setHasReentry(e.target.checked)}
                  style={{ accentColor:'var(--accent-blue)' }} />
                <span style={{ color:'var(--text)' }}>Enable Re-entry</span>
              </label>
            </div>
            {hasReentry && (
              <div style={{ background:'var(--bg-secondary)', border:'1px solid var(--bg-border)', borderRadius:'7px', padding:'14px' }}>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'10px', marginBottom:'12px' }}>
                  <Field label="Mode">
                    <select className="staax-select" value={reentryMode} onChange={e => setReentryMode(e.target.value)}>
                      <option value="at_entry_price">AT ENTRY PRICE</option>
                      <option value="immediate">IMMEDIATE</option>
                      <option value="at_cost">AT COST</option>
                    </select>
                  </Field>
                  <Field label="Trigger On">
                    <select className="staax-select"><option>SL Hit</option><option>TP Hit</option><option>Any Exit</option></select>
                  </Field>
                  <Field label="Max Count">
                    <select className="staax-select">
                      {[1,2,3,4,5].map(n => <option key={n}>{n}</option>)}
                    </select>
                  </Field>
                </div>

                {/* Journey */}
                <div>
                  <label style={{ display:'flex', alignItems:'center', gap:'8px', cursor:'pointer', fontSize:'12px', marginBottom:'10px' }}>
                    <input type="checkbox" checked={hasJourney} onChange={e => setHasJourney(e.target.checked)}
                      style={{ accentColor:'var(--accent-blue)' }} />
                    <span style={{ color:'var(--text)' }}>Configure Journey (per re-entry rules)</span>
                  </label>

                  {hasJourney && (
                    <div style={{ background:'rgba(0,176,240,0.05)', border:'1px solid rgba(0,176,240,0.15)', borderRadius:'6px', padding:'12px' }}>
                      <div style={{ fontSize:'11px', color:'var(--accent-blue)', fontWeight:700, marginBottom:'10px' }}>
                        JOURNEY — Leg 1.1
                      </div>
                      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'8px' }}>
                        <Field label="SL"><input className="staax-input" type="number" placeholder="Inherit" /></Field>
                        <Field label="TP"><input className="staax-input" type="number" placeholder="Inherit" /></Field>
                        <Field label="TSL X"><input className="staax-input" type="number" placeholder="Inherit" /></Field>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </Section>

          <Section title="Order Delays & Error Settings">
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px', marginBottom:'12px' }}>
              <Field label="Entry Delay (secs)"><input className="staax-input" type="number" defaultValue={0} min={0} max={60} /></Field>
              <Field label="Exit Delay (secs)"><input className="staax-input" type="number" defaultValue={0} min={0} max={60} /></Field>
            </div>
            <div style={{ display:'flex', gap:'16px', flexWrap:'wrap' }}>
              {['Exit all on Margin Error','Exit all on Entry Failure'].map(label => (
                <label key={label} style={{ display:'flex', alignItems:'center', gap:'8px', cursor:'pointer', fontSize:'12px' }}>
                  <input type="checkbox" defaultChecked style={{ accentColor:'var(--accent-blue)' }} />
                  <span style={{ color:'var(--text-muted)' }}>{label}</span>
                </label>
              ))}
            </div>
          </Section>
        </div>
      </div>
    </div>
  )
}
EOF

# ─── ACCOUNTS PAGE ────────────────────────────────────────────────────────────

cat > frontend/src/pages/AccountsPage.tsx << 'EOF'
import { useState } from 'react'

const ACCOUNTS = [
  { id:'1', name:'Karthik', broker:'Zerodha', type:'F&O', status:'active',   margin:500000, pnl:84320,  token:'✅ Connected', color:'#00B0F0' },
  { id:'2', name:'Mom',     broker:'Angel One', type:'F&O', status:'active', margin:300000, pnl:-12450, token:'✅ Connected', color:'#22C55E' },
  { id:'3', name:'Wife',    broker:'Angel One', type:'MCX', status:'pending', margin:150000, pnl:0,     token:'⚠️ Phase 2',  color:'#D77B12' },
]

export default function AccountsPage() {
  const [showTokenModal, setShowTokenModal] = useState(false)
  const [requestToken, setRequestToken] = useState('')

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'20px' }}>
        <h1 style={{ fontFamily:"'ADLaM Display', serif", fontSize:'22px', fontWeight:400 }}>Accounts</h1>
        <button className="btn btn-primary" onClick={() => setShowTokenModal(true)}>
          🔑 Zerodha Daily Login
        </button>
      </div>

      {/* Account cards */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:'16px', marginBottom:'28px' }}>
        {ACCOUNTS.map(acc => (
          <div key={acc.id} className="card" style={{ borderTop:`3px solid ${acc.color}` }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'14px' }}>
              <div>
                <div style={{ fontWeight:700, fontSize:'16px' }}>{acc.name}</div>
                <div style={{ fontSize:'11px', color:'var(--text-muted)', marginTop:'2px' }}>{acc.broker} · {acc.type}</div>
              </div>
              <span style={{
                fontSize:'11px', padding:'3px 8px', borderRadius:'4px', fontWeight:600,
                color: acc.status==='active' ? 'var(--green)' : 'var(--amber)',
                background: acc.status==='active' ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)',
              }}>
                {acc.status.toUpperCase()}
              </span>
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px', marginBottom:'14px' }}>
              <div style={{ background:'var(--bg-secondary)', borderRadius:'6px', padding:'10px' }}>
                <div style={{ fontSize:'10px', color:'var(--text-muted)', marginBottom:'4px', textTransform:'uppercase', letterSpacing:'0.05em' }}>FY Margin</div>
                <div style={{ fontWeight:700, fontSize:'15px' }}>₹{(acc.margin/100000).toFixed(1)}L</div>
              </div>
              <div style={{ background:'var(--bg-secondary)', borderRadius:'6px', padding:'10px' }}>
                <div style={{ fontSize:'10px', color:'var(--text-muted)', marginBottom:'4px', textTransform:'uppercase', letterSpacing:'0.05em' }}>FY P&L</div>
                <div style={{ fontWeight:700, fontSize:'15px', color: acc.pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {acc.pnl >= 0 ? '+' : ''}₹{Math.abs(acc.pnl).toLocaleString('en-IN')}
                </div>
              </div>
            </div>

            <div style={{ fontSize:'11px', color:'var(--text-muted)', marginBottom:'12px' }}>
              Token: <span style={{ color:'var(--text)' }}>{acc.token}</span>
            </div>

            {acc.status === 'active' && (
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px', marginBottom:'12px' }}>
                <div>
                  <div style={{ fontSize:'10px', color:'var(--text-muted)', marginBottom:'4px' }}>Global SL</div>
                  <input className="staax-input" type="number" placeholder="₹ Amount" defaultValue={10000} style={{ fontSize:'12px' }} />
                </div>
                <div>
                  <div style={{ fontSize:'10px', color:'var(--text-muted)', marginBottom:'4px' }}>Global TP</div>
                  <input className="staax-input" type="number" placeholder="₹ Amount" defaultValue={25000} style={{ fontSize:'12px' }} />
                </div>
              </div>
            )}

            <div style={{ display:'flex', gap:'8px' }}>
              <button className="btn btn-ghost" style={{ flex:1, fontSize:'11px' }}>Update Margin</button>
              {acc.status === 'active' && <button className="btn btn-ghost" style={{ flex:1, fontSize:'11px' }}>Save Settings</button>}
            </div>
          </div>
        ))}
      </div>

      {/* Token modal */}
      {showTokenModal && (
        <div style={{
          position:'fixed', inset:0, background:'rgba(0,0,0,0.7)',
          display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000,
        }}>
          <div className="card" style={{ width:'460px', border:'1px solid var(--accent-blue)' }}>
            <div style={{ fontWeight:700, fontSize:'16px', marginBottom:'4px' }}>Zerodha Daily Login</div>
            <div style={{ fontSize:'12px', color:'var(--text-muted)', marginBottom:'20px' }}>
              Complete this once each morning before market open.
            </div>

            <div style={{ display:'flex', flexDirection:'column', gap:'14px' }}>
              <div style={{ background:'var(--bg-secondary)', borderRadius:'6px', padding:'14px', fontSize:'12px', color:'var(--text-muted)', lineHeight:1.7 }}>
                <b style={{ color:'var(--text)', display:'block', marginBottom:'6px' }}>Steps:</b>
                1. Click <b style={{ color:'var(--accent-blue)' }}>Open Login Page</b> below<br/>
                2. Login with your Zerodha password + Google Authenticator code<br/>
                3. You'll see an error page (normal) — copy the URL<br/>
                4. Paste it below and click <b style={{ color:'var(--accent-blue)' }}>Connect</b>
              </div>

              <button className="btn btn-ghost" style={{ fontSize:'12px' }}
                onClick={() => window.open('http://127.0.0.1:8000/api/v1/accounts/zerodha/login-url', '_blank')}>
                🔗 Open Zerodha Login Page
              </button>

              <div>
                <label style={{ fontSize:'11px', color:'var(--text-muted)', display:'block', marginBottom:'6px', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em' }}>
                  Paste redirect URL or request_token
                </label>
                <input
                  className="staax-input"
                  placeholder="http://127.0.0.1/?request_token=XXXXXX&..."
                  value={requestToken}
                  onChange={e => setRequestToken(e.target.value)}
                />
              </div>

              <div style={{ display:'flex', gap:'10px' }}>
                <button className="btn btn-ghost" style={{ flex:1 }} onClick={() => setShowTokenModal(false)}>Cancel</button>
                <button className="btn btn-primary" style={{ flex:2 }}
                  onClick={() => { alert('Token submitted! (API call goes here)'); setShowTokenModal(false); }}>
                  ✅ Connect Zerodha
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
EOF

# ─── REPORTS PAGE ─────────────────────────────────────────────────────────────

cat > frontend/src/pages/ReportsPage.tsx << 'EOF'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

const EQUITY_DATA = [
  {month:'Apr',pnl:12400},{month:'May',pnl:28900},{month:'Jun',pnl:21200},
  {month:'Jul',pnl:45600},{month:'Aug',pnl:38400},{month:'Sep',pnl:61200},
  {month:'Oct',pnl:54800},{month:'Nov',pnl:72300},{month:'Dec',pnl:68900},
  {month:'Jan',pnl:84100},{month:'Feb',pnl:79200},{month:'Mar',pnl:91500},
]

const CUMULATIVE = EQUITY_DATA.map((d,i) => ({
  ...d, cumulative: EQUITY_DATA.slice(0,i+1).reduce((s,x) => s+x.pnl, 0)
}))

const ALGO_METRICS = [
  { name:'AWS-1',  totalPnl:48320, avgDay:1250, maxProfit:8400, maxLoss:-3200, winPct:68, lossPct:32, mdd:-9800, roi:9.7 },
  { name:'TF-BUY', totalPnl:22180, avgDay:820,  maxProfit:6200, maxLoss:-2100, winPct:61, lossPct:39, mdd:-6400, roi:7.4 },
  { name:'S1',     totalPnl:15600, avgDay:610,  maxProfit:4100, maxLoss:-1800, winPct:55, lossPct:45, mdd:-4200, roi:5.2 },
  { name:'MDS-1',  totalPnl:5400,  avgDay:280,  maxProfit:2200, maxLoss:-900,  winPct:52, lossPct:48, mdd:-2100, roi:3.6 },
]

const CALENDAR = Array.from({length:31},(_,i)=>({
  day:i+1,
  pnl: i%7===6||i%7===0 ? null : (Math.random()>0.4 ? Math.floor(Math.random()*8000)-1000 : -Math.floor(Math.random()*3000)),
}))

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background:'var(--bg-surface)', border:'1px solid var(--bg-border)', borderRadius:'6px', padding:'10px 14px' }}>
      <div style={{ fontSize:'11px', color:'var(--text-muted)', marginBottom:'4px' }}>{label}</div>
      <div style={{ fontWeight:700, color:'var(--accent-blue)' }}>₹{payload[0].value?.toLocaleString('en-IN')}</div>
    </div>
  )
}

export default function ReportsPage() {
  const totalPnl = 91500
  const margin   = 500000
  const roi      = ((totalPnl/margin)*100).toFixed(1)

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'20px' }}>
        <h1 style={{ fontFamily:"'ADLaM Display', serif", fontSize:'22px', fontWeight:400 }}>Reports</h1>
        <div style={{ display:'flex', gap:'10px', alignItems:'center' }}>
          <select className="staax-select" style={{ width:'140px' }}>
            <option>FY 2024–25</option><option>FY 2023–24</option>
          </select>
          <select className="staax-select" style={{ width:'140px' }}>
            <option>All Accounts</option><option>Karthik</option><option>Mom</option>
          </select>
          <button className="btn btn-ghost" style={{ fontSize:'11px' }}>⬇ Download CSV</button>
        </div>
      </div>

      {/* Summary stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5, 1fr)', gap:'12px', marginBottom:'24px' }}>
        {[
          { label:'FY Total P&L',    value:`₹${totalPnl.toLocaleString('en-IN')}`, color:'var(--green)'        },
          { label:'ROI vs Margin',   value:`${roi}%`,                               color:'var(--accent-blue)' },
          { label:'Daily Avg P&L',   value:'₹1,820',                                color:'var(--text)'        },
          { label:'Best Day',        value:'₹8,400',                                color:'var(--green)'       },
          { label:'Worst Day',       value:'-₹3,200',                               color:'var(--red)'         },
        ].map(s => (
          <div key={s.label} className="card" style={{ textAlign:'center' }}>
            <div style={{ fontSize:'10px', color:'var(--text-muted)', marginBottom:'6px', textTransform:'uppercase', letterSpacing:'0.05em' }}>{s.label}</div>
            <div style={{ fontWeight:700, fontSize:'18px', color:s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Equity curve */}
      <div className="card" style={{ marginBottom:'24px' }}>
        <div style={{ fontSize:'12px', fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:'16px' }}>
          Equity Curve — FY 2024–25
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={CUMULATIVE}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="month" tick={{ fill:'#9CA3AF', fontSize:11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill:'#9CA3AF', fontSize:11 }} axisLine={false} tickLine={false}
              tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} />
            <Tooltip content={<CustomTooltip />} />
            <Line type="monotone" dataKey="cumulative" stroke="#00B0F0" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Per-algo metrics */}
      <div className="card" style={{ marginBottom:'24px' }}>
        <div style={{ fontSize:'12px', fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:'14px' }}>
          Per-Algo Metrics
        </div>
        <table className="staax-table">
          <thead>
            <tr>
              {['Algo','Total P&L','Avg/Day','Best Day','Worst Day','Win %','Loss %','MDD','ROI'].map(h => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ALGO_METRICS.map((a,i) => (
              <tr key={i}>
                <td style={{ fontWeight:700, color:'var(--accent-blue)' }}>{a.name}</td>
                <td style={{ color:'var(--green)', fontWeight:600 }}>₹{a.totalPnl.toLocaleString('en-IN')}</td>
                <td>₹{a.avgDay.toLocaleString('en-IN')}</td>
                <td style={{ color:'var(--green)' }}>₹{a.maxProfit.toLocaleString('en-IN')}</td>
                <td style={{ color:'var(--red)' }}>₹{Math.abs(a.maxLoss).toLocaleString('en-IN')}</td>
                <td style={{ color:'var(--green)' }}>{a.winPct}%</td>
                <td style={{ color:'var(--red)' }}>{a.lossPct}%</td>
                <td style={{ color:'var(--amber)' }}>₹{Math.abs(a.mdd).toLocaleString('en-IN')}</td>
                <td style={{ color:'var(--accent-blue)', fontWeight:600 }}>{a.roi}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Trade Calendar */}
      <div className="card">
        <div style={{ fontSize:'12px', fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:'14px' }}>
          Trade Calendar — March 2025
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(7, 1fr)', gap:'4px' }}>
          {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => (
            <div key={d} style={{ textAlign:'center', fontSize:'10px', color:'var(--text-dim)', padding:'6px 0', fontWeight:600, letterSpacing:'0.05em' }}>{d}</div>
          ))}
          {/* Empty cells for first week */}
          {[...Array(5)].map((_,i) => <div key={`e${i}`} />)}
          {CALENDAR.slice(0,26).map(day => (
            <div key={day.day} style={{
              padding:'8px 4px', borderRadius:'5px', textAlign:'center',
              background: day.pnl === null ? 'var(--bg-secondary)'
                : day.pnl > 0 ? `rgba(34,197,94,${Math.min(day.pnl/8000,1)*0.3+0.08})`
                : `rgba(239,68,68,${Math.min(Math.abs(day.pnl)/3000,1)*0.3+0.08})`,
              cursor: day.pnl !== null ? 'pointer' : 'default',
            }}>
              <div style={{ fontSize:'11px', color:'var(--text-muted)', marginBottom:'2px' }}>{day.day}</div>
              {day.pnl !== null && (
                <div style={{ fontSize:'10px', fontWeight:600, color: day.pnl > 0 ? 'var(--green)' : 'var(--red)' }}>
                  {day.pnl > 0 ? '+' : ''}{(day.pnl/1000).toFixed(1)}k
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
EOF

# ─── LOGIN PAGE ───────────────────────────────────────────────────────────────

cat > frontend/src/pages/LoginPage.tsx << 'EOF'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

export default function LoginPage() {
  const [password, setPassword] = useState('')
  const navigate = useNavigate()

  return (
    <div style={{
      height:'100vh', display:'flex', alignItems:'center', justifyContent:'center',
      background:'var(--bg-primary)',
      backgroundImage:'radial-gradient(ellipse at 20% 50%, rgba(0,176,240,0.06) 0%, transparent 50%), radial-gradient(ellipse at 80% 50%, rgba(215,123,18,0.04) 0%, transparent 50%)',
    }}>
      <div style={{ width:'360px' }}>
        {/* Logo */}
        <div style={{ textAlign:'center', marginBottom:'40px' }}>
          <div style={{ fontFamily:"'ADLaM Display', serif", fontSize:'42px', color:'var(--accent-blue)', letterSpacing:'0.08em' }}>STAAX</div>
          <div style={{ fontSize:'12px', color:'var(--text-muted)', marginTop:'4px', letterSpacing:'0.15em', textTransform:'uppercase' }}>
            Algo Trading Platform
          </div>
        </div>

        {/* Card */}
        <div className="card" style={{ border:'1px solid rgba(0,176,240,0.2)' }}>
          <div style={{ marginBottom:'20px' }}>
            <label style={{ fontSize:'11px', color:'var(--text-muted)', fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', display:'block', marginBottom:'8px' }}>
              Password
            </label>
            <input
              className="staax-input"
              type="password"
              placeholder="Enter platform password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && navigate('/grid')}
              autoFocus
            />
          </div>

          <button
            className="btn btn-primary"
            style={{ width:'100%', padding:'10px', fontSize:'14px', fontWeight:700 }}
            onClick={() => navigate('/grid')}
          >
            Enter STAAX
          </button>
        </div>

        <div style={{ textAlign:'center', marginTop:'20px', fontSize:'11px', color:'var(--text-dim)' }}>
          Personal platform · Not for distribution
        </div>
      </div>
    </div>
  )
}
EOF

echo ""
echo "✅ Phase 1C UI files created!"
echo ""
echo "Now run:"
echo "  cd frontend"
echo "  npm run dev"
echo ""
echo "Open http://localhost:3000 in your browser"
echo ""
echo "Then commit:"
echo "  cd .."
echo "  git add ."
echo "  git commit -m 'Phase 1C: Complete STAAX UI — Smart Grid, Orders, Algo Config, Reports, Accounts'"
echo "  git push origin feature/ui-phase1c"
