import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangleIcon, ChevronUpIcon, LoaderCircleIcon } from "lucide-react"
import { useLocation, useNavigate } from "react-router-dom"

import { isResponderUser } from "@/features/auth/roles"
import { useAuthSession } from "@/features/auth/auth-session"
import {
  listAssignedEmergencies,
  type EmergencyAlert,
} from "@/features/dashboard/emergency-api"
import { cn } from "@workspace/ui/lib/utils"

const ACTIVE_STATUSES = new Set(["submitted", "routed", "acknowledged", "en_route", "nearby", "arrived"])
const SELECTED_KEY = "eboses:responder-dispatch-id"

export function ResponderDispatchFab() {
  const { user } = useAuthSession()
  const location = useLocation()
  const navigate = useNavigate()
  const [alerts, setAlerts] = useState<EmergencyAlert[]>([])
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const hadActiveRef = useRef(false)

  const activeAlerts = useMemo(
    () => alerts.filter((alert) => ACTIVE_STATUSES.has(alert.status)),
    [alerts],
  )
  const persistedId = Number(window.localStorage.getItem(SELECTED_KEY))
  const current = activeAlerts.find((alert) => alert.id === persistedId) ?? activeAlerts[0] ?? null
  const isOnMap = location.pathname === "/dashboard/responders/map"

  const load = useCallback(async () => {
    try {
      const next = await listAssignedEmergencies()
      const hasActive = next.some((alert) => ACTIVE_STATUSES.has(alert.status))
      setAlerts(next)
      setLoadError("")
      if (hasActive && !hadActiveRef.current) setExpanded(true)
      hadActiveRef.current = hasActive
    } catch {
      setLoadError("Dispatch could not refresh. Showing the last known assignment.")
      setExpanded(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isResponderUser(user)) return
    const initial = window.setTimeout(() => void load(), 0)
    const timer = window.setInterval(() => void load(), 30000)
    const refresh = () => void load()
    window.addEventListener("eboses:notification-created", refresh)
    window.addEventListener("eboses:emergency-updated", refresh)
    window.addEventListener("online", refresh)
    window.addEventListener("focus", refresh)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(timer)
      window.removeEventListener("eboses:notification-created", refresh)
      window.removeEventListener("eboses:emergency-updated", refresh)
      window.removeEventListener("online", refresh)
      window.removeEventListener("focus", refresh)
    }
  }, [load, user])

  if (!isResponderUser(user)) return null

  function openDispatch(id?: number) {
    if (id) window.localStorage.setItem(SELECTED_KEY, String(id))
    navigate(id ? `/dashboard/responders/map?alert=${id}` : "/dashboard/responders/map")
  }

  return (
    <div className="pointer-events-none fixed bottom-24 right-4 z-[700] sm:bottom-7 sm:right-7">
      <div className="pointer-events-auto flex flex-col items-end gap-2">
        {expanded && current ? (
          <button
            type="button"
            onClick={() => openDispatch(current.id)}
            className="flex w-[min(21rem,calc(100vw-2rem))] items-center gap-3 rounded-2xl border border-red-200 bg-white p-3 text-left shadow-[0_14px_40px_rgba(15,23,42,.18)]"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600">
              <AlertTriangleIcon className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-black uppercase tracking-wide text-red-600">Ongoing dispatch</span>
              <span className="mt-0.5 block truncate text-sm font-black text-[#07145f]">{current.address || current.barangay}</span>
              <span className="mt-0.5 block text-xs font-semibold text-neutral-500">{current.type} · {current.status.replace(/_/g, " ")}</span>
            </span>
            <ChevronUpIcon className="size-4 shrink-0 text-neutral-400" />
          </button>
        ) : null}

        {expanded && loadError ? (
          <div role="status" className="w-[min(21rem,calc(100vw-2rem))] rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-900 shadow-sm">
            {loadError}
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => (current ? setExpanded((value) => !value) : openDispatch())}
          aria-label={current ? "Open ongoing dispatch" : "Open dispatch"}
          aria-describedby={loadError ? "responder-dispatch-refresh-error" : undefined}
          className={cn(
            "flex h-14 items-center gap-2 rounded-full px-5 text-sm font-black text-white shadow-[0_10px_30px_rgba(15,23,42,.2)] transition-transform hover:-translate-y-0.5",
            current ? "bg-[#f23b35]" : "bg-neutral-400",
            isOnMap && current && "ring-4 ring-red-100",
          )}
        >
          {loading ? <LoaderCircleIcon className="size-5 animate-spin" /> : <AlertTriangleIcon className="size-5" />}
          <span>Dispatch</span>
          {current ? <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs">{activeAlerts.length}</span> : null}
        </button>
        {loadError ? <span id="responder-dispatch-refresh-error" className="sr-only">{loadError}</span> : null}
      </div>
    </div>
  )
}
