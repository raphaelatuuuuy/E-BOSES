export type StatusGroup = "open" | "active" | "closed"

export interface StatusEntry {
  residentLabel: string
  officialLabel: string
  group: StatusGroup
}

export const STATUS_GROUP_LABEL: Record<StatusGroup, string> = {
  open: "Needs attention",
  active: "In progress",
  closed: "Closed",
}

export const VOCABULARY: Record<string, StatusEntry> = {
  submitted: { residentLabel: "Received", officialLabel: "Received", group: "open" },
  pending_verification: { residentLabel: "Being verified", officialLabel: "Pending verification", group: "open" },
  under_review: { residentLabel: "Being handled", officialLabel: "Being handled", group: "active" },
  assigned: { residentLabel: "Assigned to a unit", officialLabel: "Assigned", group: "active" },
  in_progress: { residentLabel: "Being handled", officialLabel: "Being handled", group: "active" },
  partially_resolved: { residentLabel: "Partly done", officialLabel: "Partially resolved", group: "active" },
  resolved: { residentLabel: "Resolved", officialLabel: "Resolved", group: "closed" },
  closed: { residentLabel: "Closed", officialLabel: "Closed", group: "closed" },
  rejected: { residentLabel: "Not accepted", officialLabel: "Not accepted", group: "closed" },
  cancelled: { residentLabel: "Cancelled", officialLabel: "Cancelled", group: "closed" },
  appealed: { residentLabel: "Under appeal", officialLabel: "Appeal open", group: "open" },
  routing: { residentLabel: "Finding a responder", officialLabel: "Finding a responder", group: "open" },
  routed: { residentLabel: "Responder assigned", officialLabel: "Responder assigned", group: "open" },
  awaiting_acknowledgment: { residentLabel: "Unit assigned", officialLabel: "Unit assigned", group: "active" },
  acknowledged: { residentLabel: "Responder preparing", officialLabel: "Responder preparing", group: "active" },
  en_route: { residentLabel: "Being worked on", officialLabel: "Responder en route", group: "active" },
  nearby: { residentLabel: "Being worked on", officialLabel: "Responder nearby", group: "active" },
  arrived: { residentLabel: "Responder is here", officialLabel: "Responder on scene", group: "active" },
  resident_safe: { residentLabel: "Reported safe", officialLabel: "Resident safe", group: "active" },
  backup_requested: { residentLabel: "More help requested", officialLabel: "Backup requested", group: "open" },
  backup_assigned: { residentLabel: "More help on the way", officialLabel: "Backup assigned", group: "active" },
  assisting: { residentLabel: "Being worked on", officialLabel: "Assisting", group: "active" },
  transfer_required: { residentLabel: "Being handed over", officialLabel: "Transfer required", group: "open" },
  escalation_required: { residentLabel: "Needs a decision", officialLabel: "Escalation required", group: "open" },
  false_alarm: { residentLabel: "False alarm", officialLabel: "False alarm", group: "closed" },
  invalid: { residentLabel: "Not valid", officialLabel: "Invalid", group: "closed" },
}

export const ACTIVE_CONCERN_STATUSES: ReadonlySet<string> = new Set([
  "under_review",
  "assigned",
  "in_progress",
  "partially_resolved",
])

export const ACTIVE_EMERGENCY_STATUSES: ReadonlySet<string> = new Set([
  "submitted",
  "routing",
  "routed",
  "awaiting_acknowledgment",
  "acknowledged",
  "en_route",
  "nearby",
  "arrived",
  "resident_safe",
  "backup_requested",
  "backup_assigned",
  "in_progress",
  "transfer_required",
  "escalation_required",
])

export const SETTLED_EMERGENCY_STATUSES: ReadonlySet<string> = new Set([
  "resolved",
  "closed",
  "cancelled",
  "false_alarm",
  "invalid",
  "rejected",
])

function humanise(key: string): string {
  const spaced = key.replace(/[_-]+/g, " ").trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export type StatusDomain = "concern" | "emergency"

const EMERGENCY_RESIDENT_OVERRIDES: Record<string, string> = {
  submitted: "Alert sent",
  in_progress: "Response in progress",
  en_route: "On the way",
  nearby: "Nearby",
  arrived: "On scene",
}

export function statusEntry(status: string | null | undefined): StatusEntry {
  const key = (status ?? "").trim()
  return (
    VOCABULARY[key] ?? {
      residentLabel: key ? humanise(key) : "Unknown",
      officialLabel: key ? humanise(key) : "Unknown",
      group: "open",
    }
  )
}

export function statusLabelOf(
  status: string | null | undefined,
  audience: "resident" | "official" = "official",
  domain: StatusDomain = "concern",
): string {
  const key = (status ?? "").trim()
  const entry = statusEntry(key)
  if (audience !== "resident") return entry.officialLabel
  if (domain === "emergency" && EMERGENCY_RESIDENT_OVERRIDES[key]) {
    return EMERGENCY_RESIDENT_OVERRIDES[key]
  }
  return entry.residentLabel
}

export const STATUS_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(VOCABULARY).map(([key, entry]) => [key, entry.officialLabel]),
)

export function statusGroupOf(status: string | null | undefined): StatusGroup {
  return statusEntry(status).group
}

export function isConcernActive(concern: {
  status: string
  duplicate_of?: unknown
  archived_at?: string | null
  community_incident?: { primary_id: number } | null
  id?: number
}): boolean {
  if (concern.archived_at) return false
  const incident = concern.community_incident
  if (incident && concern.id != null && incident.primary_id !== concern.id) return false
  return ACTIVE_CONCERN_STATUSES.has(concern.status)
}

export function isEmergencyActive(status: string | null | undefined): boolean {
  return !SETTLED_EMERGENCY_STATUSES.has((status ?? "").trim())
}

export function statusNotes(concern: {
  community_incident?: { primary_id: number } | null
  id?: number
  reopen_count?: number
  archived_at?: string | null
}): string[] {
  const notes: string[] = []
  const incident = concern.community_incident
  if (incident && concern.id != null && incident.primary_id !== concern.id) notes.push("Merged")
  if (concern.reopen_count) notes.push("Reopened")
  if (concern.archived_at) notes.push("Archived")
  return notes
}

export function isMergedChild(concern: {
  id?: number
  community_incident?: { primary_id: number } | null
}): boolean {
  const incident = concern.community_incident
  return Boolean(incident && concern.id != null && incident.primary_id !== concern.id)
}
