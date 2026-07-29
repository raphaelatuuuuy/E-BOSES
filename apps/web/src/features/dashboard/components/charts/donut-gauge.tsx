import type { ReactNode } from "react"
import { cn } from "@workspace/ui/lib/utils"

import { CHART_COLORS, CHART_TRACK, arcPath, ratio } from "./lib"

const SIZE = 120
const CENTER = SIZE / 2

export interface DonutSegment {
  label: string
  value: number
  color?: string
}

export interface DonutGaugeProps {
  /** Single-value mode: a 0-100 percentage. Ignored when `segments` is set. */
  percent?: number
  /** Multi-segment mode: a full ring split proportionally. */
  segments?: readonly DonutSegment[]
  /** Big number in the middle. Defaults to the percentage. */
  centerValue?: ReactNode
  centerLabel?: string
  color?: string
  /** Ring thickness in design units (viewBox is 120×120). */
  thickness?: number
  /** Leave a gap at the bottom, arc-style, instead of a closed ring. */
  openBottom?: boolean
  className?: string
}

/**
 * Ring gauge used for rates (resolution rate, on-duty coverage).
 *
 * Two modes: a single percentage arc, or a segmented ring that shows a
 * breakdown. Both share the same centre-label treatment.
 */
export function DonutGauge({
  percent,
  segments,
  centerValue,
  centerLabel,
  color = CHART_COLORS[0],
  thickness = 11,
  openBottom = false,
  className,
}: DonutGaugeProps) {
  const radius = CENTER - thickness / 2 - 2
  const sweep = openBottom ? 280 : 360
  const startAngle = openBottom ? 40 : 0

  const total = segments?.reduce((sum, s) => sum + Math.max(0, s.value), 0) ?? 0
  const pct = Math.min(100, Math.max(0, percent ?? 0))

  let cursor = startAngle
  const arcs =
    segments && total > 0
      ? segments.map((segment, index) => {
          const span = (Math.max(0, segment.value) / total) * sweep
          const path = arcPath(CENTER, CENTER, radius, cursor, cursor + span)
          cursor += span
          return {
            key: `${segment.label}-${index}`,
            path,
            color: segment.color ?? CHART_COLORS[index % CHART_COLORS.length],
            label: segment.label,
            value: segment.value,
          }
        })
      : []

  const ariaLabel = segments
    ? `${centerLabel ?? "Breakdown"}: ${segments.map((s) => `${s.label} ${s.value}`).join(", ")}`
    : `${centerLabel ?? "Rate"}: ${Math.round(pct)} percent`

  return (
    <div className={cn("relative inline-flex shrink-0", className)}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="size-full" role="img" aria-label={ariaLabel}>
        {/* track */}
        <path
          d={arcPath(CENTER, CENTER, radius, startAngle, startAngle + sweep - 0.01)}
          fill="none"
          stroke={CHART_TRACK}
          strokeWidth={thickness}
          strokeLinecap={openBottom ? "round" : "butt"}
        />

        {segments && total > 0
          ? arcs.map((arc) => (
              <path
                key={arc.key}
                d={arc.path}
                fill="none"
                stroke={arc.color}
                strokeWidth={thickness}
                strokeLinecap="butt"
              />
            ))
          : pct > 0 && (
              <path
                d={arcPath(
                  CENTER,
                  CENTER,
                  radius,
                  startAngle,
                  startAngle + Math.max(0.01, ratio(pct, 100) * sweep),
                )}
                fill="none"
                stroke={color}
                strokeWidth={thickness}
                strokeLinecap="round"
                className="transition-[d] duration-500"
              />
            )}
      </svg>

      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5">
        <span className="text-[22px] font-semibold leading-none tracking-tight text-brand-navy">
          {centerValue ?? `${Math.round(pct)}%`}
        </span>
        {centerLabel ? (
          <span className="max-w-[70%] text-center text-[10px] font-semibold leading-tight text-subtle-foreground">
            {centerLabel}
          </span>
        ) : null}
      </div>
    </div>
  )
}
