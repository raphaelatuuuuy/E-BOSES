import { cn } from "@workspace/ui/lib/utils"

export interface ShareSegment {
  key: string
  label: string
  value: number
}

export interface ShareBarProps {
  segments: readonly ShareSegment[]
  /** Tailwind background classes, one per segment, in the same order. */
  fills: readonly string[]
  /** Class for the percentage printed above each segment. */
  captionClassName?: string
  /** Class for the label / count line printed below the bar. */
  legendClassName?: string
  height?: number
  className?: string
  /** Plain-words description for screen readers. */
  title?: string
}

/**
 * One proportional strip, with each share's percentage printed above it.
 *
 * Flex rather than SVG: the geometry is one-dimensional, `flexGrow` is exact,
 * and it reflows with the card for free. Colour is passed in as classes so the
 * component carries none of its own — on the navy hero card the caller sends a
 * white opacity ramp, which keeps the page monochrome and keeps this out of the
 * "coloured pills" the design system bans.
 *
 * The key is positional: the labels under the bar run left to right in the same
 * order as the segments, so no dots are needed to map one to the other.
 */
export function ShareBar({
  segments,
  fills,
  captionClassName,
  legendClassName,
  height = 14,
  className,
  title,
}: ShareBarProps) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0)
  // A zero segment would still show as a sliver because of the min width.
  const shown = segments.filter((segment) => segment.value > 0)

  if (total === 0 || shown.length === 0) return null

  const percent = (value: number) => Math.round((value / total) * 100)

  return (
    <div
      className={cn("min-w-0", className)}
      role="img"
      aria-label={
        title ??
        shown.map((segment) => `${segment.label}: ${percent(segment.value)} percent`).join(", ")
      }
    >
      <div className="flex gap-4" aria-hidden>
        {shown.map((segment) => (
          <span
            key={segment.key}
            className={cn("min-w-0 tabular-nums", captionClassName)}
            style={{ flexGrow: segment.value, flexBasis: 0 }}
          >
            {percent(segment.value)}%
          </span>
        ))}
      </div>

      <div className="mt-2 flex gap-1.5" style={{ height }} aria-hidden>
        {shown.map((segment, index) => (
          <span
            key={segment.key}
            className={cn("min-w-[4px] rounded-pill", fills[index] ?? fills[fills.length - 1])}
            style={{ flexGrow: segment.value, flexBasis: 0 }}
          />
        ))}
      </div>

      <div className="mt-3 flex gap-4" aria-hidden>
        {shown.map((segment) => (
          <span
            key={segment.key}
            className={cn("min-w-0 truncate", legendClassName)}
            style={{ flexGrow: segment.value, flexBasis: 0 }}
          >
            {segment.label}
          </span>
        ))}
      </div>
    </div>
  )
}
