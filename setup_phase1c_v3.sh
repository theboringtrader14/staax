#!/bin/bash
# STAAX Phase 1C v3 — Full UI Rewrite
# Run from: cd ~/STAXX/staax && bash setup_phase1c_v3.sh

echo "🚀 Applying Phase 1C v3..."

# ─── APP.TSX — Remove Algo from nav, add Dashboard ───────────────────────────
cat > frontend/src/App.tsx << 'EOF'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from '@/components/layout/Layout'
import GridPage from '@/pages/GridPage'
import OrdersPage from '@/pages/OrdersPage'
import AlgoPage from '@/pages/AlgoPage'
import ReportsPage from '@/pages/ReportsPage'
import AccountsPage from '@/pages/AccountsPage'
import LoginPage from '@/pages/LoginPage'
import DashboardPage from '@/pages/DashboardPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="grid"      element={<GridPage />} />
          <Route path="orders"    element={<OrdersPage />} />
          <Route path="algo/new"  element={<AlgoPage />} />
          <Route path="algo/:id"  element={<AlgoPage />} />
          <Route path="reports"   element={<ReportsPage />} />
          <Route path="accounts"  element={<AccountsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
EOF

# ─── SIDEBAR — No Algo Config link ───────────────────────────────────────────
cat > frontend/src/components/layout/Sidebar.tsx << 'EOF'
import { NavLink } from 'react-router-dom'

const nav = [
  { path:'/dashboard', label:'Dashboard',  icon:'⬡' },
  { path:'/grid',      label:'Smart Grid', icon:'⊞' },
  { path:'/orders',    label:'Orders',     icon:'≡' },
  { path:'/reports',   label:'Reports',    icon:'◈' },
  { path:'/accounts',  label:'Accounts',   icon:'◉' },
]

export default function Sidebar() {
  return (
    <nav style={{
      width:'200px', minWidth:'200px',
      background:'var(--bg-secondary)',
      borderRight:'1px solid var(--bg-border)',
      display:'flex', flexDirection:'column',
    }}>
      <div style={{ padding:'20px 20px 24px', borderBottom:'1px solid var(--bg-border)' }}>
        <div style={{ fontFamily:"'ADLaM Display', serif", fontSize:'24px', color:'var(--accent-blue)', letterSpacing:'0.05em' }}>STAAX</div>
        <div style={{ fontSize:'10px', color:'var(--text-muted)', marginTop:'2px', letterSpacing:'0.1em' }}>ALGO TRADING</div>
      </div>
      <div style={{ flex:1, paddingTop:'8px' }}>
        {nav.map(item => (
          <NavLink key={item.path} to={item.path} style={({ isActive }) => ({
            display:'flex', alignItems:'center', gap:'12px',
            padding:'11px 20px', textDecoration:'none',
            color: isActive ? 'var(--accent-blue)' : 'var(--text-muted)',
            background: isActive ? 'rgba(0,176,240,0.08)' : 'transparent',
            borderLeft: isActive ? '2px solid var(--accent-blue)' : '2px solid transparent',
            fontSize:'13px', transition:'all 0.12s',
            fontWeight: isActive ? '600' : '400',
          })}>
            <span style={{ fontSize:'16px', lineHeight:1 }}>{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </div>
      <div style={{ padding:'16px 20px', borderTop:'1px solid var(--bg-border)' }}>
        <div style={{ fontSize:'10px', color:'var(--text-dim)', letterSpacing:'0.05em' }}>v0.1.0 · Phase 1C</div>
      </div>
    </nav>
  )
}
EOF

# ─── TOPBAR — Global account filter, live P&L in title ───────────────────────
cat > frontend/src/components/layout/TopBar.tsx << 'EOF'
import { useState, useEffect } from 'react'

const ACCOUNTS = ['All Accounts','Karthik','Mom']
const LIVE_PNL = 4320  // TODO: wire to real API

export default function TopBar() {
  const [isPractix, setIsPractix]         = useState(true)
  const [activeAccount, setActiveAccount] = useState('All Accounts')
  const [time, setTime]                   = useState(new Date())

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    // Update browser tab title with live P&L
    document.title = `STAAX · ${LIVE_PNL >= 0 ? '+' : ''}₹${LIVE_PNL.toLocaleString('en-IN')}`
    return () => clearInterval(t)
  }, [])

  const timeStr = time.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', second:'2-digit', timeZone:'Asia/Kolkata' })

  return (
    <header style={{
      height:'52px', minHeight:'52px',
      background:'var(--bg-secondary)',
      borderBottom:'1px solid var(--bg-border)',
      display:'flex', alignItems:'center',
      justifyContent:'space-between',
      padding:'0 24px', gap:'16px',
    }}>
      <div style={{ display:'flex', alignItems:'center', gap:'16px' }}>
        <span style={{ color:'var(--text-muted)', fontSize:'13px' }}>
          Welcome, <span style={{ color:'var(--text)', fontWeight:600 }}>Karthikeyan</span>
        </span>
        <span style={{ color:'var(--bg-border)' }}>|</span>
        <span style={{ fontSize:'12px', color:'var(--text-muted)', fontFamily:'monospace' }}>IST {timeStr}</span>
        <span style={{ color:'var(--bg-border)' }}>|</span>
        <span style={{ fontSize:'13px', fontWeight:700, color: LIVE_PNL >= 0 ? 'var(--green)' : 'var(--red)' }}>
          {LIVE_PNL >= 0 ? '+' : ''}₹{LIVE_PNL.toLocaleString('en-IN')}
        </span>
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
        {/* Global account filter — applies to all pages */}
        <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
          <span style={{ fontSize:'11px', color:'var(--text-dim)' }}>Account:</span>
          <select className="staax-select" value={activeAccount}
            onChange={e => setActiveAccount(e.target.value)}
            style={{ width:'150px', fontSize:'12px' }}>
            {ACCOUNTS.map(a => <option key={a}>{a}</option>)}
          </select>
        </div>
        <button onClick={() => setIsPractix(!isPractix)} style={{
          display:'flex', alignItems:'center', gap:'8px',
          background: isPractix ? 'rgba(215,123,18,0.12)' : 'rgba(34,197,94,0.12)',
          border:`1px solid ${isPractix ? 'rgba(215,123,18,0.4)' : 'rgba(34,197,94,0.4)'}`,
          borderRadius:'5px', padding:'4px 12px',
          color: isPractix ? 'var(--accent-amber)' : 'var(--green)',
          fontSize:'11px', fontWeight:'700', letterSpacing:'0.08em', cursor:'pointer',
        }}>
          <span style={{
            width:'6px', height:'6px', borderRadius:'50%',
            background: isPractix ? 'var(--accent-amber)' : 'var(--green)',
            boxShadow: isPractix ? '0 0 6px var(--accent-amber)' : '0 0 6px var(--green)',
          }} />
          {isPractix ? 'PRACTIX' : 'LIVE'}
        </button>
        <button style={{
          background:'var(--bg-surface)', border:'1px solid var(--bg-border)',
          borderRadius:'5px', width:'32px', height:'32px',
          display:'flex', alignItems:'center', justifyContent:'center',
          cursor:'pointer', color:'var(--text-muted)', fontSize:'14px', position:'relative',
        }}>
          🔔
          <span style={{ position:'absolute', top:'4px', right:'4px', width:'7px', height:'7px', borderRadius:'50%', background:'var(--red)' }} />
        </button>
      </div>
    </header>
  )
}
EOF

# ─── DASHBOARD PAGE — System startup panel ───────────────────────────────────
cat > frontend/src/pages/DashboardPage.tsx << 'EOF'
import { useState, useEffect } from 'react'

type ServiceStatus = 'running'|'stopped'|'starting'|'stopping'

interface Service {
  id: string
  name: string
  desc: string
  status: ServiceStatus
  detail: string
}

const INIT_SERVICES: Service[] = [
  { id:'db',      name:'PostgreSQL',   desc:'Database',          status:'stopped', detail:'localhost:5432' },
  { id:'redis',   name:'Redis',        desc:'Cache / LTP Store', status:'stopped', detail:'localhost:6379' },
  { id:'backend', name:'Backend API',  desc:'FastAPI :8000',     status:'stopped', detail:'http://localhost:8000' },
  { id:'ws',      name:'Market Feed',  desc:'Zerodha WebSocket', status:'stopped', detail:'NSE live tick data' },
]

const STATUS_COLOR: Record<ServiceStatus, string> = {
  running:  'var(--green)',
  stopped:  'var(--text-dim)',
  starting: 'var(--accent-amber)',
  stopping: 'var(--accent-amber)',
}

const STATUS_BG: Record<ServiceStatus, string> = {
  running:  'rgba(34,197,94,0.12)',
  stopped:  'rgba(107,114,128,0.08)',
  starting: 'rgba(245,158,11,0.12)',
  stopping: 'rgba(245,158,11,0.12)',
}

export default function DashboardPage() {
  const [services, setServices] = useState<Service[]>(INIT_SERVICES)
  const [log, setLog]           = useState<string[]>(['STAAX Dashboard ready. Start services to begin trading.'])
  const [zerodhaConnected, setZerodhaConnected] = useState(false)

  const addLog = (msg: string) => {
    const ts = new Date().toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', second:'2-digit' })
    setLog(l => [`[${ts}] ${msg}`, ...l.slice(0,49)])
  }

  const setStatus = (id: string, status: ServiceStatus) => {
    setServices(s => s.map(x => x.id === id ? { ...x, status } : x))
  }

  const startService = async (id: string) => {
    setStatus(id, 'starting')
    addLog(`Starting ${id}...`)
    await new Promise(r => setTimeout(r, 1200))
    setStatus(id, 'running')
    addLog(`✅ ${id} is running`)
  }

  const stopService = async (id: string) => {
    setStatus(id, 'stopping')
    addLog(`Stopping ${id}...`)
    await new Promise(r => setTimeout(r, 800))
    setStatus(id, 'stopped')
    addLog(`⛔ ${id} stopped`)
  }

  const startAll = async () => {
    addLog('Starting all services...')
    for (const svc of services) {
      if (svc.status !== 'running') await startService(svc.id)
    }
    addLog('✅ All services running. Ready to trade.')
  }

  const stopAll = async () => {
    addLog('Stopping all services...')
    for (const svc of [...services].reverse()) {
      if (svc.status === 'running') await stopService(svc.id)
    }
    addLog('Session ended.')
  }

  const allRunning = services.every(s => s.status === 'running')
  const allStopped = services.every(s => s.status === 'stopped')

  const STATS = [
    { label:'Active Algos',   value:'3',           color:'var(--accent-blue)' },
    { label:'Open Positions', value:'5',            color:'var(--green)'       },
    { label:'Today P&L',      value:'+₹4,320',      color:'var(--green)'       },
    { label:'FY P&L',         value:'+₹91,500',     color:'var(--green)'       },
  ]

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'20px' }}>
        <div>
          <h1 style={{ fontFamily:"'ADLaM Display', serif", fontSize:'22px', fontWeight:400 }}>Dashboard</h1>
          <p style={{ fontSize:'12px', color:'var(--text-muted)', marginTop:'2px' }}>System status · Start / stop services</p>
        </div>
        <div style={{ display:'flex', gap:'10px' }}>
          <button className="btn btn-ghost" onClick={stopAll} disabled={allStopped}>⛔ Stop All</button>
          <button className="btn btn-primary" onClick={startAll} disabled={allRunning}>▶ Start Session</button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'12px', marginBottom:'20px' }}>
        {STATS.map(s => (
          <div key={s.label} style={{ background:'var(--bg-surface)', border:'1px solid var(--bg-border)', borderRadius:'7px', padding:'14px' }}>
            <div style={{ fontSize:'10px', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'6px' }}>{s.label}</div>
            <div style={{ fontSize:'20px', fontWeight:700, color:s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'20px' }}>
        {/* Services panel */}
        <div style={{ background:'var(--bg-surface)', border:'1px solid var(--bg-border)', borderRadius:'8px', padding:'16px' }}>
          <div style={{ fontSize:'11px', fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:'14px' }}>
            Services
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
            {services.map(svc => (
              <div key={svc.id} style={{
                display:'flex', alignItems:'center', justifyContent:'space-between',
                padding:'10px 14px', borderRadius:'6px',
                background: STATUS_BG[svc.status],
                border:`1px solid ${STATUS_COLOR[svc.status]}22`,
              }}>
                <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                  <span style={{
                    width:'8px', height:'8px', borderRadius:'50%', flexShrink:0,
                    background: STATUS_COLOR[svc.status],
                    boxShadow: svc.status === 'running' ? `0 0 6px ${STATUS_COLOR[svc.status]}` : 'none',
                    animation: svc.status === 'starting' || svc.status === 'stopping' ? 'pulse 1s infinite' : 'none',
                  }} />
                  <div>
                    <div style={{ fontSize:'13px', fontWeight:600 }}>{svc.name}</div>
                    <div style={{ fontSize:'10px', color:'var(--text-dim)', marginTop:'1px' }}>{svc.detail}</div>
                  </div>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                  <span style={{ fontSize:'10px', color:STATUS_COLOR[svc.status], fontWeight:600, textTransform:'uppercase' }}>
                    {svc.status}
                  </span>
                  {svc.status === 'stopped' && (
                    <button className="btn btn-ghost" style={{ fontSize:'10px', padding:'3px 8px' }}
                      onClick={() => startService(svc.id)}>Start</button>
                  )}
                  {svc.status === 'running' && (
                    <button className="btn btn-danger" style={{ fontSize:'10px', padding:'3px 8px' }}
                      onClick={() => stopService(svc.id)}>Stop</button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Zerodha token */}
          <div style={{ marginTop:'14px', padding:'12px 14px', background:'var(--bg-secondary)', borderRadius:'6px', border:'1px solid var(--bg-border)' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: zerodhaConnected ? '0' : '10px' }}>
              <div>
                <div style={{ fontSize:'12px', fontWeight:600 }}>Zerodha Token</div>
                <div style={{ fontSize:'10px', color: zerodhaConnected ? 'var(--green)' : 'var(--amber)', marginTop:'2px' }}>
                  {zerodhaConnected ? '✅ Connected for today' : '⚠️ Login required'}
                </div>
              </div>
              <button className="btn btn-ghost" style={{ fontSize:'11px' }}
                onClick={() => { setZerodhaConnected(true); addLog('✅ Zerodha token set') }}>
                {zerodhaConnected ? 'Re-login' : '🔑 Login'}
              </button>
            </div>
          </div>
        </div>

        {/* Log */}
        <div style={{ background:'var(--bg-secondary)', border:'1px solid var(--bg-border)', borderRadius:'8px', padding:'16px' }}>
          <div style={{ fontSize:'11px', fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:'12px' }}>
            System Log
          </div>
          <div style={{
            fontFamily:'monospace', fontSize:'11px', color:'var(--text-muted)',
            height:'280px', overflowY:'auto', display:'flex', flexDirection:'column', gap:'3px',
          }}>
            {log.map((line, i) => (
              <div key={i} style={{
                color: line.includes('✅') ? 'var(--green)'
                  : line.includes('⛔') ? 'var(--red)'
                  : line.includes('Starting') || line.includes('Stopping') ? 'var(--accent-amber)'
                  : 'var(--text-muted)',
              }}>{line}</div>
            ))}
          </div>
        </div>
      </div>

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
    </div>
  )
}
EOF

# ─── SMART GRID — Cycle pie in algo column ────────────────────────────────────
cat > frontend/src/pages/GridPage.tsx << 'EOF'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

const DAYS = ['MON','TUE','WED','THU','FRI']
const WEEKENDS = ['SAT','SUN']

type CellStatus = 'no_trade'|'algo_active'|'order_pending'|'open'|'algo_closed'|'error'

interface GridCell {
  multiplier: number
  status: CellStatus
  practix: boolean
  entry: string
  nextSL?: string
}

interface Algo {
  id: string
  name: string
  account: string
  // Day statuses for cycle pie (today's overall status across all cells)
  todayStatus: CellStatus
}

const ALGOS: Algo[] = [
  { id:'1', name:'AWS-1',  account:'Karthik', todayStatus:'open'        },
  { id:'2', name:'TF-BUY', account:'Mom',     todayStatus:'algo_active' },
  { id:'3', name:'S1',     account:'Karthik', todayStatus:'no_trade'    },
  { id:'4', name:'MDS-1',  account:'Mom',     todayStatus:'error'       },
]

const INIT_GRID: Record<string, Record<string, GridCell>> = {
  '1': {
    MON: { multiplier:1, status:'open',         practix:true,  entry:'09:16', nextSL:'09:18' },
    TUE: { multiplier:1, status:'algo_closed',  practix:false, entry:'09:16', nextSL:'09:18' },
    WED: { multiplier:2, status:'algo_active',  practix:true,  entry:'09:16' },
    FRI: { multiplier:1, status:'no_trade',     practix:true,  entry:'09:16' },
  },
  '2': {
    MON: { multiplier:2, status:'algo_active',   practix:true, entry:'09:30' },
    WED: { multiplier:1, status:'order_pending', practix:true, entry:'09:30' },
    THU: { multiplier:2, status:'open',          practix:true, entry:'09:30' },
  },
  '3': {
    MON: { multiplier:1, status:'no_trade', practix:true, entry:'09:20' },
    THU: { multiplier:1, status:'open',     practix:true, entry:'09:20' },
  },
  '4': {
    TUE: { multiplier:3, status:'error',    practix:true, entry:'09:30' },
    FRI: { multiplier:1, status:'no_trade', practix:true, entry:'09:30' },
  },
}

const STATUS_CFG: Record<CellStatus, { label:string, color:string, bg:string, pct:number }> = {
  no_trade:      { label:'No Trade',  color:'#6B7280', bg:'rgba(107,114,128,0.12)', pct:0   },
  algo_active:   { label:'Active',    color:'#00B0F0', bg:'rgba(0,176,240,0.12)',   pct:30  },
  order_pending: { label:'Pending',   color:'#F59E0B', bg:'rgba(245,158,11,0.12)',  pct:50  },
  open:          { label:'Open',      color:'#22C55E', bg:'rgba(34,197,94,0.12)',   pct:75  },
  algo_closed:   { label:'Closed',    color:'#16a34a', bg:'rgba(22,163,74,0.12)',   pct:100 },
  error:         { label:'Error',     color:'#EF4444', bg:'rgba(239,68,68,0.12)',   pct:60  },
}

// Cycle pie SVG — shows how far through the day lifecycle the algo is
function CyclePie({ status }: { status: CellStatus }) {
  const cfg = STATUS_CFG[status]
  const r = 14, cx = 16, cy = 16
  const circumference = 2 * Math.PI * r
  const offset = circumference * (1 - cfg.pct / 100)
  return (
    <svg width="32" height="32" style={{ flexShrink:0 }}>
      {/* Track */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
      {/* Progress */}
      {cfg.pct > 0 && (
        <circle cx={cx} cy={cy} r={r} fill="none"
          stroke={cfg.color} strokeWidth="3"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      )}
      {/* Center dot */}
      <circle cx={cx} cy={cy} r="4" fill={cfg.color} opacity="0.8" />
    </svg>
  )
}

export default function GridPage() {
  const navigate = useNavigate()
  const [grid, setGrid]             = useState(INIT_GRID)
  const [showWeekends, setShowWeekends] = useState(false)
  const [editing, setEditing]       = useState<{algoId:string,day:string}|null>(null)
  const [editVal, setEditVal]       = useState('')
  const [dragAlgoId, setDragAlgoId] = useState<string|null>(null)

  const visibleDays = showWeekends ? [...DAYS, ...WEEKENDS] : DAYS

  const updateMultiplier = (algoId:string, day:string, val:number) => {
    if (val < 1) return
    setGrid(g => ({ ...g, [algoId]: { ...g[algoId], [day]: { ...g[algoId][day], multiplier:val } } }))
  }

  const removeCell = (algoId:string, day:string) => {
    setGrid(g => { const u = { ...g[algoId] }; delete u[day]; return { ...g, [algoId]:u } })
  }

  const handleDrop = (algoId:string, day:string) => {
    if (!dragAlgoId || dragAlgoId !== algoId || grid[algoId]?.[day]) return
    setGrid(g => ({ ...g, [algoId]: { ...g[algoId], [day]: { multiplier:1, status:'algo_active', practix:true, entry:'09:16' } } }))
    setDragAlgoId(null)
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'12px' }}>
        <div>
          <h1 style={{ fontFamily:"'ADLaM Display', serif", fontSize:'22px', fontWeight:400 }}>Smart Grid</h1>
          <p style={{ fontSize:'12px', color:'var(--text-muted)', marginTop:'2px' }}>
            Week of {new Date().toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' })}
          </p>
        </div>
        <div style={{ display:'flex', gap:'10px', alignItems:'center' }}>
          <label style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'12px', color:'var(--text-muted)', cursor:'pointer' }}>
            <input type="checkbox" checked={showWeekends} onChange={e => setShowWeekends(e.target.checked)}
              style={{ accentColor:'var(--accent-blue)' }} />
            Show Weekends
          </label>
          <button className="btn btn-primary" style={{ fontSize:'12px' }}
            onClick={() => navigate('/algo/new')}>
            + New Algo
          </button>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display:'flex', gap:'14px', marginBottom:'12px', flexWrap:'wrap',
        padding:'7px 12px', background:'var(--bg-secondary)', borderRadius:'6px', border:'1px solid var(--bg-border)' }}>
        {Object.entries(STATUS_CFG).map(([key, s]) => (
          <div key={key} style={{ display:'flex', alignItems:'center', gap:'5px', fontSize:'11px', color:'var(--text-muted)' }}>
            <span style={{ width:'8px', height:'8px', borderRadius:'50%', background:s.color, display:'inline-block', flexShrink:0 }} />
            {s.label}
          </div>
        ))}
        <span style={{ marginLeft:'auto', fontSize:'10px', color:'var(--text-dim)' }}>Drag algo → day cell to deploy</span>
      </div>

      {/* Grid table */}
      <div style={{ overflowX:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <colgroup>
            <col style={{ width:'180px' }} />
            {visibleDays.map(d => <col key={d} style={{ width:'140px' }} />)}
          </colgroup>
          <thead>
            <tr>
              <th style={{ padding:'9px 14px', textAlign:'left', background:'var(--bg-secondary)', border:'1px solid var(--bg-border)',
                fontSize:'11px', color:'var(--text-muted)', fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase' }}>
                ALGO
              </th>
              {visibleDays.map(day => (
                <th key={day} style={{ padding:'9px 14px', textAlign:'center', background:'var(--bg-secondary)',
                  border:'1px solid var(--bg-border)', fontSize:'11px', fontWeight:700, letterSpacing:'0.08em',
                  textTransform:'uppercase',
                  color: WEEKENDS.includes(day) ? 'var(--text-dim)' : 'var(--text-muted)' }}>
                  {day}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ALGOS.map(algo => (
              <tr key={algo.id}>
                {/* Algo cell with cycle pie */}
                <td draggable onDragStart={() => setDragAlgoId(algo.id)} onDragEnd={() => setDragAlgoId(null)}
                  style={{ padding:'10px 14px', background:'var(--bg-secondary)', border:'1px solid var(--bg-border)', cursor:'grab' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                    <CyclePie status={algo.todayStatus} />
                    <div>
                      <div style={{ fontWeight:700, fontSize:'13px', color:'var(--text)' }}>{algo.name}</div>
                      <div style={{ fontSize:'10px', color:'var(--text-muted)', marginTop:'1px' }}>{algo.account}</div>
                    </div>
                  </div>
                </td>
                {visibleDays.map(day => {
                  const cell = grid[algo.id]?.[day]
                  const s    = cell ? STATUS_CFG[cell.status] : null
                  return (
                    <td key={day} onDragOver={e => e.preventDefault()} onDrop={() => handleDrop(algo.id, day)}
                      style={{ padding:'5px', border:'1px solid var(--bg-border)', verticalAlign:'top' }}>
                      {cell && s ? (
                        <div style={{ background:'var(--bg-secondary)', borderLeft:`3px solid ${s.color}`,
                          borderRadius:'5px', padding:'8px', position:'relative' }}>
                          <button onClick={() => removeCell(algo.id, day)} style={{
                            position:'absolute', top:'3px', right:'3px', background:'none', border:'none',
                            cursor:'pointer', color:'var(--text-dim)', fontSize:'11px', padding:'2px 4px',
                          }}
                            onMouseEnter={e => (e.currentTarget.style.color='var(--red)')}
                            onMouseLeave={e => (e.currentTarget.style.color='var(--text-dim)')}>✕</button>
                          <div style={{ marginBottom:'5px' }}>
                            <span style={{ fontSize:'9px', fontWeight:700, letterSpacing:'0.05em',
                              color:s.color, background:s.bg, padding:'2px 5px', borderRadius:'3px' }}>
                              {s.label.toUpperCase()}
                            </span>
                          </div>
                          <div style={{ display:'flex', alignItems:'center', gap:'4px', marginBottom:'3px' }}>
                            <span style={{ fontSize:'10px', color:'var(--text-muted)' }}>M:</span>
                            {editing?.algoId===algo.id && editing?.day===day ? (
                              <input autoFocus type="number" min={1} value={editVal}
                                onChange={e => setEditVal(e.target.value)}
                                onBlur={() => { updateMultiplier(algo.id,day,parseInt(editVal)||1); setEditing(null) }}
                                onKeyDown={e => e.key==='Enter' && (updateMultiplier(algo.id,day,parseInt(editVal)||1), setEditing(null))}
                                style={{ width:'36px', background:'var(--bg-primary)', border:'1px solid var(--accent-blue)',
                                  borderRadius:'3px', color:'var(--text)', fontSize:'11px', padding:'1px 4px', fontFamily:'inherit' }} />
                            ) : (
                              <span onClick={() => { setEditing({algoId:algo.id,day}); setEditVal(String(cell.multiplier)) }}
                                style={{ fontSize:'12px', fontWeight:700, color:'var(--accent-blue)', cursor:'text',
                                  padding:'1px 4px', borderRadius:'3px', border:'1px solid transparent' }}
                                onMouseEnter={e => (e.currentTarget.style.borderColor='var(--bg-border)')}
                                onMouseLeave={e => (e.currentTarget.style.borderColor='transparent')}>
                                {cell.multiplier}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize:'10px', color:'var(--text-muted)' }}>E: {cell.entry}</div>
                          {cell.nextSL && <div style={{ fontSize:'10px', color:'var(--accent-amber)' }}>N: {cell.nextSL}</div>}
                          {cell.practix && (
                            <span style={{ fontSize:'8px', fontWeight:700, letterSpacing:'0.06em',
                              color:'var(--accent-amber)', background:'rgba(215,123,18,0.1)',
                              padding:'1px 4px', borderRadius:'2px', marginTop:'4px', display:'inline-block' }}>PRACTIX</span>
                          )}
                        </div>
                      ) : (
                        <div style={{ minHeight:'60px', border:'1px dashed var(--bg-border)', borderRadius:'5px',
                          display:'flex', alignItems:'center', justifyContent:'center',
                          color:'var(--text-dim)', fontSize:'10px',
                          background: dragAlgoId===algo.id ? 'rgba(0,176,240,0.05)' : 'transparent',
                          borderColor: dragAlgoId===algo.id ? 'var(--accent-blue)' : 'var(--bg-border)',
                          opacity: dragAlgoId===algo.id ? 0.9 : 0.4, transition:'all 0.15s' }}>
                          {dragAlgoId===algo.id ? 'Drop here' : '—'}
                        </div>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
EOF

# ─── ALGO CONFIG — Compact horizontal leg design ──────────────────────────────
cat > frontend/src/pages/AlgoPage.tsx << 'EOF'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

// Instrument codes
const INST_CODES: Record<string,string> = {
  NF:'NIFTY', BN:'BANKNIFTY', SX:'SENSEX', MN:'MIDCAPNIFTY', FN:'FINNIFTY',
  GM:'GOLDM', SM:'SILVERM', CO:'CRUDEOIL',
}

const STRIKE_OPTIONS = [
  ...Array.from({length:10},(_,i) => `ITM${10-i}`),
  'ATM',
  ...Array.from({length:10},(_,i) => `OTM${i+1}`),
]

type FeatureKey = 'wt'|'sl'|'re'|'tp'|'tsl'
const FEATURES: {key:FeatureKey, label:string, color:string}[] = [
  { key:'wt',  label:'W&T',    color:'#9CA3AF' },
  { key:'sl',  label:'SL',     color:'#EF4444' },
  { key:'re',  label:'RE',     color:'#F59E0B' },
  { key:'tp',  label:'TP',     color:'#22C55E' },
  { key:'tsl', label:'TSL',    color:'#00B0F0' },
]

interface LegValues {
  wt:  { direction:string, value:string, unit:string }
  sl:  { type:string, value:string }
  re:  { mode:string, trigger:string, count:string }
  tp:  { type:string, value:string }
  tsl: { x:string, y:string, unit:string }
}

interface Leg {
  id:          string
  no:          number
  instType:    string   // 'OP' or 'FU'
  instCode:    string   // 'NF','BN', etc
  direction:   string
  optType:     string   // 'CE' or 'PE'
  strikeMode:  string   // 'leg'|'premium'|'straddle'
  strikeType:  string
  premiumVal:  string
  lots:        string
  expiry:      string
  active:      Record<FeatureKey, boolean>
  vals:        LegValues
}

const defaultLeg = (n:number): Leg => ({
  id: `leg-${Date.now()}-${n}`, no:n,
  instType:'OP', instCode:'NF',
  direction:'BUY', optType:'CE',
  strikeMode:'leg', strikeType:'atm',
  premiumVal:'', lots:'1', expiry:'Current',
  active:{ wt:false, sl:false, re:false, tp:false, tsl:false },
  vals:{
    wt:  { direction:'up', value:'', unit:'pts' },
    sl:  { type:'pts_instrument', value:'' },
    re:  { mode:'at_entry_price', trigger:'sl', count:'1' },
    tp:  { type:'pts_instrument', value:'' },
    tsl: { x:'', y:'', unit:'pts' },
  }
})

// ── Compact feature value row ─────────────────────────────────────────────────
function FeatureValues({ leg, onUpdate }: { leg:Leg, onUpdate:(id:string,u:Partial<Leg>)=>void }) {
  const active = FEATURES.filter(f => leg.active[f.key])
  if (!active.length) return null
  const u = (key:FeatureKey, sub:string, val:string) => {
    onUpdate(leg.id, { vals:{ ...leg.vals, [key]:{ ...leg.vals[key as keyof LegValues], [sub]:val } } })
  }
  return (
    <div style={{ display:'flex', gap:'8px', flexWrap:'wrap', marginTop:'6px',
      paddingTop:'6px', borderTop:'1px solid var(--bg-border)' }}>
      {active.map(f => {
        const v = leg.vals[f.key]
        const color = f.color
        const labelStyle: React.CSSProperties = { fontSize:'10px', color, fontWeight:700, marginRight:'4px', whiteSpace:'nowrap' }
        const inp = (sub:string, placeholder:string, w='60px') => (
          <input value={(v as any)[sub]||''} onChange={e => u(f.key,sub,e.target.value)}
            placeholder={placeholder}
            style={{ width:w, background:'var(--bg-primary)', border:`1px solid ${color}44`,
              borderRadius:'3px', color:'var(--text)', fontSize:'11px', padding:'2px 6px', fontFamily:'inherit' }} />
        )
        const sel = (sub:string, opts:[string,string][]) => (
          <select value={(v as any)[sub]||''} onChange={e => u(f.key,sub,e.target.value)}
            style={{ background:'var(--bg-primary)', border:`1px solid ${color}44`,
              borderRadius:'3px', color:'var(--text)', fontSize:'11px', padding:'2px 4px', fontFamily:'inherit' }}>
            {opts.map(([val,lbl]) => <option key={val} value={val}>{lbl}</option>)}
          </select>
        )
        return (
          <div key={f.key} style={{ display:'flex', alignItems:'center', gap:'4px',
            background:`${color}08`, border:`1px solid ${color}22`, borderRadius:'5px', padding:'4px 8px' }}>
            <span style={labelStyle}>{f.label}:</span>
            {f.key==='wt'  && <>{sel('direction',[['up','↑Up'],['down','↓Down']])} {inp('value','val')} {sel('unit',[['pts','pts'],['pct','%']])}</>}
            {f.key==='sl'  && <>{sel('type',[['pts_instrument','Pts(Inst)'],['pct_instrument','%(Inst)'],['pts_underlying','Pts(Und)'],['pct_underlying','%(Und)']])} {inp('value','val')}</>}
            {f.key==='re'  && <>{sel('mode',[['at_entry_price','@Entry'],['immediate','Immediate'],['at_cost','@Cost']])} {sel('trigger',[['sl','SL'],['tp','TP'],['any','Any']])} {sel('count',[['1','1x'],['2','2x'],['3','3x'],['4','4x'],['5','5x']])}</>}
            {f.key==='tp'  && <>{sel('type',[['pts_instrument','Pts(Inst)'],['pct_instrument','%(Inst)'],['pts_underlying','Pts(Und)'],['pct_underlying','%(Und)']])} {inp('value','val')}</>}
            {f.key==='tsl' && <>{inp('x','X')} <span style={{fontSize:'10px',color:'var(--text-dim)'}}>→</span> {inp('y','Y')} {sel('unit',[['pts','pts'],['pct','%']])}</>}
          </div>
        )
      })}
    </div>
  )
}

// ── Compact Leg Row ───────────────────────────────────────────────────────────
function LegRow({ leg, index, total, onUpdate, onRemove, onMove }: {
  leg:Leg, index:number, total:number,
  onUpdate:(id:string,u:Partial<Leg>)=>void,
  onRemove:(id:string)=>void,
  onMove:(id:string,dir:'up'|'down')=>void,
}) {
  const u = (k:keyof Leg, v:any) => onUpdate(leg.id, { [k]:v })
  const toggleFeature = (key:FeatureKey) => {
    onUpdate(leg.id, { active:{ ...leg.active, [key]:!leg.active[key] } })
  }

  const selStyle = { background:'var(--bg-primary)', border:'1px solid var(--bg-border)',
    borderRadius:'4px', color:'var(--text)', fontSize:'11px', padding:'3px 5px',
    fontFamily:'inherit', cursor:'pointer' }

  return (
    <div style={{ background:'var(--bg-secondary)', border:'1px solid var(--bg-border)',
      borderRadius:'7px', padding:'10px 12px', marginBottom:'6px' }}>
      {/* Main row */}
      <div style={{ display:'flex', alignItems:'center', gap:'6px', flexWrap:'wrap' }}>
        {/* Reorder arrows */}
        <div style={{ display:'flex', flexDirection:'column', gap:'1px', flexShrink:0 }}>
          <button onClick={() => onMove(leg.id,'up')} disabled={index===0}
            style={{ background:'none', border:'none', cursor:index===0?'not-allowed':'pointer',
              color:index===0?'var(--text-dim)':'var(--text-muted)', fontSize:'10px', lineHeight:1, padding:'1px 3px' }}>▲</button>
          <button onClick={() => onMove(leg.id,'down')} disabled={index===total-1}
            style={{ background:'none', border:'none', cursor:index===total-1?'not-allowed':'pointer',
              color:index===total-1?'var(--text-dim)':'var(--text-muted)', fontSize:'10px', lineHeight:1, padding:'1px 3px' }}>▼</button>
        </div>

        {/* Leg number */}
        <span style={{ fontSize:'11px', fontWeight:700, color:'var(--text-dim)', minWidth:'22px', textAlign:'center' }}>
          L{leg.no}
        </span>

        {/* OP / FU toggle */}
        <button onClick={() => u('instType', leg.instType==='OP'?'FU':'OP')} style={{
          padding:'3px 8px', borderRadius:'4px', fontSize:'11px', fontWeight:700,
          background: leg.instType==='OP' ? 'rgba(0,176,240,0.15)' : 'rgba(215,123,18,0.15)',
          color: leg.instType==='OP' ? 'var(--accent-blue)' : 'var(--accent-amber)',
          border: `1px solid ${leg.instType==='OP'?'rgba(0,176,240,0.3)':'rgba(215,123,18,0.3)'}`,
          cursor:'pointer', flexShrink:0,
        }}>{leg.instType}</button>

        {/* Instrument code */}
        <select value={leg.instCode} onChange={e => u('instCode',e.target.value)} style={selStyle}>
          {Object.entries(INST_CODES).map(([code,name]) => (
            <option key={code} value={code} title={name}>{code}</option>
          ))}
        </select>

        {/* Direction */}
        <button onClick={() => u('direction', leg.direction==='BUY'?'SELL':'BUY')} style={{
          padding:'3px 10px', borderRadius:'4px', fontSize:'11px', fontWeight:700,
          background: leg.direction==='BUY' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
          color: leg.direction==='BUY' ? 'var(--green)' : 'var(--red)',
          border: `1px solid ${leg.direction==='BUY'?'rgba(34,197,94,0.3)':'rgba(239,68,68,0.3)'}`,
          cursor:'pointer', flexShrink:0,
        }}>{leg.direction}</button>

        {/* CE / PE — only for OP */}
        {leg.instType==='OP' && (
          <button onClick={() => u('optType', leg.optType==='CE'?'PE':'CE')} style={{
            padding:'3px 8px', borderRadius:'4px', fontSize:'11px', fontWeight:700,
            background:'rgba(255,255,255,0.06)', color:'var(--text-muted)',
            border:'1px solid var(--bg-border)', cursor:'pointer', flexShrink:0,
          }}>{leg.optType}</button>
        )}

        {/* Expiry */}
        {leg.instType==='OP' && (
          <select value={leg.expiry} onChange={e => u('expiry',e.target.value)} style={selStyle}>
            <option value="Current">Current</option>
            <option value="Forward">Forward</option>
            <option value="Monthly">Monthly</option>
          </select>
        )}

        {/* Strike mode → value */}
        {leg.instType==='OP' && (
          <>
            <select value={leg.strikeMode} onChange={e => u('strikeMode',e.target.value)} style={selStyle}>
              <option value="leg">Strike</option>
              <option value="premium">Premium</option>
              <option value="straddle">Straddle</option>
            </select>
            {leg.strikeMode==='leg' && (
              <select value={leg.strikeType} onChange={e => u('strikeType',e.target.value)} style={{ ...selStyle, width:'72px' }}>
                {STRIKE_OPTIONS.map(s => <option key={s} value={s.toLowerCase()}>{s}</option>)}
              </select>
            )}
            {(leg.strikeMode==='premium'||leg.strikeMode==='straddle') && (
              <input value={leg.premiumVal} onChange={e => u('premiumVal',e.target.value)}
                placeholder="₹ premium"
                style={{ ...selStyle, width:'80px' }} />
            )}
          </>
        )}

        {/* Lots */}
        <input value={leg.lots} onChange={e => u('lots',e.target.value)} type="number" min={1}
          style={{ ...selStyle, width:'46px', textAlign:'center' }} />

        {/* Separator */}
        <span style={{ color:'var(--bg-border)', fontSize:'16px', flexShrink:0 }}>|</span>

        {/* Feature toggle chips */}
        {FEATURES.map(f => (
          <button key={f.key} onClick={() => toggleFeature(f.key)} style={{
            padding:'3px 10px', borderRadius:'12px', fontSize:'11px', fontWeight:600,
            cursor:'pointer', border:'none', transition:'all 0.12s', flexShrink:0,
            background: leg.active[f.key] ? f.color : 'var(--bg-surface)',
            color: leg.active[f.key] ? '#000' : 'var(--text-dim)',
            opacity: leg.active[f.key] ? 1 : 0.7,
          }}>{f.label}</button>
        ))}

        {/* Remove */}
        <button onClick={() => onRemove(leg.id)} style={{
          marginLeft:'auto', background:'none', border:'1px solid rgba(239,68,68,0.25)',
          color:'var(--red)', borderRadius:'4px', padding:'3px 8px',
          fontSize:'11px', cursor:'pointer', flexShrink:0,
        }}>✕</button>
      </div>

      {/* Feature values row — only when features active */}
      <FeatureValues leg={leg} onUpdate={onUpdate} />
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function AlgoPage() {
  const navigate  = useNavigate()
  const [legs, setLegs] = useState<Leg[]>([defaultLeg(1)])
  const [algoName, setAlgoName] = useState('')
  const [stratMode, setStratMode] = useState('intraday')
  const [entryType, setEntryType] = useState('orb')
  const [days, setDays]   = useState({ M:true, T:false, W:true, T2:true, F:true })
  const [lotMult, setLotMult] = useState('1')
  const [entryTime, setEntryTime] = useState('09:16')
  const [orbEnd,    setOrbEnd]    = useState('11:16')
  const [exitTime,  setExitTime]  = useState('15:10')
  const [nextDayTime, setNextDayTime] = useState('09:18')
  const [account,   setAccount]   = useState('Karthik (Zerodha)')
  const [mtmSL,     setMtmSL]     = useState('')
  const [mtmTP,     setMtmTP]     = useState('')
  const [mtmUnit,   setMtmUnit]   = useState('amt')
  const [entryDelay, setEntryDelay] = useState('0')
  const [exitDelay,  setExitDelay]  = useState('0')
  const [orderType,  setOrderType]  = useState('MARKET')
  const [errorMargin, setErrorMargin] = useState(true)
  const [errorEntry,  setErrorEntry]  = useState(true)
  const [saved,     setSaved]     = useState(false)
  const [saveError, setSaveError] = useState('')

  const DAYS_MAP = [
    {key:'M',label:'M'},{key:'T',label:'T'},{key:'W',label:'W'},{key:'T2',label:'T'},{key:'F',label:'F'}
  ]

  const addLeg    = () => setLegs(l => [...l, defaultLeg(l.length+1)])
  const removeLeg = (id:string) => setLegs(l => l.filter(x=>x.id!==id).map((x,i)=>({...x,no:i+1})))
  const updateLeg = (id:string, u:Partial<Leg>) => setLegs(l => l.map(x => x.id===id?{...x,...u}:x))
  const moveLeg   = (id:string, dir:'up'|'down') => {
    setLegs(l => {
      const i = l.findIndex(x=>x.id===id)
      if ((dir==='up'&&i===0)||(dir==='down'&&i===l.length-1)) return l
      const arr = [...l]
      const ni  = dir==='up'?i-1:i+1
      ;[arr[i],arr[ni]] = [arr[ni],arr[i]]
      return arr.map((x,idx)=>({...x,no:idx+1}))
    })
  }

  const handleSave = () => {
    if (!algoName.trim()) { setSaveError('Algo name required'); return }
    setSaveError('')
    setSaved(true)
    setTimeout(() => { setSaved(false); navigate('/grid') }, 1500)
  }

  const inp = (val:string, set:(v:string)=>void, props={}) => (
    <input value={val} onChange={e=>set(e.target.value)} className="staax-input"
      style={{ fontSize:'12px', ...props }} {...props} />
  )
  const sel = (val:string, set:(v:string)=>void, opts:[string,string][], style={}) => (
    <select value={val} onChange={e=>set(e.target.value)} className="staax-select"
      style={{ fontSize:'12px', ...style }}>
      {opts.map(([v,l])=><option key={v} value={v}>{l}</option>)}
    </select>
  )
  const fieldLabel = (lbl:string) => (
    <span style={{ fontSize:'10px', color:'var(--text-dim)', whiteSpace:'nowrap', fontWeight:600,
      textTransform:'uppercase', letterSpacing:'0.05em' }}>{lbl}</span>
  )

  return (
    <div style={{ maxWidth:'980px' }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'16px' }}>
        <h1 style={{ fontFamily:"'ADLaM Display', serif", fontSize:'22px', fontWeight:400 }}>
          {algoName || 'New Algo'}
        </h1>
        <div style={{ display:'flex', gap:'10px', alignItems:'center' }}>
          {saved && <span style={{ fontSize:'12px', color:'var(--green)', fontWeight:600 }}>✅ Saved!</span>}
          {saveError && <span style={{ fontSize:'12px', color:'var(--red)' }}>{saveError}</span>}
          <button className="btn btn-ghost" onClick={() => navigate('/grid')}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave}>Save Algo</button>
        </div>
      </div>

      {/* ── ALGO-LEVEL CARD ─────────────────────────────────────────────── */}
      <div style={{ background:'var(--bg-surface)', border:'1px solid var(--bg-border)',
        borderRadius:'8px', padding:'14px', marginBottom:'14px' }}>

        {/* Row 1: Name | Lot Multiplier | Strategy | Days | Account */}
        <div style={{ display:'flex', alignItems:'center', gap:'12px', flexWrap:'wrap', marginBottom:'12px' }}>
          <div style={{ display:'flex', flexDirection:'column', gap:'4px', flex:'1 1 160px', maxWidth:'200px' }}>
            {fieldLabel('Algo Name')}
            <input className="staax-input" placeholder="e.g. AWS-1" value={algoName}
              onChange={e=>setAlgoName(e.target.value)} style={{ fontSize:'12px' }} />
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
            {fieldLabel('Lot Mult.')}
            <input className="staax-input" type="number" min={1} value={lotMult}
              onChange={e=>setLotMult(e.target.value)} style={{ width:'60px', fontSize:'12px' }} />
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
            {fieldLabel('Strategy')}
            {sel(stratMode, setStratMode, [
              ['intraday','Intraday'],['btst','BTST'],['stbt','STBT'],['positional','Positional']
            ], { width:'120px' })}
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
            {fieldLabel('Order Type')}
            {sel(orderType, setOrderType, [['MARKET','MARKET'],['LIMIT','LIMIT']], { width:'100px' })}
          </div>
          {/* Day toggles */}
          <div style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
            {fieldLabel('Days')}
            <div style={{ display:'flex', gap:'4px' }}>
              {DAYS_MAP.map(d => (
                <button key={d.key} onClick={() => setDays(ds=>({...ds,[d.key]:!ds[d.key as keyof typeof ds]}))}
                  style={{
                    width:'28px', height:'28px', borderRadius:'50%', fontSize:'11px', fontWeight:700,
                    cursor:'pointer', border:'none', transition:'all 0.12s',
                    background: days[d.key as keyof typeof days] ? 'var(--accent-blue)' : 'var(--bg-secondary)',
                    color:       days[d.key as keyof typeof days] ? '#000' : 'var(--text-dim)',
                  }}>{d.label}</button>
              ))}
            </div>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:'4px', marginLeft:'auto' }}>
            {fieldLabel('Account')}
            {sel(account, setAccount, [
              ['Karthik (Zerodha)','Karthik'],['Mom (Angel One)','Mom']
            ], { width:'130px' })}
          </div>
        </div>

        {/* Row 2: Entry type + times */}
        <div style={{ display:'flex', alignItems:'center', gap:'12px', flexWrap:'wrap', marginBottom:'12px',
          paddingTop:'10px', borderTop:'1px solid var(--bg-border)' }}>
          <div style={{ display:'flex', gap:'4px' }}>
            {[['direct','Direct'],['orb','ORB'],['wt','W&T'],['orb_wt','ORB+W&T']].map(([v,l]) => (
              <button key={v} onClick={() => setEntryType(v)} style={{
                padding:'4px 12px', borderRadius:'4px', fontSize:'11px', fontWeight:600,
                cursor:'pointer', border:'none',
                background: entryType===v ? 'var(--accent-blue)' : 'var(--bg-secondary)',
                color:       entryType===v ? '#000' : 'var(--text-muted)',
              }}>{l}</button>
            ))}
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap' }}>
            <div style={{ display:'flex', flexDirection:'column', gap:'3px' }}>
              {fieldLabel('Entry Time')}
              <input type="time" value={entryTime} onChange={e=>setEntryTime(e.target.value)}
                className="staax-input" style={{ width:'100px', fontSize:'12px' }} />
            </div>
            {(entryType==='orb'||entryType==='orb_wt') && (
              <div style={{ display:'flex', flexDirection:'column', gap:'3px' }}>
                {fieldLabel('ORB End')}
                <input type="time" value={orbEnd} onChange={e=>setOrbEnd(e.target.value)}
                  className="staax-input" style={{ width:'100px', fontSize:'12px' }} />
              </div>
            )}
            {stratMode==='intraday' && (
              <div style={{ display:'flex', flexDirection:'column', gap:'3px' }}>
                {fieldLabel('Exit Time')}
                <input type="time" value={exitTime} onChange={e=>setExitTime(e.target.value)}
                  className="staax-input" style={{ width:'100px', fontSize:'12px' }} />
              </div>
            )}
            {(stratMode==='btst'||stratMode==='stbt'||stratMode==='positional') && (
              <div style={{ display:'flex', flexDirection:'column', gap:'3px' }}>
                {fieldLabel('Next Day SL')}
                <input type="time" value={nextDayTime} onChange={e=>setNextDayTime(e.target.value)}
                  className="staax-input" style={{ width:'100px', fontSize:'12px' }} />
              </div>
            )}
          </div>
        </div>

        {/* Row 3: MTM + Delays + Errors */}
        <div style={{ display:'flex', alignItems:'center', gap:'12px', flexWrap:'wrap',
          paddingTop:'10px', borderTop:'1px solid var(--bg-border)' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
            <span style={{ fontSize:'11px', color:'var(--text-muted)', fontWeight:600 }}>MTM SL:</span>
            <input value={mtmSL} onChange={e=>setMtmSL(e.target.value)} placeholder="None"
              className="staax-input" style={{ width:'80px', fontSize:'12px' }} />
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
            <span style={{ fontSize:'11px', color:'var(--text-muted)', fontWeight:600 }}>MTM TP:</span>
            <input value={mtmTP} onChange={e=>setMtmTP(e.target.value)} placeholder="None"
              className="staax-input" style={{ width:'80px', fontSize:'12px' }} />
          </div>
          {sel(mtmUnit, setMtmUnit, [['amt','₹ Amt'],['pct','% Prem']], { width:'80px' })}
          <span style={{ color:'var(--bg-border)' }}>|</span>
          <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
            <span style={{ fontSize:'11px', color:'var(--text-muted)', fontWeight:600 }}>Entry Delay:</span>
            <input value={entryDelay} onChange={e=>setEntryDelay(e.target.value)} type="number" min={0} max={60}
              className="staax-input" style={{ width:'60px', fontSize:'12px' }} />
            <span style={{ fontSize:'10px', color:'var(--text-dim)' }}>s</span>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
            <span style={{ fontSize:'11px', color:'var(--text-muted)', fontWeight:600 }}>Exit Delay:</span>
            <input value={exitDelay} onChange={e=>setExitDelay(e.target.value)} type="number" min={0} max={60}
              className="staax-input" style={{ width:'60px', fontSize:'12px' }} />
            <span style={{ fontSize:'10px', color:'var(--text-dim)' }}>s</span>
          </div>
          <span style={{ color:'var(--bg-border)' }}>|</span>
          <label style={{ display:'flex', alignItems:'center', gap:'5px', cursor:'pointer', fontSize:'11px', color:'var(--red)' }}>
            <input type="checkbox" checked={errorMargin} onChange={e=>setErrorMargin(e.target.checked)}
              style={{ accentColor:'var(--red)' }} />
            On margin error, exit all
          </label>
          <label style={{ display:'flex', alignItems:'center', gap:'5px', cursor:'pointer', fontSize:'11px', color:'var(--red)' }}>
            <input type="checkbox" checked={errorEntry} onChange={e=>setErrorEntry(e.target.checked)}
              style={{ accentColor:'var(--red)' }} />
            If entry fails, exit all
          </label>
        </div>
      </div>

      {/* ── PER-LEG SECTION ────────────────────────────────────────────── */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'8px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
          <span style={{ fontSize:'11px', fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.08em' }}>
            Legs
          </span>
          <span style={{ fontSize:'9px', padding:'2px 6px', borderRadius:'3px',
            background:'rgba(34,197,94,0.1)', color:'var(--green)', fontWeight:700 }}>
            PER LEG — SL · TP · TSL · W&T · RE
          </span>
          <span style={{ fontSize:'11px', color:'var(--text-dim)' }}>{legs.length} leg{legs.length>1?'s':''}</span>
        </div>
        <button className="btn btn-ghost" style={{ fontSize:'11px' }} onClick={addLeg}>+ Add Leg</button>
      </div>

      {legs.map((leg,i) => (
        <LegRow key={leg.id} leg={leg} index={i} total={legs.length}
          onUpdate={updateLeg} onRemove={removeLeg} onMove={moveLeg} />
      ))}
    </div>
  )
}
EOF

# ─── REPORTS — Full-year FY calendar + compact metrics ───────────────────────
cat > frontend/src/pages/ReportsPage.tsx << 'EOF'
import { useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

const FY_DATA: Record<string, number> = {
  'Apr-24':12400,'May-24':28900,'Jun-24':21200,'Jul-24':45600,
  'Aug-24':38400,'Sep-24':61200,'Oct-24':54800,'Nov-24':72300,
  'Dec-24':68900,'Jan-25':84100,'Feb-25':79200,'Mar-25':91500,
}
const MONTHS_FY = ['Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar']

const CUMULATIVE = MONTHS_FY.map((m,i) => ({
  month:m,
  pnl: Object.values(FY_DATA)[i],
  cumulative: Object.values(FY_DATA).slice(0,i+1).reduce((s,x)=>s+x,0),
}))

const ALGO_METRICS = [
  { name:'AWS-1',  totalPnl:48320, avgDay:1250, maxProfit:8400, maxLoss:-3200, winPct:68, lossPct:32, mdd:-9800,  roi:9.7  },
  { name:'TF-BUY', totalPnl:22180, avgDay:820,  maxProfit:6200, maxLoss:-2100, winPct:61, lossPct:39, mdd:-6400,  roi:7.4  },
  { name:'S1',     totalPnl:15600, avgDay:610,  maxProfit:4100, maxLoss:-1800, winPct:55, lossPct:45, mdd:-4200,  roi:5.2  },
  { name:'MDS-1',  totalPnl:5400,  avgDay:280,  maxProfit:2200, maxLoss:-900,  winPct:52, lossPct:48, mdd:-2100,  roi:3.6  },
]

// Generate fake day P&L for a month
function genDayPnls(month:number, year:number): Record<number,number|null> {
  const daysInMonth = new Date(year, month, 0).getDate()
  const result: Record<number,number|null> = {}
  for (let d=1; d<=daysInMonth; d++) {
    const dow = new Date(year, month-1, d).getDay()
    if (dow===0||dow===6) { result[d]=null; continue }
    const seed = (d*37+month*13+year) % 100
    result[d] = seed>45 ? Math.floor((seed-45)*220) : -Math.floor((45-seed)*110)
  }
  return result
}

// FY months for the full calendar: Apr YYYY → Mar YYYY+1
function fyMonths(fy:string): {month:number,year:number,label:string}[] {
  const startYear = parseInt(fy.split('-')[0])
  const months = [4,5,6,7,8,9,10,11,12,1,2,3]
  return months.map(m => ({
    month:m,
    year: m>=4 ? startYear : startYear+1,
    label: ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m]
  }))
}

interface MiniCalProps {
  month:number; year:number; label:string
  onClick:()=>void; isSelected:boolean
}

function MiniCal({ month, year, label, onClick, isSelected }: MiniCalProps) {
  const pnls     = genDayPnls(month, year)
  const tradeDays = Object.values(pnls).filter(v=>v!==null)
  const winDays  = tradeDays.filter(v=>v!==null && v>0).length
  const lossDays = tradeDays.filter(v=>v!==null && v<=0).length
  const totalDays = winDays+lossDays
  const monthPnl = tradeDays.reduce((s,v)=>s+(v||0),0)
  const firstDow = new Date(year, month-1, 1).getDay()
  const offset   = firstDow===0?4:firstDow-1  // Mon=0

  // Build 5×5 grid (Mon-Fri only)
  const cells: (number|null)[] = []
  let col = 0
  for (let d=1; d<=new Date(year,month,0).getDate(); d++) {
    const dow = new Date(year,month-1,d).getDay()
    if (dow===0||dow===6) continue
    cells.push(d)
  }
  // Pad start
  const padded: (number|null)[] = Array(offset%5).fill(null).concat(cells)

  return (
    <div onClick={onClick} style={{
      background: isSelected ? 'rgba(0,176,240,0.08)' : 'var(--bg-secondary)',
      border:`1px solid ${isSelected ? 'var(--accent-blue)' : 'var(--bg-border)'}`,
      borderRadius:'8px', padding:'10px',
      cursor:'pointer', transition:'all 0.12s',
    }}>
      {/* Month name + P&L */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'4px' }}>
        <span style={{ fontSize:'11px', fontWeight:700, color:isSelected?'var(--accent-blue)':'var(--text)', letterSpacing:'0.06em' }}>
          {label.toUpperCase()}
        </span>
        <span style={{ fontSize:'10px', fontWeight:700, color:monthPnl>=0?'var(--green)':'var(--red)' }}>
          {monthPnl>=0?'+':''}{(monthPnl/1000).toFixed(1)}k
        </span>
      </div>

      {/* Win/loss progress bar */}
      {totalDays>0 && (
        <div style={{ height:'3px', borderRadius:'2px', background:'var(--bg-border)', marginBottom:'6px', overflow:'hidden' }}>
          <div style={{ width:`${(winDays/totalDays)*100}%`, height:'100%',
            background:'var(--green)', borderRadius:'2px', transition:'width 0.3s' }} />
        </div>
      )}

      {/* Win/Loss counts */}
      <div style={{ display:'flex', gap:'8px', marginBottom:'6px' }}>
        <span style={{ fontSize:'9px', color:'var(--green)', fontWeight:600 }}>{winDays}▲</span>
        <span style={{ fontSize:'9px', color:'var(--red)',   fontWeight:600 }}>{lossDays}▼</span>
      </div>

      {/* Day headers */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'2px', marginBottom:'2px' }}>
        {['M','T','W','T','F'].map((d,i) => (
          <div key={i} style={{ textAlign:'center', fontSize:'8px', color:'var(--text-dim)', fontWeight:600 }}>{d}</div>
        ))}
      </div>

      {/* Day dots */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'2px' }}>
        {padded.map((day,i) => {
          if (!day) return <div key={i} />
          const pnl = pnls[day]
          return (
            <div key={i} style={{
              width:'10px', height:'10px', borderRadius:'50%', margin:'0 auto',
              background: pnl===null ? 'transparent'
                : pnl>0 ? 'var(--green)' : 'var(--red)',
            }} />
          )
        })}
      </div>
    </div>
  )
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background:'var(--bg-surface)', border:'1px solid var(--bg-border)', borderRadius:'6px', padding:'10px 14px' }}>
      <div style={{ fontSize:'11px', color:'var(--text-muted)', marginBottom:'4px' }}>{label}</div>
      <div style={{ fontWeight:700, color:'var(--accent-blue)' }}>₹{payload[0].value?.toLocaleString('en-IN')}</div>
    </div>
  )
}

const METRIC_ROWS = [
  { key:'totalPnl',   label:'Overall P&L' },
  { key:'avgDay',     label:'Avg Day P&L'  },
  { key:'maxProfit',  label:'Max Profit'   },
  { key:'maxLoss',    label:'Max Loss'     },
  { key:'winPct',     label:'Win %'        },
  { key:'lossPct',    label:'Loss %'       },
  { key:'mdd',        label:'Max Drawdown' },
  { key:'roi',        label:'ROI'          },
]

export default function ReportsPage() {
  const [fy,           setFy]           = useState('2024-25')
  const [selectedMonth, setSelectedMonth] = useState<string|null>(null)
  const [metricFilter, setMetricFilter] = useState('fy')

  const months = fyMonths(fy)
  const totalPnl = Object.values(FY_DATA).reduce((s,x)=>s+x,0)
  const prevYearPnl = 702440 // FY 2023-24

  const cumulative = (ALGO_METRICS.reduce((s,a)=>s+a.totalPnl,0))

  return (
    <div>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'16px' }}>
        <h1 style={{ fontFamily:"'ADLaM Display', serif", fontSize:'22px', fontWeight:400 }}>Reports</h1>
        <div style={{ display:'flex', gap:'10px', alignItems:'center' }}>
          <select className="staax-select" value={fy} onChange={e=>setFy(e.target.value)} style={{ width:'110px' }}>
            <option value="2024-25">FY 2024–25</option>
            <option value="2023-24">FY 2023–24</option>
          </select>
          <button className="btn btn-ghost" style={{ fontSize:'11px' }}>⬇ CSV</button>
        </div>
      </div>

      {/* Top widgets */}
      <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr', gap:'12px', marginBottom:'20px' }}>
        {/* FY P&L + sparkline */}
        <div style={{ background:'var(--bg-surface)', border:'1px solid var(--bg-border)', borderRadius:'8px', padding:'16px' }}>
          <div style={{ fontSize:'10px', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'4px' }}>
            FY {fy} Total P&L
          </div>
          <div style={{ display:'flex', alignItems:'flex-end', gap:'16px' }}>
            <div>
              <div style={{ fontSize:'28px', fontWeight:700, color:'var(--green)', letterSpacing:'-0.02em' }}>
                ₹{(totalPnl/100000).toFixed(2)}L
              </div>
              <div style={{ fontSize:'11px', color:'var(--green)', marginTop:'2px' }}>
                ▲ {(((totalPnl-prevYearPnl)/prevYearPnl)*100).toFixed(1)}% vs prev year
              </div>
            </div>
            <div style={{ flex:1, height:'50px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={CUMULATIVE}>
                  <Line type="monotone" dataKey="cumulative" stroke="#00B0F0" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
        {/* Monthly P&L */}
        <div style={{ background:'var(--bg-surface)', border:'1px solid var(--bg-border)', borderRadius:'8px', padding:'16px' }}>
          <div style={{ fontSize:'10px', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'4px' }}>
            March P&L
          </div>
          <div style={{ fontSize:'24px', fontWeight:700, color:'var(--green)' }}>₹91,500</div>
          <div style={{ fontSize:'11px', color:'var(--green)', marginTop:'4px' }}>▲ 6.3% vs Feb</div>
        </div>
        {/* Daily P&L */}
        <div style={{ background:'var(--bg-surface)', border:'1px solid var(--bg-border)', borderRadius:'8px', padding:'16px' }}>
          <div style={{ fontSize:'10px', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'4px' }}>
            Today P&L
          </div>
          <div style={{ fontSize:'24px', fontWeight:700, color:'var(--green)' }}>+₹4,320</div>
          <div style={{ fontSize:'11px', color:'var(--text-dim)', marginTop:'4px' }}>2 algos active</div>
        </div>
      </div>

      {/* Full-year FY calendar */}
      <div style={{ background:'var(--bg-surface)', border:'1px solid var(--bg-border)',
        borderRadius:'8px', padding:'16px', marginBottom:'20px' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'14px' }}>
          <div style={{ fontSize:'11px', fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.08em' }}>
            FY {fy} — Full Year Calendar
          </div>
          <div style={{ display:'flex', gap:'12px', fontSize:'11px', color:'var(--text-dim)' }}>
            <span style={{ display:'flex', alignItems:'center', gap:'4px' }}>
              <span style={{ width:'8px', height:'8px', borderRadius:'50%', background:'var(--green)', display:'inline-block' }} />
              Profit day
            </span>
            <span style={{ display:'flex', alignItems:'center', gap:'4px' }}>
              <span style={{ width:'8px', height:'8px', borderRadius:'50%', background:'var(--red)', display:'inline-block' }} />
              Loss day
            </span>
            <span style={{ color:'var(--text-dim)' }}>Click month to expand</span>
          </div>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:'8px' }}>
          {months.map(m => (
            <MiniCal key={`${m.month}-${m.year}`}
              month={m.month} year={m.year} label={m.label}
              onClick={() => setSelectedMonth(selectedMonth===`${m.month}-${m.year}` ? null : `${m.month}-${m.year}`)}
              isSelected={selectedMonth===`${m.month}-${m.year}`}
            />
          ))}
        </div>
      </div>

      {/* Per-algo metrics table */}
      <div style={{ background:'var(--bg-surface)', border:'1px solid var(--bg-border)', borderRadius:'8px', padding:'16px', overflow:'auto' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'12px', flexWrap:'wrap', gap:'10px' }}>
          <div style={{ fontSize:'11px', fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.08em' }}>
            Per-Algo Metrics
          </div>
          <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
            {[['fy','FY'],['month','Month'],['date','Date'],['custom','From–To']].map(([v,l])=>(
              <button key={v} onClick={()=>setMetricFilter(v)} style={{
                padding:'4px 10px', borderRadius:'4px', fontSize:'11px', fontWeight:600,
                cursor:'pointer', border:'none',
                background: metricFilter===v ? 'var(--accent-blue)' : 'var(--bg-secondary)',
                color:       metricFilter===v ? '#000' : 'var(--text-muted)',
              }}>{l}</button>
            ))}
            {metricFilter==='custom' && (
              <>
                <input type="date" className="staax-input" style={{ width:'130px', fontSize:'11px' }} />
                <span style={{ fontSize:'11px', color:'var(--text-dim)' }}>to</span>
                <input type="date" className="staax-input" style={{ width:'130px', fontSize:'11px' }} />
              </>
            )}
            {metricFilter==='month' && (
              <select className="staax-select" style={{ width:'130px', fontSize:'11px' }}>
                {MONTHS_FY.map(m=><option key={m}>{m}</option>)}
              </select>
            )}
            <select className="staax-select" style={{ width:'110px', fontSize:'11px' }}>
              <option>FY {fy}</option>
            </select>
            <button className="btn btn-ghost" style={{ fontSize:'10px', padding:'4px 10px' }}>⬇ CSV</button>
          </div>
        </div>

        {/* Transposed table: rows=metrics, cols=algos */}
        <table className="staax-table">
          <thead>
            <tr>
              <th style={{ minWidth:'120px' }}>Key Metrics</th>
              {ALGO_METRICS.map(a => <th key={a.name}>{a.name}</th>)}
              <th style={{ color:'var(--accent-blue)' }}>Cumulative</th>
            </tr>
          </thead>
          <tbody>
            {METRIC_ROWS.map(row => {
              const isProfit  = (v:number) => row.key==='roi'||row.key==='winPct'||row.key==='totalPnl'||row.key==='avgDay'||row.key==='maxProfit'
              const isLoss    = (v:number) => row.key==='mdd'||row.key==='lossPct'||row.key==='maxLoss'
              const cumVal = ALGO_METRICS.reduce((s,a)=>s+(a as any)[row.key],0)
              return (
                <tr key={row.key}>
                  <td style={{ fontWeight:600, color:'var(--text-muted)', fontSize:'12px' }}>{row.label}</td>
                  {ALGO_METRICS.map(a => {
                    const v = (a as any)[row.key]
                    const color = isProfit(v) ? 'var(--green)' : isLoss(v) ? 'var(--red)' : 'var(--text)'
                    const fmt = (n:number) => {
                      if (row.key==='winPct'||row.key==='lossPct') return `${n}%`
                      if (row.key==='roi') return `${n}%`
                      return `₹${Math.abs(n).toLocaleString('en-IN')}`
                    }
                    return <td key={a.name} style={{ color, fontWeight:600 }}>{fmt(v)}</td>
                  })}
                  <td style={{ color:'var(--accent-blue)', fontWeight:700 }}>
                    {row.key==='winPct'||row.key==='lossPct'||row.key==='roi'
                      ? `${(cumVal/ALGO_METRICS.length).toFixed(1)}%`
                      : `₹${Math.abs(cumVal).toLocaleString('en-IN')}`
                    }
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
EOF

echo ""
echo "✅ Phase 1C v3 applied!"
echo ""
echo "Frontend will auto-reload at http://localhost:3000"
echo ""
echo "Then commit:"
echo "  cd ~/STAXX/staax"
echo "  git add ."
echo "  git commit -m 'Phase 1C v3: Dashboard, compact algo config, full-year calendar, cycle pie, browser tab P&L'"
echo "  git push origin feature/ui-phase1c"
