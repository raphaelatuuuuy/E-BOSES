import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"
import {
  ArrowUpIcon,
  CalendarIcon,
  CameraIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  CopyIcon,
  DownloadIcon,
  LeafIcon,
  MegaphoneIcon,
  RefreshCwIcon,
  SearchIcon,
  Share2Icon,
  ShieldCheckIcon,
  TrafficConeIcon,
  XIcon,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"

import {
  assignConcern,
  createConcernAppeal,
  createConcernRemark,
  listConcernAppeals,
  listManagedConcerns,
  listMyConcerns,
  listActiveResponders,
  replyConcernClarification,
  requestConcernClarification,
  reviewConcernAi,
  reviewConcernAppeal,
  updateConcernStatus,
  type Concern,
  type ConcernAppeal,
  type ConcernCategory,
  type ConcernMedia,
  type ConcernStatus,
  type ConcernValidationStatus,
  type ActiveResponder,
} from "@/features/dashboard/api"
import { concernBodyText } from "@/features/dashboard/components/feed-post-card"
import { ReportChatPanel } from "@/features/dashboard/components/report-chat-panel"
import { ConcernConversation } from "@/features/dashboard/components/concern-conversation"
import {
  AuthenticatedMediaImage,
  openAuthenticatedMedia,
} from "@/features/dashboard/components/authenticated-media"
import {
  ReportLocationAddress,
  ReportLocationMap,
} from "@/features/dashboard/components/report-location-map"
import { ReportStatusDialog, statusModeFromReport, type StatusDialogMode } from "@/features/dashboard/components/report-status-dialog"
import { useAuthSession } from "@/features/auth/auth-session"
import { usePageTitle } from "@/hooks/use-page-title"

const filters = ["All", "Active", "Resolved", "Rejected", "Appealed"] as const
const residentReportsPageSize = 5

const activeStatuses: ConcernStatus[] = ["submitted", "under_review", "assigned", "in_progress"]

/** Minimal monochrome status chips — no rainbow “AI slop” badges */
const statusColors: Record<string, string> = {
  Active: "border-neutral-200 bg-neutral-100 text-neutral-700",
  Resolved: "border-neutral-200 bg-neutral-50 text-neutral-600",
  Rejected: "border-neutral-200 bg-neutral-50 text-neutral-600",
  Appealed: "border-neutral-200 bg-neutral-50 text-neutral-600",
}

const validationLabels: Record<ConcernValidationStatus, string> = {
  pending: "Pending validation",
  accepted: "Validated",
  rejected: "Rejected",
}

const validationColors: Record<ConcernValidationStatus, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-700",
  accepted: "border-blue-200 bg-blue-50 text-blue-700",
  rejected: "border-red-200 bg-red-50 text-red-700",
}

const categoryLabels: Record<ConcernCategory, string> = {
  infrastructure: "Infrastructure",
  environment: "Environment",
  public_safety: "Public Safety",
  others: "Others",
}

const categoryStyles: Record<ConcernCategory, { icon: typeof TrafficConeIcon; bg: string; text: string; sub: string }> = {
  infrastructure: { icon: TrafficConeIcon, bg: "bg-[#eef3ff]", text: "text-[#2447b3]", sub: "Roads & utilities" },
  environment: { icon: LeafIcon, bg: "bg-[#eef3ff]", text: "text-[#2447b3]", sub: "Garbage Collection" },
  public_safety: { icon: ShieldCheckIcon, bg: "bg-[#fff1ea]", text: "text-[#ff5003]", sub: "Safety & response" },
  others: { icon: SearchIcon, bg: "bg-[#eef3ff]", text: "text-[#2447b3]", sub: "General concern" },
}

function statusLabel(status: ConcernStatus) {
  if (status === "under_review") return "Official review"
  if (status === "assigned") return "Responder routed"
  if (status === "in_progress") return "Action in progress"
  return status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
}

function statusGroup(status: ConcernStatus): (typeof filters)[number] {
  if (activeStatuses.includes(status)) return "Active"
  if (status === "resolved") return "Resolved"
  if (status === "rejected") return "Rejected"
  if (status === "appealed") return "Appealed"
  // Fallback for any unexpected status → treat as active pipeline
  return "Active"
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value))
}

function formatEventTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

function daysAgo(value: string) {
  const diffMs = Date.now() - new Date(value).getTime()
  return Math.max(0, Math.floor(diffMs / 86400000))
}

/** Brief list preview — hard ellipsis so rows stay short. */
function truncateDescription(text: string, max = 72): string {
  const cleaned = (text || "").replace(/\s+/g, " ").trim()
  if (!cleaned) return "No description"
  if (cleaned.length <= max) return cleaned
  const slice = cleaned.slice(0, max)
  const atWord = slice.replace(/\s+\S*$/, "").trim()
  const base = atWord.length >= 28 ? atWord : slice.trim()
  return `${base}...`
}

function filterReports(reports: Concern[], filter: string) {
  if (filter === "All") return reports
  if (filter === "Active") {
    return reports.filter((report) => activeStatuses.includes(report.status))
  }
  if (filter === "Resolved") {
    return reports.filter((report) => report.status === "resolved")
  }
  if (filter === "Rejected") {
    return reports.filter((report) => report.status === "rejected")
  }
  if (filter === "Appealed") {
    return reports.filter(
      (report) =>
        report.status === "appealed" ||
        (report.appeals?.some((appeal) => appeal.status === "submitted") ?? false),
    )
  }
  return reports
}

async function openReportMedia(report: Concern) {
  if (report.media.length === 0) {
    toast.info("No evidence files uploaded.")
    return
  }
  try {
    for (const media of report.media) {
      await openAuthenticatedMedia(media.raw_url, media.original_filename)
    }
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Could not open report evidence.")
  }
}

function ReportIcon({ report, size = "md", forceIcon = false }: { report: Concern; size?: "sm" | "md"; forceIcon?: boolean }) {
  const firstImage = !forceIcon ? report.media?.find((m) => m.mime_type?.startsWith("image/")) : undefined
  if (firstImage) {
    return (
      <span
        className={cn(
          "flex shrink-0 items-center justify-center overflow-hidden rounded-md",
          size === "sm" ? "size-11" : "size-12",
        )}
      >
        <img src={firstImage.preview_url} alt="" className="size-full object-cover" />
      </span>
    )
  }
  const style = categoryStyles[report.category]
  const Icon = style.icon
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-600",
        size === "sm" ? "size-9" : "size-10",
      )}
    >
      <Icon className={size === "sm" ? "size-4" : "size-5"} strokeWidth={2} />
    </span>
  )
}

const officialStatuses: ConcernStatus[] = ["under_review", "in_progress", "resolved", "rejected", "appealed"]

function OfficialStatusPanel({ report, onUpdated }: { report: Concern; onUpdated: (report: Concern) => void }) {
  const [status, setStatus] = useState<ConcernStatus>(report.status === "submitted" ? "under_review" : report.status)
  const [note, setNote] = useState(report.update_text || "")
  const [resolutionFiles, setResolutionFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setStatus(report.status === "submitted" ? "under_review" : report.status)
    setNote(report.update_text || "")
    setResolutionFiles([])
  }, [report.id, report.status, report.update_text])

  async function submit() {
    setBusy(true)
    try {
      const next = await updateConcernStatus(report.id, {
        status,
        note,
        status_version: report.status_version,
        resolution_evidence: status === "resolved" ? resolutionFiles : undefined,
      })
      onUpdated(next)
      toast.success("Report status updated")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update report.")
    } finally {
      setBusy(false)
    }
  }

  function chooseResolutionFiles(files: FileList | null) {
    if (!files) return
    const selected = Array.from(files).slice(0, 5)
    const invalid = selected.find(
      (file) => !["image/jpeg", "image/png"].includes(file.type) || file.size > 2 * 1024 * 1024,
    )
    if (invalid) {
      toast.error(`${invalid.name}: use JPG or PNG up to 2 MB.`)
      return
    }
    setResolutionFiles(selected)
  }

  const needsResolutionEvidence =
    status === "resolved" && !(report.resolution_evidence?.length || resolutionFiles.length)
  const needsFinalReason = ["resolved", "rejected"].includes(status) && note.trim().length < 10

  return (
    <div className="rounded-xl border border-[#dfe7f5] bg-[#f8fafc] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-extrabold text-[#07145f]">Official action</p>
          <p className="mt-1 text-xs font-semibold text-[#68739c]">Validate, route, reject, or resolve this resident report. Add a reason so the resident can follow the decision.</p>
        </div>
        <span className={cn("rounded-full border px-3 py-1 text-xs font-bold", validationColors[report.validation_status])}>
          {validationLabels[report.validation_status]}
        </span>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-[180px_1fr_auto]">
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value as ConcernStatus)}
          className="h-10 rounded-lg border border-[#cbd8ee] bg-white px-3 text-xs font-extrabold text-[#07145f] outline-none focus:border-[#ff6a1a]"
        >
          {officialStatuses.map((option) => (
            <option key={option} value={option}>{statusLabel(option)}</option>
          ))}
        </select>
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Update note shown to resident"
          className="h-10 rounded-lg border border-[#cbd8ee] bg-white px-3 text-xs font-semibold text-[#07145f] outline-none placeholder:text-[#68739c] focus:border-[#ff6a1a]"
        />
        <Button type="button" disabled={busy || !note.trim() || needsResolutionEvidence || needsFinalReason} onClick={submit} className="bg-[#ff6a1a] text-white hover:bg-[#e85f17]">
          {busy ? "Updating" : "Update"}
        </Button>
      </div>
      {status === "resolved" ? (
        <div className="mt-3 rounded-xl border border-[#cbd8ee] bg-white p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-extrabold text-[#07145f]">Resolution photos</p>
              <p className="mt-1 text-[11px] font-semibold text-[#68739c]">
                Add up to 5 JPG/PNG photos showing the completed work. These remain private to the resident and authorized officials.
              </p>
            </div>
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-[#cbd8ee] px-3 text-xs font-bold text-[#07145f] hover:bg-[#f8fafc]">
              <CameraIcon className="size-4" />
              Choose photos
              <input
                type="file"
                accept="image/jpeg,image/png"
                multiple
                className="hidden"
                onChange={(event) => chooseResolutionFiles(event.target.files)}
              />
            </label>
          </div>
          {resolutionFiles.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {resolutionFiles.map((file) => (
                <span key={`${file.name}-${file.lastModified}`} className="rounded-md bg-[#edf2fb] px-2.5 py-1.5 text-[11px] font-bold text-[#43507f]">
                  {file.name}
                </span>
              ))}
              <button type="button" onClick={() => setResolutionFiles([])} className="text-[11px] font-bold text-red-600 underline">
                Clear
              </button>
            </div>
          ) : report.resolution_evidence?.length ? (
            <p className="mt-3 text-[11px] font-bold text-emerald-700">
              {report.resolution_evidence.length} resolution photo{report.resolution_evidence.length === 1 ? "" : "s"} already stored.
            </p>
          ) : (
            <p className="mt-3 text-[11px] font-bold text-red-600">At least one resolution photo is required.</p>
          )}
        </div>
      ) : null}
      {needsFinalReason ? (
        <p className="mt-2 text-[11px] font-bold text-red-600">Explain a resolved or rejected decision in at least 10 characters.</p>
      ) : null}
    </div>
  )
}

function OfficialWorkflowPanel({ report, onRefresh }: { report: Concern; onRefresh: () => Promise<void> }) {
  const activeAssignment = report.assignments?.find((assignment) => assignment.status === "active")
  const [office, setOffice] = useState(activeAssignment?.office || "")
  const [assigneeId, setAssigneeId] = useState(activeAssignment?.assignee?.id ? String(activeAssignment.assignee.id) : "")
  const [responders, setResponders] = useState<ActiveResponder[]>([])
  const [assignmentNote, setAssignmentNote] = useState("")
  const [clarificationText, setClarificationText] = useState("")
  const [remark, setRemark] = useState("")
  const [visibleToResident, setVisibleToResident] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    const current = report.assignments?.find((assignment) => assignment.status === "active")
    setOffice(current?.office || "")
    setAssigneeId(current?.assignee?.id ? String(current.assignee.id) : "")
    setAssignmentNote(current?.note || "")
  }, [report.id, report.assignments])

  useEffect(() => {
    let cancelled = false
    void listActiveResponders()
      .then((items) => {
        if (!cancelled) setResponders(items)
      })
      .catch(() => {
        if (!cancelled) setResponders([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const responderOptions = [...responders]
  if (activeAssignment?.assignee && !responderOptions.some((item) => item.id === activeAssignment.assignee?.id)) {
    responderOptions.unshift(activeAssignment.assignee as ActiveResponder)
  }

  async function run(action: string, fn: () => Promise<unknown>) {
    setBusy(action)
    try {
      await fn()
      await onRefresh()
      toast.success("Action saved")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save action.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="rounded-xl border border-[#dfe7f5] bg-white p-4">
      <h3 className="text-sm font-black text-[#07145f]">Report workflow</h3>
      <div className="mt-4 grid gap-3">
        <div className="grid gap-2">
          <select
            value={assigneeId}
            onChange={(event) => setAssigneeId(event.target.value)}
            className="h-10 rounded-lg border border-[#cbd8ee] bg-white px-3 text-xs font-semibold text-[#07145f] outline-none focus:border-[#ff6a1a]"
          >
            <option value="">Assign to office/team only</option>
            {responderOptions.map((responder) => (
              <option key={responder.id} value={responder.id}>
                {responder.full_name} · {responder.responder_unit || "responder"}{responder.is_on_duty ? " · on duty" : ""}
              </option>
            ))}
          </select>
          <input value={office} onChange={(event) => setOffice(event.target.value)} placeholder="Office or response team (optional when responder selected)" className="h-10 rounded-lg border border-[#cbd8ee] px-3 text-xs font-semibold text-[#07145f] outline-none focus:border-[#ff6a1a]" />
          <input value={assignmentNote} onChange={(event) => setAssignmentNote(event.target.value)} placeholder="Assignment note" className="h-10 rounded-lg border border-[#cbd8ee] px-3 text-xs font-semibold text-[#07145f] outline-none focus:border-[#ff6a1a]" />
          <Button
            type="button"
            disabled={busy === "assign" || (!office.trim() && !assigneeId)}
            onClick={() => run("assign", () => assignConcern(report.id, {
              assignee_id: assigneeId ? Number(assigneeId) : null,
              office: office.trim(),
              note: assignmentNote.trim(),
            }))}
            className="bg-[#ff6a1a] text-white hover:bg-[#e85f17]"
          >
            {busy === "assign" ? "Saving assignment" : activeAssignment ? "Reassign report" : "Assign report"}
          </Button>
        </div>
        <div className="grid gap-2 border-t border-[#dfe7f5] pt-3">
          <textarea value={clarificationText} onChange={(event) => setClarificationText(event.target.value)} placeholder="Ask resident for clarification" className="min-h-20 rounded-lg border border-[#cbd8ee] px-3 py-2 text-xs font-semibold text-[#07145f] outline-none focus:border-[#ff6a1a]" />
          <Button type="button" variant="outline" disabled={busy === "clarification" || !clarificationText.trim()} onClick={() => run("clarification", () => requestConcernClarification(report.id, clarificationText.trim()))}>
            {busy === "clarification" ? "Sending" : "Request clarification"}
          </Button>
        </div>
        <div className="grid gap-2 border-t border-[#dfe7f5] pt-3">
          <textarea value={remark} onChange={(event) => setRemark(event.target.value)} placeholder="Official remark" className="min-h-20 rounded-lg border border-[#cbd8ee] px-3 py-2 text-xs font-semibold text-[#07145f] outline-none focus:border-[#ff6a1a]" />
          <label className="flex items-center gap-2 text-xs font-bold text-[#43507f]">
            <input type="checkbox" checked={visibleToResident} onChange={(event) => setVisibleToResident(event.target.checked)} />
            Visible to resident
          </label>
          <Button type="button" variant="outline" disabled={busy === "remark" || !remark.trim()} onClick={() => run("remark", () => createConcernRemark(report.id, { body: remark.trim(), visible_to_resident: visibleToResident }))}>
            {busy === "remark" ? "Saving" : "Add remark"}
          </Button>
        </div>
      </div>
    </div>
  )
}

function ResidentFollowUpPanel({ report, onRefresh }: { report: Concern; onRefresh: () => Promise<void> }) {
  const openClarifications = report.clarifications?.filter((item) => item.status === "open") ?? []
  const appealHistory = report.appeals ?? []
  const pendingAppeal = report.appeals?.find((item) => item.status === "submitted")
  const canAppeal = ["rejected", "resolved"].includes(report.status) && !pendingAppeal
  const [responses, setResponses] = useState<Record<number, string>>({})
  const [appealReason, setAppealReason] = useState("")
  const [busy, setBusy] = useState<string | null>(null)

  if (openClarifications.length === 0 && !canAppeal && appealHistory.length === 0 && !(report.official_remarks?.length)) return null

  async function submitReply(clarificationId: number) {
    const response = responses[clarificationId]?.trim()
    if (!response) return
    setBusy(`clarification-${clarificationId}`)
    try {
      await replyConcernClarification(report.id, clarificationId, response)
      await onRefresh()
      toast.success("Clarification sent")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send clarification.")
    } finally {
      setBusy(null)
    }
  }

  async function submitAppeal() {
    if (!appealReason.trim()) return
    setBusy("appeal")
    try {
      await createConcernAppeal(report.id, appealReason.trim())
      await onRefresh()
      toast.success("Appeal submitted")
      setAppealReason("")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not submit appeal.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="space-y-3">
      <h3 className="text-[13px] font-semibold tracking-wide text-neutral-500 uppercase">Follow-up</h3>
      <div className="rounded-xl border border-neutral-200 bg-white px-4 py-5">
        {report.official_remarks?.length ? (
          <div className="space-y-3">
            {report.official_remarks.map((remark) => (
              <p key={remark.id} className="rounded-lg bg-neutral-50 px-4 py-3 text-[14px] leading-6 text-neutral-700">
                {remark.body}
              </p>
            ))}
          </div>
        ) : null}
        {openClarifications.map((clarification) => (
          <div key={clarification.id} className="mt-4 grid gap-3 border-t border-neutral-100 pt-4 first:mt-0 first:border-t-0 first:pt-0">
            <p className="text-[14px] font-medium text-neutral-900">{clarification.request_text}</p>
            <textarea
              value={responses[clarification.id] ?? ""}
              onChange={(event) => setResponses((current) => ({ ...current, [clarification.id]: event.target.value }))}
              placeholder="Type your response"
              className="min-h-24 rounded-xl border border-neutral-200 px-3.5 py-3 text-[14px] text-neutral-900 outline-none focus:border-neutral-400"
            />
            <Button
              type="button"
              disabled={busy === `clarification-${clarification.id}`}
              onClick={() => void submitReply(clarification.id)}
              className="h-11 bg-[#ff6a1a] text-white hover:bg-[#e85f17]"
            >
              {busy === `clarification-${clarification.id}` ? "Sending" : "Send clarification"}
            </Button>
          </div>
        ))}
        {appealHistory.length ? (
          <div className="mt-4 space-y-3 border-t border-neutral-100 pt-4">
            <p className="text-[12px] font-semibold tracking-wide text-neutral-500 uppercase">Appeal history</p>
            {appealHistory.map((appeal) => (
              <div
                key={appeal.id}
                className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-[14px] leading-6 text-neutral-700"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-neutral-900">Appeal {appeal.status.replace("_", " ")}</span>
                  <span className="text-[13px] text-neutral-500">{formatEventTime(appeal.decided_at || appeal.created_at)}</span>
                </div>
                <p className="mt-2">{appeal.reason}</p>
                {appeal.decision_note ? <p className="mt-2 font-medium">Decision: {appeal.decision_note}</p> : null}
                {appeal.reviewed_by ? <p className="mt-1 text-[13px] text-neutral-500">Reviewed by {appeal.reviewed_by.full_name}</p> : null}
              </div>
            ))}
          </div>
        ) : null}
        {canAppeal ? (
          <div className="mt-4 grid gap-3 border-t border-neutral-100 pt-4">
            <textarea
              value={appealReason}
              onChange={(event) => setAppealReason(event.target.value)}
              placeholder="Explain why this report should be reviewed again"
              className="min-h-24 rounded-xl border border-neutral-200 px-3.5 py-3 text-[14px] text-neutral-900 outline-none focus:border-neutral-400"
            />
            <Button
              type="button"
              disabled={busy === "appeal" || !appealReason.trim()}
              onClick={() => void submitAppeal()}
              className="h-11 bg-[#ff6a1a] text-white hover:bg-[#e85f17]"
            >
              {busy === "appeal" ? "Submitting" : "Submit appeal"}
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  )
}

function DetailSection({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-3", className)}>
      <h3 className="text-[13px] font-semibold tracking-wide text-neutral-500 uppercase">{title}</h3>
      {children}
    </section>
  )
}

function EvidenceLightbox({
  images,
  currentIndex,
  onClose,
  onNavigate,
}: {
  images: ConcernMedia[]
  currentIndex: number
  onClose: () => void
  onNavigate: (index: number) => void
}) {
  const image = images[currentIndex]

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
      if (e.key === "ArrowLeft" && currentIndex > 0) onNavigate(currentIndex - 1)
      if (e.key === "ArrowRight" && currentIndex < images.length - 1) onNavigate(currentIndex + 1)
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [currentIndex, images.length, onClose, onNavigate])

  useEffect(() => {
    document.body.style.overflow = "hidden"
    return () => { document.body.style.overflow = "" }
  }, [])

  if (!image) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Evidence preview"
    >
      <div className="relative flex max-h-[90vh] max-w-[90vw] items-center" onClick={(e) => e.stopPropagation()}>
        {/* Previous */}
        {currentIndex > 0 && (
          <button
            type="button"
            onClick={() => onNavigate(currentIndex - 1)}
            className="absolute left-2 z-10 flex size-10 items-center justify-center rounded-full bg-black/40 text-white transition-colors hover:bg-black/60 md:-left-12"
            aria-label="Previous image"
          >
            <ChevronLeftIcon className="size-6" />
          </button>
        )}

        <div className="flex flex-col items-center gap-4">
          <img
            src={image.preview_url}
            alt={image.original_filename}
            className="max-h-[80vh] max-w-[85vw] rounded-lg object-contain"
          />

          {/* Controls */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void openAuthenticatedMedia(image.raw_url, image.original_filename)}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white/10 px-4 text-sm font-medium text-white backdrop-blur transition-colors hover:bg-white/20"
            >
              <DownloadIcon className="size-4" />
              Download
            </button>
            <span className="text-sm text-white/60">
              {currentIndex + 1} / {images.length}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white/10 px-4 text-sm font-medium text-white backdrop-blur transition-colors hover:bg-white/20"
            >
              <XIcon className="size-4" />
              Close
            </button>
          </div>
        </div>

        {/* Next */}
        {currentIndex < images.length - 1 && (
          <button
            type="button"
            onClick={() => onNavigate(currentIndex + 1)}
            className="absolute right-2 z-10 flex size-10 items-center justify-center rounded-full bg-black/40 text-white transition-colors hover:bg-black/60 md:-right-12"
            aria-label="Next image"
          >
            <ChevronRightIcon className="size-6" />
          </button>
        )}
      </div>
    </div>
  )
}

function ReportDetailsSidebar({
  report,
  onClose,
  onCopyTrackingId,
  onStatusClick,
  onRefresh,
  onUpdated,
  isOfficial,
}: {
  report: Concern
  onClose: () => void
  onCopyTrackingId: () => void
  onStatusClick: (mode: StatusDialogMode) => void
  onRefresh: () => Promise<void>
  onUpdated: (report: Concern) => void
  isOfficial: boolean
}) {
  const evidenceImages = report.media.filter((media) => media.mime_type?.startsWith("image/"))
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const group = statusGroup(report.status)

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener("keydown", onKey)
    }
  }, [onClose])

  // Fixed right sidebar + solid dark dim (no blur)
  return (
    <div className="fixed inset-0 z-[200] flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-black/45"
        aria-label="Close report details"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Report details"
        className={cn(
          "relative flex h-full w-full max-w-[min(100%,28rem)] flex-col bg-white",
          "border-l border-neutral-200 shadow-[-12px_0_32px_rgba(15,23,42,0.14)]",
          "sm:max-w-[30rem] md:max-w-[32rem] lg:max-w-[34rem]",
        )}
      >
        <header className="shrink-0 border-b border-neutral-200 px-5 py-4 sm:px-6 sm:py-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[12px] font-medium tracking-wide text-neutral-500 uppercase">
              Report details
            </p>
            <button
              type="button"
              onClick={onClose}
              className="flex size-10 shrink-0 items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-100"
              aria-label="Close"
            >
              <XIcon className="size-5" />
            </button>
          </div>
          {/* Tracking ID + status on one aligned row */}
          <div className="mt-2 flex min-h-9 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate font-mono text-[15px] font-semibold tracking-wide text-neutral-900 sm:text-[16px]">
                {report.tracking_id}
              </span>
              <button
                type="button"
                onClick={onCopyTrackingId}
                className="flex size-8 shrink-0 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                aria-label="Copy tracking ID"
              >
                <CopyIcon className="size-3.5" />
              </button>
            </div>
            <span
              className={cn(
                "shrink-0 rounded-md border px-2.5 py-1 text-[12px] font-medium",
                statusColors[group],
              )}
            >
              {group}
            </span>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6 sm:px-6 sm:py-7">
          <div className="space-y-8 pb-[max(2rem,env(safe-area-inset-bottom))]">
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-neutral-500">
              <span className="inline-flex items-center gap-1.5">
                <CalendarIcon className="size-4 text-neutral-400" />
                Submitted {formatDate(report.created_at)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <ClockIcon className="size-4 text-neutral-400" />
                {daysAgo(report.created_at)} days ago
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Share2Icon className="size-4 text-neutral-400" />
                {report.visibility === "community" ? "Public" : "Private"}
              </span>
              {report.visibility === "community" ? (
                <span className="inline-flex items-center gap-1.5">
                  <ArrowUpIcon className="size-4 text-neutral-400" />
                  {report.vote_count} upvotes
                </span>
              ) : null}
            </div>

            {isOfficial ? (
              <DetailSection title="Official actions">
                <OfficialStatusPanel report={report} onUpdated={onUpdated} />
              </DetailSection>
            ) : null}

            <DetailSection title="Description">
              <p className="text-[15px] leading-7 text-neutral-700 whitespace-pre-wrap">
                {concernBodyText(report) || "No description provided."}
              </p>
            </DetailSection>

            <DetailSection title="Category">
              <div className="flex items-center gap-4 rounded-xl border border-neutral-200 px-4 py-4">
                <ReportIcon report={report} size="md" forceIcon />
                <div>
                  <p className="text-[15px] font-medium text-neutral-900">{categoryLabels[report.category]}</p>
                  <p className="mt-0.5 text-[13px] text-neutral-500">{categoryStyles[report.category].sub}</p>
                </div>
              </div>
            </DetailSection>

            <DetailSection title="Location">
              <div className="space-y-3">
                <ReportLocationAddress
                  address={report.address}
                  barangay={report.barangay}
                  latitude={report.latitude}
                  longitude={report.longitude}
                />
                <ReportLocationMap
                  latitude={report.latitude}
                  longitude={report.longitude}
                  heightClassName="h-56 sm:h-64"
                />
              </div>
            </DetailSection>

            <DetailSection title="Evidence">
              <p className="text-[14px] text-neutral-500">
                {report.media.length} file{report.media.length === 1 ? "" : "s"}
              </p>
              <div className="mt-3 space-y-2">
                {report.media.map((media) => {
                  const validation = media.validation_status
                  const label = validation === "accepted" ? "Authenticity check passed" : validation === "rejected" ? "Authenticity check needs review" : "Authenticity check pending"
                  return (
                    <div key={`validation-${media.id}`} className="flex items-start justify-between gap-3 rounded-xl border border-neutral-200 bg-[#fafbfc] px-3 py-2.5 text-[12px]">
                      <div className="min-w-0">
                        <p className="truncate font-bold text-neutral-800">{media.original_filename}</p>
                        <p className="mt-0.5 text-neutral-500">{isOfficial && media.validation_detail ? media.validation_detail : label}</p>
                      </div>
                      <span className={cn("shrink-0 rounded-full px-2 py-1 font-bold", validation === "accepted" ? "bg-emerald-50 text-emerald-700" : validation === "rejected" ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-700")}>
                        {validation === "accepted" ? "Checked" : validation === "rejected" ? "Review" : "Pending"}
                      </span>
                    </div>
                  )
                })}
              </div>
              {evidenceImages.length > 0 ? (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  {evidenceImages.slice(0, 4).map((media, i) => (
                    <button
                      key={media.id}
                      type="button"
                      onClick={() => setLightboxIndex(i)}
                      className="block w-full text-left"
                    >
                      <AuthenticatedMediaImage
                        src={media.preview_url}
                        alt={media.original_filename}
                        className="h-36 w-full rounded-xl object-cover sm:h-40"
                      />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="mt-3 flex h-32 items-center justify-center rounded-xl border border-dashed border-neutral-200 text-[14px] text-neutral-500">
                  No evidence uploaded
                </div>
              )}
              {evidenceImages.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setLightboxIndex(0)}
                  className="mt-4 h-11 w-full rounded-xl border border-neutral-200 text-[14px] font-semibold text-neutral-800 transition-colors hover:bg-neutral-50"
                >
                  View all evidence
                </button>
              ) : null}
            </DetailSection>

            {report.resolution_evidence?.length ? (
              <DetailSection title="Resolution evidence">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                  <p className="text-[13px] font-semibold leading-5 text-emerald-900">
                    These photos were uploaded by the barangay as evidence of the completed resolution. They are visible only to you and authorized officials.
                  </p>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {report.resolution_evidence.map((evidence) => (
                    <button
                      key={evidence.id}
                      type="button"
                      onClick={() => void openAuthenticatedMedia(evidence.raw_url, evidence.original_filename)}
                      className="overflow-hidden rounded-xl border border-neutral-200 bg-white text-left transition-colors hover:border-[#ff6a1a]"
                    >
                      <AuthenticatedMediaImage
                        src={evidence.raw_url}
                        alt={evidence.original_filename}
                        className="h-32 w-full object-cover sm:h-36"
                      />
                      <span className="block truncate px-3 py-2 text-[12px] font-semibold text-neutral-700">
                        {evidence.original_filename}
                      </span>
                    </button>
                  ))}
                </div>
              </DetailSection>
            ) : null}

            <DetailSection title="Case conversation">
              <ConcernConversation
                items={report.conversation ?? []}
                onStatusClick={(status) => onStatusClick(statusModeFromReport({ status }))}
              />
            </DetailSection>

            <DetailSection title="Send a message">
              <ReportChatPanel
                concernId={report.id}
                open
                disabled={false}
                showHistory={false}
                title="Message this case"
                subtitle="Images and videos are checked before they are added to the case history."
                onMessageSent={onRefresh}
              />
            </DetailSection>

            <ResidentFollowUpPanel report={report} onRefresh={onRefresh} />
          </div>
        </div>

        {lightboxIndex !== null && (
          <EvidenceLightbox
            images={evidenceImages}
            currentIndex={lightboxIndex}
            onClose={() => setLightboxIndex(null)}
            onNavigate={setLightboxIndex}
          />
        )}
      </aside>
    </div>
  )
}

const officialFilters = ["All", "New", "In Review", "Validated", "Suspicious"] as const

function priorityLabel(report: Concern) {
  if (report.category === "public_safety") return "High"
  if (report.vote_count >= 5 || report.comment_count >= 3) return "High"
  if (report.status === "rejected") return "Low"
  return "Medium"
}

function priorityClass(priority: string) {
  if (priority === "High") return "border-red-200 bg-red-50 text-red-700"
  if (priority === "Low") return "border-amber-200 bg-amber-50 text-amber-700"
  return "border-orange-200 bg-orange-50 text-orange-700"
}

function filterOfficialReports(reports: Concern[], filter: string, search: string) {
  const q = search.trim().toLowerCase()
  return reports.filter((report) => {
    const matchesFilter =
      filter === "All" ||
      (filter === "New" && report.status === "submitted") ||
      (filter === "In Review" && report.status === "under_review") ||
      (filter === "Validated" && ["in_progress", "resolved"].includes(report.status)) ||
      (filter === "Suspicious" && report.status === "rejected")
    const matchesSearch = !q || [
      report.title,
      report.description,
      report.reporter.full_name,
      report.address,
      report.barangay,
      report.tracking_id,
    ].some((value) => value?.toLowerCase().includes(q))
    return matchesFilter && matchesSearch
  })
}

function OfficialQueueCard({ report, active, onClick }: { report: Concern; active: boolean; onClick: () => void }) {
  const priority = priorityLabel(report)
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-xl border bg-white p-4 text-left transition-colors hover:border-[#ff6a1a]",
        active ? "border-[#ff6a1a] bg-[#fff8f3] ring-2 ring-[#ff6a1a]/10" : "border-[#dfe7f5]",
      )}
    >
      <div className="flex items-start gap-3">
        <ReportIcon report={report} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="line-clamp-2 text-sm font-extrabold text-[#07145f]">
              {truncateDescription(concernBodyText(report))}
            </p>
            <span className="shrink-0 text-[11px] font-semibold text-[#43507f]">{formatEventTime(report.created_at).split(",").at(-1)?.trim()}</span>
          </div>
          <p className="mt-2 truncate text-xs font-semibold text-[#07145f]">{report.reporter.full_name}</p>
          <p className="mt-1 truncate text-xs font-semibold text-[#43507f]">{report.address || report.barangay}</p>
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className={cn("rounded-full border px-2.5 py-1 text-[11px] font-bold", validationColors[report.validation_status])}>
              {validationLabels[report.validation_status]}
            </span>
            <span className={cn("rounded-full border px-2.5 py-1 text-[11px] font-bold", priorityClass(priority))}>{priority}</span>
          </div>
        </div>
      </div>
    </button>
  )
}

function ReviewRail({ report }: { report: Concern }) {
  const steps = [
    { label: "Submitted", done: true },
    { label: "AI Review", done: report.status !== "submitted" },
    { label: "Official Review", done: ["in_progress", "resolved", "rejected"].includes(report.status) },
    { label: "Validated / Rejected", done: ["resolved", "rejected"].includes(report.status) },
  ]
  return (
    <div className="grid grid-cols-4 gap-2">
      {steps.map((step, index) => (
        <div key={step.label} className="relative flex flex-col items-center gap-2 text-center">
          {index > 0 ? <span className="absolute right-1/2 top-3 h-0.5 w-full bg-[#dfe7f5]" /> : null}
          <span className={cn("relative z-10 flex size-7 items-center justify-center rounded-full border text-[11px] font-black", step.done ? "border-[#ff6a1a] bg-[#ff6a1a] text-white" : "border-[#cbd8ee] bg-white text-[#8b96b8]")}>
            {index + 1}
          </span>
          <span className="text-[11px] font-bold text-[#07145f]">{step.label}</span>
        </div>
      ))}
    </div>
  )
}

function AiAssessmentPanel({ report, onUpdated, onRefresh }: { report: Concern; onUpdated: (report: Concern) => void; onRefresh: () => Promise<void> }) {
  const navigate = useNavigate()
  const ai = report.ai_assessment
  const [decision, setDecision] = useState<"related" | "irrelevant" | "suspicious" | "needs_review">(
    ai?.official_decision || "needs_review",
  )
  const [reason, setReason] = useState(ai?.official_reason || "")
  const [reviewing, setReviewing] = useState(false)
  const [refreshingAssessment, setRefreshingAssessment] = useState(false)
  const aiStatus = ai?.status ?? "not_configured"
  const yoloPercent = ai?.yolo_confidence == null ? null : Math.round(ai.yolo_confidence * 100)
  const nlpPercent = ai?.nlp_confidence == null ? null : Math.round(ai.nlp_confidence * 100)
  const aiReady = aiStatus === "completed"
  const aiState = {
    pending: {
      title: "Base assessment is processing",
      detail: "The report remains available for official review while image and text guidance is prepared.",
      tone: "border-blue-200 bg-blue-50 text-blue-800",
    },
    completed: {
      title: ai?.recommendation || "AI guidance is ready",
      detail: "Stored base-model output; an authorized human still makes the case decision.",
      tone: "border-emerald-200 bg-emerald-50 text-emerald-800",
    },
    failed: {
      title: "Assessment failed safely",
      detail: "Continue manual review. Refresh later after the worker or model issue is corrected.",
      tone: "border-red-200 bg-red-50 text-red-800",
    },
    not_configured: {
      title: "Image model is unavailable",
      detail: "The base text result may still be present; complete the official review manually.",
      tone: "border-amber-200 bg-amber-50 text-amber-800",
    },
  }[aiStatus]

  async function refreshAssessment() {
    setRefreshingAssessment(true)
    try {
      await onRefresh()
    } finally {
      setRefreshingAssessment(false)
    }
  }

  async function saveOfficialReview() {
    const trimmedReason = reason.trim()
    if (trimmedReason.length < 10) {
      toast.error("Explain the official decision in at least 10 characters.")
      return
    }
    setReviewing(true)
    try {
      const assessment = await reviewConcernAi(report.id, { decision, reason: trimmedReason })
      onUpdated({ ...report, ai_assessment: assessment })
      setReason(assessment.official_reason)
      toast.success("Official AI review saved and audited.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the AI review.")
    } finally {
      setReviewing(false)
    }
  }
  return (
    <aside className="space-y-4">
      <section className="rounded-xl border border-[#dfe7f5] bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-extrabold text-[#07145f]">AI Concern Assessment</h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void refreshAssessment()}
              disabled={refreshingAssessment}
              className="rounded-md p-1.5 text-[#2447b3] hover:bg-blue-50 disabled:opacity-50"
              aria-label="Refresh AI assessment"
            >
              <RefreshCwIcon className={cn("size-4", refreshingAssessment && "animate-spin")} />
            </button>
            <span className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-bold text-[#2447b3]">{aiStatus.replace(/_/g, " ")}</span>
          </div>
        </div>
        <div className={cn("mt-4 flex items-center justify-between rounded-xl border p-4", aiState.tone)}>
          <div className="flex items-center gap-3">
            <span className={cn("flex size-10 items-center justify-center rounded-lg text-white", aiReady ? "bg-emerald-600" : aiStatus === "failed" ? "bg-red-600" : aiStatus === "pending" ? "bg-blue-600" : "bg-amber-600")}>
              <ShieldCheckIcon className="size-5" />
            </span>
            <div>
              <p className="text-sm font-extrabold">{aiState.title}</p>
              <p className="max-w-xl text-xs font-semibold opacity-90">{aiState.detail}</p>
            </div>
          </div>
          <p className="text-2xl font-black">{nlpPercent ?? yoloPercent ?? "--"}{nlpPercent != null || yoloPercent != null ? "%" : ""}</p>
        </div>
      </section>

      {ai?.possible_duplicate ? (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-amber-600 text-white">
              <CopyIcon className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-extrabold text-amber-950">Possible nearby duplicate</h3>
                <span className="rounded-md border border-amber-300 bg-white px-2 py-1 text-[11px] font-black text-amber-800">
                  {ai.duplicate_similarity == null ? "Match found" : `${Math.round(ai.duplicate_similarity * 100)}% similar`}
                </span>
              </div>
              <p className="mt-1 text-xs font-semibold leading-5 text-amber-900">
                Compare both reports before assigning. Keep separate reports when they describe different incidents or evidence.
              </p>
              {ai.duplicate_match ? (
                <div className="mt-3 rounded-lg border border-amber-200 bg-white p-3">
                  <p className="text-[11px] font-black uppercase tracking-wide text-amber-700">Matched report</p>
                  <p className="mt-1 truncate text-sm font-extrabold text-[#07145f]">{ai.duplicate_match.title}</p>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold text-[#68739c]">
                    <span>{ai.duplicate_match.tracking_id}</span>
                    <span>{ai.duplicate_match.status.replace(/_/g, " ")}</span>
                    {ai.duplicate_distance_meters != null ? <span>{ai.duplicate_distance_meters} m away</span> : null}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3 w-full border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
                    onClick={() => navigate(`/dashboard/reports/${ai.duplicate_match?.public_id}`)}
                  >
                    Open matched report
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border border-[#dfe7f5] bg-white">
        <div className="border-b border-[#dfe7f5] px-4 py-3">
          <h3 className="text-sm font-extrabold text-[#07145f]">Image Detection (YOLO)</h3>
        </div>
        <div className="space-y-3 p-4 text-xs font-semibold text-[#43507f]">
          <div className="flex flex-wrap gap-2">
            {(ai?.image_objects?.length ? ai.image_objects.map((tag) => String(tag)) : [categoryLabels[report.category], aiReady ? "no detected objects stored" : "not configured"]).map((tag) => (
              <span key={tag} className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">{tag}</span>
            ))}
          </div>
          <p>{aiReady ? `Category match: ${ai?.category_match == null ? "not scored" : ai.category_match ? "matched" : "not matched"}.` : "YOLO model is not configured yet. Official review remains required."}</p>
          <div>
            <div className="mb-1 flex justify-between"><span>Confidence</span><span>{yoloPercent == null ? "Pending" : `${yoloPercent}%`}</span></div>
            <div className="h-2 rounded-full bg-[#edf1f7]"><div className="h-2 rounded-full bg-emerald-600" style={{ width: `${yoloPercent ?? 0}%` }} /></div>
          </div>
          <p>Model: {ai?.model_version || "Base models pending"}</p>
          <p>AI note: {aiReady ? ai?.explanation || "No explanation stored." : "Pending until the base assessment worker completes. Official review remains required."}</p>
        </div>
      </section>

      <section className="rounded-xl border border-[#dfe7f5] bg-white">
        <div className="border-b border-[#dfe7f5] px-4 py-3">
          <h3 className="text-sm font-extrabold text-[#07145f]">Description Analysis (NLP)</h3>
        </div>
        <div className="grid gap-3 p-4 text-xs font-semibold text-[#43507f]">
          <div className="flex items-center justify-between">
            <span>Validity</span>
            <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700">{ai?.nlp_validity || "Pending"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Severity estimate</span>
            <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700">{ai?.severity_estimate || "Pending"}</span>
          </div>
          <div>
            <div className="mb-1 flex justify-between"><span>NLP confidence</span><span>{nlpPercent == null ? "Pending" : `${nlpPercent}%`}</span></div>
            <div className="h-2 rounded-full bg-[#edf1f7]"><div className="h-2 rounded-full bg-emerald-600" style={{ width: `${nlpPercent ?? 0}%` }} /></div>
          </div>
          <p>Model: multilingual-keyword-v1 (base)</p>
          <p>{aiReady ? ai?.explanation || "No NLP explanation stored." : "The base text assessment is pending; do not treat this as an automatic decision."}</p>
        </div>
      </section>

      <section className="rounded-xl border border-[#dfe7f5] bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-extrabold text-[#07145f]">Official AI review</h3>
            <p className="mt-1 text-xs font-semibold text-[#68739c]">AI is guidance only. Record the authorized human decision and reason.</p>
          </div>
          {ai?.official_reviewed_at ? (
            <span className="rounded-md bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">Reviewed</span>
          ) : null}
        </div>
        <label className="mt-4 block text-xs font-bold text-[#43507f]">
          Decision
          <select
            value={decision}
            onChange={(event) => setDecision(event.target.value as typeof decision)}
            className="mt-1.5 h-10 w-full rounded-lg border border-[#ccd7ea] bg-white px-3 text-sm text-[#07145f] outline-none focus:border-[#2447b3]"
          >
            <option value="related">Related to selected category</option>
            <option value="irrelevant">Irrelevant</option>
            <option value="suspicious">Suspicious</option>
            <option value="needs_review">Needs further review</option>
          </select>
        </label>
        <label className="mt-3 block text-xs font-bold text-[#43507f]">
          Review reason
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            placeholder="Explain the evidence and why you agree with or override the AI guidance."
            className="mt-1.5 w-full resize-y rounded-lg border border-[#ccd7ea] bg-white px-3 py-2 text-sm text-[#07145f] outline-none focus:border-[#2447b3]"
          />
        </label>
        <Button
          type="button"
          disabled={reviewing || reason.trim().length < 10}
          onClick={() => void saveOfficialReview()}
          className="mt-3 w-full bg-[#07145f] text-white hover:bg-[#0e227c]"
        >
          {reviewing ? "Saving review..." : ai?.official_reviewed_at ? "Update official review" : "Save official review"}
        </Button>
        {ai?.official_reviewer ? (
          <p className="mt-2 text-[11px] font-semibold text-[#68739c]">Last reviewed by {ai.official_reviewer.full_name || "an authorized official"}.</p>
        ) : null}
      </section>

      <OfficialStatusPanel report={report} onUpdated={onUpdated} />
      <OfficialWorkflowPanel report={report} onRefresh={onRefresh} />
    </aside>
  )
}

function OfficialConcernAppealsPanel({
  appeals,
  reports,
  onOpenReport,
  onAppealReviewed,
  onRefresh,
}: {
  appeals: ConcernAppeal[]
  reports: Concern[]
  onOpenReport: (report: Concern) => void
  onAppealReviewed: (appeal: ConcernAppeal) => void
  onRefresh: () => Promise<void>
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<number, string>>({})
  const pending = appeals.filter((appeal) => appeal.status === "submitted")
  const visible = (pending.length ? pending : appeals).slice(0, 4)

  function relatedReport(appeal: ConcernAppeal) {
    return reports.find(
      (report) =>
        report.id === appeal.concern_id ||
        report.tracking_id === appeal.concern_tracking_id,
    )
  }

  async function decide(appeal: ConcernAppeal, status: "approved" | "denied") {
    const note = notes[appeal.id]?.trim() || (status === "approved" ? "Appeal approved after official review." : "Appeal denied after official review.")
    setBusy(`${appeal.id}-${status}`)
    try {
      const next = await reviewConcernAppeal(appeal.id, { status, decision_note: note })
      onAppealReviewed(next)
      setNotes((current) => {
        const copy = { ...current }
        delete copy[appeal.id]
        return copy
      })
      await onRefresh()
      toast.success(status === "approved" ? "Appeal approved" : "Appeal denied")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Appeal decision could not be saved.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="rounded-xl border border-[#dfe7f5] bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-black text-[#07145f]">Appeals</h2>
          <p className="mt-1 text-xs font-semibold text-[#68739c]">
            Review reopened reports and resident objections.
          </p>
        </div>
        <span className="rounded-lg border border-[#dfe7f5] bg-[#f8fafc] px-2.5 py-1 text-xs font-black text-[#07145f]">
          {pending.length} pending
        </span>
      </div>

      <div className="mt-4 space-y-3">
        {visible.map((appeal) => {
          const report = relatedReport(appeal)
          const editable = appeal.status === "submitted"
          return (
            <article key={appeal.id} className="rounded-lg border border-[#dfe7f5] bg-[#fbfcff] p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-[#07145f]">
                    {appeal.concern_tracking_id || `Report #${appeal.concern_id ?? appeal.id}`}
                  </p>
                  <p className="mt-1 text-xs font-semibold text-[#68739c]">
                    {appeal.appellant.full_name} · {formatEventTime(appeal.created_at)}
                  </p>
                </div>
                <span className="shrink-0 rounded-md border border-[#dfe7f5] bg-white px-2 py-1 text-[11px] font-black capitalize text-[#43507f]">
                  {appeal.status}
                </span>
              </div>
              <p className="mt-3 line-clamp-3 text-xs font-semibold leading-5 text-[#43507f]">
                {appeal.reason}
              </p>
              {editable ? (
                <textarea
                  value={notes[appeal.id] ?? ""}
                  onChange={(event) => setNotes((current) => ({ ...current, [appeal.id]: event.target.value }))}
                  placeholder="Decision note for audit trail"
                  className="mt-3 min-h-16 w-full rounded-lg border border-[#cbd8ee] bg-white px-3 py-2 text-xs font-semibold text-[#07145f] outline-none focus:border-[#ff6a1a]"
                />
              ) : appeal.decision_note ? (
                <p className="mt-3 rounded-lg bg-white p-3 text-xs font-semibold text-[#43507f]">
                  Decision: {appeal.decision_note}
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!report}
                  onClick={() => report ? onOpenReport(report) : toast.error("The original report is not in the current queue.")}
                >
                  Open report
                </Button>
                {editable ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      className="bg-emerald-600 text-white hover:bg-emerald-700"
                      disabled={busy === `${appeal.id}-approved`}
                      onClick={() => void decide(appeal, "approved")}
                    >
                      Approve
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      disabled={busy === `${appeal.id}-denied`}
                      onClick={() => void decide(appeal, "denied")}
                    >
                      Deny
                    </Button>
                  </>
                ) : null}
              </div>
            </article>
          )
        })}
        {visible.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[#dfe7f5] bg-[#f8fafc] p-5 text-center text-sm font-semibold text-[#68739c]">
            No concern appeals yet.
          </p>
        ) : null}
      </div>
    </section>
  )
}

function OfficialConcernDashboard({
  reports,
  appeals,
  selected,
  activeFilter,
  setActiveFilter,
  search,
  setSearch,
  onSelect,
  onUpdated,
  onAppealReviewed,
  onRefresh,
  error,
}: {
  reports: Concern[]
  appeals: ConcernAppeal[]
  selected: Concern | undefined
  activeFilter: string
  setActiveFilter: (filter: string) => void
  search: string
  setSearch: (value: string) => void
  onSelect: (report: Concern) => void
  onUpdated: (report: Concern) => void
  onAppealReviewed: (appeal: ConcernAppeal) => void
  onRefresh: () => Promise<void>
  error: string
}) {
  const navigate = useNavigate()
  const filtered = filterOfficialReports(reports, activeFilter, search)
  const current = selected ?? filtered[0]
  return (
    <div className="flex flex-col">
      <main className="min-h-screen bg-[#f7f8fc] p-4 pb-[calc(5rem+env(safe-area-inset-bottom))] md:p-6 md:pb-6">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="flex h-12 flex-1 items-center gap-3 rounded-xl border border-[#dfe7f5] bg-white px-4">
            <SearchIcon className="size-4 text-[#43507f]" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search concerns, residents, or locations..."
              className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-[#07145f] outline-none placeholder:text-[#68739c]"
            />
          </label>
          <span className="w-fit shrink-0 rounded-xl border border-[#dfe7f5] bg-white px-4 py-3 text-sm font-extrabold text-[#07145f]">
            {validationLabels.pending}
          </span>
          <Button type="button" variant="outline" onClick={() => navigate("/dashboard/community-content")} className="h-12 shrink-0 rounded-xl border-[#dfe7f5] bg-white font-black text-[#2447b3]"><MegaphoneIcon className="size-4" />Community content</Button>
        </div>

        {error ? <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</p> : null}

        <div className="grid gap-4 2xl:grid-cols-[420px_minmax(0,1.15fr)_420px]">
          <aside className="space-y-4">
            <section className="rounded-xl border border-[#dfe7f5] bg-white p-4">
              <h2 className="text-base font-black text-[#07145f]">Incoming Concern Queue</h2>
              <div className="scrollbar-hide mt-4 flex gap-2 overflow-x-auto">
                {officialFilters.map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    onClick={() => setActiveFilter(filter)}
                    className={cn("shrink-0 rounded-md border px-3 py-2 text-xs font-bold", activeFilter === filter ? "border-[#ff6a1a] bg-[#ff6a1a] text-white" : "border-[#dfe7f5] bg-[#f8fafc] text-[#43507f]")}
                  >
                    {filter} {filter === "All" ? reports.length : ""}
                  </button>
                ))}
              </div>
              <div className="mt-4 space-y-3">
                {filtered.map((report) => (
                  <OfficialQueueCard key={report.id} report={report} active={current?.id === report.id} onClick={() => onSelect(report)} />
                ))}
                {filtered.length === 0 ? <p className="rounded-xl bg-[#f8fafc] p-6 text-center text-sm font-semibold text-[#68739c]">No concerns match this queue.</p> : null}
              </div>
            </section>

            <OfficialConcernAppealsPanel
              appeals={appeals}
              reports={reports}
              onOpenReport={onSelect}
              onAppealReviewed={onAppealReviewed}
              onRefresh={onRefresh}
            />
          </aside>

          {current ? (
            <section className="space-y-4">
              <div className="rounded-xl border border-[#dfe7f5] bg-white p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="flex items-start gap-4">
                    <ReportIcon report={current} />
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-xl font-black text-[#07145f]">{current.title}</h2>
                        <span className={cn("rounded-md border px-2.5 py-1 text-xs font-bold", validationColors[current.validation_status])}>{validationLabels[current.validation_status]}</span>
                      </div>
                      <p className="mt-2 text-sm font-semibold text-[#07145f]">{categoryLabels[current.category]} / {categoryStyles[current.category].sub}</p>
                    </div>
                  </div>
                  <span className={cn("w-fit rounded-md border px-3 py-1.5 text-xs font-bold", priorityClass(priorityLabel(current)))}>{priorityLabel(current)}</span>
                </div>
                <div className="mt-5 grid gap-4 border-t border-[#dfe7f5] pt-4 md:grid-cols-4">
                  <InfoLabel label="Resident" value={current.reporter.full_name} />
                  <InfoLabel label="Concern ID" value={current.tracking_id} />
                  <InfoLabel label="Submitted" value={formatEventTime(current.created_at)} />
                  <InfoLabel label="Priority" value={priorityLabel(current)} />
                </div>
                <div className="mt-5">
                  <p className="text-sm font-black text-[#07145f]">Description</p>
                  <p className="mt-2 text-sm font-semibold leading-6 text-[#07145f]">{current.description || "No description provided."}</p>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <h3 className="text-sm font-black text-[#07145f]">Case Conversation</h3>
                  <p className="mt-1 text-xs font-semibold text-[#68739c]">Status, clarifications, messages, remarks, and appeals in one chronological record.</p>
                </div>
                <ConcernConversation items={current.conversation ?? []} />
              <ReportChatPanel
                key={`official-chat-${current.id}`}
                concernId={current.id}
                open
                showHistory={false}
                title="Message this case"
                subtitle="Private thread · resident and barangay officials"
                emptyMessage="Use this thread for follow-up questions, clarification, and resident-visible updates tied to this concern."
                onMessageSent={onRefresh}
                className="border-[#dfe7f5] shadow-sm"
              />
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <InfoCard title="Resident Details">
                  <p className="text-sm font-black text-[#07145f]">{current.reporter.full_name}</p>
                  <p className="mt-2 text-xs font-semibold text-[#43507f]">Contact details are restricted to account management.</p>
                  <p className="mt-2 text-xs font-semibold text-[#43507f]">{current.address || current.barangay}</p>
                  <span className="mt-3 inline-flex rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">Verified Resident</span>
                </InfoCard>
                <InfoCard title="Location">
                  <ReportLocationAddress
                    address={current.address}
                    barangay={current.barangay}
                    latitude={current.latitude}
                    longitude={current.longitude}
                  />
                  <div className="mt-3">
                    <ReportLocationMap
                      latitude={current.latitude}
                      longitude={current.longitude}
                      heightClassName="h-40"
                    />
                  </div>
                </InfoCard>
              </div>

              <div className="rounded-xl border border-[#dfe7f5] bg-white p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-black text-[#07145f]">Evidence ({current.media.length})</h3>
                  <button type="button" onClick={() => openReportMedia(current)} className="text-xs font-extrabold text-[#2447b3]">View all media</button>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  {current.media.slice(0, 3).map((media) => media.mime_type.startsWith("image/") ? (
                    <img key={media.id} src={media.preview_url} alt={media.original_filename} className="h-28 w-full rounded-lg object-cover" />
                  ) : (
                    <a key={media.id} href={media.raw_url} target="_blank" rel="noreferrer" className="flex h-28 items-center justify-center rounded-lg border border-[#dfe7f5] text-xs font-bold text-[#43507f]">{media.original_filename}</a>
                  ))}
                  {current.media.length === 0 ? <div className="col-span-full flex h-28 items-center justify-center rounded-lg border border-dashed border-[#dfe7f5] text-xs font-semibold text-[#68739c]">No evidence uploaded</div> : null}
                </div>
              </div>

              <div className="rounded-xl border border-[#dfe7f5] bg-white p-4">
                <h3 className="text-sm font-black text-[#07145f]">Review Timeline</h3>
                <div className="mt-4"><ReviewRail report={current} /></div>
              </div>

            </section>
          ) : null}

          {current ? <AiAssessmentPanel report={current} onUpdated={onUpdated} onRefresh={onRefresh} /> : null}
        </div>
      </main>
    </div>
  )
}

function InfoLabel({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-bold text-[#68739c]">{label}</p>
      <p className="mt-1 truncate text-xs font-extrabold text-[#07145f]">{value}</p>
    </div>
  )
}

function InfoCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-[#dfe7f5] bg-white p-4">
      <h3 className="text-sm font-black text-[#07145f]">{title}</h3>
      <div className="mt-3">{children}</div>
    </div>
  )
}

export default function ReportsPage() {
  usePageTitle("Reports")
  const navigate = useNavigate()
  const { reportId } = useParams()
  const { user } = useAuthSession()
  const hasLoadedRef = useRef(false)
  const [loaded, setLoaded] = useState(false)
  const [activeFilter, setActiveFilter] = useState<string>("All")
  const [search, setSearch] = useState("")
  const [selectedReport, setSelectedReport] = useState<string | null>(null)
  const [reportPage, setReportPage] = useState(1)
  const [reports, setReports] = useState<Concern[]>([])
  const [concernAppeals, setConcernAppeals] = useState<ConcernAppeal[]>([])
  const [error, setError] = useState("")
  const [statusDialogOpen, setStatusDialogOpen] = useState(false)
  const [statusDialogMode, setStatusDialogMode] = useState<StatusDialogMode>("assigned")
  const routeReportId = reportId ?? null
  const isOfficial = Boolean(
    user?.role === "barangay_official" || user?.is_staff || user?.is_superuser,
  )

  async function loadReports() {
    if (!hasLoadedRef.current) {
      setLoaded(false)
    }
    setError("")
    try {
      if (isOfficial) {
        const [nextReports, nextAppeals] = await Promise.all([
          listManagedConcerns(),
          listConcernAppeals(),
        ])
        setReports(nextReports)
        setConcernAppeals(nextAppeals)
      } else {
        setReports(await listMyConcerns())
        setConcernAppeals([])
      }
    } catch {
      setError(isOfficial ? "Could not load report management queue." : "Could not load your reports.")
    } finally {
      hasLoadedRef.current = true
      setLoaded(true)
    }
  }

  useEffect(() => {
    void loadReports()
    function refresh() {
      void loadReports()
    }
    const interval = window.setInterval(refresh, 30000)
    window.addEventListener("eboses:report-created", refresh)
    window.addEventListener("eboses:concern-updated", refresh)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener("eboses:report-created", refresh)
      window.removeEventListener("eboses:concern-updated", refresh)
    }
  }, [isOfficial])

  useEffect(() => {
    if (routeReportId) {
      setSelectedReport(routeReportId)
    } else if (!routeReportId) {
      setSelectedReport(null)
    }
  }, [routeReportId])

  useEffect(() => {
    setReportPage(1)
  }, [activeFilter])

  useEffect(() => {
    // Wait until list is loaded so we don't drop a deep-linked selection on first paint.
    if (!loaded || !selectedReport || reports.length === 0) return
    const inFilter = filterReports(reports, activeFilter).some(
      (report) => report.public_id === selectedReport || String(report.id) === selectedReport,
    )
    if (!inFilter) {
      setSelectedReport(null)
      if (routeReportId) navigate("/dashboard/reports", { replace: true })
    }
  }, [activeFilter, reports, selectedReport, routeReportId, navigate, loaded])

  // All hooks must run before any conditional return (Rules of Hooks).
  const closeReportDetails = useCallback(() => {
    setSelectedReport(null)
    navigate("/dashboard/reports")
  }, [navigate])

  if (!loaded)
    return (
      <div className="flex flex-col">
        <div className="flex-1 p-4 md:p-10">
          <Skeleton className="h-28 w-full rounded-2xl" />
          <div className="scrollbar-hide mt-6 w-full max-w-full min-w-0 touch-pan-x overflow-x-scroll overscroll-x-contain [-webkit-overflow-scrolling:touch] lg:overflow-visible">
            <div className="flex min-w-max flex-nowrap gap-2 pb-1 lg:grid lg:min-w-0 lg:grid-cols-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-20 shrink-0 rounded-full lg:w-full" />
              ))}
            </div>
          </div>
          <div className="mt-4 grid gap-6 lg:grid-cols-5">
            <div className="flex flex-col gap-2 lg:col-span-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-[68px] rounded-lg" />
              ))}
            </div>
            <div className="hidden lg:col-span-2 lg:block">
              <Skeleton className="h-72 rounded-xl" />
            </div>
          </div>
        </div>
      </div>
    )

  const filtered = filterReports(reports, activeFilter)
  const totalPages = Math.max(1, Math.ceil(filtered.length / residentReportsPageSize))
  const currentPage = Math.min(reportPage, totalPages)
  const pagedReports = filtered.slice((currentPage - 1) * residentReportsPageSize, currentPage * residentReportsPageSize)
  const firstShown = filtered.length === 0 ? 0 : (currentPage - 1) * residentReportsPageSize + 1
  const lastShown = Math.min(filtered.length, currentPage * residentReportsPageSize)
  // Only show details when the user picks a row (or deep-links). Do not auto-open first row.
  const selected = selectedReport
    ? reports.find(
        (report) => report.public_id === selectedReport || String(report.id) === selectedReport,
      ) ?? null
    : null

  function selectReport(report: Concern) {
    setSelectedReport(report.public_id)
    navigate(`/dashboard/reports/${report.public_id}`)
  }

  function updateReport(next: Concern) {
    setReports((current) => current.map((report) => report.id === next.id ? next : report))
    setSelectedReport(next.public_id)
  }

  function updateAppeal(next: ConcernAppeal) {
    setConcernAppeals((current) => current.map((appeal) => appeal.id === next.id ? next : appeal))
  }

  async function copyTrackingId(report: Concern) {
    await navigator.clipboard?.writeText(report.tracking_id)
    toast.success("Tracking ID copied")
  }

  if (isOfficial) {
    return (
      <OfficialConcernDashboard
        reports={reports}
        appeals={concernAppeals}
        selected={reports.find(
          (report) => report.public_id === selectedReport || String(report.id) === selectedReport,
        )}
        activeFilter={activeFilter}
        setActiveFilter={setActiveFilter}
        search={search}
        setSearch={setSearch}
        onSelect={selectReport}
        onUpdated={updateReport}
        onAppealReviewed={updateAppeal}
        onRefresh={loadReports}
        error={error}
      />
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <div
        className="min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(7.5rem+env(safe-area-inset-bottom))] pt-4 md:px-6 md:pb-10 md:pt-6 lg:px-6 lg:pb-8"
      >
        <div className="mb-5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="flex size-8 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100 md:hidden"
              aria-label="Go back"
            >
              <ChevronLeftIcon className="size-5" />
            </button>
            <h1 className="text-[20px] font-bold tracking-tight text-neutral-900 sm:text-2xl">
              My reports
            </h1>
          </div>
          <p className="mt-1 text-sm text-neutral-500">
            Track status and updates on reports you submitted.
          </p>
        </div>

        {/* Filters + table: fixed custom width (not max-w utility) */}
        <section
          className="flex min-w-0 flex-col items-stretch gap-5"
          style={{ width: "min(100%, 52rem)" }}
        >
          <div
            className="scrollbar-hide flex w-full gap-2 overflow-x-auto overscroll-x-contain pb-0.5 [-webkit-overflow-scrolling:touch]"
            role="tablist"
            aria-label="Report status filters"
          >
            {filters.map((filter) => (
              <button
                key={filter}
                type="button"
                role="tab"
                data-filter-option
                aria-selected={activeFilter === filter}
                aria-pressed={activeFilter === filter}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  setActiveFilter(filter)
                  setReportPage(1)
                }}
                className={cn(
                  "relative z-10 h-10 shrink-0 cursor-pointer rounded-full border px-4 text-[13px] font-semibold whitespace-nowrap transition-colors",
                  activeFilter === filter
                    ? "border-[#ff6a1a] bg-[#ff6a1a] text-white"
                    : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50",
                )}
              >
                {filter}
              </button>
            ))}
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          {/* Same width band as filters */}
          <div className="w-full overflow-hidden rounded-lg border border-neutral-200 bg-white">
            <div className="flex flex-col divide-y divide-neutral-100">
              {pagedReports.map((report) => {
                const group = statusGroup(report.status)
                const isSelected = selected?.id === report.id
                return (
                  <button
                    key={report.id}
                    type="button"
                    onClick={() => selectReport(report)}
                    className={cn(
                      "flex min-h-[68px] w-full items-center gap-3 px-4 py-3.5 text-left transition-colors",
                      isSelected ? "bg-neutral-50" : "bg-white hover:bg-neutral-50/80",
                    )}
                  >
                    <ReportIcon report={report} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-[15px] font-medium leading-snug text-neutral-900">
                        {truncateDescription(concernBodyText(report))}
                      </p>
                      <p className="mt-0.5 truncate text-[13px] text-neutral-500">
                        {categoryLabels[report.category]}
                        <span className="mx-1 text-neutral-300">·</span>
                        {formatDate(report.created_at)}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-md border px-2.5 py-1 text-[11px] font-medium",
                        statusColors[group],
                      )}
                    >
                      {group}
                    </span>
                    <ChevronRightIcon className="size-4 shrink-0 text-neutral-300" />
                  </button>
                )
              })}
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center px-6 py-14 text-center text-sm text-neutral-500">
                  {activeFilter === "All"
                    ? "No reports yet."
                    : `No ${activeFilter.toLowerCase()} reports.`}
                </div>
              ) : null}
            </div>

            {filtered.length > 0 ? (
              <div className="flex items-center justify-between gap-3 border-t border-neutral-100 px-4 py-3">
                <p className="text-[12px] font-medium text-neutral-500">
                  {firstShown}–{lastShown} of {filtered.length}
                </p>
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => setReportPage((value) => Math.max(1, value - 1))}
                    className="flex size-8 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-50 disabled:opacity-40"
                    disabled={currentPage <= 1}
                    aria-label="Previous page"
                  >
                    <ChevronLeftIcon className="size-3.5" />
                  </button>
                  {Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => (
                    <button
                      key={page}
                      type="button"
                      onClick={() => setReportPage(page)}
                      aria-current={page === currentPage ? "page" : undefined}
                      className={cn(
                        "flex size-8 items-center justify-center rounded-md text-xs font-semibold transition-colors",
                        page === currentPage
                          ? "border border-[#ff6a1a] bg-[#ff6a1a] text-white"
                          : "text-neutral-600 hover:bg-neutral-50",
                      )}
                    >
                      {page}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setReportPage((value) => Math.min(totalPages, value + 1))}
                    className="flex size-8 items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-50 disabled:opacity-40"
                    disabled={currentPage >= totalPages}
                    aria-label="Next page"
                  >
                    <ChevronRightIcon className="size-3.5" />
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </div>

      {/* Right details sidebar only — no dim/blur backdrop */}
      {selected ? (
        <ReportDetailsSidebar
          report={selected}
          onClose={closeReportDetails}
          onCopyTrackingId={() => void copyTrackingId(selected)}
          onStatusClick={(mode) => {
            setStatusDialogMode(mode)
            setStatusDialogOpen(true)
          }}
          onRefresh={loadReports}
          onUpdated={updateReport}
          isOfficial={isOfficial}
        />
      ) : null}

      {selected ? (
        <ReportStatusDialog
          open={statusDialogOpen}
          onOpenChange={setStatusDialogOpen}
          report={selected}
          mode={statusDialogMode}
          onTrack={() => selectReport(selected)}
        />
      ) : null}
    </div>
  )
}
