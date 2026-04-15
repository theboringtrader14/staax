import { useState, useEffect, useRef } from 'react'
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
const STATUS_COLOR: Record<string, string> = {
  active: 'var(--indigo)', live: 'var(--green)', inactive: 'var(--text-dim)',
}

const indicatorShortLabel = (ind: string) => {
  const found = INDICATORS.find(i => i.value === ind)
  return found ? found.label.replace(' Strategy', '').replace(' Bands Strategy', ' Bands') : ind
}

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
              ℹ️ Expiry auto-set to current active contract ({autoExpiry()}). Rollover is automatic when ≤5 market days remain.
            </div>
            {error && <div style={{ fontSize: '12px', color: 'var(--red)' }}>❌ {error}</div>}
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

// ── Per-bot signal log (collapsible) ──────────────────────────────────────────
function BotSignalLog({ botId }: { botId: string }) {
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading]   = useState(false)
  const [signals, setSignals]   = useState<any[]>([])

  const load = async () => {
    setLoading(true)
    try {
      const r = await apiGet(`/bots/${botId}/signals?limit=15`)
      setSignals(Array.isArray(r.data) ? r.data : [])
    } catch { /* ignore */ } finally { setLoading(false) }
  }

  return (
    <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 10 }}>
      <button onClick={() => { setExpanded(e => !e); if (!expanded && signals.length === 0) load() }}
        style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
          fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', padding: 0 }}>
        {expanded ? '▾' : '▸'} Signal Log
      </button>
      {expanded && (
        <div style={{ marginTop: 8 }}>
          {loading && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Loading…</div>}
          {!loading && signals.length === 0 && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>No signals yet.</div>}
          {signals.map((s: any) => {
            const isExit = s.signal_type === 'exit'
            const dirColor = isExit ? '#FFB300' : s.direction === 'BUY' ? '#22DD88' : '#FF4444'
            const dirLabel = isExit ? 'EXIT' : s.direction
            const statusColor = s.status === 'fired' ? '#22DD88' : s.status === 'skipped' ? '#888' : s.status === 'error' ? '#FF4444' : '#FFB300'
            return (
              <div key={s.id} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '4px 0',
                borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: 11, flexWrap: 'wrap' }}>
                <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: 9, fontWeight: 700,
                  background: `${dirColor}22`, color: dirColor }}>{dirLabel}</span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{s.signal_type}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', marginLeft: 'auto' }}>
                  {s.fired_at ? new Date(s.fired_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'}
                </span>
                <span style={{ fontSize: 9, fontWeight: 600, color: statusColor }}>{s.status?.toUpperCase()}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Bot Card ──────────────────────────────────────────────────────────────────
function BotCard({ bot, accounts, onUpdate, onArchive, onUnarchive, onDelete }: {
  bot: Bot; accounts: any[]
  onUpdate: (id: string, data: any) => void
  onArchive: (id: string) => void
  onUnarchive: (id: string) => void
  onDelete: (id: string) => void
}) {
  const [orders, setOrders]       = useState<BotOrder[]>([])
  const [editLots, setEditLots]   = useState(false)
  const [lotsVal, setLotsVal]     = useState(String(bot.lots))
  const [expanded, setExpanded]   = useState(false)
  const [showEdit, setShowEdit]   = useState(false)
  const [showDel, setShowDel]     = useState(false)
  const [showArch, setShowArch]   = useState(false)
  const [ltp, setLtp]             = useState<number | null>(null)
  const [prevLtp, setPrevLtp]     = useState<number | null>(null)
  useEffect(() => {
    apiGet(`/bots/${bot.id}/orders`).then(r => setOrders(r.data || [])).catch(() => {})
  }, [bot.id])

  // Live LTP for MCX instruments — poll every 5 s
  const isMcx = ['GOLDM', 'SILVERMIC'].includes(bot.instrument)
  useEffect(() => {
    if (!isMcx) return
    const fetch = () =>
      apiGet(`/bots/ltp?symbol=${bot.instrument}`)
        .then(r => {
          const val: number | null = r.data?.ltp ?? null
          setLtp(prev => { setPrevLtp(prev); return val })
        })
        .catch(() => {})
    fetch()
    const id = setInterval(fetch, 5000)
    return () => clearInterval(id)
  }, [bot.instrument, isMcx])

  const openOrder = orders.find(o => o.status === 'open')
  const accountName = accounts.find((a: any) => a.id === bot.account_id)?.nickname || '—'
  const tfLabel = TIMEFRAMES.find(t => t.value === bot.timeframe_mins)?.label || `${bot.timeframe_mins}m`
  const indLabel = indicatorShortLabel(bot.indicator)

  const saveLots = async () => {
    const v = parseInt(lotsVal) || 1
    await onUpdate(bot.id, { lots: v })
    setEditLots(false)
  }

  return (
    <>
      <div className="card cloud-fill" style={{ opacity: bot.status === 'inactive' ? 0.7 : 1, transition: 'all 0.15s' }}>
        {/* Status + actions row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
          <span style={{ fontSize: '10px', fontWeight: 700, color: STATUS_COLOR[bot.status] || 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: '5px' }}>
            {bot.status === 'live' && <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: 'var(--green)', animation: 'pulse 1.5s infinite' }}/>}
            {bot.is_archived ? '📦 Archived' : bot.status}
          </span>
          <div style={{ display: 'flex', gap: '4px' }}>
            {bot.is_archived && (
              <button title="Unarchive" onClick={() => onUnarchive(bot.id)}
                style={{ background: 'none', border: '1px solid var(--bg-border)', borderRadius: 'var(--radius-sm)', padding: '3px 7px', cursor: 'pointer', color: 'var(--accent-amber)', fontSize: '11px' }}>↩ Restore</button>
            )}
            {!bot.is_archived && (
              <button
                onClick={() => setShowArch(true)}
                title="Archive"
                style={{ width: '30px', height: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', background: 'transparent', border: '0.5px solid rgba(255,255,255,0.06)', cursor: 'pointer', color: 'rgba(255,255,255,0.35)', transition: 'all 0.15s' }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(68,136,255,0.12)'; (e.currentTarget as HTMLButtonElement).style.color = '#4488FF' }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.35)' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>
                </svg>
              </button>
            )}
            <button
              onClick={() => setShowDel(true)}
              title="Delete"
              style={{ width: '30px', height: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', background: 'transparent', border: '0.5px solid rgba(255,255,255,0.06)', cursor: 'pointer', color: 'rgba(255,255,255,0.35)', transition: 'all 0.15s' }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,68,68,0.12)'; (e.currentTarget as HTMLButtonElement).style.color = '#FF4444' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.35)' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Name + meta */}
        <div onClick={() => setShowEdit(true)} style={{ fontWeight: 700, fontSize: '14px', marginBottom: '4px', cursor: 'pointer', transition: 'color 0.12s' }} onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.color = 'var(--indigo)'} onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.color = 'var(--text)'}>{bot.name}</div>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: isMcx ? '6px' : '10px', display: 'flex', gap: '5px', flexWrap: 'wrap', alignItems: 'center' }}>
          <span>{bot.instrument}</span><span>·</span><span>{indLabel}</span><span>·</span><span>{tfLabel}</span>
          <span style={{ fontSize: '10px', fontWeight: 700, padding: '1px 7px', borderRadius: '20px',
            background: 'var(--indigo-dim)', color: 'var(--indigo)', border: '1px solid rgba(255,107,0,0.2)' }}>
            {accountName}
          </span>
        </div>

        {/* Live LTP for MCX instruments */}
        {isMcx && (() => {
          if (ltp === null) return (
            <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginBottom: '8px' }}>—</div>
          )
          const diff   = prevLtp !== null ? ltp - prevLtp : 0
          const pct    = prevLtp ? (diff / prevLtp) * 100 : 0
          const up     = diff >= 0
          const color  = diff === 0 ? 'var(--text-muted)' : up ? 'var(--green)' : 'var(--red)'
          const arrow  = diff === 0 ? '' : up ? ' ↑' : ' ↓'
          const fmtLtp = `₹${ltp.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
          const fmtPct = prevLtp ? ` ${up ? '+' : ''}${pct.toFixed(2)}%` : ''
          return (
            <div style={{ fontSize: '13px', fontWeight: 700, color, marginBottom: '8px', letterSpacing: '0.01em' }}>
              {fmtLtp}{arrow}{fmtPct && <span style={{ fontSize: '11px', fontWeight: 600 }}>{fmtPct}</span>}
            </div>
          )
        })()}

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: '8px', marginBottom: '12px' }}>
          <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', padding: '8px 10px' }}>
            <div style={{ fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>Lots</div>
            {editLots ? (
              <div style={{ display: 'flex', gap: '3px' }}>
                <input type="number" value={lotsVal} onChange={e => setLotsVal(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveLots(); if (e.key === 'Escape') setEditLots(false) }}
                  style={{ width: '40px', background: 'var(--bg-primary)', border: '1px solid var(--indigo)', borderRadius: '3px', color: 'var(--text)', fontSize: '11px', padding: '1px 4px' }} autoFocus />
                <button onClick={saveLots} style={{ background: 'var(--indigo)', border: 'none', borderRadius: '3px', color: '#000', fontSize: '10px', padding: '0 5px', cursor: 'pointer' }}>✓</button>
              </div>
            ) : (
              <div onClick={() => { setEditLots(true); setLotsVal(String(bot.lots)) }}
                title="Click to edit" style={{ fontWeight: 700, fontSize: '14px', cursor: 'pointer', color: 'var(--indigo)' }}>
                {bot.lots}
              </div>
            )}
          </div>
          <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', padding: '8px 10px' }}>
            <div style={{ fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>Live P&L</div>
            <div style={{ fontWeight: 700, fontSize: '14px', color: openOrder?.pnl != null ? (openOrder.pnl >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--text-dim)' }}>
              {openOrder?.pnl != null ? `${openOrder.pnl >= 0 ? '+' : ''}₹${openOrder.pnl.toLocaleString('en-IN')}` : '—'}
            </div>
          </div>
        </div>

        {/* Open position */}
        {openOrder && (
          <div style={{ background: 'var(--green-dim)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 'var(--radius-md)', padding: '8px 12px', marginBottom: '10px', fontSize: '11px', color: 'var(--green)' }}>
            <span style={{ fontWeight: 700 }}>OPEN</span> · BUY @ ₹{openOrder.entry_price?.toLocaleString('en-IN')} · {openOrder.lots} lots · {openOrder.expiry}
          </div>
        )}

        {/* LIVE + Deactivate row */}
        {!bot.is_archived && (
          <div style={{ display: 'flex', gap: '8px', flexDirection: 'row', marginBottom: orders.length > 0 ? '8px' : '0' }}>
            {(bot.is_practix ?? true) && (
              <button
                onClick={() => onUpdate(bot.id, { is_practix: false })}
                style={{
                  background: 'rgba(34,221,136,0.12)',
                  border: '0.5px solid rgba(34,221,136,0.4)',
                  color: '#22DD88',
                  borderRadius: '6px', padding: '4px 12px', cursor: 'pointer', fontSize: '12px', fontWeight: 600,
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = 'rgba(34,221,136,0.25)'}
                onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'rgba(34,221,136,0.12)'}
              >
                LIVE
              </button>
            )}
            <button className="btn btn-ghost" style={{ flex: 1, fontSize: '11px' }}
              onClick={() => onUpdate(bot.id, { status: bot.status === 'inactive' ? 'active' : 'inactive' })}>
              {bot.status === 'inactive' ? '▶ Activate' : '⏸ Deactivate'}
            </button>
          </div>
        )}

        {/* Orders toggle */}
        {orders.length > 0 && (
          <>
            <button onClick={() => setExpanded(e => !e)}
              style={{ width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--bg-border)', borderRadius: 'var(--radius-md)', padding: '6px', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '11px', marginBottom: '8px' }}>
              {expanded ? '▲' : '▼'} {orders.length} order{orders.length !== 1 ? 's' : ''}
            </button>
            {expanded && (
              <div className="cloud-fill" style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--bg-border)' }}>
                <table className="staax-table">
                  <thead><tr><th>Dir</th><th>Entry ₹</th><th>Exit ₹</th><th>P&L</th><th>Status</th></tr></thead>
                  <tbody>
                    {orders.map(o => (
                      <tr key={o.id}>
                        <td style={{ fontSize: '11px', fontWeight: 700, color: o.direction === 'BUY' ? 'var(--green)' : 'var(--red)' }}>{o.direction}</td>
                        <td style={{ fontSize: '11px' }}>{o.entry_price?.toLocaleString('en-IN') || '—'}</td>
                        <td style={{ fontSize: '11px' }}>{o.exit_price?.toLocaleString('en-IN') || '—'}</td>
                        <td style={{ fontSize: '11px', fontWeight: 600, color: (o.pnl || 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                          {o.pnl != null ? `${o.pnl >= 0 ? '+' : ''}₹${o.pnl.toLocaleString('en-IN')}` : '—'}
                        </td>
                        <td><span style={{ fontSize: '10px', color: o.status === 'open' ? 'var(--green)' : 'var(--text-dim)' }}>{o.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        {/* Signal Log (inline, collapsible) */}
        <BotSignalLog botId={bot.id} />

      </div>

      {showEdit && (
        <EditBotModal bot={bot} accounts={accounts}
          onSave={async (id, data) => { await onUpdate(id, data); setShowEdit(false) }}
          onClose={() => setShowEdit(false)} />
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

type AggOrder = BotOrder
type BotSignal = {
  id: string; bot_id: string; bot_name?: string; signal_type: string; direction: string | null
  instrument: string; expiry: string; trigger_price: number | null; reason: string | null
  status: string; bot_order_id: string | null; error_message: string | null; fired_at: string | null
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function IndicatorsPage() {
  const isPractixMode = useStore(s => s.isPractixMode)
  const [activeTab, setActiveTab] = useState<'Bots' | 'Signals' | 'Orders'>('Bots')
  const [bots, setBots]           = useState<Bot[]>([])
  const [accounts, setAccounts]   = useState<any[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [loading, setLoading]     = useState(true)
  const [allBotOrders, setAllBotOrders] = useState<AggOrder[]>([])
  const [signals, setSignals]     = useState<BotSignal[]>([])
  const signalTimerRef            = useRef<ReturnType<typeof setInterval> | null>(null)
  const ordersTimerRef            = useRef<ReturnType<typeof setInterval> | null>(null)
  const ltpTimerRef               = useRef<ReturnType<typeof setInterval> | null>(null)
  const [ltpMap, setLtpMap]       = useState<Record<string, number>>({})

  useEffect(() => {
    Promise.all([
      apiGet(`/bots/?is_practix=${isPractixMode}`).then(r => setBots(r.data || [])),
      accountsAPI.list().then(r => setAccounts(r.data || [])),
    ]).finally(() => setLoading(false))
  }, [isPractixMode])

  // Load today's signals on mount (for green dot); re-fetch + 30s refresh when on Signals tab
  useEffect(() => {
    const fetchSignals = () => {
      botsAPI.signalsToday()
        .then(r => setSignals(r.data?.signals || []))
        .catch(() => {})
    }
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

  // 5s LTP polling for live P&L on open orders
  useEffect(() => {
    if (activeTab !== 'Orders') {
      if (ltpTimerRef.current) { clearInterval(ltpTimerRef.current); ltpTimerRef.current = null }
      return
    }
    const fetchLtps = () => {
      const symbols = [...new Set(allBotOrders.filter(o => o.status === 'open').map((o: any) => o.instrument as string))]
      symbols.forEach(sym => {
        apiGet(`/bots/ltp?symbol=${sym}`)
          .then(r => { if (r.data?.ltp != null) setLtpMap(prev => ({ ...prev, [sym]: r.data.ltp })) })
          .catch(() => {})
      })
    }
    fetchLtps()
    ltpTimerRef.current = setInterval(fetchLtps, 5000)
    return () => { if (ltpTimerRef.current) { clearInterval(ltpTimerRef.current); ltpTimerRef.current = null } }
  }, [activeTab, allBotOrders])

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

  const activeBots   = bots.filter(b => !b.is_archived)
  const archivedBots = bots.filter(b => b.is_archived)

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '22px', fontWeight: 800, color: 'var(--ox-radiant)' }}>Indicator Bots</h1>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px', display:'flex', alignItems:'center', gap:'6px' }}>
            {loading ? 'Loading...' : `${activeBots.filter(b => b.status !== 'inactive').length} running · ${activeBots.length} total`}
          {' '}·{' '}<span className={'chip ' + (isPractixMode ? 'chip-warn' : 'chip-success')}>{isPractixMode ? 'PRACTIX' : 'LIVE'}</span></p>
        </div>
        <div className="page-header-actions">
          {archivedBots.length > 0 && (
            <button className="btn btn-ghost" style={{ fontSize: '11px' }} onClick={() => setShowArchived(v => !v)}>
              📦 {showArchived ? 'Hide' : 'Show'} Archived ({archivedBots.length})
            </button>
          )}
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ New Bot</button>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '0.5px solid rgba(255,107,0,0.16)', marginBottom: '16px' }}>
        {(['Bots', 'Signals', 'Orders'] as const).map(tab => {
          const hasDot = (tab === 'Signals' && signals.some(s => s.status === 'fired')) ||
                         (tab === 'Orders' && allBotOrders.some(o => o.status === 'open'))
          return (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{
              flex: 1, padding: '8px 4px', fontSize: '12px', fontWeight: 600,
              background: activeTab === tab ? 'rgba(255,107,0,0.08)' : 'transparent',
              border: 'none', cursor: 'pointer', position: 'relative',
              color: activeTab === tab ? '#FF6B00' : 'rgba(232,232,248,0.6)',
              borderBottom: activeTab === tab ? '2px solid #FF6B00' : '2px solid transparent',
              transition: 'all 0.2s ease',
            }}>
              {tab}
              {hasDot && <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: 'var(--green)', marginLeft: '5px', verticalAlign: 'middle', animation: 'pulse 1.5s infinite' }} />}
            </button>
          )
        })}
      </div>

      {activeTab === 'Signals' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
            <span style={{ fontSize: '10px', fontWeight: 600, color: 'rgba(232,232,248,0.5)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Last 7 Days · {signals.length} signals
            </span>
            <span style={{ fontSize: '10px', color: 'var(--text-dim)', marginLeft: 'auto' }}>auto-refresh 30s</span>
          </div>
          <div className="cloud-fill" style={{ borderRadius: 8, overflow: 'hidden', border: '0.5px solid rgba(255,107,0,0.18)' }}>
            <table className="staax-table">
              <thead>
                <tr>
                  <th>Bot</th><th>Signal</th><th>Instrument</th><th>Dir</th><th>Trigger ₹</th><th>Reason</th><th>Fired At</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {signals.length === 0 ? (
                  <tr><td colSpan={8} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-dim)', fontSize: '12px' }}>
                    No signals in the last 7 days
                  </td></tr>
                ) : signals.map(s => {
                  const isExit = s.signal_type === 'exit'
                  const dirColor = isExit ? '#FFB300' : s.direction === 'BUY' ? '#22DD88' : s.direction === 'SELL' ? '#FF4444' : 'var(--text-muted)'
                  return (
                    <tr key={s.id}>
                      <td style={{ fontSize: '11px', fontWeight: 600, color: 'var(--amber)' }}>{s.bot_name || '—'}</td>
                      <td style={{ fontWeight: 600, textTransform: 'capitalize', fontSize: '11px' }}>{s.signal_type}</td>
                      <td style={{ fontSize: '11px' }}>{s.instrument} · {s.expiry}</td>
                      <td>
                        <span style={{ padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', background: `${dirColor}22`, color: dirColor }}>
                          {isExit ? 'EXIT' : (s.direction || '—')}
                        </span>
                      </td>
                      <td style={{ fontSize: '11px' }}>{s.trigger_price != null ? `₹${s.trigger_price.toLocaleString('en-IN')}` : '—'}</td>
                      <td>
                        {s.reason
                          ? <span style={{ padding: '1px 5px', borderRadius: 3, fontSize: 9, fontFamily: 'var(--font-mono)', background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)' }}>{s.reason}</span>
                          : <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>—</span>}
                      </td>
                      <td style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                        {s.fired_at ? new Date(s.fired_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '—'}
                      </td>
                      <td>
                        <span style={{
                          fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '100px',
                          color: s.status === 'executed' ? '#22DD88' : s.status === 'error' ? '#FF4444' : s.status === 'missed' ? '#FFB300' : s.status === 'skipped' ? 'rgba(232,232,248,0.35)' : '#FF6B00',
                          background: s.status === 'executed' ? 'rgba(34,221,136,0.12)' : s.status === 'error' ? 'rgba(255,68,68,0.12)' : s.status === 'missed' ? 'rgba(255,179,0,0.12)' : s.status === 'skipped' ? 'rgba(232,232,248,0.06)' : 'rgba(255,107,0,0.12)',
                        }}>{s.status.toUpperCase()}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'Bots' && (<>

      {/* Empty state */}
      {!loading && activeBots.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>◧</div>
          <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '6px', color: 'var(--text-muted)' }}>No bots yet</div>
          <div style={{ fontSize: '12px', marginBottom: '20px' }}>Create a bot to start running indicator-based strategies</div>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Create Your First Bot</button>
        </div>
      )}

      {/* Active bots */}
      {activeBots.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '16px', marginBottom: archivedBots.length > 0 && showArchived ? '24px' : '16px' }}>
          {activeBots.map(bot => (
            <BotCard key={bot.id} bot={bot} accounts={accounts}
              onUpdate={handleUpdate} onArchive={handleArchive}
              onUnarchive={handleUnarchive} onDelete={handleDelete} />
          ))}
        </div>
      )}

      {/* Archived bots */}
      {showArchived && archivedBots.length > 0 && (
        <>
          <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--accent-amber)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '12px' }}>📦 Archived Bots</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '16px', marginBottom: '16px' }}>
            {archivedBots.map(bot => (
              <BotCard key={bot.id} bot={bot} accounts={accounts}
                onUpdate={handleUpdate} onArchive={handleArchive}
                onUnarchive={handleUnarchive} onDelete={handleDelete} />
            ))}
          </div>
        </>
      )}

      </>)}

      {activeTab === 'Orders' && (() => {
        const openOrders   = allBotOrders.filter(o => o.status === 'open')
        const closedOrders = allBotOrders.filter(o => o.status !== 'open')
        const renderOrdersTable = (rows: AggOrder[]) => (
          <div className="cloud-fill" style={{ borderRadius: 8, overflow: 'hidden', border: '0.5px solid rgba(255,107,0,0.18)' }}>
            <table className="staax-table">
              <thead><tr><th>Time</th><th>Bot</th><th>Symbol</th><th>Dir</th><th>Lots</th><th>Entry ₹</th><th>Exit ₹</th><th>P&L</th><th>Status</th></tr></thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={9} style={{ textAlign: 'center', padding: '18px', color: 'var(--text-dim)', fontSize: '12px' }}>No orders</td></tr>
                ) : rows.map(o => (
                  <tr key={o.id}>
                    <td style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {o.entry_time ? new Date(o.entry_time).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'}
                    </td>
                    <td style={{ fontSize: '11px' }}>
                      <span style={{ fontWeight: 600, color: 'var(--amber)' }}>{o.bot_name}</span>
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
                    <td style={{ fontSize: '11px' }}>{o.lots}</td>
                    <td style={{ fontSize: '11px', fontFamily: 'var(--font-mono)' }}>{o.entry_price != null ? `₹${o.entry_price.toLocaleString('en-IN')}` : '—'}</td>
                    <td style={{ fontSize: '11px', fontFamily: 'var(--font-mono)' }}>{o.exit_price != null ? `₹${o.exit_price.toLocaleString('en-IN')}` : '—'}</td>
                    <td style={{ fontSize: '11px', fontWeight: 600 }}>
                      {o.status === 'open' && ltpMap[(o as any).instrument] != null && o.entry_price != null
                        ? (() => {
                            const live = (ltpMap[(o as any).instrument] - o.entry_price) * o.lots
                            return <span style={{ color: live >= 0 ? '#22DD88' : '#FF4444' }}>
                              {live >= 0 ? '+' : ''}₹{live.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                              <span style={{ fontSize: 8, marginLeft: 4, opacity: 0.55, fontWeight: 400 }}>LIVE</span>
                            </span>
                          })()
                        : o.pnl != null
                          ? <span style={{ color: o.pnl >= 0 ? '#22DD88' : '#FF4444' }}>
                              {o.pnl >= 0 ? '+' : ''}₹{o.pnl.toLocaleString('en-IN')}
                            </span>
                          : <span style={{ color: 'var(--text-dim)' }}>—</span>
                      }
                    </td>
                    <td><span style={{ fontSize: '10px', fontWeight: 600, color: o.status === 'open' ? '#22DD88' : 'var(--text-dim)' }}>{o.status.toUpperCase()}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
        return (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
              <span style={{ fontSize: '10px', fontWeight: 600, color: 'rgba(232,232,248,0.5)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {openOrders.length > 0 && <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: 'var(--green)', animation: 'pulse 1.5s infinite', marginRight: '6px', verticalAlign: 'middle' }} />}
                Open Positions · {openOrders.length}
              </span>
              <span style={{ fontSize: '10px', color: 'var(--text-dim)', marginLeft: 'auto' }}>orders 30s · ltp 5s</span>
            </div>
            {renderOrdersTable(openOrders)}
            <div style={{ fontSize: '10px', fontWeight: 600, color: 'rgba(232,232,248,0.5)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: '20px', marginBottom: '8px' }}>
              Closed · {closedOrders.length}
            </div>
            {renderOrdersTable(closedOrders)}
          </div>
        )
      })()}

      {showCreate && (
        <BotConfigurator accounts={accounts} onSave={handleSave} onClose={() => setShowCreate(false)} />
      )}
    </div>
  )
}
