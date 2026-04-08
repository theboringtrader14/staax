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

interface ReplayData {
  algo_name: string
  date: string
  events: ReplayEvent[]
  summary: ReplaySummary
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

// ── MTM Area Chart ────────────────────────────────────────────────────────────

function MtmChart({ events }: { events: ReplayEvent[] }) {
  const W = 800
  const H = 120
  const PADX = 10
  const PADY = 12
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<{ x: number; y: number; time: string; pnl: number } | null>(null)

  if (events.length < 2) return null

  const pnls = events.map(e => e.pnl_at_time)
  const finalPnl = pnls[pnls.length - 1]
  const minPnl = Math.min(...pnls, 0)
  const maxPnl = Math.max(...pnls, 0)
  const range = maxPnl - minPnl || 1

  const strokeColor = finalPnl >= 0 ? '#22DD88' : '#FF4444'
  const fillColor   = finalPnl >= 0 ? 'rgba(34,221,136,0.15)' : 'rgba(255,68,68,0.15)'

  const toX = (i: number) => PADX + (i / (pnls.length - 1)) * (W - PADX * 2)
  const toY = (v: number) => PADY + ((maxPnl - v) / range) * (H - PADY * 2)

  const coords = pnls.map((v, i) => ({ x: toX(i), y: toY(v) }))
  const zeroY  = toY(0)

  // Smooth cubic bezier path through all data points (midpoint control points)
  const buildSmooth = (cs: { x: number; y: number }[]) => {
    let d = `M${cs[0].x.toFixed(1)},${cs[0].y.toFixed(1)}`
    for (let i = 1; i < cs.length; i++) {
      const mx = ((cs[i - 1].x + cs[i].x) / 2).toFixed(1)
      d += ` C${mx},${cs[i-1].y.toFixed(1)} ${mx},${cs[i].y.toFixed(1)} ${cs[i].x.toFixed(1)},${cs[i].y.toFixed(1)}`
    }
    return d
  }
  const linePath = buildSmooth(coords)
  // Area: drop to zero baseline, follow the smooth line, close back to baseline
  const areaPath =
    `M${coords[0].x.toFixed(1)},${zeroY.toFixed(1)} L${coords[0].x.toFixed(1)},${coords[0].y.toFixed(1)}` +
    linePath.substring(linePath.indexOf(' ')) +
    ` L${coords[coords.length - 1].x.toFixed(1)},${zeroY.toFixed(1)} Z`

  // Pre-build point data for hover interpolation
  const points = events.map((ev, i) => ({
    x: coords[i].x,
    y: coords[i].y,
    time: ev.time,
    pnl: ev.pnl_at_time,
  }))

  // Binary-search for bezier t parameter at a given x (midpoint bezier: cp1x=cp2x=mx)
  const bezierTForX = (p0x: number, mx: number, p1x: number, targetX: number): number => {
    let lo = 0, hi = 1
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) * 0.5
      const x = (1-mid)**3*p0x + 3*(1-mid)**2*mid*mx + 3*(1-mid)*mid**2*mx + mid**3*p1x
      if (x < targetX) lo = mid; else hi = mid
    }
    return (lo + hi) * 0.5
  }

  // Evaluate bezier Y at t (midpoint bezier: cp1y=p0y, cp2y=p1y)
  // y(t) = p0y·(1-t)²(1+2t) + p1y·t²(3-2t)
  const bezierY = (t: number, p0y: number, p1y: number): number =>
    p0y * (1-t)**2 * (1+2*t) + p1y * t**2 * (3-2*t)

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || points.length < 2) return
    const svgRect = svgRef.current.getBoundingClientRect()
    const mouseXSvg = (e.clientX - svgRect.left) * (W / svgRect.width)

    // Clamp to chart X range
    const clampedX = Math.max(points[0].x, Math.min(mouseXSvg, points[points.length - 1].x))

    // Find the segment [i, i+1] that contains clampedX
    let seg = points.length - 2
    for (let i = 0; i < points.length - 1; i++) {
      if (clampedX <= points[i + 1].x) { seg = i; break }
    }

    const p0 = points[seg]
    const p1 = points[seg + 1]
    const mx = (p0.x + p1.x) / 2

    // Find exact bezier t for this x, then evaluate exact bezier Y
    const bt = p0.x === p1.x ? 0 : bezierTForX(p0.x, mx, p1.x, clampedX)
    const interpY   = bezierY(bt, p0.y, p1.y)
    const interpPnl = bezierY(bt, p0.pnl, p1.pnl)
    const time = bt < 0.5 ? p0.time : p1.time

    setHover({ x: clampedX, y: interpY, time, pnl: interpPnl })
  }

  const tooltipX = hover ? (hover.x + 128 > W ? hover.x - 128 : hover.x + 8) : 0
  const tooltipY = hover ? Math.max(4, hover.y - 30) : 0

  return (
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
      <line x1={PADX} y1={zeroY} x2={W - PADX} y2={zeroY} stroke="rgba(255,255,255,0.10)" strokeWidth={1} strokeDasharray="4 4" />
      {/* smooth fill */}
      <path d={areaPath} fill={fillColor} />
      {/* smooth line */}
      <path d={linePath} fill="none" stroke={strokeColor} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      {/* crosshair — continuous, interpolated */}
      {hover && (
        <>
          <line
            x1={hover.x} y1={0} x2={hover.x} y2={H}
            stroke="rgba(255,255,255,0.2)" strokeWidth={1} strokeDasharray="4,4"
          />
          <circle
            cx={hover.x} cy={hover.y} r={4}
            fill="#FF6B00" stroke="#fff" strokeWidth={1.5}
          />
          <foreignObject x={tooltipX} y={tooltipY} width={120} height={50}>
            <div style={{
              background: 'rgba(10,10,11,0.9)',
              border: '0.5px solid rgba(255,107,0,0.4)',
              borderRadius: 6,
              padding: '4px 8px',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
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
                  <div style={{ border: '0.5px solid rgba(255,255,255,0.07)', borderRadius: 8, overflow: 'hidden' }}>
                    <MtmChart events={events} />
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
