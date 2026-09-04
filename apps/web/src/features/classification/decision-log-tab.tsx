import { useEffect, useMemo, useState } from "react"
import { Ban, ChevronDownIcon, CircleCheck, LoaderCircleIcon, RefreshCwIcon, SirenIcon, TriangleAlert } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@workspace/ui/lib/utils"
import { FilterRow, ListSearch, Pager } from "@/components/ui/list-controls"
import { SheetDialog } from "@/features/dashboard/components/sheet-dialog"
import { getLlmDecisionLog, rerunLlmDecisionLogStreetImagery, revertAutomatedContentAction, type LlmDecisionLogDomain, type LlmDecisionLogEntry } from "./api"
import { describeApiError } from "@/features/dashboard/lib/api-errors"
import { mediaIntegrityVerdict } from "@/features/dashboard/lib/plain-language"
import { fetchAuthorizedProof, listOcrTests, type OcrTestResult } from "@/features/ocr/api"
import { displayValue, readable, verdictMeta } from "./shared"

/**
 * The picture-check verdict on a run, or null when there is nothing to say.
 *
 * "authentic" and "inconclusive" are the ordinary outcomes on the great
 * majority of runs, so surfacing them on every row would bury the handful
 * that matter.
 */
const QUIET_INTEGRITY_VERDICTS = new Set(["authentic", "inconclusive", ""])

function integrityVerdictOf(snapshot: Record<string, unknown>): string | null {
  const verdict = snapshot?.media_integrity_overall
  if (typeof verdict !== "string" || QUIET_INTEGRITY_VERDICTS.has(verdict)) {
    return null
  }
  return verdict
}

function locationOf(entry: DisplayLogEntry): string {
  if (entry.source === "ocr") return "Not applicable"
  if (entry.location?.trim()) return entry.location.trim()
  const input = entry.input_snapshot
  for (const key of ["location", "address", "reported_area"]) {
    const value = input?.[key]
    if (typeof value === "string" && value.trim()) return value
  }
  const latitude = input?.latitude
  const longitude = input?.longitude
  if (latitude != null && longitude != null) return `${latitude}, ${longitude}`
  return "No location"
}

function reportTextOf(entry: DisplayLogEntry): string {
  if (entry.source === "ocr") {
    const document = entry.input_snapshot.document_type
    return typeof document === "string" ? `OCR check · ${document}` : "OCR document check"
  }
  const input = entry.input_snapshot
  for (const key of ["description", "content_text", "title"]) {
    const value = input?.[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return DOMAIN_LABEL[entry.domain]
}

function submittedDescriptionOf(entry: DisplayLogEntry): string {
  const value = entry.input_snapshot?.description
  return typeof value === "string" && value.trim() ? value.trim() : "No submitted description was captured."
}

function generatedSummaryOf(entry: DisplayLogEntry): string {
  if (entry.source !== "ocr" && entry.resident_message?.trim()) return entry.resident_message.trim()
  return reportTextOf(entry)
}

function normaliseCopy(value: string): string {
  return value.replace(/[“”"']/g, "").replace(/\s+/g, " ").trim().toLocaleLowerCase()
}

function descriptionCopyOf(entry: DisplayLogEntry) {
  const generated = generatedSummaryOf(entry)
  const submitted = submittedDescriptionOf(entry)
  const same = entry.source !== "ocr" && normaliseCopy(generated) === normaliseCopy(submitted)
  return { generated, submitted, same }
}

function categoryOf(entry: DisplayLogEntry): string {
  if (entry.source === "ocr") return "Document verification"
  const value = entry.output_snapshot.primary_category || entry.input_snapshot.selected_category
  if (typeof value !== "string" || !value.trim()) return "Not classified yet"
  return readable(value).replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function outcomeOf(action: string | null | undefined): string {
  const value = (action || "").replace(/_/g, " ").trim()
  const labels: Record<string, string> = {
    accept: "Accepted",
    "accept with privacy review": "Accepted with photo review",
    "reject as irrelevant": "Rejected",
    "manual review": "Held for review",
    "request more information": "More information needed",
    "escalate as emergency": "Escalated",
    "take down": "Remove from community",
    "ocr queued": "Waiting to be checked",
    "ocr processing": "Checking now",
    "ocr passed": "Verification passed",
    "ocr warning": "Passed with warnings",
    "ocr failed": "Needs attention",
    "ocr error": "Could not complete",
    "ocr cancelled": "Cancelled",
  }
  return labels[value] || (value ? value.replace(/\b\w/g, (letter) => letter.toUpperCase()) : "No outcome")
}

const DOMAIN_FILTERS: { value: LlmDecisionLogDomain | ""; label: string }[] = [
  { value: "", label: "All reports" },
  { value: "concern", label: "Concerns" },
  { value: "emergency", label: "Emergencies" },
  { value: "verification", label: "Verification" },
]

const DOMAIN_LABEL: Record<LlmDecisionLogDomain, string> = {
  concern: "Concern",
  emergency: "Critical-priority concern",
  verification: "Verification",
  community: "Concern · community content",
}

const PAGE_SIZE = 25

type DisplayLogEntry = LlmDecisionLogEntry & {
  source?: "ocr"
  ocr_status?: OcrTestResult["status"]
  reference_images?: NonNullable<OcrTestResult["reference_images"]>
}

const AUDIT_RANGES = [
  { key: "7", label: "7 days" },
  { key: "30", label: "30 days" },
  { key: "all", label: "All time" },
] as const

function outcomeUnit(entry: DisplayLogEntry): string {
  if (entry.assigned_department?.name) return entry.assigned_department.name
  if (entry.source === "ocr") return "OCR document check"
  if (entry.content_flag_id) return "Community moderation"
  return "No responsible unit"
}

const SNAPSHOT_LABELS: Record<string, string> = {
  content_text: "Content",
  reporter_note: "Reporter note",
  image_submitted: "Photo submitted",
  image_count: "Photos submitted",
  image_url: "Submitted image",
  document_type: "Document type",
  image_side: "Image side",
  assessment: "Assessment",
  image_review: "Photo review",
  matched_reason: "Why it was flagged",
  short_explanation: "Summary",
  recommended_disposition: "Action taken",
  model_recommended_action: "Model suggestion",
  final_decision: "Final decision",
  decision_source: "Decision source",
  decision_reason: "Decision reason",
  street_imagery: "Street-view comparison",
  captured_date: "Captured date",
  pano_date: "Captured date",
  distance_meters: "Distance from pin",
  priority: "Priority",
  primary_category: "Category",
  ocr_confidence: "OCR confidence",
  provider: "OCR service",
  rule_results: "Rule checks",
}

const SNAPSHOT_VALUE_LABELS: Record<string, string> = {
  clearly_violates: "Violates community guidelines",
  supports_flag: "Supports the moderation action",
  irrelevant: "Photo does not match the report",
  false_info: "Misleading information",
  take_down: "Remove from community",
  dismiss: "Keep for staff review",
  passed: "Passed",
  warning: "Passed with warnings",
  failed: "Needs attention",
  error: "Could not complete",
  queued: "Waiting to be checked",
  processing: "Checking now",
  cancelled: "Cancelled",
  accepted: "Accepted",
  rejected: "Rejected",
  pending: "Held for review",
  critical: "Critical",
  moderate: "Moderate",
  high: "High",
  low: "Low",
}

function snapshotLabel(key: string) {
  return SNAPSHOT_LABELS[key] ?? readable(key).replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function snapshotValue(value: unknown) {
  if (typeof value !== "string") return value
  return SNAPSHOT_VALUE_LABELS[value] ?? value
}

function ocrAction(status: OcrTestResult["status"] | undefined) {
  if (status === "passed") return "accept"
  if (status === "failed") return "reject as irrelevant"
  return "manual review"
}

function ocrLogEntry(test: OcrTestResult): DisplayLogEntry {
  const id = -Math.abs(Number(test.id) || 1)
  const documentName = typeof test.document_type === "string" ? test.document_type : test.document_type?.name
  const submittedMedia = test.image_url
    ? [{
        id: Math.abs(Number(test.id) || 1),
        label: test.filename || "Submitted document image",
        preview_url: test.image_url,
        raw_url: test.image_url,
      }]
    : []
  return {
    id,
    run_kind: "simulation",
    domain: "verification",
    created_at: test.created_at || new Date().toISOString(),
    recommended_action: `ocr_${test.status}`,
    resident_message: test.error || "OCR test completed.",
    assigned_department: null,
    routing_reason: "",
    model_version: test.provider || "OCR",
    duration_ms: null,
    location: "Not applicable",
    input_snapshot: {
      document_type: documentName || "Configured document",
      image_side: test.test_side || "single",
      filename: test.filename,
      image_url: test.image_url || null,
    },
    output_snapshot: {
      status: test.status,
      provider: test.provider || "OCR",
      ocr_confidence: test.confidence ?? test.overall_confidence ?? null,
      extracted_fields: test.extracted_fields || {},
      picture_check: test.id_integrity_checks || test.id_integrity || null,
      error: test.error || null,
    },
    source: "ocr",
    ocr_status: test.status,
    record_type: "verification",
    priority: null,
    final_decision: {
      action: ocrAction(test.status),
      label: outcomeOf(`ocr_${test.status}`),
      reason: test.error || "The configured verification checks were run against this image.",
      source: "Document verification",
    },
    submitted_media: submittedMedia,
    reference_images: test.reference_images || [],
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function formatPrimitive(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—"
  if (typeof value === "boolean") return value ? "Yes" : "No"
  return String(snapshotValue(value))
}

function ProtectedLogImage({ src, label }: { src: string; label: string }) {
  const [state, setState] = useState({ src: "", objectUrl: "", error: false, loading: false })
  const [attempt, setAttempt] = useState(0)
  const isDataUri = /^data:image\//i.test(src)

  useEffect(() => {
    if (isDataUri) return
    let cancelled = false
    let objectUrl = ""
    void fetchAuthorizedProof(src)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob)
        if (cancelled) {
          URL.revokeObjectURL(objectUrl)
          return
        }
        setState({ src, objectUrl, error: false, loading: false })
      })
      .catch(() => {
        if (!cancelled) setState({ src, objectUrl: "", error: true, loading: false })
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [src, attempt, isDataUri])

  if (isDataUri) return <img src={src} alt={label} className="mt-2 max-h-52 max-w-full rounded-lg border border-neutral-200 object-contain" />

  if (state.src !== src || state.loading) return <span className="text-neutral-400">Loading image…</span>
  if (state.error || !state.objectUrl) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2 text-neutral-400">
        Image unavailable
        <button
          type="button"
          onClick={() => setAttempt((value) => value + 1)}
          className="inline-flex items-center gap-1 font-semibold text-brand-navy hover:text-accent"
        >
          <RefreshCwIcon className="size-3.5" aria-hidden /> Retry
        </button>
      </span>
    )
  }
  return <img src={state.objectUrl} alt={label} className="mt-2 max-h-52 max-w-full rounded-lg border border-neutral-200 object-contain" />
}

function SnapshotValue({ value, keyName = "" }: { value: unknown; keyName?: string }) {
  if (typeof value === "string" && (keyName === "image_url" || keyName.endsWith("_image_url"))) {
    return <ProtectedLogImage src={value} label={snapshotLabel(keyName)} />
  }
  if (Array.isArray(value)) {
    if (!value.length) return <>—</>
    if (value.some((item) => isPlainObject(item))) {
      return (
        <div className="space-y-2">
          {value.map((item, index) => (
            <div key={index} className="rounded-lg border border-neutral-200 bg-white p-2">
              <SnapshotValue value={item} />
            </div>
          ))}
        </div>
      )
    }
      return <>{value.map((item) => formatPrimitive(item)).join(", ")}</>
  }
  if (isPlainObject(value)) {
    const rows = Object.entries(value)
    if (!rows.length) return <>—</>
    return (
      <dl className="space-y-1 border-l-2 border-neutral-200 pl-3">
        {rows.map(([key, nested]) => (
          <div key={key} className="flex gap-2 text-[12px] leading-relaxed">
            <dt className="shrink-0 font-semibold text-neutral-500">{snapshotLabel(key)}</dt>
            <dd className="min-w-0 break-words text-neutral-900">
              <SnapshotValue value={nested} keyName={key} />
            </dd>
          </div>
        ))}
      </dl>
    )
  }
  return <>{formatPrimitive(value)}</>
}

function SnapshotTable({ label, snapshot }: { label: string; snapshot: Record<string, unknown> }) {
  const rows = Object.entries(snapshot ?? {})
  if (rows.length === 0) return null
  return (
    <div>
      <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-neutral-400">{label}</p>
      <dl className="space-y-1 rounded-[10px] bg-white p-3">
        {rows.map(([key, value]) => (
          <div key={key} className="flex gap-2 text-[12px] leading-relaxed">
            <dt className="shrink-0 font-semibold text-neutral-500">{snapshotLabel(key)}</dt>
            <dd className="min-w-0 break-words text-neutral-900">
              <SnapshotValue value={value} keyName={key} />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function StreetViewEvidence({
  street,
  retrying,
  onRetry,
}: {
  street: NonNullable<LlmDecisionLogEntry["street_imagery"]> | null
  retrying: boolean
  onRetry: () => void
}) {
  const [failedSrc, setFailedSrc] = useState("")
  const imageFailed = Boolean(street?.image && failedSrc === street.image)

  const verdictLabel = street?.verdict === "inconclusive"
    ? "Could not confirm the location"
    : street?.verdict
      ? readable(street.verdict).replace(/^./, (value) => value.toUpperCase())
      : "Not available"
  const verdictExplanation = street?.verdict === "inconclusive"
    ? "The submitted photo did not contain enough stable landmarks to make a reliable comparison. This is not a rejection."
    : street?.explanation || "The comparison explains whether the submitted photo matches the pinned area."

  const statusText = street?.status === "no_coverage"
    ? "No street imagery was found for this location."
    : street?.status === "skipped"
      ? "The street-view comparison was skipped for this run."
      : street?.status === "disabled"
        ? "Street-view checks are not enabled for this category."
        : "The comparison image was not captured for this run."
  const canRetry = street?.status !== "disabled" && street?.status !== "skipped"

  return (
    <section>
      <p className="mb-2 text-meta font-semibold uppercase tracking-wide text-neutral-400">Location comparison</p>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(220px,0.75fr)]">
        <div className="min-w-0">
          <p className="text-meta font-medium text-neutral-500">Street view</p>
          {street?.image && !imageFailed ? (
            <img
              src={street.image}
              alt="Street-view comparison"
              className="mt-2 max-h-64 w-full rounded-lg border border-neutral-200 object-contain"
              onError={() => setFailedSrc(street.image || "")}
            />
          ) : (
            <div className="mt-2 flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-neutral-200 bg-neutral-50 px-4 text-center">
              <p className="text-meta text-neutral-500">{imageFailed ? "The street-view image could not be loaded." : statusText}</p>
              {canRetry ? (
                <button
                  type="button"
                  onClick={onRetry}
                  disabled={retrying}
                  className="inline-flex items-center gap-1.5 text-meta font-semibold text-brand-navy hover:text-accent disabled:opacity-50"
                >
                  <RefreshCwIcon className={cn("size-3.5", retrying && "animate-spin")} aria-hidden />
                  {retrying ? "Retrying comparison…" : "Retry street-view check"}
                </button>
              ) : null}
            </div>
          )}
          {street?.captured_date || street?.distance_meters != null ? (
            <p className="mt-2 text-meta text-neutral-500">
              {[street.captured_date, street.distance_meters != null ? `${street.distance_meters} m from the pin` : null].filter(Boolean).join(" · ")}
            </p>
          ) : null}
        </div>
        <div className="border-l border-neutral-200 pl-4">
          <p className="text-meta font-medium text-neutral-500">Result</p>
          <p className="mt-2 text-[14px] font-semibold text-neutral-900">
            {verdictLabel}
          </p>
          <p className="mt-1 text-meta leading-relaxed text-neutral-600">
            {verdictExplanation}
          </p>
        </div>
      </div>
    </section>
  )
}

function decisionPresentation(entry: DisplayLogEntry) {
  const decision = entry.final_decision ?? {
    action: entry.recommended_action,
    label: entry.source === "ocr" ? outcomeOf(`ocr_${entry.ocr_status}`) : entry.recommended_action,
    reason: entry.resident_message || "No final decision recorded.",
    source: "Model result",
  }
  const decisionLabel = outcomeOf(decision.label || "No decision recorded")
  const decisionText = decisionLabel.toLowerCase()
  const DecisionIcon = decisionText.includes("reject") || decisionText.includes("remove from")
    ? Ban
    : decisionText.includes("escalat")
      ? SirenIcon
      : decisionText.includes("attention") || decisionText.includes("failed") || decisionText.includes("held") || decisionText.includes("information") || decisionText.includes("warning") || decisionText.includes("could not")
        ? TriangleAlert
        : CircleCheck
  const decisionTone = DecisionIcon === Ban || DecisionIcon === SirenIcon ? "text-sos" : DecisionIcon === TriangleAlert ? "text-amber-500" : "text-green-600"
  return { decision, decisionLabel, DecisionIcon, decisionTone }
}

function DecisionDetailsDialog({
  entry,
  street,
  retrying,
  onRetryStreetView,
  onClose,
  onRevert,
  reverting,
  reverted,
}: {
  entry: DisplayLogEntry | null
  street: NonNullable<LlmDecisionLogEntry["street_imagery"]> | null
  retrying: boolean
  onRetryStreetView: () => void
  onClose: () => void
  onRevert: () => void
  reverting: boolean
  reverted: boolean
}) {
  if (!entry) return null
  const { decision, decisionLabel, DecisionIcon, decisionTone } = decisionPresentation(entry)
  const { generated, submitted, same } = descriptionCopyOf(entry)

  return (
    <SheetDialog
      open
      onClose={onClose}
      title={entry.source === "ocr" ? "Verification details" : "Report details"}
      description={`${new Date(entry.created_at).toLocaleDateString("en-PH", { dateStyle: "medium" })} · ${categoryOf(entry)}`}
      size="wide"
    >
      <div className="space-y-6">
        <section className="border-b border-neutral-200 pb-5">
          <div className="flex items-start gap-3">
            <DecisionIcon className={cn("mt-0.5 size-5 shrink-0", decisionTone)} strokeWidth={2} aria-hidden />
            <div className="min-w-0">
              <p className="text-[17px] font-semibold leading-snug text-neutral-900">{decisionLabel}</p>
              <p className="mt-1 text-[14px] leading-relaxed text-neutral-600">{decision.reason}</p>
            </div>
          </div>
          <dl className="mt-4 grid gap-3 border-t border-neutral-100 pt-4 sm:grid-cols-3">
            <div><dt className="text-meta text-neutral-400">Decision source</dt><dd className="mt-0.5 text-meta text-brand-navy">{decision.source}</dd></div>
            <div><dt className="text-meta text-neutral-400">Assigned unit</dt><dd className="mt-0.5 text-meta text-brand-navy">{outcomeUnit(entry)}</dd></div>
            <div><dt className="text-meta text-neutral-400">Model suggestion</dt><dd className="mt-0.5 text-meta text-brand-navy">{outcomeOf(entry.recommended_action)}</dd></div>
          </dl>
          {decision.legacy ? <p className="mt-3 text-meta text-amber-700">This is a legacy run. The final evidence was not captured at the time.</p> : null}
        </section>

        <section>
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-neutral-800">{same ? submitted : generated}</p>
          {!same && entry.source !== "ocr" ? (
            <div className="mt-4 border-t border-neutral-200 pt-3">
              <p className="mb-1 text-meta font-semibold uppercase tracking-wide text-neutral-400">Submitted description</p>
              <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-neutral-700">{submitted}</p>
            </div>
          ) : null}
          {entry.source !== "ocr" ? (
            <dl className="mt-4 grid gap-x-8 gap-y-3 border-t border-neutral-200 pt-3 sm:grid-cols-2">
              <div><dt className="text-meta text-neutral-400">Category</dt><dd className="mt-0.5 text-meta text-brand-navy">{categoryOf(entry)}</dd></div>
              <div><dt className="text-meta text-neutral-400">Location</dt><dd className="mt-0.5 text-meta text-brand-navy">{locationOf(entry)}</dd></div>
            </dl>
          ) : null}
        </section>

        {entry.submitted_media?.length ? (
          <section>
            <p className="mb-2 text-meta font-semibold uppercase tracking-wide text-neutral-400">Submitted evidence</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {entry.submitted_media.map((media) => (
                <figure key={media.id} className="min-w-0">
                  <div className="overflow-hidden rounded-[12px] border border-neutral-200 bg-neutral-50 p-2">
                  <ProtectedLogImage src={media.raw_url || media.preview_url} label={media.label} />
                  </div>
                  <figcaption className="mt-2 truncate text-meta text-neutral-500" title={media.label}>{media.label}</figcaption>
                </figure>
              ))}
            </div>
          </section>
        ) : null}

        {entry.source === "ocr" && entry.reference_images?.length ? (
          <section>
            <p className="mb-2 text-meta font-semibold uppercase tracking-wide text-neutral-400">Configured reference samples</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {entry.reference_images.map((sample) => (
                <figure key={`${sample.side}-${sample.url}`} className="min-w-0">
                  <div className="overflow-hidden rounded-[12px] border border-neutral-200 bg-neutral-50 p-2">
                  <ProtectedLogImage src={sample.url} label={sample.label || `${sample.side} reference`} />
                  </div>
                  <figcaption className="mt-2 text-meta text-neutral-500">{sample.label || `${sample.side} reference`}</figcaption>
                </figure>
              ))}
            </div>
          </section>
        ) : null}

        {entry.concern_id ? (
          <StreetViewEvidence street={street} retrying={retrying} onRetry={onRetryStreetView} />
        ) : null}

        {entry.content_flag_id ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-amber-200 bg-amber-50 px-3 py-2.5">
            <p className="text-[12px] leading-relaxed text-amber-900">
              {reverted ? "Reverted — content is back for staff review." : "This check is linked to an automated community action."}
            </p>
            {!reverted ? (
              <button
                type="button"
                onClick={onRevert}
                disabled={reverting}
                className="shrink-0 rounded-full border border-amber-300 px-3 py-1.5 text-[12px] font-semibold text-amber-900 transition-colors hover:bg-amber-100 disabled:opacity-50"
              >
                {reverting ? "Reverting…" : "Revert action"}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </SheetDialog>
  )
}

export function DecisionLogTab() {
  const [domain, setDomain] = useState<LlmDecisionLogDomain | "">("")
  const [entries, setEntries] = useState<DisplayLogEntry[]>([])
  const [count, setCount] = useState(0)
  const [page, setPage] = useState(1)
  const [loadedKey, setLoadedKey] = useState("")
  const [detailId, setDetailId] = useState<number | null>(null)
  const [reverting, setReverting] = useState<number | null>(null)
  const [reverted, setReverted] = useState<Set<number>>(new Set())
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [range, setRange] = useState<(typeof AUDIT_RANGES)[number]["key"]>("30")
  const [streetRetry, setStreetRetry] = useState<number | null>(null)
  const [streetResults, setStreetResults] = useState<Record<number, NonNullable<LlmDecisionLogEntry["street_imagery"]>>>({})
  const requestKey = `${domain}|${page}|${debouncedSearch}|${range}`

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [search])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const response = await getLlmDecisionLog({
        domain: domain || undefined,
        run_kind: "production",
        page: domain === "verification" ? 1 : page,
        page_size: domain === "verification" ? 100 : PAGE_SIZE,
        search: debouncedSearch || undefined,
        days: range === "all" ? undefined : Number(range),
      })
      let nextEntries: DisplayLogEntry[] = response.results
      let nextCount = response.count
      if (domain === "verification") {
        const ocrTests = await listOcrTests()
        const ocrEntries = ocrTests.map(ocrLogEntry).filter((entry) => {
          if (!debouncedSearch) return true
          const query = debouncedSearch.toLowerCase()
          return `${reportTextOf(entry)} ${categoryOf(entry)} ${entry.input_snapshot.document_type ?? ""}`.toLowerCase().includes(query)
        }).filter((entry) => {
          if (range === "all") return true
          return Date.now() - new Date(entry.created_at).getTime() <= Number(range) * 86_400_000
        })
        nextEntries = [...nextEntries, ...ocrEntries].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )
        nextCount += ocrEntries.length
      }
      if (!cancelled) {
        setEntries(nextEntries)
        setCount(nextCount)
        setDetailId(null)
        setLoadedKey(requestKey)
      }
    }
    void load()
      .catch((error) => {
        if (!cancelled) {
          setEntries([])
          setCount(0)
          setLoadedKey(requestKey)
        }
        toast.error(describeApiError(error, "Could not load the system checks."))
      })
    return () => {
      cancelled = true
    }
  }, [domain, page, debouncedSearch, range, requestKey])

  async function revert(entry: LlmDecisionLogEntry) {
    if (!entry.content_flag_id || reverting != null) return
    if (!window.confirm("Revert this automated community action and return the content for staff review?")) return
    setReverting(entry.id)
    try {
      await revertAutomatedContentAction(entry.content_flag_id)
      setReverted((prev) => new Set(prev).add(entry.id))
      toast.success("Action reverted. The content is back for staff review.")
    } catch (error) {
      toast.error(describeApiError(error, "The action could not be reverted."))
    } finally {
      setReverting(null)
    }
  }

  async function retryStreetView(entry: DisplayLogEntry) {
    if (!entry.concern_id || streetRetry != null) return
    setStreetRetry(entry.id)
    try {
      const result = await rerunLlmDecisionLogStreetImagery(entry.id)
      setStreetResults((previous) => ({ ...previous, [entry.id]: result }))
      setDetailId(entry.id)
    } catch (error) {
      toast.error(describeApiError(error, "The street-view comparison could not be rerun."))
    } finally {
      setStreetRetry(null)
    }
  }

  const domainOptions = DOMAIN_FILTERS.map((filter) => ({ key: filter.value, label: filter.label }))
  const loading = loadedKey !== requestKey
  const filteredEntries = useMemo(
    () => domain === "verification" ? entries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : entries,
    [domain, entries, page],
  )

  return (
    <div className="space-y-4">
      <FilterRow
        options={domainOptions}
        value={domain}
        onChange={(value) => {
          setPage(1)
          setDomain(value as LlmDecisionLogDomain | "")
        }}
      />

      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
        <ListSearch
          value={search}
          onChange={(value) => { setSearch(value); setPage(1) }}
          placeholder="Search reports, locations, or decisions"
          label="Search system behavior log"
          className="flex-1 sm:max-w-sm"
        />
        <div className="flex items-center gap-6 overflow-x-auto whitespace-nowrap [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {AUDIT_RANGES.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => { setPage(1); setRange(item.key) }}
              className={cn(
                "shrink-0 text-meta transition-colors",
                range === item.key ? "font-medium text-brand-navy" : "text-neutral-400 hover:text-brand-navy",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <LoaderCircleIcon className="size-6 animate-spin text-brand-navy" />
        </div>
      ) : filteredEntries.length === 0 ? (
        <p className="border-y border-neutral-200 px-6 py-12 text-center text-[14px] font-medium text-neutral-500">
          No system checks in this section yet.
        </p>
      ) : (
        <ol className="border-y border-neutral-200">
          {filteredEntries.map((entry) => {
            const { decision, decisionLabel, DecisionIcon, decisionTone } = decisionPresentation(entry)
            const priorityLabel = entry.priority ? entry.priority.charAt(0).toUpperCase() + entry.priority.slice(1) : ""
            return (
              <li key={entry.id} className="grid gap-x-8 gap-y-3 border-b border-neutral-200 py-6 last:border-b-0 sm:grid-cols-[150px_minmax(0,1fr)]">
                <div className="text-meta tabular-nums text-neutral-400">
                  <p className="text-neutral-500">{new Date(entry.created_at).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}</p>
                  <p className="mt-0.5">{new Date(entry.created_at).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}</p>
                </div>
                <div className="grid min-w-0 gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                  <div className="min-w-0">
                    <div className="flex items-start gap-2">
                      <DecisionIcon className={cn("mt-0.5 size-5 shrink-0", decisionTone)} strokeWidth={2} aria-hidden />
                      <div className="min-w-0">
                        <p className="text-row font-normal text-brand-navy">{decisionLabel}</p>
                        <p className="mt-0.5 line-clamp-2 text-meta leading-relaxed text-neutral-600">{generatedSummaryOf(entry)}</p>
                      </div>
                    </div>
                    <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2 pl-7">
                      <div className="min-w-0">
                        <dt className="text-meta text-neutral-400">{entry.source === "ocr" ? "Document" : "Category"}</dt>
                        <dd className="mt-0.5 truncate text-meta text-brand-navy">{categoryOf(entry)}</dd>
                      </div>
                      {entry.source !== "ocr" ? (
                        <div className="min-w-0">
                          <dt className="text-meta text-neutral-400">Location</dt>
                          <dd className="mt-0.5 truncate text-meta text-brand-navy">{locationOf(entry)}</dd>
                        </div>
                      ) : null}
                      {priorityLabel ? (
                        <div className="min-w-0">
                          <dt className="text-meta text-neutral-400">Priority</dt>
                          <dd className="mt-0.5 text-meta font-medium text-brand-navy">{priorityLabel}</dd>
                        </div>
                      ) : null}
                      <div className="min-w-0">
                        <dt className="text-meta text-neutral-400">Source</dt>
                        <dd className="mt-0.5 truncate text-meta text-brand-navy">{decision.source}</dd>
                      </div>
                    </dl>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDetailId(entry.id)}
                    className="inline-flex items-center gap-1 self-start justify-self-start text-meta font-medium text-brand-navy transition-colors hover:text-accent sm:justify-self-end"
                  >
                    View details
                    <ChevronDownIcon className="size-4 -rotate-90" aria-hidden />
                  </button>
                </div>
              </li>
            )
          })}
        </ol>
      )}

      {!loading ? <Pager offset={(page - 1) * PAGE_SIZE} total={count} pageSize={PAGE_SIZE} onChange={(nextOffset) => setPage(Math.floor(nextOffset / PAGE_SIZE) + 1)} noun="checks" /> : null}

      <DecisionDetailsDialog
        entry={detailId === null ? null : entries.find((entry) => entry.id === detailId) ?? null}
        street={detailId === null ? null : streetResults[detailId] ?? entries.find((entry) => entry.id === detailId)?.street_imagery ?? null}
        retrying={detailId !== null && streetRetry === detailId}
        onRetryStreetView={() => {
          const entry = detailId === null ? null : entries.find((item) => item.id === detailId)
          if (entry) void retryStreetView(entry)
        }}
        onClose={() => setDetailId(null)}
        onRevert={() => {
          const entry = detailId === null ? null : entries.find((item) => item.id === detailId)
          if (entry) void revert(entry)
        }}
        reverting={detailId !== null && reverting === detailId}
        reverted={detailId !== null && reverted.has(detailId)}
      />
    </div>
  )
}

export function LegacyDecisionLogTab() {
  const [domain, setDomain] = useState<LlmDecisionLogDomain | "">("")
  const [entries, setEntries] = useState<LlmDecisionLogEntry[]>([])
  const [count, setCount] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [reverting, setReverting] = useState<number | null>(null)
  const [reverted, setReverted] = useState<Set<number>>(new Set())

  function toggleExpanded(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  useEffect(() => {
    let cancelled = false
    void getLlmDecisionLog({ domain: domain || undefined, page: 1, page_size: PAGE_SIZE })
      .then((response) => {
        if (cancelled) return
        setEntries(response.results)
        setCount(response.count)
        setPage(1)
      })
      .catch((error) => toast.error(describeApiError(error, "Could not load the decision log.")))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [domain])

  async function loadMore() {
    const nextPage = page + 1
    try {
      const response = await getLlmDecisionLog({ domain: domain || undefined, page: nextPage, page_size: PAGE_SIZE })
      setEntries((prev) => [...prev, ...response.results])
      setPage(nextPage)
    } catch (error) {
      toast.error(describeApiError(error, "Could not load more entries."))
    }
  }

  async function revert(entry: LlmDecisionLogEntry) {
    if (!entry.content_flag_id || reverting != null) return
    if (!window.confirm("Revert this automated community action and return the content for staff review?")) return
    setReverting(entry.id)
    try {
      await revertAutomatedContentAction(entry.content_flag_id)
      setReverted((prev) => new Set(prev).add(entry.id))
      toast.success("Automated action reverted. The content is back for staff review.")
    } catch (error) {
      toast.error(describeApiError(error, "The automated action could not be reverted."))
    } finally {
      setReverting(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-0.5 rounded-full bg-neutral-100 p-1">
        {DOMAIN_FILTERS.map((filter) => (
          <button
            key={filter.value || "all"}
            type="button"
            onClick={() => {
              setLoading(true)
              setDomain(filter.value)
            }}
            className={`flex-1 rounded-full py-2 text-[13px] font-medium transition-colors ${
              domain === filter.value ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-400 hover:bg-white/60 hover:text-neutral-900"
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <LoaderCircleIcon className="size-6 animate-spin text-brand-navy" />
        </div>
      ) : entries.length === 0 ? (
        <p className="py-10 text-center text-[14px] font-medium text-neutral-500">No decisions logged yet.</p>
      ) : (
        <div className="overflow-hidden rounded-[18px] border border-neutral-200">
          {entries.map((entry) => {
            const isOpen = expanded.has(entry.id)
            const verdict = verdictMeta(entry.recommended_action)
            return (
              <div key={entry.id} className="border-b border-neutral-200 last:border-b-0">
                <button
                  type="button"
                  onClick={() => toggleExpanded(entry.id)}
                  className="flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-neutral-50"
                >
                  <verdict.icon className={cn("mt-0.5 size-5 shrink-0", verdict.tone)} strokeWidth={2} aria-hidden />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex w-full items-center justify-between gap-3">
                      <span className="text-[11px] font-bold uppercase tracking-wide text-neutral-400">
                        {DOMAIN_LABEL[entry.domain]} · {entry.run_kind === "simulation" ? "Test" : "Live"}
                        {entry.model_version ? ` · ${entry.model_version}` : ""}
                      </span>
                      <span className="flex shrink-0 items-center gap-2 text-[12px] font-medium text-neutral-400">
                        {new Date(entry.created_at).toLocaleString()}
                        <ChevronDownIcon className={cn("size-3.5 transition-transform", isOpen && "rotate-180")} />
                      </span>
                    </div>
                    <p className="text-[14px] font-semibold text-neutral-900">
                      {entry.recommended_action ? displayValue(entry.recommended_action) : "No action recorded"}
                    </p>
                    {entry.resident_message ? (
                      <p className="text-[13px] leading-relaxed text-neutral-500">&ldquo;{entry.resident_message}&rdquo;</p>
                    ) : null}
                    {entry.routing_reason ? (
                      <p className="text-[13px] leading-relaxed text-neutral-500">{entry.routing_reason}</p>
                    ) : null}
                    {entry.assigned_department ? (
                      <p className="text-[12px] font-medium text-neutral-400">→ {entry.assigned_department.name}</p>
                    ) : null}
                    {(() => {
                      // Only shown when the picture check actually reached a
                      // finding. "Nothing found" and "could not tell" are the
                      // ordinary outcomes and would be noise on every row.
                      const verdict = integrityVerdictOf(entry.output_snapshot)
                      if (!verdict) return null
                      return (
                        <p className="text-[12px] font-medium text-destructive">
                          Photo: {mediaIntegrityVerdict(verdict).label}
                        </p>
                      )
                    })()}
                  </div>
                </button>
                {isOpen ? (
                  <div className="space-y-3 border-t border-neutral-100 bg-neutral-50 p-4">
                    {entry.duration_ms != null ? (
                      <p className="text-[12px] font-medium text-neutral-500">Took {entry.duration_ms} ms</p>
                    ) : null}
                    {entry.content_flag_id ? (
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-amber-200 bg-amber-50 px-3 py-2.5">
                        <p className="text-[12px] leading-relaxed text-amber-900">
                          {reverted.has(entry.id) ? "Reverted — content is back for staff review." : "This decision is linked to an automated community moderation action."}
                        </p>
                        {!reverted.has(entry.id) ? (
                          <button
                            type="button"
                            onClick={() => void revert(entry)}
                            disabled={reverting === entry.id}
                            className="shrink-0 rounded-full border border-amber-300 px-3 py-1.5 text-[12px] font-semibold text-amber-900 transition-colors hover:bg-amber-100 disabled:opacity-50"
                          >
                            {reverting === entry.id ? "Reverting…" : "Revert action"}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    <SnapshotTable label="Input" snapshot={entry.input_snapshot} />
                    <SnapshotTable label="Output" snapshot={entry.output_snapshot} />
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      {!loading && entries.length < count ? (
        <button
          type="button"
          onClick={() => void loadMore()}
          className="w-full rounded-full border border-neutral-300 py-2.5 text-[13px] font-semibold text-neutral-700 transition-colors hover:bg-neutral-100"
        >
          Load more
        </button>
      ) : null}
    </div>
  )
}
