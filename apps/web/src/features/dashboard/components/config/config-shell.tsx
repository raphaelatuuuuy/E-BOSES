import { type ReactNode } from "react"
import { Link } from "react-router-dom"
import { ChevronRightIcon, type LucideIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

/**
 * Shared chrome for every configuration screen.
 *
 * This was a dark "ink hero" slab carrying a blurred orange bloom, an eyebrow,
 * an icon well and a row of four stat tiles — a lot of furniture above content
 * the official actually came for. It is now a breadcrumb, a large title and a
 * plain line of counts, on the same white ground as the rest of the page.
 *
 * Emphasis is still available: a count that means someone must act is the only
 * coloured thing on the screen.
 */

export interface ConfigStat {
  label: string
  value: string | number
  /** Renders in the alarm tone. Use for "3 categories have no unit", never for
   *  a merely large number. */
  alarm?: boolean
}

/** Where you are, not merely how to leave. Matches the Help Center trail. */
export function ConfigBreadcrumb({
  trail,
  className,
}: {
  trail: Array<{ label: string; to?: string; onClick?: () => void }>
  className?: string
}) {
  return (
    <nav
      aria-label="Breadcrumb"
      className={cn("flex flex-wrap items-center gap-2 text-meta", className)}
    >
      {trail.map((crumb, index) => (
        <span key={crumb.label} className="flex items-center gap-2">
          {index > 0 ? (
            <ChevronRightIcon
              className="size-3.5 shrink-0 text-neutral-300"
              strokeWidth={2.4}
              aria-hidden
            />
          ) : null}
          {crumb.to ? (
            <Link
              to={crumb.to}
              className="text-neutral-500 no-underline transition-colors hover:text-accent"
            >
              {crumb.label}
            </Link>
          ) : crumb.onClick ? (
            <button
              type="button"
              onClick={crumb.onClick}
              className="text-neutral-500 transition-colors hover:text-accent"
            >
              {crumb.label}
            </button>
          ) : (
            <span
              className={
                index === trail.length - 1
                  ? "text-brand-navy"
                  : "text-neutral-400"
              }
            >
              {crumb.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  )
}

export function ConfigShell({
  icon: Icon,
  eyebrow,
  title,
  description,
  stats,
  action,
  children,
}: {
  icon: LucideIcon
  eyebrow: string
  title: string
  description: string
  stats?: ConfigStat[]
  action?: ReactNode
  children: ReactNode
}) {
  return (
    // White ground, like the Help Center. The official shell paints `bg-canvas`
    // (#f6f7f9) behind every page, which is so close to white that a
    // configuration screen read as neither one thing nor the other.
    <div className="min-h-full bg-white">
      {/* pb-40 on a phone clears the floating bottom nav, which was sitting on
          top of the last row and the pager. */}
      <div className="mx-auto w-full max-w-[1100px] px-6 pt-10 pb-40 sm:px-10 sm:pb-28">
        <ConfigBreadcrumb
          trail={[
            { label: "Configuration", to: "/dashboard/configuration" },
            { label: eyebrow },
            { label: title },
          ]}
        />

        {/* Stacked on a phone. This was one wrapping row, so a `shrink-0`
            action kept its full width while the title was squeezed into about
            140px and broke across three lines. */}
        <header className="mt-8 flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
          <div className="flex min-w-0 items-start gap-6 sm:flex-1">
            <span className="hidden size-16 shrink-0 items-center justify-center rounded-2xl bg-brand-navy text-white sm:flex">
              <Icon className="size-7" strokeWidth={1.7} aria-hidden />
            </span>
            <div className="min-w-0">
              <h1 className="text-page-title text-balance text-brand-navy">{title}</h1>
              <p className="mt-3 max-w-2xl text-read leading-relaxed text-neutral-500">
                {description}
              </p>
            </div>
          </div>

          {action ? <div className="shrink-0 [&>*]:w-full sm:[&>*]:w-auto">{action}</div> : null}
        </header>

        {stats && stats.length > 0 ? (
          <dl className="mt-10 flex flex-wrap gap-x-12 gap-y-6">
            {stats.map((stat) => (
              <div key={stat.label} className="min-w-0">
                <dd
                  className={cn(
                    "text-section tabular-nums",
                    stat.alarm ? "text-sos" : "text-brand-navy"
                  )}
                >
                  {stat.value}
                </dd>
                <dt className="mt-1 text-meta text-neutral-500">
                  {stat.label}
                </dt>
              </div>
            ))}
          </dl>
        ) : null}

        <div className="mt-12 space-y-12">{children}</div>
      </div>
    </div>
  )
}

/** Primary action for the page header. */
export function ConfigHeroAction({
  onClick,
  icon: Icon,
  children,
}: {
  onClick: () => void
  icon?: LucideIcon
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-full bg-brand-navy px-5 py-2.5 text-read font-semibold text-white transition-colors hover:bg-accent"
    >
      {Icon ? <Icon className="size-5" strokeWidth={1.9} aria-hidden /> : null}
      {children}
    </button>
  )
}

/** A content block, with an optional lead-in line. */
export function ConfigPanel({
  title,
  hint,
  children,
}: {
  title?: string
  hint?: string
  children: ReactNode
}) {
  return (
    <section className="space-y-6">
      {title ? (
        <div>
          <h2 className="text-section text-brand-navy">{title}</h2>
          {hint ? (
            <p className="mt-2 max-w-2xl text-meta text-neutral-500">{hint}</p>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}

/** Inline warning used when configuration is incomplete in a way that breaks
 *  routing. These are silent failures otherwise, so this is the one place on a
 *  configuration screen where colour is allowed to shout. */
export function ConfigAlarm({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-neutral-200 px-5 py-4">
      <span className="mt-2 size-2 shrink-0 rounded-full bg-sos" aria-hidden />
      <p className="text-read leading-relaxed text-brand-navy">{children}</p>
    </div>
  )
}
