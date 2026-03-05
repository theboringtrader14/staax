import { useStore } from '@/store'
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
        <div style={{fontSize:'13px',color:'var(--text-muted)',marginBottom:'var(--card-gap)',lineHeight:1.5}}>{desc}</div>
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
  const isPractixMode = useStore(s => s.isPractixMode)
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
        <div key={gi} style={{marginBottom:'12px',opacity:group.terminated?0.65:1}}>
          <div style={{background:'var(--bg-secondary)',border:'1px solid var(--bg-border)',
            borderRadius:'7px 7px 0 0',padding:'8px 12px',
            display:'flex',alignItems:'center',gap:'10px',flexWrap:'wrap'}}>
            {/* Terminated block icon */}
            {group.terminated&&(
              <span
                style={{position:'relative',display:'inline-flex',alignItems:'center'}}
                onMouseEnter={e=>{const t=e.currentTarget.querySelector<HTMLElement>('[data-tt]');if(t)t.style.opacity='1'}}
                onMouseLeave={e=>{const t=e.currentTarget.querySelector<HTMLElement>('[data-tt]');if(t)t.style.opacity='0'}}>
                <span style={{fontSize:'14px',cursor:'default'}}>⛔</span>
                <span data-tt="" style={{position:'absolute',bottom:'calc(100% + 6px)',left:'50%',
                  transform:'translateX(-50%)',background:'#1E2022',color:'#E5E7EB',
                  fontSize:'10px',fontWeight:600,padding:'4px 8px',borderRadius:'4px',
                  border:'1px solid #3F4143',whiteSpace:'nowrap',pointerEvents:'none',
                  opacity:0,transition:'opacity 0.15s',zIndex:50}}>
                  Algo terminated
                </span>
              </span>
            )}
            <span style={{fontWeight:700,fontSize:'14px',color:group.terminated?'var(--text-dim)':'var(--accent-blue)'}}>
              {group.algoName}
            </span>
            <span style={{fontSize:'11px',color:'var(--text-muted)',background:'var(--bg-surface)',padding:'2px 7px',borderRadius:'4px'}}>{group.account}</span>
              {!group.terminated && (group.mtmSL || group.mtmTP) && (
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
              <span style={{fontWeight:700,fontSize:'14px',marginLeft:'6px',
                color:group.mtm>=0?'var(--green)':'var(--red)',
                opacity:group.terminated?0.6:1}}>
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
