import { useState, useEffect } from 'react'
import { CheckCircle, Warning, XCircle, X } from '@phosphor-icons/react'

// ── Module-level toast store (no Zustand needed) ──────────────────────────────

export type ToastType = 'success' | 'warning' | 'error'

export interface Toast {
  id: string
  type: ToastType
  title: string
  message: string
  createdAt: number
}

type Listener = () => void
let _toasts: Toast[] = []
const _listeners = new Set<Listener>()

export function notify(type: ToastType, title: string, message: string) {
  const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  _toasts = [{ id, type, title, message, createdAt: Date.now() }, ..._toasts].slice(0, 5)
  _listeners.forEach(l => l())
  // Auto-dismiss after 4s
  setTimeout(() => {
    _toasts = _toasts.filter(t => t.id !== id)
    _listeners.forEach(l => l())
  }, 4000)
  // Play sound
  playSound(type)
}

function playSound(type: ToastType) {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    gain.gain.setValueAtTime(0.12, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25)
    if (type === 'success') {
      osc.frequency.setValueAtTime(440, ctx.currentTime)
      osc.frequency.linearRampToValueAtTime(660, ctx.currentTime + 0.12)
    } else if (type === 'warning') {
      osc.frequency.setValueAtTime(520, ctx.currentTime)
    } else {
      osc.frequency.setValueAtTime(660, ctx.currentTime)
      osc.frequency.linearRampToValueAtTime(330, ctx.currentTime + 0.20)
    }
    osc.start(); osc.stop(ctx.currentTime + 0.25)
  } catch (_) {}
}

// ── Toast config helpers ──────────────────────────────────────────────────────

const TOAST_CONFIG = {
  success: {
    background: 'rgba(34,221,136,0.12)',
    border: '0.5px solid rgba(34,221,136,0.35)',
    stripColor: '#22DD88',
    iconColor: '#22DD88',
  },
  warning: {
    background: 'rgba(255,215,0,0.10)',
    border: '0.5px solid rgba(255,215,0,0.30)',
    stripColor: '#FFD700',
    iconColor: '#FFD700',
  },
  error: {
    background: 'rgba(255,68,68,0.12)',
    border: '0.5px solid rgba(255,68,68,0.35)',
    stripColor: '#FF4444',
    iconColor: '#FF4444',
  },
} as const

function ToastIcon({ type, color }: { type: ToastType; color: string }) {
  const props = { size: 16, color, weight: 'fill' as const }
  if (type === 'success') return <CheckCircle {...props} />
  if (type === 'warning') return <Warning {...props} />
  return <XCircle {...props} />
}

// ── NotificationSystem component ─────────────────────────────────────────────

export default function NotificationSystem() {
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    const listener = () => setToasts([..._toasts])
    _listeners.add(listener)
    return () => { _listeners.delete(listener) }
  }, [])

  const dismiss = (id: string) => {
    _toasts = _toasts.filter(t => t.id !== id)
    _listeners.forEach(l => l())
  }

  if (toasts.length === 0) return null

  return (
    <>
      <style>{`
        @keyframes staax-toast-in {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .staax-toast {
          animation: staax-toast-in 0.22s cubic-bezier(0.4, 0, 0.2, 1) both;
        }
      `}</style>

      <div
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {toasts.map(toast => {
          const cfg = TOAST_CONFIG[toast.type]
          return (
            <div
              key={toast.id}
              className="staax-toast"
              style={{
                width: 340,
                borderRadius: 10,
                padding: '12px 16px',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                background: cfg.background,
                border: cfg.border,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              {/* Left color strip */}
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: 3,
                  background: cfg.stripColor,
                  borderRadius: '10px 0 0 10px',
                }}
              />

              {/* Icon */}
              <div style={{ marginLeft: 6, marginTop: 1, flexShrink: 0 }}>
                <ToastIcon type={toast.type} color={cfg.iconColor} />
              </div>

              {/* Text */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    fontFamily: 'var(--font-display)',
                    color: 'var(--text)',
                    lineHeight: 1.3,
                  }}
                >
                  {toast.title}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--text-muted)',
                    marginTop: 2,
                    lineHeight: 1.4,
                    wordBreak: 'break-word',
                  }}
                >
                  {toast.message}
                </div>
              </div>

              {/* Dismiss button */}
              <button
                onClick={() => dismiss(toast.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 2,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-muted)',
                  flexShrink: 0,
                  marginTop: 1,
                  borderRadius: 4,
                  transition: 'color 0.15s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)' }}
                aria-label="Dismiss notification"
              >
                <X size={14} weight="bold" />
              </button>
            </div>
          )
        })}
      </div>
    </>
  )
}
