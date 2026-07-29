import { type ReactNode } from "react"
import { Link } from "react-router-dom"
import { ArrowLeftIcon, type LucideIcon } from "lucide-react"

/**
 * Shared chrome for every configuration screen.
 *
 * The config screens were reading as a stack of grey boxes because each one
 * re-invented its own header. This gives them the same editorial treatment the
 * rest of the official side uses: one ink hero carrying the page's headline
 * number, then content on the canvas beneath it.
 *
 * The hero is the only dark surface on the page — that is what makes it read as
 * deliberate rather than decorative.
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
    <div className="space-y-5 p-4 md:p-6">
      <section className="relative overflow-hidden rounded-3xl bg-ink p-5 text-white md:p-6">
        {/* A single soft bloom rather than a gradient wash: it gives the slab
            depth without putting text on a busy background. */}
        <span
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-24 size-64 rounded-full bg-brand-orange/20 blur-3xl"
        />

        <div className="relative">
          <Link
            to="/dashboard/configuration"
            className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-white/55 transition hover:text-white"
          >
            <ArrowLeftIcon className="size-3.5" aria-hidden />
            Configuration
          </Link>

          <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-4">
              <span className="hidden shrink-0 rounded-2xl bg-white/10 p-3 sm:block">
                <Icon className="size-6" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/55">
                  {eyebrow}
                </p>
                <h1 className="mt-1 font-heading text-2xl font-bold leading-tight md:text-3xl">
                  {title}
                </h1>
                <p className="mt-2 max-w-2xl text-sm font-medium leading-relaxed text-white/70">
                  {description}
                </p>
              </div>
            </div>

            {action ? <div className="shrink-0">{action}</div> : null}
          </div>

          {stats && stats.length > 0 ? (
            <dl className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {stats.map((stat) => (
                <div
                  key={stat.label}
                  className={`rounded-2xl px-4 py-3 ${
                    stat.alarm ? "bg-severity-critical/20" : "bg-ink-raised"
                  }`}
                >
                  <dd className="font-heading text-2xl font-bold tabular-nums">{stat.value}</dd>
                  <dt
                    className={`mt-0.5 text-[10px] font-bold uppercase tracking-wide ${
                      stat.alarm ? "text-severity-critical-surface" : "text-white/55"
                    }`}
                  >
                    {stat.label}
                  </dt>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </section>

      {children}
    </div>
  )
}

/** Primary action styled for the ink hero. */
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
      className="inline-flex items-center gap-2 rounded-xl bg-brand-orange px-4 py-2.5 text-sm font-semibold text-brand-orange-ink transition hover:bg-brand-orange-strong"
    >
      {Icon ? <Icon className="size-4" aria-hidden /> : null}
      {children}
    </button>
  )
}

/** A content block on the canvas, with an optional lead-in line. */
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
    <section className="space-y-3">
      {title ? (
        <div>
          <h2 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            {title}
          </h2>
          {hint ? (
            <p className="mt-0.5 text-xs font-medium text-muted-foreground">{hint}</p>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}

/** Inline warning used when configuration is incomplete in a way that breaks
 *  routing. Loud on purpose — these are silent failures otherwise. */
export function ConfigAlarm({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-status-open bg-status-open-surface p-3.5">
      <span className="mt-0.5 size-2 shrink-0 rounded-full bg-status-open" aria-hidden />
      <p className="text-sm font-semibold leading-relaxed text-status-open-ink">{children}</p>
    </div>
  )
}
