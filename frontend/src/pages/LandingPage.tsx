import React, { useState } from 'react'
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
    externalUrl: 'https://staax.lifexos.co.in',
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
    externalUrl: 'https://invex.lifexos.co.in',
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
    externalUrl: 'http://localhost:3002',
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


const CosmosBackground = () => (
  <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden' }}>
    <div style={{
      position: 'absolute',
      inset: 0,
      backgroundImage: "url('https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=2560&q=80')",
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
      opacity: 0.12,
      zIndex: -1,
      pointerEvents: 'none'
    }} />
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

  useEffect(() => {
    history.scrollRestoration = 'manual'
    window.scrollTo(0, 0)
  }, [])

  const [sysLines, setSysLines] = useState([
    { color: 'rgba(232,232,248,0.35)', text: '⟳ loading system status...' },
  ])

  useEffect(() => {
    const ok = '#10b981'
    const err = '#ef4444'
    const unk = 'rgba(232,232,248,0.35)'
    fetch('http://localhost:8000/api/v1/system/health')
      .then(r => r.json())
      .then((data: Record<string, string>) => {
        setSysLines([
          { color: data.staax === 'ok' ? ok : err, text: `${data.staax === 'ok' ? '✓' : '✗'} STAAX Engine  — ${data.staax === 'ok' ? 'connected' : 'degraded'}` },
          { color: data.smartstream === 'ok' ? ok : err, text: `${data.smartstream === 'ok' ? '✓' : '✗'} SmartStream   — ${data.smartstream === 'ok' ? 'active' : 'down'}` },
          { color: data.db === 'ok' ? ok : err, text: `${data.db === 'ok' ? '✓' : '✗'} Database      — ${data.db === 'ok' ? 'connected' : 'down'}` },
          { color: data.redis === 'ok' ? ok : err, text: `${data.redis === 'ok' ? '✓' : '✗'} Redis         — ${data.redis === 'ok' ? 'connected' : 'down'}` },
        ])
      })
      .catch(() => {
        setSysLines([
          { color: err, text: '✗ STAAX Engine  — unreachable' },
          { color: unk, text: '— SmartStream   — unknown' },
          { color: unk, text: '— Database      — unknown' },
          { color: unk, text: '— Redis         — unknown' },
        ])
      })
  }, [])

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
              onClick={() => document.getElementById('roadmap')?.scrollIntoView({ behavior: 'smooth' })}
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
          {sysLines.map((line, i) => (
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
                if ('externalUrl' in mod && mod.externalUrl) window.location.href = mod.externalUrl
              }}
              style={{
                background: `rgba(10,10,26,0.7)`,
                border: `1px solid ${mod.accent}30`,
                borderRadius: '12px',
                padding: '20px',
                cursor: ('externalUrl' in mod && mod.externalUrl) ? 'pointer' : 'default',
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
              <div style={{ fontSize: '11px', color: 'rgba(232,232,248,0.5)', lineHeight: 1.6, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' } as React.CSSProperties}>
                {mod.description}
              </div>
              {('externalUrl' in mod && mod.externalUrl) && (
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

      {/* Roadmap */}
      <section id="roadmap" style={{
        position: 'relative', zIndex: 1,
        maxWidth: '1100px', margin: '0 auto',
        padding: '60px 32px 80px',
      }}>
        <div style={{ textAlign: 'center', marginBottom: '48px' }}>
          <div style={{
            display: 'inline-block',
            fontSize: '10px', fontWeight: 700, letterSpacing: '0.15em',
            color: 'rgba(167,139,250,0.7)', textTransform: 'uppercase',
            marginBottom: '12px',
          }}>ROADMAP</div>
          <h2 style={{
            fontSize: '28px', fontWeight: 800, letterSpacing: '-0.02em',
            color: '#f0f0ff', marginBottom: '12px',
          }}>What's coming to LIFEX</h2>
          <p style={{ fontSize: '14px', color: 'rgba(232,232,248,0.55)', maxWidth: '460px', margin: '0 auto' }}>
            A living plan — from where we are to where we're going.
          </p>
        </div>

        <style>{`
          @keyframes roadmapPulse {
            0%,100% { opacity:1; box-shadow: 0 0 0 0 rgba(255,107,0,0.4); }
            50%      { opacity:0.7; box-shadow: 0 0 0 6px rgba(255,107,0,0); }
          }
        `}</style>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
          {[
            {
              phase: 'Phase 1',
              title: 'Foundation',
              status: 'complete',
              statusLabel: 'COMPLETE',
              statusColor: '#10b981',
              items: [
                'STAAX algo engine — deploy, monitor, SmartStream execution',
                'INVEX portfolio tracker — holdings, growth charts',
                'LIFEX dashboard — unified suite landing page',
                'Multi-account support with practix/live mode',
              ],
            },
            {
              phase: 'Phase 2',
              title: 'Expansion',
              status: 'active',
              statusLabel: 'IN PROGRESS',
              statusColor: '#FF6B00',
              items: [
                'BUDGEX — expense categorisation and budget tracking',
                'STAAX analytics — per-algo P&L breakdown and reports',
                'Mobile-responsive layouts across all modules',
                'Notification system — alerts for SL/TP hits and events',
              ],
            },
            {
              phase: 'Phase 3',
              title: 'Intelligence',
              status: 'planned',
              statusLabel: 'PLANNED',
              statusColor: 'rgba(167,139,250,0.6)',
              items: [
                'HEALTHEX — workouts, nutrition, wearable integration',
                'GOALEX — life goals, milestones, and habit loops',
                'AI-powered spending and portfolio insights',
                'Cross-module unified P&L and net worth view',
              ],
            },
            {
              phase: 'Phase 4',
              title: 'Horizon',
              status: 'future',
              statusLabel: 'FUTURE',
              statusColor: 'rgba(232,232,248,0.25)',
              items: [
                'Collaborative family dashboard',
                'Tax-aware rebalancing suggestions',
                'Voice + natural language queries',
                'Open API for external integrations',
              ],
            },
          ].map((phase, i, arr) => (
            <div key={phase.phase} style={{ display: 'flex', gap: '0' }}>
              {/* Timeline spine */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '40px', flexShrink: 0 }}>
                <div style={{
                  width: '14px', height: '14px', borderRadius: '50%', flexShrink: 0,
                  marginTop: '20px',
                  background: phase.status === 'complete' ? '#10b981'
                    : phase.status === 'active' ? '#FF6B00'
                    : phase.status === 'planned' ? 'rgba(167,139,250,0.4)'
                    : 'rgba(232,232,248,0.12)',
                  border: `2px solid ${phase.status === 'complete' ? '#10b981' : phase.status === 'active' ? '#FF6B00' : phase.status === 'planned' ? 'rgba(167,139,250,0.35)' : 'rgba(232,232,248,0.1)'}`,
                  boxShadow: phase.status === 'active' ? '0 0 12px rgba(255,107,0,0.5)' : 'none',
                  animation: phase.status === 'active' ? 'roadmapPulse 2s ease-in-out infinite' : 'none',
                }} />
                {i < arr.length - 1 && (
                  <div style={{
                    width: '2px', flex: 1, marginTop: '4px', marginBottom: '4px',
                    background: phase.status === 'complete'
                      ? 'linear-gradient(to bottom, #10b981, rgba(99,102,241,0.3))'
                      : 'rgba(99,102,241,0.15)',
                  }} />
                )}
              </div>

              {/* Card */}
              <div style={{
                flex: 1, marginLeft: '20px', marginBottom: i < arr.length - 1 ? '24px' : '0',
                background: phase.status === 'future' ? 'rgba(10,10,26,0.3)' : 'rgba(10,10,26,0.65)',
                border: `1px solid ${phase.statusColor}30`,
                borderLeft: `3px solid ${phase.statusColor}`,
                borderRadius: '10px',
                padding: '20px 24px',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                opacity: phase.status === 'future' ? 0.6 : 1,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <div>
                    <span style={{
                      fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em',
                      color: 'rgba(167,139,250,0.6)', textTransform: 'uppercase',
                    }}>{phase.phase}</span>
                    <h3 style={{
                      fontSize: '17px', fontWeight: 800, color: '#f0f0ff',
                      margin: '2px 0 0', letterSpacing: '-0.01em',
                    }}>{phase.title}</h3>
                  </div>
                  <span style={{
                    fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em',
                    color: phase.statusColor,
                    background: `${phase.statusColor}18`,
                    border: `1px solid ${phase.statusColor}40`,
                    borderRadius: '20px', padding: '3px 9px',
                  }}>{phase.statusLabel}</span>
                </div>
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '7px' }}>
                  {phase.items.map((item, j) => (
                    <li key={j} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '13px', color: phase.status === 'future' ? 'rgba(232,232,248,0.35)' : 'rgba(232,232,248,0.65)', lineHeight: 1.5 }}>
                      <span style={{ color: phase.statusColor, flexShrink: 0, marginTop: '1px', fontSize: '12px' }}>
                        {phase.status === 'complete' ? '✓' : phase.status === 'active' ? '›' : '○'}
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
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
