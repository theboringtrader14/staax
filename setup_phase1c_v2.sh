#!/bin/bash
# STAAX Phase 1C v2 — UI Corrections
# Run from inside your staax directory: bash setup_phase1c_v2.sh

echo "🚀 Applying Phase 1C corrections..."

# ─── SMART GRID PAGE (Full Redesign) ─────────────────────────────────────────

cat > frontend/src/pages/GridPage.tsx << 'EOF'
import { useState } from 'react'

const DAYS = ['MON','TUE','WED','THU','FRI']
const WEEKENDS = ['SAT','SUN']

// Sample algos (rows)
const ALGOS = [
  { id:'1', name:'AWS-1',  account:'Karthik' },
  { id:'2', name:'TF-BUY', account:'Mom'     },
  { id:'3', name:'S1',     account:'Karthik' },
  { id:'4', name:'MDS-1',  account:'Mom'     },
]

// Grid data: algoId → day → cell
type CellStatus = 'no_trade'|'algo_active'|'order_pending'|'open'|'algo_closed'|'error'
interface GridCell {
  multiplier: number
  status: CellStatus
  practix: boolean
  entry: string
  nextSL?: string
}

const INITIAL_GRID: Record<string, Record<string, GridCell>> = {
  '1': {
    MON: { multiplier:1, status:'open',        practix:true,  entry:'09:16', nextSL:'09:18' },
    TUE: { multiplier:1, status:'algo_closed', practix:false, entry:'09:16', nextSL:'09:18' },
    WED: { multiplier:2, status:'algo_active', practix:true,  entry:'09:16' },
    FRI: { multiplier:1, status:'no_trade',    practix:true,  entry:'09:16' },
  },
  '2': {
    MON: { multiplier:2, status:'algo_active', practix:true,  entry:'09:30' },
    WED: { multiplier:1, status:'order_pending',practix:true, entry:'09:30' },
    THU: { multiplier:2, status:'open',        practix:true,  entry:'09:30' },
  },
  '3': {
    MON: { multiplier:1, status:'no_trade',    practix:true,  entry:'09:20' },
    THU: { multiplier:1, status:'open',        practix:true,  entry:'09:20' },
  },
  '4': {
    TUE: { multiplier:3, status:'error',       practix:true,  entry:'09:30' },
    FRI: { multiplier:1, status:'no_trade',    practix:true,  entry:'09:30' },
  },
}

const STATUS_CFG: Record<CellStatus, { label:string, color:string, bg:string }> = {
  no_trade:      { label:'No Trade',  color:'#6B7280', bg:'rgba(107,114,128,0.12)' },
  algo_active:   { label:'Active',    color:'#00B0F0', bg:'rgba(0,176,240,0.12)'   },
  order_pending: { label:'Pending',   color:'#F59E0B', bg:'rgba(245,158,11,0.12)'  },
  open:          { label:'Open',      color:'#22C55E', bg:'rgba(34,197,94,0.12)'   },
  algo_closed:   { label:'Closed',    color:'#16a34a', bg:'rgba(22,163,74,0.12)'   },
  error:         { label:'Error',     color:'#EF4444', bg:'rgba(239,68,68,0.12)'   },
}

interface EditingCell { algoId:string, day:string }

export default function GridPage() {
  const [grid, setGrid]             = useState(INITIAL_GRID)
  const [showWeekends, setShowWeekends] = useState(false)
  const [editing, setEditing]       = useState<EditingCell|null>(null)
  const [editVal, setEditVal]       = useState('')
  const [dragAlgoId, setDragAlgoId] = useState<string|null>(null)

  const visibleDays = showWeekends ? [...DAYS, ...WEEKENDS] : DAYS

  const updateMultiplier = (algoId:string, day:string, val:number) => {
    if (val < 1) return
    setGrid(g => ({
      ...g,
      [algoId]: { ...g[algoId], [day]: { ...g[algoId][day], multiplier: val } }
    }))
  }

  const removeCell = (algoId:string, day:string) => {
    setGrid(g => {
      const updated = { ...g[algoId] }
      delete updated[day]
      return { ...g, [algoId]: updated }
    })
  }

  const handleDrop = (algoId:string, day:string) => {
    if (!dragAlgoId || dragAlgoId !== algoId) return
    if (grid[algoId]?.[day]) return // already exists
    setGrid(g => ({
      ...g,
      [algoId]: {
        ...g[algoId],
        [day]: { multiplier:1, status:'algo_active', practix:true, entry:'09:16' }
      }
    }))
    setDragAlgoId(null)
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'14px' }}>
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
          <button className="btn btn-primary" style={{ fontSize:'12px' }}>+ New Algo</button>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display:'flex', gap:'14px', marginBottom:'14px', flexWrap:'wrap', padding:'8px 12px', background:'var(--bg-secondary)', borderRadius:'6px', border:'1px solid var(--bg-border)' }}>
        {Object.entries(STATUS_CFG).map(([key, s]) => (
          <div key={key} style={{ display:'flex', alignItems:'center', gap:'5px', fontSize:'11px', color:'var(--text-muted)' }}>
            <span style={{ width:'8px', height:'8px', borderRadius:'50%', background:s.color, display:'inline-block', flexShrink:0 }} />
            {s.label}
          </div>
        ))}
        <div style={{ marginLeft:'auto', fontSize:'11px', color:'var(--text-dim)' }}>
          Drag algo name → day cell to deploy
        </div>
      </div>

      {/* Grid table */}
      <div style={{ overflowX:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', tableLayout:'fixed' }}>
          <thead>
            <tr>
              {/* Algo column header */}
              <th style={{
                width:'160px', padding:'10px 14px', textAlign:'left',
                background:'var(--bg-secondary)', border:'1px solid var(--bg-border)',
                fontSize:'11px', color:'var(--text-muted)', fontWeight:700,
                letterSpacing:'0.08em', textTransform:'uppercase',
              }}>ALGO</th>
              {visibleDays.map(day => (
                <th key={day} style={{
                  padding:'10px 14px', textAlign:'center',
                  background:'var(--bg-secondary)', border:'1px solid var(--bg-border)',
                  fontSize:'11px', color: WEEKENDS.includes(day) ? 'var(--text-dim)' : 'var(--text-muted)',
                  fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase',
                }}>{day}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ALGOS.map(algo => (
              <tr key={algo.id}>
                {/* Algo name cell — draggable */}
                <td
                  draggable
                  onDragStart={() => setDragAlgoId(algo.id)}
                  onDragEnd={() => setDragAlgoId(null)}
                  style={{
                    padding:'10px 14px',
                    background:'var(--bg-secondary)',
                    border:'1px solid var(--bg-border)',
                    cursor:'grab',
                  }}
                >
                  <div style={{ fontWeight:700, fontSize:'13px', color:'var(--accent-blue)' }}>{algo.name}</div>
                  <div style={{ fontSize:'10px', color:'var(--text-muted)', marginTop:'2px' }}>{algo.account}</div>
                </td>

                {/* Day cells */}
                {visibleDays.map(day => {
                  const cell = grid[algo.id]?.[day]
                  const s = cell ? STATUS_CFG[cell.status] : null
                  return (
                    <td
                      key={day}
                      onDragOver={e => e.preventDefault()}
                      onDrop={() => handleDrop(algo.id, day)}
                      style={{
                        padding:'6px',
                        border:'1px solid var(--bg-border)',
                        verticalAlign:'top',
                        minWidth:'120px',
                        background: cell ? 'var(--bg-primary)' : WEEKENDS.includes(day) ? 'rgba(30,32,34,0.5)' : 'var(--bg-primary)',
                      }}
                    >
                      {cell && s ? (
                        <div style={{
                          background:'var(--bg-secondary)',
                          borderLeft:`3px solid ${s.color}`,
                          borderRadius:'5px', padding:'8px',
                          position:'relative',
                        }}>
                          {/* Delete button */}
                          <button
                            onClick={() => removeCell(algo.id, day)}
                            style={{
                              position:'absolute', top:'4px', right:'4px',
                              background:'none', border:'none', cursor:'pointer',
                              color:'var(--text-dim)', fontSize:'12px', lineHeight:1,
                              padding:'2px 4px', borderRadius:'3px',
                            }}
                            onMouseEnter={e => (e.currentTarget.style.color = 'var(--red)')}
                            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-dim)')}
                            title="Remove from this day"
                          >✕</button>

                          {/* Status badge */}
                          <div style={{ marginBottom:'6px' }}>
                            <span style={{
                              fontSize:'9px', fontWeight:700, letterSpacing:'0.05em',
                              color:s.color, background:s.bg,
                              padding:'2px 5px', borderRadius:'3px',
                            }}>{s.label.toUpperCase()}</span>
                          </div>

                          {/* Multiplier — editable */}
                          <div style={{ display:'flex', alignItems:'center', gap:'4px', marginBottom:'4px' }}>
                            <span style={{ fontSize:'10px', color:'var(--text-muted)' }}>M:</span>
                            {editing?.algoId === algo.id && editing?.day === day ? (
                              <input
                                autoFocus
                                type="number" min={1}
                                value={editVal}
                                onChange={e => setEditVal(e.target.value)}
                                onBlur={() => {
                                  updateMultiplier(algo.id, day, parseInt(editVal)||1)
                                  setEditing(null)
                                }}
                                onKeyDown={e => {
                                  if (e.key==='Enter') {
                                    updateMultiplier(algo.id, day, parseInt(editVal)||1)
                                    setEditing(null)
                                  }
                                }}
                                style={{
                                  width:'36px', background:'var(--bg-primary)',
                                  border:'1px solid var(--accent-blue)', borderRadius:'3px',
                                  color:'var(--text)', fontSize:'11px', padding:'1px 4px',
                                  fontFamily:'inherit',
                                }}
                              />
                            ) : (
                              <span
                                onClick={() => { setEditing({algoId:algo.id, day}); setEditVal(String(cell.multiplier)) }}
                                style={{
                                  fontSize:'12px', fontWeight:700, color:'var(--accent-blue)',
                                  cursor:'text', padding:'1px 4px', borderRadius:'3px',
                                  border:'1px solid transparent',
                                }}
                                onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--bg-border)')}
                                onMouseLeave={e => (e.currentTarget.style.borderColor = 'transparent')}
                                title="Click to edit multiplier"
                              >{cell.multiplier}</span>
                            )}
                          </div>

                          {/* Times */}
                          <div style={{ fontSize:'10px', color:'var(--text-muted)' }}>E: {cell.entry}</div>
                          {cell.nextSL && (
                            <div style={{ fontSize:'10px', color:'var(--accent-amber)' }}>N: {cell.nextSL}</div>
                          )}

                          {/* Practix tag */}
                          {cell.practix && (
                            <div style={{ marginTop:'5px' }}>
                              <span style={{
                                fontSize:'8px', fontWeight:700, letterSpacing:'0.06em',
                                color:'var(--accent-amber)', background:'rgba(215,123,18,0.1)',
                                padding:'1px 4px', borderRadius:'2px',
                              }}>PRACTIX</span>
                            </div>
                          )}
                        </div>
                      ) : (
                        /* Empty drop zone */
                        <div style={{
                          minHeight:'60px', border:'1px dashed var(--bg-border)',
                          borderRadius:'5px', display:'flex', alignItems:'center',
                          justifyContent:'center',
                          color:'var(--text-dim)', fontSize:'10px',
                          opacity: dragAlgoId === algo.id ? 0.8 : 0.4,
                          background: dragAlgoId === algo.id ? 'rgba(0,176,240,0.05)' : 'transparent',
                          borderColor: dragAlgoId === algo.id ? 'var(--accent-blue)' : 'var(--bg-border)',
                          transition:'all 0.15s',
                        }}>
                          {dragAlgoId === algo.id ? 'Drop here' : '—'}
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

# ─── ORDERS PAGE (Full Redesign) ──────────────────────────────────────────────

cat > frontend/src/pages/OrdersPage.tsx << 'EOF'
import { useState } from 'react'

const DAYS = ['MON','TUE','WED','THU','FRI']

type LegStatus = 'open'|'closed'|'error'|'pending'
interface Leg {
  id: string
  parentId?: string  // if set, this is a child/journey leg
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
      { id:'L1a', parentId:'L1', journeyLevel:'1.1', status:'closed', symbol:'NIFTY 22500CE 27MAR25', dir:'BUY',  lots:'1 (50)', entryCondition:'Re-entry @ Entry', refPrice:187.0, fillPrice:188.0, fillTime:'10:05:11', ltp:null, slOrig:155, slActual:null, target:280, exitPrice:120, exitTime:'10:15:22', exitReason:'SL', pnl:-3400 },
      { id:'L2', journeyLevel:'1',   status:'open',   symbol:'NIFTY 22500PE 27MAR25', dir:'BUY',  lots:'1 (50)', entryCondition:'ORB Low',  refPrice:143.0, fillPrice:142.5, fillTime:'09:17:32', ltp:118.2, slOrig:110, slActual:110, target:200, pnl:-1215 },
      { id:'L3', journeyLevel:'2',   status:'error',  symbol:'NIFTY 22400CE 27MAR25', dir:'BUY',  lots:'1 (50)', entryCondition:'Direct',   refPrice:null,  fillPrice:null,  fillTime:null,       ltp:null,  slOrig:120, slActual:null, target:220, pnl:0, exitReason:'Order failed' },
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

function LegRow({ leg, hidePnl, isChild }: { leg:Leg, hidePnl:boolean, isChild:boolean }) {
  const st = STATUS_STYLE[leg.status]
  return (
    <tr style={{ background: isChild ? 'rgba(0,176,240,0.03)' : undefined }}>
      <td style={{ paddingLeft: isChild ? '28px' : '12px' }}>
        <span style={{ fontSize:'11px', color: isChild ? 'var(--accent-blue)' : 'var(--text-muted)', fontWeight: isChild ? 600 : 400 }}>
          {isChild ? '↳ ' : ''}{leg.journeyLevel}
        </span>
      </td>
      <td>
        <span className="tag" style={{ color:st.color, background:st.bg, fontSize:'10px' }}>
          {leg.status.toUpperCase()}
        </span>
      </td>
      <td>
        <div style={{ fontSize:'12px', color:'var(--text)' }}>{leg.symbol}</div>
        <div style={{ fontSize:'10px', color: leg.dir==='BUY' ? 'var(--green)' : 'var(--red)', marginTop:'1px', fontWeight:600 }}>{leg.dir}</div>
      </td>
      <td style={{ color:'var(--text-muted)' }}>{leg.lots}</td>
      <td style={{ fontSize:'11px', color:'var(--text-muted)' }}>
        <div>{leg.entryCondition}</div>
        {leg.refPrice && <div style={{ color:'var(--text-dim)', marginTop:'1px' }}>Ref: {leg.refPrice}</div>}
      </td>
      <td style={{ fontWeight:600 }}>{leg.fillPrice ?? '—'}</td>
      <td style={{ fontWeight:600, color: leg.ltp && leg.fillPrice && leg.ltp > leg.fillPrice ? 'var(--green)' : 'var(--red)' }}>
        {leg.ltp ?? '—'}
      </td>
      <td style={{ fontSize:'11px' }}>
        {leg.slActual != null && <div style={{ color:'var(--amber)' }}>A: {leg.slActual}</div>}
        {leg.slOrig != null && <div style={{ color:'var(--text-muted)' }}>O: {leg.slOrig}</div>}
      </td>
      <td style={{ color:'var(--text-muted)' }}>{leg.target ?? '—'}</td>
      <td style={{ fontSize:'11px' }}>
        {leg.exitPrice != null ? (
          <>
            <div style={{ fontWeight:600 }}>{leg.exitPrice}</div>
            {leg.exitTime && <div style={{ fontSize:'10px', color:'var(--text-dim)' }}>{leg.exitTime}</div>}
          </>
        ) : '—'}
      </td>
      <td>
        {leg.exitReason
          ? <span className="tag" style={{ color:'var(--red)', background:'rgba(239,68,68,0.1)', fontSize:'10px' }}>{leg.exitReason}</span>
          : '—'}
      </td>
      <td style={{ fontWeight:700, color: (leg.pnl||0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
        {hidePnl ? '••••' : leg.pnl != null ? `${leg.pnl >= 0 ? '+' : ''}₹${Math.abs(leg.pnl).toLocaleString('en-IN')}` : '—'}
      </td>
    </tr>
  )
}

export default function OrdersPage() {
  const [activeDay, setActiveDay]   = useState('MON')
  const [hidePnl, setHidePnl]       = useState(false)
  const [accountFilter, setAccountFilter] = useState('All')

  const accounts = ['All', ...Array.from(new Set(SAMPLE_ORDERS.map(g => g.account)))]
  const filtered  = accountFilter === 'All' ? SAMPLE_ORDERS : SAMPLE_ORDERS.filter(g => g.account === accountFilter)
  const totalMTM  = filtered.reduce((s,g) => s+g.mtm, 0)

  // Build leg rows with hierarchy
  const buildRows = (legs: Leg[]) => {
    const result: { leg:Leg, isChild:boolean }[] = []
    const parentLegs = legs.filter(l => !l.parentId)
    for (const parent of parentLegs) {
      result.push({ leg:parent, isChild:false })
      const children = legs.filter(l => l.parentId === parent.id)
      for (const child of children) {
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
          {/* Account filter */}
          <select
            className="staax-select"
            style={{ width:'160px' }}
            value={accountFilter}
            onChange={e => setAccountFilter(e.target.value)}
          >
            {accounts.map(a => <option key={a}>{a}</option>)}
          </select>

          <span style={{ fontSize:'12px', color:'var(--text-muted)' }}>MTM:</span>
          <span style={{ fontSize:'16px', fontWeight:700, color: totalMTM >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {hidePnl ? '₹ ••••' : `${totalMTM >= 0 ? '+' : ''}₹${totalMTM.toLocaleString('en-IN')}`}
          </span>
          <button className="btn btn-ghost" style={{ fontSize:'11px' }} onClick={() => setHidePnl(!hidePnl)}>
            {hidePnl ? '👁 Show' : '🙈 Hide'} P&L
          </button>
        </div>
      </div>

      {/* Day tabs */}
      <div style={{ display:'flex', gap:'4px', marginBottom:'18px', borderBottom:'1px solid var(--bg-border)' }}>
        {DAYS.map(d => (
          <button key={d} onClick={() => setActiveDay(d)} style={{
            padding:'8px 16px', fontSize:'12px', fontWeight:600,
            border:'none', cursor:'pointer', borderRadius:'5px 5px 0 0',
            background: activeDay===d ? 'var(--bg-surface)' : 'transparent',
            color: activeDay===d ? 'var(--accent-blue)' : 'var(--text-muted)',
            borderBottom: activeDay===d ? '2px solid var(--accent-blue)' : '2px solid transparent',
          }}>{d}</button>
        ))}
      </div>

      {/* Algo groups */}
      {filtered.map((group, gi) => (
        <div key={gi} style={{ marginBottom:'16px' }}>
          {/* Group header */}
          <div style={{
            background:'var(--bg-secondary)', border:'1px solid var(--bg-border)',
            borderRadius:'7px 7px 0 0', padding:'10px 16px',
            display:'flex', alignItems:'center', gap:'14px', flexWrap:'wrap',
          }}>
            <span style={{ fontWeight:700, fontSize:'14px', color:'var(--accent-blue)' }}>{group.algoName}</span>
            <span style={{ fontSize:'12px', color:'var(--text-muted)', background:'var(--bg-surface)', padding:'2px 8px', borderRadius:'4px' }}>{group.account}</span>
            <span style={{ fontSize:'11px', color:'var(--text-dim)' }}>
              MTM SL: <span style={{ color:'var(--red)' }}>₹{Math.abs(group.mtmSL).toLocaleString('en-IN')}</span>
              &nbsp;·&nbsp;
              MTM TP: <span style={{ color:'var(--green)' }}>₹{group.mtmTP.toLocaleString('en-IN')}</span>
            </span>

            {/* Action buttons */}
            <div style={{ marginLeft:'auto', display:'flex', gap:'6px', alignItems:'center' }}>
              {[
                { label:'RUN',  title:'Execute inactive algo',                          color:'var(--accent-blue)' },
                { label:'RE',   title:'Retry errored order',                            color:'var(--amber)'       },
                { label:'SQ',   title:'Square off open positions (pending untouched)',  color:'var(--green)'       },
                { label:'T',    title:'Square off all + cancel pending + terminate',    color:'var(--red)'         },
              ].map(btn => (
                <button key={btn.label} title={btn.title} style={{
                  padding:'3px 10px', fontSize:'11px', fontWeight:700,
                  border:`1px solid ${btn.color}22`,
                  background:`${btn.color}11`,
                  color:btn.color,
                  borderRadius:'4px', cursor:'pointer',
                }}>{btn.label}</button>
              ))}
              <span style={{
                fontWeight:700, fontSize:'15px', marginLeft:'8px',
                color: group.mtm >= 0 ? 'var(--green)' : 'var(--red)',
              }}>
                {hidePnl ? '₹••••' : `${group.mtm >= 0 ? '+' : ''}₹${group.mtm.toLocaleString('en-IN')}`}
              </span>
            </div>
          </div>

          {/* Legs table */}
          <div style={{ border:'1px solid var(--bg-border)', borderTop:'none', borderRadius:'0 0 7px 7px', overflow:'hidden' }}>
            <table className="staax-table">
              <thead>
                <tr>
                  {['#','Status','Symbol','Lots','Entry / Ref Price','Fill','LTP','SL (A/O)','Target','Exit','Reason','P&L'].map(h => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {buildRows(group.legs).map(({ leg, isChild }) => (
                  <LegRow key={leg.id} leg={leg} hidePnl={hidePnl} isChild={isChild} />
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

# ─── ALGO CONFIG PAGE (Full Redesign — Per-Leg Architecture) ─────────────────

cat > frontend/src/pages/AlgoPage.tsx << 'EOF'
import { useState } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────
interface LegConfig {
  id: string
  legNumber: number
  direction: string
  instrument: string
  underlying: string
  expiry: string
  strikeMode: string    // 'leg' | 'premium' | 'straddle_premium'
  strikeType: string    // 'atm' | 'itm10...' | 'otm10...'
  premiumValue: string
  lots: string
  // Per-leg features enabled
  hasSL: boolean; slType: string; slValue: string
  hasTP: boolean; tpType: string; tpValue: string
  hasTSL: boolean; tslX: string; tslY: string; tslUnit: string
  hasWT: boolean; wtDirection: string; wtValue: string; wtUnit: string
  hasReentry: boolean; reentryMode: string; reentryTrigger: string; reentryCount: string
  hasJourney: boolean
}

const newLeg = (n: number): LegConfig => ({
  id: `leg-${Date.now()}-${n}`,
  legNumber: n,
  direction:'BUY', instrument:'CE',
  underlying:'NIFTY', expiry:'Current Week',
  strikeMode:'leg', strikeType:'atm',
  premiumValue:'', lots:'1',
  hasSL:false, slType:'pts_instrument', slValue:'',
  hasTP:false, tpType:'pts_instrument', tpValue:'',
  hasTSL:false, tslX:'', tslY:'', tslUnit:'pts',
  hasWT:false, wtDirection:'up', wtValue:'', wtUnit:'pts',
  hasReentry:false, reentryMode:'at_entry_price', reentryTrigger:'sl', reentryCount:'1',
  hasJourney:false,
})

// ── Strike options in correct order ──────────────────────────────────────────
const STRIKE_OPTIONS = [
  ...Array.from({length:10},(_,i)=>`ITM${10-i}`),  // ITM10 → ITM1
  'ATM',
  ...Array.from({length:10},(_,i)=>`OTM${i+1}`),  // OTM1 → OTM10
]

// ── Small helper components ───────────────────────────────────────────────────
function Field({ label, children, span=1 }: { label:string, children:React.ReactNode, span?:number }) {
  return (
    <div style={{ gridColumn:`span ${span}`, display:'flex', flexDirection:'column', gap:'4px' }}>
      <label style={{ fontSize:'10px', color:'var(--text-muted)', fontWeight:700, letterSpacing:'0.05em', textTransform:'uppercase' }}>
        {label}
      </label>
      {children}
    </div>
  )
}

function SectionHeader({ title, tag }: { title:string, tag?:string }) {
  return (
    <div style={{
      display:'flex', alignItems:'center', gap:'10px',
      fontSize:'11px', fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase',
      color:'var(--accent-blue)', marginBottom:'10px',
      paddingBottom:'6px', borderBottom:'1px solid var(--bg-border)',
    }}>
      {title}
      {tag && <span style={{
        fontSize:'9px', padding:'2px 6px', borderRadius:'3px',
        background:'rgba(0,176,240,0.1)', color:'var(--accent-blue)',
        letterSpacing:'0.05em',
      }}>{tag}</span>}
    </div>
  )
}

type ChipKey = 'hasSL'|'hasTP'|'hasTSL'|'hasWT'|'hasReentry'
const CHIPS: { key: ChipKey, label:string }[] = [
  { key:'hasSL',      label:'Stop Loss'    },
  { key:'hasTP',      label:'Target'       },
  { key:'hasTSL',     label:'Trailing SL'  },
  { key:'hasWT',      label:'Wait & Trade' },
  { key:'hasReentry', label:'Re-entry'     },
]

// ── Leg Panel ─────────────────────────────────────────────────────────────────
function LegPanel({
  leg, onUpdate, onRemove, canRemove
}: {
  leg: LegConfig
  onUpdate: (id:string, updates:Partial<LegConfig>) => void
  onRemove: (id:string) => void
  canRemove: boolean
}) {
  const u = (k: keyof LegConfig, v: any) => onUpdate(leg.id, { [k]: v })

  return (
    <div style={{
      background:'var(--bg-secondary)', border:'1px solid var(--bg-border)',
      borderRadius:'8px', padding:'16px', marginBottom:'12px',
    }}>
      {/* Leg header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'14px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
          <span style={{ fontWeight:700, fontSize:'14px', color:'var(--accent-blue)' }}>
            Leg {leg.legNumber}
          </span>
          <span className="tag" style={{
            background: leg.direction==='BUY' ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
            color: leg.direction==='BUY' ? 'var(--green)' : 'var(--red)',
            fontSize:'10px',
          }}>{leg.direction}</span>
          <span className="tag" style={{ background:'rgba(0,176,240,0.1)', color:'var(--accent-blue)', fontSize:'10px' }}>
            {leg.instrument}
          </span>
          <span style={{ fontSize:'11px', color:'var(--text-muted)' }}>{leg.underlying} · {leg.expiry}</span>
        </div>
        {canRemove && (
          <button onClick={() => onRemove(leg.id)} style={{
            background:'none', border:'1px solid rgba(239,68,68,0.3)',
            color:'var(--red)', borderRadius:'4px', padding:'3px 8px',
            fontSize:'11px', cursor:'pointer',
          }}>Remove</button>
        )}
      </div>

      {/* Instrument fields */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:'8px', marginBottom:'14px' }}>
        <Field label="Direction">
          <select className="staax-select" value={leg.direction} onChange={e => u('direction',e.target.value)}>
            <option>BUY</option><option>SELL</option>
          </select>
        </Field>
        <Field label="Instrument">
          <select className="staax-select" value={leg.instrument} onChange={e => u('instrument',e.target.value)}>
            <option>CE</option><option>PE</option><option>FU</option>
          </select>
        </Field>
        <Field label="Underlying">
          <select className="staax-select" value={leg.underlying} onChange={e => u('underlying',e.target.value)}>
            {['NIFTY','BANKNIFTY','SENSEX','MIDCAPNIFTY','FINNIFTY'].map(x => <option key={x}>{x}</option>)}
          </select>
        </Field>
        <Field label="Expiry">
          <select className="staax-select" value={leg.expiry} onChange={e => u('expiry',e.target.value)}>
            <option>Current Week</option><option>Next Week</option>
            <option>Monthly Current</option><option>Monthly Next</option>
          </select>
        </Field>

        {/* Strike selection — hierarchy */}
        <Field label="Strike Mode">
          <select className="staax-select" value={leg.strikeMode} onChange={e => u('strikeMode',e.target.value)}>
            <option value="leg">By Strike (ITM/ATM/OTM)</option>
            <option value="premium">By Premium</option>
            <option value="straddle_premium">By Straddle Premium</option>
          </select>
        </Field>
        {leg.strikeMode === 'leg' && (
          <Field label="Strike">
            <select className="staax-select" value={leg.strikeType} onChange={e => u('strikeType',e.target.value)}>
              {STRIKE_OPTIONS.map(s => <option key={s} value={s.toLowerCase()}>{s}</option>)}
            </select>
          </Field>
        )}
        {(leg.strikeMode === 'premium' || leg.strikeMode === 'straddle_premium') && (
          <Field label={leg.strikeMode === 'premium' ? 'Target Premium (₹)' : 'Straddle Premium (₹)'}>
            <input className="staax-input" type="number" placeholder="e.g. 150"
              value={leg.premiumValue} onChange={e => u('premiumValue',e.target.value)} />
          </Field>
        )}

        <Field label="Lots">
          <input className="staax-input" type="number" min={1}
            value={leg.lots} onChange={e => u('lots',e.target.value)} />
        </Field>
      </div>

      {/* Feature chips */}
      <div style={{ marginBottom:'12px' }}>
        <div style={{ fontSize:'10px', color:'var(--text-muted)', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'8px' }}>
          Per-Leg Features
        </div>
        <div style={{ display:'flex', gap:'6px', flexWrap:'wrap' }}>
          {CHIPS.map(chip => (
            <button
              key={chip.key}
              onClick={() => u(chip.key, !leg[chip.key])}
              style={{
                padding:'5px 12px', borderRadius:'16px', fontSize:'11px',
                fontWeight:600, cursor:'pointer', border:'none',
                background: leg[chip.key] ? 'var(--accent-blue)' : 'var(--bg-surface)',
                color: leg[chip.key] ? '#000' : 'var(--text-muted)',
                transition:'all 0.12s',
              }}
            >{chip.label}</button>
          ))}
        </div>
      </div>

      {/* Expanded sections based on chips */}
      <div style={{ display:'flex', flexDirection:'column', gap:'10px' }}>

        {/* SL */}
        {leg.hasSL && (
          <div style={{ background:'var(--bg-primary)', borderRadius:'6px', padding:'12px' }}>
            <div style={{ fontSize:'10px', color:'var(--amber)', fontWeight:700, marginBottom:'8px', textTransform:'uppercase', letterSpacing:'0.05em' }}>Stop Loss</div>
            <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:'8px' }}>
              <Field label="Type">
                <select className="staax-select" value={leg.slType} onChange={e => u('slType',e.target.value)}>
                  <option value="pts_instrument">Points (Instrument)</option>
                  <option value="pct_instrument">% (Instrument)</option>
                  <option value="pts_underlying">Points (Underlying)</option>
                  <option value="pct_underlying">% (Underlying)</option>
                </select>
              </Field>
              <Field label="Value">
                <input className="staax-input" type="number" placeholder="e.g. 30"
                  value={leg.slValue} onChange={e => u('slValue',e.target.value)} />
              </Field>
            </div>
          </div>
        )}

        {/* TP */}
        {leg.hasTP && (
          <div style={{ background:'var(--bg-primary)', borderRadius:'6px', padding:'12px' }}>
            <div style={{ fontSize:'10px', color:'var(--green)', fontWeight:700, marginBottom:'8px', textTransform:'uppercase', letterSpacing:'0.05em' }}>Target (TP)</div>
            <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:'8px' }}>
              <Field label="Type">
                <select className="staax-select" value={leg.tpType} onChange={e => u('tpType',e.target.value)}>
                  <option value="pts_instrument">Points (Instrument)</option>
                  <option value="pct_instrument">% (Instrument)</option>
                  <option value="pts_underlying">Points (Underlying)</option>
                  <option value="pct_underlying">% (Underlying)</option>
                </select>
              </Field>
              <Field label="Value">
                <input className="staax-input" type="number" placeholder="e.g. 60"
                  value={leg.tpValue} onChange={e => u('tpValue',e.target.value)} />
              </Field>
            </div>
          </div>
        )}

        {/* TSL */}
        {leg.hasTSL && (
          <div style={{ background:'var(--bg-primary)', borderRadius:'6px', padding:'12px' }}>
            <div style={{ fontSize:'10px', color:'var(--accent-blue)', fontWeight:700, marginBottom:'8px', textTransform:'uppercase', letterSpacing:'0.05em' }}>Trailing Stop Loss</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'8px' }}>
              <Field label="For every X">
                <input className="staax-input" type="number" placeholder="e.g. 5"
                  value={leg.tslX} onChange={e => u('tslX',e.target.value)} />
              </Field>
              <Field label="Move SL by Y">
                <input className="staax-input" type="number" placeholder="e.g. 3"
                  value={leg.tslY} onChange={e => u('tslY',e.target.value)} />
              </Field>
              <Field label="Unit">
                <select className="staax-select" value={leg.tslUnit} onChange={e => u('tslUnit',e.target.value)}>
                  <option value="pts">Points</option>
                  <option value="pct">Percent (%)</option>
                </select>
              </Field>
            </div>
          </div>
        )}

        {/* W&T */}
        {leg.hasWT && (
          <div style={{ background:'var(--bg-primary)', borderRadius:'6px', padding:'12px' }}>
            <div style={{ fontSize:'10px', color:'var(--text-muted)', fontWeight:700, marginBottom:'8px', textTransform:'uppercase', letterSpacing:'0.05em' }}>Wait & Trade</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'8px' }}>
              <Field label="Direction">
                <select className="staax-select" value={leg.wtDirection} onChange={e => u('wtDirection',e.target.value)}>
                  <option value="up">Up</option><option value="down">Down</option>
                </select>
              </Field>
              <Field label="Value">
                <input className="staax-input" type="number" placeholder="e.g. 10"
                  value={leg.wtValue} onChange={e => u('wtValue',e.target.value)} />
              </Field>
              <Field label="Unit">
                <select className="staax-select" value={leg.wtUnit} onChange={e => u('wtUnit',e.target.value)}>
                  <option value="pts">Points</option>
                  <option value="pct">Percent (%)</option>
                </select>
              </Field>
            </div>
          </div>
        )}

        {/* Re-entry */}
        {leg.hasReentry && (
          <div style={{ background:'var(--bg-primary)', borderRadius:'6px', padding:'12px' }}>
            <div style={{ fontSize:'10px', color:'var(--text-muted)', fontWeight:700, marginBottom:'8px', textTransform:'uppercase', letterSpacing:'0.05em' }}>Re-entry</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'8px', marginBottom:'10px' }}>
              <Field label="Mode">
                <select className="staax-select" value={leg.reentryMode} onChange={e => u('reentryMode',e.target.value)}>
                  <option value="at_entry_price">At Entry Price</option>
                  <option value="immediate">Immediate</option>
                  <option value="at_cost">At Cost</option>
                </select>
              </Field>
              <Field label="Trigger On">
                <select className="staax-select" value={leg.reentryTrigger} onChange={e => u('reentryTrigger',e.target.value)}>
                  <option value="sl">SL Hit</option>
                  <option value="tp">TP Hit</option>
                  <option value="any">Any Exit</option>
                </select>
              </Field>
              <Field label="Max Count (per day)">
                <select className="staax-select" value={leg.reentryCount} onChange={e => u('reentryCount',e.target.value)}>
                  {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </Field>
            </div>
            {/* Journey toggle */}
            <label style={{ display:'flex', alignItems:'center', gap:'8px', cursor:'pointer', fontSize:'12px' }}>
              <input type="checkbox" checked={leg.hasJourney}
                onChange={e => u('hasJourney', e.target.checked)}
                style={{ accentColor:'var(--accent-blue)' }} />
              <span style={{ color:'var(--text-muted)' }}>Configure Journey (per re-entry override rules)</span>
            </label>
            {leg.hasJourney && (
              <div style={{
                marginTop:'10px', background:'rgba(0,176,240,0.05)',
                border:'1px solid rgba(0,176,240,0.15)', borderRadius:'6px', padding:'12px',
              }}>
                <div style={{ fontSize:'11px', color:'var(--accent-blue)', fontWeight:700, marginBottom:'8px' }}>
                  Journey — Leg {leg.legNumber}.1 overrides
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'8px' }}>
                  <Field label="SL Override"><input className="staax-input" type="number" placeholder="Inherit" /></Field>
                  <Field label="TP Override"><input className="staax-input" type="number" placeholder="Inherit" /></Field>
                  <Field label="TSL X Override"><input className="staax-input" type="number" placeholder="Inherit" /></Field>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function AlgoPage() {
  const [legs, setLegs] = useState<LegConfig[]>([newLeg(1)])
  const [saved, setSaved] = useState(false)
  const [stratMode, setStratMode] = useState('intraday')
  const [entryType, setEntryType] = useState('orb')
  const [algoName, setAlgoName] = useState('')
  const [saveError, setSaveError] = useState('')

  const addLeg = () => setLegs(l => [...l, newLeg(l.length + 1)])

  const updateLeg = (id:string, updates:Partial<LegConfig>) => {
    setLegs(l => l.map(leg => leg.id === id ? { ...leg, ...updates } : leg))
  }

  const removeLeg = (id:string) => {
    setLegs(l => {
      const filtered = l.filter(leg => leg.id !== id)
      return filtered.map((leg,i) => ({ ...leg, legNumber: i+1 }))
    })
  }

  const handleSave = () => {
    if (!algoName.trim()) { setSaveError('Algo name is required'); return }
    setSaveError('')
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
    // TODO: POST to /api/v1/algos/
  }

  return (
    <div style={{ maxWidth:'900px' }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'20px' }}>
        <div>
          <h1 style={{ fontFamily:"'ADLaM Display', serif", fontSize:'22px', fontWeight:400 }}>Algo Configuration</h1>
          <p style={{ fontSize:'12px', color:'var(--text-muted)', marginTop:'3px' }}>Configure strategy · per-leg risk · re-entry rules</p>
        </div>
        <div style={{ display:'flex', gap:'10px', alignItems:'center' }}>
          {saved && <span style={{ fontSize:'12px', color:'var(--green)', fontWeight:600 }}>✅ Algo saved!</span>}
          {saveError && <span style={{ fontSize:'12px', color:'var(--red)' }}>{saveError}</span>}
          <button className="btn btn-ghost">Cancel</button>
          <button className="btn btn-primary" onClick={handleSave}>Save Algo</button>
        </div>
      </div>

      {/* ── ALGO LEVEL ─────────────────────────────────────────────────────── */}
      <div style={{
        background:'var(--bg-surface)', border:'1px solid var(--bg-border)',
        borderRadius:'8px', padding:'16px', marginBottom:'20px',
      }}>
        <SectionHeader title="Identity & Strategy" tag="ALGO LEVEL" />
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:'10px', marginBottom:'14px' }}>
          <Field label="Algo Name" span={1}>
            <input className="staax-input" placeholder="e.g. AWS-1"
              value={algoName} onChange={e => setAlgoName(e.target.value)} />
          </Field>
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
              <option>MARKET</option><option>LIMIT</option>
            </select>
          </Field>
          <Field label="Base Lot Multiplier">
            <input className="staax-input" type="number" defaultValue={1} min={1} />
          </Field>
          <Field label="Mode">
            <select className="staax-select">
              <option>PRACTIX (Paper)</option>
              <option>Live</option>
            </select>
          </Field>
        </div>

        <SectionHeader title="Entry Type & Timing" tag="ALGO LEVEL" />
        <div style={{ display:'flex', gap:'8px', marginBottom:'12px', flexWrap:'wrap' }}>
          {[['direct','Direct'],['orb','ORB'],['wt','W&T'],['orb_wt','ORB + W&T']].map(([v,l]) => (
            <button key={v} onClick={() => setEntryType(v)} style={{
              padding:'6px 14px', borderRadius:'5px', fontSize:'12px',
              fontWeight:600, cursor:'pointer', border:'none',
              background: entryType===v ? 'var(--accent-blue)' : 'var(--bg-secondary)',
              color: entryType===v ? '#000' : 'var(--text-muted)',
            }}>{l}</button>
          ))}
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:'10px', marginBottom:'14px' }}>
          <Field label="Entry Time (E:)">
            <input className="staax-input" type="time" defaultValue="09:16" />
          </Field>
          {stratMode !== 'intraday'
            ? <Field label="Next Day SL Check (N:)"><input className="staax-input" type="time" defaultValue="09:18" /></Field>
            : <Field label="Auto Exit Time"><input className="staax-input" type="time" defaultValue="15:10" /></Field>
          }
          {(entryType==='orb'||entryType==='orb_wt') && (
            <Field label="ORB Window End"><input className="staax-input" type="time" defaultValue="11:16" /></Field>
          )}
        </div>

        <SectionHeader title="MTM Controls" tag="ALGO LEVEL" />
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:'10px', marginBottom:'14px' }}>
          <Field label="MTM SL"><input className="staax-input" type="number" placeholder="e.g. 5000" /></Field>
          <Field label="MTM TP"><input className="staax-input" type="number" placeholder="e.g. 10000" /></Field>
          <Field label="Unit">
            <select className="staax-select">
              <option>Amount (₹)</option>
              <option>Percent (%)</option>
            </select>
          </Field>
        </div>

        <SectionHeader title="Order Delays & Error Settings" tag="ALGO LEVEL" />
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:'10px', marginBottom:'10px' }}>
          <Field label="Entry Delay (secs)"><input className="staax-input" type="number" defaultValue={0} min={0} /></Field>
          <Field label="Exit Delay (secs)"><input className="staax-input" type="number" defaultValue={0} min={0} /></Field>
        </div>
        <div style={{ display:'flex', gap:'16px' }}>
          {['Exit all on Margin Error','Exit all on Entry Failure'].map(l => (
            <label key={l} style={{ display:'flex', alignItems:'center', gap:'7px', cursor:'pointer', fontSize:'12px' }}>
              <input type="checkbox" defaultChecked style={{ accentColor:'var(--accent-blue)' }} />
              <span style={{ color:'var(--text-muted)' }}>{l}</span>
            </label>
          ))}
        </div>
      </div>

      {/* ── PER-LEG CONFIG ─────────────────────────────────────────────────── */}
      <div style={{
        fontSize:'11px', fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase',
        color:'var(--text-muted)', marginBottom:'12px',
        display:'flex', alignItems:'center', gap:'10px',
      }}>
        <span>Leg Configuration</span>
        <span style={{ fontSize:'9px', padding:'2px 6px', borderRadius:'3px', background:'rgba(34,197,94,0.1)', color:'var(--green)' }}>
          PER LEG
        </span>
        <span style={{ fontSize:'11px', color:'var(--text-dim)', fontWeight:400, textTransform:'none', letterSpacing:0 }}>
          — SL, TP, TSL, W&T, Re-entry are configured per leg
        </span>
      </div>

      {legs.map(leg => (
        <LegPanel key={leg.id} leg={leg} onUpdate={updateLeg} onRemove={removeLeg} canRemove={legs.length > 1} />
      ))}

      <button className="btn btn-ghost" style={{ width:'100%', fontSize:'12px', marginBottom:'8px' }} onClick={addLeg}>
        + Add Leg
      </button>
    </div>
  )
}
EOF

# ─── REPORTS PAGE (Month/Year Picker + Hide Weekends) ────────────────────────

cat > frontend/src/pages/ReportsPage.tsx << 'EOF'
import { useState } from 'react'
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
  { name:'AWS-1',  totalPnl:48320, avgDay:1250, maxProfit:8400, maxLoss:-3200, winPct:68, lossPct:32, mdd:-9800,  roi:9.7 },
  { name:'TF-BUY', totalPnl:22180, avgDay:820,  maxProfit:6200, maxLoss:-2100, winPct:61, lossPct:39, mdd:-6400,  roi:7.4 },
  { name:'S1',     totalPnl:15600, avgDay:610,  maxProfit:4100, maxLoss:-1800, winPct:55, lossPct:45, mdd:-4200,  roi:5.2 },
  { name:'MDS-1',  totalPnl:5400,  avgDay:280,  maxProfit:2200, maxLoss:-900,  winPct:52, lossPct:48, mdd:-2100,  roi:3.6 },
]

// Generate calendar for any month/year
function buildCalendar(month: number, year: number) {
  const daysInMonth = new Date(year, month, 0).getDate()
  const firstDay = new Date(year, month - 1, 1).getDay() // 0=Sun
  // Shift so Mon=0
  const startOffset = (firstDay === 0 ? 6 : firstDay - 1)
  return { daysInMonth, startOffset }
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// Sample P&L data by day
const sampleDayPnl = (day:number, month:number): number|null => {
  const seed = (day * 37 + month * 13) % 100
  if (seed > 85) return null // weekend / holiday
  return seed > 45 ? Math.floor((seed - 45) * 180) : -Math.floor((45 - seed) * 90)
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
  const now = new Date()
  const [calMonth, setCalMonth] = useState(now.getMonth() + 1)
  const [calYear,  setCalYear]  = useState(now.getFullYear())
  const [hideWeekends, setHideWeekends] = useState(true)

  const { daysInMonth, startOffset } = buildCalendar(calMonth, calYear)
  const totalPnl = 91500
  const margin   = 500000
  const roi      = ((totalPnl/margin)*100).toFixed(1)

  const prevMonth = () => { if (calMonth===1) { setCalMonth(12); setCalYear(y=>y-1) } else setCalMonth(m=>m-1) }
  const nextMonth = () => { if (calMonth===12) { setCalMonth(1); setCalYear(y=>y+1) } else setCalMonth(m=>m+1) }

  // Build calendar grid
  const days: { day:number|null, pnl:number|null, isWeekend:boolean }[] = []
  for (let i = 0; i < startOffset; i++) days.push({ day:null, pnl:null, isWeekend:false })
  for (let d = 1; d <= daysInMonth; d++) {
    const dayOfWeek = (startOffset + d - 1) % 7  // 0=Mon, 5=Sat, 6=Sun
    const isWeekend = dayOfWeek === 5 || dayOfWeek === 6
    days.push({ day:d, pnl: isWeekend ? null : sampleDayPnl(d, calMonth), isWeekend })
  }

  const visibleDayHeaders = hideWeekends ? ['Mon','Tue','Wed','Thu','Fri'] : ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
  const cols = hideWeekends ? 5 : 7

  // Filter days for display
  const displayDays = hideWeekends
    ? days.filter((_,i) => { const col = i % 7; return col < 5 }) // rough filter
    : days

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
          <button className="btn btn-ghost" style={{ fontSize:'11px' }}>⬇ CSV</button>
        </div>
      </div>

      {/* Summary stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5, 1fr)', gap:'12px', marginBottom:'20px' }}>
        {[
          { label:'FY Total P&L',  value:`₹${totalPnl.toLocaleString('en-IN')}`, color:'var(--green)'       },
          { label:'ROI vs Margin', value:`${roi}%`,                               color:'var(--accent-blue)' },
          { label:'Daily Avg',     value:'₹1,820',                                color:'var(--text)'        },
          { label:'Best Day',      value:'₹8,400',                                color:'var(--green)'       },
          { label:'Worst Day',     value:'-₹3,200',                               color:'var(--red)'         },
        ].map(s => (
          <div key={s.label} style={{
            background:'var(--bg-surface)', border:'1px solid var(--bg-border)',
            borderRadius:'7px', padding:'14px', textAlign:'center',
          }}>
            <div style={{ fontSize:'10px', color:'var(--text-muted)', marginBottom:'6px', textTransform:'uppercase', letterSpacing:'0.05em' }}>{s.label}</div>
            <div style={{ fontWeight:700, fontSize:'17px', color:s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Equity curve */}
      <div style={{ background:'var(--bg-surface)', border:'1px solid var(--bg-border)', borderRadius:'8px', padding:'16px', marginBottom:'20px' }}>
        <div style={{ fontSize:'11px', fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:'14px' }}>
          Equity Curve — FY 2024–25
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={CUMULATIVE}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="month" tick={{ fill:'#9CA3AF', fontSize:11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill:'#9CA3AF', fontSize:11 }} axisLine={false} tickLine={false}
              tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} />
            <Tooltip content={<CustomTooltip />} />
            <Line type="monotone" dataKey="cumulative" stroke="#00B0F0" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Per-algo metrics */}
      <div style={{ background:'var(--bg-surface)', border:'1px solid var(--bg-border)', borderRadius:'8px', padding:'16px', marginBottom:'20px', overflow:'auto' }}>
        <div style={{ fontSize:'11px', fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:'12px' }}>
          Per-Algo Metrics
        </div>
        <table className="staax-table">
          <thead>
            <tr>
              {['Algo','Total P&L','Avg/Day','Best Day','Worst Day','Win %','Loss %','Max DD','ROI'].map(h => <th key={h}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {ALGO_METRICS.map((a,i) => (
              <tr key={i}>
                <td style={{ fontWeight:700, color:'var(--accent-blue)' }}>{a.name}</td>
                <td style={{ color:'var(--green)', fontWeight:600 }}>₹{a.totalPnl.toLocaleString('en-IN')}</td>
                <td>₹{a.avgDay.toLocaleString('en-IN')}</td>
                <td style={{ color:'var(--green)' }}>₹{a.maxProfit.toLocaleString('en-IN')}</td>
                <td style={{ color:'var(--red)' }}>-₹{Math.abs(a.maxLoss).toLocaleString('en-IN')}</td>
                <td style={{ color:'var(--green)' }}>{a.winPct}%</td>
                <td style={{ color:'var(--red)' }}>{a.lossPct}%</td>
                <td style={{ color:'var(--amber)' }}>-₹{Math.abs(a.mdd).toLocaleString('en-IN')}</td>
                <td style={{ color:'var(--accent-blue)', fontWeight:600 }}>{a.roi}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Trade Calendar */}
      <div style={{ background:'var(--bg-surface)', border:'1px solid var(--bg-border)', borderRadius:'8px', padding:'16px' }}>
        {/* Calendar header */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'14px' }}>
          <div style={{ fontSize:'11px', fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.08em' }}>
            Trade Calendar
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
            <label style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'11px', color:'var(--text-muted)', cursor:'pointer' }}>
              <input type="checkbox" checked={hideWeekends} onChange={e => setHideWeekends(e.target.checked)}
                style={{ accentColor:'var(--accent-blue)' }} />
              Hide Weekends
            </label>
            <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
              <button onClick={prevMonth} className="btn btn-ghost" style={{ padding:'4px 8px', fontSize:'12px' }}>‹</button>
              <span style={{ fontSize:'13px', fontWeight:600, minWidth:'110px', textAlign:'center' }}>
                {MONTHS[calMonth-1]} {calYear}
              </span>
              <button onClick={nextMonth} className="btn btn-ghost" style={{ padding:'4px 8px', fontSize:'12px' }}>›</button>
            </div>
          </div>
        </div>

        {/* Day headers */}
        <div style={{ display:'grid', gridTemplateColumns:`repeat(7, 1fr)`, gap:'3px', marginBottom:'3px' }}>
          {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => (
            <div key={d} style={{
              textAlign:'center', fontSize:'10px', color:'var(--text-dim)',
              padding:'4px 0', fontWeight:600, letterSpacing:'0.05em',
              display: hideWeekends && (d==='Sat'||d==='Sun') ? 'none' : 'block',
            }}>{d}</div>
          ))}
        </div>

        {/* Calendar cells */}
        <div style={{ display:'grid', gridTemplateColumns:`repeat(7, 1fr)`, gap:'3px' }}>
          {days.map((d, i) => {
            const colInWeek = i % 7  // 0=Mon … 6=Sun
            const isWeekendCol = colInWeek >= 5
            if (hideWeekends && isWeekendCol) return null

            if (!d.day) return <div key={i} style={{ display: hideWeekends && isWeekendCol ? 'none' : 'block' }} />

            return (
              <div key={i} style={{
                padding:'7px 5px', borderRadius:'5px', textAlign:'center',
                background: d.isWeekend ? 'var(--bg-secondary)'
                  : d.pnl == null ? 'var(--bg-secondary)'
                  : d.pnl > 0 ? `rgba(34,197,94,${Math.min(d.pnl/8000,1)*0.35+0.07})`
                  : `rgba(239,68,68,${Math.min(Math.abs(d.pnl)/3000,1)*0.35+0.07})`,
                cursor: d.pnl != null ? 'pointer' : 'default',
                display: hideWeekends && isWeekendCol ? 'none' : 'block',
              }}>
                <div style={{ fontSize:'10px', color:'var(--text-muted)', marginBottom:'2px' }}>{d.day}</div>
                {d.pnl != null && !d.isWeekend && (
                  <div style={{ fontSize:'9px', fontWeight:700, color: d.pnl > 0 ? 'var(--green)' : 'var(--red)' }}>
                    {d.pnl > 0 ? '+' : ''}{(d.pnl/1000).toFixed(1)}k
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
EOF

# ─── ACCOUNTS PAGE (Working Margin + Save Confirmation) ──────────────────────

cat > frontend/src/pages/AccountsPage.tsx << 'EOF'
import { useState } from 'react'

interface Account {
  id: string
  name: string
  broker: string
  type: string
  status: string
  margin: number
  pnl: number
  token: string
  color: string
  globalSL: number
  globalTP: number
}

const INIT_ACCOUNTS: Account[] = [
  { id:'1', name:'Karthik', broker:'Zerodha',  type:'F&O', status:'active', margin:500000, pnl:84320,  token:'active',  color:'#00B0F0', globalSL:10000, globalTP:25000 },
  { id:'2', name:'Mom',     broker:'Angel One',type:'F&O', status:'active', margin:300000, pnl:-12450, token:'active',  color:'#22C55E', globalSL:8000,  globalTP:15000 },
  { id:'3', name:'Wife',    broker:'Angel One',type:'MCX', status:'pending', margin:150000, pnl:0,     token:'pending', color:'#D77B12', globalSL:5000,  globalTP:10000 },
]

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>(INIT_ACCOUNTS)
  const [editMargin, setEditMargin] = useState<Record<string,string>>({})
  const [editSL, setEditSL]         = useState<Record<string,string>>({})
  const [editTP, setEditTP]         = useState<Record<string,string>>({})
  const [saved, setSaved]           = useState<Record<string,string>>({})
  const [showTokenModal, setShowTokenModal] = useState(false)
  const [requestToken, setRequestToken] = useState('')

  const showSaved = (id:string, msg:string) => {
    setSaved(s => ({ ...s, [id]:msg }))
    setTimeout(() => setSaved(s => { const n={...s}; delete n[id]; return n }), 3000)
  }

  const saveMargin = (acc: Account) => {
    const val = parseFloat(editMargin[acc.id] || String(acc.margin))
    if (isNaN(val) || val <= 0) return
    setAccounts(a => a.map(x => x.id===acc.id ? {...x, margin:val} : x))
    showSaved(acc.id, '✅ Margin updated')
  }

  const saveSettings = (acc: Account) => {
    const sl = parseFloat(editSL[acc.id] || String(acc.globalSL))
    const tp = parseFloat(editTP[acc.id] || String(acc.globalTP))
    setAccounts(a => a.map(x => x.id===acc.id ? {...x, globalSL:sl, globalTP:tp} : x))
    showSaved(acc.id, '✅ Settings saved')
  }

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'20px' }}>
        <h1 style={{ fontFamily:"'ADLaM Display', serif", fontSize:'22px', fontWeight:400 }}>Accounts</h1>
        <button className="btn btn-primary" onClick={() => setShowTokenModal(true)}>
          🔑 Zerodha Daily Login
        </button>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:'16px', marginBottom:'28px' }}>
        {accounts.map(acc => (
          <div key={acc.id} style={{
            background:'var(--bg-surface)', border:'1px solid var(--bg-border)',
            borderTop:`3px solid ${acc.color}`, borderRadius:'8px', padding:'16px',
          }}>
            {/* Header */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'14px' }}>
              <div>
                <div style={{ fontWeight:700, fontSize:'16px' }}>{acc.name}</div>
                <div style={{ fontSize:'11px', color:'var(--text-muted)', marginTop:'2px' }}>{acc.broker} · {acc.type}</div>
              </div>
              <span style={{
                fontSize:'11px', padding:'3px 8px', borderRadius:'4px', fontWeight:600,
                color: acc.status==='active' ? 'var(--green)' : 'var(--amber)',
                background: acc.status==='active' ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)',
              }}>{acc.status.toUpperCase()}</span>
            </div>

            {/* Stats */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px', marginBottom:'14px' }}>
              <div style={{ background:'var(--bg-secondary)', borderRadius:'6px', padding:'10px' }}>
                <div style={{ fontSize:'10px', color:'var(--text-muted)', marginBottom:'4px', textTransform:'uppercase', letterSpacing:'0.05em' }}>FY Margin</div>
                <div style={{ fontWeight:700, fontSize:'14px' }}>₹{(acc.margin/100000).toFixed(1)}L</div>
              </div>
              <div style={{ background:'var(--bg-secondary)', borderRadius:'6px', padding:'10px' }}>
                <div style={{ fontSize:'10px', color:'var(--text-muted)', marginBottom:'4px', textTransform:'uppercase', letterSpacing:'0.05em' }}>FY P&L</div>
                <div style={{ fontWeight:700, fontSize:'14px', color: acc.pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {acc.pnl >= 0 ? '+' : ''}₹{Math.abs(acc.pnl).toLocaleString('en-IN')}
                </div>
              </div>
            </div>

            {/* Token status */}
            <div style={{ fontSize:'11px', color:'var(--text-muted)', marginBottom:'12px', padding:'8px', background:'var(--bg-secondary)', borderRadius:'5px' }}>
              API Token:&nbsp;
              <span style={{ color: acc.token==='active' ? 'var(--green)' : 'var(--amber)', fontWeight:600 }}>
                {acc.token==='active' ? '✅ Connected today' : acc.token==='pending' ? '⏳ Phase 2' : '⚠️ Requires login'}
              </span>
            </div>

            {acc.status === 'active' && (
              <>
                {/* Update Margin */}
                <div style={{ marginBottom:'10px' }}>
                  <div style={{ fontSize:'10px', color:'var(--text-muted)', marginBottom:'5px', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em' }}>
                    Update FY Margin
                  </div>
                  <div style={{ display:'flex', gap:'6px' }}>
                    <input
                      className="staax-input"
                      type="number"
                      defaultValue={acc.margin}
                      onChange={e => setEditMargin(m => ({ ...m, [acc.id]:e.target.value }))}
                      style={{ flex:1, fontSize:'12px' }}
                    />
                    <button className="btn btn-ghost" style={{ fontSize:'11px', flexShrink:0 }}
                      onClick={() => saveMargin(acc)}>
                      Save
                    </button>
                  </div>
                </div>

                {/* Global SL / TP */}
                <div style={{ marginBottom:'10px' }}>
                  <div style={{ fontSize:'10px', color:'var(--text-muted)', marginBottom:'5px', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em' }}>
                    Global SL / TP
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px', marginBottom:'6px' }}>
                    <input className="staax-input" type="number" placeholder="Global SL ₹"
                      defaultValue={acc.globalSL}
                      onChange={e => setEditSL(s => ({ ...s, [acc.id]:e.target.value }))}
                      style={{ fontSize:'12px' }} />
                    <input className="staax-input" type="number" placeholder="Global TP ₹"
                      defaultValue={acc.globalTP}
                      onChange={e => setEditTP(s => ({ ...s, [acc.id]:e.target.value }))}
                      style={{ fontSize:'12px' }} />
                  </div>
                  <button className="btn btn-ghost" style={{ width:'100%', fontSize:'11px' }}
                    onClick={() => saveSettings(acc)}>
                    Save Settings
                  </button>
                </div>
              </>
            )}

            {/* Save confirmation */}
            {saved[acc.id] && (
              <div style={{
                fontSize:'12px', color:'var(--green)', fontWeight:600,
                padding:'6px 10px', background:'rgba(34,197,94,0.1)',
                borderRadius:'5px', textAlign:'center',
              }}>
                {saved[acc.id]}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Token Modal */}
      {showTokenModal && (
        <div style={{
          position:'fixed', inset:0, background:'rgba(0,0,0,0.75)',
          display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000,
        }}>
          <div style={{
            background:'var(--bg-surface)', border:'1px solid var(--accent-blue)',
            borderRadius:'10px', padding:'24px', width:'460px',
          }}>
            <div style={{ fontWeight:700, fontSize:'16px', marginBottom:'4px' }}>Zerodha Daily Login</div>
            <div style={{ fontSize:'12px', color:'var(--text-muted)', marginBottom:'20px' }}>
              Complete this once each morning before 09:00.
            </div>
            <div style={{ background:'var(--bg-secondary)', borderRadius:'6px', padding:'14px', fontSize:'12px', color:'var(--text-muted)', lineHeight:1.8, marginBottom:'16px' }}>
              <b style={{ color:'var(--text)', display:'block', marginBottom:'4px' }}>Steps:</b>
              1. Click <b style={{ color:'var(--accent-blue)' }}>Open Login Page</b><br/>
              2. Login with password + Google Authenticator code<br/>
              3. You'll land on an error page — <b style={{ color:'var(--text)' }}>copy the full URL</b><br/>
              4. Paste below → Click <b style={{ color:'var(--accent-blue)' }}>Connect</b>
            </div>
            <button className="btn btn-ghost" style={{ width:'100%', marginBottom:'12px' }}
              onClick={() => window.open('http://localhost:8000/api/v1/accounts/zerodha/login-url','_blank')}>
              🔗 Open Zerodha Login Page
            </button>
            <div style={{ marginBottom:'14px' }}>
              <label style={{ fontSize:'11px', color:'var(--text-muted)', display:'block', marginBottom:'5px', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em' }}>
                Paste redirect URL
              </label>
              <input className="staax-input"
                placeholder="http://127.0.0.1/?request_token=XXXXXX&..."
                value={requestToken}
                onChange={e => setRequestToken(e.target.value)} />
            </div>
            <div style={{ display:'flex', gap:'10px' }}>
              <button className="btn btn-ghost" style={{ flex:1 }} onClick={() => setShowTokenModal(false)}>Cancel</button>
              <button className="btn btn-primary" style={{ flex:2 }}
                onClick={() => { alert('Token submitted!'); setShowTokenModal(false) }}>
                ✅ Connect Zerodha
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
EOF

# ─── UPDATE TOPBAR — Account selector ────────────────────────────────────────

cat > frontend/src/components/layout/TopBar.tsx << 'EOF'
import { useState } from 'react'

const ACCOUNTS = ['All Accounts','Karthik','Mom']

export default function TopBar() {
  const [isPractix, setIsPractix]       = useState(true)
  const [activeAccount, setActiveAccount] = useState('All Accounts')
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
      <div style={{ display:'flex', alignItems:'center', gap:'16px' }}>
        <span style={{ color:'var(--text-muted)', fontSize:'13px' }}>
          Welcome, <span style={{ color:'var(--text)', fontWeight:600 }}>Karthikeyan</span>
        </span>
        <span style={{ color:'var(--bg-border)' }}>|</span>
        <span style={{ fontSize:'12px', color:'var(--text-muted)' }}>IST {timeStr}</span>
      </div>

      <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
        {/* Account selector */}
        <select
          className="staax-select"
          value={activeAccount}
          onChange={e => setActiveAccount(e.target.value)}
          style={{ width:'150px', fontSize:'12px' }}
        >
          {ACCOUNTS.map(a => <option key={a}>{a}</option>)}
        </select>

        {/* PRACTIX / LIVE toggle */}
        <button onClick={() => setIsPractix(!isPractix)} style={{
          display:'flex', alignItems:'center', gap:'8px',
          background: isPractix ? 'rgba(215,123,18,0.12)' : 'rgba(34,197,94,0.12)',
          border: `1px solid ${isPractix ? 'rgba(215,123,18,0.4)' : 'rgba(34,197,94,0.4)'}`,
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

echo ""
echo "✅ Phase 1C v2 corrections applied!"
echo ""
echo "The frontend dev server should auto-reload."
echo "If not, restart it:"
echo "  cd frontend && npm run dev"
echo ""
echo "Then commit:"
echo "  cd .."
echo "  git add ."
echo "  git commit -m 'Phase 1C v2: UI corrections — Grid redesign, Orders hierarchy, per-leg Algo config, Reports calendar, Accounts save'"
echo "  git push origin feature/ui-phase1c"
