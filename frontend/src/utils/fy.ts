export function getCurrentFY(): string {
  const now = new Date()
  const month = now.getMonth() + 1
  const year = now.getFullYear()
  const fyStart = month >= 4 ? year : year - 1
  return `${fyStart}-${String(fyStart + 1).slice(2)}`
}

export function getFYOptions(yearsBack: number = 3): { value: string; label: string }[] {
  const current = getCurrentFY()
  const startYear = parseInt(current.split('-')[0])
  return Array.from({ length: yearsBack }, (_, i) => {
    const y = startYear - i
    return { value: `${y}-${String(y + 1).slice(2)}`, label: `FY ${y}-${String(y + 1).slice(2)}` }
  })
}

export function formatFY(fy: string): string {
  return `FY ${fy}`
}
