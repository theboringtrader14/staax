import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { algosAPI, gridAPI } from '@/services/api'

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
  id:      string
  name:    string
  account: string
  legs:    {i:string; d:'B'|'S'}[]
  et:      string
  xt:      string
  arch:    boolean
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

// ── Demo fallback (shown when API is unreachable) ──────────────────────────────
const DEMO_ALGOS: Algo[] = [
  {id:'1',name:'AWS-1', account:'Karthik',legs:[{i:'NF',d:'B'},{i:'NF',d:'B'}],et:'09:16',xt:'15:10',arch:false},
  {id:'2',name:'TF-BUY',account:'Mom',    legs:[{i:'BN',d:'B'}],               et:'09:30',xt:'15:10',arch:false},
  {id:'3',name:'S1',    account:'Karthik',legs:[{i:'NF',d:'B'},{i:'NF',d:'S'}],et:'09:20',xt:'15:10',arch:false},
]
const DEMO_GRID: Record<string,Record<string,Cell>> = {
  '1':{MON:{multiplier:1,status:'open',       mode:'practix',entry:'09:16',exit:'15:10',pnl:1325},
       TUE:{multiplier:1,status:'algo_closed',mode:'practix',entry:'09:16',exit:'15:10',pnl:-840}},
  '2':{MON:{multiplier:2,status:'algo_active',mode:'live',   entry:'09:30',exit:'15:10'}},
}

// ── Date helpers ───────────────────────────────────────────────────────────────
/** Get ISO date string (YYYY-MM-DD) for each day of the current week */
function getWeekDates(): Record<string, string> {
  const now    = new Date()
  const ist    = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const dow    = ist.getDay()                         // 0=Sun
  const monday = new Date(ist)
  monday.setDate(ist.getDate() - (dow === 0 ? 6 : dow - 1))

  const map: Record<string, string> = {}
  const names = ['MON','TUE','WED','THU','FRI','SAT','SUN']
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    map[names[i]] = d.toISOString().slice(0, 10)
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

  const [algos,    setAlgos]    = useState<Algo[]>([])
  const [grid,     setGrid]     = useState<Record<string, Record<string, Cell>>>({})
  const [loading,  setLoading]  = useState(true)
  const [wk,       setWk]       = useState(false)
  const [ed,       setEd]       = useState<{id:string;day:string} | null>(null)
  const [ev,       setEv]       = useState('')
  const [drag,     setDrag]     = useState<string | null>(null)
  const [showArch, setShowArch] = useState(false)
  const [del,      setDel]      = useState<string | null>(null)
  const [opError,  setOpError]  = useState<string>('')   // inline op error
  const [sortBy,   setSortBy]   = useState<string>('date_desc')

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
        id:      String(a.id),
        name:    a.name,
        account: a.account_nickname || '',
        legs:    (a.legs || []).map((l: any) => ({
          i: ({'NIFTY':'NF','BANKNIFTY':'BN','SENSEX':'SX','MIDCAPNIFTY':'MN','FINNIFTY':'FN'}[l.underlying] || (l.underlying||'NF').slice(0,2).toUpperCase()),
          d: l.direction === 'buy' ? 'B' : 'S',
        })),
        et:   a.entry_time || '09:16',
        xt:   a.exit_time  || '15:10',
        arch: a.is_archived || false,
      }))
      setAlgos(apiAlgos)

      // Load grid entries for this week
      const weekStart = weekDates['MON']
      const weekEnd   = weekDates['FRI']
      const gridRes = await gridAPI.list({ week_start: weekStart, week_end: weekEnd })
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
      }
    } catch {
      // API unreachable — keep demo data, user can still interact
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

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
          mode:       'practix',
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
        is_practix:    true,
      })
      // Patch in the real grid_entry_id from API response
      const gridEntryId = String(res.data?.id || '')
      setGrid(g => ({
        ...g,
        [algoId]: {
          ...g[algoId],
          [day]: { ...g[algoId][day], gridEntryId },
        },
      }))
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

  // ── Remove cell ───────────────────────────────────────────────────────────────
  const rmCell = async (algoId: string, day: string) => {
    const cell = grid[algoId]?.[day]

    // Block remove if cell is active or open
    const cellStatus = grid[algoId]?.[day]?.status
    if (cellStatus === 'algo_active' || cellStatus === 'waiting' || cellStatus === 'open' || cellStatus === 'order_pending') {
      flashError('Cannot remove an active algo from this day')
      return
    }
    // Optimistic remove
    setGrid(g => {
      const u = { ...g[algoId] }
      delete u[day]
      return { ...g, [algoId]: u }
    })

    if (cell?.gridEntryId) {
      try {
        await gridAPI.remove(cell.gridEntryId)
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

  // ── Toggle practix / live ──────────────────────────────────────────────────────
  const togMode = async (algoId: string, day: string) => {
    const cell     = grid[algoId]?.[day]
    const newMode: CM = cell?.mode === 'practix' ? 'live' : 'practix'

    setGrid(g => ({ ...g, [algoId]: { ...g[algoId], [day]: { ...g[algoId][day], mode: newMode } } }))

    if (cell?.gridEntryId) {
      try {
        await gridAPI.setMode(cell.gridEntryId, { is_practix: newMode === 'practix' })
      } catch {
        setGrid(g => ({ ...g, [algoId]: { ...g[algoId], [day]: { ...g[algoId][day], mode: cell.mode } } }))
        flashError('Mode toggle failed')
      }
    }
  }

  // ── Promote all to live ───────────────────────────────────────────────────────
  const promLive = async (algoId: string) => {
    const cells = grid[algoId] || {}

    // Optimistic
    setGrid(g => ({
      ...g,
      [algoId]: Object.fromEntries(
        Object.entries(g[algoId] || {}).map(([d, c]) => [d, { ...c, mode: 'live' as CM }])
      ),
    }))

    // Fire API for each cell that has a gridEntryId
    const promises = Object.values(cells)
      .filter(c => c.gridEntryId && c.mode === 'practix')
      .map(c => gridAPI.setMode(c.gridEntryId!, { is_practix: false }).catch(() => null))

    await Promise.all(promises)
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
          lot_multiplier: 1, is_practix: true,
        })
        const gridEntryId = String(res.data?.id || '')
        setGrid(g => ({
          ...g,
          [algoId]: { ...g[algoId], [day]: { ...g[algoId][day], gridEntryId } },
        }))
      } catch (e: any) {
        // Rollback this day
        setGrid(g => {
          const u = { ...g[algoId] }; delete u[day]; return { ...g, [algoId]: u }
        })
        flashError(e?.response?.data?.detail || `Deploy failed for ${day}`)
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
    <div>
      {/* Header — sticky so New Algo button always visible */}
      <div style={{ position: 'sticky', top: 0, zIndex: 50, background: '#1A1C1E', isolation: 'isolate', paddingBottom: '4px', borderBottom: '1px solid var(--bg-border)' }}>
      <div className="page-header">
        <div>
          <h1 style={{ fontFamily:"'ADLaM Display',serif", fontSize:'22px', fontWeight:400 }}>Smart Grid</h1>
          <p style={{ fontSize:'12px', color:'var(--text-muted)', marginTop:'2px' }}>
            Week of {new Date().toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' })}
            {loading && <span style={{ marginLeft:'8px', color:'var(--accent-blue)', fontSize:'11px' }}>Loading...</span>}
          </p>
        </div>
        <div className="page-header-actions">
          {opError && (
            <span style={{ fontSize:'11px', color:'var(--red)', fontWeight:600 }}>⚠ {opError}</span>
          )}
          <label style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'12px', color:'var(--text-muted)', cursor:'pointer' }}>
            <input type="checkbox" checked={wk} onChange={e => setWk(e.target.checked)} style={{ accentColor:'var(--accent-blue)' }}/>
            Show Weekends
          </label>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)}
            style={{ height:'30px', fontSize:'11px', background:'var(--bg-secondary)', border:'1px solid var(--bg-border)', borderRadius:'5px', color:'var(--text-muted)', padding:'0 8px', cursor:'pointer' }}>
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
          <button className="btn btn-primary" onClick={() => nav('/algo/new')}>+ New Algo</button>
        </div>
      </div>
      </div>{/* end sticky wrapper */}

      {/* Archive panel */}
      {showArch && (
        <div style={{ background:'rgba(215,123,18,0.07)', border:'1px solid rgba(215,123,18,0.22)', borderRadius:'8px', padding:'14px 16px', marginBottom:'12px' }}>
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
      <div style={{ display:'flex', gap:'12px', marginBottom:'12px', flexWrap:'wrap', alignItems:'center', padding:'6px 12px', background:'var(--bg-secondary)', borderRadius:'6px', border:'1px solid var(--bg-border)' }}>
        {Object.entries(SC).map(([k, s]) => (
          <span key={k} style={{ display:'flex', alignItems:'center', gap:'5px', fontSize:'11px', color:'var(--text-muted)' }}>
            <span style={{ width:'7px', height:'7px', borderRadius:'2px', background:s.col, display:'inline-block' }}/>{s.label}
          </span>
        ))}
        <span style={{ marginLeft:'auto', fontSize:'10px', color:'var(--text-dim)' }}>
          <span style={{ color:'var(--accent-amber)', fontWeight:600 }}>PRAC</span> / <span style={{ color:'var(--green)', fontWeight:600 }}>LIVE</span> — click to toggle · drag pie → day
        </span>
      </div>

      {/* Grid table */}
      <div style={{ overflowX:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', tableLayout:'fixed' }}>
          <colgroup>
            <col style={{ width:'200px' }}/>
            {days.map(d => <col key={d} style={{ width:'140px' }}/>)}
          </colgroup>
          <thead>
            <tr>
              <th style={{ padding:'8px 12px', textAlign:'left', background:'var(--bg-secondary)', border:'1px solid var(--bg-border)', fontSize:'10px', color:'var(--text-muted)', fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase', position:'sticky', top:'62px', zIndex:49 }}>ALGO</th>
              {days.map(d => (
                <th key={d} style={{ padding:'8px 12px', textAlign:'center', background:'var(--bg-secondary)', border:'1px solid var(--bg-border)', fontSize:'10px', fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase', color:WEEKENDS.includes(d) ? 'var(--text-dim)' : 'var(--text-muted)', position:'sticky', top:'62px', zIndex:49 }}>
                  {d}
                  <div style={{ fontSize:'9px', color:'var(--text-dim)', fontWeight:400, marginTop:'1px' }}>
                    {weekDates[d] ? weekDates[d].slice(8) + '-' + weekDates[d].slice(5,7) : ''}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedActive.map(algo => {
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
                        <div onClick={() => nav(`/algo/${algo.id}`)} title="Click to edit"
                          style={{ fontWeight:700, fontSize:'12px', color:'var(--accent-blue)', cursor:'pointer', marginBottom:'2px',
                            whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
                            textDecoration:'underline', textDecorationStyle:'dotted', textDecorationColor:'rgba(0,176,240,0.35)' }}>
                          {algo.name}
                        </div>
                        <div style={{ fontSize:'10px', color:'var(--text-dim)', marginBottom:'4px' }}>{algo.account}</div>
                        <div style={{ display:'flex', gap:'3px', flexWrap:'wrap', marginBottom:'5px' }}>
                          {algo.legs.map((l, i) => (
                            <span key={i} style={{ fontSize:'9px', fontWeight:700, padding:'1px 4px', borderRadius:'3px',
                              background: l.d==='B' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                              color:      l.d==='B' ? 'var(--green)'          : 'var(--red)',
                              border:     `1px solid ${l.d==='B' ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}` }}>
                              {l.i}{l.d}
                            </span>
                          ))}
                        </div>
                        <div style={{ display:'flex', gap:'4px', flexWrap:'wrap' }}>
                          {DAYS.some(d => !grid[algo.id]?.[d]) && (
                            <button onClick={() => addAllWeekdays(algo.id)}
                              style={{ fontSize:'9px', padding:'1px 6px', borderRadius:'3px', height:'17px', border:'1px solid rgba(0,176,240,0.3)', background:'transparent', color:'var(--accent-blue)', cursor:'pointer' }}
                              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,176,240,0.08)')}
                              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                              → All days
                            </button>
                          )}
                          {cells.some(c => c.mode === 'practix') && (
                            <button onClick={() => promLive(algo.id)}
                              style={{ fontSize:'9px', padding:'1px 6px', borderRadius:'3px', height:'17px', border:'1px solid rgba(34,197,94,0.3)', background:'transparent', color:'var(--green)', cursor:'pointer' }}
                              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(34,197,94,0.1)')}
                              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                              → Promote all to LIVE
                            </button>
                          )}
                        </div>
                      </div>
                      <div style={{ display:'flex', flexDirection:'column', gap:'2px', flexShrink:0 }}>
                        <IBtn onClick={() => setDel(algo.id)}  icon="🗑" hc="var(--red)"          title="Delete permanently"/>
                        <IBtn onClick={() => archAlgo(algo.id)} icon="📦" hc="var(--accent-amber)" title="Archive"/>
                      </div>
                    </div>
                  </td>

                  {/* Day cells */}
                  {days.map(day => {
                    const cell = grid[algo.id]?.[day]
                    const s    = cell ? SC[cell.status] : null
                    return (
                      <td key={day}
                        onDragOver={e => e.preventDefault()}
                        onDrop={() => onDrop(algo.id, day)}
                        style={{ padding:'4px', border:'1px solid var(--bg-border)', verticalAlign:'top', overflow:'hidden',
                          background: WEEKENDS.includes(day) && !cell ? 'rgba(30,32,34,0.4)' : undefined }}>
                        {cell && s
                          ? (
                            <div style={{ background:'var(--bg-secondary)', borderLeft:`3px solid ${s.col}`, borderRadius:'5px', padding:'6px 8px', position:'relative', overflow:'hidden' }}>
                              <button onClick={() => rmCell(algo.id, day)}
                                style={{ position:'absolute', top:'2px', right:'2px', background:'none', border:'none', cursor:'pointer', color:'var(--text-dim)', fontSize:'10px', padding:'2px 3px', lineHeight:1 }}
                                onMouseEnter={e => (e.currentTarget.style.color = 'var(--red)')}
                                onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-dim)')}>✕</button>

                              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'4px', paddingRight:'12px' }}>
                                <span style={{ fontSize:'9px', fontWeight:700, color:s.col, background:s.bg, padding:'1px 5px', borderRadius:'3px' }}>{s.label.toUpperCase()}</span>
                                <button onClick={() => togMode(algo.id, day)}
                                  title={cell.mode === 'practix' ? 'PRACTIX — click for LIVE' : 'LIVE — click for PRACTIX'}
                                  style={{ fontSize:'9px', fontWeight:700, padding:'1px 5px', borderRadius:'3px', border:'none', cursor:'pointer', lineHeight:'14px',
                                    background: cell.mode === 'live' ? 'rgba(34,197,94,0.18)' : 'rgba(215,123,18,0.14)',
                                    color:      cell.mode === 'live' ? 'var(--green)'          : 'var(--accent-amber)',
                                    width:'34px', textAlign:'center' }}>
                                  {cell.mode === 'live' ? 'LIVE' : 'PRAC'}
                                </button>
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
