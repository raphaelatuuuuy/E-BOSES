import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Loader2Icon, PhoneIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
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

type SosPlacement = "inline" | "sidebar" | "compact"

function normalizeSosPlacement(value: string | null): SosPlacement {
  if (value === "bottom_bar") return "sidebar"
  if (value === "floating") return "inline"
  if (value === "sidebar" || value === "compact" || value === "inline")
    return value
  return "inline"
}

function isActiveAlert(alert: EmergencyAlert | null) {
  // Shared list: an inline copy here went stale when statuses were added, so
  // the button stopped recognising a live emergency and let the resident file
  // a second one.
  return Boolean(alert && isEmergencyActive(alert.status))
}

/**
 * FAB + open/close orchestration between the SOS wizard (new alert) and the
 * emergency tracking sheet (existing/active alert). Wizard step machine and
 * shell UI live in components/sos/sos-wizard.tsx.
 */
export function SOSButton({ suppressed = false }: { suppressed?: boolean }) {
  const [placement, setPlacement] = useState<SosPlacement>(() =>
    normalizeSosPlacement(localStorage.getItem("eboses:sos-placement"))
  )
  const [shellOpen, setShellOpen] = useState(false)
  const [shellMode, setShellMode] = useState<"wizard" | "tracking">("wizard")
  const [checkingActive, setCheckingActive] = useState(false)
  const [trackingAlert, setTrackingAlert] = useState<EmergencyAlert | null>(
    null
  )
  const [dutyHours, setDutyHours] = useState<DutyHours | null>(null)
  const [hotlines, setHotlines] = useState<Hotline[]>([])
  const [dutyDialogOpen, setDutyDialogOpen] = useState(false)

  // Advisory only. A failed fetch must never stop a resident sending SOS,
  // so the button stays fully enabled when this never resolves.
  useEffect(() => {
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
  }, [])

  const offDuty = dutyHours ? !dutyHours.within_duty_hours : false

  useEffect(() => {
    async function loadActive() {
      try {
        const active = await getActiveEmergency()
        if (active) {
          setTrackingAlert(active)
          if (!suppressed && isActiveAlert(active)) {
            setShellMode("tracking")
            setShellOpen(true)
          }
        }
      } catch {
        /* non-blocking */
      }
    }
    void loadActive()
  }, [suppressed])

  useEffect(() => {
    const active = isActiveAlert(trackingAlert)
    window.dispatchEvent(
      new CustomEvent("eboses:sos-active-change", { detail: { active } })
    )
  }, [trackingAlert])

  useEffect(() => {
    function handlePlacement(event: Event) {
      const nextPlacement = (event as CustomEvent<{ placement?: SosPlacement }>)
        .detail?.placement
      setPlacement(
        normalizeSosPlacement(
          nextPlacement || localStorage.getItem("eboses:sos-placement")
        )
      )
    }
    window.addEventListener("eboses:sos-placement-change", handlePlacement)
    return () =>
      window.removeEventListener("eboses:sos-placement-change", handlePlacement)
  }, [])

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
    setCheckingActive(true)
    try {
      const active = await getActiveEmergency()
      if (active && isActiveAlert(active)) {
        setTrackingAlert(active)
        setShellMode("tracking")
        setShellOpen(true)
        return
      }
      // Off-hours: advise the hotlines first, but never block the report.
      if (offDuty && hotlines.length) {
        setDutyDialogOpen(true)
        return
      }
      openWizard()
    } catch {
      openWizard()
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
    return () => {
      window.removeEventListener(
        "eboses:open-emergency-tracking",
        handleOpenEmergency
      )
      window.removeEventListener("eboses:open-sos", handleOpenSos)
    }
  }, [])

  const hasActiveEmergency = isActiveAlert(trackingAlert)

  return (
    <>
      <style>{`
        @keyframes sos-pulse {
          0%, 100% { box-shadow: 0 10px 24px rgba(248, 69, 63, 0.32); }
          50% { box-shadow: 0 10px 24px rgba(248, 69, 63, 0.32), 0 0 0 14px rgba(248, 69, 63, 0.12); }
        }
        .sos-glow { animation: sos-pulse 1.6s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .sos-glow { animation: none; }
        }
      `}</style>

      <div
        className={cn(
          "fixed z-40",
          suppressed || placement === "sidebar" ? "hidden" : "hidden lg:block",
          (placement === "inline" || placement === "compact") &&
            "lg:right-8 lg:bottom-8"
        )}
      >
        <button
          type="button"
          onClick={() => void handleSosButtonClick()}
          disabled={checkingActive}
          className={cn(
            "group flex items-center gap-2 rounded-full bg-gradient-to-b from-sos-bright to-sos py-2 pr-4 pl-2 text-white shadow-[0_10px_24px_rgba(248,69,63,0.28)] transition-all hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] disabled:cursor-wait disabled:opacity-80",
            // Amber, never disabled: the button always sends.
            offDuty && "from-amber-400 to-amber-500",
            hasActiveEmergency && "sos-glow"
          )}
          aria-label={offDuty ? "SOS (outside barangay duty hours)" : "SOS"}
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full">
            {checkingActive ? (
              <Loader2Icon className="size-5 animate-spin" />
            ) : (
              <PhoneIcon className="size-5" fill="currentColor" />
            )}
          </span>
          <span className="text-left leading-none">
            <span className="block text-lg font-extrabold tracking-wide">
              SOS
            </span>
          </span>
        </button>
      </div>

      <DutyHoursDialog
        open={dutyDialogOpen}
        hotlines={hotlines}
        dutyHours={dutyHours}
        onSendAnyway={openWizard}
        onClose={() => setDutyDialogOpen(false)}
      />

      <SosWizard
        open={!suppressed && shellOpen && shellMode === "wizard"}
        onClose={() => setShellOpen(false)}
        onSubmitted={(alert) => {
          setTrackingAlert(alert)
          setShellMode("tracking")
        }}
      />

      {/* Tracking reuses existing sheet for full lifecycle (cancel, appeal, live map) */}
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
