import { type ReactNode } from "react"
import { Link } from "react-router-dom"
import { ArrowLeftIcon, type LucideIcon } from "lucide-react"

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
    <div className="mx-auto w-full max-w-[1100px] px-6 pb-28 pt-10 sm:px-10">
      <Link
        to="/dashboard/configuration"
        className="inline-flex items-center gap-2 text-meta text-neutral-500 no-underline transition-colors hover:text-accent"
      >
        <ArrowLeftIcon className="size-4" strokeWidth={2} aria-hidden />
        Configuration
      </Link>

      <header className="mt-8 flex flex-wrap items-start justify-between gap-x-8 gap-y-5">
        <div className="flex min-w-0 flex-1 items-start gap-6">
          <span className="hidden size-16 shrink-0 items-center justify-center rounded-2xl bg-brand-navy text-white sm:flex">
            <Icon className="size-7" strokeWidth={1.7} aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-meta text-neutral-400">{eyebrow}</p>
            <h1 className="mt-1 text-page-title text-brand-navy">{title}</h1>
            <p className="mt-3 max-w-2xl text-read leading-relaxed text-neutral-500">
              {description}
            </p>
          </div>
        </div>

        {action ? <div className="shrink-0">{action}</div> : null}
      </header>

      {stats && stats.length > 0 ? (
        <dl className="mt-10 flex flex-wrap gap-x-12 gap-y-6">
          {stats.map((stat) => (
            <div key={stat.label} className="min-w-0">
              <dd
                className={cn(
                  "text-section tabular-nums",
                  stat.alarm ? "text-sos" : "text-brand-navy",
                )}
              >
                {stat.value}
              </dd>
              <dt className="mt-1 text-meta text-neutral-500">{stat.label}</dt>
            </div>
          ))}
        </dl>
      ) : null}

      <div className="mt-12 space-y-12">{children}</div>
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
          {hint ? <p className="mt-2 max-w-2xl text-meta text-neutral-500">{hint}</p> : null}
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
