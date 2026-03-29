import { useState, useEffect } from 'react'
import { accountsAPI } from '@/services/api'
import axios from 'axios'
import { useStore } from '@/store'

const API = 'http://localhost:8000/api/v1'
const auth = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
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
  active: 'var(--accent-blue)', live: 'var(--green)', inactive: 'var(--text-dim)',
}

type Bot = {
  id: string; name: string; account_id: string; instrument: string
  exchange: string; expiry: string; indicator: string
  timeframe_mins: number; lots: number
  channel_candles?: number; channel_tf?: string; tt_lookback?: number
  status: string; is_archived: boolean; is_practix?: boolean
}
type BotOrder = {
  id: string; direction: string; lots: number
  entry_price?: number; exit_price?: number
  entry_time?: string; exit_time?: string
  pnl?: number; status: string; signal_type?: string; expiry: string
}

// ── Platform-style confirm modal ──────────────────────────────────────────────
function ConfirmModal({ title, desc, confirmLabel, confirmColor, onConfirm, onCancel }: {
  title: string; desc: string; confirmLabel: string; confirmColor: string
  onConfirm: () => void; onCancel: () => void
}) {
  return (
    <div className="modal-overlay">
      <div className="modal-box" style={{ maxWidth: '380px' }}>
        <div style={{ fontWeight: 700, fontSize: '15px', marginBottom: '8px' }}>{title}</div>
        <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '20px' }}>{desc}</div>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn" onClick={onConfirm}
            style={{ background: confirmColor, color: '#fff', border: 'none' }}>{confirmLabel}</button>
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
      <div className="modal-box" style={{ maxWidth: '420px' }}>
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
            <select className="staax-select" value={form.account_id} onChange={e => u('account_id', e.target.value)} style={{ width: '100%' }}>
              {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.nickname} ({a.broker})</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: '6px' }}>Timeframe</label>
            <select className="staax-select" value={form.timeframe_mins} onChange={e => u('timeframe_mins', parseInt(e.target.value))} style={{ width: '100%' }}>
              {TIMEFRAMES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: '6px' }}>Lot Size</label>
            <input className="staax-input" type="number" min={1} value={form.lots} onChange={e => u('lots', parseInt(e.target.value) || 1)} />
          </div>
          {ind?.params.includes('channel_candles') && (
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: '6px' }}>Channel Timeframe</label>
              <select className="staax-select" value={form.channel_tf} onChange={e => u('channel_tf', e.target.value)} style={{ width: '100%' }}>
                {CHANNEL_TFS.map(t => <option key={t} value={t}>{t === 'D' ? 'Daily' : `${t} min`}</option>)}
              </select>
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
      <div className="modal-box" style={{ maxWidth: '480px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div style={{ fontWeight: 700, fontSize: '15px' }}>Create Bot</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '18px' }}>×</button>
        </div>
        {/* Progress */}
        <div style={{ display: 'flex', gap: '4px', marginBottom: '24px' }}>
          {steps.map(s => (
            <div key={s.n} style={{ flex: 1 }}>
              <div style={{ height: '3px', borderRadius: '2px', background: step >= s.n ? 'var(--accent-blue)' : 'var(--bg-border)', transition: 'background 0.2s' }}/>
              <div style={{ fontSize: '9px', color: step >= s.n ? 'var(--accent-blue)' : 'var(--text-dim)', marginTop: '4px', textAlign: 'center' }}>{s.label}</div>
            </div>
          ))}
        </div>

        {step === 1 && (
          <div>
            <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '12px' }}>Choose Instrument</div>
            {INSTRUMENTS.map(inst => (
              <button key={inst.value} onClick={() => u('instrument', inst.value)}
                style={{ width: '100%', padding: '14px 16px', borderRadius: 'var(--radius-md)', marginBottom: '8px',
                  border: `2px solid ${form.instrument === inst.value ? 'var(--accent-blue)' : 'var(--bg-border)'}`,
                  background: form.instrument === inst.value ? 'var(--accent-blue-dim)' : 'var(--bg-secondary)',
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
                  border: `2px solid ${form.indicator === ind.value ? 'var(--accent-blue)' : 'var(--bg-border)'}`,
                  background: form.indicator === ind.value ? 'var(--accent-blue-dim)' : 'var(--bg-secondary)',
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
                    border: `2px solid ${form.timeframe_mins === tf.value ? 'var(--accent-blue)' : 'var(--bg-border)'}`,
                    background: form.timeframe_mins === tf.value ? 'rgba(0,176,240,0.08)' : 'var(--bg-secondary)',
                    color: form.timeframe_mins === tf.value ? 'var(--accent-blue)' : 'var(--text)',
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
                    border: `2px solid ${form.timeframe_mins === tf.value ? 'var(--accent-blue)' : 'var(--bg-border)'}`,
                    background: form.timeframe_mins === tf.value ? 'rgba(0,176,240,0.08)' : 'var(--bg-secondary)',
                    color: form.timeframe_mins === tf.value ? 'var(--accent-blue)' : 'var(--text)',
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
                      <select className="staax-select" value={form.channel_tf} onChange={e => u('channel_tf', e.target.value)} style={{ width: '100%' }}>
                        {CHANNEL_TFS.map(t => <option key={t} value={t}>{t === 'D' ? 'Daily' : `${t} min`}</option>)}
                      </select>
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
              <select className="staax-select" value={form.account_id} onChange={e => u('account_id', e.target.value)} style={{ width: '100%' }}>
                {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.nickname} ({a.broker})</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: '6px' }}>Lot Size</label>
              <input className="staax-input" type="number" min={1} value={form.lots} onChange={e => u('lots', parseInt(e.target.value) || 1)} />
            </div>
            <div style={{ background: 'var(--accent-blue-dim)', borderRadius: 'var(--radius-md)', padding: '8px 12px', fontSize: '11px', color: 'var(--accent-blue)' }}>
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

  useEffect(() => {
    apiGet(`/bots/${bot.id}/orders`).then(r => setOrders(r.data || [])).catch(() => {})
  }, [bot.id])

  const openOrder = orders.find(o => o.status === 'open')
  const accountName = accounts.find((a: any) => a.id === bot.account_id)?.nickname || '—'
  const tfLabel = TIMEFRAMES.find(t => t.value === bot.timeframe_mins)?.label || `${bot.timeframe_mins}m`
  const indLabel = INDICATORS.find(i => i.value === bot.indicator)?.label || bot.indicator

  const saveLots = async () => {
    const v = parseInt(lotsVal) || 1
    await onUpdate(bot.id, { lots: v })
    setEditLots(false)
  }

  return (
    <>
      <div className="card" style={{ opacity: bot.status === 'inactive' ? 0.7 : 1, transition: 'all 0.15s' }}>
        {/* Status + actions row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
          <span style={{ fontSize: '10px', fontWeight: 700, color: STATUS_COLOR[bot.status] || 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: '5px' }}>
            {bot.status === 'live' && <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: 'var(--green)', animation: 'pulse 1.5s infinite' }}/>}
            {bot.is_archived ? '📦 Archived' : bot.status}
          </span>
          {!bot.is_archived && (
            <button onClick={() => onUpdate(bot.id, { is_practix: !(bot.is_practix ?? true) })}
              style={{ fontSize: '9px', fontWeight: 700, padding: '2px 7px', borderRadius: '3px',
                border: 'none', cursor: 'pointer', letterSpacing: '0.06em',
                background: (bot.is_practix ?? true) ? 'rgba(215,123,18,0.15)' : 'rgba(34,197,94,0.15)',
                color: (bot.is_practix ?? true) ? 'var(--accent-amber)' : 'var(--green)' }}>
              {(bot.is_practix ?? true) ? 'PRAC' : 'LIVE'}
            </button>
          )}
          <div style={{ display: 'flex', gap: '4px' }}>

            {bot.is_archived
              ? <button title="Unarchive" onClick={() => onUnarchive(bot.id)}
                  style={{ background: 'none', border: '1px solid var(--bg-border)', borderRadius: 'var(--radius-sm)', padding: '3px 7px', cursor: 'pointer', color: 'var(--accent-amber)', fontSize: '11px' }}>↩ Restore</button>
              : <button title="Archive" onClick={() => setShowArch(true)}
                  style={{ background: 'none', border: '1px solid var(--bg-border)', borderRadius: 'var(--radius-sm)', padding: '3px 7px', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '11px' }}>📦</button>
            }
            <button title="Delete" onClick={() => setShowDel(true)}
              style={{ background: 'none', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 'var(--radius-sm)', padding: '3px 7px', cursor: 'pointer', color: 'var(--red)', fontSize: '11px' }}>🗑</button>
          </div>
        </div>

        {/* Name + meta */}
        <div onClick={() => setShowEdit(true)} style={{ fontWeight: 700, fontSize: '14px', marginBottom: '4px', cursor: 'pointer', transition: 'color 0.12s' }} onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.color = 'var(--accent-blue)'} onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.color = 'var(--text)'}>{bot.name}</div>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '10px', display: 'flex', gap: '5px', flexWrap: 'wrap', alignItems: 'center' }}>
          <span>{bot.instrument}</span><span>·</span><span>{indLabel}</span><span>·</span><span>{tfLabel}</span>
          <span style={{ fontSize: '10px', fontWeight: 700, padding: '1px 7px', borderRadius: '20px',
            background: 'var(--accent-blue-dim)', color: 'var(--accent-blue)', border: '1px solid rgba(0,176,240,0.2)' }}>
            {accountName}
          </span>
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: '8px', marginBottom: '12px' }}>
          <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', padding: '8px 10px' }}>
            <div style={{ fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>Lots</div>
            {editLots ? (
              <div style={{ display: 'flex', gap: '3px' }}>
                <input type="number" value={lotsVal} onChange={e => setLotsVal(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveLots(); if (e.key === 'Escape') setEditLots(false) }}
                  style={{ width: '40px', background: 'var(--bg-primary)', border: '1px solid var(--accent-blue)', borderRadius: '3px', color: 'var(--text)', fontSize: '11px', padding: '1px 4px' }} autoFocus />
                <button onClick={saveLots} style={{ background: 'var(--accent-blue)', border: 'none', borderRadius: '3px', color: '#000', fontSize: '10px', padding: '0 5px', cursor: 'pointer' }}>✓</button>
              </div>
            ) : (
              <div onClick={() => { setEditLots(true); setLotsVal(String(bot.lots)) }}
                title="Click to edit" style={{ fontWeight: 700, fontSize: '14px', cursor: 'pointer', color: 'var(--accent-blue)' }}>
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

        {/* Promote to Live */}
        {!bot.is_archived && (bot.is_practix ?? true) && (
          <button className="btn btn-ghost" style={{ width: '100%', fontSize: '11px', marginBottom: '6px', color: 'var(--green)', borderColor: 'rgba(34,197,94,0.3)' }}
            onClick={() => onUpdate(bot.id, { is_practix: false })}>
            → Promote to LIVE
          </button>
        )}
        {/* Activate/Deactivate */}
        {!bot.is_archived && (
          <button className="btn btn-ghost" style={{ width: '100%', fontSize: '11px', marginBottom: orders.length > 0 ? '8px' : '0' }}
            onClick={() => onUpdate(bot.id, { status: bot.status === 'inactive' ? 'active' : 'inactive' })}>
            {bot.status === 'inactive' ? '▶ Activate' : '⏸ Deactivate'}
          </button>
        )}

        {/* Orders toggle */}
        {orders.length > 0 && (
          <>
            <button onClick={() => setExpanded(e => !e)}
              style={{ width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--bg-border)', borderRadius: 'var(--radius-md)', padding: '6px', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '11px', marginBottom: '8px' }}>
              {expanded ? '▲' : '▼'} {orders.length} order{orders.length !== 1 ? 's' : ''}
            </button>
            {expanded && (
              <div style={{ borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--bg-border)' }}>
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

type AggOrder = BotOrder & { botName: string }

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function IndicatorsPage() {
  const isPractixMode = useStore(s => s.isPractixMode)
  const [bots, setBots]           = useState<Bot[]>([])
  const [accounts, setAccounts]   = useState<any[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [loading, setLoading]     = useState(true)
  const [allBotOrders, setAllBotOrders] = useState<AggOrder[]>([])

  useEffect(() => {
    Promise.all([
      apiGet(`/bots/?is_practix=${isPractixMode}`).then(r => setBots(r.data || [])),
      accountsAPI.list().then(r => setAccounts(r.data || [])),
    ]).finally(() => setLoading(false))
  }, [isPractixMode])

  // Aggregate orders from all active bots
  useEffect(() => {
    const activeBotList = bots.filter(b => !b.is_archived)
    if (activeBotList.length === 0) return
    Promise.allSettled(
      activeBotList.map(b =>
        apiGet(`/bots/${b.id}/orders`).then(r =>
          (r.data || []).map((o: BotOrder) => ({ ...o, botName: b.name }))
        )
      )
    ).then(results => {
      const flat: AggOrder[] = results
        .filter(r => r.status === 'fulfilled')
        .flatMap(r => (r as PromiseFulfilledResult<AggOrder[]>).value)
      setAllBotOrders(flat)
    })
  }, [bots])

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
          <h1 style={{ fontFamily: "'ADLaM Display', serif", fontSize: '22px', fontWeight: 400 }}>Indicator Bots</h1>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px', display:'flex', alignItems:'center', gap:'6px' }}>
            {loading ? 'Loading...' : `${activeBots.filter(b => b.status !== 'inactive').length} running · ${activeBots.length} total`}
          {' '}·{' '}<span style={{fontSize:'10px',fontWeight:700,padding:'2px 6px',borderRadius:'4px',background:isPractixMode?'rgba(215,123,18,0.15)':'rgba(34,197,94,0.12)',color:isPractixMode?'var(--accent-amber)':'var(--green)',border:isPractixMode?'1px solid rgba(215,123,18,0.3)':'1px solid rgba(34,197,94,0.25)'}}>{isPractixMode?'PRACTIX':'LIVE'}</span></p>
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

      {/* ── Aggregated Orders ───────────────────────────────────────────────── */}
      {allBotOrders.length > 0 && (
        <div style={{ marginTop: '8px' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>
            Orders · {allBotOrders.length} total
          </div>
          <div className="no-scrollbar" style={{ maxHeight: '320px', overflowY: 'auto', border: '1px solid var(--bg-border)', borderRadius: '7px' }}>
            <table className="staax-table">
              <thead>
                <tr>
                  <th>Bot</th><th>Dir</th><th>Lots</th><th>Entry ₹</th><th>Exit ₹</th><th>P&L</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {allBotOrders.map(o => (
                  <tr key={o.id}>
                    <td style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{o.botName}</td>
                    <td style={{ fontSize: '11px', fontWeight: 700, color: o.direction === 'BUY' ? 'var(--green)' : 'var(--red)' }}>{o.direction}</td>
                    <td style={{ fontSize: '11px' }}>{o.lots}</td>
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
        </div>
      )}

      {/* ── Signal Tracker ──────────────────────────────────────────────────── */}
      <div style={{ marginTop: '24px' }}>
        <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>Signal Tracker</div>
        <div style={{ border: '1px solid var(--bg-border)', borderRadius: '7px', overflow: 'hidden' }}>
          <table className="staax-table">
            <thead>
              <tr>
                <th>Signal</th><th>Underlying</th><th>Direction</th><th>Triggered At</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: '18px', color: 'var(--text-dim)', fontSize: '12px' }}>
                  No signals today — bot signal API coming soon
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {showCreate && (
        <BotConfigurator accounts={accounts} onSave={handleSave} onClose={() => setShowCreate(false)} />
      )}
    </div>
  )
}
