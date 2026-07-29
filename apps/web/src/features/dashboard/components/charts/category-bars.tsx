import { cn } from "@workspace/ui/lib/utils"

import { CHART_COLORS, niceMax, ratio } from "./lib"

export interface CategoryRow {
  label: string
  value: number
  color?: string
  /** Optional trailing note, e.g. "3 overdue". */
  note?: string
}

export interface CategoryBarsProps {
  rows: readonly CategoryRow[]
  /** Show `value` as a share of this instead of the largest row. */
  total?: number
  className?: string
  emptyLabel?: string
}

/**
 * Horizontal ranked bars — the readable alternative to a pie chart for
 * "which category has the most". Label, bar and value sit on one line so a
 * long list stays scannable.
 */
export function CategoryBars({
  rows,
  total,
  className,
  emptyLabel = "Nothing recorded yet",
}: CategoryBarsProps) {
  if (rows.length === 0) {
    return (
      <p className={cn("py-6 text-center text-xs font-semibold text-subtle-foreground", className)}>
        {emptyLabel}
      </p>
    )
  }

  const max = total ?? niceMax(rows.map((r) => r.value))

  return (
    <ul className={cn("flex flex-col gap-2.5", className)}>
      {rows.map((row, index) => {
        const color = row.color ?? CHART_COLORS[index % CHART_COLORS.length]
        const pct = ratio(row.value, max)
        return (
          <li key={row.label} className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-3">
            <span className="truncate text-[12.5px] font-semibold text-brand-navy" title={row.label}>
              {row.label}
            </span>

            <span className="relative h-2 overflow-hidden rounded-full bg-chart-track/60">
              <span
                className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out"
                style={{ width: `${Math.max(pct * 100, row.value > 0 ? 3 : 0)}%`, backgroundColor: color }}
              />
            </span>

            <span className="flex items-baseline gap-1.5 tabular-nums">
              <span className="text-[13px] font-semibold text-brand-navy">{row.value}</span>
              {row.note ? (
                <span className="text-[10.5px] font-semibold text-subtle-foreground">{row.note}</span>
              ) : null}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
