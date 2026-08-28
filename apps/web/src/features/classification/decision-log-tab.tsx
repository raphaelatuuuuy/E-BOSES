import { Fragment, useEffect, useState } from "react"
import { ChevronDownIcon, LoaderCircleIcon } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@workspace/ui/lib/utils"
import { getLlmDecisionLog, revertAutomatedContentAction, type LlmDecisionLogDomain, type LlmDecisionLogEntry } from "./api"
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
  { value: "", label: "All" },
  { value: "concern", label: "Concerns" },
  { value: "emergency", label: "Emergencies" },
  { value: "verification", label: "Verification" },
]

const DOMAIN_LABEL: Record<LlmDecisionLogDomain, string> = {
  concern: "Concern",
  emergency: "Emergency",
  verification: "Verification",
  community: "Concern · community content",
}

const PAGE_SIZE = 25

type DisplayLogEntry = LlmDecisionLogEntry & {
  source?: "ocr"
  ocr_status?: OcrTestResult["status"]
}

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
  const [state, setState] = useState({ src: "", objectUrl: "", error: false })

  useEffect(() => {
    let cancelled = false
    let objectUrl = ""
    void fetchAuthorizedProof(src)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob)
        if (cancelled) {
          URL.revokeObjectURL(objectUrl)
          return
        }
        setState({ src, objectUrl, error: false })
      })
      .catch(() => {
        if (!cancelled) setState({ src, objectUrl: "", error: true })
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [src])

  if (state.src !== src) return <span className="text-neutral-400">Loading image…</span>
  if (state.error || !state.objectUrl) return <span className="text-neutral-400">Image unavailable</span>
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

export function DecisionLogTab() {
  const [domain, setDomain] = useState<LlmDecisionLogDomain | "">("")
  const [entries, setEntries] = useState<DisplayLogEntry[]>([])
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
    const load = async () => {
      const response = await getLlmDecisionLog({ domain: domain || undefined, run_kind: "production", page: 1, page_size: PAGE_SIZE })
      let nextEntries: DisplayLogEntry[] = response.results
      let nextCount = response.count
      if (domain === "verification") {
        const ocrTests = await listOcrTests()
        nextEntries = [...nextEntries, ...ocrTests.map(ocrLogEntry)].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )
        nextCount += ocrTests.length
      }
      if (!cancelled) {
        setEntries(nextEntries)
        setCount(nextCount)
        setPage(1)
        setExpanded(new Set())
      }
    }
    void load()
      .catch((error) => toast.error(describeApiError(error, "Could not load the system checks.")))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [domain])

  async function loadMore() {
    if (domain === "verification") return
    const nextPage = page + 1
    try {
      const response = await getLlmDecisionLog({ domain: domain || undefined, run_kind: "production", page: nextPage, page_size: PAGE_SIZE })
      setEntries((prev) => [...prev, ...response.results])
      setPage(nextPage)
    } catch (error) {
      toast.error(describeApiError(error, "Could not load more system checks."))
    }
  }

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
        <p className="rounded-xl border border-neutral-200 px-6 py-10 text-center text-[14px] font-medium text-neutral-500">
          No system checks in this section yet.
        </p>
      ) : (
        <div className="w-full overflow-hidden rounded-xl border border-neutral-200 bg-white">
          <table className="w-full table-fixed border-collapse text-left">
            <colgroup>
              <col className="w-[15%]" />
              <col className="w-[31%]" />
              <col className="w-[14%]" />
              <col className="w-[17%]" />
              <col className="w-[15%]" />
              <col className="w-[8%]" />
            </colgroup>
            <thead className="hidden bg-neutral-50/80 md:table-header-group">
              <tr className="border-b border-neutral-100">
                <th className="w-[16%] px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Submitted</th>
                <th className="w-[28%] px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Report</th>
                <th className="w-[13%] px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Category</th>
                <th className="w-[17%] px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Location</th>
                <th className="w-[16%] px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Outcome</th>
                <th className="w-[8%] px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Options</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {entries.map((entry) => {
                const isOpen = expanded.has(entry.id)
                const verdict = verdictMeta(entry.source === "ocr" ? ocrAction(entry.ocr_status) : entry.recommended_action)
                const photoVerdict = integrityVerdictOf(entry.output_snapshot)
                return (
                  <Fragment key={entry.id}>
                    <tr className="block p-4 transition-colors hover:bg-neutral-50/70 md:table-row md:p-0 md:align-middle">
                      <td className="block px-0 py-1 text-[12px] text-neutral-500 md:table-cell md:px-4 md:py-4">
                        <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-neutral-400 md:hidden">Submitted</span>
                        {new Date(entry.created_at).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}
                        <span className="ml-1 text-[11px] text-neutral-400 md:ml-0 md:block">
                          {new Date(entry.created_at).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}
                        </span>
                      </td>
                      <td className="block px-0 py-1 md:table-cell md:px-4 md:py-4">
                        <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-neutral-400 md:hidden">Report</span>
                        <p className="line-clamp-2 break-words text-[13px] font-semibold leading-relaxed text-neutral-900">
                          {reportTextOf(entry)}
                        </p>
                         <p className="mt-1 text-[11px] text-neutral-500">
                           {entry.source === "ocr" ? "Automated document check" : "Automated review"}
                         </p>
                      </td>
                      <td className="block px-0 py-1 md:table-cell md:px-4 md:py-4">
                        <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-neutral-400 md:hidden">Category</span>
                        <p className="break-words text-[12px] font-medium text-neutral-700">{categoryOf(entry)}</p>
                      </td>
                      <td className="block px-0 py-1 md:table-cell md:px-4 md:py-4">
                        <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-neutral-400 md:hidden">Location</span>
                        <p className="break-words text-[12px] font-medium text-neutral-700">{locationOf(entry)}</p>
                      </td>
                      <td className="block px-0 py-1 md:table-cell md:px-4 md:py-4">
                        <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-neutral-400 md:hidden">Outcome</span>
                        <div className="flex items-center gap-2">
                          <verdict.icon className={cn("size-4 shrink-0", verdict.tone)} strokeWidth={2} aria-hidden />
                          <div className="min-w-0">
                            <p className="break-words text-[12px] font-semibold text-neutral-800">
                              {outcomeOf(entry.recommended_action)}
                            </p>
                             <p className="mt-0.5 break-words text-[11px] text-neutral-500">
                               {outcomeUnit(entry)}
                            </p>
                            {photoVerdict ? (
                              <p className="break-words text-[11px] text-destructive">Photo: {mediaIntegrityVerdict(photoVerdict).label}</p>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td className="block px-0 py-2 text-left md:table-cell md:px-3 md:py-4 md:text-right">
                        <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-neutral-400 md:hidden">Options</span>
                        <button
                          type="button"
                          onClick={() => toggleExpanded(entry.id)}
                          className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand-navy transition-colors hover:text-accent"
                        >
                          Details
                          <ChevronDownIcon className={cn("size-3.5 transition-transform", isOpen && "rotate-180")} aria-hidden />
                        </button>
                      </td>
                    </tr>
                    {isOpen ? (
                      <tr>
                        <td colSpan={6} className="border-t border-neutral-100 bg-neutral-50 p-4">
                          <div className="space-y-3">
                            {entry.duration_ms != null ? (
                              <p className="text-[12px] font-medium text-neutral-500">Took {entry.duration_ms} ms</p>
                            ) : null}
                            {entry.content_flag_id ? (
                              <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-amber-200 bg-amber-50 px-3 py-2.5">
                                <p className="text-[12px] leading-relaxed text-amber-900">
                                  {reverted.has(entry.id) ? "Reverted — content is back for staff review." : "This check is linked to an automated community action."}
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
                            <div className="grid gap-3 lg:grid-cols-2">
                              <SnapshotTable label="Information received" snapshot={entry.input_snapshot} />
                              <SnapshotTable label="System result" snapshot={entry.output_snapshot} />
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
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
