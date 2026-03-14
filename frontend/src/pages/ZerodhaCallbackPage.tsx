import { useEffect, useState } from 'react'
import { accountsAPI } from '@/services/api'

export default function ZerodhaCallbackPage() {
  const [status, setStatus] = useState<'loading'|'success'|'error'>('loading')
  const [msg, setMsg]       = useState('Exchanging token with Zerodha...')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const requestToken = params.get('request_token')
    const loginStatus  = params.get('status')

    if (loginStatus !== 'success' || !requestToken) {
      setStatus('error')
      setMsg('Login failed or cancelled. Please try again.')
      return
    }

    accountsAPI.zerodhaSetToken(requestToken)
      .then(() => {
        setStatus('success')
        setMsg('✅ Zerodha connected! You can close this tab.')
        // Notify opener (Dashboard) that token is set
        if (window.opener) {
          window.opener.postMessage({ type: 'ZERODHA_TOKEN_SET' }, '*')
        }
        setTimeout(() => window.close(), 2000)
      })
      .catch(err => {
        setStatus('error')
        setMsg('Token exchange failed: ' + (err?.response?.data?.detail || 'Unknown error'))
      })
  }, [])

  const color = status === 'success' ? '#22c55e' : status === 'error' ? '#ef4444' : '#00B0F0'

  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: '#2A2C2E', color: '#e5e7eb', fontFamily: 'Dubai, sans-serif',
      gap: '16px',
    }}>
      <svg width="48" height="48" viewBox="0 0 32 32" fill="none">
        <path d="M16 2L28 9V23L16 30L4 23V9L16 2Z" fill="rgba(0,176,240,0.15)" stroke="#00B0F0" strokeWidth="1.2"/>
        <polyline points="11,12 16,10 21,12 11,20 16,22 21,20" fill="none" stroke="#00B0F0" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      <div style={{ fontSize: '18px', fontWeight: 600, color }}>
        {status === 'loading' ? 'STAAX — Connecting Zerodha' : status === 'success' ? 'Connected!' : 'Connection Failed'}
      </div>
      <div style={{ fontSize: '13px', color: '#9ca3af', maxWidth: '320px', textAlign: 'center' }}>{msg}</div>
      {status === 'loading' && (
        <div style={{ width: '32px', height: '32px', border: '3px solid rgba(0,176,240,0.2)', borderTop: '3px solid #00B0F0', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }}/>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
