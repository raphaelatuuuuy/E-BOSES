// Same-origin `/api` goes through the Vite dev proxy (see vite.config.ts),
// so HTTPS LAN demos avoid mixed-content blocks to plain HTTP Django.
import { humanError } from "@/lib/error-messages"
const DEFAULT_API_BASE_URL = "/api"
const CSRF_COOKIE_NAME = "csrftoken"
const DEFAULT_TIMEOUT_MS = 20000
const UPLOAD_TIMEOUT_MS = 60000

let accessToken: string | null = null
let refreshPromise: Promise<SessionResponse | null> | null = null
let csrfPromise: Promise<void> | null = null
const inflightGets = new Map<string, Promise<unknown>>()

export class ApiError extends Error {
  status: number
  data: unknown
  retryAfterMs: number | null

  constructor(message: string, status: number, data: unknown, retryAfterMs: number | null = null) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.data = data
    this.retryAfterMs = retryAfterMs
  }
}

export interface SessionResponse {
  access: string
  user: unknown
}

export function apiBaseUrl() {
  const raw = (import.meta.env.VITE_API_BASE_URL ?? DEFAULT_API_BASE_URL).trim()
  // Empty / relative values stay same-origin (Vite HTTPS proxy in dev).
  if (!raw || raw === "/" || raw === "/api") return "/api"
  return raw.replace(/\/$/, "")
}

/** Origin used for media/WebSocket URLs (empty string = current page origin). */
export function apiOrigin() {
  const base = apiBaseUrl()
  if (base.startsWith("/")) return ""
  return base.replace(/\/api$/, "")
}

export function websocketUrl(path: string) {
  const origin = apiOrigin()
  if (!origin) {
    // Same-origin WebSocket — wss:// when the page is HTTPS.
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    return `${protocol}//${window.location.host}${path.startsWith("/") ? path : `/${path}`}`
  }
  const wsBase = origin.replace(/^https:/, "wss:").replace(/^http:/, "ws:")
  return `${wsBase}${path.startsWith("/") ? path : `/${path}`}`
}

export async function websocketTicket() {
  const response = await apiRequest<{ ticket: string; expires_in: number }>("/notifications/realtime-ticket/", {
    method: "POST",
    body: JSON.stringify({}),
  })
  return response.ticket
}

function csrfToken() {
  return document.cookie
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${CSRF_COOKIE_NAME}=`))
    ?.split("=")[1]
}

function isUnsafeMethod(method: string) {
  return !["GET", "HEAD", "OPTIONS", "TRACE"].includes(method.toUpperCase())
}

function mergeSignals(first: AbortSignal | undefined, second: AbortSignal | undefined) {
  if (!first) return second
  if (!second) return first
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (first.aborted || second.aborted) abort()
  first.addEventListener("abort", abort, { once: true })
  second.addEventListener("abort", abort, { once: true })
  return controller.signal
}

export function getAccessToken() {
  return accessToken
}

export function setAuthTokens(access: string) {
  accessToken = access
}

export function clearAuthTokens() {
  accessToken = null
}

export async function ensureCsrfCookie() {
  csrfPromise ??= fetch(`${apiBaseUrl()}/auth/csrf/`, {
    credentials: "include",
  }).then((response) => {
    if (!response.ok) throw new ApiError("Could not prepare a secure request.", response.status, null)
  }).finally(() => {
    csrfPromise = null
  })
  return csrfPromise
}

export async function refreshSession() {
  refreshPromise ??= (async () => {
    const rotate = () => apiRequest<SessionResponse | null>(
      "/auth/refresh/",
      { method: "POST" },
      { auth: false, refreshOnUnauthorized: false, csrf: true, dedupe: false },
    ).then((result) => {
      if (result) setAuthTokens(result.access)
      return result
    })
    const locks = typeof navigator !== "undefined"
      ? (navigator as Navigator & { locks?: { request: <T>(name: string, callback: () => Promise<T>) => Promise<T> } }).locks
      : undefined
    if (locks) {
      return locks.request("eboses-auth-refresh", rotate)
    }
    return rotate()
  })().finally(() => {
    refreshPromise = null
  })

  return refreshPromise
}

export async function logoutSession() {
  try {
    await apiRequest<void>(
      "/auth/logout/",
      { method: "POST" },
      { auth: false, refreshOnUnauthorized: false, csrf: true },
    )
  } finally {
    clearAuthTokens()
  }
}

function errorMessage(data: unknown, fallback: string) {
  if (data && typeof data === "object") {
    // A known machine code becomes a sentence a resident can act on, so a raw
    // "ip_blocked" can never reach the screen.
    const mapped = humanError(data, "")
    if (mapped) return mapped

    const detail = (data as { detail?: unknown }).detail
    if (typeof detail === "string") {
      return detail
    }
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0]
      if (typeof first === "string") return first
    }
    for (const value of Object.values(data as Record<string, unknown>)) {
      if (typeof value === "string" && value.trim()) return value
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === "string" && item.trim()) return item
          // DRF ValidationError list-repr sometimes nests oddly
          if (Array.isArray(item) && typeof item[0] === "string") return item[0]
        }
      }
    }
  }
  return fallback
}

function isNetworkFetchError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const msg = (error.message || "").toLowerCase()
  return (
    error.name === "TypeError" ||
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("network request failed") ||
    msg.includes("load failed") ||
    msg.includes("fetch failed")
  )
}

export function networkErrorMessage(error?: unknown): string {
  void error
  const base = apiBaseUrl()
  return (
    `Cannot reach the API (${base}). ` +
    `Make sure the backend is running (usually on port 8000) and the Vite proxy can reach it, then refresh. ` +
    `For phones on Wi‑Fi, open the HTTPS Vite URL (not :8000) so location APIs work in a secure context.`
  )
}

async function request<T>(path: string, init: RequestInit, options: ApiRequestOptions) {
  const headers = new Headers(init.headers)
  const isFormData = init.body instanceof FormData
  const method = init.method ?? "GET"

  if (!isFormData && init.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }

  if (options.auth !== false && accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`)
  }

  if (options.csrf && isUnsafeMethod(method)) {
    let token = csrfToken()
    if (!token) {
      await ensureCsrfCookie()
      token = csrfToken()
    }
    if (token) {
      headers.set("X-CSRFToken", decodeURIComponent(token))
    }
  }

  const timeoutMs = options.timeoutMs ?? (isFormData ? UPLOAD_TIMEOUT_MS : DEFAULT_TIMEOUT_MS)
  const controller = timeoutMs > 0 ? new AbortController() : null
  const signal = mergeSignals(controller?.signal, init.signal ?? undefined)
  const timeoutId =
    controller && timeoutMs > 0
      ? window.setTimeout(() => controller.abort(), timeoutMs)
      : null

  let response: Response
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      ...init,
      headers,
      credentials: "include",
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError(
        "The server took too long to respond. Keep the API running and try again.",
        0,
        { message: "Request timed out." },
      )
    }
    if (isNetworkFetchError(error)) {
      throw new ApiError(networkErrorMessage(error), 0, {
        message: networkErrorMessage(error),
        reasons: ["Network error — API unreachable."],
      })
    }
    throw error
  } finally {
    if (timeoutId != null) window.clearTimeout(timeoutId)
  }

  if (response.status === 204) {
    return undefined as T
  }

  const contentType = response.headers.get("content-type") ?? ""
  const data = contentType.includes("application/json") ? await response.json() : await response.text()

  if (!response.ok) {
    const retryAfter = response.headers.get("Retry-After")
    const retryDate = retryAfter && !/^\d+(?:\.\d+)?$/.test(retryAfter) ? Date.parse(retryAfter) : NaN
    const retryAfterMs = retryAfter
      ? /^\d+(?:\.\d+)?$/.test(retryAfter)
        ? Number(retryAfter) * 1000
        : Number.isFinite(retryDate)
          ? Math.max(0, retryDate - Date.now())
          : null
      : data && typeof data === "object" && typeof (data as { retry_after?: unknown }).retry_after === "number"
        ? Number((data as { retry_after: number }).retry_after) * 1000
        : null
    throw new ApiError(errorMessage(data, "Request failed."), response.status, data, retryAfterMs)
  }

  return data as T
}

interface ApiRequestOptions {
  auth?: boolean
  csrf?: boolean
  refreshOnUnauthorized?: boolean
  /** Optional request timeout in milliseconds (AbortController). */
  timeoutMs?: number
  dedupe?: boolean
}

export async function apiRequest<T>(path: string, init: RequestInit = {}, options: ApiRequestOptions = {}) {
  const communityId = typeof window === "undefined" ? "" : window.sessionStorage.getItem("eboses:selected-community") ?? ""
  let requestPath = path
  let requestInit = init
  if (communityId) {
    if (!/[?&]community_id=/.test(requestPath)) {
      requestPath += `${requestPath.includes("?") ? "&" : "?"}community_id=${encodeURIComponent(communityId)}`
    }
    if (init.body instanceof FormData && !init.body.has("community_id")) {
      init.body.append("community_id", communityId)
    } else if (typeof init.body === "string") {
      try {
        const parsed = JSON.parse(init.body) as unknown
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          requestInit = {
            ...init,
            body: JSON.stringify({ ...(parsed as Record<string, unknown>), community_id: communityId }),
          }
        }
      } catch {
        requestInit = init
      }
    }
  }
  const method = (requestInit.method ?? "GET").toUpperCase()
  const dedupeKey = method === "GET" && options.dedupe !== false
    ? `${method}:${apiBaseUrl()}${requestPath}:${getAccessToken() ?? "anonymous"}`
    : null
  if (dedupeKey) {
    const existing = inflightGets.get(dedupeKey)
    if (existing) return existing as Promise<T>
  }
  const pending = requestWithRefresh<T>(requestPath, requestInit, options)
  if (dedupeKey) {
    inflightGets.set(dedupeKey, pending)
    pending.finally(() => inflightGets.delete(dedupeKey)).catch(() => undefined)
  }
  return pending
}

export interface ListEnvelope<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}

export function unwrapList<T>(payload: T[] | ListEnvelope<T>): T[] {
  return Array.isArray(payload) ? payload : payload.results
}

async function requestWithRefresh<T>(path: string, init: RequestInit, options: ApiRequestOptions) {
  try {
    return await request<T>(path, init, options)
  } catch (error) {
    if (error instanceof ApiError && error.status === 401 && options.auth !== false && options.refreshOnUnauthorized !== false) {
      const refreshed = await refreshSession()
      if (!refreshed) throw new ApiError("Your session has expired.", 401, null)
      return request<T>(path, init, { ...options, refreshOnUnauthorized: false })
    }
    throw error
  }
}
