import { useState, useEffect } from 'react'
import type { CSSProperties } from 'react'
import { useStore } from '@/store'
import { reportsAPI, ordersAPI, algosAPI } from '@/services/api'
import type { Order, Algo } from '@/types'

// ── Local Types ────────────────────────────────────────────────────────────────
interface MetricRow {
  algo_name: string
  trades: number
  wins: number
  losses: number
  pnl: number
  win_rate: number
}

interface HealthScore {
  algo_name: string; score: number; grade: string
  trades: number; win_pct: number; total_pnl: number
}

const TABS = ['Performance', 'Failures', 'Slippage', 'Health'] as const
type Tab = typeof TABS[number]

const HEATMAP_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI']
const MONTHS_FY = ['Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar']

// ── Formatters ─────────────────────────────────────────────────────────────────
function fmtPnl(v: number): string {
  const sign = v >= 0 ? '+' : '-'
  return `${sign}₹${Math.abs(Math.round(v)).toLocaleString('en-IN')}`
}

function fmtPts(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}`
}

function fmtDate(s?: string): string {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
}

function getOrderDate(o: any): string {
  return (o.fill_time || o.created_at || o.trading_date || '').slice(0, 10)
}

function filterOrdersByPeriod(
  orders: Order[], filter: string, fy: string,
  month: string, date: string, from: string, to: string,
): Order[] {
  if (filter === 'fy') {
    const startYear = parseInt(fy.split('-')[0])
    const start = `${startYear}-04-01`, end = `${startYear + 1}-03-31`
    return orders.filter(o => { const d = getOrderDate(o); return d >= start && d <= end })
  }
  if (filter === 'month') {
    const monthIdx = MONTHS_FY.indexOf(month)
    const fyYear = parseInt(fy.split('-')[0])
    const mNum = monthIdx + 4
    const actualMonth = mNum > 12 ? mNum - 12 : mNum
    const actualYear  = mNum > 12 ? fyYear + 1 : fyYear
    const pad = (n: number) => String(n).padStart(2, '0')
    const lastDay = new Date(actualYear, actualMonth, 0).getDate()
    const start = `${actualYear}-${pad(actualMonth)}-01`
    const end   = `${actualYear}-${pad(actualMonth)}-${lastDay}`
    return orders.filter(o => { const d = getOrderDate(o); return d >= start && d <= end })
  }
  if (filter === 'date' && date)
    return orders.filter(o => getOrderDate(o) === date)
  if (filter === 'custom' && from && to)
    return orders.filter(o => { const d = getOrderDate(o); return d >= from && d <= to })
  return orders
}

// Section label
const secHdr: CSSProperties = {
  fontSize: '11px', fontWeight: 700,
  color: 'var(--text-dim)',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  marginBottom: '8px',
}

// Table wrapper
const tblWrap: CSSProperties = {
  border: '1px solid var(--bg-border)',
  borderRadius: '7px',
  overflow: 'hidden',
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function PractixChip({ isPractix }: { isPractix: boolean }) {
  return (
    <span style={{
      fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '4px',
      background: isPractix ? 'rgba(215,123,18,0.15)' : 'rgba(34,197,94,0.12)',
      color: isPractix ? 'var(--accent-amber)' : 'var(--green)',
      border: isPractix ? '1px solid rgba(215,123,18,0.3)' : '1px solid rgba(34,197,94,0.25)',
    }}>
      {isPractix ? 'PRACTIX' : 'LIVE'}
    </span>
  )
}

function SummaryCard({ label, value, sub, valueColor }: {
  label: string; value: string; sub?: string; valueColor?: string
}) {
  return (
    <div className="card">
      <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
        {label}
      </div>
      <div style={{ fontSize: '20px', fontWeight: 700, color: valueColor || 'var(--text)', lineHeight: 1.2, wordBreak: 'break-word' }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginTop: '4px' }}>{sub}</div>}
    </div>
  )
}

// ── Tab 1: Performance ─────────────────────────────────────────────────────────
function PerformanceTab({ metrics, breakdown, allOrders, algos }: {
  metrics: MetricRow[]
  breakdown: Record<string, Record<string, { pnl: number; trades: number }>>
  allOrders: Order[]
  algos: Algo[]
}) {
  const [entryFilter, setEntryFilter] = useState('fy')
  const [entryFy,     setEntryFy]     = useState('2025-26')
  const [entryMonth,  setEntryMonth]  = useState('Apr')
  const [entryDate,   setEntryDate]   = useState('')
  const [entryFrom,   setEntryFrom]   = useState('')
  const [entryTo,     setEntryTo]     = useState('')

  const bestAlgo  = metrics.length > 0 ? [...metrics].sort((a, b) => b.pnl - a.pnl)[0] : null
  const worstAlgo = metrics.length > 0 ? [...metrics].sort((a, b) => a.pnl - b.pnl)[0] : null

  // Entry type breakdown from filtered allOrders
  const periodOrders = filterOrdersByPeriod(allOrders, entryFilter, entryFy, entryMonth, entryDate, entryFrom, entryTo)
  const algoById = new Map<string, Algo>(algos.map(a => [a.id, a]))
  const entryGroups: Record<string, { count: number; totalPnl: number }> = {}
  for (const o of periodOrders) {
    const algo = algoById.get((o as any).algo_id)
    const et = (o as any).entry_type || (algo as any)?.entry_type || 'unknown'
    if (!entryGroups[et]) entryGroups[et] = { count: 0, totalPnl: 0 }
    entryGroups[et].count++
    entryGroups[et].totalPnl += (o as any).pnl ?? 0
  }
  const entryRows = Object.entries(entryGroups).map(([et, g]) => ({
    entry_type: et, count: g.count, total_pnl: g.totalPnl,
    avg_pnl: g.count > 0 ? g.totalPnl / g.count : 0,
  }))

  // Heatmap
  const heatmapAlgos = Object.keys(breakdown).sort()
  function cellBg(pnl: number | undefined): string {
    if (pnl === undefined) return 'var(--bg-border)'
    if (pnl > 0) return `rgba(34,197,94,${Math.min(Math.abs(pnl) / 5000, 1) * 0.5 + 0.12})`
    if (pnl < 0) return `rgba(239,68,68,${Math.min(Math.abs(pnl) / 3000, 1) * 0.5 + 0.12})`
    return 'var(--bg-border)'
  }

  const activePeriodLabel = entryFilter === 'fy' ? `FY ${entryFy}`
    : entryFilter === 'month' ? `${entryMonth} · FY ${entryFy}`
    : entryFilter === 'date' && entryDate ? entryDate
    : entryFilter === 'custom' && entryFrom && entryTo ? `${entryFrom} → ${entryTo}`
    : 'Select period'

  return (
    <div>
      {/* Best + Worst Algo — 2 cards side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
        <SummaryCard
          label="Best Algo" value={bestAlgo?.algo_name || '—'}
          sub={bestAlgo ? `${fmtPnl(bestAlgo.pnl)} · ${bestAlgo.wins}W/${bestAlgo.losses}L` : undefined}
          valueColor="var(--green)"
        />
        <SummaryCard
          label="Worst Algo" value={worstAlgo?.algo_name || '—'}
          sub={worstAlgo ? `${fmtPnl(worstAlgo.pnl)} · ${worstAlgo.wins}W/${worstAlgo.losses}L` : undefined}
          valueColor="var(--red)"
        />
      </div>

      {/* Risk Heatmap — Day × Algo */}
      <div className="card" style={{ marginBottom: '12px', overflowX: 'auto' }}>
        <div style={secHdr}>P&amp;L by Day × Algo (FY)</div>
        {heatmapAlgos.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '32px' }}>No day-breakdown data available.</div>
        ) : (
          <div style={tblWrap}>
            <table className="staax-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ minWidth: '140px' }}>Algo</th>
                  {HEATMAP_DAYS.map(d => <th key={d} style={{ textAlign: 'center', width: '100px' }}>{d}</th>)}
                  <th style={{ textAlign: 'right' }}>FY Total</th>
                </tr>
              </thead>
              <tbody>
                {heatmapAlgos.map(algo => {
                  const row = breakdown[algo]
                  const fyTotal = HEATMAP_DAYS.reduce((s, d) => s + (row[d]?.pnl ?? 0), 0)
                  return (
                    <tr key={algo}>
                      <td style={{ fontWeight: 600 }}>{algo}</td>
                      {HEATMAP_DAYS.map(d => {
                        const cell = row[d]
                        return (
                          <td key={d} style={{ textAlign: 'center', padding: '6px 4px' }}>
                            <div style={{
                              background: cellBg(cell?.pnl),
                              borderRadius: '5px', padding: '5px 4px',
                              fontSize: '10px', fontWeight: 700,
                              color: cell ? (cell.pnl > 0 ? 'var(--green)' : cell.pnl < 0 ? 'var(--red)' : 'var(--text-dim)') : 'var(--text-dim)',
                            }}>
                              {cell ? (cell.pnl >= 0 ? '+' : '') + (cell.pnl / 1000).toFixed(1) + 'k' : '—'}
                              {cell && <div style={{ fontSize: '9px', fontWeight: 400, color: 'var(--text-dim)', marginTop: '1px' }}>{cell.trades}t</div>}
                            </div>
                          </td>
                        )
                      })}
                      <td style={{ textAlign: 'right', fontWeight: 700, color: fyTotal >= 0 ? 'var(--green)' : 'var(--red)' }}>
                        {fmtPnl(fyTotal)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Entry Type Breakdown with period filter */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
          <span style={{ ...secHdr, marginBottom: 0 }}>Entry Type Breakdown</span>
          <span style={{ fontSize: '10px', color: 'var(--text-dim)', marginLeft: '4px' }}>{activePeriodLabel}</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            {[['fy','FY'],['month','Month'],['date','Date'],['custom','Custom']].map(([v, l]) => (
              <button key={v} onClick={() => setEntryFilter(v)}
                className={`chip ${entryFilter === v ? 'chip-active' : 'chip-inactive'}`}
                style={{ height: '28px', padding: '0 10px', fontSize: '11px' }}>{l}</button>
            ))}
            {entryFilter === 'fy' && (
              <select className="staax-select" value={entryFy} onChange={e => setEntryFy(e.target.value)} style={{ width: '108px', fontSize: '11px' }}>
                <option value="2025-26">FY 2025-26</option>
                <option value="2024-25">FY 2024-25</option>
                <option value="2023-24">FY 2023-24</option>
              </select>
            )}
            {entryFilter === 'month' && (
              <select className="staax-select" value={entryMonth} onChange={e => setEntryMonth(e.target.value)} style={{ width: '90px', fontSize: '11px' }}>
                {MONTHS_FY.map(m => <option key={m}>{m}</option>)}
              </select>
            )}
            {entryFilter === 'date' && (
              <input type="date" className="staax-input" value={entryDate} onChange={e => setEntryDate(e.target.value)} style={{ width: '140px', fontSize: '11px', colorScheme: 'dark' } as any} />
            )}
            {entryFilter === 'custom' && (
              <>
                <input type="date" className="staax-input" value={entryFrom} onChange={e => setEntryFrom(e.target.value)} style={{ width: '130px', fontSize: '11px', colorScheme: 'dark' } as any} />
                <span style={{ color: 'var(--text-dim)', fontSize: '11px' }}>→</span>
                <input type="date" className="staax-input" value={entryTo} onChange={e => setEntryTo(e.target.value)} style={{ width: '130px', fontSize: '11px', colorScheme: 'dark' } as any} />
              </>
            )}
          </div>
        </div>
        <div style={tblWrap}>
          <table className="staax-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Entry Type</th>
                <th>Orders</th>
                <th>Total P&amp;L</th>
                <th>Avg P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {entryRows.length === 0 && (
                <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '24px' }}>No data for selected period</td></tr>
              )}
              {entryRows.map(r => (
                <tr key={r.entry_type}>
                  <td style={{ fontWeight: 600, textTransform: 'capitalize' }}>{r.entry_type}</td>
                  <td>{r.count}</td>
                  <td style={{ color: r.total_pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtPnl(r.total_pnl)}</td>
                  <td style={{ color: r.avg_pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtPnl(r.avg_pnl)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Tab 2: Failure Analytics — from /reports/errors ───────────────────────────
interface ErrorsData {
  per_algo: { algo: string; errors: number; last_error: string | null }[]
  recent:   { id: string; algo: string; symbol: string; error_message: string | null; created_at: string | null }[]
  total_errors: number
  total_orders: number
  error_rate_pct: number
}

function FailuresTab({ data }: { data: ErrorsData | null }) {
  if (!data) return <div className="card" style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '48px' }}>No error data available.</div>
  const mostFailed = data.per_algo[0]?.algo || '—'

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '12px' }}>
        <SummaryCard label="Total Errors" value={data.total_errors.toString()} valueColor="var(--red)" />
        <SummaryCard label="Error Rate %" value={`${data.error_rate_pct.toFixed(1)}%`} sub={`of ${data.total_orders} orders (FY)`} />
        <SummaryCard label="Most Failed Algo" value={mostFailed} valueColor="var(--accent-blue)" />
        <SummaryCard label="Algos with Errors" value={data.per_algo.length.toString()} />
      </div>

      <div className="card" style={{ marginBottom: '12px' }}>
        <div style={secHdr}>Errors per Algo (FY)</div>
        <div style={tblWrap}>
          <table className="staax-table" style={{ width: '100%' }}>
            <thead><tr><th>Algo</th><th>Errors</th><th>Last Error</th></tr></thead>
            <tbody>
              {data.per_algo.length === 0 && (
                <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '24px' }}>No errors on record</td></tr>
              )}
              {data.per_algo.map(row => (
                <tr key={row.algo}>
                  <td style={{ fontWeight: 600 }}>{row.algo}</td>
                  <td style={{ color: 'var(--red)', fontWeight: 700 }}>{row.errors}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{fmtDate(row.last_error ?? undefined)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div style={secHdr}>Recent Error Orders (last 20)</div>
        <div style={{ ...tblWrap, overflowX: 'auto' }}>
          <table className="staax-table" style={{ width: '100%' }}>
            <thead><tr><th>Time</th><th>Algo</th><th>Symbol</th><th>Error Message</th></tr></thead>
            <tbody>
              {data.recent.length === 0 && (
                <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '24px' }}>No recent errors</td></tr>
              )}
              {data.recent.map(o => {
                const msg = o.error_message || '—'
                const short = msg.length > 60 ? msg.slice(0, 60) + '…' : msg
                return (
                  <tr key={o.id}>
                    <td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{fmtDate(o.created_at ?? undefined)}</td>
                    <td style={{ fontWeight: 600 }}>{o.algo}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '11px' }}>{o.symbol}</td>
                    <td><span title={msg} style={{ cursor: msg.length > 60 ? 'help' : 'default', color: 'var(--red)', fontSize: '11px' }}>{short}</span></td>
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

// ── Tab 3: Slippage Report — from /reports/slippage ───────────────────────────
interface SlippageData {
  per_algo: { algo: string; orders: number; avg_slip_pts: number; total_slip_inr: number; best: number; worst: number }[]
  avg_slippage_pts: number
  total_orders_with_ref: number
}

function SlippageTab({ data }: { data: SlippageData | null }) {
  if (!data) return <div className="card" style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '48px' }}>No slippage data available.</div>

  function slipColor(avg: number): string {
    if (avg < 2) return 'var(--green)'
    if (avg <= 5) return 'var(--amber)'
    return 'var(--red)'
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '12px' }}>
        <SummaryCard
          label="Avg Slippage (pts)" value={fmtPts(data.avg_slippage_pts)}
          valueColor={data.avg_slippage_pts < 2 ? 'var(--green)' : data.avg_slippage_pts <= 5 ? 'var(--amber)' : 'var(--red)'}
        />
        <SummaryCard label="Orders with Ref Price" value={data.total_orders_with_ref.toString()} />
        <SummaryCard label="Algos Tracked" value={data.per_algo.length.toString()} />
      </div>

      <div className="card">
        <div style={secHdr}>Slippage per Algo (FY)</div>
        <div style={{ ...tblWrap, overflowX: 'auto' }}>
          <table className="staax-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Algo</th><th>Orders</th><th>Avg Slip (pts)</th>
                <th>Total Slip (₹)</th><th>Best</th><th>Worst</th>
              </tr>
            </thead>
            <tbody>
              {data.per_algo.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '24px' }}>No slippage data on record</td></tr>
              )}
              {data.per_algo.map(r => (
                <tr key={r.algo}>
                  <td style={{ fontWeight: 600 }}>{r.algo}</td>
                  <td>{r.orders}</td>
                  <td style={{ fontWeight: 700, color: slipColor(r.avg_slip_pts) }}>{fmtPts(r.avg_slip_pts)}</td>
                  <td style={{ color: r.total_slip_inr <= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {r.total_slip_inr >= 0 ? '+' : '-'}₹{Math.abs(Math.round(r.total_slip_inr)).toLocaleString('en-IN')}
                  </td>
                  <td style={{ color: 'var(--green)' }}>{fmtPts(r.best)}</td>
                  <td style={{ color: r.worst > 5 ? 'var(--red)' : 'var(--text)' }}>{fmtPts(r.worst)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Tab 4: Health Scores — from /reports/health-scores ────────────────────────
const GRADE_COLORS: Record<string, { color: string; bg: string; border: string }> = {
  A: { color: 'var(--green)',        bg: 'rgba(34,197,94,0.12)',    border: 'rgba(34,197,94,0.3)'    },
  B: { color: 'var(--accent-blue)',  bg: 'rgba(0,176,240,0.12)',    border: 'rgba(0,176,240,0.3)'    },
  C: { color: 'var(--accent-amber)', bg: 'rgba(215,123,18,0.12)',   border: 'rgba(215,123,18,0.3)'   },
  D: { color: 'var(--red)',          bg: 'rgba(239,68,68,0.12)',    border: 'rgba(239,68,68,0.3)'    },
}

function HealthTab({ scores, avgScore }: { scores: HealthScore[]; avgScore: number }) {
  if (scores.length === 0)
    return <div className="card" style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '48px' }}>No health data available.</div>

  const best      = scores[0]
  const needsAttn = [...scores].sort((a, b) => a.score - b.score)[0]
  const mostConsistent = [...scores].sort((a, b) => b.trades - a.trades)[0]

  function scoreBarColor(score: number): string {
    if (score >= 70) return 'var(--green)'
    if (score >= 40) return 'var(--accent-amber)'
    return 'var(--red)'
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '12px' }}>
        <SummaryCard label="Best Score" value={`${best.score}`} sub={`${best.algo_name} · Grade ${best.grade}`} valueColor="var(--green)" />
        <SummaryCard label="Avg Score" value={`${avgScore}`}
          valueColor={avgScore >= 70 ? 'var(--green)' : avgScore >= 40 ? 'var(--accent-amber)' : 'var(--red)'} />
        <SummaryCard label="Most Consistent" value={mostConsistent.algo_name} sub={`${mostConsistent.trades} trades`} valueColor="var(--accent-blue)" />
        <SummaryCard label="Needs Attention" value={needsAttn.algo_name} sub={`Score ${needsAttn.score} · Grade ${needsAttn.grade}`} valueColor="var(--red)" />
      </div>

      <div className="card">
        <div style={secHdr}>Algo Health Scores (FY)</div>
        <div style={tblWrap}>
          <table className="staax-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Algo</th>
                <th style={{ textAlign: 'center' }}>Grade</th>
                <th>Score</th>
                <th>Trades</th>
                <th>Win %</th>
                <th>P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {scores.map(s => {
                const g = GRADE_COLORS[s.grade] || GRADE_COLORS['D']
                return (
                  <tr key={s.algo_name}>
                    <td style={{ fontWeight: 600 }}>{s.algo_name}</td>
                    <td style={{ textAlign: 'center' }}>
                      <span style={{
                        fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '4px',
                        color: g.color, background: g.bg, border: `1px solid ${g.border}`,
                      }}>{s.grade}</span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: '80px', height: '6px', background: 'var(--bg-border)', borderRadius: '3px', flexShrink: 0 }}>
                          <div style={{ width: `${Math.min(s.score, 100)}%`, height: '100%', background: scoreBarColor(s.score), borderRadius: '3px', transition: 'width 0.3s' }} />
                        </div>
                        <span style={{ fontSize: '12px', fontWeight: 700, color: scoreBarColor(s.score) }}>{s.score}</span>
                      </div>
                    </td>
                    <td>{s.trades}</td>
                    <td style={{ color: s.win_pct >= 50 ? 'var(--green)' : 'var(--red)' }}>{s.win_pct.toFixed(1)}%</td>
                    <td style={{ fontWeight: 700, color: s.total_pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtPnl(s.total_pnl)}</td>
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

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function AnalyticsPage() {
  const isPractixMode = useStore(s => s.isPractixMode)
  const [activeTab, setActiveTab]     = useState<Tab>(() => {
    const saved = localStorage.getItem('analytics_tab') as Tab
    return TABS.includes(saved) ? saved : 'Performance'
  })
  const [metrics, setMetrics]         = useState<MetricRow[]>([])
  const [allOrders, setAllOrders]     = useState<Order[]>([])
  const [algos, setAlgos]             = useState<Algo[]>([])
  const [breakdown, setBreakdown]     = useState<Record<string, Record<string, { pnl: number; trades: number }>>>({})
  const [errorsData, setErrorsData]   = useState<ErrorsData | null>(null)
  const [slippageData, setSlippageData] = useState<SlippageData | null>(null)
  const [healthScores, setHealthScores] = useState<HealthScore[]>([])
  const [healthAvg, setHealthAvg]     = useState(0)
  const [loading, setLoading]         = useState(true)

  useEffect(() => {
    setLoading(true)

    Promise.allSettled([
      reportsAPI.metrics({ fy: '2025-26', is_practix: isPractixMode }),
      ordersAPI.list(undefined, isPractixMode),
      algosAPI.list(),
      reportsAPI.dayBreakdown({ fy: '2025-26', is_practix: isPractixMode }),
      reportsAPI.errors({ fy: '2025-26', is_practix: isPractixMode }),
      reportsAPI.slippage({ fy: '2025-26', is_practix: isPractixMode }),
      reportsAPI.healthScores({ fy: '2025-26', is_practix: isPractixMode }),
    ]).then(([mRes, oRes, aRes, bdRes, errRes, slipRes, hRes]) => {
      const rawMetrics: any[] = mRes.status === 'fulfilled'
        ? (Array.isArray(mRes.value.data) ? mRes.value.data : (mRes.value.data?.metrics || []))
        : []
      setMetrics(rawMetrics.map((r: any) => ({
        algo_name: r.name || r.algo_name || '',
        trades:    r.trades || 0,
        wins:      r.wins || 0,
        losses:    r.losses || 0,
        pnl:       r.total_pnl ?? r.pnl ?? 0,
        win_rate:  r.win_pct ?? r.win_rate ?? 0,
      })))

      if (oRes.status === 'fulfilled') {
        const oData = oRes.value.data
        const rawGroups: any[] = Array.isArray(oData) ? [] : (oData?.groups || [])
        const flat: Order[] = rawGroups.flatMap((g: any) =>
          (g.orders || []).map((o: any) => ({ ...o, algo_name: o.algo_name || g.algo_name || '' }))
        )
        setAllOrders(flat)
      }

      if (aRes.status === 'fulfilled') {
        const aData = aRes.value.data
        setAlgos(Array.isArray(aData) ? aData : (aData?.algos || aData?.results || []))
      }

      setBreakdown(bdRes.status === 'fulfilled' ? (bdRes.value.data?.breakdown || bdRes.value.data || {}) : {})
      setErrorsData(errRes.status === 'fulfilled' ? (errRes.value.data || null) : null)
      setSlippageData(slipRes.status === 'fulfilled' ? (slipRes.value.data || null) : null)

      if (hRes.status === 'fulfilled') {
        setHealthScores(hRes.value.data?.scores || [])
        setHealthAvg(hRes.value.data?.avg_score || 0)
      }
    }).finally(() => setLoading(false))
  }, [isPractixMode])

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 style={{ fontFamily: "'ADLaM Display', serif", fontSize: '22px', fontWeight: 400 }}>Analytics</h1>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            Performance, risk, failures &amp; slippage ·{' '}
            <PractixChip isPractix={isPractixMode} />
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', width: '100%', borderBottom: '1px solid var(--bg-border)', marginBottom: '16px' }}>
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); localStorage.setItem('analytics_tab', tab) }}
            style={{
              flex: 1, padding: '8px 4px', fontSize: '12px', fontWeight: 600,
              background: activeTab === tab ? 'var(--bg-surface)' : 'transparent',
              border: 'none', cursor: 'pointer', transition: 'all 0.12s',
              color: activeTab === tab ? 'var(--accent-blue)' : 'var(--text-muted)',
              borderBottom: activeTab === tab ? '2px solid var(--accent-blue)' : '2px solid transparent',
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '64px', color: 'var(--text-dim)', fontSize: '13px' }}>Loading…</div>
      ) : (
        <>
          {activeTab === 'Performance' && <PerformanceTab metrics={metrics} breakdown={breakdown} allOrders={allOrders} algos={algos} />}
          {activeTab === 'Failures'    && <FailuresTab data={errorsData} />}
          {activeTab === 'Slippage'    && <SlippageTab data={slippageData} />}
          {activeTab === 'Health'      && <HealthTab scores={healthScores} avgScore={healthAvg} />}
        </>
      )}
    </div>
  )
}
