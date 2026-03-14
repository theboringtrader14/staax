import { useState, useEffect } from 'react'
import { accountsAPI } from '@/services/api'
import { useStore } from '@/store'

interface AccountLocal {
  id: string; name: string; broker: string; type: string; status: string
  margin: number; pnl: number; token: string; color: string
  globalSL: number; globalTP: number
}

const FALLBACK: AccountLocal[] = [
  { id:'1', name:'Karthik', broker:'Zerodha',   type:'F&O', status:'active',  margin:500000, pnl:84320,  token:'active',  color:'#00B0F0', globalSL:10000, globalTP:25000 },
  { id:'2', name:'Mom',     broker:'Angel One', type:'F&O', status:'active',  margin:300000, pnl:-12450, token:'active',  color:'#22C55E', globalSL:8000,  globalTP:15000 },
  { id:'3', name:'Wife',    broker:'Angel One', type:'MCX', status:'pending', margin:150000, pnl:0,      token:'pending', color:'#D77B12', globalSL:5000,  globalTP:10000 },
]

export default function AccountsPage() {
  const storeAccounts = useStore(s => s.accounts)
  const [accounts, setAccounts] = useState<AccountLocal[]>([])
  const [editMargin, setEditMargin] = useState<Record<string, string>>({})
  const [editSL,     setEditSL]     = useState<Record<string, string>>({})
  const [editTP,     setEditTP]     = useState<Record<string, string>>({})
  const [saved,      setSaved]      = useState<Record<string, string>>({})
  const [saving,     setSaving]     = useState<Record<string, boolean>>({})
  const [tokenStatus, setTokenStatus] = useState<Record<string, boolean>>({})
  const [logging,     setLogging]     = useState<Record<string, boolean>>({})

  // Check token status for all accounts on mount
  useEffect(() => {
    const checkTokens = async () => {
      try {
        const zStatus = await accountsAPI.zerodhaTokenStatus()
        const momStatus = await accountsAPI.angeloneTokenStatus('mom')
        const wifeStatus = await accountsAPI.angeloneTokenStatus('wife')
        setTokenStatus({
          Karthik: zStatus.data?.connected ?? false,
          Mom:     momStatus.data?.connected ?? false,
          Wife:    wifeStatus.data?.connected ?? false,
        })
      } catch {}
    }
    checkTokens()
  }, [])

  // Merge API accounts over fallback when store populates
  useEffect(() => {
    if (storeAccounts.length > 0) {
      setAccounts(prev => prev.map((fa, i) => {
        const api = storeAccounts[i]
        if (!api) return fa
        return {
          ...fa,
          id:       api.id,
          name:     api.nickname,
          broker:   api.broker === 'zerodha' ? 'Zerodha' : 'Angel One',
          status:   api.status === 'active' ? 'active' : 'pending',
          globalSL: api.global_sl ?? fa.globalSL,
          globalTP: api.global_tp ?? fa.globalTP,
        }
      }))
    }
  }, [storeAccounts])

  const showSaved = (id: string, msg: string) => {
    setSaved(s => ({ ...s, [id]: msg }))
    setTimeout(() => setSaved(s => { const n = { ...s }; delete n[id]; return n }), 3000)
  }

  const saveMargin = async (acc: AccountLocal) => {
    const val = parseFloat(editMargin[acc.id] || String(acc.margin))
    if (isNaN(val) || val <= 0) return
    setSaving(s => ({ ...s, [acc.id]: true }))
    try {
      await accountsAPI.updateMargin(acc.id, { margin: val })
      setAccounts(a => a.map(x => x.id === acc.id ? { ...x, margin: val } : x))
      showSaved(acc.id, '✅ Margin updated')
    } catch {
      showSaved(acc.id, '⚠️ Save failed')
    } finally {
      setSaving(s => ({ ...s, [acc.id]: false }))
    }
  }

  const saveSettings = async (acc: AccountLocal) => {
    const sl = parseFloat(editSL[acc.id] || String(acc.globalSL))
    const tp = parseFloat(editTP[acc.id] || String(acc.globalTP))
    setSaving(s => ({ ...s, [acc.id]: true }))
    try {
      await accountsAPI.updateGlobalRisk(acc.id, { global_sl: sl, global_tp: tp })
      setAccounts(a => a.map(x => x.id === acc.id ? { ...x, globalSL: sl, globalTP: tp } : x))
      showSaved(acc.id, '✅ Settings saved')
    } catch {
      showSaved(acc.id, '⚠️ Save failed')
    } finally {
      setSaving(s => ({ ...s, [acc.id]: false }))
    }
  }

  const handleZerodhaLogin = async (acc: AccountLocal) => {
    try {
      const urlRes = await accountsAPI.zerodhaLoginUrl()
      window.open(urlRes.data?.login_url, '_blank')
    } catch {
      showSaved(acc.id, '⚠️ Could not get login URL')
    }
  }

  const handleAngeloneLogin = async (acc: AccountLocal) => {
    const nickname = acc.name.toLowerCase() as 'mom' | 'wife'
    setLogging(l => ({ ...l, [acc.id]: true }))
    try {
      await accountsAPI.angeloneLogin(nickname)
      setTokenStatus(t => ({ ...t, [acc.name]: true }))
      showSaved(acc.id, '✅ Angel One connected')
    } catch (e: any) {
      showSaved(acc.id, `⚠️ Login failed: ${e?.response?.data?.detail || 'Unknown error'}`)
    } finally {
      setLogging(l => ({ ...l, [acc.id]: false }))
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1 style={{ fontFamily: "'ADLaM Display',serif", fontSize: '22px', fontWeight: 400 }}>Accounts</h1>
        <div className="page-header-actions">
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Broker login & token management is available in the{' '}
            <b style={{ color: 'var(--accent-blue)' }}>Dashboard</b>
          </span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '12px' }}>
        {accounts.map(acc => (
          <div key={acc.id} style={{
            background: 'var(--bg-surface)', border: '1px solid var(--bg-border)',
            borderTop: `3px solid ${acc.color}`, borderRadius: '8px', padding: '16px',
          }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '16px' }}>{acc.name}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{acc.broker} · {acc.type}</div>
              </div>
              <span style={{
                fontSize: '11px', padding: '3px 8px', borderRadius: '4px', fontWeight: 600,
                color: acc.status === 'active' ? 'var(--green)' : 'var(--amber)',
                background: acc.status === 'active' ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)',
              }}>
                {acc.status.toUpperCase()}
              </span>
            </div>

            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
              <div style={{ background: 'var(--bg-secondary)', borderRadius: '6px', padding: '10px' }}>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>FY Margin</div>
                <div style={{ fontWeight: 700, fontSize: '14px' }}>₹{(acc.margin / 100000).toFixed(1)}L</div>
              </div>
              <div style={{ background: 'var(--bg-secondary)', borderRadius: '6px', padding: '10px' }}>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>FY P&L</div>
                <div style={{ fontWeight: 700, fontSize: '14px', color: acc.pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {acc.pnl >= 0 ? '+' : ''}₹{Math.abs(acc.pnl).toLocaleString('en-IN')}
                </div>
              </div>
            </div>

            {/* Token status + Login */}
            <div style={{
              fontSize: '11px', color: 'var(--text-muted)', marginBottom: '12px',
              padding: '8px 10px', background: 'var(--bg-secondary)', borderRadius: '5px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span>
                API Token:&nbsp;
                <span style={{ fontWeight: 600, color: tokenStatus[acc.name] ? 'var(--green)' : acc.broker === 'Angel One' && acc.type === 'MCX' ? 'var(--accent-amber)' : 'var(--red)' }}>
                  {tokenStatus[acc.name] ? '✅ Connected' : acc.broker === 'Angel One' && acc.type === 'MCX' ? '⏳ Phase 2' : '⚠️ Login required'}
                </span>
              </span>
              {!tokenStatus[acc.name] && acc.type !== 'MCX' && (
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: '10px', padding: '3px 8px', height: '24px' }}
                  disabled={logging[acc.id]}
                  onClick={() => acc.broker === 'Zerodha' ? handleZerodhaLogin(acc) : handleAngeloneLogin(acc)}
                >
                  {logging[acc.id] ? '...' : acc.broker === 'Zerodha' ? '🔑 Login' : '🔄 Auto-Login'}
                </button>
              )}
            </div>

            {/* Edit controls — active accounts only */}
            {acc.status === 'active' && <>
              {/* FY Margin */}
              <div style={{ marginBottom: '10px' }}>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '5px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Update FY Margin
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input className="staax-input" type="number" defaultValue={acc.margin}
                    onChange={e => setEditMargin(m => ({ ...m, [acc.id]: e.target.value }))}
                    style={{ flex: 1, fontSize: '12px' }} />
                  <button className="btn btn-ghost" style={{ fontSize: '11px', flexShrink: 0 }}
                    disabled={saving[acc.id]}
                    onClick={() => saveMargin(acc)}>
                    {saving[acc.id] ? '...' : 'Save'}
                  </button>
                </div>
              </div>

              {/* Global SL / TP */}
              <div style={{ marginBottom: '10px' }}>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '5px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Global SL / TP
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '6px' }}>
                  <input className="staax-input" type="number" placeholder="SL ₹" defaultValue={acc.globalSL}
                    onChange={e => setEditSL(s => ({ ...s, [acc.id]: e.target.value }))}
                    style={{ fontSize: '12px' }} />
                  <input className="staax-input" type="number" placeholder="TP ₹" defaultValue={acc.globalTP}
                    onChange={e => setEditTP(s => ({ ...s, [acc.id]: e.target.value }))}
                    style={{ fontSize: '12px' }} />
                </div>
                <button className="btn btn-ghost" style={{ width: '100%', fontSize: '11px' }}
                  disabled={saving[acc.id]}
                  onClick={() => saveSettings(acc)}>
                  {saving[acc.id] ? 'Saving...' : 'Save Settings'}
                </button>
              </div>
            </>}

            {/* Save feedback */}
            {saved[acc.id] && (
              <div style={{
                fontSize: '12px', color: 'var(--green)', fontWeight: 600,
                padding: '6px 10px', background: 'rgba(34,197,94,0.1)',
                borderRadius: '5px', textAlign: 'center',
              }}>
                {saved[acc.id]}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
