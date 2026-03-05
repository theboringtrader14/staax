import { useStore } from '@/store'
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
  const isPractixMode = useStore(s => s.isPractixMode)
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

  return(
    <div>
      <div className="page-header">
        <div>
          <h1 style={{fontFamily:"'ADLaM Display',serif",fontSize:'22px',fontWeight:400}}>Dashboard</h1>
          <p style={{fontSize:'12px',color:'var(--text-muted)',marginTop:'2px'}}>System status · Start / stop services · <span style={{color:isPractixMode?'var(--accent-amber)':'var(--green)',fontWeight:600}}>{isPractixMode?'PRACTIX mode':'LIVE mode'}</span></p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-ghost" onClick={stopAll} disabled={allStopped}>⛔ Stop All</button>
          <button className="btn btn-primary" onClick={startAll} disabled={allRunning}>▶ Start Session</button>
        </div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'12px',marginBottom:'12px'}}>
        {STATS.map(s=>(
          <div key={s.label} className="card">
            <div style={{fontSize:'10px',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:'6px'}}>{s.label}</div>
            <div style={{fontSize:'20px',fontWeight:700,color:s.color}}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px',marginBottom:'12px'}}>
        <div className="card">
          <div style={{fontSize:'11px',fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:'12px'}}>Services</div>
          <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
            {services.map(svc=>(
              <div key={svc.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',
                padding:'9px 12px',borderRadius:'6px',background:STATUS_BG[svc.status],border:`1px solid ${STATUS_COLOR[svc.status]}22`}}>
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
                  {svc.status==='stopped'&&<button className="btn btn-ghost" style={{fontSize:'10px',padding:'0 10px',height:'26px'}} onClick={()=>startSvc(svc.id)}>Start</button>}
                  {svc.status==='running'&&<button className="btn btn-danger" style={{fontSize:'10px',padding:'0 10px',height:'26px'}} onClick={()=>stopSvc(svc.id)}>Stop</button>}
                </div>
              </div>
            ))}
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

        <div className="card" style={{background:'var(--bg-secondary)'}}>
          <div style={{fontSize:'11px',fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:'12px'}}>System Log</div>
          <div style={{fontFamily:'monospace',fontSize:'11px',height:'280px',overflowY:'auto',display:'flex',flexDirection:'column',gap:'3px'}}>
            {log.map((line,i)=>(
              <div key={i} style={{color:line.includes('✅')?'var(--green)':line.includes('⛔')?'var(--red)':line.includes('Starting')||line.includes('Stopping')?'var(--accent-amber)':'var(--text-muted)'}}>{line}</div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div style={{fontSize:'11px',fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:'12px'}}>Account Status</div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'12px'}}>
          {ACCOUNTS.map(acc=>(
            <div key={acc.name} style={{background:'var(--bg-secondary)',borderRadius:'6px',padding:'12px',borderLeft:`3px solid ${acc.color}`}}>
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
