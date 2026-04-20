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

  const [pendingPath, setPendingPath] = useState<string | null>(null)

  useEffect(() => {
    const rupee = '₹'
    document.title = `STAAX ${livePnl >= 0 ? '+' : ''}${rupee}${livePnl.toLocaleString('en-IN')}`
  }, [livePnl])

  const handleNavClick = (e: React.MouseEvent, to: string) => {
    if ((window as any).__staaxDirty) {
      e.preventDefault()
      setPendingPath(to)
    }
  }

  const isDark = theme === 'dark'

  const tabInactive = 'var(--text-dim)'

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
          background: 'var(--bg)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          boxShadow: 'var(--neu-raised)',
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
              <span style={{ color: 'var(--text-dim)' }}>
                LIFEX OS ·{' '}
              </span>
              <span style={{ color: 'var(--accent)' }}>STAAX</span>
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
                borderRadius: '50%',
                background: 'var(--bg-surface)',
                boxShadow: 'var(--neu-raised-sm)',
                border: 'none',
                color: 'var(--text-dim)',
                cursor: 'pointer',
                flexShrink: 0,
                transition: 'color 0.18s ease',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--accent)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-dim)' }}
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
                borderRadius: '50%',
                background: 'var(--bg-surface)',
                boxShadow: 'var(--neu-raised-sm)',
                border: 'none',
                color: 'var(--text-dim)',
                cursor: 'pointer',
                flexShrink: 0,
                transition: 'color 0.18s ease',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--accent)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-dim)' }}
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
                background: 'var(--accent-dim)',
                border: '1px solid var(--border-accent)',
                color: 'var(--accent)',
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 11,
                fontWeight: 600,
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
