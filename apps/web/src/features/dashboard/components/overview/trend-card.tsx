import { useMemo } from "react"
import { ArrowDownRightIcon, ArrowUpRightIcon, TrendingUpIcon } from "lucide-react"

import { ColumnChart, type ColumnPoint } from "@/features/dashboard/components/charts"
import type { OfficialAnalytics } from "@/features/dashboard/api"

const WEEKDAY = new Intl.DateTimeFormat("en", { weekday: "short" })
const LONG_DATE = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" })

/**
 * Concerns filed each day, against a hatched track for the period's busiest.
 *
 * The chart carries one series, not two. Sixty capsules across thirty days is
 * unreadable at this bar weight, and the question the second series answered —
 * "are we keeping up" — is a single number, so it is stated as one above the
 * plot rather than drawn twice.
 *
 * The category split is a line of facts for the same reason: it is five
 * numbers, and five numbers do not need a table of their own.
 */
export function TrendCard({
  analytics,
  loading,
}: {
  analytics: OfficialAnalytics | null
  loading: boolean
}) {
  const { points, peak } = useMemo(() => {
    const series = analytics?.series ?? []
    const bars: ColumnPoint[] = series.map((point, index) => {
      const date = new Date(`${point.date}T00:00:00`)
      return {
        // Thirty ticks overlap into mush, so only every fifth day and the last
        // day are labelled.
        label:
          index % 5 === 0 || index === series.length - 1 ? WEEKDAY.format(date) : "",
        caption: LONG_DATE.format(date),
        value: point.filed,
      }
    })

    let busiest = -1
    bars.forEach((bar, index) => {
      if (busiest < 0 || bar.value > bars[busiest].value) busiest = index
    })

    return { points: bars, peak: busiest >= 0 && bars[busiest]?.value > 0 ? busiest : undefined }
  }, [analytics])

  const totals = analytics?.totals
  const net = totals?.net_window ?? 0

  return (
    <section
      className="flex min-w-0 flex-col rounded-bento border border-card-line bg-card p-6 md:p-8"
      style={{
        backgroundImage:
          "radial-gradient(140% 130% at 100% 0%, var(--color-brand-orange-soft), var(--color-card) 55%)",
      }}
    >
      <header className="mb-8 flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <h2 className="flex items-center gap-2 text-section text-brand-navy">
          <TrendingUpIcon className="size-5 shrink-0 text-brand-orange" aria-hidden />
          Filed and closed
        </h2>
        <p className="shrink-0 text-meta text-subtle-foreground">
          Last {analytics?.window_days ?? 30} days
        </p>
      </header>

      {loading ? (
        <div className="h-[240px] animate-pulse rounded-bento bg-card-raised" />
      ) : (
        <>
          <div className="mb-8 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-[40px] font-semibold leading-none tracking-tight text-brand-navy tabular-nums">
              {totals?.filed_window ?? 0}
            </span>
            <span className="text-meta text-subtle-foreground">
              filed · {totals?.closed_window ?? 0} closed ·{" "}
              <span className="inline-flex items-center gap-1 text-brand-navy">
                {net >= 0 ? (
                  <ArrowUpRightIcon className="size-3.5 shrink-0" aria-hidden />
                ) : (
                  <ArrowDownRightIcon className="size-3.5 shrink-0" aria-hidden />
                )}
                net {net > 0 ? "+" : ""}
                {net}
              </span>
            </span>
          </div>

          <ColumnChart
            data={points}
            highlightIndex={peak}
            barGradient={["var(--color-brand-orange)", "var(--color-brand-navy)"]}
            title={`Concerns filed each day over the last ${analytics?.window_days ?? 30} days. ${totals?.filed_window ?? 0} filed and ${totals?.closed_window ?? 0} closed in the period.`}
            emptyLabel="No concerns have been filed in this period"
          />

          {analytics && analytics.by_category.length > 0 ? (
            <p className="mt-8 flex flex-wrap gap-x-2 gap-y-1 text-meta text-subtle-foreground">
              {analytics.by_category.map((entry, index) => (
                <span key={entry.code}>
                  {index > 0 ? <span className="text-faint-foreground">· </span> : null}
                  {entry.label}{" "}
                  <span className="text-brand-navy tabular-nums">{entry.total}</span>
                </span>
              ))}
            </p>
          ) : null}
        </>
      )}
    </section>
  )
}
