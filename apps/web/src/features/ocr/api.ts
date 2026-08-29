import { apiBaseUrl, apiRequest, getAccessToken, refreshSession } from "@/lib/api"

export type OcrServiceState =
  | "not_configured"
  | "healthy"
  | "degraded"
  | "unavailable"
  | "checking"

export type VerificationCaseStatus =
  | "awaiting_email"
  | "queued"
  | "processing"
  | "approved"
  | "rejected"

export type ProofSide = "single" | "front" | "back"

export interface ResidenceProofOption {
  id?: number
  key: string
  name: string
  description: string
  enabled: boolean
  required_sides: ProofSide[]
  min_files: number
  max_files: number
  max_file_size_bytes: number
  accepted_mime_types: string[]
  accepted_extensions: string[]
  required_fields: Array<{ key: string; label: string }>
  instructions?: string
}

export interface ResidentVerificationStatus {
  id?: number
  status: VerificationCaseStatus
  reason_code?: string
  reason?: string
  message?: string
  document_type?: { key: string; name: string } | string | null
  service_status?: OcrServiceState
  queued_at?: string | null
  processing_started_at?: string | null
  decided_at?: string | null
  updated_at?: string | null
  can_retry?: boolean
}

export interface OcrFieldRegion {
  x: number
  y: number
  w: number
  h: number
}

export interface OcrFieldHints {
  labels?: string[]
  expected_keywords?: string[]
  region?: OcrFieldRegion | null
  /** Which sample side this field’s box belongs to (front / back). */
  side?: ProofSide | "front" | "back" | "single"
  multi_line?: boolean
  regex_pattern?: string
  failure_message?: string
  auto_correct?: boolean
  remove_special_chars?: boolean
  case_normalization?: "none" | "uppercase" | "lowercase" | "name" | "title" | string
}

export interface OcrFieldDefinition {
  id?: number
  key: string
  label: string
  description?: string
  data_type: "text" | "date" | "number" | "address" | "name" | "identifier"
  enabled: boolean
  required: boolean
  aliases: string[]
  /** Backend field sides (front / back / single). Kept in sync with extraction_hints.side. */
  sides?: ProofSide[]
  order: number
  normalization?: string
  format?: string
  extraction_hints?: OcrFieldHints
}

/** Resolve which canvas side a field belongs to from hints or backend sides. */
export function resolveFieldSide(field: {
  sides?: ProofSide[] | string[]
  extraction_hints?: OcrFieldHints | null
}): "front" | "back" {
  const hintSide = String(field.extraction_hints?.side || "")
    .trim()
    .toLowerCase()
  if (hintSide === "back") return "back"
  if (hintSide === "front" || hintSide === "single") return "front"
  const sides = (field.sides ?? []).map((s) => String(s).toLowerCase())
  // Only back (no front/single) → back field
  if (sides.includes("back") && !sides.includes("front") && !sides.includes("single")) {
    return "back"
  }
  return "front"
}

export interface OcrRuleDefinition {
  id?: number
  key?: string
  name?: string
  field_key: string
  rule_type:
    | "required"
    | "profile_match"
    | "similarity"
    | "recency"
    | "allowed_value"
    | "contains_keyword"
    | "format"
    | "not_expired"
    | "image_quality"
  operator:
    | "exists"
    | "matches_profile"
    | "gte"
    | "lte"
    | "equals"
    | "one_of"
    | "contains_any"
    | "within_days"
    | "not_expired"
  value?: string | number | boolean | string[] | Record<string, unknown> | null
  threshold?: number | null
  enabled: boolean
  on_failure?: "reject" | "warning"
  message?: string
  order: number
}

export interface OcrDocumentType {
  id?: number
  key: string
  name: string
  description: string
  enabled: boolean
  order: number
  required_sides: ProofSide[]
  min_files: number
  max_files: number
  max_file_size_bytes: number
  accepted_mime_types: string[]
  accepted_extensions: string[]
  keywords: string[]
  provider_keywords: string[]
  fields: OcrFieldDefinition[]
  rules: OcrRuleDefinition[]
  sample_urls?: string[]
  template_name?: string
  template_version?: string
  expected_title?: string
  accept_rotated?: boolean
  sample_url?: string | null
  sample_original_filename?: string
  /**
   * Whether a reference sample exists for this type. Read from the same rows
   * the pipeline reads, so a false here means the layout comparison really
   * cannot run — only the picture check does.
   */
  has_reference_sample?: boolean
  /** Per-side canvas samples (front / back / single). */
  samples?: Array<{
    side: ProofSide
    label?: string
    url: string
    filename?: string
  }>
  template_settings?: Record<string, unknown>
  category?: string
}

export interface OcrAdvancedSettings {
  document_recency_days: number
  reject_blurry_images: boolean
  outage_retry_enabled: boolean
  /**
   * The backend also accepts "manual_review" and uses it as its default. The
   * builder never offers it: a case sent there has no screen behind it today,
   * so the resident would wait on nobody.
   */
  failure_action: "reject" | "request_resubmission" | "manual_review"
  /**
   * How sure the picture check has to be before its opinion counts against a
   * resident. Whether it runs at all is not a setting: it always does.
   */
  id_integrity_min_confidence: number
}

export interface OcrConfiguration {
  id?: number
  revision: number
  status: "draft" | "published" | "archived"
  version?: number
  published_version?: number | null
  document_types: OcrDocumentType[]
  settings: OcrAdvancedSettings
  updated_at?: string | null
  updated_by?: string | null
}

export interface OcrServiceHealth {
  status: OcrServiceState
  configured: boolean
  provider?: string
  model?: string
  message?: string
  error_message?: string
  consecutive_failures?: number
  checked_at?: string | null
  last_success_at?: string | null
  next_check_at?: string | null
  pending_cases?: number
}

export interface OcrTestField {
  key: string
  label: string
  value: string
  confidence: number | null
  bbox?: number[] | null
  data_type?: string
  extraction_method?: string | null
}

export interface OcrTemplateMatchCheck {
  key?: string
  label?: string
  passed: boolean
  detail?: string
}

export interface OcrTemplateMatch {
  passed: boolean
  score?: number
  checks?: OcrTemplateMatchCheck[]
}

/**
 * What the picture check made of a submitted ID.
 *
 * `format_verdict` answers "is this the same kind of document as our stored
 * sample" and is `no_reference` when no sample has been uploaded yet.
 * `integrity_verdict` answers "does this look like a genuine card photographed
 * by a camera". `authentic` means only that nothing was found — never proof.
 */
export interface OcrIdIntegrity {
  checked: boolean
  side?: ProofSide | "front" | "back" | "single"
  compared_to_sample: boolean
  format_verdict: "format_matches" | "format_mismatch" | "no_reference" | "inconclusive"
  integrity_verdict:
    | "authentic"
    | "suspected_edit"
    | "suspected_ai"
    | "impossible_content"
    | "photo_of_screen"
    | "inconclusive"
  confidence: number
  flagged: boolean
  integrity_advisory?: boolean
  /** Controlled user-facing feedback; raw model signals are not displayed. */
  feedback?: string
  signals: string[]
  note?: string
}

/**
 * Which of the three checks a submission reached, and which one stopped it.
 *
 * The layers run cheapest-and-most-certain first — file bytes, then the
 * picture, then the text — and each only runs when the one before it passed.
 * `reached` is therefore also the last stage that produced an answer: when it
 * is not "ocr", no text was read at all and there are no extracted fields to
 * show.
 */
export type OcrPipelineStage = "media_forensics" | "id_integrity" | "ocr"

export interface OcrPipelineForensics {
  checked: boolean
  flagged: boolean
  /** Which forensics layer objected: exif, png_metadata, c2pa, visual_tamper. */
  layer?: string
  message?: string
}

export interface OcrPipeline {
  reached: OcrPipelineStage
  blocked_by: OcrPipelineStage | null
  forensics: OcrPipelineForensics
  integrity_checked?: boolean
  integrity_checks?: OcrIdIntegrity[]
  /** What the resident would be told. */
  message?: string
  /** The specific finding behind that message, for the official only. */
  detail?: string
}

export interface OcrReadability {
  reason: "too_small" | "out_of_focus" | "too_dark" | "too_bright" | "low_contrast" | string
  message: string
  metrics?: {
    width?: number
    height?: number
    brightness?: number
    contrast?: number
    sharpness?: number
  }
}

export interface OcrTestResult {
  id: number | string
  filename: string
  document_type?: { key: string; name: string } | string | null
  status: "queued" | "processing" | "passed" | "warning" | "failed" | "error" | "cancelled"
  confidence?: number | null
  overall_confidence?: number | null
  extracted_fields?: OcrTestField[] | Record<string, unknown>
  extraction_json?: Record<string, string>
  template_match?: OcrTemplateMatch | null
  id_integrity?: OcrIdIntegrity | null
  id_integrity_checks?: OcrIdIntegrity[]
  pipeline?: OcrPipeline | null
  /** Why OCR read little or nothing from the photo, when it did. */
  readability?: OcrReadability | null
  rule_results?: VerificationRuleResult[]
  error?: string
  created_at?: string
  completed_at?: string | null
  /** Which photo side this test run targeted (front / back). */
  test_side?: ProofSide | "front" | "back" | "single" | null
  /** OCR engine that produced this result ("ocrspace" | "easyocr"). */
  provider?: "ocrspace" | "easyocr" | string
  model?: string
  provider_job_id?: string
  /** Protected URL for the uploaded image used in this test run. */
  image_url?: string | null
  /** Configured per-side reference samples used by the image comparison. */
  reference_images?: Array<{
    side: ProofSide | "front" | "back" | "single"
    label?: string
    url: string
    filename?: string
  }>
}

/** Normalize backend extracted_fields (object or array) into a UI list. */
export function normalizeExtractedFields(raw: unknown): OcrTestField[] {
  if (!raw) return []
  if (Array.isArray(raw)) {
    return raw.map((item, index) => {
      const field = (item ?? {}) as Record<string, unknown>
      const key = String(field.key ?? field.code ?? `field_${index}`)
      return {
        key,
        label: String(field.label ?? key.replaceAll("_", " ")),
        value: String(field.value ?? ""),
        confidence: field.confidence == null ? null : Number(field.confidence),
        bbox: Array.isArray(field.bbox) ? (field.bbox as number[]) : null,
        data_type: field.data_type != null ? String(field.data_type) : undefined,
        extraction_method: field.extraction_method != null ? String(field.extraction_method) : null,
      }
    })
  }
  if (typeof raw === "object") {
    return Object.entries(raw as Record<string, unknown>)
      .filter(([key]) => !key.startsWith("__"))
      .map(([key, item]) => {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const field = item as Record<string, unknown>
          return {
            key,
            label: String(field.label ?? key.replaceAll("_", " ")),
            value: String(field.value ?? ""),
            confidence: field.confidence == null ? null : Number(field.confidence),
            bbox: Array.isArray(field.bbox) ? (field.bbox as number[]) : null,
            data_type: field.data_type != null ? String(field.data_type) : undefined,
            extraction_method: field.extraction_method != null ? String(field.extraction_method) : null,
          }
        }
        return {
          key,
          label: key.replaceAll("_", " "),
          value: item == null ? "" : String(item),
          confidence: null,
          bbox: null,
        }
      })
  }
  return []
}

export interface VerificationResident {
  id: number
  full_name: string
  email?: string
  phone_number?: string
  address?: string
  date_of_birth?: string | null
}

export interface VerificationProof {
  id: number
  filename: string
  original_filename?: string
  side?: ProofSide
  mime_type?: string
  preview_url?: string
  raw_url?: string
  uploaded_at?: string
}

export interface VerificationExtractedField {
  key: string
  label: string
  value: string
  confidence: number | null
  status?: "passed" | "warning" | "failed" | "missing"
}

export type SimulatedProfileKey =
  | "first_name"
  | "middle_name"
  | "last_name"
  | "gender"
  | "date_of_birth"
  | "address"

/** Resident details an official can type to simulate what a resident enters at sign-up. */
export type SimulatedProfile = Partial<Record<SimulatedProfileKey, string>>

export interface VerificationRuleResult {
  key?: string
  code?: string
  name?: string
  label?: string
  field?: string | null
  rule_type?: string
  operator?: string
  /** For profile_match rules: which resident profile key this rule compares to. */
  profile?: string | null
  on_failure?: "warning" | "reject" | string
  passed: boolean | null
  score?: number | null
  message?: string
  detail?: string
  confidence?: number | null
  template_check?: boolean
}

export interface VerificationAttempt {
  id: number
  status: string
  trigger?: string
  service_status?: OcrServiceState
  confidence?: number | null
  ocr_confidence?: number | null
  error_code?: string
  error_message?: string
  failure_reason_code?: string
  failure_reason?: string
  duplicate_match_found?: boolean
  duplicate_identity_matches?: Array<{
    field_code: string
    matching_user_id: number
    matching_case_id: number | null
  }>
  extracted_fields?: Record<string, { label?: string; value?: string; confidence?: number | null }>
  rule_results?: VerificationRuleResult[]
  started_at?: string | null
  completed_at?: string | null
  created_at?: string
}

export interface OcrAuditEntry {
  id: number
  action: string
  actor?: string | null
  detail?: string
  created_at: string
}

interface ListEnvelope<T> {
  results?: T[]
  items?: T[]
  document_types?: T[]
  count?: number
}

function listFrom<T>(payload: T[] | ListEnvelope<T>) {
  if (Array.isArray(payload)) return payload
  return payload.results ?? payload.items ?? payload.document_types ?? []
}

/** Derive required_sides from either UI shape or backend flags. */
function normalizeRequiredSides(document: {
  required_sides?: ProofSide[]
  allowed_sides?: ProofSide[]
  requires_front?: boolean
  requires_back?: boolean
}): ProofSide[] {
  if (document.required_sides?.length) return document.required_sides as ProofSide[]
  if (document.allowed_sides?.length) {
    const sides = document.allowed_sides as ProofSide[]
    // Prefer explicit front+back when both flags or both sides present
    if (sides.includes("front") && sides.includes("back")) return ["front", "back"]
    if (sides.includes("front") && !sides.includes("single")) return ["front"]
    if (sides.includes("single")) return ["single"]
    return sides
  }
  if (document.requires_front && document.requires_back) return ["front", "back"]
  if (document.requires_front) return ["front"]
  if (document.requires_back) return ["back"]
  return ["single"]
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

function normalizeConfiguration(raw: RawJson): OcrConfiguration {
  const settings = raw?.settings ?? {}
  const topLevelRules = raw?.rules ?? []
  const documentTypes = (raw?.document_types ?? []).map((document: RawJson) => {
    const fields = (document.fields ?? []).map((field: RawJson) => {
      const hints =
        field.extraction_hints && typeof field.extraction_hints === "object"
          ? { ...field.extraction_hints }
          : {}
      const sides = Array.isArray(field.sides) ? field.sides : []
      const resolvedSide = resolveFieldSide({
        sides,
        extraction_hints: hints,
      })
      // Always materialize side on hints so UI never loses back-side assignment after reload.
      hints.side = resolvedSide
      return {
        ...field,
        key: field.key ?? field.code,
        order: field.order ?? field.display_order ?? 0,
        aliases: field.aliases ?? [],
        sides: sides.length ? sides : [resolvedSide],
        normalization: field.normalization ?? "none",
        format: field.format ?? "none",
        extraction_hints: hints,
      }
    })
    const fieldById = new Map(fields.map((field: RawJson) => [field.id, field.key]))
    return ({
    ...document,
    key: document.key ?? document.code,
    name: document.name || document.template_name || document.code || "Proof type",
    description: document.description || "",
    enabled: document.enabled !== false,
    order: document.order ?? document.display_order ?? 0,
    required_sides: normalizeRequiredSides(document),
    min_files:
      document.min_files ??
      (document.requires_front && document.requires_back ? 2 : 1),
    max_files: Math.max(
      document.max_files ?? 1,
      document.requires_front && document.requires_back ? 2 : 1,
      Array.isArray(document.allowed_sides) && document.allowed_sides.includes("front") && document.allowed_sides.includes("back")
        ? 2
        : 1,
    ),
    max_file_size_bytes: document.max_file_size_bytes ?? 10 * 1024 * 1024,
    accepted_extensions: document.accepted_extensions ?? ["png", "jpg", "jpeg", "webp"],
    keywords: document.keywords ?? [],
    provider_keywords: document.provider_keywords ?? document.provider_names ?? [],
    template_name: document.template_name || document.name,
    template_version: document.template_version || "v1.0",
    expected_title: document.expected_title || "",
    accept_rotated: document.accept_rotated !== false,
    sample_url: document.sample_url ?? null,
    sample_original_filename: document.sample_original_filename || "",
    has_reference_sample: Boolean(document.has_reference_sample),
    samples: Array.isArray(document.samples)
      ? document.samples.map((sample: RawJson) => ({
          side: (sample.side || "single") as ProofSide,
          label: sample.label || String(sample.side || "single"),
          url: sample.url || "",
          filename: sample.filename || sample.original_filename || "",
        }))
      : document.sample_url
        ? [
            {
              side: normalizeRequiredSides(document).includes("front")
                ? ("front" as ProofSide)
                : ("single" as ProofSide),
              label: normalizeRequiredSides(document).includes("front") ? "Front" : "Single",
              url: document.sample_url,
              filename: document.sample_original_filename || "",
            },
          ]
        : [],
    template_settings: document.template_settings || {},
    fields,
    rules: ([
      ...(document.rules ?? []),
      ...topLevelRules.filter((rule: RawJson) =>
        rule.document_type_id === document.id ||
        rule.document_type === document.code ||
        rule.document_type === document.key,
      ),
    ]).map((rule: RawJson) => ({
      ...rule,
      key: rule.key ?? rule.code,
      name: rule.name ?? rule.code ?? "Validation rule",
      rule_type: rule.rule_type ?? "required",
      on_failure: rule.on_failure === "manual_review" ? "reject" : (rule.on_failure ?? "reject"),
      threshold: rule.threshold ?? null,
      field_key: rule.field_key ?? rule.field?.code ?? fieldById.get(rule.field_id) ?? (typeof rule.value === "object" && rule.value ? rule.value.field ?? "" : ""),
      order: rule.order ?? rule.display_order ?? 0,
      enabled: rule.enabled !== false,
    })),
  })
  })
  return {
    ...raw,
    document_types: documentTypes,
    settings: {
      document_recency_days: settings.document_recency_days ?? settings.recency_days ?? 90,
      reject_blurry_images: settings.reject_blurry_images !== false,
      outage_retry_enabled: settings.outage_retry_enabled !== false,
      failure_action: normalizeFailureAction(settings.failure_action),
      id_integrity_min_confidence: normalizeConfidence(settings.id_integrity_min_confidence),
    },
  }
}

function normalizeFailureAction(value: unknown): OcrAdvancedSettings["failure_action"] {
  if (value === "reject" || value === "request_resubmission" || value === "manual_review") {
    return value
  }
  return "reject"
}

function normalizeConfidence(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return 0.7
  return parsed
}

function serializeConfiguration(configuration: OcrConfiguration) {
  return {
    revision: configuration.revision,
    notes: (configuration as OcrConfiguration & { notes?: string }).notes,
    settings: {
      recency_days: configuration.settings.document_recency_days,
      failure_action: configuration.settings.failure_action,
      id_integrity_min_confidence: configuration.settings.id_integrity_min_confidence,
    },
    document_types: configuration.document_types.map((document) => {
      const sides = normalizeRequiredSides(document)
      const needsBoth = sides.includes("front") && sides.includes("back")
      // Explicit payload only — avoid sending canvas sample blob URLs or UI-only fields.
      return {
        id: document.id,
        code: document.key,
        key: document.key,
        name: document.name,
        description: (document.description || "").slice(0, 255),
        enabled: document.enabled !== false,
        category: document.category || "other",
        display_order: document.order ?? 0,
        order: document.order ?? 0,
        allowed_sides: sides,
        required_sides: sides,
        requires_front: sides.includes("front"),
        requires_back: sides.includes("back"),
        min_files: needsBoth ? Math.min(Math.max(document.min_files ?? 2, 2), 2) : Math.min(document.min_files ?? 1, 2),
        max_files: needsBoth ? Math.min(Math.max(document.max_files ?? 2, 2), 2) : Math.min(document.max_files ?? 1, 2),
        max_file_size_bytes: document.max_file_size_bytes ?? 10 * 1024 * 1024,
        accepted_mime_types: document.accepted_mime_types?.length
          ? document.accepted_mime_types
          : ["image/jpeg", "image/png", "image/webp"],
        accepted_extensions: document.accepted_extensions?.length
          ? document.accepted_extensions
          : ["jpg", "jpeg", "png", "webp"],
        keywords: document.keywords ?? [],
        provider_names: document.provider_keywords ?? [],
        provider_keywords: document.provider_keywords ?? [],
        template_name: document.template_name || document.name,
        template_version: document.template_version || "v1.0",
        expected_title: document.expected_title || "",
        accept_rotated: document.accept_rotated !== false,
        template_settings: document.template_settings || {},
        fields: document.fields.map((field) => {
          const side = resolveFieldSide(field)
          const hints = {
            ...(field.extraction_hints ?? {}),
            side,
          }
          return {
            id: field.id,
            code: field.key,
            key: field.key,
            label: field.label,
            data_type: field.data_type,
            enabled: field.enabled !== false,
            required: Boolean(field.required),
            aliases: field.aliases ?? [],
            // Backend model field — drives which side OCR applies the region to.
            sides: [side],
            display_order: field.order,
            order: field.order,
            normalization: field.normalization ?? "none",
            format: field.format ?? "none",
            extraction_hints: hints,
          }
        }),
        // Only send rules whose field still exists on this proof type.
        // NOTE: we intentionally send only string codes for document_type and
        // field, NOT numeric ids. Publishing creates a fresh draft with new
        // pks; local state keeps the old ids. Sending stale ids makes the
        // backend fail its pk lookup and delete the rule. Codes are stable
        // across publish/republish and the backend's field/document lookup
        // already falls back to them.
        rules: document.rules
          .filter((rule) => {
            const fieldKey = rule.field_key || ""
            if (!fieldKey) return true
            return document.fields.some((field) => field.key === fieldKey)
          })
          .map((rule) => ({
            // Omit rule.id too so a stale id doesn't collide with a newly
            // cloned rule row; upsert-by-code handles both create and update.
            code: rule.key,
            key: rule.key,
            name: rule.name ?? rule.key ?? "Validation rule",
            rule_type: rule.rule_type,
            operator: rule.operator,
            value: rule.value ?? null,
            threshold: rule.threshold ?? null,
            enabled: rule.enabled !== false,
            on_failure: rule.on_failure === "reject" ? "manual_review" : (rule.on_failure ?? "manual_review"),
            display_order: rule.order,
            order: rule.order,
            document_type: document.key,
            field: rule.field_key,
            field_key: rule.field_key,
          })),
      }
    }),
  }
}

export function normalizeResidenceProofOptions(payload: ResidenceProofOption[]) {
  return payload.map((option) => {
    const backend = option as ResidenceProofOption & {
      code?: string
      label?: string
      allowed_sides?: ProofSide[]
      requires_front?: boolean
      requires_back?: boolean
      fields?: Array<{ code: string; label: string; required?: boolean }>
    }
    const required_sides = normalizeRequiredSides(backend)
    const needsBoth = required_sides.includes("front") && required_sides.includes("back")
    return {
      ...option,
      key: option.key || backend.code || "",
      name: option.name || backend.label || "Residence proof",
      description: option.description || "",
      required_sides,
      enabled: option.enabled !== false,
      min_files: option.min_files ?? (needsBoth ? 2 : 1),
      max_files: Math.max(option.max_files ?? 1, needsBoth ? 2 : 1, required_sides.length || 1),
      max_file_size_bytes: option.max_file_size_bytes ?? 10 * 1024 * 1024,
      accepted_mime_types: option.accepted_mime_types?.length
        ? option.accepted_mime_types
        : ["image/png", "image/jpeg", "image/webp"],
      accepted_extensions: option.accepted_extensions?.length
        ? option.accepted_extensions
        : ["png", "jpg", "jpeg", "webp"],
      required_fields: option.required_fields?.length
        ? option.required_fields
        : (backend.fields ?? [])
            .filter((field) => field.required)
            .map((field) => ({ key: field.code, label: field.label })),
    }
  })
}

export async function listResidenceProofOptions() {
  // Always read the published catalog (not the draft). After Publish Template,
  // sign-up should only list enabled document types from that version.
  const payload = await apiRequest<
    ResidenceProofOption[] | ListEnvelope<ResidenceProofOption> | { document_types?: ResidenceProofOption[]; version?: number }
  >("/auth/residence-proof-options/", {}, { auth: false })
  const rows = Array.isArray(payload)
    ? payload
    : (payload as { document_types?: ResidenceProofOption[] }).document_types ??
      (payload as ListEnvelope<ResidenceProofOption>).results ??
      (payload as ListEnvelope<ResidenceProofOption>).items ??
      []
  return normalizeResidenceProofOptions(rows).filter((option) => option.enabled !== false)
}

export function getMyResidenceVerification() {
  return apiRequest<{ case: ResidentVerificationStatus | null; user_status?: string }>(
    "/auth/verification/me/",
  ).then((payload) =>
    payload.case
      ? {
          ...payload.case,
          reason_code:
            (payload.case as ResidentVerificationStatus & { review_reason?: string }).review_reason ??
            payload.case.reason_code,
          reason:
            (payload.case as ResidentVerificationStatus & { review_reason?: string }).review_reason ??
            payload.case.reason,
          message:
            (payload.case as ResidentVerificationStatus & { decision_reason?: string }).decision_reason ??
            payload.case.message,
          // Surface account status so the pending page can leave immediately.
          user_status: payload.user_status,
        }
      : null,
  )
}

export function getOcrDraft() {
  return apiRequest<RawJson>("/auth/ocr/config/draft/").then(normalizeConfiguration)
}

export function saveOcrDraft(configuration: OcrConfiguration) {
  return apiRequest<RawJson>("/auth/ocr/config/draft/", {
    method: "PATCH",
    body: JSON.stringify(serializeConfiguration(configuration)),
  }).then(normalizeConfiguration)
}

export function publishOcrDraft(revision: number) {
  return apiRequest<RawJson>("/auth/ocr/config/publish/", {
    method: "POST",
    body: JSON.stringify({ revision }),
  }).then((payload) => ({
    published: normalizeConfiguration(payload.published),
    draft: normalizeConfiguration(payload.draft),
  }))
}

export function resetOcrDraft(revision?: number) {
  return apiRequest<RawJson>("/auth/ocr/config/reset-defaults/", {
    method: "POST",
    body: JSON.stringify({ revision }),
  }).then(normalizeConfiguration)
}

export function getOcrServiceHealth() {
  return apiRequest<RawJson>("/auth/ocr/health/").then((health) => ({
    ...health,
    configured: health.configured ?? health.status !== "not_configured",
    message: health.message ?? health.error_message,
  }) as OcrServiceHealth)
}

export function recheckOcrServiceHealth() {
  return apiRequest<RawJson>("/auth/ocr/health/recheck/", { method: "POST" }).then((health) => ({
    ...health,
    configured: health.configured ?? health.status !== "not_configured",
    message: health.message ?? health.error_message,
  }) as OcrServiceHealth)
}

export function runOcrTest(
  file: File,
  documentType: string,
  side?: ProofSide | "front" | "back" | "single" | null,
  profile?: SimulatedProfile,
) {
  const formData = new FormData()
  formData.append("file", file)
  formData.append("document_type", documentType)
  if (side && side !== "single") {
    formData.append("side", side)
  } else if (side === "single") {
    formData.append("side", "single")
  }
  if (profile) {
    for (const [key, value] of Object.entries(profile)) {
      if (value?.trim()) formData.append(`profile_${key}`, value.trim())
    }
  }
  return apiRequest<OcrTestResult>("/auth/ocr/tests/", {
    method: "POST",
    body: formData,
  }).then((result) => ({
    ...result,
    filename: result.filename || (result as OcrTestResult & { original_filename?: string }).original_filename || file.name,
    confidence: result.confidence ?? result.overall_confidence ?? null,
    overall_confidence: result.overall_confidence ?? result.confidence ?? null,
    extracted_fields: normalizeExtractedFields(result.extracted_fields),
    test_side: side ?? null,
  }))
}

export function uploadTemplateSample(
  documentType: string,
  file: File,
  side: ProofSide | "front" | "back" | "single" = "single",
) {
  const formData = new FormData()
  formData.append("file", file)
  formData.append("side", side)
  return apiRequest<RawJson>(`/auth/ocr/document-types/${encodeURIComponent(documentType)}/sample/`, {
    method: "POST",
    body: formData,
  }).then((document) => ({
    key: document.code || document.key,
    sample_url: document.sample_url,
    sample_original_filename: document.sample_original_filename,
    samples: document.samples || [],
  }))
}

export function deleteTemplateSample(
  documentType: string,
  side: ProofSide | "front" | "back" | "single" = "single",
) {
  return apiRequest<RawJson>(
    `/auth/ocr/document-types/${encodeURIComponent(documentType)}/sample/?side=${encodeURIComponent(side)}`,
    { method: "DELETE" },
  ).then((document) => ({
    key: document.code || document.key,
    sample_url: document.sample_url,
    sample_original_filename: document.sample_original_filename,
    samples: document.samples || [],
  }))
}

export async function fetchTemplateSampleBlob(sampleUrl: string) {
  return fetchAuthorizedProof(sampleUrl)
}

export async function listOcrTests() {
  const payload = await apiRequest<OcrTestResult[] | ListEnvelope<OcrTestResult>>("/auth/ocr/tests/")
  return listFrom(payload)
}

export async function listOcrAudit() {
  const payload = await apiRequest<OcrAuditEntry[] | ListEnvelope<OcrAuditEntry>>("/auth/ocr/audit/")
  return listFrom(payload)
}

function absoluteMediaUrl(rawUrl: string) {
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl
  const base = apiBaseUrl()
  // Same-origin `/api` (Vite proxy) — keep paths relative to the page.
  if (base.startsWith("/")) {
    if (rawUrl.startsWith("/")) return rawUrl
    return `${base}${rawUrl.startsWith("/") ? rawUrl : `/${rawUrl}`}`
  }
  if (rawUrl.startsWith("/api/")) return `${base.replace(/\/api$/, "")}${rawUrl}`
  return `${base}${rawUrl.startsWith("/") ? rawUrl : `/${rawUrl}`}`
}

async function requestMedia(rawUrl: string) {
  const headers = new Headers()
  const token = getAccessToken()
  if (token) headers.set("Authorization", `Bearer ${token}`)
  return fetch(absoluteMediaUrl(rawUrl), { credentials: "include", headers })
}

export async function fetchAuthorizedProof(rawUrl: string) {
  let response = await requestMedia(rawUrl)
  if (response.status === 401) {
    await refreshSession()
    response = await requestMedia(rawUrl)
  }
  if (!response.ok) throw new Error("The protected proof could not be opened.")
  return response.blob()
}
