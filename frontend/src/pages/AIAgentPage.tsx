import { useState, useRef, useEffect } from 'react'
import type { CSSProperties } from 'react'

const token = localStorage.getItem('staax_token')
const API_BASE = (import.meta as any).env?.VITE_API_URL || 'http://localhost:8000'
const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }

interface Message {
  role: 'user' | 'ai'
  text: string
  ts: string
}

// ── Typing indicator ──────────────────────────────────────────────────────────
function TypingDots() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '4px 2px' }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: '6px', height: '6px', borderRadius: '50%',
          background: 'var(--ox-radiant, #FF6B00)',
          display: 'inline-block',
          animation: `lifexDot 1.2s ease-in-out ${i * 0.2}s infinite`,
        }} />
      ))}
      <style>{`
        @keyframes lifexDot {
          0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1.15); }
        }
      `}</style>
    </div>
  )
}

export default function AIAgentPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [isPractixMode] = useState(() => localStorage.getItem('practix_mode') === 'true')
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return
    const userMsg: Message = { role: 'user', text, ts: new Date().toLocaleTimeString() }
    setMessages(m => [...m, userMsg])
    setInput('')
    setLoading(true)
    try {
      const r = await fetch(`${API_BASE}/api/v1/ai/chat`, {
        method: 'POST', headers,
        body: JSON.stringify({ message: text })
      })
      const d = await r.json()
      setMessages(m => [...m, { role: 'ai', text: d.response || 'No response', ts: new Date().toLocaleTimeString() }])
    } catch {
      setMessages(m => [...m, { role: 'ai', text: 'Connection error. Please try again.', ts: new Date().toLocaleTimeString() }])
    } finally {
      setLoading(false)
    }
  }

  const handleAnalyzePortfolio = async () => {
    setLoading(true)
    setMessages(m => [...m, { role: 'user', text: 'Analyze my portfolio', ts: new Date().toLocaleTimeString() }])
    try {
      const r = await fetch(`${API_BASE}/api/v1/ai/analyze-portfolio`, {
        method: 'POST', headers,
        body: JSON.stringify({ holdings: [], pnl_data: {} })
      })
      const d = await r.json()
      setMessages(m => [...m, { role: 'ai', text: d.response || 'No response', ts: new Date().toLocaleTimeString() }])
    } catch {
      setMessages(m => [...m, { role: 'ai', text: 'Connection error. Please try again.', ts: new Date().toLocaleTimeString() }])
    } finally {
      setLoading(false)
    }
  }

  const handleTodaySummary = async () => {
    setLoading(true)
    setMessages(m => [...m, { role: 'user', text: "Give me today's trading summary", ts: new Date().toLocaleTimeString() }])
    try {
      const r = await fetch(`${API_BASE}/api/v1/ai/analyze-day`, {
        method: 'POST', headers,
        body: JSON.stringify({ orders: [], algo_count: 0 })
      })
      const d = await r.json()
      setMessages(m => [...m, { role: 'ai', text: d.response || 'No response', ts: new Date().toLocaleTimeString() }])
    } catch {
      setMessages(m => [...m, { role: 'ai', text: 'Connection error. Please try again.', ts: new Date().toLocaleTimeString() }])
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  // ── Styles ──────────────────────────────────────────────────────────────────
  const pageStyle: CSSProperties = {
    minHeight: '100vh',
    background: 'radial-gradient(ellipse 120% 60% at 60% -10%, rgba(255,107,0,0.08) 0%, transparent 55%), #0a0a0c',
    padding: '28px 28px 0 28px',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: 'var(--font-body, Inter, sans-serif)',
  }

  const glassCard: CSSProperties = {
    background: 'rgba(255,255,255,0.03)',
    border: '0.5px solid rgba(255,107,0,0.14)',
    borderRadius: '14px',
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 4px 32px rgba(0,0,0,0.3)',
  }

  const chipStyle: CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: '5px',
    padding: '3px 10px', borderRadius: '999px',
    fontSize: '10px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' as const,
    border: '0.5px solid',
  }

  return (
    <div style={pageStyle}>
      {/* ── Header ── */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <div style={{
              fontFamily: 'var(--font-display, Syne, sans-serif)',
              fontSize: '22px', fontWeight: 800,
              color: 'var(--ox-radiant, #FF6B00)',
              letterSpacing: '-0.02em', lineHeight: 1.1,
              textShadow: '0 0 32px rgba(255,107,0,0.35)',
            }}>
              LIFEX AI
            </div>
            <div style={{ fontSize: '12px', color: 'rgba(240,237,232,0.45)', marginTop: '4px' }}>
              Your intelligent financial companion
            </div>
          </div>
          {/* Mode chip */}
          <span style={{
            ...chipStyle,
            background: isPractixMode ? 'rgba(34,221,136,0.10)' : 'rgba(255,107,0,0.10)',
            color: isPractixMode ? '#22DD88' : '#FF6B00',
            borderColor: isPractixMode ? 'rgba(34,221,136,0.30)' : 'rgba(255,107,0,0.30)',
          }}>
            <span style={{
              width: '5px', height: '5px', borderRadius: '50%',
              background: isPractixMode ? '#22DD88' : '#FF6B00',
              boxShadow: `0 0 6px ${isPractixMode ? '#22DD88' : '#FF6B00'}`,
            }} />
            {isPractixMode ? 'PRACTIX' : 'LIVE'}
          </span>
        </div>

        {/* Quick actions */}
        <div style={{ display: 'flex', gap: '10px', marginTop: '16px', flexWrap: 'wrap' }}>
          {[
            { label: 'Analyze Portfolio', onClick: handleAnalyzePortfolio },
            { label: "Today's Summary", onClick: handleTodaySummary },
            { label: 'Chat', onClick: () => inputRef.current?.focus() },
          ].map(({ label, onClick }) => (
            <button key={label} onClick={onClick} disabled={loading} style={{
              padding: '7px 16px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              background: 'rgba(255,107,0,0.10)',
              border: '0.5px solid rgba(255,107,0,0.30)',
              color: loading ? 'rgba(255,107,0,0.4)' : '#FF6B00',
              transition: 'background 0.15s, border-color 0.15s',
              letterSpacing: '0.02em',
            }}
              onMouseEnter={e => { if (!loading) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,107,0,0.18)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,107,0,0.10)' }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Messages thread ── */}
      <div style={{
        ...glassCard,
        flex: 1,
        overflowY: 'auto',
        padding: '20px 18px',
        marginBottom: '16px',
        minHeight: '320px',
        maxHeight: 'calc(100vh - 300px)',
        position: 'relative',
        /* Cloud fill */
        background: 'radial-gradient(ellipse 80% 40% at 50% 100%, rgba(255,107,0,0.04) 0%, transparent 60%), rgba(255,255,255,0.03)',
      }}>
        {messages.length === 0 && !loading && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            color: 'rgba(240,237,232,0.18)', fontSize: '13px', gap: '10px',
            pointerEvents: 'none',
          }}>
            <div style={{
              width: '48px', height: '48px', borderRadius: '14px',
              background: 'rgba(255,107,0,0.08)',
              border: '0.5px solid rgba(255,107,0,0.16)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(255,107,0,0.50)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a4 4 0 0 1 4 4c0 1.1-.4 2-.9 2.8A4 4 0 0 1 16 12a4 4 0 0 1-4 4 4 4 0 0 1-4-4 4 4 0 0 1 .9-2.5C8.4 8.7 8 7.8 8 7a4 4 0 0 1 4-4z"/>
                <line x1="12" y1="16" x2="12" y2="21"/>
                <line x1="8" y1="21" x2="16" y2="21"/>
              </svg>
            </div>
            <div>Ask LIFEX anything about your trading &amp; investments</div>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div key={idx} style={{
            display: 'flex',
            justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
            marginBottom: '14px',
          }}>
            {msg.role === 'user' ? (
              /* User bubble */
              <div style={{ maxWidth: '72%' }}>
                <div style={{
                  background: 'rgba(255,107,0,0.15)',
                  border: '0.5px solid rgba(255,107,0,0.35)',
                  borderRadius: '12px 12px 2px 12px',
                  padding: '10px 14px',
                  fontSize: '13px',
                  color: 'rgba(240,237,232,0.92)',
                  lineHeight: 1.55,
                  whiteSpace: 'pre-wrap',
                }}>
                  {msg.text}
                </div>
                <div style={{ fontSize: '10px', color: 'rgba(240,237,232,0.25)', textAlign: 'right', marginTop: '4px', paddingRight: '4px' }}>
                  {msg.ts}
                </div>
              </div>
            ) : (
              /* AI bubble */
              <div style={{ maxWidth: '80%' }}>
                <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--ox-radiant, #FF6B00)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '5px' }}>
                  LIFEX AI
                </div>
                <div style={{
                  ...glassCard,
                  borderRadius: '2px 12px 12px 12px',
                  padding: '10px 14px',
                  fontSize: '13px',
                  color: 'rgba(240,237,232,0.88)',
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                  background: 'radial-gradient(ellipse 100% 60% at 0% 50%, rgba(255,107,0,0.05) 0%, transparent 60%), rgba(255,255,255,0.04)',
                }}>
                  {msg.text}
                </div>
                <div style={{ fontSize: '10px', color: 'rgba(240,237,232,0.25)', marginTop: '4px', paddingLeft: '4px' }}>
                  {msg.ts}
                </div>
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '10px' }}>
            <div style={{ maxWidth: '80%' }}>
              <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--ox-radiant, #FF6B00)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '5px' }}>
                LIFEX AI
              </div>
              <div style={{
                ...glassCard,
                borderRadius: '2px 12px 12px 12px',
                padding: '10px 14px',
              }}>
                <TypingDots />
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Input row ── */}
      <div style={{
        ...glassCard,
        padding: '12px 14px',
        marginBottom: '24px',
        display: 'flex',
        gap: '10px',
        alignItems: 'flex-end',
      }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask LIFEX anything… (Enter to send, Shift+Enter for new line)"
          rows={1}
          disabled={loading}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            resize: 'none',
            color: 'rgba(240,237,232,0.90)',
            fontSize: '13px',
            lineHeight: 1.55,
            fontFamily: 'inherit',
            maxHeight: `${3 * 1.55 * 13 + 4}px`,
            overflowY: 'auto',
            padding: '2px 0',
            caretColor: '#FF6B00',
          }}
          onInput={e => {
            const el = e.currentTarget
            el.style.height = 'auto'
            el.style.height = Math.min(el.scrollHeight, Math.round(3 * 1.55 * 13 + 4)) + 'px'
          }}
        />
        <button
          onClick={() => sendMessage(input)}
          disabled={loading || !input.trim()}
          style={{
            flexShrink: 0,
            padding: '8px 18px',
            borderRadius: '8px',
            fontSize: '13px', fontWeight: 700,
            cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
            background: loading || !input.trim()
              ? 'rgba(255,107,0,0.12)'
              : 'linear-gradient(135deg,#FF8C33,#FF6B00)',
            border: '0.5px solid rgba(255,107,0,0.30)',
            color: loading || !input.trim() ? 'rgba(255,107,0,0.40)' : '#fff',
            boxShadow: loading || !input.trim() ? 'none' : '0 2px 12px rgba(255,107,0,0.35)',
            transition: 'all 0.15s ease',
            letterSpacing: '0.04em',
          }}
        >
          Send
        </button>
      </div>
    </div>
  )
}
