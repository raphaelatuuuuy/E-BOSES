import { Link } from "react-router-dom"
import { ArrowUpRightIcon, InboxIcon, UserCheckIcon } from "lucide-react"

import { Skeleton } from "@workspace/ui/components/skeleton"
import { plainTimeAgo } from "@/features/dashboard/lib/plain-language"
import { statusGroupOf, statusLabelOf } from "@/features/dashboard/lib/status-vocabulary"
import { NO_UNIT } from "@/features/dashboard/lib/units"
import type { OfficialAnalytics } from "@/features/dashboard/api"

/**
 * The five concerns that have waited longest and are still nobody's finished
 * work.
 *
 * Oldest first, because "needs you now" only means something if the ordering is
 * the one an official would have chosen by hand. Rows are hairlines inside this
 * card, not a nested `HairlineList` — that primitive draws its own border, and
 * a bordered list inside a bordered card is the card-inside-card the design
 * system calls a bug.
 */
export function AttentionCard({
  analytics,
  loading,
}: {
  analytics: OfficialAnalytics | null
  loading: boolean
}) {
  const rows = analytics?.attention ?? []

  return (
    <section
      className="flex min-w-0 flex-col rounded-bento border border-card-line bg-card p-6 md:p-8"
      style={{
        backgroundImage:
          "radial-gradient(140% 130% at 100% 0%, var(--color-brand-orange-soft), var(--color-card) 55%)",
      }}
    >
      <header className="mb-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <h2 className="text-section text-brand-navy">Needs you now</h2>
        <p className="shrink-0 text-meta text-subtle-foreground">Longest waiting</p>
      </header>

      {loading ? (
        <div className="flex flex-col gap-4">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-10 rounded-control bg-card-raised" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="py-14 text-center text-read text-subtle-foreground">
          Nothing is waiting on the barangay right now.
        </p>
      ) : (
        <ul className="min-w-0 flex-1 divide-y divide-card-line">
          {rows.map((row) => {
            const active = statusGroupOf(row.status) === "active"
            const RowIcon = active ? UserCheckIcon : InboxIcon
            return (
              <li key={row.id} className="min-w-0">
                <Link
                  to={`/dashboard/reports/${row.id}`}
                  className="-mx-3 flex min-w-0 items-center gap-4 rounded-control px-3 py-5 transition-colors hover:bg-card-raised"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-row text-brand-navy">{row.title}</span>
                    <span className="mt-1 block truncate text-meta text-subtle-foreground">
                      {row.unit || NO_UNIT}
                      <span className="text-faint-foreground"> · </span>
                      {statusLabelOf(row.status)}
                    </span>
                  </span>
                  <span className="shrink-0 text-meta text-subtle-foreground tabular-nums">
                    {plainTimeAgo(row.created_at)}
                  </span>
                  <RowIcon
                    className="size-4 shrink-0 text-faint-foreground"
                    aria-label={active ? "In progress" : "Needs attention"}
                  />
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      <Link
        to="/dashboard/reports"
        className="mt-6 flex h-12 w-full items-center justify-center gap-1.5 rounded-control border border-card-line text-meta font-medium text-muted-foreground transition-colors hover:border-brand-navy/25 hover:bg-card-raised hover:text-brand-navy"
      >
        View all concerns
        <ArrowUpRightIcon className="size-3.5 shrink-0" aria-hidden />
      </Link>
    </section>
  )
}
