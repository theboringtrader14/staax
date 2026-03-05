#!/bin/bash
# STAAX Phase 1C v6
# Run from: cd ~/STAXX/staax && bash setup_phase1c_v6.sh

echo "🚀 Applying Phase 1C v6..."

# ─── SIDEBAR — Proper icon + text alignment ───────────────────────────────────
cat > frontend/src/components/layout/Sidebar.tsx << 'EOF'
import { NavLink } from 'react-router-dom'

const nav = [
  { path:'/dashboard',   label:'Dashboard',          icon:'○'  },
  { path:'/grid',        label:'Smart Grid',          icon:'⊞'  },
  { path:'/orders',      label:'Orders',              icon:'≡'  },
  { path:'/reports',     label:'Reports',             icon:'◈'  },
  { path:'/accounts',    label:'Accounts',            icon:'◉'  },
  { path:'/indicators',  label:'Indicator Systems',   icon:'◧'  },
]

export default function Sidebar() {
  return (
    <nav style={{
      width:'210px', minWidth:'210px',
      background:'var(--bg-secondary)',
      borderRight:'1px solid var(--bg-border)',
      display:'flex', flexDirection:'column',
    }}>
      {/* Logo */}
      <div style={{ padding:'18px 20px 20px', borderBottom:'1px solid var(--bg-border)' }}>
        <div style={{ fontFamily:"'ADLaM Display', serif", fontSize:'24px', color:'var(--accent-blue)', letterSpacing:'0.05em' }}>STAAX</div>
        <div style={{ fontSize:'10px', color:'var(--text-dim)', marginTop:'2px', letterSpacing:'0.12em' }}>ALGO TRADING</div>
      </div>

      {/* Nav items — icon and text perfectly aligned */}
      <div style={{ flex:1, paddingTop:'6px' }}>
        {nav.map(item => (
          <NavLink key={item.path} to={item.path} style={({ isActive }) => ({
            display:'grid',
            gridTemplateColumns:'40px 1fr',   // fixed icon column, text starts at same indent
            alignItems:'center',
            padding:'10px 0',
            textDecoration:'none',
            color: isActive ? 'var(--accent-blue)' : 'var(--text-muted)',
            background: isActive ? 'rgba(0,176,240,0.08)' : 'transparent',
            borderLeft: isActive ? '2px solid var(--accent-blue)' : '2px solid transparent',
            fontSize:'12px',
            transition:'all 0.12s',
            fontWeight: isActive ? '600' : '400',
          })}>
            <span style={{ textAlign:'center', fontSize:'16px', lineHeight:1 }}>{item.icon}</span>
            <span style={{ paddingRight:'16px' }}>{item.label}</span>
          </NavLink>
        ))}
      </div>

      {/* Version */}
      <div style={{ padding:'14px 20px', borderTop:'1px solid var(--bg-border)' }}>
        <div style={{ fontSize:'10px', color:'var(--text-dim)', letterSpacing:'0.05em' }}>v0.1.0 · Phase 1C</div>
      </div>
    </nav>
  )
}
EOF

# ─── APP.TSX — Add Indicator Systems route ────────────────────────────────────
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
import IndicatorsPage from '@/pages/IndicatorsPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard"  element={<DashboardPage />} />
          <Route path="grid"       element={<GridPage />} />
          <Route path="orders"     element={<OrdersPage />} />
          <Route path="algo/new"   element={<AlgoPage />} />
          <Route path="algo/:id"   element={<AlgoPage />} />
          <Route path="reports"    element={<ReportsPage />} />
          <Route path="accounts"   element={<AccountsPage />} />
          <Route path="indicators" element={<IndicatorsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
EOF

# ─── SMART GRID — Show P&L in cells, tighter cards ───────────────────────────
cat > frontend/src/pages/GridPage.tsx << 'EOF'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAlgos } from '@/context/AlgoContext'

const DAYS     = ['MON','TUE','WED','THU','FRI']
const WEEKENDS = ['SAT','SUN']

type CellStatus = 'no_trade'|'algo_active'|'order_pending'|'open'|'algo_closed'|'error'

interface GridCell {
  multiplier:number; status:CellStatus; practix:boolean
  entry:string; exit?:string; pnl?:number
}

const STATUS_CFG: Record<CellStatus,{label:string,color:string,bg:string,pct:number}> = {
  no_trade:      {label:'No Trade', color:'#6B7280', bg:'rgba(107,114,128,0.12)', pct:0  },
  algo_active:   {label:'Active',   color:'#00B0F0', bg:'rgba(0,176,240,0.12)',   pct:30 },
  order_pending: {label:'Pending',  color:'#F59E0B', bg:'rgba(245,158,11,0.12)',  pct:50 },
  open:          {label:'Open',     color:'#22C55E', bg:'rgba(34,197,94,0.12)',   pct:75 },
  algo_closed:   {label:'Closed',   color:'#16a34a', bg:'rgba(22,163,74,0.12)',   pct:100},
  error:         {label:'Error',    color:'#EF4444', bg:'rgba(239,68,68,0.12)',   pct:60 },
}

const INIT_GRID: Record<string,Record<string,GridCell>> = {
  '1': {
    MON:{multiplier:1,status:'open',        practix:true, entry:'09:16',exit:'15:10',pnl:1325 },
    TUE:{multiplier:1,status:'algo_closed', practix:false,entry:'09:16',exit:'15:10',pnl:-840 },
    WED:{multiplier:2,status:'algo_active', practix:true, entry:'09:16',exit:'15:10' },
    FRI:{multiplier:1,status:'no_trade',    practix:true, entry:'09:16',exit:'15:10' },
  },
  '2': {
    MON:{multiplier:2,status:'algo_active',  practix:true,entry:'09:30',exit:'15:10' },
    WED:{multiplier:1,status:'order_pending',practix:true,entry:'09:30',exit:'15:10' },
    THU:{multiplier:2,status:'open',         practix:true,entry:'09:30',exit:'15:10',pnl:-575},
  },
  '3': {
    MON:{multiplier:1,status:'no_trade',practix:true,entry:'09:20',exit:'15:10'},
    THU:{multiplier:1,status:'open',    practix:true,entry:'09:20',exit:'15:10',pnl:2100},
  },
  '4': {
    TUE:{multiplier:3,status:'error',   practix:true,entry:'09:30',exit:'15:10'},
    FRI:{multiplier:1,status:'no_trade',practix:true,entry:'09:30',exit:'15:10'},
  },
}

function CyclePie({ status }: { status: CellStatus }) {
  const cfg=STATUS_CFG[status], r=12,cx=14,cy=14,circ=2*Math.PI*r
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

export default function GridPage() {
  const navigate=useNavigate()
  const {algos}=useAlgos()
  const [grid,setGrid]=useState(INIT_GRID)
  const [showWeekends,setShowWeekends]=useState(false)
  const [editing,setEditing]=useState<{algoId:string,day:string}|null>(null)
  const [editVal,setEditVal]=useState('')
  const [dragAlgoId,setDragAlgoId]=useState<string|null>(null)

  const visibleDays=showWeekends?[...DAYS,...WEEKENDS]:DAYS

  const removeCell=(algoId:string,day:string)=>
    setGrid(g=>{const u={...g[algoId]};delete u[day];return{...g,[algoId]:u}})

  const handleDrop=(algoId:string,day:string)=>{
    if(!dragAlgoId||dragAlgoId!==algoId||grid[algoId]?.[day])return
    const algo=algos.find(a=>a.id===algoId)
    setGrid(g=>({...g,[algoId]:{...g[algoId],[day]:{multiplier:1,status:'algo_active',practix:true,entry:algo?.entryTime||'09:16',exit:algo?.exitTime||'15:10'}}}))
    setDragAlgoId(null)
  }

  const updateMult=(algoId:string,day:string,val:number)=>{
    if(val<1)return
    setGrid(g=>({...g,[algoId]:{...g[algoId],[day]:{...g[algoId][day],multiplier:val}}}))
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
            {algos.map(algo=>(
              <tr key={algo.id}>
                {/* Algo name cell */}
                <td draggable onDragStart={()=>setDragAlgoId(algo.id)} onDragEnd={()=>setDragAlgoId(null)}
                  style={{padding:'8px 10px',background:'var(--bg-secondary)',
                    border:'1px solid var(--bg-border)',cursor:'grab',userSelect:'none'}}>
                  <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                    <CyclePie status={
                      Object.values(grid[algo.id]||{}).find(c=>c.status==='open'||c.status==='algo_active')?.status||'no_trade'
                    }/>
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

                {/* Day cells */}
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
                          {/* Delete */}
                          <button onClick={()=>removeCell(algo.id,day)}
                            style={{position:'absolute',top:'2px',right:'2px',background:'none',border:'none',
                              cursor:'pointer',color:'var(--text-dim)',fontSize:'10px',padding:'2px 3px',lineHeight:1}}
                            onMouseEnter={e=>(e.currentTarget.style.color='var(--red)')}
                            onMouseLeave={e=>(e.currentTarget.style.color='var(--text-dim)')}>✕</button>

                          {/* Status badge */}
                          <span style={{fontSize:'9px',fontWeight:700,letterSpacing:'0.04em',
                            color:s.color,background:s.bg,padding:'1px 5px',borderRadius:'3px',
                            display:'inline-block',marginBottom:'4px'}}>
                            {s.label.toUpperCase()}
                          </span>

                          {/* Two-column info layout */}
                          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1px 6px',fontSize:'10px'}}>
                            <span style={{color:'var(--text-dim)'}}>M:
                              {editing?.algoId===algo.id&&editing?.day===day?(
                                <input autoFocus type="number" min={1} value={editVal}
                                  onChange={e=>setEditVal(e.target.value)}
                                  onBlur={()=>{updateMult(algo.id,day,parseInt(editVal)||1);setEditing(null)}}
                                  onKeyDown={e=>e.key==='Enter'&&(updateMult(algo.id,day,parseInt(editVal)||1),setEditing(null))}
                                  style={{width:'30px',marginLeft:'3px',background:'var(--bg-primary)',
                                    border:'1px solid var(--accent-blue)',borderRadius:'2px',
                                    color:'var(--text)',fontSize:'10px',padding:'0 3px',fontFamily:'inherit'}}/>
                              ):(
                                <span onClick={()=>{setEditing({algoId:algo.id,day});setEditVal(String(cell.multiplier))}}
                                  style={{marginLeft:'2px',color:'var(--accent-blue)',fontWeight:700,
                                    cursor:'text',borderBottom:'1px dashed transparent'}}
                                  onMouseEnter={e=>(e.currentTarget.style.borderBottomColor='var(--accent-blue)')}
                                  onMouseLeave={e=>(e.currentTarget.style.borderBottomColor='transparent')}>
                                  {cell.multiplier}
                                </span>
                              )}
                            </span>
                            {/* P&L — only if exists */}
                            {cell.pnl!=null&&(
                              <span style={{fontWeight:700,color:cell.pnl>=0?'var(--green)':'var(--red)',textAlign:'right'}}>
                                {cell.pnl>=0?'+':''}{(cell.pnl/1000).toFixed(1)}k
                              </span>
                            )}
                            <span style={{color:'var(--text-dim)'}}>E: {cell.entry}</span>
                            {cell.exit&&<span style={{color:'var(--text-dim)',textAlign:'right'}}>X: {cell.exit}</span>}
                          </div>

                          {/* Footer badges */}
                          <div style={{display:'flex',gap:'4px',marginTop:'4px',flexWrap:'wrap'}}>
                            {cell.practix&&(
                              <span style={{fontSize:'8px',fontWeight:700,letterSpacing:'0.05em',
                                color:'var(--accent-amber)',background:'rgba(215,123,18,0.1)',
                                padding:'1px 4px',borderRadius:'2px'}}>PRACTIX</span>
                            )}
                            {(algo.stratMode==='btst'||algo.stratMode==='stbt')&&cell.status==='open'&&(
                              <span style={{fontSize:'8px',fontWeight:700,
                                color:'var(--accent-amber)',background:'rgba(215,123,18,0.1)',
                                padding:'1px 4px',borderRadius:'2px'}}>
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
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
EOF

# ─── ORDERS — Restore action button height, inline day P&L ───────────────────
cat > frontend/src/pages/OrdersPage.tsx << 'EOF'
import { useState } from 'react'

const ALL_DAYS = ['MON','TUE','WED','THU','FRI']
const WEEKEND_ACTIVE: Record<string,number> = { SAT: 2840 }
const DAY_PNL: Record<string,number> = { MON:4320, TUE:-800, WED:1200, THU:3100, FRI:0 }

type LegStatus='open'|'closed'|'error'|'pending'

interface Leg {
  id:string; parentId?:string; journeyLevel:string; status:LegStatus
  symbol:string; dir:'BUY'|'SELL'; lots:string
  entryCondition:string; refPrice?:number
  fillPrice?:number; ltp?:number
  slOrig?:number; slActual?:number; target?:number
  exitPrice?:number; exitTime?:string; exitReason?:string; pnl?:number
}

interface AlgoGroup { algoName:string; account:string; mtm:number; mtmSL:number; mtmTP:number; legs:Leg[] }

const SAMPLE_ORDERS: AlgoGroup[] = [
  {
    algoName:'AWS-1', account:'Karthik', mtm:4320, mtmSL:-5000, mtmTP:10000,
    legs:[
      {id:'L1',  journeyLevel:'1',   status:'open',   symbol:'NIFTY 22500CE 27MAR25',   dir:'BUY', lots:'1 (50)', entryCondition:'ORB High', refPrice:186.5, fillPrice:187.0, ltp:213.5, slOrig:150, slActual:175, target:280, pnl:1325 },
      {id:'L1a', parentId:'L1', journeyLevel:'1.1', status:'closed', symbol:'NIFTY 22500CE 27MAR25', dir:'BUY', lots:'1 (50)', entryCondition:'Re-entry', refPrice:187.0, fillPrice:188.0, slOrig:155, target:280, exitPrice:120, exitTime:'10:15:22', exitReason:'SL', pnl:-3400},
      {id:'L2',  journeyLevel:'2',   status:'open',   symbol:'NIFTY 22500PE 27MAR25',   dir:'BUY', lots:'1 (50)', entryCondition:'ORB Low',  refPrice:143.0, fillPrice:142.5, ltp:118.2, slOrig:110, slActual:110, target:200, pnl:-1215},
      {id:'L3',  journeyLevel:'3',   status:'error',  symbol:'NIFTY 22400CE 27MAR25',   dir:'BUY', lots:'1 (50)', entryCondition:'Direct', pnl:0},
    ]
  },
  {
    algoName:'TF-BUY', account:'Mom', mtm:-800, mtmSL:-3000, mtmTP:6000,
    legs:[
      {id:'L4', journeyLevel:'1', status:'open', symbol:'BANKNIFTY 48000CE 26MAR25', dir:'BUY', lots:'2 (30)', entryCondition:'W&T Up 5%', refPrice:200.0, fillPrice:210.0, ltp:198.5, slOrig:180, slActual:185, target:280, pnl:-575},
    ]
  },
]

const STATUS_STYLE: Record<LegStatus,{color:string,bg:string}> = {
  open:   {color:'#22C55E',bg:'rgba(34,197,94,0.12)'},
  closed: {color:'#6B7280',bg:'rgba(107,114,128,0.12)'},
  error:  {color:'#EF4444',bg:'rgba(239,68,68,0.12)'},
  pending:{color:'#F59E0B',bg:'rgba(245,158,11,0.12)'},
}

const COLS=['36px','66px','176px','66px','116px','54px','54px','76px','58px','88px','62px','82px']
const HDRS=['#','Status','Symbol','Lots','Entry / Ref','Fill','LTP','SL (A/O)','Target','Exit','Reason','P&L']

// Action buttons — restored to compact 26px height (in-table size, not page-level)
const ACTION_BTNS=[
  {label:'RUN',color:'#00B0F0',title:'Execute inactive algo'},
  {label:'RE', color:'#F59E0B',title:'Retry — auto switches LIMIT↔MARKET'},
  {label:'SQ', color:'#22C55E',title:'Square off open positions only'},
  {label:'T',  color:'#EF4444',title:'Square off + cancel pending + terminate'},
]

function LegRow({leg,isChild}:{leg:Leg,isChild:boolean}) {
  const st=STATUS_STYLE[leg.status]
  return (
    <tr style={{background:isChild?'rgba(0,176,240,0.025)':undefined}}>
      <td style={{paddingLeft:isChild?'16px':'10px',width:COLS[0]}}>
        <span style={{fontSize:'11px',color:'var(--text-muted)',fontWeight:isChild?600:400}}>{leg.journeyLevel}</span>
      </td>
      <td style={{width:COLS[1]}}>
        <span className="tag" style={{color:st.color,background:st.bg,fontSize:'10px'}}>{leg.status.toUpperCase()}</span>
      </td>
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
  const [activeDay,setActiveDay]=useState('MON')
  const [showWeekends,setShowWeekends]=useState(false)

  const autoWeekends=Object.keys(WEEKEND_ACTIVE)
  const visibleDays=showWeekends?[...ALL_DAYS,'SAT','SUN']:[...ALL_DAYS,...autoWeekends]
  const totalMTM=SAMPLE_ORDERS.reduce((s,g)=>s+g.mtm,0)

  const buildRows=(legs:Leg[])=>{
    const result:{leg:Leg,isChild:boolean}[]=[]
    for (const p of legs.filter(l=>!l.parentId)){
      result.push({leg:p,isChild:false})
      for (const c of legs.filter(l=>l.parentId===p.id)) result.push({leg:c,isChild:true})
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

      {/* Day tabs — P&L inline beside day name */}
      <div style={{display:'flex',gap:'2px',marginBottom:'18px',borderBottom:'1px solid var(--bg-border)'}}>
        {visibleDays.map(d=>{
          const isWeekend=d==='SAT'||d==='SUN'
          const pnl=isWeekend?WEEKEND_ACTIVE[d]:DAY_PNL[d]
          const hasTrade=pnl!=null
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
              {hasTrade&&(
                <span style={{fontSize:'10px',fontWeight:700,
                  color:(pnl||0)>=0?'var(--green)':'var(--red)'}}>
                  {(pnl||0)>=0?'+':''}{((pnl||0)/1000).toFixed(1)}k
                </span>
              )}
            </button>
          )
        })}
      </div>

      {SAMPLE_ORDERS.map((group,gi)=>(
        <div key={gi} style={{marginBottom:'16px'}}>
          <div style={{background:'var(--bg-secondary)',border:'1px solid var(--bg-border)',
            borderRadius:'7px 7px 0 0',padding:'8px 12px',
            display:'flex',alignItems:'center',gap:'10px',flexWrap:'wrap'}}>
            <span style={{fontWeight:700,fontSize:'14px',color:'var(--accent-blue)'}}>{group.algoName}</span>
            <span style={{fontSize:'11px',color:'var(--text-muted)',background:'var(--bg-surface)',
              padding:'2px 7px',borderRadius:'4px'}}>{group.account}</span>
            <span style={{fontSize:'11px',color:'var(--text-dim)'}}>
              SL: <span style={{color:'var(--red)'}}>₹{Math.abs(group.mtmSL).toLocaleString('en-IN')}</span>
              &nbsp;·&nbsp;TP: <span style={{color:'var(--green)'}}>₹{group.mtmTP.toLocaleString('en-IN')}</span>
            </span>
            <div style={{marginLeft:'auto',display:'flex',gap:'5px',alignItems:'center'}}>
              {ACTION_BTNS.map(btn=>(
                <button key={btn.label} title={btn.title}
                  style={{
                    height:'26px',minWidth:'38px',padding:'0 10px',
                    fontSize:'11px',fontWeight:700,
                    border:`1.5px solid ${btn.color}`,background:'transparent',
                    color:btn.color,borderRadius:'4px',cursor:'pointer',transition:'all 0.12s',
                  }}
                  onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background=`${btn.color}18`}}
                  onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background='transparent'}}>
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

# ─── ALGO CONFIG — DTE, expiry fix, copy leg, MTM order, clock color, visual separator ──
cat > frontend/src/pages/AlgoPage.tsx << 'EOF'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAlgos } from '@/context/AlgoContext'

// NSE instruments only (MCX moved to Indicator Systems)
const INST_CODES: Record<string,string> = {
  NF:'NIFTY', BN:'BANKNIFTY', SX:'SENSEX', MN:'MIDCAPNIFTY', FN:'FINNIFTY',
}

const EXPIRY_OPTIONS=[
  {value:'current_weekly', label:'Current Weekly'},
  {value:'next_weekly',    label:'Next Weekly'},
  {value:'current_monthly',label:'Current Monthly'},
  {value:'next_monthly',   label:'Next Monthly'},
]

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
  strikeMode:'leg',strikeType:'atm',premiumVal:'',lots:'1',expiry:'current_weekly',
  active:{wt:false,sl:false,re:false,tp:false,tsl:false},
  vals:{
    wt:{direction:'up',value:'',unit:'pts'},
    sl:{type:'pts_instrument',value:''},
    re:{mode:'at_entry_price',trigger:'sl',count:'1'},
    tp:{type:'pts_instrument',value:''},
    tsl:{x:'',y:'',unit:'pts'},
  }
})

const copyLeg=(leg:Leg,newNo:number):Leg=>({
  ...leg,
  id:`leg-${Date.now()}-copy-${newNo}`,
  no:newNo,
  vals:{...leg.vals,
    wt:{...leg.vals.wt},sl:{...leg.vals.sl},
    re:{...leg.vals.re},tp:{...leg.vals.tp},tsl:{...leg.vals.tsl}
  },
  active:{...leg.active}
})

function FeatureValues({leg,onUpdate}:{leg:Leg,onUpdate:(id:string,u:Partial<Leg>)=>void}) {
  const active=FEATURES.filter(f=>leg.active[f.key])
  if (!active.length) return null
  const u=(key:FeatureKey,sub:string,val:string)=>
    onUpdate(leg.id,{vals:{...leg.vals,[key]:{...(leg.vals[key] as any),[sub]:val}}})
  const cs={height:'26px',background:'var(--bg-primary)',border:'1px solid rgba(255,255,255,0.1)',
    borderRadius:'3px',color:'var(--text)',fontSize:'11px',padding:'0 6px',fontFamily:'inherit'}
  const inp=(key:FeatureKey,sub:string,ph:string,w='56px')=>(
    <input value={(leg.vals[key] as any)[sub]||''} onChange={e=>u(key,sub,e.target.value)}
      placeholder={ph} style={{...cs,width:w}}/>
  )
  const sel=(key:FeatureKey,sub:string,opts:[string,string][])=>(
    <select value={(leg.vals[key] as any)[sub]||''} onChange={e=>u(key,sub,e.target.value)}
      style={{...cs,cursor:'pointer'}}>
      {opts.map(([v,l])=><option key={v} value={v}>{l}</option>)}
    </select>
  )
  return (
    <div style={{display:'flex',gap:'6px',flexWrap:'wrap',marginTop:'6px',
      paddingTop:'6px',borderTop:'1px solid rgba(255,255,255,0.06)'}}>
      {active.map(f=>(
        <div key={f.key} style={{display:'flex',alignItems:'center',gap:'4px',
          background:`${f.color}08`,border:`1px solid ${f.color}22`,borderRadius:'5px',padding:'4px 8px'}}>
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

function LegRow({leg,index,total,onUpdate,onRemove,onMove,onCopy}:{
  leg:Leg,index:number,total:number,
  onUpdate:(id:string,u:Partial<Leg>)=>void,
  onRemove:(id:string)=>void,
  onMove:(id:string,dir:'up'|'down')=>void,
  onCopy:(id:string)=>void,
}) {
  const u=(k:keyof Leg,v:any)=>onUpdate(leg.id,{[k]:v})
  const s={height:'28px',background:'var(--bg-primary)',border:'1px solid var(--bg-border)',
    borderRadius:'4px',color:'var(--text)',fontSize:'11px',padding:'0 8px',fontFamily:'inherit',cursor:'pointer'}
  return (
    <div style={{background:'var(--bg-secondary)',border:'1px solid var(--bg-border)',
      borderRadius:'7px',padding:'9px 10px',marginBottom:'6px'}}>
      <div style={{display:'flex',alignItems:'center',gap:'5px',flexWrap:'wrap'}}>
        {/* Reorder */}
        <div style={{display:'flex',flexDirection:'column',gap:'0px',flexShrink:0}}>
          <button onClick={()=>onMove(leg.id,'up')} disabled={index===0}
            style={{background:'none',border:'none',cursor:index===0?'not-allowed':'pointer',
              color:index===0?'var(--text-dim)':'var(--text-muted)',fontSize:'9px',lineHeight:1.2,padding:'1px 3px'}}>▲</button>
          <button onClick={()=>onMove(leg.id,'down')} disabled={index===total-1}
            style={{background:'none',border:'none',cursor:index===total-1?'not-allowed':'pointer',
              color:index===total-1?'var(--text-dim)':'var(--text-muted)',fontSize:'9px',lineHeight:1.2,padding:'1px 3px'}}>▼</button>
        </div>
        <span style={{fontSize:'11px',fontWeight:700,color:'var(--text-dim)',minWidth:'20px',textAlign:'center'}}>L{leg.no}</span>

        {/* OP/FU */}
        <button onClick={()=>u('instType',leg.instType==='OP'?'FU':'OP')} style={{
          height:'28px',padding:'0 9px',borderRadius:'4px',fontSize:'11px',fontWeight:700,
          background:leg.instType==='OP'?'rgba(0,176,240,0.15)':'rgba(215,123,18,0.15)',
          color:leg.instType==='OP'?'var(--accent-blue)':'var(--accent-amber)',
          border:`1px solid ${leg.instType==='OP'?'rgba(0,176,240,0.3)':'rgba(215,123,18,0.3)'}`,
          cursor:'pointer',flexShrink:0}}>{leg.instType}</button>

        <select value={leg.instCode} onChange={e=>u('instCode',e.target.value)} style={s}>
          {Object.entries(INST_CODES).map(([c,n])=><option key={c} value={c} title={n}>{c}</option>)}
        </select>

        <button onClick={()=>u('direction',leg.direction==='BUY'?'SELL':'BUY')} style={{
          height:'28px',padding:'0 9px',borderRadius:'4px',fontSize:'11px',fontWeight:700,
          background:leg.direction==='BUY'?'rgba(34,197,94,0.15)':'rgba(239,68,68,0.15)',
          color:leg.direction==='BUY'?'var(--green)':'var(--red)',
          border:`1px solid ${leg.direction==='BUY'?'rgba(34,197,94,0.3)':'rgba(239,68,68,0.3)'}`,
          cursor:'pointer',flexShrink:0}}>{leg.direction}</button>

        {leg.instType==='OP'&&(
          <button onClick={()=>u('optType',leg.optType==='CE'?'PE':'CE')} style={{
            height:'28px',padding:'0 9px',borderRadius:'4px',fontSize:'11px',fontWeight:700,
            background:'rgba(255,255,255,0.06)',color:'var(--text-muted)',
            border:'1px solid var(--bg-border)',cursor:'pointer',flexShrink:0}}>{leg.optType}</button>
        )}

        {leg.instType==='OP'&&<>
          <select value={leg.expiry} onChange={e=>u('expiry',e.target.value)} style={{...s,width:'130px'}}>
            {EXPIRY_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select value={leg.strikeMode} onChange={e=>u('strikeMode',e.target.value)} style={s}>
            <option value="leg">Strike</option>
            <option value="premium">Premium</option>
            <option value="straddle">Straddle</option>
          </select>
          {leg.strikeMode==='leg'&&(
            <select value={leg.strikeType} onChange={e=>u('strikeType',e.target.value)} style={{...s,width:'70px'}}>
              {STRIKE_OPTIONS.map(st=><option key={st} value={st.toLowerCase()}>{st}</option>)}
            </select>
          )}
          {(leg.strikeMode==='premium'||leg.strikeMode==='straddle')&&(
            <input value={leg.premiumVal} onChange={e=>u('premiumVal',e.target.value)} placeholder="₹ premium"
              style={{...s,width:'82px'}}/>
          )}
        </>}

        <input value={leg.lots} onChange={e=>u('lots',e.target.value)} type="number" min={1}
          style={{...s,width:'44px',textAlign:'center'}}/>

        <span style={{color:'var(--bg-border)',fontSize:'14px',flexShrink:0}}>|</span>

        {FEATURES.map(f=>(
          <button key={f.key} onClick={()=>onUpdate(leg.id,{active:{...leg.active,[f.key]:!leg.active[f.key]}})}
            style={{height:'28px',padding:'0 11px',borderRadius:'13px',fontSize:'11px',fontWeight:600,
              cursor:'pointer',border:'none',transition:'all 0.12s',flexShrink:0,
              background:leg.active[f.key]?f.color:'var(--bg-surface)',
              color:leg.active[f.key]?'#000':'var(--text-dim)'}}>
            {f.label}
          </button>
        ))}

        {/* Copy + Remove */}
        <div style={{marginLeft:'auto',display:'flex',gap:'4px',flexShrink:0}}>
          <button onClick={()=>onCopy(leg.id)} title="Copy this leg"
            style={{height:'28px',padding:'0 9px',background:'none',
              border:'1px solid rgba(0,176,240,0.25)',color:'var(--accent-blue)',
              borderRadius:'4px',fontSize:'11px',cursor:'pointer'}}>⧉</button>
          <button onClick={()=>onRemove(leg.id)} title="Remove leg"
            style={{height:'28px',padding:'0 9px',background:'none',
              border:'1px solid rgba(239,68,68,0.25)',color:'var(--red)',
              borderRadius:'4px',fontSize:'11px',cursor:'pointer'}}>✕</button>
        </div>
      </div>
      <FeatureValues leg={leg} onUpdate={onUpdate}/>
    </div>
  )
}

function Label({text}:{text:string}) {
  return <span style={{fontSize:'10px',color:'var(--text-dim)',fontWeight:700,
    textTransform:'uppercase',letterSpacing:'0.05em',whiteSpace:'nowrap'}}>{text}</span>
}

function SubSection({title}:{title:string}) {
  return <div style={{fontSize:'10px',fontWeight:700,color:'var(--text-dim)',textTransform:'uppercase',
    letterSpacing:'0.08em',marginBottom:'8px',marginTop:'2px',
    paddingBottom:'5px',borderBottom:'1px solid var(--bg-border)'}}>{title}</div>
}

// Clock icon color fix helper
const timeInputStyle={
  background:'var(--bg-secondary)',border:'1px solid var(--bg-border)',
  color:'var(--text)',borderRadius:'5px',padding:'0 10px',
  height:'32px',fontSize:'12px',fontFamily:'inherit',width:'106px',
  colorScheme:'dark',  // makes browser native time picker icons match dark theme
}

export default function AlgoPage() {
  const navigate=useNavigate()
  const {addAlgo}=useAlgos()
  const [legs,setLegs]=useState<Leg[]>([defaultLeg(1)])
  const [algoName,setAlgoName]=useState('')
  const [stratMode,setStratMode]=useState('intraday')
  const [entryType,setEntryType]=useState('orb')
  const [days,setDays]=useState({M:true,T:false,W:true,T2:true,F:true,SAT:false,SUN:false})
  const DAY_LABELS=[
    {k:'M',l:'M'},{k:'T',l:'T'},{k:'W',l:'W'},{k:'T2',l:'T'},{k:'F',l:'F'},
    {k:'SAT',l:'S'},{k:'SUN',l:'S'}
  ]
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

  const addLeg=()=>setLegs(l=>[...l,defaultLeg(l.length+1)])
  const removeLeg=(id:string)=>setLegs(l=>l.filter(x=>x.id!==id).map((x,i)=>({...x,no:i+1})))
  const updateLeg=(id:string,u:Partial<Leg>)=>setLegs(l=>l.map(x=>x.id===id?{...x,...u}:x))
  const copyLegFn=(id:string)=>setLegs(l=>{
    const idx=l.findIndex(x=>x.id===id)
    const copy=copyLeg(l[idx],l.length+1)
    const arr=[...l]
    arr.splice(idx+1,0,copy)
    return arr.map((x,i)=>({...x,no:i+1}))
  })
  const moveLeg=(id:string,dir:'up'|'down')=>setLegs(l=>{
    const i=l.findIndex(x=>x.id===id)
    if((dir==='up'&&i===0)||(dir==='down'&&i===l.length-1))return l
    const a=[...l],ni=dir==='up'?i-1:i+1
    ;[a[i],a[ni]]=[a[ni],a[i]]
    return a.map((x,j)=>({...x,no:j+1}))
  })

  const handleSave=()=>{
    if(!algoName.trim()){setSaveError('Algo name required');return}
    setSaveError('')
    addAlgo({
      id:`algo-${Date.now()}`,name:algoName,
      account:account.split(' ')[0],
      stratMode,entryType,entryTime,exitTime,days,
      legs:legs.map(l=>({instCode:l.instCode,dir:l.direction==='BUY'?'B' as const:'S' as const}))
    })
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

      {/* ── IDENTITY ─────────────────────────────────────────── */}
      <div style={{background:'var(--bg-surface)',border:'1px solid var(--bg-border)',
        borderRadius:'8px',padding:'14px 16px',marginBottom:'12px'}}>
        <SubSection title="Identity — Algo Level"/>

        {/* Row: Name | Lot Mult | Strategy | Order Type | [spacer] | Days + Account (right) */}
        <div style={{display:'flex',alignItems:'flex-end',gap:'10px',flexWrap:'wrap'}}>
          <div style={{display:'flex',flexDirection:'column',gap:'4px',flex:'1 1 150px',maxWidth:'180px'}}>
            <Label text="Algo Name"/>
            <input className="staax-input" placeholder="e.g. AWS-1" value={algoName}
              onChange={e=>setAlgoName(e.target.value)} style={{fontSize:'12px'}}/>
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:'4px',width:'66px'}}>
            <Label text="Lot Mult."/>
            <input className="staax-input" type="number" min={1} value={lotMult}
              onChange={e=>setLotMult(e.target.value)} style={{width:'66px',fontSize:'12px'}}/>
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:'4px'}}>
            <Label text="Strategy"/>
            <select className="staax-select" value={stratMode}
              onChange={e=>setStratMode(e.target.value)} style={{width:'118px',fontSize:'12px'}}>
              <option value="intraday">Intraday</option>
              <option value="btst">BTST</option>
              <option value="stbt">STBT</option>
              <option value="positional">Positional</option>
            </select>
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:'4px'}}>
            <Label text="Order Type"/>
            <select className="staax-select" value={orderType}
              onChange={e=>setOrderType(e.target.value)} style={{width:'100px',fontSize:'12px'}}>
              <option value="MARKET">MARKET</option>
              <option value="LIMIT">LIMIT</option>
            </select>
          </div>

          {/* Days + Account pushed to right */}
          <div style={{marginLeft:'auto',display:'flex',alignItems:'flex-end',gap:'12px'}}>
            <div style={{display:'flex',flexDirection:'column',gap:'4px'}}>
              <Label text="Days"/>
              <div style={{display:'flex',gap:'3px'}}>
                {DAY_LABELS.map((d,i)=>{
                  const key=d.k as keyof typeof days
                  const isWeekend=d.k==='SAT'||d.k==='SUN'
                  return (
                    <button key={`${d.k}-${i}`}
                      onClick={()=>setDays(ds=>({...ds,[key]:!ds[key]}))}
                      style={{width:'26px',height:'26px',borderRadius:'50%',fontSize:'10px',fontWeight:700,
                        cursor:'pointer',border:'none',transition:'all 0.12s',
                        background:days[key]?isWeekend?'var(--accent-amber)':'var(--accent-blue)':'var(--bg-secondary)',
                        color:days[key]?'#000':'var(--text-dim)',
                        opacity:isWeekend&&!days[key]?0.55:1}}>
                      {d.l}
                    </button>
                  )
                })}
              </div>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:'4px'}}>
              <Label text="Account"/>
              <select className="staax-select" value={account}
                onChange={e=>setAccount(e.target.value)} style={{width:'140px',fontSize:'12px'}}>
                <option value="Karthik (Zerodha)">Karthik</option>
                <option value="Mom (Angel One)">Mom</option>
              </select>
            </div>
          </div>
        </div>

        {/* Entry Type & Timing */}
        <div style={{marginTop:'14px',paddingTop:'12px',borderTop:'1px solid var(--bg-border)'}}>
          <SubSection title="Entry Type & Timing — Algo Level"/>
          <div style={{display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap'}}>
            {[['direct','Direct'],['orb','ORB'],['wt','W&T'],['orb_wt','ORB+W&T']].map(([v,l])=>(
              <button key={v} onClick={()=>setEntryType(v)}
                className={`chip ${entryType===v?'chip-active':'chip-inactive'}`}>{l}</button>
            ))}
            <div style={{display:'flex',gap:'8px',flexWrap:'wrap',marginLeft:'6px'}}>
              <div style={{display:'flex',flexDirection:'column',gap:'3px'}}>
                <Label text="Entry Time"/>
                <input type="time" value={entryTime} onChange={e=>setEntryTime(e.target.value)}
                  style={timeInputStyle}/>
              </div>
              {(entryType==='orb'||entryType==='orb_wt')&&(
                <div style={{display:'flex',flexDirection:'column',gap:'3px'}}>
                  <Label text="ORB End"/>
                  <input type="time" value={orbEnd} onChange={e=>setOrbEnd(e.target.value)}
                    style={timeInputStyle}/>
                </div>
              )}
              <div style={{display:'flex',flexDirection:'column',gap:'3px'}}>
                <Label text="Exit Time"/>
                <input type="time" value={exitTime} onChange={e=>setExitTime(e.target.value)}
                  style={timeInputStyle}/>
              </div>
              {/* DTE — only for Positional */}
              {stratMode==='positional'&&(
                <div style={{display:'flex',flexDirection:'column',gap:'3px'}}>
                  <Label text="DTE (days to expiry)"/>
                  <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
                    <select className="staax-select" value={dte} onChange={e=>setDte(e.target.value)}
                      style={{width:'80px',fontSize:'12px'}}>
                      {[0,1,2,3,4,5].map(n=><option key={n} value={n}>{n}</option>)}
                    </select>
                    <span style={{fontSize:'10px',color:'var(--text-dim)',maxWidth:'130px',lineHeight:1.3}}>
                      {dte==='0'?'Exit on expiry day':`Exit ${dte}d before expiry`}
                    </span>
                  </div>
                </div>
              )}
              {(stratMode==='btst'||stratMode==='stbt')&&(
                <div style={{display:'flex',alignItems:'flex-end',paddingBottom:'2px'}}>
                  <span style={{fontSize:'10px',color:'var(--accent-amber)',background:'rgba(215,123,18,0.1)',
                    padding:'5px 8px',borderRadius:'4px',border:'1px solid rgba(215,123,18,0.2)',lineHeight:1.4}}>
                    ⚠ Next day SL check auto-handled at open
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* MTM Controls — unit first, then SL + TP */}
        <div style={{marginTop:'14px',paddingTop:'12px',borderTop:'1px solid var(--bg-border)'}}>
          <SubSection title="MTM Controls — Algo Level"/>
          <div style={{display:'flex',alignItems:'center',gap:'10px',flexWrap:'wrap'}}>
            <select className="staax-select" value={mtmUnit} onChange={e=>setMtmUnit(e.target.value)}
              style={{width:'96px',fontSize:'12px'}}>
              <option value="amt">₹ Amount</option>
              <option value="pct">% Premium</option>
            </select>
            <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
              <span style={{fontSize:'11px',color:'var(--text-muted)',fontWeight:600}}>MTM SL:</span>
              <input value={mtmSL} onChange={e=>setMtmSL(e.target.value)} placeholder="None"
                className="staax-input" style={{width:'80px',fontSize:'12px'}}/>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
              <span style={{fontSize:'11px',color:'var(--text-muted)',fontWeight:600}}>MTM TP:</span>
              <input value={mtmTP} onChange={e=>setMtmTP(e.target.value)} placeholder="None"
                className="staax-input" style={{width:'80px',fontSize:'12px'}}/>
            </div>
          </div>
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
          onUpdate={updateLeg} onRemove={removeLeg} onMove={moveLeg} onCopy={copyLegFn}/>
      ))}

      {/* ── ORDER DELAYS + ERROR SETTINGS (one card, visual separator) ── */}
      <div style={{background:'var(--bg-surface)',border:'1px solid var(--bg-border)',
        borderRadius:'8px',padding:'14px 16px',marginTop:'12px'}}>
        <SubSection title="Order Delays — Algo Level"/>
        <div style={{display:'flex',alignItems:'center',gap:'16px',flexWrap:'wrap',marginBottom:'0'}}>
          <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
            <span style={{fontSize:'11px',color:'var(--text-muted)',fontWeight:600,whiteSpace:'nowrap'}}>Entry Delay:</span>
            <input value={entryDelay} onChange={e=>setEntryDelay(e.target.value)} type="number" min={0} max={60}
              className="staax-input" style={{width:'60px',fontSize:'12px'}}/>
            <span style={{fontSize:'10px',color:'var(--text-dim)'}}>s (max 60)</span>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
            <span style={{fontSize:'11px',color:'var(--text-muted)',fontWeight:600,whiteSpace:'nowrap'}}>Exit Delay:</span>
            <input value={exitDelay} onChange={e=>setExitDelay(e.target.value)} type="number" min={0} max={60}
              className="staax-input" style={{width:'60px',fontSize:'12px'}}/>
            <span style={{fontSize:'10px',color:'var(--text-dim)'}}>s (max 60)</span>
          </div>
        </div>

        {/* Visual separator */}
        <div style={{margin:'12px 0',borderTop:'1px solid var(--bg-border)',display:'flex',alignItems:'center',gap:'10px'}}>
          <span style={{fontSize:'10px',fontWeight:700,color:'var(--text-dim)',textTransform:'uppercase',
            letterSpacing:'0.08em',marginTop:'10px'}}>Error Settings — Algo Level</span>
        </div>

        <div style={{display:'flex',gap:'20px',flexWrap:'wrap'}}>
          <label style={{display:'flex',alignItems:'center',gap:'7px',cursor:'pointer',fontSize:'11px',color:'var(--red)'}}>
            <input type="checkbox" checked={errorMargin} onChange={e=>setErrorMargin(e.target.checked)}
              style={{accentColor:'var(--red)'}}/>
            On margin error, exit all open positions
          </label>
          <label style={{display:'flex',alignItems:'center',gap:'7px',cursor:'pointer',fontSize:'11px',color:'var(--red)'}}>
            <input type="checkbox" checked={errorEntry} onChange={e=>setErrorEntry(e.target.checked)}
              style={{accentColor:'var(--red)'}}/>
            If any entry fails, exit all open positions
          </label>
        </div>
      </div>
    </div>
  )
}
EOF

# ─── REPORTS — Uniform card height, rounded squares, single expand ────────────
cat > frontend/src/pages/ReportsPage.tsx << 'EOF'
import { useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

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
  {key:'totalPnl', label:'Overall P&L',  isLoss:false},
  {key:'avgDay',   label:'Avg Day P&L',  isLoss:false},
  {key:'maxProfit',label:'Max Profit',   isLoss:false},
  {key:'maxLoss',  label:'Max Loss',     isLoss:true },
  {key:'winPct',   label:'Win %',        isLoss:false},
  {key:'lossPct',  label:'Loss %',       isLoss:true },
  {key:'mdd',      label:'Max Drawdown', isLoss:true },
  {key:'roi',      label:'ROI',          isLoss:false},
]

function genDayPnls(month:number,year:number){
  const days=new Date(year,month,0).getDate()
  const r:Record<number,number|null>={}
  for(let d=1;d<=days;d++){
    const dow=new Date(year,month-1,d).getDay()
    if(dow===0||dow===6){r[d]=null;continue}
    const seed=(d*37+month*13+year)%100
    r[d]=seed>45?Math.floor((seed-45)*220):-Math.floor((45-seed)*110)
  }
  return r
}

function fyMonths(fy:string){
  const sy=parseInt(fy.split('-')[0])
  return [4,5,6,7,8,9,10,11,12,1,2,3].map(m=>({
    month:m, year:m>=4?sy:sy+1,
    label:['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m],
    key:`${m}-${m>=4?sy:sy+1}`,
  }))
}

// Fixed card dimensions
const CARD_HEIGHT = 148
const DOT_SIZE    = 10

// Rounded-square dot
function Dot({pnl}:{pnl:number|null}){
  if(pnl===null) return <div style={{width:DOT_SIZE,height:DOT_SIZE}}/>
  return (
    <div style={{width:DOT_SIZE,height:DOT_SIZE,borderRadius:'3px',
      background:pnl>0?'var(--green)':'var(--red)',
      opacity:0.85,flexShrink:0}}/>
  )
}

interface MiniCalProps{
  month:number;year:number;label:string;selected:boolean;onToggle:()=>void
}
function MiniCal({month,year,label,selected,onToggle}:MiniCalProps){
  const pnls=genDayPnls(month,year)
  const vals=Object.values(pnls).filter(v=>v!==null) as number[]
  const winDays=vals.filter(v=>v>0).length
  const lossDays=vals.filter(v=>v<=0).length
  const total=winDays+lossDays
  const monthPnl=vals.reduce((s,v)=>s+v,0)
  const firstDow=new Date(year,month-1,1).getDay()
  const offset=(firstDow===0?4:firstDow-1)%5
  const tradingDays=Array.from({length:new Date(year,month,0).getDate()},(_,i)=>i+1)
    .filter(d=>{const dow=new Date(year,month-1,d).getDay();return dow!==0&&dow!==6})
  const padded=[...Array(offset).fill(null),...tradingDays]

  return (
    <div onClick={onToggle}
      style={{
        background:selected?'rgba(0,176,240,0.08)':'var(--bg-secondary)',
        border:`1px solid ${selected?'var(--accent-blue)':'var(--bg-border)'}`,
        borderRadius:'8px',padding:'10px',cursor:'pointer',transition:'all 0.12s',
        height:`${CARD_HEIGHT}px`,   // fixed uniform height
        overflow:'hidden',display:'flex',flexDirection:'column',
      }}>
      {/* Header */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'4px',flexShrink:0}}>
        <span style={{fontSize:'11px',fontWeight:700,letterSpacing:'0.06em',
          color:selected?'var(--accent-blue)':'var(--text)'}}>
          {label.toUpperCase()}
        </span>
        <span style={{fontSize:'10px',fontWeight:700,color:monthPnl>=0?'var(--green)':'var(--red)'}}>
          {monthPnl>=0?'+':''}{(monthPnl/1000).toFixed(1)}k
        </span>
      </div>
      {/* Win/loss bar */}
      {total>0&&(
        <div style={{height:'3px',borderRadius:'2px',background:'var(--bg-border)',
          marginBottom:'5px',overflow:'hidden',display:'flex',flexShrink:0}}>
          <div style={{width:`${(winDays/total)*100}%`,height:'100%',background:'var(--green)'}}/>
          <div style={{width:`${(lossDays/total)*100}%`,height:'100%',background:'var(--red)'}}/>
        </div>
      )}
      {/* Day headers */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:'1px',marginBottom:'3px',flexShrink:0}}>
        {['M','T','W','T','F'].map((d,i)=>(
          <div key={i} style={{textAlign:'center',fontSize:'7px',color:'var(--text-dim)',fontWeight:700}}>{d}</div>
        ))}
      </div>
      {/* Dots — rounded squares */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:'3px',flex:1,alignContent:'start'}}>
        {padded.map((day,i)=>(
          <div key={i} style={{display:'flex',alignItems:'center',justifyContent:'center',padding:'2px 0'}}>
            <Dot pnl={day?pnls[day as number]:null}/>
          </div>
        ))}
      </div>
    </div>
  )
}

function MonthDetail({month,year,label}:{month:number,year:number,label:string}){
  const pnls=genDayPnls(month,year)
  const firstDow=new Date(year,month-1,1).getDay()
  const offset=(firstDow===0?4:firstDow-1)%5
  const tradingDays=Array.from({length:new Date(year,month,0).getDate()},(_,i)=>i+1)
    .filter(d=>{const dow=new Date(year,month-1,d).getDay();return dow!==0&&dow!==6})
  const padded=[...Array(offset).fill(null),...tradingDays]

  return (
    <div style={{background:'var(--bg-secondary)',border:'1px solid var(--accent-blue)',
      borderRadius:'8px',padding:'16px',marginTop:'12px'}}>
      <div style={{fontSize:'12px',fontWeight:700,color:'var(--accent-blue)',marginBottom:'14px'}}>
        {label} {year} — Day View
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:'4px',marginBottom:'4px'}}>
        {['Mon','Tue','Wed','Thu','Fri'].map(d=>(
          <div key={d} style={{textAlign:'center',fontSize:'10px',color:'var(--text-dim)',fontWeight:600}}>{d}</div>
        ))}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:'4px'}}>
        {padded.map((day,i)=>{
          if(!day)return <div key={i}/>
          const pnl=pnls[day as number]
          return (
            <div key={i} style={{padding:'8px 4px',borderRadius:'6px',textAlign:'center',
              background:pnl==null?'transparent'
                :pnl>0?`rgba(34,197,94,${Math.min((pnl||0)/8000,1)*0.35+0.08})`
                :`rgba(239,68,68,${Math.min(Math.abs(pnl||0)/3000,1)*0.35+0.08})`}}>
              <div style={{fontSize:'11px',color:'var(--text-muted)'}}>{day}</div>
              {pnl!=null&&(
                <div style={{fontSize:'10px',fontWeight:700,marginTop:'2px',
                  color:pnl>0?'var(--green)':'var(--red)'}}>
                  {pnl>0?'+':''}{(pnl/1000).toFixed(1)}k
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const CustomTooltip=({active,payload,label}:any)=>{
  if(!active||!payload?.length)return null
  return (
    <div style={{background:'var(--bg-surface)',border:'1px solid var(--bg-border)',borderRadius:'6px',padding:'10px 14px'}}>
      <div style={{fontSize:'11px',color:'var(--text-muted)',marginBottom:'4px'}}>{label}</div>
      <div style={{fontWeight:700,color:'var(--accent-blue)'}}>₹{payload[0].value?.toLocaleString('en-IN')}</div>
    </div>
  )
}

const MONTHS_LIST=['Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar']

export default function ReportsPage(){
  const [fy,setFy]=useState('2024-25')
  const [expandedMonth,setExpandedMonth]=useState<string|null>(null)
  const [metricFilter,setMetricFilter]=useState('fy')
  const [metricMonth,setMetricMonth]=useState('Apr')
  const [metricDate,setMetricDate]=useState('')
  const [metricFrom,setMetricFrom]=useState('')
  const [metricTo,setMetricTo]=useState('')

  const months=fyMonths(fy)
  const totalPnl=FY_PNLS.reduce((s,x)=>s+x,0)
  const prevPnl=702440
  const expandedData=expandedMonth?months.find(m=>m.key===expandedMonth):null

  // Label for active period in metrics section
  const activePeriodLabel=
    metricFilter==='fy'?`FY ${fy}`:
    metricFilter==='month'?`${metricMonth} · FY ${fy}`:
    metricFilter==='date'&&metricDate?metricDate:
    metricFilter==='custom'&&metricFrom&&metricTo?`${metricFrom} → ${metricTo}`:
    metricFilter==='custom'?'Select period':'—'

  return (
    <div>
      <div className="page-header">
        <h1 style={{fontFamily:"'ADLaM Display',serif",fontSize:'22px',fontWeight:400}}>Reports</h1>
        <div className="page-header-actions">
          <select className="staax-select" value={fy} onChange={e=>setFy(e.target.value)} style={{width:'120px'}}>
            <option value="2024-25">FY 2024–25</option>
            <option value="2023-24">FY 2023–24</option>
          </select>
          <button className="btn btn-ghost" style={{fontSize:'11px'}}>⬇ CSV</button>
        </div>
      </div>

      {/* Top widgets */}
      <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr',gap:'12px',marginBottom:'20px'}}>
        <div className="card">
          <div style={{fontSize:'10px',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:'4px'}}>FY {fy} Total P&L</div>
          <div style={{display:'flex',alignItems:'flex-end',gap:'16px'}}>
            <div>
              <div style={{fontSize:'26px',fontWeight:700,color:'var(--green)',letterSpacing:'-0.02em'}}>
                ₹{(totalPnl/100000).toFixed(2)}L
              </div>
              <div style={{fontSize:'11px',color:'var(--green)',marginTop:'2px'}}>
                ▲ {(((totalPnl-prevPnl)/prevPnl)*100).toFixed(1)}% vs prev year
              </div>
            </div>
            <div style={{flex:1,height:'46px'}}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={CUMULATIVE}>
                  <Line type="monotone" dataKey="cumulative" stroke="#00B0F0" strokeWidth={2} dot={false}/>
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
        <div className="card">
          <div style={{fontSize:'10px',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:'4px'}}>March P&L</div>
          <div style={{fontSize:'22px',fontWeight:700,color:'var(--green)'}}>₹91,500</div>
          <div style={{fontSize:'11px',color:'var(--green)',marginTop:'4px'}}>▲ 6.3% vs Feb</div>
        </div>
        <div className="card">
          <div style={{fontSize:'10px',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:'4px'}}>Today P&L</div>
          <div style={{fontSize:'22px',fontWeight:700,color:'var(--green)'}}>+₹4,320</div>
          <div style={{fontSize:'11px',color:'var(--text-dim)',marginTop:'4px'}}>2 algos active</div>
        </div>
      </div>

      {/* FY Calendar */}
      <div className="card" style={{marginBottom:'20px'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'12px'}}>
          <div style={{fontSize:'11px',fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.08em'}}>
            FY {fy} — Full Year Calendar
          </div>
          <div style={{display:'flex',gap:'12px',fontSize:'11px',color:'var(--text-dim)',alignItems:'center'}}>
            <span style={{display:'flex',alignItems:'center',gap:'4px'}}>
              <span style={{width:'8px',height:'8px',borderRadius:'2px',background:'var(--green)',display:'inline-block'}}/> Profit
            </span>
            <span style={{display:'flex',alignItems:'center',gap:'4px'}}>
              <span style={{width:'8px',height:'8px',borderRadius:'2px',background:'var(--red)',display:'inline-block'}}/> Loss
            </span>
            <span>Click month to expand</span>
          </div>
        </div>

        {/* 6 × 2 uniform grid */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:'8px'}}>
          {months.map(m=>(
            <MiniCal key={m.key} month={m.month} year={m.year} label={m.label}
              selected={expandedMonth===m.key}
              onToggle={()=>setExpandedMonth(p=>p===m.key?null:m.key)}/>
          ))}
        </div>

        {/* Single expanded view below ALL months — no duplicate */}
        {expandedData&&(
          <MonthDetail month={expandedData.month} year={expandedData.year} label={expandedData.label}/>
        )}
      </div>

      {/* Per-Algo Metrics */}
      <div className="card" style={{overflowX:'auto'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',
          marginBottom:'12px',flexWrap:'wrap',gap:'8px'}}>
          <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
            <div style={{fontSize:'11px',fontWeight:700,color:'var(--text-muted)',
              textTransform:'uppercase',letterSpacing:'0.08em'}}>
              Per-Algo Metrics
            </div>
            {/* Active period label */}
            <span style={{fontSize:'11px',color:'var(--accent-blue)',background:'rgba(0,176,240,0.1)',
              padding:'2px 8px',borderRadius:'4px',fontWeight:600}}>
              {activePeriodLabel}
            </span>
          </div>
          <div style={{display:'flex',gap:'6px',alignItems:'center',flexWrap:'wrap'}}>
            {/* FY always visible */}
            <select className="staax-select" value={fy} onChange={e=>setFy(e.target.value)}
              style={{width:'108px',fontSize:'11px'}}>
              <option value="2024-25">FY 2024–25</option>
              <option value="2023-24">FY 2023–24</option>
            </select>
            {[['fy','FY'],['month','Month'],['date','Date'],['custom','From–To']].map(([v,l])=>(
              <button key={v} onClick={()=>setMetricFilter(v)}
                className={`chip ${metricFilter===v?'chip-active':'chip-inactive'}`}
                style={{height:'32px',padding:'0 12px',fontSize:'11px'}}>
                {l}
              </button>
            ))}
            {metricFilter==='month'&&(
              <select className="staax-select" value={metricMonth}
                onChange={e=>setMetricMonth(e.target.value)} style={{width:'90px',fontSize:'11px'}}>
                {MONTHS_LIST.map(m=><option key={m}>{m}</option>)}
              </select>
            )}
            {metricFilter==='date'&&(
              <input type="date" className="staax-input" value={metricDate}
                onChange={e=>setMetricDate(e.target.value)} style={{width:'140px',fontSize:'11px'}}/>
            )}
            {metricFilter==='custom'&&(
              <div style={{display:'flex',alignItems:'center',gap:'5px'}}>
                <input type="date" className="staax-input" value={metricFrom}
                  onChange={e=>setMetricFrom(e.target.value)} style={{width:'130px',fontSize:'11px'}}/>
                <span style={{fontSize:'11px',color:'var(--text-dim)'}}>→</span>
                <input type="date" className="staax-input" value={metricTo}
                  onChange={e=>setMetricTo(e.target.value)} style={{width:'130px',fontSize:'11px'}}/>
              </div>
            )}
            <button className="btn btn-ghost" style={{fontSize:'10px',padding:'0 10px',height:'32px'}}>⬇ CSV</button>
          </div>
        </div>

        <table className="staax-table">
          <thead>
            <tr>
              <th style={{minWidth:'130px'}}>Key Metrics</th>
              {ALGO_METRICS.map(a=><th key={a.name}>{a.name}</th>)}
              <th style={{color:'var(--accent-blue)'}}>Cumulative</th>
            </tr>
          </thead>
          <tbody>
            {METRIC_ROWS.map(row=>{
              const cumVal=ALGO_METRICS.reduce((s,a)=>s+(a as any)[row.key],0)
              const isPercent=row.key==='winPct'||row.key==='lossPct'||row.key==='roi'
              const fmt=(n:number)=>isPercent?`${Math.abs(n)}%`:`₹${Math.abs(n).toLocaleString('en-IN')}`
              const cumFmt=isPercent?`${(cumVal/ALGO_METRICS.length).toFixed(1)}%`:`₹${Math.abs(cumVal).toLocaleString('en-IN')}`
              return (
                <tr key={row.key}>
                  <td style={{fontWeight:600,color:'var(--text-muted)',fontSize:'12px'}}>{row.label}</td>
                  {ALGO_METRICS.map(a=>(
                    <td key={a.name} style={{color:row.isLoss?'var(--red)':'var(--green)',fontWeight:600}}>
                      {fmt((a as any)[row.key])}
                    </td>
                  ))}
                  <td style={{color:'var(--accent-blue)',fontWeight:700}}>{cumFmt}</td>
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

# ─── ACCOUNTS — Remove Zerodha Login button ───────────────────────────────────
cat > frontend/src/pages/AccountsPage.tsx << 'EOF'
import { useState } from 'react'

interface Account {
  id:string; name:string; broker:string; type:string; status:string
  margin:number; pnl:number; token:string; color:string
  globalSL:number; globalTP:number
}

const INIT_ACCOUNTS: Account[] = [
  {id:'1',name:'Karthik',broker:'Zerodha',   type:'F&O',status:'active', margin:500000,pnl:84320,  token:'active', color:'#00B0F0',globalSL:10000,globalTP:25000},
  {id:'2',name:'Mom',    broker:'Angel One', type:'F&O',status:'active', margin:300000,pnl:-12450, token:'active', color:'#22C55E',globalSL:8000, globalTP:15000},
  {id:'3',name:'Wife',   broker:'Angel One', type:'MCX',status:'pending',margin:150000,pnl:0,      token:'pending',color:'#D77B12',globalSL:5000, globalTP:10000},
]

export default function AccountsPage() {
  const [accounts,setAccounts]=useState<Account[]>(INIT_ACCOUNTS)
  const [editMargin,setEditMargin]=useState<Record<string,string>>({})
  const [editSL,setEditSL]=useState<Record<string,string>>({})
  const [editTP,setEditTP]=useState<Record<string,string>>({})
  const [saved,setSaved]=useState<Record<string,string>>({})

  const showSaved=(id:string,msg:string)=>{
    setSaved(s=>({...s,[id]:msg}))
    setTimeout(()=>setSaved(s=>{const n={...s};delete n[id];return n}),3000)
  }

  const saveMargin=(acc:Account)=>{
    const val=parseFloat(editMargin[acc.id]||String(acc.margin))
    if(isNaN(val)||val<=0)return
    setAccounts(a=>a.map(x=>x.id===acc.id?{...x,margin:val}:x))
    showSaved(acc.id,'✅ Margin updated')
  }

  const saveSettings=(acc:Account)=>{
    const sl=parseFloat(editSL[acc.id]||String(acc.globalSL))
    const tp=parseFloat(editTP[acc.id]||String(acc.globalTP))
    setAccounts(a=>a.map(x=>x.id===acc.id?{...x,globalSL:sl,globalTP:tp}:x))
    showSaved(acc.id,'✅ Settings saved')
  }

  return (
    <div>
      <div className="page-header">
        <h1 style={{fontFamily:"'ADLaM Display',serif",fontSize:'22px',fontWeight:400}}>Accounts</h1>
        <div className="page-header-actions">
          <span style={{fontSize:'12px',color:'var(--text-muted)'}}>
            Broker login & token management is available in the <b style={{color:'var(--accent-blue)'}}>Dashboard</b>
          </span>
        </div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'16px'}}>
        {accounts.map(acc=>(
          <div key={acc.id} style={{background:'var(--bg-surface)',border:'1px solid var(--bg-border)',
            borderTop:`3px solid ${acc.color}`,borderRadius:'8px',padding:'16px'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'14px'}}>
              <div>
                <div style={{fontWeight:700,fontSize:'16px'}}>{acc.name}</div>
                <div style={{fontSize:'11px',color:'var(--text-muted)',marginTop:'2px'}}>{acc.broker} · {acc.type}</div>
              </div>
              <span style={{fontSize:'11px',padding:'3px 8px',borderRadius:'4px',fontWeight:600,
                color:acc.status==='active'?'var(--green)':'var(--amber)',
                background:acc.status==='active'?'rgba(34,197,94,0.12)':'rgba(245,158,11,0.12)'}}>
                {acc.status.toUpperCase()}
              </span>
            </div>

            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px',marginBottom:'14px'}}>
              <div style={{background:'var(--bg-secondary)',borderRadius:'6px',padding:'10px'}}>
                <div style={{fontSize:'10px',color:'var(--text-muted)',marginBottom:'4px',textTransform:'uppercase',letterSpacing:'0.05em'}}>FY Margin</div>
                <div style={{fontWeight:700,fontSize:'14px'}}>₹{(acc.margin/100000).toFixed(1)}L</div>
              </div>
              <div style={{background:'var(--bg-secondary)',borderRadius:'6px',padding:'10px'}}>
                <div style={{fontSize:'10px',color:'var(--text-muted)',marginBottom:'4px',textTransform:'uppercase',letterSpacing:'0.05em'}}>FY P&L</div>
                <div style={{fontWeight:700,fontSize:'14px',color:acc.pnl>=0?'var(--green)':'var(--red)'}}>
                  {acc.pnl>=0?'+':''}₹{Math.abs(acc.pnl).toLocaleString('en-IN')}
                </div>
              </div>
            </div>

            <div style={{fontSize:'11px',color:'var(--text-muted)',marginBottom:'12px',padding:'7px 10px',
              background:'var(--bg-secondary)',borderRadius:'5px'}}>
              API Token:&nbsp;
              <span style={{color:acc.token==='active'?'var(--green)':acc.token==='pending'?'var(--accent-amber)':'var(--amber)',fontWeight:600}}>
                {acc.token==='active'?'✅ Connected today':acc.token==='pending'?'⏳ Phase 2 (MCX)':'⚠️ Login required'}
              </span>
            </div>

            {acc.status==='active'&&<>
              <div style={{marginBottom:'10px'}}>
                <div style={{fontSize:'10px',color:'var(--text-muted)',marginBottom:'5px',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.05em'}}>Update FY Margin</div>
                <div style={{display:'flex',gap:'6px'}}>
                  <input className="staax-input" type="number" defaultValue={acc.margin}
                    onChange={e=>setEditMargin(m=>({...m,[acc.id]:e.target.value}))}
                    style={{flex:1,fontSize:'12px'}}/>
                  <button className="btn btn-ghost" style={{fontSize:'11px',flexShrink:0}}
                    onClick={()=>saveMargin(acc)}>Save</button>
                </div>
              </div>
              <div style={{marginBottom:'10px'}}>
                <div style={{fontSize:'10px',color:'var(--text-muted)',marginBottom:'5px',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.05em'}}>Global SL / TP</div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'6px',marginBottom:'6px'}}>
                  <input className="staax-input" type="number" placeholder="SL ₹" defaultValue={acc.globalSL}
                    onChange={e=>setEditSL(s=>({...s,[acc.id]:e.target.value}))} style={{fontSize:'12px'}}/>
                  <input className="staax-input" type="number" placeholder="TP ₹" defaultValue={acc.globalTP}
                    onChange={e=>setEditTP(s=>({...s,[acc.id]:e.target.value}))} style={{fontSize:'12px'}}/>
                </div>
                <button className="btn btn-ghost" style={{width:'100%',fontSize:'11px'}}
                  onClick={()=>saveSettings(acc)}>Save Settings</button>
              </div>
            </>}

            {saved[acc.id]&&(
              <div style={{fontSize:'12px',color:'var(--green)',fontWeight:600,
                padding:'6px 10px',background:'rgba(34,197,94,0.1)',borderRadius:'5px',textAlign:'center'}}>
                {saved[acc.id]}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
EOF

# ─── INDICATOR SYSTEMS — Placeholder for MCX bots ────────────────────────────
cat > frontend/src/pages/IndicatorsPage.tsx << 'EOF'
export default function IndicatorsPage() {
  const BOTS = [
    { name:'GOLDM Bot',    symbol:'GOLDM', exchange:'MCX', strategy:'Positional',  status:'phase2', color:'#D77B12' },
    { name:'SILVERM Bot',  symbol:'SILVERM',exchange:'MCX',strategy:'Positional',  status:'phase2', color:'#9CA3AF' },
    { name:'Crude Oil Bot',symbol:'CRUDEOIL',exchange:'MCX',strategy:'Intraday',   status:'phase2', color:'#6B7280' },
  ]

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 style={{fontFamily:"'ADLaM Display',serif",fontSize:'22px',fontWeight:400}}>Indicator Systems</h1>
          <p style={{fontSize:'12px',color:'var(--text-muted)',marginTop:'2px'}}>
            Pre-configured MCX bots — Phase 2
          </p>
        </div>
      </div>

      {/* Phase 2 notice */}
      <div style={{background:'rgba(215,123,18,0.08)',border:'1px solid rgba(215,123,18,0.25)',
        borderRadius:'8px',padding:'16px 20px',marginBottom:'24px',
        display:'flex',alignItems:'center',gap:'12px'}}>
        <span style={{fontSize:'18px'}}>⚙</span>
        <div>
          <div style={{fontWeight:600,color:'var(--accent-amber)',marginBottom:'2px'}}>Phase 2 — MCX Indicator Systems</div>
          <div style={{fontSize:'12px',color:'var(--text-muted)',lineHeight:1.5}}>
            MCX bots are pre-configured strategies that require no manual setup. 
            Each bot manages its own entries, exits, and SL logic. 
            P&L will be tracked separately here and merged into Reports with an Equity F&O / MCX filter.
          </div>
        </div>
      </div>

      {/* Bot cards */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'16px'}}>
        {BOTS.map(bot=>(
          <div key={bot.name} style={{background:'var(--bg-surface)',border:'1px solid var(--bg-border)',
            borderTop:`3px solid ${bot.color}`,borderRadius:'8px',padding:'16px',opacity:0.7}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'12px'}}>
              <div>
                <div style={{fontWeight:700,fontSize:'15px'}}>{bot.name}</div>
                <div style={{fontSize:'11px',color:'var(--text-muted)',marginTop:'2px'}}>
                  {bot.symbol} · {bot.exchange} · {bot.strategy}
                </div>
              </div>
              <span style={{fontSize:'10px',padding:'3px 8px',borderRadius:'4px',fontWeight:600,
                color:'var(--accent-amber)',background:'rgba(215,123,18,0.12)'}}>
                PHASE 2
              </span>
            </div>
            <div style={{height:'60px',background:'var(--bg-secondary)',borderRadius:'6px',
              display:'flex',alignItems:'center',justifyContent:'center',
              fontSize:'11px',color:'var(--text-dim)'}}>
              P&L widget — coming soon
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
EOF

echo ""
echo "✅ Phase 1C v6 applied!"
echo ""
echo "Summary of changes:"
echo "  Sidebar         — grid layout icon+text, uniform indentation"
echo "  Smart Grid      — P&L shown in open/closed cells, tighter layout"
echo "  Algo Config     — DTE (positional only), expiry 4 options, copy leg ⧉,"
echo "                    MTM unit first, clock icons dark (colorScheme:dark),"
echo "                    days at top-right, visual separator in error card,"
echo "                    MCX instruments removed"
echo "  Orders          — RUN/RE/SQ/T restored to 26px, day P&L inline"
echo "  Reports         — Fixed card height, rounded squares, single expand,"
echo "                    active period label in metrics"
echo "  Accounts        — Zerodha login removed, pointer to Dashboard"
echo "  Indicator Sys   — New page + nav item for MCX Phase 2 placeholder"
echo ""
echo "Commit:"
echo "  git add . && git commit -m 'Phase 1C v6: Sidebar alignment, DTE, copy leg, MCX split, Reports cards fix' && git push origin feature/ui-phase1c"
