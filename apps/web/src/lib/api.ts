const DEFAULT_API_BASE_URL = "http://localhost:8000/api"
const CSRF_COOKIE_NAME = "csrftoken"

let accessToken: string | null = null
let refreshPromise: Promise<SessionResponse | null> | null = null

export class ApiError extends Error {
  status: number
  data: unknown

  constructor(message: string, status: number, data: unknown) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.data = data
  }
}

export interface SessionResponse {
  access: string
  user: unknown
}

function apiBaseUrl() {
  return (import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/$/, "")
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
  await fetch(`${apiBaseUrl()}/auth/csrf/`, {
    credentials: "include",
  })
}

export async function refreshSession() {
  refreshPromise ??= apiRequest<SessionResponse | null>(
    "/auth/refresh/",
    { method: "POST" },
    { auth: false, refreshOnUnauthorized: false, csrf: true },
  ).then((result) => {
    if (!result) return null
    setAuthTokens(result.access)
    return result
  }).finally(() => {
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
    const detail = (data as { detail?: unknown }).detail
    if (typeof detail === "string") {
      return detail
    }
    const firstError = Object.values(data).flat().find((value) => typeof value === "string")
    if (typeof firstError === "string") {
      return firstError
    }
  }
  return fallback
}

async function request<T>(path: string, init: RequestInit, options: ApiRequestOptions) {
  const headers = new Headers(init.headers)
  const isFormData = init.body instanceof FormData
  const method = init.method ?? "GET"

  if (!isFormData && !headers.has("Content-Type")) {
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

  const response = await fetch(`${apiBaseUrl()}${path}`, { ...init, headers, credentials: "include" })

  if (response.status === 204) {
    return undefined as T
  }

  const contentType = response.headers.get("content-type") ?? ""
  const data = contentType.includes("application/json") ? await response.json() : await response.text()

  if (!response.ok) {
    throw new ApiError(errorMessage(data, "Request failed."), response.status, data)
  }

  return data as T
}

interface ApiRequestOptions {
  auth?: boolean
  csrf?: boolean
  refreshOnUnauthorized?: boolean
}

export async function apiRequest<T>(path: string, init: RequestInit = {}, options: ApiRequestOptions = {}) {
  try {
    return await request<T>(path, init, options)
  } catch (error) {
    if (error instanceof ApiError && error.status === 401 && options.auth !== false && options.refreshOnUnauthorized !== false) {
      try {
        await refreshSession()
      } catch {
        clearAuthTokens()
        throw error
      }
      return request<T>(path, init, { ...options, refreshOnUnauthorized: false })
    }
    throw error
  }
}
