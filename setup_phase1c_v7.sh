#!/bin/bash
# STAAX Phase 1C v7
# Run from: cd ~/STAXX/staax && bash setup_phase1c_v7.sh

echo "🚀 Applying Phase 1C v7..."

# ─── GLOBAL CSS UPDATES ───────────────────────────────────────────────────────
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
  --text-dim:     #6B7280;
  --btn-h:        32px;
  --page-h-pad:   24px;
  --page-v-pad:   20px;
}

* { box-sizing: border-box; margin:0; padding:0; }

body {
  background: var(--bg-primary);
  color: var(--text);
  font-family: 'Dubai Light', 'Calibri', sans-serif;
  font-size: 13px;
  -webkit-font-smoothing: antialiased;
}

::-webkit-scrollbar       { width:5px; height:5px; }
::-webkit-scrollbar-track  { background: var(--bg-secondary); }
::-webkit-scrollbar-thumb  { background: var(--bg-border); border-radius:3px; }

/* ── Layout ─────────────────────────────────────────────────────── */
.page-content {
  padding: var(--page-v-pad) var(--page-h-pad);
  height: 100%;
  overflow-y: auto;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  min-height: 40px;
}
.page-header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* ── Buttons ─────────────────────────────────────────────────────── */
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: var(--btn-h); padding: 0 14px;
  border-radius: 5px; font-size: 12px; font-weight: 600;
  cursor: pointer; border: none; transition: all 0.15s;
  white-space: nowrap; font-family: inherit;
}
.btn-primary { background: var(--accent-blue); color: #000; }
.btn-primary:hover { background: #00c8ff; }
.btn-danger  { background: rgba(239,68,68,0.15); color: var(--red); border:1px solid rgba(239,68,68,0.3); }
.btn-danger:hover { background: rgba(239,68,68,0.25); }
.btn-ghost   { background: rgba(255,255,255,0.06); color: var(--text-muted); }
.btn-ghost:hover { background: rgba(255,255,255,0.1); color: var(--text); }
.btn:disabled { opacity:0.4; cursor:not-allowed; }

.chip {
  display: inline-flex; align-items: center; justify-content: center;
  height: var(--btn-h); padding: 0 14px;
  border-radius: 5px; font-size: 12px; font-weight: 600;
  cursor: pointer; border: none; transition: all 0.12s; font-family: inherit;
}
.chip-active   { background: var(--accent-blue); color: #000; }
.chip-inactive { background: var(--bg-secondary); color: var(--text-muted); }
.chip-inactive:hover { background: var(--bg-surface); color: var(--text); }

/* ── Table ───────────────────────────────────────────────────────── */
.staax-table { width:100%; border-collapse:collapse; table-layout:fixed; }
.staax-table th {
  background: var(--bg-secondary); color: var(--text-muted);
  font-size: 10px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;
  padding: 8px 10px; text-align: left; border-bottom: 1px solid var(--bg-border);
  white-space: nowrap; overflow: hidden;
}
.staax-table td { padding: 10px 10px; border-bottom: 1px solid rgba(63,65,67,0.5); font-size: 12px; overflow: hidden; }
.staax-table tr:hover td { background: rgba(255,255,255,0.02); }

/* ── Misc ────────────────────────────────────────────────────────── */
.tag { display: inline-flex; align-items: center; padding: 2px 7px; border-radius: 4px; font-size: 10px; font-weight: 700; letter-spacing: 0.03em; }
.card { background: var(--bg-surface); border: 1px solid var(--bg-border); border-radius: 8px; padding: 16px; }
.staax-input {
  background: var(--bg-secondary); border: 1px solid var(--bg-border);
  color: var(--text); border-radius: 5px; padding: 0 10px;
  height: var(--btn-h); font-size: 12px; font-family: inherit; width: 100%;
  transition: border-color 0.15s; colorScheme: dark;
}
.staax-input:focus { outline:none; border-color: var(--accent-blue); }
.staax-input::placeholder { color: var(--text-muted); }
.staax-select {
  background: var(--bg-secondary); border: 1px solid var(--bg-border);
  color: var(--text); border-radius: 5px; padding: 0 28px 0 10px;
  height: var(--btn-h); font-size: 12px; font-family: inherit; cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239CA3AF' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 8px center;
}
.staax-select:focus { outline:none; border-color: var(--accent-blue); }

/* ── Modal ───────────────────────────────────────────────────────── */
.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.65);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000; backdrop-filter: blur(2px);
}
.modal-box {
  background: var(--bg-surface); border: 1px solid var(--bg-border);
  border-radius: 10px; padding: 24px; min-width: 340px; max-width: 520px; width: 90%;
  box-shadow: 0 20px 60px rgba(0,0,0,0.5);
}

/* ── Notification panel ──────────────────────────────────────────── */
.notif-panel {
  position: fixed; top: 52px; right: 0; width: 340px; height: calc(100vh - 52px);
  background: var(--bg-surface); border-left: 1px solid var(--bg-border);
  z-index: 900; overflow-y: auto;
  box-shadow: -4px 0 20px rgba(0,0,0,0.3);
}

@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
@keyframes fadeIn { from{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:translateY(0)} }
EOF

# ─── LAYOUT WRAPPER — consistent page padding ────────────────────────────────
cat > frontend/src/components/layout/Layout.tsx << 'EOF'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import TopBar from './TopBar'

export default function Layout() {
  return (
    <div style={{ display:'flex', height:'100vh', overflow:'hidden' }}>
      <Sidebar />
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
        <TopBar />
        <main style={{ flex:1, overflowY:'auto', padding:'20px 24px' }}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
EOF

# ─── SIDEBAR — Larger icons, fixed alignment ──────────────────────────────────
cat > frontend/src/components/layout/Sidebar.tsx << 'EOF'
import { NavLink } from 'react-router-dom'

const nav = [
  { path:'/dashboard',   label:'Dashboard',         icon:'⬡'  },
  { path:'/grid',        label:'Smart Grid',         icon:'⊞'  },
  { path:'/orders',      label:'Orders',             icon:'☰'  },
  { path:'/reports',     label:'Reports',            icon:'◈'  },
  { path:'/accounts',    label:'Accounts',           icon:'◉'  },
  { path:'/indicators',  label:'Indicator Systems',  icon:'◧'  },
]

export default function Sidebar() {
  return (
    <nav style={{
      width:'216px', minWidth:'216px',
      background:'var(--bg-secondary)',
      borderRight:'1px solid var(--bg-border)',
      display:'flex', flexDirection:'column',
    }}>
      <div style={{
        height:'52px',  // matches TopBar height exactly → seamless separator
        display:'flex', alignItems:'center',
        padding:'0 20px',
        borderBottom:'1px solid var(--bg-border)',
      }}>
        <div>
          <div style={{ fontFamily:"'ADLaM Display', serif", fontSize:'22px', color:'var(--accent-blue)', letterSpacing:'0.05em', lineHeight:1 }}>STAAX</div>
          <div style={{ fontSize:'9px', color:'var(--text-dim)', marginTop:'1px', letterSpacing:'0.14em' }}>ALGO TRADING</div>
        </div>
      </div>

      <div style={{ flex:1, paddingTop:'6px' }}>
        {nav.map(item => (
          <NavLink key={item.path} to={item.path} style={({ isActive }) => ({
            display:'grid',
            gridTemplateColumns:'44px 1fr',
            alignItems:'center',
            padding:'11px 0',
            textDecoration:'none',
            color: isActive ? 'var(--accent-blue)' : 'var(--text-muted)',
            background: isActive ? 'rgba(0,176,240,0.08)' : 'transparent',
            borderLeft: isActive ? '2px solid var(--accent-blue)' : '2px solid transparent',
            fontSize:'13px',
            transition:'all 0.12s',
            fontWeight: isActive ? '600' : '400',
          })}>
            <span style={{ textAlign:'center', fontSize:'18px', lineHeight:1, display:'flex', alignItems:'center', justifyContent:'center' }}>
              {item.icon}
            </span>
            <span style={{ paddingRight:'16px' }}>{item.label}</span>
          </NavLink>
        ))}
      </div>

      <div style={{ padding:'14px 20px', borderTop:'1px solid var(--bg-border)' }}>
        <div style={{ fontSize:'10px', color:'var(--text-dim)', letterSpacing:'0.05em' }}>v0.1.0 · Phase 1C</div>
      </div>
    </nav>
  )
}
EOF

# ─── TOPBAR — Remove "Account:" label, fix heights, notifications panel ───────
cat > frontend/src/components/layout/TopBar.tsx << 'EOF'
import { useState, useEffect } from 'react'

const ACCOUNTS = ['All Accounts','Karthik','Mom']
const LIVE_PNL = 4320

const NOTIFICATIONS = [
  { type:'error',   time:'09:17', msg:'AWS-1 · L3 · Order type rejection — LIMIT not accepted' },
  { type:'warn',    time:'09:15', msg:'TF-BUY · MTM SL at 85% — ₹4,250 / ₹5,000' },
  { type:'success', time:'09:12', msg:'AWS-1 · L1 · ORB High breakout — order placed' },
  { type:'info',    time:'09:00', msg:'Zerodha token refreshed successfully' },
  { type:'error',   time:'08:55', msg:'Backend API connection retry #2' },
]

const NOTIF_COLOR: Record<string,string> = {
  error:'var(--red)', warn:'var(--amber)', success:'var(--green)', info:'var(--accent-blue)'
}

export default function TopBar() {
  const [isPractix, setIsPractix]         = useState(true)
  const [activeAccount, setActiveAccount] = useState('All Accounts')
  const [time, setTime]                   = useState(new Date())
  const [showNotif, setShowNotif]         = useState(false)

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    document.title = `STAAX · ${LIVE_PNL >= 0 ? '+' : ''}₹${LIVE_PNL.toLocaleString('en-IN')}`
    return () => clearInterval(t)
  }, [])

  const timeStr = time.toLocaleTimeString('en-IN', {
    hour:'2-digit', minute:'2-digit', second:'2-digit', timeZone:'Asia/Kolkata', hour12:true
  })

  const unread = NOTIFICATIONS.filter(n => n.type === 'error').length

  return (
    <>
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
            Welcome, <span style={{ color:'var(--text)', fontWeight:600 }}>Karthikeyan</span>
          </span>
          <span style={{ color:'var(--bg-border)' }}>|</span>
          <span style={{ fontSize:'12px', color:'var(--text-muted)', fontFamily:'monospace' }}>IST {timeStr}</span>
          <span style={{ color:'var(--bg-border)' }}>|</span>
          <span style={{ fontSize:'13px', fontWeight:700, color: LIVE_PNL >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {LIVE_PNL >= 0 ? '+' : ''}₹{LIVE_PNL.toLocaleString('en-IN')}
          </span>
        </div>

        {/* Right */}
        <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
          {/* Account selector — no "Account:" label */}
          <select className="staax-select" value={activeAccount}
            onChange={e => setActiveAccount(e.target.value)}
            style={{ width:'150px', fontSize:'12px' }}>
            {ACCOUNTS.map(a => <option key={a}>{a}</option>)}
          </select>

          {/* PRACTIX toggle — matches btn-h */}
          <button onClick={() => setIsPractix(!isPractix)} style={{
            display:'flex', alignItems:'center', gap:'8px',
            height:'var(--btn-h)',
            background: isPractix ? 'rgba(215,123,18,0.12)' : 'rgba(34,197,94,0.12)',
            border:`1px solid ${isPractix ? 'rgba(215,123,18,0.4)' : 'rgba(34,197,94,0.4)'}`,
            borderRadius:'5px', padding:'0 12px',
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

          {/* Bell — same height as other buttons */}
          <button onClick={() => setShowNotif(!showNotif)} style={{
            background: showNotif ? 'rgba(0,176,240,0.12)' : 'var(--bg-surface)',
            border:`1px solid ${showNotif ? 'var(--accent-blue)' : 'var(--bg-border)'}`,
            borderRadius:'5px', width:'var(--btn-h)', height:'var(--btn-h)',
            display:'flex', alignItems:'center', justifyContent:'center',
            cursor:'pointer', color:'var(--text-muted)', fontSize:'15px', position:'relative',
          }}>
            🔔
            {unread > 0 && (
              <span style={{ position:'absolute', top:'5px', right:'5px',
                width:'7px', height:'7px', borderRadius:'50%', background:'var(--red)' }} />
            )}
          </button>
        </div>
      </header>

      {/* Notification slide-in panel */}
      {showNotif && (
        <div className="notif-panel">
          <div style={{ padding:'14px 16px', borderBottom:'1px solid var(--bg-border)',
            display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <span style={{ fontWeight:700, fontSize:'13px' }}>Notifications</span>
            <button onClick={() => setShowNotif(false)}
              style={{ background:'none', border:'none', cursor:'pointer',
                color:'var(--text-muted)', fontSize:'14px' }}>✕</button>
          </div>
          <div style={{ padding:'8px 0' }}>
            {NOTIFICATIONS.map((n, i) => (
              <div key={i} style={{ padding:'10px 16px', borderBottom:'1px solid rgba(63,65,67,0.4)',
                borderLeft:`3px solid ${NOTIF_COLOR[n.type]}`,
                animation:'fadeIn 0.15s ease', marginBottom:'1px' }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'3px' }}>
                  <span style={{ fontSize:'10px', fontWeight:700, color:NOTIF_COLOR[n.type],
                    textTransform:'uppercase' }}>{n.type}</span>
                  <span style={{ fontSize:'10px', color:'var(--text-dim)' }}>{n.time}</span>
                </div>
                <div style={{ fontSize:'12px', color:'var(--text-muted)', lineHeight:1.4 }}>{n.msg}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
EOF

# ─── DASHBOARD — Fixed Zerodha token card height ──────────────────────────────
cat > frontend/src/pages/DashboardPage.tsx << 'EOF'
import { useState } from 'react'

type ServiceStatus = 'running'|'stopped'|'starting'|'stopping'

interface Service { id:string; name:string; desc:string; status:ServiceStatus; detail:string }

const INIT_SERVICES: Service[] = [
  {id:'db',     name:'PostgreSQL',  desc:'Database',          status:'stopped', detail:'localhost:5432'},
  {id:'redis',  name:'Redis',       desc:'Cache / LTP Store', status:'stopped', detail:'localhost:6379'},
  {id:'backend',name:'Backend API', desc:'FastAPI :8000',     status:'stopped', detail:'http://localhost:8000'},
  {id:'ws',     name:'Market Feed', desc:'Zerodha WebSocket', status:'stopped', detail:'NSE live tick data'},
]

const STATUS_COLOR: Record<ServiceStatus,string> = {
  running:'var(--green)', stopped:'var(--text-dim)', starting:'var(--accent-amber)', stopping:'var(--accent-amber)',
}
const STATUS_BG: Record<ServiceStatus,string> = {
  running:'rgba(34,197,94,0.12)', stopped:'rgba(107,114,128,0.08)', starting:'rgba(245,158,11,0.12)', stopping:'rgba(245,158,11,0.12)',
}

const STATS = [
  {label:'Active Algos',   value:'3',       color:'var(--accent-blue)'},
  {label:'Open Positions', value:'5',        color:'var(--green)'},
  {label:'Today P&L',      value:'+₹4,320',  color:'var(--green)'},
  {label:'FY P&L',         value:'+₹91,500', color:'var(--green)'},
]

export default function DashboardPage() {
  const [services, setServices] = useState<Service[]>(INIT_SERVICES)
  const [log, setLog]           = useState<string[]>(['STAAX Dashboard ready.'])
  const [zerodhaConnected, setZerodhaConnected] = useState(false)

  const addLog = (msg:string) => {
    const ts = new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit'})
    setLog(l => [`[${ts}] ${msg}`, ...l.slice(0,49)])
  }

  const setStatus = (id:string, status:ServiceStatus) =>
    setServices(s => s.map(x => x.id===id ? {...x, status} : x))

  const startService = async (id:string) => {
    setStatus(id,'starting'); addLog(`Starting ${id}...`)
    await new Promise(r=>setTimeout(r,1200))
    setStatus(id,'running'); addLog(`✅ ${id} running`)
  }
  const stopService = async (id:string) => {
    setStatus(id,'stopping'); addLog(`Stopping ${id}...`)
    await new Promise(r=>setTimeout(r,800))
    setStatus(id,'stopped'); addLog(`⛔ ${id} stopped`)
  }
  const startAll = async () => {
    addLog('Starting all services...')
    for (const s of services) if (s.status!=='running') await startService(s.id)
    addLog('✅ All services running.')
  }
  const stopAll = async () => {
    addLog('Stopping all services...')
    for (const s of [...services].reverse()) if (s.status==='running') await stopService(s.id)
  }

  const allRunning = services.every(s=>s.status==='running')
  const allStopped = services.every(s=>s.status==='stopped')

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 style={{fontFamily:"'ADLaM Display',serif",fontSize:'22px',fontWeight:400}}>Dashboard</h1>
          <p style={{fontSize:'12px',color:'var(--text-muted)',marginTop:'2px'}}>System status · Start / stop services</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-ghost" onClick={stopAll} disabled={allStopped}>⛔ Stop All</button>
          <button className="btn btn-primary" onClick={startAll} disabled={allRunning}>▶ Start Session</button>
        </div>
      </div>

      {/* Stats */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'12px',marginBottom:'20px'}}>
        {STATS.map(s=>(
          <div key={s.label} className="card">
            <div style={{fontSize:'10px',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:'6px'}}>{s.label}</div>
            <div style={{fontSize:'20px',fontWeight:700,color:s.color}}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'20px'}}>
        {/* Services */}
        <div className="card">
          <div style={{fontSize:'11px',fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:'14px'}}>
            Services
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
            {services.map(svc=>(
              <div key={svc.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',
                padding:'9px 12px',borderRadius:'6px',
                background:STATUS_BG[svc.status],border:`1px solid ${STATUS_COLOR[svc.status]}22`}}>
                <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
                  <span style={{width:'8px',height:'8px',borderRadius:'50%',flexShrink:0,
                    background:STATUS_COLOR[svc.status],
                    boxShadow:svc.status==='running'?`0 0 6px ${STATUS_COLOR[svc.status]}`:'none',
                    animation:svc.status==='starting'||svc.status==='stopping'?'pulse 1s infinite':'none'}}/>
                  <div>
                    <div style={{fontSize:'13px',fontWeight:600}}>{svc.name}</div>
                    <div style={{fontSize:'10px',color:'var(--text-dim)',marginTop:'1px'}}>{svc.detail}</div>
                  </div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                  <span style={{fontSize:'10px',color:STATUS_COLOR[svc.status],fontWeight:600,textTransform:'uppercase'}}>{svc.status}</span>
                  {svc.status==='stopped'&&<button className="btn btn-ghost" style={{fontSize:'10px',padding:'0 10px',height:'26px'}} onClick={()=>startService(svc.id)}>Start</button>}
                  {svc.status==='running'&&<button className="btn btn-danger" style={{fontSize:'10px',padding:'0 10px',height:'26px'}} onClick={()=>stopService(svc.id)}>Stop</button>}
                </div>
              </div>
            ))}

            {/* Zerodha token — fixed height, no layout shift */}
            <div style={{marginTop:'6px',padding:'10px 12px',background:'var(--bg-secondary)',
              borderRadius:'6px',border:'1px solid var(--bg-border)',
              minHeight:'58px',  // fixed height prevents layout shift
              display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <div>
                <div style={{fontSize:'12px',fontWeight:600}}>Zerodha Token</div>
                <div style={{fontSize:'11px',marginTop:'3px',
                  color:zerodhaConnected?'var(--green)':'var(--accent-amber)'}}>
                  {zerodhaConnected?'✅ Connected for today':'⚠️ Login required'}
                </div>
              </div>
              <button className="btn btn-ghost" style={{fontSize:'11px',flexShrink:0}}
                onClick={()=>{setZerodhaConnected(true);addLog('✅ Zerodha token refreshed')}}>
                {zerodhaConnected?'🔑 Re-login':'🔑 Login'}
              </button>
            </div>
          </div>
        </div>

        {/* Log */}
        <div className="card" style={{background:'var(--bg-secondary)'}}>
          <div style={{fontSize:'11px',fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:'12px'}}>
            System Log
          </div>
          <div style={{fontFamily:'monospace',fontSize:'11px',height:'280px',overflowY:'auto',
            display:'flex',flexDirection:'column',gap:'3px'}}>
            {log.map((line,i)=>(
              <div key={i} style={{color:line.includes('✅')?'var(--green)':line.includes('⛔')?'var(--red)':line.includes('Starting')||line.includes('Stopping')?'var(--accent-amber)':'var(--text-muted)'}}>{line}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
EOF

# ─── SMART GRID — Readable M/E/X, error pie fix, alignment ───────────────────
cat > frontend/src/pages/GridPage.tsx << 'EOF'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAlgos } from '@/context/AlgoContext'

const DAYS=['MON','TUE','WED','THU','FRI']
const WEEKENDS=['SAT','SUN']

type CellStatus='no_trade'|'algo_active'|'order_pending'|'open'|'algo_closed'|'error'

interface GridCell { multiplier:number; status:CellStatus; practix:boolean; entry:string; exit?:string; pnl?:number }

const STATUS_CFG: Record<CellStatus,{label:string,color:string,bg:string,pct:number}> = {
  no_trade:      {label:'No Trade',color:'#6B7280',bg:'rgba(107,114,128,0.12)',pct:0  },
  algo_active:   {label:'Active',  color:'#00B0F0',bg:'rgba(0,176,240,0.12)',  pct:30 },
  order_pending: {label:'Pending', color:'#F59E0B',bg:'rgba(245,158,11,0.12)', pct:50 },
  open:          {label:'Open',    color:'#22C55E',bg:'rgba(34,197,94,0.12)',  pct:75 },
  algo_closed:   {label:'Closed',  color:'#16a34a',bg:'rgba(22,163,74,0.12)', pct:100},
  error:         {label:'Error',   color:'#EF4444',bg:'rgba(239,68,68,0.12)', pct:60 },
}

const INIT_GRID: Record<string,Record<string,GridCell>> = {
  '1':{MON:{multiplier:1,status:'open',       practix:true, entry:'09:16',exit:'15:10',pnl:1325},TUE:{multiplier:1,status:'algo_closed',practix:false,entry:'09:16',exit:'15:10',pnl:-840},WED:{multiplier:2,status:'algo_active',practix:true,entry:'09:16',exit:'15:10'},FRI:{multiplier:1,status:'no_trade',practix:true,entry:'09:16',exit:'15:10'}},
  '2':{MON:{multiplier:2,status:'algo_active',practix:true, entry:'09:30',exit:'15:10'},WED:{multiplier:1,status:'order_pending',practix:true,entry:'09:30',exit:'15:10'},THU:{multiplier:2,status:'open',practix:true,entry:'09:30',exit:'15:10',pnl:-575}},
  '3':{MON:{multiplier:1,status:'no_trade',   practix:true, entry:'09:20',exit:'15:10'},THU:{multiplier:1,status:'open',practix:true,entry:'09:20',exit:'15:10',pnl:2100}},
  '4':{TUE:{multiplier:3,status:'error',      practix:true, entry:'09:30',exit:'15:10'},FRI:{multiplier:1,status:'no_trade',practix:true,entry:'09:30',exit:'15:10'}},
}

function CyclePie({status}:{status:CellStatus}) {
  const cfg=STATUS_CFG[status],r=12,cx=14,cy=14,circ=2*Math.PI*r
  const offset=circ*(1-cfg.pct/100)
  return (
    <svg width="28" height="28" style={{flexShrink:0}}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="2.5"/>
      {cfg.pct>0&&<circle cx={cx} cy={cy} r={r} fill="none" stroke={cfg.color} strokeWidth="2.5"
        strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}/>}
      <circle cx={cx} cy={cy} r="3" fill={cfg.color} opacity="0.9"/>
    </svg>
  )
}

// Determine algo-level status (worst case: error > open > active > pending > closed > no_trade)
function getAlgoStatus(cells: Record<string,GridCell>|undefined): CellStatus {
  if (!cells) return 'no_trade'
  const vals = Object.values(cells).map(c=>c.status)
  if (vals.includes('error'))         return 'error'
  if (vals.includes('open'))          return 'open'
  if (vals.includes('algo_active'))   return 'algo_active'
  if (vals.includes('order_pending')) return 'order_pending'
  if (vals.includes('algo_closed'))   return 'algo_closed'
  return 'no_trade'
}

export default function GridPage() {
  const navigate=useNavigate()
  const {algos}=useAlgos()
  const [grid,setGrid]=useState(INIT_GRID)
  const [showWeekends,setShowWeekends]=useState(false)
  const [editing,setEditing]=useState<{algoId:string,day:string}|null>(null)
  const [editVal,setEditVal]=useState('')
  const [dragAlgoId,setDragAlgoId]=useState<string|null>(null)

  // Weekend toggle always hides/shows both SAT and SUN
  const visibleDays=showWeekends?[...DAYS,'SAT','SUN']:DAYS

  const removeCell=(aId:string,day:string)=>setGrid(g=>{const u={...g[aId]};delete u[day];return{...g,[aId]:u}})
  const handleDrop=(aId:string,day:string)=>{
    if(!dragAlgoId||dragAlgoId!==aId||grid[aId]?.[day])return
    const algo=algos.find(a=>a.id===aId)
    setGrid(g=>({...g,[aId]:{...g[aId],[day]:{multiplier:1,status:'algo_active',practix:true,entry:algo?.entryTime||'09:16',exit:algo?.exitTime||'15:10'}}}))
    setDragAlgoId(null)
  }
  const updateMult=(aId:string,day:string,val:number)=>{
    if(val<1)return
    setGrid(g=>({...g,[aId]:{...g[aId],[day]:{...g[aId][day],multiplier:val}}}))
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 style={{fontFamily:"'ADLaM Display',serif",fontSize:'22px',fontWeight:400}}>Smart Grid</h1>
          <p style={{fontSize:'12px',color:'var(--text-muted)',marginTop:'2px'}}>
            Week of {new Date().toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}
          </p>
        </div>
        <div className="page-header-actions">
          <label style={{display:'flex',alignItems:'center',gap:'6px',fontSize:'12px',color:'var(--text-muted)',cursor:'pointer'}}>
            <input type="checkbox" checked={showWeekends} onChange={e=>setShowWeekends(e.target.checked)}
              style={{accentColor:'var(--accent-blue)'}}/>
            Show Weekends
          </label>
          <button className="btn btn-primary" onClick={()=>navigate('/algo/new')}>+ New Algo</button>
        </div>
      </div>

      {/* Legend */}
      <div style={{display:'flex',gap:'14px',marginBottom:'12px',flexWrap:'wrap',
        padding:'6px 12px',background:'var(--bg-secondary)',borderRadius:'6px',border:'1px solid var(--bg-border)'}}>
        {Object.entries(STATUS_CFG).map(([key,s])=>(
          <span key={key} style={{display:'flex',alignItems:'center',gap:'5px',fontSize:'11px',color:'var(--text-muted)'}}>
            <span style={{width:'7px',height:'7px',borderRadius:'2px',background:s.color,display:'inline-block',flexShrink:0}}/>
            {s.label}
          </span>
        ))}
        <span style={{marginLeft:'auto',fontSize:'10px',color:'var(--text-dim)'}}>Drag algo → day cell</span>
      </div>

      <div style={{overflowX:'auto'}}>
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <colgroup>
            <col style={{width:'185px',minWidth:'185px'}}/>
            {visibleDays.map(d=><col key={d} style={{minWidth:'115px'}}/>)}
          </colgroup>
          <thead>
            <tr>
              <th style={{padding:'8px 12px',textAlign:'left',background:'var(--bg-secondary)',
                border:'1px solid var(--bg-border)',fontSize:'10px',color:'var(--text-muted)',
                fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase'}}>ALGO</th>
              {visibleDays.map(day=>(
                <th key={day} style={{padding:'8px 12px',textAlign:'center',background:'var(--bg-secondary)',
                  border:'1px solid var(--bg-border)',fontSize:'10px',fontWeight:700,
                  letterSpacing:'0.08em',textTransform:'uppercase',
                  color:WEEKENDS.includes(day)?'var(--text-dim)':'var(--text-muted)'}}>
                  {day}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {algos.map(algo=>{
              const algoStatus=getAlgoStatus(grid[algo.id])
              return (
                <tr key={algo.id}>
                  <td draggable onDragStart={()=>setDragAlgoId(algo.id)} onDragEnd={()=>setDragAlgoId(null)}
                    style={{padding:'8px 10px',background:'var(--bg-secondary)',
                      border:'1px solid var(--bg-border)',cursor:'grab',userSelect:'none'}}>
                    <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                      <CyclePie status={algoStatus}/>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontWeight:700,fontSize:'12px',color:'var(--text)',marginBottom:'2px',
                          whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{algo.name}</div>
                        <div style={{fontSize:'10px',color:'var(--text-dim)',marginBottom:'3px'}}>{algo.account}</div>
                        <div style={{display:'flex',gap:'3px',flexWrap:'wrap'}}>
                          {algo.legs.map((leg,i)=>(
                            <span key={i} style={{fontSize:'9px',fontWeight:700,padding:'1px 4px',borderRadius:'3px',
                              background:leg.dir==='B'?'rgba(34,197,94,0.15)':'rgba(239,68,68,0.15)',
                              color:leg.dir==='B'?'var(--green)':'var(--red)',
                              border:`1px solid ${leg.dir==='B'?'rgba(34,197,94,0.3)':'rgba(239,68,68,0.3)'}`}}>
                              {leg.instCode}{leg.dir}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </td>
                  {visibleDays.map(day=>{
                    const cell=grid[algo.id]?.[day]
                    const s=cell?STATUS_CFG[cell.status]:null
                    return (
                      <td key={day} onDragOver={e=>e.preventDefault()} onDrop={()=>handleDrop(algo.id,day)}
                        style={{padding:'4px',border:'1px solid var(--bg-border)',verticalAlign:'top',
                          background:WEEKENDS.includes(day)&&!cell?'rgba(30,32,34,0.4)':undefined}}>
                        {cell&&s?(
                          <div style={{background:'var(--bg-secondary)',borderLeft:`3px solid ${s.color}`,
                            borderRadius:'5px',padding:'6px 8px',position:'relative'}}>
                            <button onClick={()=>removeCell(algo.id,day)}
                              style={{position:'absolute',top:'2px',right:'2px',background:'none',border:'none',
                                cursor:'pointer',color:'var(--text-dim)',fontSize:'10px',padding:'2px 3px',lineHeight:1}}
                              onMouseEnter={e=>(e.currentTarget.style.color='var(--red)')}
                              onMouseLeave={e=>(e.currentTarget.style.color='var(--text-dim)')}>✕</button>
                            <span style={{fontSize:'9px',fontWeight:700,letterSpacing:'0.04em',
                              color:s.color,background:s.bg,padding:'1px 5px',borderRadius:'3px',
                              display:'inline-block',marginBottom:'5px'}}>{s.label.toUpperCase()}</span>
                            {/* Info rows — white labels, blue values */}
                            <div style={{display:'grid',gridTemplateColumns:'auto 1fr',columnGap:'6px',rowGap:'2px',alignItems:'center'}}>
                              <span style={{fontSize:'10px',color:'var(--text)',fontWeight:600}}>M</span>
                              <span style={{fontSize:'10px',fontWeight:700,color:'var(--accent-blue)'}}>
                                {editing?.algoId===algo.id&&editing?.day===day?(
                                  <input autoFocus type="number" min={1} value={editVal}
                                    onChange={e=>setEditVal(e.target.value)}
                                    onBlur={()=>{updateMult(algo.id,day,parseInt(editVal)||1);setEditing(null)}}
                                    onKeyDown={e=>e.key==='Enter'&&(updateMult(algo.id,day,parseInt(editVal)||1),setEditing(null))}
                                    style={{width:'32px',background:'var(--bg-primary)',border:'1px solid var(--accent-blue)',
                                      borderRadius:'2px',color:'var(--text)',fontSize:'10px',padding:'0 3px',fontFamily:'inherit'}}/>
                                ):(
                                  <span onClick={()=>{setEditing({algoId:algo.id,day});setEditVal(String(cell.multiplier))}}
                                    style={{cursor:'text',borderBottom:'1px dashed transparent'}}
                                    onMouseEnter={e=>(e.currentTarget.style.borderBottomColor='var(--accent-blue)')}
                                    onMouseLeave={e=>(e.currentTarget.style.borderBottomColor='transparent')}>
                                    {cell.multiplier}
                                  </span>
                                )}
                                {/* P&L inline with M on same row */}
                                {cell.pnl!=null&&(
                                  <span style={{marginLeft:'8px',fontWeight:700,
                                    color:cell.pnl>=0?'var(--green)':'var(--red)'}}>
                                    {cell.pnl>=0?'+':''}{(cell.pnl/1000).toFixed(1)}k
                                  </span>
                                )}
                              </span>
                              <span style={{fontSize:'10px',color:'var(--text)',fontWeight:600}}>E</span>
                              <span style={{fontSize:'10px',color:'var(--accent-blue)',fontWeight:600}}>{cell.entry}</span>
                              {cell.exit&&<><span style={{fontSize:'10px',color:'var(--text)',fontWeight:600}}>X</span>
                              <span style={{fontSize:'10px',color:'var(--accent-blue)',fontWeight:600}}>{cell.exit}</span></>}
                            </div>
                            <div style={{display:'flex',gap:'4px',marginTop:'4px',flexWrap:'wrap'}}>
                              {cell.practix&&<span style={{fontSize:'8px',fontWeight:700,color:'var(--accent-amber)',background:'rgba(215,123,18,0.1)',padding:'1px 4px',borderRadius:'2px'}}>PRACTIX</span>}
                              {(algo.stratMode==='btst'||algo.stratMode==='stbt')&&cell.status==='open'&&(
                                <span style={{fontSize:'8px',fontWeight:700,color:'var(--accent-amber)',background:'rgba(215,123,18,0.1)',padding:'1px 4px',borderRadius:'2px'}}>
                                  {algo.legs.map(l=>l.dir==='B'?'ST':'BT').filter((v,i,a)=>a.indexOf(v)===i).join('/')}
                                </span>
                              )}
                            </div>
                          </div>
                        ):(
                          <div style={{minHeight:'52px',border:'1px dashed var(--bg-border)',borderRadius:'5px',
                            display:'flex',alignItems:'center',justifyContent:'center',
                            color:'var(--text-dim)',fontSize:'10px',
                            background:dragAlgoId===algo.id?'rgba(0,176,240,0.05)':'transparent',
                            borderColor:dragAlgoId===algo.id?'var(--accent-blue)':'var(--bg-border)',
                            opacity:dragAlgoId===algo.id?0.9:0.3,transition:'all 0.15s'}}>
                            {dragAlgoId===algo.id?'Drop':'—'}
                          </div>
                        )}
                      </td>
                    )
                  })}
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

# ─── ORDERS — Confirmation modals, RE inline status, weekend both SAT+SUN ─────
cat > frontend/src/pages/OrdersPage.tsx << 'EOF'
import { useState } from 'react'

const ALL_DAYS=['MON','TUE','WED','THU','FRI']
const WEEKEND_ACTIVE: Record<string,number> = {SAT:2840}
const DAY_PNL: Record<string,number> = {MON:4320,TUE:-800,WED:1200,THU:3100,FRI:0}

type LegStatus='open'|'closed'|'error'|'pending'
interface Leg { id:string; parentId?:string; journeyLevel:string; status:LegStatus; symbol:string; dir:'BUY'|'SELL'; lots:string; entryCondition:string; refPrice?:number; fillPrice?:number; ltp?:number; slOrig?:number; slActual?:number; target?:number; exitPrice?:number; exitTime?:string; exitReason?:string; pnl?:number }
interface AlgoGroup { algoName:string; account:string; mtm:number; mtmSL:number; mtmTP:number; legs:Leg[]; reStatus?:string }

const INIT_ORDERS: AlgoGroup[] = [
  { algoName:'AWS-1', account:'Karthik', mtm:4320, mtmSL:-5000, mtmTP:10000, legs:[
    {id:'L1', journeyLevel:'1',   status:'open',   symbol:'NIFTY 22500CE 27MAR25',   dir:'BUY', lots:'1 (50)', entryCondition:'ORB High', refPrice:186.5, fillPrice:187.0, ltp:213.5, slOrig:150, slActual:175, target:280, pnl:1325},
    {id:'L1a',parentId:'L1', journeyLevel:'1.1', status:'closed', symbol:'NIFTY 22500CE 27MAR25', dir:'BUY', lots:'1 (50)', entryCondition:'Re-entry', refPrice:187.0, fillPrice:188.0, slOrig:155, target:280, exitPrice:120, exitTime:'10:15:22', exitReason:'SL', pnl:-3400},
    {id:'L2', journeyLevel:'2',   status:'open',   symbol:'NIFTY 22500PE 27MAR25',   dir:'BUY', lots:'1 (50)', entryCondition:'ORB Low',  refPrice:143.0, fillPrice:142.5, ltp:118.2, slOrig:110, slActual:110, target:200, pnl:-1215},
    {id:'L3', journeyLevel:'3',   status:'error',  symbol:'NIFTY 22400CE 27MAR25',   dir:'BUY', lots:'1 (50)', entryCondition:'Direct',   pnl:0},
  ]},
  { algoName:'TF-BUY', account:'Mom', mtm:-800, mtmSL:-3000, mtmTP:6000, legs:[
    {id:'L4', journeyLevel:'1', status:'open', symbol:'BANKNIFTY 48000CE 26MAR25', dir:'BUY', lots:'2 (30)', entryCondition:'W&T Up 5%', refPrice:200.0, fillPrice:210.0, ltp:198.5, slOrig:180, slActual:185, target:280, pnl:-575},
  ]},
]

const STATUS_STYLE: Record<LegStatus,{color:string,bg:string}> = {
  open:{color:'#22C55E',bg:'rgba(34,197,94,0.12)'}, closed:{color:'#6B7280',bg:'rgba(107,114,128,0.12)'},
  error:{color:'#EF4444',bg:'rgba(239,68,68,0.12)'}, pending:{color:'#F59E0B',bg:'rgba(245,158,11,0.12)'},
}

const COLS=['36px','66px','174px','66px','116px','54px','54px','76px','58px','88px','62px','82px']
const HDRS=['#','Status','Symbol','Lots','Entry / Ref','Fill','LTP','SL (A/O)','Target','Exit','Reason','P&L']

function LegRow({leg,isChild}:{leg:Leg,isChild:boolean}) {
  const st=STATUS_STYLE[leg.status]
  return (
    <tr style={{background:isChild?'rgba(0,176,240,0.025)':undefined}}>
      <td style={{paddingLeft:isChild?'16px':'10px',width:COLS[0]}}>
        <span style={{fontSize:'11px',color:'var(--text-muted)',fontWeight:isChild?600:400}}>{leg.journeyLevel}</span>
      </td>
      <td style={{width:COLS[1]}}><span className="tag" style={{color:st.color,background:st.bg,fontSize:'10px'}}>{leg.status.toUpperCase()}</span></td>
      <td style={{width:COLS[2]}}>
        <div style={{fontSize:'11px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{leg.symbol}</div>
        <div style={{fontSize:'10px',color:leg.dir==='BUY'?'var(--green)':'var(--red)',fontWeight:600}}>{leg.dir}</div>
      </td>
      <td style={{width:COLS[3],color:'var(--text-muted)',fontSize:'11px'}}>{leg.lots}</td>
      <td style={{width:COLS[4],fontSize:'11px'}}>
        <div style={{color:'var(--text-muted)'}}>{leg.entryCondition}</div>
        {leg.refPrice!=null&&<div style={{color:'var(--text-dim)',fontSize:'10px'}}>Ref: {leg.refPrice}</div>}
      </td>
      <td style={{width:COLS[5],fontWeight:600}}>{leg.fillPrice??'—'}</td>
      <td style={{width:COLS[6],fontWeight:600,color:leg.ltp!=null&&leg.fillPrice!=null?(leg.ltp>leg.fillPrice?'var(--green)':'var(--red)'):'var(--text-muted)'}}>{leg.ltp??'—'}</td>
      <td style={{width:COLS[7],fontSize:'11px'}}>
        {leg.slActual!=null&&<div style={{color:'var(--amber)'}}>A:{leg.slActual}</div>}
        {leg.slOrig!=null&&<div style={{color:'var(--text-muted)'}}>O:{leg.slOrig}</div>}
        {leg.slOrig==null&&'—'}
      </td>
      <td style={{width:COLS[8],color:'var(--text-muted)'}}>{leg.target??'—'}</td>
      <td style={{width:COLS[9],fontSize:'11px'}}>{leg.exitPrice!=null?(<><div style={{fontWeight:600}}>{leg.exitPrice}</div>{leg.exitTime&&<div style={{fontSize:'10px',color:'var(--text-dim)'}}>{leg.exitTime}</div>}</>):'—'}</td>
      <td style={{width:COLS[10]}}>{leg.exitReason?<span className="tag" style={{color:'var(--red)',background:'rgba(239,68,68,0.1)',fontSize:'10px'}}>{leg.exitReason}</span>:'—'}</td>
      <td style={{width:COLS[11],fontWeight:700,textAlign:'right',color:(leg.pnl||0)>=0?'var(--green)':'var(--red)'}}>{leg.pnl!=null?`${leg.pnl>=0?'+':''}₹${Math.abs(leg.pnl).toLocaleString('en-IN')}`:'—'}</td>
    </tr>
  )
}

// ── Confirmation Modal ────────────────────────────────────────────
interface ModalProps {
  title:string; desc:string; confirmLabel:string; confirmColor:string;
  children?:React.ReactNode; onConfirm:()=>void; onCancel:()=>void
}
function ConfirmModal({title,desc,confirmLabel,confirmColor,children,onConfirm,onCancel}:ModalProps) {
  return (
    <div className="modal-overlay">
      <div className="modal-box">
        <div style={{fontWeight:700,fontSize:'16px',marginBottom:'8px'}}>{title}</div>
        <div style={{fontSize:'13px',color:'var(--text-muted)',marginBottom:'16px',lineHeight:1.5}}>{desc}</div>
        {children}
        <div style={{display:'flex',gap:'10px',justifyContent:'flex-end',marginTop:'20px'}}>
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn" style={{background:confirmColor,color:'#fff'}} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

export default function OrdersPage() {
  const [orders,setOrders]=useState(INIT_ORDERS)
  const [activeDay,setActiveDay]=useState('MON')
  const [showWeekends,setShowWeekends]=useState(false)
  // Modal state
  const [modal,setModal]=useState<{type:'run'|'sq'|'t',algoIdx:number}|null>(null)
  const [sqChecked,setSqChecked]=useState<Record<string,boolean>>({})

  // Both SAT and SUN toggle together
  const autoWeekends=Object.keys(WEEKEND_ACTIVE)
  const visibleDays=showWeekends?[...ALL_DAYS,'SAT','SUN']:[...ALL_DAYS,...autoWeekends]
  const totalMTM=orders.reduce((s,g)=>s+g.mtm,0)

  const buildRows=(legs:Leg[])=>{
    const r:{leg:Leg,isChild:boolean}[]=[]
    for(const p of legs.filter(l=>!l.parentId)){
      r.push({leg:p,isChild:false})
      for(const c of legs.filter(l=>l.parentId===p.id)) r.push({leg:c,isChild:true})
    }
    return r
  }

  const openLegs=(idx:number)=>orders[idx].legs.filter(l=>l.status==='open')

  const doRE=(idx:number)=>{
    setOrders(o=>o.map((g,i)=>i===idx?{...g,reStatus:'Retrying...'}:g))
    setTimeout(()=>setOrders(o=>o.map((g,i)=>i===idx?{...g,reStatus:'✅ Retry successful'}:g)),1500)
    setTimeout(()=>setOrders(o=>o.map((g,i)=>i===idx?{...g,reStatus:undefined}:g)),4000)
  }

  const doConfirm=()=>{
    if(!modal)return
    const {type,algoIdx}=modal
    if(type==='run') { /* fire run API */ }
    if(type==='sq')  { /* square off selected legs */ }
    if(type==='t')   { /* terminate */ }
    setModal(null)
  }

  const getModalProps=()=>{
    if(!modal)return null
    const {type,algoIdx}=modal
    const name=orders[algoIdx].algoName
    if(type==='run') return {
      title:`Execute ${name}?`,
      desc:`This will execute ${name} immediately with the configured entry strategy.`,
      confirmLabel:'Execute', confirmColor:'var(--accent-blue)',
    }
    if(type==='t') return {
      title:`Terminate ${name}?`,
      desc:`This will square off all open positions, cancel pending orders, and permanently terminate ${name} for today.`,
      confirmLabel:'Terminate', confirmColor:'var(--red)',
    }
    if(type==='sq') return {
      title:`Square Off — ${name}`,
      desc:'Select open legs to square off:',
      confirmLabel:'Square Off', confirmColor:'#22C55E',
    }
    return null
  }

  return (
    <div>
      <div className="page-header">
        <h1 style={{fontFamily:"'ADLaM Display',serif",fontSize:'22px',fontWeight:400}}>Orders</h1>
        <div className="page-header-actions">
          <span style={{fontSize:'13px',fontWeight:700,color:totalMTM>=0?'var(--green)':'var(--red)'}}>
            MTM: {totalMTM>=0?'+':''}₹{totalMTM.toLocaleString('en-IN')}
          </span>
          <label style={{display:'flex',alignItems:'center',gap:'6px',fontSize:'12px',color:'var(--text-muted)',cursor:'pointer'}}>
            <input type="checkbox" checked={showWeekends} onChange={e=>setShowWeekends(e.target.checked)} style={{accentColor:'var(--accent-blue)'}}/>
            Show Weekends
          </label>
        </div>
      </div>

      {/* Day tabs */}
      <div style={{display:'flex',gap:'2px',marginBottom:'18px',borderBottom:'1px solid var(--bg-border)'}}>
        {visibleDays.map(d=>{
          const isWeekend=d==='SAT'||d==='SUN'
          const pnl=isWeekend?WEEKEND_ACTIVE[d]:DAY_PNL[d]
          const isActive=activeDay===d
          return (
            <button key={d} onClick={()=>setActiveDay(d)} style={{
              display:'flex',alignItems:'center',gap:'5px',
              padding:'8px 12px',fontSize:'12px',fontWeight:600,
              border:'none',cursor:'pointer',borderRadius:'5px 5px 0 0',
              background:isActive?'var(--bg-surface)':'transparent',
              color:isActive?'var(--accent-blue)':isWeekend?'var(--text-dim)':'var(--text-muted)',
              borderBottom:isActive?'2px solid var(--accent-blue)':'2px solid transparent',
            }}>
              <span>{d}</span>
              {pnl!=null&&<span style={{fontSize:'10px',fontWeight:700,color:pnl>=0?'var(--green)':'var(--red)'}}>
                {pnl>=0?'+':''}{(pnl/1000).toFixed(1)}k
              </span>}
            </button>
          )
        })}
      </div>

      {orders.map((group,gi)=>(
        <div key={gi} style={{marginBottom:'16px'}}>
          <div style={{background:'var(--bg-secondary)',border:'1px solid var(--bg-border)',
            borderRadius:'7px 7px 0 0',padding:'8px 12px',
            display:'flex',alignItems:'center',gap:'10px',flexWrap:'wrap'}}>
            <span style={{fontWeight:700,fontSize:'14px',color:'var(--accent-blue)'}}>{group.algoName}</span>
            <span style={{fontSize:'11px',color:'var(--text-muted)',background:'var(--bg-surface)',padding:'2px 7px',borderRadius:'4px'}}>{group.account}</span>
            <span style={{fontSize:'11px',color:'var(--text-dim)'}}>
              SL: <span style={{color:'var(--red)'}}>₹{Math.abs(group.mtmSL).toLocaleString('en-IN')}</span>&nbsp;·&nbsp;
              TP: <span style={{color:'var(--green)'}}>₹{group.mtmTP.toLocaleString('en-IN')}</span>
            </span>
            {/* RE status message in center */}
            {group.reStatus&&(
              <span style={{fontSize:'11px',fontWeight:600,
                color:group.reStatus.includes('✅')?'var(--green)':'var(--accent-amber)',
                animation:'fadeIn 0.2s ease'}}>
                {group.reStatus}
              </span>
            )}
            <div style={{marginLeft:'auto',display:'flex',gap:'5px',alignItems:'center'}}>
              {[
                {label:'RUN',color:'#00B0F0',action:()=>setModal({type:'run',algoIdx:gi})},
                {label:'RE', color:'#F59E0B',action:()=>doRE(gi)},
                {label:'SQ', color:'#22C55E',action:()=>{setSqChecked({});setModal({type:'sq',algoIdx:gi})}},
                {label:'T',  color:'#EF4444',action:()=>setModal({type:'t',algoIdx:gi})},
              ].map(btn=>(
                <button key={btn.label} title={btn.label}
                  style={{height:'26px',minWidth:'38px',padding:'0 10px',fontSize:'11px',fontWeight:700,
                    border:`1.5px solid ${btn.color}`,background:'transparent',color:btn.color,
                    borderRadius:'4px',cursor:'pointer',transition:'all 0.12s'}}
                  onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background=`${btn.color}18`}}
                  onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background='transparent'}}
                  onClick={btn.action}>
                  {btn.label}
                </button>
              ))}
              <span style={{fontWeight:700,fontSize:'14px',marginLeft:'6px',
                color:group.mtm>=0?'var(--green)':'var(--red)'}}>
                {group.mtm>=0?'+':''}₹{group.mtm.toLocaleString('en-IN')}
              </span>
            </div>
          </div>
          <div style={{border:'1px solid var(--bg-border)',borderTop:'none',borderRadius:'0 0 7px 7px',overflow:'hidden'}}>
            <table className="staax-table">
              <colgroup>{COLS.map((w,i)=><col key={i} style={{width:w}}/>)}</colgroup>
              <thead><tr>{HDRS.map(h=><th key={h}>{h}</th>)}</tr></thead>
              <tbody>{buildRows(group.legs).map(({leg,isChild})=><LegRow key={leg.id} leg={leg} isChild={isChild}/>)}</tbody>
            </table>
          </div>
        </div>
      ))}

      {/* Confirmation modals */}
      {modal&&(()=>{
        const mp=getModalProps()
        if(!mp)return null
        const {type,algoIdx}=modal
        return (
          <ConfirmModal {...mp} onCancel={()=>setModal(null)} onConfirm={doConfirm}>
            {type==='sq'&&(
              <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
                {openLegs(algoIdx).map(leg=>(
                  <label key={leg.id} style={{display:'flex',alignItems:'center',gap:'10px',
                    padding:'8px 12px',background:'var(--bg-secondary)',borderRadius:'5px',cursor:'pointer'}}>
                    <input type="checkbox" checked={!!sqChecked[leg.id]}
                      onChange={e=>setSqChecked(s=>({...s,[leg.id]:e.target.checked}))}
                      style={{accentColor:'var(--green)',width:'15px',height:'15px'}}/>
                    <div>
                      <div style={{fontSize:'12px',fontWeight:600}}>{leg.symbol}</div>
                      <div style={{fontSize:'11px',color:'var(--text-muted)',marginTop:'1px'}}>
                        {leg.dir} · {leg.lots} · Fill: {leg.fillPrice} · LTP: {leg.ltp}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </ConfirmModal>
        )
      })()}
    </div>
  )
}
EOF

# ─── ALGO CONFIG — Remove Days, Direct+ORB only, drag reorder legs ────────────
cat > frontend/src/pages/AlgoPage.tsx << 'EOF'
import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAlgos } from '@/context/AlgoContext'

const INST_CODES: Record<string,string> = {NF:'NIFTY',BN:'BANKNIFTY',SX:'SENSEX',MN:'MIDCAPNIFTY',FN:'FINNIFTY'}
const EXPIRY_OPTIONS=[{value:'current_weekly',label:'Current Weekly'},{value:'next_weekly',label:'Next Weekly'},{value:'current_monthly',label:'Current Monthly'},{value:'next_monthly',label:'Next Monthly'}]
const STRIKE_OPTIONS=[...Array.from({length:10},(_,i)=>`ITM${10-i}`),'ATM',...Array.from({length:10},(_,i)=>`OTM${i+1}`)]

type FeatureKey='wt'|'sl'|'re'|'tp'|'tsl'
const FEATURES:{key:FeatureKey,label:string,color:string}[]=[
  {key:'wt',label:'W&T',color:'#9CA3AF'},{key:'sl',label:'SL',color:'#EF4444'},
  {key:'re',label:'RE',color:'#F59E0B'},{key:'tp',label:'TP',color:'#22C55E'},{key:'tsl',label:'TSL',color:'#00B0F0'},
]

interface LegVals { wt:{direction:string,value:string,unit:string}; sl:{type:string,value:string}; re:{mode:string,trigger:string,count:string}; tp:{type:string,value:string}; tsl:{x:string,y:string,unit:string} }
interface Leg { id:string; no:number; instType:string; instCode:string; direction:string; optType:string; strikeMode:string; strikeType:string; premiumVal:string; lots:string; expiry:string; active:Record<FeatureKey,boolean>; vals:LegVals }

const mkLeg=(n:number):Leg=>({id:`leg-${Date.now()}-${n}`,no:n,instType:'OP',instCode:'NF',direction:'BUY',optType:'CE',strikeMode:'leg',strikeType:'atm',premiumVal:'',lots:'1',expiry:'current_weekly',active:{wt:false,sl:false,re:false,tp:false,tsl:false},vals:{wt:{direction:'up',value:'',unit:'pts'},sl:{type:'pts_instrument',value:''},re:{mode:'at_entry_price',trigger:'sl',count:'1'},tp:{type:'pts_instrument',value:''},tsl:{x:'',y:'',unit:'pts'}}})
const cpLeg=(l:Leg,n:number):Leg=>({...l,id:`leg-${Date.now()}-c${n}`,no:n,vals:{...l.vals,wt:{...l.vals.wt},sl:{...l.vals.sl},re:{...l.vals.re},tp:{...l.vals.tp},tsl:{...l.vals.tsl}},active:{...l.active}})

function FeatVals({leg,onUpdate}:{leg:Leg,onUpdate:(id:string,u:Partial<Leg>)=>void}) {
  const active=FEATURES.filter(f=>leg.active[f.key])
  if(!active.length)return null
  const u=(k:FeatureKey,sub:string,val:string)=>onUpdate(leg.id,{vals:{...leg.vals,[k]:{...(leg.vals[k] as any),[sub]:val}}})
  const cs={height:'26px',background:'var(--bg-primary)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:'3px',color:'var(--text)',fontSize:'11px',padding:'0 6px',fontFamily:'inherit'}
  const inp=(k:FeatureKey,sub:string,ph:string,w='54px')=><input value={(leg.vals[k] as any)[sub]||''} onChange={e=>u(k,sub,e.target.value)} placeholder={ph} style={{...cs,width:w}}/>
  const sel=(k:FeatureKey,sub:string,opts:[string,string][])=><select value={(leg.vals[k] as any)[sub]||''} onChange={e=>u(k,sub,e.target.value)} style={{...cs,cursor:'pointer'}}>{opts.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>
  return (
    <div style={{display:'flex',gap:'6px',flexWrap:'wrap',marginTop:'6px',paddingTop:'6px',borderTop:'1px solid rgba(255,255,255,0.06)'}}>
      {active.map(f=>(
        <div key={f.key} style={{display:'flex',alignItems:'center',gap:'4px',background:`${f.color}08`,border:`1px solid ${f.color}22`,borderRadius:'5px',padding:'4px 8px'}}>
          <span style={{fontSize:'10px',color:f.color,fontWeight:700,marginRight:'2px'}}>{f.label}:</span>
          {f.key==='wt'&&<>{sel('wt','direction',[['up','↑Up'],['down','↓Dn']])} {inp('wt','value','val')} {sel('wt','unit',[['pts','pts'],['pct','%']])}</>}
          {f.key==='sl'&&<>{sel('sl','type',[['pts_instrument','Pts(I)'],['pct_instrument','%(I)'],['pts_underlying','Pts(U)'],['pct_underlying','%(U)']])} {inp('sl','value','val')}</>}
          {f.key==='re'&&<>{sel('re','mode',[['at_entry_price','@Entry'],['immediate','Now'],['at_cost','@Cost']])} {sel('re','trigger',[['sl','SL'],['tp','TP'],['any','Any']])} {sel('re','count',[['1','1×'],['2','2×'],['3','3×'],['4','4×'],['5','5×']])}</>}
          {f.key==='tp'&&<>{sel('tp','type',[['pts_instrument','Pts(I)'],['pct_instrument','%(I)'],['pts_underlying','Pts(U)'],['pct_underlying','%(U)']])} {inp('tp','value','val')}</>}
          {f.key==='tsl'&&<>{inp('tsl','x','X')} <span style={{fontSize:'10px',color:'var(--text-dim)'}}>→</span> {inp('tsl','y','Y')} {sel('tsl','unit',[['pts','pts'],['pct','%']])}</>}
        </div>
      ))}
    </div>
  )
}

function LegRow({leg,isDragging,onUpdate,onRemove,onCopy,dragHandleProps}:{
  leg:Leg,isDragging:boolean,
  onUpdate:(id:string,u:Partial<Leg>)=>void,
  onRemove:(id:string)=>void,
  onCopy:(id:string)=>void,
  dragHandleProps:any,
}) {
  const u=(k:keyof Leg,v:any)=>onUpdate(leg.id,{[k]:v})
  const s={height:'28px',background:'var(--bg-primary)',border:'1px solid var(--bg-border)',borderRadius:'4px',color:'var(--text)',fontSize:'11px',padding:'0 8px',fontFamily:'inherit',cursor:'pointer'}
  return (
    <div style={{background:'var(--bg-secondary)',border:`1px solid ${isDragging?'var(--accent-blue)':'var(--bg-border)'}`,
      borderRadius:'7px',padding:'9px 10px',marginBottom:'6px',
      opacity:isDragging?0.7:1,transition:'border-color 0.1s'}}>
      <div style={{display:'flex',alignItems:'center',gap:'5px',flexWrap:'wrap'}}>
        {/* Drag handle */}
        <span {...dragHandleProps} title="Drag to reorder" style={{cursor:'grab',color:'var(--text-dim)',fontSize:'13px',flexShrink:0,padding:'0 2px',userSelect:'none'}}>⠿</span>
        <span style={{fontSize:'11px',fontWeight:700,color:'var(--text-dim)',minWidth:'20px',textAlign:'center'}}>L{leg.no}</span>
        <button onClick={()=>u('instType',leg.instType==='OP'?'FU':'OP')} style={{height:'28px',padding:'0 9px',borderRadius:'4px',fontSize:'11px',fontWeight:700,background:leg.instType==='OP'?'rgba(0,176,240,0.15)':'rgba(215,123,18,0.15)',color:leg.instType==='OP'?'var(--accent-blue)':'var(--accent-amber)',border:`1px solid ${leg.instType==='OP'?'rgba(0,176,240,0.3)':'rgba(215,123,18,0.3)'}`,cursor:'pointer',flexShrink:0}}>{leg.instType}</button>
        <select value={leg.instCode} onChange={e=>u('instCode',e.target.value)} style={s}>
          {Object.entries(INST_CODES).map(([c,n])=><option key={c} value={c} title={n}>{c}</option>)}
        </select>
        <button onClick={()=>u('direction',leg.direction==='BUY'?'SELL':'BUY')} style={{height:'28px',padding:'0 9px',borderRadius:'4px',fontSize:'11px',fontWeight:700,background:leg.direction==='BUY'?'rgba(34,197,94,0.15)':'rgba(239,68,68,0.15)',color:leg.direction==='BUY'?'var(--green)':'var(--red)',border:`1px solid ${leg.direction==='BUY'?'rgba(34,197,94,0.3)':'rgba(239,68,68,0.3)'}`,cursor:'pointer',flexShrink:0}}>{leg.direction}</button>
        {leg.instType==='OP'&&<button onClick={()=>u('optType',leg.optType==='CE'?'PE':'CE')} style={{height:'28px',padding:'0 9px',borderRadius:'4px',fontSize:'11px',fontWeight:700,background:'rgba(255,255,255,0.06)',color:'var(--text-muted)',border:'1px solid var(--bg-border)',cursor:'pointer',flexShrink:0}}>{leg.optType}</button>}
        {leg.instType==='OP'&&<>
          <select value={leg.expiry} onChange={e=>u('expiry',e.target.value)} style={{...s,width:'128px'}}>{EXPIRY_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>
          <select value={leg.strikeMode} onChange={e=>u('strikeMode',e.target.value)} style={s}><option value="leg">Strike</option><option value="premium">Premium</option><option value="straddle">Straddle</option></select>
          {leg.strikeMode==='leg'&&<select value={leg.strikeType} onChange={e=>u('strikeType',e.target.value)} style={{...s,width:'70px'}}>{STRIKE_OPTIONS.map(st=><option key={st} value={st.toLowerCase()}>{st}</option>)}</select>}
          {(leg.strikeMode==='premium'||leg.strikeMode==='straddle')&&<input value={leg.premiumVal} onChange={e=>u('premiumVal',e.target.value)} placeholder="₹ premium" style={{...s,width:'82px'}}/>}
        </>}
        {/* Lots — wider to prevent break */}
        <input value={leg.lots} onChange={e=>u('lots',e.target.value)} type="number" min={1}
          style={{...s,width:'56px',textAlign:'center'}}/>
        <span style={{color:'var(--bg-border)',fontSize:'14px',flexShrink:0}}>|</span>
        {FEATURES.map(f=>(
          <button key={f.key} onClick={()=>onUpdate(leg.id,{active:{...leg.active,[f.key]:!leg.active[f.key]}})}
            style={{height:'28px',padding:'0 11px',borderRadius:'13px',fontSize:'11px',fontWeight:600,
              cursor:'pointer',border:'none',transition:'all 0.12s',flexShrink:0,
              background:leg.active[f.key]?f.color:'var(--bg-surface)',
              color:leg.active[f.key]?'#000':'var(--text-dim)'}}>{f.label}</button>
        ))}
        <div style={{marginLeft:'auto',display:'flex',gap:'4px',flexShrink:0}}>
          <button onClick={()=>onCopy(leg.id)} title="Copy leg" style={{height:'28px',padding:'0 9px',background:'none',border:'1px solid rgba(0,176,240,0.25)',color:'var(--accent-blue)',borderRadius:'4px',fontSize:'11px',cursor:'pointer'}}>⧉</button>
          <button onClick={()=>onRemove(leg.id)} title="Remove leg" style={{height:'28px',padding:'0 9px',background:'none',border:'1px solid rgba(239,68,68,0.25)',color:'var(--red)',borderRadius:'4px',fontSize:'11px',cursor:'pointer'}}>✕</button>
        </div>
      </div>
      <FeatVals leg={leg} onUpdate={onUpdate}/>
    </div>
  )
}

function SubSection({title}:{title:string}) {
  return <div style={{fontSize:'10px',fontWeight:700,color:'var(--text-dim)',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:'8px',marginTop:'2px',paddingBottom:'5px',borderBottom:'1px solid var(--bg-border)'}}>{title}</div>
}

const timeInput={background:'var(--bg-secondary)',border:'1px solid var(--bg-border)',color:'var(--text)',borderRadius:'5px',padding:'0 10px',height:'32px',fontSize:'12px',fontFamily:'inherit',width:'106px',colorScheme:'dark'}

export default function AlgoPage() {
  const navigate=useNavigate()
  const {addAlgo}=useAlgos()
  const [legs,setLegs]=useState<Leg[]>([mkLeg(1)])
  const [algoName,setAlgoName]=useState('')
  const [stratMode,setStratMode]=useState('intraday')
  const [entryType,setEntryType]=useState('direct')  // direct or orb
  const [lotMult,setLotMult]=useState('1')
  const [entryTime,setEntryTime]=useState('09:16')
  const [orbEnd,setOrbEnd]=useState('11:16')
  const [exitTime,setExitTime]=useState('15:10')
  const [dte,setDte]=useState('0')
  const [account,setAccount]=useState('Karthik (Zerodha)')
  const [mtmUnit,setMtmUnit]=useState('amt')
  const [mtmSL,setMtmSL]=useState('')
  const [mtmTP,setMtmTP]=useState('')
  const [entryDelay,setEntryDelay]=useState('0')
  const [exitDelay,setExitDelay]=useState('0')
  const [orderType,setOrderType]=useState('MARKET')
  const [errorMargin,setErrorMargin]=useState(true)
  const [errorEntry,setErrorEntry]=useState(true)
  const [saved,setSaved]=useState(false)
  const [saveError,setSaveError]=useState('')
  const [dragIdx,setDragIdx]=useState<number|null>(null)
  const [dragOverIdx,setDragOverIdx]=useState<number|null>(null)

  const addLeg=()=>setLegs(l=>[...l,mkLeg(l.length+1)])
  const removeLeg=(id:string)=>setLegs(l=>l.filter(x=>x.id!==id).map((x,i)=>({...x,no:i+1})))
  const updateLeg=(id:string,u:Partial<Leg>)=>setLegs(l=>l.map(x=>x.id===id?{...x,...u}:x))
  const copyLeg=(id:string)=>setLegs(l=>{const i=l.findIndex(x=>x.id===id),cp=cpLeg(l[i],l.length+1),a=[...l];a.splice(i+1,0,cp);return a.map((x,j)=>({...x,no:j+1}))})

  // Drag-to-reorder legs
  const handleDragEnd=()=>{
    if(dragIdx!==null&&dragOverIdx!==null&&dragIdx!==dragOverIdx){
      setLegs(l=>{const a=[...l];const [item]=a.splice(dragIdx,1);a.splice(dragOverIdx,0,item);return a.map((x,i)=>({...x,no:i+1}))})
    }
    setDragIdx(null);setDragOverIdx(null)
  }

  const handleSave=()=>{
    if(!algoName.trim()){setSaveError('Algo name required');return}
    setSaveError('')
    addAlgo({id:`algo-${Date.now()}`,name:algoName,account:account.split(' ')[0],stratMode,entryType,entryTime,exitTime,days:{M:true,T:true,W:true,T2:true,F:true,SAT:false,SUN:false},legs:legs.map(l=>({instCode:l.instCode,dir:l.direction==='BUY'?'B' as const:'S' as const}))})
    setSaved(true)
    setTimeout(()=>{setSaved(false);navigate('/grid')},1200)
  }

  return (
    <div style={{maxWidth:'980px'}}>
      <div className="page-header">
        <h1 style={{fontFamily:"'ADLaM Display',serif",fontSize:'22px',fontWeight:400}}>{algoName||'New Algo'}</h1>
        <div className="page-header-actions">
          {saved&&<span style={{fontSize:'12px',color:'var(--green)',fontWeight:600}}>✅ Saved!</span>}
          {saveError&&<span style={{fontSize:'12px',color:'var(--red)'}}>{saveError}</span>}
          <button className="btn btn-ghost" onClick={()=>navigate('/grid')}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave}>Save Algo</button>
        </div>
      </div>

      {/* Identity card */}
      <div className="card" style={{marginBottom:'12px'}}>
        <SubSection title="Identity — Algo Level"/>
        <div style={{display:'flex',alignItems:'flex-end',gap:'10px',flexWrap:'wrap'}}>
          <div style={{display:'flex',flexDirection:'column',gap:'4px',flex:'1 1 150px',maxWidth:'180px'}}>
            <label style={{fontSize:'10px',color:'var(--text-dim)',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.05em'}}>Algo Name</label>
            <input className="staax-input" placeholder="e.g. AWS-1" value={algoName} onChange={e=>setAlgoName(e.target.value)} style={{fontSize:'12px'}}/>
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:'4px',width:'66px'}}>
            <label style={{fontSize:'10px',color:'var(--text-dim)',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.05em'}}>Lot Mult.</label>
            <input className="staax-input" type="number" min={1} value={lotMult} onChange={e=>setLotMult(e.target.value)} style={{width:'66px',fontSize:'12px'}}/>
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:'4px'}}>
            <label style={{fontSize:'10px',color:'var(--text-dim)',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.05em'}}>Strategy</label>
            <select className="staax-select" value={stratMode} onChange={e=>setStratMode(e.target.value)} style={{width:'118px',fontSize:'12px'}}>
              <option value="intraday">Intraday</option><option value="btst">BTST</option><option value="stbt">STBT</option><option value="positional">Positional</option>
            </select>
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:'4px'}}>
            <label style={{fontSize:'10px',color:'var(--text-dim)',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.05em'}}>Order Type</label>
            <select className="staax-select" value={orderType} onChange={e=>setOrderType(e.target.value)} style={{width:'100px',fontSize:'12px'}}>
              <option value="MARKET">MARKET</option><option value="LIMIT">LIMIT</option>
            </select>
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:'4px',marginLeft:'auto'}}>
            <label style={{fontSize:'10px',color:'var(--text-dim)',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.05em'}}>Account</label>
            <select className="staax-select" value={account} onChange={e=>setAccount(e.target.value)} style={{width:'140px',fontSize:'12px'}}>
              <option value="Karthik (Zerodha)">Karthik</option><option value="Mom (Angel One)">Mom</option>
            </select>
          </div>
        </div>

        {/* Entry Type — Direct and ORB only, aligned with time inputs */}
        <div style={{marginTop:'14px',paddingTop:'12px',borderTop:'1px solid var(--bg-border)'}}>
          <SubSection title="Entry Type & Timing — Algo Level"/>
          <div style={{display:'flex',alignItems:'flex-end',gap:'8px',flexWrap:'wrap'}}>
            <div style={{display:'flex',flexDirection:'column',gap:'4px'}}>
              <label style={{fontSize:'10px',color:'var(--text-dim)',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.05em'}}>Entry Type</label>
              <div style={{display:'flex',gap:'6px'}}>
                <button onClick={()=>setEntryType('direct')} className={`chip ${entryType==='direct'?'chip-active':'chip-inactive'}`}>Direct</button>
                <button onClick={()=>setEntryType('orb')}    className={`chip ${entryType==='orb'?'chip-active':'chip-inactive'}`}>ORB</button>
              </div>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:'4px'}}>
              <label style={{fontSize:'10px',color:'var(--text-dim)',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.05em'}}>Entry Time</label>
              <input type="time" value={entryTime} onChange={e=>setEntryTime(e.target.value)} style={timeInput as any}/>
            </div>
            {entryType==='orb'&&(
              <div style={{display:'flex',flexDirection:'column',gap:'4px'}}>
                <label style={{fontSize:'10px',color:'var(--text-dim)',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.05em'}}>ORB End</label>
                <input type="time" value={orbEnd} onChange={e=>setOrbEnd(e.target.value)} style={timeInput as any}/>
              </div>
            )}
            <div style={{display:'flex',flexDirection:'column',gap:'4px'}}>
              <label style={{fontSize:'10px',color:'var(--text-dim)',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.05em'}}>Exit Time</label>
              <input type="time" value={exitTime} onChange={e=>setExitTime(e.target.value)} style={timeInput as any}/>
            </div>
            {stratMode==='positional'&&(
              <div style={{display:'flex',flexDirection:'column',gap:'4px'}}>
                <label style={{fontSize:'10px',color:'var(--text-dim)',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.05em'}}>DTE</label>
                <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
                  <select className="staax-select" value={dte} onChange={e=>setDte(e.target.value)} style={{width:'72px',fontSize:'12px'}}>
                    {[0,1,2,3,4,5].map(n=><option key={n} value={n}>{n}</option>)}
                  </select>
                  <span style={{fontSize:'10px',color:'var(--text-dim)',maxWidth:'120px',lineHeight:1.3}}>
                    {dte==='0'?'On expiry':''+dte+'d before'}
                  </span>
                </div>
              </div>
            )}
            {(stratMode==='btst'||stratMode==='stbt')&&(
              <div style={{display:'flex',alignItems:'flex-end',paddingBottom:'2px'}}>
                <span style={{fontSize:'10px',color:'var(--accent-amber)',background:'rgba(215,123,18,0.1)',padding:'5px 8px',borderRadius:'4px',border:'1px solid rgba(215,123,18,0.2)',lineHeight:1.4}}>
                  ⚠ Next day SL check auto-handled
                </span>
              </div>
            )}
          </div>
        </div>

        {/* MTM */}
        <div style={{marginTop:'14px',paddingTop:'12px',borderTop:'1px solid var(--bg-border)'}}>
          <SubSection title="MTM Controls — Algo Level"/>
          <div style={{display:'flex',alignItems:'center',gap:'10px',flexWrap:'wrap'}}>
            <select className="staax-select" value={mtmUnit} onChange={e=>setMtmUnit(e.target.value)} style={{width:'96px',fontSize:'12px'}}>
              <option value="amt">₹ Amount</option><option value="pct">% Premium</option>
            </select>
            <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
              <span style={{fontSize:'11px',color:'var(--text-muted)',fontWeight:600}}>MTM SL:</span>
              <input value={mtmSL} onChange={e=>setMtmSL(e.target.value)} placeholder="None" className="staax-input" style={{width:'80px',fontSize:'12px'}}/>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
              <span style={{fontSize:'11px',color:'var(--text-muted)',fontWeight:600}}>MTM TP:</span>
              <input value={mtmTP} onChange={e=>setMtmTP(e.target.value)} placeholder="None" className="staax-input" style={{width:'80px',fontSize:'12px'}}/>
            </div>
          </div>
        </div>
      </div>

      {/* Legs */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'8px'}}>
        <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
          <span style={{fontSize:'11px',fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.08em'}}>Legs</span>
          <span style={{fontSize:'9px',padding:'2px 7px',borderRadius:'3px',background:'rgba(34,197,94,0.1)',color:'var(--green)',fontWeight:700}}>SL · TP · TSL · W&T · RE per leg</span>
          <span style={{fontSize:'11px',color:'var(--text-dim)'}}>{legs.length} leg{legs.length>1?'s':''}</span>
        </div>
        <button className="btn btn-ghost" style={{fontSize:'11px'}} onClick={addLeg}>+ Add Leg</button>
      </div>
      {legs.map((leg,i)=>(
        <div key={leg.id}
          draggable
          onDragStart={()=>setDragIdx(i)}
          onDragOver={e=>{e.preventDefault();setDragOverIdx(i)}}
          onDragEnd={handleDragEnd}
          style={{outline:dragOverIdx===i&&dragIdx!==i?'2px dashed var(--accent-blue)':'none',borderRadius:'7px'}}>
          <LegRow leg={leg} isDragging={dragIdx===i}
            onUpdate={updateLeg} onRemove={removeLeg} onCopy={copyLeg}
            dragHandleProps={{}}/>
        </div>
      ))}

      {/* Delays + Errors */}
      <div className="card" style={{marginTop:'12px'}}>
        <SubSection title="Order Delays — Algo Level"/>
        <div style={{display:'flex',alignItems:'center',gap:'16px',flexWrap:'wrap'}}>
          <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
            <span style={{fontSize:'11px',color:'var(--text-muted)',fontWeight:600,whiteSpace:'nowrap'}}>Entry Delay:</span>
            <input value={entryDelay} onChange={e=>setEntryDelay(e.target.value)} type="number" min={0} max={60} className="staax-input" style={{width:'60px',fontSize:'12px'}}/>
            <span style={{fontSize:'10px',color:'var(--text-dim)'}}>s (max 60)</span>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
            <span style={{fontSize:'11px',color:'var(--text-muted)',fontWeight:600,whiteSpace:'nowrap'}}>Exit Delay:</span>
            <input value={exitDelay} onChange={e=>setExitDelay(e.target.value)} type="number" min={0} max={60} className="staax-input" style={{width:'60px',fontSize:'12px'}}/>
            <span style={{fontSize:'10px',color:'var(--text-dim)'}}>s (max 60)</span>
          </div>
        </div>
        <div style={{margin:'12px 0 10px',borderTop:'1px solid var(--bg-border)'}}/>
        <SubSection title="Error Settings — Algo Level"/>
        <div style={{display:'flex',gap:'20px',flexWrap:'wrap'}}>
          <label style={{display:'flex',alignItems:'center',gap:'7px',cursor:'pointer',fontSize:'11px',color:'var(--red)'}}>
            <input type="checkbox" checked={errorMargin} onChange={e=>setErrorMargin(e.target.checked)} style={{accentColor:'var(--red)'}}/>
            On margin error, exit all open positions
          </label>
          <label style={{display:'flex',alignItems:'center',gap:'7px',cursor:'pointer',fontSize:'11px',color:'var(--red)'}}>
            <input type="checkbox" checked={errorEntry} onChange={e=>setErrorEntry(e.target.checked)} style={{accentColor:'var(--red)'}}/>
            If any entry fails, exit all open positions
          </label>
        </div>
      </div>
    </div>
  )
}
EOF

# ─── REPORTS — Trend graph modal, filter shows only active input ──────────────
# (Patching only the widget section and metrics filter — rest unchanged from v6)
# Full replacement for clarity:
cat > frontend/src/pages/ReportsPage.tsx << 'REPORTSEOF'
import { useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

const MONTHS_FY=['Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar']
const FY_PNLS=[12400,28900,21200,45600,38400,61200,54800,72300,68900,84100,79200,91500]
const CUMULATIVE=MONTHS_FY.map((m,i)=>({month:m,cumulative:FY_PNLS.slice(0,i+1).reduce((s,x)=>s+x,0)}))

const ALGO_METRICS=[
  {name:'AWS-1', totalPnl:48320,avgDay:1250,maxProfit:8400, maxLoss:-3200,winPct:68,lossPct:32,mdd:-9800, roi:9.7},
  {name:'TF-BUY',totalPnl:22180,avgDay:820, maxProfit:6200, maxLoss:-2100,winPct:61,lossPct:39,mdd:-6400, roi:7.4},
  {name:'S1',    totalPnl:15600,avgDay:610, maxProfit:4100, maxLoss:-1800,winPct:55,lossPct:45,mdd:-4200, roi:5.2},
  {name:'MDS-1', totalPnl:5400, avgDay:280, maxProfit:2200, maxLoss:-900, winPct:52,lossPct:48,mdd:-2100, roi:3.6},
]
const METRIC_ROWS=[
  {key:'totalPnl', label:'Overall P&L',  isLoss:false},{key:'avgDay',   label:'Avg Day P&L',  isLoss:false},
  {key:'maxProfit',label:'Max Profit',   isLoss:false},{key:'maxLoss',  label:'Max Loss',     isLoss:true },
  {key:'winPct',   label:'Win %',        isLoss:false},{key:'lossPct',  label:'Loss %',       isLoss:true },
  {key:'mdd',      label:'Max Drawdown', isLoss:true }, {key:'roi',      label:'ROI',          isLoss:false},
]

function genDayPnls(month:number,year:number){
  const days=new Date(year,month,0).getDate(),r:Record<number,number|null>={}
  for(let d=1;d<=days;d++){const dow=new Date(year,month-1,d).getDay();if(dow===0||dow===6){r[d]=null;continue}const s=(d*37+month*13+year)%100;r[d]=s>45?Math.floor((s-45)*220):-Math.floor((45-s)*110)}
  return r
}
function fyMonths(fy:string){const sy=parseInt(fy.split('-')[0]);return [4,5,6,7,8,9,10,11,12,1,2,3].map(m=>({month:m,year:m>=4?sy:sy+1,label:['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m],key:`${m}-${m>=4?sy:sy+1}`}))}

const CARD_H=148
function MiniCal({month,year,label,selected,onToggle}:{month:number,year:number,label:string,selected:boolean,onToggle:()=>void}){
  const pnls=genDayPnls(month,year),vals=Object.values(pnls).filter(v=>v!==null) as number[]
  const winDays=vals.filter(v=>v>0).length,lossDays=vals.filter(v=>v<=0).length,total=winDays+lossDays
  const monthPnl=vals.reduce((s,v)=>s+v,0)
  const firstDow=new Date(year,month-1,1).getDay(),offset=(firstDow===0?4:firstDow-1)%5
  const tradingDays=Array.from({length:new Date(year,month,0).getDate()},(_,i)=>i+1).filter(d=>{const dow=new Date(year,month-1,d).getDay();return dow!==0&&dow!==6})
  const padded=[...Array(offset).fill(null),...tradingDays]
  return (
    <div onClick={onToggle} style={{background:selected?'rgba(0,176,240,0.08)':'var(--bg-secondary)',border:`1px solid ${selected?'var(--accent-blue)':'var(--bg-border)'}`,borderRadius:'8px',padding:'10px',cursor:'pointer',transition:'all 0.12s',height:`${CARD_H}px`,overflow:'hidden',display:'flex',flexDirection:'column'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'4px',flexShrink:0}}>
        <span style={{fontSize:'11px',fontWeight:700,letterSpacing:'0.06em',color:selected?'var(--accent-blue)':'var(--text)'}}>{label.toUpperCase()}</span>
        <span style={{fontSize:'10px',fontWeight:700,color:monthPnl>=0?'var(--green)':'var(--red)'}}>{monthPnl>=0?'+':''}{(monthPnl/1000).toFixed(1)}k</span>
      </div>
      {total>0&&<div style={{height:'3px',borderRadius:'2px',background:'var(--bg-border)',marginBottom:'5px',overflow:'hidden',display:'flex',flexShrink:0}}><div style={{width:`${(winDays/total)*100}%`,height:'100%',background:'var(--green)'}}/><div style={{width:`${(lossDays/total)*100}%`,height:'100%',background:'var(--red)'}}/></div>}
      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:'1px',marginBottom:'3px',flexShrink:0}}>
        {['M','T','W','T','F'].map((d,i)=><div key={i} style={{textAlign:'center',fontSize:'7px',color:'var(--text-dim)',fontWeight:700}}>{d}</div>)}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:'3px',flex:1,alignContent:'start'}}>
        {padded.map((day,i)=>(
          <div key={i} style={{display:'flex',alignItems:'center',justifyContent:'center',padding:'2px 0'}}>
            {day?<div style={{width:10,height:10,borderRadius:'3px',background:pnls[day as number]!==null?(pnls[day as number]!>0?'var(--green)':'var(--red)'):'transparent',opacity:0.85}}/>:<div style={{width:10,height:10}}/>}
          </div>
        ))}
      </div>
    </div>
  )
}

function MonthDetail({month,year,label}:{month:number,year:number,label:string}){
  const pnls=genDayPnls(month,year)
  const firstDow=new Date(year,month-1,1).getDay(),offset=(firstDow===0?4:firstDow-1)%5
  const tradingDays=Array.from({length:new Date(year,month,0).getDate()},(_,i)=>i+1).filter(d=>{const dow=new Date(year,month-1,d).getDay();return dow!==0&&dow!==6})
  const padded=[...Array(offset).fill(null),...tradingDays]
  return (
    <div style={{background:'var(--bg-secondary)',border:'1px solid var(--accent-blue)',borderRadius:'8px',padding:'16px',marginTop:'12px'}}>
      <div style={{fontSize:'12px',fontWeight:700,color:'var(--accent-blue)',marginBottom:'14px'}}>{label} {year} — Day View</div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:'4px',marginBottom:'4px'}}>
        {['Mon','Tue','Wed','Thu','Fri'].map(d=><div key={d} style={{textAlign:'center',fontSize:'10px',color:'var(--text-dim)',fontWeight:600}}>{d}</div>)}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:'4px'}}>
        {padded.map((day,i)=>{
          if(!day)return <div key={i}/>
          const pnl=pnls[day as number]
          return <div key={i} style={{padding:'8px 4px',borderRadius:'6px',textAlign:'center',background:pnl==null?'transparent':pnl>0?`rgba(34,197,94,${Math.min(pnl/8000,1)*0.35+0.08})`:`rgba(239,68,68,${Math.min(Math.abs(pnl)/3000,1)*0.35+0.08})`}}>
            <div style={{fontSize:'11px',color:'var(--text-muted)'}}>{day}</div>
            {pnl!=null&&<div style={{fontSize:'10px',fontWeight:700,marginTop:'2px',color:pnl>0?'var(--green)':'var(--red)'}}>{pnl>0?'+':''}{(pnl/1000).toFixed(1)}k</div>}
          </div>
        })}
      </div>
    </div>
  )
}

export default function ReportsPage(){
  const [fy,setFy]=useState('2024-25')
  const [expandedMonth,setExpandedMonth]=useState<string|null>(null)
  const [metricFilter,setMetricFilter]=useState('fy')
  const [metricMonth,setMetricMonth]=useState('Apr')
  const [metricDate,setMetricDate]=useState('')
  const [metricFrom,setMetricFrom]=useState('')
  const [metricTo,setMetricTo]=useState('')
  const [chartModal,setChartModal]=useState(false)

  const months=fyMonths(fy)
  const totalPnl=FY_PNLS.reduce((s,x)=>s+x,0),prevPnl=702440
  const expandedData=expandedMonth?months.find(m=>m.key===expandedMonth):null

  const activePeriodLabel=metricFilter==='fy'?`FY ${fy}`:metricFilter==='month'?`${metricMonth} · FY ${fy}`:metricFilter==='date'&&metricDate?metricDate:metricFilter==='custom'&&metricFrom&&metricTo?`${metricFrom} → ${metricTo}`:'Select period'

  return (
    <div>
      <div className="page-header">
        <h1 style={{fontFamily:"'ADLaM Display',serif",fontSize:'22px',fontWeight:400}}>Reports</h1>
        <div className="page-header-actions">
          <select className="staax-select" value={fy} onChange={e=>setFy(e.target.value)} style={{width:'120px'}}>
            <option value="2024-25">FY 2024–25</option><option value="2023-24">FY 2023–24</option>
          </select>
          <button className="btn btn-ghost" style={{fontSize:'11px'}}>⬇ CSV</button>
        </div>
      </div>

      {/* Widgets */}
      <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr',gap:'12px',marginBottom:'20px'}}>
        {/* FY P&L — clickable for modal */}
        <div className="card" style={{cursor:'pointer'}} onClick={()=>setChartModal(true)}>
          <div style={{fontSize:'10px',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:'4px'}}>FY {fy} Total P&L <span style={{fontSize:'9px',color:'var(--accent-blue)'}}>↗ click to expand</span></div>
          <div style={{display:'flex',alignItems:'flex-end',gap:'16px'}}>
            <div>
              <div style={{fontSize:'26px',fontWeight:700,color:'var(--green)',letterSpacing:'-0.02em'}}>₹{(totalPnl/100000).toFixed(2)}L</div>
              <div style={{fontSize:'11px',color:'var(--green)',marginTop:'2px'}}>▲ {(((totalPnl-prevPnl)/prevPnl)*100).toFixed(1)}% vs prev year</div>
            </div>
            <div style={{flex:1,height:'46px'}}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={CUMULATIVE}><Line type="monotone" dataKey="cumulative" stroke="#00B0F0" strokeWidth={2} dot={false}/></LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
        <div className="card"><div style={{fontSize:'10px',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:'4px'}}>March P&L</div><div style={{fontSize:'22px',fontWeight:700,color:'var(--green)'}}>₹91,500</div><div style={{fontSize:'11px',color:'var(--green)',marginTop:'4px'}}>▲ 6.3% vs Feb</div></div>
        <div className="card"><div style={{fontSize:'10px',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:'4px'}}>Today P&L</div><div style={{fontSize:'22px',fontWeight:700,color:'var(--green)'}}>+₹4,320</div><div style={{fontSize:'11px',color:'var(--text-dim)',marginTop:'4px'}}>2 algos active</div></div>
      </div>

      {/* Chart modal */}
      {chartModal&&(
        <div className="modal-overlay" onClick={()=>setChartModal(false)}>
          <div className="modal-box" style={{maxWidth:'780px',width:'90%'}} onClick={e=>e.stopPropagation()}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'16px'}}>
              <div style={{fontWeight:700,fontSize:'16px'}}>FY {fy} — Cumulative P&L</div>
              <button onClick={()=>setChartModal(false)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-muted)',fontSize:'18px'}}>✕</button>
            </div>
            <div style={{height:'320px'}}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={CUMULATIVE} margin={{top:10,right:20,bottom:10,left:40}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)"/>
                  <XAxis dataKey="month" tick={{fill:'var(--text-muted)',fontSize:11}}/>
                  <YAxis tick={{fill:'var(--text-muted)',fontSize:11}} tickFormatter={v=>`₹${(v/1000).toFixed(0)}k`}/>
                  <Tooltip formatter={(v:any)=>[`₹${v.toLocaleString('en-IN')}`,'Cumulative P&L']} contentStyle={{background:'var(--bg-surface)',border:'1px solid var(--bg-border)',borderRadius:'6px'}} labelStyle={{color:'var(--text-muted)'}} itemStyle={{color:'var(--accent-blue)'}}/>
                  <Line type="monotone" dataKey="cumulative" stroke="#00B0F0" strokeWidth={2.5} dot={{fill:'#00B0F0',r:3}}/>
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* FY Calendar */}
      <div className="card" style={{marginBottom:'20px'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'12px'}}>
          <div style={{fontSize:'11px',fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.08em'}}>FY {fy} — Full Year Calendar</div>
          <div style={{display:'flex',gap:'12px',fontSize:'11px',color:'var(--text-dim)',alignItems:'center'}}>
            <span style={{display:'flex',alignItems:'center',gap:'4px'}}><span style={{width:'8px',height:'8px',borderRadius:'2px',background:'var(--green)',display:'inline-block'}}/> Profit</span>
            <span style={{display:'flex',alignItems:'center',gap:'4px'}}><span style={{width:'8px',height:'8px',borderRadius:'2px',background:'var(--red)',display:'inline-block'}}/> Loss</span>
            <span>Click to expand</span>
          </div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:'8px'}}>
          {months.map(m=><MiniCal key={m.key} month={m.month} year={m.year} label={m.label} selected={expandedMonth===m.key} onToggle={()=>setExpandedMonth(p=>p===m.key?null:m.key)}/>)}
        </div>
        {expandedData&&<MonthDetail month={expandedData.month} year={expandedData.year} label={expandedData.label}/>}
      </div>

      {/* Per-Algo Metrics */}
      <div className="card" style={{overflowX:'auto'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'12px',flexWrap:'wrap',gap:'8px'}}>
          <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
            <div style={{fontSize:'11px',fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.08em'}}>Per-Algo Metrics</div>
            <span style={{fontSize:'11px',color:'var(--accent-blue)',background:'rgba(0,176,240,0.1)',padding:'2px 8px',borderRadius:'4px',fontWeight:600}}>{activePeriodLabel}</span>
          </div>
          <div style={{display:'flex',gap:'6px',alignItems:'center',flexWrap:'wrap'}}>
            {/* FY selector — always visible */}
            <select className="staax-select" value={fy} onChange={e=>setFy(e.target.value)} style={{width:'108px',fontSize:'11px'}}>
              <option value="2024-25">FY 2024–25</option><option value="2023-24">FY 2023–24</option>
            </select>
            {/* Filter chips */}
            {[['fy','FY'],['month','Month'],['date','Date'],['custom','From–To']].map(([v,l])=>(
              <button key={v} onClick={()=>setMetricFilter(v)} className={`chip ${metricFilter===v?'chip-active':'chip-inactive'}`} style={{height:'32px',padding:'0 12px',fontSize:'11px'}}>{l}</button>
            ))}
            {/* Only show input for active filter */}
            {metricFilter==='month'&&<select className="staax-select" value={metricMonth} onChange={e=>setMetricMonth(e.target.value)} style={{width:'90px',fontSize:'11px'}}>{MONTHS_FY.map(m=><option key={m}>{m}</option>)}</select>}
            {metricFilter==='date'&&<input type="date" className="staax-input" value={metricDate} onChange={e=>setMetricDate(e.target.value)} style={{width:'140px',fontSize:'11px',colorScheme:'dark'} as any}/>}
            {metricFilter==='custom'&&<div style={{display:'flex',alignItems:'center',gap:'5px'}}><input type="date" className="staax-input" value={metricFrom} onChange={e=>setMetricFrom(e.target.value)} style={{width:'130px',fontSize:'11px',colorScheme:'dark'} as any}/><span style={{fontSize:'11px',color:'var(--text-dim)'}}>→</span><input type="date" className="staax-input" value={metricTo} onChange={e=>setMetricTo(e.target.value)} style={{width:'130px',fontSize:'11px',colorScheme:'dark'} as any}/></div>}
            {/* CSV — same spacing as FY dropdown */}
            <button className="btn btn-ghost" style={{fontSize:'11px',height:'32px',padding:'0 12px'}}>⬇ CSV</button>
          </div>
        </div>
        <table className="staax-table">
          <thead><tr><th style={{minWidth:'130px'}}>Key Metrics</th>{ALGO_METRICS.map(a=><th key={a.name}>{a.name}</th>)}<th style={{color:'var(--accent-blue)'}}>Cumulative</th></tr></thead>
          <tbody>
            {METRIC_ROWS.map(row=>{
              const cumVal=ALGO_METRICS.reduce((s,a)=>s+(a as any)[row.key],0)
              const isPct=row.key==='winPct'||row.key==='lossPct'||row.key==='roi'
              const fmt=(n:number)=>isPct?`${Math.abs(n)}%`:`₹${Math.abs(n).toLocaleString('en-IN')}`
              const cumFmt=isPct?`${(cumVal/ALGO_METRICS.length).toFixed(1)}%`:`₹${Math.abs(cumVal).toLocaleString('en-IN')}`
              return <tr key={row.key}><td style={{fontWeight:600,color:'var(--text-muted)',fontSize:'12px'}}>{row.label}</td>{ALGO_METRICS.map(a=><td key={a.name} style={{color:row.isLoss?'var(--red)':'var(--green)',fontWeight:600}}>{fmt((a as any)[row.key])}</td>)}<td style={{color:'var(--accent-blue)',fontWeight:700}}>{cumFmt}</td></tr>
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
REPORTSEOF

echo ""
echo "✅ Phase 1C v7 complete!"
echo ""
echo "Changes:"
echo "  Global     — .page-content for consistent padding everywhere"
echo "  Sidebar    — 52px header matches TopBar, larger icons (18px), uniform grid layout"
echo "  TopBar     — 'Account:' label removed, PRACTIX/bell same height, notifications panel"  
echo "  Dashboard  — Zerodha token card fixed minHeight, no layout shift on login"
echo "  Smart Grid — M/E/X white labels + blue values, getAlgoStatus() error priority fix"
echo "  Algo Config — Days removed, Direct+ORB only, drag-to-reorder legs (⠿ handle)"
echo "  Orders     — RUN/SQ/T modals, RE inline status, weekend both SAT+SUN toggle"
echo "  Reports    — Chart modal on click, only active filter input shown, CSV spacing"
echo ""
echo "git add . && git commit -m 'Phase 1C v7: Notifications, modals, drag legs, chart modal, M/E/X colors' && git push origin feature/ui-phase1c"
