import { createElement, useEffect, useMemo, useState } from "react"
import { Ban, ChevronDownIcon, CircleCheck, ImageOffIcon, LoaderCircleIcon, Maximize2Icon, RefreshCwIcon, ScanLineIcon, SignalHighIcon, SignalIcon, SignalLowIcon, SignalMediumIcon, SirenIcon, TriangleAlert } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@workspace/ui/lib/utils"
import { FilterRow, ListSearch, Pager } from "@/components/ui/list-controls"
import { SheetDialog } from "@/features/dashboard/components/sheet-dialog"
import { getLlmDecisionLog, revertAutomatedContentAction, type LlmDecisionLogDomain, type LlmDecisionLogEntry } from "./api"
import { describeApiError } from "@/features/dashboard/lib/api-errors"
import { mediaIntegrityVerdict } from "@/features/dashboard/lib/plain-language"
import { UserAvatar } from "@/features/dashboard/components/home/user-avatar"
import { SEVERITY_TONE } from "@/features/dashboard/components/concerns/concern-queue-item"
import { MediaLightbox } from "@/features/dashboard/components/authenticated-media"
import { toMediaPreviewItem } from "@/features/dashboard/lib/authenticated-media"
import { fetchAuthorizedProof, listOcrTests, type OcrTestResult } from "@/features/ocr/api"
import { getStreetViewImage } from "@/features/dashboard/api"
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
  if (entry.source === "ocr") {
    return "Document verification"
  }
  if (entry.address?.trim()) return entry.address.trim()
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

function descriptionOf(entry: DisplayLogEntry): string {
  const value = entry.report_description || entry.input_snapshot.description
  return typeof value === "string" && value.trim() ? value.trim() : "No description was captured."
}

function titleOf(entry: DisplayLogEntry): string {
  if (entry.source === "ocr") {
    const document = entry.input_snapshot.document_type
    return `${typeof document === "string" && document.trim() ? document.trim() : "Document"} verification`
  }
  if (entry.report_title?.trim()) return entry.report_title.trim()
  const value = entry.input_snapshot.title
  if (typeof value === "string" && value.trim()) return value.trim()
  return generatedSummaryOf(entry)
}

function reportTextOf(entry: DisplayLogEntry): string {
  if (entry.source === "ocr") {
    const document = entry.input_snapshot.document_type
    return typeof document === "string" ? document : "Document verification"
  }
  const input = entry.input_snapshot
  for (const key of ["description", "content_text", "title"]) {
    const value = input?.[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return DOMAIN_LABEL[entry.domain]
}

function generatedSummaryOf(entry: DisplayLogEntry): string {
  if (entry.source !== "ocr" && entry.resident_message?.trim()) return entry.resident_message.trim()
  return reportTextOf(entry)
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
    "ocr processing": "In progress",
    "ocr passed": "Verification passed",
    "ocr warning": "Accepted",
    "ocr failed": "Rejected",
    "ocr error": "Could not complete",
    "ocr cancelled": "Cancelled",
  }
  return labels[value] || (value ? value.replace(/\b\w/g, (letter) => letter.toUpperCase()) : "No outcome")
}

const DOMAIN_FILTERS: { value: LlmDecisionLogDomain | ""; label: string }[] = [
  { value: "", label: "All reports" },
  { value: "concern", label: "Concerns" },
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

function priorityIconOf(priority: DisplayLogEntry["priority"]) {
  if (priority === "critical") return SignalIcon
  if (priority === "high") return SignalHighIcon
  if (priority === "moderate") return SignalMediumIcon
  if (priority === "low") return SignalLowIcon
  return null
}

type DetailFinding = {
  icon: typeof CircleCheck
  tone: "good" | "warn" | "bad" | "muted"
  text: string
}

const DETAIL_FINDING_TONE: Record<DetailFinding["tone"], string> = {
  good: "text-green-600",
  warn: "text-amber-500",
  bad: "text-sos",
  muted: "text-neutral-400",
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
  if (status === "passed" || status === "warning") return "accept"
  if (status === "failed") return "reject as irrelevant"
  return "manual review"
}

function ocrLogEntry(test: OcrTestResult): DisplayLogEntry {
  const id = -Math.abs(Number(test.id) || 1)
  const documentName = test.document_type_name || (typeof test.document_type === "string" ? test.document_type : test.document_type?.name)
  const requestedBy = test.requested_by_name?.trim() || "Barangay official"
  const statusSummary = test.status === "passed" || test.status === "warning"
    ? "The document was accepted automatically because all required checks passed."
    : test.status === "failed"
        ? test.error || "The submitted document did not pass verification."
        : test.error || "The document check could not be completed."
  const results: Array<{ tone: DetailFinding["tone"]; text: string }> = []
  if (test.status === "passed" || test.status === "warning") results.push({ tone: "good", text: "The document was accepted automatically." })
  if (test.status === "failed") results.push({ tone: "bad", text: test.error || "The document did not pass the configured requirements." })
  if (test.status === "error" || test.status === "cancelled") results.push({ tone: "warn", text: test.error || "The document check was not completed." })
  const pictureChecks = test.id_integrity_checks?.length
    ? test.id_integrity_checks
    : test.pipeline?.integrity_checks?.length
      ? test.pipeline.integrity_checks
      : test.id_integrity
        ? [test.id_integrity]
        : []
  if (pictureChecks.some((check) => check.format_verdict === "format_mismatch")) {
    results.push({ tone: "bad", text: "The document layout does not match the configured reference sample." })
  } else if (pictureChecks.some((check) => check.format_verdict === "format_matches")) {
    results.push({ tone: "good", text: "The document layout matches the configured reference sample." })
  }
  if (pictureChecks.some((check) => check.integrity_verdict === "suspected_edit" || check.integrity_verdict === "suspected_ai" || check.integrity_verdict === "photo_of_screen" || check.integrity_verdict === "impossible_content")) {
    results.push({ tone: "bad", text: "The document image shows authenticity concerns." })
  } else if (pictureChecks.some((check) => check.integrity_verdict === "authentic")) {
    results.push({ tone: "good", text: "The document looks like an original camera photo." })
  }
  const failedRules = (test.rule_results || []).filter((rule) => rule.passed === false)
  if (failedRules.length && test.status === "warning") {
    results.push({ tone: "muted", text: `${failedRules.length} optional ${failedRules.length === 1 ? "check did" : "checks did"} not match, but this did not block acceptance.` })
  }
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
    resident_message: statusSummary,
    assigned_department: null,
    routing_reason: "",
    model_version: "Document verification",
    duration_ms: null,
    location: "Document verification",
    input_snapshot: {
      document_type: documentName || "Document",
      requested_by: requestedBy,
      image_side: test.test_side || "single",
    },
    output_snapshot: {
      status: test.status,
      results,
    },
    source: "ocr",
    ocr_status: test.status,
    record_type: "verification",
    priority: null,
    final_decision: {
      action: ocrAction(test.status),
      label: outcomeOf(`ocr_${test.status}`),
      reason: statusSummary,
      source: "Document verification",
    },
    submitted_media: submittedMedia,
    reference_images: test.reference_images || [],
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function decisionFindings(
  entry: DisplayLogEntry,
  street: NonNullable<LlmDecisionLogEntry["street_imagery"]> | null,
): DetailFinding[] {
  if (entry.source === "ocr" && Array.isArray(entry.output_snapshot.results)) {
    return entry.output_snapshot.results.flatMap((item: unknown) => {
      if (!isPlainObject(item) || typeof item.text !== "string") return []
      const tone = item.tone === "good" || item.tone === "warn" || item.tone === "bad" ? item.tone : "muted"
      const icon = tone === "good" ? CircleCheck : tone === "bad" ? Ban : TriangleAlert
      return [{ icon, tone, text: item.text }]
    })
  }
  const findings: DetailFinding[] = []
  const output = entry.output_snapshot
  const relationship = typeof output.evidence_relationship === "string" ? output.evidence_relationship : ""
  const relationshipFinding: Record<string, DetailFinding> = {
    supports_report: { icon: CircleCheck, tone: "good", text: "The submitted photo supports the report." },
    partially_supports_report: { icon: TriangleAlert, tone: "warn", text: "The submitted photo partly supports the report." },
    contradicts_report: { icon: Ban, tone: "bad", text: "The submitted photo does not match the report." },
    image_unavailable: { icon: ImageOffIcon, tone: "muted", text: "The submitted photo could not be reviewed automatically." },
    image_review_failed: { icon: ImageOffIcon, tone: "muted", text: "The submitted photo could not be reviewed automatically." },
    no_useful_image_evidence: { icon: ImageOffIcon, tone: "muted", text: "The photo does not confirm the report." },
  }
  if (relationship && relationshipFinding[relationship]) findings.push(relationshipFinding[relationship])

  const integrity = integrityVerdictOf(output)
  if (integrity) {
    findings.push({
      icon: Ban,
      tone: "bad",
      text: mediaIntegrityVerdict(integrity).label.replace(/\.$/, ""),
    })
  }

  if (street?.status === "checked") {
    const explanation = street.explanation?.trim()
      .replace(/^Image 1 (shows|depicts)/i, "The evidence shows")
      .replace(/Image 2 (shows|depicts)/gi, "the area near the pin shows")
      .replace(/\.$/, "") || ""
    if (street.verdict === "area_matches") {
      findings.push({
        icon: CircleCheck,
        tone: "good",
        text: explanation
          ? `${explanation}, which supports the pinned location.`
          : "The evidence matches the area near the pin.",
      })
    } else if (street.verdict === "area_mismatch") {
      findings.push({
        icon: Ban,
        tone: "bad",
        text: explanation
          ? `${explanation}, so the surroundings do not match the pinned area.`
          : "The evidence does not match the area near the pin.",
      })
    } else {
      findings.push({ icon: ScanLineIcon, tone: "muted", text: "Area comparison was inconclusive." })
    }
  } else if (street?.status === "no_coverage") {
    findings.push({ icon: ScanLineIcon, tone: "muted", text: "No street imagery covers this pin." })
  }

  return findings
}

function formatPrimitive(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—"
  if (typeof value === "boolean") return value ? "Yes" : "No"
  return String(snapshotValue(value))
}

function ProtectedLogImage({
  src,
  label,
  className,
  unavailableText = "Image unavailable",
  allowRetry = true,
}: {
  src: string
  label: string
  className?: string
  unavailableText?: string
  allowRetry?: boolean
}) {
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

  if (isDataUri) return <img src={src} alt={label} className={cn("mt-2 max-h-52 max-w-full rounded-lg border border-neutral-200 object-contain", className)} />

  if (state.src !== src || state.loading) return <span className="text-neutral-400">Loading image…</span>
  if (state.error || !state.objectUrl) {
    if (!allowRetry) return <span className="text-meta text-neutral-500">{unavailableText}</span>
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
  return <img src={state.objectUrl} alt={label} className={cn("mt-2 max-h-52 max-w-full rounded-lg border border-neutral-200 object-contain", className)} />
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
    const rows = Object.entries(value).filter(([key]) => key !== "source" && key !== "decision_source")
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
  const rows = Object.entries(snapshot ?? {}).filter(([key]) => key !== "source" && key !== "decision_source")
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
}: {
  street: NonNullable<LlmDecisionLogEntry["street_imagery"]> | null
}) {
  const canLoadImage = Boolean(
    street &&
      !street.image &&
      street.status === "checked" &&
      street.latitude != null &&
      street.longitude != null
  )
  const [image, setImage] = useState(street?.image || "")
  const [imageLoading, setImageLoading] = useState(canLoadImage)
  const [imageFailed, setImageFailed] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)

  useEffect(() => {
    const latitude = street?.latitude
    const longitude = street?.longitude
    if (!canLoadImage || latitude == null || longitude == null) return
    const controller = new AbortController()
    void getStreetViewImage({ lat: latitude, lng: longitude }, controller.signal)
      .then((result) => {
        if (result.image) setImage(result.image)
      })
      .catch(() => {
        if (!controller.signal.aborted) setImageFailed(true)
      })
      .finally(() => {
        if (!controller.signal.aborted) setImageLoading(false)
    })
    return () => controller.abort()
  }, [canLoadImage, street?.latitude, street?.longitude])

  if ((!image && !canLoadImage) || imageFailed) return null

  return (
    <div className="min-w-0">
      <p className="mb-2 text-[12px] font-semibold tracking-tight text-neutral-500">Panorama image</p>
      {image && !imageFailed ? (
        <button
          type="button"
          onClick={() => setPreviewOpen(true)}
          aria-label="Preview panorama image"
          className="mt-2 block w-full overflow-hidden rounded-[14px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy focus-visible:ring-offset-2"
        >
          <img
            src={image}
            alt="Panorama near the pin"
            className="block h-auto w-full rounded-[14px] object-cover"
            onError={() => setImageFailed(true)}
          />
        </button>
      ) : imageLoading ? (
        <p className="mt-2 text-meta text-neutral-500">Loading panorama image…</p>
      ) : null}
      {previewOpen && image ? (
        <MediaLightbox
          items={[toMediaPreviewItem(image, "Panorama near the pin", "image/jpeg")]}
          index={0}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}
    </div>
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
  onClose,
  onRevert,
  reverting,
  reverted,
}: {
  entry: DisplayLogEntry | null
  street: NonNullable<LlmDecisionLogEntry["street_imagery"]> | null
  onClose: () => void
  onRevert: () => void
  reverting: boolean
  reverted: boolean
}) {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  if (!entry) return null
  const { decision, decisionLabel, DecisionIcon, decisionTone } = decisionPresentation(entry)
  const priorityLabel = entry.source === "ocr" ? "Not applicable" : entry.priority ? readable(entry.priority) : "Not assessed"
  const PriorityIcon = priorityIconOf(entry.priority)
  const findings = decisionFindings(entry, street)
  const isVerification = entry.source === "ocr"
  const summary = entry.resident_message?.trim() || decision.reason
  const description = descriptionOf(entry)
  const requestedBy = entry.input_snapshot.requested_by
  const reporterName = isVerification && typeof requestedBy === "string"
    ? requestedBy
    : entry.reporter?.name || "Submitter unavailable"
  const reporterInitials = entry.reporter?.initials || reporterName.split(/\s+/).map((part) => part[0] || "").join("").slice(0, 2).toUpperCase()
  const address = entry.address?.trim() || locationOf(entry)
  const trackingId = entry.tracking_id || "Not available"
  const assignedUnit = entry.assigned_unit?.name || entry.assigned_department?.name || "Unassigned"
  const verificationSide = String(entry.input_snapshot.image_side || "single").toLowerCase()
  const verificationReferences = (entry.reference_images || []).filter(
    (sample, index, all) => all.findIndex((item) => item.url === sample.url) === index,
  )
  const verificationReference = verificationReferences.find((sample) => sample.side === verificationSide) || verificationReferences[0]
  const displayedSide = ["front", "back"].includes(verificationSide)
    ? readable(verificationSide)
    : verificationReference && ["front", "back"].includes(verificationReference.side)
      ? readable(verificationReference.side)
      : ""
  const verificationImages = isVerification
    ? [
        ...(entry.submitted_media?.slice(0, 1).map((media) => ({
          src: media.preview_url || media.raw_url,
          label: "Submitted document",
        })) || []),
        ...(verificationReference ? [{ src: verificationReference.url, label: "Reference template" }] : []),
      ]
    : []

  return (
    <SheetDialog
      open
      onClose={onClose}
      title={entry.source === "ocr" ? "Verification result" : "Concern check result"}
      description={entry.source === "ocr" ? "This is a recorded verification result." : "This is a recorded concern check."}
      size="wide"
      className="sm:h-[min(760px,90dvh)] sm:min-h-[480px] sm:min-w-[min(92vw,640px)] sm:max-h-[90dvh] sm:max-w-[min(92vw,1100px)] sm:resize sm:overflow-auto [&::-webkit-resizer]:hidden"
    >
      <div className="space-y-8">
        <section className="border-b border-neutral-200 pb-6">
          <p className="text-[12px] font-medium tracking-wide text-neutral-500">Summary</p>
          <div className="mt-3 flex items-start gap-3">
            <DecisionIcon className={cn("mt-0.5 size-5 shrink-0", decisionTone)} strokeWidth={2} aria-hidden />
            <div className="min-w-0 max-w-[65ch]">
              <h3 className="text-pretty text-[18px] font-semibold leading-snug tracking-[-0.015em] text-neutral-950">{decisionLabel}</h3>
              <p className="mt-1.5 text-pretty text-[14px] leading-6 text-neutral-600">{summary}</p>
            </div>
          </div>
        </section>

        <section className="border-b border-neutral-200 pb-5">
          <h3 className="text-[16px] font-semibold tracking-[-0.01em] text-neutral-950">{isVerification ? "Verification details" : "Breakdown"}</h3>
          {!isVerification ? (
            <div className="mt-4 flex flex-wrap items-center gap-3 border-b border-neutral-200 pb-4">
              <UserAvatar user={{ full_name: reporterName, initials: reporterInitials }} size="md" />
              <div className="min-w-0">
                <p className="text-meta text-neutral-400">Submitted by</p>
                <p className="truncate text-[14px] font-semibold text-neutral-900">{reporterName}</p>
              </div>
              <div className="min-w-0 sm:ml-auto sm:text-right">
                <p className="text-meta text-neutral-400">Tracking ID</p>
                <p className="truncate text-[14px] font-semibold text-neutral-900" title={trackingId}>{trackingId}</p>
              </div>
            </div>
          ) : null}
          {isVerification ? (
            <dl className="mt-4 grid gap-4 sm:grid-cols-3">
              <div><dt className="text-meta text-neutral-400">Document</dt><dd className="mt-1 text-meta font-semibold text-neutral-900">{String(entry.input_snapshot.document_type || "Document")}</dd></div>
              <div><dt className="text-meta text-neutral-400">Outcome</dt><dd className={cn("mt-1 text-meta font-semibold", decisionTone)}>{decisionLabel}</dd></div>
              <div><dt className="text-meta text-neutral-400">Automatically checked</dt><dd className="mt-1 text-meta font-semibold text-neutral-900">{new Date(entry.created_at).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}</dd></div>
            </dl>
          ) : (
            <dl className="grid gap-4 pt-4 sm:grid-cols-2 lg:grid-cols-3">
              <div><dt className="text-meta text-neutral-400">Category</dt><dd className="mt-1 text-meta font-semibold text-neutral-900">{categoryOf(entry)}</dd></div>
              <div>
                <dt className="text-meta text-neutral-400">Priority</dt>
                <dd className={cn("mt-1 inline-flex items-center gap-1.5 text-meta font-semibold", entry.priority ? SEVERITY_TONE[entry.priority] : "text-neutral-700")}>
                  {PriorityIcon ? createElement(PriorityIcon, { className: "size-4", strokeWidth: 2, "aria-hidden": true }) : null}
                  {priorityLabel}
                </dd>
              </div>
              <div><dt className="text-meta text-neutral-400">Pinned address</dt><dd className="mt-1 text-meta font-semibold text-neutral-900" title={address}>{address}</dd></div>
              <div><dt className="text-meta text-neutral-400">Assigned unit</dt><dd className="mt-1 text-meta font-semibold text-neutral-900">{assignedUnit}</dd></div>
              <div><dt className="text-meta text-neutral-400">Checked</dt><dd className="mt-1 text-meta font-semibold text-neutral-900">{new Date(entry.created_at).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}</dd></div>
            </dl>
          )}
          {!isVerification && description ? (
            <div className="mt-5 border-t border-neutral-200 pt-4">
              <p className="text-[12px] font-medium tracking-wide text-neutral-500">Description</p>
              <p className="mt-2 whitespace-pre-wrap text-[14px] leading-relaxed text-neutral-800">{description}</p>
            </div>
          ) : null}
          {findings.length ? (
            <div className="mt-5 border-t border-neutral-200 pt-4">
              <p className="text-[12px] font-medium tracking-wide text-neutral-500">Results</p>
              <ul className="mt-3 space-y-2">
                {findings.map((finding) => (
                  <li key={finding.text} className="flex gap-2 text-[13.5px] leading-relaxed text-neutral-700">
                    {createElement(finding.icon, { className: cn("mt-0.5 size-4 shrink-0", DETAIL_FINDING_TONE[finding.tone]), strokeWidth: 2, "aria-hidden": true })}
                    <span className="min-w-0 break-words">{finding.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        {isVerification && verificationImages.length ? (
          <section>
            <h3 className="text-[16px] font-semibold tracking-[-0.01em] text-neutral-950">Image comparison</h3>
            <div className={cn("mt-3 grid gap-4", verificationImages.length > 1 && "sm:grid-cols-2")}>
              {verificationImages.map((image, index) => (
                <figure key={`${image.label}-${image.src}`} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => setPreviewIndex(index)}
                    aria-label={`Preview ${image.label.toLowerCase()}`}
                    className="group relative block w-full overflow-hidden rounded-[14px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy focus-visible:ring-offset-2"
                  >
                    <ProtectedLogImage
                      src={image.src}
                      label={image.label}
                      unavailableText={`${image.label} is no longer available.`}
                      allowRetry={false}
                      className="block h-auto w-full rounded-[14px] border-0 object-contain"
                    />
                    <span className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-neutral-950/70 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-sm">
                      <Maximize2Icon className="size-3.5" strokeWidth={2} aria-hidden /> Preview
                    </span>
                    {displayedSide ? (
                      <span className="absolute bottom-3 left-3 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-neutral-800 backdrop-blur-sm">
                        {displayedSide}
                      </span>
                    ) : null}
                  </button>
                  <figcaption className="mt-2 text-[12px] font-medium text-neutral-600">{image.label}</figcaption>
                </figure>
              ))}
            </div>
          </section>
        ) : null}

        {!isVerification && entry.submitted_media?.length ? (
          <section>
            <h3 className="text-[16px] font-semibold tracking-[-0.01em] text-neutral-950">{isVerification ? "Submitted document" : "Evidence"}</h3>
            <div className={cn("mt-3 grid gap-5", (entry.submitted_media?.length ?? 0) > 1 && "md:grid-cols-2")}>
              {entry.submitted_media.map((media, index) => {
                const label = isVerification
                  ? "Submitted document"
                  : entry.submitted_media?.length === 1 ? "Submitted evidence" : `Submitted evidence ${index + 1}`
                return (
                  <figure key={media.id} className="min-w-0">
                    <button
                      type="button"
                      onClick={() => setPreviewIndex(index)}
                      aria-label={`Preview ${label.toLowerCase()}`}
                      className="block w-full overflow-hidden rounded-[14px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy focus-visible:ring-offset-2"
                    >
                      <ProtectedLogImage src={media.preview_url || media.raw_url} label={label} className="mt-0 block h-auto w-full max-h-none max-w-none rounded-[14px] border-0 object-contain" />
                    </button>
                    {(entry.submitted_media?.length ?? 0) > 1 ? <figcaption className="mt-2 text-meta text-neutral-500">{label}</figcaption> : null}
                  </figure>
                )
              })}
            </div>
          </section>
        ) : null}

        {!isVerification && street ? (
          <section>
            <StreetViewEvidence
              key={`${street.latitude ?? ""}-${street.longitude ?? ""}-${street.image ?? ""}`}
              street={street}
            />
          </section>
        ) : null}

        {entry.content_flag_id ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-amber-200 bg-amber-50 px-3 py-2.5">
            <p className="text-[12px] leading-relaxed text-amber-900">
              {reverted ? "Reverted. Content is back for staff review." : "This check is linked to an automated community action."}
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
        {previewIndex !== null && (isVerification ? verificationImages.length : entry.submitted_media?.length) ? (
          <MediaLightbox
            items={isVerification
              ? verificationImages.map((image) => toMediaPreviewItem(image.src, image.label, "image"))
              : (entry.submitted_media || []).map((media, index) =>
                  toMediaPreviewItem(media.preview_url || media.raw_url, media.label || `Submitted evidence ${index + 1}`, "image")
                )}
            index={previewIndex}
            onClose={() => setPreviewIndex(null)}
          />
        ) : null}
      </div>
    </SheetDialog>
  )
}

export function DecisionLogTab() {
  const [domain, setDomain] = useState<LlmDecisionLogDomain | "">("concern")
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
        const maxPage = Math.max(1, Math.ceil(nextCount / PAGE_SIZE))
        if (page > maxPage) {
          setPage(maxPage)
          return
        }
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
          placeholder={domain === "verification" ? "Search document checks" : "Search reports, locations, or decisions"}
          label={domain === "verification" ? "Search verification results" : "Search system behavior log"}
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
        <ol>
          {filteredEntries.map((entry) => {
            const { DecisionIcon, decisionTone } = decisionPresentation(entry)
            return (
              <li key={entry.id} className="grid gap-x-8 gap-y-3 border-b border-neutral-200 py-6 last:border-b-0 sm:grid-cols-[150px_minmax(0,1fr)]">
                <div className="text-meta tabular-nums text-neutral-400">
                  <p className="text-neutral-500">{new Date(entry.created_at).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}</p>
                  <p className="mt-0.5">{new Date(entry.created_at).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}</p>
                </div>
                <div className="grid min-w-0 gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-pretty text-[15px] font-semibold leading-snug tracking-[-0.01em] text-brand-navy">{titleOf(entry)}</p>
                        {entry.source !== "ocr" ? <p className="mt-0.5 truncate text-meta text-neutral-500">{locationOf(entry)}</p> : null}
                      </div>
                    </div>
                    <div className="mt-2 flex items-start gap-2">
                      <DecisionIcon className={cn("mt-0.5 size-4 shrink-0", decisionTone)} strokeWidth={2} aria-hidden />
                      <p className="line-clamp-2 min-w-0 text-meta leading-relaxed text-neutral-600">{generatedSummaryOf(entry)}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDetailId(entry.id)}
                    className="inline-flex items-center gap-1 self-center justify-self-start text-meta font-medium text-brand-navy transition-colors hover:text-accent sm:justify-self-end"
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

      {!loading ? <Pager offset={(page - 1) * PAGE_SIZE} total={count} pageSize={PAGE_SIZE} onChange={(nextOffset) => setPage(Math.floor(nextOffset / PAGE_SIZE) + 1)} noun={domain === "concern" ? "concerns" : domain === "verification" ? "verification checks" : "checks"} className="mt-4 border-t-0 pt-0" /> : null}

      <DecisionDetailsDialog
        entry={detailId === null ? null : entries.find((entry) => entry.id === detailId) ?? null}
        street={detailId === null ? null : entries.find((entry) => entry.id === detailId)?.street_imagery ?? null}
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
                          {reverted.has(entry.id) ? "Reverted. Content is back for staff review." : "This decision is linked to an automated community moderation action."}
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
