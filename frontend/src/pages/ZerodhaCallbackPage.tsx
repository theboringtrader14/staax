import { useEffect, useState } from 'react'
import { CheckCircle, XCircle } from '@phosphor-icons/react'

export default function ZerodhaCallbackPage() {
  const [status, setStatus] = useState<'connecting' | 'success' | 'error'>('connecting')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const requestToken = params.get('request_token')

    if (!requestToken) {
      setStatus('error')
      return
    }

    const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'
    fetch(`${API_BASE}/api/v1/accounts/zerodha/callback?request_token=${encodeURIComponent(requestToken)}`)
      .then(res => {
        if (res.ok) {
          setStatus('success')
          try { window.opener?.location.reload() } catch (_) {}
          setTimeout(() => {
            try { window.close() } catch (_) {}
            try { window.open('', '_self')?.close() } catch (_) {}
          }, 2000)
        } else {
          setStatus('error')
        }
      })
      .catch(() => setStatus('error'))
  }, [])

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: '#0f0f12',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: 16,
    }}>
      {status === 'connecting' && (
        <>
          <div style={{ width: 40, height: 40, border: '3px solid rgba(255,107,0,0.2)', borderTopColor: '#FF6B00', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          <p style={{ color: 'rgba(232,232,248,0.6)', fontFamily: 'Syne', fontSize: 14 }}>Connecting Zerodha...</p>
        </>
      )}
      {status === 'success' && (
        <>
          <CheckCircle size={52} weight="fill" color="#0ea66e" />
          <p style={{ color: '#22DD88', fontFamily: 'Syne', fontWeight: 700, fontSize: 18 }}>Zerodha Connected</p>
          <p style={{ color: 'rgba(232,232,248,0.4)', fontFamily: 'Syne', fontSize: 13 }}>Closing window...</p>
          <button
            onClick={() => window.close()}
            style={{ marginTop: 8, padding: '6px 16px', borderRadius: 8, border: '0.5px solid rgba(34,221,136,0.4)', background: 'transparent', color: '#22DD88', fontFamily: 'Syne', fontSize: 12, cursor: 'pointer' }}
          >Close Window</button>
        </>
      )}
      {status === 'error' && (
        <>
          <XCircle size={52} weight="fill" color="#FF4444" />
          <p style={{ color: '#FF4444', fontFamily: 'Syne', fontWeight: 700, fontSize: 18 }}>Connection Failed</p>
          <button onClick={() => window.close()} style={{ marginTop: 8, padding: '8px 20px', borderRadius: 8, border: '0.5px solid rgba(255,68,68,0.4)', background: 'transparent', color: '#FF4444', fontFamily: 'Syne', cursor: 'pointer' }}>Close</button>
        </>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
