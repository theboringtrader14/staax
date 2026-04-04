import { useStore } from '@/store'
import { reportsAPI } from '@/services/api'
import { useState, useEffect } from 'react'
import { StaaxSelect } from '@/components/StaaxSelect'
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

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
      borderRadius:'8px',padding:'10px 10px 12px',
      cursor:isFutureMonth||!hasRealData?'default':'pointer',
      transition:'all 0.12s',height:`${CARD_H}px`,
      overflow:'hidden',display:'flex',flexDirection:'column',
      opacity:isFutureMonth?0.35:1,
    }}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'4px',flexShrink:0}}>
        <span style={{fontSize:'11px',fontWeight:700,letterSpacing:'0.06em',color:selected?'var(--indigo)':'var(--text)'}}>{label.toUpperCase()}</span>
        {hasRealData&&<span style={{fontSize:'10px',fontWeight:700,color:monthPnl>=0?'var(--green)':'var(--red)'}}>{monthPnl>=0?'+':''}{(monthPnl/1000).toFixed(1)}k</span>}
      </div>
      {hasRealData&&total>0&&<div style={{height:'3px',borderRadius:'2px',background:'var(--bg-border)',marginBottom:'6px',overflow:'hidden',display:'flex',flexShrink:0}}><div style={{width:`${(winDays/total)*100}%`,height:'100%',background:'var(--green)'}}/><div style={{width:`${(lossDays/total)*100}%`,height:'100%',background:'var(--red)'}}/></div>}
      {!hasRealData&&!isFutureMonth&&<div style={{height:'3px',marginBottom:'6px',flexShrink:0}}/>}
      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:'2px',marginBottom:'4px',flexShrink:0}}>
        {['M','T','W','T','F'].map((d,i)=><div key={i} style={{textAlign:'center',fontSize:'7px',color:'var(--text-dim)',fontWeight:700}}>{d}</div>)}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:'2px',flex:1,alignContent:'start'}}>
        {padded.map((day,i)=>{
          if(!day) return <div key={i} style={{aspectRatio:'1',minWidth:'16px',minHeight:'16px'}}/>
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
              aspectRatio:'1',minWidth:'16px',minHeight:'16px',
              borderRadius:'3px',
              background:isFuture?'rgba(255,255,255,0.02)':bg,
              opacity:isFuture?0.1:1,
            }}/>
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
    <div style={{background:'var(--glass-bg)',backdropFilter:'blur(20px)',WebkitBackdropFilter:'blur(20px)',border:'0.5px solid rgba(255,107,0,0.35)',borderRadius:'8px',padding:'16px',marginTop:'12px'}}>
      <div style={{fontSize:'12px',fontWeight:700,color:'var(--indigo)',marginBottom:'14px'}}>{label} {year} — Day View</div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:'4px',marginBottom:'4px'}}>
        {['Mon','Tue','Wed','Thu','Fri'].map(d=><div key={d} style={{textAlign:'center',fontSize:'10px',color:'var(--text-dim)',fontWeight:600}}>{d}</div>)}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:'4px'}}>
        {padded.map((day,i)=>{
          if(!day)return <div key={i}/>
          const dateKey=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`
          const pnl=calendarData[dateKey]??null
          const isFuture=new Date(year,month-1,day)>today
          return <div key={i} style={{padding:'8px 4px',borderRadius:'6px',textAlign:'center',opacity:isFuture?0.2:1,background:pnl==null?'transparent':pnl>0?`rgba(34,221,136,${Math.min(pnl/8000,1)*0.35+0.08})`:`rgba(239,68,68,${Math.min(Math.abs(pnl)/3000,1)*0.35+0.08})`}}>
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
  const activeAccount = useStore(s => s.activeAccount)
  const [fy,setFy]=useState('2025-26')
  const [monthModal,setMonthModal]=useState<{month:number,year:number,label:string}|null>(null)
  const [metricFilter,setMetricFilter]=useState('fy')
  const [metricFy,setMetricFy]=useState('2025-26')
  const [metricMonth,setMetricMonth]=useState('Apr')
  const [metricDate,setMetricDate]=useState('')
  const [metricFrom,setMetricFrom]=useState('')
  const [metricTo,setMetricTo]=useState('')
  const [downloading, setDownloading] = useState(false)
  const [algoMetrics, setAlgoMetrics] = useState<any[]>([])
  const [calendarData, setCalendarData] = useState<Record<string,number>>({})
  const [equityCurve, setEquityCurve] = useState<any[]>([])
  const [fyTotal, setFyTotal] = useState(0)

  useEffect(() => {
    // Derive date range from active metric filter
    let metricParams: Record<string, any> = { fy: metricFy }
    if (metricFilter === 'month') {
      // Map month name to number within the FY
      const monthIdx = MONTHS_FY.indexOf(metricMonth)
      const fyYear = parseInt(metricFy.split('-')[0])
      // Apr-Dec use fyYear; Jan-Mar use fyYear+1
      const mNum = monthIdx + 4  // Apr=4, May=5, ... Dec=12, Jan=13... need to wrap
      const actualMonth = mNum > 12 ? mNum - 12 : mNum
      const actualYear  = mNum > 12 ? fyYear + 1 : fyYear
      const pad = (n: number) => String(n).padStart(2, '0')
      const lastDay = new Date(actualYear, actualMonth, 0).getDate()
      metricParams = { ...metricParams, start_date: `${actualYear}-${pad(actualMonth)}-01`, end_date: `${actualYear}-${pad(actualMonth)}-${lastDay}` }
    } else if (metricFilter === 'date' && metricDate) {
      metricParams = { ...metricParams, start_date: metricDate, end_date: metricDate }
    } else if (metricFilter === 'custom' && metricFrom && metricTo) {
      metricParams = { ...metricParams, start_date: metricFrom, end_date: metricTo }
    }
    const acctParam = activeAccount ? { account_id: activeAccount } : {}
    reportsAPI.metrics({ ...metricParams, ...acctParam }).then(r => setAlgoMetrics(r.data?.metrics || [])).catch(() => {})

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
            options={[
              { value: '2025-26', label: 'FY 2025-26' },
              { value: '2024-25', label: 'FY 2024-25' },
              { value: '2023-24', label: 'FY 2023-24' },
            ]}
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
        <div className="card card-stat cloud-fill" style={{cursor:'pointer', maxHeight:'127px', overflow:'hidden', borderLeft:'3px solid #22DD88',
          '--stat-rgb': totalPnl>=0?'16,185,129':'239,68,68',
          boxShadow: `inset 0 1px 0 rgba(${totalPnl>=0?'16,185,129':'239,68,68'},0.25), 0 0 22px rgba(${totalPnl>=0?'16,185,129':'239,68,68'},0.2), 0 6px 24px rgba(0,0,0,0.5)`,
        } as React.CSSProperties} onClick={()=>setChartModal(true)}>
          <div style={{fontSize:'10px',color:'rgba(232,232,248,0.5)',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:'4px',fontWeight:600}}>FY {fy} Total P&L&nbsp;<span style={{fontSize:'9px',color:'var(--indigo)'}}>↗</span></div>
          <div style={{display:'flex',alignItems:'flex-end',gap:'12px'}}>
            <div>
              <div style={{
                fontSize:'22px',fontWeight:700,letterSpacing:'-0.02em',
                background: totalPnl>=0?'linear-gradient(135deg, #22DD88, #d4f4e8)':'linear-gradient(135deg, #FF4444, #ffd4d4)',
                WebkitBackgroundClip:'text', backgroundClip:'text',
                WebkitTextFillColor:'transparent', color:'transparent', display:'inline-block',
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
        <div className="card card-stat cloud-fill" style={{maxHeight:'127px', overflow:'hidden', borderLeft:'3px solid #FF6B00',
          '--stat-rgb': '255,107,0',
          boxShadow: 'inset 0 1px 0 rgba(255,107,0,0.25), 0 0 20px rgba(255,107,0,0.18), 0 6px 24px rgba(0,0,0,0.5)',
        } as React.CSSProperties}>
          <div style={{fontSize:'10px',color:'rgba(232,232,248,0.5)',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:'6px',fontWeight:600}}>Total Trades</div>
          <div style={{
            fontSize:'26px',fontWeight:700,lineHeight:1,
            background:'linear-gradient(135deg, #FF6B00, #FF8C33)',
            WebkitBackgroundClip:'text', backgroundClip:'text',
            WebkitTextFillColor:'transparent', color:'transparent', display:'inline-block',
          }}>{algoMetrics.reduce((s:number,a:any)=>s+a.trades,0)}</div>
          <div style={{fontSize:'10px',color:'var(--text-muted)',marginTop:'6px'}}>{algoMetrics.length} algos</div>
        </div>

        {/* Win Rate */}
        <div className="card card-stat cloud-fill" style={{maxHeight:'127px', overflow:'hidden', borderLeft:'3px solid #22DD88',
          '--stat-rgb': '204,68,0',
          boxShadow: 'inset 0 1px 0 rgba(204,68,0,0.25), 0 4px 24px rgba(0,0,0,0.55)',
        } as React.CSSProperties}>
          <div style={{fontSize:'10px',color:'rgba(232,232,248,0.5)',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:'6px',fontWeight:600}}>Win Rate</div>
          <div style={{
            fontSize:'26px',fontWeight:700,lineHeight:1,
            background: algoMetrics.reduce((s:number,a:any)=>s+a.wins,0)>0
              ? 'linear-gradient(135deg, #22DD88, #d4f4e8)'
              : 'linear-gradient(135deg, rgba(232,232,248,0.3), rgba(232,232,248,0.1))',
            WebkitBackgroundClip:'text', backgroundClip:'text',
            WebkitTextFillColor:'transparent', color:'transparent', display:'inline-block',
          }}>
            {algoMetrics.reduce((s:number,a:any)=>s+a.trades,0)>0?(algoMetrics.reduce((s:number,a:any)=>s+a.wins,0)/algoMetrics.reduce((s:number,a:any)=>s+a.trades,0)*100).toFixed(1)+'%':'—'}
          </div>
          <div style={{fontSize:'10px',color:'var(--text-muted)',marginTop:'6px'}}>{algoMetrics.reduce((s:number,a:any)=>s+a.wins,0)}W · {algoMetrics.reduce((s:number,a:any)=>s+a.losses,0)}L</div>
        </div>

        {/* Day-of-week P&L — compact horizontal bars */}
        <div className="card">
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
      <div className="card cloud-fill" style={{marginBottom:'12px', overflow:'hidden'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'12px'}}>
          <div style={{fontSize:'11px',fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.08em'}}>FY {fy} — Full Year Calendar</div>
          <div style={{display:'flex',gap:'12px',fontSize:'11px',color:'var(--text-dim)',alignItems:'center'}}>
            <span style={{display:'flex',alignItems:'center',gap:'4px'}}><span style={{width:'8px',height:'8px',borderRadius:'2px',background:'var(--green)',display:'inline-block'}}/> Profit</span>
            <span style={{display:'flex',alignItems:'center',gap:'4px'}}><span style={{width:'8px',height:'8px',borderRadius:'2px',background:'var(--red)',display:'inline-block'}}/> Loss</span>
          </div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:'12px'}}>
          {months.map(m=><MiniCal key={m.key} month={m.month} year={m.year} label={m.label} selected={monthModal?.month===m.month&&monthModal?.year===m.year} onToggle={()=>setMonthModal({ month: m.month, year: m.year, label: m.label })} calendarData={calendarData}/>)}
        </div>
      </div>

      {/* Per-Algo Metrics */}
      <div className="card" style={{padding:0, overflow:'hidden'}}>
        <div style={{padding:'16px 16px 12px',display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:'8px'}}>
          <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
            <div style={{fontSize:'11px',fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.08em'}}>Per-Algo Metrics</div>
            <span style={{fontSize:'11px',color:'var(--indigo)',background:'rgba(255,107,0,0.12)',padding:'2px 8px',borderRadius:'4px',fontWeight:600}}>{activePeriodLabel}</span>
          </div>
          <div style={{display:'flex',gap:'6px',alignItems:'center',flexWrap:'wrap'}}>
            {[['fy','FY'],['month','Month'],['date','Date'],['custom','Custom']].map(([v,l])=>(
              <button key={v} onClick={()=>setMetricFilter(v)} className={`chip ${metricFilter===v?'chip-active':'chip-inactive'}`} style={{height:'32px',padding:'0 12px',fontSize:'11px'}}>{l}</button>
            ))}
            {metricFilter==='fy'&&(<StaaxSelect value={metricFy} onChange={setMetricFy} options={[{value:'2025-26',label:'FY 2025-26'},{value:'2024-25',label:'FY 2024-25'},{value:'2023-24',label:'FY 2023-24'}]} width="120px"/>)}
            {metricFilter==='month'&&(<StaaxSelect value={metricMonth} onChange={setMetricMonth} options={MONTHS_FY.map(m=>({value:m,label:m}))} width="100px"/>)}
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
        <div style={{overflowX:'auto',width:'100%',padding:'0 16px 16px'}}>
          <table className="staax-table reports-table" style={{borderCollapse:'separate',borderSpacing:0,width:'max-content',minWidth:'100%'}}>
            <thead>
              <tr>
                <th style={{minWidth:'130px',position:'sticky',left:0,zIndex:2,background:'rgba(10,10,11,0.95)',boxShadow:'2px 0 4px rgba(0,0,0,0.15)',padding:'10px 14px',textAlign:'left'}}>Key Metrics</th>
                {algoMetrics.map((a:any)=><th key={a.algo_id} style={{minWidth:'90px',padding:'10px 14px',textAlign:'center'}}>{a.name}</th>)}
                <th style={{color:'var(--indigo)',position:'sticky',right:0,zIndex:2,background:'#0A0A0B',boxShadow:'-2px 0 4px rgba(0,0,0,0.15)',padding:'10px 14px',textAlign:'center'}}>Cumulative</th>
              </tr>
            </thead>
            <tbody>
              {METRIC_ROWS.map(row=>{
                const cumVal=algoMetrics.reduce((s:number,a:any)=>s+(a[row.key]||0),0)
                const isPct=row.key==='win_pct'||row.key==='loss_pct'
                const isCurrency=row.key==='total_pnl'||row.key==='max_profit'||row.key==='max_loss'
                const fmt=(n:number)=>isPct?(Math.abs(n*(Math.abs(n)<=1?100:1)).toFixed(1)+"%"):isCurrency?((n<0?"-":"")+"₹"+Math.abs(n).toLocaleString("en-IN",{maximumFractionDigits:2})):String(Math.round(Math.abs(n)))
                const cumFmt=isPct?(algoMetrics.length>0?(cumVal/algoMetrics.length).toFixed(1)+"%":"0%"):isCurrency?((cumVal<0?"-":"")+"₹"+Math.abs(cumVal).toLocaleString("en-IN",{maximumFractionDigits:2})):String(Math.round(Math.abs(cumVal)))
                // For currency rows: compute max abs value for proportional bar width
                const maxAbs = isCurrency
                  ? Math.max(...algoMetrics.map((a:any)=>Math.abs((a as any)[row.key]||0)), 1)
                  : 1
                return(
                  <tr key={row.key}>
                    <td style={{fontWeight:600,color:'var(--text-muted)',fontSize:'12px',position:'sticky',left:0,zIndex:1,background:'rgba(10,10,11,0.95)',boxShadow:'2px 0 4px rgba(0,0,0,0.1)',padding:'10px 14px',textAlign:'left'}}>{row.label}</td>
                    {algoMetrics.map((a:any)=>{
                      const val=(a as any)[row.key]
                      const barPct=isCurrency?Math.round(Math.abs(val||0)/maxAbs*100):0
                      const isNeg=(val||0)<0
                      return(
                        <td key={a.algo_id} style={{color:isNeg?'var(--red)':'var(--green)',fontWeight:600,padding:'10px 14px',position:'relative',textAlign:'center' as const}}>
                          {isCurrency&&barPct>0&&(
                            <div style={{
                              position:'absolute',bottom:0,left:0,height:'3px',
                              width:`${barPct}%`,
                              background:isNeg?'rgba(239,68,68,0.45)':'rgba(34,221,136,0.45)',
                              borderRadius:'0 2px 0 0',
                            }}/>
                          )}
                          {fmt(val)}
                        </td>
                      )
                    })}
                    <td style={{color:'var(--indigo)',fontWeight:700,fontSize:'11px',position:'sticky',right:0,background:'#0A0A0B',zIndex:1,boxShadow:'-2px 0 4px rgba(0,0,0,0.1)',padding:'10px 14px',textAlign:'center' as const}}>{cumFmt}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      {/* Month detail modal */}
      {monthModal && (
        <div className="modal-overlay" onClick={() => setMonthModal(null)}>
          <div className="modal-box cloud-fill" style={{ maxWidth: '480px', maxHeight: '80vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '15px', fontWeight: 700, color: 'var(--ox-radiant)' }}>
                {monthModal.label} {monthModal.year}
              </div>
              <button onClick={() => setMonthModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '18px' }}>×</button>
            </div>
            <MonthDetail month={monthModal.month} year={monthModal.year} label={monthModal.label} calendarData={calendarData} />
            {/* Month total */}
            {(() => {
              const mk = `${monthModal.year}-${String(monthModal.month).padStart(2,'0')}`
              const total = Object.keys(calendarData).filter(k => k.startsWith(mk)).reduce((s, k) => s + calendarData[k], 0)
              return (
                <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '0.5px solid rgba(255,107,0,0.15)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Month Total</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', fontWeight: 700, color: total >= 0 ? '#22DD88' : '#FF4444' }}>
                    {total >= 0 ? '+' : ''}₹{Math.abs(Math.round(total)).toLocaleString('en-IN')}
                  </span>
                </div>
              )
            })()}
          </div>
        </div>
      )}
    </div>
  )
}
