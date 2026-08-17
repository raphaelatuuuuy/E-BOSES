import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react"

import { ApiError, apiRequest } from "@/lib/api"

export interface SystemNotice {
  id: number
  kind: "ticker" | "maintenance"
  tone: "info" | "warning" | "critical"
  message: string
  detail: string
  starts_at: string | null
  ends_at: string | null
}

export interface SystemStatus {
  maintenance: SystemNotice | null
  ticker: SystemNotice | null
  server_time: string
}

type SystemStatusContextValue = {
  status: SystemStatus | null
  loading: boolean
  error: ApiError | null
  refresh: () => void
}

const DISMISSED_KEY = "eboses_ticker_dismissed"
const SystemStatusContext = createContext<SystemStatusContextValue | null>(null)

export function fetchSystemStatus(signal?: AbortSignal) {
  return apiRequest<SystemStatus>("/system/status/", { signal }, { auth: false, refreshOnUnauthorized: false })
}

export function SystemStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SystemStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ApiError | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let stopped = false
    let timer: number | undefined
    let controller: AbortController | undefined
    let failureCount = 0
    const schedule = (delay: number) => {
      if (!stopped) timer = window.setTimeout(load, delay)
    }

    const load = async () => {
      if (stopped || document.visibilityState === "hidden" || navigator.onLine === false) {
        schedule(120_000)
        return
      }
      controller?.abort()
      controller = new AbortController()
      try {
        const next = await fetchSystemStatus(controller.signal)
        if (stopped) return
        setStatus(next)
        setError(null)
        failureCount = 0
        schedule(next.maintenance ? 30_000 : 120_000)
      } catch (cause) {
        if (stopped) return
        const nextError = cause instanceof ApiError ? cause : new ApiError("System status is unavailable.", 0, cause)
        setError(nextError)
        failureCount += 1
        const retryDelay = nextError.retryAfterMs ?? Math.min(300_000, 2_000 * 2 ** Math.min(failureCount, 7))
        schedule(retryDelay + Math.floor(Math.random() * 500))
      } finally {
        setLoading(false)
      }
    }

    const wake = () => {
      window.clearTimeout(timer)
      void load()
    }
    document.addEventListener("visibilitychange", wake)
    window.addEventListener("online", wake)
    void load()
    return () => {
      stopped = true
      window.clearTimeout(timer)
      controller?.abort()
      document.removeEventListener("visibilitychange", wake)
      window.removeEventListener("online", wake)
    }
  }, [refreshKey])

  const value = useMemo(() => ({ status, loading, error, refresh: () => setRefreshKey((value) => value + 1) }), [status, loading, error])
  return <SystemStatusContext.Provider value={value}>{children}</SystemStatusContext.Provider>
}

export function useSystemStatus() {
  const context = useContext(SystemStatusContext)
  if (!context) throw new Error("useSystemStatus must be used inside SystemStatusProvider.")
  return context
}

export function SystemTicker() {
  const { status } = useSystemStatus()
  const notice = status?.ticker ?? null
  const [dismissed, setDismissed] = useState<number | null>(() => {
    const raw = window.sessionStorage.getItem(DISMISSED_KEY)
    return raw ? Number(raw) : null
  })

  if (!notice || dismissed === notice.id) return null

  function dismiss(current: SystemNotice) {
    window.sessionStorage.setItem(DISMISSED_KEY, String(current.id))
    setDismissed(current.id)
  }

  const text = notice.detail ? `${notice.message} — ${notice.detail}` : notice.message
  return (
    <div className="relative flex items-center gap-4 border-b border-neutral-200 bg-neutral-100 py-2">
      <div className="group flex-1 overflow-hidden">
        <div className="flex w-max animate-[marquee_38s_linear_infinite] gap-16 group-hover:[animation-play-state:paused] motion-reduce:animate-none motion-reduce:justify-center">
          <span className="text-meta text-foreground">{text}</span>
          <span aria-hidden className="text-meta text-foreground motion-reduce:hidden">{text}</span>
        </div>
      </div>
      <button type="button" onClick={() => dismiss(notice)} aria-label="Dismiss notice" className="mr-4 shrink-0 text-meta text-neutral-500 hover:text-foreground">
        Dismiss
      </button>
    </div>
  )
}
