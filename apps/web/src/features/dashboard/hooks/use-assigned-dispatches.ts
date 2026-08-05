import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import {
  listAssignedEmergencies,
  type EmergencyAlert,
} from "@/features/dashboard/emergency-api"

/**
 * Assigned dispatches, polled.
 *
 * Lifted out of the old responder dispatch FAB so the sidebar Dispatch nav
 * group, the mobile bottom bar and the sync indicator can all read one count
 * instead of each owning a poll loop. Exactly one consumer is ever mounted at a
 * time — this hook is shared for the *code*, not to support simultaneous
 * mounts, and mounting two would give two pollers and two arrival toasts just
 * as it did before.
 */

/**
 * A dispatch counts as active until it is settled. The old list stopped at
 * "arrived", which silently dropped every emergency the responder kept working
 * past that point — in progress, backup requested/assigned, transfer and
 * escalation are all still live work, and they are exactly the dispatches the
 * sidebar alarm exists for. Only resolved, closed, cancelled, false alarm and
 * invalid read as done.
 */
export const ACTIVE_DISPATCH_STATUSES = new Set([
  "submitted",
  "routing",
  "routed",
  "awaiting_acknowledgment",
  "acknowledged",
  "en_route",
  "nearby",
  "arrived",
  "resident_safe",
  "backup_requested",
  "backup_assigned",
  "in_progress",
  "transfer_required",
  "escalation_required",
])

const POLL_MS = 30_000

export interface AssignedDispatches {
  activeAlerts: EmergencyAlert[]
  loading: boolean
  loadError: string
  /** Epoch ms of the last poll that came back clean; null until the first. */
  syncedAt: number | null
  refresh: () => void
}

export function useAssignedDispatches(enabled: boolean): AssignedDispatches {
  const [alerts, setAlerts] = useState<EmergencyAlert[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [syncedAt, setSyncedAt] = useState<number | null>(null)
  const hadActiveRef = useRef(false)

  const load = useCallback(async () => {
    try {
      const next = await listAssignedEmergencies()
      const hasActive = next.some((alert) => ACTIVE_DISPATCH_STATUSES.has(alert.status))
      setAlerts(next)
      setLoadError("")
      setSyncedAt(Date.now())
      // A newly arrived dispatch announces itself rather than navigating:
      // yanking someone off the screen they chose is worse than the button
      // going red with a count, which is what happens instead.
      if (hasActive && !hadActiveRef.current) {
        toast.warning("New dispatch assigned to you", {
          description: "Open Dispatch to acknowledge it.",
        })
      }
      hadActiveRef.current = hasActive
    } catch {
      setLoadError("Dispatch could not refresh. Showing the last known assignment.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    const initial = window.setTimeout(() => void load(), 0)
    const timer = window.setInterval(() => void load(), POLL_MS)
    const refresh = () => void load()
    window.addEventListener("eboses:notification-created", refresh)
    window.addEventListener("eboses:emergency-updated", refresh)
    window.addEventListener("online", refresh)
    window.addEventListener("focus", refresh)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(timer)
      window.removeEventListener("eboses:notification-created", refresh)
      window.removeEventListener("eboses:emergency-updated", refresh)
      window.removeEventListener("online", refresh)
      window.removeEventListener("focus", refresh)
    }
  }, [enabled, load])

  const activeAlerts = useMemo(
    () => alerts.filter((alert) => ACTIVE_DISPATCH_STATUSES.has(alert.status)),
    [alerts],
  )

  return { activeAlerts, loading, loadError, syncedAt, refresh: () => void load() }
}
