import { useStore } from '@/store'
import { useState, useEffect, useMemo, useRef } from 'react'
import { algosAPI, ordersAPI, holidaysAPI, accountsAPI, systemAPI } from '@/services/api'
import { StaaxSelect } from '@/components/StaaxSelect'
import { AlgoDetailModal } from '@/components/AlgoDetailModal'
import { CaretLeft, CaretRight, XCircle, CheckCircle, Lightning, ArrowsClockwise, Link, CalendarX, Broadcast } from '@phosphor-icons/react'
import { ORDER_STATUS, formatExitReason } from '@/constants/statuses'
import { fmtPnl, getISTNow } from '@/utils/format'

const INSTRUMENT_ORDER = ['BANKNIFTY', 'NIFTY', 'SENSEX', 'MIDCAPNIFTY', 'FINNIFTY', 'OTHER']

// IST time formatters — all timestamps from backend are UTC ISO strings
const fmtIST = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

type LegStatus  = 'open' | 'closed' | 'error' | 'pending' | 'waiting' | 'skipped'
type AlgoStatus = 'open' | 'closed' | 'error' | 'pending' | 'waiting' | 'no_trade' | 'skipped'

interface Leg {
  id: string; parentId?: string; journeyLevel: string; status: LegStatus
  symbol: string; dir: 'BUY' | 'SELL'; lots: string; entryCondition: string
  instrumentToken?: number
  errorMessage?: string
  refPrice?: number; fillPrice?: number; fillTime?: string; ltp?: number
  slOrig?: number; slActual?: number; slType?: string; tslTrailCount?: number; target?: number
  exitPrice?: number; exitPriceManual?: number; exitPriceRaw?: number
  exitTime?: string; exitReason?: string; pnl?: number
  reentryCount?: number;
  reentryTypeUsed?: string;   // "re_entry" | "re_execute"
  wtEnabled?: boolean; wtValue?: number; wtUnit?: string; wtDirection?: string; entryReference?: number
  reconcileStatus?: string
  slWarning?: string
  slOrderStatus?: string
  isOvernight?: boolean   // true for BTST/STBT — exclude from today's liveTabMtm
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
  wt_value?: number; wt_unit?: string; wt_direction?: string
  wt_ref_price?: number; wt_threshold?: number
}
interface WaitingAlgo {
  grid_entry_id: string; algo_id: string; algo_name: string
  account_name: string; entry_time: string | null; exit_time: string | null
  is_practix: boolean
  latest_error?: { reason: string; event_type: string; timestamp: string } | null
  legs?: WaitingLeg[]
  algo_state_status?: string   // "waiting" | "error" | "no_trade"
  error_message?: string | null
  is_missed?: boolean
  entry_type?: string           // "direct" | "orb"
  orb_end_time?: string | null  // "HH:MM" — null for non-ORB algos
  display_status?: string       // "MONITORING" | "SCHEDULED" | "WAITING" | "MISSED" | "ERROR"
}
// ── Status chip colour system ────────────────────────────────────────────────
const STATUS_STYLES: Record<string, { label: string; color: string; bg: string }> = {
  open:       { label: 'OPEN',    color: '#10B981', bg: 'rgba(16, 185, 129, 0.15)'  },
  closed:     { label: 'CLOSED',  color: '#9CA3AF', bg: 'rgba(156, 163, 175, 0.12)' },
  missed:     { label: 'MISSED',  color: '#F59E0B', bg: 'rgba(245, 158, 11, 0.15)'  },
  skipped:    { label: 'SKIPPED', color: '#94A3B8', bg: 'rgba(148, 163, 184, 0.10)' },
  error:      { label: 'ERROR',   color: '#EF4444', bg: 'rgba(239, 68, 68, 0.15)'   },
  waiting:    { label: 'WAITING', color: '#EAB308', bg: 'rgba(234, 179, 8, 0.15)'   },
  pending:    { label: 'PENDING', color: '#EAB308', bg: 'rgba(234, 179, 8, 0.15)'   },
  no_trade:   { label: 'MISSED',  color: '#F59E0B', bg: 'rgba(245, 158, 11, 0.15)'  },
  monitoring: { label: 'W&T',     color: '#2dd4bf', bg: 'rgba(45, 212, 191, 0.12)'  },
  scheduled:  { label: 'SCHED',   color: '#4488FF', bg: 'rgba(68, 136, 255, 0.12)'  },
}

function StatusChip({ status }: { status: string }) {
  const s = STATUS_STYLES[status?.toLowerCase()] ?? {
    label: status?.toUpperCase() || '—',
    color: '#6B7280',
    bg: 'rgba(107, 114, 128, 0.1)',
  }
  return (
    <span style={{
      display: 'inline-block',
      fontSize: 10,
      fontFamily: 'JetBrains Mono, monospace',
      fontWeight: 600,
      letterSpacing: 0.5,
      padding: '3px 10px',
      borderRadius: 20,
      color: s.color,
      background: 'var(--bg)',
      boxShadow: 'var(--neu-inset)',
      whiteSpace: 'nowrap',
    }}>
      {s.label}
    </span>
  )
}

// ── Algo card left status strip ─────────────────────────────────────────────
const ALGO_STATUS_BAR: Record<AlgoStatus, { color: string; glow: string }> = {
  open:     { color: '#0ea66e',               glow: 'rgba(14,166,110,0.70)'  },
  closed:   { color: '#6B7280',               glow: 'rgba(107,114,128,0.30)' },
  error:    { color: '#FF2244',               glow: 'rgba(255,34,68,0.70)'   },
  pending:  { color: '#FF8C00',               glow: 'rgba(255,140,0,0.65)'   },
  waiting:  { color: '#D97706',               glow: 'rgba(217,119,6,0.65)'   },
  no_trade: { color: 'var(--border)',          glow: 'transparent'            },
  skipped:  { color: 'rgba(156,163,175,0.5)', glow: 'transparent'            },
}

const COLS = ['36px','66px','158px','50px','120px','66px','72px','54px','84px','74px','120px']


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
  if (group.terminated) return ORDER_STATUS.CLOSED as AlgoStatus
  const legs = group.legs || []
  if (legs.length === 0) return 'waiting'
  if (legs.some(l => l.status === ORDER_STATUS.ERROR))  return ORDER_STATUS.ERROR as AlgoStatus
  if (legs.some(l => l.status === ORDER_STATUS.OPEN))   return ORDER_STATUS.OPEN as AlgoStatus
  if (legs.some(l => l.status === 'pending')) return 'pending'
  if (legs.every(l => l.status === ORDER_STATUS.CLOSED)) return ORDER_STATUS.CLOSED as AlgoStatus
  if (legs.every(l => l.status === 'skipped')) return 'skipped'
  return 'no_trade'
}

function isMarketLive(): boolean {
  const ist = getISTNow()
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

function formatSlDef(slType: string | undefined, slValue: number | undefined): string {
  if (!slType || slValue == null) return '';
  const val = slValue % 1 === 0 ? slValue.toFixed(0) : slValue.toFixed(1);
  switch (slType) {
    case 'pct_instrument':   return `I-${val}%`;
    case 'pts_instrument':   return `I-${val}pt`;
    case 'pct_underlying':   return `U-${val}%`;
    case 'pts_underlying':   return `U-${val}pt`;
    case 'fixed':            return `₹${val}`;
    case 'pct_portfolio':    return `P-${val}%`;
    default:                 return `${val}`;
  }
}

function formatSlSetting(slType: string | null, slOriginal: number | null): string {
  if (slOriginal == null) return ''
  const val = slOriginal % 1 === 0 ? slOriginal.toFixed(0) : slOriginal.toFixed(1)
  switch (slType) {
    case 'pts_instrument': return `(I-${val}pt)`
    case 'pct_instrument': return `(I-${val}%)`
    case 'tsl_pts':        return `(TSL-${val}pt)`
    case 'tsl_pct':        return `(TSL-${val}%)`
    case 'pts_underlying': return `(U-${val}pt)`
    case 'pct_underlying': return `(U-${val}%)`
    case 'orb_high':       return `(ORB-H)`
    case 'orb_low':        return `(ORB-L)`
    case 'orb_range':      return `(ORB-R)`
    default:               return `(${val})`
  }
}

async function handleRetrySL(orderId: string) {
  try {
    const resp = await fetch(`/api/v1/orders/${orderId}/retry-sl`, { method: 'POST' })
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}))
      alert(`Retry SL failed: ${err.detail || resp.statusText}`)
    }
  } catch (e) {
    alert(`Retry SL error: ${e}`)
  }
}

// ── LegRow ───────────────────────────────────────────────────────────────────
function LegRow({ leg, isChild, liveLtp, hasLivePoll, livePnl, onEditExit, orbHigh, orbLow, isOrbAlgo, isMarketHours }: {
  leg: Leg; isChild: boolean; liveLtp?: number; hasLivePoll?: boolean; livePnl?: number
  onEditExit?: (orderId: string, price: number) => void
  orbHigh?: number | null
  orbLow?: number | null
  isOrbAlgo?: boolean
  isMarketHours?: boolean
}) {
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
      <td style={{ textAlign: 'center', width: COLS[0] }}>
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
      <td style={{ width: COLS[1], ...C, padding: '11px 4px' }}>
        <StatusChip status={leg.status} />
        {leg.reconcileStatus && (
          <div style={{ fontSize: '8px', color: '#F59E0B', fontWeight: 700, marginTop: 2, fontFamily: 'var(--font-mono)' }}>
            SYNC
          </div>
        )}
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
            <div style={{ color: '#0ea66e', fontWeight: 600 }}>H: {orbHigh.toFixed(0)}</div>
            <div style={{ color: '#FF4444', fontWeight: 600 }}>L: {orbLow.toFixed(0)}</div>
            <div style={{ color: 'var(--text-dim)', fontSize: '9px' }}>Range: {(orbHigh - orbLow).toFixed(0)}pts</div>
          </div>
        ) : isOrbAlgo && leg.status === 'waiting' ? (
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', textAlign: 'center' }}>ORB window...</div>
        ) : (
          <>
            {leg.fillPrice != null ? (
              <div>
                <div style={{ fontWeight: 600, borderBottom: '1px dashed var(--text-dim)', display: 'inline-block' }}>₹{leg.fillPrice}</div>
                {leg.fillTime && <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: 2 }}>{leg.fillTime}</div>}
                {leg.entryReference != null && leg.entryCondition === 'wt' && (
                  <div style={{
                    fontSize: 10,
                    color: '#F59E0B',
                    marginTop: 2,
                    fontFamily: 'var(--font-mono)',
                    letterSpacing: 0.5,
                  }}>
                    REF ₹{Number(leg.entryReference).toFixed(2)}
                  </div>
                )}
              </div>
            ) : <div style={{ color: 'var(--text-dim)' }}>—</div>}
            {isOrbAlgo && orbHigh && orbLow && leg.status === 'open' && (
              <div style={{ color: 'var(--text-dim)', fontSize: '9px' }}>ORB H:{orbHigh.toFixed(0)} L:{orbLow.toFixed(0)}</div>
            )}
          </>
        )}
      </td>
      <td style={{ width: COLS[5], ...C, fontWeight: 600, color: isWtWaiting
        ? (wtTrigger != null && ltp != null ? (wtTriggered ? '#0ea66e' : '#06B6D4') : 'var(--text-muted)')
        : (ltp != null && leg.fillPrice != null ? (ltp > leg.fillPrice ? 'var(--green)' : 'var(--red)') : 'var(--text-muted)') }}>
        {ltp != null ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            {hasLivePoll ? (
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#0ea66e', flexShrink: 0, animation: 'pulse 1.5s infinite' }} />
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
            return (
              <div style={{ color: 'var(--text-muted)' }}>
                <div>{origLevel} A:<span style={{ color: 'var(--amber)' }}>{formatSL(slPrice, leg.slType)}</span></div>
                {leg.slOrig != null && leg.slType && (
                  <div style={{ fontSize: '9px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                    {formatSlDef(leg.slType, leg.slOrig)}
                  </div>
                )}
              </div>
            )
          }
          if (slPrice != null) {
            const slSetting = formatSlSetting(leg.slType ?? null, leg.slOrig ?? null)
            return (
              <div style={{ color: 'var(--text-muted)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span>{leg.slActual?.toFixed(2) ?? '—'}</span>
                  {slSetting && (
                    <span style={{ fontSize: 10, color: 'var(--text-mute)' }}>
                      {slSetting}
                    </span>
                  )}
                </div>
              </div>
            )
          }
          // Fallback: show definition (slOrig) for waiting/unfilled legs where engine hasn't set slActual yet
          if (leg.slOrig != null) {
            const slSetting = formatSlSetting(leg.slType ?? null, leg.slOrig)
            return (
              <div style={{ color: 'var(--text-dim)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span>{formatSL(leg.slOrig, leg.slType)}</span>
                {slSetting && (
                  <span style={{ fontSize: 10, color: 'var(--text-mute)' }}>
                    {slSetting}
                  </span>
                )}
              </div>
            )
          }
          return <>—</>
        })()}
      </td>
      <td style={{ width: COLS[7], ...C, color: 'var(--text-muted)' }}>{leg.target ?? '—'}</td>
      <td style={{ width: COLS[8], fontSize: '11px', ...C }}>
        {leg.status === 'closed' ? (
          <div style={{ cursor: 'pointer' }} title="Click to correct exit price"
            onClick={() => onEditExit && onEditExit(leg.id, leg.exitPriceRaw ?? leg.exitPrice ?? 0)}>
            {leg.exitPriceManual != null ? (
              // Corrected price — amber + "(corrected)" label
              <div>
                <div style={{ fontWeight: 600, color: 'var(--amber)', borderBottom: '1px dashed var(--amber)' }}>
                  {leg.exitPriceManual}
                </div>
                <div style={{ fontSize: '9px', color: 'var(--amber)', opacity: 0.8 }}>(corrected)</div>
                {leg.exitTime && <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{leg.exitTime}</div>}
              </div>
            ) : (leg.exitPriceRaw === 0 || (leg.exitPrice == null || leg.exitPrice === 0)) ? (
              // Missing exit price — show ✏️ prominently
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ color: 'var(--red)', fontWeight: 700 }}>✏️</span>
                <span style={{ color: 'var(--red)', fontSize: '10px' }}>missing</span>
              </div>
            ) : (
              // Normal price — dashed underline indicates editable
              <div>
                <div style={{ fontWeight: 600, borderBottom: '1px dashed var(--text-dim)' }}>{leg.exitPrice}</div>
                {leg.exitTime && <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{leg.exitTime}</div>}
              </div>
            )}
          </div>
        ) : leg.exitPrice != null ? (
          <div style={{ fontWeight: 600 }}>{leg.exitPrice}</div>
        ) : '—'}
      </td>
      <td style={{ width: COLS[9], ...C }}>
        {leg.exitReason
          ? <span style={{ fontSize: '10px', color: leg.status === 'error' ? 'var(--red)' : 'var(--text-muted)' }}>
              {formatExitReason(leg.exitReason)}
            </span>
          : <span style={{ color: 'var(--text-dim)', fontSize: '10px' }}>—</span>}
      </td>
      <td style={{ width: COLS[10], fontWeight: 700, textAlign: 'center', color: (livePnl ?? leg.pnl ?? 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
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
    {leg.slWarning && (
      <tr>
        <td colSpan={COLS.length} style={{ padding: '4px 10px 4px 26px', borderBottom: '1px solid var(--bg-border)' }}>
          <div style={{
            background: 'var(--bg)',
            boxShadow: 'var(--neu-inset)',
            borderLeft: '3px solid #FFAA00',
            borderRadius: 8,
            padding: '6px 14px',
            marginTop: 4,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}>
            <span style={{ fontSize: 11, color: '#FFAA00', fontFamily: 'var(--font-mono)', letterSpacing: '0.3px' }}>
              ⚠ {leg.slWarning}
            </span>
            <button
              onClick={() => handleRetrySL(leg.id)}
              disabled={!isMarketHours}
              style={{
                marginLeft: 'auto',
                fontSize: 10,
                color: '#FFAA00',
                background: 'var(--bg)',
                boxShadow: 'var(--neu-raised-sm)',
                border: 'none',
                borderRadius: 20,
                padding: '2px 10px',
                cursor: isMarketHours ? 'pointer' : 'not-allowed',
                fontFamily: 'var(--font-mono)',
                opacity: isMarketHours ? 1 : 0.35,
              }}
              title={!isMarketHours ? 'Market is closed — retry not available' : undefined}
            >
              Retry SL
            </button>
          </div>
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

function setInlineStatus(setOrdersByDate: React.Dispatch<React.SetStateAction<Record<string, AlgoGroup[]>>>, date: string, idx: number, msg: string, color: string, ms = 3000, persistent = false) {
  setOrdersByDate(prev => {
    const arr = prev[date] ?? []
    return { ...prev, [date]: arr.map((g, i) => i === idx ? { ...g, inlineStatus: msg, inlineColor: color } : g) }
  })
  if (!persistent) {
    setTimeout(() => setOrdersByDate(prev => {
      const arr = prev[date] ?? []
      return { ...prev, [date]: arr.map((g, i) => i === idx ? { ...g, inlineStatus: undefined, inlineColor: undefined } : g) }
    }), ms)
  }
}

type RawGroup = Record<string, unknown>
type RawOrder = Record<string, unknown>

// Helper to extract typed values from raw record
const str  = (v: unknown, fb = '')          => typeof v === 'string'  ? v : fb
const num  = (v: unknown, fb = 0)           => typeof v === 'number'  ? v : fb
const bool = (v: unknown, fb = false)       => typeof v === 'boolean' ? v : fb

function mapGroup(g: RawGroup): AlgoGroup {
  const orders = (g['orders'] as RawOrder[] | undefined) || []
  return {
    algoId:       str(g['algo_id']),
    algoName:     str(g['algo_name']) || str(g['algo_id']),
    account:      str(g['account']),
    mtm:          num(g['mtm']),
    mtmSL:        num(g['mtm_sl']),
    mtmTP:        num(g['mtm_tp']),
    latest_error: (g['latest_error'] as AlgoGroup['latest_error']) ?? null,
    gridEntryId:  str(g['grid_entry_id']) || undefined,
    entryType:    str(g['entry_type'])    || undefined,
    orbEndTime:   (g['orb_end_time'] as string | null) ?? null,
    orbHigh:      (g['orb_high']  as number | null) ?? null,
    orbLow:       (g['orb_low']   as number | null) ?? null,
    legs: orders.filter((o) => o['status'] !== 'cancelled').map((o): Leg => {
      // For auto-squareoff legs (exit_reason='sq'), prefer the algo-configured exit_time
      // over the actual timestamp — prevents the 15:35 EOD safety-net time from showing
      // instead of the algo's true exit time (e.g. 15:14 for SX-WIDE).
      const algoExitTime = str(g['algo_exit_time']) || undefined
      const oExitTime    = str(o['exit_time']) || undefined
      const oExitReason  = str(o['exit_reason'])
      const resolvedExitTime = oExitTime
        ? (oExitReason === 'sq' && algoExitTime
            ? algoExitTime.slice(0, 5)       // HH:MM from algo config
            : fmtIST(oExitTime))             // actual timestamp for all other exits
        : undefined
      return ({
      id:              str(o['id']),
      journeyLevel:    str(o['journey_level']) || '1',
      status:          str(o['status'], 'pending') as LegStatus,
      symbol:          str(o['symbol']),
      dir:             (str(o['direction'], 'buy').toUpperCase()) as 'BUY' | 'SELL',
      lots:            String(o['lots'] ?? ''),
      entryCondition:  str(o['entry_type']),
      instrumentToken: (o['instrument_token'] as number | undefined) ?? undefined,
      errorMessage:    str(o['error_message']) || undefined,
      fillPrice:       (o['fill_price'] as number | undefined) ?? undefined,
      fillTime:        str(o['fill_time']) ? fmtIST(str(o['fill_time'])) : undefined,
      ltp:             (o['ltp'] as number | undefined) ?? undefined,
      slOrig:          (o['sl_original'] as number | undefined) ?? undefined,
      slActual:        (o['sl_actual'] as number | undefined) ?? undefined,
      slType:          str(o['sl_type']) || undefined,
      tslTrailCount:   (o['tsl_trail_count'] as number | undefined) ?? undefined,
      target:          (o['target'] as number | undefined) ?? undefined,
      exitPrice:       (o['exit_price'] as number | undefined) ?? undefined,
      exitPriceManual: (o['exit_price_manual'] as number | undefined) ?? undefined,
      exitPriceRaw:    (o['exit_price_raw'] as number | undefined) ?? undefined,
      exitTime:        resolvedExitTime,
      exitReason:      oExitReason || undefined,
      pnl:             (o['pnl'] as number | undefined) ?? undefined,
      reentryCount:    num(o['reentry_count']),
      reentryTypeUsed: str(o['reentry_type_used']) || undefined,
      wtEnabled:       bool(o['wt_enabled']) || undefined,
      wtValue:         (o['wt_value'] as number | undefined) ?? undefined,
      wtUnit:          str(o['wt_unit']) || undefined,
      wtDirection:     str(o['wt_direction']) || undefined,
      entryReference:  (o['entry_reference'] as number | undefined) ?? undefined,
      slWarning:       str(o['sl_warning']) || undefined,
      slOrderStatus:   str(o['sl_order_status']) || undefined,
      isOvernight:     bool(o['is_overnight']),
    })})
  }
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
  const lineColor = totalPnl >= 0 ? '#0ea66e' : '#FF4444'
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
  // Ref kept in sync with selectedDate so action handlers (doRetry, doSQ, etc.)
  // always read the current date even if the closure was captured before a tab change.
  const selectedDateRef = useRef(selectedDate)
  useEffect(() => { selectedDateRef.current = selectedDate }, [selectedDate])

  const [ordersByDate, setOrdersByDate]     = useState<Record<string, AlgoGroup[]>>({})
  const [waitingByDate, setWaitingByDate]   = useState<Record<string, WaitingAlgo[]>>({})
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
  const [holidayDates, setHolidayDates] = useState<Set<string>>(new Set())
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [weekPnl, setWeekPnl] = useState<Record<string, number | null>>({})
  const [showWeekends, setShowWeekends] = useState(() => {
    return localStorage.getItem('orders_show_weekends') === 'true'
  })
  const [accountFilter, setAccountFilter] = useState<string>('all')
  const [fetchedAccounts, setFetchedAccounts] = useState<{ id: number; nickname: string }[]>([])
  const [ltpData, setLtpData]         = useState<Record<string, { ltp: number; pnl: number; fill_price: number }>>({})
  const [waitingRetryLoading, setWaitingRetryLoading] = useState<Record<string, boolean>>({})
  const [retryModal, setRetryModal] = useState<{ algoIdx: number; legs: Leg[] } | null>(null)
  const [retryChecked, setRetryChecked] = useState<Record<string, boolean>>({})
  const [retryingIds, setRetryingIds]   = useState<Set<string>>(new Set())
  const [statusFilter, setStatusFilter] = useState<string | null>(() => {
    try { return sessionStorage.getItem('staax_status_filter') ?? null } catch { return null }
  })
  const [isMarketHours, setIsMarketHours] = useState(false)
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
        const list = (res.data?.accounts || res.data || []) as { id: number; nickname: string }[]
        setFetchedAccounts(list.filter((a) => a.nickname).map((a) => ({ id: a.id, nickname: a.nickname })))
      })
      .catch(() => {})
  }, [])

  // Poll market hours every 60s
  useEffect(() => {
    const checkMarket = async () => {
      try {
        const h = await systemAPI.health()
        setIsMarketHours(!!h?.data?.is_market_hours)
      } catch {
        setIsMarketHours(false)
      }
    }
    checkMarket()
    const interval = setInterval(checkMarket, 60_000)
    return () => clearInterval(interval)
  }, [])

  // Fetch holidays once on mount
  useEffect(() => {
    holidaysAPI.list().then(res => {
      const dates = new Set<string>((res.data || []).map((h: { date: string }) => h.date))
      setHolidayDates(dates)
    }).catch(() => {})
  }, [isPractixMode])

  // Fetch week P&L summary — re-runs whenever the displayed week changes
  useEffect(() => {
    const monDate = weekDates['MON']
    if (!monDate) return
    setWeekPnl({})  // clear stale values immediately so tabs don't show last week's data
    ordersAPI.weekSummary(monDate, isPractixMode)
      .then((res) => {
        const mtmByDate: Record<string, number | { total?: number } | null> = res.data?.mtm_by_date || {}
        const map: Record<string, number | null> = {}
        for (const [dateStr, val] of Object.entries(mtmByDate)) {
          const day = Object.entries(weekDates).find(([, d]) => d === dateStr)?.[0]
          if (!day) continue
          map[day] = val === null || val === undefined ? null
            : typeof val === 'number' ? val
            : typeof val === 'object' ? ((val as { total?: number }).total ?? null)
            : null
        }
        setWeekPnl(map)
      })
      .catch(() => {})
  }, [weekDates, isPractixMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load orders + waiting algos for selectedDate — skip if already cached
  useEffect(() => {
    const date = selectedDate
    if (ordersByDate[date] !== undefined) return  // already cached — no re-fetch, no bleed
    ordersAPI.list(date, isPractixMode)
      .then(res => {
        const data = res.data
        const raw: RawGroup[] = Array.isArray(data) ? [] : (data?.groups || [])
        setOrdersByDate(prev => ({ ...prev, [date]: raw.map(mapGroup) }))
      })
      .catch(() => {
        setOrdersByDate(prev => ({ ...prev, [date]: [] }))  // mark as loaded (empty)
      })

    ordersAPI.waiting(date, isPractixMode)
      .then(res => setWaitingByDate(prev => ({ ...prev, [date]: res.data?.waiting || [] })))
      .catch(() => { setWaitingByDate(prev => ({ ...prev, [date]: [] })) })
  }, [selectedDate, isPractixMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // Live LTP via WebSocket
  useEffect(() => {
    const WS_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace('http', 'ws')
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

  // Live LTP polling every 1 second when today has open orders.
  // Runs regardless of which day tab is active so the today pill stays live
  // even when the user is viewing a past-day tab (no flicker on tab switch).
  useEffect(() => {
    const todayOrders = ordersByDate[todayDate] ?? []
    const hasOpenOrders = todayOrders.some(g => g.legs.some(l => l.status === 'open'))
    if (!hasOpenOrders) return
    const poll = () => {
      ordersAPI.ltp()
        .then(res => { if (res.data?.ltp) setLtpData(res.data.ltp) })
        .catch(() => {})
    }
    poll()
    const interval = setInterval(poll, 1000)
    return () => clearInterval(interval)
  }, [ordersByDate, todayDate])

  // Seed LTP data immediately on mount — prevents ₹0 flash before first poll fires
  useEffect(() => {
    ordersAPI.ltp()
      .then(res => { if (res.data?.ltp) setLtpData(res.data.ltp) })
      .catch(() => {})
  }, [])

  // Live poll /orders/waiting every 3s when today has MONITORING W&T legs.
  // Without this, wt_ref_price stays null forever: the initial fetch fires before
  // the W&T evaluator captures its reference price, and the cached result is never
  // refreshed — so display_status becomes MONITORING but wt_ref_price is still
  // undefined, blocking the "Ref: …" display.
  useEffect(() => {
    const todayWaiting = waitingByDate[todayDate] ?? []
    const hasMonitoring = todayWaiting.some(
      w => w.display_status === 'MONITORING' && (w.legs ?? []).some((l) => l.wt_enabled)
    )
    if (!hasMonitoring) return
    const poll = () => {
      ordersAPI.waiting(todayDate, isPractixMode)
        .then(res => {
          setWaitingByDate(prev => ({ ...prev, [todayDate]: res.data?.waiting || [] }))
        })
        .catch(() => {})
    }
    const interval = setInterval(poll, 3000)
    return () => clearInterval(interval)
  }, [waitingByDate, todayDate, isPractixMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // Persist selected day tab across page refreshes
  useEffect(() => {
    try { localStorage.setItem(LS_DAY_KEY, selectedDate) } catch {}
  }, [selectedDate])

  const safeOrders  = ordersByDate[selectedDate] ?? []
  const safeWaiting = waitingByDate[selectedDate] ?? []

  // Tab-scoped live MTM — only open orders ENTERED on this tab's date.
  const buildRows = (legs: Leg[]) => {
    const r: { leg: Leg; isChild: boolean }[] = []
    for (const p of (legs || []).filter(l => !l.parentId)) {
      r.push({ leg: p, isChild: false })
      for (const c of (legs || []).filter(l => l.parentId === p.id)) r.push({ leg: c, isChild: true })
    }
    return r
  }

  const openLegs = (idx: number) => (safeOrders[idx]?.legs || []).filter(l => l.status === 'open')

  // ── Actions ──────────────────────────────────────────────────────────────
  const doRetry = async (idx: number) => {
    const gridEntryId = safeOrders[idx]?.gridEntryId
    if (!gridEntryId) return
    const dateAtCall = selectedDateRef.current

    // 1. Optimistic UI — mark as retrying
    setRetryingIds(prev => new Set(prev).add(gridEntryId))
    setLoading(l => ({ ...l, [`retry-${idx}`]: true }))
    setInlineStatus(setOrdersByDate, dateAtCall, idx, '↻ Retrying...', 'var(--accent-amber)', 30000)

    // 2. Fire retry API call
    try {
      await ordersAPI.retryEntry(gridEntryId)
    } catch (_err) {
      const err = _err as { response?: { data?: { detail?: string } }; message?: string }
      const msg = err?.response?.data?.detail || err?.message || 'Retry failed'
      setInlineStatus(setOrdersByDate, dateAtCall, idx, msg, 'var(--red)', 0, true)
      setRetryingIds(prev => { const s = new Set(prev); s.delete(gridEntryId); return s })
      setLoading(l => ({ ...l, [`retry-${idx}`]: false }))
      return
    }

    // 3. Extended poll — 10 attempts × 2s = 20s window
    // APScheduler has ~2s delay, so ERROR before 6 attempts (12s) is treated as transient
    let attempts = 0
    const refetchAndClear = async (statusMsg: string, statusColor: string) => {
      try {
        const [_wRes, _oRes] = await Promise.all([
          ordersAPI.waiting(dateAtCall, isPractixMode).catch(() => null),
          ordersAPI.list(dateAtCall, isPractixMode).catch(() => null),
        ])
        if (selectedDateRef.current === dateAtCall) {
          if (_wRes) setWaitingByDate(prev => ({ ...prev, [dateAtCall]: _wRes.data?.waiting || [] }))
          if (_oRes) {
            const raw: RawGroup[] = Array.isArray(_oRes.data) ? [] : (_oRes.data?.groups || [])
            setOrdersByDate(prev => ({ ...prev, [dateAtCall]: raw.map(mapGroup) }))
          }
        }
      } catch { /* ignore refetch errors */ }
      setRetryingIds(prev => { const s = new Set(prev); s.delete(gridEntryId); return s })
      setLoading(l => ({ ...l, [`retry-${idx}`]: false }))
      setInlineStatus(setOrdersByDate, dateAtCall, idx, statusMsg, statusColor, 3000)
      setTimeout(() => {
        document.getElementById(`algo-card-${safeOrders[idx]?.algoId}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 100)
    }

    const pollInterval = setInterval(async () => {
      attempts++
      try {
        if (selectedDateRef.current !== dateAtCall) {
          clearInterval(pollInterval)
          setRetryingIds(prev => { const s = new Set(prev); s.delete(gridEntryId); return s })
          setLoading(l => ({ ...l, [`retry-${idx}`]: false }))
          return
        }
        const res = await ordersAPI.list(dateAtCall, isPractixMode)
        const raw: RawGroup[] = Array.isArray(res.data) ? [] : (res.data?.groups || [])
        const updatedGroup = raw.find((g) => g['grid_entry_id'] === gridEntryId)
        if (updatedGroup) {
          // Derive status from orders in the group
          const orders: RawOrder[] = (updatedGroup['orders'] as RawOrder[]) || []
          const hasOpen    = orders.some((o) => o['status'] === 'open')
          const hasPending = orders.some((o) => o['status'] === 'pending')
          const hasError   = orders.some((o) => o['status'] === 'error')
          const allError   = orders.length > 0 && orders.every((o) => o['status'] === 'error')

          // Terminal SUCCESS — at least one leg opened
          if (hasOpen || hasPending) {
            clearInterval(pollInterval)
            await refetchAndClear('Retry succeeded', 'var(--green)')
            return
          }
          // ERROR is only terminal after 6+ attempts (12s elapsed) to absorb APScheduler delay
          if ((hasError || allError) && attempts >= 6) {
            clearInterval(pollInterval)
            await refetchAndClear('Still errored', 'var(--red)')
            return
          }
          // Otherwise: keep polling (error before 6 attempts, waiting, no orders yet, etc.)
        }
      } catch { /* network error during poll — keep trying */ }

      if (attempts >= 10) {
        clearInterval(pollInterval)
        await refetchAndClear('↻ Refreshed', 'var(--accent-amber)')
      }
    }, 2000)
  }

  // Retry specific errored legs (partial failure — some legs succeeded)
  const doRetryLegs = async (idx: number) => {
    const gridEntryId = safeOrders[idx]?.gridEntryId
    if (!gridEntryId) return
    const selectedLegIds = Object.keys(retryChecked).filter(k => retryChecked[k])
    if (selectedLegIds.length === 0) return
    const dateAtCall = selectedDateRef.current
    setLoading(l => ({ ...l, [`retry-${idx}`]: true }))
    setInlineStatus(setOrdersByDate, dateAtCall, idx, '↻ Retrying legs...', 'var(--accent-amber)', 30000)
    try {
      await ordersAPI.retryLegs(gridEntryId, selectedLegIds)
      await new Promise(r => setTimeout(r, 800))
      setInlineStatus(setOrdersByDate, dateAtCall, idx, 'Done', 'var(--green)', 3000)
      ordersAPI.list(dateAtCall, isPractixMode)
        .then(r => { if (selectedDateRef.current !== dateAtCall) return; const raw: RawGroup[] = r.data?.groups || []; setOrdersByDate(prev => ({ ...prev, [dateAtCall]: raw.map(mapGroup) })) })
        .catch(() => {})
    } catch (_err) {
      const err = _err as { response?: { data?: { detail?: string } }; message?: string }
      const msg = err?.response?.data?.detail || err?.message || 'Retry legs failed'
      setInlineStatus(setOrdersByDate, dateAtCall, idx, msg, 'var(--red)', 0, true)
    } finally {
      setLoading(l => ({ ...l, [`retry-${idx}`]: false }))
      setRetryModal(null)
    }
  }

  const doSQ = async (idx: number) => {
    const algoId   = safeOrders[idx].algoId
    const selected = Object.keys(sqChecked).filter(k => sqChecked[k])
    if (selected.length === 0) { setModal(null); return }
    const dateAtCall = selectedDateRef.current
    setLoading(l => ({ ...l, [`sq-${idx}`]: true }))
    setInlineStatus(setOrdersByDate, dateAtCall, idx, '↻ Running...', 'var(--accent-amber)', 30000)
    setSqResults(null)
    setSqError(null)
    try {
      const res = await algosAPI.sq(algoId, selected)
      const data = res.data as { squared_off: {order_id: string; exit_price?: number}[]; failed: {order_id: string; error: string}[]; algo_state?: string }
      setSqResults({ squared_off: data.squared_off || [], failed: data.failed || [] })

      // Refetch orders from server so UI reflects real DB state
      ordersAPI.list(dateAtCall, isPractixMode)
        .then(r => {
          if (selectedDateRef.current !== dateAtCall) return
          const raw: RawGroup[] = Array.isArray(r.data) ? [] : (r.data?.groups || [])
          setOrdersByDate(prev => ({ ...prev, [dateAtCall]: raw.map(mapGroup) }))
        })
        .catch(() => {})

      const nOk   = (data.squared_off || []).length
      const nFail = (data.failed || []).length
      if (nFail === 0) {
        setInlineStatus(setOrdersByDate, dateAtCall, idx, `${nOk} leg${nOk !== 1 ? 's' : ''} squared off`, 'var(--green)')
        setSqChecked({})
        setModal(null)
      } else {
        // Keep modal open to show per-leg results
        setInlineStatus(setOrdersByDate, dateAtCall, idx, `${nOk} squared off, ${nFail} failed`, 'var(--amber)')
      }
    } catch (_err) {
      const err = _err as { response?: { data?: { detail?: string } }; message?: string }
      const msg = err?.response?.data?.detail || err?.message || 'SQ failed'
      setSqError(msg)
      setInlineStatus(setOrdersByDate, dateAtCall, idx, 'SQ failed', 'var(--red)', 0, true)
    } finally {
      setLoading(l => ({ ...l, [`sq-${idx}`]: false }))
    }
  }

  const doTerminate = async (idx: number) => {
    const algoId = safeOrders[idx].algoId
    const dateAtCall = selectedDateRef.current
    setLoading(l => ({ ...l, [`t-${idx}`]: true }))
    setInlineStatus(setOrdersByDate, dateAtCall, idx, '↻ Running...', 'var(--accent-amber)', 30000)
    try {
      const res = await algosAPI.terminate(algoId)
      const data = res.data as {
        status: string
        squared_off: string[]
        failed: { order_id: string; error: string }[]
      }

      // Trigger a full orders refetch — do NOT do optimistic update
      ordersAPI.list(dateAtCall, isPractixMode)
        .then(r => {
          if (selectedDateRef.current !== dateAtCall) return
          const raw: RawGroup[] = Array.isArray(r.data) ? [] : (r.data?.groups || [])
          setOrdersByDate(prev => ({ ...prev, [dateAtCall]: raw.map(mapGroup) }))
        })
        .catch(() => {})

      const nFailed = (data.failed || []).length
      if (nFailed > 0) {
        setInlineStatus(setOrdersByDate, dateAtCall, idx, `Terminated — ${nFailed} order${nFailed !== 1 ? 's' : ''} may still be open at broker`, 'var(--amber)', 8000)
      } else {
        setInlineStatus(setOrdersByDate, dateAtCall, idx, 'Algo terminated', 'var(--red)', 5000)
      }
      setModal(null)
    } catch (_err) {
      const err = _err as { response?: { data?: { detail?: string } }; message?: string }
      // Backend error — do NOT mark algo as terminated locally
      const msg = err?.response?.data?.detail || err?.message || 'Terminate failed'
      setInlineStatus(setOrdersByDate, dateAtCall, idx, msg, 'var(--red)', 0, true)
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
    const name = safeOrders[algoIdx]?.algoName ?? ''
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
                  <CheckCircle size={13} weight="fill" color="var(--green)" />
                  <span style={{ fontFamily: 'monospace', opacity: 0.7 }}>{r.order_id.slice(-8)}</span>
                  {r.exit_price != null && <span style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>exit: {r.exit_price}</span>}
                </div>
              ))}
              {sqResults.failed.map(r => (
                <div key={r.order_id} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '6px 12px', background: 'rgba(255,0,0,0.08)', borderRadius: '5px', fontSize: '12px' }}>
                  <XCircle size={13} weight="fill" color="var(--red)" />
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
    const algoId = safeOrders[algoIdx].algoId
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
    const msg = failed === 0 ? `${succeeded} order${succeeded > 1 ? 's' : ''} synced` : `${succeeded} synced, ${failed} failed`
    setInlineStatus(setOrdersByDate, selectedDateRef.current, algoIdx, msg, failed === 0 ? 'var(--green)' : 'var(--amber)', 5000)
  }

  const doCorrectExit = async () => {
    if (!editExit) return
    const price = parseFloat(editExit.value)
    if (isNaN(price) || price <= 0) return
    setExitSaving(true)
    try {
      await ordersAPI.correctExitPrice(editExit.orderId, price)
      setEditExit(null)
      // Refresh orders so corrected price + recalculated P&L are shown
      const _date = selectedDateRef.current
      const res = await ordersAPI.list(_date, isPractixMode)
      const raw: RawGroup[] = Array.isArray(res.data) ? [] : (res.data?.groups || [])
      setOrdersByDate(prev => ({ ...prev, [_date]: raw.map(mapGroup) }))
    }
    catch { alert('Failed to save exit price') }
    finally { setExitSaving(false) }
  }

  // ── Filtering + grouping ─────────────────────────────────────────────────
  const activeAccountNickname = activeAccount
    ? (storeAccounts as { id: string; nickname: string }[]).find((a) => String(a.id) === activeAccount)?.nickname ?? null
    : null
  const filteredOrders  = activeAccountNickname ? safeOrders.filter(g => g.account === activeAccountNickname) : safeOrders
  const filteredWaiting = activeAccountNickname ? safeWaiting.filter(w => w.account_name === activeAccountNickname) : safeWaiting

  // Past-day detection — ISO date string compare is safe (both are YYYY-MM-DD)
  const isPastDay = selectedDate < todayDate

  // Always-live P&L for today's pill — computed from ordersByDate[todayDate] + ltpData
  // so the THU tab shows fresh P&L even when another day tab is active.
  // Do NOT filter isOvernight — STBT/BTST entered today live in today's date bucket
  // and must be included. The date bucket already excludes yesterday's overnight entries.
  // Always-live P&L for today pill — computed from ordersByDate[todayDate] + ltpData
  const liveTodayPnl = useMemo((): number | null => {
    const todayOrders = accountFilter === 'all'
      ? (ordersByDate[todayDate] ?? [])
      : (ordersByDate[todayDate] ?? []).filter(g => g.account === accountFilter)
    if (!todayOrders.some(g => g.legs.length > 0)) return null
    return todayOrders.flatMap(g => g.legs).reduce((sum, l) =>
      sum + (ltpData[l.id]?.pnl ?? l.pnl ?? 0), 0)
  }, [ordersByDate, todayDate, ltpData, accountFilter])

  // Past day P&L — computed from local order data if loaded, otherwise falls back to weekPnl
  const computedDayPnl = useMemo(() => {
    const result: Record<string, number | null> = { ...weekPnl }
    for (const [day, date] of Object.entries(weekDates)) {
      if (!date || date === todayDate) continue
      const groups = ordersByDate[date]
      if (groups && groups.some(g => g.legs.length > 0)) {
        const filtered = accountFilter === 'all' ? groups : groups.filter(g => g.account === accountFilter)
        result[day] = filtered.reduce((daySum, group) =>
          daySum + group.legs.reduce((s, l) => s + (l.pnl ?? 0), 0), 0)
      }
    }
    return result
  }, [weekPnl, ordersByDate, accountFilter, weekDates, todayDate])

  const localFilteredOrdersRaw = accountFilter === 'all' ? filteredOrders : filteredOrders.filter(g => g.account === accountFilter)
  // Past days: hide groups with no executed trades (only show algos with at least one filled open/closed leg)
  const localFilteredOrders  = isPastDay
    ? localFilteredOrdersRaw.filter(g => g.legs.some(l => l.fillPrice != null && (l.status === 'open' || l.status === 'closed')))
    : localFilteredOrdersRaw
  // Past days: never show the waiting/error section (nothing actionable about yesterday's errors)
  const localFilteredWaiting = isPastDay ? [] : (accountFilter === 'all' ? filteredWaiting : filteredWaiting.filter(w => w.account_name === accountFilter))

  // Apply status filter from stat cards
  const displayOrders = statusFilter === 'open'    ? localFilteredOrders.filter(g => ['open','pending'].includes(getAlgoStatus(g)))
                      : statusFilter === 'closed'   ? localFilteredOrders.filter(g => getAlgoStatus(g) === 'closed')
                      : statusFilter === 'missed' || statusFilter === 'error' || statusFilter === 'waiting' ? []
                      : localFilteredOrders
  const displayWaiting = statusFilter === 'missed'  ? localFilteredWaiting.filter(w => w.is_missed || w.display_status === 'SKIPPED')
                       : statusFilter === 'error'   ? localFilteredWaiting.filter(w => !w.is_missed && w.display_status !== 'SKIPPED' && (w.algo_state_status === 'error' || (w.algo_state_status === 'no_trade' && !!w.error_message)))
                       : statusFilter === 'waiting' ? localFilteredWaiting.filter(w => !w.is_missed && w.display_status !== 'SKIPPED' && w.algo_state_status !== 'error' && !(w.algo_state_status === 'no_trade' && !!w.error_message))
                       : statusFilter === 'open' || statusFilter === 'closed' ? []
                       : localFilteredWaiting

  const groupedByInstrument: Record<string, AlgoGroup[]> = {}
  for (const group of displayOrders) {
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
      <div style={{ flexShrink: 0, padding: '0 28px' }}>

        {/* Page header */}
        <div className="page-header">
          <div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '22px', fontWeight: 800, color: 'var(--accent)' }}>Orders</h1>
            <p style={{ fontSize: '12px', color: 'var(--text-mute)', marginTop: '4px' }}>Trade history · P&amp;L by week</p>
          </div>
          <div className="page-header-actions" style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            {/* Week navigation */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginRight: 8 }}>
              <button
                onClick={() => setWeekOffset(o => o - 1)}
                style={{ width: 28, height: 28, borderRadius: '50%', border: 'none', cursor: 'pointer', background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                title="Previous week"
                onMouseDown={e => { e.currentTarget.style.boxShadow = 'var(--neu-inset)' }}
                onMouseUp={e => { e.currentTarget.style.boxShadow = 'var(--neu-raised-sm)' }}
                onMouseLeave={e => { e.currentTarget.style.boxShadow = 'var(--neu-raised-sm)' }}
              ><CaretLeft size={13} /></button>
              <span style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)', borderRadius: 100, padding: '0 20px', height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' as const, minWidth: 130 }}>
                {weekLabel}
              </span>
              <button
                onClick={() => setWeekOffset(o => Math.min(0, o + 1))}
                disabled={weekOffset === 0}
                style={{ width: 28, height: 28, borderRadius: '50%', border: 'none', cursor: weekOffset === 0 ? 'default' : 'pointer', background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', color: weekOffset === 0 ? 'var(--text-mute)' : 'var(--text-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: weekOffset === 0 ? 0.4 : 1, flexShrink: 0 }}
                title="Next week"
                onMouseDown={e => { if (weekOffset !== 0) e.currentTarget.style.boxShadow = 'var(--neu-inset)' }}
                onMouseUp={e => { e.currentTarget.style.boxShadow = 'var(--neu-raised-sm)' }}
                onMouseLeave={e => { e.currentTarget.style.boxShadow = 'var(--neu-raised-sm)' }}
              ><CaretRight size={13} /></button>
            </div>
            {statusFilter !== null && (
              <button
                style={{ height: 32, padding: '0 14px', borderRadius: 100, border: 'none', cursor: 'pointer', background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', color: 'var(--accent)', fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-display)' }}
                onClick={() => { setStatusFilter(null); try { sessionStorage.removeItem('staax_status_filter') } catch {} }}
                onMouseDown={e => { e.currentTarget.style.boxShadow = 'var(--neu-inset)' }}
                onMouseUp={e => { e.currentTarget.style.boxShadow = 'var(--neu-raised-sm)' }}
                onMouseLeave={e => { e.currentTarget.style.boxShadow = 'var(--neu-raised-sm)' }}
              >
                Reset Filter
              </button>
            )}
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

        {/* ── Filter Stat Cards — above day tabs ── */}
        {(() => {
          // ── Row counts ──
          const openAlgosCount   = localFilteredOrders.filter(g => ['open','pending'].includes(getAlgoStatus(g))).length
          const closedAlgosCount = localFilteredOrders.filter(g => getAlgoStatus(g) === 'closed').length
          const openLegsCount    = localFilteredOrders.reduce((s, g) => s + g.legs.filter(l => l.status === 'open').length, 0)
          const closedLegsCount  = localFilteredOrders.reduce((s, g) => s + g.legs.filter(l => l.status === 'closed').length, 0)
          const isExpiry         = (w: WaitingAlgo) => w.display_status === 'SKIPPED'
          const missedCount      = safeWaiting.filter(w => w.is_missed || isExpiry(w)).length
          const isWaitingError   = (w: WaitingAlgo) => !w.is_missed && !isExpiry(w) && (w.algo_state_status === 'error' || (w.algo_state_status === 'no_trade' && !!w.error_message))
          const errorCount       = safeWaiting.filter(isWaitingError).length
          const waitingCount     = safeWaiting.filter(w => !w.is_missed && !isWaitingError(w) && !isExpiry(w)).length

          const valStyle: React.CSSProperties = { fontSize: 20, fontWeight: 800, fontFamily: 'var(--font-mono)', lineHeight: 1 }

          const toggleFilter = (f: string) => {
            const next = statusFilter === f ? null : f
            setStatusFilter(next)
            try { if (next) sessionStorage.setItem('staax_status_filter', next); else sessionStorage.removeItem('staax_status_filter') } catch {}
          }

          const kpiCard = (filter: string | null, _label: string, _value: number, _valColor: string): React.CSSProperties => ({
            flex: 1, minWidth: 0, padding: '8px 12px', cursor: 'pointer', borderRadius: 12,
            background: 'var(--bg)',
            boxShadow: statusFilter === filter ? 'var(--neu-inset)' : 'var(--neu-raised-sm)',
            border: statusFilter === filter ? '1px solid var(--border-accent)' : '1px solid transparent',
            transition: 'box-shadow 0.15s',
          })
          void kpiCard

          return (
            <div style={{ padding: '6px 0 6px' }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
                {[
                  { f: 'open',    label: 'Open Algos',   val: openAlgosCount,   color: openAlgosCount   > 0 ? '#0ea66e' : 'var(--text-mute)' },
                  { f: 'closed',  label: 'Closed Algos', val: closedAlgosCount, color: closedAlgosCount > 0 ? '#0ea66e' : 'var(--text-mute)' },
                  { f: 'open',    label: 'Open Pos',     val: openLegsCount,    color: openLegsCount    > 0 ? '#0ea66e' : 'var(--text-mute)' },
                  { f: 'closed',  label: 'Closed Pos',   val: closedLegsCount,  color: closedLegsCount  > 0 ? '#0ea66e' : 'var(--text-mute)' },
                  { f: 'missed',  label: 'Missed',       val: missedCount,      color: missedCount      > 0 ? '#E08000' : 'var(--text-mute)' },
                  { f: 'error',   label: 'Error',        val: errorCount,       color: errorCount       > 0 ? '#E03030' : 'var(--text-mute)' },
                  { f: 'waiting', label: 'Waiting',      val: waitingCount,     color: waitingCount     > 0 ? '#C8A000' : 'var(--text-mute)' },
                ].map(({ f, label, val, color }) => (
                  <div key={label} onClick={() => toggleFilter(f)}
                    style={{
                      flex: 1, minWidth: 0, padding: '10px 16px', cursor: 'pointer', borderRadius: 12,
                      background: 'var(--bg)',
                      boxShadow: statusFilter === f ? 'var(--neu-inset)' : 'var(--neu-raised-sm)',
                      transition: 'box-shadow 0.15s',
                    }}>
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase' as const, color: 'var(--text-mute)', marginBottom: 4 }}>{label}</div>
                    <div style={{ ...valStyle, color }}>{val}</div>
                  </div>
                ))}
              </div>
            </div>
          )
        })()}

        {/* Date navigation — neumorphic sliding pill */}
        {(() => {
          const days = showWeekends ? ['MON','TUE','WED','THU','FRI','SAT','SUN'] : ['MON','TUE','WED','THU','FRI']
          const activeDayIdx = Math.max(0, days.findIndex(d => weekDates[d] === selectedDate))
          return (
            <div style={{ display: 'flex', alignItems: 'center', margin: '12px 0 0', gap: 10 }}>
              {/* Day tabs pill trough */}
              <div style={{
                display: 'flex', flex: 1, position: 'relative',
                background: 'var(--bg)', boxShadow: 'var(--neu-inset)',
                borderRadius: 100, padding: '4px',
              }}>
                {/* Sliding pill indicator */}
                <div style={{
                  position: 'absolute',
                  top: 4, bottom: 4,
                  left: `calc(4px + ${activeDayIdx} * (100% - 8px) / ${days.length})`,
                  width: `calc((100% - 8px) / ${days.length})`,
                  background: 'var(--bg)',
                  boxShadow: 'var(--neu-raised-sm)',
                  borderRadius: 100,
                  transition: 'left 0.28s cubic-bezier(0.4, 0, 0.2, 1)',
                  pointerEvents: 'none',
                }} />
                {days.map(day => {
                  const date       = weekDates[day]
                  const isActive   = selectedDate === date
                  const isHoliday  = date ? holidayDates.has(date) : false
                  const isDayToday = date === todayDate
                  const dayPnl     = isDayToday ? liveTodayPnl : (computedDayPnl[day] ?? null)
                  return (
                    <button
                      key={day}
                      onClick={() => date && setSelectedDate(date)}
                      style={{
                        flex: 1, padding: '8px 4px', textAlign: 'center' as const,
                        border: 'none', borderRadius: 100, background: 'transparent',
                        color: isActive ? 'var(--accent)' : 'var(--text-dim)',
                        fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 600,
                        letterSpacing: '1px', textTransform: 'uppercase' as const,
                        cursor: 'pointer', transition: 'color 0.25s ease',
                        position: 'relative', zIndex: 1,
                        display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: '2px',
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        {day}{isHoliday && <CalendarX size={10} style={{ marginLeft: 2, verticalAlign: 'middle', flexShrink: 0 }} />}
                      </span>
                      {isHoliday ? (
                        <span style={{ fontSize: '10px', color: 'var(--accent-amber)', fontWeight: 500 }}>Holiday</span>
                      ) : dayPnl != null ? (
                        <span style={{ fontSize: '14px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: dayPnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
                          {fmtPnl(dayPnl)}
                        </span>
                      ) : (
                        <span style={{ fontSize: '10px', color: 'var(--text-mute)' }}>—</span>
                      )}
                    </button>
                  )
                })}
              </div>
              {/* Weekends pill — unchanged */}
              <div
                onClick={() => setShowWeekends(prev => {
                  const next = !prev
                  localStorage.setItem('orders_show_weekends', String(next))
                  return next
                })}
                style={{
                  padding: '4px 12px', borderRadius: 20, cursor: 'pointer',
                  fontSize: 11, fontFamily: 'var(--font-display)',
                  flexShrink: 0,
                  background: 'var(--bg)',
                  boxShadow: showWeekends ? 'var(--neu-inset)' : 'var(--neu-raised-sm)',
                  border: 'none',
                  color: showWeekends ? 'var(--accent)' : 'var(--text-dim)',
                  whiteSpace: 'nowrap' as const, userSelect: 'none' as const,
                  transition: 'all 0.15s ease',
                }}
              >Weekends</div>
            </div>
          )
        })()}

      </div>{/* end fixed zone */}

      {/* ── Scroll zone ── */}
      <div className="no-scrollbar" style={{ flex: 1, overflow: 'auto', padding: '16px 28px 24px' }}>

        {/* Live MTM wired to header — strip removed */}

        {/* Holiday banner */}
        {isHolidayToday && (
          <div style={{ marginBottom: '16px', padding: '10px 14px', background: 'rgba(215,123,18,0.08)', border: '1px solid rgba(215,123,18,0.25)', borderRadius: '7px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CalendarX size={16} color="var(--accent-amber)" />
            <span style={{ fontSize: '12px', color: 'var(--accent-amber)', fontWeight: 600 }}>Market Holiday</span>
            <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>— No trading scheduled for {selectedDate}</span>
          </div>
        )}

        {/* Waiting algos — full algo cards */}
        {displayWaiting.length > 0 && !isHolidayToday && (
          <div style={{ marginBottom: '16px' }}>
            {displayWaiting.map(w => {
              // isError: algo_state ERROR, or NO_TRADE caused by engine failure (has error_message)
              // but NOT expiry_skip — that is an intentional SKIPPED, not an error
              const isSkipped = w.display_status === 'SKIPPED'
              const isError   = !isSkipped && (w.algo_state_status === 'error' ||
                                (w.algo_state_status === 'no_trade' && !!w.error_message))
              // isMissed: backend-authoritative flag (NO_TRADE + activated_at + no error)
              const isMissed  = !!w.is_missed
              const errType = w.latest_error?.event_type || ''
              const isFeedErr    = errType.includes('FEED') || (w.latest_error?.reason || '').includes('FEED_ERROR')
              const isOrbExpired  = errType.includes('ORB_EXPIRED') || (w.latest_error?.reason || '').includes('ORB_EXPIRED')
              const isRetrying = waitingRetryLoading[w.grid_entry_id]

              // ORB window awareness — disable RETRY if past orb_end_time (IST)
              const isOrbAlgo = w.entry_type === 'orb'
              const isOrbWindowPast = isOrbAlgo && !!w.orb_end_time && (() => {
                const ist = getISTNow()
                const [hh, mm] = w.orb_end_time!.split(':').map(Number)
                return ist.getHours() * 60 + ist.getMinutes() >= hh * 60 + mm
              })()

              // Card accent colours — resolved via STATUS_STYLES
              const legChipKey: string =
                isMissed                            ? 'missed'
                : w.display_status === 'MONITORING' ? 'monitoring'
                : w.display_status === 'SCHEDULED'  ? 'scheduled'
                : w.display_status === 'SKIPPED'    ? 'skipped'
                : isError                           ? 'error'
                : 'waiting'
              const displayStatus = w.display_status  // 'MONITORING' | 'SCHEDULED' | 'WAITING' | 'MISSED' | 'ERROR'
              const stripBg =
                displayStatus === 'MONITORING' ? '#2dd4bf' :
                displayStatus === 'SCHEDULED'  ? '#4488FF' :
                displayStatus === 'ERROR'      ? '#FF4444' :
                displayStatus === 'MISSED'     ? '#F59E0B' :
                displayStatus === 'SKIPPED'    ? 'rgba(156,163,175,0.5)' :
                isError ? '#FF4444' :
                isMissed ? 'rgba(255,215,0,0.35)' :
                '#FFE600'  // WAITING default
              const stripGlow =
                displayStatus === 'MONITORING' ? 'rgba(45,212,191,0.5)' :
                displayStatus === 'SCHEDULED'  ? 'rgba(68,136,255,0.5)' :
                displayStatus === 'ERROR'      ? 'rgba(255,34,68,0.5)'  :
                displayStatus === 'MISSED'     ? 'rgba(245,158,11,0.5)' :
                displayStatus === 'SKIPPED'    ? 'transparent'          :
                isError ? 'rgba(255,68,68,0.5)' :
                'rgba(255,230,0,0.5)'  // WAITING default

              const doWaitingRE = async () => {
                if (waitingRetryLoading[w.grid_entry_id]) return
                const _geid   = w.grid_entry_id
                const _algoid = w.algo_id
                const _date   = selectedDateRef.current
                setWaitingRetryLoading(prev => ({ ...prev, [_geid]: true }))
                try {
                  await ordersAPI.retryEntry(_geid)
                  // Poll every 1.5s for up to 10.5s (7 attempts) until algo moves to orders
                  for (let _i = 0; _i < 7; _i++) {
                    await new Promise(r => setTimeout(r, 1500))
                    if (selectedDateRef.current !== _date) break  // user switched tab — abort
                    const [_wRes, _oRes] = await Promise.all([
                      ordersAPI.waiting(_date, isPractixMode).catch(() => null),
                      ordersAPI.list(_date, isPractixMode).catch(() => null),
                    ])
                    const _stillWaiting = (_wRes?.data?.waiting || []).some((x: { grid_entry_id?: string }) => x.grid_entry_id === _geid)
                    if (_wRes) setWaitingByDate(prev => ({ ...prev, [_date]: _wRes.data?.waiting || [] }))
                    if (_oRes) setOrdersByDate(prev => ({ ...prev, [_date]: (_oRes.data?.groups || []).map(mapGroup) }))
                    if (!_stillWaiting) {
                      // Scroll to the algo card that just appeared in orders
                      setTimeout(() => {
                        document.getElementById(`algo-card-${_algoid}`)
                          ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                      }, 200)
                      break
                    }
                  }
                } catch { /* silent — entry may already be queued */ }
                finally { setWaitingRetryLoading(prev => ({ ...prev, [_geid]: false })) }
              }

              // All entries in the waiting list are retryable — they haven't entered yet.
              // Only block for ORB window past, already retrying, or market closed.
              const isOrbRetryBlocked = isOrbWindowPast || (isOrbAlgo && isMissed)
              const canRetry  = !isRetrying && !isOrbRetryBlocked && isMarketHours
              const retryLabel = isOrbRetryBlocked ? 'ORB ✕' : 'RETRY'
              const retryCol   = isOrbRetryBlocked ? 'var(--text-mute)' : '#F59E0B'
              const retryBg    = isOrbRetryBlocked ? 'transparent' : 'rgba(245,158,11,0.05)'
              const retryHBg   = isOrbRetryBlocked ? 'transparent' : 'rgba(245,158,11,0.14)'
              const missedBtns = [
                { label: 'SYNC',   col: '#CC4400', bg: 'rgba(204,68,0,0.05)',    hBg: 'rgba(204,68,0,0.14)',   border: undefined, disabled: false, action: undefined },
                { label: 'SQ',     col: '#0ea66e', bg: 'rgba(34,221,136,0.05)', hBg: 'rgba(34,221,136,0.14)', border: undefined, disabled: true,  action: undefined },
                { label: 'T',      col: '#FF4444', bg: 'rgba(255,68,68,0.05)',  hBg: 'rgba(255,68,68,0.14)',  border: undefined, disabled: true,  action: undefined },
                { label: retryLabel, col: retryCol, bg: retryBg, hBg: retryHBg, border: undefined, disabled: !canRetry, action: canRetry ? doWaitingRE : undefined },
              ]

              return (
                <div key={w.grid_entry_id}
                  style={{
                    borderRadius: '20px', overflow: 'hidden', marginBottom: 14,
                    background: 'var(--bg)',
                    boxShadow: 'var(--neu-raised)',
                  }}>

                  {/* ── Card header ── */}
                  <div style={{ background: 'var(--bg)', display: 'flex', alignItems: 'stretch', borderBottom: '1px solid var(--border)' }}>

                    {/* Left status strip */}
                    <div style={{ width: '4px', flexShrink: 0, alignSelf: 'stretch', background: stripBg, boxShadow: `0 0 8px ${stripGlow}, 0 0 20px ${stripGlow}` }}/>

                    {/* Info column — row 1: name+chips+time; row 2: error/status detail */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

                      {/* Row 1: name + chips + entry time */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 20px', flexWrap: 'wrap' as const, minWidth: 0 }}>

                        {/* Algo name */}
                        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '15px', color: 'var(--text)', whiteSpace: 'nowrap' as const }}>
                          {w.algo_name}
                        </span>

                        {/* Account pill */}
                        {w.account_name && (
                          <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', fontWeight: 500, padding: '2px 8px', borderRadius: '100px', background: 'var(--bg)', boxShadow: 'var(--neu-inset)', color: 'var(--text-dim)', whiteSpace: 'nowrap' as const }}>
                            {w.account_name}
                          </span>
                        )}

                        {/* Expiry skip reason — inline beside account chip */}
                        {isSkipped && w.error_message && (
                          <span style={{ fontSize: '11px', color: 'var(--text-mute)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <CalendarX size={11} />
                            {w.error_message.replace('expiry_skip: ', '')}
                          </span>
                        )}

                        {/* Retrying badge — shown while polling for result */}
                        {isRetrying && (
                          <span style={{ fontSize: '11px', color: '#06B6D4' }}>
                            Retrying…
                          </span>
                        )}

                        {/* Entry time — pushed to right */}
                        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
                          {w.entry_time && (
                            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                              Entry {w.entry_time.slice(0, 5)}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Row 2: full error / missed / status detail (hidden when nothing to show) */}
                      {(isError || isFeedErr || isOrbExpired || isOrbWindowPast || (!isError && !isMissed && w.latest_error)) && (
                        <div style={{ padding: '0 14px 10px 14px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          {isError && (w.error_message || w.latest_error?.reason) && (
                            <span style={{ fontSize: '11px', color: '#FF6666', fontFamily: 'var(--font-mono)', wordBreak: 'break-word' as const, display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                              <XCircle size={12} weight="fill" style={{ flexShrink: 0, marginTop: 1 }} />
                              {w.error_message || w.latest_error?.reason}
                            </span>
                          )}
                          {!isError && !isMissed && isFeedErr && (
                            <span style={{ fontSize: '11px', color: '#D77B12', display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Lightning size={11} weight="fill" />Feed not ready</span>
                          )}
                          {!isError && !isMissed && isOrbExpired && (
                            <span style={{ fontSize: '11px', color: '#D77B12' }}>⏱ ORB window closed</span>
                          )}
                          {!isError && !isMissed && w.latest_error && !isFeedErr && !isOrbExpired && (
                            <span style={{ fontSize: '11px', color: '#EF4444', fontFamily: 'var(--font-mono)', wordBreak: 'break-word' as const, display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                              <XCircle size={12} weight="fill" style={{ flexShrink: 0, marginTop: 1 }} />
                              {w.latest_error.reason || ''}
                            </span>
                          )}
                          {isOrbWindowPast && (
                            <span style={{ fontSize: '11px', color: 'var(--text-mute)', fontStyle: 'italic' }}>
                              ORB window passed ({w.orb_end_time}) — RETRY disabled
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* ── Action buttons ── */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', flexShrink: 0 }}>
                      <span style={{ color: 'var(--border)', fontSize: '14px', userSelect: 'none' }}>|</span>
                      {missedBtns.map((btn, bi) => (
                        <button key={bi}
                          disabled={btn.disabled}
                          onClick={btn.action}
                          style={{
                            height: 28, padding: '0 10px', borderRadius: 100, border: 'none',
                            background: 'var(--bg)',
                            boxShadow: btn.disabled ? 'var(--neu-inset)' : 'var(--neu-raised-sm)',
                            fontSize: 9, fontWeight: 700, fontFamily: 'var(--font-display)',
                            color: btn.col,
                            cursor: btn.disabled ? 'not-allowed' : 'pointer',
                            opacity: btn.disabled ? 0.35 : 1,
                            letterSpacing: '0.5px',
                            transition: 'box-shadow 0.12s',
                            whiteSpace: 'nowrap' as const,
                          }}
                          onMouseDown={e => { if (!btn.disabled) e.currentTarget.style.boxShadow = 'var(--neu-inset)' }}
                          onMouseUp={e => { if (!btn.disabled) e.currentTarget.style.boxShadow = 'var(--neu-raised-sm)' }}
                          onMouseLeave={e => { if (!btn.disabled) e.currentTarget.style.boxShadow = 'var(--neu-raised-sm)' }}
                        >
                          {btn.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ── Leg table ── */}
                  {(w.legs || []).length > 0 && (
                    <div className="orders-table-wrapper" style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'] }}>
                      <table className="staax-table">
                        <colgroup>{COLS.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
                        <thead>
                          <tr>
                            <th style={{ textAlign: 'left',   background: 'var(--bg)', color: 'var(--text-mute)', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', padding: '8px 20px', verticalAlign: 'middle' }}>#</th>
                            <th style={{ textAlign: 'center', background: 'var(--bg)', color: 'var(--text-mute)', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', padding: '8px 20px', verticalAlign: 'middle' }}>Status</th>
                            <th style={{ textAlign: 'left',   background: 'var(--bg)', color: 'var(--text-mute)', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', padding: '8px 20px', verticalAlign: 'middle' }}>Symbol</th>
                            <th style={{ textAlign: 'center', background: 'var(--bg)', color: 'var(--text-mute)', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', padding: '8px 20px', verticalAlign: 'middle' }}>Lots</th>
                            <th style={{ textAlign: 'center', background: 'var(--bg)', color: 'var(--text-mute)', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', padding: '8px 20px', verticalAlign: 'middle' }}>Fill / Ref</th>
                            <th style={{ textAlign: 'center', background: 'var(--bg)', color: 'var(--text-mute)', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', padding: '8px 20px', verticalAlign: 'middle' }}>LTP</th>
                            <th style={{ textAlign: 'center', background: 'var(--bg)', color: 'var(--text-mute)', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', padding: '8px 20px', verticalAlign: 'middle' }}>SL</th>
                            <th style={{ textAlign: 'center', background: 'var(--bg)', color: 'var(--text-mute)', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', padding: '8px 20px', verticalAlign: 'middle' }}>Target</th>
                            <th style={{ textAlign: 'center', background: 'var(--bg)', color: 'var(--text-mute)', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', padding: '8px 20px', verticalAlign: 'middle' }}>Exit</th>
                            <th style={{ textAlign: 'center', background: 'var(--bg)', color: 'var(--text-mute)', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', padding: '8px 20px', verticalAlign: 'middle' }}>Reason</th>
                            <th style={{ textAlign: 'center', background: 'var(--bg)', color: 'var(--text-mute)', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', padding: '8px 20px', verticalAlign: 'middle' }}>P&L</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(w.legs || []).map(leg => (
                            <tr key={leg.leg_number}>
                              <td style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 11, verticalAlign: 'middle' }}>{leg.leg_number}</td>
                              <td style={{ textAlign: 'center', padding: '11px 4px', verticalAlign: 'middle' }}>
                                <StatusChip status={legChipKey} />
                              </td>
                              <td style={{ textAlign: 'left', fontSize: 11, verticalAlign: 'middle' }}>
                                <div style={{ fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{leg.underlying} {leg.instrument?.toUpperCase()}</div>
                                <div style={{ fontSize: 10, color: leg.direction === 'buy' ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{leg.direction?.toUpperCase()}</div>
                              </td>
                              <td style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 11, verticalAlign: 'middle' }}>{leg.lots}</td>
                              {/* Fill/Ref: show W&T ref+trigger only for actively MONITORING legs */}
                              <td style={{ textAlign: 'center', fontSize: 11, verticalAlign: 'middle' }}>
                                {(() => {
                                  const showRefTrigger = w.display_status === 'MONITORING' && leg.wt_enabled && leg.wt_ref_price !== null && leg.wt_ref_price !== undefined
                                  if (showRefTrigger) {
                                    return (
                                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                                        <span style={{ color: 'var(--text-muted)' }}>Ref: {(leg.wt_ref_price as number).toLocaleString('en-IN')}</span>
                                        <span style={{ color: '#06B6D4', fontWeight: 600 }}>→ {leg.wt_threshold !== null && leg.wt_threshold !== undefined ? leg.wt_threshold.toLocaleString('en-IN') : '—'}</span>
                                      </div>
                                    )
                                  }
                                  if (w.display_status === 'MONITORING' && leg.wt_enabled) {
                                    return <span style={{ color: '#F59E0B', fontSize: 10 }}>W&amp;T waiting ref…</span>
                                  }
                                  return <span style={{ color: 'var(--text-dim)' }}>—</span>
                                })()}
                              </td>
                              {['LTP','SL','Target','Exit','Reason'].map(col => (
                                <td key={col} style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 11, verticalAlign: 'middle' }}>—</td>
                              ))}
                              <td style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 11, fontWeight: 700, verticalAlign: 'middle' }}>—</td>
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

        {displayOrders.length === 0 && displayWaiting.length === 0 && (
          <div style={{ padding: '64px 24px', textAlign: 'center', color: 'var(--text-dim)', fontSize: '13px' }}>
            {isPastDay
            ? `No trades executed on ${new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })}.`
            : 'No orders for today.'}
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
                  borderBottom: '1px solid var(--border)', userSelect: 'none',
                }}>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: '12px', fontWeight: 700, color: 'var(--accent)', letterSpacing: '2px', textTransform: 'uppercase' }}>
                  {instrument}
                </span>
                <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                  {groupAlgos.length} algo{groupAlgos.length !== 1 ? 's' : ''}
                </span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" opacity="0.55"
                  style={{ marginLeft: 'auto', transition: 'transform 0.2s ease', transform: isCollapsed ? 'rotate(-90deg)' : 'none' }}>
                  <path d="M6 9l6 6 6-6"/>
                </svg>
              </div>

              {!isCollapsed && (
                <div style={{ display: 'flex', flexDirection: 'column', marginBottom: '4px' }}>
                  {groupAlgos.map(group => {
                    // gi = global index into safeOrders[] — needed by all action handlers
                    const gi       = safeOrders.findIndex(g => g.algoId === group.algoId)
                    const algoSt   = getAlgoStatus(group)
                    const bar      = ALGO_STATUS_BAR[algoSt]
                    const isFullyClosed = group.legs.length > 0 && group.legs.every(
                      l => l.status === 'closed' || l.status === 'error' || l.status === 'skipped'
                    )
                    const isClosed = isFullyClosed
                    const closedL  = group.legs.filter(l => l.status === 'closed' && l.fillPrice != null && l.exitPrice != null)
                    const totalPnl = group.legs.reduce((sum, l) => sum + (ltpData[l.id]?.pnl ?? l.pnl ?? 0), 0)
                    const showSpark = closedL.length > 0 && !group.legs.some(l => l.status === 'open' || l.status === 'pending')

                    // Action button helper booleans
                    const hasOpenLegs  = openLegs(gi).length > 0
                    const allLegsError = group.legs.length > 0 && group.legs.every(l => l.status === 'error')
                    const someLegsError = group.legs.some(l => l.status === 'error')
                    const isTerminated = !!group.terminated
                    const isOrbAlgo    = group.entryType === 'orb'
                    const isOrbMissed  = isOrbAlgo && !!group.orbEndTime && (() => {
                      const [hh, mm] = (group.orbEndTime || '').split(':').map(Number)
                      const istNow   = getISTNow()
                      return istNow.getHours() > hh || (istNow.getHours() === hh && istNow.getMinutes() >= mm)
                    })()
                    // RETRY is available when: algo errored (all or some legs), or no_trade (missed entry)
                    const isRetrying = !!group.gridEntryId && retryingIds.has(group.gridEntryId)
                    const canRetry = !!group.gridEntryId && !isTerminated && !isOrbMissed && !isRetrying &&
                      (algoSt === 'error' || algoSt === 'no_trade' || someLegsError)

                    // RETRY action: direct retry if all legs errored or no_trade; modal for partial errors
                    const doSmartRetry = () => {
                      if (allLegsError || algoSt === 'no_trade') {
                        doRetry(gi)
                      } else {
                        const errLegs = group.legs.filter(l => l.status === 'error')
                        setRetryChecked(Object.fromEntries(errLegs.map(l => [l.id, true] as [string, boolean])))
                        setRetryModal({ algoIdx: gi, legs: errLegs })
                      }
                    }

                    // Action button definitions — RE-RUN removed, single smart RETRY
                    const retryBtnLabel = isRetrying ? '↻' : (loading[`retry-${gi}`] ? '↻' : 'RETRY')
                    const retryBtnCol   = isRetrying ? 'rgba(6,182,212,0.7)' : (canRetry ? '#F59E0B' : '#6B6B6B')
                    const retryBtnBg    = isRetrying ? 'rgba(6,182,212,0.06)' : (canRetry ? 'rgba(245,158,11,0.05)' : 'rgba(100,100,100,0.04)')
                    const canSQ    = isMarketHours && !isTerminated && !isClosed && hasOpenLegs
                    const canRetryFinal = canRetry && isMarketHours
                    const BTNS = [
                      { label: 'SYNC',   col: '#CC4400', bg: 'rgba(204,68,0,0.05)',    hBg: 'rgba(204,68,0,0.14)',    border: undefined, disabled: false,                                        title: undefined, action: () => { setSyncForm({ broker_order_id: '', account_id: group.account }); setShowSync(gi) } },
                      { label: 'SQ',     col: '#0ea66e', bg: 'rgba(34,221,136,0.05)', hBg: 'rgba(34,221,136,0.14)',  border: undefined, disabled: !canSQ, title: !canSQ && hasOpenLegs && !isTerminated && !isClosed ? 'Market is closed' : undefined, action: () => { setSqChecked({}); setModal({ type: 'sq', algoIdx: gi }) } },
                      { label: 'T',      col: '#FF4444', bg: 'rgba(255,68,68,0.05)',   hBg: 'rgba(255,68,68,0.14)',   border: undefined, disabled: isTerminated || isClosed || !isMarketHours,   title: !isTerminated && !isClosed && !isMarketHours ? 'Market is closed' : undefined, action: () => setModal({ type: 't', algoIdx: gi }) },
                      { label: retryBtnLabel, col: retryBtnCol, bg: retryBtnBg, hBg: 'rgba(245,158,11,0.14)', border: undefined, disabled: !canRetryFinal || !!loading[`retry-${gi}`] || isRetrying, title: isOrbMissed ? 'ORB window closed' : (isRetrying ? 'Retrying...' : (!isMarketHours && canRetry ? 'Market is closed' : (!canRetry ? 'Available when algo is in error or missed state' : undefined))), action: doSmartRetry },
                    ]

                    return (
                      <div key={group.algoId}
                        id={`algo-card-${group.algoId}`}
                        style={{ opacity: group.terminated ? 0.65 : 1, borderRadius: '20px', overflow: 'hidden', background: 'var(--bg)', boxShadow: 'var(--neu-raised)', marginBottom: 14 }}>

                        {/* ── Algo card header ── */}
                        <div style={{ background: 'var(--bg)', display: 'flex', alignItems: 'stretch', borderBottom: '1px solid var(--border)' }}>

                          {/* Status strip */}
                          <div style={{ width: '4px', flexShrink: 0, alignSelf: 'stretch', background: bar.color, boxShadow: `0 0 8px ${bar.glow}, 0 0 20px ${bar.glow}` }}/>

                          {/* Info row */}
                          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 20px', flexWrap: 'wrap', minWidth: 0 }}>

                            {group.terminated && <span title="Algo terminated" style={{ display: 'flex', alignItems: 'center' }}><XCircle size={14} weight="fill" color="#EF4444" /></span>}

                            {/* Algo name */}
                            <span
                              onClick={() => setSelectedAlgoName(group.algoName)}
                              style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '15px', color: 'var(--text)', cursor: 'pointer', whiteSpace: 'nowrap', textDecoration: 'underline', textDecorationStyle: 'dotted', textDecorationColor: 'rgba(255,107,0,0.35)' }}>
                              {group.algoName}
                            </span>

                            {/* Account pill */}
                            <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', fontWeight: 500, padding: '2px 8px', borderRadius: '100px', background: 'var(--bg)', boxShadow: 'var(--neu-inset)', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                              {group.account || '—'}
                            </span>

                            {/* Retry indicator — only shown during active retry, status visible in row */}
                            {isRetrying && (
                              <span style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)', borderRadius: 100, padding: '2px 10px', fontSize: '10px', fontWeight: 700, fontFamily: 'var(--font-display)', letterSpacing: '0.5px', color: '#06B6D4', whiteSpace: 'nowrap' }}>
                                ↻ Pending...
                              </span>
                            )}
                            {/* ORB capture indicator */}
                            {isOrbAlgo && !isOrbMissed && algoSt === 'waiting' && (
                              <span style={{ fontSize: '10px', color: '#F59E0B', background: 'rgba(245,158,11,0.10)', boxShadow: 'var(--neu-inset)', padding: '2px 10px', borderRadius: '100px', whiteSpace: 'nowrap' as const, fontWeight: 700, fontFamily: 'var(--font-display)', letterSpacing: '0.5px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                <Broadcast size={10} weight="fill" />Capturing ORB
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

                            {/* Error badge — suppressed during retry to avoid misleading stale ERROR display */}
                            {!isRetrying && !group.terminated && group.legs.some(l => l.status === 'error') && (() => {
                              const errLegs = group.legs.filter(l => l.status === 'error')
                              const firstMsg = errLegs[0]?.errorMessage
                              const shortMsg = firstMsg ? ` — ${firstMsg.length > 40 ? firstMsg.slice(0, 40) + '…' : firstMsg}` : ''
                              return (
                                <span title={firstMsg || undefined} style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)', borderRadius: 100, padding: '2px 10px', fontSize: '10px', fontWeight: 700, fontFamily: 'var(--font-display)', letterSpacing: '0.5px', color: '#EF4444', whiteSpace: 'nowrap', cursor: firstMsg ? 'help' : 'default' }}>
                                  {errLegs.length} LEG{errLegs.length > 1 ? 'S' : ''} FAILED{shortMsg}
                                </span>
                              )
                            })()}

                            {/* Inline status pill + Sparkline + MTM P&L (right side) */}
                            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
                              {/* Inline status pill — before sparkline */}
                              {group.inlineStatus && (
                                <span style={{
                                  fontSize: '10px', fontWeight: 700, color: group.inlineColor,
                                  padding: '2px 10px', borderRadius: '100px',
                                  background: 'var(--bg)', boxShadow: 'var(--neu-inset)',
                                  fontFamily: 'var(--font-display)', letterSpacing: '0.5px',
                                  whiteSpace: 'nowrap' as const,
                                  animation: 'fadeIn 0.15s ease',
                                }}>
                                  {group.inlineStatus}
                                </span>
                              )}
                              {showSpark && (
                                <SmoothedSparkline algoId={group.algoId} legs={group.legs} totalPnl={totalPnl} />
                              )}
                              {totalPnl !== 0 && (
                                <span style={{
                                  fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '14px',
                                  color: totalPnl >= 0 ? 'var(--green)' : 'var(--red)',
                                  opacity: group.terminated ? 0.6 : 1,
                                  minWidth: '90px', textAlign: 'right',
                                }}>
                                  {fmtPnl(totalPnl)}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* ── Action buttons ── */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', flexShrink: 0 }}>
                            <span style={{ color: 'var(--border)', fontSize: '14px', userSelect: 'none' }}>|</span>
                            {BTNS.map((btn, bi) => (
                              <button key={bi}
                                disabled={btn.disabled}
                                title={btn.title}
                                onClick={btn.action}
                                style={{
                                  height: 28, padding: '0 10px', borderRadius: 100, border: 'none',
                                  background: 'var(--bg)',
                                  boxShadow: btn.disabled ? 'var(--neu-inset)' : 'var(--neu-raised-sm)',
                                  fontSize: 9, fontWeight: 700, fontFamily: 'var(--font-display)',
                                  color: btn.disabled ? 'var(--text-mute)' : btn.col,
                                  cursor: btn.disabled ? 'not-allowed' : 'pointer',
                                  opacity: btn.disabled ? 0.35 : 1,
                                  letterSpacing: '0.5px',
                                  transition: 'box-shadow 0.12s',
                                  whiteSpace: 'nowrap' as const,
                                }}
                                onMouseDown={e => { if (!btn.disabled) e.currentTarget.style.boxShadow = 'var(--neu-inset)' }}
                                onMouseUp={e => { if (!btn.disabled) e.currentTarget.style.boxShadow = 'var(--neu-raised-sm)' }}
                                onMouseLeave={e => { if (!btn.disabled) e.currentTarget.style.boxShadow = 'var(--neu-raised-sm)' }}
                              >
                                {btn.label}
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
                            marginTop: 6,
                            display: 'flex', alignItems: 'flex-start', gap: 4,
                          }}>
                            <XCircle size={12} weight="fill" style={{ flexShrink: 0, marginRight: 4 }} />
                            {group.latest_error.timestamp ? new Date(group.latest_error.timestamp).toLocaleTimeString('en-IN', {hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'}) : ''} — {group.latest_error.reason}
                          </div>
                        )}

                        {/* ── Legs table ── */}
                        <div className="orders-table-wrapper" style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'] }}>
                            <table className="staax-table">
                              <colgroup>{COLS.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
                              <thead>
                                <tr>
                                  <th style={{ textAlign: 'left', background: 'var(--bg)', color: 'var(--text-mute)', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', padding: '8px 20px', verticalAlign: 'middle' }}>#</th>
                                  <th style={{ textAlign: 'center', background: 'var(--bg)', color: 'var(--text-mute)', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', padding: '8px 20px', verticalAlign: 'middle' }}>Status</th>
                                  <th style={{ textAlign: 'left',   background: 'var(--bg)', color: 'var(--text-mute)', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', padding: '8px 20px', verticalAlign: 'middle' }}>Symbol</th>
                                  <th style={{ textAlign: 'center', background: 'var(--bg)', color: 'var(--text-mute)', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', padding: '8px 20px', verticalAlign: 'middle' }}>Lots</th>
                                  <th style={{ textAlign: 'center', background: 'var(--bg)', color: 'var(--text-mute)', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', padding: '8px 20px', verticalAlign: 'middle' }}>Fill / Ref</th>
                                  <th style={{ textAlign: 'center', background: 'var(--bg)', color: 'var(--text-mute)', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', padding: '8px 20px', verticalAlign: 'middle' }}>LTP</th>
                                  <th style={{ textAlign: 'center', background: 'var(--bg)', color: 'var(--text-mute)', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', padding: '8px 20px', verticalAlign: 'middle' }}>SL</th>
                                  <th style={{ textAlign: 'center', background: 'var(--bg)', color: 'var(--text-mute)', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', padding: '8px 20px', verticalAlign: 'middle' }}>Target</th>
                                  <th style={{ textAlign: 'center', background: 'var(--bg)', color: 'var(--text-mute)', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', padding: '8px 20px', verticalAlign: 'middle' }}>Exit</th>
                                  <th style={{ textAlign: 'center', background: 'var(--bg)', color: 'var(--text-mute)', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', padding: '8px 20px', verticalAlign: 'middle' }}>Reason</th>
                                  <th style={{ textAlign: 'center', background: 'var(--bg)', color: 'var(--text-mute)', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', padding: '8px 20px', verticalAlign: 'middle' }}>P&L</th>
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
                                      isMarketHours={isMarketHours}
                                    />
                                  )
                                })}
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
            <div style={{ fontWeight: 700, fontSize: '16px', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}><Link size={15} weight="regular" />Sync Order — {safeOrders[showSync]?.algoName}</div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px', lineHeight: 1.5 }}>
              Re-link an order that got delinked from STAAX.<br/>
              Find the <b>Order ID</b> in your broker platform (Zerodha: Order Book → Order ID · Angel One: Order Book → Broker Order No.)
            </div>

            {/* ── Legs needing sync ── */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: 'var(--text-mute)', marginBottom: 8, fontWeight: 600, textTransform: 'uppercase' }}>
                Legs needing sync
              </div>
              {(safeOrders[showSync]?.legs ?? [])
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
              {(safeOrders[showSync]?.legs ?? []).filter((l: Leg) => l.status === 'error' || l.status === 'pending').length === 0 && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>No legs in error state</div>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <div style={{ fontSize: '10px', color: 'var(--text-mute)', marginBottom: '4px', fontWeight: 600, textTransform: 'uppercase' }}>Broker Order ID(s) * <span style={{ fontWeight: 400, textTransform: 'none' }}>(comma-separated for multiple)</span></div>
                <textarea className="staax-input" style={{ width: '100%', fontSize: '13px', fontWeight: 600, resize: 'vertical', minHeight: '60px', fontFamily: 'monospace' }}
                  placeholder="e.g. 1100000000123456, 1100000000123457"
                  autoFocus
                  value={syncForm.broker_order_id}
                  onChange={e => setSyncForm(s => ({ ...s, broker_order_id: e.target.value }))} />
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '3px' }}>STAAX will fetch each order from broker and re-link automatically</div>
              </div>
              <div>
                <div style={{ fontSize: '10px', color: 'var(--text-mute)', marginBottom: '4px', fontWeight: 600, textTransform: 'uppercase' }}>Account *</div>
                <select className="staax-select" style={{ width: '100%', fontSize: '12px' }}
                  value={syncForm.account_id}
                  onChange={e => setSyncForm(s => ({ ...s, account_id: e.target.value }))}>
                  <option value="">Select account...</option>
                  {safeOrders[showSync]?.account && <option value={safeOrders[showSync].account}>{safeOrders[showSync].account}</option>}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button className="btn btn-ghost" onClick={() => setShowSync(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={syncLoading} onClick={() => doSync(showSync)}>
                {syncLoading
                  ? <><ArrowsClockwise size={12} weight="regular" style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />Fetching from broker...</>
                  : <><Link size={12} weight="regular" style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />Sync Order</>
                }
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
              <div style={{ fontSize: '10px', color: 'var(--text-mute)', marginBottom: '4px', fontWeight: 600, textTransform: 'uppercase' }}>Exit Price</div>
              <input className="staax-input" type="number" style={{ width: '100%', fontSize: '14px', fontWeight: 700 }}
                value={editExit.value}
                onChange={e => setEditExit(ex => ex ? { ...ex, value: e.target.value } : null)}
                autoFocus />
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button className="btn btn-ghost" onClick={() => setEditExit(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={exitSaving} onClick={doCorrectExit}>
                {exitSaving ? 'Saving...' : <><CheckCircle size={12} weight="fill" style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />Save</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── RETRY leg-selection modal ── */}
      {retryModal && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: '420px' }}>
            <div style={{ fontWeight: 700, fontSize: '16px', marginBottom: '4px' }}>↻ Retry Failed Legs — {safeOrders[retryModal.algoIdx]?.algoName}</div>
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
                onClick={() => doRetryLegs(retryModal.algoIdx)}>
                {loading[`re-${retryModal.algoIdx}`] ? '↻ Retrying...' : '↻ Retry Selected'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Strategy popup modal ── */}
      <AlgoDetailModal algoName={selectedAlgoName} onClose={() => setSelectedAlgoName(null)} />


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
