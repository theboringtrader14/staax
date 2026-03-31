import { NavLink, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useStore } from '../../store'

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
const IconPlus = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
)
const IconBarChart = () => (
  <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="10" width="4" height="11" rx="1"/>
    <rect x="10" y="4" width="4" height="17" rx="1"/>
    <rect x="17" y="7" width="4" height="14" rx="1"/>
  </svg>
)

const nav = [
  { path: '/dashboard',  label: 'Dashboard',      Icon: IconHome        },
  { path: '/grid',       label: 'Smart Grid',      Icon: IconGrid        },
  { path: '/algo/new',   label: 'New Algo',        Icon: IconPlus        },
  { path: '/orders',     label: 'Orders',          Icon: IconList        },
  { path: '/indicators', label: 'Indicator Bots',  Icon: IconCandlestick },
  { path: '/reports',    label: 'Reports',         Icon: IconChart       },
  { path: '/analytics',  label: 'Analytics',       Icon: IconBarChart    },
  { path: '/accounts',   label: 'Accounts',        Icon: IconUser        },
]

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar_collapsed') === 'true')
  const logout = useStore((s: any) => s.logout)
  const [pendingPath, setPendingPath] = useState<string | null>(null)
  const navigate = useNavigate()
  const toggle = (v: boolean) => { setCollapsed(v); localStorage.setItem('sidebar_collapsed', String(v)) }

  const [hasBotActivity, setHasBotActivity] = useState(false)
  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) return
    fetch('http://localhost:8000/api/v1/bots/signals/today', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(d => setHasBotActivity((d?.signals || []).some((s: any) => s.status === 'fired')))
      .catch(() => {})
  }, [])
  const W = collapsed ? '56px' : '216px'

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
        background: 'rgba(5,5,16,0.95)',
        borderRight: '1px solid rgba(99,102,241,0.15)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
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
          borderBottom: '1px solid rgba(99,102,241,0.12)',
          flexShrink: 0, cursor: 'pointer', userSelect: 'none',
        }}>
          {!collapsed && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {/* LIFEX logo mark */}
              <div style={{ width: 28, height: 28, borderRadius: '7px', background: 'linear-gradient(135deg, #6366f1, #a78bfa)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 0 12px rgba(99,102,241,0.5)' }}>
                <span style={{ fontSize: '13px', fontWeight: 800, color: '#fff', fontFamily: 'monospace', letterSpacing: '-0.5px' }}>LX</span>
              </div>
              <div style={{ opacity: 1, transition: 'opacity 0.15s ease', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                <div style={{
                  fontFamily: "'ADLaM Display', serif", fontSize: '17px', letterSpacing: '0.08em', lineHeight: 1,
                  background: 'linear-gradient(135deg, #fff 0%, #a78bfa 55%, #38bdf8 100%)',
                  WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
                }}>STAAX</div>
                <div style={{ fontSize: '8px', color: 'rgba(99,102,241,0.7)', marginTop: '1px', letterSpacing: '0.2em', textTransform: 'uppercase', fontWeight: 600 }}>LIFEX MODULE</div>
              </div>
            </div>
          )}
          {collapsed && (
            <div style={{ width: 28, height: 28, borderRadius: '7px', background: 'linear-gradient(135deg, #6366f1, #a78bfa)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 12px rgba(99,102,241,0.4)' }}>
              <span style={{ fontSize: '11px', fontWeight: 800, color: '#fff', fontFamily: 'monospace' }}>LX</span>
            </div>
          )}
        </div>

        {/* Nav links */}
        <div style={{ flex: 1, paddingTop: '6px' }}>
          {nav.map(({ path, label, Icon }) => (
            <NavLink key={path} to={path} title={collapsed ? label : undefined}
              onClick={(e) => handleNavClick(e, path)}
              style={({ isActive }) => ({
                display: 'flex', alignItems: 'center',
                justifyContent: collapsed ? 'center' : 'flex-start',
                padding: '9px 0',
                textDecoration: 'none',
                color: isActive ? '#a78bfa' : path === '/algo/new' ? '#f59e0b' : 'rgba(232,232,248,0.4)',
                background: isActive ? 'rgba(99,102,241,0.1)' : 'transparent',
                borderLeft: isActive && !collapsed ? '3px solid #6366f1' : '3px solid transparent',
                paddingLeft: isActive && !collapsed ? 'calc(0px)' : undefined,
                fontSize: '13px', transition: 'all 0.2s ease',
                fontWeight: isActive ? '600' : '400', whiteSpace: 'nowrap',
                position: 'relative',
              })}>
              <span style={{ width: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, position: 'relative' }}>
                <Icon />
                {path === '/indicators' && hasBotActivity && (
                  <span style={{ position: 'absolute', top: '-2px', right: '6px', width: '7px', height: '7px', borderRadius: '50%', background: '#10b981', boxShadow: '0 0 6px #10b981', animation: 'pulse 1.5s infinite' }} />
                )}
              </span>
              <span style={{ paddingRight: collapsed ? 0 : '16px', maxWidth: collapsed ? 0 : '200px', opacity: collapsed ? 0 : 1, transition: 'opacity 0.15s ease, max-width 0.18s ease, padding 0.18s ease', overflow: 'hidden', whiteSpace: 'nowrap', display: 'block' }}>
                {label}
              </span>
            </NavLink>
          ))}
        </div>

        {/* Footer */}
        <div style={{ borderTop: '1px solid rgba(99,102,241,0.12)' }}>
          {/* Module badge */}
          {!collapsed && (
            <div style={{ padding: '8px 20px 4px', fontSize: '8px', color: 'rgba(99,102,241,0.5)', letterSpacing: '0.2em', textTransform: 'uppercase', fontWeight: 700 }}>
              STAAX · v0.1.0 · Phase 1F
            </div>
          )}
          {/* Logout */}
          <button onClick={logout} title="Logout" style={{
            width: '100%', display: 'flex', alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            gap: '10px', padding: collapsed ? '10px 0' : '8px 20px',
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'rgba(232,232,248,0.35)', fontSize: '13px', fontWeight: 500,
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#ef4444'; (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.06)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(232,232,248,0.35)'; (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            {!collapsed && <span>Logout</span>}
          </button>
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
