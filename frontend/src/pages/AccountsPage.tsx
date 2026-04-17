import { useState, useEffect } from 'react'
import { accountsAPI } from '@/services/api'
import { useStore } from '@/store'
import { getCurrentFY } from '@/utils/fy'

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


// True only in April — brokerage is editable once per FY
function isApril(): boolean {
  return new Date().getMonth() === 3
}

interface AddAccountForm {
  broker: 'zerodha' | 'angelone' | ''
  nickname: string
  client_id: string
  api_key: string
  api_secret: string   // Zerodha: API secret | Angel One: PIN / Password
  totp_secret: string
  scope: string
}

const EMPTY_FORM: AddAccountForm = { broker: '', nickname: '', client_id: '', api_key: '', api_secret: '', totp_secret: '', scope: 'fo' }

export default function AccountsPage() {
  const storeAccounts = useStore(s => s.accounts)
  const [accounts, setAccounts] = useState<AccountLocal[]>([])
  const [editMargin, setEditMargin] = useState<Record<string, string>>({})
  const [editSL,     setEditSL]     = useState<Record<string, string>>({})
  const [editTP,     setEditTP]     = useState<Record<string, string>>({})
  const [editBrok,   setEditBrok]   = useState<Record<string, string>>({})
  const [saved,      setSaved]      = useState<Record<string, string>>({})
  const [saving,     setSaving]     = useState<Record<string, boolean>>({})
  const [tokenStatus, setTokenStatus] = useState<Record<string, boolean>>({})
  const [editNick,    setEditNick]    = useState<Record<string, string>>({})
  const [nickEditing, setNickEditing] = useState<Record<string, boolean>>({})
  const [editingCreds, setEditingCreds] = useState<EditCredsState | null>(null)
  const [showSecret,   setShowSecret]   = useState(false)
  const [showTotp,     setShowTotp]     = useState(false)
  const [fundsData,    setFundsData]    = useState<Record<string, { available: number; used: number; total: number; unrealized_pnl: number; realized_pnl: number } | null>>({})
  const [fundsLoading, setFundsLoading] = useState<Record<string, boolean>>({})

  // Add Account modal
  const [addModal,   setAddModal]   = useState(false)
  const [addStep,    setAddStep]    = useState<1|2>(1)
  const [addForm,    setAddForm]    = useState<AddAccountForm>(EMPTY_FORM)
  const [addSaving,  setAddSaving]  = useState(false)
  const [addError,   setAddError]   = useState('')
  const [addToast,   setAddToast]   = useState('')

  const [confirmAction, setConfirmAction] = useState<{ type: 'deactivate' | 'reactivate'; accountId: string; nickname: string } | null>(null)

  const openAddModal = () => { setAddModal(true); setAddStep(1); setAddForm(EMPTY_FORM); setAddError('') }
  const closeAddModal = () => { setAddModal(false); setAddError('') }
  const patchForm = (p: Partial<AddAccountForm>) => setAddForm(f => ({ ...f, ...p }))

  const handleDeactivate = (accountId: string) => {
    const acc = accounts.find(a => a.id === accountId)
    if (acc) setConfirmAction({ type: 'deactivate', accountId, nickname: acc.name })
  }

  const handleReactivate = (accountId: string) => {
    const acc = accounts.find(a => a.id === accountId)
    if (acc) setConfirmAction({ type: 'reactivate', accountId, nickname: acc.name })
  }

  const executeConfirmedAction = async () => {
    if (!confirmAction) return
    try {
      await fetch(`/api/v1/accounts/${confirmAction.accountId}/${confirmAction.type}`, { method: 'PATCH' })
      setConfirmAction(null)
      fetchAccounts()
    } catch (err) {
      console.error('Action failed:', err)
    }
  }

  const submitAdd = async () => {
    if (!addForm.nickname.trim() || !addForm.client_id.trim()) { setAddError('Nickname and Client ID are required'); return }
    setAddSaving(true); setAddError('')
    try {
      await accountsAPI.create({
        broker:      addForm.broker,
        nickname:    addForm.nickname.trim(),
        client_id:   addForm.client_id.trim(),
        api_key:     addForm.api_key.trim() || undefined,
        api_secret:  addForm.api_secret.trim() || undefined,
        totp_secret: addForm.totp_secret.trim() || undefined,
        scope:       addForm.scope || 'fo',
      })
      closeAddModal()
      accountsAPI.list().then(res => {
        const data: any[] = res.data || []
        if (data.length > 0) setAccounts(data.map((api: any) => ({
          id: api.id, name: api.nickname,
          broker: api.broker === 'zerodha' ? 'Zerodha' : 'Angel One',
          status: api.status === 'active' ? 'active' : 'pending',
          globalSL: api.global_sl ?? null, globalTP: api.global_tp ?? null,
          fyBrokerage: api.fy_brokerage ?? null,
          margin: api.fy_margin ?? 0, pnl: 0, token: '', color: '',
          type: api.broker === 'angelone' && api.nickname === 'Wife' ? 'MCX' : 'F&O',
          client_id: api.client_id ?? '', api_key: api.api_key ?? '',
          scope: api.scope ?? 'fo', is_active: api.is_active ?? true,
        })))
      }).catch(() => {})
      setAddToast('✅ Account added')
      setTimeout(() => setAddToast(''), 3000)
    } catch (e: any) {
      setAddError(e?.response?.data?.detail || 'Failed to add account')
    } finally {
      setAddSaving(false)
    }
  }

  // Load accounts directly from API on mount
  useEffect(() => {
    accountsAPI.list()
      .then(res => {
        const data: any[] = res.data || []
        if (data.length > 0) {
          setAccounts(data.map((api: any) => ({
            id:          api.id,
            name:        api.nickname,
            broker:      api.broker === 'zerodha' ? 'Zerodha' : 'Angel One',
            status:      api.status === 'active' ? 'active' : 'pending',
            globalSL:    api.global_sl ?? null,
            globalTP:    api.global_tp ?? null,
            fyBrokerage: api.fy_brokerage ?? null,
            margin:      api.fy_margin ?? 0,
            pnl:         0,
            token:       '',
            color:       '',
            type:        api.broker === 'angelone' && api.nickname === 'Wife' ? 'MCX' : 'F&O',
            client_id:   api.client_id ?? '',
            api_key:     api.api_key ?? '',
            scope:       api.scope ?? 'fo',
            is_active:   api.is_active ?? true,
          })))
        }
      })
      .catch(() => {})
  }, [])

  const fetchAccounts = () => {
    accountsAPI.list()
      .then(res => {
        const data: any[] = res.data || []
        if (data.length > 0) setAccounts(data.map((api: any) => ({
          id: api.id, name: api.nickname,
          broker: api.broker === 'zerodha' ? 'Zerodha' : 'Angel One',
          status: api.status === 'active' ? 'active' : 'pending',
          globalSL: api.global_sl ?? null, globalTP: api.global_tp ?? null,
          fyBrokerage: api.fy_brokerage ?? null,
          margin: api.fy_margin ?? 0, pnl: 0, token: '', color: '',
          type: api.broker === 'angelone' && api.nickname === 'Wife' ? 'MCX' : 'F&O',
          client_id: api.client_id ?? '', api_key: api.api_key ?? '',
          scope: api.scope ?? 'fo', is_active: api.is_active ?? true,
        })))
      })
      .catch(() => {})
  }

  // Map account display name → angel one slug
  const NAME_TO_SLUG: Record<string, string> = { 'Mom': 'mom', 'Wife': 'wife', 'Karthik AO': 'karthik' }

  const fetchFunds = async (accName: string, refresh = false) => {
    const slug = NAME_TO_SLUG[accName]
    if (!slug) return
    setFundsLoading(prev => ({ ...prev, [accName]: true }))
    try {
      const res = await accountsAPI.angeloneFunds(slug, refresh)
      setFundsData(prev => ({ ...prev, [accName]: res.data }))
    } catch {
      setFundsData(prev => ({ ...prev, [accName]: null }))
    } finally {
      setFundsLoading(prev => ({ ...prev, [accName]: false }))
    }
  }

  // Check token status for all accounts on mount
  useEffect(() => {
    const checkTokens = async () => {
      try {
        const zStatus   = await accountsAPI.zerodhaTokenStatus()
        const momStatus = await accountsAPI.angeloneTokenStatus('mom')
        const wifeStatus= await accountsAPI.angeloneTokenStatus('wife')
        const kaoStatus = await accountsAPI.angeloneTokenStatus('karthik')
        const status = {
          'Karthik':    zStatus.data?.connected   ?? false,
          'Mom':        momStatus.data?.connected  ?? false,
          'Wife':       wifeStatus.data?.connected ?? false,
          'Karthik AO': kaoStatus.data?.connected  ?? false,
        }
        setTokenStatus(status)
        // Auto-fetch funds for connected Angel One accounts
        for (const [name, connected] of Object.entries(status)) {
          if (connected && NAME_TO_SLUG[name]) fetchFunds(name)
        }
      } catch {}
    }
    checkTokens()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync from store when it changes
  useEffect(() => {
    if (storeAccounts.length > 0) {
      setAccounts(storeAccounts.map((api: any) => ({
        id:          api.id,
        name:        api.nickname,
        broker:      api.broker === 'zerodha' ? 'Zerodha' : 'Angel One',
        status:      api.status === 'active' ? 'active' : 'pending',
        globalSL:    api.global_sl ?? null,
        globalTP:    api.global_tp ?? null,
        fyBrokerage: api.fy_brokerage ?? null,
        margin:      api.fy_margin ?? 0,
        pnl:         0,
        token:       '',
        color:       '',
        type:        api.broker === 'angelone' && api.nickname === 'Wife' ? 'MCX' : 'F&O',
        client_id:   api.client_id ?? '',
        api_key:     api.api_key ?? '',
        scope:       api.scope ?? 'fo',
        is_active:   api.is_active ?? true,
      })))
    }
  }, [storeAccounts])

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
    } catch {
      showSaved(acc.id, '⚠️ Nickname save failed')
    }
    setNickEditing(n => ({ ...n, [acc.id]: false }))
  }

  // Single save: margin + SL/TP + brokerage in one click
  const saveAll = async (acc: AccountLocal) => {
    const marginVal = parseFloat(editMargin[acc.id] || String(acc.margin))
    const sl  = parseFloat(editSL[acc.id]   || String(acc.globalSL   ?? ''))
    const tp  = parseFloat(editTP[acc.id]   || String(acc.globalTP   ?? ''))
    const brok = parseFloat(editBrok[acc.id] || String(acc.fyBrokerage ?? 0))

    setSaving(s => ({ ...s, [acc.id]: true }))
    try {
      const calls: Promise<any>[] = []

      if (!isNaN(marginVal) && marginVal > 0) {
        calls.push(accountsAPI.updateMargin(acc.id, {
          financial_year: getCurrentFY(),
          margin_amount:  marginVal,
        }))
      }

      const riskPayload: Record<string, number> = {}
      if (!isNaN(sl)) riskPayload.global_sl = sl
      if (!isNaN(tp)) riskPayload.global_tp = tp
      if (isApril() && !isNaN(brok)) riskPayload.fy_brokerage = brok
      if (Object.keys(riskPayload).length > 0) {
        calls.push(accountsAPI.updateGlobalRisk(acc.id, riskPayload))
      }

      await Promise.all(calls)
      setAccounts(a => a.map(x => x.id === acc.id ? {
        ...x,
        margin:      !isNaN(marginVal) ? marginVal : x.margin,
        globalSL:    !isNaN(sl)   ? sl   : x.globalSL,
        globalTP:    !isNaN(tp)   ? tp   : x.globalTP,
        fyBrokerage: isApril() && !isNaN(brok) ? brok : x.fyBrokerage,
      } : x))
      showSaved(acc.id, '✅ Saved')
    } catch {
      showSaved(acc.id, '⚠️ Save failed')
    } finally {
      setSaving(s => ({ ...s, [acc.id]: false }))
    }
  }


  return (
    <div>
      {/* A1 — Page header h1: orange Syne 800 */}
      <div className="page-header">
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '22px', fontWeight: 800, color: 'var(--ox-radiant)' }}>Accounts</h1>
          <p style={{ fontSize: '12px', color: 'var(--gs-muted)', marginTop: '3px' }}>Broker accounts & API tokens</p>
        </div>
        <div className="page-header-actions">
          {addToast && <span style={{ fontSize: '12px', color: 'var(--green)', fontWeight: 600 }}>{addToast}</span>}
          <button className="btn btn-ghost" style={{ fontSize: '12px' }} onClick={openAddModal}>
            + Add Account
          </button>
        </div>
      </div>

      {/* A2 — Summary row: FY Margin | FY Brokerage | FY P&L */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '12px', marginBottom: '12px' }}>
        <div className="card card-stat cloud-fill" style={{ '--stat-rgb': '255,107,0' } as React.CSSProperties}>
          <div style={{ fontSize: '10px', color: 'rgba(232,232,248,0.5)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px', fontWeight: 600, fontFamily: 'var(--font-display)' }}>FY Margin</div>
          <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#F0F0FF', lineHeight: 1 }}>
            ₹{(accounts.reduce((s: number, a: AccountLocal) => s + (a.margin || 0), 0) / 100000).toFixed(1)}L
          </div>
        </div>
        <div className="card card-stat cloud-fill" style={{ '--stat-rgb': '255,107,0' } as React.CSSProperties}>
          <div style={{ fontSize: '10px', color: 'rgba(232,232,248,0.5)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px', fontWeight: 600, fontFamily: 'var(--font-display)' }}>FY Brokerage</div>
          <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#F0F0FF', lineHeight: 1 }}>
            ₹{(accounts.reduce((s: number, a: AccountLocal) => s + (a.fyBrokerage || 0), 0)).toLocaleString('en-IN')}
          </div>
        </div>
        <div className="card card-stat cloud-fill" style={{ '--stat-rgb': '255,107,0' } as React.CSSProperties}>
          <div style={{ fontSize: '10px', color: 'rgba(232,232,248,0.5)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px', fontWeight: 600, fontFamily: 'var(--font-display)' }}>FY P&L</div>
          <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#F0F0FF', lineHeight: 1 }}>
            ₹{(accounts.reduce((s: number, a: AccountLocal) => s + (a.pnl || 0), 0)).toLocaleString('en-IN')}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '12px' }}>
        {accounts.map(acc => {
          const isWife = acc.name === 'Wife'           // Phase 2 — no login yet
          const tokenConnected = tokenStatus[acc.name] ?? false

          return (
            // A7 — cloud-fill on all account cards; A5 — removed borderTop
            <div key={acc.id} className="cloud-fill" style={{
              background: 'var(--glass-bg)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: '0.5px solid rgba(255,107,0,0.22)',
              borderRadius: 'var(--radius-lg)', padding: '16px',
            }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                <div>
                  {nickEditing[acc.id] ? (
                    <input
                      className="staax-input"
                      autoFocus
                      defaultValue={acc.name}
                      style={{ fontSize: '14px', fontWeight: 700, width: '130px', padding: '2px 6px' }}
                      onChange={e => setEditNick(n => ({ ...n, [acc.id]: e.target.value }))}
                      onBlur={() => saveNickname(acc)}
                      onKeyDown={e => { if (e.key === 'Enter') saveNickname(acc); if (e.key === 'Escape') setNickEditing(n => ({ ...n, [acc.id]: false })) }}
                    />
                  ) : (
                    // A6 — Account nickname: Syne 600, #F0F0FF
                    <div
                      style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '16px', color: '#F0F0FF', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
                      title="Click to rename"
                      onClick={() => setNickEditing(n => ({ ...n, [acc.id]: true }))}
                    >
                      {acc.name}
                      <span style={{ fontSize: '10px', color: 'var(--text-dim)', fontWeight: 400 }}>✎</span>
                    </div>
                  )}
                  {/* A6 — Broker chip: orange pill */}
                  <div style={{ marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ background: 'rgba(255,107,0,0.12)', color: '#FF6B00', borderRadius: '4px', padding: '2px 8px', fontSize: '11px', fontWeight: 600 }}>
                      {acc.broker}
                    </span>
                    <span style={{ fontSize: '11px', color: 'rgba(232,232,248,0.4)' }}>{acc.type}</span>
                  </div>
                </div>
                {/* A6 — Status Active: #22DD88 */}
                <span style={{
                  fontSize: '11px', padding: '3px 8px', borderRadius: '100px', fontWeight: 600,
                  color: acc.status === 'active' ? '#22DD88' : 'var(--amber)',
                  background: acc.status === 'active' ? 'rgba(34,221,136,0.12)' : 'rgba(245,158,11,0.12)',
                }}>
                  {acc.status.toUpperCase()}
                </span>
              </div>

              {/* Stats — A6 Delta B: mono font on numbers, uppercase labels */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div style={{ background: 'var(--bg-secondary)', borderRadius: '6px', padding: '10px' }}>
                  <div style={{ fontSize: '10px', color: 'rgba(232,232,248,0.5)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: 'var(--font-display)' }}>FY Margin</div>
                  <div style={{ fontWeight: 600, fontSize: '14px', fontFamily: 'var(--font-mono)', color: '#F0F0FF' }}>₹{(acc.margin / 100000).toFixed(1)}L</div>
                </div>
                <div style={{ background: 'var(--bg-secondary)', borderRadius: '6px', padding: '10px' }}>
                  <div style={{ fontSize: '10px', color: 'rgba(232,232,248,0.5)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: 'var(--font-display)' }}>FY P&L</div>
                  <div style={{ fontWeight: 600, fontSize: '14px', fontFamily: 'var(--font-mono)', color: acc.pnl >= 0 ? '#22DD88' : 'var(--red)' }}>
                    {acc.pnl >= 0 ? '+' : ''}₹{Math.abs(acc.pnl).toLocaleString('en-IN')}
                  </div>
                </div>
              </div>

              {/* Token status — A4: removed login buttons */}
              <div style={{
                fontSize: '11px', color: 'var(--text-muted)', marginBottom: '12px',
                padding: '8px 10px', background: 'var(--bg-secondary)', borderRadius: '5px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <span>
                  API Token:&nbsp;
                  <span style={{ fontWeight: 600, color: tokenConnected ? '#22DD88' : isWife ? 'var(--accent-amber)' : 'var(--red)' }}>
                    {tokenConnected ? 'Connected' : isWife ? 'Phase 2' : 'Login required'}
                  </span>
                </span>
              </div>

              {/* Funds strip — live margin + P&L from broker */}
              {NAME_TO_SLUG[acc.name] && (
                <div style={{ marginBottom: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <div style={{ fontSize: '10px', fontWeight: 700, color: 'rgba(232,232,248,0.4)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Live Funds</div>
                    <button
                      onClick={() => fetchFunds(acc.name, true)}
                      disabled={fundsLoading[acc.name]}
                      style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: '10px', padding: 0 }}
                    >{fundsLoading[acc.name] ? '…' : '↻'}</button>
                  </div>
                  {!tokenConnected ? (
                    <div style={{ fontSize: '10px', color: 'rgba(232,232,248,0.25)', padding: '6px 0' }}>Login to see funds</div>
                  ) : fundsLoading[acc.name] && !fundsData[acc.name] ? (
                    <div style={{ fontSize: '10px', color: 'rgba(232,232,248,0.35)', padding: '6px 0' }}>Loading…</div>
                  ) : fundsData[acc.name] ? (() => {
                    const f = fundsData[acc.name]!
                    const metrics = [
                      { label: 'Cash',     value: `₹${(f.available / 100000).toFixed(1)}L`, color: '#F0F0FF' },
                      { label: 'Used',     value: `₹${(f.used / 100000).toFixed(1)}L`,      color: 'rgba(232,232,248,0.6)' },
                      { label: 'Total',    value: `₹${(f.total / 100000).toFixed(1)}L`,     color: '#F0F0FF' },
                      { label: 'Unreal.',  value: `${f.unrealized_pnl >= 0 ? '+' : ''}₹${Math.abs(f.unrealized_pnl).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`, color: f.unrealized_pnl >= 0 ? '#22DD88' : '#FF4444' },
                    ]
                    return (
                      <div style={{ display: 'flex', gap: '6px' }}>
                        {metrics.map(m => (
                          <div key={m.label} style={{ flex: 1, background: 'var(--bg-secondary)', borderRadius: '5px', padding: '6px 4px', textAlign: 'center' }}>
                            <div style={{ fontSize: '9px', color: 'rgba(232,232,248,0.4)', marginBottom: '2px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{m.label}</div>
                            <div style={{ fontSize: '11px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: m.color }}>{m.value}</div>
                          </div>
                        ))}
                      </div>
                    )
                  })() : null}
                </div>
              )}

              {/* Edit API Keys button + Deactivate/Reactivate */}
              <div style={{ marginBottom: '10px', display: 'flex', gap: 8, alignItems: 'center' }}>
                <button onClick={() => setEditingCreds({
                  id: acc.id,
                  nickname: acc.name,
                  client_id: acc.client_id || '',
                  api_key: acc.api_key || '',
                  api_secret: '',
                  totp_secret: ''
                })} style={{
                  padding: '4px 10px', borderRadius: 8, fontSize: 10, fontFamily: 'Syne',
                  background: 'transparent', border: '0.5px solid rgba(255,255,255,0.15)',
                  color: 'rgba(232,232,248,0.5)', cursor: 'pointer'
                }}>Edit API Keys</button>
                {acc.is_active !== false ? (
                  <button
                    onClick={() => handleDeactivate(acc.id)}
                    style={{ padding: '4px 10px', background: 'rgba(255,50,50,0.15)', color: '#ff6b6b', border: '1px solid rgba(255,100,100,0.3)', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}
                  >
                    Deactivate
                  </button>
                ) : (
                  <button
                    onClick={() => handleReactivate(acc.id)}
                    style={{ padding: '4px 10px', background: 'rgba(50,255,100,0.15)', color: '#6bff8b', border: '1px solid rgba(100,255,100,0.3)', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}
                  >
                    Reactivate
                  </button>
                )}
              </div>

              {/* Edit controls — active accounts only */}
              {acc.status === 'active' && <>
                {/* A3 — FY Margin + FY Brokerage side by side */}
                <div style={{ marginBottom: '10px' }}>
                  <div style={{ fontSize: '10px', color: 'rgba(232,232,248,0.5)', marginBottom: '5px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: 'var(--font-display)' }}>
                    FY Margin / Brokerage
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                    <input className="staax-input" type="number" defaultValue={acc.margin || ''}
                      placeholder="₹ Margin"
                      onChange={e => setEditMargin(m => ({ ...m, [acc.id]: e.target.value }))}
                      style={{ width: '100%', fontSize: '12px', fontFamily: 'var(--font-mono)' }} />
                    <input className="staax-input" type="number" placeholder="₹ Brokerage"
                      defaultValue={acc.fyBrokerage ?? ''}
                      disabled={!isApril()}
                      onChange={e => setEditBrok(m => ({ ...m, [acc.id]: e.target.value }))}
                      style={{ width: '100%', fontSize: '12px', fontFamily: 'var(--font-mono)', opacity: isApril() ? 1 : 0.5 }} />
                  </div>
                  {!isApril() && <div style={{ fontSize: '10px', color: 'rgba(232,232,248,0.3)', marginTop: '3px' }}>Brokerage editable in April</div>}
                </div>

                {/* Global SL / TP */}
                <div style={{ marginBottom: '10px' }}>
                  <div style={{ fontSize: '10px', color: 'rgba(232,232,248,0.5)', marginBottom: '5px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: 'var(--font-display)' }}>
                    Global SL / TP
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                    <input className="staax-input" type="number" placeholder="SL ₹" defaultValue={acc.globalSL ?? ''}
                      onChange={e => setEditSL(s => ({ ...s, [acc.id]: e.target.value }))}
                      style={{ fontSize: '12px', fontFamily: 'var(--font-mono)' }} />
                    <input className="staax-input" type="number" placeholder="TP ₹" defaultValue={acc.globalTP ?? ''}
                      onChange={e => setEditTP(s => ({ ...s, [acc.id]: e.target.value }))}
                      style={{ fontSize: '12px', fontFamily: 'var(--font-mono)' }} />
                  </div>
                </div>

                {/* Single Save button */}
                <button className="btn btn-ghost" style={{ width: '100%', fontSize: '11px' }}
                  disabled={saving[acc.id]}
                  onClick={() => saveAll(acc)}>
                  {saving[acc.id] ? 'Saving...' : 'Save'}
                </button>
              </>}

              {/* Save feedback */}
              {saved[acc.id] && (
                <div style={{
                  fontSize: '12px', color: saved[acc.id].startsWith('✅') ? '#22DD88' : 'var(--accent-amber)',
                  fontWeight: 600, padding: '6px 10px',
                  background: saved[acc.id].startsWith('✅') ? 'rgba(34,221,136,0.1)' : 'rgba(245,158,11,0.1)',
                  borderRadius: '5px', textAlign: 'center', marginTop: '8px',
                  fontFamily: 'var(--font-mono)',
                }}>
                  {saved[acc.id]}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Add Account Modal */}
      {addModal && (
        <div className="modal-overlay" onClick={closeAddModal}>
          <div className="modal-box" style={{ maxWidth: '480px', width: '90%' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
              <div style={{ fontWeight: 700, fontSize: '16px' }}>Add Account</div>
              {/* A10 — Close button red on hover */}
              <button
                onClick={closeAddModal}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', fontSize: '18px' }}
                onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.color = '#FF4444'}
                onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.4)'}
              >✕</button>
            </div>

            {/* Step 1 — Broker selection */}
            {addStep === 1 && (
              <div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>Select your broker</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '24px' }}>
                  {(['zerodha', 'angelone'] as const).map(b => (
                    <div key={b} onClick={() => patchForm({ broker: b })} style={{
                      padding: '20px 16px', borderRadius: '8px', cursor: 'pointer', textAlign: 'center',
                      border: `0.5px solid ${addForm.broker === b ? 'rgba(255,107,0,0.65)' : 'rgba(255,107,0,0.15)'}`,
                      background: addForm.broker === b ? 'rgba(255,107,0,0.10)' : 'var(--glass-bg)',
                      transition: 'all 0.12s',
                    }}>
                      <div style={{ fontSize: '15px', fontWeight: 700, marginBottom: '4px', color: addForm.broker === b ? 'var(--ox-radiant)' : 'var(--text)' }}>
                        {b === 'zerodha' ? 'Zerodha' : 'Angel One'}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                        {b === 'zerodha' ? 'Kite API' : 'SmartAPI'}
                      </div>
                    </div>
                  ))}
                </div>
                {/* A8 — No icon on Continue button */}
                <button className="btn btn-primary" style={{ width: '100%' }}
                  disabled={!addForm.broker}
                  onClick={() => setAddStep(2)}>
                  Continue
                </button>
              </div>
            )}

            {/* Step 2 — Details form */}
            {addStep === 2 && (
              <div>
                <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {/* A9 — Back button inside modal step 2 */}
                  <button className="btn btn-ghost" style={{ fontSize: '11px' }} onClick={() => setAddStep(1)}>← Back</button>
                  <span style={{ fontWeight: 700, color: addForm.broker === 'zerodha' ? 'var(--ox-radiant)' : 'var(--accent-amber)' }}>
                    {addForm.broker === 'zerodha' ? 'Zerodha' : 'Angel One'}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
                  {[
                    { key: 'nickname',    label: 'Nickname',    type: 'text',     placeholder: 'e.g. Karthik' },
                    { key: 'client_id',   label: 'Client ID',   type: 'text',     placeholder: addForm.broker === 'zerodha' ? 'AB1234' : 'A123456' },
                    { key: 'api_key',     label: 'API Key',     type: 'text',     placeholder: 'API key from console' },
                    { key: 'api_secret',  label: addForm.broker === 'zerodha' ? 'API Secret' : 'PIN / Password', type: 'password', placeholder: '••••••••' },
                    { key: 'totp_secret', label: 'TOTP Secret', type: 'password', placeholder: 'Base32 TOTP secret (Angel One only)' },
                  ].map(({ key, label, type, placeholder }) => (
                    <div key={key}>
                      {/* Delta B — labels uppercase display font */}
                      <div style={{ fontSize: '10px', color: 'rgba(232,232,248,0.5)', marginBottom: '4px', fontWeight: 600, textTransform: 'uppercase', fontFamily: 'var(--font-display)' }}>{label}</div>
                      <input
                        className="staax-input"
                        type={type}
                        placeholder={placeholder}
                        value={(addForm as any)[key]}
                        onChange={e => patchForm({ [key]: e.target.value } as Partial<AddAccountForm>)}
                        style={{ fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                      />
                    </div>
                  ))}
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>Scope</label>
                    <select
                      value={addForm.scope || 'fo'}
                      onChange={e => patchForm({ scope: e.target.value })}
                      style={{ width: '100%', background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '8px 10px' }}
                    >
                      <option value="fo">F&amp;O (Futures &amp; Options)</option>
                      <option value="mcx">MCX (Commodities)</option>
                    </select>
                  </div>
                </div>
                {addError && (
                  <div style={{ fontSize: '12px', color: 'var(--red)', background: 'rgba(239,68,68,0.1)', padding: '8px 12px', borderRadius: '6px', marginBottom: '12px' }}>
                    {addError}
                  </div>
                )}
                {/* A8 — No icon on Add Account button */}
                <button className="btn btn-primary" style={{ width: '100%' }}
                  disabled={addSaving}
                  onClick={submitAdd}>
                  {addSaving ? 'Adding…' : 'Add Account'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Deactivate / Reactivate Confirmation Modal */}
      {confirmAction && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,107,0,0.3)', borderRadius: 12, padding: 24, maxWidth: 380, width: '90%' }}>
            <h3 style={{ margin: '0 0 12px', color: 'var(--text-primary)', fontSize: 16 }}>
              {confirmAction.type === 'deactivate' ? 'Deactivate Account' : 'Reactivate Account'}
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 20px' }}>
              {confirmAction.type === 'deactivate'
                ? `Are you sure you want to deactivate "${confirmAction.nickname}"? All active algos on this account will stop.`
                : `Reactivate "${confirmAction.nickname}"?`}
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmAction(null)} style={{ padding: '7px 16px', background: 'transparent', color: 'var(--text-muted)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, cursor: 'pointer' }}>
                Cancel
              </button>
              <button
                onClick={executeConfirmedAction}
                style={{ padding: '7px 16px', background: confirmAction.type === 'deactivate' ? 'rgba(255,50,50,0.3)' : 'rgba(50,200,100,0.3)', color: confirmAction.type === 'deactivate' ? '#ff6b6b' : '#6bff8b', border: 'none', borderRadius: 6, cursor: 'pointer' }}
              >
                {confirmAction.type === 'deactivate' ? 'Deactivate' : 'Reactivate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit API Keys Modal */}
      {editingCreds && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000}}>
          <div className="cloud-fill" style={{width:420,borderRadius:16,border:'0.5px solid rgba(255,107,0,0.3)',padding:28}}>
            <div style={{fontFamily:'Syne',fontWeight:700,fontSize:16,color:'var(--ox-radiant)',marginBottom:4}}>{editingCreds.nickname}</div>
            <div style={{fontFamily:'var(--font-mono)',fontSize:11,color:'rgba(232,232,248,0.4)',marginBottom:20}}>Client ID: {editingCreds.client_id}</div>

            {/* API Key */}
            <label style={{fontSize:10,fontFamily:'Syne',color:'rgba(232,232,248,0.5)',textTransform:'uppercase',letterSpacing:1}}>API Key</label>
            <input value={editingCreds.api_key} onChange={e => setEditingCreds({...editingCreds, api_key: e.target.value})}
              style={{width:'100%',marginTop:4,marginBottom:12,padding:'8px 10px',borderRadius:8,border:'0.5px solid rgba(255,255,255,0.15)',background:'rgba(255,255,255,0.05)',color:'#F0F0FF',fontFamily:'var(--font-mono)',fontSize:12,boxSizing:'border-box'}} />

            {/* API Secret */}
            <label style={{fontSize:10,fontFamily:'Syne',color:'rgba(232,232,248,0.5)',textTransform:'uppercase',letterSpacing:1}}>API Secret</label>
            <div style={{position:'relative',marginTop:4,marginBottom:12}}>
              <input type={showSecret?'text':'password'} value={editingCreds.api_secret} onChange={e => setEditingCreds({...editingCreds, api_secret: e.target.value})}
                placeholder="Leave blank to keep existing"
                style={{width:'100%',padding:'8px 36px 8px 10px',borderRadius:8,border:'0.5px solid rgba(255,255,255,0.15)',background:'rgba(255,255,255,0.05)',color:'#F0F0FF',fontFamily:'var(--font-mono)',fontSize:12,boxSizing:'border-box'}} />
              <button onClick={() => setShowSecret(!showSecret)} style={{position:'absolute',right:8,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',color:'rgba(232,232,248,0.4)',cursor:'pointer',fontSize:11}}>{showSecret?'Hide':'Show'}</button>
            </div>

            {/* TOTP Secret */}
            <label style={{fontSize:10,fontFamily:'Syne',color:'rgba(232,232,248,0.5)',textTransform:'uppercase',letterSpacing:1}}>TOTP Secret</label>
            <div style={{position:'relative',marginTop:4,marginBottom:20}}>
              <input type={showTotp?'text':'password'} value={editingCreds.totp_secret} onChange={e => setEditingCreds({...editingCreds, totp_secret: e.target.value})}
                placeholder="Leave blank to keep existing"
                style={{width:'100%',padding:'8px 36px 8px 10px',borderRadius:8,border:'0.5px solid rgba(255,255,255,0.15)',background:'rgba(255,255,255,0.05)',color:'#F0F0FF',fontFamily:'var(--font-mono)',fontSize:12,boxSizing:'border-box'}} />
              <button onClick={() => setShowTotp(!showTotp)} style={{position:'absolute',right:8,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',color:'rgba(232,232,248,0.4)',cursor:'pointer',fontSize:11}}>{showTotp?'Hide':'Show'}</button>
            </div>

            {/* Actions */}
            <div style={{display:'flex',gap:10,justifyContent:'flex-end'}}>
              <button onClick={() => { setEditingCreds(null); setShowSecret(false); setShowTotp(false); }}
                style={{padding:'8px 16px',borderRadius:8,border:'0.5px solid rgba(255,255,255,0.15)',background:'transparent',color:'rgba(232,232,248,0.5)',fontFamily:'Syne',fontSize:12,cursor:'pointer'}}>Cancel</button>
              <button onClick={async () => {
                const creds: { api_key?: string; api_secret?: string; totp_secret?: string } = { api_key: editingCreds.api_key }
                if (editingCreds.api_secret) creds.api_secret = editingCreds.api_secret
                if (editingCreds.totp_secret) creds.totp_secret = editingCreds.totp_secret
                await accountsAPI.updateCredentials(editingCreds.id, creds)
                setEditingCreds(null); setShowSecret(false); setShowTotp(false)
              }} style={{padding:'8px 20px',borderRadius:8,border:'none',background:'var(--ox-radiant)',color:'#000',fontFamily:'Syne',fontWeight:700,fontSize:12,cursor:'pointer'}}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
