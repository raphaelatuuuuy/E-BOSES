import { apiRequest } from "@/lib/api"

export type ConcernCategory = {
  key: string
  label: string
  enabled: boolean
  photo_required: boolean
  description_required: boolean
  location_required: boolean
}

/** Whether a service is working, in the three words officials see. */
export type ServiceStatus = {
  status: "available" | "limited" | "unavailable"
  reason?: string
}

export type MediaIntegrityAction =
  | "flag_notify"
  | "hold"
  | "request_resubmission"
  | "auto_reject"

export type EmergencyMediaIntegrityAction = "flag_notify" | "hold"

export type ConcernClassificationConfig = {
  revision: number
  text_model: string
  text_relevance_threshold: number
  duplicate_similarity_threshold: number
  minimum_description_length: number
  mismatch_action: "auto_correct" | "request_resubmission" | "reject"
  flag_suspicious: boolean
  flag_duplicates: boolean
  report_duplicate_detection_enabled?: boolean
  report_duplicate_action?: "warn" | "block"
  report_duplicate_lookback_days?: number
  report_duplicate_distance_meters?: number
  report_duplicate_similarity_threshold?: number
  report_duplicate_location_precision?: number
  content_safety_spam_action?: "auto_reject" | "hold"
  content_safety_abusive_action?: "hold" | "auto_reject"
  content_safety_threat_action?: "accept_flag_notify" | "hold"
  content_safety_sensitive_action?: "restrict_hold" | "auto_blur_accept"
  require_ongoing_emergency_confirmation?: boolean
  street_imagery_enabled?: boolean
  street_imagery_categories?: string[]
  street_imagery_radius_meters?: number
  street_imagery_action?: "warn" | "request_resubmission" | "reject"
  photo_duplicate_llm_enabled?: boolean
  photo_duplicate_candidate_limit?: number
  media_integrity_enabled?: boolean
  media_integrity_action?: MediaIntegrityAction
  media_integrity_min_confidence?: number
  media_integrity_second_opinion_enabled?: boolean
  media_integrity_emergency_action?: EmergencyMediaIntegrityAction
  flag_irrelevant: boolean
  suspicious_terms: string[]
  category_keywords: Record<string, string[]>
  categories: ConcernCategory[]
  services?: {
    report_review: ServiceStatus
    media_protection: ServiceStatus
  }
  metrics?: {
    auto_validated?: number
    rejected?: number
    tested?: number
  }
}

/** The screen intentionally keeps the system in its careful operating mode. */
export const CAREFUL_REVIEW_VALUES = {
  text_relevance_threshold: 0.8,
  duplicate_similarity_threshold: 0.78,
  minimum_description_length: 40,
} as const

export type ReportValidationResult = {
  classification: "related" | "irrelevant" | "suspicious" | "needs_review"
  category_match: boolean | null
  duplicate: boolean
  duplicate_similarity?: number | null
  explanation?: string
  /**
   * The real privacy stage, run against the sample photo. Nothing is stored —
   * `protected_image` is a data URI for display only, and is empty unless
   * something was actually blurred.
   */
  privacy?: {
    state:
      | "unchecked"
      | "not_required"
      | "protected"
      | "sensitive_review_required"
      | "no_match_found"
      | "not_configured"
      | "failed"
    requested_classes?: string[]
    detected_classes?: string[]
    blurred_count?: number
    protected_image?: string
  }
  relevance?: "VALID" | "UNCLEAR" | "IRRELEVANT"
  primary_category?: string
  possible_categories?: string[]
  detected_objects?: string[]
  text_assessment?: string
  photo_assessment?: string
  evidence_relationship?:
    | "supports_report"
    | "partially_supports_report"
    | "contradicts_report"
    | "no_useful_image_evidence"
    | "image_unavailable"
    | "image_review_failed"
    | string
  missing_information?: string[]
  urgent_attention?: boolean
  severity?: "low" | "medium" | "high"
  privacy_scan_required?: boolean
  suspected_sensitive_classes?: string[]
  ai_result_uncertain?: boolean
  recommended_action?: string
  short_explanation?: string
  /** null when no photo was sent, false when one was sent and could not be read. */
  image_review_succeeded?: boolean | null
  image_uploaded?: boolean
  image_error?: "" | "rejected" | "unreadable"
  resident_message?: string
  matched_emergency_type?: string
  emergency_routing_reason?: string
  ongoing_emergency_confirmation_required?: boolean
  incident_timing?: "ongoing" | "ended" | "historical" | "planned" | "hypothetical" | "unclear"
  incident_timing_reason?: string
  current_danger?: boolean
  title_preview?: { official_title: string; summary: string }
  /** null when no pin was sent; accepted=false when the pin was blocked. */
  location?: {
    accepted: boolean
    action: "accept" | "warn" | "review" | "block"
    summary?: string
    message?: string
  } | null
  media_integrity?: {
    status: "checked" | "skipped" | "disabled"
    reason?: string
    overall?: string
    findings?: {
      index: number
      verdict: string
      confidence: number
      signals?: string[]
      note?: string
    }[]
  } | null
  street_imagery?: {
    status: "checked" | "skipped" | "no_coverage"
    reason?: string
    verdict?: "area_matches" | "area_mismatch" | "inconclusive"
    explanation?: string
    pano_id?: string
    captured_date?: string
    distance_meters?: number
    latitude?: number
    longitude?: number
    image?: string
  } | null
  photo_duplicate_llm?: {
    checked: boolean
    skip_reason?: string
    candidate_count: number
    comparisons: {
      concern_id?: number
      tracking_id?: string
      captured_at?: string
      verdict: "same_issue" | "different" | "uncertain"
      reason?: string
      image?: string
    }[]
  } | null
  /** The unit this report would be routed to, per the configured routing rules. */
  assigned_unit?: { code: string; name: string } | null
}

export function getConcernClassificationConfig() {
  return apiRequest<RawJson>("/concerns/classification/").then(normalizeConfig)
}

export function saveConcernClassificationConfig(config: ConcernClassificationConfig) {
  return apiRequest<RawJson>("/concerns/classification/", {
    method: "PATCH",
    body: JSON.stringify(config),
  }).then(normalizeConfig)
}

export function resetConcernClassificationConfig() {
  return apiRequest<RawJson>("/concerns/classification/reset/", { method: "POST" }).then(normalizeConfig)
}

/**
 * Unnormalised JSON straight off the wire.
 *
 * Every use of this type is a value that has NOT been validated yet — it is the
 * input to the `normalize*` functions below, whose entire job is to turn it into
 * the typed shapes this module exports. Nothing outside those functions should
 * ever hold a RawJson.
 *
 * Deliberately `any` rather than `unknown`: the normalisers walk deep, optional,
 * server-defined structures, and threading `unknown` through them would mean a
 * type guard per property read for no added safety — the runtime `??` and
 * `Array.isArray` fallbacks already do that work. Confining the escape hatch to
 * one named, documented alias is the point; the twenty scattered inline `any`s
 * this replaced said nothing about why they were there.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawJson = any

function normalizeConfig(raw: RawJson): ConcernClassificationConfig {
  return {
    ...raw,
    ...CAREFUL_REVIEW_VALUES,
    category_keywords: raw?.category_keywords ?? {},
    categories: (raw?.categories ?? []).map((category: RawJson) => ({
      key: category.key ?? category.code,
      label: category.label ?? category.name,
      enabled: category.enabled !== false,
      photo_required: category.photo_required === true,
      description_required: category.description_required !== false,
      location_required: category.location_required !== false,
    })),
  }
}

export function testConcernReport(category: string, description: string) {
  return apiRequest<ReportValidationResult>("/concerns/classification/test-text/", {
    method: "POST",
    body: JSON.stringify({ category, description }),
  })
}

export function testConcernSubmission(input: {
  files?: File[]
  category: string
  title?: string
  description: string
  latitude?: number | null
  longitude?: number | null
}) {
  const body = new FormData()
  body.append("category", input.category)
  body.append("title", input.title || "Sample report")
  body.append("description", input.description)
  for (const file of input.files ?? []) body.append("files", file)
  if (input.latitude != null && input.longitude != null) {
    body.append("latitude", String(input.latitude))
    body.append("longitude", String(input.longitude))
  }
  return apiRequest<ReportValidationResult>("/concerns/classification/test-submission/", { method: "POST", body })
}

export type EmergencySimulationReview = ReportValidationResult

export type SimulationCommunity = { id: number; name: string }

export type LocationResolution = {
  source: "sms_gps" | "sms_geocoded" | "web_gps" | "message_area" | "recent_account_location" | "profile_community" | "home_context" | "none"
  freshness: "fresh" | "stale" | "not_available"
  state: "confirmed" | "reported" | "fallback" | "ambiguous" | "unknown"
  community: SimulationCommunity | null
  area_label: string
  age_seconds: number | null
  latitude: number | null
  longitude: number | null
  canonical_street: string
  candidate_communities: SimulationCommunity[]
  boundary: GeoJsonGeometry | null
  has_destination: boolean
  reason: string
}

export type GeoJsonGeometry = {
  type: string
  coordinates: unknown[]
}

export type RoutePreview = {
  status: "ok" | "stale" | "unavailable" | "no_destination" | string
  profile: string
  distance_meters: number | null
  eta_seconds: number | null
  geometry: GeoJsonGeometry | null
  summary: string
  origin_snap?: { latitude: number; longitude: number; meters: number | null } | null
  destination_snap?: { latitude: number; longitude: number; meters: number | null } | null
  approach?: { geometry?: GeoJsonGeometry | null } | null
}

export type EmergencySimulationResponderPreview =
  | {
      found: true
      responder: { id: number; full_name: string; latitude: number | null; longitude: number | null }
      distance_meters: number | null
      eta_seconds: number | null
    }
  | { found: false; reason: string }

export type EmergencySimulationUnit = { id: number; name: string; short_name: string }

export type EmergencySimulationResult =
  | {
      path?: undefined
      requires_confirmation: boolean
      matched_emergency_type: string
      emergency_routing_reason: string
      likely_unit: EmergencySimulationUnit | null
      image_uploaded: boolean
      location: LocationResolution
      privacy?: ReportValidationResult["privacy"]
      review: EmergencySimulationReview
    }
  | {
      requires_confirmation: false
      path: "concern"
      image_uploaded: boolean
      location: LocationResolution
      privacy?: ReportValidationResult["privacy"]
      review: EmergencySimulationReview
    }
  | {
      requires_confirmation: false
      path: "emergency"
      matched_emergency_type: string
      image_uploaded: boolean
      privacy?: ReportValidationResult["privacy"]
      location: LocationResolution
      routing: {
        department: { id: number; name: string; short_name: string } | null
        routing_reason: string
        responder_preview: EmergencySimulationResponderPreview
        scope: "local" | "cross_community" | "manual_dispatch"
        manual_dispatch: boolean
        responding_community: SimulationCommunity | null
        route: RoutePreview
        /** A real OSRM route from a random nearby point, only present when no
         * responder was actually found — lets the preview map show an actual
         * road route instead of nothing (or a fake straight line). */
        sample_route: { latitude: number; longitude: number; route: RoutePreview } | null
      }
    }

export function testEmergencySimulation(input: {
  files?: File[]
  title?: string
  description: string
  latitude: number
  longitude: number
  confirmed_ongoing?: boolean | null
}) {
  const body = new FormData()
  body.append("title", input.title || "Sample emergency")
  body.append("description", input.description)
  body.append("latitude", String(input.latitude))
  body.append("longitude", String(input.longitude))
  if (input.confirmed_ongoing != null) body.append("confirmed_ongoing", String(input.confirmed_ongoing))
  for (const file of input.files ?? []) body.append("files", file)
  return apiRequest<EmergencySimulationResult>("/concerns/classification/test-emergency/", { method: "POST", body })
}

export type SmsSimulationSender = {
  status: string
  label: string
  masked_number: string
  resident_name: string
  attached_community: SimulationCommunity | null
}

export type SmsSimulationParsed = {
  is_emergency: boolean
  category_code: string
  category_label: string
  matched_alias: string
  needs_confirmation: boolean
  reported_area: string
  latitude: number | null
  longitude: number | null
  coordinate_status: string
  triage: Record<string, string>
  triage_summary: string
  note: string
  urgency_signal: boolean
  incident_timing: "ongoing" | "ended" | "historical" | "planned" | "hypothetical" | "unclear"
  incident_timing_reason: string
  current_danger: boolean
  unresolved_fields: string[]
} | null

export type SmsSimulationResult = {
  branch: string
  branch_reason: string
  sender: SmsSimulationSender
  command: { keyword: string; reference: string; argument: string; rest: string; recognised: boolean } | null
  parsed: SmsSimulationParsed
  location: LocationResolution | null
  duplicate: { would_suppress: boolean; reference: string; detail: string } | null
  routing: {
    department: { id: number; name: string; short_name: string } | null
    routing_reason: string
    responder:
      | {
          found: boolean
          full_name: string
          unit_name: string
          latitude: number | null
          longitude: number | null
          distance_meters: number | null
          eta_seconds: number | null
        }
      | null
    escalates?: boolean
    scope: "local" | "cross_community" | "manual_dispatch"
    manual_dispatch: boolean
    responding_community: SimulationCommunity | null
    route: RoutePreview
    message: string
  } | null
  ai_assist: {
    applicable: boolean
    reason: string
    ran: boolean
    model: string
    error?: string
    applied: Record<string, { value: string; confidence: number }>
    map_resolution: LocationResolution | null
  } | null
  reply: { text: string; characters: number; segments: number; gsm7: boolean; category_label: string } | null
}

export type SmsSimulationScenario = "default" | "fresh" | "stale" | "context"

export function testSmsSimulation(input: {
  message: string
  sender: "registered" | "unknown" | "needs_review"
  scenario?: SmsSimulationScenario
}) {
  return apiRequest<SmsSimulationResult>("/concerns/classification/test-sms/", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export type SampleMode =
  | "matching"
  | "unrelated"
  | "harassment"
  | "spam"
  | "urgent"
  | "low_quality"

export type SampleLanguage =
  | "filipino"
  | "english"
  | "hybrid"
  | "bisaya"
  | "ilocano"
  | "hiligaynon"
  | "kapampangan"
  | "waray"

export function generateSampleDescription(input: {
  files?: File[]
  category: string
  mode: SampleMode
  language: SampleLanguage
}) {
  const body = new FormData()
  body.append("domain", "concern")
  body.append("category", input.category)
  body.append("mode", input.mode)
  body.append("language", input.language)
  for (const file of input.files ?? []) body.append("files", file)
  return apiRequest<{ description: string }>("/concerns/classification/generate-sample/", {
    method: "POST",
    body,
  })
}

export function generateCommunitySampleContent(input: { reason: ContentFlagReason; language: SampleLanguage }) {
  const body = new FormData()
  body.append("domain", "community")
  body.append("reason", input.reason)
  body.append("language", input.language)
  return apiRequest<{ description: string }>("/concerns/classification/generate-sample/", {
    method: "POST",
    body,
  })
}

export type ContentFlagReason = "irrelevant" | "false_info" | "sensitive" | "abusive" | "other"

export const CONTENT_FLAG_REASON_OPTIONS: { value: ContentFlagReason; label: string }[] = [
  { value: "irrelevant", label: "Irrelevant" },
  { value: "false_info", label: "False information" },
  { value: "sensitive", label: "Sensitive content" },
  { value: "abusive", label: "Abusive content" },
  { value: "other", label: "Other" },
]

export type CommunityModerationResult = {
  assessment: "clearly_violates" | "borderline" | "likely_acceptable"
  matched_reason: ContentFlagReason | ""
  recommended_disposition: "dismiss" | "take_down"
  short_explanation: string
  model_version: string
  image_review?: { status: string; explanation: string }
}

export function testCommunityModeration(input: {
  content_text: string
  reason: ContentFlagReason
  image?: File | null
}) {
  const body = new FormData()
  body.append("content_text", input.content_text)
  body.append("reason", input.reason)
  if (input.image) body.append("image", input.image)
  return apiRequest<CommunityModerationResult>("/concerns/classification/test-community/", {
    method: "POST",
    body,
  })
}

export type ValidationActivityItem = {
  id: string
  submitted_at: string
  description: string
  category: string
  category_label: string
  location: string
  outcome: "accepted" | "flagged" | "rejected" | "held"
  outcome_label: string
  public_id?: string
}

export type ValidationActivityResponse = {
  results: ValidationActivityItem[]
  count: number
  stats: {
    scanned: number
    auto_validated: number
    flagged: number
    held_for_review: number
    rejected: number
  }
}

export function getValidationActivity(params?: { days?: number; category?: string }) {
  const query = new URLSearchParams()
  if (params?.days) query.set("days", String(params.days))
  if (params?.category) query.set("category", params.category)
  const qs = query.toString()
  return apiRequest<ValidationActivityResponse>(
    `/concerns/classification/activity/${qs ? `?${qs}` : ""}`
  )
}

export type LlmDecisionLogDomain = "concern" | "emergency" | "verification" | "community"

export type LlmDecisionLogEntry = {
  id: number
  run_kind: "production" | "simulation"
  domain: LlmDecisionLogDomain
  created_at: string
  recommended_action: string
  resident_message: string
  assigned_department: { id: number; name: string } | null
  routing_reason: string
  model_version: string
  duration_ms: number | null
  location?: string
  input_snapshot: RawJson
  output_snapshot: RawJson
  content_flag_id?: number | null
  concern_id?: number | null
  record_type?: "concern" | "emergency" | "verification"
  priority?: "low" | "moderate" | "high" | "critical" | null
  tracking_id?: string | null
  report_title?: string | null
  report_description?: string | null
  address?: string | null
  reporter?: {
    name: string
    initials: string
    anonymous: boolean
  } | null
  assigned_unit?: { id: number; name: string } | null
  final_decision?: {
    action: string
    label: string
    reason: string
    source: string
    legacy?: boolean
  }
  submitted_media?: Array<{
    id: number
    label: string
    preview_url: string
    raw_url: string
    privacy_state?: string
  }>
  street_imagery?: {
    status?: "checked" | "skipped" | "no_coverage" | "disabled"
    reason?: string
    verdict?: string
    explanation?: string
    pano_id?: string
    captured_date?: string
    distance_meters?: number
    latitude?: number
    longitude?: number
    image?: string
    image_url?: string
  } | null
}

export type LlmDecisionLogResponse = { results: LlmDecisionLogEntry[]; count: number }

export function getLlmDecisionLog(params?: {
  domain?: LlmDecisionLogDomain
  run_kind?: "production" | "simulation"
  page?: number
  page_size?: number
  search?: string
  days?: number
}) {
  const query = new URLSearchParams()
  if (params?.domain) query.set("domain", params.domain)
  if (params?.run_kind) query.set("run_kind", params.run_kind)
  if (params?.page) query.set("page", String(params.page))
  if (params?.page_size) query.set("page_size", String(params.page_size))
  if (params?.search) query.set("search", params.search)
  if (params?.days) query.set("days", String(params.days))
  const qs = query.toString()
  return apiRequest<LlmDecisionLogResponse>(`/concerns/classification/log/${qs ? `?${qs}` : ""}`)
}

export function rerunLlmDecisionLogStreetImagery(logId: number) {
  return apiRequest<NonNullable<LlmDecisionLogEntry["street_imagery"]>>(
    `/concerns/classification/log/${logId}/street-view/`,
    { method: "POST" },
  )
}

export function revertAutomatedContentAction(flagId: number, staffNote = "Automated moderation action reverted by an official.") {
  return apiRequest(`/concerns/flags/${flagId}/review/`, {
    method: "PATCH",
    body: JSON.stringify({ status: "dismissed", staff_note: staffNote }),
  })
}
