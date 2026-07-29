import { cn } from "@workspace/ui/lib/utils"

import { CHART_COLORS, closeArea, linearPath, niceMax, smoothPath, toPoints } from "./lib"

const VIEW_W = 120
const VIEW_H = 32

export interface SparklineProps {
  values: readonly number[]
  /** Any CSS colour. Defaults to the brand orange chart colour. */
  color?: string
  /** Soft gradient under the line. */
  filled?: boolean
  /** Straight segments instead of the smoothed curve. */
  angular?: boolean
  /** Dot on the final point — reads as "where we are now". */
  showEnd?: boolean
  className?: string
  /** Screen-reader description. Falls back to a generated summary. */
  label?: string
}

/**
 * Inline trend line for table rows and stat tiles.
 *
 * Stretches to its container via `preserveAspectRatio="none"`, so stroke width
 * is set in the non-scaling space with `vector-effect` to avoid smearing.
 */
export function Sparkline({
  values,
  color = CHART_COLORS[0],
  filled = true,
  angular = false,
  showEnd = true,
  className,
  label,
}: SparklineProps) {
  const clean = values.filter((v) => Number.isFinite(v))
  if (clean.length === 0) {
    return (
      <div
        className={cn("h-8 w-full rounded bg-chart-track/50", className)}
        role="img"
        aria-label={label ?? "No trend data"}
      />
    )
  }

  const max = niceMax(clean)
  const points = toPoints(clean, VIEW_W, VIEW_H, 3, max)
  const line = angular ? linearPath(points) : smoothPath(points)
  const area = closeArea(line, points, VIEW_H)
  const last = points[points.length - 1]
  const gradientId = `spark-${Math.abs(hash(clean.join(",") + color))}`

  const first = clean[0]
  const latest = clean[clean.length - 1]
  const direction = latest > first ? "rising" : latest < first ? "falling" : "flat"

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="none"
      className={cn("h-8 w-full overflow-visible", className)}
      role="img"
      aria-label={label ?? `Trend ${direction}, latest ${latest}`}
    >
      {filled ? (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gradientId})`} />
        </>
      ) : null}

      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />

      {showEnd && last ? (
        <circle
          cx={last[0]}
          cy={last[1]}
          r={2.25}
          fill={color}
          stroke="white"
          strokeWidth={1.25}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
    </svg>
  )
}

function hash(input: string): number {
  let h = 0
  for (let i = 0; i < input.length; i += 1) {
    h = (h << 5) - h + input.charCodeAt(i)
    h |= 0
  }
  return h
}
