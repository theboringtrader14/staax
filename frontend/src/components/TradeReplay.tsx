/**
 * TradeReplay — full-screen modal overlay showing a replay of all orders
 * placed by a given algo on a specific date.
 *
 * Layout:
 *   Header → SVG timeline → MTM area chart → Event log → Summary grid
 */
import { useEffect, useRef, useState } from 'react'

interface ReplayEvent {
  type: 'ENTRY' | 'EXIT' | 'AUTO_SQ' | 'SL_HIT' | 'ERROR' | 'MTM_UPDATE' | string
  description: string
  price: number
  pnl_at_time: number
  symbol: string
  time: string
}

interface ReplaySummary {
  entry_time: string | null
  exit_time: string | null
  total_pnl: number
  peak_pnl: number
  max_drawdown: number
  duration_minutes: number
}

interface CandlePoint {
  time: string
  ltp: number
  pnl: number
}

interface LegData {
  symbol: string
  direction: string
  entry_time: string
  exit_time: string
  entry_price: number
  exit_price: number
  pnl: number
  candles?: CandlePoint[]
}

interface MtmPoint {
  time: string
  pnl: number
}

interface ReplayData {
  algo_name: string
  date: string
  events: ReplayEvent[]
  summary: ReplaySummary
  legs?: LegData[]
  mtm_curve?: MtmPoint[]
}

export interface TradeReplayProps {
  algoId: string
  algoName: string
  date: string   // YYYY-MM-DD
  onClose: () => void
}

// ── helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  // "2026-03-20" → "Mar 20 2026"
  try {
    const d = new Date(iso + 'T00:00:00')
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return iso
  }
}

function fmtDuration(minutes: number): string {
  if (minutes <= 0) return '—'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function fmtPnl(val: number): string {
  const sign = val >= 0 ? '+' : '-'
  return `${sign}₹${Math.abs(val).toLocaleString('en-IN')}`
}

// ── Event type styling ────────────────────────────────────────────────────────

const EVENT_COLORS: Record<string, string> = {
  ENTRY:      '#FF6B00',
  EXIT:       '#22DD88',
  AUTO_SQ:    '#22DD88',
  SL_HIT:     '#FF4444',
  ERROR:      '#FF4444',
  MTM_UPDATE: '#888888',
}

const EVENT_BADGE_BG: Record<string, string> = {
  ENTRY:      'rgba(255,107,0,0.15)',
  EXIT:       'rgba(34,221,136,0.15)',
  AUTO_SQ:    'rgba(34,221,136,0.12)',
  SL_HIT:     'rgba(255,68,68,0.15)',
  ERROR:      'rgba(255,68,68,0.12)',
  MTM_UPDATE: 'rgba(136,136,136,0.10)',
}

function eventColor(type: string): string {
  return EVENT_COLORS[type] ?? '#888888'
}
function eventBadgeBg(type: string): string {
  return EVENT_BADGE_BG[type] ?? 'rgba(136,136,136,0.10)'
}

// ── SVG Timeline ─────────────────────────────────────────────────────────────

function TimelineSVG({ events }: { events: ReplayEvent[] }) {
  const W = 800
  const H = 44
  const PAD = 32
  const Y = H / 2

  if (events.length === 0) return null

  const significant = events.filter(e => e.type !== 'MTM_UPDATE')

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block', overflow: 'visible' }}>
      {/* base line */}
      <line x1={PAD} y1={Y} x2={W - PAD} y2={Y} stroke="rgba(255,255,255,0.12)" strokeWidth={1.5} />

      {significant.map((ev, i) => {
        const x = significant.length === 1
          ? W / 2
          : PAD + (i / (significant.length - 1)) * (W - PAD * 2)
        const col = eventColor(ev.type)

        if (ev.type === 'ENTRY') {
          return (
            <g key={i}>
              <circle cx={x} cy={Y} r={7} fill={col} opacity={0.9} />
              <text x={x} y={Y - 12} textAnchor="middle" fill={col} fontSize={9} fontFamily="monospace">{ev.time}</text>
              <text x={x} y={Y + 20} textAnchor="middle" fill={col} fontSize={8} fontFamily="monospace">{ev.type}</text>
            </g>
          )
        }
        if (ev.type === 'EXIT' || ev.type === 'AUTO_SQ') {
          return (
            <g key={i}>
              <rect x={x - 6} y={Y - 6} width={12} height={12} fill={col} opacity={0.9} />
              <text x={x} y={Y - 12} textAnchor="middle" fill={col} fontSize={9} fontFamily="monospace">{ev.time}</text>
              <text x={x} y={Y + 20} textAnchor="middle" fill={col} fontSize={8} fontFamily="monospace">{ev.type === 'AUTO_SQ' ? 'AUTO SQ' : 'EXIT'}</text>
            </g>
          )
        }
        if (ev.type === 'SL_HIT') {
          // diamond
          return (
            <g key={i}>
              <polygon points={`${x},${Y - 7} ${x + 6},${Y} ${x},${Y + 7} ${x - 6},${Y}`} fill={col} opacity={0.9} />
              <text x={x} y={Y - 12} textAnchor="middle" fill={col} fontSize={9} fontFamily="monospace">{ev.time}</text>
              <text x={x} y={Y + 20} textAnchor="middle" fill={col} fontSize={8} fontFamily="monospace">SL HIT</text>
            </g>
          )
        }
        return (
          <g key={i}>
            <circle cx={x} cy={Y} r={3} fill={col} opacity={0.7} />
          </g>
        )
      })}
    </svg>
  )
}

// ── MTM Multi-Leg Chart ───────────────────────────────────────────────────────

const LEG_COLORS = ['#4488FF', '#FF6B00', '#9B59B6', '#FFD700', '#00C9A7']

function timeToSecs(t: string): number {
  const parts = t.split(':').map(Number)
  return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0)
}

function MultiLegChart({
  events,
  legs,
  mtmCurve,
}: {
  events: ReplayEvent[]
  legs: LegData[]
  mtmCurve: MtmPoint[]
}) {
  const W = 800
  const H = 150
  const PADX = 10
  const PADY = 16
  const svgRef = useRef<SVGSVGElement>(null)
  const [hiddenLegs, setHiddenLegs] = useState<Set<number>>(new Set())
  const [showCombined, setShowCombined] = useState(true)
  const [hover, setHover] = useState<{ x: number; y: number; time: string; pnl: number } | null>(null)

  if (events.length < 2 && legs.length === 0) return null

  // Use precise mtm_curve if available, otherwise fall back to event-based points
  const hasPreciseCurve = mtmCurve.length >= 2
  const combinedSrc: { time: string; pnl: number }[] = hasPreciseCurve
    ? mtmCurve
    : events.map(e => ({ time: e.time, pnl: e.pnl_at_time }))

  // Collect all time seconds + P&L values for unified axis
  const allSecs = [
    ...combinedSrc.map(p => timeToSecs(p.time)),
    ...legs.flatMap(l => {
      const pts = l.candles && l.candles.length > 0 ? l.candles : []
      return pts.length > 0
        ? pts.map(c => timeToSecs(c.time))
        : [timeToSecs(l.entry_time), timeToSecs(l.exit_time)]
    }),
  ]
  const allPnls = [
    0,
    ...combinedSrc.map(p => p.pnl),
    ...legs.flatMap(l => {
      if (l.candles && l.candles.length > 0) return l.candles.map(c => c.pnl)
      return [0, l.pnl]
    }),
  ]

  const minT   = Math.min(...allSecs)
  const maxT   = Math.max(...allSecs)
  const tRange = maxT - minT || 1

  const rawMin = Math.min(...allPnls)
  const rawMax = Math.max(...allPnls)
  // Add 5% headroom so lines don't touch the edges
  const pad    = (rawMax - rawMin) * 0.05 || 50
  const minPnl = rawMin - pad
  const maxPnl = rawMax + pad
  const pRange = maxPnl - minPnl || 1

  const toX = (secs: number) => PADX + ((secs - minT) / tRange) * (W - PADX * 2)
  const toY = (v: number)    => PADY + ((maxPnl - v) / pRange) * (H - PADY * 2)
  const zeroY = toY(0)

  const finalPnl       = combinedSrc.length > 0 ? combinedSrc[combinedSrc.length - 1].pnl : 0
  const combinedStroke = finalPnl >= 0 ? '#22DD88' : '#FF4444'
  const combinedFill   = finalPnl >= 0 ? 'rgba(34,221,136,0.10)' : 'rgba(255,68,68,0.10)'

  // Combined polyline coords
  const combinedPts = combinedSrc.map(p => ({
    x: toX(timeToSecs(p.time)), y: toY(p.pnl), time: p.time, pnl: p.pnl,
  }))

  // Per-leg: use candle series if present, else entry→exit straight line
  const legLines = legs.map((leg, i) => {
    const color = LEG_COLORS[i % LEG_COLORS.length]
    const hasCandles = leg.candles && leg.candles.length >= 2
    const pts = hasCandles
      ? leg.candles!.map(c => ({ x: toX(timeToSecs(c.time)), y: toY(c.pnl) }))
      : [
          { x: toX(timeToSecs(leg.entry_time)), y: toY(0) },
          { x: toX(timeToSecs(leg.exit_time)),  y: toY(leg.pnl) },
        ]
    return { color, label: `${leg.symbol} ${leg.direction}`, pnl: leg.pnl, pts, hasCandles: !!hasCandles }
  })

  const toggleLeg = (i: number) =>
    setHiddenLegs(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n })

  // Hover: linear interpolation on combined line
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || combinedPts.length < 2) return
    const rect    = svgRef.current.getBoundingClientRect()
    const mx      = (e.clientX - rect.left) * (W / rect.width)
    const clamped = Math.max(combinedPts[0].x, Math.min(mx, combinedPts[combinedPts.length - 1].x))
    let seg = combinedPts.length - 2
    for (let i = 0; i < combinedPts.length - 1; i++) {
      if (clamped <= combinedPts[i + 1].x) { seg = i; break }
    }
    const a = combinedPts[seg], b = combinedPts[seg + 1]
    const t  = a.x === b.x ? 0 : (clamped - a.x) / (b.x - a.x)
    setHover({ x: clamped, y: a.y + t * (b.y - a.y), time: t < 0.5 ? a.time : b.time, pnl: a.pnl + t * (b.pnl - a.pnl) })
  }

  const tooltipX = hover ? (hover.x + 130 > W ? hover.x - 130 : hover.x + 8) : 0
  const tooltipY = hover ? Math.max(4, hover.y - 30) : 0

  return (
    <div>
      {/* Toggle buttons */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          onClick={() => setShowCombined(s => !s)}
          style={{
            padding: '3px 10px', borderRadius: 4,
            border: `1px solid ${combinedStroke}`,
            background: showCombined ? `${combinedStroke}22` : 'transparent',
            color: showCombined ? combinedStroke : 'rgba(232,232,248,0.35)',
            fontFamily: 'var(--font-mono)', fontSize: 11, cursor: 'pointer',
          }}
        >Combined{hasPreciseCurve ? ' ●' : ''}</button>
        {legLines.map((leg, i) => (
          <button
            key={i}
            onClick={() => toggleLeg(i)}
            style={{
              padding: '3px 10px', borderRadius: 4,
              border: `1px solid ${leg.color}`,
              background: !hiddenLegs.has(i) ? `${leg.color}22` : 'transparent',
              color: !hiddenLegs.has(i) ? leg.color : 'rgba(232,232,248,0.35)',
              fontFamily: 'var(--font-mono)', fontSize: 11, cursor: 'pointer',
            }}
          >{leg.label}{leg.hasCandles ? ' ●' : ''} {leg.pnl >= 0 ? '+' : ''}₹{Math.abs(leg.pnl).toFixed(0)}</button>
        ))}
      </div>
      {/* ● = precise 1-min candle data */}
      {(hasPreciseCurve || legLines.some(l => l.hasCandles)) && (
        <div style={{ fontSize: 10, color: 'rgba(232,232,248,0.3)', marginBottom: 6, fontFamily: 'var(--font-mono)' }}>
          ● 1-min candle precision
        </div>
      )}

      {/* SVG */}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        style={{ display: 'block', cursor: 'crosshair', overflow: 'visible' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHover(null)}
      >
        {/* zero line */}
        <line x1={PADX} y1={zeroY} x2={W - PADX} y2={zeroY}
          stroke="rgba(255,255,255,0.10)" strokeWidth={1} strokeDasharray="4 4" />

        {/* Combined fill area */}
        {showCombined && combinedPts.length >= 2 && (() => {
          const first = combinedPts[0], last = combinedPts[combinedPts.length - 1]
          const d = `M${first.x.toFixed(1)},${zeroY.toFixed(1)} ` +
            combinedPts.map(p => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') +
            ` L${last.x.toFixed(1)},${zeroY.toFixed(1)} Z`
          return <path d={d} fill={combinedFill} />
        })()}

        {/* Combined polyline */}
        {showCombined && combinedPts.length >= 2 && (
          <polyline
            points={combinedPts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
            fill="none" stroke={combinedStroke} strokeWidth={2}
            strokeLinecap="round" strokeLinejoin="round"
          />
        )}

        {/* Per-leg curves / lines */}
        {legLines.map((leg, i) => !hiddenLegs.has(i) && (
          <g key={i}>
            {leg.hasCandles ? (
              /* Precise candle-based polyline */
              <polyline
                points={leg.pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
                fill="none" stroke={leg.color} strokeWidth={1.5}
                strokeLinecap="round" strokeLinejoin="round" opacity={0.85}
              />
            ) : (
              /* Fallback: straight entry→exit dashed line */
              <line
                x1={leg.pts[0].x.toFixed(1)} y1={leg.pts[0].y.toFixed(1)}
                x2={leg.pts[leg.pts.length - 1].x.toFixed(1)} y2={leg.pts[leg.pts.length - 1].y.toFixed(1)}
                stroke={leg.color} strokeWidth={1.5} strokeDasharray="5 3" strokeLinecap="round"
              />
            )}
            {/* entry dot */}
            <circle cx={leg.pts[0].x} cy={leg.pts[0].y} r={3} fill={leg.color} opacity={0.7} />
            {/* exit dot */}
            <circle cx={leg.pts[leg.pts.length - 1].x} cy={leg.pts[leg.pts.length - 1].y}
              r={4} fill={leg.color} opacity={0.95} />
          </g>
        ))}

        {/* Hover crosshair */}
        {hover && showCombined && (
          <>
            <line x1={hover.x} y1={0} x2={hover.x} y2={H}
              stroke="rgba(255,255,255,0.20)" strokeWidth={1} strokeDasharray="4,4" />
            <circle cx={hover.x} cy={hover.y} r={4} fill="#FF6B00" stroke="#fff" strokeWidth={1.5} />
            <foreignObject x={tooltipX} y={tooltipY} width={126} height={50}>
              <div style={{
                background: 'rgba(10,10,11,0.9)',
                border: '0.5px solid rgba(255,107,0,0.4)',
                borderRadius: 6, padding: '4px 8px',
                fontFamily: 'var(--font-mono)', fontSize: 11,
              }}>
                <div style={{ color: 'rgba(232,232,248,0.6)' }}>{hover.time}</div>
                <div style={{ color: hover.pnl >= 0 ? '#22DD88' : '#FF4444', fontWeight: 700 }}>
                  {hover.pnl >= 0 ? '+' : ''}₹{hover.pnl.toFixed(2)}
                </div>
              </div>
            </foreignObject>
          </>
        )}
      </svg>
    </div>
  )
}

// ── Event log row ─────────────────────────────────────────────────────────────

function EventRow({ ev, idx }: { ev: ReplayEvent; idx: number }) {
  const col = eventColor(ev.type)
  const bg  = idx % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent'

  const pnlStr = ev.pnl_at_time !== 0
    ? fmtPnl(ev.pnl_at_time)
    : ''
  const pnlColor = ev.pnl_at_time >= 0 ? '#22DD88' : '#FF4444'

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '68px 80px 1fr 90px',
      alignItems: 'center',
      gap: '8px',
      padding: '5px 12px',
      background: bg,
      fontFamily: 'var(--font-mono, monospace)',
      fontSize: '12px',
    }}>
      <span style={{ color: 'var(--text-muted, rgba(255,255,255,0.45))' }}>{ev.time}</span>
      <span style={{
        fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '4px',
        background: eventBadgeBg(ev.type), color: col,
        letterSpacing: '0.4px', textAlign: 'center',
      }}>
        {ev.type === 'AUTO_SQ' ? 'AUTO SQ' : ev.type}
      </span>
      <span style={{ color: 'rgba(232,232,248,0.80)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {ev.description}
      </span>
      <span style={{ color: pnlColor, textAlign: 'right', fontWeight: 600 }}>
        {pnlStr}
      </span>
    </div>
  )
}

// ── Summary card ──────────────────────────────────────────────────────────────

function SummaryCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="cloud-fill" style={{ padding: '10px 14px', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <span style={{ fontSize: '10px', fontFamily: 'Syne, var(--font-display, sans-serif)', color: 'var(--text-muted, rgba(255,255,255,0.4))', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
        {label}
      </span>
      <span style={{ fontSize: '15px', fontFamily: 'var(--font-mono, monospace)', fontWeight: 700, color: color || 'rgba(232,232,248,0.90)' }}>
        {value}
      </span>
    </div>
  )
}

// ── Loading spinner ───────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '120px' }}>
      <div style={{
        width: 28, height: 28, borderRadius: '50%',
        border: '3px solid rgba(255,107,0,0.2)',
        borderTopColor: '#FF6B00',
        animation: 'spin 0.8s linear infinite',
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function TradeReplay({ algoId, algoName, date, onClose }: TradeReplayProps) {
  const [data, setData]     = useState<ReplayData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    const API = (import.meta as any).env?.VITE_API_URL || 'http://localhost:8000'
    fetch(`${API}/api/v1/orders/replay?algo_id=${encodeURIComponent(algoId)}&date=${encodeURIComponent(date)}`)
      .then(res => {
        if (!res.ok) throw new Error(`Server error ${res.status}`)
        return res.json()
      })
      .then((d: ReplayData) => { setData(d); setLoading(false) })
      .catch(e => { setError(e.message || 'Failed to load replay'); setLoading(false) })
  }, [algoId, date])

  const summary = data?.summary
  const events  = data?.events ?? []

  const formattedDate = new Date(date + 'T00:00:00').toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric'
  })

  // Derived summary display values
  const totalPnlColor = summary && summary.total_pnl >= 0 ? '#22DD88' : '#FF4444'
  const peakPnlColor  = '#22DD88'
  const ddColor       = '#FF4444'

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.75)',
        zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        style={{
          background: 'rgba(14,14,18,0.97)',
          backdropFilter: 'blur(20px)',
          border: '0.5px solid rgba(255,107,0,0.3)',
          borderRadius: 16,
          width: 'min(860px, 95vw)',
          maxHeight: '85vh',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 0,
        }}
      >
        {/* ── Header ── */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '0.5px solid rgba(255,107,0,0.15)',
          position: 'sticky', top: 0, zIndex: 10,
          background: 'rgba(14,14,18,0.97)',
          backdropFilter: 'blur(20px)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 0 }}>
            <div>
              <div style={{
                fontFamily: 'Syne', fontWeight: 700, fontSize: 11,
                color: 'rgba(232,232,248,0.4)', letterSpacing: 3,
                textTransform: 'uppercase', marginBottom: 6,
              }}>Trade Replay</div>
              <div style={{
                fontFamily: 'Syne', fontWeight: 700, fontSize: 20,
                color: 'var(--ox-radiant)',
              }}>{algoName}</div>
              <div style={{
                fontFamily: 'var(--font-mono)', fontSize: 12,
                color: 'rgba(232,232,248,0.45)', marginTop: 3,
              }}>{formattedDate}</div>
            </div>
            {/* close button top-right */}
            <button onClick={onClose} style={{
              background: 'none', border: 'none',
              color: 'rgba(232,232,248,0.4)', fontSize: 20,
              cursor: 'pointer', padding: '0 4px',
              lineHeight: 1,
            }}>×</button>
          </div>
        </div>

        {/* ── Body ── */}
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

          {loading && <Spinner />}

          {error && !loading && (
            <div style={{ textAlign: 'center', color: '#FF4444', padding: '32px 0', fontFamily: 'var(--font-mono, monospace)', fontSize: 13 }}>
              {error}
            </div>
          )}

          {!loading && !error && data && (
            <>
              {/* ── SVG Timeline ── */}
              {events.length > 0 && (
                <div>
                  <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', marginBottom: '6px', fontFamily: 'Syne, sans-serif', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
                    Timeline
                  </div>
                  <TimelineSVG events={events} />
                </div>
              )}

              {/* ── MTM Curve ── */}
              {events.length >= 2 && (
                <div>
                  <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', marginBottom: '4px', fontFamily: 'Syne, sans-serif', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
                    MTM Curve
                  </div>
                  <div style={{ border: '0.5px solid rgba(255,255,255,0.07)', borderRadius: 8, padding: '10px 12px 6px' }}>
                    <MultiLegChart events={events} legs={data.legs ?? []} mtmCurve={data.mtm_curve ?? []} />
                  </div>
                </div>
              )}

              {/* ── Event Log ── */}
              {events.length > 0 ? (
                <div>
                  <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', marginBottom: '4px', fontFamily: 'Syne, sans-serif', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
                    Event Log
                  </div>
                  <div style={{
                    maxHeight: '200px', overflowY: 'auto',
                    border: '0.5px solid rgba(255,255,255,0.07)', borderRadius: 8,
                  }}>
                    {events.map((ev, i) => <EventRow key={i} ev={ev} idx={i} />)}
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.35)', padding: '32px 0', fontSize: 13, fontFamily: 'var(--font-mono, monospace)' }}>
                  No orders found for this algo on {fmtDate(date)}.
                </div>
              )}

              {/* ── Summary Grid ── */}
              {summary && (
                <div>
                  <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', marginBottom: '8px', fontFamily: 'Syne, sans-serif', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
                    Summary
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                    <SummaryCard label="Entry Time"   value={summary.entry_time   || '—'} />
                    <SummaryCard label="Exit Time"    value={summary.exit_time    || '—'} />
                    <SummaryCard label="Duration"     value={fmtDuration(summary.duration_minutes)} />
                    <SummaryCard label="Total P&L"    value={summary.total_pnl   !== 0 ? fmtPnl(summary.total_pnl)   : '—'} color={summary.total_pnl   !== 0 ? totalPnlColor : undefined} />
                    <SummaryCard label="Peak P&L"     value={summary.peak_pnl    !== 0 ? fmtPnl(summary.peak_pnl)    : '—'} color={summary.peak_pnl    !== 0 ? peakPnlColor  : undefined} />
                    <SummaryCard label="Max Drawdown" value={summary.max_drawdown !== 0 ? fmtPnl(summary.max_drawdown) : '—'} color={summary.max_drawdown < 0 ? ddColor       : undefined} />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default TradeReplay
