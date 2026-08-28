import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

import { niceMax, ratio } from "./lib"

export interface ColumnPoint {
  /** Axis tick. Pass "" to leave this column unlabelled. */
  label: string
  /** Full words, used for the hover title and the generated description. */
  caption?: string
  value: number
}

export interface ColumnChartProps {
  data: readonly ColumnPoint[]
  /** Design-unit plot height. The rendered height follows the container width. */
  height?: number
  barColor?: string
  /** Bar fill as a top-to-bottom gradient instead of a flat colour. */
  barGradient?: readonly [string, string]
  /** Colour of the diagonal hatch drawn behind every bar. */
  trackColor?: string
  /** Index of the bar that carries a floating value pill. */
  highlightIndex?: number
  className?: string
  /** Plain-words description for screen readers. */
  title?: string
  /** Plain-words empty state. */
  emptyLabel?: string
}

const BAR_WIDTH = 20
const BAR_GAP = 8
const PILL_HEIGHT = 26
const PILL_GAP = 10
const AXIS_HEIGHT = 26

/**
 * Capsule bars standing in hatched full-height tracks.
 *
 * SVG rather than the flex boxes the rest of the kit uses, because the hatch
 * needs a `<pattern>` in `<defs>` and the capsule needs `rx` on a rect — CSS
 * can fake neither at this bar weight. Everything including the axis ticks
 * lives inside the viewBox, so the whole plot scales as one piece; a DOM label
 * row beside a scaled SVG drifts out of register the moment the card resizes.
 *
 * The track is not decoration. A bar alone says "six today"; a bar inside a
 * track that reaches the month's peak says "six, on a day we have seen
 * eighteen", which is the question an official is actually asking. It is also
 * why the series arrives zero-filled — a quiet day still has to draw a track.
 */
export function ColumnChart({
  data,
  height = 240,
  barColor = "var(--color-brand-navy)",
  barGradient,
  trackColor = "var(--color-chart-track)",
  highlightIndex,
  className,
  title,
  emptyLabel = "Nothing has been filed in this period",
}: ColumnChartProps) {
  // A literal id would be shared by every chart on the page, so the second one
  // mounted paints from the first one's defs and loses its fill when that one
  // unmounts. Every non-alphanumeric is stripped rather than just `:` — that
  // form assumes React 18's delimiter, and this app is on React 19.
  const uid = React.useId().replace(/[^a-zA-Z0-9]/g, "")
  const hatchId = `col-hatch-${uid}`
  const barFillId = `col-fill-${uid}`
  const barFill = barGradient ? `url(#${barFillId})` : barColor

  const max = React.useMemo(() => niceMax(data.map((point) => point.value)), [data])
  const empty = data.length === 0 || data.every((point) => point.value === 0)

  if (empty) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-bento bg-chart-track/40 px-6 text-center",
          className,
        )}
        style={{ minHeight: 180 }}
      >
        <span className="text-meta text-subtle-foreground">{emptyLabel}</span>
      </div>
    )
  }

  const plotTop = PILL_HEIGHT + PILL_GAP
  const plotHeight = height - plotTop - AXIS_HEIGHT
  const baseline = plotTop + plotHeight
  const width = data.length * BAR_WIDTH + (data.length - 1) * BAR_GAP
  const radius = BAR_WIDTH / 2

  return (
    // Thirty columns cannot squash into a phone without becoming a smear, so the
    // plot scrolls sideways below `md` instead of shrinking.
    <div className={cn("-mx-5 overflow-x-auto px-5 md:mx-0 md:overflow-visible md:px-0", className)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full min-w-[600px] md:min-w-0"
        role="img"
        aria-label={
          title ??
          `Column chart. ${data
            .map((point) => `${point.caption ?? point.label}: ${point.value}`)
            .join(". ")}`
        }
      >
        <defs>
          <pattern
            id={hatchId}
            width="7"
            height="7"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2="7" stroke={trackColor} strokeWidth="4" />
          </pattern>
          {barGradient ? (
            <linearGradient id={barFillId} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={barGradient[0]} />
              <stop offset="100%" stopColor={barGradient[1]} />
            </linearGradient>
          ) : null}
        </defs>

        {data.map((point, index) => {
          const x = index * (BAR_WIDTH + BAR_GAP)
          // A count of one still reads as a capsule rather than a sliver.
          const barHeight =
            point.value > 0 ? Math.max(ratio(point.value, max) * plotHeight, BAR_WIDTH) : 0

          return (
            <g key={`${point.label}-${index}`}>
              <title>{`${point.caption ?? point.label}: ${point.value}`}</title>
              <rect
                x={x}
                y={plotTop}
                width={BAR_WIDTH}
                height={plotHeight}
                rx={radius}
                fill={`url(#${hatchId})`}
              />
              {barHeight > 0 ? (
                <rect
                  x={x}
                  y={baseline - barHeight}
                  width={BAR_WIDTH}
                  height={barHeight}
                  rx={radius}
                  fill={barFill}
                />
              ) : null}
              {point.label ? (
                <text
                  x={x + radius}
                  y={baseline + AXIS_HEIGHT / 2 + 2}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="var(--color-subtle-foreground)"
                  fontSize="12"
                  fontWeight="500"
                >
                  {point.label}
                </text>
              ) : null}
            </g>
          )
        })}

        {highlightIndex !== undefined && data[highlightIndex] ? (
          <HighlightPill
            index={highlightIndex}
            value={data[highlightIndex].value}
            max={max}
            plotHeight={plotHeight}
            baseline={baseline}
            chartWidth={width}
          />
        ) : null}
      </svg>
    </div>
  )
}

function HighlightPill({
  index,
  value,
  max,
  plotHeight,
  baseline,
  chartWidth,
}: {
  index: number
  value: number
  max: number
  plotHeight: number
  baseline: number
  chartWidth: number
}) {
  const label = String(value)
  const pillWidth = Math.max(36, label.length * 11 + 20)
  const barHeight = value > 0 ? Math.max(ratio(value, max) * plotHeight, BAR_WIDTH) : 0
  const centre = index * (BAR_WIDTH + BAR_GAP) + BAR_WIDTH / 2
  // Clamped so a pill on the first or last column does not hang off the plot.
  const x = Math.min(Math.max(centre - pillWidth / 2, 0), chartWidth - pillWidth)
  const y = Math.max(baseline - barHeight - PILL_GAP - PILL_HEIGHT, 0)

  return (
    <g aria-hidden>
      <rect
        x={x}
        y={y}
        width={pillWidth}
        height={PILL_HEIGHT}
        rx={PILL_HEIGHT / 2}
        fill="var(--color-ink)"
      />
      <text
        x={x + pillWidth / 2}
        y={y + PILL_HEIGHT / 2 + 1}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="var(--color-card)"
        fontSize="13"
        fontWeight="600"
      >
        {label}
      </text>
    </g>
  )
}
