import { toast } from 'sonner'
import { createElement as h } from 'react'
import { CheckCircle, Warning, XCircle, Info } from '@phosphor-icons/react'

// Neumorphic toast shell — CSS vars resolve from document root (both light + dark)
const shell = (accent: string): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  background: 'var(--bg)',
  boxShadow: 'var(--neu-raised)',
  borderRadius: 14,
  padding: '12px 16px',
  minWidth: 260,
  maxWidth: 400,
  borderLeft: `3px solid ${accent}`,
})

const label: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  fontFamily: 'var(--font-display)',
  color: 'var(--text)',
  lineHeight: 1.3,
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const make = (accent: string, Icon: any, msg: string) =>
  h('div', { style: shell(accent) },
    h(Icon, { size: 16, weight: 'fill' as const, color: accent }),
    h('span', { style: label }, msg),
  )

export const showSuccess = (msg: string, duration = 3000) =>
  toast.custom(() => make('#0EA66E', CheckCircle, msg), { duration })

export const showError = (msg: string, duration = 5000) =>
  toast.custom(() => make('#FF4444', XCircle, msg), { duration })

export const showWarning = (msg: string, duration = 4000) =>
  toast.custom(() => make('#F59E0B', Warning, msg), { duration })

export const showInfo = (msg: string, duration = 2500) =>
  toast.custom(() => make('#FF6B00', Info, msg), { duration })
