import { useState, useEffect, useCallback, useRef, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { algosAPI, gridAPI, holidaysAPI } from '@/services/api'
import { useStore } from '@/store'

// ── Types ──────────────────────────────────────────────────────────────────────
const DAYS     = ['MON','TUE','WED','THU','FRI']
const WEEKENDS = ['SAT','SUN']
const ALL_DAYS = ['MON','TUE','WED','THU','FRI','SAT','SUN']
const DAY_LBL  = ['M','T','W','T','F','S','S']
const ABBR_TO_UNDERLYING: Record<string,string> = {
  NF:'NIFTY', BN:'BANKNIFTY', SX:'SENSEX', MN:'MIDCAPNIFTY', FN:'FINNIFTY'
}
const INSTRUMENT_ORDER = ['NIFTY','BANKNIFTY','SENSEX','MIDCAPNIFTY','FINNIFTY','OTHER']
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
  legs:          {i:string; d:'B'|'S'; lots?:number; strikeType?:string; wtEnabled?:boolean; hasJourney?:boolean; tslX?:number; tslY?:number; ttpX?:number; ttpY?:number; reSlEnabled?:boolean; reTpEnabled?:boolean}[]
  et:            string
  xt:            string
  arch:          boolean
  recurringDays: string[]
  is_live:       boolean
  mtm_sl?:        number
  mtm_tp?:        number
  mtm_unit?:      string
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
  algo_active:   { color:'#FF6B00',              glow:'rgba(255,107,0,0.70)' },
  open:          { color:'#00FF88',              glow:'rgba(0,255,136,0.70)' },
  algo_closed:   { color:'rgba(0,255,136,0.45)', glow:'rgba(0,255,136,0.30)' },
  error:         { color:'#FF2244',              glow:'rgba(255,34,68,0.70)' },
  waiting:       { color:'#FFE600',              glow:'rgba(255,230,0,0.70)' },
  order_pending: { color:'#FF8C00',              glow:'rgba(255,140,0,0.65)' },
  no_trade:      { color:'rgba(255,255,255,0.20)', glow:'transparent' },
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


function toTitleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
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
  const [cardMults,       setCardMults]       = useState<Record<string,number>>({})
  const [expandedId,      setExpandedId]      = useState<string|null>(null)
  const [filterAccount,   setFilterAccount]   = useState('all')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

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
          d:            l.direction === 'buy' ? 'B' : 'S',
          lots:         l.lots ?? undefined,
          strikeType:   l.strike_type ?? undefined,
          wtEnabled:    !!l.wt_enabled,
          hasJourney:   !!(l.journey_config?.child),
          tslX:         l.tsl_x ?? undefined,
          tslY:         l.tsl_y ?? undefined,
          ttpX:         l.ttp_x ?? undefined,
          ttpY:         l.ttp_y ?? undefined,
          reSlEnabled:  !!(l.reentry_enabled && l.reentry_on_sl),
          reTpEnabled:  !!(l.reentry_enabled && l.reentry_on_tp),
        })),
        et:           a.entry_time  || '09:16',
        xt:           a.exit_time   || '15:10',
        arch:         a.is_archived || false,
        recurringDays:Array.isArray(a.recurring_days) ? a.recurring_days : [],
        is_live:      a.is_live || false,
        mtm_sl:       a.mtm_sl   ?? undefined,
        mtm_tp:       a.mtm_tp   ?? undefined,
        mtm_unit:     a.mtm_unit ?? undefined,
        entry_type:    a.entry_type    || undefined,
        order_type:    a.order_type    || undefined,
        strategy_mode: a.strategy_mode || undefined,
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

  // ── SVG Icons ─────────────────────────────────────────────────────────────────
  const TrashIcon = () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M1.75 3.5h10.5M5.25 3.5V2.333A.583.583 0 015.833 1.75h2.334a.583.583 0 01.583.583V3.5M11.083 3.5l-.583 8.167a.583.583 0 01-.583.583H4.083a.583.583 0 01-.583-.583L2.917 3.5"
        stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M5.833 6.417v3.5M8.167 6.417v3.5"
        stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  )
  const ArchiveIcon = () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1.167" y="1.75" width="11.666" height="2.917" rx="0.583" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M2.333 4.667v6.416a.583.583 0 00.584.584h8.166a.583.583 0 00.584-.584V4.667"
        stroke="currentColor" strokeWidth="1.2"/>
      <path d="M7 6.417v3.5M5.25 8.167L7 9.917l1.75-1.75"
        stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )

  // ── Icon button ───────────────────────────────────────────────────────────────
  const IBtn = ({ onClick, icon, dc, hc, hoverBg, hoverBorder, title }: { onClick:()=>void; icon:ReactNode; dc:string; hc:string; hoverBg:string; hoverBorder:string; title:string }) => (
    <button onClick={onClick} title={title}
      style={{ width:'30px', height:'30px', borderRadius:'8px', background:'transparent',
        border:'0.5px solid rgba(255,255,255,0.08)', color:dc,
        cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', transition:'all 150ms ease' }}
      onMouseEnter={e => { const b=e.currentTarget; b.style.color=hc; b.style.background=hoverBg; b.style.borderColor=hoverBorder }}
      onMouseLeave={e => { const b=e.currentTarget; b.style.color=dc; b.style.background='transparent'; b.style.borderColor='rgba(255,255,255,0.08)' }}>
      {icon}
    </button>
  )

  const active   = algos.filter(a => !a.arch)
  const archived = algos.filter(a => a.arch)
  const accountOptions = [
    { value:'all', label:'All Accounts' },
    ...Array.from(new Set(active.map(a => a.account).filter(Boolean))).map(a => ({ value:a, label:a })),
  ]
  const visibleAlgos = [...active]
    .filter(a => isPractixMode ? !a.is_live : a.is_live)
    .filter(a => filterAccount === 'all' || a.account === filterAccount)
    .sort((a, b) => a.name.localeCompare(b.name))

  // ── Group by primary instrument ───────────────────────────────────────────────
  const groupedAlgos: Record<string, Algo[]> = {}
  for (const algo of visibleAlgos) {
    const key = ABBR_TO_UNDERLYING[algo.legs[0]?.i] || 'OTHER'
    if (!groupedAlgos[key]) groupedAlgos[key] = []
    groupedAlgos[key].push(algo)
  }
  const groupKeys = INSTRUMENT_ORDER.filter(k => groupedAlgos[k]?.length > 0)

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display:'flex', flexDirection:'column', height:'calc(100vh - 92px)' }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ flexShrink:0, paddingBottom:'4px' }}>
        <div className="page-header">
          <div>
            <h1 style={{ fontFamily:'var(--font-display)', fontSize:'22px', fontWeight:800, color:'var(--ox-radiant)' }}>Smart Cards</h1>
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

            {/* Account filter */}
            <StaaxSelect value={filterAccount} onChange={setFilterAccount} options={accountOptions} width="130px"/>

            <button className="btn btn-ghost" style={{ fontSize:'11px', position:'relative', height:'32px', padding:'0 12px' }} onClick={() => setShowArch(v => !v)}>
              Archive
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

      {/* ── Status legend ───────────────────────────────────────────────── */}
      <div style={{ flexShrink:0, display:'flex', gap:'18px', alignItems:'center', paddingLeft:'2px', marginBottom:'8px', flexWrap:'wrap' }}>
        {([
          ['#FF6B00','Active'], ['#00FF88','Open'], ['#FFE600','Waiting'],
          ['#FF8C00','Pending'], ['#FF2244','Error'],
          ['rgba(0,255,136,0.45)','Closed'], ['rgba(255,255,255,0.20)','No Trade'],
        ] as [string,string][]).map(([color, label]) => (
          <div key={label} style={{ display:'flex', alignItems:'center', gap:'5px' }}>
            <div style={{ width:'7px', height:'7px', borderRadius:'50%', background:color, boxShadow:`0 0 6px ${color}`, flexShrink:0 }}/>
            <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.40)', fontFamily:'var(--font-display)', letterSpacing:'0.5px' }}>{label}</span>
          </div>
        ))}
      </div>

      {/* ── Algo cards outer container (cloud-fill glassmorphic) ─────── */}
      <div className="card cloud-fill" style={{ flex:1, minHeight:0, display:'flex', flexDirection:'column', padding:'14px 14px 0', overflow:'hidden', borderRadius:'16px' }}>
        <div className="no-scrollbar" style={{ flex:1, overflowY:'auto', display:'flex', flexDirection:'column', paddingBottom:'14px' }}>

          {visibleAlgos.length === 0 && (
            <div style={{ padding:'64px 24px', textAlign:'center', color:'var(--text-dim)', fontSize:'13px' }}>
              No algos to show. Create an algo to get started.
            </div>
          )}

          {groupKeys.map((instrument, gIdx) => {
            const groupAlgos  = groupedAlgos[instrument]
            const isCollapsed = collapsedGroups.has(instrument)
            return (
              <div key={instrument}>

                {/* ── Group header ── */}
                <div
                  onClick={() => setCollapsedGroups(prev => {
                    const next = new Set(prev)
                    if (next.has(instrument)) next.delete(instrument); else next.add(instrument)
                    return next
                  })}
                  style={{ display:'flex', alignItems:'center', gap:'10px', cursor:'pointer',
                    paddingBottom:'8px', marginBottom:'8px', marginTop: gIdx === 0 ? 0 : '20px',
                    borderBottom:'0.5px solid rgba(255,107,0,0.15)', userSelect:'none',
                  }}>
                  <span style={{ fontFamily:'var(--font-display)', fontSize:'13px', fontWeight:700, color:'#FF6B00', letterSpacing:'1px' }}>
                    {instrument}
                  </span>
                  <span style={{ fontSize:'11px', color:'rgba(255,255,255,0.38)' }}>
                    {groupAlgos.length} algo{groupAlgos.length !== 1 ? 's' : ''}
                  </span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,107,0,0.55)" strokeWidth="2.5"
                    style={{ marginLeft:'auto', transition:'transform 0.2s ease', transform: isCollapsed ? 'rotate(-90deg)' : 'none' }}>
                    <path d="M6 9l6 6 6-6"/>
                  </svg>
                </div>

                {/* ── Group cards ── */}
                {!isCollapsed && (
                  <div style={{ display:'flex', flexDirection:'column', gap:'6px', marginBottom:'4px' }}>
                    {groupAlgos.map(algo => {
                      const st          = worstStatus(grid[algo.id])
                      const bar         = STATUS_BAR[st]
                      const mult        = cardMults[algo.id] || 1
                      const isExpanded  = expandedId === algo.id
                      const typeStr     = algo.account?.toLowerCase().includes('ao') ? 'Direct' : 'Broker'
                      const instruments = Array.from(new Set(algo.legs.map(l => l.i)))

                      return (
                        <div key={algo.id}
                          onClick={() => setExpandedId(expandedId === algo.id ? null : algo.id)}
                          style={{ display:'flex', flexDirection:'column', overflow:'hidden', borderRadius:'10px', cursor:'pointer',
                            background:'rgba(14,14,18,0.90)', border:'0.5px solid rgba(255,255,255,0.07)',
                            transition:'transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease',
                          }}
                          onMouseEnter={e => { const d=e.currentTarget; d.style.transform='translateY(-2px)'; d.style.boxShadow='0 8px 28px rgba(255,107,0,0.13)'; d.style.borderColor='rgba(255,107,0,0.28)' }}
                          onMouseLeave={e => { const d=e.currentTarget; d.style.transform='none'; d.style.boxShadow='none'; d.style.borderColor='rgba(255,255,255,0.07)' }}>

                          {/* ── Main row ── */}
                          <div style={{ display:'flex', alignItems:'stretch', minHeight:'80px' }}>

                            {/* Status strip — full card height */}
                            <div style={{ width:'4px', flexShrink:0, alignSelf:'stretch',
                              background:bar.color, borderRadius:'2px',
                              boxShadow:`0 0 8px ${bar.glow}, 0 0 20px ${bar.glow}` }}/>

                            {/* Card row body */}
                            <div style={{ flex:1, display:'flex', alignItems:'center', gap:'24px', padding:'18px 24px' }}>

                              {/* ── Info block ── */}
                              <div style={{ display:'flex', gap:'10px', width:'260px', flexShrink:0, alignItems:'flex-start' }}>
                                <div style={{ display:'flex', flexDirection:'column', gap:'3px', minWidth:0, flex:1 }}>
                                  <span onClick={e => { e.stopPropagation(); nav(`/algo/${algo.id}`) }}
                                    style={{ fontFamily:'var(--font-display)', fontWeight:600, fontSize:'14px', color:'#F0F0FF',
                                      cursor:'pointer', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
                                      textDecoration:'underline', textDecorationStyle:'dotted', textDecorationColor:'rgba(255,107,0,0.35)' }}>
                                    {algo.name}
                                  </span>
                                  <span style={{ fontSize:'11px', color:'rgba(232,232,248,0.38)', fontFamily:'var(--font-body)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                                    {algo.account || '—'}
                                  </span>
                                </div>
                                <div style={{ display:'flex', flexDirection:'column', gap:'4px', minWidth:0, flex:1 }}>
                                  <span style={{ fontSize:'10px', color:'rgba(232,232,248,0.45)', whiteSpace:'nowrap', letterSpacing:'0.3px' }}>
                                    {toTitleCase(algo.entry_type ?? typeStr)} · {toTitleCase(algo.strategy_mode ?? 'Intraday')}
                                  </span>
                                  <div style={{ display:'flex', gap:'4px', flexWrap:'wrap' }}>
                                    {instruments.map(ins => (
                                      <span key={ins} style={{
                                        display:'inline-flex', alignItems:'center', padding:'2px 7px', borderRadius:'100px',
                                        fontSize:'10px', fontWeight:700, fontFamily:'var(--font-display)', letterSpacing:'0.5px',
                                        background:'rgba(255,107,0,0.10)', color:'var(--ox-glow)',
                                        border:'0.5px solid rgba(255,107,0,0.28)',
                                      }}>{ins}</span>
                                    ))}
                                  </div>
                                </div>
                              </div>

                              {/* ── Entry / Exit time ── */}
                              <div style={{ display:'flex', flexDirection:'column', gap:'3px', width:'90px', flexShrink:0 }}>
                                <div style={{ display:'flex', alignItems:'center', gap:'5px' }}>
                                  <span style={{ color:'var(--ox-radiant)', fontSize:'10px' }}>▶</span>
                                  <span style={{ fontFamily:'var(--font-mono)', fontSize:'12px', color:'var(--ox-radiant)', fontWeight:600 }}>{algo.et}</span>
                                </div>
                                <div style={{ display:'flex', alignItems:'center', gap:'5px' }}>
                                  <span style={{ color:'var(--text-muted)', fontSize:'10px' }}>⏹</span>
                                  <span style={{ fontFamily:'var(--font-mono)', fontSize:'12px', color:'var(--text-muted)' }}>{algo.xt}</span>
                                </div>
                              </div>

                              {/* ── Lot multiplier stepper ── */}
                              <div style={{ display:'flex', alignItems:'center', gap:'5px', width:'88px', flexShrink:0, justifyContent:'center' }}
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

                              {/* ── Day pills M T W T F S S ── */}
                              <div style={{ display:'flex', gap:'4px', alignItems:'center', flex:1, minWidth:'220px', justifyContent:'center' }}>
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
                                      onClick={e => { e.stopPropagation(); isDeployed ? rmCell(algo.id, day) : deployDay(algo.id, day) }}
                                      title={`${day}${isHoliday?' (Holiday)':''}${isDeployed ? ` · ${deployedSt?.label||'Active'} · click to remove` : ' · click to deploy'}`}
                                      style={{
                                        width:'28px', height:'28px', borderRadius:'50%', cursor:'pointer', position:'relative',
                                        fontFamily:'var(--font-display)', fontSize:'10px', fontWeight:700,
                                        display:'flex', alignItems:'center', justifyContent:'center',
                                        transition:'all 0.15s ease', flexShrink:0,
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
                              <div style={{ width:'90px', flexShrink:0, display:'flex', justifyContent:'center' }}
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
                              <div style={{ width:'56px', flexShrink:0, display:'flex', gap:'4px', justifyContent:'flex-end' }}
                                onClick={e => e.stopPropagation()}>
                                <IBtn onClick={() => setDel(algo.id)}         icon={<TrashIcon/>}   dc="#FF4444" hc="#FF4444" hoverBg="rgba(255,68,68,0.12)"   hoverBorder="rgba(255,68,68,0.4)"   title="Delete permanently"/>
                                <IBtn onClick={() => setArchConfirm(algo.id)} icon={<ArchiveIcon/>} dc="#60A5FA" hc="#60A5FA" hoverBg="rgba(96,165,250,0.12)"  hoverBorder="rgba(96,165,250,0.4)"  title="Archive"/>
                              </div>

                            </div>{/* end card row body */}
                          </div>{/* end main row */}

                          {/* ── Expanded detail panel ── */}
                          {isExpanded && (() => {
                            const leg0 = algo.legs[0]
                            const lbl = (text: string) => (
                              <div style={{ fontSize:'9px', fontWeight:700, letterSpacing:'1.5px', textTransform:'uppercase', color:'var(--gs-light)', fontFamily:'var(--font-display)', marginBottom:'4px' }}>{text}</div>
                            )
                            const val = (text: string, color = '#F0F0FF') => (
                              <div style={{ fontSize:'13px', color, fontFamily:'var(--font-mono)' }}>{text}</div>
                            )
                            const boolVal = (flag?: boolean) => val(flag ? 'Yes' : 'No', flag ? '#22DD88' : 'var(--gs-light)')
                            return (
                              <div onClick={e => e.stopPropagation()}
                                style={{ borderTop:'0.5px solid rgba(255,107,0,0.15)', padding:'14px 24px 16px',
                                  display:'flex', flexDirection:'column', gap:'12px' }}>
                                {/* Row 1 — MTM settings */}
                                <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'16px' }}>
                                  <div>{lbl('MTM SL')}{val(algo.mtm_sl != null ? `₹${algo.mtm_sl.toLocaleString('en-IN')}` : '—')}</div>
                                  <div>{lbl('MTM TP')}{val(algo.mtm_tp != null ? `₹${algo.mtm_tp.toLocaleString('en-IN')}` : '—')}</div>
                                  <div>{lbl('MTM Unit')}{val(algo.mtm_unit ? toTitleCase(algo.mtm_unit) : '—')}</div>
                                  <div>{lbl('Global SL')}{val('—')}</div>
                                </div>
                                {/* Row 2 — Execution settings (first leg) */}
                                <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'16px' }}>
                                  <div>{lbl('Strike Type')}{val(leg0?.strikeType ? toTitleCase(leg0.strikeType) : '—')}</div>
                                  <div>{lbl('Lots')}{val(leg0?.lots != null ? String(leg0.lots) : '—')}</div>
                                  <div>{lbl('Re-entry SL')}{boolVal(leg0?.reSlEnabled)}</div>
                                  <div>{lbl('Re-entry TP')}{boolVal(leg0?.reTpEnabled)}</div>
                                </div>
                                {/* Row 3 — Strategy settings (first leg) */}
                                <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'16px' }}>
                                  <div>{lbl('W&T')}{boolVal(leg0?.wtEnabled)}</div>
                                  <div>{lbl('Journey')}{boolVal(leg0?.hasJourney)}</div>
                                  <div>{lbl('TSL')}{val(leg0?.tslX != null ? `${leg0.tslX} → ${leg0.tslY}` : '—')}</div>
                                  <div>{lbl('TTP')}{val(leg0?.ttpX != null ? `${leg0.ttpX} → ${leg0.ttpY}` : '—')}</div>
                                </div>
                                {DAYS.some(d => !grid[algo.id]?.[d]) && (
                                  <div style={{ paddingTop:'8px', borderTop:'0.5px solid rgba(255,255,255,0.04)', display:'flex', gap:'8px' }}>
                                    <button onClick={() => addAllWeekdays(algo.id)} className="btn btn-ghost"
                                      style={{ fontSize:'11px', height:'28px', padding:'0 12px' }}>
                                      Deploy All Weekdays
                                    </button>
                                  </div>
                                )}
                              </div>
                            )
                          })()}

                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
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
