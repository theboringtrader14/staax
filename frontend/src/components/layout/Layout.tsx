import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import { useWebSocket } from '@/hooks/useWebSocket'

export default function Layout() {
  // Mount WebSocket connections for the entire session
  useWebSocket()

  return (
    <div style={{
      display: 'flex', minHeight: '100vh', position: 'relative',
      /* Outer neon frame */
      border: '1px solid rgba(99,102,241,0.55)',
      borderRadius: '16px',
      overflow: 'hidden',
      margin: '6px',
      boxShadow:
        '0 0 0 1px rgba(99,102,241,0.25), ' +
        '0 0 40px rgba(99,102,241,0.35), ' +
        '0 0 80px rgba(99,102,241,0.18), ' +
        '0 0 160px rgba(99,102,241,0.08), ' +
        '0 0 240px rgba(167,139,250,0.06), ' +
        'inset 0 1px 0 rgba(167,139,250,0.25), ' +
        'inset 0 -1px 0 rgba(99,102,241,0.15), ' +
        'inset 1px 0 0 rgba(99,102,241,0.12), ' +
        'inset -1px 0 0 rgba(99,102,241,0.12)',
    }}>
      {/* Ambient orbs — fixed, behind all content */}
      {/* Top-right: indigo orb */}
      <div style={{
        position:'fixed', top:'-15%', right:'-8%',
        width:'700px', height:'700px', borderRadius:'50%',
        background:'radial-gradient(circle, rgba(99,102,241,0.18) 0%, rgba(99,102,241,0.06) 40%, transparent 70%)',
        pointerEvents:'none', zIndex:0,
      }} />
      {/* Bottom-left: sky orb */}
      <div style={{
        position:'fixed', bottom:'-10%', left:'5%',
        width:'800px', height:'800px', borderRadius:'50%',
        background:'radial-gradient(circle, rgba(56,189,248,0.12) 0%, rgba(56,189,248,0.04) 40%, transparent 70%)',
        pointerEvents:'none', zIndex:0,
      }} />
      {/* Center: subtle violet */}
      <div style={{
        position:'fixed', top:'35%', left:'30%',
        width:'500px', height:'500px', borderRadius:'50%',
        background:'radial-gradient(circle, rgba(167,139,250,0.07) 0%, transparent 65%)',
        pointerEvents:'none', zIndex:0,
      }} />
      {/* Top-left: deep blue accent */}
      <div style={{
        position:'fixed', top:'-5%', left:'-5%',
        width:'400px', height:'400px', borderRadius:'50%',
        background:'radial-gradient(circle, rgba(56,189,248,0.1) 0%, transparent 70%)',
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
