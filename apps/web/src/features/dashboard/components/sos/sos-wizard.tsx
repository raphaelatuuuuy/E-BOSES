import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from "react"
import { toast } from "sonner"
import { ArrowLeftIcon } from "lucide-react"
import { ApiError } from "@/lib/api"
import { SosTakeover } from "@/features/dashboard/components/sos/sos-takeover"
import { canSendSms, openSmsApp, sendSmsText } from "@/lib/native-sms-inbox"
import {
  normalizeSmsRecipient,
  smsBodyTooLong,
} from "@/lib/sms-recipient"

import { cn } from "@workspace/ui/lib/utils"
import { useAuthSession } from "@/features/auth/auth-session"
import {
  checkEmergencyMedia,
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
  acceptedSosLocation,
  friendlyLocationMessage,
  SosLocationStep,
  type SosLocationValue,
} from "@/features/dashboard/components/sos/location-step"
import { SosTypeStep } from "@/features/dashboard/components/sos/type-step"
import {
  emergencies,
  emergencyOptionsFromCategories,
} from "@/features/dashboard/components/sos/emergency-catalog"
import {
  SosDetailsStep,
  SOS_MAX_FILES,
  sosPhotoError,
} from "@/features/dashboard/components/sos/details-step"
import {
  SosTriageStep,
  hasUnansweredQuestions,
  questionsForCategory,
} from "@/features/dashboard/components/sos/triage-step"
import { SosConfirmStep } from "@/features/dashboard/components/sos/confirm-step"
import { isEmergencyActive } from "@/features/dashboard/components/emergencies/lib"
import {
  offlineCategoriesFromConfig,
  refreshOfflineSosConfig,
  checkOfflineSosBundleUpdate,
  SOS_SMS_NUMBER,
} from "@/features/dashboard/components/sos/offline-sos-config"
import type { Hotline } from "@/features/dashboard/components/sos/duty-hours-dialog"

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

const WIZARD_STEP_COUNT = 4

function stepTitle(step: WizardStep) {
  if (step === "category") return "What’s the emergency?"
  if (step === "triage") return "Quick questions"
  if (step === "location") return "Confirm your location"
  if (step === "review") return "Review & send"
  return "Ongoing"
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
  progress,
  resetKey,
  hideHeader,
  bodyClassName,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  showBack?: boolean
  onBack?: () => void
  footer?: ReactNode
  progress?: ReactNode
  /** Step identity — scrolls the body back to the top whenever it changes. */
  resetKey?: unknown
  hideHeader?: boolean
  bodyClassName?: string
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

  return (
    <SosTakeover
      open={open}
      onClose={onClose}
      labelledBy={titleId}
      describedBy={subtitle ? subtitleId : undefined}
      className="bg-brand-navy text-white"
    >
      <div
        ref={panelRef}
        className="mx-auto flex h-full min-h-0 w-full max-w-2xl flex-col overflow-hidden"
      >
        {!hideHeader ? (
          <>
            <div className="flex shrink-0 items-center gap-2 px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-4">
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
                <p className="text-[11px] font-bold tracking-wide text-brand-orange uppercase">
                  Emergency SOS
                </p>
                <h2
                  id={titleId}
                  className="mt-0.5 truncate text-[22px] leading-[1.2] font-bold tracking-tight text-white"
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
            </div>
            {progress ? (
              <div className="shrink-0 px-5 pb-3">{progress}</div>
            ) : null}
          </>
        ) : null}

        <div
          ref={bodyRef}
          className={cn(
            "scrollbar-hide min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]",
            bodyClassName ?? "px-5 pb-8"
          )}
        >
          {children}
        </div>

        {footer ? (
          <div className="shrink-0 border-t border-white/10 bg-brand-navy px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        ) : null}
      </div>
    </SosTakeover>
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
  online,
  onClose,
  onSubmitted,
  hotlines = [],
}: {
  open: boolean
  online: boolean
  onClose: () => void
  onSubmitted: (alert: EmergencyAlert) => void
  hotlines?: Hotline[]
}) {
  const { user } = useAuthSession()
  const [step, setStep] = useState<WizardStep>("category")
  const [emergencyCategories, setEmergencyCategories] = useState<
    EmergencyCategory[]
  >(() => offlineCategoriesFromConfig())
  useEffect(() => {
    void checkOfflineSosBundleUpdate()
  }, [open])

  useEffect(() => {
    if (!open) return
    let cancelled = false

    // Start both sources together. The authenticated endpoint is authoritative
    // online; the versioned public cache is the source that keeps the wizard
    // useful when the connection is gone or the authenticated request fails.
    const categoryRequest = listEmergencyCategories()
    const configRequest = refreshOfflineSosConfig()
    void Promise.allSettled([categoryRequest, configRequest]).then(
      ([categoryResult, configResult]) => {
        if (cancelled) return
        if (categoryResult.status === "fulfilled") {
          setEmergencyCategories(categoryResult.value)
          return
        }
        if (configResult.status === "fulfilled") {
          const categories = offlineCategoriesFromConfig(configResult.value)
          if (categories.length) setEmergencyCategories(categories)
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [open])
  const [emergency, setEmergency] = useState<EmergencyType | "">("")
  const [note, setNote] = useState("")
  const [location, setLocation] = useState<SosLocationValue | null>(null)
  const [locationVisited, setLocationVisited] = useState(false)
  const [triage, setTriage] = useState<SosTriageAnswers>({})
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [mediaFiles, setMediaFiles] = useState<File[]>([])
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [checkingMedia, setCheckingMedia] = useState(false)
  const [dispatchCountdown, setDispatchCountdown] = useState(5)
  const isOnline = online
  const [statusAnnouncement, setStatusAnnouncement] = useState("")
  const [smsSending, setSmsSending] = useState(false)
  const clientRequestIdRef = useRef(crypto.randomUUID())
  const wasOpenRef = useRef(open)
  const submitAbortRef = useRef<AbortController | null>(null)
  const cancelRequestedRef = useRef(false)

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
    media?: File[]
  }) {
    const formData = new FormData()
    formData.append("client_request_id", payload.clientRequestId)
    formData.append("type", payload.type)
    formData.append("note", payload.note)
    formData.append("latitude", payload.latitude.toFixed(7))
    formData.append("longitude", payload.longitude.toFixed(7))
    formData.append("location_source", payload.locationSource)
    if (payload.locationAccuracy != null)
      formData.append("location_accuracy", String(payload.locationAccuracy))
    formData.append("address", payload.address.slice(0, 255))
    if (Object.keys(payload.triage).length) {
      formData.append("triage", JSON.stringify(toServerTriage(payload.triage)))
    }
    for (const file of payload.media ?? []) formData.append("media", file)
    return formData
  }

  function sosCheckErrorMessage(error: unknown): string {
    if (
      error instanceof ApiError &&
      error.data &&
      typeof error.data === "object"
    ) {
      const data = error.data as Record<string, unknown>
      const media = data.media
      if (Array.isArray(media) && media.length > 0) {
        return String(media[0])
      }
      const detail = data.detail
      if (typeof detail === "string") return detail
    }
    if (error instanceof Error && error.message) return error.message
    return "This photo could not be validated."
  }

  async function addSosFiles(files: File[]) {
    const errors: string[] = []
    const seen = [...mediaFiles]
    const candidates: File[] = []
    for (const file of files) {
      const error = sosPhotoError(file, seen)
      if (error) {
        errors.push(error)
        continue
      }
      seen.push(file)
      candidates.push(file)
    }
    const room = Math.max(0, SOS_MAX_FILES - mediaFiles.length)
    const filesToCheck = candidates.slice(0, room)
    if (candidates.length > room) {
      errors.push(`You can attach up to ${SOS_MAX_FILES} photos.`)
    }
    if (filesToCheck.length > 0) {
      // One batch check so authenticity, duplicate, and AI verdicts land
      // immediately instead of once per attachment.
      setCheckingMedia(true)
      try {
        const checkData = new FormData()
        for (const file of filesToCheck) checkData.append("media", file)
        const result = await checkEmergencyMedia(checkData)
        const checkedFiles = result.files ?? []
        const accepted = checkedFiles
          .map((checkedFile, resultIndex) => ({
            ...checkedFile,
            index: Number.isInteger(checkedFile.index)
              ? checkedFile.index
              : resultIndex,
          }))
          .filter((checkedFile) => checkedFile.status === "accepted")
        const rejectedMessages = checkedFiles
          .filter((checkedFile) => checkedFile.status === "rejected")
          .map((checkedFile) => checkedFile.message)
          .filter(Boolean)
        setMediaFiles((previous) => [
          ...previous,
          ...accepted
            .map((checkedFile) => filesToCheck[checkedFile.index])
            .filter((file): file is File => Boolean(file)),
        ])
        errors.push(...rejectedMessages)
      } catch (error) {
        errors.push(sosCheckErrorMessage(error))
      } finally {
        setCheckingMedia(false)
      }
    }
    setMediaError(errors.length ? errors[0]! : null)
  }

  async function retryQueuedEmergencies() {
    if (!isOnline) return
    const [queued, active] = await Promise.all([
      listQueuedSosEmergencies().catch(() => []),
      getActiveEmergency().catch(() => null),
    ])
    if (active && isActiveAlert(active)) {
      for (const item of queued) {
        if (item.userId === user?.id) await deleteQueuedSosEmergency(item.id)
      }
      onSubmitted(active)
      return
    }
    for (const item of queued) {
      if (item.userId !== user?.id) continue
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
          })
        )
        await deleteQueuedSosEmergency(item.id)
        toast.success("Queued emergency sent")
        onSubmitted(alert)
        break
      } catch (error) {
        if (error instanceof ApiError && error.status === 409 && error.data && typeof error.data === "object") {
          const active = (error.data as { active_emergency?: EmergencyAlert }).active_emergency
          if (active && isActiveAlert(active)) {
            await deleteQueuedSosEmergency(item.id)
            onSubmitted(active)
            break
          }
        }
      }
    }
  }

  const retryQueuedRef = useRef(retryQueuedEmergencies)

  useEffect(() => {
    retryQueuedRef.current = retryQueuedEmergencies
  })

  useEffect(() => {
    queueMicrotask(() => {
      if (isOnline) {
        setSubmitError((current) =>
          current === OFFLINE_SUBMIT_ERROR ? "" : current
        )
        setStatusAnnouncement(
          "Connection restored. You can send the emergency alert online."
        )
        void retryQueuedRef.current()
      } else {
        setStatusAnnouncement(
          "You are offline. Your SOS details are saved on this screen."
        )
      }
    })
  }, [isOnline])

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
    setLocationVisited(false)
    setTriage({})
    setFieldErrors({})
    setSubmitError("")
    setMediaFiles([])
    setMediaError(null)
    setDispatchCountdown(5)
    setSubmitting(false)
    setSmsSending(false)
  }

  useEffect(() => {
    // The parent can close the shell after a native SMS handoff without
    // unmounting this component. Reset on the closed transition as a final
    // guard so the next SOS always starts blank.
    if (wasOpenRef.current && !open) resetWizard()
    wasOpenRef.current = open
    // resetWizard intentionally contains the complete draft reset list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

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
      const questions = questionsForCategory(
        emergency || "",
        typeMeta?.quickQuestions
      )
      if (hasUnansweredQuestions(triage, questions)) {
        setFieldErrors({ triage: "Answer all the questions to continue." })
        return
      }
      setFieldErrors({})
      setLocationVisited(true)
      setStep("location")
      return
    }
    if (step === "location") {
      const selectedLocation = location
      if (!selectedLocation || !isSosLocationReady(selectedLocation)) {
        setFieldErrors({ location: "Choose a location on the map." })
        return
      }
      if (isOnline && !acceptedSosLocation(selectedLocation)) {
        setFieldErrors({
          location: friendlyLocationMessage(selectedLocation.locationCheck),
        })
        return
      }
      setFieldErrors({})
      setStep("review")
      return
    }
    if (step === "review") {
      setSubmitError("")
      setDispatchCountdown(5)
      setStep("countdown")
    }
  }

  // Full-page map has no wizard footer: the "Use this location" pill on the
  // map confirms AND advances using the fresh pin value (avoids stale state).
  function handleLocationAdvance(next: SosLocationValue) {
    setLocation(next)
    if (!isSosLocationReady(next)) {
      setFieldErrors({ location: "Choose a location on the map." })
      return
    }
    if (isOnline && !acceptedSosLocation(next)) {
      setFieldErrors({
        location: friendlyLocationMessage(next.locationCheck),
      })
      return
    }
    setFieldErrors({})
    setStep("review")
  }

  async function submitEmergency() {
    if (!location || !emergency || submitting) return
    if (!isOnline) {
      // eslint-disable-next-line
      await sendSmsAlert()
      return
    }
    setSubmitError("")
    setMediaError(null)
    const submitController = new AbortController()
    submitAbortRef.current = submitController
    cancelRequestedRef.current = false
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
        media: mediaFiles,
      })

      const alert = await createEmergency(formData, submitController.signal)
      if (note.trim()) {
        await sendEmergencyChat(alert.id, note.trim(), null).catch(() => {
          toast.warning(
            "The alert was sent, but your note could not be posted to the chat."
          )
        })
      }
      resetWizard()
      setStatusAnnouncement(
        "Emergency alert sent. Responder routing has started."
      )
      toast.success("Emergency alert sent")
      if (alert.media_warnings?.length) toast.warning(alert.media_warnings[0])
      onSubmitted(alert)
    } catch (error) {
      if (cancelRequestedRef.current || submitController.signal.aborted) return
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
      const message =
        error instanceof Error
          ? error.message
          : "Could not send emergency alert."
      if (error instanceof ApiError && error.status === 409 && error.data && typeof error.data === "object") {
        const active = (error.data as { active_emergency?: EmergencyAlert }).active_emergency
        if (active && isActiveAlert(active)) {
          resetWizard()
          toast.info("Your active emergency is already open.")
          onSubmitted(active)
          return
        }
      }
      if (mediaFiles.length > 0 && /photo|media|image/i.test(message)) {
        setSubmitError("")
        setMediaError(message)
        setStep("location")
      } else {
        setStep("review")
        setSubmitError(message)
      }
      setStatusAnnouncement(`Emergency alert was not sent. ${message}`)
      toast.error(message)
      try {
        await enqueueCurrentEmergency()
        setStatusAnnouncement(
          "Emergency queued. E-Boses will retry when connection returns."
        )
        toast.info("Emergency queued for retry")
      } catch {
        toast.warning("Could not save the SOS queue on this browser.")
      }
    } finally {
      if (submitAbortRef.current === submitController) {
        submitAbortRef.current = null
      }
      cancelRequestedRef.current = false
      setSubmitting(false)
      setDispatchCountdown(5)
    }
  }

  function cancelCountdown() {
    if (submitting) {
      cancelRequestedRef.current = true
      submitAbortRef.current?.abort()
    }
    setStep("review")
    setDispatchCountdown(5)
    setStatusAnnouncement(
      "Emergency alert cancelled before sending. Your details are still available."
    )
  }

  async function enqueueCurrentEmergency() {
    if (!location || !emergency || !user?.id) return
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

  const emergencyOptions = emergencyCategories.length
    ? emergencyOptionsFromCategories(emergencyCategories)
    : emergencies
  const typeMeta = emergencyOptions.find((e) => e.value === emergency)
  const activeQuestions = questionsForCategory(
    emergency || "",
    typeMeta?.quickQuestions
  )
  // Built even without a map fix: an emergency with only a described area is
  // still a valid SMS, and the backend saves and routes it.
  const smsBody = buildEmergencySmsMessage({
    emergencyType: typeMeta?.label ?? (emergency || "Other Emergency"),
    readableArea: location?.addressResolved
      ? location.address || location.addressPrimary
      : "",
    latitude: location?.lat ?? null,
    longitude: location?.lng ?? null,
    triage,
    questions: activeQuestions,
    note,
  })
  const emergencySmsHref = buildEmergencySmsHref(SOS_SMS_NUMBER, smsBody)
  const countdownAnnouncement =
    step === "countdown"
      ? submitting
        ? "Sending the emergency alert now. It can no longer be cancelled from this screen."
        : `Emergency alert will send in ${dispatchCountdown} ${dispatchCountdown === 1 ? "second" : "seconds"}. Activate Cancel to stop it.`
      : ""

  async function handleSmsFallbackClick(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault()
    if (smsSending) return
    setSmsSending(true)
    try {
      setStatusAnnouncement(
        "Opening your SMS app with a draft. E-Boses cannot confirm delivery; review the message and activate Send."
      )
      await enqueueCurrentEmergency().catch(() => undefined)
      resetWizard()
      onClose()
      openSmsApp(SOS_SMS_NUMBER)
    } finally {
      setSmsSending(false)
    }
  }

  async function sendSmsAlert() {
    if (smsSending) return
    const to = normalizeSmsRecipient(SOS_SMS_NUMBER)
    if (!to || smsBodyTooLong(smsBody)) {
      toast.error("This alert is too long to send by SMS.")
      return
    }
    setSmsSending(true)
    openSmsApp(to)
    try {
      const nativeSmsAvailable = canSendSms()
      if (nativeSmsAvailable) {
        await sendSmsText(to, smsBody)
        setStatusAnnouncement(
          "Alert sent by SMS. Keep safe and wait for responders."
        )
        toast.success("Alert sent by SMS")
        if (mediaFiles.length > 0) {
          toast.info("Photos need connection and were not included.")
        }
      } else {
        setStatusAnnouncement(
          "Opening your SMS app. Please type your message and send it."
        )
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not send SMS."
      setStatusAnnouncement(`Alert was not sent. ${message}`)
      toast.error(message)
    } finally {
      resetWizard()
      onClose()
      setSmsSending(false)
    }
  }

  const locationLabel = location?.addressPrimary || location?.address
  const locationCanContinue = Boolean(
    location &&
    isSosLocationReady(location) &&
    (!isOnline || acceptedSosLocation(location))
  )

  const wizardFooter =
    step !== "countdown" ? (
      <>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={goBack}
            className="h-[60px] flex-1 rounded-full border border-white/20 bg-white/10 text-[17px] font-semibold text-white transition-colors hover:bg-white/15"
          >
            Back
          </button>
          <button
            type="button"
            onClick={goNext}
            disabled={
              (step === "category" && !emergency) ||
              (step === "triage" &&
                hasUnansweredQuestions(triage, activeQuestions)) ||
              (step === "location" && !locationCanContinue)
            }
            className={cn(
              "h-[60px] flex-[1.4] rounded-full text-[17px] font-semibold text-white transition-all active:scale-[0.99]",
              step === "review"
                ? "bg-sos hover:opacity-90"
                : "bg-brand-orange hover:bg-brand-orange-strong",
              "disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/40 disabled:active:scale-100"
            )}
          >
            {step === "review" ? "Send SOS" : "Next"}
          </button>
        </div>
        {step === "category" ? (
          <p className="mt-3 text-center text-[13px] text-white/50">
            Prefer to talk?{" "}
            {hotlines[0]?.number ? (
              <a
                href={`tel:${(hotlines[0]?.number ?? "").replace(/[^+\d]/g, "")}`}
                className="font-bold text-brand-orange"
              >
                Call the barangay hotline directly.
              </a>
            ) : (
              "Call the barangay hotline directly."
            )}
          </p>
        ) : null}
      </>
    ) : (
      <div className="flex gap-2">
        <button
          type="button"
          onClick={cancelCountdown}
          className="h-[60px] flex-1 rounded-full border border-sos/50 bg-sos/15 text-[17px] font-semibold text-sos-bright transition-colors hover:bg-sos/25 disabled:opacity-60"
        >
          {submitting ? "Cancel sending" : "Cancel"}
        </button>
        <button
          type="button"
          onClick={() => void submitEmergency()}
          disabled={submitting}
          className="h-[60px] flex-[1.4] rounded-full bg-sos text-[17px] font-semibold text-white transition-all hover:opacity-90 active:scale-[0.99] disabled:opacity-60"
        >
          {submitting ? "Sending…" : "Send Immediately"}
        </button>
      </div>
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
          step === "countdown" ? "Tap cancel if this was accidental" : undefined
        }
        showBack={step !== "category" && step !== "countdown" && step !== "location"}
        onBack={goBack}
        footer={step === "location" ? undefined : wizardFooter}
        hideHeader={step === "location"}
        bodyClassName={
          step === "location" ? "p-0 pb-0 overflow-hidden" : undefined
        }
        progress={
          step !== "countdown" && step !== "location" ? (
            <div className="flex gap-1.5" aria-hidden="true">
              {Array.from({ length: WIZARD_STEP_COUNT }).map((_, i) => {
                const on = i < Math.min(stepIndex(step), WIZARD_STEP_COUNT)
                return (
                  <span
                    key={i}
                    className={cn(
                      "h-[5px] flex-1 rounded-full",
                      on
                        ? "bg-brand-orange shadow-[0_0_12px_rgba(255,106,26,0.7)]"
                        : "bg-white/15"
                    )}
                  />
                )
              })}
            </div>
          ) : undefined
        }
        resetKey={step}
      >
        {step === "category" ? (
          <SosTypeStep
            value={emergency}
            onSelect={(next) => {
              setEmergency(next)
              setTriage({})
              setFieldErrors((c) => ({ ...c, type: "" }))
            }}
            error={fieldErrors.type}
            options={emergencyOptions}
          />
        ) : null}

        {locationVisited ? (
          <div
            className={cn(
              "flex min-h-full flex-col",
              step === "location" ? "h-full min-h-full flex-1 gap-0" : "gap-4",
              step !== "location" && "hidden"
            )}
          >
            <SosLocationStep
              value={location}
              onChange={setLocation}
              onBack={goBack}
              onAdvance={handleLocationAdvance}
              error={step === "location" ? fieldErrors.location : undefined}
              className={
                step === "location" ? "min-h-0 flex-1" : "min-h-[320px] flex-1"
              }
            />
          </div>
        ) : null}

        {step === "triage" ? (
          <div className="flex flex-col gap-4">
            <SosTriageStep
              categoryCode={emergency || ""}
              questions={typeMeta?.quickQuestions}
              value={triage}
              onChange={(next) => {
                setTriage(next)
                setFieldErrors((c) => ({ ...c, triage: "" }))
              }}
              error={fieldErrors.triage}
            />
            <SosDetailsStep
              note={note}
              onNoteChange={setNote}
              online={isOnline}
              checking={checkingMedia}
              mediaFiles={mediaFiles}
              mediaError={mediaError}
              onAddFiles={(files) => void addSosFiles(files)}
              onRemoveFile={(index) => {
                setMediaFiles((previous) =>
                  previous.filter((_, i) => i !== index)
                )
                setMediaError(null)
              }}
            />
          </div>
        ) : null}

        {step === "review" || step === "countdown" ? (
          <SosConfirmStep
            mode={step}
            submitError={submitError}
            emergencySmsHref={!isOnline ? emergencySmsHref : ""}
            onSmsFallbackClick={handleSmsFallbackClick}
            typeLabel={typeMeta?.label}
            locationLabel={locationLabel}
            triageSummary={describeTriage(triage, activeQuestions)}
            note={note}
            submitting={submitting}
            dispatchCountdown={dispatchCountdown}
            onEditStep={(next) => setStep(next)}
          />
        ) : null}

      </SosShell>
    </>
  )
}
