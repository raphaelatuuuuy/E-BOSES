import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { toast } from "sonner"
import {
  ArrowLeftIcon,
  CheckIcon,
  PhoneIcon,
  XIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { apiRequest } from "@/lib/api"
import { useAuthSession } from "@/features/auth/auth-session"
import {
  createEmergency,
  sendEmergencyChat,
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
  friendlyLocationMessage,
  SosLocationStep,
  type SosLocationValue,
} from "@/features/dashboard/components/sos/location-step"
import { SosTypeStep } from "@/features/dashboard/components/sos/type-step"
import {
  emergencies,
  emergencyOptionsFromCategories,
} from "@/features/dashboard/components/sos/emergency-catalog"
import { SosDetailsStep } from "@/features/dashboard/components/sos/details-step"
import {
  SosTriageStep,
  hasDetailQuestion,
} from "@/features/dashboard/components/sos/triage-step"
import { SosConfirmStep } from "@/features/dashboard/components/sos/confirm-step"
import { isEmergencyActive } from "@/features/dashboard/components/emergencies/lib"

// Build-time fallback only. The live number comes from the barangay's dispatch
// policy (see MapDispatchPolicy.emergency_sms_number) so it can be changed
// without rebuilding and redeploying the app.
const emergencySmsNumberFallback =
  (import.meta.env.VITE_EMERGENCY_SMS_NUMBER as string | undefined)?.trim() ?? ""
const OFFLINE_SUBMIT_ERROR =
  "You’re offline. Reconnect to send online, or use the SMS backup below."

type WizardStep = "category" | "triage" | "location" | "review" | "countdown"

const WIZARD_STEPS: WizardStep[] = [
  "category",
  "triage",
  "location",
  "review",
  "countdown",
]

const WIZARD_LABELS = ["Type", "Details", "Location", "Review"] as const
const WIZARD_STEP_COUNT = WIZARD_LABELS.length

function stepTitle(step: WizardStep) {
  if (step === "category") return "What’s the emergency?"
  if (step === "triage") return "Quick questions"
  if (step === "location") return "Confirm your location"
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
  onClose,
  title,
  subtitle,
  showBack,
  onBack,
  footer,
  resetKey,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  showBack?: boolean
  onBack?: () => void
  footer?: ReactNode
  /** Step identity — scrolls the body back to the top whenever it changes. */
  resetKey?: unknown
  children: ReactNode
}) {
  const titleId = useId()
  const subtitleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 })
  }, [resetKey])

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
    <div className="fixed inset-0 z-[400] flex items-end justify-center sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/50 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? subtitleId : undefined}
        className={cn(
          "relative z-10 flex w-full flex-col overflow-hidden border border-white/10 bg-brand-navy text-white shadow-[0_16px_48px_rgba(0,0,0,0.45)]",
          "max-h-[min(92dvh,760px)] rounded-t-[28px] sm:max-w-[440px] sm:rounded-[28px]",
          "md:max-h-[min(92dvh,820px)] md:min-h-[420px]",
          "md:w-[min(480px,92vw)] md:min-w-[420px] md:max-w-[min(720px,94vw)]",
          // CSS `resize` only works on a box that is not overflow:visible, so
          // the drag-to-resize grip forces overflow:auto on the panel itself.
          // That paints a second scrollbar down the dialog even though the body
          // below has its own scroller. Hide the panel's — the body keeps the
          // scrolling, the grip keeps working.
          "md:resize md:overflow-auto dialog-resize-grip scrollbar-hide",
          "motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-200"
        )}
      >
        <div className="flex shrink-0 items-start gap-2 px-5 pb-4 pt-5 max-sm:pt-[max(1.25rem,env(safe-area-inset-top))]">
          {showBack ? (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back"
              className="-ml-2 flex size-10 shrink-0 items-center justify-center rounded-full text-white transition-colors hover:bg-white/15"
            >
              <ArrowLeftIcon className="size-6" strokeWidth={2} />
            </button>
          ) : null}

          <div className="min-w-0 flex-1 pt-0.5">
            <p className="text-[11px] font-bold uppercase tracking-wide text-brand-orange">
              Emergency SOS
            </p>
            <h2
              id={titleId}
              className="mt-0.5 truncate text-[22px] font-bold leading-[1.2] tracking-tight text-white"
            >
              {title}
            </h2>
            {subtitle ? (
              <p
                id={subtitleId}
                className="mt-1 text-[14px] leading-snug text-white/60"
              >
                {subtitle}
              </p>
            ) : null}
          </div>

          <div className="-mr-2 flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex size-10 shrink-0 items-center justify-center rounded-full text-white transition-colors hover:bg-white/15"
            >
              <XIcon className="size-6" strokeWidth={2} />
            </button>
          </div>
        </div>

        <div
          ref={bodyRef}
          className="scrollbar-hide min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6"
        >
          {children}
        </div>

        {footer ? (
          <div className="shrink-0 px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-2">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  )
}

/**
  * SOS wizard: the step state machine (category → triage → location with
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
  const [photo, setPhoto] = useState<File | null>(null)
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

  const retryQueuedRef = useRef(retryQueuedEmergencies)

  useEffect(() => {
    retryQueuedRef.current = retryQueuedEmergencies
  })

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true)
      setSubmitError((current) =>
        current === OFFLINE_SUBMIT_ERROR ? "" : current
      )
      setStatusAnnouncement(
        "Connection restored. You can send the emergency alert online."
      )
      void retryQueuedRef.current()
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
      const needDetail = hasDetailQuestion(emergency || "")
      if (!triage.peopleAffected || !triage.injuries || (needDetail && !triage.detail)) {
        setFieldErrors({ triage: "Answer all the questions to continue." })
        return
      }
      setFieldErrors({})
      setStep("location")
      return
    }
    if (step === "location") {
      const selectedLocation = location
      if (!selectedLocation || !isSosLocationReady(selectedLocation)) {
        setFieldErrors({ location: "Choose a location on the map." })
        return
      }
      if (
        isOnline &&
        selectedLocation.locationCheck &&
        (!selectedLocation.locationCheck.accepted || !selectedLocation.locationCheck.acceptance_zone?.within)
      ) {
        setFieldErrors({
          location:
            friendlyLocationMessage(selectedLocation.locationCheck),
        })
        return
      }
      setFieldErrors({})
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
      if (photo || note.trim()) {
        await sendEmergencyChat(
          alert.id,
          note.trim() || "Photo from the moment the alert was sent.",
          photo,
        ).catch(() => {
          toast.warning("The alert was sent, but your note could not be posted to the chat.")
        })
      }
      setPhoto(null)
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
  const locationCanContinue = Boolean(
    location &&
      isSosLocationReady(location) &&
      (!isOnline || !location.locationCheck || (location.locationCheck.accepted && location.locationCheck.acceptance_zone?.within)),
  )

  const wizardFooter =
    step !== "countdown" ? (
      <div className="flex gap-2">
        {step !== "category" ? (
          <button
            type="button"
            onClick={goBack}
            className="h-[52px] flex-1 rounded-full border border-white/20 bg-white/10 text-[16px] font-semibold text-white transition-colors hover:bg-white/15"
          >
            Back
          </button>
        ) : null}
        {step === "review" && !isOnline && emergencySmsHref ? (
          <a
            href={emergencySmsHref}
            onClick={announceSmsFallback}
            className="flex h-[52px] flex-[1.4] items-center justify-center gap-2 rounded-full bg-brand-orange px-4 text-[16px] font-semibold text-white transition-colors hover:bg-brand-orange-strong"
          >
            <PhoneIcon className="size-4" aria-hidden="true" />
            SMS backup
          </a>
        ) : (
          <button
            type="button"
            onClick={goNext}
            disabled={step === "location" && !locationCanContinue}
            className={cn(
              "h-[52px] flex-[1.4] rounded-full text-[16px] font-semibold text-white transition-all active:scale-[0.99]",
              step === "review"
                ? "bg-sos hover:opacity-90"
                : "bg-brand-orange hover:bg-brand-orange-strong",
              "disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/40 disabled:active:scale-100"
            )}
          >
            {step === "review"
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
        className="h-[52px] w-full rounded-full border border-sos/50 bg-sos/15 text-[16px] font-semibold text-sos-bright transition-colors hover:bg-sos/25 disabled:opacity-60"
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
        aria-live="polite"
        aria-atomic="true"
      >
        {countdownAnnouncement}
      </div>

      <SosShell
        open={open}
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
        resetKey={step}
      >
        {step !== "countdown" ? (
          <div className="mb-5 mt-1">
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
                        done && "bg-brand-orange text-white",
                        active && "bg-white text-brand-navy",
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
          <div className="flex flex-col gap-4">
            <SosLocationStep value={location} onChange={setLocation} className="h-[min(52vh,420px)]" />
            <SosDetailsStep note={note} onNoteChange={setNote} photo={photo} onPhotoChange={setPhoto} online={isOnline} />
            {fieldErrors.location ? (
              <p
                className="text-[13px] font-medium text-sos-bright"
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
            onChange={(next) => {
              setTriage(next)
              setFieldErrors((c) => ({ ...c, triage: "" }))
            }}
            error={fieldErrors.triage}
          />
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
            photo={photo}
            submitting={submitting}
            dispatchCountdown={dispatchCountdown}
          />
        ) : null}
      </SosShell>
    </>
  )
}
