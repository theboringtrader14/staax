import { NavLink, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useStore } from '@/store'
import { Pulse, Sun, Moon } from '@phosphor-icons/react'

const NAV_TABS = [
  { path: '/grid',       label: 'Algos'     },
  { path: '/orders',     label: 'Orders'    },
  { path: '/reports',    label: 'Reports'   },
  { path: '/analytics',  label: 'Analytics' },
  { path: '/indicators', label: 'Bots'      },
]

export default function TopNav() {
  const navigate          = useNavigate()
  const theme             = useStore(s => s.theme)
  const toggleTheme       = useStore(s => s.toggleTheme)
  const setIsProfileOpen  = useStore(s => s.setIsProfileOpen)
  const setIsDashboardOpen = useStore(s => s.setIsDashboardOpen)
  const livePnl           = useStore(s => s.livePnl)

  const [istTime, setIstTime] = useState('')
  const [pendingPath, setPendingPath] = useState<string | null>(null)

  useEffect(() => {
    const rupee = '₹'
    document.title = `STAAX ${livePnl >= 0 ? '+' : ''}${rupee}${livePnl.toLocaleString('en-IN')}`
  }, [livePnl])

  useEffect(() => {
    const tick = () => setIstTime(
      new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true })
    )
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [])

  const handleNavClick = (e: React.MouseEvent, to: string) => {
    if ((window as any).__staaxDirty) {
      e.preventDefault()
      setPendingPath(to)
    }
  }

  const isDark = theme === 'dark'

  const pillBg     = isDark ? 'rgba(10,10,11,0.85)' : 'rgb(228,231,239)'
  const pillShadow = isDark
    ? '-8px -8px 16px rgba(255,255,255,0.025), 8px 8px 16px rgba(0,0,0,0.7)'
    : '-8px -8px 16px rgba(255,255,255,1), 8px 8px 16px rgba(163,177,198,0.55)'
  const tabInactive = isDark ? 'rgba(229,231,235,0.55)' : 'rgba(26,29,37,0.68)'

  return (
    <>
      {/* Sticky wrapper — occupies space in flow, sticks on scroll */}
      <div style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        padding: '20px 24px 0',
      }}>
        <header style={{
          maxWidth: 1200,
          margin: '0 auto',
          height: 62,
          borderRadius: 100,
          background: pillBg,
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          boxShadow: pillShadow,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 24px',
        }}>

          {/* LEFT — Wordmark (links to /dashboard) */}
          <NavLink
            to="/dashboard"
            style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', flexShrink: 0 }}
          >
            <span style={{
              fontFamily: 'Syne, sans-serif',
              fontSize: 15,
              fontWeight: 700,
              whiteSpace: 'nowrap',
            }}>
              <span style={{ color: isDark ? 'rgba(240,237,232,0.42)' : 'rgba(26,29,37,0.50)' }}>
                LIFEX OS ·{' '}
              </span>
              <span style={{ color: '#FF6B00' }}>STAAX</span>
            </span>
          </NavLink>

          {/* CENTER — Nav tabs, text only */}
          <nav style={{
            display: 'flex',
            alignItems: 'center',
            gap: 32,
            height: '100%',
          }}>
            {NAV_TABS.map(({ path, label }) => (
              <NavLink
                key={path}
                to={path}
                onClick={e => handleNavClick(e, path)}
                style={({ isActive }) => ({
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  height: '100%',
                  textDecoration: 'none',
                  fontSize: 14,
                  fontWeight: 500,
                  fontFamily: 'Inter, var(--font-body), sans-serif',
                  color: isActive ? '#FF6B00' : tabInactive,
                  whiteSpace: 'nowrap',
                  transition: 'color 0.18s ease',
                })}
              >
                {({ isActive }) => (
                  <>
                    {label}
                    {isActive && (
                      <span style={{
                        position: 'absolute',
                        bottom: 8,
                        left: '50%',
                        transform: 'translateX(-50%)',
                        width: '100%',
                        height: 2,
                        background: '#FF6B00',
                        borderRadius: 2,
                      }} />
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </nav>

          {/* RIGHT — Controls */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexShrink: 0,
          }}>

            {/* IST Clock */}
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: isDark ? 'var(--ox-radiant)' : 'rgba(26,29,37,0.55)',
              letterSpacing: '0.04em',
              whiteSpace: 'nowrap',
              marginRight: 4,
            }}>
              {istTime}
            </span>

            {/* Kill Switch — small pill */}
            <button
              onClick={() => console.log('KILL SWITCH')}
              style={{
                height: 28,
                padding: '0 12px',
                borderRadius: 100,
                background: 'rgba(239,68,68,0.10)',
                border: '0.5px solid rgba(239,68,68,0.40)',
                color: '#ef4444',
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.06em',
                cursor: 'pointer',
                flexShrink: 0,
                transition: 'all 0.18s ease',
              }}
            >
              Kill
            </button>

            {/* Activity — triggers dashboard panel */}
            <button
              onClick={() => setIsDashboardOpen(true)}
              title="System Monitor"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 32,
                height: 32,
                borderRadius: 8,
                background: 'transparent',
                border: '0.5px solid transparent',
                color: isDark ? 'rgba(240,237,232,0.45)' : 'rgba(26,29,37,0.45)',
                cursor: 'pointer',
                flexShrink: 0,
                transition: 'color 0.18s ease',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#FF6B00' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = isDark ? 'rgba(240,237,232,0.45)' : 'rgba(26,29,37,0.45)' }}
            >
              <Pulse size={16} weight="regular" />
            </button>

            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              title={isDark ? 'Light mode' : 'Dark mode'}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 32,
                height: 32,
                borderRadius: 8,
                background: 'transparent',
                border: '0.5px solid transparent',
                color: isDark ? 'rgba(240,237,232,0.45)' : 'rgba(26,29,37,0.45)',
                cursor: 'pointer',
                flexShrink: 0,
                transition: 'color 0.18s ease',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#FF6B00' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = isDark ? 'rgba(240,237,232,0.45)' : 'rgba(26,29,37,0.45)' }}
            >
              {isDark ? <Sun size={16} weight="regular" /> : <Moon size={16} weight="regular" />}
            </button>

            {/* Avatar — KA initials */}
            <button
              onClick={() => setIsProfileOpen(true)}
              title="Profile"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: 'linear-gradient(135deg,#FF6B00,#CC4400)',
                border: 'none',
                color: '#fff',
                fontFamily: 'Syne, var(--font-display), sans-serif',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                flexShrink: 0,
                letterSpacing: '0.02em',
              }}
            >
              KA
            </button>
          </div>
        </header>
      </div>

      {/* Unsaved changes modal */}
      {pendingPath && (
        <div className="modal-overlay" style={{ zIndex: 1100 }}>
          <div className="modal-box" style={{ maxWidth: '360px' }}>
            <div style={{ fontWeight: 700, fontSize: '15px', marginBottom: '8px', fontFamily: 'var(--font-display)' }}>
              Unsaved changes
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '20px', lineHeight: 1.5 }}>
              You have unsaved changes on this page.<br />Leave without saving?
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setPendingPath(null)}>Stay</button>
              <button className="btn btn-danger" onClick={() => {
                (window as any).__staaxDirty = false
                const dest = pendingPath
                setPendingPath(null)
                navigate(dest)
              }}>Leave</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
