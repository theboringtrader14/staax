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
