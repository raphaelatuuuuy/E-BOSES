import { lazy, Suspense, useState, type DragEvent, type ReactNode } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  CloudUploadIcon,
  FileTextIcon,
  ImageIcon,
  InfoIcon,
  LeafIcon,
  LightbulbIcon,
  LocateFixedIcon,
  LockIcon,
  MapPinIcon,
  PlusIcon,
  SearchIcon,
  ShieldCheckIcon,
  TrafficConeIcon,
  TrashIcon,
  XIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import { createConcern, type Concern, type ConcernCategory } from "@/features/dashboard/api"
import { Dialog, DialogBody, DialogFooter } from "@/features/dashboard/components/dialog"
import { ReportStatusDialog, statusModeFromReport } from "@/features/dashboard/components/report-status-dialog"
import { ApiError } from "@/lib/api"

const LocationPicker = lazy(() => import("@/features/dashboard/components/location-picker"))

const concernConfig = [
  { label: "Infrastructure", img: "/contents/infrastructure.png", desc: "Roads, utilities, buildings", value: "infrastructure", color: "amber" },
  { label: "Environment", img: "/contents/environment.png", desc: "Pollution, waste, nature", value: "environment", color: "green" },
  { label: "Public Safety", img: "/contents/public-safety.png", desc: "Stray animals,<br/>weapon, suspicious item", value: "public_safety", color: "blue" },
  { label: "Others", img: "/contents/others.png", desc: "Any other concern", value: "others", color: "slate" },
] as const

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/jpg"]
const ACCEPT_STRING = ".png,.jpg,.jpeg," + ALLOWED_TYPES.join(",")
const MAX_FILE_SIZE = 10 * 1024 * 1024
const MAX_FILES = 5
const titleMax = 80
const descriptionMax = 1500

const concernCategoryMap: Record<string, ConcernCategory> = {
  Infrastructure: "infrastructure",
  Environment: "environment",
  "Public Safety": "public_safety",
  Others: "others",
}

function Stepper({ active }: { active: number }) {
  const steps = ["Details", "Review", "Submit"]
  return (
    <div className="hidden items-start justify-center gap-3 md:flex">
      {steps.map((step, index) => (
        <div key={step} className="flex items-start gap-3">
          <div className="flex flex-col items-center gap-2">
            <div
              className={cn(
                "flex size-7 items-center justify-center rounded-full text-xs font-bold",
                index < active && "bg-[#07145f] text-white",
                index === active && "bg-[#ff6a1a] text-white",
                index > active && "border border-[#cbd8ee] bg-white text-[#68739c]",
              )}
            >
              {index < active ? <CheckIcon className="size-4" /> : index + 1}
            </div>
            <span className={cn("text-xs font-bold", index <= active ? "text-[#07145f]" : "text-[#68739c]")}>
              {step}
            </span>
          </div>
          {index < steps.length - 1 ? <div className={cn("mt-3 h-px w-20", index < active ? "bg-[#07145f]" : "bg-slate-200")} /> : null}
        </div>
      ))}
    </div>
  )
}

function formatFileSize(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
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
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = (value: boolean) => {
    setInternalOpen(value)
    onOpenChange?.(value)
  }
  const [concern, setConcern] = useState("")
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [address, setAddress] = useState("")
  const [locationPin, setLocationPin] = useState<{ lat: number; lng: number; accuracy?: number | null } | null>(null)
  const [mediaFiles, setMediaFiles] = useState<File[]>([])
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [step, setStep] = useState<"details" | "review">("details")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLocating, setIsLocating] = useState(false)
  const [submittedReport, setSubmittedReport] = useState<Concern | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  function handleLocate() {
    if (!navigator.geolocation) return
    setIsLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords
        setLocationPin({ lat: latitude, lng: longitude })
        setAddress(`Lat: ${latitude.toFixed(4)}, Lng: ${longitude.toFixed(4)}`)
        setIsLocating(false)
      },
      () => setIsLocating(false),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  function resetForm() {
    setConcern("")
    setTitle("")
    setDescription("")
    setAddress("")
    setLocationPin(null)
    setMediaFiles([])
    setPreviewUrl(null)
    setStep("details")
    setFieldErrors({})
  }

  function validate() {
    const errors: Record<string, string> = {}
    if (!concern) errors.concern = "Select a concern type."
    if (!title.trim()) errors.title = "Enter a subject for your report."
    if (!description.trim()) errors.description = "Describe what happened."
    if (description.trim().length < 20) errors.description = "Please provide at least 20 characters for context."
    if (!address.trim()) errors.address = "Enter or pin a location."
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  function addFiles(files: File[]) {
    const errors: string[] = []
    const valid: File[] = []
    for (const file of files) {
      if (!ALLOWED_TYPES.includes(file.type)) {
        errors.push(`${file.name}: unsupported format.`)
        continue
      }
      if (file.size > MAX_FILE_SIZE) {
        errors.push(`${file.name}: too large.`)
        continue
      }
      valid.push(file)
    }
    setMediaFiles((prev) => [...prev, ...valid].slice(0, MAX_FILES))
    if (errors.length) toast.error(errors[0])
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    addFiles(Array.from(event.dataTransfer.files ?? []))
  }

  function goToReview() {
    if (!validate()) return
    setStep("review")
  }

  async function handleSubmit() {
    if (!validate()) return

    const formData = new FormData()
    formData.append("title", title.trim())
    formData.append("description", description.trim())
    formData.append("category", concernCategoryMap[concern] ?? "others")
    formData.append("visibility", "community")
    formData.append("address", address.trim())
    if (locationPin) {
      formData.append("latitude", locationPin.lat.toFixed(7))
      formData.append("longitude", locationPin.lng.toFixed(7))
      formData.append("location_source", "manual_pin")
      if (locationPin.accuracy !== undefined && locationPin.accuracy !== null) {
        formData.append("location_accuracy", String(locationPin.accuracy))
      }
    }
    for (const file of mediaFiles) formData.append("media", file)

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

  const selectedConcern = concernConfig.find((item) => item.label === concern)
  const selectedConcernImg = selectedConcern?.img ?? "/contents/others.png"
  const reviewMapUrl = locationPin
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${locationPin.lng - 0.01}%2C${locationPin.lat - 0.01}%2C${locationPin.lng + 0.01}%2C${locationPin.lat + 0.01}&layer=mapnik&marker=${locationPin.lat}%2C${locationPin.lng}`
    : ""

  return (
    <>
      {trigger ? (
        trigger(() => setOpen(true))
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary active:text-primary"
        >
          <PlusIcon className="size-5" />
          Create Report
        </button>
      )}

      <Dialog open={open} onClose={() => { setStep("details"); setOpen(false) }} maxW="max-w-6xl">
        <DialogBody className="space-y-7 bg-white px-5 py-5 md:px-7 md:py-6">
            <div className="flex items-start justify-between gap-6">
              <div>
                <button
                  type="button"
                  onClick={() => {
                    if (step === "review") {
                      setStep("details")
                      return
                    }
                    setOpen(false)
                  }}
                  className="inline-flex items-center gap-2 text-sm font-semibold text-[#2447b3] transition-colors hover:text-[#07145f]"
                >
                  <ArrowLeftIcon className="size-4" />
                  Back
                </button>
                <h1 className="mt-5 font-heading text-3xl font-bold text-[#07145f]">
                  {step === "review" ? "Create Report — Review" : "Create Report"}
                </h1>
                <p className="mt-2 text-sm font-medium text-[#324270]">
                  {step === "review"
                    ? "Please review your report details before submitting."
                    : "Help us address issues in your barangay. Your report makes our community better."}
                </p>
              </div>
              <div className="hidden flex-col items-end gap-3 md:flex">
                <img src="/contents/report-footer.png" alt="" className="h-32 w-auto shrink-0 object-contain lg:h-44" />
              </div>
            </div>
            <div className="flex justify-center">
              <Stepper active={step === "review" ? 1 : 0} />
            </div>

          {step === "details" ? (
          <div className="grid gap-7 xl:grid-cols-[minmax(360px,0.95fr)_minmax(460px,1.15fr)]">
            <section className="space-y-7">
              <div>
                <h2 className="text-base font-bold text-[#07145f]">1. What's the concern?</h2>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  {concernConfig.map((item) => {
                    const selected = concern === item.label
                    const colorMap: Record<string, string> = {
                      amber: "border-amber-400 bg-amber-50 text-amber-600",
                      green: "border-green-400 bg-green-50 text-green-600",
                      red: "border-red-400 bg-red-50 text-red-600",
                      blue: "border-blue-400 bg-blue-50 text-blue-600",
                      slate: "border-slate-400 bg-slate-100 text-slate-600",
                    }
                    const iconBgMap: Record<string, string> = {
                      amber: "bg-amber-100",
                      green: "bg-green-100",
                      red: "bg-red-100",
                      blue: "bg-blue-100",
                      slate: "bg-slate-200",
                    }
                    return (
                      <button
                        key={item.label}
                        type="button"
                        onClick={() => {
                          setConcern(item.label)
                          setFieldErrors((prev) => ({ ...prev, concern: "" }))
                        }}
                        className={cn(
                          "flex min-h-[130px] flex-col items-center justify-center gap-3 rounded-xl border bg-white p-4 text-center transition-colors",
                          selected && colorMap[item.color],
                          fieldErrors.concern && "border-destructive text-destructive",
                          !selected && !fieldErrors.concern && "border-slate-200 text-[#07145f] hover:border-[#ff6a1a]/60",
                        )}
                      >
                        <span className={cn("flex size-12 items-center justify-center rounded-full", selected ? iconBgMap[item.color] : "bg-[#eef3ff]")}>
                          <img src={item.img} alt="" className="h-14 w-14 object-contain" />
                        </span>
                        <span className="text-sm font-bold">{item.label}</span>
                        <span className="text-xs leading-5 text-[#43507f]" dangerouslySetInnerHTML={{ __html: item.desc }} />
                      </button>
                    )
                  })}
                </div>
                {fieldErrors.concern ? <p className="mt-2 text-xs text-destructive">{fieldErrors.concern}</p> : null}
              </div>

              <div>
                <h2 className="text-base font-bold text-[#07145f]">2. Report details</h2>
                <label className="mt-4 block text-sm font-bold text-[#07145f]">Subject</label>
                <div className="relative mt-2">
                  <input
                    value={title}
                    maxLength={titleMax}
                    onChange={(event) => {
                      setTitle(event.target.value)
                      if (fieldErrors.title) setFieldErrors((prev) => ({ ...prev, title: "" }))
                    }}
                    placeholder="Brief summary of the issue"
                    className={cn(
                      "h-11 w-full rounded-lg border bg-white px-4 pr-14 text-sm outline-none transition-colors placeholder:text-[#8b96b8] focus:border-[#ff6a1a] focus:ring-2 focus:ring-[#ff6a1a]/15",
                      fieldErrors.title ? "border-destructive" : "border-slate-200",
                    )}
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-[#68739c]">
                    {title.length}/{titleMax}
                  </span>
                </div>
                {fieldErrors.title ? <p className="mt-2 text-xs text-destructive">{fieldErrors.title}</p> : null}

                <label className="mt-5 block text-sm font-bold text-[#07145f]">Description</label>
                <div className="relative mt-2">
                  <textarea
                    value={description}
                    maxLength={descriptionMax}
                    onChange={(event) => {
                      setDescription(event.target.value)
                      if (fieldErrors.description) setFieldErrors((prev) => ({ ...prev, description: "" }))
                    }}
                    placeholder="Describe the issue in detail. Include what happened, when, and any other relevant information."
                    className={cn(
                      "min-h-[118px] w-full resize-none rounded-lg border bg-white px-4 py-3 pb-8 text-sm outline-none transition-colors placeholder:text-[#8b96b8] focus:border-[#ff6a1a] focus:ring-2 focus:ring-[#ff6a1a]/15",
                      fieldErrors.description ? "border-destructive" : "border-slate-200",
                    )}
                  />
                  <span className="absolute bottom-3 right-4 text-xs text-[#68739c]">
                    {description.length}/{descriptionMax}
                  </span>
                </div>
                {fieldErrors.description ? <p className="mt-2 text-xs text-destructive">{fieldErrors.description}</p> : null}
                <p className="mt-3 flex items-center justify-center gap-1.5 text-xs font-medium text-[#68739c]">
                  <LightbulbIcon className="size-3.5 text-[#2447b3]" />
                  Tip: Provide as much detail as you can to help us resolve the issue faster.
                </p>
              </div>

            </section>

            <section className="space-y-6">
              <div>
                <div>
                  <h2 className="flex items-center gap-2 text-base font-bold text-[#07145f]">
                  3. Add photos or documents
                    <div className="relative group">
                      <InfoIcon className="size-4 text-[#68739c] cursor-help" />
                      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 hidden group-hover:block w-56 rounded-lg bg-[#07145f] p-3 text-xs leading-5 text-white shadow-lg z-10">
                        <p className="font-bold mb-1">File tips</p>
                        <ul className="list-disc space-y-1 pl-4">
                          <li>Clear photos help us understand the issue.</li>
                          <li>Include documents if available.</li>
                          <li>Avoid personal or sensitive information.</li>
                        </ul>
                      </div>
                    </div>
                  </h2>
                  <label
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={handleDrop}
                    className="mt-4 flex min-h-[168px] cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-[#9eb7e6] bg-white p-5 text-center transition-colors hover:border-[#ff6a1a] hover:bg-[#fff8f3]"
                  >
                    <input
                      type="file"
                      accept={ACCEPT_STRING}
                      multiple
                      className="sr-only"
                      onChange={(event) => {
                        addFiles(Array.from(event.target.files ?? []))
                        event.target.value = ""
                      }}
                    />
                    <CloudUploadIcon className="size-11 text-[#07145f]" strokeWidth={2} />
                    <p className="mt-3 text-sm font-semibold text-[#43507f]">Drag and drop files here</p>
                    <p className="mt-1 text-xs text-[#8b96b8]">or</p>
                    <span className="text-sm font-semibold text-[#43507f]">
                      Browse files
                    </span>
                    <p className="mt-3 text-xs text-[#8b96b8]">JPG or PNG up to 10MB each (max 5 files)</p>
                  </label>
                  {mediaFiles.length > 0 ? (
                    <div className="mt-3 grid gap-2">
                      {mediaFiles.map((file, index) => {
                        const isImage = ALLOWED_IMAGE_TYPES.includes(file.type)
                        const url = URL.createObjectURL(file)
                        return (
                          <div key={`${file.name}-${index}`} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs text-[#43507f]">
                            <button
                              type="button"
                              onClick={() => { if (isImage) setPreviewUrl(url) }}
                              className="flex min-w-0 flex-1 items-center gap-2 text-left"
                            >
                              {isImage ? <ImageIcon className="size-4 shrink-0" /> : <FileTextIcon className="size-4 shrink-0" />}
                              <span className="truncate">{file.name}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setMediaFiles((prev) => prev.filter((_, i) => i !== index))}
                              className="text-[#68739c] hover:text-destructive"
                            >
                              <TrashIcon className="size-4" />
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  ) : null}
                </div>

              </div>
              <div>
                <h2 className="text-base font-bold text-[#07145f]">4. Where did this happen?</h2>
                <div className="mt-4 flex items-center gap-2">
                  <div className="relative flex-1">
                    <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[#68739c] pointer-events-none" />
                    <input
                      type="text"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="Search location"
                      className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-4 text-sm outline-none transition-colors placeholder:text-[#8b96b8] focus:border-[#ff6a1a] focus:ring-2 focus:ring-[#ff6a1a]/15"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleLocate}
                    disabled={isLocating}
                    className="flex h-11 shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-[#43507f] transition-colors hover:bg-[#fff8f3] hover:border-[#ff6a1a] hover:text-[#ff6a1a] disabled:opacity-60"
                  >
                    <LocateFixedIcon className="size-4" />
                    {isLocating ? "…" : "Locate me"}
                  </button>
                </div>
                <div className={cn("mt-4 overflow-hidden rounded-xl border border-border", fieldErrors.address && "ring-1 ring-destructive")}>
                    <Suspense fallback={<div className="flex min-h-[300px] items-center justify-center rounded-xl text-sm text-[#68739c]">Loading map...</div>}>
                      <LocationPicker
                        address={address}
                        onAddressChange={(value) => {
                          setAddress(value)
                          if (fieldErrors.address) setFieldErrors((prev) => ({ ...prev, address: "" }))
                        }}
                        onPin={(lat, lng) => {
                          setLocationPin({ lat, lng })
                          setAddress(`Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}`)
                          setFieldErrors((prev) => ({ ...prev, address: "" }))
                        }}
                      />
                    </Suspense>
                </div>
                {fieldErrors.address ? <p className="mt-2 text-xs text-destructive">{fieldErrors.address}</p> : null}
                <div className="mt-4 flex items-center justify-start gap-1.5 text-xs text-[#68739c] md:justify-center">
                  <InfoIcon className="size-3.5 shrink-0 text-[#2447b3]" />
                  <span>You can adjust the pin or click on the map to refine the exact location.</span>
                </div>
              </div>
            </section>
          </div>
          ) : (
            <div className="grid gap-7 xl:grid-cols-[minmax(360px,0.95fr)_minmax(460px,1.15fr)]">
              <section className="space-y-6">
                <div>
                  <h2 className="text-base font-bold text-[#07145f]">1. Your concern</h2>
                  <div className="mt-4 overflow-hidden rounded-xl border border-[#dfe7f5] bg-white">
                    <div className="flex items-start gap-4 border-b border-[#dfe7f5] px-4 py-4">
                      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#fff1ea] text-[#ff6a1a]">
                        <img src={selectedConcernImg} alt="" className="h-14 w-14 object-contain" />
                      </span>
                      <div>
                        <p className="text-[11px] font-bold text-[#68739c]">Category</p>
                        <p className="text-sm font-extrabold text-[#07145f]">{concern || "Not selected"}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-4 border-b border-[#dfe7f5] px-4 py-4">
                      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#eef3ff] text-[#2447b3]">
                        <FileTextIcon className="size-5" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold text-[#68739c]">Subject</p>
                        <p className="break-words text-sm font-extrabold text-[#07145f]">{title.trim()}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-4 px-4 py-4">
                      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#eef3ff] text-[#2447b3]">
                        <InfoIcon className="size-5" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold text-[#68739c]">Description</p>
                        <p className="break-words text-sm font-semibold leading-6 text-[#43507f]">{description.trim()}</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <h2 className="text-base font-bold text-[#07145f]">2. Uploaded photos or documents</h2>
                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {mediaFiles.map((file, index) => {
                      const isImage = ALLOWED_IMAGE_TYPES.includes(file.type)
                      const url = URL.createObjectURL(file)
                      return (
                        <button
                          key={`${file.name}-${index}`}
                          type="button"
                          onClick={() => { if (isImage) setPreviewUrl(url) }}
                          className={cn(
                            "flex h-24 flex-col items-center justify-center overflow-hidden rounded-xl border border-[#dfe7f5] bg-white text-center text-xs font-semibold text-[#43507f]",
                            !isImage && "bg-[#fff8f3]",
                          )}
                        >
                          {isImage ? (
                            <img src={url} alt={file.name} className="h-full w-full object-cover" />
                          ) : (
                            <>
                              <FileTextIcon className="size-7 text-[#ff5003]" />
                              <span className="mt-2 max-w-[90%] truncate">{file.name}</span>
                              <span className="text-[11px] text-[#68739c]">{formatFileSize(file.size)}</span>
                            </>
                          )}
                        </button>
                      )
                    })}
                    {mediaFiles.length === 0 ? (
                      <div className="col-span-full flex h-24 items-center justify-center rounded-xl border border-dashed border-[#dfe7f5] text-sm font-semibold text-[#68739c]">
                        No files uploaded
                      </div>
                    ) : null}
                  </div>
                </div>
              </section>

              <section className="space-y-5">
                <div>
                  <h2 className="text-base font-bold text-[#07145f]">3. Location</h2>
                  <div className="mt-4 overflow-hidden rounded-xl border border-[#dfe7f5]">
                    {reviewMapUrl ? (
                      <iframe title="Review report location" src={reviewMapUrl} className="h-36 w-full border-0 md:h-40" />
                    ) : (
                      <div className="flex h-36 items-center justify-center bg-[#eef3ff] text-sm font-semibold text-[#68739c]">
                        Map pin not selected
                      </div>
                    )}
                  </div>
                  <div className="mt-3 flex items-center gap-3 rounded-xl border border-[#dfe7f5] px-4 py-3">
                    <MapPinIcon className="size-5 shrink-0 text-[#2447b3]" />
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold text-[#68739c]">Selected address</p>
                      <p className="truncate text-sm font-extrabold text-[#07145f]">{address.trim()}</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-[#dfe7f5] bg-[#f8fbff] p-4">
                  <div className="flex items-start gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white text-[#2447b3]">
                      <LockIcon className="size-5" />
                    </span>
                    <div>
                      <p className="text-sm font-extrabold text-[#07145f]">Privacy & verification reminders</p>
                      <ul className="mt-3 space-y-2 text-xs font-semibold text-[#43507f]">
                        <li className="flex gap-2"><CheckIcon className="size-3.5 shrink-0 text-[#ff6a1a]" /> Your personal information will remain confidential.</li>
                        <li className="flex gap-2"><CheckIcon className="size-3.5 shrink-0 text-[#ff6a1a]" /> Reports are verified by our Barangay team.</li>
                        <li className="flex gap-2"><CheckIcon className="size-3.5 shrink-0 text-[#ff6a1a]" /> Providing accurate details helps us take faster action.</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </section>

              <div className="rounded-xl border border-[#dfe7f5] bg-[#f8fbff] px-4 py-3 text-xs font-semibold text-[#2447b3] xl:col-span-2">
                <InfoIcon className="mr-2 inline size-4 align-text-bottom" />
                After submission, you'll receive a tracking number so you can monitor updates in My Reports.
              </div>
            </div>
          )}

        </DialogBody>

        <DialogFooter className="bg-white">
          <div className="flex w-full flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => {
                if (step === "review") {
                  setStep("details")
                  return
                }
                setOpen(false)
              }}
              className="rounded-lg px-8 py-2.5 text-sm font-semibold text-[#2447b3] transition-colors hover:bg-[#eef3ff]"
            >
              {step === "review" ? "Back" : "Cancel"}
            </button>
            <button
              type="button"
              onClick={step === "review" ? handleSubmit : goToReview}
              disabled={isSubmitting}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#ff6a1a] px-8 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#e85f17] disabled:opacity-60"
            >
              {isSubmitting ? "Submitting" : step === "review" ? "Submit Report" : "Next: Review"}
              <ArrowRightIcon className="size-4" />
            </button>
          </div>
        </DialogFooter>
      </Dialog>

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
            const reportId = submittedReport.id
            resetForm()
            setSubmittedReport(null)
            setOpen(false)
            navigate(`/dashboard/reports/${reportId}`)
          }}
        />
      ) : null}

      {previewUrl ? (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 p-4" onClick={() => setPreviewUrl(null)}>
          <button
            type="button"
            onClick={() => setPreviewUrl(null)}
            className="absolute right-4 top-4 flex size-8 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
          >
            <XIcon className="size-5" />
          </button>
          <img src={previewUrl} alt="Preview" className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain" onClick={(event) => event.stopPropagation()} />
        </div>
      ) : null}
    </>
  )
}
