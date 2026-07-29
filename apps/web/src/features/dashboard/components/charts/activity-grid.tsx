import { cn } from "@workspace/ui/lib/utils"

import { CHART_COLORS, niceMax } from "./lib"

export interface ActivityCell {
  /** Row label, e.g. a weekday or a category. */
  row: string
  /** Column label, e.g. an hour band. */
  column: string
  value: number
}

export interface ActivityGridProps {
  cells: readonly ActivityCell[]
  rows: readonly string[]
  columns: readonly string[]
  color?: string
  /** Text under the grid explaining what one square means. */
  legendLabel?: string
  className?: string
}

/**
 * Density grid — one rounded square per (row, column) pair, opacity scaled to
 * the value. Reads at a glance as "when does this barangay get busy".
 *
 * Deliberately not a chart library heatmap: squares are large, spaced, and
 * rounded so the grid stays legible for non-technical staff.
 */
export function ActivityGrid({
  cells,
  rows,
  columns,
  color = CHART_COLORS[0],
  legendLabel,
  className,
}: ActivityGridProps) {
  const lookup = new Map<string, number>()
  cells.forEach((cell) => lookup.set(`${cell.row}|${cell.column}`, cell.value))

  const max = niceMax(cells.map((c) => c.value))

  return (
    <div className={cn("w-full", className)}>
      <div className="flex gap-2">
        {/* row labels */}
        <div className="flex shrink-0 flex-col justify-around py-0.5">
          {rows.map((row) => (
            <span
              key={row}
              className="h-6 truncate text-[10.5px] font-semibold leading-6 text-subtle-foreground"
            >
              {row}
            </span>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-1">
            {rows.map((row) => (
              <div key={row} className="flex gap-1">
                {columns.map((column) => {
                  const value = lookup.get(`${row}|${column}`) ?? 0
                  const intensity = max === 0 ? 0 : value / max
                  return (
                    <div
                      key={`${row}-${column}`}
                      className="group relative h-6 flex-1 rounded-[5px] transition-transform duration-150 hover:scale-[1.12]"
                      style={{
                        backgroundColor: value === 0 ? "var(--color-chart-track)" : color,
                        opacity: value === 0 ? 0.5 : 0.2 + intensity * 0.8,
                      }}
                      title={`${row} · ${column}: ${value}`}
                      role="img"
                      aria-label={`${row} ${column}: ${value}`}
                    />
                  )
                })}
              </div>
            ))}
          </div>

          <div className="mt-1.5 flex gap-1">
            {columns.map((column) => (
              <span
                key={column}
                className="flex-1 truncate text-center text-[10px] font-medium text-subtle-foreground"
              >
                {column}
              </span>
            ))}
          </div>
        </div>
      </div>

      {legendLabel ? (
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[10.5px] font-semibold text-subtle-foreground">{legendLabel}</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-medium text-subtle-foreground">Less</span>
            {[0.2, 0.45, 0.7, 1].map((step) => (
              <span
                key={step}
                className="size-2.5 rounded-[3px]"
                style={{ backgroundColor: color, opacity: step }}
              />
            ))}
            <span className="text-[10px] font-medium text-subtle-foreground">More</span>
          </div>
        </div>
      ) : null}
    </div>
  )
}
