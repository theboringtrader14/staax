#!/bin/bash
# STAAX Phase 1C v8
# Run from: cd ~/STAXX/staax && bash setup_phase1c_v8.sh

echo "🚀 Applying Phase 1C v8..."

# ─── SMART GRID — M/E left, P&L/X right, remove ST/BT ───────────────────────
cat > frontend/src/pages/GridPage.tsx << 'EOF'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAlgos } from '@/context/AlgoContext'

const DAYS    = ['MON','TUE','WED','THU','FRI']
const WEEKENDS= ['SAT','SUN']

type CellStatus = 'no_trade'|'algo_active'|'order_pending'|'open'|'algo_closed'|'error'

interface GridCell {
  multiplier:number; status:CellStatus; practix:boolean
  entry:string; exit?:string; pnl?:number
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
  '1':{MON:{multiplier:1,status:'open',       practix:true, entry:'09:16',exit:'15:10',pnl:1325 },TUE:{multiplier:1,status:'algo_closed',practix:false,entry:'09:16',exit:'15:10',pnl:-840},WED:{multiplier:2,status:'algo_active',practix:true,entry:'09:16',exit:'15:10'},FRI:{multiplier:1,status:'no_trade',practix:true,entry:'09:16',exit:'15:10'}},
  '2':{MON:{multiplier:2,status:'algo_active',practix:true, entry:'09:30',exit:'15:10'},WED:{multiplier:1,status:'order_pending',practix:true,entry:'09:30',exit:'15:10'},THU:{multiplier:2,status:'open',practix:true,entry:'09:30',exit:'15:10',pnl:-575}},
  '3':{MON:{multiplier:1,status:'no_trade',   practix:true, entry:'09:20',exit:'15:10'},THU:{multiplier:1,status:'open',practix:true,entry:'09:20',exit:'15:10',pnl:2100}},
  '4':{TUE:{multiplier:3,status:'error',      practix:true, entry:'09:30',exit:'15:10'},FRI:{multiplier:1,status:'no_trade',practix:true,entry:'09:30',exit:'15:10'}},
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

export default function GridPage() {
  const navigate=useNavigate()
  const {algos}=useAlgos()
  const [grid,setGrid]=useState(INIT_GRID)
  const [showWeekends,setShowWeekends]=useState(false)
  const [editing,setEditing]=useState<{algoId:string,day:string}|null>(null)
  const [editVal,setEditVal]=useState('')
  const [dragAlgoId,setDragAlgoId]=useState<string|null>(null)

  const visibleDays=showWeekends?[...DAYS,...WEEKENDS]:DAYS
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
                            {/* Delete */}
                            <button onClick={()=>removeCell(algo.id,day)}
                              style={{position:'absolute',top:'2px',right:'2px',background:'none',border:'none',
                                cursor:'pointer',color:'var(--text-dim)',fontSize:'10px',padding:'2px 3px',lineHeight:1}}
                              onMouseEnter={e=>(e.currentTarget.style.color='var(--red)')}
                              onMouseLeave={e=>(e.currentTarget.style.color='var(--text-dim)')}>✕</button>

                            {/* Status badge */}
                            <span style={{fontSize:'9px',fontWeight:700,letterSpacing:'0.04em',
                              color:s.color,background:s.bg,padding:'1px 5px',borderRadius:'3px',
                              display:'inline-block',marginBottom:'5px'}}>{s.label.toUpperCase()}</span>

                            {/* Two-column layout: left=M,E  right=P&L,X */}
                            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'2px 4px',alignItems:'center'}}>
                              {/* Left col: M */}
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
                              {/* Right col: P&L */}
                              <div style={{textAlign:'right'}}>
                                {cell.pnl!=null?(
                                  <span style={{fontSize:'10px',fontWeight:700,
                                    color:cell.pnl>=0?'var(--green)':'var(--red)'}}>
                                    {cell.pnl>=0?'+':''}{(cell.pnl/1000).toFixed(1)}k
                                  </span>
                                ):<span/>}
                              </div>
                              {/* Left col: E */}
                              <div style={{display:'flex',alignItems:'center',gap:'4px'}}>
                                <span style={{fontSize:'10px',color:'var(--text)',fontWeight:600,minWidth:'10px'}}>E</span>
                                <span style={{fontSize:'10px',color:'var(--accent-blue)',fontWeight:600}}>{cell.entry}</span>
                              </div>
                              {/* Right col: X */}
                              <div style={{textAlign:'right'}}>
                                {cell.exit&&(
                                  <span style={{fontSize:'10px',color:'var(--text-muted)',fontWeight:500}}>
                                    X {cell.exit}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Footer */}
                            {cell.practix&&(
                              <div style={{marginTop:'4px'}}>
                                <span style={{fontSize:'8px',fontWeight:700,color:'var(--accent-amber)',
                                  background:'rgba(215,123,18,0.1)',padding:'1px 4px',borderRadius:'2px'}}>PRACTIX</span>
                              </div>
                            )}
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
    </div>
  )
}
EOF

# ─── ORDERS — MTM in day tab right, inline status all buttons, SQ/T work ──────
cat > frontend/src/pages/OrdersPage.tsx << 'EOF'
import { useState } from 'react'

const ALL_DAYS=['MON','TUE','WED','THU','FRI']
const WEEKEND_ACTIVE: Record<string,number>={SAT:2840}
const DAY_PNL: Record<string,number>={MON:4320,TUE:-800,WED:1200,THU:3100,FRI:0}

type LegStatus='open'|'closed'|'error'|'pending'
interface Leg {
  id:string; parentId?:string; journeyLevel:string; status:LegStatus
  symbol:string; dir:'BUY'|'SELL'; lots:string; entryCondition:string
  refPrice?:number; fillPrice?:number; ltp?:number
  slOrig?:number; slActual?:number; target?:number
  exitPrice?:number; exitTime?:string; exitReason?:string; pnl?:number
}
interface AlgoGroup {
  algoName:string; account:string; mtm:number; mtmSL:number; mtmTP:number
  legs:Leg[]; inlineStatus?:string; inlineColor?:string; terminated?:boolean
}

const INIT_ORDERS:AlgoGroup[]=[
  {algoName:'AWS-1',account:'Karthik',mtm:4320,mtmSL:-5000,mtmTP:10000,legs:[
    {id:'L1', journeyLevel:'1',   status:'open',   symbol:'NIFTY 22500CE 27MAR25',   dir:'BUY', lots:'1 (50)', entryCondition:'ORB High', refPrice:186.5,fillPrice:187.0,ltp:213.5,slOrig:150,slActual:175,target:280,pnl:1325},
    {id:'L1a',parentId:'L1', journeyLevel:'1.1',status:'closed', symbol:'NIFTY 22500CE 27MAR25',dir:'BUY',lots:'1 (50)',entryCondition:'Re-entry',refPrice:187.0,fillPrice:188.0,slOrig:155,target:280,exitPrice:120,exitTime:'10:15:22',exitReason:'SL',pnl:-3400},
    {id:'L2', journeyLevel:'2',   status:'open',   symbol:'NIFTY 22500PE 27MAR25',   dir:'BUY', lots:'1 (50)', entryCondition:'ORB Low',  refPrice:143.0,fillPrice:142.5,ltp:118.2,slOrig:110,slActual:110,target:200,pnl:-1215},
    {id:'L3', journeyLevel:'3',   status:'error',  symbol:'NIFTY 22400CE 27MAR25',   dir:'BUY', lots:'1 (50)', entryCondition:'Direct',   pnl:0},
  ]},
  {algoName:'TF-BUY',account:'Mom',mtm:-800,mtmSL:-3000,mtmTP:6000,legs:[
    {id:'L4',journeyLevel:'1',status:'open',symbol:'BANKNIFTY 48000CE 26MAR25',dir:'BUY',lots:'2 (30)',entryCondition:'W&T Up 5%',refPrice:200.0,fillPrice:210.0,ltp:198.5,slOrig:180,slActual:185,target:280,pnl:-575},
  ]},
]

const STATUS_STYLE:Record<LegStatus,{color:string,bg:string}>={
  open:{color:'#22C55E',bg:'rgba(34,197,94,0.12)'},closed:{color:'#6B7280',bg:'rgba(107,114,128,0.12)'},
  error:{color:'#EF4444',bg:'rgba(239,68,68,0.12)'},pending:{color:'#F59E0B',bg:'rgba(245,158,11,0.12)'},
}
const COLS=['36px','66px','174px','66px','116px','54px','54px','76px','58px','88px','62px','82px']
const HDRS=['#','Status','Symbol','Lots','Entry / Ref','Fill','LTP','SL (A/O)','Target','Exit','Reason','P&L']

function LegRow({leg,isChild}:{leg:Leg,isChild:boolean}){
  const st=STATUS_STYLE[leg.status]
  return (
    <tr style={{background:isChild?'rgba(0,176,240,0.025)':undefined}}>
      <td style={{paddingLeft:isChild?'16px':'10px',width:COLS[0]}}><span style={{fontSize:'11px',color:'var(--text-muted)',fontWeight:isChild?600:400}}>{leg.journeyLevel}</span></td>
      <td style={{width:COLS[1]}}><span className="tag" style={{color:st.color,background:st.bg,fontSize:'10px'}}>{leg.status.toUpperCase()}</span></td>
      <td style={{width:COLS[2]}}><div style={{fontSize:'11px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{leg.symbol}</div><div style={{fontSize:'10px',color:leg.dir==='BUY'?'var(--green)':'var(--red)',fontWeight:600}}>{leg.dir}</div></td>
      <td style={{width:COLS[3],color:'var(--text-muted)',fontSize:'11px'}}>{leg.lots}</td>
      <td style={{width:COLS[4],fontSize:'11px'}}><div style={{color:'var(--text-muted)'}}>{leg.entryCondition}</div>{leg.refPrice!=null&&<div style={{color:'var(--text-dim)',fontSize:'10px'}}>Ref: {leg.refPrice}</div>}</td>
      <td style={{width:COLS[5],fontWeight:600}}>{leg.fillPrice??'—'}</td>
      <td style={{width:COLS[6],fontWeight:600,color:leg.ltp!=null&&leg.fillPrice!=null?(leg.ltp>leg.fillPrice?'var(--green)':'var(--red)'):'var(--text-muted)'}}>{leg.ltp??'—'}</td>
      <td style={{width:COLS[7],fontSize:'11px'}}>{leg.slActual!=null&&<div style={{color:'var(--amber)'}}>A:{leg.slActual}</div>}{leg.slOrig!=null&&<div style={{color:'var(--text-muted)'}}>O:{leg.slOrig}</div>}{leg.slOrig==null&&'—'}</td>
      <td style={{width:COLS[8],color:'var(--text-muted)'}}>{leg.target??'—'}</td>
      <td style={{width:COLS[9],fontSize:'11px'}}>{leg.exitPrice!=null?(<><div style={{fontWeight:600}}>{leg.exitPrice}</div>{leg.exitTime&&<div style={{fontSize:'10px',color:'var(--text-dim)'}}>{leg.exitTime}</div>}</>):'—'}</td>
      <td style={{width:COLS[10]}}>{leg.exitReason?<span className="tag" style={{color:'var(--red)',background:'rgba(239,68,68,0.1)',fontSize:'10px'}}>{leg.exitReason}</span>:'—'}</td>
      <td style={{width:COLS[11],fontWeight:700,textAlign:'right',color:(leg.pnl||0)>=0?'var(--green)':'var(--red)'}}>{leg.pnl!=null?`${leg.pnl>=0?'+':''}₹${Math.abs(leg.pnl).toLocaleString('en-IN')}`:'—'}</td>
    </tr>
  )
}

interface ModalProps{title:string;desc:string;confirmLabel:string;confirmColor:string;children?:React.ReactNode;onConfirm:()=>void;onCancel:()=>void}
function ConfirmModal({title,desc,confirmLabel,confirmColor,children,onConfirm,onCancel}:ModalProps){
  return(
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

// Show inline status in algo header, auto-clear after delay
function setStatus(setOrders:any,idx:number,msg:string,color:string,durationMs=3000){
  setOrders((o:AlgoGroup[])=>o.map((g,i)=>i===idx?{...g,inlineStatus:msg,inlineColor:color}:g))
  setTimeout(()=>setOrders((o:AlgoGroup[])=>o.map((g,i)=>i===idx?{...g,inlineStatus:undefined,inlineColor:undefined}:g)),durationMs)
}

export default function OrdersPage(){
  const [orders,setOrders]=useState<AlgoGroup[]>(INIT_ORDERS)
  const [activeDay,setActiveDay]=useState('MON')
  const [showWeekends,setShowWeekends]=useState(false)
  const [modal,setModal]=useState<{type:'run'|'sq'|'t',algoIdx:number}|null>(null)
  const [sqChecked,setSqChecked]=useState<Record<string,boolean>>({})

  const visibleDays=showWeekends?[...ALL_DAYS,'SAT','SUN']:[...ALL_DAYS,...Object.keys(WEEKEND_ACTIVE)]
  const totalMTM=orders.filter(g=>!g.terminated).reduce((s,g)=>s+g.mtm,0)

  const buildRows=(legs:Leg[])=>{
    const r:{leg:Leg,isChild:boolean}[]=[]
    for(const p of legs.filter(l=>!l.parentId)){r.push({leg:p,isChild:false});for(const c of legs.filter(l=>l.parentId===p.id))r.push({leg:c,isChild:true})}
    return r
  }

  const openLegs=(idx:number)=>orders[idx].legs.filter(l=>l.status==='open')

  // Actions — update state + show inline status
  const doRun=(idx:number)=>{
    setStatus(setOrders,idx,'▶ Executing...','var(--accent-blue)')
    setTimeout(()=>setStatus(setOrders,idx,'✅ Algo running','var(--green)'),1200)
    setModal(null)
  }

  const doRE=(idx:number)=>{
    setStatus(setOrders,idx,'↻ Retrying...','var(--accent-amber)')
    setTimeout(()=>setStatus(setOrders,idx,'✅ Retry successful','var(--green)'),1500)
  }

  const doSQ=(idx:number)=>{
    // Close selected legs
    const selected=Object.keys(sqChecked).filter(k=>sqChecked[k])
    if(selected.length===0){setModal(null);return}
    setOrders(o=>o.map((g,i)=>i===idx?{...g,legs:g.legs.map(l=>selected.includes(l.id)?{...l,status:'closed' as LegStatus,exitPrice:l.ltp,exitTime:new Date().toLocaleTimeString('en-IN',{hour12:false}),exitReason:'Manual SQ'}:l)}:g))
    setStatus(setOrders,idx,`✅ ${selected.length} leg${selected.length>1?'s':''} squared off`,'var(--green)')
    setSqChecked({})
    setModal(null)
  }

  const doTerminate=(idx:number)=>{
    // Close all open legs + mark terminated
    setOrders(o=>o.map((g,i)=>i===idx?{...g,terminated:true,legs:g.legs.map(l=>l.status==='open'?{...l,status:'closed' as LegStatus,exitPrice:l.ltp,exitTime:new Date().toLocaleTimeString('en-IN',{hour12:false}),exitReason:'Terminated'}:l)}:g))
    setStatus(setOrders,idx,'⛔ Algo terminated','var(--red)',5000)
    setModal(null)
  }

  const doConfirm=()=>{
    if(!modal)return
    const {type,algoIdx}=modal
    if(type==='run') doRun(algoIdx)
    if(type==='sq')  doSQ(algoIdx)
    if(type==='t')   doTerminate(algoIdx)
  }

  const getModalContent=()=>{
    if(!modal)return null
    const {type,algoIdx}=modal
    const name=orders[algoIdx].algoName
    if(type==='run')return{title:`Execute ${name}?`,desc:`Execute ${name} immediately with the configured entry strategy.`,confirmLabel:'Execute',confirmColor:'var(--accent-blue)',children:undefined}
    if(type==='t')  return{title:`Terminate ${name}?`,desc:`Square off all open positions, cancel pending orders, and terminate ${name} for today. This cannot be undone.`,confirmLabel:'Terminate',confirmColor:'var(--red)',children:undefined}
    if(type==='sq') return{title:`Square Off — ${name}`,desc:'Select open legs to square off:',confirmLabel:'Square Off',confirmColor:'#22C55E',children:(
      <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
        {openLegs(algoIdx).map(leg=>(
          <label key={leg.id} style={{display:'flex',alignItems:'center',gap:'10px',padding:'8px 12px',background:'var(--bg-secondary)',borderRadius:'5px',cursor:'pointer'}}>
            <input type="checkbox" checked={!!sqChecked[leg.id]}
              onChange={e=>setSqChecked(s=>({...s,[leg.id]:e.target.checked}))}
              style={{accentColor:'var(--green)',width:'15px',height:'15px'}}/>
            <div>
              <div style={{fontSize:'12px',fontWeight:600}}>{leg.symbol}</div>
              <div style={{fontSize:'11px',color:'var(--text-muted)',marginTop:'1px'}}>{leg.dir} · {leg.lots} · Fill: {leg.fillPrice} · LTP: {leg.ltp}</div>
            </div>
          </label>
        ))}
      </div>
    )}
    return null
  }

  return(
    <div>
      <div className="page-header">
        <h1 style={{fontFamily:"'ADLaM Display',serif",fontSize:'22px',fontWeight:400}}>Orders</h1>
        <div className="page-header-actions">
          <label style={{display:'flex',alignItems:'center',gap:'6px',fontSize:'12px',color:'var(--text-muted)',cursor:'pointer'}}>
            <input type="checkbox" checked={showWeekends} onChange={e=>setShowWeekends(e.target.checked)} style={{accentColor:'var(--accent-blue)'}}/>
            Show Weekends
          </label>
        </div>
      </div>

      {/* Day tabs — P&L inline, total MTM at right end */}
      <div style={{display:'flex',alignItems:'center',gap:'2px',marginBottom:'18px',
        borderBottom:'1px solid var(--bg-border)'}}>
        {visibleDays.map(d=>{
          const isWeekend=d==='SAT'||d==='SUN'
          const pnl=isWeekend?WEEKEND_ACTIVE[d]:DAY_PNL[d]
          const isActive=activeDay===d
          return(
            <button key={d} onClick={()=>setActiveDay(d)} style={{
              display:'flex',alignItems:'center',gap:'5px',padding:'8px 12px',fontSize:'12px',fontWeight:600,
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
        {/* Total MTM pinned to right */}
        <div style={{marginLeft:'auto',paddingBottom:'2px',paddingRight:'4px'}}>
          <span style={{fontSize:'12px',fontWeight:700,padding:'4px 10px',borderRadius:'5px',
            color:totalMTM>=0?'var(--green)':'var(--red)',
            background:totalMTM>=0?'rgba(34,197,94,0.1)':'rgba(239,68,68,0.1)',
            border:`1px solid ${totalMTM>=0?'rgba(34,197,94,0.25)':'rgba(239,68,68,0.25)'}`}}>
            MTM: {totalMTM>=0?'+':''}₹{totalMTM.toLocaleString('en-IN')}
          </span>
        </div>
      </div>

      {orders.map((group,gi)=>(
        <div key={gi} style={{marginBottom:'16px',opacity:group.terminated?0.65:1}}>
          <div style={{background:'var(--bg-secondary)',border:'1px solid var(--bg-border)',
            borderRadius:'7px 7px 0 0',padding:'8px 12px',
            display:'flex',alignItems:'center',gap:'10px',flexWrap:'wrap'}}>
            {/* Terminated block icon */}
            {group.terminated&&(
              <span title="Terminated — hit RUN to restart" style={{fontSize:'14px',cursor:'help'}}>⛔</span>
            )}
            <span style={{fontWeight:700,fontSize:'14px',color:group.terminated?'var(--text-dim)':'var(--accent-blue)'}}>
              {group.algoName}
            </span>
            <span style={{fontSize:'11px',color:'var(--text-muted)',background:'var(--bg-surface)',padding:'2px 7px',borderRadius:'4px'}}>{group.account}</span>
            {!group.terminated&&(
              <span style={{fontSize:'11px',color:'var(--text-dim)'}}>
                SL: <span style={{color:'var(--red)'}}>₹{Math.abs(group.mtmSL).toLocaleString('en-IN')}</span>
                &nbsp;·&nbsp;TP: <span style={{color:'var(--green)'}}>₹{group.mtmTP.toLocaleString('en-IN')}</span>
              </span>
            )}
            {/* Inline status — center */}
            {group.inlineStatus&&(
              <span style={{fontSize:'11px',fontWeight:600,color:group.inlineColor,animation:'fadeIn 0.2s ease'}}>
                {group.inlineStatus}
              </span>
            )}
            <div style={{marginLeft:'auto',display:'flex',gap:'5px',alignItems:'center'}}>
              {[
                {label:'RUN',color:'#00B0F0',action:()=>setModal({type:'run',algoIdx:gi})},
                {label:'RE', color:'#F59E0B',action:()=>doRE(gi)},
                {label:'SQ', color:'#22C55E',action:()=>{setSqChecked({});setModal({type:'sq',algoIdx:gi})}},
                {label:'T',  color:'#EF4444',action:()=>setModal({type:'t', algoIdx:gi})},
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
              {!group.terminated&&(
                <span style={{fontWeight:700,fontSize:'14px',marginLeft:'6px',
                  color:group.mtm>=0?'var(--green)':'var(--red)'}}>
                  {group.mtm>=0?'+':''}₹{group.mtm.toLocaleString('en-IN')}
                </span>
              )}
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

      {modal&&(()=>{
        const mc=getModalContent()
        if(!mc)return null
        return(
          <ConfirmModal title={mc.title} desc={mc.desc} confirmLabel={mc.confirmLabel}
            confirmColor={mc.confirmColor} onCancel={()=>setModal(null)} onConfirm={doConfirm}>
            {mc.children}
          </ConfirmModal>
        )
      })()}
    </div>
  )
}
EOF

# ─── REPORTS — FY dropdown only when FY selected, Custom label, spacing ───────
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
  {key:'totalPnl',label:'Overall P&L',isLoss:false},{key:'avgDay',label:'Avg Day P&L',isLoss:false},
  {key:'maxProfit',label:'Max Profit',isLoss:false},{key:'maxLoss',label:'Max Loss',isLoss:true},
  {key:'winPct',label:'Win %',isLoss:false},{key:'lossPct',label:'Loss %',isLoss:true},
  {key:'mdd',label:'Max Drawdown',isLoss:true},{key:'roi',label:'ROI',isLoss:false},
]

function genDayPnls(month:number,year:number){
  const days=new Date(year,month,0).getDate(),r:Record<number,number|null>={}
  for(let d=1;d<=days;d++){const dow=new Date(year,month-1,d).getDay();if(dow===0||dow===6){r[d]=null;continue}const s=(d*37+month*13+year)%100;r[d]=s>45?Math.floor((s-45)*220):-Math.floor((45-s)*110)}
  return r
}

function fyMonths(fy:string){
  const sy=parseInt(fy.split('-')[0])
  return [4,5,6,7,8,9,10,11,12,1,2,3].map(m=>({month:m,year:m>=4?sy:sy+1,label:['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m],key:`${m}-${m>=4?sy:sy+1}`}))
}

// Increased card height — extra bottom padding for comfort
const CARD_H=162

function MiniCal({month,year,label,selected,onToggle}:{month:number,year:number,label:string,selected:boolean,onToggle:()=>void}){
  const pnls=genDayPnls(month,year),vals=Object.values(pnls).filter(v=>v!==null) as number[]
  const winDays=vals.filter(v=>v>0).length,lossDays=vals.filter(v=>v<=0).length,total=winDays+lossDays
  const monthPnl=vals.reduce((s,v)=>s+v,0)
  const firstDow=new Date(year,month-1,1).getDay(),offset=(firstDow===0?4:firstDow-1)%5
  const tradingDays=Array.from({length:new Date(year,month,0).getDate()},(_,i)=>i+1).filter(d=>{const dow=new Date(year,month-1,d).getDay();return dow!==0&&dow!==6})
  const padded=[...Array(offset).fill(null),...tradingDays]
  return(
    <div onClick={onToggle} style={{background:selected?'rgba(0,176,240,0.08)':'var(--bg-secondary)',
      border:`1px solid ${selected?'var(--accent-blue)':'var(--bg-border)'}`,
      borderRadius:'8px',padding:'10px 10px 12px',cursor:'pointer',transition:'all 0.12s',
      height:`${CARD_H}px`,overflow:'hidden',display:'flex',flexDirection:'column'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'4px',flexShrink:0}}>
        <span style={{fontSize:'11px',fontWeight:700,letterSpacing:'0.06em',color:selected?'var(--accent-blue)':'var(--text)'}}>{label.toUpperCase()}</span>
        <span style={{fontSize:'10px',fontWeight:700,color:monthPnl>=0?'var(--green)':'var(--red)'}}>{monthPnl>=0?'+':''}{(monthPnl/1000).toFixed(1)}k</span>
      </div>
      {total>0&&<div style={{height:'3px',borderRadius:'2px',background:'var(--bg-border)',marginBottom:'6px',overflow:'hidden',display:'flex',flexShrink:0}}><div style={{width:`${(winDays/total)*100}%`,height:'100%',background:'var(--green)'}}/><div style={{width:`${(lossDays/total)*100}%`,height:'100%',background:'var(--red)'}}/></div>}
      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:'1px',marginBottom:'4px',flexShrink:0}}>
        {['M','T','W','T','F'].map((d,i)=><div key={i} style={{textAlign:'center',fontSize:'7px',color:'var(--text-dim)',fontWeight:700}}>{d}</div>)}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:'4px',flex:1,alignContent:'start'}}>
        {padded.map((day,i)=>(
          <div key={i} style={{display:'flex',alignItems:'center',justifyContent:'center',padding:'2px 0'}}>
            {day
              ?<div style={{width:10,height:10,borderRadius:'3px',background:pnls[day as number]!==null?(pnls[day as number]!>0?'var(--green)':'var(--red)'):'transparent',opacity:0.85}}/>
              :<div style={{width:10,height:10}}/>}
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
  return(
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
  const [metricFy,setMetricFy]=useState('2024-25')
  const [metricMonth,setMetricMonth]=useState('Apr')
  const [metricDate,setMetricDate]=useState('')
  const [metricFrom,setMetricFrom]=useState('')
  const [metricTo,setMetricTo]=useState('')
  const [chartModal,setChartModal]=useState(false)

  const months=fyMonths(fy)
  const totalPnl=FY_PNLS.reduce((s,x)=>s+x,0),prevPnl=702440
  const expandedData=expandedMonth?months.find(m=>m.key===expandedMonth):null

  const activePeriodLabel=
    metricFilter==='fy'?`FY ${metricFy}`:
    metricFilter==='month'?`${metricMonth} · FY ${fy}`:
    metricFilter==='date'&&metricDate?metricDate:
    metricFilter==='custom'&&metricFrom&&metricTo?`${metricFrom} → ${metricTo}`:
    'Select period'

  return(
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
        <div className="card" style={{cursor:'pointer'}} onClick={()=>setChartModal(true)}>
          <div style={{fontSize:'10px',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:'4px'}}>
            FY {fy} Total P&L&nbsp;<span style={{fontSize:'9px',color:'var(--accent-blue)'}}>↗ expand</span>
          </div>
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
            {/* Filter chips */}
            {[['fy','FY'],['month','Month'],['date','Date'],['custom','Custom']].map(([v,l])=>(
              <button key={v} onClick={()=>setMetricFilter(v)}
                className={`chip ${metricFilter===v?'chip-active':'chip-inactive'}`}
                style={{height:'32px',padding:'0 12px',fontSize:'11px'}}>{l}</button>
            ))}
            {/* Conditional inputs — all on right side like other dropdowns */}
            {metricFilter==='fy'&&(
              <select className="staax-select" value={metricFy} onChange={e=>setMetricFy(e.target.value)} style={{width:'108px',fontSize:'11px'}}>
                <option value="2024-25">FY 2024–25</option><option value="2023-24">FY 2023–24</option>
              </select>
            )}
            {metricFilter==='month'&&(
              <select className="staax-select" value={metricMonth} onChange={e=>setMetricMonth(e.target.value)} style={{width:'90px',fontSize:'11px'}}>
                {MONTHS_FY.map(m=><option key={m}>{m}</option>)}
              </select>
            )}
            {metricFilter==='date'&&(
              <input type="date" className="staax-input" value={metricDate} onChange={e=>setMetricDate(e.target.value)} style={{width:'140px',fontSize:'11px',colorScheme:'dark'} as any}/>
            )}
            {metricFilter==='custom'&&(
              <div style={{display:'flex',alignItems:'center',gap:'5px'}}>
                <input type="date" className="staax-input" value={metricFrom} onChange={e=>setMetricFrom(e.target.value)} style={{width:'130px',fontSize:'11px',colorScheme:'dark'} as any}/>
                <span style={{fontSize:'11px',color:'var(--text-dim)'}}>→</span>
                <input type="date" className="staax-input" value={metricTo} onChange={e=>setMetricTo(e.target.value)} style={{width:'130px',fontSize:'11px',colorScheme:'dark'} as any}/>
              </div>
            )}
            {/* CSV — consistent gap from inputs */}
            <div style={{width:'1px',height:'20px',background:'var(--bg-border)',marginLeft:'4px'}}/>
            <button className="btn btn-ghost" style={{fontSize:'11px',height:'32px',padding:'0 12px'}}>⬇ CSV</button>
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
              const isPct=row.key==='winPct'||row.key==='lossPct'||row.key==='roi'
              const fmt=(n:number)=>isPct?`${Math.abs(n)}%`:`₹${Math.abs(n).toLocaleString('en-IN')}`
              const cumFmt=isPct?`${(cumVal/ALGO_METRICS.length).toFixed(1)}%`:`₹${Math.abs(cumVal).toLocaleString('en-IN')}`
              return(
                <tr key={row.key}>
                  <td style={{fontWeight:600,color:'var(--text-muted)',fontSize:'12px'}}>{row.label}</td>
                  {ALGO_METRICS.map(a=><td key={a.name} style={{color:row.isLoss?'var(--red)':'var(--green)',fontWeight:600}}>{fmt((a as any)[row.key])}</td>)}
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
REPORTSEOF

# ─── DASHBOARD — Uniform card gap + account status strip ─────────────────────
cat > frontend/src/pages/DashboardPage.tsx << 'EOF'
import { useState } from 'react'

type ServiceStatus='running'|'stopped'|'starting'|'stopping'
interface Service{id:string;name:string;status:ServiceStatus;detail:string}

const INIT_SERVICES:Service[]=[
  {id:'db',    name:'PostgreSQL', status:'stopped',detail:'localhost:5432'},
  {id:'redis', name:'Redis',      status:'stopped',detail:'localhost:6379'},
  {id:'backend',name:'Backend API',status:'stopped',detail:'http://localhost:8000'},
  {id:'ws',    name:'Market Feed',status:'stopped',detail:'NSE live tick data'},
]

const STATUS_COLOR:Record<ServiceStatus,string>={running:'var(--green)',stopped:'var(--text-dim)',starting:'var(--accent-amber)',stopping:'var(--accent-amber)'}
const STATUS_BG:Record<ServiceStatus,string>={running:'rgba(34,197,94,0.12)',stopped:'rgba(107,114,128,0.08)',starting:'rgba(245,158,11,0.12)',stopping:'rgba(245,158,11,0.12)'}

// Demo accounts for status strip
const ACCOUNTS=[
  {name:'Karthik',broker:'Zerodha',  token:true,  todayPnl:4320,  color:'#00B0F0'},
  {name:'Mom',    broker:'Angel One',token:true,  todayPnl:-800,  color:'#22C55E'},
  {name:'Wife',   broker:'Angel One',token:false, todayPnl:0,     color:'#D77B12'},
]

const STATS=[
  {label:'Active Algos',   value:'3',       color:'var(--accent-blue)'},
  {label:'Open Positions', value:'5',        color:'var(--green)'},
  {label:'Today P&L',      value:'+₹4,320',  color:'var(--green)'},
  {label:'FY P&L',         value:'+₹91,500', color:'var(--green)'},
]

export default function DashboardPage(){
  const [services,setServices]=useState<Service[]>(INIT_SERVICES)
  const [log,setLog]=useState<string[]>(['STAAX Dashboard ready.'])
  const [zerodhaConnected,setZerodhaConnected]=useState(false)

  const addLog=(msg:string)=>{
    const ts=new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit'})
    setLog(l=>[`[${ts}] ${msg}`,...l.slice(0,49)])
  }
  const setSvc=(id:string,status:ServiceStatus)=>setServices(s=>s.map(x=>x.id===id?{...x,status}:x))
  const startSvc=async(id:string)=>{setSvc(id,'starting');addLog(`Starting ${id}...`);await new Promise(r=>setTimeout(r,1200));setSvc(id,'running');addLog(`✅ ${id} running`)}
  const stopSvc =async(id:string)=>{setSvc(id,'stopping');addLog(`Stopping ${id}...`);await new Promise(r=>setTimeout(r,800));setSvc(id,'stopped');addLog(`⛔ ${id} stopped`)}
  const startAll=async()=>{addLog('Starting all...');for(const s of services)if(s.status!=='running')await startSvc(s.id);addLog('✅ All running.')}
  const stopAll =async()=>{for(const s of[...services].reverse())if(s.status==='running')await stopSvc(s.id)}
  const allRunning=services.every(s=>s.status==='running')
  const allStopped=services.every(s=>s.status==='stopped')

  // Consistent gap throughout
  const GAP=12

  return(
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

      {/* Stats — same gap as everything else */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:`${GAP}px`,marginBottom:`${GAP}px`}}>
        {STATS.map(s=>(
          <div key={s.label} className="card">
            <div style={{fontSize:'10px',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:'6px'}}>{s.label}</div>
            <div style={{fontSize:'20px',fontWeight:700,color:s.color}}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Services + Log — same gap */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:`${GAP}px`,marginBottom:`${GAP}px`}}>
        {/* Services */}
        <div className="card">
          <div style={{fontSize:'11px',fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:'12px'}}>Services</div>
          <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
            {services.map(svc=>(
              <div key={svc.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',
                padding:'9px 12px',borderRadius:'6px',background:STATUS_BG[svc.status],border:`1px solid ${STATUS_COLOR[svc.status]}22`}}>
                <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
                  <span style={{width:'8px',height:'8px',borderRadius:'50%',flexShrink:0,background:STATUS_COLOR[svc.status],
                    boxShadow:svc.status==='running'?`0 0 6px ${STATUS_COLOR[svc.status]}`:'none',
                    animation:svc.status==='starting'||svc.status==='stopping'?'pulse 1s infinite':'none'}}/>
                  <div>
                    <div style={{fontSize:'13px',fontWeight:600}}>{svc.name}</div>
                    <div style={{fontSize:'10px',color:'var(--text-dim)',marginTop:'1px'}}>{svc.detail}</div>
                  </div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                  <span style={{fontSize:'10px',color:STATUS_COLOR[svc.status],fontWeight:600,textTransform:'uppercase'}}>{svc.status}</span>
                  {svc.status==='stopped'&&<button className="btn btn-ghost" style={{fontSize:'10px',padding:'0 10px',height:'26px'}} onClick={()=>startSvc(svc.id)}>Start</button>}
                  {svc.status==='running'&&<button className="btn btn-danger" style={{fontSize:'10px',padding:'0 10px',height:'26px'}} onClick={()=>stopSvc(svc.id)}>Stop</button>}
                </div>
              </div>
            ))}
            {/* Zerodha token — fixed height */}
            <div style={{padding:'10px 12px',background:'var(--bg-secondary)',borderRadius:'6px',
              border:'1px solid var(--bg-border)',minHeight:'52px',
              display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <div>
                <div style={{fontSize:'12px',fontWeight:600}}>Zerodha Token</div>
                <div style={{fontSize:'11px',marginTop:'3px',color:zerodhaConnected?'var(--green)':'var(--accent-amber)'}}>
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
          <div style={{fontSize:'11px',fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:'12px'}}>System Log</div>
          <div style={{fontFamily:'monospace',fontSize:'11px',height:'280px',overflowY:'auto',display:'flex',flexDirection:'column',gap:'3px'}}>
            {log.map((line,i)=>(
              <div key={i} style={{color:line.includes('✅')?'var(--green)':line.includes('⛔')?'var(--red)':line.includes('Starting')||line.includes('Stopping')?'var(--accent-amber)':'var(--text-muted)'}}>{line}</div>
            ))}
          </div>
        </div>
      </div>

      {/* Account Status Strip */}
      <div className="card">
        <div style={{fontSize:'11px',fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:'12px'}}>Account Status</div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:`${GAP}px`}}>
          {ACCOUNTS.map(acc=>(
            <div key={acc.name} style={{background:'var(--bg-secondary)',borderRadius:'6px',padding:'12px',
              borderLeft:`3px solid ${acc.color}`}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'8px'}}>
                <div>
                  <div style={{fontWeight:700,fontSize:'13px'}}>{acc.name}</div>
                  <div style={{fontSize:'10px',color:'var(--text-dim)',marginTop:'1px'}}>{acc.broker}</div>
                </div>
                <span style={{fontSize:'10px',fontWeight:600,padding:'2px 6px',borderRadius:'3px',
                  color:acc.token?'var(--green)':'var(--accent-amber)',
                  background:acc.token?'rgba(34,197,94,0.1)':'rgba(245,158,11,0.1)'}}>
                  {acc.token?'✅ Live':'⚠️ Login'}
                </span>
              </div>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <span style={{fontSize:'11px',color:'var(--text-muted)'}}>Today P&L</span>
                <span style={{fontSize:'13px',fontWeight:700,color:acc.todayPnl>=0?'var(--green)':'var(--red)'}}>
                  {acc.todayPnl>=0?'+':''}₹{acc.todayPnl.toLocaleString('en-IN')}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
EOF

echo ""
echo "✅ Phase 1C v8 complete!"
echo ""
echo "Changes:"
echo "  Smart Grid  — M/E left, P&L/X right in two-column layout; ST/BT removed"
echo "  Orders      — Total MTM chip pinned right in day tab row; inline status on all 4 actions"
echo "                SQ + T actually update leg/algo state; terminated algos show ⛔ icon"
echo "  Reports     — Card height 162px (extra bottom breathing room); FY dropdown only"
echo "                shows when FY is selected; 'From-To' renamed to 'Custom';"
echo "                thin divider separates inputs from CSV button"
echo "  Dashboard   — Single GAP=12px variable used everywhere so all cards are uniform;"
echo "                Account Status strip below Services/Log with token + today P&L"
echo ""
echo "git add . && git commit -m 'Phase 1C v8: Grid layout, Orders MTM+modals, Reports filters, Dashboard uniform gaps' && git push origin feature/ui-phase1c"
