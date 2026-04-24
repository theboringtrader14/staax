import { useEffect, useRef, useState } from 'react'
import { Warning, Prohibit, ProhibitInset, CheckCircle, XCircle } from '@phosphor-icons/react'
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
  running: '#0ea66e', stopped: 'var(--text-mute)', starting: '#b45309', stopping: '#b45309',
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
      ? { background: 'var(--bg)', color: '#FF4444', boxShadow: 'var(--neu-raised-sm)' }
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
function todayIST(): string {
  return new Date().toLocaleDateString('sv', { timeZone: 'Asia/Kolkata' })
}
function offsetDate(base: string, days: number): string {
  const d = new Date(base + 'T00:00:00+05:30')
  d.setDate(d.getDate() + days)
  return d.toLocaleDateString('sv', { timeZone: 'Asia/Kolkata' })
}
function fmtLogDate(d: string): string {
  return new Date(d + 'T00:00:00+05:30').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })
}

export default function DashboardPanel() {
  const isDashboardOpen    = useStore(s => s.isDashboardOpen)
  const setIsDashboardOpen = useStore(s => s.setIsDashboardOpen)
  const accounts           = useStore(s => s.accounts)
  const setAccounts        = useStore(s => s.setAccounts)

  const [services, setServices]             = useState<Service[]>(INIT_SERVICES)
  const [health, setHealth]                 = useState<any>(null)
  const [log, setLog]                       = useState<string[]>(['STAAX ready.'])
  const [loginSucceeded, setLoginSucceeded] = useState<Record<string, boolean>>({})
  const [logDate, setLogDate]               = useState<string>(todayIST())

  const [showKillConfirm, setKillModal]  = useState(false)
  const [killActivated, setKillActived]  = useState(false)
  const [killLoading, setKillLoading]    = useState(false)
  const [killResult, setKillResult]      = useState<{positions_squared:number;orders_cancelled:number;errors:string[]}|null>(null)
  const [selKill, setSelKill]            = useState<string[]>([])
  const [killedIds, setKilledIds]        = useState<string[]>([])
  const [lateWarning, setLateWarning]    = useState(false)

  type LogLevel = 'ok' | 'err' | 'wrn' | 'inf'
  const addLog = (msg: string, lvl: LogLevel = 'inf') => {
    const ts = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    setLog(l => ['[' + ts + '] [' + lvl + '] ' + msg, ...l.slice(0, 49)])
  }
  const setSvc   = (id: string, st: ServiceStatus) => setServices(s => s.map(x => x.id === id ? { ...x, status: st } : x))
  const startSvc = async (id: string) => { setSvc(id,'starting'); addLog('Starting '+id+'…'); try { await servicesAPI.start(id); setSvc(id,'running'); addLog(id+' running', 'ok') } catch { setSvc(id,'stopped'); addLog(id+' failed', 'err') } }
  const stopSvc  = async (id: string) => { setSvc(id,'stopping'); addLog('Stopping '+id+'…'); try { await servicesAPI.stop(id); setSvc(id,'stopped'); addLog(id+' stopped', 'err') } catch { setSvc(id,'running'); addLog('Error stopping '+id) } }

  const doStartAll = async () => {
    setLateWarning(false); addLog('Starting all services…')
    try {
      await servicesAPI.startAll()
      addLog('All services running.', 'ok')
      const res = await servicesAPI.status()
      setServices(p => p.map(s => { const rem = (res.data.services as Service[]).find(r => r.id === s.id); return rem ? { ...s, status: rem.status } : s }))
    } catch { addLog('Start all failed', 'err') }
  }
  const startAll = async () => { if (isPast9am()) { setLateWarning(true); return }; await doStartAll() }
  const stopAll  = async () => {
    addLog('Stopping all services…')
    try { await servicesAPI.stopAll(); addLog('All services stopped.') }
    catch { addLog('Error stopping services') }
  }

  const handleKill = async () => {
    setKillLoading(true); addLog('KILL SWITCH ACTIVATED', 'wrn')
    try {
      const res = await systemAPI.activateKillSwitch(selKill)
      const d = res.data
      setKillActived(true)
      setKilledIds(p => Array.from(new Set([...p, ...(selKill.length > 0 ? selKill : (accounts as any[]).map((a:any) => a.id))])))
      setKillResult({ positions_squared: d.positions_squared ?? 0, orders_cancelled: d.orders_cancelled ?? 0, errors: d.errors ?? [] })
      addLog('[CRITICAL] KILL — ' + (d.positions_squared ?? 0) + ' pos, ' + (d.orders_cancelled ?? 0) + ' orders', 'err')
    } catch (err: any) { addLog('Kill failed — ' + (err?.response?.data?.detail || 'unknown'), 'err') }
    finally { setKillLoading(false); setKillModal(false) }
  }

  const refetchHealth = () => systemAPI.health().then(r => setHealth(r.data)).catch(() => {})

  useEffect(() => { accountsAPI.list().then(res => setAccounts(res.data)).catch(() => {}) }, [])

  const logFailures   = useRef(0)
  const logIntervalMs = useRef(5000)
  const logTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const logDateRef    = useRef(logDate)
  useEffect(() => { logDateRef.current = logDate }, [logDate])

  useEffect(() => {
    if (logTimerRef.current) clearTimeout(logTimerRef.current)
    logFailures.current   = 0
    logIntervalMs.current = 5000

    const fetchLogs = async () => {
      try {
        const res = await eventsAPI.list(100, logDateRef.current)
        const entries: any[] = res.data || []
        const lines: string[] = []
        for (const e of entries) {
          const ts = e.ts ? new Date(e.ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '--:--:--'
          const lvl: LogLevel = e.level === 'success' ? 'ok' : e.level === 'error' ? 'err' : e.level === 'warn' ? 'wrn' : 'inf'
          lines.push('[' + ts + '] [' + lvl + '] ' + (e.source ? '[' + e.source + '] ' : '') + e.msg)
        }
        if (lines.length === 0) lines.push('No events for this date.')
        setLog([...lines])
        if (logFailures.current > 0) { logFailures.current = 0; logIntervalMs.current = 5000 }
      } catch (e) {
        if (logFailures.current === 0) console.warn('[DashboardPanel] log fetch failed', e)
        logFailures.current += 1
        if (logFailures.current >= 3) logIntervalMs.current = 30000
      }
      // Only poll for today; past dates are static
      if (logDateRef.current === todayIST()) {
        logTimerRef.current = setTimeout(fetchLogs, logIntervalMs.current)
      }
    }
    fetchLogs()
    return () => { if (logTimerRef.current) clearTimeout(logTimerRef.current) }
  }, [logDate])

  useEffect(() => { refetchHealth(); const t = setInterval(refetchHealth, 30000); return () => clearInterval(t) }, [])

  useEffect(() => {
    systemAPI.killSwitchStatus().then(res => {
      if (res.data?.activated) setKillActived(true)
      if (res.data?.killed_account_ids?.length) setKilledIds(res.data.killed_account_ids)
    }).catch(() => {})
  }, [])

  const svcFailures   = useRef(0)
  const svcIntervalMs = useRef(5000)
  const svcTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await servicesAPI.status()
        setServices(prev => prev.map(s => { const rem = (res.data.services as Service[]).find(r => r.id === s.id); return rem ? { ...s, status: rem.status } : s }))
        // Reset backoff on success
        if (svcFailures.current > 0) {
          svcFailures.current = 0
          svcIntervalMs.current = 5000
        }
      } catch (e) {
        if (svcFailures.current === 0) console.warn('[DashboardPanel] services poll failed', e)
        svcFailures.current += 1
        if (svcFailures.current >= 3) svcIntervalMs.current = 30000
      }
      svcTimerRef.current = setTimeout(poll, svcIntervalMs.current)
    }
    poll()
    return () => { if (svcTimerRef.current) clearTimeout(svcTimerRef.current) }
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
  const overallColor = overallState === 'green' ? '#0ea66e' : overallState === 'amber' ? '#b45309' : '#FF4444'
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
      <style>{`
        @keyframes dotPulse {
          0%, 100% { transform: scale(1);    opacity: 1;   }
          50%       { transform: scale(1.45); opacity: 0.6; }
        }
      `}</style>
      {/* Blur backdrop — starts below TopNav so nav stays visible */}
      <div
        onClick={() => setIsDashboardOpen(false)}
        style={{
          position: 'fixed', inset: 0, zIndex: 199,
          backdropFilter: isDashboardOpen ? 'blur(8px)' : 'blur(0px)',
          WebkitBackdropFilter: isDashboardOpen ? 'blur(8px)' : 'blur(0px)',
          background: isDashboardOpen ? 'rgba(0,0,0,0.06)' : 'rgba(0,0,0,0)',
          pointerEvents: isDashboardOpen ? 'auto' : 'none',
          transition: 'backdrop-filter 0.25s ease, background 0.25s ease',
        }}
      />

      {/* Panel — sits flush below the TopNav pill, seamless via shared background */}
      <div style={{
        position: 'fixed',
        top: 88,
        right: 20,
        width: 420,
        maxHeight: 'calc(100vh - 108px)',
        zIndex: 322,
        borderRadius: 20,
        background: 'var(--bg)',
        boxShadow: 'var(--neu-raised-lg)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        opacity: isDashboardOpen ? 1 : 0,
        pointerEvents: isDashboardOpen ? 'auto' : 'none',
        transition: 'opacity 0.15s ease',
      }}>

        {/* ── Header ── */}
        <div style={{
          flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px',
          borderBottom: '0.5px solid var(--border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: overallColor, boxShadow: `0 0 8px ${overallColor}`, flexShrink: 0, animation: 'dotPulse 2.2s ease-in-out infinite' }} />
            <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>System Monitor</span>
            <span style={{ fontSize: 10, color: overallColor, fontWeight: 600 }}>· {statusLabel}</span>
          </div>
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
          <NeuBtn onClick={startAll} disabled={allRunning} style={{ flex: 1, color: 'var(--accent)', fontWeight: 600 }}>
            Start
          </NeuBtn>
        </div>

        {/* ── Scrollable body ── */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>

          {/* Kill result banner */}
          {killActivated && killResult && (
            <div style={{ padding: '12px 16px', borderBottom: '0.5px solid var(--border)' }}>
              <div style={{ background: 'rgba(255,68,68,0.08)', borderRadius: 12, padding: '10px 12px', boxShadow: 'var(--neu-inset)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#FF4444', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 4 }}><Prohibit size={14} weight="fill" color="#FF4444" /> Kill Switch Activated</div>
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
                <div style={{ fontSize: 12, fontWeight: 700, color: '#b45309', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Warning size={14} weight="fill" color="#b45309" /> After 9:00 AM
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 10 }}>Some algos may have passed entry time. Start anyway?</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <NeuBtn onClick={() => setLateWarning(false)} style={{ flex: 1, height: 28 }}>Cancel</NeuBtn>
                  <NeuBtn onClick={doStartAll} style={{ flex: 1, height: 28, color: 'var(--accent)', fontWeight: 600 }}>Start Anyway</NeuBtn>
                </div>
              </div>
            </div>
          )}

          {/* ── System Health ── */}
          <div style={{ padding: '14px 16px', borderBottom: '0.5px solid var(--border)' }}>
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 9, letterSpacing: '0.15em', color: 'var(--text-mute)', fontWeight: 700, textTransform: 'uppercase' }}>
                System Health
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {healthChips.map((chip) => {
                const dotColor = chip.state === 'green' ? '#0ea66e' : chip.state === 'red' ? '#FF4444' : '#b45309'
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
                return (
                  <div key={acc.id} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '10px 8px', borderRadius: 14, background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)' }}>
                    {/* Name */}
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', textAlign: 'center' }}>{acc.nickname || acc.name}</div>
                    {/* Broker */}
                    <div style={{ fontSize: 9, color: 'var(--text-mute)', textAlign: 'center' }}>{isZerodha ? 'Zerodha' : 'Angel One'}</div>
                    {/* Status chip or Login button */}
                    {isLive
                      ? <span style={{ marginTop: 'auto', padding: '2px 8px', borderRadius: 20, fontSize: 9, fontWeight: 600, background: 'var(--bg)', boxShadow: 'var(--neu-inset)', color: '#0ea66e' }}>Live</span>
                      : <NeuBtn onClick={async () => {
                          if (isZerodha) {
                            const w = 520, h = 640, left = window.screenX + (window.outerWidth - w) / 2, top = window.screenY + (window.outerHeight - h) / 2
                            window.open(`${API_BASE}/api/v1/zerodha/login`, 'zerodha_oauth', `width=${w},height=${h},left=${left},top=${top},toolbar=0,menubar=0,location=0,status=0`)
                          } else {
                            const res = await fetch(`${API_BASE}/api/v1/accounts/${acc.id}/login`, { method: 'POST' })
                            if (res.ok) setLoginSucceeded(prev => ({ ...prev, [acc.id]: true }))
                          }
                        }} style={{ height: 24, fontSize: 9, padding: '0 8px', marginTop: 'auto' }}>
                          Login
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
                  <span style={{ padding: '3px 8px', borderRadius: 20, fontSize: 9, fontWeight: 600, fontFamily: 'Inter, sans-serif', background: 'var(--bg)', boxShadow: 'var(--neu-inset)', color: svc.status === 'running' ? '#0ea66e' : 'var(--text-mute)', flexShrink: 0 }}>
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
            {/* Label row with date nav */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: 9, letterSpacing: '0.15em', color: 'var(--text-mute)', fontWeight: 700, textTransform: 'uppercase' as const }}>
                Engine Log
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {/* Prev day */}
                <button onClick={() => setLogDate(d => offsetDate(d, -1))} style={{
                  width: 22, height: 22, borderRadius: '50%', border: 'none', cursor: 'pointer',
                  background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)',
                  fontSize: 11, color: 'var(--text-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>‹</button>
                {/* Date pill — always visible; neu-inset; click on past date jumps to today */}
                <span
                  onClick={logDate !== todayIST() ? () => setLogDate(todayIST()) : undefined}
                  style={{
                    height: 22, padding: '0 8px', borderRadius: 100,
                    background: 'var(--bg)', boxShadow: 'var(--neu-inset)',
                    fontSize: 10, fontWeight: 600, fontFamily: 'var(--font-mono)',
                    color: logDate !== todayIST() ? 'var(--accent)' : 'var(--text-mute)',
                    cursor: logDate !== todayIST() ? 'pointer' : 'default',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    userSelect: 'none',
                  }}
                >
                  {logDate === todayIST() ? 'Today' : fmtLogDate(logDate)}
                </span>
                {/* Next day — always rendered, disabled on today */}
                <button onClick={() => setLogDate(d => offsetDate(d, 1))} disabled={logDate >= todayIST()} style={{
                  width: 22, height: 22, borderRadius: '50%', border: 'none',
                  cursor: logDate >= todayIST() ? 'not-allowed' : 'pointer',
                  background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)',
                  fontSize: 11, color: logDate >= todayIST() ? 'var(--text-mute)' : 'var(--text-dim)',
                  opacity: logDate >= todayIST() ? 0.3 : 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>›</button>
              </div>
            </div>
            <div style={{ borderRadius: 14, background: 'var(--bg)', boxShadow: 'var(--neu-inset)', overflow: 'hidden', padding: '10px 0' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, padding: '0 12px', height: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                {dedupeLog(log).map((line, i) => {
                  const isSep = line.startsWith('──')
                  if (isSep) return (
                    <div key={i} style={{ color: 'rgba(255,107,0,0.3)', textAlign: 'center', fontSize: 9, padding: '3px 0', margin: '2px 0' }}>{line}</div>
                  )
                  // Parse structured format: [HH:MM:SS] [lvl] rest
                  const m = line.match(/^(\[\d{2}:\d{2}:\d{2}\])\s+\[(ok|err|wrn|inf)\]\s+(.*)$/)
                  if (m) {
                    const [, stamp, lvl, rest] = m
                    const col = lvl === 'ok' ? '#0ea66e' : lvl === 'err' ? '#FF5555' : lvl === 'wrn' ? '#b45309' : 'var(--text-mute)'
                    const ico = lvl === 'ok'  ? <CheckCircle size={10} weight="fill" color="#0ea66e" style={{ flexShrink: 0, marginTop: 2 }} />
                              : lvl === 'err' ? <XCircle     size={10} weight="fill" color="#FF5555" style={{ flexShrink: 0, marginTop: 2 }} />
                              : lvl === 'wrn' ? <Warning     size={10} weight="fill" color="#b45309" style={{ flexShrink: 0, marginTop: 2 }} />
                              : null
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 4, lineHeight: 1.6, padding: '0.5px 0' }}>
                        <span style={{ color: 'var(--text-mute)', flexShrink: 0 }}>{stamp}</span>
                        <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0, width: 12 }}>
                          {ico ?? <span style={{ color: 'var(--text-mute)' }}>·</span>}
                        </span>
                        <span style={{ color: col }}>{rest}</span>
                      </div>
                    )
                  }
                  // Fallback (e.g. 'STAAX ready.' init line)
                  return (
                    <div key={i} style={{ color: 'var(--text-mute)', lineHeight: 1.6, padding: '0.5px 0' }}>{line}</div>
                  )
                })}
              </div>
            </div>
          </div>

        </div>{/* end scrollable body */}
      </div>

      {/* ── Kill Switch Modal ── */}
      {showKillConfirm && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1200,
          backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
          background: 'rgba(0,0,0,0.18)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'var(--bg)',
            boxShadow: 'var(--neu-raised-lg), 0 0 40px rgba(255,68,68,0.12)',
            borderRadius: 24, padding: 24,
            minWidth: 340, maxWidth: 480, width: '90%',
          }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FF4444" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
              <span style={{ fontWeight: 800, fontSize: 17, fontFamily: 'var(--font-display)', color: '#FF4444' }}>Kill Switch</span>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 16, lineHeight: 1.6 }}>
              Select accounts to kill. Uncheck any you want to leave running.
            </p>

            {/* Account list */}
            <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {displayAccounts.map((acc: any) => {
                const checked = selKill.includes(acc.id)
                const killed = killedIds.includes(acc.id)
                return (
                  <div key={acc.id}
                    onClick={() => !killed && setSelKill(p => p.includes(acc.id) ? p.filter(id => id !== acc.id) : [...p, acc.id])}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      background: 'var(--bg)',
                      boxShadow: checked ? 'var(--neu-inset)' : 'var(--neu-raised-sm)',
                      borderRadius: 14, padding: '10px 14px', cursor: killed ? 'default' : 'pointer',
                      transition: 'box-shadow 0.15s',
                    }}>
                    {killed
                      ? <ProhibitInset size={18} weight="fill" color="#FF4444" style={{ flexShrink: 0 }} />
                      : <div style={{
                          width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                          background: 'var(--bg)',
                          boxShadow: checked ? 'var(--neu-inset)' : 'var(--neu-raised-sm)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {checked && <div style={{ width: 8, height: 8, borderRadius: 2, background: '#FF4444' }} />}
                        </div>}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{acc.nickname || acc.name}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-mute)' }}>{acc.broker === 'zerodha' ? 'Zerodha' : 'Angel One'}</div>
                    </div>
                    {killed
                      ? <span style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)', borderRadius: 100, padding: '3px 10px', fontSize: 9, fontWeight: 700, fontFamily: 'var(--font-display)', letterSpacing: '0.5px', color: '#FF4444', flexShrink: 0 }}>KILLED</span>
                      : checked
                      ? <span style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)', borderRadius: 100, padding: '3px 10px', fontSize: 9, fontWeight: 700, fontFamily: 'var(--font-display)', letterSpacing: '0.5px', color: '#FF4444', flexShrink: 0 }}>WILL KILL</span>
                      : null}
                  </div>
                )
              })}
            </div>

            {/* Warning */}
            <div style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)', borderRadius: 12, padding: '10px 14px', marginBottom: 18, fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <Warning size={14} weight="fill" color="#FF4444" style={{ flexShrink: 0, marginTop: 1 }} />
              <span><span style={{ color: '#FF4444', fontWeight: 700 }}>Warning: </span>
              This will square off all positions + cancel all orders. Cannot be undone.</span>
            </div>

            {/* Actions */}
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
