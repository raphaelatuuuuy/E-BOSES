import { useState, type ElementType, type ReactNode } from "react"
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

/**
 * One bordered surface per pane. Everything inside it is a band.
 *
 * The console had grown a card habit: `incident-board.tsx` rendered nine
 * `rounded-panel border bg-card` blocks inside a pane that is itself a bordered
 * panel, and the dispatch aside rendered four. Card-inside-card means every
 * region draws its own box, so no region reads as more important than another —
 * an official scanning for the one thing they must act on has nine equal
 * candidates.
 *
 * `Surface` draws the single border. `Band` is a labelled region inside it,
 * separated from its neighbour by a hairline rather than by a gap and a second
 * border. Emphasis is then available again: a band that needs attention can
 * take a tone, and it will be the only thing on the pane that has one.
 */

export function Surface({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={cn(
        "divide-y divide-card-line overflow-hidden rounded-[24px] bg-neutral-50",
        className,
      )}
    >
      {children}
    </section>
  )
}

export type BandTone = "default" | "alert" | "warn" | "good"

/**
 * Only a band that needs someone takes a surface. `warn` and `good` used to
 * tint too, so on a busy incident three bands were coloured at once and none of
 * them read as the exception.
 */
const toneSurface: Record<BandTone, string> = {
  default: "",
  alert: "bg-card-raised",
  warn: "",
  good: "",
}

const toneLabel: Record<BandTone, string> = {
  default: "",
  alert: "text-sos",
  warn: "text-subtle-foreground",
  good: "text-subtle-foreground",
}

export function Band({
  label,
  icon,
  action,
  meta,
  tone = "default",
  collapsible = false,
  children,
  className,
}: {
  /** Small region label. Omit for a band that speaks for itself. */
  label?: string
  /** Optional leading icon beside the label. */
  icon?: ElementType
  /** Right-aligned control on the label row. Requires `label`. */
  action?: ReactNode
  /** Quiet inline detail beside the label. Requires `label`. */
  meta?: ReactNode
  tone?: BandTone
  /** When true, content collapses behind the header. */
  collapsible?: boolean
  children: ReactNode
  className?: string
}) {
  const [open, setOpen] = useState(true)
  const Icon = icon
  return (
    <div className={cn("p-5", toneSurface[tone], className)}>
      {label ? (
        <div className={collapsible ? "" : "mb-3"}>
          <button
            type="button"
            onClick={collapsible ? () => setOpen(!open) : undefined}
            className={cn("flex w-full items-center justify-between gap-3", collapsible && "cursor-pointer")}
          >
            <div className="flex min-w-0 items-center gap-2.5">
              {Icon ? <Icon className="size-4 shrink-0 text-neutral-500" /> : null}
              <p className={cn("shrink-0 text-[14px] font-medium text-neutral-800", toneLabel[tone])}>{label}</p>
              {meta ? <span className="min-w-0 truncate text-[12px] font-normal text-neutral-400">{meta}</span> : null}
            </div>
            <div className="flex items-center gap-2">
              {action}
              {collapsible ? (
                open ? <ChevronUpIcon className="size-4 text-neutral-400" /> : <ChevronDownIcon className="size-4 text-neutral-400" />
              ) : null}
            </div>
          </button>
        </div>
      ) : null}
      {open ? <div className={collapsible ? "mt-3" : ""}>{children}</div> : null}
    </div>
  )
}

/**
 * A titled section that collapses vertically from its own header.
 *
 * Borderless on purpose: it wraps content that already draws its own surface
 * (the dispatch controls, the update form), giving it a fold-away header in the
 * same vertical flow — rather than opening that content as a separate sidebar
 * the official has to manage. This is what makes every section on the screen
 * behave the same way: a header you can collapse in place.
 */
export function CollapsibleGroup({
  label,
  action,
  defaultOpen = true,
  children,
  className,
}: {
  label: string
  /** Right-aligned control on the header row (does not toggle the section). */
  action?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
  className?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <ChevronDownIcon
            aria-hidden
            className={cn("size-4 shrink-0 text-subtle-foreground transition-transform", !open && "-rotate-90")}
          />
          <span className="text-row font-semibold text-foreground">{label}</span>
        </button>
        {action}
      </div>
      {open ? children : null}
    </section>
  )
}

/**
 * A label/value pair. The replacement for the badge habit: anything that is not
 * a status and not an exception is a fact with a name, not a pill.
 */
export function Fact({
  label,
  value,
  hint,
  icon: Icon,
  className,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  /** Optional leading icon beside the label. */
  icon?: ElementType
  className?: string
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="flex items-center gap-1.5 text-meta text-subtle-foreground">
        {Icon ? <Icon className="size-3.5 shrink-0" aria-hidden /> : null}
        {label}
      </p>
      <div className="mt-1 text-row font-semibold text-foreground">{value}</div>
      {hint ? <p className="mt-1 text-meta leading-relaxed text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

/** Facts laid out in a row that wraps — the replacement for tile grids. */
export function FactRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap gap-x-6 gap-y-3", className)}>{children}</div>
}
