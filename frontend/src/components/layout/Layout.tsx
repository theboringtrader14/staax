import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import { useWebSocket } from '@/hooks/useWebSocket'

export default function Layout() {
  // Mount WebSocket connections for the entire session
  useWebSocket()

  return (
    <div style={{ display:'flex', minHeight:'100vh', position:'relative' }}>
      {/* Ambient orbs — fixed, behind all content */}
      <div style={{
        position:'fixed', top:'-10%', right:'-5%',
        width:'500px', height:'500px', borderRadius:'50%',
        background:'radial-gradient(circle, rgba(99,102,241,0.06) 0%, transparent 70%)',
        pointerEvents:'none', zIndex:0,
      }} />
      <div style={{
        position:'fixed', bottom:'-5%', left:'10%',
        width:'600px', height:'600px', borderRadius:'50%',
        background:'radial-gradient(circle, rgba(56,189,248,0.04) 0%, transparent 70%)',
        pointerEvents:'none', zIndex:0,
      }} />
      <Sidebar />
      <div style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column', position:'relative', zIndex:1 }}>
        <TopBar />
        <main style={{ flex:1, padding:'20px 24px' }}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
