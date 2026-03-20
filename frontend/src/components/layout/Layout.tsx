import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import { useWebSocket } from '@/hooks/useWebSocket'

export default function Layout() {
  // Mount WebSocket connections for the entire session
  useWebSocket()

  return (
    <div style={{ display:'flex', minHeight:'100vh' }}>
      <Sidebar />
      <div style={{ flex:1, display:'flex', flexDirection:'column' }}>
        <TopBar />
        <main style={{ flex:1, padding:'20px 24px' }}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
