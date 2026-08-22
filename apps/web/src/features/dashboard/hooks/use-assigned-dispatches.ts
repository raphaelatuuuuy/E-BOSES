import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  listAssignedEmergencies,
  type EmergencyAlert,
} from "@/features/dashboard/emergency-api"
import { ACTIVE_EMERGENCY_STATUSES } from "@/features/dashboard/components/record/status"
import { useDebouncedCallback } from "@/hooks/use-debounced-callback"

export const ACTIVE_DISPATCH_STATUSES = ACTIVE_EMERGENCY_STATUSES

const POLL_MS = 30_000
const EVENT_DEBOUNCE_MS = 3_000
const MIN_LOAD_GAP_MS = 15_000

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
  const lastLoadAt = useRef(0)

  const load = useCallback(async ({ force = false } = {}) => {
    if (!force && Date.now() - lastLoadAt.current < MIN_LOAD_GAP_MS) return
    lastLoadAt.current = Date.now()
    try {
      const next = await listAssignedEmergencies()
      // No toast on arrival — a polling app that interrupts with a toast keeps
      // nagging while the push, the notification inbox and the red dispatch
      // badge already carry the alert once each.
      setAlerts(next)
      setLoadError("")
      setSyncedAt(Date.now())
    } catch {
      setLoadError("Dispatch could not refresh. Showing the last known assignment.")
    } finally {
      setLoading(false)
    }
  }, [])

  const eventRefresh = useDebouncedCallback(() => void load(), EVENT_DEBOUNCE_MS)

  useEffect(() => {
    if (!enabled) return
    const initial = window.setTimeout(() => void load({ force: true }), 0)
    const timer = window.setInterval(() => void load({ force: true }), POLL_MS)
    window.addEventListener("eboses:notification-created", eventRefresh)
    window.addEventListener("eboses:emergency-updated", eventRefresh)
    window.addEventListener("online", eventRefresh)
    window.addEventListener("focus", eventRefresh)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(timer)
      window.removeEventListener("eboses:notification-created", eventRefresh)
      window.removeEventListener("eboses:emergency-updated", eventRefresh)
      window.removeEventListener("online", eventRefresh)
      window.removeEventListener("focus", eventRefresh)
    }
  }, [enabled, load, eventRefresh])

  const activeAlerts = useMemo(
    () => alerts.filter((alert) => ACTIVE_DISPATCH_STATUSES.has(alert.status)),
    [alerts],
  )

  return { activeAlerts, loading, loadError, syncedAt, refresh: () => void load() }
}
