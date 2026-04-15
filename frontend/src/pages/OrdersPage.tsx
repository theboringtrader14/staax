import { useStore } from '@/store'
import { useState, useEffect, useMemo } from 'react'
import { algosAPI, ordersAPI, openPositionsAPI, holidaysAPI, accountsAPI } from '@/services/api'
import { StaaxSelect } from '@/components/StaaxSelect'
import { AlgoDetailModal } from '@/components/AlgoDetailModal'
import { TradeReplay } from '@/components/TradeReplay'

const INSTRUMENT_ORDER = ['BANKNIFTY', 'NIFTY', 'SENSEX', 'MIDCAPNIFTY', 'FINNIFTY', 'OTHER']

// IST time formatters — all timestamps from backend are UTC ISO strings
const fmtIST = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

type LegStatus  = 'open' | 'closed' | 'error' | 'pending' | 'waiting'
type AlgoStatus = 'open' | 'closed' | 'error' | 'pending' | 'waiting' | 'no_trade'

interface Leg {
  id: string; parentId?: string; journeyLevel: string; status: LegStatus
  symbol: string; dir: 'BUY' | 'SELL'; lots: string; entryCondition: string
  instrumentToken?: number
  errorMessage?: string
  refPrice?: number; fillPrice?: number; fillTime?: string; ltp?: number
  slOrig?: number; slActual?: number; slType?: string; tslTrailCount?: number; target?: number
  exitPrice?: number; exitTime?: string; exitReason?: string; pnl?: number
  reentryCount?: number;
  reentryTypeUsed?: string;   // "re_entry" | "re_execute"
  wtEnabled?: boolean; wtValue?: number; wtUnit?: string; wtDirection?: string; entryReference?: number
}
interface AlgoGroup {
  algoId: string; algoName: string; account: string; mtm: number; mtmSL: number; mtmTP: number
  legs: Leg[]; inlineStatus?: string; inlineColor?: string; terminated?: boolean
  isLive?: boolean
  latest_error?: { reason: string; event_type: string; timestamp: string } | null
  gridEntryId?: string; entryType?: string; orbEndTime?: string | null
  orbHigh?: number | null
  orbLow?: number | null
}
interface WaitingLeg {
  leg_number: number; direction: string; instrument: string
  underlying: string; lots: number; strike_type?: string; wt_enabled?: boolean
}
interface WaitingAlgo {
  grid_entry_id: string; algo_id: string; algo_name: string
  account_name: string; entry_time: string | null; exit_time: string | null
  is_practix: boolean
  latest_error?: { reason: string; event_type: string; timestamp: string } | null
  legs?: WaitingLeg[]
}
interface OpenPosition {
  algo_id: string; algo_name: string; account: string
  strategy_mode: string; day_of_week: string; entry_date: string
  open_count: number; pnl: number
}

// ── Leg status chip colours ─────────────────────────────────────────────────
const STATUS_STYLE: Record<LegStatus, { color: string; bg: string }> = {
  open:    { color: '#22DD88',              bg: 'rgba(34,221,136,0.12)'  },
  closed:  { color: 'rgba(34,221,136,0.5)', bg: 'rgba(34,221,136,0.07)' },
  error:   { color: '#FF4444',              bg: 'rgba(255,68,68,0.12)'   },
  pending: { color: '#FF8C00',              bg: 'rgba(255,140,0,0.12)'   },
  waiting: { color: '#F59E0B',              bg: 'rgba(245,158,11,0.12)'  },
}

// ── Algo-level status chip ──────────────────────────────────────────────────
const ALGO_STATUS_CHIP: Record<AlgoStatus, { color: string; bg: string; label: string }> = {
  open:     { color: '#22DD88',               bg: 'rgba(34,221,136,0.12)',   label: 'OPEN'     },
  closed:   { color: 'rgba(34,221,136,0.5)',  bg: 'rgba(34,221,136,0.07)',   label: 'CLOSED'   },
  error:    { color: '#FF4444',               bg: 'rgba(255,68,68,0.12)',    label: 'ERROR'    },
  pending:  { color: '#FF8C00',               bg: 'rgba(255,140,0,0.12)',    label: 'PENDING'  },
  waiting:  { color: '#FFD700',               bg: 'rgba(255,215,0,0.12)',    label: 'WAITING'  },
  no_trade: { color: 'rgba(255,255,255,0.2)', bg: 'rgba(255,255,255,0.04)', label: 'NO TRADE' },
}

// ── Algo card left status strip ─────────────────────────────────────────────
const ALGO_STATUS_BAR: Record<AlgoStatus, { color: string; glow: string }> = {
  open:     { color: '#00FF88',               glow: 'rgba(0,255,136,0.70)'   },
  closed:   { color: 'rgba(0,255,136,0.45)',  glow: 'rgba(0,255,136,0.30)'   },
  error:    { color: '#FF2244',               glow: 'rgba(255,34,68,0.70)'   },
  pending:  { color: '#FF8C00',               glow: 'rgba(255,140,0,0.65)'   },
  waiting:  { color: '#FFE600',               glow: 'rgba(255,230,0,0.70)'   },
  no_trade: { color: 'rgba(255,255,255,0.20)', glow: 'transparent'            },
}

const COLS = ['36px','66px','174px','66px','140px','68px','76px','58px','88px','90px','82px']
const HDRS = ['#','Status','Symbol','Lots','Fill / Ref','LTP','SL (A/O)','Target','Exit','Reason','P&L']

// ── Helpers ─────────────────────────────────────────────────────────────────
function todayDay(): string {
  return new Date().toLocaleDateString('en-US', { weekday: 'short', timeZone: 'Asia/Kolkata' }).toUpperCase().slice(0, 3)
}


function getInstrumentFromGroup(group: AlgoGroup): string {
  const name = group.algoName.toUpperCase()
  for (const inst of INSTRUMENT_ORDER) {
    if (inst !== 'OTHER' && name.includes(inst)) return inst
  }
  for (const leg of (group.legs || [])) {
    const sym = (leg.symbol || '').toUpperCase()
    for (const inst of INSTRUMENT_ORDER) {
      if (inst !== 'OTHER' && sym.startsWith(inst)) return inst
    }
  }
  return 'OTHER'
}

function getAlgoStatus(group: AlgoGroup): AlgoStatus {
  if (group.terminated) return 'closed'
  const legs = group.legs || []
  if (legs.length === 0) return 'waiting'
  if (legs.some(l => l.status === 'error'))  return 'error'
  if (legs.some(l => l.status === 'open'))   return 'open'
  if (legs.some(l => l.status === 'pending')) return 'pending'
  if (legs.every(l => l.status === 'closed')) return 'closed'
  return 'no_trade'
}

function isMarketLive(): boolean {
  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const day = ist.getDay()
  if (day === 0 || day === 6) return false
  const t = ist.getHours() * 60 + ist.getMinutes()
  return t >= 9 * 60 + 15 && t <= 15 * 60 + 30
}

// ── SL format helper ─────────────────────────────────────────────────────────
function formatSL(sl_value: number | null, sl_type?: string): string {
  if (sl_value == null) return '—'
  const v = sl_value.toFixed(0)
  switch (sl_type) {
    case 'pct_instrument': return `I-${v}%`
    case 'pts_instrument': return `I-${v}pts`
    case 'pct_underlying': return `U-${v}%`
    case 'pts_underlying': return `U-${v}pts`
    default: return v
  }
}

// ── LegRow ───────────────────────────────────────────────────────────────────
function LegRow({ leg, isChild, liveLtp, hasLivePoll, livePnl, onEditExit, orbHigh, orbLow, isOrbAlgo }: {
  leg: Leg; isChild: boolean; liveLtp?: number; hasLivePoll?: boolean; livePnl?: number
  onEditExit?: (orderId: string, price: number) => void
  orbHigh?: number | null
  orbLow?: number | null
  isOrbAlgo?: boolean
}) {
  const st  = STATUS_STYLE[leg.status] ?? STATUS_STYLE['pending']
  const ltp = liveLtp ?? leg.ltp

  // W&T trigger calculation
  const isWtWaiting = !!(leg.wtEnabled && leg.status === 'waiting')
  const wtTrigger: number | null = (() => {
    if (!isWtWaiting || leg.entryReference == null || leg.wtValue == null) return null
    const ref = leg.entryReference, v = leg.wtValue
    if (leg.wtDirection === 'down') return leg.wtUnit === 'pct' ? ref * (1 - v / 100) : ref - v
    return leg.wtUnit === 'pct' ? ref * (1 + v / 100) : ref + v
  })()
  const wtTriggered = wtTrigger != null && ltp != null
    ? (leg.wtDirection === 'down' ? ltp <= wtTrigger : ltp >= wtTrigger)
    : false
  const C: React.CSSProperties = { textAlign: 'center' }
  return (
    <>
    <tr style={{ background: isChild ? 'rgba(255,107,0,0.025)' : undefined, boxShadow: leg.status === 'error' ? 'inset 3px 0 0 #FF4444' : undefined }}>
      <td style={{ paddingLeft: isChild ? '16px' : '10px', width: COLS[0] }}>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: isChild ? 600 : 400 }}>{leg.journeyLevel}</span>
        {(leg.reentryCount ?? 0) > 0 && (
          <span style={{
            display: 'inline-block',
            padding: '1px 6px',
            borderRadius: 3,
            fontSize: 9,
            fontFamily: 'var(--font-mono)',
            background: 'rgba(255,165,0,0.15)',
            color: '#ffaa00',
            border: '1px solid rgba(255,165,0,0.3)',
            marginLeft: 4,
            verticalAlign: 'middle',
          }}>
            {leg.reentryTypeUsed === 're_execute'
              ? `RE-EXECUTE ×${leg.reentryCount}`
              : `RE-ENTRY ×${leg.reentryCount}`}
          </span>
        )}
      </td>
      <td style={{ width: COLS[1], ...C }}>
        {isWtWaiting
          ? <span className="tag" style={{ color: '#F59E0B', background: 'rgba(245,158,11,0.12)', fontSize: '10px' }}>W&amp;T</span>
          : <span className="tag" style={{ color: st.color, background: st.bg, fontSize: '10px' }}>{leg.status.toUpperCase()}</span>
        }
      </td>
      <td style={{ width: COLS[2] }}>
        <div style={{ fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{leg.symbol}</div>
        <div style={{ fontSize: '10px', color: leg.dir === 'BUY' ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{leg.dir}</div>
      </td>
      <td style={{ width: COLS[3], ...C, color: 'var(--text-muted)', fontSize: '11px' }}>{leg.lots}</td>
      <td style={{ width: COLS[4], fontSize: '11px', ...C }}>
        {isWtWaiting && wtTrigger != null && leg.entryReference != null ? (
          <div style={{ fontSize: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '3px', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--text-muted)' }}>REF {leg.entryReference}</span>
            <span style={{ color: 'var(--text-dim)' }}>→</span>
            <span style={{ color: '#F59E0B', fontWeight: 600 }}>TRIG {wtTrigger.toFixed(0)}</span>
          </div>
        ) : isOrbAlgo && leg.status === 'waiting' && orbHigh && orbLow ? (
          <div style={{ fontSize: '10px', textAlign: 'center' }}>
            <div style={{ color: '#22DD88', fontWeight: 600 }}>H: {orbHigh.toFixed(0)}</div>
            <div style={{ color: '#FF4444', fontWeight: 600 }}>L: {orbLow.toFixed(0)}</div>
            <div style={{ color: 'var(--text-dim)', fontSize: '9px' }}>Range: {(orbHigh - orbLow).toFixed(0)}pts</div>
          </div>
        ) : isOrbAlgo && leg.status === 'waiting' ? (
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', textAlign: 'center' }}>ORB window...</div>
        ) : (
          <>
            {leg.fillPrice != null
              ? <div style={{ fontWeight: 600 }}>Fill: {leg.fillPrice}{leg.fillTime && <span style={{ fontWeight: 400, color: 'var(--text-dim)', marginLeft: '5px', fontSize: '10px' }}>{leg.fillTime}</span>}</div>
              : <div style={{ color: 'var(--text-dim)' }}>Fill: —</div>}
            {leg.refPrice != null && <div style={{ color: 'var(--text-muted)', fontSize: '10px' }}>Ref: {leg.refPrice} · {leg.entryCondition}</div>}
            {leg.refPrice == null && leg.entryCondition && <div style={{ color: 'var(--text-muted)', fontSize: '10px' }}>{leg.entryCondition}</div>}
            {isOrbAlgo && orbHigh && orbLow && leg.status === 'open' && (
              <div style={{ color: 'var(--text-dim)', fontSize: '9px' }}>ORB H:{orbHigh.toFixed(0)} L:{orbLow.toFixed(0)}</div>
            )}
          </>
        )}
      </td>
      <td style={{ width: COLS[5], ...C, fontWeight: 600, color: isWtWaiting
        ? (wtTrigger != null && ltp != null ? (wtTriggered ? '#22DD88' : '#06B6D4') : 'var(--text-muted)')
        : (ltp != null && leg.fillPrice != null ? (ltp > leg.fillPrice ? 'var(--green)' : 'var(--red)') : 'var(--text-muted)') }}>
        {ltp != null ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            {hasLivePoll ? (
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22DD88', flexShrink: 0, animation: 'pulse 1.5s infinite' }} />
            ) : (
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', border: '1px solid #666', flexShrink: 0 }} />
            )}
            {ltp.toFixed(2)}
          </span>
        ) : '—'}
      </td>
      <td style={{ width: COLS[6], fontSize: '11px', ...C }}>
        {(() => {
          // sl_actual is the true SL price level set by the engine (fill ± sl_value for pts,
          // fill * (1 ± sl_value/100) for pct). Always use it directly — never recompute
          // from sl_original which could be pts OR pct.
          const slPrice = leg.slActual ?? null
          const hasTSL  = leg.tslTrailCount != null && leg.tslTrailCount > 0
          if (hasTSL && slPrice != null) {
            // TSL has trailed: show original anchor → current level
            const origLevel = leg.slOrig != null ? `O:${formatSL(leg.slOrig, leg.slType)}` : ''
            return <div style={{ color: 'var(--text-muted)' }}>{origLevel} A:<span style={{ color: 'var(--amber)' }}>{formatSL(slPrice, leg.slType)}</span></div>
          }
          if (slPrice != null) return <div style={{ color: 'var(--text-muted)' }}>{formatSL(slPrice, leg.slType)}</div>
          return <>—</>
        })()}
      </td>
      <td style={{ width: COLS[7], ...C, color: 'var(--text-muted)' }}>{leg.target ?? '—'}</td>
      <td style={{ width: COLS[8], fontSize: '11px', ...C }}>
        {leg.exitPrice != null
          ? <div style={{ cursor: 'pointer' }} title="Click to correct exit price" onClick={() => leg.exitPrice != null && onEditExit && onEditExit(leg.id, leg.exitPrice)}>
              <div style={{ fontWeight: 600, borderBottom: '1px dashed var(--text-dim)' }}>{leg.exitPrice}</div>
              {leg.status === 'closed' && leg.exitTime && <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{leg.exitTime}</div>}
            </div>
          : '—'}
      </td>
      <td style={{ width: COLS[9], ...C }}>
        {leg.exitReason
          ? <span style={{ fontSize: '10px', color: leg.status === 'error' ? 'var(--red)' : 'var(--text-muted)' }}>
              {leg.exitReason === 'auto_sq' ? 'Exit Time' : leg.exitReason}
            </span>
          : <span style={{ color: 'var(--text-dim)', fontSize: '10px' }}>—</span>}
      </td>
      <td style={{ width: COLS[10], fontWeight: 700, textAlign: 'right', color: (livePnl ?? leg.pnl ?? 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
        {(() => { const p = livePnl ?? leg.pnl; return p != null && p !== 0 ? `${p >= 0 ? '+' : ''}₹${Math.abs(p).toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—' })()}
      </td>
    </tr>
    {leg.status === 'error' && leg.errorMessage && (
      <tr>
        <td colSpan={COLS.length} title={leg.errorMessage} style={{ padding: '3px 10px 5px 26px', background: 'rgba(239,68,68,0.08)', borderLeft: '2px solid #EF4444', borderBottom: '1px solid var(--bg-border)', fontSize: '10px', color: 'var(--red)', fontStyle: 'italic', cursor: 'help' }}>
          ⚠ {leg.errorMessage.length > 80 ? leg.errorMessage.slice(0, 80) + '…' : leg.errorMessage}
        </td>
      </tr>
    )}
    </>
  )
}

// ── ConfirmModal ─────────────────────────────────────────────────────────────
interface ModalProps { title: string; desc: string; confirmLabel: string; confirmColor: string; children?: React.ReactNode; onConfirm: () => void; onCancel: () => void }
function ConfirmModal({ title, desc, confirmLabel, confirmColor, children, onConfirm, onCancel }: ModalProps) {
  const isDanger = confirmColor?.includes('red') || confirmColor?.includes('ef4444')
  const isWarn   = confirmColor?.includes('amber') || confirmColor?.includes('f59e0b') || confirmColor?.includes('215,123')
  const btnVariant = isDanger ? 'btn-danger' : isWarn ? 'btn-warn' : 'btn-primary'
  return (
    <div className="modal-overlay">
      <div className="modal-box">
        <div style={{ fontWeight: 700, fontSize: '16px', marginBottom: '8px', fontFamily: 'var(--font-display)' }}>{title}</div>
        <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: 'var(--card-gap)', lineHeight: 1.5 }}>{desc}</div>
        {children}
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className={`btn ${btnVariant}`} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

function setInlineStatus(setOrders: React.Dispatch<React.SetStateAction<AlgoGroup[]>>, idx: number, msg: string, color: string, ms = 3000, persistent = false) {
  setOrders(o => o.map((g, i) => i === idx ? { ...g, inlineStatus: msg, inlineColor: color } : g))
  if (!persistent) {
    setTimeout(() => setOrders(o => o.map((g, i) => i === idx ? { ...g, inlineStatus: undefined, inlineColor: undefined } : g)), ms)
  }
}

function mapGroup(g: any): AlgoGroup {
  return {
    algoId:       g.algo_id,
    algoName:     g.algo_name || g.algo_id,
    account:      g.account || '',
    mtm:          g.mtm ?? 0,
    mtmSL:        g.mtm_sl ?? 0,
    mtmTP:        g.mtm_tp ?? 0,
    latest_error: g.latest_error ?? null,
    gridEntryId:  g.grid_entry_id || undefined,
    entryType:    g.entry_type || undefined,
    orbEndTime:   g.orb_end_time ?? null,
    orbHigh:      g.orb_high ?? null,
    orbLow:       g.orb_low  ?? null,
    legs: (g.orders || []).map((o: any): Leg => ({
      id:              o.id,
      journeyLevel:    o.journey_level || '1',
      status:          (o.status ?? 'pending') as LegStatus,
      symbol:          o.symbol || '',
      dir:             ((o.direction || 'buy').toUpperCase()) as 'BUY' | 'SELL',
      lots:            String(o.lots ?? ''),
      entryCondition:  o.entry_type || '',
      instrumentToken: o.instrument_token ?? undefined,
      errorMessage:    o.error_message ?? undefined,
      fillPrice:       o.fill_price ?? undefined,
      fillTime:        o.fill_time ? fmtIST(o.fill_time) : undefined,
      ltp:             o.ltp ?? undefined,
      slOrig:          o.sl_original ?? undefined,
      slActual:        o.sl_actual ?? undefined,
      slType:          o.sl_type ?? undefined,
      tslTrailCount:   o.tsl_trail_count ?? undefined,
      target:          o.target ?? undefined,
      exitPrice:       o.exit_price ?? undefined,
      exitTime:        o.exit_time ? fmtIST(o.exit_time) : undefined,
      exitReason:      o.exit_reason ?? undefined,
      pnl:             o.pnl ?? undefined,
      reentryCount:    o.reentry_count ?? 0,
      reentryTypeUsed: o.reentry_type_used ?? undefined,
      wtEnabled:       o.wt_enabled ?? undefined,
      wtValue:         o.wt_value ?? undefined,
      wtUnit:          o.wt_unit ?? undefined,
      wtDirection:     o.wt_direction ?? undefined,
      entryReference:  o.entry_reference ?? undefined,
    })),
  }
}

const STRATEGY_LABEL: Record<string, { label: string; color: string }> = {
  intraday:   { label: 'Intraday',   color: '#5A5A61' },
  btst:       { label: 'BTST',       color: '#FF6B00' },
  stbt:       { label: 'STBT',       color: '#CC4400' },
  positional: { label: 'Positional', color: '#F59E0B' },
}

// ── SmoothedSparkline ─────────────────────────────────────────────────────────
function SmoothedSparkline({ algoId, legs, totalPnl }: { algoId: string; legs: Leg[]; totalPnl: number }) {
  const W = 70, H = 24, PAD = 3
  const live = isMarketLive()

  const closedLegs = legs.filter(l => l.status === 'closed' && l.pnl != null)
  if (closedLegs.length === 0) return null
  // Cumulative P&L series: [0, pnl_after_leg1, pnl_after_leg1+leg2, ...]
  let cum = 0
  const pts = [0, ...closedLegs.map(l => { cum += (l.pnl ?? 0); return cum })]
  if (pts.length < 2) return null

  const minP = Math.min(...pts), maxP = Math.max(...pts)
  const range = maxP - minP || 1
  const toX = (i: number) => PAD + (i / (pts.length - 1)) * (W - PAD * 2)
  const toY = (v: number) => H - PAD - ((v - minP) / range) * (H - PAD * 2)
  const coords = pts.map((v, i) => ({ x: toX(i), y: toY(v) }))

  // Cubic bezier — control points at horizontal midpoint of each segment
  let d = `M${coords[0].x.toFixed(1)},${coords[0].y.toFixed(1)}`
  for (let i = 1; i < coords.length; i++) {
    const p = coords[i - 1], c = coords[i]
    const mx = ((p.x + c.x) / 2).toFixed(1)
    d += ` C${mx},${p.y.toFixed(1)} ${mx},${c.y.toFixed(1)} ${c.x.toFixed(1)},${c.y.toFixed(1)}`
  }

  const lastX = coords[coords.length - 1].x
  const lastY = coords[coords.length - 1].y
  const lineColor = totalPnl >= 0 ? '#22DD88' : '#FF4444'
  const gradId = `sg-${algoId.replace(/[^a-z0-9]/gi, '')}`
  const fillD = `${d} L${lastX.toFixed(1)},${H} L${PAD},${H} Z`

  return (
    <svg width={W} height={H} style={{ flexShrink: 0, opacity: 0.9 }}>
      <title>{`P&L: ${totalPnl >= 0 ? '+' : ''}₹${Math.abs(Math.round(totalPnl)).toLocaleString('en-IN')}`}</title>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lineColor} stopOpacity="0.20"/>
          <stop offset="100%" stopColor={lineColor} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <path d={fillD} fill={`url(#${gradId})`} stroke="none"/>
      <path d={d} fill="none" stroke={lineColor} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/>
      {live ? (
        <circle cx={lastX.toFixed(1)} cy={lastY.toFixed(1)} r={3} fill={lineColor}>
          <animate attributeName="r" values="3;5;3" dur="2s" repeatCount="indefinite"/>
          <animate attributeName="opacity" values="1;0.3;1" dur="2s" repeatCount="indefinite"/>
        </circle>
      ) : (
        <circle cx={lastX.toFixed(1)} cy={lastY.toFixed(1)} r="2.5" fill={lineColor}/>
      )}
    </svg>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────
export default function OrdersPage() {
  const isPractixMode = useStore(s => s.isPractixMode)
  const activeAccount = useStore(s => s.activeAccount)
  const storeAccounts = useStore(s => s.accounts)

  const [weekOffset, setWeekOffset] = useState(0)  // 0 = current week, -1 = last week, etc.

  const weekDates = useMemo(() => {
    const now = new Date()
    const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
    const dow = ist.getDay()
    const daysToMon = dow === 0 ? 6 : dow - 1
    const mon = new Date(ist)
    mon.setDate(ist.getDate() - daysToMon + weekOffset * 7)
    const names = ['MON','TUE','WED','THU','FRI','SAT','SUN']
    const map: Record<string, string> = {}
    for (let i = 0; i < 7; i++) {
      const d = new Date(mon); d.setDate(mon.getDate() + i)
      map[names[i]] = d.toISOString().slice(0, 10)
    }
    return map
  }, [weekOffset])

  const today     = todayDay()
  const todayDate = weekDates[today] || new Date().toISOString().slice(0, 10)

  const LS_DAY_KEY = 'staax_orders_day'
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    try {
      const stored = localStorage.getItem('staax_orders_day')
      if (stored && Object.values(weekDates).includes(stored)) return stored
    } catch {}
    return todayDate
  })
  const [orders, setOrders]             = useState<AlgoGroup[]>([])
  const [waitingAlgos, setWaitingAlgos] = useState<WaitingAlgo[]>([])
  const [ltpMap, setLtpMap]             = useState<Record<number, number>>({})
  const [modal, setModal]               = useState<{ type: 'sq' | 't'; algoIdx: number } | null>(null)
  const [sqChecked, setSqChecked]       = useState<Record<string, boolean>>({})
  const [sqResults, setSqResults]       = useState<{ squared_off: {order_id: string; exit_price?: number}[]; failed: {order_id: string; error: string}[] } | null>(null)
  const [sqError, setSqError]           = useState<string | null>(null)
  const [loading, setLoading]           = useState<Record<string, boolean>>({})
  const [showSync, setShowSync]         = useState<number | null>(null)
  const [syncForm, setSyncForm]         = useState({ broker_order_id: '', account_id: '' })
  const [syncLoading, setSyncLoading]   = useState(false)
  const [editExit, setEditExit]         = useState<{ orderId: string; value: string } | null>(null)
  const [exitSaving, setExitSaving]     = useState(false)
  const [selectedAlgoName, setSelectedAlgoName] = useState<string | null>(null)
  const [openPositions, setOpenPositions] = useState<OpenPosition[]>([])
  const [holidayDates, setHolidayDates] = useState<Set<string>>(new Set())
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [weekPnl, setWeekPnl] = useState<Record<string, number | null>>({})
  const [showWeekends, setShowWeekends] = useState(false)
  const [accountFilter, setAccountFilter] = useState<string>('all')
  const [fetchedAccounts, setFetchedAccounts] = useState<{ id: number; nickname: string }[]>([])
  const [hoveredCard, setHoveredCard] = useState<string | null>(null)
  const [replayAlgo, setReplayAlgo]   = useState<{ id: string; name: string; date: string } | null>(null)
  const [ltpData, setLtpData]         = useState<Record<string, { ltp: number; pnl: number; fill_price: number }>>({})
  const [ordersLoaded, setOrdersLoaded] = useState(false)
  const [waitingRetryLoading, setWaitingRetryLoading] = useState<Record<string, boolean>>({})
  const [retryModal, setRetryModal] = useState<{ algoIdx: number; legs: Leg[] } | null>(null)
  const [retryChecked, setRetryChecked] = useState<Record<string, boolean>>({})
  const [positionCheck, setPositionCheck] = useState<{ total_open: number; reconciled: boolean } | null>(null)

  const weekLabel = useMemo(() => {
    const monDate = weekDates['MON']
    if (!monDate) return ''
    const d = new Date(monDate)
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
  }, [weekDates])

  // When navigating weeks, default to Monday of that week (or today if current week)
  useEffect(() => {
    if (weekOffset === 0) {
      setSelectedDate(todayDate)
    } else {
      setSelectedDate(weekDates['MON'] || todayDate)
    }
  }, [weekOffset]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch accounts list on mount
  useEffect(() => {
    accountsAPI.list()
      .then(res => {
        const list: any[] = res.data?.accounts || res.data || []
        setFetchedAccounts(list.filter((a: any) => a.nickname).map((a: any) => ({ id: a.id, nickname: a.nickname })))
      })
      .catch(() => {})
  }, [])

  // Fetch open positions + holidays once on mount
  useEffect(() => {
    openPositionsAPI.list(isPractixMode)
      .then(res => setOpenPositions(res.data?.open_positions || []))
      .catch(() => {})
    holidaysAPI.list().then(res => {
      const dates = new Set<string>((res.data || []).map((h: any) => h.date as string))
      setHolidayDates(dates)
    }).catch(() => {})
  }, [isPractixMode])

  // Fetch position reconciliation check on mount
  useEffect(() => {
    ordersAPI.positionCheck(isPractixMode)
      .then(res => setPositionCheck(res.data))
      .catch(() => {})
  }, [isPractixMode])

  // Pre-fetch all week P&L on mount
  useEffect(() => {
    const days = ['MON','TUE','WED','THU','FRI']
    Promise.all(days.map(day =>
      ordersAPI.list(weekDates[day], isPractixMode)
        .then((res: any) => {
          const groups: any[] = res.data?.groups || []
          const hasOrders = groups.some((g: any) => (g.orders || []).length > 0)
          const pnl = groups.reduce((s: number, g: any) => s + (g.mtm ?? 0), 0)
          return { day, pnl: hasOrders ? pnl : null }
        })
        .catch(() => ({ day, pnl: null as null }))
    )).then(results => {
      const map: Record<string, number | null> = {}
      results.forEach(r => { map[r.day] = r.pnl })
      setWeekPnl(map)
    })
  }, [isPractixMode, weekOffset]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load orders + waiting algos for selectedDate
  useEffect(() => {
    setOrders([])
    setOrdersLoaded(false)
    setWaitingAlgos([])
    ordersAPI.list(selectedDate, isPractixMode)
      .then(res => {
        const data = res.data
        const raw: any[] = Array.isArray(data) ? [] : (data?.groups || [])
        setOrders(raw.map(mapGroup))
        setOrdersLoaded(true)
        // Seed weekPnl for this day from loaded data (updated again once ltpData arrives)
        const dayKey = Object.entries(weekDates).find(([, d]) => d === selectedDate)?.[0]
        if (dayKey) {
          const hasOrders = raw.some((g: any) => (g.orders || []).length > 0)
          const pnl = raw.reduce((s: number, g: any) => s + (g.mtm ?? 0), 0)
          setWeekPnl(prev => ({ ...prev, [dayKey]: hasOrders ? pnl : null }))
        }
      })
      .catch(() => {})

    ordersAPI.waiting(selectedDate, isPractixMode)
      .then(res => setWaitingAlgos(res.data?.waiting || []))
      .catch(() => {})
  }, [selectedDate, isPractixMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // Live LTP via WebSocket
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const WS_BASE = ((import.meta as any).env?.VITE_API_URL || 'http://localhost:8000').replace('http', 'ws')
    let ws: WebSocket | null = null
    let retryTimeout: ReturnType<typeof setTimeout> | null = null
    let retryDelay = 2000
    const connect = () => {
      try {
        ws = new WebSocket(`${WS_BASE}/ws/pnl`)
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data)
            if (msg.type === 'ltp_batch') setLtpMap(prev => ({ ...prev, ...msg.data }))
          } catch {}
        }
        ws.onclose = () => { retryTimeout = setTimeout(connect, retryDelay); retryDelay = Math.min(retryDelay * 1.5, 15000) }
        ws.onerror = () => ws?.close()
      } catch { retryTimeout = setTimeout(connect, retryDelay) }
    }
    connect()
    return () => { if (retryTimeout) clearTimeout(retryTimeout); ws?.close() }
  }, [])

  // Live LTP polling every 3 seconds when open orders exist
  useEffect(() => {
    const hasOpenOrders = orders.some(g => g.legs.some(l => l.status === 'open'))
    if (!hasOpenOrders) return
    const poll = () => {
      ordersAPI.ltp()
        .then(res => { if (res.data?.ltp) setLtpData(res.data.ltp) })
        .catch(() => {})
    }
    poll()
    const interval = setInterval(poll, 1000)
    return () => clearInterval(interval)
  }, [orders])

  // Seed LTP data immediately on mount — prevents ₹0 flash before first poll fires
  useEffect(() => {
    ordersAPI.ltp()
      .then(res => { if (res.data?.ltp) setLtpData(res.data.ltp) })
      .catch(() => {})
  }, [])

  // Persist selected day tab across page refreshes
  useEffect(() => {
    try { localStorage.setItem(LS_DAY_KEY, selectedDate) } catch {}
  }, [selectedDate])

  const safeOrders = Array.isArray(orders) ? orders : []
  const totalMTM   = safeOrders.filter(g => !g.terminated).reduce((s, g) => s + g.mtm, 0)

  // Live MTM strip — computed from polling data
  const ltpDataEntries = Object.values(ltpData)
  const hasLiveData    = ltpDataEntries.length > 0
  const liveTotalMtm   = hasLiveData
    ? ltpDataEntries.reduce((sum, e) => sum + (e?.pnl ?? 0), 0)
    : 0

  // Keep selected day's weekPnl current as live ltpData arrives
  useEffect(() => {
    if (!ordersLoaded) return
    const dayKey = Object.entries(weekDates).find(([, d]) => d === selectedDate)?.[0]
    if (!dayKey) return
    const closedPnl = safeOrders.reduce((s, g) => {
      const closed = g.legs.filter(l => l.status === 'closed' && l.pnl != null)
      return s + closed.reduce((cs, l) => cs + (l.pnl ?? 0), 0)
    }, 0)
    const openPnl = hasLiveData ? liveTotalMtm : safeOrders.reduce((s, g) => {
      const open = g.legs.filter(l => l.status === 'open')
      return s + (open.length > 0 ? g.mtm : 0)
    }, 0)
    const hasOrders = safeOrders.some(g => g.legs.length > 0)
    setWeekPnl(prev => ({ ...prev, [dayKey]: hasOrders ? closedPnl + openPnl : null }))
  }, [ltpData, ordersLoaded]) // eslint-disable-line react-hooks/exhaustive-deps

  const buildRows = (legs: Leg[]) => {
    const r: { leg: Leg; isChild: boolean }[] = []
    for (const p of (legs || []).filter(l => !l.parentId)) {
      r.push({ leg: p, isChild: false })
      for (const c of (legs || []).filter(l => l.parentId === p.id)) r.push({ leg: c, isChild: true })
    }
    return r
  }

  const openLegs = (idx: number) => (orders[idx]?.legs || []).filter(l => l.status === 'open')

  // ── Actions ──────────────────────────────────────────────────────────────
  const doRE = async (idx: number) => {
    const algoId = orders[idx].algoId
    setLoading(l => ({ ...l, [`re-${idx}`]: true }))
    setInlineStatus(setOrders, idx, '↻ Retrying...', 'var(--accent-amber)')
    try {
      const res  = await algosAPI.re(algoId)
      const data = res.data as { retried: number; skipped_duplicate: number; max_retries_reached: number }
      if (data.retried === 0 && data.skipped_duplicate > 0) {
        setInlineStatus(setOrders, idx, '⚠️ Position already open at broker', 'var(--amber)')
      } else if (data.retried === 0 && data.max_retries_reached > 0) {
        setInlineStatus(setOrders, idx, '⛔ Max retries reached', 'var(--red)')
      } else {
        setInlineStatus(setOrders, idx, `↻ Retrying ${data.retried} leg${data.retried !== 1 ? 's' : ''}`, 'var(--green)')
      }
    } catch {
      setInlineStatus(setOrders, idx, '⚠️ Retry failed', 'var(--red)', 0, true)
    } finally {
      setLoading(l => ({ ...l, [`re-${idx}`]: false }))
    }
  }

  const doRetry = async (idx: number) => {
    const gridEntryId = orders[idx]?.gridEntryId
    if (!gridEntryId) return
    setLoading(l => ({ ...l, [`retry-${idx}`]: true }))
    setInlineStatus(setOrders, idx, '↻ Running...', 'var(--accent-amber)', 30000)
    try {
      await ordersAPI.retryEntry(gridEntryId)
      // Wait for backend to process before refreshing
      await new Promise(r => setTimeout(r, 800))
      setInlineStatus(setOrders, idx, '✅ Done', 'var(--green)', 3000)
      ordersAPI.list(selectedDate, isPractixMode)
        .then(r => {
          const raw: any[] = Array.isArray(r.data) ? [] : (r.data?.groups || [])
          setOrders(raw.map(mapGroup))
        })
        .catch(() => {})
      ordersAPI.waiting(selectedDate, isPractixMode)
        .then(res => setWaitingAlgos(res.data?.waiting || []))
        .catch(() => {})
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err?.message || 'RE-RUN failed'
      setInlineStatus(setOrders, idx, `⚠️ ${msg}`, 'var(--red)', 0, true)
    } finally {
      setLoading(l => ({ ...l, [`retry-${idx}`]: false }))
    }
  }

  const doSQ = async (idx: number) => {
    const algoId   = orders[idx].algoId
    const selected = Object.keys(sqChecked).filter(k => sqChecked[k])
    if (selected.length === 0) { setModal(null); return }
    setLoading(l => ({ ...l, [`sq-${idx}`]: true }))
    setInlineStatus(setOrders, idx, '↻ Running...', 'var(--accent-amber)', 30000)
    setSqResults(null)
    setSqError(null)
    try {
      const res = await algosAPI.sq(algoId, selected)
      const data = res.data as { squared_off: {order_id: string; exit_price?: number}[]; failed: {order_id: string; error: string}[]; algo_state?: string }
      setSqResults({ squared_off: data.squared_off || [], failed: data.failed || [] })

      // Refetch orders from server so UI reflects real DB state
      ordersAPI.list(selectedDate, isPractixMode)
        .then(r => {
          const raw: any[] = Array.isArray(r.data) ? [] : (r.data?.groups || [])
          setOrders(raw.map(mapGroup))
        })
        .catch(() => {})

      const nOk   = (data.squared_off || []).length
      const nFail = (data.failed || []).length
      if (nFail === 0) {
        setInlineStatus(setOrders, idx, `✅ ${nOk} leg${nOk !== 1 ? 's' : ''} squared off`, 'var(--green)')
        setSqChecked({})
        setModal(null)
      } else {
        // Keep modal open to show per-leg results
        setInlineStatus(setOrders, idx, `⚠️ ${nOk} squared off, ${nFail} failed`, 'var(--amber)')
      }
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err?.message || 'SQ failed'
      setSqError(msg)
      setInlineStatus(setOrders, idx, '⚠️ SQ failed', 'var(--red)', 0, true)
    } finally {
      setLoading(l => ({ ...l, [`sq-${idx}`]: false }))
    }
  }

  const doTerminate = async (idx: number) => {
    const algoId = orders[idx].algoId
    setLoading(l => ({ ...l, [`t-${idx}`]: true }))
    setInlineStatus(setOrders, idx, '↻ Running...', 'var(--accent-amber)', 30000)
    try {
      const res = await algosAPI.terminate(algoId)
      const data = res.data as {
        status: string
        squared_off: string[]
        failed: { order_id: string; error: string }[]
      }

      // Trigger a full orders refetch — do NOT do optimistic update
      ordersAPI.list(selectedDate, isPractixMode)
        .then(r => {
          const raw: any[] = Array.isArray(r.data) ? [] : (r.data?.groups || [])
          setOrders(raw.map(mapGroup))
        })
        .catch(() => {})

      const nFailed = (data.failed || []).length
      if (nFailed > 0) {
        setInlineStatus(setOrders, idx, `⛔ Terminated — ${nFailed} order${nFailed !== 1 ? 's' : ''} may still be open at broker`, 'var(--amber)', 8000)
      } else {
        setInlineStatus(setOrders, idx, '⛔ Algo terminated', 'var(--red)', 5000)
      }
      setModal(null)
    } catch (err: any) {
      // Backend error — do NOT mark algo as terminated locally
      const msg = err?.response?.data?.detail || err?.message || 'Terminate failed'
      setInlineStatus(setOrders, idx, `⚠️ ${msg}`, 'var(--red)', 0, true)
    } finally {
      setLoading(l => ({ ...l, [`t-${idx}`]: false }))
    }
  }

  const doConfirm = () => {
    if (!modal) return
    const { type, algoIdx } = modal
    if (type === 'sq')  doSQ(algoIdx)
    if (type === 't')   doTerminate(algoIdx)
  }

  const getModalContent = () => {
    if (!modal) return null
    const { type, algoIdx } = modal
    const name = orders[algoIdx].algoName
    if (type === 't')   return { title: `Terminate ${name}?`, desc: `Square off ALL open positions, cancel pending + SL orders at broker, and terminate ${name}. Cannot be undone.`, confirmLabel: 'Terminate', confirmColor: 'var(--red)', children: undefined }
    if (type === 'sq')  return {
      title: `Square Off — ${name}`, desc: sqResults ? 'SQ result:' : 'Select open legs to square off:',
      confirmLabel: 'Square Off', confirmColor: '#22C55E',
      children: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {sqError && (
            <div style={{ color: 'var(--red)', fontSize: '12px', padding: '8px', background: 'rgba(255,0,0,0.08)', borderRadius: '5px' }}>
              {sqError}
            </div>
          )}
          {sqResults ? (
            <>
              {sqResults.squared_off.map(r => (
                <div key={r.order_id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', background: 'var(--bg-secondary)', borderRadius: '5px', fontSize: '12px' }}>
                  <span style={{ color: 'var(--green)' }}>✅</span>
                  <span style={{ fontFamily: 'monospace', opacity: 0.7 }}>{r.order_id.slice(-8)}</span>
                  {r.exit_price != null && <span style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>exit: {r.exit_price}</span>}
                </div>
              ))}
              {sqResults.failed.map(r => (
                <div key={r.order_id} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '6px 12px', background: 'rgba(255,0,0,0.08)', borderRadius: '5px', fontSize: '12px' }}>
                  <span style={{ color: 'var(--red)' }}>❌</span>
                  <div>
                    <div style={{ fontFamily: 'monospace', opacity: 0.7 }}>{r.order_id.slice(-8)}</div>
                    <div style={{ color: 'var(--red)', marginTop: '2px' }}>{r.error}</div>
                  </div>
                </div>
              ))}
            </>
          ) : (
            openLegs(algoIdx).map(leg => (
              <label key={leg.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: '5px', cursor: 'pointer' }}>
                <input type="checkbox" checked={!!sqChecked[leg.id]}
                  onChange={e => setSqChecked(s => ({ ...s, [leg.id]: e.target.checked }))}
                  style={{ accentColor: 'var(--green)', width: '15px', height: '15px' }} />
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 600 }}>{leg.symbol}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '1px' }}>{leg.dir} · {leg.lots} · Fill: {leg.fillPrice} · LTP: {leg.ltp}</div>
                </div>
              </label>
            ))
          )}
        </div>
      )
    }
    return null
  }

  const doSync = async (algoIdx: number) => {
    const algoId = orders[algoIdx].algoId
    if (!syncForm.broker_order_id.trim()) { alert('Broker Order ID is required'); return }
    if (!syncForm.account_id) { alert('Please select an account'); return }
    const ids = syncForm.broker_order_id.split(',').map(s => s.trim()).filter(Boolean)
    setSyncLoading(true)
    let succeeded = 0, failed = 0
    for (const id of ids) {
      try { await ordersAPI.syncOrder(algoId, { broker_order_id: id, account_id: syncForm.account_id }); succeeded++ }
      catch { failed++ }
    }
    setSyncLoading(false)
    setShowSync(null)
    setSyncForm({ broker_order_id: '', account_id: '' })
    const msg = failed === 0 ? `✅ ${succeeded} order${succeeded > 1 ? 's' : ''} synced` : `⚠️ ${succeeded} synced, ${failed} failed`
    setInlineStatus(setOrders, algoIdx, msg, failed === 0 ? 'var(--green)' : 'var(--amber)', 5000)
  }

  const doCorrectExit = async () => {
    if (!editExit) return
    const price = parseFloat(editExit.value)
    if (isNaN(price) || price <= 0) return
    setExitSaving(true)
    try { await ordersAPI.correctExitPrice(editExit.orderId, price); setEditExit(null) }
    catch { alert('Failed to save exit price') }
    finally { setExitSaving(false) }
  }

  // ── Filtering + grouping ─────────────────────────────────────────────────
  const activeAccountNickname = activeAccount
    ? (storeAccounts as any[]).find((a: any) => String(a.id) === activeAccount)?.nickname ?? null
    : null
  const filteredOrders  = activeAccountNickname ? orders.filter(g => g.account === activeAccountNickname) : orders
  const filteredWaiting = activeAccountNickname ? waitingAlgos.filter(w => w.account_name === activeAccountNickname) : waitingAlgos

  const localFilteredOrders  = accountFilter === 'all' ? filteredOrders  : filteredOrders.filter(g => g.account === accountFilter)
  const localFilteredWaiting = accountFilter === 'all' ? filteredWaiting : filteredWaiting.filter(w => w.account_name === accountFilter)

  const groupedByInstrument: Record<string, AlgoGroup[]> = {}
  for (const group of localFilteredOrders) {
    const inst = getInstrumentFromGroup(group)
    if (!groupedByInstrument[inst]) groupedByInstrument[inst] = []
    groupedByInstrument[inst].push(group)
  }
  for (const inst of INSTRUMENT_ORDER) {
    groupedByInstrument[inst]?.sort((a, b) => a.algoName.localeCompare(b.algoName))
  }
  const instrumentKeys = INSTRUMENT_ORDER.filter(k => groupedByInstrument[k]?.length > 0)

  // Day summary from filteredOrders (retained for potential future use)
  const closedLegsAll = filteredOrders.flatMap(g => g.legs.filter(l => l.status === 'closed' && l.pnl != null))
  const dayWins       = closedLegsAll.filter(l => (l.pnl ?? 0) > 0).length
  void dayWins

  const isHolidayToday  = holidayDates.has(selectedDate)

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 92px)' }}>

      {/* ── Fixed zone ── */}
      <div style={{ flexShrink: 0 }}>

        {/* Page header */}
        <div className="page-header">
          <div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '22px', fontWeight: 800, color: 'var(--ox-radiant)' }}>Orders</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '3px', justifyContent: 'space-between', flexWrap: 'wrap' as const }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '12px', color: 'var(--gs-muted)' }}>Trade history · P&amp;L by week</span>
                <span className={'chip ' + (isPractixMode ? 'chip-warn' : 'chip-success')} style={{ fontSize: '10px', padding: '1px 8px' }}>
                  {isPractixMode ? 'PRACTIX' : 'LIVE'}
                </span>
                {positionCheck !== null && (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                    fontSize: '10px', padding: '2px 8px', borderRadius: '999px',
                    fontFamily: 'var(--font-mono)', fontWeight: 600, lineHeight: 1.4,
                    color:      positionCheck.reconciled ? '#22DD88' : '#F59E0B',
                    background: positionCheck.reconciled ? 'rgba(34,221,136,0.12)' : 'rgba(245,158,11,0.12)',
                    border:     `1px solid ${positionCheck.reconciled ? 'rgba(34,221,136,0.25)' : 'rgba(245,158,11,0.25)'}`,
                  }}>
                    {positionCheck.reconciled ? '✓ Synced' : `⚠ ${positionCheck.total_open} open`}
                  </span>
                )}
              </div>
              {/* Week navigation */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
                <button
                  onClick={() => setWeekOffset(o => o - 1)}
                  style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', padding: '2px 6px', fontSize: '14px', lineHeight: 1 }}
                  title="Previous week"
                >‹</button>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', minWidth: '110px', textAlign: 'center' as const }}>
                  Week of {weekLabel}
                </span>
                <button
                  onClick={() => setWeekOffset(o => Math.min(0, o + 1))}
                  disabled={weekOffset === 0}
                  style={{ background: 'none', border: 'none', color: weekOffset === 0 ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.4)', cursor: weekOffset === 0 ? 'default' : 'pointer', padding: '2px 6px', fontSize: '14px', lineHeight: 1 }}
                  title="Next week"
                >›</button>
              </div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                MTM: <b style={{ color: (!ordersLoaded && !hasLiveData) ? 'var(--text-muted)' : (hasLiveData ? liveTotalMtm : totalMTM) >= 0 ? '#22DD88' : '#FF4444' }}>
                  {(!ordersLoaded && !hasLiveData) ? '—' : `${(hasLiveData ? liveTotalMtm : totalMTM) >= 0 ? '+' : ''}₹${(hasLiveData ? liveTotalMtm : totalMTM).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`}
                </b>
                {hasLiveData && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22DD88', display: 'inline-block', animation: 'pulse 1.5s infinite', flexShrink: 0 }} />}
              </span>
            </div>
          </div>
          <div className="page-header-actions">
            <StaaxSelect
              value={accountFilter}
              onChange={setAccountFilter}
              options={[
                { value: 'all', label: 'All Accounts' },
                ...fetchedAccounts.map(a => ({ value: a.nickname, label: a.nickname })),
              ]}
              width="130px"
            />
          </div>
        </div>

        {/* Open Positions Panel */}
        {openPositions.length > 0 && (
          <div style={{ padding: '0 0 16px' }}>
            <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px', paddingLeft: '2px' }}>
              Open Positions · {openPositions.length}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {openPositions.map(pos => {
                const strat    = STRATEGY_LABEL[pos.strategy_mode] || { label: pos.strategy_mode, color: '#6B7280' }
                const pnlColor = pos.pnl >= 0 ? 'var(--green)' : 'var(--red)'
                return (
                  <div key={pos.algo_id} style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    background: 'var(--glass-bg)', border: 'var(--glass-border)',
                    borderRadius: '8px', padding: '6px 12px', cursor: 'default',
                    backdropFilter: 'blur(12px)', minWidth: 0,
                  }}>
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{pos.entry_date}</span>
                    <span style={{ fontSize: '9px', fontWeight: 700, padding: '1px 6px', borderRadius: '100px', background: `${strat.color}18`, color: strat.color, border: `1px solid ${strat.color}40`, whiteSpace: 'nowrap' }}>{strat.label}</span>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap' }}>{pos.algo_name}</span>
                    <span style={{ fontSize: '10px', color: 'var(--text-dim)', background: 'var(--bg-surface)', padding: '1px 6px', borderRadius: '100px', border: '1px solid var(--bg-border)', whiteSpace: 'nowrap' }}>{pos.account}</span>
                    {pos.open_count > 0 && <span style={{ fontSize: '10px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{pos.open_count} open</span>}
                    {pos.pnl !== 0 && <span style={{ fontSize: '11px', fontWeight: 700, color: pnlColor, whiteSpace: 'nowrap' }}>{pos.pnl >= 0 ? '+' : ''}₹{Math.abs(pos.pnl).toLocaleString('en-IN')}</span>}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Date navigation + MTM summary bar */}
        <div style={{ borderBottom: '0.5px solid var(--ox-border)' }}>
          {/* Day tabs — full width */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0' }}>
            <div style={{ display: 'flex', flex: 1 }}>
              {(showWeekends ? ['MON','TUE','WED','THU','FRI','SAT','SUN'] : ['MON','TUE','WED','THU','FRI']).map(day => {
                const date      = weekDates[day]
                const isActive  = selectedDate === date
                const isHoliday = date ? holidayDates.has(date) : false
                const pnl       = weekPnl[day]
                const rupee     = '\u20B9'
                return (
                  <button
                    key={day}
                    onClick={() => date && setSelectedDate(date)}
                    style={{
                      flex: 1, padding: '12px 0', textAlign: 'center' as const,
                      background: isActive ? 'rgba(255,107,0,0.08)' : 'transparent',
                      border: 'none',
                      borderBottom: isActive ? '2px solid #FF6B00' : '2px solid transparent',
                      color: isActive ? '#FF6B00' : 'rgba(255,255,255,0.4)',
                      fontFamily: 'var(--font-display)', fontSize: '12px', fontWeight: 600,
                      cursor: 'pointer', transition: 'all 0.15s ease',
                      display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: '3px',
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      {day}{isHoliday && <span style={{ fontSize: '9px' }}>🏛</span>}
                    </span>
                    {isHoliday ? (
                      <span style={{ fontSize: '10px', color: 'var(--accent-amber)', fontWeight: 500 }}>Holiday</span>
                    ) : pnl != null ? (
                      <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
                        {pnl >= 0 ? '+' : ''}{rupee}{Math.abs(Math.round(pnl)).toLocaleString('en-IN')}
                      </span>
                    ) : (
                      <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.2)' }}>—</span>
                    )}
                  </button>
                )
              })}
            </div>
            <div
              onClick={() => setShowWeekends(!showWeekends)}
              style={{
                padding: '4px 12px', borderRadius: 20, cursor: 'pointer',
                fontSize: 11, fontFamily: 'var(--font-display)',
                background: showWeekends ? 'rgba(255,107,0,0.15)' : 'transparent',
                border: showWeekends ? '0.5px solid rgba(255,107,0,0.5)' : '0.5px solid rgba(255,255,255,0.15)',
                color: showWeekends ? '#FF6B00' : 'rgba(255,255,255,0.4)',
                whiteSpace: 'nowrap' as const, userSelect: 'none' as const,
                transition: 'all 0.15s ease',
              }}
            >Weekends</div>
          </div>
        </div>

        {/* Stats banner */}
        <div style={{
          display: 'flex', gap: 32, padding: '10px 24px',
          background: 'rgba(255,107,0,0.04)',
          borderBottom: '0.5px solid rgba(255,107,0,0.10)',
          borderTop: '0.5px solid rgba(255,107,0,0.10)',
          fontFamily: 'var(--font-mono)', fontSize: 12, flexWrap: 'wrap' as const,
        }}>
          <span style={{ color: 'var(--text-muted)' }}>ALGOS <b style={{ color: 'var(--text)' }}>{localFilteredOrders.filter(g => g.legs.length > 0).length}/{localFilteredOrders.length}</b></span>
          <span style={{ color: 'var(--text-muted)' }}>TRADES <b style={{ color: 'var(--text)' }}>{localFilteredOrders.reduce((s, g) => s + g.legs.length, 0)}</b></span>
          <span style={{ color: 'var(--text-muted)' }}>OPEN <b style={{ color: '#22DD88' }}>{localFilteredOrders.reduce((s, g) => s + g.legs.filter(l => l.status === 'open').length, 0)}</b></span>
          <span style={{ color: 'var(--text-muted)' }}>CLOSED <b style={{ color: 'rgba(255,255,255,0.5)' }}>{localFilteredOrders.reduce((s, g) => s + g.legs.filter(l => l.status === 'closed').length, 0)}</b></span>
        </div>

      </div>{/* end fixed zone */}

      {/* ── Scroll zone ── */}
      <div className="no-scrollbar" style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ height: '6px' }} />

        {/* Live MTM wired to header — strip removed */}

        {/* Holiday banner */}
        {isHolidayToday && (
          <div style={{ marginBottom: '16px', padding: '10px 14px', background: 'rgba(215,123,18,0.08)', border: '1px solid rgba(215,123,18,0.25)', borderRadius: '7px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '14px' }}>🏛</span>
            <span style={{ fontSize: '12px', color: 'var(--accent-amber)', fontWeight: 600 }}>Market Holiday</span>
            <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>— No trading scheduled for {selectedDate}</span>
          </div>
        )}

        {/* Waiting algos — full algo cards */}
        {localFilteredWaiting.length > 0 && !isHolidayToday && (
          <div style={{ marginBottom: '16px' }}>
            {localFilteredWaiting.map(w => {
              const isMissed = !!w.entry_time && (() => {
                const now = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false })
                return now >= w.entry_time.slice(0, 5)
              })()
              const errType = w.latest_error?.event_type || ''
              const isFeedErr = errType.includes('FEED') || (w.latest_error?.reason || '').includes('FEED_ERROR')
              const isEntryMissed = errType.includes('ENTRY_MISSED') || (w.latest_error?.reason || '').includes('ENTRY_MISSED')
              const isOrbExpired = errType.includes('ORB_EXPIRED') || (w.latest_error?.reason || '').includes('ORB_EXPIRED')
              const isRetrying = waitingRetryLoading[w.grid_entry_id]

              const doWaitingRE = async () => {
                setWaitingRetryLoading(prev => ({ ...prev, [w.grid_entry_id]: true }))
                try {
                  await ordersAPI.retryEntry(w.grid_entry_id)
                  // Refresh orders + waiting list
                  ordersAPI.waiting(selectedDate, isPractixMode)
                    .then(res => setWaitingAlgos(res.data?.waiting || []))
                    .catch(() => {})
                } catch { /* silent — entry may already be queued */ }
                finally { setWaitingRetryLoading(prev => ({ ...prev, [w.grid_entry_id]: false })) }
              }

              const missedBtns = [
                { label: isRetrying ? '↻' : 'RE-RUN', col: '#F59E0B', bg: 'rgba(245,158,11,0.05)', hBg: 'rgba(245,158,11,0.14)', border: undefined, disabled: !isMissed || isRetrying, action: isMissed ? doWaitingRE : undefined },
                { label: 'SYNC',   col: '#CC4400', bg: 'rgba(204,68,0,0.05)',    hBg: 'rgba(204,68,0,0.14)',   border: undefined, disabled: true,      action: undefined },
                { label: 'SQ',     col: '#22DD88', bg: 'rgba(34,221,136,0.05)', hBg: 'rgba(34,221,136,0.14)', border: undefined, disabled: true,      action: undefined },
                { label: 'T',      col: '#FF4444', bg: 'rgba(255,68,68,0.05)',  hBg: 'rgba(255,68,68,0.14)',  border: undefined, disabled: true,      action: undefined },
                { label: isRetrying ? '↻' : 'RETRY', col: '#F59E0B', bg: 'rgba(245,158,11,0.05)', hBg: 'rgba(245,158,11,0.14)', border: undefined, disabled: !w.latest_error || isRetrying, action: w.latest_error ? doWaitingRE : undefined },
                { label: 'REPLAY', col: '#8B5CF6', bg: 'rgba(139,92,246,0.15)', hBg: 'rgba(139,92,246,0.25)', border: '1px solid rgba(139,92,246,0.4)', disabled: true, action: undefined },
              ]

              const legStatusChip = isMissed
                ? { label: 'MISSED',  color: 'rgba(255,255,255,0.4)', bg: 'rgba(255,255,255,0.06)' }
                : { label: 'WAITING', color: '#FFD700',               bg: 'rgba(255,215,0,0.10)'   }

              return (
                <div key={w.grid_entry_id}
                  onMouseEnter={() => setHoveredCard(w.grid_entry_id)}
                  onMouseLeave={() => setHoveredCard(null)}
                  style={{
                    borderRadius: '10px', overflow: 'hidden', marginBottom: 10,
                    border: `0.5px solid ${hoveredCard === w.grid_entry_id ? 'rgba(255,215,0,0.45)' : 'rgba(255,215,0,0.20)'}`,
                  }}>

                  {/* ── Card header ── */}
                  <div style={{ background: 'var(--glass-bg)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', display: 'flex', alignItems: 'stretch' }}>

                    {/* Left status strip */}
                    <div style={{ width: '4px', flexShrink: 0, alignSelf: 'stretch', background: isMissed ? 'rgba(255,215,0,0.35)' : '#FFE600', boxShadow: '0 0 8px rgba(255,215,0,0.5), 0 0 20px rgba(255,215,0,0.3)' }}/>

                    {/* Info row */}
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', flexWrap: 'wrap' as const, minWidth: 0 }}>

                      {/* Algo name */}
                      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '14px', color: 'rgba(232,232,248,0.85)', whiteSpace: 'nowrap' as const }}>
                        {w.algo_name}
                      </span>

                      {/* Account pill */}
                      {w.account_name && (
                        <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '100px', background: 'rgba(255,107,0,0.10)', color: 'var(--ox-glow)', border: '0.5px solid rgba(255,107,0,0.28)', whiteSpace: 'nowrap' as const }}>
                          {w.account_name}
                        </span>
                      )}

                      {/* MISSED / WAITING chip */}
                      <span className="tag" style={{ color: '#FFD700', background: 'rgba(255,215,0,0.12)', fontSize: '10px', whiteSpace: 'nowrap' as const }}>
                        {isMissed ? 'MISSED' : 'WAITING'}
                      </span>

                      {/* Inline event note */}
                      {(isFeedErr || isEntryMissed) && (
                        <span style={{ fontSize: '11px', color: '#D77B12' }}>
                          ⏭ {isEntryMissed ? 'Entry missed — server restarted after window' : 'Feed not ready'}
                        </span>
                      )}
                      {isOrbExpired && (
                        <span style={{ fontSize: '11px', color: '#D77B12' }}>⏱ ORB window closed</span>
                      )}
                      {w.latest_error && !isFeedErr && !isEntryMissed && !isOrbExpired && (
                        <span style={{ fontSize: '11px', color: '#EF4444' }}>
                          ⛔ {(w.latest_error.reason || '').slice(0, 60)}
                        </span>
                      )}

                      {/* Entry time — right side */}
                      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
                        {w.entry_time && (
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                            Entry {w.entry_time.slice(0, 5)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* ── Tall action buttons ── */}
                    <div style={{ display: 'flex', alignSelf: 'stretch', borderLeft: '0.5px solid rgba(255,255,255,0.06)' }}>
                      {missedBtns.map((btn, bi) => (
                        <button key={bi}
                          disabled={btn.disabled}
                          onClick={btn.action}
                          style={{
                            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                            gap: 4, padding: '0 14px', background: btn.bg, border: btn.border ?? 'none',
                            borderRight: '0.5px solid rgba(255,255,255,0.06)',
                            cursor: btn.disabled ? 'not-allowed' : 'pointer',
                            color: btn.col, minWidth: 52, transition: 'all 150ms',
                            opacity: btn.disabled ? 0.3 : 1,
                            pointerEvents: btn.disabled ? 'none' : 'auto',
                          }}
                          onMouseEnter={e => { if (!btn.disabled) e.currentTarget.style.background = btn.hBg }}
                          onMouseLeave={e => { e.currentTarget.style.background = btn.bg }}>
                          <span style={{ fontSize: 9, letterSpacing: '0.5px', fontFamily: 'var(--font-display)', fontWeight: 700 }}>{btn.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ── Leg table ── */}
                  {(w.legs || []).length > 0 && (
                    <div style={{ borderTop: '0.5px solid var(--bg-border)' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <colgroup>{COLS.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
                        <thead>
                          <tr>
                            {['#','Status','Symbol','Lots','Fill / Ref','LTP','SL (A/O)','Target','Exit','Reason','P&L'].map(h => (
                              <th key={h} style={{ textAlign: 'center', fontSize: 10, color: 'rgba(232,232,248,0.4)', fontWeight: 600, padding: '5px 6px', borderBottom: '0.5px solid rgba(255,255,255,0.06)', verticalAlign: 'middle' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(w.legs || []).map(leg => (
                            <tr key={leg.leg_number}>
                              <td style={{ textAlign: 'center', padding: '6px 6px', color: 'var(--text-muted)', fontSize: 11, verticalAlign: 'middle' }}>{leg.leg_number}</td>
                              <td style={{ textAlign: 'center', padding: '6px 6px', verticalAlign: 'middle' }}>
                                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 3, color: legStatusChip.color, background: legStatusChip.bg, letterSpacing: 0.5 }}>
                                  {legStatusChip.label}
                                </span>
                              </td>
                              <td style={{ textAlign: 'center', padding: '6px 6px', fontSize: 11, verticalAlign: 'middle' }}>
                                <div style={{ color: 'rgba(232,232,248,0.75)' }}>{leg.underlying} {leg.instrument?.toUpperCase()}</div>
                                <div style={{ fontSize: 10, color: leg.direction === 'buy' ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{leg.direction?.toUpperCase()}</div>
                              </td>
                              <td style={{ textAlign: 'center', padding: '6px 6px', color: 'var(--text-muted)', fontSize: 11, verticalAlign: 'middle' }}>{leg.lots}</td>
                              {['Fill / Ref','LTP','SL (A/O)','Target','Exit','Reason','P&L'].map(col => (
                                <td key={col} style={{ textAlign: 'center', padding: '6px 6px', color: 'var(--text-dim)', fontSize: 11, verticalAlign: 'middle' }}>—</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Empty state */}
        {localFilteredOrders.length === 0 && (
          <div style={{ padding: '64px 24px', textAlign: 'center', color: 'var(--text-dim)', fontSize: '13px' }}>
            No orders for today.
          </div>
        )}

        {/* ── Instrument groups ── */}
        {instrumentKeys.map((instrument, gIdx) => {
          const groupAlgos  = groupedByInstrument[instrument]
          const isCollapsed = collapsedGroups.has(instrument)
          return (
            <div key={instrument}>

              {/* Instrument header */}
              <div
                onClick={() => setCollapsedGroups(prev => {
                  const next = new Set(prev)
                  if (next.has(instrument)) next.delete(instrument); else next.add(instrument)
                  return next
                })}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer',
                  paddingBottom: '8px', marginBottom: '8px', marginTop: gIdx === 0 ? 0 : '20px',
                  borderBottom: '0.5px solid rgba(255,107,0,0.15)', userSelect: 'none',
                }}>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: '13px', fontWeight: 700, color: 'var(--ox-radiant)', letterSpacing: '1px' }}>
                  {instrument}
                </span>
                <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.38)' }}>
                  {groupAlgos.length} algo{groupAlgos.length !== 1 ? 's' : ''}
                </span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,107,0,0.55)" strokeWidth="2.5"
                  style={{ marginLeft: 'auto', transition: 'transform 0.2s ease', transform: isCollapsed ? 'rotate(-90deg)' : 'none' }}>
                  <path d="M6 9l6 6 6-6"/>
                </svg>
              </div>

              {!isCollapsed && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '4px' }}>
                  {groupAlgos.map(group => {
                    // gi = global index into orders[] — needed by all action handlers
                    const gi       = orders.findIndex(g => g.algoId === group.algoId)
                    const algoSt   = getAlgoStatus(group)
                    const bar      = ALGO_STATUS_BAR[algoSt]
                    const chip     = ALGO_STATUS_CHIP[algoSt]
                    const isClosed = group.legs.length > 0 && group.legs.every(l => l.status === 'closed' || l.status === 'error')
                    const closedL  = group.legs.filter(l => l.status === 'closed' && l.fillPrice != null && l.exitPrice != null)
                    const totalPnl = closedL.reduce((s, l) => s + (l.pnl ?? 0), 0)
                    const showSpark = closedL.length > 0 && !group.legs.some(l => l.status === 'open' || l.status === 'pending')

                    // Action button helper booleans
                    const hasOpenLegs  = openLegs(gi).length > 0
                    const allLegsError = group.legs.length > 0 && group.legs.every(l => l.status === 'error')
                    const isTerminated = !!group.terminated
                    const isOrbAlgo    = group.entryType === 'orb'
                    const isOrbMissed  = isOrbAlgo && !!group.orbEndTime && (() => {
                      const [hh, mm] = (group.orbEndTime || '').split(':').map(Number)
                      const istNow   = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
                      return istNow.getHours() > hh || (istNow.getHours() === hh && istNow.getMinutes() >= mm)
                    })()
                    const canRetry = !!group.gridEntryId && allLegsError && !isTerminated && !isClosed && !isOrbMissed
                    const canReRun = algoSt === 'no_trade' && !isTerminated && !!group.gridEntryId

                    // Action button definitions
                    const BTNS = [
                      { label: loading[`retry-${gi}`] ? '↻' : 'RE-RUN', col: canReRun ? '#F59E0B' : '#6B6B6B', bg: canReRun ? 'rgba(245,158,11,0.05)' : 'rgba(100,100,100,0.04)', hBg: 'rgba(245,158,11,0.14)', border: undefined, disabled: !canReRun || !!loading[`retry-${gi}`], title: canReRun ? undefined : 'Available only when algo missed entry (no_trade)', action: () => doRetry(gi) },
                      { label: 'SYNC',   col: '#CC4400', bg: 'rgba(204,68,0,0.05)',    hBg: 'rgba(204,68,0,0.14)',    border: undefined, disabled: isTerminated,                              title: undefined, action: () => { setSyncForm({ broker_order_id: '', account_id: group.account }); setShowSync(gi) } },
                      { label: 'SQ',     col: '#22DD88', bg: 'rgba(34,221,136,0.05)', hBg: 'rgba(34,221,136,0.14)',  border: undefined, disabled: isTerminated || isClosed || !hasOpenLegs, title: undefined, action: () => { setSqChecked({}); setModal({ type: 'sq', algoIdx: gi }) } },
                      { label: 'T',      col: '#FF4444', bg: 'rgba(255,68,68,0.05)',   hBg: 'rgba(255,68,68,0.14)',   border: undefined, disabled: isTerminated || isClosed,                 title: undefined, action: () => setModal({ type: 't', algoIdx: gi }) },
                      { label: loading[`re-${gi}`] ? '↻' : 'RETRY', col: canRetry ? '#F59E0B' : '#6B6B6B', bg: canRetry ? 'rgba(245,158,11,0.05)' : 'rgba(100,100,100,0.04)', hBg: 'rgba(245,158,11,0.14)', border: undefined, disabled: !canRetry || !!loading[`re-${gi}`], title: isOrbMissed ? 'ORB window closed' : (allLegsError ? undefined : 'All legs must be in error state'), action: () => { const errLegs = group.legs.filter(l => l.status === 'error'); setRetryChecked(Object.fromEntries(errLegs.map(l => [l.id, true] as [string, boolean]))); setRetryModal({ algoIdx: gi, legs: errLegs }) } },
                      { label: 'REPLAY', col: '#8B5CF6', bg: 'rgba(139,92,246,0.15)', hBg: 'rgba(139,92,246,0.25)', border: '1px solid rgba(139,92,246,0.4)', disabled: !isClosed, title: undefined, action: () => setReplayAlgo({ id: group.algoId, name: group.algoName, date: selectedDate }) },
                    ]

                    return (
                      <div key={group.algoId}
                        onMouseEnter={() => setHoveredCard(group.algoId)}
                        onMouseLeave={() => setHoveredCard(null)}
                        style={{ opacity: group.terminated ? 0.65 : 1, borderRadius: '10px', overflow: 'hidden', border: `0.5px solid ${hoveredCard === group.algoId ? 'rgba(255,107,0,0.45)' : 'rgba(255,107,0,0.22)'}` }}>

                        {/* ── Algo card header ── */}
                        <div style={{ background: 'var(--glass-bg)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', display: 'flex', alignItems: 'stretch' }}>

                          {/* Status strip */}
                          <div style={{ width: '4px', flexShrink: 0, alignSelf: 'stretch', background: bar.color, boxShadow: `0 0 8px ${bar.glow}, 0 0 20px ${bar.glow}` }}/>

                          {/* Info row */}
                          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', flexWrap: 'wrap', minWidth: 0 }}>

                            {group.terminated && <span style={{ fontSize: '13px' }} title="Algo terminated">⛔</span>}

                            {/* Algo name */}
                            <span
                              onClick={() => setSelectedAlgoName(group.algoName)}
                              style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '14px', color: 'rgba(232,232,248,0.85)', cursor: 'pointer', whiteSpace: 'nowrap', textDecoration: 'underline', textDecorationStyle: 'dotted', textDecorationColor: 'rgba(255,107,0,0.35)' }}>
                              {group.algoName}
                            </span>

                            {/* Account pill */}
                            <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '100px', background: 'rgba(255,107,0,0.10)', color: 'var(--ox-glow)', border: '0.5px solid rgba(255,107,0,0.28)', whiteSpace: 'nowrap' }}>
                              {group.account || '—'}
                            </span>

                            {/* Status chip */}
                            <span className="tag" style={{ color: chip.color, background: chip.bg, fontSize: '10px', whiteSpace: 'nowrap' }}>
                              {chip.label}
                            </span>
                            {/* ORB capture indicator */}
                            {isOrbAlgo && !isOrbMissed && algoSt === 'waiting' && (
                              <span style={{ fontSize: '10px', color: '#F59E0B', background: 'rgba(245,158,11,0.10)', border: '0.5px solid rgba(245,158,11,0.30)', padding: '1px 8px', borderRadius: '100px', whiteSpace: 'nowrap' as const, fontWeight: 600 }}>
                                📡 Capturing ORB
                              </span>
                            )}

                            {/* MTM SL/TP */}
                            {!group.terminated && !!(group.mtmSL || group.mtmTP) && (
                              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                {group.mtmSL !== 0 && <>SL: <span style={{ color: 'var(--red)' }}>₹{Math.abs(group.mtmSL).toLocaleString('en-IN')}</span></>}
                                {group.mtmSL !== 0 && group.mtmTP !== 0 && <>&nbsp;·&nbsp;</>}
                                {group.mtmTP !== 0 && <>TP: <span style={{ color: 'var(--green)' }}>₹{group.mtmTP.toLocaleString('en-IN')}</span></>}
                              </span>
                            )}

                            {/* Error badge */}
                            {!group.terminated && group.legs.some(l => l.status === 'error') && (() => {
                              const errLegs = group.legs.filter(l => l.status === 'error')
                              const firstMsg = errLegs[0]?.errorMessage
                              const shortMsg = firstMsg ? ` — ${firstMsg.length > 40 ? firstMsg.slice(0, 40) + '…' : firstMsg}` : ''
                              return (
                                <span title={firstMsg || undefined} className="chip chip-error" style={{ fontSize: '10px', cursor: firstMsg ? 'help' : 'default' }}>
                                  ⚠ {errLegs.length} LEG{errLegs.length > 1 ? 'S' : ''} FAILED{shortMsg}
                                </span>
                              )
                            })()}

                            {/* Inline status pill + Sparkline + MTM P&L (right side) */}
                            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
                              {/* Inline status pill — before sparkline */}
                              {group.inlineStatus && (
                                <span style={{
                                  fontSize: '10px', fontWeight: 600, color: group.inlineColor,
                                  padding: '2px 8px', borderRadius: '100px',
                                  background: `${group.inlineColor}18`,
                                  border: `0.5px solid ${group.inlineColor}44`,
                                  whiteSpace: 'nowrap' as const,
                                  animation: 'fadeIn 0.15s ease',
                                }}>
                                  {group.inlineStatus}
                                </span>
                              )}
                              {showSpark && (
                                <SmoothedSparkline algoId={group.algoId} legs={group.legs} totalPnl={totalPnl} />
                              )}
                              {(() => {
                                const openLegIds = group.legs.filter(l => l.status === 'open').map(l => l.id)
                                const livePnlEntries = openLegIds.map(id => ltpData[id]).filter(Boolean)
                                const liveMtm = livePnlEntries.length > 0
                                  ? livePnlEntries.reduce((s, e) => s + (e?.pnl ?? 0), 0)
                                  : null
                                const displayMtm = liveMtm !== null ? liveMtm : group.mtm
                                return (
                                  <span style={{
                                    minWidth: '90px', textAlign: 'right',
                                    fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '14px',
                                    color: displayMtm !== 0 ? (displayMtm >= 0 ? 'var(--green)' : 'var(--red)') : 'transparent',
                                    opacity: group.terminated ? 0.6 : 1,
                                  }}>
                                    {displayMtm !== 0 ? `${displayMtm >= 0 ? '+' : ''}₹${displayMtm.toLocaleString('en-IN')}` : ''}
                                  </span>
                                )
                              })()}
                            </div>
                          </div>

                          {/* ── Tall action buttons ── */}
                          <div style={{ display: 'flex', alignSelf: 'stretch', borderLeft: '0.5px solid rgba(255,255,255,0.06)' }}>
                            {BTNS.map((btn, bi) => (
                              <button key={bi}
                                disabled={btn.disabled}
                                title={btn.title}
                                onClick={btn.action}
                                style={{
                                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                                  gap: 4, padding: '0 14px', background: btn.bg, border: btn.border ?? 'none',
                                  borderRight: '0.5px solid rgba(255,255,255,0.06)',
                                  cursor: btn.disabled ? 'not-allowed' : 'pointer',
                                  color: btn.col, minWidth: 52, transition: 'all 150ms',
                                  opacity: btn.disabled ? 0.3 : 1,
                                  pointerEvents: btn.disabled ? 'none' : 'auto',
                                }}
                                onMouseEnter={e => { if (!btn.disabled) { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = btn.hBg } }}
                                onMouseLeave={e => { e.currentTarget.style.opacity = btn.disabled ? '0.3' : '1'; e.currentTarget.style.background = btn.bg }}>
                                <span style={{ fontSize: 9, letterSpacing: '0.5px', fontFamily: 'var(--font-display)', fontWeight: 700 }}>{btn.label}</span>
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* ── Latest error banner ── */}
                        {group.latest_error && (
                          <div style={{
                            background: 'rgba(255,68,68,0.08)',
                            border: '0.5px solid rgba(255,68,68,0.3)',
                            borderRadius: 6, padding: '6px 10px',
                            fontSize: 11, color: '#FF4444',
                            fontFamily: 'var(--font-mono)',
                            marginTop: 6
                          }}>
                            ⛔ {group.latest_error.timestamp ? new Date(group.latest_error.timestamp).toLocaleTimeString('en-IN', {hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'}) : ''} — {group.latest_error.reason}
                          </div>
                        )}

                        {/* ── Legs table ── */}
                        <div style={{ border: '0.5px solid rgba(255,255,255,0.07)', borderTop: 'none', borderRadius: '0 0 10px 10px', overflow: 'visible', background: 'rgba(14,10,6,0.65)', backdropFilter: 'blur(20px)' }}>
                          <div className="cloud-fill" style={{ borderRadius: '8px', overflow: 'visible', marginTop: '8px' }}>
                            <div className="orders-table-wrapper" style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' as any }}>
                            <table className="staax-table">
                              <colgroup>{COLS.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
                              <thead>
                                <tr>
                                  {HDRS.map(h => (
                                    <th key={h} style={{ textAlign: (h === 'Symbol' || h === '#') ? 'left' : 'center' }}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {buildRows(group.legs).map(({ leg, isChild }) => {
                                  const pollEntry = ltpData[leg.id]
                                  // Coerce instrumentToken to number — JSON may deserialise it as string
                                  const tokenKey = leg.instrumentToken != null ? Number(leg.instrumentToken) : undefined
                                  const resolvedLtp = pollEntry?.ltp ?? (tokenKey ? ltpMap[tokenKey] : undefined)
                                  const isLive = pollEntry?.ltp !== null &&
                                                 pollEntry?.ltp !== undefined &&
                                                 typeof pollEntry?.ltp === 'number'
                                  return (
                                    <LegRow key={leg.id} leg={leg} isChild={isChild}
                                      liveLtp={resolvedLtp}
                                      hasLivePoll={isLive}
                                      livePnl={leg.status === 'open' ? pollEntry?.pnl : undefined}
                                      onEditExit={(id, price) => setEditExit({ orderId: id, value: String(price) })}
                                      orbHigh={group.orbHigh}
                                      orbLow={group.orbLow}
                                      isOrbAlgo={group.entryType === 'orb'}
                                    />
                                  )
                                })}
                              </tbody>
                            </table>
                            </div>
                          </div>
                        </div>

                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}

        <div style={{ height: '24px' }} />
      </div>{/* end scroll zone */}

      {/* ── SYNC Modal ── */}
      {showSync !== null && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: '380px' }}>
            <div style={{ fontWeight: 700, fontSize: '16px', marginBottom: '4px' }}>🔗 Sync Order — {orders[showSync]?.algoName}</div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px', lineHeight: 1.5 }}>
              Re-link an order that got delinked from STAAX.<br/>
              Find the <b>Order ID</b> in your broker platform (Zerodha: Order Book → Order ID · Angel One: Order Book → Broker Order No.)
            </div>

            {/* ── Legs needing sync ── */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, fontWeight: 600, textTransform: 'uppercase' }}>
                Legs needing sync
              </div>
              {(orders[showSync]?.legs ?? [])
                .filter((l: Leg) => l.status === 'error' || l.status === 'pending')
                .map((l: Leg) => (
                  <div key={l.id} style={{
                    display: 'flex', gap: 12, alignItems: 'center',
                    padding: '6px 10px', marginBottom: 4,
                    background: 'rgba(255,68,68,0.08)',
                    border: '0.5px solid rgba(255,68,68,0.2)',
                    borderRadius: 6, fontSize: 11
                  }}>
                    <span style={{ color: '#FF4444', fontWeight: 600 }}>{l.journeyLevel}</span>
                    <span style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{l.symbol}</span>
                    <span style={{ color: l.dir === 'BUY' ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{l.dir}</span>
                    <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>{l.status.toUpperCase()}</span>
                  </div>
                ))
              }
              {(orders[showSync]?.legs ?? []).filter((l: Leg) => l.status === 'error' || l.status === 'pending').length === 0 && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>No legs in error state</div>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 600, textTransform: 'uppercase' }}>Broker Order ID(s) * <span style={{ fontWeight: 400, textTransform: 'none' }}>(comma-separated for multiple)</span></div>
                <textarea className="staax-input" style={{ width: '100%', fontSize: '13px', fontWeight: 600, resize: 'vertical', minHeight: '60px', fontFamily: 'monospace' }}
                  placeholder="e.g. 1100000000123456, 1100000000123457"
                  autoFocus
                  value={syncForm.broker_order_id}
                  onChange={e => setSyncForm(s => ({ ...s, broker_order_id: e.target.value }))} />
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '3px' }}>STAAX will fetch each order from broker and re-link automatically</div>
              </div>
              <div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 600, textTransform: 'uppercase' }}>Account *</div>
                <select className="staax-select" style={{ width: '100%', fontSize: '12px' }}
                  value={syncForm.account_id}
                  onChange={e => setSyncForm(s => ({ ...s, account_id: e.target.value }))}>
                  <option value="">Select account...</option>
                  {orders[showSync]?.account && <option value={orders[showSync].account}>{orders[showSync].account}</option>}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button className="btn btn-ghost" onClick={() => setShowSync(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={syncLoading} onClick={() => doSync(showSync)}>
                {syncLoading ? '🔄 Fetching from broker...' : '🔗 Sync Order'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Exit Price Correction Modal ── */}
      {editExit && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: '320px' }}>
            <div style={{ fontWeight: 700, fontSize: '16px', marginBottom: '8px' }}>✏️ Correct Exit Price</div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>Override the broker-reported exit price. Used when the broker reported a wrong fill.</div>
            <div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 600, textTransform: 'uppercase' }}>Exit Price</div>
              <input className="staax-input" type="number" style={{ width: '100%', fontSize: '14px', fontWeight: 700 }}
                value={editExit.value}
                onChange={e => setEditExit(ex => ex ? { ...ex, value: e.target.value } : null)}
                autoFocus />
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button className="btn btn-ghost" onClick={() => setEditExit(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={exitSaving} onClick={doCorrectExit}>
                {exitSaving ? 'Saving...' : '✅ Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── RETRY leg-selection modal ── */}
      {retryModal && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: '420px' }}>
            <div style={{ fontWeight: 700, fontSize: '16px', marginBottom: '4px' }}>↻ Retry Failed Legs — {orders[retryModal.algoIdx]?.algoName}</div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>
              Select which failed legs to retry at broker level.
            </div>
            {retryModal.legs.map(l => (
              <label key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', marginBottom: 4, background: 'rgba(255,68,68,0.08)', border: '0.5px solid rgba(255,68,68,0.2)', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
                <input type="checkbox" checked={!!retryChecked[l.id]} onChange={e => setRetryChecked(prev => ({ ...prev, [l.id]: e.target.checked }))} />
                <span style={{ color: '#FF4444', fontWeight: 600, minWidth: 28 }}>{l.journeyLevel}</span>
                <span style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{l.symbol}</span>
                <span style={{ color: l.dir === 'BUY' ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{l.dir}</span>
                {l.errorMessage && <span style={{ color: 'var(--text-muted)', fontSize: 10, marginLeft: 'auto' }}>{l.errorMessage.slice(0, 40)}</span>}
              </label>
            ))}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button className="btn btn-ghost" onClick={() => setRetryModal(null)}>Cancel</button>
              <button className="btn btn-primary"
                disabled={!Object.values(retryChecked).some(Boolean) || !!loading[`re-${retryModal.algoIdx}`]}
                onClick={() => { doRE(retryModal.algoIdx); setRetryModal(null) }}>
                {loading[`re-${retryModal.algoIdx}`] ? '↻ Retrying...' : '↻ Retry Selected'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Strategy popup modal ── */}
      <AlgoDetailModal algoName={selectedAlgoName} onClose={() => setSelectedAlgoName(null)} />

      {/* ── Trade Replay modal ── */}
      {replayAlgo && (
        <TradeReplay
          algoId={replayAlgo.id}
          algoName={replayAlgo.name}
          date={replayAlgo.date}
          onClose={() => setReplayAlgo(null)}
        />
      )}

      {/* ── Confirm Modal ── */}
      {modal && (() => {
        const mc = getModalContent()
        if (!mc) return null
        return (
          <ConfirmModal title={mc.title} desc={mc.desc} confirmLabel={mc.confirmLabel}
            confirmColor={mc.confirmColor} onCancel={() => { setModal(null); setSqResults(null); setSqError(null); setSqChecked({}) }} onConfirm={doConfirm}>
            {mc.children}
          </ConfirmModal>
        )
      })()}

    </div>
  )
}
