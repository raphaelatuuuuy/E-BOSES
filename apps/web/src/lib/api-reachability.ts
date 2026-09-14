import { useSyncExternalStore } from "react"

import { apiBaseUrl } from "@/lib/api"

// Do not flash an offline warning merely because this is a native launch.
// The health probe will promptly correct this when the API is unavailable.
let reachable = navigator.onLine
let installed = false
let activeProbe: Promise<boolean> | null = null
const listeners = new Set<() => void>()

function publish(next: boolean) {
  if (reachable === next) return
  reachable = next
  for (const listener of listeners) listener()
}

export function probeApiReachability(): Promise<boolean> {
  if (!navigator.onLine) {
    publish(false)
    return Promise.resolve(false)
  }
  activeProbe ??= (async () => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 3500)
    try {
      // Any HTTP response proves that the configured API host is reachable.
      await fetch(`${apiBaseUrl()}/health/`, {
        cache: "no-store",
        credentials: "omit",
        signal: controller.signal,
      })
      publish(true)
      return true
    } catch {
      publish(false)
      return false
    } finally {
      window.clearTimeout(timeout)
      activeProbe = null
    }
  })()
  return activeProbe
}

function install() {
  if (installed) return
  installed = true
  const offline = () => publish(false)
  const check = () => void probeApiReachability()
  window.addEventListener("offline", offline)
  window.addEventListener("online", check)
  window.addEventListener("focus", check)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") check()
  })
  check()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  install()
  return () => listeners.delete(listener)
}

export function useApiReachability() {
  return useSyncExternalStore(subscribe, () => reachable, () => false)
}
