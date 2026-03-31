import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useStore } from '../../store'
import { systemAPI } from '../../services/api'

export default function TopBar() {
  const isPractixMode     = useStore(s => s.isPractixMode)
  const setIsPractixMode  = useStore(s => s.setIsPractixMode)
  const livePnl           = useStore(s => s.livePnl)
  const setLivePnl        = useStore(s => s.setLivePnl)
  const rawAccounts       = useStore(s => s.accounts)
  const activeAccount     = useStore(s => s.activeAccount)
  const setActiveAccount  = useStore(s => s.setActiveAccount)

  const accounts = Array.isArray(rawAccounts) ? rawAccounts : []
  const [time, setTime] = useState(new Date())

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // Poll /system/stats every 5s for live MTM
  useEffect(() => {
    const poll = () => {
      systemAPI.stats()
        .then(res => {
          const mtm = res.data?.mtm_total ?? res.data?.today_pnl ?? 0
          if (typeof mtm === 'number') setLivePnl(mtm)
        })
        .catch(() => {})
    }
    poll()
    const t = setInterval(poll, 5000)
    return () => clearInterval(t)
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    document.title = `STAAX ${livePnl >= 0 ? '+' : ''}₹${livePnl.toLocaleString('en-IN')}`
  }, [livePnl])

  const timeStr = time.toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZone: 'Asia/Kolkata', hour12: true,
  })

  const location = useLocation()
  const accountDropdownActive = ['/grid', '/orders', '/reports'].some(p => location.pathname.startsWith(p))
  const accountOptions: { id: string | null; label: string }[] = [
    { id: null, label: 'All Accounts' },
    ...accounts.map((a: any) => ({ id: String(a.id), label: a.nickname || a.name || String(a.id) })),
  ]
  const selectedLabel = accountOptions.find(o => o.id === activeAccount)?.label ?? 'All Accounts'

  const pnlPositive = livePnl >= 0
  const pnlColor    = pnlPositive ? '#10b981' : '#ef4444'
  const pnlGlow     = pnlPositive
    ? '0 0 12px rgba(16,185,129,0.5)'
    : '0 0 12px rgba(239,68,68,0.5)'

  return (
    <>
      <header style={{
        height: '52px', minHeight: '52px',
        background: 'rgba(5,5,16,0.92)',
        borderBottom: '1px solid rgba(99,102,241,0.15)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        display: 'flex', alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px', gap: '16px',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        {/* Left — welcome + time + P&L */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <span style={{ color: 'rgba(232,232,248,0.4)', fontSize: '12px' }}>
            Welcome, <span style={{ color: '#e8e8f8', fontWeight: 600 }}>Karthikeyan</span>
          </span>

          <span style={{ width: '1px', height: '16px', background: 'rgba(99,102,241,0.2)' }} />

          <span style={{
            fontSize: '12px', fontFamily: "'DM Mono', monospace",
            color: '#6366f1', letterSpacing: '0.04em',
          }}>
            IST {timeStr}
          </span>

          <span style={{ width: '1px', height: '16px', background: 'rgba(99,102,241,0.2)' }} />

          {/* Live P&L with glow */}
          <span style={{
            fontSize: '14px', fontWeight: 700,
            color: pnlColor,
            textShadow: pnlGlow,
            fontFamily: "'DM Mono', monospace",
            letterSpacing: '-0.01em',
            transition: 'color 0.3s ease, text-shadow 0.3s ease',
          }}>
            {livePnl >= 0 ? '+' : ''}₹{livePnl.toLocaleString('en-IN')}
          </span>
        </div>

        {/* Middle — TradingView Ticker Tape */}
        <div style={{ flex: 1, maxWidth: '600px', overflow: 'hidden', height: '36px' }}>
          <div className="tradingview-widget-container" style={{ height: '36px' }}>
            <div className="tradingview-widget-container__widget"></div>
            <script
              type="text/javascript"
              src="https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js"
              async
              dangerouslySetInnerHTML={{ __html: JSON.stringify({
                symbols: [
                  { description: "NIFTY",    proName: "NSE:NIFTY" },
                  { description: "BANKNIFTY",proName: "NSE:BANKNIFTY" },
                  { description: "SENSEX",   proName: "BSE:SENSEX" },
                  { description: "FINNIFTY", proName: "NSE:FINNIFTY" },
                  { description: "MIDCAP",   proName: "NSE:MIDCPNIFTY" },
                  { description: "GOLD",     proName: "MCX:GOLD1!" },
                ],
                showSymbolLogo: false,
                isTransparent: true,
                displayMode: "compact",
                colorTheme: "dark",
                locale: "in",
              })}}
            />
          </div>
        </div>

        {/* Right */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <select
            className="staax-select"
            value={accountDropdownActive ? selectedLabel : 'All Accounts'}
            onChange={e => {
              if (!accountDropdownActive) return
              const opt = accountOptions.find(o => o.label === e.target.value)
              setActiveAccount(opt?.id ?? null)
            }}
            disabled={!accountDropdownActive}
            style={{ opacity: accountDropdownActive ? 1 : 0.38, cursor: accountDropdownActive ? 'pointer' : 'default', pointerEvents: accountDropdownActive ? 'auto' : 'none', width: '110px', fontSize: '11px' }}
          >
            {accountOptions.map(o => <option key={o.id ?? 'all'}>{o.label}</option>)}
          </select>

          {/* PRACTIX / LIVE pill */}
          <button onClick={() => setIsPractixMode(!isPractixMode)} style={{
            display: 'flex', alignItems: 'center', gap: '7px',
            height: 'var(--btn-h)',
            background: isPractixMode ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)',
            border: `1px solid ${isPractixMode ? 'rgba(245,158,11,0.35)' : 'rgba(239,68,68,0.35)'}`,
            borderRadius: '20px', padding: '0 14px',
            color: isPractixMode ? '#f59e0b' : '#ef4444',
            fontSize: '11px', fontWeight: '700', letterSpacing: '0.08em', cursor: 'pointer',
            transition: 'all 0.2s ease',
            boxShadow: isPractixMode ? '0 0 10px rgba(245,158,11,0.2)' : '0 0 10px rgba(239,68,68,0.2)',
          }}>
            <span style={{
              width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0,
              background: isPractixMode ? '#f59e0b' : '#ef4444',
              boxShadow: isPractixMode
                ? '0 0 6px #f59e0b, 0 0 12px #f59e0b'
                : '0 0 6px #ef4444, 0 0 12px #ef4444',
              animation: !isPractixMode ? 'glowPulse 1.5s infinite' : 'none',
            }} />
            {isPractixMode ? 'PRACTIX' : 'LIVE'}
          </button>

        </div>
      </header>
    </>
  )
}
