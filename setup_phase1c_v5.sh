#!/bin/bash
# STAAX Phase 1C v5
# Run from: cd ~/STAXX/staax && bash setup_phase1c_v5.sh

echo "🚀 Applying Phase 1C v5..."

# ─── SHARED ALGO CONTEXT ─────────────────────────────────────────────────────
mkdir -p frontend/src/context

cat > frontend/src/context/AlgoContext.tsx << 'EOF'
import { createContext, useContext, useState, ReactNode } from 'react'

export interface SavedAlgo {
  id: string
  name: string
  account: string
  stratMode: string
  entryType: string
  entryTime: string
  exitTime: string
  days: Record<string,boolean>
  legs: { instCode:string, dir:'B'|'S' }[]
}

interface AlgoContextType {
  algos: SavedAlgo[]
  addAlgo: (a: SavedAlgo) => void
  updateAlgo: (a: SavedAlgo) => void
}

const AlgoContext = createContext<AlgoContextType>({
  algos: [], addAlgo: ()=>{}, updateAlgo: ()=>{},
})

// Seed with demo algos
const DEMO_ALGOS: SavedAlgo[] = [
  { id:'1', name:'AWS-1',  account:'Karthik', stratMode:'btst',     entryType:'orb',    entryTime:'09:16', exitTime:'15:10', days:{M:true,T:true,W:true,T2:true,F:true,SAT:false,SUN:false}, legs:[{instCode:'NF',dir:'B'},{instCode:'NF',dir:'B'}] },
  { id:'2', name:'TF-BUY', account:'Mom',     stratMode:'intraday', entryType:'wt',     entryTime:'09:30', exitTime:'15:10', days:{M:true,T:false,W:true,T2:true,F:false,SAT:false,SUN:false}, legs:[{instCode:'BN',dir:'B'}] },
  { id:'3', name:'S1',     account:'Karthik', stratMode:'intraday', entryType:'direct', entryTime:'09:20', exitTime:'15:10', days:{M:true,T:false,W:false,T2:true,F:false,SAT:false,SUN:false}, legs:[{instCode:'NF',dir:'B'},{instCode:'NF',dir:'S'}] },
  { id:'4', name:'MDS-1',  account:'Mom',     stratMode:'intraday', entryType:'orb',    entryTime:'09:30', exitTime:'15:10', days:{M:false,T:true,W:false,T2:false,F:true,SAT:false,SUN:false}, legs:[{instCode:'MN',dir:'B'}] },
]

export function AlgoProvider({ children }: { children: ReactNode }) {
  const [algos, setAlgos] = useState<SavedAlgo[]>(DEMO_ALGOS)
  const addAlgo    = (a: SavedAlgo) => setAlgos(prev => [...prev, a])
  const updateAlgo = (a: SavedAlgo) => setAlgos(prev => prev.map(x => x.id===a.id ? a : x))
  return <AlgoContext.Provider value={{ algos, addAlgo, updateAlgo }}>{children}</AlgoContext.Provider>
}

export const useAlgos = () => useContext(AlgoContext)
EOF

# ─── WRAP APP WITH PROVIDER ───────────────────────────────────────────────────
cat > frontend/src/main.tsx << 'EOF'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { AlgoProvider } from '@/context/AlgoContext'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AlgoProvider>
      <App />
    </AlgoProvider>
  </React.StrictMode>
)
EOF

# ─── GLOBAL CSS — Standardize button height, consistent spacing ───────────────
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

  /* Standardised dimensions */
  --btn-h:        32px;
  --page-pad:     20px 24px;
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

/* ── Page header — consistent top row ─────────────────────────── */
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

/* ── Buttons — all same height ─────────────────────────────────── */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: var(--btn-h);
  padding: 0 14px;
  border-radius: 5px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: all 0.15s;
  white-space: nowrap;
  font-family: inherit;
}
.btn-primary { background: var(--accent-blue); color: #000; }
.btn-primary:hover { background: #00c8ff; }
.btn-danger  { background: rgba(239,68,68,0.15); color: var(--red); border:1px solid rgba(239,68,68,0.3); }
.btn-danger:hover { background: rgba(239,68,68,0.25); }
.btn-ghost   { background: rgba(255,255,255,0.06); color: var(--text-muted); }
.btn-ghost:hover { background: rgba(255,255,255,0.1); color: var(--text); }
.btn-amber   { background: rgba(215,123,18,0.15); color: var(--accent-amber); border:1px solid rgba(215,123,18,0.3); }
.btn:disabled { opacity:0.4; cursor:not-allowed; }

/* Action buttons — outlined with colour, fixed width */
.btn-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: var(--btn-h);
  min-width: 42px;
  padding: 0 12px;
  border-radius: 5px;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  background: transparent;
  transition: all 0.12s;
  font-family: inherit;
}

/* ── Table ──────────────────────────────────────────────────────── */
.staax-table { width:100%; border-collapse:collapse; table-layout:fixed; }
.staax-table th {
  background: var(--bg-secondary);
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 8px 10px;
  text-align: left;
  border-bottom: 1px solid var(--bg-border);
  white-space: nowrap;
  overflow: hidden;
}
.staax-table td {
  padding: 10px 10px;
  border-bottom: 1px solid rgba(63,65,67,0.5);
  font-size: 12px;
  overflow: hidden;
}
.staax-table tr:hover td { background: rgba(255,255,255,0.02); }

/* ── Tag ────────────────────────────────────────────────────────── */
.tag {
  display: inline-flex; align-items: center;
  padding: 2px 7px; border-radius: 4px;
  font-size: 10px; font-weight: 700; letter-spacing: 0.03em;
}

/* ── Input ──────────────────────────────────────────────────────── */
.staax-input {
  background: var(--bg-secondary); border: 1px solid var(--bg-border);
  color: var(--text); border-radius: 5px; padding: 0 10px;
  height: var(--btn-h);
  font-size: 12px; font-family: inherit; width: 100%;
  transition: border-color 0.15s;
}
.staax-input:focus { outline:none; border-color: var(--accent-blue); }
.staax-input::placeholder { color: var(--text-muted); }

/* ── Select ─────────────────────────────────────────────────────── */
.staax-select {
  background: var(--bg-secondary); border: 1px solid var(--bg-border);
  color: var(--text); border-radius: 5px; padding: 0 28px 0 10px;
  height: var(--btn-h);
  font-size: 12px; font-family: inherit; cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239CA3AF' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 8px center;
}
.staax-select:focus { outline:none; border-color: var(--accent-blue); }

/* ── Card ───────────────────────────────────────────────────────── */
.card {
  background: var(--bg-surface); border: 1px solid var(--bg-border);
  border-radius: 8px; padding: 16px;
}

/* ── Toggle chip (entry type, day selectors) ────────────────────── */
.chip {
  display: inline-flex; align-items: center; justify-content: center;
  height: var(--btn-h); padding: 0 14px;
  border-radius: 5px; font-size: 12px; font-weight: 600;
  cursor: pointer; border: none; transition: all 0.12s;
  font-family: inherit;
}
.chip-active   { background: var(--accent-blue); color: #000; }
.chip-inactive { background: var(--bg-secondary); color: var(--text-muted); }
.chip-inactive:hover { background: var(--bg-surface); color: var(--text); }

@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
EOF

# ─── SMART GRID — Use context, compact cells, consistent header ───────────────
cat > frontend/src/pages/GridPage.tsx << 'EOF'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAlgos, SavedAlgo } from '@/context/AlgoContext'

const DAYS     = ['MON','TUE','WED','THU','FRI']
const WEEKENDS = ['SAT','SUN']
const DAY_KEY: Record<string,string> = { MON:'M', TUE:'T', WED:'W', THU:'T2', FRI:'F', SAT:'SAT', SUN:'SUN' }

type CellStatus = 'no_trade'|'algo_active'|'order_pending'|'open'|'algo_closed'|'error'

interface GridCell { multiplier:number; status:CellStatus; practix:boolean; entry:string; exit?:string }

const STATUS_CFG: Record<CellStatus,{label:string,color:string,bg:string,pct:number}> = {
  no_trade:      {label:'No Trade', color:'#6B7280', bg:'rgba(107,114,128,0.12)', pct:0  },
  algo_active:   {label:'Active',   color:'#00B0F0', bg:'rgba(0,176,240,0.12)',   pct:30 },
  order_pending: {label:'Pending',  color:'#F59E0B', bg:'rgba(245,158,11,0.12)',  pct:50 },
  open:          {label:'Open',     color:'#22C55E', bg:'rgba(34,197,94,0.12)',   pct:75 },
  algo_closed:   {label:'Closed',   color:'#16a34a', bg:'rgba(22,163,74,0.12)',   pct:100},
  error:         {label:'Error',    color:'#EF4444', bg:'rgba(239,68,68,0.12)',   pct:60 },
}

const INIT_GRID: Record<string,Record<string,GridCell>> = {
  '1': { MON:{multiplier:1,status:'open',       practix:true, entry:'09:16',exit:'15:10'}, TUE:{multiplier:1,status:'algo_closed',practix:false,entry:'09:16',exit:'15:10'}, WED:{multiplier:2,status:'algo_active',practix:true,entry:'09:16',exit:'15:10'}, FRI:{multiplier:1,status:'no_trade',practix:true,entry:'09:16',exit:'15:10'} },
  '2': { MON:{multiplier:2,status:'algo_active',practix:true, entry:'09:30',exit:'15:10'}, WED:{multiplier:1,status:'order_pending',practix:true,entry:'09:30',exit:'15:10'}, THU:{multiplier:2,status:'open',practix:true,entry:'09:30',exit:'15:10'} },
  '3': { MON:{multiplier:1,status:'no_trade',   practix:true, entry:'09:20',exit:'15:10'}, THU:{multiplier:1,status:'open',practix:true,entry:'09:20',exit:'15:10'} },
  '4': { TUE:{multiplier:3,status:'error',      practix:true, entry:'09:30',exit:'15:10'}, FRI:{multiplier:1,status:'no_trade',practix:true,entry:'09:30',exit:'15:10'} },
}

function CyclePie({ status }: { status: CellStatus }) {
  const cfg = STATUS_CFG[status]
  const r=13, cx=15, cy=15, circ=2*Math.PI*r
  const offset = circ*(1-cfg.pct/100)
  return (
    <svg width="30" height="30" style={{flexShrink:0}}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="2.5"/>
      {cfg.pct>0&&<circle cx={cx} cy={cy} r={r} fill="none" stroke={cfg.color} strokeWidth="2.5"
        strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}/>}
      <circle cx={cx} cy={cy} r="3.5" fill={cfg.color} opacity="0.85"/>
    </svg>
  )
}

export default function GridPage() {
  const navigate = useNavigate()
  const { algos } = useAlgos()
  const [grid, setGrid] = useState(INIT_GRID)
  const [showWeekends, setShowWeekends] = useState(false)
  const [editing, setEditing] = useState<{algoId:string,day:string}|null>(null)
  const [editVal, setEditVal] = useState('')
  const [dragAlgoId, setDragAlgoId] = useState<string|null>(null)

  const visibleDays = showWeekends ? [...DAYS,...WEEKENDS] : DAYS

  const updateMultiplier = (algoId:string, day:string, val:number) => {
    if (val<1) return
    setGrid(g=>({...g,[algoId]:{...g[algoId],[day]:{...g[algoId][day],multiplier:val}}}))
  }
  const removeCell = (algoId:string, day:string) => {
    setGrid(g=>{const u={...g[algoId]};delete u[day];return{...g,[algoId]:u}})
  }
  const handleDrop = (algoId:string, day:string) => {
    if (!dragAlgoId||dragAlgoId!==algoId||grid[algoId]?.[day]) return
    const algo = algos.find(a=>a.id===algoId)
    setGrid(g=>({...g,[algoId]:{...g[algoId],[day]:{multiplier:1,status:'algo_active',practix:true,entry:algo?.entryTime||'09:16',exit:algo?.exitTime||'15:10'}}}))
    setDragAlgoId(null)
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
            <input type="checkbox" checked={showWeekends} onChange={e=>setShowWeekends(e.target.checked)} style={{accentColor:'var(--accent-blue)'}}/>
            Show Weekends
          </label>
          <button className="btn btn-primary" onClick={()=>navigate('/algo/new')}>+ New Algo</button>
        </div>
      </div>

      {/* Legend */}
      <div style={{display:'flex',gap:'14px',marginBottom:'12px',flexWrap:'wrap',
        padding:'7px 12px',background:'var(--bg-secondary)',borderRadius:'6px',border:'1px solid var(--bg-border)'}}>
        {Object.entries(STATUS_CFG).map(([key,s])=>(
          <div key={key} style={{display:'flex',alignItems:'center',gap:'5px',fontSize:'11px',color:'var(--text-muted)'}}>
            <span style={{width:'8px',height:'8px',borderRadius:'50%',background:s.color,display:'inline-block',flexShrink:0}}/>
            {s.label}
          </div>
        ))}
        <span style={{marginLeft:'auto',fontSize:'10px',color:'var(--text-dim)'}}>Drag algo name → day cell to deploy</span>
      </div>

      <div style={{overflowX:'auto'}}>
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <colgroup>
            <col style={{width:'190px',minWidth:'190px'}}/>
            {visibleDays.map(d=><col key={d} style={{minWidth:'120px'}}/>)}
          </colgroup>
          <thead>
            <tr>
              <th style={{padding:'9px 12px',textAlign:'left',background:'var(--bg-secondary)',
                border:'1px solid var(--bg-border)',fontSize:'11px',color:'var(--text-muted)',
                fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase'}}>ALGO</th>
              {visibleDays.map(day=>(
                <th key={day} style={{padding:'9px 12px',textAlign:'center',background:'var(--bg-secondary)',
                  border:'1px solid var(--bg-border)',fontSize:'11px',fontWeight:700,
                  letterSpacing:'0.08em',textTransform:'uppercase',
                  color:WEEKENDS.includes(day)?'var(--text-dim)':'var(--text-muted)'}}>
                  {day}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {algos.map(algo=>(
              <tr key={algo.id}>
                <td draggable onDragStart={()=>setDragAlgoId(algo.id)} onDragEnd={()=>setDragAlgoId(null)}
                  style={{padding:'8px 12px',background:'var(--bg-secondary)',
                    border:'1px solid var(--bg-border)',cursor:'grab',userSelect:'none'}}>
                  <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                    <CyclePie status={(grid[algo.id] ? Object.values(grid[algo.id]).find(c=>c.status==='open'||c.status==='algo_active')?.status : undefined) || 'no_trade'}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:700,fontSize:'13px',color:'var(--text)',marginBottom:'2px'}}>{algo.name}</div>
                      <div style={{fontSize:'10px',color:'var(--text-dim)',marginBottom:'4px'}}>{algo.account}</div>
                      <div style={{display:'flex',gap:'3px',flexWrap:'wrap'}}>
                        {algo.legs.map((leg,i)=>(
                          <span key={i} style={{fontSize:'9px',fontWeight:700,letterSpacing:'0.04em',
                            padding:'1px 5px',borderRadius:'3px',
                            background:leg.dir==='B'?'rgba(34,197,94,0.15)':'rgba(239,68,68,0.15)',
                            color:leg.dir==='B'?'var(--green)':'var(--red)',
                            border:`1px solid ${leg.dir==='B'?'rgba(34,197,94,0.3)':'rgba(239,68,68,0.3)'}`}}>
                            {leg.instCode} {leg.dir}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </td>
                {visibleDays.map(day=>{
                  const cell=grid[algo.id]?.[day]
                  const s=cell?STATUS_CFG[cell.status]:null
                  const isOvernight = algo.stratMode==='btst'||algo.stratMode==='stbt'||algo.stratMode==='positional'
                  return (
                    <td key={day} onDragOver={e=>e.preventDefault()} onDrop={()=>handleDrop(algo.id,day)}
                      style={{padding:'4px',border:'1px solid var(--bg-border)',verticalAlign:'top',
                        background:WEEKENDS.includes(day)&&!cell?'rgba(30,32,34,0.4)':undefined}}>
                      {cell&&s?(
                        <div style={{background:'var(--bg-secondary)',borderLeft:`3px solid ${s.color}`,
                          borderRadius:'5px',padding:'7px 8px',position:'relative'}}>
                          <button onClick={()=>removeCell(algo.id,day)}
                            style={{position:'absolute',top:'3px',right:'3px',background:'none',border:'none',
                              cursor:'pointer',color:'var(--text-dim)',fontSize:'11px',padding:'2px 4px'}}
                            onMouseEnter={e=>(e.currentTarget.style.color='var(--red)')}
                            onMouseLeave={e=>(e.currentTarget.style.color='var(--text-dim)')}>✕</button>
                          <span style={{fontSize:'9px',fontWeight:700,letterSpacing:'0.05em',
                            color:s.color,background:s.bg,padding:'2px 5px',borderRadius:'3px',
                            display:'inline-block',marginBottom:'5px'}}>
                            {s.label.toUpperCase()}
                          </span>
                          <div style={{display:'flex',alignItems:'center',gap:'4px',marginBottom:'3px'}}>
                            <span style={{fontSize:'10px',color:'var(--text-muted)'}}>M:</span>
                            {editing?.algoId===algo.id&&editing?.day===day?(
                              <input autoFocus type="number" min={1} value={editVal}
                                onChange={e=>setEditVal(e.target.value)}
                                onBlur={()=>{updateMultiplier(algo.id,day,parseInt(editVal)||1);setEditing(null)}}
                                onKeyDown={e=>e.key==='Enter'&&(updateMultiplier(algo.id,day,parseInt(editVal)||1),setEditing(null))}
                                style={{width:'34px',background:'var(--bg-primary)',border:'1px solid var(--accent-blue)',
                                  borderRadius:'3px',color:'var(--text)',fontSize:'11px',padding:'1px 4px',fontFamily:'inherit'}}/>
                            ):(
                              <span onClick={()=>{setEditing({algoId:algo.id,day});setEditVal(String(cell.multiplier))}}
                                title="Click to edit"
                                style={{fontSize:'12px',fontWeight:700,color:'var(--accent-blue)',cursor:'text',
                                  padding:'1px 4px',borderRadius:'3px',border:'1px solid transparent'}}
                                onMouseEnter={e=>(e.currentTarget.style.borderColor='var(--bg-border)')}
                                onMouseLeave={e=>(e.currentTarget.style.borderColor='transparent')}>
                                {cell.multiplier}
                              </span>
                            )}
                          </div>
                          <div style={{fontSize:'10px',color:'var(--text-muted)'}}>E: {cell.entry}</div>
                          {cell.exit&&<div style={{fontSize:'10px',color:'var(--text-dim)'}}>X: {cell.exit}</div>}
                          {isOvernight&&cell.status==='open'&&(
                            <div style={{fontSize:'9px',color:'var(--accent-amber)',marginTop:'2px',fontWeight:600}}>
                              {algo.legs.map(l=>l.dir==='B'?'ST':'BT').filter((v,i,a)=>a.indexOf(v)===i).join('/')}
                            </div>
                          )}
                          {cell.practix&&(
                            <span style={{fontSize:'8px',fontWeight:700,letterSpacing:'0.06em',
                              color:'var(--accent-amber)',background:'rgba(215,123,18,0.1)',
                              padding:'1px 4px',borderRadius:'2px',marginTop:'4px',display:'inline-block'}}>PRACTIX</span>
                          )}
                        </div>
                      ):(
                        <div style={{minHeight:'58px',border:'1px dashed var(--bg-border)',borderRadius:'5px',
                          display:'flex',alignItems:'center',justifyContent:'center',
                          color:'var(--text-dim)',fontSize:'10px',
                          background:dragAlgoId===algo.id?'rgba(0,176,240,0.05)':'transparent',
                          borderColor:dragAlgoId===algo.id?'var(--accent-blue)':'var(--bg-border)',
                          opacity:dragAlgoId===algo.id?0.9:0.4,transition:'all 0.15s'}}>
                          {dragAlgoId===algo.id?'Drop here':'—'}
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

# ─── ORDERS PAGE — Comfortable rows, no scroll, day P&L, weekend auto ─────────
cat > frontend/src/pages/OrdersPage.tsx << 'EOF'
import { useState } from 'react'

const ALL_DAYS = ['MON','TUE','WED','THU','FRI']

// Days with active weekend trades (would come from API)
const WEEKEND_ACTIVE: Record<string,number|null> = { SAT: 2840 }

// Fake day P&L (would come from API)
const DAY_PNL: Record<string,number> = { MON: 4320, TUE: -800, WED: 1200, THU: 3100 }

type LegStatus = 'open'|'closed'|'error'|'pending'

interface Leg {
  id:string; parentId?:string; journeyLevel:string; status:LegStatus
  symbol:string; dir:'BUY'|'SELL'; lots:string
  entryCondition:string; refPrice?:number
  fillPrice?:number; fillTime?:string; ltp?:number
  slOrig?:number; slActual?:number; target?:number
  exitPrice?:number; exitTime?:string; exitReason?:string; pnl?:number
}

interface AlgoGroup { algoName:string; account:string; mtm:number; mtmSL:number; mtmTP:number; legs:Leg[] }

const SAMPLE_ORDERS: AlgoGroup[] = [
  {
    algoName:'AWS-1', account:'Karthik', mtm:4320, mtmSL:-5000, mtmTP:10000,
    legs:[
      {id:'L1',  journeyLevel:'1',   status:'open',   symbol:'NIFTY 22500CE 27MAR25',   dir:'BUY',  lots:'1 (50)', entryCondition:'ORB High', refPrice:186.5, fillPrice:187.0, fillTime:'09:17:32', ltp:213.5, slOrig:150, slActual:175, target:280,  pnl:1325  },
      {id:'L1a', parentId:'L1', journeyLevel:'1.1', status:'closed', symbol:'NIFTY 22500CE 27MAR25', dir:'BUY', lots:'1 (50)', entryCondition:'Re-entry', refPrice:187.0, fillPrice:188.0, fillTime:'10:05:11', slOrig:155, target:280, exitPrice:120, exitTime:'10:15:22', exitReason:'SL', pnl:-3400},
      {id:'L2',  journeyLevel:'2',   status:'open',   symbol:'NIFTY 22500PE 27MAR25',   dir:'BUY',  lots:'1 (50)', entryCondition:'ORB Low',  refPrice:143.0, fillPrice:142.5, fillTime:'09:17:32', ltp:118.2, slOrig:110, slActual:110, target:200,  pnl:-1215 },
      {id:'L3',  journeyLevel:'3',   status:'error',  symbol:'NIFTY 22400CE 27MAR25',   dir:'BUY',  lots:'1 (50)', entryCondition:'Direct',   pnl:0 },
    ]
  },
  {
    algoName:'TF-BUY', account:'Mom', mtm:-800, mtmSL:-3000, mtmTP:6000,
    legs:[
      {id:'L4', journeyLevel:'1', status:'open', symbol:'BANKNIFTY 48000CE 26MAR25', dir:'BUY', lots:'2 (30)', entryCondition:'W&T Up 5%', refPrice:200.0, fillPrice:210.0, fillTime:'09:45:10', ltp:198.5, slOrig:180, slActual:185, target:280, pnl:-575},
    ]
  },
]

const STATUS_STYLE: Record<LegStatus,{color:string,bg:string}> = {
  open:   {color:'#22C55E',bg:'rgba(34,197,94,0.12)'},
  closed: {color:'#6B7280',bg:'rgba(107,114,128,0.12)'},
  error:  {color:'#EF4444',bg:'rgba(239,68,68,0.12)'},
  pending:{color:'#F59E0B',bg:'rgba(245,158,11,0.12)'},
}

// Column widths that fit without horizontal scroll on a 1280px screen
const COLS = ['40px','70px','180px','70px','120px','58px','58px','80px','60px','90px','66px','86px']
const HDRS = ['#','Status','Symbol','Lots','Entry / Ref','Fill','LTP','SL (A/O)','Target','Exit','Reason','P&L']

const ACTION_BTNS = [
  {label:'RUN',color:'#00B0F0',title:'Execute inactive algo'},
  {label:'RE', color:'#F59E0B',title:'Retry error — auto switches LIMIT↔MARKET'},
  {label:'SQ', color:'#22C55E',title:'Square off open positions only'},
  {label:'T',  color:'#EF4444',title:'Square off + cancel pending + terminate'},
]

function LegRow({leg,isChild}:{leg:Leg,isChild:boolean}) {
  const st=STATUS_STYLE[leg.status]
  return (
    <tr style={{background:isChild?'rgba(0,176,240,0.025)':undefined}}>
      <td style={{paddingLeft:isChild?'18px':'10px',width:COLS[0]}}>
        <span style={{fontSize:'11px',color:'var(--text-muted)',fontWeight:isChild?600:400}}>{leg.journeyLevel}</span>
      </td>
      <td style={{width:COLS[1]}}>
        <span className="tag" style={{color:st.color,background:st.bg,fontSize:'10px'}}>{leg.status.toUpperCase()}</span>
      </td>
      <td style={{width:COLS[2]}}>
        <div style={{fontSize:'11px',color:'var(--text)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{leg.symbol}</div>
        <div style={{fontSize:'10px',color:leg.dir==='BUY'?'var(--green)':'var(--red)',fontWeight:600}}>{leg.dir}</div>
      </td>
      <td style={{width:COLS[3],color:'var(--text-muted)',fontSize:'11px'}}>{leg.lots}</td>
      <td style={{width:COLS[4],fontSize:'11px'}}>
        <div style={{color:'var(--text-muted)'}}>{leg.entryCondition}</div>
        {leg.refPrice!=null&&<div style={{color:'var(--text-dim)',fontSize:'10px'}}>Ref: {leg.refPrice}</div>}
      </td>
      <td style={{width:COLS[5],fontWeight:600}}>{leg.fillPrice??'—'}</td>
      <td style={{width:COLS[6],fontWeight:600,
        color:leg.ltp!=null&&leg.fillPrice!=null?(leg.ltp>leg.fillPrice?'var(--green)':'var(--red)'):'var(--text-muted)'}}>
        {leg.ltp??'—'}
      </td>
      <td style={{width:COLS[7],fontSize:'11px'}}>
        {leg.slActual!=null&&<div style={{color:'var(--amber)'}}>A:{leg.slActual}</div>}
        {leg.slOrig!=null&&<div style={{color:'var(--text-muted)'}}>O:{leg.slOrig}</div>}
        {leg.slOrig==null&&'—'}
      </td>
      <td style={{width:COLS[8],color:'var(--text-muted)'}}>{leg.target??'—'}</td>
      <td style={{width:COLS[9],fontSize:'11px'}}>
        {leg.exitPrice!=null?(<><div style={{fontWeight:600}}>{leg.exitPrice}</div>{leg.exitTime&&<div style={{fontSize:'10px',color:'var(--text-dim)'}}>{leg.exitTime}</div>}</>):'—'}
      </td>
      <td style={{width:COLS[10]}}>
        {leg.exitReason?<span className="tag" style={{color:'var(--red)',background:'rgba(239,68,68,0.1)',fontSize:'10px'}}>{leg.exitReason}</span>:'—'}
      </td>
      <td style={{width:COLS[11],fontWeight:700,textAlign:'right',
        color:(leg.pnl||0)>=0?'var(--green)':'var(--red)'}}>
        {leg.pnl!=null?`${leg.pnl>=0?'+':''}₹${Math.abs(leg.pnl).toLocaleString('en-IN')}`:'—'}
      </td>
    </tr>
  )
}

export default function OrdersPage() {
  const [activeDay, setActiveDay] = useState('MON')
  const [showWeekends, setShowWeekends] = useState(false)

  const autoWeekendDays = Object.keys(WEEKEND_ACTIVE)
  const visibleDays = showWeekends
    ? [...ALL_DAYS,'SAT','SUN']
    : [...ALL_DAYS,...autoWeekendDays]

  const totalMTM = SAMPLE_ORDERS.reduce((s,g)=>s+g.mtm,0)

  const buildRows = (legs:Leg[]) => {
    const result:{leg:Leg,isChild:boolean}[]=[]
    for (const parent of legs.filter(l=>!l.parentId)) {
      result.push({leg:parent,isChild:false})
      for (const child of legs.filter(l=>l.parentId===parent.id))
        result.push({leg:child,isChild:true})
    }
    return result
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
            <input type="checkbox" checked={showWeekends} onChange={e=>setShowWeekends(e.target.checked)}
              style={{accentColor:'var(--accent-blue)'}}/>
            Show Weekends
          </label>
        </div>
      </div>

      {/* Day tabs with per-day P&L */}
      <div style={{display:'flex',gap:'2px',marginBottom:'18px',borderBottom:'1px solid var(--bg-border)'}}>
        {visibleDays.map(d=>{
          const isWeekend=d==='SAT'||d==='SUN'
          const pnl=isWeekend?WEEKEND_ACTIVE[d]:DAY_PNL[d]
          const isActive=activeDay===d
          return (
            <button key={d} onClick={()=>setActiveDay(d)} style={{
              display:'flex',flexDirection:'column',alignItems:'center',
              padding:'6px 14px 8px',fontSize:'12px',fontWeight:600,
              border:'none',cursor:'pointer',borderRadius:'5px 5px 0 0',
              background:isActive?'var(--bg-surface)':'transparent',
              color:isActive?'var(--accent-blue)':isWeekend?'var(--text-dim)':'var(--text-muted)',
              borderBottom:isActive?'2px solid var(--accent-blue)':'2px solid transparent',
              minWidth:'56px',
            }}>
              <span>{d}</span>
              {pnl!=null&&(
                <span style={{fontSize:'9px',fontWeight:700,marginTop:'1px',
                  color:pnl>=0?'var(--green)':'var(--red)'}}>
                  {pnl>=0?'+':''}{(pnl/1000).toFixed(1)}k
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Algo groups */}
      {SAMPLE_ORDERS.map((group,gi)=>(
        <div key={gi} style={{marginBottom:'16px'}}>
          <div style={{background:'var(--bg-secondary)',border:'1px solid var(--bg-border)',
            borderRadius:'7px 7px 0 0',padding:'9px 14px',
            display:'flex',alignItems:'center',gap:'12px',flexWrap:'wrap'}}>
            <span style={{fontWeight:700,fontSize:'14px',color:'var(--accent-blue)'}}>{group.algoName}</span>
            <span style={{fontSize:'11px',color:'var(--text-muted)',background:'var(--bg-surface)',
              padding:'2px 8px',borderRadius:'4px'}}>{group.account}</span>
            <span style={{fontSize:'11px',color:'var(--text-dim)'}}>
              MTM SL: <span style={{color:'var(--red)'}}>₹{Math.abs(group.mtmSL).toLocaleString('en-IN')}</span>
              &nbsp;·&nbsp;
              MTM TP: <span style={{color:'var(--green)'}}>₹{group.mtmTP.toLocaleString('en-IN')}</span>
            </span>
            <div style={{marginLeft:'auto',display:'flex',gap:'6px',alignItems:'center'}}>
              {ACTION_BTNS.map(btn=>(
                <button key={btn.label} title={btn.title} className="btn-action"
                  style={{color:btn.color,border:`1.5px solid ${btn.color}`}}
                  onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background=`${btn.color}20`}}
                  onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background='transparent'}}>
                  {btn.label}
                </button>
              ))}
              <span style={{fontWeight:700,fontSize:'15px',marginLeft:'6px',
                color:group.mtm>=0?'var(--green)':'var(--red)'}}>
                {group.mtm>=0?'+':''}₹{group.mtm.toLocaleString('en-IN')}
              </span>
            </div>
          </div>
          <div style={{border:'1px solid var(--bg-border)',borderTop:'none',borderRadius:'0 0 7px 7px',overflow:'hidden'}}>
            <table className="staax-table">
              <colgroup>{COLS.map((w,i)=><col key={i} style={{width:w}}/>)}</colgroup>
              <thead><tr>{HDRS.map(h=><th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {buildRows(group.legs).map(({leg,isChild})=>(
                  <LegRow key={leg.id} leg={leg} isChild={isChild}/>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}
EOF

# ─── ALGO CONFIG — SAT/SUN days, section grouping, uniform heights, save wired
cat > frontend/src/pages/AlgoPage.tsx << 'EOF'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAlgos } from '@/context/AlgoContext'

const INST_CODES: Record<string,string> = {
  NF:'NIFTY',BN:'BANKNIFTY',SX:'SENSEX',MN:'MIDCAPNIFTY',FN:'FINNIFTY',
  GM:'GOLDM',SM:'SILVERM',CO:'CRUDEOIL',
}
const STRIKE_OPTIONS=[...Array.from({length:10},(_,i)=>`ITM${10-i}`),'ATM',...Array.from({length:10},(_,i)=>`OTM${i+1}`)]

type FeatureKey='wt'|'sl'|'re'|'tp'|'tsl'
const FEATURES:{key:FeatureKey,label:string,color:string}[]=[
  {key:'wt', label:'W&T', color:'#9CA3AF'},
  {key:'sl', label:'SL',  color:'#EF4444'},
  {key:'re', label:'RE',  color:'#F59E0B'},
  {key:'tp', label:'TP',  color:'#22C55E'},
  {key:'tsl',label:'TSL', color:'#00B0F0'},
]

interface LegVals {
  wt:{direction:string,value:string,unit:string}
  sl:{type:string,value:string}
  re:{mode:string,trigger:string,count:string}
  tp:{type:string,value:string}
  tsl:{x:string,y:string,unit:string}
}
interface Leg {
  id:string; no:number; instType:string; instCode:string
  direction:string; optType:string; strikeMode:string; strikeType:string
  premiumVal:string; lots:string; expiry:string
  active:Record<FeatureKey,boolean>; vals:LegVals
}

const defaultLeg=(n:number):Leg=>({
  id:`leg-${Date.now()}-${n}`,no:n,
  instType:'OP',instCode:'NF',direction:'BUY',optType:'CE',
  strikeMode:'leg',strikeType:'atm',premiumVal:'',lots:'1',expiry:'Current',
  active:{wt:false,sl:false,re:false,tp:false,tsl:false},
  vals:{
    wt:{direction:'up',value:'',unit:'pts'},
    sl:{type:'pts_instrument',value:''},
    re:{mode:'at_entry_price',trigger:'sl',count:'1'},
    tp:{type:'pts_instrument',value:''},
    tsl:{x:'',y:'',unit:'pts'},
  }
})

function FeatureValues({leg,onUpdate}:{leg:Leg,onUpdate:(id:string,u:Partial<Leg>)=>void}) {
  const active=FEATURES.filter(f=>leg.active[f.key])
  if (!active.length) return null
  const u=(key:FeatureKey,sub:string,val:string)=>
    onUpdate(leg.id,{vals:{...leg.vals,[key]:{...(leg.vals[key] as any),[sub]:val}}})
  const inp=(key:FeatureKey,sub:string,ph:string,w='60px')=>(
    <input value={(leg.vals[key] as any)[sub]||''} onChange={e=>u(key,sub,e.target.value)}
      placeholder={ph}
      style={{width:w,height:'26px',background:'var(--bg-primary)',border:`1px solid rgba(255,255,255,0.1)`,
        borderRadius:'3px',color:'var(--text)',fontSize:'11px',padding:'0 6px',fontFamily:'inherit'}}/>
  )
  const sel=(key:FeatureKey,sub:string,opts:[string,string][])=>(
    <select value={(leg.vals[key] as any)[sub]||''} onChange={e=>u(key,sub,e.target.value)}
      style={{height:'26px',background:'var(--bg-primary)',border:'1px solid rgba(255,255,255,0.1)',
        borderRadius:'3px',color:'var(--text)',fontSize:'11px',padding:'0 6px',fontFamily:'inherit',cursor:'pointer'}}>
      {opts.map(([v,l])=><option key={v} value={v}>{l}</option>)}
    </select>
  )
  return (
    <div style={{display:'flex',gap:'6px',flexWrap:'wrap',marginTop:'6px',
      paddingTop:'6px',borderTop:'1px solid rgba(255,255,255,0.06)'}}>
      {active.map(f=>{
        const color=f.color
        return (
          <div key={f.key} style={{display:'flex',alignItems:'center',gap:'4px',
            background:`${color}08`,border:`1px solid ${color}22`,borderRadius:'5px',padding:'4px 8px'}}>
            <span style={{fontSize:'10px',color,fontWeight:700,marginRight:'2px'}}>{f.label}:</span>
            {f.key==='wt'&&<>{sel('wt','direction',[['up','↑Up'],['down','↓Dn']])} {inp('wt','value','val')} {sel('wt','unit',[['pts','pts'],['pct','%']])}</>}
            {f.key==='sl'&&<>{sel('sl','type',[['pts_instrument','Pts(I)'],['pct_instrument','%(I)'],['pts_underlying','Pts(U)'],['pct_underlying','%(U)']])} {inp('sl','value','val')}</>}
            {f.key==='re'&&<>{sel('re','mode',[['at_entry_price','@Entry'],['immediate','Now'],['at_cost','@Cost']])} {sel('re','trigger',[['sl','SL'],['tp','TP'],['any','Any']])} {sel('re','count',[['1','1×'],['2','2×'],['3','3×'],['4','4×'],['5','5×']])}</>}
            {f.key==='tp'&&<>{sel('tp','type',[['pts_instrument','Pts(I)'],['pct_instrument','%(I)'],['pts_underlying','Pts(U)'],['pct_underlying','%(U)']])} {inp('tp','value','val')}</>}
            {f.key==='tsl'&&<>{inp('tsl','x','X')} <span style={{fontSize:'10px',color:'var(--text-dim)'}}>→</span> {inp('tsl','y','Y')} {sel('tsl','unit',[['pts','pts'],['pct','%']])}</>}
          </div>
        )
      })}
    </div>
  )
}

function LegRow({leg,index,total,onUpdate,onRemove,onMove}:{
  leg:Leg,index:number,total:number,
  onUpdate:(id:string,u:Partial<Leg>)=>void,
  onRemove:(id:string)=>void,
  onMove:(id:string,dir:'up'|'down')=>void,
}) {
  const u=(k:keyof Leg,v:any)=>onUpdate(leg.id,{[k]:v})
  const s={background:'var(--bg-primary)',border:'1px solid var(--bg-border)',
    borderRadius:'4px',color:'var(--text)',fontSize:'11px',padding:'0 8px',
    height:'28px',fontFamily:'inherit',cursor:'pointer'}
  return (
    <div style={{background:'var(--bg-secondary)',border:'1px solid var(--bg-border)',
      borderRadius:'7px',padding:'9px 12px',marginBottom:'6px'}}>
      <div style={{display:'flex',alignItems:'center',gap:'6px',flexWrap:'wrap'}}>
        {/* Reorder */}
        <div style={{display:'flex',flexDirection:'column',gap:'1px',flexShrink:0}}>
          <button onClick={()=>onMove(leg.id,'up')} disabled={index===0}
            style={{background:'none',border:'none',cursor:index===0?'not-allowed':'pointer',
              color:index===0?'var(--text-dim)':'var(--text-muted)',fontSize:'10px',lineHeight:1,padding:'1px 3px'}}>▲</button>
          <button onClick={()=>onMove(leg.id,'down')} disabled={index===total-1}
            style={{background:'none',border:'none',cursor:index===total-1?'not-allowed':'pointer',
              color:index===total-1?'var(--text-dim)':'var(--text-muted)',fontSize:'10px',lineHeight:1,padding:'1px 3px'}}>▼</button>
        </div>
        <span style={{fontSize:'11px',fontWeight:700,color:'var(--text-dim)',minWidth:'22px',textAlign:'center'}}>L{leg.no}</span>
        {/* OP/FU */}
        <button onClick={()=>u('instType',leg.instType==='OP'?'FU':'OP')} style={{
          height:'28px',padding:'0 10px',borderRadius:'4px',fontSize:'11px',fontWeight:700,
          background:leg.instType==='OP'?'rgba(0,176,240,0.15)':'rgba(215,123,18,0.15)',
          color:leg.instType==='OP'?'var(--accent-blue)':'var(--accent-amber)',
          border:`1px solid ${leg.instType==='OP'?'rgba(0,176,240,0.3)':'rgba(215,123,18,0.3)'}`,
          cursor:'pointer',flexShrink:0}}>
          {leg.instType}
        </button>
        {/* Instrument */}
        <select value={leg.instCode} onChange={e=>u('instCode',e.target.value)} style={s}>
          {Object.entries(INST_CODES).map(([c,n])=><option key={c} value={c} title={n}>{c}</option>)}
        </select>
        {/* Direction */}
        <button onClick={()=>u('direction',leg.direction==='BUY'?'SELL':'BUY')} style={{
          height:'28px',padding:'0 10px',borderRadius:'4px',fontSize:'11px',fontWeight:700,
          background:leg.direction==='BUY'?'rgba(34,197,94,0.15)':'rgba(239,68,68,0.15)',
          color:leg.direction==='BUY'?'var(--green)':'var(--red)',
          border:`1px solid ${leg.direction==='BUY'?'rgba(34,197,94,0.3)':'rgba(239,68,68,0.3)'}`,
          cursor:'pointer',flexShrink:0}}>
          {leg.direction}
        </button>
        {/* CE/PE */}
        {leg.instType==='OP'&&(
          <button onClick={()=>u('optType',leg.optType==='CE'?'PE':'CE')} style={{
            height:'28px',padding:'0 10px',borderRadius:'4px',fontSize:'11px',fontWeight:700,
            background:'rgba(255,255,255,0.06)',color:'var(--text-muted)',
            border:'1px solid var(--bg-border)',cursor:'pointer',flexShrink:0}}>
            {leg.optType}
          </button>
        )}
        {/* Expiry */}
        {leg.instType==='OP'&&(
          <select value={leg.expiry} onChange={e=>u('expiry',e.target.value)} style={s}>
            <option value="Current">Current</option>
            <option value="Forward">Forward</option>
            <option value="Monthly">Monthly</option>
          </select>
        )}
        {/* Strike mode */}
        {leg.instType==='OP'&&<>
          <select value={leg.strikeMode} onChange={e=>u('strikeMode',e.target.value)} style={s}>
            <option value="leg">Strike</option>
            <option value="premium">Premium</option>
            <option value="straddle">Straddle</option>
          </select>
          {leg.strikeMode==='leg'&&(
            <select value={leg.strikeType} onChange={e=>u('strikeType',e.target.value)} style={{...s,width:'72px'}}>
              {STRIKE_OPTIONS.map(st=><option key={st} value={st.toLowerCase()}>{st}</option>)}
            </select>
          )}
          {(leg.strikeMode==='premium'||leg.strikeMode==='straddle')&&(
            <input value={leg.premiumVal} onChange={e=>u('premiumVal',e.target.value)} placeholder="₹ premium"
              style={{...s,width:'84px'}}/>
          )}
        </>}
        {/* Lots */}
        <input value={leg.lots} onChange={e=>u('lots',e.target.value)} type="number" min={1}
          style={{...s,width:'46px',textAlign:'center'}}/>
        {/* Divider */}
        <span style={{color:'var(--bg-border)',fontSize:'16px',flexShrink:0}}>|</span>
        {/* Feature chips — same height as other buttons */}
        {FEATURES.map(f=>(
          <button key={f.key} onClick={()=>onUpdate(leg.id,{active:{...leg.active,[f.key]:!leg.active[f.key]}})}
            style={{height:'28px',padding:'0 12px',borderRadius:'14px',fontSize:'11px',fontWeight:600,
              cursor:'pointer',border:'none',transition:'all 0.12s',flexShrink:0,
              background:leg.active[f.key]?f.color:'var(--bg-surface)',
              color:leg.active[f.key]?'#000':'var(--text-dim)'}}>
            {f.label}
          </button>
        ))}
        {/* Remove */}
        <button onClick={()=>onRemove(leg.id)}
          style={{marginLeft:'auto',height:'28px',padding:'0 10px',
            background:'none',border:'1px solid rgba(239,68,68,0.25)',
            color:'var(--red)',borderRadius:'4px',fontSize:'11px',cursor:'pointer',flexShrink:0}}>✕</button>
      </div>
      <FeatureValues leg={leg} onUpdate={onUpdate}/>
    </div>
  )
}

// Sub-section label
function SubSection({title}:{title:string}) {
  return (
    <div style={{fontSize:'10px',fontWeight:700,color:'var(--text-dim)',textTransform:'uppercase',
      letterSpacing:'0.08em',marginBottom:'8px',marginTop:'14px',
      paddingBottom:'5px',borderBottom:'1px solid var(--bg-border)'}}>
      {title}
    </div>
  )
}

export default function AlgoPage() {
  const navigate  = useNavigate()
  const { addAlgo } = useAlgos()
  const [legs,setLegs]=useState<Leg[]>([defaultLeg(1)])
  const [algoName,setAlgoName]=useState('')
  const [stratMode,setStratMode]=useState('intraday')
  const [entryType,setEntryType]=useState('orb')
  // All 7 days incl SAT/SUN
  const [days,setDays]=useState({M:true,T:false,W:true,T2:true,F:true,SAT:false,SUN:false})
  const DAY_LABELS=[{k:'M',l:'M'},{k:'T',l:'T'},{k:'W',l:'W'},{k:'T2',l:'T'},{k:'F',l:'F'},{k:'SAT',l:'S'},{k:'SUN',l:'S'}]
  const [lotMult,setLotMult]=useState('1')
  const [entryTime,setEntryTime]=useState('09:16')
  const [orbEnd,setOrbEnd]=useState('11:16')
  const [exitTime,setExitTime]=useState('15:10')
  const [account,setAccount]=useState('Karthik (Zerodha)')
  const [mtmSL,setMtmSL]=useState('')
  const [mtmTP,setMtmTP]=useState('')
  const [mtmUnit,setMtmUnit]=useState('amt')
  const [entryDelay,setEntryDelay]=useState('0')
  const [exitDelay,setExitDelay]=useState('0')
  const [orderType,setOrderType]=useState('MARKET')
  const [errorMargin,setErrorMargin]=useState(true)
  const [errorEntry,setErrorEntry]=useState(true)
  const [saved,setSaved]=useState(false)
  const [saveError,setSaveError]=useState('')

  const addLeg=()=>setLegs(l=>[...l,defaultLeg(l.length+1)])
  const removeLeg=(id:string)=>setLegs(l=>l.filter(x=>x.id!==id).map((x,i)=>({...x,no:i+1})))
  const updateLeg=(id:string,u:Partial<Leg>)=>setLegs(l=>l.map(x=>x.id===id?{...x,...u}:x))
  const moveLeg=(id:string,dir:'up'|'down')=>setLegs(l=>{
    const i=l.findIndex(x=>x.id===id)
    if ((dir==='up'&&i===0)||(dir==='down'&&i===l.length-1)) return l
    const a=[...l], ni=dir==='up'?i-1:i+1
    ;[a[i],a[ni]]=[a[ni],a[i]]
    return a.map((x,idx)=>({...x,no:idx+1}))
  })

  const handleSave=()=>{
    if (!algoName.trim()){setSaveError('Algo name required');return}
    setSaveError('')
    const newAlgo = {
      id: `algo-${Date.now()}`,
      name: algoName,
      account: account.split(' ')[0],
      stratMode, entryType, entryTime, exitTime,
      days,
      legs: legs.map(l=>({
        instCode: l.instCode,
        dir: l.direction==='BUY'?'B' as const:'S' as const,
      }))
    }
    addAlgo(newAlgo)
    setSaved(true)
    setTimeout(()=>{setSaved(false);navigate('/grid')},1200)
  }

  const inpStyle={fontSize:'12px'}
  const inp=(val:string,set:(v:string)=>void,extra:any={})=>(
    <input value={val} onChange={e=>set(e.target.value)} className="staax-input" style={{...inpStyle,...extra}}/>
  )
  const sel=(val:string,set:(v:string)=>void,opts:[string,string][],extra:any={})=>(
    <select value={val} onChange={e=>set(e.target.value)} className="staax-select" style={{...inpStyle,...extra}}>
      {opts.map(([v,l])=><option key={v} value={v}>{l}</option>)}
    </select>
  )

  return (
    <div style={{maxWidth:'980px'}}>
      {/* Header */}
      <div className="page-header">
        <h1 style={{fontFamily:"'ADLaM Display',serif",fontSize:'22px',fontWeight:400}}>
          {algoName||'New Algo'}
        </h1>
        <div className="page-header-actions">
          {saved&&<span style={{fontSize:'12px',color:'var(--green)',fontWeight:600}}>✅ Saved!</span>}
          {saveError&&<span style={{fontSize:'12px',color:'var(--red)'}}>{saveError}</span>}
          <button className="btn btn-ghost" onClick={()=>navigate('/grid')}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave}>Save Algo</button>
        </div>
      </div>

      {/* ── ALGO-LEVEL CARD ─────────────────────────────────── */}
      <div style={{background:'var(--bg-surface)',border:'1px solid var(--bg-border)',
        borderRadius:'8px',padding:'14px 16px',marginBottom:'14px'}}>

        <SubSection title="Identity — Algo Level"/>
        <div style={{display:'flex',alignItems:'flex-end',gap:'10px',flexWrap:'wrap',marginBottom:'0'}}>
          <div style={{display:'flex',flexDirection:'column',gap:'4px',flex:'1 1 160px',maxWidth:'190px'}}>
            <label style={{fontSize:'10px',color:'var(--text-dim)',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.05em'}}>Algo Name</label>
            <input className="staax-input" placeholder="e.g. AWS-1" value={algoName}
              onChange={e=>setAlgoName(e.target.value)} style={inpStyle}/>
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:'4px',width:'70px'}}>
            <label style={{fontSize:'10px',color:'var(--text-dim)',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.05em'}}>Lot Mult.</label>
            {inp(lotMult,setLotMult,{width:'70px',type:'number',min:1})}
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:'4px'}}>
            <label style={{fontSize:'10px',color:'var(--text-dim)',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.05em'}}>Strategy</label>
            {sel(stratMode,setStratMode,[['intraday','Intraday'],['btst','BTST'],['stbt','STBT'],['positional','Positional']],{width:'120px'})}
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:'4px'}}>
            <label style={{fontSize:'10px',color:'var(--text-dim)',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.05em'}}>Order Type</label>
            {sel(orderType,setOrderType,[['MARKET','MARKET'],['LIMIT','LIMIT']],{width:'100px'})}
          </div>
          {/* Days — all 7 with uniform circular buttons */}
          <div style={{display:'flex',flexDirection:'column',gap:'4px'}}>
            <label style={{fontSize:'10px',color:'var(--text-dim)',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.05em'}}>Days</label>
            <div style={{display:'flex',gap:'4px'}}>
              {DAY_LABELS.map((d,i)=>{
                const key=d.k as keyof typeof days
                const isWeekend=d.k==='SAT'||d.k==='SUN'
                return (
                  <button key={`${d.k}-${i}`}
                    onClick={()=>setDays(ds=>({...ds,[key]:!ds[key]}))}
                    style={{width:'28px',height:'28px',borderRadius:'50%',fontSize:'10px',fontWeight:700,
                      cursor:'pointer',border:'none',transition:'all 0.12s',
                      background:days[key]?isWeekend?'var(--accent-amber)':'var(--accent-blue)':'var(--bg-secondary)',
                      color:days[key]?'#000':'var(--text-dim)',
                      opacity:isWeekend&&!days[key]?0.6:1}}>
                    {d.l}
                  </button>
                )
              })}
            </div>
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:'4px',marginLeft:'auto'}}>
            <label style={{fontSize:'10px',color:'var(--text-dim)',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.05em'}}>Account</label>
            {sel(account,setAccount,[['Karthik (Zerodha)','Karthik'],['Mom (Angel One)','Mom']],{width:'140px'})}
          </div>
        </div>

        <SubSection title="Entry Type & Timing — Algo Level"/>
        <div style={{display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap'}}>
          {/* Uniform chip height matching other buttons */}
          {[['direct','Direct'],['orb','ORB'],['wt','W&T'],['orb_wt','ORB+W&T']].map(([v,l])=>(
            <button key={v} onClick={()=>setEntryType(v)} className={`chip ${entryType===v?'chip-active':'chip-inactive'}`}>
              {l}
            </button>
          ))}
          <div style={{display:'flex',gap:'8px',flexWrap:'wrap',marginLeft:'8px'}}>
            <div style={{display:'flex',flexDirection:'column',gap:'3px'}}>
              <label style={{fontSize:'10px',color:'var(--text-dim)',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.05em'}}>Entry Time</label>
              <input type="time" value={entryTime} onChange={e=>setEntryTime(e.target.value)}
                className="staax-input" style={{width:'105px',...inpStyle}}/>
            </div>
            {(entryType==='orb'||entryType==='orb_wt')&&(
              <div style={{display:'flex',flexDirection:'column',gap:'3px'}}>
                <label style={{fontSize:'10px',color:'var(--text-dim)',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.05em'}}>ORB End</label>
                <input type="time" value={orbEnd} onChange={e=>setOrbEnd(e.target.value)}
                  className="staax-input" style={{width:'105px',...inpStyle}}/>
              </div>
            )}
            {/* Exit time — shown for ALL strategy modes */}
            <div style={{display:'flex',flexDirection:'column',gap:'3px'}}>
              <label style={{fontSize:'10px',color:'var(--text-dim)',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.05em'}}>Exit Time</label>
              <input type="time" value={exitTime} onChange={e=>setExitTime(e.target.value)}
                className="staax-input" style={{width:'105px',...inpStyle}}/>
            </div>
            {/* Note for STBT/BTST */}
            {(stratMode==='btst'||stratMode==='stbt')&&(
              <div style={{display:'flex',alignItems:'flex-end',paddingBottom:'4px'}}>
                <span style={{fontSize:'10px',color:'var(--accent-amber)',background:'rgba(215,123,18,0.1)',
                  padding:'5px 8px',borderRadius:'4px',border:'1px solid rgba(215,123,18,0.2)'}}>
                  ⚠ {stratMode==='btst'?'BTST':'STBT'} — Next day SL check auto-handled at open
                </span>
              </div>
            )}
          </div>
        </div>

        <SubSection title="MTM Controls — Algo Level"/>
        <div style={{display:'flex',alignItems:'center',gap:'10px',flexWrap:'wrap'}}>
          <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
            <span style={{fontSize:'11px',color:'var(--text-muted)',fontWeight:600,whiteSpace:'nowrap'}}>MTM SL:</span>
            <input value={mtmSL} onChange={e=>setMtmSL(e.target.value)} placeholder="None"
              className="staax-input" style={{width:'80px',...inpStyle}}/>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
            <span style={{fontSize:'11px',color:'var(--text-muted)',fontWeight:600,whiteSpace:'nowrap'}}>MTM TP:</span>
            <input value={mtmTP} onChange={e=>setMtmTP(e.target.value)} placeholder="None"
              className="staax-input" style={{width:'80px',...inpStyle}}/>
          </div>
          {sel(mtmUnit,setMtmUnit,[['amt','₹ Amt'],['pct','% Prem']],{width:'90px'})}
        </div>
      </div>

      {/* ── LEGS ─────────────────────────────────────────────── */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'8px'}}>
        <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
          <span style={{fontSize:'11px',fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.08em'}}>Legs</span>
          <span style={{fontSize:'9px',padding:'2px 7px',borderRadius:'3px',
            background:'rgba(34,197,94,0.1)',color:'var(--green)',fontWeight:700}}>
            PER LEG — SL · TP · TSL · W&T · RE
          </span>
          <span style={{fontSize:'11px',color:'var(--text-dim)'}}>{legs.length} leg{legs.length>1?'s':''}</span>
        </div>
        <button className="btn btn-ghost" style={{fontSize:'11px'}} onClick={addLeg}>+ Add Leg</button>
      </div>
      {legs.map((leg,i)=>(
        <LegRow key={leg.id} leg={leg} index={i} total={legs.length}
          onUpdate={updateLeg} onRemove={removeLeg} onMove={moveLeg}/>
      ))}

      {/* ── ORDER DELAYS & ERROR SETTINGS — grouped below legs ── */}
      <div style={{background:'var(--bg-surface)',border:'1px solid var(--bg-border)',
        borderRadius:'8px',padding:'14px 16px',marginTop:'12px'}}>
        <SubSection title="Order Delays & Error Settings — Algo Level"/>
        <div style={{display:'flex',alignItems:'center',gap:'16px',flexWrap:'wrap'}}>
          <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
            <span style={{fontSize:'11px',color:'var(--text-muted)',fontWeight:600,whiteSpace:'nowrap'}}>Entry Delay:</span>
            <input value={entryDelay} onChange={e=>setEntryDelay(e.target.value)} type="number" min={0} max={60}
              className="staax-input" style={{width:'60px',...inpStyle}}/>
            <span style={{fontSize:'10px',color:'var(--text-dim)'}}>s (max 60)</span>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
            <span style={{fontSize:'11px',color:'var(--text-muted)',fontWeight:600,whiteSpace:'nowrap'}}>Exit Delay:</span>
            <input value={exitDelay} onChange={e=>setExitDelay(e.target.value)} type="number" min={0} max={60}
              className="staax-input" style={{width:'60px',...inpStyle}}/>
            <span style={{fontSize:'10px',color:'var(--text-dim)'}}>s (max 60)</span>
          </div>
          <span style={{color:'var(--bg-border)'}}>|</span>
          <label style={{display:'flex',alignItems:'center',gap:'6px',cursor:'pointer',fontSize:'11px',color:'var(--red)'}}>
            <input type="checkbox" checked={errorMargin} onChange={e=>setErrorMargin(e.target.checked)}
              style={{accentColor:'var(--red)'}}/>
            On margin error, exit all
          </label>
          <label style={{display:'flex',alignItems:'center',gap:'6px',cursor:'pointer',fontSize:'11px',color:'var(--red)'}}>
            <input type="checkbox" checked={errorEntry} onChange={e=>setErrorEntry(e.target.checked)}
              style={{accentColor:'var(--red)'}}/>
            If entry fails, exit all
          </label>
        </div>
      </div>
    </div>
  )
}
EOF

echo ""
echo "✅ Phase 1C v5 applied!"
echo ""
echo "Changes:"
echo "  Global     — Standardised --btn-h:32px across ALL buttons (btn, chip, action)"
echo "  Global     — page-header class ensures consistent top-row height/alignment"
echo "  Smart Grid — Uses AlgoContext, saved algos appear immediately after save"
echo "  Smart Grid — E:/X: in cells (no more N:), BT/ST overnight indicators"
echo "  Orders     — Comfortable row padding restored, columns fit without scroll"
echo "  Orders     — Day tabs show P&L below day name for days with trades"
echo "  Orders     — Active day gets indicator, not just SAT"
echo "  Algo Config — SAT + SUN in day selector (amber when selected)"
echo "  Algo Config — Entry/Exit Delays + Errors moved below legs in own card"
echo "  Algo Config — Direct/ORB/W&T chips use .chip class = same height as buttons"
echo "  Algo Config — Exit Time shown for ALL strategy modes"
echo "  Algo Config — BTST/STBT shows amber note: next day SL auto-handled"
echo "  Algo Config — Save wired to context, redirects to grid, algo appears"
echo ""
echo "Commit:"
echo "  git add . && git commit -m 'Phase 1C v5: Button standardization, Orders row height, Algo save to grid, SAT/SUN days, STBT fix' && git push origin feature/ui-phase1c"
