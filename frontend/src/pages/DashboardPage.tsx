import { useStore } from '@/store'
import { useState, useEffect } from 'react'
import { servicesAPI, accountsAPI, systemAPI, eventsAPI, holidaysAPI, gridAPI, ordersAPI } from '@/services/api'

type ServiceStatus = 'running' | 'stopped' | 'starting' | 'stopping'
interface Service { id: string; name: string; status: ServiceStatus; detail: string }

const INIT_SERVICES: Service[] = [
  { id: 'db',      name: 'PostgreSQL',  status: 'stopped', detail: 'localhost:5432'       },
  { id: 'redis',   name: 'Redis',       status: 'stopped', detail: 'localhost:6379'       },
  { id: 'backend', name: 'Backend API', status: 'stopped', detail: 'http://localhost:8000' },
  { id: 'ws',      name: 'Market Feed', status: 'stopped', detail: 'NSE live tick data'   },
]

const STATUS_COLOR: Record<ServiceStatus, string> = {
  running: '#10b981', stopped: 'rgba(232,232,248,0.25)',
  starting: '#f59e0b', stopping: '#f59e0b',
}
const STATUS_BG: Record<ServiceStatus, string> = {
  running: 'rgba(16,185,129,0.08)', stopped: 'rgba(255,255,255,0.02)',
  starting: 'rgba(245,158,11,0.08)', stopping: 'rgba(245,158,11,0.08)',
}

const STAT_DEFS = [
  { label: 'Active Algos',   key: 'active_algos',   accent: '#6366f1', format: (v: number) => String(v) },
  { label: 'Open Positions', key: 'open_positions',  accent: '#10b981', format: (v: number) => String(v) },
  { label: 'Today P&L',      key: 'today_pnl',       accent: '#10b981', format: (v: number) => `${v >= 0 ? '+' : ''}₹${Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` },
  { label: 'FY P&L',         key: 'fy_pnl',          accent: '#a78bfa', format: (v: number) => `${v >= 0 ? '+' : ''}₹${Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` },
]

// ── RadialRing — SVG arc progress indicator ────────────────────
function RadialRing({ pct, color, size = 56, strokeWidth = 3.5 }: {
  pct: number; color: string; size?: number; strokeWidth?: number
}) {
  const r = (size - strokeWidth * 2) / 2
  const circ = 2 * Math.PI * r
  const filled = (Math.min(Math.max(pct, 0), 100) / 100) * circ
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }} aria-hidden>
      <circle cx={size/2} cy={size/2} r={r} fill="none"
        stroke={`${color}28`} strokeWidth={strokeWidth} />
      <circle cx={size/2} cy={size/2} r={r} fill="none"
        stroke={color} strokeWidth={strokeWidth}
        strokeDasharray={`${filled} ${circ - filled}`}
        strokeLinecap="round"
        style={{ filter:`drop-shadow(0 0 4px ${color})`, transition:'stroke-dasharray 0.8s ease' }}
      />
    </svg>
  )
}


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
  const [stats, setStats]                     = useState<Record<string, number>>({})
  const [log, setLog]                         = useState<string[]>(['STAAX Dashboard ready.'])
  const [zerodhaConnected, setZerodhaConnected] = useState(false)
  const [showLateWarning, setShowLateWarning] = useState(false)
  const [holidays, setHolidays]                   = useState<any[]>([])
  const [syncingHolidays, setSyncingHolidays]     = useState(false)
  const [showKillConfirm, setShowKillConfirm]     = useState(false)
  const [killActivated, setKillActivated]         = useState(false)
  const [killLoading, setKillLoading]             = useState(false)
  const [killResult, setKillResult]               = useState<{ positions_squared: number; orders_cancelled: number; errors: string[]; per_account?: Record<string, { positions_squared: number; orders_cancelled: number }> } | null>(null)
  const [selectedKillAccounts, setSelectedKillAccounts] = useState<string[]>([])
  const [killedAccountIds, setKilledAccountIds]         = useState<string[]>([])
  const [now, setNow]                                   = useState(new Date())
  const [todayGrid, setTodayGrid]                       = useState<any>([])
  const [health, setHealth]                             = useState<any>(null)
  const [healthCollapsed, setHealthCollapsed]           = useState(false)
  const [recentOrders, setRecentOrders]                 = useState<any[]>([])

  // 1s tick for Xm Ys countdown accuracy
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // Fetch today's grid entries for Next Algo card
  useEffect(() => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
    const fetch = () => {
      gridAPI.list({ week_start: today, week_end: today, is_practix: isPractixMode })
        .then(r => setTodayGrid(r.data?.entries || r.data?.groups || r.data || []))
        .catch(() => {})
    }
    fetch()
    const t = setInterval(fetch, 30000)
    return () => clearInterval(t)
  }, [isPractixMode])

  // Load accounts on mount + derive zerodha token state
  useEffect(() => {
    accountsAPI.list()
      .then(res => {
        setAccounts(res.data)
        const zerodha = (res.data || []).find((a: any) => a.broker === 'zerodha')
        if (zerodha?.token_valid_today) setZerodhaConnected(true)
      })
      .catch(() => {}) // backend may not be up yet
  }, [])

  // Load dashboard stats on mount (active algos, open positions, P&L)
  useEffect(() => {
    systemAPI.stats(isPractixMode)
      .then(res => setStats(res.data))
      .catch(() => {})
  }, [isPractixMode])

  // Pre-populate System Log from persisted event_log on mount
  useEffect(() => {
    eventsAPI.list(50)
      .then(res => {
        const entries: any[] = res.data || []
        // Today's date in IST as YYYY-MM-DD — 'sv' locale gives ISO format in the given tz
        const todayStr = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Kolkata' })

        // Build lines newest-first — entries arrive newest-first from API, iterate as-is
        const lines: string[] = []
        let lastDateSep = ''
        for (const e of entries) {
          const eventDate = e.ts ? new Date(e.ts).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' }) : null
          // Use 'sv' locale for YYYY-MM-DD in IST — avoids UTC vs IST date mismatch
          const eventDay  = e.ts ? new Date(e.ts).toLocaleDateString('sv', { timeZone: 'Asia/Kolkata' }) : todayStr
          // Insert separator when we encounter events from a new older day
          if (eventDay !== todayStr && eventDate && eventDay !== lastDateSep) {
            lines.push(`── ${eventDate} ──`)
            lastDateSep = eventDay
          }
          const ts   = e.ts
            ? new Date(e.ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
            : '--:--:--'
          const src  = e.source ? `[${e.source}] ` : ''
          const icon = e.level === 'success' ? '✅' : e.level === 'error' ? '⛔' : e.level === 'warn' ? '⚠️' : '·'
          lines.push(`[${ts}] ${icon} ${src}${e.msg}`)
        }
        if (lines.length > 0) {
          setLog(prev => [...lines, ...prev])
        }
      })
      .catch(() => {}) // non-fatal — in-memory log still works
  }, [])

  // Load upcoming holidays
  useEffect(() => {
    holidaysAPI.list(new Date().getFullYear())
      .then(res => {
        const today = new Date()
        const in30 = new Date(today); in30.setDate(today.getDate() + 30)
        const upcoming = (res.data || []).filter((h: any) => {
          const d = new Date(h.date)
          return d >= today && d <= in30 && h.segment === 'fo'
        })
        setHolidays(upcoming.slice(0, 8))
      })
      .catch(() => {})
  }, [])

  const handleSyncHolidays = async () => {
    setSyncingHolidays(true)
    try {
      const res = await holidaysAPI.sync()
      addLog(`✅ Holidays synced — ${res.data.synced} new, ${res.data.skipped} existing`)
      // Refresh list
      const listRes = await holidaysAPI.list(new Date().getFullYear())
      const today = new Date()
      const in30 = new Date(today); in30.setDate(today.getDate() + 30)
      const upcoming = (listRes.data || []).filter((h: any) => {
        const d = new Date(h.date)
        return d >= today && d <= in30 && h.segment === 'fo'
      })
      setHolidays(upcoming.slice(0, 8))
    } catch {
      addLog('⛔ Holiday sync failed — check NSE connectivity')
    } finally {
      setSyncingHolidays(false)
    }
  }

  // Fetch system health every 60s
  useEffect(() => {
    const fetchHealth = () => {
      systemAPI.health()
        .then(res => {
          setHealth(res.data)
          // Auto-expand if any check is not ok
          const checks = res.data?.checks || {}
          const anyFail = Object.entries(checks).some(([_, v]: [string, any]) =>
            typeof v === 'object' && v !== null && v.ok === false
          )
          if (anyFail) setHealthCollapsed(false)
        })
        .catch(() => {})
    }
    fetchHealth()
    const t = setInterval(fetchHealth, 60000)
    return () => clearInterval(t)
  }, [])

  // Fetch recent completed orders for Recent Trades widget + win/loss donut
  useEffect(() => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
    ordersAPI.list(today, isPractixMode)
      .then(r => {
        const completed = (r.data || []).filter((o: any) => o.status === 'complete')
        setRecentOrders(completed.slice(-6).reverse())
      })
      .catch(() => {})
  }, [isPractixMode])

  // Load kill switch state on mount
  useEffect(() => {
    systemAPI.killSwitchStatus()
      .then(res => {
        if (res.data?.activated) setKillActivated(true)
        if (res.data?.killed_account_ids?.length) setKilledAccountIds(res.data.killed_account_ids)
      })
      .catch(() => {})
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
      const res = await systemAPI.activateKillSwitch(selectedKillAccounts)
      const d = res.data
      setKillActivated(true)
      setKilledAccountIds(prev => Array.from(new Set([...prev, ...(selectedKillAccounts.length > 0 ? selectedKillAccounts : accounts.map((a: any) => a.id))])))
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
        const popup = window.open(url, '_blank', 'width=800,height=600')
        addLog('🔑 Zerodha login window opened — complete login in the popup')

        // Listen for postMessage from callback page
        const onMsg = (e: MessageEvent) => {
          if (e.data?.type === 'ZERODHA_TOKEN_SET') {
            setZerodhaConnected(true)
            addLog('✅ Zerodha token set — connected for today')
            window.removeEventListener('message', onMsg)
            if (popup) popup.close()
          }
        }
        window.addEventListener('message', onMsg)

        // Fallback poll — check token status every 3s for up to 3 minutes
        const poll = setInterval(async () => {
          try {
            const r = await accountsAPI.list()
            const zerodha = (r.data || []).find((a: any) => a.broker === 'zerodha')
            if (zerodha?.token_valid_today) {
              setZerodhaConnected(true)
              addLog('✅ Zerodha connected for today')
              clearInterval(poll)
              window.removeEventListener('message', onMsg)
            }
          } catch { /* ignore */ }
        }, 3000)
        setTimeout(() => clearInterval(poll), 180000)
      })
      .catch(() => addLog('⚠️ Could not fetch Zerodha login URL — is backend running?'))
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
            <span style={{fontSize:'10px',fontWeight:700,padding:'2px 6px',borderRadius:'4px',background:isPractixMode?'rgba(215,123,18,0.15)':'rgba(34,197,94,0.12)',color:isPractixMode?'var(--accent-amber)':'var(--green)',border:isPractixMode?'1px solid rgba(215,123,18,0.3)':'1px solid rgba(34,197,94,0.25)'}}>
              {isPractixMode?'PRACTIX':'LIVE'}
            </span>
          </p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-danger" onClick={() => { setSelectedKillAccounts(accounts.map((a: any) => a.id).filter((id: string) => !killedAccountIds.includes(id))); setShowKillConfirm(true) }} disabled={(killActivated && killedAccountIds.length >= accounts.length) || killLoading}
            style={{ fontSize:'12px', position:'relative', background: killActivated ? 'rgba(239,68,68,0.15)' : undefined, color: killActivated ? 'var(--red)' : undefined, border: killActivated ? '1px solid rgba(239,68,68,0.4)' : undefined }}>
            ⚡ {(killActivated && killedAccountIds.length >= accounts.length) ? 'Kill Switch Activated' : killedAccountIds.length > 0 ? `Kill Switch (${accounts.length - killedAccountIds.length} left)` : 'Kill Switch'}
          </button>
          <button className="btn btn-ghost" onClick={stopAll} disabled={allStopped}>⛔ Stop All</button>
          <button className="btn btn-primary" onClick={startAll} disabled={allRunning}>▶ Start Session</button>

        </div>
      </div>

      {/* Task 2 — LIVE mode blocked on localhost */}
      {!isPractixMode && typeof window !== 'undefined' && window.location.hostname === 'localhost' && (
        <div style={{
          background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)',
          borderRadius: '8px', padding: '10px 16px', marginBottom: '12px',
          fontSize: '12px', color: 'var(--accent-amber)', fontWeight: 600,
        }}>
          ⚠️ LIVE mode blocked on local — deploy to production server for live trading.
        </div>
      )}

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
            ? <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No algos affected.</div>
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

      {/* Morning Checklist — System Health */}
      {health && (() => {
        const c = health.checks || {}
        const allReady = health.status === 'ready'
        const isCollapsed = healthCollapsed && allReady

        const CHECKLIST = [
          { key: 'database',         label: 'Database connected' },
          { key: 'redis',            label: 'Redis running' },
          { key: 'broker_karthik_ao',label: 'Karthik AO token valid' },
          { key: 'broker_mom_ao',    label: 'Mom AO token valid' },
          { key: 'broker_wife_ao',   label: 'Wife AO token valid' },
          { key: 'broker_zerodha',   label: 'Zerodha token valid' },
          { key: 'smartstream',      label: 'Market Feed (SmartStream) connected' },
          { key: 'scheduler',        label: 'Scheduler running' },
        ]

        const headerColor  = allReady ? '#10b981' : '#f59e0b'
        const headerBg     = allReady ? 'rgba(16,185,129,0.06)' : 'rgba(245,158,11,0.06)'
        const headerBorder = allReady ? 'rgba(16,185,129,0.25)' : 'rgba(245,158,11,0.3)'
        const headerGlow   = allReady ? '0 0 20px rgba(16,185,129,0.15)' : '0 0 20px rgba(245,158,11,0.1)'

        return (
          <div style={{ background: headerBg, border: `1px solid ${headerBorder}`, borderRadius: '10px', marginBottom: '12px', backdropFilter: 'blur(20px)', boxShadow: headerGlow }}>
            {/* Header row */}
            <div
              onClick={() => setHealthCollapsed(p => !p)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', cursor: 'pointer' }}
            >
              <span style={{ fontWeight: 700, fontSize: '12px', color: headerColor }}>
                {allReady ? '✅ System Ready' : '⚠️ System Not Ready'}
                <span style={{ fontWeight: 400, fontSize: '11px', color: 'var(--text-muted)', marginLeft: '8px' }}>
                  {health.timestamp ? new Date(health.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}
                </span>
              </span>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button
                  onClick={e => { e.stopPropagation(); systemAPI.health().then(r => setHealth(r.data)).catch(() => {}) }}
                  style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)', color: 'var(--indigo)', borderRadius: '6px', padding: '3px 10px', fontSize: '11px', cursor: 'pointer', fontWeight: 600, letterSpacing: '0.04em', fontFamily: 'inherit' }}
                >
                  Refresh
                </button>
              </div>
            </div>

            {/* Checklist body */}
            {!isCollapsed && (
              <div style={{ padding: '0 14px 12px', display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '6px' }}>
                {CHECKLIST.map(({ key, label }) => {
                  const v = c[key]
                  const ok = typeof v === 'object' ? v?.ok === true : false
                  return (
                    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: ok ? '#10b981' : '#ef4444' }}>
                      <span>{ok ? '✅' : '❌'}</span>
                      <span>{label}</span>
                      {typeof v === 'object' && v?.latency_ms !== undefined && (
                        <span style={{ color: 'var(--text-dim)', fontSize: '10px' }}>{v.latency_ms}ms</span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })()}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '12px', marginBottom: '12px' }}>
        {STAT_DEFS.map(s => {
          const raw = stats[s.key]
          const display = raw != null ? s.format(raw) : '—'
          const isPnl = s.key === 'today_pnl' || s.key === 'fy_pnl'
          const color = isPnl && raw != null ? (raw >= 0 ? '#10b981' : '#ef4444') : s.accent
          const glowRgb = isPnl && raw != null ? (raw >= 0 ? '16,185,129' : '239,68,68') : (
            s.accent === '#6366f1' ? '99,102,241' : s.accent === '#10b981' ? '16,185,129' : '167,139,250'
          )
          const cardBoxShadow = `inset 0 1px 0 rgba(${glowRgb},0.3), 0 0 24px rgba(${glowRgb},0.14), 0 0 48px rgba(${glowRgb},0.07)`
          // Ring pct: utilization for counts, health for P&L
          const ringPct = s.key === 'active_algos'
            ? (raw != null ? Math.min((raw / Math.max((algos as any[]).length, 1)) * 100, 100) : 0)
            : s.key === 'open_positions'
            ? (raw != null ? Math.min(raw / 10 * 100, 100) : 0)
            : isPnl
            ? (raw != null ? (raw >= 0 ? 82 : 28) : 0)
            : 60
          // Sub-label
          const sub = s.key === 'active_algos'
            ? `of ${(algos as any[]).length} algos`
            : s.key === 'open_positions'
            ? 'open lots'
            : isPnl && raw != null
            ? (raw >= 0 ? '▲ Profit' : '▼ Loss')
            : ''
          return (
            <div key={s.label} className="card card-stat" style={{
              borderTop: `2px solid ${color}`,
              paddingTop: '14px',
              overflow: 'hidden',
              boxShadow: cardBoxShadow,
              borderColor: `rgba(${glowRgb},0.45)`,
              minHeight: '110px',
              '--stat-rgb': glowRgb,
            } as React.CSSProperties}>
              {/* faint accent glow in bg */}
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '70px', background: `linear-gradient(to bottom, rgba(${glowRgb},0.08), transparent)`, pointerEvents: 'none' }} />
              <div style={{ fontSize: '10px', color: 'rgba(232,232,248,0.5)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px', fontWeight: 600 }}>{s.label}</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                <div>
                  <div style={{
                    fontSize: '30px', fontWeight: 800,
                    fontFamily: "'DM Mono', monospace",
                    letterSpacing: '-0.02em',
                    color: color,
                    textShadow: `0 0 20px rgba(${glowRgb},0.55), 0 0 40px rgba(${glowRgb},0.25)`,
                    lineHeight: 1,
                  }}>{display}</div>
                  {sub && <div style={{ fontSize: '10px', color: `rgba(${glowRgb},0.7)`, marginTop: '5px', fontWeight: 600 }}>{sub}</div>}
                </div>
                <RadialRing pct={ringPct} color={color} size={52} strokeWidth={3.5} />
              </div>
            </div>
          )
        })}
      </div>

      {/* Next Algo + Holidays — two-card row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>

        {/* Left: Next Algo countdown */}
        <div className="card" style={{ borderLeft: '2px solid rgba(99,102,241,0.4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#6366f1', boxShadow: '0 0 8px #6366f1', animation: 'glowPulse 2s infinite', flexShrink: 0 }} />
            <div style={{ fontSize: '10px', fontWeight: 700, color: 'rgba(232,232,248,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Next Algo</div>
          </div>
          {(() => {
            const istStr = now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
            const [h, m, s] = istStr.split(':').map(Number)
            const nowSecs = h * 3600 + m * 60 + s
            const marketOpen  = 9 * 3600
            const marketClose = 15 * 3600 + 30 * 60
            if (nowSecs < marketOpen || nowSecs > marketClose) {
              return <div style={{ fontSize: '13px', color: 'rgba(232,232,248,0.25)', fontStyle: 'italic' }}>Market closed</div>
            }
            const algoMap = new Map((algos as any[]).map((a: any) => [a.id, a]))
            const waiting = (Array.isArray(todayGrid) ? todayGrid : []).filter((e: any) => e.status === 'waiting' && e.entry_time)
              .map(e => {
                const algo = algoMap.get(e.algo_id)
                const [eh, em] = (e.entry_time as string).split(':').map(Number)
                return { name: algo?.name || e.algo_name || 'Unknown', entrySecs: eh * 3600 + em * 60, entry_time: e.entry_time as string }
              })
              .filter(x => x.entrySecs > nowSecs)
              .sort((a, b) => a.entrySecs - b.entrySecs)
            if (waiting.length === 0) {
              return <div style={{ fontSize: '13px', color: 'rgba(232,232,248,0.25)', fontStyle: 'italic' }}>No algos scheduled today</div>
            }
            const next = waiting[0]
            const diff = next.entrySecs - nowSecs
            const mins = Math.floor(diff / 60)
            const secs = diff % 60
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{
                  fontSize: '16px', fontWeight: 700,
                  background: 'linear-gradient(135deg, #e8e8f8, #a78bfa)',
                  WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
                }}>{next.name}</div>
                <div style={{ fontSize: '11px', color: 'rgba(232,232,248,0.4)' }}>Entry {next.entry_time}</div>
                <div style={{
                  fontSize: '22px', fontWeight: 700, color: '#f59e0b',
                  fontVariantNumeric: 'tabular-nums', fontFamily: "'DM Mono', monospace",
                  textShadow: '0 0 16px rgba(245,158,11,0.6)',
                  letterSpacing: '-0.02em',
                }}>
                  {mins}m {String(secs).padStart(2, '0')}s
                </div>
                {waiting.length > 1 && (
                  <div style={{ fontSize: '10px', color: 'rgba(232,232,248,0.3)', marginTop: '2px' }}>
                    +{waiting.length - 1} more scheduled
                  </div>
                )}
              </div>
            )
          })()}
        </div>

        {/* Right: Upcoming Holidays */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <div style={{ fontSize: '10px', fontWeight: 600, color: 'rgba(232,232,248,0.5)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Upcoming Holidays (F&O)
            </div>
            <button
              className="btn btn-ghost"
              style={{ fontSize: '10px', padding: '0 10px', height: '24px' }}
              onClick={handleSyncHolidays}
              disabled={syncingHolidays}
            >
              {syncingHolidays ? 'Syncing…' : 'Sync NSE'}
            </button>
          </div>
          {holidays.length === 0 ? (
            <div style={{ fontSize: '12px', color: 'var(--text-dim)', fontStyle: 'italic' }}>
              No F&O holidays in the next 30 days — or sync to load from NSE.
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {holidays.map((h: any) => {
                const d   = new Date(h.date)
                const day = d.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' })
                const dt  = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' })
                return (
                  <div key={h.id} style={{
                    display: 'flex', flexDirection: 'column', gap: '2px',
                    padding: '6px 12px', borderRadius: '6px',
                    background: 'rgba(245,158,11,0.08)',
                    border: '1px solid rgba(245,158,11,0.2)',
                    minWidth: '110px',
                  }}>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--accent-amber)' }}>{dt} · {day}</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{h.description}</div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

      </div>

      {/* ── Recent Trades + Services + System Log ─────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>

        {/* Recent Trades */}
        <div className="card card-violet" style={{ padding: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#a78bfa', boxShadow: '0 0 6px #a78bfa', flexShrink: 0 }} />
            <div style={{ fontSize: '10px', fontWeight: 700, color: 'rgba(232,232,248,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Recent Trades · Today</div>
          </div>
          {recentOrders.length === 0 ? (
            <div style={{ fontSize: '12px', color: 'rgba(232,232,248,0.25)', fontStyle: 'italic', paddingTop: '8px' }}>
              No completed trades today
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {recentOrders.map((o: any, i: number) => {
                const pnl     = o.pnl ?? 0
                const isWin   = pnl > 0
                const pnlStr  = `${pnl >= 0 ? '+' : ''}₹${Math.abs(pnl).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
                const entryTs = o.entry_time ? new Date(o.entry_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '--:--'
                const algoName = o.algo_name || o.algo?.name || 'Unknown'
                const side    = (o.direction || o.side || '').toUpperCase()
                return (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '7px 10px', borderRadius: '6px',
                    background: isWin ? 'rgba(16,185,129,0.06)' : 'rgba(239,68,68,0.06)',
                    border: `1px solid ${isWin ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'}`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{
                        width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0,
                        background: isWin ? '#10b981' : '#ef4444',
                        boxShadow: `0 0 4px ${isWin ? '#10b981' : '#ef4444'}`,
                      }} />
                      <div>
                        <div style={{ fontSize: '11px', fontWeight: 600, color: '#e8e8f8' }}>{algoName}</div>
                        <div style={{ fontSize: '9px', color: 'rgba(232,232,248,0.35)', marginTop: '1px' }}>
                          {side && <span style={{ color: side === 'BUY' ? '#6366f1' : '#a78bfa', fontWeight: 700 }}>{side} · </span>}
                          {entryTs}
                        </div>
                      </div>
                    </div>
                    <div style={{
                      fontSize: '12px', fontWeight: 700, fontFamily: "'DM Mono', monospace",
                      color: isWin ? '#10b981' : '#ef4444',
                      textShadow: `0 0 8px ${isWin ? 'rgba(16,185,129,0.4)' : 'rgba(239,68,68,0.4)'}`,
                    }}>{pnlStr}</div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="card">
          <div style={{ fontSize: '10px', fontWeight: 600, color: 'rgba(232,232,248,0.5)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '12px' }}>Services</div>
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
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '1px' }}>{svc.detail}</div>
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

        <div className="card" style={{ background: 'rgba(5,5,16,0.8)', border: '1px solid rgba(99,102,241,0.15)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981', boxShadow: '0 0 6px #10b981' }} />
            <div style={{ fontSize: '10px', fontWeight: 700, color: 'rgba(232,232,248,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>System Log</div>
          </div>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: '11px', height: '280px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px', padding: '8px', background: '#020208', borderRadius: '6px', border: '1px solid rgba(99,102,241,0.1)' }}>
            {log.map((line, i) => {
              const isSep = line.startsWith('──')
              return (
                <div key={i} style={isSep ? {
                  color: 'rgba(99,102,241,0.35)', textAlign: 'center', fontSize: '10px',
                  letterSpacing: '0.06em', padding: '2px 0', userSelect: 'none',
                } : {
                  color: line.includes('✅') ? '#10b981'
                       : line.includes('⛔') ? '#ef4444'
                       : line.includes('⚠️') ? '#f59e0b'
                       : line.includes('Starting') || line.includes('Stopping') ? '#f59e0b'
                       : 'rgba(232,232,248,0.45)',
                  lineHeight: '1.6',
                }}>
                  {line}
                </div>
              )
            })}
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
            <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--red)', marginBottom: '4px' }}>
              ⚡ Kill Switch
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '14px' }}>
              Select accounts to kill. Uncheck any you want to leave running.
            </div>

            {/* Account checkboxes */}
            <div style={{ marginBottom: '14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {accounts.map((acc: any) => {
                const checked = selectedKillAccounts.includes(acc.id)
                return (
                  <label key={acc.id} style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    background: killedAccountIds.includes(acc.id) ? 'rgba(239,68,68,0.06)' : checked ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${killedAccountIds.includes(acc.id) ? 'rgba(239,68,68,0.25)' : checked ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.08)'}`,
                    borderRadius: '6px', padding: '8px 12px', cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}>
                    {killedAccountIds.includes(acc.id) ? (
                      <span style={{ fontSize: '12px', color: 'var(--red)', fontWeight: 700 }}>⚡</span>
                    ) : (
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setSelectedKillAccounts(prev =>
                            prev.includes(acc.id)
                              ? prev.filter((id: string) => id !== acc.id)
                              : [...prev, acc.id]
                          )
                        }}
                        style={{ width: '14px', height: '14px', accentColor: 'var(--red)', cursor: 'pointer' }}
                      />
                    )}
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#fff' }}>{acc.nickname || acc.name}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{acc.broker === 'zerodha' ? 'Zerodha' : 'Angel One'} · {acc.segment || 'F&O'}</div>
                    </div>
                    {killedAccountIds.includes(acc.id) ? <span style={{ marginLeft: 'auto', fontSize: '10px', color: 'var(--red)', fontWeight: 700, opacity: 0.6 }}>KILLED</span> : checked ? <span style={{ marginLeft: 'auto', fontSize: '10px', color: 'var(--red)', fontWeight: 700 }}>KILL</span> : null}
                  </label>
                )
              })}
              {accounts.length === 0 && (
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '8px' }}>
                  No active accounts found
                </div>
              )}
            </div>

            <div style={{
              background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
              borderRadius: '6px', padding: '8px 12px', marginBottom: '16px',
              fontSize: '11px', color: 'var(--red)', fontWeight: 600,
            }}>
              ⚠️ This will square off all positions + cancel all orders for selected accounts. Cannot be undone.
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
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
            <span style={{ fontSize: '16px' }}>⚡</span>
            <div style={{ fontWeight: 700, color: 'var(--red)', fontSize: '13px' }}>
              Kill Switch Activated — {killedAccountIds.length} account(s) terminated
            </div>
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            {killResult.positions_squared} position(s) squared off &nbsp;·&nbsp;
            {killResult.orders_cancelled} order(s) cancelled
            {killResult.errors.length > 0 && (
              <span style={{ color: 'var(--accent-amber)', marginLeft: '8px' }}>
                ⚠️ {killResult.errors.length} error(s) — check system log
              </span>
            )}
          </div>
        </div>
      )}

      {/* Account Status */}
      <div className="card">
        <div style={{ fontSize: '10px', fontWeight: 600, color: 'rgba(232,232,248,0.5)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '12px' }}>Account Status</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '12px' }}>
          {(accounts.length > 0 ? accounts : [
            { id: '1', nickname: 'Karthik', broker: 'zerodha'  as any, client_id: '', status: 'active'       as any },
            { id: '2', nickname: 'Mom',     broker: 'angelone' as any, client_id: '', status: 'active'       as any },
            { id: '3', nickname: 'Wife',    broker: 'angelone' as any, client_id: '', status: 'disconnected' as any },
          ]).map((acc) => {
            const brokerLabel = acc.broker === 'zerodha' ? 'Zerodha' : 'Angel One'
            const isActive = (acc as any).token_valid_today === true
            const accColor = isActive ? '#10b981' : '#f59e0b'
            const accRgb = isActive ? '16,185,129' : '245,158,11'
            return (
              <div key={acc.id} style={{
                background: `rgba(${accRgb},0.05)`,
                borderRadius: '8px', padding: '12px',
                borderLeft: `3px solid ${accColor}`,
                border: `1px solid rgba(${accRgb},0.25)`,
                borderLeftWidth: '3px',
                boxShadow: isActive
                  ? `inset 3px 0 12px rgba(16,185,129,0.1), 0 0 16px rgba(16,185,129,0.12), inset 0 1px 0 rgba(16,185,129,0.15)`
                  : `inset 3px 0 8px rgba(245,158,11,0.08), 0 0 10px rgba(245,158,11,0.08)`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <div style={{ fontWeight: 700, fontSize: '13px' }}>{acc.nickname}</div>
                      {killedAccountIds.includes(acc.id) && (
                        <span style={{
                          fontSize: '9px', fontWeight: 700, color: 'var(--red)',
                          background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)',
                          borderRadius: '4px', padding: '1px 5px', letterSpacing: '0.5px',
                        }}>⚡ KILLED</span>
                      )}
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '1px' }}>{brokerLabel}</div>
                  </div>
                  <span style={{
                    fontSize: '10px', fontWeight: 600, padding: '2px 8px', borderRadius: '10px',
                    color: isActive ? '#10b981' : '#f59e0b',
                    background: isActive ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)',
                    border: isActive ? '1px solid rgba(16,185,129,0.3)' : '1px solid rgba(245,158,11,0.3)',
                    boxShadow: isActive ? '0 0 8px rgba(16,185,129,0.2)' : 'none',
                  }}>
                    {isActive ? '● Live' : '⚠ Login'}
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
