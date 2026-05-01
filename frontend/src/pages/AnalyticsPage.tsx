import { useState, useEffect, useMemo, useRef } from 'react'
import type { CSSProperties } from 'react'
import { AreaChart, Area, XAxis, YAxis, LineChart, Line, ReferenceLine, Tooltip, ResponsiveContainer } from 'recharts'
import { useStore } from '@/store'
import { reportsAPI, ordersAPI, algosAPI, api } from '@/services/api'
import type { Order, Algo } from '@/types'
import { getCurrentFY, getFYOptions } from '@/utils/fy'
import { fmtPnl } from '@/utils/format'
import { StaaxSelect } from '@/components/StaaxSelect'
import { AlgoDetailModal } from '@/components/AlgoDetailModal'
import { SortableHeader } from '@/components/SortableHeader'
import { useSort } from '@/hooks/useSort'

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

interface StratRow {
  strategy_type: string
  trades: number
  total_pnl: number
  avg_pnl: number
  win_rate: number
}


// ── Formatters ─────────────────────────────────────────────────────────────────
// fmtPnl is imported from @/utils/format

function fmtPts(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}`
}

function fmtDate(s?: string): string {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
}

function fmtDateTime(s?: string): string {
  if (!s) return '—'
  const d = new Date(s)
  const date = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
  const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' })
  return `${date} ${time}`
}

function cleanAlgo(name: string): string {
  if (!name) return name
  const m = name.match(/^STAAX_Mom_(.+?)_\d{1,3}_\d{7,}$/)
  if (m) return m[1]
  return name.replace(/^STAAX_Mom_/i, '')
}

function getOrderDate(o: Order): string {
  return (o.fill_time || (o as any).trading_date || '').slice(0, 10)
}


// ── Neumorphic style constants ─────────────────────────────────────────────────
const neuCard: CSSProperties = {
  background: 'var(--bg)',
  boxShadow: 'var(--neu-raised)',
  borderRadius: 16,
  padding: '16px 18px',
}

const neuCardSm: CSSProperties = {
  background: 'var(--bg)',
  boxShadow: 'var(--neu-raised-sm)',
  borderRadius: 12,
  padding: '12px 14px',
  minHeight: 90,
}

const neuInset: CSSProperties = {
  background: 'var(--bg)',
  boxShadow: 'var(--neu-inset)',
  borderRadius: 10,
  overflow: 'hidden',
}

const secLabel: CSSProperties = {
  fontSize: 9,
  letterSpacing: '0.15em',
  color: 'var(--text-mute)',
  fontWeight: 700,
  textTransform: 'uppercase',
  marginBottom: 10,
}

// Numeric value style
const numStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  color: 'var(--text)',
  fontWeight: 600,
}


// ── Recharts neumorphic tooltip ────────────────────────────────────────────────
function PnlTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null
  const v: number = payload[0].value
  return (
    <div style={{
      background: 'var(--bg)', boxShadow: 'var(--neu-raised)',
      borderRadius: 10, padding: '8px 12px', fontSize: 11,
    }}>
      <div style={{ color: 'var(--text-mute)', marginBottom: 3 }}>{label}</div>
      <div style={{ fontWeight: 700, fontSize: 13, color: v >= 0 ? 'var(--green)' : 'var(--red)', fontFamily: 'var(--font-mono)' }}>
        {v >= 0 ? '+' : '−'}₹{Math.abs(v).toLocaleString('en-IN')}
      </div>
    </div>
  )
}


// ── Cumulative P&L AreaChart ───────────────────────────────────────────────────
function CumulativePnlChart({ orders }: { orders: Order[] }) {
  const chartData = useMemo(() => {
    const byDate: Record<string, number> = {}
    for (const o of orders) {
      const date = getOrderDate(o)
      if (!date || o.pnl == null) continue
      byDate[date] = (byDate[date] ?? 0) + (o.pnl ?? 0)
    }
    let cum = 0
    return Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, pnl]) => { cum += pnl; return { date: date.slice(5), cum: Math.round(cum) } })
  }, [orders])

  if (chartData.length < 2) return null

  const isPositive = chartData[chartData.length - 1].cum >= 0
  const colorHex = isPositive ? '#0EA66E' : '#FF4444'
  const gradId = `pnlGrad-${isPositive ? 'g' : 'r'}`

  return (
    <div style={{ ...neuCard, marginBottom: 12 }}>
      <div style={secLabel}>Cumulative P&L</div>
      <div style={{ ...neuInset, padding: '10px 8px 4px' }}>
        <ResponsiveContainer width="100%" height={100}>
          <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={colorHex} stopOpacity={0.3} />
                <stop offset="95%" stopColor={colorHex} stopOpacity={0}   />
              </linearGradient>
            </defs>
            <XAxis dataKey="date"
              tick={{ fontSize: 9, fill: 'var(--text-mute)' }}
              axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <Tooltip content={<PnlTooltip />} cursor={{ stroke: 'var(--border)', strokeWidth: 1 }} />
            <Area type="monotone" dataKey="cum" stroke={colorHex} strokeWidth={1.5}
              fill={`url(#${gradId})`} dot={false}
              activeDot={{ r: 3, fill: colorHex, strokeWidth: 0 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}



// ── Summary Stat Card ──────────────────────────────────────────────────────────
function SummaryCard({ label, value, sub, valueColor, onClick }: {
  label: string; value: string; sub?: string; valueColor?: string; onClick?: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const subColor = (() => {
    const s = String(sub ?? '')
    if (s.startsWith('+') || (!s.startsWith('-') && !isNaN(Number(s)) && s.trim() !== '' && Number(s) > 0)) return 'var(--green)'
    if (s.startsWith('-')) return 'var(--red)'
    return 'var(--text-mute)'
  })()
  return (
    <div
      ref={ref}
      onClick={onClick}
      style={{
        ...neuCardSm,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'box-shadow 0.15s',
      }}
      onMouseDown={() => { if (onClick && ref.current) ref.current.style.boxShadow = 'var(--neu-inset)' }}
      onMouseUp={() => { if (ref.current) ref.current.style.boxShadow = 'var(--neu-raised-sm)' }}
      onMouseLeave={() => { if (ref.current) ref.current.style.boxShadow = 'var(--neu-raised-sm)' }}
    >
      <div style={{ fontSize: 9, textTransform: 'uppercase', color: 'var(--text-mute)', marginBottom: 6, fontWeight: 700, letterSpacing: '0.1em', fontFamily: 'var(--font-display)' }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.2, wordBreak: 'break-word', color: valueColor || 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 10, color: subColor, marginTop: 4 }}>{sub}</div>}
    </div>
  )
}


// ── Grade colors ───────────────────────────────────────────────────────────────
const GRADE_COLORS: Record<string, { color: string; bg: string }> = {
  A: { color: 'var(--green)',        bg: 'rgba(14,166,110,0.12)'  },
  B: { color: 'var(--accent)',       bg: 'rgba(255,107,0,0.12)'   },
  C: { color: 'var(--accent-amber)', bg: 'rgba(245,158,11,0.12)'  },
  D: { color: 'var(--red)',          bg: 'rgba(255,68,68,0.12)'   },
}

// ── Toggle chip (neumorphic) ───────────────────────────────────────────────────
function NeuChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      height: 30, padding: '0 14px', borderRadius: 100, border: 'none', cursor: 'pointer',
      fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-display)',
      background: 'var(--bg)',
      boxShadow: active ? 'var(--neu-inset)' : 'var(--neu-raised-sm)',
      color: active ? 'var(--accent)' : 'var(--text-dim)',
      transition: 'box-shadow 0.15s, color 0.15s',
    }}>
      {label}
    </button>
  )
}


// ── Tab 1: Performance ─────────────────────────────────────────────────────────
interface AdvMetrics {
  sharpe_ratio: number | null
  max_drawdown: number
  days_to_recovery: number | null
  max_win_streak: number
  max_loss_streak: number
  total_trading_days: number
}

function PerformanceTab({ metrics, breakdown, allOrders, scores, avgScore, fy, timeSlots, advMetrics, stratRows }: {
  metrics: MetricRow[]
  breakdown: Record<string, Record<string, { pnl: number; trades: number }>>
  allOrders: Order[]
  scores: HealthScore[]
  avgScore: number
  fy: string
  timeSlots: { hour: number; label: string; trades: number; win_rate: number; total_pnl: number }[]
  advMetrics: AdvMetrics | null
  stratRows: StratRow[]
}) {
  const [activeView, setActiveView] = useState<'heatmap' | 'health'>('heatmap')
  const [showWeekends, setShowWeekends] = useState(false)
  const [selectedAlgo, setSelectedAlgo] = useState<string | null>(null)
  const { sorted: sortedScores, sortKey: scoresSortKey, sortDir: scoresSortDir, handleSort: handleScoresSort } = useSort<HealthScore>(scores, 'total_pnl')

  const bestAlgo       = metrics.length > 0 ? [...metrics].sort((a, b) => b.pnl - a.pnl)[0] : null
  const worstAlgo      = metrics.length > 0 ? [...metrics].sort((a, b) => a.pnl - b.pnl)[0] : null
  const best           = scores.length > 0 ? scores[0] : null
  const needsAttn      = scores.length > 0 ? [...scores].sort((a, b) => a.score - b.score)[0] : null
  const mostConsistent = scores.length > 0 ? [...scores].sort((a, b) => b.trades - a.trades)[0] : null

  const heatmapAlgos = Object.keys(breakdown).sort()

  const sharpeColor = advMetrics?.sharpe_ratio != null
    ? (advMetrics.sharpe_ratio > 1 ? 'var(--green)' : advMetrics.sharpe_ratio >= 0 ? 'var(--accent-amber)' : 'var(--red)')
    : 'var(--text-dim)'

  const advCardLabel: CSSProperties = {
    fontSize: 9, textTransform: 'uppercase', color: 'var(--text-mute)',
    marginBottom: 6, fontWeight: 700, letterSpacing: '0.1em', fontFamily: 'var(--font-display)',
  }
  const advCardVal = (color: string): CSSProperties => ({
    fontSize: 22, fontWeight: 700, lineHeight: 1.2, color, fontFamily: 'var(--font-mono)',
  })

  return (
    <div>
      {/* Row 1 — Advanced Metrics (5 cards) */}
      {advMetrics && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 10 }}>
          {/* Sharpe Ratio */}
          <div style={{ ...neuCardSm }}>
            <div style={advCardLabel}>Sharpe Ratio</div>
            <div style={advCardVal(sharpeColor)}>
              {advMetrics.sharpe_ratio != null ? advMetrics.sharpe_ratio.toFixed(3) : '—'}
            </div>
          </div>

          {/* Max Drawdown + Recovery */}
          <div style={{ ...neuCardSm }}>
            <div style={advCardLabel}>Max Drawdown</div>
            <div style={advCardVal('var(--red)')}>
              ₹{Math.abs(advMetrics.max_drawdown).toLocaleString('en-IN')}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-mute)', marginTop: 4 }}>
              Recovery: {advMetrics.days_to_recovery != null ? `${advMetrics.days_to_recovery}d` : 'Ongoing'}
            </div>
          </div>

          {/* Streak — split card */}
          <div style={{ ...neuCardSm, display: 'flex', flexDirection: 'column' }}>
            <div style={advCardLabel}>Streak</div>
            <div style={{ display: 'flex', flex: 1, alignItems: 'center' }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ fontSize: 9, color: 'var(--green)', fontWeight: 700, fontFamily: 'var(--font-display)', letterSpacing: '0.1em', marginBottom: 3 }}>WIN ↑</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>{advMetrics.max_win_streak}d</div>
              </div>
              <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--row-sep)', margin: '2px 0' }} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ fontSize: 9, color: 'var(--red)', fontWeight: 700, fontFamily: 'var(--font-display)', letterSpacing: '0.1em', marginBottom: 3 }}>LOSS ↓</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--red)', fontFamily: 'var(--font-mono)' }}>{advMetrics.max_loss_streak}d</div>
              </div>
            </div>
          </div>

          {/* Trading Days */}
          <div style={{ ...neuCardSm }}>
            <div style={advCardLabel}>Trading Days</div>
            <div style={advCardVal('var(--text-dim)')}>
              {advMetrics.total_trading_days}
            </div>
          </div>

          {/* Best Time to Trade */}
          <div style={{ ...neuCardSm }}>
            <div style={advCardLabel}>Best Time</div>
            {timeSlots.length === 0 ? (
              <div style={{ color: 'var(--text-mute)', fontSize: 12 }}>—</div>
            ) : (
              [...timeSlots]
                .sort((a, b) => b.total_pnl - a.total_pnl)
                .slice(0, 5)
                .map(slot => (
                  <div key={slot.hour} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-dim)' }}>
                      {slot.hour}AM
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, color: slot.total_pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {slot.total_pnl >= 0 ? '+' : '−'}₹{(Math.abs(slot.total_pnl) / 1000).toFixed(1)}k
                    </span>
                  </div>
                ))
            )}
          </div>
        </div>
      )}

      {/* Row 2 — 6 summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginBottom: 12 }}>
        <SummaryCard label="Best Algo" value={bestAlgo?.algo_name || '—'}
          sub={bestAlgo ? `${fmtPnl(bestAlgo.pnl)} · ${bestAlgo.wins}W/${bestAlgo.losses}L` : undefined}
          valueColor="var(--green)"
          onClick={bestAlgo?.algo_name && bestAlgo.algo_name !== '—' ? () => setSelectedAlgo(bestAlgo.algo_name) : undefined} />
        <SummaryCard label="Worst Algo" value={worstAlgo?.algo_name || '—'}
          sub={worstAlgo ? `${fmtPnl(worstAlgo.pnl)} · ${worstAlgo.wins}W/${worstAlgo.losses}L` : undefined}
          valueColor="var(--red)"
          onClick={worstAlgo?.algo_name && worstAlgo.algo_name !== '—' ? () => setSelectedAlgo(worstAlgo.algo_name) : undefined} />
        <SummaryCard label="Best Score" value={best ? String(best.score) : '—'}
          sub={best ? `${best.algo_name} · ${best.grade}` : undefined}
          valueColor={best ? (best.score >= 60 ? 'var(--green)' : best.score >= 40 ? 'var(--accent-amber)' : 'var(--red)') : 'var(--accent)'} />
        <SummaryCard label="Avg Score" value={scores.length > 0 ? String(avgScore) : '—'}
          valueColor={scores.length > 0 ? (avgScore >= 60 ? 'var(--green)' : avgScore >= 40 ? 'var(--accent-amber)' : 'var(--red)') : 'var(--accent)'} />
        <SummaryCard label="Most Consistent" value={mostConsistent?.algo_name || '—'}
          sub={mostConsistent ? `${mostConsistent.trades} trades` : undefined}
          valueColor="var(--accent)"
          onClick={mostConsistent?.algo_name && mostConsistent.algo_name !== '—' ? () => setSelectedAlgo(mostConsistent.algo_name) : undefined} />
        <SummaryCard label="Needs Attention" value={needsAttn?.algo_name || '—'}
          sub={needsAttn ? `Score ${needsAttn.score} · ${needsAttn.grade}` : undefined}
          valueColor="var(--red)"
          onClick={needsAttn?.algo_name && needsAttn.algo_name !== '—' ? () => setSelectedAlgo(needsAttn.algo_name) : undefined} />
      </div>

      {/* Cumulative P&L */}
      <CumulativePnlChart orders={allOrders} />

      {/* Heatmap / Health toggle */}
      <div style={{ ...neuCard, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <NeuChip label="P&L Heatmap"   active={activeView === 'heatmap'} onClick={() => setActiveView('heatmap')} />
            <NeuChip label="Health Scores" active={activeView === 'health'}  onClick={() => setActiveView('health')} />
          </div>
          {activeView === 'heatmap' && (
            <NeuChip label="Weekends" active={showWeekends} onClick={() => setShowWeekends(!showWeekends)} />
          )}
        </div>

        {activeView === 'heatmap' && (() => {
          const visibleDays = showWeekends ? ['MON','TUE','WED','THU','FRI','SAT','SUN'] : ['MON','TUE','WED','THU','FRI']
          if (heatmapAlgos.length === 0) return (
            <div style={{ textAlign: 'center', color: 'var(--text-mute)', padding: '32px', fontSize: 12 }}>No day-breakdown data available.</div>
          )
          return (
            <div>
              <table className="staax-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ minWidth: 120, maxWidth: 120, textAlign: 'left', borderBottom: '0.5px solid var(--border)' }}>Algo</th>
                    {visibleDays.map(d => <th key={d} style={{ textAlign: 'center', borderBottom: '0.5px solid var(--border)' }}>{d}</th>)}
                    <th style={{ textAlign: 'center', borderBottom: '0.5px solid var(--border)' }}>FY Total</th>
                  </tr>
                </thead>
                <tbody>
                  {heatmapAlgos.map(algo => {
                    const row = breakdown[algo]
                    const fyTotal = visibleDays.reduce((s, d) => s + (row[d]?.pnl ?? 0), 0)
                    return (
                      <tr key={algo}>
                        <td onClick={() => setSelectedAlgo(algo)} style={{ fontWeight: 600, textAlign: 'left', borderBottom: '0.5px solid var(--border)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: 13, cursor: 'pointer' }}>{algo}</td>
                        {visibleDays.map(d => {
                          const cell = row[d]
                          const pnl = cell?.pnl
                          let bg = 'var(--bg-surface, rgba(255,255,255,0.04))'
                          if (pnl !== undefined && pnl > 0) {
                            const alpha = Math.min(Math.abs(pnl) / 5000, 1) * 0.7 + 0.15
                            bg = `rgba(14,166,110,${alpha})`
                          } else if (pnl !== undefined && pnl < 0) {
                            const alpha = Math.min(Math.abs(pnl) / 3000, 1) * 0.7 + 0.15
                            bg = `rgba(255,68,68,${alpha})`
                          }
                          const tooltipText = cell ? `${algo} · ${d}\nP&L: ${fmtPnl(cell.pnl)}\nTrades: ${cell.trades}` : `${algo} · ${d}\nNo data`
                          return (
                            <td key={d} style={{ textAlign: 'center', padding: '4px 3px', borderBottom: '0.5px solid var(--border)' }}>
                              <div title={tooltipText} style={{ width: 22, height: 22, borderRadius: 3, background: bg, margin: '0 auto', cursor: 'help', transition: 'transform 0.15s' }} />
                            </td>
                          )
                        })}
                        <td style={{ textAlign: 'center', fontWeight: 700, ...numStyle, color: fyTotal >= 0 ? 'var(--green)' : 'var(--red)', borderBottom: '0.5px solid var(--border)' }}>{fmtPnl(fyTotal)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        })()}

        {activeView === 'health' && (
          scores.length === 0
            ? <div style={{ textAlign: 'center', color: 'var(--text-mute)', padding: '32px', fontSize: 12 }}>No health data available.</div>
            : <div>
                <table className="staax-table" style={{ width: '100%' }}>
                      <thead>
                        <tr>
                          <SortableHeader label="Algo"   sortKey="algo_name"  currentKey={scoresSortKey as string | null} currentDir={scoresSortDir} onSort={k => handleScoresSort(k as keyof HealthScore)} align="left"   style={{ borderBottom: '0.5px solid var(--border)' }} />
                          <SortableHeader label="Grade"  sortKey="grade"      currentKey={scoresSortKey as string | null} currentDir={scoresSortDir} onSort={k => handleScoresSort(k as keyof HealthScore)}              style={{ borderBottom: '0.5px solid var(--border)' }} />
                          <SortableHeader label="Score"  sortKey="score"      currentKey={scoresSortKey as string | null} currentDir={scoresSortDir} onSort={k => handleScoresSort(k as keyof HealthScore)}              style={{ borderBottom: '0.5px solid var(--border)' }} />
                          <SortableHeader label="Trades" sortKey="trades"     currentKey={scoresSortKey as string | null} currentDir={scoresSortDir} onSort={k => handleScoresSort(k as keyof HealthScore)}              style={{ borderBottom: '0.5px solid var(--border)' }} />
                          <SortableHeader label="Win %"  sortKey="win_pct"    currentKey={scoresSortKey as string | null} currentDir={scoresSortDir} onSort={k => handleScoresSort(k as keyof HealthScore)}              style={{ borderBottom: '0.5px solid var(--border)' }} />
                          <SortableHeader label="P&L"    sortKey="total_pnl"  currentKey={scoresSortKey as string | null} currentDir={scoresSortDir} onSort={k => handleScoresSort(k as keyof HealthScore)}              style={{ borderBottom: '0.5px solid var(--border)' }} />
                        </tr>
                      </thead>
                      <tbody>
                        {sortedScores.map(s => {
                          const g = GRADE_COLORS[s.grade] || GRADE_COLORS['D']
                          return (
                            <tr key={s.algo_name}>
                              <td style={{ borderBottom: '0.5px solid var(--border)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                <span onClick={() => setSelectedAlgo(s.algo_name)} style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontWeight: 600, cursor: 'pointer' }}>{s.algo_name}</span>
                              </td>
                              <td style={{ textAlign: 'center', borderBottom: '0.5px solid var(--border)' }}>
                                <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 100, color: g.color, background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}>{s.grade}</span>
                              </td>
                              <td style={{ borderBottom: '0.5px solid var(--border)', padding: '6px 8px' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 8 }}>
                                  <div style={{ ...neuInset, height: 10, borderRadius: 6, padding: '2px 3px' }}>
                                    <div style={{ width: `${Math.min(s.score, 100)}%`, height: '100%', borderRadius: 4, background: s.score >= 60 ? 'var(--accent)' : s.score >= 30 ? 'var(--accent-amber)' : 'var(--red)', transition: 'width 0.6s cubic-bezier(0.4,0,0.2,1)' }} />
                                  </div>
                                  <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 700, color: s.score >= 60 ? 'var(--accent)' : s.score >= 30 ? 'var(--accent-amber)' : 'var(--red)', minWidth: 36, textAlign: 'right' }}>{s.score}</span>
                                </div>
                              </td>
                              <td style={{ textAlign: 'center', ...numStyle, color: 'var(--text-dim)', fontSize: 12, borderBottom: '0.5px solid var(--border)' }}>{s.trades}</td>
                              <td style={{ textAlign: 'center', ...numStyle, color: s.win_pct >= 50 ? 'var(--green)' : 'var(--red)', borderBottom: '0.5px solid var(--border)' }}>{s.win_pct.toFixed(1)}%</td>
                              <td style={{ textAlign: 'center', ...numStyle, fontWeight: 700, color: s.total_pnl >= 0 ? 'var(--green)' : 'var(--red)', borderBottom: '0.5px solid var(--border)' }}>{fmtPnl(s.total_pnl)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
              </div>
        )}

      </div>

      {/* Strategy Type Breakdown */}
      <div style={neuCard}>
        <div style={secLabel}>Strategy Type Breakdown</div>
        {stratRows.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-mute)', fontSize: 12 }}>No data yet for FY {fy}</div>
        ) : (
          <div>
            <table className="staax-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left',   borderBottom: '0.5px solid var(--border)' }}>Strategy</th>
                  <th style={{ textAlign: 'center', borderBottom: '0.5px solid var(--border)' }}>Orders</th>
                  <th style={{ textAlign: 'center', borderBottom: '0.5px solid var(--border)' }}>Total P&amp;L</th>
                  <th style={{ textAlign: 'center', borderBottom: '0.5px solid var(--border)' }}>Avg P&amp;L</th>
                  <th style={{ textAlign: 'center', borderBottom: '0.5px solid var(--border)' }}>Win Rate</th>
                </tr>
              </thead>
              <tbody>
                {stratRows.map(r => (
                  <tr key={r.strategy_type}>
                    <td style={{ fontWeight: 600, textTransform: 'capitalize', textAlign: 'left', borderBottom: '0.5px solid var(--border)' }}>{r.strategy_type}</td>
                    <td style={{ textAlign: 'center', ...numStyle, borderBottom: '0.5px solid var(--border)' }}>{r.trades}</td>
                    <td style={{ textAlign: 'center', ...numStyle, color: r.total_pnl >= 0 ? 'var(--green)' : 'var(--red)', borderBottom: '0.5px solid var(--border)' }}>{fmtPnl(r.total_pnl)}</td>
                    <td style={{ textAlign: 'center', ...numStyle, color: r.avg_pnl >= 0 ? 'var(--green)' : 'var(--red)', borderBottom: '0.5px solid var(--border)' }}>{fmtPnl(r.avg_pnl)}</td>
                    <td style={{ textAlign: 'center', ...numStyle, color: r.win_rate >= 50 ? 'var(--green)' : 'var(--red)', borderBottom: '0.5px solid var(--border)' }}>{r.win_rate.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AlgoDetailModal algoName={selectedAlgo} onClose={() => setSelectedAlgo(null)} />
    </div>
  )
}


// ── Tab 2: Failure Analytics ───────────────────────────────────────────────────
interface ErrorsData {
  per_algo: { algo: string; errors: number; last_error: string | null }[]
  recent:   { id: string; algo: string; symbol: string; error_message: string | null; created_at: string | null }[]
  total_errors: number
  total_orders: number
  error_rate_pct: number
  total_closed_orders: number
}

function FailuresTab({ data }: { data: ErrorsData | null }) {
  if (!data) return (
    <div style={{ ...neuCard, textAlign: 'center', color: 'var(--text-mute)', padding: 48, fontSize: 12 }}>
      No failure data available.
    </div>
  )
  const perAlgo = data.per_algo ?? []
  const recent = data.recent ?? []
  const totalErrors = data.total_errors ?? 0
  const totalOrders = data.total_orders ?? 0
  const totalClosed = data.total_closed_orders ?? 0
  const mostFailed = perAlgo[0]?.algo || '—'

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12 }}>
        <SummaryCard label="Total Errors"        value={totalErrors.toString()} valueColor="var(--red)" />
        <SummaryCard label="CLOSED + ERROR ORDERS" value={totalOrders.toString()} sub={`of ${totalClosed} closed`} />
        <SummaryCard label="Most Failed Algo"    value={mostFailed} valueColor="var(--accent)" />
        <SummaryCard label="Algos w/ Errors"     value={perAlgo.length.toString()} />
      </div>

      <div style={neuCard}>
        <div style={secLabel}>Errors per Algo</div>
        {perAlgo.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-mute)', fontSize: 12 }}>No errors on record</div>
        ) : (() => {
          const errorRows = perAlgo.map(row => {
            const algoClean = cleanAlgo(row.algo)
            const recentEntry = recent
              .filter(o => cleanAlgo(o.algo) === algoClean)
              .sort((a, b) => {
                if (!a.created_at) return 1
                if (!b.created_at) return -1
                return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
              })[0]
            return {
              algo: algoClean,
              errors: row.errors,
              errorMsg: recentEntry?.error_message ?? '—',
              dateTime: recentEntry?.created_at ?? row.last_error,
              hasRecentTs: !!recentEntry?.created_at,
            }
          })
          return (
            <div className="no-scrollbar" style={{ maxHeight: 480, overflowY: 'auto' }}>
              <table className="staax-table" style={{ width: '100%', tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: 110 }} />
                  <col style={{ width: 100 }} />
                  <col />
                  <col style={{ width: 130 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left',   borderBottom: '0.5px solid var(--border)' }}>Algo</th>
                    <th style={{ textAlign: 'center', borderBottom: '0.5px solid var(--border)' }}>Errors</th>
                    <th style={{ textAlign: 'left',   borderBottom: '0.5px solid var(--border)', paddingLeft: 32 }}>Last Error Msg</th>
                    <th style={{ textAlign: 'center', borderBottom: '0.5px solid var(--border)' }}>Date / Time</th>
                  </tr>
                </thead>
                <tbody>
                  {errorRows.map(row => (
                    <tr key={row.algo}>
                      <td style={{ fontWeight: 600, textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', borderBottom: '0.5px solid var(--border)' }}>{row.algo}</td>
                      <td style={{ textAlign: 'center', ...numStyle, color: 'var(--red)', fontWeight: 700, borderBottom: '0.5px solid var(--border)' }}>{row.errors}</td>
                      <td style={{ color: row.errorMsg === '—' ? 'var(--text-mute)' : 'var(--red)', paddingLeft: 32, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', borderBottom: '0.5px solid var(--border)' }} title={row.errorMsg}>{row.errorMsg}</td>
                      <td style={{ color: 'var(--text-mute)', textAlign: 'center', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontSize: 12, borderBottom: '0.5px solid var(--border)' }}>
                        {row.hasRecentTs ? fmtDateTime(row.dateTime ?? undefined) : fmtDate(row.dateTime ?? undefined)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        })()}
      </div>
    </div>
  )
}


// ── Tab 3: Slippage Report ─────────────────────────────────────────────────────
interface SlippageAlgoRow {
  algo_name: string
  orders: number
  avg_slip_pts: number
  total_impact_inr: number
  best_pts: number
  worst_pts: number
}

interface SlippageSide {
  avg_slip_pts: number
  total_orders: number
  best_pts: number
  worst_pts: number
  per_algo: SlippageAlgoRow[]
}

interface SlippageData {
  exit_slippage: SlippageSide
  entry_slippage: SlippageSide
  by_date: { date: string; avg_exit_slip: number; avg_entry_slip: number; order_count: number }[]
  total_closed_orders: number
}

function SlippageTrendChart({ byDate }: { byDate: { date: string; avg_exit_slip: number; avg_entry_slip: number; order_count: number }[] }) {
  const data = [...byDate].sort((a, b) => a.date.localeCompare(b.date)).map(d => {
    const [y, m, dd] = d.date.slice(0, 10).split('-')
    return {
      date: `${dd}-${m}-${y}`,
      exitSlip: d.avg_exit_slip,
      entrySlip: d.avg_entry_slip,
    }
  })
  if (data.length < 2) return null
  return (
    <div style={{ ...neuCard, marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={secLabel}>Slippage Trend (pts / day)</div>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 20, height: 2, background: '#2dd4bf', borderRadius: 2 }} />
            <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>Exit Slip</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 20, height: 2, background: 'var(--accent)', borderRadius: 2, backgroundImage: 'repeating-linear-gradient(to right, var(--accent) 0, var(--accent) 4px, transparent 4px, transparent 6px)' }} />
            <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>Entry Slip</span>
          </div>
        </div>
      </div>
      <div style={{ ...neuInset, padding: '10px 8px 4px' }}>
        <ResponsiveContainer width="100%" height={156}>
          <LineChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--text-mute)' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 9, fill: 'var(--text-mute)' }} axisLine={false} tickLine={false} />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" strokeDasharray="3 3" />
            <Tooltip contentStyle={{ background: 'var(--bg)', border: 'none', boxShadow: 'var(--neu-raised)', borderRadius: 8, fontSize: 11 }} />
            <Line type="monotone" dataKey="exitSlip" stroke="#2dd4bf" strokeWidth={2} dot={false} name="Exit slip" />
            <Line type="monotone" dataKey="entrySlip" stroke="var(--accent)" strokeWidth={1.5} dot={false} name="Entry slip" strokeDasharray="4 2" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function SlippageTab({ data }: { data: SlippageData | null }) {
  const [showTip, setShowTip] = useState(false)

  if (!data) return (
    <div style={{ ...neuCard, textAlign: 'center', color: 'var(--text-mute)', padding: 48, fontSize: 12 }}>
      No slippage data available.
    </div>
  )

  const slipColor = (v: number) => v >= 0 ? 'var(--green)' : 'var(--red)'
  const fmtImpact = (v: number) => `${v >= 0 ? '+' : '−'}₹${Math.abs(Math.round(v)).toLocaleString('en-IN')}`

  const thStyle: CSSProperties = { textAlign: 'center', borderBottom: '0.5px solid var(--border)', fontWeight: 600, fontSize: 10, letterSpacing: '1.5px', color: 'var(--text-dim)' }
  const thLeft: CSSProperties  = { ...thStyle, textAlign: 'left' }
  const tdC: CSSProperties     = { textAlign: 'center', ...numStyle, borderBottom: '0.5px solid var(--row-sep)' }
  const tdL: CSSProperties     = { fontWeight: 600, textAlign: 'left', borderBottom: '0.5px solid var(--row-sep)', fontSize: 12 }

  function AlgoTable({ rows, label }: { rows: SlippageAlgoRow[]; label: string }) {
    return (
      <div style={{ ...neuCard, width: '100%', marginBottom: 12 }}>
        <div style={secLabel}>{label}</div>
        {rows.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-mute)', fontSize: 12 }}>No data on record</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="staax-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={thLeft}>ALGO</th>
                  <th style={thStyle}>ORDERS</th>
                  <th style={thStyle}>AVG SLIP (pts)</th>
                  <th style={thStyle}>TOTAL IMPACT (₹)</th>
                  <th style={thStyle}>BEST (pts)</th>
                  <th style={thStyle}>WORST (pts)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.algo_name}>
                    <td style={tdL}>{r.algo_name}</td>
                    <td style={tdC}>{r.orders}</td>
                    <td style={{ ...tdC, fontWeight: 700, color: slipColor(r.avg_slip_pts) }}>{fmtPts(r.avg_slip_pts)}</td>
                    <td style={{ ...tdC, color: slipColor(r.total_impact_inr) }}>{fmtImpact(r.total_impact_inr)}</td>
                    <td style={{ ...tdC, color: 'var(--green)' }}>{fmtPts(r.best_pts)}</td>
                    <td style={{ ...tdC, color: 'var(--red)' }}>{fmtPts(r.worst_pts)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  const totalClosed = data.total_closed_orders ?? 0

  return (
    <div>
      {/* Section 1 — 4 KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12 }}>
        <SummaryCard
          label="AVG EXIT SLIPPAGE (pts)"
          value={fmtPts(data.exit_slippage.avg_slip_pts)}
          valueColor={slipColor(data.exit_slippage.avg_slip_pts)}
        />
        <SummaryCard
          label="EXIT ORDERS WITH SL"
          value={data.exit_slippage.total_orders.toString()}
          sub={`of ${totalClosed} closed`}
        />
        <SummaryCard
          label="BEST TRADE (pts)"
          value={fmtPts(data.exit_slippage.best_pts)}
          valueColor="var(--green)"
        />
        <SummaryCard
          label="WORST TRADE (pts)"
          value={fmtPts(data.exit_slippage.worst_pts)}
          valueColor="var(--red)"
        />
      </div>

      {/* Section 2 — Exit slippage table with tooltip on header */}
      <div style={{ ...neuCard, width: '100%', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <span style={{ ...secLabel, marginBottom: 0 }}>Exit Slippage — SL &amp; Target exits</span>
          <span style={{ position: 'relative', display: 'inline-flex' }}>
            <span
              onMouseEnter={() => setShowTip(true)}
              onMouseLeave={() => setShowTip(false)}
              style={{ cursor: 'help', color: 'var(--text-mute)', fontSize: 12, lineHeight: 1 }}
            >ℹ</span>
            {showTip && (
              <div style={{
                position: 'absolute', bottom: 'calc(100% + 8px)', left: '50%',
                transform: 'translateX(-50%)',
                background: 'var(--bg)', boxShadow: 'var(--neu-raised)',
                borderRadius: 10, padding: '10px 14px', width: 280,
                fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.6,
                zIndex: 100, pointerEvents: 'none',
              }}>
                <strong style={{ color: 'var(--text)', display: 'block', marginBottom: 6 }}>How slippage is calculated</strong>
                Slippage = difference between your SL price and actual exit fill.<br />
                <span style={{ color: 'var(--green)' }}>Positive</span> = filled better than SL (good).<br />
                <span style={{ color: 'var(--red)' }}>Negative</span> = filled worse than SL (adverse).
              </div>
            )}
          </span>
        </div>
        {data.exit_slippage.per_algo.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-mute)', fontSize: 12 }}>No data on record</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="staax-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={thLeft}>ALGO</th>
                  <th style={thStyle}>ORDERS</th>
                  <th style={thStyle}>AVG SLIP (pts)</th>
                  <th style={thStyle}>TOTAL IMPACT (₹)</th>
                  <th style={thStyle}>BEST (pts)</th>
                  <th style={thStyle}>WORST (pts)</th>
                </tr>
              </thead>
              <tbody>
                {data.exit_slippage.per_algo.map(r => (
                  <tr key={r.algo_name}>
                    <td style={tdL}>{r.algo_name}</td>
                    <td style={tdC}>{r.orders}</td>
                    <td style={{ ...tdC, fontWeight: 700, color: slipColor(r.avg_slip_pts) }}>{fmtPts(r.avg_slip_pts)}</td>
                    <td style={{ ...tdC, color: slipColor(r.total_impact_inr) }}>{fmtImpact(r.total_impact_inr)}</td>
                    <td style={{ ...tdC, color: 'var(--green)' }}>{fmtPts(r.best_pts)}</td>
                    <td style={{ ...tdC, color: 'var(--red)' }}>{fmtPts(r.worst_pts)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Section 3 — Entry slippage table */}
      <AlgoTable rows={data.entry_slippage.per_algo} label="ENTRY SLIPPAGE — Market entry fills vs reference" />

      {/* Section 4 — Slippage trend line chart */}
      <SlippageTrendChart byDate={data.by_date} />
    </div>
  )
}


// ── Tab 4: Latency Tracker ─────────────────────────────────────────────────────
interface LatencyData {
  avg_latency_ms: number
  p50_latency_ms: number
  p95_latency_ms: number
  p99_latency_ms: number
  max_latency_ms: number
  total_orders:   number
  total_closed_orders: number
  success_rate:   number
  fast_pct:       number
  distribution:   { excellent: number; good: number; acceptable: number; slow: number }
  by_broker: { broker: string; avg_ms: number; p50_ms: number; p99_ms: number; fast_pct: number; count: number }[]
  by_algo:   { algo_name: string; avg_ms: number; count: number; total_orders: number }[]
  recent_orders: { time: string; symbol: string; broker: string; latency_ms: number | null; status: string }[]
}

function LatencyTab({ data }: { data: LatencyData | null }) {
  const [showAllRecent, setShowAllRecent] = useState(false)

  if (!data || data.total_orders === 0) {
    return (
      <div style={{ ...neuCard, textAlign: 'center', color: 'var(--text-mute)', padding: 48, fontSize: 12 }}>
        No latency data yet — execute trades to see metrics.
      </div>
    )
  }

  const maxAlgoMs = Math.max(...data.by_algo.map(a => a.avg_ms), 1)
  const distTotal = data.distribution.excellent + data.distribution.good + data.distribution.acceptable + data.distribution.slow

  function latencyColor(ms: number): string {
    if (ms < 150)  return 'var(--green)'
    if (ms < 250)  return 'var(--accent-amber)'
    return 'var(--red)'
  }

  function statusColor(s: string): string {
    if (s === 'filled') return 'var(--green)'
    if (s === 'error')  return 'var(--red)'
    return 'var(--text-mute)'
  }

  const distBuckets = [
    { key: 'excellent',  label: 'Excellent  <150ms',    color: 'var(--green)',        count: data.distribution.excellent  },
    { key: 'good',       label: 'Good       150–250ms',  color: '#22DD88',             count: data.distribution.good       },
    { key: 'acceptable', label: 'Acceptable 250–400ms',  color: 'var(--accent-amber)', count: data.distribution.acceptable },
    { key: 'slow',       label: 'Slow       >400ms',     color: 'var(--red)',          count: data.distribution.slow       },
  ]

  return (
    <div>
      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12 }}>
        <SummaryCard label="ORDERS WITH TIMING" value={data.total_orders.toString()}
          sub={`of ${data.total_closed_orders ?? data.total_orders} closed`} />
        <SummaryCard label="Avg Latency"  value={`${data.avg_latency_ms} ms`}
          valueColor={latencyColor(data.avg_latency_ms)} />
        <SummaryCard label="Fast Orders" value={`${data.fast_pct}%`}
          valueColor={data.fast_pct >= 80 ? 'var(--green)' : data.fast_pct >= 50 ? 'var(--accent-amber)' : 'var(--red)'}
          sub="<150ms" />
        <SummaryCard label="Success Rate" value={`${data.success_rate}%`}
          valueColor={data.success_rate >= 95 ? 'var(--green)' : data.success_rate >= 80 ? 'var(--accent-amber)' : 'var(--red)'} />
      </div>

      {/* Latency distribution */}
      <div style={{ ...neuCard, marginBottom: 12 }}>
        <div style={secLabel}>Latency Distribution</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {distBuckets.map(b => {
            const pct = distTotal > 0 ? b.count / distTotal * 100 : 0
            return (
              <div key={b.key} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 160, fontSize: 11, color: 'var(--text-dim)', flexShrink: 0, fontFamily: 'var(--font-mono)' }}>{b.label}</div>
                <div style={{ flex: 1, height: 10, borderRadius: 6, background: 'var(--bg)', boxShadow: 'var(--neu-inset)', padding: '2px 3px' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: b.color, borderRadius: 4, transition: 'width 0.4s ease', opacity: 0.9 }} />
                </div>
                <div style={{ width: 40, textAlign: 'right', fontSize: 12, fontWeight: 700, color: b.color, fontFamily: 'var(--font-mono)' }}>{b.count}</div>
                <div style={{ width: 36, textAlign: 'right', fontSize: 11, color: 'var(--text-mute)', fontFamily: 'var(--font-mono)' }}>{pct.toFixed(0)}%</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* By Broker */}
      {data.by_broker.length > 0 && (
        <div style={{ ...neuCard, marginBottom: 12 }}>
          <div style={secLabel}>By Broker</div>
          <table className="staax-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                {(['Broker', 'Avg', 'P50', 'P99', 'Fast%', 'Orders'] as const).map(h => (
                  <th key={h} style={{ textAlign: h === 'Broker' ? 'left' : 'center', borderBottom: '0.5px solid var(--border)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.by_broker.map(b => (
                <tr key={b.broker}>
                  <td style={{ fontWeight: 600, textAlign: 'left', borderBottom: '0.5px solid var(--border)' }}>{b.broker}</td>
                  <td style={{ textAlign: 'center', ...numStyle, fontWeight: 700, color: latencyColor(b.avg_ms), borderBottom: '0.5px solid var(--border)' }}>{b.avg_ms}</td>
                  <td style={{ textAlign: 'center', ...numStyle, color: latencyColor(b.p50_ms), borderBottom: '0.5px solid var(--border)' }}>{b.p50_ms}</td>
                  <td style={{ textAlign: 'center', ...numStyle, color: latencyColor(b.p99_ms), borderBottom: '0.5px solid var(--border)' }}>{b.p99_ms}</td>
                  <td style={{ textAlign: 'center', ...numStyle, color: b.fast_pct >= 80 ? 'var(--green)' : b.fast_pct >= 50 ? 'var(--accent-amber)' : 'var(--red)', borderBottom: '0.5px solid var(--border)' }}>{b.fast_pct}%</td>
                  <td style={{ textAlign: 'center', ...numStyle, color: 'var(--text-dim)', borderBottom: '0.5px solid var(--border)' }}>{b.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* By Algo */}
      {data.by_algo.length > 0 && (
        <div style={{ ...neuCard, marginBottom: 12 }}>
          <div style={secLabel}>By Algo</div>
          <table className="staax-table" style={{ width: '100%', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 160 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 80 }} />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th style={{ textAlign: 'left',   borderBottom: '0.5px solid var(--border)' }}>Algo</th>
                <th style={{ textAlign: 'center', borderBottom: '0.5px solid var(--border)', padding: '10px 8px' }}>Avg (ms)</th>
                <th style={{ textAlign: 'center', borderBottom: '0.5px solid var(--border)', padding: '10px 8px' }}>Orders</th>
                <th style={{ textAlign: 'center', borderBottom: '0.5px solid var(--border)' }}>Relative</th>
              </tr>
            </thead>
            <tbody>
              {data.by_algo.map(a => (
                <tr key={a.algo_name}>
                  <td style={{ fontWeight: 600, textAlign: 'left', borderBottom: '0.5px solid var(--border)' }}>{a.algo_name}</td>
                  <td style={{ textAlign: 'center', ...numStyle, fontWeight: 700, color: latencyColor(a.avg_ms), borderBottom: '0.5px solid var(--border)', padding: '11px 8px' }}>{a.avg_ms}</td>
                  <td style={{ textAlign: 'center', ...numStyle, color: 'var(--text-dim)', borderBottom: '0.5px solid var(--border)', padding: '11px 8px' }}>{a.count}</td>
                  <td style={{ textAlign: 'center', padding: '6px 12px', borderBottom: '0.5px solid var(--border)' }}>
                    <div style={{ height: 10, borderRadius: 6, background: 'var(--bg)', boxShadow: 'var(--neu-inset)', padding: '2px 3px' }}>
                      <div style={{ width: `${Math.round(a.avg_ms / maxAlgoMs * 100)}%`, height: '100%', background: latencyColor(a.avg_ms), borderRadius: 4, opacity: 0.85, transition: 'width 0.3s' }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Recent orders */}
      {data.recent_orders.length > 0 && (
        <div style={neuCard}>
          <div style={secLabel}>Recent Orders</div>
          <table className="staax-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                {(['Time', 'Symbol', 'Broker', 'Latency', 'Status'] as const).map(h => (
                  <th key={h} style={{ textAlign: h === 'Symbol' ? 'left' : 'center', borderBottom: '0.5px solid var(--border)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.recent_orders.slice(0, showAllRecent ? data.recent_orders.length : 10).map((o, i) => (
                <tr key={i}>
                  <td style={{ textAlign: 'center', ...numStyle, color: 'var(--text-mute)', borderBottom: '0.5px solid var(--border)' }}>{o.time}</td>
                  <td style={{ textAlign: 'left', fontWeight: 600, borderBottom: '0.5px solid var(--border)' }}>{o.symbol}</td>
                  <td style={{ textAlign: 'center', ...numStyle, color: 'var(--text-dim)', borderBottom: '0.5px solid var(--border)' }}>{o.broker}</td>
                  <td style={{ textAlign: 'center', ...numStyle, fontWeight: 700, color: o.latency_ms != null ? latencyColor(o.latency_ms) : 'var(--text-mute)', borderBottom: '0.5px solid var(--border)' }}>
                    {o.latency_ms != null ? `${o.latency_ms} ms` : '—'}
                  </td>
                  <td style={{ textAlign: 'center', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: statusColor(o.status), borderBottom: '0.5px solid var(--border)' }}>{o.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.recent_orders.length > 10 && (
            <button onClick={() => setShowAllRecent(s => !s)} style={{
              fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-mute)',
              background: 'none', border: 'none', cursor: 'pointer', marginTop: 8,
              letterSpacing: 1, display: 'block',
            }}>
              {showAllRecent ? '↑ Show less' : `↓ Show ${data.recent_orders.length - 10} more`}
            </button>
          )}
        </div>
      )}
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
  const [, setAlgos]                  = useState<Algo[]>([])
  const [breakdown, setBreakdown]     = useState<Record<string, Record<string, { pnl: number; trades: number }>>>({})
  const [errorsData, setErrorsData]   = useState<ErrorsData | null>(null)
  const [slippageData, setSlippageData] = useState<SlippageData | null>(null)
  const [healthScores, setHealthScores] = useState<HealthScore[]>([])
  const [healthAvg, setHealthAvg]     = useState(0)
  const [timeSlots, setTimeSlots]     = useState<{ hour: number; label: string; trades: number; win_rate: number; total_pnl: number }[]>([])
  const [latencyData, setLatencyData] = useState<LatencyData | null>(null)
  const [stratRows, setStratRows]     = useState<StratRow[]>([])
  const [loading, setLoading]         = useState(true)
  const [fy, setFy]                   = useState(getCurrentFY())
  const [advMetrics, setAdvMetrics]   = useState<AdvMetrics | null>(null)

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
      reportsAPI.strategyBreakdown({ fy, is_practix: isPractixMode }),
    ]).then(([mRes, oRes, aRes, bdRes, errRes, slipRes, hRes, tRes, latRes, stratRes]) => {
      const rawMetrics = (mRes.status === 'fulfilled'
        ? (Array.isArray(mRes.value.data) ? mRes.value.data : (mRes.value.data?.metrics || []))
        : []) as any[]
      setMetrics(rawMetrics.map((r) => ({
        algo_name: r.name || r.algo_name || '',
        trades:    r.trades || 0,
        wins:      r.wins || 0,
        losses:    r.losses || 0,
        pnl:       r.total_pnl ?? r.pnl ?? 0,
        win_rate:  r.win_pct ?? r.win_rate ?? 0,
      })))

      if (oRes.status === 'fulfilled') {
        const oData = oRes.value.data
        const rawGroups = (Array.isArray(oData) ? [] : (oData?.groups || [])) as Record<string, unknown>[]
        const flat: Order[] = rawGroups.flatMap((g) =>
          ((g['orders'] || []) as Record<string, unknown>[]).map((o) => ({ ...o, algo_name: (o['algo_name'] as string) || (g['algo_name'] as string) || '' } as Order))
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
      if (tRes.status === 'fulfilled') setTimeSlots(tRes.value.data?.slots || [])
      if (latRes.status === 'fulfilled') setLatencyData(latRes.value.data || null)
      if (stratRes.status === 'fulfilled') setStratRows(stratRes.value.data?.breakdown || [])
    }).finally(() => setLoading(false))

    api.get('/analytics/advanced-metrics', { params: { is_practix: isPractixMode } })
      .then(r => setAdvMetrics(r.data))
      .catch(console.error)
  }, [isPractixMode, fy])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 92px)' }}>

      {/* Page header */}
      <div className="page-header" style={{ marginBottom: 0, padding: '0 28px' }}>
        <div>
          <h1 style={{ color: 'var(--accent)', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22 }}>Analytics</h1>
          <p style={{ fontSize: 12, color: 'var(--text-mute)', marginTop: 3 }}>Performance deep-dive</p>
        </div>
        <div className="page-header-actions">
          <StaaxSelect value={fy} onChange={setFy} options={getFYOptions(3)} width="140px" />
        </div>
      </div>

      {/* Tab bar — neumorphic sliding pill */}
      <div style={{
        flexShrink: 0, display: 'flex', position: 'relative', margin: '13px 28px 20px',
        background: 'var(--bg)', boxShadow: 'var(--neu-inset)',
        borderRadius: 100, padding: '4px',
      }}>
        {/* Sliding pill indicator */}
        <div style={{
          position: 'absolute',
          top: 4, bottom: 4,
          left: `calc(4px + ${TABS.indexOf(activeTab)} * (100% - 8px) / ${TABS.length})`,
          width: `calc((100% - 8px) / ${TABS.length})`,
          background: 'var(--bg)',
          boxShadow: 'var(--neu-raised-sm)',
          borderRadius: 100,
          transition: 'left 0.28s cubic-bezier(0.4, 0, 0.2, 1)',
          pointerEvents: 'none',
        }} />
        {TABS.map(tab => (
          <button key={tab}
            onClick={() => { setActiveTab(tab); localStorage.setItem('analytics_tab', tab) }}
            style={{
              flex: 1, padding: '8px 0', textAlign: 'center',
              border: 'none', borderRadius: 100, cursor: 'pointer',
              position: 'relative', zIndex: 1,
              fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)',
              letterSpacing: '1px', textTransform: 'uppercase',
              background: 'transparent',
              color: activeTab === tab ? 'var(--accent)' : 'var(--text-dim)',
              transition: 'color 0.25s ease',
            }}>
            {tab}
          </button>
        ))}
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px 24px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 64, color: 'var(--text-mute)', fontSize: 13 }}>Loading…</div>
        ) : (
          <>
            {activeTab === 'Performance' && (
              <PerformanceTab
                metrics={metrics} breakdown={breakdown} allOrders={allOrders}
                scores={healthScores} avgScore={healthAvg}
                fy={fy} timeSlots={timeSlots} advMetrics={advMetrics}
                stratRows={stratRows}
              />
            )}
            {activeTab === 'Failures' && <FailuresTab data={errorsData} />}
            {activeTab === 'Slippage'  && <SlippageTab data={slippageData} />}
            {activeTab === 'Latency'   && <LatencyTab data={latencyData} />}
          </>
        )}

      </div>
    </div>
  )
}
