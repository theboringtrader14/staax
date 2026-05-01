import { CaretUp, CaretDown } from '@phosphor-icons/react'

interface Props {
  label: string
  sortKey: string
  currentKey: string | null
  currentDir: 'asc' | 'desc' | null
  onSort: (key: string) => void
  style?: React.CSSProperties
  align?: 'left' | 'center' | 'right'
}

export function SortableHeader({ label, sortKey, currentKey, currentDir, onSort, style, align = 'center' }: Props) {
  const isActive = currentKey === sortKey
  return (
    <th
      onClick={() => onSort(sortKey)}
      style={{
        cursor: 'pointer',
        userSelect: 'none',
        fontFamily: 'var(--font-display)',
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '1.5px',
        textTransform: 'uppercase',
        color: 'var(--text-dim)',
        whiteSpace: 'nowrap',
        padding: '8px 12px',
        textAlign: align,
        ...style,
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {label}
        <span style={{ display: 'flex', flexDirection: 'column', gap: 1, opacity: isActive ? 1 : 0.35 }}>
          <CaretUp
            size={8}
            weight="bold"
            color={isActive && currentDir === 'asc' ? 'rgba(148,163,184,0.7)' : 'var(--border)'}
          />
          <CaretDown
            size={8}
            weight="bold"
            color={isActive && currentDir === 'desc' ? 'rgba(148,163,184,0.7)' : 'var(--border)'}
          />
        </span>
      </span>
    </th>
  )
}
