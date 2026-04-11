import { useState, useEffect } from 'react'
import { useStore } from '../../store'
import { systemAPI } from '../../services/api'

export default function TopBar() {
  const isPractixMode   = useStore(s => s.isPractixMode)
  const setIsPractixMode = useStore(s => s.setIsPractixMode)
  const livePnl         = useStore(s => s.livePnl)
  const setLivePnl      = useStore(s => s.setLivePnl)
  const logout          = useStore((s: any) => s.logout)
  const [time, setTime] = useState(new Date())

  useEffect(() => { const t = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(t) }, [])

  useEffect(() => {
    const poll = () => {
      systemAPI.stats().then(res => {
        const mtm = res.data?.mtm_total ?? res.data?.today_pnl ?? 0
        if (typeof mtm === 'number') setLivePnl(mtm)
      }).catch(() => {})
    }
    poll(); const t = setInterval(poll, 5000); return () => clearInterval(t)
  }, []) // eslint-disable-line

  useEffect(() => {
    const rupee = String.fromCharCode(0x20B9)
    document.title = `STAAX ${livePnl >= 0 ? '+' : ''}${rupee}${livePnl.toLocaleString('en-IN')}`
  }, [livePnl])

  const timeStr = time.toLocaleTimeString('en-IN', {
    hour:'2-digit', minute:'2-digit', second:'2-digit',
    timeZone:'Asia/Kolkata', hour12:true,
  })

  return (
    <header style={{
      height:'52px', minHeight:'52px',
      background:'rgba(10,10,11,0.94)',
      borderBottom:'0.5px solid rgba(255,107,0,0.16)',
      backdropFilter:'blur(20px)', WebkitBackdropFilter:'blur(20px)',
      display:'flex', alignItems:'center', justifyContent:'space-between',
      padding:'0 24px', gap:'16px',
      position:'sticky', top:0, zIndex:50,
    }}>

      {/* Left — welcome + IST time (P&L removed) */}
      <div style={{ display:'flex', alignItems:'center', gap:'14px' }}>
        <span className="topbar-welcome" style={{ color:'rgba(240,237,232,0.38)', fontSize:'12px' }}>
          Welcome, <span style={{ color:'#F0EDE8', fontWeight:600 }}>Karthikeyan</span>
        </span>
        <span style={{ width:'1px', height:'16px', background:'rgba(255,107,0,0.20)' }} />
        <span className="topbar-clock" style={{ fontSize:'12px', fontFamily:'var(--font-mono)', color:'var(--ox-radiant)', letterSpacing:'0.04em' }}>
          IST {timeStr}
        </span>
      </div>

{/* Right — PRACTIX toggle + Exit */}
      <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>

        {/* PRACTIX / LIVE pill */}
        <button onClick={() => setIsPractixMode(!isPractixMode)} style={{
          display:'flex', alignItems:'center', gap:'7px',
          height:'var(--btn-h)',
          background: isPractixMode ? 'rgba(245,158,11,0.10)' : 'rgba(255,68,68,0.10)',
          border: `0.5px solid ${isPractixMode ? 'rgba(245,158,11,0.35)' : 'rgba(255,68,68,0.35)'}`,
          borderRadius:'20px', padding:'0 14px',
          color: isPractixMode ? '#f59e0b' : '#FF4444',
          fontSize:'11px', fontWeight:700, letterSpacing:'0.08em',
          cursor:'pointer', transition:'all 0.2s ease',
          boxShadow: isPractixMode ? '0 0 10px rgba(245,158,11,0.20)' : '0 0 10px rgba(255,68,68,0.20)',
        }}>
          <span style={{
            width:'6px', height:'6px', borderRadius:'50%', flexShrink:0,
            background: isPractixMode ? '#f59e0b' : '#FF4444',
            boxShadow: isPractixMode ? '0 0 6px #f59e0b,0 0 12px #f59e0b' : '0 0 6px #FF4444,0 0 12px #FF4444',
            animation: !isPractixMode ? 'glowPulse 1.5s infinite' : 'none',
          }} />
          {isPractixMode ? 'PRACTIX' : 'LIVE'}
        </button>

        {/* Exit to LIFEX — replaces sidebar logout */}
        <button
          onClick={() => { logout(); window.location.href = 'https://lifexos.co.in' }}
          title="Exit to LIFEX"
          style={{
            display:'flex', alignItems:'center', justifyContent:'center',
            width:'32px', height:'32px', borderRadius:'9px',
            background:'rgba(255,255,255,0.03)',
            border:'0.5px solid rgba(255,255,255,0.08)',
            cursor:'pointer', color:'rgba(240,237,232,0.38)',
            transition:'all 0.18s ease', flexShrink:0,
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.color = '#FF4444'
            ;(e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,68,68,0.10)'
            ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,68,68,0.30)'
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.color = 'rgba(240,237,232,0.38)'
            ;(e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.03)'
            ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.08)'
          }}
        >
          {/* Exit door icon — arrow leaving a box */}
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
        </button>
      </div>
    </header>
  )
}
