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
  InfoIcon,
  LoaderCircleIcon,
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
const MAX_FILES = 3
const descriptionMin = 40
const descriptionMax = 1500
const PHOTO_MISMATCH_MESSAGE =
  "The photo does not show the issue described in the report. Please submit a photo that clearly shows the reported issue."
const PHOTO_MISMATCH_FRIENDLY_MESSAGE =
  "Please remove photos that don't show the reported issue and upload clear ones."
const STREET_IMAGERY_FEEDBACK =
  "Please pin the exact area where the issue is found and upload a matching photo."

type FooterErrorTone = "error" | "info"

const FRIENDLY_ERROR_TEXT: Record<string, string> = {
  "Describe what happened.":
    "Tell us what happened — a short description is required.",
  "Describe the issue in at least 40 characters.":
    "Add a bit more detail (at least 40 characters) so officials understand the issue.",
  "Attach at least one image.":
    "Add at least one photo so officials can see the issue.",
  "Unsupported format. Use JPG or PNG.":
    "That file type isn't supported. Please choose a JPG or PNG photo.",
  "File must be 10 MB or smaller.":
    "That photo is over 10 MB. Try a smaller version or take a new photo.",
  "This file is already selected.": "You've already added this photo.",
  "You can attach up to 3 photos.":
    "You can add up to 3 photos — remove one to add another.",
  "One or more photos could not be validated.":
    "We couldn't check one or more photos. Try adding them again.",
  "This photo was already uploaded before.":
    "This photo was already used in another report. Please use a different photo.",
  "This image appears to have been uploaded before.":
    "This photo was already used in another report. Please use a different photo.",
  "Report attachment files must be 10MB or smaller.":
    "That photo is over 10 MB. Try a smaller version or take a new photo.",
  "Report attachment files must be JPG, JPEG, or PNG.":
    "That file type isn't supported. Please choose a JPG or PNG photo.",
  "Report attachment files must be valid JPG, JPEG, or PNG files.":
    "That file looks damaged or isn't a real photo. Please choose another one.",
  "Uploaded file content does not match its extension or MIME type.":
    "That file doesn't look like a real photo. Please choose another one.",
  "This photo appears to be AI-generated. Please upload a genuine photo taken with your camera.":
    "Please upload an original, unedited photo taken with your camera.",
  "This photo appears to be edited or digitally altered. Please upload the original, unedited photo.":
    "Please upload an original, unedited photo taken with your camera.",
  "This photo appears digitally manipulated. Please upload a genuine, unedited photo taken with your camera.":
    "Please upload an original, unedited photo taken with your camera.",
  "This photo could not pass the authenticity check. Please upload the original photo.":
    "Please upload an original, unedited photo taken with your camera.",
  "Proof image is too small. Use a clearer, larger photo.":
    "That photo is too small to see clearly. Move closer and take a bigger, clearer photo.",
  "Proof image has no visible detail. Upload a clearer photo.":
    "That photo came out blank or unclear. Please take a clearer photo with good lighting.",
  "Uploaded file failed malware scanning.":
    "That file didn't pass our safety check. Please try a different photo.",
  "Image uploads must be valid JPG or PNG files.":
    "That file isn't a valid photo. Please choose a JPG or PNG image.",
  "The photo contradicts the issue described. Upload a matching photo.":
    PHOTO_MISMATCH_MESSAGE,
  "The photo contradicts the issue described. Please submit a photo that shows the reported issue.":
    PHOTO_MISMATCH_MESSAGE,
  [PHOTO_MISMATCH_MESSAGE]: PHOTO_MISMATCH_MESSAGE,
  "The photo does not clearly show the issue described.":
    "It's hard to tell the issue from this photo. Try one that shows the problem more clearly.",
  "This photo appears to be AI-generated or edited. Please upload a genuine photo taken with your camera.":
    "Please upload an original, unedited photo taken with your camera.",
  "This report does not describe a valid community issue.":
    "This doesn't look like a community issue we handle.",
  "Add a clearer description of the issue.":
    "Tell us a little more — what is the issue, and where exactly is it?",
  "We could not determine the type of concern. Add a little more detail and try again.":
    "We couldn't tell what kind of issue this is. Add a little more detail and try again.",
  "A similar report already exists near this location.":
    "Someone nearby already reported this. Add details only if yours is a different issue.",
  "Choose the report location before submitting.":
    "Choose where this happened on the map before submitting.",
  "Pin a location with a street name before submitting.":
    "Drop a pin where the issue is — we need a street name, not just coordinates.",
  "Pin a location with a street name.":
    "Drop a pin where the issue is — we need a street name, not just coordinates.",
  "Choose a location inside an active community.":
    "That spot is outside our covered areas. Please pin a location inside your community.",
  "Choose a concern category.": "Pick what kind of issue this is.",
  "You already have an active emergency.":
    "You already have an active emergency alert. Please wait for it to be handled first.",
  "Automated review could not be completed. Your report was not assigned to a unit.":
    "Our automatic check couldn't finish, so your report wasn't assigned yet. Please try submitting again.",
  "This report was not accepted.":
    "Sorry, this report wasn't accepted. Check the feedback above and try again.",
}

const INFO_ERROR_TEXT: Record<string, string> = {
  "This photo could not be checked automatically. An official will review it.":
    "We couldn't check this photo automatically — an official will review it. No need to do anything.",
  "Authenticity could not be confirmed automatically; an official will review it.":
    "We'll let an official take a look at this photo. Nothing for you to fix.",
  "This photo could not be read. An official will review it.":
    "We couldn't read this photo, so an official will review it. No need to do anything.",
  "Your photo could not be checked automatically. An official will review it.":
    "We couldn't check your photo automatically — an official will review it. No need to do anything.",
}

function friendlyFooterError(raw: string): {
  text: string
  tone: FooterErrorTone
} {
  const text = raw.trim()
  const info = INFO_ERROR_TEXT[text]
  if (info) return { text: info, tone: "info" }
  const friendly = FRIENDLY_ERROR_TEXT[text]
  if (friendly) return { text: friendly, tone: "error" }
  if (text.startsWith("Image resolution is too high")) {
    return {
      text: "That photo is too large to process. Try a smaller version.",
      tone: "error",
    }
  }
  if (text.startsWith("Location is too far from")) {
    return {
      text: "That spot is outside your community. Please pin a place inside your community.",
      tone: "error",
    }
  }
  return { text, tone: "error" }
}

function isPhotoRejectionMessage(raw: unknown): boolean {
  if (typeof raw !== "string") return false
  return (
    raw === PHOTO_MISMATCH_MESSAGE ||
    raw === PHOTO_MISMATCH_FRIENDLY_MESSAGE ||
    raw ===
      "The photo contradicts the issue described. Upload a matching photo." ||
    raw ===
      "The photo contradicts the issue described. Please submit a photo that shows the reported issue." ||
    raw === "The photo does not clearly show the issue described." ||
    raw === STREET_IMAGERY_FEEDBACK ||
    raw.startsWith(
      "Some of the photos could not pass the authenticity check."
    ) ||
    raw.startsWith("This photo could not pass the authenticity check.") ||
    raw.startsWith("Some of the photos could not be validated.") ||
    raw.startsWith("This photo could not be validated.") ||
    raw === "Please upload an original, unedited photo." ||
    raw.startsWith("This photo could not pass the authenticity check.") ||
    isHardMediaRejectionMessage(raw)
  )
}

function isHardMediaRejectionMessage(raw: unknown): boolean {
  if (typeof raw !== "string") return false
  const text = raw.trim()
  if (!text) return false
  // A review-required result is accepted into the composer and must not be
  // treated as a hard rejection just because it mentions authenticity.
  if (
    /could not be (?:checked|confirmed) automatically|official will review/i.test(
      text
    )
  ) {
    return false
  }
  return (
    /already used in another report|already uploaded|uploaded before/i.test(
      text
    ) ||
    /original,?\s*unedited|ai[- ]generated|digitally (?:altered|manipulated)/i.test(
      text
    ) ||
    /could not pass the authenticity check/i.test(text)
  )
}

function mediaCheckErrorMessages(error: unknown): string[] {
  if (!(error instanceof ApiError)) return []
  const messages = [error.message]
  if (error.data && typeof error.data === "object") {
    const media = (error.data as { media?: unknown }).media
    if (typeof media === "string") messages.push(media)
    if (Array.isArray(media)) {
      for (const item of media) {
        if (typeof item === "string") messages.push(item)
        if (Array.isArray(item) && typeof item[0] === "string") {
          messages.push(item[0])
        }
      }
    }
  }
  return [...new Set(messages.map((message) => message.trim()).filter(Boolean))]
}

function photoVerdictErrorMessage(
  verdicts: ConcernPhotoVerdict[],
  multiplePhotos = verdicts.length > 1
) {
  if (
    verdicts.some(
      (verdict) => verdict.state === "unrelated" || verdict.state === "unclear"
    )
  ) {
    return multiplePhotos
      ? PHOTO_MISMATCH_FRIENDLY_MESSAGE
      : PHOTO_MISMATCH_MESSAGE
  }
  if (verdicts.some((verdict) => verdict.state === "flagged")) {
    return multiplePhotos
      ? "Some of the photos could not pass the authenticity check. Please remove them and upload original, unedited photos."
      : "This photo could not pass the authenticity check. Please remove it and upload an original, unedited photo."
  }
  return multiplePhotos
    ? "Some of the photos could not be validated. Please remove them and upload different photos."
    : "This photo could not be validated. Please remove it and upload a different photo."
}

function isAutomatedPhotoMismatchError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false
  if (error.message.trim() === "automated_photo_mismatch") return true
  if (!error.data || typeof error.data !== "object") return false
  const payload = error.data as Record<string, unknown>
  return ["code", "detail", "rejection_code"].some(
    (key) => payload[key] === "automated_photo_mismatch"
  )
}

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
    return STREET_IMAGERY_FEEDBACK
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
  onGuestSubmitted?: (
    assignedUnit: { name: string; short_name: string } | null
  ) => void
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
  const [submittedReport, setSubmittedReport] = useState<Concern | null>(null)
  const [isCheckingMedia, setIsCheckingMedia] = useState(false)
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
    ? "Community reporter"
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
          window.dispatchEvent(new Event("eboses:report-created"))
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

  async function addFiles(files: File[]): Promise<File[]> {
    const errors: string[] = []
    const candidates: File[] = []
    // Keep existing verdicts until their photos are removed. A retry should
    // not hide a still-attached invalid photo or its latest feedback.
    const existingInvalidVerdict = photoVerdicts.some(
      (verdict) => verdict.state !== "relevant" && Boolean(verdict.message)
    )
    setFieldErrors((current) => {
      const next: Record<string, string> = { ...current }
      if (!existingInvalidVerdict) next.media = ""
      if (isPhotoRejectionMessage(current.description)) next.description = ""
      return next
    })
    setPrivacyPreview(null)
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
    // Duplicate and authenticity failures are hard upload rejections: the
    // failed file never enters the preview. Relevance/location failures are
    // different; they come from final report validation and remain visible
    // with a red border so the resident can remove or replace them.
    let added: File[] = filesToCheck
    if (filesToCheck.length > 0) {
      setIsCheckingMedia(true)
      try {
        const checkData = new FormData()
        checkData.append("forensics_only", "true")
        for (const file of filesToCheck) checkData.append("media", file)
        const result = guest
          ? await checkGuestConcernMedia(checkData)
          : await checkConcernMedia(checkData)
        const checkedFiles = Array.isArray(result.files) ? result.files : []
        const rejectedIndexes = new Set<number>()
        for (const [resultIndex, checkedFile] of checkedFiles.entries()) {
          if (checkedFile.status !== "rejected") continue
          const fileIndex = checkedFile.index ?? resultIndex
          if (Number.isInteger(fileIndex) && filesToCheck[fileIndex]) {
            rejectedIndexes.add(fileIndex)
          }
          errors.push(
            checkedFile.message ||
              "This photo could not be accepted. Please upload a different photo."
          )
        }
        added = filesToCheck.filter((_, index) => !rejectedIndexes.has(index))
      } catch (error) {
        const messages = mediaCheckErrorMessages(error)
        errors.push(
          ...(messages.length
            ? messages
            : ["This photo could not be checked. Please try again."])
        )
        // Older API instances can still return a request-level 400 for a
        // duplicate/authenticity failure. Do not let those files slip into
        // the preview while keeping files visible for a transient check error.
        if (messages.some(isHardMediaRejectionMessage)) added = []
      } finally {
        setIsCheckingMedia(false)
      }
    }
    setMediaFiles((prev) => [...prev, ...added])
    const unique = [...new Set(errors.filter(Boolean))]
    setFieldErrors((current) => ({
      ...current,
      // Newline-separated so the UI can list every media check message
      media: unique[0] ?? (existingInvalidVerdict ? current.media : ""),
    }))
    return added
  }

  function applyPhotoVerdicts(
    verdicts: ConcernPhotoVerdict[],
    options?: { includeUnclear?: boolean }
  ) {
    const invalidStates = new Set<ConcernPhotoVerdict["state"]>([
      "unrelated",
      "flagged",
    ])
    if (options?.includeUnclear) {
      invalidStates.add("unclear")
      invalidStates.add("unsupported")
    }
    const invalidVerdicts = verdicts.filter((verdict) =>
      invalidStates.has(verdict.state)
    )
    setPhotoVerdicts(verdicts)
    if (invalidVerdicts.length === 0) {
      setFieldErrors((current) => ({
        ...current,
        media: isPhotoRejectionMessage(current.media) ? "" : current.media,
      }))
      return
    }
    setFieldErrors((current) => ({
      ...current,
      media: photoVerdictErrorMessage(invalidVerdicts, mediaFiles.length > 1),
    }))
  }

  function showPhotoMismatchError() {
    setAwaitingValidation(false)
    setSubmittedReport(null)
    setOpen(true)
    setFieldErrors((current) => ({
      ...current,
      media:
        mediaFiles.length > 1
          ? PHOTO_MISMATCH_FRIENDLY_MESSAGE
          : PHOTO_MISMATCH_MESSAGE,
    }))
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

  async function finalizeSubmit() {
    const formData = buildSubmitFormData()
    if (!formData) return
    setIsSubmitting(true)
    try {
      if (guest) {
        const result = await submitGuestConcern(formData)
        setOpen(false)
        resetForm()
        window.dispatchEvent(new Event("eboses:report-created"))
        onGuestSubmitted?.(result.assigned_unit ?? null)
        return
      }
      const report = await createConcern(formData, {
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
        const responseFieldMessages = ["media", "description"].flatMap(
          (key) => {
            const value = responseData[key]
            if (Array.isArray(value)) {
              return value.filter(
                (item): item is string => typeof item === "string"
              )
            }
            return typeof value === "string" ? [value] : []
          }
        )
        const hardPhotoVerdicts = responsePhotoVerdicts.filter((verdict) =>
          isHardMediaRejectionMessage(verdict.message)
        )
        const hardMediaMessages = [
          ...responseFieldMessages.filter(isHardMediaRejectionMessage),
          ...hardPhotoVerdicts.map((verdict) => verdict.message),
        ]
        const hardPhotoIndexes = new Set(
          hardPhotoVerdicts.map((verdict) => verdict.index)
        )
        // A legacy/fallback final response can report a hard media failure at
        // request level without an index. In that case none of the submitted
        // files can be trusted to stay in the composer; remove them all. New
        // responses carry per-photo verdict indexes, so mixed uploads retain
        // their valid photos.
        const removeAllSubmittedPhotos =
          hardMediaMessages.length > 0 && hardPhotoIndexes.size === 0
        const visiblePhotoVerdicts = responsePhotoVerdicts.filter(
          (verdict) => !hardPhotoIndexes.has(verdict.index)
        )
        if (removeAllSubmittedPhotos || hardPhotoIndexes.size > 0) {
          setMediaFiles((current) =>
            current.filter(
              (_, index) =>
                removeAllSubmittedPhotos || !hardPhotoIndexes.has(index)
            )
          )
          setPrivacyPreview(null)
        }
        const invalidPhotoVerdicts = visiblePhotoVerdicts.filter((verdict) =>
          new Set<ConcernPhotoVerdict["state"]>([
            "unrelated",
            "unclear",
            "unsupported",
            "flagged",
          ]).has(verdict.state)
        )
        applyPhotoVerdicts(visiblePhotoVerdicts, { includeUnclear: true })

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
          // The per-photo verdict message is rendered in the existing media
          // error row. Do not also show the same rejection as a description
          // error when the server returned verdicts for the uploaded files.
          if (
            key === "description" &&
            (invalidPhotoVerdicts.length > 0 || hardMediaMessages.length > 0)
          ) {
            continue
          }
          const first = Array.isArray(value) ? value[0] : value
          if (typeof first === "string") nextErrors[key] = first
        }
        if (hardMediaMessages.length > 0) {
          nextErrors.media = hardMediaMessages[0]
        }
        if (Object.keys(nextErrors).length > 0) {
          setAwaitingValidation(false)
          setSubmittedReport(null)
          setOpen(true)
          setFieldErrors((current) => ({ ...current, ...nextErrors }))
          return
        }
        if (invalidPhotoVerdicts.length > 0) {
          setAwaitingValidation(false)
          setSubmittedReport(null)
          setOpen(true)
          return
        }
      }
      if (isAutomatedPhotoMismatchError(submitError)) {
        showPhotoMismatchError()
        return
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
    await finalizeSubmit()
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
      applyPhotoVerdicts(precheck.photo_verdicts || [])
      setPrivacyPreview(precheck.privacy_preview ?? null)

      if (precheck.resolved_address) {
        // The precheck answer is catalog-only (no Nominatim round trip), so a
        // pin outside the street catalog — a different community, a new
        // subdivision — degrades to the "Pinned location" placeholder. That
        // must never overwrite the real street the map picker already
        // reverse-geocoded for the resident. Adopt the server answer only when
        // the picker had nothing usable, retaining its secondary line as a
        // fallback when the catalog returns only a street.
        const currentPrimary = (addressPrimary || address).trim()
        const currentUsable =
          Boolean(currentPrimary) && !looksLikeCoordinates(currentPrimary)
        const precheckPrimary = (
          precheck.resolved_address.address_primary || ""
        ).trim()
        const precheckUsable =
          Boolean(precheckPrimary) && !looksLikeCoordinates(precheckPrimary)
        if (!currentUsable && precheckUsable) {
          const resolvedSecondary =
            precheck.resolved_address.address_secondary?.trim() ||
            addressSecondary.trim()
          const resolvedFull =
            precheck.resolved_address.address?.trim() ||
            [precheckPrimary, resolvedSecondary].filter(Boolean).join(", ")
          resolvedAddressRef.current = {
            address: resolvedFull,
            primary: precheckPrimary,
            secondary: resolvedSecondary,
          }
          setAddress(resolvedFull)
          setAddressPrimary(precheckPrimary)
          setAddressSecondary(resolvedSecondary)
        }
      }

      if (!precheck.can_submit) {
        setFieldErrors((current) => ({
          ...current,
          ...precheck.field_errors,
          ...(current.media ? { media: current.media } : {}),
        }))
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
      if (isAutomatedPhotoMismatchError(submitError)) {
        showPhotoMismatchError()
        return
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

  const hasMedia = mediaFiles.length > 0
  const descriptionLength = description.trim().length
  // Category-specific requirements are checked by the classification precheck
  // after the model has inferred the category. The client-side gates are:
  // at least 40 characters, one photo, and a set location pin.
  const formReady =
    descriptionLength >= descriptionMin && hasMedia && Boolean(locationPin)
  const footerErrors = useMemo(() => {
    const items: {
      text: string
      kind: "media" | "address" | "other"
      tone: FooterErrorTone
    }[] = []
    const seen = new Set<string>()
    const push = (raw: unknown, kind: "media" | "address" | "other") => {
      if (typeof raw !== "string") return
      const mapped = friendlyFooterError(raw)
      if (!mapped.text || seen.has(mapped.text)) return
      seen.add(mapped.text)
      items.push({ text: mapped.text, kind, tone: mapped.tone })
    }
    const kindForKey = (key: string) =>
      key === "media" ||
      key === "concern" ||
      key === "precheck" ||
      key === "title" ||
      key === "category"
        ? ("media" as const)
        : key === "address" || key === "location"
          ? ("address" as const)
          : ("other" as const)
    for (const [key, value] of Object.entries(fieldErrors)) {
      if (
        key === "media" &&
        typeof value === "string" &&
        value.includes("\n")
      ) {
        for (const part of value.split("\n")) push(part, "media")
      } else {
        push(value, kindForKey(key))
      }
    }
    for (const verdict of photoVerdicts) push(verdict.message, "media")
    return items.slice(0, 1)
  }, [fieldErrors, photoVerdicts])

  const showFooterErrors = footerErrors.length > 0
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
        mobileSheetInitialMode="max"
        sheetClassName="bg-white"
      >
        <DialogBody className="!flex !h-full !min-h-0 !flex-1 !flex-col !space-y-0 !overflow-hidden bg-white !p-0">
          {/* h-full keeps the composer/footer pinned on mobile. */}
          <div className="relative flex h-full min-h-0 flex-1 flex-col pt-[max(0.75rem,env(safe-area-inset-top))] md:h-auto md:max-h-[88vh] md:min-h-[min(560px,88vh)] md:flex-row md:pt-5">
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
                      aria-label={
                        isSubmitting || awaitingValidation
                          ? "Submitting report"
                          : undefined
                      }
                      className="inline-flex h-10 items-center justify-center rounded-full bg-primary px-5 text-[14px] font-semibold text-white transition-colors hover:bg-brand-orange-strong disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500 disabled:opacity-100 sm:h-11 sm:px-6 sm:text-[15px]"
                    >
                      {isSubmitting || awaitingValidation ? (
                        <LoaderCircleIcon
                          className="size-4 animate-spin"
                          aria-hidden
                        />
                      ) : (
                        "Report"
                      )}
                    </button>
                  </div>
                </div>

                {isSubmitting || awaitingValidation || isCheckingMedia ? (
                  <div
                    className="mt-1.5 shrink-0 overflow-hidden bg-brand-orange-soft"
                    aria-hidden
                  >
                    <div className="h-0.5 w-1/4 animate-load-slide bg-brand-orange motion-reduce:animate-none" />
                  </div>
                ) : null}

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
                  <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-4 pb-3 sm:px-5">
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
                  <div className="shrink-0 bg-white">
                    {hasMedia ? (
                      <div className="px-4 pt-3 sm:px-5">
                        <div className="flex flex-wrap gap-2.5">
                          {mediaFiles.map((file, index) => {
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
                                    const nextPhotoVerdicts = photoVerdicts
                                      .filter(
                                        (verdict) => verdict.index !== index
                                      )
                                      .map((verdict) =>
                                        verdict.index > index
                                          ? {
                                              ...verdict,
                                              index: verdict.index - 1,
                                            }
                                          : verdict
                                      )
                                    const remainingRejectedPhotos =
                                      nextPhotoVerdicts.filter(
                                        (verdict) =>
                                          verdict.state !== "relevant" &&
                                          Boolean(verdict.message)
                                      )
                                    setPhotoVerdicts(nextPhotoVerdicts)
                                    setFieldErrors((current) => {
                                      const next = { ...current }
                                      if (
                                        isPhotoRejectionMessage(
                                          current.description
                                        )
                                      ) {
                                        next.description = ""
                                      }
                                      if (
                                        isPhotoRejectionMessage(current.media)
                                      ) {
                                        next.media =
                                          remainingRejectedPhotos.length > 0
                                            ? photoVerdictErrorMessage(
                                                remainingRejectedPhotos,
                                                mediaFiles.length - 1 > 1
                                              )
                                            : ""
                                      }
                                      return next
                                    })
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
                          })}
                        </div>
                      </div>
                    ) : null}

                    {locationPin && address ? (
                      <div className="px-4 pt-2 pb-1 sm:px-5">
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
                        </div>
                      </div>
                    ) : null}

                    {showFooterErrors ? (
                      <div className="px-4 pt-1 sm:px-5">
                        <div
                          role="alert"
                          className={cn(
                            "rounded-md border px-3 py-2.5",
                            footerErrors.some((item) => item.tone === "error")
                              ? "border-destructive/25 bg-destructive/5"
                              : "border-neutral-200 bg-neutral-50"
                          )}
                        >
                          {footerErrors.length === 1 ? (
                            <div className="flex items-center gap-2">
                              {footerErrors[0]?.tone === "info" ? (
                                <InfoIcon
                                  className="size-5 shrink-0 text-neutral-500"
                                  strokeWidth={2}
                                  aria-hidden
                                />
                              ) : (
                                <CircleXIcon
                                  className="size-5 shrink-0 text-destructive"
                                  strokeWidth={2}
                                  aria-hidden
                                />
                              )}
                              <p
                                className={cn(
                                  "min-w-0 flex-1 text-[13px] leading-snug font-medium",
                                  footerErrors[0]?.tone === "info"
                                    ? "text-neutral-700"
                                    : "text-destructive"
                                )}
                              >
                                {footerErrors[0]?.text}
                              </p>
                            </div>
                          ) : (
                            <div>
                              <div className="flex items-center gap-2">
                                {footerErrors.some(
                                  (item) => item.tone === "error"
                                ) ? (
                                  <CircleXIcon
                                    className="size-5 shrink-0 text-destructive"
                                    strokeWidth={2}
                                    aria-hidden
                                  />
                                ) : (
                                  <InfoIcon
                                    className="size-5 shrink-0 text-neutral-500"
                                    strokeWidth={2}
                                    aria-hidden
                                  />
                                )}
                                <p
                                  className={cn(
                                    "min-w-0 flex-1 text-[13px] leading-snug font-semibold",
                                    footerErrors.some(
                                      (item) => item.tone === "error"
                                    )
                                      ? "text-destructive"
                                      : "text-neutral-700"
                                  )}
                                >
                                  {footerErrors.length} issues need attention
                                </p>
                              </div>
                              <ul className="mt-1.5 max-h-28 list-disc space-y-1 overflow-y-auto pr-1 pl-8 text-[13px] leading-snug font-medium">
                                {footerErrors.map((item) => (
                                  <li
                                    key={item.text}
                                    className={cn(
                                      item.tone === "info"
                                        ? "text-neutral-600 marker:text-neutral-300"
                                        : "text-destructive marker:text-destructive/60"
                                    )}
                                  >
                                    <span className="inline-flex items-start gap-1.5">
                                      {item.tone === "info" ? (
                                        <InfoIcon
                                          className="mt-0.5 size-3.5 shrink-0 text-neutral-400"
                                          strokeWidth={2}
                                          aria-hidden
                                        />
                                      ) : item.kind === "media" ? (
                                        <ImageIcon
                                          className="mt-0.5 size-3.5 shrink-0 text-destructive/70"
                                          strokeWidth={2}
                                          aria-hidden
                                        />
                                      ) : item.kind === "address" ? (
                                        <MapPinIcon
                                          className="mt-0.5 size-3.5 shrink-0 text-destructive/70"
                                          strokeWidth={2}
                                          aria-hidden
                                        />
                                      ) : null}
                                      <span>{item.text}</span>
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : null}

                    <div className="flex shrink-0 items-center gap-1 px-3 pt-1 sm:px-4">
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
                          "flex size-12 items-center justify-center rounded-full transition-colors hover:bg-neutral-100 disabled:opacity-50",
                          hasMedia
                            ? "text-neutral-800"
                            : "text-neutral-500 hover:text-neutral-800"
                        )}
                        aria-label="Add photo"
                      >
                        <ImageIcon className="size-6" strokeWidth={1.75} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setLocationOpen(true)}
                        className={cn(
                          "flex size-12 items-center justify-center rounded-full transition-colors hover:bg-neutral-100",
                          locationPin
                            ? "text-neutral-800"
                            : "text-neutral-500 hover:text-neutral-800"
                        )}
                        aria-label="Add location"
                      >
                        <MapPinIcon className="size-6" strokeWidth={1.75} />
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
                          "flex size-12 items-center justify-center rounded-full transition-colors hover:bg-neutral-100 disabled:opacity-50",
                          hasMedia
                            ? "text-neutral-800"
                            : "text-neutral-500 hover:text-neutral-800"
                        )}
                        aria-label="Take photo"
                      >
                        <CameraIcon className="size-6" strokeWidth={1.75} />
                      </button>
                    </div>

                    {/* Mobile safe-area padding under the icon row */}
                    <div className="pb-[max(0.5rem,env(safe-area-inset-bottom))] md:pb-[max(0.5rem,env(safe-area-inset-bottom))]" />
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
            // A newly selected pin supersedes any address cached by an earlier
            // authenticated precheck.
            resolvedAddressRef.current = null
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
            setFieldErrors((prev) => ({
              ...prev,
              address: "",
              location: "",
            }))
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
