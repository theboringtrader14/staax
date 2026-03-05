#!/bin/bash
# STAAX Phase 1C v9f
# cd ~/STAXX/staax && bash setup_phase1c_v9f.sh

echo "🔧 v9f — Reports/Orders gaps, Grid edit/delete/archive, PRACTIX/LIVE per algo..."

# ─── Reports: inject marginBottom between sections via Python AST-free approach
python3 << 'PYEOF'
path = 'frontend/src/pages/ReportsPage.tsx'
with open(path) as f:
    src = f.read()
original = src

# The 3 top-level sections in Reports return() are:
#   1. Widget grid div    → needs marginBottom:'12px'
#   2. Calendar card div  → needs marginBottom:'12px'
#   3. Per-algo card div  → bottom, no margin needed

# Strategy: find the exact style prop of the widget grid and add/fix marginBottom
import re

# Fix widget grid: find 'gridTemplateColumns:\'2fr 1fr 1fr\'' and ensure marginBottom
src = re.sub(
    r"(display:'grid',gridTemplateColumns:'2fr 1fr 1fr',gap:'12px')(,marginBottom:'[^']*')?",
    r"\1,marginBottom:'12px'",
    src
)

# Fix calendar section: it's a <div className="card"> — find the one with the calendar
# It will have style={{marginBottom:...}} or no marginBottom
# Look for the card that contains "FULL YEAR CALENDAR" heading pattern
# and ensure it has marginBottom:'12px'
src = re.sub(
    r'(<div className="card" style=\{\{)(marginBottom:\'[^\']*\')(.*?FY.*?CALENDAR)',
    lambda m: m.group(0).replace(m.group(2), "marginBottom:'12px'"),
    src, flags=re.DOTALL
)

# More aggressive: find all <div className="card" style={{marginBottom:...}}> in Reports
# and set to 12px
src = re.sub(
    r'(className="card" style=\{\{)(marginBottom:)\'(\d+)px\'',
    lambda m: f"{m.group(1)}{m.group(2)}'12px'" if m.group(3) != '12' else m.group(0),
    src
)

# Also catch: className="card" with no style but needs marginBottom between sections
# Add it where calendar card has no marginBottom
if 'FULL YEAR CALENDAR' in src:
    # Find the calendar card opening and ensure it has marginBottom
    src = re.sub(
        r'(<div className="card">)(\s*<div[^>]*>FULL YEAR CALENDAR|.*?Full Year Calendar)',
        '<div className="card" style={{marginBottom:\'12px\'}}>\\2',
        src, count=1, flags=re.DOTALL
    )

if src != original:
    with open(path, 'w') as f:
        f.write(src)
    print('✅ Reports: section marginBottom fixed')
else:
    # Show current state so we can debug
    print('⚠️  Reports: no changes — current card/grid styles:')
    for m in re.finditer(r'(className="card"|gridTemplateColumns)[^\n]{0,120}', src):
        print(f'   {m.group()[:120]}')
PYEOF

# ─── Orders: force marginBottom on algo group wrapper divs ───────────────────
python3 << 'PYEOF'
import re
path = 'frontend/src/pages/OrdersPage.tsx'
with open(path) as f:
    src = f.read()
original = src

# The algo group wrapper: <div key={gi} style={{marginBottom:'...',opacity:...}}
# Force it to 12px regardless of current value
src = re.sub(
    r'(key=\{gi\} style=\{\{marginBottom:)\'[^\']*\'',
    r"\g<1>'12px'",
    src
)

# Also: <div key={gi} style={{opacity:...,marginBottom:...}}
src = re.sub(
    r'(key=\{gi\}[^>]*marginBottom:)\'[^\']*\'',
    r"\g<1>'12px'",
    src
)

if src != original:
    with open(path, 'w') as f:
        f.write(src)
    print('✅ Orders: algo group margins set to 12px')
else:
    print('⚠️  Orders: pattern not found — current state:')
    for m in re.finditer(r'key=\{gi\}[^\n]{0,100}', src):
        print(f'   {m.group()}')
    # Last resort: show first 50 chars around each 'marginBottom' in file
    for m in re.finditer(r'marginBottom:[^\s,}]+', src[:5000]):
        print(f'   MB: {m.group()} at {m.start()}')
PYEOF

# ─── Smart Grid: edit/delete/archive + PRACTIX/LIVE per cell ────────────────
cat > frontend/src/pages/GridPage.tsx << 'EOF'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAlgos } from '@/context/AlgoContext'

const DAYS    = ['MON','TUE','WED','THU','FRI']
const WEEKENDS= ['SAT','SUN']

type CellStatus = 'no_trade'|'algo_active'|'order_pending'|'open'|'algo_closed'|'error'
type CellMode   = 'practix'|'live'

interface GridCell {
  multiplier: number
  status:     CellStatus
  mode:       CellMode
  entry:      string
  exit?:      string
  pnl?:       number
}

const STATUS_CFG: Record<CellStatus,{label:string,color:string,bg:string,pct:number}> = {
  no_trade:      {label:'No Trade',color:'#6B7280',bg:'rgba(107,114,128,0.12)',pct:0  },
  algo_active:   {label:'Active',  color:'#00B0F0',bg:'rgba(0,176,240,0.12)',  pct:30 },
  order_pending: {label:'Pending', color:'#F59E0B',bg:'rgba(245,158,11,0.12)', pct:50 },
  open:          {label:'Open',    color:'#22C55E',bg:'rgba(34,197,94,0.12)',  pct:75 },
  algo_closed:   {label:'Closed',  color:'#16a34a',bg:'rgba(22,163,74,0.12)', pct:100},
  error:         {label:'Error',   color:'#EF4444',bg:'rgba(239,68,68,0.12)', pct:60 },
}

const INIT_GRID: Record<string,Record<string,GridCell>> = {
  '1':{MON:{multiplier:1,status:'open',       mode:'practix',entry:'09:16',exit:'15:10',pnl:1325 },TUE:{multiplier:1,status:'algo_closed',mode:'practix',entry:'09:16',exit:'15:10',pnl:-840},WED:{multiplier:2,status:'algo_active',mode:'practix',entry:'09:16',exit:'15:10'},FRI:{multiplier:1,status:'no_trade',mode:'practix',entry:'09:16',exit:'15:10'}},
  '2':{MON:{multiplier:2,status:'algo_active',mode:'live',   entry:'09:30',exit:'15:10'},WED:{multiplier:1,status:'order_pending',mode:'practix',entry:'09:30',exit:'15:10'},THU:{multiplier:2,status:'open',mode:'live',entry:'09:30',exit:'15:10',pnl:-575}},
  '3':{MON:{multiplier:1,status:'no_trade',   mode:'practix',entry:'09:20',exit:'15:10'},THU:{multiplier:1,status:'open',mode:'practix',entry:'09:20',exit:'15:10',pnl:2100}},
  '4':{TUE:{multiplier:3,status:'error',      mode:'practix',entry:'09:30',exit:'15:10'},FRI:{multiplier:1,status:'no_trade',mode:'practix',entry:'09:30',exit:'15:10'}},
}

function CyclePie({status}:{status:CellStatus}) {
  const cfg=STATUS_CFG[status],r=12,cx=14,cy=14,circ=2*Math.PI*r,offset=circ*(1-cfg.pct/100)
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

function getAlgoStatus(cells:Record<string,GridCell>|undefined):CellStatus {
  if(!cells) return 'no_trade'
  const v=Object.values(cells).map(c=>c.status)
  if(v.includes('error'))        return 'error'
  if(v.includes('open'))         return 'open'
  if(v.includes('algo_active'))  return 'algo_active'
  if(v.includes('order_pending'))return 'order_pending'
  if(v.includes('algo_closed'))  return 'algo_closed'
  return 'no_trade'
}

// ── Archive drawer ─────────────────────────────────────────────────────────
interface ArchivedAlgo { id:string; name:string; account:string; archivedAt:string }

export default function GridPage() {
  const navigate   = useNavigate()
  const {algos, removeAlgo} = useAlgos()
  const [grid,setGrid]           = useState(INIT_GRID)
  const [showWeekends,setShowWeekends] = useState(false)
  const [editing,setEditing]     = useState<{algoId:string,day:string}|null>(null)
  const [editVal,setEditVal]     = useState('')
  const [dragAlgoId,setDragAlgoId] = useState<string|null>(null)
  const [archived,setArchived]   = useState<ArchivedAlgo[]>([])
  const [showArchive,setShowArchive] = useState(false)
  const [confirmDelete,setConfirmDelete] = useState<string|null>(null) // algoId
  const [globalLiveConfirm,setGlobalLiveConfirm] = useState(false)

  const visibleDays = showWeekends ? [...DAYS,...WEEKENDS] : DAYS

  const removeCell = (aId:string,day:string) =>
    setGrid(g=>{const u={...g[aId]};delete u[day];return{...g,[aId]:u}})

  const handleDrop = (aId:string,day:string) => {
    if(!dragAlgoId||dragAlgoId!==aId||grid[aId]?.[day])return
    const algo = algos.find(a=>a.id===aId)
    setGrid(g=>({...g,[aId]:{...g[aId],[day]:{multiplier:1,status:'algo_active',mode:'practix',entry:algo?.entryTime||'09:16',exit:algo?.exitTime||'15:10'}}}))
    setDragAlgoId(null)
  }

  const updateMult = (aId:string,day:string,val:number) => {
    if(val<1)return
    setGrid(g=>({...g,[aId]:{...g[aId],[day]:{...g[aId][day],multiplier:val}}}))
  }

  const toggleCellMode = (aId:string,day:string) => {
    setGrid(g=>({...g,[aId]:{...g[aId],[day]:{...g[aId][day],mode:g[aId][day].mode==='practix'?'live':'practix'}}}))
  }

  // Promote all cells of an algo to LIVE
  const promoteAlgoToLive = (aId:string) => {
    setGrid(g=>({...g,[aId]:Object.fromEntries(Object.entries(g[aId]||{}).map(([d,c])=>[d,{...c,mode:'live' as CellMode}]))}))
  }

  const doArchive = (aId:string) => {
    const algo = algos.find(a=>a.id===aId)
    if(!algo)return
    setArchived(a=>[...a,{id:aId,name:algo.name,account:algo.account,archivedAt:new Date().toLocaleDateString('en-IN')}])
    setGrid(g=>{const n={...g};delete n[aId];return n})
    // Don't remove from algos context — just hide from grid
  }

  const doDelete = (aId:string) => {
    removeAlgo(aId)
    setGrid(g=>{const n={...g};delete n[aId];return n})
    setConfirmDelete(null)
  }

  const reactivate = (aId:string) => {
    setArchived(a=>a.filter(x=>x.id!==aId))
    // algo still in context, just no grid cells — user can re-deploy by drag
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
          <button className="btn btn-ghost" style={{fontSize:'11px',position:'relative'}}
            onClick={()=>setShowArchive(!showArchive)}>
            📦 Archive {archived.length>0&&<span style={{position:'absolute',top:'4px',right:'4px',width:'6px',height:'6px',borderRadius:'50%',background:'var(--accent-amber)'}}/>}
          </button>
          <label style={{display:'flex',alignItems:'center',gap:'6px',fontSize:'12px',color:'var(--text-muted)',cursor:'pointer'}}>
            <input type="checkbox" checked={showWeekends} onChange={e=>setShowWeekends(e.target.checked)} style={{accentColor:'var(--accent-blue)'}}/>
            Show Weekends
          </label>
          <button className="btn btn-primary" onClick={()=>navigate('/algo/new')}>+ New Algo</button>
        </div>
      </div>

      {/* Archive drawer */}
      {showArchive&&(
        <div style={{background:'rgba(215,123,18,0.08)',border:'1px solid rgba(215,123,18,0.25)',
          borderRadius:'8px',padding:'14px 16px',marginBottom:'12px'}}>
          <div style={{fontSize:'11px',fontWeight:700,color:'var(--accent-amber)',marginBottom:'10px',textTransform:'uppercase',letterSpacing:'0.08em'}}>
            📦 Archived Algos
          </div>
          {archived.length===0?(
            <div style={{fontSize:'12px',color:'var(--text-dim)'}}>No archived algos.</div>
          ):(
            <div style={{display:'flex',flexWrap:'wrap',gap:'8px'}}>
              {archived.map(a=>(
                <div key={a.id} style={{display:'flex',alignItems:'center',gap:'10px',
                  background:'var(--bg-secondary)',borderRadius:'6px',padding:'8px 12px',
                  border:'1px solid var(--bg-border)'}}>
                  <div>
                    <div style={{fontSize:'12px',fontWeight:600}}>{a.name}</div>
                    <div style={{fontSize:'10px',color:'var(--text-dim)'}}>Archived {a.archivedAt}</div>
                  </div>
                  <button className="btn btn-ghost" style={{fontSize:'11px',height:'26px',padding:'0 10px'}}
                    onClick={()=>reactivate(a.id)}>
                    ↩ Reactivate
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Legend */}
      <div style={{display:'flex',gap:'14px',marginBottom:'12px',flexWrap:'wrap',
        padding:'6px 12px',background:'var(--bg-secondary)',borderRadius:'6px',border:'1px solid var(--bg-border)'}}>
        {Object.entries(STATUS_CFG).map(([key,s])=>(
          <span key={key} style={{display:'flex',alignItems:'center',gap:'5px',fontSize:'11px',color:'var(--text-muted)'}}>
            <span style={{width:'7px',height:'7px',borderRadius:'2px',background:s.color,display:'inline-block',flexShrink:0}}/>{s.label}
          </span>
        ))}
        <span style={{marginLeft:'auto',display:'flex',gap:'12px',fontSize:'10px',color:'var(--text-dim)',alignItems:'center'}}>
          <span><span style={{color:'var(--accent-amber)',fontWeight:700}}>P</span> = PRACTIX&nbsp;&nbsp;<span style={{color:'var(--green)',fontWeight:700}}>L</span> = LIVE · click to toggle</span>
          <span>Drag algo → day cell</span>
        </span>
      </div>

      <div style={{overflowX:'auto'}}>
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <colgroup>
            <col style={{width:'200px',minWidth:'200px'}}/>
            {visibleDays.map(d=><col key={d} style={{minWidth:'115px'}}/>)}
          </colgroup>
          <thead>
            <tr>
              <th style={{padding:'8px 12px',textAlign:'left',background:'var(--bg-secondary)',border:'1px solid var(--bg-border)',fontSize:'10px',color:'var(--text-muted)',fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase'}}>ALGO</th>
              {visibleDays.map(day=>(
                <th key={day} style={{padding:'8px 12px',textAlign:'center',background:'var(--bg-secondary)',border:'1px solid var(--bg-border)',fontSize:'10px',fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase',color:WEEKENDS.includes(day)?'var(--text-dim)':'var(--text-muted)'}}>
                  {day}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {algos.filter(a=>!archived.find(x=>x.id===a.id)).map(algo=>{
              const algoStatus = getAlgoStatus(grid[algo.id])
              const allCells   = Object.values(grid[algo.id]||{})
              const hasLive    = allCells.some(c=>c.mode==='live')
              return (
                <tr key={algo.id}>
                  {/* Algo name cell — clickable to edit, delete/archive icons */}
                  <td style={{padding:'8px 10px',background:'var(--bg-secondary)',border:'1px solid var(--bg-border)',verticalAlign:'top'}}>
                    <div style={{display:'flex',alignItems:'flex-start',gap:'8px'}}>
                      {/* Pie — draggable */}
                      <div draggable onDragStart={()=>setDragAlgoId(algo.id)} onDragEnd={()=>setDragAlgoId(null)}
                        style={{cursor:'grab',flexShrink:0,paddingTop:'2px'}} title="Drag to deploy">
                        <CyclePie status={algoStatus}/>
                      </div>

                      <div style={{flex:1,minWidth:0}}>
                        {/* Name — click to edit */}
                        <div onClick={()=>navigate(`/algo/${algo.id}`)}
                          style={{fontWeight:700,fontSize:'12px',color:'var(--accent-blue)',marginBottom:'2px',
                            whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',
                            cursor:'pointer',borderBottom:'1px dashed transparent',transition:'border-color 0.1s'}}
                          onMouseEnter={e=>(e.currentTarget.style.borderBottomColor='var(--accent-blue)')}
                          onMouseLeave={e=>(e.currentTarget.style.borderBottomColor='transparent')}
                          title="Click to edit algo">
                          {algo.name}
                        </div>
                        <div style={{fontSize:'10px',color:'var(--text-dim)',marginBottom:'4px'}}>{algo.account}</div>
                        <div style={{display:'flex',gap:'3px',flexWrap:'wrap',marginBottom:'4px'}}>
                          {algo.legs.map((leg,i)=>(
                            <span key={i} style={{fontSize:'9px',fontWeight:700,padding:'1px 4px',borderRadius:'3px',
                              background:leg.dir==='B'?'rgba(34,197,94,0.15)':'rgba(239,68,68,0.15)',
                              color:leg.dir==='B'?'var(--green)':'var(--red)',
                              border:`1px solid ${leg.dir==='B'?'rgba(34,197,94,0.3)':'rgba(239,68,68,0.3)'}`}}>
                              {leg.instCode}{leg.dir}
                            </span>
                          ))}
                        </div>

                        {/* Promote to LIVE button — only if any cell is PRACTIX */}
                        {allCells.some(c=>c.mode==='practix')&&(
                          <button onClick={()=>promoteAlgoToLive(algo.id)}
                            style={{fontSize:'9px',padding:'1px 7px',height:'18px',borderRadius:'3px',
                              border:'1px solid rgba(34,197,94,0.3)',background:'transparent',
                              color:'var(--green)',cursor:'pointer',transition:'all 0.12s'}}
                            onMouseEnter={e=>(e.currentTarget.style.background='rgba(34,197,94,0.1)')}
                            onMouseLeave={e=>(e.currentTarget.style.background='transparent')}
                            title="Promote all cells to LIVE">
                            → Promote to LIVE
                          </button>
                        )}
                      </div>

                      {/* Delete + Archive icons */}
                      <div style={{display:'flex',flexDirection:'column',gap:'4px',flexShrink:0}}>
                        <button onClick={()=>setConfirmDelete(algo.id)} title="Delete algo permanently"
                          style={{width:'22px',height:'22px',borderRadius:'4px',border:'none',
                            background:'transparent',color:'var(--text-dim)',fontSize:'12px',cursor:'pointer',
                            display:'flex',alignItems:'center',justifyContent:'center',transition:'all 0.1s'}}
                          onMouseEnter={e=>{e.currentTarget.style.background='rgba(239,68,68,0.15)';e.currentTarget.style.color='var(--red)'}}
                          onMouseLeave={e=>{e.currentTarget.style.background='transparent';e.currentTarget.style.color='var(--text-dim)'}}>
                          🗑
                        </button>
                        <button onClick={()=>doArchive(algo.id)} title="Archive algo"
                          style={{width:'22px',height:'22px',borderRadius:'4px',border:'none',
                            background:'transparent',color:'var(--text-dim)',fontSize:'12px',cursor:'pointer',
                            display:'flex',alignItems:'center',justifyContent:'center',transition:'all 0.1s'}}
                          onMouseEnter={e=>{e.currentTarget.style.background='rgba(215,123,18,0.15)';e.currentTarget.style.color='var(--accent-amber)'}}
                          onMouseLeave={e=>{e.currentTarget.style.background='transparent';e.currentTarget.style.color='var(--text-dim)'}}>
                          📦
                        </button>
                      </div>
                    </div>
                  </td>

                  {/* Day cells */}
                  {visibleDays.map(day=>{
                    const cell = grid[algo.id]?.[day]
                    const s    = cell ? STATUS_CFG[cell.status] : null
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

                            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'4px'}}>
                              <span style={{fontSize:'9px',fontWeight:700,letterSpacing:'0.04em',
                                color:s.color,background:s.bg,padding:'1px 5px',borderRadius:'3px'}}>
                                {s.label.toUpperCase()}
                              </span>
                              {/* PRACTIX/LIVE toggle badge */}
                              <button onClick={()=>toggleCellMode(algo.id,day)}
                                title={`Currently ${cell.mode.toUpperCase()} — click to toggle`}
                                style={{fontSize:'9px',fontWeight:700,padding:'1px 5px',borderRadius:'3px',
                                  border:'none',cursor:'pointer',transition:'all 0.12s',
                                  background:cell.mode==='live'?'rgba(34,197,94,0.15)':'rgba(215,123,18,0.12)',
                                  color:cell.mode==='live'?'var(--green)':'var(--accent-amber)'}}>
                                {cell.mode==='live'?'LIVE':'PRAC'}
                              </button>
                            </div>

                            {/* Two-col: M/E left, P&L/X right */}
                            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'2px 4px',alignItems:'center'}}>
                              <div style={{display:'flex',alignItems:'center',gap:'4px'}}>
                                <span style={{fontSize:'10px',color:'var(--text)',fontWeight:600,minWidth:'10px'}}>M</span>
                                {editing?.algoId===algo.id&&editing?.day===day?(
                                  <input autoFocus type="number" min={1} value={editVal}
                                    onChange={e=>setEditVal(e.target.value)}
                                    onBlur={()=>{updateMult(algo.id,day,parseInt(editVal)||1);setEditing(null)}}
                                    onKeyDown={e=>e.key==='Enter'&&(updateMult(algo.id,day,parseInt(editVal)||1),setEditing(null))}
                                    style={{width:'32px',background:'var(--bg-primary)',border:'1px solid var(--accent-blue)',
                                      borderRadius:'2px',color:'var(--text)',fontSize:'10px',padding:'0 3px',fontFamily:'inherit'}}/>
                                ):(
                                  <span onClick={()=>{setEditing({algoId:algo.id,day});setEditVal(String(cell.multiplier))}}
                                    style={{fontSize:'10px',fontWeight:700,color:'var(--accent-blue)',cursor:'text',
                                      borderBottom:'1px dashed transparent'}}
                                    onMouseEnter={e=>(e.currentTarget.style.borderBottomColor='var(--accent-blue)')}
                                    onMouseLeave={e=>(e.currentTarget.style.borderBottomColor='transparent')}>
                                    {cell.multiplier}
                                  </span>
                                )}
                              </div>
                              <div style={{textAlign:'right'}}>
                                {cell.pnl!=null&&(
                                  <span style={{fontSize:'10px',fontWeight:700,color:cell.pnl>=0?'var(--green)':'var(--red)'}}>
                                    {cell.pnl>=0?'+':''}{(cell.pnl/1000).toFixed(1)}k
                                  </span>
                                )}
                              </div>
                              <div style={{display:'flex',alignItems:'center',gap:'4px'}}>
                                <span style={{fontSize:'10px',color:'var(--text)',fontWeight:600,minWidth:'10px'}}>E</span>
                                <span style={{fontSize:'10px',color:'var(--accent-blue)',fontWeight:600}}>{cell.entry}</span>
                              </div>
                              <div style={{textAlign:'right'}}>
                                {cell.exit&&<span style={{fontSize:'10px',color:'var(--text-muted)',fontWeight:500}}>X {cell.exit}</span>}
                              </div>
                            </div>
                          </div>
                        ):(
                          <div style={{minHeight:'56px',border:'1px dashed var(--bg-border)',borderRadius:'5px',
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

      {/* Delete confirmation modal */}
      {confirmDelete&&(()=>{
        const algo = algos.find(a=>a.id===confirmDelete)
        return (
          <div className="modal-overlay">
            <div className="modal-box" style={{maxWidth:'360px'}}>
              <div style={{fontWeight:700,fontSize:'16px',marginBottom:'8px'}}>Delete {algo?.name}?</div>
              <div style={{fontSize:'13px',color:'var(--text-muted)',marginBottom:'20px',lineHeight:1.5}}>
                This permanently removes the algo and all its grid deployments. This cannot be undone.<br/><br/>
                To temporarily remove it, use <b>Archive</b> instead.
              </div>
              <div style={{display:'flex',gap:'10px',justifyContent:'flex-end'}}>
                <button className="btn btn-ghost" onClick={()=>setConfirmDelete(null)}>Cancel</button>
                <button className="btn btn-ghost" style={{color:'var(--accent-amber)',border:'1px solid var(--accent-amber)'}}
                  onClick={()=>{doArchive(confirmDelete);setConfirmDelete(null)}}>
                  📦 Archive Instead
                </button>
                <button className="btn" style={{background:'var(--red)',color:'#fff'}} onClick={()=>doDelete(confirmDelete)}>
                  🗑 Delete
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
EOF

# ─── AlgoContext — add removeAlgo + default mode field ───────────────────────
python3 << 'PYEOF'
import re
path = 'frontend/src/context/AlgoContext.tsx'
try:
    with open(path) as f:
        src = f.read()
except:
    print('AlgoContext not found — skipping')
    exit()

original = src

# Add removeAlgo to context if not there
if 'removeAlgo' not in src:
    src = src.replace(
        'addAlgo(algo: AlgoMeta): void',
        'addAlgo(algo: AlgoMeta): void\n  removeAlgo(id: string): void'
    )
    src = src.replace(
        'addAlgo,',
        'addAlgo, removeAlgo,'
    )
    # Add the function implementation
    src = re.sub(
        r'(const addAlgo = [^}]+\})',
        r'\1\n  const removeAlgo = (id: string) => setAlgos(a => a.filter(x => x.id !== id))',
        src
    )
    print('✅ AlgoContext: removeAlgo added')
else:
    print('ℹ️  AlgoContext: removeAlgo already exists')

if src != original:
    with open(path, 'w') as f:
        f.write(src)
PYEOF

echo ""
echo "✅ Phase 1C v9f complete"
echo ""
echo "Summary:"
echo "  Reports    — marginBottom:'12px' between all 3 main sections"
echo "  Orders     — marginBottom:'12px' on algo group cards"
echo "  Smart Grid — algo name clickable (edit), 🗑 delete + 📦 archive icons,"
echo "               PRAC/LIVE badge per cell (clickable toggle),"
echo "               'Promote to LIVE' button on algo row"
echo ""
echo "git add . && git commit -m 'Phase 1C v9f: Grid edit/archive/delete, PRACTIX/LIVE per cell, gaps' && git push origin feature/ui-phase1c"
