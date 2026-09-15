import { useEffect, useState } from "react"

import {
  getOfficialDashboardSummary,
  getResponderDashboardSummary,
  type OfficialOverviewReport,
  type OfficialRoleSummary,
} from "@/features/dashboard/api"

/**
 * Pending-work counts for the staff rail, keyed by nav item key.
 *
 * Every reference dashboard we modelled the rail on carries counts directly on
 * the nav item, so an official can see where the work is without opening each
 * screen. Refreshes on the same window events the overview listens to, with a
 * low-frequency fallback for changes made from another browser tab or device.
 */
export interface OfficialBadgeState {
  badges: Record<string, number>
  criticalReport: OfficialOverviewReport | null
  communityCenter: OfficialRoleSummary["community_center"]
}

export function useOfficialBadges(
  enabled: boolean,
  unitId?: number | null,
  role: "official" | "responder" = "official",
): OfficialBadgeState {
  const [badges, setBadges] = useState<Record<string, number>>({})
  const [criticalReport, setCriticalReport] = useState<OfficialOverviewReport | null>(null)
  const [communityCenter, setCommunityCenter] = useState<OfficialRoleSummary["community_center"]>(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    async function load() {
      try {
        if (role === "responder") {
          const summary = await getResponderDashboardSummary()
          if (cancelled) return
          setBadges({ emergencies: summary.assigned_active_emergencies })
          setCriticalReport(summary.critical_report ?? null)
          setCommunityCenter(null)
          return
        }
        const summary = await getOfficialDashboardSummary(unitId)
        if (cancelled) return
        setBadges({
          concerns: summary.open_reports,
          emergencies: summary.active_emergencies,
          community: summary.pending_content_flags,
          configuration:
            summary.pending_resident_verifications + summary.pending_account_requests,
        })
        setCriticalReport(summary.critical_report ?? null)
        setCommunityCenter(summary.community_center ?? null)
      } catch {
        // Badges are decoration — a failure must never break navigation.
      }
    }

    function refresh() {
      void load()
    }

    void load()
    window.addEventListener("eboses:notification-created", refresh)
    window.addEventListener("eboses:report-created", refresh)
    window.addEventListener("eboses:concern-updated", refresh)
    window.addEventListener("eboses:emergency-updated", refresh)
    const interval = window.setInterval(refresh, 30000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
      window.removeEventListener("eboses:notification-created", refresh)
      window.removeEventListener("eboses:report-created", refresh)
      window.removeEventListener("eboses:concern-updated", refresh)
      window.removeEventListener("eboses:emergency-updated", refresh)
    }
  }, [enabled, unitId, role])

  return { badges, criticalReport, communityCenter }
}
