import { apiRequest } from "@/lib/api"
import type { PublicUser } from "@/features/dashboard/api"

function normalizeCoordinate(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return value
  return Number(value.toFixed(6))
}

export type EmergencyType = "medical" | "fire" | "crime" | "disaster" | "other"
export type EmergencyStatus =
  | "submitted"
  | "routed"
  | "acknowledged"
  | "en_route"
  | "nearby"
  | "arrived"
  | "resolved"
  | "cancelled"

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
  status: string
  assigned_at: string
  acknowledged_at: string | null
  arrived_at: string | null
  last_location: EmergencyLocationPing | null
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

export interface EmergencyStatusEvent {
  id: number
  status: EmergencyStatus
  note: string
  actor: PublicUser | null
  created_at: string
}

export interface EmergencyAlert {
  id: number
  public_id: string
  reporter_phone: string
  type: EmergencyType
  note: string
  status: EmergencyStatus
  barangay: string
  latitude: string
  longitude: string
  location_source: "gps" | "manual_pin"
  location_accuracy: number | null
  address: string
  media_warnings: string[]
  media: EmergencyMedia[]
  status_version: number
  current_assignment: EmergencyAssignment | null
  assignments: EmergencyAssignment[]
  status_events: EmergencyStatusEvent[]
  appeals: EmergencyAppeal[]
  escalations: EmergencyEscalation[]
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

export function getActiveEmergency() {
  return apiRequest<EmergencyAlert | undefined>("/emergencies/mine/active/")
}

export function listMyEmergencies() {
  return apiRequest<EmergencyAlert[]>("/emergencies/mine/")
}

export function listEmergencyQueue() {
  return apiRequest<EmergencyAlert[]>("/emergencies/queue/")
}

export function listAssignedEmergencies() {
  return apiRequest<EmergencyAlert[]>("/emergencies/assigned/")
}

export function updateEmergencyDuty(payload: {
  is_on_duty: boolean
  responder_unit?: PublicUser["responder_unit"]
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

export function startResponderShift(payload: {
  responder_unit?: PublicUser["responder_unit"]
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

export interface EmergencyChatMessage {
  id: number
  alert: number
  sender: PublicUser
  body: string
  attachment: {
    id: number
    media_type: "image" | "video"
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

export function listEmergencyChat(alertId: number, afterId?: number) {
  const params = new URLSearchParams()
  if (afterId) params.set("after", String(afterId))
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

export function assignEmergencyResponders(id: number, responderIds: number[]) {
  return apiRequest<EmergencyAlert>(`/emergencies/${id}/assign/`, {
    method: "POST",
    body: JSON.stringify({ responder_ids: responderIds }),
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

export function requestEmergencyBackup(id: number) {
  return apiRequest<EmergencyAlert>(`/emergencies/${id}/request-backup/`, {
    method: "POST",
    body: JSON.stringify({}),
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

export function escalateOverdueEmergencies(minutes = 5) {
  return apiRequest<{ escalated: number }>("/emergencies/escalate-overdue/", {
    method: "POST",
    body: JSON.stringify({ minutes }),
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
