import { useId, type ReactNode } from "react"

import { cn } from "@workspace/ui/lib/utils"

import { arcPath } from "./lib"

export interface ArcGaugeProps {
  /** 0-1. Clamped. */
  value: number
  /** Large centre figure. Defaults to the value as a percentage. */
  centerValue?: string
  /** One small word under the figure. */
  centerLabel: string
  /** One quieter line under that. */
  centerNote?: ReactNode
  /** Rendered size in px. */
  size?: number
  /** Degrees of sweep. The gap sits at the bottom. */
  sweep?: number
  color?: string
  /** Sweep stroke as a gradient instead of a flat colour, start to end. */
  gradient?: readonly [string, string]
  trackColor?: string
  className?: string
  /** Plain-words description for screen readers. */
  title?: string
}

const VIEW = 160
const CENTER = 80
const RADIUS = 62
const STROKE = 18

/**
 * A single-value arc with the figure living in the middle of it.
 *
 * Kept separate from a proportional multi-slice ring: that shape is
 * butt-capped and gapped between slices, and every one of those decisions
 * inverts here. Sharing one component would mean props that swap the cap, the
 * sweep origin and the gap logic — two components wearing one name. Only
 * `arcPath` is shared.
 */
export function ArcGauge({
  value,
  centerValue,
  centerLabel,
  centerNote,
  size = 190,
  sweep = 240,
  color = "var(--color-brand-navy)",
  gradient,
  trackColor = "var(--color-chart-track)",
  className,
  title,
}: ArcGaugeProps) {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
  // `arcPath` puts 0° at 12 o'clock and increases clockwise, so centring the
  // gap on 180° (the bottom) means the arc opens at 180 + half the leftover.
  const start = 180 + (360 - sweep) / 2
  const label = centerValue ?? `${Math.round(clamped * 100)}%`
  const gradientId = `arc-gauge-${useId().replace(/[^a-zA-Z0-9]/g, "")}`
  const stroke = gradient ? `url(#${gradientId})` : color

  return (
    <div
      className={cn("relative shrink-0", className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={title ?? `${label} ${centerLabel}`}
    >
      <svg viewBox={`0 0 ${VIEW} ${VIEW}`} className="size-full" aria-hidden>
        {gradient ? (
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={gradient[0]} />
              <stop offset="100%" stopColor={gradient[1]} />
            </linearGradient>
          </defs>
        ) : null}
        <path
          d={arcPath(CENTER, CENTER, RADIUS, start, start + sweep)}
          fill="none"
          stroke={trackColor}
          strokeWidth={STROKE}
          strokeLinecap="round"
        />
        {/* Skipped at zero: a round cap on an empty arc still paints a dot,
            which reads as a small non-zero value. */}
        {clamped > 0 ? (
          <path
            d={arcPath(CENTER, CENTER, RADIUS, start, start + sweep * clamped)}
            fill="none"
            stroke={stroke}
            strokeWidth={STROKE}
            strokeLinecap="round"
          />
        ) : null}
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
        {/* 600, never `font-bold`: Saans ships 400/500/600, and a synthetic
            bold smears visibly at this size. */}
        <span className="text-[56px] font-semibold leading-none tracking-tight text-brand-navy tabular-nums">
          {label}
        </span>
        <span className="mt-2 text-label text-subtle-foreground">{centerLabel}</span>
        {centerNote ? (
          <span className="mt-1 text-micro text-faint-foreground">{centerNote}</span>
        ) : null}
      </div>
    </div>
  )
}
