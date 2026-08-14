import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import { ArrowUpRightIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { FilterChip } from "@/features/dashboard/components/record/filter-chip"

/**
 * Shared surface primitives for the staff (official/responder) dashboard.
 *
 * Every staff page composes these instead of re-typing the card class string,
 * which had drifted into 35 hand-rolled variants across 20 files. Cards sit on
 * `--color-canvas`, so they carry a hairline border and no shadow.
 */

export function Panel({
  children,
  className,
  padded = true,
}: {
  children: ReactNode
  className?: string
  /** Turn off to let content bleed to the edge (maps, tables). */
  padded?: boolean
}) {
  return (
    <section
      className={cn(
        // `min-w-0` matters: panels are grid children, and a grid item's
        // automatic minimum size is its content, so without it a wide row
        // (a long title, a table) stretches the card past its column.
        "min-w-0 rounded-panel border border-card-line bg-card",
        padded && "p-4 md:p-5",
        className,
      )}
    >
      {children}
    </section>
  )
}

export function PanelHeader({
  title,
  subtitle,
  action,
  actionTo,
  className,
  children,
}: {
  title: string
  /** One plain sentence saying what this panel is for. */
  subtitle?: string
  /** Text for the trailing link. */
  action?: string
  actionTo?: string
  className?: string
  /** Custom trailing control, used instead of the action link. */
  children?: ReactNode
}) {
  return (
    <header className={cn("mb-4 flex items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold leading-tight text-brand-navy">{title}</h2>
        {subtitle ? (
          <p className="mt-0.5 text-[12px] font-medium leading-snug text-subtle-foreground">{subtitle}</p>
        ) : null}
      </div>

      {children ??
        (action && actionTo ? (
          <Link
            to={actionTo}
            className="group flex shrink-0 items-center gap-1 rounded-control px-2 py-1 text-[12px] font-bold text-brand-orange-strong transition-colors hover:bg-brand-orange-soft"
          >
            {action}
            <ArrowUpRightIcon className="size-3.5 transition-transform group-hover:translate-x-px group-hover:-translate-y-px" />
          </Link>
        ) : null)}
    </header>
  )
}

/**
 * Static period marker in a card header ("Last 7 days", "This week").
 *
 * Rendered as a chip rather than a control because the range is fixed: an
 * affordance that looks clickable but is not is worse than a plain label.
 */
export function PeriodChip({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 whitespace-nowrap rounded-full border border-card-line px-2.5 py-1 text-[10.5px] font-bold text-subtle-foreground">
      {children}
    </span>
  )
}

/** Dotted series key for a chart header. */
export function SeriesKey({ items }: { items: ReadonlyArray<{ label: string; color: string }> }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2.5">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: item.color }}
          />
          <span className="text-[9.5px] font-semibold tracking-[0.1em] text-subtle-foreground">
            {item.label}
          </span>
        </span>
      ))}
    </div>
  )
}

/** Pill filter row. The selected chip is filled; the rest are hairline. */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<{ value: T; label: string; count?: number }>
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => (
        <FilterChip
          key={option.value}
          label={option.label}
          active={option.value === value}
          count={option.count}
          onClick={() => onChange(option.value)}
        />
      ))}
    </div>
  )
}

/** Full-width outlined link that closes a list card. */
export function PanelFooterLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="mt-3 flex h-9 w-full items-center justify-center rounded-panel border border-card-line text-[12px] font-bold text-muted-foreground transition-colors hover:border-brand-navy/25 hover:bg-card-raised hover:text-brand-navy"
    >
      {children}
    </Link>
  )
}

/** Small section marker. */
export function Eyebrow({
  children,
  tone = "muted",
  className,
}: {
  children: ReactNode
  tone?: "muted" | "alarm"
  className?: string
}) {
  return (
    <p
      className={cn(
        "text-[10px] font-semibold tracking-[0.12em]",
        tone === "alarm" ? "text-sos" : "text-subtle-foreground",
        className,
      )}
    >
      {children}
    </p>
  )
}

/** Empty state that tells staff what the panel WOULD show, in plain words. */
export function PanelEmpty({ children }: { children: ReactNode }) {
  return (
    <p className="py-8 text-center text-[12.5px] font-semibold text-subtle-foreground">{children}</p>
  )
}
