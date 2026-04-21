import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { CaretDown } from '@phosphor-icons/react'

export function StaaxSelect({ value, onChange, options, width, height, borderRadius }: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  width?: string
  height?: string
  borderRadius?: string
}) {
  const [open, setOpen] = useState(false)
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 })
  const triggerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const label = options.find(o => o.value === value)?.label ?? value

  const openDropdown = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setDropPos({ top: rect.bottom + 6, left: rect.left, width: rect.width })
    }
    setOpen(v => !v)
  }

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target as Node) &&
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node)
      ) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  return (
    <div ref={triggerRef} style={{ position: 'relative', width: width || '130px', flexShrink: 0 }}>
      <button onClick={openDropdown} style={{
        width: '100%', height: height || '32px', padding: '0 28px 0 12px',
        background: 'var(--bg)',
        border: 'none',
        borderRadius: borderRadius || '100px',
        color: 'var(--text-dim)',
        fontSize: '12px',
        fontFamily: 'Inter, sans-serif',
        fontWeight: 500,
        cursor: 'pointer',
        textAlign: 'left',
        display: 'flex',
        alignItems: 'center',
        boxShadow: open ? 'var(--neu-inset)' : 'var(--neu-raised-sm)',
        transition: 'box-shadow 0.15s',
      }}>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-dim)' }}>{label}</span>
        <CaretDown
          size={12}
          weight="bold"
          style={{
            position: 'absolute', right: 10, color: 'var(--text-dim)',
            transition: 'transform 0.15s',
            transform: open ? 'rotate(180deg)' : 'none',
            flexShrink: 0,
          }}
        />
      </button>

      {open && createPortal(
        <div ref={dropdownRef} style={{
          position: 'fixed',
          top: dropPos.top,
          left: dropPos.left,
          width: dropPos.width,
          zIndex: 9999,
          background: 'var(--bg)',
          border: 'none',
          borderRadius: '16px',
          overflow: 'hidden',
          boxShadow: 'var(--neu-raised)',
          maxHeight: '240px',
          overflowY: 'auto',
          padding: '4px',
        }}>
          {options.map(o => (
            <div key={o.value} onClick={() => { onChange(o.value); setOpen(false) }}
              style={{
                padding: '9px 12px', fontSize: '12px',
                fontFamily: 'Inter, sans-serif', fontWeight: 500,
                cursor: 'pointer', borderRadius: '10px',
                color: o.value === value ? 'var(--accent)' : 'var(--text-dim)',
                background: o.value === value ? 'var(--accent-dim)' : 'transparent',
                transition: 'background 0.1s, color 0.1s',
              }}
              onMouseEnter={e => {
                const el = e.currentTarget as HTMLDivElement
                el.style.background = o.value === value ? 'var(--accent-dim)' : 'rgba(128,128,128,0.1)'
                el.style.color = o.value === value ? 'var(--accent)' : 'var(--text)'
              }}
              onMouseLeave={e => {
                const el = e.currentTarget as HTMLDivElement
                el.style.background = o.value === value ? 'var(--accent-dim)' : 'transparent'
                el.style.color = o.value === value ? 'var(--accent)' : 'var(--text-dim)'
              }}>
              {o.label}
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}
