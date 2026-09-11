import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import {
  CameraIcon,
  CircleXIcon,
  ImageIcon,
  MapPinIcon,
  PlusIcon,
  XIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import { useAuthSession } from "@/features/auth/auth-session"
import {
  checkConcernMedia,
  checkGuestConcernMedia,
  createConcern,
  getConcern,
  precheckConcern,
  submitGuestConcern,
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
import { lookupRegistrationPinAddress } from "@/features/auth/api"
import { looksLikeCoordinates } from "@/features/dashboard/lib/location-text"

const LocationPickerModal = lazy(
  () => import("@/features/dashboard/components/location-picker")
)

const ALLOWED_TYPES = ["image/png", "image/jpeg"]
const ACCEPT_STRING = ".png,.jpg,.jpeg," + ALLOWED_TYPES.join(",")
const MAX_FILE_SIZE = 10 * 1024 * 1024
const MAX_FILES = 5
const descriptionMin = 40
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

function validationFeedbackFor(report: Concern) {
  if (report.rejection_code === "automated_photo_mismatch") {
    return "The photo contradicts the issue described. Please submit a photo that shows the reported issue."
  }
  if (report.rejection_code.startsWith("automated_street_imagery")) {
    return "Please pin the exact area where the issue is found and upload a matching photo."
  }
  const summary = report.validation_summary?.trim()
  if (summary) return summary
  if (report.ai_assessment?.status === "failed") {
    return "Automated review could not be completed. Your report was not assigned to a unit."
  }
  return "This report was not accepted."
}

function hasValidationError(report: Concern) {
  return (
    report.ai_assessment?.status === "failed" ||
    report.validation_status === "rejected" ||
    report.status === "rejected"
  )
}

const DRAFT_DB = "eboses-resident-drafts"
const DRAFT_STORE = "report-drafts"
const DRAFT_KEY = "current-report"

const DRAFT_CLOSE_ACK_KEY = "eboses-draft-close-ack"

function hasAcknowledgedDraftClose() {
  try {
    return (
      typeof sessionStorage !== "undefined" &&
      sessionStorage.getItem(DRAFT_CLOSE_ACK_KEY) === "1"
    )
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
    request.onupgradeneeded = () =>
      request.result.createObjectStore(DRAFT_STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function readDraft() {
  const database = await openDraftDatabase()
  return new Promise<ReportDraft | undefined>((resolve, reject) => {
    const request = database
      .transaction(DRAFT_STORE)
      .objectStore(DRAFT_STORE)
      .get(DRAFT_KEY)
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
  guest = false,
  initialLocation,
  onGuestSubmitted,
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  trigger?: (open: () => void) => ReactNode
  guest?: boolean
  initialLocation?: {
    lat: number
    lng: number
    address: string
    addressPrimary?: string
    addressSecondary?: string
    source?: "gps" | "manual_pin"
  } | null
  onGuestSubmitted?: (assignedUnit: { name: string; short_name: string } | null) => void
} = {}) {
  const navigate = useNavigate()
  const { user } = useAuthSession()

  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = useCallback(
    (value: boolean) => {
      setInternalOpen(value)
      onOpenChange?.(value)
    },
    [onOpenChange]
  )

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
  const [awaitingValidation, setAwaitingValidation] = useState(false)
  const [isCheckingMedia, setIsCheckingMedia] = useState(false)
  const [submittedReport, setSubmittedReport] = useState<Concern | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [draftRestored, setDraftRestored] = useState(false)
  const [resolvedMatch, setResolvedMatch] =
    useState<ConcernResolvedMatch | null>(null)
  const [duplicateConfirm, setDuplicateConfirm] =
    useState<ConcernActiveDuplicate | null>(null)
  const [photoVerdicts, setPhotoVerdicts] = useState<ConcernPhotoVerdict[]>([])
  const [privacyPreview, setPrivacyPreview] = useState<{
    state: string
    detected_classes: string[]
    protected_image: string
  } | null>(null)

  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false)

  const clientRequestIdRef = useRef(crypto.randomUUID())
  const recurrenceOfRef = useRef<number | null>(null)
  const duplicateOfRef = useRef<number | null>(null)

  const inferredCategoryRef = useRef("")
  const resolvedAddressRef = useRef<{
    address: string
    primary: string
    secondary: string
  } | null>(null)
  const pendingPrecheckRef = useRef<ConcernPrecheckResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const previewUrls = useMemo(
    () => mediaFiles.map((file) => URL.createObjectURL(file)),
    [mediaFiles]
  )
  const displayName = guest
    ? "Community Reporter"
    : user
      ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || "Resident"
      : "Resident"
  const letter = (
    guest
      ? "C"
      : user?.firstName?.[0] || user?.lastName?.[0] || displayName[0] || "U"
  ).toUpperCase()
  const rawStreet = (user?.address || "").split(",")[0]?.trim() || ""
  const userStreet =
    !rawStreet || rawStreet.toLowerCase() === "pending" ? "" : rawStreet
  const submittedReportId = submittedReport?.public_id
  const submittedReportIsProcessing =
    submittedReport?.validation_status === "pending" &&
    submittedReport.ai_assessment?.status !== "failed"

  useEffect(
    () => () => previewUrls.forEach((url) => URL.revokeObjectURL(url)),
    [previewUrls]
  )

  useEffect(() => {
    if (!submittedReportId || !submittedReportIsProcessing) return
    const reportId = submittedReportId

    let cancelled = false
    let timer: number | undefined
    let attempts = 0

    async function refreshSubmittedReport() {
      try {
        const latest = await getConcern(reportId)
        if (cancelled) return
        if (latest.validation_status === "accepted") {
          setAwaitingValidation(false)
          setSubmittedReport(latest)
          setOpen(false)
        } else if (hasValidationError(latest)) {
          setAwaitingValidation(false)
          setFieldErrors((previous) => ({
            ...previous,
            description: validationFeedbackFor(latest),
          }))
          setSubmittedReport(null)
          setOpen(true)
        } else {
          setAwaitingValidation(true)
          setSubmittedReport(latest)
          setOpen(true)
        }
        attempts += 1
        if (
          latest.validation_status === "pending" &&
          latest.ai_assessment?.status !== "failed" &&
          attempts < 15
        ) {
          timer = window.setTimeout(() => void refreshSubmittedReport(), 1000)
        }
      } catch {
        attempts += 1
        if (!cancelled && attempts < 15) {
          timer = window.setTimeout(() => void refreshSubmittedReport(), 1000)
        }
      }
    }

    timer = window.setTimeout(() => void refreshSubmittedReport(), 500)
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [setOpen, submittedReportId, submittedReportIsProcessing])

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
    if (!open || draftRestored || guest) return
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
  }, [open, draftRestored, guest])

  useEffect(() => {
    if (!open || !initialLocation) return
    const frame = window.requestAnimationFrame(() => {
      setAddress(initialLocation.address)
      setAddressPrimary(
        initialLocation.addressPrimary ||
          initialLocation.address.split(",")[0]?.trim() ||
          initialLocation.address
      )
      setAddressSecondary(
        initialLocation.addressSecondary ||
          initialLocation.address.split(",").slice(1).join(", ").trim()
      )
      setLocationPin({
        lat: initialLocation.lat,
        lng: initialLocation.lng,
        accuracy: null,
        source: initialLocation.source || "manual_pin",
      })
      setDraftRestored(true)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open, initialLocation])

  useEffect(() => {
    if (
      guest ||
      !open ||
      !draftRestored ||
      (!description && !address && !locationPin)
    )
      return
    const timeout = window.setTimeout(() => {
      void writeDraft({
        title: titleFromDescription(description),
        description,
        address,
        locationPin,
      })
    }, 500)
    return () => window.clearTimeout(timeout)
  }, [open, draftRestored, description, address, locationPin, guest])

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
    setAwaitingValidation(false)
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
      mediaFiles.length > 0
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
      // The report has already been created at this point. Draft cleanup is
      // best-effort, so an IndexedDB failure must not turn a successful report
      // into a misleading submission error.
      await deleteDraft().catch(() => undefined)
    }
  }

  function requestClose() {
    if (isSubmitting || awaitingValidation) return
    setLocationOpen(false)
    setCloseConfirmOpen(false)

    if (guest) {
      setOpen(false)
      return
    }

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
    const descriptionLength = description.trim().length
    if (!descriptionLength) {
      errors.description = "Describe what happened."
    } else if (descriptionLength < descriptionMin) {
      errors.description = `Describe the issue in at least ${descriptionMin} characters.`
    }
    if (!mediaFiles.length) errors.media = "Attach at least one image."
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  function cleanMediaErrorMessage(raw: string): string {
    let text = raw.trim()

    const afterColon = text.includes(":")
      ? text.slice(text.lastIndexOf(":") + 1).trim()
      : text
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
    if (
      error instanceof ApiError &&
      error.data &&
      typeof error.data === "object"
    ) {
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
    const candidates: File[] = []
    // A new attachment set needs a fresh precheck; never carry a verdict from
    // an earlier photo into the new preview.
    setPhotoVerdicts([])
    setPrivacyPreview(null)
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
            existing.lastModified === file.lastModified
        )
      ) {
        errors.push("This file is already selected.")
        continue
      }
      candidates.push(file)
    }

    const room = Math.max(0, MAX_FILES - mediaFiles.length)
    const filesToCheck = candidates.slice(0, room)
    if (candidates.length > room) {
      errors.push(`You can attach up to ${MAX_FILES} photos.`)
    }

    if (filesToCheck.length > 0) {
      try {
        // Check the whole batch once so the AI authenticity review does not
        // make the resident wait once per attachment.
        const checkData = new FormData()
        for (const file of filesToCheck) checkData.append("media", file)
        const result = guest
          ? await checkGuestConcernMedia(checkData)
          : await checkConcernMedia(checkData)
        const checkedFiles = result.files ?? []
        const accepted = checkedFiles
          .map((checkedFile, resultIndex) => ({
            ...checkedFile,
            index:
              Number.isInteger(checkedFile.index) ? checkedFile.index : resultIndex,
          }))
          .filter((checkedFile) => checkedFile.status === "accepted")
        const rejectedMessages = checkedFiles
          .filter((checkedFile) => checkedFile.status === "rejected")
          .map((checkedFile) => checkedFile.message)
          .filter(Boolean)
        valid.push(
          ...accepted
            .map((checkedFile) => filesToCheck[checkedFile.index])
            .filter((file): file is File => Boolean(file))
        )
        errors.push(...rejectedMessages)
      } catch (error) {
        errors.push(mediaErrorFromUnknown(error))
      }
    }
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
      const resolved = await lookupRegistrationPinAddress(lat, lng)
      if (!resolved.inside_community) {
        toast.error(
          "No active E-Boses community covers your current location. Pin another location on the map."
        )
        return false
      }
      setLocationPin({
        lat,
        lng,
        accuracy: pos.coords.accuracy ?? null,
        source: "gps",
      })

      const primary = (resolved.label || resolved.street).trim()
      const usable =
        primary &&
        primary !== "Finding street…" &&
        primary !== "Selected location" &&
        !/^lat\b/i.test(primary) &&
        !/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(primary)
      if (!usable) {
        toast.error(
          "Location saved, but no street name was found. Check the pin before posting."
        )
        return true
      }
      const secondary = resolved.community.trim()
      setAddress([primary, secondary].filter(Boolean).join(", "))
      setAddressPrimary(primary)
      setAddressSecondary(secondary)
      setFieldErrors((prev) => ({ ...prev, address: "" }))
      return true
    } catch (err) {
      const code =
        typeof err === "object" && err !== null
          ? (err as GeolocationPositionError).code
          : 0
      toast.error(
        code === 1
          ? "Location is blocked. Allow it via the lock icon in your address bar, then take the photo again."
          : "Couldn't read your location. Make sure location services are on."
      )
      return false
    }
  }

  /** Permission state without side effects: "granted" | "denied" | "prompt" | null. */
  async function geoPermissionState(): Promise<
    "granted" | "denied" | "prompt" | null
  > {
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
      if (!locationPin || locationPin.source !== "gps")
        void resolveGpsLocation()
    })
  }

  /** Same as geoPermissionState, for the camera — checked before opening the
   * live capture dialog so an already-denied permission never flashes the
   * camera modal open just to immediately close it. */
  async function cameraPermissionState(): Promise<
    "granted" | "denied" | "prompt" | null
  > {
    try {
      if (!("permissions" in navigator)) return null
      const status = await navigator.permissions.query({
        name: "camera" as PermissionName,
      })
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
      toast.error(
        "Camera is blocked. Allow it via the lock icon in your address bar, then try again."
      )
      return
    }
    // Location is asked for while this dialog is still on screen: once the
    // camera modal is up, a permission prompt lands behind it.
    const state = await geoPermissionState()
    if (state === "denied") {
      toast.error(
        "Location is blocked. Allow it via the lock icon in your address bar, then take the photo again."
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

    const resolved = resolvedAddressRef.current
    const primary =
      resolved?.primary ||
      (addressPrimary || address).trim().split(",")[0]?.trim() ||
      address.trim()
    const secondary = resolved?.secondary ?? addressSecondary.trim()
    const looksLikeCoords =
      !primary ||
      /^lat\b/i.test(primary) ||
      /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(primary)

    if (guest) {
      if (!locationPin) {
        setFieldErrors((prev) => ({
          ...prev,
          address: "Choose the report location before submitting.",
        }))
        return null
      }
      if (looksLikeCoords) {
        setFieldErrors((prev) => ({
          ...prev,
          address: "Pin a location with a street name before submitting.",
        }))
        return null
      }
      formData.append("description", description.trim())
      formData.append(
        "address",
        (
          resolved?.address ||
          (secondary ? `${primary}, ${secondary}` : primary)
        ).slice(0, 255)
      )
      formData.append("latitude", locationPin.lat.toFixed(7))
      formData.append("longitude", locationPin.lng.toFixed(7))
      formData.append("location_source", locationPin.source ?? "manual_pin")
      for (const file of mediaFiles) formData.append("media", file)
      return formData
    }

    formData.append("title", title)
    formData.append("description", description.trim())
    formData.append("category", selectedCategoryCode())
    // The address is the street line the server resolved from the pin. The
    // typed text is only a fallback for a pin the geocoder could not place.
    const locationRequired =
      pendingPrecheckRef.current?.location_required ?? true
    if (locationRequired && looksLikeCoords) {
      setFieldErrors((prev) => ({
        ...prev,
        address: "Pin a location with a street name before submitting.",
      }))
      return null
    }
    if (!looksLikeCoords) {
      const storedAddress =
        resolved?.address || (secondary ? `${primary}, ${secondary}` : primary)
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

  async function finalizeSubmit(options?: {
    escalate?: boolean
    emergencyType?: string
  }) {
    const formData = buildSubmitFormData()
    if (!formData) return
    setIsSubmitting(true)
    try {
      if (guest) {
        const result = await submitGuestConcern(formData)
        setOpen(false)
        resetForm()
        onGuestSubmitted?.(result.assigned_unit ?? null)
        return
      }
      const report = await createConcern(formData, {
        escalate: options?.escalate,
        emergencyType: options?.emergencyType,
        recurrenceOf: recurrenceOfRef.current ?? undefined,
        duplicateOf: duplicateOfRef.current ?? undefined,
      })
      await deleteDraft()
      // A previous precheck may have displayed a local validation message.
      // Do not carry that transient feedback into the successful submission
      // state, especially when the vision review was deferred to the backend.
      setPhotoVerdicts([])
      setPrivacyPreview(null)
      setFieldErrors({})
      if (report.validation_status === "accepted") {
        setAwaitingValidation(false)
        setSubmittedReport(report)
        setOpen(false)
      } else if (hasValidationError(report)) {
        setAwaitingValidation(false)
        setFieldErrors((previous) => ({
          ...previous,
          description: validationFeedbackFor(report),
        }))
        setSubmittedReport(null)
        setOpen(true)
      } else {
        setAwaitingValidation(true)
        setSubmittedReport(report)
        setOpen(true)
      }
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
      if (
        submitError instanceof ApiError &&
        submitError.data &&
        typeof submitError.data === "object"
      ) {
        const responseData = submitError.data as Record<string, unknown>
        const responsePhotoVerdicts = Array.isArray(responseData.photo_verdicts)
          ? responseData.photo_verdicts.flatMap((item) => {
              if (!item || typeof item !== "object") return []
              const verdict = item as Record<string, unknown>
              const index = verdict.index
              const state = verdict.state
              const message = verdict.message
              if (
                typeof index !== "number" ||
                !Number.isInteger(index) ||
                typeof message !== "string" ||
                ![
                  "relevant",
                  "unrelated",
                  "unclear",
                  "unsupported",
                  "flagged",
                ].includes(String(state))
              ) {
                return []
              }
              return [
                {
                  index,
                  state: state as ConcernPhotoVerdict["state"],
                  message,
                },
              ]
            })
          : []
        setPhotoVerdicts(responsePhotoVerdicts)

        const nextErrors: Record<string, string> = {}
        const userFacingFields = new Set([
          "title",
          "description",
          "category",
          "media",
          "address",
          "location",
        ])
        for (const [key, value] of Object.entries(responseData)) {
          if (!userFacingFields.has(key)) continue
          const first = Array.isArray(value) ? value[0] : value
          if (typeof first === "string") nextErrors[key] = first
        }
        if (Object.keys(nextErrors).length > 0) {
          setAwaitingValidation(false)
          setSubmittedReport(null)
          setOpen(true)
          setFieldErrors(nextErrors)
          return
        }
      }
      toast.error(
        submitError instanceof ApiError
          ? submitError.message
          : "Could not submit report. Try again."
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
    // Clear feedback from an earlier blocked attempt before starting a new
    // precheck. Otherwise a successful retry can briefly retain its old red
    // photo ring while the request is in flight.
    setPhotoVerdicts([])
    setPrivacyPreview(null)
    setFieldErrors({})
    if (guest) {
      await finalizeSubmit()
      return
    }
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
      setPhotoVerdicts(precheck.photo_verdicts || [])
      setPrivacyPreview(precheck.privacy_preview ?? null)

      if (precheck.resolved_address) {
        // The precheck answer is catalog-only (no Nominatim round trip), so a
        // pin outside the street catalog — a different community, a new
        // subdivision — degrades to the "Pinned location" placeholder. That
        // must never overwrite the real street the map picker already
        // reverse-geocoded for the resident: adopt the server answer only
        // when it is a usable street or the picker had nothing better.
        const currentPrimary = (addressPrimary || address).trim()
        const currentUsable =
          Boolean(currentPrimary) && !looksLikeCoordinates(currentPrimary)
        const precheckPrimary = (
          precheck.resolved_address.address_primary || ""
        ).trim()
        const precheckUsable =
          Boolean(precheckPrimary) && !looksLikeCoordinates(precheckPrimary)
        if (!currentUsable || precheckUsable) {
          resolvedAddressRef.current = {
            address: precheck.resolved_address.address,
            primary: precheck.resolved_address.address_primary,
            secondary: precheck.resolved_address.address_secondary,
          }
          setAddress(precheck.resolved_address.address)
          setAddressPrimary(precheck.resolved_address.address_primary)
          setAddressSecondary(precheck.resolved_address.address_secondary)
        }
      }

      if (!precheck.can_submit) {
        setFieldErrors((current) => ({ ...current, ...precheck.field_errors }))
        setIsSubmitting(false)
        return
      }
      setFieldErrors({})

      pendingPrecheckRef.current = precheck
      inferredCategoryRef.current =
        precheck.category || precheck.suggested_category || ""
      if (!inferredCategoryRef.current) {
        setFieldErrors({
          description:
            "We could not determine the type of concern. Add a little more detail and try again.",
        })
        setIsSubmitting(false)
        return
      }
      await advance("duplicate")
    } catch (submitError) {
      toast.error(
        submitError instanceof ApiError
          ? submitError.message
          : "Could not submit report. Try again."
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  const hasMedia = mediaFiles.length > 0
  const descriptionLength = description.trim().length
  // Category-specific requirements are checked by the classification precheck
  // after the model has inferred the category. The client-side gates are:
  // at least 40 characters, one photo, and a set location pin.
  const formReady =
    descriptionLength >= descriptionMin && hasMedia && Boolean(locationPin)
  const isControlled = controlledOpen !== undefined

  return (
    <>
      {trigger ? (
        trigger(() => setOpen(true))
      ) : !isControlled ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
        >
          <PlusIcon className="size-5" />
          Create Report
        </button>
      ) : null}

      <Dialog
        // The location picker is a child flow. Hide this sheet while it is
        // active so the two mobile sheets never stack on top of each other.
        open={open && !locationOpen}
        onClose={requestClose}
        maxW="max-w-[520px]"
        mobileSheet
      >
        <DialogBody className="!flex !h-full !min-h-0 !flex-1 !flex-col !space-y-0 !overflow-hidden bg-white !p-0">
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
                      disabled={
                        isSubmitting ||
                        awaitingValidation ||
                        isCheckingMedia ||
                        !formReady
                      }
                      onClick={() => void handleSubmit()}
                      className="inline-flex h-10 items-center justify-center rounded-full bg-primary px-5 text-[14px] font-semibold text-white transition-colors hover:bg-brand-orange-strong disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500 disabled:opacity-100 sm:h-11 sm:px-6 sm:text-[15px]"
                    >
                      {isSubmitting || awaitingValidation
                        ? "Reporting…"
                        : guest
                          ? "Submit"
                          : "Report"}
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
                      <p className="truncate text-[16px] leading-tight font-semibold text-neutral-900">
                        {displayName}
                      </p>
                      {guest ? (
                        <p className="truncate text-[13px] leading-tight text-neutral-500">
                          Only your report and location are shared
                        </p>
                      ) : userStreet ? (
                        <p className="truncate text-[13px] leading-tight text-neutral-500">
                          {userStreet}
                        </p>
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
                        setPhotoVerdicts([])
                        setPrivacyPreview(null)
                        if (fieldErrors.description)
                          setFieldErrors((prev) => ({
                            ...prev,
                            description: "",
                          }))
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
                      minLength={descriptionMin}
                      className="max-h-[220px] min-h-[72px] w-full resize-none overflow-y-auto border-0 bg-transparent text-[17px] leading-relaxed text-neutral-900 outline-none placeholder:text-neutral-400"
                    />

                    <div
                      className={cn(
                        "mt-3 flex flex-wrap gap-2.5",
                        hasMedia ? "min-h-[168px]" : "min-h-0"
                      )}
                    >
                      {hasMedia
                        ? mediaFiles.map((file, index) => {
                            const url = previewUrls[index]
                            const rejected = Boolean(
                              photoVerdicts.find(
                                (verdict) => verdict.index === index
                              )?.message
                            )
                            return (
                              <div
                                key={`${file.name}-${file.lastModified}`}
                                className={cn(
                                  "relative h-[148px] w-[148px] overflow-hidden rounded-2xl bg-neutral-100 shadow-sm sm:h-[168px] sm:w-[168px]",
                                  rejected
                                    ? "ring-2 ring-destructive"
                                    : "ring-1 ring-black/5"
                                )}
                              >
                                <button
                                  type="button"
                                  className="block h-full w-full"
                                  onClick={() => setPreviewUrl(url)}
                                >
                                  <img
                                    src={url}
                                    alt=""
                                    className="h-full w-full object-cover"
                                  />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setPhotoVerdicts([])
                                    setPrivacyPreview(null)
                                    setMediaFiles((prev) =>
                                      prev.filter((_, i) => i !== index)
                                    )
                                  }}
                                  className="absolute top-2 right-2 flex size-8 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-[2px] transition-colors hover:bg-black/75"
                                  aria-label="Remove photo"
                                >
                                  <XIcon
                                    className="size-4"
                                    strokeWidth={2.25}
                                  />
                                </button>
                              </div>
                            )
                          })
                        : null}
                    </div>

                    {fieldErrors.description ? (
                      <p
                        className="mt-2 flex items-start gap-1.5 text-xs font-medium text-destructive"
                        role="alert"
                      >
                        <CircleXIcon
                          className="mt-0.5 size-3.5 shrink-0"
                          strokeWidth={2}
                          aria-hidden
                        />
                        <span>{fieldErrors.description}</span>
                      </p>
                    ) : null}

                    {(() => {
                      const messages = [
                        fieldErrors.concern,
                        ...(fieldErrors.media
                          ? fieldErrors.media
                              .split("\n")
                              .map((m) => m.trim())
                              .filter(Boolean)
                          : []),
                        fieldErrors.address,
                        fieldErrors.precheck,
                      ].filter((msg): msg is string =>
                        Boolean(msg && msg.trim())
                      )
                      if (messages.length === 0) return null
                      return (
                        <ul
                          className="mt-2 list-none space-y-1 text-xs font-medium text-destructive"
                          role="alert"
                        >
                          {messages.map((msg) => (
                            <li key={msg} className="flex items-start gap-1.5">
                              <CircleXIcon
                                className="mt-0.5 size-3.5 shrink-0"
                                strokeWidth={2}
                                aria-hidden
                              />
                              <span>{msg}</span>
                            </li>
                          ))}
                        </ul>
                      )
                    })()}
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
                      <div className="px-4 pt-3 pb-2 sm:px-5">
                        <div className="flex w-full items-center gap-3 rounded-md border border-neutral-300 bg-white px-3.5 py-2.5 text-left">
                          <button
                            type="button"
                            onClick={() => setLocationOpen(true)}
                            className="flex min-w-0 flex-1 items-center gap-3 text-left transition-colors hover:opacity-75"
                            aria-label="Edit report location"
                          >
                            <MapPinIcon className="size-5 shrink-0 text-neutral-400" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[14px] leading-tight font-semibold text-neutral-900">
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
                              setPhotoVerdicts([])
                              setPrivacyPreview(null)
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
                        className="hidden"
                        tabIndex={-1}
                        hidden
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
                        className="hidden"
                        tabIndex={-1}
                        hidden
                        onChange={(e) => {
                          handleCameraCapture(Array.from(e.target.files ?? []))
                          e.target.value = ""
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={
                          isCheckingMedia || mediaFiles.length >= MAX_FILES
                        }
                        className={cn(
                          "flex size-10 items-center justify-center rounded-full transition-colors hover:bg-neutral-100 disabled:opacity-50",
                          hasMedia
                            ? "text-neutral-800"
                            : "text-neutral-500 hover:text-neutral-800"
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
                            : "text-neutral-500 hover:text-neutral-800"
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
                          const mediaDevices: MediaDevices | undefined =
                            navigator.mediaDevices
                          const live = Boolean(
                            mediaDevices &&
                            typeof mediaDevices.getUserMedia === "function"
                          )
                          void handleCameraButtonClick(live)
                        }}
                        disabled={
                          isCheckingMedia || mediaFiles.length >= MAX_FILES
                        }
                        className={cn(
                          "flex size-10 items-center justify-center rounded-full transition-colors hover:bg-neutral-100 disabled:opacity-50",
                          hasMedia
                            ? "text-neutral-800"
                            : "text-neutral-500 hover:text-neutral-800"
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
          signup={guest}
          guestReport={guest}
          coverageScope="served"
          onConfirm={(payload) => {
            setPhotoVerdicts([])
            setPrivacyPreview(null)
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

      {submittedReport &&
      (submittedReport.validation_status !== "pending" ||
        submittedReport.ai_assessment?.status === "failed") ? (
        <ReportDetailsDialog
          open
          report={submittedReport}
          onClose={() => {
            resetForm()
            setSubmittedReport(null)
            setOpen(false)
          }}
          canShare={
            submittedReport.validation_status === "accepted" &&
            submittedReport.visibility === "community" &&
            !submittedReport.escalated_alert
          }
          onTrack={() => {
            const reportId = submittedReport.public_id
            resetForm()
            setSubmittedReport(null)
            setOpen(false)
            navigate(`/dashboard/reports/${reportId}`)
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
          <div className="relative z-10 w-full max-w-[340px] rounded-2xl border border-neutral-200 bg-white px-6 pt-7 pb-6 shadow-2xl">
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
          <div
            className="absolute inset-0 bg-black/45"
            onClick={() => setResolvedMatch(null)}
            aria-hidden
          />
          <div className="relative z-10 w-full max-w-[360px] rounded-2xl border border-neutral-200 bg-white px-6 pt-7 pb-6 shadow-2xl">
            <h2
              id="resolved-match-title"
              className="text-center text-[20px] font-semibold tracking-tight text-neutral-900"
            >
              This may already be resolved
            </h2>
            <p className="mt-2 text-center text-[13px] leading-snug text-neutral-500">
              A similar report
              {resolvedMatch.resolved_at
                ? ` from ${new Date(resolvedMatch.resolved_at).toLocaleDateString()}`
                : ""}{" "}
              was already marked resolved.
            </p>
            {resolvedMatch.preview_url ? (
              <img
                src={resolvedMatch.preview_url}
                alt=""
                className="mt-4 h-40 w-full rounded-xl object-cover"
              />
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
          <div
            className="absolute inset-0 bg-black/45"
            onClick={() => setDuplicateConfirm(null)}
            aria-hidden
          />
          <div className="relative z-10 w-full max-w-[360px] rounded-2xl border border-neutral-200 bg-white px-6 pt-7 pb-6 shadow-2xl">
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
              reported the same issue nearby. Adding yours to the same incident
              helps the barangay see how many people it affects.
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
            className="absolute top-4 right-4 flex size-10 items-center justify-center rounded-full bg-white/10 text-white"
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
