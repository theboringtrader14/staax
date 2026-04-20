import { useState, useEffect, useRef } from 'react'
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine, ReferenceDot, ResponsiveContainer } from 'recharts'
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

// ── Platform-style confirm modal ──────────────────────────────────────────────
function ConfirmModal({ title, desc, confirmLabel, confirmColor, onConfirm, onCancel }: {
  title: string; desc: string; confirmLabel: string; confirmColor: string
  onConfirm: () => void; onCancel: () => void
}) {
  const isDanger = confirmColor?.includes('red') || confirmColor?.includes('ef4444')
  const isWarn   = confirmColor?.includes('amber') || confirmColor?.includes('f59e0b') || confirmColor?.includes('215,123')
  const btnVariant = isDanger ? 'btn-danger' : isWarn ? 'btn-warn' : 'btn-primary'
  return (
    <div className="modal-overlay">
      <div className="modal-box cloud-fill" style={{ maxWidth: '380px' }}>
        <div style={{ fontWeight: 700, fontSize: '15px', marginBottom: '8px' }}>{title}</div>
        <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '20px' }}>{desc}</div>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className={`btn ${btnVariant}`} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

// ── Edit Bot Modal ─────────────────────────────────────────────────────────────
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

  return (
    <div className="modal-overlay">
      <div className="modal-box cloud-fill" style={{ maxWidth: '420px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div style={{ fontWeight: 700, fontSize: '15px' }}>Edit Bot — {bot.name}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '18px' }}>×</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: '6px' }}>Bot Name</label>
            <input className="staax-input" value={form.name} onChange={e => u('name', e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: '6px' }}>Account</label>
            <StaaxSelect
              value={form.account_id}
              onChange={v => u('account_id', v)}
              options={accounts.map((a: any) => ({ value: String(a.id), label: `${a.nickname} (${a.broker})` }))}
              width="100%"
            />
          </div>
          <div>
            <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: '6px' }}>Timeframe</label>
            <StaaxSelect
              value={String(form.timeframe_mins)}
              onChange={v => u('timeframe_mins', parseInt(v))}
              options={TIMEFRAMES.map(t => ({ value: String(t.value), label: t.label }))}
              width="100%"
            />
          </div>
          <div>
            <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: '6px' }}>Lot Size</label>
            <input className="staax-input" type="number" min={1} value={form.lots} onChange={e => u('lots', parseInt(e.target.value) || 1)} />
          </div>
          {ind?.params.includes('channel_candles') && (
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: '6px' }}>Channel Timeframe</label>
              <StaaxSelect
                value={form.channel_tf}
                onChange={v => u('channel_tf', v)}
                options={CHANNEL_TFS.map(t => ({ value: t, label: t === 'D' ? 'Daily' : `${t} min` }))}
                width="100%"
              />
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginTop: '10px', marginBottom: '6px' }}>Number of Candles</label>
              <input className="staax-input" type="number" min={1} value={form.channel_candles} onChange={e => u('channel_candles', parseInt(e.target.value) || 1)} />
            </div>
          )}
          {ind?.params.includes('tt_lookback') && (
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: '6px' }}>LookBack (1–10)</label>
              <input className="staax-input" type="number" min={1} max={10} value={form.tt_lookback} onChange={e => u('tt_lookback', parseInt(e.target.value) || 5)} />
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '20px' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(bot.id, form)}>Save Changes</button>
        </div>
      </div>
    </div>
  )
}

// ── 5-Step Bot Configurator ───────────────────────────────────────────────────
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

  return (
    <div className="modal-overlay">
      <div className="modal-box cloud-fill" style={{ maxWidth: '480px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div style={{ fontWeight: 700, fontSize: '15px' }}>Create Bot</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '18px' }}>×</button>
        </div>
        {/* Progress */}
        <div style={{ display: 'flex', gap: '4px', marginBottom: '24px' }}>
          {steps.map(s => (
            <div key={s.n} style={{ flex: 1 }}>
              <div style={{ height: '3px', borderRadius: '2px', background: step >= s.n ? 'var(--indigo)' : 'var(--bg-border)', transition: 'background 0.2s' }}/>
              <div style={{ fontSize: '9px', color: step >= s.n ? 'var(--indigo)' : 'var(--text-dim)', marginTop: '4px', textAlign: 'center' }}>{s.label}</div>
            </div>
          ))}
        </div>

        {step === 1 && (
          <div>
            <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '12px' }}>Choose Instrument</div>
            {INSTRUMENTS.map(inst => (
              <button key={inst.value} onClick={() => u('instrument', inst.value)}
                style={{ width: '100%', padding: '14px 16px', borderRadius: 'var(--radius-md)', marginBottom: '8px',
                  border: `2px solid ${form.instrument === inst.value ? 'var(--indigo)' : 'var(--bg-border)'}`,
                  background: form.instrument === inst.value ? 'var(--indigo-dim)' : 'var(--bg-secondary)',
                  color: 'var(--text)', cursor: 'pointer', textAlign: 'left', transition: 'all 0.12s' }}>
                <div style={{ fontWeight: 700 }}>{inst.label}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{inst.exchange}</div>
              </button>
            ))}
          </div>
        )}

        {step === 2 && (
          <div>
            <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '12px' }}>Choose Indicator</div>
            {INDICATORS.map(ind => (
              <button key={ind.value} onClick={() => u('indicator', ind.value)}
                style={{ width: '100%', padding: '14px 16px', borderRadius: 'var(--radius-md)', marginBottom: '8px',
                  border: `2px solid ${form.indicator === ind.value ? 'var(--indigo)' : 'var(--bg-border)'}`,
                  background: form.indicator === ind.value ? 'var(--indigo-dim)' : 'var(--bg-secondary)',
                  color: 'var(--text)', cursor: 'pointer', textAlign: 'left', transition: 'all 0.12s' }}>
                <div style={{ fontWeight: 700 }}>{ind.label}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  {ind.params.length === 0 ? 'No parameters required' : `Configurable parameters`}
                </div>
              </button>
            ))}
          </div>
        )}

        {step === 3 && (
          <div>
            <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '12px' }}>Choose Timeframe</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {/* Row 1: minutes */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                {TIMEFRAMES.filter(tf => tf.value < 60).map(tf => (
                <button key={tf.value} onClick={() => u('timeframe_mins', tf.value)}
                  style={{ padding: '14px', borderRadius: 'var(--radius-md)', textAlign: 'center',
                    border: `2px solid ${form.timeframe_mins === tf.value ? 'var(--indigo)' : 'var(--bg-border)'}`,
                    background: form.timeframe_mins === tf.value ? 'rgba(255,107,0,0.08)' : 'var(--bg-secondary)',
                    color: form.timeframe_mins === tf.value ? 'var(--indigo)' : 'var(--text)',
                    cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
                  {tf.label}
                </button>
                ))}
              </div>
              {/* Row 2: hours */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                {TIMEFRAMES.filter(tf => tf.value >= 60).map(tf => (
                <button key={tf.value} onClick={() => u('timeframe_mins', tf.value)}
                  style={{ padding: '14px', borderRadius: 'var(--radius-md)', textAlign: 'center',
                    border: `2px solid ${form.timeframe_mins === tf.value ? 'var(--indigo)' : 'var(--bg-border)'}`,
                    background: form.timeframe_mins === tf.value ? 'rgba(255,107,0,0.08)' : 'var(--bg-secondary)',
                    color: form.timeframe_mins === tf.value ? 'var(--indigo)' : 'var(--text)',
                    cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
                  {tf.label}
                </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 4 && (
          <div>
            <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '12px' }}>Indicator Parameters</div>
            {ind?.params.length === 0 ? (
              <div style={{ padding: '20px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center' }}>
                DTR Strategy uses fixed mathematical constants.<br/>No configuration needed.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {ind?.params.includes('channel_candles') && (
                  <>
                    <div>
                      <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: '6px' }}>Timeframe for Channel Calculation</label>
                      <StaaxSelect
                        value={form.channel_tf}
                        onChange={v => u('channel_tf', v)}
                        options={CHANNEL_TFS.map(t => ({ value: t, label: t === 'D' ? 'Daily' : `${t} min` }))}
                        width="100%"
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: '6px' }}>Number of Candles</label>
                      <input className="staax-input" type="number" min={1} value={form.channel_candles} onChange={e => u('channel_candles', parseInt(e.target.value) || 1)} />
                    </div>
                  </>
                )}
                {ind?.params.includes('tt_lookback') && (
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: '6px' }}>LookBack Period (1–10)</label>
                    <input className="staax-input" type="number" min={1} max={10} value={form.tt_lookback} onChange={e => u('tt_lookback', parseInt(e.target.value) || 5)} />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {step === 5 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600 }}>Final Configuration</div>
            <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', padding: '10px 14px', fontSize: '11px', color: 'var(--text-muted)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span>Instrument</span><span style={{ color: 'var(--text)', fontWeight: 600 }}>{form.instrument}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span>Indicator</span><span style={{ color: 'var(--text)', fontWeight: 600 }}>{INDICATORS.find(i => i.value === form.indicator)?.label}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Timeframe</span><span style={{ color: 'var(--text)', fontWeight: 600 }}>{TIMEFRAMES.find(t => t.value === form.timeframe_mins)?.label}</span>
              </div>
            </div>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: '6px' }}>Bot Name</label>
              <input className="staax-input" type="text" placeholder="e.g. GOLDM DTR 1H" value={form.name} onChange={e => u('name', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: '6px' }}>Account</label>
              <StaaxSelect
                value={form.account_id}
                onChange={v => u('account_id', v)}
                options={accounts.map((a: any) => ({ value: String(a.id), label: `${a.nickname} (${a.broker})` }))}
                width="100%"
              />
            </div>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: '6px' }}>Lot Size</label>
              <input className="staax-input" type="number" min={1} value={form.lots} onChange={e => u('lots', parseInt(e.target.value) || 1)} />
            </div>
            <div style={{ background: 'var(--indigo-dim)', borderRadius: 'var(--radius-md)', padding: '8px 12px', fontSize: '11px', color: 'var(--indigo)' }}>
              Expiry auto-set to current active contract ({autoExpiry()}). Rollover is automatic when &le;5 market days remain.
            </div>
            {error && <div style={{ fontSize: '12px', color: 'var(--red)' }}>{error}</div>}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '24px', gap: '8px' }}>
          <button className="btn btn-ghost" onClick={step === 1 ? onClose : () => setStep(s => s - 1)}>
            {step === 1 ? 'Cancel' : '← Back'}
          </button>
          {step < 5
            ? <button className="btn btn-primary" onClick={() => setStep(s => s + 1)} disabled={!canNext()}>Next →</button>
            : <button className="btn btn-primary" onClick={handleSave} disabled={saving || !canNext()}>
                {saving ? 'Creating...' : '✓ Create Bot'}
              </button>
          }
        </div>
      </div>
    </div>
  )
}

// ── Icon button style helper ──────────────────────────────────────────────────
const iconBtnStyle: React.CSSProperties = {
  width: '26px', height: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center',
  borderRadius: '6px', background: 'transparent', border: '0.5px solid rgba(255,255,255,0.06)',
  cursor: 'pointer', color: 'rgba(255,255,255,0.4)', fontSize: '13px', transition: 'all 0.15s',
}

// ── New BotCard ───────────────────────────────────────────────────────────────
function BotCard({ bot, accounts, signals, allBotOrders, ltpMap, onUpdate, onArchive, onUnarchive, onDelete }: {
  bot: Bot; accounts: any[]
  signals: BotSignal[]
  allBotOrders: BotOrder[]
  ltpMap: Record<string, number>
  onUpdate: (id: string, data: any) => void
  onArchive: (id: string) => void
  onUnarchive: (id: string) => void
  onDelete: (id: string) => void
}) {
  const [editBot, setEditBot]     = useState(false)
  const [showDel, setShowDel]     = useState(false)
  const [showArch, setShowArch]   = useState(false)
  const [showChart, setShowChart] = useState(false)
  const [chartData, setChartData] = useState<{ candles: any[]; levels: any; signals: any[]; ltp: number | null } | null>(null)
  const [chartLoading, setChartLoading] = useState(false)

  // Status color logic
  const statusColor = bot.status === 'live'     ? 'var(--green)'
                    : bot.status === 'active'   ? '#FF6B00'
                    : bot.status === 'inactive' ? 'rgba(255,255,255,0.15)'
                    : '#FF4444'

  const isLive   = bot.status === 'live'
  const canStop  = bot.status === 'live' || bot.status === 'active'
  const canStart = bot.status === 'inactive'

  const statusLabel = bot.status === 'live' ? 'LIVE'
                    : bot.status === 'active' ? 'ACTIVE'
                    : bot.status === 'inactive' ? 'INACTIVE'
                    : 'ERROR'

  const statusChipStyle: React.CSSProperties = bot.status === 'live'
    ? { background: 'rgba(34,221,136,0.15)', color: '#22DD88', border: '0.5px solid rgba(34,221,136,0.4)' }
    : bot.status === 'active'
    ? { background: 'rgba(255,107,0,0.15)', color: '#FF6B00', border: '0.5px solid rgba(255,107,0,0.4)' }
    : bot.status === 'inactive'
    ? { background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.3)', border: '0.5px solid rgba(255,255,255,0.1)' }
    : { background: 'rgba(255,68,68,0.15)', color: '#FF4444', border: '0.5px solid rgba(255,68,68,0.4)' }

  // Last signal for this bot
  const botSignals = signals
    .filter(s => s.bot_id === bot.id)
    .sort((a, b) => {
      const ta = a.fired_at ? new Date(a.fired_at).getTime() : 0
      const tb = b.fired_at ? new Date(b.fired_at).getTime() : 0
      return tb - ta
    })
  const lastSignal = botSignals[0] ?? null

  // Open order for this bot
  const openOrder = allBotOrders.find(o => o.status === 'open' && (o as any).bot_id === bot.id)
    ?? allBotOrders.find(o => o.status === 'open' && o.bot_name === bot.name)

  // Live P&L from ltpMap
  let livePnl: number | null = null
  if (openOrder && openOrder.entry_price != null) {
    const ltp = ltpMap[openOrder.instrument]
    if (ltp != null) {
      livePnl = openOrder.direction === 'BUY'
        ? (ltp - openOrder.entry_price) * openOrder.lots
        : (openOrder.entry_price - ltp) * openOrder.lots
    } else if (openOrder.pnl != null) {
      livePnl = openOrder.pnl
    }
  }

  // Levels from chart data (loaded on chart expand) or null
  const levels = chartData?.levels ?? null

  return (
    <>
      <div className="card cloud-fill" style={{
        position: 'relative', overflow: 'hidden',
        borderLeft: `4px solid ${statusColor}`,
        padding: '14px 16px',
        display: 'flex', flexDirection: 'column', gap: '10px',
        opacity: bot.is_archived ? 0.6 : 1,
      }}>
        {/* Row 1: header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {isLive && (
              <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--green)', display: 'inline-block', animation: 'pulse 1.5s infinite', flexShrink: 0 }} />
            )}
            <span style={{ fontFamily: 'var(--font-display)', fontSize: '13px', fontWeight: 700, color: 'var(--ox-radiant)' }}>
              {bot.name}
            </span>
            <span style={{ fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '4px', background: 'rgba(255,107,0,0.15)', color: '#FF6B00', border: '0.5px solid rgba(255,107,0,0.3)', flexShrink: 0 }}>
              {bot.indicator.toUpperCase()}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '4px', ...statusChipStyle }}>{statusLabel}</span>
            <button title="Settings" onClick={() => setEditBot(true)} style={iconBtnStyle}>⚙</button>
            {canStop && (
              <button title="Stop" onClick={() => onUpdate(bot.id, { status: 'inactive' })} style={{ ...iconBtnStyle, color: '#FF4444' }}>■</button>
            )}
            {canStart && (
              <button title="Start" onClick={() => onUpdate(bot.id, { status: 'active' })} style={{ ...iconBtnStyle, color: 'var(--green)' }}>▶</button>
            )}
            {bot.is_archived ? (
              <button title="Unarchive" onClick={() => onUnarchive(bot.id)} style={{ ...iconBtnStyle, fontSize: '10px', color: 'var(--accent-amber)' }}>↩</button>
            ) : (
              <button title="Archive" onClick={() => setShowArch(true)} style={iconBtnStyle}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>
                </svg>
              </button>
            )}
            <button title="Delete" onClick={() => setShowDel(true)} style={iconBtnStyle}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Row 2: metadata */}
        <div style={{ fontSize: '11px', color: 'var(--gs-muted)' }}>
          {bot.instrument} · {bot.exchange} · {bot.timeframe_mins}min
          {bot.lots > 1 && <span> · {bot.lots} lots</span>}
        </div>

        {/* Divider */}
        <div style={{ height: '0.5px', background: 'var(--ox-border)' }} />

        {/* Row 3: levels + position + P&L */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
          {/* Levels */}
          <div style={{ display: 'flex', gap: '16px', fontSize: '11px' }}>
            {bot.indicator === 'dtr' && <>
              <span><span style={{ color: 'var(--gs-muted)' }}>UPP1 </span><span style={{ color: '#2DD4BF', fontFamily: 'var(--font-mono)' }}>{levels?.upp1 ? levels.upp1.toLocaleString('en-IN') : '—'}</span></span>
              <span><span style={{ color: 'var(--gs-muted)' }}>LPP1 </span><span style={{ color: '#2DD4BF', fontFamily: 'var(--font-mono)' }}>{levels?.lpp1 ? levels.lpp1.toLocaleString('en-IN') : '—'}</span></span>
            </>}
            {bot.indicator === 'channel' && <>
              <span><span style={{ color: 'var(--gs-muted)' }}>Upper </span><span style={{ color: '#2DD4BF', fontFamily: 'var(--font-mono)' }}>{levels?.upper_channel?.toLocaleString('en-IN') ?? '—'}</span></span>
              <span><span style={{ color: 'var(--gs-muted)' }}>Lower </span><span style={{ color: '#2DD4BF', fontFamily: 'var(--font-mono)' }}>{levels?.lower_channel?.toLocaleString('en-IN') ?? '—'}</span></span>
            </>}
            {bot.indicator === 'tt_bands' && <>
              <span><span style={{ color: 'var(--gs-muted)' }}>High </span><span style={{ color: '#2DD4BF', fontFamily: 'var(--font-mono)' }}>{levels?.tt_high?.toLocaleString('en-IN') ?? '—'}</span></span>
              <span><span style={{ color: 'var(--gs-muted)' }}>Low </span><span style={{ color: '#2DD4BF', fontFamily: 'var(--font-mono)' }}>{levels?.tt_low?.toLocaleString('en-IN') ?? '—'}</span></span>
            </>}
          </div>

          {/* Position chip */}
          {openOrder ? (
            <span style={{
              fontSize: '10px', padding: '2px 8px', borderRadius: '4px',
              background: openOrder.direction === 'BUY' ? 'rgba(34,221,136,0.15)' : 'rgba(255,68,68,0.15)',
              color: openOrder.direction === 'BUY' ? '#22DD88' : '#FF4444',
              border: `0.5px solid ${openOrder.direction === 'BUY' ? 'rgba(34,221,136,0.4)' : 'rgba(255,68,68,0.4)'}`,
              fontFamily: 'var(--font-mono)', fontWeight: 700,
            }}>
              {openOrder.direction === 'BUY' ? 'LONG' : 'SHORT'} @{openOrder.entry_price?.toLocaleString('en-IN') ?? '—'}
            </span>
          ) : (
            <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.2)' }}>FLAT</span>
          )}

          {/* P&L chip */}
          {openOrder && livePnl != null && (
            <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: livePnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {livePnl >= 0 ? '+' : ''}&#8377;{Math.round(livePnl).toLocaleString('en-IN')}
            </span>
          )}
        </div>

        {/* Divider */}
        <div style={{ height: '0.5px', background: 'var(--ox-border)' }} />

        {/* Row 4: last signal */}
        {lastSignal ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', flexWrap: 'wrap' }}>
            <span style={{ color: 'rgba(255,255,255,0.3)', fontWeight: 700, fontSize: '9px', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Last Signal</span>
            <span style={{ color: 'rgba(255,255,255,0.4)' }}>
              {lastSignal.fired_at ? new Date(lastSignal.fired_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }) : '—'}
            </span>
            <span style={{ color: 'rgba(255,255,255,0.3)' }}>·</span>
            <span style={{ color: 'rgba(255,255,255,0.5)' }}>{lastSignal.reason ?? '—'}</span>
            <span style={{ color: 'rgba(255,255,255,0.3)' }}>·</span>
            <span style={{ color: lastSignal.direction === 'BUY' || lastSignal.direction === 'buy' ? '#2DD4BF' : '#FF4444', fontWeight: 700 }}>
              {lastSignal.direction?.toUpperCase() ?? '—'} {(lastSignal.direction === 'buy' || lastSignal.direction === 'BUY') ? '▲' : '▼'} {lastSignal.trigger_price?.toLocaleString('en-IN') ?? ''}
            </span>
          </div>
        ) : (
          <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.2)' }}>No signals today</div>
        )}

        {/* Chart toggle */}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={async () => {
              if (!showChart && !chartData) {
                setChartLoading(true)
                try {
                  const res = await apiGet(`/bots/${bot.id}/chart-data?limit=100`)
                  setChartData(res.data)
                } catch {}
                setChartLoading(false)
              }
              setShowChart(v => !v)
            }}
            style={{ fontSize: '11px', color: 'var(--gs-muted)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '0' }}
          >
            {chartLoading ? 'Loading...' : showChart ? 'Chart ▲' : 'Chart ▼'}
          </button>
        </div>

        {/* Chart */}
        {showChart && chartData && (
          <div style={{ marginTop: '4px', height: '200px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData.candles} margin={{ top: 4, right: 4, bottom: 4, left: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis
                  dataKey="time"
                  tickFormatter={(t) => new Date(t * 1000).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })}
                  tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.3)' }}
                  minTickGap={40}
                />
                <YAxis tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.3)' }} domain={['auto', 'auto']} />
                <Line type="monotone" dataKey="value" stroke="#FF6B00" strokeWidth={1.5} dot={false} />

                {/* Level lines */}
                {chartData.levels?.upp1 && (
                  <ReferenceLine y={chartData.levels.upp1} stroke="#2DD4BF" strokeDasharray="4 2"
                    label={{ value: `UPP1 ${chartData.levels.upp1?.toLocaleString('en-IN')}`, position: 'insideTopLeft', fontSize: 9, fill: '#2DD4BF' }} />
                )}
                {chartData.levels?.lpp1 && (
                  <ReferenceLine y={chartData.levels.lpp1} stroke="#2DD4BF" strokeDasharray="4 2"
                    label={{ value: `LPP1 ${chartData.levels.lpp1?.toLocaleString('en-IN')}`, position: 'insideTopLeft', fontSize: 9, fill: '#2DD4BF' }} />
                )}
                {chartData.levels?.upper_channel && (
                  <ReferenceLine y={chartData.levels.upper_channel} stroke="#2DD4BF" strokeDasharray="4 2" />
                )}
                {chartData.levels?.lower_channel && (
                  <ReferenceLine y={chartData.levels.lower_channel} stroke="#2DD4BF" strokeDasharray="4 2" />
                )}
                {chartData.levels?.tt_high && (
                  <ReferenceLine y={chartData.levels.tt_high} stroke="#2DD4BF" strokeDasharray="4 2" />
                )}
                {chartData.levels?.tt_low && (
                  <ReferenceLine y={chartData.levels.tt_low} stroke="#2DD4BF" strokeDasharray="4 2" />
                )}

                {/* LTP line */}
                {chartData.ltp && (
                  <ReferenceLine y={chartData.ltp} stroke="#FF6B00" strokeWidth={1}
                    label={{ value: `LTP ${chartData.ltp?.toLocaleString('en-IN')}`, position: 'insideTopRight', fontSize: 9, fill: '#FF6B00' }} />
                )}

                {/* Signal markers */}
                {chartData.signals.filter((s: any) => s.time > 0 && s.price).map((sig: any, i: number) => (
                  <ReferenceDot key={i} x={sig.time} y={sig.price}
                    r={4}
                    fill={sig.direction === 'buy' ? '#2DD4BF' : '#FF4444'}
                    stroke="none"
                    label={{ value: sig.direction === 'buy' ? '▲' : '▼', position: sig.direction === 'buy' ? 'top' : 'bottom', fontSize: 10, fill: sig.direction === 'buy' ? '#2DD4BF' : '#FF4444' }}
                  />
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
  const [activeTab, setActiveTab] = useState<'Bots' | 'Signals' | 'Orders'>(
    () => (localStorage.getItem('indicatorsTab') as 'Bots' | 'Signals' | 'Orders') || 'Bots'
  )
  const [orderSubTab, setOrderSubTab] = useState<'today' | 'open' | 'all'>('today')
  const [bots, setBots]             = useState<Bot[]>([])
  const [accounts, setAccounts]     = useState<any[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [loading, setLoading]       = useState(true)
  const [allBotOrders, setAllBotOrders] = useState<BotOrder[]>([])
  const [signals, setSignals]       = useState<BotSignal[]>([])
  const signalTimerRef              = useRef<ReturnType<typeof setInterval> | null>(null)
  const ordersTimerRef              = useRef<ReturnType<typeof setInterval> | null>(null)
  const ltpTimerRef                 = useRef<ReturnType<typeof setInterval> | null>(null)
  const [ltpMap, setLtpMap]         = useState<Record<string, number>>({})

  useEffect(() => {
    Promise.all([
      apiGet(`/bots/?is_practix=${isPractixMode}`).then(r => setBots(r.data || [])),
      accountsAPI.list().then(r => setAccounts(r.data || [])),
    ]).finally(() => setLoading(false))
  }, [isPractixMode])

  const fetchSignals = () => {
    botsAPI.signalsToday()
      .then(r => setSignals(r.data?.signals || []))
      .catch(() => {})
  }

  // Load today's signals on mount; re-fetch + 30s refresh when on Signals tab
  useEffect(() => {
    fetchSignals()
    if (activeTab === 'Signals') {
      signalTimerRef.current = setInterval(fetchSignals, 30000)
      return () => { if (signalTimerRef.current) clearInterval(signalTimerRef.current) }
    }
  }, [activeTab])

  // Fetch all bot orders via single global endpoint
  const fetchAllBotOrders = () => {
    botsAPI.orders()
      .then(r => setAllBotOrders(r.data || []))
      .catch(() => {})
  }

  useEffect(() => {
    fetchAllBotOrders()
  }, [])

  // 30s auto-refresh for Orders tab
  useEffect(() => {
    if (activeTab !== 'Orders') return
    ordersTimerRef.current = setInterval(fetchAllBotOrders, 30000)
    return () => { if (ordersTimerRef.current) clearInterval(ordersTimerRef.current) }
  }, [activeTab])

  // 5s LTP polling for live P&L on open orders (always active — needed for Bots tab P&L too)
  useEffect(() => {
    const fetchLtps = () => {
      const symbols = [...new Set(allBotOrders.filter(o => o.status === 'open').map((o: any) => o.instrument as string))]
      symbols.forEach(sym => {
        apiGet(`/bots/ltp?symbol=${sym}`)
          .then(r => { if (r.data?.ltp != null) setLtpMap(prev => ({ ...prev, [sym]: r.data.ltp })) })
          .catch(() => {})
      })
    }
    if (allBotOrders.some(o => o.status === 'open')) {
      fetchLtps()
      ltpTimerRef.current = setInterval(fetchLtps, 5000)
    }
    return () => { if (ltpTimerRef.current) { clearInterval(ltpTimerRef.current); ltpTimerRef.current = null } }
  }, [allBotOrders])

  // WebSocket subscription to /ws/notifications — refresh signals on bot signal fire
  useEffect(() => {
    const wsUrl = ((import.meta as any).env?.VITE_API_URL || 'http://localhost:8000')
      .replace('http://', 'ws://')
      .replace('https://', 'wss://')
    const ws = new WebSocket(`${wsUrl}/ws/notifications`)
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        // Refresh signals immediately when a bot signal fires
        if (msg.type === 'notification' && msg.data?.algo_name) {
          fetchSignals()
          fetchAllBotOrders()
        }
      } catch {}
    }
    ws.onerror = () => {} // silent — WS is best-effort
    return () => { ws.close() }
  }, [])

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

  const handleRefresh = () => {
    setLoading(true)
    Promise.all([
      apiGet(`/bots/?is_practix=${isPractixMode}`).then(r => setBots(r.data || [])),
      fetchSignals(),
      fetchAllBotOrders(),
    ]).finally(() => setLoading(false))
  }

  const activeBots   = bots.filter(b => !b.is_archived)
  const archivedBots = bots.filter(b => b.is_archived)

  // Orders filtering + sorting
  const filteredOrders = orderSubTab === 'open'  ? allBotOrders.filter(o => o.status === 'open')
                       : orderSubTab === 'today' ? allBotOrders.filter(o => {
                           if (!o.entry_time) return false
                           const d = new Date(o.entry_time)
                           const today = new Date()
                           return d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear()
                         })
                       : allBotOrders
  const sortedOrders = [...filteredOrders].sort((a, b) => {
    const ta = a.entry_time ? new Date(a.entry_time).getTime() : 0
    const tb = b.entry_time ? new Date(b.entry_time).getTime() : 0
    return tb - ta
  })

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '22px', fontWeight: 800, color: 'var(--ox-radiant)' }}>
            Bots
          </h1>
          <p style={{ fontSize: '12px', color: 'var(--gs-muted)', marginTop: '3px' }}>
            {loading ? 'Loading...' : `${activeBots.filter(b => b.status === 'live').length} running · ${activeBots.length} total`}
          </p>
        </div>
        <div className="page-header-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {archivedBots.length > 0 && (
            <button className="btn btn-ghost btn-sm" style={{ fontSize: '11px' }} onClick={() => setShowArchived(v => !v)}>
              {showArchived ? 'Hide' : 'Show'} Archived ({archivedBots.length})
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={handleRefresh}>&#8635; Refresh</button>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ New Bot</button>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', borderTop: '0.5px solid var(--ox-border)', borderBottom: '0.5px solid var(--ox-border)' }}>
        {(['Bots', 'Signals', 'Orders'] as const).map(tab => {
          const hasDot = (tab === 'Signals' && signals.some(s => s.status === 'fired')) ||
                         (tab === 'Orders' && allBotOrders.some(o => o.status === 'open'))
          return (
            <button key={tab} onClick={() => { setActiveTab(tab); localStorage.setItem('indicatorsTab', tab) }} style={{
              flex: 1, padding: '12px 0', fontSize: '12px', fontWeight: 600,
              fontFamily: 'var(--font-display)',
              background: activeTab === tab ? 'rgba(255,107,0,0.08)' : 'transparent',
              border: 'none', cursor: 'pointer', position: 'relative',
              color: activeTab === tab ? '#FF6B00' : 'rgba(255,255,255,0.4)',
              borderBottom: activeTab === tab ? '2px solid #FF6B00' : '2px solid transparent',
              transition: 'all 0.15s ease',
            }}>
              {tab}
              {hasDot && <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: 'var(--green)', marginLeft: '5px', verticalAlign: 'middle' }} />}
            </button>
          )
        })}
      </div>

      {/* BOTS TAB */}
      {activeTab === 'Bots' && (
        <>
          {!loading && activeBots.length === 0 && (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: '32px', marginBottom: '12px' }}>&#9671;</div>
              <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '6px', color: 'var(--text-muted)' }}>No bots yet</div>
              <div style={{ fontSize: '12px', marginBottom: '20px' }}>Create a bot to start running indicator-based strategies</div>
              <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Create Your First Bot</button>
            </div>
          )}

          {activeBots.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px', marginTop: '16px' }}>
              {activeBots.map(bot => (
                <BotCard key={bot.id} bot={bot} accounts={accounts}
                  signals={signals} allBotOrders={allBotOrders} ltpMap={ltpMap}
                  onUpdate={handleUpdate} onArchive={handleArchive}
                  onUnarchive={handleUnarchive} onDelete={handleDelete} />
              ))}
            </div>
          )}

          {/* Archived bots */}
          {showArchived && archivedBots.length > 0 && (
            <>
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--accent-amber)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '12px', marginTop: '24px' }}>Archived Bots</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px', marginBottom: '16px' }}>
                {archivedBots.map(bot => (
                  <BotCard key={bot.id} bot={bot} accounts={accounts}
                    signals={signals} allBotOrders={allBotOrders} ltpMap={ltpMap}
                    onUpdate={handleUpdate} onArchive={handleArchive}
                    onUnarchive={handleUnarchive} onDelete={handleDelete} />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* SIGNALS TAB */}
      {activeTab === 'Signals' && (
        <div style={{ marginTop: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
            <span style={{ fontSize: '10px', fontWeight: 600, color: 'rgba(232,232,248,0.5)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Last 7 Days · {signals.length} signals
            </span>
            <span style={{ fontSize: '10px', color: 'var(--text-dim)', marginLeft: 'auto' }}>auto-refresh 30s</span>
          </div>
          <table className="staax-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Time</th>
                <th>Bot</th>
                <th>Symbol</th>
                <th>Direction</th>
                <th>Price</th>
                <th>Reason</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {signals.map(s => (
                <tr key={s.id}>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--gs-muted)', whiteSpace: 'nowrap' }}>
                    {s.fired_at ? new Date(s.fired_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }) : '—'}
                  </td>
                  <td style={{ fontWeight: 600, color: 'var(--ox-radiant)' }}>{s.bot_name ?? s.bot_id.slice(0, 8)}</td>
                  <td style={{ fontSize: '11px' }}>{s.instrument}</td>
                  <td>
                    <span style={{ color: (s.direction === 'buy' || s.direction === 'BUY') ? '#2DD4BF' : '#FF4444', fontWeight: 700 }}>
                      {s.direction?.toUpperCase() ?? '—'} {(s.direction === 'buy' || s.direction === 'BUY') ? '▲' : '▼'}
                    </span>
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{s.trigger_price?.toLocaleString('en-IN') ?? '—'}</td>
                  <td style={{ color: 'var(--gs-muted)', fontSize: '11px' }}>{s.reason}</td>
                  <td>
                    <span style={{
                      fontSize: '10px', padding: '1px 6px', borderRadius: '4px',
                      background: s.status === 'fired' ? 'rgba(34,221,136,0.15)' : s.status === 'error' ? 'rgba(255,68,68,0.15)' : 'rgba(255,255,255,0.08)',
                      color: s.status === 'fired' ? '#22DD88' : s.status === 'error' ? '#FF4444' : 'rgba(255,255,255,0.4)',
                    }}>
                      {s.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {signals.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px', color: 'rgba(255,255,255,0.2)', fontSize: '13px' }}>No signals today</div>
          )}
        </div>
      )}

      {/* ORDERS TAB */}
      {activeTab === 'Orders' && (
        <div style={{ marginTop: '16px' }}>
          {/* Sub-tabs */}
          <div style={{ display: 'flex', gap: '4px', marginBottom: '12px' }}>
            {(['today', 'open', 'all'] as const).map(sub => (
              <button key={sub} onClick={() => setOrderSubTab(sub)} style={{
                padding: '5px 14px', fontSize: '11px', fontWeight: 600, borderRadius: '6px',
                background: orderSubTab === sub ? 'rgba(255,107,0,0.15)' : 'rgba(255,255,255,0.04)',
                border: `0.5px solid ${orderSubTab === sub ? 'rgba(255,107,0,0.4)' : 'rgba(255,255,255,0.08)'}`,
                color: orderSubTab === sub ? '#FF6B00' : 'rgba(255,255,255,0.4)',
                cursor: 'pointer', textTransform: 'capitalize',
              }}>
                {sub === 'today' ? 'Today' : sub === 'open' ? 'Open' : 'All'}
                {sub === 'open' && allBotOrders.some(o => o.status === 'open') && (
                  <span style={{ display: 'inline-block', width: '5px', height: '5px', borderRadius: '50%', background: 'var(--green)', marginLeft: '5px', verticalAlign: 'middle' }} />
                )}
              </button>
            ))}
            <span style={{ fontSize: '10px', color: 'var(--text-dim)', marginLeft: 'auto', alignSelf: 'center' }}>orders 30s · ltp 5s</span>
          </div>

          <table className="staax-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Bot Name</th>
                <th>Symbol</th>
                <th>Side</th>
                <th>Entry &#8377;</th>
                <th>Exit &#8377;</th>
                <th>P&amp;L</th>
                <th>Entry Time</th>
                <th>Exit Time</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {sortedOrders.length === 0 ? (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-dim)', fontSize: '12px' }}>No orders</td></tr>
              ) : sortedOrders.map(o => {
                const livePnlOrder = o.status === 'open' && ltpMap[o.instrument] != null && o.entry_price != null
                  ? (o.direction === 'BUY'
                      ? (ltpMap[o.instrument] - o.entry_price) * o.lots
                      : (o.entry_price - ltpMap[o.instrument]) * o.lots)
                  : null
                const displayPnl = livePnlOrder ?? o.pnl ?? null
                return (
                  <tr key={o.id}>
                    <td style={{ fontWeight: 600, color: 'var(--ox-radiant)', fontSize: '11px' }}>
                      {o.bot_name}
                      {' '}
                      <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, fontWeight: 700,
                        background: o.is_practix ? 'rgba(255,179,0,0.12)' : 'rgba(34,221,136,0.12)',
                        color: o.is_practix ? '#FFB300' : '#22DD88' }}>
                        {o.is_practix ? 'PRACTIX' : 'LIVE'}
                      </span>
                    </td>
                    <td style={{ fontSize: '11px', fontFamily: 'var(--font-mono)' }}>{o.instrument}</td>
                    <td>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                        color: o.direction === 'BUY' ? '#22DD88' : '#FF4444',
                        background: o.direction === 'BUY' ? 'rgba(34,221,136,0.12)' : 'rgba(255,68,68,0.12)' }}>
                        {o.direction}
                      </span>
                    </td>
                    <td style={{ fontSize: '11px', fontFamily: 'var(--font-mono)' }}>{o.entry_price != null ? `&#8377;${o.entry_price.toLocaleString('en-IN')}` : '—'}</td>
                    <td style={{ fontSize: '11px', fontFamily: 'var(--font-mono)' }}>{o.exit_price != null ? `&#8377;${o.exit_price.toLocaleString('en-IN')}` : '—'}</td>
                    <td style={{ fontSize: '11px', fontWeight: 600 }}>
                      {displayPnl != null ? (
                        <span style={{ color: displayPnl >= 0 ? '#22DD88' : '#FF4444' }}>
                          {displayPnl >= 0 ? '+' : ''}&#8377;{Math.round(displayPnl).toLocaleString('en-IN')}
                          {livePnlOrder != null && <span style={{ fontSize: 8, marginLeft: 4, opacity: 0.55, fontWeight: 400 }}>LIVE</span>}
                        </span>
                      ) : <span style={{ color: 'var(--text-dim)' }}>—</span>}
                    </td>
                    <td style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {o.entry_time ? new Date(o.entry_time).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'}
                    </td>
                    <td style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {o.exit_time ? new Date(o.exit_time).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'}
                    </td>
                    <td>
                      <span style={{ fontSize: '10px', fontWeight: 600, color: o.status === 'open' ? '#22DD88' : 'var(--text-dim)' }}>{o.status?.toUpperCase()}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <BotConfigurator accounts={accounts} onSave={handleSave} onClose={() => setShowCreate(false)} />
      )}
    </div>
  )
}
