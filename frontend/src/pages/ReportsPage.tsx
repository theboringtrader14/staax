import { useStore } from '@/store'
import { reportsAPI } from '@/services/api'
import { useState, useEffect } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

const MONTHS_FY=['Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar']
const DAY_NAMES=['Mon','Tue','Wed','Thu','Fri']

const METRIC_ROWS=[
  {key:'total_pnl',  label:'Overall P&L', isLoss:false},
  {key:'wins',       label:'Wins',        isLoss:false},
  {key:'losses',     label:'Losses',      isLoss:true},
  {key:'win_pct',    label:'Win %',       isLoss:false},
  {key:'loss_pct',   label:'Loss %',      isLoss:true},
  {key:'max_profit', label:'Max Profit',  isLoss:false},
  {key:'max_loss',   label:'Max Loss',    isLoss:true},
  {key:'trades',     label:'Trades',      isLoss:false},
]

function fyMonths(fy:string){
  const sy=parseInt(fy.split('-')[0])
  return [4,5,6,7,8,9,10,11,12,1,2,3].map(m=>({month:m,year:m>=4?sy:sy+1,label:['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m],key:`${m}-${m>=4?sy:sy+1}`}))
}

const CARD_H=162

function MiniCal({month,year,label,selected,onToggle,calendarData}:{month:number,year:number,label:string,selected:boolean,onToggle:()=>void,calendarData:Record<string,number>}){
  const today=new Date()
  const monthStart=new Date(year,month-1,1)
  const isFutureMonth=monthStart>today
  const firstDow=monthStart.getDay(),offset=(firstDow===0?4:firstDow-1)%5
  const tradingDays=Array.from({length:new Date(year,month,0).getDate()},(_,i)=>i+1).filter(d=>{const dow=new Date(year,month-1,d).getDay();return dow!==0&&dow!==6})
  const padded=[...Array(offset).fill(null),...tradingDays]
  const monthKey=`${year}-${String(month).padStart(2,'0')}`
  const monthPnl=Object.keys(calendarData).filter(k=>k.startsWith(monthKey)).reduce((s,k)=>s+calendarData[k],0)
  const hasRealData=Object.keys(calendarData).some(k=>k.startsWith(monthKey))
  const winDays=Object.keys(calendarData).filter(k=>k.startsWith(monthKey)&&calendarData[k]>0).length
  const lossDays=Object.keys(calendarData).filter(k=>k.startsWith(monthKey)&&calendarData[k]<=0).length
  const total=winDays+lossDays
  const handleClick=()=>{ if(!isFutureMonth&&hasRealData) onToggle() }
  return(
    <div onClick={handleClick} style={{
      background:selected?'rgba(0,176,240,0.08)':'var(--bg-secondary)',
      border:`1px solid ${selected?'var(--accent-blue)':'var(--bg-border)'}`,
      borderRadius:'8px',padding:'10px 10px 12px',
      cursor:isFutureMonth||!hasRealData?'default':'pointer',
      transition:'all 0.12s',height:`${CARD_H}px`,
      overflow:'hidden',display:'flex',flexDirection:'column',
      opacity:isFutureMonth?0.35:1,
    }}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'4px',flexShrink:0}}>
        <span style={{fontSize:'11px',fontWeight:700,letterSpacing:'0.06em',color:selected?'var(--accent-blue)':'var(--text)'}}>{label.toUpperCase()}</span>
        {hasRealData&&<span style={{fontSize:'10px',fontWeight:700,color:monthPnl>=0?'var(--green)':'var(--red)'}}>{monthPnl>=0?'+':''}{(monthPnl/1000).toFixed(1)}k</span>}
      </div>
      {hasRealData&&total>0&&<div style={{height:'3px',borderRadius:'2px',background:'var(--bg-border)',marginBottom:'6px',overflow:'hidden',display:'flex',flexShrink:0}}><div style={{width:`${(winDays/total)*100}%`,height:'100%',background:'var(--green)'}}/><div style={{width:`${(lossDays/total)*100}%`,height:'100%',background:'var(--red)'}}/></div>}
      {!hasRealData&&!isFutureMonth&&<div style={{height:'3px',marginBottom:'6px',flexShrink:0}}/>}
      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:'1px',marginBottom:'4px',flexShrink:0}}>
        {['M','T','W','T','F'].map((d,i)=><div key={i} style={{textAlign:'center',fontSize:'7px',color:'var(--text-dim)',fontWeight:700}}>{d}</div>)}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:'4px',flex:1,alignContent:'start'}}>
        {padded.map((day,i)=>{
          if(!day) return <div key={i} style={{width:10,height:10}}/>
          const dateKey=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`
          const pnl=calendarData[dateKey]??null
          const isFuture=new Date(year,month-1,day)>today
          return(
            <div key={i} style={{display:'flex',alignItems:'center',justifyContent:'center',padding:'2px 0'}}>
              <div style={{width:10,height:10,borderRadius:'3px',
                background:pnl!==null?(pnl>0?'var(--green)':'var(--red)'):'var(--bg-border)',
                opacity:isFuture?0.1:pnl!==null?0.85:0.25,
              }}/>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MonthDetail({month,year,label,calendarData}:{month:number,year:number,label:string,calendarData:Record<string,number>}){
  const today=new Date()
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
          const dateKey=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`
          const pnl=calendarData[dateKey]??null
          const isFuture=new Date(year,month-1,day)>today
          return <div key={i} style={{padding:'8px 4px',borderRadius:'6px',textAlign:'center',opacity:isFuture?0.2:1,background:pnl==null?'transparent':pnl>0?`rgba(34,197,94,${Math.min(pnl/8000,1)*0.35+0.08})`:`rgba(239,68,68,${Math.min(Math.abs(pnl)/3000,1)*0.35+0.08})`}}>
            <div style={{fontSize:'11px',color:'var(--text-muted)'}}>{day}</div>
            {pnl!=null&&<div style={{fontSize:'10px',fontWeight:700,marginTop:'2px',color:pnl>0?'var(--green)':'var(--red)'}}>{pnl>0?'+':''}{(pnl/1000).toFixed(1)}k</div>}
            {pnl==null&&!isFuture&&<div style={{fontSize:'10px',color:'var(--text-dim)',marginTop:'2px'}}>—</div>}
          </div>
        })}
      </div>
    </div>
  )
}

export default function ReportsPage(){
  const isPractixMode = useStore(s => s.isPractixMode)
  const [fy,setFy]=useState('2025-26')
  const [expandedMonth,setExpandedMonth]=useState<string|null>(null)
  const [metricFilter,setMetricFilter]=useState('fy')
  const [metricFy,setMetricFy]=useState('2025-26')
  const [metricMonth,setMetricMonth]=useState('Apr')
  const [downloading, setDownloading] = useState(false)
  const [algoMetrics, setAlgoMetrics] = useState<any[]>([])
  const [calendarData, setCalendarData] = useState<Record<string,number>>({})
  const [equityCurve, setEquityCurve] = useState<any[]>([])
  const [fyTotal, setFyTotal] = useState(0)

  useEffect(() => {
    reportsAPI.metrics({ fy, is_practix: isPractixMode }).then(r => setAlgoMetrics(r.data?.metrics || [])).catch(() => {})
    reportsAPI.calendar({ fy, is_practix: isPractixMode }).then(r => {
      const map: Record<string,number> = {}
      ;(r.data?.calendar || []).forEach((d: any) => { map[d.date] = d.pnl })
      setCalendarData(map)
    }).catch(() => {})
    reportsAPI.equityCurve({ fy, is_practix: isPractixMode }).then(r => {
      setEquityCurve(r.data?.data || [])
      setFyTotal(r.data?.total || 0)
    }).catch(() => {})
  }, [fy, isPractixMode])

  const handleDownload = async (format: 'csv' | 'excel' = 'csv') => {
    setDownloading(true)
    try {
      const response = await reportsAPI.download({ fy, format })
      const blob = new Blob([response.data], {type:format==='excel'?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'text/csv'})
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `STAAX_trades_FY${fy}.${format==='excel'?'xlsx':'csv'}`
      document.body.appendChild(a); a.click()
      window.URL.revokeObjectURL(url); document.body.removeChild(a)
    } catch { alert('Download failed — no trades found for this FY') }
    finally { setDownloading(false) }
  }

  const [metricDate,setMetricDate]=useState('')
  const [metricFrom,setMetricFrom]=useState('')
  const [metricTo,setMetricTo]=useState('')
  const [chartModal,setChartModal]=useState(false)

  const months=fyMonths(fy)
  const totalPnl=fyTotal
  const expandedData=expandedMonth?months.find(m=>m.key===expandedMonth):null
  const activePeriodLabel=metricFilter==='fy'?`FY ${metricFy}`:metricFilter==='month'?`${metricMonth} · FY ${fy}`:metricFilter==='date'&&metricDate?metricDate:metricFilter==='custom'&&metricFrom&&metricTo?`${metricFrom} → ${metricTo}`:'Select period'

  // Day-of-week P&L aggregation from real calendar data
  const dowPnl: Record<string,number> = {Mon:0,Tue:0,Wed:0,Thu:0,Fri:0}
  Object.entries(calendarData).forEach(([date, pnl]) => {
    const dow = new Date(date).getDay()
    const name = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dow]
    if (dowPnl[name] !== undefined) dowPnl[name] += pnl
  })
  const maxAbsDow = Math.max(...Object.values(dowPnl).map(Math.abs), 1)

  return(
    <div>
      <div className="page-header">
        <div>
          <h1 style={{fontFamily:"'ADLaM Display',serif",fontSize:'22px',fontWeight:400}}>Reports</h1>
          <p style={{fontSize:'12px',color:'var(--text-muted)',marginTop:'2px',display:'flex',alignItems:'center',gap:'6px'}}>
            Performance analytics ·{' '}
            <span style={{fontSize:'10px',fontWeight:700,padding:'2px 6px',borderRadius:'4px',background:isPractixMode?'rgba(215,123,18,0.15)':'rgba(34,197,94,0.12)',color:isPractixMode?'var(--accent-amber)':'var(--green)',border:isPractixMode?'1px solid rgba(215,123,18,0.3)':'1px solid rgba(34,197,94,0.25)'}}>
              {isPractixMode?'PRACTIX':'LIVE'}
            </span>
          </p>
        </div>
        <div className="page-header-actions">
          <select className="staax-select" value={fy} onChange={e=>setFy(e.target.value)} style={{width:'120px'}}>
            <option value="2025-26">FY 2025-26</option>
            <option value="2024-25">FY 2024-25</option>
            <option value="2023-24">FY 2023-24</option>
          </select>
          <div style={{display:'flex',gap:'6px'}}>
            <button className="btn btn-ghost" style={{fontSize:'11px'}} disabled={downloading} onClick={()=>handleDownload('csv')}>{downloading?'⏳':'⬇'} CSV</button>
            <button className="btn btn-ghost" style={{fontSize:'11px'}} disabled={downloading} onClick={()=>handleDownload('excel')}>⬇ Excel</button>
          </div>
        </div>
      </div>

      {/* Top widgets — 4 columns: FY P&L (wider), Trades, Win Rate, Day P&L */}
      <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 2fr',gap:'12px',marginBottom:'12px'}}>
        {/* FY P&L */}
        <div className="card" style={{cursor:'pointer', maxHeight:'127px', overflow:'hidden'}} onClick={()=>setChartModal(true)}>
          <div style={{fontSize:'10px',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:'4px'}}>FY {fy} Total P&L&nbsp;<span style={{fontSize:'9px',color:'var(--accent-blue)'}}>↗</span></div>
          <div style={{display:'flex',alignItems:'flex-end',gap:'12px'}}>
            <div>
              <div style={{fontSize:'22px',fontWeight:700,color:totalPnl>=0?'var(--green)':'var(--red)',letterSpacing:'-0.02em'}}>
                {totalPnl!==0?(Math.abs(totalPnl)>=100000?'₹'+(Math.abs(totalPnl)/100000).toFixed(2)+'L':'₹'+Math.abs(totalPnl).toLocaleString('en-IN',{maximumFractionDigits:2})):'—'}
              </div>
              <div style={{fontSize:'10px',color:totalPnl>=0?'var(--green)':'var(--red)',marginTop:'2px'}}>{totalPnl!==0?(totalPnl>0?'▲ Profit':'▼ Loss'):'No trades'}</div>
            </div>
            <div style={{flex:1,height:'36px'}}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={equityCurve}><Line type="monotone" dataKey="cumulative" stroke="#00B0F0" strokeWidth={2} dot={false}/></LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Total Trades */}
        <div className="card" style={{maxHeight:'127px', overflow:'hidden'}}>
          <div style={{fontSize:'10px',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:'6px'}}>Total Trades</div>
          <div style={{fontSize:'26px',fontWeight:700,color:'var(--accent-blue)',lineHeight:1}}>{algoMetrics.reduce((s:number,a:any)=>s+a.trades,0)}</div>
          <div style={{fontSize:'10px',color:'var(--text-muted)',marginTop:'6px'}}>{algoMetrics.length} algos</div>
        </div>

        {/* Win Rate */}
        <div className="card" style={{maxHeight:'127px', overflow:'hidden'}}>
          <div style={{fontSize:'10px',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:'6px'}}>Win Rate</div>
          <div style={{fontSize:'26px',fontWeight:700,lineHeight:1,color:algoMetrics.reduce((s:number,a:any)=>s+a.wins,0)>0?'var(--green)':'var(--text-muted)'}}>
            {algoMetrics.reduce((s:number,a:any)=>s+a.trades,0)>0?(algoMetrics.reduce((s:number,a:any)=>s+a.wins,0)/algoMetrics.reduce((s:number,a:any)=>s+a.trades,0)*100).toFixed(1)+'%':'—'}
          </div>
          <div style={{fontSize:'10px',color:'var(--text-muted)',marginTop:'6px'}}>{algoMetrics.reduce((s:number,a:any)=>s+a.wins,0)}W · {algoMetrics.reduce((s:number,a:any)=>s+a.losses,0)}L</div>
        </div>

        {/* Day-of-week P&L — compact horizontal bars */}
        <div className="card">
        <div style={{fontSize:'11px',fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:'12px'}}>P&L by Day</div>
        <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-around',height:'64px',gap:'6px'}}>
          {DAY_NAMES.map(day=>{
            const pnl=dowPnl[day]||0
            const barH=pnl!==0?Math.max(Math.abs(pnl)/maxAbsDow*48,4):0
            return(
              <div key={day} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:'4px',flex:1}}>
                <div style={{display:'flex',alignItems:'flex-end',height:'48px',width:'100%',justifyContent:'center'}}>
                  {pnl!==0
                    ?<div style={{width:'60%',height:`${barH}px`,borderRadius:'3px 3px 0 0',background:pnl>0?'var(--green)':'var(--red)',opacity:0.75,transition:'height 0.3s'}}/>
                    :<div style={{width:'60%',height:'2px',borderRadius:'2px',background:'var(--bg-border)',opacity:0.4}}/>
                  }
                </div>
                <span style={{fontSize:'9px',fontWeight:700,color:'var(--text-dim)'}}>{day.charAt(0)}</span>
              </div>
            )
          })}
        </div>
      </div>
      </div>{/* end top widgets grid */}

      {/* Equity Curve Modal */}
      {chartModal&&(
        <div className="modal-overlay" onClick={()=>setChartModal(false)}>
          <div className="modal-box" style={{maxWidth:'780px',width:'90%'}} onClick={e=>e.stopPropagation()}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'16px'}}>
              <div style={{fontWeight:700,fontSize:'16px'}}>FY {fy} — Cumulative P&L</div>
              <button onClick={()=>setChartModal(false)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-muted)',fontSize:'18px'}}>✕</button>
            </div>
            <div style={{height:'320px'}}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={equityCurve} margin={{top:10,right:20,bottom:10,left:40}}>
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
      <div className="card">
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'12px'}}>
          <div style={{fontSize:'11px',fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.08em'}}>FY {fy} — Full Year Calendar</div>
          <div style={{display:'flex',gap:'12px',fontSize:'11px',color:'var(--text-dim)',alignItems:'center'}}>
            <span style={{display:'flex',alignItems:'center',gap:'4px'}}><span style={{width:'8px',height:'8px',borderRadius:'2px',background:'var(--green)',display:'inline-block'}}/> Profit</span>
            <span style={{display:'flex',alignItems:'center',gap:'4px'}}><span style={{width:'8px',height:'8px',borderRadius:'2px',background:'var(--red)',display:'inline-block'}}/> Loss</span>
            <span style={{opacity:0.5,fontSize:'10px'}}>Click to expand</span>
          </div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:'12px'}}>
          {months.map(m=><MiniCal key={m.key} month={m.month} year={m.year} label={m.label} selected={expandedMonth===m.key} onToggle={()=>setExpandedMonth(p=>p===m.key?null:m.key)} calendarData={calendarData}/>)}
        </div>
        {expandedData&&<MonthDetail month={expandedData.month} year={expandedData.year} label={expandedData.label} calendarData={calendarData}/>}
      </div>

      {/* Per-Algo Metrics */}
      <div className="card" style={{padding:0}}>
        <div style={{padding:'16px 16px 12px',display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:'8px'}}>
          <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
            <div style={{fontSize:'11px',fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.08em'}}>Per-Algo Metrics</div>
            <span style={{fontSize:'11px',color:'var(--accent-blue)',background:'rgba(0,176,240,0.1)',padding:'2px 8px',borderRadius:'4px',fontWeight:600}}>{activePeriodLabel}</span>
          </div>
          <div style={{display:'flex',gap:'6px',alignItems:'center',flexWrap:'wrap'}}>
            {[['fy','FY'],['month','Month'],['date','Date'],['custom','Custom']].map(([v,l])=>(
              <button key={v} onClick={()=>setMetricFilter(v)} className={`chip ${metricFilter===v?'chip-active':'chip-inactive'}`} style={{height:'32px',padding:'0 12px',fontSize:'11px'}}>{l}</button>
            ))}
            {metricFilter==='fy'&&(<select className="staax-select" value={metricFy} onChange={e=>setMetricFy(e.target.value)} style={{width:'108px',fontSize:'11px'}}><option value="2025-26">FY 2025-26</option><option value="2024-25">FY 2024-25</option><option value="2023-24">FY 2023-24</option></select>)}
            {metricFilter==='month'&&(<select className="staax-select" value={metricMonth} onChange={e=>setMetricMonth(e.target.value)} style={{width:'90px',fontSize:'11px'}}>{MONTHS_FY.map(m=><option key={m}>{m}</option>)}</select>)}
            {metricFilter==='date'&&(<input type="date" className="staax-input" value={metricDate} onChange={e=>setMetricDate(e.target.value)} style={{width:'140px',fontSize:'11px',colorScheme:'dark'} as any}/>)}
            {metricFilter==='custom'&&(
              <div style={{display:'flex',alignItems:'center',gap:'5px'}}>
                <input type="date" className="staax-input" value={metricFrom} onChange={e=>setMetricFrom(e.target.value)} style={{width:'130px',fontSize:'11px',colorScheme:'dark'} as any}/>
                <span style={{fontSize:'11px',color:'var(--text-dim)'}}>→</span>
                <input type="date" className="staax-input" value={metricTo} onChange={e=>setMetricTo(e.target.value)} style={{width:'130px',fontSize:'11px',colorScheme:'dark'} as any}/>
              </div>
            )}
            <div style={{width:'1px',height:'20px',background:'var(--bg-border)',marginLeft:'4px'}}/>
            <div style={{display:'flex',gap:'6px'}}>
              <button className="btn btn-ghost" style={{fontSize:'11px',height:'32px',padding:'0 12px'}} disabled={downloading} onClick={()=>handleDownload('csv')}>{downloading?'⏳':'⬇'} CSV</button>
              <button className="btn btn-ghost" style={{fontSize:'11px',height:'32px',padding:'0 12px'}} disabled={downloading} onClick={()=>handleDownload('excel')}>⬇ Excel</button>
            </div>
          </div>
        </div>
        <div style={{overflowX:'auto',padding:'0 16px 16px'}}>
          <table className="staax-table" style={{borderCollapse:'separate',borderSpacing:0}}>
            <thead>
              <tr>
                <th style={{minWidth:'130px',position:'sticky',left:0,zIndex:2,background:'var(--bg-secondary)',boxShadow:'2px 0 4px rgba(0,0,0,0.15)'}}>Key Metrics</th>
                {algoMetrics.map((a:any)=><th key={a.algo_id}>{a.name}</th>)}
                <th style={{color:'var(--accent-blue)',position:'sticky',right:0,zIndex:2,background:'var(--bg-secondary)',boxShadow:'-2px 0 4px rgba(0,0,0,0.15)'}}>Cumulative</th>
              </tr>
            </thead>
            <tbody>
              {METRIC_ROWS.map(row=>{
                const cumVal=algoMetrics.reduce((s:number,a:any)=>s+(a[row.key]||0),0)
                const isPct=row.key==='win_pct'||row.key==='loss_pct'
                const isCurrency=row.key==='total_pnl'||row.key==='max_profit'||row.key==='max_loss'
                const fmt=(n:number)=>isPct?(Math.abs(n).toFixed(1)+"%"):isCurrency?((n<0?"-":"")+"₹"+Math.abs(n).toLocaleString("en-IN",{maximumFractionDigits:2})):String(Math.round(Math.abs(n)))
                const cumFmt=isPct?(algoMetrics.length>0?(cumVal/algoMetrics.length).toFixed(1)+"%":"0%"):isCurrency?((cumVal<0?"-":"")+"₹"+Math.abs(cumVal).toLocaleString("en-IN",{maximumFractionDigits:2})):String(Math.round(Math.abs(cumVal)))
                return(
                  <tr key={row.key}>
                    <td style={{fontWeight:600,color:'var(--text-muted)',fontSize:'12px',position:'sticky',left:0,background:'var(--bg-primary)',zIndex:1,boxShadow:'2px 0 4px rgba(0,0,0,0.1)'}}>{row.label}</td>
                    {algoMetrics.map((a:any)=><td key={a.algo_id} style={{color:(a as any)[row.key]<0?'var(--red)':'var(--green)',fontWeight:600}}>{fmt((a as any)[row.key])}</td>)}
                    <td style={{color:'var(--accent-blue)',fontWeight:700,position:'sticky',right:0,background:'var(--bg-primary)',zIndex:1,boxShadow:'-2px 0 4px rgba(0,0,0,0.1)'}}>{cumFmt}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
