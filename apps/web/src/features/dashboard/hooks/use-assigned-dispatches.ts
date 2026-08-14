import { useCallback, useEffect, useMemo, useState } from "react"

import {
  listAssignedEmergencies,
  type EmergencyAlert,
} from "@/features/dashboard/emergency-api"
import { ACTIVE_EMERGENCY_STATUSES } from "@/features/dashboard/components/record/status"

export const ACTIVE_DISPATCH_STATUSES = ACTIVE_EMERGENCY_STATUSES

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

  const load = useCallback(async () => {
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
