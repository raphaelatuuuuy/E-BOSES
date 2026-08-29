let lastServiceWorkerError = ""

export function pwaSupported() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && window.isSecureContext
}

/** Unregister any stale service worker — call once on app boot to clean up
 *  registrations left behind by a previous broken cert or failed deploy. */
export async function unregisterStaleServiceWorker() {
  if (!("serviceWorker" in navigator)) return
  try {
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.all(
      registrations
        .filter((registration) => {
          const scriptUrl = registration.active?.scriptURL || registration.waiting?.scriptURL || registration.installing?.scriptURL || ""
          return scriptUrl === new URL("/eboses-sw.js", window.location.origin).href
        })
        .map((registration) => registration.unregister()),
    )
  } catch {
    // best-effort
  }
}

export async function registerAppServiceWorker() {
  lastServiceWorkerError = ""
  if (!pwaSupported()) {
    lastServiceWorkerError = typeof window !== "undefined" && !window.isSecureContext
      ? "This page is not a secure context. Mobile service workers require trusted HTTPS."
      : "This browser does not support service workers."
    return null
  }
  try {
    const registration = await navigator.serviceWorker.register("/eboses-sw.js", { scope: "/" })
    // Ask the browser to check for a changed worker immediately. This prevents
    // an old cached worker from keeping the previous notification bundle alive
    // after a local rebuild or deployment.
    await registration.update().catch(() => undefined)
    return registration
  } catch (error) {
    lastServiceWorkerError = error instanceof Error ? error.message : String(error)
    return null
  }
}

/** Wait for the worker to be active — pushManager.subscribe() hangs otherwise. */
export async function ensureServiceWorkerActive() {
  if (!("serviceWorker" in navigator)) return null
  try {
    return await navigator.serviceWorker.ready
  } catch {
    return null
  }
}

export function getLastServiceWorkerError() {
  return lastServiceWorkerError
}

export function appInstalledStandalone() {
  if (typeof window === "undefined") return false
  return window.matchMedia?.("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
}
