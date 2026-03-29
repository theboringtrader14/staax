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

const TABS = ['Performance', 'Risk Heatmap', 'Failures', 'Slippage'] as const
type Tab = typeof TABS[number]

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

// Section label — inside card (card has 16px padding, so no extra padding needed)
const secHdr: CSSProperties = {
  fontSize: '11px', fontWeight: 700,
  color: 'var(--text-dim)',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  marginBottom: '8px',
}

// Table wrapper — gives the table its own bordered box inside a card
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

// ── Tab 1: Performance Attribution ────────────────────────────────────────────
function PerformanceTab({ metrics, orders, algos }: { metrics: MetricRow[]; orders: Order[]; algos: Algo[] }) {
  const totalTrades = metrics.reduce((s, m) => s + (m.trades ?? 0), 0)
  const totalPnl    = metrics.reduce((s, m) => s + (m.pnl ?? 0), 0)
  const weightedWR  = totalTrades > 0
    ? metrics.reduce((s, m) => s + (m.win_rate ?? 0) * (m.trades ?? 0), 0) / totalTrades
    : 0
  const bestAlgo  = metrics.length > 0 ? [...metrics].sort((a, b) => b.pnl - a.pnl)[0] : null
  const worstAlgo = metrics.length > 0 ? [...metrics].sort((a, b) => a.pnl - b.pnl)[0] : null

  const algoById = new Map<string, Algo>(algos.map(a => [a.id, a]))
  const entryGroups: Record<string, { count: number; totalPnl: number }> = {}
  for (const o of orders) {
    const algo = algoById.get(o.algo_id)
    const et = o.entry_type || algo?.entry_type || 'unknown'
    if (!entryGroups[et]) entryGroups[et] = { count: 0, totalPnl: 0 }
    entryGroups[et].count++
    entryGroups[et].totalPnl += o.pnl ?? 0
  }
  const entryRows = Object.entries(entryGroups).map(([et, g]) => ({
    entry_type: et, count: g.count, total_pnl: g.totalPnl,
    avg_pnl: g.count > 0 ? g.totalPnl / g.count : 0,
  }))
  const sorted = [...metrics].sort((a, b) => b.pnl - a.pnl)
  const hasEntryData = entryRows.length > 0

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '12px', marginBottom: '12px' }}>
        <SummaryCard label="Total Trades" value={totalTrades.toString()} />
        <SummaryCard label="Win Rate %" value={`${weightedWR.toFixed(1)}%`} valueColor="var(--green)" />
        <SummaryCard label="Total P&L" value={fmtPnl(totalPnl)} valueColor={totalPnl >= 0 ? 'var(--green)' : 'var(--red)'} />
        <SummaryCard label="Best Algo" value={bestAlgo?.algo_name || '—'} sub={bestAlgo ? `${fmtPnl(bestAlgo.pnl)} · ${bestAlgo.wins}W/${bestAlgo.losses}L` : undefined} valueColor="var(--green)" />
        <SummaryCard label="Worst Algo" value={worstAlgo?.algo_name || '—'} sub={worstAlgo ? `${fmtPnl(worstAlgo.pnl)} · ${worstAlgo.wins}W/${worstAlgo.losses}L` : undefined} valueColor="var(--red)" />
      </div>

      <div className="card" style={{ marginBottom: hasEntryData ? '12px' : 0 }}>
        <div style={secHdr}>Per-Algo Performance</div>
        <div style={tblWrap}>
          <table className="staax-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Algo</th>
                <th>Trades</th>
                <th>Wins</th>
                <th>Losses</th>
                <th>Win Rate</th>
                <th>P&L</th>
                <th>Avg P&L/Trade</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '24px' }}>No data</td></tr>
              )}
              {sorted.map(row => (
                <tr key={row.algo_name}>
                  <td style={{ fontWeight: 600 }}>{row.algo_name}</td>
                  <td>{row.trades}</td>
                  <td style={{ color: 'var(--green)' }}>{row.wins}</td>
                  <td style={{ color: 'var(--red)' }}>{row.losses}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <div style={{ width: '60px', height: '4px', background: 'var(--bg-border)', borderRadius: '2px', flexShrink: 0 }}>
                        <div style={{ width: `${Math.min(row.win_rate ?? 0, 100)}%`, height: '100%', background: 'var(--green)', borderRadius: '2px' }} />
                      </div>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{(row.win_rate ?? 0).toFixed(1)}%</span>
                    </div>
                  </td>
                  <td style={{ fontWeight: 700, color: row.pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtPnl(row.pnl)}</td>
                  <td style={{ color: row.trades > 0 && row.pnl / row.trades >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {row.trades > 0 ? fmtPnl(row.pnl / row.trades) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {hasEntryData && (
        <div className="card">
          <div style={secHdr}>Entry Type Breakdown (Today)</div>
          <div style={tblWrap}>
            <table className="staax-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Entry Type</th>
                  <th>Orders</th>
                  <th>Total P&L</th>
                  <th>Avg P&L</th>
                </tr>
              </thead>
              <tbody>
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
      )}
    </div>
  )
}

// ── Tab 2: Risk Heatmap (metrics-based — day breakdown needs historical endpoint) ──
function HeatmapTab({ metrics }: { metrics: MetricRow[] }) {
  const sorted = [...metrics].sort((a, b) => b.pnl - a.pnl)
  const maxAbsPnl = Math.max(...sorted.map(m => Math.abs(m.pnl)), 1)

  return (
    <div>

      {sorted.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '48px' }}>No metrics data available.</div>
      ) : (
        <div className="card">
          <div style={secHdr}>FY P&L by Algo</div>
          <div style={tblWrap}>
            <table className="staax-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Algo</th>
                  <th>Trades</th>
                  <th>Win %</th>
                  <th>P&L</th>
                  <th style={{ width: '200px' }}>P&L Bar</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(m => {
                  const barPct = Math.abs(m.pnl) / maxAbsPnl * 100
                  const isPos = m.pnl >= 0
                  return (
                    <tr key={m.algo_name}>
                      <td style={{ fontWeight: 600 }}>{m.algo_name}</td>
                      <td>{m.trades}</td>
                      <td style={{ color: m.win_rate >= 50 ? 'var(--green)' : 'var(--red)' }}>{m.win_rate.toFixed(1)}%</td>
                      <td style={{ fontWeight: 700, color: isPos ? 'var(--green)' : 'var(--red)' }}>{fmtPnl(m.pnl)}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <div style={{ flex: 1, height: '8px', background: 'var(--bg-border)', borderRadius: '4px', overflow: 'hidden' }}>
                            <div style={{ width: `${barPct}%`, height: '100%', background: isPos ? 'var(--green)' : 'var(--red)', borderRadius: '4px', opacity: 0.75 }} />
                          </div>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Tab 3: Failure Analytics ───────────────────────────────────────────────────
function FailuresTab({ orders }: { orders: Order[] }) {
  const errorOrders = orders.filter(o => o.status === 'error')
  const errorRate = orders.length > 0 ? (errorOrders.length / orders.length) * 100 : 0

  const algoErrMap = new Map<string, { count: number; lastDate: string }>()
  for (const o of errorOrders) {
    if (!algoErrMap.has(o.algo_name)) algoErrMap.set(o.algo_name, { count: 0, lastDate: '' })
    const e = algoErrMap.get(o.algo_name)!
    e.count++
    const d = o.fill_time || o.exit_time || ''
    if (d > e.lastDate) e.lastDate = d
  }
  const algoErrRows = [...algoErrMap.entries()]
    .map(([name, v]) => ({ algo_name: name, count: v.count, last_date: v.lastDate }))
    .sort((a, b) => b.count - a.count)
  const mostFailed = algoErrRows[0]?.algo_name || '—'

  const errTypes: Record<string, number> = {}
  for (const o of errorOrders) {
    const key = (o.error_message || 'unknown').split(' ').slice(0, 2).join(' ')
    errTypes[key] = (errTypes[key] ?? 0) + 1
  }
  const topErrType = Object.entries(errTypes).sort((a, b) => b[1] - a[1])[0]?.[0] || '—'

  const last20 = [...errorOrders]
    .sort((a, b) => (b.fill_time || '').localeCompare(a.fill_time || ''))
    .slice(0, 20)

  return (
    <div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '12px' }}>
        <SummaryCard label="Total Errors" value={errorOrders.length.toString()} valueColor="var(--red)" />
        <SummaryCard label="Error Rate %" value={`${errorRate.toFixed(1)}%`} sub={`of ${orders.length} today's orders`} />
        <SummaryCard label="Most Failed Algo" value={mostFailed} valueColor="var(--accent-blue)" />
        <SummaryCard label="Top Error Type" value={topErrType} />
      </div>

      <div className="card" style={{ marginBottom: '12px' }}>
        <div style={secHdr}>Errors per Algo</div>
        <div style={tblWrap}>
          <table className="staax-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Algo</th>
                <th>Error Count</th>
                <th>Last Error</th>
                <th>Error Rate %</th>
              </tr>
            </thead>
            <tbody>
              {algoErrRows.length === 0 && (
                <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '24px' }}>No errors today</td></tr>
              )}
              {algoErrRows.map(row => {
                const total = orders.filter(o => o.algo_name === row.algo_name).length
                const rate = total > 0 ? (row.count / total) * 100 : 0
                return (
                  <tr key={row.algo_name}>
                    <td style={{ fontWeight: 600 }}>{row.algo_name}</td>
                    <td style={{ color: 'var(--red)', fontWeight: 700 }}>{row.count}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{fmtDate(row.last_date)}</td>
                    <td style={{ color: rate > 10 ? 'var(--red)' : 'var(--text-muted)' }}>{rate.toFixed(1)}%</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div style={secHdr}>Recent Error Orders (today, last 20)</div>
        <div style={{ ...tblWrap, overflowX: 'auto' }}>
          <table className="staax-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Time</th>
                <th>Algo</th>
                <th>Symbol</th>
                <th>Error Message</th>
              </tr>
            </thead>
            <tbody>
              {last20.length === 0 && (
                <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '24px' }}>No errors today</td></tr>
              )}
              {last20.map(o => {
                const msg = o.error_message || '—'
                const short = msg.length > 60 ? msg.slice(0, 60) + '…' : msg
                return (
                  <tr key={o.id}>
                    <td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{fmtDate(o.fill_time)}</td>
                    <td style={{ fontWeight: 600 }}>{o.algo_name}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '11px' }}>{o.symbol}</td>
                    <td>
                      <span title={msg} style={{ cursor: msg.length > 60 ? 'help' : 'default', color: 'var(--red)', fontSize: '11px' }}>
                        {short}
                      </span>
                    </td>
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

// ── Tab 4: Slippage Report ─────────────────────────────────────────────────────
type SlippageOrder = Order & { slippage: number }

function SlippageTab({ orders }: { orders: Order[] }) {
  const withRef    = orders.filter(o => o.fill_price != null && o.entry_reference != null)
  const withoutRef = orders.filter(o => o.fill_price != null && o.entry_reference == null)

  function calcSlip(o: Order): number {
    const fill = o.fill_price!
    const ref  = Number(o.entry_reference!)
    return o.direction === 'buy' ? fill - ref : ref - fill
  }

  const slipOrders: SlippageOrder[] = withRef.map(o => ({ ...o, slippage: calcSlip(o) }))
  const avgSlip   = slipOrders.length > 0 ? slipOrders.reduce((s, o) => s + o.slippage, 0) / slipOrders.length : 0
  const totalSlip = slipOrders.reduce((s, o) => s + o.slippage, 0)
  const bestFill  = slipOrders.length > 0 ? Math.min(...slipOrders.map(o => o.slippage)) : 0
  const worstFill = slipOrders.length > 0 ? Math.max(...slipOrders.map(o => o.slippage)) : 0

  const algoMap = new Map<string, { orders: number; total: number; slips: number[] }>()
  for (const o of slipOrders) {
    if (!algoMap.has(o.algo_name)) algoMap.set(o.algo_name, { orders: 0, total: 0, slips: [] })
    const a = algoMap.get(o.algo_name)!
    a.orders++; a.total += o.slippage; a.slips.push(o.slippage)
  }
  const algoRows = [...algoMap.entries()]
    .map(([name, v]) => ({
      algo_name: name, orders: v.orders, avg: v.total / v.orders, total: v.total,
      best: Math.min(...v.slips), worst: Math.max(...v.slips),
    }))
    .sort((a, b) => b.avg - a.avg)

  function slipColor(avg: number): string {
    if (avg < 2) return 'var(--green)'
    if (avg <= 5) return 'var(--amber)'
    return 'var(--red)'
  }

  const highSlip = slipOrders
    .filter(o => Math.abs(o.slippage) > 5)
    .sort((a, b) => Math.abs(b.slippage) - Math.abs(a.slippage))

  return (
    <div>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
        <span style={{ fontSize: '11px', background: 'rgba(34,197,94,0.1)', color: 'var(--green)', padding: '3px 10px', borderRadius: '12px', border: '1px solid rgba(34,197,94,0.2)' }}>
          {withRef.length} orders with ref price
        </span>
        <span style={{ fontSize: '11px', background: 'var(--bg-border)', color: 'var(--text-muted)', padding: '3px 10px', borderRadius: '12px' }}>
          {withoutRef.length} without ref price (direct entry)
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '12px' }}>
        <SummaryCard
          label="Avg Slippage (pts)" value={fmtPts(avgSlip)}
          valueColor={avgSlip < 2 ? 'var(--green)' : avgSlip <= 5 ? 'var(--amber)' : 'var(--red)'}
        />
        <SummaryCard
          label="Total Slippage (₹)"
          value={`${totalSlip >= 0 ? '+' : '-'}₹${Math.abs(Math.round(totalSlip)).toLocaleString('en-IN')}`}
          valueColor={totalSlip <= 0 ? 'var(--green)' : 'var(--red)'}
        />
        <SummaryCard label="Best Fill (pts)"  value={fmtPts(bestFill)}  valueColor="var(--green)" />
        <SummaryCard label="Worst Fill (pts)" value={fmtPts(worstFill)} valueColor={worstFill > 5 ? 'var(--red)' : 'var(--text)'} />
      </div>

      <div className="card" style={{ marginBottom: '12px' }}>
        <div style={secHdr}>Slippage per Algo</div>
        <div style={{ ...tblWrap, overflowX: 'auto' }}>
          <table className="staax-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Algo</th>
                <th>Orders</th>
                <th>Avg Slip (pts)</th>
                <th>Total Slip (₹)</th>
                <th>Best</th>
                <th>Worst</th>
              </tr>
            </thead>
            <tbody>
              {algoRows.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '24px' }}>No slippage data today</td></tr>
              )}
              {algoRows.map(r => (
                <tr key={r.algo_name}>
                  <td style={{ fontWeight: 600 }}>{r.algo_name}</td>
                  <td>{r.orders}</td>
                  <td style={{ fontWeight: 700, color: slipColor(r.avg) }}>{fmtPts(r.avg)}</td>
                  <td style={{ color: r.total <= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {r.total >= 0 ? '+' : '-'}₹{Math.abs(Math.round(r.total)).toLocaleString('en-IN')}
                  </td>
                  <td style={{ color: 'var(--green)' }}>{fmtPts(r.best)}</td>
                  <td style={{ color: r.worst > 5 ? 'var(--red)' : 'var(--text)' }}>{fmtPts(r.worst)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <div style={secHdr}>High Slippage Orders (&gt;5 pts)</div>
          <span style={{ fontSize: '11px', color: 'var(--text-dim)', marginBottom: '8px' }}>{highSlip.length} orders</span>
        </div>
        <div style={{ ...tblWrap, overflowX: 'auto' }}>
          <table className="staax-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Time</th>
                <th>Algo</th>
                <th>Symbol</th>
                <th>Dir</th>
                <th>Ref Price</th>
                <th>Fill Price</th>
                <th>Slippage</th>
              </tr>
            </thead>
            <tbody>
              {highSlip.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '24px' }}>No high-slippage orders today</td></tr>
              )}
              {highSlip.map(o => (
                <tr key={o.id}>
                  <td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{fmtDate(o.fill_time)}</td>
                  <td style={{ fontWeight: 600 }}>{o.algo_name}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: '11px' }}>{o.symbol}</td>
                  <td>
                    <span style={{ fontSize: '10px', fontWeight: 700, color: o.direction === 'buy' ? 'var(--green)' : 'var(--red)', textTransform: 'uppercase' }}>
                      {o.direction}
                    </span>
                  </td>
                  <td>{Number(o.entry_reference ?? '0').toFixed(2)}</td>
                  <td>{(o.fill_price ?? 0).toFixed(2)}</td>
                  <td style={{ fontWeight: 700, color: o.slippage > 0 ? 'var(--red)' : 'var(--green)' }}>{fmtPts(o.slippage)}</td>
                </tr>
              ))}
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
  const [activeTab, setActiveTab] = useState<Tab>(() => (localStorage.getItem('analytics_tab') as Tab) || 'Performance')
  const [metrics, setMetrics]     = useState<MetricRow[]>([])
  const [orders, setOrders]       = useState<Order[]>([])
  const [algos, setAlgos]         = useState<Algo[]>([])
  const [loading, setLoading]     = useState(true)

  useEffect(() => {
    setLoading(true)
    const today = new Date().toISOString().slice(0, 10)

    Promise.all([
      reportsAPI.metrics({ fy: '2025-26', is_practix: isPractixMode }),
      ordersAPI.list(today, isPractixMode),
      algosAPI.list(),
    ]).then(([mRes, oRes, aRes]) => {
      // Map actual API field names → local MetricRow shape
      const rawMetrics: any[] = Array.isArray(mRes.data) ? mRes.data : (mRes.data?.metrics || [])
      setMetrics(rawMetrics.map((r: any) => ({
        algo_name: r.name || r.algo_name || '',
        trades:    r.trades || 0,
        wins:      r.wins || 0,
        losses:    r.losses || 0,
        pnl:       r.total_pnl ?? r.pnl ?? 0,
        win_rate:  r.win_pct ?? r.win_rate ?? 0,
      })))

      // Orders come grouped — flatten to flat Order array
      const oData = oRes.data
      const rawGroups: any[] = Array.isArray(oData) ? [] : (oData?.groups || [])
      const flat: Order[] = rawGroups.flatMap((g: any) =>
        (g.orders || []).map((o: any) => ({ ...o, algo_name: o.algo_name || g.algo_name || '' }))
      )
      setOrders(flat)

      const aData = aRes.data
      setAlgos(Array.isArray(aData) ? aData : (aData?.algos || aData?.results || []))
    }).catch(() => {}).finally(() => setLoading(false))
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

      {/* Tab bar — matches Orders page day tabs exactly */}
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
          {activeTab === 'Performance'  && <PerformanceTab metrics={metrics} orders={orders} algos={algos} />}
          {activeTab === 'Risk Heatmap' && <HeatmapTab metrics={metrics} />}
          {activeTab === 'Failures'     && <FailuresTab orders={orders} />}
          {activeTab === 'Slippage'     && <SlippageTab orders={orders} />}
        </>
      )}
    </div>
  )
}
