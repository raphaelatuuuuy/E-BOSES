import { useEffect, useState } from "react"

import { getOfficialAnalytics, type OfficialAnalytics } from "@/features/dashboard/api"
import { AttentionCard } from "@/features/dashboard/components/overview/attention-card"
import { AwaitingActionCard } from "@/features/dashboard/components/overview/awaiting-action-card"
import {
  EmergencyAlertBanner,
  OverviewMasthead,
} from "@/features/dashboard/components/overview/overview-masthead"
import { ResolutionCard } from "@/features/dashboard/components/overview/resolution-card"
import { TrendCard } from "@/features/dashboard/components/overview/trend-card"
import { usePageTitle } from "@/hooks/use-page-title"

/**
 * Four regions, one request.
 *
 * The page this replaces fetched a page of managed concerns and counted them in
 * the browser. DRF pages that endpoint at twenty, so every figure on the screen
 * described the twenty most recent concerns while claiming to describe the
 * barangay. `/dashboard/official/analytics/` aggregates in the database, which
 * is the only place those numbers can be true — and it means the page no longer
 * pulls media, comments and AI assessments across the wire to count rows.
 *
 * The live map and the category table left the screen. Seven regions at equal
 * weight is not an overview; the map has its own page, and the category split
 * is five numbers, which the trend card states as facts.
 */
export default function OfficialOverviewPage() {
  usePageTitle("Overview")
  const [analytics, setAnalytics] = useState<OfficialAnalytics | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const next = await getOfficialAnalytics()
        if (!cancelled) setAnalytics(next)
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

  const live = analytics?.emergencies.active ?? 0

  return (
    <div className="px-5 pb-16 pt-8 md:px-8 lg:px-10">
      {live > 0 ? <EmergencyAlertBanner count={live} /> : null}
      <OverviewMasthead analytics={analytics} loading={loading} />

      <div className="mt-8 grid gap-4 xl:grid-cols-[0.85fr_1.4fr]">
        <AwaitingActionCard analytics={analytics} loading={loading} />
        <TrendCard analytics={analytics} loading={loading} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[0.85fr_1.4fr]">
        <ResolutionCard analytics={analytics} loading={loading} />
        <AttentionCard analytics={analytics} loading={loading} />
      </div>
    </div>
  )
}
