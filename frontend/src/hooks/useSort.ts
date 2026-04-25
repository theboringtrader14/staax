import { useMemo, useReducer } from 'react'

type SortDir = 'asc' | 'desc' | null
type SortState<T> = { key: keyof T | null; dir: SortDir }
type SortAction<T> = { type: 'sort'; key: keyof T }

function sortReducer<T>(
  state: SortState<T>,
  action: SortAction<T>
): SortState<T> {
  const { key } = action
  if (state.key !== key) return { key, dir: 'desc' }
  if (state.dir === 'desc') return { key, dir: 'asc' }
  if (state.dir === 'asc')  return { key: null, dir: null }
  return { key, dir: 'desc' }
}

export function useSort<T>(
  data: T[],
  defaultKey?: keyof T,
  defaultDir: SortDir = 'desc'
) {
  const [state, dispatch] = useReducer(
    sortReducer<T> as React.Reducer<SortState<T>, SortAction<T>>,
    { key: defaultKey ?? null, dir: defaultKey ? defaultDir : null }
  )

  const sorted = useMemo(() => {
    if (!state.key || !state.dir) return data
    return [...data].sort((a, b) => {
      const aVal = a[state.key!]
      const bVal = b[state.key!]
      if (aVal == null && bVal == null) return 0
      if (aVal == null) return 1
      if (bVal == null) return -1
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return state.dir === 'asc' ? aVal - bVal : bVal - aVal
      }
      const cmp = String(aVal).toLowerCase().localeCompare(String(bVal).toLowerCase())
      return state.dir === 'asc' ? cmp : -cmp
    })
  }, [data, state.key, state.dir])

  const handleSort = (key: keyof T) => dispatch({ type: 'sort', key })

  return { sorted, sortKey: state.key, sortDir: state.dir, handleSort }
}
