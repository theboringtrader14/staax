import { useStore } from '@/store'
import { reportsAPI } from '@/services/api'
import { useState, useEffect, useMemo } from 'react'
import { StaaxSelect } from '@/components/StaaxSelect'
import { getCurrentFY, getFYOptions } from '@/utils/fy'
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

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


function MiniCal({month,year,label,selected,onToggle,calendarData}:{month:number,year:number,label:string,selected:boolean,onToggle:()=>void,calendarData:Record<string,number>}){
  const today=new Date()
  const monthStart=new Date(year,month-1,1)
  const isFutureMonth=monthStart>today
  const firstDow=monthStart.getDay(),offset=(firstDow===0?4:firstDow-1)%5
  const tradingDays=Array.from({length:new Date(year,month,0).getDate()},(_,i)=>i+1).filter(d=>{const dow=new Date(year,month-1,d).getDay();return dow!==0&&dow!==6})
  const monthPnlValues = tradingDays.map(d => {
    const dk = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`
    return calendarData[dk] ?? null
  }).filter((v): v is number => v !== null)
  const maxProfit = Math.max(...monthPnlValues.filter(v => v > 0), 1)
  const maxLoss   = Math.max(...monthPnlValues.filter(v => v < 0).map(Math.abs), 1)
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
      background:selected?'rgba(22,22,25,0.92)':'rgba(22,22,25,0.72)',
      border:`0.5px solid ${selected?'rgba(255,107,0,0.65)':'rgba(255,107,0,0.22)'}`,
      boxShadow:selected?'0 0 20px rgba(255,107,0,0.20), 0 4px 24px rgba(0,0,0,0.55)':'0 4px 24px rgba(0,0,0,0.45)',
      backdropFilter:'blur(20px)',
      borderRadius:'8px',padding:'8px 10px 10px 10px',
      cursor:isFutureMonth||!hasRealData?'default':'pointer',
      transition:'all 0.12s',
      display:'flex',flexDirection:'column',
      opacity:isFutureMonth?0.35:1,
    }}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'4px',flexShrink:0}}>
        <span style={{fontFamily:'var(--font-display)',fontSize:'11px',fontWeight:600,letterSpacing:'0.5px',color:selected?'var(--indigo)':'rgba(232,232,248,0.5)',textTransform:'uppercase' as const}}>{label}</span>
        {hasRealData&&<span style={{fontSize:'10px',fontWeight:700,color:monthPnl>=0?'var(--green)':'var(--red)'}}>{monthPnl>=0?'+':''}{(monthPnl/1000).toFixed(1)}k</span>}
      </div>
      {hasRealData&&total>0&&<div style={{height:'3px',borderRadius:'2px',background:'var(--bg-border)',marginBottom:'6px',overflow:'hidden',display:'flex',flexShrink:0}}><div style={{width:`${(winDays/total)*100}%`,height:'100%',background:'var(--green)'}}/><div style={{width:`${(lossDays/total)*100}%`,height:'100%',background:'var(--red)'}}/></div>}
      {!hasRealData&&!isFutureMonth&&<div style={{height:'3px',marginBottom:'6px',flexShrink:0}}/>}
      <div style={{display:'flex',gap:'1px',marginBottom:'2px',flexShrink:0}}>
        {['M','T','W','T','F'].map((d,i)=><div key={i} style={{flex:1,textAlign:'center' as const,fontSize:'8px',color:'rgba(255,255,255,0.25)',fontFamily:'var(--font-mono)'}}>{d}</div>)}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:'1px',alignContent:'start',width:'100%'}}>
        {padded.map((day,i)=>{
          if(!day) return <div key={i} style={{aspectRatio:'1'}}/>
          const dateKey=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`
          const pnl=calendarData[dateKey]??null
          const isFuture=new Date(year,month-1,day)>today
          const bg = pnl !== null
            ? pnl > 0
              ? `rgba(34,221,136,${Math.min(0.9, (pnl / maxProfit) * 0.8 + 0.1).toFixed(2)})`
              : `rgba(255,68,68,${Math.min(0.9, (Math.abs(pnl) / maxLoss) * 0.8 + 0.1).toFixed(2)})`
            : 'rgba(255,255,255,0.04)'
          return(
            <div key={i} title={pnl != null ? `${pnl >= 0 ? '+' : ''}₹${pnl.toLocaleString('en-IN')}` : undefined} style={{
              aspectRatio: '1',
              borderRadius: '3px',
              background: isFuture ? 'rgba(255,255,255,0.02)' : bg,
              opacity: isFuture ? 0.1 : 1,
              cursor: (!isFuture && pnl != null) ? 'pointer' : 'default',
            }}/>
          )
        })}
      </div>
    </div>
  )
}

function MonthDetail({month,year,calendarData}:{month:number,year:number,label:string,calendarData:Record<string,number>}){
  const today=new Date()
  const firstDow=new Date(year,month-1,1).getDay(),offset=(firstDow===0?4:firstDow-1)%5
  const tradingDays=Array.from({length:new Date(year,month,0).getDate()},(_,i)=>i+1).filter(d=>{const dow=new Date(year,month-1,d).getDay();return dow!==0&&dow!==6})
  const padded=[...Array(offset).fill(null),...tradingDays]
  return(
    <div style={{background:'var(--glass-bg)',backdropFilter:'blur(20px)',WebkitBackdropFilter:'blur(20px)',border:'0.5px solid rgba(255,107,0,0.35)',borderRadius:'8px',padding:'16px',marginTop:'12px'}}>
      <div style={{display:'grid',gridTemplateColumns:'repeat(5, 1fr)',gap:'4px',marginBottom:'4px'}}>
        {['Mon','Tue','Wed','Thu','Fri'].map(d=><div key={d} style={{textAlign:'center',fontSize:'10px',color:'var(--text-dim)',fontWeight:600}}>{d}</div>)}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(5, 1fr)',gap:'4px'}}>
        {padded.map((day,i)=>{
          if(!day)return <div key={i}/>
          const dateKey=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`
          const pnl=calendarData[dateKey]??null
          const isFuture=new Date(year,month-1,day)>today
          return <div key={i} style={{
            minHeight: '44px',
            borderRadius: '6px',
            textAlign: 'center' as const,
            opacity: isFuture ? 0.2 : 1,
            background: pnl == null ? 'transparent' : pnl > 0
              ? `rgba(34,221,136,${Math.min(pnl/8000,1)*0.35+0.08})`
              : `rgba(239,68,68,${Math.min(Math.abs(pnl)/3000,1)*0.35+0.08})`,
            display: 'flex',
            flexDirection: 'column' as const,
            alignItems: 'center',
            justifyContent: 'center',
            gap: '1px',
          }}>
            <div style={{fontSize:'11px', fontWeight:600, color:'var(--text-muted)', lineHeight:1}}>{day}</div>
            {pnl != null && (
              <div style={{fontSize:'9px', fontWeight:700, lineHeight:1, color: pnl > 0 ? 'var(--green)' : 'var(--red)'}}>
                {pnl > 0 ? '+' : ''}{(pnl/1000).toFixed(1)}k
              </div>
            )}
            {pnl == null && !isFuture && (
              <div style={{fontSize:'9px', color:'var(--text-dim)', lineHeight:1}}>—</div>
            )}
          </div>
        })}
      </div>
    </div>
  )
}

export default function ReportsPage(){
  const isPractixMode = useStore(s => s.isPractixMode)
  const activeAccount = useStore(s => s.activeAccount)
  const [fy,setFy]=useState(getCurrentFY())
  const [monthModal,setMonthModal]=useState<{month:number,year:number,label:string}|null>(null)
  const [metricFilter,setMetricFilter]=useState('fy')
  const [metricFy,setMetricFy]=useState(getCurrentFY())
  const [metricMonth,setMetricMonth]=useState(()=>{const n=new Date();return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}`})
  const monthOptions=useMemo(()=>{const opts=[];const n=new Date();for(let i=0;i<24;i++){const d=new Date(n.getFullYear(),n.getMonth()-i,1);const val=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;const label=d.toLocaleString('en-IN',{month:'short',year:'numeric'});opts.push({value:val,label})}return opts},[])
  const [metricDate,setMetricDate]=useState('')
  const [metricFrom,setMetricFrom]=useState('')
  const [metricTo,setMetricTo]=useState('')
  const [downloading, setDownloading] = useState(false)
  const [closeHover, setCloseHover] = useState(false)
  const [algoMetrics, setAlgoMetrics] = useState<any[]>([])
  const [fyMetrics, setFyMetrics] = useState<any[]>([])
  const [calendarData, setCalendarData] = useState<Record<string,number>>({})
  const [equityCurve, setEquityCurve] = useState<any[]>([])
  const [fyTotal, setFyTotal] = useState(0)

  // FY-level metrics — always FY scope, drives summary cards
  useEffect(() => {
    const acctParam = activeAccount ? { account_id: activeAccount } : {}
    reportsAPI.metrics({ fy, is_practix: isPractixMode, ...acctParam }).then(r => setFyMetrics(r.data?.metrics || [])).catch(() => {})
  }, [fy, isPractixMode, activeAccount])

  useEffect(() => {
    // Derive date range from active metric filter
    let metricParams: Record<string, any> = { fy: metricFy }
    if (metricFilter === 'month' && metricMonth) {
      const [yr, mo] = metricMonth.split('-')
      const lastDay = new Date(parseInt(yr), parseInt(mo), 0).getDate()
      metricParams = { ...metricParams, start_date: `${yr}-${mo}-01`, end_date: `${yr}-${mo}-${lastDay}` }
    } else if (metricFilter === 'date' && metricDate) {
      metricParams = { ...metricParams, start_date: metricDate, end_date: metricDate }
    } else if (metricFilter === 'custom' && metricFrom && metricTo) {
      metricParams = { ...metricParams, start_date: metricFrom, end_date: metricTo }
    }
    const acctParam = activeAccount ? { account_id: activeAccount } : {}
    reportsAPI.metrics({ ...metricParams, ...acctParam, is_practix: isPractixMode }).then(r => setAlgoMetrics(r.data?.metrics || [])).catch(() => {})

    reportsAPI.calendar({ fy, is_practix: isPractixMode, ...acctParam }).then(r => {
      const map: Record<string,number> = {}
      ;(r.data?.calendar || []).forEach((d: any) => { map[d.date] = d.pnl })
      setCalendarData(map)
    }).catch(() => {})
    reportsAPI.equityCurve({ fy, is_practix: isPractixMode, ...acctParam }).then(r => {
      setEquityCurve(r.data?.data || [])
      setFyTotal(r.data?.total || 0)
    }).catch(() => {})
  }, [fy, isPractixMode, activeAccount, metricFilter, metricFy, metricMonth, metricDate, metricFrom, metricTo])

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

  const [chartModal,setChartModal]=useState(false)

  const months=fyMonths(fy)
  const totalPnl=fyTotal
  const fyWins=fyMetrics.reduce((s:number,a:any)=>s+a.wins,0)
  const fyLosses=fyMetrics.reduce((s:number,a:any)=>s+a.losses,0)
  const fyTrades=fyMetrics.reduce((s:number,a:any)=>s+a.trades,0)
  const fyWinRate=fyTrades>0?fyWins/fyTrades*100:0
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
          <h1 style={{fontFamily:'var(--font-display)',fontSize:'22px',fontWeight:800,color:'var(--ox-radiant)'}}>Reports</h1>
          <p style={{fontSize:'12px',color:'var(--text-muted)',marginTop:'2px',display:'flex',alignItems:'center',gap:'6px'}}>
            Performance analytics ·{' '}
            <span className={'chip ' + (isPractixMode ? 'chip-warn' : 'chip-success')} style={{ fontSize:'10px', padding:'2px 8px' }}>
              {isPractixMode ? 'PRACTIX' : 'LIVE'}
            </span>
          </p>
        </div>
        <div className="page-header-actions">
          <StaaxSelect
            value={fy}
            onChange={setFy}
            options={getFYOptions(3)}
            width="130px"
          />
          <div style={{display:'flex',gap:'6px'}}>
            <button className="btn btn-ghost" style={{fontSize:'11px'}} disabled={downloading} onClick={()=>handleDownload('csv')}>{downloading?'⏳':'⬇'} CSV</button>
            <button className="btn btn-ghost" style={{fontSize:'11px'}} disabled={downloading} onClick={()=>handleDownload('excel')}>⬇ Excel</button>
          </div>
        </div>
      </div>

      {/* Top widgets — 4 columns: FY P&L (wider), Trades, Win Rate, Day P&L */}
      <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 2fr',gap:'12px',marginBottom:'12px'}}>
        {/* FY P&L */}
        <div className="card card-stat cloud-fill" style={{cursor:'pointer', maxHeight:'127px', overflow:'hidden',
          '--stat-rgb': '255,107,0',
          boxShadow: '0 0 22px rgba(255,107,0,0.22), 0 6px 24px rgba(0,0,0,0.5)',
        } as React.CSSProperties} onClick={()=>setChartModal(true)}>
          <div style={{fontSize:'10px',color:'rgba(232,232,248,0.5)',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:'4px',fontWeight:600}}>FY {fy} Total P&L&nbsp;<span style={{fontSize:'9px',color:'var(--ox-radiant)'}}>↗</span></div>
          <div style={{display:'flex',alignItems:'flex-end',gap:'12px'}}>
            <div>
              <div style={{
                fontSize:'26px', fontWeight:700, lineHeight:1,
                fontFamily:'var(--font-mono)',
                color: totalPnl > 0 ? 'var(--green)' : totalPnl < 0 ? 'var(--red)' : '#F0F0FF',
              }}>
                {totalPnl!==0?(Math.abs(totalPnl)>=100000?'₹'+(Math.abs(totalPnl)/100000).toFixed(2)+'L':'₹'+Math.abs(totalPnl).toLocaleString('en-IN',{maximumFractionDigits:2})):'—'}
              </div>
              <div style={{fontSize:'10px',color:totalPnl>=0?'var(--green)':'var(--red)',marginTop:'2px'}}>{totalPnl!==0?(totalPnl>0?'▲ Profit':'▼ Loss'):'No trades'}</div>
            </div>
            <div style={{flex:1,height:'44px'}}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={equityCurve} margin={{top:2,right:0,bottom:0,left:0}}>
                  <defs>
                    <linearGradient id="miniEqGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={totalPnl>=0?'#22DD88':'#FF4444'} stopOpacity={0.5}/>
                      <stop offset="95%" stopColor={totalPnl>=0?'#22DD88':'#FF4444'} stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <Area type="monotone" dataKey="cumulative"
                    stroke={totalPnl>=0?'#22DD88':'#FF4444'}
                    strokeWidth={2}
                    fill="url(#miniEqGrad)"
                    dot={false}/>
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Total Trades */}
        <div className="card card-stat cloud-fill" style={{maxHeight:'127px', overflow:'hidden',
          '--stat-rgb': '255,107,0',
          boxShadow: '0 0 22px rgba(255,107,0,0.22), 0 6px 24px rgba(0,0,0,0.5)',
        } as React.CSSProperties}>
          <div style={{fontSize:'10px',color:'rgba(232,232,248,0.5)',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:'6px',fontWeight:600}}>Total Trades</div>
          <div style={{fontSize:'26px',fontWeight:700,lineHeight:1,color:'#FF6B00',fontFamily:'var(--font-mono)'}}>{fyTrades}</div>
          <div style={{fontSize:'10px',color:'var(--text-muted)',marginTop:'6px'}}>{fyMetrics.length} algos</div>
        </div>

        {/* Win Rate */}
        <div className="card card-stat cloud-fill" style={{maxHeight:'127px', overflow:'hidden',
          '--stat-rgb': '255,107,0',
          boxShadow: '0 0 22px rgba(255,107,0,0.22), 0 6px 24px rgba(0,0,0,0.5)',
        } as React.CSSProperties}>
          <div style={{fontSize:'10px',color:'rgba(232,232,248,0.5)',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:'6px',fontWeight:600}}>Win Rate</div>
          <div style={{fontSize:'26px',fontWeight:700,lineHeight:1,color:fyWins>0?'var(--green)':'rgba(232,232,248,0.35)',fontFamily:'var(--font-mono)'}}>
            {fyTrades>0?fyWinRate.toFixed(1)+'%':'—'}
          </div>
          <div style={{fontSize:'10px',color:'var(--text-muted)',marginTop:'6px'}}>{fyWins}W · {fyLosses}L</div>
        </div>

        {/* Day-of-week P&L — compact horizontal bars */}
        <div className="card cloud-fill">
        <div style={{fontSize:'10px',fontWeight:600,color:'rgba(232,232,248,0.5)',textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:'12px'}}>P&L by Day</div>
        <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-around',height:'64px',gap:'6px'}}>
          {DAY_NAMES.map(day=>{
            const pnl=dowPnl[day]||0
            const barH=pnl!==0?Math.max(Math.abs(pnl)/maxAbsDow*48,4):0
            return(
              <div key={day} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:'4px',flex:1}}>
                <div style={{display:'flex',alignItems:'flex-end',height:'48px',width:'100%',justifyContent:'center'}}>
                  {pnl!==0
                    ?<div style={{
                      width:'60%',height:`${barH}px`,borderRadius:'3px 3px 0 0',
                      background: pnl>0
                        ? 'linear-gradient(to top, rgba(34,221,136,0.5), rgba(34,221,136,0.9))'
                        : 'linear-gradient(to top, rgba(239,68,68,0.5), rgba(239,68,68,0.9))',
                      boxShadow: pnl>0?'0 0 10px rgba(34,221,136,0.45)':'0 0 10px rgba(239,68,68,0.45)',
                      transition:'height 0.4s cubic-bezier(0.4,0,0.2,1)',
                    }}/>
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
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,107,0,0.12)"/>
                  <XAxis dataKey="month" tick={{fill:'var(--text-muted)',fontSize:11}}/>
                  <YAxis tick={{fill:'var(--text-muted)',fontSize:11}} tickFormatter={v=>`₹${(v/1000).toFixed(0)}k`}/>
                  <Tooltip formatter={(v:any)=>[`₹${v.toLocaleString('en-IN')}`,'Cumulative P&L']} contentStyle={{background:'var(--bg-surface)',border:'1px solid var(--bg-border)',borderRadius:'6px'}} labelStyle={{color:'var(--text-muted)'}} itemStyle={{color:'var(--indigo)'}}/>
                  <Line type="monotone" dataKey="cumulative"
                    stroke={fyTotal>=0?'#FF6B00':'#FF4444'}
                    strokeWidth={2.5}
                    dot={{ fill: fyTotal>=0?'#FF6B00':'#FF4444', r: 4, strokeWidth: 0,
                           filter: `drop-shadow(0 0 4px ${fyTotal>=0?'rgba(255,107,0,0.8)':'rgba(239,68,68,0.8)'})` }}
                    activeDot={{ r: 6, fill: '#F0EDE8', strokeWidth: 2, stroke: fyTotal>=0?'#FF6B00':'#FF4444' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* FY Calendar */}
      <div className="card cloud-fill" style={{marginBottom:'12px', overflow:'hidden', padding:'20px 24px 24px'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'12px'}}>
          <div style={{fontSize:'11px',fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.08em'}}>FY {fy} — Full Year Calendar</div>
          <div style={{display:'flex',gap:'12px',fontSize:'11px',color:'var(--text-dim)',alignItems:'center'}}>
            <span style={{display:'flex',alignItems:'center',gap:'4px'}}><span style={{width:'8px',height:'8px',borderRadius:'2px',background:'var(--green)',display:'inline-block'}}/> Profit</span>
            <span style={{display:'flex',alignItems:'center',gap:'4px'}}><span style={{width:'8px',height:'8px',borderRadius:'2px',background:'var(--red)',display:'inline-block'}}/> Loss</span>
          </div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:'12px',width:'100%',boxSizing:'border-box' as const}}>
          {months.map(m=><MiniCal key={m.key} month={m.month} year={m.year} label={m.label} selected={monthModal?.month===m.month&&monthModal?.year===m.year} onToggle={()=>setMonthModal({ month: m.month, year: m.year, label: m.label })} calendarData={calendarData}/>)}
        </div>
      </div>

      {/* Per-Algo Metrics */}
      <div className="card cloud-fill" style={{padding:0, overflow:'hidden'}}>
        <div style={{padding:'16px 16px 12px',display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:'8px'}}>
          <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
            <div style={{fontSize:'11px',fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.08em'}}>Per-Algo Metrics</div>
            <span style={{fontSize:'11px',color:'var(--indigo)',background:'rgba(255,107,0,0.12)',padding:'2px 8px',borderRadius:'4px',fontWeight:600}}>{activePeriodLabel}</span>
          </div>
          <div style={{display:'flex',gap:'6px',alignItems:'center',flexWrap:'wrap'}}>
            {[['fy','FY'],['month','Month'],['date','Date'],['custom','Custom']].map(([v,l])=>(
              <button key={v} onClick={()=>setMetricFilter(v)} className={`chip ${metricFilter===v?'chip-active':'chip-inactive'}`} style={{height:'32px',padding:'0 12px',fontSize:'11px'}}>{l}</button>
            ))}
            {metricFilter==='fy'&&(<StaaxSelect value={metricFy} onChange={setMetricFy} options={getFYOptions(3)} width="120px"/>)}
            {metricFilter==='month'&&(<StaaxSelect value={metricMonth} onChange={setMetricMonth} options={monthOptions} width="120px"/>)}
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
        <div style={{display:'flex', overflow:'hidden', padding:'0 16px 16px'}}>
          {/* Left panel — Key Metrics labels, fixed */}
          <div style={{flexShrink:0, minWidth:'130px', overflow:'hidden', borderRadius:'8px 0 0 8px'}}>
            <table className="staax-table reports-table" style={{borderCollapse:'separate',borderSpacing:0,width:'130px',tableLayout:'fixed'}}>
              <thead>
                <tr><th style={{minWidth:'130px',padding:'10px 20px',textAlign:'center',background:'rgba(10,10,11,0.95)',boxShadow:'2px 0 4px rgba(0,0,0,0.15)',borderRadius:'8px 0 0 0'}}>Key Metrics</th></tr>
              </thead>
              <tbody>
                {METRIC_ROWS.map((row,idx)=>(
                  <tr key={row.key}>
                    <td style={{fontWeight:600,color:'var(--text-muted)',fontSize:'12px',background:'rgba(10,10,11,0.95)',boxShadow:'2px 0 4px rgba(0,0,0,0.1)',padding:'10px 20px',textAlign:'center',height:'42px',whiteSpace:'nowrap',borderRadius:idx===METRIC_ROWS.length-1?'0 0 0 8px':undefined}}>{row.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Middle panel — algo columns, scrollable */}
          <div style={{flex:1, overflowX:'auto'}}>
            <table className="staax-table reports-table" style={{borderCollapse:'separate',borderSpacing:0,width:'max-content',minWidth:'100%',tableLayout:'fixed'}}>
              <thead>
                <tr>
                  {algoMetrics.map((a:any)=><th key={a.algo_id} style={{minWidth:'90px',padding:'10px 14px',textAlign:'center'}}>{a.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {METRIC_ROWS.map(row=>{
                  const isPct=row.key==='win_pct'||row.key==='loss_pct'
                  const isCurrency=row.key==='total_pnl'||row.key==='max_profit'||row.key==='max_loss'
                  const fmt=(n:number)=>isPct?(Math.abs(n*(Math.abs(n)<=1?100:1)).toFixed(1)+"%"):isCurrency?((n<0?"-":"")+"₹"+Math.abs(n).toLocaleString("en-IN",{maximumFractionDigits:2})):String(Math.round(Math.abs(n)))
                  return(
                    <tr key={row.key}>
                      {algoMetrics.map((a:any)=>{
                        const val=(a as any)[row.key]
                        const isNeg=(val||0)<0
                        return(
                          <td key={a.algo_id} style={{color:isNeg?'var(--red)':'var(--green)',fontWeight:600,padding:'10px 14px',textAlign:'center',height:'42px'}}>
                            {fmt(val)}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {/* Right panel — Cumulative, fixed */}
          <div style={{flexShrink:0, minWidth:'130px', overflow:'hidden', borderRadius:'0 8px 8px 0'}}>
            <table className="staax-table reports-table" style={{borderCollapse:'separate',borderSpacing:0,width:'130px',tableLayout:'fixed'}}>
              <thead>
                <tr><th style={{padding:'10px 20px',textAlign:'center',background:'rgba(10,10,11,0.95)',color:'var(--indigo)',boxShadow:'-2px 0 4px rgba(0,0,0,0.15)',borderRadius:'0 8px 0 0'}}>Cumulative</th></tr>
              </thead>
              <tbody>
                {METRIC_ROWS.map((row,idx)=>{
                  const isPct=row.key==='win_pct'||row.key==='loss_pct'
                  const isCurrency=row.key==='total_pnl'||row.key==='max_profit'||row.key==='max_loss'
                  const cumVal=algoMetrics.reduce((s:number,a:any)=>s+(a[row.key]||0),0)
                  const cumFmt=isPct?(algoMetrics.length>0?(cumVal/algoMetrics.length).toFixed(1)+"%":"0%"):isCurrency?((cumVal<0?"-":"")+"₹"+Math.abs(cumVal).toLocaleString("en-IN",{maximumFractionDigits:2})):String(Math.round(Math.abs(cumVal)))
                  return(
                    <tr key={row.key}>
                      <td style={{color:'var(--indigo)',fontWeight:700,fontSize:'11px',background:'rgba(10,10,11,0.95)',boxShadow:'-2px 0 4px rgba(0,0,0,0.1)',padding:'10px 20px',textAlign:'center',height:'42px',borderRadius:idx===METRIC_ROWS.length-1?'0 0 8px 0':undefined}}>{cumFmt}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      {/* Month detail modal */}
      {monthModal && (
        <div className="modal-overlay" onClick={() => setMonthModal(null)}>
          <div className="modal-box cloud-fill" style={{ maxWidth: '480px' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '15px', fontWeight: 700, color: 'var(--ox-radiant)' }}>
                {monthModal.label} {monthModal.year}
              </div>
              <button onClick={() => setMonthModal(null)} onMouseEnter={() => setCloseHover(true)} onMouseLeave={() => setCloseHover(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: closeHover ? '#FF4444' : 'var(--text-muted)', fontSize: '18px', transition: 'color 0.15s' }}>×</button>
            </div>
            <MonthDetail month={monthModal.month} year={monthModal.year} label={monthModal.label} calendarData={calendarData} />
            {/* Month total */}
            {(() => {
              const mk = `${monthModal.year}-${String(monthModal.month).padStart(2,'0')}`
              const total = Object.keys(calendarData).filter(k => k.startsWith(mk)).reduce((s, k) => s + calendarData[k], 0)
              const winDays = Object.keys(calendarData).filter(k => k.startsWith(mk) && calendarData[k] > 0).length
              const totalDays = Object.keys(calendarData).filter(k => k.startsWith(mk)).length
              const roi = totalDays > 0 ? ((winDays / totalDays) * 100).toFixed(0) : null
              return (
                <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '0.5px solid rgba(255,107,0,0.15)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Month Total</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', fontWeight: 700, color: total >= 0 ? '#22DD88' : '#FF4444' }}>
                      {total >= 0 ? '+' : ''}₹{Math.abs(Math.round(total)).toLocaleString('en-IN')}
                    </span>
                  </div>
                  {roi !== null && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Win Rate</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 600, color: 'var(--indigo)' }}>{roi}% ({winDays}/{totalDays} days)</span>
                    </div>
                  )}
                </div>
              )
            })()}
          </div>
        </div>
      )}
    </div>
  )
}
