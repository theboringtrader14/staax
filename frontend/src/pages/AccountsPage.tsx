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
