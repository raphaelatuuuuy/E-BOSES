const DEFAULT_API_BASE_URL = "http://localhost:8000/api"

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

function apiBaseUrl() {
  return (import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/$/, "")
}

export function getAccessToken() {
  return window.localStorage.getItem("eboses-access-token")
}

export function setAuthTokens(access: string, refresh: string) {
  window.localStorage.setItem("eboses-access-token", access)
  window.localStorage.setItem("eboses-refresh-token", refresh)
}

export function clearAuthTokens() {
  window.localStorage.removeItem("eboses-access-token")
  window.localStorage.removeItem("eboses-refresh-token")
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

export async function apiRequest<T>(path: string, init: RequestInit = {}, options: { auth?: boolean } = {}) {
  const headers = new Headers(init.headers)
  const isFormData = init.body instanceof FormData

  if (!isFormData && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }

  if (options.auth !== false) {
    const token = getAccessToken()
    if (token) {
      headers.set("Authorization", `Bearer ${token}`)
    }
  }

  const response = await fetch(`${apiBaseUrl()}${path}`, { ...init, headers })

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
