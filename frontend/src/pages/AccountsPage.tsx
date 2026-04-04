import { useState, useEffect } from 'react'
import { accountsAPI } from '@/services/api'
import { useStore } from '@/store'

interface AccountLocal {
  id: string; name: string; broker: string; type: string; status: string
  margin: number; pnl: number; token: string; color: string
  globalSL: number | null; globalTP: number | null; fyBrokerage: number | null
}


// Returns current financial year string e.g. "2025-26"
function getCurrentFY(): string {
  const now = new Date()
  const month = now.getMonth() + 1  // 1-based
  const year  = now.getFullYear()
  const fyStart = month >= 4 ? year : year - 1
  return `${fyStart}-${String(fyStart + 1).slice(2)}`
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
  api_secret: string
  pin: string
  totp_secret: string
}

const EMPTY_FORM: AddAccountForm = { broker: '', nickname: '', client_id: '', api_key: '', api_secret: '', pin: '', totp_secret: '' }

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

  // Add Account modal
  const [addModal,   setAddModal]   = useState(false)
  const [addStep,    setAddStep]    = useState<1|2>(1)
  const [addForm,    setAddForm]    = useState<AddAccountForm>(EMPTY_FORM)
  const [addSaving,  setAddSaving]  = useState(false)
  const [addError,   setAddError]   = useState('')
  const [addToast,   setAddToast]   = useState('')

  const openAddModal = () => { setAddModal(true); setAddStep(1); setAddForm(EMPTY_FORM); setAddError('') }
  const closeAddModal = () => { setAddModal(false); setAddError('') }
  const patchForm = (p: Partial<AddAccountForm>) => setAddForm(f => ({ ...f, ...p }))

  const submitAdd = async () => {
    if (!addForm.nickname.trim() || !addForm.client_id.trim()) { setAddError('Nickname and Client ID are required'); return }
    setAddSaving(true); setAddError('')
    try {
      await accountsAPI.create({
        broker:      addForm.broker,
        nickname:    addForm.nickname.trim(),
        client_id:   addForm.client_id.trim(),
        api_key:     addForm.api_key.trim(),
        api_secret:  addForm.api_secret,
        pin:         addForm.pin,
        totp_secret: addForm.totp_secret,
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
          })))
        }
      })
      .catch(() => {})
  }, [])

  // Check token status for all accounts on mount
  useEffect(() => {
    const checkTokens = async () => {
      try {
        const zStatus   = await accountsAPI.zerodhaTokenStatus()
        const momStatus = await accountsAPI.angeloneTokenStatus('mom')
        const wifeStatus= await accountsAPI.angeloneTokenStatus('wife')
        const kaoStatus = await accountsAPI.angeloneTokenStatus('karthik')
        setTokenStatus({
          'Karthik':    zStatus.data?.connected   ?? false,
          'Mom':        momStatus.data?.connected  ?? false,
          'Wife':       wifeStatus.data?.connected ?? false,
          'Karthik AO': kaoStatus.data?.connected  ?? false,
        })
      } catch {}
    }
    checkTokens()
  }, [])

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
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>Broker accounts & API tokens</p>
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

              {/* Edit controls — active accounts only */}
              {acc.status === 'active' && <>
                {/* A3 — FY Margin + FY Brokerage side by side */}
                <div style={{ marginBottom: '10px' }}>
                  <div style={{ fontSize: '10px', color: 'rgba(232,232,248,0.5)', marginBottom: '5px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: 'var(--font-display)' }}>
                    FY Margin / Brokerage
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
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
                    { key: 'nickname',   label: 'Nickname',    type: 'text',     placeholder: 'e.g. Karthik' },
                    { key: 'client_id',  label: 'Client ID',   type: 'text',     placeholder: addForm.broker === 'zerodha' ? 'AB1234' : 'A123456' },
                    { key: 'api_key',    label: 'API Key',     type: 'text',     placeholder: 'API key from console' },
                    { key: 'api_secret', label: addForm.broker === 'zerodha' ? 'API Secret' : 'API Secret', type: 'password', placeholder: '••••••••' },
                    { key: 'pin',        label: addForm.broker === 'zerodha' ? 'Password' : 'PIN / Password', type: 'password', placeholder: '••••••••' },
                    { key: 'totp_secret', label: 'TOTP Secret', type: 'password', placeholder: 'Base32 TOTP secret' },
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
    </div>
  )
}
