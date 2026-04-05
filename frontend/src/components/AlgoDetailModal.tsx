import { useState, useEffect } from 'react'
import { algosAPI } from '@/services/api'

export interface AlgoDetailModalProps {
  algoName: string | null   // null = hidden
  onClose: () => void
}

export function AlgoDetailModal({ algoName, onClose }: AlgoDetailModalProps) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!algoName) {
      setData(null)
      setError(false)
      return
    }
    setLoading(true)
    setError(false)
    setData(null)
    // Fetch the list filtered by name to resolve the algo ID, then fetch full details
    algosAPI.list({ name: algoName })
      .then((listRes: any) => {
        const list: any[] = Array.isArray(listRes.data)
          ? listRes.data
          : (listRes.data?.algos || listRes.data?.results || [])
        const match = list.find(
          (a: any) => (a.name || a.algo_name || '').toLowerCase() === algoName.toLowerCase()
        )
        if (!match) {
          setError(true)
          setLoading(false)
          return
        }
        const algoId = String(match.id || match.algo_id)
        return algosAPI.get(algoId)
      })
      .then((res: any) => {
        if (res) {
          setData(res.data)
        }
        setLoading(false)
      })
      .catch(() => {
        setError(true)
        setLoading(false)
      })
  }, [algoName])

  if (!algoName) return null

  const legs: any[] = Array.isArray(data?.legs) ? data.legs : []
  const hasSL = legs.some((l: any) => l.sl_value != null)
  const hasTP = legs.some((l: any) => l.tp_value != null)
  const hasSchedule = data && (data.entry_time || data.exit_time || data.entry_type || data.strategy_mode)
  const hasRisk = data && (data.mtm_sl != null || data.mtm_tp != null)

  const fmtSL = (l: any) => {
    if (l.sl_value == null) return '—'
    const unit = l.sl_type === 'pct' ? '%' : l.sl_type === 'pts' ? ' pts' : ''
    return `${l.sl_value}${unit}`
  }
  const fmtTP = (l: any) => {
    if (l.tp_value == null) return '—'
    const unit = l.tp_type === 'pct' ? '%' : l.tp_type === 'pts' ? ' pts' : ''
    return `${l.tp_value}${unit}`
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-box" style={{ maxWidth: '600px', width: '95vw', display: 'flex', flexDirection: 'column', maxHeight: '85vh' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 20, color: 'var(--ox-radiant)' }}>{algoName}</div>
            {data?.algo_id && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'rgba(232,232,248,0.45)', background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.12)', borderRadius: 6, padding: '2px 8px' }}>
                {data.algo_id}
              </span>
            )}
            {data?.account_nickname && (
              <span style={{ fontSize: '11px', fontWeight: 600, background: 'rgba(255,107,0,0.12)', color: 'var(--ox-radiant)', border: '0.5px solid rgba(255,107,0,0.35)', padding: '2px 9px', borderRadius: '20px' }}>
                {data.account_nickname}
              </span>
            )}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: '20px', lineHeight: 1, flexShrink: 0 }}>×</button>
        </div>

        {loading ? (
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', padding: '24px 0' }}>Loading…</div>
        ) : error || !data ? (
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', padding: '24px 0' }}>Failed to load strategy details</div>
        ) : (
          <div className="no-scrollbar" style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {hasSchedule && (
              <div>
                <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>Schedule</div>
                <div style={{ background: 'var(--bg-secondary)', borderRadius: '6px', padding: '10px 14px', display: 'flex', flexWrap: 'wrap', gap: '18px' }}>
                  {data.entry_type && <div><div style={{ fontSize: '10px', color: 'var(--text-dim)', marginBottom: '2px' }}>Entry Type</div><div style={{ fontSize: '12px', fontWeight: 600, textTransform: 'capitalize' }}>{data.entry_type}</div></div>}
                  {data.strategy_mode && <div><div style={{ fontSize: '10px', color: 'var(--text-dim)', marginBottom: '2px' }}>Strategy</div><div style={{ fontSize: '12px', fontWeight: 600, textTransform: 'capitalize' }}>{data.strategy_mode}</div></div>}
                  {data.entry_time && <div><div style={{ fontSize: '10px', color: 'var(--text-dim)', marginBottom: '2px' }}>Entry</div><div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--indigo)' }}>{data.entry_time}</div></div>}
                  {data.exit_time && <div><div style={{ fontSize: '10px', color: 'var(--text-dim)', marginBottom: '2px' }}>Exit</div><div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>{data.exit_time}</div></div>}
                  {data.next_day_exit_time && <div><div style={{ fontSize: '10px', color: 'var(--text-dim)', marginBottom: '2px' }}>Next Day Exit</div><div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>{data.next_day_exit_time}</div></div>}
                </div>
              </div>
            )}
            {hasRisk && (
              <div>
                <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>Risk</div>
                <div style={{ background: 'var(--bg-secondary)', borderRadius: '6px', padding: '10px 14px', display: 'flex', gap: '24px' }}>
                  {data.mtm_sl != null && <div><div style={{ fontSize: '10px', color: 'var(--text-dim)', marginBottom: '2px' }}>MTM Stop Loss</div><div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--red)' }}>₹{Math.abs(data.mtm_sl).toLocaleString('en-IN')}</div></div>}
                  {data.mtm_tp != null && <div><div style={{ fontSize: '10px', color: 'var(--text-dim)', marginBottom: '2px' }}>MTM Target</div><div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--green)' }}>₹{data.mtm_tp.toLocaleString('en-IN')}</div></div>}
                </div>
              </div>
            )}
            {legs.length > 0 && (
              <div>
                <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>Legs ({legs.length})</div>
                <div style={{ border: '1px solid var(--bg-border)', borderRadius: '6px', overflow: 'hidden' }}>
                  <table className="staax-table" style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th>#</th><th>Underlying</th><th>Dir</th><th>Expiry</th><th>Strike</th><th>Lots</th>
                        {hasSL && <th>SL</th>}
                        {hasTP && <th>TP</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {legs.map((leg: any, i: number) => (
                        <tr key={i}>
                          <td style={{ fontSize: '11px', color: 'var(--text-dim)' }}>{leg.leg_number ?? i + 1}</td>
                          <td style={{ fontSize: '11px', fontWeight: 600 }}>{leg.underlying || '—'}</td>
                          <td style={{ fontSize: '11px', fontWeight: 700, color: (leg.direction || '').toUpperCase() === 'BUY' ? 'var(--green)' : 'var(--red)' }}>{(leg.direction || '').toUpperCase() || '—'}</td>
                          <td style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{leg.expiry || '—'}</td>
                          <td style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{leg.strike_type || '—'}</td>
                          <td style={{ fontSize: '11px' }}>{leg.lots ?? '—'}</td>
                          {hasSL && <td style={{ fontSize: '11px', color: 'var(--amber)' }}>{fmtSL(leg)}</td>}
                          {hasTP && <td style={{ fontSize: '11px', color: 'var(--green)' }}>{fmtTP(leg)}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
