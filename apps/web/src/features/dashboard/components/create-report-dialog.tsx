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
  PencilIcon,
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
  type Concern,
  type ConcernCategory,
  type ConcernVisibility,
} from "@/features/dashboard/api"
import { Dialog, DialogBody } from "@/features/dashboard/components/dialog"
import { ReportStatusDialog, statusModeFromReport } from "@/features/dashboard/components/report-status-dialog"
import { ApiError } from "@/lib/api"

const LocationPickerModal = lazy(() => import("@/features/dashboard/components/location-picker"))

const concernConfig = [
  {
    label: "Infrastructure",
    value: "infrastructure" as ConcernCategory,
    desc: "Roads, utilities, buildings",
    icon: TrafficConeIcon,
  },
  {
    label: "Environment",
    value: "environment" as ConcernCategory,
    desc: "Pollution, waste, nature",
    icon: LeafIcon,
  },
  {
    label: "Public Safety",
    value: "public_safety" as ConcernCategory,
    desc: "Safety risks, suspicious activity",
    icon: ShieldCheckIcon,
  },
  {
    label: "Others",
    value: "others" as ConcernCategory,
    desc: "Any other concern",
    icon: CircleEllipsisIcon,
  },
] as const

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/jpg"]
const ACCEPT_STRING = ".png,.jpg,.jpeg," + ALLOWED_TYPES.join(",")
const MAX_FILE_SIZE = 2 * 1024 * 1024
const MAX_FILES = 5
const descriptionMax = 1500
const DRAFT_DB = "eboses-resident-drafts"
const DRAFT_STORE = "report-drafts"
const DRAFT_KEY = "current-report"

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
  const [draftRestored, setDraftRestored] = useState(false)
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
        title: description.trim().slice(0, 80),
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
    clientRequestIdRef.current = crypto.randomUUID()
    setDraftRestored(false)
  }

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
      text = text.replace(/^[\[(]+|[)\]]+$/g, "").trim()
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

    const title = description.trim().slice(0, 80)
    const formData = new FormData()
    formData.append("client_request_id", clientRequestIdRef.current)
    formData.append("title", title)
    formData.append("description", description.trim())
    formData.append(
      "category",
      concernConfig.find((c) => c.label === concern)?.value ?? "others",
    )
    formData.append("visibility", visibility)
    formData.append("address", address.trim())
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
        onClose={() => {
          setOpen(false)
          setMoreOpen(false)
          setLocationOpen(false)
        }}
        maxW={moreOpen ? "max-w-[820px]" : "max-w-[520px]"}
      >
        <DialogBody className="!space-y-0 !overflow-hidden !p-0 bg-white">
          <div className="flex min-h-[min(500px,88vh)] flex-col pt-4 md:flex-row md:pt-5">
            {/* Main composer */}
            <div className="flex min-w-0 flex-1 flex-col">
              {/* Header: Close · Anyone · Post */}
              <div className="flex shrink-0 items-center gap-2.5 px-5">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex size-12 shrink-0 items-center justify-center rounded-full text-neutral-600 transition-colors hover:bg-neutral-100"
                  aria-label="Close"
                >
                  <XIcon className="size-6" strokeWidth={2} />
                </button>

                <div className="relative ml-auto flex shrink-0 items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => setVisibilityMenuOpen((v) => !v)}
                    className="inline-flex h-11 items-center gap-2 rounded-full border border-neutral-200 bg-neutral-100/80 px-4 text-[15px] font-semibold text-neutral-800 transition-colors hover:bg-neutral-100"
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
                    className="inline-flex h-11 items-center justify-center rounded-full bg-[#ff6a1a] px-6 text-[15px] font-semibold text-white transition-colors hover:bg-[#e85f12] disabled:opacity-60"
                  >
                    {isSubmitting ? "Posting…" : "Post"}
                  </button>
                </div>
              </div>

              {/* Identity — below Close / Anyone / Post, left-aligned under close */}
              <div className="flex items-center gap-3 px-5 pt-4">
                <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-[#c5d0e6] text-[18px] font-semibold text-[#2c3a5a]">
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

              {/* Body — compact description (no huge empty flex gap inside the field) */}
              <div className="flex min-h-0 flex-1 flex-col px-5 pt-4">
                <textarea
                  value={description}
                  maxLength={descriptionMax}
                  rows={3}
                  onChange={(e) => {
                    setDescription(e.target.value)
                    if (fieldErrors.description)
                      setFieldErrors((prev) => ({ ...prev, description: "" }))
                    // Auto-grow with content (cap so footer stays visible)
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
                  placeholder={
                    hasMedia || locationPin
                      ? "Add a caption (optional)"
                      : "What's happening in your barangay?"
                  }
                  className="max-h-[220px] min-h-[72px] w-full shrink-0 resize-none overflow-y-auto border-0 bg-transparent text-[17px] leading-relaxed text-neutral-900 outline-none placeholder:text-neutral-400"
                />

                {/* Media — above footer */}
                {hasMedia ? (
                  <div className="mt-3 flex shrink-0 flex-wrap gap-2.5">
                    {mediaFiles.map((file, index) => {
                      const url = previewUrls[index]
                      return (
                        <div
                          key={`${file.name}-${index}`}
                          className="relative h-[168px] w-[168px] overflow-hidden rounded-2xl bg-neutral-100 shadow-sm ring-1 ring-black/5 sm:h-[180px] sm:w-[180px]"
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
                          {index === 0 ? (
                            <button
                              type="button"
                              onClick={() => fileInputRef.current?.click()}
                              className="absolute bottom-2.5 left-2.5 inline-flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-[13px] font-semibold text-white backdrop-blur-[2px]"
                            >
                              <PencilIcon className="size-3.5" />
                              Modify
                            </button>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                ) : null}

                {/* Location row — above footer */}
                {locationPin && address ? (
                  <div className="mt-3 flex shrink-0 items-center gap-3 rounded-full border border-neutral-200 bg-white px-3.5 py-2.5 shadow-sm">
                    <button
                      type="button"
                      onClick={() => setLocationOpen(true)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-700">
                        <MapPinIcon className="size-4" strokeWidth={2} />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[14px] font-semibold leading-tight text-neutral-900">
                          {addressPrimary || address}
                        </span>
                        {addressSecondary ? (
                          <span className="mt-0.5 block truncate text-[12px] leading-tight text-neutral-500">
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
                      className="flex size-8 shrink-0 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
                      aria-label="Remove location"
                    >
                      <XIcon className="size-4" />
                    </button>
                  </div>
                ) : null}

                {/* Empty space stays outside the description field */}
                <div className="min-h-0 flex-1" aria-hidden />

                {/* All feedback errors above photo / location / Category toolbar */}
                {(() => {
                  const messages = [
                    fieldErrors.description,
                    fieldErrors.concern,
                    // Media may contain multiple newline-separated check messages
                    ...(fieldErrors.media
                      ? fieldErrors.media.split("\n").map((m) => m.trim()).filter(Boolean)
                      : []),
                    fieldErrors.address,
                  ].filter((msg): msg is string => Boolean(msg && msg.trim()))
                  if (messages.length === 0) return null
                  return (
                    <ul
                      className="mt-2 shrink-0 list-none space-y-1 text-xs font-medium text-destructive"
                      role="alert"
                    >
                      {messages.map((msg) => (
                        <li key={msg}>{msg}</li>
                      ))}
                    </ul>
                  )
                })()}
              </div>

              {/* Footer actions */}
              <div className="flex shrink-0 items-center gap-0.5 px-3 pb-3 pt-2 sm:px-4">
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
                  className="flex size-11 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 disabled:opacity-50"
                  aria-label="Add photo"
                >
                  <ImageIcon className="size-5" strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  onClick={() => setLocationOpen(true)}
                  className={cn(
                    "flex size-11 items-center justify-center rounded-full transition-colors hover:bg-neutral-100",
                    locationPin ? "text-[#ff6a1a]" : "text-neutral-500 hover:text-neutral-800",
                  )}
                  aria-label="Add location"
                >
                  <MapPinIcon className="size-5" strokeWidth={1.75} />
                </button>

                <button
                  type="button"
                  onClick={() => setMoreOpen((v) => !v)}
                  className="ml-auto inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold text-neutral-700 transition-colors hover:bg-neutral-100"
                >
                  <LayoutGridIcon className="size-4" strokeWidth={1.75} />
                  Category
                </button>
              </div>
            </div>

            {/* Category panel */}
            {moreOpen ? (
              <aside className="flex w-full shrink-0 flex-col border-t border-neutral-100 bg-white md:w-[260px] md:border-l md:border-t-0">
                <div className="flex items-center justify-between px-4 pb-1 pt-4">
                  <h3 className="text-[15px] font-semibold text-neutral-900">Category</h3>
                  <button
                    type="button"
                    onClick={() => setMoreOpen(false)}
                    className="flex size-8 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100 md:hidden"
                    aria-label="Close categories"
                  >
                    <XIcon className="size-4" />
                  </button>
                </div>
                <div className="flex flex-col gap-0.5 px-2 pb-4 pt-1">
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
                          "flex items-center gap-3 rounded-xl px-3 py-3 text-left text-neutral-800 transition-colors",
                          selected ? "bg-neutral-100" : "bg-transparent hover:bg-neutral-100",
                        )}
                      >
                        <Icon className="size-5 shrink-0 text-neutral-600" strokeWidth={1.75} />
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
