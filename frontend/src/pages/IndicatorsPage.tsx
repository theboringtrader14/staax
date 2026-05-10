import { useState, useEffect, useRef, type CSSProperties } from 'react'
import { ArrowsClockwise, Gear, Trash } from '@phosphor-icons/react'
import { accountsAPI } from '@/services/api'
import BotChart from '../components/BotChart'
import axios from 'axios'
import { useStore } from '@/store'
import { StaaxSelect } from '@/components/StaaxSelect'

const API = `${import.meta.env.VITE_API_URL || 'http://localhost:8000'}/api/v1`
const auth = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('staax_token')}` } })
const apiGet  = (p: string) => axios.get(`${API}${p}`, auth())
const apiPost = (p: string, d: object = {}) => axios.post(`${API}${p}`, d, auth())
const apiPatch= (p: string, d: object) => axios.patch(`${API}${p}`, d, auth())
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
  marginBottom: 16,
  overflow: 'hidden',
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
    variant === 'accent' ? { background: 'var(--bg)', color: 'var(--accent)'       } :
    variant === 'danger' ? { background: 'var(--bg)', color: '#EF4444'             } :
    variant === 'warn'   ? { background: 'var(--bg)', color: 'var(--accent-amber)' } :
                           { background: 'var(--bg)', color: 'var(--text-dim)'     }

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


// ── Types ──────────────────────────────────────────────────────────────────────
type AccountOption = { id: string; nickname: string; broker: string }

type Bot = {
  id: string; name: string; account_id: string; instrument: string
  exchange: string; expiry: string; indicator: string
  timeframe_mins: number; lots: number
  channel_candles?: number; channel_tf?: string; tt_lookback?: number
  status: string; is_archived: boolean; is_practix?: boolean
  pinescript_code?: string;
}


// ── EditBotModal ───────────────────────────────────────────────────────────────
function EditBotModal({ bot, accounts, onSave, onClose }: {
  bot: Bot; accounts: AccountOption[]; onSave: (id: string, data: Partial<Bot>) => void; onClose: () => void
}) {
  const [form, setForm] = useState({
    name: bot.name, lots: bot.lots, account_id: bot.account_id,
    timeframe_mins: bot.timeframe_mins,
    channel_candles: bot.channel_candles || 1,
    channel_tf: bot.channel_tf || '60',
    tt_lookback: bot.tt_lookback || 5,
  })
  const u = (k: keyof typeof form, v: string | number) => setForm(f => ({ ...f, [k]: v }))
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
              options={accounts.map((a) => ({ value: String(a.id), label: `${a.nickname} (${a.broker})` }))} width="100%" />
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
  accounts: AccountOption[]; onSave: (data: Omit<Bot, 'id' | 'status' | 'is_archived'>) => Promise<void>; onClose: () => void
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
  const u = (k: keyof typeof form, v: string | number) => setForm(f => ({ ...f, [k]: v }))
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
    try { await onSave(form as Omit<Bot, 'id' | 'status' | 'is_archived'>) }
    catch (e) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err?.response?.data?.detail || 'Save failed')
    }
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
                options={accounts.map((a) => ({ value: String(a.id), label: `${a.nickname} (${a.broker})` }))} width="100%" />
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
function BotCard({ bot, accounts, onUpdate, onArchive, onUnarchive, onDelete, onWarmup, isSelected, onSelect }: {
  bot: Bot; accounts: AccountOption[]
  onUpdate: (id: string, data: Partial<Bot>) => void
  onArchive: (id: string) => void
  onUnarchive: (id: string) => void
  onDelete: (id: string) => void
  onWarmup: (id: string) => Promise<void>
  isSelected?: boolean
  onSelect?: () => void
}) {
  const [editBot, setEditBot]       = useState(false)
  const [showRemove, setShowRemove] = useState(false)
  const [warmingUp, setWarmingUp]   = useState(false)

  // Live levels + LTP (fetched from chart-data endpoint every 30s)
  const [cardLevels, setCardLevels] = useState<Record<string, number> | null>(null)
  const [cardLtp, setCardLtp]       = useState<number | null>(null)
  const [cardLtpAt, setCardLtpAt]   = useState<number | null>(null)  // Date.now() of last fetch
  useEffect(() => {
    const fetchLevels = () => {
      apiGet(`/bots/${bot.id}/chart-data`)
        .then(r => {
          const d = r.data
          if (d?.levels && Object.keys(d.levels).length > 0) setCardLevels(d.levels)
          if (d?.ltp != null && d.ltp > 0) { setCardLtp(d.ltp); setCardLtpAt(Date.now()) }
        })
        .catch(() => {})
    }
    fetchLevels()
    const t = setInterval(fetchLevels, 30000)
    return () => clearInterval(t)
  }, [bot.id])



  const isActive   = bot.status === 'live' || bot.status === 'active'
  const isArchived = bot.is_archived

  const statusColor = bot.status === 'live'     ? 'var(--green)'
                    : bot.status === 'active'   ? '#FF6B00'
                    : bot.status === 'inactive' ? '#FFAA00'
                    : '#FF4444'

  const indicatorLabel = bot.indicator === 'channel' ? 'CHANNEL'
                       : bot.indicator === 'tt_bands' ? 'TT BANDS'
                       : 'DTR'

  const levels = cardLevels

  const handleWarmup = async () => {
    setWarmingUp(true)
    try { await onWarmup(bot.id) } catch (e) { console.warn('[IndicatorsPage] warmup failed', e) }
    setWarmingUp(false)
  }

  const metaParts = [
    bot.instrument, bot.exchange,
    `${bot.timeframe_mins}min`,
    bot.indicator === 'channel' && bot.channel_tf ? `${bot.channel_tf}h channel` : null,
    `${bot.lots} lot${bot.lots !== 1 ? 's' : ''}`,
  ].filter(Boolean).join(' · ')

  return (
    <>
      <div onClick={onSelect} style={{ ...neuCard, opacity: isArchived ? 0.6 : 1, position: 'relative', paddingLeft: 28, outline: isSelected ? '2px solid var(--accent)' : '2px solid transparent', outlineOffset: -2, cursor: 'pointer' }}>

        {/* ── Enable/disable strip (same as algo card) ── */}
        {!isArchived && (
          <div
            className={`algo-enable-strip${isActive ? ' enabled' : ' disabled'}`}
            onClick={() => onUpdate(bot.id, { status: isActive ? 'inactive' : 'active' })}
            title={isActive ? 'Click to stop bot' : 'Click to start bot'}
          >
            <div className="algo-enable-strip-thumb" />
          </div>
        )}

        {/* ── Main content row: left info + right buttons, vertically centered ── */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px 10px', gap: 10 }}>

          {/* Left: status dot + stacked name/meta/levels */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flex: 1, minWidth: 0 }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%', background: statusColor,
              display: 'inline-block', flexShrink: 0, marginTop: 5,
              animation: isActive ? 'pulse 1.5s infinite' : 'none',
            }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* Name + indicator chip */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14, color: 'var(--accent)', fontVariantNumeric: 'lining-nums tabular-nums', whiteSpace: 'nowrap' }}>
                  {bot.name}
                </span>
                <span style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)', borderRadius: 6, padding: '2px 7px', fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-dim)', flexShrink: 0 }}>
                  {indicatorLabel}
                </span>
              </div>
              {/* Meta */}
              <div style={{ fontSize: 10, color: 'var(--text-mute)', fontFamily: 'var(--font-mono)', marginBottom: 4 }}>
                {metaParts}
              </div>
              {/* Levels + LTP row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', fontSize: 11 }}>
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
          {!levels && <span style={{ fontSize: 10, color: 'var(--text-mute)', fontStyle: 'italic' }}>warmup to see levels</span>}
          {cardLtp != null && (() => {
            const ltp = cardLtp!
            const fresh = cardLtpAt != null && (Date.now() - cardLtpAt) < 35000
            return (
              <span>
                <span style={{ color: 'var(--text-mute)' }}>LTP </span>
                <span style={{ color: fresh ? 'var(--green)' : 'var(--text-mute)', fontSize: 8, marginRight: 2 }}>{fresh ? '●' : '○'}</span>
                <span style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>{ltp.toLocaleString('en-IN')}</span>
              </span>
            )
          })()}
              <span style={{ color: 'var(--border)', fontSize: 14, userSelect: 'none' }}>·</span>
              <span style={{ fontSize: 11, color: 'var(--text-mute)', fontFamily: 'var(--font-mono)' }}>FLAT</span>
            </div>{/* end levels row */}
          </div>{/* end left info column */}
          </div>{/* end status dot + info */}

          {/* Right: action buttons — centered to full card height */}
          <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
            {(() => {
              const sq = (color = 'var(--text-dim)'): CSSProperties => ({
                display:'flex', alignItems:'center', justifyContent:'center',
                width:40, height:40, borderRadius:12,
                background:'var(--bg)', border:'none', boxShadow:'var(--neu-raised-sm)',
                cursor:'pointer', color, transition:'box-shadow 0.12s', flexShrink:0,
              })
              const bind = (el: HTMLButtonElement | null) => {
                if (!el) return
                el.onmousedown = () => (el.style.boxShadow = 'var(--neu-inset)')
                el.onmouseup = () => (el.style.boxShadow = 'var(--neu-raised-sm)')
                el.onmouseleave = () => (el.style.boxShadow = 'var(--neu-raised-sm)')
              }
              return (
                <>
                  <button ref={bind} title="Warmup — reload historical candles"
                    onClick={handleWarmup} disabled={warmingUp}
                    style={{ ...sq('var(--accent)'), opacity: warmingUp ? 0.7 : 1 }}>
                    <ArrowsClockwise size={18} style={{ animation: warmingUp ? 'spin 0.8s linear infinite' : 'none' }} />
                  </button>
                  <button ref={bind} title="Edit bot" onClick={() => setEditBot(true)} style={sq('var(--accent)')}>
                    <Gear size={18} />
                  </button>
                  {isArchived ? (
                    <button ref={bind} title="Unarchive bot" onClick={() => onUnarchive(bot.id)} style={sq('var(--accent-amber)')}>↩</button>
                  ) : (
                    <button ref={bind} title="Remove bot" onClick={() => setShowRemove(true)} style={sq('#EF4444')}>
                      <Trash size={18} weight="regular" />
                    </button>
                  )}
                </>
              )
            })()}
          </div>
        </div>{/* end main content row */}


      </div>

      {editBot && (
        <EditBotModal bot={bot} accounts={accounts}
          onSave={async (id, data) => { await onUpdate(id, data); setEditBot(false) }}
          onClose={() => setEditBot(false)} />
      )}
      {showRemove && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: 380 }}>
            <div style={{ fontWeight:700, fontSize:16, marginBottom:8 }}>Remove {bot.name}?</div>
            <div style={{ fontSize:13, color:'var(--text-muted)', lineHeight:1.6, marginBottom:20 }}>
              Archive hides it from the grid but keeps all history. Delete removes it permanently — trade data is preserved.
            </div>
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
              {(['Cancel','Archive','Delete'] as const).map(action => (
                <button key={action}
                  style={{ background:'var(--bg)', boxShadow:'var(--neu-raised-sm)', border:'none', borderRadius:100, padding:'7px 20px', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'var(--font-display)',
                    color: action === 'Archive' ? '#60A5FA' : action === 'Delete' ? '#FF4444' : 'var(--text-dim)',
                    transition:'box-shadow 0.12s',
                  }}
                  onMouseDown={e => (e.currentTarget.style.boxShadow='var(--neu-inset)')}
                  onMouseUp={e => (e.currentTarget.style.boxShadow='var(--neu-raised-sm)')}
                  onMouseLeave={e => (e.currentTarget.style.boxShadow='var(--neu-raised-sm)')}
                  onClick={() => {
                    if (action === 'Cancel') { setShowRemove(false) }
                    else if (action === 'Archive') { onArchive(bot.id); setShowRemove(false) }
                    else { onDelete(bot.id); setShowRemove(false) }
                  }}
                >{action}</button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function IndicatorsPage({ hideHeader, newBotTriggerRef, onArchivedChange }: {
  hideHeader?: boolean
  newBotTriggerRef?: React.MutableRefObject<(() => void) | null>
  onArchivedChange?: (archived: Bot[], unarchive: (id: string) => void) => void
} = {}) {
  const isPractixMode = useStore(s => s.isPractixMode)
  const [bots, setBots]               = useState<Bot[]>([])
  const [accounts, setAccounts]       = useState<any[]>([])
  const [showCreate, setShowCreate]   = useState(false)
  const [loading, setLoading]         = useState(true)
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null)
  useEffect(() => {
    if (newBotTriggerRef) newBotTriggerRef.current = () => setShowCreate(true)
    return () => { if (newBotTriggerRef) newBotTriggerRef.current = null }
  }, [newBotTriggerRef])
  // Load bots + accounts on mount
  useEffect(() => {
    Promise.all([
      apiGet(`/bots/?is_practix=${isPractixMode}`).then(r => setBots(r.data || [])),
      accountsAPI.list().then(r => setAccounts(r.data || [])),
    ]).finally(() => setLoading(false))
  }, [isPractixMode])

  // Auto-select first active bot when list loads
  useEffect(() => {
    if (selectedBotId === null) {
      const firstActive = bots.find(b => !b.is_archived)
      if (firstActive) setSelectedBotId(firstActive.id)
    }
  }, [bots])

  // WebSocket — refresh bots list on notifications
  useEffect(() => {
    const wsUrl = (import.meta.env.VITE_API_URL || 'http://localhost:8000')
      .replace('http://', 'ws://')
      .replace('https://', 'wss://')
    const ws = new WebSocket(`${wsUrl}/ws/notifications`)
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'notification' && msg.data?.algo_name) {
          // no-op — per-card chart-data fetch handles live updates
        }
      } catch {}
    }
    ws.onerror = () => {}
    return () => { ws.close() }
  }, [])

  // Handlers
  const handleSave = async (form: Omit<Bot, 'id' | 'status' | 'is_archived'>) => {
    const res = await apiPost('/bots/', { ...form, is_practix: isPractixMode })
    setBots(prev => [res.data as Bot, ...prev])
    setShowCreate(false)
  }
  const handleUpdate = async (id: string, data: Partial<Bot>) => {
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

  useEffect(() => {
    if (onArchivedChange) onArchivedChange(archivedBots, handleUnarchive)
  }, [archivedBots.length])

  // Group active bots by exchange for section headers
  const exchanges = [...new Set(activeBots.map(b => b.exchange))].sort()
  const multiExchange = exchanges.length > 1

  const botCardProps = (bot: Bot) => ({
    key: bot.id,
    bot, accounts,
    onUpdate: handleUpdate,
    onArchive: handleArchive,
    onUnarchive: handleUnarchive,
    onDelete: handleDelete,
    onWarmup: handleWarmup,
    isSelected: selectedBotId === bot.id,
    onSelect: () => setSelectedBotId(bot.id),
  })

  const selectedBot = activeBots.find(b => b.id === selectedBotId) ?? null
  const tfLabel = selectedBot
    ? (TIMEFRAMES.find(t => t.value === selectedBot.timeframe_mins)?.label ?? `${selectedBot.timeframe_mins}m`)
    : ''
  const indLabel = selectedBot
    ? (selectedBot.indicator === 'channel' ? 'CHANNEL' : selectedBot.indicator === 'tt_bands' ? 'TT BANDS' : 'DTR')
    : ''

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 92px)', overflow: 'hidden' }}>

      {/* Page header — hidden when embedded in GridPage tab */}
      {!hideHeader && (
        <div className="page-header" style={{ flexShrink: 0, padding: '0 28px', marginBottom: 0 }}>
          <div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, color: 'var(--accent)' }}>Bots</h1>
            <p style={{ fontSize: 12, color: 'var(--text-mute)', marginTop: 3 }}>
              {loading ? 'Loading...' : `${runningCount} running · ${activeBots.length} total`}
            </p>
          </div>
          <div className="page-header-actions">
            <NeuBtn variant="accent" height={32} onClick={() => setShowCreate(true)}>+ New Bot</NeuBtn>
          </div>
        </div>
      )}

      {/* Top chart panel — shows selected bot's chart */}
      {!loading && selectedBot && (
        <div style={{ flexShrink: 0, padding: hideHeader ? '10px 28px 0' : '14px 28px 0' }}>
          <div style={{ background: 'var(--bg)', borderRadius: 16, boxShadow: 'var(--neu-raised)', overflow: 'hidden', minHeight: 380 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px 0' }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: 'var(--accent)', fontVariantNumeric: 'lining-nums tabular-nums' }}>{selectedBot.name}</span>
              <span style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)', borderRadius: 6, padding: '2px 7px', fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-dim)' }}>{indLabel}</span>
              <span style={{ fontSize: 10, color: 'var(--text-mute)', fontFamily: 'var(--font-mono)' }}>{tfLabel}</span>
            </div>
            <BotChart botId={selectedBot.id} timeframeMins={selectedBot.timeframe_mins} />
          </div>
        </div>
      )}

      {/* Scrollable bot cards */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 28px 32px' }}>
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
          </>
        )}
      </div>

      {showCreate && (
        <BotConfigurator accounts={accounts} onSave={handleSave} onClose={() => setShowCreate(false)} />
      )}
    </div>
  )
}
