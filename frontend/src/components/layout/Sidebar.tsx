import { NavLink, useNavigate } from 'react-router-dom'
import { useState } from 'react'

// TradingView chart links for each index (opens in new tab on click)
const TV_LINKS: Record<string, string> = {
  NIFTY:      'https://www.tradingview.com/chart/?symbol=NSE:NIFTY50',
  BANKNIFTY:  'https://www.tradingview.com/chart/?symbol=NSE:BANKNIFTY',
  SENSEX:     'https://www.tradingview.com/chart/?symbol=BSE:SENSEX',
  FINNIFTY:   'https://www.tradingview.com/chart/?symbol=NSE:FINNIFTY',
  MIDCPNIFTY: 'https://www.tradingview.com/chart/?symbol=NSE:MIDCPNIFTY',
  GOLDM:      'https://www.tradingview.com/chart/?symbol=MCX:GOLDM1!',
}
const TICKER_NAMES = ['NIFTY', 'BANKNIFTY', 'SENSEX', 'FINNIFTY', 'MIDCPNIFTY', 'GOLDM']

// ── SVG Icons ─────────────────────────────────────────────────────────────────
const iconSize = 18

const IconHome = () => (
  <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H5a1 1 0 01-1-1V9.5z"/>
    <path d="M9 21V12h6v9"/>
  </svg>
)
const IconGrid = () => (
  <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" rx="1"/>
    <rect x="14" y="3" width="7" height="7" rx="1"/>
    <rect x="3" y="14" width="7" height="7" rx="1"/>
    <rect x="14" y="14" width="7" height="7" rx="1"/>
  </svg>
)
const IconList = () => (
  <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <line x1="8" y1="6" x2="21" y2="6"/>
    <line x1="8" y1="12" x2="21" y2="12"/>
    <line x1="8" y1="18" x2="21" y2="18"/>
    <circle cx="3.5" cy="6" r="1.5" fill="currentColor"/>
    <circle cx="3.5" cy="12" r="1.5" fill="currentColor"/>
    <circle cx="3.5" cy="18" r="1.5" fill="currentColor"/>
  </svg>
)
const IconChart = () => (
  <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
    <polyline points="16 7 22 7 22 13"/>
  </svg>
)
const IconUser = () => (
  <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="8" r="4"/>
    <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
  </svg>
)
const IconCandlestick = () => (
  <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <line x1="5" y1="3" x2="5" y2="6"/>
    <rect x="3" y="6" width="4" height="7" rx="0.5"/>
    <line x1="5" y1="13" x2="5" y2="17"/>
    <line x1="12" y1="5" x2="12" y2="9"/>
    <rect x="10" y="9" width="4" height="6" rx="0.5" fill="currentColor" fillOpacity="0.3"/>
    <line x1="12" y1="15" x2="12" y2="20"/>
    <line x1="19" y1="4" x2="19" y2="7"/>
    <rect x="17" y="7" width="4" height="8" rx="0.5"/>
    <line x1="19" y1="15" x2="19" y2="19"/>
  </svg>
)

// P2-A — nav order: Indicator Bots after Orders
const nav = [
  { path: '/dashboard',  label: 'Dashboard',      Icon: IconHome        },
  { path: '/grid',       label: 'Smart Grid',      Icon: IconGrid        },
  { path: '/orders',     label: 'Orders',          Icon: IconList        },
  { path: '/indicators', label: 'Indicator Bots',  Icon: IconCandlestick },
  { path: '/reports',    label: 'Reports',         Icon: IconChart       },
  { path: '/accounts',   label: 'Accounts',        Icon: IconUser        },
]

function StaaxLogo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <path d="M16 2L28 9V23L16 30L4 23V9L16 2Z" fill="rgba(0,176,240,0.15)" stroke="#00B0F0" strokeWidth="1.2"/>
      <polyline points="11,12 16,10 21,12 11,20 16,22 21,20" fill="none" stroke="#00B0F0" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar_collapsed') === 'true')
  // P0-A — dirty-nav guard state
  const [pendingPath, setPendingPath] = useState<string | null>(null)
  const navigate = useNavigate()
  const toggle = (v: boolean) => { setCollapsed(v); localStorage.setItem('sidebar_collapsed', String(v)) }
  const W = collapsed ? '56px' : '216px'

  // P0-A — intercept NavLink click when AlgoPage has unsaved changes
  const handleNavClick = (e: React.MouseEvent, to: string) => {
    if ((window as any).__staaxDirty) {
      e.preventDefault()
      setPendingPath(to)
    }
  }

  return (
    <>
      <nav style={{
        width: W, minWidth: W,
        background: 'var(--bg-secondary)',
        borderRight: '1px solid var(--bg-border)',
        display: 'flex', flexDirection: 'column',
        transition: 'width 0.18s ease, min-width 0.18s ease',
        overflow: 'hidden',
        position: 'sticky', top: 0, height: '100vh', alignSelf: 'flex-start',
      }}>
        {/* Logo row */}
        <div onClick={() => toggle(!collapsed)} style={{
          height: '52px', display: 'flex', alignItems: 'center',
          padding: collapsed ? '0' : '0 14px',
          justifyContent: collapsed ? 'center' : 'space-between',
          borderBottom: '1px solid var(--bg-border)',
          flexShrink: 0, cursor: 'pointer', userSelect: 'none',
        }}>
          {!collapsed && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <StaaxLogo size={28} />
              <div style={{ opacity: 1, transition: 'opacity 0.15s ease', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                <div style={{ fontFamily:"'ADLaM Display', serif", fontSize: '20px', color: 'var(--accent-blue)', letterSpacing: '0.05em', lineHeight: 1 }}>STAAX</div>
                <div style={{ fontSize: '9px', color: 'var(--text-dim)', marginTop: '1px', letterSpacing: '0.14em' }}>ALGO TRADING</div>
              </div>
            </div>
          )}
          {collapsed && <StaaxLogo size={28} />}
        </div>

        {/* Nav links — P0-A: onClick intercepts when dirty */}
        <div style={{ flex: 1, paddingTop: '6px' }}>
          {nav.map(({ path, label, Icon }) => (
            <NavLink key={path} to={path} title={collapsed ? label : undefined}
              onClick={(e) => handleNavClick(e, path)}
              style={({ isActive }) => ({
                display: 'flex', alignItems: 'center',
                justifyContent: collapsed ? 'center' : 'flex-start',
                padding: '10px 0',
                textDecoration: 'none',
                color: isActive ? 'var(--accent-blue)' : 'var(--text-muted)',
                background: isActive ? 'rgba(0,176,240,0.08)' : 'transparent',
                borderLeft: isActive && !collapsed ? '2px solid var(--accent-blue)' : '2px solid transparent',
                fontSize: '13px', transition: 'all 0.12s',
                fontWeight: isActive ? '600' : '400', whiteSpace: 'nowrap',
              })}>
              <span style={{ width: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon />
              </span>
              <span style={{ paddingRight: collapsed ? 0 : '16px', maxWidth: collapsed ? 0 : '200px', opacity: collapsed ? 0 : 1, transition: 'opacity 0.15s ease, max-width 0.18s ease, padding 0.18s ease', overflow: 'hidden', whiteSpace: 'nowrap', display: 'block' }}>
                {label}
              </span>
            </NavLink>
          ))}
        </div>

        {/* Ticker strip — static placeholders, click opens TradingView chart */}
        <div style={{ borderTop: '1px solid var(--bg-border)', overflow: 'hidden' }}>
          {collapsed ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'center', padding: '8px 0' }}>
              {[0,1,2].map(i => <div key={i} style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'var(--accent-blue)', opacity: 0.4 }}/>)}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', padding: '4px 0' }}>
              {TICKER_NAMES.map(name => (
                <a
                  key={name}
                  href={TV_LINKS[name]}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '5px 14px', textDecoration: 'none',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(0,176,240,0.06)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                >
                  <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.03em' }}>{name}</span>
                  <span style={{ fontSize: '11px', color: 'var(--text-dim)', fontFamily: 'monospace' }}>--</span>
                </a>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: collapsed ? '10px 0' : '10px 20px', borderTop: '1px solid var(--bg-border)', display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-start' }}>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.05em', opacity: collapsed ? 0 : 1, transition: 'opacity 0.12s ease', overflow: 'hidden', whiteSpace: 'nowrap' }}>v0.1.0 · Phase 1F</div>
        </div>
      </nav>

      {/* P0-A — Unsaved changes confirmation modal */}
      {pendingPath && (
        <div className="modal-overlay" style={{ zIndex: 1100 }}>
          <div className="modal-box" style={{ maxWidth: '360px' }}>
            <div style={{ fontWeight: 700, fontSize: '15px', marginBottom: '8px' }}>Unsaved changes</div>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '20px', lineHeight: 1.5 }}>
              You have unsaved changes on this page.<br/>Leave without saving?
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setPendingPath(null)}>Stay</button>
              <button className="btn" style={{ background: 'var(--red)', color: '#fff', border: 'none' }}
                onClick={() => {
                  ;(window as any).__staaxDirty = false
                  const dest = pendingPath
                  setPendingPath(null)
                  navigate(dest)
                }}>
                Leave
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
