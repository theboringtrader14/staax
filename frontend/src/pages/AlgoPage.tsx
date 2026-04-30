import React, { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { algosAPI, accountsAPI } from '@/services/api'
import { useStore } from '@/store'
import { StaaxSelect } from '@/components/StaaxSelect'
import { Sparkle, LockSimple, CheckCircle, Warning } from '@phosphor-icons/react'
import { AlgoAIAssistant } from '@/components/ai/AlgoAIAssistant'
import { sounds, initSounds } from '../utils/sounds'

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
  { key: 'reentry', label: 'RE', color: '#F59E0B' },
  { key: 'tp',      label: 'TP',       color: '#0ea66e' },
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
type ReentryVals = { type: string; ltpMode: string; onSl: boolean; onTp: boolean; maxSl: string; maxTp: string }
interface JourneyChild {
  enabled: boolean
  instType: string; instCode: string; direction: string; optType: string
  strikeMode: string; strikeType: string; premiumVal: string; lots: string; expiry: string
  wt_enabled: boolean; wt_direction: string; wt_value: string; wt_unit: string
  sl_enabled: boolean; sl_type: string; sl_value: string
  re_enabled: boolean; reentry: ReentryVals
  tp_enabled: boolean; tp_type: string; tp_value: string
  tsl_enabled: boolean; tsl_x: string; tsl_y: string; tsl_unit: string
  ttp_enabled: boolean; ttp_x: string; ttp_y: string; ttp_unit: string
  trigger: string  // 'sl' | 'tp' | 'either' — what exit of THIS child spawns its own child
  child?: JourneyChild
}
const mkReentry = (): ReentryVals => ({ type: 're_entry', ltpMode: 'ltp', onSl: false, onTp: false, maxSl: '1', maxTp: '1' })
const mkJourneyChild = (): JourneyChild => ({
  enabled: false,
  instType: 'OP', instCode: 'NF', direction: 'BUY', optType: 'CE',
  strikeMode: 'leg', strikeType: 'atm', premiumVal: '', lots: '', expiry: 'current_weekly',
  wt_enabled: false, wt_direction: 'up', wt_value: '', wt_unit: 'pts',
  sl_enabled: false, sl_type: 'pts_instrument', sl_value: '',
  re_enabled: false, reentry: mkReentry(),
  tp_enabled: false, tp_type: 'pts_instrument', tp_value: '',
  tsl_enabled: false, tsl_x: '', tsl_y: '', tsl_unit: 'pts',
  ttp_enabled: false, ttp_x: '', ttp_y: '', ttp_unit: 'pts',
  trigger: 'either',
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
    re_enabled:    !!(c.reentry_on_sl || c.reentry_on_tp),
    reentry: {
      type:    're_entry',
      ltpMode: c.reentry_ltp_mode || 'ltp',
      onSl:    !!c.reentry_on_sl,
      onTp:    !!c.reentry_on_tp,
      maxSl:   c.reentry_on_sl ? String(c.reentry_max || 1) : '1',
      maxTp:   c.reentry_on_tp ? String(c.reentry_max || 1) : '1',
    },
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
    trigger:       c.trigger || 'either',
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
  const u = (k: FeatureKey, sub: string, val: string) => onUpdate(leg.id, { vals: { ...leg.vals, [k]: { ...(leg.vals[k] as any), [sub]: val } } })
  const inpSt = { height: '28px', background: 'var(--bg)', boxShadow: 'var(--neu-inset)', border: 'none', borderRadius: '6px', color: 'var(--text)', fontSize: '11px', padding: '0 8px', fontFamily: 'inherit', outline: 'none' as const }
  const noZero = (e: React.FocusEvent<HTMLInputElement>, fn: (v: string) => void) => { if (e.target.value === '' || Number(e.target.value) < 1) fn('1') }
  const inp = (k: FeatureKey, sub: string, ph: string, w = '54px') => <input type="number" min="1" value={(leg.vals[k] as any)[sub] || ''} onChange={e => u(k, sub, e.target.value)} onBlur={e => noZero(e, v => u(k, sub, v))} placeholder={ph} style={{ ...inpSt, width: w }} />
  const sel = (k: FeatureKey, sub: string, opts: [string, string][], w = '80px') =>
    <StaaxSelect value={(leg.vals[k] as any)[sub] || ''} onChange={v => u(k, sub, v)}
      options={opts.map(([value, label]) => ({ value, label }))} width={w} height="28px" borderRadius="6px" />
  const sep = <span style={{ width: '1px', height: '14px', background: 'var(--border)', flexShrink: 0, margin: '0 8px' }} />

  const row1Keys: FeatureKey[] = ['sl', 'tsl', 'tp', 'ttp']
  const row2Keys: FeatureKey[] = ['wt', 'reentry']
  const row1 = FEATURES.filter(f => row1Keys.includes(f.key) && leg.active[f.key])
  const row2 = FEATURES.filter(f => row2Keys.includes(f.key) && leg.active[f.key])
  if (!row1.length && !row2.length) return null

  const renderFeat = (f: typeof FEATURES[0], idx: number) => (
    <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
      {idx > 0 && sep}
      <span style={{ fontSize: '10px', color: f.color, fontWeight: 700, marginRight: '2px' }}>{f.label}:</span>
      {f.key === 'sl' && (() => {
        if (entryType === 'orb') {
          const orbSlOpts: [string,string][] = [
            ['orb_low','ORB Low'],['orb_high','ORB High'],['orb_range','ORB Range'],
            ['orb_range_plus_pts','Range+pts'],['orb_range_minus_pts','Range-pts'],
            ['pts_instrument','Pts(I)'],['pct_instrument','%(I)'],['pts_underlying','Pts(U)'],['pct_underlying','%(U)']
          ]
          const ov = leg.vals.orb
          const uOrb = (sub: keyof typeof ov, val: any) => onUpdate(leg.id, { vals: { ...leg.vals, orb: { ...ov, [sub]: val } } })
          const needsBuf = ov.slType === 'orb_range_plus_pts' || ov.slType === 'orb_range_minus_pts'
          return <>
            <StaaxSelect value={ov.slType} onChange={v => uOrb('slType', v)} options={orbSlOpts.map(([value, label]) => ({ value, label }))} width="100px" height="28px" borderRadius="6px" />
            {needsBuf && (<>
              <input type="number" value={ov.bufferValue} onChange={e => uOrb('bufferValue', e.target.value)} placeholder="buf" style={{ ...inpSt, width: '44px' }} />
              <StaaxSelect value={ov.bufferUnit} onChange={v => uOrb('bufferUnit', v)} options={[{ value: 'pts', label: 'pts' }, { value: 'pct', label: '%' }]} width="52px" height="28px" borderRadius="6px" />
            </>)}
            {!ov.slType.startsWith('orb_') && inp('sl', 'value', 'val')}
          </>
        }
        return <>{sel('sl', 'type', [['pts_instrument','Pts(I)'],['pct_instrument','%(I)'],['pts_underlying','Pts(U)'],['pct_underlying','%(U)']], '88px')} {inp('sl', 'value', 'val')}</>
      })()}
      {f.key === 'tsl' && <>{inp('tsl', 'x', 'X')} <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>→</span> {inp('tsl', 'y', 'Y')} {sel('tsl', 'unit', [['pts','pts'],['pct','%']], '60px')}</>}
      {f.key === 'tp' && (() => {
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
            <StaaxSelect value={ov.tpType} onChange={v => uOrb('tpType', v)} options={orbTpOpts.map(([value, label]) => ({ value, label }))} width="100px" height="28px" borderRadius="6px" />
            {needsBuf && (<>
              <input type="number" value={ov.bufferValue} onChange={e => uOrb('bufferValue', e.target.value)} placeholder="buf" style={{ ...inpSt, width: '44px' }} />
              <StaaxSelect value={ov.bufferUnit} onChange={v => uOrb('bufferUnit', v)} options={[{ value: 'pts', label: 'pts' }, { value: 'pct', label: '%' }]} width="52px" height="28px" borderRadius="6px" />
            </>)}
            {!ov.tpType.startsWith('orb_') && inp('tp', 'value', 'val')}
          </>
        }
        return <>{sel('tp', 'type', [['pts_instrument','Pts(I)'],['pct_instrument','%(I)'],['pts_underlying','Pts(U)'],['pct_underlying','%(U)']], '88px')} {inp('tp', 'value', 'val')}</>
      })()}
      {f.key === 'ttp' && <>{inp('ttp', 'x', 'X')} <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>→</span> {inp('ttp', 'y', 'Y')} {sel('ttp', 'unit', [['pts','pts'],['pct','%']], '60px')}</>}
      {f.key === 'wt' && <>{sel('wt', 'direction', [['up','↑Up'],['down','↓Dn']], '72px')} {inp('wt', 'value', 'val')} {sel('wt', 'unit', [['pts','pts'],['pct','%']], '60px')}</>}
      {f.key === 'reentry' && <ReentryConfig rv={leg.vals.reentry} uRe={(sub, val) => onUpdate(leg.id, { vals: { ...leg.vals, reentry: { ...leg.vals.reentry, [sub]: val } } })} inpSt={inpSt} />}
    </div>
  )

  return (
    <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--border)' }}>
      {row1.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
          {row1.map((f, idx) => renderFeat(f, idx))}
        </div>
      )}
      {row2.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', marginTop: row1.length > 0 ? '8px' : '0' }}>
          {row2.map((f, idx) => renderFeat(f, idx))}
        </div>
      )}
    </div>
  )
}

function ReentryConfig({ rv, uRe, inpSt }: {
  rv: ReentryVals
  uRe: (sub: keyof ReentryVals, val: any) => void
  inpSt: React.CSSProperties
}) {
  const bSt = (on: boolean): React.CSSProperties => ({ height: '28px', padding: '0 9px', fontSize: 10, borderRadius: 6, cursor: 'pointer', background: 'var(--bg)', boxShadow: on ? 'var(--neu-inset)' : 'var(--neu-raised-sm)', color: on ? 'var(--accent)' : 'var(--text-dim)', border: 'none' })
  const Chk = ({ val, toggle }: { val: boolean; toggle: () => void }) => (
    <div onClick={toggle} style={{ width: 14, height: 14, borderRadius: 3, background: 'var(--bg)', boxShadow: val ? 'var(--neu-inset)' : 'var(--neu-raised-sm)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {val && <div style={{ width: 8, height: 8, borderRadius: 1, background: 'var(--accent)' }} />}
    </div>
  )
  const iSep = <span style={{ width: '1px', height: '14px', background: 'var(--border)', flexShrink: 0, margin: '0 4px' }} />
  return <>
    {(['re_entry', 're_execute'] as const).map(t => (
      <button key={t} type="button" onClick={() => uRe('type', t)} style={bSt(rv.type === t)}>
        {t === 're_entry' ? 'RE' : 'RE-Ex'}
      </button>
    ))}
    {rv.type === 're_entry' && <>{iSep}{(['ltp', 'candle_close'] as const).map(m => (
      <button key={m} type="button" onClick={() => uRe('ltpMode', m)} style={bSt(rv.ltpMode === m)}>
        {m === 'ltp' ? 'LTP' : 'Candle'}
      </button>
    ))}</>}
    {iSep}
    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--text-dim)', cursor: 'pointer' }} onClick={() => uRe('onSl', !rv.onSl)}>
      <Chk val={rv.onSl} toggle={() => uRe('onSl', !rv.onSl)} /> SL
    </span>
    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--text-dim)', cursor: 'pointer' }} onClick={() => uRe('onTp', !rv.onTp)}>
      <Chk val={rv.onTp} toggle={() => uRe('onTp', !rv.onTp)} /> TP
    </span>
    {(rv.onSl || rv.onTp) && iSep}
    {rv.onSl && (
      <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: 'var(--text-dim)' }}>
        SL:<input type="number" min={1} max={5} value={rv.maxSl} onChange={e => uRe('maxSl', e.target.value)} onBlur={e => { if (e.target.value !== '' && Number(e.target.value) < 1) uRe('maxSl', '1') }} style={{ ...inpSt, width: '52px', textAlign: 'center' }} />
      </span>
    )}
    {rv.onTp && (
      <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: 'var(--text-dim)' }}>
        TP:<input type="number" min={1} max={5} value={rv.maxTp} onChange={e => uRe('maxTp', e.target.value)} onBlur={e => { if (e.target.value !== '' && Number(e.target.value) < 1) uRe('maxTp', '1') }} style={{ ...inpSt, width: '52px', textAlign: 'center' }} />
      </span>
    )}
  </>
}

const TYPE_OPTS: [string,string][] = [['pts_instrument','Pts(I)'],['pct_instrument','%(I)'],['pts_underlying','Pts(U)'],['pct_underlying','%(U)']]

function JourneyChildPanel({ child, depth, onChange }: {
  child: JourneyChild; depth: number; onChange: (c: JourneyChild) => void
}) {
  const cs = { height: '28px', background: 'var(--bg)', boxShadow: 'var(--neu-inset)', border: 'none', borderRadius: '6px', fontSize: '11px', fontFamily: 'inherit', color: 'var(--text)', outline: 'none' as const, padding: '0 8px' }
  const csSt = { height: '28px', background: 'var(--bg)', boxShadow: 'var(--neu-inset)', border: 'none', borderRadius: '6px', color: 'var(--text)', fontSize: '11px', padding: '0 8px', fontFamily: 'inherit', outline: 'none' as const }
  const u = (k: keyof JourneyChild, v: any) => onChange({ ...child, [k]: v })

  // Auto-reset this child's trigger when its own SL/TP availability changes
  useEffect(() => {
    if (depth >= 3) return  // L3 has no child trigger to reset
    const childHasSL = !!(child.sl_enabled && parseFloat(child.sl_value) > 0)
    const childHasTP = !!(child.tp_enabled && parseFloat(child.tp_value) > 0)
    const t = child.trigger || 'either'
    const slInvalid = t === 'sl' && !childHasSL
    const tpInvalid = t === 'tp' && !childHasTP
    const eitherInvalid = t === 'either' && (!childHasSL || !childHasTP)
    if (slInvalid || tpInvalid || eitherInvalid) {
      const reset = childHasTP ? 'tp' : childHasSL ? 'sl' : 'either'
      onChange({ ...child, trigger: reset })
    }
  }, [child.sl_enabled, child.sl_value, child.tp_enabled, child.tp_value]) // eslint-disable-line react-hooks/exhaustive-deps
  const childExpiryOpts = MONTHLY_ONLY_CODES.has(child.instCode) ? MONTHLY_ONLY_EXPIRY : EXPIRY_OPTIONS
  const depthColor = depth === 1 ? '#CC4400' : depth === 2 ? '#F59E0B' : '#0ea66e'
  const depthLabel = depth === 1 ? 'Child' : depth === 2 ? 'Grandchild' : 'Great-grandchild'
  const tslBlocked = !child.sl_enabled || !child.sl_value
  const ttpBlocked = !child.tp_enabled || !child.tp_value
  return (
    <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--border)', borderLeft: `3px solid ${depthColor}`, paddingLeft: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '7px' }}>
        <span style={{ fontSize: '10px', fontWeight: 700, color: depthColor, textTransform: 'uppercase', letterSpacing: '0.05em' }}>L{depth} {depthLabel}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '11px', color: 'var(--text-dim)', cursor: 'pointer', marginLeft: 'auto' }} onClick={() => u('enabled', !child.enabled)}>
          <div style={{ width: 14, height: 14, borderRadius: 3, background: 'var(--bg)', boxShadow: child.enabled ? 'var(--neu-inset)' : 'var(--neu-raised-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {child.enabled && <div style={{ width: 8, height: 8, borderRadius: 1, background: depthColor }} />}
          </div>
          Enable
        </span>
      </div>
      {child.enabled && (<>
        {/* Row 1 — instrument config + feature chips inline */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', alignItems: 'center', marginBottom: '5px' }}>
          <button onClick={() => u('instType', child.instType === 'OP' ? 'FU' : 'OP')} style={{ height: '28px', padding: '0 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', color: 'var(--accent)', border: 'none', cursor: 'pointer' }}>{child.instType}</button>
          <StaaxSelect value={child.instCode} onChange={code => {
            const patch: Partial<JourneyChild> = { instCode: code }
            if (MONTHLY_ONLY_CODES.has(code) && !child.expiry.includes('monthly')) patch.expiry = 'current_monthly'
            onChange({ ...child, ...patch })
          }} options={Object.entries(INST_CODES).map(([c]) => ({ value: c, label: c }))} width="68px" height="28px" borderRadius="6px" />
          <button onClick={() => u('direction', child.direction === 'BUY' ? 'SELL' : 'BUY')} style={{ height: '28px', padding: '0 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', color: child.direction === 'BUY' ? '#0ea66e' : 'var(--red)', border: 'none', cursor: 'pointer' }}>{child.direction}</button>
          {child.instType === 'OP' && <button onClick={() => u('optType', child.optType === 'CE' ? 'PE' : 'CE')} style={{ height: '28px', padding: '0 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', color: 'var(--text-dim)', border: 'none', cursor: 'pointer' }}>{child.optType}</button>}
          {child.instType === 'OP' && <>
            <StaaxSelect value={child.expiry} onChange={v => u('expiry', v)} options={childExpiryOpts.map(o => ({ value: o.value, label: o.label }))} width="128px" height="28px" borderRadius="6px" />
            <StaaxSelect value={child.strikeMode} onChange={v => u('strikeMode', v)} options={[{ value: 'leg', label: 'Strike' }, { value: 'premium', label: 'Premium' }, { value: 'straddle', label: 'Straddle' }]} width="88px" height="28px" borderRadius="6px" />
            {child.strikeMode === 'leg' && <StaaxSelect value={child.strikeType} onChange={v => u('strikeType', v)} options={STRIKE_OPTIONS.map(st => ({ value: st.toLowerCase(), label: st }))} width="70px" height="28px" borderRadius="6px" />}
            {child.strikeMode === 'premium' && <input value={child.premiumVal} onChange={e => u('premiumVal', e.target.value)} placeholder="₹ premium" style={{ ...csSt, width: '82px' }} />}
            {child.strikeMode === 'straddle' && <StaaxSelect value={child.premiumVal || '20'} onChange={v => u('premiumVal', v)} options={[5,10,15,20,25,30,35,40,45,50,55,60].map(v => ({ value: String(v), label: `${v}%` }))} width="72px" height="28px" borderRadius="6px" />}
          </>}
          <input value={child.lots} onChange={e => u('lots', e.target.value)} type="number" min={1} placeholder="Lots" style={{ ...csSt, width: '56px', textAlign: 'center' }} />
          <span style={{ color: 'var(--border)', fontSize: '14px' }}>|</span>
          {[
            { key: 'sl_enabled',  label: 'SL',  color: '#FF4444' },
            { key: 'tsl_enabled', label: 'TSL', color: '#FF6B00', blocked: tslBlocked },
            { key: 'tp_enabled',  label: 'TP',  color: '#0ea66e' },
            { key: 'ttp_enabled', label: 'TTP', color: '#CC4400', blocked: ttpBlocked },
          ].map(f => (
            <button key={f.key} onClick={() => {
              if (f.blocked) return
              const newVal = !(child[f.key as keyof JourneyChild])
              const patch: Partial<JourneyChild> = { [f.key]: newVal }
              if (f.key === 'sl_enabled' && !newVal) patch.tsl_enabled = false
              if (f.key === 'tp_enabled' && !newVal) patch.ttp_enabled = false
              onChange({ ...child, ...patch })
            }} style={{ height: '28px', padding: '0 9px', borderRadius: '6px', fontSize: '10px', fontWeight: 600, cursor: f.blocked ? 'not-allowed' : 'pointer', border: 'none', transition: 'all 0.12s', background: 'var(--bg)', boxShadow: child[f.key as keyof JourneyChild] ? 'var(--neu-inset)' : 'var(--neu-raised-sm)', color: child[f.key as keyof JourneyChild] ? f.color : f.blocked ? 'var(--text-mute)' : 'var(--text-dim)', opacity: f.blocked ? 0.4 : 1 }}>
              {f.label}
            </button>
          ))}
          <span style={{ color: 'var(--border)', fontSize: '14px' }}>|</span>
          {[
            { key: 'wt_enabled', label: 'W&T', color: '#9CA3AF' },
            { key: 're_enabled', label: 'RE',  color: '#F59E0B' },
          ].map(f => (
            <button key={f.key} onClick={() => onChange({ ...child, [f.key]: !(child[f.key as keyof JourneyChild]) })}
              style={{ height: '28px', padding: '0 9px', borderRadius: '6px', fontSize: '10px', fontWeight: 600, cursor: 'pointer', border: 'none', transition: 'all 0.12s', background: 'var(--bg)', boxShadow: child[f.key as keyof JourneyChild] ? 'var(--neu-inset)' : 'var(--neu-raised-sm)', color: child[f.key as keyof JourneyChild] ? f.color : 'var(--text-dim)' }}>
              {f.label}
            </button>
          ))}
        </div>
        {/* Row 3 — feature values, split: Row1=SL/TSL/TP/TTP, Row2=W&T/RE */}
        {(child.sl_enabled || child.tsl_enabled || child.tp_enabled || child.ttp_enabled || child.wt_enabled || child.re_enabled) && (() => {
            const withSeps = (items: (React.ReactElement | false)[]) => {
              const filtered = items.filter(Boolean) as React.ReactElement[]
              return filtered.flatMap((el, i) => i === 0 ? [el] : [<span key={`cs${i}`} style={{ width: '1px', height: '14px', background: 'var(--border)', flexShrink: 0, margin: '0 8px' }} />, el])
            }
            const row1Items = withSeps([
              child.sl_enabled && (
                <div key="sl" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ fontSize: '10px', color: '#FF4444', fontWeight: 700, marginRight: '2px' }}>SL:</span>
                  <StaaxSelect value={child.sl_type} onChange={v => u('sl_type', v)} options={TYPE_OPTS.map(([value, label]) => ({ value, label }))} width="88px" height="28px" borderRadius="6px" />
                  <input type="number" min="1" value={child.sl_value} onChange={e => u('sl_value', e.target.value)} onBlur={e => { if (e.target.value !== '' && Number(e.target.value) < 1) u('sl_value', '1') }} placeholder="val" style={{ ...csSt, width: '46px' }} />
                </div>
              ),
              child.tsl_enabled && (
                <div key="tsl" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ fontSize: '10px', color: '#FF6B00', fontWeight: 700, marginRight: '2px' }}>TSL:</span>
                  <input type="number" min="1" value={child.tsl_x} onChange={e => u('tsl_x', e.target.value)} onBlur={e => { if (e.target.value !== '' && Number(e.target.value) < 1) u('tsl_x', '1') }} placeholder="X" style={{ ...cs, width: '40px' }} />
                  <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>→</span>
                  <input type="number" min="1" value={child.tsl_y} onChange={e => u('tsl_y', e.target.value)} onBlur={e => { if (e.target.value !== '' && Number(e.target.value) < 1) u('tsl_y', '1') }} placeholder="Y" style={{ ...cs, width: '40px' }} />
                  <StaaxSelect value={child.tsl_unit} onChange={v => u('tsl_unit', v)} options={[{ value: 'pts', label: 'pts' }, { value: 'pct', label: '%' }]} width="60px" height="28px" borderRadius="6px" />
                </div>
              ),
              child.tp_enabled && (
                <div key="tp" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ fontSize: '10px', color: '#0ea66e', fontWeight: 700, marginRight: '2px' }}>TP:</span>
                  <StaaxSelect value={child.tp_type} onChange={v => u('tp_type', v)} options={TYPE_OPTS.map(([value, label]) => ({ value, label }))} width="88px" height="28px" borderRadius="6px" />
                  <input type="number" min="1" value={child.tp_value} onChange={e => u('tp_value', e.target.value)} onBlur={e => { if (e.target.value !== '' && Number(e.target.value) < 1) u('tp_value', '1') }} placeholder="val" style={{ ...csSt, width: '46px' }} />
                </div>
              ),
              child.ttp_enabled && (
                <div key="ttp" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ fontSize: '10px', color: '#CC4400', fontWeight: 700, marginRight: '2px' }}>TTP:</span>
                  <input type="number" min="1" value={child.ttp_x} onChange={e => u('ttp_x', e.target.value)} onBlur={e => { if (e.target.value !== '' && Number(e.target.value) < 1) u('ttp_x', '1') }} placeholder="X" style={{ ...cs, width: '40px' }} />
                  <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>→</span>
                  <input type="number" min="1" value={child.ttp_y} onChange={e => u('ttp_y', e.target.value)} onBlur={e => { if (e.target.value !== '' && Number(e.target.value) < 1) u('ttp_y', '1') }} placeholder="Y" style={{ ...cs, width: '40px' }} />
                  <StaaxSelect value={child.ttp_unit} onChange={v => u('ttp_unit', v)} options={[{ value: 'pts', label: 'pts' }, { value: 'pct', label: '%' }]} width="60px" height="28px" borderRadius="6px" />
                </div>
              ),
            ])
            const row2Items = withSeps([
              child.wt_enabled && (
                <div key="wt" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ fontSize: '10px', color: '#9CA3AF', fontWeight: 700, marginRight: '2px' }}>W&T:</span>
                  <StaaxSelect value={child.wt_direction} onChange={v => u('wt_direction', v)} options={[{ value: 'up', label: '↑Up' }, { value: 'down', label: '↓Dn' }]} width="72px" height="28px" borderRadius="6px" />
                  <input type="number" min="1" value={child.wt_value} onChange={e => u('wt_value', e.target.value)} onBlur={e => { if (e.target.value !== '' && Number(e.target.value) < 1) u('wt_value', '1') }} placeholder="val" style={{ ...csSt, width: '46px' }} />
                  <StaaxSelect value={child.wt_unit} onChange={v => u('wt_unit', v)} options={[{ value: 'pts', label: 'pts' }, { value: 'pct', label: '%' }]} width="60px" height="28px" borderRadius="6px" />
                </div>
              ),
              child.re_enabled && (
                <div key="re" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ fontSize: '10px', color: '#F59E0B', fontWeight: 700, marginRight: '2px' }}>RE:</span>
                  <ReentryConfig rv={child.reentry} uRe={(sub, val) => u('reentry', { ...child.reentry, [sub]: val })} inpSt={csSt} />
                </div>
              ),
            ])
            if (!row1Items.length && !row2Items.length) return null
            return (
              <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--border)' }}>
                {row1Items.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px' }}>
                    {row1Items}
                  </div>
                )}
                {row2Items.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px', marginTop: row1Items.length > 0 ? '8px' : '0' }}>
                    {row2Items}
                  </div>
                )}
              </div>
            )
          })()}
        {depth < 3 && (() => {
          // Trigger selector: controls what exit of THIS child spawns its own grandchild
          // Availability is based on THIS child's own SL/TP config
          const childHasSL = !!(child.sl_enabled && parseFloat(child.sl_value) > 0)
          const childHasTP = !!(child.tp_enabled && parseFloat(child.tp_value) > 0)
          const childTrigger = child.trigger || 'either'
          return (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--border)' }}>
                <span style={{ fontSize: '10px', color: 'var(--text-dim)', fontWeight: 600, marginRight: '2px' }}>Trigger on:</span>
                {JOURNEY_TRIGGER_OPTS.map(opt => {
                  const active = childTrigger === opt.value
                  const isDisabled = (opt.value === 'sl' && !childHasSL) || (opt.value === 'tp' && !childHasTP) || (opt.value === 'either' && (!childHasSL || !childHasTP))
                  return (
                    <button
                      key={opt.value}
                      onClick={() => { if (!isDisabled) u('trigger', opt.value) }}
                      title={isDisabled ? `Enable ${opt.label} on this leg to use this trigger` : undefined}
                      style={{
                        height: '24px', padding: '0 8px', borderRadius: '5px', fontSize: '10px', fontWeight: 600,
                        border: 'none', transition: 'all 0.12s',
                        background: 'var(--bg)',
                        boxShadow: active ? 'var(--neu-inset)' : 'var(--neu-raised-sm)',
                        color: active ? opt.color : 'var(--text-dim)',
                        opacity: isDisabled ? 0.35 : 1,
                        cursor: isDisabled ? 'not-allowed' : 'pointer',
                        pointerEvents: isDisabled ? 'none' : 'auto',
                      }}
                    >
                      {opt.label}
                    </button>
                  )
                })}
              </div>
              <JourneyChildPanel child={child.child || mkJourneyChild()} depth={depth + 1} onChange={c => u('child', c)} />
            </>
          )
        })()}
      </>)}
    </div>
  )
}

const JOURNEY_TRIGGER_OPTS: { value: string; label: string; color: string }[] = [
  { value: 'sl',     label: 'SL Hit',  color: '#FF4444' },
  { value: 'tp',     label: 'TP Hit',  color: '#0ea66e' },
  { value: 'either', label: 'Either',  color: '#A78BFA' },
]

function JourneyPanel({ leg, onUpdate }: { leg: Leg; onUpdate: (id: string, u: Partial<Leg>) => void }) {
  const [open, setOpen] = useState(false)
  const j = leg.journey || mkJourneyChild()
  const hasJourney = j.enabled

  // Parent leg SL/TP availability
  const parentHasSL = !!(leg.active.sl && leg.vals.sl.type && parseFloat(leg.vals.sl.value) > 0)
  const parentHasTP = !!(leg.active.tp && leg.vals.tp.type && parseFloat(leg.vals.tp.value) > 0)

  const currentTrigger = leg.journey_trigger || 'either'

  // Auto-reset trigger when parent SL/TP availability changes
  useEffect(() => {
    if (!hasJourney) return
    const t = leg.journey_trigger || 'either'
    const slInvalid = t === 'sl' && !parentHasSL
    const tpInvalid = t === 'tp' && !parentHasTP
    const eitherInvalid = t === 'either' && (!parentHasSL || !parentHasTP)
    if (slInvalid || tpInvalid || eitherInvalid) {
      const reset = parentHasTP ? 'tp' : parentHasSL ? 'sl' : 'either'
      onUpdate(leg.id, { journey_trigger: reset })
    }
  }, [leg.active.sl, leg.vals.sl.value, leg.active.tp, leg.vals.tp.value]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px solid var(--border)' }}>
      <button onClick={() => setOpen((o: boolean) => !o)} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', padding: '2px 0' }}>
        <span style={{ fontSize: '10px', fontWeight: 700, color: hasJourney ? '#CC4400' : 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {open ? '▾' : '▸'} Journey {hasJourney ? '● Active' : ''}
        </span>
      </button>
      {open && (<>
        {hasJourney && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', margin: '5px 0 4px' }}>
            <span style={{ fontSize: '10px', color: 'var(--text-dim)', fontWeight: 600, marginRight: '2px' }}>Trigger on:</span>
            {JOURNEY_TRIGGER_OPTS.map(opt => {
              const active = currentTrigger === opt.value
              const isDisabled = (opt.value === 'sl' && !parentHasSL) || (opt.value === 'tp' && !parentHasTP) || (opt.value === 'either' && (!parentHasSL || !parentHasTP))
              return (
                <button
                  key={opt.value}
                  onClick={() => { if (!isDisabled) onUpdate(leg.id, { journey_trigger: opt.value }) }}
                  title={isDisabled ? `Enable ${opt.label} on parent leg to use this trigger` : undefined}
                  style={{
                    height: '28px', padding: '0 10px', borderRadius: '6px', fontSize: '10px', fontWeight: 600,
                    border: 'none', transition: 'all 0.12s',
                    background: 'var(--bg)',
                    boxShadow: active ? 'var(--neu-inset)' : 'var(--neu-raised-sm)',
                    color: active ? opt.color : 'var(--text-dim)',
                    opacity: isDisabled ? 0.35 : 1,
                    cursor: isDisabled ? 'not-allowed' : 'pointer',
                    pointerEvents: isDisabled ? 'none' : 'auto',
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
  const sInp = { height: '28px', background: 'var(--bg)', boxShadow: 'var(--neu-inset)', border: 'none', borderRadius: '6px', color: 'var(--text)', fontSize: '11px', padding: '0 8px', fontFamily: 'inherit', outline: 'none' as const }
  const expiryOpts = MONTHLY_ONLY_CODES.has(leg.instCode) ? MONTHLY_ONLY_EXPIRY : EXPIRY_OPTIONS

  return (
    <div style={{ background: 'var(--bg)', boxShadow: isDragging ? 'var(--neu-inset)' : 'var(--neu-raised)', borderRadius: '16px', padding: '14px 16px', marginBottom: '10px', opacity: isDragging ? 0.7 : 1, transition: 'box-shadow 0.1s' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
        <span {...dragHandleProps} title="Drag to reorder" style={{ cursor: 'grab', color: 'var(--text-dim)', fontSize: '13px', flexShrink: 0, padding: '0 2px', userSelect: 'none' }}>⠿</span>
        <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-dim)', minWidth: '20px', textAlign: 'center' }}>L{leg.no}</span>
        <button onClick={() => u('instType', leg.instType === 'OP' ? 'FU' : 'OP')} style={{ height: '28px', padding: '0 9px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', color: 'var(--accent)', border: 'none', cursor: 'pointer', flexShrink: 0 }}>{leg.instType}</button>
        <StaaxSelect value={leg.instCode} onChange={code => {
          const patch: Partial<Leg> = { instCode: code }
          if (MONTHLY_ONLY_CODES.has(code) && !leg.expiry.includes('monthly')) patch.expiry = 'current_monthly'
          onUpdate(leg.id, patch)
        }} options={Object.entries(INST_CODES).map(([c, n]) => ({ value: c, label: c + (n ? '' : '') }))} width="68px" height="28px" borderRadius="6px" />
        <button onClick={() => u('direction', leg.direction === 'BUY' ? 'SELL' : 'BUY')} style={{ height: '28px', padding: '0 9px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', color: leg.direction === 'BUY' ? '#0ea66e' : 'var(--sem-short)', border: 'none', cursor: 'pointer', flexShrink: 0 }}>{leg.direction}</button>
        {leg.instType === 'OP' && <button onClick={() => u('optType', leg.optType === 'CE' ? 'PE' : 'CE')} style={{ height: '28px', padding: '0 9px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', color: 'var(--text-dim)', border: 'none', cursor: 'pointer', flexShrink: 0 }}>{leg.optType}</button>}
        {leg.instType === 'OP' && <>
          <StaaxSelect value={leg.expiry} onChange={v => u('expiry', v)} options={expiryOpts.map(o => ({ value: o.value, label: o.label }))} width="128px" height="28px" borderRadius="6px" />
          <StaaxSelect value={leg.strikeMode} onChange={v => { u('strikeMode', v); if (v === 'straddle' && !leg.premiumVal) u('premiumVal', '20') }} options={[{ value: 'leg', label: 'Strike' }, { value: 'premium', label: 'Premium' }, { value: 'straddle', label: 'Straddle' }]} width="88px" height="28px" borderRadius="6px" />
          {leg.strikeMode === 'leg' && <StaaxSelect value={leg.strikeType} onChange={v => u('strikeType', v)} options={STRIKE_OPTIONS.map(st => ({ value: st.toLowerCase(), label: st }))} width="70px" height="28px" borderRadius="6px" />}
          {leg.strikeMode === 'premium' && <input value={leg.premiumVal} onChange={e => u('premiumVal', e.target.value)} placeholder="₹ premium" style={{ ...sInp, width: '82px' }} />}
          {leg.strikeMode === 'straddle' && <StaaxSelect value={leg.premiumVal || '20'} onChange={v => u('premiumVal', v)} options={[5,10,15,20,25,30,35,40,45,50,55,60].map(v => ({ value: String(v), label: `${v}%` }))} width="72px" height="28px" borderRadius="6px" />}
        </>}
        <input value={leg.lots} onChange={e => u('lots', e.target.value)} type="number" min={1} placeholder="Lots" style={{ ...sInp, width: '56px', textAlign: 'center', color: 'var(--text)' }} />
        <span style={{ color: 'var(--border)', fontSize: '14px', flexShrink: 0 }}>|</span>
        {FEATURES.filter(f => ['sl','tsl','tp','ttp'].includes(f.key)).map(f => {
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
            }} style={{ height: '28px', padding: '0 11px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, cursor: blocked ? 'not-allowed' : 'pointer', border: 'none', transition: 'all 0.12s', flexShrink: 0, background: 'var(--bg)', boxShadow: leg.active[f.key] ? 'var(--neu-inset)' : 'var(--neu-raised-sm)', color: leg.active[f.key] ? f.color : blocked ? 'var(--text-mute)' : 'var(--text-dim)', opacity: blocked ? 0.4 : 1 }}>
              {f.label}
            </button>
          )
        })}
        <span style={{ color: 'var(--border)', fontSize: '14px', flexShrink: 0 }}>|</span>
        {FEATURES.filter(f => ['wt','reentry'].includes(f.key)).map(f => (
          <button key={f.key} onClick={() => {
            const newActive = { ...leg.active, [f.key]: !leg.active[f.key] }
            onUpdate(leg.id, { active: newActive })
          }} style={{ height: '28px', padding: '0 11px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', border: 'none', transition: 'all 0.12s', flexShrink: 0, background: 'var(--bg)', boxShadow: leg.active[f.key] ? 'var(--neu-inset)' : 'var(--neu-raised-sm)', color: leg.active[f.key] ? f.color : 'var(--text-dim)' }}>
            {f.label}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', flexShrink: 0 }}>
          <button onClick={() => onCopy(leg.id)} title="Copy leg"
            style={{ height: '28px', width: '28px', background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', border: 'none', color: 'var(--text-dim)', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 150ms ease', flexShrink: 0 }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-dim)' }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="4.083" y="4.083" width="8.167" height="8.167" rx="1.167" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M2.333 9.917H1.75A.583.583 0 011.167 9.333V1.75A.583.583 0 011.75 1.167h7.583a.583.583 0 01.584.583v.583" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
          </button>
          <button onClick={() => onRemove(leg.id)} title="Remove leg" style={{ height: '28px', padding: '0 9px', background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', border: 'none', color: '#FF4444', borderRadius: '6px', fontSize: '11px', cursor: 'pointer' }}>✕</button>
        </div>
      </div>
      {entryType === 'orb' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
          <span style={{ fontSize: '10px', color: 'var(--text-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Entry At</span>
          {(['high','low'] as const).map(ea => (
            <button key={ea} type="button"
              onClick={() => onUpdate(leg.id, { vals: { ...leg.vals, orb: { ...leg.vals.orb, entryAt: ea } } })}
              style={{ height: '28px', padding: '0 8px', borderRadius: '6px', cursor: 'pointer', fontSize: '10px', fontWeight: 600, border: 'none', background: 'var(--bg)', boxShadow: leg.vals.orb.entryAt === ea ? 'var(--neu-inset)' : 'var(--neu-raised-sm)', color: leg.vals.orb.entryAt === ea ? 'var(--accent)' : 'var(--text-dim)' }}>
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
      fontSize: '10px', fontWeight: 700, color: 'var(--text-mute)',
      textTransform: 'uppercase', letterSpacing: '1.5px',
      marginBottom: '10px', marginTop: '6px', paddingBottom: '6px',
      borderBottom: '1px solid var(--border)',
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
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'var(--bg)', boxShadow: 'var(--neu-inset)', border: 'none', borderRadius: '6px', height: '28px', padding: '0 7px', boxSizing: 'border-box' }}>
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
          colorScheme: 'inherit',
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

const UNDERLYING_TO_CODE: Record<string, string> = {
  NIFTY: 'NF', BANKNIFTY: 'BN', SENSEX: 'SX',
  MIDCPNIFTY: 'MN', MIDCAPNIFTY: 'MN', FINNIFTY: 'FN',
  GOLDM: 'GOLDM', SILVERMIC: 'SILVERMIC',
}

export default function AlgoPage() {
  const navigate        = useNavigate()
  const location        = useLocation()
  const { id }          = useParams<{ id: string }>()
  const isPractixMode   = useStore(s => s.isPractixMode)
  const isEdit      = !!id
  // Account list — populated from API on mount
  const [accountOptions, setAccountOptions] = useState<{ id: string; label: string }[]>([])
  const [showAI,         setShowAI]         = useState(false)

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
    initSounds()
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
        // Apply AI config on top of loaded algo (edit via AI from GridPage)
        if (location.state?.aiConfig) {
          applyAIConfig(location.state.aiConfig, location.state.accountId, location.state.days)
          window.history.replaceState({}, '')
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

  // ── AI config application ────────────────────────────────────────────────────
  function applyAIConfig(config: any, accountId?: string | null, days?: string[]) {
    const code = UNDERLYING_TO_CODE[config.underlying?.toUpperCase() || ''] || 'NF'
    if (config.algo_name)     setAlgoName(config.algo_name)
    if (config.strategy_mode) setStratMode(config.strategy_mode)
    if (config.entry_type)    setEntryType(config.entry_type)
    if (config.entry_time) {
      const t = config.entry_time
      setEntryTime(t.length === 5 ? `${t}:00` : t)
    }
    if (config.exit_time) {
      const t = config.exit_time
      setExitTime(t.length === 5 ? `${t}:00` : t)
    }
    if (accountId) setAccount(accountId)
    if (days?.length) setRecurringDays(days.map((d: string) => d.toUpperCase()))
    if (config.mtm_sl != null) setMtmSL(String(config.mtm_sl))
    if (config.mtm_tp != null) setMtmTP(String(config.mtm_tp))
    if (config.mtm_unit)       setMtmUnit(config.mtm_unit)

    if (Array.isArray(config.legs) && config.legs.length > 0) {
      const mapped: Leg[] = config.legs.map((l: any, i: number) => {
        const isOpt   = l.instrument !== 'fut'
        let strikeMode = 'leg'
        let strikeType = (l.strike_type || 'atm').toLowerCase()
        let premiumVal = ''
        if (l.strike_type === 'premium') {
          strikeMode = 'premium'; strikeType = 'atm'
          premiumVal = l.strike_value != null ? String(l.strike_value) : ''
        } else if (l.strike_type === 'otm' && l.strike_value) {
          strikeType = `OTM${l.strike_value}`
        } else if (l.strike_type === 'itm' && l.strike_value) {
          strikeType = `ITM${l.strike_value}`
        }
        const base = mkLeg(i + 1)
        return {
          ...base,
          instType:   isOpt ? 'OP' : 'FU',
          instCode:   code,
          direction:  (l.direction || 'buy').toUpperCase(),
          optType:    isOpt ? (l.instrument || 'ce').toUpperCase() : 'CE',
          strikeMode, strikeType, premiumVal,
          lots:       String(config.lots || l.lots || 1),
          expiry:     l.expiry || 'current_weekly',
          active: { ...base.active, sl: !!l.sl_enabled, tsl: !!l.tsl_enabled, tp: !!l.tp_enabled, wt: !!l.wt_enabled },
          vals: {
            ...base.vals,
            sl:  { type: l.sl_type  || 'pts_instrument', value: l.sl_value  != null ? String(l.sl_value)  : '' },
            tsl: { x: l.tsl_x != null ? String(l.tsl_x) : '', y: l.tsl_y != null ? String(l.tsl_y) : '', unit: 'pts' },
            tp:  { type: 'pts_instrument',               value: l.tp_value  != null ? String(l.tp_value)  : '' },
            wt:  { direction: 'up', value: l.wt_value != null ? String(l.wt_value) : '', unit: l.wt_unit || 'pts' },
          },
        }
      })
      setLegs(mapped)
    }
  }

  // Apply AI config from navigation state (new algo)
  useEffect(() => {
    if (!isEdit && location.state?.aiConfig) {
      applyAIConfig(location.state.aiConfig, location.state.accountId, location.state.days)
      window.history.replaceState({}, '')
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
    if (!algoName.trim())            return fail('Algo name is required')
    if (!account)                    return fail('Account is required — select a broker account')
    if (!lotMult || parseInt(lotMult) < 1) return fail('Lot multiplier must be at least 1')
    if (!entryTime)                  return fail('Entry time is required')
    if (!exitTime)                   return fail('Exit time is required')
    if (entryTime < TIME_MIN || entryTime > TIME_MAX) return fail(`Entry time must be between 09:15 and 15:30 (got ${entryTime})`)
    if (!['stbt','btst'].includes(stratMode) && (exitTime < TIME_MIN || exitTime > TIME_MAX)) return fail(`Exit time must be between 09:15 and 15:30 (got ${exitTime})`)
    if (stratMode === 'intraday' && exitTime <= entryTime) return fail('Exit time must be after entry time for Intraday')
    if (entryType === 'orb' && !orbEnd) return fail('ORB End time is required when entry type is ORB')
    if (entryType === 'orb' && orbEnd <= entryTime) return fail('ORB end time must be after ORB start (entry) time')
    if (stratMode === 'positional' && !dte) return fail('DTE is required for Positional strategy')
    if (legs.length === 0) return fail('At least one leg is required')
    // ── Leg-level fields ──────────────────────────────────────────────────────
    for (const leg of legs) {
      const L = `Leg ${leg.no}`
      if (!leg.lots || parseInt(leg.lots) < 1) return fail(`${L}: Lots is required — enter number of lots`)
      if (leg.instType === 'OP') {
        if (!leg.expiry)    return fail(`${L}: Expiry is required`)
        if (!leg.strikeMode) return fail(`${L}: Strike mode is required`)
        if (leg.strikeMode === 'premium' && !leg.premiumVal) return fail(`${L}: Premium value is required when mode is Premium`)
        if (leg.strikeMode === 'straddle' && !leg.premiumVal) return fail(`${L}: Straddle % is required when mode is Straddle`)
      }
      for (const feat of FEATURES) {
        if (leg.active[feat.key]) {
          const vals = leg.vals[feat.key] as any
          const hasValue = Object.values(vals).some((v: any) => v !== '' && v !== undefined)
          if (!hasValue) return fail(`${L}: ${feat.label} is enabled but values are missing`)
        }
      }
      const slType = (leg.vals.sl as any).type || ''
      if (entryType !== 'orb') {
        if (leg.active['sl'] && !['orb_high','orb_low'].includes(slType) && !(leg.vals.sl as any).value) return fail(`${L}: SL value is required when SL is enabled`)
        if (leg.active['tp'] && !(leg.vals.tp as any).value) return fail(`${L}: TP value is required when TP is enabled`)
      }
      if (leg.active['wt'] && !(leg.vals.wt as any).value) return fail(`${L}: W&T value is required when W&T is enabled`)
      if (leg.active['tsl'] && (!leg.active['sl'] || !(leg.vals.sl as any).value)) return fail(`${L}: TSL requires SL to be enabled with a value`)
      if (leg.active['ttp'] && (!leg.active['tp'] || !(leg.vals.tp as any).value)) return fail(`${L}: TTP requires TP to be enabled with a value`)
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
      wt_enabled:   l.active.wt,
      wt_direction: l.active.wt ? l.vals.wt.direction : null,
      wt_value:     l.active.wt ? (parseFloat(l.vals.wt.value) || undefined) : null,
      wt_unit:      l.active.wt ? l.vals.wt.unit : null,
      sl_type:      l.active.sl && entryType !== 'orb' ? l.vals.sl.type  : null,
      sl_value:     l.active.sl && entryType !== 'orb' ? parseFloat(l.vals.sl.value) || null : null,
      tp_type:      l.active.tp && entryType !== 'orb' ? l.vals.tp.type  : null,
      tp_value:     l.active.tp && entryType !== 'orb' ? parseFloat(l.vals.tp.value) || null : null,
      tsl_x:        l.active.tsl ? parseFloat(l.vals.tsl.x) || null : null,
      tsl_y:        l.active.tsl ? parseFloat(l.vals.tsl.y) || null : null,
      tsl_unit:     l.active.tsl ? l.vals.tsl.unit : null,
      ttp_x:        l.active.ttp ? parseFloat(l.vals.ttp.x) || null : null,
      ttp_y:        l.active.ttp ? parseFloat(l.vals.ttp.y) || null : null,
      ttp_unit:     l.active.ttp ? l.vals.ttp.unit : null,
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
      journey_config:  l.journey?.enabled ? buildJourneyConfig(l.journey) : null,
      journey_trigger: l.active.sl && l.active.tp ? (l.journey_trigger || 'either') : 'either',
    })),
  })
    return payload
  }

  const buildJourneyConfig = (j?: JourneyChild, depth = 1): any => {
    if (!j || !j.enabled || depth > 3) return null
    return {
      level: depth, trigger: 'any',
      child: {
        instrument: j.instType === 'FU' ? 'fu' : j.optType.toLowerCase(),
        underlying: INST_CODES[j.instCode] || j.instCode,
        direction: j.direction.toLowerCase(),
        strike_type: j.strikeType, expiry: j.expiry,
        lots: parseInt(j.lots) || 1,
        wt_enabled:   j.wt_enabled,
        wt_direction: j.wt_enabled ? j.wt_direction : null,
        wt_value:     j.wt_enabled ? (parseFloat(j.wt_value) || null) : null,
        wt_unit:      j.wt_enabled ? j.wt_unit : null,
        sl_type:      j.sl_enabled ? j.sl_type  : null,
        sl_value:     j.sl_enabled ? (parseFloat(j.sl_value) || null) : null,
        tp_type:      j.tp_enabled ? j.tp_type  : null,
        tp_value:     j.tp_enabled ? (parseFloat(j.tp_value) || null) : null,
        tsl_enabled:  j.tsl_enabled,
        tsl_x:        j.tsl_enabled ? (parseFloat(j.tsl_x) || null) : null,
        tsl_y:        j.tsl_enabled ? (parseFloat(j.tsl_y) || null) : null,
        tsl_unit:     j.tsl_enabled ? j.tsl_unit : null,
        ttp_enabled:  j.ttp_enabled,
        ttp_x:        j.ttp_enabled ? (parseFloat(j.ttp_x) || null) : null,
        ttp_y:        j.ttp_enabled ? (parseFloat(j.ttp_y) || null) : null,
        ttp_unit:     j.ttp_enabled ? j.ttp_unit : null,
        reentry_on_sl:   j.re_enabled ? j.reentry.onSl  : false,
        reentry_on_tp:   j.re_enabled ? j.reentry.onTp  : false,
        reentry_max:     j.re_enabled ? (parseInt(j.reentry.maxSl) || 0) : 0,
        reentry_ltp_mode: j.re_enabled ? j.reentry.ltpMode : null,
        trigger:         j.trigger || 'either',   // what exit of THIS child spawns grandchild
        journey_config: j.child?.enabled ? buildJourneyConfig(j.child, depth + 1) : null,
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
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '22px', fontWeight: 800, color: 'var(--accent)' }}>{algoName || 'Edit Algo'}</h1>
          <div className="page-header-actions">
            <button onClick={() => navigate('/grid')} style={{ height: '34px', padding: '0 18px', borderRadius: '100px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', border: 'none', background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', color: 'var(--text-dim)' }}>← Back to Algos</button>
          </div>
        </div>
        <div style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)', borderRadius: '14px', padding: '20px 24px', textAlign: 'center', borderLeft: '3px solid #FF4444' }}>
          <div style={{ marginBottom: '8px' }}><LockSimple size={24} weight="fill" color="var(--text-dim)" /></div>
          <div style={{ fontWeight: 700, fontSize: '16px', color: 'var(--red)', marginBottom: '6px' }}>Algo is live — editing locked</div>
          <div style={{ fontSize: '13px', color: 'var(--text-dim)', lineHeight: 1.6 }}>
            <strong>{algoName}</strong> has an active trade today.<br />
            Editing is only allowed during off-market hours.<br />
            Any changes made will apply from the next trading day.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="algo-page" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 28px 24px' }}>
      {/* AI Algo Assistant modal */}
      {showAI && (
        <AlgoAIAssistant
          mode={isEdit ? 'edit' : 'create'}
          existingAlgo={isEdit ? { name: algoName, strategy_mode: stratMode, et: entryTime, xt: exitTime, legs: [] } : undefined}
          accounts={accountOptions.map(a => ({ id: a.id, nickname: a.label.split(' (')[0], broker: a.label.includes('Zerodha') ? 'zerodha' : 'angel' }))}
          onComplete={(config, accountId, days) => {
            setShowAI(false)
            applyAIConfig(config, accountId, days)
          }}
          onClose={() => setShowAI(false)}
        />
      )}
      <style>{`
        .staax-time-input::-webkit-calendar-picker-indicator { display: none !important; opacity: 0 !important; width: 0 !important; }
        .staax-time-input::-webkit-inner-spin-button { display: none !important; }
        .staax-time-input::-webkit-datetime-edit-ampm-field { display: none !important; }
        .staax-time-input::-webkit-datetime-edit-fields-wrapper { padding: 0; }
        .staax-time-input { line-height: 30px; }
        .algo-page .staax-input { background: var(--bg) !important; box-shadow: var(--neu-inset) !important; border: none !important; border-radius: 8px !important; color: var(--text) !important; }
        .algo-page .staax-input::placeholder { color: var(--text-dim) !important; }
        .algo-page .staax-input:hover:not(:focus), .algo-page .staax-input:focus { box-shadow: var(--neu-inset) !important; border: none !important; }
        .staax-select option { background: var(--bg); color: var(--text); }
        .leg-select-dim { color: var(--text-dim) !important; }
        .leg-select-active { color: var(--text) !important; }
      `}</style>
      <div className="page-header">
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '22px', fontWeight: 800, color: 'var(--accent)' }}>{algoName || (isEdit ? 'Edit Algo' : 'New Algo')}</h1>
        <div className="page-header-actions">
          {isDirty    && <span style={{ fontSize: '11px', color: 'var(--accent-amber)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--accent-amber)', flexShrink: 0 }} />Unsaved changes</span>}
          {saved      && <span style={{ fontSize: '12px', color: 'var(--green)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}><CheckCircle size={12} weight="fill" color="var(--green)" /> Saved!</span>}
          {saveError  && <span style={{ fontSize: '12px', color: 'var(--red)' }}>{saveError}</span>}
          <button onClick={() => { sounds.click(); setShowAI(true) }} style={{ height: '34px', padding: '0 14px', borderRadius: '100px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', border: 'none', background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 5 }}>
            <Sparkle size={13} weight="fill" color="var(--accent)" />
            Describe
          </button>
          <button onClick={() => { sounds.click(); navigate('/grid') }} style={{ height: '34px', padding: '0 18px', borderRadius: '100px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', border: 'none', background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', color: 'var(--text-dim)' }}>Cancel</button>
          <button onClick={() => { sounds.click(); handleSave() }} disabled={saving} style={{ height: '34px', padding: '0 18px', borderRadius: '100px', fontSize: '12px', fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', border: 'none', background: 'var(--bg)', boxShadow: saving ? 'var(--neu-inset)' : 'var(--neu-raised-sm)', color: '#0ea66e', opacity: saving ? 0.7 : 1 }}>{saving ? 'Saving...' : (isEdit ? 'Update Algo' : 'Save Algo')}</button>
        </div>
      </div>

      {toast && (
        <div style={{ position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)', background: 'var(--bg)', boxShadow: 'var(--neu-raised)', borderRadius: '100px', padding: '10px 18px', fontSize: '12px', color: '#FF4444', fontWeight: 600, zIndex: 9999, pointerEvents: 'none', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Warning size={13} weight="fill" color="#F59E0B" style={{ flexShrink: 0 }} /> {toast}
        </div>
      )}
      {/* F6 — tomorrow warning */}
      {showTomorrowWarn && (
        <div style={{ background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', borderRadius: '14px', borderLeft: '3px solid #F59E0B', padding: '14px 16px', marginBottom: '12px' }}>
          <div style={{ fontWeight: 700, color: 'var(--accent-amber)', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: 6 }}><Warning size={13} weight="fill" color="#F59E0B" style={{ flexShrink: 0 }} /> Changes apply from tomorrow</div>
          <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginBottom: '10px' }}>
            This algo may be deployed in today's grid. Changes you save will NOT affect today's trades — they will apply from the next trading day onward.
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-ghost" onClick={() => setShowTomorrowWarn(false)}>Cancel</button>
            <button className="btn btn-warn" onClick={handleSave}>Save Anyway</button>
          </div>
        </div>
      )}

      {/* Identity card */}
      <div style={{ background: 'var(--bg)', boxShadow: 'var(--neu-raised)', borderRadius: '20px', padding: '20px', marginBottom: '12px' }}>
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
            <StaaxSelect value={stratMode} onChange={setStratMode} options={[{ value: 'intraday', label: 'Intraday' }, { value: 'btst', label: 'BTST' }, { value: 'stbt', label: 'STBT' }, { value: 'positional', label: 'Positional' }]} width="118px" height="28px" borderRadius="6px" />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginLeft: 'auto' }}>
            <label style={{ fontSize: '10px', color: 'var(--text-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Account</label>
            <StaaxSelect value={account} onChange={setAccount} options={accountOptions.map(a => ({ value: a.id, label: a.label }))} width="160px" height="28px" borderRadius="6px" />
          </div>
        </div>

        {/* Entry Type & Timing + MTM Controls — combined single row */}
        <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--border)', display: 'grid', gridTemplateColumns: '1fr 1px auto', columnGap: '28px', alignItems: 'start' }}>
          {/* Entry Type & Timing */}
          <div>
            <SubSection title="Entry Type & Timing — Algo Level" />
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '20px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '10px', color: 'var(--text-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Entry Type</label>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button onClick={() => setEntryType('direct')} style={{ height: '28px', padding: '0 14px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', border: 'none', background: 'var(--bg)', boxShadow: entryType === 'direct' ? 'var(--neu-inset)' : 'var(--neu-raised-sm)', color: entryType === 'direct' ? 'var(--accent)' : 'var(--text-dim)' }}>Direct</button>
                  <button onClick={() => setEntryType('orb')}    style={{ height: '28px', padding: '0 14px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', border: 'none', background: 'var(--bg)', boxShadow: entryType === 'orb' ? 'var(--neu-inset)' : 'var(--neu-raised-sm)', color: entryType === 'orb' ? 'var(--accent)' : 'var(--text-dim)' }}>ORB</button>
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
                        style={{ height: '28px', padding: '0 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '10px', fontWeight: 600, border: 'none', background: 'var(--bg)', boxShadow: orbRangeSource === s ? 'var(--neu-inset)' : 'var(--neu-raised-sm)', color: orbRangeSource === s ? 'var(--accent)' : 'var(--text-dim)' }}>
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
                    <span title="Next-day exit: entries on day 1, exits on day 2 at this time. SL check auto-handled." style={{ cursor: 'help', verticalAlign: 'middle', display: 'inline-flex' }}><Warning size={13} weight="fill" color="#F59E0B" style={{ verticalAlign: 'middle' }} /></span>
                  )}
                </label>
                <TimeInput value={['stbt','btst'].includes(stratMode) ? nextDayExitTime : exitTime} onChange={['stbt','btst'].includes(stratMode) ? setNextDayExitTime : setExitTime} />
              </div>
              {stratMode === 'positional' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '10px', color: 'var(--text-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>DTE</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <StaaxSelect value={dte} onChange={setDte} options={Array.from({ length: 31 }, (_, n) => ({ value: String(n), label: String(n) }))} width="72px" height="28px" borderRadius="6px" />
                    <span style={{ fontSize: '10px', color: 'var(--text-dim)', maxWidth: '120px', lineHeight: 1.3 }}>
                      {dte === '0' ? 'Exit on expiry day' : `${dte} day${Number(dte) !== 1 ? 's' : ''} before expiry`}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Vertical separator */}
          <div style={{ width: '1px', background: 'var(--border)', alignSelf: 'stretch', minHeight: '60px' }} />

          {/* MTM Controls */}
          <div>
            <SubSection title="MTM Controls — Algo Level" />
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '20px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '10px', color: 'var(--text-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Unit</label>
                <StaaxSelect value={mtmUnit} onChange={setMtmUnit} options={[{ value: 'amt', label: '₹ Amount' }, { value: 'pct', label: '% Premium' }]} width="96px" height="28px" borderRadius="6px" />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '10px', color: 'var(--text-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>MTM SL</label>
                <input value={mtmSL} onChange={e => setMtmSL(e.target.value)} onBlur={e => { if (e.target.value !== '' && Number(e.target.value) < 1) setMtmSL('1') }} type="number" min={1} placeholder="None" className="staax-input" style={{ width: '80px', fontSize: '12px' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '10px', color: 'var(--text-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>MTM TP</label>
                <input value={mtmTP} onChange={e => setMtmTP(e.target.value)} onBlur={e => { if (e.target.value !== '' && Number(e.target.value) < 1) setMtmTP('1') }} type="number" min={1} placeholder="None" className="staax-input" style={{ width: '80px', fontSize: '12px' }} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Legs */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', marginTop: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Legs</span>
          <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>{legs.length} leg{legs.length > 1 ? 's' : ''}</span>
        </div>
        <button onClick={addLeg} title="Add Leg" style={{ height: '28px', width: '28px', borderRadius: '6px', fontSize: '16px', fontWeight: 400, cursor: 'pointer', border: 'none', background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>+</button>
      </div>
      {legs.map((leg, i) => (
        <div key={leg.id}
          draggable onDragStart={() => setDragIdx(i)} onDragOver={e => { e.preventDefault(); setDragOverIdx(i) }} onDragEnd={handleDragEnd}
          style={{ outline: dragOverIdx === i && dragIdx !== i ? '2px dashed var(--accent)' : 'none', borderRadius: '16px' }}>
          <LegRow leg={leg} isDragging={dragIdx === i} onUpdate={updateLeg} onRemove={removeLeg} onCopy={copyLeg} dragHandleProps={{}} onBlockedClick={showToast} entryType={entryType} />
        </div>
      ))}

      {/* Delays + Errors */}
      <div style={{ background: 'var(--bg)', boxShadow: 'var(--neu-raised)', borderRadius: '20px', padding: '20px', marginTop: '12px' }}>
        <SubSection title="Order Delays — Algo Level" />
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          {/* F2 — Entry delay with BUY/SELL scope */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-dim)', fontWeight: 600, whiteSpace: 'nowrap' }}>Entry Delay:</span>
            {/* Scope dropdown — BUY/SELL/All */}
            <StaaxSelect value={entryDelayScope} onChange={setEntryDelayScope} options={[{ value: 'all', label: 'All legs' }, { value: 'buy', label: 'BUY legs' }, { value: 'sell', label: 'SELL legs' }]} width="90px" height="28px" borderRadius="6px" />
            <input value={entryDelay} onChange={e => setEntryDelay(e.target.value)} type="number" min={0} max={60} className="staax-input" style={{ width: '60px', fontSize: '12px' }} />
            <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>s (max 60)</span>
          </div>
          {/* F2 — Exit delay with BUY/SELL scope */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-dim)', fontWeight: 600, whiteSpace: 'nowrap' }}>Exit Delay:</span>
            <StaaxSelect value={exitDelayScope} onChange={setExitDelayScope} options={[{ value: 'all', label: 'All legs' }, { value: 'buy', label: 'BUY legs' }, { value: 'sell', label: 'SELL legs' }]} width="90px" height="28px" borderRadius="6px" />
            <input value={exitDelay} onChange={e => setExitDelay(e.target.value)} type="number" min={0} max={60} className="staax-input" style={{ width: '60px', fontSize: '12px' }} />
            <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>s (max 60)</span>
          </div>
        </div>

        <div style={{ margin: '12px 0 10px', borderTop: '1px solid var(--border)' }} />
        <SubSection title="Error Settings — Algo Level" />
        <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer', fontSize: '11px', color: 'var(--red)' }} onClick={() => setErrorMargin(v => !v)}>
            <div style={{ width: 14, height: 14, borderRadius: 3, background: 'var(--bg)', boxShadow: errorMargin ? 'var(--neu-inset)' : 'var(--neu-raised-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {errorMargin && <div style={{ width: 8, height: 8, borderRadius: 1, background: 'var(--red)' }} />}
            </div>
            On margin error, exit all open positions
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer', fontSize: '11px', color: 'var(--red)' }} onClick={() => setErrorEntry(v => !v)}>
            <div style={{ width: 14, height: 14, borderRadius: 3, background: 'var(--bg)', boxShadow: errorEntry ? 'var(--neu-inset)' : 'var(--neu-raised-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {errorEntry && <div style={{ width: 8, height: 8, borderRadius: 1, background: 'var(--red)' }} />}
            </div>
            If any entry fails, exit all open positions
          </span>
        </div>
      </div>
    </div>
  )
}
