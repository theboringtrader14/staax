import { useState, useRef } from 'react'

type AvatarState = 'idle' | 'listening' | 'processing' | 'speaking'

const API_BASE = (import.meta as any).env?.VITE_API_URL || 'http://localhost:8000'

export default function AIAvatar() {
  const [state, setState] = useState<AvatarState>('idle')
  const [transcript, setTranscript] = useState('')
  const [response, setResponse] = useState('')
  const recognitionRef = useRef<any>(null)
  const transcriptRef = useRef('')

  const orbColor: Record<AvatarState, string> = {
    idle:       'rgba(255,107,0,0.7)',
    listening:  'rgba(34,221,136,0.85)',
    processing: 'rgba(68,136,255,0.85)',
    speaking:   'rgba(255,107,0,0.95)',
  }

  const orbGlow: Record<AvatarState, string> = {
    idle:       '0 0 20px rgba(255,107,0,0.35)',
    listening:  '0 0 40px rgba(34,221,136,0.55)',
    processing: '0 0 40px rgba(68,136,255,0.55)',
    speaking:   '0 0 40px rgba(255,107,0,0.70)',
  }

  const speak = (text: string) => {
    setState('speaking')
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'en-IN'
    utterance.rate = 1.0
    utterance.pitch = 1.0
    utterance.onend = () => setState('idle')
    window.speechSynthesis.speak(utterance)
  }

  const sendToAI = async (text: string) => {
    if (!text.trim()) { setState('idle'); return }
    setState('processing')
    try {
      const res = await fetch(`${API_BASE}/api/v1/ai/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, context: { name: 'Karthikeyan' } }),
      })
      const data = await res.json()
      setResponse(data.response || '')
      speak(data.response || '')
    } catch {
      setState('idle')
    }
  }

  const startListening = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) {
      alert('Speech recognition not supported in this browser. Try Chrome.')
      return
    }
    transcriptRef.current = ''
    setTranscript('')
    setResponse('')

    const recognition = new SR()
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = 'en-IN'
    recognitionRef.current = recognition

    setState('listening')

    recognition.onresult = (e: any) => {
      const text = Array.from(e.results as any[]).map((r: any) => r[0].transcript).join('')
      transcriptRef.current = text
      setTranscript(text)
    }
    recognition.onend = () => {
      sendToAI(transcriptRef.current)
    }
    recognition.onerror = () => setState('idle')
    recognition.start()
  }

  const handleOrbClick = () => {
    if (state === 'idle') {
      startListening()
    } else if (state === 'listening') {
      recognitionRef.current?.stop()
    } else if (state === 'speaking') {
      window.speechSynthesis.cancel()
      setState('idle')
    }
  }

  const stateLabel: Record<AvatarState, string> = {
    idle:       'Click to speak',
    listening:  '● Listening...',
    processing: '◌ Thinking...',
    speaking:   '▶ Speaking...',
  }

  const animClass: Record<AvatarState, string> = {
    idle:       '',
    listening:  'orb-pulse',
    processing: 'orb-spin',
    speaking:   'orb-speak',
  }

  return (
    <div style={{ position: 'fixed', right: 32, bottom: 32, zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>

      {/* Expanded panel — shows when there's content */}
      {(transcript || response || state !== 'idle') && (
        <div style={{
          width: 300, padding: '14px 16px',
          background: 'rgba(10,10,11,0.96)',
          border: '0.5px solid rgba(255,107,0,0.30)',
          borderRadius: 16,
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
        }}>
          {transcript && (
            <p style={{ margin: '0 0 6px', color: 'rgba(255,255,255,0.50)', fontSize: 12, fontStyle: 'italic', lineHeight: 1.5 }}>
              "{transcript}"
            </p>
          )}
          {response && (
            <p style={{ margin: '0 0 8px', color: '#F0F0FF', fontSize: 13, lineHeight: 1.6 }}>
              {response}
            </p>
          )}
          <p style={{ margin: 0, color: 'rgba(255,107,0,0.60)', fontSize: 10, fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }}>
            {stateLabel[state]}
          </p>
        </div>
      )}

      {/* Orb button */}
      <div
        onClick={handleOrbClick}
        className={animClass[state]}
        style={{
          width: 56, height: 56,
          borderRadius: '50%',
          background: orbColor[state],
          boxShadow: orbGlow[state],
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background 300ms ease, box-shadow 300ms ease',
          userSelect: 'none',
          flexShrink: 0,
        }}
        title="Talk to LIFEX AI"
      >
        {state === 'processing' ? (
          <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
          </svg>
        ) : (
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="1" width="6" height="11" rx="3"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="23"/>
            <line x1="8" y1="23" x2="16" y2="23"/>
          </svg>
        )}
      </div>

      {/* LIFEX label */}
      <div style={{ fontSize: 9, color: 'rgba(255,107,0,0.50)', fontFamily: 'var(--font-display)', letterSpacing: '0.15em', textAlign: 'center', width: 56 }}>
        LIFEX AI
      </div>
    </div>
  )
}
