import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

export interface DotPlotProps {
  /** One column per period, in chronological order. */
  values: readonly number[]
  /** Column captions, used for the hover title only. */
  labels?: readonly string[]
  /** Dots stacked per column. Values above this cap fill the column. */
  rows?: number
  color?: string
  className?: string
  title?: string
}

/**
 * Dot-matrix columns — one dot per unit, stacked bottom-up.
 *
 * This exists so two stat cards sitting side by side never carry the same
 * chart: the reference boards deliberately vary the mark (bars, then a cluster,
 * then a scatter) across adjacent cards, which is what stops a KPI row from
 * looking like a template. Counting dots also suits small integers better than
 * a bar whose height is meaningless below ~5.
 */
export function DotPlot({
  values,
  labels,
  rows = 5,
  color = "var(--color-chart-3)",
  className,
  title,
}: DotPlotProps) {
  const peak = React.useMemo(() => Math.max(1, ...values), [values])
  // Each dot stands for this many units, so tall days still fit `rows` dots.
  const perDot = Math.max(1, Math.ceil(peak / rows))

  if (values.length === 0) {
    return (
      <div className={cn("flex h-full items-center justify-center", className)}>
        <span className="text-xs font-semibold text-subtle-foreground">No data yet</span>
      </div>
    )
  }

  return (
    <div
      className={cn("flex h-full w-full items-end gap-1", className)}
      role="img"
      aria-label={title ?? `Dot plot. ${values.join(", ")}`}
    >
      {values.map((value, column) => {
        const lit = value <= 0 ? 0 : Math.max(1, Math.min(rows, Math.round(value / perDot)))
        return (
          <div
            key={column}
            className="flex min-w-0 flex-1 flex-col-reverse items-center gap-[3px]"
            title={`${labels?.[column] ?? `Day ${column + 1}`}: ${value}`}
          >
            {Array.from({ length: rows }).map((_, row) => (
              <span
                key={row}
                className="size-[5px] shrink-0 rounded-full transition-colors duration-300"
                style={{
                  backgroundColor: row < lit ? color : "var(--color-chart-track)",
                  opacity: row < lit ? 1 - row * 0.11 : 1,
                }}
              />
            ))}
          </div>
        )
      })}
    </div>
  )
}
