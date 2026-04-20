import { useEffect, useState } from 'react'
import { X } from '@phosphor-icons/react'
import { useStore } from '@/store'
import { servicesAPI, accountsAPI, systemAPI, eventsAPI } from '@/services/api'

// ── Types (copied from DashboardPage) ─────────────────────────
type ServiceStatus = 'running' | 'stopped' | 'starting' | 'stopping'
interface Service { id: string; name: string; status: ServiceStatus; detail: string }

const INIT_SERVICES: Service[] = [
  { id: 'db',      name: 'PostgreSQL',  status: 'stopped', detail: 'localhost:5432' },
  { id: 'redis',   name: 'Redis',       status: 'stopped', detail: 'localhost:6379' },
  { id: 'backend', name: 'Backend API', status: 'stopped', detail: 'http://localhost:8000' },
  { id: 'ws',      name: 'Market Feed', status: 'stopped', detail: 'NSE live tick data' },
]
const STATUS_CLR: Record<ServiceStatus, string> = {
  running: 'var(--sem-long)', stopped: '#4A4A52', starting: 'var(--sem-warn)', stopping: 'var(--sem-warn)',
}

function dedupeLog(lines: string[]): string[] {
  const result: string[] = []
  let i = 0
  while (i < lines.length) {
    const cur = lines[i]
    if (cur.startsWith('──')) { result.push(cur); i++; continue }
    const tsMatch = cur.match(/^\[(\d{2}:\d{2}:\d{2})\]\s*/)
    const curMsg = tsMatch ? cur.slice(tsMatch[0].length) : cur
    const curTsSecs = tsMatch ? (() => { const [h,m,s] = tsMatch[1].split(':').map(Number); return h*3600+m*60+s })() : null
    let count = 1
    while (i + count < lines.length) {
      const next = lines[i + count]
      if (next.startsWith('──')) break
      const nextTsMatch = next.match(/^\[(\d{2}:\d{2}:\d{2})\]\s*/)
      const nextMsg = nextTsMatch ? next.slice(nextTsMatch[0].length) : next
      if (nextMsg !== curMsg) break
      if (curTsSecs !== null && nextTsMatch) {
        const [nh,nm,ns] = nextTsMatch[1].split(':').map(Number)
        if (Math.abs(nh*3600+nm*60+ns - curTsSecs) > 30) break
      }
      count++
    }
    result.push(count > 1 ? cur + ` ×${count}` : cur)
    i += count
  }
  return result
}

function isPast9am() {
  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  return ist.getHours() > 9 || (ist.getHours() === 9 && ist.getMinutes() >= 15)
}

// ── Component ──────────────────────────────────────────────────
export default function DashboardPanel() {
  const isDashboardOpen    = useStore(s => s.isDashboardOpen)
  const setIsDashboardOpen = useStore(s => s.setIsDashboardOpen)
  const accounts           = useStore(s => s.accounts)
  const setAccounts        = useStore(s => s.setAccounts)

  const [services, setServices]         = useState<Service[]>(INIT_SERVICES)
  const [health, setHealth]             = useState<any>(null)
  const [log, setLog]                   = useState<string[]>(['STAAX ready.'])
  const [loginSucceeded, setLoginSucceeded] = useState<Record<string, boolean>>({})

  // Kill switch state
  const [showKillConfirm, setKillModal]  = useState(false)
  const [killActivated, setKillActived]  = useState(false)
  const [killLoading, setKillLoading]    = useState(false)
  const [killResult, setKillResult]      = useState<{positions_squared:number;orders_cancelled:number;errors:string[]}|null>(null)
  const [selKill, setSelKill]            = useState<string[]>([])
  const [killedIds, setKilledIds]        = useState<string[]>([])
  const [lateWarning, setLateWarning]    = useState(false)

  // ── Helpers ──────────────────────────────────────────────────
  const addLog = (msg: string) => {
    const ts = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    setLog(l => ['[' + ts + '] ' + msg, ...l.slice(0, 49)])
  }
  const setSvc    = (id: string, st: ServiceStatus) => setServices(s => s.map(x => x.id === id ? { ...x, status: st } : x))
  const startSvc  = async (id: string) => { setSvc(id,'starting'); addLog('Starting '+id+'…'); try { await servicesAPI.start(id); setSvc(id,'running'); addLog('✅ '+id+' running') } catch { setSvc(id,'stopped'); addLog('⛔ '+id+' failed') } }
  const stopSvc   = async (id: string) => { setSvc(id,'stopping'); addLog('Stopping '+id+'…'); try { await servicesAPI.stop(id); setSvc(id,'stopped'); addLog('⛔ '+id+' stopped') } catch { setSvc(id,'running'); addLog('Error stopping '+id) } }

  const doStartAll = async () => {
    setLateWarning(false); addLog('Starting all services…')
    try {
      await servicesAPI.startAll()
      addLog('✅ All services running.')
      const res = await servicesAPI.status()
      setServices(p => p.map(s => { const rem = (res.data.services as Service[]).find(r => r.id === s.id); return rem ? { ...s, status: rem.status } : s }))
    } catch { addLog('⛔ Start all failed') }
  }
  const startAll = async () => { if (isPast9am()) { setLateWarning(true); return }; await doStartAll() }
  const stopAll  = async () => {
    addLog('Stopping all services…')
    try { await servicesAPI.stopAll(); addLog('All services stopped.') }
    catch { addLog('Error stopping services') }
  }

  const handleKill = async () => {
    setKillLoading(true); addLog('⚠️ KILL SWITCH ACTIVATED')
    try {
      const res = await systemAPI.activateKillSwitch(selKill)
      const d = res.data
      setKillActived(true)
      setKilledIds(p => Array.from(new Set([...p, ...(selKill.length > 0 ? selKill : (accounts as any[]).map((a:any) => a.id))])))
      setKillResult({ positions_squared: d.positions_squared ?? 0, orders_cancelled: d.orders_cancelled ?? 0, errors: d.errors ?? [] })
      addLog('[CRITICAL] KILL — ' + (d.positions_squared ?? 0) + ' pos, ' + (d.orders_cancelled ?? 0) + ' orders')
    } catch (err: any) { addLog('⛔ Kill failed — ' + (err?.response?.data?.detail || 'unknown')) }
    finally { setKillLoading(false); setKillModal(false) }
  }

  const refetchHealth = () => systemAPI.health().then(r => setHealth(r.data)).catch(() => {})

  // ── Effects ───────────────────────────────────────────────────
  useEffect(() => {
    accountsAPI.list().then(res => setAccounts(res.data)).catch(() => {})
  }, [])

  useEffect(() => {
    eventsAPI.list(50).then(res => {
      const entries: any[] = res.data || []
      const todayStr = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Kolkata' })
      const lines: string[] = []
      let lastSep = ''
      for (const e of entries) {
        const eDay = e.ts ? new Date(e.ts).toLocaleDateString('sv', { timeZone: 'Asia/Kolkata' }) : todayStr
        const eDate = e.ts ? new Date(e.ts).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' }) : null
        if (eDay !== todayStr && eDate && eDay !== lastSep) { lines.push('── ' + eDate + ' ──'); lastSep = eDay }
        const ts = e.ts ? new Date(e.ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '--:--:--'
        const icon = e.level === 'success' ? '✅' : e.level === 'error' ? '⛔' : e.level === 'warn' ? '⚠️' : '·'
        lines.push('[' + ts + '] ' + icon + ' ' + (e.source ? '[' + e.source + '] ' : '') + e.msg)
      }
      if (lines.length) setLog(p => [...lines, ...p])
    }).catch(() => {})
  }, [])

  useEffect(() => {
    refetchHealth()
    const t = setInterval(refetchHealth, 30000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    systemAPI.killSwitchStatus().then(res => {
      if (res.data?.activated) setKillActived(true)
      if (res.data?.killed_account_ids?.length) setKilledIds(res.data.killed_account_ids)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    const poll = () => servicesAPI.status().then(res => {
      setServices(prev => prev.map(s => { const rem = (res.data.services as Service[]).find(r => r.id === s.id); return rem ? { ...s, status: rem.status } : s }))
    }).catch(() => {})
    poll()
    const t = setInterval(poll, 5000)
    return () => clearInterval(t)
  }, [])

  // ── Derived values ────────────────────────────────────────────
  const IST_OFFSET = 5.5 * 60 * 60 * 1000
  const nowIST = new Date(Date.now() + IST_OFFSET - new Date().getTimezoneOffset() * 60000)
  const day = nowIST.getUTCDay()
  const minsNow = nowIST.getUTCHours() * 60 + nowIST.getUTCMinutes()
  const isMarketHours: boolean = health?.is_market_hours ?? (day >= 1 && day <= 5 && minsNow >= (9*60+15) && minsNow <= (15*60+30))

  const ssData = health?.checks?.smartstream
  const ssConnected = (ssData?.connected || ssData?.ok) ?? false

  const criticalRed =
    !(health?.checks?.database?.ok ?? false) ||
    !(health?.checks?.redis?.ok ?? false) ||
    !(health?.checks?.scheduler?.ok ?? false) ||
    (isMarketHours && !ssConnected)
  const smartstreamAmber = !isMarketHours && !ssConnected
  const overallState: 'green' | 'amber' | 'red' = !health ? 'amber' : criticalRed ? 'red' : smartstreamAmber ? 'amber' : 'green'
  const overallColor = overallState === 'green' ? '#22DD88' : overallState === 'amber' ? '#FFD700' : '#FF4444'
  const statusLabel  = !health ? 'Loading…' : criticalRed ? 'System Not Ready' : smartstreamAmber ? 'Feed Inactive' : 'System Ready'

  const displayAccounts = (accounts as any[]).length > 0 ? (accounts as any[]) : [
    { id: '1', nickname: 'Karthik', broker: 'zerodha',  token_valid_today: false },
    { id: '2', nickname: 'Mom',     broker: 'angelone', token_valid_today: false },
    { id: '3', nickname: 'Wife',    broker: 'angelone', token_valid_today: false },
  ]
  const dashboardAccounts = displayAccounts.filter((a: any) => a.nickname !== 'Karthik AO')
  const allRunning = services.every(s => s.status === 'running')
  const allStopped = services.every(s => s.status === 'stopped')
  const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

  const healthChips = [
    { label: 'Database',    ok: health?.checks?.database?.ok  ?? false, state: (health?.checks?.database?.ok  ?? false) ? 'green' : health ? 'red' : 'amber' },
    { label: 'Redis',       ok: health?.checks?.redis?.ok     ?? false, state: (health?.checks?.redis?.ok     ?? false) ? 'green' : health ? 'red' : 'amber' },
    { label: 'Scheduler',   ok: health?.checks?.scheduler?.ok ?? false, state: (health?.checks?.scheduler?.ok ?? false) ? 'green' : health ? 'red' : 'amber' },
    { label: 'SmartStream', ok: ssConnected,                            state: ssConnected ? 'green' : isMarketHours ? 'red' : 'amber' },
  ] as const

  // ── Render ────────────────────────────────────────────────────
  return (
    <>
      {/* Backdrop */}
      {isDashboardOpen && (
        <div
          onClick={() => setIsDashboardOpen(false)}
          style={{ position: 'fixed', top: 98, left: 0, right: 380, bottom: 0, background: 'rgba(0,0,0,0.35)', zIndex: 199 }}
        />
      )}

      {/* Panel */}
      <div style={{
        position: 'fixed', top: 98, right: 0, bottom: 0, width: 380, zIndex: 200,
        transform: isDashboardOpen ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 300ms cubic-bezier(0.4,0,0.2,1)',
        background: 'rgba(10,10,12,0.98)',
        borderLeft: '0.5px solid rgba(255,107,0,0.20)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>

        {/* ── Header ── */}
        <div style={{
          height: 48, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 16px',
          borderBottom: '0.5px solid rgba(255,107,0,0.12)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: overallColor, boxShadow: `0 0 8px ${overallColor}`, flexShrink: 0 }} />
            <span style={{ fontFamily: 'Syne, sans-serif', fontSize: 13, fontWeight: 700, color: 'var(--ox-radiant)' }}>System Monitor</span>
            <span style={{ fontSize: 10, color: overallColor, fontWeight: 600, marginLeft: 2 }}>· {statusLabel}</span>
          </div>
          <button
            onClick={() => setIsDashboardOpen(false)}
            style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', color: 'rgba(240,237,232,0.40)', cursor: 'pointer', borderRadius: 6 }}
          >
            <X size={15} weight="regular" />
          </button>
        </div>

        {/* ── Action bar ── */}
        <div style={{ flexShrink: 0, padding: '10px 16px', display: 'flex', gap: 8, borderBottom: '0.5px solid rgba(255,255,255,0.05)' }}>
          <button
            className="btn btn-primary"
            style={{ flex: 1, height: 30, fontSize: 11 }}
            onClick={startAll}
            disabled={allRunning}
          >
            ▶ Start Session
          </button>
          <button
            className="btn btn-steel"
            style={{ flex: 1, height: 30, fontSize: 11 }}
            onClick={stopAll}
            disabled={allStopped}
          >
            ■ Stop All
          </button>
          <button
            className="btn btn-danger"
            style={{ height: 30, padding: '0 12px', fontSize: 11, flexShrink: 0 }}
            onClick={() => { setSelKill(displayAccounts.map((a:any) => a.id).filter((id: string) => !killedIds.includes(id))); setKillModal(true) }}
            disabled={(killActivated && killedIds.length >= accounts.length) || killLoading}
          >
            {killActivated && killedIds.length >= accounts.length ? 'Killed' : 'Kill Switch'}
          </button>
        </div>

        {/* ── Scrollable body ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Kill result banner */}
          {killActivated && killResult && (
            <div style={{ background: 'rgba(255,68,68,0.08)', border: '0.5px solid rgba(255,68,68,0.30)', borderRadius: 8, padding: '8px 12px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#FF4444', marginBottom: 2 }}>⛔ Kill Switch Activated</div>
              <div style={{ fontSize: 10, color: 'var(--gs-muted)', fontFamily: 'var(--font-mono)' }}>
                {killResult.positions_squared} pos squared · {killResult.orders_cancelled} orders cancelled
              </div>
            </div>
          )}

          {/* Late warning */}
          {lateWarning && (
            <div style={{ background: 'rgba(255,68,68,0.08)', border: '0.5px solid rgba(255,68,68,0.30)', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#FF4444', marginBottom: 6 }}>⚠️ After 9:00 AM</div>
              <div style={{ fontSize: 11, color: 'var(--gs-muted)', marginBottom: 10 }}>Some algos may have passed entry time. Start anyway?</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-ghost" style={{ flex: 1, height: 28, fontSize: 11 }} onClick={() => setLateWarning(false)}>Cancel</button>
                <button className="btn btn-danger" style={{ flex: 1, height: 28, fontSize: 11 }} onClick={doStartAll}>Start Anyway</button>
              </div>
            </div>
          )}

          {/* ── System Health chips ── */}
          <div>
            <div style={{ fontSize: 9, letterSpacing: '0.15em', color: 'rgba(240,237,232,0.30)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 8 }}>System Health</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {healthChips.map(chip => {
                const dotColor   = chip.state === 'green' ? '#22DD88' : chip.state === 'red' ? '#FF4444' : '#FFD700'
                const dotGlow    = chip.state === 'green' ? '0 0 6px rgba(34,221,136,0.55)' : chip.state === 'red' ? '0 0 6px rgba(255,68,68,0.55)' : '0 0 6px rgba(255,215,0,0.45)'
                const statusText = chip.state === 'amber' ? 'inactive' : chip.ok ? 'ok' : 'down'
                return (
                  <div key={chip.label} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 10px', borderRadius: 8,
                    background: 'rgba(255,255,255,0.03)',
                    border: '0.5px solid rgba(255,255,255,0.07)',
                  }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: dotColor, boxShadow: dotGlow }} />
                    <div>
                      <div style={{ fontSize: 9, fontFamily: 'Syne, sans-serif', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.6px', color: 'rgba(232,232,248,0.28)', lineHeight: 1.2 }}>{chip.label}</div>
                      <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 600, color: dotColor, lineHeight: 1.3 }}>{statusText}</div>
                    </div>
                  </div>
                )
              })}
            </div>
            {/* Accounts needing login */}
            {(() => {
              const needsLogin = (accounts as any[]).filter((a: any) => {
                if (a.broker === 'zerodha') return a.token_valid === false || a.ok === false
                return a.token_valid === false
              })
              if (needsLogin.length === 0) return null
              return (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {needsLogin.map((acc: any) => {
                    const isZerodha = acc.broker === 'zerodha'
                    const succeeded = loginSucceeded[acc.id] ?? false
                    return (
                      <div key={acc.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', borderRadius: 8, background: 'rgba(255,107,0,0.06)', border: '0.5px solid rgba(255,107,0,0.20)' }}>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(232,232,248,0.9)' }}>{acc.nickname || acc.name}</div>
                          <div style={{ fontSize: 10, color: 'var(--gs-muted)' }}>{isZerodha ? 'Zerodha' : 'Angel One'} · needs login</div>
                        </div>
                        {isZerodha ? (
                          <button
                            onClick={() => {
                              const w = 520, h = 640
                              const left = window.screenX + (window.outerWidth - w) / 2
                              const top  = window.screenY + (window.outerHeight - h) / 2
                              window.open(`${API_BASE}/api/v1/zerodha/login`, 'zerodha_oauth', `width=${w},height=${h},left=${left},top=${top},toolbar=0,menubar=0,location=0,status=0`)
                            }}
                            style={{ padding: '3px 10px', borderRadius: 12, fontSize: 10, fontFamily: 'Syne, sans-serif', fontWeight: 600, background: 'transparent', border: '0.5px solid rgba(255,107,0,0.5)', color: 'var(--ox-radiant)', cursor: 'pointer' }}
                          >Refresh Token</button>
                        ) : (
                          <button
                            onClick={async () => {
                              try {
                                await fetch(`${API_BASE}/api/v1/accounts/${acc.id}/login`, { method: 'POST' })
                                setLoginSucceeded(p => ({ ...p, [acc.id]: true }))
                                refetchHealth()
                              } catch {}
                            }}
                            style={{ padding: '3px 10px', borderRadius: 12, fontSize: 10, fontFamily: 'Syne, sans-serif', fontWeight: 600, background: 'transparent', border: succeeded ? '0.5px solid rgba(34,221,136,0.4)' : '0.5px solid rgba(255,107,0,0.5)', color: succeeded ? '#22DD88' : 'var(--ox-radiant)', cursor: 'pointer' }}
                          >{succeeded ? 'Re-Login' : 'Login'}</button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })()}
            <button onClick={refetchHealth} className="btn btn-ghost" style={{ marginTop: 6, width: '100%', height: 26, fontSize: 10 }}>Refresh Health</button>
          </div>

          {/* ── Account Status ── */}
          <div>
            <div style={{ fontSize: 9, letterSpacing: '0.15em', color: 'rgba(240,237,232,0.30)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 8 }}>Account Status</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {dashboardAccounts.map((acc: any) => {
                const isZerodha = acc.broker === 'zerodha'
                const zerodhaOk = health?.checks?.broker_zerodha?.ok ?? false
                const angeloneOk: boolean = isZerodha ? false : (health?.checks?.['broker_angelone_' + acc.id]?.token_valid ?? acc.token_valid_today ?? false)
                const isLive: boolean = isZerodha ? zerodhaOk : angeloneOk
                const succeeded = loginSucceeded[acc.id] ?? false
                return (
                  <div key={acc.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.07)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className={isLive ? 'pulse-live-lg' : 'pulse-warn-lg'} />
                      <div>
                        <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600, color: 'var(--ox-glow)' }}>{acc.nickname || acc.name}</div>
                        <div style={{ fontSize: 10, color: 'var(--gs-muted)' }}>{isZerodha ? 'Zerodha' : 'Angel One'}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {isLive && <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 10, fontFamily: 'Syne, sans-serif', fontWeight: 600, background: 'rgba(34,221,136,0.12)', border: '0.5px solid rgba(34,221,136,0.25)', color: '#22DD88' }}>• Live</span>}
                      {isZerodha && !zerodhaOk && (
                        <button
                          onClick={() => {
                            const w = 520, h = 640
                            const left = window.screenX + (window.outerWidth - w) / 2
                            const top  = window.screenY + (window.outerHeight - h) / 2
                            window.open(`${API_BASE}/api/v1/zerodha/login`, 'zerodha_oauth', `width=${w},height=${h},left=${left},top=${top},toolbar=0,menubar=0,location=0,status=0`)
                          }}
                          style={{ padding: '3px 10px', borderRadius: 12, fontSize: 10, fontFamily: 'Syne, sans-serif', background: 'transparent', border: '0.5px solid rgba(255,107,0,0.5)', color: 'var(--ox-radiant)', cursor: 'pointer' }}
                        >🔑 Login</button>
                      )}
                      {!isZerodha && !isLive && (
                        <button
                          onClick={async () => {
                            const res = await fetch(`${API_BASE}/api/v1/accounts/${acc.id}/login`, { method: 'POST' })
                            if (res.ok) setLoginSucceeded(prev => ({ ...prev, [acc.id]: true }))
                          }}
                          style={{ padding: '3px 10px', borderRadius: 12, fontSize: 10, fontFamily: 'Syne, sans-serif', background: 'transparent', border: succeeded ? '0.5px solid rgba(34,221,136,0.4)' : '0.5px solid rgba(255,107,0,0.5)', color: succeeded ? '#22DD88' : 'var(--ox-radiant)', cursor: 'pointer' }}
                        >{succeeded ? 'Re-Login' : '🔑 Login'}</button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── Services ── */}
          <div>
            <div style={{ fontSize: 9, letterSpacing: '0.15em', color: 'rgba(240,237,232,0.30)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 8 }}>Services</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {services.map(svc => (
                <div key={svc.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.07)' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: STATUS_CLR[svc.status], boxShadow: svc.status === 'running' ? '0 0 6px ' + STATUS_CLR[svc.status] : 'none' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ox-glow)' }}>{svc.name}</div>
                    <div style={{ fontSize: 9, color: 'var(--gs-muted)', fontFamily: 'var(--font-mono)' }}>{svc.detail}</div>
                  </div>
                  <span className={'chip ' + (svc.status === 'running' ? 'chip-success' : 'chip-inactive')} style={{ fontSize: 9, padding: '1px 6px', flexShrink: 0 }}>{svc.status}</span>
                  {svc.status === 'stopped'  && <button className="btn btn-ghost"  style={{ fontSize: 9, padding: '0 8px', height: 22 }} onClick={() => startSvc(svc.id)}>Start</button>}
                  {svc.status === 'running'  && <button className="btn btn-danger" style={{ fontSize: 9, padding: '0 8px', height: 22 }} onClick={() => stopSvc(svc.id)}>Stop</button>}
                  {(svc.status === 'starting' || svc.status === 'stopping') && <button className="btn btn-steel" style={{ fontSize: 9, padding: '0 8px', height: 22 }} disabled>{svc.status}…</button>}
                </div>
              ))}
            </div>
          </div>

          {/* ── Engine Log ── */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <span className="pulse-live" />
              <div style={{ fontSize: 9, letterSpacing: '0.15em', color: 'rgba(240,237,232,0.30)', fontWeight: 700, textTransform: 'uppercase' }}>Engine Log</div>
            </div>
            <div style={{ borderRadius: 8, overflow: 'hidden', background: 'rgba(5,4,2,0.92)', border: '0.5px solid rgba(255,107,0,0.14)' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, padding: '8px 10px', height: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                {dedupeLog(log).map((line, i) => {
                  const isSep = line.startsWith('──')
                  if (isSep) return (
                    <div key={i} style={{ color: 'rgba(255,107,0,0.25)', textAlign: 'center', fontSize: 9, padding: '3px 0', margin: '2px 0', borderTop: '0.5px solid rgba(255,107,0,0.08)', borderBottom: '0.5px solid rgba(255,107,0,0.08)' }}>
                      {line}
                    </div>
                  )
                  const isOk  = line.includes('✅')
                  const isErr = line.includes('⛔')
                  const isWrn = line.includes('⚠')
                  return (
                    <div key={i} style={{ color: isOk ? '#22DD88' : isErr ? '#FF4444' : isWrn ? '#FFD700' : 'rgba(240,237,232,0.38)', lineHeight: 1.6, padding: '0.5px 0' }}>
                      {line}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

        </div>{/* end scrollable body */}
      </div>

      {/* ── Kill Switch Modal ── */}
      {showKillConfirm && (
        <div className="modal-overlay" style={{ zIndex: 1200 }}>
          <div className="modal-box">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--sem-short)" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
              <span style={{ fontWeight: 800, fontSize: 16, fontFamily: 'var(--font-display)', color: 'var(--sem-short)' }}>Kill Switch</span>
            </div>
            <p style={{ fontSize: 12, color: 'var(--gs-muted)', marginBottom: 14, lineHeight: 1.6 }}>Select accounts to kill. Uncheck any you want to leave running.</p>
            <div style={{ marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {displayAccounts.map((acc: any) => {
                const checked = selKill.includes(acc.id)
                return (
                  <label key={acc.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: checked ? 'rgba(255,68,68,0.08)' : 'rgba(255,255,255,0.03)', border: '0.5px solid ' + (checked ? 'rgba(255,68,68,0.4)' : 'rgba(255,255,255,0.08)'), borderRadius: 8, padding: '8px 12px', cursor: 'pointer' }}>
                    {killedIds.includes(acc.id)
                      ? <span style={{ fontSize: 12, color: 'var(--sem-short)' }}>⛔</span>
                      : <input type="checkbox" checked={checked} onChange={() => setSelKill(p => p.includes(acc.id) ? p.filter(id => id !== acc.id) : [...p, acc.id])} style={{ width: 14, height: 14, accentColor: 'var(--sem-short)', cursor: 'pointer' }} />}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ox-glow)' }}>{acc.nickname || acc.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--gs-muted)' }}>{acc.broker === 'zerodha' ? 'Zerodha' : 'Angel One'}</div>
                    </div>
                    {killedIds.includes(acc.id)
                      ? <span className="chip chip-error" style={{ fontSize: 9 }}>KILLED</span>
                      : checked ? <span className="chip chip-error" style={{ fontSize: 9 }}>WILL KILL</span> : null}
                  </label>
                )
              })}
            </div>
            <div style={{ background: 'rgba(255,68,68,0.07)', border: '0.5px solid rgba(255,68,68,0.25)', borderRadius: 8, padding: '8px 12px', marginBottom: 16, fontSize: 11, color: 'var(--sem-short)', fontWeight: 600 }}>
              ⚠️ This will square off all positions + cancel all orders. Cannot be undone.
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setKillModal(false)} disabled={killLoading}>Cancel</button>
              <button className="btn btn-danger" onClick={handleKill} disabled={killLoading} style={{ minWidth: 160 }}>{killLoading ? 'Activating…' : 'Activate Kill Switch'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
