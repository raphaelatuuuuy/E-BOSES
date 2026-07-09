import { useState } from "react"
import {
  AlertTriangleIcon,
  CheckIcon,
  CopyIcon,
  PencilLineIcon,
  SearchIcon,
  XIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { Badge } from "@workspace/ui/components/badge"
import {
  Dialog,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
} from "@/features/dashboard/components/dialog"
import type { Concern, ConcernStatus, ConcernStatusEvent, PublicUser } from "@/features/dashboard/api"

export type StatusDialogMode = "submitted" | "assigned" | "rejected" | "resolved"

const STATUS_STEPS: Array<{ key: ConcernStatus; label: string }> = [
  { key: "submitted", label: "Submitted" },
  { key: "under_review", label: "In Review" },
  { key: "in_progress", label: "Assigned" },
  { key: "resolved", label: "Resolved" },
]

const MODE_CONFIG: Record<StatusDialogMode, {
  statusLabel: string
  statusColor: string
  image: string
  title: string
  subtitle: string
}> = {
  submitted: {
    statusLabel: "In Review",
    statusColor: "bg-orange-100 text-orange-700 border-orange-200",
    image: "/contents/report-received.png",
    title: "Report was received",
    subtitle: "Your report has been received and is being reviewed by our barangay team.",
  },
  assigned: {
    statusLabel: "Assigned",
    statusColor: "bg-[#eef3ff] text-[#07145f] border-[#cbd8ee]",
    image: "/contents/report-assigned.png",
    title: "Report was assigned",
    subtitle: "Your report has been assigned to a barangay staff member for action.",
  },
  rejected: {
    statusLabel: "Rejected",
    statusColor: "bg-red-100 text-red-700 border-red-200",
    image: "/contents/report-rejected.png",
    title: "Report was not approved",
    subtitle: "Your report was reviewed but needs changes or additional details before it can proceed.",
  },
  resolved: {
    statusLabel: "Resolved",
    statusColor: "bg-green-100 text-green-700 border-green-200",
    image: "/contents/report-resolved.png",
    title: "Report was resolved",
    subtitle: "Your report has been resolved. Below is the summary of action taken.",
  },
}

export function statusModeFromReport(report: Concern | { status: ConcernStatus }): StatusDialogMode {
  if (report.status === "in_progress") return "assigned"
  if (report.status === "rejected") return "rejected"
  if (report.status === "resolved") return "resolved"
  return "submitted"
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value))
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(value))
}

function formatDateTime(value: string) {
  return `${formatDate(value)} ${formatTime(value)}`
}

function roleLabel(role: string) {
  return role.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
}

function findEvent(report: Concern, status: ConcernStatus): ConcernStatusEvent | undefined {
  return report.status_events.find((event) => event.status === status)
}

function latestEvent(report: Concern, mode: StatusDialogMode): ConcernStatusEvent | undefined {
  const status: ConcernStatus = mode === "assigned" ? "in_progress" : mode === "submitted" ? report.status : mode
  return [...report.status_events].reverse().find((event) => event.status === status) ?? report.status_events.at(-1)
}

function pickActor(report: Concern, mode: StatusDialogMode): { actor: PublicUser; time: string } | null {
  const status = mode === "assigned" ? "in_progress" : mode === "rejected" ? "rejected" : mode === "resolved" ? "resolved" : null
  if (!status) return null
  const event = findEvent(report, status)
  return event?.actor ? { actor: event.actor, time: event.created_at } : null
}

function activeIndex(report: Concern, mode: StatusDialogMode) {
  if (mode === "rejected") return 1
  if (mode === "submitted") return 1
  return Math.max(0, STATUS_STEPS.findIndex((step) => step.key === report.status))
}

function stepEvent(report: Concern, key: ConcernStatus) {
  if (key === "submitted") return findEvent(report, "submitted")?.created_at ?? report.created_at
  return findEvent(report, key)?.created_at ?? null
}

function extractActions(report: Concern): string[] {
  const actions = report.status_events
    .map((event) => event.note)
    .filter((note) => note && note !== "Report submitted." && note !== "Your report was received.")
  if (report.update_text && !actions.includes(report.update_text)) actions.push(report.update_text)
  return actions.length > 0 ? actions : ["Report received and logged."]
}

function cleanDetailText(report: Concern, event: ConcernStatusEvent | undefined, fallback: string) {
  const trivialNotes = new Set(["Report submitted.", "Your report was received."])
  if (event?.note && !trivialNotes.has(event.note)) return event.note
  return report.update_text || fallback
}

function StatusLine({ report, mode }: { report: Concern; mode: StatusDialogMode }) {
  const currentIdx = activeIndex(report, mode)

  return (
    <div className="relative grid grid-cols-4 gap-2">
      <div className="absolute left-[10%] right-[10%] top-[13px] h-0.5 bg-[#dfe7f5]" />
      <div className="absolute left-[10%] right-[10%] top-[13px] h-0.5">
        <div
          className={cn("h-full", mode === "rejected" ? "bg-red-500" : "bg-[#07145f]")}
          style={{ width: `${(Math.min(currentIdx, 3) / 3) * 100}%` }}
        />
      </div>
      {STATUS_STEPS.map((step, index) => {
        const done = index < currentIdx || (mode === "resolved" && index === currentIdx)
        const current = index === currentIdx && !done
        const rejectedCurrent = mode === "rejected" && current
        const date = stepEvent(report, step.key) ?? (mode === "submitted" && step.key === "under_review" ? report.created_at : null)

        return (
          <div key={step.key} className="relative z-10 flex flex-col items-center text-center">
            <div
              className={cn(
                "flex size-7 items-center justify-center rounded-full border text-[11px] font-extrabold",
                done && "border-[#07145f] bg-[#07145f] text-white",
                current && !rejectedCurrent && "border-[#ff6a1a] bg-[#ff6a1a] text-white",
                rejectedCurrent && "border-red-500 bg-red-500 text-white",
                !done && !current && "border-[#cbd8ee] bg-white text-[#68739c]",
              )}
            >
              {done ? <CheckIcon className="size-4" /> : rejectedCurrent ? "!" : index + 1}
            </div>
            <p className="mt-2 text-[11px] font-extrabold text-[#07145f]">{step.label}</p>
            <p className="mt-1 text-[10px] font-medium leading-4 text-[#43507f]">
              {date && (done || current) ? (
                <>
                  {formatDate(date)}
                  <br />
                  {formatTime(date)}
                </>
              ) : (
                "Pending"
              )}
            </p>
          </div>
        )
      })}
    </div>
  )
}

function ActorCard({ actor, label }: { actor: { actor: PublicUser; time: string }; label: string }) {
  const avatarKey = actor.actor.avatar
  const initials = actor.actor.initials || actor.actor.full_name.charAt(0)

  return (
    <div className="flex items-center gap-3 rounded-xl border border-[#dfe7f5] bg-white px-4 py-3">
      <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#fff1ea] text-sm font-bold text-[#ff6a1a]">
        {avatarKey ? <img src={`/contents/${avatarKey}.png`} alt="" className="h-full w-full object-cover" /> : initials}
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-bold text-[#68739c]">{label}</p>
        <p className="truncate text-sm font-extrabold text-[#07145f]">{actor.actor.full_name}</p>
        <p className="text-xs font-semibold text-[#43507f]">{roleLabel(actor.actor.role)} - {formatDateTime(actor.time)}</p>
      </div>
    </div>
  )
}

export function ReportStatusDialog({
  open,
  onOpenChange,
  report,
  mode,
  onTrack,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  report: Concern
  mode?: StatusDialogMode
  onTrack?: () => void
}) {
  const [copied, setCopied] = useState(false)
  const resolvedMode = mode ?? statusModeFromReport(report)
  const config = MODE_CONFIG[resolvedMode]
  const actor = pickActor(report, resolvedMode)
  const actions = extractActions(report)
  const event = latestEvent(report, resolvedMode)
  const detailText = cleanDetailText(report, event, config.subtitle)
  const showDetail = resolvedMode !== "submitted"

  function handleCopy() {
    navigator.clipboard.writeText(report.tracking_id).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function handleClose() {
    onOpenChange(false)
  }

  function handleTrack() {
    handleClose()
    onTrack?.()
  }

  return (
    <Dialog open={open} onClose={handleClose} maxW="max-w-2xl" containerClassName="z-[300]">
      <DialogHeader className="border-0 bg-[#07145f] px-4 py-3">
        <div className="flex items-center justify-between">
          <DialogTitle className="text-sm font-extrabold text-white">Report Status</DialogTitle>
          <button
            type="button"
            aria-label="Close report status"
            onClick={handleClose}
            className="flex size-8 items-center justify-center rounded-lg text-white transition-colors hover:bg-white/10"
          >
            <XIcon className="size-5" />
          </button>
        </div>
      </DialogHeader>

      <DialogBody className="space-y-5 bg-white px-6 py-6">
        <div className="grid gap-5 sm:grid-cols-[150px_1fr] sm:items-center">
          <div className="flex justify-center sm:justify-start">
            <img src={config.image} alt="" className="h-36 w-auto object-contain sm:h-40" />
          </div>

          <div className="min-w-0">
            <h3 className="text-lg font-extrabold leading-tight text-[#07145f]">{config.title}</h3>
            <p className="mt-2 max-w-[34rem] text-xs font-semibold leading-5 text-[#07145f]">{config.subtitle}</p>

            <div className="mt-4 border-t border-[#dfe7f5] pt-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-[11px] font-extrabold text-[#07145f]">Tracking Number</p>
                  <div className="mt-2 flex items-center gap-2">
                    <p className="font-mono text-sm font-extrabold tracking-wide text-[#07145f]">{report.tracking_id || "EB-XXXXXXXX"}</p>
                    <button
                      type="button"
                      onClick={handleCopy}
                      aria-label="Copy tracking number"
                      className="flex size-8 items-center justify-center rounded-md bg-[#eef3ff] text-[#07145f] transition-colors hover:bg-[#dfe7f5]"
                    >
                      {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
                    </button>
                  </div>
                </div>
                <Badge className={cn("rounded-md border px-3 py-1.5 text-xs font-bold", config.statusColor)}>
                  {config.statusLabel}
                </Badge>
              </div>
            </div>
          </div>
        </div>

        <StatusLine report={report} mode={resolvedMode} />

        {actor ? (
          <ActorCard
            actor={actor}
            label={resolvedMode === "resolved" ? "Resolved by" : resolvedMode === "rejected" ? "Rejected by" : "Assigned to"}
          />
        ) : null}

        {resolvedMode === "rejected" ? (
          <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-red-700">
            <AlertTriangleIcon className="size-7 shrink-0 fill-red-500 text-red-500" />
            <p className="text-sm font-medium">
              <span className="font-extrabold">Reason: </span>
              {detailText}
            </p>
          </div>
        ) : showDetail ? (
          <div className="rounded-lg border border-[#dfe7f5] bg-white px-5 py-4">
            <p className="text-sm font-medium leading-6 text-[#43507f]">
              <span className="font-extrabold text-[#07145f]">
                {resolvedMode === "resolved" ? "Action summary: " : resolvedMode === "assigned" ? "Current update: " : "Review note: "}
              </span>
              {detailText}
            </p>
          </div>
        ) : null}

        {(resolvedMode === "assigned" || resolvedMode === "resolved") && actions.length > 0 ? (
          <div className="rounded-lg border border-[#dfe7f5] bg-white px-5 py-4">
            <p className="text-sm font-extrabold text-[#07145f]">
              {resolvedMode === "resolved" ? "Actions Taken" : "Pending Actions"}
            </p>
            <ul className="mt-2 space-y-1.5">
              {actions.map((action, index) => (
                <li key={index} className="flex items-start gap-2 text-sm font-medium text-[#43507f]">
                  <span className="mt-2 size-1.5 rounded-full bg-[#ff6a1a]" />
                  {action}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {resolvedMode === "resolved" && report.media.some((media) => media.mime_type?.startsWith("image/")) ? (
          <div className="rounded-lg border border-[#dfe7f5] bg-white px-5 py-4">
            <p className="text-sm font-extrabold text-[#07145f]">Photo Evidence</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {report.media.map((media) =>
                media.mime_type?.startsWith("image/") ? (
                  <img
                    key={media.id}
                    src={media.preview_url}
                    alt={media.original_filename}
                    className="h-28 w-full rounded-lg border border-[#dfe7f5] object-cover"
                  />
                ) : null,
              )}
            </div>
          </div>
        ) : null}
      </DialogBody>

      <DialogFooter className="border-0 bg-white px-6 pb-6 pt-0">
        {resolvedMode === "rejected" ? (
          <div className="flex w-full flex-col justify-center gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={handleClose}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-[#07145f] bg-white px-8 text-sm font-extrabold text-[#07145f] transition-colors hover:bg-[#eef3ff]"
            >
              <PencilLineIcon className="size-4" />
              Revise Report
            </button>
            <button
              type="button"
              onClick={handleTrack}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#ff5b14] px-8 text-sm font-extrabold text-white transition-colors hover:bg-[#e65011]"
            >
              <SearchIcon className="size-4" />
              Track Report
            </button>
          </div>
        ) : (
          <div className="flex w-full flex-col justify-center gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={handleClose}
              className="inline-flex h-11 items-center justify-center rounded-lg border border-[#07145f] bg-white px-8 text-sm font-extrabold text-[#07145f] transition-colors hover:bg-[#eef3ff]"
            >
              Done
            </button>
            <button
              type="button"
              onClick={handleTrack}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#ff5b14] px-8 text-sm font-extrabold text-white transition-colors hover:bg-[#e65011]"
            >
              <SearchIcon className="size-4" />
              {resolvedMode === "submitted" ? "Track Report" : "View Report"}
            </button>
          </div>
        )}
      </DialogFooter>
    </Dialog>
  )
}
