import { apiRequest } from "@/lib/api"
import type { PublicUser } from "@/features/dashboard/api"

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
  created_at: string
  updated_at: string
  routed_at: string | null
  resolved_at: string | null
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
    body: JSON.stringify(payload),
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
  created_at: string
  is_mine: boolean
}

export function listEmergencyChat(alertId: number, afterId?: number) {
  const params = new URLSearchParams()
  if (afterId) params.set("after", String(afterId))
  const q = params.toString() ? `?${params.toString()}` : ""
  return apiRequest<EmergencyChatMessage[]>(`/emergencies/${alertId}/chat/${q}`)
}

export function sendEmergencyChat(alertId: number, body: string) {
  return apiRequest<EmergencyChatMessage>(`/emergencies/${alertId}/chat/`, {
    method: "POST",
    body: JSON.stringify({ body }),
  })
}

export function cancelEmergency(id: number) {
  return apiRequest<EmergencyAlert>(`/emergencies/${id}/cancel/`, {
    method: "POST",
    body: JSON.stringify({}),
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

export function acknowledgeEmergency(id: number, note = "") {
  return apiRequest<EmergencyAlert>(`/emergencies/${id}/acknowledge/`, {
    method: "POST",
    body: JSON.stringify({ note }),
  })
}

export function sendEmergencyLocationPing(
  id: number,
  payload: { latitude: number; longitude: number; accuracy?: number | null },
) {
  return apiRequest<EmergencyAlert>(`/emergencies/${id}/location-pings/`, {
    method: "POST",
    body: JSON.stringify(payload),
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
