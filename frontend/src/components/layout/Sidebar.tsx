import { NavLink } from 'react-router-dom'
import { useState } from 'react'

const nav = [
  { path:'/dashboard',   label:'Dashboard',         icon:'⬡'  },
  { path:'/grid',        label:'Smart Grid',         icon:'⊞'  },
  { path:'/orders',      label:'Orders',             icon:'☰'  },
  { path:'/reports',     label:'Reports',            icon:'◈'  },
  { path:'/accounts',    label:'Accounts',           icon:'◉'  },
  { path:'/indicators',  label:'Indicator Systems',  icon:'◧'  },
]

function StaaxLogo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Outer hexagon */}
      <path d="M16 2L28 9V23L16 30L4 23V9L16 2Z" fill="rgba(0,176,240,0.15)" stroke="#00B0F0" strokeWidth="1.2"/>
      {/* S-like zigzag mark */}
      <polyline points="11,12 16,10 21,12 11,20 16,22 21,20" fill="none" stroke="#00B0F0" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar_collapsed') === 'true')
  const toggle = (v: boolean) => { setCollapsed(v); localStorage.setItem('sidebar_collapsed', String(v)) }
  const W = collapsed ? '56px' : '216px'

  return (
    <nav style={{
      width: W, minWidth: W,
      background: 'var(--bg-secondary)',
      borderRight: '1px solid var(--bg-border)',
      display: 'flex', flexDirection: 'column',
      transition: 'width 0.18s ease, min-width 0.18s ease',
      overflow: 'hidden',
    }}>
      {/* Logo row */}
      <div style={{
        height: '52px',
        display: 'flex', alignItems: 'center',
        padding: collapsed ? '0' : '0 14px',
        justifyContent: collapsed ? 'center' : 'space-between',
        borderBottom: '1px solid var(--bg-border)',
        flexShrink: 0,
      }}>
        {!collapsed && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <StaaxLogo size={28} />
            <div>
              <div style={{ fontFamily:"'ADLaM Display', serif", fontSize: '20px', color: 'var(--accent-blue)', letterSpacing: '0.05em', lineHeight: 1 }}>STAAX</div>
              <div style={{ fontSize: '9px', color: 'var(--text-dim)', marginTop: '1px', letterSpacing: '0.14em' }}>ALGO TRADING</div>
            </div>
          </div>
        )}
        {collapsed && (
          <button onClick={() => toggle(false)} title="Click to expand"
            style={{ background:'none', border:'none', cursor:'pointer', padding:'0', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <StaaxLogo size={28} />
          </button>
        )}
        {!collapsed && (
          <button onClick={() => toggle(true)} title="Collapse sidebar"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: '16px', padding: '4px', lineHeight: 1, flexShrink: 0 }}>
            ‹
          </button>
        )}
      </div>

      {/* Nav links */}
      <div style={{ flex: 1, paddingTop: '6px' }}>
        {nav.map(item => (
          <NavLink key={item.path} to={item.path} title={collapsed ? item.label : undefined}
            style={({ isActive }) => ({
              display: 'flex', alignItems: 'center',
              justifyContent: collapsed ? 'center' : 'flex-start',
              padding: collapsed ? '11px 0' : '11px 0',
              textDecoration: 'none',
              color: isActive ? 'var(--accent-blue)' : 'var(--text-muted)',
              background: isActive ? 'rgba(0,176,240,0.08)' : 'transparent',
              borderLeft: isActive ? '2px solid var(--accent-blue)' : '2px solid transparent',
              fontSize: '13px',
              transition: 'all 0.12s',
              fontWeight: isActive ? '600' : '400',
              whiteSpace: 'nowrap',
            })}>
            <span style={{ width: '44px', textAlign: 'center', fontSize: '18px', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {item.icon}
            </span>
            {!collapsed && <span style={{ paddingRight: '16px' }}>{item.label}</span>}
          </NavLink>
        ))}
      </div>

      {/* Footer */}
      <div style={{ padding: collapsed ? '14px 0' : '14px 20px', borderTop: '1px solid var(--bg-border)', display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'space-between' }}>
        {!collapsed && <div style={{ fontSize: '10px', color: 'var(--text-dim)', letterSpacing: '0.05em' }}>v0.1.0 · Phase 1F</div>}
        <button onClick={() => toggle(!collapsed)} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: '16px', padding: '2px 4px', lineHeight: 1 }}>
          {collapsed ? '›' : '‹'}
        </button>
      </div>
    </nav>
  )
}
