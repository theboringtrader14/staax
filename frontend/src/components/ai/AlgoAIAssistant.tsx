import { useState, useEffect, useRef } from 'react'
import { Sparkle, X, Microphone, ArrowRight, Check, PencilSimple } from '@phosphor-icons/react'

// ── Gemma config ──────────────────────────────────────────────────────────────
const MODEL   = 'gemma-3-27b-it'
const API_KEY = import.meta.env.VITE_GOOGLE_AI_KEY

const SYSTEM_PROMPT = `You are an AI assistant for STAAX algo trading platform.
Help users create and edit trading algorithms through conversation.

CONVERSATION RULES:
1. Parse user's initial description. Extract all mentioned fields.
2. Confirm what you understood in 2-3 lines.
3. Ask ALL optional missing features in ONE grouped message:
   "A few optional settings — answer what applies:
   • Stop Loss? (e.g. '40pts per leg' or 'none')
   • Target Profit? (e.g. '60pts' or 'none')
   • MTM Stop Loss/Target? (e.g. 'MTM SL ₹2000' or 'none')
   • W&T (Wait & Trade)? (e.g. 'W&T 10%' or 'none')
   • TSL (Trailing Stop Loss)? (e.g. 'TSL 20pts' or 'none')"
4. If user already mentioned any of these → skip that item from the question.
5. After optional features confirmed → DO NOT ask more questions.
   Instead output READY_FOR_ACCOUNT marker.
6. Account and Days are handled by the UI (chip selection) — never ask about them in chat.
7. Keep responses SHORT — 4 lines max per message.

SCHEMA to fill:
{
  "algo_name": string (auto-generate from underlying+strategy if not given),
  "underlying": "NIFTY"|"BANKNIFTY"|"SENSEX"|"MIDCPNIFTY"|"FINNIFTY"|"GOLDM"|"SILVERMIC",
  "strategy_mode": "intraday"|"stbt"|"btst"|"positional",
  "entry_type": "direct"|"wt"|"orb",
  "entry_time": "HH:MM",
  "exit_time": "HH:MM",
  "lots": number,
  "legs": [{
    "direction": "buy"|"sell",
    "instrument": "ce"|"pe"|"fut",
    "strike_type": "atm"|"otm"|"itm"|"premium",
    "strike_value": number|null,
    "expiry": "current_weekly"|"current_monthly",
    "sl_enabled": boolean,
    "sl_type": "pts_instrument"|"pct_instrument"|null,
    "sl_value": number|null,
    "tsl_enabled": boolean,
    "tsl_x": number|null,
    "tsl_y": number|null,
    "tp_enabled": boolean,
    "tp_value": number|null,
    "wt_enabled": boolean,
    "wt_value": number|null,
    "wt_unit": "pts"|"pct"|null
  }],
  "mtm_sl": number|null,
  "mtm_tp": number|null,
  "mtm_unit": "amt"|"pct"
}

PATTERNS:
- "straddle" = SELL ATM CE + SELL ATM PE
- "strangle" = SELL OTM CE + SELL OTM PE
- "SL 40 points" = sl_type="pts_instrument", sl_value=40
- "SL 20%" = sl_type="pct_instrument", sl_value=20
- "MTM SL 2000" = mtm_sl=2000, mtm_unit="amt"
- "W&T 10%" = wt_enabled=true, wt_value=10, wt_unit="pct"
- "TSL 20pts" = tsl_enabled=true, tsl_y=20 (trail by 20)
- STBT/BTST detected from words like "sell today buy tomorrow"
- Entry time: "9:35", "market open"→"09:15", "half past nine"→"09:30"

When all info collected, output EXACTLY:
FINAL_CONFIG:
{...json...}

For EDIT mode — when user describes a change:
- Read existing config
- Apply ONLY the described changes
- Output FINAL_CONFIG with ALL fields (merge of old + new)
- Then show 2-line summary of what changed`

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

  const chatRef    = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLInputElement>(null)
  const historyRef = useRef<{ role: string; parts: { text: string }[] }[]>([])

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

  async function callGemma(history: { role: string; parts: { text: string }[] }[]) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: history,
          generationConfig: { temperature: 0.1, maxOutputTokens: 800 },
        }),
      }
    )
    if (!res.ok) throw new Error(`API ${res.status}`)
    const d = await res.json()
    return d.candidates?.[0]?.content?.parts?.[0]?.text || 'Sorry, could not process.'
  }

  async function handleSend() {
    const userMsg = input.trim()
    if (!userMsg || isLoading || chatDone) return
    setInput('')
    setMessages(prev => [...prev, { role: 'user', text: userMsg, ts: _ts() }])
    setIsLoading(true)

    historyRef.current = [...historyRef.current, { role: 'user', parts: [{ text: userMsg }] }]

    try {
      const response = await callGemma(historyRef.current)
      historyRef.current = [...historyRef.current, { role: 'model', parts: [{ text: response }] }]

      if (response.includes('FINAL_CONFIG:')) {
        const jsonStr = response.split('FINAL_CONFIG:')[1].trim()
        try {
          const config = JSON.parse(jsonStr)
          setParsedConfig(config)
          setChatDone(true)
          setMessages(prev => [...prev, { role: 'assistant', text: 'Got it! Choose your account and trading days below.', ts: _ts() }])
        } catch {
          setMessages(prev => [...prev, { role: 'assistant', text: response, ts: _ts() }])
        }
      } else {
        setMessages(prev => [...prev, { role: 'assistant', text: response, ts: _ts() }])
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', text: 'Network error. Please try again.', ts: _ts() }])
    } finally {
      setIsLoading(false)
    }
  }

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
          <Sparkle size={15} weight="fill" color="var(--accent)" style={{ marginRight: 8, flexShrink: 0 }} />
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>
            {mode === 'create' ? 'AI Algo Builder' : 'Edit with AI'}
          </span>
          <span style={{ marginLeft: 8, fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: 1.5 }}>
            Gemma 3
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
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
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
            <div style={{ display: 'flex', alignItems: 'flex-start' }}>
              <div style={{ background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', borderRadius: '14px 14px 14px 4px', padding: '10px 14px', display: 'flex', gap: 5, alignItems: 'center' }}>
                {[0, 1, 2].map(i => (
                  <span key={i} style={{
                    width: 5, height: 5, borderRadius: '50%',
                    background: 'var(--accent)', display: 'inline-block',
                    animation: `aiDotBounce 1.2s ease-in-out ${i * 0.2}s infinite`,
                    opacity: 0.6,
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
          @keyframes aiDotBounce {
            0%, 80%, 100% { transform: translateY(0); opacity: 0.45; }
            40% { transform: translateY(-5px); opacity: 1; }
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
