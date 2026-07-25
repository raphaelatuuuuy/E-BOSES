import { type ReactNode } from "react"
import { BellRinging as BellRingIcon, Clock, FileImage, Users } from "@phosphor-icons/react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { AuthenticatedMediaImage, openAuthenticatedMedia } from "@/features/dashboard/components/authenticated-media"
import type { EmergencyAlert } from "@/features/dashboard/emergency-api"
import type { LiveMapPerson } from "@/features/dashboard/api"
import { formatTime } from "./alerts-map-detail-panels.utils"

export function InfoRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 text-xs font-semibold text-[#43507f]">
      <span className="mt-0.5 text-[#2447b3]">{icon}</span>
      <span className="min-w-24 text-[#68739c]">{label}</span>
      <span className="flex-1 font-bold text-[#07145f]">{value}</span>
    </div>
  )
}

export function ResponseTeamCard({
  assignments,
  activeTeamAssignments,
  onRemove,
}: {
  assignments: EmergencyAlert["assignments"]
  activeTeamAssignments: EmergencyAlert["assignments"]
  onRemove: (assignment: EmergencyAlert["assignments"][number]) => void
}) {
  const inactiveAssignmentStatuses = new Set(["cancelled", "declined", "resolved"])
  return (
    <div className="rounded-xl border border-[#dfe7f5] bg-[#f8fafc] p-3">
      <div className="flex items-center gap-2 text-[11px] font-black uppercase text-[#68739c]">
        <Users className="size-4 text-[#2447b3]" /> Response team
      </div>
      <div className="mt-2 grid gap-2">
        {assignments.length ? assignments.map((assignment) => {
          const active = !inactiveAssignmentStatuses.has(assignment.status)
          return (
          <div key={assignment.id} className={cn("flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2", !active && "opacity-60")}>
            <div className="min-w-0">
              <p className="truncate text-xs font-black text-[#07145f]">{assignment.responder.full_name}</p>
              <p className="text-[11px] font-semibold text-[#68739c]">{assignment.responder.responder_unit || "Responder"} · assigned {formatTime(assignment.assigned_at)}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <span className="rounded-md bg-[#e8efff] px-2 py-1 text-[10px] font-black capitalize text-[#2447b3]">{assignment.status.replace(/_/g, " ")}</span>
              {active && activeTeamAssignments.length > 1 ? (
                <button
                  type="button"
                  onClick={() => onRemove(assignment)}
                  className="rounded-md px-2 py-1 text-[10px] font-black text-red-700 hover:bg-red-50"
                >
                  Remove
                </button>
              ) : null}
            </div>
          </div>
        )}) : (
          <p className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-[#68739c]">No responder assignment has been recorded.</p>
        )}
      </div>
    </div>
  )
}

export function IncidentTimelineCard({ statusEvents }: { statusEvents: EmergencyAlert["status_events"] }) {
  return (
    <div className="rounded-xl border border-[#dfe7f5] bg-white p-3">
      <div className="flex items-center gap-2 text-[11px] font-black uppercase text-[#68739c]">
        <Clock className="size-4 text-[#2447b3]" /> Incident timeline
      </div>
      <div className="mt-3 grid gap-0">
        {statusEvents.length ? statusEvents.slice(-6).map((event, index, events) => (
          <div key={event.id} className="relative grid grid-cols-[18px_1fr] gap-2 pb-3 last:pb-0">
            {index < events.length - 1 ? <span className="absolute left-[6px] top-3 h-full w-px bg-[#dfe7f5]" /> : null}
            <span className="relative mt-1 size-3 rounded-full border-2 border-white bg-[#2447b3] ring-1 ring-[#b9c9f4]" />
            <div>
              <div className="flex flex-wrap items-center justify-between gap-1">
                <p className="text-xs font-black capitalize text-[#07145f]">{event.status.replace(/_/g, " ")}</p>
                <time className="text-[10px] font-semibold text-[#68739c]">{formatTime(event.created_at)}</time>
              </div>
              <p className="mt-0.5 text-[11px] font-semibold leading-4 text-[#68739c]">{event.note || `Status updated by ${event.actor?.full_name || "system"}.`}</p>
            </div>
          </div>
        )) : (
          <p className="text-xs font-semibold text-[#68739c]">No lifecycle events recorded.</p>
        )}
      </div>
    </div>
  )
}

export function EvidenceCard({ media }: { media: EmergencyAlert["media"] }) {
  if (!media.length) return null
  return (
    <div className="rounded-xl border border-[#dfe7f5] bg-white p-3">
      <div className="flex items-center gap-2 text-[11px] font-black uppercase text-[#68739c]">
        <FileImage className="size-4 text-[#2447b3]" /> Protected evidence
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {media.map((item) => (
          <button key={item.id} type="button" onClick={() => void openAuthenticatedMedia(item.raw_url, item.original_filename)} className="overflow-hidden rounded-lg border border-[#dfe7f5] bg-[#f8fafc] text-left">
            {item.mime_type.startsWith("image/") ? (
              <AuthenticatedMediaImage src={item.preview_url || item.raw_url} alt={item.original_filename} className="h-24 w-full object-cover" />
            ) : (
              <span className="flex h-24 items-center justify-center px-2 text-center text-xs font-bold text-[#2447b3]">Open video evidence</span>
            )}
            <span className="block truncate px-2 py-2 text-[10px] font-bold text-[#43507f]">{item.original_filename}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export function EscalationCard({ escalations }: { escalations: EmergencyAlert["escalations"] }) {
  if (!escalations.length) return null
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
      <p className="text-[11px] font-black uppercase text-amber-800">Escalation history</p>
      <div className="mt-2 grid gap-2">
        {escalations.map((escalation) => (
          <div key={escalation.id} className="text-xs font-semibold leading-5 text-amber-950">
            <span className="font-black">{formatTime(escalation.created_at)}</span> · {escalation.reason}
            {escalation.escalated_to ? ` · Routed to ${escalation.escalated_to.full_name}` : ""}
          </div>
        ))}
      </div>
    </div>
  )
}

export function AssignResponderCard({
  responders,
  activeTeamAssignments,
  assigningResponderId,
  onAssign,
  onReplace,
}: {
  responders: LiveMapPerson[]
  activeTeamAssignments: EmergencyAlert["assignments"]
  assigningResponderId: number | null
  onAssign: (responder: LiveMapPerson) => void
  onReplace: (responder: LiveMapPerson) => void
}) {
  return (
    <div className="rounded-xl border border-[#dfe7f5] bg-[#f8fafc] p-3">
      <p className="text-[11px] font-black uppercase text-[#68739c]">Assign responder</p>
      <div className="mt-2 grid gap-2">
        {responders.length === 0 ? (
          <p className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-[#68739c]">
            No on-duty responders with live status.
          </p>
        ) : (
          responders.slice(0, 4).map((responder) => {
            const alreadyActive = activeTeamAssignments.some((assignment) => assignment.responder.id === responder.id)
            return (
            <div
              key={responder.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-left text-xs font-bold text-[#07145f]"
            >
              <span className="min-w-0">
                <span className="block truncate">{responder.full_name}</span>
                <span className="block text-[11px] font-semibold text-[#68739c]">
                  {responder.responder_unit || "responder"} · on duty
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  disabled={assigningResponderId !== null || alreadyActive}
                  onClick={() => onAssign(responder)}
                  className="rounded-md px-2 py-1 text-[#ff6a1a] hover:bg-orange-50 disabled:text-neutral-400"
                >
                  {assigningResponderId === responder.id ? "Adding" : alreadyActive ? "Assigned" : "Add"}
                </button>
                {!alreadyActive && activeTeamAssignments.length ? (
                  <button
                    type="button"
                    disabled={assigningResponderId !== null}
                    onClick={() => onReplace(responder)}
                    className="rounded-md px-2 py-1 text-[#2447b3] hover:bg-[#e8efff]"
                  >
                    Replace
                  </button>
                ) : null}
              </span>
            </div>
          )})
        )}
      </div>
    </div>
  )
}

export function LoadingState() {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-[#dfe7f5] bg-[#f8fafc] px-3 py-3 text-xs font-bold text-[#43507f]">
      <span className="inline-block size-4 animate-spin rounded-full border-2 border-[#2447b3] border-t-transparent" />
      Loading complete incident record…
    </div>
  )
}

export function DetailErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-3">
      <p className="text-xs font-bold text-red-800">{message}</p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry} className="mt-2 border-red-200 bg-white text-red-700">
        Retry details
      </Button>
    </div>
  )
}

export function TeamActionConfirmDialog({
  teamAction,
  teamReason,
  teamBusy,
  emergencyId,
  onReasonChange,
  onKeep,
  onConfirm,
}: {
  teamAction: { kind: "replace"; responder: LiveMapPerson } | { kind: "remove"; assignmentId: number; responderName: string } | null
  teamReason: string
  teamBusy: boolean
  emergencyId: number
  onReasonChange: (value: string) => void
  onKeep: () => void
  onConfirm: () => void
}) {
  if (!teamAction) return null
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
      <p className="text-xs font-black text-amber-950">
        {teamAction.kind === "replace"
          ? `Replace the active response team with ${teamAction.responder.full_name}?`
          : `Remove ${teamAction.responderName} from this response?`}
      </p>
      <label className="mt-2 block text-[11px] font-bold text-amber-900" htmlFor={`team-reason-${emergencyId}`}>
        Operational reason
      </label>
      <textarea
        id={`team-reason-${emergencyId}`}
        value={teamReason}
        onChange={(e) => onReasonChange(e.target.value)}
        maxLength={255}
        rows={2}
        placeholder="Explain why this assignment is changing"
        className="mt-1 w-full resize-none rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs text-[#07145f] outline-none focus:border-[#ff6a1a]"
      />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Button type="button" size="sm" variant="outline" disabled={teamBusy} onClick={onKeep}>
          Keep team
        </Button>
        <Button type="button" size="sm" disabled={teamBusy || teamReason.trim().length < 5} onClick={onConfirm} className="bg-[#07145f] text-white hover:bg-[#0b1b75]">
          {teamBusy ? "Updating" : "Confirm change"}
        </Button>
      </div>
    </div>
  )
}

export function WitnessNotificationCard({ summary }: { summary: EmergencyAlert["witness_notification_summary"] | null }) {
  return (
    <div className="rounded-xl border border-[#dfe7f5] bg-[#f8fafc] p-3">
      <div className="flex items-center gap-2 text-[11px] font-black uppercase text-[#68739c]">
        <BellRingIcon className="size-4 text-[#2447b3]" /> Nearby resident notification
      </div>
      {summary?.triggered ? (
        <div className="mt-2 grid gap-1 text-xs font-semibold leading-5 text-[#43507f]">
          <p>Selected <strong>{summary.recipient_count}</strong> verified nearby resident{summary.recipient_count === 1 ? "" : "s"}; <strong>{summary.in_app_delivered_count}</strong> received an in-app notice and <strong>{summary.read_count}</strong> opened it.</p>
          <p><strong>{summary.push_delivered_count}</strong> browser push deliver{summary.push_delivered_count === 1 ? "y" : "ies"}{summary.push_failure_count ? `; ${summary.push_failure_count} push attempt${summary.push_failure_count === 1 ? "" : "s"} failed` : ""}.</p>
        </div>
      ) : (
        <p className="mt-2 text-xs font-semibold text-[#68739c]">No nearby-resident safety notification was triggered.</p>
      )}
    </div>
  )
}
