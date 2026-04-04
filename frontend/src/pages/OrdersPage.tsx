import { useStore } from '@/store'
import { useState, useEffect } from 'react'
import { algosAPI, ordersAPI, openPositionsAPI, holidaysAPI } from '@/services/api'

const INSTRUMENT_ORDER = ['BANKNIFTY', 'NIFTY', 'SENSEX', 'MIDCAPNIFTY', 'FINNIFTY', 'OTHER']

// IST time formatters — all timestamps from backend are UTC ISO strings
const fmtIST = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

type LegStatus  = 'open' | 'closed' | 'error' | 'pending'
type AlgoStatus = 'open' | 'closed' | 'error' | 'pending' | 'waiting' | 'no_trade'

interface Leg {
  id: string; parentId?: string; journeyLevel: string; status: LegStatus
  symbol: string; dir: 'BUY' | 'SELL'; lots: string; entryCondition: string
  instrumentToken?: number
  errorMessage?: string
  refPrice?: number; fillPrice?: number; fillTime?: string; ltp?: number
  slOrig?: number; slActual?: number; target?: number
  exitPrice?: number; exitTime?: string; exitReason?: string; pnl?: number
}
interface AlgoGroup {
  algoId: string; algoName: string; account: string; mtm: number; mtmSL: number; mtmTP: number
  legs: Leg[]; inlineStatus?: string; inlineColor?: string; terminated?: boolean
  isLive?: boolean
}
interface WaitingAlgo {
  grid_entry_id: string; algo_id: string; algo_name: string
  account_name: string; entry_time: string | null; exit_time: string | null
  is_practix: boolean
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

const COLS = ['36px','66px','174px','66px','140px','54px','76px','58px','88px','90px','82px']
const HDRS = ['#','Status','Symbol','Lots','Fill / Ref','LTP','SL (A/O)','Target','Exit','Reason','P&L']

// ── Helpers ─────────────────────────────────────────────────────────────────
function todayDay(): string {
  return new Date().toLocaleDateString('en-US', { weekday: 'short', timeZone: 'Asia/Kolkata' }).toUpperCase().slice(0, 3)
}

function getWeekDates(): Record<string, string> {
  const now  = new Date()
  const ist  = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const dow  = ist.getDay()
  const mon  = new Date(ist)
  mon.setDate(ist.getDate() - (dow === 0 ? 6 : dow - 1))
  const names = ['MON','TUE','WED','THU','FRI','SAT','SUN']
  const map: Record<string, string> = {}
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon); d.setDate(mon.getDate() + i)
    map[names[i]] = d.toISOString().slice(0, 10)
  }
  return map
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

// ── LegRow ───────────────────────────────────────────────────────────────────
function LegRow({ leg, isChild, liveLtp, onEditExit }: {
  leg: Leg; isChild: boolean; liveLtp?: number
  onEditExit?: (orderId: string, price: number) => void
}) {
  const st  = STATUS_STYLE[leg.status]
  const ltp = liveLtp ?? leg.ltp
  const C: React.CSSProperties = { textAlign: 'center' }
  return (
    <>
    <tr style={{ background: isChild ? 'rgba(255,107,0,0.025)' : undefined, boxShadow: leg.status === 'error' ? 'inset 3px 0 0 #FF4444' : undefined }}>
      <td style={{ paddingLeft: isChild ? '16px' : '10px', width: COLS[0] }}>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: isChild ? 600 : 400 }}>{leg.journeyLevel}</span>
      </td>
      <td style={{ width: COLS[1], ...C }}>
        <span className="tag" style={{ color: st.color, background: st.bg, fontSize: '10px' }}>{leg.status.toUpperCase()}</span>
      </td>
      <td style={{ width: COLS[2] }}>
        <div style={{ fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{leg.symbol}</div>
        <div style={{ fontSize: '10px', color: leg.dir === 'BUY' ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{leg.dir}</div>
      </td>
      <td style={{ width: COLS[3], ...C, color: 'var(--text-muted)', fontSize: '11px' }}>{leg.lots}</td>
      <td style={{ width: COLS[4], fontSize: '11px', ...C }}>
        {leg.fillPrice != null
          ? <div style={{ fontWeight: 600 }}>Fill: {leg.fillPrice}{leg.fillTime && <span style={{ fontWeight: 400, color: 'var(--text-dim)', marginLeft: '5px', fontSize: '10px' }}>{leg.fillTime}</span>}</div>
          : <div style={{ color: 'var(--text-dim)' }}>Fill: —</div>}
        {leg.refPrice != null && <div style={{ color: 'var(--text-muted)', fontSize: '10px' }}>Ref: {leg.refPrice} · {leg.entryCondition}</div>}
        {leg.refPrice == null && leg.entryCondition && <div style={{ color: 'var(--text-muted)', fontSize: '10px' }}>{leg.entryCondition}</div>}
      </td>
      <td style={{ width: COLS[5], ...C, fontWeight: 600, color: ltp != null && leg.fillPrice != null ? (ltp > leg.fillPrice ? 'var(--green)' : 'var(--red)') : 'var(--text-muted)' }}>
        {ltp != null ? ltp.toFixed(2) : '—'}
      </td>
      <td style={{ width: COLS[6], fontSize: '11px', ...C }}>
        {(() => {
          const slPrice = leg.fillPrice != null && leg.slOrig != null
            ? leg.fillPrice * (1 - (leg.dir === 'BUY' ? 1 : -1) * leg.slOrig / 100)
            : null
          const hasTSL = leg.slActual != null && slPrice != null && Math.abs(leg.slActual - slPrice) > 1.0
          if (hasTSL && slPrice != null) {
            return <div style={{ color: 'var(--text-muted)' }}>O:{slPrice.toFixed(0)} A:<span style={{ color: 'var(--amber)' }}>{leg.slActual!.toFixed(0)}</span> ({leg.slOrig}%)</div>
          }
          if (slPrice != null) return <div style={{ color: 'var(--text-muted)' }}>{slPrice.toFixed(0)} ({leg.slOrig}%)</div>
          if (leg.slOrig != null) return <div style={{ color: 'var(--text-muted)' }}>{leg.slOrig}%</div>
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
      <td style={{ width: COLS[10], fontWeight: 700, textAlign: 'right', color: (leg.pnl || 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
        {leg.pnl != null && leg.pnl !== 0 ? `${leg.pnl >= 0 ? '+' : ''}₹${Math.abs(leg.pnl).toLocaleString('en-IN')}` : '—'}
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

function setInlineStatus(setOrders: React.Dispatch<React.SetStateAction<AlgoGroup[]>>, idx: number, msg: string, color: string, ms = 3000) {
  setOrders(o => o.map((g, i) => i === idx ? { ...g, inlineStatus: msg, inlineColor: color } : g))
  setTimeout(() => setOrders(o => o.map((g, i) => i === idx ? { ...g, inlineStatus: undefined, inlineColor: undefined } : g)), ms)
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

  const closedLegs = legs.filter(l => l.status === 'closed' && l.fillPrice != null && l.exitPrice != null)
  if (closedLegs.length === 0) return null
  const pts = closedLegs.flatMap(l => [l.fillPrice!, l.exitPrice!])
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
  const weekDates  = getWeekDates()
  const today      = todayDay()
  const todayDate  = weekDates[today] || new Date().toISOString().slice(0, 10)

  const [selectedDate, setSelectedDate] = useState<string>(todayDate)
  const [orders, setOrders]             = useState<AlgoGroup[]>([])
  const [waitingAlgos, setWaitingAlgos] = useState<WaitingAlgo[]>([])
  const [ltpMap, setLtpMap]             = useState<Record<number, number>>({})
  const [modal, setModal]               = useState<{ type: 'run' | 'sq' | 't'; algoIdx: number } | null>(null)
  const [sqChecked, setSqChecked]       = useState<Record<string, boolean>>({})
  const [loading, setLoading]           = useState<Record<string, boolean>>({})
  const [showSync, setShowSync]         = useState<number | null>(null)
  const [syncForm, setSyncForm]         = useState({ broker_order_id: '', account_id: '' })
  const [syncLoading, setSyncLoading]   = useState(false)
  const [editExit, setEditExit]         = useState<{ orderId: string; value: string } | null>(null)
  const [exitSaving, setExitSaving]     = useState(false)
  const [algoPopup, setAlgoPopup]       = useState<{ algoName: string; data: any } | null>(null)
  const [openPositions, setOpenPositions] = useState<OpenPosition[]>([])
  const [holidayDates, setHolidayDates] = useState<Set<string>>(new Set())
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [weekPnl, setWeekPnl] = useState<Record<string, number | null>>({})
  const [showWeekends, setShowWeekends] = useState(false)

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

  // Pre-fetch all week P&L on mount
  useEffect(() => {
    const days = ['MON','TUE','WED','THU','FRI']
    Promise.all(days.map(day =>
      ordersAPI.list(weekDates[day], isPractixMode)
        .then((res: any) => {
          const groups: any[] = res.data?.groups || []
          const pnl = groups.flatMap((g: any) => g.orders || [])
            .filter((o: any) => o.status === 'closed' && o.pnl != null)
            .reduce((s: number, o: any) => s + (o.pnl || 0), 0)
          return { day, pnl: groups.length > 0 ? pnl : null }
        })
        .catch(() => ({ day, pnl: null as null }))
    )).then(results => {
      const map: Record<string, number | null> = {}
      results.forEach(r => { map[r.day] = r.pnl })
      setWeekPnl(map)
    })
  }, [isPractixMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load orders + waiting algos for selectedDate
  useEffect(() => {
    setOrders([])
    setWaitingAlgos([])
    ordersAPI.list(selectedDate, isPractixMode)
      .then(res => {
        const data = res.data
        const raw: any[] = Array.isArray(data) ? [] : (data?.groups || [])
        setOrders(raw.map((g: any): AlgoGroup => ({
          algoId:   g.algo_id,
          algoName: g.algo_name || g.algo_id,
          account:  g.account || '',
          mtm:      g.mtm ?? 0,
          mtmSL:    g.mtm_sl ?? 0,
          mtmTP:    g.mtm_tp ?? 0,
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
            target:          o.target ?? undefined,
            exitPrice:       o.exit_price ?? undefined,
            exitTime:        o.exit_time ? fmtIST(o.exit_time) : undefined,
            exitReason:      o.exit_reason ?? undefined,
            pnl:             o.pnl ?? undefined,
          })),
        })))
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

  const safeOrders = Array.isArray(orders) ? orders : []
  const totalMTM   = safeOrders.filter(g => !g.terminated).reduce((s, g) => s + g.mtm, 0)

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
  const doRun = async (idx: number) => {
    const algoId = orders[idx].algoId
    setLoading(l => ({ ...l, [`run-${idx}`]: true }))
    setInlineStatus(setOrders, idx, '▶ Executing...', 'var(--indigo)')
    try {
      await algosAPI.start(algoId)
      setInlineStatus(setOrders, idx, '✅ Algo running', 'var(--green)')
    } catch {
      setInlineStatus(setOrders, idx, '⚠️ Execute failed', 'var(--red)')
    } finally {
      setLoading(l => ({ ...l, [`run-${idx}`]: false }))
    }
    setModal(null)
  }

  const doRE = async (idx: number) => {
    const algoId = orders[idx].algoId
    setInlineStatus(setOrders, idx, '↻ Retrying...', 'var(--accent-amber)')
    try {
      await algosAPI.re(algoId)
      setInlineStatus(setOrders, idx, '✅ Retry sent', 'var(--green)')
    } catch {
      setInlineStatus(setOrders, idx, '⚠️ Retry failed', 'var(--red)')
    }
  }

  const doSQ = async (idx: number) => {
    const algoId   = orders[idx].algoId
    const selected = Object.keys(sqChecked).filter(k => sqChecked[k])
    if (selected.length === 0) { setModal(null); return }
    setLoading(l => ({ ...l, [`sq-${idx}`]: true }))
    try {
      await algosAPI.sq(algoId, selected)
      setOrders(o => o.map((g, i) => i !== idx ? g : {
        ...g,
        legs: (g.legs ?? []).map(l => selected.includes(l.id)
          ? { ...l, status: 'closed' as LegStatus, exitPrice: l.ltp, exitTime: new Date().toLocaleTimeString('en-IN', { hour12: false }), exitReason: 'Manual SQ' }
          : l),
      }))
      setInlineStatus(setOrders, idx, `✅ ${selected.length} leg${selected.length > 1 ? 's' : ''} squared off`, 'var(--green)')
    } catch {
      setInlineStatus(setOrders, idx, '⚠️ SQ failed', 'var(--red)')
    } finally {
      setLoading(l => ({ ...l, [`sq-${idx}`]: false }))
      setSqChecked({})
      setModal(null)
    }
  }

  const doTerminate = async (idx: number) => {
    const algoId = orders[idx].algoId
    setLoading(l => ({ ...l, [`t-${idx}`]: true }))
    try {
      await algosAPI.terminate(algoId)
      setOrders(o => o.map((g, i) => i !== idx ? g : {
        ...g, terminated: true,
        legs: (g.legs ?? []).map(l => l.status === 'open'
          ? { ...l, status: 'closed' as LegStatus, exitPrice: l.ltp, exitTime: new Date().toLocaleTimeString('en-IN', { hour12: false }), exitReason: 'Terminated' }
          : l),
      }))
      setInlineStatus(setOrders, idx, '⛔ Algo terminated', 'var(--red)', 5000)
    } catch {
      setInlineStatus(setOrders, idx, '⚠️ Terminate failed', 'var(--red)')
    } finally {
      setLoading(l => ({ ...l, [`t-${idx}`]: false }))
      setModal(null)
    }
  }

  const doConfirm = () => {
    if (!modal) return
    const { type, algoIdx } = modal
    if (type === 'run') doRun(algoIdx)
    if (type === 'sq')  doSQ(algoIdx)
    if (type === 't')   doTerminate(algoIdx)
  }

  const getModalContent = () => {
    if (!modal) return null
    const { type, algoIdx } = modal
    const name = orders[algoIdx].algoName
    if (type === 'run') return { title: `Execute ${name}?`, desc: `Execute ${name} immediately with the configured entry strategy.`, confirmLabel: 'Execute', confirmColor: 'var(--ox-radiant)', children: undefined }
    if (type === 't')   return { title: `Terminate ${name}?`, desc: `Square off ALL open positions, cancel pending + SL orders at broker, and terminate ${name}. Cannot be undone.`, confirmLabel: 'Terminate', confirmColor: 'var(--red)', children: undefined }
    if (type === 'sq')  return {
      title: `Square Off — ${name}`, desc: 'Select open legs to square off:',
      confirmLabel: 'Square Off', confirmColor: '#22C55E',
      children: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {openLegs(algoIdx).map(leg => (
            <label key={leg.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: '5px', cursor: 'pointer' }}>
              <input type="checkbox" checked={!!sqChecked[leg.id]}
                onChange={e => setSqChecked(s => ({ ...s, [leg.id]: e.target.checked }))}
                style={{ accentColor: 'var(--green)', width: '15px', height: '15px' }} />
              <div>
                <div style={{ fontSize: '12px', fontWeight: 600 }}>{leg.symbol}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '1px' }}>{leg.dir} · {leg.lots} · Fill: {leg.fillPrice} · LTP: {leg.ltp}</div>
              </div>
            </label>
          ))}
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

  const groupedByInstrument: Record<string, AlgoGroup[]> = {}
  for (const group of filteredOrders) {
    const inst = getInstrumentFromGroup(group)
    if (!groupedByInstrument[inst]) groupedByInstrument[inst] = []
    groupedByInstrument[inst].push(group)
  }
  for (const inst of INSTRUMENT_ORDER) {
    groupedByInstrument[inst]?.sort((a, b) => a.algoName.localeCompare(b.algoName))
  }
  const instrumentKeys = INSTRUMENT_ORDER.filter(k => groupedByInstrument[k]?.length > 0)

  // Day summary from filteredOrders
  const closedLegsAll = filteredOrders.flatMap(g => g.legs.filter(l => l.status === 'closed' && l.pnl != null))
  const dayPnl        = closedLegsAll.reduce((s, l) => s + (l.pnl ?? 0), 0)
  const dayWins       = closedLegsAll.filter(l => (l.pnl ?? 0) > 0).length
  const dayWinRate    = closedLegsAll.length > 0 ? Math.round(dayWins / closedLegsAll.length * 100) : null

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
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '3px' }}>
              <span style={{ fontSize: '12px', color: 'var(--gs-muted)' }}>Trade history · P&amp;L by week</span>
              <span className={'chip ' + (isPractixMode ? 'chip-warn' : 'chip-success')} style={{ fontSize: '10px', padding: '1px 8px' }}>
                {isPractixMode ? 'PRACTIX' : 'LIVE'}
              </span>
            </div>
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
                      <span style={{ fontSize: '10px', color: 'var(--accent-amber)', fontWeight: 500 }}>holiday</span>
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
            <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10px', color: 'var(--text-dim)', cursor: 'pointer', paddingRight: '8px', whiteSpace: 'nowrap' as const }}>
              <input type="checkbox" checked={showWeekends} onChange={e => setShowWeekends(e.target.checked)} style={{ accentColor: '#FF6B00' }} />
              Weekends
            </label>
          </div>
        </div>

        {/* Stats strip */}
        <div style={{
          display: 'flex', gap: 32, padding: '10px 24px',
          background: 'rgba(255,107,0,0.04)',
          borderBottom: '0.5px solid rgba(255,107,0,0.12)',
          borderTop: '0.5px solid rgba(255,107,0,0.12)',
          marginBottom: '12px', flexWrap: 'wrap' as const,
        }}>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            MTM: <b style={{ fontFamily: 'var(--font-mono)', color: totalMTM >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {totalMTM >= 0 ? '+' : ''}₹{totalMTM.toLocaleString('en-IN')}
            </b>
          </span>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Trades: <b style={{ color: 'var(--text)' }}>{closedLegsAll.length}</b>
          </span>
          {dayWinRate !== null && (
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Win: <b style={{ color: dayWinRate >= 50 ? 'var(--green)' : 'var(--red)' }}>{dayWinRate}%</b>
            </span>
          )}
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            P&amp;L: <b style={{ fontFamily: 'var(--font-mono)', color: dayPnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {dayPnl >= 0 ? '+' : ''}₹{Math.abs(Math.round(dayPnl)).toLocaleString('en-IN')}
            </b>
          </span>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Open: <b style={{ color: 'var(--text)' }}>{orders.filter(g => g.legs.some(l => l.status === 'open')).length}</b>
          </span>
        </div>

      </div>{/* end fixed zone */}

      {/* ── Scroll zone ── */}
      <div className="no-scrollbar" style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ height: '6px' }} />

        {/* Holiday banner */}
        {isHolidayToday && (
          <div style={{ marginBottom: '16px', padding: '10px 14px', background: 'rgba(215,123,18,0.08)', border: '1px solid rgba(215,123,18,0.25)', borderRadius: '7px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '14px' }}>🏛</span>
            <span style={{ fontSize: '12px', color: 'var(--accent-amber)', fontWeight: 600 }}>Market Holiday</span>
            <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>— No trading scheduled for {selectedDate}</span>
          </div>
        )}

        {/* Waiting algos */}
        {filteredWaiting.length > 0 && !isHolidayToday && (
          <div style={{ marginBottom: '16px' }}>
            {filteredWaiting.map(w => {
              const isMissed = !!w.entry_time && (() => {
                const now = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false })
                return now >= w.entry_time.slice(0, 5)
              })()
              return (
                <div key={w.grid_entry_id} style={{
                  marginBottom: '6px', opacity: isMissed ? 0.4 : 0.55,
                  background: 'var(--glass-bg)', border: 'var(--glass-border)',
                  borderRadius: '7px', padding: '8px 14px', backdropFilter: 'blur(12px)',
                  display: 'flex', alignItems: 'center', gap: '12px',
                }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-dim)' }}>{w.algo_name}</span>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', background: 'var(--bg-surface)', padding: '2px 7px', borderRadius: '100px' }}>{w.account_name}</span>
                  <span style={{
                    fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '100px',
                    color: isMissed ? 'var(--accent-amber)' : '#F59E0B',
                    background: isMissed ? 'rgba(215,123,18,0.1)' : 'rgba(245,158,11,0.1)',
                    border: `1px solid ${isMissed ? 'rgba(215,123,18,0.25)' : 'rgba(245,158,11,0.25)'}`,
                  }}>{isMissed ? 'MISSED' : 'WAITING'}</span>
                  {w.entry_time && <span style={{ fontSize: '11px', color: 'var(--ox-radiant)' }}>E: {w.entry_time.slice(0, 5)}</span>}
                  {w.exit_time && <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>X: {w.exit_time.slice(0, 5)}</span>}
                  <span style={{ marginLeft: 'auto', fontSize: '10px', fontWeight: 600, color: w.is_practix ? 'var(--accent-amber)' : 'var(--ox-radiant)' }}>
                    {w.is_practix ? 'PRACTIX' : 'LIVE'}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {/* Empty state */}
        {filteredOrders.length === 0 && (
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

                    // Action button definitions
                    const BTNS = [
                      { label: 'RUN',  col: '#FF6B00', bg: 'rgba(255,107,0,0.05)',   hBg: 'rgba(255,107,0,0.14)',   disabled: !!group.terminated,                                     action: () => setModal({ type: 'run', algoIdx: gi }) },
                      { label: 'RE',   col: '#F59E0B', bg: 'rgba(245,158,11,0.05)',  hBg: 'rgba(245,158,11,0.14)',  disabled: !!group.terminated,                                     action: () => doRE(gi) },
                      { label: 'SYNC', col: '#CC4400', bg: 'rgba(204,68,0,0.05)',    hBg: 'rgba(204,68,0,0.14)',    disabled: !!group.terminated,                                     action: () => { setSyncForm({ broker_order_id: '', account_id: group.account }); setShowSync(gi) } },
                      { label: 'SQ',   col: '#22DD88', bg: 'rgba(34,221,136,0.05)',  hBg: 'rgba(34,221,136,0.14)', disabled: !!group.terminated || isClosed || openLegs(gi).length === 0, action: () => { setSqChecked({}); setModal({ type: 'sq', algoIdx: gi }) } },
                      { label: 'T',    col: '#FF4444', bg: 'rgba(255,68,68,0.05)',   hBg: 'rgba(255,68,68,0.14)',   disabled: !!group.terminated || isClosed,                         action: () => setModal({ type: 't', algoIdx: gi }) },
                    ]

                    return (
                      <div key={group.algoId} style={{ opacity: group.terminated ? 0.65 : 1, borderRadius: '10px', overflow: 'hidden', border: '0.5px solid rgba(255,255,255,0.07)' }}>

                        {/* ── Algo card header ── */}
                        <div style={{ background: 'var(--glass-bg)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', display: 'flex', alignItems: 'stretch' }}>

                          {/* Status strip */}
                          <div style={{ width: '4px', flexShrink: 0, alignSelf: 'stretch', background: bar.color, boxShadow: `0 0 8px ${bar.glow}, 0 0 20px ${bar.glow}` }}/>

                          {/* Info row */}
                          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', flexWrap: 'wrap', minWidth: 0 }}>

                            {group.terminated && <span style={{ fontSize: '13px' }} title="Algo terminated">⛔</span>}

                            {/* Algo name */}
                            <span
                              onClick={() => algosAPI.get(group.algoId).then(r => setAlgoPopup({ algoName: group.algoName, data: r.data })).catch(() => setAlgoPopup({ algoName: group.algoName, data: null }))}
                              style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '14px', color: '#F0F0FF', cursor: 'pointer', whiteSpace: 'nowrap', textDecoration: 'underline', textDecorationStyle: 'dotted', textDecorationColor: 'rgba(255,107,0,0.35)' }}>
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

                            {/* Inline status feedback */}
                            {group.inlineStatus && (
                              <span style={{ fontSize: '11px', fontWeight: 600, color: group.inlineColor, animation: 'fadeIn 0.2s ease' }}>
                                {group.inlineStatus}
                              </span>
                            )}

                            {/* Sparkline + MTM P&L (right side) */}
                            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '10px' }}>
                              {showSpark && (
                                <SmoothedSparkline algoId={group.algoId} legs={group.legs} totalPnl={totalPnl} />
                              )}
                              <span style={{
                                minWidth: '90px', textAlign: 'right',
                                fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '14px',
                                color: group.mtm !== 0 ? (group.mtm >= 0 ? 'var(--green)' : 'var(--red)') : 'transparent',
                                opacity: group.terminated ? 0.6 : 1,
                              }}>
                                {group.mtm !== 0 ? `${group.mtm >= 0 ? '+' : ''}₹${group.mtm.toLocaleString('en-IN')}` : ''}
                              </span>
                            </div>
                          </div>

                          {/* ── Tall action buttons ── */}
                          <div style={{ display: 'flex', alignSelf: 'stretch', borderLeft: '0.5px solid rgba(255,255,255,0.06)' }}>
                            {BTNS.map(btn => (
                              <button key={btn.label}
                                disabled={btn.disabled || !!loading[`${btn.label.toLowerCase()}-${gi}`]}
                                onClick={btn.action}
                                style={{
                                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                                  gap: 4, padding: '0 14px', background: btn.bg, border: 'none',
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

                        {/* ── Legs table ── */}
                        <div style={{ border: '0.5px solid rgba(255,255,255,0.07)', borderTop: 'none', borderRadius: '0 0 10px 10px', overflow: 'hidden', background: 'rgba(14,10,6,0.65)', backdropFilter: 'blur(20px)' }}>
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
                              {buildRows(group.legs).map(({ leg, isChild }) => (
                                <LegRow key={leg.id} leg={leg} isChild={isChild}
                                  liveLtp={leg.instrumentToken ? ltpMap[leg.instrumentToken] : undefined}
                                  onEditExit={(id, price) => setEditExit({ orderId: id, value: String(price) })}
                                />
                              ))}
                            </tbody>
                          </table>
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

      {/* ── Strategy popup modal ── */}
      {algoPopup && (() => {
        const d = algoPopup.data
        const legs: any[] = Array.isArray(d?.legs) ? d.legs : []
        const hasSL = legs.some((l: any) => l.sl_value != null)
        const hasTP = legs.some((l: any) => l.tp_value != null)
        const hasSchedule = d && (d.entry_time || d.exit_time || d.entry_type || d.strategy_mode)
        const hasRisk = d && (d.mtm_sl != null || d.mtm_tp != null)
        const fmtSL = (l: any) => {
          if (l.sl_value == null) return '—'
          const unit = l.sl_type === 'pct' ? '%' : l.sl_type === 'pts' ? ' pts' : ''
          return `${l.sl_value}${unit}`
        }
        const fmtTP = (l: any) => {
          if (l.tp_value == null) return '—'
          const unit = l.tp_type === 'pct' ? '%' : l.tp_type === 'pts' ? ' pts' : ''
          return `${l.tp_value}${unit}`
        }
        return (
          <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setAlgoPopup(null) }}>
            <div className="modal-box" style={{ maxWidth: '600px', width: '95vw', display: 'flex', flexDirection: 'column', maxHeight: '85vh' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px', flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <div style={{ fontWeight: 700, fontSize: '17px' }}>{algoPopup.algoName}</div>
                  {d?.account_nickname && (
                    <span style={{ fontSize: '11px', fontWeight: 600, background: 'rgba(255,107,0,0.12)', color: 'var(--ox-radiant)', border: '0.5px solid rgba(255,107,0,0.35)', padding: '2px 9px', borderRadius: '20px' }}>
                      {d.account_nickname}
                    </span>
                  )}
                </div>
                <button onClick={() => setAlgoPopup(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: '20px', lineHeight: 1, flexShrink: 0 }}>×</button>
              </div>

              {!d ? (
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', padding: '24px 0' }}>Failed to load strategy details</div>
              ) : (
                <div className="no-scrollbar" style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {hasSchedule && (
                    <div>
                      <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>Schedule</div>
                      <div style={{ background: 'var(--bg-secondary)', borderRadius: '6px', padding: '10px 14px', display: 'flex', flexWrap: 'wrap', gap: '18px' }}>
                        {d.entry_type && <div><div style={{ fontSize: '10px', color: 'var(--text-dim)', marginBottom: '2px' }}>Entry Type</div><div style={{ fontSize: '12px', fontWeight: 600 }}>{d.entry_type}</div></div>}
                        {d.strategy_mode && <div><div style={{ fontSize: '10px', color: 'var(--text-dim)', marginBottom: '2px' }}>Strategy</div><div style={{ fontSize: '12px', fontWeight: 600, textTransform: 'capitalize' }}>{d.strategy_mode}</div></div>}
                        {d.entry_time && <div><div style={{ fontSize: '10px', color: 'var(--text-dim)', marginBottom: '2px' }}>Entry</div><div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--indigo)' }}>{d.entry_time}</div></div>}
                        {d.exit_time && <div><div style={{ fontSize: '10px', color: 'var(--text-dim)', marginBottom: '2px' }}>Exit</div><div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>{d.exit_time}</div></div>}
                        {d.next_day_exit_time && <div><div style={{ fontSize: '10px', color: 'var(--text-dim)', marginBottom: '2px' }}>Next Day Exit</div><div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>{d.next_day_exit_time}</div></div>}
                      </div>
                    </div>
                  )}
                  {hasRisk && (
                    <div>
                      <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>Risk</div>
                      <div style={{ background: 'var(--bg-secondary)', borderRadius: '6px', padding: '10px 14px', display: 'flex', gap: '24px' }}>
                        {d.mtm_sl != null && <div><div style={{ fontSize: '10px', color: 'var(--text-dim)', marginBottom: '2px' }}>MTM Stop Loss</div><div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--red)' }}>₹{Math.abs(d.mtm_sl).toLocaleString('en-IN')}</div></div>}
                        {d.mtm_tp != null && <div><div style={{ fontSize: '10px', color: 'var(--text-dim)', marginBottom: '2px' }}>MTM Target</div><div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--green)' }}>₹{d.mtm_tp.toLocaleString('en-IN')}</div></div>}
                      </div>
                    </div>
                  )}
                  {legs.length > 0 && (
                    <div>
                      <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>Legs ({legs.length})</div>
                      <div style={{ border: '1px solid var(--bg-border)', borderRadius: '6px', overflow: 'hidden' }}>
                        <table className="staax-table" style={{ width: '100%' }}>
                          <thead>
                            <tr>
                              <th>#</th><th>Underlying</th><th>Dir</th><th>Expiry</th><th>Strike</th><th>Lots</th>
                              {hasSL && <th>SL</th>}
                              {hasTP && <th>TP</th>}
                            </tr>
                          </thead>
                          <tbody>
                            {legs.map((leg: any, i: number) => (
                              <tr key={i}>
                                <td style={{ fontSize: '11px', color: 'var(--text-dim)' }}>{leg.leg_number ?? i + 1}</td>
                                <td style={{ fontSize: '11px', fontWeight: 600 }}>{leg.underlying || '—'}</td>
                                <td style={{ fontSize: '11px', fontWeight: 700, color: (leg.direction || '').toUpperCase() === 'BUY' ? 'var(--green)' : 'var(--red)' }}>{(leg.direction || '').toUpperCase() || '—'}</td>
                                <td style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{leg.expiry || '—'}</td>
                                <td style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{leg.strike_type || '—'}</td>
                                <td style={{ fontSize: '11px' }}>{leg.lots ?? '—'}</td>
                                {hasSL && <td style={{ fontSize: '11px', color: 'var(--amber)' }}>{fmtSL(leg)}</td>}
                                {hasTP && <td style={{ fontSize: '11px', color: 'var(--green)' }}>{fmtTP(leg)}</td>}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
                <button className="btn btn-ghost" onClick={() => setAlgoPopup(null)}>Close</button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Confirm Modal ── */}
      {modal && (() => {
        const mc = getModalContent()
        if (!mc) return null
        return (
          <ConfirmModal title={mc.title} desc={mc.desc} confirmLabel={mc.confirmLabel}
            confirmColor={mc.confirmColor} onCancel={() => setModal(null)} onConfirm={doConfirm}>
            {mc.children}
          </ConfirmModal>
        )
      })()}

    </div>
  )
}
