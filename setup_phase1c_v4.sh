#!/bin/bash
# STAAX Phase 1C v4 — Targeted Fixes
# Run from: cd ~/STAXX/staax && bash setup_phase1c_v4.sh

echo "🚀 Applying Phase 1C v4 fixes..."

# ─── SMART GRID — Add instrument + leg indicators ────────────────────────────
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

interface AlgoLeg { instCode: string; dir: 'B'|'S' }

interface Algo {
  id: string
  name: string
  account: string
  todayStatus: CellStatus
  legs: AlgoLeg[]
}

const ALGOS: Algo[] = [
  { id:'1', name:'AWS-1',  account:'Karthik', todayStatus:'open',        legs:[{instCode:'NF',dir:'B'},{instCode:'NF',dir:'B'}] },
  { id:'2', name:'TF-BUY', account:'Mom',     todayStatus:'algo_active', legs:[{instCode:'BN',dir:'B'}] },
  { id:'3', name:'S1',     account:'Karthik', todayStatus:'no_trade',    legs:[{instCode:'NF',dir:'B'},{instCode:'NF',dir:'S'}] },
  { id:'4', name:'MDS-1',  account:'Mom',     todayStatus:'error',       legs:[{instCode:'MN',dir:'B'}] },
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

function CyclePie({ status }: { status: CellStatus }) {
  const cfg = STATUS_CFG[status]
  const r = 13, cx = 15, cy = 15
  const circumference = 2 * Math.PI * r
  const offset = circumference * (1 - cfg.pct / 100)
  return (
    <svg width="30" height="30" style={{ flexShrink:0 }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="2.5" />
      {cfg.pct > 0 && (
        <circle cx={cx} cy={cy} r={r} fill="none"
          stroke={cfg.color} strokeWidth="2.5"
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" transform={`rotate(-90 ${cx} ${cy})`} />
      )}
      <circle cx={cx} cy={cy} r="3.5" fill={cfg.color} opacity="0.85" />
    </svg>
  )
}

export default function GridPage() {
  const navigate = useNavigate()
  const [grid, setGrid] = useState(INIT_GRID)
  const [showWeekends, setShowWeekends] = useState(false)
  const [editing, setEditing] = useState<{algoId:string,day:string}|null>(null)
  const [editVal, setEditVal] = useState('')
  const [dragAlgoId, setDragAlgoId] = useState<string|null>(null)

  const visibleDays = showWeekends ? [...DAYS,...WEEKENDS] : DAYS

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
          <button className="btn btn-primary" style={{ fontSize:'12px' }} onClick={() => navigate('/algo/new')}>
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
        <span style={{ marginLeft:'auto', fontSize:'10px', color:'var(--text-dim)' }}>Drag algo → day cell to deploy · Click M to edit</span>
      </div>

      <div style={{ overflowX:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <colgroup>
            <col style={{ width:'200px', minWidth:'200px' }} />
            {visibleDays.map(d => <col key={d} style={{ width:'130px', minWidth:'110px' }} />)}
          </colgroup>
          <thead>
            <tr>
              <th style={{ padding:'9px 14px', textAlign:'left', background:'var(--bg-secondary)',
                border:'1px solid var(--bg-border)', fontSize:'11px', color:'var(--text-muted)',
                fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase' }}>ALGO</th>
              {visibleDays.map(day => (
                <th key={day} style={{ padding:'9px 14px', textAlign:'center', background:'var(--bg-secondary)',
                  border:'1px solid var(--bg-border)', fontSize:'11px', fontWeight:700,
                  letterSpacing:'0.08em', textTransform:'uppercase',
                  color: WEEKENDS.includes(day) ? 'var(--text-dim)' : 'var(--text-muted)' }}>
                  {day}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ALGOS.map(algo => (
              <tr key={algo.id}>
                {/* Algo name cell */}
                <td draggable onDragStart={() => setDragAlgoId(algo.id)} onDragEnd={() => setDragAlgoId(null)}
                  style={{ padding:'10px 12px', background:'var(--bg-secondary)',
                    border:'1px solid var(--bg-border)', cursor:'grab', userSelect:'none' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                    <CyclePie status={algo.todayStatus} />
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontWeight:700, fontSize:'13px', color:'var(--text)', marginBottom:'3px' }}>
                        {algo.name}
                      </div>
                      <div style={{ fontSize:'10px', color:'var(--text-dim)', marginBottom:'4px' }}>
                        {algo.account}
                      </div>
                      {/* Instrument + leg direction badges */}
                      <div style={{ display:'flex', gap:'3px', flexWrap:'wrap' }}>
                        {algo.legs.map((leg, i) => (
                          <span key={i} style={{
                            fontSize:'9px', fontWeight:700, letterSpacing:'0.04em',
                            padding:'1px 5px', borderRadius:'3px',
                            background: leg.dir==='B' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                            color:       leg.dir==='B' ? 'var(--green)' : 'var(--red)',
                            border:`1px solid ${leg.dir==='B'?'rgba(34,197,94,0.3)':'rgba(239,68,68,0.3)'}`,
                          }}>
                            {leg.instCode} {leg.dir}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </td>

                {/* Day cells */}
                {visibleDays.map(day => {
                  const cell = grid[algo.id]?.[day]
                  const s    = cell ? STATUS_CFG[cell.status] : null
                  return (
                    <td key={day} onDragOver={e => e.preventDefault()} onDrop={() => handleDrop(algo.id, day)}
                      style={{ padding:'5px', border:'1px solid var(--bg-border)', verticalAlign:'top',
                        background: WEEKENDS.includes(day) && !cell ? 'rgba(30,32,34,0.5)' : undefined }}>
                      {cell && s ? (
                        <div style={{ background:'var(--bg-secondary)', borderLeft:`3px solid ${s.color}`,
                          borderRadius:'5px', padding:'8px', position:'relative' }}>
                          <button onClick={() => removeCell(algo.id, day)} title="Remove"
                            style={{ position:'absolute', top:'3px', right:'3px', background:'none', border:'none',
                              cursor:'pointer', color:'var(--text-dim)', fontSize:'11px', padding:'2px 4px' }}
                            onMouseEnter={e => (e.currentTarget.style.color='var(--red)')}
                            onMouseLeave={e => (e.currentTarget.style.color='var(--text-dim)')}>✕</button>
                          <span style={{ fontSize:'9px', fontWeight:700, letterSpacing:'0.05em',
                            color:s.color, background:s.bg, padding:'2px 5px', borderRadius:'3px',
                            display:'inline-block', marginBottom:'5px' }}>
                            {s.label.toUpperCase()}
                          </span>
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
                                title="Click to edit"
                                style={{ fontSize:'12px', fontWeight:700, color:'var(--accent-blue)',
                                  cursor:'text', padding:'1px 4px', borderRadius:'3px', border:'1px solid transparent' }}
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

# ─── ORDERS PAGE — Fixed column widths, proper buttons, weekend tabs ──────────
cat > frontend/src/pages/OrdersPage.tsx << 'EOF'
import { useState } from 'react'

// Weekend days to auto-show when there's an active trade
const WEEKEND_DAYS_WITH_TRADES = ['SAT']  // e.g. BTST open position

const ALL_DAYS = ['MON','TUE','WED','THU','FRI']

type LegStatus = 'open'|'closed'|'error'|'pending'

interface Leg {
  id: string
  parentId?: string
  journeyLevel: string
  status: LegStatus
  symbol: string
  dir: 'BUY'|'SELL'
  lots: string
  entryCondition: string
  refPrice?: number
  fillPrice?: number
  fillTime?: string
  ltp?: number
  slOrig?: number
  slActual?: number
  target?: number
  exitPrice?: number
  exitTime?: string
  exitReason?: string
  pnl?: number
}

interface AlgoGroup {
  algoName: string
  account: string
  mtm: number
  mtmSL: number
  mtmTP: number
  legs: Leg[]
}

const SAMPLE_ORDERS: AlgoGroup[] = [
  {
    algoName:'AWS-1', account:'Karthik', mtm:4320, mtmSL:-5000, mtmTP:10000,
    legs:[
      { id:'L1', journeyLevel:'1',   status:'open',   symbol:'NIFTY 22500CE 27MAR25', dir:'BUY',  lots:'1 (50)', entryCondition:'ORB High', refPrice:186.5, fillPrice:187.0, fillTime:'09:17:32', ltp:213.5, slOrig:150, slActual:175, target:280, pnl:1325  },
      { id:'L1a', parentId:'L1', journeyLevel:'1.1', status:'closed', symbol:'NIFTY 22500CE 27MAR25', dir:'BUY', lots:'1 (50)', entryCondition:'Re-entry', refPrice:187.0, fillPrice:188.0, fillTime:'10:05:11', slOrig:155, target:280, exitPrice:120, exitTime:'10:15:22', exitReason:'SL', pnl:-3400 },
      { id:'L2', journeyLevel:'2',   status:'open',   symbol:'NIFTY 22500PE 27MAR25', dir:'BUY',  lots:'1 (50)', entryCondition:'ORB Low',  refPrice:143.0, fillPrice:142.5, fillTime:'09:17:32', ltp:118.2, slOrig:110, slActual:110, target:200, pnl:-1215 },
      { id:'L3', journeyLevel:'3',   status:'error',  symbol:'NIFTY 22400CE 27MAR25', dir:'BUY',  lots:'1 (50)', entryCondition:'Direct',   pnl:0 },
    ]
  },
  {
    algoName:'TF-BUY', account:'Mom', mtm:-800, mtmSL:-3000, mtmTP:6000,
    legs:[
      { id:'L4', journeyLevel:'1', status:'open', symbol:'BANKNIFTY 48000CE 26MAR25', dir:'BUY', lots:'2 (30)', entryCondition:'W&T Up 5%', refPrice:200.0, fillPrice:210.0, fillTime:'09:45:10', ltp:198.5, slOrig:180, slActual:185, target:280, pnl:-575 },
    ]
  },
]

const STATUS_STYLE: Record<LegStatus,{color:string,bg:string}> = {
  open:   {color:'#22C55E',bg:'rgba(34,197,94,0.12)'},
  closed: {color:'#6B7280',bg:'rgba(107,114,128,0.12)'},
  error:  {color:'#EF4444',bg:'rgba(239,68,68,0.12)'},
  pending:{color:'#F59E0B',bg:'rgba(245,158,11,0.12)'},
}

// Fixed column widths — uniform across all algos
const COL_WIDTHS = {
  level:     '46px',
  status:    '72px',
  symbol:    '200px',
  lots:      '72px',
  entryRef:  '130px',
  fill:      '72px',
  ltp:       '64px',
  sl:        '80px',
  target:    '64px',
  exit:      '100px',
  reason:    '72px',
  pnl:       '88px',
}

function LegRow({ leg, isChild }: { leg:Leg, isChild:boolean }) {
  const st = STATUS_STYLE[leg.status]
  return (
    <tr style={{ background: isChild ? 'rgba(0,176,240,0.025)' : undefined }}>
      <td style={{ width:COL_WIDTHS.level, paddingLeft: isChild ? '20px' : '12px' }}>
        <span style={{ fontSize:'11px', color:'var(--text-muted)', fontWeight: isChild ? 600 : 400 }}>
          {leg.journeyLevel}
        </span>
      </td>
      <td style={{ width:COL_WIDTHS.status }}>
        <span className="tag" style={{ color:st.color, background:st.bg, fontSize:'10px' }}>
          {leg.status.toUpperCase()}
        </span>
      </td>
      <td style={{ width:COL_WIDTHS.symbol }}>
        <div style={{ fontSize:'11px', color:'var(--text)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:COL_WIDTHS.symbol }}>
          {leg.symbol}
        </div>
        <div style={{ fontSize:'10px', color: leg.dir==='BUY' ? 'var(--green)' : 'var(--red)', fontWeight:600 }}>{leg.dir}</div>
      </td>
      <td style={{ width:COL_WIDTHS.lots, color:'var(--text-muted)', fontSize:'11px' }}>{leg.lots}</td>
      <td style={{ width:COL_WIDTHS.entryRef, fontSize:'11px' }}>
        <div style={{ color:'var(--text-muted)' }}>{leg.entryCondition}</div>
        {leg.refPrice != null && <div style={{ color:'var(--text-dim)', fontSize:'10px', marginTop:'1px' }}>Ref: {leg.refPrice}</div>}
      </td>
      <td style={{ width:COL_WIDTHS.fill, fontWeight:600 }}>{leg.fillPrice ?? '—'}</td>
      <td style={{ width:COL_WIDTHS.ltp, fontWeight:600,
        color: leg.ltp != null && leg.fillPrice != null
          ? (leg.ltp > leg.fillPrice ? 'var(--green)' : 'var(--red)')
          : 'var(--text-muted)' }}>
        {leg.ltp ?? '—'}
      </td>
      <td style={{ width:COL_WIDTHS.sl, fontSize:'11px' }}>
        {leg.slActual != null && <div style={{ color:'var(--amber)' }}>A:{leg.slActual}</div>}
        {leg.slOrig  != null && <div style={{ color:'var(--text-muted)' }}>O:{leg.slOrig}</div>}
        {leg.slOrig  == null && '—'}
      </td>
      <td style={{ width:COL_WIDTHS.target, color:'var(--text-muted)' }}>{leg.target ?? '—'}</td>
      <td style={{ width:COL_WIDTHS.exit, fontSize:'11px' }}>
        {leg.exitPrice != null ? (
          <>
            <div style={{ fontWeight:600 }}>{leg.exitPrice}</div>
            {leg.exitTime && <div style={{ fontSize:'10px', color:'var(--text-dim)' }}>{leg.exitTime}</div>}
          </>
        ) : '—'}
      </td>
      <td style={{ width:COL_WIDTHS.reason }}>
        {leg.exitReason
          ? <span className="tag" style={{ color:'var(--red)', background:'rgba(239,68,68,0.1)', fontSize:'10px' }}>{leg.exitReason}</span>
          : '—'}
      </td>
      <td style={{ width:COL_WIDTHS.pnl, fontWeight:700,
        color: (leg.pnl||0) >= 0 ? 'var(--green)' : 'var(--red)', textAlign:'right' }}>
        {leg.pnl != null ? `${leg.pnl >= 0 ? '+' : ''}₹${Math.abs(leg.pnl).toLocaleString('en-IN')}` : '—'}
      </td>
    </tr>
  )
}

const ACTION_BTNS = [
  { label:'RUN', title:'Execute inactive algo',                              color:'#00B0F0' },
  { label:'RE',  title:'Retry errored order (auto switches LIMIT↔MARKET)',  color:'#F59E0B' },
  { label:'SQ',  title:'Square off open positions (pending untouched)',      color:'#22C55E' },
  { label:'T',   title:'Square off all + cancel pending + terminate algo',  color:'#EF4444' },
]

export default function OrdersPage() {
  const [activeDay, setActiveDay] = useState('MON')
  const [showWeekends, setShowWeekends] = useState(false)

  // Auto-include weekends that have active trades
  const autoWeekends = WEEKEND_DAYS_WITH_TRADES
  const visibleDays = showWeekends
    ? [...ALL_DAYS, 'SAT', 'SUN']
    : [...ALL_DAYS, ...autoWeekends.filter(d => !ALL_DAYS.includes(d))]

  const totalMTM = SAMPLE_ORDERS.reduce((s,g) => s+g.mtm, 0)

  const buildRows = (legs: Leg[]) => {
    const result: { leg:Leg, isChild:boolean }[] = []
    for (const parent of legs.filter(l => !l.parentId)) {
      result.push({ leg:parent, isChild:false })
      for (const child of legs.filter(l => l.parentId === parent.id)) {
        result.push({ leg:child, isChild:true })
      }
    }
    return result
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'14px' }}>
        <h1 style={{ fontFamily:"'ADLaM Display', serif", fontSize:'22px', fontWeight:400 }}>Orders</h1>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <span style={{ fontSize:'13px', fontWeight:700, color: totalMTM >= 0 ? 'var(--green)' : 'var(--red)' }}>
            MTM: {totalMTM >= 0 ? '+' : ''}₹{totalMTM.toLocaleString('en-IN')}
          </span>
          <label style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'12px', color:'var(--text-muted)', cursor:'pointer' }}>
            <input type="checkbox" checked={showWeekends} onChange={e => setShowWeekends(e.target.checked)}
              style={{ accentColor:'var(--accent-blue)' }} />
            Show Weekends
          </label>
        </div>
      </div>

      {/* Day tabs */}
      <div style={{ display:'flex', gap:'2px', marginBottom:'18px', borderBottom:'1px solid var(--bg-border)' }}>
        {visibleDays.map(d => {
          const isWeekend = d === 'SAT' || d === 'SUN'
          const hasAutoTrade = autoWeekends.includes(d) && !showWeekends
          return (
            <button key={d} onClick={() => setActiveDay(d)} style={{
              padding:'8px 16px', fontSize:'12px', fontWeight:600,
              border:'none', cursor:'pointer', borderRadius:'5px 5px 0 0',
              background: activeDay===d ? 'var(--bg-surface)' : 'transparent',
              color: activeDay===d ? 'var(--accent-blue)'
                : hasAutoTrade ? 'var(--accent-amber)'
                : isWeekend ? 'var(--text-dim)'
                : 'var(--text-muted)',
              borderBottom: activeDay===d ? '2px solid var(--accent-blue)'
                : hasAutoTrade ? '2px solid var(--accent-amber)'
                : '2px solid transparent',
              position:'relative',
            }}>
              {d}
              {hasAutoTrade && (
                <span style={{ position:'absolute', top:'4px', right:'4px',
                  width:'6px', height:'6px', borderRadius:'50%',
                  background:'var(--accent-amber)' }} />
              )}
            </button>
          )
        })}
      </div>

      {/* Algo groups */}
      {SAMPLE_ORDERS.map((group, gi) => (
        <div key={gi} style={{ marginBottom:'16px' }}>
          {/* Group header */}
          <div style={{ background:'var(--bg-secondary)', border:'1px solid var(--bg-border)',
            borderRadius:'7px 7px 0 0', padding:'9px 14px',
            display:'flex', alignItems:'center', gap:'12px', flexWrap:'wrap' }}>
            <span style={{ fontWeight:700, fontSize:'14px', color:'var(--accent-blue)' }}>{group.algoName}</span>
            <span style={{ fontSize:'11px', color:'var(--text-muted)', background:'var(--bg-surface)',
              padding:'2px 8px', borderRadius:'4px' }}>{group.account}</span>
            <span style={{ fontSize:'11px', color:'var(--text-dim)' }}>
              MTM SL: <span style={{ color:'var(--red)' }}>₹{Math.abs(group.mtmSL).toLocaleString('en-IN')}</span>
              &nbsp;·&nbsp;
              MTM TP: <span style={{ color:'var(--green)' }}>₹{group.mtmTP.toLocaleString('en-IN')}</span>
            </span>
            <div style={{ marginLeft:'auto', display:'flex', gap:'6px', alignItems:'center' }}>
              {ACTION_BTNS.map(btn => (
                <button key={btn.label} title={btn.title} style={{
                  padding:'5px 14px', fontSize:'11px', fontWeight:700,
                  border:`1.5px solid ${btn.color}`,
                  background:'transparent',
                  color:btn.color,
                  borderRadius:'5px', cursor:'pointer',
                  transition:'all 0.12s',
                }}
                  onMouseEnter={e => { e.currentTarget.style.background = `${btn.color}20` }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                >{btn.label}</button>
              ))}
              <span style={{ fontWeight:700, fontSize:'15px', marginLeft:'6px',
                color: group.mtm >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {group.mtm >= 0 ? '+' : ''}₹{group.mtm.toLocaleString('en-IN')}
              </span>
            </div>
          </div>

          {/* Table */}
          <div style={{ border:'1px solid var(--bg-border)', borderTop:'none',
            borderRadius:'0 0 7px 7px', overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', tableLayout:'fixed' }}>
              <colgroup>
                {Object.values(COL_WIDTHS).map((w,i) => <col key={i} style={{ width:w }} />)}
              </colgroup>
              <thead>
                <tr>
                  {['#','Status','Symbol','Lots','Entry / Ref','Fill','LTP','SL (A/O)','Target','Exit','Reason','P&L'].map(h => (
                    <th key={h} style={{
                      background:'var(--bg-secondary)', color:'var(--text-muted)',
                      fontSize:'10px', fontWeight:700, letterSpacing:'0.05em', textTransform:'uppercase',
                      padding:'7px 12px', textAlign:'left', borderBottom:'1px solid var(--bg-border)',
                      whiteSpace:'nowrap', overflow:'hidden',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {buildRows(group.legs).map(({ leg, isChild }) => (
                  <LegRow key={leg.id} leg={leg} isChild={isChild} />
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

# ─── REPORTS — Fix: month expand, win/loss bar, date picker, FY always visible
cat > frontend/src/pages/ReportsPage.tsx << 'EOF'
import { useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

const MONTHS_FY = ['Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar']
const FY_PNLS   = [12400,28900,21200,45600,38400,61200,54800,72300,68900,84100,79200,91500]

const CUMULATIVE = MONTHS_FY.map((m,i) => ({
  month:m,
  cumulative: FY_PNLS.slice(0,i+1).reduce((s,x)=>s+x,0),
}))

const ALGO_METRICS = [
  { name:'AWS-1',  totalPnl:48320, avgDay:1250, maxProfit:8400, maxLoss:-3200, winPct:68, lossPct:32, mdd:-9800,  roi:9.7  },
  { name:'TF-BUY', totalPnl:22180, avgDay:820,  maxProfit:6200, maxLoss:-2100, winPct:61, lossPct:39, mdd:-6400,  roi:7.4  },
  { name:'S1',     totalPnl:15600, avgDay:610,  maxProfit:4100, maxLoss:-1800, winPct:55, lossPct:45, mdd:-4200,  roi:5.2  },
  { name:'MDS-1',  totalPnl:5400,  avgDay:280,  maxProfit:2200, maxLoss:-900,  winPct:52, lossPct:48, mdd:-2100,  roi:3.6  },
]

const METRIC_ROWS = [
  { key:'totalPnl',  label:'Overall P&L',   isLoss:false },
  { key:'avgDay',    label:'Avg Day P&L',    isLoss:false },
  { key:'maxProfit', label:'Max Profit',     isLoss:false },
  { key:'maxLoss',   label:'Max Loss',       isLoss:true  },
  { key:'winPct',    label:'Win %',          isLoss:false },
  { key:'lossPct',   label:'Loss %',         isLoss:true  },
  { key:'mdd',       label:'Max Drawdown',   isLoss:true  },
  { key:'roi',       label:'ROI',            isLoss:false },
]

function genDayPnls(month:number, year:number): Record<number,number|null> {
  const daysInMonth = new Date(year, month, 0).getDate()
  const result: Record<number,number|null> = {}
  for (let d=1; d<=daysInMonth; d++) {
    const dow = new Date(year,month-1,d).getDay()
    if (dow===0||dow===6) { result[d]=null; continue }
    const seed = (d*37+month*13+year) % 100
    result[d] = seed>45 ? Math.floor((seed-45)*220) : -Math.floor((45-seed)*110)
  }
  return result
}

function fyMonths(fy:string) {
  const startYear = parseInt(fy.split('-')[0])
  return [4,5,6,7,8,9,10,11,12,1,2,3].map(m => ({
    month:m, year: m>=4 ? startYear : startYear+1,
    label:['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m],
    key:`${m}-${m>=4?startYear:startYear+1}`,
  }))
}

// Expanded month detail — full day list with P&L
function MonthDetail({ month, year, label }: { month:number, year:number, label:string }) {
  const pnls = genDayPnls(month, year)
  const days = Object.entries(pnls)
    .filter(([,v]) => v !== null)
    .map(([d,v]) => ({ day:parseInt(d), pnl:v as number, date:new Date(year,month-1,parseInt(d)) }))

  const firstDow = new Date(year, month-1, 1).getDay()
  const offset = firstDow===0 ? 4 : firstDow-1
  const allDays = Array.from({length:new Date(year,month,0).getDate()},(_,i)=>i+1)

  return (
    <div style={{ background:'var(--bg-secondary)', border:'1px solid var(--accent-blue)',
      borderRadius:'8px', padding:'14px', marginTop:'10px' }}>
      <div style={{ fontSize:'12px', fontWeight:700, color:'var(--accent-blue)', marginBottom:'12px' }}>
        {label} {year} — Day View
      </div>
      {/* Day headers */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'4px', marginBottom:'4px' }}>
        {['Mon','Tue','Wed','Thu','Fri'].map(d => (
          <div key={d} style={{ textAlign:'center', fontSize:'10px', color:'var(--text-dim)', fontWeight:600 }}>{d}</div>
        ))}
      </div>
      {/* Day cells — skip weekends */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'4px' }}>
        {Array(offset%5).fill(null).map((_,i) => <div key={`pad-${i}`} />)}
        {allDays.filter(d => {
          const dow = new Date(year,month-1,d).getDay()
          return dow!==0 && dow!==6
        }).map(d => {
          const pnl = pnls[d]
          return (
            <div key={d} style={{
              padding:'6px 4px', borderRadius:'5px', textAlign:'center',
              background: pnl==null ? 'transparent'
                : pnl>0 ? `rgba(34,197,94,${Math.min(pnl/8000,1)*0.35+0.08})`
                : `rgba(239,68,68,${Math.min(Math.abs(pnl)/3000,1)*0.35+0.08})`,
            }}>
              <div style={{ fontSize:'10px', color:'var(--text-muted)' }}>{d}</div>
              {pnl!=null && (
                <div style={{ fontSize:'9px', fontWeight:700, marginTop:'2px',
                  color: pnl>0 ? 'var(--green)' : 'var(--red)' }}>
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

interface MiniCalProps {
  month:number; year:number; label:string; monthKey:string
  selected:boolean; onToggle:()=>void
}
function MiniCal({ month, year, label, selected, onToggle }: MiniCalProps) {
  const pnls    = genDayPnls(month, year)
  const tradePnls = Object.values(pnls).filter(v=>v!==null) as number[]
  const winDays = tradePnls.filter(v=>v>0).length
  const lossDays = tradePnls.filter(v=>v<=0).length
  const totalDays = winDays+lossDays
  const monthPnl  = tradePnls.reduce((s,v)=>s+v,0)

  // Build 5-col grid (Mon–Fri only)
  const firstDow = new Date(year,month-1,1).getDay()
  const offset   = firstDow===0?4:firstDow-1
  const tradingDays = Array.from({length:new Date(year,month,0).getDate()},(_,i)=>i+1)
    .filter(d => { const dow=new Date(year,month-1,d).getDay(); return dow!==0&&dow!==6 })

  const padded = [...Array(offset%5).fill(null), ...tradingDays]

  return (
    <div onClick={onToggle} style={{
      background: selected ? 'rgba(0,176,240,0.08)' : 'var(--bg-secondary)',
      border:`1px solid ${selected?'var(--accent-blue)':'var(--bg-border)'}`,
      borderRadius:'8px', padding:'10px', cursor:'pointer', transition:'all 0.12s',
    }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'5px' }}>
        <span style={{ fontSize:'11px', fontWeight:700,
          color:selected?'var(--accent-blue)':'var(--text)', letterSpacing:'0.06em' }}>
          {label.toUpperCase()}
        </span>
        <span style={{ fontSize:'10px', fontWeight:700, color:monthPnl>=0?'var(--green)':'var(--red)' }}>
          {monthPnl>=0?'+':''}{(monthPnl/1000).toFixed(1)}k
        </span>
      </div>

      {/* Win/loss split bar */}
      {totalDays > 0 && (
        <div style={{ height:'4px', borderRadius:'2px', background:'var(--bg-border)',
          marginBottom:'5px', overflow:'hidden', display:'flex' }}>
          <div style={{ width:`${(winDays/totalDays)*100}%`, height:'100%',
            background:'var(--green)', transition:'width 0.3s' }} />
          <div style={{ width:`${(lossDays/totalDays)*100}%`, height:'100%',
            background:'var(--red)', transition:'width 0.3s' }} />
        </div>
      )}

      {/* Day headers */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'1px', marginBottom:'2px' }}>
        {['M','T','W','T','F'].map((d,i) => (
          <div key={i} style={{ textAlign:'center', fontSize:'7px', color:'var(--text-dim)', fontWeight:600 }}>{d}</div>
        ))}
      </div>

      {/* Day dots */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'2px' }}>
        {padded.map((day,i) => {
          if (!day) return <div key={i} style={{ height:'10px' }} />
          const pnl = pnls[day as number]
          return (
            <div key={i} style={{
              width:'10px', height:'10px', borderRadius:'50%', margin:'0 auto',
              background: pnl==null ? 'transparent' : pnl>0 ? 'var(--green)' : 'var(--red)',
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

export default function ReportsPage() {
  const [fy,            setFy]            = useState('2024-25')
  const [expandedMonth, setExpandedMonth] = useState<string|null>(null)
  const [metricFilter,  setMetricFilter]  = useState('fy')
  const [metricMonth,   setMetricMonth]   = useState('Apr')
  const [metricDate,    setMetricDate]    = useState('')
  const [metricFrom,    setMetricFrom]    = useState('')
  const [metricTo,      setMetricTo]      = useState('')

  const months   = fyMonths(fy)
  const totalPnl = FY_PNLS.reduce((s,x)=>s+x,0)
  const prevPnl  = 702440

  const toggleMonth = (key:string) => setExpandedMonth(p => p===key ? null : key)

  return (
    <div>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'16px' }}>
        <h1 style={{ fontFamily:"'ADLaM Display', serif", fontSize:'22px', fontWeight:400 }}>Reports</h1>
        <div style={{ display:'flex', gap:'10px' }}>
          <select className="staax-select" value={fy} onChange={e=>setFy(e.target.value)} style={{ width:'120px' }}>
            <option value="2024-25">FY 2024–25</option>
            <option value="2023-24">FY 2023–24</option>
          </select>
          <button className="btn btn-ghost" style={{ fontSize:'11px' }}>⬇ CSV</button>
        </div>
      </div>

      {/* Top widgets */}
      <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr', gap:'12px', marginBottom:'20px' }}>
        <div style={{ background:'var(--bg-surface)', border:'1px solid var(--bg-border)', borderRadius:'8px', padding:'16px' }}>
          <div style={{ fontSize:'10px', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'4px' }}>FY {fy} Total P&L</div>
          <div style={{ display:'flex', alignItems:'flex-end', gap:'16px' }}>
            <div>
              <div style={{ fontSize:'28px', fontWeight:700, color:'var(--green)', letterSpacing:'-0.02em' }}>
                ₹{(totalPnl/100000).toFixed(2)}L
              </div>
              <div style={{ fontSize:'11px', color:'var(--green)', marginTop:'2px' }}>
                ▲ {(((totalPnl-prevPnl)/prevPnl)*100).toFixed(1)}% vs prev year
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
        <div style={{ background:'var(--bg-surface)', border:'1px solid var(--bg-border)', borderRadius:'8px', padding:'16px' }}>
          <div style={{ fontSize:'10px', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'4px' }}>March P&L</div>
          <div style={{ fontSize:'24px', fontWeight:700, color:'var(--green)' }}>₹91,500</div>
          <div style={{ fontSize:'11px', color:'var(--green)', marginTop:'4px' }}>▲ 6.3% vs Feb</div>
        </div>
        <div style={{ background:'var(--bg-surface)', border:'1px solid var(--bg-border)', borderRadius:'8px', padding:'16px' }}>
          <div style={{ fontSize:'10px', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'4px' }}>Today P&L</div>
          <div style={{ fontSize:'24px', fontWeight:700, color:'var(--green)' }}>+₹4,320</div>
          <div style={{ fontSize:'11px', color:'var(--text-dim)', marginTop:'4px' }}>2 algos active</div>
        </div>
      </div>

      {/* FY Calendar */}
      <div style={{ background:'var(--bg-surface)', border:'1px solid var(--bg-border)', borderRadius:'8px', padding:'16px', marginBottom:'20px' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'12px' }}>
          <div style={{ fontSize:'11px', fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.08em' }}>
            FY {fy} — Full Year Calendar
          </div>
          <div style={{ display:'flex', gap:'12px', fontSize:'11px', color:'var(--text-dim)' }}>
            <span style={{ display:'flex', alignItems:'center', gap:'4px' }}>
              <span style={{ width:'8px', height:'8px', borderRadius:'50%', background:'var(--green)', display:'inline-block' }} /> Profit
            </span>
            <span style={{ display:'flex', alignItems:'center', gap:'4px' }}>
              <span style={{ width:'8px', height:'8px', borderRadius:'50%', background:'var(--red)', display:'inline-block' }} /> Loss
            </span>
            <span>Click month to expand</span>
          </div>
        </div>

        {/* 6×2 month grid */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:'8px' }}>
          {months.map(m => (
            <div key={m.key}>
              <MiniCal month={m.month} year={m.year} label={m.label}
                monthKey={m.key}
                selected={expandedMonth===m.key}
                onToggle={() => toggleMonth(m.key)} />
              {expandedMonth===m.key && (
                <div style={{ gridColumn:'1 / -1' }}>
                  <MonthDetail month={m.month} year={m.year} label={m.label} />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Expanded month detail — shown below all months */}
        {expandedMonth && (() => {
          const m = months.find(x => x.key === expandedMonth)
          if (!m) return null
          return <MonthDetail month={m.month} year={m.year} label={m.label} />
        })()}
      </div>

      {/* Per-Algo Metrics */}
      <div style={{ background:'var(--bg-surface)', border:'1px solid var(--bg-border)', borderRadius:'8px', padding:'16px', overflowX:'auto' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'12px', flexWrap:'wrap', gap:'10px' }}>
          <div style={{ fontSize:'11px', fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.08em' }}>
            Per-Algo Metrics
          </div>
          <div style={{ display:'flex', gap:'6px', alignItems:'center', flexWrap:'wrap' }}>
            {/* FY selector — always visible */}
            <select className="staax-select" value={fy} onChange={e=>setFy(e.target.value)} style={{ width:'110px', fontSize:'11px' }}>
              <option value="2024-25">FY 2024–25</option>
              <option value="2023-24">FY 2023–24</option>
            </select>
            {/* Filter type toggles */}
            {[['fy','FY'],['month','Month'],['date','Date'],['custom','From–To']].map(([v,l]) => (
              <button key={v} onClick={()=>setMetricFilter(v)} style={{
                padding:'4px 10px', borderRadius:'4px', fontSize:'11px', fontWeight:600,
                cursor:'pointer', border:'none',
                background: metricFilter===v ? 'var(--accent-blue)' : 'var(--bg-secondary)',
                color:       metricFilter===v ? '#000' : 'var(--text-muted)',
              }}>{l}</button>
            ))}
            {/* Conditional inputs */}
            {metricFilter==='month' && (
              <select className="staax-select" value={metricMonth}
                onChange={e=>setMetricMonth(e.target.value)} style={{ width:'100px', fontSize:'11px' }}>
                {MONTHS_FY.map(m => <option key={m}>{m}</option>)}
              </select>
            )}
            {metricFilter==='date' && (
              <input type="date" className="staax-input" value={metricDate}
                onChange={e=>setMetricDate(e.target.value)}
                style={{ width:'140px', fontSize:'11px' }} />
            )}
            {metricFilter==='custom' && (
              <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                <input type="date" className="staax-input" value={metricFrom}
                  onChange={e=>setMetricFrom(e.target.value)}
                  style={{ width:'130px', fontSize:'11px' }} />
                <span style={{ fontSize:'11px', color:'var(--text-dim)' }}>to</span>
                <input type="date" className="staax-input" value={metricTo}
                  onChange={e=>setMetricTo(e.target.value)}
                  style={{ width:'130px', fontSize:'11px' }} />
              </div>
            )}
            <button className="btn btn-ghost" style={{ fontSize:'10px', padding:'4px 10px' }}>⬇ CSV</button>
          </div>
        </div>

        {/* Transposed table */}
        <table className="staax-table">
          <thead>
            <tr>
              <th style={{ minWidth:'130px' }}>Key Metrics</th>
              {ALGO_METRICS.map(a => <th key={a.name}>{a.name}</th>)}
              <th style={{ color:'var(--accent-blue)' }}>Cumulative</th>
            </tr>
          </thead>
          <tbody>
            {METRIC_ROWS.map(row => {
              const cumVal = ALGO_METRICS.reduce((s,a)=>s+(a as any)[row.key],0)
              const isPercent = row.key==='winPct'||row.key==='lossPct'||row.key==='roi'
              const fmt = (n:number) => isPercent ? `${Math.abs(n)}%` : `₹${Math.abs(n).toLocaleString('en-IN')}`
              const cumFmt = isPercent
                ? `${(cumVal/ALGO_METRICS.length).toFixed(1)}%`
                : `₹${Math.abs(cumVal).toLocaleString('en-IN')}`
              return (
                <tr key={row.key}>
                  <td style={{ fontWeight:600, color:'var(--text-muted)', fontSize:'12px' }}>{row.label}</td>
                  {ALGO_METRICS.map(a => {
                    const v = (a as any)[row.key]
                    const color = row.isLoss ? 'var(--red)' : 'var(--green)'
                    return <td key={a.name} style={{ color, fontWeight:600 }}>{fmt(v)}</td>
                  })}
                  <td style={{ color:'var(--accent-blue)', fontWeight:700 }}>{cumFmt}</td>
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
echo "✅ Phase 1C v4 applied!"
echo ""
echo "Frontend will auto-reload at http://localhost:3000"
echo ""
echo "Changes:"
echo "  Smart Grid  — Instrument codes + B/S leg badges on algo card"
echo "  Orders      — Fixed column widths, proper outlined buttons, weekend tabs with auto-show"
echo "  Reports     — Month expand works, win+loss split bar, FY always visible, date picker inputs"
echo ""
echo "Commit when ready:"
echo "  git add . && git commit -m 'Phase 1C v4: Grid leg badges, Orders columns, Reports calendar fixes' && git push origin feature/ui-phase1c"
