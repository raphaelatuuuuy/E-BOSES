export function deferUntilInteractive(callback: () => void, delayMs: number) {
  if (typeof window === "undefined") return 0
  const run = () => window.setTimeout(callback, delayMs)
  if (typeof window.requestIdleCallback === "function") {
    return window.requestIdleCallback(run, { timeout: Math.max(delayMs, 1500) })
  }
  return run()
}

export function cancelDeferredStartup(handle: number) {
  if (typeof window === "undefined") return
  if (typeof window.cancelIdleCallback === "function") {
    try {
      window.cancelIdleCallback(handle)
      return
    } catch {
      // fall through to clearTimeout
    }
  }
  window.clearTimeout(handle)
}
