import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { algosAPI, accountsAPI } from '@/services/api'
import { useStore } from '@/store'

const INST_CODES: Record<string, string> = { NF: 'NIFTY', BN: 'BANKNIFTY', SX: 'SENSEX', MN: 'MIDCAPNIFTY', FN: 'FINNIFTY' }
const EXPIRY_OPTIONS = [
  { value: 'current_weekly', label: 'Current Weekly' },
  { value: 'next_weekly',    label: 'Next Weekly'    },
  { value: 'current_monthly',label: 'Current Monthly'},
  { value: 'next_monthly',   label: 'Next Monthly'   },
]
const STRIKE_OPTIONS = [...Array.from({ length: 10 }, (_, i) => `ITM${10 - i}`), 'ATM', ...Array.from({ length: 10 }, (_, i) => `OTM${i + 1}`)]

type FeatureKey = 'wt' | 'sl' | 're' | 'tp' | 'tsl' | 'ttp'
const FEATURES: { key: FeatureKey; label: string; color: string }[] = [
  { key: 'wt',  label: 'W&T', color: '#9CA3AF' },
  { key: 'sl',  label: 'SL',  color: '#EF4444' },
  { key: 're',  label: 'RE',  color: '#F59E0B' },
  { key: 'tp',  label: 'TP',  color: '#22C55E' },
  { key: 'tsl', label: 'TSL', color: '#00B0F0' },
  { key: 'ttp', label: 'TTP', color: '#A78BFA' },
]

interface LegVals {
  wt:  { direction: string; value: string; unit: string }
  sl:  { type: string; value: string }
  re:  { mode: string; trigger: string; count: string }
  tp:  { type: string; value: string }
  tsl: { x: string; y: string; unit: string }
  ttp: { x: string; y: string; unit: string }
}
interface JourneyChild {
  enabled: boolean
  instType: string; instCode: string; direction: string; optType: string
  strikeMode: string; strikeType: string; premiumVal: string; lots: string; expiry: string
  wt_enabled: boolean; wt_direction: string; wt_value: string; wt_unit: string
  sl_enabled: boolean; sl_type: string; sl_value: string
  re_enabled: boolean; re_mode: string; re_trigger: string; re_count: string
  tp_enabled: boolean; tp_type: string; tp_value: string
  tsl_enabled: boolean; tsl_x: string; tsl_y: string; tsl_unit: string
  ttp_enabled: boolean; ttp_x: string; ttp_y: string; ttp_unit: string
  child?: JourneyChild
}
const mkJourneyChild = (): JourneyChild => ({
  enabled: false,
  instType: 'OP', instCode: 'NF', direction: 'BUY', optType: 'CE',
  strikeMode: 'leg', strikeType: 'atm', premiumVal: '', lots: '1', expiry: 'current_weekly',
  wt_enabled: false, wt_direction: 'up', wt_value: '', wt_unit: 'pts',
  sl_enabled: false, sl_type: 'pts_instrument', sl_value: '',
  re_enabled: false, re_mode: 'at_entry_price', re_trigger: 'sl', re_count: '1',
  tp_enabled: false, tp_type: 'pts_instrument', tp_value: '',
  tsl_enabled: false, tsl_x: '', tsl_y: '', tsl_unit: 'pts',
  ttp_enabled: false, ttp_x: '', ttp_y: '', ttp_unit: 'pts',
  child: undefined,
})
interface Leg {
  id: string; no: number; instType: string; instCode: string; direction: string; optType: string
  strikeMode: string; strikeType: string; premiumVal: string; lots: string; expiry: string
  active: Record<FeatureKey, boolean>; vals: LegVals; journey?: JourneyChild
}

const mkLeg = (n: number): Leg => ({
  id: `leg-${Date.now()}-${n}`, no: n,
  instType: 'OP', instCode: 'NF', direction: 'BUY', optType: 'CE',
  strikeMode: 'leg', strikeType: 'atm', premiumVal: '', lots: '1', expiry: 'current_weekly',
  active: { wt: false, sl: false, re: false, tp: false, tsl: false, ttp: false }, journey: mkJourneyChild(),
  vals: { wt: { direction: 'up', value: '', unit: 'pts' }, sl: { type: 'pts_instrument', value: '' }, re: { mode: 'at_entry_price', trigger: 'sl', count: '1' }, tp: { type: 'pts_instrument', value: '' }, tsl: { x: '', y: '', unit: 'pts' }, ttp: { x: '', y: '', unit: 'pts' } },
})
const cpLeg = (l: Leg, n: number): Leg => ({ ...l, id: `leg-${Date.now()}-c${n}`, no: n, vals: { ...l.vals, wt: { ...l.vals.wt }, sl: { ...l.vals.sl }, re: { ...l.vals.re }, tp: { ...l.vals.tp }, tsl: { ...l.vals.tsl }, ttp: { ...l.vals.ttp } }, active: { ...l.active }, journey: l.journey ? { ...l.journey } : mkJourneyChild() })

function FeatVals({ leg, onUpdate }: { leg: Leg; onUpdate: (id: string, u: Partial<Leg>) => void }) {
  const active = FEATURES.filter(f => leg.active[f.key])
  if (!active.length) return null
  const u = (k: FeatureKey, sub: string, val: string) => onUpdate(leg.id, { vals: { ...leg.vals, [k]: { ...(leg.vals[k] as any), [sub]: val } } })
  const cs = { height: '26px', background: 'var(--bg-primary)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '3px', color: 'var(--text)', fontSize: '11px', padding: '0 6px', fontFamily: 'inherit' }
  const inp = (k: FeatureKey, sub: string, ph: string, w = '54px') => <input value={(leg.vals[k] as any)[sub] || ''} onChange={e => u(k, sub, e.target.value)} placeholder={ph} style={{ ...cs, width: w }} />
  const sel = (k: FeatureKey, sub: string, opts: [string, string][]) => <select value={(leg.vals[k] as any)[sub] || ''} onChange={e => u(k, sub, e.target.value)} style={{ ...cs, cursor: 'pointer' }}>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
  return (
    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px', paddingTop: '6px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      {active.map(f => (
        <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: '4px', background: `${f.color}08`, border: `1px solid ${f.color}22`, borderRadius: '5px', padding: '4px 8px' }}>
          <span style={{ fontSize: '10px', color: f.color, fontWeight: 700, marginRight: '2px' }}>{f.label}:</span>
          {f.key === 'wt'  && <>{sel('wt',  'direction', [['up','↑Up'],['down','↓Dn']])} {inp('wt',  'value', 'val')} {sel('wt',  'unit', [['pts','pts'],['pct','%']])}</>}
          {f.key === 'sl'  && <>{sel('sl',  'type', [['pts_instrument','Pts(I)'],['pct_instrument','%(I)'],['pts_underlying','Pts(U)'],['pct_underlying','%(U)']])} {inp('sl',  'value', 'val')}</>}
          {f.key === 're'  && <>{sel('re',  'mode', [['at_entry_price','@Entry'],['immediate','Now'],['at_cost','@Cost']])} {sel('re',  'trigger', [['sl','SL'],['tp','TP'],['any','Any']])} {sel('re', 'count', [['1','1×'],['2','2×'],['3','3×'],['4','4×'],['5','5×']])}</>}
          {f.key === 'tp'  && <>{sel('tp',  'type', [['pts_instrument','Pts(I)'],['pct_instrument','%(I)'],['pts_underlying','Pts(U)'],['pct_underlying','%(U)']])} {inp('tp',  'value', 'val')}</>}
          {f.key === 'tsl' && <>{inp('tsl', 'x', 'X')} <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>→</span> {inp('tsl', 'y', 'Y')} {sel('tsl', 'unit', [['pts','pts'],['pct','%']])}</>}
        {f.key === 'ttp' && <>{inp('ttp', 'x', 'X')} <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>→</span> {inp('ttp', 'y', 'Y')} {sel('ttp', 'unit', [['pts','pts'],['pct','%']])}</>}
        </div>
      ))}
    </div>
  )
}

const TYPE_OPTS: [string,string][] = [['pts_instrument','Pts(I)'],['pct_instrument','%(I)'],['pts_underlying','Pts(U)'],['pct_underlying','%(U)']]

function JourneyChildPanel({ child, depth, onChange }: {
  child: JourneyChild; depth: number; onChange: (c: JourneyChild) => void
}) {
  const cs = { height: '26px', background: 'var(--bg-primary)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '3px', color: 'var(--text)', fontSize: '11px', padding: '0 6px', fontFamily: 'inherit', cursor: 'pointer' }
  const u = (k: keyof JourneyChild, v: any) => onChange({ ...child, [k]: v })
  const depthColor = depth === 1 ? '#A78BFA' : depth === 2 ? '#F59E0B' : '#22C55E'
  const depthLabel = depth === 1 ? 'Child' : depth === 2 ? 'Grandchild' : 'Great-grandchild'
  const tslBlocked = !child.sl_enabled
  const ttpBlocked = !child.tp_enabled
  return (
    <div style={{ marginTop: '8px', padding: '9px 10px', background: `${depthColor}08`, border: `1px solid ${depthColor}22`, borderRadius: '6px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '7px' }}>
        <span style={{ fontSize: '10px', fontWeight: 700, color: depthColor, textTransform: 'uppercase', letterSpacing: '0.05em' }}>L{depth} {depthLabel}</span>
        <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: 'var(--text-muted)', cursor: 'pointer', marginLeft: 'auto' }}>
          <input type="checkbox" checked={child.enabled} onChange={e => u('enabled', e.target.checked)} style={{ accentColor: depthColor }} /> Enable
        </label>
      </div>
      {child.enabled && (<>
        {/* Row 1 — instrument config + feature chips inline */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', alignItems: 'center', marginBottom: '5px' }}>
          <button onClick={() => u('instType', child.instType === 'OP' ? 'FU' : 'OP')} style={{ height: '26px', padding: '0 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, background: child.instType === 'OP' ? 'rgba(0,176,240,0.15)' : 'rgba(215,123,18,0.15)', color: child.instType === 'OP' ? 'var(--accent-blue)' : 'var(--accent-amber)', border: '1px solid rgba(0,176,240,0.3)', cursor: 'pointer' }}>{child.instType}</button>
          <select value={child.instCode} onChange={e => u('instCode', e.target.value)} style={cs}>{Object.entries(INST_CODES).map(([c]) => <option key={c} value={c}>{c}</option>)}</select>
          <button onClick={() => u('direction', child.direction === 'BUY' ? 'SELL' : 'BUY')} style={{ height: '26px', padding: '0 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, background: child.direction === 'BUY' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', color: child.direction === 'BUY' ? 'var(--green)' : 'var(--red)', border: '1px solid rgba(34,197,94,0.3)', cursor: 'pointer' }}>{child.direction}</button>
          {child.instType === 'OP' && <button onClick={() => u('optType', child.optType === 'CE' ? 'PE' : 'CE')} style={{ height: '26px', padding: '0 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)', border: '1px solid var(--bg-border)', cursor: 'pointer' }}>{child.optType}</button>}
          {child.instType === 'OP' && <>
            <select value={child.expiry} onChange={e => u('expiry', e.target.value)} style={{ ...cs, width: '128px' }}>{EXPIRY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
            <select value={child.strikeMode} onChange={e => u('strikeMode', e.target.value)} style={cs}><option value="leg">Strike</option><option value="premium">Premium</option><option value="straddle">Straddle</option></select>
            {child.strikeMode === 'leg' && <select value={child.strikeType} onChange={e => u('strikeType', e.target.value)} style={{ ...cs, width: '70px' }}>{STRIKE_OPTIONS.map(st => <option key={st} value={st.toLowerCase()}>{st}</option>)}</select>}
            {(child.strikeMode === 'premium' || child.strikeMode === 'straddle') && <input value={child.premiumVal} onChange={e => u('premiumVal', e.target.value)} placeholder="₹ premium" style={{ ...cs, width: '82px' }} />}
          </>}
          <input value={child.lots} onChange={e => u('lots', e.target.value)} type="number" min={1} style={{ ...cs, width: '50px', textAlign: 'center' }} />
          <span style={{ color: 'rgba(255,255,255,0.15)', fontSize: '14px' }}>|</span>
          {[
            { key: 'wt_enabled', label: 'W&T', color: '#9CA3AF' },
            { key: 'sl_enabled', label: 'SL',  color: '#EF4444' },
            { key: 're_enabled', label: 'RE',  color: '#F59E0B' },
            { key: 'tp_enabled', label: 'TP',  color: '#22C55E' },
            { key: 'tsl_enabled',label: 'TSL', color: '#00B0F0', blocked: tslBlocked },
            { key: 'ttp_enabled',label: 'TTP', color: '#A78BFA', blocked: ttpBlocked },
          ].map(f => (
            <button key={f.key} onClick={() => {
              if (f.blocked) return
              const newVal = !(child[f.key as keyof JourneyChild])
              const patch: Partial<JourneyChild> = { [f.key]: newVal }
              if (f.key === 'sl_enabled' && !newVal) patch.tsl_enabled = false
              if (f.key === 'tp_enabled' && !newVal) patch.ttp_enabled = false
              onChange({ ...child, ...patch })
            }} style={{ height: '24px', padding: '0 9px', borderRadius: '11px', fontSize: '10px', fontWeight: 600, cursor: f.blocked ? 'not-allowed' : 'pointer', border: 'none', transition: 'all 0.12s', background: child[f.key as keyof JourneyChild] ? f.color : 'var(--bg-surface)', color: child[f.key as keyof JourneyChild] ? '#000' : f.blocked ? 'rgba(255,255,255,0.18)' : 'var(--text-dim)', opacity: f.blocked ? 0.4 : 1 }}>
              {f.label}
            </button>
          ))}
        </div>
        {/* Row 3 — active feature values */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
          {child.wt_enabled && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '3px', background: 'rgba(156,163,175,0.08)', border: '1px solid rgba(156,163,175,0.2)', borderRadius: '5px', padding: '3px 7px' }}>
              <span style={{ fontSize: '10px', color: '#9CA3AF', fontWeight: 700, marginRight: '2px' }}>W&T:</span>
              <select value={child.wt_direction} onChange={e => u('wt_direction', e.target.value)} style={{ ...cs, height: '22px' }}><option value="up">↑Up</option><option value="down">↓Dn</option></select>
              <input value={child.wt_value} onChange={e => u('wt_value', e.target.value)} placeholder="val" style={{ ...cs, width: '46px', height: '22px' }} />
              <select value={child.wt_unit} onChange={e => u('wt_unit', e.target.value)} style={{ ...cs, height: '22px' }}><option value="pts">pts</option><option value="pct">%</option></select>
            </div>
          )}
          {child.sl_enabled && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '3px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '5px', padding: '3px 7px' }}>
              <span style={{ fontSize: '10px', color: '#EF4444', fontWeight: 700, marginRight: '2px' }}>SL:</span>
              <select value={child.sl_type} onChange={e => u('sl_type', e.target.value)} style={{ ...cs, height: '22px' }}>{TYPE_OPTS.map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select>
              <input value={child.sl_value} onChange={e => u('sl_value', e.target.value)} placeholder="val" style={{ ...cs, width: '46px', height: '22px' }} />
            </div>
          )}
          {child.re_enabled && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '3px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '5px', padding: '3px 7px' }}>
              <span style={{ fontSize: '10px', color: '#F59E0B', fontWeight: 700, marginRight: '2px' }}>RE:</span>
              <select value={child.re_mode} onChange={e => u('re_mode', e.target.value)} style={{ ...cs, height: '22px' }}><option value="at_entry_price">@Entry</option><option value="immediate">Now</option><option value="at_cost">@Cost</option></select>
              <select value={child.re_trigger} onChange={e => u('re_trigger', e.target.value)} style={{ ...cs, height: '22px' }}><option value="sl">SL</option><option value="tp">TP</option><option value="any">Any</option></select>
              <select value={child.re_count} onChange={e => u('re_count', e.target.value)} style={{ ...cs, height: '22px' }}>{['1','2','3','4','5'].map(n => <option key={n} value={n}>{n}×</option>)}</select>
            </div>
          )}
          {child.tp_enabled && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '3px', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: '5px', padding: '3px 7px' }}>
              <span style={{ fontSize: '10px', color: '#22C55E', fontWeight: 700, marginRight: '2px' }}>TP:</span>
              <select value={child.tp_type} onChange={e => u('tp_type', e.target.value)} style={{ ...cs, height: '22px' }}>{TYPE_OPTS.map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select>
              <input value={child.tp_value} onChange={e => u('tp_value', e.target.value)} placeholder="val" style={{ ...cs, width: '46px', height: '22px' }} />
            </div>
          )}
          {child.tsl_enabled && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '3px', background: 'rgba(0,176,240,0.08)', border: '1px solid rgba(0,176,240,0.2)', borderRadius: '5px', padding: '3px 7px' }}>
              <span style={{ fontSize: '10px', color: '#00B0F0', fontWeight: 700, marginRight: '2px' }}>TSL:</span>
              <input value={child.tsl_x} onChange={e => u('tsl_x', e.target.value)} placeholder="X" style={{ ...cs, width: '40px', height: '22px' }} />
              <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>→</span>
              <input value={child.tsl_y} onChange={e => u('tsl_y', e.target.value)} placeholder="Y" style={{ ...cs, width: '40px', height: '22px' }} />
              <select value={child.tsl_unit} onChange={e => u('tsl_unit', e.target.value)} style={{ ...cs, height: '22px' }}><option value="pts">pts</option><option value="pct">%</option></select>
            </div>
          )}
          {child.ttp_enabled && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '3px', background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.2)', borderRadius: '5px', padding: '3px 7px' }}>
              <span style={{ fontSize: '10px', color: '#A78BFA', fontWeight: 700, marginRight: '2px' }}>TTP:</span>
              <input value={child.ttp_x} onChange={e => u('ttp_x', e.target.value)} placeholder="X" style={{ ...cs, width: '40px', height: '22px' }} />
              <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>→</span>
              <input value={child.ttp_y} onChange={e => u('ttp_y', e.target.value)} placeholder="Y" style={{ ...cs, width: '40px', height: '22px' }} />
              <select value={child.ttp_unit} onChange={e => u('ttp_unit', e.target.value)} style={{ ...cs, height: '22px' }}><option value="pts">pts</option><option value="pct">%</option></select>
            </div>
          )}
        </div>
        {depth < 3 && (
          <JourneyChildPanel child={child.child || mkJourneyChild()} depth={depth + 1} onChange={c => u('child', c)} />
        )}
      </>)}
    </div>
  )
}

function JourneyPanel({ leg, onUpdate }: { leg: Leg; onUpdate: (id: string, u: Partial<Leg>) => void }) {
  const [open, setOpen] = useState(false)
  const j = leg.journey || mkJourneyChild()
  const hasJourney = j.enabled
  return (
    <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px solid rgba(167,139,250,0.15)' }}>
      <button onClick={() => setOpen((o: boolean) => !o)} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', padding: '2px 0' }}>
        <span style={{ fontSize: '10px', fontWeight: 700, color: hasJourney ? '#A78BFA' : 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {open ? '▾' : '▸'} Journey {hasJourney ? '● Active' : ''}
        </span>
      </button>
      {open && (
        <JourneyChildPanel child={j} depth={1} onChange={c => onUpdate(leg.id, { journey: c })} />
      )}
    </div>
  )
}

function LegRow({ leg, isDragging, onUpdate, onRemove, onCopy, dragHandleProps, onBlockedClick }: {
  leg: Leg; isDragging: boolean
  onUpdate: (id: string, u: Partial<Leg>) => void
  onRemove: (id: string) => void
  onCopy:   (id: string) => void
  dragHandleProps: any
  onBlockedClick: (msg: string) => void
}) {
  const u = (k: keyof Leg, v: any) => onUpdate(leg.id, { [k]: v })
  const s = { height: '28px', background: 'var(--bg-primary)', border: '1px solid var(--bg-border)', borderRadius: '4px', color: 'var(--text)', fontSize: '11px', padding: '0 8px', fontFamily: 'inherit', cursor: 'pointer' }
  return (
    <div style={{ background: 'var(--bg-secondary)', border: `1px solid ${isDragging ? 'var(--accent-blue)' : 'var(--bg-border)'}`, borderRadius: '7px', padding: '9px 10px', marginBottom: '6px', opacity: isDragging ? 0.7 : 1, transition: 'border-color 0.1s' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
        <span {...dragHandleProps} title="Drag to reorder" style={{ cursor: 'grab', color: 'var(--text-dim)', fontSize: '13px', flexShrink: 0, padding: '0 2px', userSelect: 'none' }}>⠿</span>
        <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-dim)', minWidth: '20px', textAlign: 'center' }}>L{leg.no}</span>
        <button onClick={() => u('instType', leg.instType === 'OP' ? 'FU' : 'OP')} style={{ height: '28px', padding: '0 9px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, background: leg.instType === 'OP' ? 'rgba(0,176,240,0.15)' : 'rgba(215,123,18,0.15)', color: leg.instType === 'OP' ? 'var(--accent-blue)' : 'var(--accent-amber)', border: `1px solid ${leg.instType === 'OP' ? 'rgba(0,176,240,0.3)' : 'rgba(215,123,18,0.3)'}`, cursor: 'pointer', flexShrink: 0 }}>{leg.instType}</button>
        <select value={leg.instCode} onChange={e => u('instCode', e.target.value)} style={s}>{Object.entries(INST_CODES).map(([c, n]) => <option key={c} value={c} title={n}>{c}</option>)}</select>
        <button onClick={() => u('direction', leg.direction === 'BUY' ? 'SELL' : 'BUY')} style={{ height: '28px', padding: '0 9px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, background: leg.direction === 'BUY' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', color: leg.direction === 'BUY' ? 'var(--green)' : 'var(--red)', border: `1px solid ${leg.direction === 'BUY' ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`, cursor: 'pointer', flexShrink: 0 }}>{leg.direction}</button>
        {leg.instType === 'OP' && <button onClick={() => u('optType', leg.optType === 'CE' ? 'PE' : 'CE')} style={{ height: '28px', padding: '0 9px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)', border: '1px solid var(--bg-border)', cursor: 'pointer', flexShrink: 0 }}>{leg.optType}</button>}
        {leg.instType === 'OP' && <>
          <select value={leg.expiry} onChange={e => u('expiry', e.target.value)} style={{ ...s, width: '128px' }}>{EXPIRY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
          <select value={leg.strikeMode} onChange={e => u('strikeMode', e.target.value)} style={s}><option value="leg">Strike</option><option value="premium">Premium</option><option value="straddle">Straddle</option></select>
          {leg.strikeMode === 'leg' && <select value={leg.strikeType} onChange={e => u('strikeType', e.target.value)} style={{ ...s, width: '70px' }}>{STRIKE_OPTIONS.map(st => <option key={st} value={st.toLowerCase()}>{st}</option>)}</select>}
          {(leg.strikeMode === 'premium' || leg.strikeMode === 'straddle') && <input value={leg.premiumVal} onChange={e => u('premiumVal', e.target.value)} placeholder="₹ premium" style={{ ...s, width: '82px' }} />}
        </>}
        <input value={leg.lots} onChange={e => u('lots', e.target.value)} type="number" min={1} style={{ ...s, width: '56px', textAlign: 'center' }} />
        <span style={{ color: 'var(--bg-border)', fontSize: '14px', flexShrink: 0 }}>|</span>
        {FEATURES.map(f => {
          const blocked = (f.key === 'tsl' && !leg.active['sl']) || (f.key === 'ttp' && !leg.active['tp'])
          return (
            <button key={f.key} onClick={() => {
              if (blocked) { onBlockedClick(f.key === 'tsl' ? 'Enable SL before TSL' : 'Enable TP before TTP'); return }
              const newActive = { ...leg.active, [f.key]: !leg.active[f.key] }
              if (f.key === 'sl' && leg.active['sl']) newActive['tsl'] = false
              if (f.key === 'tp' && leg.active['tp']) newActive['ttp'] = false
              onUpdate(leg.id, { active: newActive })
            }} style={{ height: '28px', padding: '0 11px', borderRadius: '13px', fontSize: '11px', fontWeight: 600, cursor: blocked ? 'not-allowed' : 'pointer', border: 'none', transition: 'all 0.12s', flexShrink: 0, background: leg.active[f.key] ? f.color : 'var(--bg-surface)', color: leg.active[f.key] ? '#000' : blocked ? 'rgba(255,255,255,0.18)' : 'var(--text-dim)', opacity: blocked ? 0.4 : 1 }}>
              {f.label}
            </button>
          )
        })}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px', flexShrink: 0 }}>
          <button onClick={() => onCopy(leg.id)} title="Copy leg" style={{ height: '28px', padding: '0 9px', background: 'none', border: '1px solid rgba(0,176,240,0.25)', color: 'var(--accent-blue)', borderRadius: '4px', fontSize: '11px', cursor: 'pointer' }}>⧉</button>
          <button onClick={() => onRemove(leg.id)} title="Remove leg" style={{ height: '28px', padding: '0 9px', background: 'none', border: '1px solid rgba(239,68,68,0.25)', color: 'var(--red)', borderRadius: '4px', fontSize: '11px', cursor: 'pointer' }}>✕</button>
        </div>
      </div>
      <FeatVals leg={leg} onUpdate={onUpdate} />
      <JourneyPanel leg={leg} onUpdate={onUpdate} />
    </div>
  )
}

function SubSection({ title }: { title: string }) {
  return <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px', marginTop: '2px', paddingBottom: '5px', borderBottom: '1px solid var(--bg-border)' }}>{title}</div>
}

const timeInput = { background: 'var(--bg-secondary)', border: '1px solid var(--bg-border)', color: 'var(--text)', borderRadius: '5px', padding: '0 10px', height: '32px', fontSize: '12px', fontFamily: 'inherit', width: '106px', colorScheme: 'dark' }
const TIME_MIN = '09:15'
const TIME_MAX = '15:30'
const TIME_OPTIONS: string[] = (() => {
  const opts: string[] = []
  for (let h = 9; h <= 15; h++) {
    for (let m = 0; m < 60; m += 5) {
      if (h === 9 && m < 15) continue
      if (h === 15 && m > 30) break
      opts.push(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`)
    }
  }
  return opts
})()

export default function AlgoPage() {
  const navigate    = useNavigate()
  const { id }      = useParams<{ id: string }>()
  const isEdit      = !!id
  const storeAlgos  = useStore(s => s.algos)

  // Account list from store (populated by accountsAPI)
  const [accountOptions, setAccountOptions] = useState<{ id: string; label: string }[]>([
    { id: 'karthik', label: 'Karthik (Zerodha)' },
    { id: 'mom',     label: 'Mom (Angel One)'   },
  ])

  const [legs, setLegs]             = useState<Leg[]>([mkLeg(1)])
  const [algoName, setAlgoName]     = useState('')
  const [stratMode, setStratMode]   = useState('intraday')
  const [entryType, setEntryType]   = useState('direct')
  const [lotMult, setLotMult]       = useState('1')
  const [entryTime, setEntryTime]   = useState('09:15')
  const [orbEnd, setOrbEnd]         = useState('11:15')
  const [exitTime, setExitTime]     = useState('15:10')
  const [dte, setDte]               = useState('0')
  const [account, setAccount]       = useState('')
  const [mtmUnit, setMtmUnit]       = useState('amt')
  const [mtmSL, setMtmSL]          = useState('')
  const [mtmTP, setMtmTP]          = useState('')
  // F2 — BUY/SELL scope for delays
  const [entryDelay, setEntryDelay]         = useState('0')
  const [entryDelayScope, setEntryDelayScope] = useState('all')
  const [exitDelay, setExitDelay]           = useState('0')
  const [exitDelayScope, setExitDelayScope]   = useState('all')
  const [orderType, setOrderType]   = useState('MARKET')
  const [errorMargin, setErrorMargin] = useState(true)
  const [errorEntry, setErrorEntry] = useState(true)

  const [saving, setSaving]         = useState(false)
  const [toast, setToast]           = useState('')
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500) }
  const [saveError, setSaveError]   = useState('')
  const [saved, setSaved]           = useState(false)
  const [showTomorrowWarn, setShowTomorrowWarn] = useState(false)  // F6
  const [isLocked, setIsLocked]     = useState(false)              // F5 — edit lock

  const [dragIdx, setDragIdx]       = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)

  // Load account options from API
  useEffect(() => {
    accountsAPI.list()
      .then(res => {
        const opts = res.data.map((a: any) => ({
          id: a.id,
          label: `${a.nickname} (${a.broker === 'zerodha' ? 'Zerodha' : 'Angel One'})`,
        }))
        setAccountOptions(opts)
        if (!account && opts.length > 0) setAccount(opts[0].id)
      })
      .catch(() => {})
  }, [])

  // If editing, load existing algo + check if live today (F5)
  useEffect(() => {
    if (!isEdit || !id) return
    algosAPI.get(id)
      .then(res => {
        const a = res.data
        setAlgoName(a.name || '')
        setStratMode(a.strategy_mode || 'intraday')
        setEntryType(a.entry_type || 'direct')
        setLotMult(String(a.base_lot_multiplier || 1))
        setEntryTime(a.entry_time || '09:16')
        setOrbEnd(a.orb_end_time || '11:16')
        setExitTime(a.exit_time || '15:10')
        setDte(String(a.dte || 0))
        setAccount(a.account_id || '')
        setMtmUnit(a.mtm_unit || 'amt')
        setMtmSL(a.mtm_sl != null ? String(a.mtm_sl) : '')
        setMtmTP(a.mtm_tp != null ? String(a.mtm_tp) : '')
        setOrderType(a.order_type?.toUpperCase() || 'MARKET')
        // TODO: map legs from API format to local Leg format
      })
      .catch(() => {})

    // F5 — check if algo is live today
    algosAPI.get(id + '/status')
      .then(res => {
        const status = res.data?.status
        if (status === 'waiting' || status === 'active') setIsLocked(true)
      })
      .catch(() => {})
  }, [id, isEdit])

  const addLeg    = () => setLegs(l => [...l, mkLeg(l.length + 1)])
  const removeLeg = (id: string) => setLegs(l => l.filter(x => x.id !== id).map((x, i) => ({ ...x, no: i + 1 })))
  const updateLeg = (id: string, u: Partial<Leg>) => setLegs(l => l.map(x => x.id === id ? { ...x, ...u } : x))
  const copyLeg   = (id: string) => setLegs(l => { const i = l.findIndex(x => x.id === id), cp = cpLeg(l[i], l.length + 1), a = [...l]; a.splice(i + 1, 0, cp); return a.map((x, j) => ({ ...x, no: j + 1 })) })

  const handleDragEnd = () => {
    if (dragIdx !== null && dragOverIdx !== null && dragIdx !== dragOverIdx) {
      setLegs(l => { const a = [...l]; const [item] = a.splice(dragIdx, 1); a.splice(dragOverIdx, 0, item); return a.map((x, i) => ({ ...x, no: i + 1 })) })
    }
    setDragIdx(null); setDragOverIdx(null)
  }

  const validate = (): string => {
    if (!algoName.trim())            return 'Algo name is required'
    if (!account)                    return 'Account is required'
    if (!entryTime)                  return 'Entry time is required'
    if (!exitTime)                   return 'Exit time is required'
    if (entryType === 'orb' && !orbEnd) return 'ORB End time is required when entry type is ORB'
    if (entryTime < TIME_MIN || entryTime > TIME_MAX) return `Entry time must be between ${TIME_MIN} and ${TIME_MAX}`
    if (exitTime  < TIME_MIN || exitTime  > TIME_MAX) return `Exit time must be between ${TIME_MIN} and ${TIME_MAX}`
    if (stratMode === 'intraday' && exitTime <= entryTime) return 'Exit time must be after entry time for Intraday'
    if (entryType === 'orb' && orbEnd <= entryTime) return 'ORB end time must be after ORB start (entry) time'
    if (stratMode === 'positional' && !dte) return 'DTE is required for Positional strategy'
    for (const leg of legs) {
      for (const feat of FEATURES) {
        if (leg.active[feat.key]) {
          const vals = leg.vals[feat.key] as any
          const hasValue = Object.values(vals).some((v: any) => v !== '' && v !== undefined)
          if (!hasValue) return `${feat.label} is enabled on Leg ${leg.no} but values are missing`
        }
      }
    }
    return ''
  }

  const buildPayload = () => ({
    name:                algoName.trim(),
    account_id:          account,
    strategy_mode:       stratMode,
    entry_type:          entryType,
    order_type:          orderType.toLowerCase(),
    base_lot_multiplier: parseInt(lotMult) || 1,
    entry_time:          entryTime,
    exit_time:           exitTime,
    orb_end_time:        entryType === 'orb' ? orbEnd : undefined,
    dte:                 stratMode === 'positional' ? parseInt(dte) : undefined,
    mtm_sl:              mtmSL ? parseFloat(mtmSL) : undefined,
    mtm_tp:              mtmTP ? parseFloat(mtmTP) : undefined,
    mtm_unit:            mtmUnit,
    entry_delay_seconds: parseInt(entryDelay) || 0,
    entry_delay_scope:   entryDelayScope,
    exit_delay_seconds:  parseInt(exitDelay) || 0,
    exit_delay_scope:    exitDelayScope,
    on_margin_error:     errorMargin ? 'exit_all' : 'none',
    on_entry_fail:       errorEntry  ? 'exit_all' : 'none',
    legs: legs.map(l => ({
      leg_number:      l.no,
      direction:       l.direction.toLowerCase(),
      instrument_type: l.instType.toLowerCase(),
      underlying:      l.instCode,
      expiry:          l.expiry,
      strike_type:     l.strikeType,
      lots:            parseInt(l.lots) || 1,
      opt_type:        l.optType.toLowerCase(),
      // Features
      wt_enabled:  l.active.wt,
      wt_direction: l.vals.wt.direction, wt_value: parseFloat(l.vals.wt.value) || undefined, wt_unit: l.vals.wt.unit,
      sl_type:  l.active.sl ? l.vals.sl.type : undefined,  sl_value: l.active.sl ? parseFloat(l.vals.sl.value) : undefined,
      tp_type:  l.active.tp ? l.vals.tp.type : undefined,  tp_value: l.active.tp ? parseFloat(l.vals.tp.value) : undefined,
      tsl_enabled: l.active.tsl, tsl_x: parseFloat(l.vals.tsl.x) || undefined, tsl_y: parseFloat(l.vals.tsl.y) || undefined, tsl_unit: l.vals.tsl.unit,
      ttp_enabled: l.active.ttp, ttp_x: parseFloat(l.vals.ttp.x) || undefined, ttp_y: parseFloat(l.vals.ttp.y) || undefined, ttp_unit: l.vals.ttp.unit,
      reentry_enabled: l.active.re, reentry_mode: l.vals.re.mode, reentry_max: parseInt(l.vals.re.count) || 0,
      journey_config: buildJourneyConfig(l.journey),
    })),
  })

  const buildJourneyConfig = (j?: JourneyChild, depth = 1): any => {
    if (!j || !j.enabled || depth > 3) return undefined
    return {
      level: depth, trigger: 'any',
      child: {
        instrument: j.instType === 'FU' ? 'fu' : j.optType.toLowerCase(),
        underlying: INST_CODES[j.instCode] || j.instCode,
        direction: j.direction.toLowerCase(),
        strike_type: j.strikeType, expiry: j.expiry,
        lots: parseInt(j.lots) || 1,
        wt_enabled: j.wt_enabled, wt_direction: j.wt_direction, wt_value: parseFloat(j.wt_value) || undefined, wt_unit: j.wt_unit,
        sl_type: j.sl_enabled ? j.sl_type : undefined, sl_value: j.sl_enabled ? parseFloat(j.sl_value) || undefined : undefined,
        tp_type: j.tp_enabled ? j.tp_type : undefined, tp_value: j.tp_enabled ? parseFloat(j.tp_value) || undefined : undefined,
        tsl_enabled: j.tsl_enabled, tsl_x: parseFloat(j.tsl_x) || undefined, tsl_y: parseFloat(j.tsl_y) || undefined, tsl_unit: j.tsl_unit,
        ttp_enabled: j.ttp_enabled, ttp_x: parseFloat(j.ttp_x) || undefined, ttp_y: parseFloat(j.ttp_y) || undefined, ttp_unit: j.ttp_unit,
        reentry_enabled: j.re_enabled, reentry_mode: j.re_mode, reentry_max: parseInt(j.re_count) || 0,
        journey_config: buildJourneyConfig(j.child, depth + 1),
      }
    }
  }

  const handleSave = async () => {
    const err = validate()
    if (err) { setSaveError(err); return }

    // F6 — warn if editing an algo that has grid entries for today
    if (isEdit && !showTomorrowWarn) {
      setShowTomorrowWarn(true)
      return
    }

    setSaving(true)
    setSaveError('')
    setShowTomorrowWarn(false)
    try {
      if (isEdit && id) {
        await algosAPI.update(id, buildPayload())
      } else {
        await algosAPI.create(buildPayload())
      }
      setSaved(true)
      setTimeout(() => { setSaved(false); navigate('/grid') }, 1200)
    } catch (e: any) {
      const msg = e?.response?.data?.detail || 'Save failed. Please try again.'
      setSaveError(msg)
    } finally {
      setSaving(false)
    }
  }

  // F5 — locked state banner
  if (isLocked) {
    return (
      <div>
        <div className="page-header">
          <h1 style={{ fontFamily: "'ADLaM Display',serif", fontSize: '22px', fontWeight: 400 }}>{algoName || 'Edit Algo'}</h1>
          <div className="page-header-actions">
            <button className="btn btn-ghost" onClick={() => navigate('/grid')}>← Back to Grid</button>
          </div>
        </div>
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '20px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: '24px', marginBottom: '8px' }}>🔒</div>
          <div style={{ fontWeight: 700, fontSize: '16px', color: 'var(--red)', marginBottom: '6px' }}>Algo is live — editing locked</div>
          <div style={{ fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
            <strong>{algoName}</strong> has an active trade today.<br />
            Editing is only allowed during off-market hours.<br />
            Any changes made will apply from the next trading day.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <h1 style={{ fontFamily: "'ADLaM Display',serif", fontSize: '22px', fontWeight: 400 }}>{algoName || (isEdit ? 'Edit Algo' : 'New Algo')}</h1>
        <div className="page-header-actions">
          {saved      && <span style={{ fontSize: '12px', color: 'var(--green)', fontWeight: 600 }}>✅ Saved!</span>}
          {saveError  && <span style={{ fontSize: '12px', color: 'var(--red)' }}>{saveError}</span>}
          <button className="btn btn-ghost" onClick={() => navigate('/grid')}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : (isEdit ? 'Update Algo' : 'Save Algo')}</button>
        </div>
      </div>

      {toast && (
        <div style={{ position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)', background: 'rgba(30,30,30,0.95)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: '8px', padding: '10px 18px', fontSize: '12px', color: 'var(--red)', fontWeight: 600, zIndex: 9999, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
          ⚠ {toast}
        </div>
      )}
      {/* F6 — tomorrow warning */}
      {showTomorrowWarn && (
        <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: '8px', padding: '14px 16px', marginBottom: '12px' }}>
          <div style={{ fontWeight: 700, color: 'var(--accent-amber)', marginBottom: '6px' }}>⚠️ Changes apply from tomorrow</div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '10px' }}>
            This algo may be deployed in today's grid. Changes you save will NOT affect today's trades — they will apply from the next trading day onward.
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-ghost" onClick={() => setShowTomorrowWarn(false)}>Cancel</button>
            <button className="btn" style={{ background: 'var(--accent-amber)', color: '#000', fontWeight: 700 }} onClick={handleSave}>Save Anyway</button>
          </div>
        </div>
      )}

      {/* Identity card */}
      <div className="card" style={{ marginBottom: '12px' }}>
        <SubSection title="Identity — Algo Level" />
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '10px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '1 1 150px', maxWidth: '180px' }}>
            <label style={{ fontSize: '10px', color: 'var(--text-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Algo Name</label>
            <input className="staax-input" placeholder="e.g. AWS-1" value={algoName} onChange={e => setAlgoName(e.target.value)} style={{ fontSize: '12px' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '66px' }}>
            <label style={{ fontSize: '10px', color: 'var(--text-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Lot Mult.</label>
            <input className="staax-input" type="number" min={1} value={lotMult} onChange={e => setLotMult(e.target.value)} style={{ width: '66px', fontSize: '12px' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '10px', color: 'var(--text-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Strategy</label>
            <select className="staax-select" value={stratMode} onChange={e => setStratMode(e.target.value)} style={{ width: '118px', fontSize: '12px' }}>
              <option value="intraday">Intraday</option><option value="btst">BTST</option><option value="stbt">STBT</option><option value="positional">Positional</option>
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '10px', color: 'var(--text-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Order Type</label>
            <select className="staax-select" value={orderType} onChange={e => setOrderType(e.target.value)} style={{ width: '100px', fontSize: '12px' }}>
              <option value="MARKET">MARKET</option><option value="LIMIT">LIMIT</option>
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginLeft: 'auto' }}>
            <label style={{ fontSize: '10px', color: 'var(--text-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Account</label>
            <select className="staax-select" value={account} onChange={e => setAccount(e.target.value)} style={{ width: '160px', fontSize: '12px' }}>
              {accountOptions.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </div>
        </div>

        {/* Entry Type & Timing */}
        <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--bg-border)' }}>
          <SubSection title="Entry Type & Timing — Algo Level" />
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '10px', color: 'var(--text-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Entry Type</label>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button onClick={() => setEntryType('direct')} className={`chip ${entryType === 'direct' ? 'chip-active' : 'chip-inactive'}`}>Direct</button>
                <button onClick={() => setEntryType('orb')}    className={`chip ${entryType === 'orb'    ? 'chip-active' : 'chip-inactive'}`}>ORB</button>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '10px', color: 'var(--text-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Entry Time</label>
              <select value={entryTime} onChange={e => setEntryTime(e.target.value)} style={timeInput as any}>{TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}</select>
            </div>
            {entryType === 'orb' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '10px', color: 'var(--text-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>ORB End</label>
                <select value={orbEnd} onChange={e => setOrbEnd(e.target.value)} style={timeInput as any}>{TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}</select>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '10px', color: 'var(--text-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Exit Time</label>
              <select value={exitTime} onChange={e => setExitTime(e.target.value)} style={timeInput as any}>{TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}</select>
            </div>
            {stratMode === 'positional' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '10px', color: 'var(--text-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>DTE</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <select className="staax-select" value={dte} onChange={e => setDte(e.target.value)} style={{ width: '72px', fontSize: '12px' }}>
                    {Array.from({ length: 31 }, (_, n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <span style={{ fontSize: '10px', color: 'var(--text-dim)', maxWidth: '120px', lineHeight: 1.3 }}>
                    {dte === '0' ? 'Exit on expiry day' : `${dte} day${Number(dte) !== 1 ? 's' : ''} before expiry`}
                  </span>
                </div>
              </div>
            )}
            {(stratMode === 'btst' || stratMode === 'stbt') && (
              <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: '2px' }}>
                <span style={{ fontSize: '10px', color: 'var(--accent-amber)', background: 'rgba(215,123,18,0.1)', padding: '5px 8px', borderRadius: '4px', border: '1px solid rgba(215,123,18,0.2)', lineHeight: 1.4 }}>
                  ⚠ Next day SL check auto-handled
                </span>
              </div>
            )}
          </div>
        </div>

        {/* MTM */}
        <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--bg-border)' }}>
          <SubSection title="MTM Controls — Algo Level" />
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <select className="staax-select" value={mtmUnit} onChange={e => setMtmUnit(e.target.value)} style={{ width: '96px', fontSize: '12px' }}>
              <option value="amt">₹ Amount</option><option value="pct">% Premium</option>
            </select>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>MTM SL:</span>
              <input value={mtmSL} onChange={e => setMtmSL(e.target.value)} placeholder="None" className="staax-input" style={{ width: '80px', fontSize: '12px' }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>MTM TP:</span>
              <input value={mtmTP} onChange={e => setMtmTP(e.target.value)} placeholder="None" className="staax-input" style={{ width: '80px', fontSize: '12px' }} />
            </div>
          </div>
        </div>
      </div>

      {/* Legs */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Legs</span>
          <span style={{ fontSize: '9px', padding: '2px 7px', borderRadius: '3px', background: 'rgba(34,197,94,0.1)', color: 'var(--green)', fontWeight: 700 }}>SL · TP · TSL · TTP · W&T · RE · Journey per leg</span>
          <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>{legs.length} leg{legs.length > 1 ? 's' : ''}</span>
        </div>
        <button className="btn btn-ghost" style={{ fontSize: '11px' }} onClick={addLeg}>+ Add Leg</button>
      </div>
      {legs.map((leg, i) => (
        <div key={leg.id}
          draggable onDragStart={() => setDragIdx(i)} onDragOver={e => { e.preventDefault(); setDragOverIdx(i) }} onDragEnd={handleDragEnd}
          style={{ outline: dragOverIdx === i && dragIdx !== i ? '2px dashed var(--accent-blue)' : 'none', borderRadius: '7px' }}>
          <LegRow leg={leg} isDragging={dragIdx === i} onUpdate={updateLeg} onRemove={removeLeg} onCopy={copyLeg} dragHandleProps={{}} onBlockedClick={showToast} />
        </div>
      ))}

      {/* Delays + Errors */}
      <div className="card" style={{ marginTop: '12px' }}>
        <SubSection title="Order Delays — Algo Level" />
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          {/* F2 — Entry delay with BUY/SELL scope */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>Entry Delay:</span>
            {/* Scope dropdown — BUY/SELL/All */}
            <select value={entryDelayScope} onChange={e => setEntryDelayScope(e.target.value)}
              className="staax-select" style={{ width: '90px', fontSize: '11px' }}>
              <option value="all">All legs</option>
              <option value="buy">BUY legs</option>
              <option value="sell">SELL legs</option>
            </select>
            <input value={entryDelay} onChange={e => setEntryDelay(e.target.value)} type="number" min={0} max={60} className="staax-input" style={{ width: '60px', fontSize: '12px' }} />
            <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>s (max 60)</span>
          </div>
          {/* F2 — Exit delay with BUY/SELL scope */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>Exit Delay:</span>
            <select value={exitDelayScope} onChange={e => setExitDelayScope(e.target.value)}
              className="staax-select" style={{ width: '90px', fontSize: '11px' }}>
              <option value="all">All legs</option>
              <option value="buy">BUY legs</option>
              <option value="sell">SELL legs</option>
            </select>
            <input value={exitDelay} onChange={e => setExitDelay(e.target.value)} type="number" min={0} max={60} className="staax-input" style={{ width: '60px', fontSize: '12px' }} />
            <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>s (max 60)</span>
          </div>
        </div>

        <div style={{ margin: '12px 0 10px', borderTop: '1px solid var(--bg-border)' }} />
        <SubSection title="Error Settings — Algo Level" />
        <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer', fontSize: '11px', color: 'var(--red)' }}>
            <input type="checkbox" checked={errorMargin} onChange={e => setErrorMargin(e.target.checked)} style={{ accentColor: 'var(--red)' }} />
            On margin error, exit all open positions
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer', fontSize: '11px', color: 'var(--red)' }}>
            <input type="checkbox" checked={errorEntry} onChange={e => setErrorEntry(e.target.checked)} style={{ accentColor: 'var(--red)' }} />
            If any entry fails, exit all open positions
          </label>
        </div>
      </div>
    </div>
  )
}
