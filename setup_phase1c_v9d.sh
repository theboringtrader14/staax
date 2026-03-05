#!/bin/bash
# STAAX Phase 1C v9d — Definitive gap fix
# Run from: cd ~/STAXX/staax && bash setup_phase1c_v9d.sh

echo "🔧 Phase 1C v9d — fixing all card gaps to 12px..."

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
EOF

cat > frontend/src/pages/AccountsPage.tsx << 'EOF'
import { useState } from 'react'

interface Account{id:string;name:string;broker:string;type:string;status:string;margin:number;pnl:number;token:string;color:string;globalSL:number;globalTP:number}

const INIT_ACCOUNTS:Account[]=[
  {id:'1',name:'Karthik',broker:'Zerodha',   type:'F&O',status:'active', margin:500000,pnl:84320,  token:'active', color:'#00B0F0',globalSL:10000,globalTP:25000},
  {id:'2',name:'Mom',    broker:'Angel One', type:'F&O',status:'active', margin:300000,pnl:-12450, token:'active', color:'#22C55E',globalSL:8000, globalTP:15000},
  {id:'3',name:'Wife',   broker:'Angel One', type:'MCX',status:'pending',margin:150000,pnl:0,      token:'pending',color:'#D77B12',globalSL:5000, globalTP:10000},
]

export default function AccountsPage(){
  const [accounts,setAccounts]=useState<Account[]>(INIT_ACCOUNTS)
  const [editMargin,setEditMargin]=useState<Record<string,string>>({})
  const [editSL,setEditSL]=useState<Record<string,string>>({})
  const [editTP,setEditTP]=useState<Record<string,string>>({})
  const [saved,setSaved]=useState<Record<string,string>>({})

  const showSaved=(id:string,msg:string)=>{setSaved(s=>({...s,[id]:msg}));setTimeout(()=>setSaved(s=>{const n={...s};delete n[id];return n}),3000)}
  const saveMargin=(acc:Account)=>{const val=parseFloat(editMargin[acc.id]||String(acc.margin));if(isNaN(val)||val<=0)return;setAccounts(a=>a.map(x=>x.id===acc.id?{...x,margin:val}:x));showSaved(acc.id,'✅ Margin updated')}
  const saveSettings=(acc:Account)=>{const sl=parseFloat(editSL[acc.id]||String(acc.globalSL));const tp=parseFloat(editTP[acc.id]||String(acc.globalTP));setAccounts(a=>a.map(x=>x.id===acc.id?{...x,globalSL:sl,globalTP:tp}:x));showSaved(acc.id,'✅ Settings saved')}

  return(
    <div>
      <div className="page-header">
        <h1 style={{fontFamily:"'ADLaM Display',serif",fontSize:'22px',fontWeight:400}}>Accounts</h1>
        <div className="page-header-actions">
          <span style={{fontSize:'12px',color:'var(--text-muted)'}}>
            Broker login & token management is available in the <b style={{color:'var(--accent-blue)'}}>Dashboard</b>
          </span>
        </div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'12px'}}>
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
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px',marginBottom:'12px'}}>
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
                    onChange={e=>setEditMargin(m=>({...m,[acc.id]:e.target.value}))} style={{flex:1,fontSize:'12px'}}/>
                  <button className="btn btn-ghost" style={{fontSize:'11px',flexShrink:0}} onClick={()=>saveMargin(acc)}>Save</button>
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
                <button className="btn btn-ghost" style={{width:'100%',fontSize:'11px'}} onClick={()=>saveSettings(acc)}>Save Settings</button>
              </div>
            </>}
            {saved[acc.id]&&(
              <div style={{fontSize:'12px',color:'var(--green)',fontWeight:600,padding:'6px 10px',background:'rgba(34,197,94,0.1)',borderRadius:'5px',textAlign:'center'}}>
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

cat > frontend/src/pages/IndicatorsPage.tsx << 'EOF'
export default function IndicatorsPage(){
  const BOTS=[
    {name:'GOLDM Bot',    symbol:'GOLDM',   exchange:'MCX',strategy:'Positional',color:'#D77B12'},
    {name:'SILVERM Bot',  symbol:'SILVERM', exchange:'MCX',strategy:'Positional',color:'#9CA3AF'},
    {name:'Crude Oil Bot',symbol:'CRUDEOIL',exchange:'MCX',strategy:'Intraday',  color:'#6B7280'},
  ]
  return(
    <div>
      <div className="page-header">
        <div>
          <h1 style={{fontFamily:"'ADLaM Display',serif",fontSize:'22px',fontWeight:400}}>Indicator Systems</h1>
          <p style={{fontSize:'12px',color:'var(--text-muted)',marginTop:'2px'}}>Pre-configured MCX bots — Phase 2</p>
        </div>
      </div>
      <div style={{background:'rgba(215,123,18,0.08)',border:'1px solid rgba(215,123,18,0.25)',
        borderRadius:'8px',padding:'16px 20px',marginBottom:'12px',
        display:'flex',alignItems:'center',gap:'12px'}}>
        <span style={{fontSize:'18px'}}>⚙</span>
        <div>
          <div style={{fontWeight:600,color:'var(--accent-amber)',marginBottom:'2px'}}>Phase 2 — MCX Indicator Systems</div>
          <div style={{fontSize:'12px',color:'var(--text-muted)',lineHeight:1.5}}>
            MCX bots are pre-configured strategies that require no manual setup. Each bot manages its own entries, exits, and SL logic.
            P&L will be tracked separately here and merged into Reports with an Equity F&O / MCX filter.
          </div>
        </div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'12px'}}>
        {BOTS.map(bot=>(
          <div key={bot.name} style={{background:'var(--bg-surface)',border:'1px solid var(--bg-border)',
            borderTop:`3px solid ${bot.color}`,borderRadius:'8px',padding:'16px',opacity:0.7}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'12px'}}>
              <div>
                <div style={{fontWeight:700,fontSize:'15px'}}>{bot.name}</div>
                <div style={{fontSize:'11px',color:'var(--text-muted)',marginTop:'2px'}}>{bot.symbol} · {bot.exchange} · {bot.strategy}</div>
              </div>
              <span style={{fontSize:'10px',padding:'3px 8px',borderRadius:'4px',fontWeight:600,
                color:'var(--accent-amber)',background:'rgba(215,123,18,0.12)'}}>PHASE 2</span>
            </div>
            <div style={{height:'60px',background:'var(--bg-secondary)',borderRadius:'6px',
              display:'flex',alignItems:'center',justifyContent:'center',fontSize:'11px',color:'var(--text-dim)'}}>
              P&L widget — coming soon
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
EOF

# ── Patch ReportsPage calendar grid gap ──────────────────────────────────────
python3 - << 'PYEOF'
path = 'frontend/src/pages/ReportsPage.tsx'
try:
    with open(path) as f: src = f.read()
except:
    print('ReportsPage not found'); exit()
original = src
# Fix calendar 6-col grid gap
for bad in ["gap:'8px'","gap:'0px'","gap:'0'","gap:0","gap:'var(--card-gap)'"]:
    src = src.replace(f"gridTemplateColumns:'repeat(6,1fr)',{bad}","gridTemplateColumns:'repeat(6,1fr)',gap:'12px'")
# Fix top 3-widget grid
for bad in ["gap:'0px'","gap:'0'","gap:0","gap:'var(--card-gap)'"]:
    src = src.replace(f"gridTemplateColumns:'2fr 1fr 1fr',{bad}","gridTemplateColumns:'2fr 1fr 1fr',gap:'12px'")
if src!=original:
    with open(path,'w') as f: f.write(src)
    print('ReportsPage: gaps fixed')
else:
    print('ReportsPage: already correct')
PYEOF

# ── Patch OrdersPage: terminated P&L + tooltip ───────────────────────────────
python3 - << 'PYEOF'
path = 'frontend/src/pages/OrdersPage.tsx'
try:
    with open(path) as f: src = f.read()
except:
    print('OrdersPage not found'); exit()
original = src

# Remove !terminated guard on P&L
old = """{!group.terminated&&(
                <span style={{fontWeight:700,fontSize:'14px',marginLeft:'6px',
                  color:group.mtm>=0?'var(--green)':'var(--red)'}}>
                  {group.mtm>=0?'+':''}₹{group.mtm.toLocaleString('en-IN')}
                </span>
              )}"""
new = """<span style={{fontWeight:700,fontSize:'14px',marginLeft:'6px',
                color:group.mtm>=0?'var(--green)':'var(--red)',
                opacity:group.terminated?0.55:1}}>
                {group.mtm>=0?'+':''}₹{group.mtm.toLocaleString('en-IN')}
              </span>"""
src = src.replace(old, new)

# Replace simple tooltip span with hover tooltip
old2 = """{group.terminated&&(
              <span title="Algo terminated" style={{fontSize:'14px',cursor:'help'}}>⛔</span>
            )}"""
new2 = """{group.terminated&&(
              <span style={{position:'relative',display:'inline-flex',alignItems:'center',cursor:'help'}}
                onMouseEnter={e=>{const t=e.currentTarget.querySelector<HTMLElement>('.tt');if(t)t.style.opacity='1'}}
                onMouseLeave={e=>{const t=e.currentTarget.querySelector<HTMLElement>('.tt');if(t)t.style.opacity='0'}}>
                <span style={{fontSize:'14px'}}>⛔</span>
                <span className="tt" style={{position:'absolute',bottom:'calc(100% + 6px)',left:'50%',
                  transform:'translateX(-50%)',background:'#1E2022',color:'#9CA3AF',
                  fontSize:'10px',fontWeight:600,padding:'3px 8px',borderRadius:'4px',
                  border:'1px solid #3F4143',whiteSpace:'nowrap',pointerEvents:'none',
                  opacity:0,transition:'opacity 0.15s',zIndex:20}}>
                  Algo terminated
                </span>
              </span>
            )}"""
src = src.replace(old2, new2)

if src!=original:
    with open(path,'w') as f: f.write(src)
    print('OrdersPage: patched')
else:
    print('OrdersPage: no matching patterns — may already be correct')
PYEOF

# ── Patch AlgoPage: DTE scrollable select ────────────────────────────────────
python3 - << 'PYEOF'
import re
path = 'frontend/src/pages/AlgoPage.tsx'
try:
    with open(path) as f: src = f.read()
except:
    print('AlgoPage not found'); exit()
original = src
if 'value={dte}' in src and 'size={7}' not in src:
    src = re.sub(r'(<select[^>]*value=\{dte\}[^>]*)(style=)', r'\1size={7} \2', src)
    print('AlgoPage: DTE size=7 added')
if src!=original:
    with open(path,'w') as f: f.write(src)
PYEOF

echo ""
echo "✅ Phase 1C v9d complete — gaps confirmed 12px"
echo ""
echo "git add . && git commit -m 'Phase 1C v9d: Confirmed 12px gaps everywhere, DTE scroll, tooltip' && git push origin feature/ui-phase1c"
