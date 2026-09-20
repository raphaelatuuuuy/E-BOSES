import { useEffect, useSyncExternalStore } from "react"

import { apiRequest } from "@/lib/api"

const trackedCounts = new Map<number, number>()
const presence = new Map<number, boolean>()
const listeners = new Set<() => void>()
let refreshTimer: number | undefined
let refreshInFlight = false

function notify() {
  for (const listener of listeners) listener()
}

async function refresh() {
  if (refreshInFlight || trackedCounts.size === 0) return
  refreshInFlight = true
  try {
    const ids = Array.from(trackedCounts.keys()).join(",")
    const result = await apiRequest<{ statuses?: Record<string, boolean> }>(
      `/notifications/presence/?ids=${encodeURIComponent(ids)}`,
    )
    let changed = false
    for (const id of trackedCounts.keys()) {
      const next = Boolean(result?.statuses?.[String(id)])
      if (presence.get(id) !== next) {
        presence.set(id, next)
        changed = true
      }
    }
    if (changed) notify()
  } catch {
    // Keep the last known value on a transient network failure.
  } finally {
    refreshInFlight = false
  }
}

function startPolling() {
  if (refreshTimer !== undefined || typeof window === "undefined") return
  void refresh()
  refreshTimer = window.setInterval(() => void refresh(), 3000)
}

function stopPolling() {
  if (refreshTimer === undefined || typeof window === "undefined") return
  window.clearInterval(refreshTimer)
  refreshTimer = undefined
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function usePresenceStatus(userId: number | undefined, fallback: boolean) {
  useEffect(() => {
    if (userId == null) return
    trackedCounts.set(userId, (trackedCounts.get(userId) ?? 0) + 1)
    startPolling()
    return () => {
      const nextCount = (trackedCounts.get(userId) ?? 1) - 1
      if (nextCount > 0) trackedCounts.set(userId, nextCount)
      else {
        trackedCounts.delete(userId)
        presence.delete(userId)
      }
      if (trackedCounts.size === 0) stopPolling()
    }
  }, [userId])

  return useSyncExternalStore(
    subscribe,
    () => (userId != null && presence.has(userId) ? presence.get(userId)! : fallback),
    () => fallback,
  )
}
