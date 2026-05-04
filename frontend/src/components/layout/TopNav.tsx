import { NavLink, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useStore } from '@/store'
import { Pulse, Sun, Moon, User, Warning } from '@phosphor-icons/react'
import { showSuccess, showWarning } from '@/utils/toast'

declare global { interface Window { __staaxDirty?: boolean } }

const NAV_TABS = [
  { path: '/grid',       label: 'Algos'             },
  { path: '/indicators', label: 'Bots'              },
  { path: '/orders',     label: 'Orders'            },
  { path: '/analytics',  label: 'Quant'             },
]

const iconBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 32,
  height: 32,
  borderRadius: '50%',
  background: 'var(--bg)',
  boxShadow: 'var(--neu-raised-sm)',
  border: 'none',
  color: 'var(--text-dim)',
  cursor: 'pointer',
  flexShrink: 0,
  transition: 'color 0.18s ease',
}

export default function TopNav() {
  const navigate          = useNavigate()
  const theme             = useStore(s => s.theme)
  const toggleTheme       = useStore(s => s.toggleTheme)
  const isProfileOpen      = useStore(s => s.isProfileOpen)
  const setIsProfileOpen  = useStore(s => s.setIsProfileOpen)
  const isDashboardOpen    = useStore(s => s.isDashboardOpen)
  const setIsDashboardOpen = useStore(s => s.setIsDashboardOpen)
  const livePnl           = useStore(s => s.livePnl)
  const isPractixMode     = useStore(s => s.isPractixMode)
  const setIsPractixMode  = useStore(s => s.setIsPractixMode)

  const [pendingPath, setPendingPath] = useState<string | null>(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    const rupee = '₹'
    document.title = `STAAX ${livePnl >= 0 ? '+' : ''}${rupee}${livePnl.toLocaleString('en-IN')}`
  }, [livePnl])

  const handleNavClick = (e: React.MouseEvent, to: string) => {
    setIsDashboardOpen(false)
    if (window.__staaxDirty) {
      e.preventDefault()
      setPendingPath(to)
    }
  }

  const isDark = theme === 'dark'
  const tabInactive = 'var(--text-dim)'

  const onEnter = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.color = 'var(--accent)'
  }
  const onLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.color = 'var(--text-dim)'
  }

  return (
    <>
      {/* Sticky wrapper — matches landing page: 20px top, 20px side margins */}
      <div style={{ position: 'sticky', top: 0, zIndex: 320, padding: '20px 20px 0' }}>
        <header style={{
          maxWidth: 1200,
          margin: '0 auto',
          borderRadius: 100,
          background: 'var(--bg)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          boxShadow: 'var(--neu-raised)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 24px',
        }}>

          {/* LEFT — Wordmark */}
          <a href={window.location.hostname === 'localhost' ? 'http://localhost:3000' : 'https://lifexos.co.in'} style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            <span style={{ fontFamily: "var(--font-body)", fontSize: 20, fontWeight: 700, whiteSpace: 'nowrap', letterSpacing: '-0.03em' }}>
              <span style={{
                background: 'linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}>
                LIFEX OS
              </span>
              <span style={{ color: 'var(--text-dim)', WebkitTextFillColor: 'var(--text-dim)' }}>{' · '}</span>
              <span style={{ color: 'var(--accent)', WebkitTextFillColor: 'var(--accent)' }}>STAAX</span>
            </span>
          </a>

          {/* CENTER — Nav tabs */}
          <nav className="desktop-nav-links" style={{ display: 'flex', alignItems: 'center', gap: 32, height: '100%' }}>
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
                  fontFamily: 'var(--font-body)',
                  color: isActive ? 'var(--accent)' : tabInactive,
                  whiteSpace: 'nowrap',
                  transition: 'color 0.18s ease',
                })}
              >
                {label}
              </NavLink>
            ))}
          </nav>

          {/* RIGHT — Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>

            {/* PRACTIX / LIVE mode toggle */}
            <button
              onClick={() => {
                const next = !isPractixMode
                setIsPractixMode(next)
                if (next) showWarning('Switched to PRACTIX mode')
                else showSuccess('Switched to LIVE mode')
              }}
              title={isPractixMode ? 'Switch to LIVE' : 'Switch to PRACTIX'}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                height: 32, padding: '0 14px', borderRadius: 100,
                border: 'none', cursor: 'pointer',
                background: 'var(--bg)',
                boxShadow: 'var(--neu-raised-sm)',
                fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
                fontFamily: 'var(--font-display)',
                color: isPractixMode ? '#F59E0B' : '#0EA66E',
                transition: 'box-shadow 0.15s',
              }}
              onMouseDown={e => (e.currentTarget.style.boxShadow = 'var(--neu-inset)')}
              onMouseUp={e => (e.currentTarget.style.boxShadow = 'var(--neu-raised-sm)')}
              onMouseLeave={e => (e.currentTarget.style.boxShadow = 'var(--neu-raised-sm)')}
            >
              <span style={{
                width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                background: isPractixMode ? '#F59E0B' : '#0EA66E',
                boxShadow: isPractixMode ? '0 0 6px #F59E0B' : '0 0 6px #0EA66E',
                animation: !isPractixMode ? 'glowPulse 1.5s infinite' : 'none',
              }} />
              {isPractixMode ? 'PRACTIX' : 'LIVE'}
            </button>

            {/* Activity */}
            <button onClick={() => { setIsProfileOpen(false); setIsDashboardOpen(!isDashboardOpen) }} title="System Monitor"
              style={{ ...iconBtnStyle, boxShadow: isDashboardOpen ? 'var(--neu-inset)' : 'var(--neu-raised-sm)', color: isDashboardOpen ? 'var(--accent)' : 'var(--text-dim)' }}
              onMouseEnter={e => { if (!isDashboardOpen) onEnter(e) }}
              onMouseLeave={e => { if (!isDashboardOpen) onLeave(e) }}>
              <Pulse size={16} weight="regular" />
            </button>

            {/* Theme toggle */}
            <button onClick={toggleTheme} title={isDark ? 'Light mode' : 'Dark mode'}
              style={iconBtnStyle} onMouseEnter={onEnter} onMouseLeave={onLeave}>
              {isDark ? <Sun size={16} weight="regular" /> : <Moon size={16} weight="regular" />}
            </button>

            {/* Profile */}
            <button onMouseDown={e => { e.stopPropagation(); setIsDashboardOpen(false); setIsProfileOpen(!isProfileOpen) }} title="Profile"
              style={{ ...iconBtnStyle, boxShadow: isProfileOpen ? 'var(--neu-inset)' : 'var(--neu-raised-sm)', color: isProfileOpen ? 'var(--accent)' : 'var(--text-dim)' }}
              onMouseEnter={e => { if (!isProfileOpen) onEnter(e) }}
              onMouseLeave={e => { if (!isProfileOpen) onLeave(e) }}>
              <User size={16} weight="regular" />
            </button>

            {/* Hamburger — hidden on desktop, shown via CSS on mobile */}
            <button
              className="mobile-menu-btn"
              onClick={() => setMobileMenuOpen(o => !o)}
              style={{ display: 'none' }}
            >
              {mobileMenuOpen ? '✕' : '☰'}
            </button>
          </div>
        </header>

        {/* Mobile nav dropdown */}
        {mobileMenuOpen && (
          <div className="mobile-nav-dropdown">
            {NAV_TABS.map(({ path, label }) => (
              <NavLink
                key={path}
                to={path}
                onClick={(e) => { handleNavClick(e, path); setMobileMenuOpen(false) }}
                className={({ isActive }) => isActive ? 'active' : ''}
              >
                {label}
              </NavLink>
            ))}
          </div>
        )}
      </div>

      {/* Unsaved changes modal */}
      {pendingPath && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1100,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.06)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          animation: 'fadeIn 0.15s ease',
        }}>
          <div style={{
            background: 'var(--bg)',
            boxShadow: 'var(--neu-raised-lg, var(--neu-raised))',
            borderRadius: '24px',
            padding: '28px 28px 24px',
            width: '340px',
            maxWidth: '90vw',
            animation: 'slideUp 0.18s ease',
          }}>
            {/* Icon + Title */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <div style={{
                width: 36, height: 36, borderRadius: '10px',
                background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <Warning size={18} weight="fill" color="#F59E0B" />
              </div>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '16px', color: 'var(--text)' }}>
                Unsaved changes
              </span>
            </div>

            {/* Body */}
            <p style={{ fontSize: '13px', color: 'var(--text-dim)', lineHeight: 1.6, margin: '0 0 24px', paddingLeft: '46px' }}>
              You have unsaved changes on this page. Leave without saving?
            </p>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button onClick={() => setPendingPath(null)} style={{
                height: '36px', padding: '0 20px', borderRadius: '100px',
                border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
                background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)',
                color: 'var(--text-dim)', fontFamily: 'inherit',
                transition: 'box-shadow 0.15s',
              }}
                onMouseEnter={e => e.currentTarget.style.color = 'var(--text)'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--text-dim)'}
              >
                Stay
              </button>
              <button onClick={() => {
                window.__staaxDirty = false
                const dest = pendingPath
                setPendingPath(null)
                navigate(dest)
              }} style={{
                height: '36px', padding: '0 20px', borderRadius: '100px',
                border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
                background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)',
                color: '#FF4444', fontFamily: 'inherit',
                transition: 'box-shadow 0.15s',
              }}
                onMouseDown={e => e.currentTarget.style.boxShadow = 'var(--neu-inset)'}
                onMouseUp={e => e.currentTarget.style.boxShadow = 'var(--neu-raised-sm)'}
                onMouseLeave={e => e.currentTarget.style.boxShadow = 'var(--neu-raised-sm)'}
              >
                Leave
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
