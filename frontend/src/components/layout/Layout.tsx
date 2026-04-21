import { Outlet, NavLink } from 'react-router-dom'
import TopNav from './TopNav'
import { useWebSocket } from '@/hooks/useWebSocket'
import {
  House,
  GridFour,
  ClipboardText,
  ChartLine,
  Robot,
  User,
} from '@phosphor-icons/react'

export default function Layout() {
  useWebSocket()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', position: 'relative', background: 'transparent' }}>
      <TopNav />
      {/* 16px gap between floating pill and page content */}
      <main style={{ flex: 1, minHeight: 0, padding: '16px 24px 20px 24px', position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Outlet />
      </main>

      {/* Mobile bottom nav — ≤768px only, CSS class controls visibility */}
      <nav className="mobile-bottom-nav">
        {[
          { to: '/dashboard',  label: 'Dashboard', Icon: House         },
          { to: '/grid',       label: 'Algos',     Icon: GridFour      },
          { to: '/orders',     label: 'Orders',    Icon: ClipboardText },
          { to: '/reports',    label: 'Reports',   Icon: ChartLine     },
          { to: '/indicators', label: 'Bots',      Icon: Robot         },
          { to: '/accounts',   label: 'Accounts',  Icon: User          },
        ].map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => isActive ? 'mobile-nav-item active' : 'mobile-nav-item'}
          >
            <item.Icon size={20} weight="regular" />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
