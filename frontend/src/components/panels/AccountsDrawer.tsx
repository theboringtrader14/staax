import { useState, useEffect, useCallback } from 'react'
import { CaretRight } from '@phosphor-icons/react'
import { accountsAPI } from '@/services/api'
import { useStore } from '@/store'
import { getCurrentFY } from '@/utils/fy'

// ── Types ──────────────────────────────────────────────────────────────────────
interface AccountLocal {
  id: string; name: string; broker: string; type: string; status: string
  margin: number; pnl: number; token: string; color: string
  globalSL: number | null; globalTP: number | null; fyBrokerage: number | null
  client_id?: string; api_key?: string
  scope?: string; is_active?: boolean
}
interface EditCredsState {
  id: string; nickname: string; client_id: string; api_key: string; api_secret: string; totp_secret: string
}
interface AddAccountForm {
  broker: 'zerodha' | 'angelone' | ''
  nickname: string; client_id: string; api_key: string; api_secret: string; totp_secret: string; scope: string
}

const EMPTY_FORM: AddAccountForm = { broker: '', nickname: '', client_id: '', api_key: '', api_secret: '', totp_secret: '', scope: 'fo' }
const NAME_TO_SLUG: Record<string, string> = { 'Mom': 'mom', 'Wife': 'wife', 'Karthik AO': 'karthik' }
function isApril() { return new Date().getMonth() === 3 }

type PanelId = 'broker' | 'margin' | 'risk'
const TABS: { id: PanelId; label: string }[] = [
  { id: 'broker', label: 'Broker' },
  { id: 'margin', label: 'Margin' },
  { id: 'risk',   label: 'Risk'   },
]

// ── Shared input style ────────────────────────────────────────────────────────
const inp: React.CSSProperties = {
  background: 'var(--bg)', boxShadow: 'var(--neu-inset)', border: 'none',
  borderRadius: 8, color: 'var(--text)', fontSize: 12, padding: '0 10px',
  height: 32, width: '100%', fontFamily: 'var(--font-mono)', outline: 'none', boxSizing: 'border-box',
}
const lbl: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase',
  letterSpacing: '0.08em', marginBottom: 4, display: 'block',
}

// ── Main component ────────────────────────────────────────────────────────────
export default function AccountsDrawer() {
  const storeAccounts = useStore(s => s.accounts)
  const [openPanel, setOpenPanel] = useState<PanelId | null>(null)

  // Account data
  const [accounts,     setAccounts]     = useState<AccountLocal[]>([])
  const [editMargin,   setEditMargin]   = useState<Record<string, string>>({})
  const [editSL,       setEditSL]       = useState<Record<string, string>>({})
  const [editTP,       setEditTP]       = useState<Record<string, string>>({})
  const [editBrok,     setEditBrok]     = useState<Record<string, string>>({})
  const [saved,        setSaved]        = useState<Record<string, string>>({})
  const [saving,       setSaving]       = useState<Record<string, boolean>>({})
  const [tokenStatus,  setTokenStatus]  = useState<Record<string, boolean>>({})
  const [loginLoading, setLoginLoading] = useState<Record<string, boolean>>({})
  const [editNick,     setEditNick]     = useState<Record<string, string>>({})
  const [nickEditing,  setNickEditing]  = useState<Record<string, boolean>>({})
  const [editingCreds, setEditingCreds] = useState<EditCredsState | null>(null)
  const [showSecret,   setShowSecret]   = useState(false)
  const [showTotp,     setShowTotp]     = useState(false)
  const [fundsData,    setFundsData]    = useState<Record<string, { available: number; used: number; total: number; unrealized_pnl: number; realized_pnl: number } | null>>({})
  const [fundsLoading, setFundsLoading] = useState<Record<string, boolean>>({})
  const [confirmAction, setConfirmAction] = useState<{ type: 'deactivate' | 'reactivate'; accountId: string; nickname: string } | null>(null)

  // Add Account modal
  const [addModal,  setAddModal]  = useState(false)
  const [addStep,   setAddStep]   = useState<1|2>(1)
  const [addForm,   setAddForm]   = useState<AddAccountForm>(EMPTY_FORM)
  const [addSaving, setAddSaving] = useState(false)
  const [addError,  setAddError]  = useState('')
  const [addToast,  setAddToast]  = useState('')

  const mapAccounts = (data: any[]) => data.map((api: any) => ({
    id: api.id, name: api.nickname,
    broker: api.broker === 'zerodha' ? 'Zerodha' : 'Angel One',
    status: api.status === 'active' ? 'active' : 'pending',
    globalSL: api.global_sl ?? null, globalTP: api.global_tp ?? null,
    fyBrokerage: api.fy_brokerage ?? null,
    margin: api.fy_margin ?? 0, pnl: 0, token: '', color: '',
    type: api.broker === 'angelone' && api.nickname === 'Wife' ? 'MCX' : 'F&O',
    client_id: api.client_id ?? '', api_key: api.api_key ?? '',
    scope: api.scope ?? 'fo', is_active: api.is_active ?? true,
  }))

  const fetchAccounts = useCallback(() => {
    accountsAPI.list().then(res => {
      const data: any[] = res.data || []
      if (data.length > 0) setAccounts(mapAccounts(data))
    }).catch(() => {})
  }, [])

  useEffect(() => { fetchAccounts() }, [fetchAccounts])

  useEffect(() => {
    if (storeAccounts.length > 0) setAccounts(mapAccounts(storeAccounts as any[]))
  }, [storeAccounts])

  const fetchFunds = async (accName: string, refresh = false) => {
    const slug = NAME_TO_SLUG[accName]
    if (!slug) return
    setFundsLoading(p => ({ ...p, [accName]: true }))
    try {
      const res = await accountsAPI.angeloneFunds(slug, refresh)
      setFundsData(p => ({ ...p, [accName]: res.data }))
    } catch {
      setFundsData(p => ({ ...p, [accName]: null }))
    } finally {
      setFundsLoading(p => ({ ...p, [accName]: false }))
    }
  }

  useEffect(() => {
    const check = async () => {
      try {
        const [z, mom, wife, kao] = await Promise.all([
          accountsAPI.zerodhaTokenStatus(),
          accountsAPI.angeloneTokenStatus('mom'),
          accountsAPI.angeloneTokenStatus('wife'),
          accountsAPI.angeloneTokenStatus('karthik'),
        ])
        const status = {
          'Karthik':    z.data?.connected   ?? false,
          'Mom':        mom.data?.connected  ?? false,
          'Wife':       wife.data?.connected ?? false,
          'Karthik AO': kao.data?.connected  ?? false,
        }
        setTokenStatus(status)
        for (const [name, connected] of Object.entries(status)) {
          if (connected && NAME_TO_SLUG[name]) fetchFunds(name)
        }
      } catch {}
    }
    check()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Escape key to close
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenPanel(null) }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [])

  const showSaved = (id: string, msg: string) => {
    setSaved(s => ({ ...s, [id]: msg }))
    setTimeout(() => setSaved(s => { const n = { ...s }; delete n[id]; return n }), 3000)
  }

  const saveNickname = async (acc: AccountLocal) => {
    const newName = (editNick[acc.id] ?? acc.name).trim()
    if (!newName || newName === acc.name) { setNickEditing(n => ({ ...n, [acc.id]: false })); return }
    try {
      await accountsAPI.updateNickname(acc.id, newName)
      setAccounts(a => a.map(x => x.id === acc.id ? { ...x, name: newName } : x))
      showSaved(acc.id, '✅ Nickname saved')
    } catch { showSaved(acc.id, '⚠️ Save failed') }
    setNickEditing(n => ({ ...n, [acc.id]: false }))
  }

  const saveMargin = async (acc: AccountLocal) => {
    const marginVal = parseFloat(editMargin[acc.id] || String(acc.margin))
    const brok = parseFloat(editBrok[acc.id] || String(acc.fyBrokerage ?? 0))
    setSaving(s => ({ ...s, [acc.id + '_margin']: true }))
    try {
      const calls: Promise<any>[] = []
      if (!isNaN(marginVal) && marginVal > 0) calls.push(accountsAPI.updateMargin(acc.id, { financial_year: getCurrentFY(), margin_amount: marginVal }))
      const riskPayload: Record<string, number> = {}
      if (isApril() && !isNaN(brok)) riskPayload.fy_brokerage = brok
      if (Object.keys(riskPayload).length > 0) calls.push(accountsAPI.updateGlobalRisk(acc.id, riskPayload))
      await Promise.all(calls)
      setAccounts(a => a.map(x => x.id === acc.id ? { ...x, margin: !isNaN(marginVal) ? marginVal : x.margin, fyBrokerage: isApril() && !isNaN(brok) ? brok : x.fyBrokerage } : x))
      showSaved(acc.id + '_margin', '✅ Saved')
    } catch { showSaved(acc.id + '_margin', '⚠️ Failed') }
    finally { setSaving(s => ({ ...s, [acc.id + '_margin']: false })) }
  }

  const saveRisk = async (acc: AccountLocal) => {
    const sl = parseFloat(editSL[acc.id] || String(acc.globalSL ?? ''))
    const tp = parseFloat(editTP[acc.id] || String(acc.globalTP ?? ''))
    setSaving(s => ({ ...s, [acc.id + '_risk']: true }))
    try {
      const payload: Record<string, number> = {}
      if (!isNaN(sl)) payload.global_sl = sl
      if (!isNaN(tp)) payload.global_tp = tp
      if (Object.keys(payload).length > 0) await accountsAPI.updateGlobalRisk(acc.id, payload)
      setAccounts(a => a.map(x => x.id === acc.id ? { ...x, globalSL: !isNaN(sl) ? sl : x.globalSL, globalTP: !isNaN(tp) ? tp : x.globalTP } : x))
      showSaved(acc.id + '_risk', '✅ Saved')
    } catch { showSaved(acc.id + '_risk', '⚠️ Failed') }
    finally { setSaving(s => ({ ...s, [acc.id + '_risk']: false })) }
  }

  const handleLogin = async (acc: AccountLocal) => {
    const slug = NAME_TO_SLUG[acc.name]
    setLoginLoading(l => ({ ...l, [acc.id]: true }))
    try {
      if (acc.broker === 'Angel One' && slug) {
        await accountsAPI.angeloneAutoLogin(slug)
        const res = await accountsAPI.angeloneTokenStatus(slug)
        setTokenStatus(s => ({ ...s, [acc.name]: res.data?.connected ?? false }))
        if (res.data?.connected) fetchFunds(acc.name)
      } else if (acc.broker === 'Zerodha') {
        const res = await accountsAPI.zerodhaLoginUrl()
        if (res.data?.login_url) window.open(res.data.login_url, '_blank', 'width=800,height=600')
      }
    } catch {}
    finally { setLoginLoading(l => ({ ...l, [acc.id]: false })) }
  }

  const submitAdd = async () => {
    if (!addForm.nickname.trim() || !addForm.client_id.trim()) { setAddError('Nickname and Client ID required'); return }
    setAddSaving(true); setAddError('')
    try {
      await accountsAPI.create({ broker: addForm.broker, nickname: addForm.nickname.trim(), client_id: addForm.client_id.trim(), api_key: addForm.api_key.trim() || undefined, api_secret: addForm.api_secret.trim() || undefined, totp_secret: addForm.totp_secret.trim() || undefined, scope: addForm.scope || 'fo' })
      setAddModal(false); setAddError('')
      fetchAccounts()
      setAddToast('✅ Account added'); setTimeout(() => setAddToast(''), 3000)
    } catch (e: any) { setAddError(e?.response?.data?.detail || 'Failed to add account') }
    finally { setAddSaving(false) }
  }

  const executeConfirmedAction = async () => {
    if (!confirmAction) return
    try {
      await fetch(`/api/v1/accounts/${confirmAction.accountId}/${confirmAction.type}`, { method: 'PATCH' })
      setConfirmAction(null); fetchAccounts()
    } catch {}
  }

  const togglePanel = (id: PanelId) => setOpenPanel(p => p === id ? null : id)

  // ── Panel header ─────────────────────────────────────────────────────────────
  const PanelHeader = ({ title, subtitle }: { title: string; subtitle: string }) => (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--text)' }}>{title}</span>
        <button onClick={() => setOpenPanel(null)} style={{ background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', border: 'none', borderRadius: '50%', width: 28, height: 28, cursor: 'pointer', color: 'var(--text-dim)', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-mute)' }}>{subtitle}</div>
      <div style={{ marginTop: 12, borderBottom: '1px solid var(--border)' }} />
    </div>
  )

  // ── Account card for Panel 1 (Broker) ────────────────────────────────────────
  const BrokerCard = ({ acc }: { acc: AccountLocal }) => {
    const connected = tokenStatus[acc.name] ?? false
    const slug = NAME_TO_SLUG[acc.name]
    const isWife = acc.name === 'Wife'
    const funds = fundsData[acc.name]

    return (
      <div style={{ background: 'var(--bg)', boxShadow: 'var(--neu-raised)', borderRadius: 20, padding: 20, marginBottom: 16 }}>
        {/* Row 1: Name + status */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div>
            {nickEditing[acc.id] ? (
              <input autoFocus defaultValue={acc.name} style={{ ...inp, width: 120, height: 26, fontSize: 14 }}
                onChange={e => setEditNick(n => ({ ...n, [acc.id]: e.target.value }))}
                onBlur={() => saveNickname(acc)}
                onKeyDown={e => { if (e.key === 'Enter') saveNickname(acc); if (e.key === 'Escape') setNickEditing(n => ({ ...n, [acc.id]: false })) }} />
            ) : (
              <div onClick={() => setNickEditing(n => ({ ...n, [acc.id]: true }))} title="Click to rename"
                style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, color: 'var(--text)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                {acc.name} <span style={{ fontSize: 10, color: 'var(--text-mute)', fontWeight: 400 }}>✎</span>
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <span style={{ background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', color: 'var(--accent)', borderRadius: 20, padding: '2px 8px', fontSize: 10, fontWeight: 600 }}>{acc.broker}</span>
              <span style={{ fontSize: 10, color: 'var(--text-mute)' }}>{acc.type}</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: connected ? '#22DD88' : isWife ? '#F59E0B' : '#FF4444', display: 'inline-block', boxShadow: connected ? '0 0 6px #22DD88' : 'none' }} />
            <span style={{ fontSize: 10, color: connected ? '#22DD88' : isWife ? '#F59E0B' : '#FF4444', fontWeight: 600 }}>
              {connected ? 'Live' : isWife ? 'Phase 2' : 'Offline'}
            </span>
          </div>
        </div>

        {/* Live funds strip */}
        {slug && connected && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Live Funds</span>
              <button onClick={() => fetchFunds(acc.name, true)} disabled={fundsLoading[acc.name]}
                style={{ background: 'none', border: 'none', color: 'var(--text-mute)', cursor: 'pointer', fontSize: 11, padding: 0 }}>
                {fundsLoading[acc.name] ? '…' : '↻'}
              </button>
            </div>
            {funds ? (
              <div style={{ display: 'flex', gap: 6 }}>
                {[
                  { label: 'Cash',  value: `₹${(funds.available/100000).toFixed(1)}L`, color: 'var(--text)' },
                  { label: 'Used',  value: `₹${(funds.used/100000).toFixed(1)}L`,      color: 'var(--text-dim)' },
                  { label: 'Unreal', value: `${funds.unrealized_pnl >= 0 ? '+' : ''}₹${Math.abs(funds.unrealized_pnl).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`, color: funds.unrealized_pnl >= 0 ? '#22DD88' : '#FF4444' },
                ].map(m => (
                  <div key={m.label} style={{ flex: 1, background: 'var(--bg)', boxShadow: 'var(--neu-inset)', borderRadius: 8, padding: '5px 4px', textAlign: 'center' }}>
                    <div style={{ fontSize: 8, color: 'var(--text-mute)', marginBottom: 2, textTransform: 'uppercase' }}>{m.label}</div>
                    <div style={{ fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono)', color: m.color }}>{m.value}</div>
                  </div>
                ))}
              </div>
            ) : fundsLoading[acc.name] ? (
              <div style={{ fontSize: 10, color: 'var(--text-mute)' }}>Loading…</div>
            ) : null}
          </div>
        )}

        {/* Action row */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {!isWife && (
            <button onClick={() => handleLogin(acc)} disabled={loginLoading[acc.id]}
              style={{ height: 28, padding: '0 12px', borderRadius: 100, fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer', background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', color: connected ? '#22DD88' : 'var(--accent)' }}>
              {loginLoading[acc.id] ? '…' : connected ? 'Refresh Token' : 'Login'}
            </button>
          )}
          <button onClick={() => setEditingCreds({ id: acc.id, nickname: acc.name, client_id: acc.client_id || '', api_key: acc.api_key || '', api_secret: '', totp_secret: '' })}
            style={{ height: 28, padding: '0 12px', borderRadius: 100, fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer', background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', color: 'var(--text-dim)' }}>
            API Keys
          </button>
          {acc.is_active !== false ? (
            <button onClick={() => setConfirmAction({ type: 'deactivate', accountId: acc.id, nickname: acc.name })}
              style={{ height: 28, padding: '0 12px', borderRadius: 100, fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer', background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', color: '#FF4444' }}>
              Deactivate
            </button>
          ) : (
            <button onClick={() => setConfirmAction({ type: 'reactivate', accountId: acc.id, nickname: acc.name })}
              style={{ height: 28, padding: '0 12px', borderRadius: 100, fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer', background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', color: '#22DD88' }}>
              Reactivate
            </button>
          )}
        </div>

        {saved[acc.id] && (
          <div style={{ marginTop: 8, fontSize: 11, color: saved[acc.id].startsWith('✅') ? '#22DD88' : '#F59E0B', fontWeight: 600 }}>{saved[acc.id]}</div>
        )}
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Tab triggers — fixed left edge */}
      <div style={{ position: 'fixed', left: 0, top: '50%', transform: 'translateY(-50%)', zIndex: 80, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {TABS.map(tab => {
          const isOpen = openPanel === tab.id
          return (
            <button key={tab.id} onClick={() => togglePanel(tab.id)}
              style={{
                width: 32, height: 120, cursor: 'pointer', border: 'none',
                borderRadius: '0 12px 12px 0',
                background: 'var(--bg)',
                boxShadow: isOpen ? 'var(--neu-inset)' : 'var(--neu-raised-sm)',
                borderLeft: `3px solid ${isOpen ? 'var(--accent)' : 'transparent'}`,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
                transition: 'all 200ms ease',
                padding: 0,
              }}>
              <span style={{
                writingMode: 'vertical-rl', transform: 'rotate(180deg)',
                fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600,
                letterSpacing: '1.5px', textTransform: 'uppercase',
                color: isOpen ? 'var(--accent)' : 'var(--text-dim)',
              }}>{tab.label}</span>
              <CaretRight size={10} weight="bold"
                style={{ color: isOpen ? 'var(--accent)' : 'var(--text-mute)', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 200ms ease' }} />
            </button>
          )
        })}
      </div>

      {/* Backdrop */}
      {openPanel && (
        <div onClick={() => setOpenPanel(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)', zIndex: 78, backdropFilter: 'blur(2px)' }} />
      )}

      {/* Sliding panel */}
      <div style={{
        position: 'fixed', left: 32, top: 68, height: 'calc(100vh - 68px)', width: 440,
        background: 'var(--bg)', boxShadow: 'var(--neu-raised)', borderRadius: '0 0 0 0',
        zIndex: 79, overflowY: 'auto', padding: 28,
        transform: openPanel ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 300ms cubic-bezier(0.4, 0, 0.2, 1)',
        borderRight: '1px solid var(--border)',
      }}>

        {/* ── Panel 1: Broker ─── */}
        {openPanel === 'broker' && (
          <div>
            <PanelHeader title="Broker Accounts" subtitle="API credentials and connection status" />
            {accounts.length === 0 && (
              <div style={{ fontSize: 13, color: 'var(--text-mute)', textAlign: 'center', padding: '32px 0' }}>No accounts found</div>
            )}
            {accounts.map(acc => <BrokerCard key={acc.id} acc={acc} />)}
            <button onClick={() => { setAddModal(true); setAddStep(1); setAddForm(EMPTY_FORM); setAddError('') }}
              style={{ width: '100%', height: 36, borderRadius: 12, border: 'none', cursor: 'pointer', background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', color: 'var(--accent)', fontSize: 12, fontWeight: 700, marginTop: 4 }}>
              + Add Account
            </button>
            {addToast && <div style={{ marginTop: 10, fontSize: 12, color: '#22DD88', fontWeight: 600, textAlign: 'center' }}>{addToast}</div>}
          </div>
        )}

        {/* ── Panel 2: Margin ─── */}
        {openPanel === 'margin' && (
          <div>
            <PanelHeader title="Margin & Brokerage" subtitle="FY margin and brokerage settings per account" />
            {/* Summary */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
              {[
                { label: 'Total FY Margin', value: `₹${(accounts.reduce((s, a) => s + (a.margin || 0), 0) / 100000).toFixed(1)}L` },
                { label: 'Total Brokerage', value: `₹${accounts.reduce((s, a) => s + (a.fyBrokerage || 0), 0).toLocaleString('en-IN')}` },
              ].map(m => (
                <div key={m.label} style={{ background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', borderRadius: 12, padding: '12px 14px' }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{m.label}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{m.value}</div>
                </div>
              ))}
            </div>
            {accounts.filter(a => a.status === 'active').map(acc => (
              <div key={acc.id} style={{ background: 'var(--bg)', boxShadow: 'var(--neu-raised)', borderRadius: 20, padding: 20, marginBottom: 16 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, color: 'var(--text)', marginBottom: 14 }}>
                  {acc.name} <span style={{ fontSize: 10, color: 'var(--text-mute)', fontWeight: 400 }}>· {acc.broker}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                  <div>
                    <label style={lbl}>FY Margin (₹)</label>
                    <input style={inp} type="number" defaultValue={acc.margin || ''} placeholder="₹ Margin"
                      onChange={e => setEditMargin(m => ({ ...m, [acc.id]: e.target.value }))} />
                  </div>
                  <div>
                    <label style={lbl}>FY Brokerage {!isApril() && '(April only)'}</label>
                    <input style={{ ...inp, opacity: isApril() ? 1 : 0.5 }} type="number" defaultValue={acc.fyBrokerage ?? ''} placeholder="₹" disabled={!isApril()}
                      onChange={e => setEditBrok(m => ({ ...m, [acc.id]: e.target.value }))} />
                  </div>
                </div>
                <button onClick={() => saveMargin(acc)} disabled={saving[acc.id + '_margin']}
                  style={{ width: '100%', height: 36, borderRadius: 10, border: 'none', cursor: 'pointer', background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', color: 'var(--accent)', fontSize: 12, fontWeight: 600 }}>
                  {saving[acc.id + '_margin'] ? 'Saving…' : 'Save'}
                </button>
                {saved[acc.id + '_margin'] && <div style={{ marginTop: 8, fontSize: 11, color: '#22DD88', fontWeight: 600 }}>{saved[acc.id + '_margin']}</div>}
              </div>
            ))}
          </div>
        )}

        {/* ── Panel 3: Risk ─── */}
        {openPanel === 'risk' && (
          <div>
            <PanelHeader title="Risk Controls" subtitle="Global stop loss and target profit per account" />
            {accounts.filter(a => a.status === 'active').map(acc => (
              <div key={acc.id} style={{ background: 'var(--bg)', boxShadow: 'var(--neu-raised)', borderRadius: 20, padding: 20, marginBottom: 16 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, color: 'var(--text)', marginBottom: 14 }}>
                  {acc.name} <span style={{ fontSize: 10, color: 'var(--text-mute)', fontWeight: 400 }}>· {acc.broker}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                  <div>
                    <label style={lbl}>Global SL (₹)</label>
                    <input style={inp} type="number" defaultValue={acc.globalSL ?? ''} placeholder="₹ SL"
                      onChange={e => setEditSL(s => ({ ...s, [acc.id]: e.target.value }))} />
                  </div>
                  <div>
                    <label style={lbl}>Global TP (₹)</label>
                    <input style={inp} type="number" defaultValue={acc.globalTP ?? ''} placeholder="₹ TP"
                      onChange={e => setEditTP(s => ({ ...s, [acc.id]: e.target.value }))} />
                  </div>
                </div>
                <button onClick={() => saveRisk(acc)} disabled={saving[acc.id + '_risk']}
                  style={{ width: '100%', height: 36, borderRadius: 10, border: 'none', cursor: 'pointer', background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', color: 'var(--accent)', fontSize: 12, fontWeight: 600 }}>
                  {saving[acc.id + '_risk'] ? 'Saving…' : 'Save'}
                </button>
                {saved[acc.id + '_risk'] && <div style={{ marginTop: 8, fontSize: 11, color: '#22DD88', fontWeight: 600 }}>{saved[acc.id + '_risk']}</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Add Account Modal ─────────────────────────────────────────────── */}
      {addModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 400 }}
          onClick={() => { setAddModal(false); setAddError('') }}>
          <div style={{ background: 'var(--bg)', boxShadow: 'var(--neu-raised)', borderRadius: 20, padding: 28, width: 440, maxWidth: '90%' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>Add Account</div>
              <button onClick={() => { setAddModal(false); setAddError('') }}
                style={{ background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', border: 'none', borderRadius: '50%', width: 28, height: 28, cursor: 'pointer', color: 'var(--text-dim)', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            </div>

            {addStep === 1 && (
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 16 }}>Select your broker</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}>
                  {(['zerodha', 'angelone'] as const).map(b => (
                    <div key={b} onClick={() => setAddForm(f => ({ ...f, broker: b }))}
                      style={{ padding: '20px 16px', borderRadius: 16, cursor: 'pointer', textAlign: 'center', background: 'var(--bg)', boxShadow: addForm.broker === b ? 'var(--neu-inset)' : 'var(--neu-raised-sm)', transition: 'box-shadow 0.15s' }}>
                      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, color: addForm.broker === b ? 'var(--accent)' : 'var(--text)' }}>{b === 'zerodha' ? 'Zerodha' : 'Angel One'}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{b === 'zerodha' ? 'Kite API' : 'SmartAPI'}</div>
                    </div>
                  ))}
                </div>
                <button disabled={!addForm.broker} onClick={() => setAddStep(2)}
                  style={{ width: '100%', height: 40, borderRadius: 12, border: 'none', cursor: addForm.broker ? 'pointer' : 'not-allowed', background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', color: addForm.broker ? 'var(--accent)' : 'var(--text-mute)', fontSize: 13, fontWeight: 700 }}>
                  Continue
                </button>
              </div>
            )}

            {addStep === 2 && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                  <button onClick={() => setAddStep(1)} style={{ background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', border: 'none', borderRadius: 8, padding: '4px 10px', fontSize: 11, cursor: 'pointer', color: 'var(--text-dim)' }}>← Back</button>
                  <span style={{ fontWeight: 700, color: 'var(--accent)', fontSize: 12 }}>{addForm.broker === 'zerodha' ? 'Zerodha' : 'Angel One'}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
                  {[
                    { key: 'nickname', label: 'Nickname', type: 'text', ph: 'e.g. Karthik' },
                    { key: 'client_id', label: 'Client ID', type: 'text', ph: addForm.broker === 'zerodha' ? 'AB1234' : 'A123456' },
                    { key: 'api_key', label: 'API Key', type: 'text', ph: 'API key from console' },
                    { key: 'api_secret', label: addForm.broker === 'zerodha' ? 'API Secret' : 'PIN / Password', type: 'password', ph: '••••••••' },
                    { key: 'totp_secret', label: 'TOTP Secret', type: 'password', ph: 'Base32 TOTP secret' },
                  ].map(({ key, label, type, ph }) => (
                    <div key={key}>
                      <label style={lbl}>{label}</label>
                      <input style={inp} type={type} placeholder={ph} value={(addForm as any)[key]}
                        onChange={e => setAddForm(f => ({ ...f, [key]: e.target.value }))} />
                    </div>
                  ))}
                  <div>
                    <label style={lbl}>Scope</label>
                    <select value={addForm.scope} onChange={e => setAddForm(f => ({ ...f, scope: e.target.value }))}
                      style={{ ...inp, height: 36, appearance: 'none' }}>
                      <option value="fo">F&O (Futures &amp; Options)</option>
                      <option value="mcx">MCX (Commodities)</option>
                    </select>
                  </div>
                </div>
                {addError && <div style={{ fontSize: 12, color: '#FF4444', background: 'var(--bg)', boxShadow: 'var(--neu-inset)', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>{addError}</div>}
                <button disabled={addSaving} onClick={submitAdd}
                  style={{ width: '100%', height: 40, borderRadius: 12, border: 'none', cursor: addSaving ? 'not-allowed' : 'pointer', background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', color: 'var(--accent)', fontSize: 13, fontWeight: 700 }}>
                  {addSaving ? 'Adding…' : 'Add Account'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Edit API Keys Modal ──────────────────────────────────────────── */}
      {editingCreds && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 400 }}
          onClick={() => { setEditingCreds(null); setShowSecret(false); setShowTotp(false) }}>
          <div style={{ background: 'var(--bg)', boxShadow: 'var(--neu-raised)', borderRadius: 20, padding: 28, width: 420, maxWidth: '90%' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, color: 'var(--text)', marginBottom: 4 }}>{editingCreds.nickname}</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-mute)', marginBottom: 20 }}>Client ID: {editingCreds.client_id}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
              <div>
                <label style={lbl}>API Key</label>
                <input style={inp} value={editingCreds.api_key} onChange={e => setEditingCreds({ ...editingCreds, api_key: e.target.value })} />
              </div>
              <div>
                <label style={lbl}>API Secret</label>
                <div style={{ position: 'relative' }}>
                  <input style={{ ...inp, paddingRight: 56 }} type={showSecret ? 'text' : 'password'} value={editingCreds.api_secret} placeholder="Leave blank to keep existing"
                    onChange={e => setEditingCreds({ ...editingCreds, api_secret: e.target.value })} />
                  <button onClick={() => setShowSecret(!showSecret)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 10 }}>{showSecret ? 'Hide' : 'Show'}</button>
                </div>
              </div>
              <div>
                <label style={lbl}>TOTP Secret</label>
                <div style={{ position: 'relative' }}>
                  <input style={{ ...inp, paddingRight: 56 }} type={showTotp ? 'text' : 'password'} value={editingCreds.totp_secret} placeholder="Leave blank to keep existing"
                    onChange={e => setEditingCreds({ ...editingCreds, totp_secret: e.target.value })} />
                  <button onClick={() => setShowTotp(!showTotp)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 10 }}>{showTotp ? 'Hide' : 'Show'}</button>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => { setEditingCreds(null); setShowSecret(false); setShowTotp(false) }}
                style={{ height: 36, padding: '0 16px', borderRadius: 10, border: 'none', cursor: 'pointer', background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', color: 'var(--text-dim)', fontSize: 12 }}>Cancel</button>
              <button onClick={async () => {
                const creds: { api_key?: string; api_secret?: string; totp_secret?: string } = { api_key: editingCreds.api_key }
                if (editingCreds.api_secret) creds.api_secret = editingCreds.api_secret
                if (editingCreds.totp_secret) creds.totp_secret = editingCreds.totp_secret
                await accountsAPI.updateCredentials(editingCreds.id, creds)
                setEditingCreds(null); setShowSecret(false); setShowTotp(false)
              }} style={{ height: 36, padding: '0 20px', borderRadius: 10, border: 'none', cursor: 'pointer', background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', color: 'var(--accent)', fontSize: 12, fontWeight: 700 }}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm Deactivate/Reactivate Modal ─────────────────────────── */}
      {confirmAction && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 400 }}
          onClick={() => setConfirmAction(null)}>
          <div style={{ background: 'var(--bg)', boxShadow: 'var(--neu-raised)', borderRadius: 20, padding: 24, width: 360, maxWidth: '90%' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, color: 'var(--text)', marginBottom: 10 }}>
              {confirmAction.type === 'deactivate' ? 'Deactivate Account' : 'Reactivate Account'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.5 }}>
              {confirmAction.type === 'deactivate'
                ? `Deactivate "${confirmAction.nickname}"? All active algos on this account will stop.`
                : `Reactivate "${confirmAction.nickname}"?`}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmAction(null)}
                style={{ height: 36, padding: '0 16px', borderRadius: 10, border: 'none', cursor: 'pointer', background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', color: 'var(--text-dim)', fontSize: 12 }}>Cancel</button>
              <button onClick={executeConfirmedAction}
                style={{ height: 36, padding: '0 16px', borderRadius: 10, border: 'none', cursor: 'pointer', background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', color: confirmAction.type === 'deactivate' ? '#FF4444' : '#22DD88', fontSize: 12, fontWeight: 700 }}>
                {confirmAction.type === 'deactivate' ? 'Deactivate' : 'Reactivate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
