import { useStore } from '@/store'
import { useState, useEffect, useRef } from 'react'
import { servicesAPI, accountsAPI, systemAPI, eventsAPI, holidaysAPI, gridAPI, reportsAPI } from '@/services/api'
import { getCurrentFY } from '@/utils/fy'

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


function PnlCard({ label, value, isPositive, sparkId, equityCurve }: { label: string; value: number; isPositive: boolean; sparkId: string; equityCurve?: {month: string; cumulative: number}[] }) {
  const rupee = String.fromCharCode(0x20B9)
  const display = (isPositive ? '+' : '') + rupee + Math.abs(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })
  const col  = isPositive ? 'var(--ox-radiant)' : 'var(--sem-short)'
  const col2 = isPositive ? '#FF6B00' : '#FF4444'
  return (
    <div className="card cloud-fill" style={{ padding: '16px 18px' }}>
      <div className="card-label">{label}</div>
      <div style={{ fontSize: 'clamp(20px,2.2vw,28px)', fontWeight: 800, color: col, fontFamily: 'var(--font-mono)', letterSpacing: '-1px', lineHeight: 1 }}>{display}</div>
      <div style={{ fontSize: '10px', color: isPositive ? 'rgba(255,107,0,0.65)' : 'rgba(255,68,68,0.65)', marginTop: '3px', fontWeight: 600 }}>
        {isPositive ? '▲' : '▼'} {isPositive ? 'Profit' : 'Loss'} · 0.00% ROI
      </div>
      <svg width="100%" height="36" viewBox="0 0 200 36" preserveAspectRatio="none" style={{ marginTop: '10px', display: 'block' }}>
        <defs>
          <linearGradient id={'sg-' + sparkId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={col2} stopOpacity="0.28" />
            <stop offset="100%" stopColor={col2} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Dynamic sparkline */}
        {(() => {
          const pts = (equityCurve || []).map(p => p.cumulative)
          if (pts.length < 2) {
            // fallback static path
            return (
              <>
                <path d="M0,30 C30,28 50,22 80,18 S120,12 150,8 S180,4 200,2 L200,36 L0,36Z" fill={`url(#sg-${sparkId})`} />
                <path d="M0,30 C30,28 50,22 80,18 S120,12 150,8 S180,4 200,2" fill="none" stroke={col2} strokeWidth="1.8" strokeLinecap="round" />
              </>
            )
          }
          const W = 200, H = 36, PAD = 3
          const minV = Math.min(...pts), maxV = Math.max(...pts)
          const range = maxV - minV || 1
          const toX = (i: number) => PAD + (i / (pts.length - 1)) * (W - PAD * 2)
          const toY = (v: number) => H - PAD - ((v - minV) / range) * (H - PAD * 2 - 4)
          const coords = pts.map((v, i) => ({ x: toX(i), y: toY(v) }))
          let line = `M${coords[0].x.toFixed(1)},${coords[0].y.toFixed(1)}`
          for (let i = 1; i < coords.length; i++) {
            const p = coords[i-1], c = coords[i]
            const mx = ((p.x + c.x) / 2).toFixed(1)
            line += ` C${mx},${p.y.toFixed(1)} ${mx},${c.y.toFixed(1)} ${c.x.toFixed(1)},${c.y.toFixed(1)}`
          }
          const area = line + ` L${coords[coords.length-1].x.toFixed(1)},${H} L${coords[0].x.toFixed(1)},${H}Z`
          return (
            <>
              <path d={area} fill={`url(#sg-${sparkId})`} />
              <path d={line} fill="none" stroke={col2} strokeWidth="1.8" strokeLinecap="round" />
            </>
          )
        })()}
      </svg>
    </div>
  )
}

function isPast9am() {
  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  return ist.getHours() > 9 || (ist.getHours() === 9 && ist.getMinutes() >= 15)
}


export default function DashboardPage() {
  const isPractixMode = useStore(s => s.isPractixMode)
  const algos         = useStore(s => s.algos)
  const accounts      = useStore(s => s.accounts)
  const setAccounts   = useStore(s => s.setAccounts)
  const [services, setServices]          = useState<Service[]>(INIT_SERVICES)
  const [stats, setStats]                = useState<Record<string,number>>({})
  const [log, setLog]                    = useState<string[]>(['STAAX Dashboard ready.'])
  const [_zerodhaConnected, setZerodha]   = useState(false)
  const [loginSucceeded, setLoginSucceeded] = useState<Record<string, boolean>>({})
  const [showLateWarning, setLateWarn]   = useState(false)
  const [holidays, setHolidays]          = useState<any[]>([])
  const [syncingHolidays, setSyncing]    = useState(false)
  const [showKillConfirm, setKillModal]  = useState(false)
  const [killActivated, setKillActived]  = useState(false)
  const [killLoading, setKillLoading]    = useState(false)
  const [killResult, setKillResult]      = useState<{positions_squared:number;orders_cancelled:number;errors:string[]}|null>(null)
  const [selKill, setSelKill]            = useState<string[]>([])
  const [killedIds, setKilledIds]        = useState<string[]>([])
  const [now, setNow]                    = useState(new Date())
  const [todayGrid, setTodayGrid]        = useState<any[]>([])
  const [health, setHealth]              = useState<any>(null)
  const [healthCollapsed, setHCollapsed] = useState(false)
  const algoScrollRef                    = useRef<HTMLDivElement>(null)
  const [scrollPos, setScrollPos]        = useState(0)
  const [equityCurveData, setEquityCurveData] = useState<{month: string; cumulative: number}[]>([])

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])
  useEffect(() => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
    const run = () => gridAPI.list({ week_start: today, week_end: today, is_practix: isPractixMode })
      .then(r => setTodayGrid(r.data?.entries || r.data?.groups || r.data || [])).catch(() => {})
    run(); const t = setInterval(run, 30000); return () => clearInterval(t)
  }, [isPractixMode])
  useEffect(() => {
    accountsAPI.list().then(res => {
      setAccounts(res.data)
      const z = (res.data || []).find((a: any) => a.broker === 'zerodha')
      if (z?.token_valid_today) setZerodha(true)
    }).catch(() => {})
  }, [])
  useEffect(() => { systemAPI.stats(isPractixMode).then(r => setStats(r.data)).catch(() => {}) }, [isPractixMode])
  useEffect(() => {
    reportsAPI.equityCurve({ fy: getCurrentFY(), is_practix: isPractixMode })
      .then((r: any) => setEquityCurveData(r.data?.data || []))
      .catch(() => {})
  }, [isPractixMode])
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
    holidaysAPI.list(new Date().getFullYear()).then(res => {
      const today = new Date(); const in30 = new Date(today); in30.setDate(today.getDate() + 30)
      setHolidays((res.data || []).filter((h: any) => { const d = new Date(h.date); return d >= today && d <= in30 && h.segment === 'fo' }).slice(0, 8))
    }).catch(() => {})
  }, [])
  useEffect(() => {
    const run = () => systemAPI.health().then(res => {
      setHealth(res.data)
      const anyFail = Object.values(res.data?.checks || {}).some((v: any) => typeof v === 'object' && v?.ok === false)
      if (anyFail) setHCollapsed(false)
    }).catch(() => {})
    run(); const t = setInterval(run, 60000); return () => clearInterval(t)
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
    poll(); const t = setInterval(poll, 5000); return () => clearInterval(t)
  }, [])


  const addLog = (msg: string) => {
    const ts = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    setLog(l => ['[' + ts + '] ' + msg, ...l.slice(0, 49)])
  }
  const setSvc = (id: string, st: ServiceStatus) => setServices(s => s.map(x => x.id === id ? { ...x, status: st } : x))
  const startSvc = async (id: string) => { setSvc(id,'starting'); addLog('Starting '+id+'...'); try { await servicesAPI.start(id); setSvc(id,'running'); addLog('✅ '+id+' running') } catch { setSvc(id,'stopped'); addLog('⛔ '+id+' failed') } }
  const stopSvc  = async (id: string) => { setSvc(id,'stopping'); addLog('Stopping '+id+'...'); try { await servicesAPI.stop(id); setSvc(id,'stopped'); addLog('⛔ '+id+' stopped') } catch { setSvc(id,'running'); addLog('Error stopping '+id) } }
  const startAll = async () => { if (isPast9am()) { setLateWarn(true); return }; await doStartAll() }
  const doStartAll = async () => {
    setLateWarn(false); addLog('Starting all services...')
    try { await servicesAPI.startAll(); addLog('✅ All services running.'); const res = await servicesAPI.status(); setServices(p => p.map(s => { const rem = (res.data.services as Service[]).find(r => r.id === s.id); return rem ? { ...s, status: rem.status } : s })) }
    catch { addLog('⛔ Start all failed') }
  }
  const stopAll = async () => { addLog('Stopping all services...'); try { await servicesAPI.stopAll(); addLog('All services stopped.') } catch { addLog('Error stopping services') } }
  const handleKill = async () => {
    setKillLoading(true); addLog('⚠️ KILL SWITCH ACTIVATED')
    try {
      const res = await systemAPI.activateKillSwitch(selKill); const d = res.data
      setKillActived(true); setKilledIds(p => Array.from(new Set([...p, ...(selKill.length > 0 ? selKill : (accounts as any[]).map(a => a.id))])))
      setKillResult({ positions_squared: d.positions_squared ?? 0, orders_cancelled: d.orders_cancelled ?? 0, errors: d.errors ?? [] })
      addLog('[CRITICAL] KILL — ' + (d.positions_squared ?? 0) + ' positions, ' + (d.orders_cancelled ?? 0) + ' orders')
    } catch (err: any) { addLog('⛔ Kill switch failed — ' + (err?.response?.data?.detail || 'unknown')) }
    finally { setKillLoading(false); setKillModal(false) }
  }

  const handleSyncHolidays = async () => {
    setSyncing(true)
    try {
      const res = await holidaysAPI.sync(); addLog('✅ Holidays synced — ' + res.data.synced + ' new')
      const lr = await holidaysAPI.list(new Date().getFullYear())
      const today = new Date(); const in30 = new Date(today); in30.setDate(today.getDate() + 30)
      setHolidays((lr.data || []).filter((h: any) => { const d = new Date(h.date); return d >= today && d <= in30 && h.segment === 'fo' }).slice(0, 8))
    } catch { addLog('⛔ Holiday sync failed') } finally { setSyncing(false) }
  }

  const allRunning = services.every(s => s.status === 'running')
  const allStopped = services.every(s => s.status === 'stopped')
  const lateAlgos  = (algos as any[]).filter((a: any) => {
    if (!a.entry_time) return false
    const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
    const [h, m] = a.entry_time.split(':').map(Number)
    return ist.getHours() > h || (ist.getHours() === h && ist.getMinutes() >= m)
  })

  const istStr = now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  const [ih, im, is_] = istStr.split(':').map(Number)
  const nowSecs = ih * 3600 + im * 60 + is_
  const mktOpen = 9 * 3600; const mktClose = 15 * 3600 + 30 * 60
  const algoMap = new Map((algos as any[]).map((a: any) => [a.id, a]))
  const scheduledAlgos = (nowSecs >= mktOpen && nowSecs <= mktClose)
    ? (Array.isArray(todayGrid) ? todayGrid : [])
        .filter((e: any) => e.status === 'waiting' && e.entry_time)
        .map((e: any) => { const [eh,em] = (e.entry_time as string).split(':').map(Number); return { name: (algoMap.get(e.algo_id) as any)?.name || e.algo_name || 'Unknown', secs: eh*3600+em*60, time: e.entry_time as string } })
        .sort((a: any, b: any) => a.secs - b.secs)
    : []
  const nextAlgo = scheduledAlgos.find((a: any) => a.secs > nowSecs)
  const scrollAlgos = (dir: 'left' | 'right') => {
    const el = algoScrollRef.current; if (!el) return
    el.scrollBy({ left: dir === 'right' ? 130 : -130, behavior: 'smooth' })
    setTimeout(() => setScrollPos(el.scrollLeft), 360)
  }

  const todayPnl  = stats['today_pnl'] ?? 0
  const fyPnl     = stats['fy_pnl']    ?? 0
  const fyPnlReal = equityCurveData.length > 0 ? (equityCurveData[equityCurveData.length - 1]?.cumulative ?? fyPnl) : fyPnl

  // ── isMarketHours (component scope, shared by health container + chip row) ──
  const isMarketHours: boolean = health?.is_market_hours ?? (() => {
    const IST_OFFSET = 5.5 * 60 * 60 * 1000
    const nowIST = new Date(Date.now() + IST_OFFSET - new Date().getTimezoneOffset() * 60000)
    const day = nowIST.getUTCDay()
    const h = nowIST.getUTCHours(), m = nowIST.getUTCMinutes()
    const mins = h * 60 + m
    return day >= 1 && day <= 5 && mins >= (9*60+15) && mins <= (15*60+30)
  })()

  // ── overallState for health card container ──
  const criticalRed =
    !(health?.checks?.database?.ok ?? false) ||
    !(health?.checks?.redis?.ok ?? false) ||
    !(health?.checks?.scheduler?.ok ?? false) ||
    (isMarketHours && !(health?.checks?.smartstream?.connected ?? false))

  const smartstreamAmber = !isMarketHours && !(health?.checks?.smartstream?.connected ?? false)

  const overallState: 'green' | 'amber' | 'red' =
    criticalRed ? 'red' : smartstreamAmber ? 'amber' : 'green'

  const containerColor = {
    green: { bg: 'rgba(34,221,136,0.06)',  border: 'rgba(34,221,136,0.35)', glow: 'rgba(34,221,136,0.08)' },
    amber: { bg: 'rgba(255,215,0,0.06)',   border: 'rgba(255,215,0,0.35)',  glow: 'rgba(255,215,0,0.08)'  },
    red:   { bg: 'rgba(255,68,68,0.06)',   border: 'rgba(255,68,68,0.35)',  glow: 'rgba(255,68,68,0.08)'  },
  }[overallState]

  const overallStateColor = overallState === 'green' ? '#22DD88' : overallState === 'amber' ? '#FFD700' : '#FF4444'

  const displayAccounts = (accounts as any[]).length > 0 ? (accounts as any[]) : [
    { id: '1', nickname: 'Karthik',    broker: 'zerodha',  token_valid_today: false },
    { id: '2', nickname: 'Mom',         broker: 'angelone', token_valid_today: false },
    { id: '3', nickname: 'Wife',        broker: 'angelone', token_valid_today: false },
    { id: '4', nickname: 'Karthik AO', broker: 'angelone', token_valid_today: false },
  ]

  return (
    <div style={{ animation: 'fadeUp var(--dur-slow) var(--ease-out) both' }}>

      {/* ── Page header ── */}
      <div className="page-header">
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(22px,2.5vw,34px)', fontWeight: 800, color: 'var(--ox-radiant)', letterSpacing: '-1px', lineHeight: 1.1 }}>Dashboard</h1>
          <p style={{ fontSize: '12px', color: 'var(--gs-muted)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            System status · Start / stop services ·
            <span className={'chip ' + (isPractixMode ? 'chip-warn' : 'chip-success')} style={{ fontSize: '10px', padding: '1px 8px' }}>{isPractixMode ? 'PRACTIX' : 'LIVE'}</span>
          </p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-danger" onClick={() => { setSelKill(displayAccounts.map(a => a.id).filter((id: string) => !killedIds.includes(id))); setKillModal(true) }} disabled={(killActivated && killedIds.length >= accounts.length) || killLoading}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
            {killActivated && killedIds.length >= accounts.length ? 'Kill Switch Activated' : killedIds.length > 0 ? 'Kill (' + (accounts.length - killedIds.length) + ' left)' : 'Kill Switch'}
          </button>
          <button className="btn btn-steel" onClick={stopAll} disabled={allStopped}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>Stop All</button>
          <button className="btn btn-primary" onClick={startAll} disabled={allRunning}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>Start Session</button>
        </div>
      </div>

      {/* LIVE blocked */}
      {!isPractixMode && typeof window !== 'undefined' && window.location.hostname === 'localhost' && (
        <div className="card card-amber" style={{ padding: '10px 16px', marginBottom: '12px', fontSize: '12px', color: 'var(--sem-warn)', fontWeight: 600 }}>
          ⚠️ LIVE mode blocked on local — deploy to production.
        </div>
      )}

      {/* Late warning */}
      {showLateWarning && (
        <div className="card card-violet" style={{ marginBottom: '12px' }}>
          <div style={{ fontWeight: 700, color: 'var(--sem-short)', marginBottom: '6px', fontSize: '13px' }}>⚠️ Starting session after 9:00 AM</div>
          <div style={{ fontSize: '12px', color: 'var(--gs-muted)', marginBottom: '10px' }}>These algos have already passed their entry time:</div>
          {lateAlgos.length === 0 ? <div style={{ fontSize: '12px', color: 'var(--gs-muted)' }}>No algos affected.</div> : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
              {lateAlgos.map((a: any) => <span key={a.id} className="chip chip-error">{a.name} ({a.entry_time})</span>)}
            </div>
          )}
          <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
            <button className="btn btn-ghost" onClick={() => setLateWarn(false)}>Cancel</button>
            <button className="btn btn-danger" onClick={doStartAll}>Start Anyway</button>
          </div>
        </div>
      )}

      {/* Kill result */}
      {killActivated && killResult && (
        <div className="card card-violet" style={{ padding: '12px 16px', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--sem-short)" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
            <span style={{ fontWeight: 700, color: 'var(--sem-short)', fontSize: '12px' }}>Kill Switch Activated — {killedIds.length} account(s) terminated</span>
          </div>
          <div style={{ fontSize: '11px', color: 'var(--gs-muted)', fontFamily: 'var(--font-mono)' }}>
            {killResult.positions_squared} positions squared · {killResult.orders_cancelled} orders cancelled
            {killResult.errors.length > 0 && <span style={{ color: 'var(--sem-warn)', marginLeft: '8px' }}>⚠️ {killResult.errors.length} errors</span>}
          </div>
        </div>
      )}

      {/* ── SYSTEM HEALTH ── */}
      {health && (() => {
        const reason = health.ready_reason || ''
        const criticalDown = reason === 'DB_DOWN' || reason === 'REDIS_DOWN' || reason === 'NO_BROKER_TOKENS'
        const isReady = health.ready === true
        const feedInactive = !health.is_market_hours && health.checks?.smartstream?.ok === false
        const statusLabel = criticalDown ? 'System Not Ready' : feedInactive ? 'Feed Inactive' : 'System Ready'

        const refetchHealth = () => systemAPI.health().then(r => setHealth(r.data)).catch(() => {})

        // Accounts needing login (Section 2)
        const needsLogin = (accounts as any[]).filter((a: any) => {
          if (a.broker === 'zerodha') return a.token_valid === false || a.ok === false
          return a.token_valid === false
        })

        return (
          <div style={{ marginBottom: '12px', padding: 0, background: containerColor.bg, border: `0.5px solid ${containerColor.border}`, boxShadow: `0 0 24px ${containerColor.glow}`, backdropFilter: 'blur(12px)', borderRadius: 14 }}>
            <div onClick={() => setHCollapsed(p => !p)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', cursor: 'pointer', userSelect: 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  flexShrink: 0,
                  background: overallStateColor,
                  boxShadow: overallState === 'green' ? '0 0 8px rgba(34,221,136,0.7)' : 'none',
                  animation: overallState === 'green' ? 'pulse 2s infinite' : 'none',
                }} />
                <span style={{ fontWeight: 700, fontSize: '12px', color: overallStateColor }}>{statusLabel}</span>
                {feedInactive && !criticalDown && (
                  <span style={{ fontSize: '10px', color: 'var(--sem-warn)', fontFamily: 'var(--font-mono)', opacity: 0.7 }}>Market Closed</span>
                )}
              </div>
              <button onClick={e => { e.stopPropagation(); refetchHealth() }} className="btn btn-steel" style={{ fontSize: '11px', padding: '0 12px', height: '26px' }}>Refresh</button>
            </div>
            {!(healthCollapsed && isReady && !feedInactive) && (
              <div style={{ padding: '2px 16px 12px' }}>

                {/* ── SECTION 1: 5 infrastructure chips ── */}
                {(() => {
                  // isMarketHours is computed at component scope — reuse it here
                  const smartstreamConnected = health?.checks?.smartstream?.connected ?? false

                  const chips = [
                    {
                      label: 'Database',
                      ok: health?.checks?.database?.ok ?? false,
                      state: (health?.checks?.database?.ok ?? false) ? 'green' : 'red'
                    },
                    {
                      label: 'Redis',
                      ok: health?.checks?.redis?.ok ?? false,
                      state: (health?.checks?.redis?.ok ?? false) ? 'green' : 'red'
                    },
                    {
                      label: 'Backend',
                      ok: true,
                      state: 'green' as const
                    },
                    {
                      label: 'Scheduler',
                      ok: health?.checks?.scheduler?.ok ?? false,
                      state: (health?.checks?.scheduler?.ok ?? false) ? 'green' : 'red'
                    },
                    {
                      label: isMarketHours ? 'SmartStream' : 'SmartStream (closed)',
                      ok: smartstreamConnected,
                      state: smartstreamConnected ? 'green' : isMarketHours ? 'red' : 'amber'
                    },
                  ] as const

                  return (
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(5, 1fr)',
                      gap: 0,
                      borderTop: '0.5px solid rgba(255,255,255,0.06)',
                      marginTop: 4
                    }}>
                      {chips.map((chip, i) => (
                        <div key={chip.label} style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          padding: '10px 8px',
                          borderRight: i < chips.length - 1 ? '0.5px solid rgba(255,255,255,0.06)' : 'none',
                          gap: 4
                        }}>
                          <span style={{
                            fontSize: 10,
                            fontFamily: 'Syne',
                            fontWeight: 600,
                            textTransform: 'uppercase',
                            letterSpacing: '0.8px',
                            color: 'rgba(232,232,248,0.35)'
                          }}>{chip.label}</span>
                          <div style={{display:'flex', alignItems:'center', gap:5}}>
                            <div style={{
                              width: 6,
                              height: 6,
                              borderRadius: '50%',
                              background: chip.state === 'green' ? '#22DD88'
                                        : chip.state === 'red'   ? '#FF4444'
                                        :                          '#FFD700',
                              boxShadow: chip.state === 'green' ? '0 0 6px rgba(34,221,136,0.6)'
                                       : chip.state === 'red'   ? '0 0 6px rgba(255,68,68,0.6)'
                                       :                          '0 0 6px rgba(255,215,0,0.5)',
                              flexShrink: 0
                            }} />
                            <span style={{
                              fontSize: 12,
                              fontFamily: 'var(--font-mono)',
                              fontWeight: 600,
                              color: chip.state === 'green' ? '#22DD88'
                                   : chip.state === 'red'   ? '#FF4444'
                                   :                          '#FFD700'
                            }}>
                              {chip.state === 'amber' ? 'inactive' : chip.ok ? 'ok' : 'down'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                })()}

                {/* ── SECTION 2: Account Login buttons (only for accounts needing login) ── */}
                {needsLogin.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {needsLogin.map((acc: any) => {
                      const isZerodha = acc.broker === 'zerodha'
                      const succeeded = loginSucceeded[acc.id] ?? false
                      return (
                        <div key={acc.id} style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '8px 12px', borderRadius: 8,
                          background: 'rgba(18,18,22,0.75)',
                          border: succeeded ? '0.5px solid rgba(34,221,136,0.4)' : '0.5px solid rgba(255,255,255,0.06)',
                          borderLeft: succeeded ? '3px solid rgba(34,221,136,0.4)' : '3px solid rgba(255,107,0,0.2)',
                        }}>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600, fontFamily: 'Syne', color: 'rgba(232,232,248,0.9)' }}>{acc.nickname || acc.name}</div>
                            <div style={{ fontSize: 10, color: 'var(--gs-muted)', marginTop: 1 }}>{isZerodha ? 'Zerodha' : 'Angel One'}</div>
                          </div>
                          {isZerodha ? (
                            <button
                              onClick={e => {
                                e.stopPropagation()
                                const _API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'
                                const w = 520, h = 640
                                const left = window.screenX + (window.outerWidth - w) / 2
                                const top = window.screenY + (window.outerHeight - h) / 2
                                window.open(
                                  `${_API_BASE}/api/v1/zerodha/login`,
                                  'zerodha_oauth',
                                  `width=${w},height=${h},left=${left},top=${top},toolbar=0,menubar=0,location=0,status=0`
                                )
                              }}
                              style={{ padding: '3px 10px', borderRadius: 12, fontSize: 10, fontFamily: 'Syne', fontWeight: 600, background: 'transparent', border: '0.5px solid rgba(255,107,0,0.5)', color: 'var(--ox-radiant)', cursor: 'pointer' }}
                            >Refresh Token</button>
                          ) : (
                            <button
                              onClick={async e => {
                                e.stopPropagation()
                                try {
                                  await fetch(`/api/v1/accounts/${acc.id}/login`, { method: 'POST' })
                                  setLoginSucceeded(p => ({ ...p, [acc.id]: true }))
                                  refetchHealth()
                                } catch {}
                              }}
                              style={{
                                padding: '3px 10px', borderRadius: 12, fontSize: 10, fontFamily: 'Syne', fontWeight: 600,
                                background: 'transparent',
                                border: succeeded ? '0.5px solid rgba(34,221,136,0.4)' : '0.5px solid rgba(255,107,0,0.5)',
                                color: succeeded ? 'rgba(34,221,136,0.6)' : 'var(--ox-radiant)',
                                cursor: 'pointer'
                              }}
                            >{succeeded ? 'Re-Login' : 'Login'}</button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

              </div>
            )}
          </div>
        )
      })()}

      {/* ── ACCOUNT STATUS ── */}
      <div className="card cloud-fill" style={{ marginBottom: '12px', padding: '14px 16px' }}>
        <div className="card-label">Account Status</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '10px' }}>
          {displayAccounts.map((acc: any) => {
            const isZerodha = acc.broker === 'zerodha'
            // Derive live status: prefer health checks, fall back to token_valid_today
            const brokerKey = isZerodha ? 'zerodha' : 'angelone'
            const zerodhaOk = health?.checks?.broker_zerodha?.ok ?? false
            // For Angel One: check health by account id key, fall back to token_valid_today
            const angeloneOk: boolean = isZerodha
              ? false
              : (health?.checks?.['broker_angelone_' + acc.id]?.token_valid
                  ?? health?.checks?.['broker_' + brokerKey]?.token_valid
                  ?? acc.token_valid_today
                  ?? false)
            const isLive: boolean = isZerodha ? zerodhaOk : angeloneOk

            const succeeded = loginSucceeded[acc.id] ?? false
            const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

            return (
              <div key={acc.id} style={{
                display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderRadius: '9px',
                background: isLive ? 'rgba(34,221,136,0.05)' : 'rgba(18,18,22,0.75)',
                border: '0.5px solid ' + (isLive ? 'rgba(34,221,136,0.25)' : 'rgba(255,255,255,0.08)'),
                transition: 'border-color var(--dur-mid), transform var(--dur-fast) var(--ease-spring)'
              }}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--ox-border)'; (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = isLive ? 'rgba(34,221,136,0.25)' : 'rgba(255,255,255,0.08)'; (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)' }}>
                <span className={isLive ? 'pulse-live-lg' : 'pulse-warn-lg'} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: '13px', fontWeight: 600, color: 'var(--ox-glow)' }}>{acc.nickname || acc.name}</div>
                  <div style={{ fontSize: '10px', color: 'var(--gs-muted)', marginTop: '1px' }}>{isZerodha ? 'Zerodha' : 'Angel One'}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0 }}>
                  {/* Live chip — shown when account is live */}
                  {isLive && (
                    <span style={{
                      padding: '2px 8px', borderRadius: 10, fontSize: 10, fontFamily: 'Syne', fontWeight: 600,
                      background: 'rgba(34,221,136,0.12)', border: '0.5px solid rgba(34,221,136,0.25)', color: '#22DD88'
                    }}>• Live</span>
                  )}
                  {/* Zerodha: show Login (not connected) or Re-Login (connected) */}
                  {isZerodha ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        const w = 520, h = 640
                        const left = window.screenX + (window.outerWidth - w) / 2
                        const top = window.screenY + (window.outerHeight - h) / 2
                        window.open(
                          `${API_BASE}/api/v1/zerodha/login`,
                          'zerodha_oauth',
                          `width=${w},height=${h},left=${left},top=${top},toolbar=0,menubar=0,location=0,status=0`
                        )
                      }}
                      style={{
                        padding: '4px 12px', borderRadius: 12, fontSize: 11, fontFamily: 'Syne',
                        background: 'transparent',
                        border: zerodhaOk
                          ? '0.5px solid rgba(34,221,136,0.4)'
                          : '0.5px solid rgba(255,107,0,0.5)',
                        color: zerodhaOk ? '#22DD88' : 'var(--ox-radiant)',
                        cursor: 'pointer'
                      }}
                    >
                      {zerodhaOk ? 'Re-Login' : '🔑 Login'}
                    </button>
                  ) : isLive ? (
                    /* Angel One live: show Re-Login (muted green) */
                    <button
                      onClick={async (e) => {
                        e.stopPropagation()
                        const res = await fetch(`${API_BASE}/api/v1/accounts/${acc.id}/login`, { method: 'POST' })
                        if (res.ok) {
                          setLoginSucceeded(prev => ({ ...prev, [acc.id]: true }))
                        }
                      }}
                      style={{
                        padding: '4px 12px', borderRadius: 12, fontSize: 11, fontFamily: 'Syne',
                        background: 'transparent',
                        border: '0.5px solid rgba(34,221,136,0.4)',
                        color: '#22DD88',
                        cursor: 'pointer'
                      }}
                    >Re-Login</button>
                  ) : (
                    /* Angel One dead: show Login → Re-Login after success */
                    <button
                      onClick={async (e) => {
                        e.stopPropagation()
                        const res = await fetch(`${API_BASE}/api/v1/accounts/${acc.id}/login`, { method: 'POST' })
                        if (res.ok) {
                          setLoginSucceeded(prev => ({ ...prev, [acc.id]: true }))
                        }
                      }}
                      style={{
                        padding: '4px 12px', borderRadius: 12, fontSize: 11, fontFamily: 'Syne',
                        background: 'transparent',
                        border: succeeded ? '0.5px solid rgba(34,221,136,0.4)' : '0.5px solid rgba(255,107,0,0.5)',
                        color: succeeded ? '#22DD88' : 'var(--ox-radiant)',
                        cursor: 'pointer'
                      }}
                    >{succeeded ? 'Re-Login' : '🔑 Login'}</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── STAT CARDS ── */}
      <div className="stat-grid" style={{ display: 'grid', gridTemplateColumns: '0.7fr 0.7fr 1.3fr 1.3fr', gap: '12px', marginBottom: '12px' }}>
        <div className="card cloud-fill" style={{ padding: '16px 18px' }}>
          <div className="card-label">Active Algos</div>
          <div style={{ fontSize: '38px', fontWeight: 800, color: 'var(--ox-radiant)', fontFamily: 'var(--font-mono)', letterSpacing: '-2px', lineHeight: 1 }}>{stats['active_algos'] ?? 0}</div>
          <div style={{ fontSize: '10px', color: 'rgba(255,107,0,0.6)', marginTop: '5px', fontWeight: 600 }}>of {(algos as any[]).length} algos</div>
        </div>
        <div className="card cloud-fill" style={{ padding: '16px 18px' }}>
          <div className="card-label">Open Positions</div>
          <div style={{ fontSize: '38px', fontWeight: 800, color: 'var(--sem-long)', fontFamily: 'var(--font-mono)', letterSpacing: '-2px', lineHeight: 1 }}>{stats['open_positions'] ?? 0}</div>
          <div style={{ fontSize: '10px', color: 'rgba(34,221,136,0.6)', marginTop: '5px', fontWeight: 600 }}>open lots</div>
        </div>
        <PnlCard label="Today P&L" value={todayPnl} isPositive={todayPnl >= 0} sparkId="today" />
        <PnlCard label="FY P&L" value={fyPnlReal} isPositive={fyPnlReal >= 0} sparkId="fy" equityCurve={equityCurveData} />
      </div>

      {/* ── NEXT ALGO + HOLIDAYS — FIX #1: no separator lines ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>

        {/* FIX #4: inset box-shadow draws the left orange bar without borderLeft conflict */}
        {(() => {
          const hasScheduledAlgo = nextAlgo != null
          const nextAlgoDotColor = !isMarketHours
            ? '#FF4444'
            : hasScheduledAlgo
              ? '#22DD88'
              : '#FFB347'
          const nextAlgoPulse = isMarketHours && hasScheduledAlgo
          const nextAlgoBorder = !isMarketHours
            ? '0.5px solid rgba(255,68,68,0.2)'
            : hasScheduledAlgo
              ? '0.5px solid rgba(34,221,136,0.3)'
              : '0.5px solid rgba(255,179,71,0.2)'
          const nextAlgoShadow = hasScheduledAlgo && isMarketHours
            ? 'inset 3px 0 0 var(--ox-radiant), 0 0 16px rgba(34,221,136,0.06), 0 4px 24px rgba(0,0,0,0.55)'
            : 'inset 3px 0 0 var(--ox-radiant), 0 4px 24px rgba(0,0,0,0.55)'
          return (
        <div className="card cloud-fill" style={{ padding: '14px 16px', border: nextAlgoBorder, boxShadow: nextAlgoShadow }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '10px' }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              background: nextAlgoDotColor,
              boxShadow: nextAlgoPulse ? `0 0 8px ${nextAlgoDotColor}` : 'none',
              animation: nextAlgoPulse ? 'pulse 2s infinite' : 'none',
              flexShrink: 0
            }} />
            <span className="card-label" style={{ marginBottom: 0 }}>Next Algo</span>
          </div>
          {!isMarketHours ? (
            <div style={{ fontSize: '13px', color: '#FF4444', fontStyle: 'italic', opacity: 0.8 }}>Market Closed</div>
          ) : scheduledAlgos.length === 0 ? (
            <div style={{ fontSize: '13px', color: '#FFB347', fontStyle: 'italic', opacity: 0.85 }}>No algos scheduled today</div>
          ) : (
            <>
              <div style={{ position: 'relative', marginBottom: '10px' }}>
                {scrollPos > 10 && (
                  <button onClick={() => scrollAlgos('left')} style={{ position: 'absolute', left: '-4px', top: '50%', transform: 'translateY(-50%)', width: '24px', height: '24px', borderRadius: '50%', background: 'rgba(255,107,0,0.15)', border: '0.5px solid rgba(255,107,0,0.4)', color: 'var(--ox-radiant)', fontSize: '15px', cursor: 'pointer', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>&#8249;</button>
                )}
                <div ref={algoScrollRef} onScroll={e => setScrollPos((e.target as HTMLDivElement).scrollLeft)}
                  style={{ display: 'flex', gap: '8px', overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: '2px' }}>
                  {scheduledAlgos.map((a: any, i: number) => {
                    const isNext = nextAlgo && a.name === nextAlgo.name && a.time === nextAlgo.time
                    return (
                      <div key={i} style={{ flexShrink: 0, padding: '7px 11px', borderRadius: '8px', background: isNext ? 'rgba(255,107,0,0.12)' : 'rgba(255,107,0,0.04)', border: '0.5px solid ' + (isNext ? 'rgba(255,107,0,0.40)' : 'rgba(255,107,0,0.14)'), minWidth: '98px' }}>
                        <div style={{ fontSize: '12px', fontWeight: 700, color: isNext ? 'var(--ox-glow)' : 'var(--ox-ultra)', marginBottom: '3px', fontFamily: 'var(--font-display)' }}>{a.name}</div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: isNext ? 'var(--sem-warn)' : 'var(--gs-muted)' }}>{a.time}</div>
                      </div>
                    )
                  })}
                </div>
                <button onClick={() => scrollAlgos('right')} style={{ position: 'absolute', right: '-4px', top: '50%', transform: 'translateY(-50%)', width: '24px', height: '24px', borderRadius: '50%', background: 'rgba(255,107,0,0.15)', border: '0.5px solid rgba(255,107,0,0.4)', color: 'var(--ox-radiant)', fontSize: '15px', cursor: 'pointer', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>&#8250;</button>
              </div>
              {nextAlgo && (
                <>
                  <div style={{ fontSize: 'clamp(22px,2.5vw,30px)', fontWeight: 800, color: 'var(--sem-warn)', fontFamily: 'var(--font-mono)', textShadow: '0 0 18px rgba(255,215,0,0.5)', letterSpacing: '-1px' }}>
                    {Math.floor((nextAlgo.secs - nowSecs) / 60)}m {String((nextAlgo.secs - nowSecs) % 60).padStart(2, '0')}s
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--gs-muted)', marginTop: '3px', fontFamily: 'var(--font-mono)' }}>until {nextAlgo.name} at {nextAlgo.time}</div>
                </>
              )}
            </>
          )}
        </div>
          )
        })()}

        {/* FIX #2: cloud-fill on Holidays, FIX #1: no separator line */}
        <div className="card cloud-fill" style={{ padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <span className="card-label" style={{ marginBottom: 0 }}>Upcoming Holidays (F&O)</span>
            <button className="btn btn-ghost" style={{ fontSize: '10px', padding: '0 10px', height: '26px' }} onClick={handleSyncHolidays} disabled={syncingHolidays}>{syncingHolidays ? 'Syncing…' : 'Sync NSE'}</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {holidays.length === 0
              ? <div style={{ fontSize: '12px', color: 'var(--gs-muted)', fontStyle: 'italic' }}>No F&O holidays in next 30 days — sync to load.</div>
              : holidays.map((h: any) => {
                  const d = new Date(h.date)
                  return (
                    <div key={h.id} style={{ padding: '7px 12px', borderRadius: '8px', background: 'rgba(255,215,0,0.06)', border: '0.5px solid rgba(255,215,0,0.20)', minWidth: '110px' }}>
                      <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--sem-warn)', marginBottom: '2px' }}>
                        {d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' })} · {d.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' })}
                      </div>
                      <div style={{ fontSize: '10px', color: 'var(--gs-muted)' }}>{h.description}</div>
                    </div>
                  )
                })
            }
          </div>
        </div>
      </div>

      {/* ── SERVICES + SYSTEM LOG ── */}
      {/* FIX #3: cloud-fill on BOTH Services and System Log outer cards */}
      {/* FIX #5: alignItems:start so both cards match their own content height */}
      {/* FIX #4: System Log = card cloud-fill outer + dark inner container (container-in-container) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 2.6fr', gap: '12px', marginBottom: '12px', alignItems: 'start' }}>

        {/* FIX #3: Services with cloud-fill, FIX #1: no separator */}
        <div className="card cloud-fill" style={{ padding: '14px 14px 12px' }}>
          <div className="card-label">Services</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {services.map(svc => (
              <div key={svc.id} className={'service-row ' + (svc.status === 'running' ? 'running' : svc.status === 'stopped' ? 'stopped' : 'error')}
                style={{ padding: '16px 10px', marginBottom: 0 }}>
                <span style={{ width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0, background: STATUS_CLR[svc.status], boxShadow: svc.status === 'running' ? '0 0 6px ' + STATUS_CLR[svc.status] : 'none', animation: (svc.status === 'starting' || svc.status === 'stopping') ? 'pulse 1s infinite' : 'none' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ox-glow)' }}>{svc.name}</div>
                  <div style={{ fontSize: '9px', color: 'var(--gs-muted)', fontFamily: 'var(--font-mono)', marginTop: '1px' }}>{svc.detail}</div>
                </div>
                <span className={'chip ' + (svc.status === 'running' ? 'chip-success' : 'chip-inactive')} style={{ fontSize: '9px', padding: '1px 6px', flexShrink: 0 }}>{svc.status}</span>
                {svc.status === 'stopped'  && <button className="btn btn-ghost"  style={{ fontSize: '9px', padding: '0 8px', height: '22px' }} onClick={() => startSvc(svc.id)}>Start</button>}
                {svc.status === 'running'  && <button className="btn btn-danger" style={{ fontSize: '9px', padding: '0 8px', height: '22px' }} onClick={() => stopSvc(svc.id)}>Stop</button>}
                {(svc.status === 'starting' || svc.status === 'stopping') && <button className="btn btn-steel" style={{ fontSize: '9px', padding: '0 8px', height: '22px' }} disabled>{svc.status}…</button>}
              </div>
            ))}
          </div>
        </div>

        {/* FIX #3+4: System Log — outer card cloud-fill + inner dark terminal container */}
        <div className="card cloud-fill" style={{ padding: '14px 14px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
            <span className="pulse-live" />
            <span className="card-label" style={{ marginBottom: 0 }}>System Log</span>
          </div>
          {/* FIX #4: inner dark terminal — container within container */}
          <div style={{ borderRadius: '8px', overflow: 'hidden', background: 'rgba(5,4,2,0.92)', border: '0.5px solid rgba(255,107,0,0.14)' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10.5px', padding: '10px 12px', height: '290px', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
              {log.map((line, i) => {
                const isSep = line.startsWith('──')
                if (isSep) return (
                  <div key={i} style={{ color: 'rgba(255,107,0,0.25)', textAlign: 'center' as const, fontSize: '10px', letterSpacing: '0.06em', padding: '4px 0', margin: '3px 0', borderTop: '0.5px solid rgba(255,107,0,0.08)', borderBottom: '0.5px solid rgba(255,107,0,0.08)' }}>
                    {line}
                  </div>
                )
                const isOk  = line.includes('✅')
                const isErr = line.includes('⛔')
                const isWrn = line.includes('⚠')
                return (
                  <div key={i} style={{ color: isOk ? '#22DD88' : isErr ? '#FF4444' : isWrn ? '#FFD700' : 'rgba(240,237,232,0.38)', lineHeight: 1.65, padding: '0.5px 0' }}>
                    {line}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Kill Switch Modal ── */}
      {showKillConfirm && (
        <div className="modal-overlay">
          <div className="modal-box">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--sem-short)" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
              <span style={{ fontWeight: 800, fontSize: '16px', fontFamily: 'var(--font-display)', color: 'var(--sem-short)' }}>Kill Switch</span>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--gs-muted)', marginBottom: '14px', lineHeight: 1.6 }}>Select accounts to kill. Uncheck any you want to leave running.</p>
            <div style={{ marginBottom: '14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {displayAccounts.map((acc: any) => {
                const checked = selKill.includes(acc.id)
                return (
                  <label key={acc.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', background: checked ? 'rgba(255,68,68,0.08)' : 'rgba(255,255,255,0.03)', border: '0.5px solid ' + (checked ? 'rgba(255,68,68,0.4)' : 'rgba(255,255,255,0.08)'), borderRadius: '8px', padding: '8px 12px', cursor: 'pointer' }}>
                    {killedIds.includes(acc.id) ? <span style={{ fontSize: '12px', color: 'var(--sem-short)' }}>⛔</span>
                      : <input type="checkbox" checked={checked} onChange={() => setSelKill(p => p.includes(acc.id) ? p.filter(id => id !== acc.id) : [...p, acc.id])} style={{ width: '14px', height: '14px', accentColor: 'var(--sem-short)', cursor: 'pointer' }} />}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--ox-glow)' }}>{acc.nickname || acc.name}</div>
                      <div style={{ fontSize: '11px', color: 'var(--gs-muted)' }}>{acc.broker === 'zerodha' ? 'Zerodha' : 'Angel One'}</div>
                    </div>
                    {killedIds.includes(acc.id) ? <span className="chip chip-error" style={{ fontSize: '9px' }}>KILLED</span>
                      : checked ? <span className="chip chip-error" style={{ fontSize: '9px' }}>WILL KILL</span> : null}
                  </label>
                )
              })}
            </div>
            <div style={{ background: 'rgba(255,68,68,0.07)', border: '0.5px solid rgba(255,68,68,0.25)', borderRadius: '8px', padding: '8px 12px', marginBottom: '16px', fontSize: '11px', color: 'var(--sem-short)', fontWeight: 600 }}>
              ⚠️ This will square off all positions + cancel all orders. Cannot be undone.
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setKillModal(false)} disabled={killLoading}>Cancel</button>
              <button className="btn btn-danger" onClick={handleKill} disabled={killLoading} style={{ minWidth: '160px' }}>{killLoading ? 'Activating…' : 'Activate Kill Switch'}</button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
