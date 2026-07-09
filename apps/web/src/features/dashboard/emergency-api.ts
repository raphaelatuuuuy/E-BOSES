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

export interface EmergencyAssignment {
  id: number
  responder: PublicUser
  status: string
  assigned_at: string
  acknowledged_at: string | null
  arrived_at: string | null
  last_location: EmergencyLocationPing | null
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
  type: EmergencyType
  note: string
  status: EmergencyStatus
  barangay: string
  latitude: string
  longitude: string
  address: string
  current_assignment: EmergencyAssignment | null
  assignments: EmergencyAssignment[]
  status_events: EmergencyStatusEvent[]
  created_at: string
  updated_at: string
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
