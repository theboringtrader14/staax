import { useStore } from '@/store'
import { reportsAPI } from '@/services/api'
import { useState, useEffect, useMemo } from 'react'
import React from 'react'
import { StaaxSelect } from '@/components/StaaxSelect'
import { getCurrentFY, getFYOptions } from '@/utils/fy'
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { AlgoDetailModal } from '@/components/AlgoDetailModal'
import { X as IconX, DownloadSimple } from '@phosphor-icons/react'

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']

const METRIC_ROWS = [
  { key: 'total_pnl',    label: 'Overall P&L', isLoss: false },
  { key: 'wins',         label: 'Wins',        isLoss: false },
  { key: 'losses',       label: 'Losses',      isLoss: true  },
  { key: 'win_pct',      label: 'Win %',       isLoss: false },
  { key: 'loss_pct',     label: 'Loss %',      isLoss: true  },
  { key: 'max_profit',   label: 'Max Profit',  isLoss: false },
  { key: 'max_loss',     label: 'Max Loss',    isLoss: true  },
  { key: 'trades',       label: 'Trades',      isLoss: false },
  { key: 'avg_day_pnl',  label: 'Avg Day P&L', isLoss: false },
  { key: 'max_drawdown', label: 'Max Drawdown', isLoss: true },
  { key: 'roi',          label: 'ROI %',       isLoss: false },
]

function fyMonths(fy: string) {
  const sy = parseInt(fy.split('-')[0])
  return [4,5,6,7,8,9,10,11,12,1,2,3].map(m => ({
    month: m,
    year: m >= 4 ? sy : sy + 1,
    label: ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m],
    key: `${m}-${m >= 4 ? sy : sy + 1}`,
  }))
}

const cardSt: React.CSSProperties = {
  background: 'var(--bg)',
  boxShadow: 'var(--neu-raised)',
  borderRadius: '16px',
  padding: '20px 24px',
}

const neuModal: React.CSSProperties = {
  background: 'var(--bg)',
  boxShadow: 'var(--neu-raised-lg, var(--neu-raised))',
  borderRadius: '24px',
  padding: '28px',
}

const closeBtnSt: React.CSSProperties = {
  width: 32, height: 32, borderRadius: '50%',
  background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)',
  border: 'none', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: 'var(--text-dim)', flexShrink: 0,
  transition: 'color 0.15s',
}

const btnSt = (active: boolean): React.CSSProperties => ({
  height: '30px', padding: '0 14px',
  borderRadius: '100px', border: 'none', cursor: 'pointer',
  fontSize: '11px', fontWeight: 600, fontFamily: 'inherit',
  background: 'var(--bg)',
  boxShadow: active ? 'var(--neu-inset)' : 'var(--neu-raised-sm)',
  color: active ? 'var(--accent)' : 'var(--text-dim)',
  transition: 'box-shadow 0.15s, color 0.15s',
})

const dlBtnSt: React.CSSProperties = {
  height: '30px', padding: '0 14px',
  borderRadius: '100px', border: 'none', cursor: 'pointer',
  fontSize: '11px', fontWeight: 600, fontFamily: 'inherit',
  background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)',
  color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: '5px',
  transition: 'color 0.15s',
}

const inpSt: React.CSSProperties = {
  height: '30px', padding: '0 12px',
  borderRadius: '100px', border: 'none', outline: 'none',
  fontSize: '11px', fontFamily: 'inherit',
  background: 'var(--bg)', boxShadow: 'var(--neu-inset)',
  color: 'var(--text)',
}

function MiniCal({ month, year, label, selected, onToggle, calendarData }: {
  month: number, year: number, label: string, selected: boolean,
  onToggle: () => void, calendarData: Record<string, number>
}) {
  const today = new Date()
  const monthStart = new Date(year, month - 1, 1)
  const isFutureMonth = monthStart > today
  const firstDow = monthStart.getDay(), offset = (firstDow === 0 ? 4 : firstDow - 1) % 5
  const tradingDays = Array.from({ length: new Date(year, month, 0).getDate() }, (_, i) => i + 1)
    .filter(d => { const dow = new Date(year, month - 1, d).getDay(); return dow !== 0 && dow !== 6 })
  const monthPnlValues = tradingDays.map(d => {
    const dk = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    return calendarData[dk] ?? null
  }).filter((v): v is number => v !== null)
  const maxProfit = Math.max(...monthPnlValues.filter(v => v > 0), 1)
  const maxLoss   = Math.max(...monthPnlValues.filter(v => v < 0).map(Math.abs), 1)
  const padded = [...Array(offset).fill(null), ...tradingDays]
  const monthKey = `${year}-${String(month).padStart(2, '0')}`
  const monthPnl = Object.keys(calendarData).filter(k => k.startsWith(monthKey)).reduce((s, k) => s + calendarData[k], 0)
  const hasRealData = Object.keys(calendarData).some(k => k.startsWith(monthKey))
  const winDays = Object.keys(calendarData).filter(k => k.startsWith(monthKey) && calendarData[k] > 0).length
  const lossDays = Object.keys(calendarData).filter(k => k.startsWith(monthKey) && calendarData[k] <= 0).length
  const total = winDays + lossDays
  const handleClick = () => { if (!isFutureMonth && hasRealData) onToggle() }

  return (
    <div onClick={handleClick} style={{
      background: 'var(--bg)',
      boxShadow: selected ? 'var(--neu-inset)' : 'var(--neu-raised-sm)',
      borderRadius: '16px',
      padding: '10px 12px 12px',
      cursor: isFutureMonth || !hasRealData ? 'default' : 'pointer',
      transition: 'box-shadow 0.15s',
      display: 'flex', flexDirection: 'column',
      opacity: isFutureMonth ? 0.35 : 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px', flexShrink: 0 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: '11px', fontWeight: 600, letterSpacing: '0.5px', color: selected ? 'var(--accent)' : 'var(--text-dim)', textTransform: 'uppercase' as const }}>{label}</span>
        {hasRealData && <span style={{ fontSize: '10px', fontWeight: 700, color: monthPnl >= 0 ? '#0ea66e' : '#FF4444' }}>{monthPnl >= 0 ? '+' : ''}{(monthPnl / 1000).toFixed(1)}k</span>}
      </div>
      {hasRealData && total > 0 && (
        <div style={{ height: '3px', borderRadius: '2px', background: 'var(--border)', marginBottom: '6px', overflow: 'hidden', display: 'flex', flexShrink: 0 }}>
          <div style={{ width: `${(winDays / total) * 100}%`, height: '100%', background: '#0ea66e' }} />
          <div style={{ width: `${(lossDays / total) * 100}%`, height: '100%', background: '#FF4444' }} />
        </div>
      )}
      {!hasRealData && !isFutureMonth && <div style={{ height: '3px', marginBottom: '6px', flexShrink: 0 }} />}
      <div style={{ display: 'flex', gap: '1px', marginBottom: '2px', flexShrink: 0 }}>
        {['M','T','W','T','F'].map((d, i) => (
          <div key={i} style={{ flex: 1, textAlign: 'center' as const, fontSize: '8px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{d}</div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '1px', alignContent: 'start', width: '100%' }}>
        {padded.map((day, i) => {
          if (!day) return <div key={i} style={{ aspectRatio: '1' }} />
          const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const pnl = calendarData[dateKey] ?? null
          const isFuture = new Date(year, month - 1, day) > today
          const bg = pnl !== null
            ? pnl > 0
              ? `rgba(14,166,110,${Math.min(0.9, (pnl / maxProfit) * 0.8 + 0.1).toFixed(2)})`
              : `rgba(255,68,68,${Math.min(0.9, (Math.abs(pnl) / maxLoss) * 0.8 + 0.1).toFixed(2)})`
            : 'rgba(128,128,128,0.06)'
          return (
            <div key={i} title={pnl != null ? `${pnl >= 0 ? '+' : ''}₹${pnl.toLocaleString('en-IN')}` : undefined} style={{
              aspectRatio: '1',
              borderRadius: '3px',
              background: isFuture ? 'rgba(128,128,128,0.03)' : bg,
              opacity: isFuture ? 0.1 : 1,
            }} />
          )
        })}
      </div>
    </div>
  )
}

function MonthDetail({ month, year, calendarData }: { month: number, year: number, label: string, calendarData: Record<string, number> }) {
  const today = new Date()
  const firstDow = new Date(year, month - 1, 1).getDay(), offset = (firstDow === 0 ? 4 : firstDow - 1) % 5
  const tradingDays = Array.from({ length: new Date(year, month, 0).getDate() }, (_, i) => i + 1)
    .filter(d => { const dow = new Date(year, month - 1, d).getDay(); return dow !== 0 && dow !== 6 })
  const padded = [...Array(offset).fill(null), ...tradingDays]

  return (
    <div style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)', borderRadius: '12px', padding: '16px', marginTop: '12px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '4px', marginBottom: '6px' }}>
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: '10px', color: 'var(--text-dim)', fontWeight: 600 }}>{d}</div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '4px' }}>
        {padded.map((day, i) => {
          if (!day) return <div key={i} />
          const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const pnl = calendarData[dateKey] ?? null
          const isFuture = new Date(year, month - 1, day) > today
          return (
            <div key={i} style={{
              minHeight: '44px',
              borderRadius: '8px',
              background: pnl == null
                ? 'transparent'
                : pnl > 0
                  ? `rgba(14,166,110,${(Math.min(pnl / 8000, 1) * 0.28 + 0.06).toFixed(2)})`
                  : `rgba(255,68,68,${(Math.min(Math.abs(pnl) / 3000, 1) * 0.28 + 0.06).toFixed(2)})`,
              boxShadow: 'none',
              textAlign: 'center' as const,
              opacity: isFuture ? 0.2 : 1,
              display: 'flex', flexDirection: 'column' as const,
              alignItems: 'center', justifyContent: 'center', gap: '1px',
            }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-dim)', lineHeight: 1 }}>{day}</div>
              {pnl != null && (
                <div style={{ fontSize: '9px', fontWeight: 700, lineHeight: 1, color: pnl > 0 ? '#0ea66e' : '#FF4444' }}>
                  {pnl > 0 ? '+' : ''}{(pnl / 1000).toFixed(1)}k
                </div>
              )}
              {pnl == null && !isFuture && (
                <div style={{ fontSize: '9px', color: 'var(--text-dim)', lineHeight: 1 }}>—</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function ReportsPage() {
  const isPractixMode  = useStore(s => s.isPractixMode)
  const activeAccount  = useStore(s => s.activeAccount)
  const [fy, setFy]    = useState(getCurrentFY())
  const [monthModal, setMonthModal]     = useState<{ month: number, year: number, label: string } | null>(null)
  const [metricFilter, setMetricFilter] = useState('fy')
  const [metricFy, setMetricFy]         = useState(getCurrentFY())
  const [metricMonth, setMetricMonth]   = useState(() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}` })
  const monthOptions = useMemo(() => {
    const opts = []; const n = new Date()
    for (let i = 0; i < 24; i++) {
      const d = new Date(n.getFullYear(), n.getMonth() - i, 1)
      const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const label = d.toLocaleString('en-IN', { month: 'short', year: 'numeric' })
      opts.push({ value: val, label })
    }
    return opts
  }, [])
  const [metricDate, setMetricDate]   = useState('')
  const [metricFrom, setMetricFrom]   = useState('')
  const [metricTo, setMetricTo]       = useState('')
  const [downloading, setDownloading] = useState(false)
  const [downloadModal, setDownloadModal] = useState<'csv' | 'excel' | null>(null)
  const [downloadType, setDownloadType] = useState<'algo' | 'daywise'>('algo')
  const [selectedAlgo, setSelectedAlgo] = useState<string | null>(null)
  const [algoMetrics, setAlgoMetrics] = useState<any[]>([])
  const [fyMetrics, setFyMetrics]     = useState<any[]>([])
  const [calendarData, setCalendarData] = useState<Record<string, number>>({})
  const [equityCurve, setEquityCurve] = useState<any[]>([])
  const [fyTotal, setFyTotal]         = useState(0)
  const [chartModal, setChartModal]   = useState(false)

  useEffect(() => {
    const acctParam = activeAccount ? { account_id: activeAccount } : {}
    reportsAPI.metrics({ fy, is_practix: isPractixMode, ...acctParam }).then(r => setFyMetrics(r.data?.metrics || [])).catch(() => {})
  }, [fy, isPractixMode, activeAccount])

  useEffect(() => {
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
      const map: Record<string, number> = {}
      ;(r.data?.calendar || []).forEach((d: any) => { map[d.date] = d.pnl })
      setCalendarData(map)
    }).catch(() => {})
    reportsAPI.equityCurve({ fy, is_practix: isPractixMode, ...acctParam }).then(r => {
      setEquityCurve(r.data?.data || [])
      setFyTotal(r.data?.total || 0)
    }).catch(() => {})
  }, [fy, isPractixMode, activeAccount, metricFilter, metricFy, metricMonth, metricDate, metricFrom, metricTo])

  const handleDownload = async (format: 'csv' | 'excel', reportType: 'algo' | 'daywise') => {
    setDownloading(true)
    try {
      const response = await reportsAPI.download({ fy, format, report_type: reportType })
      const blob = new Blob([response.data], { type: format === 'excel' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const typeLabel = reportType === 'algo' ? 'algo_metrics' : 'daywise_logs'
      a.download = `STAAX_${typeLabel}_FY${fy}.${format === 'excel' ? 'xlsx' : 'csv'}`
      document.body.appendChild(a); a.click()
      window.URL.revokeObjectURL(url); document.body.removeChild(a)
      setDownloadModal(null)
    } catch { alert('Download failed — no data found for this FY') }
    finally { setDownloading(false) }
  }

  const months = fyMonths(fy)
  const totalPnl = fyTotal
  const fyWins   = fyMetrics.reduce((s: number, a: any) => s + a.wins, 0)
  const fyLosses = fyMetrics.reduce((s: number, a: any) => s + a.losses, 0)
  const fyTrades = fyMetrics.reduce((s: number, a: any) => s + a.trades, 0)
  const fyWinRate = fyTrades > 0 ? fyWins / fyTrades * 100 : 0
  const activePeriodLabel = metricFilter === 'fy' ? `FY ${metricFy}`
    : metricFilter === 'month' ? `${metricMonth} · FY ${fy}`
    : metricFilter === 'date' && metricDate ? metricDate
    : metricFilter === 'custom' && metricFrom && metricTo ? `${metricFrom} → ${metricTo}`
    : 'Select period'

  const dowPnl: Record<string, number> = { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0 }
  Object.entries(calendarData).forEach(([date, pnl]) => {
    const dow = new Date(date).getDay()
    const name = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dow]
    if (dowPnl[name] !== undefined) dowPnl[name] += pnl
  })
  const maxAbsDow = Math.max(...Object.values(dowPnl).map(Math.abs), 1)

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 28px 24px' }}>

      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '22px', fontWeight: 800, color: 'var(--accent)' }}>Reports</h1>
          <p style={{ fontSize: '12px', color: 'var(--text-mute)', marginTop: '4px' }}>Performance analytics</p>
        </div>
        <div className="page-header-actions" style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <StaaxSelect value={fy} onChange={setFy} options={getFYOptions(3)} width="130px" />
          <div style={{ display: 'flex', gap: '6px' }}>
            <button style={dlBtnSt} onClick={() => { setDownloadType('algo'); setDownloadModal('csv') }}>
              <DownloadSimple size={13} /> CSV
            </button>
            <button style={dlBtnSt} onClick={() => { setDownloadType('algo'); setDownloadModal('excel') }}>
              <DownloadSimple size={13} /> Excel
            </button>
          </div>
        </div>
      </div>

      {/* Top KPI cards — 4 columns */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 2fr', gap: '10px', marginBottom: '12px' }}>

        {/* FY P&L */}
        <div style={{ ...cardSt, padding: '18px 22px', cursor: 'pointer' }} onClick={() => setChartModal(true)}>
          <div style={{ fontSize: '10px', color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px', fontWeight: 600 }}>
            FY {fy} Total P&L
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px' }}>
            <div>
              <div style={{ fontSize: '22px', fontWeight: 700, lineHeight: 1, fontFamily: 'var(--font-mono)', color: totalPnl > 0 ? '#0ea66e' : totalPnl < 0 ? '#FF4444' : 'var(--text)' }}>
                {totalPnl !== 0
                  ? (Math.abs(totalPnl) >= 100000
                    ? '₹' + (Math.abs(totalPnl) / 100000).toFixed(2) + 'L'
                    : '₹' + Math.abs(totalPnl).toLocaleString('en-IN', { maximumFractionDigits: 2 }))
                  : '—'}
              </div>
              <div style={{ fontSize: '10px', color: totalPnl >= 0 ? '#0ea66e' : '#FF4444', marginTop: '3px' }}>
                {totalPnl !== 0 ? (totalPnl > 0 ? '▲ Profit' : '▼ Loss') : 'No trades'}
              </div>
            </div>
            <div style={{ flex: 1, height: '46px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={equityCurve} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="miniEqGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={totalPnl >= 0 ? '#0ea66e' : '#FF4444'} stopOpacity={0.4} />
                      <stop offset="95%" stopColor={totalPnl >= 0 ? '#0ea66e' : '#FF4444'} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area type="monotone" dataKey="cumulative"
                    stroke={totalPnl >= 0 ? '#0ea66e' : '#FF4444'}
                    strokeWidth={2} fill="url(#miniEqGrad)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Total Trades */}
        <div style={{ ...cardSt, padding: '18px 22px' }}>
          <div style={{ fontSize: '10px', color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '5px', fontWeight: 600 }}>Total Trades</div>
          <div style={{ fontSize: '22px', fontWeight: 700, lineHeight: 1, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>{fyTrades}</div>
          <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginTop: '5px' }}>{fyMetrics.length} algos</div>
        </div>

        {/* Win Rate */}
        <div style={{ ...cardSt, padding: '18px 22px' }}>
          <div style={{ fontSize: '10px', color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '5px', fontWeight: 600 }}>Win Rate</div>
          <div style={{ fontSize: '22px', fontWeight: 700, lineHeight: 1, color: fyWins > 0 ? '#0ea66e' : 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
            {fyTrades > 0 ? fyWinRate.toFixed(1) + '%' : '—'}
          </div>
          <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginTop: '5px' }}>{fyWins}W · {fyLosses}L</div>
        </div>

        {/* Day P&L bars */}
        <div style={{ ...cardSt, padding: '18px 22px' }}>
          <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '8px' }}>P&L by Day</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-around', height: '56px', gap: '6px' }}>
            {DAY_NAMES.map(day => {
              const pnl = dowPnl[day] || 0
              const barH = pnl !== 0 ? Math.max(Math.abs(pnl) / maxAbsDow * 42, 4) : 0
              return (
                <div key={day} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-end', height: '42px', width: '100%', justifyContent: 'center' }}>
                    {pnl !== 0
                      ? <div style={{
                          width: '60%', height: `${barH}px`, borderRadius: '3px 3px 0 0',
                          background: pnl > 0
                            ? 'linear-gradient(to top, rgba(14,166,110,0.5), rgba(14,166,110,0.9))'
                            : 'linear-gradient(to top, rgba(255,68,68,0.5), rgba(255,68,68,0.9))',
                          transition: 'height 0.4s cubic-bezier(0.4,0,0.2,1)',
                        }} />
                      : <div style={{ width: '60%', height: '2px', borderRadius: '2px', background: 'var(--border)', opacity: 0.4 }} />
                    }
                  </div>
                  <span style={{ fontSize: '9px', fontWeight: 700, color: 'var(--text-dim)' }}>{day.charAt(0)}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Chart modal */}
      {chartModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)', animation: 'fadeIn 0.15s ease' }} onClick={() => setChartModal(false)}>
          <div style={{ ...neuModal, maxWidth: '780px', width: '90%', animation: 'slideUp 0.18s ease' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '16px', color: 'var(--text)' }}>FY {fy} — Cumulative P&L</span>
              <button style={closeBtnSt} onClick={() => setChartModal(false)}>
                <IconX size={14} weight="bold" />
              </button>
            </div>
            <div style={{ height: '320px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={equityCurve} margin={{ top: 10, right: 20, bottom: 10, left: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="month" tick={{ fill: 'var(--text-dim)', fontSize: 11 }} />
                  <YAxis tick={{ fill: 'var(--text-dim)', fontSize: 11 }} tickFormatter={v => `₹${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    formatter={(v: any) => [`₹${v.toLocaleString('en-IN')}`, 'Cumulative P&L']}
                    contentStyle={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '10px', boxShadow: 'var(--neu-raised-sm)' }}
                    labelStyle={{ color: 'var(--text-dim)', fontSize: 11 }}
                    itemStyle={{ color: fyTotal >= 0 ? '#0ea66e' : '#FF4444' }}
                  />
                  <Line type="monotone" dataKey="cumulative"
                    stroke={fyTotal >= 0 ? '#0ea66e' : '#FF4444'}
                    strokeWidth={2.5}
                    dot={{ fill: fyTotal >= 0 ? '#0ea66e' : '#FF4444', r: 4, strokeWidth: 0 }}
                    activeDot={{ r: 6, fill: 'var(--bg)', strokeWidth: 2, stroke: fyTotal >= 0 ? '#0ea66e' : '#FF4444' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Download modal */}
      {downloadModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)', animation: 'fadeIn 0.15s ease' }} onClick={() => setDownloadModal(null)}>
          <div style={{ ...neuModal, width: '320px', maxWidth: '90vw', animation: 'slideUp 0.18s ease' }} onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '16px', color: 'var(--text)' }}>
                Export {downloadModal.toUpperCase()}
              </span>
              <button style={closeBtnSt} onClick={() => setDownloadModal(null)}>
                <IconX size={14} weight="bold" />
              </button>
            </div>
            {/* Options */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '24px' }}>
              {([
                { value: 'algo',    label: 'Per-Algo Metrics',  desc: 'Aggregated metrics per algorithm' },
                { value: 'daywise', label: 'Day-wise Logs',     desc: 'Daily P&L log for the full FY'   },
              ] as const).map(opt => (
                <button key={opt.value} onClick={() => setDownloadType(opt.value)} style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                  gap: '2px', padding: '12px 16px', borderRadius: '12px', border: 'none', cursor: 'pointer',
                  background: 'var(--bg)',
                  boxShadow: downloadType === opt.value ? 'var(--neu-inset)' : 'var(--neu-raised-sm)',
                  textAlign: 'left', transition: 'box-shadow 0.15s',
                  fontFamily: 'inherit',
                }}>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: downloadType === opt.value ? 'var(--accent)' : 'var(--text)' }}>
                    {opt.label}
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--text-dim)', fontWeight: 400 }}>{opt.desc}</span>
                </button>
              ))}
            </div>
            {/* Download button */}
            <button
              disabled={downloading}
              onClick={() => handleDownload(downloadModal, downloadType)}
              style={{
                width: '100%', height: '38px', borderRadius: '100px', border: 'none', cursor: 'pointer',
                background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)',
                fontSize: '13px', fontWeight: 700, fontFamily: 'inherit',
                color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                transition: 'box-shadow 0.15s, opacity 0.15s',
                opacity: downloading ? 0.6 : 1,
              }}
              onMouseDown={e => { if (!downloading) e.currentTarget.style.boxShadow = 'var(--neu-inset)' }}
              onMouseUp={e => { e.currentTarget.style.boxShadow = 'var(--neu-raised-sm)' }}
              onMouseLeave={e => { e.currentTarget.style.boxShadow = 'var(--neu-raised-sm)' }}
            >
              <DownloadSimple size={15} />
              {downloading ? 'Downloading…' : 'Download'}
            </button>
          </div>
        </div>
      )}

      {/* FY Calendar */}
      <div style={{ ...cardSt, padding: '16px 20px', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>FY {fy} — Full Year Calendar</div>
          <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: 'var(--text-dim)', alignItems: 'center' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: '#0ea66e', display: 'inline-block' }} />Profit
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: '#FF4444', display: 'inline-block' }} />Loss
            </span>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '12px', width: '100%', boxSizing: 'border-box' as const }}>
          {months.map(m => (
            <MiniCal
              key={m.key} month={m.month} year={m.year} label={m.label}
              selected={monthModal?.month === m.month && monthModal?.year === m.year}
              onToggle={() => setMonthModal({ month: m.month, year: m.year, label: m.label })}
              calendarData={calendarData}
            />
          ))}
        </div>
      </div>

      {/* Per-Algo Metrics */}
      <div style={{ background: 'var(--bg)', boxShadow: 'var(--neu-raised)', borderRadius: '16px', overflow: 'hidden', paddingBottom: '16px' }}>
        {/* Header + filters */}
        <div style={{ padding: '16px 20px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Per-Algo Metrics</div>
            <span style={{ fontSize: '11px', color: 'var(--accent)', background: 'var(--bg)', boxShadow: 'var(--neu-inset)', padding: '2px 10px', borderRadius: '100px', fontWeight: 600 }}>{activePeriodLabel}</span>
          </div>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            {[['fy','FY'],['month','Month'],['date','Date'],['custom','Custom']].map(([v, l]) => (
              <button key={v} onClick={() => setMetricFilter(v)} style={btnSt(metricFilter === v)}>{l}</button>
            ))}
            {metricFilter === 'fy' && <StaaxSelect value={metricFy} onChange={setMetricFy} options={getFYOptions(3)} width="120px" />}
            {metricFilter === 'month' && <StaaxSelect value={metricMonth} onChange={setMetricMonth} options={monthOptions} width="120px" />}
            {metricFilter === 'date' && (
              <input type="date" value={metricDate} onChange={e => setMetricDate(e.target.value)}
                style={{ ...inpSt, width: '140px', colorScheme: 'dark' } as any} />
            )}
            {metricFilter === 'custom' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <input type="date" value={metricFrom} onChange={e => setMetricFrom(e.target.value)}
                  style={{ ...inpSt, width: '130px', colorScheme: 'dark' } as any} />
                <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>→</span>
                <input type="date" value={metricTo} onChange={e => setMetricTo(e.target.value)}
                  style={{ ...inpSt, width: '130px', colorScheme: 'dark' } as any} />
              </div>
            )}
          </div>
        </div>

        {/* Table */}
        <div style={{ display: 'flex', overflow: 'visible', padding: '0 20px 0' }}>
          {/* Left: Key Metrics labels */}
          <div style={{ flexShrink: 0, minWidth: '130px', overflow: 'hidden', borderRadius: '12px 0 0 12px', background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}>
            <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '130px', tableLayout: 'fixed' as const }}>
              <thead>
                <tr>
                  <th style={{ minWidth: '130px', padding: '8px 14px 14px', textAlign: 'center', background: 'transparent', borderRadius: '12px 0 0 0', fontSize: '11px', fontWeight: 700, color: 'var(--text-mute)', borderBottom: '1px solid var(--border)' }}>
                    Key Metrics
                  </th>
                </tr>
              </thead>
              <tbody>
                {METRIC_ROWS.map((row, idx) => (
                  <tr key={row.key} style={{ height: '30px' }}>
                    <td style={{
                      fontWeight: 600, color: 'var(--text-mute)', fontSize: '11px',
                      background: 'transparent',
                      borderBottom: idx < METRIC_ROWS.length - 1 ? '1px solid var(--border)' : 'none',
                      padding: '0 14px', textAlign: 'center', height: '30px', whiteSpace: 'nowrap',
                    }}>
                      {row.label}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Middle: algo columns, scrollable */}
          <div style={{ flex: 1, minWidth: 0, overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: 'max-content', minWidth: '100%', tableLayout: 'fixed' as const }}>
              <thead>
                <tr>
                  {algoMetrics.map((a: any) => (
                    <th key={a.algo_id} onClick={() => setSelectedAlgo(a.name)} style={{
                      minWidth: '100px', padding: '8px 14px 14px', textAlign: 'center', cursor: 'pointer',
                      background: 'var(--bg)', fontSize: '11px', fontWeight: 700, color: 'var(--accent)',
                      borderBottom: '1px solid var(--border)',
                    }}>
                      {a.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {METRIC_ROWS.map((row, ridx) => {
                  const isPct = row.key === 'win_pct' || row.key === 'loss_pct'
                  const isCurrency = row.key === 'total_pnl' || row.key === 'max_profit' || row.key === 'max_loss'
                  const fmt = (n: number) => isPct
                    ? (Math.abs(n * (Math.abs(n) <= 1 ? 100 : 1)).toFixed(1) + '%')
                    : isCurrency
                      ? ((n < 0 ? '-' : '') + '₹' + Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }))
                      : String(Math.round(Math.abs(n)))
                  return (
                    <tr key={row.key} style={{ height: '30px' }}>
                      {algoMetrics.map((a: any) => {
                        const val = (a as any)[row.key]
                        const isNeg = (val || 0) < 0 || row.isLoss
                        return (
                          <td key={a.algo_id} style={{
                            color: isNeg ? '#FF4444' : '#0ea66e',
                            fontWeight: 600, padding: '0 14px', textAlign: 'center', height: '30px',
                            background: 'var(--bg)',
                            borderBottom: ridx < METRIC_ROWS.length - 1 ? '1px solid var(--border)' : 'none',
                            fontSize: '12px', fontFamily: 'var(--font-mono)',
                          }}>
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

          {/* Right: Cumulative */}
          <div style={{ flexShrink: 0, minWidth: '130px', overflow: 'hidden', borderRadius: '0 12px 12px 0', background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}>
            <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '130px', tableLayout: 'fixed' as const }}>
              <thead>
                <tr>
                  <th style={{
                    padding: '8px 14px 14px', textAlign: 'center',
                    background: 'transparent',
                    color: 'var(--accent)', fontSize: '11px', fontWeight: 700,
                    borderRadius: '0 12px 0 0', borderBottom: '1px solid var(--border)',
                  }}>
                    Cumulative
                  </th>
                </tr>
              </thead>
              <tbody>
                {METRIC_ROWS.map((row, idx) => {
                  const isPct = row.key === 'win_pct' || row.key === 'loss_pct'
                  const isCurrency = row.key === 'total_pnl' || row.key === 'max_profit' || row.key === 'max_loss'
                  const cumVal = algoMetrics.reduce((s: number, a: any) => s + (a[row.key] || 0), 0)
                  const cumFmt = isPct
                    ? (algoMetrics.length > 0 ? (cumVal / algoMetrics.length).toFixed(1) + '%' : '0%')
                    : isCurrency
                      ? ((cumVal < 0 ? '-' : '') + '₹' + Math.abs(cumVal).toLocaleString('en-IN', { maximumFractionDigits: 2 }))
                      : String(Math.round(Math.abs(cumVal)))
                  const isNeg = cumVal < 0 || row.isLoss
                  return (
                    <tr key={row.key} style={{ height: '30px' }}>
                      <td style={{
                        color: isNeg ? '#FF4444' : '#0ea66e',
                        fontWeight: 700, fontSize: '11px',
                        background: 'transparent',
                        borderBottom: idx < METRIC_ROWS.length - 1 ? '1px solid var(--border)' : 'none',
                        padding: '0 14px', textAlign: 'center', height: '30px',
                        fontFamily: 'var(--font-mono)',
                      }}>
                        {cumFmt}
                      </td>
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
        <div style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)', animation: 'fadeIn 0.15s ease' }} onClick={() => setMonthModal(null)}>
          <div style={{ ...neuModal, maxWidth: '480px', width: '90%', animation: 'slideUp 0.18s ease' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: '16px', fontWeight: 700, color: 'var(--text)' }}>
                {monthModal.label} {monthModal.year}
              </span>
              <button style={closeBtnSt} onClick={() => setMonthModal(null)}>
                <IconX size={14} weight="bold" />
              </button>
            </div>
            <MonthDetail month={monthModal.month} year={monthModal.year} label={monthModal.label} calendarData={calendarData} />
            {(() => {
              const mk = `${monthModal.year}-${String(monthModal.month).padStart(2, '0')}`
              const total = Object.keys(calendarData).filter(k => k.startsWith(mk)).reduce((s, k) => s + calendarData[k], 0)
              const winDays = Object.keys(calendarData).filter(k => k.startsWith(mk) && calendarData[k] > 0).length
              const totalDays = Object.keys(calendarData).filter(k => k.startsWith(mk)).length
              const roi = totalDays > 0 ? ((winDays / totalDays) * 100).toFixed(0) : null
              return (
                <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontSize: '12px', color: 'var(--text-dim)', fontWeight: 600 }}>Month Total</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', fontWeight: 700, color: total >= 0 ? '#0ea66e' : '#FF4444' }}>
                      {total >= 0 ? '+' : ''}₹{Math.abs(Math.round(total)).toLocaleString('en-IN')}
                    </span>
                  </div>
                  {roi !== null && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '12px', color: 'var(--text-dim)', fontWeight: 600 }}>Win Rate</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 600, color: 'var(--accent)' }}>{roi}% ({winDays}/{totalDays} days)</span>
                    </div>
                  )}
                </div>
              )
            })()}
          </div>
        </div>
      )}

      <AlgoDetailModal algoName={selectedAlgo} onClose={() => setSelectedAlgo(null)} />
    </div>
  )
}
