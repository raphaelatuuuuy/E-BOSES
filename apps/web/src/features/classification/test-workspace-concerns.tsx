import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  AlignLeftIcon,
  Ban,
  CircleCheck,
  CopyIcon,
  ImageOffIcon,
  Maximize2Icon,
  PlusIcon,
  ScanLineIcon,
  TriangleAlert,
  UploadCloudIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { cn } from "@workspace/ui/lib/utils"
import { SheetPrimaryButton } from "@/features/dashboard/components/sheet-dialog"
import { describeApiError } from "@/features/dashboard/lib/api-errors"
import { mediaIntegrityVerdict } from "@/features/dashboard/lib/plain-language"

import {
  generateSampleDescription,
  testConcernSubmission,
  type ConcernClassificationConfig,
  type ReportValidationResult,
  type SampleLanguage,
} from "./api"
import { categoryLabel, displayValue, readable, RuleMenu, verdictMeta } from "./shared"
import { LocationPinMap, type LocationPin, type MapPhotoMarker } from "./location-pin-map"

const SAMPLE_LANGUAGE_OPTIONS: { value: SampleLanguage; label: string }[] = [
  { value: "filipino", label: "Filipino" },
  { value: "english", label: "English" },
  { value: "hybrid", label: "Taglish" },
  { value: "bisaya", label: "Bisaya" },
  { value: "ilocano", label: "Ilocano" },
  { value: "hiligaynon", label: "Hiligaynon" },
  { value: "kapampangan", label: "Kapampangan" },
  { value: "waray", label: "Waray" },
]

const PRIVACY_BRIEF: Record<string, { tone: "good" | "warn" | "muted"; text: string }> = {
  unchecked: { tone: "muted", text: "Could not check for sensitive details automatically" },
  not_required: { tone: "muted", text: "No sensitive details found" },
  protected: { tone: "good", text: "Privacy protection applied" },
  sensitive_review_required: { tone: "warn", text: "Possible sensitive content found — held for review" },
  no_match_found: { tone: "warn", text: "Possible sensitive content suspected but not confirmed" },
  not_configured: { tone: "muted", text: "Privacy scanning is not enabled" },
  failed: { tone: "warn", text: "Privacy scan failed — image stays restricted" },
}

type Finding = {
  icon: typeof CircleCheck
  tone: "good" | "warn" | "bad" | "muted"
  text: string
}

const FINDING_TONE: Record<Finding["tone"], string> = {
  good: "text-green-600",
  warn: "text-amber-500",
  bad: "text-sos",
  muted: "text-neutral-400",
}

function ResultLabel({ children }: { children: ReactNode }) {
  return <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{children}</p>
}

export function ConcernTestWorkspace({ config }: { config: ConcernClassificationConfig }) {
  const [selectedCategory, setSelectedCategory] = useState("infrastructure")
  const [files, setFiles] = useState<File[]>([])
  const [pin, setPin] = useState<LocationPin | null>(null)
  const previews = useMemo(() => files.map((file) => URL.createObjectURL(file)), [files])
  useEffect(() => {
    return () => previews.forEach((url) => URL.revokeObjectURL(url))
  }, [previews])
  const [description, setDescription] = useState("")
  const [sampleLanguage, setSampleLanguage] = useState<SampleLanguage>("filipino")
  const [generating, setGenerating] = useState(false)
  const [reportResult, setReportResult] = useState<ReportValidationResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [height, setHeight] = useState(112)
  const textareaDragRef = useRef<{ startY: number; startHeight: number } | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const MAX_PHOTOS = 3

  const activeCategories = useMemo(
    () => config.categories.filter((category) => category.enabled),
    [config.categories],
  )

  const firstActiveKey = activeCategories[0]?.key
  if (activeCategories.length && firstActiveKey && !activeCategories.some((c) => c.key === selectedCategory)) {
    setSelectedCategory(firstActiveKey)
  }

  async function runTest() {
    if (!description.trim()) return
    setBusy(true)
    setReportResult(null)
    try {
      setReportResult(
        await testConcernSubmission({
          files,
          category: selectedCategory,
          description: description.trim(),
          latitude: pin?.lat ?? null,
          longitude: pin?.lng ?? null,
        }),
      )
    } catch (error) {
      toast.error(describeApiError(error, "The sample report could not be checked."))
    } finally {
      setBusy(false)
    }
  }

  async function generateSample() {
    if (generating) return
    setGenerating(true)
    setReportResult(null)
    try {
      const { description: next } = await generateSampleDescription({
        files,
        category: selectedCategory,
        mode: "matching",
        language: sampleLanguage,
      })
      setDescription(next)
    } catch (error) {
      toast.error(describeApiError(error, "The sample could not be generated."))
    } finally {
      setGenerating(false)
    }
  }

  const requirements = activeCategories.find((category) => category.key === selectedCategory)
  const descriptionOk =
    !requirements?.description_required || description.trim().length >= config.minimum_description_length
  const photoOk = !requirements?.photo_required || files.length > 0
  const locationOk = !requirements?.location_required || pin != null
  const canCheck = descriptionOk && photoOk && locationOk

  const streetImagery =
    reportResult?.street_imagery?.status === "checked" &&
    reportResult.street_imagery.image &&
    reportResult.street_imagery.latitude != null &&
    reportResult.street_imagery.longitude != null
      ? reportResult.street_imagery
      : null

  const mapMarkers = useMemo<MapPhotoMarker[]>(() => {
    if (!streetImagery) return []
    return [
      {
        id: "street",
        lat: streetImagery.latitude as number,
        lng: streetImagery.longitude as number,
        imageUrl: streetImagery.image as string,
        label: "Street view checked",
        sublabel: [
          streetImagery.captured_date,
          streetImagery.distance_meters != null ? `${streetImagery.distance_meters} m away` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      },
    ]
  }, [streetImagery])

  return (
    <div className="space-y-5">
      <div>
        <label className="mb-1.5 block text-[13px] font-semibold text-neutral-500">Filed under</label>
        <RuleMenu
          full
          value={selectedCategory}
          options={activeCategories.map((category) => ({ value: category.key, label: category.label }))}
          onChange={setSelectedCategory}
        />
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png"
        multiple
        className="hidden"
        onChange={(event) => {
          const picked = Array.from(event.target.files ?? []).slice(0, MAX_PHOTOS - files.length)
          if (picked.length) {
            setFiles((prev) => [...prev, ...picked].slice(0, MAX_PHOTOS))
            setReportResult(null)
          }
          event.target.value = ""
        }}
      />

      <div>
        <div className="grid grid-cols-3 gap-3">
          {previews.map((url, index) => (
            <div key={url} className="group relative">
              <img
                src={url}
                alt={`Sample photo ${index + 1}`}
                className="aspect-square w-full rounded-xl border border-neutral-200 object-cover"
              />
              <button
                type="button"
                onClick={() => {
                  setFiles((prev) => prev.filter((_, i) => i !== index))
                  setReportResult(null)
                }}
                aria-label={`Remove photo ${index + 1}`}
                className="absolute right-1.5 top-1.5 flex size-7 items-center justify-center rounded-full bg-neutral-800/50 text-neutral-200 transition-colors hover:bg-neutral-800/70"
              >
                <XIcon className="size-4" strokeWidth={2.5} aria-hidden />
              </button>
            </div>
          ))}
          {files.length < MAX_PHOTOS ? (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className={cn(
                "flex items-center justify-center rounded-xl bg-neutral-100 text-center transition-colors hover:bg-neutral-200",
                files.length === 0
                  ? "col-span-3 aspect-[3/1] w-full flex-col gap-1.5"
                  : "aspect-square w-full"
              )}
            >
              {files.length === 0 ? (
                <>
                  <UploadCloudIcon className="size-8 text-neutral-400" strokeWidth={1.5} aria-hidden />
                  <span className="text-[13px] font-medium text-neutral-500">Add a sample photo</span>
                </>
              ) : (
                <PlusIcon className="size-8 text-neutral-400" strokeWidth={1.5} aria-hidden />
              )}
            </button>
          ) : null}
        </div>
      </div>

      <div>
        <div className="relative">
          <textarea
            value={description}
            onChange={(event) => {
              setDescription(event.target.value)
              setReportResult(null)
            }}
            maxLength={255}
            placeholder="Describe what happened, where it is, and what needs attention."
            style={{ height }}
            className="w-full resize-none rounded-[14px] border-[1.5px] border-neutral-300 bg-white p-4 pb-8 text-[15px] font-medium text-neutral-900 outline-none transition-colors focus:border-neutral-500"
          />
          <span className="pointer-events-none absolute bottom-2.5 right-3 text-xs font-medium tabular-nums text-neutral-400">
            {description.length}/255
          </span>
          <div
            aria-hidden
            className="absolute inset-x-0 bottom-0 z-10 h-1.5 cursor-ns-resize touch-none"
            onPointerDown={(event) => {
              textareaDragRef.current = { startY: event.clientY, startHeight: height }
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={(event) => {
              const drag = textareaDragRef.current
              if (!drag) return
              setHeight(Math.min(320, Math.max(112, drag.startHeight + (event.clientY - drag.startY))))
            }}
            onPointerUp={() => {
              textareaDragRef.current = null
            }}
          />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center justify-end gap-3">
          <span className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void generateSample()}
              disabled={generating}
              className="text-xs font-medium text-neutral-700 transition-opacity hover:opacity-75 disabled:opacity-60"
            >
              {generating ? "Generating…" : "Generate sample description"}
            </button>
            <RuleMenu
              className="border-transparent bg-transparent hover:border-transparent"
              value={sampleLanguage}
              options={SAMPLE_LANGUAGE_OPTIONS}
              onChange={(value) => setSampleLanguage(value as SampleLanguage)}
            />
          </span>
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-[13px] font-semibold text-neutral-500">Location</label>
        <LocationPinMap pin={pin} onPinChange={setPin} markers={mapMarkers} />
      </div>

      <SheetPrimaryButton
        type="button"
        onClick={() => void runTest()}
        disabled={!canCheck || busy}
        className="bg-brand-navy text-white hover:bg-brand-navy/85 disabled:bg-neutral-200 disabled:text-neutral-400 disabled:hover:bg-neutral-200"
      >
        {busy ? "Checking…" : "Check this sample"}
      </SheetPrimaryButton>

      {reportResult ? <ConcernResult result={reportResult} config={config} selectedCategory={selectedCategory} previews={previews} streetImagery={streetImagery} /> : null}
    </div>
  )
}

function ConcernResult({
  result,
  config,
  selectedCategory,
  previews,
  streetImagery,
}: {
  result: ReportValidationResult
  config: ConcernClassificationConfig
  selectedCategory: string
  previews: string[]
  streetImagery: NonNullable<ReportValidationResult["street_imagery"]> | null
}) {
  const [lightbox, setLightbox] = useState<string | null>(null)
  const verdict = verdictMeta(result.recommended_action)
  const photoUnreviewable =
    result.image_uploaded &&
    (result.evidence_relationship === "image_unavailable" || result.image_review_succeeded === false)

  const findings: Finding[] = []
  if (result.text_assessment) {
    findings.push({ icon: AlignLeftIcon, tone: "muted", text: result.text_assessment })
  }

  const categoryOk = result.category_match === true
  const categoryBad = result.category_match === false
  const photoOk = result.image_uploaded && !photoUnreviewable && result.evidence_relationship === "supports_report"

  if (categoryOk && photoOk) {
    // Both the easy, common-case checks passed — one line instead of two.
    findings.push({ icon: CircleCheck, tone: "good", text: "The selected category matches the concern, and the photo supports it." })
  } else {
    if (categoryOk) {
      findings.push({ icon: CircleCheck, tone: "good", text: "The selected category matches the concern." })
    } else if (categoryBad) {
      findings.push({
        icon: TriangleAlert,
        tone: "warn",
        text: `The report reads more like ${categoryLabel(config, result.primary_category)} than ${categoryLabel(config, selectedCategory)}.`,
      })
    }
    if (!result.image_uploaded) {
      findings.push({ icon: ImageOffIcon, tone: "muted", text: "No photo was submitted." })
    } else if (photoUnreviewable) {
      findings.push({
        icon: TriangleAlert,
        tone: "warn",
        text: `The photo was received but could not be reviewed automatically${result.image_error ? ` (${readable(result.image_error)})` : ""} — this result was written from the text alone.`,
      })
    } else {
      const relationship = result.evidence_relationship
      const icon =
        relationship === "supports_report" ? CircleCheck : relationship === "partially_supports_report" ? TriangleAlert : Ban
      findings.push({
        icon,
        tone: relationship === "supports_report" ? "good" : relationship === "partially_supports_report" ? "warn" : "bad",
        text: displayValue(relationship),
      })
    }
  }
  if (result.urgent_attention) {
    findings.push({ icon: TriangleAlert, tone: "warn", text: "This may describe immediate danger." })
  }
  if (result.duplicate) {
    findings.push({ icon: CopyIcon, tone: "warn", text: "A very similar report was filed recently." })
  }
  // Only a real finding is worth a line. "Nothing found" and "could not tell"
  // are the ordinary outcomes for almost every photo, and reporting them would
  // train an official to read past this row.
  for (const finding of result.media_integrity?.findings ?? []) {
    if (finding.verdict === "authentic" || finding.verdict === "inconclusive") continue
    const photoLabel =
      (result.media_integrity?.findings?.length ?? 0) > 1 ? `Photo ${finding.index + 1}: ` : ""
    findings.push({
      icon: Ban,
      tone: "bad",
      text: `${photoLabel}${mediaIntegrityVerdict(finding.verdict).label.toLowerCase()}${
        finding.signals?.length ? ` — ${finding.signals[0]}` : ""
      }`,
    })
  }
  if (result.media_integrity?.second_opinion === "not_confirmed") {
    findings.push({
      icon: ScanLineIcon,
      tone: "muted",
      text: "A photo looked edited on the first pass, but the second look disagreed, so nothing was flagged.",
    })
  }
  if (result.street_imagery?.status === "checked") {
    // Street imagery is a location check only — does the pin sit in the same
    // place as the photo. It never checks whether the specific reported issue
    // is visible in a passing car's panorama, so "inconclusive" is ordinary
    // and non-concerning; only a real area_mismatch is a warning.
    const imageryVerdict = result.street_imagery.verdict ?? ""
    const verdictLabel = readable(imageryVerdict)
    findings.push({
      icon: imageryVerdict === "area_matches" ? CircleCheck : imageryVerdict === "area_mismatch" ? Ban : ScanLineIcon,
      tone: imageryVerdict === "area_matches" ? "good" : imageryVerdict === "area_mismatch" ? "bad" : "muted",
      text: `${verdictLabel.charAt(0).toUpperCase()}${verdictLabel.slice(1)}${result.street_imagery.distance_meters != null ? `, ${result.street_imagery.distance_meters} m from the pin` : ""}`,
    })
  } else if (result.street_imagery?.status === "no_coverage") {
    findings.push({ icon: ScanLineIcon, tone: "muted", text: "No street imagery covers this pin, so the ground-truth check was skipped." })
  }
  for (const comparison of result.photo_duplicate_llm?.comparisons ?? []) {
    const ref = comparison.tracking_id ?? "an earlier report"
    findings.push(
      comparison.verdict === "different"
        ? { icon: CircleCheck, tone: "good", text: comparison.reason ? `Different from ${ref} — ${comparison.reason}` : `Different from ${ref}` }
        : { icon: CopyIcon, tone: "warn", text: comparison.reason ? `${comparison.verdict === "same_issue" ? "Same issue as" : "Uncertain next to"} ${ref} — ${comparison.reason}` : `${comparison.verdict === "same_issue" ? "Same issue as" : "Uncertain next to"} ${ref}` },
    )
  }
  if (result.location && !result.location.accepted) {
    findings.push({
      icon: result.location.action === "block" ? Ban : TriangleAlert,
      tone: result.location.action === "block" ? "bad" : "warn",
      text: result.location.summary || result.location.message || "The pinned location is outside the barangay area.",
    })
  }
  if (result.image_uploaded) {
    const privacy = PRIVACY_BRIEF[result.privacy?.state ?? "unchecked"] ?? PRIVACY_BRIEF.unchecked
    const classes = result.privacy?.detected_classes?.length ? ` — ${result.privacy.detected_classes.join(", ")}` : ""
    findings.push({
      icon: privacy.tone === "good" ? CircleCheck : privacy.tone === "warn" ? TriangleAlert : ScanLineIcon,
      tone: privacy.tone,
      text: `${privacy.text}${classes}`,
    })
  }

  // Every submitted photo is shown, not just the first — and wherever a
  // privacy-protected version exists for a photo, that replaces the raw
  // upload here so nothing sensitive is ever the one on display.
  const galleryPhotos = previews.map((url, index) => ({
    key: url,
    src: index === 0 && result.privacy?.protected_image ? result.privacy.protected_image : url,
    label: previews.length > 1 ? `Sample photo ${index + 1}` : "Your sample photo",
  }))
  if (streetImagery) {
    galleryPhotos.push({ key: "street-view", src: streetImagery.image as string, label: "Street view" })
  }

  // Gemma's own recommended_action is computed before the street-imagery
  // check ever runs, so it has no way to know about a mismatch. On a real
  // mismatch, show what the configured street-imagery rule would actually do
  // to this report in production instead of a "continue" verdict that never
  // accounted for it.
  const streetMismatch = result.street_imagery?.status === "checked" && result.street_imagery.verdict === "area_mismatch"
  let HeaderIcon = verdict.icon
  let headerTone = verdict.tone
  let headerLabel = displayValue(result.recommended_action || "accept")
  if (streetMismatch) {
    if (config.street_imagery_action === "reject") {
      HeaderIcon = Ban
      headerTone = "text-sos"
      headerLabel = "Would be rejected automatically"
    } else if (config.street_imagery_action === "request_resubmission") {
      HeaderIcon = TriangleAlert
      headerTone = "text-amber-500"
      headerLabel = "Would ask the resident to resubmit"
    } else {
      HeaderIcon = TriangleAlert
      headerTone = "text-amber-500"
      headerLabel = `${headerLabel} — flagged for review`
    }
  }

  return (
    <div className="space-y-6 border-t border-neutral-200 pt-6">
      <div className="space-y-2">
        <div className="flex items-start gap-3">
          <HeaderIcon className={cn("mt-0.5 size-5 shrink-0", headerTone)} strokeWidth={2} aria-hidden />
          <div className="min-w-0">
            <p className="text-[16px] font-semibold leading-snug text-neutral-900">{headerLabel}</p>
            {result.explanation ? (
              <p className="mt-1 text-[14px] leading-relaxed text-neutral-600">{result.explanation}</p>
            ) : null}
          </div>
        </div>

        {findings.length ? (
          <ul className="space-y-1.5 pl-8">
            {findings.map((finding) => (
              <li key={finding.text} className="flex gap-2 text-[13.5px] leading-relaxed text-neutral-700">
                <finding.icon
                  className={cn("mt-0.5 size-4 shrink-0", FINDING_TONE[finding.tone])}
                  strokeWidth={2}
                  aria-hidden
                />
                <span className="min-w-0 break-words">{finding.text}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {galleryPhotos.length ? (
        <div className="flex flex-wrap justify-center gap-4">
          {galleryPhotos.map((photo) => (
            <PhotoTile key={photo.key} src={photo.src} label={photo.label} onExpand={() => setLightbox(photo.src)} />
          ))}
        </div>
      ) : null}

      {result.assigned_unit || result.matched_emergency_type ? (
        <div>
          <ResultLabel>Routing</ResultLabel>
          {result.assigned_unit ? (
            <p className="mt-1.5 text-sm font-medium leading-relaxed text-neutral-900">
              Would be routed to <span className="font-semibold">{result.assigned_unit.name}</span>, per the configured routing rule for
              this category.
            </p>
          ) : null}
          {result.matched_emergency_type ? (
            <div className="mt-1.5 flex items-start gap-2">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" strokeWidth={2} aria-hidden />
              <p className="min-w-0 break-words text-sm font-medium leading-relaxed text-neutral-900">
                Matches: {readable(result.matched_emergency_type)}
                {result.emergency_routing_reason ? ` — ${result.emergency_routing_reason}` : ""}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {result.missing_information?.length ? (
        <div className="rounded-[14px] border border-amber-200 bg-amber-50 p-4">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
            <TriangleAlert className="size-3.5" strokeWidth={2} aria-hidden /> Additional information needed
          </p>
          <ul className="mt-1 space-y-0.5">
            {result.missing_information.map((item) => (
              <li key={item} className="text-[13.5px] font-medium leading-relaxed text-amber-900">
                {item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {lightbox ? (
        <div
          className="fixed inset-0 z-[2000] flex items-center justify-center bg-neutral-950/85 p-6"
          role="button"
          tabIndex={-1}
          onClick={() => setLightbox(null)}
        >
          <img src={lightbox} alt="Full-size preview" className="max-h-full max-w-full rounded-lg object-contain" />
          <button
            type="button"
            onClick={() => setLightbox(null)}
            aria-label="Close preview"
            className="absolute right-5 top-5 flex size-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          >
            <XIcon className="size-5" strokeWidth={2} aria-hidden />
          </button>
        </div>
      ) : null}
    </div>
  )
}

function PhotoTile({ src, label, onExpand }: { src: string; label: string; onExpand: () => void }) {
  return (
    <div className="w-56 sm:w-72">
      <button
        type="button"
        onClick={onExpand}
        className="group relative block aspect-[4/3] w-full overflow-hidden rounded-[14px] border border-neutral-200 bg-neutral-50"
      >
        <img src={src} alt={label} className="size-full object-cover transition-opacity group-hover:opacity-80" />
        <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
          <Maximize2Icon className="size-5 text-white drop-shadow" strokeWidth={2} aria-hidden />
        </span>
      </button>
      <p className="mt-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{label}</p>
    </div>
  )
}
