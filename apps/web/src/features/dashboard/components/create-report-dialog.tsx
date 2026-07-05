import { useId, useState, lazy, Suspense } from "react"
import { toast } from "sonner"
import {
  CameraIcon,
  ImageIcon,
  PlusIcon,
  ShareIcon,
  WrenchIcon,
  TreePineIcon,
  ShieldCheckIcon,
  MoreHorizontalIcon,
  XIcon,
  InfoIcon,
  FilmIcon,
  TrashIcon,
  MaximizeIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover"

import { createConcern, type Concern, type ConcernCategory } from "@/features/dashboard/api"
import { ReportReceivedDialog } from "@/features/dashboard/components/report-received-dialog"
import { ApiError } from "@/lib/api"

const LocationPicker = lazy(() => import("@/features/dashboard/components/location-picker"))
import {
  Dialog,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
} from "@/features/dashboard/components/dialog"

const concerns = [
  { label: "Infrastructure", icon: WrenchIcon, desc: "Roads, utilities, buildings", color: "blue" },
  { label: "Environment", icon: TreePineIcon, desc: "Pollution, waste, nature", color: "green" },
  { label: "Public Safety", icon: ShieldCheckIcon, desc: "Crime, hazards, alerts", color: "red" },
  { label: "Others", icon: MoreHorizontalIcon, desc: "Any other concern", color: "gray" },
] as const

const MEDIA_REQUIRED_CATEGORIES = ["Infrastructure", "Environment", "Public Safety"]

const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"]
const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/webm", "video/ogg"]
const ALLOWED_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES]
const ACCEPT_STRING = ALLOWED_TYPES.join(",")
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const MAX_VIDEO_SIZE = 50 * 1024 * 1024 // 50MB

const colorMap: Record<string, { border: string; bg: string; text: string; iconBg: string }> = {
  blue: { border: "border-blue-500", bg: "bg-blue-50", text: "text-blue-700", iconBg: "bg-blue-100" },
  green: { border: "border-green-500", bg: "bg-green-50", text: "text-green-700", iconBg: "bg-green-100" },
  red: { border: "border-red-500", bg: "bg-red-50", text: "text-red-700", iconBg: "bg-red-100" },
  gray: { border: "border-gray-400", bg: "bg-gray-50", text: "text-gray-700", iconBg: "bg-gray-100" },
}

const concernCategoryMap: Record<string, ConcernCategory> = {
  Infrastructure: "infrastructure",
  Environment: "environment",
  "Public Safety": "public_safety",
  Others: "others",
}

export function CreateReportDialog({
  open: controlledOpen,
  onOpenChange,
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
} = {}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = (v: boolean) => {
    setInternalOpen(v)
    onOpenChange?.(v)
  }
  const [concern, setConcern] = useState("")
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [address, setAddress] = useState("")
  const [mediaFiles, setMediaFiles] = useState<File[]>([])
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const shareId = useId()
  const [shareOpen, setShareOpen] = useState(false)
  const [shareChoice, setShareChoice] = useState<"yes" | "no" | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [submittedReport, setSubmittedReport] = useState<Concern | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const maxChars = 150

  function resetForm() {
    setConcern("")
    setTitle("")
    setDescription("")
    setAddress("")
    setMediaFiles([])
    setPreviewUrl(null)
    setShareChoice(null)
    setFieldErrors({})
  }

  function validate(): boolean {
    const errors: Record<string, string> = {}
    if (!concern) errors.concern = "Select a concern type."
    if (!title.trim()) errors.title = "Enter a subject for your report."
    if (!description.trim()) errors.description = "Describe what happened."
    if (description.trim().length < 20) errors.description = "Please provide at least 20 characters for context."
    if (description.trim().length > maxChars) errors.description = `Maximum of ${maxChars} characters.`
    if (!address.trim()) errors.address = "Enter or pin a location."
    const mediaRequired = MEDIA_REQUIRED_CATEGORIES.includes(concern)
    if (mediaRequired && mediaFiles.length === 0) errors.media = "Photo or clip is required for this concern type."
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  async function handleSubmit() {
    if (!validate()) return

    const formData = new FormData()
    formData.append("title", title.trim())
    formData.append("description", description.trim())
    formData.append("category", concernCategoryMap[concern] ?? "others")
    formData.append("visibility", shareChoice === "no" ? "private" : "community")
    formData.append("address", address.trim())
    for (const file of mediaFiles) {
      formData.append("media", file)
    }

    setIsSubmitting(true)
    try {
      const report = await createConcern(formData)
      setSubmittedReport(report)
      setOpen(false)
      window.dispatchEvent(new Event("eboses:report-created"))
    } catch (submitError) {
      toast.error(submitError instanceof ApiError ? submitError.message : "Could not submit report. Try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary active:text-primary"
      >
        <PlusIcon className="size-5" />
        Create Report
      </button>

      <Dialog open={open} onClose={() => setOpen(false)} maxW="max-w-4xl">
        {/* Header */}
        <DialogHeader className="border-[#0a1a5e] bg-[#020c4e]">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-white">
              Create Report
            </DialogTitle>
            <div className="flex items-center gap-1">
              <div className="relative">
                <Popover open={shareOpen} onOpenChange={setShareOpen}>
                  <PopoverTrigger
                    className={cn(
                      "flex size-8 items-center justify-center rounded-lg transition-colors",
                      shareOpen
                        ? "bg-card/10 text-white"
                        : "text-white/60 hover:bg-card/10 hover:text-white",
                    )}
                  >
                    <ShareIcon className="size-4" />
                  </PopoverTrigger>

                  <PopoverContent className="w-72 right-0 left-auto top-full mt-2">
                    <fieldset className="p-4 space-y-4">
                      <div className="flex items-center gap-2">
                        <div className="flex size-8 items-center justify-center rounded-full bg-primary/10">
                          <ShareIcon className="size-4 text-primary" />
                        </div>
                        <legend className="text-sm font-semibold text-foreground">Share with community?</legend>
                      </div>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Choose how your report will be visible. You can always change this later in settings.
                      </p>
                      <div className="space-y-2">
                        {(["yes", "no"] as const).map((value) => (
                          <label
                            key={value}
                            className={cn(
                              "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                              shareChoice === value ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
                            )}
                          >
                            <div
                              className={cn(
                                "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                                shareChoice === value ? "border-primary" : "border-muted-foreground",
                              )}
                            >
                              {shareChoice === value && <div className="size-2 rounded-full bg-primary" />}
                            </div>
                            <input
                              type="radio"
                              name={shareId}
                              value={value}
                              checked={shareChoice === value}
                              onChange={() => setShareChoice(value)}
                              className="sr-only"
                            />
                            <div>
                              <p className="text-sm font-medium text-foreground">
                                {value === "yes" ? "Yes, share to community feed" : "No, keep it private"}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {value === "yes"
                                  ? "Others can see and engage with your report."
                                  : "Only you and the admin can view this report."}
                              </p>
                            </div>
                          </label>
                        ))}
                        {shareChoice === "no" && (
                          <button
                            type="button"
                            onClick={() => setShareChoice(null)}
                            className="w-full rounded-lg border border-border p-2 text-xs text-muted-foreground transition-colors hover:bg-muted/50"
                          >
                            Clear selection
                          </button>
                        )}
                      </div>
                    </fieldset>
                  </PopoverContent>
                </Popover>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex size-8 items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-card/10 hover:text-white"
              >
                <XIcon className="size-4" />
              </button>
            </div>
          </div>
        </DialogHeader>

        {/* Body — two columns */}
        <DialogBody>
          <div className="md:grid md:grid-cols-2 md:gap-6">
          {/* Left: Concern + Subject + Description */}
          <div className="flex h-full flex-col space-y-5">
            <div className="space-y-3">
              <label className="text-sm font-medium text-foreground pb-1 block">What's the concern?</label>
              <div className="grid grid-cols-2 gap-2">
                {concerns.map((c) => {
                  const Icon = c.icon
                  const selected = concern === c.label
                  const colors = colorMap[c.color]
                  return (
                    <button
                      key={c.label}
                      type="button"
                      onClick={() => { setConcern(c.label); setFieldErrors((prev) => ({ ...prev, concern: "" })); }}
                      className={cn(
                        "group flex flex-col items-center gap-1.5 rounded-xl border-2 bg-card p-3 text-center transition-all",
                        selected
                          ? cn(colors.border, colors.bg, colors.text)
                          : fieldErrors.concern
                            ? "border border-destructive text-destructive hover:border-destructive"
                            : "border-border text-muted-foreground hover:border-primary hover:bg-primary/5 hover:text-primary",
                      )}
                    >
                      <div className={cn("flex size-8 items-center justify-center rounded-full transition-colors", selected ? colors.iconBg : fieldErrors.concern ? "bg-destructive/10" : "bg-muted group-hover:bg-primary/10")}>
                        <Icon className="size-4" />
                      </div>
                      <span className="text-xs font-semibold">{c.label}</span>
                      <span className="text-xs leading-tight opacity-70">{c.desc}</span>
                    </button>
                  )
                })}
              </div>
              {fieldErrors.concern ? <p className="text-xs text-destructive">{fieldErrors.concern}</p> : null}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground pb-1 block">Subject</label>
              <input
                type="text"
                value={title}
                onChange={(event) => { setTitle(event.target.value); if (fieldErrors.title) setFieldErrors((prev) => ({ ...prev, title: "" })); }}
                placeholder="Brief summary of the issue"
                className={cn(
                  "w-full rounded-lg border bg-card px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:ring-2",
                  fieldErrors.title
                    ? "border-destructive focus:border-destructive focus:ring-destructive/20"
                    : "border-border focus:border-primary focus:ring-primary/20",
                )}
              />
              {fieldErrors.title ? <p className="text-xs text-destructive">{fieldErrors.title}</p> : null}
            </div>

            <div className="flex flex-1 flex-col space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-foreground">What Happened?</label>
                <span className={cn("text-xs", description.length >= maxChars ? "text-destructive" : "text-muted-foreground")}>
                  {description.length}/{maxChars}
                </span>
              </div>
              <textarea
                maxLength={maxChars}
                value={description}
                onChange={(e) => { setDescription(e.target.value); if (fieldErrors.description) setFieldErrors((prev) => ({ ...prev, description: "" })); }}
                placeholder="Describe the issue in detail..."
                className={cn(
                  "h-full min-h-[120px] w-full resize-none rounded-lg border bg-card px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:ring-2",
                  fieldErrors.description
                    ? "border-destructive focus:border-destructive focus:ring-destructive/20"
                    : "border-border focus:border-primary focus:ring-primary/20",
                )}
              />
              {fieldErrors.description ? <p className="text-xs text-destructive">{fieldErrors.description}</p> : null}
            </div>
          </div>

          {/* Right: Media + Location */}
          <div className="flex h-full flex-col space-y-5">
            {/* Media */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <label className="text-sm font-medium text-foreground">Photo or Clip</label>
                <div className="relative">
                  <Popover open={infoOpen} onOpenChange={setInfoOpen}>
                    <PopoverTrigger className="flex size-4 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground" aria-label="Media requirements"
                      onMouseEnter={() => setInfoOpen(true)}
                      onMouseLeave={() => setInfoOpen(false)}>
                      <InfoIcon className="size-4" />
                    </PopoverTrigger>
                    <PopoverContent className="!fixed !inset-x-4 !top-1/4 !-translate-y-0 z-[400] w-auto max-w-md mx-auto md:!absolute md:!inset-x-auto md:!top-full md:!mt-1 md:!w-72 p-4"
                      onMouseEnter={() => setInfoOpen(true)}
                      onMouseLeave={() => setInfoOpen(false)}>
                      <ul className="space-y-3 text-xs leading-relaxed">
                        <li><strong>Required</strong> for Infrastructure, Environment &amp; Public Safety reports.</li>
                        <li><strong>Formats:</strong> PNG, JPG, WEBP, GIF, MP4, WebM</li>
                        <li><strong>Max size:</strong> 5 MB per image, 50 MB per video</li>
                        <li><strong>Max 2 files</strong> per report</li>
                      </ul>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label
                  className={cn(
                    "flex aspect-square cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed bg-card transition-colors hover:border-primary hover:text-primary",
                    mediaFiles.length >= 2 ? "opacity-50 pointer-events-none" : "",
                    fieldErrors.media && "border border-destructive",
                  )}
                >
                  <input
                    type="file"
                    accept={ACCEPT_STRING}
                    multiple
                    className="sr-only"
                    onChange={(event) => {
                      const incoming = Array.from(event.target.files ?? [])
                      const errors: string[] = []
                      const valid: File[] = []
                      for (const file of incoming) {
                        if (!ALLOWED_TYPES.includes(file.type)) {
                          errors.push(`${file.name}: unsupported format.`)
                          continue
                        }
                        const limit = ALLOWED_VIDEO_TYPES.includes(file.type) ? MAX_VIDEO_SIZE : MAX_FILE_SIZE
                        if (file.size > limit) {
                          errors.push(`${file.name}: too large.`)
                          continue
                        }
                        valid.push(file)
                      }
                      const combined = [...mediaFiles, ...valid].slice(0, 2)
                      setMediaFiles(combined)
                      setFieldErrors((prev) => ({ ...prev, media: "" }))
                      if (errors.length) toast.error(errors[0])
                      event.target.value = ""
                    }}
                  />
                  {mediaFiles.length > 0 ? <ImageIcon className="size-5" /> : <PlusIcon className="size-5" />}
                  <span className="text-xs font-medium">{mediaFiles.length > 0 ? "Add more" : "Browse files"}</span>
                </label>
                <label
                  className={cn(
                    "flex aspect-square cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed bg-card transition-colors hover:border-primary hover:text-primary",
                    mediaFiles.length >= 2 ? "opacity-50 pointer-events-none" : "",
                    fieldErrors.media && "border border-destructive",
                  )}
                >
                  <input
                    type="file"
                    accept={ACCEPT_STRING}
                    multiple
                    className="sr-only"
                    onChange={(event) => {
                      const incoming = Array.from(event.target.files ?? [])
                      const errors: string[] = []
                      const valid: File[] = []
                      for (const file of incoming) {
                        if (!ALLOWED_TYPES.includes(file.type)) {
                          errors.push(`${file.name}: unsupported format.`)
                          continue
                        }
                        const limit = ALLOWED_VIDEO_TYPES.includes(file.type) ? MAX_VIDEO_SIZE : MAX_FILE_SIZE
                        if (file.size > limit) {
                          errors.push(`${file.name}: too large.`)
                          continue
                        }
                        valid.push(file)
                      }
                      const combined = [...mediaFiles, ...valid].slice(0, 2)
                      setMediaFiles(combined)
                      setFieldErrors((prev) => ({ ...prev, media: "" }))
                      if (errors.length) toast.error(errors[0])
                      event.target.value = ""
                    }}
                  />
                  <ImageIcon className="size-5" />
                  <span className="text-xs font-medium">Browse files</span>
                </label>
              </div>
              {fieldErrors.media ? <p className="text-xs text-destructive">{fieldErrors.media}</p> : null}
              {/* File list with preview */}
              {mediaFiles.length > 0 && (
                <div className="space-y-1.5">
                  {mediaFiles.map((file, idx) => {
                    const isImage = ALLOWED_IMAGE_TYPES.includes(file.type)
                    const url = URL.createObjectURL(file)
                    return (
                      <div key={`${file.name}-${idx}`} className="group flex items-center gap-2 rounded-lg border border-border bg-card p-2 text-xs text-muted-foreground">
                        <button
                          type="button"
                          onClick={() => setPreviewUrl(url)}
                          className="flex shrink-0 items-center gap-1.5 truncate text-left hover:text-foreground transition-colors"
                        >
                          {isImage ? <ImageIcon className="size-4 shrink-0" /> : <FilmIcon className="size-4 shrink-0" />}
                          <span className="truncate">{file.name}</span>
                          <MaximizeIcon className="size-3 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setMediaFiles((prev) => prev.filter((_, i) => i !== idx))
                            URL.revokeObjectURL(url)
                          }}
                          className="ml-auto shrink-0 p-0.5 text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <TrashIcon className="size-3.5" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Location */}
            <div className="flex flex-1 flex-col space-y-2">
              <label className="text-sm font-medium text-foreground">Location</label>
              <div className={cn("relative flex-1 min-h-[260px] rounded-lg overflow-hidden", fieldErrors.address && "border border-destructive")}>
                <Suspense fallback={<div className="flex h-full w-full items-center justify-center rounded-lg border border-border bg-muted text-xs text-muted-foreground">Loading map…</div>}>
                  <LocationPicker
                    onPin={(lat, lng) => {
                      setAddress(`Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}`)
                      setFieldErrors((prev) => ({ ...prev, address: "" }))
                    }}
                    address={address}
                    onAddressChange={(val) => {
                      setAddress(val)
                      if (fieldErrors.address) setFieldErrors((prev) => ({ ...prev, address: "" }))
                    }}
                  />
                </Suspense>
              </div>
              {fieldErrors.address ? <p className="text-xs text-destructive">{fieldErrors.address}</p> : null}
            </div>
          </div>
          </div>
          <div className="-mx-6 mt-6">
            <img src="/contents/report-footer.png" alt="" className="w-full h-auto" aria-hidden="true" />
          </div>
        </DialogBody>

        {/* Footer */}
        <DialogFooter className="border-[#0a1a5e] bg-[#020c4e]">
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span />
            <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg bg-card px-6 py-2.5 text-sm font-semibold text-[#020c4e] shadow-sm transition-colors hover:bg-card/90 active:scale-[0.98]"
            >
              Back
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 active:scale-[0.98]"
            >
              {isSubmitting ? "Submitting" : "Submit"}
            </button>
            </div>
          </div>
        </DialogFooter>
      </Dialog>

      {/* Report received dialog */}
      {submittedReport && (
        <ReportReceivedDialog
          open={true}
          onOpenChange={(v) => { if (!v) { resetForm(); setSubmittedReport(null); setOpen(false); } }}
          report={submittedReport}
        />
      )}

      {/* Image preview modal */}
      {previewUrl && (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 p-4"
          onClick={() => { setPreviewUrl(null) }}
        >
          <button
            type="button"
            onClick={() => setPreviewUrl(null)}
            className="absolute right-4 top-4 flex size-8 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
          >
            <XIcon className="size-5" />
          </button>
          <img
            src={previewUrl}
            alt="Preview"
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  )
}
