/**
 * TradeReplay — full-screen modal overlay showing a replay of all orders
 * placed by a given algo on a specific date.
 */
import { useEffect, useRef, useState } from 'react'

// ── Interfaces ────────────────────────────────────────────────────────────────

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

interface TradeStats {
  max_profit: number
  max_drawdown: number
  avg_mtm: number
  duration_minutes: number
  time_at_peak: string
  time_at_trough: string
  profit_factor: number | null
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
  candle_error?: string
  sl_pnl?: number | null
  sl_level?: number | null
  tp_pnl?: number | null
  tp_level?: number | null
  sl_hit?: boolean
  tp_hit?: boolean
  auto_sq?: boolean
  exit_reason?: string
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
  stats?: TradeStats | null
}

export interface TradeReplayProps {
  algoId: string
  algoName: string
  date: string   // YYYY-MM-DD
  onClose: () => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso + 'T00:00:00')
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return iso }
}

function fmtDuration(minutes: number): string {
  if (minutes <= 0) return '—'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function fmtPnl(val: number): string {
  const sign = val >= 0 ? '+' : '-'
  return `${sign}₹${Math.abs(val).toLocaleString('en-IN')}`
}

function timeToSecs(t: string): number {
  if (!t || t === '—') return 0
  const parts = t.split(':').map(Number)
  return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0)
}

function secsToHHMM(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function secsToHHMMSS(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
}

// ── Derive legs from events when server doesn't return them ───────────────────

function buildLegsFromEvents(events: ReplayEvent[]): LegData[] {
  const entryMap: Record<string, { time: string; price: number; direction: string }> = {}
  const legs: LegData[] = []
  let prevPnl = 0

  for (const ev of events) {
    if (ev.type === 'ENTRY') {
      const dir = ev.description.split(' ')[0] || ''
      entryMap[ev.symbol] = { time: ev.time, price: ev.price, direction: dir }
    }
  }

  const exitEvs = events
    .filter(e => e.type !== 'ENTRY' && e.type !== 'MTM_UPDATE')
    .sort((a, b) => a.time.localeCompare(b.time))

  for (const ev of exitEvs) {
    const entry = entryMap[ev.symbol]
    const legPnl = Math.round((ev.pnl_at_time - prevPnl) * 100) / 100
    prevPnl = ev.pnl_at_time
    legs.push({
      symbol:      ev.symbol,
      direction:   entry?.direction || '',
      entry_time:  entry?.time || ev.time,
      exit_time:   ev.time,
      entry_price: entry?.price || 0,
      exit_price:  ev.price,
      pnl:         legPnl,
    })
  }

  return legs
}

// ── Brownian bridge synthetic paths ──────────────────────────────────────────
// Seeded RNG (xorshift32) — same trade always renders the same path

function _seededRand(seed: number): () => number {
  let s = (seed ^ 0xDEADBEEF) >>> 0
  if (s === 0) s = 1
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5
    s = s >>> 0
    return s / 0xFFFFFFFF
  }
}

function _seedForLeg(leg: LegData): number {
  const sc = leg.symbol.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0)
  return Math.abs(Math.round(leg.entry_price * 7 + leg.exit_price * 13 + leg.pnl * 100) + sc)
}

/**
 * Returns n+2 P&L values [0, ..., finalPnl] with a Brownian bridge path.
 * volatility controls the amount of oscillation around the trend.
 * The path is deterministic for a given seed.
 */
function _brownianBridge(n: number, finalPnl: number, volatility: number, seed: number): number[] {
  const rand = _seededRand(seed)
  // Box-Muller normal sample
  const normal = (): number => {
    const u = rand() + 1e-10, v = rand()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }

  const pts = new Array<number>(n + 2)
  pts[0] = 0

  // Cumulative random walk for n+1 steps
  for (let i = 1; i <= n + 1; i++) {
    pts[i] = pts[i - 1] + normal() * (volatility / Math.sqrt(n + 1))
  }

  // Brownian bridge correction: pin endpoint to finalPnl
  const rawEnd = pts[n + 1]
  const correction = finalPnl - rawEnd
  for (let i = 1; i <= n + 1; i++) {
    pts[i] += correction * (i / (n + 1))
  }

  return pts
}

// Returns a lookup: secs → synthetic pnl for one leg (0 before entry, finalPnl after exit)
function _buildLegBridge(leg: LegData, sharedTimes: number[]): Map<number, number> {
  const es  = timeToSecs(leg.entry_time)
  const xs  = timeToSecs(leg.exit_time)

  // Only times within [es, xs]
  const inner = sharedTimes.filter(t => t > es && t < xs)
  const n     = inner.length
  const vol   = Math.abs(leg.pnl) * 0.45 + 15
  const path  = _brownianBridge(n, leg.pnl, vol, _seedForLeg(leg))
  // path[0] = 0 at es, path[n+1] = finalPnl at xs, path[1..n] for inner times

  const map = new Map<number, number>()
  map.set(es, 0)
  inner.forEach((t, i) => map.set(t, path[i + 1]))
  map.set(xs, leg.pnl)

  // For any time between two known points, the caller interpolates
  // Also pre-fill before/after with clamped values
  sharedTimes.forEach(t => {
    if (t < es)   map.set(t, 0)
    if (t > xs)   map.set(t, leg.pnl)
  })

  return map
}

function _interpolateLegAtTime(map: Map<number, number>, secs: number, es: number, xs: number, finalPnl: number): number {
  if (secs <= es) return 0
  if (secs >= xs) return finalPnl
  // Linear interpolation between two adjacent known points
  const keys = Array.from(map.keys()).filter(k => k >= es && k <= xs).sort((a, b) => a - b)
  let lo = es, hi = xs, vlo = 0, vhi = finalPnl
  for (let i = 0; i < keys.length - 1; i++) {
    if (keys[i] <= secs && keys[i + 1] >= secs) {
      lo = keys[i]; hi = keys[i + 1]
      vlo = map.get(lo) ?? 0
      vhi = map.get(hi) ?? finalPnl
      break
    }
  }
  const frac = hi > lo ? (secs - lo) / (hi - lo) : 0
  return vlo + frac * (vhi - vlo)
}

/**
 * Builds synthetic MTM curve + per-leg CandlePoint arrays for display.
 * Returns { mtm, legCandles } — legCandles[i] maps to legs[i].
 */
function buildSyntheticPaths(legs: LegData[]): {
  mtm: MtmPoint[]
  legCandles: CandlePoint[][]
} {
  if (legs.length === 0) return { mtm: [], legCandles: [] }

  // Shared time grid — 60 points per leg spanning its duration
  const STEPS = 60
  const allSecsSet = new Set<number>()
  for (const leg of legs) {
    const es = timeToSecs(leg.entry_time)
    const xs = timeToSecs(leg.exit_time)
    if (es === 0 && xs === 0) continue
    allSecsSet.add(es)
    allSecsSet.add(xs)
    for (let i = 1; i < STEPS; i++) {
      allSecsSet.add(Math.round(es + (i / STEPS) * (xs - es)))
    }
  }
  const sorted = Array.from(allSecsSet).filter(s => s > 0).sort((a, b) => a - b)

  // Build per-leg bridge maps
  const bridges = legs.map(leg => _buildLegBridge(leg, sorted))

  // Per-leg CandlePoint arrays for the chart's per-leg polylines
  const legCandles: CandlePoint[][] = legs.map((leg, i) => {
    const es  = timeToSecs(leg.entry_time)
    const xs  = timeToSecs(leg.exit_time)
    const map = bridges[i]
    return sorted
      .filter(t => t >= es && t <= xs)
      .map(t => ({
        time: secsToHHMMSS(t),
        ltp:  0,  // not used for display; only pnl matters
        pnl:  Math.round(_interpolateLegAtTime(map, t, es, xs, leg.pnl) * 100) / 100,
      }))
  })

  // Combined MTM = sum of all legs at each time point
  const mtm: MtmPoint[] = sorted.map(secs => {
    let total = 0
    legs.forEach((leg, i) => {
      const es = timeToSecs(leg.entry_time)
      const xs = timeToSecs(leg.exit_time)
      total += _interpolateLegAtTime(bridges[i], secs, es, xs, leg.pnl)
    })
    return { time: secsToHHMMSS(secs), pnl: Math.round(total * 100) / 100 }
  })

  return { mtm, legCandles }
}

// ── Event styling ─────────────────────────────────────────────────────────────

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
function eventColor(type: string): string { return EVENT_COLORS[type] ?? '#888888' }
function eventBadgeBg(type: string): string { return EVENT_BADGE_BG[type] ?? 'rgba(136,136,136,0.10)' }

// ── SVG Timeline ──────────────────────────────────────────────────────────────

function TimelineSVG({ events }: { events: ReplayEvent[] }) {
  const W = 800, H = 44, PAD = 32, Y = H / 2
  if (events.length === 0) return null

  // Deduplicate: one marker per unique (normalised-type, HH:MM) bucket.
  // ENTRY events within the same minute collapse to one. EXIT / SL_HIT
  // events at the exact same timestamp collapse to one.
  const typeGroup = (t: string) =>
    t === 'AUTO_SQ' ? 'EXIT' : t   // treat AUTO_SQ same as EXIT for grouping

  const seen = new Set<string>()
  const significant = events
    .filter(e => e.type !== 'MTM_UPDATE')
    .filter(e => {
      // For ENTRY: deduplicate within the same HH:MM minute
      // For EXIT types: deduplicate on exact HH:MM:SS
      const resolution = e.type === 'ENTRY'
        ? e.time.slice(0, 5)    // "HH:MM"
        : e.time                 // "HH:MM:SS"
      const key = `${typeGroup(e.type)}_${resolution}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}
      style={{ display: 'block', overflow: 'visible' }}>
      <line x1={PAD} y1={Y} x2={W - PAD} y2={Y}
        stroke="rgba(255,255,255,0.12)" strokeWidth={1.5} />
      {significant.map((ev, i) => {
        const x = significant.length === 1 ? W / 2
          : PAD + (i / (significant.length - 1)) * (W - PAD * 2)
        const col = eventColor(ev.type)
        if (ev.type === 'ENTRY') return (
          <g key={i}>
            <circle cx={x} cy={Y} r={7} fill={col} opacity={0.9} />
            <text x={x} y={Y - 12} textAnchor="middle" fill={col} fontSize={9} fontFamily="monospace">{ev.time}</text>
            <text x={x} y={Y + 20} textAnchor="middle" fill={col} fontSize={8} fontFamily="monospace">ENTRY</text>
          </g>
        )
        if (ev.type === 'EXIT' || ev.type === 'AUTO_SQ') return (
          <g key={i}>
            <rect x={x - 6} y={Y - 6} width={12} height={12} fill={col} opacity={0.9} />
            <text x={x} y={Y - 12} textAnchor="middle" fill={col} fontSize={9} fontFamily="monospace">{ev.time}</text>
            <text x={x} y={Y + 20} textAnchor="middle" fill={col} fontSize={8} fontFamily="monospace">
              {ev.type === 'AUTO_SQ' ? 'AUTO SQ' : 'EXIT'}
            </text>
          </g>
        )
        if (ev.type === 'SL_HIT') return (
          <g key={i}>
            <polygon points={`${x},${Y - 7} ${x + 6},${Y} ${x},${Y + 7} ${x - 6},${Y}`} fill={col} opacity={0.9} />
            <text x={x} y={Y - 12} textAnchor="middle" fill={col} fontSize={9} fontFamily="monospace">{ev.time}</text>
            <text x={x} y={Y + 20} textAnchor="middle" fill={col} fontSize={8} fontFamily="monospace">SL HIT</text>
          </g>
        )
        return <g key={i}><circle cx={x} cy={Y} r={3} fill={col} opacity={0.7} /></g>
      })}
    </svg>
  )
}

// ── Stats Panel ───────────────────────────────────────────────────────────────

function StatItem({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.07)',
      borderRadius: 8, padding: '9px 12px', display: 'flex', flexDirection: 'column', gap: 2,
    }}>
      <span style={{ fontSize: 10, fontFamily: 'Syne, sans-serif', color: 'rgba(232,232,248,0.38)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
        {label}
      </span>
      <span style={{ fontSize: 14, fontFamily: 'var(--font-mono)', fontWeight: 700, color: color || 'rgba(232,232,248,0.88)' }}>
        {value}
      </span>
      {sub && <span style={{ fontSize: 9, color: 'rgba(232,232,248,0.3)', fontFamily: 'var(--font-mono)' }}>{sub}</span>}
    </div>
  )
}

function StatsPanel({ stats }: { stats: TradeStats }) {
  return (
    <div>
      <div style={sectionLabel}>Trade Statistics</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 7 }}>
        <StatItem label="Max Profit"    value={fmtPnl(stats.max_profit)}   color="#22DD88"
          sub={stats.time_at_peak   !== '—' ? `at ${stats.time_at_peak}` : undefined} />
        <StatItem label="Max Drawdown"  value={fmtPnl(stats.max_drawdown)} color="#FF4444"
          sub={stats.time_at_trough !== '—' ? `at ${stats.time_at_trough}` : undefined} />
        <StatItem label="Avg MTM"       value={fmtPnl(stats.avg_mtm)} color={stats.avg_mtm >= 0 ? '#22DD88' : '#FF4444'} />
        <StatItem label="Duration"      value={fmtDuration(stats.duration_minutes)} />
        <StatItem label="Profit Factor"
          value={stats.profit_factor != null ? stats.profit_factor.toFixed(2) : '—'}
          color={stats.profit_factor != null && stats.profit_factor >= 1 ? '#22DD88' : '#FF4444'} />
      </div>
    </div>
  )
}

// ── MTM Multi-Leg Chart ───────────────────────────────────────────────────────

const LEG_COLORS = ['#4488FF', '#FF6B00', '#9B59B6', '#FFD700', '#00C9A7']

type PlaySpeed = 1 | 5 | 10

// SVG constants — exported so scrubber can mirror them
const SVG_W = 800
const SVG_H = 170
const SVG_PADX = 10
const SVG_PADX_RIGHT = 48
const SVG_PADY = 16
const SVG_DRAW_W = SVG_W - SVG_PADX - SVG_PADX_RIGHT  // 742

function MultiLegChart({
  events,
  legs,
  mtmCurve,
}: {
  events: ReplayEvent[]
  legs: LegData[]
  mtmCurve: MtmPoint[]
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const playRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [hiddenLegs, setHiddenLegs] = useState<Set<number>>(new Set())
  const [showCombined, setShowCombined] = useState(true)
  const [hover, setHover] = useState<{ x: number; y: number; time: string; pnl: number } | null>(null)
  const [playProgress, setPlayProgress] = useState(0)
  const [isPlaying, setIsPlaying]       = useState(false)
  const [playSpeed, setPlaySpeed]       = useState<PlaySpeed>(1)

  // Play engine
  useEffect(() => {
    if (isPlaying) {
      playRef.current = setInterval(() => {
        setPlayProgress(prev => {
          const next = prev + playSpeed * 0.5
          if (next >= 100) { setIsPlaying(false); return 100 }
          return next
        })
      }, 200)
    } else {
      if (playRef.current) clearInterval(playRef.current)
    }
    return () => { if (playRef.current) clearInterval(playRef.current) }
  }, [isPlaying, playSpeed])

  if (events.length < 2 && legs.length === 0) return null

  // ── Choose MTM source ─────────────────────────────────────────────────────
  const hasPreciseCurve = mtmCurve.length >= 2
  const hasCandleLegs   = legs.some(l => l.candles && l.candles.length >= 2)

  // Build synthetic Brownian-bridge paths when no real candle data
  // Returns combined MTM + per-leg candle arrays for smooth wavy lines
  const synthetic = (!hasPreciseCurve && !hasCandleLegs && legs.length > 0)
    ? buildSyntheticPaths(legs)
    : null

  // Priority: 1) precise mtm_curve from real candles, 2) synthetic Brownian bridge, 3) raw events
  const combinedSrc: { time: string; pnl: number }[] = (() => {
    if (hasPreciseCurve) return mtmCurve
    if (synthetic)       return synthetic.mtm
    return events.map(e => ({ time: e.time, pnl: e.pnl_at_time }))
  })()

  // ── Axis computation ──────────────────────────────────────────────────────
  const allSecs = [
    ...combinedSrc.map(p => timeToSecs(p.time)),
    ...legs.flatMap((l, i) => {
      const candles = l.candles && l.candles.length > 0
        ? l.candles
        : synthetic?.legCandles[i] ?? []
      return candles.length > 0
        ? candles.map(c => timeToSecs(c.time))
        : [timeToSecs(l.entry_time), timeToSecs(l.exit_time)]
    }),
  ].filter(s => s > 0)

  const allPnls = [
    0,
    ...combinedSrc.map(p => p.pnl),
    ...legs.flatMap((l, i) => {
      const candles = l.candles && l.candles.length > 0
        ? l.candles
        : synthetic?.legCandles[i] ?? []
      return candles.length > 0 ? candles.map(c => c.pnl) : [0, l.pnl]
    }),
    ...legs.flatMap(l => [
      ...(l.sl_pnl != null ? [l.sl_pnl] : []),
      ...(l.tp_pnl != null ? [l.tp_pnl] : []),
    ]),
  ]

  const minT   = allSecs.length > 0 ? Math.min(...allSecs) : 0
  const maxT   = allSecs.length > 0 ? Math.max(...allSecs) : 1
  const tRange = maxT - minT || 1

  const rawMin = Math.min(...allPnls)
  const rawMax = Math.max(...allPnls)
  const pad    = (rawMax - rawMin) * 0.10 || 50
  const minPnl = rawMin - pad
  const maxPnl = rawMax + pad
  const pRange = maxPnl - minPnl || 1

  const toX = (secs: number) =>
    SVG_PADX + ((secs - minT) / tRange) * SVG_DRAW_W
  const toY = (v: number) =>
    SVG_PADY + ((maxPnl - v) / pRange) * (SVG_H - SVG_PADY * 2)
  const zeroY = toY(0)

  // Progress vertical line — maps 0-100% to toX(minT)..toX(maxT) = PADX..PADX+DRAW_W
  const progressX = SVG_PADX + (playProgress / 100) * SVG_DRAW_W

  // ── Combined curve ────────────────────────────────────────────────────────
  const finalPnl       = combinedSrc.length > 0 ? combinedSrc[combinedSrc.length - 1].pnl : 0
  const combinedStroke = finalPnl >= 0 ? '#22DD88' : '#FF4444'
  const combinedFill   = finalPnl >= 0 ? 'rgba(34,221,136,0.07)' : 'rgba(255,68,68,0.07)'

  const combinedPts = combinedSrc.map(p => ({
    x: toX(timeToSecs(p.time)), y: toY(p.pnl), time: p.time, pnl: p.pnl,
  }))

  // ── Per-leg lines ─────────────────────────────────────────────────────────
  const legLines = legs.map((leg, i) => {
    const color       = LEG_COLORS[i % LEG_COLORS.length]
    const realCandles = leg.candles && leg.candles.length >= 2
    const synthCandles = !realCandles ? (synthetic?.legCandles[i] ?? []) : []
    const hasCandles  = !!(realCandles || synthCandles.length >= 2)
    const candleArr   = realCandles ? leg.candles! : synthCandles
    const pts = hasCandles
      ? candleArr.map(c => ({ x: toX(timeToSecs(c.time)), y: toY(c.pnl) }))
      : [
          { x: toX(timeToSecs(leg.entry_time)), y: toY(0) },
          { x: toX(timeToSecs(leg.exit_time)),  y: toY(leg.pnl) },
        ]
    const exitPt = pts[pts.length - 1]
    return {
      color, pts, hasCandles,
      label:        `${leg.symbol} ${leg.direction}`.trim(),
      pnl:          leg.pnl,
      entryX:       pts[0].x,
      exitX:        exitPt.x,
      exitY:        exitPt.y,
      slPnl:        leg.sl_pnl ?? null,
      tpPnl:        leg.tp_pnl ?? null,
      slHit:        !!leg.sl_hit,
      tpHit:        !!leg.tp_hit,
      autoSq:       !!leg.auto_sq,
      candleError:  leg.candle_error || '',
    }
  })

  const toggleLeg = (i: number) =>
    setHiddenLegs(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n })

  // ── Hover ─────────────────────────────────────────────────────────────────
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || combinedPts.length < 2) return
    const rect    = svgRef.current.getBoundingClientRect()
    const mx      = (e.clientX - rect.left) * (SVG_W / rect.width)
    const firstX  = combinedPts[0].x
    const lastX   = combinedPts[combinedPts.length - 1].x
    const clamped = Math.max(firstX, Math.min(mx, lastX))
    let seg = combinedPts.length - 2
    for (let i = 0; i < combinedPts.length - 1; i++) {
      if (clamped <= combinedPts[i + 1].x) { seg = i; break }
    }
    const a = combinedPts[seg], b = combinedPts[seg + 1]
    const t = a.x === b.x ? 0 : (clamped - a.x) / (b.x - a.x)
    setHover({
      x: clamped, y: a.y + t * (b.y - a.y),
      time: t < 0.5 ? a.time : b.time,
      pnl:  a.pnl + t * (b.pnl - a.pnl),
    })
  }

  const tooltipX = hover ? (hover.x + 130 > SVG_W ? hover.x - 130 : hover.x + 8) : 0
  const tooltipY = hover ? Math.max(4, hover.y - 30) : 0

  // ── Time axis labels ──────────────────────────────────────────────────────
  const timeLabels: { x: number; label: string }[] = []
  const STEPS = 5
  for (let i = 0; i <= STEPS; i++) {
    const s = minT + (i / STEPS) * tRange
    timeLabels.push({ x: toX(s), label: secsToHHMM(s) })
  }

  const candleErrors = legLines.filter(l => l.candleError && l.candleError !== '')

  // ── Play controls ─────────────────────────────────────────────────────────
  const startPlay = () => {
    if (playProgress >= 99.9) setPlayProgress(0)
    setIsPlaying(true)
  }
  const pausePlay = () => setIsPlaying(false)
  const resetPlay = () => { setIsPlaying(false); setPlayProgress(0) }

  // Scrubber left/right margins align with SVG drawable area
  // SVG_PADX/SVG_W and SVG_PADX_RIGHT/SVG_W as percentages
  const scrubLeftPct  = `${(SVG_PADX / SVG_W * 100).toFixed(2)}%`
  const scrubRightPct = `${(SVG_PADX_RIGHT / SVG_W * 100).toFixed(2)}%`

  return (
    <div>
      {/* ── Legend / Toggle row ── */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={() => setShowCombined(s => !s)}
          style={toggleBtnStyle(showCombined, combinedStroke)}>
          Combined{hasPreciseCurve ? ' ●' : hasCandleLegs ? ' ●' : ''}
        </button>
        {legLines.map((leg, i) => (
          <button key={i} onClick={() => toggleLeg(i)}
            style={toggleBtnStyle(!hiddenLegs.has(i), leg.color)}>
            {leg.label || `Leg ${i + 1}`}{leg.hasCandles ? ' ●' : ''}{' '}
            {leg.pnl >= 0 ? '+' : ''}₹{Math.abs(leg.pnl).toFixed(0)}
          </button>
        ))}
      </div>

      {/* Precision badge */}
      {(hasPreciseCurve || hasCandleLegs) && (
        <div style={{ fontSize: 10, color: 'rgba(232,232,248,0.3)', marginBottom: 5, fontFamily: 'var(--font-mono)' }}>
          ● 1-min candle precision
        </div>
      )}
      {!hasPreciseCurve && !hasCandleLegs && legs.length > 0 && (
        <div style={{ fontSize: 10, color: 'rgba(255,180,60,0.55)', marginBottom: 5, fontFamily: 'var(--font-mono)' }}>
          ∿ interpolated (no candle data)
        </div>
      )}

      {/* Candle fetch error warnings */}
      {candleErrors.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 7 }}>
          {candleErrors.map((leg, i) => (
            <span key={i} style={{
              fontSize: 9, fontFamily: 'var(--font-mono)',
              color: 'rgba(255,180,60,0.8)', background: 'rgba(255,180,60,0.07)',
              border: '0.5px solid rgba(255,180,60,0.25)', borderRadius: 4, padding: '2px 6px',
            }}>
              {leg.label}: {leg.candleError}
            </span>
          ))}
        </div>
      )}

      {/* ── SVG Chart ── */}
      <svg ref={svgRef}
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        width="100%"
        height={SVG_H}
        style={{ display: 'block', cursor: 'crosshair', overflow: 'visible' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHover(null)}
      >
        {/* zero line */}
        <line x1={SVG_PADX} y1={zeroY} x2={SVG_W - SVG_PADX_RIGHT} y2={zeroY}
          stroke="rgba(255,255,255,0.10)" strokeWidth={1} strokeDasharray="4 4" />

        {/* Combined area fill */}
        {showCombined && combinedPts.length >= 2 && (() => {
          const first = combinedPts[0], last = combinedPts[combinedPts.length - 1]
          const d = `M${first.x.toFixed(1)},${zeroY.toFixed(1)} ` +
            combinedPts.map(p => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') +
            ` L${last.x.toFixed(1)},${zeroY.toFixed(1)} Z`
          return <path d={d} fill={combinedFill} />
        })()}

        {/* Combined curve */}
        {showCombined && combinedPts.length >= 2 && (
          <polyline
            points={combinedPts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
            fill="none" stroke={combinedStroke} strokeWidth={2}
            strokeLinecap="round" strokeLinejoin="round"
          />
        )}

        {/* Per-leg curves + SL/TP + exit markers */}
        {legLines.map((leg, i) => {
          if (hiddenLegs.has(i)) return null
          return (
            <g key={i}>
              {leg.hasCandles ? (
                <polyline
                  points={leg.pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
                  fill="none" stroke={leg.color} strokeWidth={1.5}
                  strokeLinecap="round" strokeLinejoin="round" opacity={0.8}
                />
              ) : (
                <line
                  x1={leg.pts[0].x.toFixed(1)} y1={leg.pts[0].y.toFixed(1)}
                  x2={leg.exitX.toFixed(1)}    y2={leg.exitY.toFixed(1)}
                  stroke={leg.color} strokeWidth={1.5} strokeDasharray="5 3"
                  strokeLinecap="round" opacity={0.75}
                />
              )}

              {/* SL dashed line */}
              {leg.slPnl != null && (
                <line x1={leg.entryX} y1={toY(leg.slPnl)} x2={leg.exitX} y2={toY(leg.slPnl)}
                  stroke="#FF4444" strokeWidth={1} strokeDasharray="3 3" opacity={0.55} />
              )}
              {/* TP dashed line */}
              {leg.tpPnl != null && (
                <line x1={leg.entryX} y1={toY(leg.tpPnl)} x2={leg.exitX} y2={toY(leg.tpPnl)}
                  stroke="#22DD88" strokeWidth={1} strokeDasharray="3 3" opacity={0.55} />
              )}

              {/* Entry dot */}
              <circle cx={leg.pts[0].x} cy={leg.pts[0].y} r={3} fill={leg.color} opacity={0.8} />

              {/* Exit marker */}
              {leg.slHit  && <text x={leg.exitX} y={leg.exitY - 6} textAnchor="middle" fill="#FF4444" fontSize={12} fontFamily="monospace">✕</text>}
              {leg.tpHit  && <text x={leg.exitX} y={leg.exitY - 6} textAnchor="middle" fill="#22DD88" fontSize={12} fontFamily="monospace">✓</text>}
              {leg.autoSq && <text x={leg.exitX} y={leg.exitY - 6} textAnchor="middle" fill="#FF9500" fontSize={10} fontFamily="monospace">■</text>}
              {!leg.slHit && !leg.tpHit && !leg.autoSq && (
                <circle cx={leg.exitX} cy={leg.exitY} r={4} fill={leg.color} opacity={0.95} />
              )}
            </g>
          )
        })}

        {/* Play progress line — aligned with scrubber */}
        {playProgress > 0 && playProgress < 100 && (
          <line
            x1={progressX.toFixed(1)} y1={SVG_PADY}
            x2={progressX.toFixed(1)} y2={SVG_H - SVG_PADY}
            stroke="rgba(255,107,0,0.65)" strokeWidth={1.5} strokeDasharray="4 3"
          />
        )}

        {/* Hover crosshair */}
        {hover && showCombined && (
          <>
            <line x1={hover.x} y1={0} x2={hover.x} y2={SVG_H}
              stroke="rgba(255,255,255,0.18)" strokeWidth={1} strokeDasharray="4,4" />
            <circle cx={hover.x} cy={hover.y} r={4} fill="#FF6B00" stroke="#fff" strokeWidth={1.5} />
            <foreignObject x={tooltipX} y={tooltipY} width={128} height={50}>
              <div style={{
                background: 'rgba(10,10,11,0.92)',
                border: '0.5px solid rgba(255,107,0,0.4)',
                borderRadius: 6, padding: '4px 8px',
                fontFamily: 'var(--font-mono)', fontSize: 11,
              }}>
                <div style={{ color: 'rgba(232,232,248,0.55)' }}>{hover.time}</div>
                <div style={{ color: hover.pnl >= 0 ? '#22DD88' : '#FF4444', fontWeight: 700 }}>
                  {hover.pnl >= 0 ? '+' : ''}₹{hover.pnl.toFixed(2)}
                </div>
              </div>
            </foreignObject>
          </>
        )}

        {/* Time axis */}
        {timeLabels.map((tl, i) => (
          <text key={i} x={tl.x} y={SVG_H - 2} textAnchor="middle"
            fill="rgba(232,232,248,0.22)" fontSize={8} fontFamily="monospace">
            {tl.label}
          </text>
        ))}
      </svg>

      {/* ── Scrubber — padded to align with SVG data area ── */}
      <div style={{ paddingLeft: scrubLeftPct, paddingRight: scrubRightPct, marginTop: 4 }}>
        <input
          type="range" min={0} max={100} step={0.5}
          value={playProgress}
          onChange={e => { setIsPlaying(false); setPlayProgress(Number(e.target.value)) }}
          style={{ width: '100%', accentColor: '#FF6B00', cursor: 'pointer', display: 'block', height: 4 }}
        />
      </div>

      {/* ── Play controls ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <button onClick={resetPlay} style={ctrlBtnStyle} title="Reset">⏮</button>
        {isPlaying
          ? <button onClick={pausePlay} style={{ ...ctrlBtnStyle, color: '#FF6B00' }} title="Pause">⏸</button>
          : <button onClick={startPlay} style={{ ...ctrlBtnStyle, color: '#22DD88' }} title="Play">▶</button>
        }
        <div style={{ display: 'flex', gap: 3, marginLeft: 4 }}>
          {([1, 5, 10] as PlaySpeed[]).map(s => (
            <button key={s} onClick={() => setPlaySpeed(s)} style={{
              ...ctrlBtnStyle, fontSize: 10, padding: '2px 7px',
              background: playSpeed === s ? 'rgba(255,107,0,0.15)' : 'transparent',
              color: playSpeed === s ? '#FF6B00' : 'rgba(232,232,248,0.35)',
              border: `0.5px solid ${playSpeed === s ? 'rgba(255,107,0,0.4)' : 'rgba(255,255,255,0.08)'}`,
            }}>{s}×</button>
          ))}
        </div>
        <span style={{ marginLeft: 'auto', fontSize: 10, fontFamily: 'var(--font-mono)', color: 'rgba(232,232,248,0.28)' }}>
          {playProgress.toFixed(0)}%
        </span>
      </div>
    </div>
  )
}

// ── Style helpers ─────────────────────────────────────────────────────────────

function toggleBtnStyle(active: boolean, color: string): React.CSSProperties {
  return {
    padding: '5px 13px',
    borderRadius: 999,                                     // pill
    border: `1px solid ${active ? color : `${color}38`}`,
    background: active
      ? `linear-gradient(135deg, ${color}22 0%, ${color}0d 100%)`
      : 'rgba(255,255,255,0.04)',
    color: active ? color : 'rgba(232,232,248,0.35)',
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    fontWeight: active ? 600 : 400,
    letterSpacing: '0.3px',
    cursor: 'pointer',
    boxShadow: active ? `0 0 10px ${color}30, inset 0 1px 0 ${color}20` : 'none',
    backdropFilter: 'blur(6px)',
    transition: 'all 0.15s ease',
    whiteSpace: 'nowrap' as const,
  }
}

const ctrlBtnStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  border: '0.5px solid rgba(255,255,255,0.10)',
  borderRadius: 5, padding: '3px 9px',
  color: 'rgba(232,232,248,0.60)',
  fontSize: 14, cursor: 'pointer',
  fontFamily: 'var(--font-mono)',
}

const sectionLabel: React.CSSProperties = {
  fontSize: 10, color: 'rgba(255,255,255,0.30)', marginBottom: 6,
  fontFamily: 'Syne, sans-serif', textTransform: 'uppercase', letterSpacing: '0.6px',
}

// ── Event log row ─────────────────────────────────────────────────────────────

function EventRow({ ev, idx }: { ev: ReplayEvent; idx: number }) {
  const col    = eventColor(ev.type)
  const bg     = idx % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent'
  const pnlStr = ev.pnl_at_time !== 0 ? fmtPnl(ev.pnl_at_time) : ''
  const pnlCol = ev.pnl_at_time >= 0 ? '#22DD88' : '#FF4444'

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '68px 80px 1fr 90px',
      alignItems: 'center', gap: '8px',
      padding: '5px 12px', background: bg,
      fontFamily: 'var(--font-mono, monospace)', fontSize: '12px',
    }}>
      <span style={{ color: 'var(--text-muted, rgba(255,255,255,0.45))' }}>{ev.time}</span>
      <span style={{
        fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
        background: eventBadgeBg(ev.type), color: col,
        letterSpacing: '0.4px', textAlign: 'center',
      }}>
        {ev.type === 'AUTO_SQ' ? 'AUTO SQ' : ev.type}
      </span>
      <span style={{ color: 'rgba(232,232,248,0.80)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {ev.description}
      </span>
      <span style={{ color: pnlCol, textAlign: 'right', fontWeight: 600 }}>{pnlStr}</span>
    </div>
  )
}

// ── Summary card ──────────────────────────────────────────────────────────────

function SummaryCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="cloud-fill" style={{ padding: '10px 14px', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 10, fontFamily: 'Syne, var(--font-display, sans-serif)', color: 'var(--text-muted, rgba(255,255,255,0.4))', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
        {label}
      </span>
      <span style={{ fontSize: 15, fontFamily: 'var(--font-mono, monospace)', fontWeight: 700, color: color || 'rgba(232,232,248,0.90)' }}>
        {value}
      </span>
    </div>
  )
}

// ── Spinner ───────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '120px' }}>
      <div style={{
        width: 28, height: 28, borderRadius: '50%',
        border: '3px solid rgba(255,107,0,0.2)', borderTopColor: '#FF6B00',
        animation: 'spin 0.8s linear infinite',
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function TradeReplay({ algoId, algoName, date, onClose }: TradeReplayProps) {
  const [data, setData]       = useState<ReplayData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

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

  // Use legs from API; fall back to deriving them from events if server returns empty/none
  const effectiveLegs: LegData[] =
    data?.legs && data.legs.length > 0
      ? data.legs
      : buildLegsFromEvents(events)

  const formattedDate = new Date(date + 'T00:00:00').toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  })

  const totalPnlColor = summary && summary.total_pnl >= 0 ? '#22DD88' : '#FF4444'

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
        zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="cloud-fill" style={{
        background: 'rgba(14,14,18,0.97)', backdropFilter: 'blur(20px)',
        border: '0.5px solid rgba(255,107,0,0.3)',
        borderRadius: 16, width: 'min(880px, 95vw)',
        maxHeight: '88vh',
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header — fixed height, never scrolls away */}
        <div style={{
          padding: '16px 20px',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 11, color: 'rgba(232,232,248,0.4)', letterSpacing: 3, textTransform: 'uppercase', marginBottom: 6 }}>
                Trade Replay
              </div>
              <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 20, color: 'var(--ox-radiant)' }}>
                {algoName}
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'rgba(232,232,248,0.45)', marginTop: 3 }}>
                {formattedDate}
              </div>
            </div>
            <button onClick={onClose} style={{
              background: 'none', border: 'none',
              color: 'rgba(232,232,248,0.4)', fontSize: 20,
              cursor: 'pointer', padding: '0 4px', lineHeight: 1,
            }}>×</button>
          </div>
        </div>

        {/* Padding wrapper — 16px on all 4 sides around the inner container */}
        <div style={{
          flex: 1, minHeight: 0,
          display: 'flex', flexDirection: 'column',
          padding: '16px',
        }}>
          {/* Scroll container */}
          <div style={{
            flex: 1, minHeight: 0,
            overflowY: 'auto',
            background: 'rgba(255,255,255,0.03)',
            border: '0.5px solid rgba(255,255,255,0.08)',
            borderRadius: 12,
          }}>
          {/* Content wrapper — all padding here so top & bottom are never clipped */}
          <div style={{
            padding: '20px',
            display: 'flex', flexDirection: 'column', gap: '20px',
          }}>

          {loading && <Spinner />}

          {error && !loading && (
            <div style={{ textAlign: 'center', color: '#FF4444', padding: '32px 0', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
              {error}
            </div>
          )}

          {!loading && !error && data && (
            <>
              {/* Timeline */}
              {events.length > 0 && (
                <div>
                  <div style={sectionLabel}>Timeline</div>
                  <TimelineSVG events={events} />
                </div>
              )}

              {/* MTM Chart */}
              {(events.length >= 2 || effectiveLegs.length > 0) && (
                <div>
                  <div style={sectionLabel}>MTM Curve</div>
                  <div style={{ background: 'rgba(0,0,0,0.25)', border: '0.5px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: '10px 12px' }}>
                    <MultiLegChart
                      events={events}
                      legs={effectiveLegs}
                      mtmCurve={data.mtm_curve ?? []}
                    />
                  </div>
                </div>
              )}

              {/* Stats panel */}
              {data.stats && <StatsPanel stats={data.stats} />}

              {/* Event Log */}
              {events.length > 0 ? (
                <div>
                  <div style={sectionLabel}>Event Log</div>
                  <div style={{ maxHeight: '200px', overflowY: 'auto', background: 'rgba(0,0,0,0.20)', border: '0.5px solid rgba(255,255,255,0.06)', borderRadius: 8 }}>
                    {events.map((ev, i) => <EventRow key={i} ev={ev} idx={i} />)}
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.35)', padding: '32px 0', fontSize: 13, fontFamily: 'var(--font-mono)' }}>
                  No orders found for this algo on {fmtDate(date)}.
                </div>
              )}

              {/* Summary grid */}
              {summary && (
                <div>
                  <div style={sectionLabel}>Summary</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                    <SummaryCard label="Duration"     value={fmtDuration(summary.duration_minutes)} />
                    <SummaryCard label="Total P&L"    value={summary.total_pnl   !== 0 ? fmtPnl(summary.total_pnl)   : '—'} color={summary.total_pnl !== 0 ? totalPnlColor : undefined} />
                    <SummaryCard label="Peak P&L"     value={summary.peak_pnl    !== 0 ? fmtPnl(summary.peak_pnl)    : '—'} color={summary.peak_pnl > 0 ? '#22DD88' : undefined} />
                    <SummaryCard label="Max Drawdown" value={summary.max_drawdown !== 0 ? fmtPnl(summary.max_drawdown) : '—'} color={summary.max_drawdown < 0 ? '#FF4444' : undefined} />
                  </div>
                </div>
              )}
            </>
          )}
          </div>{/* end content wrapper */}
          </div>{/* end scroll container */}
        </div>{/* end padding wrapper */}
      </div>
    </div>
  )
}

export default TradeReplay
