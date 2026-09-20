import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import {
  getActiveEmergency,
  getEmergency,
  type EmergencyAlert,
} from "@/features/dashboard/emergency-api"
import { EmergencyTrackingSheet } from "@/features/dashboard/components/emergency-tracking-sheet"
import { SosWizard } from "@/features/dashboard/components/sos/sos-wizard"
import {
  DutyHoursDialog,
  type DutyHours,
  type Hotline,
} from "@/features/dashboard/components/sos/duty-hours-dialog"
import { apiRequest } from "@/lib/api"
import { isEmergencyActive } from "@/features/dashboard/components/emergencies/lib"
import { useAuthSession } from "@/features/auth/auth-session"
import { isResidentDevice } from "@/features/auth/resident-device"
import { useApiReachability } from "@/lib/api-reachability"

function isActiveAlert(alert: EmergencyAlert | null) {
  return Boolean(alert && isEmergencyActive(alert.status))
}

const SOS_ACTIVE_CACHE_KEY = "eboses:sos-active-alert:v1"
const SOS_ACTIVE_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

function sosActiveCacheKey(userId: number | null) {
  return `${SOS_ACTIVE_CACHE_KEY}:${userId ?? "guest"}`
}

function readCachedSosAlert(userId: number | null): EmergencyAlert | null {
  try {
    const raw = window.localStorage.getItem(sosActiveCacheKey(userId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as {
      userId?: number | null
      alert?: EmergencyAlert | null
      savedAt?: number
    }
    if ((parsed.userId ?? null) !== (userId ?? null)) return null
    if (
      !Number.isFinite(parsed.savedAt) ||
      Date.now() - (parsed.savedAt as number) > SOS_ACTIVE_CACHE_MAX_AGE_MS
    )
      return null
    return isActiveAlert(parsed.alert ?? null)
      ? (parsed.alert as EmergencyAlert)
      : null
  } catch {
    return null
  }
}

function writeCachedSosAlert(
  userId: number | null,
  alert: EmergencyAlert | null
) {
  try {
    window.localStorage.setItem(
      sosActiveCacheKey(userId),
      JSON.stringify({ userId: userId ?? null, alert, savedAt: Date.now() })
    )
  } catch {
    // Cache is a hint only; the server stays authoritative.
  }
}

export function SOSButton({ suppressed = false }: { suppressed?: boolean }) {
  const { user } = useAuthSession()
  const apiOnline = useApiReachability()
  const [shellOpen, setShellOpen] = useState(false)
  const [shellMode, setShellMode] = useState<"wizard" | "tracking">("wizard")
  const [checkingActive, setCheckingActive] = useState(false)
  const [trackingAlert, setTrackingAlert] = useState<EmergencyAlert | null>(null)
  const [dutyHours, setDutyHours] = useState<DutyHours | null>(null)
  const [hotlines, setHotlines] = useState<Hotline[]>([])
  const [dutyDialogOpen, setDutyDialogOpen] = useState(false)
  const [veilArmed, setVeilArmed] = useState(false)
  const veilTimer = useRef<number | undefined>(undefined)
  const loginCheckedRef = useRef<number | null>(null)

  useEffect(() => {
    const id = user?.id ?? null
    if (id == null || loginCheckedRef.current === id) return
    loginCheckedRef.current = id
    let cancelled = false
    let retries = 0
    async function checkNow() {
      if (cancelled || !navigator.onLine) return
      try {
        const active = await getActiveEmergency()
        if (!cancelled) setTrackingAlert(active ?? null)
      } catch {
        if (!cancelled && retries < 2) {
          retries += 1
          window.setTimeout(checkNow, 5000)
        }
      }
    }
    void checkNow()
    return () => {
      cancelled = true
    }
  }, [user?.id])

  useEffect(() => {
    if (!user || !apiOnline) return
    let cancelled = false
    void apiRequest<{ duty_hours?: DutyHours; hotlines?: Hotline[] }>(
      "/locations/map-context/"
    )
      .then((context) => {
        if (cancelled) return
        setDutyHours(context.duty_hours ?? null)
        setHotlines(context.hotlines ?? [])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [apiOnline, user])

  const offDuty = dutyHours ? !dutyHours.within_duty_hours : false

  const prevUserIdRef = useRef<number | null | undefined>(undefined)
  useEffect(() => {
    const id = user?.id ?? null
    if (prevUserIdRef.current === id) return
    prevUserIdRef.current = id
    setTrackingAlert(null)
    setShellOpen(false)
    setShellMode("wizard")
  }, [user?.id])

  useEffect(() => {
    if (!user || !apiOnline) return
    let cancelled = false
    let loading = false
    async function loadActive() {
      if (!apiOnline || loading || document.visibilityState === "hidden") return
      loading = true
      try {
        const active = await getActiveEmergency()
        if (cancelled) return
        setTrackingAlert(active ?? null)
      } catch {
        /* non-blocking */
      } finally {
        loading = false
      }
    }
    void loadActive()
    window.addEventListener("online", loadActive)
    window.addEventListener("focus", loadActive)
    document.addEventListener("visibilitychange", loadActive)
    return () => {
      cancelled = true
      window.removeEventListener("online", loadActive)
      window.removeEventListener("focus", loadActive)
      document.removeEventListener("visibilitychange", loadActive)
    }
  }, [apiOnline, suppressed, user])

  useEffect(() => {
    const active = isActiveAlert(trackingAlert)
    window.dispatchEvent(
      new CustomEvent("eboses:sos-active-change", { detail: { active } })
    )
    writeCachedSosAlert(user?.id ?? null, trackingAlert)
  }, [trackingAlert, user?.id])

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("eboses:sos-open-change", { detail: { open: shellOpen } })
    )
  }, [shellOpen])

  const handleSosRef = useRef(() => {})
  const suppressedRef = useRef(suppressed)

  function openWizard() {
    setDutyDialogOpen(false)
    setShellMode("wizard")
    setShellOpen(true)
  }

  async function handleSosButtonClick() {
    if (isActiveAlert(trackingAlert)) {
      setShellMode("tracking")
      setShellOpen(true)
      return
    }
    const resident = isResidentDevice(user)
    if (!apiOnline) {
      const cached = readCachedSosAlert(user?.id ?? null)
      if (cached) {
        setTrackingAlert(cached)
        setShellMode("tracking")
        setShellOpen(true)
        return
      }
      if (resident) {
        openWizard()
        return
      }
      return
    }
    if (!user) {
      openWizard()
      return
    }
    setCheckingActive(true)
    try {
      const active = await getActiveEmergency()
      if (active && isActiveAlert(active)) {
        setTrackingAlert(active)
        setShellMode("tracking")
        setShellOpen(true)
        return
      }
      if (!resident) {
        return
      }
      if (offDuty && hotlines.length) {
        setDutyDialogOpen(true)
        return
      }
      openWizard()
    } catch {
      if (resident) openWizard()
    } finally {
      setCheckingActive(false)
    }
  }
  useEffect(() => {
    suppressedRef.current = suppressed
    handleSosRef.current = handleSosButtonClick
  })

  useEffect(() => {
    function handleOpenEmergency(event: Event) {
      const emergencyId = (event as CustomEvent<{ emergencyId?: number }>)
        .detail?.emergencyId
      if (!emergencyId) return
      void getEmergency(emergencyId)
        .then((alert) => {
          if (!isActiveAlert(alert)) {
            toast.error("This emergency is already closed.")
            return
          }
          setTrackingAlert(alert)
          setShellMode("tracking")
          setShellOpen(true)
        })
        .catch(() => toast.error("Could not open emergency tracking."))
    }
    function handleOpenSos() {
      if (suppressedRef.current) return
      void handleSosRef.current()
    }
    window.addEventListener(
      "eboses:open-emergency-tracking",
      handleOpenEmergency
    )
    window.addEventListener("eboses:open-sos", handleOpenSos)
    const query = new URLSearchParams(window.location.search)
    const openFromShortcut = query.get("open") === "sos"
    const shortcutTimer = openFromShortcut
      ? window.setTimeout(() => {
          void handleSosRef.current()
          query.delete("open")
          const next = `${window.location.pathname}${query.size ? `?${query.toString()}` : ""}${window.location.hash}`
          window.history.replaceState(window.history.state, "", next)
        }, 0)
      : undefined
    return () => {
      if (shortcutTimer !== undefined) window.clearTimeout(shortcutTimer)
      window.removeEventListener(
        "eboses:open-emergency-tracking",
        handleOpenEmergency
      )
      window.removeEventListener("eboses:open-sos", handleOpenSos)
    }
  }, [])

  const hasActiveEmergency = isActiveAlert(trackingAlert)
  const residentShell = isResidentDevice(user)

  function armVeil() {
    if (suppressed || checkingActive || shellOpen || dutyDialogOpen) return
    window.clearTimeout(veilTimer.current)
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    veilTimer.current = window.setTimeout(
      () => setVeilArmed(true),
      reduce ? 0 : 200
    )
  }

  function disarmVeil() {
    window.clearTimeout(veilTimer.current)
    setVeilArmed(false)
  }

  useEffect(() => {
    if (!veilArmed) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") disarmVeil()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [veilArmed])

  useEffect(() => {
    function arm() {
      if (suppressedRef.current) return
      armVeil()
    }
    window.addEventListener("eboses:sos-veil-arm", arm)
    window.addEventListener("eboses:sos-veil-disarm", disarmVeil)
    return () => {
      window.removeEventListener("eboses:sos-veil-arm", arm)
      window.removeEventListener("eboses:sos-veil-disarm", disarmVeil)
    }
  })

  useEffect(() => () => window.clearTimeout(veilTimer.current), [])

  function openFromVeil() {
    disarmVeil()
    void handleSosRef.current()
  }
  return (
    <>
      {veilArmed && residentShell && !shellOpen && !dutyDialogOpen ? (
        <div
          role="button"
          tabIndex={0}
          aria-label={
            hasActiveEmergency
              ? "Open emergency tracking"
              : "Send an SOS alert"
          }
          onClick={openFromVeil}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              openFromVeil()
            }
          }}
          onMouseLeave={disarmVeil}
          className="fixed inset-0 z-[300] flex cursor-pointer flex-col items-center justify-center overflow-hidden bg-black/45 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150"
        >
          <div className="absolute inset-0 bg-sos/15 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150" />
          <p className="relative px-6 pb-4 text-center text-6xl font-extrabold tracking-tight text-white transition-colors duration-150 hover:text-sos lg:text-8xl">
            {hasActiveEmergency ? "Track my emergency" : "Need help?"}
          </p>
          <p className="relative px-6 text-center text-base font-medium text-white/70">
            {hasActiveEmergency
              ? "Click anywhere to open live tracking."
              : offDuty
                ? "Click anywhere to see hotlines and send anyway."
                : "Click anywhere to send an SOS alert."}
          </p>
          <p className="absolute bottom-8 left-1/2 -translate-x-1/2 px-6 text-center text-xs text-white/50">
            Press Esc or move away to dismiss
          </p>
        </div>
      ) : null}

      <DutyHoursDialog
        open={dutyDialogOpen}
        hotlines={hotlines}
        dutyHours={dutyHours}
        onSendAnyway={openWizard}
        onClose={() => setDutyDialogOpen(false)}
      />

      <SosWizard
        open={!suppressed && shellOpen && shellMode === "wizard"}
        online={apiOnline}
        hotlines={hotlines}
        onClose={() => setShellOpen(false)}
        onSubmitted={(alert) => {
          setTrackingAlert(alert)
          setShellMode("tracking")
        }}
      />

      <EmergencyTrackingSheet
        open={!suppressed && shellOpen && shellMode === "tracking"}
        onOpenChange={(open) => {
          if (!open) {
            setShellOpen(false)
            setShellMode("wizard")
          }
        }}
        initialAlert={trackingAlert}
        onAlertChange={setTrackingAlert}
      />
    </>
  )
}
