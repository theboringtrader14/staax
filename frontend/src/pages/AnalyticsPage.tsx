import { useState, useEffect, useMemo } from 'react'
import type { CSSProperties } from 'react'
import { AreaChart, Area, XAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { useStore } from '@/store'
import { reportsAPI, ordersAPI, algosAPI } from '@/services/api'
import type { Order, Algo } from '@/types'
import { getCurrentFY, getFYOptions } from '@/utils/fy'
import { StaaxSelect } from '@/components/StaaxSelect'

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
  fontSize: '10px', fontWeight: 700,
  color: 'rgba(232,232,248,0.7)',
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  marginBottom: '8px',
  borderLeft: '3px solid #FF6B00',
  paddingLeft: '10px',
  textShadow: '0 0 20px rgba(255,107,0,0.5)',
  boxShadow: 'none',
}

// Table wrapper
const tblWrap: CSSProperties = {
  borderRadius: '7px',
  overflow: 'hidden',
}

// Glass card style (v5.0)
const glassCard: CSSProperties = {
  background: 'var(--glass-bg)',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  border: '0.5px solid rgba(255,107,0,0.22)',
  borderRadius: 'var(--radius-lg)',
}

// Numeric value style (v5.0)
const numStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  color: '#F0F0FF',
  fontWeight: 600,
}


// ── Recharts dark tooltip ───────────────────────────────────────────────────────
function PnlTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const v: number = payload[0].value
  return (
    <div style={{
      background: 'rgba(14,14,24,0.96)', border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: '8px', padding: '8px 12px', fontSize: '11px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
    }}>
      <div style={{ color: 'rgba(232,232,248,0.45)', marginBottom: '3px', letterSpacing: '0.03em' }}>{label}</div>
      <div style={{ fontWeight: 700, fontSize: '13px', color: v >= 0 ? '#22DD88' : '#FF4444' }}>
        {v >= 0 ? '+' : '−'}₹{Math.abs(v).toLocaleString('en-IN')}
      </div>
    </div>
  )
}

// ── Cumulative P&L AreaChart ────────────────────────────────────────────────────
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
  const color = isPositive ? '#22DD88' : '#FF4444'
  const gradId = `pnlGrad-${isPositive ? 'g' : 'r'}`
  // stroke color matches chart colors spec: profit=#22DD88, loss=#FF4444

  return (
    <div className="card cloud-fill" style={{ ...glassCard, marginBottom: '12px', paddingBottom: '8px', padding: '16px 18px' }}>
      <div style={{ ...secHdr, marginBottom: '12px' }}>Cumulative P&amp;L</div>
      <ResponsiveContainer width="100%" height={100}>
        <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={color} stopOpacity={0.35} />
              <stop offset="95%" stopColor={color} stopOpacity={0}    />
            </linearGradient>
          </defs>
          <XAxis dataKey="date"
            tick={{ fontSize: 9, fill: 'rgba(232,232,248,0.35)' }}
            axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <Tooltip content={<PnlTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.08)', strokeWidth: 1 }} />
          <Area type="monotone" dataKey="cum" stroke={color} strokeWidth={1.5}
            fill={`url(#${gradId})`} dot={false}
            activeDot={{ r: 3, fill: color, strokeWidth: 0 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── Segmented Arc Gauge ─────────────────────────────────────────────────────────
function SegmentedArcGauge({ score }: { score: number }) {
  const s = Math.max(0, Math.min(100, score))
  const color = s >= 70 ? '#22DD88' : s >= 40 ? '#f59e0b' : '#FF4444'
  const grade = s >= 70 ? 'A' : s >= 40 ? 'B' : s < 20 ? 'D' : 'C'
  // SVG 160×96: arc center (80,90), r=68
  // M 12 90 A 68 68 0 1 0 148 90 = left→right through top (counterclockwise, large arc)
  const arcPath = 'M 12 90 A 68 68 0 1 0 148 90'
  return (
    <div style={{ textAlign: 'center' }}>
      <svg width="160" height="96" viewBox="0 0 160 96" style={{ display: 'block', margin: '0 auto', overflow: 'visible' }}>
        {/* Track segments: red zone 0-40, amber 40-70, green 70-100 */}
        <path d={arcPath} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="12" strokeLinecap="round" />
        {/* Score fill */}
        <path d={arcPath} fill="none" stroke={color} strokeWidth="12"
          pathLength="100" strokeDasharray={`${s} 100`}
          strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 6px ${color}80)`, transition: 'stroke-dasharray 0.6s cubic-bezier(0.4,0,0.2,1)' }} />
        {/* Center labels */}
        <text x="80" y="64" textAnchor="middle" dominantBaseline="middle"
          style={{ fontSize: '28px', fontWeight: 700, fill: color, fontFamily: 'inherit' }}>
          {s}
        </text>
        <text x="80" y="80" textAnchor="middle"
          style={{ fontSize: '9px', fill: 'rgba(232,232,248,0.38)', letterSpacing: '0.1em', fontFamily: 'inherit' }}>
          AVG HEALTH
        </text>
        {/* Grade badge */}
        <text x="80" y="93" textAnchor="middle"
          style={{ fontSize: '11px', fontWeight: 700, fill: color, fontFamily: 'inherit' }}>
          {grade}
        </text>
      </svg>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function SummaryCard({ label, value, sub, valueColor }: {
  label: string; value: string; sub?: string; valueColor?: string
}) {
  const isGreen = valueColor?.includes('green') || valueColor === 'var(--green)'
  const isRed   = valueColor?.includes('red')   || valueColor === 'var(--red)'
  const accentColor = isGreen ? '#22DD88' : isRed ? '#FF4444' : '#FF6B00'
  const accentRgb   = isGreen ? '16,185,129' : isRed ? '239,68,68' : '99,102,241'
  return (
    <div className="card card-stat" style={{
      borderTop: `2px solid ${accentColor}`,
      '--stat-rgb': accentRgb,
      boxShadow: `inset 0 1px 0 rgba(${accentRgb},0.2), 0 0 18px rgba(${accentRgb},0.18), 0 0 40px rgba(${accentRgb},0.07), 0 6px 24px rgba(0,0,0,0.5)`,
    } as React.CSSProperties}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '50px', background: `linear-gradient(to bottom, rgba(${accentRgb},0.07), transparent)`, pointerEvents: 'none', borderRadius: 'inherit' }} />
      <div style={{ fontSize: '10px', color: 'rgba(232,232,248,0.5)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px', fontWeight: 600 }}>
        {label}
      </div>
      <div style={{
        fontSize: '20px', fontWeight: 700, lineHeight: 1.2, wordBreak: 'break-word',
        background: `linear-gradient(135deg, ${accentColor} 0%, #FF8C33 100%)`,
        WebkitBackgroundClip: 'text', backgroundClip: 'text',
        WebkitTextFillColor: 'transparent', color: 'transparent',
        display: 'inline-block',
      }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: '10px', color: `rgba(${accentRgb},0.6)`, marginTop: '4px' }}>{sub}</div>}
    </div>
  )
}

// ── Grade Colors — shared ──────────────────────────────────────────────────────
const GRADE_COLORS: Record<string, { color: string; bg: string; border: string }> = {
  A: { color: 'var(--green)',        bg: 'rgba(34,221,136,0.12)',    border: 'rgba(34,221,136,0.3)'    },
  B: { color: 'var(--indigo)',        bg: 'rgba(255,107,0,0.12)',   border: 'rgba(255,107,0,0.3)'   },
  C: { color: 'var(--accent-amber)', bg: 'rgba(215,123,18,0.12)',   border: 'rgba(215,123,18,0.3)'   },
  D: { color: 'var(--red)',          bg: 'rgba(239,68,68,0.12)',    border: 'rgba(239,68,68,0.3)'    },
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
    if (pnl > 0) return `rgba(34,221,136,${Math.min(Math.abs(pnl) / 5000, 1) * 0.5 + 0.12})`
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
          sub={mostConsistent ? `${mostConsistent.trades} trades` : undefined} valueColor="var(--indigo)" />
        <SummaryCard label="Needs Attention" value={needsAttn?.algo_name || '—'}
          sub={needsAttn ? `Score ${needsAttn.score} · ${needsAttn.grade}` : undefined} valueColor="var(--red)" />
      </div>

      {/* Cumulative P&L chart */}
      <CumulativePnlChart orders={allOrders} />

      {/* Row 2 — chip toggle: P&L heatmap vs Health Scores */}
      <div className="card cloud-fill" style={{ ...glassCard, marginBottom: '12px', overflowX: 'auto', padding: '16px 18px' }}>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          {([['heatmap', 'P&L Heatmap'], ['health', 'Health Scores']] as const).map(([v, l]) => (
            <button key={v} onClick={() => setActiveView(v)}
              style={{
                padding: '4px 12px', borderRadius: '100px', fontSize: '11px', cursor: 'pointer',
                fontFamily: 'var(--font-display)', fontWeight: 600, border: 'none',
                background: activeView === v ? 'rgba(255,107,0,0.15)' : 'transparent',
                color: activeView === v ? '#FF6B00' : 'rgba(232,232,248,0.5)',
                outline: activeView === v ? '0.5px solid rgba(255,107,0,0.4)' : '0.5px solid rgba(232,232,248,0.12)',
              }}>{l}</button>
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
                        <th style={{ minWidth: '140px', textAlign: 'left', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>Algo</th>
                        {HEATMAP_DAYS.map(d => <th key={d} style={{ textAlign: 'center', width: '100px', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>{d}</th>)}
                        <th style={{ textAlign: 'center', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>FY Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {heatmapAlgos.map(algo => {
                        const row = breakdown[algo]
                        const fyTotal = HEATMAP_DAYS.reduce((s, d) => s + (row[d]?.pnl ?? 0), 0)
                        return (
                          <tr key={algo}>
                            <td style={{ fontWeight: 600, textAlign: 'left', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>{algo}</td>
                            {HEATMAP_DAYS.map(d => {
                              const cell = row[d]
                              return (
                                <td key={d} style={{ textAlign: 'center', padding: '6px 4px', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>
                                  <div style={{
                                  background: cellBg(cell?.pnl), borderRadius: '5px', padding: '5px 4px',
                                  fontSize: '10px', fontWeight: 700,
                                  color: cell ? (cell.pnl > 0 ? 'var(--green)' : cell.pnl < 0 ? 'var(--red)' : 'var(--text-dim)') : 'var(--text-dim)',
                                  boxShadow: cell && cell.pnl !== 0
                                    ? `0 0 8px ${cell.pnl > 0 ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}`
                                    : 'none',
                                  transition: 'all 0.2s ease',
                                }}>
                                    {cell ? (cell.pnl >= 0 ? '+' : '') + (cell.pnl / 1000).toFixed(1) + 'k' : '—'}
                                    {cell && <div style={{ fontSize: '9px', fontWeight: 400, color: 'var(--text-dim)', marginTop: '1px' }}>{cell.trades}t</div>}
                                  </div>
                                </td>
                              )
                            })}
                            <td style={{ textAlign: 'center', fontWeight: 700, ...numStyle, color: fyTotal >= 0 ? '#22DD88' : '#FF4444', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>{fmtPnl(fyTotal)}</td>
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
            : <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
                <div style={{ flexShrink: 0, paddingTop: '8px' }}>
                  <SegmentedArcGauge score={avgScore} />
                </div>
                <div style={{ flex: 1, ...tblWrap }}>
                <table className="staax-table" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>Algo</th>
                      <th style={{ textAlign: 'center', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>Grade</th>
                      <th style={{ textAlign: 'center', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>Score</th>
                      <th style={{ textAlign: 'center', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>Trades</th>
                      <th style={{ textAlign: 'center', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>Win %</th>
                      <th style={{ textAlign: 'center', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>P&amp;L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scores.map(s => {
                      const g = GRADE_COLORS[s.grade] || GRADE_COLORS['D']
                      return (
                        <tr key={s.algo_name}>
                          <td style={{ fontWeight: 600, textAlign: 'left', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>{s.algo_name}</td>
                          <td style={{ textAlign: 'center', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>
                            <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '100px', color: g.color, background: g.bg, border: `1px solid ${g.border}` }}>{s.grade}</span>
                          </td>
                          <td style={{ textAlign: 'center', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>
                              <div style={{ width: '80px', height: '6px', background: 'rgba(255,255,255,0.06)', borderRadius: '3px', flexShrink: 0, overflow: 'hidden' }}>
                                <div style={{
                                  width: `${Math.min(s.score, 100)}%`, height: '100%', borderRadius: '3px',
                                  background: s.score >= 70
                                    ? 'linear-gradient(90deg, #22DD88, #34d399)'
                                    : s.score >= 40
                                    ? 'linear-gradient(90deg, #f59e0b, #fcd34d)'
                                    : 'linear-gradient(90deg, #FF4444, #f87171)',
                                  boxShadow: s.score >= 70
                                    ? '0 0 8px rgba(16,185,129,0.7)'
                                    : s.score >= 40
                                    ? '0 0 8px rgba(245,158,11,0.7)'
                                    : '0 0 8px rgba(239,68,68,0.7)',
                                  transition: 'width 0.6s cubic-bezier(0.4,0,0.2,1)',
                                }} />
                              </div>
                              <span style={{ ...numStyle, fontSize: '12px', color: scoreBarColor(s.score) }}>{s.score}</span>
                            </div>
                          </td>
                          <td style={{ textAlign: 'center', ...numStyle, borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>{s.trades}</td>
                          <td style={{ textAlign: 'center', ...numStyle, color: s.win_pct >= 50 ? '#22DD88' : '#FF4444', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>{s.win_pct.toFixed(1)}%</td>
                          <td style={{ textAlign: 'center', ...numStyle, fontWeight: 700, color: s.total_pnl >= 0 ? '#22DD88' : '#FF4444', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>{fmtPnl(s.total_pnl)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                </div>
              </div>
        )}
      </div>

      {/* Row 3 — Best Time to Trade */}
      {timeSlots.length > 0 && (() => {
        const maxAbsPnl = Math.max(...timeSlots.map((s: any) => Math.abs(s.total_pnl)), 1)
        return (
          <div className="card cloud-fill" style={{ ...glassCard, marginBottom: '12px', padding: '16px 18px' }}>
            <div style={{ marginBottom: '24px' }}>
              <span style={{ ...secHdr, marginBottom: 0 }}>Best Time to Trade</span>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', height: '80px', paddingTop: '16px' }}>
              {timeSlots.map((slot: any) => {
                const barH = Math.max(4, Math.round((Math.abs(slot.total_pnl) / maxAbsPnl) * 60))
                const color = slot.total_pnl >= 0 ? 'var(--green)' : 'var(--red)'
                const title = `${slot.label}\n${slot.trades} trades · ${slot.win_rate}% win\n${slot.total_pnl >= 0 ? '+' : ''}₹${Math.abs(Math.round(slot.total_pnl)).toLocaleString('en-IN')}`
                return (
                  <div key={slot.hour} title={title} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', cursor: 'help' }}>
                    <div style={{ fontSize: '9px', fontWeight: 700, color, textAlign: 'center' }}>
                      {slot.total_pnl !== 0 ? `${slot.total_pnl >= 0 ? '+' : ''}${Math.abs(slot.total_pnl) >= 1000 ? (slot.total_pnl / 1000).toFixed(1) + 'k' : Math.round(slot.total_pnl)}` : '—'}
                    </div>
                    <div style={{
                      width: '100%', height: `${barH}px`,
                      background: slot.total_pnl >= 0
                        ? 'linear-gradient(to top, rgba(16,185,129,0.5), rgba(16,185,129,0.85))'
                        : 'linear-gradient(to top, rgba(239,68,68,0.5), rgba(239,68,68,0.85))',
                      border: `1px solid ${color}`,
                      borderRadius: '3px 3px 0 0',
                      boxShadow: slot.total_pnl !== 0 ? `0 0 8px ${slot.total_pnl >= 0 ? 'rgba(16,185,129,0.4)' : 'rgba(239,68,68,0.4)'}` : 'none',
                      transition: 'height 0.4s cubic-bezier(0.4,0,0.2,1)',
                    }} />
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
      <div className="card cloud-fill" style={{ ...glassCard, padding: '16px 18px' }}>
        <div style={{ marginBottom: '12px' }}>
          <span style={{ ...secHdr, marginBottom: 0 }}>Strategy Type Breakdown</span>
        </div>
        {stratRows.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'rgba(232,232,248,0.35)', fontSize: '13px' }}>No data yet for FY {fy}</div>
        ) : (
        <div style={tblWrap}>
          <table className="staax-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>Strategy</th>
                <th style={{ textAlign: 'center', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>Orders</th>
                <th style={{ textAlign: 'center', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>Total P&amp;L</th>
                <th style={{ textAlign: 'center', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>Avg P&amp;L</th>
                <th style={{ textAlign: 'center', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>Win Rate</th>
              </tr>
            </thead>
            <tbody>
              {stratRows.map(r => (
                <tr key={r.strategy_type}>
                  <td style={{ fontWeight: 600, textTransform: 'capitalize', textAlign: 'left', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>{r.strategy_type}</td>
                  <td style={{ textAlign: 'center', ...numStyle, borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>{r.count}</td>
                  <td style={{ textAlign: 'center', ...numStyle, color: r.total_pnl >= 0 ? '#22DD88' : '#FF4444', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>{fmtPnl(r.total_pnl)}</td>
                  <td style={{ textAlign: 'center', ...numStyle, color: r.avg_pnl >= 0 ? '#22DD88' : '#FF4444', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>{fmtPnl(r.avg_pnl)}</td>
                  <td style={{ textAlign: 'center', ...numStyle, color: r.win_rate >= 50 ? '#22DD88' : '#FF4444', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>{r.win_rate.toFixed(1)}%</td>
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
        <SummaryCard label="Most Failed Algo" value={mostFailed} valueColor="var(--indigo)" />
        <SummaryCard label="Algos with Errors" value={data.per_algo.length.toString()} />
      </div>

      <div className="card cloud-fill" style={{ ...glassCard, marginBottom: '12px', padding: '16px 18px' }}>
        <div style={secHdr}>Errors per Algo</div>
        {data.per_algo.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'rgba(232,232,248,0.35)', fontSize: '13px' }}>No errors on record</div>
        ) : (
        <div style={tblWrap}>
          <table className="staax-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>Algo</th>
                <th style={{ textAlign: 'center', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>Errors</th>
                <th style={{ textAlign: 'center', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>Last Error</th>
              </tr>
            </thead>
            <tbody>
              {data.per_algo.map(row => (
                <tr key={row.algo}>
                  <td style={{ fontWeight: 600, textAlign: 'left', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>{row.algo}</td>
                  <td style={{ textAlign: 'center', ...numStyle, color: '#FF4444', fontWeight: 700, borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>{row.errors}</td>
                  <td style={{ textAlign: 'center', color: 'rgba(232,232,248,0.5)', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>{fmtDate(row.last_error ?? undefined)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </div>

      <div className="card cloud-fill" style={{ ...glassCard, padding: '16px 18px' }}>
        <div style={secHdr}>Recent Error Orders (last 20)</div>
        {data.recent.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'rgba(232,232,248,0.35)', fontSize: '13px' }}>No recent errors</div>
        ) : (
        <div style={{ ...tblWrap, overflowX: 'auto' }}>
          <table className="staax-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>Time</th>
                <th style={{ textAlign: 'center', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>Algo</th>
                <th style={{ textAlign: 'center', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>Symbol</th>
                <th style={{ textAlign: 'center', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>Error Message</th>
              </tr>
            </thead>
            <tbody>
              {data.recent.map(o => {
                const msg = o.error_message || '—'
                const short = msg.length > 60 ? msg.slice(0, 60) + '…' : msg
                return (
                  <tr key={o.id}>
                    <td style={{ color: 'rgba(232,232,248,0.5)', whiteSpace: 'nowrap', textAlign: 'left', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>{fmtDate(o.created_at ?? undefined)}</td>
                    <td style={{ fontWeight: 600, textAlign: 'center', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>{o.algo}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', textAlign: 'center', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>{o.symbol}</td>
                    <td style={{ textAlign: 'center', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}><span title={msg} style={{ cursor: msg.length > 60 ? 'help' : 'default', color: '#FF4444', fontSize: '11px' }}>{short}</span></td>
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

      <div className="card cloud-fill" style={{ ...glassCard, padding: '16px 18px' }}>
        <div style={secHdr}>Slippage per Algo</div>
        {data.per_algo.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'rgba(232,232,248,0.35)', fontSize: '13px' }}>No slippage data on record</div>
        ) : (
        <div style={{ ...tblWrap, overflowX: 'auto' }}>
          <table className="staax-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>Algo</th>
                <th style={{ textAlign: 'center', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>Orders</th>
                <th style={{ textAlign: 'center', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>Avg Slip (pts)</th>
                <th style={{ textAlign: 'center', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>Total Slip (₹)</th>
                <th style={{ textAlign: 'center', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>Best</th>
                <th style={{ textAlign: 'center', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>Worst</th>
              </tr>
            </thead>
            <tbody>
              {data.per_algo.map(r => (
                <tr key={r.algo}>
                  <td style={{ fontWeight: 600, textAlign: 'left', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>{r.algo}</td>
                  <td style={{ textAlign: 'center', ...numStyle, borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>{r.orders}</td>
                  <td style={{ textAlign: 'center', ...numStyle, fontWeight: 700, color: slipColor(r.avg_slip_pts), borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>{fmtPts(r.avg_slip_pts)}</td>
                  <td style={{ textAlign: 'center', ...numStyle, color: r.total_slip_inr <= 0 ? '#22DD88' : '#FF4444', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>
                    {r.total_slip_inr >= 0 ? '+' : '-'}₹{Math.abs(Math.round(r.total_slip_inr)).toLocaleString('en-IN')}
                  </td>
                  <td style={{ textAlign: 'center', ...numStyle, color: '#22DD88', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>{fmtPts(r.best)}</td>
                  <td style={{ textAlign: 'center', ...numStyle, color: r.worst > 5 ? '#FF4444' : '#F0F0FF', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>{fmtPts(r.worst)}</td>
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
        <div className="card cloud-fill" style={{ ...glassCard, marginBottom: '12px', padding: '16px 18px' }}>
          <div style={secHdr}>By Broker</div>
          <div style={tblWrap}>
            <table className="staax-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>Broker</th>
                  <th style={{ textAlign: 'center', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>Avg (ms)</th>
                  <th style={{ textAlign: 'center', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>Orders</th>
                  <th style={{ width: '160px', textAlign: 'center', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>Bar</th>
                </tr>
              </thead>
              <tbody>
                {data.by_broker.map(b => (
                  <tr key={b.broker}>
                    <td style={{ fontWeight: 600, textAlign: 'left', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>{b.broker}</td>
                    <td style={{ textAlign: 'center', ...numStyle, fontWeight: 700, color: latencyColor(b.avg_ms), borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>{b.avg_ms}</td>
                    <td style={{ textAlign: 'center', ...numStyle, color: 'rgba(232,232,248,0.5)', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>{b.count}</td>
                    <td style={{ textAlign: 'center', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>
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
        <div className="card cloud-fill" style={{ ...glassCard, padding: '16px 18px' }}>
          <div style={secHdr}>By Algo</div>
          <div style={tblWrap}>
            <table className="staax-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>Algo</th>
                  <th style={{ textAlign: 'center', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>Avg (ms)</th>
                  <th style={{ textAlign: 'center', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>Orders</th>
                  <th style={{ width: '160px', textAlign: 'center', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>Bar</th>
                </tr>
              </thead>
              <tbody>
                {data.by_algo.map(a => (
                  <tr key={a.algo_name}>
                    <td style={{ fontWeight: 600, textAlign: 'left', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>{a.algo_name}</td>
                    <td style={{ textAlign: 'center', ...numStyle, fontWeight: 700, color: latencyColor(a.avg_ms), borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>{a.avg_ms}</td>
                    <td style={{ textAlign: 'center', ...numStyle, color: 'rgba(232,232,248,0.5)', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>{a.count}</td>
                    <td style={{ textAlign: 'center', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>
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
          <h1 style={{ color: 'var(--ox-radiant)', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '22px' }}>Analytics</h1>
          <p style={{ fontSize: '12px', color: 'var(--gs-muted)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            Performance deep-dive ·{' '}
            <span className={'chip ' + (isPractixMode ? 'chip-warn' : 'chip-success')} style={{ fontSize: '10px', padding: '1px 8px' }}>{isPractixMode ? 'PRACTIX' : 'LIVE'}</span>
          </p>
        </div>
        <div className="page-header-actions">
          <StaaxSelect
            value={fy}
            onChange={setFy}
            options={getFYOptions(3)}
            width="140px"
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: '6px', marginBottom: '16px' }}>
        {TABS.map(tab => (
          <button key={tab}
            onClick={() => { setActiveTab(tab); localStorage.setItem('analytics_tab', tab) }}
            style={{
              padding: '4px 12px', borderRadius: '100px', fontSize: '11px', cursor: 'pointer',
              fontFamily: 'var(--font-display)', fontWeight: 600, border: 'none',
              background: activeTab === tab ? 'rgba(255,107,0,0.15)' : 'transparent',
              color: activeTab === tab ? '#FF6B00' : 'rgba(232,232,248,0.5)',
              outline: activeTab === tab ? '0.5px solid rgba(255,107,0,0.4)' : '0.5px solid rgba(232,232,248,0.12)',
            }}>
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
