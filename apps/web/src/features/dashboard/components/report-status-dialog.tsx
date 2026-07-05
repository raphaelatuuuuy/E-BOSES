import {
  CheckCircleIcon,
  XCircleIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogCloseButton,
} from "@/features/dashboard/components/dialog"
import type { Concern, ConcernStatusEvent, PublicUser } from "@/features/dashboard/api"

export type StatusDialogMode = "assigned" | "rejected" | "resolved"

type Mode = StatusDialogMode

const MODE_CONFIG: Record<Mode, {
  headerBg: string
  statusLabel: string
  statusColor: string
  image: string
  title: string
  subtitle: string
}> = {
  assigned: {
    headerBg: "bg-blue-600",
    statusLabel: "Assigned",
    statusColor: "bg-blue-100 text-blue-700 border-blue-200",
    image: "/contents/report-assigned.png",
    title: "Report Assigned",
    subtitle: "Your report has been assigned to a barangay official for review and action.",
  },
  rejected: {
    headerBg: "bg-red-600",
    statusLabel: "Rejected",
    statusColor: "bg-red-100 text-red-700 border-red-200",
    image: "/contents/report-rejected.png",
    title: "Report Rejected",
    subtitle: "Your report was not accepted for further action. Please review the reason below.",
  },
  resolved: {
    headerBg: "bg-green-600",
    statusLabel: "Resolved",
    statusColor: "bg-green-100 text-green-700 border-green-200",
    image: "/contents/report-resolved.png",
    title: "Report Resolved",
    subtitle: "Your report has been resolved. Below is a summary of the actions taken.",
  },
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

function roleLabel(role: string) {
  return role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Find the first status event matching the given status. */
function findEvent(report: Concern, status: string): ConcernStatusEvent | undefined {
  return report.status_events.find((e) => e.status === status)
}

/** Pick the most relevant event for the dialog mode. */
function pickActor(report: Concern, mode: Mode): { actor: PublicUser; time: string } | null {
  if (mode === "assigned") {
    // in_progress event = the barangay official assigned
    const ev = findEvent(report, "in_progress")
    if (ev?.actor) return { actor: ev.actor, time: ev.created_at }
  }
  if (mode === "rejected") {
    const ev = findEvent(report, "rejected")
    if (ev?.actor) return { actor: ev.actor, time: ev.created_at }
  }
  if (mode === "resolved") {
    const ev = findEvent(report, "resolved")
    if (ev?.actor) return { actor: ev.actor, time: ev.created_at }
  }
  return null
}

function extractActions(report: Concern): string[] {
  const actions: string[] = []
  for (const ev of report.status_events) {
    if (ev.note && ev.note !== "Report submitted." && ev.note !== "Your report was received.") {
      actions.push(ev.note)
    }
  }
  if (report.update_text && !actions.includes(report.update_text)) {
    actions.push(report.update_text)
  }
  return actions.length > 0 ? actions : ["Report received and logged."]
}

function OfficialCard({
  actor,
  time,
}: {
  actor: { actor: PublicUser; time: string }
}) {
  const avatarKey =
    actor.actor.avatar ||
    (actor.actor.gender && actor.actor.gender !== "prefer_not_to_say" && actor.actor.date_of_birth
      ? (() => {
          const age =
            new Date().getFullYear() - new Date(actor.actor.date_of_birth!).getFullYear()
          const bucket = age >= 55 ? "senior" : age >= 30 ? "middleaged" : "young"
          const icon = actor.actor.gender === "male" ? "man" : "woman"
          return `${bucket}-${icon}`
        })()
      : "")
  const initials = actor.actor.initials || actor.actor.full_name.charAt(0)

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-sm font-bold text-primary">
        {avatarKey ? (
          <img src={`/contents/${avatarKey}.png`} alt="" className="h-full w-full scale-125 object-cover" />
        ) : (
          initials
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">{actor.actor.full_name}</p>
        <p className="text-xs text-muted-foreground">{roleLabel(actor.actor.role)}</p>
        <p className="text-xs text-muted-foreground">{formatDateTime(actor.time)}</p>
      </div>
    </div>
  )
}

export function ReportStatusDialog({
  open,
  onOpenChange,
  report,
  mode,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  report: Concern
  mode: StatusDialogMode
}) {
  const config = MODE_CONFIG[mode]
  const assignedActor = pickActor(report, mode)
  const actions = extractActions(report)
  const trackingUrl = `${window.location.origin}/dashboard?tab=reports&report=${report.id}`

  function handleClose() {
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onClose={handleClose} maxW="max-w-xl" containerClassName="z-[300]">
      {/* Colored header */}
      <DialogHeader className={cn("border-0", config.headerBg)}>
        <div className="flex items-center justify-center">
          <DialogTitle className="text-white">
            <span className="sr-only">{config.statusLabel}</span>
          </DialogTitle>
          <div className="absolute right-4 top-4">
            <DialogCloseButton onClose={handleClose} />
          </div>
        </div>
      </DialogHeader>

      <DialogBody className="flex flex-col items-center px-6 py-6 space-y-6">
        {/* Hero image + title */}
        <div className="flex flex-col items-center gap-3">
          <img src={config.image} alt="" className="h-40 w-auto" />
          <h3 className="text-xl font-bold text-foreground text-center">{config.title}</h3>
          <p className="text-sm text-muted-foreground text-center max-w-sm">{config.subtitle}</p>
        </div>

        {/* Status badge */}
        <Badge className={cn("rounded-full border px-3 py-1 text-xs font-semibold", config.statusColor)}>
          {config.statusLabel}
        </Badge>

        {/* Official card */}
        {assignedActor ? (
          <div className="w-full space-y-3">
            <OfficialCard actor={assignedActor} />
          </div>
        ) : null}

        {/* --- REJECTED: reason card --- */}
        {mode === "rejected" && (
          <div className="w-full space-y-2 rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <XCircleIcon className="size-4 shrink-0 text-red-500" />
              <p className="text-sm font-semibold text-foreground">Reason for Rejection</p>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {report.update_text ||
               report.status_events.find((e) => e.status === "rejected")?.note ||
               "The report does not meet the required criteria for action at this time."}
            </p>
          </div>
        )}

        {/* --- ASSIGNED / RESOLVED: actions taken --- */}
        {(mode === "assigned" || mode === "resolved") && actions.length > 0 && (
          <div className="w-full space-y-2">
            <div className="flex items-center gap-2">
              <CheckCircleIcon className="size-4 shrink-0 text-green-500" />
              <p className="text-sm font-semibold text-foreground">
                {mode === "resolved" ? "Actions Taken" : "Pending Actions"}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <ul className="flex flex-col gap-2">
                {actions.map((action, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                    <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-primary" />
                    {action}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* --- RESOLVED: evidence images --- */}
        {mode === "resolved" && report.media.length > 0 && (
          <div className="w-full space-y-2">
            <p className="text-sm font-semibold text-foreground">Photo Evidence</p>
            <div className="grid grid-cols-2 gap-2">
              {report.media.map((m) =>
                m.mime_type?.startsWith("image/") ? (
                  <img
                    key={m.id}
                    src={m.preview_url}
                    alt={m.original_filename}
                    className="h-28 w-full rounded-lg border border-border object-cover"
                  />
                ) : null,
              )}
            </div>
          </div>
        )}
      </DialogBody>

      {/* Footer buttons */}
      <DialogFooter>
        <div className={cn("flex w-full gap-3", mode === "rejected" ? "flex-row" : "flex-col-reverse sm:flex-row")}>
          {mode === "rejected" ? (
            <>
              <Button type="button" variant="outline" className="flex-1" onClick={handleClose}>
                Later
              </Button>
              <Button type="button" className="flex-1" onClick={() => {
                handleClose()
                // navigate to edit/create-report with prefill
              }}>
                Revise &amp; Resubmit
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" className="sm:flex-1" onClick={handleClose}>
                Back
              </Button>
              <Button type="button" className="sm:flex-1" onClick={() => {
                handleClose()
                window.open(trackingUrl, "_blank")
              }}>
                View Report
              </Button>
            </>
          )}
        </div>
      </DialogFooter>
    </Dialog>
  )
}
