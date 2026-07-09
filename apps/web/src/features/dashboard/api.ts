import { apiRequest } from "@/lib/api"

export type ConcernCategory = "infrastructure" | "environment" | "public_safety" | "others"
export type ConcernStatus = "submitted" | "under_review" | "in_progress" | "resolved" | "rejected" | "appealed"
export type ConcernVisibility = "private" | "community"
export type ConcernValidationStatus = "pending_review" | "accepted" | "rejected" | "resolved"

export interface PublicUser {
  id: number
  full_name: string
  initials: string
  role: string
  last_seen_at: string | null
  responder_unit?: "tanod" | "bhw" | "bdrrmo" | "other" | ""
  is_on_duty?: boolean
  current_latitude?: string | null
  current_longitude?: string | null
  location_updated_at?: string | null
  email?: string
  avatar?: string
  gender?: string
  date_of_birth?: string
}

export interface ConcernMedia {
  id: number
  original_filename: string
  mime_type: string
  file_size: number
  preview_url: string
  raw_url: string
  uploaded_at: string
}

export interface ConcernStatusEvent {
  id: number
  status: ConcernStatus
  note: string
  actor: PublicUser | null
  created_at: string
}

export interface ConcernComment {
  id: number
  author: PublicUser
  parent: number | null
  body: string
  created_at: string
  updated_at: string
  replies: ConcernComment[]
}

export interface Concern {
  id: number
  tracking_id: string
  validation_status: ConcernValidationStatus
  reporter: PublicUser
  title: string
  description: string
  category: ConcernCategory
  status: ConcernStatus
  address: string
  latitude: string | null
  longitude: string | null
  location_source: string
  location_accuracy: number | null
  barangay: string
  update_text: string
  visibility: ConcernVisibility
  media: ConcernMedia[]
  status_events: ConcernStatusEvent[]
  comments: ConcernComment[]
  vote_count: number
  comment_count: number
  priority_score: number
  user_vote: 0 | 1
  created_at: string
  updated_at: string
}

export interface DashboardSummary {
  reports_submitted: number
  reports_resolved: number
  reports_active: number
  active_reports: Concern[]
}

export interface Announcement {
  id: number
  title: string
  body: string
  tag: string
  audience: "all" | "residents"
  barangay: string
  is_published: boolean
  published_at: string | null
  date_label: string
}

export interface BarangayEvent {
  id: number
  title: string
  detail: string
  barangay: string
  starts_at: string
  ends_at: string | null
  time_label: string
}

export function createConcern(formData: FormData) {
  return apiRequest<Concern>("/concerns/", {
    method: "POST",
    body: formData,
  })
}

export function listMyConcerns(status?: string, dateFrom?: string, dateTo?: string) {
  const params = new URLSearchParams()
  if (status && status !== "all") params.set("status", status)
  if (dateFrom) params.set("date_from", dateFrom)
  if (dateTo) params.set("date_to", dateTo)
  const query = params.toString() ? `?${params.toString()}` : ""
  return apiRequest<Concern[]>(`/concerns/mine/${query}`)
}

export function listManagedConcerns(status?: string, category?: string, search?: string) {
  const params = new URLSearchParams()
  if (status && status !== "all") params.set("status", status)
  if (category && category !== "all") params.set("category", category)
  if (search?.trim()) params.set("search", search.trim())
  const query = params.toString() ? `?${params.toString()}` : ""
  return apiRequest<Concern[]>(`/concerns/manage/${query}`)
}

export function listFeedConcerns(
  category?: string,
  dateFrom?: string,
  dateTo?: string,
  search?: string,
) {
  const params = new URLSearchParams()
  if (category && category !== "all") params.set("category", category)
  if (dateFrom) params.set("date_from", dateFrom)
  if (dateTo) params.set("date_to", dateTo)
  if (search?.trim()) params.set("search", search.trim())
  const query = params.toString() ? `?${params.toString()}` : ""
  return apiRequest<Concern[]>(`/concerns/feed/${query}`)
}

export function getConcern(id: number) {
  return apiRequest<Concern>(`/concerns/${id}/`)
}

export function updateConcernStatus(id: number, payload: { status: ConcernStatus; note?: string }) {
  return apiRequest<Concern>(`/concerns/${id}/status/`, {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function voteConcern(id: number, value: 0 | 1) {
  return apiRequest<{ vote_count: number; user_vote: 0 | 1 }>(`/concerns/${id}/vote/`, {
    method: "POST",
    body: JSON.stringify({ value }),
  })
}

export function commentOnConcern(id: number, payload: { body: string; parent?: number | null }) {
  return apiRequest<ConcernComment>(`/concerns/${id}/comments/`, {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function getDashboardSummary() {
  return apiRequest<DashboardSummary>("/concerns/summary/")
}

export function listAnnouncements() {
  return apiRequest<Announcement[]>("/announcements/")
}

export function listTodayBarangayEvents() {
  return apiRequest<BarangayEvent[]>("/barangay-events/today/")
}

export function listActiveResponders() {
  return apiRequest<PublicUser[]>("/responders/active/")
}
