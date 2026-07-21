import { apiRequest } from "@/lib/api"

export type ConcernCategory = "infrastructure" | "environment" | "public_safety" | "others"
export type ConcernStatus = "submitted" | "under_review" | "assigned" | "in_progress" | "resolved" | "rejected" | "appealed"
export type ConcernVisibility = "private" | "community"
export type ConcernValidationStatus = "pending" | "accepted" | "rejected"

export interface PublicUser {
  id: number
  full_name: string
  initials: string
  role: string
  last_seen_at: string | null
  responder_unit?: "tanod" | "bhw" | "bdrrmo" | "other" | ""
  is_on_duty?: boolean
  avatar?: string
  /** Street line from residence (e.g. "123 Champaca Street") */
  street?: string
  barangay?: string
}

export interface ActiveResponder extends PublicUser {
  current_latitude?: string | null
  current_longitude?: string | null
  location_updated_at?: string | null
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
  created_at: string
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
  official_decision: "related" | "irrelevant" | "suspicious" | "needs_review" | ""
  official_reason: string
  official_reviewer: PublicUser | null
  official_reviewed_at: string | null
  updated_at: string
}

export interface ContentFlag {
  id: number
  concern: number
  comment: number | null
  reporter: PublicUser
  reason: "irrelevant" | "false_info" | "sensitive" | "abusive" | "other"
  note: string
  status: "submitted" | "reviewed" | "dismissed" | "action_taken"
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
  /** Present after first edit — original text before any changes */
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
  kind: "image" | "video"
  file_size: number
  authenticity_status: "clear" | "flagged" | "review_required"
  authenticity_detail: string
  raw_url: string
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
  rejection_code: string
  status_version: number
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
  resolution_evidence?: ConcernResolutionEvidence[]
  conversation?: ConcernConversationItem[]
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
  /** User's own active emergencies */
  active_emergencies: number
  /** Barangay-wide active emergencies (home rail / feed banner) */
  barangay_active_emergencies?: number
  has_ongoing_emergencies?: boolean
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
  date_label: string
  status_label: "draft" | "scheduled" | "published" | "expired"
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

export function getConcern(id: number | string) {
  const path = typeof id === "number" || /^\d+$/.test(id)
    ? `/concerns/${id}/`
    : `/concerns/by-public-id/${id}/`
  return apiRequest<Concern>(path)
}

export function updateConcernStatus(
  id: number,
  payload: { status: ConcernStatus; note?: string; status_version?: number; resolution_evidence?: File[] },
) {
  if (payload.resolution_evidence?.length) {
    const body = new FormData()
    body.append("status", payload.status)
    if (payload.note != null) body.append("note", payload.note)
    if (payload.status_version != null) body.append("status_version", String(payload.status_version))
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
    }),
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

export function reviewConcernAi(
  id: number,
  payload: { decision: "related" | "irrelevant" | "suspicious" | "needs_review"; reason: string },
) {
  return apiRequest<ConcernAiAssessment>(`/concerns/${id}/ai-review/`, {
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

export function listConcernChat(concernId: number, afterId?: number) {
  const params = new URLSearchParams()
  if (afterId) params.set("after", String(afterId))
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

export function getResponderDashboardSummary() {
  return apiRequest<ResponderRoleSummary>("/dashboard/responder/summary/")
}

export function listAnnouncements() {
  return apiRequest<Announcement[]>("/announcements/")
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

export interface LiveMapRoute {
  alert_id: number
  assignment_id: number
  responder_id: number
  status: "ok" | "unavailable"
  distance_meters: number | null
  eta_seconds: number | null
  geometry: { type: "LineString"; coordinates: [number, number][] } | null
}

export interface MapDispatchPolicy {
  id: number | null
  barangay: string
  acceptance_center_latitude: number | string
  acceptance_center_longitude: number | string
  acceptance_radius_meters: number
  out_of_zone_action: "block" | "warn" | "review"
  witness_radius_meters: number
  responder_nearby_radius_meters: number
  updated_at: string | null
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

/** Public community concern pin on resident alerts map */
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

/** Active emergency pin — no reporter / responder GPS */
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
