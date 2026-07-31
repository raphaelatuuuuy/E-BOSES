import { apiRequest } from "@/lib/api"

export type ConcernCategory = {
  key: string
  label: string
  enabled: boolean
  detected_labels: string[]
}

export type ConcernClassificationConfig = {
  revision: number
  image_model: string
  text_model: string
  image_available?: boolean
  text_available?: boolean
  image_confidence_threshold: number
  text_relevance_threshold: number
  duplicate_similarity_threshold: number
  minimum_description_length: number
  mismatch_action: "manual_review" | "request_resubmission" | "reject"
  flag_suspicious: boolean
  flag_duplicates: boolean
  report_duplicate_detection_enabled?: boolean
  report_duplicate_action?: "warn" | "block" | "official_review"
  report_duplicate_lookback_days?: number
  report_duplicate_distance_meters?: number
  report_duplicate_similarity_threshold?: number
  report_duplicate_location_precision?: number
  flag_irrelevant: boolean
  notify_reviewer: boolean
  suspicious_terms: string[]
  supported_classes?: string[]
  label_mappings: Record<string, string>
  category_keywords: Record<string, string[]>
  mapping_targets?: Array<{ key: string; label: string; group: "concern" | "emergency" | string }>
  categories: ConcernCategory[]
  metrics?: {
    image_accuracy?: number | null
    text_accuracy?: number | null
    auto_validated?: number
    flagged?: number
    tested?: number
  }
}

export type ImageClassificationResult = {
  detected_label: string
  detected_category: string
  selected_category: string
  confidence: number
  outcome: "match" | "mismatch" | "needs_review"
  message?: string
  annotated_image?: string
  objects?: Array<{ label: string; display_label?: string; confidence: number; category?: string; bbox?: number[] }>
}

export type ReportValidationResult = {
  classification: "related" | "irrelevant" | "suspicious" | "needs_review"
  confidence: number
  category_match: boolean | null
  duplicate: boolean
  duplicate_similarity?: number | null
  outcome: "approved" | "flagged" | "needs_review"
  explanation?: string
  relevance?: "VALID" | "UNCLEAR" | "IRRELEVANT"
  primary_category?: string
  possible_categories?: string[]
  content_flags?: string[]
  image_flags?: string[]
  text_assessment?: string
  photo_assessment?: string
  recognized_photo_items?: string[]
  visual_summary?: string
  mismatch_reason?: string
  image_review_limited?: boolean
  image_review_message?: string
  privacy_sensitive_information_detected?: boolean
  disturbing_content_detected?: boolean
  urgent_attention?: boolean
  evidence_relationship?: "supports_report" | "partially_supports_report" | "contradicts_report" | "no_useful_image_evidence" | "image_unavailable" | string
  severity?: "low" | "medium" | "high"
  ai_result_uncertain?: boolean
  recommended_action?: string
  public_media_treatment?: string
  image?: ImageClassificationResult & { available?: boolean; objects?: ImageClassificationResult["objects"] }
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
    label_mappings: raw?.label_mappings ?? {},
    category_keywords: raw?.category_keywords ?? {},
    mapping_targets: raw?.mapping_targets ?? [],
    categories: (raw?.categories ?? []).map((category: RawJson) => ({
      key: category.key ?? category.code,
      label: category.label ?? category.name,
      enabled: category.enabled !== false,
      detected_labels: category.detected_labels ?? category.keywords ?? [],
    })),
  }
}

export function testConcernImage(file: File, category: string) {
  const body = new FormData()
  body.append("file", file)
  body.append("category", category)
  return apiRequest<ImageClassificationResult>("/concerns/classification/test-image/", { method: "POST", body })
}

export function testConcernReport(category: string, description: string) {
  return apiRequest<ReportValidationResult>("/concerns/classification/test-text/", {
    method: "POST",
    body: JSON.stringify({ category, description }),
  })
}

export function testConcernSubmission(input: { file?: File | null; category: string; title?: string; description: string }) {
  const body = new FormData()
  body.append("category", input.category)
  body.append("title", input.title || "Sample report")
  body.append("description", input.description)
  if (input.file) body.append("file", input.file)
  return apiRequest<ReportValidationResult>("/concerns/classification/test-submission/", { method: "POST", body })
}
