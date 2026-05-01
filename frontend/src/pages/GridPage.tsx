import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { algosAPI, gridAPI, accountsAPI } from '@/services/api'
import { useStore } from '@/store'
import { StaaxSelect } from '@/components/StaaxSelect'
import { Lightning, LightningSlash, Archive, Copy, Trash, Play, Stop, Warning, Sparkle } from '@phosphor-icons/react'
import { AlgoAIAssistant } from '@/components/ai/AlgoAIAssistant'
import { showSuccess, showError, showInfo } from '@/utils/toast'

// ── Types ──────────────────────────────────────────────────────────────────────
const DAYS     = ['MON','TUE','WED','THU','FRI']
const ALL_DAYS = ['MON','TUE','WED','THU','FRI','SAT','SUN']
const DAY_LBL  = ['M','T','W','T','F','S','S']
const ABBR_TO_UNDERLYING: Record<string,string> = {
  NF:'NIFTY', BN:'BANKNIFTY', SX:'SENSEX', MN:'MIDCAPNIFTY', FN:'FINNIFTY'
}
const INSTRUMENT_ORDER = ['NIFTY','BANKNIFTY','SENSEX','MIDCAPNIFTY','FINNIFTY','OTHER']
type CS = 'no_trade'|'waiting'|'algo_active'|'order_pending'|'open'|'algo_closed'|'error'
type CM = 'practix'|'live'

interface Cell {
  gridEntryId?:  string
  multiplier:    number
  status:        CS
  mode:          CM
  entry:         string
  exit?:         string
  pnl?:          number
  tradingDate?:  string
  is_monitoring?: boolean
}
interface RawAccount { id: string; nickname: string; broker: string }
interface RawAlgoLeg {
  underlying?: string; direction?: string; lots?: number; strike_type?: string
  wt_enabled?: boolean; wt_value?: number; wt_unit?: string; journey_config?: { child?: unknown }
  tsl_x?: number; tsl_y?: number; ttp_x?: number; ttp_y?: number
  reentry_on_sl?: boolean; reentry_on_tp?: boolean
}
interface RawAlgo {
  id: string | number; name: string; account_nickname?: string; legs?: RawAlgoLeg[]
  entry_time?: string; exit_time?: string; next_day_exit_time?: string; strategy_mode?: string
  is_archived?: boolean; recurring_days?: string[]; is_live?: boolean
  mtm_sl?: number; mtm_tp?: number; mtm_unit?: string; entry_type?: string; order_type?: string
}
interface RawGridEntry {
  algo_id: string | number; trading_date: string; status?: string; mode?: string
  multiplier?: number; lot_multiplier?: number; entry_time?: string; exit_time?: string; pnl?: number
  grid_entry_id?: string; id?: string; is_monitoring?: boolean; is_practix?: boolean
  [key: string]: unknown
}

interface Algo {
  id:            string
  name:          string
  account:       string
  legs:          {i:string; d:'B'|'S'; lots?:number; strikeType?:string; wtEnabled?:boolean; wtValue?:number; wtUnit?:string; hasJourney?:boolean; tslX?:number; tslY?:number; ttpX?:number; ttpY?:number; reSlEnabled?:boolean; reTpEnabled?:boolean}[]
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


// ── Custom dropdown ────────────────────────────────────────────────────────────
// ── Component ──────────────────────────────────────────────────────────────────
export default function GridPage() {
  const nav            = useNavigate()
  const weekDates      = getWeekDates()
  const isPractixMode  = useStore(s => s.isPractixMode)
  const activeAccount  = useStore(s => s.activeAccount)
  const todayDay       = getTodayDay()

  const [algos,         setAlgos]        = useState<Algo[]>([])
  const [grid,          setGrid]         = useState<Record<string,Record<string,Cell>>>({})
  const [loading,       setLoading]      = useState(true)
  const [showArch,      setShowArch]     = useState(() => localStorage.getItem('showArch') === 'true')
  const [archConfirm,   setArchConfirm]  = useState<string|null>(null)
  const [cardMults,       setCardMults]       = useState<Record<string,number>>({})
  const [filterAccount,   setFilterAccount]   = useState('all')
  const [statFilter,      setStatFilter]      = useState<string|null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [showDeferModal, setShowDeferModal] = useState(false)
  const [deferAlgo,      setDeferAlgo]      = useState<Algo|null>(null)
  const [deferDay,       setDeferDay]       = useState('')
  const [confirmCancel,  setConfirmCancel]  = useState<{algoId: string; day: string; entryId: string} | null>(null)
  const [hoveredPill,    setHoveredPill]    = useState<string|null>(null)  // "algoId-day"
  const [stickyHeader,   setStickyHeader]   = useState<string|null>(null)
  const [showAI,         setShowAI]         = useState(false)
  const [aiEditAlgo,     setAiEditAlgo]     = useState<Algo|null>(null)
  const [aiAccounts,     setAiAccounts]     = useState<{id:string,nickname:string,broker:string}[]>([])
  const listScrollRef    = useRef<HTMLDivElement>(null)
  const groupHeaderRefs  = useRef<Map<string, HTMLDivElement>>(new Map())


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

  // ── Load accounts for AI assistant ───────────────────────────────────────────
  useEffect(() => {
    accountsAPI.list()
      .then(res => setAiAccounts((res.data || []).map((a: RawAccount) => ({ id: a.id, nickname: a.nickname, broker: a.broker }))))
      .catch(() => {})
  }, [])

  // ── Load data ─────────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const algoRes = await algosAPI.list({ include_archived: true })
      const apiAlgos: Algo[] = (algoRes.data as RawAlgo[] || []).map((a) => ({
        id:           String(a.id),
        name:         a.name,
        account:      a.account_nickname || '',
        legs:         (a.legs || []).map((l) => ({
          i: (({'NIFTY':'NF','BANKNIFTY':'BN','SENSEX':'SX','MIDCAPNIFTY':'MN','FINNIFTY':'FN'} as Record<string,string>)[l.underlying || ''] || (l.underlying||'NF').slice(0,2).toUpperCase()),
          d:            l.direction === 'buy' ? 'B' : 'S',
          lots:         l.lots ?? undefined,
          strikeType:   l.strike_type ?? undefined,
          wtEnabled:    !!l.wt_enabled,
          wtValue:      l.wt_value ?? undefined,
          wtUnit:       l.wt_unit ?? undefined,
          hasJourney:   !!(l.journey_config?.child),
          tslX:         l.tsl_x ?? undefined,
          tslY:         l.tsl_y ?? undefined,
          ttpX:         l.ttp_x ?? undefined,
          ttpY:         l.ttp_y ?? undefined,
          reSlEnabled:  !!l.reentry_on_sl,
          reTpEnabled:  !!l.reentry_on_tp,
        })),
        et:           a.entry_time  || '09:16',
        xt:           (['stbt','btst'].includes(a.strategy_mode || '') ? a.next_day_exit_time : a.exit_time) || '15:10',
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
      const entries: RawGridEntry[] = gridRes.data?.entries || gridRes.data || []
      const newGrid: Record<string,Record<string,Cell>> = {}

      for (const e of entries) {
        const algoId = String(e.algo_id)
        const day    = dateToDay(e.trading_date, weekDates)
        if (!day) continue
        if (!newGrid[algoId]) newGrid[algoId] = {}
        const algoMatch = apiAlgos.find(a => a.id === algoId)
        newGrid[algoId][day] = {
          gridEntryId:   String(e.id),
          multiplier:    e.lot_multiplier || 1,
          status:        mapStatus(e.status || 'algo_active'),
          mode:          e.is_practix ? 'practix' : 'live',
          entry:         e.entry_time  || algoMatch?.et || '09:16',
          exit:          e.exit_time   || algoMatch?.xt || '15:10',
          pnl:           e.pnl ?? undefined,
          tradingDate:   e.trading_date || undefined,
          is_monitoring: e.is_monitoring ?? false,
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
        showSuccess(`Auto-filled ${filled} recurring day${filled > 1 ? 's' : ''}`)
      }
    } catch { /* API unreachable */ } finally { setLoading(false) }
  }, [isPractixMode, activeAccount])

  useEffect(() => { loadData() }, [loadData])

  const handleListScroll = useCallback(() => {
    if (!listScrollRef.current) return
    const containerTop = listScrollRef.current.getBoundingClientRect().top
    let activeGroup: string | null = null
    for (const key of INSTRUMENT_ORDER) {
      const el = groupHeaderRefs.current.get(key)
      if (!el) continue
      if (el.getBoundingClientRect().top <= containerTop) activeGroup = key
    }
    setStickyHeader(activeGroup)
  }, [])


  // ── Day pill toggle ───────────────────────────────────────────────────────────
  const toggleDay = async (algo: Algo, day: string) => {
    const isActive = algo.recurringDays.includes(day)

    if (isActive) {
      const cell     = grid[algo.id]?.[day]
      const st       = cell?.status
      const todayIso = weekDates[todayDay]

      // BLOCK + DEFER: algo is active today — schedule removal for after midnight
      const shouldDefer =
        st === 'open' || st === 'order_pending' || st === 'algo_active' || st === 'waiting' ||
        (st === 'algo_closed' && cell?.tradingDate === todayIso)

      if (shouldDefer) {
        setDeferAlgo(algo)
        setDeferDay(day)
        setShowDeferModal(true)
        return
      }

      // ALLOW IMMEDIATELY: past day close, no_trade, error, undefined, future days
      const newDays = algo.recurringDays.filter(d => d !== day)
      setAlgos(a => a.map(x => x.id === algo.id ? { ...x, recurringDays: newDays } : x))
      try {
        const res = await algosAPI.updateRecurringDays(algo.id, newDays)
        if (Array.isArray(res.data?.recurring_days))
          setAlgos(a => a.map(x => x.id === algo.id ? { ...x, recurringDays: res.data.recurring_days } : x))
      } catch {
        setAlgos(a => a.map(x => x.id === algo.id ? { ...x, recurringDays: algo.recurringDays } : x))
        showError('Day update failed')
      }
      return
    }

    // ADDING a day — always immediate
    const newDays = [...algo.recurringDays, day]
    setAlgos(a => a.map(x => x.id === algo.id ? { ...x, recurringDays: newDays } : x))
    try {
      const res = await algosAPI.updateRecurringDays(algo.id, newDays)
      if (Array.isArray(res.data?.recurring_days))
        setAlgos(a => a.map(x => x.id === algo.id ? { ...x, recurringDays: res.data.recurring_days } : x))

      // If adding today — immediately activate so Orders page shows WAITING
      if (day === todayDay) {
        gridAPI.activateNow().catch(() => {})
      }
    } catch {
      setAlgos(a => a.map(x => x.id === algo.id ? { ...x, recurringDays: algo.recurringDays } : x))
      showError('Day update failed')
    }
  }

  // ── Multiplier ────────────────────────────────────────────────────────────────
  const setM = async (algoId: string, day: string, v: number) => {
    if (v < 1) return
    const cell = grid[algoId]?.[day]
    setGrid(g => ({ ...g, [algoId]:{ ...g[algoId], [day]:{ ...g[algoId][day], multiplier:v } } }))
    if (cell?.gridEntryId) {
      try { await gridAPI.update(cell.gridEntryId, { lot_multiplier:v }) }
      catch { setGrid(g => ({ ...g, [algoId]:{ ...g[algoId], [day]:{ ...g[algoId][day], multiplier:cell.multiplier } } })); showError('Multiplier update failed') }
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

  // ── Archive / Delete ──────────────────────────────────────────────────────────
  const archAlgo = async (algoId: string) => {
    const hasActive = Object.values(grid[algoId]||{}).some(c => c.status==='algo_active'||c.status==='waiting'||c.status==='open'||c.status==='order_pending')
    if (hasActive) { showError('Cannot archive — algo has active positions this week'); return }
    setAlgos(a => a.map(x => x.id===algoId ? { ...x, arch:true } : x))
    setGrid(g => { const n={...g}; delete n[algoId]; return n })
    try { await algosAPI.archive(algoId) } catch { loadData(); showError('Archive failed') }
  }
  const unarch = async (algoId: string) => {
    setAlgos(a => a.map(x => x.id===algoId ? { ...x, arch:false } : x))
    try { await algosAPI.unarchive(algoId) } catch { setAlgos(a => a.map(x => x.id===algoId ? { ...x, arch:true } : x)); showError('Reactivate failed') }
  }

  // ── Cancel WAITING/ERROR entry ─────────────────────────────────────────────────
  const cancelEntry = (algoId: string, day: string, entryId: string) => {
    setConfirmCancel({ algoId, day, entryId })
  }

  const handleCancelConfirmed = async () => {
    if (!confirmCancel) return
    const { algoId, day, entryId } = confirmCancel
    setConfirmCancel(null)
    try {
      await gridAPI.cancel(entryId)
      setGrid(g => ({
        ...g,
        [algoId]: { ...g[algoId], [day]: { ...g[algoId][day], status: 'no_trade' as CS } }
      }))
    } catch (e) {
      const err = e as { response?: { data?: { detail?: string } } }
      showError(err?.response?.data?.detail || 'Cancel failed')
    }
  }

  const duplicateAlgo = async (algoId: string) => {
    try {
      await algosAPI.duplicate(algoId)
      await loadData()
    } catch { showError('Duplicate failed') }
  }

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

  const statFilteredAlgos = statFilter === null ? visibleAlgos : visibleAlgos.filter(a => {
    if (statFilter === 'buy_only')   return a.legs.length > 0 && a.legs.every(l => l.d === 'B')
    if (statFilter === 'sell_only')  return a.legs.length > 0 && a.legs.every(l => l.d === 'S')
    if (statFilter === 'both')       return a.legs.some(l => l.d === 'B') && a.legs.some(l => l.d === 'S')
    if (statFilter === 'intraday')   return !a.strategy_mode || a.strategy_mode === 'intraday'
    if (statFilter === 'stbt_btst')  return a.strategy_mode === 'stbt' || a.strategy_mode === 'btst'
    if (statFilter === 'positional') return a.strategy_mode === 'positional'
    return true
  })

  // ── Group by primary instrument ───────────────────────────────────────────────
  const groupedAlgos: Record<string, Algo[]> = {}
  for (const algo of statFilteredAlgos) {
    const key = ABBR_TO_UNDERLYING[algo.legs[0]?.i] || 'OTHER'
    if (!groupedAlgos[key]) groupedAlgos[key] = []
    groupedAlgos[key].push(algo)
  }
  const groupKeys = INSTRUMENT_ORDER.filter(k => groupedAlgos[k]?.length > 0)


  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display:'flex', flexDirection:'column', flex:1, minHeight:0 }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ flexShrink:0, paddingLeft:'28px', paddingRight:'28px' }}>
        <div className="page-header">
          <div>
            <h1 style={{ fontFamily:'var(--font-display)', fontSize:'22px', fontWeight:800, color:'var(--accent)' }}>Algos</h1>
            <div style={{ display:'flex', alignItems:'center', gap:'10px', marginTop:'3px' }}>
              <span style={{ fontSize:'12px', color:'var(--text-mute)' }}>
                Week of {new Date().toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric', timeZone:'Asia/Kolkata' })}
              </span>
            </div>
          </div>
          <div className="page-header-actions">

            {/* Account filter */}
            <StaaxSelect value={filterAccount} onChange={setFilterAccount} options={accountOptions} width="130px"/>

            {/* Archive toggle — inset when active, raised when inactive */}
            <button
              onClick={() => setShowArch(v => { const next = !v; localStorage.setItem('showArch', String(next)); return next })}
              style={{
                position:'relative', height:32, padding:'0 14px', borderRadius:100,
                background:'var(--bg)', border:'none',
                boxShadow: showArch ? 'var(--neu-inset)' : 'var(--neu-raised-sm)',
                color: showArch ? 'var(--accent)' : 'var(--text-dim)',
                fontSize:12, fontWeight:500, fontFamily:'var(--font-body)',
                cursor:'pointer', flexShrink:0, transition:'box-shadow 0.15s, color 0.15s',
              }}
            >
              Archive
              {archived.length > 0 && (
                <span style={{
                  position:'absolute', top:-5, right:-5,
                  minWidth:16, height:16, borderRadius:8,
                  background:'var(--accent)', color:'#fff',
                  fontSize:9, fontWeight:700, fontFamily:'var(--font-body)',
                  display:'flex', alignItems:'center', justifyContent:'center',
                  padding:'0 4px', lineHeight:1,
                  boxShadow:'0 1px 4px rgba(0,0,0,0.2)',
                }}>
                  {archived.length}
                </span>
              )}
            </button>

            {/* AI Algo Builder */}
            <button
              onClick={() => { setAiEditAlgo(null); setShowAI(true) }}
              className="ai-btn-glow"
              style={{
                height:32, padding:'0 14px', borderRadius:100,
                background:'var(--bg)', border:'none',
                color:'var(--text-dim)', fontSize:12, fontWeight:600,
                fontFamily:'var(--font-body)', cursor:'pointer',
                boxShadow:'var(--neu-raised-sm)',
                flexShrink:0, display:'flex', alignItems:'center', gap:5,
                animation:'aiGlow 3s ease-in-out infinite',
                transition:'transform 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.transform='scale(1.05)' }}
              onMouseLeave={e => { e.currentTarget.style.transform='scale(1)' }}
              onMouseDown={e => { e.currentTarget.style.boxShadow='var(--neu-inset)' }}
              onMouseUp={e => { e.currentTarget.style.boxShadow='var(--neu-raised-sm)' }}
            >
              <Sparkle size={13} weight="fill" color="var(--accent)" style={{ animation:'sparkleRotate 2.5s ease-in-out infinite' }} />
              AI
            </button>

            {/* New Algo */}
            <button
              onClick={() => nav('/algo/new')}
              style={{
                height:32, padding:'0 16px', borderRadius:100,
                background:'var(--bg)', border:'none',
                color:'var(--accent)', fontSize:12, fontWeight:600,
                fontFamily:'var(--font-body)', cursor:'pointer',
                boxShadow:'var(--neu-raised-sm)', transition:'box-shadow 0.15s',
                flexShrink:0,
              }}
              onMouseDown={e => { e.currentTarget.style.boxShadow='var(--neu-inset)' }}
              onMouseUp={e => { e.currentTarget.style.boxShadow='var(--neu-raised-sm)' }}
              onMouseLeave={e => { e.currentTarget.style.boxShadow='var(--neu-raised-sm)' }}
            >
              + New Algo
            </button>
          </div>
        </div>
      </div>

      {/* ── Archive panel ──────────────────────────────────────────────────── */}
      {showArch && (
        <div style={{ flexShrink:0, marginLeft:'28px', marginRight:'28px', marginBottom:'12px' }}>
          <div style={{ background:'var(--bg)', borderRadius:16, boxShadow:'var(--neu-inset)', padding:'14px 16px' }}>
            <div style={{ fontSize:'10px', fontWeight:700, color:'var(--text-mute)', marginBottom:'12px', textTransform:'uppercase', letterSpacing:'2px', fontFamily:'var(--font-body)' }}>Archived</div>
          {loading
            ? <span style={{ fontSize:'12px', color:'var(--text-dim)' }}>Loading…</span>
            : archived.length === 0
            ? <span style={{ fontSize:'12px', color:'var(--text-dim)' }}>No archived algos.</span>
            : <div style={{ display:'flex', flexWrap:'wrap', gap:'8px' }}>
                {archived.map(a => (
                  <div key={a.id} style={{ display:'flex', alignItems:'center', gap:'12px', background:'var(--bg)', borderRadius:12, padding:'8px 12px', boxShadow:'var(--neu-raised-sm)' }}>
                    <div>
                      <div style={{ fontSize:'12px', fontWeight:600, color:'var(--text)' }}>{a.name}</div>
                      <div style={{ fontSize:'10px', color:'var(--text-mute)' }}>{a.account}</div>
                    </div>
                    <button style={{ fontSize:'11px', height:'26px', padding:'0 10px', borderRadius:100, background:'var(--bg)', border:'none', boxShadow:'var(--neu-raised-sm)', color:'var(--accent)', fontWeight:600, cursor:'pointer', transition:'box-shadow 0.12s' }}
                      onMouseDown={e => { e.currentTarget.style.boxShadow='var(--neu-inset)' }}
                      onMouseUp={e => { e.currentTarget.style.boxShadow='var(--neu-raised-sm)' }}
                      onMouseLeave={e => { e.currentTarget.style.boxShadow='var(--neu-raised-sm)' }}
                      onClick={() => unarch(a.id)}>Reactivate</button>
                  </div>
                ))}
              </div>}
          </div>
        </div>
      )}

      {/* ── Stats summary cards — fixed, not scrollable ────────────────────── */}
      {visibleAlgos.length > 0 && (() => {
        const buyOnly    = visibleAlgos.filter(a => a.legs.length > 0 && a.legs.every(l => l.d === 'B')).length
        const sellOnly   = visibleAlgos.filter(a => a.legs.length > 0 && a.legs.every(l => l.d === 'S')).length
        const bothDir    = visibleAlgos.filter(a => a.legs.some(l => l.d === 'B') && a.legs.some(l => l.d === 'S')).length
        const intraday   = visibleAlgos.filter(a => !a.strategy_mode || a.strategy_mode === 'intraday').length
        const stbtBtst   = visibleAlgos.filter(a => a.strategy_mode === 'stbt' || a.strategy_mode === 'btst').length
        const positional = visibleAlgos.filter(a => a.strategy_mode === 'positional').length

        const insData = INSTRUMENT_ORDER
          .map(ins => ({ ins, count: groupedAlgos[ins]?.length || 0 }))
          .filter(x => x.count > 0)
        const maxIns = Math.max(...insData.map(x => x.count), 1)
        const INS_SHORT: Record<string,string> = {
          NIFTY:'NF', BANKNIFTY:'BN', FINNIFTY:'FN', SENSEX:'SX', MIDCAPNIFTY:'MN', OTHER:'OTH',
        }

        const kpiCards = [
          { key:'buy_only',   label:'Buy Only',    count:buyOnly,    color:'#22C55E' },
          { key:'sell_only',  label:'Sell Only',   count:sellOnly,   color:'#EF4444' },
          { key:'both',       label:'Buy & Sell',  count:bothDir,    color:'var(--accent)' },
          { key:'intraday',   label:'Intraday',    count:intraday,   color:'var(--accent)' },
          { key:'stbt_btst',  label:'STBT / BTST', count:stbtBtst,   color:'#F59E0B' },
          { key:'positional', label:'Positional',  count:positional, color:'#8B5CF6' },
        ]

        return (
          <div style={{ flexShrink:0, padding:'0 28px 14px' }}>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(6, 1fr) 2fr', gap:10 }}>
              {kpiCards.map(({ key, label, count, color }) => {
                const isActive = statFilter === key
                return (
                  <div key={key}
                    onClick={() => setStatFilter(isActive ? null : key)}
                    style={{
                      background:'var(--bg)',
                      boxShadow: isActive ? 'var(--neu-inset)' : 'var(--neu-raised-sm)',
                      borderRadius:14, padding:'12px 14px',
                      cursor:'pointer', transition:'box-shadow 0.15s',
                    }}>
                    <div style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color: isActive ? color : 'var(--text-mute)', marginBottom:8, fontFamily:'var(--font-display)', transition:'color 0.15s' }}>
                      {label}
                    </div>
                    <div style={{ fontSize:22, fontWeight:800, lineHeight:1, fontFamily:'var(--font-mono)', color }}>
                      {count}
                    </div>
                  </div>
                )
              })}

              {/* By Index bar chart */}
              <div style={{ background:'var(--bg)', boxShadow:'var(--neu-raised-sm)', borderRadius:14, padding:'12px 16px' }}>
                <div style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--text-mute)', marginBottom:8, fontFamily:'var(--font-display)' }}>
                  By Index
                </div>
                <div style={{ display:'flex', alignItems:'flex-end', gap:8, height:52 }}>
                  {insData.map(({ ins, count:cnt }) => {
                    const barH = Math.max(cnt / maxIns * 36, 6)
                    return (
                      <div key={ins} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
                        <span style={{ fontSize:8, fontWeight:800, color:'var(--accent)', fontFamily:'var(--font-mono)', lineHeight:1 }}>{cnt}</span>
                        <div style={{ width:'100%', height:barH, borderRadius:'3px 3px 0 0',
                          background:'linear-gradient(to top, rgba(229,90,0,0.45), rgba(229,90,0,0.9))',
                          transition:'height 0.4s cubic-bezier(0.4,0,0.2,1)',
                          flexShrink:0,
                        }} />
                        <span style={{ fontSize:8, fontWeight:700, color:'var(--text-mute)', fontFamily:'var(--font-display)' }}>{INS_SHORT[ins] || ins.slice(0,2)}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Algo cards outer container ─────── */}
      <div style={{ flex:1, minHeight:0, display:'flex', flexDirection:'column', position:'relative' }}>

        {/* ── Sticky group header overlay — rendered above scroll container, bypasses compositor z-index issues ── */}
        {stickyHeader && (() => {
          const groupAlgos = groupedAlgos[stickyHeader] || []
          const isCollapsed = collapsedGroups.has(stickyHeader)
          return (
            <div style={{
              position:'absolute', top:0, left:0, right:0, zIndex:100,
              backgroundColor:'var(--bg)',
              padding:'14px 28px 0',
              borderBottom:'0.5px solid rgba(0,0,0,0.05)',
            }}>
              <div
                onClick={() => setCollapsedGroups(prev => {
                  const next = new Set(prev)
                  if (next.has(stickyHeader)) next.delete(stickyHeader); else next.add(stickyHeader)
                  return next
                })}
                style={{ display:'flex', alignItems:'center', gap:'10px', cursor:'pointer',
                  paddingBottom:'8px',
                  borderBottom:'0.5px solid rgba(255,107,0,0.15)', userSelect:'none',
                }}>
                <span style={{ fontFamily:'var(--font-display)', fontSize:'13px', fontWeight:700, color:'#FF6B00', letterSpacing:'1px' }}>
                  {stickyHeader}
                </span>
                <span style={{ fontSize:'11px', color:'var(--text-mute)' }}>
                  {groupAlgos.length} algo{groupAlgos.length !== 1 ? 's' : ''}
                </span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,107,0,0.55)" strokeWidth="2.5"
                  style={{ marginLeft:'auto', transition:'transform 0.2s ease', transform: isCollapsed ? 'rotate(-90deg)' : 'none' }}>
                  <path d="M6 9l6 6 6-6"/>
                </svg>
              </div>
            </div>
          )
        })()}

        <div ref={listScrollRef} className="no-scrollbar" style={{ flex:1, overflowY:'auto', padding:'14px 28px 24px' }} onScroll={handleListScroll}>

          {statFilteredAlgos.length === 0 && (
            <div style={{ padding:'64px 24px', textAlign:'center', color:'var(--text-dim)', fontSize:'13px' }}>
              {statFilter ? 'No algos match this filter.' : 'No algos to show. Create an algo to get started.'}
            </div>
          )}

          {groupKeys.map((instrument, gIdx) => {
            const groupAlgos  = groupedAlgos[instrument]
            const isCollapsed = collapsedGroups.has(instrument)
            return (
              <div key={instrument}>

                {/* ── Group header ── */}
                <div
                  ref={el => { if (el) groupHeaderRefs.current.set(instrument, el); else groupHeaderRefs.current.delete(instrument) }}
                  style={{
                    paddingTop: gIdx === 0 ? 0 : '20px',
                    marginBottom:'8px',
                  }}>
                <div
                  onClick={() => setCollapsedGroups(prev => {
                    const next = new Set(prev)
                    if (next.has(instrument)) next.delete(instrument); else next.add(instrument)
                    return next
                  })}
                  style={{ display:'flex', alignItems:'center', gap:'10px', cursor:'pointer',
                    paddingBottom:'8px',
                    borderBottom:'0.5px solid rgba(255,107,0,0.15)', userSelect:'none',
                  }}>
                  <span style={{ fontFamily:'var(--font-display)', fontSize:'13px', fontWeight:700, color:'#FF6B00', letterSpacing:'1px' }}>
                    {instrument}
                  </span>
                  <span style={{ fontSize:'11px', color:'var(--text-mute)' }}>
                    {groupAlgos.length} algo{groupAlgos.length !== 1 ? 's' : ''}
                  </span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,107,0,0.55)" strokeWidth="2.5"
                    style={{ marginLeft:'auto', transition:'transform 0.2s ease', transform: isCollapsed ? 'rotate(-90deg)' : 'none' }}>
                    <path d="M6 9l6 6 6-6"/>
                  </svg>
                </div>
                </div>{/* end sticky wrapper */}

                {/* ── Group cards ── */}
                  {!isCollapsed && <div style={{ display:'flex', flexDirection:'column', gap:'16px', marginBottom:'4px' }}>
                    {groupAlgos.map(algo => {
                      const mult        = cardMults[algo.id] || 1
                      const typeStr     = algo.account?.toLowerCase().includes('ao') ? 'Direct' : 'Broker'
                      const instruments = Array.from(new Set(algo.legs.map(l => l.i)))

                      return (
                        <div key={algo.id}
                          style={{ display:'flex', flexDirection:'column', overflow:'hidden', borderRadius:20,
                            background:'var(--bg)', border:'none',
                            boxShadow:'var(--neu-raised)',
                            transition:'box-shadow 0.18s ease',
                          }}
                          onMouseEnter={e => { e.currentTarget.style.boxShadow='var(--neu-raised-lg)' }}
                          onMouseLeave={e => { e.currentTarget.style.boxShadow='var(--neu-raised)' }}>

                          {/* ── Main row ── */}
                          <div className="algo-card" style={{ display:'flex', alignItems:'stretch', minHeight:'88px' }}>


                            {/* Card row body */}
                            <div style={{ flex:1, display:'flex', alignItems:'center', gap:'16px', padding:'16px 20px' }}>

                              {/* ── Name + account ── */}
                              <div style={{ display:'flex', flexDirection:'column', gap:'6px', width:'120px', flexShrink:0 }}>
                                <span onClick={e => { e.stopPropagation(); nav(`/algo/${algo.id}`) }}
                                  style={{ fontFamily:'var(--font-display)', fontWeight:600, fontSize:'14px', color:'var(--accent)',
                                    cursor:'pointer', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
                                    textDecoration:'underline', textDecorationStyle:'dotted', textDecorationColor:'var(--border-accent)' }}>
                                  {algo.name}
                                </span>
                                <span style={{ fontSize:'10px', color:'var(--text-mute)', fontFamily:'var(--font-body)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                                  {algo.account || '—'}
                                </span>
                              </div>

                              {/* ── Strategy + instrument chip ── */}
                              <div style={{ display:'flex', flexDirection:'column', gap:'6px', width:'100px', flexShrink:0 }}>
                                <span style={{ fontSize:'10px', color:'var(--text-dim)', whiteSpace:'nowrap', letterSpacing:'0.3px' }}>
                                  {toTitleCase(algo.entry_type ?? typeStr)} · {['btst','stbt'].includes((algo.strategy_mode||'').toLowerCase()) ? (algo.strategy_mode||'').toUpperCase() : toTitleCase(algo.strategy_mode ?? 'Intraday')}
                                </span>
                                <div style={{ display:'flex', gap:'4px', flexWrap:'wrap', alignItems:'center' }}>
                                  {instruments.map(ins => (
                                    <span key={ins} style={{
                                      display:'inline-flex', alignItems:'center', padding:'2px 8px', borderRadius:'100px',
                                      fontSize:'10px', fontWeight:700, fontFamily:'var(--font-display)', letterSpacing:'0.5px',
                                      background:'var(--bg)', color:'var(--text-dim)',
                                      border:'none', boxShadow:'var(--neu-inset)',
                                    }}>{ins}</span>
                                  ))}
                                </div>
                              </div>

                              {/* ── Entry / Exit time ── */}
                                <div style={{ display:'flex', flexDirection:'column', gap:'3px', width:'90px', flexShrink:0, marginLeft:'10px' }}>
                                  <div style={{ display:'flex', alignItems:'center', gap:'5px' }}>
                                    <Play size={10} weight="fill" style={{ color:'var(--ox-radiant)', flexShrink:0 }} />
                                    <span style={{ fontFamily:'var(--font-mono)', fontSize:'12px', color:'var(--ox-radiant)', fontWeight:600 }}>{algo.et}</span>
                                  </div>
                                  <div style={{ display:'flex', alignItems:'center', gap:'5px' }}>
                                    <Stop size={10} weight="fill" style={{ color:'var(--text-dim)', flexShrink:0 }} />
                                    <span style={{ fontFamily:'var(--font-mono)', fontSize:'12px', color:'var(--text-dim)' }}>{algo.xt}</span>
                                    {(['stbt','btst'].includes(algo.strategy_mode||'')) && (
                                      <Warning size={11} weight="fill" style={{ color:'var(--accent-amber)', cursor:'help', flexShrink:0 }} />
                                    )}
                                  </div>
                                </div>

                              {/* ── Lot multiplier stepper ── */}
                              <div style={{ display:'flex', alignItems:'center', gap:6, width:'90px', flexShrink:0, justifyContent:'center', marginLeft:'30px' }}
                                onClick={e => e.stopPropagation()}>
                                  <button onClick={() => changeCardMult(algo.id, mult - 1)}
                                    style={{ width:26, height:26, borderRadius:'50%', background:'var(--bg)', border:'none', boxShadow:'var(--neu-raised-sm)', color:'var(--text-dim)', fontSize:14, lineHeight:'1', fontWeight:400, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', flexShrink:0, transition:'box-shadow 0.12s' }}
                                    onMouseDown={e => { e.currentTarget.style.boxShadow='var(--neu-inset)' }}
                                    onMouseUp={e => { e.currentTarget.style.boxShadow='var(--neu-raised-sm)' }}
                                    onMouseLeave={e => { e.currentTarget.style.boxShadow='var(--neu-raised-sm)' }}>−</button>
                                  <span style={{ fontFamily:'var(--font-mono)', fontSize:12, color:'var(--text)', minWidth:28, textAlign:'center', fontWeight:700 }}>
                                    {mult}×
                                  </span>
                                  <button onClick={() => changeCardMult(algo.id, mult + 1)}
                                    style={{ width:26, height:26, borderRadius:'50%', background:'var(--bg)', border:'none', boxShadow:'var(--neu-raised-sm)', color:'var(--text-dim)', fontSize:14, lineHeight:'1', fontWeight:400, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', flexShrink:0, transition:'box-shadow 0.12s' }}
                                    onMouseDown={e => { e.currentTarget.style.boxShadow='var(--neu-inset)' }}
                                    onMouseUp={e => { e.currentTarget.style.boxShadow='var(--neu-raised-sm)' }}
                                    onMouseLeave={e => { e.currentTarget.style.boxShadow='var(--neu-raised-sm)' }}>+</button>
                              </div>

                              {/* ── Day pills M T W T F S S ── */}
                              <div className="algo-card-days" style={{ display:'flex', gap:'4px', alignItems:'center', flexShrink:0, justifyContent:'center', marginLeft:'35px' }}>
                                {ALL_DAYS.map((day, i) => {
                                  const isInRecurring = algo.recurringDays.includes(day)
                                  const cell = grid[algo.id]?.[day]

                                  // unselected = neu-raised, selected = neu-inset
                                  const pillBg     = isInRecurring ? 'var(--bg)' : 'var(--bg)'
                                  const pillBorder = 'none'
                                  const pillColor  = isInRecurring ? 'var(--accent)' : 'var(--text-mute)'
                                  const pillWeight = isInRecurring ? 700 : 400
                                  const pillShadow = isInRecurring ? 'var(--neu-inset)' : 'var(--neu-raised-sm)'
                                  const showDot    = false
                                  const dotColor   = 'transparent'
                                  const dotAnim    = false

                                  const s = cell?.status
                                  const isMonitoring = cell?.is_monitoring === true

                                  const pillKey = `${algo.id}-${day}`
                                  const canCancel = (s === 'waiting' || s === 'algo_active' || s === 'error') && !!cell?.gridEntryId
                                  const isPillHovered = hoveredPill === pillKey

                                  return (
                                    <button key={day}
                                      onClick={e => { e.stopPropagation(); void toggleDay(algo, day) }}
                                      onMouseEnter={() => canCancel && setHoveredPill(pillKey)}
                                      onMouseLeave={() => setHoveredPill(null)}
                                      title={canCancel ? `${day} · hover for cancel` : `${day} · ${isInRecurring ? 'click to remove' : 'click to deploy'}`}
                                      style={{
                                        width:'32px', height:'32px', borderRadius:'50%', cursor:'pointer',
                                        fontFamily:'JetBrains Mono, monospace', fontSize:'10px',
                                        display:'flex', alignItems:'center', justifyContent:'center',
                                        position:'relative',
                                        transition:'all 0.15s ease', flexShrink:0,
                                        border: pillBorder,
                                        background: pillBg,
                                        color: pillColor,
                                        fontWeight: pillWeight,
                                        boxShadow: pillShadow,
                                      }}>
                                      {isMonitoring && !isPillHovered ? (
                                        <>
                                          <span style={{
                                            display: 'inline-block',
                                            width: 7, height: 7,
                                            borderRadius: '50%',
                                            background: '#2dd4bf',
                                            animation: 'pillDotPulse 1.4s ease-in-out infinite',
                                            marginRight: 3,
                                            flexShrink: 0,
                                          }} />
                                          <span style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.3px' }}>W&T</span>
                                        </>
                                      ) : (
                                        <>
                                          {DAY_LBL[i]}
                                          {showDot && !isPillHovered && !isMonitoring && (
                                            <span style={{
                                              position:'absolute',
                                              top:'4px',
                                              right:'4px',
                                              width:'4px',
                                              height:'4px',
                                              borderRadius:'50%',
                                              background: dotColor,
                                              animation: dotAnim ? 'pillDotPulse 1.4s ease-in-out infinite' : 'none',
                                            }}/>
                                          )}
                                        </>
                                      )}
                                      {canCancel && isPillHovered && (
                                        <span
                                          onClick={e => { e.stopPropagation(); void cancelEntry(algo.id, day, cell!.gridEntryId!) }}
                                          title="Cancel this run"
                                          style={{
                                            position:'absolute', inset:0, borderRadius:'50%',
                                            display:'flex', alignItems:'center', justifyContent:'center',
                                            background: 'rgba(0,0,0,0.65)', fontSize:'13px', color:'#FF4444',
                                            fontWeight:700, lineHeight:1,
                                          }}>×</span>
                                      )}
                                    </button>
                                  )
                                })}
                              </div>
                              <style>{`
                                @keyframes pillDotPulse {
                                  0%, 100% { opacity: 1; transform: scale(1); }
                                  50% { opacity: 0.3; transform: scale(0.6); }
                                }
                                @keyframes aiGlow {
                                  0%, 100% { box-shadow: var(--neu-raised-sm), 0 0 6px rgba(255,107,0,0.2); }
                                  50% { box-shadow: var(--neu-raised-sm), 0 0 14px rgba(255,107,0,0.4); }
                                }
                                @keyframes sparkleRotate {
                                  0%, 100% { transform: scale(1) rotate(0deg); }
                                  50% { transform: scale(1.15) rotate(12deg); }
                                }
                                @keyframes chatCirclePulse {
                                  0%, 100% { opacity: 0.7; }
                                  50% { opacity: 0.4; }
                                }
                              `}</style>


                            </div>{/* end card row body */}

                            {/* ── Right panel — neumorphic icon buttons ── */}
                            <div className="algo-card-actions" onClick={e => e.stopPropagation()} style={{
                              display:'flex', alignSelf:'stretch', gap:8, alignItems:'center',
                              padding:'0 20px',
                            }}>
                              {/* AI Edit */}
                              <button
                                onClick={() => { setAiEditAlgo(algo); setShowAI(true) }}
                                title="Edit with AI"
                                style={{
                                  display:'flex', alignItems:'center', justifyContent:'center',
                                  width:40, height:40, borderRadius:12,
                                  background:'var(--bg)', border:'none', boxShadow:'var(--neu-raised-sm)',
                                  cursor:'pointer', color:'var(--accent)', transition:'box-shadow 0.12s',
                                  animation:'aiGlow 3s ease-in-out infinite',
                                }}
                                onMouseDown={e => { e.currentTarget.style.boxShadow='var(--neu-inset)' }}
                                onMouseUp={e => { e.currentTarget.style.boxShadow='var(--neu-raised-sm)' }}
                                onMouseLeave={e => { e.currentTarget.style.boxShadow='var(--neu-raised-sm)' }}>
                                <Sparkle size={16} weight="fill" color="var(--accent)" style={{ animation:'sparkleRotate 2.5s ease-in-out infinite' }} />
                              </button>

                              {/* GO LIVE / DEMOTE */}
                              <button
                                onClick={() => isPractixMode ? promLive(algo.id) : demoteLive(algo.id)}
                                title={isPractixMode ? 'Go Live' : 'Demote to Practix'}
                                style={{
                                  display:'flex', alignItems:'center', justifyContent:'center',
                                  width:40, height:40, borderRadius:12,
                                  background:'var(--bg)', border:'none', boxShadow:'var(--neu-raised-sm)',
                                  cursor:'pointer', color: isPractixMode ? '#22DD88' : 'var(--text-dim)',
                                  transition:'box-shadow 0.12s',
                                }}
                                onMouseDown={e => { e.currentTarget.style.boxShadow='var(--neu-inset)' }}
                                onMouseUp={e => { e.currentTarget.style.boxShadow='var(--neu-raised-sm)' }}
                                onMouseLeave={e => { e.currentTarget.style.boxShadow='var(--neu-raised-sm)' }}>
                                {isPractixMode
                                  ? <Lightning size={18} weight="fill" />
                                  : <LightningSlash size={18} weight="regular" />}
                              </button>

                              {/* Archive */}
                              <button
                                onClick={() => setArchConfirm(algo.id)}
                                title="Archive"
                                style={{
                                  display:'flex', alignItems:'center', justifyContent:'center',
                                  width:40, height:40, borderRadius:12,
                                  background:'var(--bg)', border:'none', boxShadow:'var(--neu-raised-sm)',
                                  cursor:'pointer', color:'#60A5FA', transition:'box-shadow 0.12s',
                                }}
                                onMouseDown={e => { e.currentTarget.style.boxShadow='var(--neu-inset)' }}
                                onMouseUp={e => { e.currentTarget.style.boxShadow='var(--neu-raised-sm)' }}
                                onMouseLeave={e => { e.currentTarget.style.boxShadow='var(--neu-raised-sm)' }}>
                                <Archive size={18} weight="regular" />
                              </button>

                              {/* Copy */}
                              <button
                                onClick={() => duplicateAlgo(algo.id)}
                                title="Duplicate algo"
                                style={{
                                  display:'flex', alignItems:'center', justifyContent:'center',
                                  width:40, height:40, borderRadius:12,
                                  background:'var(--bg)', border:'none', boxShadow:'var(--neu-raised-sm)',
                                  cursor:'pointer', color:'var(--accent)', transition:'box-shadow 0.12s',
                                }}
                                onMouseDown={e => { e.currentTarget.style.boxShadow='var(--neu-inset)' }}
                                onMouseUp={e => { e.currentTarget.style.boxShadow='var(--neu-raised-sm)' }}
                                onMouseLeave={e => { e.currentTarget.style.boxShadow='var(--neu-raised-sm)' }}>
                                <Copy size={18} weight="regular" />
                              </button>

                              {/* Remove */}
                              <button
                                onClick={() => setArchConfirm(algo.id)}
                                title="Remove (archive)"
                                style={{
                                  display:'flex', alignItems:'center', justifyContent:'center',
                                  width:40, height:40, borderRadius:12,
                                  background:'var(--bg)', border:'none', boxShadow:'var(--neu-raised-sm)',
                                  cursor:'pointer', color:'#FF4444', transition:'box-shadow 0.12s',
                                }}
                                onMouseDown={e => { e.currentTarget.style.boxShadow='var(--neu-inset)' }}
                                onMouseUp={e => { e.currentTarget.style.boxShadow='var(--neu-raised-sm)' }}
                                onMouseLeave={e => { e.currentTarget.style.boxShadow='var(--neu-raised-sm)' }}>
                                <Trash size={18} weight="regular" />
                              </button>
                            </div>

                          </div>{/* end main row */}


                        </div>
                      )
                    })}
                  </div>}
              </div>
            )
          })}
        </div>
      </div>


      {/* ── AI Algo Assistant ────────────────────────────────────────────── */}
      {showAI && (
        <AlgoAIAssistant
          mode={aiEditAlgo ? 'edit' : 'create'}
          existingAlgo={aiEditAlgo || undefined}
          accounts={aiAccounts}
          onComplete={(config, accountId, days) => {
            setShowAI(false)
            if (aiEditAlgo) {
              nav(`/algo/${aiEditAlgo.id}`, { state: { aiConfig: config, accountId, days } })
            } else {
              nav('/algo/new', { state: { aiConfig: config, accountId, days } })
            }
          }}
          onClose={() => setShowAI(false)}
        />
      )}

      {/* ── Archive confirm modal ─────────────────────────────────────────── */}
      {archConfirm && (() => {
        const a = algos.find(x => x.id===archConfirm)
        return (
          <div className="modal-overlay">
            <div className="modal-box" style={{ maxWidth:'360px' }}>
              <div style={{ fontWeight:700, fontSize:'16px', marginBottom:'8px' }}>Archive {a?.name}?</div>
              <div style={{ fontSize:'13px', color:'var(--text-muted)', lineHeight:1.6, marginBottom:'20px' }}>This will hide the algo from the grid. All historical trade data will be preserved.</div>
              <div style={{ display:'flex', gap:'8px', justifyContent:'flex-end' }}>
                <button
                  onClick={() => setArchConfirm(null)}
                  style={{ background:'var(--bg)', boxShadow:'var(--neu-raised-sm)', border:'none', borderRadius:100, padding:'7px 20px', fontSize:13, fontWeight:600, color:'var(--text-dim)', cursor:'pointer', fontFamily:'var(--font-display)' }}
                  onMouseDown={e => (e.currentTarget.style.boxShadow='var(--neu-inset)')}
                  onMouseUp={e => (e.currentTarget.style.boxShadow='var(--neu-raised-sm)')}
                  onMouseLeave={e => (e.currentTarget.style.boxShadow='var(--neu-raised-sm)')}
                >Cancel</button>
                <button
                  onClick={() => { archAlgo(archConfirm); setArchConfirm(null) }}
                  style={{ background:'var(--bg)', boxShadow:'var(--neu-raised-sm)', border:'none', borderRadius:100, padding:'7px 20px', fontSize:13, fontWeight:600, color:'#F59E0B', cursor:'pointer', fontFamily:'var(--font-display)' }}
                  onMouseDown={e => (e.currentTarget.style.boxShadow='var(--neu-inset)')}
                  onMouseUp={e => (e.currentTarget.style.boxShadow='var(--neu-raised-sm)')}
                  onMouseLeave={e => (e.currentTarget.style.boxShadow='var(--neu-raised-sm)')}
                >Archive</button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Cancel run confirm modal ─────────────────────────────────────── */}
      {confirmCancel && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth:'360px' }}>
            <div style={{ fontWeight:700, fontSize:'16px', marginBottom:'8px' }}>Cancel run?</div>
            <div style={{ fontSize:'13px', color:'var(--text-muted)', lineHeight:1.6, marginBottom:'20px' }}>
              This {confirmCancel.day} entry will be marked NO_TRADE.
            </div>
            <div style={{ display:'flex', gap:'8px', justifyContent:'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setConfirmCancel(null)}>Keep</button>
              <button className="btn btn-warn" style={{ color:'#FF4444' }} onClick={handleCancelConfirmed}>Cancel Run</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Defer removal modal ── */}
      {showDeferModal && deferAlgo && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:200, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div style={{ background:'#1A1208', border:'1px solid rgba(255,107,0,0.35)', borderRadius:12, padding:'28px 32px', maxWidth:420, width:'90%' }}>
            <div style={{ fontFamily:'var(--font-display)', fontSize:15, fontWeight:700, color:'rgba(232,232,248,0.9)', marginBottom:10 }}>
              Remove from recurring schedule?
            </div>
            <div style={{ fontSize:13, color:'rgba(200,200,220,0.75)', marginBottom:24, lineHeight:1.5 }}>
              <strong>{deferAlgo.name}</strong> is active today ({deferDay}). Removing now could disrupt today's session.
              <br/><br/>
              Remove from future <strong>{deferDay}</strong>s after tonight?
            </div>
            <div style={{ display:'flex', gap:10 }}>
              <button
                onClick={async () => {
                  setShowDeferModal(false)
                  try {
                    await algosAPI.scheduleRemoval(deferAlgo.id, deferDay)
                    showInfo(`${deferAlgo.name} will be removed from ${deferDay}s after midnight`)
                  } catch {
                    showError('Schedule removal failed')
                  }
                  setDeferAlgo(null); setDeferDay('')
                }}
                style={{ flex:1, padding:'10px 0', borderRadius:8, border:'none', background:'rgba(255,107,0,0.15)', color:'var(--ox-glow)', fontWeight:700, fontSize:13, cursor:'pointer' }}>
                Yes, future only
              </button>
              <button
                onClick={() => { setShowDeferModal(false); setDeferAlgo(null); setDeferDay('') }}
                style={{ flex:1, padding:'10px 0', borderRadius:8, border:'1px solid rgba(255,255,255,0.1)', background:'transparent', color:'rgba(200,200,220,0.6)', fontSize:13, cursor:'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}


    </div>
  )
}
