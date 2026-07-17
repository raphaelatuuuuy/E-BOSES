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
  objects?: Array<{ label: string; confidence: number; category?: string; bbox?: number[] }>
}

export type ReportValidationResult = {
  classification: "related" | "irrelevant" | "suspicious"
  confidence: number
  category_match: boolean | null
  duplicate: boolean
  duplicate_similarity?: number | null
  outcome: "approved" | "flagged" | "needs_review"
  explanation?: string
}

export function getConcernClassificationConfig() {
  return apiRequest<any>("/concerns/classification/").then(normalizeConfig)
}

export function saveConcernClassificationConfig(config: ConcernClassificationConfig) {
  return apiRequest<any>("/concerns/classification/", {
    method: "PATCH",
    body: JSON.stringify(config),
  }).then(normalizeConfig)
}

export function resetConcernClassificationConfig() {
  return apiRequest<any>("/concerns/classification/reset/", { method: "POST" }).then(normalizeConfig)
}

function normalizeConfig(raw: any): ConcernClassificationConfig {
  return {
    ...raw,
    label_mappings: raw?.label_mappings ?? {},
    category_keywords: raw?.category_keywords ?? {},
    mapping_targets: raw?.mapping_targets ?? [],
    categories: (raw?.categories ?? []).map((category: any) => ({
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
