import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import {
  CameraIcon,
  ImageIcon,
  MapPinIcon,
  PlusIcon,
  XIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import { useAuthSession } from "@/features/auth/auth-session"
import {
  checkConcernMedia,
  createConcern,
  precheckConcern,
  type Concern,
  type ConcernActiveDuplicate,
  type ConcernPhotoVerdict,
  type ConcernPrecheckResult,
  type ConcernResolvedMatch,
} from "@/features/dashboard/api"
import { CameraCaptureDialog } from "@/features/dashboard/components/camera-capture-dialog"
import { Dialog, DialogBody } from "@/features/dashboard/components/dialog"
import { ReportDetailsDialog } from "@/features/dashboard/components/report-details-dialog"
import { ApiError } from "@/lib/api"
import { formatNominatimParts, reverseGeocode } from "@/lib/geocode"
import { useCoverageContext } from "@/features/dashboard/lib/use-coverage"
import { insideCoverage } from "@/features/dashboard/components/map/coverage-layer"

const LocationPickerModal = lazy(() => import("@/features/dashboard/components/location-picker"))

const ALLOWED_TYPES = ["image/png", "image/jpeg"]
const ACCEPT_STRING = ".png,.jpg,.jpeg," + ALLOWED_TYPES.join(",")
const MAX_FILE_SIZE = 10 * 1024 * 1024
const MAX_FILES = 5
const descriptionMax = 1500

function titleFromDescription(text: string, max = 80): string {
  const cleaned = text.trim().replace(/\s+/g, " ")
  if (!cleaned) return "Community report"
  const sentence = cleaned.split(/(?<=[.!?…])\s+/)[0]?.trim() || cleaned
  const base = sentence.length <= max ? sentence : cleaned
  if (base.length <= max) return base
  const slice = base.slice(0, max)
  const atWord = slice.replace(/\s+\S*$/, "").trim()
  return (atWord.length >= 24 ? atWord : slice).trim()
}

const DRAFT_DB = "eboses-resident-drafts"
const DRAFT_STORE = "report-drafts"
const DRAFT_KEY = "current-report"

const DRAFT_CLOSE_ACK_KEY = "eboses-draft-close-ack"

function hasAcknowledgedDraftClose() {
  try {
    return typeof sessionStorage !== "undefined" && sessionStorage.getItem(DRAFT_CLOSE_ACK_KEY) === "1"
  } catch {
    return false
  }
}

function markDraftCloseAcknowledged() {
  try {
    sessionStorage.setItem(DRAFT_CLOSE_ACK_KEY, "1")
  } catch {
    void 0
  }
}

interface ReportDraft {
  title: string
  description: string
  address: string
  locationPin: {
    lat: number
    lng: number
    accuracy?: number | null
    source?: "gps" | "manual_pin"
  } | null
}

function openDraftDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DRAFT_DB, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(DRAFT_STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function readDraft() {
  const database = await openDraftDatabase()
  return new Promise<ReportDraft | undefined>((resolve, reject) => {
    const request = database.transaction(DRAFT_STORE).objectStore(DRAFT_STORE).get(DRAFT_KEY)
    request.onsuccess = () => resolve(request.result as ReportDraft | undefined)
    request.onerror = () => reject(request.error)
  }).finally(() => database.close())
}

async function writeDraft(draft: ReportDraft) {
  const database = await openDraftDatabase()
  await new Promise<void>((resolve, reject) => {
    const request = database
      .transaction(DRAFT_STORE, "readwrite")
      .objectStore(DRAFT_STORE)
      .put(draft, DRAFT_KEY)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
  database.close()
}

async function deleteDraft() {
  const database = await openDraftDatabase()
  await new Promise<void>((resolve, reject) => {
    const request = database
      .transaction(DRAFT_STORE, "readwrite")
      .objectStore(DRAFT_STORE)
      .delete(DRAFT_KEY)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
  database.close()
}

export function CreateReportDialog({
  open: controlledOpen,
  onOpenChange,
  trigger,
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  trigger?: (open: () => void) => ReactNode
} = {}) {
  const navigate = useNavigate()
  const { user } = useAuthSession()

  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = (value: boolean) => {
    setInternalOpen(value)
    onOpenChange?.(value)
  }

  const [description, setDescription] = useState("")
  const [locationOpen, setLocationOpen] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [address, setAddress] = useState("")
  const [addressPrimary, setAddressPrimary] = useState("")
  const [addressSecondary, setAddressSecondary] = useState("")
  const [locationPin, setLocationPin] = useState<{
    lat: number
    lng: number
    accuracy?: number | null
    source?: "gps" | "manual_pin"
  } | null>(null)
  const [mediaFiles, setMediaFiles] = useState<File[]>([])
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isCheckingMedia, setIsCheckingMedia] = useState(false)
  const [submittedReport, setSubmittedReport] = useState<Concern | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [precheckNotice, setPrecheckNotice] = useState("")
  const [draftRestored, setDraftRestored] = useState(false)
  const [resolvedMatch, setResolvedMatch] = useState<ConcernResolvedMatch | null>(null)
  const [duplicateConfirm, setDuplicateConfirm] = useState<ConcernActiveDuplicate | null>(null)
  const [photoVerdicts, setPhotoVerdicts] = useState<ConcernPhotoVerdict[]>([])
  const [privacyPreview, setPrivacyPreview] = useState<{ state: string; detected_classes: string[]; protected_image: string } | null>(null)

  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false)

  const clientRequestIdRef = useRef(crypto.randomUUID())
  const recurrenceOfRef = useRef<number | null>(null)
  const duplicateOfRef = useRef<number | null>(null)

  const inferredCategoryRef = useRef("")
  const resolvedAddressRef = useRef<{ address: string; primary: string; secondary: string } | null>(null)
  const pendingPrecheckRef = useRef<ConcernPrecheckResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const previewUrls = useMemo(
    () => mediaFiles.map((file) => URL.createObjectURL(file)),
    [mediaFiles],
  )
  // Coverage rules for the camera's GPS check — loaded once per open.
  const coverageContext = useCoverageContext(open)

  const displayName = user
    ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || "Resident"
    : "Resident"
  const letter = (
    user?.firstName?.[0] ||
    user?.lastName?.[0] ||
    displayName[0] ||
    "?"
  ).toUpperCase()
  const rawStreet = (user?.address || "").split(",")[0]?.trim() || ""
  const userStreet =
    !rawStreet || rawStreet.toLowerCase() === "pending" ? "" : rawStreet

  useEffect(() => () => previewUrls.forEach((url) => URL.revokeObjectURL(url)), [previewUrls])

  useEffect(() => {
    if (!closeConfirmOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation()
        setCloseConfirmOpen(false)
      }
    }
    document.addEventListener("keydown", onKey, true)
    return () => document.removeEventListener("keydown", onKey, true)
  }, [closeConfirmOpen])

  useEffect(() => {
    if (!open || draftRestored) return
    void readDraft()
      .then((draft) => {
        if (!draft) return
        // Category is inferred at submit time, so drafts only restore the
        // resident's report content and optional location.
        setDescription(draft.description)
        setAddress(draft.address)

        const parts = draft.address.split(",").map((p) => p.trim())
        setAddressPrimary(parts[0] || draft.address)
        setAddressSecondary(parts.slice(1).join(", "))
        setLocationPin(draft.locationPin)
      })
      .finally(() => setDraftRestored(true))
  }, [open, draftRestored])

  useEffect(() => {
    if (!open || !draftRestored || (!description && !address && !locationPin)) return
    const timeout = window.setTimeout(() => {
      void writeDraft({
        title: titleFromDescription(description),
        description,
        address,
        locationPin,
      })
    }, 500)
    return () => window.clearTimeout(timeout)
  }, [open, draftRestored, description, address, locationPin])

  function resetForm() {
    setDescription("")
    setAddress("")
    setAddressPrimary("")
    setAddressSecondary("")
    setLocationPin(null)
    setMediaFiles([])
    setPreviewUrl(null)
    setFieldErrors({})
    setLocationOpen(false)
    setCameraOpen(false)
    setCloseConfirmOpen(false)
    setResolvedMatch(null)
    setDuplicateConfirm(null)
    setPhotoVerdicts([])
    setPrivacyPreview(null)
    setPrecheckNotice("")
    recurrenceOfRef.current = null
    duplicateOfRef.current = null
    inferredCategoryRef.current = ""
    pendingPrecheckRef.current = null
    resolvedAddressRef.current = null
    clientRequestIdRef.current = crypto.randomUUID()
    setDraftRestored(false)
  }

  function hasDraftContent() {
    return Boolean(
        description.trim() ||
        address.trim() ||
        locationPin ||
        mediaFiles.length > 0,
    )
  }

  function buildDraftPayload(): ReportDraft {
    return {
      title: titleFromDescription(description),
      description,
      address,
      locationPin,
    }
  }

  async function saveDraftQuietly() {
    if (hasDraftContent()) {
      await writeDraft(buildDraftPayload())
    } else {
      await deleteDraft()
    }
  }

  function requestClose() {
    if (isSubmitting) return
    setLocationOpen(false)
    setCloseConfirmOpen(false)

    if (!hasDraftContent()) {
      void deleteDraft().catch(() => undefined)
      setOpen(false)
      return
    }

    if (hasAcknowledgedDraftClose()) {
      void saveDraftQuietly()
        .catch(() => undefined)
        .finally(() => setOpen(false))
      return
    }

    setCloseConfirmOpen(true)
  }

  async function confirmCloseAndSaveDraft() {
    try {
      await saveDraftQuietly()

      if (!hasAcknowledgedDraftClose()) {
        toast.success("Draft saved.")
        markDraftCloseAcknowledged()
      }
    } catch {
      toast.error("Could not save draft.")
    }
    setCloseConfirmOpen(false)
    setLocationOpen(false)
    setOpen(false)
  }

  function keepReporting() {
    setCloseConfirmOpen(false)
  }

  const keepPosting = keepReporting

  function validate() {
    const errors: Record<string, string> = {}
    if (!description.trim())
      errors.description = "Describe what happened."
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  function cleanMediaErrorMessage(raw: string): string {
    let text = raw.trim()

    const afterColon = text.includes(":") ? text.slice(text.lastIndexOf(":") + 1).trim() : text
    text = afterColon || text

    if (
      (text.startsWith("[") && text.endsWith("]")) ||
      (text.startsWith("('") && text.endsWith("')"))
    ) {
      text = text.replace(/^[[(]+|[)\]]+$/g, "").trim()
    }
    text = text.replace(/^['"]+|['"]+$/g, "").trim()
    return text || "This photo could not be validated."
  }

  function mediaErrorFromUnknown(error: unknown): string {
    if (error instanceof ApiError && error.data && typeof error.data === "object") {
      const data = error.data as Record<string, unknown>
      const media = data.media
      if (Array.isArray(media) && media.length > 0) {
        return media
          .map((item) => cleanMediaErrorMessage(String(item)))
          .filter(Boolean)
          .join(" ")
      }
      const detail = data.detail
      if (typeof detail === "string") return cleanMediaErrorMessage(detail)
    }
    if (error instanceof Error && error.message) {
      return cleanMediaErrorMessage(error.message)
    }
    return "This photo could not be validated."
  }

  async function addFiles(files: File[]): Promise<File[]> {
    const errors: string[] = []
    const valid: File[] = []
    setIsCheckingMedia(true)
    for (const file of files) {
      if (!ALLOWED_TYPES.includes(file.type)) {
        errors.push("Unsupported format. Use JPG or PNG.")
        continue
      }
      if (file.size > MAX_FILE_SIZE) {
        errors.push("File must be 10 MB or smaller.")
        continue
      }
      if (
        mediaFiles.some(
          (existing) =>
            existing.name === file.name &&
            existing.size === file.size &&
            existing.lastModified === file.lastModified,
        )
      ) {
        errors.push("This file is already selected.")
        continue
      }
      try {
        const checkData = new FormData()
        checkData.append("media", file)
        await checkConcernMedia(checkData)
        valid.push(file)
      } catch (error) {
        errors.push(mediaErrorFromUnknown(error))
      }
    }
    const room = Math.max(0, MAX_FILES - mediaFiles.length)
    const added = valid.slice(0, room)
    setMediaFiles((prev) => [...prev, ...added])
    const unique = [...new Set(errors.filter(Boolean))]
    setFieldErrors((current) => ({
      ...current,
      // Newline-separated so the UI can list every media check message
      media: unique.length ? unique.join("\n") : "",
    }))
    setIsCheckingMedia(false)
    return added
  }

  /** Probe GPS → pin + reverse-geocoded street name. True when coords resolved. */
  async function resolveGpsLocation(): Promise<boolean> {
    if (!("geolocation" in navigator)) return false
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 8000,
        })
      })
      const lat = pos.coords.latitude
      const lng = pos.coords.longitude
      // Same rule the location picker enforces: a GPS fix outside the covered
      // boundary (or dispatch radius) is refused, never shown as the pin.
      if (
        coverageContext &&
        !insideCoverage(lat, lng, {
          boundary: coverageContext.boundary.geometry,
          policy: coverageContext.dispatch_policy,
        })
      ) {
        toast.error("Your location is outside our covered area. Pin it manually on the map instead.")
        return false
      }
      setLocationPin({
        lat,
        lng,
        accuracy: pos.coords.accuracy ?? null,
        source: "gps",
      })

      const data = await reverseGeocode(lat, lng)
      const parts = data ? formatNominatimParts(data) : null
      const primary = (parts?.primary ?? "").trim()
      const usable =
        primary &&
        primary !== "Finding street…" &&
        primary !== "Selected location" &&
        !/^lat\b/i.test(primary) &&
        !/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(primary)
      if (!usable) {
        toast.error("Location saved, but no street name was found. Check the pin before posting.")
        return true
      }
      const secondary = (parts?.secondary ?? "").trim() || "Marikina Heights"
      setAddress(parts!.full?.trim() || `${primary}, ${secondary}`)
      setAddressPrimary(primary)
      setAddressSecondary(secondary)
      setFieldErrors((prev) => ({ ...prev, address: "" }))
      return true
    } catch (err) {
      const code = typeof err === "object" && err !== null ? (err as GeolocationPositionError).code : 0
      toast.error(
        code === 1
          ? "Location is blocked. Allow it via the lock icon in your address bar, then take the photo again."
          : "Couldn't read your location. Make sure location services are on.",
      )
      return false
    }
  }

  /** Permission state without side effects: "granted" | "denied" | "prompt" | null. */
  async function geoPermissionState(): Promise<"granted" | "denied" | "prompt" | null> {
    try {
      if (!("permissions" in navigator)) return null
      const status = await navigator.permissions.query({ name: "geolocation" })
      return status.state as "granted" | "denied" | "prompt"
    } catch {
      return null
    }
  }

  function handleCameraCapture(files: File[]) {
    void addFiles(files).then((added) => {
      // Location is fetched once — and only when a photo actually landed.
      if (!added.length) return
      if (!locationPin || locationPin.source !== "gps") void resolveGpsLocation()
    })
  }

  /** Same as geoPermissionState, for the camera — checked before opening the
   * live capture dialog so an already-denied permission never flashes the
   * camera modal open just to immediately close it. */
  async function cameraPermissionState(): Promise<"granted" | "denied" | "prompt" | null> {
    try {
      if (!("permissions" in navigator)) return null
      const status = await navigator.permissions.query({ name: "camera" as PermissionName })
      return status.state as "granted" | "denied" | "prompt"
    } catch {
      return null
    }
  }

  async function handleCameraButtonClick(liveCameraAvailable: boolean) {
    if (!liveCameraAvailable) {
      cameraInputRef.current?.click()
      return
    }
    const camState = await cameraPermissionState()
    if (camState === "denied") {
      toast.error("Camera is blocked. Allow it via the lock icon in your address bar, then try again.")
      return
    }
    // Location is asked for while this dialog is still on screen: once the
    // camera modal is up, a permission prompt lands behind it.
    const state = await geoPermissionState()
    if (state === "denied") {
      toast.error(
        "Location is blocked. Allow it via the lock icon in your address bar, then take the photo again.",
      )
      return
    }
    if (state === "prompt") {
      const ok = await resolveGpsLocation()
      if (!ok) return
    }
    setCameraOpen(true)
  }

  function selectedCategoryCode() {
    return inferredCategoryRef.current
  }

  function buildSubmitFormData(): FormData | null {
    const title = titleFromDescription(description)
    const formData = new FormData()
    formData.append("client_request_id", clientRequestIdRef.current)
    formData.append("title", title)
    formData.append("description", description.trim())
    formData.append("category", selectedCategoryCode())
    // The address is the street line the server resolved from the pin. The
    // typed text is only a fallback for a pin the geocoder could not place.
    const resolved = resolvedAddressRef.current
    const primary = resolved?.primary || (addressPrimary || address).trim().split(",")[0]?.trim() || address.trim()
    const secondary = resolved?.secondary ?? addressSecondary.trim()
    const locationRequired = pendingPrecheckRef.current?.location_required ?? true
    const looksLikeCoords =
      !primary ||
      /^lat\b/i.test(primary) ||
      /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(primary)
    if (locationRequired && looksLikeCoords) {
      setFieldErrors((prev) => ({
        ...prev,
        address: "Pin a location with a street name before submitting.",
      }))
      return null
    }
    if (!looksLikeCoords) {
      const storedAddress = resolved?.address || (secondary ? `${primary}, ${secondary}` : primary)
      formData.append("address", storedAddress.slice(0, 255))
    }
    if (locationPin) {
      formData.append("latitude", locationPin.lat.toFixed(7))
      formData.append("longitude", locationPin.lng.toFixed(7))
      formData.append("location_source", locationPin.source ?? "manual_pin")
      if (locationPin.accuracy !== undefined && locationPin.accuracy !== null) {
        formData.append("location_accuracy", String(locationPin.accuracy))
      }
    }
    for (const file of mediaFiles) formData.append("media", file)
    return formData
  }

  async function finalizeSubmit(options?: { escalate?: boolean; emergencyType?: string }) {
    const formData = buildSubmitFormData()
    if (!formData) return
    setIsSubmitting(true)
    try {
      const report = await createConcern(formData, {
        escalate: options?.escalate,
        emergencyType: options?.emergencyType,
        recurrenceOf: recurrenceOfRef.current ?? undefined,
        duplicateOf: duplicateOfRef.current ?? undefined,
      })
      await deleteDraft()
      setSubmittedReport(report)
      setOpen(false)
      window.dispatchEvent(new Event("eboses:report-created"))
    } catch (submitError) {
      if (submitError instanceof ApiError && submitError.status === 409) {
        const detail =
          (submitError.data && typeof submitError.data === "object"
            ? (submitError.data as { detail?: string }).detail
            : undefined) || "You already have an active emergency."
        toast.error(detail)
        return
      }
      if (submitError instanceof ApiError && submitError.data && typeof submitError.data === "object") {
        const nextErrors: Record<string, string> = {}
        for (const [key, value] of Object.entries(submitError.data)) {
          const first = Array.isArray(value) ? value[0] : value
          if (typeof first === "string") nextErrors[key] = first
        }
        setFieldErrors(nextErrors)
      }
      toast.error(
        submitError instanceof ApiError
          ? submitError.message
          : "Could not submit report. Try again.",
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  /**
   * Walk the confirmations the resident still owes, in order, from the one
   * pre-check result. Answering one never re-runs the model — the inference
   * happens once per press of Report and is reused for the whole chain.
   */
  async function advance(stage: "duplicate" | "resolved" | "submit") {
    const precheck = pendingPrecheckRef.current
    if (!precheck) return
    if (stage === "duplicate") {
      if (precheck.active_duplicate) {
        setDuplicateConfirm(precheck.active_duplicate)
        return
      }
      stage = "resolved"
    }
    if (stage === "resolved") {
      if (precheck.resolved_match) {
        setResolvedMatch(precheck.resolved_match)
        return
      }
    }
    await finalizeSubmit({
      escalate: Boolean(precheck.auto_escalate),
      emergencyType: precheck.emergency_type || undefined,
    })
  }

  /**
   * The gate. A blocked report cannot be submitted — there is no second press
   * that gets past it, and nothing unresolved is handed to an official.
   */
  async function handleSubmit() {
    if (!validate()) return
    recurrenceOfRef.current = null
    duplicateOfRef.current = null
    setIsSubmitting(true)
    try {
      const precheckData = new FormData()
      precheckData.append("client_request_id", clientRequestIdRef.current)
      precheckData.append("title", titleFromDescription(description))
      precheckData.append("description", description.trim())
      // An empty category tells the server to classify the report. The
      // inferred category is returned and attached only to the final request.
      if (locationPin) {
        precheckData.append("latitude", locationPin.lat.toFixed(7))
        precheckData.append("longitude", locationPin.lng.toFixed(7))
      }
      for (const file of mediaFiles) precheckData.append("media", file)

      const precheck = await precheckConcern(precheckData)
      setPrecheckNotice(precheck.message || "")
      setPhotoVerdicts(precheck.photo_verdicts || [])
      setPrivacyPreview(precheck.privacy_preview ?? null)

      if (precheck.resolved_address) {
        resolvedAddressRef.current = {
          address: precheck.resolved_address.address,
          primary: precheck.resolved_address.address_primary,
          secondary: precheck.resolved_address.address_secondary,
        }
        setAddress(precheck.resolved_address.address)
        setAddressPrimary(precheck.resolved_address.address_primary)
        setAddressSecondary(precheck.resolved_address.address_secondary)
      }

      if (!precheck.can_submit) {
        setFieldErrors((current) => ({ ...current, ...precheck.field_errors }))
        setIsSubmitting(false)
        return
      }
      setFieldErrors({})

      pendingPrecheckRef.current = precheck
      inferredCategoryRef.current = precheck.category || precheck.suggested_category || ""
      if (!inferredCategoryRef.current) {
        setFieldErrors({ description: "We could not determine the type of concern. Add a little more detail and try again." })
        setIsSubmitting(false)
        return
      }
      await advance("duplicate")
    } catch (submitError) {
      toast.error(
        submitError instanceof ApiError
          ? submitError.message
          : "Could not submit report. Try again.",
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  const hasMedia = mediaFiles.length > 0
  // Category-specific requirements are checked by the classification precheck
  // after the model has inferred the category. The only client-side gate is
  // requiring enough text to ask the model for a classification.
  const formReady = Boolean(description.trim())
  const isControlled = controlledOpen !== undefined

  return (
    <>
      {trigger
        ? trigger(() => setOpen(true))
        : !isControlled
          ? (
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
              >
                <PlusIcon className="size-5" />
                Create Report
              </button>
            )
          : null}

      <Dialog
        open={open}
        onClose={requestClose}
        maxW="max-w-[520px]"
        mobileSheet
      >
        <DialogBody className="!flex !h-full !min-h-0 !flex-1 !flex-col !space-y-0 !overflow-hidden !p-0 bg-white">
          {/* h-full keeps the composer/footer pinned on mobile. */}
          <div className="relative flex h-full min-h-0 flex-1 flex-col pt-[max(0.75rem,env(safe-area-inset-top))] md:h-[min(560px,88vh)] md:flex-row md:pt-5">
            {/* Main composer */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex shrink-0 items-center gap-2.5 px-4 sm:px-5">
                <button
                  type="button"
                  onClick={requestClose}
                  className="flex size-11 shrink-0 items-center justify-center rounded-full text-neutral-600 transition-colors hover:bg-neutral-100 sm:size-12"
                  aria-label="Close"
                >
                  <XIcon className="size-6" strokeWidth={2} />
                </button>

                <div className="relative ml-auto flex shrink-0 items-center gap-2.5">
                  <button
                    type="button"
                    disabled={isSubmitting || isCheckingMedia || !formReady}
                    onClick={() => void handleSubmit()}
                    className="inline-flex h-10 items-center justify-center rounded-full bg-primary px-5 text-[14px] font-semibold text-white transition-colors hover:bg-brand-orange-strong disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500 disabled:opacity-100 sm:h-11 sm:px-6 sm:text-[15px]"
                  >
                    {isSubmitting ? "Reporting…" : "Report"}
                  </button>
                </div>
              </div>

              {/* Report form body */}
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">

              {/* Identity */}
              <div className="flex items-center gap-3 px-4 pt-4 sm:px-5">
                <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-slate-soft text-[17px] font-semibold text-navy-muted sm:size-12 sm:text-[18px]">
                  {letter}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[16px] font-semibold leading-tight text-neutral-900">
                    {displayName}
                  </p>
                  {userStreet ? (
                    <p className="truncate text-[13px] leading-tight text-neutral-500">{userStreet}</p>
                  ) : null}
                </div>
              </div>

              {/* Scrollable body — description / media / location chip only */}
              <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-4 sm:px-5">
                <textarea
                  value={description}
                  maxLength={descriptionMax}
                  rows={3}
                  aria-label="Report description"
                  onChange={(e) => {
                    setDescription(e.target.value)
                    if (fieldErrors.description)
                      setFieldErrors((prev) => ({ ...prev, description: "" }))
                    const el = e.currentTarget
                    el.style.height = "auto"
                    el.style.height = `${Math.min(el.scrollHeight, 220)}px`
                  }}
                  onInput={(e) => {
                    const el = e.currentTarget
                    el.style.height = "auto"
                    el.style.height = `${Math.min(el.scrollHeight, 220)}px`
                  }}
                  ref={(el) => {
                    if (!el) return
                    el.style.height = "auto"
                    el.style.height = `${Math.min(Math.max(el.scrollHeight, 72), 220)}px`
                  }}
                   placeholder="Share the issue you're experiencing..."
                   className="max-h-[220px] min-h-[72px] w-full resize-none overflow-y-auto border-0 bg-transparent text-[17px] leading-relaxed text-neutral-900 outline-none placeholder:text-neutral-400"
                  />

                  <div className={cn("mt-3 flex flex-wrap gap-2.5", hasMedia ? "min-h-[168px]" : "min-h-0")}>
                    {hasMedia
                      ? mediaFiles.map((file, index) => {
                          const url = previewUrls[index]
                          const rejected = Boolean(
                            photoVerdicts.find((verdict) => verdict.index === index)?.message,
                          )
                          return (
                            <div
                              key={`${file.name}-${file.lastModified}`}
                              className={cn(
                                "relative h-[148px] w-[148px] overflow-hidden rounded-2xl bg-neutral-100 shadow-sm sm:h-[168px] sm:w-[168px]",
                                rejected ? "ring-2 ring-destructive" : "ring-1 ring-black/5",
                              )}
                            >
                              <button
                                type="button"
                                className="block h-full w-full"
                                onClick={() => setPreviewUrl(url)}
                              >
                                <img src={url} alt="" className="h-full w-full object-cover" />
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setMediaFiles((prev) => prev.filter((_, i) => i !== index))
                                }
                                className="absolute right-2 top-2 flex size-8 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-[2px] transition-colors hover:bg-black/75"
                                aria-label="Remove photo"
                              >
                                <XIcon className="size-4" strokeWidth={2.25} />
                              </button>
                            </div>
                          )
                        })
                      : null}
                  </div>

                  {(() => {
                    // The ring alone says a photo has a problem but never which
                    // one. A resident asked to fix something has to be told what.
                    const notes = photoVerdicts
                      .filter((verdict) => verdict.message && verdict.state !== "relevant")
                      .map((verdict) => ({
                        key: `${verdict.index}-${verdict.state}`,
                        label: mediaFiles.length > 1 ? `Photo ${verdict.index + 1}` : "",
                        message: verdict.message,
                      }))
                    if (notes.length === 0) return null
                    return (
                      <ul className="mt-2 list-none space-y-1 text-xs font-medium text-destructive" role="alert">
                        {notes.map((note) => (
                          <li key={note.key}>
                            {note.label ? `${note.label}: ` : ""}
                            {note.message}
                          </li>
                        ))}
                      </ul>
                    )
                  })()}

                  {(() => {
                  const messages = [
                    fieldErrors.description,
                    fieldErrors.concern,
                    ...(fieldErrors.media
                      ? fieldErrors.media.split("\n").map((m) => m.trim()).filter(Boolean)
                      : []),
                    fieldErrors.address,
                    fieldErrors.precheck,
                  ].filter((msg): msg is string => Boolean(msg && msg.trim()))
                  if (messages.length === 0) return null
                  return (
                    <ul
                      className="mt-2 list-none space-y-1 text-xs font-medium text-destructive"
                      role="alert"
                    >
                      {messages.map((msg) => (
                        <li key={msg}>{msg}</li>
                      ))}
                    </ul>
                  )
                })()}
                {precheckNotice ? (
                  <p className="mt-2 rounded-lg bg-neutral-100 px-3 py-2 text-xs font-medium leading-relaxed text-neutral-700">
                    {precheckNotice}
                  </p>
                ) : null}
                {privacyPreview?.protected_image ? (
                  <div className="mt-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                    <p className="text-xs font-semibold text-neutral-800">
                      Private details will be blurred
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">
                      This is the version the community will see
                      {privacyPreview.detected_classes.length
                        ? ` — ${privacyPreview.detected_classes.join(", ")} hidden`
                        : ""}
                      . Officials still see the original.
                    </p>
                    <img
                      src={privacyPreview.protected_image}
                      alt=""
                      className="mt-2 h-32 w-full rounded-lg object-cover"
                    />
                  </div>
                ) : null}
              </div>

              {/* Bottom chrome: optional location row and the attachment/location toolbar. */}
              <div className="shrink-0 border-t border-neutral-100 bg-white">
                {locationPin && address ? (
                  <div className="px-4 pb-2 pt-3 sm:px-5">
                    <div className="flex w-full items-center gap-3 rounded-md border border-neutral-300 bg-white px-3.5 py-2.5 text-left">
                      <button
                        type="button"
                        onClick={() => setLocationOpen(true)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left transition-colors hover:opacity-75"
                        aria-label="Edit report location"
                      >
                        <MapPinIcon className="size-5 shrink-0 text-neutral-400" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-semibold leading-tight text-neutral-900">
                            {addressPrimary || address}
                          </span>
                          {addressSecondary ? (
                            <span className="mt-0.5 block truncate text-[12px] leading-snug text-neutral-500">
                              {addressSecondary}
                            </span>
                          ) : null}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setLocationPin(null)
                          setAddress("")
                          setAddressPrimary("")
                          setAddressSecondary("")
                        }}
                        className="flex size-10 shrink-0 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800"
                        aria-label="Remove location"
                      >
                        <XIcon className="size-6" strokeWidth={1.75} />
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="flex items-center gap-1 px-3 pt-1.5 sm:px-4">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPT_STRING}
                    multiple
                    aria-label="Add report photos"
                    className="sr-only"
                    onChange={(e) => {
                      void addFiles(Array.from(e.target.files ?? []))
                      e.target.value = ""
                    }}
                  />
                  <input
                    ref={cameraInputRef}
                    type="file"
                    accept="image/jpeg,image/png"
                    capture="environment"
                    aria-label="Take a report photo"
                    className="sr-only"
                    onChange={(e) => {
                      handleCameraCapture(Array.from(e.target.files ?? []))
                      e.target.value = ""
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isCheckingMedia || mediaFiles.length >= MAX_FILES}
                    className={cn(
                      "flex size-10 items-center justify-center rounded-full transition-colors hover:bg-neutral-100 disabled:opacity-50",
                      hasMedia
                        ? "text-neutral-800"
                        : "text-neutral-500 hover:text-neutral-800",
                    )}
                    aria-label="Add photo"
                  >
                    <ImageIcon className="size-5" strokeWidth={1.75} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setLocationOpen(true)}
                    className={cn(
                      "flex size-10 items-center justify-center rounded-full transition-colors hover:bg-neutral-100",
                      locationPin
                        ? "text-neutral-800"
                        : "text-neutral-500 hover:text-neutral-800",
                    )}
                    aria-label="Add location"
                  >
                    <MapPinIcon className="size-5" strokeWidth={1.75} />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      // Live camera where getUserMedia exists; native capture
                      // input (phones without it / insecure contexts) otherwise.
                      const mediaDevices: MediaDevices | undefined = navigator.mediaDevices
                      const live = Boolean(
                        mediaDevices && typeof mediaDevices.getUserMedia === "function",
                      )
                      void handleCameraButtonClick(live)
                    }}
                    disabled={isCheckingMedia || mediaFiles.length >= MAX_FILES}
                    className={cn(
                      "flex size-10 items-center justify-center rounded-full transition-colors hover:bg-neutral-100 disabled:opacity-50",
                      hasMedia
                        ? "text-neutral-800"
                        : "text-neutral-500 hover:text-neutral-800",
                    )}
                    aria-label="Take photo"
                  >
                    <CameraIcon className="size-5" strokeWidth={1.75} />
                  </button>

                </div>

                {/* Mobile safe-area padding under the icon row */}
                <div className="pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pb-[max(0.75rem,env(safe-area-inset-bottom))]" />
              </div>
            </div>
            </div>
          </div>
          </div>
        </DialogBody>
      </Dialog>

      <Suspense fallback={null}>
        <LocationPickerModal
          open={locationOpen}
          onClose={() => setLocationOpen(false)}
          initialLat={locationPin?.lat}
          initialLng={locationPin?.lng}
          initialAddress={address}
          onConfirm={(payload) => {
            setLocationPin({
              lat: payload.lat,
              lng: payload.lng,
              accuracy: null,
              source: payload.source,
            })
            setAddress(payload.address)
            setAddressPrimary(payload.addressPrimary)
            setAddressSecondary(payload.addressSecondary)
            setFieldErrors((prev) => ({ ...prev, address: "" }))
          }}
        />
      </Suspense>

      <CameraCaptureDialog
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={(file) => handleCameraCapture([file])}
      />

      {submittedReport ? (
        <ReportDetailsDialog
          open
          report={submittedReport}
          onClose={() => {
            resetForm()
            setSubmittedReport(null)
            setOpen(false)
          }}
          canShare={submittedReport.visibility === "community" && !submittedReport.escalated_alert}
          onTrack={() => {
            const reportId = submittedReport.public_id
            resetForm()
            setSubmittedReport(null)
            setOpen(false)
            navigate(`/dashboard/reports/${reportId}`)
          }}
          onOpenEmergency={() => {
            const alertId = submittedReport.escalated_alert?.id
            const reportId = submittedReport.public_id
            resetForm()
            setSubmittedReport(null)
            setOpen(false)
            navigate(alertId ? `/dashboard/emergency-history?alert=${alertId}` : `/dashboard/reports/${reportId}`)
          }}
        />
      ) : null}

      {/* Close without reporting? */}
      {closeConfirmOpen ? (
        <div
          className="fixed inset-0 z-[260] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="close-without-reporting-title"
        >
          <div
            className="absolute inset-0 bg-black/45"
            onClick={keepPosting}
            aria-hidden
          />
          <div className="relative z-10 w-full max-w-[340px] rounded-2xl border border-neutral-200 bg-white px-6 pb-6 pt-7 shadow-2xl">
            <h2
              id="close-without-reporting-title"
              className="text-center text-[20px] font-semibold tracking-tight text-neutral-900"
            >
              Close without reporting?
            </h2>
            <button
              type="button"
              onClick={() => void confirmCloseAndSaveDraft()}
              className="mt-6 flex h-12 w-full items-center justify-center rounded-full bg-neutral-200 text-[16px] font-semibold text-neutral-900 transition-colors hover:bg-neutral-300 active:scale-[0.99]"
            >
              Close
            </button>
            <button
              type="button"
              onClick={keepPosting}
              className="mt-3 flex h-11 w-full items-center justify-center rounded-full text-[15px] font-semibold text-neutral-800 transition-colors hover:bg-neutral-50"
            >
              Keep reporting
            </button>
          </div>
        </div>
      ) : null}

      {resolvedMatch ? (
        <div
          className="fixed inset-0 z-[260] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="resolved-match-title"
        >
          <div className="absolute inset-0 bg-black/45" onClick={() => setResolvedMatch(null)} aria-hidden />
          <div className="relative z-10 w-full max-w-[360px] rounded-2xl border border-neutral-200 bg-white px-6 pb-6 pt-7 shadow-2xl">
            <h2
              id="resolved-match-title"
              className="text-center text-[20px] font-semibold tracking-tight text-neutral-900"
            >
              This may already be resolved
            </h2>
            <p className="mt-2 text-center text-[13px] leading-snug text-neutral-500">
              A similar report
              {resolvedMatch.resolved_at ? ` from ${new Date(resolvedMatch.resolved_at).toLocaleDateString()}` : ""} was
              already marked resolved.
            </p>
            {resolvedMatch.preview_url ? (
              <img src={resolvedMatch.preview_url} alt="" className="mt-4 h-40 w-full rounded-xl object-cover" />
            ) : null}
            {resolvedMatch.summary ? (
              <p className="mt-3 rounded-xl bg-neutral-50 px-3 py-2 text-[13px] leading-snug text-neutral-700">
                {resolvedMatch.summary}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => {
                recurrenceOfRef.current = resolvedMatch.concern_id
                setResolvedMatch(null)
                void advance("submit")
              }}
              className="mt-6 flex h-12 w-full items-center justify-center rounded-full bg-primary text-[16px] font-semibold text-white transition-colors hover:bg-brand-orange-strong active:scale-[0.99]"
            >
              It&apos;s still not fixed
            </button>
            <button
              type="button"
              onClick={() => setResolvedMatch(null)}
              className="mt-3 flex h-11 w-full items-center justify-center rounded-full text-[15px] font-semibold text-neutral-800 transition-colors hover:bg-neutral-50"
            >
              Never mind, it&apos;s handled
            </button>
          </div>
        </div>
      ) : null}

      {duplicateConfirm ? (
        <div
          className="fixed inset-0 z-[260] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="duplicate-confirm-title"
        >
          <div className="absolute inset-0 bg-black/45" onClick={() => setDuplicateConfirm(null)} aria-hidden />
          <div className="relative z-10 w-full max-w-[360px] rounded-2xl border border-neutral-200 bg-white px-6 pb-6 pt-7 shadow-2xl">
            <h2
              id="duplicate-confirm-title"
              className="text-center text-[20px] font-semibold tracking-tight text-neutral-900"
            >
              Neighbours already reported this
            </h2>
            <p className="mt-2 text-center text-[13px] leading-snug text-neutral-500">
              {duplicateConfirm.reporter_count === 1
                ? "1 resident has"
                : `${duplicateConfirm.reporter_count} residents have`}{" "}
              reported the same issue nearby. Adding yours to the same incident helps the
              barangay see how many people it affects.
            </p>
            {duplicateConfirm.summary ? (
              <p className="mt-3 rounded-xl bg-neutral-50 px-3 py-2 text-[13px] leading-snug text-neutral-700">
                {duplicateConfirm.summary}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => {
                duplicateOfRef.current = duplicateConfirm.concern_id
                setDuplicateConfirm(null)
                void advance("resolved")
              }}
              className="mt-6 flex h-12 w-full items-center justify-center rounded-full bg-primary text-[16px] font-semibold text-white transition-colors hover:bg-brand-orange-strong active:scale-[0.99]"
            >
              Add to the same incident
            </button>
            <button
              type="button"
              onClick={() => {
                duplicateOfRef.current = null
                setDuplicateConfirm(null)
                void advance("resolved")
              }}
              className="mt-3 flex h-11 w-full items-center justify-center rounded-full text-[15px] font-semibold text-neutral-800 transition-colors hover:bg-neutral-50"
            >
              Mine is a different issue
            </button>
          </div>
        </div>
      ) : null}

      {previewUrl ? (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setPreviewUrl(null)}
        >
          <button
            type="button"
            onClick={() => setPreviewUrl(null)}
            className="absolute right-4 top-4 flex size-10 items-center justify-center rounded-full bg-white/10 text-white"
            aria-label="Close preview"
          >
            <XIcon className="size-5" />
          </button>
          <img
            src={previewUrl}
            alt=""
            className="max-h-[90vh] max-w-full rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </>
  )
}
