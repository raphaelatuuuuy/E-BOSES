import { ClockIcon, CheckCircle2Icon, XCircleIcon, InboxIcon } from "lucide-react"

import { ArcGauge } from "@/features/dashboard/components/charts"
import { Fact } from "@/features/dashboard/components/workspace/band"
import type { OfficialAnalytics } from "@/features/dashboard/api"

/**
 * How much of the finished work actually ended with a fix, and how long it took.
 *
 * The rate is resolved over settled, not closed over filed. A throughput ratio
 * can exceed 100% in a week where the barangay clears a backlog, and a gauge
 * that reads 140% is worse than no gauge. The two figures below it are facts
 * with names rather than pills — the median sits next to the rate because a
 * high rate reached slowly is a different barangay from a high rate reached in
 * a day.
 */
export function ResolutionCard({
  analytics,
  loading,
}: {
  analytics: OfficialAnalytics | null
  loading: boolean
}) {
  const resolution = analytics?.resolution
  const days = resolution?.median_days ?? null
  const settled = resolution?.settled ?? 0
  const resolved = resolution?.resolved ?? 0
  const notResolved = settled - resolved
  const stillOpen = (analytics?.totals.open ?? 0) + (analytics?.totals.working ?? 0)

  return (
    <section
      className="flex min-w-0 flex-col rounded-bento border border-card-line bg-card p-6 md:p-8"
      style={{
        backgroundImage:
          "radial-gradient(140% 130% at 100% 0%, var(--color-brand-orange-soft), var(--color-card) 55%)",
      }}
    >
      <header className="mb-8 flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <h2 className="text-section text-brand-navy">Resolution</h2>
        <p className="shrink-0 text-meta text-subtle-foreground">
          Last {analytics?.window_days ?? 30} days
        </p>
      </header>

      {loading ? (
        <div className="h-[190px] animate-pulse rounded-bento bg-card-raised" />
      ) : (
        <div className="flex flex-1 flex-col justify-center">
          <div className="flex justify-center">
            <ArcGauge
              value={(resolution?.rate_percent ?? 0) / 100}
              centerLabel="ended with a fix"
              gradient={["var(--color-brand-orange)", "var(--color-brand-navy)"]}
              title={`${resolution?.rate_percent ?? 0} percent of finished concerns ended with a fix.`}
            />
          </div>

          <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-6">
            <Fact
              icon={ClockIcon}
              label="Typical time to fix"
              value={days === null ? "Not enough data yet" : `${days} ${days === 1 ? "day" : "days"}`}
            />
            <Fact icon={CheckCircle2Icon} label="Ended with a fix" value={`${resolved} of ${settled}`} />
            <Fact
              icon={XCircleIcon}
              label="Not resolved"
              value={settled > 0 ? `${notResolved} of ${settled}` : "None settled yet"}
            />
            <Fact icon={InboxIcon} label="Still open right now" value={String(stillOpen)} />
          </div>
        </div>
      )}
    </section>
  )
}
