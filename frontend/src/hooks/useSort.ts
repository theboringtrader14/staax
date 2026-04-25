import { useState, useMemo } from 'react'

type SortDirection = 'asc' | 'desc' | null

export function useSort<T>(data: T[], defaultKey?: keyof T) {
  const [sortKey, setSortKey] = useState<keyof T | null>(defaultKey || null)
  const [sortDir, setSortDir] = useState<SortDirection>('desc')

  const sorted = useMemo(() => {
    if (!sortKey || !sortDir) return data
    return [...data].sort((a, b) => {
      const aVal = a[sortKey]
      const bVal = b[sortKey]
      if (aVal == null && bVal == null) return 0
      if (aVal == null) return 1
      if (bVal == null) return -1
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDir === 'asc' ? aVal - bVal : bVal - aVal
      }
      const aStr = String(aVal).toLowerCase()
      const bStr = String(bVal).toLowerCase()
      return sortDir === 'asc' ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr)
    })
  }, [data, sortKey, sortDir])

  const handleSort = (key: keyof T) => {
    if (sortKey === key) {
      setSortDir(d => d === 'desc' ? 'asc' : d === 'asc' ? null : 'desc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  return { sorted, sortKey, sortDir, handleSort }
}
