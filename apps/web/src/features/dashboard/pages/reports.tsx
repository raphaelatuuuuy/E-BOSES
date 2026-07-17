import { useEffect, useRef, useState, type ReactNode } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"
import {
  ArrowUpIcon,
  CalendarIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  ClockIcon,
  CopyIcon,
  LeafIcon,
  MapPinIcon,
  SearchIcon,
  Share2Icon,
  ShieldCheckIcon,
  TrafficConeIcon,
  WrenchIcon,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
} from "@workspace/ui/components/card"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"

import {
  assignConcern,
  createConcernAppeal,
  createConcernRemark,
  listManagedConcerns,
  listMyConcerns,
  replyConcernClarification,
  requestConcernClarification,
  updateConcernStatus,
  type Concern,
  type ConcernCategory,
  type ConcernStatus,
  type ConcernStatusEvent,
  type ConcernValidationStatus,
} from "@/features/dashboard/api"
import { Topbar } from "@/features/dashboard/components/topbar"
import {
  AuthenticatedMediaImage,
  openAuthenticatedMedia,
} from "@/features/dashboard/components/authenticated-media"
import { ReportStatusDialog, statusModeFromReport, type StatusDialogMode } from "@/features/dashboard/components/report-status-dialog"
import { useHorizontalDragScroll } from "@/features/dashboard/hooks/use-horizontal-drag-scroll"
import { useAuthSession } from "@/features/auth/auth-session"
import { usePageTitle } from "@/hooks/use-page-title"

const filters = ["All", "Active", "Resolved", "Rejected", "Appealed"] as const
const residentReportsPageSize = 6

const activeStatuses: ConcernStatus[] = ["submitted", "under_review", "assigned", "in_progress"]

const statusColors: Record<string, string> = {
  Active: "bg-blue-100 text-blue-700 border-blue-200",
  Resolved: "bg-green-100 text-green-700 border-green-200",
  Rejected: "bg-red-100 text-red-700 border-red-200",
  Appealed: "bg-orange-100 text-orange-700 border-orange-200",
}

const timelineDotColors: Record<string, string> = {
  Submitted: "bg-blue-500",
  "In Review": "bg-amber-500",
  "In Progress": "bg-blue-500",
  Resolved: "bg-green-500",
  Rejected: "bg-red-500",
  Appealed: "bg-orange-500",
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

const categoryStyles: Record<ConcernCategory, { icon: typeof WrenchIcon; bg: string; text: string; sub: string }> = {
  infrastructure: { icon: TrafficConeIcon, bg: "bg-[#eef3ff]", text: "text-[#2447b3]", sub: "Roads & utilities" },
  environment: { icon: LeafIcon, bg: "bg-[#eef3ff]", text: "text-[#2447b3]", sub: "Garbage Collection" },
  public_safety: { icon: ShieldCheckIcon, bg: "bg-[#fff1ea]", text: "text-[#ff5003]", sub: "Safety & response" },
  others: { icon: SearchIcon, bg: "bg-[#eef3ff]", text: "text-[#2447b3]", sub: "General concern" },
}

function statusLabel(status: ConcernStatus) {
  if (status === "under_review") return "In Review"
  return status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
}

function statusGroup(status: ConcernStatus) {
  if (activeStatuses.includes(status)) return "Active"
  return statusLabel(status)
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

function filterReports(reports: Concern[], filter: string) {
  if (filter === "All") return reports
  return reports.filter((report) => statusGroup(report.status) === filter)
}

function reportUpdate(report: Concern) {
  return report.update_text || report.status_events.at(-1)?.note || "Your report was received."
}

function mapSrc(report: Concern) {
  const lat = Number(report.latitude)
  const lng = Number(report.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return ""
  return `https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.006}%2C${lat - 0.006}%2C${lng + 0.006}%2C${lat + 0.006}&layer=mapnik&marker=${lat}%2C${lng}`
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

function ReportIcon({ report }: { report: Concern }) {
  const style = categoryStyles[report.category]
  const Icon = style.icon
  return (
    <span className={cn("flex size-12 shrink-0 items-center justify-center rounded-full", style.bg, style.text)}>
      <Icon className="size-6" strokeWidth={2} />
    </span>
  )
}

const officialStatuses: ConcernStatus[] = ["under_review", "in_progress", "resolved", "rejected", "appealed"]

function OfficialStatusPanel({ report, onUpdated }: { report: Concern; onUpdated: (report: Concern) => void }) {
  const [status, setStatus] = useState<ConcernStatus>(report.status === "submitted" ? "under_review" : report.status)
  const [note, setNote] = useState(report.update_text || "")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setStatus(report.status === "submitted" ? "under_review" : report.status)
    setNote(report.update_text || "")
  }, [report.id, report.status, report.update_text])

  async function submit() {
    setBusy(true)
    try {
      const next = await updateConcernStatus(report.id, { status, note })
      onUpdated(next)
      toast.success("Report status updated")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update report.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-[#dfe7f5] bg-[#f8fafc] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-extrabold text-[#07145f]">Official action</p>
          <p className="mt-1 text-xs font-semibold text-[#68739c]">Validate, assign, reject, or resolve this resident report.</p>
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
        <Button type="button" disabled={busy} onClick={submit} className="bg-[#ff6a1a] text-white hover:bg-[#e85f17]">
          {busy ? "Updating" : "Update"}
        </Button>
      </div>
    </div>
  )
}

function OfficialWorkflowPanel({ report, onRefresh }: { report: Concern; onRefresh: () => Promise<void> }) {
  const [office, setOffice] = useState("")
  const [assignmentNote, setAssignmentNote] = useState("")
  const [clarificationText, setClarificationText] = useState("")
  const [remark, setRemark] = useState("")
  const [visibleToResident, setVisibleToResident] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

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
          <input value={office} onChange={(event) => setOffice(event.target.value)} placeholder="Assign to office/team" className="h-10 rounded-lg border border-[#cbd8ee] px-3 text-xs font-semibold text-[#07145f] outline-none focus:border-[#ff6a1a]" />
          <input value={assignmentNote} onChange={(event) => setAssignmentNote(event.target.value)} placeholder="Assignment note" className="h-10 rounded-lg border border-[#cbd8ee] px-3 text-xs font-semibold text-[#07145f] outline-none focus:border-[#ff6a1a]" />
          <Button type="button" disabled={busy === "assign" || !office.trim()} onClick={() => run("assign", () => assignConcern(report.id, { office: office.trim(), note: assignmentNote.trim() }))} className="bg-[#ff6a1a] text-white hover:bg-[#e85f17]">
            {busy === "assign" ? "Assigning" : "Assign report"}
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
    <div className="rounded-xl border border-[#dfe7f5] bg-white p-4">
      <h3 className="text-sm font-black text-[#07145f]">Follow-up actions</h3>
      {report.official_remarks?.length ? (
        <div className="mt-3 space-y-2">
          {report.official_remarks.map((remark) => (
            <p key={remark.id} className="rounded-lg bg-[#f8fafc] p-3 text-xs font-semibold leading-5 text-[#43507f]">{remark.body}</p>
          ))}
        </div>
      ) : null}
      {openClarifications.map((clarification) => (
        <div key={clarification.id} className="mt-3 grid gap-2 border-t border-[#dfe7f5] pt-3">
          <p className="text-xs font-bold text-[#07145f]">{clarification.request_text}</p>
          <textarea value={responses[clarification.id] ?? ""} onChange={(event) => setResponses((current) => ({ ...current, [clarification.id]: event.target.value }))} placeholder="Type your response" className="min-h-20 rounded-lg border border-[#cbd8ee] px-3 py-2 text-xs font-semibold text-[#07145f] outline-none focus:border-[#ff6a1a]" />
          <Button type="button" disabled={busy === `clarification-${clarification.id}`} onClick={() => void submitReply(clarification.id)} className="bg-[#ff6a1a] text-white hover:bg-[#e85f17]">
            {busy === `clarification-${clarification.id}` ? "Sending" : "Send clarification"}
          </Button>
        </div>
      ))}
      {appealHistory.length ? (
        <div className="mt-3 space-y-2 border-t border-[#dfe7f5] pt-3">
          <p className="text-xs font-black uppercase text-[#68739c]">Appeal history</p>
          {appealHistory.map((appeal) => (
            <div key={appeal.id} className={cn(
              "rounded-lg border p-3 text-xs font-semibold leading-5",
              appeal.status === "approved" && "border-emerald-200 bg-emerald-50 text-emerald-800",
              appeal.status === "denied" && "border-red-200 bg-red-50 text-red-800",
              appeal.status === "submitted" && "border-orange-200 bg-orange-50 text-orange-800",
            )}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-black">Appeal {appeal.status.replace("_", " ")}</span>
                <span>{formatEventTime(appeal.decided_at || appeal.created_at)}</span>
              </div>
              <p className="mt-2">{appeal.reason}</p>
              {appeal.decision_note ? <p className="mt-2 font-bold">Decision: {appeal.decision_note}</p> : null}
              {appeal.reviewed_by ? <p className="mt-1">Reviewed by {appeal.reviewed_by.full_name}</p> : null}
            </div>
          ))}
        </div>
      ) : null}
      {canAppeal ? (
        <div className="mt-3 grid gap-2 border-t border-[#dfe7f5] pt-3">
          <textarea value={appealReason} onChange={(event) => setAppealReason(event.target.value)} placeholder="Explain why this report should be reviewed again" className="min-h-20 rounded-lg border border-[#cbd8ee] px-3 py-2 text-xs font-semibold text-[#07145f] outline-none focus:border-[#ff6a1a]" />
          <Button type="button" disabled={busy === "appeal" || !appealReason.trim()} onClick={() => void submitAppeal()} className="bg-[#ff6a1a] text-white hover:bg-[#e85f17]">
            {busy === "appeal" ? "Submitting" : "Submit appeal"}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function Timeline({ report, onStatusClick }: { report: Concern; onStatusClick: (mode: StatusDialogMode) => void }) {
  const events: ConcernStatusEvent[] = report.status_events.length
    ? report.status_events
    : [
        {
          id: 0,
          status: report.status,
          note: reportUpdate(report),
          actor: report.reporter,
          created_at: report.created_at,
        },
      ]

  return (
    <div className="relative mt-2 space-y-0">
      {events.map((step, i) => {
        const label = statusLabel(step.status)
        const isLast = i === events.length - 1
        const dotColor = timelineDotColors[label] ?? "bg-muted-foreground"
        const mode = statusModeFromReport({ status: step.status })
        return (
          <div key={`${step.id}-${step.status}`} className="flex gap-2">
            <div className="flex flex-col items-center">
              <div className={cn("flex size-4 shrink-0 items-center justify-center rounded-full", dotColor, isLast && activeStatuses.includes(report.status) && "animate-pulse")} />
              {!isLast && <div className="mt-0.5 w-0.5 flex-1 rounded-full bg-border" />}
            </div>
            <button
              type="button"
              onClick={() => onStatusClick(mode)}
              className={cn(
                "flex-1 pb-3 text-left",
                isLast && "pb-0",
                "cursor-pointer hover:opacity-80",
              )}
            >
              <p className="text-xs font-medium text-foreground">{label}</p>
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span>{formatEventTime(step.created_at)}</span>
                {step.actor ? (
                  <>
                    <span>&middot;</span>
                    <span>{step.actor.full_name}</span>
                  </>
                ) : null}
              </div>
              {step.note ? <p className="mt-0.5 text-xs text-muted-foreground">{step.note}</p> : null}
            </button>
          </div>
        )
      })}
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
            <p className="truncate text-sm font-extrabold text-[#07145f]">{report.title}</p>
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
  const ai = report.ai_assessment
  const aiStatus = ai?.status ?? "not_configured"
  const yoloPercent = ai?.yolo_confidence == null ? null : Math.round(ai.yolo_confidence * 100)
  const nlpPercent = ai?.nlp_confidence == null ? null : Math.round(ai.nlp_confidence * 100)
  const aiReady = aiStatus === "completed"
  return (
    <aside className="space-y-4">
      <section className="rounded-xl border border-[#dfe7f5] bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-extrabold text-[#07145f]">AI Concern Assessment</h3>
          <span className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-bold text-[#2447b3]">{aiStatus.replace(/_/g, " ")}</span>
        </div>
        <div className={cn("mt-4 flex items-center justify-between rounded-xl border p-4", aiReady ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50")}>
          <div className="flex items-center gap-3">
            <span className={cn("flex size-10 items-center justify-center rounded-full text-white", aiReady ? "bg-emerald-600" : "bg-amber-600")}>
              <ShieldCheckIcon className="size-5" />
            </span>
            <div>
              <p className={cn("text-sm font-extrabold", aiReady ? "text-emerald-800" : "text-amber-800")}>{aiReady ? (ai?.recommendation || "AI result ready") : "AI assessment unavailable"}</p>
              <p className={cn("text-xs font-semibold", aiReady ? "text-emerald-700" : "text-amber-700")}>{aiReady ? "Stored model output" : "Model not configured or still pending"}</p>
            </div>
          </div>
          <p className={cn("text-2xl font-black", aiReady ? "text-emerald-700" : "text-amber-700")}>{nlpPercent ?? yoloPercent ?? "--"}{nlpPercent != null || yoloPercent != null ? "%" : ""}</p>
        </div>
      </section>

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
          <p>AI note: {aiReady ? ai?.explanation || "No explanation stored." : "Pending until the AI worker is configured."}</p>
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
          <p>{aiReady ? ai?.explanation || "No NLP explanation stored." : "NLP model is not configured yet."}</p>
        </div>
      </section>

      <OfficialStatusPanel report={report} onUpdated={onUpdated} />
      <OfficialWorkflowPanel report={report} onRefresh={onRefresh} />
    </aside>
  )
}

function OfficialConcernDashboard({
  reports,
  selected,
  activeFilter,
  setActiveFilter,
  search,
  setSearch,
  onSelect,
  onUpdated,
  onRefresh,
  error,
}: {
  reports: Concern[]
  selected: Concern | undefined
  activeFilter: string
  setActiveFilter: (filter: string) => void
  search: string
  setSearch: (value: string) => void
  onSelect: (report: Concern) => void
  onUpdated: (report: Concern) => void
  onRefresh: () => Promise<void>
  error: string
}) {
  const filtered = filterOfficialReports(reports, activeFilter, search)
  const current = selected ?? filtered[0]
  return (
    <div className="flex flex-col">
      <Topbar />
      <main className="min-h-screen bg-[#f7f8fc] p-4 md:p-6">
        <div className="mb-5 grid gap-4 xl:grid-cols-[1fr_520px_auto] xl:items-center">
          <div>
            <h1 className="text-2xl font-black text-[#07145f]">Official Concern Dashboard</h1>
            <p className="mt-1 text-sm font-semibold text-[#43507f]">Review, validate, and manage community concerns.</p>
          </div>
          <label className="flex h-12 items-center gap-3 rounded-xl border border-[#dfe7f5] bg-white px-4">
            <SearchIcon className="size-4 text-[#43507f]" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search concerns, residents, or locations..."
              className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-[#07145f] outline-none placeholder:text-[#68739c]"
            />
          </label>
          <span className="w-fit rounded-xl border border-[#dfe7f5] bg-white px-4 py-3 text-sm font-extrabold text-[#07145f]">
            {validationLabels.pending}
          </span>
        </div>

        {error ? <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</p> : null}

        <div className="grid gap-4 2xl:grid-cols-[420px_minmax(0,1.15fr)_420px]">
          <section className="rounded-xl border border-[#dfe7f5] bg-white p-4">
            <h2 className="text-base font-black text-[#07145f]">Incoming Concern Queue</h2>
            <div className="scrollbar-hide mt-4 flex gap-2 overflow-x-auto">
              {officialFilters.map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setActiveFilter(filter)}
                  className={cn("shrink-0 rounded-md border px-3 py-2 text-xs font-bold", activeFilter === filter ? "border-[#2447b3] bg-[#eef3ff] text-[#2447b3]" : "border-[#dfe7f5] bg-[#f8fafc] text-[#43507f]")}
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

              <div className="grid gap-4 xl:grid-cols-2">
                <InfoCard title="Resident Details">
                  <p className="text-sm font-black text-[#07145f]">{current.reporter.full_name}</p>
                  <p className="mt-2 text-xs font-semibold text-[#43507f]">Contact details are restricted to account management.</p>
                  <p className="mt-2 text-xs font-semibold text-[#43507f]">{current.address || current.barangay}</p>
                  <span className="mt-3 inline-flex rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">Verified Resident</span>
                </InfoCard>
                <InfoCard title="Location">
                  {mapSrc(current) ? <iframe title="Concern location" src={mapSrc(current)} className="h-36 w-full rounded-lg border border-[#dfe7f5]" /> : <div className="flex h-36 items-center justify-center rounded-lg border border-dashed border-[#dfe7f5] text-xs font-semibold text-[#68739c]">No map pin</div>}
                  <p className="mt-3 text-xs font-semibold text-[#07145f]">{current.address || current.barangay}</p>
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

              <div className="rounded-xl border border-[#dfe7f5] bg-white p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-black text-[#07145f]">Latest Updates & Notes</h3>
                  <span className="text-xs font-extrabold text-[#2447b3]">View full history</span>
                </div>
                <Timeline report={current} onStatusClick={() => undefined} />
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
  const filterRailRef = useRef<HTMLDivElement>(null)
  const filterDragScroll = useHorizontalDragScroll<HTMLDivElement>()
  const hasLoadedRef = useRef(false)
  const [loaded, setLoaded] = useState(false)
  const [activeFilter, setActiveFilter] = useState<string>("All")
  const [search, setSearch] = useState("")
  const [selectedReport, setSelectedReport] = useState<string | null>(null)
  const [reportPage, setReportPage] = useState(1)
  const [timelineExpanded, setTimelineExpanded] = useState(true)
  const [reports, setReports] = useState<Concern[]>([])
  const [error, setError] = useState("")
  const [statusDialogOpen, setStatusDialogOpen] = useState(false)
  const [statusDialogMode, setStatusDialogMode] = useState<StatusDialogMode>("assigned")
  const routeReportId = reportId ?? null
  const isOfficial = user?.role === "barangay_official" || user?.is_staff || user?.is_superuser

  async function loadReports() {
    if (!hasLoadedRef.current) {
      setLoaded(false)
    }
    setError("")
    try {
      setReports(await (isOfficial ? listManagedConcerns() : listMyConcerns()))
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

  if (!loaded)
    return (
      <div className="flex flex-col">
        <Topbar />
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
  const selected =
    reports.find(
      (report) => report.public_id === selectedReport || String(report.id) === selectedReport,
    ) ?? filtered[0]

  function selectReport(report: Concern) {
    setSelectedReport(report.public_id)
    navigate(`/dashboard/reports/${report.public_id}`)
  }

  function updateReport(next: Concern) {
    setReports((current) => current.map((report) => report.id === next.id ? next : report))
    setSelectedReport(next.public_id)
  }

  async function copyTrackingId(report: Concern) {
    await navigator.clipboard?.writeText(report.tracking_id)
    toast.success("Tracking ID copied")
  }

  if (isOfficial) {
    return (
      <OfficialConcernDashboard
        reports={reports}
        selected={reports.find(
          (report) => report.public_id === selectedReport || String(report.id) === selectedReport,
        )}
        activeFilter={activeFilter}
        setActiveFilter={setActiveFilter}
        search={search}
        setSearch={setSearch}
        onSelect={selectReport}
        onUpdated={updateReport}
        onRefresh={loadReports}
        error={error}
      />
    )
  }

  return (
    <div className="flex flex-col">
      <Topbar />

      <div className="flex-1 bg-[#f7f8fc] p-4 md:p-8 xl:p-10">
        <div className="flex items-center justify-between gap-6">
          <div>
            <p className="text-sm font-bold text-[#2447b3]">Marikina Heights</p>
            <h1 className="mt-1 font-heading text-2xl font-extrabold leading-tight text-[#07145f] md:text-3xl">
              {isOfficial ? "Report Management" : "My Reports"}
            </h1>
            <p className="mt-2 max-w-xl text-sm font-semibold leading-6 text-[#43507f]">
              {isOfficial
                ? "Review resident reports, validate details, and update status with accountable notes."
                : "Track the status and updates of the reports you've submitted to the barangay."}
            </p>
          </div>
          <img src="/contents/reports-header.png" alt="" className="hidden h-24 w-40 shrink-0 object-contain lg:block" />
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(420px,0.9fr)_minmax(560px,1fr)]">
          <section className="flex min-w-0 flex-col gap-4">
            {/* Status pills */}
            <div className="relative w-full min-w-0">
              <div ref={filterRailRef} {...filterDragScroll} className="scrollbar-hide min-w-0 cursor-grab touch-pan-x overflow-x-scroll overscroll-x-contain active:cursor-grabbing lg:overflow-visible">
                <div className="flex min-w-max flex-nowrap gap-2 lg:grid lg:min-w-0 lg:grid-cols-5">
                  {filters.map((filter) => (
                    <Button key={filter} data-filter-option type="button" size="sm" variant="outline" aria-pressed={activeFilter === filter} onClick={() => setActiveFilter(filter)}
                      className={cn(
                        "h-9 shrink-0 rounded-md border-[#cbd8ee] px-5 text-xs font-extrabold whitespace-nowrap lg:w-full lg:min-w-0 lg:shrink",
                        activeFilter === filter ? "border-[#ff6a1a] bg-[#ff6a1a] text-white hover:bg-[#ff6a1a]" : "bg-white text-[#07145f] hover:border-[#ff6a1a] hover:text-[#ff6a1a]",
                      )}>
                      {filter}
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}

            <Card className="flex flex-col gap-0 overflow-hidden rounded-lg border-[#dfe7f5] bg-white py-0 shadow-none">
              <div className="flex flex-col">
                {pagedReports.map((report, i) => {
                  const group = statusGroup(report.status)
                  return (
                    <button
                      key={report.id}
                      type="button"
                      onClick={() => selectReport(report)}
                      className={cn(
                        "flex w-full items-center gap-4 bg-white px-4 py-4 text-left transition-colors hover:bg-[#fbfcff]",
                        selected?.id === report.id && "border border-[#ff6a1a] bg-[#fff8f3]",
                        selected?.id !== report.id && i < pagedReports.length - 1 && "border-b border-[#dfe7f5]",
                      )}
                    >
                      <ReportIcon report={report} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-base font-extrabold text-[#07145f]">
                            {report.title}
                          </p>
                        </div>
                        <p className="mt-1 font-mono text-xs font-bold text-[#2447b3]">{report.tracking_id}</p>
                        <p className="mt-1 text-xs font-semibold text-[#43507f]">
                          {categoryLabels[report.category]} <span className="mx-1 text-[#8b96b8]">•</span> {categoryStyles[report.category].sub}
                        </p>
                      </div>
                      <div className="hidden text-right sm:block">
                        <p className="text-xs font-semibold text-[#43507f]">{formatDate(report.created_at)}</p>
                        <span className={cn("mt-2 inline-flex rounded-md border px-3 py-1 text-xs font-bold", statusColors[group])}>
                          {group}
                        </span>
                      </div>
                      <ChevronRightIcon className="size-5 shrink-0 text-[#2447b3]" />
                    </button>
                  )
                })}
                {filtered.length === 0 ? (
                  <div className="flex flex-col items-center justify-center p-8 text-center text-sm text-muted-foreground">
                    <img src="/contents/reports.png" alt="" className="mb-4 h-32 w-auto" aria-hidden="true" />
                    No reports found.
                  </div>
                ) : null}
              </div>

              <div className="flex items-center justify-between border-t border-[#dfe7f5] px-4 py-3">
                <p className="text-xs font-semibold text-[#68739c]">
                  Showing {firstShown}-{lastShown} of {filtered.length} reports
                </p>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setReportPage((value) => Math.max(1, value - 1))}
                    className="flex size-8 items-center justify-center rounded-md bg-white text-xs text-[#8b96b8] disabled:opacity-40"
                    disabled={currentPage <= 1}
                  >
                    <ChevronLeftIcon className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className="flex size-8 items-center justify-center rounded-md border border-[#ff6a1a] bg-white text-xs font-bold text-[#ff6a1a]"
                  >
                    {currentPage}
                  </button>
                  <button
                    type="button"
                    onClick={() => setReportPage((value) => Math.min(totalPages, value + 1))}
                    className="flex size-8 items-center justify-center rounded-md bg-white text-xs text-[#2447b3] disabled:opacity-40"
                    disabled={currentPage >= totalPages}
                  >
                    <ChevronRightIcon className="size-3.5" />
                  </button>
                </div>
              </div>
            </Card>
          </section>

          <aside className="hidden min-w-0 flex-col xl:sticky xl:top-6 xl:flex xl:self-start">
            {selected ? (
              <div className="overflow-hidden rounded-lg border border-[#dfe7f5] bg-white">
                <div className="flex items-start justify-between gap-4 px-5 pb-4 pt-5">
                  <div className="min-w-0">
                    <h2 className="truncate text-xl font-extrabold text-[#07145f]">{selected.title}</h2>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-[#2447b3]">{selected.tracking_id}</span>
                      <button type="button" onClick={() => void copyTrackingId(selected)} className="text-[#2447b3]" aria-label="Copy tracking ID">
                        <CopyIcon className="size-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="flex justify-end gap-2">
                      <span className={cn("rounded-md border px-3 py-1 text-xs font-bold", statusColors[statusGroup(selected.status)])}>
                        {statusGroup(selected.status)}
                      </span>
                      <span className={cn("rounded-md border px-3 py-1 text-xs font-bold", validationColors[selected.validation_status])}>
                        {validationLabels[selected.validation_status]}
                      </span>
                    </div>
                    <p className="mt-2 text-xs font-semibold text-[#43507f]">Submitted on {formatDate(selected.created_at)}</p>
                  </div>
                </div>

                <div className="border-y border-[#dfe7f5] bg-[#f8fbff] px-5 py-3">
                  <p className="text-xs font-extrabold text-[#07145f]">Automated validation</p>
                  <p className="mt-1 text-xs font-semibold leading-5 text-[#43507f]">
                    {selected.validation_summary || validationLabels[selected.validation_status]}
                  </p>
                </div>

                {isOfficial ? (
                  <div className="border-b border-[#dfe7f5] p-5">
                    <OfficialStatusPanel report={selected} onUpdated={updateReport} />
                  </div>
                ) : null}

                <div className="grid border-b border-[#dfe7f5] md:grid-cols-[0.7fr_1.1fr_1fr]">
                  <div className="border-[#dfe7f5] p-5 md:border-r">
                    <p className="text-xs font-extrabold text-[#07145f]">Category</p>
                    <div className="mt-3 flex items-start gap-3">
                      <ReportIcon report={selected} />
                      <div>
                        <p className="text-sm font-bold text-[#07145f]">{categoryLabels[selected.category]}</p>
                        <p className="text-xs font-semibold text-[#43507f]">{categoryStyles[selected.category].sub}</p>
                      </div>
                    </div>
                  </div>

                  <div className="border-[#dfe7f5] p-5 md:border-r">
                    <p className="text-xs font-extrabold text-[#07145f]">Location</p>
                    <div className="mt-3 flex items-start gap-2 text-xs font-semibold text-[#43507f]">
                      <MapPinIcon className="mt-0.5 size-4 shrink-0 text-[#2447b3]" />
                      <span>
                        {selected.latitude && selected.longitude ? `Lat: ${Number(selected.latitude).toFixed(5)}, Lng: ${Number(selected.longitude).toFixed(5)}` : selected.address || selected.barangay}
                        <br />
                        {selected.address || selected.barangay}
                      </span>
                    </div>
                    {mapSrc(selected) ? (
                      <iframe title="Report location map" src={mapSrc(selected)} className="mt-3 h-32 w-full rounded-lg border border-[#dfe7f5]" />
                    ) : (
                      <div className="mt-3 flex h-32 items-center justify-center rounded-lg border border-dashed border-[#dfe7f5] text-xs font-semibold text-[#68739c]">
                        No map location
                      </div>
                    )}
                  </div>

                  <div className="p-5">
                    <p className="text-xs font-extrabold text-[#07145f]">Evidence</p>
                    <p className="mt-2 text-xs font-semibold text-[#43507f]">{selected.media.length} file{selected.media.length === 1 ? "" : "s"}</p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {selected.media.filter((media) => media.mime_type?.startsWith("image/")).slice(0, 2).map((media) => (
                        <AuthenticatedMediaImage key={media.id} src={media.preview_url} alt={media.original_filename} className="h-24 w-full rounded-lg object-cover" />
                      ))}
                      {selected.media.length === 0 ? (
                        <div className="col-span-2 flex h-24 items-center justify-center rounded-lg border border-dashed border-[#dfe7f5] text-xs font-semibold text-[#68739c]">
                          No evidence
                        </div>
                      ) : null}
                    </div>
                    <button type="button" onClick={() => openReportMedia(selected)} className="mt-3 h-9 w-full rounded-lg border border-[#dfe7f5] text-xs font-extrabold text-[#2447b3]">
                      View all evidence
                    </button>
                  </div>
                </div>

                <div className="grid md:grid-cols-[1fr_0.95fr]">
                  <div className="border-[#dfe7f5] p-5 md:border-r">
                    <p className="text-sm font-extrabold text-[#07145f]">Summary</p>
                    <p className="mt-3 text-sm font-semibold leading-6 text-[#43507f]">{selected.description}</p>
                    <div className="mt-4 flex flex-wrap gap-3 text-xs font-semibold text-[#68739c]">
                      <span className="inline-flex items-center gap-1"><ClockIcon className="size-3.5" /> Submitted {daysAgo(selected.created_at)} days ago</span>
                      <span className="inline-flex items-center gap-1"><Share2Icon className="size-3.5" /> {selected.visibility === "community" ? "Public" : "Private"}</span>
                      {selected.visibility === "community" ? <span className="inline-flex items-center gap-1"><ArrowUpIcon className="size-3.5" /> {selected.vote_count} upvotes</span> : null}
                    </div>
                  </div>
                  <div className="p-5">
                    <p className="text-sm font-extrabold text-[#07145f]">Status timeline</p>
                    <Timeline report={selected} onStatusClick={(mode) => { setStatusDialogMode(mode); setStatusDialogOpen(true) }} />
                  </div>
                </div>
                <div className="border-t border-[#dfe7f5] p-5">
                  <ResidentFollowUpPanel report={selected} onRefresh={loadReports} />
                </div>
              </div>
            ) : (
              <Card className="flex h-full min-h-[300px] items-center justify-center">
                <CardContent>
                  <div className="flex flex-col items-center text-center text-sm text-muted-foreground">
                    <img src="/contents/report_details.png" alt="" className="mb-4 h-32 w-auto" aria-hidden="true" />
                    No reports found.
                  </div>
                </CardContent>
              </Card>
            )}
          </aside>
        </div>
      </div>

      {selectedReport && selected ? (
        <div className="fixed inset-0 z-[200] flex min-h-0 flex-col bg-white md:hidden">
          <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[#dfe7f5] bg-white px-3">
            <button
              type="button"
              onClick={() => navigate("/dashboard/reports")}
              className="flex size-11 items-center justify-center rounded-md text-[#07145f] hover:bg-[#eef3ff]"
              aria-label="Back to reports"
            >
              <ChevronLeftIcon className="size-5" />
            </button>
            <div className="min-w-0">
              <p className="truncate text-sm font-extrabold text-[#07145f]">Report details</p>
              <p className="truncate font-mono text-[11px] font-bold text-[#2447b3]">{selected.tracking_id}</p>
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-24 pt-4">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-base font-extrabold text-[#07145f]">{selected.title}</p>
                  <p className="mt-1 font-mono text-xs font-bold text-[#2447b3]">{selected.tracking_id}</p>
                </div>
                <span className={cn("shrink-0 rounded-md border px-3 py-1 text-xs font-bold", statusColors[statusGroup(selected.status)])}>
                  {statusGroup(selected.status)}
                </span>
              </div>

              <div className="rounded-lg border border-[#dfe7f5] bg-[#f8fbff] p-3">
                <p className="text-xs font-extrabold text-[#07145f]">Automated validation</p>
                <p className="mt-1 text-xs font-semibold leading-5 text-[#43507f]">
                  {selected.validation_summary || validationLabels[selected.validation_status]}
                </p>
              </div>

              <div className="mt-4 space-y-4">
                {isOfficial ? <OfficialStatusPanel report={selected} onUpdated={updateReport} /> : null}

                <div className="rounded-lg border border-[#dfe7f5] p-3">
                  <p className="text-xs font-extrabold text-[#07145f]">Category</p>
                  <div className="mt-3 flex items-center gap-3">
                    <ReportIcon report={selected} />
                    <div>
                      <p className="text-sm font-bold text-[#07145f]">{categoryLabels[selected.category]}</p>
                      <p className="text-xs font-semibold text-[#43507f]">{categoryStyles[selected.category].sub}</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-[#dfe7f5] p-3">
                  <p className="text-xs font-extrabold text-[#07145f]">Location</p>
                  <p className="mt-2 flex items-start gap-2 text-xs font-semibold leading-5 text-[#43507f]">
                    <MapPinIcon className="mt-0.5 size-4 shrink-0 text-[#2447b3]" />
                    <span>{selected.address || selected.barangay}</span>
                  </p>
                  {mapSrc(selected) ? (
                    <iframe title="Report location map" src={mapSrc(selected)} className="mt-3 h-36 w-full rounded-lg border border-[#dfe7f5]" />
                  ) : null}
                </div>

                <div className="rounded-lg border border-[#dfe7f5] p-3">
                  <p className="text-xs font-extrabold text-[#07145f]">Evidence</p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {selected.media.filter((media) => media.mime_type?.startsWith("image/")).slice(0, 2).map((media) => (
                        <AuthenticatedMediaImage key={media.id} src={media.preview_url} alt={media.original_filename} className="h-28 w-full rounded-lg object-cover" />
                    ))}
                    {selected.media.length === 0 ? (
                      <div className="col-span-2 flex h-20 items-center justify-center rounded-lg border border-dashed border-[#dfe7f5] text-xs font-semibold text-[#68739c]">
                        No evidence
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-lg border border-[#dfe7f5] p-3">
                  <p className="text-xs font-extrabold text-[#07145f]">Summary</p>
                  <p className="mt-2 text-xs font-semibold leading-5 text-[#43507f]">{selected.description}</p>
                  <div className="mt-3 flex flex-wrap gap-3 text-xs font-semibold text-[#68739c]">
                    <span className="inline-flex items-center gap-1"><CalendarIcon className="size-3.5" /> {formatDate(selected.created_at)}</span>
                    <span className="inline-flex items-center gap-1"><Share2Icon className="size-3.5" /> {selected.visibility === "community" ? "Public" : "Private"}</span>
                    {selected.visibility === "community" ? (
                      <span className="inline-flex items-center gap-1"><ArrowUpIcon className="size-3.5" /> {selected.vote_count}</span>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-lg border border-[#dfe7f5] p-3">
                  <button
                    type="button"
                    onClick={() => setTimelineExpanded(!timelineExpanded)}
                    className="flex w-full items-center justify-between"
                  >
                    <p className="text-xs font-extrabold text-[#07145f]">Status timeline</p>
                    {timelineExpanded ? <ChevronUpIcon className="size-4 text-[#2447b3]" /> : <ChevronDownIcon className="size-4 text-[#2447b3]" />}
                  </button>
                  {timelineExpanded ? (
                    <div className="mt-3">
                      <Timeline report={selected} onStatusClick={(mode) => { setStatusDialogMode(mode); setStatusDialogOpen(true) }} />
                    </div>
                  ) : null}
                </div>

                <ResidentFollowUpPanel report={selected} onRefresh={loadReports} />
              </div>
            </div>
          </div>
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
