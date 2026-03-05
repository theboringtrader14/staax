import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

const DAYS = ['MON','TUE','WED','THU','FRI']
const WEEKENDS = ['SAT','SUN']
type CS = 'no_trade'|'algo_active'|'order_pending'|'open'|'algo_closed'|'error'
type CM = 'practix'|'live'
interface Cell { multiplier:number; status:CS; mode:CM; entry:string; exit?:string; pnl?:number }
interface Algo { id:string; name:string; account:string; legs:{i:string;d:'B'|'S'}[]; et:string; xt:string; arch:boolean }

const SC: Record<CS,{label:string;col:string;bg:string;pct:number}> = {
  no_trade:     {label:'No Trade',col:'#6B7280',bg:'rgba(107,114,128,0.12)',pct:0},
  algo_active:  {label:'Active',  col:'#00B0F0',bg:'rgba(0,176,240,0.12)',  pct:30},
  order_pending:{label:'Pending', col:'#F59E0B',bg:'rgba(245,158,11,0.12)', pct:50},
  open:         {label:'Open',    col:'#22C55E',bg:'rgba(34,197,94,0.12)',  pct:75},
  algo_closed:  {label:'Closed',  col:'#16a34a',bg:'rgba(22,163,74,0.12)', pct:100},
  error:        {label:'Error',   col:'#EF4444',bg:'rgba(239,68,68,0.12)', pct:60},
}

const DA: Algo[] = [
  {id:'1',name:'AWS-1', account:'Karthik',legs:[{i:'NF',d:'B'},{i:'NF',d:'B'}],et:'09:16',xt:'15:10',arch:false},
  {id:'2',name:'TF-BUY',account:'Mom',    legs:[{i:'BN',d:'B'}],               et:'09:30',xt:'15:10',arch:false},
  {id:'3',name:'S1',    account:'Karthik',legs:[{i:'NF',d:'B'},{i:'NF',d:'S'}],et:'09:20',xt:'15:10',arch:false},
  {id:'4',name:'MDS-1', account:'Mom',    legs:[{i:'MN',d:'B'}],               et:'09:30',xt:'15:10',arch:false},
  {id:'5',name:'Test 1',account:'Karthik',legs:[{i:'NF',d:'S'},{i:'NF',d:'S'}],et:'09:16',xt:'15:10',arch:false},
]
const DG: Record<string,Record<string,Cell>> = {
  '1':{MON:{multiplier:1,status:'open',        mode:'practix',entry:'09:16',exit:'15:10',pnl:1325},
       TUE:{multiplier:1,status:'algo_closed', mode:'practix',entry:'09:16',exit:'15:10',pnl:-840},
       WED:{multiplier:2,status:'algo_active', mode:'practix',entry:'09:16',exit:'15:10'},
       FRI:{multiplier:1,status:'no_trade',    mode:'practix',entry:'09:16',exit:'15:10'}},
  '2':{MON:{multiplier:2,status:'algo_active', mode:'live',   entry:'09:30',exit:'15:10'},
       WED:{multiplier:1,status:'order_pending',mode:'practix',entry:'09:30',exit:'15:10'},
       THU:{multiplier:2,status:'open',         mode:'live',   entry:'09:30',exit:'15:10',pnl:-575}},
  '3':{MON:{multiplier:1,status:'no_trade',    mode:'practix',entry:'09:20',exit:'15:10'},
       THU:{multiplier:1,status:'open',         mode:'practix',entry:'09:20',exit:'15:10',pnl:2100}},
  '4':{TUE:{multiplier:3,status:'error',       mode:'practix',entry:'09:30',exit:'15:10'},
       FRI:{multiplier:1,status:'no_trade',     mode:'practix',entry:'09:30',exit:'15:10'}},
  '5':{MON:{multiplier:1,status:'algo_active', mode:'practix',entry:'09:16',exit:'15:10'}},
}

function Pie({s}:{s:CS}){
  const c=SC[s],r=12,cx=14,cy=14,ci=2*Math.PI*r,off=ci*(1-c.pct/100)
  return <svg width="28" height="28" style={{flexShrink:0}}>
    <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="2.5"/>
    {c.pct>0&&<circle cx={cx} cy={cy} r={r} fill="none" stroke={c.col} strokeWidth="2.5"
      strokeDasharray={ci} strokeDashoffset={off} strokeLinecap="round" transform={`rotate(-90 ${cx} ${cy})`}/>}
    <circle cx={cx} cy={cy} r="3" fill={c.col} opacity="0.9"/>
  </svg>
}

function worstStatus(cells:Record<string,Cell>|undefined):CS {
  if(!cells)return 'no_trade'
  const v=Object.values(cells).map(c=>c.status)
  for(const s of['error','open','algo_active','order_pending','algo_closed'] as CS[])
    if(v.includes(s))return s
  return 'no_trade'
}

export default function GridPage(){
  const nav=useNavigate()
  const [algos,setAlgos]=useState<Algo[]>(DA)
  const [grid,setGrid]=useState(DG)
  const [wk,setWk]=useState(false)
  const [ed,setEd]=useState<{id:string,day:string}|null>(null)
  const [ev,setEv]=useState('')
  const [drag,setDrag]=useState<string|null>(null)
  const [showArch,setShowArch]=useState(false)
  const [del,setDel]=useState<string|null>(null)

  const days=wk?[...DAYS,...WEEKENDS]:DAYS
  const active=algos.filter(a=>!a.arch)
  const archived=algos.filter(a=>a.arch)

  const rmCell=(id:string,d:string)=>setGrid(g=>{const u={...g[id]};delete u[d];return{...g,[id]:u}})
  const onDrop=(id:string,d:string)=>{
    if(!drag||drag!==id||grid[id]?.[d])return
    const a=algos.find(x=>x.id===id)
    setGrid(g=>({...g,[id]:{...g[id],[d]:{multiplier:1,status:'algo_active',mode:'practix',entry:a?.et||'09:16',exit:a?.xt||'15:10'}}}))
    setDrag(null)
  }
  const setM=(id:string,d:string,v:number)=>{if(v<1)return;setGrid(g=>({...g,[id]:{...g[id],[d]:{...g[id][d],multiplier:v}}}))}
  const togMode=(id:string,d:string)=>setGrid(g=>({...g,[id]:{...g[id],[d]:{...g[id][d],mode:g[id][d].mode==='practix'?'live':'practix'}}}))
  const promLive=(id:string)=>setGrid(g=>({...g,[id]:Object.fromEntries(Object.entries(g[id]||{}).map(([d,c])=>[d,{...c,mode:'live' as CM}]))}))
  const archAlgo=(id:string)=>{setAlgos(a=>a.map(x=>x.id===id?{...x,arch:true}:x));setGrid(g=>{const n={...g};delete n[id];return n})}
  const unarch=(id:string)=>setAlgos(a=>a.map(x=>x.id===id?{...x,arch:false}:x))
  const delAlgo=(id:string)=>{setAlgos(a=>a.filter(x=>x.id!==id));setGrid(g=>{const n={...g};delete n[id];return n});setDel(null)}

  const IBtn=({onClick,icon,hc,title}:{onClick:()=>void,icon:string,hc:string,title:string})=>(
    <button onClick={onClick} title={title}
      style={{width:'22px',height:'22px',borderRadius:'3px',border:'none',background:'transparent',
        color:'var(--text-dim)',fontSize:'13px',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}
      onMouseEnter={e=>{(e.currentTarget as HTMLButtonElement).style.color=hc;(e.currentTarget as HTMLButtonElement).style.background=`${hc}22`}}
      onMouseLeave={e=>{(e.currentTarget as HTMLButtonElement).style.color='var(--text-dim)';(e.currentTarget as HTMLButtonElement).style.background='transparent'}}>
      {icon}
    </button>
  )

  return <div>
    <div className="page-header">
      <div>
        <h1 style={{fontFamily:"'ADLaM Display',serif",fontSize:'22px',fontWeight:400}}>Smart Grid</h1>
        <p style={{fontSize:'12px',color:'var(--text-muted)',marginTop:'2px'}}>
          Week of {new Date().toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}
        </p>
      </div>
      <div className="page-header-actions">
        <button className="btn btn-ghost" style={{fontSize:'11px',position:'relative'}} onClick={()=>setShowArch(v=>!v)}>
          📦 Archive
          {archived.length>0&&<span style={{position:'absolute',top:'5px',right:'5px',width:'6px',height:'6px',borderRadius:'50%',background:'var(--accent-amber)'}}/>}
        </button>
        <label style={{display:'flex',alignItems:'center',gap:'6px',fontSize:'12px',color:'var(--text-muted)',cursor:'pointer'}}>
          <input type="checkbox" checked={wk} onChange={e=>setWk(e.target.checked)} style={{accentColor:'var(--accent-blue)'}}/>
          Show Weekends
        </label>
        <button className="btn btn-primary" onClick={()=>nav('/algo/new')}>+ New Algo</button>
      </div>
    </div>

    {showArch&&<div style={{background:'rgba(215,123,18,0.07)',border:'1px solid rgba(215,123,18,0.22)',borderRadius:'8px',padding:'14px 16px',marginBottom:'12px'}}>
      <div style={{fontSize:'11px',fontWeight:700,color:'var(--accent-amber)',marginBottom:'8px',textTransform:'uppercase',letterSpacing:'0.08em'}}>📦 Archived Algos</div>
      {archived.length===0
        ?<span style={{fontSize:'12px',color:'var(--text-dim)'}}>No archived algos.</span>
        :<div style={{display:'flex',flexWrap:'wrap',gap:'8px'}}>
          {archived.map(a=><div key={a.id} style={{display:'flex',alignItems:'center',gap:'10px',background:'var(--bg-secondary)',borderRadius:'6px',padding:'8px 12px',border:'1px solid var(--bg-border)'}}>
            <div><div style={{fontSize:'12px',fontWeight:600}}>{a.name}</div><div style={{fontSize:'10px',color:'var(--text-dim)'}}>{a.account}</div></div>
            <button className="btn btn-ghost" style={{fontSize:'11px',height:'26px',padding:'0 10px'}} onClick={()=>unarch(a.id)}>↩ Reactivate</button>
          </div>)}
        </div>}
    </div>}

    <div style={{display:'flex',gap:'12px',marginBottom:'12px',flexWrap:'wrap',alignItems:'center',padding:'6px 12px',background:'var(--bg-secondary)',borderRadius:'6px',border:'1px solid var(--bg-border)'}}>
      {Object.entries(SC).map(([k,s])=>(
        <span key={k} style={{display:'flex',alignItems:'center',gap:'5px',fontSize:'11px',color:'var(--text-muted)'}}>
          <span style={{width:'7px',height:'7px',borderRadius:'2px',background:s.col,display:'inline-block'}}/>{s.label}
        </span>
      ))}
      <span style={{marginLeft:'auto',fontSize:'10px',color:'var(--text-dim)'}}>
        <span style={{color:'var(--accent-amber)',fontWeight:600}}>PRAC</span> / <span style={{color:'var(--green)',fontWeight:600}}>LIVE</span> — click to toggle · drag pie → day
      </span>
    </div>

    <div style={{overflowX:'auto'}}>
      <table style={{width:'100%',borderCollapse:'collapse',tableLayout:'fixed'}}>
        <colgroup>
            <col style={{width:'200px'}}/>
            {days.map(d=><col key={d} style={{width:'140px'}}/>)}
          </colgroup>
        <thead>
          <tr>
            <th style={{padding:'8px 12px',textAlign:'left',background:'var(--bg-secondary)',border:'1px solid var(--bg-border)',fontSize:'10px',color:'var(--text-muted)',fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase'}}>ALGO</th>
            {days.map(d=><th key={d} style={{padding:'8px 12px',textAlign:'center',background:'var(--bg-secondary)',border:'1px solid var(--bg-border)',fontSize:'10px',fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase',color:WEEKENDS.includes(d)?'var(--text-dim)':'var(--text-muted)'}}>{d}</th>)}
          </tr>
        </thead>
        <tbody>
          {active.map(algo=>{
            const st=worstStatus(grid[algo.id])
            const cells=Object.values(grid[algo.id]||{})
            return <tr key={algo.id}>
              <td style={{padding:'8px 10px',background:'var(--bg-secondary)',border:'1px solid var(--bg-border)',verticalAlign:'top'}}>
                <div style={{display:'flex',alignItems:'flex-start',gap:'6px'}}>
                  <div draggable onDragStart={()=>setDrag(algo.id)} onDragEnd={()=>setDrag(null)} title="Drag to deploy" style={{cursor:'grab',flexShrink:0,paddingTop:'2px'}}>
                    <Pie s={st}/>
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div onClick={()=>nav(`/algo/${algo.id}`)} title="Click to edit"
                      style={{fontWeight:700,fontSize:'12px',color:'var(--accent-blue)',cursor:'pointer',marginBottom:'2px',
                        whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',
                        textDecoration:'underline',textDecorationStyle:'dotted',textDecorationColor:'rgba(0,176,240,0.35)'}}>
                      {algo.name}
                    </div>
                    <div style={{fontSize:'10px',color:'var(--text-dim)',marginBottom:'4px'}}>{algo.account}</div>
                    <div style={{display:'flex',gap:'3px',flexWrap:'wrap',marginBottom:'5px'}}>
                      {algo.legs.map((l,i)=><span key={i} style={{fontSize:'9px',fontWeight:700,padding:'1px 4px',borderRadius:'3px',
                        background:l.d==='B'?'rgba(34,197,94,0.15)':'rgba(239,68,68,0.15)',
                        color:l.d==='B'?'var(--green)':'var(--red)',
                        border:`1px solid ${l.d==='B'?'rgba(34,197,94,0.3)':'rgba(239,68,68,0.3)'}`}}>
                        {l.i}{l.d}
                      </span>)}
                    </div>
                    {cells.some(c=>c.mode==='practix')&&<button onClick={()=>promLive(algo.id)}
                      style={{fontSize:'9px',padding:'1px 6px',borderRadius:'3px',height:'17px',border:'1px solid rgba(34,197,94,0.3)',background:'transparent',color:'var(--green)',cursor:'pointer'}}
                      onMouseEnter={e=>(e.currentTarget.style.background='rgba(34,197,94,0.1)')}
                      onMouseLeave={e=>(e.currentTarget.style.background='transparent')}>
                      → Promote all to LIVE
                    </button>}
                  </div>
                  <div style={{display:'flex',flexDirection:'column',gap:'2px',flexShrink:0}}>
                    <IBtn onClick={()=>setDel(algo.id)} icon="🗑" hc="var(--red)" title="Delete permanently"/>
                    <IBtn onClick={()=>archAlgo(algo.id)} icon="📦" hc="var(--accent-amber)" title="Archive"/>
                  </div>
                </div>
              </td>
              {days.map(day=>{
                const cell=grid[algo.id]?.[day],s=cell?SC[cell.status]:null
                return <td key={day} onDragOver={e=>e.preventDefault()} onDrop={()=>onDrop(algo.id,day)}
                  style={{padding:'4px',border:'1px solid var(--bg-border)',verticalAlign:'top',overflow:'hidden',
                    background:WEEKENDS.includes(day)&&!cell?'rgba(30,32,34,0.4)':undefined}}>
                  {cell&&s?<div style={{background:'var(--bg-secondary)',borderLeft:`3px solid ${s.col}`,borderRadius:'5px',padding:'6px 8px',position:'relative',overflow:'hidden'}}>
                    <button onClick={()=>rmCell(algo.id,day)}
                      style={{position:'absolute',top:'2px',right:'2px',background:'none',border:'none',cursor:'pointer',color:'var(--text-dim)',fontSize:'10px',padding:'2px 3px',lineHeight:1}}
                      onMouseEnter={e=>(e.currentTarget.style.color='var(--red)')}
                      onMouseLeave={e=>(e.currentTarget.style.color='var(--text-dim)')}>✕</button>
                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'4px',paddingRight:'12px'}}>
                      <span style={{fontSize:'9px',fontWeight:700,color:s.col,background:s.bg,padding:'1px 5px',borderRadius:'3px'}}>{s.label.toUpperCase()}</span>
                      <button onClick={()=>togMode(algo.id,day)}
                        title={cell.mode==='practix'?'PRACTIX — click for LIVE':'LIVE — click for PRACTIX'}
                        style={{fontSize:'9px',fontWeight:700,padding:'1px 5px',borderRadius:'3px',border:'none',cursor:'pointer',lineHeight:'14px',
                          background:cell.mode==='live'?'rgba(34,197,94,0.18)':'rgba(215,123,18,0.14)',color:cell.mode==='live'?'var(--green)':'var(--accent-amber)',width:'34px',textAlign:'center'}}>
                        {cell.mode==='live'?'LIVE':'PRAC'}
                      </button>
                    </div>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'2px 4px',alignItems:'center'}}>
                      <div style={{display:'flex',alignItems:'center',gap:'4px'}}>
                        <span style={{fontSize:'10px',color:'var(--text)',fontWeight:600}}>M</span>
                        {ed?.id===algo.id&&ed?.day===day
                          ?<input autoFocus type="number" min={1} value={ev}
                            onChange={e=>setEv(e.target.value)}
                            onBlur={()=>{setM(algo.id,day,parseInt(ev)||1);setEd(null)}}
                            onKeyDown={e=>e.key==='Enter'&&(setM(algo.id,day,parseInt(ev)||1),setEd(null))}
                            style={{width:'44px',background:'var(--bg-primary)',border:'1px solid var(--accent-blue)',borderRadius:'2px',color:'var(--text)',fontSize:'10px',padding:'0 3px',fontFamily:'inherit'}}/>
                          :<span onClick={()=>{setEd({id:algo.id,day});setEv(String(cell.multiplier))}}
                            style={{fontSize:'10px',fontWeight:700,color:'var(--accent-blue)',cursor:'text',
                              textDecoration:'underline',textDecorationStyle:'dotted',textDecorationColor:'rgba(0,176,240,0.4)'}}>
                            {cell.multiplier}
                          </span>}
                      </div>
                      <div style={{textAlign:'right'}}>
                        {cell.pnl!=null&&<span style={{fontSize:'10px',fontWeight:700,color:cell.pnl>=0?'var(--green)':'var(--red)'}}>
                          {cell.pnl>=0?'+':''}{(cell.pnl/1000).toFixed(1)}k
                        </span>}
                      </div>
                      <div style={{display:'flex',alignItems:'center',gap:'4px'}}>
                        <span style={{fontSize:'10px',color:'var(--text)',fontWeight:600}}>E</span>
                        <span style={{fontSize:'10px',color:'var(--accent-blue)',fontWeight:600}}>{cell.entry}</span>
                      </div>
                      <div style={{textAlign:'right'}}>
                        {cell.exit&&<span style={{fontSize:'10px',color:'var(--text-muted)'}}>X {cell.exit}</span>}
                      </div>
                    </div>
                  </div>:<div style={{minHeight:'56px',border:'1px dashed var(--bg-border)',borderRadius:'5px',
                    display:'flex',alignItems:'center',justifyContent:'center',fontSize:'10px',
                    background:drag===algo.id?'rgba(0,176,240,0.05)':'transparent',
                    borderColor:drag===algo.id?'var(--accent-blue)':'var(--bg-border)',
                    color:drag===algo.id?'var(--accent-blue)':'var(--text-dim)',
                    opacity:drag===algo.id?1:0.35,transition:'all 0.15s'}}>
                    {drag===algo.id?'Drop here':'—'}
                  </div>}
                </td>
              })}
            </tr>
          })}
        </tbody>
      </table>
    </div>

    {del&&(()=>{const a=algos.find(x=>x.id===del);return<div className="modal-overlay">
      <div className="modal-box" style={{maxWidth:'380px'}}>
        <div style={{fontWeight:700,fontSize:'16px',marginBottom:'8px'}}>Delete {a?.name}?</div>
        <div style={{fontSize:'13px',color:'var(--text-muted)',lineHeight:1.6,marginBottom:'20px'}}>
          Permanently removes this algo and all grid deployments.<br/>
          <span style={{color:'var(--accent-amber)',fontSize:'12px'}}>Tip: Archive keeps it recoverable.</span>
        </div>
        <div style={{display:'flex',gap:'8px',justifyContent:'flex-end'}}>
          <button className="btn btn-ghost" onClick={()=>setDel(null)}>Cancel</button>
          <button className="btn" style={{background:'rgba(215,123,18,0.15)',color:'var(--accent-amber)',border:'1px solid rgba(215,123,18,0.3)'}}
            onClick={()=>{archAlgo(del);setDel(null)}}>📦 Archive Instead</button>
          <button className="btn" style={{background:'var(--red)',color:'#fff'}} onClick={()=>delAlgo(del)}>Delete</button>
        </div>
      </div>
    </div>})()}
  </div>
}
