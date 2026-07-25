import { useEffect, useRef } from "react"
import { toast } from "sonner"
import type { EmergencyAlert } from "@/features/dashboard/emergency-api"
import { WIZARD_STEPS, type WizardState, type WizardAction } from "@/features/dashboard/components/sos-wizard-types"

const OFFLINE_SUBMIT_ERROR = "You're offline. Reconnect to send online, or use the SMS backup below."

export function useSosWizard({
  wizard,
  dispatchWizard,
  setTrackingAlert,
  setShellMode,
  setShellOpen,
  setExpanded,
  setStatusAnnouncement,
  isOnline,
  setIsOnline,
}: {
  wizard: WizardState
  dispatchWizard: React.Dispatch<WizardAction>
  setTrackingAlert: (alert: EmergencyAlert | null) => void
  setShellMode: (mode: "wizard" | "tracking") => void
  setShellOpen: (open: boolean) => void
  setExpanded: (expanded: boolean) => void
  setStatusAnnouncement: (text: string) => void
  isOnline: boolean
  setIsOnline: (online: boolean) => void
}) {
  const clientRequestIdRef = useRef("")
  const fileRef = useRef<HTMLInputElement>(null)

  function resetWizard() {
    clientRequestIdRef.current = crypto.randomUUID()
    dispatchWizard({ type: "RESET" })
  }

  function closeShell() {
    if (wizard.step === "countdown") {
      if (wizard.submitting) {
        setStatusAnnouncement("The emergency alert is already sending and can no longer be cancelled here.")
        return
      }
      dispatchWizard({ type: "SET_STEP", step: "review" })
      dispatchWizard({ type: "SET_COUNTDOWN", dispatchCountdown: 5 })
      setStatusAnnouncement("Emergency alert cancelled before sending. Your details are still available.")
      toast.info("Alert cancelled before sending.")
      return
    }
    setShellOpen(false)
    setExpanded(false)
    resetWizard()
  }

  function goBack() {
    if (wizard.step === "countdown") {
      if (wizard.submitting) return
      dispatchWizard({ type: "SET_STEP", step: "review" })
      dispatchWizard({ type: "SET_COUNTDOWN", dispatchCountdown: 5 })
      return
    }
    const idx = WIZARD_STEPS.indexOf(wizard.step)
    if (idx <= 0) { closeShell(); return }
    dispatchWizard({ type: "SET_STEP", step: WIZARD_STEPS[idx - 1]! })
  }

  function goNext() {
    if (wizard.step === "category") {
      if (!wizard.emergency) {
        dispatchWizard({ type: "SET_FIELD_ERRORS", fieldErrors: { type: "Select the emergency type." } })
        return
      }
      dispatchWizard({ type: "SET_FIELD_ERRORS", fieldErrors: {} })
      dispatchWizard({ type: "SET_STEP", step: "location" })
      return
    }
    if (wizard.step === "location") {
      if (wizard.location == null) {
        dispatchWizard({ type: "SET_FIELD_ERRORS", fieldErrors: { location: "Confirm a street location on the map." } })
        return
      }
      dispatchWizard({ type: "SET_FIELD_ERRORS", fieldErrors: {} })
      dispatchWizard({ type: "SET_STEP", step: "details" })
      return
    }
    if (wizard.step === "details") {
      dispatchWizard({ type: "SET_STEP", step: "review" })
      return
    }
    if (wizard.step === "review") {
      if (!isOnline) {
        dispatchWizard({ type: "SET_SUBMIT_ERROR", submitError: OFFLINE_SUBMIT_ERROR })
        setStatusAnnouncement(OFFLINE_SUBMIT_ERROR)
        return
      }
      dispatchWizard({ type: "SET_SUBMIT_ERROR", submitError: "" })
      dispatchWizard({ type: "SET_COUNTDOWN", dispatchCountdown: 5 })
      dispatchWizard({ type: "SET_STEP", step: "countdown" })
    }
  }

  function handleMediaSelection(files: FileList | null) {
    if (!files) return
    const selected = Array.from(files).slice(0, 2)
    const invalid = selected.find((file) => !["image/jpeg", "image/png"].includes(file.type) || file.size > 2 * 1024 * 1024)
    if (invalid) {
      dispatchWizard({ type: "SET_MEDIA_FILES", mediaFiles: [] })
      dispatchWizard({ type: "SET_FIELD_ERRORS", fieldErrors: { ...wizard.fieldErrors, media: `${invalid.name}: use JPG/PNG up to 2 MB.` } })
      return
    }
    dispatchWizard({ type: "SET_MEDIA_FILES", mediaFiles: selected })
    dispatchWizard({ type: "SET_FIELD_ERRORS", fieldErrors: { ...wizard.fieldErrors, media: "" } })
  }

  async function submitEmergency() {
    if (!wizard.location || !wizard.emergency) return
    if (!navigator.onLine) {
      setIsOnline(false)
      dispatchWizard({ type: "SET_STEP", step: "review" })
      dispatchWizard({ type: "SET_SUBMIT_ERROR", submitError: OFFLINE_SUBMIT_ERROR })
      setStatusAnnouncement(OFFLINE_SUBMIT_ERROR)
      dispatchWizard({ type: "SET_COUNTDOWN", dispatchCountdown: 5 })
      return
    }
    dispatchWizard({ type: "SET_SUBMIT_ERROR", submitError: "" })
    dispatchWizard({ type: "SET_SUBMITTING", submitting: true })
    setStatusAnnouncement("Sending the emergency alert now.")
    try {
      const { createEmergency } = await import("@/features/dashboard/emergency-api")
      const formData = new FormData()
      if (!clientRequestIdRef.current) clientRequestIdRef.current = crypto.randomUUID()
      formData.append("client_request_id", clientRequestIdRef.current)
      formData.append("type", wizard.emergency)
      formData.append("note", wizard.note)
      formData.append("latitude", wizard.location.lat.toFixed(7))
      formData.append("longitude", wizard.location.lng.toFixed(7))
      formData.append("location_source", wizard.location.source === "gps" ? "gps" : "manual_pin")
      if (wizard.location.accuracy != null) formData.append("location_accuracy", String(wizard.location.accuracy))
      const addr = wizard.location.address || wizard.location.addressPrimary || ""
      formData.append("address", addr.slice(0, 255))
      for (const file of wizard.mediaFiles) formData.append("media", file)
      const alert = await createEmergency(formData)
      setTrackingAlert(alert)
      setShellMode("tracking")
      resetWizard()
      setStatusAnnouncement("Emergency alert sent. Responder routing has started.")
      toast.success("Emergency alert sent")
      if (alert.media_warnings?.length) toast.warning(alert.media_warnings[0])
    } catch (error) {
      try {
        const { getActiveEmergency } = await import("@/features/dashboard/emergency-api")
        const active = await getActiveEmergency()
        if (active) {
          setTrackingAlert(active as EmergencyAlert)
          setShellMode("tracking")
          resetWizard()
          toast.info("Your active emergency is already open.")
          return
        }
      } catch { /* ignore */ }
      dispatchWizard({ type: "SET_STEP", step: "review" })
      const message = error instanceof Error ? error.message : "Could not send emergency alert."
      dispatchWizard({ type: "SET_SUBMIT_ERROR", submitError: message })
      setStatusAnnouncement(`Emergency alert was not sent. ${message}`)
      toast.error(message)
    } finally {
      dispatchWizard({ type: "SET_SUBMITTING", submitting: false })
      dispatchWizard({ type: "SET_COUNTDOWN", dispatchCountdown: 5 })
    }
  }

  const submitRef = useRef(submitEmergency)

  useEffect(() => { submitRef.current = submitEmergency })

  useEffect(() => {
    if (wizard.step !== "countdown") return
    const t = window.setTimeout(() => {
      if (wizard.dispatchCountdown <= 0) { void submitRef.current(); return }
      dispatchWizard({ type: "DECREMENT_COUNTDOWN" })
    }, wizard.dispatchCountdown <= 0 ? 0 : 1000)
    return () => window.clearTimeout(t)
  }, [wizard.step, wizard.dispatchCountdown, dispatchWizard])

  return {
    closeShell, goBack, goNext, handleMediaSelection, submitEmergency, resetWizard, clientRequestIdRef, fileRef,
  }
}
