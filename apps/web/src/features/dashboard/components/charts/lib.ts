/**
 * Shared geometry helpers for the hand-built chart kit.
 *
 * Everything here is pure maths on plain numbers — no dependency, no DOM.
 * Charts are drawn as SVG with a fixed viewBox and stretched by CSS, so the
 * numbers below are "design units", not pixels.
 */

/** Chart palette. Indexes are stable — callers may reference them by position. */
export const CHART_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
  "var(--color-chart-6)",
] as const

export const CHART_TRACK = "var(--color-chart-track)"
export const CHART_GRID = "var(--color-chart-grid)"

/**
 * Round a maximum up to a friendly axis bound (10 → 10, 11 → 15, 62 → 70).
 * Keeps bar heights from filling the frame edge-to-edge.
 */
export function niceMax(values: readonly number[], floor = 1): number {
  const peak = Math.max(floor, ...values)
  if (peak <= 5) return Math.max(floor, Math.ceil(peak))
  const magnitude = 10 ** Math.floor(Math.log10(peak))
  const step = peak / magnitude > 5 ? magnitude : magnitude / 2
  return Math.ceil(peak / step) * step
}

/** Map a series to [x, y] points inside a padded box. */
export function toPoints(
  values: readonly number[],
  width: number,
  height: number,
  pad = 0,
  max?: number,
): Array<[number, number]> {
  if (values.length === 0) return []
  const top = max ?? niceMax(values)
  const usableW = width - pad * 2
  const usableH = height - pad * 2
  const stepX = values.length === 1 ? 0 : usableW / (values.length - 1)

  return values.map((value, index) => {
    const x = pad + stepX * index
    const ratio = top === 0 ? 0 : Math.min(1, Math.max(0, value / top))
    const y = pad + usableH - ratio * usableH
    return [x, y]
  })
}

/**
 * Catmull-Rom → cubic bezier. Produces the soft organic curve used on the
 * overview trend cards without the overshoot a naive quadratic gives.
 */
export function smoothPath(points: Array<[number, number]>): string {
  if (points.length === 0) return ""
  if (points.length === 1) return `M ${points[0][0]} ${points[0][1]}`
  if (points.length === 2) {
    return `M ${points[0][0]} ${points[0][1]} L ${points[1][0]} ${points[1][1]}`
  }

  let d = `M ${points[0][0]} ${points[0][1]}`
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i === 0 ? 0 : i - 1]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] ?? p2

    const c1x = p1[0] + (p2[0] - p0[0]) / 6
    const c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6
    const c2y = p2[1] - (p3[1] - p1[1]) / 6

    d += ` C ${round(c1x)} ${round(c1y)}, ${round(c2x)} ${round(c2y)}, ${round(p2[0])} ${round(p2[1])}`
  }
  return d
}

/** Straight polyline through points. */
export function linearPath(points: Array<[number, number]>): string {
  if (points.length === 0) return ""
  return points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"} ${round(x)} ${round(y)}`)
    .join(" ")
}

/** Close a line path down to the baseline to make a filled area. */
export function closeArea(
  path: string,
  points: Array<[number, number]>,
  baselineY: number,
): string {
  if (points.length === 0) return ""
  const first = points[0]
  const last = points[points.length - 1]
  return `${path} L ${round(last[0])} ${baselineY} L ${round(first[0])} ${baselineY} Z`
}

/** Describe an SVG arc for the donut gauge. */
export function arcPath(
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number,
): string {
  const start = polar(cx, cy, radius, endAngle)
  const end = polar(cx, cy, radius, startAngle)
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1
  return `M ${round(start.x)} ${round(start.y)} A ${radius} ${radius} 0 ${largeArc} 0 ${round(end.x)} ${round(end.y)}`
}

function polar(cx: number, cy: number, radius: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) }
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

/** Clamp a 0-1 ratio; tolerates NaN from divide-by-zero call sites. */
export function ratio(value: number, total: number): number {
  if (!total || !Number.isFinite(value) || !Number.isFinite(total)) return 0
  return Math.min(1, Math.max(0, value / total))
}
