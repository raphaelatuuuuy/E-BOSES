import * as React from "react"
import { cn } from "@workspace/ui/lib/utils"

import { CHART_COLORS, niceMax, ratio } from "./lib"

export interface BarPoint {
  label: string
  value: number
  /** Optional longer label used in the callout instead of `label`. */
  caption?: string
}

export interface BarSeriesProps {
  data: readonly BarPoint[]
  color?: string
  /** Height of the plot area in px. */
  height?: number
  /** Suffix rendered after the value in the callout (e.g. "reports"). */
  unit?: string
  /** Highlight the tallest bar on load. Hovering overrides it. */
  highlightPeak?: boolean
  /** Hide the x-axis captions — for mini charts embedded in stat cards. */
  showLabels?: boolean
  /** Hide the floating value callout. */
  showCallout?: boolean
  /** Draw a dashed reference line at this value (e.g. the period average). */
  baseline?: number
  /** Caption printed at the right end of the baseline. */
  baselineLabel?: string
  className?: string
  title?: string
}

/**
 * Vertical bars with a floating callout on the peak (or the hovered bar).
 *
 * Built with flex + CSS rather than SVG: bar charts need per-bar hit targets
 * and a tooltip anchored to a bar, both of which are simpler and more
 * accessible as real DOM nodes than as SVG rects.
 */
export function BarSeries({
  data,
  color = CHART_COLORS[0],
  height = 132,
  unit,
  highlightPeak = true,
  showLabels = true,
  showCallout = true,
  baseline,
  baselineLabel,
  className,
  title,
}: BarSeriesProps) {
  const [hovered, setHovered] = React.useState<number | null>(null)

  const max = niceMax(data.map((d) => d.value))
  const peakIndex = React.useMemo(() => {
    if (!highlightPeak || data.length === 0) return null
    let best = 0
    data.forEach((d, i) => {
      if (d.value > data[best].value) best = i
    })
    return data[best].value > 0 ? best : null
  }, [data, highlightPeak])

  const activeIndex = hovered ?? peakIndex
  const active = activeIndex != null ? data[activeIndex] : null

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
    // The callout is absolutely positioned above the plot, so when it is shown
    // the wrapper reserves headroom for it. Without this it escapes upward and
    // paints over whatever sits above the chart in the card.
    <div className={cn("w-full", showCallout && "pt-7", className)}>
      <div
        className="relative flex items-end gap-1.5"
        style={{ height }}
        onMouseLeave={() => setHovered(null)}
        role="img"
        aria-label={
          title ??
          `Bar chart. ${data.map((d) => `${d.label}: ${d.value}`).join(", ")}`
        }
      >
        {data.map((point, index) => {
          const isActive = index === activeIndex
          const pct = ratio(point.value, max)
          return (
            <div
              key={`${point.label}-${index}`}
              className="group relative flex h-full flex-1 cursor-default flex-col justify-end"
              onMouseEnter={() => setHovered(index)}
              onFocus={() => setHovered(index)}
              onBlur={() => setHovered(null)}
              tabIndex={0}
              aria-label={`${point.caption ?? point.label}: ${point.value}${unit ? ` ${unit}` : ""}`}
            >
              {/* Solid neutral bar; only the active one takes the accent. No
                  full-height track behind it — an empty track at every column
                  greys out the whole plot and flattens the comparison. */}
              <div
                className="relative rounded-t-[6px] transition-[height,background-color] duration-300 ease-out"
                style={{
                  height: `${Math.max(pct * 100, point.value > 0 ? 4 : 0)}%`,
                  backgroundColor: isActive ? color : "var(--color-chart-track)",
                }}
              />
            </div>
          )
        })}

        {/* Dashed reference line across the plot (period average). */}
        {baseline != null && baseline > 0 && baseline <= max ? (
          <div
            className="pointer-events-none absolute inset-x-0 z-[5] flex items-center"
            style={{ bottom: `${ratio(baseline, max) * 100}%` }}
          >
            <span className="h-px flex-1 border-t border-dashed border-card-line" />
            {baselineLabel ? (
              <span className="ml-1.5 shrink-0 rounded bg-card/90 px-1 text-[9.5px] font-bold uppercase tracking-wide text-subtle-foreground">
                {baselineLabel}
              </span>
            ) : null}
          </div>
        ) : null}

        {/* Callout pinned above the active bar. `left` is clamped so the pill
            never escapes the card on the first or last column. */}
        {showCallout && active && activeIndex != null ? (
          <div
            className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 -translate-y-full transition-[left] duration-200"
            style={{
              left: `${Math.min(94, Math.max(6, ((activeIndex + 0.5) / data.length) * 100))}%`,
            }}
          >
            <div className="whitespace-nowrap rounded-control bg-brand-navy px-2 py-1 text-[11px] font-bold text-white shadow-sm">
              {active.value}
              {unit ? <span className="font-medium opacity-70"> {unit}</span> : null}
            </div>
            <div className="mx-auto size-0 border-x-4 border-t-4 border-x-transparent border-t-brand-navy" />
          </div>
        ) : null}
      </div>

      {showLabels ? (
        <div className="mt-2 flex gap-1.5">
          {data.map((point, index) => (
            <span
              key={`${point.label}-label-${index}`}
              className={cn(
                "flex-1 truncate text-center text-[10.5px] transition-colors",
                index === activeIndex ? "font-bold text-brand-navy" : "font-medium text-subtle-foreground",
              )}
            >
              {point.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}
