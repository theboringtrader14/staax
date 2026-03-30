import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useStore } from '../../store'
import { systemAPI } from '../../services/api'

export default function TopBar() {
  const isPractixMode     = useStore(s => s.isPractixMode)
  const setIsPractixMode  = useStore(s => s.setIsPractixMode)
  const livePnl           = useStore(s => s.livePnl)
  const setLivePnl        = useStore(s => s.setLivePnl)
  const theme             = useStore(s => s.theme)
  const toggleTheme       = useStore(s => s.toggleTheme)
  const rawAccounts       = useStore(s => s.accounts)
  const activeAccount     = useStore(s => s.activeAccount)
  const setActiveAccount  = useStore(s => s.setActiveAccount)

  // Guard: ensure accounts is always a plain array regardless of what the API returned
  const accounts = Array.isArray(rawAccounts) ? rawAccounts : []

  const [time, setTime] = useState(new Date())

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])



  // Poll /system/stats every 5s for live MTM — supplements WebSocket
  useEffect(() => {
    const poll = () => {
      systemAPI.stats()
        .then(res => {
          const mtm = res.data?.mtm_total ?? res.data?.today_pnl ?? 0
          console.log('[TopBar] stats poll:', mtm)
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
  // Options: { id: UUID | null, label: nickname }. Store UUID as activeAccount so pages can pass to backend.
  const accountOptions: { id: string | null; label: string }[] = [
    { id: null, label: 'All Accounts' },
    ...accounts.map((a: any) => ({ id: String(a.id), label: a.nickname || a.name || String(a.id) })),
  ]
  const selectedLabel = accountOptions.find(o => o.id === activeAccount)?.label ?? 'All Accounts'

  return (
    <>
      <header style={{
        height: '52px', minHeight: '52px',
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--bg-border)',
        display: 'flex', alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px', gap: '16px',
      }}>
        {/* Left */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
            Welcome, <span style={{ color: 'var(--text)', fontWeight: 600 }}>Karthikeyan</span>
          </span>
          <span style={{ color: 'var(--bg-border)' }}>|</span>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>IST {timeStr}</span>
          <span style={{ color: 'var(--bg-border)' }}>|</span>
          <span style={{ fontSize: '13px', fontWeight: 700, color: livePnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
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

          <button onClick={() => setIsPractixMode(!isPractixMode)} style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            height: 'var(--btn-h)',
            background:  isPractixMode ? 'rgba(215,123,18,0.12)' : 'rgba(34,197,94,0.12)',
            border: `1px solid ${isPractixMode ? 'rgba(215,123,18,0.4)' : 'rgba(34,197,94,0.4)'}`,
            borderRadius: '5px', padding: '0 12px',
            color: isPractixMode ? 'var(--accent-amber)' : 'var(--green)',
            fontSize: '11px', fontWeight: '700', letterSpacing: '0.08em', cursor: 'pointer',
          }}>
            <span style={{
              width: '6px', height: '6px', borderRadius: '50%',
              background: isPractixMode ? 'var(--accent-amber)' : 'var(--green)',
              boxShadow: isPractixMode ? '0 0 6px var(--accent-amber)' : '0 0 6px var(--green)',
            }} />
            {isPractixMode ? 'PRACTIX' : 'LIVE'}
          </button>

          <button onClick={toggleTheme} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            style={{
              background: 'transparent', border: '1px solid var(--bg-border)',
              borderRadius: '5px', height: 'var(--btn-h)', width: 'var(--btn-h)',
              cursor: 'pointer', color: 'var(--text-dim)', fontSize: '14px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text)'; (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-surface)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-dim)'; (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
          >
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{theme === 'dark' ? '☀' : '☾'}</span>
          </button>


        </div>
      </header>

    </>
  )
}
