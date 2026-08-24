import { useState } from "react"
import { ChevronDownIcon, LayersIcon, XIcon } from "lucide-react"

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
  forceOpen = false,
  onClose,
  plain = false,
}: {
  tone: MapTone
  rows: MapLegendRow<K>[]
  reference?: MapLegendRow<K>[]
  active: Record<K, boolean>
  onToggle: (key: K) => void
  onReset?: () => void
  className?: string
  forceOpen?: boolean
  onClose?: () => void
  plain?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)

  if (!forceOpen && !open) {
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
        plain
          ? "w-full"
          : "w-[min(17rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border shadow-lg",
        !plain && MAP_SURFACE[tone],
        className,
      )}
    >
      <div className={cn("flex items-center gap-2 px-3 py-2", !plain && MAP_LINE[tone])}>
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
          onClick={() => (onClose ? onClose() : setOpen(false))}
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

      <ul className={plain ? "pt-1" : "p-1.5"}>
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
                  "flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors",
                  MAP_HOVER[tone],
                  !on && "opacity-45",
                )}
              >
                {row.tone ? (
                  <span
                    aria-hidden
                    className="size-3 shrink-0 rounded-full"
                    style={{ backgroundColor: row.tone }}
                  />
                ) : (
                  <span className="size-3 shrink-0" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className={cn("truncate text-[13px] font-semibold", MAP_INK[tone])}>
                      {row.label}
                    </span>
                    {row.count != null ? (
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-1.5 text-[11px] font-semibold leading-4 tabular-nums",
                          tone === "dark" ? "bg-white/10 text-white/60" : "bg-neutral-100 text-neutral-500",
                        )}
                      >
                        {row.count}
                      </span>
                    ) : null}
                  </span>
                  {row.hint ? (
                    <span
                      className={cn("mt-0.5 block truncate text-[11.5px] leading-snug", MAP_MUTED[tone])}
                    >
                      {row.hint}
                    </span>
                  ) : null}
                </span>
                <span
                  aria-hidden
                  className={cn(
                    "flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 transition-colors",
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
        <>
          <button
            type="button"
            onClick={() => setMoreOpen((current) => !current)}
            aria-expanded={moreOpen}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] font-semibold transition-colors",
              !plain && MAP_LINE[tone],
              MAP_MUTED[tone],
              MAP_HOVER[tone],
            )}
          >
            More layers
            {reference.some((row) => active[row.key]) ? (
              <span className="text-[11px] font-semibold tabular-nums">
                {reference.filter((row) => active[row.key]).length}
              </span>
            ) : null}
            <ChevronDownIcon
              className={cn(
                "ml-auto size-4 shrink-0 transition-transform",
                moreOpen && "rotate-180",
              )}
              strokeWidth={2.2}
            />
          </button>
          <div
            className={cn(
              "grid transition-[grid-template-rows] duration-200 ease-out",
              moreOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
            )}
          >
            <div className="overflow-hidden">
              <div className="flex flex-wrap gap-1.5 px-3 pb-2.5 pt-2">
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
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
