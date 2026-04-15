import { useStore } from '@/store'
import { useState, useEffect } from 'react'
import { servicesAPI, accountsAPI, systemAPI, eventsAPI, holidaysAPI, gridAPI, reportsAPI, algosAPI, ordersAPI } from '@/services/api'
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


function PnlCard({ label, value, isPositive, sparkId, equityCurve, roi }: { label: string; value: number; isPositive: boolean; sparkId: string; equityCurve?: {month: string; cumulative: number}[]; roi?: string }) {
  const rupee = String.fromCharCode(0x20B9)
  const display = (isPositive ? '+' : '') + rupee + Math.abs(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })
  const col  = isPositive ? 'var(--ox-radiant)' : 'var(--sem-short)'
  const col2 = isPositive ? '#FF6B00' : '#FF4444'
  return (
    <div className="card cloud-fill" style={{ padding: '16px 18px' }}>
      <div className="card-label">{label}</div>
      <div style={{ fontSize: 'clamp(20px,2.2vw,28px)', fontWeight: 800, color: col, fontFamily: 'var(--font-mono)', letterSpacing: '-1px', lineHeight: 1 }}>{display}</div>
      <div style={{ fontSize: '10px', color: isPositive ? 'rgba(255,107,0,0.65)' : 'rgba(255,68,68,0.65)', marginTop: '3px', fontWeight: 600 }}>
        {isPositive ? '▲' : '▼'} {isPositive ? 'Profit' : 'Loss'} · {roi ?? '0.00'}% ROI
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


export default function DashboardPage() {
  const isPractixMode = useStore(s => s.isPractixMode)
  const algos         = useStore(s => s.algos)
  const accounts      = useStore(s => s.accounts)
  const setAccounts   = useStore(s => s.setAccounts)
  const [services, setServices]          = useState<Service[]>(INIT_SERVICES)
  const [stats, setStats]                = useState<Record<string,number>>({})
  const [liveMtm, setLiveMtm]            = useState<number>(0)
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
  const [_todayGrid, _setTodayGrid]      = useState<any[]>([])
  const [health, setHealth]              = useState<any>(null)
  const [_healthCollapsed, setHCollapsed] = useState(false)
  const [nextAlgoIdx, setNextAlgoIdx]    = useState(0)
  const [equityCurveData, setEquityCurveData] = useState<{month: string; cumulative: number}[]>([])
  const [algoList, setAlgoList]              = useState<any[]>([])

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])
  useEffect(() => {
    algosAPI.list().then(res => {
      const data = res.data
      setAlgoList(Array.isArray(data) ? data : (data?.algos || data?.items || []))
    }).catch(() => {})
  }, [])
  // Auto-select the first upcoming (future) algo when the list loads
  useEffect(() => {
    if (scheduledAlgos.length > 0) {
      const firstFutureIdx = scheduledAlgos.findIndex((a: any) => a.secs > nowSecs)
      setNextAlgoIdx(firstFutureIdx >= 0 ? firstFutureIdx : 0)
    }
  }, [algoList.length]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
    const run = () => gridAPI.list({ week_start: today, week_end: today, is_practix: isPractixMode })
      .then(r => _setTodayGrid(r.data?.entries || r.data?.groups || r.data || [])).catch(() => {})
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

  // Live MTM for Today P&L — poll /orders/ltp every 2s when open positions exist
  useEffect(() => {
    const compute = (ltpMap: Record<string, any>) => {
      const total = Object.values(ltpMap).reduce((s: number, e: any) => s + (e?.pnl ?? 0), 0)
      setLiveMtm(total)
    }
    ordersAPI.ltp().then(r => { if (r.data?.ltp) compute(r.data.ltp) }).catch(() => {})
    const iv = setInterval(() => {
      ordersAPI.ltp().then(r => { if (r.data?.ltp) compute(r.data.ltp) }).catch(() => {})
    }, 2000)
    return () => clearInterval(iv)
  }, [])
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

  const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
  const todayDay = DAYS[new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).getDay()]

  const todayAlgos = algoList.filter((a: any) =>
    a.is_active &&
    !a.is_archived &&
    Array.isArray(a.recurring_days) &&
    a.recurring_days.includes(todayDay)
  )

  const scheduledAlgos = todayAlgos
    .filter((a: any) => !!a.entry_time)
    .map((a: any) => {
      const [eh, em] = (a.entry_time as string).split(':').map(Number)
      return { ...a, secs: eh * 3600 + em * 60, time: a.entry_time as string }
    })
    .sort((a: any, b: any) => a.secs - b.secs)

  const nowIst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))

  const getTimeRemaining = (entryTime: string): string => {
    const [h, m] = entryTime.split(':').map(Number)
    const entry = new Date(nowIst)
    entry.setHours(h, m, 0, 0)
    const diffMs = entry.getTime() - nowIst.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    if (diffMins < 60) return `in ${diffMins} mins`
    const hrs = Math.floor(diffMins / 60)
    const mins = diffMins % 60
    return `in ${hrs}h ${mins}m`
  }

  const nextAlgo = scheduledAlgos.find((a: any) => a.secs > nowSecs) || null

  const todayPnl  = (stats['today_pnl'] ?? 0) + liveMtm
  const fyPnl     = stats['fy_pnl']    ?? 0
  const fyPnlReal = equityCurveData.length > 0 ? (equityCurveData[equityCurveData.length - 1]?.cumulative ?? fyPnl) : fyPnl
  const fyMargin  = (accounts as any[]).reduce((sum, a) => sum + (a.margin ?? a.fy_margin ?? 0), 0)
  const fyRoi     = fyMargin > 0 ? (fyPnlReal / fyMargin * 100).toFixed(2) : '0.00'

  // ── isMarketHours (component scope, shared by health container + chip row) ──
  const isMarketHours: boolean = health?.is_market_hours ?? (() => {
    const IST_OFFSET = 5.5 * 60 * 60 * 1000
    const nowIST = new Date(Date.now() + IST_OFFSET - new Date().getTimezoneOffset() * 60000)
    const day = nowIST.getUTCDay()
    const h = nowIST.getUTCHours(), m = nowIST.getUTCMinutes()
    const mins = h * 60 + m
    return day >= 1 && day <= 5 && mins >= (9*60+15) && mins <= (15*60+30)
  })()

  const isPreMarket: boolean = (() => {
    const IST_OFFSET = 5.5 * 60 * 60 * 1000
    const nowIST = new Date(Date.now() + IST_OFFSET - new Date().getTimezoneOffset() * 60000)
    const day = nowIST.getUTCDay()
    const h = nowIST.getUTCHours(), m = nowIST.getUTCMinutes()
    const mins = h * 60 + m
    return day >= 1 && day <= 5 && mins >= (8*60+45) && mins < (9*60+15)
  })()

  // ── overallState for health card container ──
  const ssConnected = (health?.checks?.smartstream?.connected || health?.checks?.smartstream?.ok) ?? false

  const criticalRed =
    !(health?.checks?.database?.ok ?? false) ||
    !(health?.checks?.redis?.ok ?? false) ||
    !(health?.checks?.scheduler?.ok ?? false) ||
    (isMarketHours && !ssConnected)

  const smartstreamAmber = !isMarketHours && !ssConnected

  const overallState: 'green' | 'amber' | 'red' =
    criticalRed ? 'red' : smartstreamAmber ? 'amber' : 'green'


  const overallStateColor = overallState === 'green' ? '#22DD88' : overallState === 'amber' ? '#FFD700' : '#FF4444'

  const displayAccounts = (accounts as any[]).length > 0 ? (accounts as any[]) : [
    { id: '1', nickname: 'Karthik', broker: 'zerodha',  token_valid_today: false },
    { id: '2', nickname: 'Mom',     broker: 'angelone', token_valid_today: false },
    { id: '3', nickname: 'Wife',    broker: 'angelone', token_valid_today: false },
  ]
  // Exclude "Karthik AO" from dashboard account status panel (it's in DB/Accounts page)
  const dashboardAccounts = displayAccounts.filter((a: any) => a.nickname !== 'Karthik AO')

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
          <span style={{ width: '1px', height: '22px', background: 'rgba(255,255,255,0.10)', margin: '0 2px', flexShrink: 0 }} />
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
        const feedInactive = !health.is_market_hours && health.checks?.smartstream?.ok === false
        const statusLabel = criticalDown ? 'System Not Ready' : feedInactive ? 'Feed Inactive' : 'System Ready'

        const refetchHealth = () => systemAPI.health().then(r => setHealth(r.data)).catch(() => {})

        // Accounts needing login (Section 2)
        const needsLogin = (accounts as any[]).filter((a: any) => {
          if (a.broker === 'zerodha') return a.token_valid === false || a.ok === false
          return a.token_valid === false
        })

        return (
          <div className="card cloud-fill" style={{ marginBottom: '12px', padding: '9px 16px', border: '0.5px solid rgba(255,107,0,0.30)' }}>
            {/* ── Single row: status dot · label · divider · chips · refresh ── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>

              {/* Status dot + label */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, paddingRight: 16 }}>
                <div style={{
                  width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                  background: overallStateColor,
                  boxShadow: overallState === 'green' ? '0 0 8px rgba(34,221,136,0.7)' : overallState === 'amber' ? '0 0 8px rgba(255,215,0,0.6)' : '0 0 8px rgba(255,68,68,0.6)',
                  animation: overallState === 'green' ? 'pulse 2s infinite' : 'none',
                }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: overallStateColor, fontFamily: 'Syne, sans-serif', whiteSpace: 'nowrap' as const }}>{statusLabel}</span>
              </div>

              {/* Service chips */}
              {(() => {
                const ssData = health?.checks?.smartstream
                const smartstreamConnected = (ssData?.connected || ssData?.ok) ?? false
                const chips = [
                  { label: 'Database',  ok: health?.checks?.database?.ok ?? false,  state: (health?.checks?.database?.ok  ?? false) ? 'green' : 'red'   },
                  { label: 'Redis',     ok: health?.checks?.redis?.ok    ?? false,  state: (health?.checks?.redis?.ok     ?? false) ? 'green' : 'red'   },
                  { label: 'Backend',   ok: true,                                    state: 'green' as const                                              },
                  { label: 'Scheduler', ok: health?.checks?.scheduler?.ok ?? false, state: (health?.checks?.scheduler?.ok ?? false) ? 'green' : 'red'   },
                  { label: 'SmartStream',
                    ok: smartstreamConnected,
                    state: smartstreamConnected ? 'green' : isMarketHours ? 'red' : 'amber' },
                ] as const
                return (
                  <div style={{ display: 'flex', flex: 1, alignItems: 'center' }}>
                    {chips.map((chip) => {
                      const dotColor   = chip.state === 'green' ? '#22DD88' : chip.state === 'red' ? '#FF4444' : '#FFD700'
                      const dotGlow    = chip.state === 'green' ? '0 0 6px rgba(34,221,136,0.55)' : chip.state === 'red' ? '0 0 6px rgba(255,68,68,0.55)' : '0 0 6px rgba(255,215,0,0.45)'
                      const statusText = chip.state === 'amber' ? 'inactive' : chip.ok ? 'ok' : 'down'
                      return (
                        <div key={chip.label} style={{
                          display: 'flex', alignItems: 'center', gap: 7,
                          padding: '0 16px',
                          borderLeft: '0.5px solid rgba(255,255,255,0.08)',
                        }}>
                          <div style={{ width: 5, height: 5, borderRadius: '50%', background: dotColor, boxShadow: dotGlow, flexShrink: 0 }} />
                          <div>
                            <div style={{ fontSize: 9, fontFamily: 'Syne, sans-serif', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.6px', color: 'rgba(232,232,248,0.28)', lineHeight: 1.2 }}>{chip.label}</div>
                            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 600, color: dotColor, lineHeight: 1.3 }}>{statusText}</div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })()}

              {/* Refresh */}
              <button onClick={e => { e.stopPropagation(); refetchHealth() }} className="btn btn-ghost" style={{ fontSize: '11px', padding: '0 12px', height: '26px', flexShrink: 0, marginLeft: 12 }}>Refresh</button>
            </div>

            {/* ── Account login alerts — shown below if any accounts need login ── */}
            {needsLogin.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10, borderTop: '0.5px solid rgba(255,255,255,0.06)', paddingTop: 10 }}>
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
                            const top  = window.screenY + (window.outerHeight - h) / 2
                            window.open(`${_API_BASE}/api/v1/zerodha/login`, 'zerodha_oauth', `width=${w},height=${h},left=${left},top=${top},toolbar=0,menubar=0,location=0,status=0`)
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
                          style={{ padding: '3px 10px', borderRadius: 12, fontSize: 10, fontFamily: 'Syne', fontWeight: 600, background: 'transparent', border: succeeded ? '0.5px solid rgba(34,221,136,0.4)' : '0.5px solid rgba(255,107,0,0.5)', color: succeeded ? 'rgba(34,221,136,0.6)' : 'var(--ox-radiant)', cursor: 'pointer' }}
                        >{succeeded ? 'Re-Login' : 'Login'}</button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })()}

      {/* ── UNIFIED STATUS STRIP: Accounts · Next Algo · Next Holiday ── */}
      <div className="card cloud-fill" style={{ marginBottom: '12px', padding: '16px 20px', display: 'flex', alignItems: 'stretch', gap: '0' }}>

        {/* ── Accounts ~50% ── */}
        <div style={{ flex: '0 0 50%', minWidth: 0, paddingRight: '20px' }}>
          <div className="card-label" style={{ marginBottom: '12px' }}>Account Status</div>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' as const, gap: '4px' }}>
            {dashboardAccounts.map((acc: any, idx: number) => {
              const isZerodha = acc.broker === 'zerodha'
              const zerodhaOk = health?.checks?.broker_zerodha?.ok ?? false
              const angeloneOk: boolean = isZerodha
                ? false
                : (health?.checks?.['broker_angelone_' + acc.id]?.token_valid
                    ?? health?.checks?.['broker_angelone']?.token_valid
                    ?? acc.token_valid_today
                    ?? false)
              const isLive: boolean = isZerodha ? zerodhaOk : angeloneOk
              const succeeded = loginSucceeded[acc.id] ?? false
              const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'
              return (
                <div key={acc.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 20px', borderLeft: idx > 0 ? '1px solid rgba(255,255,255,0.08)' : 'none' }}>
                  <span className={isLive ? 'pulse-live-lg' : 'pulse-warn-lg'} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: '13px', fontWeight: 600, color: 'var(--ox-glow)', whiteSpace: 'nowrap' as const }}>{acc.nickname || acc.name}</div>
                    <div style={{ fontSize: '10px', color: 'var(--gs-muted)', marginTop: '1px' }}>{isZerodha ? 'Zerodha' : 'Angel One'}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0 }}>
                    {isLive && (
                      <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 10, fontFamily: 'Syne', fontWeight: 600, background: 'rgba(34,221,136,0.12)', border: '0.5px solid rgba(34,221,136,0.25)', color: '#22DD88' }}>• Live</span>
                    )}
                    {isZerodha && !zerodhaOk && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          const w = 520, h = 640
                          const left = window.screenX + (window.outerWidth - w) / 2
                          const top = window.screenY + (window.outerHeight - h) / 2
                          window.open(`${API_BASE}/api/v1/zerodha/login`, 'zerodha_oauth', `width=${w},height=${h},left=${left},top=${top},toolbar=0,menubar=0,location=0,status=0`)
                        }}
                        style={{ padding: '4px 12px', borderRadius: 12, fontSize: 11, fontFamily: 'Syne', background: 'transparent', border: '0.5px solid rgba(255,107,0,0.5)', color: 'var(--ox-radiant)', cursor: 'pointer' }}
                      >🔑 Login</button>
                    )}
                    {!isZerodha && !isLive && (
                      <button
                        onClick={async (e) => {
                          e.stopPropagation()
                          const res = await fetch(`${API_BASE}/api/v1/accounts/${acc.id}/login`, { method: 'POST' })
                          if (res.ok) setLoginSucceeded(prev => ({ ...prev, [acc.id]: true }))
                        }}
                        style={{ padding: '4px 12px', borderRadius: 12, fontSize: 11, fontFamily: 'Syne', background: 'transparent', border: succeeded ? '0.5px solid rgba(34,221,136,0.4)' : '0.5px solid rgba(255,107,0,0.5)', color: succeeded ? '#22DD88' : 'var(--ox-radiant)', cursor: 'pointer' }}
                      >{succeeded ? 'Re-Login' : '🔑 Login'}</button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Divider */}
        <div style={{ width: '1px', flexShrink: 0, alignSelf: 'stretch', background: 'rgba(255,255,255,0.08)' }} />

        {/* ── Next Algo ~25% ── */}
        {(() => {
          const hasScheduledAlgo = nextAlgo != null
          const nextAlgoDotColor = !isMarketHours ? '#FF4444' : hasScheduledAlgo ? '#22DD88' : '#FFB347'
          const nextAlgoPulse = isMarketHours && hasScheduledAlgo
          return (
            <div style={{ flex: '0 0 25%', minWidth: 0, padding: '0 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: nextAlgoDotColor, boxShadow: nextAlgoPulse ? `0 0 6px ${nextAlgoDotColor}` : 'none', animation: nextAlgoPulse ? 'pulse 2s infinite' : 'none' }} />
                <span className="card-label" style={{ marginBottom: 0 }}>Next Algo</span>
              </div>
              {!isMarketHours && !isPreMarket ? (
                <div style={{ fontSize: '12px', color: '#FF4444', fontStyle: 'italic', opacity: 0.8 }}>Market Closed</div>
              ) : isPreMarket ? (
                <div style={{ fontSize: '12px', color: '#FFB347', fontStyle: 'italic', opacity: 0.85 }}>Market opening soon</div>
              ) : scheduledAlgos.length === 0 ? (
                <div style={{ fontSize: '12px', color: '#FFB347', fontStyle: 'italic', opacity: 0.85 }}>No algos scheduled</div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {scheduledAlgos.length > 1 && (
                    <button onClick={() => setNextAlgoIdx(i => Math.max(0, i - 1))} disabled={nextAlgoIdx === 0}
                      style={{ width: '20px', height: '20px', flexShrink: 0, borderRadius: '50%', background: 'rgba(255,107,0,0.15)', border: '0.5px solid rgba(255,107,0,0.4)', color: nextAlgoIdx === 0 ? 'rgba(255,107,0,0.3)' : 'var(--ox-radiant)', fontSize: '14px', cursor: nextAlgoIdx === 0 ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>&#8249;</button>
                  )}
                  {(() => {
                    const viewIdx = Math.min(nextAlgoIdx, scheduledAlgos.length - 1)
                    const a = scheduledAlgos[viewIdx]
                    if (!a) return null
                    const isFuture = a.secs > nowSecs
                    return (
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--ox-glow)', fontFamily: 'var(--font-display)', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--sem-warn)' }}>
                          {a.time}{isFuture ? ` · ${getTimeRemaining(a.time)}` : ' · past'}
                        </div>
                      </div>
                    )
                  })()}
                  {scheduledAlgos.length > 1 && (
                    <>
                      <button onClick={() => setNextAlgoIdx(i => Math.min(scheduledAlgos.length - 1, i + 1))} disabled={nextAlgoIdx >= scheduledAlgos.length - 1}
                        style={{ width: '20px', height: '20px', flexShrink: 0, borderRadius: '50%', background: 'rgba(255,107,0,0.15)', border: '0.5px solid rgba(255,107,0,0.4)', color: nextAlgoIdx >= scheduledAlgos.length - 1 ? 'rgba(255,107,0,0.3)' : 'var(--ox-radiant)', fontSize: '14px', cursor: nextAlgoIdx >= scheduledAlgos.length - 1 ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>&#8250;</button>
                      <span style={{ fontSize: '10px', color: 'var(--gs-muted)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{nextAlgoIdx + 1}/{scheduledAlgos.length}</span>
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })()}

        {/* Divider */}
        <div style={{ width: '1px', flexShrink: 0, alignSelf: 'stretch', background: 'rgba(255,255,255,0.08)' }} />

        {/* ── Next Holiday ~20% ── */}
        <div style={{ flex: 1, minWidth: 0, paddingLeft: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <span className="card-label" style={{ marginBottom: 0 }}>Next Holiday</span>
            <button className="btn btn-ghost" style={{ fontSize: '9px', padding: '0 8px', height: '22px' }} onClick={handleSyncHolidays} disabled={syncingHolidays}>{syncingHolidays ? 'Syncing…' : 'Sync NSE'}</button>
          </div>
          {holidays.length === 0
            ? <div style={{ fontSize: '11px', color: 'var(--gs-muted)', fontStyle: 'italic' }}>None in next 30 days</div>
            : holidays.slice(0, 1).map((h: any) => {
                const d = new Date(h.date)
                return (
                  <div key={h.id} style={{ padding: '5px 10px', borderRadius: '7px', background: 'rgba(255,215,0,0.06)', border: '0.5px solid rgba(255,215,0,0.20)', display: 'inline-block' }}>
                    <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--sem-warn)', marginBottom: '1px' }}>
                      {d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' })} · {d.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' })}
                    </div>
                    <div style={{ fontSize: '9px', color: 'var(--gs-muted)' }}>{h.description}</div>
                  </div>
                )
              })
          }
        </div>

      </div>

      {/* ── STAT CARDS ── */}
      <div className="stat-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '12px' }}>
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
        <PnlCard label="FY P&L" value={fyPnlReal} isPositive={fyPnlReal >= 0} sparkId="fy" equityCurve={equityCurveData} roi={fyRoi} />
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
              {dedupeLog(log).map((line, i) => {
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
