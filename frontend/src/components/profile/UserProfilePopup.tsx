import { useRef, useEffect, useState } from 'react'
import { GearSix, ArrowsLeftRight, SignOut } from '@phosphor-icons/react'
import { useStore } from '@/store'

export default function UserProfilePopup() {
  const isProfileOpen   = useStore(s => s.isProfileOpen)
  const setIsProfileOpen = useStore(s => s.setIsProfileOpen)
  const logout          = useStore(s => s.logout)

  const popupRef = useRef<HTMLDivElement>(null)

  // Click-outside handler
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setIsProfileOpen(false)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [setIsProfileOpen])

  // Escape key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsProfileOpen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [setIsProfileOpen])

  // Hover states for action rows
  const [hovered, setHovered] = useState<number | null>(null)

  const actionBase: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 16px',
    cursor: 'pointer',
    fontSize: 13,
    color: 'rgba(240,237,232,0.65)',
    transition: 'background 150ms ease',
  }

  const actions = [
    {
      icon: <GearSix size={16} weight="regular" />,
      label: 'Settings',
      onClick: () => console.log('Settings — coming soon'),
      danger: false,
    },
    {
      icon: <ArrowsLeftRight size={16} weight="regular" />,
      label: 'Switch Account',
      onClick: () => console.log('Switch account — coming soon'),
      danger: false,
    },
    {
      icon: <SignOut size={16} weight="regular" />,
      label: 'Sign Out',
      onClick: () => {
        logout()
        window.location.href = 'https://lifexos.co.in'
      },
      danger: true,
    },
  ]

  return (
    <div
      ref={popupRef}
      style={{
        position: 'fixed',
        top: 64,
        right: 16,
        width: 260,
        zIndex: 300,
        background: 'rgba(22,22,25,0.97)',
        border: '0.5px solid rgba(255,107,0,0.22)',
        borderRadius: 12,
        backdropFilter: 'blur(24px)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        overflow: 'hidden',
        opacity: isProfileOpen ? 1 : 0,
        transform: isProfileOpen ? 'translateY(0)' : 'translateY(-8px)',
        pointerEvents: isProfileOpen ? 'auto' : 'none',
        transition: 'all 200ms ease',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: 16,
          borderBottom: '0.5px solid rgba(255,255,255,0.06)',
        }}
      >
        {/* Avatar */}
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: 'linear-gradient(135deg,#FF6B00,#CC4400)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span
            style={{
              fontFamily: 'Syne, sans-serif',
              fontSize: 14,
              fontWeight: 800,
              color: '#fff',
            }}
          >
            BK
          </span>
        </div>

        {/* Name + Role */}
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
            Karthikeyan
          </div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              marginTop: 2,
            }}
          >
            Admin · STAAX
          </div>
        </div>
      </div>

      {/* Actions */}
      <div style={{ padding: '8px 0' }}>
        {actions.map((action, i) => (
          <div key={action.label}>
            {/* Divider before Sign Out */}
            {i === 2 && (
              <div
                style={{
                  borderTop: '0.5px solid rgba(255,255,255,0.06)',
                  margin: '4px 16px',
                }}
              />
            )}
            <div
              onClick={action.onClick}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              style={{
                ...actionBase,
                background: hovered === i ? 'rgba(255,255,255,0.04)' : 'transparent',
                color:
                  action.danger && hovered === i
                    ? '#FF4444'
                    : 'rgba(240,237,232,0.65)',
              }}
            >
              <span
                style={{
                  color:
                    action.danger && hovered === i
                      ? '#FF4444'
                      : 'rgba(240,237,232,0.65)',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                {action.icon}
              </span>
              {action.label}
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div
        style={{
          padding: '10px 16px',
          borderTop: '0.5px solid rgba(255,255,255,0.06)',
          fontSize: 10,
          color: 'rgba(240,237,232,0.20)',
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
          fontFamily: 'var(--font-mono)',
        }}
      >
        STAAX · v0.1.0 · Phase A
      </div>
    </div>
  )
}
