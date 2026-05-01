import { useState, useRef, useEffect } from 'react'

type AvatarState = 'idle' | 'listening' | 'processing' | 'speaking'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const CSS_ANIMATIONS = `
@keyframes float {
  0%   { transform: translateY(0); }
  100% { transform: translateY(-4px); }
}
@keyframes blink {
  0%, 95%, 100% { ry: 2; }
  97%            { ry: 0.3; }
}
@keyframes pulse-ring {
  0%   { r: 44; opacity: 0.8; }
  100% { r: 60; opacity: 0; }
}
@keyframes spin {
  0%   { stroke-dashoffset: 0; }
  100% { stroke-dashoffset: -100; }
}
@keyframes mouth-open {
  0%, 100% { ry: 0; }
  50%       { ry: 4; }
}
.lifex-float {
  animation: float 3s ease-in-out infinite alternate;
}
.lifex-eye {
  animation: blink 3s ease-in-out infinite;
}
.lifex-pulse-ring {
  animation: pulse-ring 1.2s ease-out infinite;
}
.lifex-spin-arc {
  animation: spin 1s linear infinite;
}
`

export default function AIAvatar() {
  const [state, setState] = useState<AvatarState>('idle')
  const [transcript, setTranscript] = useState('')
  const [response, setResponse] = useState('')
  const [mouthOpen, setMouthOpen] = useState(false)
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const transcriptRef = useRef('')

  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768

  // Speaking mouth animation
  useEffect(() => {
    if (state !== 'speaking') {
      setMouthOpen(false)
      return
    }
    const interval = setInterval(() => {
      setMouthOpen(prev => !prev)
    }, 200)
    return () => clearInterval(interval)
  }, [state])

  const selectBestVoice = (): SpeechSynthesisVoice | null => {
    const voices = speechSynthesis.getVoices()
    const matchers: Array<(v: SpeechSynthesisVoice) => boolean> = [
      v => v.name.includes('Neural') && v.lang.includes('en'),
      v => v.name.includes('Google') && v.lang.includes('en-IN'),
      v => v.name.includes('Google') && v.lang.includes('en-GB'),
      v => v.name.includes('Google') && v.lang.includes('en-US'),
      v => v.name === 'Samantha',
      v => v.name === 'Karen',
      v => v.name === 'Daniel',
      v => v.lang.includes('en-IN'),
      v => v.lang.includes('en-GB'),
      v => v.lang.includes('en'),
    ]
    for (const matcher of matchers) {
      const voice = voices.find(matcher)
      if (voice) return voice
    }
    return voices[0] ?? null
  }

  const speakNaturally = (text: string) => {
    setState('speaking')
    speechSynthesis.cancel()
    const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text]
    let index = 0
    const speakNext = () => {
      if (index >= sentences.length) { setState('idle'); return }
      const utterance = new SpeechSynthesisUtterance(sentences[index].trim())
      utterance.voice = selectBestVoice()
      utterance.rate = 0.92
      utterance.pitch = 1.0
      utterance.volume = 1.0
      utterance.onend = () => {
        index++
        setTimeout(speakNext, 100)
      }
      speechSynthesis.speak(utterance)
    }
    if (speechSynthesis.getVoices().length === 0) {
      speechSynthesis.addEventListener('voiceschanged', () => speakNext(), { once: true })
    } else {
      speakNext()
    }
  }

  const sendToAI = async (text: string) => {
    if (!text.trim()) { setState('idle'); return }
    setState('processing')
    try {
      const useAnalyze = text.length > 20 || /which|what|compare|best|why|how|strategy/i.test(text)
      const endpoint = useAnalyze ? `${API_BASE}/api/v1/ai/analyze` : `${API_BASE}/api/v1/ai/chat`
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, context: { name: 'Karthikeyan' } }),
      })
      const data = await res.json()
      setResponse(data.response || '')
      speakNaturally(data.response || '')
    } catch {
      setState('idle')
    }
  }

  const startListening = () => {
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition
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
    listening:  'Listening...',
    processing: '◌ Thinking...',
    speaking:   '▶ Speaking...',
  }

  // Eye dimensions per state
  const eyeProps: Record<AvatarState, { rx: number; ry: number }> = {
    idle:       { rx: 3, ry: 2 },
    listening:  { rx: 4, ry: 3.5 },
    processing: { rx: 3, ry: 1 },
    speaking:   { rx: 3, ry: 2 },
  }

  const { rx, ry } = eyeProps[state]

  return (
    <div style={{ position: 'fixed', right: 32, bottom: 32, zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>

      {/* Inject CSS animations */}
      <style dangerouslySetInnerHTML={{ __html: CSS_ANIMATIONS }} />

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

      {isMobile ? (
        /* ── MOBILE: simple 56px orange mic circle ── */
        <div
          onClick={handleOrbClick}
          style={{
            width: 56, height: 56,
            borderRadius: '50%',
            background: 'rgba(255,107,0,0.85)',
            boxShadow: '0 0 20px rgba(255,107,0,0.35)',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background 300ms ease, box-shadow 300ms ease',
            userSelect: 'none',
            flexShrink: 0,
          }}
          title="Talk to LIFEX AI"
        >
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="1" width="6" height="11" rx="3"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="23"/>
            <line x1="8" y1="23" x2="16" y2="23"/>
          </svg>
        </div>
      ) : (
        /* ── DESKTOP: animated SVG face avatar ── */
        <div
          onClick={handleOrbClick}
          className="lifex-float"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
            cursor: 'pointer',
            userSelect: 'none',
          }}
          title="Talk to LIFEX AI"
        >
          {/* SVG Avatar */}
          <svg
            width={80}
            height={80}
            viewBox="0 0 80 80"
            style={{
              borderRadius: '50%',
              background: 'rgba(10,10,14,0.92)',
              border: '2px solid rgba(255,107,0,0.6)',
              boxShadow: '0 0 20px rgba(255,107,0,0.35)',
              overflow: 'visible',
            }}
          >
            {/* Pulse ring — listening state */}
            {state === 'listening' && (
              <circle
                cx="40"
                cy="40"
                r="44"
                fill="none"
                stroke="rgba(255,107,0,0.6)"
                strokeWidth="2"
                className="lifex-pulse-ring"
              />
            )}

            {/* Processing spinner arc */}
            {state === 'processing' && (
              <circle
                cx="40"
                cy="40"
                r="38"
                fill="none"
                stroke="rgba(255,107,0,0.7)"
                strokeWidth="2.5"
                strokeDasharray="60 100"
                strokeLinecap="round"
                className="lifex-spin-arc"
                style={{ transformOrigin: '40px 40px' }}
              />
            )}

            {/* Left eye */}
            <ellipse
              cx="28"
              cy="36"
              rx={rx}
              ry={ry}
              fill="#FF6B00"
              className="lifex-eye"
            />

            {/* Right eye */}
            <ellipse
              cx="52"
              cy="36"
              rx={rx}
              ry={ry}
              fill="#FF6B00"
              className="lifex-eye"
            />

            {/* Mouth */}
            {state === 'speaking' ? (
              mouthOpen ? (
                /* Open mouth — ellipse */
                <ellipse
                  cx="40"
                  cy="52"
                  rx="8"
                  ry="4"
                  fill="#FF6B00"
                  opacity="0.85"
                />
              ) : (
                /* Closed mouth — line */
                <line
                  x1="32"
                  y1="52"
                  x2="48"
                  y2="52"
                  stroke="#FF6B00"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              )
            ) : (
              /* Idle / listening / processing — short resting line */
              <line
                x1="32"
                y1="48"
                x2="40"
                y2="48"
                stroke="#FF6B00"
                strokeWidth="2"
                strokeLinecap="round"
              />
            )}
          </svg>

          {/* LIFEX AI label */}
          <div style={{
            fontSize: 9,
            color: 'rgba(255,107,0,0.6)',
            fontFamily: 'Syne, var(--font-display), sans-serif',
            letterSpacing: '0.15em',
            textAlign: 'center',
          }}>
            {state === 'listening' ? 'Listening...' : 'LIFEX AI'}
          </div>
        </div>
      )}
    </div>
  )
}
