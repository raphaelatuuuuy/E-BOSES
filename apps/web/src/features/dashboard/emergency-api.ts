import { apiRequest } from "@/lib/api"
import type {
  PublicUser,
  RouteApproach,
  RouteSnap,
  TravelProfile,
} from "@/features/dashboard/api"

export type { TravelProfile } from "@/features/dashboard/api"

function normalizeCoordinate(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return value
  return Number(value.toFixed(6))
}

export type EmergencyType = string
export type EmergencyCategoryCode = string

export interface EmergencyCategory {
  id: number
  code: EmergencyCategoryCode
  label: string
  subtext: string
  icon_key: string
  custom_icon_label: string
  icon_image: string
  icon_image_url: string
  is_covered: boolean
  sort_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}
export function respondToEmergency(id: number, note = "") {
  return apiRequest<EmergencyAlert>(`/emergencies/${id}/respond/`, {
    method: "POST",
    body: JSON.stringify({ note }),
  })
}

export function unableToRespond(id: number, reason: string) {
  return apiRequest<EmergencyAlert>(`/emergencies/${id}/unable/`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  })
}

export function transferEmergency(id: number, departmentCode: string, reason: string) {
  return apiRequest<EmergencyAlert>(`/emergencies/${id}/transfer/`, {
    method: "POST",
    body: JSON.stringify({ department_code: departmentCode, reason }),
  })
}

export function requestEmergencyBackup(
  id: number,
  payload: { backup_type: string; reason: string; urgency: string },
) {
  return apiRequest<EmergencyAlert>(`/emergencies/${id}/request-backup/`, {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function revealReporterContact(id: number) {
  return apiRequest<{ phone_number: string; alert_id: number }>(
    `/emergencies/${id}/reporter-contact/`,
  )
}

export type EmergencyStatus =
  | "submitted"
  | "routing"
  | "routed"
  | "awaiting_acknowledgment"
  | "acknowledged"
  | "en_route"
  | "nearby"
  | "arrived"
  | "resident_safe"
  | "backup_requested"
  | "backup_assigned"
  | "in_progress"
  | "transfer_required"
  | "escalation_required"
  | "resolved"
  | "invalid"
  | "cancelled"
  | "false_alarm"
  | "closed"

export interface EmergencyLocationPing {
  id: number
  latitude: string
  longitude: string
  accuracy: number | null
  created_at: string
}

export interface EmergencyMedia {
  id: number
  original_filename: string
  mime_type: string
  file_size: number
  preview_url: string
  raw_url: string
  uploaded_at: string
}

export interface EmergencyAssignment {
  id: number
  responder: PublicUser
  /** The full configured unit handling this alert, e.g. "Barangay Disaster
   *  Risk Reduction and Management Committee (BDRRMC)" — not the legacy
   *  short responder_unit code. Null when the responder has no unit. */
  assigned_unit?: {
    code: string
    name: string
    short_name: string
  } | null
  status: string
  source: "auto" | "manual" | "escalation" | "claim"
  status_note: string
  assigned_at: string
  acknowledged_at: string | null
  arrived_at: string | null
  last_location: EmergencyLocationPing | null
  location_history: EmergencyLocationPing[]
  travel_profile: TravelProfile
  route: EmergencyRoute | null
}

export interface EmergencyAppeal {
  id: number
  alert_id?: number
  alert_type?: EmergencyType
  alert_status?: EmergencyStatus
  appellant: PublicUser
  reason: string
  status: "submitted" | "approved" | "denied"
  decision_note: string
  reviewed_by: PublicUser | null
  created_at: string
  decided_at: string | null
}

export interface EmergencyEscalation {
  id: number
  previous_assignment: number
  escalated_to: PublicUser | null
  triggered_by: PublicUser | null
  reason: string
  created_at: string
}

export interface EmergencyAssignmentLog {
  id: number
  assignment: number | null
  responder: PublicUser | null
  actor: PublicUser | null
  action: string
  old_status: string
  new_status: string
  note: string
  metadata: Record<string, unknown>
  created_at: string
}

/** Raw OSRM maneuver; the sentence is built in lib/route-instructions.ts. */
export interface EmergencyRouteStep {
  type: string
  modifier: string
  bearing_after: number | null
  exit: number | null
  name: string
  ref: string
  distance: number | null
  duration: number | null
  /** Where the turn happens; drives active-step tracking. */
  latitude: number | null
  longitude: number | null
}

export interface EmergencyRoute {
  alert_id: number
  assignment_id: number
  responder_id: number
  status: "ok" | "stale" | "unavailable"
  profile: TravelProfile
  distance_meters: number | null
  eta_seconds: number | null
  geometry: unknown
  summary: string
  origin_snap: RouteSnap | null
  destination_snap: RouteSnap | null
  approach: RouteApproach | null
  /** Only populated by getEmergencyRoute({ steps: true }). */
  steps: EmergencyRouteStep[]
}

export interface EmergencyTimelineEntry {
  key: string
  event_key: string
  title: string
  description: string
  at: string
  actor_label: string
  note: string
  milestone: string
  elapsed_label: string
  elapsed_seconds: number | null
  source_event_ids: number[]
}

export interface EmergencyStatusEvent {
  id: number
  status: EmergencyStatus
  event_key: string
  label: string
  note: string
  actor: PublicUser | null
  created_at: string
}

export interface EmergencyAlert {
  id: number
  public_id: string
  reporter: PublicUser
  reporter_phone: string
  /**
   * The caller's name, or "" when there is genuinely none to show — an SMS from
   * an unrecognised number is filed against a shared system account. Read this
   * instead of `reporter.full_name`, which for that account derives a name from
   * its mailbox and produced "sms-intake" on screen.
   */
  reporter_display: string
  reporter_is_anonymous_intake: boolean
  type: EmergencyType
  note: string
  status: EmergencyStatus
  barangay: string
  latitude: string
  longitude: string
  location_source: "gps" | "manual_pin" | "network" | "sms" | "sms_landmark"
  location_accuracy: number | null
  address: string
  reported_area: string
  resolved_location: string
  display_location: string
  reverse_geocoding_status: "success" | "failed" | "skipped" | "pending"
  location_confidence: "confirmed" | "reported" | "unknown" | "outside_area"
  reporter_verification: "account" | "registered" | "unverified" | "needs_review"
  triage: Record<string, string>
  category_needs_confirmation: boolean
  unresolved_fields: string[]
  media_warnings: string[]
  resolution_report: string
  response_duration_seconds: number | null
  disposition_reason: string
  media: EmergencyMedia[]
  status_version: number
  route: EmergencyRoute | null
  current_assignment: EmergencyAssignment | null
  /** The unit that answers this emergency type — known before anyone is assigned. */
  responding_unit: { id: number; code: string; name: string; short_name: string } | null
  assignments: EmergencyAssignment[]
  status_events: EmergencyStatusEvent[]
  timeline: EmergencyTimelineEntry[]
  timeline_role: "resident" | "responder" | "official"
  appeals: EmergencyAppeal[]
  escalations: EmergencyEscalation[]
  assignment_logs: EmergencyAssignmentLog[]
  witness_notification_summary: {
    triggered: boolean
    recipient_count: number
    in_app_delivered_count: number
    read_count: number
    push_attempted_count: number
    push_delivered_count: number
    push_failure_count: number
    push_status_counts: Record<string, number>
    nearest_distance_meters: number | null
    farthest_distance_meters: number | null
    triggered_at: string | null
  } | null
  created_at: string
  updated_at: string
  routed_at: string | null
  resolved_at: string | null
}

export function isNewerEmergencyAlert(current: EmergencyAlert | null, next: EmergencyAlert) {
  if (!current || current.id !== next.id) return true
  if (next.status_version !== current.status_version) {
    return next.status_version > current.status_version
  }
  const currentTime = Date.parse(current.updated_at)
  const nextTime = Date.parse(next.updated_at)
  if (!Number.isFinite(currentTime) || !Number.isFinite(nextTime)) return true
  return nextTime >= currentTime
}

export interface ResponderShift {
  id: number
  responder: PublicUser
  responder_unit: PublicUser["responder_unit"]
  status: "active" | "ended"
  started_at: string
  ended_at: string | null
  duration_seconds: number
  start_latitude: string | null
  start_longitude: string | null
  end_latitude: string | null
  end_longitude: string | null
  incidents_assigned: number
  incidents_acknowledged: number
  incidents_resolved: number
  false_alarms: number
  average_response_seconds: number | null
  created_at: string
  updated_at: string
}

export function createEmergency(formData: FormData) {
  return apiRequest<EmergencyAlert>("/emergencies/", {
    method: "POST",
    body: formData,
  })
}

export function listEmergencyCategories() {
  return apiRequest<EmergencyCategory[]>("/emergencies/categories/")
}

export function getActiveEmergency() {
  return apiRequest<EmergencyAlert | undefined>("/emergencies/mine/active/")
}

export function listMyEmergencies() {
  return apiRequest<EmergencyAlert[]>("/emergencies/mine/")
}

/**
 * The dispatch queue. `scope: "all"` includes finished incidents (resolved,
 * cancelled, false alarm) so the console's closed filters have content; the
 * server bounds it to the last 30 days. Omit it for the active-only queue.
 */
export function listEmergencyQueue(scope?: "active" | "all") {
  return apiRequest<EmergencyAlert[]>(
    scope === "all" ? "/emergencies/queue/?scope=all" : "/emergencies/queue/",
  )
}

export function listAssignedEmergencies() {
  return apiRequest<EmergencyAlert[]>("/emergencies/assigned/")
}

/** Availability toggle. The unit is server-side only, same as shift start. */
export function updateEmergencyDuty(payload: {
  is_on_duty: boolean
  latitude?: number
  longitude?: number
}) {
  return apiRequest<{
    is_on_duty: boolean
    responder_unit: PublicUser["responder_unit"]
    current_latitude: string | null
    current_longitude: string | null
    location_updated_at: string | null
  }>("/emergencies/duty/", {
    method: "POST",
    body: JSON.stringify({
      ...payload,
      latitude: normalizeCoordinate(payload.latitude),
      longitude: normalizeCoordinate(payload.longitude),
    }),
  })
}

export function listResponderShifts() {
  return apiRequest<ResponderShift[]>("/emergencies/shifts/")
}

export function getActiveResponderShift() {
  return apiRequest<ResponderShift | null>("/emergencies/shifts/active/")
}

/**
 * Start a shift. There is deliberately no `responder_unit` here: the server
 * reads the unit from the membership officials assigned and ignores anything a
 * responder client sends, so offering the field would only imply a choice the
 * responder does not have.
 */
export function startResponderShift(payload: {
  latitude: number
  longitude: number
}) {
  return apiRequest<ResponderShift>("/emergencies/shifts/start/", {
    method: "POST",
    body: JSON.stringify({
      ...payload,
      latitude: normalizeCoordinate(payload.latitude),
      longitude: normalizeCoordinate(payload.longitude),
    }),
  })
}

export function endResponderShift(payload: {
  latitude?: number
  longitude?: number
} = {}) {
  return apiRequest<ResponderShift>("/emergencies/shifts/end/", {
    method: "POST",
    body: JSON.stringify({
      ...payload,
      latitude: normalizeCoordinate(payload.latitude),
      longitude: normalizeCoordinate(payload.longitude),
    }),
  })
}

export function getEmergency(id: number) {
  return apiRequest<EmergencyAlert>(`/emergencies/${id}/`)
}

/**
 * `steps` is the only way to get turn-by-turn; bulk payloads never carry it.
 * `refresh` bypasses the server's route cache — assigned responder only, and
 * throttled, so it is for deviation re-routing, not for polling.
 */
export function getEmergencyRoute(id: number, { steps = false, refresh = false } = {}) {
  const query = new URLSearchParams()
  if (steps) query.set("steps", "1")
  if (refresh) query.set("refresh", "1")
  const suffix = query.toString()
  return apiRequest<EmergencyRoute>(`/emergencies/${id}/route/${suffix ? `?${suffix}` : ""}`)
}

/** Sets the profile on the caller's own assignment, and returns the new leg. */
export function setEmergencyRouteProfile(id: number, profile: TravelProfile) {
  return apiRequest<EmergencyRoute>(`/emergencies/${id}/route/`, {
    method: "POST",
    body: JSON.stringify({ profile }),
  })
}

export interface EmergencyChatMessage {
  id: number
  alert: number
  sender: PublicUser
  body: string
  attachment: {
    id: number
    media_type: "image" | "video" | "audio" | "audio" | "audio"
    original_filename: string
    mime_type: string
    analysis_status: string
    authenticity: string
    edited: string
    raw_url: string
    preview_url: string | null
  } | null
  created_at: string
  is_mine: boolean
}

export function listEmergencyChat(alertId: number, options: { afterId?: number; beforeId?: number; limit?: number } = {}) {
  const params = new URLSearchParams()
  if (options.afterId) params.set("after", String(options.afterId))
  if (options.beforeId) params.set("before", String(options.beforeId))
  if (options.limit) params.set("limit", String(options.limit))
  const q = params.toString() ? `?${params.toString()}` : ""
  return apiRequest<EmergencyChatMessage[]>(`/emergencies/${alertId}/chat/${q}`)
}

export function sendEmergencyChat(alertId: number, body: string, file?: File | null) {
  const payload = file ? new FormData() : JSON.stringify({ body })
  if (file && payload instanceof FormData) {
    payload.append("body", body)
    payload.append("attachment", file)
  }
  return apiRequest<EmergencyChatMessage>(`/emergencies/${alertId}/chat/`, {
    method: "POST",
    body: payload,
  })
}

export function cancelEmergency(id: number, reason: string) {
  return apiRequest<EmergencyAlert>(`/emergencies/${id}/cancel/`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  })
}

export function assignEmergency(id: number, responderId: number) {
  return apiRequest<EmergencyAlert>(`/emergencies/${id}/assign/`, {
    method: "POST",
    body: JSON.stringify({ responder_id: responderId }),
  })
}

export function reassignEmergency(id: number, responderId: number, note: string, statusVersion: number) {
  return apiRequest<EmergencyAlert>(`/emergencies/${id}/reassign/`, {
    method: "POST",
    body: JSON.stringify({ responder_id: responderId, note, status_version: statusVersion }),
  })
}

export function removeEmergencyAssignment(
  id: number,
  assignmentId: number,
  payload: { reason: string; status_version: number },
) {
  return apiRequest<EmergencyAlert>(`/emergencies/${id}/assignments/${assignmentId}/remove/`, {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function createEmergencyAppeal(id: number, reason: string) {
  return apiRequest<EmergencyAppeal>(`/emergencies/${id}/appeals/`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  })
}

export function listEmergencyAppeals(status?: string) {
  const params = new URLSearchParams()
  if (status && status !== "all") params.set("status", status)
  const query = params.toString() ? `?${params.toString()}` : ""
  return apiRequest<EmergencyAppeal[]>(`/emergencies/appeals/${query}`)
}

export function reviewEmergencyAppeal(appealId: number, payload: { status: "approved" | "denied"; decision_note?: string }) {
  return apiRequest<EmergencyAppeal>(`/emergencies/appeals/${appealId}/review/`, {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

/**
 * Record a final disposition — false alarm or invalid — for one emergency.
 * `note` must be at least 5 characters; `status_version` is sent so a stale
 * view cannot silently overwrite a newer status.
 */
export function setEmergencyDisposition(
  id: number,
  status: "false_alarm" | "invalid",
  note: string,
  statusVersion?: number,
) {
  return apiRequest<EmergencyAlert>(`/emergencies/${id}/disposition/`, {
    method: "POST",
    body: JSON.stringify({
      status,
      note,
      ...(statusVersion != null ? { status_version: statusVersion } : {}),
    }),
  })
}

export function sendEmergencyLocationPing(
  id: number,
  payload: { latitude: number; longitude: number; accuracy?: number | null },
) {
  return apiRequest<EmergencyAlert>(`/emergencies/${id}/location-pings/`, {
    method: "POST",
    body: JSON.stringify({
      ...payload,
      latitude: normalizeCoordinate(payload.latitude),
      longitude: normalizeCoordinate(payload.longitude),
      accuracy: payload.accuracy == null ? payload.accuracy : Number(payload.accuracy.toFixed(2)),
    }),
  })
}

export function acknowledgeEmergency(id: number, note = "") {
  return apiRequest<EmergencyAlert>(`/emergencies/${id}/acknowledge/`, {
    method: "POST",
    body: JSON.stringify({ note }),
  })
}

export function markEmergencyArrived(id: number, note = "") {
  return apiRequest<EmergencyAlert>(`/emergencies/${id}/arrived/`, {
    method: "POST",
    body: JSON.stringify({ note }),
  })
}

export function resolveEmergency(id: number, note = "") {
  return apiRequest<EmergencyAlert>(`/emergencies/${id}/resolve/`, {
    method: "POST",
    body: JSON.stringify({ note }),
  })
}

export interface EmergencyCommunityComment {
  id: number
  parent: number | null
  body: string
  status: "visible" | "hidden" | "removed"
  is_official_update: boolean
  author_label: string
  author: { id: number; full_name: string }
  is_mine: boolean
  created_at: string
  replies?: EmergencyCommunityComment[]
}

export function listEmergencyCommunityComments(alertId: number) {
  return apiRequest<EmergencyCommunityComment[]>(
    `/emergencies/${alertId}/community-comments/`,
  )
}

export function addEmergencyCommunityComment(
  alertId: number,
  body: string,
  parent: number | null = null,
) {
  return apiRequest<EmergencyCommunityComment>(
    `/emergencies/${alertId}/community-comments/`,
    { method: "POST", body: JSON.stringify({ body, parent }) },
  )
}

export function removeEmergencyCommunityComment(
  alertId: number,
  commentId: number,
  reason = "",
) {
  return apiRequest<void>(`/emergencies/${alertId}/community-comments/${commentId}/`, {
    method: "DELETE",
    body: JSON.stringify({ reason }),
  })
}
