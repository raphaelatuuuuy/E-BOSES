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
import {
  Dialog,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
} from "@/features/dashboard/components/dialog"
import { AuthenticatedMediaImage } from "@/features/dashboard/components/authenticated-media"
import type { Concern, ConcernStatus, ConcernStatusEvent, PublicUser } from "@/features/dashboard/api"
import {
  statusModeFromReport,
  type StatusDialogMode,
} from "@/features/dashboard/components/report-status-mode"

const STATUS_STEPS: Array<{ key: ConcernStatus; label: string }> = [
  { key: "submitted", label: "Submitted" },
  { key: "assigned", label: "Assigned" },
  { key: "in_progress", label: "In progress" },
  { key: "resolved", label: "Resolved" },
]

const MODE_CONFIG: Record<
  StatusDialogMode,
  {
    statusLabel: string
    statusClass: string
    title: string
    subtitle: string
  }
> = {
  submitted: {
    statusLabel: "Submitted",
    statusClass: "bg-brand-orange-soft text-brand-orange-strong ring-brand-orange/20",
    title: "Report received",
    subtitle: "Your report was received and is being reviewed by the barangay team.",
  },
  assigned: {
    statusLabel: "Assigned",
    statusClass: "bg-tint text-brand-navy ring-line-tint",
    title: "Report assigned",
    subtitle: "Your report has been assigned to a barangay staff member for action.",
  },
  rejected: {
    statusLabel: "Rejected",
    statusClass: "bg-red-50 text-red-700 ring-red-200",
    title: "Report not approved",
    subtitle: "Your report was reviewed but needs changes or more detail before it can proceed.",
  },
  resolved: {
    statusLabel: "Resolved",
    statusClass: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    title: "Report resolved",
    subtitle: "Your report has been resolved. Here’s a summary of what was done.",
  },
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value))
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

function formatDateTime(value: string) {
  return `${formatDate(value)} · ${formatTime(value)}`
}

function roleLabel(role: string) {
  return role.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
}

function findEvent(report: Concern, status: ConcernStatus): ConcernStatusEvent | undefined {
  return report.status_events.find((event) => event.status === status)
}

function latestEvent(report: Concern, mode: StatusDialogMode): ConcernStatusEvent | undefined {
  const status: ConcernStatus =
    mode === "assigned"
      ? report.status === "assigned"
        ? "assigned"
        : "in_progress"
      : mode === "submitted"
        ? report.status
        : mode
  return (
    [...report.status_events].reverse().find((event) => event.status === status) ??
    report.status_events.at(-1)
  )
}

function pickActor(
  report: Concern,
  mode: StatusDialogMode,
): { actor: PublicUser; time: string } | null {
  const status =
    mode === "assigned"
      ? report.status === "assigned"
        ? "assigned"
        : "in_progress"
      : mode === "rejected"
        ? "rejected"
        : mode === "resolved"
          ? "resolved"
          : null
  if (!status) return null
  const event = findEvent(report, status)
  return event?.actor ? { actor: event.actor, time: event.created_at } : null
}

function activeIndex(report: Concern, mode: StatusDialogMode) {
  if (mode === "rejected") return 0
  if (mode === "submitted") return 0
  return Math.max(
    0,
    STATUS_STEPS.findIndex((step) => step.key === report.status),
  )
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
    <div className="rounded-2xl border border-neutral-200 bg-canvas px-3 py-5 sm:px-5">
      <div className="relative grid grid-cols-4 gap-1 sm:gap-2">
        <div className="absolute left-[12%] right-[12%] top-[18px] h-[3px] rounded-full bg-neutral-200" />
        <div className="absolute left-[12%] right-[12%] top-[18px] h-[3px] rounded-full">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              mode === "rejected" ? "bg-red-500" : "bg-brand-orange",
            )}
            style={{ width: `${(Math.min(currentIdx, 3) / 3) * 100}%` }}
          />
        </div>
        {STATUS_STEPS.map((step, index) => {
          const done = index < currentIdx || (mode === "resolved" && index === currentIdx)
          const current = index === currentIdx && !done
          const rejectedCurrent = mode === "rejected" && current
          const date = stepEvent(report, step.key)

          return (
            <div key={step.key} className="relative z-10 flex flex-col items-center text-center">
              <div
                className={cn(
                  "flex size-9 items-center justify-center rounded-full border-2 text-[13px] font-bold sm:size-10 sm:text-[14px]",
                  done && "border-brand-navy bg-brand-navy text-white",
                  current && !rejectedCurrent && "border-brand-orange bg-brand-orange text-white shadow-[0_0_0_4px_rgba(255,106,26,0.18)]",
                  rejectedCurrent && "border-red-500 bg-red-500 text-white",
                  !done && !current && "border-neutral-200 bg-white text-neutral-400",
                )}
              >
                {done ? (
                  <CheckIcon className="size-4 sm:size-5" strokeWidth={2.75} />
                ) : rejectedCurrent ? (
                  "!"
                ) : (
                  index + 1
                )}
              </div>
              <p
                className={cn(
                  "mt-2.5 text-[12px] font-bold leading-tight sm:text-[13px]",
                  done || current ? "text-neutral-900" : "text-neutral-400",
                )}
              >
                {step.label}
              </p>
              <p className="mt-1 text-[11px] font-medium leading-4 text-neutral-500 sm:text-[12px]">
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
    </div>
  )
}

function ActorCard({
  actor,
  label,
}: {
  actor: { actor: PublicUser; time: string }
  label: string
}) {
  const letter = (
    actor.actor.full_name?.[0] ||
    actor.actor.initials?.[0] ||
    "?"
  ).toUpperCase()

  return (
    <div className="flex items-center gap-3.5 rounded-2xl border border-neutral-200 bg-white px-4 py-3.5">
      <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-tint text-[16px] font-bold text-navy-muted">
        {letter}
      </div>
      <div className="min-w-0">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-neutral-500">
          {label}
        </p>
        <p className="truncate text-[16px] font-semibold text-neutral-900">
          {actor.actor.full_name}
        </p>
        <p className="mt-0.5 text-[13px] font-medium text-neutral-600">
          {roleLabel(actor.actor.role)} · {formatDateTime(actor.time)}
        </p>
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
  const isInProgress = resolvedMode === "assigned" && report.status === "in_progress"
  const statusTitle = isInProgress ? "Report in progress" : config.title
  const statusSubtitle = isInProgress
    ? "The assigned barangay team is currently working on your report."
    : config.subtitle
  const statusLabel = isInProgress ? "In progress" : config.statusLabel
  const statusClass = isInProgress
    ? "bg-tint text-brand-navy ring-line-tint"
    : config.statusClass
  const actor = pickActor(report, resolvedMode)
  const actions = extractActions(report)
  const event = latestEvent(report, resolvedMode)
  const detailText = cleanDetailText(report, event, statusSubtitle)
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
    <Dialog open={open} onClose={handleClose} maxW="max-w-xl" containerClassName="z-[300]">
      {/* Clean Nextdoor-style header — white, bold type, large close */}
      <DialogHeader className="border-b border-neutral-200 bg-white px-5 py-4 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <DialogTitle className="text-[18px] font-bold tracking-tight text-neutral-900 sm:text-[20px]">
            Report status
          </DialogTitle>
          <button
            type="button"
            aria-label="Close report status"
            onClick={handleClose}
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 active:scale-95 sm:size-12"
          >
            <XIcon className="size-6 sm:size-7" strokeWidth={2.25} />
          </button>
        </div>
      </DialogHeader>

      <DialogBody className="space-y-5 bg-white px-5 py-5 sm:space-y-6 sm:px-6 sm:py-6">
        {/* Hero text — no illustration */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h3 className="text-[22px] font-bold leading-tight tracking-tight text-neutral-900 sm:text-[24px]">
              {statusTitle}
            </h3>
            <span
              className={cn(
                "inline-flex shrink-0 items-center rounded-full px-3.5 py-1.5 text-[13px] font-bold ring-1 ring-inset sm:text-[14px]",
                statusClass,
              )}
            >
              {statusLabel}
            </span>
          </div>
          <p className="max-w-xl text-[15px] font-medium leading-6 text-neutral-600 sm:text-[16px] sm:leading-7">
            {statusSubtitle}
          </p>
        </div>

        {/* Tracking number card */}
        <div className="rounded-2xl border border-neutral-200 bg-white px-4 py-4 sm:px-5">
          <p className="text-[12px] font-bold uppercase tracking-wide text-neutral-500 sm:text-[13px]">
            Tracking number
          </p>
          <div className="mt-2 flex items-center gap-2.5">
            <p className="font-mono text-[17px] font-bold tracking-wide text-neutral-900 sm:text-[18px]">
              {report.tracking_id || "EB-XXXXXXXX"}
            </p>
            <button
              type="button"
              onClick={handleCopy}
              aria-label="Copy tracking number"
              className="flex size-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-700 transition-colors hover:bg-neutral-200"
            >
              {copied ? (
                <CheckIcon className="size-5 text-emerald-600" strokeWidth={2.5} />
              ) : (
                <CopyIcon className="size-5" strokeWidth={2} />
              )}
            </button>
          </div>
        </div>

        <StatusLine report={report} mode={resolvedMode} />

        {actor ? (
          <ActorCard
            actor={actor}
            label={
              resolvedMode === "resolved"
                ? "Resolved by"
                : resolvedMode === "rejected"
                  ? "Rejected by"
                  : "Assigned to"
            }
          />
        ) : null}

        {resolvedMode === "rejected" ? (
          <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-red-800 sm:px-5">
            <AlertTriangleIcon className="mt-0.5 size-6 shrink-0 text-red-600" strokeWidth={2} />
            <p className="text-[15px] font-medium leading-6">
              <span className="font-bold">Reason: </span>
              {detailText}
            </p>
          </div>
        ) : showDetail ? (
          <div className="rounded-2xl border border-neutral-200 bg-canvas px-4 py-4 sm:px-5">
            <p className="text-[12px] font-bold uppercase tracking-wide text-neutral-500 sm:text-[13px]">
              {resolvedMode === "resolved"
                ? "Action summary"
                : resolvedMode === "assigned"
                  ? "Current update"
                  : "Review note"}
            </p>
            <p className="mt-2 text-[15px] font-medium leading-6 text-neutral-700 sm:text-[16px]">
              {detailText}
            </p>
          </div>
        ) : null}

        {(resolvedMode === "assigned" || resolvedMode === "resolved") && actions.length > 0 ? (
          <div className="rounded-2xl border border-neutral-200 bg-white px-4 py-4 sm:px-5">
            <p className="text-[12px] font-bold uppercase tracking-wide text-neutral-500 sm:text-[13px]">
              {resolvedMode === "resolved" ? "Actions taken" : "Pending actions"}
            </p>
            <ul className="mt-3 space-y-2.5">
              {actions.map((action, index) => (
                <li
                  key={index}
                  className="flex items-start gap-2.5 text-[15px] font-medium leading-6 text-neutral-700"
                >
                  <span className="mt-2 size-2 shrink-0 rounded-full bg-brand-orange" />
                  {action}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {resolvedMode === "resolved" &&
        report.media.some((media) => media.mime_type?.startsWith("image/")) ? (
          <div className="rounded-2xl border border-neutral-200 bg-white px-4 py-4 sm:px-5">
            <p className="text-[12px] font-bold uppercase tracking-wide text-neutral-500 sm:text-[13px]">
              Photo evidence
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              {report.media.map((media) =>
                media.mime_type?.startsWith("image/") ? (
                  <AuthenticatedMediaImage
                    key={media.id}
                    src={media.preview_url}
                    alt={media.original_filename}
                    className="h-32 w-full rounded-xl border border-neutral-200 object-cover"
                  />
                ) : null,
              )}
            </div>
          </div>
        ) : null}
      </DialogBody>

      <DialogFooter className="border-t border-neutral-200 bg-white px-5 py-4 sm:px-6 sm:py-5">
        {resolvedMode === "rejected" ? (
          <div className="flex w-full flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={handleClose}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-neutral-300 bg-white px-6 text-[15px] font-bold text-neutral-900 transition-colors hover:bg-neutral-50 sm:h-14 sm:px-7 sm:text-[16px]"
            >
              <PencilLineIcon className="size-5" strokeWidth={2.25} />
              Revise report
            </button>
            <button
              type="button"
              onClick={handleTrack}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-brand-orange px-6 text-[15px] font-bold text-white transition-colors hover:bg-brand-orange-strong sm:h-14 sm:px-7 sm:text-[16px]"
            >
              <SearchIcon className="size-5" strokeWidth={2.25} />
              Track report
            </button>
          </div>
        ) : (
          <div className="flex w-full flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={handleClose}
              className="inline-flex h-12 items-center justify-center rounded-full border border-neutral-300 bg-white px-7 text-[15px] font-bold text-neutral-900 transition-colors hover:bg-neutral-50 sm:h-14 sm:text-[16px]"
            >
              Done
            </button>
            <button
              type="button"
              onClick={handleTrack}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-brand-orange px-7 text-[15px] font-bold text-white transition-colors hover:bg-brand-orange-strong sm:h-14 sm:text-[16px]"
            >
              <SearchIcon className="size-5" strokeWidth={2.25} />
              {resolvedMode === "submitted" ? "Track report" : "View report"}
            </button>
          </div>
        )}
      </DialogFooter>
    </Dialog>
  )
}