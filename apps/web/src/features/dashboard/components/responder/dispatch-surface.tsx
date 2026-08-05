import * as React from "react"
import type { LucideIcon } from "lucide-react"
import { ChevronDownIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { dotClass, toneClass, type StateTone } from "@/features/dashboard/lib/responder-format"

/**
 * The surface vocabulary for the responder console.
 *
 * One card shape, one header shape, one status treatment, one metric tile —
 * declared once here so no screen drifts from another. Every responder page
 * (Dispatch, Map, Shift, Profile) draws from this file; nothing in those pages
 * should reinvent a card border, a title size or a tile.
 *
 * Elevation is lightness plus a hairline, never a shadow: the shell runs on the
 * dark ops palette, where a drop shadow is invisible and a border is not.
 */

export function DispatchCard({
  children,
  className,
  as: Tag = "section",
  padded = true,
}: {
  children: React.ReactNode
  className?: string
  as?: "section" | "div" | "aside"
  /** Off for the map card, which fills its surface edge to edge. */
  padded?: boolean
}) {
  return (
    <Tag
      className={cn(
        "min-w-0 overflow-hidden rounded-3xl border border-card-line bg-card",
        padded && "p-5 lg:p-6",
        className,
      )}
    >
      {children}
    </Tag>
  )
}

/**
 * Title + optional subtitle on the left, an overflow control on the right.
 *
 * The title is 22px/bold rather than the smaller `text-title` it used to be.
 * This is the reference's card head — "Order #3155115" set large with a quiet
 * status line under it — and the size is doing work beyond decoration: it is
 * the one line that tells a responder at a glance which incident is on screen,
 * on a device they are often reading at arm's length.
 */
export function CardHead({
  title,
  subtitle,
  action,
  className,
}: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <h2 className="truncate text-[22px] font-bold leading-tight tracking-tight text-foreground">
          {title}
        </h2>
        {subtitle ? <div className="mt-1.5 min-w-0">{subtitle}</div> : null}
      </div>
      {action ? <div className="-mr-2 shrink-0">{action}</div> : null}
    </div>
  )
}

/**
 * Collapse state for a pane, persisted per responder.
 *
 * Lives here rather than in the console so every pane that opts into a header
 * chevron behaves identically and remembers itself across reloads — a
 * responder who works with the comms pane shut should not have to shut it
 * again every shift.
 */
export function usePaneCollapse(storageKey: string, initial = false) {
  const [collapsed, setCollapsed] = React.useState(() => {
    if (typeof window === "undefined") return initial
    const raw = window.localStorage.getItem(storageKey)
    return raw == null ? initial : raw === "1"
  })

  React.useEffect(() => {
    window.localStorage.setItem(storageKey, collapsed ? "1" : "0")
  }, [collapsed, storageKey])

  return [collapsed, setCollapsed] as const
}

/**
 * A card that owns a region of the workspace and can be minimised to its title
 * strip.
 *
 * This is the other half of the resizable split: dragging a divider changes how
 * two panes share space, and minimising gives all of it to the neighbour. Both
 * were missing, which is why three fixed-ratio containers felt cramped —
 * nothing on the screen could be made bigger without making the window bigger.
 */
export function Pane({
  title,
  subtitle,
  icon: Icon,
  action,
  collapsed,
  onCollapsedChange,
  padded = true,
  bodyClassName,
  className,
  children,
}: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  icon?: LucideIcon
  action?: React.ReactNode
  collapsed?: boolean
  onCollapsedChange?: (next: boolean) => void
  padded?: boolean
  bodyClassName?: string
  className?: string
  children: React.ReactNode
}) {
  const collapsible = onCollapsedChange != null
  const isCollapsed = Boolean(collapsed)

  return (
    <section
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-hidden rounded-3xl border border-card-line bg-card",
        className,
      )}
    >
      <header
        className={cn(
          "flex h-14 shrink-0 items-center gap-2.5 pl-5 pr-2",
          !isCollapsed && "border-b border-card-line",
        )}
      >
        {Icon ? <Icon className="size-4 shrink-0 text-subtle-foreground" /> : null}
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <h2 className="min-w-0 truncate text-[15px] font-bold leading-none text-foreground">
            {title}
          </h2>
          {subtitle ? (
            <span className="shrink-0 truncate text-micro uppercase text-subtle-foreground">
              {subtitle}
            </span>
          ) : null}
        </div>
        {action}
        {collapsible ? (
          <button
            type="button"
            onClick={() => onCollapsedChange?.(!isCollapsed)}
            aria-expanded={!isCollapsed}
            aria-label={isCollapsed ? `Expand ${title}` : `Minimise ${title}`}
            title={isCollapsed ? "Expand" : "Minimise"}
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-subtle-foreground transition-colors hover:bg-card-raised hover:text-foreground"
          >
            <ChevronDownIcon
              className={cn(
                "size-4 transition-transform duration-200",
                isCollapsed && "-rotate-90",
              )}
              strokeWidth={2.4}
            />
          </button>
        ) : null}
      </header>

      {!isCollapsed ? (
        <div
          className={cn(
            "ops-pane min-h-0 flex-1",
            padded && "p-5",
            bodyClassName,
          )}
        >
          {children}
        </div>
      ) : null}
    </section>
  )
}

/** The one status treatment in the console: a dot, then a word. */
export function State({
  label,
  tone,
  className,
}: {
  label: string
  tone: StateTone
  className?: string
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-label", className)}>
      <span className={cn("size-1.5 shrink-0 rounded-pill", dotClass(tone))} aria-hidden />
      <span className={cn("uppercase tracking-wide", toneClass(tone))}>{label}</span>
    </span>
  )
}

/**
 * Two-option segmented control.
 *
 * Generic over the option id so callers get a narrowed `onChange` instead of a
 * bare string.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: ReadonlyArray<{ id: T; label: string }>
  value: T
  onChange: (id: T) => void
  label: string
  className?: string
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        "grid gap-1 rounded-pill border border-card-line bg-card-raised p-1",
        className,
      )}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const selected = option.id === value
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(option.id)}
            className={cn(
              "flex h-10 items-center justify-center rounded-pill text-label transition-colors duration-[--duration-micro]",
              selected
                ? "bg-card text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                : "text-subtle-foreground hover:text-muted-foreground",
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * The reference's metric tile: a glyph in a rounded square, then a large value
 * with its unit trailing in small muted type, then a tiny lowercase label.
 *
 * The split value ("97.4" + "mi") is the detail that makes the reference row
 * read as a dashboard rather than three sentences — the eye lands on the
 * magnitude and picks up the unit second. `value`/`unit` are separate props so
 * callers cannot accidentally set the unit at full size.
 *
 * `tone` selects the glyph colour only. Per the warm/cold rule in globals.css
 * these are things being *measured*, so the default is ice, not orange; alarm
 * is reserved for a figure that has gone wrong (an incident open too long).
 */
export type TileTone = "ice" | "alarm" | "settled" | "warm"

const TILE_GLYPH: Record<TileTone, string> = {
  ice: "border-card-line-strong text-ice",
  alarm: "border-sos/40 text-sos",
  settled: "border-status-closed/40 text-status-closed",
  warm: "border-brand-orange/40 text-brand-orange",
}

export function MetricTile({
  icon: Icon,
  value,
  unit,
  label,
  tone = "ice",
  className,
}: {
  icon: LucideIcon
  value: string
  /** Trailing unit, set small and muted beside the value. */
  unit?: string
  label: string
  tone?: TileTone
  className?: string
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-2xl border border-card-line bg-card-raised p-3.5",
        className,
      )}
    >
      <span
        className={cn(
          "flex size-9 items-center justify-center rounded-xl border",
          TILE_GLYPH[tone],
        )}
      >
        <Icon className="size-4" />
      </span>
      <p className="mt-3 flex min-w-0 items-baseline gap-1">
        <span className="truncate text-[20px] font-bold leading-none tabular-nums text-foreground">
          {value}
        </span>
        {unit ? (
          <span className="shrink-0 text-[12px] font-semibold leading-none text-subtle-foreground">
            {unit}
          </span>
        ) : null}
      </p>
      <p className="mt-1.5 truncate text-micro uppercase text-subtle-foreground">{label}</p>
    </div>
  )
}

/**
 * What a minimised column leaves behind: a 44px strip carrying its name
 * sideways and the control to bring it back.
 *
 * A collapsed region has to stay visible as *something*, or the only way back
 * is a reset button the responder has to know exists. 44px is the pointer
 * floor, so the whole strip is the target.
 */
export function CollapsedStrip({
  label,
  onExpand,
  className,
}: {
  label: string
  onExpand: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onExpand}
      aria-label={`Expand ${label}`}
      title={`Expand ${label}`}
      className={cn(
        "flex w-11 shrink-0 flex-col items-center gap-3 rounded-3xl border border-card-line bg-card py-4 text-subtle-foreground transition-colors hover:bg-card-raised hover:text-foreground",
        className,
      )}
    >
      <ChevronDownIcon className="size-4 shrink-0 -rotate-90" strokeWidth={2.4} />
      <span
        className="whitespace-nowrap text-micro uppercase"
        style={{ writingMode: "vertical-rl" }}
      >
        {label}
      </span>
    </button>
  )
}

/** Body copy for an empty region. */
export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-body text-subtle-foreground">{children}</p>
}
