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
  | "manual_review"
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

export interface OcrFieldDefinition {
  id?: number
  key: string
  label: string
  description?: string
  data_type: "text" | "date" | "number" | "address" | "name" | "identifier"
  enabled: boolean
  required: boolean
  aliases: string[]
  order: number
}

export interface OcrRuleDefinition {
  id?: number
  key?: string
  field_key: string
  operator:
    | "required"
    | "matches_profile"
    | "similarity_at_least"
    | "date_within_days"
    | "date_not_expired"
    | "contains_any"
    | "format"
  value?: string | number | boolean | string[]
  enabled: boolean
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
}

export interface OcrAdvancedSettings {
  confidence_threshold: number
  name_similarity_threshold: number
  address_similarity_threshold: number
  document_recency_days: number
  reject_blurry_images: boolean
  send_uncertain_to_manual_review: boolean
  auto_approve_when_all_rules_pass: boolean
  outage_retry_enabled: boolean
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
}

export interface OcrTestResult {
  id: number | string
  filename: string
  document_type?: { key: string; name: string } | string | null
  status: "queued" | "processing" | "passed" | "warning" | "failed"
  confidence?: number | null
  extracted_fields?: OcrTestField[]
  rule_results?: VerificationRuleResult[]
  error?: string
  created_at?: string
  completed_at?: string | null
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

export interface VerificationRuleResult {
  key?: string
  label: string
  passed: boolean
  message: string
  confidence?: number | null
}

export interface VerificationAttempt {
  id: number
  status: string
  service_status?: OcrServiceState
  confidence?: number | null
  error_code?: string
  error_message?: string
  started_at?: string | null
  completed_at?: string | null
  created_at?: string
}

export interface ResidenceVerificationCase {
  id: number
  reference?: string
  status: VerificationCaseStatus
  reason_code?: string
  reason?: string
  resident: VerificationResident
  document_type?: { key: string; name: string } | string | null
  configuration_version?: number | null
  confidence?: number | null
  proofs: VerificationProof[]
  extracted_fields: VerificationExtractedField[]
  rule_results: VerificationRuleResult[]
  attempts: VerificationAttempt[]
  official_note?: string
  decided_by?: string | null
  queued_at?: string | null
  created_at?: string
  updated_at?: string
  decided_at?: string | null
  can_retry?: boolean
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

function proofOptionsFrom(payload: ResidenceProofOption[] | ListEnvelope<ResidenceProofOption>) {
  return listFrom(payload).map((option) => ({
    ...option,
    enabled: option.enabled !== false,
    required_sides: option.required_sides?.length ? option.required_sides : ["single"],
    min_files: option.min_files ?? 1,
    max_files: option.max_files ?? Math.max(1, option.required_sides?.length ?? 1),
    max_file_size_bytes: option.max_file_size_bytes ?? 2 * 1024 * 1024,
    accepted_mime_types: option.accepted_mime_types?.length
      ? option.accepted_mime_types
      : ["image/png", "image/jpeg"],
    accepted_extensions: option.accepted_extensions?.length
      ? option.accepted_extensions
      : ["png", "jpg", "jpeg"],
    required_fields: option.required_fields ?? [],
  }))
}

export async function listResidenceProofOptions() {
  const payload = await apiRequest<ResidenceProofOption[] | ListEnvelope<ResidenceProofOption>>(
    "/auth/residence-proof-options/",
    {},
    { auth: false },
  )
  return proofOptionsFrom(payload).filter((option) => option.enabled)
}

export function getMyResidenceVerification() {
  return apiRequest<ResidentVerificationStatus>("/auth/verification/me/")
}

export function getOcrDraft() {
  return apiRequest<OcrConfiguration>("/auth/ocr/config/draft/")
}

export function saveOcrDraft(configuration: OcrConfiguration) {
  return apiRequest<OcrConfiguration>("/auth/ocr/config/draft/", {
    method: "PATCH",
    body: JSON.stringify(configuration),
  })
}

export function publishOcrDraft(revision: number) {
  return apiRequest<OcrConfiguration>("/auth/ocr/config/publish/", {
    method: "POST",
    body: JSON.stringify({ revision }),
  })
}

export function resetOcrDraft(revision?: number) {
  return apiRequest<OcrConfiguration>("/auth/ocr/config/reset/", {
    method: "POST",
    body: JSON.stringify({ revision }),
  })
}

export function getOcrServiceHealth() {
  return apiRequest<OcrServiceHealth>("/auth/ocr/health/")
}

export function recheckOcrServiceHealth() {
  return apiRequest<OcrServiceHealth>("/auth/ocr/health/recheck/", { method: "POST" })
}

export function runOcrTest(file: File, documentType: string) {
  const formData = new FormData()
  formData.append("file", file)
  formData.append("document_type", documentType)
  return apiRequest<OcrTestResult>("/auth/ocr/tests/", {
    method: "POST",
    body: formData,
  })
}

export async function listOcrTests() {
  const payload = await apiRequest<OcrTestResult[] | ListEnvelope<OcrTestResult>>("/auth/ocr/tests/")
  return listFrom(payload)
}

export async function listVerificationCases(filters: { status?: string; search?: string } = {}) {
  const params = new URLSearchParams()
  if (filters.status && filters.status !== "all") params.set("status", filters.status)
  if (filters.search?.trim()) params.set("search", filters.search.trim())
  const query = params.toString() ? `?${params.toString()}` : ""
  const payload = await apiRequest<ResidenceVerificationCase[] | ListEnvelope<ResidenceVerificationCase>>(
    `/auth/ocr/cases/${query}`,
  )
  return listFrom(payload)
}

export function getVerificationCase(id: number | string) {
  return apiRequest<ResidenceVerificationCase>(`/auth/ocr/cases/${id}/`)
}

export function approveVerificationCase(id: number, note: string) {
  return apiRequest<ResidenceVerificationCase>(`/auth/ocr/cases/${id}/approve/`, {
    method: "POST",
    body: JSON.stringify({ note }),
  })
}

export function rejectVerificationCase(id: number, reason: string) {
  return apiRequest<ResidenceVerificationCase>(`/auth/ocr/cases/${id}/reject/`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  })
}

export function retryVerificationCase(id: number) {
  return apiRequest<ResidenceVerificationCase>(`/auth/ocr/cases/${id}/retry/`, {
    method: "POST",
  })
}

export async function listOcrAudit() {
  const payload = await apiRequest<OcrAuditEntry[] | ListEnvelope<OcrAuditEntry>>("/auth/ocr/audit/")
  return listFrom(payload)
}

function absoluteMediaUrl(rawUrl: string) {
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl
  const base = apiBaseUrl()
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
