import { useEffect, useState } from "react"

import { getOfficialDashboardSummary } from "@/features/dashboard/api"

/**
 * Pending-work counts for the staff rail, keyed by nav item key.
 *
 * Every reference dashboard we modelled the rail on carries counts directly on
 * the nav item, so an official can see where the work is without opening each
 * screen. Refreshes on the same window events the overview listens to, so it
 * costs one request per sign-in plus one per realtime change — no polling.
 */
export function useOfficialBadges(enabled: boolean): Record<string, number> {
  const [badges, setBadges] = useState<Record<string, number>>({})

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    async function load() {
      try {
        const summary = await getOfficialDashboardSummary()
        if (cancelled) return
        setBadges({
          concerns: summary.open_reports,
          emergencies: summary.active_emergencies,
          community: summary.pending_content_flags,
          configuration:
            summary.pending_resident_verifications + summary.pending_account_requests,
        })
      } catch {
        // Badges are decoration — a failure must never break navigation.
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
  }, [enabled])

  return badges
}
