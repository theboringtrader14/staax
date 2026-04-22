import { useState, useEffect, useMemo, useRef } from 'react'
import type { CSSProperties } from 'react'
import { AreaChart, Area, XAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { useStore } from '@/store'
import { reportsAPI, ordersAPI, algosAPI } from '@/services/api'
import type { Order, Algo } from '@/types'
import { getCurrentFY, getFYOptions } from '@/utils/fy'
import { StaaxSelect } from '@/components/StaaxSelect'
import { AlgoDetailModal } from '@/components/AlgoDetailModal'

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
function PnlTooltip({ active, payload, label }: any) {
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
      if (!date || (o as any).pnl == null) continue
      byDate[date] = (byDate[date] ?? 0) + ((o as any).pnl ?? 0)
    }
    let cum = 0
    return Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, pnl]) => { cum += pnl; return { date: date.slice(5), cum: Math.round(cum) } })
  }, [orders])

  if (chartData.length < 2) return null

  const isPositive = chartData[chartData.length - 1].cum >= 0
  const colorHex = isPositive ? '#22DD88' : '#FF4444'
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


// ── Segmented Arc Gauge ────────────────────────────────────────────────────────
function SegmentedArcGauge({ score }: { score: number }) {
  const s = Math.max(0, Math.min(100, score))
  const color = s >= 70 ? '#22DD88' : s >= 40 ? '#f59e0b' : '#FF4444'
  const grade = s >= 70 ? 'A' : s >= 40 ? 'B' : s < 20 ? 'D' : 'C'
  const arcPath = 'M 8 88 A 72 72 0 1 0 152 88'
  return (
    <div style={{ textAlign: 'center' }}>
      <svg width="160" height="90" viewBox="0 0 160 90" style={{ display: 'block', margin: '0 auto' }}>
        <path d={arcPath} fill="none" stroke="var(--border)" strokeWidth="11" strokeLinecap="round" />
        <path d={arcPath} fill="none" stroke={color} strokeWidth="11"
          pathLength="100" strokeDasharray={`${s} 100`}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.6s cubic-bezier(0.4,0,0.2,1)' }} />
        <text x="80" y="60" textAnchor="middle" dominantBaseline="middle"
          style={{ fontSize: '26px', fontWeight: 700, fill: color, fontFamily: 'inherit' }}>
          {s}
        </text>
        <text x="80" y="78" textAnchor="middle"
          style={{ fontSize: '11px', fontWeight: 700, fill: color, fontFamily: 'inherit' }}>
          {grade}
        </text>
      </svg>
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
      <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.2, wordBreak: 'break-word', color: valueColor || 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 10, color: subColor, marginTop: 4 }}>{sub}</div>}
    </div>
  )
}


// ── Grade colors ───────────────────────────────────────────────────────────────
const GRADE_COLORS: Record<string, { color: string; bg: string }> = {
  A: { color: 'var(--green)',        bg: 'rgba(34,221,136,0.12)'  },
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
  const [showWeekends, setShowWeekends] = useState(false)
  const [selectedAlgo, setSelectedAlgo] = useState<string | null>(null)

  const bestAlgo       = metrics.length > 0 ? [...metrics].sort((a, b) => b.pnl - a.pnl)[0] : null
  const worstAlgo      = metrics.length > 0 ? [...metrics].sort((a, b) => a.pnl - b.pnl)[0] : null
  const best           = scores.length > 0 ? scores[0] : null
  const needsAttn      = scores.length > 0 ? [...scores].sort((a, b) => a.score - b.score)[0] : null
  const mostConsistent = scores.length > 0 ? [...scores].sort((a, b) => b.trades - a.trades)[0] : null

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

  const heatmapAlgos = Object.keys(breakdown).sort()

  return (
    <div>
      {/* Row 1 — 6 summary cards */}
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
                            bg = `rgba(34,221,136,${alpha})`
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
            : <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
                {/* Gauge */}
                <div style={{ flexShrink: 0, minWidth: 164, padding: '12px 8px 8px', textAlign: 'center' }}>
                  <SegmentedArcGauge score={avgScore} />
                  <div style={{ textAlign: 'center', fontSize: 9, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 700, marginTop: 4 }}>
                    Avg Score
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <table className="staax-table" style={{ width: '100%' }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: 'left',   borderBottom: '0.5px solid var(--border)' }}>Algo</th>
                          <th style={{ textAlign: 'center', borderBottom: '0.5px solid var(--border)' }}>Grade</th>
                          <th style={{ textAlign: 'center', borderBottom: '0.5px solid var(--border)' }}>Score</th>
                          <th style={{ textAlign: 'center', borderBottom: '0.5px solid var(--border)' }}>Trades</th>
                          <th style={{ textAlign: 'center', borderBottom: '0.5px solid var(--border)' }}>Win %</th>
                          <th style={{ textAlign: 'center', borderBottom: '0.5px solid var(--border)' }}>P&amp;L</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scores.map(s => {
                          const g = GRADE_COLORS[s.grade] || GRADE_COLORS['D']
                          return (
                            <tr key={s.algo_name}>
                              <td style={{ borderBottom: '0.5px solid var(--border)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                <span onClick={() => setSelectedAlgo(s.algo_name)} style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontWeight: 600, cursor: 'pointer' }}>{s.algo_name}</span>
                              </td>
                              <td style={{ textAlign: 'center', borderBottom: '0.5px solid var(--border)' }}>
                                <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 100, color: g.color, background: g.bg }}>{s.grade}</span>
                              </td>
                              <td style={{ borderBottom: '0.5px solid var(--border)', padding: '6px 8px' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 8 }}>
                                  <div style={{ ...neuInset, height: 6, borderRadius: 3 }}>
                                    <div style={{ width: `${Math.min(s.score, 100)}%`, height: '100%', borderRadius: 3, background: s.score >= 60 ? 'var(--accent)' : s.score >= 30 ? 'var(--accent-amber)' : 'var(--red)', transition: 'width 0.6s cubic-bezier(0.4,0,0.2,1)' }} />
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
              </div>
        )}
      </div>

      {/* Best Time to Trade */}
      {timeSlots.length > 0 && (() => {
        const maxAbsPnl = Math.max(...timeSlots.map((s: any) => Math.abs(s.total_pnl)), 1)
        return (
          <div style={{ ...neuCard, marginBottom: 12 }}>
            <div style={secLabel}>Best Time to Trade</div>
            <div style={{ padding: '0 4px' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', height: 80 }}>
                {timeSlots.map((slot: any) => {
                  const barH = Math.max(4, Math.round((Math.abs(slot.total_pnl) / maxAbsPnl) * 56))
                  const color = slot.total_pnl >= 0 ? 'var(--green)' : 'var(--red)'
                  const colorHex = slot.total_pnl >= 0 ? '#22DD88' : '#FF4444'
                  const title = `${slot.label}\n${slot.trades} trades · ${slot.win_rate}% win\n${slot.total_pnl >= 0 ? '+' : ''}₹${Math.abs(Math.round(slot.total_pnl)).toLocaleString('en-IN')}`
                  return (
                    <div key={slot.hour} title={title} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, cursor: 'help' }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color, textAlign: 'center' }}>
                        {slot.total_pnl !== 0 ? `${slot.total_pnl >= 0 ? '+' : ''}${Math.abs(slot.total_pnl) >= 1000 ? (slot.total_pnl / 1000).toFixed(1) + 'k' : Math.round(slot.total_pnl)}` : '—'}
                      </div>
                      <div style={{
                        width: '100%', height: `${barH}px`,
                        background: slot.total_pnl >= 0
                          ? `linear-gradient(to top, rgba(34,221,136,0.4), rgba(34,221,136,0.75))`
                          : `linear-gradient(to top, rgba(255,68,68,0.4), rgba(255,68,68,0.75))`,
                        borderRadius: '3px 3px 0 0',
                        boxShadow: slot.total_pnl !== 0 ? `0 0 6px ${colorHex}55` : 'none',
                        transition: 'height 0.4s cubic-bezier(0.4,0,0.2,1)',
                      }} />
                      <div style={{ fontSize: 9, color: 'var(--text-mute)', textAlign: 'center', whiteSpace: 'nowrap' }}>{slot.hour}AM</div>
                      <div style={{ fontSize: 9, color: 'var(--text-dim)', textAlign: 'center' }}>{slot.trades > 0 ? `${slot.win_rate}%` : '—'}</div>
                    </div>
                  )
                })}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 10, color: 'var(--text-mute)' }}>
              <span>Bar height = P&L magnitude</span>
              <span style={{ color: 'var(--green)' }}>■ Profit</span>
              <span style={{ color: 'var(--red)' }}>■ Loss</span>
              <span>% = win rate · hover for details</span>
            </div>
          </div>
        )
      })()}

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
                    <td style={{ textAlign: 'center', ...numStyle, borderBottom: '0.5px solid var(--border)' }}>{r.count}</td>
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
  const errorRatePct = data.error_rate_pct ?? 0
  const mostFailed = perAlgo[0]?.algo || '—'

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12 }}>
        <SummaryCard label="Total Errors"     value={totalErrors.toString()} valueColor="var(--red)" />
        <SummaryCard label="Error Rate"       value={`${errorRatePct.toFixed(1)}%`} sub={`of ${totalOrders} orders`} />
        <SummaryCard label="Most Failed Algo" value={mostFailed} valueColor="var(--accent)" />
        <SummaryCard label="Algos w/ Errors"  value={perAlgo.length.toString()} />
      </div>

      <div style={{ ...neuCard, marginBottom: 12 }}>
        <div style={secLabel}>Errors per Algo</div>
        {perAlgo.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-mute)', fontSize: 12 }}>No errors on record</div>
        ) : (
          <div style={neuInset}>
            <table className="staax-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left',   borderBottom: '0.5px solid var(--border)' }}>Algo</th>
                  <th style={{ textAlign: 'center', borderBottom: '0.5px solid var(--border)' }}>Errors</th>
                  <th style={{ textAlign: 'center', borderBottom: '0.5px solid var(--border)' }}>Last Error</th>
                </tr>
              </thead>
              <tbody>
                {perAlgo.map(row => (
                  <tr key={row.algo}>
                    <td style={{ fontWeight: 600, textAlign: 'left', borderBottom: '0.5px solid var(--border)' }}>{row.algo}</td>
                    <td style={{ textAlign: 'center', ...numStyle, color: 'var(--red)', fontWeight: 700, borderBottom: '0.5px solid var(--border)' }}>{row.errors}</td>
                    <td style={{ textAlign: 'center', color: 'var(--text-mute)', borderBottom: '0.5px solid var(--border)' }}>{fmtDate(row.last_error ?? undefined)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={neuCard}>
        <div style={secLabel}>Recent Error Orders (last 20)</div>
        {recent.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-mute)', fontSize: 12 }}>No recent errors</div>
        ) : (
          <div style={{ ...neuInset, overflowX: 'auto' }}>
            <table className="staax-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left',   borderBottom: '0.5px solid var(--border)' }}>Time</th>
                  <th style={{ textAlign: 'center', borderBottom: '0.5px solid var(--border)' }}>Algo</th>
                  <th style={{ textAlign: 'center', borderBottom: '0.5px solid var(--border)' }}>Symbol</th>
                  <th style={{ textAlign: 'center', borderBottom: '0.5px solid var(--border)' }}>Error Message</th>
                </tr>
              </thead>
              <tbody>
                {recent.map(o => {
                  const msg = o.error_message || '—'
                  const short = msg.length > 60 ? msg.slice(0, 60) + '…' : msg
                  return (
                    <tr key={o.id}>
                      <td style={{ color: 'var(--text-mute)', whiteSpace: 'nowrap', textAlign: 'left', borderBottom: '0.5px solid var(--border)' }}>{fmtDate(o.created_at ?? undefined)}</td>
                      <td style={{ fontWeight: 600, textAlign: 'center', borderBottom: '0.5px solid var(--border)' }}>{o.algo}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, textAlign: 'center', borderBottom: '0.5px solid var(--border)' }}>{o.symbol}</td>
                      <td style={{ textAlign: 'center', borderBottom: '0.5px solid var(--border)' }}>
                        <span title={msg} style={{ cursor: msg.length > 60 ? 'help' : 'default', color: 'var(--red)', fontSize: 11 }}>{short}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}


// ── Tab 3: Slippage Report ─────────────────────────────────────────────────────
interface SlippageData {
  per_algo: { algo: string; orders: number; avg_slip_pts: number; total_slip_inr: number; best: number; worst: number }[]
  avg_slippage_pts: number
  total_orders_with_ref: number
}

function SlippageTab({ data }: { data: SlippageData | null }) {
  if (!data) return (
    <div style={{ ...neuCard, textAlign: 'center', color: 'var(--text-mute)', padding: 48, fontSize: 12 }}>
      No slippage data available.
    </div>
  )

  function slipColor(avg: number): string {
    if (avg < 2)  return 'var(--green)'
    if (avg <= 5) return 'var(--accent-amber)'
    return 'var(--red)'
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 12 }}>
        <SummaryCard label="Avg Slippage (pts)"   value={fmtPts(data.avg_slippage_pts)}
          valueColor={slipColor(data.avg_slippage_pts)} />
        <SummaryCard label="Orders w/ Ref Price"  value={data.total_orders_with_ref.toString()} />
        <SummaryCard label="Algos Tracked"         value={data.per_algo.length.toString()} />
      </div>

      <div style={neuCard}>
        <div style={secLabel}>Slippage per Algo</div>
        {data.per_algo.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-mute)', fontSize: 12 }}>No slippage data on record</div>
        ) : (
          <div style={{ ...neuInset, overflowX: 'auto' }}>
            <table className="staax-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left',   borderBottom: '0.5px solid var(--border)' }}>Algo</th>
                  <th style={{ textAlign: 'center', borderBottom: '0.5px solid var(--border)' }}>Orders</th>
                  <th style={{ textAlign: 'center', borderBottom: '0.5px solid var(--border)' }}>Avg Slip (pts)</th>
                  <th style={{ textAlign: 'center', borderBottom: '0.5px solid var(--border)' }}>Total Slip (₹)</th>
                  <th style={{ textAlign: 'center', borderBottom: '0.5px solid var(--border)' }}>Best</th>
                  <th style={{ textAlign: 'center', borderBottom: '0.5px solid var(--border)' }}>Worst</th>
                </tr>
              </thead>
              <tbody>
                {data.per_algo.map(r => (
                  <tr key={r.algo}>
                    <td style={{ fontWeight: 600, textAlign: 'left', borderBottom: '0.5px solid var(--border)' }}>{r.algo}</td>
                    <td style={{ textAlign: 'center', ...numStyle, borderBottom: '0.5px solid var(--border)' }}>{r.orders}</td>
                    <td style={{ textAlign: 'center', ...numStyle, fontWeight: 700, color: slipColor(r.avg_slip_pts), borderBottom: '0.5px solid var(--border)' }}>{fmtPts(r.avg_slip_pts)}</td>
                    <td style={{ textAlign: 'center', ...numStyle, color: r.total_slip_inr <= 0 ? 'var(--green)' : 'var(--red)', borderBottom: '0.5px solid var(--border)' }}>
                      {r.total_slip_inr >= 0 ? '+' : '-'}₹{Math.abs(Math.round(r.total_slip_inr)).toLocaleString('en-IN')}
                    </td>
                    <td style={{ textAlign: 'center', ...numStyle, color: 'var(--green)', borderBottom: '0.5px solid var(--border)' }}>{fmtPts(r.best)}</td>
                    <td style={{ textAlign: 'center', ...numStyle, color: r.worst > 5 ? 'var(--red)' : 'var(--text)', borderBottom: '0.5px solid var(--border)' }}>{fmtPts(r.worst)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
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
  success_rate:   number
  fast_pct:       number
  distribution:   { excellent: number; good: number; acceptable: number; slow: number }
  by_broker: { broker: string; avg_ms: number; p50_ms: number; p99_ms: number; fast_pct: number; count: number }[]
  by_algo:   { algo_name: string; avg_ms: number; count: number; total_orders: number }[]
  recent_orders: { time: string; symbol: string; broker: string; latency_ms: number | null; status: string }[]
}

function LatencyTab({ data }: { data: LatencyData | null }) {
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
    if (ms < 250)  return '#4ade80'
    if (ms < 400)  return 'var(--accent-amber)'
    return 'var(--red)'
  }

  function statusColor(s: string): string {
    if (s === 'filled') return 'var(--green)'
    if (s === 'error')  return 'var(--red)'
    return 'var(--text-mute)'
  }

  const distBuckets = [
    { key: 'excellent',  label: 'Excellent  <150ms',    color: 'var(--green)',        count: data.distribution.excellent  },
    { key: 'good',       label: 'Good       150–250ms',  color: '#4ade80',             count: data.distribution.good       },
    { key: 'acceptable', label: 'Acceptable 250–400ms',  color: 'var(--accent-amber)', count: data.distribution.acceptable },
    { key: 'slow',       label: 'Slow       >400ms',     color: 'var(--red)',          count: data.distribution.slow       },
  ]

  return (
    <div>
      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12 }}>
        <SummaryCard label="Avg Latency"  value={`${data.avg_latency_ms} ms`}
          valueColor={latencyColor(data.avg_latency_ms)} sub={`${data.total_orders} orders`} />
        <SummaryCard label="P50 / P99"   value={`${data.p50_latency_ms} / ${data.p99_latency_ms} ms`}
          valueColor={latencyColor(data.p50_latency_ms)} />
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
                <div style={{ flex: 1, ...neuInset, height: 10, borderRadius: 5 }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: b.color, borderRadius: 5, transition: 'width 0.4s ease', opacity: 0.85 }} />
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
          <div style={neuInset}>
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
        </div>
      )}

      {/* By Algo */}
      {data.by_algo.length > 0 && (
        <div style={{ ...neuCard, marginBottom: 12 }}>
          <div style={secLabel}>By Algo</div>
          <div style={neuInset}>
            <table className="staax-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left',   borderBottom: '0.5px solid var(--border)' }}>Algo</th>
                  <th style={{ textAlign: 'center', borderBottom: '0.5px solid var(--border)' }}>Avg (ms)</th>
                  <th style={{ textAlign: 'center', borderBottom: '0.5px solid var(--border)' }}>Orders</th>
                  <th style={{ width: 160, textAlign: 'center', borderBottom: '0.5px solid var(--border)' }}>Bar</th>
                </tr>
              </thead>
              <tbody>
                {data.by_algo.map(a => (
                  <tr key={a.algo_name}>
                    <td style={{ fontWeight: 600, textAlign: 'left', borderBottom: '0.5px solid var(--border)' }}>{a.algo_name}</td>
                    <td style={{ textAlign: 'center', ...numStyle, fontWeight: 700, color: latencyColor(a.avg_ms), borderBottom: '0.5px solid var(--border)' }}>{a.avg_ms}</td>
                    <td style={{ textAlign: 'center', ...numStyle, color: 'var(--text-dim)', borderBottom: '0.5px solid var(--border)' }}>{a.count}</td>
                    <td style={{ textAlign: 'center', padding: '6px 12px', borderBottom: '0.5px solid var(--border)' }}>
                      <div style={{ ...neuInset, height: 8, borderRadius: 4 }}>
                        <div style={{ width: `${Math.round(a.avg_ms / maxAlgoMs * 100)}%`, height: '100%', background: latencyColor(a.avg_ms), borderRadius: 4, opacity: 0.8, transition: 'width 0.3s' }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent orders */}
      {data.recent_orders.length > 0 && (
        <div style={neuCard}>
          <div style={secLabel}>Recent Orders</div>
          <div style={neuInset}>
            <table className="staax-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  {(['Time', 'Symbol', 'Broker', 'Latency', 'Status'] as const).map(h => (
                    <th key={h} style={{ textAlign: h === 'Symbol' ? 'left' : 'center', borderBottom: '0.5px solid var(--border)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.recent_orders.map((o, i) => (
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
          </div>
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
  const [algos, setAlgos]             = useState<Algo[]>([])
  const [breakdown, setBreakdown]     = useState<Record<string, Record<string, { pnl: number; trades: number }>>>({})
  const [errorsData, setErrorsData]   = useState<ErrorsData | null>(null)
  const [slippageData, setSlippageData] = useState<SlippageData | null>(null)
  const [healthScores, setHealthScores] = useState<HealthScore[]>([])
  const [healthAvg, setHealthAvg]     = useState(0)
  const [timeSlots, setTimeSlots]     = useState<any[]>([])
  const [latencyData, setLatencyData] = useState<LatencyData | null>(null)
  const [loading, setLoading]         = useState(true)
  const [fy, setFy]                   = useState(getCurrentFY())
  const [advMetrics, setAdvMetrics]   = useState<{
    sharpe_ratio: number | null;
    max_drawdown: number;
    days_to_recovery: number | null;
    max_win_streak: number;
    max_loss_streak: number;
    total_trading_days: number;
  } | null>(null)

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
      if (tRes.status === 'fulfilled') setTimeSlots(tRes.value.data?.slots || [])
      if (latRes.status === 'fulfilled') setLatencyData(latRes.value.data || null)
    }).finally(() => setLoading(false))

    fetch('/api/v1/analytics/advanced-metrics')
      .then(r => r.json())
      .then(d => setAdvMetrics(d))
      .catch(console.error)
  }, [isPractixMode, fy])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 92px)' }}>

      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 style={{ color: 'var(--text)', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22 }}>Analytics</h1>
          <p style={{ fontSize: 12, color: 'var(--text-mute)', marginTop: 3 }}>Performance deep-dive</p>
        </div>
        <div className="page-header-actions">
          <StaaxSelect value={fy} onChange={setFy} options={getFYOptions(3)} width="140px" />
        </div>
      </div>

      {/* Tab bar — border-bottom style */}
      <div style={{ display: 'flex', borderBottom: '0.5px solid var(--border)', flexShrink: 0 }}>
        {TABS.map(tab => (
          <button key={tab}
            onClick={() => { setActiveTab(tab); localStorage.setItem('analytics_tab', tab) }}
            style={{
              padding: '10px 20px', border: 'none', cursor: 'pointer',
              borderBottom: activeTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
              fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-display)',
              background: 'transparent',
              color: activeTab === tab ? 'var(--accent)' : 'var(--text-dim)',
              transition: 'color 0.15s, border-bottom-color 0.15s',
            }}>
            {tab}
          </button>
        ))}
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 2px 24px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 64, color: 'var(--text-mute)', fontSize: 13 }}>Loading…</div>
        ) : (
          <>
            {activeTab === 'Performance' && (
              <PerformanceTab
                metrics={metrics} breakdown={breakdown} allOrders={allOrders}
                algos={algos} scores={healthScores} avgScore={healthAvg}
                fy={fy} timeSlots={timeSlots}
              />
            )}
            {activeTab === 'Failures' && <FailuresTab data={errorsData} />}
            {activeTab === 'Slippage'  && <SlippageTab data={slippageData} />}
            {activeTab === 'Latency'   && <LatencyTab data={latencyData} />}
          </>
        )}

        {/* Advanced Metrics — Performance tab only */}
        {!loading && activeTab === 'Performance' && (
          <div style={{ ...neuCard, marginTop: 12 }}>
            <div style={secLabel}>Advanced Metrics</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
              {[
                { label: 'Sharpe Ratio',    value: advMetrics?.sharpe_ratio != null ? advMetrics.sharpe_ratio.toFixed(3) : '—' },
                { label: 'Max Drawdown',    value: advMetrics ? `₹${Math.abs(advMetrics.max_drawdown).toLocaleString('en-IN')}` : '—' },
                { label: 'Days to Recovery', value: advMetrics?.days_to_recovery != null ? `${advMetrics.days_to_recovery}d` : advMetrics ? 'Ongoing' : '—' },
                { label: 'Max Win Streak',  value: advMetrics ? `${advMetrics.max_win_streak}d` : '—' },
                { label: 'Max Loss Streak', value: advMetrics ? `${advMetrics.max_loss_streak}d` : '—' },
                { label: 'Trading Days',    value: advMetrics ? `${advMetrics.total_trading_days}` : '—' },
              ].map(({ label, value }) => (
                <div key={label} style={{ ...neuCardSm }}>
                  <div style={{ fontSize: 9, textTransform: 'uppercase', color: 'var(--text-mute)', fontWeight: 700, letterSpacing: '0.1em', marginBottom: 6, fontFamily: 'var(--font-display)' }}>{label}</div>
                  <div style={{ ...numStyle, fontSize: 18, color: 'var(--text)' }}>{value}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
