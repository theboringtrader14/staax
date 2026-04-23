import { useState, useEffect, useRef, type CSSProperties } from 'react'
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine, ReferenceDot, ResponsiveContainer } from 'recharts'
import { ArrowsClockwise, Play, Stop, Gear, Trash, CaretDown, CaretUp } from '@phosphor-icons/react'
import { accountsAPI, botsAPI } from '@/services/api'
import axios from 'axios'
import { useStore } from '@/store'
import { StaaxSelect } from '@/components/StaaxSelect'

const API = `${(import.meta as any).env?.VITE_API_URL || 'http://localhost:8000'}/api/v1`
const auth = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('staax_token')}` } })
const apiGet  = (p: string) => axios.get(`${API}${p}`, auth())
const apiPost = (p: string, d: any = {}) => axios.post(`${API}${p}`, d, auth())
const apiPatch= (p: string, d: any) => axios.patch(`${API}${p}`, d, auth())
const apiDel  = (p: string) => axios.delete(`${API}${p}`, auth())

// Auto-compute current expiry (current month, rolls to next if <5 days to month end)
function autoExpiry(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

const INSTRUMENTS = [
  { value: 'GOLDM',     label: 'GOLDM Futures',     exchange: 'MCX' },
  { value: 'SILVERMIC', label: 'SILVERMIC Futures',  exchange: 'MCX' },
]
const INDICATORS = [
  { value: 'dtr',      label: 'DTR Strategy',        params: [] },
  { value: 'channel',  label: 'Channel Strategy',     params: ['channel_tf', 'channel_candles'] },
  { value: 'tt_bands', label: 'TT Bands Strategy',    params: ['tt_lookback'] },
]
const TIMEFRAMES = [
  { value: 15,  label: '15 min' },
  { value: 30,  label: '30 min' },
  { value: 45,  label: '45 min' },
  { value: 60,  label: '1 hour' },
  { value: 120, label: '2 hour' },
  { value: 180, label: '3 hour' },
]
const CHANNEL_TFS = ['1', '3', '5', '15', '30', '60', '120', '240', 'D']

// ── Style constants ────────────────────────────────────────────────────────────
const neuCard: CSSProperties = {
  background: 'var(--bg)',
  boxShadow: 'var(--neu-raised)',
  borderRadius: 20,
  marginBottom: 12,
  overflow: 'hidden',
}

const iconBtn = (active = false): CSSProperties => ({
  width: 30, height: 30, borderRadius: '50%', border: 'none', cursor: 'pointer',
  background: 'var(--bg)',
  boxShadow: active ? 'var(--neu-inset)' : 'var(--neu-raised-sm)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: 'var(--text-dim)', transition: 'box-shadow 0.12s',
  flexShrink: 0,
})

const neuChip = (color: string): CSSProperties => ({
  background: 'var(--bg)', boxShadow: 'var(--neu-inset)', borderRadius: 100,
  padding: '2px 10px', fontSize: 10, fontWeight: 700,
  fontFamily: 'var(--font-display)', letterSpacing: '0.5px',
  color, whiteSpace: 'nowrap',
})

const secLabel: CSSProperties = {
  fontSize: 9, letterSpacing: '0.15em', color: 'var(--text-mute)',
  fontWeight: 700, textTransform: 'uppercase', marginBottom: 8,
}

// Neumorphic input style (replaces dark staax-input in modals)
const neuInputStyle: CSSProperties = {
  background: 'var(--bg)', boxShadow: 'var(--neu-inset)', border: 'none', outline: 'none',
  borderRadius: 12, color: 'var(--text)', padding: '0 14px',
  height: 42, fontSize: 13, fontFamily: 'var(--font-body)', width: '100%',
}

// ── Neumorphic pill button — raised resting, inset on press ─────────────────────
function NeuBtn({
  children, onClick, disabled = false,
  variant = 'ghost', height = 36, fontSize = 12, style: extraStyle,
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  variant?: 'ghost' | 'accent' | 'danger' | 'warn'
  height?: number
  fontSize?: number
  style?: CSSProperties
}) {
  const ref = useRef<HTMLButtonElement>(null)

  const variantStyle: CSSProperties =
    variant === 'accent' ? { background: 'var(--accent)',       color: '#fff' } :
    variant === 'danger' ? { background: '#EF4444',             color: '#fff' } :
    variant === 'warn'   ? { background: 'var(--accent-amber)', color: '#fff' } :
                           { background: 'var(--bg)',           color: 'var(--text-dim)' }

  const raisedShadow = 'var(--neu-raised-sm)'
  const insetShadow  = 'var(--neu-inset)'

  const base: CSSProperties = {
    height, padding: '0 22px', borderRadius: 100, border: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize, fontWeight: 700, fontFamily: 'var(--font-display)',
    boxShadow: raisedShadow,
    opacity: disabled ? 0.45 : 1,
    transition: 'box-shadow 0.12s, opacity 0.12s',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    ...variantStyle,
    ...extraStyle,
  }

  return (
    <button
      ref={ref}
      style={base}
      disabled={disabled}
      onClick={onClick}
      onMouseDown={() => { if (!disabled && ref.current) ref.current.style.boxShadow = insetShadow }}
      onMouseUp={()   => { if (ref.current) ref.current.style.boxShadow = raisedShadow }}
      onMouseLeave={() => { if (ref.current) ref.current.style.boxShadow = raisedShadow }}
    >
      {children}
    </button>
  )
}

// Keep static ghostBtn for the Archived toggle (no ref needed there)
const ghostBtn: CSSProperties = {
  height: 30, padding: '0 16px', borderRadius: 100, border: 'none', cursor: 'pointer',
  background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)',
  fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-display)',
  color: 'var(--text-dim)', transition: 'box-shadow 0.12s',
}

// ── Types ──────────────────────────────────────────────────────────────────────
type Bot = {
  id: string; name: string; account_id: string; instrument: string
  exchange: string; expiry: string; indicator: string
  timeframe_mins: number; lots: number
  channel_candles?: number; channel_tf?: string; tt_lookback?: number
  status: string; is_archived: boolean; is_practix?: boolean
  pinescript_code?: string;
}
type BotOrder = {
  id: string; bot_name: string; is_practix: boolean
  instrument: string; direction: string; lots: number
  entry_price?: number; exit_price?: number
  entry_time?: string | null; exit_time?: string | null
  pnl?: number; status: string; signal_type?: string; expiry: string
  bot_id?: string
}
type BotSignal = {
  id: string; bot_id: string; bot_name?: string; signal_type: string; direction: string | null
  instrument: string; expiry: string; trigger_price: number | null; reason: string | null
  status: string; bot_order_id: string | null; error_message: string | null; fired_at: string | null
}

// ── ConfirmModal ───────────────────────────────────────────────────────────────
function ConfirmModal({ title, desc, confirmLabel, confirmColor, onConfirm, onCancel }: {
  title: string; desc: string; confirmLabel: string; confirmColor: string
  onConfirm: () => void; onCancel: () => void
}) {
  const isDanger = confirmColor?.includes('red') || confirmColor?.includes('ef4444') || confirmColor?.includes('FF4444')
  const isWarn   = confirmColor?.includes('amber') || confirmColor?.includes('f59e0b')
  const confirmVariant: 'danger' | 'warn' | 'accent' = isDanger ? 'danger' : isWarn ? 'warn' : 'accent'
  return (
    <div className="modal-overlay">
      <div style={{ background: 'var(--bg)', boxShadow: 'var(--neu-raised-lg)', borderRadius: 20, padding: '28px 24px', maxWidth: 360, width: '90vw' }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>{title}</div>
        <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6, marginBottom: 24 }}>{desc}</div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <NeuBtn onClick={onCancel}>Cancel</NeuBtn>
          <NeuBtn variant={confirmVariant} onClick={onConfirm}>{confirmLabel}</NeuBtn>
        </div>
      </div>
    </div>
  )
}

// ── EditBotModal ───────────────────────────────────────────────────────────────
function EditBotModal({ bot, accounts, onSave, onClose }: {
  bot: Bot; accounts: any[]; onSave: (id: string, data: any) => void; onClose: () => void
}) {
  const [form, setForm] = useState({
    name: bot.name, lots: bot.lots, account_id: bot.account_id,
    timeframe_mins: bot.timeframe_mins,
    channel_candles: bot.channel_candles || 1,
    channel_tf: bot.channel_tf || '60',
    tt_lookback: bot.tt_lookback || 5,
  })
  const u = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }))
  const ind = INDICATORS.find(i => i.value === bot.indicator)
  const labelStyle: CSSProperties = { fontSize: 11, color: 'var(--text-mute)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }

  return (
    <div className="modal-overlay">
      <div style={{ background: 'var(--bg)', boxShadow: 'var(--neu-raised-lg)', borderRadius: 20, padding: '28px 24px', maxWidth: 420, width: '90vw' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>Edit Bot — {bot.name}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-mute)', fontSize: 20, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div><label style={labelStyle}>Bot Name</label><input style={neuInputStyle} value={form.name} onChange={e => u('name', e.target.value)} /></div>
          <div><label style={labelStyle}>Account</label>
            <StaaxSelect value={form.account_id} onChange={v => u('account_id', v)}
              options={accounts.map((a: any) => ({ value: String(a.id), label: `${a.nickname} (${a.broker})` }))} width="100%" />
          </div>
          <div><label style={labelStyle}>Timeframe</label>
            <StaaxSelect value={String(form.timeframe_mins)} onChange={v => u('timeframe_mins', parseInt(v))}
              options={TIMEFRAMES.map(t => ({ value: String(t.value), label: t.label }))} width="100%" />
          </div>
          <div><label style={labelStyle}>Lot Size</label>
            <input style={neuInputStyle} type="number" min={1} value={form.lots} onChange={e => u('lots', parseInt(e.target.value) || 1)} />
          </div>
          {ind?.params.includes('channel_candles') && (
            <div>
              <label style={labelStyle}>Channel Timeframe</label>
              <StaaxSelect value={form.channel_tf} onChange={v => u('channel_tf', v)}
                options={CHANNEL_TFS.map(t => ({ value: t, label: t === 'D' ? 'Daily' : `${t} min` }))} width="100%" />
              <label style={{ ...labelStyle, marginTop: 10 }}>Number of Candles</label>
              <input style={neuInputStyle} type="number" min={1} value={form.channel_candles} onChange={e => u('channel_candles', parseInt(e.target.value) || 1)} />
            </div>
          )}
          {ind?.params.includes('tt_lookback') && (
            <div>
              <label style={labelStyle}>LookBack (1–10)</label>
              <input style={neuInputStyle} type="number" min={1} max={10} value={form.tt_lookback} onChange={e => u('tt_lookback', parseInt(e.target.value) || 5)} />
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 24 }}>
          <NeuBtn onClick={onClose}>Cancel</NeuBtn>
          <NeuBtn variant="accent" onClick={() => onSave(bot.id, form)}>Save Changes</NeuBtn>
        </div>
      </div>
    </div>
  )
}

// ── BotConfigurator ────────────────────────────────────────────────────────────
function BotConfigurator({ accounts, onSave, onClose }: {
  accounts: any[]; onSave: (data: any) => Promise<void>; onClose: () => void
}) {
  const [step, setStep] = useState(1)
  const [form, setForm] = useState({
    name: '', account_id: accounts[0]?.id || '',
    instrument: 'GOLDM', exchange: 'MCX',
    expiry: autoExpiry(),
    indicator: 'dtr', timeframe_mins: 60, lots: 1,
    channel_candles: 1, channel_tf: '60', tt_lookback: 5,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')
  const u = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }))
  const ind = INDICATORS.find(i => i.value === form.indicator)

  const steps = [
    { n: 1, label: 'Instrument' }, { n: 2, label: 'Indicator' },
    { n: 3, label: 'Timeframe' }, { n: 4, label: 'Parameters' }, { n: 5, label: 'Config' },
  ]
  const canNext = () => {
    if (step === 1) return !!form.instrument
    if (step === 2) return !!form.indicator
    if (step === 3) return form.timeframe_mins > 0
    if (step === 4) return true
    return !!form.name.trim() && form.lots > 0
  }

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Bot name is required'); return }
    setSaving(true); setError('')
    try { await onSave(form) }
    catch (e: any) { setError(e?.response?.data?.detail || 'Save failed') }
    finally { setSaving(false) }
  }

  const selStyle = (active: boolean): CSSProperties => ({
    width: '100%', padding: '14px 16px', borderRadius: 12, marginBottom: 8,
    border: 'none',
    background: 'var(--bg)',
    boxShadow: active ? 'var(--neu-inset)' : 'var(--neu-raised-sm)',
    color: active ? 'var(--accent)' : 'var(--text)', cursor: 'pointer', textAlign: 'left',
    transition: 'box-shadow 0.12s, color 0.12s',
  })
  const labelStyle: CSSProperties = { fontSize: 10, color: 'var(--text-mute)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 6 }

  return (
    <div className="modal-overlay">
      <div style={{ background: 'var(--bg)', boxShadow: 'var(--neu-raised-lg)', borderRadius: 20, padding: '28px 24px', maxWidth: 480, width: '90vw' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>Create Bot</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-mute)', fontSize: 20, lineHeight: 1 }}>×</button>
        </div>

        {/* Step progress — all 5 bars neu-inset */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 24 }}>
          {steps.map(s => (
            <div key={s.n} style={{ flex: 1 }}>
              <div style={{ height: 4, borderRadius: 4, background: 'var(--bg)', boxShadow: 'var(--neu-inset)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: step >= s.n ? '100%' : '0%', background: 'var(--accent)', borderRadius: 4, transition: 'width 0.3s ease' }} />
              </div>
              <div style={{ fontSize: 9, color: step >= s.n ? 'var(--accent)' : 'var(--text-mute)', marginTop: 4, textAlign: 'center', fontWeight: step >= s.n ? 700 : 400 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {step === 1 && (
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>Choose Instrument</div>
            {INSTRUMENTS.map(inst => (
              <button key={inst.value} onClick={() => u('instrument', inst.value)} style={selStyle(form.instrument === inst.value)}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{inst.label}</div>
                <div style={{ fontSize: 11, color: 'var(--text-mute)', marginTop: 2 }}>{inst.exchange}</div>
              </button>
            ))}
          </div>
        )}

        {step === 2 && (
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>Choose Indicator</div>
            {INDICATORS.map(ind2 => (
              <button key={ind2.value} onClick={() => u('indicator', ind2.value)} style={selStyle(form.indicator === ind2.value)}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{ind2.label}</div>
                <div style={{ fontSize: 11, color: 'var(--text-mute)', marginTop: 2 }}>
                  {ind2.params.length === 0 ? 'No parameters required' : 'Configurable parameters'}
                </div>
              </button>
            ))}
          </div>
        )}

        {step === 3 && (
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>Choose Timeframe</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {TIMEFRAMES.filter(tf => tf.value < 60).map(tf => (
                  <button key={tf.value} onClick={() => u('timeframe_mins', tf.value)}
                    style={{ ...selStyle(form.timeframe_mins === tf.value), padding: '16px 14px', textAlign: 'center', fontSize: 13, fontWeight: 600, marginBottom: 0 }}>
                    {tf.label}
                  </button>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {TIMEFRAMES.filter(tf => tf.value >= 60).map(tf => (
                  <button key={tf.value} onClick={() => u('timeframe_mins', tf.value)}
                    style={{ ...selStyle(form.timeframe_mins === tf.value), padding: '16px 14px', textAlign: 'center', fontSize: 13, fontWeight: 600, marginBottom: 0 }}>
                    {tf.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 4 && (
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>Indicator Parameters</div>
            {ind?.params.length === 0 ? (
              <div style={{ padding: 20, background: 'var(--bg)', boxShadow: 'var(--neu-inset)', borderRadius: 12, color: 'var(--text-mute)', fontSize: 12, textAlign: 'center' }}>
                DTR Strategy uses fixed mathematical constants.<br />No configuration needed.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {ind?.params.includes('channel_candles') && (
                  <>
                    <div><label style={labelStyle}>Timeframe for Channel Calculation</label>
                      <StaaxSelect value={form.channel_tf} onChange={v => u('channel_tf', v)}
                        options={CHANNEL_TFS.map(t => ({ value: t, label: t === 'D' ? 'Daily' : `${t} min` }))} width="100%" />
                    </div>
                    <div><label style={labelStyle}>Number of Candles</label>
                      <input style={neuInputStyle} type="number" min={1} value={form.channel_candles} onChange={e => u('channel_candles', parseInt(e.target.value) || 1)} />
                    </div>
                  </>
                )}
                {ind?.params.includes('tt_lookback') && (
                  <div><label style={labelStyle}>LookBack Period (1–10)</label>
                    <input style={neuInputStyle} type="number" min={1} max={10} value={form.tt_lookback} onChange={e => u('tt_lookback', parseInt(e.target.value) || 5)} />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {step === 5 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>Final Configuration</div>
            <div style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)', borderRadius: 12, padding: '12px 14px', fontSize: 12, color: 'var(--text-mute)' }}>
              {[
                ['Instrument', form.instrument],
                ['Indicator', INDICATORS.find(i => i.value === form.indicator)?.label],
                ['Timeframe', TIMEFRAMES.find(t => t.value === form.timeframe_mins)?.label],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                  <span>{k}</span><span style={{ color: 'var(--text)', fontWeight: 600 }}>{v}</span>
                </div>
              ))}
            </div>
            <div><label style={labelStyle}>Bot Name</label>
              <input style={neuInputStyle} type="text" placeholder="e.g. GOLDM DTR 1H" value={form.name} onChange={e => u('name', e.target.value)} />
            </div>
            <div><label style={labelStyle}>Account</label>
              <StaaxSelect value={form.account_id} onChange={v => u('account_id', v)}
                options={accounts.map((a: any) => ({ value: String(a.id), label: `${a.nickname} (${a.broker})` }))} width="100%" />
            </div>
            <div><label style={labelStyle}>Lot Size</label>
              <input style={neuInputStyle} type="number" min={1} value={form.lots} onChange={e => u('lots', parseInt(e.target.value) || 1)} />
            </div>
            <div style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)', borderRadius: 10, padding: '10px 14px', fontSize: 11, color: 'var(--accent)' }}>
              Expiry auto-set to current active contract ({autoExpiry()}). Rollover is automatic when ≤5 market days remain.
            </div>
            {error && <div style={{ fontSize: 12, color: 'var(--red)' }}>{error}</div>}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24, gap: 8 }}>
          <NeuBtn onClick={step === 1 ? onClose : () => setStep(s => s - 1)}>
            {step === 1 ? 'Cancel' : '← Back'}
          </NeuBtn>
          {step < 5
            ? <NeuBtn variant="accent" disabled={!canNext()} onClick={() => canNext() && setStep(s => s + 1)}>Next →</NeuBtn>
            : <NeuBtn variant="accent" disabled={saving || !canNext()} onClick={handleSave}>
                {saving ? 'Creating…' : '✓ Create Bot'}
              </NeuBtn>
          }
        </div>
      </div>
    </div>
  )
}

// ── BotCard ────────────────────────────────────────────────────────────────────
function BotCard({ bot, accounts, signals, onUpdate, onArchive, onUnarchive, onDelete, onWarmup }: {
  bot: Bot; accounts: any[]
  signals: BotSignal[]
  onUpdate: (id: string, data: any) => void
  onArchive: (id: string) => void
  onUnarchive: (id: string) => void
  onDelete: (id: string) => void
  onWarmup: (id: string) => Promise<void>
}) {
  const [editBot, setEditBot]     = useState(false)
  const [showDel, setShowDel]     = useState(false)
  const [showArch, setShowArch]   = useState(false)
  const [warmingUp, setWarmingUp] = useState(false)

  // Chart
  const [showChart, setShowChart] = useState(false)
  const [chartData, setChartData] = useState<{ candles: any[]; levels: any; signals: any[]; ltp: number | null } | null>(null)
  const [chartLoading, setChartLoading] = useState(false)

  // Orders (lazy, per-card)
  const [showOrders, setShowOrders] = useState(false)
  const [orders, setOrders]         = useState<BotOrder[]>([])
  const [ordersLoaded, setOrdersLoaded] = useState(false)
  const [ordersLoading, setOrdersLoading] = useState(false)

  // LTP for expanded orders
  const [ltpMap, setLtpMap] = useState<Record<string, number>>({})
  const ltpTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const isActive   = bot.status === 'live' || bot.status === 'active'
  const canStop    = isActive
  const canStart   = bot.status === 'inactive'
  const isArchived = bot.is_archived

  const statusColor = bot.status === 'live'     ? '#22DD88'
                    : bot.status === 'active'   ? '#FF6B00'
                    : bot.status === 'inactive' ? '#FFAA00'
                    : '#FF4444'

  const statusLabel = bot.status === 'live' ? 'LIVE'
                    : bot.status === 'active' ? 'ACTIVE'
                    : bot.status === 'inactive' ? 'INACTIVE'
                    : 'ERROR'

  const indicatorLabel = bot.indicator === 'channel' ? 'CHANNEL'
                       : bot.indicator === 'tt_bands' ? 'TT BANDS'
                       : 'DTR'

  // Last 2 signals for this bot
  const botSignals = [...signals]
    .sort((a, b) => {
      const ta = a.fired_at ? new Date(a.fired_at).getTime() : 0
      const tb = b.fired_at ? new Date(b.fired_at).getTime() : 0
      return tb - ta
    })
    .slice(0, 2)
  const hasFiredToday = signals.some(s => s.status === 'fired')

  // Levels from chart data
  const levels = chartData?.levels ?? null

  // LTP polling for expanded orders
  useEffect(() => {
    if (!showOrders) {
      if (ltpTimerRef.current) { clearInterval(ltpTimerRef.current); ltpTimerRef.current = null }
      return
    }
    const openSymbols = [...new Set(orders.filter(o => o.status === 'open').map(o => o.instrument))]
    if (openSymbols.length === 0) return
    const fetchLtps = () => {
      openSymbols.forEach(sym => {
        apiGet(`/bots/ltp?symbol=${sym}`)
          .then(r => { if (r.data?.ltp != null) setLtpMap(prev => ({ ...prev, [sym]: r.data.ltp })) })
          .catch(() => {})
      })
    }
    fetchLtps()
    ltpTimerRef.current = setInterval(fetchLtps, 5000)
    return () => { if (ltpTimerRef.current) { clearInterval(ltpTimerRef.current); ltpTimerRef.current = null } }
  }, [showOrders, orders])

  const handleToggleOrders = async () => {
    if (!showOrders && !ordersLoaded) {
      setOrdersLoading(true)
      try {
        const r = await botsAPI.botOrders(bot.id)
        setOrders(r.data || [])
        setOrdersLoaded(true)
      } catch {}
      setOrdersLoading(false)
    }
    setShowOrders(v => !v)
  }

  const handleWarmup = async () => {
    setWarmingUp(true)
    try { await onWarmup(bot.id) } catch {}
    setWarmingUp(false)
  }

  // Open order for live P&L
  const openOrder = orders.find(o => o.status === 'open')
  let livePnl: number | null = null
  if (openOrder && openOrder.entry_price != null) {
    const ltp = ltpMap[openOrder.instrument]
    if (ltp != null) {
      livePnl = openOrder.direction === 'BUY'
        ? (ltp - openOrder.entry_price) * openOrder.lots
        : (openOrder.entry_price - ltp) * openOrder.lots
    }
  }

  const openOrderCount = orders.filter(o => o.status === 'open').length

  const metaParts = [
    bot.instrument, bot.exchange,
    `${bot.timeframe_mins}min`,
    bot.indicator === 'channel' && bot.channel_tf ? `${bot.channel_tf}h channel` : null,
    `${bot.lots} lot${bot.lots !== 1 ? 's' : ''}`,
  ].filter(Boolean).join(' · ')

  return (
    <>
      <div style={{ ...neuCard, opacity: isArchived ? 0.6 : 1 }}>

        {/* ── ROW 1: Header ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', flexWrap: 'wrap' }}>

          {/* Status dot */}
          <span style={{
            width: 10, height: 10, borderRadius: '50%', background: statusColor,
            display: 'inline-block', flexShrink: 0,
            animation: isActive ? 'pulse 1.5s infinite' : 'none',
          }} />

          {/* Bot name */}
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, color: 'var(--text)' }}>
            {bot.name}
          </span>

          {/* Indicator badge */}
          <span style={{ background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', borderRadius: 6, padding: '2px 8px', fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-dim)' }}>
            {indicatorLabel}
          </span>

          {/* Status chip */}
          <span style={neuChip(statusColor)}>{statusLabel}</span>

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>

            {/* Warmup */}
            <button title="Warmup — reload historical candles" onClick={handleWarmup} disabled={warmingUp}
              style={{ ...iconBtn(warmingUp), color: warmingUp ? 'var(--accent)' : 'var(--text-dim)' }}>
              <ArrowsClockwise size={14} style={{ animation: warmingUp ? 'spin 0.8s linear infinite' : 'none' }} />
            </button>

            {/* Play / Stop */}
            {canStop && (
              <button title="Stop bot" onClick={() => onUpdate(bot.id, { status: 'inactive' })}
                style={{ ...iconBtn(), color: '#FF4444' }}>
                <Stop size={14} weight="fill" />
              </button>
            )}
            {canStart && !isArchived && (
              <button title="Start bot" onClick={() => onUpdate(bot.id, { status: 'active' })}
                style={{ ...iconBtn(), color: '#22DD88' }}>
                <Play size={14} weight="fill" />
              </button>
            )}

            {/* Settings */}
            <button title="Edit bot" onClick={() => setEditBot(true)} style={iconBtn()}>
              <Gear size={14} />
            </button>

            {/* Archive / Unarchive */}
            {isArchived ? (
              <button title="Unarchive" onClick={() => onUnarchive(bot.id)}
                style={{ ...iconBtn(), color: 'var(--accent-amber)' }}>
                ↩
              </button>
            ) : (
              <button title="Archive" onClick={() => setShowArch(true)} style={iconBtn()}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>
                </svg>
              </button>
            )}

            {/* Delete */}
            <button title="Delete bot" onClick={() => setShowDel(true)}
              style={{ ...iconBtn(), color: '#EF4444' }}>
              <Trash size={14} />
            </button>
          </div>
        </div>

        {/* ── ROW 2: Meta ── */}
        <div style={{ padding: '0 16px 12px', fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
          {metaParts}
        </div>

        {/* ── ROW 3: Levels + Position + P&L ── */}
        <div style={{ padding: '0 16px 12px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          {/* Levels */}
          <div style={{ display: 'flex', gap: 12, fontSize: 11 }}>
            {bot.indicator === 'dtr' && levels && <>
              <span><span style={{ color: 'var(--text-mute)' }}>UPP1 </span><span style={{ color: '#2DD4BF', fontFamily: 'var(--font-mono)' }}>{levels.upp1?.toLocaleString('en-IN') ?? '—'}</span></span>
              <span><span style={{ color: 'var(--text-mute)' }}>LPP1 </span><span style={{ color: '#2DD4BF', fontFamily: 'var(--font-mono)' }}>{levels.lpp1?.toLocaleString('en-IN') ?? '—'}</span></span>
            </>}
            {bot.indicator === 'channel' && levels && <>
              <span><span style={{ color: 'var(--text-mute)' }}>Upper </span><span style={{ color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>{levels.upper_channel?.toLocaleString('en-IN') ?? '—'}</span></span>
              <span><span style={{ color: 'var(--text-mute)' }}>Lower </span><span style={{ color: 'var(--red)', fontFamily: 'var(--font-mono)' }}>{levels.lower_channel?.toLocaleString('en-IN') ?? '—'}</span></span>
            </>}
            {bot.indicator === 'tt_bands' && levels && <>
              <span><span style={{ color: 'var(--text-mute)' }}>High </span><span style={{ color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>{levels.tt_high?.toLocaleString('en-IN') ?? '—'}</span></span>
              <span><span style={{ color: 'var(--text-mute)' }}>Low </span><span style={{ color: 'var(--red)', fontFamily: 'var(--font-mono)' }}>{levels.tt_low?.toLocaleString('en-IN') ?? '—'}</span></span>
            </>}
            {!levels && <span style={{ fontSize: 10, color: 'var(--text-mute)', fontStyle: 'italic' }}>— warmup to see levels</span>}
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
            {/* Position chip */}
            {openOrder ? (
              <span style={neuChip(openOrder.direction === 'BUY' ? '#22DD88' : '#FF4444')}>
                {openOrder.direction === 'BUY' ? 'LONG' : 'SHORT'} @{openOrder.entry_price?.toLocaleString('en-IN') ?? '—'}
              </span>
            ) : (
              <span style={{ fontSize: 11, color: 'var(--text-mute)', fontFamily: 'var(--font-mono)' }}>FLAT</span>
            )}

            {/* P&L */}
            {livePnl != null && (
              <span style={{ fontSize: 13, fontFamily: 'var(--font-mono)', fontWeight: 700, color: livePnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {livePnl >= 0 ? '+' : ''}₹{Math.round(livePnl).toLocaleString('en-IN')}
              </span>
            )}
          </div>
        </div>

        {/* ── Divider ── */}
        <div style={{ height: 1, background: 'var(--border)', margin: '0 0' }} />

        {/* ── ROW 4: Signals (always visible) ── */}
        <div style={{ padding: '10px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: botSignals.length > 0 ? 8 : 0 }}>
            <span style={secLabel}>Signals</span>
            {hasFiredToday && (
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', display: 'inline-block', animation: 'pulse 1.5s infinite', marginBottom: 8 }} />
            )}
          </div>
          {botSignals.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {botSignals.map(sig => {
                const isBuy = sig.direction === 'BUY' || sig.direction === 'buy'
                const statusColor2 = sig.status === 'fired' ? '#22DD88' : sig.status === 'error' ? '#FF4444' : '#F59E0B'
                return (
                  <div key={sig.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
                    <span style={{ color: isBuy ? '#22DD88' : '#FF4444', fontWeight: 700, fontSize: 13 }}>{isBuy ? '↑' : '↓'}</span>
                    <span style={{ color: isBuy ? '#22DD88' : '#FF4444', fontWeight: 700 }}>{isBuy ? 'BUY' : 'SELL'}</span>
                    <span style={{ color: 'var(--text-mute)', fontFamily: 'var(--font-mono)' }}>
                      {sig.fired_at ? new Date(sig.fired_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }) : '—'}
                    </span>
                    {sig.trigger_price != null && (
                      <span style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>₹{sig.trigger_price.toLocaleString('en-IN')}</span>
                    )}
                    <span style={neuChip(statusColor2)}>{sig.status.toUpperCase()}</span>
                    {sig.reason && <span style={{ fontSize: 10, color: 'var(--text-mute)', marginLeft: 2 }}>{sig.reason}</span>}
                  </div>
                )
              })}
            </div>
          ) : (
            <span style={{ fontSize: 11, color: 'var(--text-mute)', fontStyle: 'italic' }}>No signals today</span>
          )}
        </div>

        {/* ── Divider ── */}
        <div style={{ height: 1, background: 'var(--border)' }} />

        {/* ── ROW 5: Orders toggle ── */}
        <button
          onClick={handleToggleOrders}
          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-display)' }}
        >
          <span>Orders</span>
          {ordersLoading && <span style={{ fontSize: 10, color: 'var(--text-mute)' }}>Loading…</span>}
          {!ordersLoading && openOrderCount > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--green)' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', display: 'inline-block' }} />
              {openOrderCount} open
            </span>
          )}
          <span style={{ marginLeft: 'auto', color: 'var(--text-mute)' }}>
            {showOrders ? <CaretUp size={12} /> : <CaretDown size={12} />}
          </span>
        </button>

        {showOrders && (
          <div style={{ padding: '0 0 12px' }}>
            {orders.length === 0 ? (
              <div style={{ padding: '8px 16px', fontSize: 11, color: 'var(--text-mute)', fontStyle: 'italic' }}>No orders yet</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 64px 88px 88px 80px 64px', gap: '0', minWidth: 520, fontSize: 10 }}>
                  {/* Header */}
                  {['#', 'Symbol', 'Side', 'Entry ₹', 'Exit ₹', 'P&L', 'Status'].map(h => (
                    <div key={h} style={{ padding: '4px 8px', color: 'var(--text-mute)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', borderBottom: '0.5px solid var(--border)' }}>{h}</div>
                  ))}
                  {/* Rows */}
                  {[...orders].sort((a, b) => {
                    const ta = a.entry_time ? new Date(a.entry_time).getTime() : 0
                    const tb = b.entry_time ? new Date(b.entry_time).getTime() : 0
                    return tb - ta
                  }).map((o, i) => {
                    const ltp = ltpMap[o.instrument]
                    const livePnlRow = o.status === 'open' && ltp != null && o.entry_price != null
                      ? (o.direction === 'BUY' ? (ltp - o.entry_price) * o.lots : (o.entry_price - ltp) * o.lots)
                      : null
                    const displayPnl = livePnlRow ?? o.pnl ?? null
                    const statusColor3 = o.status === 'open' ? '#22DD88' : o.status === 'error' ? '#FF4444' : 'var(--text-dim)'
                    return [
                      <div key={`${o.id}-n`}  style={{ padding: '5px 8px', fontFamily: 'var(--font-mono)', color: 'var(--text-mute)', borderBottom: '0.5px solid var(--border)' }}>{i + 1}</div>,
                      <div key={`${o.id}-s`}  style={{ padding: '5px 8px', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', borderBottom: '0.5px solid var(--border)' }}>{o.instrument}</div>,
                      <div key={`${o.id}-d`}  style={{ padding: '5px 8px', borderBottom: '0.5px solid var(--border)' }}>
                        <span style={neuChip(o.direction === 'BUY' ? '#22DD88' : '#FF4444')}>{o.direction}</span>
                      </div>,
                      <div key={`${o.id}-e`}  style={{ padding: '5px 8px', fontFamily: 'var(--font-mono)', color: 'var(--text)', borderBottom: '0.5px solid var(--border)' }}>{o.entry_price != null ? `₹${o.entry_price.toLocaleString('en-IN')}` : '—'}</div>,
                      <div key={`${o.id}-x`}  style={{ padding: '5px 8px', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', borderBottom: '0.5px solid var(--border)' }}>{o.exit_price != null ? `₹${o.exit_price.toLocaleString('en-IN')}` : '—'}</div>,
                      <div key={`${o.id}-p`}  style={{ padding: '5px 8px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: displayPnl != null ? (displayPnl >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--text-mute)', borderBottom: '0.5px solid var(--border)' }}>
                        {displayPnl != null ? `${displayPnl >= 0 ? '+' : ''}₹${Math.round(displayPnl).toLocaleString('en-IN')}` : '—'}
                        {livePnlRow != null && <span style={{ fontSize: 8, marginLeft: 3, opacity: 0.6 }}>●</span>}
                      </div>,
                      <div key={`${o.id}-st`} style={{ padding: '5px 8px', borderBottom: '0.5px solid var(--border)' }}>
                        <span style={{ ...neuChip(statusColor3), fontSize: 9 }}>{o.status.toUpperCase()}</span>
                      </div>,
                    ]
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── ROW 6: Chart toggle ── */}
        <div style={{ borderTop: '1px solid var(--border)', padding: '8px 16px', display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={async () => {
              if (!showChart && !chartData) {
                setChartLoading(true)
                try { const res = await apiGet(`/bots/${bot.id}/chart-data?limit=100`); setChartData(res.data) } catch {}
                setChartLoading(false)
              }
              setShowChart(v => !v)
            }}
            style={{ fontSize: 11, color: 'var(--text-mute)', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
          >
            {chartLoading ? 'Loading...' : showChart ? <><CaretUp size={11} /> Chart</> : <><CaretDown size={11} /> Chart</>}
          </button>
        </div>

        {showChart && chartData && (
          <div style={{ padding: '0 8px 12px', height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData.candles} margin={{ top: 4, right: 4, bottom: 4, left: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="time"
                  tickFormatter={(t) => new Date(t * 1000).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })}
                  tick={{ fontSize: 9, fill: 'var(--text-mute)' }} minTickGap={40} />
                <YAxis tick={{ fontSize: 9, fill: 'var(--text-mute)' }} domain={['auto', 'auto']} />
                <Line type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={1.5} dot={false} />
                {chartData.levels?.upp1           && <ReferenceLine y={chartData.levels.upp1}           stroke="#2DD4BF" strokeDasharray="4 2" label={{ value: `UPP1 ${chartData.levels.upp1?.toLocaleString('en-IN')}`,           position: 'insideTopLeft', fontSize: 9, fill: '#2DD4BF' }} />}
                {chartData.levels?.lpp1           && <ReferenceLine y={chartData.levels.lpp1}           stroke="#2DD4BF" strokeDasharray="4 2" label={{ value: `LPP1 ${chartData.levels.lpp1?.toLocaleString('en-IN')}`,           position: 'insideTopLeft', fontSize: 9, fill: '#2DD4BF' }} />}
                {chartData.levels?.upper_channel  && <ReferenceLine y={chartData.levels.upper_channel}  stroke="#22DD88" strokeDasharray="4 2" />}
                {chartData.levels?.lower_channel  && <ReferenceLine y={chartData.levels.lower_channel}  stroke="#FF4444" strokeDasharray="4 2" />}
                {chartData.levels?.tt_high        && <ReferenceLine y={chartData.levels.tt_high}        stroke="#22DD88" strokeDasharray="4 2" />}
                {chartData.levels?.tt_low         && <ReferenceLine y={chartData.levels.tt_low}         stroke="#FF4444" strokeDasharray="4 2" />}
                {chartData.ltp && <ReferenceLine y={chartData.ltp} stroke="var(--accent)" strokeWidth={1}
                  label={{ value: `LTP ${chartData.ltp?.toLocaleString('en-IN')}`, position: 'insideTopRight', fontSize: 9, fill: 'var(--accent)' }} />}
                {chartData.signals.filter((s: any) => s.time > 0 && s.price).map((sig: any, i: number) => (
                  <ReferenceDot key={i} x={sig.time} y={sig.price} r={4}
                    fill={sig.direction === 'buy' ? '#2DD4BF' : '#FF4444'} stroke="none"
                    label={{ value: sig.direction === 'buy' ? '▲' : '▼', position: sig.direction === 'buy' ? 'top' : 'bottom', fontSize: 10, fill: sig.direction === 'buy' ? '#2DD4BF' : '#FF4444' }} />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {editBot && (
        <EditBotModal bot={bot} accounts={accounts}
          onSave={async (id, data) => { await onUpdate(id, data); setEditBot(false) }}
          onClose={() => setEditBot(false)} />
      )}
      {showDel && (
        <ConfirmModal title="Delete Bot" desc={`Permanently delete "${bot.name}"? This cannot be undone.`}
          confirmLabel="Delete" confirmColor="var(--red)"
          onConfirm={() => { onDelete(bot.id); setShowDel(false) }}
          onCancel={() => setShowDel(false)} />
      )}
      {showArch && (
        <ConfirmModal title="Archive Bot" desc={`Archive "${bot.name}"? It can be restored later.`}
          confirmLabel="Archive" confirmColor="var(--accent-amber)"
          onConfirm={() => { onArchive(bot.id); setShowArch(false) }}
          onCancel={() => setShowArch(false)} />
      )}
    </>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function IndicatorsPage() {
  const isPractixMode = useStore(s => s.isPractixMode)
  const [bots, setBots]           = useState<Bot[]>([])
  const [accounts, setAccounts]   = useState<any[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [loading, setLoading]     = useState(true)
  const [signals, setSignals]     = useState<BotSignal[]>([])
  const signalTimerRef            = useRef<ReturnType<typeof setInterval> | null>(null)

  // Load bots + accounts on mount
  useEffect(() => {
    Promise.all([
      apiGet(`/bots/?is_practix=${isPractixMode}`).then(r => setBots(r.data || [])),
      accountsAPI.list().then(r => setAccounts(r.data || [])),
    ]).finally(() => setLoading(false))
  }, [isPractixMode])

  // Load signals + start 30s refresh
  const fetchSignals = () => {
    botsAPI.signalsToday()
      .then(r => setSignals(r.data?.signals || []))
      .catch(() => {})
  }
  useEffect(() => {
    fetchSignals()
    signalTimerRef.current = setInterval(fetchSignals, 30000)
    return () => { if (signalTimerRef.current) clearInterval(signalTimerRef.current) }
  }, [isPractixMode])

  // WebSocket — refresh signals on bot signal fire
  useEffect(() => {
    const wsUrl = ((import.meta as any).env?.VITE_API_URL || 'http://localhost:8000')
      .replace('http://', 'ws://')
      .replace('https://', 'wss://')
    const ws = new WebSocket(`${wsUrl}/ws/notifications`)
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'notification' && msg.data?.algo_name) fetchSignals()
      } catch {}
    }
    ws.onerror = () => {}
    return () => { ws.close() }
  }, [])

  // Handlers
  const handleSave = async (form: any) => {
    const res = await apiPost('/bots/', { ...form, is_practix: isPractixMode })
    setBots(prev => [res.data, ...prev])
    setShowCreate(false)
  }
  const handleUpdate = async (id: string, data: any) => {
    await apiPatch(`/bots/${id}`, data)
    setBots(prev => prev.map(b => b.id === id ? { ...b, ...data } : b))
  }
  const handleArchive = async (id: string) => {
    await apiPost(`/bots/${id}/archive`, {})
    setBots(prev => prev.map(b => b.id === id ? { ...b, is_archived: true, status: 'inactive' } : b))
  }
  const handleUnarchive = async (id: string) => {
    await apiPatch(`/bots/${id}`, { is_archived: false, status: 'active' })
    setBots(prev => prev.map(b => b.id === id ? { ...b, is_archived: false, status: 'active' } : b))
  }
  const handleDelete = async (id: string) => {
    await apiDel(`/bots/${id}`)
    setBots(prev => prev.filter(b => b.id !== id))
  }
  const handleWarmup = async (id: string) => {
    await apiPost(`/bots/${id}/warmup`, {})
  }

  const activeBots   = bots.filter(b => !b.is_archived)
  const archivedBots = bots.filter(b => b.is_archived)
  const runningCount = activeBots.filter(b => b.status === 'live' || b.status === 'active').length

  // Group active bots by exchange for section headers
  const exchanges = [...new Set(activeBots.map(b => b.exchange))].sort()
  const multiExchange = exchanges.length > 1

  const botCardProps = (bot: Bot) => ({
    key: bot.id,
    bot, accounts,
    signals: signals.filter(s => s.bot_id === bot.id),
    onUpdate: handleUpdate,
    onArchive: handleArchive,
    onUnarchive: handleUnarchive,
    onDelete: handleDelete,
    onWarmup: handleWarmup,
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 92px)' }}>

      {/* Page header */}
      <div className="page-header" style={{ flexShrink: 0 }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, color: 'var(--text)' }}>Bots</h1>
          <p style={{ fontSize: 12, color: 'var(--text-mute)', marginTop: 3 }}>
            {loading ? 'Loading...' : `${runningCount} running · ${activeBots.length} total`}
          </p>
        </div>
        <div className="page-header-actions">
          {archivedBots.length > 0 && (
            <button style={{ ...ghostBtn, height: 30, fontSize: 11 }} onClick={() => setShowArchived(v => !v)}>
              {showArchived ? 'Hide' : 'Show'} Archived ({archivedBots.length})
            </button>
          )}
          <NeuBtn variant="accent" onClick={() => setShowCreate(true)}>+ New Bot</NeuBtn>
        </div>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px 32px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 64, color: 'var(--text-mute)', fontSize: 13 }}>Loading…</div>
        ) : activeBots.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ fontSize: 32, marginBottom: 12, color: 'var(--text-mute)' }}>◇</div>
            <div style={{ fontSize: 16, fontWeight: 500, fontFamily: 'var(--font-display)', color: 'var(--text-dim)', marginBottom: 6 }}>No bots yet</div>
            <div style={{ fontSize: 12, color: 'var(--text-mute)', marginBottom: 24 }}>Create a bot to start running indicator-based strategies</div>
            <NeuBtn onClick={() => setShowCreate(true)}>+ Create Your First Bot</NeuBtn>
          </div>
        ) : (
          <>
            {multiExchange ? (
              exchanges.map(exchange => {
                const group = activeBots.filter(b => b.exchange === exchange)
                if (group.length === 0) return null
                return (
                  <div key={exchange}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 8, marginBottom: 8, borderBottom: '1px solid var(--border)', marginTop: 16 }}>
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700, color: 'var(--accent)', letterSpacing: '2px', textTransform: 'uppercase' }}>
                        {exchange}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{group.length} bot{group.length !== 1 ? 's' : ''}</span>
                    </div>
                    {group.map(bot => <BotCard {...botCardProps(bot)} />)}
                  </div>
                )
              })
            ) : (
              activeBots.map(bot => <BotCard {...botCardProps(bot)} />)
            )}

            {/* Archived section */}
            {showArchived && archivedBots.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 8, marginBottom: 8, borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700, color: 'var(--accent-amber)', letterSpacing: '2px', textTransform: 'uppercase' }}>
                    Archived
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{archivedBots.length} bot{archivedBots.length !== 1 ? 's' : ''}</span>
                </div>
                {archivedBots.map(bot => <BotCard {...botCardProps(bot)} />)}
              </div>
            )}
          </>
        )}
      </div>

      {showCreate && (
        <BotConfigurator accounts={accounts} onSave={handleSave} onClose={() => setShowCreate(false)} />
      )}
    </div>
  )
}
