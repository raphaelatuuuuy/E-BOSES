import type { ReactNode } from "react"

import type {
  Concern,
  ConcernAssignment,
  ConcernStatusEvent,
  ConcernResolutionEvidence,
  ConcernTimelineRecord,
  PublicUser,
} from "@/features/dashboard/api"
import { AuthenticatedMediaImage } from "@/features/dashboard/components/authenticated-media"
import {
  formatDate,
  formatTime,
} from "@/features/dashboard/components/concerns/concern-display"
import { streetOnly } from "@/features/dashboard/lib/location-text"
import {
  toMediaPreviewItem,
  type MediaPreviewItem,
} from "@/features/dashboard/lib/authenticated-media"
import { isResolvedRecord } from "@/features/dashboard/components/alerts-map/lib"

export type ConcernTimelineState = "done" | "current" | "pending" | "cancelled"
export type ConcernTimelineAccent =
  | "neutral"
  | "brand"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "cyan"
  | "violet"
export type ConcernTimelineIcon =
  | "inbox"
  | "clock"
  | "network"
  | "hardhat"
  | "check"
  | "x"
  | "scale"
  | "mail"
  | "message"
  | "question"
  | "shield"
  | "rotate"

export type ConcernTimelineEntry = {
  id: string
  badge: string
  time: string | null
  content: ReactNode
  state?: ConcernTimelineState
  accent?: ConcernTimelineAccent
  icon?: ConcernTimelineIcon
  actor?: string | null
  actorUser?: PublicUser | null
}

const STATUS_META: Record<
  string,
  { label: string; accent: ConcernTimelineAccent; icon: ConcernTimelineIcon }
> = {
  submitted: { label: "Received", accent: "info", icon: "inbox" },
  under_review: { label: "Being handled", accent: "neutral", icon: "clock" },
  assigned: { label: "Assigned", accent: "info", icon: "network" },
  in_progress: { label: "Being handled", accent: "warning", icon: "clock" },
  resolved: { label: "Resolved", accent: "success", icon: "check" },
  rejected: { label: "Not accepted", accent: "danger", icon: "x" },
  appealed: { label: "Appeal filed", accent: "violet", icon: "scale" },
}

const CLARIFICATION_REPLY_NOTE = "Resident replied to clarification request."

export function formatTimelineTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

export function concernTimelineStatusLabel(status: string) {
  return (
    STATUS_META[status]?.label ??
    status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
  )
}

export function concernTimelineStatusAccent(
  status: string
): ConcernTimelineAccent {
  return STATUS_META[status]?.accent ?? "neutral"
}

const ACCENT_TEXT: Record<ConcernTimelineAccent, string> = {
  neutral: "text-neutral-500",
  brand: "text-brand-orange-strong",
  success: "text-status-closed",
  warning: "text-severity-moderate",
  danger: "text-severity-critical",
  info: "text-status-active",
  cyan: "text-ice",
  violet: "text-chart-3",
}

export function concernTimelineStatusTextClass(status: string) {
  return ACCENT_TEXT[concernTimelineStatusAccent(status)]
}

function actorLabel(
  actor: PublicUser | null,
  fallback: PublicUser | null = null,
  emptyLabel = "System"
): string {
  const person = actor?.full_name ? actor : fallback
  if (!person?.full_name) return emptyLabel
  return `${person.full_name} · ${person.position?.trim() || roleLabelOf(person)}`
}

function roleLabelOf(actor: PublicUser) {
  const roleLabels: Record<string, string> = {
    barangay_official: "Barangay Official",
    first_responder: "First Responder",
    admin: "Administrator",
    resident: "Resident",
  }
  return roleLabels[actor.role] || "User"
}

type TimelineAvatarMember = Pick<
  PublicUser,
  "id" | "full_name" | "initials" | "role"
>

function memberAvatarGroup(members: TimelineAvatarMember[], large = false) {
  if (!members.length) return null
  const visible = members.slice(0, large ? 3 : 4)
  const extra = members.length - visible.length
  return (
    <div
      className="flex shrink-0 items-center pl-2"
      aria-label={`${members.length} assigned member${members.length === 1 ? "" : "s"}`}
    >
      {visible.map((member, index) => (
        <span
          key={member.id}
          className={`inline-flex items-center justify-center rounded-full border-2 border-white bg-slate-soft font-bold text-navy-muted ${large ? "size-8 text-[10px]" : "size-6 text-[8px]"} ${index ? (large ? "-ml-2" : "-ml-1.5") : ""}`}
          title={`${member.full_name} · ${member.role.replace(/_/g, " ")}`}
        >
          {(member.initials || member.full_name || "U").charAt(0).toUpperCase()}
        </span>
      ))}
      {extra > 0 ? (
        <span className={large ? "-ml-2 inline-flex size-8 items-center justify-center rounded-full border-2 border-white bg-neutral-100 text-[10px] font-semibold text-neutral-500" : "-ml-1.5 inline-flex size-6 items-center justify-center rounded-full border-2 border-white bg-neutral-100 text-[8px] font-semibold text-neutral-500"}>
          +{extra}
        </span>
      ) : null}
    </div>
  )
}

function noteBlock(
  text: string,
  members: TimelineAvatarMember[] = [],
  unitBadge = "",
  large = false
) {
  return (
    <div className={`mt-1 flex items-center justify-between gap-2 rounded-[10px] bg-neutral-100 px-2.5 py-1.5 leading-relaxed whitespace-pre-wrap text-neutral-600 ${large ? "text-[13px]" : "text-[11px]"}`}>
      <span className="min-w-0">{text}</span>
      {unitBadge && !large ? (
        <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-soft text-[7px] font-bold text-navy-muted">
          {unitBadge}
        </span>
      ) : !unitBadge ? (
        memberAvatarGroup(members, large)
      ) : null}
    </div>
  )
}

/** Resolved rows: the resolver's avatars lead the statement on the left and
 * any proof photos sit inside the same container, under the text. */
function resolvedNoteBlock({
  text,
  members,
  proof,
  proofPreview,
  onOpenProof,
  large = false,
}: {
  text: string
  members: TimelineAvatarMember[]
  proof: ConcernResolutionEvidence[]
  proofPreview: MediaPreviewItem[]
  onOpenProof?: (items: MediaPreviewItem[], index: number) => void
  large?: boolean
}) {
  return (
    <div className={`mt-1 rounded-[10px] bg-neutral-100 px-2.5 py-1.5 leading-relaxed text-neutral-600 ${large ? "text-[13px]" : "text-[11px]"}`}>
      <div className="flex items-center gap-2">
        {memberAvatarGroup(members, large) ?? (
          <span className="shrink-0" aria-hidden />
        )}
        <span className="min-w-0 flex-1">{text}</span>
      </div>
      {proof.length ? (
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          {proof.map((item, proofIndex) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onOpenProof?.(proofPreview, proofIndex)}
              className="overflow-hidden rounded-control border border-card-line bg-canvas text-left"
              title={item.original_filename}
            >
              <AuthenticatedMediaImage
                src={item.preview_url || item.raw_url}
                alt={item.original_filename}
                className="h-24 w-full object-cover"
              />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function assignmentUnitBadge(
  unit: { short_name?: string; code?: string } | null | undefined
) {
  return (unit?.short_name || unit?.code || "").trim()
}

function assignmentMembersFor(
  event: ConcernStatusEvent,
  report: Concern,
  assignmentEntries: ConcernTimelineRecord[]
) {
  const eventTime = new Date(event.created_at).getTime()
  const matchingEntry = assignmentEntries
    .map((entry) => ({
      entry,
      distance: Math.abs(new Date(entry.created_at).getTime() - eventTime),
    }))
    .sort((a, b) => a.distance - b.distance)
    .find(({ distance }) => distance <= 30_000)?.entry
  const metadataIds = matchingEntry?.metadata.assignee_ids
  const ids = Array.isArray(metadataIds)
    ? metadataIds.filter((id): id is number => typeof id === "number")
    : typeof matchingEntry?.metadata.assignee_id === "number"
      ? [matchingEntry.metadata.assignee_id]
      : []
  if (ids.length) {
    return (report.assignments ?? [])
      .filter(
        (assignment) =>
          assignment.assignee && ids.includes(assignment.assignee.id)
      )
      .map((assignment) => assignment.assignee!)
  }
  const departmentId =
    typeof matchingEntry?.metadata.department_id === "number"
      ? matchingEntry.metadata.department_id
      : null
  return (report.assignments ?? [])
    .filter(
      (assignment) =>
        assignment.assignee &&
        (!departmentId || assignment.department?.id === departmentId)
    )
    .map((assignment) => assignment.assignee!)
    .filter(
      (member, index, list) =>
        list.findIndex((item) => item.id === member.id) === index
    )
}

function assignmentUnitName(
  event: ConcernStatusEvent,
  report: Concern,
  assignmentEntries: ConcernTimelineRecord[],
  usedAssignmentIds: Set<number>
) {
  const eventTime = new Date(event.created_at).getTime()
  const matchingEntry = assignmentEntries
    .filter((entry) => !usedAssignmentIds.has(entry.id))
    .map((entry) => ({
      entry,
      distance: Math.abs(new Date(entry.created_at).getTime() - eventTime),
    }))
    .sort((a, b) => a.distance - b.distance)
    .find(({ distance }) => distance <= 30_000)?.entry

  if (matchingEntry) {
    usedAssignmentIds.add(matchingEntry.id)
    const metadataName = matchingEntry.metadata.department_name
    if (typeof metadataName === "string" && metadataName.trim())
      return metadataName.trim()
    const messageName = matchingEntry.message
      .match(/^(?:Reassigned|Assigned) to\\s+(.+?)[.]?$/i)?.[1]
      ?.trim()
    if (messageName) return messageName
  }

  return report.assigned_department?.name ?? ""
}

export function buildConcernTimelineEntries(
  report: Concern,
  onOpenProof?: (items: MediaPreviewItem[], index: number) => void,
  viewer?: PublicUser | null,
  large = false
): ConcernTimelineEntry[] {
  const events = [...(report.status_events ?? [])].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  )
  const canShowAssignment = report.validation_status === "accepted"
  // “Received” is an intake state, not a resident-facing progress update.
  // The activity stream always starts with the unit that owns the report.
  const lifecycleEvents = events.filter(
    (event) =>
      event.status !== "submitted" &&
      (canShowAssignment || event.status !== "assigned")
  )
  const recordedViewers = (report.viewers ?? []).filter(
    (member) => member.role !== "resident"
  )
  const hasHandlingEvent = lifecycleEvents.some(
    (event) => event.status === "under_review" || event.status === "in_progress"
  )
  // A handling row is meaningful only after a real status transition or a
  // recorded official view. Do not manufacture one for every newly submitted
  // report; that made residents see “An official has viewed this report” even
  // when nobody had opened it.
  if (!hasHandlingEvent && recordedViewers.length > 0) {
    lifecycleEvents.unshift({
      id: -report.id,
      status: report.status === "in_progress" ? "in_progress" : "under_review",
      note: "",
      actor: null,
      created_at: report.created_at,
    })
  }
  const departmentName = canShowAssignment
    ? (report.assigned_department?.name ?? "")
    : ""
  const assignmentEntries = (report.timeline ?? [])
    .filter(
      (entry) =>
        canShowAssignment &&
        entry.event_type === "assignment" &&
        entry.status === "assigned"
    )
    .sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    )
  const assignments = [...(report.assignments ?? [])].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  )
  const firstAssignment: ConcernAssignment | undefined = assignments[0]
  const assignedUnit = canShowAssignment
    ? (report.assigned_department ?? firstAssignment?.department ?? null)
    : null
  const firstAssignmentEntry = assignmentEntries[0]
  const assignmentMessageName = firstAssignmentEntry?.message
    .match(/^(?:Reassigned|Assigned) to\s+(.+?)[.]?$/i)?.[1]
    ?.trim()
  const assignmentName =
    departmentName ||
    assignmentMessageName ||
    firstAssignment?.office ||
    "the barangay response team"
  const usedAssignmentIds = new Set<number>()
  let assignedEventCount = 0
  const proof = (report.resolution_evidence ?? []).filter((item) =>
    item.mime_type.startsWith("image/")
  )
  const proofPreview = proof.map((item) => ({
    ...toMediaPreviewItem(
      item.preview_url || item.raw_url,
      item.original_filename,
      item.mime_type
    ),
    eyebrow:
      streetOnly(report.community_incident?.address || report.address) ||
      undefined,
    postedLabel: `${formatDate(report.created_at)} at ${formatTime(report.created_at)}`,
    heading:
      (report.notification_subject || report.title || "").trim() || undefined,
    badge: "Resolved case",
    blurb: (report.description || "").trim() || undefined,
  }))

  const officialChatMembers = Array.from(
    new Map(
      (report.conversation ?? [])
        .filter(
          (item) =>
            item.kind === "chat" && item.actor && item.actor.role !== "resident"
        )
        .map((item) => [item.actor!.id, item.actor!])
    ).values()
  )
  const assignmentBadge = assignmentUnitBadge(assignedUnit)
  // `viewer` only ever names the official currently looking at this screen —
  // a resident never has one, so without the actual assignees the "Being
  // handled" row showed no one at all on their side. The active assignment
  // roster is who is really handling it, and is visible to anyone who can
  // already see this timeline (owner, assignee, or official).
  const activeAssignees = assignments
    .filter(
      (assignment) =>
        canShowAssignment &&
        assignment.status === "active" &&
        assignment.assignee
    )
    .map((assignment) => assignment.assignee!)
  const handledMembers = Array.from(
    new Map(
      [
        ...(viewer && viewer.role !== "resident" ? [viewer] : []),
        ...recordedViewers,
        ...officialChatMembers,
        ...activeAssignees,
      ].map((member) => [member.id, member])
    ).values()
  )

  const statusEntries: ConcernTimelineEntry[] = lifecycleEvents.map(
    (event, index, list) => {
      const meta = STATUS_META[event.status]
      const note = event.note.trim()
      const prev = index > 0 ? list[index - 1] : null
      const isClarificationReply = note === CLARIFICATION_REPLY_NOTE
      const isClarificationRequest =
        !isClarificationReply && Boolean(prev) && prev!.status === event.status

      let badge = meta?.label ?? concernTimelineStatusLabel(event.status)
      let icon = meta?.icon ?? "message"
      let accent = meta?.accent ?? "neutral"
      // Status events written by an authenticated action carry the real user
      // from the API. Preserve that identity for every status; "System" is
      // reserved for automated and legacy events whose actor is genuinely null.
      const eventActor = event.actor
      const actorUser = eventActor
      const actor = actorLabel(actorUser)
      const isBeingHandled =
        event.status === "under_review" || event.status === "in_progress"
      const beingHandledMembers = isBeingHandled
        ? Array.from(
            new Map(
              [...(eventActor ? [eventActor] : []), ...handledMembers].map(
                (member) => [member.id, member]
              )
            ).values()
          )
        : []
      let assignmentMembers: PublicUser[] = []
      const currentUpdate =
        event.status === report.status ? (report.update_text || "").trim() : ""
      let statement =
        note ||
        currentUpdate ||
        `Status updated to ${concernTimelineStatusLabel(event.status).toLowerCase()}.`
      if (isBeingHandled) statement = "An official has viewed this report."

      if (isClarificationReply) {
        badge = "Clarification answered"
        icon = "message"
        accent = "neutral"
        statement = "The resident answered the clarification request."
      } else if (isClarificationRequest) {
        badge = "Clarification requested"
        icon = "question"
        accent = "neutral"
        statement =
          note ||
          currentUpdate ||
          "More details were requested for this report."
      } else if (event.status === "assigned") {
        const unitName =
          assignmentUnitName(
            event,
            report,
            assignmentEntries,
            usedAssignmentIds
          ) || departmentName
        assignmentMembers = assignmentMembersFor(
          event,
          report,
          assignmentEntries
        )
        const isReassignment = assignedEventCount > 0
        assignedEventCount += 1
        badge = "Assigned unit"
        statement = unitName
          ? `${isReassignment ? "Reassigned to" : "Assigned to"} ${unitName}.`
          : note || currentUpdate || "Assigned to the response team."
      }

      return {
        id: String(event.id),
        badge,
        time: event.created_at,
        accent,
        icon,
        actor,
        actorUser,
        content: isResolvedRecord({ status: event.status }) ? (
          resolvedNoteBlock({
            text: statement,
            large,
            // The resolver roster, shown as a leading avatar group the same
            // way "Being handled" rows surface the officials on the report.
            members: activeAssignees,
            proof,
            proofPreview,
            onOpenProof,
          })
        ) : (
          <>
            {noteBlock(
              statement,
              event.status === "assigned"
                ? assignmentMembers
                : isBeingHandled
                  ? beingHandledMembers
                  : [],
              event.status === "assigned" ? assignmentBadge : undefined,
              large
            )}
          </>
        ),
      }
    }
  )

  const entries: ConcernTimelineEntry[] = statusEntries

  // Older/demo concerns can have a unit and an assignment record without an
  // `assigned` status event. Add the real assignment as the first visible
  // lifecycle row; never add a fake “Received” row. Assignments delegated by
  // the system intentionally use the System actor.
  if (
    canShowAssignment &&
    !lifecycleEvents.some((event) => event.status === "assigned")
  ) {
    entries.unshift({
      id: `assignment-${firstAssignment?.id ?? report.id}`,
      badge: "Assigned unit",
      time:
        firstAssignmentEntry?.created_at ??
        firstAssignment?.created_at ??
        report.created_at,
      accent: "info",
      icon: "network",
      actor: "System",
      actorUser: null,
      content: noteBlock(`Assigned to ${assignmentName}.`, [], assignmentBadge, large),
    })
  }

  const ordered = entries.sort((a, b) => {
    const aAssigned = a.badge === "Assigned unit" ? 0 : 1
    const bAssigned = b.badge === "Assigned unit" ? 0 : 1
    if (aAssigned !== bAssigned) return aAssigned - bAssigned
    return new Date(a.time ?? 0).getTime() - new Date(b.time ?? 0).getTime()
  })

  // Keep Assigned unit as the first row even when old timestamps were written
  // out of order.
  const firstAssignmentIndex = ordered.findIndex(
    (entry) => entry.badge === "Assigned unit"
  )
  if (firstAssignmentIndex > 0) {
    const [assigned] = ordered.splice(firstAssignmentIndex, 1)
    ordered.unshift(assigned)
  }

  if (ordered.length > 0) {
    return ordered.map((entry, index) => ({
      ...entry,
      state:
        index === ordered.length - 1 ? ("current" as const) : ("done" as const),
    }))
  }

  if (!canShowAssignment) return []

  return [
    {
      id: "submitted",
      badge: "Assigned unit",
      time: report.created_at,
      state: "current",
      accent: "info",
      icon: "network",
      actor: "System",
      actorUser: null,
      content: noteBlock(`Assigned to ${assignmentName}.`, [], assignmentBadge, large),
    },
  ]
}
