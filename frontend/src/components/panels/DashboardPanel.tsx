import { useEffect, useRef, useState } from 'react'
import { X, ArrowClockwise } from '@phosphor-icons/react'
import { useStore } from '@/store'
import { servicesAPI, accountsAPI, systemAPI, eventsAPI } from '@/services/api'

// ── Types ──────────────────────────────────────────────────────
type ServiceStatus = 'running' | 'stopped' | 'starting' | 'stopping'
interface Service { id: string; name: string; status: ServiceStatus; detail: string }

const INIT_SERVICES: Service[] = [
  { id: 'db',      name: 'PostgreSQL',  status: 'stopped', detail: 'localhost:5432' },
  { id: 'redis',   name: 'Redis',       status: 'stopped', detail: 'localhost:6379' },
  { id: 'backend', name: 'Backend API', status: 'stopped', detail: 'http://localhost:8000' },
  { id: 'ws',      name: 'Market Feed', status: 'stopped', detail: 'NSE live tick data' },
]

const SVC_DOT: Record<ServiceStatus, string> = {
  running: '#22DD88', stopped: 'var(--text-mute)', starting: '#FFD700', stopping: '#FFD700',
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

// ── Neumorphic button helper ───────────────────────────────────
function NeuBtn({ children, onClick, disabled, accent, danger, style: extraStyle }: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  accent?: boolean
  danger?: boolean
  style?: React.CSSProperties
}) {
  const base: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    height: 32, padding: '0 14px', borderRadius: 100,
    border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: 11, fontWeight: 600, fontFamily: 'Inter, sans-serif',
    transition: 'box-shadow 0.12s, opacity 0.12s',
    opacity: disabled ? 0.45 : 1,
    ...(accent
      ? { background: 'var(--accent)', color: '#fff', boxShadow: 'var(--neu-raised-sm)' }
      : danger
      ? { background: 'rgba(255,68,68,0.15)', color: '#FF4444', boxShadow: 'var(--neu-raised-sm)' }
      : { background: 'var(--bg)', color: 'var(--text-dim)', boxShadow: 'var(--neu-raised-sm)' }),
    ...extraStyle,
  }
  const ref = useRef<HTMLButtonElement>(null)
  return (
    <button
      ref={ref}
      style={base}
      disabled={disabled}
      onClick={onClick}
      onMouseDown={() => { if (!disabled && ref.current) ref.current.style.boxShadow = 'var(--neu-inset)' }}
      onMouseUp={() => { if (ref.current) ref.current.style.boxShadow = accent ? 'var(--neu-raised-sm)' : danger ? 'var(--neu-raised-sm)' : 'var(--neu-raised-sm)' }}
      onMouseLeave={() => { if (ref.current) ref.current.style.boxShadow = 'var(--neu-raised-sm)' }}
    >
      {children}
    </button>
  )
}

// ── Component ──────────────────────────────────────────────────
export default function DashboardPanel() {
  const isDashboardOpen    = useStore(s => s.isDashboardOpen)
  const setIsDashboardOpen = useStore(s => s.setIsDashboardOpen)
  const accounts           = useStore(s => s.accounts)
  const setAccounts        = useStore(s => s.setAccounts)

  const [services, setServices]             = useState<Service[]>(INIT_SERVICES)
  const [health, setHealth]                 = useState<any>(null)
  const [log, setLog]                       = useState<string[]>(['STAAX ready.'])
  const [loginSucceeded, setLoginSucceeded] = useState<Record<string, boolean>>({})

  const [showKillConfirm, setKillModal]  = useState(false)
  const [killActivated, setKillActived]  = useState(false)
  const [killLoading, setKillLoading]    = useState(false)
  const [killResult, setKillResult]      = useState<{positions_squared:number;orders_cancelled:number;errors:string[]}|null>(null)
  const [selKill, setSelKill]            = useState<string[]>([])
  const [killedIds, setKilledIds]        = useState<string[]>([])
  const [lateWarning, setLateWarning]    = useState(false)

  const addLog = (msg: string) => {
    const ts = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    setLog(l => ['[' + ts + '] ' + msg, ...l.slice(0, 49)])
  }
  const setSvc   = (id: string, st: ServiceStatus) => setServices(s => s.map(x => x.id === id ? { ...x, status: st } : x))
  const startSvc = async (id: string) => { setSvc(id,'starting'); addLog('Starting '+id+'…'); try { await servicesAPI.start(id); setSvc(id,'running'); addLog('✅ '+id+' running') } catch { setSvc(id,'stopped'); addLog('⛔ '+id+' failed') } }
  const stopSvc  = async (id: string) => { setSvc(id,'stopping'); addLog('Stopping '+id+'…'); try { await servicesAPI.stop(id); setSvc(id,'stopped'); addLog('⛔ '+id+' stopped') } catch { setSvc(id,'running'); addLog('Error stopping '+id) } }

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

  useEffect(() => { accountsAPI.list().then(res => setAccounts(res.data)).catch(() => {}) }, [])

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

  useEffect(() => { refetchHealth(); const t = setInterval(refetchHealth, 30000); return () => clearInterval(t) }, [])

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
    poll(); const t = setInterval(poll, 5000); return () => clearInterval(t)
  }, [])

  // ── Derived ───────────────────────────────────────────────────
  const IST_OFFSET = 5.5 * 60 * 60 * 1000
  const nowIST = new Date(Date.now() + IST_OFFSET - new Date().getTimezoneOffset() * 60000)
  const day = nowIST.getUTCDay()
  const minsNow = nowIST.getUTCHours() * 60 + nowIST.getUTCMinutes()
  const isMarketHours: boolean = health?.is_market_hours ?? (day >= 1 && day <= 5 && minsNow >= (9*60+15) && minsNow <= (15*60+30))

  const ssData = health?.checks?.smartstream
  const ssConnected = (ssData?.connected || ssData?.ok) ?? false
  const criticalRed = !(health?.checks?.database?.ok ?? false) || !(health?.checks?.redis?.ok ?? false) || !(health?.checks?.scheduler?.ok ?? false) || (isMarketHours && !ssConnected)
  const smartstreamAmber = !isMarketHours && !ssConnected
  const overallState: 'green' | 'amber' | 'red' = !health ? 'amber' : criticalRed ? 'red' : smartstreamAmber ? 'amber' : 'green'
  const overallColor = overallState === 'green' ? '#22DD88' : overallState === 'amber' ? '#FFD700' : '#FF4444'
  const statusLabel  = !health ? 'Loading…' : criticalRed ? 'Not Ready' : smartstreamAmber ? 'Feed Inactive' : 'System Ready'

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

  const sectionLabel = (text: string) => (
    <div style={{ fontSize: 9, letterSpacing: '0.15em', color: 'var(--text-mute)', fontWeight: 700, textTransform: 'uppercase' as const, marginBottom: 8 }}>
      {text}
    </div>
  )

  // ── Render ────────────────────────────────────────────────────
  return (
    <>
      {/* Blur backdrop — covers full page */}
      <div
        onClick={() => setIsDashboardOpen(false)}
        style={{
          position: 'fixed', inset: 0, zIndex: 199,
          backdropFilter: isDashboardOpen ? 'blur(6px)' : 'blur(0px)',
          WebkitBackdropFilter: isDashboardOpen ? 'blur(6px)' : 'blur(0px)',
          background: isDashboardOpen ? 'rgba(0,0,0,0.08)' : 'rgba(0,0,0,0)',
          pointerEvents: isDashboardOpen ? 'auto' : 'none',
          transition: 'backdrop-filter 0.25s ease, background 0.25s ease',
        }}
      />

      {/* Panel — drops from below the TopNav, clipped at bottom with margin */}
      <div style={{
        position: 'fixed',
        top: 82,       /* below the sticky nav pill (20px wrapper + ~48px pill + 14px gap) */
        right: 20,     /* matches TopNav side margin */
        width: 475,
        maxHeight: 'calc(100vh - 110px)', /* clip before the bottom */
        zIndex: 200,
        borderRadius: 20,
        background: 'var(--bg)',
        boxShadow: 'var(--neu-raised-lg)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        opacity: isDashboardOpen ? 1 : 0,
        transform: isDashboardOpen ? 'translateY(0) scale(1)' : 'translateY(-12px) scale(0.97)',
        pointerEvents: isDashboardOpen ? 'auto' : 'none',
        transition: 'opacity 0.22s ease, transform 0.22s ease',
        transformOrigin: 'top right',
      }}>

        {/* ── Header ── */}
        <div style={{
          flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px',
          borderBottom: '0.5px solid var(--border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: overallColor, boxShadow: `0 0 8px ${overallColor}`, flexShrink: 0 }} />
            <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>System Monitor</span>
            <span style={{ fontSize: 10, color: overallColor, fontWeight: 600 }}>· {statusLabel}</span>
          </div>
          <button
            onClick={() => setIsDashboardOpen(false)}
            style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--bg)', border: 'none', color: 'var(--text-dim)', cursor: 'pointer',
              borderRadius: '50%', boxShadow: 'var(--neu-raised-sm)', transition: 'box-shadow 0.12s' }}
            onMouseDown={e => { e.currentTarget.style.boxShadow = 'var(--neu-inset)' }}
            onMouseUp={e => { e.currentTarget.style.boxShadow = 'var(--neu-raised-sm)' }}
            onMouseLeave={e => { e.currentTarget.style.boxShadow = 'var(--neu-raised-sm)' }}
          >
            <X size={13} weight="bold" />
          </button>
        </div>

        {/* ── Action bar: Kill Switch > Stop All > Start ── */}
        <div style={{ flexShrink: 0, padding: '10px 16px', display: 'flex', gap: 8, borderBottom: '0.5px solid var(--border)' }}>
          <NeuBtn danger
            onClick={() => { setSelKill(displayAccounts.map((a:any) => a.id).filter((id: string) => !killedIds.includes(id))); setKillModal(true) }}
            disabled={(killActivated && killedIds.length >= accounts.length) || killLoading}
            style={{ flex: 2 }}
          >
            {killActivated && killedIds.length >= accounts.length ? 'Killed' : 'Kill Switch'}
          </NeuBtn>
          <NeuBtn onClick={stopAll} disabled={allStopped} style={{ flex: 1 }}>
            Stop All
          </NeuBtn>
          <NeuBtn accent onClick={startAll} disabled={allRunning} style={{ flex: 1 }}>
            Start
          </NeuBtn>
        </div>

        {/* ── Scrollable body ── */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>

          {/* Kill result banner */}
          {killActivated && killResult && (
            <div style={{ padding: '12px 16px', borderBottom: '0.5px solid var(--border)' }}>
              <div style={{ background: 'rgba(255,68,68,0.08)', borderRadius: 12, padding: '10px 12px', boxShadow: 'var(--neu-inset)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#FF4444', marginBottom: 2 }}>⛔ Kill Switch Activated</div>
                <div style={{ fontSize: 10, color: 'var(--text-mute)', fontFamily: 'var(--font-mono)' }}>
                  {killResult.positions_squared} pos squared · {killResult.orders_cancelled} orders cancelled
                </div>
              </div>
            </div>
          )}

          {/* Late warning */}
          {lateWarning && (
            <div style={{ padding: '12px 16px', borderBottom: '0.5px solid var(--border)' }}>
              <div style={{ background: 'var(--bg)', borderRadius: 12, padding: '12px', boxShadow: 'var(--neu-inset)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#FF4444', marginBottom: 4 }}>⚠️ After 9:00 AM</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 10 }}>Some algos may have passed entry time. Start anyway?</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <NeuBtn onClick={() => setLateWarning(false)} style={{ flex: 1, height: 28 }}>Cancel</NeuBtn>
                  <NeuBtn danger onClick={doStartAll} style={{ flex: 1, height: 28 }}>Start Anyway</NeuBtn>
                </div>
              </div>
            </div>
          )}

          {/* ── System Health ── */}
          <div style={{ padding: '14px 16px', borderBottom: '0.5px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontSize: 9, letterSpacing: '0.15em', color: 'var(--text-mute)', fontWeight: 700, textTransform: 'uppercase' }}>
                System Health
              </div>
              <button onClick={refetchHealth}
                style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--bg)', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', boxShadow: 'var(--neu-raised-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'box-shadow 0.12s' }}
                onMouseDown={e => { e.currentTarget.style.boxShadow = 'var(--neu-inset)' }}
                onMouseUp={e => { e.currentTarget.style.boxShadow = 'var(--neu-raised-sm)' }}
                onMouseLeave={e => { e.currentTarget.style.boxShadow = 'var(--neu-raised-sm)' }}
                title="Refresh Health"
              >
                <ArrowClockwise size={11} weight="bold" />
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {healthChips.map(chip => {
                const dotColor = chip.state === 'green' ? '#22DD88' : chip.state === 'red' ? '#FF4444' : '#FFD700'
                const statusText = chip.state === 'amber' ? 'inactive' : chip.ok ? 'ok' : 'down'
                return (
                  <div key={chip.label} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 12px', borderRadius: 12,
                    background: 'var(--bg)', boxShadow: 'var(--neu-inset)',
                  }}>
                    <div style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: dotColor, boxShadow: `0 0 6px ${dotColor}55` }} />
                    <div>
                      <div style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-mute)', lineHeight: 1.3 }}>{chip.label}</div>
                      <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600, color: dotColor }}>{statusText}</div>
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
                      <div key={acc.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderRadius: 12, background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)' }}>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{acc.nickname || acc.name}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-mute)' }}>{isZerodha ? 'Zerodha' : 'Angel One'} · needs login</div>
                        </div>
                        <NeuBtn accent={!succeeded} onClick={() => {
                          if (isZerodha) {
                            const w = 520, h = 640, left = window.screenX + (window.outerWidth - w) / 2, top = window.screenY + (window.outerHeight - h) / 2
                            window.open(`${API_BASE}/api/v1/zerodha/login`, 'zerodha_oauth', `width=${w},height=${h},left=${left},top=${top},toolbar=0,menubar=0,location=0,status=0`)
                          } else {
                            fetch(`${API_BASE}/api/v1/accounts/${acc.id}/login`, { method: 'POST' }).then(() => { setLoginSucceeded(p => ({ ...p, [acc.id]: true })); refetchHealth() }).catch(() => {})
                          }
                        }} style={{ height: 26, fontSize: 10, padding: '0 10px', flexShrink: 0 }}>
                          {succeeded ? 'Re-Login' : 'Login'}
                        </NeuBtn>
                      </div>
                    )
                  })}
                </div>
              )
            })()}

          </div>

          {/* ── Account Status — single row ── */}
          <div style={{ padding: '14px 16px', borderBottom: '0.5px solid var(--border)' }}>
            {sectionLabel('Account Status')}
            <div style={{ display: 'flex', gap: 8 }}>
              {dashboardAccounts.map((acc: any) => {
                const isZerodha = acc.broker === 'zerodha'
                const zerodhaOk = health?.checks?.broker_zerodha?.ok ?? false
                const angeloneOk: boolean = isZerodha ? false : (health?.checks?.['broker_angelone_' + acc.id]?.token_valid ?? acc.token_valid_today ?? false)
                const isLive: boolean = isZerodha ? zerodhaOk : angeloneOk
                const succeeded = loginSucceeded[acc.id] ?? false
                return (
                  <div key={acc.id} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '10px 8px', borderRadius: 14, background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)' }}>
                    {/* Status dot */}
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: isLive ? '#22DD88' : 'var(--text-mute)', boxShadow: isLive ? '0 0 6px #22DD8888' : 'none' }} />
                    {/* Name */}
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', textAlign: 'center' }}>{acc.nickname || acc.name}</div>
                    {/* Broker */}
                    <div style={{ fontSize: 9, color: 'var(--text-mute)', textAlign: 'center' }}>{isZerodha ? 'Zerodha' : 'Angel One'}</div>
                    {/* Status / action */}
                    {isLive
                      ? <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 9, fontWeight: 600, background: 'var(--bg)', boxShadow: 'var(--neu-inset)', color: '#22DD88' }}>Live</span>
                      : <NeuBtn accent onClick={async () => {
                          if (isZerodha) {
                            const w = 520, h = 640, left = window.screenX + (window.outerWidth - w) / 2, top = window.screenY + (window.outerHeight - h) / 2
                            window.open(`${API_BASE}/api/v1/zerodha/login`, 'zerodha_oauth', `width=${w},height=${h},left=${left},top=${top},toolbar=0,menubar=0,location=0,status=0`)
                          } else {
                            const res = await fetch(`${API_BASE}/api/v1/accounts/${acc.id}/login`, { method: 'POST' })
                            if (res.ok) setLoginSucceeded(prev => ({ ...prev, [acc.id]: true }))
                          }
                        }} style={{ height: 24, fontSize: 9, padding: '0 8px' }}>
                          {succeeded ? 'Re-Login' : 'Login'}
                        </NeuBtn>
                    }
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── Services ── */}
          <div style={{ padding: '14px 16px', borderBottom: '0.5px solid var(--border)' }}>
            {sectionLabel('Services')}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {services.map(svc => (
                <div key={svc.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 12, background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)' }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: SVC_DOT[svc.status], boxShadow: svc.status === 'running' ? `0 0 6px ${SVC_DOT[svc.status]}88` : 'none', transition: 'background 0.3s' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)' }}>{svc.name}</div>
                    <div style={{ fontSize: 9, color: 'var(--text-mute)', fontFamily: 'var(--font-mono)' }}>{svc.detail}</div>
                  </div>
                  {/* Status chip — inset */}
                  <span style={{ padding: '3px 8px', borderRadius: 20, fontSize: 9, fontWeight: 600, fontFamily: 'Inter, sans-serif', background: 'var(--bg)', boxShadow: 'var(--neu-inset)', color: svc.status === 'running' ? '#22DD88' : 'var(--text-mute)', flexShrink: 0 }}>
                    {svc.status}
                  </span>
                  {svc.status === 'stopped'  && (
                    <NeuBtn onClick={() => startSvc(svc.id)} style={{ height: 24, padding: '0 8px', fontSize: 9, flexShrink: 0 }}>Start</NeuBtn>
                  )}
                  {svc.status === 'running'  && (
                    <NeuBtn danger onClick={() => stopSvc(svc.id)} style={{ height: 24, padding: '0 8px', fontSize: 9, flexShrink: 0 }}>Stop</NeuBtn>
                  )}
                  {(svc.status === 'starting' || svc.status === 'stopping') && (
                    <NeuBtn disabled style={{ height: 24, padding: '0 8px', fontSize: 9, flexShrink: 0 }}>{svc.status}…</NeuBtn>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* ── Engine Log ── */}
          <div style={{ padding: '14px 16px 16px' }}>
            {sectionLabel('Engine Log')}
            <div style={{ borderRadius: 14, background: '#0f1117', overflow: 'hidden', padding: '10px 0' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, padding: '0 12px', height: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                {dedupeLog(log).map((line, i) => {
                  const isSep = line.startsWith('──')
                  if (isSep) return (
                    <div key={i} style={{ color: 'rgba(255,107,0,0.3)', textAlign: 'center', fontSize: 9, padding: '3px 0', margin: '2px 0' }}>{line}</div>
                  )
                  const isOk  = line.includes('✅')
                  const isErr = line.includes('⛔')
                  const isWrn = line.includes('⚠')
                  return (
                    <div key={i} style={{ color: isOk ? '#22DD88' : isErr ? '#FF5555' : isWrn ? '#FFD700' : 'rgba(200,210,220,0.55)', lineHeight: 1.6, padding: '0.5px 0' }}>
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
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FF4444" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
              <span style={{ fontWeight: 800, fontSize: 16, fontFamily: 'var(--font-display)', color: '#FF4444' }}>Kill Switch</span>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 14, lineHeight: 1.6 }}>Select accounts to kill. Uncheck any you want to leave running.</p>
            <div style={{ marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {displayAccounts.map((acc: any) => {
                const checked = selKill.includes(acc.id)
                return (
                  <label key={acc.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: checked ? 'rgba(255,68,68,0.06)' : 'var(--bg)', borderRadius: 12, padding: '8px 12px', cursor: 'pointer', boxShadow: checked ? 'var(--neu-inset)' : 'var(--neu-raised-sm)' }}>
                    {killedIds.includes(acc.id)
                      ? <span style={{ fontSize: 12, color: '#FF4444' }}>⛔</span>
                      : <input type="checkbox" checked={checked} onChange={() => setSelKill(p => p.includes(acc.id) ? p.filter(id => id !== acc.id) : [...p, acc.id])} style={{ width: 14, height: 14, accentColor: '#FF4444', cursor: 'pointer' }} />}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{acc.nickname || acc.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-mute)' }}>{acc.broker === 'zerodha' ? 'Zerodha' : 'Angel One'}</div>
                    </div>
                    {killedIds.includes(acc.id)
                      ? <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 9, fontWeight: 600, background: 'var(--bg)', boxShadow: 'var(--neu-inset)', color: '#FF4444' }}>KILLED</span>
                      : checked ? <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 9, fontWeight: 600, color: '#FF4444', background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}>WILL KILL</span> : null}
                  </label>
                )
              })}
            </div>
            <div style={{ background: 'var(--bg)', borderRadius: 12, padding: '10px 14px', marginBottom: 16, fontSize: 11, color: '#FF4444', fontWeight: 600, boxShadow: 'var(--neu-inset)' }}>
              ⚠️ This will square off all positions + cancel all orders. Cannot be undone.
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <NeuBtn onClick={() => setKillModal(false)} disabled={killLoading}>Cancel</NeuBtn>
              <NeuBtn danger onClick={handleKill} disabled={killLoading} style={{ minWidth: 160, padding: '0 16px' }}>
                {killLoading ? 'Activating…' : 'Activate Kill Switch'}
              </NeuBtn>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
