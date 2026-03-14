import { useStore } from '@/store'
import { useState, useEffect } from 'react'
import { algosAPI, ordersAPI } from '@/services/api'

const ALL_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI']
const WEEKEND_ACTIVE: Record<string, number> = { SAT: 2840 }
const DAY_PNL: Record<string, number> = { MON: 4320, TUE: -800, WED: 1200, THU: 3100, FRI: 0 }

type LegStatus = 'open' | 'closed' | 'error' | 'pending'
interface Leg {
  id: string; parentId?: string; journeyLevel: string; status: LegStatus
  symbol: string; dir: 'BUY' | 'SELL'; lots: string; entryCondition: string
  refPrice?: number; fillPrice?: number; ltp?: number
  slOrig?: number; slActual?: number; target?: number
  exitPrice?: number; exitTime?: string; exitReason?: string; pnl?: number
}
interface AlgoGroup {
  algoId: string; algoName: string; account: string; mtm: number; mtmSL: number; mtmTP: number
  legs: Leg[]; inlineStatus?: string; inlineColor?: string; terminated?: boolean
  isLive?: boolean   // F3 — true after 09:15 AM activation
}

// Demo data — replaced by API data when available
const DEMO_ORDERS: AlgoGroup[] = [
  {
    algoId: '1', algoName: 'AWS-1', account: 'Karthik', mtm: 4320, mtmSL: -5000, mtmTP: 10000, isLive: true,
    legs: [
      { id: 'L1',  journeyLevel: '1',   status: 'open',   symbol: 'NIFTY 22500CE 27MAR25', dir: 'BUY',  lots: '1 (50)', entryCondition: 'ORB High', refPrice: 186.5, fillPrice: 187.0, ltp: 213.5, slOrig: 150, slActual: 175, target: 280, pnl: 1325 },
      { id: 'L1a', journeyLevel: '1.1', status: 'closed', symbol: 'NIFTY 22500CE 27MAR25', dir: 'BUY',  lots: '1 (50)', entryCondition: 'Re-entry', refPrice: 187.0, fillPrice: 188.0, slOrig: 155, target: 280, exitPrice: 120, exitTime: '10:15:22', exitReason: 'SL', pnl: -3400, parentId: 'L1' },
      { id: 'L2',  journeyLevel: '2',   status: 'open',   symbol: 'NIFTY 22500PE 27MAR25', dir: 'BUY',  lots: '1 (50)', entryCondition: 'ORB Low',  refPrice: 143.0, fillPrice: 142.5, ltp: 118.2, slOrig: 110, slActual: 110, target: 200, pnl: -1215 },
      { id: 'L3',  journeyLevel: '3',   status: 'error',  symbol: 'NIFTY 22400CE 27MAR25', dir: 'BUY',  lots: '1 (50)', entryCondition: 'Direct',   pnl: 0 },
    ],
  },
  {
    algoId: '2', algoName: 'TF-BUY', account: 'Mom', mtm: -800, mtmSL: -3000, mtmTP: 6000, isLive: true,
    legs: [
      { id: 'L4', journeyLevel: '1', status: 'open', symbol: 'BANKNIFTY 48000CE 26MAR25', dir: 'BUY', lots: '2 (30)', entryCondition: 'W&T Up 5%', refPrice: 200.0, fillPrice: 210.0, ltp: 198.5, slOrig: 180, slActual: 185, target: 280, pnl: -575 },
    ],
  },
]

const STATUS_STYLE: Record<LegStatus, { color: string; bg: string }> = {
  open:    { color: '#22C55E', bg: 'rgba(34,197,94,0.12)'   },
  closed:  { color: '#6B7280', bg: 'rgba(107,114,128,0.12)' },
  error:   { color: '#EF4444', bg: 'rgba(239,68,68,0.12)'   },
  pending: { color: '#F59E0B', bg: 'rgba(245,158,11,0.12)'  },
}
const COLS = ['36px','66px','174px','66px','116px','54px','54px','76px','58px','88px','62px','82px']
const HDRS = ['#','Status','Symbol','Lots','Entry / Ref','Fill','LTP','SL (A/O)','Target','Exit','Reason','P&L']

function LegRow({ leg, isChild, onEditExit }: { leg: Leg; isChild: boolean; onEditExit?: (orderId: string, price: number) => void }) {
  const st = STATUS_STYLE[leg.status]
  return (
    <tr style={{ background: isChild ? 'rgba(0,176,240,0.025)' : undefined }}>
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
        <div style={{ color: 'var(--text-muted)' }}>{leg.entryCondition}</div>
        {leg.refPrice != null && <div style={{ color: 'var(--text-dim)', fontSize: '10px' }}>Ref: {leg.refPrice}</div>}
      </td>
      <td style={{ width: COLS[5], fontWeight: 600 }}>{leg.fillPrice ?? '—'}</td>
      <td style={{ width: COLS[6], fontWeight: 600, color: leg.ltp != null && leg.fillPrice != null ? (leg.ltp > leg.fillPrice ? 'var(--green)' : 'var(--red)') : 'var(--text-muted)' }}>{leg.ltp ?? '—'}</td>
      <td style={{ width: COLS[7], fontSize: '11px' }}>
        {leg.slActual != null && <div style={{ color: 'var(--amber)' }}>A:{leg.slActual}</div>}
        {leg.slOrig   != null && <div style={{ color: 'var(--text-muted)' }}>O:{leg.slOrig}</div>}
        {leg.slOrig == null && '—'}
      </td>
      <td style={{ width: COLS[8], color: 'var(--text-muted)' }}>{leg.target ?? '—'}</td>
      <td style={{ width: COLS[9], fontSize: '11px' }}>
        {leg.exitPrice != null
          ? <div style={{ cursor: 'pointer' }} title="Click to correct exit price" onClick={() => leg.exitPrice != null && onEditExit && onEditExit(leg.id, leg.exitPrice)}>
              <div style={{ fontWeight: 600, borderBottom: '1px dashed var(--text-dim)' }}>{leg.exitPrice}</div>
              {leg.exitTime && <div style={{ fontSize: '10px', color: 'var(--text-dim)' }}>{leg.exitTime}</div>}
            </div>
          : '—'}
      </td>
      <td style={{ width: COLS[10] }}>
        {leg.exitReason
          ? <span className="tag" style={{ color: 'var(--red)', background: 'rgba(239,68,68,0.1)', fontSize: '10px' }}>{leg.exitReason}</span>
          : '—'}
      </td>
      <td style={{ width: COLS[11], fontWeight: 700, textAlign: 'right', color: (leg.pnl || 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
        {leg.pnl != null ? `${leg.pnl >= 0 ? '+' : ''}₹${Math.abs(leg.pnl).toLocaleString('en-IN')}` : '—'}
      </td>
    </tr>
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

/** Returns today's day abbreviation e.g. "MON" */
function todayDay(): string {
  return new Date().toLocaleDateString('en-US', { weekday: 'short', timeZone: 'Asia/Kolkata' }).toUpperCase().slice(0, 3)
}

export default function OrdersPage() {
  const isPractixMode = useStore(s => s.isPractixMode)
  const [orders, setOrders]           = useState<AlgoGroup[]>([])
  const [activeDay, setActiveDay]     = useState(todayDay())
  const [showWeekends, setShowWeekends] = useState(false)
  const [modal, setModal]             = useState<{ type: 'run' | 'sq' | 't'; algoIdx: number } | null>(null)
  const [sqChecked, setSqChecked]     = useState<Record<string, boolean>>({})
  const [loading, setLoading]         = useState<Record<string, boolean>>({})
  const [showSync, setShowSync]       = useState<number | null>(null)   // algoIdx
  const [syncForm, setSyncForm]       = useState({ broker_order_id: '', account_id: '' })
  const [syncLoading, setSyncLoading] = useState(false)
  const [editExit, setEditExit]       = useState<{ orderId: string; value: string } | null>(null)
  const [exitSaving, setExitSaving]   = useState(false)

  // Load today's orders from API
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10)
    ordersAPI.list(today)
      .then(res => {
        setOrders(res.data || [])
      })
      .catch(() => {}) // keep demo data if API unreachable
  }, [])

  const visibleDays = showWeekends
    ? [...ALL_DAYS, 'SAT', 'SUN']
    : [...ALL_DAYS, ...Object.keys(WEEKEND_ACTIVE)]

  const totalMTM = orders.filter(g => !g.terminated).reduce((s, g) => s + g.mtm, 0)
  const buildRows = (legs: Leg[]) => {
    const r: { leg: Leg; isChild: boolean }[] = []
    for (const p of legs.filter(l => !l.parentId)) {
      r.push({ leg: p, isChild: false })
      for (const c of legs.filter(l => l.parentId === p.id)) r.push({ leg: c, isChild: true })
    }
    return r
  }
  const openLegs = (idx: number) => orders[idx].legs.filter(l => l.status === 'open')

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
        legs: g.legs.map(l => selected.includes(l.id)
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
        legs: g.legs.map(l => l.status === 'open'
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

  return (
    <div>
      <div className="page-header">
        <h1 style={{ fontFamily: "'ADLaM Display',serif", fontSize: '22px', fontWeight: 400 }}>Orders</h1>
        <div className="page-header-actions">
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={showWeekends} onChange={e => setShowWeekends(e.target.checked)} style={{ accentColor: 'var(--accent-blue)' }} />
            Show Weekends
          </label>
        </div>
      </div>

      {/* Day tabs — F4: today highlighted with dot marker */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '2px', marginBottom: '18px', borderBottom: '1px solid var(--bg-border)' }}>
        {visibleDays.map(d => {
          const isWeekend  = d === 'SAT' || d === 'SUN'
          const isToday    = d === todayDay()        // F4 — active day marker
          const isSelected = activeDay === d
          const pnl = isWeekend ? WEEKEND_ACTIVE[d] : DAY_PNL[d]
          return (
            <button key={d} onClick={() => setActiveDay(d)} style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              padding: '8px 12px', fontSize: '12px', fontWeight: 600,
              border: 'none', cursor: 'pointer', borderRadius: '5px 5px 0 0',
              background: isSelected ? 'var(--bg-surface)' : 'transparent',
              color: isSelected ? 'var(--accent-blue)' : isWeekend ? 'var(--text-dim)' : 'var(--text-muted)',
              borderBottom: isSelected ? '2px solid var(--accent-blue)' : '2px solid transparent',
              position: 'relative',
            }}>
              <span>{d}</span>
              {/* F4 — today dot */}
              {isToday && (
                <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'var(--accent-blue)', flexShrink: 0 }} />
              )}
              {pnl != null && (
                <span style={{ fontSize: '10px', fontWeight: 700, color: pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {pnl >= 0 ? '+' : ''}{(pnl / 1000).toFixed(1)}k
                </span>
              )}
            </button>
          )
        })}
        {/* Total MTM */}
        <div style={{ marginLeft: 'auto', paddingBottom: '2px', paddingRight: '4px' }}>
          <span style={{
            fontSize: '12px', fontWeight: 700, padding: '4px 10px', borderRadius: '5px',
            color: totalMTM >= 0 ? 'var(--green)' : 'var(--red)',
            background: totalMTM >= 0 ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
            border: `1px solid ${totalMTM >= 0 ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
          }}>
            MTM: {totalMTM >= 0 ? '+' : ''}₹{totalMTM.toLocaleString('en-IN')}
          </span>
        </div>
      </div>

      {/* Algo groups */}
      {orders.map((group, gi) => (
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

            <span style={{ fontWeight: 700, fontSize: '14px', color: group.terminated ? 'var(--text-dim)' : 'var(--accent-blue)' }}>
              {group.algoName}
            </span>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', background: 'var(--bg-surface)', padding: '2px 7px', borderRadius: '4px' }}>{group.account}</span>

            {!group.terminated && (group.mtmSL || group.mtmTP) && (
              <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                SL: <span style={{ color: 'var(--red)' }}>₹{Math.abs(group.mtmSL).toLocaleString('en-IN')}</span>
                &nbsp;·&nbsp;
                TP: <span style={{ color: 'var(--green)' }}>₹{group.mtmTP.toLocaleString('en-IN')}</span>
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
                    height: '26px', minWidth: '38px', padding: '0 10px', fontSize: '11px', fontWeight: 700,
                    border: `1.5px solid ${btn.color}`, background: 'transparent', color: btn.color,
                    borderRadius: '4px', cursor: btn.disabled ? 'not-allowed' : 'pointer',
                    transition: 'all 0.12s', opacity: btn.disabled ? 0.4 : 1,
                  }}
                  onMouseEnter={e => { if (!btn.disabled) (e.currentTarget as HTMLElement).style.background = `${btn.color}18` }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                  onClick={btn.action}>
                  {btn.label}
                </button>
              ))}
              <span style={{ fontWeight: 700, fontSize: '14px', marginLeft: '6px', color: group.mtm >= 0 ? 'var(--green)' : 'var(--red)', opacity: group.terminated ? 0.6 : 1 }}>
                {group.mtm >= 0 ? '+' : ''}₹{group.mtm.toLocaleString('en-IN')}
              </span>
            </div>
          </div>

          <div style={{ border: '1px solid var(--bg-border)', borderTop: 'none', borderRadius: '0 0 7px 7px', overflow: 'hidden' }}>
            <table className="staax-table">
              <colgroup>{COLS.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
              <thead><tr>{HDRS.map(h => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>{buildRows(group.legs).map(({ leg, isChild }) => <LegRow key={leg.id} leg={leg} isChild={isChild} onEditExit={(id, price) => setEditExit({ orderId: id, value: String(price) })} />)}</tbody>
            </table>
          </div>
        </div>
      ))}

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
                <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginTop: '3px' }}>STAAX will fetch each order from broker and re-link automatically</div>
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
