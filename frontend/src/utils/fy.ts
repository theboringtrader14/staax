export function getCurrentFY(): string {
  const now = new Date()
  const month = now.getMonth() + 1
  const year = now.getFullYear()
  const fyStart = month >= 4 ? year : year - 1
  return `${fyStart}-${String(fyStart + 1).slice(2)}`
}

export function getFYOptions(_yearsBack: number = 3): { value: string; label: string }[] {
  const current = getCurrentFY()
  const startYear = parseInt(current.split('-')[0])
  const DATA_START_YEAR = 2026
  return Array.from({ length: startYear - DATA_START_YEAR + 1 }, (_, i) => {
    const y = startYear - i
    return { value: `${y}-${String(y + 1).slice(2)}`, label: `FY ${y}-${String(y + 1).slice(2)}` }
  })
}

export function formatFY(fy: string): string {
  return `FY ${fy}`
}
