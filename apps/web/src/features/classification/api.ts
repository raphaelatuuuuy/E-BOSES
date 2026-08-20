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
  /** null when no pin was sent; accepted=false when the pin was blocked. */
  location?: {
    accepted: boolean
    action: "accept" | "warn" | "review" | "block"
    summary?: string
    message?: string
  } | null
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
  body.append("category", input.category)
  body.append("mode", input.mode)
  body.append("language", input.language)
  for (const file of input.files ?? []) body.append("files", file)
  return apiRequest<{ description: string }>("/concerns/classification/generate-sample/", {
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
