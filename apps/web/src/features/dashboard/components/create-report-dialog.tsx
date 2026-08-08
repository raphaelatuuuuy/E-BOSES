import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import {
  CircleEllipsisIcon,
  GlobeIcon,
  ImageIcon,
  LayoutGridIcon,
  LeafIcon,
  LockIcon,
  MapPinIcon,
  PlusIcon,
  ShieldCheckIcon,
  TrafficConeIcon,
  XIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import { useAuthSession } from "@/features/auth/auth-session"
import {
  checkConcernMedia,
  createConcern,
  precheckConcern,
  type Concern,
  type ConcernVisibility,
} from "@/features/dashboard/api"
import { Dialog, DialogBody } from "@/features/dashboard/components/dialog"
import { ReportStatusDialog } from "@/features/dashboard/components/report-status-dialog"
import { statusModeFromReport } from "@/features/dashboard/components/report-status-mode"
import { ApiError } from "@/lib/api"
import { useCategoryOptions } from "@/features/dashboard/lib/concern-categories"

const LocationPickerModal = lazy(() => import("@/features/dashboard/components/location-picker"))

/** Icons per known category code; anything an official adds later falls back to
 *  a neutral icon rather than rendering blank. */
const CATEGORY_ICONS: Record<string, typeof TrafficConeIcon> = {
  infrastructure: TrafficConeIcon,
  environment: LeafIcon,
  public_safety: ShieldCheckIcon,
  others: CircleEllipsisIcon,
}

interface ConcernOption {
  label: string
  value: string
  desc: string
  icon: typeof TrafficConeIcon
  customIconLabel?: string
  iconImageUrl?: string
}

const ALLOWED_TYPES = ["image/png", "image/jpeg"]
const ACCEPT_STRING = ".png,.jpg,.jpeg," + ALLOWED_TYPES.join(",")
const MAX_FILE_SIZE = 2 * 1024 * 1024
const MAX_FILES = 5
const descriptionMax = 1500

/**
 * Backend still requires a `title` field; residents only type description.
 * Auto-fill a short internal label from the description (not shown as a separate UI field).
 */
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
/**
 * After the user confirms close once this session:
 * - no more “Close without reporting?” sheet
 * - no more “Draft saved.” toast
 * Draft still saves silently on close.
 */
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
    /* private mode / blocked storage */
  }
}

interface ReportDraft {
  concern: string
  title: string
  description: string
  address: string
  visibility: ConcernVisibility
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
  // Categories come from Configuration, so adding or renaming one there
  // changes this form without a code change.
  const { categories: categoryOptions } = useCategoryOptions()
  const concernConfig: ConcernOption[] = categoryOptions.map((category) => ({
    label: category.name,
    value: category.code,
    desc: category.description || category.department?.name || "",
    icon: CATEGORY_ICONS[category.code] ?? CircleEllipsisIcon,
    customIconLabel: category.custom_icon_label,
    iconImageUrl: category.icon_image_url,
  }))
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = (value: boolean) => {
    setInternalOpen(value)
    onOpenChange?.(value)
  }

  const [concern, setConcern] = useState("")
  const [description, setDescription] = useState("")
  const [visibility, setVisibility] = useState<ConcernVisibility>("community")
  const [visibilityMenuOpen, setVisibilityMenuOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [locationOpen, setLocationOpen] = useState(false)
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
  /** Confirm sheet when leaving with a draft */
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false)
  const clientRequestIdRef = useRef(crypto.randomUUID())
  const fileInputRef = useRef<HTMLInputElement>(null)
  const previewUrls = useMemo(
    () => mediaFiles.map((file) => URL.createObjectURL(file)),
    [mediaFiles],
  )

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

  // Escape on the confirm sheet = “Keep reporting”
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
        setConcern(draft.concern)
        setDescription(draft.description)
        setAddress(draft.address)
        // Best-effort split for older drafts (single string)
        const parts = draft.address.split(",").map((p) => p.trim())
        setAddressPrimary(parts[0] || draft.address)
        setAddressSecondary(parts.slice(1).join(", "))
        setVisibility(draft.visibility)
        setLocationPin(draft.locationPin)
      })
      .finally(() => setDraftRestored(true))
  }, [open, draftRestored])

  useEffect(() => {
    if (!open || !draftRestored || (!concern && !description && !address && !locationPin)) return
    const timeout = window.setTimeout(() => {
      void writeDraft({
        concern,
        title: titleFromDescription(description),
        description,
        address,
        visibility,
        locationPin,
      })
    }, 500)
    return () => window.clearTimeout(timeout)
  }, [open, draftRestored, concern, description, address, visibility, locationPin])

  function resetForm() {
    setConcern("")
    setDescription("")
    setVisibility("community")
    setAddress("")
    setAddressPrimary("")
    setAddressSecondary("")
    setLocationPin(null)
    setMediaFiles([])
    setPreviewUrl(null)
    setFieldErrors({})
    setMoreOpen(false)
    setLocationOpen(false)
    setVisibilityMenuOpen(false)
    setCloseConfirmOpen(false)
    clientRequestIdRef.current = crypto.randomUUID()
    setDraftRestored(false)
  }

  function hasDraftContent() {
    return Boolean(
      concern.trim() ||
        description.trim() ||
        address.trim() ||
        locationPin ||
        mediaFiles.length > 0,
    )
  }

  function buildDraftPayload(): ReportDraft {
    return {
      concern,
      title: titleFromDescription(description),
      description,
      address,
      visibility,
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

  /** X / overlay / Escape — confirm only the first time with content this session */
  function requestClose() {
    if (isSubmitting) return
    setMoreOpen(false)
    setLocationOpen(false)
    setVisibilityMenuOpen(false)
    setCloseConfirmOpen(false)

    if (!hasDraftContent()) {
      void deleteDraft().catch(() => undefined)
      setOpen(false)
      return
    }

    // Already confirmed once this session → save + close, no dialog/toast
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
      // First confirmation only: toast once, then never prompt again this session
      if (!hasAcknowledgedDraftClose()) {
        toast.success("Draft saved.")
        markDraftCloseAcknowledged()
      }
    } catch {
      toast.error("Could not save draft.")
    }
    setCloseConfirmOpen(false)
    setMoreOpen(false)
    setLocationOpen(false)
    setOpen(false)
  }

  function keepReporting() {
    setCloseConfirmOpen(false)
  }
  // Alias: older HMR bundles may still call keepPosting
  const keepPosting = keepReporting

  function validate() {
    const errors: Record<string, string> = {}
    if (!concern) errors.concern = "Choose a category."
    if (!description.trim()) errors.description = "Describe what happened."
    if (description.trim().length < 20)
      errors.description = "Please provide at least 20 characters for context."
    if (!locationPin || !address.trim()) errors.address = "Pin a location for this report."
    if (!mediaFiles.length) errors.media = "Add at least one clear photo as evidence."
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  /** Normalize media-check / API errors to clean user-facing text only */
  function cleanMediaErrorMessage(raw: string): string {
    let text = raw.trim()
    // "filename.png: ['AI-generated media is not allowed.']"
    const afterColon = text.includes(":") ? text.slice(text.lastIndexOf(":") + 1).trim() : text
    text = afterColon || text
    // "['message']" or '["message"]'
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

  async function addFiles(files: File[]) {
    const errors: string[] = []
    const valid: File[] = []
    setIsCheckingMedia(true)
    for (const file of files) {
      if (!ALLOWED_TYPES.includes(file.type)) {
        errors.push("Unsupported format. Use JPG or PNG.")
        continue
      }
      if (file.size > MAX_FILE_SIZE) {
        errors.push("File must be 2 MB or smaller.")
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
    setMediaFiles((prev) => [...prev, ...valid].slice(0, MAX_FILES))
    const unique = [...new Set(errors.filter(Boolean))]
    setFieldErrors((current) => ({
      ...current,
      // Newline-separated so the UI can list every media check message
      media: unique.length ? unique.join("\n") : "",
    }))
    setIsCheckingMedia(false)
  }

  async function handleSubmit() {
    if (!validate()) return

    const title = titleFromDescription(description)
    const formData = new FormData()
    formData.append("client_request_id", clientRequestIdRef.current)
    formData.append("title", title)
    formData.append("description", description.trim())
    formData.append(
      "category",
      concernConfig.find((c) => c.label === concern)?.value ?? "others",
    )
    formData.append("visibility", visibility)
    // Persist the human street line with the report (DB Concern.address).
    // Prefer primary street from the map picker; never store raw "Lat: …" alone.
    {
      const primary = (addressPrimary || address).trim().split(",")[0]?.trim() || address.trim()
      const secondary = addressSecondary.trim()
      const looksLikeCoords =
        !primary ||
        /^lat\b/i.test(primary) ||
        /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(primary)
      if (looksLikeCoords) {
        setFieldErrors((prev) => ({
          ...prev,
          address: "Pin a location with a street name before submitting.",
        }))
        return
      }
      const storedAddress = secondary ? `${primary}, ${secondary}` : primary
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

    setIsSubmitting(true)
    try {
      const precheckData = new FormData()
      precheckData.append("title", title)
      precheckData.append("description", description.trim())
      precheckData.append("category", concernConfig.find((c) => c.label === concern)?.value ?? "others")
      if (locationPin) {
        precheckData.append("latitude", locationPin.lat.toFixed(7))
        precheckData.append("longitude", locationPin.lng.toFixed(7))
      }
      if (mediaFiles[0]) precheckData.append("media", mediaFiles[0])
      const precheck = await precheckConcern(precheckData)
      const previousNotice = precheckNotice
      setPrecheckNotice(precheck.message || "")
      if (!precheck.can_submit || (precheck.needs_revision && precheck.message !== previousNotice)) {
        setFieldErrors((current) => ({
          ...current,
          ...precheck.field_errors,
          precheck: precheck.can_submit ? `${precheck.message} Press Report again to continue.` : precheck.message,
        }))
        setIsSubmitting(false)
        return
      }
      setFieldErrors((current) => {
        const { precheck: _, ...rest } = current
        return rest
      })
      const report = await createConcern(formData)
      await deleteDraft()
      setSubmittedReport(report)
      setOpen(false)
      window.dispatchEvent(new Event("eboses:report-created"))
    } catch (submitError) {
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

  const selectedConcern = concernConfig.find((item) => item.label === concern)
  const isControlled = controlledOpen !== undefined
  const hasMedia = mediaFiles.length > 0

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
        maxW={moreOpen ? "max-w-[820px]" : "max-w-[520px]"}
      >
        <DialogBody className="!flex !h-full !min-h-0 !flex-1 !flex-col !space-y-0 !overflow-hidden !p-0 bg-white">
          {/* h-full so mobile footer pins to dialog bottom, not under description */}
          <div className="flex h-full min-h-0 flex-1 flex-col pt-[max(0.75rem,env(safe-area-inset-top))] md:min-h-[min(500px,88vh)] md:flex-row md:pt-5">
            {/* Main composer */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              {/* Sticky header: Close · Anyone · Report */}
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
                    onClick={() => setVisibilityMenuOpen((v) => !v)}
                    className="inline-flex h-10 items-center gap-2 rounded-full border border-neutral-200 bg-neutral-100/80 px-3.5 text-[14px] font-semibold text-neutral-800 transition-colors hover:bg-neutral-100 sm:h-11 sm:px-4 sm:text-[15px]"
                  >
                    {visibility === "community" ? (
                      <GlobeIcon className="size-4" />
                    ) : (
                      <LockIcon className="size-4" />
                    )}
                    {visibility === "community" ? "Anyone" : "Private"}
                    <span className="text-[11px] text-neutral-400">▾</span>
                  </button>
                  {visibilityMenuOpen ? (
                    <div className="absolute right-0 top-full z-20 mt-1.5 w-52 overflow-hidden rounded-xl border border-neutral-200 bg-white py-1 shadow-lg">
                      {(
                        [
                          ["community", "Anyone", "Visible in the community feed"],
                          ["private", "Private", "Only you and officials"],
                        ] as const
                      ).map(([value, label, helper]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => {
                            setVisibility(value)
                            setVisibilityMenuOpen(false)
                          }}
                          className={cn(
                            "flex w-full flex-col px-3.5 py-2.5 text-left hover:bg-neutral-50",
                            visibility === value && "bg-neutral-50",
                          )}
                        >
                          <span className="text-[13px] font-semibold text-neutral-900">{label}</span>
                          <span className="text-[11px] text-neutral-500">{helper}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}

                  <button
                    type="button"
                    disabled={isSubmitting || isCheckingMedia}
                    onClick={() => void handleSubmit()}
                    className="inline-flex h-10 items-center justify-center rounded-full bg-primary px-5 text-[14px] font-semibold text-white transition-colors hover:bg-brand-orange-strong disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500 disabled:opacity-100 sm:h-11 sm:px-6 sm:text-[15px]"
                  >
                    {isSubmitting ? "Reporting…" : "Report"}
                  </button>
                </div>
              </div>

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
                {selectedConcern ? (
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-neutral-100 px-2.5 py-1 text-[12px] font-semibold text-neutral-700">
                    <selectedConcern.icon className="size-3.5" strokeWidth={1.75} />
                    {selectedConcern.label}
                  </span>
                ) : null}
              </div>

              {/* Scrollable body — description / media / location chip only */}
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-4 sm:px-5">
                <textarea
                  value={description}
                  maxLength={descriptionMax}
                  rows={3}
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
                   placeholder="What's happening in your barangay?"
                   className="max-h-[220px] min-h-[72px] w-full resize-none overflow-y-auto border-0 bg-transparent text-[17px] leading-relaxed text-neutral-900 outline-none placeholder:text-neutral-400"
                  />

                  <div>
                    <div className="mt-3 flex flex-wrap gap-2.5 min-h-[168px]">
                      {hasMedia
                        ? mediaFiles.map((file, index) => {
                            const url = previewUrls[index]
                            return (
                              <div
                                key={`${file.name}-${index}`}
                                className="relative h-[148px] w-[148px] overflow-hidden rounded-2xl bg-neutral-100 shadow-sm ring-1 ring-black/5 sm:h-[168px] sm:w-[168px]"
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

                    {locationPin && address ? (
                      <div className="mt-3 flex items-center gap-3 rounded-md border border-neutral-300 bg-white px-3.5 py-2.5">
                        <button
                          type="button"
                          onClick={() => setLocationOpen(true)}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        >
                          <MapPinIcon className="size-5 shrink-0 text-black" />
                          <span className="min-w-0">
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
                    ) : null}
                  </div>

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
                  <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium leading-relaxed text-amber-900">
                    {precheckNotice}
                  </p>
                ) : null}
              </div>

              {/* Bottom chrome: toolbar always first; categories expand below it on mobile */}
              <div className="shrink-0 border-t border-neutral-100 bg-white">
                <div className="flex items-center gap-0.5 px-3 pt-2 sm:px-4">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPT_STRING}
                    multiple
                    className="sr-only"
                    onChange={(e) => {
                      void addFiles(Array.from(e.target.files ?? []))
                      e.target.value = ""
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isCheckingMedia || mediaFiles.length >= MAX_FILES}
                    className={cn(
                      "flex size-11 items-center justify-center rounded-full transition-colors hover:bg-neutral-100 disabled:opacity-50",
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
                      "flex size-11 items-center justify-center rounded-full transition-colors hover:bg-neutral-100",
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
                    onClick={() => setMoreOpen((v) => !v)}
                    className={cn(
                      "ml-auto inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold transition-colors hover:bg-neutral-100",
                      moreOpen || concern
                        ? "text-neutral-800"
                        : "text-neutral-500 hover:text-neutral-800",
                    )}
                  >
                    <LayoutGridIcon className="size-4" strokeWidth={1.75} />
                    Category
                  </button>
                </div>

                {/* Mobile: expand categories below the toolbar */}
                {moreOpen ? (
                  <div className="md:hidden">
                    <div className="flex items-center px-4 pb-1 pt-2">
                      <h3 className="text-[15px] font-semibold text-neutral-900">Category</h3>
                    </div>
                    <div className="max-h-[40svh] space-y-1 overflow-y-auto overscroll-contain px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                      {concernConfig.map((item) => {
                        const Icon = item.icon
                        const selected = concern === item.label
                        return (
                          <button
                            key={item.label}
                            type="button"
                            onClick={() => {
                              setConcern(item.label)
                              setFieldErrors((prev) => ({ ...prev, concern: "" }))
                              setMoreOpen(false)
                            }}
                            className={cn(
                              "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-neutral-800 transition-colors",
                              selected ? "bg-neutral-100" : "bg-transparent hover:bg-neutral-100",
                            )}
                          >
                            {item.iconImageUrl ? (
                              <img src={item.iconImageUrl} alt="" className="size-8 shrink-0 rounded-lg object-cover" />
                            ) : item.customIconLabel ? (
                              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-xs font-black text-neutral-700">{item.customIconLabel}</span>
                            ) : (
                              <Icon className="size-5 shrink-0 text-neutral-600" strokeWidth={1.75} />
                            )}
                            <span className="min-w-0">
                              <span className="block text-[14px] font-semibold">{item.label}</span>
                              <span className="mt-0.5 block text-[12px] text-neutral-500">
                                {item.desc}
                              </span>
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pb-[max(0.75rem,env(safe-area-inset-bottom))]" />
                )}
              </div>
            </div>

            {/* Desktop: expandable category panel on the side */}
            {moreOpen ? (
              <aside className="hidden min-h-0 w-[260px] shrink-0 flex-col self-stretch bg-white md:flex">
                <div className="relative flex min-h-0 flex-1 flex-col">
                  <div
                    className="pointer-events-none absolute bottom-5 left-0 top-5 w-px bg-neutral-200"
                    aria-hidden
                  />
                  <div className="flex shrink-0 items-center px-4 pb-2 pt-1 pl-5">
                    <h3 className="text-[15px] font-semibold text-neutral-900">Category</h3>
                  </div>
                  <div className="flex min-h-0 flex-1 flex-col gap-1.5 px-2 pb-4 pt-1 pl-3 md:min-h-[280px]">
                    {concernConfig.map((item) => {
                      const Icon = item.icon
                      const selected = concern === item.label
                      return (
                        <button
                          key={item.label}
                          type="button"
                          onClick={() => {
                            setConcern(item.label)
                            setFieldErrors((prev) => ({ ...prev, concern: "" }))
                            setMoreOpen(false)
                          }}
                          className={cn(
                            "flex min-h-0 flex-1 items-center gap-3 rounded-xl px-3 py-3 text-left text-neutral-800 transition-colors",
                            selected ? "bg-neutral-100" : "bg-transparent hover:bg-neutral-100",
                          )}
                        >
                          {item.iconImageUrl ? (
                            <img src={item.iconImageUrl} alt="" className="size-8 shrink-0 rounded-lg object-cover" />
                          ) : item.customIconLabel ? (
                            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-xs font-black text-neutral-700">{item.customIconLabel}</span>
                          ) : (
                            <Icon className="size-5 shrink-0 text-neutral-600" strokeWidth={1.75} />
                          )}
                          <span className="min-w-0">
                            <span className="block text-[14px] font-semibold">{item.label}</span>
                            <span className="mt-0.5 block text-[12px] text-neutral-500">
                              {item.desc}
                            </span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </aside>
            ) : null}
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

      {submittedReport ? (
        <ReportStatusDialog
          open={true}
          onOpenChange={(value) => {
            if (!value) {
              resetForm()
              setSubmittedReport(null)
              setOpen(false)
            }
          }}
          report={submittedReport}
          mode={statusModeFromReport(submittedReport)}
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