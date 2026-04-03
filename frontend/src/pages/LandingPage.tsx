import React from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/store'
import { useEffect } from 'react'

const MODULES = [
  {
    id: 'STAAX',
    tagline: 'Algorithmic Trading Intelligence',
    description: 'Deploy, monitor, and analyse trading algorithms with real-time P&L, SmartStream execution, and per-algo analytics.',
    accent: '#6366f1',
    accentDim: 'rgba(99,102,241,0.12)',
    accentKey: 'indigo',
    status: 'LIVE',
    statusColor: '#10b981',
    path: '/dashboard',
  },
  {
    id: 'INVEX',
    tagline: 'Investment Portfolio Management',
    description: 'Track long-term holdings, rebalance portfolios, and visualise compound growth across equity and debt.',
    accent: '#10b981',
    accentDim: 'rgba(16,185,129,0.12)',
    accentKey: 'emerald',
    status: 'BETA',
    statusColor: '#f59e0b',
    path: null,
    externalUrl: 'http://localhost:3001',
  },
  {
    id: 'BUDGEX',
    tagline: 'Intelligent Budget Tracking',
    description: 'Categorise expenses, set smart budgets, and surface spending patterns with AI-powered insights.',
    accent: '#f59e0b',
    accentDim: 'rgba(245,158,11,0.12)',
    accentKey: 'amber',
    status: 'BETA',
    statusColor: '#f59e0b',
    path: null,
  },
  {
    id: 'HEALTHEX',
    tagline: 'Health & Fitness Intelligence',
    description: 'Log workouts, track nutrition, and monitor biomarkers with integrated wearable data.',
    accent: '#ef4444',
    accentDim: 'rgba(239,68,68,0.12)',
    accentKey: 'red',
    status: 'COMING SOON',
    statusColor: 'rgba(232,232,248,0.4)',
    path: null,
  },
  {
    id: 'GOALEX',
    tagline: 'Life Goals & Milestones',
    description: 'Define life goals, break them into milestones, and track progress with structured habit loops.',
    accent: '#38bdf8',
    accentDim: 'rgba(56,189,248,0.12)',
    accentKey: 'sky',
    status: 'COMING SOON',
    statusColor: 'rgba(232,232,248,0.4)',
    path: null,
  },
]

const STATS = [
  { value: '5', label: 'Modules' },
  { value: '3', label: 'Live Accounts' },
  { value: '24/7', label: 'Monitoring' },
  { value: '₹0', label: 'Setup Cost' },
  { value: '100%', label: 'Private' },
]

const TERMINAL_LINES = [
  { color: '#10b981', text: '✓ STAAX Engine  — connected' },
  { color: '#6366f1', text: '↻ SmartStream   — active [3 algos]' },
  { color: '#a78bfa', text: '⬡ Portfolio     — synced 08:42 IST' },
  { color: '#38bdf8', text: '⊕ Market open   — NSE/BSE live' },
  { color: '#f59e0b', text: '◈ Next algo     — NIFTY-BFLY 09:20' },
]

const CosmosBackground = () => (
  <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden' }}>
    <div className="cosmos-milkyway" />
    <div className="cosmos-nebula" />
    <div className="cosmos-stars-1" />
    <div className="cosmos-stars-2" />
    <div className="cosmos-stars-3" />
  </div>
)

export default function LandingPage() {
  const navigate = useNavigate()
  const isAuthenticated = useStore(s => s.isAuthenticated)

  useEffect(() => {
    if (isAuthenticated) navigate('/dashboard', { replace: true })
  }, [isAuthenticated, navigate])

  const handleEnter = () => navigate(isAuthenticated ? '/dashboard' : '/login')

  return (
    <div style={{
      minHeight: '100vh',
      background: '#050510',
      color: '#f0f0ff',
      fontFamily: "'DM Sans', sans-serif",
      overflowX: 'hidden',
      position: 'relative',
    }}>
      <CosmosBackground />

      {/* Dot grid overlay */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0,
        backgroundImage: 'radial-gradient(circle, rgba(99,102,241,0.06) 1px, transparent 1px)',
        backgroundSize: '28px 28px',
      }} />

      {/* Ambient orbs */}
      <div style={{
        position: 'fixed', top: '-200px', left: '-200px',
        width: '700px', height: '700px', borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(99,102,241,0.18) 0%, transparent 70%)',
        pointerEvents: 'none', zIndex: 0,
        animation: 'float 8s ease-in-out infinite',
      }} />
      <div style={{
        position: 'fixed', top: '30%', right: '-150px',
        width: '600px', height: '600px', borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(167,139,250,0.15) 0%, transparent 70%)',
        pointerEvents: 'none', zIndex: 0,
        animation: 'float 10s ease-in-out infinite reverse',
      }} />
      <div style={{
        position: 'fixed', bottom: '-100px', left: '30%',
        width: '500px', height: '500px', borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(56,189,248,0.12) 0%, transparent 70%)',
        pointerEvents: 'none', zIndex: 0,
        animation: 'float 12s ease-in-out infinite',
      }} />
      <div style={{
        position: 'fixed', bottom: '10%', right: '10%',
        width: '400px', height: '400px', borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(167,139,250,0.10) 0%, transparent 70%)',
        pointerEvents: 'none', zIndex: 0,
        animation: 'float 9s ease-in-out infinite reverse',
      }} />

      {/* Animations */}
      <style>{`
        @keyframes float {
          0%,100% { transform: translateY(0px); }
          50%      { transform: translateY(-30px); }
        }
        @keyframes fadeUp {
          from { opacity:0; transform:translateY(20px); }
          to   { opacity:1; transform:translateY(0); }
        }
        @keyframes glowPulse {
          0%,100% { opacity:1; }
          50%      { opacity:0.4; }
        }
        @keyframes scan {
          0%   { transform: translateY(-100%); opacity: 0; }
          10%  { opacity: 1; }
          90%  { opacity: 1; }
          100% { transform: translateY(600%); opacity: 0; }
        }
        .landing-module-card {
          position: relative;
          transition: all 0.25s ease;
        }
        .landing-module-card::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          padding: 1px;
          background: linear-gradient(135deg, rgba(99,102,241,0.3) 0%, transparent 40%, transparent 60%, rgba(167,139,250,0.15) 100%);
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor;
          mask-composite: exclude;
          pointer-events: none;
          opacity: 0.6;
          transition: opacity 0.25s ease;
        }
        .landing-module-card:hover { transform: translateY(-6px); }
        .landing-module-card:hover::before { opacity: 1; }
        .landing-module-card[data-accent="indigo"]:hover  { box-shadow: 0 0 40px rgba(99,102,241,0.2),  0 12px 40px rgba(0,0,0,0.5) !important; }
        .landing-module-card[data-accent="emerald"]:hover { box-shadow: 0 0 40px rgba(16,185,129,0.2),  0 12px 40px rgba(0,0,0,0.5) !important; }
        .landing-module-card[data-accent="amber"]:hover   { box-shadow: 0 0 40px rgba(245,158,11,0.2),  0 12px 40px rgba(0,0,0,0.5) !important; }
        .landing-module-card[data-accent="red"]:hover     { box-shadow: 0 0 40px rgba(239,68,68,0.2),   0 12px 40px rgba(0,0,0,0.5) !important; }
        .landing-module-card[data-accent="sky"]:hover     { box-shadow: 0 0 40px rgba(56,189,248,0.2),  0 12px 40px rgba(0,0,0,0.5) !important; }
        .landing-terminal { position: relative; overflow: hidden; }
        .landing-terminal::after {
          content: '';
          position: absolute;
          left: 0; right: 0;
          height: 60px;
          background: linear-gradient(to bottom, transparent, rgba(99,102,241,0.06), transparent);
          animation: scan 4s linear infinite;
          pointer-events: none;
        }
        .landing-cta-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 0 40px rgba(99,102,241,0.8) !important;
        }
        .landing-cta-ghost:hover {
          background: rgba(99,102,241,0.08) !important;
          border-color: rgba(99,102,241,0.4) !important;
          color: #f0f0ff !important;
        }
        .landing-nav-line {
          position: absolute;
          bottom: 0; left: 0; right: 0;
          height: 1px;
          background: linear-gradient(90deg, transparent, rgba(99,102,241,0.4), rgba(167,139,250,0.3), transparent);
        }
      `}</style>

      {/* Nav */}
      <nav style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(5,5,16,0.92)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        padding: '0 32px',
        height: '52px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div className="landing-nav-line" />
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '32px', height: '32px', borderRadius: '8px',
            background: 'linear-gradient(135deg, #6366f1, #a78bfa)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '13px', fontWeight: 800, color: '#fff',
            boxShadow: '0 0 16px rgba(99,102,241,0.5)',
          }}>LX</div>
          <div>
            <div style={{
              fontSize: '15px', fontWeight: 800, letterSpacing: '0.08em',
              background: 'linear-gradient(135deg, #fff, #a78bfa, #38bdf8)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>LIFEX</div>
            <div style={{ fontSize: '8px', fontWeight: 600, color: 'rgba(167,139,250,0.7)', letterSpacing: '0.15em', marginTop: '-2px' }}>
              INTELLIGENCE SUITE
            </div>
          </div>
        </div>

        {/* Nav actions */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            onClick={handleEnter}
            style={{
              background: 'transparent', border: '1px solid rgba(99,102,241,0.3)',
              color: 'rgba(232,232,248,0.8)', borderRadius: '6px',
              padding: '0 16px', height: '32px', fontSize: '12px', fontWeight: 600,
              cursor: 'pointer', transition: 'all 0.2s',
            }}
            className="landing-cta-ghost"
          >Sign In</button>
        </div>
      </nav>

      {/* Hero */}
      <section style={{
        position: 'relative', zIndex: 1,
        maxWidth: '1100px', margin: '0 auto',
        padding: '80px 32px 60px',
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '48px',
        alignItems: 'center',
        animation: 'fadeUp 0.6s ease both',
      }}>
        {/* Left: copy */}
        <div>
          {/* Badge */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)',
            borderRadius: '20px', padding: '4px 12px', fontSize: '11px', fontWeight: 600,
            color: '#a78bfa', marginBottom: '24px', letterSpacing: '0.05em',
          }}>
            <span style={{
              width: '6px', height: '6px', borderRadius: '50%',
              background: '#10b981',
              boxShadow: '0 0 6px #10b981',
              animation: 'glowPulse 2s ease-in-out infinite',
              display: 'inline-block',
            }} />
            LIVE — STAAX v2 running
          </div>

          <h1 style={{
            fontSize: '42px', fontWeight: 800, lineHeight: 1.15,
            letterSpacing: '-0.02em', marginBottom: '20px',
            textShadow: '0 0 40px rgba(255,107,0,0.15)',
          }}>
            <span style={{
              background: 'linear-gradient(135deg, #f0f0ff 0%, #a78bfa 50%, #38bdf8 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>Your Life.</span>
            <br />
            <span style={{ color: '#f0f0ff' }}>Intelligently</span>
            <br />
            <span style={{
              background: 'linear-gradient(135deg, #6366f1, #a78bfa)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>Managed.</span>
          </h1>

          <p style={{
            fontSize: '15px', color: 'rgba(232,232,248,0.65)',
            lineHeight: 1.7, marginBottom: '32px', maxWidth: '420px',
          }}>
            A private intelligence suite that unifies your trading, investments, budget, health, and goals — all in one beautiful dashboard.
          </p>

          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button
              onClick={handleEnter}
              style={{
                background: '#6366f1', border: 'none', color: '#fff',
                borderRadius: '8px', padding: '0 24px', height: '40px',
                fontSize: '13px', fontWeight: 700, cursor: 'pointer',
                boxShadow: '0 0 24px rgba(99,102,241,0.5)',
                transition: 'all 0.2s',
              }}
              className="landing-cta-primary"
            >Enter LIFEX →</button>
            <button
              style={{
                background: 'transparent', border: '1px solid rgba(99,102,241,0.25)',
                color: 'rgba(232,232,248,0.7)', borderRadius: '8px',
                padding: '0 24px', height: '40px', fontSize: '13px', fontWeight: 600,
                cursor: 'pointer', transition: 'all 0.2s',
              }}
              className="landing-cta-ghost"
            >View Roadmap</button>
          </div>
        </div>

        {/* Right: terminal widget */}
        <div className="landing-terminal" style={{
          background: 'rgba(2,2,8,0.9)',
          border: '1px solid rgba(99,102,241,0.25)',
          borderRadius: '12px',
          padding: '20px',
          boxShadow: '0 0 60px rgba(99,102,241,0.2), 0 0 120px rgba(99,102,241,0.08), 0 20px 60px rgba(0,0,0,0.8)',
        }}>
          {/* Terminal chrome */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '16px' }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ef4444' }} />
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#f59e0b' }} />
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#10b981' }} />
            <span style={{ marginLeft: '8px', fontSize: '11px', color: 'rgba(232,232,248,0.3)', fontFamily: "'DM Mono', monospace" }}>
              lifex — system status
            </span>
          </div>
          {TERMINAL_LINES.map((line, i) => (
            <div key={i} style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: '12px', color: line.color,
              marginBottom: '8px', lineHeight: 1.6,
              animation: `fadeUp 0.4s ease ${i * 0.1 + 0.2}s both`,
            }}>
              {line.text}
            </div>
          ))}
          <div style={{
            marginTop: '16px', paddingTop: '12px',
            borderTop: '1px solid rgba(99,102,241,0.1)',
            display: 'flex', alignItems: 'center', gap: '8px',
          }}>
            <span style={{ color: '#6366f1', fontFamily: "'DM Mono', monospace", fontSize: '12px' }}>❯</span>
            <span style={{
              fontFamily: "'DM Mono', monospace", fontSize: '12px',
              color: 'rgba(232,232,248,0.4)',
            }}>awaiting market open...</span>
            <span style={{
              width: '8px', height: '14px', background: 'rgba(99,102,241,0.6)',
              animation: 'glowPulse 1s ease-in-out infinite',
              display: 'inline-block',
            }} />
          </div>
        </div>
      </section>

      {/* Stats bar */}
      <div style={{
        position: 'relative', zIndex: 1,
        borderTop: '1px solid rgba(99,102,241,0.1)',
        borderBottom: '1px solid rgba(99,102,241,0.1)',
        background: 'rgba(99,102,241,0.03)',
        padding: '20px 32px',
      }}>
        <div style={{
          maxWidth: '1100px', margin: '0 auto',
          display: 'flex', justifyContent: 'space-around', flexWrap: 'wrap', gap: '16px',
        }}>
          {STATS.map((stat, i) => (
            <div key={i} style={{display:"contents"}}>
              {i > 0 && <div key={`div-${i}`} style={{ width: '1px', height: '40px', background: 'rgba(99,102,241,0.15)', alignSelf: 'center' }} />}
              <div key={stat.label} style={{ textAlign: 'center' }}>
                <div style={{
                  fontSize: '36px', fontWeight: 800, letterSpacing: '-0.02em',
                  fontFamily: "'DM Mono', monospace",
                  background: 'linear-gradient(135deg, #a78bfa, #38bdf8)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  filter: 'drop-shadow(0 0 12px rgba(167,139,250,0.4))',
                }}>{stat.value}</div>
                <div style={{ fontSize: '11px', color: 'rgba(232,232,248,0.5)', fontWeight: 600, letterSpacing: '0.05em', marginTop: '2px' }}>
                  {stat.label.toUpperCase()}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Module cards */}
      <section style={{
        position: 'relative', zIndex: 1,
        maxWidth: '1100px', margin: '0 auto',
        padding: '60px 32px',
      }}>
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <div style={{
            display: 'inline-block',
            fontSize: '10px', fontWeight: 700, letterSpacing: '0.15em',
            color: 'rgba(167,139,250,0.7)', textTransform: 'uppercase',
            marginBottom: '12px',
          }}>THE SUITE</div>
          <h2 style={{
            fontSize: '28px', fontWeight: 800, letterSpacing: '-0.02em',
            color: '#f0f0ff', marginBottom: '12px',
          }}>Five Modules. One Life.</h2>
          <p style={{ fontSize: '14px', color: 'rgba(232,232,248,0.55)', maxWidth: '500px', margin: '0 auto' }}>
            Every aspect of your financial and personal life, managed with the same intelligence and precision.
          </p>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '16px',
        }}>
          {MODULES.map(mod => (
            <div
              key={mod.id}
              className="landing-module-card"
              data-accent={mod.accentKey}
              onClick={() => {
                if (mod.path) navigate(mod.path)
                else if ('externalUrl' in mod && mod.externalUrl) window.open(mod.externalUrl, '_blank')
              }}
              style={{
                background: `rgba(10,10,26,0.7)`,
                border: `1px solid ${mod.accent}30`,
                borderRadius: '12px',
                padding: '20px',
                cursor: mod.path || ('externalUrl' in mod && mod.externalUrl) ? 'pointer' : 'default',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                borderTop: `2px solid ${mod.accent}`,
                boxShadow: `inset 0 1px 0 ${mod.accent}20, 0 4px 24px rgba(0,0,0,0.4)`,
              } as React.CSSProperties}
            >
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <div style={{
                  fontSize: '15px', fontWeight: 800, letterSpacing: '0.05em',
                  color: mod.accent,
                }}>{mod.id}</div>
                <span style={{
                  fontSize: '9px', fontWeight: 700, letterSpacing: '0.08em',
                  color: mod.statusColor,
                  background: `${mod.statusColor}18`,
                  border: `1px solid ${mod.statusColor}40`,
                  borderRadius: '20px', padding: '2px 7px',
                }}>{mod.status}</span>
              </div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#e8e8f8', marginBottom: '8px' }}>
                {mod.tagline}
              </div>
              <div style={{ fontSize: '11px', color: 'rgba(232,232,248,0.5)', lineHeight: 1.6 }}>
                {mod.description}
              </div>
              {(mod.path || ('externalUrl' in mod && mod.externalUrl)) && (
                <div style={{
                  marginTop: '14px', fontSize: '11px', fontWeight: 700,
                  color: mod.accent, display: 'flex', alignItems: 'center', gap: '4px',
                }}>
                  Open module →
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer style={{
        position: 'relative', zIndex: 1,
        borderTop: '1px solid rgba(99,102,241,0.1)',
        padding: '24px 32px',
        textAlign: 'center',
      }}>
        <div style={{
          fontSize: '13px', fontWeight: 800, letterSpacing: '0.1em',
          background: 'linear-gradient(135deg, #a78bfa, #38bdf8)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          marginBottom: '6px',
        }}>LIFEX</div>
        <div style={{ fontSize: '11px', color: 'rgba(232,232,248,0.3)' }}>
          Private intelligence suite · Built for the family
        </div>
      </footer>
    </div>
  )
}
