import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { algosAPI, gridAPI, holidaysAPI } from '@/services/api'
import { useStore } from '@/store'

// ── Types ──────────────────────────────────────────────────────────────────────
const DAYS    = ['MON','TUE','WED','THU','FRI']
const WEEKENDS = ['SAT','SUN']
type CS = 'no_trade'|'waiting'|'algo_active'|'order_pending'|'open'|'algo_closed'|'error'
type CM = 'practix'|'live'

interface Cell {
  gridEntryId?: string   // API id — needed for all mutations
  multiplier:   number
  status:       CS
  mode:         CM
  entry:        string
  exit?:        string
  pnl?:         number
}
interface Algo {
  id:            string
  name:          string
  account:       string
  legs:          {i:string; d:'B'|'S'}[]
  et:            string
  xt:            string
  arch:          boolean
  recurringDays: string[]   // ["MON","WED"] — server is source of truth
  is_live:       boolean
}

// ── Status config ──────────────────────────────────────────────────────────────
const SC: Record<CS,{label:string;col:string;bg:string;pct:number}> = {
  no_trade:     {label:'No Trade',col:'#6B7280',bg:'rgba(107,114,128,0.12)',pct:0},
  waiting:      {label:'Waiting', col:'#F59E0B',bg:'rgba(245,158,11,0.10)',pct:15},
  algo_active:  {label:'Active',  col:'#00B0F0',bg:'rgba(0,176,240,0.12)', pct:30},
  order_pending:{label:'Pending', col:'#F59E0B',bg:'rgba(245,158,11,0.12)',pct:50},
  open:         {label:'Open',    col:'#22C55E',bg:'rgba(34,197,94,0.12)', pct:75},
  algo_closed:  {label:'Closed',  col:'#16a34a',bg:'rgba(22,163,74,0.12)',pct:100},
  error:        {label:'Error',   col:'#EF4444',bg:'rgba(239,68,68,0.12)',pct:60},
}

function getWeekDates(): Record<string, string> {
  // Use pure UTC arithmetic with hardcoded IST offset (UTC+5:30 = 330 min)
  // Avoids toLocaleString→local Date→toISOString round-trip which shifts dates for non-IST users
  const IST_OFFSET_MS = 330 * 60 * 1000
  const nowUtcMs = Date.now()
  const istMs    = nowUtcMs + IST_OFFSET_MS
  const ist      = new Date(istMs)
  const dow      = ist.getUTCDay()
  const mondayMs = istMs - (dow === 0 ? 6 : dow - 1) * 86400000
  const names    = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
  const map: Record<string, string> = {}
  for (let i = 0; i < 7; i++) {
    const d = new Date(mondayMs + i * 86400000)
    const y = d.getUTCFullYear()
    const m = String(d.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(d.getUTCDate()).padStart(2, '0')
    map[names[i]] = `${y}-${m}-${dd}`
  }
  return map
}

/** Convert ISO date to day abbreviation */
function dateToDay(iso: string, weekDates: Record<string, string>): string | null {
  return Object.entries(weekDates).find(([, v]) => v === iso)?.[0] ?? null
}

/** Convert API status string to Cell status */
function mapStatus(s: string): CS {
  const m: Record<string, CS> = {
    algo_active:   'algo_active',
    order_pending: 'order_pending',
    open:          'open',
    algo_closed:   'algo_closed',
    no_trade:      'no_trade',
    error:         'error',
    waiting:       'waiting',
    active:        'open',
    closed:        'algo_closed',
    terminated:    'algo_closed',
  }
  return m[s] ?? 'no_trade'
}

// ── Pie chart ──────────────────────────────────────────────────────────────────
function Pie({ s }: { s: CS }) {
  const c = SC[s], r = 12, cx = 14, cy = 14, ci = 2 * Math.PI * r
  const off = ci * (1 - c.pct / 100)
  return (
    <svg width="28" height="28" style={{ flexShrink: 0 }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="2.5"/>
      {c.pct > 0 && <circle cx={cx} cy={cy} r={r} fill="none" stroke={c.col} strokeWidth="2.5"
        strokeDasharray={ci} strokeDashoffset={off} strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}/>}
      <circle cx={cx} cy={cy} r="3" fill={c.col} opacity="0.9"/>
    </svg>
  )
}

function worstStatus(cells: Record<string, Cell> | undefined): CS {
  if (!cells) return 'no_trade'
  const v = Object.values(cells).map(c => c.status)
  for (const s of ['error','open','order_pending','algo_active','waiting','algo_closed'] as CS[])
    if (v.includes(s)) return s
  return 'no_trade'
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function GridPage() {
  const nav = useNavigate()
  const weekDates = getWeekDates()
  const isPractixMode  = useStore(s => s.isPractixMode)
  const activeAccount  = useStore(s => s.activeAccount)

  const [algos,    setAlgos]    = useState<Algo[]>([])
  const [grid,     setGrid]     = useState<Record<string, Record<string, Cell>>>({})
  const [, setLoading]  = useState(true)
  const [wk,       setWk]       = useState(() => localStorage.getItem('staax_show_weekends') === 'true')
  const [ed,       setEd]       = useState<{id:string;day:string} | null>(null)
  const [ev,       setEv]       = useState('')
  const [drag,     setDrag]     = useState<string | null>(null)
  const [showArch, setShowArch] = useState(false)
  const [del,           setDel]          = useState<string | null>(null)
  const [archConfirm,   setArchConfirm]  = useState<string | null>(null)
  const [opError,       setOpError]      = useState<string>('')   // inline op error
  const [autoFillToast, setAutoFillToast] = useState<string>('')  // "Auto-filled N recurring day(s)"
  const [holidayDates,  setHolidayDates]  = useState<Set<string>>(new Set())  // ISO dates that are FO holidays
  const [rmModal,       setRmModal]      = useState<{algoId:string; day:string} | null>(null)
  const [sortBy,        setSortBy]       = useState<string>(() => localStorage.getItem('staax_grid_sort') || 'date_desc')

  const days = wk ? [...DAYS, ...WEEKENDS] : DAYS

  // ── Show op error briefly ────────────────────────────────────────────────────
  const flashError = (msg: string) => {
    setOpError(msg)
    setTimeout(() => setOpError(''), 3500)
  }

  // ── Load on mount ─────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      // Load algos
      const algoRes = await algosAPI.list()
      const apiAlgos: Algo[] = (algoRes.data || []).map((a: any) => ({
        id:            String(a.id),
        name:          a.name,
        account:       a.account_nickname || '',
        legs:          (a.legs || []).map((l: any) => ({
          i: (({'NIFTY':'NF','BANKNIFTY':'BN','SENSEX':'SX','MIDCAPNIFTY':'MN','FINNIFTY':'FN'} as Record<string,string>)[l.underlying] || (l.underlying||'NF').slice(0,2).toUpperCase()),
          d: l.direction === 'buy' ? 'B' : 'S',
        })),
        et:            a.entry_time || '09:16',
        xt:            a.exit_time  || '15:10',
        arch:          a.is_archived || false,
        recurringDays: Array.isArray(a.recurring_days) ? a.recurring_days : [],
        is_live:       a.is_live || false,
      }))
      setAlgos(apiAlgos)

      // Load grid entries for this week — pass SUN so SAT/SUN entries are returned
      const weekStart = weekDates['MON']
      const weekEnd   = weekDates['SUN']
      const gridRes = await gridAPI.list({ week_start: weekStart, week_end: weekEnd, is_practix: isPractixMode, ...(activeAccount ? { account_id: activeAccount } : {}) })
      const entries: any[] = gridRes.data?.entries || gridRes.data || []

      if (true) {  // always rebuild grid from API
        const newGrid: Record<string, Record<string, Cell>> = {}
        for (const e of entries) {
          const algoId = String(e.algo_id)
          const day    = dateToDay(e.trading_date, weekDates)
          if (!day) continue
          if (!newGrid[algoId]) newGrid[algoId] = {}
          const algoMatch = apiAlgos.find(a => a.id === algoId)
          newGrid[algoId][day] = {
            gridEntryId: String(e.id),
            multiplier:  e.lot_multiplier || 1,
            status:      mapStatus(e.status || 'algo_active'),
            mode:        e.is_practix ? 'practix' : 'live',
            entry:       e.entry_time  || algoMatch?.et || '09:16',
            exit:        e.exit_time   || algoMatch?.xt || '15:10',
            pnl:         e.pnl ?? undefined,
          }
        }
        setGrid(newGrid)

        // ── Auto-fill recurring days ─────────────────────────────────────────
        // For each active algo with recurring_days, deploy missing days silently.
        let autoFilled = 0
        const updatedAlgos = [...apiAlgos]
        await Promise.all((isPractixMode ? apiAlgos.filter(a => !a.arch && a.recurringDays.length > 0) : []).map(async algo => {
          const missingDays = DAYS.filter(d => algo.recurringDays.includes(d) && !newGrid[algo.id]?.[d])
          for (const day of missingDays) {
            try {
              const res = await gridAPI.deploy({
                algo_id: algo.id, trading_date: weekDates[day],
                lot_multiplier: 1, is_practix: true,
              })
              const gridEntryId = String(res.data?.id || '')
              newGrid[algo.id] = newGrid[algo.id] || {}
              newGrid[algo.id][day] = {
                gridEntryId,
                multiplier: 1,
                status:     mapStatus(res.data?.status || 'no_trade'),
                mode:       'practix',
                entry:      algo.et,
                exit:       algo.xt,
              }
              // Sync recurringDays from server response
              const idx = updatedAlgos.findIndex(a => a.id === algo.id)
              if (idx >= 0 && Array.isArray(res.data?.algo_recurring_days)) {
                updatedAlgos[idx] = { ...updatedAlgos[idx], recurringDays: res.data.algo_recurring_days }
              }
              autoFilled++
            } catch {
              // Silent — don't block the rest of the load
            }
          }
        }))
        if (autoFilled > 0) {
          setGrid({ ...newGrid })
          setAlgos(updatedAlgos)
          setAutoFillToast(`Auto-filled ${autoFilled} recurring day${autoFilled > 1 ? 's' : ''}`)
          setTimeout(() => setAutoFillToast(''), 3500)
        }
      }
    } catch {
      // API unreachable — keep demo data, user can still interact
    } finally {
      setLoading(false)
    }
  }, [isPractixMode, activeAccount])

  useEffect(() => { loadData() }, [loadData])

  // ── Load market holidays for current week ────────────────────────────────────
  useEffect(() => {
    holidaysAPI.list(new Date().getFullYear())
      .then(res => {
        const foHolidays = (res.data || []).filter((h: any) => h.segment === 'fo')
        setHolidayDates(new Set(foHolidays.map((h: any) => h.date)))
      })
      .catch(() => {})
  }, [])

  // ── Drop (deploy) ─────────────────────────────────────────────────────────────
  const onDrop = async (algoId: string, day: string) => {
    if (!drag || drag !== algoId || grid[algoId]?.[day]) return
    setDrag(null)

    const algo        = algos.find(x => x.id === algoId)
    const tradingDate = weekDates[day]

    // Optimistic UI update immediately
    setGrid(g => ({
      ...g,
      [algoId]: {
        ...g[algoId],
        [day]: {
          multiplier: 1,
          status:     'algo_active',
          mode:       isPractixMode ? 'practix' : 'live',
          entry:      algo?.et || '09:16',
          exit:       algo?.xt || '15:10',
        },
      },
    }))

    try {
      const res = await gridAPI.deploy({
        algo_id:       algoId,
        trading_date:  tradingDate,
        lot_multiplier: 1,
        is_practix:    isPractixMode,
      })
      // Patch in the real grid_entry_id from API response
      const gridEntryId = String(res.data?.id || '')
      setGrid(g => ({
        ...g,
        [algoId]: { ...g[algoId], [day]: { ...g[algoId][day], gridEntryId } },
      }))
      // Sync recurringDays from server
      if (Array.isArray(res.data?.algo_recurring_days)) {
        setAlgos(a => a.map(x => x.id === algoId ? { ...x, recurringDays: res.data.algo_recurring_days } : x))
      }
    } catch (e: any) {
      // Rollback optimistic update
      setGrid(g => {
        const u = { ...g[algoId] }
        delete u[day]
        return { ...g, [algoId]: u }
      })
      flashError(e?.response?.data?.detail || 'Deploy failed')
    }
  }

  // ── Remove cell — opens modal for Just Today / Remove Recurring ──────────────
  const rmCell = (algoId: string, day: string) => {
    const cellStatus = grid[algoId]?.[day]?.status
    if (cellStatus === 'algo_active' || cellStatus === 'waiting' || cellStatus === 'open' || cellStatus === 'order_pending') {
      flashError('Cannot remove an active algo from this day')
      return
    }
    setRmModal({ algoId, day })
  }

  const doRemove = async (algoId: string, day: string, removeRecurring: boolean) => {
    const cell = grid[algoId]?.[day]
    setRmModal(null)

    // Optimistic remove
    setGrid(g => {
      const u = { ...g[algoId] }
      delete u[day]
      return { ...g, [algoId]: u }
    })

    if (cell?.gridEntryId) {
      try {
        const res = await gridAPI.remove(cell.gridEntryId, removeRecurring)
        // Sync recurringDays from server if we removed the recurring flag
        if (removeRecurring && Array.isArray(res.data?.algo_recurring_days)) {
          setAlgos(a => a.map(x => x.id === algoId ? { ...x, recurringDays: res.data.algo_recurring_days } : x))
        }
      } catch {
        // Restore on failure
        setGrid(g => ({ ...g, [algoId]: { ...g[algoId], [day]: cell } }))
        flashError('Remove failed — try again')
      }
    }
  }

  // ── Change multiplier ─────────────────────────────────────────────────────────
  const setM = async (algoId: string, day: string, v: number) => {
    if (v < 1) return
    const cell = grid[algoId]?.[day]
    setGrid(g => ({ ...g, [algoId]: { ...g[algoId], [day]: { ...g[algoId][day], multiplier: v } } }))

    if (cell?.gridEntryId) {
      try {
        await gridAPI.update(cell.gridEntryId, { lot_multiplier: v })
      } catch {
        // Restore original
        setGrid(g => ({ ...g, [algoId]: { ...g[algoId], [day]: { ...g[algoId][day], multiplier: cell.multiplier } } }))
        flashError('Multiplier update failed')
      }
    }
  }

  // ── Promote to live ──────────────────────────────────────────────────────────
  const promLive = async (algoId: string) => {
    await algosAPI.promote(algoId)
    setAlgos(a => a.map(x => x.id === algoId ? { ...x, is_live: true } : x))
    loadData()
  }

  // ── Demote back to PRACTIX ────────────────────────────────────────────────────
  const demoteLive = async (algoId: string) => {
    await algosAPI.demote(algoId)
    setAlgos(a => a.map(x => x.id === algoId ? { ...x, is_live: false } : x))
    loadData()
  }

  // ── Add algo to all weekdays ──────────────────────────────────────────────────
  const addAllWeekdays = async (algoId: string) => {
    const algo      = algos.find(x => x.id === algoId)
    const missing   = DAYS.filter(d => !grid[algoId]?.[d])
    if (!missing.length) return

    // Optimistic UI for all missing days
    setGrid(g => ({
      ...g,
      [algoId]: {
        ...g[algoId],
        ...Object.fromEntries(missing.map(d => [d, {
          multiplier: 1, status: 'algo_active' as CS, mode: 'practix' as CM,
          entry: algo?.et || '09:16', exit: algo?.xt || '15:10',
        }])),
      },
    }))

    await Promise.all(missing.map(async day => {
      try {
        const res = await gridAPI.deploy({
          algo_id: algoId, trading_date: weekDates[day],
          lot_multiplier: 1, is_practix: isPractixMode,
        })
        const gridEntryId = String(res.data?.id || '')
        setGrid(g => ({
          ...g,
          [algoId]: { ...g[algoId], [day]: { ...g[algoId][day], gridEntryId } },
        }))
        // Sync recurringDays from server (FOR UPDATE ensures correct state)
        if (Array.isArray(res.data?.algo_recurring_days)) {
          setAlgos(a => a.map(x => x.id === algoId ? { ...x, recurringDays: res.data.algo_recurring_days } : x))
        }
      } catch (e: any) {
        // Rollback this day
        setGrid(g => {
          const u = { ...g[algoId] }; delete u[day]; return { ...g, [algoId]: u }
        })
        flashError(e?.response?.data?.detail || `Deploy failed for ${day}`)
      }
    }))
  }

  // ── Add ALL active algos to today's column ────────────────────────────────────
  const addAllToToday = async () => {
    const now = new Date()
    const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
    const dow = ist.getDay()
    // If weekend, navigate to previous Friday instead
    const targetDow = dow === 0 ? 5 : dow === 6 ? 5 : dow
    const dayNames = ['SUN','MON','TUE','WED','THU','FRI','SAT']
    const todayDay = dayNames[targetDow]
    if (!days.includes(todayDay)) { flashError('Today is not a trading day'); return }
    const tradingDate = weekDates[todayDay]
    const algosToAdd  = sortedActive.filter(a => !grid[a.id]?.[todayDay])
    if (!algosToAdd.length) return

    setGrid(g => {
      const u = { ...g }
      for (const a of algosToAdd)
        u[a.id] = { ...g[a.id], [todayDay]: { multiplier:1, status:'algo_active' as CS, mode:'practix' as CM, entry:a.et||'09:16', exit:a.xt||'15:10' } }
      return u
    })

    await Promise.all(algosToAdd.map(async a => {
      try {
        const res = await gridAPI.deploy({ algo_id:a.id, trading_date:tradingDate, lot_multiplier:1, is_practix:isPractixMode })
        const gridEntryId = String(res.data?.id || '')
        setGrid(g => ({ ...g, [a.id]: { ...g[a.id], [todayDay]: { ...g[a.id][todayDay], gridEntryId } } }))
        if (Array.isArray(res.data?.algo_recurring_days)) {
          setAlgos(al => al.map(x => x.id === a.id ? { ...x, recurringDays: res.data.algo_recurring_days } : x))
        }
      } catch (e: any) {
        setGrid(g => { const u = { ...g[a.id] }; delete u[todayDay]; return { ...g, [a.id]: u } })
        flashError(e?.response?.data?.detail || `Deploy failed for ${a.name}`)
      }
    }))
  }

  // ── Archive algo ──────────────────────────────────────────────────────────────
  const archAlgo = async (algoId: string) => {
    const algoCells = Object.values(grid[algoId] || {})
    const hasActive = algoCells.some(c => c.status === 'algo_active' || c.status === 'waiting' || c.status === 'open' || c.status === 'order_pending')
    if (hasActive) { flashError('Cannot archive — algo has active positions this week'); return }
    setAlgos(a => a.map(x => x.id === algoId ? { ...x, arch: true } : x))
    setGrid(g => { const n = { ...g }; delete n[algoId]; return n })

    try {
      await algosAPI.archive(algoId)
    } catch {
      // Restore — reload from API
      loadData()
      flashError('Archive failed')
    }
  }

  // ── Unarchive ─────────────────────────────────────────────────────────────────
  const unarch = async (algoId: string) => {
    setAlgos(a => a.map(x => x.id === algoId ? { ...x, arch: false } : x))

    try {
      await algosAPI.unarchive(algoId)
    } catch {
      setAlgos(a => a.map(x => x.id === algoId ? { ...x, arch: true } : x))
      flashError('Reactivate failed')
    }
  }

  // ── Delete algo ───────────────────────────────────────────────────────────────
  const delAlgo = async (algoId: string) => {
    setAlgos(a => a.filter(x => x.id !== algoId))
    setGrid(g => { const n = { ...g }; delete n[algoId]; return n })
    setDel(null)

    try {
      await algosAPI.delete(algoId)
    } catch {
      loadData()
      flashError('Delete failed')
    }
  }

  // ── Icon button ───────────────────────────────────────────────────────────────
  const IBtn = ({ onClick, icon, hc, title }: { onClick: ()=>void; icon:string; hc:string; title:string }) => (
    <button onClick={onClick} title={title}
      style={{ width:'22px', height:'22px', borderRadius:'3px', border:'none', background:'transparent',
        color:'var(--text-dim)', fontSize:'13px', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}
      onMouseEnter={e => { const b = e.currentTarget as HTMLButtonElement; b.style.color = hc; b.style.background = `${hc}22` }}
      onMouseLeave={e => { const b = e.currentTarget as HTMLButtonElement; b.style.color = 'var(--text-dim)'; b.style.background = 'transparent' }}>
      {icon}
    </button>
  )

  const active   = algos.filter(a => !a.arch)
  const archived = algos.filter(a => a.arch)

  const sortedActive = [...active].sort((a, b) => {
    if (sortBy === 'name_asc')  return a.name.localeCompare(b.name)
    if (sortBy === 'name_desc') return b.name.localeCompare(a.name)
    if (sortBy === 'buy_first') {
      const aHasBuy = a.legs.some(l => l.d === 'B') ? 0 : 1
      const bHasBuy = b.legs.some(l => l.d === 'B') ? 0 : 1
      return aHasBuy - bHasBuy
    }
    if (sortBy === 'sell_first') {
      const aHasSell = a.legs.some(l => l.d === 'S') ? 0 : 1
      const bHasSell = b.legs.some(l => l.d === 'S') ? 0 : 1
      return aHasSell - bHasSell
    }
    return 0  // date_desc = API order (default)
  })

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display:'flex', flexDirection:'column', height:'calc(100vh - 92px)' }}>
      {/* Header */}
      <div style={{ flexShrink: 0, borderBottom: '1px solid var(--bg-border)', paddingBottom: '4px' }}>
      <div className="page-header">
        <div>
          <h1 style={{ fontFamily:"'ADLaM Display',serif", fontSize:'22px', fontWeight:400 }}>Smart Grid</h1>
          <p style={{ fontSize:'12px', color:'var(--text-muted)', marginTop:'2px', display:'flex', alignItems:'center', gap:'6px' }}>
            Week of {new Date().toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric', timeZone:'Asia/Kolkata' })} ·{' '}
            <span style={{fontSize:'10px',fontWeight:700,padding:'2px 6px',borderRadius:'4px',background:isPractixMode?'rgba(215,123,18,0.15)':'rgba(34,197,94,0.12)',color:isPractixMode?'var(--accent-amber)':'var(--green)',border:isPractixMode?'1px solid rgba(215,123,18,0.3)':'1px solid rgba(34,197,94,0.25)'}}>
              {isPractixMode?'PRACTIX':'LIVE'}
            </span>
          </p>
        </div>
        <div className="page-header-actions">
          {opError && (
            <span style={{ fontSize:'11px', color:'var(--red)', fontWeight:600 }}>⚠ {opError}</span>
          )}
          {autoFillToast && (
            <span style={{ fontSize:'11px', color:'var(--accent-blue)', fontWeight:600 }}>↻ {autoFillToast}</span>
          )}
          <label style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'12px', color:'var(--text-muted)', cursor:'pointer' }}>
            <input type="checkbox" checked={wk} onChange={e => { setWk(e.target.checked); localStorage.setItem('staax_show_weekends', String(e.target.checked)) }} style={{ accentColor:'var(--accent-blue)' }}/>
            Show Weekends
          </label>
          <select value={sortBy} onChange={e => { setSortBy(e.target.value); localStorage.setItem('staax_grid_sort', e.target.value) }}
            className="staax-select" style={{ width:'130px' }}>
            <option value="date_desc">Date Created</option>
            <option value="name_asc">Name A → Z</option>
            <option value="name_desc">Name Z → A</option>
            <option value="buy_first">Buy first</option>
            <option value="sell_first">Sell first</option>
          </select>
          <button className="btn btn-ghost" style={{ position:'relative', fontSize:'12px', display:'flex', alignItems:'center', gap:'6px' }} onClick={() => setShowArch(v => !v)}>
            <span style={{ fontSize:'14px' }}>📦</span> Archive
            {archived.length > 0 && <span style={{ position:'absolute', top:'4px', right:'4px', width:'6px', height:'6px', borderRadius:'50%', background:'var(--accent-amber)' }}/>}
          </button>

        </div>
      </div>
      </div>{/* end header */}

      {/* Archive panel */}
      {showArch && (
        <div style={{ flexShrink: 0, background:'rgba(215,123,18,0.07)', border:'1px solid rgba(215,123,18,0.22)', borderRadius:'8px', padding:'14px 16px', margin:'8px 0' }}>
          <div style={{ fontSize:'11px', fontWeight:700, color:'var(--accent-amber)', marginBottom:'8px', textTransform:'uppercase', letterSpacing:'0.08em' }}>📦 Archived Algos</div>
          {archived.length === 0
            ? <span style={{ fontSize:'12px', color:'var(--text-dim)' }}>No archived algos.</span>
            : <div style={{ display:'flex', flexWrap:'wrap', gap:'8px' }}>
                {archived.map(a => (
                  <div key={a.id} style={{ display:'flex', alignItems:'center', gap:'10px', background:'var(--bg-secondary)', borderRadius:'6px', padding:'8px 12px', border:'1px solid var(--bg-border)' }}>
                    <div>
                      <div style={{ fontSize:'12px', fontWeight:600 }}>{a.name}</div>
                      <div style={{ fontSize:'10px', color:'var(--text-dim)' }}>{a.account}</div>
                    </div>
                    <button className="btn btn-ghost" style={{ fontSize:'11px', height:'26px', padding:'0 10px' }}
                      onClick={() => unarch(a.id)}>↩ Reactivate</button>
                  </div>
                ))}
              </div>}
        </div>
      )}

      {/* Legend */}
      <div style={{ flexShrink: 0, display:'flex', gap:'12px', margin:'8px 0', flexWrap:'wrap', alignItems:'center', padding:'6px 12px', background:'var(--bg-secondary)', borderRadius:'6px', border:'1px solid var(--bg-border)' }}>
        {Object.entries(SC).map(([k, s]) => (
          <span key={k} style={{ display:'flex', alignItems:'center', gap:'5px', fontSize:'11px', color:'var(--text-muted)' }}>
            <span style={{ width:'7px', height:'7px', borderRadius:'2px', background:s.col, display:'inline-block' }}/>{s.label}
          </span>
        ))}
        <span style={{ marginLeft:'auto', fontSize:'10px', color:'var(--text-dim)' }}>
          drag pie → day to deploy
        </span>
      </div>

      {/* Grid table — flex:1 fills remaining height, overflowX:auto scrolls when weekends shown */}
      <div className="no-scrollbar" style={{ flex: 1, overflowX: 'auto', overflowY: 'auto', width: '100%' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', tableLayout:'fixed' }}>
          <colgroup>
            <col style={{ width:'200px' }}/>
            {days.map(d => <col key={d} style={{ width:'140px' }}/>)}
          </colgroup>
          <thead>
            <tr>
              <th className="grid-sticky-th" style={{ position:'sticky', top:0, zIndex:2, padding:'8px 12px', textAlign:'left', background:'var(--bg-secondary)', border:'1px solid var(--bg-border)', fontSize:'10px', color:'var(--text-muted)', fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase' }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                  ALGO
                  <button onClick={addAllToToday} title="Deploy all active algos to today (or Friday if weekend)"
                    style={{ fontSize:'9px', padding:'1px 6px', borderRadius:'3px', height:'17px', border:'1px solid rgba(0,176,240,0.3)', background:'transparent', color:'var(--accent-blue)', cursor:'pointer', fontWeight:600 }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,176,240,0.08)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    All → Today
                  </button>
                </div>
              </th>
              {days.map(d => {
                const isoDate   = weekDates[d] || ''
                const isHoliday = isoDate ? holidayDates.has(isoDate) : false
                return (
                  <th key={d} className="grid-sticky-th" style={{
                    position:'sticky', top:0, zIndex:2, padding:'8px 12px', textAlign:'center',
                    background: isHoliday ? 'color-mix(in srgb, var(--bg-secondary) 88%, var(--accent-amber) 12%)' : 'var(--bg-secondary)',
                    border:'1px solid var(--bg-border)', fontSize:'10px', fontWeight:700,
                    letterSpacing:'0.08em', textTransform:'uppercase',
                    color: isHoliday ? 'var(--accent-amber)' : WEEKENDS.includes(d) ? 'var(--text-dim)' : 'var(--text-muted)',
                  }}>
                    {d}
                    <div style={{ fontSize:'9px', color: isHoliday ? 'var(--accent-amber)' : 'var(--text-dim)', fontWeight:400, marginTop:'1px', opacity: isHoliday ? 1 : undefined }}>
                      {weekDates[d] ? weekDates[d].slice(8) + '-' + weekDates[d].slice(5,7) : ''}
                    </div>
                    {isHoliday && (
                      <div style={{ fontSize:'8px', color:'var(--accent-amber)', fontWeight:600, marginTop:'1px', letterSpacing:'0.04em' }}>
                        HOLIDAY
                      </div>
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {sortedActive
              .filter(algo => isPractixMode ? !algo.is_live : algo.is_live)
              .map(algo => {
              const st    = worstStatus(grid[algo.id])
              const cells = Object.values(grid[algo.id] || {})
              return (
                <tr key={algo.id}>
                  {/* Algo label column */}
                  <td style={{ padding:'8px 10px', background:'var(--bg-secondary)', border:'1px solid var(--bg-border)', verticalAlign:'top' }}>
                    <div style={{ display:'flex', alignItems:'flex-start', gap:'6px' }}>
                      <div draggable onDragStart={() => setDrag(algo.id)} onDragEnd={() => setDrag(null)}
                        title="Drag to deploy" style={{ cursor:'grab', flexShrink:0, paddingTop:'2px' }}>
                        <Pie s={st}/>
                      </div>
                      <div style={{ flex:1, minWidth:0 }}>
                        {/* Row 1: Name */}
                        <div onClick={() => nav(`/algo/${algo.id}`)} title="Click to edit"
                          style={{ fontWeight:700, fontSize:'12px', color:'var(--accent-blue)', cursor:'pointer', marginBottom:'3px',
                            whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
                            textDecoration:'underline', textDecorationStyle:'dotted', textDecorationColor:'rgba(0,176,240,0.35)' }}>
                          {algo.name}
                        </div>
                        {/* Row 2: Account name */}
                        <div style={{ marginBottom:'3px' }}>
                          <span style={{ fontSize:'9px', color:'var(--text-dim)', background:'var(--bg-surface)', padding:'1px 5px', borderRadius:'3px', border:'1px solid var(--bg-border)' }}>{algo.account}</span>
                        </div>
                        {/* Row 3: Instrument chips */}
                        <div style={{ display:'flex', alignItems:'center', gap:'3px', flexWrap:'wrap', marginBottom:'4px' }}>
                          {algo.legs.map((l, i) => (
                            <span key={i} style={{ fontSize:'9px', fontWeight:700, padding:'1px 4px', borderRadius:'3px',
                              background: l.d==='B' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                              color:      l.d==='B' ? 'var(--green)'          : 'var(--red)',
                              border:     `1px solid ${l.d==='B' ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}` }}>
                              {l.i}{l.d}
                            </span>
                          ))}
                        </div>
                        {/* Row 3: → All days + → Promote to Live on same line */}
                        {(DAYS.some(d => !grid[algo.id]?.[d]) || cells.some(c => c.mode === 'practix') || (!isPractixMode && algo.is_live)) && (
                          <div style={{ display:'flex', gap:'4px', flexWrap:'wrap' }}>
                            {DAYS.some(d => !grid[algo.id]?.[d]) && (
                              <button onClick={() => addAllWeekdays(algo.id)}
                                style={{ fontSize:'9px', padding:'1px 6px', borderRadius:'3px', height:'17px', border:'1px solid rgba(0,176,240,0.3)', background:'transparent', color:'var(--accent-blue)', cursor:'pointer' }}
                                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,176,240,0.08)')}
                                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                                All
                              </button>
                            )}
                            {isPractixMode && cells.some(c => c.mode === 'practix') && (
                              <button onClick={() => promLive(algo.id)}
                                style={{ fontSize:'9px', padding:'1px 6px', borderRadius:'3px', height:'17px', border:'1px solid rgba(34,197,94,0.3)', background:'transparent', color:'var(--green)', cursor:'pointer' }}
                                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(34,197,94,0.1)')}
                                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                                Promote
                              </button>
                            )}
                            {!isPractixMode && algo.is_live && (
                              <button onClick={() => demoteLive(algo.id)}
                                style={{ fontSize:'9px', padding:'1px 6px', borderRadius:'3px', height:'17px', border:'1px solid rgba(239,68,68,0.3)', background:'transparent', color:'var(--red)', cursor:'pointer' }}
                                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.1)')}
                                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                                Demote
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      <div style={{ display:'flex', flexDirection:'column', gap:'2px', flexShrink:0 }}>
                        <IBtn onClick={() => setDel(algo.id)}  icon="🗑" hc="var(--red)"          title="Delete permanently"/>
                        <IBtn onClick={() => setArchConfirm(algo.id)} icon="📦" hc="var(--accent-amber)" title="Archive"/>
                      </div>
                    </div>
                  </td>

                  {/* Day cells */}
                  {days.map(day => {
                    const cell      = grid[algo.id]?.[day]
                    const s         = cell ? SC[cell.status] : null
                    const isHolDay  = weekDates[day] ? holidayDates.has(weekDates[day]) : false
                    // MISSED: waiting cell for today where current IST time >= entry time
                    const isToday   = weekDates[day] === weekDates[(() => {
                      const IST_OFFSET_MS = 330 * 60 * 1000
                      const ist = new Date(Date.now() + IST_OFFSET_MS)
                      return ['SUN','MON','TUE','WED','THU','FRI','SAT'][ist.getUTCDay()]
                    })()]
                    const isMissed  = cell?.status === 'waiting' && isToday && !!cell.entry && (() => {
                      const now = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false })
                      return now >= cell.entry.slice(0, 5)
                    })()
                    return (
                      <td key={day}
                        onDragOver={e => e.preventDefault()}
                        onDrop={() => onDrop(algo.id, day)}
                        style={{ padding:'4px', border:'1px solid var(--bg-border)', verticalAlign:'top', overflow:'hidden',
                          background: isHolDay && !cell ? 'color-mix(in srgb, var(--bg-secondary) 96%, var(--accent-amber) 4%)' : WEEKENDS.includes(day) && !cell ? 'rgba(30,32,34,0.4)' : undefined,
                          opacity: isHolDay && !cell ? 0.6 : undefined }}>
                        {cell && s
                          ? (
                            <div style={{ background:'var(--bg-secondary)', borderLeft:`3px solid ${isMissed ? 'var(--accent-amber)' : s.col}`, borderRadius:'5px', padding:'6px 8px', position:'relative', overflow:'hidden', opacity: isMissed ? 0.7 : 1 }}>
                              <button onClick={() => rmCell(algo.id, day)}
                                style={{ position:'absolute', top:'2px', right:'2px', background:'none', border:'none', cursor:'pointer', color:'var(--text-dim)', fontSize:'10px', padding:'2px 3px', lineHeight:1 }}
                                onMouseEnter={e => (e.currentTarget.style.color = 'var(--red)')}
                                onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-dim)')}>✕</button>

                              <div style={{ display:'flex', alignItems:'center', marginBottom:'4px', paddingRight:'12px' }}>
                                <span style={{ fontSize:'9px', fontWeight:700,
                                  color: isMissed ? 'var(--accent-amber)' : s.col,
                                  background: isMissed ? 'rgba(215,123,18,0.12)' : s.bg,
                                  padding:'1px 5px', borderRadius:'3px' }}>
                                  {isMissed ? 'MISSED' : s.label.toUpperCase()}
                                </span>
                              </div>

                              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'2px 4px', alignItems:'center' }}>
                                <div style={{ display:'flex', alignItems:'center', gap:'4px' }}>
                                  <span style={{ fontSize:'10px', color:'var(--text)', fontWeight:600 }}>M</span>
                                  {ed?.id === algo.id && ed?.day === day
                                    ? <input autoFocus type="number" min={1} value={ev}
                                        onChange={e => setEv(e.target.value)}
                                        onBlur={() => { setM(algo.id, day, parseInt(ev) || 1); setEd(null) }}
                                        onKeyDown={e => e.key === 'Enter' && (setM(algo.id, day, parseInt(ev) || 1), setEd(null))}
                                        style={{ width:'44px', background:'var(--bg-primary)', border:'1px solid var(--accent-blue)', borderRadius:'2px', color:'var(--text)', fontSize:'10px', padding:'0 3px', fontFamily:'inherit' }}/>
                                    : <span onClick={() => { setEd({ id: algo.id, day }); setEv(String(cell.multiplier)) }}
                                        style={{ display:'block', width:'100%', textAlign:'center', cursor:'pointer', padding:'8px 12px', margin:'-8px -12px',
                                          fontSize:'10px', fontWeight:700, color:'var(--accent-blue)',
                                          textDecoration:'underline', textDecorationStyle:'dotted', textDecorationColor:'rgba(0,176,240,0.4)' }}>
                                        {cell.multiplier}
                                      </span>}
                                </div>
                                <div style={{ textAlign:'right' }}>
                                  {cell.pnl != null && (
                                    <span style={{ fontSize:'10px', fontWeight:700, color: cell.pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
                                      {cell.pnl >= 0 ? '+' : ''}{(cell.pnl / 1000).toFixed(1)}k
                                    </span>
                                  )}
                                </div>
                                <div style={{ display:'flex', alignItems:'center', gap:'4px' }}>
                                  <span style={{ fontSize:'10px', color:'var(--text)', fontWeight:600 }}>E</span>
                                  <span style={{ fontSize:'10px', color:'var(--accent-blue)', fontWeight:600 }}>{cell.entry}</span>
                                </div>
                                <div style={{ textAlign:'right' }}>
                                  {cell.exit && <span style={{ fontSize:'10px', color:'var(--text-muted)' }}>X {cell.exit}</span>}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div style={{ minHeight:'56px', border:'1px dashed var(--bg-border)', borderRadius:'5px',
                              display:'flex', alignItems:'center', justifyContent:'center', fontSize:'10px',
                              background:   drag === algo.id ? 'rgba(0,176,240,0.05)' : 'transparent',
                              borderColor:  drag === algo.id ? 'var(--accent-blue)'   : 'var(--bg-border)',
                              color:        drag === algo.id ? 'var(--accent-blue)'   : 'var(--text-dim)',
                              opacity:      drag === algo.id ? 1 : 0.35, transition:'all 0.15s' }}>
                              {drag === algo.id ? 'Drop here' : '—'}
                            </div>
                          )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Remove cell modal — Just Today vs Remove Recurring */}
      {rmModal && (() => {
        const algo = algos.find(x => x.id === rmModal.algoId)
        const isRecurring = algo?.recurringDays.includes(rmModal.day)
        return (
          <div className="modal-overlay">
            <div className="modal-box" style={{ maxWidth:'360px' }}>
              <div style={{ fontWeight:700, fontSize:'15px', marginBottom:'8px' }}>
                Remove {algo?.name} from {rmModal.day}?
              </div>
              {isRecurring
                ? <div style={{ fontSize:'13px', color:'var(--text-muted)', lineHeight:1.6, marginBottom:'18px' }}>
                    This algo recurs every <strong>{rmModal.day}</strong>. Remove just this week, or stop it recurring?
                  </div>
                : <div style={{ fontSize:'13px', color:'var(--text-muted)', lineHeight:1.6, marginBottom:'18px' }}>
                    Remove this entry from {rmModal.day}?
                  </div>
              }
              <div style={{ display:'flex', gap:'8px', justifyContent:'flex-end' }}>
                <button className="btn btn-ghost" onClick={() => setRmModal(null)}>Cancel</button>
                <button className="btn" style={{ background:'var(--bg-surface)', color:'var(--text-muted)', border:'1px solid var(--bg-border)' }}
                  onClick={() => doRemove(rmModal.algoId, rmModal.day, false)}>
                  Just Today
                </button>
                {isRecurring && (
                  <button className="btn" style={{ background:'rgba(239,68,68,0.15)', color:'var(--red)', border:'1px solid rgba(239,68,68,0.3)' }}
                    onClick={() => doRemove(rmModal.algoId, rmModal.day, true)}>
                    Remove Recurring
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {/* Archive confirmation modal */}
      {archConfirm && (() => {
        const a = algos.find(x => x.id === archConfirm)
        return (
          <div className="modal-overlay">
            <div className="modal-box" style={{ maxWidth:'360px' }}>
              <div style={{ fontWeight:700, fontSize:'16px', marginBottom:'8px' }}>Archive {a?.name}?</div>
              <div style={{ fontSize:'13px', color:'var(--text-muted)', lineHeight:1.6, marginBottom:'20px' }}>
                Moves this algo to the archive. It won't appear in the grid but can be restored anytime.
              </div>
              <div style={{ display:'flex', gap:'8px', justifyContent:'flex-end' }}>
                <button className="btn btn-ghost" onClick={() => setArchConfirm(null)}>Cancel</button>
                <button className="btn" style={{ background:'rgba(215,123,18,0.15)', color:'var(--accent-amber)', border:'1px solid rgba(215,123,18,0.3)' }}
                  onClick={() => { archAlgo(archConfirm); setArchConfirm(null) }}>📦 Archive</button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Delete modal */}
      {del && (() => {
        const a = algos.find(x => x.id === del)
        return (
          <div className="modal-overlay">
            <div className="modal-box" style={{ maxWidth:'380px' }}>
              <div style={{ fontWeight:700, fontSize:'16px', marginBottom:'8px' }}>Delete {a?.name}?</div>
              <div style={{ fontSize:'13px', color:'var(--text-muted)', lineHeight:1.6, marginBottom:'20px' }}>
                Permanently removes this algo and all grid deployments.<br/>
                <span style={{ color:'var(--accent-amber)', fontSize:'12px' }}>Tip: Archive keeps it recoverable.</span>
              </div>
              <div style={{ display:'flex', gap:'8px', justifyContent:'flex-end' }}>
                <button className="btn btn-ghost" onClick={() => setDel(null)}>Cancel</button>
                <button className="btn" style={{ background:'rgba(215,123,18,0.15)', color:'var(--accent-amber)', border:'1px solid rgba(215,123,18,0.3)' }}
                  onClick={() => { archAlgo(del); setDel(null) }}>📦 Archive Instead</button>
                <button className="btn" style={{ background:'var(--red)', color:'#fff' }}
                  onClick={() => delAlgo(del)}>Delete</button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
