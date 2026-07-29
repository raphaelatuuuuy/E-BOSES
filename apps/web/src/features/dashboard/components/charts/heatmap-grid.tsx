import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

export interface HeatmapRow {
  key: string
  label: string
  /** One value per column, same length as `columns`. */
  values: readonly number[]
}

export interface HeatmapGridProps {
  rows: readonly HeatmapRow[]
  /** Short column captions, printed once under the grid. */
  columns: readonly string[]
  /** Word for one unit of the value, used in the cell tooltip. */
  unit?: string
  className?: string
}

/**
 * Row × column intensity grid of rounded tiles.
 *
 * Modelled on the "Orders" panel from the reference boards: no icons, no axes,
 * no legend text inside the plot — the tile tone alone carries the reading, so
 * a whole week of load across every barangay unit fits in one glance.
 *
 * Tones step through five levels rather than a continuous gradient, because a
 * volunteer scanning the grid needs to answer "is this one busier than that
 * one", not read an exact number off a colour.
 */
const LEVEL_CLASS = [
  "bg-chart-track/55",
  "bg-brand-navy/15",
  "bg-brand-navy/40",
  "bg-brand-navy",
  "bg-brand-orange",
] as const

const LEVEL_WORD = ["nothing", "light", "steady", "busy", "busiest"] as const

/** Bucket a value into 0-4 against the grid's own peak. */
function levelOf(value: number, peak: number): number {
  if (value <= 0) return 0
  if (peak <= 0) return 0
  const share = value / peak
  if (share >= 0.999) return 4
  if (share > 0.66) return 3
  if (share > 0.33) return 2
  return 1
}

export function HeatmapGrid({ rows, columns, unit = "item", className }: HeatmapGridProps) {
  const peak = React.useMemo(() => {
    let best = 0
    rows.forEach((row) => {
      row.values.forEach((value) => {
        if (value > best) best = value
      })
    })
    return best
  }, [rows])

  if (rows.length === 0) {
    return (
      <div className={cn("flex h-32 items-center justify-center rounded-panel bg-chart-track/40", className)}>
        <span className="text-xs font-semibold text-subtle-foreground">No data yet</span>
      </div>
    )
  }

  return (
    <div className={cn("w-full", className)}>
      <div className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center gap-2">
            <span className="w-[86px] shrink-0 truncate text-[11.5px] font-semibold text-subtle-foreground">
              {row.label}
            </span>
            <div className="flex min-w-0 flex-1 gap-1.5">
              {columns.map((column, index) => {
                const value = row.values[index] ?? 0
                const level = levelOf(value, peak)
                return (
                  <span
                    key={column}
                    title={`${row.label} · ${column}: ${value} ${unit}${value === 1 ? "" : "s"} (${LEVEL_WORD[level]})`}
                    className={cn(
                      "h-7 min-w-0 flex-1 rounded-[7px] transition-colors duration-300",
                      LEVEL_CLASS[level],
                    )}
                  />
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <span aria-hidden className="w-[86px] shrink-0" />
        <div className="flex min-w-0 flex-1 gap-1.5">
          {columns.map((column) => (
            <span
              key={column}
              className="min-w-0 flex-1 truncate text-center text-[10px] font-semibold text-subtle-foreground"
            >
              {column}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Standalone key for the grid — five swatches, plain words, no numbers. */
export function HeatmapLegend({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <span className="text-[10px] font-semibold text-subtle-foreground">Quiet</span>
      {LEVEL_CLASS.map((tone, index) => (
        <span key={index} aria-hidden className={cn("size-2.5 rounded-[3px]", tone)} />
      ))}
      <span className="text-[10px] font-semibold text-subtle-foreground">Busiest</span>
    </div>
  )
}
