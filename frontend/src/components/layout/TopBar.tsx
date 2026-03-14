import { useStore } from '@/store'
import { eventsAPI } from '@/services/api'
import { useState, useEffect } from 'react'

const NOTIF_COLOR: Record<string, string> = {
  error:   'var(--red)',
  warn:    'var(--amber)',
  success: 'var(--green)',
  info:    'var(--accent-blue)',
}

export default function TopBar() {
  const isPractixMode     = useStore(s => s.isPractixMode)
  const setIsPractixMode  = useStore(s => s.setIsPractixMode)
  const livePnl           = useStore(s => s.livePnl)
  const notifications     = useStore(s => s.notifications)
  const markAllRead       = useStore(s => s.markAllRead)
  const unreadCount       = useStore(s => s.unreadCount)
  const rawAccounts       = useStore(s => s.accounts)
  const activeAccount     = useStore(s => s.activeAccount)
  const setActiveAccount  = useStore(s => s.setActiveAccount)
  const logout            = useStore(s => s.logout)

  // Guard: ensure accounts is always a plain array regardless of what the API returned
  const accounts = Array.isArray(rawAccounts) ? rawAccounts : []

  const [time, setTime]           = useState(new Date())
  const [showNotif, setShowNotif] = useState(false)

  // Load persisted events from DB on mount
  useEffect(() => {
    eventsAPI.list(50)
      .then(res => {
        const rows = res.data || []
        rows.forEach((e: any) => addNotification({
          type: e.level === 'success' ? 'success' : e.level === 'warn' ? 'warn' : e.level === 'error' ? 'error' : 'info',
          title: e.algo_name || e.source || 'System',
          message: e.msg,
          time: e.ts ? new Date(e.ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '',
        }))
      })
      .catch(() => {})
  }, [])

  const handleExport = async () => {
    try {
      const res = await eventsAPI.export()
      const url = URL.createObjectURL(new Blob([JSON.stringify(res.data, null, 2)]))
      const a = document.createElement('a')
      a.href = url; a.download = 'staax_event_log.json'; a.click()
      URL.revokeObjectURL(url)
    } catch {}
  }

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    document.title = `STAAX ${livePnl >= 0 ? '+' : ''}₹${livePnl.toLocaleString('en-IN')}`
  }, [livePnl])

  const timeStr = time.toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZone: 'Asia/Kolkata', hour12: true,
  })

  const unread = unreadCount()

  const accountOptions = ['All Accounts', ...accounts.map((a: any) => a.nickname || a.name || a.id)]

  return (
    <>
      <header style={{
        height: '52px', minHeight: '52px',
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--bg-border)',
        display: 'flex', alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px', gap: '16px',
      }}>
        {/* Left */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
            Welcome, <span style={{ color: 'var(--text)', fontWeight: 600 }}>Karthikeyan</span>
          </span>
          <span style={{ color: 'var(--bg-border)' }}>|</span>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>IST {timeStr}</span>
          <span style={{ color: 'var(--bg-border)' }}>|</span>
          <span style={{ fontSize: '13px', fontWeight: 700, color: livePnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {livePnl >= 0 ? '+' : ''}₹{livePnl.toLocaleString('en-IN')}
          </span>
        </div>

        {/* Right */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <select
            className="staax-select"
            value={activeAccount || 'All Accounts'}
            onChange={e => setActiveAccount(e.target.value === 'All Accounts' ? null : e.target.value)}
            style={{ width: '150px', fontSize: '12px' }}
          >
            {accountOptions.map(a => <option key={a}>{a}</option>)}
          </select>

          <button onClick={() => setIsPractixMode(!isPractixMode)} style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            height: 'var(--btn-h)',
            background:  isPractixMode ? 'rgba(215,123,18,0.12)' : 'rgba(34,197,94,0.12)',
            border: `1px solid ${isPractixMode ? 'rgba(215,123,18,0.4)' : 'rgba(34,197,94,0.4)'}`,
            borderRadius: '5px', padding: '0 12px',
            color: isPractixMode ? 'var(--accent-amber)' : 'var(--green)',
            fontSize: '11px', fontWeight: '700', letterSpacing: '0.08em', cursor: 'pointer',
          }}>
            <span style={{
              width: '6px', height: '6px', borderRadius: '50%',
              background: isPractixMode ? 'var(--accent-amber)' : 'var(--green)',
              boxShadow: isPractixMode ? '0 0 6px var(--accent-amber)' : '0 0 6px var(--green)',
            }} />
            {isPractixMode ? 'PRACTIX' : 'LIVE'}
          </button>

          <button
            onClick={() => { setShowNotif(!showNotif); if (!showNotif) markAllRead() }}
            style={{
              background: showNotif ? 'rgba(0,176,240,0.12)' : 'var(--bg-surface)',
              border: `1px solid ${showNotif ? 'var(--accent-blue)' : 'var(--bg-border)'}`,
              borderRadius: '5px', width: 'var(--btn-h)', height: 'var(--btn-h)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: 'var(--text-muted)', fontSize: '15px', position: 'relative',
            }}
          >
            🔔
            {unread > 0 && (
              <span style={{
                position: 'absolute', top: '5px', right: '5px',
                width: '7px', height: '7px', borderRadius: '50%', background: 'var(--red)',
              }} />
            )}
          </button>

          <button
            onClick={logout}
            style={{
              background: 'transparent',
              border: '1px solid var(--bg-border)',
              borderRadius: '5px', height: 'var(--btn-h)',
              padding: '0 10px', cursor: 'pointer',
              color: 'var(--text-dim)', fontSize: '11px',
            }}
            title="Logout"
          >
            ⏏
          </button>
        </div>
      </header>

      {showNotif && (
        <div className="notif-panel">
          <div style={{
            padding: '14px 16px', borderBottom: '1px solid var(--bg-border)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span style={{ fontWeight: 700, fontSize: '13px' }}>Notifications</span>
            <div style={{ display:'flex', gap:'6px', alignItems:'center' }}>
              <button onClick={handleExport} title="Export log for debugging"
                style={{ background:'none', border:'1px solid var(--bg-border)', borderRadius:'4px', cursor:'pointer', color:'var(--text-dim)', fontSize:'10px', padding:'2px 6px' }}>↓ Export</button>
              <button onClick={() => setShowNotif(false)} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', fontSize: '14px',
            }}>✕</button>
            </div>
          </div>
          <div style={{ padding: '8px 0' }}>
            {notifications.length === 0 && (
              <div style={{ padding: '20px 16px', color: 'var(--text-dim)', fontSize: '12px', textAlign: 'center' }}>
                No notifications yet
              </div>
            )}
            {notifications.map(n => (
              <div key={n.id} style={{
                padding: '10px 16px', borderBottom: '1px solid rgba(63,65,67,0.4)',
                borderLeft: `3px solid ${NOTIF_COLOR[n.type]}`,
                animation: 'fadeIn 0.15s ease', marginBottom: '1px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '3px' }}>
                  <span style={{
                    fontSize: '10px', fontWeight: 700, color: NOTIF_COLOR[n.type], textTransform: 'uppercase',
                  }}>{n.type}</span>
                  <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>{n.time}</span>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.4 }}>{n.msg}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
