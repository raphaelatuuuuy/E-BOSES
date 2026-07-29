import { cn } from "@workspace/ui/lib/utils"

import { arcPath, ratio } from "./lib"

export interface RadialArc {
  key: string
  label: string
  value: number
  /** Denominator for this ring. Defaults to the largest value in the set. */
  total?: number
  color: string
}

export interface RadialArcsProps {
  arcs: readonly RadialArc[]
  /** Degrees of the full sweep. 280 leaves the reference board's open wedge. */
  sweep?: number
  size?: number
  className?: string
}

const VIEW = 160
const CENTER = VIEW / 2
const OUTER_RADIUS = 66
const RING_STEP = 17
const STROKE = 11

/**
 * Concentric part-circle arcs — one ring per series, longest on the outside.
 *
 * Chosen over a stacked donut because the series here are not parts of one
 * whole: "resolved", "still open" and "not accepted" each want their own
 * denominator, and separate rings say that honestly. Each ring keeps a full
 * track behind it so a short arc still reads as a proportion rather than a
 * stray mark. The sweep stops short of a closed circle, leaving the open wedge
 * that keeps the form from reading as a pie.
 */
export function RadialArcs({ arcs, sweep = 280, size = 160, className }: RadialArcsProps) {
  const fallbackTotal = Math.max(1, ...arcs.map((arc) => arc.value))

  return (
    <svg
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      width={size}
      height={size}
      className={cn("shrink-0 overflow-visible", className)}
      role="img"
      aria-label={arcs.map((arc) => `${arc.label}: ${arc.value}`).join(", ")}
    >
      {/* Rotated so the sweep is centred on 12 o'clock. */}
      <g transform={`rotate(${-sweep / 2} ${CENTER} ${CENTER})`}>
        {arcs.map((arc, index) => {
          const radius = OUTER_RADIUS - index * RING_STEP
          const filled = ratio(arc.value, arc.total ?? fallbackTotal) * sweep
          return (
            <g key={arc.key}>
              <path
                d={arcPath(CENTER, CENTER, radius, 0, sweep)}
                fill="none"
                stroke="var(--color-chart-track)"
                strokeWidth={STROKE}
                strokeLinecap="round"
              />
              {filled > 0 ? (
                <path
                  d={arcPath(CENTER, CENTER, radius, 0, filled)}
                  fill="none"
                  stroke={arc.color}
                  strokeWidth={STROKE}
                  strokeLinecap="round"
                  style={{ transition: "d 600ms ease-out" }}
                />
              ) : null}
            </g>
          )
        })}
      </g>
    </svg>
  )
}

/**
 * Legend rows for the arcs — swatch, label, count, and an optional share chip.
 * Kept beside the rings rather than inside them so the numbers stay readable
 * at the sizes a dashboard card actually gets.
 */
export function RadialArcsLegend({
  arcs,
  shares,
  className,
}: {
  arcs: readonly RadialArc[]
  /** Optional percent per arc key, rendered as a trailing chip. */
  shares?: Record<string, number>
  className?: string
}) {
  return (
    <dl className={cn("flex flex-col gap-1.5", className)}>
      {arcs.map((arc) => (
        <div key={arc.key} className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: arc.color }}
          />
          <dt className="min-w-0 flex-1 truncate text-[12px] font-semibold text-subtle-foreground">
            {arc.label}
          </dt>
          <dd className="shrink-0 text-[14px] font-semibold text-brand-navy tabular-nums">
            {arc.value}
          </dd>
          {shares && shares[arc.key] != null ? (
            <span className="w-11 shrink-0 rounded-full bg-card-raised py-0.5 text-center text-[10px] font-bold text-subtle-foreground tabular-nums">
              {shares[arc.key]}%
            </span>
          ) : null}
        </div>
      ))}
    </dl>
  )
}
