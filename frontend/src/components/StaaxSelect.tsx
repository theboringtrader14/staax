import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export function StaaxSelect({ value, onChange, options, width }: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  width?: string
}) {
  const [open, setOpen] = useState(false)
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 })
  const triggerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const label = options.find(o => o.value === value)?.label ?? value

  const openDropdown = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setDropPos({
        top: rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX,
        width: rect.width,
      })
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
        width: '100%', height: '32px', padding: '0 28px 0 12px',
        background: 'rgba(10,10,11,0.80)',
        border: open ? '0.5px solid rgba(255,107,0,0.55)' : '0.5px solid rgba(255,107,0,0.25)',
        borderRadius: '8px', color: '#F0F0FF', fontSize: '11px',
        fontFamily: 'var(--font-display)', cursor: 'pointer', textAlign: 'left',
        display: 'flex', alignItems: 'center',
        boxShadow: open ? '0 0 0 2px rgba(255,107,0,0.10)' : 'none',
        transition: 'border-color 0.15s, box-shadow 0.15s',
      }}>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FF6B00" strokeWidth="2.5"
          style={{ position: 'absolute', right: '8px', flexShrink: 0, transition: 'transform 0.15s', transform: open ? 'rotate(180deg)' : 'none' }}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && createPortal(
        <div ref={dropdownRef} style={{
          position: 'absolute',
          top: dropPos.top,
          left: dropPos.left,
          width: dropPos.width,
          zIndex: 9999,
          background: 'rgba(10,10,11,0.98)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '0.5px solid rgba(255,107,0,0.35)',
          borderRadius: '8px',
          overflow: 'hidden',
          boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
        }}>
          {options.map(o => (
            <div key={o.value} onClick={() => { onChange(o.value); setOpen(false) }}
              style={{
                padding: '8px 12px', fontSize: '11px', fontFamily: 'var(--font-display)', cursor: 'pointer',
                color: o.value === value ? '#FF6B00' : '#F0F0FF',
                background: o.value === value ? 'rgba(255,107,0,0.12)' : 'transparent',
                borderLeft: o.value === value ? '2px solid #FF6B00' : '2px solid transparent',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,107,0,0.08)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = o.value === value ? 'rgba(255,107,0,0.12)' : 'transparent' }}>
              {o.label}
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}
