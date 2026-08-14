import { useEffect, useState } from "react"

import { apiRequest } from "@/lib/api"

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

const DISMISSED_KEY = "eboses_ticker_dismissed"

export function fetchSystemStatus() {
  return apiRequest<SystemStatus>("/system/status/", {}, { auth: false, refreshOnUnauthorized: false })
}

export function useSystemStatus(pollMs = 120_000) {
  const [status, setStatus] = useState<SystemStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const next = await fetchSystemStatus()
        if (!cancelled) setStatus(next)
      } catch {
        /* a missing banner must never break the page */
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), pollMs)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [pollMs])

  return status
}

/**
 * A single line that scrolls across the top of every page. Duplicated twice so
 * the marquee loops without a visible gap; paused on hover so it can be read.
 */
export function SystemTicker() {
  const status = useSystemStatus()
  const notice = status?.ticker ?? null
  const [dismissed, setDismissed] = useState<number | null>(() => {
    const raw = window.sessionStorage.getItem(DISMISSED_KEY)
    return raw ? Number(raw) : null
  })

  if (!notice || dismissed === notice.id) return null

  function dismiss() {
    if (!notice) return
    window.sessionStorage.setItem(DISMISSED_KEY, String(notice.id))
    setDismissed(notice.id)
  }

  const text = notice.detail ? `${notice.message} — ${notice.detail}` : notice.message

  return (
    <div className="relative flex items-center gap-4 border-b border-neutral-200 bg-neutral-100 py-2">
      <div className="group flex-1 overflow-hidden">
        <div className="flex w-max animate-[marquee_38s_linear_infinite] gap-16 group-hover:[animation-play-state:paused] motion-reduce:animate-none motion-reduce:justify-center">
          <span className="text-meta text-foreground">{text}</span>
          <span aria-hidden className="text-meta text-foreground motion-reduce:hidden">
            {text}
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss notice"
        className="mr-4 shrink-0 text-meta text-neutral-500 hover:text-foreground"
      >
        Dismiss
      </button>
    </div>
  )
}
