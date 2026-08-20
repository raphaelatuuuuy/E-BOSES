import { apiRequest } from "@/lib/api"
import type { EmergencyAlert } from "./emergency-api"

export type ConcernCategory = "infrastructure" | "environment" | "public_safety" | "others"
export type ConcernStatus =
  | "submitted"
  | "under_review"
  | "assigned"
  | "in_progress"
  | "resolved"
  | "rejected"
  | "appealed"
  | (string & {})
export type ConcernVisibility = "private" | "community"
export type ConcernValidationStatus = "pending" | "accepted" | "rejected"

export interface PublicUser {
  id: number
  full_name: string
  initials: string
  role: string
  last_seen_at: string | null
  responder_unit?: "tanod" | "bhw" | "bdrrmo" | ""
  is_on_duty?: boolean
  avatar?: string

  street?: string
  barangay?: string
}

export interface ActiveResponder extends PublicUser {
  current_latitude?: string | null
  current_longitude?: string | null
  location_updated_at?: string | null
}

export type ConcernMediaPrivacyState =
  | "not_required"
  | "queued"
  | "processing"
  | "protected"
  | "sensitive_review_required"
  | "no_match_found"
  | "failed_restricted"

export interface ConcernMediaRedaction {
  id: number
  x: number
  y: number
  width: number
  height: number
}

export interface ConcernMedia {
  id: number
  original_filename: string
  mime_type: string
  file_size: number
  preview_url: string
  raw_url: string
  validation_status: "accepted" | "rejected" | "pending"
  validation_detail: string
  privacy_state: ConcernMediaPrivacyState
  public_visible: boolean

  privacy_detected_classes: string[]

  relevance_state: "relevant" | "unrelated" | "unclear" | "unsupported" | "unverified"
  relevance_reason: string

  redactions: ConcernMediaRedaction[]
  uploaded_at: string
}

export interface ConcernResolutionEvidence {
  id: number
  uploaded_by: PublicUser | null
  original_filename: string
  mime_type: string
  file_size: number
  note: string
  raw_url: string
  preview_url: string
  privacy_state: string
  privacy_detected_classes: string[]
  created_at: string
}

export interface ConcernStatusEvent {
  id: number
  status: ConcernStatus
  note: string
  actor: PublicUser | null
  created_at: string
}

export type ConcernEvidenceRelationship =
  | "supports_report"
  | "partially_supports_report"
  | "contradicts_report"
  | "no_useful_image_evidence"
  | "image_unavailable"
  | "image_review_failed"

export type ConcernRecommendedAction =
  | "accept"
  | "accept_with_privacy_review"
  | "manual_review"
  | "request_more_information"
  | "escalate_as_emergency"
  | "reject_as_irrelevant"

export interface ConcernAiAssessment {
  status: "pending" | "completed" | "failed" | "not_configured"

  flagged?: boolean

  flag_reasons?: unknown[]

  detected_objects: string[]
  severity_estimate: string
  nlp_validity: string
  nlp_confidence: number | null
  category_match: boolean | null

  image_review_succeeded: boolean | null
  evidence_relationship: ConcernEvidenceRelationship | ""
  privacy_scan_required: boolean
  suspected_sensitive_classes: string[]
  urgent_attention: boolean
  missing_information: string[]
  recommended_action: ConcernRecommendedAction | ""
  recommendation: string
  explanation: string
  text_assessment: string
  photo_assessment: string
  possible_categories: string[]
  suggested_category: string

  suggested_category_name: string
  possible_duplicate: boolean
  duplicate_similarity: number | null
  duplicate_distance_meters: number | null
  duplicate_match: {
    id: number
    public_id: string
    tracking_id: string
    title: string
    status: ConcernStatus
  } | null
  updated_at: string
}

export interface ContentFlag {
  id: number
  concern: number
  comment: number | null
  reporter: PublicUser
  reporter_full_name?: string
  reason: "irrelevant" | "false_info" | "sensitive" | "abusive" | "other"
  note: string
  status: "submitted" | "reviewed" | "dismissed" | "action_taken" | "taken_down"
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

  original_body?: string
  is_edited?: boolean
  created_at: string
  updated_at: string
  replies: ConcernComment[]
}

export type ConcernConversationKind =
  | "status"
  | "assignment"
  | "chat"
  | "clarification"
  | "official_remark"
  | "appeal"

export interface ConcernChatAttachment {
  id: number
  original_filename: string
  mime_type: string
  kind: "image" | "video" | "audio"
  file_size: number
  authenticity_status: "clear" | "flagged" | "review_required"
  authenticity_detail: string
  raw_url: string
  preview_url: string
  privacy_state: string
  privacy_detail: string
  created_at: string
}

export interface ConcernConversationItem {
  id: string
  kind: ConcernConversationKind
  body: string
  created_at: string
  actor: PublicUser | null
  visibility: "participants" | "resident" | "official"
  status: string
  attachments: ConcernChatAttachment[]
  metadata: Record<string, unknown>
}

export interface Concern {
  id: number
  public_id: string
  tracking_id: string
  validation_status: ConcernValidationStatus
  validation_summary: string
  summary: string
  rejection_code: string
  status_version: number
  reporter: PublicUser
  reporter_full_name?: string
  title: string
  description: string

  category: ConcernCategory
  category_ref: {
    id: number
    code: string
    name: string
    description: string
    icon_key: string
    custom_icon_label: string
    icon_image_url: string
  } | null

  assigned_department: BarangayUnit | null
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
  resolution_evidence?: ConcernResolutionEvidence[]
  conversation?: ConcernConversationItem[]
  vote_count: number
  comment_count: number
  priority_score: number
  user_vote: 0 | 1
  also_reported_count: number
  also_reported_by: string[] | null
  recurrence_of: { id: number; tracking_id: string; status: ConcernStatus } | null
  official_title: string
  community_incident: CommunityIncident
  archived_at: string | null
  reopened_at: string | null
  reopen_count: number
  created_at: string
  updated_at: string
}

export interface CommunityIncidentReport {
  id: number
  public_id: string
  tracking_id: string
  reporter_name: string
  is_primary: boolean
  description: string
  category: ConcernCategory
  latitude: string | null
  longitude: string | null
  photo_count: number
  /** Photos held back by the privacy pass, so the UI can say so. */
  withheld_photo_count?: number
  submitted_at: string
}

export type CommunityIncidentPhoto = ConcernMedia & {
  report_id: number
  report_tracking_id: string
  reporter_name: string
}

export interface CommunityIncident {
  primary_id: number
  primary_public_id: string
  title: string
  status: ConcernStatus
  category: ConcernCategory
  assigned_unit: BarangayUnit | null
  visibility: ConcernVisibility
  publication_block_reason: string
  summary: string
  observed: string[]
  address: string
  report_count: number
  resident_count: number
  withheld_report_count: number
  photo_count: number
  first_reported_at: string | null
  latest_reported_at: string | null
  reports: CommunityIncidentReport[]
  photos: CommunityIncidentPhoto[]
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

  barangay_active_emergencies?: number
  has_ongoing_emergencies?: boolean
  emergencies_resolved: number
  open_account_requests: number
}

export interface OfficialRoleSummary extends CommonRoleSummary {
  new_concerns: number
  open_reports: number
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

export interface ResponderAssignedUnit {
  code: string
  name: string
  short_name: string
  description: string
  responds_to_emergencies: boolean
  emergency_types: string[]
  legacy_unit: string
}

export interface ResponderRoleSummary extends CommonRoleSummary {
  is_on_duty: boolean
  responder_unit: PublicUser["responder_unit"]
  assigned_unit: ResponderAssignedUnit | null
  assigned_active_emergencies: number
  assigned_resolved_emergencies: number
  newly_routed: number
  awaiting_acknowledgement?: number
}

export interface Announcement {
  id: number
  title: string
  body: string
  tag: string
  audience: "all" | "residents" | "responders" | "officials"
  barangay: string
  urgency: "normal" | "important" | "urgent"
  is_pinned: boolean
  is_published: boolean
  published_at: string | null
  starts_at: string | null
  expires_at: string | null
  notification_sent_at: string | null
  image_url: string | null
  image_alt: string

  affected_streets: string[]

  area_geometry: GeoJsonPolygon | null
  /** Real OSM lines for the affected streets, sent only when there is no corridor. */
  street_geometries?: LiveMapGeometry[]
  /** Optional single point for advisories about one place, not a corridor. */
  latitude: string | null
  longitude: string | null
  place_label: string
  date_label: string
  status_label: "draft" | "scheduled" | "published" | "expired"
  created_at: string
  updated_at: string
}

export interface BarangayEvent {
  id: number
  title: string
  detail: string
  barangay: string
  starts_at: string
  ends_at: string | null
  is_published: boolean

  affected_streets: string[]
  area_geometry: GeoJsonPolygon | null
  time_label: string
  created_at: string
  updated_at: string
}

export interface GeoJsonPolygon {
  type: "Polygon"
  coordinates: [number, number][][]
}

export interface AnnouncementAreaContext {
  boundary: {
    osm_relation_id: number
    name: string
    geometry?: LiveMapGeometry | null
  }
  streets: {
    streets: LiveMapStreet[]
    groups: Record<string, LiveMapStreet[]>
  }
}

export function createConcern(formData: FormData, options?: { escalate?: boolean; emergencyType?: string; recurrenceOf?: number; duplicateOf?: number }) {
  const query = options?.escalate ? "?escalate=1" : ""
  if (options?.escalate && options.emergencyType) formData.append("emergency_type", options.emergencyType)
  if (options?.recurrenceOf) formData.append("recurrence_of", String(options.recurrenceOf))
  if (options?.duplicateOf) formData.append("duplicate_of", String(options.duplicateOf))
  return apiRequest<Concern & { escalated_alert?: EmergencyAlert }>(`/concerns/${query}`, {
    method: "POST",
    body: formData,
  })
}

export interface ConcernResolvedMatch {
  concern_id: number
  tracking_id: string
  summary: string
  resolved_at: string | null
  preview_url: string
}

export interface ConcernEmergencyTriage {
  is_emergency: boolean
  types: string[]
  confidence: number
  reason: string
  escalation_offered: boolean
}

export interface ConcernPhotoVerdict {
  index: number
  state: "relevant" | "unrelated" | "unclear" | "unsupported"
  message: string
}

export interface ConcernResolvedAddress {
  address: string
  address_primary: string
  address_secondary: string
  latitude: number
  longitude: number
}

export interface ConcernActiveDuplicate {
  concern_id: number
  tracking_id: string
  title: string
  summary: string
  reporter_count: number
  distance_meters: number | null
  status: string
}

export interface ConcernPrecheckResult {
  can_submit: boolean
  needs_revision: boolean
  field_errors: Record<string, string>
  message: string
  suggested_category: string
  suggested_category_label: string
  category_confirm_required: boolean
  photo_required: boolean
  photo_verdicts: ConcernPhotoVerdict[]
  resolved_address?: ConcernResolvedAddress | null
  privacy_preview?: {
    state: string
    detected_classes: string[]
    protected_image: string
  }
  active_duplicate?: ConcernActiveDuplicate | null
  assigned_unit?: { code: string; name: string } | null
  photo_feedback: string
  emergency_triage?: ConcernEmergencyTriage | null
  resolved_match?: ConcernResolvedMatch | null
  result?: {
    classification?: string
    evidence_relationship?: string
    recommended_action?: string
    short_explanation?: string
  }
}

export function precheckConcern(formData: FormData) {
  return apiRequest<ConcernPrecheckResult>("/concerns/classification/precheck/", {
    method: "POST",
    body: formData,
  })
}

export function checkConcernMedia(formData: FormData) {
  return apiRequest<{ files: Array<{ name: string; status: "accepted" }> }>("/concerns/media/check/", {
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

export function listAssignedConcerns() {
  return apiRequest<Concern[]>("/concerns/assigned/")
}

export function listManagedConcerns(
  status?: string,
  category?: string,
  search?: string,
) {
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

export function getConcern(id: number | string) {
  const path = typeof id === "number" || /^\d+$/.test(id)
    ? `/concerns/${id}/`
    : `/concerns/by-public-id/${id}/`
  return apiRequest<Concern>(path)
}

export interface ConcernStatusUpdatePayload {

  status: string
  note?: string
  status_version?: number
  resolution_evidence?: File[]
  category?: string
  department_id?: number | null
  internal_note?: string
  applied_ai_suggestion?: boolean
}

export function updateConcernStatus(id: number, payload: ConcernStatusUpdatePayload) {
  if (payload.resolution_evidence?.length) {
    const body = new FormData()
    body.append("status", payload.status)
    if (payload.note != null) body.append("note", payload.note)
    if (payload.status_version != null) body.append("status_version", String(payload.status_version))
    if (payload.category) body.append("category", payload.category)
    if (payload.department_id != null) body.append("department_id", String(payload.department_id))
    if (payload.internal_note) body.append("internal_note", payload.internal_note)
    if (payload.applied_ai_suggestion) body.append("applied_ai_suggestion", "true")
    for (const file of payload.resolution_evidence) body.append("resolution_evidence", file)
    return apiRequest<Concern>(`/concerns/${id}/status/`, {
      method: "POST",
      body,
    })
  }
  return apiRequest<Concern>(`/concerns/${id}/status/`, {
    method: "POST",
    body: JSON.stringify({
      status: payload.status,
      note: payload.note,
      status_version: payload.status_version,
      category: payload.category,
      department_id: payload.department_id,
      internal_note: payload.internal_note,
      applied_ai_suggestion: payload.applied_ai_suggestion,
    }),
  })
}

export function addConcernMediaRedactions(
  mediaId: number,
  regions: Array<{ x: number; y: number; width: number; height: number; label?: string }>,
) {
  return apiRequest<ConcernMedia>(`/concerns/media/${mediaId}/redactions/`, {
    method: "POST",
    body: JSON.stringify(regions),
  })
}

export function removeConcernMediaRedaction(mediaId: number, redactionId: number) {
  return apiRequest<ConcernMedia>(`/concerns/media/${mediaId}/redactions/${redactionId}/`, {
    method: "DELETE",
  })
}

export function reprocessConcernMediaPrivacy(mediaId: number) {
  return apiRequest<ConcernMedia>(`/concerns/media/${mediaId}/privacy/reprocess/`, {
    method: "POST",
  })
}

export function assignConcern(
  id: number,
  payload: { department_id?: number | null; assignee_id?: number | null; office?: string; note?: string },
) {
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

export interface ConcernChatMessage {
  id: number
  concern: number
  sender: PublicUser
  body: string
  attachment: ConcernChatAttachment | null
  created_at: string
  is_mine: boolean
}

export function listConcernChat(concernId: number, options: { afterId?: number; beforeId?: number; limit?: number } = {}) {
  const params = new URLSearchParams()
  if (options.afterId) params.set("after", String(options.afterId))
  if (options.beforeId) params.set("before", String(options.beforeId))
  if (options.limit) params.set("limit", String(options.limit))
  const q = params.toString() ? `?${params.toString()}` : ""
  return apiRequest<ConcernChatMessage[]>(`/concerns/${concernId}/chat/${q}`)
}

export function sendConcernChat(concernId: number, body: string, media?: File | null) {
  if (media) {
    const form = new FormData()
    if (body.trim()) form.append("body", body)
    form.append("media", media)
    return apiRequest<ConcernChatMessage>(`/concerns/${concernId}/chat/`, {
      method: "POST",
      body: form,
    })
  }
  return apiRequest<ConcernChatMessage>(`/concerns/${concernId}/chat/`, {
    method: "POST",
    body: JSON.stringify({ body }),
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

export function updateConcernComment(
  concernId: number,
  commentId: number,
  payload: { body: string },
) {
  return apiRequest<ConcernComment>(`/concerns/${concernId}/comments/${commentId}/`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  })
}

export function deleteConcernComment(concernId: number, commentId: number) {
  return apiRequest<void>(`/concerns/${concernId}/comments/${commentId}/`, {
    method: "DELETE",
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

export interface BarangayUnit {
  id: number
  name: string
  code: string

  short_name: string

  description: string

  emergency_role: string
  sort_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export type BarangayUnitDraft = Partial<
  Pick<
    BarangayUnit,
    "name" | "code" | "short_name" | "description" | "emergency_role" | "sort_order" | "is_active"
  >
>

export interface BarangayUnitDeleteResult {
  deleted: boolean
  deactivated: boolean
  in_use: number
  detail?: string
}

export function listBarangayUnits() {
  return apiRequest<BarangayUnit[]>("/concerns/admin/departments/")
}

export function createBarangayUnit(draft: BarangayUnitDraft) {
  return apiRequest<BarangayUnit>("/concerns/admin/departments/", {
    method: "POST",
    body: JSON.stringify(draft),
  })
}

export function updateBarangayUnit(id: number, draft: BarangayUnitDraft) {
  return apiRequest<BarangayUnit>(`/concerns/admin/departments/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(draft),
  })
}

export function deleteBarangayUnit(id: number) {
  return apiRequest<BarangayUnitDeleteResult>(`/concerns/admin/departments/${id}/`, {
    method: "DELETE",
  })
}

export function getResponderDashboardSummary() {
  return apiRequest<ResponderRoleSummary>("/dashboard/responder/summary/")
}

export function listAnnouncements() {
  return apiRequest<Announcement[]>("/announcements/")
}

export function getAnnouncementAreaContext() {
  return apiRequest<AnnouncementAreaContext>("/announcements/area-context/")
}

export function listManagedAnnouncements() {
  return apiRequest<Announcement[]>("/announcements/manage/")
}

export function createManagedAnnouncement(payload: Partial<Announcement> | FormData) {
  return apiRequest<Announcement>("/announcements/manage/", {
    method: "POST",
    body: payload instanceof FormData ? payload : JSON.stringify(payload),
  })
}

export function updateManagedAnnouncement(id: number, payload: Partial<Announcement> | FormData) {
  return apiRequest<Announcement>(`/announcements/manage/${id}/`, {
    method: "PATCH",
    body: payload instanceof FormData ? payload : JSON.stringify(payload),
  })
}

export function deleteManagedAnnouncement(id: number) {
  return apiRequest<void>(`/announcements/manage/${id}/`, { method: "DELETE" })
}

export function getMapDispatchPolicy() {
  return apiRequest<MapDispatchPolicy>("/emergencies/map-dispatch-policy/")
}

export interface BarangayBoundary {
  /** null for a boundary that came straight from OSM, not the local table. */
  id: number | null
  /** "custom" is client-side only: a name typed by an official. */
  source: "saved" | "osm" | "custom"
  name: string
  locality: string
  osm_id: number
  is_home: boolean
  geometry: LiveMapGeometry | null
}

export function searchBarangayBoundaries(query: string) {
  const search = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ""
  return apiRequest<BarangayBoundary[]>(`/locations/boundaries/${search}`)
}

export interface ActiveCommunity {
  id: number
  name: string
  locality: string
  is_home: boolean
  geometry: LiveMapGeometry | null
}

/** Barangays already running as their own community, outlines included. */
export function listActiveCommunities() {
  return apiRequest<ActiveCommunity[]>("/locations/active-communities/")
}

/** Saves a corrected barangay outline; every map reads this same row. */
export function updateBarangayBoundary(id: number, geometry: GeoJsonPolygon) {
  return apiRequest<BarangayBoundary>(`/locations/boundaries/${id}/`, {
    method: "PATCH",
    body: JSON.stringify({ geometry }),
  })
}

export function updateMapDispatchPolicy(payload: Partial<MapDispatchPolicy>) {
  return apiRequest<MapDispatchPolicy>("/emergencies/map-dispatch-policy/", {
    method: "PATCH",
    body: JSON.stringify(payload),
  })
}

export function reviewContentFlag(id: number, payload: { status: Exclude<ContentFlag["status"], "submitted">; staff_note: string }) {
  return apiRequest<ContentFlag>(`/concerns/flags/${id}/review/`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  })
}

export function listTodayBarangayEvents() {
  return apiRequest<BarangayEvent[]>("/barangay-events/today/")
}

export function listBarangayEventCalendar(days = 60) {
  return apiRequest<BarangayEvent[]>(`/barangay-events/calendar/?days=${days}`)
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
  return apiRequest<ActiveResponder[]>("/responders/active/")
}

export interface LiveMapGeometry {
  type: string
  coordinates: unknown
}

export interface LiveMapStreet {
  id: string
  name: string
  type: string
  osm_ids?: string[]
  geometries?: LiveMapGeometry[]
}

export interface LiveMapPerson {
  id: number
  full_name: string
  role: "resident" | "barangay_official" | "first_responder"
  barangay: string
  address: string
  responder_unit: PublicUser["responder_unit"]
  is_on_duty: boolean
  latitude: string | null
  longitude: string | null
  location_updated_at: string | null
}

export interface LiveMapConcern {
  id: number
  tracking_id: string
  title: string
  description: string
  category: ConcernCategory
  status: ConcernStatus
  address: string
  barangay: string
  latitude: string | null
  longitude: string | null
  reporter: LiveMapPerson
  created_at: string
  updated_at: string
  priority: "high" | "normal"
  preview_url: string
  media_count: number
}

export interface LiveMapEmergency {
  id: number
  type: string
  note: string
  status: string
  address: string
  barangay: string
  latitude: string
  longitude: string
  reporter: LiveMapPerson
  current_assignment: {
    id: number
    responder: LiveMapPerson
    status: string
    last_location: { latitude: string; longitude: string; accuracy: number | null; created_at: string | null } | null
  } | null
  created_at: string
  updated_at: string
  resolved_at: string | null
}

export type TravelProfile = "car" | "bike" | "foot"

export interface RouteGeoJson {
  type: "LineString"
  coordinates: [number, number][]
}

export interface RouteSnap {
  latitude: number
  longitude: number
  meters: number | null
}

export interface RouteApproach {
  geometry: RouteGeoJson | null
  distance_meters: number | null
  residual_meters: number | null
}

export interface LiveMapRoute {
  alert_id: number
  assignment_id: number
  responder_id: number
  status: "ok" | "stale" | "unavailable"
  profile: TravelProfile
  distance_meters: number | null
  eta_seconds: number | null
  geometry: RouteGeoJson | null
  summary: string
  origin_snap: RouteSnap | null
  destination_snap: RouteSnap | null
  approach: RouteApproach | null
}

export interface MapDispatchPolicy {
  id: number | null
  barangay: string
  acceptance_center_latitude: number | string
  acceptance_center_longitude: number | string
  acceptance_radius_meters: number
  /** Drawn acceptance zone. When present it replaces the circle. */
  acceptance_geometry: GeoJsonPolygon | null
  out_of_zone_action: "block" | "warn" | "review"
  witness_radius_meters: number
  responder_nearby_radius_meters: number

  emergency_sms_number: string
  updated_at: string | null
}

export interface LiveMapAdvisory {
  id: number
  title: string
  body: string
  tag: string
  urgency: string
  is_pinned: boolean
  affected_streets: string[]
  area_geometry: GeoJsonPolygon | null
  /** Real OSM lines for the affected streets, sent only when there is no corridor. */
  street_geometries: LiveMapGeometry[]
  starts_at: string | null
  expires_at: string | null
}

export interface LiveMapSnapshot {
  map: {
    provider: "OpenStreetMap"
    center: { latitude: number; longitude: number; zoom: number }
    boundary: { osm_relation_id: number; name: string; geometry?: LiveMapGeometry | null }
    streets: { streets: LiveMapStreet[]; groups: Record<string, LiveMapStreet[]> }
    dispatch_policy: MapDispatchPolicy
  }
  people: LiveMapPerson[]
  concerns: LiveMapConcern[]
  emergencies: LiveMapEmergency[]
  routes: LiveMapRoute[]
  advisories: LiveMapAdvisory[]
  summary: {
    active_alerts: number
    concerns: number
    emergencies: number
    residents: number
    responders: number
    officials: number
  }
  generated_at: string
}

export type LiveMapUpdate =
  | { type: "location.updated"; payload: { person: LiveMapPerson } }
  | { type: "concern.created" | "concern.updated"; payload: { concern: LiveMapConcern } }
  | {
      type: "concern.ai_assessment.updated"
      payload: {
        concern_id: number
        assessment: {
          id: number
          status: ConcernAiAssessment["status"]
          category_match: boolean | null
          recommendation: string
          model_version: string
          updated_at: string
        }
      }
    }
  | { type: "emergency.created" | "emergency.updated"; payload: { emergency: LiveMapEmergency; route: LiveMapRoute | null } }
  | { type: "route.updated"; payload: { route: LiveMapRoute } }

export function getOfficialLiveMap() {
  return apiRequest<LiveMapSnapshot>("/dashboard/official/live-map/")
}

export interface ResidentMapConcern {
  id: number
  tracking_id: string
  title: string
  description: string
  category: ConcernCategory
  status: ConcernStatus
  address: string
  barangay: string
  latitude: string | null
  longitude: string | null
  preview_url: string | null
  reporter: { id: number; full_name: string; role: string; barangay: string }
  created_at: string
  updated_at: string
  priority: "high" | "normal"
  kind: "concern"
}

export interface ResidentMapEmergency {
  id: number
  type: string
  type_label: string
  note: string
  status: string
  address: string
  barangay: string
  latitude: string
  longitude: string
  preview_url: string | null
  created_at: string
  updated_at: string
  kind: "emergency"
  source: string
}

export interface ResidentMapService {
  id: string
  name: string
  type: string
  label: string
  sector: string
  latitude: number
  longitude: number
  source: string
  kind: "service"
}

export interface ResidentAlertsMapSnapshot {
  map: {
    provider: "OpenStreetMap"
    center: { latitude: number; longitude: number; zoom: number }
    boundary: { osm_relation_id: number; name: string; geometry?: LiveMapGeometry | null }
    /** The acceptance zone, so a resident sees the same limit an official set. */
    dispatch_policy?: MapDispatchPolicy | null
  }
  concerns: ResidentMapConcern[]
  emergencies: ResidentMapEmergency[]
  services: ResidentMapService[]
  poi_types: Array<{ type: string; label: string; sector: string }>
  summary: {
    public_concerns: number
    active_concerns: number
    active_emergencies: number
    services: number
    has_ongoing_emergencies: boolean
  }
  generated_at: string
}

export function getResidentAlertsMap() {
  return apiRequest<ResidentAlertsMapSnapshot>("/locations/resident-alerts-map/")
}

export function sendLocationPing(payload: { latitude: number; longitude: number; accuracy?: number | null; source?: "active_session" | "pwa_background" | "manual" | "incident" }) {
  return apiRequest<{ person: LiveMapPerson; source: string }>("/locations/ping/", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export interface MergeCandidateBrief {
  id: number
  tracking_id: string
  title: string
  description: string
  status: ConcernStatus
  category: ConcernCategory
  address: string
  created_at: string
  photo_count: number
  reporter_name: string
}

export interface MergeSuggestion {
  id: number
  concern: MergeCandidateBrief
  primary: MergeCandidateBrief
  confidence: number
  method: string
  distance_meters: number | null
  rationale: string
  status: string
  created_at: string
}

export interface MergeEvent {
  id: number
  action: string
  actor_name: string
  confidence: number | null
  method: string
  reason: string
  concern_tracking_id: string
  primary_tracking_id: string
  created_at: string
}

export function listMergeSuggestions() {
  return apiRequest<MergeSuggestion[]>("/concerns/merge-suggestions/")
}

export function decideMergeSuggestion(id: number, decision: "approve" | "reject", note?: string) {
  return apiRequest<MergeSuggestion>(`/concerns/merge-suggestions/${id}/decide/`, {
    method: "POST",
    body: JSON.stringify({ decision, note: note ?? "" }),
    headers: { "Content-Type": "application/json" },
  })
}

export function mergeConcern(id: number, primaryId: number, reason: string) {
  return apiRequest<{ detail: string }>(`/concerns/${id}/merge/`, {
    method: "POST",
    body: JSON.stringify({ primary_id: primaryId, reason }),
    headers: { "Content-Type": "application/json" },
  })
}

export function unmergeConcern(id: number, reason: string) {
  return apiRequest<{ detail: string }>(`/concerns/${id}/unmerge/`, {
    method: "POST",
    body: JSON.stringify({ reason }),
    headers: { "Content-Type": "application/json" },
  })
}

export function setConcernPrimary(id: number) {
  return apiRequest<{ detail: string }>(`/concerns/${id}/set-primary/`, {
    method: "POST",
    body: JSON.stringify({}),
    headers: { "Content-Type": "application/json" },
  })
}

export function listMergeHistory(id: number) {
  return apiRequest<MergeEvent[]>(`/concerns/${id}/merge-history/`)
}

export function requestConcernReopen(id: number, reason: string) {
  return apiRequest<Concern>(`/concerns/${id}/reopen-request/`, {
    method: "POST",
    body: JSON.stringify({ reason }),
    headers: { "Content-Type": "application/json" },
  })
}

export function cancelConcern(id: number, reason: string) {
  return apiRequest<Concern>(`/concerns/${id}/cancel/`, {
    method: "POST",
    body: JSON.stringify({ reason }),
    headers: { "Content-Type": "application/json" },
  })
}

export interface AnnouncementComment {
  id: number
  announcement: number
  parent: number | null
  body: string
  status: "visible" | "hidden" | "removed"
  is_official_reply: boolean
  author_label: string
  author: { id: number; full_name: string }
  is_mine: boolean
  created_at: string
  replies?: AnnouncementComment[]
  announcement_title?: string
}

export function listAnnouncementComments(announcementId: number) {
  return apiRequest<AnnouncementComment[]>(`/announcements/${announcementId}/comments/`)
}

export function addAnnouncementComment(
  announcementId: number,
  body: string,
  parent: number | null = null,
) {
  return apiRequest<AnnouncementComment>(`/announcements/${announcementId}/comments/`, {
    method: "POST",
    body: JSON.stringify({ body, parent }),
  })
}

export function removeAnnouncementComment(
  announcementId: number,
  commentId: number,
  reason = "",
) {
  return apiRequest<void>(`/announcements/${announcementId}/comments/${commentId}/`, {
    method: "DELETE",
    body: JSON.stringify({ reason }),
  })
}

