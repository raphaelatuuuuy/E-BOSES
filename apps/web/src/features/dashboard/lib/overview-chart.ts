export function barHeights(values: number[]): number[] {
  const max = Math.max(0, ...values)
  if (max <= 0) return values.map(() => 0)
  return values.map((value) => (Math.max(0, value) / max) * 88)
}

export function peakIndex(values: number[]): number {
  let best = -1
  let top = 0
  values.forEach((value, index) => {
    if (value > top) {
      top = value
      best = index
    }
  })
  return best
}

export function formatDelta(
  pct: number | null | undefined,
  basis: string
): string | null {
  if (pct == null || !Number.isFinite(pct)) return null
  if (pct === 0) return `0% ${basis}`
  const arrow = pct > 0 ? "↑" : "↓"
  return `${arrow} ${Math.abs(pct)}% ${basis}`
}

export function formatCount(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString("en-US")
}

export function weekdayLabel(isoDate: string): string {
  const parsed = new Date(`${isoDate}T12:00:00`)
  if (Number.isNaN(parsed.getTime())) return ""
  return new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(parsed)
}
