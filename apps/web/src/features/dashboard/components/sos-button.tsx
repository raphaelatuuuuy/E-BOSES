import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { toast } from "sonner"
import {
  Activity,
  ArrowLeftIcon,
  CameraIcon,
  CheckIcon,
  CloudRainWind,
  Flame,
  Loader2Icon,
  Maximize2Icon,
  Minimize2Icon,
  PhoneIcon,
  ShieldAlert,
  XIcon,
} from "lucide-react"
// Note: tracking UI lives in EmergencyTrackingSheet (dock-styled)

import { cn } from "@workspace/ui/lib/utils"
import {
  createEmergency,
  getActiveEmergency,
  getEmergency,
  type EmergencyAlert,
  type EmergencyType,
} from "@/features/dashboard/emergency-api"
import { EmergencyTrackingSheet } from "@/features/dashboard/components/emergency-tracking-sheet"
import {
  buildEmergencySmsHref,
  isSosLocationReady,
} from "@/features/dashboard/components/sos-fallback"
import {
  SosLocationStep,
  type SosLocationValue,
} from "@/features/dashboard/components/sos-location-step"

const activeEmergencyStatuses = [
  "submitted",
  "routed",
  "acknowledged",
  "en_route",
  "nearby",
  "arrived",
] as const
const emergencySmsNumber =
  (import.meta.env.VITE_EMERGENCY_SMS_NUMBER as string | undefined)?.trim() ??
  ""
const OFFLINE_SUBMIT_ERROR =
  "You’re offline. Reconnect to send online, or use the SMS backup below."
type SosPlacement = "inline" | "sidebar" | "compact"
type WizardStep = "category" | "location" | "details" | "review" | "countdown"

const WIZARD_STEPS: WizardStep[] = [
  "category",
  "location",
  "details",
  "review",
  "countdown",
]

function normalizeSosPlacement(value: string | null): SosPlacement {
  if (value === "bottom_bar") return "sidebar"
  if (value === "floating") return "inline"
  if (value === "sidebar" || value === "compact" || value === "inline")
    return value
  return "inline"
}

const emergencies = [
  {
    label: "Medical",
    value: "medical" as const,
    icon: Activity,
    desc: "Injury, illness, rescue",
    iconBg: "bg-emerald-500/20",
    iconColor: "text-emerald-400",
  },
  {
    label: "Fire",
    value: "fire" as const,
    icon: Flame,
    desc: "Building, house, residence",
    iconBg: "bg-orange-500/20",
    iconColor: "text-orange-400",
  },
  {
    label: "Crime",
    value: "crime" as const,
    icon: ShieldAlert,
    desc: "Assault, theft, threat",
    iconBg: "bg-violet-500/20",
    iconColor: "text-violet-400",
  },
  {
    label: "Disaster",
    value: "disaster" as const,
    icon: CloudRainWind,
    desc: "Flood, quake, storm",
    iconBg: "bg-blue-500/20",
    iconColor: "text-blue-400",
  },
]

function stepTitle(step: WizardStep) {
  if (step === "category") return "What’s the emergency?"
  if (step === "location") return "Confirm your location"
  if (step === "details") return "Add details (optional)"
  if (step === "review") return "Review & send"
  return "Sending alert"
}

function stepIndex(step: WizardStep) {
  return WIZARD_STEPS.indexOf(step) + 1
}

const WIZARD_LABELS = ["Type", "Location", "Details", "Review"] as const

function isActiveAlert(alert: EmergencyAlert | null) {
  return Boolean(
    alert &&
      activeEmergencyStatuses.includes(
        alert.status as (typeof activeEmergencyStatuses)[number]
      )
  )
}

function useIsDesktop() {
  const [desktop, setDesktop] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(min-width: 1024px)").matches
      : true
  )
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)")
    const apply = () => setDesktop(mq.matches)
    apply()
    mq.addEventListener("change", apply)
    return () => mq.removeEventListener("change", apply)
  }, [])
  return desktop
}

function SosShell({
  open,
  expanded,
  onExpandChange,
  onClose,
  title,
  subtitle,
  showBack,
  onBack,
  footer,
  children,
}: {
  open: boolean
  expanded: boolean
  onExpandChange: (v: boolean) => void
  onClose: () => void
  title: string
  subtitle?: string
  showBack?: boolean
  onBack?: () => void
  footer?: ReactNode
  children: ReactNode
}) {
  const isDesktop = useIsDesktop()
  const titleId = useId()
  const subtitleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    const frame = window.requestAnimationFrame(() => {
      panelRef.current
        ?.querySelector<HTMLElement>(
          "button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled])"
        )
        ?.focus()
    })
    return () => {
      window.cancelAnimationFrame(frame)
      previouslyFocused?.focus()
    }
  }, [open])

  if (typeof document === "undefined" || !open) return null

  return createPortal(
    <div className="fixed inset-0 z-[220]">
      {/* Plain dark scrim only — no blur/blue (avoids lag) */}
      <button
        type="button"
        className={cn(
          "absolute inset-0 bg-black/60",
          isDesktop && !expanded && "bg-black/45"
        )}
        aria-label="Close"
        onClick={onClose}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? subtitleId : undefined}
        className={cn(
          "z-10 flex flex-col overflow-hidden bg-[#07145f] text-white",
          // Mobile: full screen
          !isDesktop && "fixed inset-0 h-full w-full",
          // Desktop dock (chat widget)
          isDesktop &&
            !expanded &&
            "fixed right-6 bottom-6 h-[min(640px,calc(100dvh-3rem))] w-[min(400px,calc(100vw-2.5rem))] rounded-2xl border border-white/10 shadow-[0_16px_48px_rgba(0,0,0,0.45)]",
          // Desktop expanded = right sidebar (full height)
          isDesktop &&
            expanded &&
            "fixed inset-y-0 right-0 h-full w-[min(480px,100vw)] max-w-[100vw] border-l border-white/10 shadow-[-12px_0_40px_rgba(0,0,0,0.4)]"
        )}
      >
        {/* Red urgency header */}
        <header className="flex shrink-0 items-center gap-1 bg-gradient-to-r from-[#c41212] via-[#e11d2e] to-[#b91c1c] px-3 py-2.5 sm:px-4">
          {showBack ? (
            <button
              type="button"
              onClick={onBack}
              className="flex size-10 shrink-0 items-center justify-center rounded-full text-white hover:bg-white/15"
              aria-label="Back"
            >
              <ArrowLeftIcon className="size-5" strokeWidth={2.25} />
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="flex size-10 shrink-0 items-center justify-center rounded-full text-white hover:bg-white/15"
              aria-label="Close"
            >
              <XIcon className="size-5" />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-bold tracking-wide text-white/80 uppercase">
              Emergency SOS
            </p>
            <p
              id={titleId}
              className="truncate text-[15px] font-semibold text-white"
            >
              {title}
            </p>
            {subtitle ? (
              <p id={subtitleId} className="truncate text-[12px] text-white/75">
                {subtitle}
              </p>
            ) : null}
          </div>
          {isDesktop ? (
            <button
              type="button"
              onClick={() => onExpandChange(!expanded)}
              className="flex size-10 shrink-0 items-center justify-center rounded-full text-white hover:bg-white/15"
              aria-label={expanded ? "Collapse panel" : "Expand panel"}
            >
              {expanded ? (
                <Minimize2Icon className="size-4" />
              ) : (
                <Maximize2Icon className="size-4" />
              )}
            </button>
          ) : null}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[#07145f] px-4 py-4 sm:px-5">
          {children}
        </div>

        {footer ? (
          <div className="shrink-0 border-t border-white/10 bg-[#050e45] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  )
}

export function SOSButton({ suppressed = false }: { suppressed?: boolean }) {
  const [placement, setPlacement] = useState<SosPlacement>(() =>
    normalizeSosPlacement(localStorage.getItem("eboses:sos-placement"))
  )
  const [shellOpen, setShellOpen] = useState(false)
  const [shellMode, setShellMode] = useState<"wizard" | "tracking">("wizard")
  const [expanded, setExpanded] = useState(false)
  const [step, setStep] = useState<WizardStep>("category")
  const [emergency, setEmergency] = useState<EmergencyType | "">("")
  const [note, setNote] = useState("")
  const [location, setLocation] = useState<SosLocationValue | null>(null)
  const [mediaFiles, setMediaFiles] = useState<File[]>([])
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [checkingActive, setCheckingActive] = useState(false)
  const [dispatchCountdown, setDispatchCountdown] = useState(5)
  const [trackingAlert, setTrackingAlert] = useState<EmergencyAlert | null>(
    null
  )
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine
  )
  const [statusAnnouncement, setStatusAnnouncement] = useState("")
  const clientRequestIdRef = useRef(crypto.randomUUID())
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true)
      setSubmitError((current) =>
        current === OFFLINE_SUBMIT_ERROR ? "" : current
      )
      setStatusAnnouncement(
        "Connection restored. You can send the emergency alert online."
      )
    }
    const handleOffline = () => {
      setIsOnline(false)
      setStatusAnnouncement(
        "You are offline. Your SOS details are saved on this screen."
      )
    }
    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)
    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [])

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
      resetWizard()
      setShellMode("wizard")
      setShellOpen(true)
    } catch {
      resetWizard()
      setShellMode("wizard")
      setShellOpen(true)
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

  function resetWizard() {
    clientRequestIdRef.current = crypto.randomUUID()
    setStep("category")
    setEmergency("")
    setNote("")
    setLocation(null)
    setMediaFiles([])
    setFieldErrors({})
    setSubmitError("")
    setDispatchCountdown(5)
    setSubmitting(false)
  }

  function closeShell() {
    if (step === "countdown") {
      if (submitting) {
        setStatusAnnouncement(
          "The emergency alert is already sending and can no longer be cancelled here."
        )
        return
      }
      setStep("review")
      setDispatchCountdown(5)
      setStatusAnnouncement(
        "Emergency alert cancelled before sending. Your details are still available."
      )
      toast.info("Alert cancelled before sending.")
      return
    }
    setShellOpen(false)
    setExpanded(false)
    if (shellMode === "wizard") resetWizard()
  }

  function goBack() {
    if (shellMode === "tracking") {
      setShellOpen(false)
      return
    }
    if (step === "countdown") {
      if (submitting) return
      setStep("review")
      setDispatchCountdown(5)
      return
    }
    const idx = WIZARD_STEPS.indexOf(step)
    if (idx <= 0) {
      closeShell()
      return
    }
    setStep(WIZARD_STEPS[idx - 1]!)
  }

  function goNext() {
    if (step === "category") {
      if (!emergency) {
        setFieldErrors({ type: "Select the emergency type." })
        return
      }
      setFieldErrors({})
      setStep("location")
      return
    }
    if (step === "location") {
      if (!isSosLocationReady(location)) {
        setFieldErrors({ location: "Confirm a street location on the map." })
        return
      }
      setFieldErrors({})
      setStep("details")
      return
    }
    if (step === "details") {
      setStep("review")
      return
    }
    if (step === "review") {
      if (!isOnline) {
        setSubmitError(OFFLINE_SUBMIT_ERROR)
        setStatusAnnouncement(OFFLINE_SUBMIT_ERROR)
        return
      }
      setSubmitError("")
      setDispatchCountdown(5)
      setStep("countdown")
    }
  }

  function handleMediaSelection(files: FileList | null) {
    if (!files) return
    const selected = Array.from(files).slice(0, 2)
    const invalid = selected.find(
      (file) =>
        !["image/jpeg", "image/png"].includes(file.type) ||
        file.size > 2 * 1024 * 1024
    )
    if (invalid) {
      setMediaFiles([])
      setFieldErrors((c) => ({
        ...c,
        media: `${invalid.name}: use JPG/PNG up to 2 MB.`,
      }))
      return
    }
    setMediaFiles(selected)
    setFieldErrors((c) => ({ ...c, media: "" }))
  }

  async function submitEmergency() {
    if (!location || !emergency) return
    if (!navigator.onLine) {
      setIsOnline(false)
      setStep("review")
      setSubmitError(OFFLINE_SUBMIT_ERROR)
      setStatusAnnouncement(OFFLINE_SUBMIT_ERROR)
      setDispatchCountdown(5)
      return
    }
    setSubmitError("")
    setSubmitting(true)
    setStatusAnnouncement("Sending the emergency alert now.")
    try {
      const formData = new FormData()
      formData.append("client_request_id", clientRequestIdRef.current)
      formData.append("type", emergency)
      formData.append("note", note)
      formData.append("latitude", location.lat.toFixed(7))
      formData.append("longitude", location.lng.toFixed(7))
      formData.append(
        "location_source",
        location.source === "gps" ? "gps" : "manual_pin"
      )
      if (location.accuracy != null)
        formData.append("location_accuracy", String(location.accuracy))
      const addr = location.address || location.addressPrimary
      formData.append("address", addr.slice(0, 255))
      for (const file of mediaFiles) formData.append("media", file)

      const alert = await createEmergency(formData)
      setTrackingAlert(alert)
      setShellMode("tracking")
      resetWizard()
      setStatusAnnouncement(
        "Emergency alert sent. Responder routing has started."
      )
      toast.success("Emergency alert sent")
      if (alert.media_warnings?.length) toast.warning(alert.media_warnings[0])
    } catch (error) {
      try {
        const active = await getActiveEmergency()
        if (active && isActiveAlert(active)) {
          setTrackingAlert(active)
          setShellMode("tracking")
          resetWizard()
          toast.info("Your active emergency is already open.")
          return
        }
      } catch {
        /* keep error */
      }
      setStep("review")
      const message =
        error instanceof Error
          ? error.message
          : "Could not send emergency alert."
      setSubmitError(message)
      setStatusAnnouncement(`Emergency alert was not sent. ${message}`)
      toast.error(message)
    } finally {
      setSubmitting(false)
      setDispatchCountdown(5)
    }
  }

  useEffect(() => {
    if (step !== "countdown") return
    const t = window.setTimeout(
      () => {
        if (dispatchCountdown <= 0) {
          void submitEmergency()
          return
        }
        setDispatchCountdown((current) => current - 1)
      },
      dispatchCountdown <= 0 ? 0 : 1000
    )
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, dispatchCountdown])

  const hasActiveEmergency = isActiveAlert(trackingAlert)
  const typeMeta = emergencies.find((e) => e.value === emergency)
  const smsBody = location
    ? [
        `E-BOSES SOS: ${typeMeta?.label ?? "Emergency"}`,
        `Location: ${location.addressPrimary || location.address || `${location.lat.toFixed(7)}, ${location.lng.toFixed(7)}`}`,
        `Coordinates: ${location.lat.toFixed(7)}, ${location.lng.toFixed(7)}`,
        note.trim() ? `Details: ${note.trim()}` : "",
      ]
        .filter(Boolean)
        .join(". ")
    : ""
  const emergencySmsHref = buildEmergencySmsHref(emergencySmsNumber, smsBody)
  const countdownAnnouncement =
    step === "countdown"
      ? submitting
        ? "Sending the emergency alert now. It can no longer be cancelled from this screen."
        : `Emergency alert will send in ${dispatchCountdown} ${dispatchCountdown === 1 ? "second" : "seconds"}. Activate Cancel before send to stop it.`
      : ""

  function announceSmsFallback() {
    setStatusAnnouncement(
      "Opening your SMS app with a draft. E-Boses cannot confirm delivery; review the message and activate Send."
    )
  }

  const wizardFooter =
    shellMode === "wizard" && step !== "countdown" ? (
      <div className="flex gap-2">
        {step !== "category" ? (
          <button
            type="button"
            onClick={goBack}
            className="h-11 flex-1 rounded-full border border-white/20 bg-white/10 text-[14px] font-semibold text-white hover:bg-white/15"
          >
            Back
          </button>
        ) : null}
        {step === "review" && !isOnline ? (
          emergencySmsHref ? (
            <a
              href={emergencySmsHref}
              onClick={announceSmsFallback}
              className="flex h-11 flex-[1.4] items-center justify-center gap-2 rounded-full bg-[#ff6a1a] px-4 text-[14px] font-semibold text-white hover:bg-[#e85f17]"
            >
              <PhoneIcon className="size-4" aria-hidden="true" />
              Open SMS backup
            </a>
          ) : (
            <button
              type="button"
              disabled
              className="h-11 flex-[1.4] rounded-full bg-white/15 px-4 text-[14px] font-semibold text-white/60"
            >
              Reconnect to submit
            </button>
          )
        ) : (
          <button
            type="button"
            onClick={goNext}
            className="h-11 flex-[1.4] rounded-full bg-[#ff6a1a] text-[14px] font-semibold text-white hover:bg-[#e85f17]"
          >
            {step === "details"
              ? "Skip / Next"
              : step === "review"
                ? "Send SOS in 5 seconds"
                : "Next"}
          </button>
        )}
      </div>
    ) : shellMode === "wizard" && step === "countdown" ? (
      <button
        type="button"
        onClick={() => {
          setStep("review")
          setDispatchCountdown(5)
          setStatusAnnouncement(
            "Emergency alert cancelled before sending. Your details are still available."
          )
          toast.info("Alert cancelled before sending.")
        }}
        disabled={submitting}
        className="h-11 w-full rounded-full border border-white/25 bg-white text-[14px] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
      >
        {submitting ? "Sending…" : "Cancel before send"}
      </button>
    ) : null

  return (
    <>
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {statusAnnouncement}
      </div>
      <div
        className="sr-only"
        role="status"
        aria-live="assertive"
        aria-atomic="true"
      >
        {countdownAnnouncement}
      </div>
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
            "group flex items-center gap-2 rounded-full bg-gradient-to-b from-[#ff625a] to-[#f23b35] py-2 pr-4 pl-2 text-white shadow-[0_10px_24px_rgba(248,69,63,0.28)] transition-all hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] disabled:cursor-wait disabled:opacity-80",
            hasActiveEmergency && "sos-glow"
          )}
          aria-label="SOS"
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

      <SosShell
        open={!suppressed && shellOpen && shellMode === "wizard"}
        expanded={expanded}
        onExpandChange={setExpanded}
        onClose={closeShell}
        title={stepTitle(step)}
        subtitle={
          step === "countdown"
            ? "Tap cancel if this was accidental"
            : `Step ${Math.min(stepIndex(step), 4)} of 4 · Emergency SOS`
        }
        showBack={step !== "category" && step !== "countdown"}
        onBack={goBack}
        footer={wizardFooter}
      >
        {step !== "countdown" ? (
          <div className="mb-5">
            <div className="mb-3 flex items-center justify-between gap-1">
              {WIZARD_LABELS.map((label, i) => {
                const n = i + 1
                const current = Math.min(stepIndex(step), 4)
                const done = n < current
                const active = n === current
                return (
                  <div
                    key={label}
                    className="flex min-w-0 flex-1 flex-col items-center gap-1.5"
                  >
                    <span
                      className={cn(
                        "flex size-7 items-center justify-center rounded-full text-[11px] font-bold",
                        done && "bg-emerald-500 text-white",
                        active &&
                          "bg-[#ff6a1a] text-white shadow-[0_0_0_3px_rgba(255,106,26,0.28)]",
                        !done &&
                          !active &&
                          "border border-white/25 bg-transparent text-white/45"
                      )}
                    >
                      {done ? (
                        <CheckIcon className="size-3.5" strokeWidth={3} />
                      ) : (
                        n
                      )}
                    </span>
                    <span
                      className={cn(
                        "truncate text-[10px] font-semibold",
                        active
                          ? "text-white"
                          : done
                            ? "text-white/70"
                            : "text-white/40"
                      )}
                    >
                      {label}
                    </span>
                  </div>
                )
              })}
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full rounded-full bg-[#ff6a1a] transition-all duration-300"
                style={{
                  width: `${(Math.min(stepIndex(step), 4) / 4) * 100}%`,
                }}
              />
            </div>
          </div>
        ) : null}

        {step === "category" ? (
          <div className="space-y-3">
            <p className="text-[14px] leading-6 text-white/75">
              Pick the closest match. Barangay responders will verify before
              dispatch.
            </p>
            <div className="space-y-2">
              {emergencies.map((item) => {
                const selected = emergency === item.value
                const Icon = item.icon
                return (
                  <button
                    key={item.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      setEmergency(item.value)
                      setFieldErrors((c) => ({ ...c, type: "" }))
                    }}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl border px-3.5 py-3.5 text-left transition-colors",
                      selected
                        ? "border-[#ff6a1a] bg-white/15 ring-1 ring-[#ff6a1a]/50"
                        : "border-white/15 bg-white/5 hover:bg-white/10"
                    )}
                  >
                    <Icon
                      className={cn("size-11 shrink-0 rounded-lg p-2", item.iconBg, item.iconColor)}
                      strokeWidth={2}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-semibold text-white">
                        {item.label}
                      </span>
                      <span className="mt-0.5 block text-[13px] text-white/60">
                        {item.desc}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-full border",
                        selected
                          ? "border-[#ff6a1a] bg-[#ff6a1a] text-white"
                          : "border-white/30 bg-transparent"
                      )}
                    >
                      {selected ? (
                        <CheckIcon className="size-3.5" strokeWidth={3} />
                      ) : null}
                    </span>
                  </button>
                )
              })}
            </div>
            {fieldErrors.type ? (
              <p className="text-[13px] font-medium text-red-300" role="alert">
                {fieldErrors.type}
              </p>
            ) : null}
          </div>
        ) : null}

        {step === "location" ? (
          <div className="flex min-h-[360px] flex-col">
            <p className="mb-3 text-[14px] leading-6 text-white/75">
               Drag the map so help goes to the right pin.
            </p>
            <SosLocationStep
              value={location}
              onChange={setLocation}
              className="min-h-[280px]"
            />
            {fieldErrors.location ? (
              <p
                className="mt-2 text-[13px] font-medium text-red-300"
                role="alert"
              >
                {fieldErrors.location}
              </p>
            ) : null}
          </div>
        ) : null}

        {step === "details" ? (
          <div className="space-y-4">
            <p className="text-[14px] leading-6 text-white/75">
              A photo or note helps responders prepare.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png"
              multiple
              className="hidden"
              onChange={(e) => handleMediaSelection(e.target.files)}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 text-[14px] font-semibold text-white hover:bg-white/15"
            >
              <CameraIcon className="size-4" />
              {mediaFiles.length
                ? `${mediaFiles.length} photo(s) selected`
                : "Add photo"}
            </button>
            {mediaFiles.length ? (
              <div className="flex flex-wrap gap-2">
                {mediaFiles.map((file) => (
                  <span
                    key={file.name}
                    className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[12px] font-medium text-white/90"
                  >
                    {file.name}
                  </span>
                ))}
                <button
                  type="button"
                  onClick={() => setMediaFiles([])}
                  className="text-[12px] font-semibold text-white/60 underline"
                >
                  Clear
                </button>
              </div>
            ) : null}
            {fieldErrors.media ? (
              <p className="text-[13px] font-medium text-red-300" role="alert">
                {fieldErrors.media}
              </p>
            ) : null}
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Quick note for responders"
              rows={4}
              className="w-full resize-none rounded-xl border border-white/15 bg-black/25 px-3.5 py-3 text-[14px] text-white outline-none placeholder:text-white/40 focus:border-[#ff6a1a]"
            />
          </div>
        ) : null}

        {step === "review" ? (
          <div className="space-y-3">
            {!isOnline ? (
              <div
                className="rounded-xl border border-amber-300/60 bg-amber-400/15 p-4 text-amber-50"
                role="status"
                aria-live="polite"
              >
                <p className="text-[14px] font-semibold">You’re offline</p>
                <p className="mt-1 text-[13px] leading-5 text-amber-50/80">
                  Your entries remain on this screen. Reconnect to use online
                  responder routing
                  {emergencySmsHref ? ", or open the SMS backup below." : "."}
                </p>
                {!emergencySmsHref ? (
                  <p className="mt-2 text-[12px] leading-5 text-white/65">
                    SMS backup is not configured on this device. If anyone is in
                    immediate danger, call your local emergency number.
                  </p>
                ) : (
                  <p className="mt-2 text-[12px] leading-5 text-white/65">
                    Opening SMS creates a draft only. Review it and press Send
                    in your phone’s messaging app.
                  </p>
                )}
              </div>
            ) : null}
            {submitError ? (
              <div
                className="rounded-xl border border-red-400/50 bg-red-500/15 p-4"
                role="alert"
              >
                <p className="text-[14px] font-semibold text-red-100">
                  Alert was not sent
                </p>
                <p className="mt-1 text-[13px] leading-5 text-red-100/80">
                  {submitError}
                </p>
                <p className="mt-2 text-[12px] leading-5 text-white/65">
                  Check your connection and try again. Your details are still
                  here.
                </p>
                {emergencySmsHref ? (
                  <a
                    href={emergencySmsHref}
                    onClick={announceSmsFallback}
                    className="mt-3 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-white px-3.5 text-[13px] font-bold text-[#050e45] hover:bg-white/90"
                  >
                    <PhoneIcon className="size-4" />
                    Open SMS backup
                  </a>
                ) : null}
                {emergencySmsHref ? (
                  <p className="mt-2 text-[11px] leading-4 text-white/55">
                    This opens your phone’s SMS app. Review the message and
                    press send.
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className="rounded-xl border border-white/15 bg-white/10 p-4">
              <p className="text-[11px] font-semibold tracking-wide text-white/55 uppercase">
                Emergency type
              </p>
              <p className="mt-1 text-[15px] font-semibold text-white">
                {typeMeta?.label ?? "—"}
              </p>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/10 p-4">
              <p className="text-[11px] font-semibold tracking-wide text-white/55 uppercase">
                Location
              </p>
              <p className="mt-1 text-[15px] font-semibold text-white">
                {location?.addressPrimary || location?.address || "—"}
              </p>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/10 p-4">
              <p className="text-[11px] font-semibold tracking-wide text-white/55 uppercase">
                Evidence
              </p>
              <p className="mt-1 text-[15px] font-semibold text-white">
                {mediaFiles.length ? `${mediaFiles.length} photo(s)` : "None"}
              </p>
              {note.trim() ? (
                <p className="mt-2 text-[14px] leading-6 text-white/75">
                  {note.trim()}
                </p>
              ) : null}
            </div>
            <div className="rounded-xl border border-amber-400/40 bg-amber-500/15 px-4 py-3 text-[13px] leading-5 text-amber-100">
              False or misleading alerts are logged. Repeated abuse can suspend
              your account. Accidental alerts can be cancelled afterward with a
              reason.
            </div>
          </div>
        ) : null}

        {step === "countdown" ? (
          <div className="flex min-h-[320px] flex-col items-center justify-center px-4 text-center">
            <div className="relative flex size-36 items-center justify-center">
              <span className="absolute inset-0 rounded-full bg-red-500/15" />
              <span className="absolute inset-3 rounded-full bg-red-500/20" />
              <p
                className="relative text-6xl font-black text-red-300 tabular-nums"
                aria-hidden="true"
              >
                {submitting ? "…" : dispatchCountdown}
              </p>
            </div>
            <p className="mt-5 text-[12px] font-bold tracking-wide text-white/55 uppercase">
              {submitting ? "Sending alert…" : "Broadcasting in"}
            </p>
            <p className="mt-2 max-w-xs text-[15px] font-medium text-white">
              Tap cancel if you sent this by accident.
            </p>
            <div className="mt-6 w-full max-w-xs rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-left text-[12px] text-white/70">
              <p>
                <span className="font-semibold text-white">
                  {typeMeta?.label ?? "Emergency"}
                </span>
                {" · "}
                {location?.addressPrimary ||
                  location?.address ||
                  "Pinned location"}
              </p>
              <p className="mt-1 text-white/45">
                After sending, cancellation requires a reason.
              </p>
            </div>
          </div>
        ) : null}
      </SosShell>

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