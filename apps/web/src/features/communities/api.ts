import { apiRequest } from "@/lib/api"

export interface CommunityCenter {
  latitude: number
  longitude: number
}

export interface Community {
  id: number
  name: string
  locality: string
  city: string
  region: string
  is_home: boolean
  residents: number
  responders: number
  officials: number
  reports: number
  resolved_reports: number
  emergencies: number
  closed_emergencies: number
  since: string | null
  center: CommunityCenter | null
}

export interface CommunityTotals {
  communities: number
  cities: number
  residents: number
  responders: number
  officials: number
  reports: number
  resolved_reports: number
  emergencies: number
  closed_emergencies: number
}

export interface ActiveCommunities {
  totals: CommunityTotals
  communities: Community[]
}

export interface CommunityBoundary {
  id: number
  name: string
  locality: string
  geometry: {
    type: "Polygon"
    coordinates: number[][][]
  }
}

export interface CommunityRequest {
  kind: "community" | "demo"
  name: string
  email: string
  organization: string
  role: string
  message: string
  preferred_date?: string
}

const PUBLIC = { auth: false, refreshOnUnauthorized: false } as const

export function fetchActiveCommunities(signal?: AbortSignal) {
  return apiRequest<ActiveCommunities>("/public/communities/", { signal }, PUBLIC)
}

export function fetchCommunityBoundary(id: number, signal?: AbortSignal) {
  return apiRequest<CommunityBoundary>(`/public/communities/${id}/boundary/`, { signal }, PUBLIC)
}

export function submitCommunityRequest(payload: CommunityRequest) {
  return apiRequest<{ status: string; delivered: boolean }>(
    "/public/community-requests/",
    { method: "POST", body: JSON.stringify(payload) },
    { ...PUBLIC, csrf: true },
  )
}
