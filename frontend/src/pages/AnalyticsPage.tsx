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

const TABS = ['Performance', 'Failures', 'Slippage', 'Latency'] as const
type Tab = typeof TABS[number]

const HEATMAP_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI']

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


// Section label
const secHdr: CSSProperties = {
  fontSize: '11px', fontWeight: 700,
  color: '#e8e8f8',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  marginBottom: '8px',
  borderLeft: '2px solid #6366f1',
  paddingLeft: '8px',
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
function PerformanceTab({ metrics, breakdown, allOrders, algos, scores, avgScore, fy, timeSlots }: {
  metrics: MetricRow[]
  breakdown: Record<string, Record<string, { pnl: number; trades: number }>>
  allOrders: Order[]
  algos: Algo[]
  scores: HealthScore[]
  avgScore: number
  fy: string
  timeSlots: any[]
}) {
  const [activeView, setActiveView] = useState<'heatmap' | 'health'>('heatmap')

  const bestAlgo       = metrics.length > 0 ? [...metrics].sort((a, b) => b.pnl - a.pnl)[0] : null
  const worstAlgo      = metrics.length > 0 ? [...metrics].sort((a, b) => a.pnl - b.pnl)[0] : null
  const best           = scores.length > 0 ? scores[0] : null
  const needsAttn      = scores.length > 0 ? [...scores].sort((a, b) => a.score - b.score)[0] : null
  const mostConsistent = scores.length > 0 ? [...scores].sort((a, b) => b.trades - a.trades)[0] : null

  // Strategy Type Breakdown — from allOrders filtered to selected FY
  const fyYear = parseInt(fy.split('-')[0])
  const fyStart = `${fyYear}-04-01`, fyEnd = `${fyYear + 1}-03-31`
  const periodOrders = allOrders.filter(o => { const d = getOrderDate(o); return d >= fyStart && d <= fyEnd })
  const algoById = new Map<string, Algo>(algos.map(a => [a.id, a]))
  const stratGroups: Record<string, { count: number; totalPnl: number; wins: number }> = {}
  for (const o of periodOrders) {
    const algo = algoById.get((o as any).algo_id)
    const st = ((o as any).entry_type || (algo as any)?.strategy_mode || (algo as any)?.entry_type || 'unknown').toLowerCase()
    if (!stratGroups[st]) stratGroups[st] = { count: 0, totalPnl: 0, wins: 0 }
    stratGroups[st].count++
    stratGroups[st].totalPnl += (o as any).pnl ?? 0
    if (((o as any).pnl ?? 0) > 0) stratGroups[st].wins++
  }
  const stratRows = Object.entries(stratGroups)
    .map(([st, g]) => ({ strategy_type: st, count: g.count, total_pnl: g.totalPnl,
      avg_pnl: g.count > 0 ? g.totalPnl / g.count : 0, win_rate: g.count > 0 ? g.wins / g.count * 100 : 0 }))
    .sort((a, b) => b.total_pnl - a.total_pnl)

  // Heatmap
  const heatmapAlgos = Object.keys(breakdown).sort()
  function cellBg(pnl: number | undefined): string {
    if (pnl === undefined) return 'var(--bg-border)'
    if (pnl > 0) return `rgba(34,197,94,${Math.min(Math.abs(pnl) / 5000, 1) * 0.5 + 0.12})`
    if (pnl < 0) return `rgba(239,68,68,${Math.min(Math.abs(pnl) / 3000, 1) * 0.5 + 0.12})`
    return 'var(--bg-border)'
  }
  function scoreBarColor(score: number): string {
    if (score >= 70) return 'var(--green)'
    if (score >= 40) return 'var(--accent-amber)'
    return 'var(--red)'
  }

  return (
    <div>
      {/* Row 1 — 6 summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '12px', marginBottom: '12px' }}>
        <SummaryCard label="Best Algo" value={bestAlgo?.algo_name || '—'}
          sub={bestAlgo ? `${fmtPnl(bestAlgo.pnl)} · ${bestAlgo.wins}W/${bestAlgo.losses}L` : undefined}
          valueColor="var(--green)" />
        <SummaryCard label="Worst Algo" value={worstAlgo?.algo_name || '—'}
          sub={worstAlgo ? `${fmtPnl(worstAlgo.pnl)} · ${worstAlgo.wins}W/${worstAlgo.losses}L` : undefined}
          valueColor="var(--red)" />
        <SummaryCard label="Best Score" value={best ? String(best.score) : '—'}
          sub={best ? `${best.algo_name} · ${best.grade}` : undefined} valueColor="var(--green)" />
        <SummaryCard label="Avg Score" value={scores.length > 0 ? String(avgScore) : '—'}
          valueColor={avgScore >= 70 ? 'var(--green)' : avgScore >= 40 ? 'var(--accent-amber)' : 'var(--red)'} />
        <SummaryCard label="Most Consistent" value={mostConsistent?.algo_name || '—'}
          sub={mostConsistent ? `${mostConsistent.trades} trades` : undefined} valueColor="var(--accent-blue)" />
        <SummaryCard label="Needs Attention" value={needsAttn?.algo_name || '—'}
          sub={needsAttn ? `Score ${needsAttn.score} · ${needsAttn.grade}` : undefined} valueColor="var(--red)" />
      </div>

      {/* Row 2 — chip toggle: P&L heatmap vs Health Scores */}
      <div className="card" style={{ marginBottom: '12px', overflowX: 'auto' }}>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          {([['heatmap', 'P&L by Day × Algo'], ['health', 'Algo Health Scores']] as const).map(([v, l]) => (
            <button key={v} onClick={() => setActiveView(v)}
              className={`chip ${activeView === v ? 'chip-active' : 'chip-inactive'}`}
              style={{ height: '28px', padding: '0 14px', fontSize: '11px' }}>{l}</button>
          ))}
        </div>

        {activeView === 'heatmap' && (
          <>
            {heatmapAlgos.length === 0
              ? <div style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '32px' }}>No day-breakdown data available.</div>
              : <div style={tblWrap}>
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
                                  <div style={{ background: cellBg(cell?.pnl), borderRadius: '5px', padding: '5px 4px',
                                    fontSize: '10px', fontWeight: 700,
                                    color: cell ? (cell.pnl > 0 ? 'var(--green)' : cell.pnl < 0 ? 'var(--red)' : 'var(--text-dim)') : 'var(--text-dim)' }}>
                                    {cell ? (cell.pnl >= 0 ? '+' : '') + (cell.pnl / 1000).toFixed(1) + 'k' : '—'}
                                    {cell && <div style={{ fontSize: '9px', fontWeight: 400, color: 'var(--text-dim)', marginTop: '1px' }}>{cell.trades}t</div>}
                                  </div>
                                </td>
                              )
                            })}
                            <td style={{ textAlign: 'right', fontWeight: 700, color: fyTotal >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtPnl(fyTotal)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
            }
          </>
        )}

        {activeView === 'health' && (
          scores.length === 0
            ? <div style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '32px' }}>No health data available.</div>
            : <div style={tblWrap}>
                <table className="staax-table" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th>Algo</th><th style={{ textAlign: 'center' }}>Grade</th>
                      <th>Score</th><th>Trades</th><th>Win %</th><th>P&amp;L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scores.map(s => {
                      const g = GRADE_COLORS[s.grade] || GRADE_COLORS['D']
                      return (
                        <tr key={s.algo_name}>
                          <td style={{ fontWeight: 600 }}>{s.algo_name}</td>
                          <td style={{ textAlign: 'center' }}>
                            <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '4px', color: g.color, background: g.bg, border: `1px solid ${g.border}` }}>{s.grade}</span>
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
        )}
      </div>

      {/* Row 3 — Best Time to Trade */}
      {timeSlots.length > 0 && (() => {
        const maxAbsPnl = Math.max(...timeSlots.map((s: any) => Math.abs(s.total_pnl)), 1)
        return (
          <div className="card" style={{ marginBottom: '12px' }}>
            <div style={{ marginBottom: '24px' }}>
              <span style={{ ...secHdr, marginBottom: 0 }}>Best Time to Trade</span>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', height: '80px', paddingTop: '16px' }}>
              {timeSlots.map((slot: any) => {
                const barH = Math.max(4, Math.round((Math.abs(slot.total_pnl) / maxAbsPnl) * 60))
                const color = slot.total_pnl >= 0 ? 'var(--green)' : 'var(--red)'
                const bg    = slot.total_pnl >= 0 ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)'
                const title = `${slot.label}\n${slot.trades} trades · ${slot.win_rate}% win\n${slot.total_pnl >= 0 ? '+' : ''}₹${Math.abs(Math.round(slot.total_pnl)).toLocaleString('en-IN')}`
                return (
                  <div key={slot.hour} title={title} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', cursor: 'help' }}>
                    <div style={{ fontSize: '9px', fontWeight: 700, color, textAlign: 'center' }}>
                      {slot.total_pnl !== 0 ? `${slot.total_pnl >= 0 ? '+' : ''}${Math.abs(slot.total_pnl) >= 1000 ? (slot.total_pnl / 1000).toFixed(1) + 'k' : Math.round(slot.total_pnl)}` : '—'}
                    </div>
                    <div style={{ width: '100%', height: `${barH}px`, background: bg, border: `1px solid ${color}`, borderRadius: '3px 3px 0 0', transition: 'height 0.3s' }} />
                    <div style={{ fontSize: '9px', color: 'var(--text-muted)', textAlign: 'center', whiteSpace: 'nowrap' }}>
                      {slot.hour}AM
                    </div>
                    <div style={{ fontSize: '9px', color: 'var(--text-dim)', textAlign: 'center' }}>
                      {slot.trades > 0 ? `${slot.win_rate}%` : '—'}
                    </div>
                  </div>
                )
              })}
            </div>
            <div style={{ display: 'flex', gap: '16px', marginTop: '10px', fontSize: '10px', color: 'var(--text-dim)' }}>
              <span>Bar height = P&L magnitude</span>
              <span style={{ color: 'var(--green)' }}>■ Profit</span>
              <span style={{ color: 'var(--red)' }}>■ Loss</span>
              <span>% = win rate · hover for details</span>
            </div>
          </div>
        )
      })()}

      {/* Row 4 — Strategy Type Breakdown */}
      <div className="card">
        <div style={{ marginBottom: '12px' }}>
          <span style={{ ...secHdr, marginBottom: 0 }}>Strategy Type Breakdown</span>
        </div>
        <div style={tblWrap}>
          <table className="staax-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Strategy</th><th>Orders</th><th>Total P&amp;L</th><th>Avg P&amp;L</th><th>Win Rate</th>
              </tr>
            </thead>
            <tbody>
              {stratRows.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '24px' }}>No data for FY {fy}</td></tr>
              )}
              {stratRows.map(r => (
                <tr key={r.strategy_type}>
                  <td style={{ fontWeight: 600, textTransform: 'capitalize' }}>{r.strategy_type}</td>
                  <td>{r.count}</td>
                  <td style={{ color: r.total_pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtPnl(r.total_pnl)}</td>
                  <td style={{ color: r.avg_pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtPnl(r.avg_pnl)}</td>
                  <td style={{ color: r.win_rate >= 50 ? 'var(--green)' : 'var(--red)' }}>{r.win_rate.toFixed(1)}%</td>
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
        <div style={secHdr}>Errors per Algo</div>
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
        <div style={secHdr}>Slippage per Algo</div>
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

// ── Tab 4: Latency Tracker — from /reports/latency ────────────────────────────
interface LatencyData {
  avg_latency_ms: number
  p50_latency_ms: number
  p95_latency_ms: number
  max_latency_ms: number
  total_orders: number
  by_broker: { broker: string; avg_ms: number; count: number }[]
  by_algo:   { algo_name: string; avg_ms: number; count: number; total_orders: number }[]
}

function LatencyTab({ data }: { data: LatencyData | null }) {
  if (!data || data.total_orders === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '48px', fontSize: '13px' }}>
        No latency data yet — execute trades to see metrics.<br />Latency tracking is active from today.
      </div>
    )
  }

  const maxBrokerMs = Math.max(...data.by_broker.map(b => b.avg_ms), 1)
  const maxAlgoMs   = Math.max(...data.by_algo.map(a => a.avg_ms), 1)

  function latencyColor(ms: number): string {
    if (ms < 500)  return 'var(--green)'
    if (ms < 2000) return 'var(--accent-amber)'
    return 'var(--red)'
  }

  return (
    <div>
      {/* Row 1 — 4 summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '12px' }}>
        <SummaryCard label="Avg Latency" value={`${data.avg_latency_ms} ms`}
          valueColor={latencyColor(data.avg_latency_ms)} sub={`${data.total_orders} orders`} />
        <SummaryCard label="P50 (Median)" value={`${data.p50_latency_ms} ms`}
          valueColor={latencyColor(data.p50_latency_ms)} />
        <SummaryCard label="P95" value={`${data.p95_latency_ms} ms`}
          valueColor={latencyColor(data.p95_latency_ms)} />
        <SummaryCard label="Max" value={`${data.max_latency_ms} ms`}
          valueColor={latencyColor(data.max_latency_ms)} />
      </div>

      {/* Row 2 — By Broker */}
      {data.by_broker.length > 0 && (
        <div className="card" style={{ marginBottom: '12px' }}>
          <div style={secHdr}>By Broker</div>
          <div style={tblWrap}>
            <table className="staax-table" style={{ width: '100%' }}>
              <thead>
                <tr><th>Broker</th><th>Avg (ms)</th><th>Orders</th><th style={{ width: '160px' }}>Bar</th></tr>
              </thead>
              <tbody>
                {data.by_broker.map(b => (
                  <tr key={b.broker}>
                    <td style={{ fontWeight: 600 }}>{b.broker}</td>
                    <td style={{ fontWeight: 700, color: latencyColor(b.avg_ms) }}>{b.avg_ms}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{b.count}</td>
                    <td>
                      <div style={{ width: `${Math.round(b.avg_ms / maxBrokerMs * 140)}px`, height: '8px', background: 'rgba(245,158,11,0.6)', borderRadius: '3px', transition: 'width 0.3s' }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Row 3 — By Algo */}
      {data.by_algo.length > 0 && (
        <div className="card">
          <div style={secHdr}>By Algo</div>
          <div style={tblWrap}>
            <table className="staax-table" style={{ width: '100%' }}>
              <thead>
                <tr><th>Algo</th><th>Avg (ms)</th><th>Orders</th><th style={{ width: '160px' }}>Bar</th></tr>
              </thead>
              <tbody>
                {data.by_algo.map(a => (
                  <tr key={a.algo_name}>
                    <td style={{ fontWeight: 600 }}>{a.algo_name}</td>
                    <td style={{ fontWeight: 700, color: latencyColor(a.avg_ms) }}>{a.avg_ms}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{a.count}</td>
                    <td>
                      <div style={{ width: `${Math.round(a.avg_ms / maxAlgoMs * 140)}px`, height: '8px', background: 'rgba(245,158,11,0.6)', borderRadius: '3px', transition: 'width 0.3s' }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Grade Colors — shared ──────────────────────────────────────────────────────
const GRADE_COLORS: Record<string, { color: string; bg: string; border: string }> = {
  A: { color: 'var(--green)',        bg: 'rgba(34,197,94,0.12)',    border: 'rgba(34,197,94,0.3)'    },
  B: { color: 'var(--accent-blue)',  bg: 'rgba(0,176,240,0.12)',    border: 'rgba(0,176,240,0.3)'    },
  C: { color: 'var(--accent-amber)', bg: 'rgba(215,123,18,0.12)',   border: 'rgba(215,123,18,0.3)'   },
  D: { color: 'var(--red)',          bg: 'rgba(239,68,68,0.12)',    border: 'rgba(239,68,68,0.3)'    },
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
  const [timeSlots, setTimeSlots]     = useState<any[]>([])
  const [latencyData, setLatencyData] = useState<LatencyData | null>(null)
  const [loading, setLoading]         = useState(true)
  const [fy, setFy]                   = useState('2025-26')

  useEffect(() => {
    setLoading(true)

    Promise.allSettled([
      reportsAPI.metrics({ fy, is_practix: isPractixMode }),
      ordersAPI.list(undefined, isPractixMode),
      algosAPI.list(),
      reportsAPI.dayBreakdown({ fy, is_practix: isPractixMode }),
      reportsAPI.errors({ fy, is_practix: isPractixMode }),
      reportsAPI.slippage({ fy, is_practix: isPractixMode }),
      reportsAPI.healthScores({ fy, is_practix: isPractixMode }),
      reportsAPI.timeHeatmap({ fy, is_practix: isPractixMode }),
      reportsAPI.latency({ fy, is_practix: isPractixMode }),
    ]).then(([mRes, oRes, aRes, bdRes, errRes, slipRes, hRes, tRes, latRes]) => {
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
      if (tRes.status === 'fulfilled') {
        setTimeSlots(tRes.value.data?.slots || [])
      }
      if (latRes.status === 'fulfilled') {
        setLatencyData(latRes.value.data || null)
      }
    }).finally(() => setLoading(false))
  }, [isPractixMode, fy])

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
        <div className="page-header-actions">
          <select className="staax-select" value={fy} onChange={e => setFy(e.target.value)} style={{ width: '120px', fontSize: '11px' }}>
            <option value="2025-26">FY 2025-26</option>
            <option value="2024-25">FY 2024-25</option>
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', width: '100%', borderBottom: '1px solid var(--bg-border)', marginBottom: '16px' }}>
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); localStorage.setItem('analytics_tab', tab) }}
            style={{
              flex: 1, padding: '8px 4px', fontSize: '12px', fontWeight: 600,
              background: activeTab === tab ? 'rgba(99,102,241,0.08)' : 'transparent',
              border: 'none', cursor: 'pointer', transition: 'all 0.2s ease',
              color: activeTab === tab ? '#a78bfa' : 'rgba(232,232,248,0.6)',
              borderBottom: activeTab === tab ? '2px solid #6366f1' : '2px solid transparent',
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
          {activeTab === 'Performance' && <PerformanceTab metrics={metrics} breakdown={breakdown} allOrders={allOrders} algos={algos} scores={healthScores} avgScore={healthAvg} fy={fy} timeSlots={timeSlots} />}
          {activeTab === 'Failures'    && <FailuresTab data={errorsData} />}
          {activeTab === 'Slippage'    && <SlippageTab data={slippageData} />}
          {activeTab === 'Latency'     && <LatencyTab data={latencyData} />}
        </>
      )}
    </div>
  )
}
