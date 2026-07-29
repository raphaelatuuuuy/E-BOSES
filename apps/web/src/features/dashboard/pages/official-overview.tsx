import { useEffect, useMemo, useState } from "react"

import { cn } from "@workspace/ui/lib/utils"
import {
  getOfficialDashboardSummary,
  listManagedConcerns,
  type Concern,
  type OfficialRoleSummary,
} from "@/features/dashboard/api"
import { ActionQueue } from "@/features/dashboard/components/overview/action-queue"
import { CategoryTable } from "@/features/dashboard/components/overview/category-table"
import { ConcernTrendCard } from "@/features/dashboard/components/overview/insights"
import { KpiRow } from "@/features/dashboard/components/overview/kpi-row"
import { MiniAlertsMap } from "@/features/dashboard/components/overview/mini-alerts-map"
import { LatestConcernsCard, OutcomesCard } from "@/features/dashboard/components/overview/outcomes"
import { UnitLoadCard } from "@/features/dashboard/components/overview/unit-load"
import { dailyCounts } from "@/features/dashboard/lib/overview-series"
import { usePageTitle } from "@/hooks/use-page-title"

/**
 * The one loud element on the page: the barangay's state, right now.
 *
 * An emergency console should answer "is anything happening" before it answers
 * anything else, so the status line sits above the page title rather than being
 * buried in a card. It is the only place on the page that changes colour, and
 * the only thing that moves. When nothing is wrong it stays quiet and green;
 * the alarm state earns its weight because it is rare.
 */
function StatusMasthead({
  live,
  responders,
  loading,
  now,
}: {
  live: number
  responders: number
  loading: boolean
  now: Date
}) {
  const alarm = live > 0

  return (
    <header className="mb-5">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <p
            className={cn(
              "flex items-center gap-2 text-micro uppercase",
              alarm ? "text-severity-critical" : "text-status-closed",
            )}
          >
            <span
              className={cn(
                "relative flex size-2 shrink-0 rounded-pill",
                alarm ? "bg-severity-critical" : "bg-status-closed",
              )}
            >
              {alarm ? <span aria-hidden className="ops-pulse absolute inset-0 rounded-pill" /> : null}
            </span>
            {loading
              ? "Checking the barangay"
              : alarm
                ? `${live} ${live === 1 ? "emergency" : "emergencies"} active right now`
                : "All clear"}
          </p>

          <h1 className="mt-2 text-display text-foreground">Operations Overview</h1>
          <p className="mt-1.5 text-body text-muted-foreground">
            Barangay Marikina Heights
            <span className="text-faint-foreground"> · </span>
            <span>
              {responders} {responders === 1 ? "responder" : "responders"} on duty
            </span>
          </p>
        </div>

        <p className="shrink-0 text-label text-subtle-foreground">
          {new Intl.DateTimeFormat("en", {
            weekday: "long",
            month: "long",
            day: "numeric",
          }).format(now)}
        </p>
      </div>

      <div className="mt-4 h-px w-full bg-card-line" />
    </header>
  )
}

/**
 * Official landing page ("Administrative Dashboard" in the research spec).
 *
 * Laid out on the reference board's rhythm: a strip of three short KPI cards,
 * then a wide chart flanked by two narrow cards, then the working queue beside
 * the map. Card headers carry a title and one control, never a paragraph.
 *
 * Data + realtime refresh live here; presentation is delegated to
 * components/overview/*.
 */
export default function OfficialOverviewPage() {
  usePageTitle("Overview")
  const [summary, setSummary] = useState<OfficialRoleSummary | null>(null)
  const [concerns, setConcerns] = useState<Concern[]>([])
  const [loading, setLoading] = useState(true)

  const now = new Date()

  // Initial load + realtime refresh in one effect (mirrors the load-effect
  // pattern already used on pages/emergencies.tsx): a cheap refetch whenever
  // the notification socket (or its polling fallback) signals something an
  // official cares about changed.
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [nextSummary, nextConcerns] = await Promise.all([
          getOfficialDashboardSummary(),
          listManagedConcerns(),
        ])
        if (cancelled) return
        setSummary(nextSummary)
        setConcerns(nextConcerns)
      } catch {
        // Keep whatever we last had — the page still renders with stale data.
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    function refresh() {
      void load()
    }
    void load()
    window.addEventListener("eboses:notification-created", refresh)
    window.addEventListener("eboses:concern-updated", refresh)
    window.addEventListener("eboses:emergency-updated", refresh)
    return () => {
      cancelled = true
      window.removeEventListener("eboses:notification-created", refresh)
      window.removeEventListener("eboses:concern-updated", refresh)
      window.removeEventListener("eboses:emergency-updated", refresh)
    }
  }, [])

  const weekDelta = useMemo(() => {
    const fortnight = dailyCounts(concerns, 14)
    const thisWeek = fortnight.slice(7).reduce((sum, point) => sum + point.value, 0)
    const lastWeek = fortnight.slice(0, 7).reduce((sum, point) => sum + point.value, 0)
    return thisWeek - lastWeek
  }, [concerns])

  return (
    <div className="px-4 pb-12 pt-5 md:px-6 md:pt-6 lg:px-8">
      <StatusMasthead
        live={summary?.active_emergencies ?? 0}
        responders={summary?.responders_on_duty ?? 0}
        loading={loading}
        now={now}
      />

      <KpiRow summary={summary} concerns={concerns} loading={loading} weekDelta={weekDelta} />

      {/* Wide chart, then two narrow cards. */}
      <div className="mt-3 grid gap-3 lg:grid-cols-2 xl:grid-cols-[1.35fr_0.95fr_1fr]">
        <div className="min-w-0 lg:col-span-2 xl:col-span-1">
          <ConcernTrendCard concerns={concerns} loading={loading} />
        </div>
        <OutcomesCard concerns={concerns} loading={loading} />
        <LatestConcernsCard concerns={concerns} loading={loading} />
      </div>

      {/* The map gets the larger half now that it carries real pins. */}
      <div className="mt-3 grid gap-3 xl:grid-cols-[1fr_1.25fr]">
        <ActionQueue concerns={concerns} loading={loading} />
        <MiniAlertsMap />
      </div>

      {/* Unit workload grid + the category breakdown. */}
      <div className="mt-3 grid gap-3 xl:grid-cols-[1fr_1.4fr]">
        <UnitLoadCard concerns={concerns} loading={loading} />
        <CategoryTable concerns={concerns} loading={loading} />
      </div>
    </div>
  )
}
