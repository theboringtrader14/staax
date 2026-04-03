import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authAPI } from '@/services/api'
import { useStore } from '@/store'

export default function LoginPage() {
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const navigate = useNavigate()
  const login = useStore(s => s.login)

  const handleLogin = async () => {
    if (!password.trim()) {
      setError('Enter your password')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await authAPI.login('karthikeyan', password)
      const token = res.data.access_token
      login(token)
      navigate('/dashboard', { replace: true })
    } catch (err: any) {
      const msg = err?.response?.data?.detail || 'Login failed. Check your password.'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-primary)',
      backgroundImage:
        'radial-gradient(ellipse at 20% 50%, rgba(255,107,0,0.08) 0%, transparent 50%), ' +
        'radial-gradient(ellipse at 80% 50%, rgba(204,68,0,0.05) 0%, transparent 50%)',
    }}>
      <div style={{ width: '360px' }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: '42px', fontWeight: 800, color: 'var(--ox-radiant)', letterSpacing: '0.08em' }}>
            STAAX
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
            Algo Trading Platform
          </div>
        </div>

        {/* Card */}
        <div className="card" style={{ border: '0.5px solid rgba(255,107,0,0.30)' }}>
          <div style={{ marginBottom: '20px' }}>
            <label style={{
              fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600,
              letterSpacing: '0.08em', textTransform: 'uppercase',
              display: 'block', marginBottom: '8px',
            }}>
              Password
            </label>
            <input
              className="staax-input"
              type="password"
              placeholder="Enter platform password"
              value={password}
              onChange={e => { setPassword(e.target.value); setError('') }}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              autoFocus
              disabled={loading}
            />
            {error && (
              <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--red)', fontWeight: 600 }}>
                {error}
              </div>
            )}
          </div>

          <button
            className="btn btn-primary"
            style={{ width: '100%', padding: '10px', fontSize: '14px', fontWeight: 700 }}
            onClick={handleLogin}
            disabled={loading}
          >
            {loading ? 'Logging in...' : 'Enter STAAX'}
          </button>
        </div>

        <div style={{ textAlign: 'center', marginTop: '20px', fontSize: '11px', color: 'var(--text-dim)' }}>
          Personal platform · Not for distribution
        </div>
      </div>
    </div>
  )
}
