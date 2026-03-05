import { useStore } from '@/store'
import { useState, useEffect } from 'react'

const ACCOUNTS = ['All Accounts','Karthik','Mom']
const LIVE_PNL = 4320

const NOTIFICATIONS = [
  { type:'error',   time:'09:17', msg:'AWS-1 · L3 · Order type rejection — LIMIT not accepted' },
  { type:'warn',    time:'09:15', msg:'TF-BUY · MTM SL at 85% — ₹4,250 / ₹5,000' },
  { type:'success', time:'09:12', msg:'AWS-1 · L1 · ORB High breakout — order placed' },
  { type:'info',    time:'09:00', msg:'Zerodha token refreshed successfully' },
  { type:'error',   time:'08:55', msg:'Backend API connection retry #2' },
]

const NOTIF_COLOR: Record<string,string> = {
  error:'var(--red)', warn:'var(--amber)', success:'var(--green)', info:'var(--accent-blue)'
}

export default function TopBar() {
  const isPractixMode = useStore(s => s.isPractixMode)
  const setIsPractixMode = useStore(s => s.setIsPractixMode)
  const [isPractix, setIsPractix]         = useState(true)
  const [activeAccount, setActiveAccount] = useState('All Accounts')
  const [time, setTime]                   = useState(new Date())
  const [showNotif, setShowNotif]         = useState(false)

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    document.title = `STAAX ${LIVE_PNL >= 0 ? '+' : ''}₹${LIVE_PNL.toLocaleString('en-IN')}`
    return () => clearInterval(t)
  }, [])

  const timeStr = time.toLocaleTimeString('en-IN', {
    hour:'2-digit', minute:'2-digit', second:'2-digit', timeZone:'Asia/Kolkata', hour12:true
  })

  const unread = NOTIFICATIONS.filter(n => n.type === 'error').length

  return (
    <>
      <header style={{
        height:'52px', minHeight:'52px',
        background:'var(--bg-secondary)',
        borderBottom:'1px solid var(--bg-border)',
        display:'flex', alignItems:'center',
        justifyContent:'space-between',
        padding:'0 24px', gap:'16px',
      }}>
        {/* Left */}
        <div style={{ display:'flex', alignItems:'center', gap:'16px' }}>
          <span style={{ color:'var(--text-muted)', fontSize:'13px' }}>
            Welcome, <span style={{ color:'var(--text)', fontWeight:600 }}>Karthikeyan</span>
          </span>
          <span style={{ color:'var(--bg-border)' }}>|</span>
          <span style={{ fontSize:'12px', color:'var(--text-muted)', fontFamily:'monospace' }}>IST {timeStr}</span>
          <span style={{ color:'var(--bg-border)' }}>|</span>
          <span style={{ fontSize:'13px', fontWeight:700, color: LIVE_PNL >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {LIVE_PNL >= 0 ? '+' : ''}₹{LIVE_PNL.toLocaleString('en-IN')}
          </span>
        </div>

        {/* Right */}
        <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
          {/* Account selector — no "Account:" label */}
          <select className="staax-select" value={activeAccount}
            onChange={e => setActiveAccount(e.target.value)}
            style={{ width:'150px', fontSize:'12px' }}>
            {ACCOUNTS.map(a => <option key={a}>{a}</option>)}
          </select>

          {/* PRACTIX toggle — matches btn-h */}
          <button onClick={() => setIsPractix(!isPractix)} style={{
            display:'flex', alignItems:'center', gap:'8px',
            height:'var(--btn-h)',
            background: isPractix ? 'rgba(215,123,18,0.12)' : 'rgba(34,197,94,0.12)',
            border:`1px solid ${isPractix ? 'rgba(215,123,18,0.4)' : 'rgba(34,197,94,0.4)'}`,
            borderRadius:'5px', padding:'0 12px',
            color: isPractix ? 'var(--accent-amber)' : 'var(--green)',
            fontSize:'11px', fontWeight:'700', letterSpacing:'0.08em', cursor:'pointer',
          }}>
            <span style={{
              width:'6px', height:'6px', borderRadius:'50%',
              background: isPractix ? 'var(--accent-amber)' : 'var(--green)',
              boxShadow: isPractix ? '0 0 6px var(--accent-amber)' : '0 0 6px var(--green)',
            }} />
            {isPractix ? 'PRACTIX' : 'LIVE'}
          </button>

          {/* Bell — same height as other buttons */}
          <button onClick={() => setShowNotif(!showNotif)} style={{
            background: showNotif ? 'rgba(0,176,240,0.12)' : 'var(--bg-surface)',
            border:`1px solid ${showNotif ? 'var(--accent-blue)' : 'var(--bg-border)'}`,
            borderRadius:'5px', width:'var(--btn-h)', height:'var(--btn-h)',
            display:'flex', alignItems:'center', justifyContent:'center',
            cursor:'pointer', color:'var(--text-muted)', fontSize:'15px', position:'relative',
          }}>
            🔔
            {unread > 0 && (
              <span style={{ position:'absolute', top:'5px', right:'5px',
                width:'7px', height:'7px', borderRadius:'50%', background:'var(--red)' }} />
            )}
          </button>
        </div>
      </header>

      {/* Notification slide-in panel */}
      {showNotif && (
        <div className="notif-panel">
          <div style={{ padding:'14px 16px', borderBottom:'1px solid var(--bg-border)',
            display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <span style={{ fontWeight:700, fontSize:'13px' }}>Notifications</span>
            <button onClick={() => setShowNotif(false)}
              style={{ background:'none', border:'none', cursor:'pointer',
                color:'var(--text-muted)', fontSize:'14px' }}>✕</button>
          </div>
          <div style={{ padding:'8px 0' }}>
            {NOTIFICATIONS.map((n, i) => (
              <div key={i} style={{ padding:'10px 16px', borderBottom:'1px solid rgba(63,65,67,0.4)',
                borderLeft:`3px solid ${NOTIF_COLOR[n.type]}`,
                animation:'fadeIn 0.15s ease', marginBottom:'1px' }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'3px' }}>
                  <span style={{ fontSize:'10px', fontWeight:700, color:NOTIF_COLOR[n.type],
                    textTransform:'uppercase' }}>{n.type}</span>
                  <span style={{ fontSize:'10px', color:'var(--text-dim)' }}>{n.time}</span>
                </div>
                <div style={{ fontSize:'12px', color:'var(--text-muted)', lineHeight:1.4 }}>{n.msg}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
