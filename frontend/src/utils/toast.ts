import { toast } from 'sonner'
import { createElement as h } from 'react'
import { CheckCircle, Warning, XCircle, Info } from '@phosphor-icons/react'

const shell = (accent: string): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  background: 'var(--bg)',
  boxShadow: 'var(--neu-raised)',
  borderRadius: 14,
  padding: '12px 16px',
  paddingRight: 32,
  minWidth: 260,
  maxWidth: 400,
  borderLeft: `3px solid ${accent}`,
  position: 'relative',
})

const label: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  fontFamily: 'var(--font-display)',
  color: 'var(--text)',
  lineHeight: 1.3,
}

const closeBtn: React.CSSProperties = {
  position: 'absolute',
  top: '6px',
  right: '8px',
  background: 'none',
  border: 'none',
  color: 'var(--text-dim)',
  cursor: 'pointer',
  fontSize: '18px',
  lineHeight: 1,
  padding: '2px',
  opacity: 0.7,
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const make = (accent: string, Icon: any, msg: string, id: string | number) =>
  h('div', { style: shell(accent) },
    h(Icon, { size: 16, weight: 'fill' as const, color: accent }),
    h('span', { style: label }, msg),
    h('button', { style: closeBtn, onClick: () => toast.dismiss(id) }, '×'),
  )

export const showSuccess = (msg: string, duration = 4000) =>
  toast.custom((id) => make('#0EA66E', CheckCircle, msg, id), { duration })

export const showError = (msg: string, duration = 4000) =>
  toast.custom((id) => make('#FF4444', XCircle, msg, id), { duration })

export const showWarning = (msg: string, duration = 4000) =>
  toast.custom((id) => make('#F59E0B', Warning, msg, id), { duration })

export const showInfo = (msg: string, duration = 4000) =>
  toast.custom((id) => make('#FF6B00', Info, msg, id), { duration })
