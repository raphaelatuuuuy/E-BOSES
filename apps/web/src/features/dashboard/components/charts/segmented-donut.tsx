import { cn } from "@workspace/ui/lib/utils"

import { arcPath } from "./lib"

export interface DonutSlice {
  key: string
  label: string
  value: number
  color: string
}

export interface SegmentedDonutProps {
  slices: readonly DonutSlice[]
  /** Big number in the middle. Defaults to the sum of the slices. */
  centerValue?: number
  /** Small word under the number. */
  centerLabel: string
  size?: number
  className?: string
}

const VIEW = 120
const CENTER = VIEW / 2
const RADIUS = 44
const STROKE = 15
/** Degrees of blank between slices, so adjacent colours never touch. */
const GAP = 4

/**
 * Single-ring donut with a notch between each slice.
 *
 * One ring, not concentric ones: these slices ARE parts of one whole (every
 * concern ends in exactly one outcome), so a proportional ring is honest here.
 * The centre carries the total, which means the chart answers "how many" and
 * "in what proportion" without a separate stat card.
 */
export function SegmentedDonut({
  slices,
  centerValue,
  centerLabel,
  size = 168,
  className,
}: SegmentedDonutProps) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0)
  const shown = slices.filter((slice) => slice.value > 0)
  // Gaps eat into the sweep, so the slices share what is left of the circle.
  const usable = 360 - GAP * Math.max(shown.length, 1)

  let cursor = 0

  return (
    <div className={cn("relative shrink-0", className)} style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${VIEW} ${VIEW}`} width={size} height={size} role="img"
        aria-label={
          total === 0
            ? `${centerLabel}: none yet`
            : slices.map((slice) => `${slice.label}: ${slice.value}`).join(", ")
        }
      >
        <circle
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          fill="none"
          stroke="var(--color-chart-track)"
          strokeWidth={STROKE}
        />

        {total > 0
          ? shown.map((slice) => {
              const sweep = (slice.value / total) * usable
              const start = cursor
              cursor += sweep + GAP
              return (
                <path
                  key={slice.key}
                  d={arcPath(CENTER, CENTER, RADIUS, start, start + sweep)}
                  fill="none"
                  stroke={slice.color}
                  strokeWidth={STROKE}
                  strokeLinecap="butt"
                />
              )
            })
          : null}
      </svg>

      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[26px] font-semibold leading-none tracking-tight text-brand-navy tabular-nums">
          {centerValue ?? total}
        </span>
        <span className="mt-1 text-[9px] font-semibold text-subtle-foreground">
          {centerLabel}
        </span>
      </div>
    </div>
  )
}

/** Two-column dotted key, matching the reference board's 2x2 legend block. */
export function DonutLegend({
  slices,
  className,
}: {
  slices: readonly DonutSlice[]
  className?: string
}) {
  return (
    <dl className={cn("grid grid-cols-2 gap-x-3 gap-y-2", className)}>
      {slices.map((slice) => (
        <div key={slice.key} className="flex min-w-0 items-center gap-1.5">
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: slice.color }}
          />
          <dt className="min-w-0 flex-1 truncate text-[9.5px] font-bold tracking-[0.08em] text-subtle-foreground">
            {slice.label}
          </dt>
          <dd className="shrink-0 text-[10.5px] font-semibold text-brand-navy tabular-nums">
            {slice.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
