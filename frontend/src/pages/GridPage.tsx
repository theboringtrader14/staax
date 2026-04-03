import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { algosAPI, gridAPI, holidaysAPI } from '@/services/api'
import { useStore } from '@/store'

// ── Types ──────────────────────────────────────────────────────────────────────
const DAYS     = ['MON','TUE','WED','THU','FRI']
const WEEKENDS = ['SAT','SUN']
const ALL_DAYS = ['MON','TUE','WED','THU','FRI','SAT','SUN']
const DAY_LBL  = ['M','T','W','T','F','S','S']
type CS = 'no_trade'|'waiting'|'algo_active'|'order_pending'|'open'|'algo_closed'|'error'
type CM = 'practix'|'live'

interface Cell {
  gridEntryId?: string
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
  recurringDays: string[]
  is_live:       boolean
  mtm_sl?:        number
  mtm_tp?:        number
  entry_type?:    string
  order_type?:    string
  strategy_mode?: string
}

// ── Status config ──────────────────────────────────────────────────────────────
const SC: Record<CS,{label:string;col:string;bg:string;pct:number}> = {
  no_trade:     {label:'No Trade', col:'#4A4A58', bg:'rgba(74,74,88,0.10)',    pct:0},
  waiting:      {label:'Waiting',  col:'#FFD700', bg:'rgba(255,215,0,0.12)',   pct:15},
  algo_active:  {label:'Active',   col:'#FF6B00', bg:'rgba(255,107,0,0.14)',   pct:30},
  order_pending:{label:'Pending',  col:'#FFD700', bg:'rgba(255,215,0,0.12)',   pct:50},
  open:         {label:'Open',     col:'#22DD88', bg:'rgba(34,221,136,0.12)',  pct:75},
  algo_closed:  {label:'Closed',   col:'#22DD88', bg:'rgba(34,221,136,0.10)', pct:100},
  error:        {label:'Error',    col:'#FF4444', bg:'rgba(255,68,68,0.14)',   pct:60},
}

// ── Status bar (left strip) ─────────────────────────────────────────────────────
const STATUS_BAR: Record<CS,{color:string;glow:string}> = {
  algo_active:   { color:'#FF6B00',              glow:'rgba(255,107,0,0.30)' },
  open:          { color:'#22DD88',              glow:'rgba(34,221,136,0.30)' },
  algo_closed:   { color:'rgba(34,221,136,0.5)', glow:'rgba(34,221,136,0.15)' },
  error:         { color:'#FF4444',              glow:'rgba(255,68,68,0.30)' },
  waiting:       { color:'#FFD700',              glow:'rgba(255,215,0,0.30)' },
  order_pending: { color:'#FFD700',              glow:'rgba(255,215,0,0.25)' },
  no_trade:      { color:'rgba(255,255,255,0.10)', glow:'transparent' },
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function getWeekDates(): Record<string, string> {
  const IST_OFFSET_MS = 330 * 60 * 1000
  const istMs    = Date.now() + IST_OFFSET_MS
  const ist      = new Date(istMs)
  const dow      = ist.getUTCDay()
  const mondayMs = istMs - (dow === 0 ? 6 : dow - 1) * 86400000
  const names    = ['MON','TUE','WED','THU','FRI','SAT','SUN']
  const map: Record<string,string> = {}
  for (let i = 0; i < 7; i++) {
    const d = new Date(mondayMs + i * 86400000)
    map[names[i]] = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`
  }
  return map
}

function dateToDay(iso: string, weekDates: Record<string,string>): string|null {
  return Object.entries(weekDates).find(([,v]) => v === iso)?.[0] ?? null
}

function mapStatus(s: string): CS {
  const m: Record<string,CS> = {
    algo_active:'algo_active', order_pending:'order_pending', open:'open',
    algo_closed:'algo_closed', no_trade:'no_trade', error:'error', waiting:'waiting',
    active:'open', closed:'algo_closed', terminated:'algo_closed',
  }
  return m[s] ?? 'no_trade'
}

function getTodayDay(): string {
  const ist = new Date(Date.now() + 330 * 60 * 1000)
  return ['SUN','MON','TUE','WED','THU','FRI','SAT'][ist.getUTCDay()]
}

function accountChipStyle(name: string): {bg:string;color:string;border:string} {
  const l = name.toLowerCase()
  if (l.includes('zerodha') || l.includes('kite'))
    return { bg:'rgba(68,136,255,0.12)', color:'#4488FF', border:'0.5px solid rgba(68,136,255,0.30)' }
  if (l.includes('ao') || l.includes('angel') || l.includes('motilal'))
    return { bg:'rgba(0,204,170,0.12)', color:'#00CCAA', border:'0.5px solid rgba(0,204,170,0.30)' }
  return { bg:'rgba(255,107,0,0.10)', color:'var(--ox-glow)', border:'0.5px solid rgba(255,107,0,0.25)' }
}

function worstStatus(cells: Record<string,Cell>|undefined): CS {
  if (!cells) return 'no_trade'
  const v = Object.values(cells).map(c => c.status)
  for (const s of ['error','open','order_pending','algo_active','waiting','algo_closed'] as CS[])
    if (v.includes(s)) return s
  return 'no_trade'
}

// ── Custom dropdown ────────────────────────────────────────────────────────────
function StaaxSelect({ value, onChange, options, width }: {
  value:string; onChange:(v:string)=>void; options:{value:string;label:string}[]; width?:string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const label = options.find(o => o.value === value)?.label ?? value
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  return (
    <div ref={ref} style={{ position:'relative', width:width||'130px', flexShrink:0 }}>
      <button onClick={() => setOpen(v => !v)} style={{
        width:'100%', height:'32px', padding:'0 28px 0 10px',
        background:'rgba(22,22,25,0.80)',
        border: open ? '0.5px solid rgba(255,107,0,0.55)' : '0.5px solid rgba(255,107,0,0.22)',
        borderRadius:'10px', color:'var(--text)', fontSize:'12px',
        fontFamily:'var(--font-body)', cursor:'pointer', textAlign:'left',
        display:'flex', alignItems:'center',
        boxShadow: open ? '0 0 0 3px rgba(255,107,0,0.08)' : 'none',
        transition:'border-color 0.15s, box-shadow 0.15s',
      }}>
        <span style={{ flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{label}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FF6B00" strokeWidth="2.5"
          style={{ position:'absolute', right:'8px', flexShrink:0, transition:'transform 0.15s', transform:open?'rotate(180deg)':'none' }}>
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </button>
      {open && (
        <div style={{
          position:'absolute', top:'calc(100% + 4px)', left:0, right:0, zIndex:999,
          background:'rgba(14,14,18,0.98)', backdropFilter:'blur(20px)',
          border:'0.5px solid rgba(255,107,0,0.30)', borderRadius:'10px',
          overflow:'hidden', boxShadow:'0 8px 32px rgba(0,0,0,0.7)',
        }}>
          {options.map(o => (
            <div key={o.value} onClick={() => { onChange(o.value); setOpen(false) }}
              style={{
                padding:'9px 12px', fontSize:'12px', cursor:'pointer',
                color: o.value === value ? '#FF6B00' : 'var(--text)',
                background: o.value === value ? 'rgba(255,107,0,0.12)' : 'transparent',
                borderLeft: o.value === value ? '2px solid #FF6B00' : '2px solid transparent',
              }}
              onMouseEnter={e => { if (o.value !== value) { (e.currentTarget as HTMLDivElement).style.background='rgba(255,107,0,0.07)'; (e.currentTarget as HTMLDivElement).style.color='#FF8C33' } }}
              onMouseLeave={e => { if (o.value !== value) { (e.currentTarget as HTMLDivElement).style.background='transparent'; (e.currentTarget as HTMLDivElement).style.color='var(--text)' } }}>
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function GridPage() {
  const nav            = useNavigate()
  const weekDates      = getWeekDates()
  const isPractixMode  = useStore(s => s.isPractixMode)
  const activeAccount  = useStore(s => s.activeAccount)
  const todayDay       = getTodayDay()

  const [algos,         setAlgos]        = useState<Algo[]>([])
  const [grid,          setGrid]         = useState<Record<string,Record<string,Cell>>>({})
  const [,              setLoading]      = useState(true)
  const [ed,            setEd]           = useState<{id:string;day:string}|null>(null)
  const [ev,            setEv]           = useState('')
  const [showArch,      setShowArch]     = useState(false)
  const [del,           setDel]          = useState<string|null>(null)
  const [archConfirm,   setArchConfirm]  = useState<string|null>(null)
  const [opError,       setOpError]      = useState('')
  const [autoFillToast, setAutoFillToast] = useState('')
  const [holidayDates,  setHolidayDates] = useState<Set<string>>(new Set())
  const [tick,          setTick]         = useState(0)
  const [rmModal,       setRmModal]      = useState<{algoId:string;day:string}|null>(null)
  const [sortBy,        setSortBy]       = useState(() => localStorage.getItem('staax_grid_sort') || 'date_desc')
  const [activeOnly,    setActiveOnly]   = useState(false)
  const [cardMults,     setCardMults]    = useState<Record<string,number>>({})
  const [expandedId,    setExpandedId]   = useState<string|null>(null)
  const [filterAccount, setFilterAccount] = useState('all')

  // ── Sync card multipliers when grid loads ────────────────────────────────────
  useEffect(() => {
    setCardMults(prev => {
      const next = { ...prev }
      for (const [algoId, cells] of Object.entries(grid)) {
        if (next[algoId]) continue
        const todayCell = cells[todayDay]
        if (todayCell) { next[algoId] = todayCell.multiplier; continue }
        const first = Object.values(cells)[0]
        if (first) next[algoId] = first.multiplier
      }
      return next
    })
  }, [grid, todayDay])

  const flashError = (msg: string) => { setOpError(msg); setTimeout(() => setOpError(''), 3500) }

  // ── Load data ─────────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const algoRes = await algosAPI.list()
      const apiAlgos: Algo[] = (algoRes.data || []).map((a: any) => ({
        id:           String(a.id),
        name:         a.name,
        account:      a.account_nickname || '',
        legs:         (a.legs || []).map((l: any) => ({
          i: (({'NIFTY':'NF','BANKNIFTY':'BN','SENSEX':'SX','MIDCAPNIFTY':'MN','FINNIFTY':'FN'} as Record<string,string>)[l.underlying] || (l.underlying||'NF').slice(0,2).toUpperCase()),
          d: l.direction === 'buy' ? 'B' : 'S',
        })),
        et:           a.entry_time  || '09:16',
        xt:           a.exit_time   || '15:10',
        arch:         a.is_archived || false,
        recurringDays:Array.isArray(a.recurring_days) ? a.recurring_days : [],
        is_live:      a.is_live || false,
        mtm_sl:       a.mtm_sl ?? undefined,
        mtm_tp:       a.mtm_tp ?? undefined,
        entry_type:   a.entry_type || undefined,
        order_type:   a.order_type || undefined,
      }))
      setAlgos(apiAlgos)

      const gridRes = await gridAPI.list({
        week_start: weekDates['MON'], week_end: weekDates['SUN'],
        is_practix: isPractixMode,
        ...(activeAccount ? { account_id: activeAccount } : {}),
      })
      const entries: any[] = gridRes.data?.entries || gridRes.data || []
      const newGrid: Record<string,Record<string,Cell>> = {}

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

      // Auto-fill recurring days
      let filled = 0
      const updAlgos = [...apiAlgos]
      await Promise.all((isPractixMode ? apiAlgos.filter(a => !a.arch && a.recurringDays.length > 0) : []).map(async algo => {
        const missing = DAYS.filter(d => algo.recurringDays.includes(d) && !newGrid[algo.id]?.[d])
        for (const day of missing) {
          try {
            const res = await gridAPI.deploy({ algo_id:algo.id, trading_date:weekDates[day], lot_multiplier:1, is_practix:true })
            newGrid[algo.id] = newGrid[algo.id] || {}
            newGrid[algo.id][day] = { gridEntryId:String(res.data?.id||''), multiplier:1, status:mapStatus(res.data?.status||'no_trade'), mode:'practix', entry:algo.et, exit:algo.xt }
            const idx = updAlgos.findIndex(a => a.id === algo.id)
            if (idx >= 0 && Array.isArray(res.data?.algo_recurring_days)) updAlgos[idx] = { ...updAlgos[idx], recurringDays:res.data.algo_recurring_days }
            filled++
          } catch { /* silent */ }
        }
      }))
      if (filled > 0) {
        setGrid({ ...newGrid }); setAlgos(updAlgos)
        setAutoFillToast(`Auto-filled ${filled} recurring day${filled > 1 ? 's' : ''}`)
        setTimeout(() => setAutoFillToast(''), 3500)
      }
    } catch { /* API unreachable */ } finally { setLoading(false) }
  }, [isPractixMode, activeAccount])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    holidaysAPI.list(new Date().getFullYear())
      .then(res => { const fo = (res.data||[]).filter((h:any) => h.segment==='fo'); setHolidayDates(new Set(fo.map((h:any) => h.date))) })
      .catch(() => {})
  }, [])

  useEffect(() => { const t = setInterval(() => setTick(v => v+1), 60000); return () => clearInterval(t) }, [])

  // ── Deploy a day (day pill click) ────────────────────────────────────────────
  const deployDay = async (algoId: string, day: string) => {
    if (grid[algoId]?.[day]) return
    const algo = algos.find(x => x.id === algoId)
    const mult = cardMults[algoId] || 1
    setGrid(g => ({ ...g, [algoId]: { ...g[algoId], [day]: { multiplier:mult, status:'algo_active', mode:isPractixMode?'practix':'live', entry:algo?.et||'09:16', exit:algo?.xt||'15:10' } } }))
    try {
      const res = await gridAPI.deploy({ algo_id:algoId, trading_date:weekDates[day], lot_multiplier:mult, is_practix:isPractixMode })
      const gridEntryId = String(res.data?.id||'')
      setGrid(g => ({ ...g, [algoId]: { ...g[algoId], [day]: { ...g[algoId][day], gridEntryId } } }))
      if (Array.isArray(res.data?.algo_recurring_days)) setAlgos(a => a.map(x => x.id===algoId ? { ...x, recurringDays:res.data.algo_recurring_days } : x))
    } catch (e:any) {
      setGrid(g => { const u={...g[algoId]}; delete u[day]; return { ...g, [algoId]:u } })
      flashError(e?.response?.data?.detail || 'Deploy failed')
    }
  }

  // ── Remove cell ──────────────────────────────────────────────────────────────
  const rmCell = (algoId: string, day: string) => {
    const st = grid[algoId]?.[day]?.status
    if (st==='algo_active'||st==='waiting'||st==='open'||st==='order_pending') { flashError('Cannot remove an active algo from this day'); return }
    setRmModal({ algoId, day })
  }

  const doRemove = async (algoId: string, day: string, removeRecurring: boolean) => {
    const cell = grid[algoId]?.[day]
    setRmModal(null)
    setGrid(g => { const u={...g[algoId]}; delete u[day]; return { ...g, [algoId]:u } })
    if (cell?.gridEntryId) {
      try {
        const res = await gridAPI.remove(cell.gridEntryId, removeRecurring)
        if (removeRecurring && Array.isArray(res.data?.algo_recurring_days))
          setAlgos(a => a.map(x => x.id===algoId ? { ...x, recurringDays:res.data.algo_recurring_days } : x))
      } catch { setGrid(g => ({ ...g, [algoId]:{ ...g[algoId], [day]:cell } })); flashError('Remove failed') }
    }
  }

  // ── Multiplier ────────────────────────────────────────────────────────────────
  const setM = async (algoId: string, day: string, v: number) => {
    if (v < 1) return
    const cell = grid[algoId]?.[day]
    setGrid(g => ({ ...g, [algoId]:{ ...g[algoId], [day]:{ ...g[algoId][day], multiplier:v } } }))
    if (cell?.gridEntryId) {
      try { await gridAPI.update(cell.gridEntryId, { lot_multiplier:v }) }
      catch { setGrid(g => ({ ...g, [algoId]:{ ...g[algoId], [day]:{ ...g[algoId][day], multiplier:cell.multiplier } } })); flashError('Multiplier update failed') }
    }
  }

  const changeCardMult = (algoId: string, newVal: number) => {
    if (newVal < 1) return
    setCardMults(prev => ({ ...prev, [algoId]:newVal }))
    const cell = grid[algoId]?.[todayDay]
    if (cell) void setM(algoId, todayDay, newVal)
  }

  // ── Promote / Demote ──────────────────────────────────────────────────────────
  const promLive = async (algoId: string) => {
    await algosAPI.promote(algoId)
    setAlgos(a => a.map(x => x.id===algoId ? { ...x, is_live:true } : x))
    loadData()
  }
  const demoteLive = async (algoId: string) => {
    await algosAPI.demote(algoId)
    setAlgos(a => a.map(x => x.id===algoId ? { ...x, is_live:false } : x))
    loadData()
  }

  // ── Add all weekdays ──────────────────────────────────────────────────────────
  const addAllWeekdays = async (algoId: string) => {
    const algo    = algos.find(x => x.id === algoId)
    const missing = DAYS.filter(d => !grid[algoId]?.[d])
    if (!missing.length) return
    const mult = cardMults[algoId] || 1
    setGrid(g => ({ ...g, [algoId]:{ ...g[algoId], ...Object.fromEntries(missing.map(d => [d, { multiplier:mult, status:'algo_active' as CS, mode:isPractixMode?'practix':'live' as CM, entry:algo?.et||'09:16', exit:algo?.xt||'15:10' }])) } }))
    await Promise.all(missing.map(async day => {
      try {
        const res = await gridAPI.deploy({ algo_id:algoId, trading_date:weekDates[day], lot_multiplier:mult, is_practix:isPractixMode })
        const gridEntryId = String(res.data?.id||'')
        setGrid(g => ({ ...g, [algoId]:{ ...g[algoId], [day]:{ ...g[algoId][day], gridEntryId } } }))
        if (Array.isArray(res.data?.algo_recurring_days)) setAlgos(a => a.map(x => x.id===algoId ? { ...x, recurringDays:res.data.algo_recurring_days } : x))
      } catch (e:any) {
        setGrid(g => { const u={...g[algoId]}; delete u[day]; return { ...g, [algoId]:u } })
        flashError(e?.response?.data?.detail || `Deploy failed for ${day}`)
      }
    }))
  }

  // ── Add all to today ──────────────────────────────────────────────────────────
  const addAllToToday = async () => {
    const ist = new Date(new Date().toLocaleString('en-US', { timeZone:'Asia/Kolkata' }))
    const dow = ist.getDay()
    const targetDow = dow===0||dow===6 ? 5 : dow
    const dayNames = ['SUN','MON','TUE','WED','THU','FRI','SAT']
    const today = dayNames[targetDow]
    if (!DAYS.includes(today)) { flashError('Today is not a trading day'); return }
    const tradingDate = weekDates[today]
    const toAdd = sortedActive.filter(a => !grid[a.id]?.[today])
    if (!toAdd.length) return
    setGrid(g => { const u={...g}; for (const a of toAdd) u[a.id]={ ...g[a.id], [today]:{ multiplier:cardMults[a.id]||1, status:'algo_active' as CS, mode:'practix' as CM, entry:a.et||'09:16', exit:a.xt||'15:10' } }; return u })
    await Promise.all(toAdd.map(async a => {
      try {
        const res = await gridAPI.deploy({ algo_id:a.id, trading_date:tradingDate, lot_multiplier:cardMults[a.id]||1, is_practix:isPractixMode })
        const gridEntryId = String(res.data?.id||'')
        setGrid(g => ({ ...g, [a.id]:{ ...g[a.id], [today]:{ ...g[a.id][today], gridEntryId } } }))
        if (Array.isArray(res.data?.algo_recurring_days)) setAlgos(al => al.map(x => x.id===a.id ? { ...x, recurringDays:res.data.algo_recurring_days } : x))
      } catch (e:any) {
        setGrid(g => { const u={...g[a.id]}; delete u[today]; return { ...g, [a.id]:u } })
        flashError(e?.response?.data?.detail || `Deploy failed for ${a.name}`)
      }
    }))
  }

  // ── Archive / Delete ──────────────────────────────────────────────────────────
  const archAlgo = async (algoId: string) => {
    const hasActive = Object.values(grid[algoId]||{}).some(c => c.status==='algo_active'||c.status==='waiting'||c.status==='open'||c.status==='order_pending')
    if (hasActive) { flashError('Cannot archive — algo has active positions this week'); return }
    setAlgos(a => a.map(x => x.id===algoId ? { ...x, arch:true } : x))
    setGrid(g => { const n={...g}; delete n[algoId]; return n })
    try { await algosAPI.archive(algoId) } catch { loadData(); flashError('Archive failed') }
  }
  const unarch = async (algoId: string) => {
    setAlgos(a => a.map(x => x.id===algoId ? { ...x, arch:false } : x))
    try { await algosAPI.unarchive(algoId) } catch { setAlgos(a => a.map(x => x.id===algoId ? { ...x, arch:true } : x)); flashError('Reactivate failed') }
  }
  const delAlgo = async (algoId: string) => {
    setAlgos(a => a.filter(x => x.id!==algoId))
    setGrid(g => { const n={...g}; delete n[algoId]; return n })
    setDel(null)
    try { await algosAPI.delete(algoId) } catch { loadData(); flashError('Delete failed') }
  }

  // ── Icon button ───────────────────────────────────────────────────────────────
  const IBtn = ({ onClick, icon, hc, title }: { onClick:()=>void; icon:string; hc:string; title:string }) => (
    <button onClick={onClick} title={title}
      style={{ width:'22px', height:'22px', borderRadius:'4px', border:'none', background:'transparent', color:'var(--text-dim)', fontSize:'13px', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}
      onMouseEnter={e => { const b=e.currentTarget as HTMLButtonElement; b.style.color=hc; b.style.background=`${hc}22` }}
      onMouseLeave={e => { const b=e.currentTarget as HTMLButtonElement; b.style.color='var(--text-dim)'; b.style.background='transparent' }}>
      {icon}
    </button>
  )

  const active   = algos.filter(a => !a.arch)
  const archived = algos.filter(a => a.arch)
  const sortedActive = [...active].sort((a,b) => {
    if (sortBy==='name_asc')  return a.name.localeCompare(b.name)
    if (sortBy==='name_desc') return b.name.localeCompare(a.name)
    if (sortBy==='buy_first')  return (a.legs.some(l=>l.d==='B')?0:1)-(b.legs.some(l=>l.d==='B')?0:1)
    if (sortBy==='sell_first') return (a.legs.some(l=>l.d==='S')?0:1)-(b.legs.some(l=>l.d==='S')?0:1)
    return 0
  })
  const accountOptions = [
    { value:'all', label:'All Accounts' },
    ...Array.from(new Set(active.map(a => a.account).filter(Boolean))).map(a => ({ value:a, label:a })),
  ]
  const visibleAlgos = sortedActive
    .filter(a => isPractixMode ? !a.is_live : a.is_live)
    .filter(a => !activeOnly || Object.keys(grid[a.id]||{}).length > 0)
    .filter(a => filterAccount === 'all' || a.account === filterAccount)

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display:'flex', flexDirection:'column', height:'calc(100vh - 92px)' }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ flexShrink:0, paddingBottom:'4px' }}>
        <div className="page-header">
          <div>
            <h1 style={{ fontFamily:'var(--font-display)', fontSize:'22px', fontWeight:800, color:'var(--ox-radiant)' }}>Smart Grid</h1>
            <div style={{ display:'flex', alignItems:'center', gap:'10px', marginTop:'3px' }}>
              <span style={{ fontSize:'12px', color:'var(--gs-muted)' }}>
                Week of {new Date().toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric', timeZone:'Asia/Kolkata' })}
              </span>
              <span className={'chip ' + (isPractixMode ? 'chip-warn' : 'chip-success')} style={{ fontSize:'10px', padding:'1px 8px' }}>
                {isPractixMode ? 'PRACTIX' : 'LIVE'}
              </span>
            </div>
          </div>
          <div className="page-header-actions">
            {opError       && <span style={{ fontSize:'11px', color:'var(--red)',        fontWeight:600 }}>⚠ {opError}</span>}
            {autoFillToast && <span style={{ fontSize:'11px', color:'var(--ox-radiant)', fontWeight:600 }}>↻ {autoFillToast}</span>}

            {/* Active Only */}
            <button onClick={() => setActiveOnly(v => !v)} style={{
              height:'32px', padding:'0 14px', borderRadius:'100px',
              background: activeOnly ? 'rgba(255,107,0,0.14)' : 'rgba(255,107,0,0.06)',
              border:     activeOnly ? '0.5px solid rgba(255,107,0,0.45)' : '0.5px solid rgba(255,107,0,0.20)',
              color:      activeOnly ? 'var(--ox-radiant)' : 'var(--gs-muted)',
              fontSize:'11px', fontWeight:600, fontFamily:'var(--font-display)',
              cursor:'pointer', letterSpacing:'0.4px', transition:'all 0.15s',
            }}>Active Only</button>

            {/* Account filter */}
            <StaaxSelect value={filterAccount} onChange={setFilterAccount} options={accountOptions} width="130px"/>

            {/* Sort */}
            <StaaxSelect value={sortBy} onChange={v => { setSortBy(v); localStorage.setItem('staax_grid_sort', v) }}
              options={[
                {value:'date_desc', label:'Date Created'},
                {value:'name_asc',  label:'Name A → Z'},
                {value:'name_desc', label:'Name Z → A'},
                {value:'buy_first', label:'Buy first'},
                {value:'sell_first',label:'Sell first'},
              ]}
            />

            <button className="btn btn-ghost" onClick={addAllToToday} style={{ fontSize:'11px', height:'32px', padding:'0 12px' }}>All → Today</button>

            <button className="btn btn-ghost" style={{ fontSize:'11px', position:'relative', height:'32px', padding:'0 12px' }} onClick={() => setShowArch(v => !v)}>
              📦 Archive
              {archived.length > 0 && <span style={{ position:'absolute', top:'5px', right:'5px', width:'5px', height:'5px', borderRadius:'50%', background:'var(--accent-amber)' }}/>}
            </button>
          </div>
        </div>
      </div>

      {/* ── Archive panel ──────────────────────────────────────────────────── */}
      {showArch && (
        <div style={{ flexShrink:0, background:'rgba(245,158,11,0.07)', border:'0.5px solid rgba(245,158,11,0.22)', borderRadius:'10px', padding:'14px 16px', marginBottom:'10px' }}>
          <div style={{ fontSize:'10px', fontWeight:700, color:'var(--accent-amber)', marginBottom:'8px', textTransform:'uppercase', letterSpacing:'2px', fontFamily:'var(--font-display)' }}>📦 Archived Algos</div>
          {archived.length === 0
            ? <span style={{ fontSize:'12px', color:'var(--text-dim)' }}>No archived algos.</span>
            : <div style={{ display:'flex', flexWrap:'wrap', gap:'8px' }}>
                {archived.map(a => (
                  <div key={a.id} style={{ display:'flex', alignItems:'center', gap:'10px', background:'var(--glass-bg)', backdropFilter:'blur(20px)', WebkitBackdropFilter:'blur(20px)', borderRadius:'8px', padding:'8px 12px', border:'0.5px solid rgba(255,107,0,0.18)' }}>
                    <div>
                      <div style={{ fontSize:'12px', fontWeight:600 }}>{a.name}</div>
                      <div style={{ fontSize:'10px', color:'var(--text-dim)' }}>{a.account}</div>
                    </div>
                    <button className="btn btn-ghost" style={{ fontSize:'11px', height:'26px', padding:'0 10px' }} onClick={() => unarch(a.id)}>↩ Reactivate</button>
                  </div>
                ))}
              </div>}
        </div>
      )}

      {/* ── Algo cards ─────────────────────────────────────────────────────── */}
      <div className="no-scrollbar" style={{ flex:1, overflowY:'auto', display:'flex', flexDirection:'column', gap:'8px', paddingBottom:'16px' }}>

        {visibleAlgos.length === 0 && (
          <div style={{ padding:'64px 24px', textAlign:'center', color:'var(--text-dim)', fontSize:'13px' }}>
            {activeOnly ? 'No deployed algos this week. Toggle "Active Only" off to see all.' : 'No algos to show. Create an algo to get started.'}
          </div>
        )}

        {visibleAlgos.map(algo => {
          const st         = worstStatus(grid[algo.id])
          const bar        = STATUS_BAR[st]
          const acChips    = accountChipStyle(algo.account)
          const mult       = cardMults[algo.id] || 1
          const isExpanded = expandedId === algo.id
          const typeStr    = algo.account?.toLowerCase().includes('ao') ? 'Direct' : 'Broker'

          return (
            <div key={algo.id} className="card cloud-fill"
              onClick={() => setExpandedId(v => v === algo.id ? null : algo.id)}
              style={{ padding:0, overflow:'hidden', display:'flex', flexDirection:'column', borderRadius:'14px', cursor:'pointer', minHeight:'64px' }}>

              {/* ── Main row ── */}
              <div style={{ display:'flex', alignItems:'center' }}>

                {/* 4px status strip — full card height */}
                <div style={{ width:'4px', alignSelf:'stretch', flexShrink:0, background:bar.color, borderRadius:'14px 0 0 14px', boxShadow:`inset 0 0 14px ${bar.glow}` }}/>

                {/* Card row body */}
                <div style={{ flex:1, display:'flex', alignItems:'center', gap:'12px', padding:'10px 16px' }}>

                  {/* ── Info block: name + account + legs (stacked) ── */}
                  <div style={{ display:'flex', flexDirection:'column', gap:'4px', minWidth:'200px', maxWidth:'220px', flexShrink:0 }}>

                    {/* Row 1: Name + type */}
                    <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                      <span onClick={e => { e.stopPropagation(); nav(`/algo/${algo.id}`) }}
                        style={{ fontFamily:'var(--font-display)', fontWeight:600, fontSize:'14px', color:'#F0F0FF',
                          cursor:'pointer', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:'130px',
                          textDecoration:'underline', textDecorationStyle:'dotted', textDecorationColor:'rgba(255,107,0,0.35)' }}>
                        {algo.name}
                      </span>
                      <span style={{ fontSize:'10px', color:'var(--gs-muted)', whiteSpace:'nowrap', flexShrink:0 }}>
                        {typeStr} · Intraday
                      </span>
                    </div>

                    {/* Row 2: Account chip */}
                    <div>
                      <span style={{ display:'inline-flex', alignItems:'center', padding:'2px 8px', borderRadius:'100px',
                        fontSize:'11px', fontWeight:600, fontFamily:'var(--font-display)', letterSpacing:'0.3px', whiteSpace:'nowrap',
                        background:acChips.bg, color:acChips.color, border:acChips.border }}>
                        {algo.account || '—'}
                      </span>
                    </div>

                    {/* Row 3: Leg chips */}
                    <div style={{ display:'flex', gap:'4px', flexWrap:'wrap' }}>
                      {algo.legs.map((l, i) => (
                        <span key={i} style={{
                          display:'inline-flex', alignItems:'center', padding:'2px 7px', borderRadius:'100px',
                          fontSize:'10px', fontWeight:700, fontFamily:'var(--font-display)', letterSpacing:'0.3px',
                          background: l.d==='B' ? 'rgba(34,221,136,0.12)' : 'rgba(255,68,68,0.12)',
                          color:      l.d==='B' ? 'var(--sem-long)'        : 'var(--sem-short)',
                          border:    `0.5px solid ${l.d==='B' ? 'rgba(34,221,136,0.30)' : 'rgba(255,68,68,0.30)'}`,
                        }}>
                          {l.d==='B' ? 'B' : 'S'} {l.i}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* ── Lot multiplier stepper ── */}
                  <div style={{ display:'flex', alignItems:'center', gap:'5px', minWidth:'80px', flexShrink:0, justifyContent:'center' }}
                    onClick={e => e.stopPropagation()}>
                    <button onClick={() => changeCardMult(algo.id, mult - 1)}
                      style={{ width:'22px', height:'22px', borderRadius:'50%', border:'0.5px solid rgba(255,107,0,0.30)', background:'rgba(255,107,0,0.06)', color:'var(--ox-glow)', fontSize:'16px', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', lineHeight:1, transition:'all 0.12s', fontWeight:300 }}
                      onMouseEnter={e => { e.currentTarget.style.background='rgba(255,107,0,0.16)'; e.currentTarget.style.borderColor='rgba(255,107,0,0.55)' }}
                      onMouseLeave={e => { e.currentTarget.style.background='rgba(255,107,0,0.06)'; e.currentTarget.style.borderColor='rgba(255,107,0,0.30)' }}>−</button>

                    {ed?.id===algo.id && ed?.day==='__mult__'
                      ? <input autoFocus type="number" min={1} value={ev}
                          onChange={e => setEv(e.target.value)}
                          onBlur={() => { changeCardMult(algo.id, Math.max(1, parseInt(ev)||1)); setEd(null) }}
                          onKeyDown={e => { if (e.key==='Enter') { changeCardMult(algo.id, Math.max(1, parseInt(ev)||1)); setEd(null) } }}
                          style={{ width:'36px', background:'rgba(22,22,25,0.90)', border:'0.5px solid var(--ox-radiant)', borderRadius:'4px', color:'var(--ox-glow)', fontSize:'11px', textAlign:'center', padding:'0 2px', fontFamily:'var(--font-mono)', outline:'none' }}/>
                      : <span onClick={() => { setEd({ id:algo.id, day:'__mult__' }); setEv(String(mult)) }}
                          style={{ width:'34px', textAlign:'center', cursor:'pointer', fontSize:'12px', fontWeight:700, color:'var(--ox-radiant)', fontFamily:'var(--font-mono)', letterSpacing:'-0.5px' }}>
                          {mult}x
                        </span>
                    }

                    <button onClick={() => changeCardMult(algo.id, mult + 1)}
                      style={{ width:'22px', height:'22px', borderRadius:'50%', border:'0.5px solid rgba(255,107,0,0.30)', background:'rgba(255,107,0,0.06)', color:'var(--ox-glow)', fontSize:'16px', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', lineHeight:1, transition:'all 0.12s', fontWeight:300 }}
                      onMouseEnter={e => { e.currentTarget.style.background='rgba(255,107,0,0.16)'; e.currentTarget.style.borderColor='rgba(255,107,0,0.55)' }}
                      onMouseLeave={e => { e.currentTarget.style.background='rgba(255,107,0,0.06)'; e.currentTarget.style.borderColor='rgba(255,107,0,0.30)' }}>+</button>
                  </div>

                  {/* ── Entry / Exit time ── */}
                  <div style={{ display:'flex', flexDirection:'column', gap:'3px', minWidth:'80px', flexShrink:0 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:'5px' }}>
                      <span style={{ color:'var(--ox-radiant)', fontSize:'10px' }}>▶</span>
                      <span style={{ fontFamily:'var(--font-mono)', fontSize:'12px', color:'var(--ox-radiant)', fontWeight:600 }}>{algo.et}</span>
                    </div>
                    <div style={{ display:'flex', alignItems:'center', gap:'5px' }}>
                      <span style={{ color:'var(--text-muted)', fontSize:'10px' }}>⏹</span>
                      <span style={{ fontFamily:'var(--font-mono)', fontSize:'12px', color:'var(--text-muted)' }}>{algo.xt}</span>
                    </div>
                  </div>

                  {/* ── Day pills M T W T F S S ── */}
                  <div style={{ display:'flex', gap:'4px', alignItems:'center', flex:1, minWidth:'210px', justifyContent:'center' }}
                    onClick={e => e.stopPropagation()}>
                    {ALL_DAYS.map((day, i) => {
                      const isDeployed = !!grid[algo.id]?.[day]
                      const cell       = grid[algo.id]?.[day]
                      const isToday    = day === todayDay
                      const isWeekend  = WEEKENDS.includes(day)
                      const isHoliday  = weekDates[day] ? holidayDates.has(weekDates[day]) : false
                      const isMissed   = cell?.status==='waiting' && isToday && !!cell.entry && tick>=0 && (() => {
                        const now = new Date().toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hour12:false})
                        return now >= cell.entry.slice(0,5)
                      })()
                      const deployedSt = cell ? SC[cell.status] : null
                      return (
                        <button key={day}
                          onClick={() => isDeployed ? rmCell(algo.id, day) : deployDay(algo.id, day)}
                          title={`${day}${isHoliday?' (Holiday)':''}${isDeployed ? ` · ${deployedSt?.label||'Active'} · click to remove` : ' · click to deploy'}`}
                          style={{
                            width:'28px', height:'28px', borderRadius:'50%', cursor:'pointer', position:'relative',
                            fontFamily:'var(--font-display)', fontSize:'10px', fontWeight:700,
                            display:'flex', alignItems:'center', justifyContent:'center',
                            transition:'all 0.15s var(--ease-smooth)', flexShrink:0,
                            border: isDeployed ? '0.5px solid rgba(255,107,0,0.60)'
                              : isToday   ? '0.5px solid rgba(255,107,0,0.45)'
                              : isHoliday ? '0.5px solid rgba(245,158,11,0.25)'
                              : isWeekend ? '0.5px solid rgba(255,255,255,0.05)'
                              : '0.5px solid rgba(255,255,255,0.09)',
                            background: isDeployed ? (isMissed ? 'rgba(245,158,11,0.18)' : 'rgba(255,107,0,0.20)')
                              : isHoliday ? 'rgba(245,158,11,0.06)' : 'transparent',
                            color: isDeployed ? (isMissed ? 'var(--accent-amber)' : '#fff')
                              : isToday   ? 'rgba(255,107,0,0.75)'
                              : isHoliday ? 'var(--accent-amber)'
                              : isWeekend ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.40)',
                            opacity: isHoliday && !isDeployed ? 0.5 : 1,
                            boxShadow: isDeployed ? '0 0 8px rgba(255,107,0,0.18)' : 'none',
                          }}>
                          {DAY_LBL[i]}
                          {isDeployed && deployedSt && deployedSt.col !== SC.algo_active.col && (
                            <span style={{ position:'absolute', bottom:'1px', right:'1px', width:'5px', height:'5px', borderRadius:'50%', background:deployedSt.col }}/>
                          )}
                          {isMissed && (
                            <span style={{ position:'absolute', top:'0', right:'0', width:'6px', height:'6px', borderRadius:'50%', background:'var(--accent-amber)' }}/>
                          )}
                        </button>
                      )
                    })}
                  </div>

                  {/* ── Promote / Demote ── */}
                  <div style={{ minWidth:'80px', flexShrink:0, display:'flex', justifyContent:'center' }}
                    onClick={e => e.stopPropagation()}>
                    {isPractixMode ? (
                      <button onClick={() => promLive(algo.id)} style={{
                        height:'28px', padding:'0 12px', borderRadius:'100px', whiteSpace:'nowrap',
                        border:'0.5px solid rgba(34,221,136,0.35)', background:'rgba(34,221,136,0.08)', color:'var(--sem-long)',
                        fontSize:'10px', fontWeight:700, fontFamily:'var(--font-display)', cursor:'pointer', letterSpacing:'0.5px', transition:'all 0.15s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background='rgba(34,221,136,0.16)'; e.currentTarget.style.borderColor='rgba(34,221,136,0.60)' }}
                      onMouseLeave={e => { e.currentTarget.style.background='rgba(34,221,136,0.08)'; e.currentTarget.style.borderColor='rgba(34,221,136,0.35)' }}>
                        → LIVE
                      </button>
                    ) : (
                      <button onClick={() => demoteLive(algo.id)} style={{
                        height:'28px', padding:'0 12px', borderRadius:'100px', whiteSpace:'nowrap',
                        border:'0.5px solid var(--gs-border)', background:'rgba(42,42,46,0.6)', color:'var(--gs-muted)',
                        fontSize:'10px', fontWeight:700, fontFamily:'var(--font-display)', cursor:'pointer', letterSpacing:'0.5px', transition:'all 0.15s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background='rgba(58,58,64,0.9)'; e.currentTarget.style.color='var(--ox-ultra)' }}
                      onMouseLeave={e => { e.currentTarget.style.background='rgba(42,42,46,0.6)'; e.currentTarget.style.color='var(--gs-muted)' }}>
                        ← PRAC
                      </button>
                    )}
                  </div>

                  {/* ── Actions ── */}
                  <div style={{ display:'flex', gap:'2px', flexShrink:0 }} onClick={e => e.stopPropagation()}>
                    <IBtn onClick={() => setDel(algo.id)}         icon="🗑" hc="var(--red)"          title="Delete permanently"/>
                    <IBtn onClick={() => setArchConfirm(algo.id)} icon="📦" hc="var(--accent-amber)" title="Archive"/>
                  </div>

                </div>{/* end card row body */}
              </div>{/* end main row */}

              {/* ── Expanded detail panel ── */}
              {isExpanded && (
                <div onClick={e => e.stopPropagation()}
                  style={{ borderTop:'0.5px solid rgba(255,107,0,0.15)', margin:'0 20px 12px', paddingTop:'12px',
                    display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'12px', alignItems:'end' }}>
                  {[
                    { label:'MTM SL',    val: algo.mtm_sl != null ? String(algo.mtm_sl) : '—' },
                    { label:'MTM TP',    val: algo.mtm_tp != null ? String(algo.mtm_tp) : '—' },
                    { label:'Entry Type',val: algo.entry_type || '—' },
                    { label:'Order Type',val: algo.order_type || '—' },
                  ].map(({ label, val }) => (
                    <div key={label}>
                      <div style={{ fontSize:'9px', fontWeight:700, letterSpacing:'1.5px', textTransform:'uppercase', color:'var(--gs-light)', fontFamily:'var(--font-display)', marginBottom:'3px' }}>{label}</div>
                      <div style={{ fontSize:'13px', color:'var(--text)', fontFamily:'var(--font-mono)' }}>{val}</div>
                    </div>
                  ))}
                  {DAYS.some(d => !grid[algo.id]?.[d]) && (
                    <div style={{ gridColumn:'span 4', paddingTop:'8px', borderTop:'0.5px solid rgba(255,255,255,0.04)', display:'flex', gap:'8px' }}>
                      <button onClick={() => addAllWeekdays(algo.id)} className="btn btn-ghost"
                        style={{ fontSize:'11px', height:'28px', padding:'0 12px' }}>
                        Deploy All Weekdays
                      </button>
                    </div>
                  )}
                </div>
              )}

            </div>
          )
        })}
      </div>

      {/* ── Remove cell modal ──────────────────────────────────────────────── */}
      {rmModal && (() => {
        const algo = algos.find(x => x.id===rmModal.algoId)
        const isRecurring = algo?.recurringDays.includes(rmModal.day)
        return (
          <div className="modal-overlay">
            <div className="modal-box" style={{ maxWidth:'360px' }}>
              <div style={{ fontWeight:700, fontSize:'15px', marginBottom:'8px' }}>Remove {algo?.name} from {rmModal.day}?</div>
              <div style={{ fontSize:'13px', color:'var(--text-muted)', lineHeight:1.6, marginBottom:'18px' }}>
                {isRecurring
                  ? <>This algo recurs every <strong>{rmModal.day}</strong>. Remove just this week, or stop it recurring?</>
                  : <>Remove this entry from {rmModal.day}?</>}
              </div>
              <div style={{ display:'flex', gap:'8px', justifyContent:'flex-end' }}>
                <button className="btn btn-ghost" onClick={() => setRmModal(null)}>Cancel</button>
                <button className="btn btn-ghost" onClick={() => doRemove(rmModal.algoId, rmModal.day, false)}>Just Today</button>
                {isRecurring && <button className="btn btn-danger" onClick={() => doRemove(rmModal.algoId, rmModal.day, true)}>Remove Recurring</button>}
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Archive confirm modal ─────────────────────────────────────────── */}
      {archConfirm && (() => {
        const a = algos.find(x => x.id===archConfirm)
        return (
          <div className="modal-overlay">
            <div className="modal-box" style={{ maxWidth:'360px' }}>
              <div style={{ fontWeight:700, fontSize:'16px', marginBottom:'8px' }}>Archive {a?.name}?</div>
              <div style={{ fontSize:'13px', color:'var(--text-muted)', lineHeight:1.6, marginBottom:'20px' }}>Moves this algo to the archive. It won't appear in the grid but can be restored anytime.</div>
              <div style={{ display:'flex', gap:'8px', justifyContent:'flex-end' }}>
                <button className="btn btn-ghost" onClick={() => setArchConfirm(null)}>Cancel</button>
                <button className="btn btn-warn" onClick={() => { archAlgo(archConfirm); setArchConfirm(null) }}>📦 Archive</button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Delete modal ──────────────────────────────────────────────────── */}
      {del && (() => {
        const a = algos.find(x => x.id===del)
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
                <button className="btn btn-warn" onClick={() => { archAlgo(del); setDel(null) }}>📦 Archive Instead</button>
                <button className="btn btn-danger" onClick={() => delAlgo(del)}>Delete</button>
              </div>
            </div>
          </div>
        )
      })()}

    </div>
  )
}
