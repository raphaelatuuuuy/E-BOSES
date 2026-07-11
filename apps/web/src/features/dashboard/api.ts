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

export interface ConcernAiAssessment {
  status: "pending" | "completed" | "failed" | "not_configured"
  image_objects: unknown[]
  yolo_confidence: number | null
  severity_estimate: string
  nlp_validity: string
  nlp_confidence: number | null
  category_match: boolean | null
  recommendation: string
  explanation: string
  model_version: string
  updated_at: string
}

export interface ContentFlag {
  id: number
  concern: number
  comment: number | null
  reporter: PublicUser
  reason: string
  note: string
  status: string
  staff_note: string
  created_at: string
  updated_at: string
}

export interface ConcernAssignment {
  id: number
  assignee: PublicUser | null
  assigned_by: PublicUser
  office: string
  note: string
  status: string
  created_at: string
  updated_at: string
}

export interface ConcernClarification {
  id: number
  requested_by: PublicUser
  request_text: string
  response_text: string
  responded_by: PublicUser | null
  status: "open" | "answered" | "closed"
  created_at: string
  responded_at: string | null
}

export interface ConcernAppeal {
  id: number
  concern_id?: number
  concern_title?: string
  concern_status?: ConcernStatus
  concern_tracking_id?: string
  appellant: PublicUser
  reason: string
  status: "submitted" | "approved" | "denied"
  decision_note: string
  reviewed_by: PublicUser | null
  created_at: string
  decided_at: string | null
}

export interface ConcernOfficialRemark {
  id: number
  author: PublicUser
  body: string
  visible_to_resident: boolean
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
  ai_assessment?: ConcernAiAssessment | null
  assignments?: ConcernAssignment[]
  clarifications?: ConcernClarification[]
  appeals?: ConcernAppeal[]
  official_remarks?: ConcernOfficialRemark[]
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

export interface CommonRoleSummary {
  unread_notifications: number
  published_announcements: number
  events_today: number
}

export interface ResidentRoleSummary extends CommonRoleSummary {
  reports_total: number
  reports_active: number
  reports_resolved: number
  reports_appealed: number
  active_emergencies: number
  emergencies_resolved: number
  open_account_requests: number
}

export interface OfficialRoleSummary extends CommonRoleSummary {
  pending_reviews: number
  active_reports: number
  appealed_reports: number
  pending_appeals: number
  active_emergencies: number
  pending_emergency_appeals: number
  responders_on_duty: number
  pending_resident_verifications: number
  pending_content_flags: number
  pending_account_requests: number
}

export interface ResponderRoleSummary extends CommonRoleSummary {
  is_on_duty: boolean
  responder_unit: PublicUser["responder_unit"]
  assigned_active_emergencies: number
  assigned_resolved_emergencies: number
  awaiting_acknowledgement: number
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
  is_published: boolean
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

export function assignConcern(id: number, payload: { assignee_id?: number | null; office?: string; note?: string }) {
  return apiRequest<ConcernAssignment>(`/concerns/${id}/assign/`, {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function requestConcernClarification(id: number, request_text: string) {
  return apiRequest<ConcernClarification>(`/concerns/${id}/clarifications/`, {
    method: "POST",
    body: JSON.stringify({ request_text }),
  })
}

export function replyConcernClarification(id: number, clarificationId: number, response_text: string) {
  return apiRequest<ConcernClarification>(`/concerns/${id}/clarifications/${clarificationId}/reply/`, {
    method: "POST",
    body: JSON.stringify({ response_text }),
  })
}

export function createConcernAppeal(id: number, reason: string) {
  return apiRequest<ConcernAppeal>(`/concerns/${id}/appeals/`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  })
}

export function listConcernAppeals(status?: string) {
  const params = new URLSearchParams()
  if (status && status !== "all") params.set("status", status)
  const query = params.toString() ? `?${params.toString()}` : ""
  return apiRequest<ConcernAppeal[]>(`/concerns/appeals/${query}`)
}

export function reviewConcernAppeal(appealId: number, payload: { status: "approved" | "denied"; decision_note?: string }) {
  return apiRequest<ConcernAppeal>(`/concerns/appeals/${appealId}/review/`, {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function createConcernRemark(id: number, payload: { body: string; visible_to_resident?: boolean }) {
  return apiRequest<ConcernOfficialRemark>(`/concerns/${id}/remarks/`, {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function flagConcern(id: number, payload: { reason: string; note?: string; comment?: number | null }) {
  return apiRequest<ContentFlag>(`/concerns/${id}/flags/`, {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function listContentFlags(status?: string) {
  const params = new URLSearchParams()
  if (status && status !== "all") params.set("status", status)
  const query = params.toString() ? `?${params.toString()}` : ""
  return apiRequest<ContentFlag[]>(`/concerns/flags/${query}`)
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

export function getResidentDashboardSummary() {
  return apiRequest<ResidentRoleSummary>("/dashboard/resident/summary/")
}

export function getOfficialDashboardSummary() {
  return apiRequest<OfficialRoleSummary>("/dashboard/official/summary/")
}

export function getResponderDashboardSummary() {
  return apiRequest<ResponderRoleSummary>("/dashboard/responder/summary/")
}

export function listAnnouncements() {
  return apiRequest<Announcement[]>("/announcements/")
}

export function listManagedAnnouncements() {
  return apiRequest<Announcement[]>("/announcements/manage/")
}

export function createManagedAnnouncement(payload: Partial<Announcement>) {
  return apiRequest<Announcement>("/announcements/manage/", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function updateManagedAnnouncement(id: number, payload: Partial<Announcement>) {
  return apiRequest<Announcement>(`/announcements/manage/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  })
}

export function deleteManagedAnnouncement(id: number) {
  return apiRequest<void>(`/announcements/manage/${id}/`, { method: "DELETE" })
}

export function listTodayBarangayEvents() {
  return apiRequest<BarangayEvent[]>("/barangay-events/today/")
}

export function listManagedBarangayEvents() {
  return apiRequest<BarangayEvent[]>("/barangay-events/manage/")
}

export function createManagedBarangayEvent(payload: Partial<BarangayEvent>) {
  return apiRequest<BarangayEvent>("/barangay-events/manage/", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function updateManagedBarangayEvent(id: number, payload: Partial<BarangayEvent>) {
  return apiRequest<BarangayEvent>(`/barangay-events/manage/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  })
}

export function deleteManagedBarangayEvent(id: number) {
  return apiRequest<void>(`/barangay-events/manage/${id}/`, { method: "DELETE" })
}

export function listActiveResponders() {
  return apiRequest<PublicUser[]>("/responders/active/")
}
