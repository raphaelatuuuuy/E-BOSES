import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

import { niceMax, ratio } from "./lib"

export interface GroupedBarPoint {
  label: string
  /** Longer caption used in the hover title. */
  caption?: string
  a: number
  b: number
}

export interface GroupedBarsProps {
  data: readonly GroupedBarPoint[]
  seriesA: { label: string; color?: string }
  seriesB: { label: string; color?: string }
  height?: number
  /** Number of horizontal axis ticks, including zero. */
  ticks?: number
  className?: string
  title?: string
}

/**
 * Two-series grouped bars with a value axis down the left.
 *
 * Pairing the bars is the whole point: a single series answers "how many", but
 * the pair answers "are we keeping up", which is the only question an official
 * actually has about incoming work. No gridlines behind the plot — the axis
 * labels alone carry the scale, and empty tracks behind every bar flatten the
 * comparison the chart exists to make.
 */
export function GroupedBars({
  data,
  seriesA,
  seriesB,
  height = 168,
  ticks = 6,
  className,
  title,
}: GroupedBarsProps) {
  const max = React.useMemo(
    () => niceMax(data.flatMap((point) => [point.a, point.b])),
    [data],
  )

  const axis = React.useMemo(
    () => Array.from({ length: ticks }, (_, index) => Math.round((max / (ticks - 1)) * index)),
    [max, ticks],
  )

  const colorA = seriesA.color ?? "var(--color-brand-navy)"
  const colorB = seriesB.color ?? "var(--color-chart-track)"

  if (data.length === 0) {
    return (
      <div
        className={cn("flex items-center justify-center rounded-panel bg-chart-track/40", className)}
        style={{ height }}
      >
        <span className="text-xs font-semibold text-subtle-foreground">No data yet</span>
      </div>
    )
  }

  return (
    <div
      className={cn("flex w-full gap-3", className)}
      role="img"
      aria-label={
        title ??
        `Grouped bar chart. ${data
          .map((d) => `${d.label}: ${seriesA.label} ${d.a}, ${seriesB.label} ${d.b}`)
          .join(". ")}`
      }
    >
      {/* Value axis. `-my-[6px]` centres each label on its gridline position
          rather than stacking label boxes, so "0" sits level with the floor. */}
      <div
        className="-my-[6px] flex shrink-0 flex-col-reverse justify-between"
        style={{ height }}
        aria-hidden
      >
        {axis.map((tick, index) => (
          <span key={index} className="text-[10px] font-semibold leading-3 text-subtle-foreground tabular-nums">
            {tick}
          </span>
        ))}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-end gap-1.5" style={{ height }}>
          {data.map((point) => (
            <div
              key={point.label}
              className="flex min-w-0 flex-1 items-end justify-center gap-[3px]"
              title={`${point.caption ?? point.label} · ${seriesA.label}: ${point.a} · ${seriesB.label}: ${point.b}`}
            >
              <span
                className="w-[9px] max-w-[42%] shrink-0 rounded-t-[3px] transition-[height] duration-500 ease-out"
                style={{
                  height: `${Math.max(ratio(point.a, max) * 100, point.a > 0 ? 2 : 0)}%`,
                  backgroundColor: colorA,
                }}
              />
              <span
                className="w-[9px] max-w-[42%] shrink-0 rounded-t-[3px] transition-[height] duration-500 ease-out"
                style={{
                  height: `${Math.max(ratio(point.b, max) * 100, point.b > 0 ? 2 : 0)}%`,
                  backgroundColor: colorB,
                }}
              />
            </div>
          ))}
        </div>

        <div className="mt-2.5 flex gap-1.5">
          {data.map((point) => (
            <span
              key={point.label}
              className="min-w-0 flex-1 truncate text-center text-[10.5px] font-semibold text-subtle-foreground"
            >
              {point.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
