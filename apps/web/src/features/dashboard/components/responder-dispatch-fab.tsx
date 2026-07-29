import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangleIcon, LoaderCircleIcon } from "lucide-react"
import { useLocation, useNavigate } from "react-router-dom"

import { isResponderUser } from "@/features/auth/roles"
import { useAuthSession } from "@/features/auth/auth-session"
import {
  listAssignedEmergencies,
  type EmergencyAlert,
} from "@/features/dashboard/emergency-api"
import { cn } from "@workspace/ui/lib/utils"
import {
  announceDispatchPanel,
  DISPATCH_PANEL_PARAM,
} from "@/features/dashboard/lib/dispatch-panel"
import { useIsDesktop } from "@/features/dashboard/lib/shell"

const ACTIVE_STATUSES = new Set(["submitted", "routed", "acknowledged", "en_route", "nearby", "arrived"])
const SELECTED_KEY = "eboses:responder-dispatch-id"
const RESPONDER_MAP_PATH = "/dashboard/responders/map"

/**
 * Assigned dispatches, polled. Shared by the nav button and anything else that
 * needs the live count without owning a second poll loop.
 */
function useAssignedDispatches(enabled: boolean) {
  const [alerts, setAlerts] = useState<EmergencyAlert[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const hadActiveRef = useRef(false)

  const load = useCallback(async () => {
    try {
      const next = await listAssignedEmergencies()
      const hasActive = next.some((alert) => ACTIVE_STATUSES.has(alert.status))
      setAlerts(next)
      setLoadError("")
      // A newly arrived dispatch opens the panel if the responder is already on
      // the map. It deliberately does not navigate them there from Shift or
      // Profile: yanking someone off the screen they chose is worse than the
      // button going red with a count, which is what happens instead.
      if (hasActive && !hadActiveRef.current) announceDispatchPanel()
      hadActiveRef.current = hasActive
    } catch {
      setLoadError("Dispatch could not refresh. Showing the last known assignment.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
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
  }, [enabled, load])

  const activeAlerts = useMemo(
    () => alerts.filter((alert) => ACTIVE_STATUSES.has(alert.status)),
    [alerts],
  )

  return { activeAlerts, loading, loadError }
}

/**
 * The Dispatch control.
 *
 * Rides inside the mobile nav row beside the Map/Shift pill, the way the
 * resident's SOS button rides beside theirs. Pressing it opens the dispatch
 * panel rather than expanding a preview card, so there is one place a dispatch
 * is ever read.
 */
export function ResponderDispatchButton({ className }: { className?: string }) {
  const { user } = useAuthSession()
  const location = useLocation()
  const navigate = useNavigate()
  const isResponder = isResponderUser(user)
  const { activeAlerts, loading, loadError } = useAssignedDispatches(isResponder)

  if (!isResponder) return null

  const count = activeAlerts.length
  const live = count > 0

  function open() {
    const persistedId = Number(window.localStorage.getItem(SELECTED_KEY))
    const current =
      activeAlerts.find((alert) => alert.id === persistedId) ?? activeAlerts[0] ?? null
    if (current) window.localStorage.setItem(SELECTED_KEY, String(current.id))

    if (location.pathname === RESPONDER_MAP_PATH) {
      announceDispatchPanel()
      return
    }

    const params = new URLSearchParams({ [DISPATCH_PANEL_PARAM]: "1" })
    if (current) params.set("alert", String(current.id))
    navigate(`${RESPONDER_MAP_PATH}?${params.toString()}`)
  }

  return (
    <button
      type="button"
      onClick={open}
      aria-label={live ? `Open dispatch, ${count} active` : "Open dispatch"}
      className={cn(
        "flex h-[3.75rem] shrink-0 items-center gap-2 rounded-full px-4 text-sm font-bold transition-transform active:scale-[0.98]",
        live
          ? "bg-sos text-white shadow-glow-red ops-glow-pulse"
          : "border border-rail-line bg-nav-raised text-nav-text",
        className,
      )}
    >
      {loading ? (
        <LoaderCircleIcon className="size-5 shrink-0 animate-spin" />
      ) : (
        <AlertTriangleIcon className="size-5 shrink-0" />
      )}
      <span className="leading-none">Dispatch</span>
      {live ? (
        <span className="tabular-nums leading-none opacity-80">{count}</span>
      ) : null}
      {loadError ? <span className="sr-only">{loadError}</span> : null}
    </button>
  )
}

/**
 * Desktop floating version. Absent on the map itself, where the dispatch panel
 * is already docked to the right and a button to open it would be noise.
 *
 * Gated on the desktop hook rather than a `hidden lg:block` class: the button
 * owns a polling loop, and hiding it with CSS would still mount it alongside the
 * one in the mobile nav, giving two pollers and two auto-open requests.
 */
export function ResponderDispatchFab() {
  const { user } = useAuthSession()
  const location = useLocation()
  const isDesktop = useIsDesktop()

  if (!isDesktop) return null
  if (!isResponderUser(user)) return null
  if (location.pathname === RESPONDER_MAP_PATH) return null

  return (
    <div className="pointer-events-none fixed bottom-7 right-7 z-40">
      <div className="pointer-events-auto">
        <ResponderDispatchButton />
      </div>
    </div>
  )
}
