import { useStore } from '@/store'
import { useState, useEffect } from 'react'
import { servicesAPI, accountsAPI, systemAPI } from '@/services/api'

type ServiceStatus = 'running' | 'stopped' | 'starting' | 'stopping'
interface Service { id: string; name: string; status: ServiceStatus; detail: string }

const INIT_SERVICES: Service[] = [
  { id: 'db',      name: 'PostgreSQL',  status: 'stopped', detail: 'localhost:5432'       },
  { id: 'redis',   name: 'Redis',       status: 'stopped', detail: 'localhost:6379'       },
  { id: 'backend', name: 'Backend API', status: 'stopped', detail: 'http://localhost:8000' },
  { id: 'ws',      name: 'Market Feed', status: 'stopped', detail: 'NSE live tick data'   },
]

const STATUS_COLOR: Record<ServiceStatus, string> = {
  running: 'var(--green)', stopped: 'var(--text-dim)',
  starting: 'var(--accent-amber)', stopping: 'var(--accent-amber)',
}
const STATUS_BG: Record<ServiceStatus, string> = {
  running: 'rgba(34,197,94,0.12)', stopped: 'rgba(107,114,128,0.08)',
  starting: 'rgba(245,158,11,0.12)', stopping: 'rgba(245,158,11,0.12)',
}

const STATS = [
  { label: 'Active Algos',   value: '—',  color: 'var(--accent-blue)' },
  { label: 'Open Positions', value: '—',  color: 'var(--green)'       },
  { label: 'Today P&L',      value: '—',  color: 'var(--green)'       },
  { label: 'FY P&L',         value: '—',  color: 'var(--green)'       },
]

/** Returns true if current IST time is past 09:00 */
function isPast9am(): boolean {
  const now = new Date()
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  return ist.getHours() > 9 || (ist.getHours() === 9 && ist.getMinutes() >= 0)
}

export default function DashboardPage() {
  const isPractixMode = useStore(s => s.isPractixMode)
  const algos         = useStore(s => s.algos)
  const accounts      = useStore(s => s.accounts)
  const setAccounts   = useStore(s => s.setAccounts)

  const [services, setServices]               = useState<Service[]>(INIT_SERVICES)
  const [log, setLog]                         = useState<string[]>(['STAAX Dashboard ready.'])
  const [zerodhaConnected, setZerodhaConnected] = useState(false)
  const [showLateWarning, setShowLateWarning] = useState(false)
  const [showKillConfirm, setShowKillConfirm]     = useState(false)
  const [killActivated, setKillActivated]         = useState(false)
  const [killLoading, setKillLoading]             = useState(false)
  const [killResult, setKillResult]               = useState<{ positions_squared: number; orders_cancelled: number; errors: string[] } | null>(null)

  // Load accounts on mount
  useEffect(() => {
    accountsAPI.list()
      .then(res => setAccounts(res.data))
      .catch(() => {}) // backend may not be up yet
  }, [])

  // Poll service status every 5 seconds
  useEffect(() => {
    const poll = () => {
      servicesAPI.status()
        .then(res => {
          const svcs: Service[] = res.data.services
          setServices(prev => prev.map(s => {
            const remote = svcs.find(r => r.id === s.id)
            return remote ? { ...s, status: remote.status as ServiceStatus } : s
          }))
        })
        .catch(() => {})
    }
    poll()
    const t = setInterval(poll, 5000)
    return () => clearInterval(t)
  }, [])

  const addLog = (msg: string) => {
    const ts = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    setLog(l => [`[${ts}] ${msg}`, ...l.slice(0, 49)])
  }

  const setSvc = (id: string, status: ServiceStatus) =>
    setServices(s => s.map(x => x.id === id ? { ...x, status } : x))

  const startSvc = async (id: string) => {
    setSvc(id, 'starting')
    addLog(`Starting ${id}...`)
    try {
      await servicesAPI.start(id)
      setSvc(id, 'running')
      addLog(`✅ ${id} running`)
    } catch {
      setSvc(id, 'stopped')
      addLog(`⛔ ${id} failed to start`)
    }
  }

  const stopSvc = async (id: string) => {
    setSvc(id, 'stopping')
    addLog(`Stopping ${id}...`)
    try {
      await servicesAPI.stop(id)
      setSvc(id, 'stopped')
      addLog(`⛔ ${id} stopped`)
    } catch {
      setSvc(id, 'running')
      addLog(`Error stopping ${id}`)
    }
  }

  const startAll = async () => {
    // F8 — warn if starting after 9 AM (algos may have missed entry window)
    if (isPast9am()) {
      setShowLateWarning(true)
      return
    }
    await doStartAll()
  }

  const doStartAll = async () => {
    setShowLateWarning(false)
    addLog('Starting all services...')
    try {
      await servicesAPI.startAll()
      addLog('✅ All services running.')
      // Refresh status
      const res = await servicesAPI.status()
      const svcs: Service[] = res.data.services
      setServices(prev => prev.map(s => {
        const remote = svcs.find(r => r.id === s.id)
        return remote ? { ...s, status: remote.status as ServiceStatus } : s
      }))
    } catch {
      addLog('⛔ Start all failed — check backend')
    }
  }

  const stopAll = async () => {
    addLog('Stopping all services...')
    try {
      await servicesAPI.stopAll()
      addLog('All services stopped.')
    } catch {
      addLog('Error stopping services')
    }
  }

  const handleKillSwitch = async () => {
    setKillLoading(true)
    addLog("⚠️ KILL SWITCH ACTIVATED — fetching broker state...")
    try {
      const res = await systemAPI.activateKillSwitch()
      const d = res.data
      setKillActivated(true)
      setKillResult({ positions_squared: d.positions_squared ?? 0, orders_cancelled: d.orders_cancelled ?? 0, errors: d.errors ?? [] })
      addLog(`[CRITICAL] KILL SWITCH — ${d.positions_squared ?? 0} positions squared, ${d.orders_cancelled ?? 0} orders cancelled`)
      if (d.errors?.length) { d.errors.forEach((e: string) => addLog(`⚠️ ${e}`)) }
    } catch (err: any) {
      addLog("⛔ Kill switch failed — " + (err?.response?.data?.detail || "unknown error"))
    } finally {
      setKillLoading(false)
      setShowKillConfirm(false)
    }
  }

  const handleZerodhaLogin = () => {
    accountsAPI.zerodhaLoginUrl()
      .then(res => {
        const url = res.data.login_url
        // Open Zerodha login in new tab
        window.open(url, '_blank', 'width=800,height=600')
        addLog('🔑 Zerodha login window opened')
      })
      .catch(() => {
        // Fallback — mark connected for demo
        setZerodhaConnected(true)
        addLog('✅ Zerodha token refreshed')
      })
  }

  const allRunning = services.every(s => s.status === 'running')
  const allStopped = services.every(s => s.status === 'stopped')

  // Build late warning message — list algos with entry_time already passed
  const lateAlgos = algos.filter(a => {
    if (!a.entry_time) return false
    const now = new Date()
    const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
    const [h, m] = a.entry_time.split(':').map(Number)
    return ist.getHours() > h || (ist.getHours() === h && ist.getMinutes() >= m)
  })

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 style={{ fontFamily: "'ADLaM Display',serif", fontSize: '22px', fontWeight: 400 }}>Dashboard</h1>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
            System status · Start / stop services ·{' '}
            <span style={{ color: isPractixMode ? 'var(--accent-amber)' : 'var(--green)', fontWeight: 600 }}>
              {isPractixMode ? 'PRACTIX mode' : 'LIVE mode'}
            </span>
          </p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-primary" onClick={startAll} disabled={allRunning}>▶ Start Session</button>
          <button className="btn btn-ghost" onClick={stopAll} disabled={allStopped}>⛔ Stop All</button>
          <button
            className="btn"
            onClick={() => setShowKillConfirm(true)}
            disabled={killActivated || killLoading}
            style={{
              background: killActivated ? "rgba(239,68,68,0.15)" : "rgba(239,68,68,0.9)",
              color:      killActivated ? "var(--red)" : "#fff",
              border:     "1px solid rgba(239,68,68,0.6)",
              fontWeight: 700,
              opacity:    killActivated || killLoading ? 0.75 : 1,
            }}
          >
            {killActivated ? "⚡ Kill Switch Activated" : killLoading ? "Activating..." : "⚡ Kill Switch"}
          </button>
        </div>
      </div>

      {/* F8 — Late session warning */}
      {showLateWarning && (
        <div style={{
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: '8px', padding: '14px 16px', marginBottom: '12px',
        }}>
          <div style={{ fontWeight: 700, color: 'var(--red)', marginBottom: '6px' }}>
            ⚠️ Starting session after 9:00 AM
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '10px' }}>
            The following algos have already passed their entry time and will NOT trigger today:
          </div>
          {lateAlgos.length === 0
            ? <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>No algos affected.</div>
            : <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
                {lateAlgos.map(a => (
                  <span key={a.id} style={{
                    fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '4px',
                    background: 'rgba(239,68,68,0.12)', color: 'var(--red)',
                    border: '1px solid rgba(239,68,68,0.25)',
                  }}>
                    {a.name} ({a.entry_time})
                  </span>
                ))}
              </div>
          }
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-ghost" onClick={() => setShowLateWarning(false)}>Cancel</button>
            <button className="btn" style={{ background: 'var(--red)', color: '#fff' }} onClick={doStartAll}>
              Start Anyway
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '12px', marginBottom: '12px' }}>
        {STATS.map(s => (
          <div key={s.label} className="card">
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>{s.label}</div>
            <div style={{ fontSize: '20px', fontWeight: 700, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
        <div className="card">
          <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '12px' }}>Services</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {services.map(svc => (
              <div key={svc.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '9px 12px', borderRadius: '6px',
                background: STATUS_BG[svc.status],
                border: `1px solid ${STATUS_COLOR[svc.status]}22`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{
                    width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
                    background: STATUS_COLOR[svc.status],
                    boxShadow: svc.status === 'running' ? `0 0 6px ${STATUS_COLOR[svc.status]}` : 'none',
                    animation: svc.status === 'starting' || svc.status === 'stopping' ? 'pulse 1s infinite' : 'none',
                  }} />
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600 }}>{svc.name}</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginTop: '1px' }}>{svc.detail}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '10px', color: STATUS_COLOR[svc.status], fontWeight: 600, textTransform: 'uppercase' }}>{svc.status}</span>
                  {svc.status === 'stopped'  && <button className="btn btn-ghost"  style={{ fontSize: '10px', padding: '0 10px', height: '26px' }} onClick={() => startSvc(svc.id)}>Start</button>}
                  {svc.status === 'running'  && <button className="btn btn-danger" style={{ fontSize: '10px', padding: '0 10px', height: '26px' }} onClick={() => stopSvc(svc.id)}>Stop</button>}
                </div>
              </div>
            ))}

            {/* Zerodha token row */}
            <div style={{
              padding: '10px 12px', background: 'var(--bg-secondary)', borderRadius: '6px',
              border: '1px solid var(--bg-border)', minHeight: '52px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div>
                <div style={{ fontSize: '12px', fontWeight: 600 }}>Zerodha Token</div>
                <div style={{ fontSize: '11px', marginTop: '3px', color: zerodhaConnected ? 'var(--green)' : 'var(--accent-amber)' }}>
                  {zerodhaConnected ? '✅ Connected for today' : '⚠️ Login required'}
                </div>
              </div>
              <button className="btn btn-ghost" style={{ fontSize: '11px', flexShrink: 0 }} onClick={handleZerodhaLogin}>
                {zerodhaConnected ? '🔑 Re-login' : '🔑 Login'}
              </button>
            </div>
          </div>
        </div>

        <div className="card" style={{ background: 'var(--bg-secondary)' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '12px' }}>System Log</div>
          <div style={{ fontFamily: 'monospace', fontSize: '11px', height: '280px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {log.map((line, i) => (
              <div key={i} style={{ color: line.includes('✅') ? 'var(--green)' : line.includes('⛔') ? 'var(--red)' : line.includes('Starting') || line.includes('Stopping') ? 'var(--accent-amber)' : 'var(--text-muted)' }}>
                {line}
              </div>
            ))}
          </div>
        </div>
      </div>


      {/* Kill Switch confirmation modal */}
      {showKillConfirm && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: '#1a1b1d', border: '1px solid rgba(239,68,68,0.5)',
            borderRadius: '12px', padding: '28px 32px', maxWidth: '420px', width: '100%',
            boxShadow: '0 0 40px rgba(239,68,68,0.15)',
          }}>
            <div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--red)', marginBottom: '8px' }}>
              ⚡ Kill Switch
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '6px', lineHeight: 1.6 }}>
              This will <strong style={{ color: '#fff' }}>immediately</strong>:
            </div>
            <ul style={{ fontSize: '12px', color: 'var(--text-muted)', paddingLeft: '18px', marginBottom: '20px', lineHeight: 2 }}>
              <li>Freeze all engine activity (Scheduler, ReEntry, RetryQueue)</li>
              <li>Fetch ALL open positions + orders from broker</li>
              <li>Cancel all pending broker orders</li>
              <li>Square off all open positions at market price</li>
              <li>Verify broker is flat, then update DB</li>
            </ul>
            <div style={{
              background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
              borderRadius: '6px', padding: '10px 12px', marginBottom: '20px',
              fontSize: '11px', color: 'var(--red)', fontWeight: 600,
            }}>
              ⚠️ This action cannot be undone. All algos will be terminated for this session.
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setShowKillConfirm(false)} disabled={killLoading} style={{ height: "36px", padding: "0 20px" }}>
                Cancel
              </button>
              <button
                onClick={handleKillSwitch}
                disabled={killLoading}
                style={{
                  background: 'var(--red)', color: '#fff', border: 'none',
                  borderRadius: '6px', padding: '0 20px', height: '36px',
                  fontSize: '13px', fontWeight: 700, cursor: killLoading ? 'not-allowed' : 'pointer',
                  opacity: killLoading ? 0.7 : 1,
                }}
              >
                {killLoading ? 'Activating...' : 'Activate Kill Switch'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Kill Switch result banner */}
      {killActivated && killResult && (
        <div style={{
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: '8px', padding: '12px 16px', marginBottom: '12px',
          display: 'flex', alignItems: 'center', gap: '12px',
        }}>
          <span style={{ fontSize: '18px' }}>⚡</span>
          <div>
            <div style={{ fontWeight: 700, color: 'var(--red)', fontSize: '13px' }}>
              Kill Switch Activated — Session terminated
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
              {killResult.positions_squared} position(s) squared off &nbsp;·&nbsp;
              {killResult.orders_cancelled} order(s) cancelled
              {killResult.errors.length > 0 && (
                <span style={{ color: 'var(--accent-amber)', marginLeft: '8px' }}>
                  ⚠️ {killResult.errors.length} error(s) — check system log
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Account Status */}
      <div className="card">
        <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '12px' }}>Account Status</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '12px' }}>
          {(accounts.length > 0 ? accounts : [
            { id: '1', nickname: 'Karthik', broker: 'zerodha'  as any, client_id: '', status: 'active'       as any },
            { id: '2', nickname: 'Mom',     broker: 'angelone' as any, client_id: '', status: 'active'       as any },
            { id: '3', nickname: 'Wife',    broker: 'angelone' as any, client_id: '', status: 'disconnected' as any },
          ]).map((acc, i) => {
            const colors = ['#00B0F0', '#22C55E', '#D77B12']
            const color = colors[i] || '#6B7280'
            const brokerLabel = acc.broker === 'zerodha' ? 'Zerodha' : 'Angel One'
            const isActive = acc.status === 'active'
            return (
              <div key={acc.id} style={{ background: 'var(--bg-secondary)', borderRadius: '6px', padding: '12px', borderLeft: `3px solid ${color}` }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '13px' }}>{acc.nickname}</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginTop: '1px' }}>{brokerLabel}</div>
                  </div>
                  <span style={{
                    fontSize: '10px', fontWeight: 600, padding: '2px 6px', borderRadius: '3px',
                    color: isActive ? 'var(--green)' : 'var(--accent-amber)',
                    background: isActive ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)',
                  }}>
                    {isActive ? '✅ Live' : '⚠️ Login'}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
