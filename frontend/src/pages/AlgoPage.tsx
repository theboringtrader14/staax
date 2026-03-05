import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

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
  const addAlgo=(_:any)=>{}
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
    <div>
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
                    {Array.from({length:31},(_,n)=><option key={n} value={n}>{n}</option>)}
                  </select>
                  <span style={{fontSize:'10px',color:'var(--text-dim)',maxWidth:'120px',lineHeight:1.3}}>
                    {dte==='0'?'Exit on expiry day':`${dte} trading day${Number(dte)!==1?'s':''} before expiry`}
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
