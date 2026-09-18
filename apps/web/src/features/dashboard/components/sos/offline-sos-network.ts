/**
 * One honest answer to "can the online location picker work right now?".
 *
 * `navigator.onLine` only reports whether a network interface exists: a phone
 * holding a dead hotspot, a captive portal, a hotel Wi-Fi with no uplink, or a
 * reachable network whose own server is down all report `true`. Choosing the
 * online picker in that state renders a basemap it cannot download and a
 * geocoder that always fails — the blank map an SOS screen must never show. A
 * single short probe decides between the online picker and the bundled map.
 *
 * Dependency free on purpose so it stays unit-testable from a node test.
 */

/** Long enough for a slow phone network, short enough to still feel instant. */
export const SOS_PROBE_TIMEOUT_MS = 2500

/**
 * A CARTO basemap tile. It is the exact thing the online picker needs to draw
 * a map, and `no-cors` means a cross-origin block cannot masquerade as being
 * offline — we only care that the request completes at all.
 */
const BASEMAP_PROBE_URL =
  "https://a.basemaps.cartocdn.com/light_all/15/27406/15033.png"

/**
 * Same normalisation the offline config refresh uses: the value can arrive as
 * `/api`, `/api/`, a bare `/`, or an absolute origin, and every consumer has to
 * agree on the result.
 */
export function resolveSosApiBase(explicit?: string): string {
  const raw = (explicit ?? import.meta.env?.VITE_API_BASE_URL ?? "/api").trim()
  if (!raw || raw === "/" || raw === "/api") return "/api"
  return raw.replace(/\/$/, "")
}

export interface SosNetworkProbe {
  /** Test seams. Production callers pass nothing. */
  fetchImpl?: typeof fetch
  isOnline?: () => boolean
  apiBase?: string
  timeoutMs?: number
}

/**
 * Resolves `true` only when a request actually completed. Status codes are
 * irrelevant — a 404 or a 500 still proves the network carried the request.
 */
async function requestCompletes(
  runFetch: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    await runFetch(url, { ...init, signal: controller.signal })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/**
 * True when the online location picker can plausibly do its job: reach the
 * API that validates the pin, and reach a basemap host that can draw tiles.
 * Anything less and the bundled offline map is the better map.
 */
export async function sosNetworkReachable(
  probe: SosNetworkProbe = {}
): Promise<boolean> {
  if (typeof navigator === "undefined") return true
  const isOnline =
    probe.isOnline ??
    (() => typeof navigator === "undefined" || navigator.onLine !== false)
  if (!isOnline()) return false
  const runFetch =
    probe.fetchImpl ?? (typeof fetch === "function" ? fetch : undefined)
  if (!runFetch) return true

  const timeoutMs = probe.timeoutMs ?? SOS_PROBE_TIMEOUT_MS
  const base = resolveSosApiBase(probe.apiBase)
  const apiUrl = `${base}/`

  if (base.startsWith("/")) {
    // Same-origin probes pass straight through the service worker's fetch
    // handler (`/api/` is never intercepted), so a cached response can never
    // fake a connection the way a cached asset or config could.
    if (!(await requestCompletes(runFetch, apiUrl, {
      method: "HEAD",
      cache: "no-store",
      credentials: "same-origin",
    }, timeoutMs)))
      return false
  } else if (!(await requestCompletes(runFetch, apiUrl, {
    method: "HEAD",
    mode: "no-cors",
    cache: "no-store",
    credentials: "omit",
  }, timeoutMs))) {
    // Native builds talk to an absolute API origin where CORS can reject an
    // otherwise healthy request, so a failure there is not proof of anything.
    return probeBasemap(runFetch, timeoutMs)
  }

  // The API answered, but the online map still needs raster tiles. When that
  // host is unreachable the bundled map draws the barangay without help.
  return probeBasemap(runFetch, timeoutMs)
}

function probeBasemap(runFetch: typeof fetch, timeoutMs: number) {
  return requestCompletes(
    runFetch,
    BASEMAP_PROBE_URL,
    { mode: "no-cors", cache: "no-store", credentials: "omit" },
    timeoutMs
  )
}

/**
 * Watch reachability for as long as the caller needs it, re-probing on the
 * browser's own online/offline events and whenever the tab is brought back
 * into view (a phone that regained signal while backgrounded never fires
 * `online` on every platform).
 */
export function watchSosNetwork(
  onChange: (reachable: boolean) => void
): () => void {
  if (typeof window === "undefined") return () => {}
  let cancelled = false
  const check = () => {
    void sosNetworkReachable().then((reachable) => {
      if (!cancelled) onChange(reachable)
    })
  }
  const wentOffline = () => onChange(false)
  const visible = () => {
    if (document.visibilityState === "visible") check()
  }

  window.addEventListener("offline", wentOffline)
  window.addEventListener("online", check)
  window.addEventListener("focus", check)
  document.addEventListener("visibilitychange", visible)
  check()

  return () => {
    cancelled = true
    window.removeEventListener("offline", wentOffline)
    window.removeEventListener("online", check)
    window.removeEventListener("focus", check)
    document.removeEventListener("visibilitychange", visible)
  }
}
