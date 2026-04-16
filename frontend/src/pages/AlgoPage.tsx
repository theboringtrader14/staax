import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { algosAPI, accountsAPI } from '@/services/api'
import { useStore } from '@/store'
import { StaaxSelect } from '@/components/StaaxSelect'

const INST_CODES: Record<string, string> = { NF: 'NIFTY', BN: 'BANKNIFTY', SX: 'SENSEX', MN: 'MIDCAPNIFTY', FN: 'FINNIFTY' }
const EXPIRY_OPTIONS = [
  { value: 'current_weekly', label: 'Current Weekly' },
  { value: 'next_weekly',    label: 'Next Weekly'    },
  { value: 'current_monthly',label: 'Current Monthly'},
  { value: 'next_monthly',   label: 'Next Monthly'   },
]
// BNF, FINNIFTY, MIDCAPNIFTY have no weekly expiry since Nov 2024
const MONTHLY_ONLY_CODES = new Set(['BN', 'FN', 'MN'])
const MONTHLY_ONLY_EXPIRY = EXPIRY_OPTIONS.filter(o => o.value.includes('monthly'))
const STRIKE_OPTIONS = [...Array.from({ length: 10 }, (_, i) => `ITM${10 - i}`), 'ATM', ...Array.from({ length: 10 }, (_, i) => `OTM${i + 1}`)]

type FeatureKey = 'wt' | 'sl' | 're' | 'reentry' | 'tp' | 'tsl' | 'ttp'
const FEATURES: { key: FeatureKey; label: string; color: string }[] = [
  { key: 'wt',      label: 'W&T',      color: '#9CA3AF' },
  { key: 'sl',      label: 'SL',       color: '#FF4444' },
  { key: 'tsl',     label: 'TSL',      color: '#FF6B00' },
  { key: 'reentry', label: 'Re-entry', color: '#F59E0B' },
  { key: 'tp',      label: 'TP',       color: '#22DD88' },
  { key: 'ttp',     label: 'TTP',      color: '#CC4400' },
]

interface LegVals {
  wt:  { direction: string; value: string; unit: string }
  sl:  { type: string; value: string }
  re:  { mode: string; trigger: string; count: string }
  reentry: {
    type: string;      // "re_entry" | "re_execute"
    ltpMode: string;   // "ltp" | "candle_close"
    onSl: boolean;
    onTp: boolean;
    maxSl: string;     // string so input works, parsed to int on submit
    maxTp: string;     // string so input works, parsed to int on submit
  };
  tp:  { type: string; value: string }
  tsl: { x: string; y: string; unit: string }
  ttp: { x: string; y: string; unit: string }
  orb: {
    entryAt:     string;   // "high" | "low"
    slType:      string;   // orb_sl_type
    tpType:      string;   // orb_tp_type
    bufferValue: string;   // string for input
    bufferUnit:  string;   // "pts" | "pct"
  }
}
interface JourneyChild {
  enabled: boolean
  instType: string; instCode: string; direction: string; optType: string
  strikeMode: string; strikeType: string; premiumVal: string; lots: string; expiry: string
  wt_enabled: boolean; wt_direction: string; wt_value: string; wt_unit: string
  sl_enabled: boolean; sl_type: string; sl_value: string
  re_enabled: boolean; re_sl_enabled: boolean; re_tp_enabled: boolean; re_mode: string; re_trigger: string; re_count: string
  tp_enabled: boolean; tp_type: string; tp_value: string
  tsl_enabled: boolean; tsl_x: string; tsl_y: string; tsl_unit: string
  ttp_enabled: boolean; ttp_x: string; ttp_y: string; ttp_unit: string
  child?: JourneyChild
}
const mkJourneyChild = (): JourneyChild => ({
  enabled: false,
  instType: 'OP', instCode: 'NF', direction: 'BUY', optType: 'CE',
  strikeMode: 'leg', strikeType: 'atm', premiumVal: '', lots: '', expiry: 'current_weekly',
  wt_enabled: false, wt_direction: 'up', wt_value: '', wt_unit: 'pts',
  sl_enabled: false, sl_type: 'pts_instrument', sl_value: '',
  re_enabled: false, re_sl_enabled: false, re_tp_enabled: false, re_mode: 'at_entry_price', re_trigger: 'sl', re_count: '1',
  tp_enabled: false, tp_type: 'pts_instrument', tp_value: '',
  tsl_enabled: false, tsl_x: '', tsl_y: '', tsl_unit: 'pts',
  ttp_enabled: false, ttp_x: '', ttp_y: '', ttp_unit: 'pts',
  child: undefined,
})

// Reverse of buildJourneyConfig — restores JourneyChild from stored JSON on edit load
const _REV_CODES: Record<string, string> = Object.fromEntries(Object.entries(INST_CODES).map(([k, v]) => [v, k]))
const fromJourneyConfig = (jc: any): JourneyChild => {
  if (!jc || !jc.child) return mkJourneyChild()
  const c = jc.child
  return {
    enabled:       true,
    instType:      c.instrument === 'fu' ? 'FU' : 'OP',
    instCode:      _REV_CODES[c.underlying] || 'NF',
    direction:     (c.direction || 'buy').toUpperCase(),
    optType:       c.instrument === 'fu' ? 'CE' : (c.instrument || 'ce').toUpperCase(),
    strikeMode:    'leg',
    strikeType:    c.strike_type || 'atm',
    premiumVal:    c.strike_value != null ? String(c.strike_value) : '',
    lots:          String(c.lots || 1),
    expiry:        c.expiry || 'current_weekly',
    wt_enabled:    !!c.wt_enabled,
    wt_direction:  c.wt_direction || 'up',
    wt_value:      c.wt_value != null ? String(c.wt_value) : '',
    wt_unit:       c.wt_unit || 'pts',
    sl_enabled:    !!(c.sl_type && c.sl_value != null),
    sl_type:       c.sl_type || 'pts_instrument',
    sl_value:      c.sl_value != null ? String(c.sl_value) : '',
    re_enabled:    false,
    re_sl_enabled: !!c.reentry_on_sl,
    re_tp_enabled: !!c.reentry_on_tp,
    re_mode:       'at_entry_price',
    re_trigger:    'sl',
    re_count:      String(c.reentry_max || 0),
    tp_enabled:    !!(c.tp_type && c.tp_value != null),
    tp_type:       c.tp_type || 'pts_instrument',
    tp_value:      c.tp_value != null ? String(c.tp_value) : '',
    tsl_enabled:   !!c.tsl_enabled,
    tsl_x:         c.tsl_x != null ? String(c.tsl_x) : '',
    tsl_y:         c.tsl_y != null ? String(c.tsl_y) : '',
    tsl_unit:      c.tsl_unit || 'pts',
    ttp_enabled:   !!c.ttp_enabled,
    ttp_x:         c.ttp_x != null ? String(c.ttp_x) : '',
    ttp_y:         c.ttp_y != null ? String(c.ttp_y) : '',
    ttp_unit:      c.ttp_unit || 'pts',
    child:         c.journey_config ? fromJourneyConfig(c.journey_config) : undefined,
  }
}
interface Leg {
  id: string; no: number; instType: string; instCode: string; direction: string; optType: string
  strikeMode: string; strikeType: string; premiumVal: string; lots: string; expiry: string
  active: Record<FeatureKey, boolean>; vals: LegVals; journey?: JourneyChild
  journey_trigger?: string  // 'sl' | 'tp' | 'either' — gates which exit fires child
  backendId?: string  // backend UUID — sent back on PUT to enable in-place update
}

const mkLeg = (n: number): Leg => ({
  id: `leg-${Date.now()}-${n}`, no: n,
  instType: 'OP', instCode: 'NF', direction: 'BUY', optType: 'CE',
  strikeMode: 'leg', strikeType: 'atm', premiumVal: '', lots: '', expiry: 'current_weekly',
  active: { wt: false, sl: false, re: false, reentry: false, tp: false, tsl: false, ttp: false }, journey: mkJourneyChild(), journey_trigger: 'either',
  vals: { wt: { direction: 'up', value: '', unit: 'pts' }, sl: { type: 'pts_instrument', value: '' }, re: { mode: 'at_entry_price', trigger: 'sl', count: '1' },
    reentry: { type: 're_entry', ltpMode: 'ltp', onSl: false, onTp: false, maxSl: '1', maxTp: '1' },
    tp: { type: 'pts_instrument', value: '' }, tsl: { x: '', y: '', unit: 'pts' }, ttp: { x: '', y: '', unit: 'pts' },
    orb: { entryAt: 'high', slType: 'orb_low', tpType: 'orb_range', bufferValue: '', bufferUnit: 'pts' } },
})
const cpLeg = (l: Leg, n: number): Leg => ({ ...l, id: `leg-${Date.now()}-c${n}`, no: n, vals: { ...l.vals, wt: { ...l.vals.wt }, sl: { ...l.vals.sl }, reentry: { ...l.vals.reentry }, tp: { ...l.vals.tp }, tsl: { ...l.vals.tsl }, ttp: { ...l.vals.ttp }, orb: { ...l.vals.orb } }, active: { ...l.active }, journey: l.journey ? { ...l.journey } : mkJourneyChild() })

function FeatVals({ leg, onUpdate, entryType }: { leg: Leg; onUpdate: (id: string, u: Partial<Leg>) => void; entryType: string }) {
  const active = FEATURES.filter(f => leg.active[f.key])
  if (!active.length) return null
  const u = (k: FeatureKey, sub: string, val: string) => onUpdate(leg.id, { vals: { ...leg.vals, [k]: { ...(leg.vals[k] as any), [sub]: val } } })
  const inpSt = { height: '26px', background: 'var(--bg-secondary)', border: '1px solid var(--bg-border)', borderRadius: '4px', color: 'var(--text)', fontSize: '11px', padding: '0 8px', fontFamily: 'inherit', outline: 'none' }
  const inp = (k: FeatureKey, sub: string, ph: string, w = '54px') => <input type="number" min="0" value={(leg.vals[k] as any)[sub] || ''} onChange={e => u(k, sub, e.target.value)} placeholder={ph} style={{ ...inpSt, width: w }} />
  const sel = (k: FeatureKey, sub: string, opts: [string, string][], w = '80px') =>
    <StaaxSelect value={(leg.vals[k] as any)[sub] || ''} onChange={v => u(k, sub, v)}
      options={opts.map(([value, label]) => ({ value, label }))} width={w} />
  return (
    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px', paddingTop: '6px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      {active.map(f => (
        <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: '4px', background: `${f.color}08`, border: `1px solid ${f.color}22`, borderRadius: '5px', padding: '4px 8px' }}>
          <span style={{ fontSize: '10px', color: f.color, fontWeight: 700, marginRight: '2px' }}>{f.label}:</span>
          {f.key === 'wt'  && <>{sel('wt',  'direction', [['up','↑Up'],['down','↓Dn']], '72px')} {inp('wt',  'value', 'val')} {sel('wt',  'unit', [['pts','pts'],['pct','%']], '60px')}</>}
          {f.key === 'sl'  && (() => {
            if (entryType === 'orb') {
              const orbSlOpts: [string,string][] = [
                ['orb_low','ORB Low'],['orb_high','ORB High'],
                ['orb_range','ORB Range'],['orb_range_plus_pts','Range+pts'],['orb_range_minus_pts','Range-pts'],
                ['pts_instrument','Pts(I)'],['pct_instrument','%(I)'],['pts_underlying','Pts(U)'],['pct_underlying','%(U)']
              ]
              const ov = leg.vals.orb
              const uOrb = (sub: keyof typeof ov, val: any) => onUpdate(leg.id, { vals: { ...leg.vals, orb: { ...ov, [sub]: val } } })
              const needsBuf = ov.slType === 'orb_range_plus_pts' || ov.slType === 'orb_range_minus_pts'
              return <>
                <select value={ov.slType} onChange={e => uOrb('slType', e.target.value)}
                  style={{ width: '100px', fontSize: '10px', padding: '2px 4px', background: 'var(--bg-surface)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '3px', color: 'var(--text-primary)' }}>
                  {orbSlOpts.map(([v,l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                {needsBuf && (
                  <>
                    <input type="number" value={ov.bufferValue} onChange={e => uOrb('bufferValue', e.target.value)}
                      placeholder="buf" style={{ width: '44px', fontSize: '10px', padding: '2px 4px', background: 'var(--bg-surface)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '3px', color: 'var(--text-primary)' }} />
                    <select value={ov.bufferUnit} onChange={e => uOrb('bufferUnit', e.target.value)}
                      style={{ width: '44px', fontSize: '10px', padding: '2px 4px', background: 'var(--bg-surface)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '3px', color: 'var(--text-primary)' }}>
                      <option value="pts">pts</option>
                      <option value="pct">%</option>
                    </select>
                  </>
                )}
                {(!ov.slType.startsWith('orb_')) && inp('sl', 'value', 'val')}
              </>
            }
            // Non-ORB: original behavior
            const slOpts: [string,string][] = [['pts_instrument','Pts(I)'],['pct_instrument','%(I)'],['pts_underlying','Pts(U)'],['pct_underlying','%(U)']]
            return <>{sel('sl', 'type', slOpts, '88px')} {inp('sl', 'value', 'val')}</>
          })()}
          {f.key === 're'  && <>{sel('re',  'mode', [['at_entry_price','@Entry'],['immediate','Now'],['at_cost','@Cost']], '80px')} {sel('re',  'trigger', [['sl','SL'],['tp','TP'],['any','Any']], '60px')} {sel('re', 'count', [['1','1×'],['2','2×'],['3','3×'],['4','4×'],['5','5×']], '56px')}</>}
          {f.key === 'reentry' && (() => {
            const rv = leg.vals.reentry
            const uRe = (sub: keyof typeof rv, val: any) => onUpdate(leg.id, { vals: { ...leg.vals, reentry: { ...rv, [sub]: val } } })
            return <>
              {(['re_entry', 're_execute'] as const).map(t => (
                <button key={t} type="button" onClick={() => uRe('type', t)}
                  style={{ padding: '2px 7px', fontSize: 10, borderRadius: 4, cursor: 'pointer', background: rv.type === t ? 'rgba(255,107,0,0.25)' : 'rgba(255,255,255,0.05)', color: rv.type === t ? 'var(--accent)' : 'var(--text-muted)', border: `1px solid ${rv.type === t ? 'rgba(255,107,0,0.4)' : 'rgba(255,255,255,0.1)'}` }}>
                  {t === 're_entry' ? 'Re-Entry' : 'Re-Execute'}
                </button>
              ))}
              {rv.type === 're_entry' && (['ltp', 'candle_close'] as const).map(m => (
                <button key={m} type="button" onClick={() => uRe('ltpMode', m)}
                  style={{ padding: '2px 7px', fontSize: 10, borderRadius: 4, cursor: 'pointer', background: rv.ltpMode === m ? 'rgba(255,107,0,0.25)' : 'rgba(255,255,255,0.05)', color: rv.ltpMode === m ? 'var(--accent)' : 'var(--text-muted)', border: `1px solid ${rv.ltpMode === m ? 'rgba(255,107,0,0.4)' : 'rgba(255,255,255,0.1)'}` }}>
                  {m === 'ltp' ? 'LTP' : 'Candle'}
                </button>
              ))}
              <label style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--text-muted)' }}>
                <input type="checkbox" checked={rv.onSl} onChange={e => uRe('onSl', e.target.checked)} style={{ accentColor: 'var(--accent)', width: 12, height: 12 }} /> SL
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--text-muted)' }}>
                <input type="checkbox" checked={rv.onTp} onChange={e => uRe('onTp', e.target.checked)} style={{ accentColor: 'var(--accent)', width: 12, height: 12 }} /> TP
              </label>
              <span style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '10px', color: 'var(--text-muted)' }}>
                SL:<input type="number" min={0} max={5} value={rv.maxSl}
                  onChange={e => uRe('maxSl', e.target.value)}
                  style={{ width: '32px', fontSize: '10px', padding: '2px 4px', background: 'var(--bg-surface)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '3px', color: 'var(--text-primary)', textAlign: 'center' }} />
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '10px', color: 'var(--text-muted)' }}>
                TP:<input type="number" min={0} max={5} value={rv.maxTp}
                  onChange={e => uRe('maxTp', e.target.value)}
                  style={{ width: '32px', fontSize: '10px', padding: '2px 4px', background: 'var(--bg-surface)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '3px', color: 'var(--text-primary)', textAlign: 'center' }} />
              </span>
            </>
          })()}
          {f.key === 'tp'  && (() => {
            if (entryType === 'orb') {
              const orbTpOpts: [string,string][] = [
                ['orb_range','ORB Range'],['orb_high','ORB High'],['orb_low','ORB Low'],
                ['orb_range_plus_pts','Range+pts'],['orb_range_minus_pts','Range-pts'],
                ['pts_instrument','Pts(I)'],['pct_instrument','%(I)'],['pts_underlying','Pts(U)'],['pct_underlying','%(U)']
              ]
              const ov = leg.vals.orb
              const uOrb = (sub: keyof typeof ov, val: any) => onUpdate(leg.id, { vals: { ...leg.vals, orb: { ...ov, [sub]: val } } })
              const needsBuf = ov.tpType === 'orb_range_plus_pts' || ov.tpType === 'orb_range_minus_pts'
              return <>
                <select value={ov.tpType} onChange={e => uOrb('tpType', e.target.value)}
                  style={{ width: '100px', fontSize: '10px', padding: '2px 4px', background: 'var(--bg-surface)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '3px', color: 'var(--text-primary)' }}>
                  {orbTpOpts.map(([v,l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                {needsBuf && (
                  <>
                    <input type="number" value={ov.bufferValue} onChange={e => uOrb('bufferValue', e.target.value)}
                      placeholder="buf" style={{ width: '44px', fontSize: '10px', padding: '2px 4px', background: 'var(--bg-surface)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '3px', color: 'var(--text-primary)' }} />
                    <select value={ov.bufferUnit} onChange={e => uOrb('bufferUnit', e.target.value)}
                      style={{ width: '44px', fontSize: '10px', padding: '2px 4px', background: 'var(--bg-surface)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '3px', color: 'var(--text-primary)' }}>
                      <option value="pts">pts</option>
                      <option value="pct">%</option>
                    </select>
                  </>
                )}
                {(!ov.tpType.startsWith('orb_')) && inp('tp', 'value', 'val')}
              </>
            }
            // Non-ORB: original behavior
            return <>{sel('tp',  'type', [['pts_instrument','Pts(I)'],['pct_instrument','%(I)'],['pts_underlying','Pts(U)'],['pct_underlying','%(U)']], '88px')} {inp('tp',  'value', 'val')}</>
          })()}
          {f.key === 'tsl' && <>{inp('tsl', 'x', 'X')} <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>→</span> {inp('tsl', 'y', 'Y')} {sel('tsl', 'unit', [['pts','pts'],['pct','%']], '60px')}</>}
        {f.key === 'ttp' && <>{inp('ttp', 'x', 'X')} <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>→</span> {inp('ttp', 'y', 'Y')} {sel('ttp', 'unit', [['pts','pts'],['pct','%']], '60px')}</>}
        </div>
      ))}
    </div>
  )
}

const TYPE_OPTS: [string,string][] = [['pts_instrument','Pts(I)'],['pct_instrument','%(I)'],['pts_underlying','Pts(U)'],['pct_underlying','%(U)']]

function JourneyChildPanel({ child, depth, onChange }: {
  child: JourneyChild; depth: number; onChange: (c: JourneyChild) => void
}) {
  const cs = { height: '26px', fontSize: '11px', fontFamily: 'inherit', color: 'var(--text)' }
  const csSt = { height: '26px', background: 'var(--bg-secondary)', border: '1px solid var(--bg-border)', borderRadius: '4px', color: 'var(--text)', fontSize: '11px', padding: '0 8px', fontFamily: 'inherit', outline: 'none' }
  const u = (k: keyof JourneyChild, v: any) => onChange({ ...child, [k]: v })
  const childExpiryOpts = MONTHLY_ONLY_CODES.has(child.instCode) ? MONTHLY_ONLY_EXPIRY : EXPIRY_OPTIONS
  const depthColor = depth === 1 ? '#CC4400' : depth === 2 ? '#F59E0B' : '#22DD88'
  const depthLabel = depth === 1 ? 'Child' : depth === 2 ? 'Grandchild' : 'Great-grandchild'
  const tslBlocked = !child.sl_enabled || !child.sl_value
  const ttpBlocked = !child.tp_enabled || !child.tp_value
  const reslBlocked = !child.sl_enabled || !child.sl_value
  const retpBlocked = !child.tp_enabled || !child.tp_value
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
          <button onClick={() => u('instType', child.instType === 'OP' ? 'FU' : 'OP')} style={{ height: '26px', padding: '0 8px', borderRadius: '100px', fontSize: '11px', fontWeight: 700, background: child.instType === 'OP' ? 'rgba(255,107,0,0.15)' : 'rgba(215,123,18,0.15)', color: child.instType === 'OP' ? 'var(--ox-radiant)' : 'var(--accent-amber)', border: '1px solid rgba(255,107,0,0.3)', cursor: 'pointer' }}>{child.instType}</button>
          <StaaxSelect value={child.instCode} onChange={code => {
            const patch: Partial<JourneyChild> = { instCode: code }
            if (MONTHLY_ONLY_CODES.has(code) && !child.expiry.includes('monthly')) patch.expiry = 'current_monthly'
            onChange({ ...child, ...patch })
          }} options={Object.entries(INST_CODES).map(([c]) => ({ value: c, label: c }))} width="68px" />
          <button onClick={() => u('direction', child.direction === 'BUY' ? 'SELL' : 'BUY')} style={{ height: '26px', padding: '0 8px', borderRadius: '100px', fontSize: '11px', fontWeight: 700, background: child.direction === 'BUY' ? 'rgba(34,221,136,0.15)' : 'rgba(255,68,68,0.15)', color: child.direction === 'BUY' ? 'var(--green)' : 'var(--red)', border: '1px solid rgba(34,221,136,0.3)', cursor: 'pointer' }}>{child.direction}</button>
          {child.instType === 'OP' && <button onClick={() => u('optType', child.optType === 'CE' ? 'PE' : 'CE')} style={{ height: '26px', padding: '0 8px', borderRadius: '100px', fontSize: '11px', fontWeight: 700, background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)', border: '1px solid var(--bg-border)', cursor: 'pointer' }}>{child.optType}</button>}
          {child.instType === 'OP' && <>
            <StaaxSelect value={child.expiry} onChange={v => u('expiry', v)} options={childExpiryOpts.map(o => ({ value: o.value, label: o.label }))} width="128px" />
            <StaaxSelect value={child.strikeMode} onChange={v => u('strikeMode', v)} options={[{ value: 'leg', label: 'Strike' }, { value: 'premium', label: 'Premium' }, { value: 'straddle', label: 'Straddle' }]} width="88px" />
            {child.strikeMode === 'leg' && <StaaxSelect value={child.strikeType} onChange={v => u('strikeType', v)} options={STRIKE_OPTIONS.map(st => ({ value: st.toLowerCase(), label: st }))} width="70px" />}
            {child.strikeMode === 'premium' && <input value={child.premiumVal} onChange={e => u('premiumVal', e.target.value)} placeholder="₹ premium" style={{ ...csSt, width: '82px' }} />}
            {child.strikeMode === 'straddle' && <StaaxSelect value={child.premiumVal || '20'} onChange={v => u('premiumVal', v)} options={[5,10,15,20,25,30,35,40,45,50,55,60].map(v => ({ value: String(v), label: `${v}%` }))} width="72px" />}
          </>}
          <input value={child.lots} onChange={e => u('lots', e.target.value)} type="number" min={1} placeholder="Lots" style={{ ...csSt, width: '56px', textAlign: 'center' }} />
          <span style={{ color: 'rgba(255,255,255,0.15)', fontSize: '14px' }}>|</span>
          {[
            { key: 'wt_enabled', label: 'W&T',   color: '#9CA3AF' },
            { key: 'sl_enabled',    label: 'SL',    color: '#FF4444' },
            { key: 'tsl_enabled',   label: 'TSL',   color: '#FF6B00', blocked: tslBlocked },
            { key: 're_sl_enabled', label: 'RE-SL', color: '#F59E0B', blocked: reslBlocked },
            { key: 'tp_enabled',    label: 'TP',    color: '#22DD88' },
            { key: 'ttp_enabled',  label: 'TTP',   color: '#CC4400', blocked: ttpBlocked },
            { key: 're_tp_enabled', label: 'RE-TP', color: '#F59E0B', blocked: retpBlocked },
          ].map(f => (
            <button key={f.key} onClick={() => {
              if (f.blocked) return
              const newVal = !(child[f.key as keyof JourneyChild])
              const patch: Partial<JourneyChild> = { [f.key]: newVal }
              if (f.key === 'sl_enabled' && !newVal) { patch.tsl_enabled = false; patch.re_sl_enabled = false }
              if (f.key === 'tp_enabled' && !newVal) { patch.ttp_enabled = false; patch.re_tp_enabled = false }
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
              <StaaxSelect value={child.wt_direction} onChange={v => u('wt_direction', v)} options={[{ value: 'up', label: '↑Up' }, { value: 'down', label: '↓Dn' }]} width="72px" />
              <input type="number" min="0" value={child.wt_value} onChange={e => u('wt_value', e.target.value)} placeholder="val" style={{ ...csSt, width: '46px', height: '22px' }} />
              <StaaxSelect value={child.wt_unit} onChange={v => u('wt_unit', v)} options={[{ value: 'pts', label: 'pts' }, { value: 'pct', label: '%' }]} width="60px" />
            </div>
          )}
          {child.sl_enabled && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '3px', background: 'rgba(255,68,68,0.08)', border: '1px solid rgba(255,68,68,0.2)', borderRadius: '5px', padding: '3px 7px' }}>
              <span style={{ fontSize: '10px', color: '#FF4444', fontWeight: 700, marginRight: '2px' }}>SL:</span>
              <StaaxSelect value={child.sl_type} onChange={v => u('sl_type', v)} options={TYPE_OPTS.map(([value, label]) => ({ value, label }))} width="88px" />
              <input type="number" min="0" value={child.sl_value} onChange={e => u('sl_value', e.target.value)} placeholder="val" style={{ ...csSt, width: '46px', height: '22px' }} />
            </div>
          )}
          {child.re_enabled && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '3px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '5px', padding: '3px 7px' }}>
              <span style={{ fontSize: '10px', color: '#F59E0B', fontWeight: 700, marginRight: '2px' }}>RE:</span>
              <StaaxSelect value={child.re_mode} onChange={v => u('re_mode', v)} options={[{ value: 'at_entry_price', label: '@Entry' }, { value: 'immediate', label: 'Now' }, { value: 'at_cost', label: '@Cost' }]} width="80px" />
              <StaaxSelect value={child.re_trigger} onChange={v => u('re_trigger', v)} options={[{ value: 'sl', label: 'SL' }, { value: 'tp', label: 'TP' }, { value: 'any', label: 'Any' }]} width="60px" />
              <StaaxSelect value={child.re_count} onChange={v => u('re_count', v)} options={['1','2','3','4','5'].map(n => ({ value: n, label: `${n}×` }))} width="56px" />
            </div>
          )}
          {child.re_sl_enabled && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '3px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '5px', padding: '3px 7px' }}>
              <span style={{ fontSize: '10px', color: '#F59E0B', fontWeight: 700, marginRight: '2px' }}>RE-SL:</span>
              <StaaxSelect value={child.re_mode} onChange={v => u('re_mode', v)} options={[{ value: 'at_entry_price', label: '@Entry' }, { value: 'immediate', label: 'Now' }, { value: 'at_cost', label: '@Cost' }]} width="80px" />
              <StaaxSelect value={child.re_count} onChange={v => u('re_count', v)} options={['1','2','3'].map(n => ({ value: n, label: `${n}×` }))} width="56px" />
            </div>
          )}
          {child.re_tp_enabled && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '3px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '5px', padding: '3px 7px' }}>
              <span style={{ fontSize: '10px', color: '#F59E0B', fontWeight: 700, marginRight: '2px' }}>RE-TP:</span>
              <StaaxSelect value={child.re_mode} onChange={v => u('re_mode', v)} options={[{ value: 'at_entry_price', label: '@Entry' }, { value: 'immediate', label: 'Now' }, { value: 'at_cost', label: '@Cost' }]} width="80px" />
              <StaaxSelect value={child.re_count} onChange={v => u('re_count', v)} options={['1','2','3'].map(n => ({ value: n, label: `${n}×` }))} width="56px" />
            </div>
          )}
          {child.tp_enabled && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '3px', background: 'rgba(34,221,136,0.08)', border: '1px solid rgba(34,221,136,0.2)', borderRadius: '5px', padding: '3px 7px' }}>
              <span style={{ fontSize: '10px', color: '#22DD88', fontWeight: 700, marginRight: '2px' }}>TP:</span>
              <StaaxSelect value={child.tp_type} onChange={v => u('tp_type', v)} options={TYPE_OPTS.map(([value, label]) => ({ value, label }))} width="88px" />
              <input type="number" min="0" value={child.tp_value} onChange={e => u('tp_value', e.target.value)} placeholder="val" style={{ ...csSt, width: '46px', height: '22px' }} />
            </div>
          )}
          {child.tsl_enabled && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '3px', background: 'rgba(255,107,0,0.08)', border: '1px solid rgba(255,107,0,0.2)', borderRadius: '5px', padding: '3px 7px' }}>
              <span style={{ fontSize: '10px', color: '#FF6B00', fontWeight: 700, marginRight: '2px' }}>TSL:</span>
              <input type="number" min="0" value={child.tsl_x} onChange={e => u('tsl_x', e.target.value)} placeholder="X" style={{ ...cs, width: '40px', height: '22px' }} />
              <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>→</span>
              <input type="number" min="0" value={child.tsl_y} onChange={e => u('tsl_y', e.target.value)} placeholder="Y" style={{ ...cs, width: '40px', height: '22px' }} />
              <select value={child.tsl_unit} onChange={e => u('tsl_unit', e.target.value)} style={{ ...cs, height: '22px' }}><option value="pts">pts</option><option value="pct">%</option></select>
            </div>
          )}
          {child.ttp_enabled && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '3px', background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.2)', borderRadius: '5px', padding: '3px 7px' }}>
              <span style={{ fontSize: '10px', color: '#CC4400', fontWeight: 700, marginRight: '2px' }}>TTP:</span>
              <input type="number" min="0" value={child.ttp_x} onChange={e => u('ttp_x', e.target.value)} placeholder="X" style={{ ...cs, width: '40px', height: '22px' }} />
              <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>→</span>
              <input type="number" min="0" value={child.ttp_y} onChange={e => u('ttp_y', e.target.value)} placeholder="Y" style={{ ...cs, width: '40px', height: '22px' }} />
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

const JOURNEY_TRIGGER_OPTS: { value: string; label: string; color: string }[] = [
  { value: 'sl',     label: 'SL Hit',  color: '#FF4444' },
  { value: 'tp',     label: 'TP Hit',  color: '#22DD88' },
  { value: 'either', label: 'Either',  color: '#A78BFA' },
]

function JourneyPanel({ leg, onUpdate }: { leg: Leg; onUpdate: (id: string, u: Partial<Leg>) => void }) {
  const [open, setOpen] = useState(false)
  const j = leg.journey || mkJourneyChild()
  const hasJourney = j.enabled
  const showTriggerChips = hasJourney && leg.active.sl && leg.active.tp
  const currentTrigger = leg.journey_trigger || 'either'
  return (
    <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px solid rgba(167,139,250,0.15)' }}>
      <button onClick={() => setOpen((o: boolean) => !o)} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', padding: '2px 0' }}>
        <span style={{ fontSize: '10px', fontWeight: 700, color: hasJourney ? '#CC4400' : 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {open ? '▾' : '▸'} Journey {hasJourney ? '● Active' : ''}
        </span>
      </button>
      {open && (<>
        {showTriggerChips && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', margin: '5px 0 4px' }}>
            <span style={{ fontSize: '10px', color: 'var(--text-dim)', fontWeight: 600, marginRight: '2px' }}>Trigger on:</span>
            {JOURNEY_TRIGGER_OPTS.map(opt => {
              const active = currentTrigger === opt.value
              return (
                <button
                  key={opt.value}
                  onClick={() => onUpdate(leg.id, { journey_trigger: opt.value })}
                  style={{
                    height: '22px', padding: '0 10px', borderRadius: '11px', fontSize: '10px', fontWeight: 600,
                    cursor: 'pointer', border: 'none', transition: 'all 0.12s',
                    background: active ? opt.color : 'var(--bg-surface)',
                    color: active ? '#000' : 'var(--text-dim)',
                  }}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        )}
        <JourneyChildPanel child={j} depth={1} onChange={c => onUpdate(leg.id, { journey: c })} />
      </>)}
    </div>
  )
}

function LegRow({ leg, isDragging, onUpdate, onRemove, onCopy, dragHandleProps, onBlockedClick, entryType }: {
  leg: Leg; isDragging: boolean
  onUpdate: (id: string, u: Partial<Leg>) => void
  onRemove: (id: string) => void
  onCopy:   (id: string) => void
  dragHandleProps: any
  onBlockedClick: (msg: string) => void
  entryType: string
}) {
  const u = (k: keyof Leg, v: any) => onUpdate(leg.id, { [k]: v })
  const sInp = { height: '28px', background: 'var(--bg-secondary)', border: '1px solid var(--bg-border)', borderRadius: '4px', color: 'var(--text)', fontSize: '11px', padding: '0 8px', fontFamily: 'inherit', outline: 'none' as const }
  const expiryOpts = MONTHLY_ONLY_CODES.has(leg.instCode) ? MONTHLY_ONLY_EXPIRY : EXPIRY_OPTIONS

  return (
    <div style={{ background: 'var(--glass-bg)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: `0.5px solid ${isDragging ? 'rgba(255,107,0,0.65)' : 'rgba(255,107,0,0.22)'}`, borderRadius: '7px', padding: '9px 10px', marginBottom: '6px', opacity: isDragging ? 0.7 : 1, transition: 'border-color 0.1s' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
        <span {...dragHandleProps} title="Drag to reorder" style={{ cursor: 'grab', color: 'var(--text-dim)', fontSize: '13px', flexShrink: 0, padding: '0 2px', userSelect: 'none' }}>⠿</span>
        <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-dim)', minWidth: '20px', textAlign: 'center' }}>L{leg.no}</span>
        <button onClick={() => u('instType', leg.instType === 'OP' ? 'FU' : 'OP')} style={{ height: '28px', padding: '0 9px', borderRadius: '100px', fontSize: '11px', fontWeight: 700, background: leg.instType === 'OP' ? 'rgba(255,107,0,0.15)' : 'rgba(215,123,18,0.15)', color: leg.instType === 'OP' ? 'var(--ox-radiant)' : 'var(--accent-amber)', border: `1px solid ${leg.instType === 'OP' ? 'rgba(255,107,0,0.3)' : 'rgba(215,123,18,0.3)'}`, cursor: 'pointer', flexShrink: 0 }}>{leg.instType}</button>
        <StaaxSelect value={leg.instCode} onChange={code => {
          const patch: Partial<Leg> = { instCode: code }
          if (MONTHLY_ONLY_CODES.has(code) && !leg.expiry.includes('monthly')) patch.expiry = 'current_monthly'
          onUpdate(leg.id, patch)
        }} options={Object.entries(INST_CODES).map(([c, n]) => ({ value: c, label: c + (n ? '' : '') }))} width="68px" />
        <button onClick={() => u('direction', leg.direction === 'BUY' ? 'SELL' : 'BUY')} style={{ height: '28px', padding: '0 9px', borderRadius: '100px', fontSize: '11px', fontWeight: 700, background: leg.direction === 'BUY' ? 'rgba(34,221,136,0.15)' : 'rgba(255,68,68,0.15)', color: leg.direction === 'BUY' ? 'var(--sem-long)' : 'var(--sem-short)', border: `0.5px solid ${leg.direction === 'BUY' ? 'rgba(34,221,136,0.35)' : 'rgba(255,68,68,0.35)'}`, cursor: 'pointer', flexShrink: 0 }}>{leg.direction}</button>
        {leg.instType === 'OP' && <button onClick={() => u('optType', leg.optType === 'CE' ? 'PE' : 'CE')} style={{ height: '28px', padding: '0 9px', borderRadius: '100px', fontSize: '11px', fontWeight: 700, background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)', border: '1px solid var(--bg-border)', cursor: 'pointer', flexShrink: 0 }}>{leg.optType}</button>}
        {leg.instType === 'OP' && <>
          <StaaxSelect value={leg.expiry} onChange={v => u('expiry', v)} options={expiryOpts.map(o => ({ value: o.value, label: o.label }))} width="128px" />
          <StaaxSelect value={leg.strikeMode} onChange={v => { u('strikeMode', v); if (v === 'straddle' && !leg.premiumVal) u('premiumVal', '20') }} options={[{ value: 'leg', label: 'Strike' }, { value: 'premium', label: 'Premium' }, { value: 'straddle', label: 'Straddle' }]} width="88px" />
          {leg.strikeMode === 'leg' && <StaaxSelect value={leg.strikeType} onChange={v => u('strikeType', v)} options={STRIKE_OPTIONS.map(st => ({ value: st.toLowerCase(), label: st }))} width="70px" />}
          {leg.strikeMode === 'premium' && <input value={leg.premiumVal} onChange={e => u('premiumVal', e.target.value)} placeholder="₹ premium" style={{ ...sInp, width: '82px' }} />}
          {leg.strikeMode === 'straddle' && <StaaxSelect value={leg.premiumVal || '20'} onChange={v => u('premiumVal', v)} options={[5,10,15,20,25,30,35,40,45,50,55,60].map(v => ({ value: String(v), label: `${v}%` }))} width="72px" />}
        </>}
        <input value={leg.lots} onChange={e => u('lots', e.target.value)} type="number" min={1} placeholder="Lots" style={{ ...sInp, width: '56px', textAlign: 'center', color: 'var(--text)' }} />
        <span style={{ color: 'var(--bg-border)', fontSize: '14px', flexShrink: 0 }}>|</span>
        {FEATURES.map(f => {
          const slHasValue = !!(leg.vals.sl as any)?.value
          const tpHasValue = !!(leg.vals.tp as any)?.value
          const blocked = (f.key === 'tsl' && (!leg.active['sl'] || !slHasValue)) || (f.key === 'ttp' && (!leg.active['tp'] || !tpHasValue))
          return (
            <button key={f.key} onClick={() => {
              if (blocked) { onBlockedClick(f.key === 'tsl' ? 'Enable SL and set a value before ' + f.key.toUpperCase() : 'Enable TP and set a value before ' + f.key.toUpperCase()); return }
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
          <button onClick={() => onCopy(leg.id)} title="Copy leg"
            style={{ height: '28px', width: '28px', background: 'none', border: '0.5px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.5)', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 150ms ease', flexShrink: 0 }}
            onMouseEnter={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.9)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.5)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)' }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="4.083" y="4.083" width="8.167" height="8.167" rx="1.167" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M2.333 9.917H1.75A.583.583 0 011.167 9.333V1.75A.583.583 0 011.75 1.167h7.583a.583.583 0 01.584.583v.583" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
          </button>
          <button onClick={() => onRemove(leg.id)} title="Remove leg" style={{ height: '28px', padding: '0 9px', background: 'none', border: '0.5px solid rgba(255,68,68,0.35)', color: 'var(--red)', borderRadius: '100px', fontSize: '11px', cursor: 'pointer' }}>✕</button>
        </div>
      </div>
      {entryType === 'orb' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
          <span style={{ fontSize: '10px', color: 'var(--text-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Entry At</span>
          {(['high','low'] as const).map(ea => (
            <button key={ea} type="button"
              onClick={() => onUpdate(leg.id, { vals: { ...leg.vals, orb: { ...leg.vals.orb, entryAt: ea } } })}
              className={`chip ${leg.vals.orb.entryAt === ea ? 'chip-active' : 'chip-inactive'}`}
              style={{ height: '24px', padding: '0 8px', cursor: 'pointer', fontSize: '10px' }}>
              {ea === 'high' ? 'ORB High (BUY)' : 'ORB Low (SELL)'}
            </button>
          ))}
        </div>
      )}
      <FeatVals leg={leg} onUpdate={onUpdate} entryType={entryType} />
      <JourneyPanel leg={leg} onUpdate={onUpdate} />
    </div>
  )
}

function SubSection({ title }: { title: string }) {
  return (
    <div style={{
      fontSize: '10px', fontWeight: 700, color: 'rgba(232,232,248,0.7)',
      textTransform: 'uppercase', letterSpacing: '1.5px',
      marginBottom: '10px', marginTop: '6px', paddingBottom: '6px',
      borderBottom: '1px solid rgba(255,107,0,0.12)',
      borderLeft: '2px solid #FF6B00', paddingLeft: '10px',
    }}>{title}</div>
  )
}


const TIME_MIN = '09:15'
const TIME_MAX = '15:30'
function TimeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const clamp = (v: string) => {
    if (!v) return v
    const [h, m, s] = v.split(':')
    const hh = Math.max(0, Math.min(23, parseInt(h) || 0))
    return `${String(hh).padStart(2,'0')}:${m || '00'}:${s || '00'}`
  }
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'var(--bg-secondary)', border: '1px solid var(--bg-border)', borderRadius: '5px', height: '32px', padding: '0 7px', boxSizing: 'border-box' }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--indigo)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.7 }}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 12"/></svg>
      <input
        type="time"
        step="1"
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={e => onChange(clamp(e.target.value))}
        className="staax-time-input"
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--text)',
          colorScheme: 'dark',
          fontSize: '12px',
          fontFamily: 'inherit',
          height: '100%',
          padding: '0',
          width: '58px',
          outline: 'none',
          cursor: 'pointer',
        }}
      />
    </div>
  )
}

export default function AlgoPage() {
  const navigate        = useNavigate()
  const { id }          = useParams<{ id: string }>()
  const isPractixMode   = useStore(s => s.isPractixMode)
  const isEdit      = !!id
  // Account list — populated from API on mount
  const [accountOptions, setAccountOptions] = useState<{ id: string; label: string }[]>([])

  const [legs, setLegs]             = useState<Leg[]>([mkLeg(1)])
  const [recurringDays, setRecurringDays] = useState<string[]>([])
  const [algoName, setAlgoName]     = useState('')
  const [stratMode, setStratMode]   = useState('intraday')
  const [entryType, setEntryType]   = useState('direct')
  const [orbRangeSource, setOrbRangeSource] = useState('underlying')
  const [lotMult, setLotMult]       = useState('1')
  const [entryTime, setEntryTime]   = useState('09:15:00')
  const [orbEnd, setOrbEnd]         = useState('11:15:00')
  const [exitTime, setExitTime]           = useState('15:10:00')
  const [nextDayExitTime, setNextDayExitTime] = useState('09:15:00')
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
  const [errorMargin, setErrorMargin] = useState(true)
  const [errorEntry, setErrorEntry] = useState(true)

  const [isDirty, setIsDirty]       = useState(false)
  const formLoadedRef               = useRef(false)   // true after initial data is populated
  const [saving, setSaving]         = useState(false)
  const [toast, setToast]           = useState('')
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500) }
  const [saveError, setSaveError]   = useState('')
  const [saved, setSaved]           = useState(false)
  const [showTomorrowWarn, setShowTomorrowWarn] = useState(false)  // F6
  const [isLocked, setIsLocked]     = useState(false)              // F5 — edit lock

  // Sync isDirty to window flag — Sidebar reads this to block nav clicks
  // Also warn on browser close/refresh when unsaved
  useEffect(() => {
    ;(window as any).__staaxDirty = isDirty
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) { e.preventDefault(); e.returnValue = '' }
    }
    window.addEventListener('beforeunload', handler)
    return () => {
      window.removeEventListener('beforeunload', handler)
      ;(window as any).__staaxDirty = false  // clear when leaving AlgoPage
    }
  }, [isDirty])

  // For new algos, mark form as loaded immediately so changes register as dirty
  useEffect(() => {
    if (!isEdit) setTimeout(() => { formLoadedRef.current = true }, 0)
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // Watch all form fields — mark dirty after initial load is complete
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!formLoadedRef.current) return
    setIsDirty(true)
  }, [algoName, stratMode, entryType, orbRangeSource, lotMult, entryTime, orbEnd, exitTime, dte, account,
      mtmUnit, mtmSL, mtmTP, errorMargin, errorEntry, legs])

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
        setRecurringDays(Array.isArray(a.recurring_days) ? a.recurring_days : [])
        setNextDayExitTime(a.next_day_exit_time || '09:15:00')
        if (a.exit_on_margin_error  != null) setErrorMargin(!!a.exit_on_margin_error)
        if (a.exit_on_entry_failure != null) setErrorEntry(!!a.exit_on_entry_failure)
        // Load delay settings — infer scope from buy/sell values
        const buyEntry = a.entry_delay_buy_secs ?? 0
        const sellEntry = a.entry_delay_sell_secs ?? 0
        const buyExit = a.exit_delay_buy_secs ?? 0
        const sellExit = a.exit_delay_sell_secs ?? 0
        setEntryDelay(String(buyEntry || sellEntry || 0))
        setEntryDelayScope(buyEntry > 0 && sellEntry === 0 ? 'buy' : buyEntry === 0 && sellEntry > 0 ? 'sell' : 'all')
        setExitDelay(String(buyExit || sellExit || 0))
        setExitDelayScope(buyExit > 0 && sellExit === 0 ? 'buy' : buyExit === 0 && sellExit > 0 ? 'sell' : 'all')
        // Map API legs to local Leg format
        const revCode: Record<string, string> = Object.fromEntries(
          Object.entries(INST_CODES).map(([k, v]) => [v, k])
        )
        const mappedLegs: Leg[] = (a.legs || []).map((l: any, i: number) => {
          const isFu      = l.instrument === 'fu'
          const strikeMode = l.strike_type === 'premium' ? 'premium'
            : l.strike_type === 'straddle_premium' ? 'straddle' : 'leg'
          return {
            id:         `leg-edit-${l.id || i}`,
            backendId:  l.id,
            no:         l.leg_number || i + 1,
            instType:   isFu ? 'FU' : 'OP',
            instCode:   revCode[l.underlying] || 'NF',
            direction:  l.direction === 'buy' ? 'BUY' : 'SELL',
            optType:    isFu ? 'CE' : (l.instrument || 'ce').toUpperCase(),
            strikeMode,
            strikeType: strikeMode === 'leg' ? (l.strike_type || 'atm') : 'atm',
            premiumVal: l.strike_value != null ? String(l.strike_value) : '',
            lots:       String(l.lots || 1),
            expiry:     l.expiry || 'current_weekly',
            active: {
              wt:      !!l.wt_enabled,
              sl:      !!(l.sl_type  && l.sl_value != null),
              tp:      !!(l.tp_type  && l.tp_value != null),
              tsl:     !!(l.tsl_x   && l.tsl_y),
              ttp:     !!(l.ttp_x   && l.ttp_y),
              reentry: !!(l.reentry_on_sl || l.reentry_on_tp),
              re:      false,
            },
            vals: {
              wt:  { direction: l.wt_direction || 'up', value: l.wt_value != null ? String(l.wt_value) : '', unit: l.wt_unit || 'pts' },
              sl:  { type: l.sl_type || 'pts_instrument', value: l.sl_value != null ? String(l.sl_value) : '' },
              tp:  { type: l.tp_type || 'pts_instrument', value: l.tp_value != null ? String(l.tp_value) : '' },
              tsl: { x: l.tsl_x != null ? String(l.tsl_x) : '', y: l.tsl_y != null ? String(l.tsl_y) : '', unit: l.tsl_unit || 'pts' },
              ttp: { x: l.ttp_x != null ? String(l.ttp_x) : '', y: l.ttp_y != null ? String(l.ttp_y) : '', unit: l.ttp_unit || 'pts' },
              reentry: {
                type:    l.reentry_type || 're_entry',
                ltpMode: l.reentry_ltp_mode || 'ltp',
                onSl:    l.reentry_on_sl ?? false,
                onTp:    l.reentry_on_tp ?? false,
                maxSl:   String(l.reentry_max_sl ?? l.reentry_max ?? 1),
                maxTp:   String(l.reentry_max_tp ?? l.reentry_max ?? 1),
              },
              orb: {
                entryAt:     l.orb_entry_at || (l.direction === 'buy' ? 'high' : 'low'),
                slType:      l.orb_sl_type || l.sl_type || 'orb_low',
                tpType:      l.orb_tp_type || l.tp_type || 'orb_range',
                bufferValue: l.orb_buffer_value != null ? String(l.orb_buffer_value) : '',
                bufferUnit:  l.orb_buffer_unit || 'pts',
              },
              re: { mode: 'at_entry_price', trigger: 'sl', count: '1' },
            },
            journey:         l.journey_config ? fromJourneyConfig(l.journey_config) : mkJourneyChild(),
            journey_trigger: l.journey_trigger || 'either',
          }
        })
        if (mappedLegs.length > 0) setLegs(mappedLegs)
        if (mappedLegs.length > 0 && (a.legs || [])[0]?.orb_range_source) {
          setOrbRangeSource((a.legs || [])[0].orb_range_source)
        }
        // Mark loaded after React processes all setters above
        setTimeout(() => { formLoadedRef.current = true }, 0)
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
    const fail = (msg: string) => { console.error('[validate] FAIL:', msg, { algoName, account, stratMode, entryType, entryTime, exitTime, orbEnd, dte, legs }); return msg }
    // ── Algo-level fields ─────────────────────────────────────────────────────
    if (!algoName.trim())            return fail('❌ Algo name is required')
    if (!account)                    return fail('❌ Account is required — select a broker account')
    if (!lotMult || parseInt(lotMult) < 1) return fail('❌ Lot multiplier must be at least 1')
    if (!entryTime)                  return fail('❌ Entry time is required')
    if (!exitTime)                   return fail('❌ Exit time is required')
    if (entryTime < TIME_MIN || entryTime > TIME_MAX) return fail(`❌ Entry time must be between 09:15 and 15:30 (got ${entryTime})`)
    if (!['stbt','btst'].includes(stratMode) && (exitTime < TIME_MIN || exitTime > TIME_MAX)) return fail(`❌ Exit time must be between 09:15 and 15:30 (got ${exitTime})`)
    if (stratMode === 'intraday' && exitTime <= entryTime) return fail('❌ Exit time must be after entry time for Intraday')
    if (entryType === 'orb' && !orbEnd) return fail('❌ ORB End time is required when entry type is ORB')
    if (entryType === 'orb' && orbEnd <= entryTime) return fail('❌ ORB end time must be after ORB start (entry) time')
    if (stratMode === 'positional' && !dte) return fail('❌ DTE is required for Positional strategy')
    if (legs.length === 0) return fail('❌ At least one leg is required')
    // ── Leg-level fields ──────────────────────────────────────────────────────
    for (const leg of legs) {
      const L = `Leg ${leg.no}`
      if (!leg.lots || parseInt(leg.lots) < 1) return fail(`❌ ${L}: Lots is required — enter number of lots`)
      if (leg.instType === 'OP') {
        if (!leg.expiry)    return fail(`❌ ${L}: Expiry is required`)
        if (!leg.strikeMode) return fail(`❌ ${L}: Strike mode is required`)
        if (leg.strikeMode === 'premium' && !leg.premiumVal) return fail(`❌ ${L}: Premium value is required when mode is Premium`)
        if (leg.strikeMode === 'straddle' && !leg.premiumVal) return fail(`❌ ${L}: Straddle % is required when mode is Straddle`)
      }
      for (const feat of FEATURES) {
        if (leg.active[feat.key]) {
          const vals = leg.vals[feat.key] as any
          const hasValue = Object.values(vals).some((v: any) => v !== '' && v !== undefined)
          if (!hasValue) return fail(`❌ ${L}: ${feat.label} is enabled but values are missing`)
        }
      }
      const slType = (leg.vals.sl as any).type || ''
      if (entryType !== 'orb') {
        if (leg.active['sl'] && !['orb_high','orb_low'].includes(slType) && !(leg.vals.sl as any).value) return fail(`❌ ${L}: SL value is required when SL is enabled`)
        if (leg.active['tp'] && !(leg.vals.tp as any).value) return fail(`❌ ${L}: TP value is required when TP is enabled`)
      }
      if (leg.active['wt'] && !(leg.vals.wt as any).value) return fail(`❌ ${L}: W&T value is required when W&T is enabled`)
      if (leg.active['tsl'] && (!leg.active['sl'] || !(leg.vals.sl as any).value)) return fail(`❌ ${L}: TSL requires SL to be enabled with a value`)
      if (leg.active['ttp'] && (!leg.active['tp'] || !(leg.vals.tp as any).value)) return fail(`❌ ${L}: TTP requires TP to be enabled with a value`)
    }
    return ''
  }

  const buildPayload = () => {
    const payload = ({
    name:                algoName.trim(),
    account_id:          account,
    strategy_mode:       stratMode,
    entry_type:          entryType,
    base_lot_multiplier: parseInt(lotMult) || 1,
    entry_time:          entryTime,
    exit_time:           exitTime,
    orb_end_time:        entryType === 'orb' ? orbEnd : undefined,
    next_day_exit_time:  ['stbt','btst'].includes(stratMode) ? nextDayExitTime : undefined,
    dte:                 stratMode === 'positional' ? parseInt(dte) : undefined,
    mtm_sl:              mtmSL ? parseFloat(mtmSL) : undefined,
    mtm_tp:              mtmTP ? parseFloat(mtmTP) : undefined,
    mtm_unit:            mtmUnit,
    entry_delay_buy_secs:  entryDelayScope !== 'sell' ? (parseInt(entryDelay) || 0) : 0,
    entry_delay_sell_secs: entryDelayScope !== 'buy'  ? (parseInt(entryDelay) || 0) : 0,
    exit_delay_buy_secs:   exitDelayScope  !== 'sell' ? (parseInt(exitDelay)  || 0) : 0,
    exit_delay_sell_secs:  exitDelayScope  !== 'buy'  ? (parseInt(exitDelay)  || 0) : 0,
    exit_on_margin_error:  !!errorMargin,
    exit_on_entry_failure: !!errorEntry,
    is_live:             !isPractixMode,
    recurring_days:      recurringDays,
    legs: legs.map(l => ({
      id:              l.backendId,
      leg_number:      l.no,
      direction:       l.direction.toLowerCase(),
      instrument:      l.instType === 'FU' ? 'fu' : l.optType.toLowerCase(),
      underlying:      INST_CODES[l.instCode] || l.instCode,
      expiry:          l.expiry,
      strike_type:     l.strikeMode === 'premium' ? 'premium' : l.strikeMode === 'straddle' ? 'straddle_premium' : l.strikeType,
      strike_value:    (l.strikeMode === 'premium' || l.strikeMode === 'straddle') ? parseFloat(l.premiumVal) || undefined : undefined,
      strike_offset:   0,
      lots:            parseInt(l.lots) || 1,
      // Features
      wt_enabled:  l.active.wt,
      wt_direction: l.vals.wt.direction, wt_value: parseFloat(l.vals.wt.value) || undefined, wt_unit: l.vals.wt.unit,
      sl_type:  l.active.sl && entryType !== 'orb' ? l.vals.sl.type : undefined,
      sl_value: l.active.sl && entryType !== 'orb' ? parseFloat(l.vals.sl.value) : undefined,
      tp_type:  l.active.tp && entryType !== 'orb' ? l.vals.tp.type : undefined,  tp_value: l.active.tp && entryType !== 'orb' ? parseFloat(l.vals.tp.value) : undefined,
      tsl_x: parseFloat(l.vals.tsl.x) || undefined, tsl_y: parseFloat(l.vals.tsl.y) || undefined, tsl_unit: l.vals.tsl.unit,
      ttp_x: parseFloat(l.vals.ttp.x) || undefined, ttp_y: parseFloat(l.vals.ttp.y) || undefined, ttp_unit: l.vals.ttp.unit,
      reentry_on_sl:    l.active.reentry ? l.vals.reentry.onSl : false,
      reentry_on_tp:    l.active.reentry ? l.vals.reentry.onTp : false,
      reentry_max_sl:   l.active.reentry ? parseInt(l.vals.reentry.maxSl) || 0 : 0,
      reentry_max_tp:   l.active.reentry ? parseInt(l.vals.reentry.maxTp) || 0 : 0,
      reentry_max:      l.active.reentry ? Math.max(parseInt(l.vals.reentry.maxSl) || 0, parseInt(l.vals.reentry.maxTp) || 0) : 0,
      reentry_type:     l.active.reentry ? l.vals.reentry.type : null,
      reentry_ltp_mode: l.active.reentry ? l.vals.reentry.ltpMode : null,
      orb_range_source:  entryType === 'orb' ? orbRangeSource : undefined,
      orb_entry_at:      entryType === 'orb' ? l.vals.orb.entryAt : undefined,
      orb_sl_type:       entryType === 'orb' ? l.vals.orb.slType : undefined,
      orb_tp_type:       entryType === 'orb' ? l.vals.orb.tpType : undefined,
      orb_buffer_value:  l.vals.orb.bufferValue ? parseFloat(l.vals.orb.bufferValue) : undefined,
      orb_buffer_unit:   l.vals.orb.bufferUnit || undefined,
      journey_config:  buildJourneyConfig(l.journey),
      journey_trigger: l.active.sl && l.active.tp ? (l.journey_trigger || 'either') : 'either',
    })),
  })
    return payload
  }

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
        reentry_on_sl: !!j.re_sl_enabled, reentry_on_tp: !!j.re_tp_enabled, reentry_max: parseInt(j.re_count) || 0,
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
      setIsDirty(false)
      setTimeout(() => { setSaved(false); navigate('/grid') }, 1200)
    } catch (e: any) {
      const status  = e?.response?.status
      const data    = e?.response?.data
      const detail  = data?.detail
      console.error('[AlgoPage] save error', status, detail ?? data ?? e?.message)
      let msg = `Save failed (${status ?? 'network error'}). Check console for details.`
      if (Array.isArray(detail)) {
        msg = detail.map((d: any) => {
          const loc = Array.isArray(d.loc) ? d.loc.filter((s: any) => s !== 'body').join(' → ') : ''
          return loc ? `${loc}: ${d.msg}` : d.msg
        }).join(' | ')
      } else if (typeof detail === 'string') {
        msg = detail
      } else if (typeof data === 'string' && data.length < 200) {
        msg = data
      } else if (e?.message) {
        msg = e.message
      }
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
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '22px', fontWeight: 800, color: 'var(--ox-radiant)' }}>{algoName || 'Edit Algo'}</h1>
          <div className="page-header-actions">
            <button className="btn btn-ghost" onClick={() => navigate('/grid')}>← Back to Grid</button>
          </div>
        </div>
        <div style={{ background: 'rgba(255,68,68,0.08)', border: '1px solid rgba(255,68,68,0.3)', borderRadius: '8px', padding: '20px 24px', textAlign: 'center' }}>
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
    <div className="algo-page">
      <style>{`
        .staax-time-input::-webkit-calendar-picker-indicator { display: none !important; opacity: 0 !important; width: 0 !important; }
        .staax-time-input::-webkit-inner-spin-button { display: none !important; }
        .staax-time-input::-webkit-datetime-edit-ampm-field { display: none !important; }
        .staax-time-input::-webkit-datetime-edit-fields-wrapper { padding: 0; }
        .staax-time-input { line-height: 30px; }
        .staax-input::placeholder { color: var(--text-muted) !important; }
        .staax-select option { background: var(--bg-secondary); color: var(--text); }
        .leg-select-dim { color: var(--text-muted) !important; }
        .leg-select-active { color: var(--text) !important; }
      `}</style>
      <div className="page-header">
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '22px', fontWeight: 800, color: 'var(--ox-radiant)' }}>{algoName || (isEdit ? 'Edit Algo' : 'New Algo')}</h1>
        <div className="page-header-actions">
          {isDirty    && <span style={{ fontSize: '11px', color: 'var(--accent-amber)', fontWeight: 600 }}>● Unsaved changes</span>}
          {saved      && <span style={{ fontSize: '12px', color: 'var(--green)', fontWeight: 600 }}>✅ Saved!</span>}
          {saveError  && <span style={{ fontSize: '12px', color: 'var(--red)' }}>{saveError}</span>}
          <button className="btn btn-ghost" onClick={() => navigate('/grid')}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : (isEdit ? 'Update Algo' : 'Save Algo')}</button>
        </div>
      </div>

      {toast && (
        <div style={{ position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)', background: 'rgba(30,30,30,0.95)', border: '1px solid rgba(255,68,68,0.4)', borderRadius: '8px', padding: '10px 18px', fontSize: '12px', color: 'var(--red)', fontWeight: 600, zIndex: 9999, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
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
            <button className="btn btn-warn" onClick={handleSave}>Save Anyway</button>
          </div>
        </div>
      )}

      {/* Identity card */}
      <div className="card cloud-fill" style={{ marginBottom: '12px' }}>
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
            <StaaxSelect value={stratMode} onChange={setStratMode} options={[{ value: 'intraday', label: 'Intraday' }, { value: 'btst', label: 'BTST' }, { value: 'stbt', label: 'STBT' }, { value: 'positional', label: 'Positional' }]} width="118px" />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginLeft: 'auto' }}>
            <label style={{ fontSize: '10px', color: 'var(--text-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Account</label>
            <StaaxSelect value={account} onChange={setAccount} options={accountOptions.map(a => ({ value: a.id, label: a.label }))} width="160px" />
          </div>
        </div>

        {/* Entry Type & Timing + MTM Controls — combined single row */}
        <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '0.5px solid rgba(255,107,0,0.12)', display: 'grid', gridTemplateColumns: '1fr 1px auto', columnGap: '28px', alignItems: 'start' }}>
          {/* Entry Type & Timing */}
          <div>
            <SubSection title="Entry Type & Timing — Algo Level" />
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '20px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '10px', color: 'var(--text-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Entry Type</label>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button onClick={() => setEntryType('direct')} className={`chip ${entryType === 'direct' ? 'chip-active' : 'chip-inactive'}`} style={{ height: '32px', padding: '0 14px', cursor: 'pointer' }}>Direct</button>
                  <button onClick={() => setEntryType('orb')}    className={`chip ${entryType === 'orb'    ? 'chip-active' : 'chip-inactive'}`} style={{ height: '32px', padding: '0 14px', cursor: 'pointer' }}>ORB</button>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '10px', color: 'var(--text-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Entry Time</label>
                <TimeInput value={entryTime} onChange={setEntryTime} />
              </div>
              {entryType === 'orb' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '10px', color: 'var(--text-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>ORB End</label>
                  <TimeInput value={orbEnd} onChange={setOrbEnd} />
                </div>
              )}
              {entryType === 'orb' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '10px', color: 'var(--text-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Range Source</label>
                  <div style={{ display: 'flex', gap: '5px' }}>
                    {(['underlying','instrument'] as const).map(s => (
                      <button key={s} type="button" onClick={() => setOrbRangeSource(s)}
                        className={`chip ${orbRangeSource === s ? 'chip-active' : 'chip-inactive'}`}
                        style={{ height: '28px', padding: '0 10px', cursor: 'pointer', fontSize: '10px' }}>
                        {s === 'underlying' ? 'Underlying' : 'Instrument'}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '10px', color: 'var(--text-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Exit Time{' '}
                  {(stratMode === 'stbt' || stratMode === 'btst') && (
                    <span title="Next-day exit: entries on day 1, exits on day 2 at this time. SL check auto-handled." style={{ cursor: 'help', color: 'var(--accent-amber)', fontSize: '10px' }}>⚠</span>
                  )}
                </label>
                <TimeInput value={['stbt','btst'].includes(stratMode) ? nextDayExitTime : exitTime} onChange={['stbt','btst'].includes(stratMode) ? setNextDayExitTime : setExitTime} />
              </div>
              {stratMode === 'positional' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '10px', color: 'var(--text-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>DTE</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <StaaxSelect value={dte} onChange={setDte} options={Array.from({ length: 31 }, (_, n) => ({ value: String(n), label: String(n) }))} width="72px" />
                    <span style={{ fontSize: '10px', color: 'var(--text-dim)', maxWidth: '120px', lineHeight: 1.3 }}>
                      {dte === '0' ? 'Exit on expiry day' : `${dte} day${Number(dte) !== 1 ? 's' : ''} before expiry`}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Vertical separator */}
          <div style={{ width: '1px', background: 'rgba(255,107,0,0.15)', alignSelf: 'stretch', minHeight: '60px' }} />

          {/* MTM Controls */}
          <div>
            <SubSection title="MTM Controls — Algo Level" />
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '20px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '10px', color: 'var(--text-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Unit</label>
                <StaaxSelect value={mtmUnit} onChange={setMtmUnit} options={[{ value: 'amt', label: '₹ Amount' }, { value: 'pct', label: '% Premium' }]} width="96px" />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '10px', color: 'var(--text-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>MTM SL</label>
                <input value={mtmSL} onChange={e => setMtmSL(e.target.value)} placeholder="None" className="staax-input" style={{ width: '80px', fontSize: '12px' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '10px', color: 'var(--text-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>MTM TP</label>
                <input value={mtmTP} onChange={e => setMtmTP(e.target.value)} placeholder="None" className="staax-input" style={{ width: '80px', fontSize: '12px' }} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Legs */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '10px', fontWeight: 600, color: 'rgba(232,232,248,0.5)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Legs</span>
          <span style={{ fontSize: '9px', padding: '2px 7px', borderRadius: '3px', background: 'rgba(34,221,136,0.1)', color: 'var(--green)', fontWeight: 700 }}>SL · TP · TSL · TTP · W&T · RE · Journey per leg</span>
          <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>{legs.length} leg{legs.length > 1 ? 's' : ''}</span>
        </div>
        <button className="btn btn-ghost" style={{ fontSize: '11px' }} onClick={addLeg}>+ Add Leg</button>
      </div>
      {legs.map((leg, i) => (
        <div key={leg.id}
          draggable onDragStart={() => setDragIdx(i)} onDragOver={e => { e.preventDefault(); setDragOverIdx(i) }} onDragEnd={handleDragEnd}
          style={{ outline: dragOverIdx === i && dragIdx !== i ? '1px dashed rgba(255,107,0,0.55)' : 'none', borderRadius: '7px' }}>
          <LegRow leg={leg} isDragging={dragIdx === i} onUpdate={updateLeg} onRemove={removeLeg} onCopy={copyLeg} dragHandleProps={{}} onBlockedClick={showToast} entryType={entryType} />
        </div>
      ))}

      {/* Delays + Errors */}
      <div className="card cloud-fill" style={{ marginTop: '12px' }}>
        <SubSection title="Order Delays — Algo Level" />
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          {/* F2 — Entry delay with BUY/SELL scope */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>Entry Delay:</span>
            {/* Scope dropdown — BUY/SELL/All */}
            <StaaxSelect value={entryDelayScope} onChange={setEntryDelayScope} options={[{ value: 'all', label: 'All legs' }, { value: 'buy', label: 'BUY legs' }, { value: 'sell', label: 'SELL legs' }]} width="90px" />
            <input value={entryDelay} onChange={e => setEntryDelay(e.target.value)} type="number" min={0} max={60} className="staax-input" style={{ width: '60px', fontSize: '12px' }} />
            <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>s (max 60)</span>
          </div>
          {/* F2 — Exit delay with BUY/SELL scope */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>Exit Delay:</span>
            <StaaxSelect value={exitDelayScope} onChange={setExitDelayScope} options={[{ value: 'all', label: 'All legs' }, { value: 'buy', label: 'BUY legs' }, { value: 'sell', label: 'SELL legs' }]} width="90px" />
            <input value={exitDelay} onChange={e => setExitDelay(e.target.value)} type="number" min={0} max={60} className="staax-input" style={{ width: '60px', fontSize: '12px' }} />
            <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>s (max 60)</span>
          </div>
        </div>

        <div style={{ margin: '12px 0 10px', borderTop: '0.5px solid rgba(255,107,0,0.12)' }} />
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
