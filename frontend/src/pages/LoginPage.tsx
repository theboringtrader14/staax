import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

export default function LoginPage() {
  const [password, setPassword] = useState('')
  const navigate = useNavigate()

  return (
    <div style={{
      height:'100vh', display:'flex', alignItems:'center', justifyContent:'center',
      background:'var(--bg-primary)',
      backgroundImage:'radial-gradient(ellipse at 20% 50%, rgba(0,176,240,0.06) 0%, transparent 50%), radial-gradient(ellipse at 80% 50%, rgba(215,123,18,0.04) 0%, transparent 50%)',
    }}>
      <div style={{ width:'360px' }}>
        {/* Logo */}
        <div style={{ textAlign:'center', marginBottom:'40px' }}>
          <div style={{ fontFamily:"'ADLaM Display', serif", fontSize:'42px', color:'var(--accent-blue)', letterSpacing:'0.08em' }}>STAAX</div>
          <div style={{ fontSize:'12px', color:'var(--text-muted)', marginTop:'4px', letterSpacing:'0.15em', textTransform:'uppercase' }}>
            Algo Trading Platform
          </div>
        </div>

        {/* Card */}
        <div className="card" style={{ border:'1px solid rgba(0,176,240,0.2)' }}>
          <div style={{ marginBottom:'20px' }}>
            <label style={{ fontSize:'11px', color:'var(--text-muted)', fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', display:'block', marginBottom:'8px' }}>
              Password
            </label>
            <input
              className="staax-input"
              type="password"
              placeholder="Enter platform password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && navigate('/grid')}
              autoFocus
            />
          </div>

          <button
            className="btn btn-primary"
            style={{ width:'100%', padding:'10px', fontSize:'14px', fontWeight:700 }}
            onClick={() => navigate('/grid')}
          >
            Enter STAAX
          </button>
        </div>

        <div style={{ textAlign:'center', marginTop:'20px', fontSize:'11px', color:'var(--text-dim)' }}>
          Personal platform · Not for distribution
        </div>
      </div>
    </div>
  )
}
