import { useEffect, useMemo, useState } from "react"

import { cn } from "@workspace/ui/lib/utils"
import {
  getOfficialDashboardSummary,
  listManagedConcerns,
  type Concern,
  type OfficialRoleSummary,
} from "@/features/dashboard/api"
import { CategoryTable } from "@/features/dashboard/components/overview/category-table"
import { ConcernTrendCard } from "@/features/dashboard/components/overview/insights"
import { KpiRow } from "@/features/dashboard/components/overview/kpi-row"
import { MiniAlertsMap } from "@/features/dashboard/components/overview/mini-alerts-map"
import { LatestConcernsCard, OutcomesCard } from "@/features/dashboard/components/overview/outcomes"
import { dailyCounts } from "@/features/dashboard/lib/overview-series"
import { isMergedChild } from "@/features/dashboard/lib/status-vocabulary"
import { usePageTitle } from "@/hooks/use-page-title"

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
              "flex items-center gap-2 text-micro",
              alarm ? "text-severity-critical" : "text-status-closed",
            )}
          >
            <span
              className={cn(
                "relative flex size-2 shrink-0 rounded-pill",
                alarm ? "bg-sos" : "bg-status-closed",
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

export default function OfficialOverviewPage() {
  usePageTitle("Overview")
  const [summary, setSummary] = useState<OfficialRoleSummary | null>(null)
  const [concerns, setConcerns] = useState<Concern[]>([])
  const [loading, setLoading] = useState(true)

  const now = new Date()

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
        void 0
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

  const incidents = useMemo(
    () => concerns.filter((concern) => !isMergedChild(concern) && !concern.archived_at),
    [concerns],
  )

  const weekDelta = useMemo(() => {
    const fortnight = dailyCounts(incidents, 14)
    const thisWeek = fortnight.slice(7).reduce((sum, point) => sum + point.value, 0)
    const lastWeek = fortnight.slice(0, 7).reduce((sum, point) => sum + point.value, 0)
    return thisWeek - lastWeek
  }, [incidents])

  return (
    <div className="px-4 pb-12 pt-5 md:px-6 md:pt-6 lg:px-8">
      <StatusMasthead
        live={summary?.active_emergencies ?? 0}
        responders={summary?.responders_on_duty ?? 0}
        loading={loading}
        now={now}
      />

      <KpiRow summary={summary} concerns={incidents} loading={loading} weekDelta={weekDelta} />

            <div className="mt-3 grid gap-3 lg:grid-cols-2 xl:grid-cols-[1.35fr_0.95fr_1fr]">
        <div className="min-w-0 lg:col-span-2 xl:col-span-1">
          <ConcernTrendCard concerns={incidents} loading={loading} />
        </div>
        <OutcomesCard concerns={incidents} loading={loading} />
        <LatestConcernsCard concerns={incidents} loading={loading} />
      </div>

            <div className="mt-3">
        <MiniAlertsMap />
      </div>

            <div className="mt-3">
        <CategoryTable concerns={incidents} loading={loading} />
      </div>
    </div>
  )
}
