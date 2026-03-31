import { useStore } from '@/store'
import { useState, useEffect } from 'react'
import { algosAPI, ordersAPI, openPositionsAPI, holidaysAPI } from '@/services/api'

const ALL_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI']

// IST time formatters — all timestamps from backend are UTC ISO strings
const fmtIST = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}
type LegStatus = 'open' | 'closed' | 'error' | 'pending'
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
  isLive?: boolean   // F3 — true after 09:15 AM activation
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

// Demo data — replaced by API data when available

const STATUS_STYLE: Record<LegStatus, { color: string; bg: string }> = {
  open:    { color: '#22C55E', bg: 'rgba(34,197,94,0.12)'   },
  closed:  { color: '#6B7280', bg: 'rgba(107,114,128,0.12)' },
  error:   { color: '#EF4444', bg: 'rgba(239,68,68,0.12)'   },
  pending: { color: '#F59E0B', bg: 'rgba(245,158,11,0.12)'  },
}
const COLS = ['36px','66px','174px','66px','140px','54px','76px','58px','88px','62px','82px']
const HDRS = ['#','Status','Symbol','Lots','Fill / Ref','LTP','SL (A/O)','Target','Exit','Reason','P&L']

function LegRow({ leg, isChild, liveLtp, onEditExit }: { leg: Leg; isChild: boolean; liveLtp?: number; onEditExit?: (orderId: string, price: number) => void }) {
  const st  = STATUS_STYLE[leg.status]
  const ltp = liveLtp ?? leg.ltp  // prefer live WebSocket value
  return (
    <>
    <tr style={{ background: isChild ? 'rgba(0,176,240,0.025)' : undefined, boxShadow: leg.status === 'error' ? 'inset 3px 0 0 #EF4444' : undefined }}>
      <td style={{ paddingLeft: isChild ? '16px' : '10px', width: COLS[0] }}>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: isChild ? 600 : 400 }}>{leg.journeyLevel}</span>
      </td>
      <td style={{ width: COLS[1] }}><span className="tag" style={{ color: st.color, background: st.bg, fontSize: '10px' }}>{leg.status.toUpperCase()}</span></td>
      <td style={{ width: COLS[2] }}>
        <div style={{ fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{leg.symbol}</div>
        <div style={{ fontSize: '10px', color: leg.dir === 'BUY' ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{leg.dir}</div>
      </td>
      <td style={{ width: COLS[3], color: 'var(--text-muted)', fontSize: '11px' }}>{leg.lots}</td>
      <td style={{ width: COLS[4], fontSize: '11px' }}>
        {leg.fillPrice != null
          ? <div style={{ fontWeight: 600 }}>Fill: {leg.fillPrice}{leg.fillTime && <span style={{ fontWeight: 400, color: 'var(--text-dim)', marginLeft: '5px', fontSize: '10px' }}>{leg.fillTime}</span>}</div>
          : <div style={{ color: 'var(--text-dim)' }}>Fill: —</div>}
        {leg.refPrice != null && <div style={{ color: 'var(--text-muted)', fontSize: '10px' }}>Ref: {leg.refPrice} · {leg.entryCondition}</div>}
        {leg.refPrice == null && leg.entryCondition && <div style={{ color: 'var(--text-muted)', fontSize: '10px' }}>{leg.entryCondition}</div>}
      </td>
      <td style={{ width: COLS[5], fontWeight: 600, color: ltp != null && leg.fillPrice != null ? (ltp > leg.fillPrice ? 'var(--green)' : 'var(--red)') : 'var(--text-muted)' }}>{ltp != null ? ltp.toFixed(2) : '—'}</td>
      <td style={{ width: COLS[6], fontSize: '11px' }}>
        {(() => {
          const slPrice = leg.fillPrice != null && leg.slOrig != null
            ? leg.fillPrice * (1 - (leg.dir === 'BUY' ? 1 : -1) * leg.slOrig / 100)
            : null
          // Only show O:/A: format when TSL has actually moved the stop by >1pt
          const hasTSL = leg.slActual != null && slPrice != null && Math.abs(leg.slActual - slPrice) > 1.0
          if (hasTSL && slPrice != null) {
            return <div style={{ color: 'var(--text-muted)' }}>O:{slPrice.toFixed(0)} A:<span style={{ color: 'var(--amber)' }}>{leg.slActual!.toFixed(0)}</span> ({leg.slOrig}%)</div>
          }
          if (slPrice != null) {
            return <div style={{ color: 'var(--text-muted)' }}>{slPrice.toFixed(0)} ({leg.slOrig}%)</div>
          }
          if (leg.slOrig != null) {
            return <div style={{ color: 'var(--text-muted)' }}>{leg.slOrig}%</div>
          }
          return <>—</>
        })()}
      </td>
      <td style={{ width: COLS[7], color: 'var(--text-muted)' }}>{leg.target ?? '—'}</td>
      <td style={{ width: COLS[8], fontSize: '11px' }}>
        {leg.exitPrice != null
          ? <div style={{ cursor: 'pointer' }} title="Click to correct exit price" onClick={() => leg.exitPrice != null && onEditExit && onEditExit(leg.id, leg.exitPrice)}>
              <div style={{ fontWeight: 600, borderBottom: '1px dashed var(--text-dim)' }}>{leg.exitPrice}</div>
              {leg.status === 'closed' && leg.exitTime && <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{leg.exitTime}</div>}
            </div>
          : '—'}
      </td>
      <td style={{ width: COLS[9] }}>
        {leg.exitReason
          ? <span className="tag" style={{ color: 'var(--red)', background: 'rgba(239,68,68,0.1)', fontSize: '10px' }}>
              {leg.exitReason === 'auto_sq' ? 'Exit Time' : leg.exitReason}
            </span>
          : '—'}
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

interface ModalProps { title: string; desc: string; confirmLabel: string; confirmColor: string; children?: React.ReactNode; onConfirm: () => void; onCancel: () => void }
function ConfirmModal({ title, desc, confirmLabel, confirmColor, children, onConfirm, onCancel }: ModalProps) {
  return (
    <div className="modal-overlay">
      <div className="modal-box">
        <div style={{ fontWeight: 700, fontSize: '16px', marginBottom: '8px' }}>{title}</div>
        <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: 'var(--card-gap)', lineHeight: 1.5 }}>{desc}</div>
        {children}
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn" style={{ background: confirmColor, color: '#fff' }} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

function setInlineStatus(setOrders: any, idx: number, msg: string, color: string, ms = 3000) {
  setOrders((o: AlgoGroup[]) => o.map((g, i) => i === idx ? { ...g, inlineStatus: msg, inlineColor: color } : g))
  setTimeout(() => setOrders((o: AlgoGroup[]) => o.map((g, i) => i === idx ? { ...g, inlineStatus: undefined, inlineColor: undefined } : g)), ms)
}

const STRATEGY_LABEL: Record<string, { label: string; color: string }> = {
  intraday:   { label: 'Intraday',   color: '#6B7280' },
  btst:       { label: 'BTST',       color: '#00B0F0' },
  stbt:       { label: 'STBT',       color: '#A78BFA' },
  positional: { label: 'Positional', color: '#F59E0B' },
}

/** Returns today's day abbreviation e.g. "MON" in IST */
function todayDay(): string {
  return new Date().toLocaleDateString('en-US', { weekday: 'short', timeZone: 'Asia/Kolkata' }).toUpperCase().slice(0, 3)
}

/** Returns ISO date string for each day of the current week (IST Monday-based) */
function getWeekDates(): Record<string, string> {
  const now    = new Date()
  const ist    = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const dow    = ist.getDay()
  const monday = new Date(ist)
  monday.setDate(ist.getDate() - (dow === 0 ? 6 : dow - 1))
  const names  = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
  const map: Record<string, string> = {}
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    map[names[i]] = d.toISOString().slice(0, 10)
  }
  return map
}

export default function OrdersPage() {
  const isPractixMode = useStore(s => s.isPractixMode)
  const activeAccount = useStore(s => s.activeAccount)
  const storeAccounts = useStore(s => s.accounts)
  const weekDates = getWeekDates()
  const [orders, setOrders]           = useState<AlgoGroup[]>([])
  const [waitingAlgos, setWaitingAlgos] = useState<WaitingAlgo[]>([])
  const [activeDay, setActiveDay]     = useState(todayDay())
  const [showWeekends, setShowWeekends] = useState(() => localStorage.getItem('orders_show_weekends') === 'true')
  const [sortBy, setSortBy]             = useState(() => localStorage.getItem('staax_orders_sort') || 'date_desc')
  const [ltpMap, setLtpMap]             = useState<Record<number, number>>({})
  const [modal, setModal]             = useState<{ type: 'run' | 'sq' | 't'; algoIdx: number } | null>(null)
  const [sqChecked, setSqChecked]     = useState<Record<string, boolean>>({})
  const [loading, setLoading]         = useState<Record<string, boolean>>({})
  const [showSync, setShowSync]       = useState<number | null>(null)   // algoIdx
  const [syncForm, setSyncForm]       = useState({ broker_order_id: '', account_id: '' })
  const [syncLoading, setSyncLoading] = useState(false)
  const [editExit, setEditExit]       = useState<{ orderId: string; value: string } | null>(null)
  const [exitSaving, setExitSaving]   = useState(false)
  const [algoPopup, setAlgoPopup]     = useState<{ algoName: string; data: any } | null>(null)
  const [openPositions, setOpenPositions] = useState<OpenPosition[]>([])
  const [holidayDates, setHolidayDates] = useState<Set<string>>(new Set())

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

  // Load orders + waiting algos from API — re-fetch when day tab changes
  useEffect(() => {
    const tradingDate = weekDates[activeDay] || new Date().toISOString().slice(0, 10)
    ordersAPI.list(tradingDate, isPractixMode)
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
            id:             o.id,
            journeyLevel:   o.journey_level || '1',
            status:         (o.status ?? 'pending') as LegStatus,
            symbol:         o.symbol || '',
            dir:            ((o.direction || 'buy').toUpperCase()) as 'BUY' | 'SELL',
            lots:           String(o.lots ?? ''),
            entryCondition:  o.entry_type || '',
            instrumentToken: o.instrument_token ?? undefined,
            errorMessage:    o.error_message ?? undefined,
            fillPrice:       o.fill_price ?? undefined,
            fillTime:        o.fill_time ? fmtIST(o.fill_time) : undefined,
            ltp:             o.ltp ?? undefined,
            slOrig:         o.sl_original ?? undefined,
            slActual:       o.sl_actual ?? undefined,
            target:         o.target ?? undefined,
            exitPrice:      o.exit_price ?? undefined,
            exitTime:       o.exit_time ? fmtIST(o.exit_time) : undefined,
            exitReason:     o.exit_reason ?? undefined,
            pnl:            o.pnl ?? undefined,
          })),
        })))
      })
      .catch(() => {}) // keep demo data if API unreachable

    ordersAPI.waiting(tradingDate, isPractixMode)
      .then(res => setWaitingAlgos(res.data?.waiting || []))
      .catch(() => {})
  }, [activeDay, isPractixMode])  // eslint-disable-line react-hooks/exhaustive-deps

  // Live LTP via WebSocket — updates leg LTP cells in real time
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
        ws.onclose = () => {
          retryTimeout = setTimeout(connect, retryDelay)
          retryDelay = Math.min(retryDelay * 1.5, 15000)
        }
        ws.onerror = () => ws?.close()
      } catch {
        retryTimeout = setTimeout(connect, retryDelay)
      }
    }
    connect()
    return () => {
      if (retryTimeout) clearTimeout(retryTimeout)
      ws?.close()
    }
  }, [])

  const visibleDays = showWeekends
    ? [...ALL_DAYS, 'SAT', 'SUN']
    : ALL_DAYS

  const safeOrders = Array.isArray(orders) ? orders : []
  const totalMTM = safeOrders.filter(g => !g.terminated).reduce((s, g) => s + g.mtm, 0)
  const buildRows = (legs: Leg[]) => {
    const r: { leg: Leg; isChild: boolean }[] = []
    for (const p of (legs || []).filter(l => !l.parentId)) {
      r.push({ leg: p, isChild: false })
      for (const c of (legs || []).filter(l => l.parentId === p.id)) r.push({ leg: c, isChild: true })
    }
    return r
  }
  const openLegs = (idx: number) => (orders[idx]?.legs || []).filter(l => l.status === 'open')

  // ── Actions wired to API ──────────────────────────────────────────────────

  const doRun = async (idx: number) => {
    const algoId = orders[idx].algoId
    setLoading(l => ({ ...l, [`run-${idx}`]: true }))
    setInlineStatus(setOrders, idx, '▶ Executing...', 'var(--accent-blue)')
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
    const algoId  = orders[idx].algoId
    const selected = Object.keys(sqChecked).filter(k => sqChecked[k])
    if (selected.length === 0) { setModal(null); return }
    setLoading(l => ({ ...l, [`sq-${idx}`]: true }))
    try {
      await algosAPI.sq(algoId, selected)
      // Optimistically update leg statuses
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
    if (type === 'run') return { title: `Execute ${name}?`, desc: `Execute ${name} immediately with the configured entry strategy.`, confirmLabel: 'Execute', confirmColor: 'var(--accent-blue)', children: undefined }
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
    if (!syncForm.broker_order_id.trim()) {
      alert('Broker Order ID is required')
      return
    }
    if (!syncForm.account_id) {
      alert('Please select an account')
      return
    }
    const ids = syncForm.broker_order_id.split(',').map(s => s.trim()).filter(Boolean)
    setSyncLoading(true)
    let succeeded = 0, failed = 0
    for (const id of ids) {
      try {
        await ordersAPI.syncOrder(algoId, { broker_order_id: id, account_id: syncForm.account_id })
        succeeded++
      } catch {
        failed++
      }
    }
    setSyncLoading(false)
    setShowSync(null)
    setSyncForm({ broker_order_id: '', account_id: '' })
    const msg = failed === 0
      ? `✅ ${succeeded} order${succeeded > 1 ? 's' : ''} synced`
      : `⚠️ ${succeeded} synced, ${failed} failed`
    setInlineStatus(setOrders, algoIdx, msg, failed === 0 ? 'var(--green)' : 'var(--amber)', 5000)
  }

  const doCorrectExit = async () => {
    if (!editExit) return
    const price = parseFloat(editExit.value)
    if (isNaN(price) || price <= 0) return
    setExitSaving(true)
    try {
      await ordersAPI.correctExitPrice(editExit.orderId, price)
      setEditExit(null)
    } catch {
      alert('Failed to save exit price')
    } finally {
      setExitSaving(false)
    }
  }

  // Filter by active account — match group.account (nickname) to the selected account
  const activeAccountNickname = activeAccount
    ? (storeAccounts as any[]).find((a: any) => String(a.id) === activeAccount)?.nickname ?? null
    : null
  const filteredOrders = activeAccountNickname
    ? orders.filter(g => g.account === activeAccountNickname)
    : orders
  const filteredWaiting = activeAccountNickname
    ? waitingAlgos.filter(w => w.account_name === activeAccountNickname)
    : waitingAlgos
  const sortedOrders = [...filteredOrders].sort((a, b) => {
    if (sortBy === 'name_asc')  return a.algoName.localeCompare(b.algoName)
    if (sortBy === 'name_desc') return b.algoName.localeCompare(a.algoName)
    if (sortBy === 'account')   return a.account.localeCompare(b.account)
    return 0  // date_desc = API order
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 92px)' }}>
      {/* Fixed zone: page header + day tabs — never scrolls */}
      <div style={{ flexShrink: 0 }}>
      <div className="page-header">
        <div>
          <h1 style={{ fontFamily: "'ADLaM Display',serif", fontSize: '22px', fontWeight: 400 }}>Orders</h1>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px', display:'flex', alignItems:'center', gap:'6px' }}>Trade history · P&L by week ·{' '}
            <span style={{fontSize:'10px',fontWeight:700,padding:'2px 6px',borderRadius:'4px',background:isPractixMode?'rgba(215,123,18,0.15)':'rgba(34,197,94,0.12)',color:isPractixMode?'var(--accent-amber)':'var(--green)',border:isPractixMode?'1px solid rgba(215,123,18,0.3)':'1px solid rgba(34,197,94,0.25)'}}>
              {isPractixMode?'PRACTIX':'LIVE'}
            </span>
          </p>
        </div>
        <div className="page-header-actions">
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={showWeekends} onChange={e => { setShowWeekends(e.target.checked); localStorage.setItem('orders_show_weekends', String(e.target.checked)) }} style={{ accentColor: 'var(--accent-blue)' }} />
            Show Weekends
          </label>
          <select value={sortBy} onChange={e => { setSortBy(e.target.value); localStorage.setItem('staax_orders_sort', e.target.value) }}
            className="staax-select" style={{ width: '130px' }}>
            <option value="date_desc">Date Created</option>
            <option value="name_asc">Name A → Z</option>
            <option value="name_desc">Name Z → A</option>
            <option value="account">Account</option>
          </select>
        </div>
      </div>

      {/* Open Positions Panel */}
      {openPositions.length > 0 && (
        <div style={{ padding: '10px 0 20px' }}>
          <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px', paddingLeft: '2px' }}>
            Open Positions · {openPositions.length}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {openPositions.map(pos => {
              const strat = STRATEGY_LABEL[pos.strategy_mode] || { label: pos.strategy_mode, color: '#6B7280' }
              const pnlColor = pos.pnl >= 0 ? 'var(--green)' : 'var(--red)'
              return (
                <div key={pos.algo_id}
                  onClick={() => setActiveDay(pos.day_of_week.slice(0,3))}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    background: 'var(--bg-secondary)', border: '1px solid var(--bg-border)',
                    borderRadius: '8px', padding: '6px 12px', cursor: 'pointer',
                    transition: 'border-color 0.15s', minWidth: 0,
                  }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent-blue)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--bg-border)'}
                >
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{pos.entry_date}</span>
                  <span style={{ fontSize: '9px', fontWeight: 700, padding: '1px 6px', borderRadius: '4px', background: `${strat.color}18`, color: strat.color, border: `1px solid ${strat.color}40`, whiteSpace: 'nowrap' }}>{strat.label}</span>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap' }}>{pos.algo_name}</span>
                  <span style={{ fontSize: '10px', color: 'var(--text-dim)', background: 'var(--bg-surface)', padding: '1px 6px', borderRadius: '3px', border: '1px solid var(--bg-border)', whiteSpace: 'nowrap' }}>{pos.account}</span>
                  {pos.open_count > 0 && <span style={{ fontSize: '10px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{pos.open_count} open</span>}
                  {pos.pnl !== 0 && <span style={{ fontSize: '11px', fontWeight: 700, color: pnlColor, whiteSpace: 'nowrap' }}>{pos.pnl >= 0 ? '+' : ''}₹{Math.abs(pos.pnl).toLocaleString('en-IN')}</span>}
                  <span style={{ fontSize: '10px', color: 'var(--accent-blue)', fontWeight: 700, whiteSpace: 'nowrap' }}>→ {pos.day_of_week.slice(0,3)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Trading Day header + MTM */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 2px 6px' }}>
        <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Trading Day</span>
        <span style={{ fontSize: '10px', fontWeight: 700, color: totalMTM >= 0 ? 'var(--green)' : 'var(--red)' }}>
          MTM: {totalMTM >= 0 ? '+' : ''}₹{totalMTM.toLocaleString('en-IN')}
        </span>
      </div>

      {/* Day tabs — full width, equal spacing, P&L per day */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--bg-border)', background: 'var(--bg-primary)' }}>
        {visibleDays.map(d => {
          const isWeekend  = d === 'SAT' || d === 'SUN'
          const isToday    = d === todayDay()
          const isSelected = activeDay === d
          const isHoliday  = !!weekDates[d] && holidayDates.has(weekDates[d])
          const pnl: number | null = null
          return (
            <button key={d} onClick={() => setActiveDay(d)} style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: '2px', padding: '8px 4px', fontSize: '12px', fontWeight: 600,
              border: 'none', cursor: 'pointer',
              background: isSelected ? 'var(--bg-surface)' : 'transparent',
              color: isSelected ? 'var(--accent-blue)' : isWeekend || isHoliday ? 'var(--text-dim)' : 'var(--text-muted)',
              borderBottom: isSelected ? '2px solid var(--accent-blue)' : '2px solid transparent',
              transition: 'all 0.12s',
              opacity: isHoliday && !isSelected ? 0.55 : 1,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span>{d}</span>
                {isToday && !isHoliday && (
                  <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'var(--accent-blue)', flexShrink: 0 }} />
                )}
                {isHoliday && (
                  <span style={{ fontSize: '9px', color: 'var(--accent-amber)' }} title="Market holiday">🏛</span>
                )}
              </div>
              {pnl != null && (
                <span style={{ fontSize: '10px', fontWeight: 700, color: pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {pnl >= 0 ? '+' : ''}{(pnl / 1000).toFixed(1)}k
                </span>
              )}
            </button>
          )
        })}
      </div>
      </div>{/* end fixed zone */}

      {/* Scroll zone: waiting algos + all order groups */}
      <div className="no-scrollbar" style={{ flex: 1, overflow: 'auto' }}>
      <div style={{ height: '14px' }} />
      {!!weekDates[activeDay] && holidayDates.has(weekDates[activeDay]) && (
        <div style={{ marginBottom: '16px', padding: '10px 14px', background: 'rgba(215,123,18,0.08)', border: '1px solid rgba(215,123,18,0.25)', borderRadius: '7px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '14px' }}>🏛</span>
          <span style={{ fontSize: '12px', color: 'var(--accent-amber)', fontWeight: 600 }}>Market Holiday</span>
          <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>— No trading scheduled for {weekDates[activeDay]}</span>
        </div>
      )}
      {filteredWaiting.length > 0 && !holidayDates.has(weekDates[activeDay] || '') && (
        <div style={{ marginBottom: '16px' }}>
          {filteredWaiting.map(w => {
            // Determine if entry time has passed on today's tab
            const isToday = activeDay === todayDay()
            const isMissed = isToday && !!w.entry_time && (() => {
              const now = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false })
              return now >= w.entry_time.slice(0, 5)
            })()
            return (
            <div key={w.grid_entry_id} style={{
              marginBottom: '6px', opacity: isMissed ? 0.4 : 0.55,
              background: 'var(--bg-secondary)', border: '1px solid var(--bg-border)',
              borderRadius: '7px', padding: '8px 14px',
              display: 'flex', alignItems: 'center', gap: '12px',
            }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-dim)' }}>
                {w.algo_name}
              </span>
              <span style={{
                fontSize: '10px', color: 'var(--text-muted)',
                background: 'var(--bg-surface)', padding: '2px 7px', borderRadius: '4px',
              }}>{w.account_name}</span>
              <span style={{
                fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '4px',
                color: isMissed ? 'var(--accent-amber)' : '#F59E0B',
                background: isMissed ? 'rgba(215,123,18,0.1)' : 'rgba(245,158,11,0.1)',
                border: `1px solid ${isMissed ? 'rgba(215,123,18,0.25)' : 'rgba(245,158,11,0.25)'}`,
              }}>{isMissed ? 'MISSED' : 'WAITING'}</span>
              {w.entry_time && (
                <span style={{ fontSize: '11px', color: 'var(--accent-blue)' }}>
                  E: {w.entry_time.slice(0, 5)}
                </span>
              )}
              {w.exit_time && (
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  X: {w.exit_time.slice(0, 5)}
                </span>
              )}
              <span style={{
                marginLeft: 'auto', fontSize: '10px', fontWeight: 600,
                color: w.is_practix ? 'var(--accent-amber)' : 'var(--accent-blue)',
              }}>{w.is_practix ? 'PRACTIX' : 'LIVE'}</span>
            </div>
            )
          })}
        </div>
      )}

      {/* Day summary bar */}
      {(() => {
        const closedLegs = sortedOrders.flatMap(g => g.legs.filter(l => l.status === 'closed' && l.pnl != null))
        if (closedLegs.length === 0) return null
        const dayPnl = closedLegs.reduce((s, l) => s + (l.pnl ?? 0), 0)
        const dayWins = closedLegs.filter(l => (l.pnl ?? 0) > 0).length
        const dayWinRate = Math.round(dayWins / closedLegs.length * 100)
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '6px 12px', marginBottom: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--bg-border)', borderRadius: '6px', fontSize: '11px' }}>
            <span style={{ color: 'var(--text-dim)', fontWeight: 600 }}>{closedLegs.length} trade{closedLegs.length !== 1 ? 's' : ''}</span>
            <span style={{ color: 'var(--text-dim)' }}>·</span>
            <span style={{ fontWeight: 700, color: dayPnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {dayPnl >= 0 ? '+' : ''}₹{Math.abs(Math.round(dayPnl)).toLocaleString('en-IN')}
            </span>
            <span style={{ color: 'var(--text-dim)' }}>·</span>
            <span style={{ color: dayWinRate >= 50 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{dayWinRate}% win</span>
          </div>
        )
      })()}

      {/* Algo groups */}
      {sortedOrders.map((group, gi) => (
        <div key={gi} style={{ marginBottom: '12px', opacity: group.terminated ? 0.65 : 1 }}>
          <div style={{
            background: 'var(--bg-secondary)', border: '1px solid var(--bg-border)',
            borderRadius: '7px 7px 0 0', padding: '8px 12px',
            display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
          }}>
            {/* Terminated icon */}
            {group.terminated && (
              <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
                onMouseEnter={e => { const t = e.currentTarget.querySelector<HTMLElement>('[data-tt]'); if (t) t.style.opacity = '1' }}
                onMouseLeave={e => { const t = e.currentTarget.querySelector<HTMLElement>('[data-tt]'); if (t) t.style.opacity = '0' }}>
                <span style={{ fontSize: '14px', cursor: 'default' }}>⛔</span>
                <span data-tt="" style={{ position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)', background: '#1E2022', color: '#E5E7EB', fontSize: '10px', fontWeight: 600, padding: '4px 8px', borderRadius: '4px', border: '1px solid #3F4143', whiteSpace: 'nowrap', pointerEvents: 'none', opacity: 0, transition: 'opacity 0.15s', zIndex: 50 }}>
                  Algo terminated
                </span>
              </span>
            )}

            {/* F3 — green live dot */}
            {group.isLive && !group.terminated && (
              <span title="Algo is live" style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--green)', boxShadow: '0 0 6px var(--green)', flexShrink: 0 }} />
            )}

            {/* Error badge — one or more legs failed */}
            {!group.terminated && group.legs.some(l => l.status === 'error') && (() => {
              const errLegs  = group.legs.filter(l => l.status === 'error')
              const errCount = errLegs.length
              const firstMsg = errLegs[0]?.errorMessage
              const shortMsg = firstMsg ? ` — ${firstMsg.length > 40 ? firstMsg.slice(0, 40) + '…' : firstMsg}` : ''
              return (
                <span title={firstMsg || undefined} style={{ fontSize: '10px', fontWeight: 700, color: '#EF4444', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', padding: '2px 8px', borderRadius: '4px', cursor: firstMsg ? 'help' : 'default' }}>
                  ⚠ {errCount} LEG{errCount > 1 ? 'S' : ''} FAILED{shortMsg}
                </span>
              )
            })()}

            <span
              onClick={() => algosAPI.get(group.algoId).then(r => setAlgoPopup({ algoName: group.algoName, data: r.data })).catch(() => setAlgoPopup({ algoName: group.algoName, data: null }))}
              style={{ fontWeight: 700, fontSize: '14px', color: group.terminated ? 'var(--text-dim)' : 'var(--accent-blue)',
                cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted', textDecorationColor: 'rgba(0,176,240,0.4)' }}>
              {group.algoName}
            </span>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', background: 'var(--bg-surface)', padding: '2px 7px', borderRadius: '4px' }}>{group.account}</span>

            {!group.terminated && !!(group.mtmSL || group.mtmTP) && (
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                {group.mtmSL !== 0 && <>SL: <span style={{ color: 'var(--red)' }}>₹{Math.abs(group.mtmSL).toLocaleString('en-IN')}</span></>}
                {group.mtmSL !== 0 && group.mtmTP !== 0 && <>&nbsp;·&nbsp;</>}
                {group.mtmTP !== 0 && <>TP: <span style={{ color: 'var(--green)' }}>₹{group.mtmTP.toLocaleString('en-IN')}</span></>}
              </span>
            )}

            {group.inlineStatus && (
              <span style={{ fontSize: '11px', fontWeight: 600, color: group.inlineColor, animation: 'fadeIn 0.2s ease' }}>
                {group.inlineStatus}
              </span>
            )}

            {/* Action buttons */}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '5px', alignItems: 'center' }}>
              {[
                { label: 'RUN', color: '#00B0F0', action: () => setModal({ type: 'run', algoIdx: gi }), disabled: group.terminated },
                { label: 'RE',  color: '#F59E0B', action: () => doRE(gi),                               disabled: group.terminated },
              { label: 'SYNC', color: '#A78BFA', action: () => { setSyncForm({ broker_order_id: '', account_id: group.account }); setShowSync(gi) }, disabled: group.terminated },
                { label: 'SQ',  color: '#22C55E', action: () => { setSqChecked({}); setModal({ type: 'sq', algoIdx: gi }) }, disabled: group.terminated || openLegs(gi).length === 0 },
                { label: 'T',   color: '#EF4444', action: () => setModal({ type: 't', algoIdx: gi }),   disabled: group.terminated },
              ].map(btn => (
                <button key={btn.label} title={btn.label}
                  disabled={btn.disabled || loading[`${btn.label.toLowerCase()}-${gi}`]}
                  style={{
                    height: '26px', minWidth: '42px', padding: '0 12px', fontSize: '11px', fontWeight: 700,
                    border: `1.5px solid ${btn.color}`, background: `${btn.color}14`, color: btn.color,
                    borderRadius: '13px', cursor: btn.disabled ? 'not-allowed' : 'pointer',
                    transition: 'all 0.15s', opacity: btn.disabled ? 0.35 : 1,
                    letterSpacing: '0.04em',
                  }}
                  onMouseEnter={e => { if (!btn.disabled) { (e.currentTarget as HTMLElement).style.background = `${btn.color}28`; (e.currentTarget as HTMLElement).style.boxShadow = `0 0 8px ${btn.color}50` } }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = `${btn.color}14`; (e.currentTarget as HTMLElement).style.boxShadow = 'none' }}
                  onClick={btn.action}>
                  {btn.label}
                </button>
              ))}
              {/* P&L Sparkline — show for fully-closed groups with fill + exit prices */}
              {(() => {
                const closedLegs = group.legs.filter(l => l.status === 'closed' && l.fillPrice != null && l.exitPrice != null)
                if (closedLegs.length === 0 || group.legs.some(l => l.status === 'open' || l.status === 'pending')) return null
                // Build sparkline: one point per closed leg (entry → exit)
                const pts = closedLegs.flatMap(l => [l.fillPrice!, l.exitPrice!])
                const minP = Math.min(...pts), maxP = Math.max(...pts)
                const range = maxP - minP || 1
                const W = 60, H = 20, PAD = 2
                const toX = (i: number) => PAD + (i / (pts.length - 1)) * (W - PAD * 2)
                const toY = (v: number) => H - PAD - ((v - minP) / range) * (H - PAD * 2)
                const totalPnl = closedLegs.reduce((s, l) => s + (l.pnl ?? 0), 0)
                const lineColor = totalPnl >= 0 ? '#22C55E' : '#EF4444'
                const pathD = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ')
                return (
                  <svg width={W} height={H} style={{ flexShrink: 0, opacity: 0.9 }}>
                    <title>{`P&L: ${totalPnl >= 0 ? '+' : ''}₹${Math.abs(Math.round(totalPnl)).toLocaleString('en-IN')}`}</title>
                    <path d={pathD} fill="none" stroke={lineColor} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
                    <circle cx={toX(pts.length - 1).toFixed(1)} cy={toY(pts[pts.length - 1]).toFixed(1)} r="2.5" fill={lineColor} />
                  </svg>
                )
              })()}
              <span style={{ minWidth: '90px', textAlign: 'right', fontWeight: 700, fontSize: '14px', marginLeft: '6px', color: group.mtm !== 0 ? (group.mtm >= 0 ? 'var(--green)' : 'var(--red)') : 'transparent', opacity: group.terminated ? 0.6 : 1 }}>
                {group.mtm !== 0 ? `${group.mtm >= 0 ? '+' : ''}₹${group.mtm.toLocaleString('en-IN')}` : ''}
              </span>
            </div>
          </div>

          <div style={{ border: '1px solid var(--bg-border)', borderTop: 'none', borderRadius: '0 0 7px 7px', overflow: 'hidden' }}>
            <table className="staax-table">
              <colgroup>{COLS.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
              <thead><tr>{HDRS.map(h => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>{buildRows(group.legs).map(({ leg, isChild }) => <LegRow key={leg.id} leg={leg} isChild={isChild} liveLtp={leg.instrumentToken ? ltpMap[leg.instrumentToken] : undefined} onEditExit={(id, price) => setEditExit({ orderId: id, value: String(price) })} />)}</tbody>
            </table>
          </div>
        </div>
      ))}
      </div>{/* end scroll zone */}

      {/* SYNC Modal */}
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
              <button className="btn" style={{ background: '#A78BFA', color: '#fff' }}
                disabled={syncLoading} onClick={() => doSync(showSync)}>
                {syncLoading ? '🔄 Fetching from broker...' : '🔗 Sync Order'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Exit Price Correction Modal */}
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
              <button className="btn" style={{ background: 'var(--accent-blue)', color: '#fff' }}
                disabled={exitSaving} onClick={doCorrectExit}>
                {exitSaving ? 'Saving...' : '✅ Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Strategy popup modal — FIX 6 */}
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
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px', flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <div style={{ fontWeight: 700, fontSize: '17px' }}>{algoPopup.algoName}</div>
                  {d?.account_nickname && (
                    <span style={{ fontSize: '11px', fontWeight: 600, background: 'rgba(0,176,240,0.12)', color: 'var(--accent-blue)', border: '1px solid rgba(0,176,240,0.25)', padding: '2px 9px', borderRadius: '20px' }}>
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
                  {/* Section 1 — Schedule */}
                  {hasSchedule && (
                    <div>
                      <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>Schedule</div>
                      <div style={{ background: 'var(--bg-secondary)', borderRadius: '6px', padding: '10px 14px', display: 'flex', flexWrap: 'wrap', gap: '18px' }}>
                        {d.entry_type && (
                          <div>
                            <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginBottom: '2px' }}>Entry Type</div>
                            <div style={{ fontSize: '12px', fontWeight: 600 }}>{d.entry_type}</div>
                          </div>
                        )}
                        {d.strategy_mode && (
                          <div>
                            <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginBottom: '2px' }}>Strategy</div>
                            <div style={{ fontSize: '12px', fontWeight: 600, textTransform: 'capitalize' }}>{d.strategy_mode}</div>
                          </div>
                        )}
                        {d.entry_time && (
                          <div>
                            <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginBottom: '2px' }}>Entry</div>
                            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--accent-blue)' }}>{d.entry_time}</div>
                          </div>
                        )}
                        {d.exit_time && (
                          <div>
                            <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginBottom: '2px' }}>Exit</div>
                            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>{d.exit_time}</div>
                          </div>
                        )}
                        {d.next_day_exit_time && (
                          <div>
                            <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginBottom: '2px' }}>Next Day Exit</div>
                            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>{d.next_day_exit_time}</div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Section 2 — Risk */}
                  {hasRisk && (
                    <div>
                      <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>Risk</div>
                      <div style={{ background: 'var(--bg-secondary)', borderRadius: '6px', padding: '10px 14px', display: 'flex', gap: '24px' }}>
                        {d.mtm_sl != null && (
                          <div>
                            <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginBottom: '2px' }}>MTM Stop Loss</div>
                            <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--red)' }}>₹{Math.abs(d.mtm_sl).toLocaleString('en-IN')}</div>
                          </div>
                        )}
                        {d.mtm_tp != null && (
                          <div>
                            <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginBottom: '2px' }}>MTM Target</div>
                            <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--green)' }}>₹{d.mtm_tp.toLocaleString('en-IN')}</div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Section 3 — Legs table */}
                  {legs.length > 0 && (
                    <div>
                      <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>Legs ({legs.length})</div>
                      <div style={{ border: '1px solid var(--bg-border)', borderRadius: '6px', overflow: 'hidden' }}>
                        <table className="staax-table" style={{ width: '100%' }}>
                          <thead>
                            <tr>
                              <th>#</th>
                              <th>Underlying</th>
                              <th>Dir</th>
                              <th>Expiry</th>
                              <th>Strike</th>
                              <th>Lots</th>
                              {hasSL && <th>SL</th>}
                              {hasTP && <th>TP</th>}
                            </tr>
                          </thead>
                          <tbody>
                            {legs.map((leg: any, i: number) => (
                              <tr key={i}>
                                <td style={{ fontSize: '11px', color: 'var(--text-dim)' }}>{leg.leg_number ?? i + 1}</td>
                                <td style={{ fontSize: '11px', fontWeight: 600 }}>{leg.underlying || '—'}</td>
                                <td style={{ fontSize: '11px', fontWeight: 700, color: (leg.direction || '').toUpperCase() === 'BUY' ? 'var(--green)' : 'var(--red)' }}>
                                  {(leg.direction || '').toUpperCase() || '—'}
                                </td>
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
