import { useState, useEffect, useCallback, useRef } from 'react'
import { PencilSimple } from '@phosphor-icons/react'
import { accountsAPI } from '@/services/api'
import { useStore } from '@/store'
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
interface AccountFunds { account_id: string; nickname: string; broker: string; cash: number | null; collateral: number | null; utilised: number | null; net: number | null }

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
  const isProfileOpen     = useStore(s => s.isProfileOpen)
  const setIsProfileOpen  = useStore(s => s.setIsProfileOpen)
  const storeAccounts     = useStore(s => s.accounts)
  const [openPanel, setOpenPanel] = useState<PanelId>('broker')
  const panelRef = useRef<HTMLDivElement>(null)

  // Account data
  const [accounts,     setAccounts]     = useState<AccountLocal[]>([])
  const [editSL,       setEditSL]       = useState<Record<string, string>>({})
  const [editTP,       setEditTP]       = useState<Record<string, string>>({})
  const [saved,        setSaved]        = useState<Record<string, string>>({})
  const [saving,       setSaving]       = useState<Record<string, boolean>>({})
  const [tokenStatus,  setTokenStatus]  = useState<Record<string, boolean>>({})
  const [loginLoading, setLoginLoading] = useState<Record<string, boolean>>({})
  const [editNick,     setEditNick]     = useState<Record<string, string>>({})
  const [nickEditing,  setNickEditing]  = useState<Record<string, boolean>>({})
  const [editingCreds, setEditingCreds] = useState<EditCredsState | null>(null)
  const [showSecret,   setShowSecret]   = useState(false)
  const [showTotp,     setShowTotp]     = useState(false)
  // All-accounts funds panel state
  const [allFunds,        setAllFunds]        = useState<AccountFunds[]>([])
  const [allFundsLoading, setAllFundsLoading] = useState(false)
  const [allFundsUpdated, setAllFundsUpdated] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<{ type: 'deactivate' | 'reactivate'; accountId: string; nickname: string } | null>(null)

  // FY margin data (from new account_fy_margin table)
  const [fyMarginData,  setFYMarginData]  = useState<Record<string, { fy_margin: number|null; fy_brokerage: number|null }>>({})
  const [fyMarginEdits, setFYMarginEdits] = useState<Record<string, { margin?: string; brokerage?: string }>>({})
  const [savingFY,      setSavingFY]      = useState<Record<string, boolean>>({})

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

  const fetchAllFunds = async () => {
    setAllFundsLoading(true)
    try {
      const [fundsRes, fyRes] = await Promise.all([accountsAPI.funds(), accountsAPI.getFYMargin()])
      setAllFunds(fundsRes.data?.funds ?? [])
      // Build FY map keyed by account_id
      const fyMap: Record<string, { fy_margin: number|null; fy_brokerage: number|null }> = {}
      for (const row of (fyRes.data?.data ?? [])) {
        fyMap[row.account_id] = { fy_margin: row.fy_margin ?? null, fy_brokerage: row.fy_brokerage ?? null }
      }
      setFYMarginData(fyMap)
      const now = new Date()
      setAllFundsUpdated(now.toTimeString().slice(0, 8))
    } catch {
      setAllFunds([])
    } finally {
      setAllFundsLoading(false)
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
      } catch {}
    }
    check()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-fetch funds when margin tab is selected
  useEffect(() => {
    if (openPanel === 'margin') fetchAllFunds()
  }, [openPanel]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset to broker tab when panel opens; reset modal when closed
  useEffect(() => {
    if (isProfileOpen) {
      setOpenPanel('broker')
    } else {
      setAddModal(false)
      setAddStep(1)
      setAddForm(EMPTY_FORM)
      setAddError('')
    }
  }, [isProfileOpen])

  // Click outside to close (skip when add-account or edit modal is open — they render outside panelRef)
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (addModal || editingCreds || confirmAction) return
      if (isProfileOpen && panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsProfileOpen(false)
      }
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [isProfileOpen, setIsProfileOpen, addModal, editingCreds, confirmAction])

  // Escape key to close
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsProfileOpen(false) }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [setIsProfileOpen])

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

  const saveFYMarginForAccount = async (accountId: string) => {
    setSavingFY(s => ({ ...s, [accountId]: true }))
    try {
      const edit = fyMarginEdits[accountId] || {}
      const payload: { account_id: string; fy_margin?: number; fy_brokerage?: number } = { account_id: accountId }
      if (edit.margin    !== undefined) payload.fy_margin    = parseFloat(edit.margin)    || 0
      if (edit.brokerage !== undefined) payload.fy_brokerage = parseFloat(edit.brokerage) || 0
      await accountsAPI.saveFYMargin(payload)
      const fyRes = await accountsAPI.getFYMargin()
      const fyMap: Record<string, { fy_margin: number|null; fy_brokerage: number|null }> = {}
      for (const row of (fyRes.data?.data ?? [])) {
        fyMap[row.account_id] = { fy_margin: row.fy_margin ?? null, fy_brokerage: row.fy_brokerage ?? null }
      }
      setFYMarginData(fyMap)
      setFYMarginEdits(e => { const n = { ...e }; delete n[accountId]; return n })
    } catch { }
    setSavingFY(s => ({ ...s, [accountId]: false }))
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

  // ── Account card for Broker panel ────────────────────────────────────────────
  const BrokerCard = ({ acc }: { acc: AccountLocal }) => {
    const connected = tokenStatus[acc.name] ?? false
    const isWife = acc.name === 'Wife'

    return (
      <div style={{ background: 'var(--bg)', boxShadow: 'var(--neu-raised)', borderRadius: 20, padding: 20, marginBottom: 12 }}>
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
                {acc.name} <PencilSimple size={11} color="var(--text-mute)" />
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--accent)' }}>{acc.broker}</span>
              <span style={{ fontSize: 10, color: 'var(--text-mute)' }}>{acc.type}</span>
            </div>
          </div>
          <span style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)', borderRadius: 100, padding: '3px 10px', fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-display)', letterSpacing: '0.5px', color: connected ? '#0ea66e' : isWife ? '#F59E0B' : '#FF4444', flexShrink: 0 }}>
            {connected ? 'Live' : isWife ? 'Phase 2' : 'Offline'}
          </span>
        </div>

        {/* Action row */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {!isWife && (
            <button onClick={() => handleLogin(acc)} disabled={loginLoading[acc.id]}
              style={{ height: 28, padding: '0 12px', borderRadius: 100, fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer', background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', color: connected ? '#0ea66e' : 'var(--accent)' }}>
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
              style={{ height: 28, padding: '0 12px', borderRadius: 100, fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer', background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', color: '#0ea66e' }}>
              Reactivate
            </button>
          )}
        </div>

        {saved[acc.id] && (
          <div style={{ marginTop: 8, fontSize: 11, color: saved[acc.id].startsWith('✅') ? '#0ea66e' : '#F59E0B', fontWeight: 600 }}>{saved[acc.id]}</div>
        )}
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  if (!isProfileOpen) return null

  return (
    <>
      {/* Blur backdrop — sits behind the panel, blurs the rest of the page */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 299, backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', background: 'rgba(0,0,0,0.15)' }} />

      {/* Floating accounts + profile panel */}
      <div ref={panelRef} style={{
        position: 'fixed', top: 88, right: 20, width: 420, zIndex: 322,
        background: 'var(--bg)', boxShadow: 'var(--neu-raised-lg)', borderRadius: 20,
        display: 'flex', flexDirection: 'column',
        maxHeight: 'calc(100vh - 108px)',
      }}>

        {/* ── Header: user identity ── */}
        <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: 'var(--accent)', flexShrink: 0 }}>
              BK
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>Karthikeyan</div>
              <div style={{ fontSize: 10, color: 'var(--text-mute)', marginTop: 2 }}>LIFEX OS · STAAX</div>
            </div>
            <button onClick={() => setIsProfileOpen(false)}
              style={{ background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', border: 'none', borderRadius: '50%', width: 28, height: 28, cursor: 'pointer', color: 'var(--text-dim)', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              ✕
            </button>
          </div>
        </div>

        {/* ── Tab row ── */}
        <div style={{ display: 'flex', gap: 6, padding: '12px 20px 0', flexShrink: 0 }}>
          {TABS.map(tab => (
            <button key={tab.id} onClick={() => setOpenPanel(tab.id)} style={{
              flex: 1, height: 32, borderRadius: 100, border: 'none', cursor: 'pointer',
              background: 'var(--bg)',
              boxShadow: openPanel === tab.id ? 'var(--neu-inset)' : 'var(--neu-raised-sm)',
              color: openPanel === tab.id ? 'var(--accent)' : 'var(--text-dim)',
              fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-display)',
              letterSpacing: '0.5px', textTransform: 'uppercase' as const,
              transition: 'all 0.15s',
            }}>{tab.label}</button>
          ))}
        </div>

        {/* ── Panel content (scrollable) ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 20px' }}>

          {/* ── Panel 1: Broker ─── */}
          {openPanel === 'broker' && (
            <div>
              {accounts.length === 0 && (
                <div style={{ fontSize: 13, color: 'var(--text-mute)', textAlign: 'center', padding: '32px 0' }}>No accounts found</div>
              )}
              {accounts.map(acc => <BrokerCard key={acc.id} acc={acc} />)}
              <button onClick={() => { setAddModal(true); setAddStep(1); setAddForm(EMPTY_FORM); setAddError('') }}
                style={{ width: '100%', height: 36, borderRadius: 12, border: 'none', cursor: 'pointer', background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', color: 'var(--accent)', fontSize: 12, fontWeight: 700, marginTop: 4 }}>
                + Add Account
              </button>
              {addToast && <div style={{ marginTop: 10, fontSize: 12, color: '#0ea66e', fontWeight: 600, textAlign: 'center' }}>{addToast}</div>}
            </div>
          )}

          {/* ── Panel 2: Margin / Funds ─── */}
          {openPanel === 'margin' && (() => {
            const fmt = (v: number | null) => v === null ? '—' : `₹${Math.abs(v).toLocaleString('en-IN')}`
            const today = new Date()
            const fyYear = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1
            const fyLabel = `FY ${fyYear}-${String(fyYear + 1).slice(2)}`
            const totalFYMargin = Object.values(fyMarginData).reduce((s, r) => s + (r.fy_margin ?? 0), 0)
            const totalFYBrok   = Object.values(fyMarginData).reduce((s, r) => s + (r.fy_brokerage ?? 0), 0)
            return (
              <div>
                {/* ── Section 1 header ── */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Live Funds</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {allFundsUpdated && <span style={{ fontSize: 9, color: 'var(--text-mute)', fontFamily: 'var(--font-mono)' }}>{allFundsUpdated}</span>}
                    <button onClick={fetchAllFunds} disabled={allFundsLoading}
                      style={{ height: 26, padding: '0 10px', borderRadius: 100, fontSize: 10, fontWeight: 700, border: 'none', cursor: allFundsLoading ? 'default' : 'pointer', background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', color: 'var(--accent)', fontFamily: 'var(--font-display)' }}
                      onMouseDown={e => { e.currentTarget.style.boxShadow = 'var(--neu-inset)' }}
                      onMouseUp={e => { e.currentTarget.style.boxShadow = 'var(--neu-raised-sm)' }}
                      onMouseLeave={e => { e.currentTarget.style.boxShadow = 'var(--neu-raised-sm)' }}>
                      {allFundsLoading ? '…' : 'Refresh'}
                    </button>
                  </div>
                </div>

                {/* Loading / empty states */}
                {allFundsLoading && allFunds.length === 0 && (
                  <div style={{ fontSize: 12, color: 'var(--text-mute)', textAlign: 'center', padding: '24px 0' }}>Loading funds…</div>
                )}
                {!allFundsLoading && allFunds.length === 0 && (
                  <div style={{ fontSize: 12, color: 'var(--text-mute)', textAlign: 'center', padding: '24px 0' }}>No funds data — accounts may be offline</div>
                )}

                {/* ── Per-account cards ── */}
                {allFunds.map(f => {
                  const netColor = f.net === null ? 'var(--text-dim)' : f.net >= 0 ? '#0ea66e' : '#FF4444'
                  const fyRow    = fyMarginData[f.account_id] || { fy_margin: null, fy_brokerage: null }
                  const fyEdit   = fyMarginEdits[f.account_id] || {}
                  return (
                    <div key={f.account_id} style={{ background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', borderRadius: 16, padding: 16, marginBottom: 12 }}>
                      {/* Card header */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                        <div>
                          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>{f.nickname}</span>
                          <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--text-mute)', background: 'var(--bg)', boxShadow: 'var(--neu-inset)', borderRadius: 100, padding: '2px 7px', marginLeft: 6 }}>
                            {f.broker === 'zerodha' ? 'Zerodha' : 'Angel One'}
                          </span>
                        </div>
                      </div>

                      {/* Funds grid */}
                      <div style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)', borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {([
                          { label: 'Cash',      value: f.cash,      color: '#0ea66e' },
                          { label: 'Collateral',value: f.collateral, color: '#4488FF' },
                          { label: 'Utilised',  value: f.utilised,  color: '#F59E0B' },
                        ] as const).map(row => (
                          <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{row.label}</span>
                            <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)', color: row.color }}>{fmt(row.value)}</span>
                          </div>
                        ))}
                        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Net Available</span>
                          <span style={{ fontSize: 13, fontWeight: 800, fontFamily: 'var(--font-mono)', color: netColor }}>
                            {f.net !== null && f.net < 0 ? '-' : ''}{fmt(f.net)}
                          </span>
                        </div>
                      </div>

                      {/* FY Margin & Brokerage */}
                      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>{fyLabel} Settings</div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                          <div style={{ flex: 1 }}>
                            <label style={lbl}>FY Margin (₹)</label>
                            <input style={inp} type="number" placeholder="₹ Margin"
                              value={fyEdit.margin !== undefined ? fyEdit.margin : (fyRow.fy_margin ?? '')}
                              onChange={e => setFYMarginEdits(ed => ({ ...ed, [f.account_id]: { ...fyEdit, margin: e.target.value } }))} />
                          </div>
                          <div style={{ flex: 1 }}>
                            <label style={lbl}>FY Brokerage (₹)</label>
                            <input style={inp} type="number" placeholder="₹ Brokerage"
                              value={fyEdit.brokerage !== undefined ? fyEdit.brokerage : (fyRow.fy_brokerage ?? '')}
                              onChange={e => setFYMarginEdits(ed => ({ ...ed, [f.account_id]: { ...fyEdit, brokerage: e.target.value } }))} />
                          </div>
                          <button onClick={() => saveFYMarginForAccount(f.account_id)} disabled={savingFY[f.account_id]}
                            style={{ height: 32, padding: '0 14px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', color: '#0ea66e', fontSize: 11, fontWeight: 700, flexShrink: 0, fontFamily: 'var(--font-display)', transition: 'box-shadow 0.15s' }}
                            onMouseDown={e => { e.currentTarget.style.boxShadow = 'var(--neu-inset)' }}
                            onMouseUp={e => { e.currentTarget.style.boxShadow = 'var(--neu-raised-sm)' }}
                            onMouseLeave={e => { e.currentTarget.style.boxShadow = 'var(--neu-raised-sm)' }}>
                            {savingFY[f.account_id] ? '…' : 'Save'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}

                {/* ── Section 2: FY Totals ── */}
                {Object.keys(fyMarginData).length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>{fyLabel} Totals</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      {[
                        { label: 'Total FY Margin',    value: totalFYMargin },
                        { label: 'Total FY Brokerage', value: totalFYBrok   },
                      ].map(card => (
                        <div key={card.label} style={{ background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', borderRadius: 12, padding: '12px 14px' }}>
                          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{card.label}</div>
                          <div style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                            {card.value >= 100000
                              ? `₹${(card.value / 100000).toFixed(1)}L`
                              : `₹${Math.round(card.value).toLocaleString('en-IN')}`}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })()}

          {/* ── Panel 3: Risk ─── */}
          {openPanel === 'risk' && (
            <div>
              {accounts.filter(a => a.status === 'active').map(acc => (
                <div key={acc.id} style={{ background: 'var(--bg)', boxShadow: 'var(--neu-raised)', borderRadius: 20, padding: 20, marginBottom: 12 }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, color: 'var(--text)', marginBottom: 14 }}>
                    {acc.name} <span style={{ fontSize: 10, color: 'var(--text-mute)', fontWeight: 400 }}>· {acc.broker}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <label style={lbl}>Global SL (₹)</label>
                      <input style={inp} type="number" defaultValue={acc.globalSL ?? ''} placeholder="₹ SL"
                        onChange={e => setEditSL(s => ({ ...s, [acc.id]: e.target.value }))} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={lbl}>Global TP (₹)</label>
                      <input style={inp} type="number" defaultValue={acc.globalTP ?? ''} placeholder="₹ TP"
                        onChange={e => setEditTP(s => ({ ...s, [acc.id]: e.target.value }))} />
                    </div>
                    <button onClick={() => saveRisk(acc)} disabled={saving[acc.id + '_risk']}
                      style={{ height: 32, padding: '0 16px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', color: '#0ea66e', fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-display)', whiteSpace: 'nowrap', flexShrink: 0 }}
                      onMouseDown={e => { e.currentTarget.style.boxShadow = 'var(--neu-inset)' }}
                      onMouseUp={e => { e.currentTarget.style.boxShadow = 'var(--neu-raised-sm)' }}
                      onMouseLeave={e => { e.currentTarget.style.boxShadow = 'var(--neu-raised-sm)' }}>
                      {saving[acc.id + '_risk'] ? '…' : 'Save'}
                    </button>
                  </div>
                  {saved[acc.id + '_risk'] && <div style={{ marginTop: 8, fontSize: 11, color: '#0ea66e', fontWeight: 600 }}>{saved[acc.id + '_risk']}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Add Account Modal ─────────────────────────────────────────────── */}
      {addModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 400 }}
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
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {(['zerodha', 'angelone'] as const).map(b => (
                    <div key={b} onClick={() => { setAddForm(f => ({ ...f, broker: b })); setAddStep(2) }}
                      style={{ padding: '20px 16px', borderRadius: 16, cursor: 'pointer', textAlign: 'center', background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', transition: 'box-shadow 0.15s' }}
                      onMouseDown={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = 'var(--neu-inset)' }}
                      onMouseUp={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = 'var(--neu-raised-sm)' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = 'var(--neu-raised-sm)' }}>
                      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, color: 'var(--text)' }}>{b === 'zerodha' ? 'Zerodha' : 'Angel One'}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{b === 'zerodha' ? 'Kite API' : 'SmartAPI'}</div>
                    </div>
                  ))}
                </div>
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
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 400 }}
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
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 400 }}
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
                style={{ height: 36, padding: '0 16px', borderRadius: 10, border: 'none', cursor: 'pointer', background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', color: confirmAction.type === 'deactivate' ? '#FF4444' : '#0ea66e', fontSize: 12, fontWeight: 700 }}>
                {confirmAction.type === 'deactivate' ? 'Deactivate' : 'Reactivate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
