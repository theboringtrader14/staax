import { NavLink } from 'react-router-dom'
import { useState, useEffect, useRef } from 'react'
import { systemAPI } from '@/services/api'

const nav = [
  { path:'/dashboard',   label:'Dashboard',         icon:'⌂'  },
  { path:'/grid',        label:'Smart Grid',         icon:'▦'  },
  { path:'/orders',      label:'Orders',             icon:'⊟'  },
  { path:'/reports',     label:'Reports',            icon:'⊞'  },
  { path:'/accounts',    label:'Accounts',           icon:'⊕'  },
  { path:'/indicators',  label:'Indicator Bots',     icon:'⬡'  },
]

// TradingView symbol mapping
const TV_SYMBOLS: Record<string, string> = {
  NIFTY:      'NSE:NIFTY50',
  BANKNIFTY:  'NSE:BANKNIFTY',
  SENSEX:     'BSE:SENSEX',
  FINNIFTY:   'NSE:FINNIFTY',
  MIDCPNIFTY: 'NSE:MIDCPNIFTY',
  GOLDM:      'MCX:GOLDM1!',
}

const TICKER_NAMES = ['NIFTY', 'BANKNIFTY', 'SENSEX', 'FINNIFTY', 'MIDCPNIFTY', 'GOLDM']

function StaaxLogo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M16 2L28 9V23L16 30L4 23V9L16 2Z" fill="rgba(0,176,240,0.15)" stroke="#00B0F0" strokeWidth="1.2"/>
      <polyline points="11,12 16,10 21,12 11,20 16,22 21,20" fill="none" stroke="#00B0F0" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function TVChartModal({ symbol, onClose }: { symbol: string; onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const script = document.createElement('script')
    script.src = 'https://s3.tradingview.com/tv.js'
    script.async = true
    script.onload = () => {
      if ((window as any).TradingView && containerRef.current) {
        new (window as any).TradingView.widget({
          container_id: 'tv_chart_container',
          symbol: TV_SYMBOLS[symbol] || `NSE:${symbol}`,
          interval: '5',
          timezone: 'Asia/Kolkata',
          theme: 'dark',
          style: '1',
          locale: 'en',
          toolbar_bg: '#2A2C2E',
          enable_publishing: false,
          hide_top_toolbar: false,
          hide_legend: false,
          save_image: false,
          height: 500,
          width: '100%',
        })
      }
    }
    document.head.appendChild(script)
    return () => { try { document.head.removeChild(script) } catch {} }
  }, [symbol])

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ width:'900px', maxWidth:'95vw', background:'var(--bg-secondary)', borderRadius:'10px', border:'1px solid var(--bg-border)', overflow:'hidden' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderBottom:'1px solid var(--bg-border)' }}>
          <div style={{ fontSize:'13px', fontWeight:700, color:'var(--accent-blue)' }}>{symbol} — 5 min Chart</div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'var(--text-dim)', fontSize:'18px', cursor:'pointer', lineHeight:1 }}>×</button>
        </div>
        <div id="tv_chart_container" ref={containerRef} style={{ height:'500px' }}/>
      </div>
    </div>
  )
}

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar_collapsed') === 'true')
  const [prices, setPrices]       = useState<Record<string, number | null>>({})
  const [chartSym, setChartSym]   = useState<string | null>(null)
  const toggle = (v: boolean) => { setCollapsed(v); localStorage.setItem('sidebar_collapsed', String(v)) }
  const W = collapsed ? '56px' : '216px'

  // NR-3: Poll ticker every 3s
  useEffect(() => {
    const fetchPrices = () => {
      systemAPI.ticker()
        .then(r => setPrices(r.data || {}))
        .catch(() => {})
    }
    fetchPrices()
    const id = setInterval(fetchPrices, 3000)
    return () => clearInterval(id)
  }, [])

  const fmt = (p: number | null) => p ? p.toLocaleString('en-IN', { maximumFractionDigits: 1 }) : '—'

  return (
    <>
      <nav style={{
        width: W, minWidth: W,
        background: 'var(--bg-secondary)',
        borderRight: '1px solid var(--bg-border)',
        display: 'flex', flexDirection: 'column',
        transition: 'width 0.18s ease, min-width 0.18s ease',
        overflow: 'hidden',
      }}>
        {/* Logo row — click to toggle */}
        <div onClick={() => toggle(!collapsed)}
          style={{
            height: '52px', display: 'flex', alignItems: 'center',
            padding: collapsed ? '0' : '0 14px',
            justifyContent: collapsed ? 'center' : 'space-between',
            borderBottom: '1px solid var(--bg-border)',
            flexShrink: 0, cursor: 'pointer', userSelect: 'none',
          }}>
          {!collapsed && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <StaaxLogo size={28} />
              <div style={{ opacity: collapsed ? 0 : 1, transition: 'opacity 0.15s ease', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                <div style={{ fontFamily:"'ADLaM Display', serif", fontSize: '20px', color: 'var(--accent-blue)', letterSpacing: '0.05em', lineHeight: 1 }}>STAAX</div>
                <div style={{ fontSize: '9px', color: 'var(--text-dim)', marginTop: '1px', letterSpacing: '0.14em' }}>ALGO TRADING</div>
              </div>
            </div>
          )}
          {collapsed && <StaaxLogo size={28} />}
        </div>

        {/* Nav links */}
        <div style={{ flex: 1, paddingTop: '6px' }}>
          {nav.map(item => (
            <NavLink key={item.path} to={item.path} title={collapsed ? item.label : undefined}
              style={({ isActive }) => ({
                display: 'flex', alignItems: 'center',
                justifyContent: collapsed ? 'center' : 'flex-start',
                padding: '11px 0',
                textDecoration: 'none',
                color: isActive ? 'var(--accent-blue)' : 'var(--text-muted)',
                background: isActive ? 'rgba(0,176,240,0.08)' : 'transparent',
                borderLeft: 'none', boxShadow: 'none',
                fontSize: '13px', transition: 'all 0.12s',
                fontWeight: isActive ? '600' : '400', whiteSpace: 'nowrap',
              })}>
              <span style={{ width: '44px', textAlign: 'center', fontSize: '22px', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {item.icon}
              </span>
              <span style={{ paddingRight: collapsed ? 0 : '16px', maxWidth: collapsed ? 0 : '200px', opacity: collapsed ? 0 : 1, transition: 'opacity 0.15s ease, max-width 0.18s ease, padding 0.18s ease', overflow: 'hidden', whiteSpace: 'nowrap', display: 'block' }}>{item.label}</span>
            </NavLink>
          ))}
        </div>

        {/* NR-3: Ticker bar */}
        <div style={{ borderTop: '1px solid var(--bg-border)', padding: collapsed ? '8px 0' : '8px 0', overflow: 'hidden' }}>
          {collapsed ? (
            // Collapsed: show only icons as dots
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'center', padding: '2px 0' }}>
              {['NIFTY', 'BN', 'SX'].map(s => (
                <div key={s} style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent-blue)', opacity: 0.5 }}/>
              ))}
            </div>
          ) : (
            // Expanded: show full ticker
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
              {TICKER_NAMES.map(name => (
                <div key={name} onClick={() => setChartSym(name)}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '4px 12px', cursor: 'pointer', borderRadius: '3px',
                    transition: 'background 0.1s' }}
                  onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = 'rgba(0,176,240,0.07)'}
                  onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = 'transparent'}>
                  <span style={{ fontSize: '10px', color: 'var(--text-dim)', fontWeight: 600, letterSpacing: '0.04em' }}>{name === 'MIDCPNIFTY' ? 'MIDCAP' : name}</span>
                  <span style={{ fontSize: '11px', color: prices[name] ? 'var(--text)' : 'var(--text-dim)', fontWeight: 600, fontFamily: 'monospace' }}>
                    {fmt(prices[name] ?? null)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: collapsed ? '10px 0' : '10px 20px', borderTop: '1px solid var(--bg-border)', display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-start' }}>
          <div style={{ fontSize: '10px', color: 'var(--text-dim)', letterSpacing: '0.05em', opacity: collapsed ? 0 : 1, transition: 'opacity 0.12s ease', overflow: 'hidden', whiteSpace: 'nowrap' }}>v0.1.0 · Phase 1F</div>
        </div>
      </nav>

      {/* NR-3b: TradingView chart modal */}
      {chartSym && <TVChartModal symbol={chartSym} onClose={() => setChartSym(null)} />}
    </>
  )
}
