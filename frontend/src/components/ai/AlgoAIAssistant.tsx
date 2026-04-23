import { useState, useEffect, useRef, useCallback } from 'react'
import { Sparkle, X, Microphone, ArrowRight, Check, PencilSimple } from '@phosphor-icons/react'

// ── Gemma 4 config ────────────────────────────────────────────────────────────
const MODEL = 'gemma-4-31b-it'

const SYSTEM_PROMPT = `You help create trading algorithms through chat.

RULES:
- Only help with creating/editing algos. Refuse all other questions with: "I can only help with creating and editing algos."
- Output ONLY your response. No internal reasoning, no *asterisks*, no analysis.
- Keep responses under 4 lines. Be concise.

FLOW:
1. User describes algo → confirm in 2 lines what you understood
2. Ask ALL missing optionals in one message: SL, TP, MTM SL/TP, W&T, TSL (skip any already mentioned)
3. After optionals → suggest name like NF-STRD-40 (NF=NIFTY, BN=BANKNIFTY, STRD=straddle, STRG=strangle)
4. After name confirmed → output FINAL_CONFIG: followed by JSON

PATTERNS: straddle=SELL ATM CE+PE, strangle=SELL OTM CE+PE, STBT=sell today buy tomorrow

FINAL_CONFIG JSON format:
{"algo_name":"","underlying":"NIFTY","strategy_mode":"intraday","entry_type":"direct","entry_time":"09:35","exit_time":"15:15","lots":1,"legs":[{"direction":"sell","instrument":"ce","strike_type":"atm","expiry":"current_weekly","sl_enabled":false,"sl_type":null,"sl_value":null,"tsl_enabled":false,"tp_enabled":false,"wt_enabled":false}],"mtm_sl":null,"mtm_tp":null}`

// ── Clean chain-of-thought from Gemma responses ──────────────────────────────
function cleanResponse(text: string): string {
  // APPROACH 1: Extract quoted response blocks (Gemma often puts actual response in quotes)
  const quotedBlocks = text.match(/"([^"]{20,})"/g)
  if (quotedBlocks && quotedBlocks.length > 0) {
    // Get the last substantial quoted block (the actual response)
    const lastQuote = quotedBlocks[quotedBlocks.length - 1]
    const clean = lastQuote.slice(1, -1).trim()
    // Make sure it looks like a real response, not reasoning
    if (clean.length > 20 && !clean.includes('FLOW') && !clean.includes('Step ')) {
      return clean
    }
  }

  // APPROACH 2: Remove all lines starting with * or containing known reasoning patterns
  const lines = text.split('\n')
  const cleanLines = lines.filter(line => {
    const t = line.trim()
    if (!t) return false
    if (t.startsWith('*')) return false  // ALL asterisk lines are reasoning
    if (t.startsWith('Goal:')) return false
    if (t.startsWith('Step ')) return false
    if (t.match(/^[0-9]+\./)) return false  // Numbered steps like "1. Parse..."
    if (t.includes('FLOW')) return false
    if (t.includes('No internal reasoning')) return false
    if (t.includes('Only help with algos')) return false
    if (t.includes('Concise?')) return false
    if (t.includes('No analysis')) return false
    if (t.includes('RULES:')) return false
    if (t.includes('PATTERNS:')) return false
    if (t.includes('confirm in 2 lines')) return false
    if (t.includes('Ask missing optionals')) return false
    if (t.includes('suggest name like')) return false
    if (t.includes('output FINAL_CONFIG')) return false
    if (t.includes('Understood.')) return false
    return true
  })

  let cleaned = cleanLines.join('\n').trim()

  // Remove surrounding quotes if the whole response is quoted
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    cleaned = cleaned.slice(1, -1)
  }

  if (cleaned.length > 10) return cleaned

  // APPROACH 3: Fallback — return everything but stripped of asterisks
  return text.replace(/\*[^*]*\*/g, '').replace(/^\s*\*\s*/gm, '').trim()
}

// ── Validate config has required fields ──────────────────────────────────────
function isValidConfig(config: any): boolean {
  return config &&
         typeof config.algo_name === 'string' &&
         typeof config.underlying === 'string' &&
         typeof config.entry_time === 'string' &&
         typeof config.exit_time === 'string' &&
         Array.isArray(config.legs) &&
         config.legs.length > 0
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface Message {
  role: 'user' | 'assistant'
  text: string
  ts: string
}

export interface Props {
  mode: 'create' | 'edit'
  existingAlgo?: any
  accounts: { id: string; nickname: string; broker: string }[]
  onComplete: (config: any, accountId: string, days: string[]) => void
  onClose: () => void
}

// ── Component ─────────────────────────────────────────────────────────────────
export function AlgoAIAssistant({ mode, existingAlgo, accounts, onComplete, onClose }: Props) {
  const [messages,         setMessages]         = useState<Message[]>([])
  const [input,            setInput]            = useState('')
  const [isLoading,        setIsLoading]        = useState(false)
  const [chatDone,         setChatDone]         = useState(false)
  const [parsedConfig,     setParsedConfig]     = useState<any | null>(null)
  const [selectedAccount,  setSelectedAccount]  = useState<string | null>(null)
  const [selectedDays,     setSelectedDays]     = useState<string[]>([])
  const [isListening,      setIsListening]      = useState(false)

  const chatRef      = useRef<HTMLDivElement>(null)
  const inputRef     = useRef<HTMLInputElement>(null)
  const historyRef   = useRef<{ role: string; parts: { text: string }[] }[]>([])
  const isSendingRef = useRef(false)
  const lastSendRef  = useRef(0)  // timestamp to debounce

  // Auto-scroll
  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [messages, isLoading])

  // Initial greeting
  useEffect(() => {
    let text: string
    if (mode === 'create') {
      text = "Hi! Describe the algo you want to create.\nExample: 'Sell NIFTY straddle ATM 1 lot entry 9:35 exit 3:15'"
    } else if (existingAlgo) {
      const a   = existingAlgo
      const legs = (a.legs || []).map((l: any) => `${l.d === 'S' ? 'SELL' : 'BUY'} ${l.i}`).join(' + ')
      text = `Here's ${a.name}:\n${(a.strategy_mode || 'INTRADAY').toUpperCase()} · ${legs}\nEntry ${a.et} → Exit ${a.xt}\n\nWhat would you like to change?`
    } else {
      text = "What would you like to change about this algo?"
    }
    const ts = _ts()
    setMessages([{ role: 'assistant', text, ts }])
    historyRef.current = [{ role: 'model', parts: [{ text }] }]
    setTimeout(() => inputRef.current?.focus(), 100)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function _ts() {
    return new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
  }

  // Gemma API call — prepend system prompt as conversation turns (no system_instruction)
  async function callGemma(userHistory: { role: string; parts: { text: string }[] }[]) {
    const systemTurn = { role: 'user', parts: [{ text: SYSTEM_PROMPT }] }
    const systemAck  = { role: 'model', parts: [{ text: 'Understood. I will help create trading algorithms.' }] }
    const contents   = [systemTurn, systemAck, ...userHistory]

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${import.meta.env.VITE_GOOGLE_AI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          generationConfig: { temperature: 0.2, maxOutputTokens: 600 },
        }),
      }
    )
    if (!res.ok) {
      console.error('[AI] API error status:', res.status)
      throw new Error(`API ${res.status}`)
    }
    const d = await res.json()

    // Debug logging
    console.log('[AI] API response structure:', JSON.stringify(d).substring(0, 400))

    if (d.error) {
      console.error('[AI] API error:', d.error)
      return `Error: ${d.error.message || 'Unknown error'}`
    }

    const text = d.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) {
      console.error('[AI] No text in response. Full response:', JSON.stringify(d).substring(0, 300))
      // Try alternative paths
      const alt = d.candidates?.[0]?.output || d.text || d.response
      if (alt) return alt
      // Check for blocked content
      if (d.candidates?.[0]?.finishReason === 'SAFETY') {
        return 'Response blocked by safety filter. Please rephrase your request.'
      }
    }

    return text || 'Could not process. Please try again.'
  }

  const handleSend = useCallback(async () => {
    // Triple guard: ref flag + timestamp debounce + isLoading state
    const now = Date.now()
    if (isSendingRef.current || isLoading || now - lastSendRef.current < 500) {
      console.log('[AI] blocked by guard:', { isSending: isSendingRef.current, isLoading, timeDiff: now - lastSendRef.current })
      return
    }
    isSendingRef.current = true
    lastSendRef.current = now

    const userMsg = input.trim()
    if (!userMsg || chatDone) {
      console.log('[AI] blocked:', { userMsg: !!userMsg, chatDone })
      isSendingRef.current = false
      return
    }

    console.log('[AI] sending:', userMsg, 'history length:', historyRef.current.length)

    // Clear input and show user message immediately
    setInput('')
    const ts = _ts()
    setMessages(prev => [...prev, { role: 'user', text: userMsg, ts }])
    setIsLoading(true)

    // Add to history ref
    historyRef.current = [...historyRef.current, { role: 'user', parts: [{ text: userMsg }] }]
    console.log('[AI] history after add:', historyRef.current.length)

    try {
      const rawResponse = await callGemma(historyRef.current)
      const response = cleanResponse(rawResponse)

      console.log('[AI] raw response:', rawResponse.substring(0, 300))
      console.log('[AI] cleaned response:', response.substring(0, 300))

      // Add model response to history
      historyRef.current = [...historyRef.current, { role: 'model', parts: [{ text: rawResponse }] }]
      console.log('[AI] history after response:', historyRef.current.length)

      // Strict FINAL_CONFIG detection: must be followed by actual JSON
      const configIdx = response.lastIndexOf('FINAL_CONFIG:')
      let configParsed = false

      if (configIdx !== -1) {
        const jsonStr = response.substring(configIdx + 'FINAL_CONFIG:'.length).trim()
        // Only proceed if it actually starts with JSON object
        if (jsonStr.startsWith('{')) {
          try {
            // Extract balanced JSON
            let braceCount = 0
            let jsonEnd = 0
            for (let i = 0; i < jsonStr.length; i++) {
              if (jsonStr[i] === '{') braceCount++
              if (jsonStr[i] === '}') braceCount--
              if (braceCount === 0 && jsonStr[i] === '}') {
                jsonEnd = i + 1
                break
              }
            }
            if (jsonEnd > 0) {
              const cleanJson = jsonStr.substring(0, jsonEnd)
              const config = JSON.parse(cleanJson)

              // Only accept if it's a valid complete config
              if (isValidConfig(config)) {
                setParsedConfig(config)
                setChatDone(true)
                setMessages(prev => [...prev, { role: 'assistant', text: 'Got it! Choose your account and trading days below.', ts: _ts() }])
                configParsed = true
              }
            }
          } catch (e) {
            console.log('[AI] JSON parse error:', e)
          }
        }
      }

      if (!configParsed) {
        setMessages(prev => [...prev, { role: 'assistant', text: response, ts: _ts() }])
      }
    } catch (e) {
      console.error('[AI] error:', e)
      setMessages(prev => [...prev, { role: 'assistant', text: 'Network error. Please try again.', ts: _ts() }])
    } finally {
      setIsLoading(false)
      isSendingRef.current = false
    }
  }, [input, isLoading, chatDone])

  function handleVoice() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) return
    const rec = new SR()
    rec.lang = 'en-IN'
    rec.continuous = false
    rec.interimResults = false
    rec.onresult  = (e: any) => { setInput(e.results[0][0].transcript); setIsListening(false) }
    rec.onerror   = () => setIsListening(false)
    rec.onend     = () => setIsListening(false)
    setIsListening(true)
    rec.start()
  }

  function toggleDay(d: string) {
    setSelectedDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d])
  }

  function handleConfirm() {
    if (!parsedConfig || !selectedAccount || selectedDays.length === 0) return
    onComplete(parsedConfig, selectedAccount, selectedDays)
  }

  const DAYS_ALL  = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
  const DAY_LBL   = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
  const WEEKDAYS  = ['MON', 'TUE', 'WED', 'THU', 'FRI']
  const allWeek   = WEEKDAYS.every(d => selectedDays.includes(d))
  const canConfirm = !!(parsedConfig && selectedAccount && selectedDays.length > 0)

  function legsSummary(cfg: any) {
    return (cfg?.legs || []).map((l: any) =>
      `${(l.direction || '').toUpperCase()} ${(l.strike_type || '').toUpperCase()} ${(l.instrument || '').toUpperCase()}`
    ).join(' + ') || '—'
  }

  function featureSummary(cfg: any) {
    const parts: string[] = []
    const leg0 = cfg?.legs?.[0]
    if (leg0?.sl_enabled)  parts.push(`SL ${leg0.sl_value}${leg0.sl_type === 'pct_instrument' ? '%' : 'pts'}`)
    if (leg0?.tsl_enabled) parts.push(`TSL ${leg0.tsl_y}pts`)
    if (leg0?.tp_enabled)  parts.push(`TP ${leg0.tp_value}pts`)
    if (cfg?.mtm_sl)       parts.push(`MTM SL ₹${cfg.mtm_sl}`)
    if (cfg?.mtm_tp)       parts.push(`MTM TP ₹${cfg.mtm_tp}`)
    return parts.join(' · ') || 'No SL/TP'
  }

  const selectedAcc = accounts.find(a => a.id === selectedAccount)

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(4px)', zIndex: 900 }}
      />

      {/* Modal */}
      <div style={{
        position: 'fixed', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 480, maxHeight: '72vh',
        background: 'var(--bg)',
        borderRadius: 24,
        boxShadow: 'var(--neu-raised-lg)',
        zIndex: 901,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>

        {/* ── Header ──────────────────────────────────────────────── */}
        <div style={{
          display: 'flex', alignItems: 'center',
          padding: '14px 20px 12px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <Sparkle size={15} weight="fill" color="var(--accent)" style={{ marginRight: 8, flexShrink: 0, animation: 'aiShimmer 3s ease-in-out infinite' }} />
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>
            {mode === 'create' ? 'AI Algo Builder' : 'Edit with AI'}
          </span>
          <span style={{ marginLeft: 8, fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: 1.5, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', animation: 'aiDotBlink 2s ease-in-out infinite' }} />
            GEMMA 4
          </span>
          <button
            onClick={onClose}
            style={{
              marginLeft: 'auto', width: 28, height: 28, borderRadius: '50%',
              background: 'var(--bg)', border: 'none',
              boxShadow: 'var(--neu-raised-sm)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: 'var(--text-mute)',
            }}
          >
            <X size={12} weight="bold" />
          </button>
        </div>

        {/* ── Chat ────────────────────────────────────────────────── */}
        <div
          ref={chatRef}
          style={{ flex: 1, overflowY: 'auto', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}
        >
          {messages.map((m, i) => (
            <div
              key={i}
              style={{
                display: 'flex', flexDirection: 'column',
                alignItems: m.role === 'user' ? 'flex-end' : 'flex-start',
                animation: m.role === 'user' ? 'aiSlideInRight 0.2s ease-out' : 'aiSlideInLeft 0.2s ease-out',
              }}
            >
              <div style={{
                maxWidth: '82%',
                background: m.role === 'user' ? 'rgba(255,107,0,0.07)' : 'var(--bg)',
                boxShadow: m.role === 'user' ? 'none' : 'var(--neu-raised-sm)',
                borderRadius: m.role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                padding: '9px 13px',
                fontSize: 12.5,
                color: 'var(--text)',
                lineHeight: 1.55,
                fontFamily: 'var(--font-body)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}>
                {m.text}
              </div>
              <span style={{
                fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-mute)', marginTop: 2,
                [m.role === 'user' ? 'marginRight' : 'marginLeft']: 4,
              } as any}>{m.ts}</span>
            </div>
          ))}

          {/* Loading dots */}
          {isLoading && (
            <div style={{ display: 'flex', alignItems: 'flex-start', animation: 'aiSlideInLeft 0.2s ease-out' }}>
              <div style={{ background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', borderRadius: '14px 14px 14px 4px', padding: '10px 14px', display: 'flex', gap: 5, alignItems: 'center' }}>
                {[0, 1, 2].map(i => (
                  <span key={i} style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: 'var(--accent)', display: 'inline-block',
                    animation: `aiDotPulse 0.9s ease-in-out ${i * 0.15}s infinite`,
                  }} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Account + Days (after chatDone) ─────────────────────── */}
        {chatDone && (
          <div style={{ borderTop: '1px solid var(--border)', padding: '14px 18px', flexShrink: 0 }}>
            <div style={{ fontSize: 9, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 10 }}>
              Account &amp; Schedule
            </div>

            {/* Account chips */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              {accounts.length === 0 && (
                <span style={{ fontSize: 11, color: 'var(--text-mute)', fontFamily: 'var(--font-body)' }}>No accounts found.</span>
              )}
              {accounts.map(acc => (
                <button
                  key={acc.id}
                  onClick={() => setSelectedAccount(acc.id)}
                  style={{
                    padding: '5px 12px', borderRadius: 40, border: 'none', cursor: 'pointer',
                    fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-body)',
                    background: selectedAccount === acc.id ? 'var(--accent)' : 'var(--bg)',
                    color: selectedAccount === acc.id ? '#fff' : 'var(--text)',
                    boxShadow: selectedAccount === acc.id ? 'none' : 'var(--neu-raised-sm)',
                    transition: 'all 0.15s',
                  }}
                >
                  {acc.nickname} · {acc.broker}
                </button>
              ))}
            </div>

            {/* Days row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-body)', marginRight: 2 }}>Days</span>
              <button
                onClick={() => setSelectedDays(allWeek ? [] : [...WEEKDAYS])}
                style={{
                  fontSize: 9, fontWeight: 700, padding: '3px 9px', borderRadius: 40, border: 'none', cursor: 'pointer',
                  background: allWeek ? 'var(--accent)' : 'var(--bg)',
                  color: allWeek ? '#fff' : 'var(--text-dim)',
                  boxShadow: allWeek ? 'none' : 'var(--neu-raised-sm)',
                  fontFamily: 'var(--font-mono)',
                  transition: 'all 0.12s',
                }}
              >All</button>
              {DAYS_ALL.map((d, i) => (
                <button
                  key={d}
                  onClick={() => toggleDay(d)}
                  style={{
                    width: 24, height: 24, borderRadius: '50%', border: 'none', cursor: 'pointer',
                    fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono)',
                    background: 'var(--bg)',
                    color: selectedDays.includes(d) ? 'var(--accent)' : 'var(--text-mute)',
                    boxShadow: selectedDays.includes(d) ? 'var(--neu-inset)' : 'var(--neu-raised-sm)',
                    transition: 'all 0.12s',
                  }}
                >{DAY_LBL[i]}</button>
              ))}
            </div>

            {/* Confirm summary card */}
            {canConfirm && (
              <div style={{ marginTop: 10, background: 'var(--bg)', boxShadow: 'var(--neu-inset)', borderRadius: 12, padding: '10px 13px' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13, color: 'var(--accent)', marginBottom: 4 }}>
                  {parsedConfig.algo_name || '—'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-body)', lineHeight: 1.7 }}>
                  <div>{parsedConfig.underlying} · {parsedConfig.strategy_mode} · {parsedConfig.lots} lot{parsedConfig.lots !== 1 ? 's' : ''}</div>
                  <div>{legsSummary(parsedConfig)}</div>
                  <div>{featureSummary(parsedConfig)}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-mute)', marginTop: 2 }}>
                    {parsedConfig.entry_time} → {parsedConfig.exit_time}
                    {' · '}{selectedAcc?.nickname}
                    {' · '}{selectedDays.map(d => d[0]).join(' ')}
                  </div>
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button
                onClick={handleConfirm}
                disabled={!canConfirm}
                style={{
                  flex: 2, height: 34, borderRadius: 10, border: 'none',
                  cursor: canConfirm ? 'pointer' : 'not-allowed',
                  background: canConfirm ? 'var(--accent)' : 'var(--bg)',
                  color: canConfirm ? '#fff' : 'var(--text-mute)',
                  fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-body)',
                  boxShadow: canConfirm ? 'none' : 'var(--neu-raised-sm)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  transition: 'all 0.15s',
                }}
              >
                <Check size={13} weight="bold" />
                {mode === 'create' ? 'Create Algo' : 'Save Changes'}
              </button>
              <button
                onClick={() => { setChatDone(false); setParsedConfig(null) }}
                style={{
                  flex: 1, height: 34, borderRadius: 10, border: 'none', cursor: 'pointer',
                  background: 'var(--bg)', color: 'var(--text-dim)',
                  fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-body)',
                  boxShadow: 'var(--neu-raised-sm)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                }}
              >
                <PencilSimple size={12} />
                Edit More
              </button>
            </div>
          </div>
        )}

        {/* ── Input row ───────────────────────────────────────────── */}
        <div style={{ borderTop: '1px solid var(--border)', padding: '10px 14px', display: 'flex', gap: 7, alignItems: 'center', flexShrink: 0 }}>
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend() } }}
            disabled={chatDone || isLoading}
            placeholder={chatDone ? 'Chat complete' : mode === 'create' ? 'Describe your algo...' : 'What to change?'}
            style={{
              flex: 1, height: 34, borderRadius: 10, border: 'none',
              background: 'var(--bg)', boxShadow: 'var(--neu-inset)',
              color: (chatDone || isLoading) ? 'var(--text-mute)' : 'var(--text)',
              fontSize: 12, padding: '0 12px',
              fontFamily: 'var(--font-body)', outline: 'none',
              opacity: chatDone ? 0.5 : 1,
            }}
          />
          <button
            onClick={handleVoice}
            title="Voice input"
            style={{
              width: 34, height: 34, borderRadius: '50%', border: 'none', cursor: 'pointer',
              background: 'var(--bg)',
              color: isListening ? 'var(--accent)' : 'var(--text-dim)',
              boxShadow: isListening ? 'var(--neu-inset)' : 'var(--neu-raised-sm)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              animation: isListening ? 'aiListenPulse 1s ease-in-out infinite' : 'none',
            }}
          >
            <Microphone size={15} weight={isListening ? 'fill' : 'regular'} />
          </button>
          <button
            onClick={() => void handleSend()}
            disabled={!input.trim() || isLoading || chatDone}
            style={{
              width: 34, height: 34, borderRadius: '50%', border: 'none', flexShrink: 0,
              cursor: input.trim() && !isLoading && !chatDone ? 'pointer' : 'not-allowed',
              background: input.trim() && !isLoading && !chatDone ? 'var(--accent)' : 'var(--bg)',
              color: input.trim() && !isLoading && !chatDone ? '#fff' : 'var(--text-mute)',
              boxShadow: input.trim() && !isLoading && !chatDone ? 'none' : 'var(--neu-raised-sm)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.15s',
            }}
          >
            <ArrowRight size={15} weight="bold" />
          </button>
        </div>

        {/* ── Keyframe animations ──────────────────────────────────── */}
        <style>{`
          @keyframes aiShimmer {
            0%, 100% { filter: brightness(1); }
            50% { filter: brightness(1.3) drop-shadow(0 0 3px rgba(255,107,0,0.5)); }
          }
          @keyframes aiDotBlink {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.3; }
          }
          @keyframes aiDotPulse {
            0%, 100% { transform: scale(1); opacity: 0.4; }
            50% { transform: scale(1.3); opacity: 1; }
          }
          @keyframes aiSlideInLeft {
            from { transform: translateX(-16px); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
          }
          @keyframes aiSlideInRight {
            from { transform: translateX(16px); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
          }
          @keyframes aiListenPulse {
            0%, 100% { box-shadow: var(--neu-inset), 0 0 0 0 rgba(255,107,0,0.45); }
            50% { box-shadow: var(--neu-inset), 0 0 0 7px rgba(255,107,0,0); }
          }
        `}</style>
      </div>
    </>
  )
}
