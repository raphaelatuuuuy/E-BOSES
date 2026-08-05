import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { toast } from "sonner"
import {
  ArrowLeftIcon,
  CheckIcon,
  Maximize2Icon,
  Minimize2Icon,
  PhoneIcon,
  XIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { apiRequest } from "@/lib/api"
import { useAuthSession } from "@/features/auth/auth-session"
import { useIsDesktop } from "@/features/dashboard/lib/shell"
import {
  createEmergency,
  getActiveEmergency,
  listEmergencyCategories,
  type EmergencyAlert,
  type EmergencyCategory,
  type EmergencyType,
} from "@/features/dashboard/emergency-api"
import {
  buildEmergencySmsHref,
  buildEmergencySmsMessage,
  describeTriage,
  deleteQueuedSosEmergency,
  enqueueSosEmergency,
  isSosLocationReady,
  listQueuedSosEmergencies,
  toServerTriage,
  type SosTriageAnswers,
} from "@/features/dashboard/components/sos-fallback"
import {
  SosLocationStep,
  type SosLocationValue,
} from "@/features/dashboard/components/sos/location-step"
import { emergencies, emergencyOptionsFromCategories, SosTypeStep } from "@/features/dashboard/components/sos/type-step"
import { SosDetailsStep } from "@/features/dashboard/components/sos/details-step"
import { SosTriageStep } from "@/features/dashboard/components/sos/triage-step"
import { SosConfirmStep } from "@/features/dashboard/components/sos/confirm-step"
import { isEmergencyActive } from "@/features/dashboard/components/emergencies/lib"

// Build-time fallback only. The live number comes from the barangay's dispatch
// policy (see MapDispatchPolicy.emergency_sms_number) so it can be changed
// without rebuilding and redeploying the app.
const emergencySmsNumberFallback =
  (import.meta.env.VITE_EMERGENCY_SMS_NUMBER as string | undefined)?.trim() ?? ""
const OFFLINE_SUBMIT_ERROR =
  "You’re offline. Reconnect to send online, or use the SMS backup below."

type WizardStep = "category" | "triage" | "location" | "details" | "review" | "countdown"

const WIZARD_STEPS: WizardStep[] = [
  "category",
  "triage",
  "location",
  "details",
  "review",
  "countdown",
]

const WIZARD_LABELS = ["Type", "Details", "Location", "Note", "Review"] as const
const WIZARD_STEP_COUNT = WIZARD_LABELS.length

function stepTitle(step: WizardStep) {
  if (step === "category") return "What’s the emergency?"
  if (step === "triage") return "Quick questions"
  if (step === "location") return "Confirm your location"
  if (step === "details") return "Anything else? (optional)"
  if (step === "review") return "Review & send"
  return "Sending alert"
}

function stepIndex(step: WizardStep) {
  return WIZARD_STEPS.indexOf(step) + 1
}

function isActiveAlert(alert: EmergencyAlert | null) {
  return Boolean(alert && isEmergencyActive(alert.status))
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
          "z-10 flex flex-col overflow-hidden bg-brand-navy text-white",
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
        {/* Red urgency header — full-screen mobile gets top safe-area padding (notch/status bar) */}
        <header
          className={cn(
            "flex shrink-0 items-center gap-1 bg-gradient-to-r from-[#c41212] via-[#e11d2e] to-[#b91c1c] px-3 sm:px-4",
            !isDesktop
              ? "pt-[max(0.625rem,env(safe-area-inset-top))] pb-2.5"
              : "py-2.5"
          )}
        >
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

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-brand-navy px-4 py-4 sm:px-5">
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

/**
 * SOS wizard: the step state machine (category → location → details →
 * review → countdown) + shell UI. FAB and open/close orchestration between
 * wizard/tracking modes lives one level up in sos-button.tsx; this component
 * owns everything about the wizard itself and resets its own state whenever
 * it is closed (mirrors the previous resetWizard() calls on close/reopen).
 */
export function SosWizard({
  open,
  onClose,
  onSubmitted,
}: {
  open: boolean
  onClose: () => void
  onSubmitted: (alert: EmergencyAlert) => void
}) {
  const { user } = useAuthSession()
  const [expanded, setExpanded] = useState(false)
  const [step, setStep] = useState<WizardStep>("category")
  // Fetched once when the wizard opens. Failure is silent on purpose: the
  // SMS fallback is a nicety, and an unreachable API must never block the
  // resident from sending the online SOS.
  const [emergencySmsNumber, setEmergencySmsNumber] = useState("")
  const [emergencyCategories, setEmergencyCategories] = useState<EmergencyCategory[]>([])
  useEffect(() => {
    let cancelled = false
    void apiRequest<{ emergency_sms_number?: string }>("/locations/map-context/")
      .then((context) => {
        if (!cancelled) setEmergencySmsNumber((context.emergency_sms_number || "").trim())
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  useEffect(() => {
    if (!open) return
    let cancelled = false
    void listEmergencyCategories()
      .then((items) => {
        if (!cancelled) setEmergencyCategories(items)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [open])
  const [emergency, setEmergency] = useState<EmergencyType | "">("")
  const [note, setNote] = useState("")
  const [location, setLocation] = useState<SosLocationValue | null>(null)
  const [triage, setTriage] = useState<SosTriageAnswers>({})
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [dispatchCountdown, setDispatchCountdown] = useState(5)
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine
  )
  const [statusAnnouncement, setStatusAnnouncement] = useState("")
  const clientRequestIdRef = useRef(crypto.randomUUID())

  function buildEmergencyFormData(payload: {
    clientRequestId: string
    type: EmergencyType | string
    note: string
    latitude: number
    longitude: number
    address: string
    locationSource: "gps" | "manual_pin" | "network" | "sms" | "sms_landmark"
    locationAccuracy: number | null
    triage: SosTriageAnswers
  }) {
    const formData = new FormData()
    formData.append("client_request_id", payload.clientRequestId)
    formData.append("type", payload.type)
    formData.append("note", payload.note)
    formData.append("latitude", payload.latitude.toFixed(7))
    formData.append("longitude", payload.longitude.toFixed(7))
    formData.append("location_source", payload.locationSource)
    if (payload.locationAccuracy != null) formData.append("location_accuracy", String(payload.locationAccuracy))
    formData.append("address", payload.address.slice(0, 255))
    if (Object.keys(payload.triage).length) {
      formData.append("triage", JSON.stringify(toServerTriage(payload.triage)))
    }
    return formData
  }

  async function retryQueuedEmergencies() {
    if (!navigator.onLine) return
    const queued = await listQueuedSosEmergencies().catch(() => [])
    for (const item of queued) {
      if (item.smsFallbackOpenedAt) continue
      try {
        const alert = await createEmergency(
          buildEmergencyFormData({
            clientRequestId: item.clientRequestId,
            type: item.type,
            note: item.note,
            latitude: item.latitude,
            longitude: item.longitude,
            address: item.address,
            locationSource: item.locationSource,
            locationAccuracy: item.locationAccuracy,
            triage: item.triage ?? {},
          }),
        )
        await deleteQueuedSosEmergency(item.id)
        toast.success("Queued emergency sent")
        onSubmitted(alert)
        break
      } catch {
        /* retry later */
      }
    }
  }

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true)
      setSubmitError((current) =>
        current === OFFLINE_SUBMIT_ERROR ? "" : current
      )
      setStatusAnnouncement(
        "Connection restored. You can send the emergency alert online."
      )
      void retryQueuedEmergencies()
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
    if (open) void retryQueuedEmergencies()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function resetWizard() {
    clientRequestIdRef.current = crypto.randomUUID()
    setStep("category")
    setEmergency("")
    setNote("")
    setLocation(null)
    setTriage({})
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
    setExpanded(false)
    resetWizard()
    onClose()
  }

  function goBack() {
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
      setStep("triage")
      return
    }
    if (step === "triage") {
      // Every triage question is optional; nothing blocks here.
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

  async function submitEmergency() {
    if (!location || !emergency) return
    if (!navigator.onLine) {
      setIsOnline(false)
      setStep("review")
      setSubmitError(OFFLINE_SUBMIT_ERROR)
      setStatusAnnouncement(OFFLINE_SUBMIT_ERROR)
      setDispatchCountdown(5)
      await enqueueCurrentEmergency().catch(() => {})
      return
    }
    setSubmitError("")
    setSubmitting(true)
    setStatusAnnouncement("Sending the emergency alert now.")
    try {
      const addr = location.address || location.addressPrimary
      const formData = buildEmergencyFormData({
        clientRequestId: clientRequestIdRef.current,
        type: emergency,
        note,
        latitude: location.lat,
        longitude: location.lng,
        locationSource: location.source === "gps" ? "gps" : "manual_pin",
        locationAccuracy: location.accuracy ?? null,
        address: addr,
        triage,
      })

      const alert = await createEmergency(formData)
      resetWizard()
      setStatusAnnouncement(
        "Emergency alert sent. Responder routing has started."
      )
      toast.success("Emergency alert sent")
      if (alert.media_warnings?.length) toast.warning(alert.media_warnings[0])
      onSubmitted(alert)
    } catch (error) {
      try {
        const active = await getActiveEmergency()
        if (active && isActiveAlert(active)) {
          resetWizard()
          toast.info("Your active emergency is already open.")
          onSubmitted(active)
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
      try {
        await enqueueCurrentEmergency()
        setStatusAnnouncement("Emergency queued. E-Boses will retry when connection returns.")
        toast.info("Emergency queued for retry")
      } catch {
        toast.warning("Could not save the SOS queue on this browser.")
      }
    } finally {
      setSubmitting(false)
      setDispatchCountdown(5)
    }
  }

  async function enqueueCurrentEmergency(extra: { smsFallbackOpenedAt?: string } = {}) {
    if (!location || !emergency) return
    await enqueueSosEmergency({
      id: clientRequestIdRef.current,
      clientRequestId: clientRequestIdRef.current,
      userId: user?.id ?? null,
      type: emergency,
      note,
      latitude: location.lat,
      longitude: location.lng,
      address: location.address || location.addressPrimary,
      locationSource: location.source === "gps" ? "gps" : "manual_pin",
      locationAccuracy: location.accuracy ?? null,
      triage,
      createdAt: new Date().toISOString(),
      retryCount: 0,
      ...extra,
    })
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

  const emergencyOptions = emergencyCategories.length ? emergencyOptionsFromCategories(emergencyCategories) : emergencies
  const typeMeta = emergencyOptions.find((e) => e.value === emergency)
  // Built even without a map fix: an emergency with only a described area is
  // still a valid SMS, and the backend saves and routes it.
  const smsBody = buildEmergencySmsMessage({
    emergencyType: typeMeta?.label ?? (emergency || "Other Emergency"),
    readableArea: location?.addressPrimary || location?.address || "",
    latitude: location?.lat ?? null,
    longitude: location?.lng ?? null,
    triage,
    note,
  })
  const emergencySmsHref = buildEmergencySmsHref(
    emergencySmsNumber || emergencySmsNumberFallback,
    smsBody,
  )
  const countdownAnnouncement =
    step === "countdown"
      ? submitting
        ? "Sending the emergency alert now. It can no longer be cancelled from this screen."
        : `Emergency alert will send in ${dispatchCountdown} ${dispatchCountdown === 1 ? "second" : "seconds"}. Activate Cancel before send to stop it.`
      : ""

  function announceSmsFallback() {
    void enqueueCurrentEmergency({ smsFallbackOpenedAt: new Date().toISOString() }).catch(() => {})
    setStatusAnnouncement(
      "Opening your SMS app with a draft. E-Boses cannot confirm delivery; review the message and activate Send."
    )
  }

  const locationLabel = location?.addressPrimary || location?.address

  const wizardFooter =
    step !== "countdown" ? (
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
        {step === "review" && !isOnline && emergencySmsHref ? (
          <a
            href={emergencySmsHref}
            onClick={announceSmsFallback}
            className="flex h-11 flex-[1.4] items-center justify-center gap-2 rounded-full bg-brand-orange px-4 text-[14px] font-semibold text-white hover:bg-[#e85f17]"
          >
            <PhoneIcon className="size-4" aria-hidden="true" />
            SMS backup
          </a>
        ) : (
          <button
            type="button"
            onClick={goNext}
            className="h-11 flex-[1.4] rounded-full bg-brand-orange text-[14px] font-semibold text-white hover:bg-[#e85f17]"
          >
            {step === "details"
              ? "Skip / Next"
              : step === "review"
                ? "Send SOS in 5 seconds"
                : "Next"}
          </button>
        )}
      </div>
    ) : (
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
    )

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

      <SosShell
        open={open}
        expanded={expanded}
        onExpandChange={setExpanded}
        onClose={closeShell}
        title={stepTitle(step)}
        subtitle={
          step === "countdown"
            ? "Tap cancel if this was accidental"
            : `Step ${Math.min(stepIndex(step), WIZARD_STEP_COUNT)} of 4 · Emergency SOS`
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
                const current = Math.min(stepIndex(step), WIZARD_STEP_COUNT)
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
                          "bg-brand-orange text-white shadow-[0_0_0_3px_rgba(255,106,26,0.28)]",
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
                className="h-full rounded-full bg-brand-orange transition-all duration-300"
                style={{
                  width: `${(Math.min(stepIndex(step), WIZARD_STEP_COUNT) / WIZARD_STEP_COUNT) * 100}%`,
                }}
              />
            </div>
          </div>
        ) : null}

        {step === "category" ? (
          <SosTypeStep
            value={emergency}
            onSelect={(next) => {
              setEmergency(next)
              setFieldErrors((c) => ({ ...c, type: "" }))
            }}
            error={fieldErrors.type}
            options={emergencyOptions}
          />
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

        {step === "triage" ? (
          <SosTriageStep
            categoryCode={emergency || ""}
            value={triage}
            onChange={setTriage}
          />
        ) : null}

        {step === "details" ? (
          <SosDetailsStep note={note} onNoteChange={setNote} />
        ) : null}

        {step === "review" || step === "countdown" ? (
          <SosConfirmStep
            mode={step}
            isOnline={isOnline}
            submitError={submitError}
            emergencySmsHref={emergencySmsHref}
            onSmsFallbackClick={announceSmsFallback}
            typeLabel={typeMeta?.label}
            locationLabel={locationLabel}
            triageSummary={describeTriage(triage)}
            note={note}
            submitting={submitting}
            dispatchCountdown={dispatchCountdown}
          />
        ) : null}
      </SosShell>
    </>
  )
}
