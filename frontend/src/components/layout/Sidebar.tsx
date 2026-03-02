import { NavLink } from 'react-router-dom'

const navItems = [
  { path: '/grid',     label: 'Smart Grid',  icon: '⊞' },
  { path: '/orders',   label: 'Orders',      icon: '📋' },
  { path: '/algo',     label: 'Algo',        icon: '⚙️' },
  { path: '/reports',  label: 'Reports',     icon: '📊' },
  { path: '/accounts', label: 'Accounts',    icon: '👤' },
]

export default function Sidebar() {
  return (
    <nav style={{
      width: '200px', background: 'var(--bg-secondary)',
      display: 'flex', flexDirection: 'column', padding: '24px 0',
      borderRight: '1px solid #3A3C3E'
    }}>
      <div style={{ padding: '0 20px 32px', fontFamily: 'ADLaM Display', fontSize: '22px', color: 'var(--accent-blue)' }}>
        STAAX
      </div>
      {navItems.map(item => (
        <NavLink key={item.path} to={item.path} style={({ isActive }) => ({
          display: 'flex', alignItems: 'center', gap: '12px',
          padding: '12px 20px', textDecoration: 'none',
          color: isActive ? 'var(--accent-blue)' : 'var(--text-muted)',
          background: isActive ? 'rgba(0,176,240,0.1)' : 'transparent',
          borderLeft: isActive ? '3px solid var(--accent-blue)' : '3px solid transparent',
          fontSize: '14px', transition: 'all 0.15s',
        })}>
          <span>{item.icon}</span>
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
