import { useStore } from '@/store'
import { reportsAPI } from '@/services/api'
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
  const isPractixMode = useStore(s => s.isPractixMode)
  const [fy,setFy]=useState('2024-25')
  const [expandedMonth,setExpandedMonth]=useState<string|null>(null)
  const [metricFilter,setMetricFilter]=useState('fy')
  const [metricFy,setMetricFy]=useState('2024-25')
  const [metricMonth,setMetricMonth]=useState('Apr')
  const [downloading, setDownloading] = useState(false)

  const handleDownload = async (format: 'csv' | 'excel' = 'csv') => {
    setDownloading(true)
    try {
      const response = await reportsAPI.download({ fy, format })
      const blob = new Blob([response.data], {
        type: format === 'excel'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'text/csv'
      })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `STAAX_trades_FY${fy}.${format === 'excel' ? 'xlsx' : 'csv'}`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch {
      alert('Download failed — no trades found for this FY')
    } finally {
      setDownloading(false)
    }
  }
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
        <span style={{fontSize:'10px',fontWeight:700,padding:'2px 8px',borderRadius:'4px',marginLeft:'10px',
          background:isPractixMode?'rgba(215,123,18,0.15)':'rgba(34,197,94,0.12)',
          color:isPractixMode?'var(--accent-amber)':'var(--green)',
          border:isPractixMode?'1px solid rgba(215,123,18,0.3)':'1px solid rgba(34,197,94,0.25)',
          verticalAlign:'middle'}}>
          {isPractixMode?'PRACTIX':'LIVE'}
        </span>
        <div className="page-header-actions">
          <select className="staax-select" value={fy} onChange={e=>setFy(e.target.value)} style={{width:'120px'}}>
            <option value="2024-25">FY 2024–25</option><option value="2023-24">FY 2023–24</option>
          </select>
          <div style={{display:'flex',gap:'6px'}}>
            <button className="btn btn-ghost" style={{fontSize:'11px'}} disabled={downloading} onClick={()=>handleDownload('csv')}>{downloading?'⏳':'⬇'} CSV</button>
            <button className="btn btn-ghost" style={{fontSize:'11px'}} disabled={downloading} onClick={()=>handleDownload('excel')}>⬇ Excel</button>
          </div>
        </div>
      </div>

      {/* Widgets */}
      <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr',gap:'12px',marginBottom:'12px'}}>
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
      <div className="card" style={{marginBottom:'12px'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'12px'}}>
          <div style={{fontSize:'11px',fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.08em'}}>FY {fy} — Full Year Calendar</div>
          <div style={{display:'flex',gap:'var(--card-gap)',fontSize:'11px',color:'var(--text-dim)',alignItems:'center'}}>
            <span style={{display:'flex',alignItems:'center',gap:'4px'}}><span style={{width:'8px',height:'8px',borderRadius:'2px',background:'var(--green)',display:'inline-block'}}/> Profit</span>
            <span style={{display:'flex',alignItems:'center',gap:'4px'}}><span style={{width:'8px',height:'8px',borderRadius:'2px',background:'var(--red)',display:'inline-block'}}/> Loss</span>
            <span>Click to expand</span>
          </div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:'12px'}}>
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
            <div style={{display:'flex',gap:'6px'}}>
              <button className="btn btn-ghost" style={{fontSize:'11px',height:'32px',padding:'0 12px'}} disabled={downloading} onClick={()=>handleDownload('csv')}>{downloading?'⏳':'⬇'} CSV</button>
              <button className="btn btn-ghost" style={{fontSize:'11px',height:'32px',padding:'0 12px'}} disabled={downloading} onClick={()=>handleDownload('excel')}>⬇ Excel</button>
            </div>
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
