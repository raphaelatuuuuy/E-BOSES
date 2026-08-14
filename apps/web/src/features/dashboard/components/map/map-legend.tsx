import { useState } from "react"
import { LayersIcon, XIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import {
  MAP_HOVER,
  MAP_INK,
  MAP_LINE,
  MAP_MUTED,
  MAP_SURFACE,
  type MapTone,
} from "./map-tone"

export interface MapLegendRow<K extends string> {
  key: K
  label: string
  hint?: string
  count?: number
  /** Pin colour for this layer. Colour identifies a layer; nothing else is coloured. */
  tone?: string
}

/**
 * One legend for both alert maps.
 *
 * Collapsed it is a single icon button, so on a phone the legend costs 40px of
 * the one view this screen exists to show. It opens upward because it lives
 * below the map, clear of the control column in the top-right corner.
 */
export function MapLegend<K extends string>({
  tone,
  rows,
  reference = [],
  active,
  onToggle,
  onReset,
  className,
}: {
  tone: MapTone
  rows: MapLegendRow<K>[]
  reference?: MapLegendRow<K>[]
  active: Record<K, boolean>
  onToggle: (key: K) => void
  onReset?: () => void
  className?: string
}) {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Show the map legend"
        aria-expanded={false}
        title="Map legend"
        className={cn(
          "flex size-10 items-center justify-center rounded-xl border shadow-md transition-colors",
          MAP_SURFACE[tone],
          MAP_INK[tone],
          MAP_HOVER[tone],
          className,
        )}
      >
        <LayersIcon className="size-5" strokeWidth={1.9} />
      </button>
    )
  }

  return (
    <div
      className={cn(
        "w-[min(17rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border shadow-lg",
        MAP_SURFACE[tone],
        className,
      )}
    >
      <div className={cn("flex items-center gap-2 border-b px-3 py-2", MAP_LINE[tone])}>
        <LayersIcon className={cn("size-4 shrink-0", MAP_MUTED[tone])} strokeWidth={2} />
        <span className={cn("text-[13px] font-semibold", MAP_INK[tone])}>On the map</span>
        {onReset ? (
          <button
            type="button"
            onClick={onReset}
            className="ml-auto text-[12px] font-semibold text-accent transition-opacity hover:opacity-75"
          >
            Reset
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Hide the map legend"
          className={cn(
            "-mr-1 flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors",
            onReset ? "" : "ml-auto",
            MAP_MUTED[tone],
            MAP_HOVER[tone],
          )}
        >
          <XIcon className="size-4" strokeWidth={2.2} />
        </button>
      </div>

      <ul className="p-1.5">
        {rows.map((row) => {
          const on = active[row.key]
          return (
            <li key={row.key}>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                onClick={() => onToggle(row.key)}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors",
                  MAP_HOVER[tone],
                  !on && "opacity-45",
                )}
              >
                {row.tone ? (
                  <span
                    aria-hidden
                    className="mt-1 size-3 shrink-0 rounded-full ring-2 ring-white/70"
                    style={{ backgroundColor: row.tone }}
                  />
                ) : (
                  <span className="mt-1 size-3 shrink-0" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-1.5">
                    <span className={cn("text-[13px] font-semibold", MAP_INK[tone])}>
                      {row.label}
                    </span>
                    {row.count != null ? (
                      <span
                        className={cn(
                          "text-[11px] font-semibold tabular-nums",
                          MAP_MUTED[tone],
                        )}
                      >
                        {row.count}
                      </span>
                    ) : null}
                  </span>
                  {row.hint ? (
                    <span
                      className={cn("mt-0.5 block text-[11.5px] leading-snug", MAP_MUTED[tone])}
                    >
                      {row.hint}
                    </span>
                  ) : null}
                </span>
                <span
                  aria-hidden
                  className={cn(
                    "mt-1 flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 transition-colors",
                    on
                      ? tone === "dark"
                        ? "bg-white/70"
                        : "bg-brand-navy"
                      : tone === "dark"
                        ? "bg-white/20"
                        : "bg-neutral-300",
                  )}
                >
                  <span
                    className={cn(
                      "size-3 rounded-full transition-transform",
                      tone === "dark" && on ? "bg-nav-bg" : "bg-white",
                      on && "translate-x-3",
                    )}
                  />
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      {reference.length > 0 ? (
        <div className={cn("flex flex-wrap gap-1.5 border-t px-3 py-2.5", MAP_LINE[tone])}>
          {reference.map((row) => (
            <button
              key={row.key}
              type="button"
              onClick={() => onToggle(row.key)}
              aria-pressed={active[row.key]}
              className={cn(
                "rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition-colors",
                active[row.key]
                  ? tone === "dark"
                    ? "bg-white/12 text-white"
                    : "bg-neutral-200 text-neutral-900"
                  : cn(
                      tone === "dark"
                        ? "bg-white/5 text-white/40"
                        : "bg-neutral-100 text-neutral-400",
                      MAP_HOVER[tone],
                    ),
              )}
            >
              {row.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
