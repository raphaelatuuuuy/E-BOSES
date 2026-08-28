import { apiRequest } from "@/lib/api"
import type { OcrIdIntegrity, OcrPipeline, ResidenceProofOption } from "@/features/ocr/api"
import type { GeoJsonPolygon } from "@/features/dashboard/api"

export type UserStatus =
  | "pending_otp"
  | "pending_profile"
  | "pending_verification"
  | "verified"
  | "rejected"
  | "suspended"

export type UserRole = "resident" | "barangay_official" | "first_responder"

export interface AuthUser {
  id: number
  email: string
  phone_number: string
  role: UserRole
  status: UserStatus
  is_staff: boolean
  is_superuser: boolean
  is_onboarded: boolean
  email_verified_at: string | null
  phone_verified_at: string | null
  verified_at: string | null
  last_seen_at?: string | null
  date_joined?: string
  firstName?: string
  middleName?: string
  lastName?: string
  full_name?: string
  address?: string
  barangay?: string
  date_of_birth?: string | null
  member_since?: string
  gender?: string
  avatar?: string
  responder_unit?: "tanod" | "bhw" | "bdrrmo" | ""
  is_on_duty?: boolean
  current_latitude?: string | null
  current_longitude?: string | null
  location_updated_at?: string | null
  /** Resolved capability codes. Presentation only — every gated endpoint
   *  enforces the same capability server-side. */
  capabilities?: string[]
  units?: {
    id: number
    code: string
    name: string
    short_name: string
    position: string
    position_code: string
  }[]
}

export interface AuthResponse {
  access: string
  user: AuthUser
}

export interface ResidentSettings {
  push_alerts: boolean
  report_updates: boolean
  community_sharing: boolean
  location_sharing_enabled: boolean
  location_confirmation: boolean
  sos_placement: "sidebar" | "inline" | "compact"
  updated_at: string
}

export interface AccountRequest {
  id: number
  user?: AuthUser
  type: "deletion" | "data_export" | "deactivation"
  status: "submitted" | "reviewed" | "completed" | "rejected"
  note: string
  staff_note: string
  created_at: string
  updated_at: string
  /** Present on an open deletion request the server cannot action yet. */
  blocked?: boolean
  blocked_reasons?: string[]
}

export function withdrawAccountRequest(type?: AccountRequest["type"]) {
  return apiRequest<{ withdrawn: number }>("/auth/account-requests/", {
    method: "DELETE",
    body: JSON.stringify(type ? { type } : {}),
  })
}

export function registerResident(formData: FormData) {
  return apiRequest<AuthResponse>("/auth/register/", {
    method: "POST",
    body: formData,
  }, { auth: false })
}

export interface CommunityResolveResult {
  token: string
  community: { id: string; code: string; name: string; boundary: Record<string, unknown>; boundary_revision: number; center: { latitude: number; longitude: number } }
  weather_coordinates: { latitude: number; longitude: number }
  neighbors: number
  proof_options: ResidenceProofOption[]
}

export interface RegistrationStreetHit {
  name: string
  community: string
  community_id: string
  latitude: number
  longitude: number
}

export function searchRegistrationStreets(query: string, limit = 8) {
  const params = new URLSearchParams({ q: query, limit: String(limit) })
  return apiRequest<{ results: RegistrationStreetHit[] }>(
    `/auth/register/streets/?${params.toString()}`,
    { method: "GET" },
    { auth: false },
  )
}

export interface RegistrationPinAddress {
  street: string
  house_number: string
  community: string
  community_id: string
  inside_community: boolean
  latitude: number
  longitude: number
  label: string
}

export function lookupRegistrationPinAddress(latitude: number, longitude: number) {
  const params = new URLSearchParams({ lat: String(latitude), lng: String(longitude) })
  return apiRequest<RegistrationPinAddress>(
    `/auth/register/pin-address/?${params.toString()}`,
    { method: "GET" },
    { auth: false },
  )
}

export interface RegistrationCommunityArea {
  id: string
  name: string
  center: { latitude: number; longitude: number }
  boundary: GeoJsonPolygon | null
}

export function fetchRegistrationCommunities() {
  return apiRequest<{ results: RegistrationCommunityArea[] }>(
    "/auth/register/communities/",
    { method: "GET" },
    { auth: false },
  )
}

export function resolveRegistrationCommunity(payload: {
  email: string
  latitude: number
  longitude: number
  accuracy_meters?: number | null
  address: Record<string, string>
  source: "gps" | "search" | "manual"
}) {
  return apiRequest<CommunityResolveResult>("/auth/register/community/resolve/", {
    method: "POST",
    body: JSON.stringify(payload),
  }, { auth: false })
}

export interface EmailAvailabilityResult {
  available: boolean
  email: string
  message: string
}

export function checkEmailAvailability(payload: { email: string }) {
  return apiRequest<EmailAvailabilityResult>(
    "/auth/register/email/check/",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    { auth: false },
  )
}

export interface ResidenceProofCheckResult {
  checked: boolean
  side?: "front" | "back" | "single" | null
  media_authenticity?: {
    checked: boolean
    passed: boolean
  }
  id_integrity?: OcrIdIntegrity | null
  pipeline?: OcrPipeline | null
}

export function checkRegistrationProof(formData: FormData) {
  return apiRequest<ResidenceProofCheckResult>(
    "/auth/register/proof/check/",
    {
      method: "POST",
      body: formData,
    },
    { auth: false, timeoutMs: 90_000 },
  )
}

export interface ResidenceProofDetectResult {
  detected: boolean
  document_type?: { code: string; name: string } | null
  match_score?: number | null
  confidence?: number | null
  extracted_fields?: Record<string, { value?: string; label?: string; confidence?: number | null; raw_value?: string }>
  template_match?: { passed?: boolean; score?: number; checks?: Array<{ label?: string; passed?: boolean; detail?: string }> } | null
  field_checks?: Array<{ field?: string; label?: string; passed?: boolean; rule?: string; detail?: string }>
  deskew?: { deskewed?: boolean; score?: number; reason?: string } | null
  id_integrity?: OcrIdIntegrity | null
  id_integrity_checks?: OcrIdIntegrity[]
  pipeline?: OcrPipeline | null
  reasons?: string[]
  message?: string
}

export function detectRegistrationProof(formData: FormData) {
  return apiRequest<ResidenceProofDetectResult>(
    "/auth/register/proof/detect/",
    {
      method: "POST",
      body: formData,
    },
    // OCR can be slow on first load / large photos
    { auth: false, timeoutMs: 120_000 },
  )
}

export interface PhoneOtpRequestResult {
  detail?: string
  /** Present only in local/development when SMS is printed to the API console. */
  expires_in?: number
  retry_after?: number
}

export function requestRegistrationPhoneOtp(payload: { phone_number: string }) {
  return apiRequest<PhoneOtpRequestResult | void>("/auth/register/phone-otp/request/", {
    method: "POST",
    body: JSON.stringify(payload),
  }, { auth: false })
}

export function verifyRegistrationPhoneOtp(payload: { phone_number: string; code: string }) {
  return apiRequest<void>("/auth/register/phone-otp/verify/", {
    method: "POST",
    body: JSON.stringify(payload),
  }, { auth: false })
}

export type EmailOtpRequestResult = PhoneOtpRequestResult

export function requestRegistrationEmailOtp(payload: { email: string }) {
  return apiRequest<EmailOtpRequestResult | void>("/auth/register/email-otp/request/", {
    method: "POST",
    body: JSON.stringify(payload),
  }, { auth: false })
}

export function verifyRegistrationEmailOtp(payload: { email: string; code: string }) {
  return apiRequest<void>("/auth/register/email-otp/verify/", {
    method: "POST",
    body: JSON.stringify(payload),
  }, { auth: false })
}

export function login(payload: { identifier: string; password: string }) {
  return apiRequest<AuthResponse>("/auth/login/", {
    method: "POST",
    body: JSON.stringify(payload),
  }, { auth: false })
}

export function getMe() {
  return apiRequest<AuthUser>("/auth/me/")
}

export function updateMe(payload: {
  first_name?: string
  middle_name?: string
  last_name?: string
  address?: string
  gender?: "male" | "female" | "prefer_not_to_say" | ""
  avatar?: string
}) {
  return apiRequest<AuthUser>("/auth/me/", {
    method: "PATCH",
    body: JSON.stringify(payload),
  })
}

export function getResidentSettings() {
  return apiRequest<ResidentSettings>("/auth/settings/")
}

export function updateResidentSettings(payload: Partial<Omit<ResidentSettings, "updated_at">>) {
  return apiRequest<ResidentSettings>("/auth/settings/", {
    method: "PATCH",
    body: JSON.stringify(payload),
  })
}

export function listAccountRequests() {
  return apiRequest<AccountRequest[]>("/auth/account-requests/")
}

export function createAccountRequest(payload: { type: AccountRequest["type"]; note?: string }) {
  return apiRequest<AccountRequest>("/auth/account-requests/", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export interface SensitiveAccessAudit {
  id: number
  action: "media.raw_accessed" | "account.data_export_downloaded"
  actor: { id: number; email: string; full_name: string; role: AuthUser["role"] } | null
  subject: { id: number; email: string; full_name: string; role: AuthUser["role"] } | null
  resource_type: string
  resource_id: string
  created_at: string
}

export function getAccountDataExport(id: number) {
  return apiRequest<Record<string, unknown>>(`/auth/account-requests/${id}/export/`)
}

export function deactivateAccount(payload: { reason?: string; feedback?: string }) {
  return apiRequest<{ user: AuthUser; request: AccountRequest }>("/auth/account/deactivate/", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function reactivateAccount() {
  return apiRequest<AuthUser>("/auth/account/reactivate/", {
    method: "POST",
    body: JSON.stringify({}),
  })
}

export function changePassword(payload: {
  current_password: string
  new_password: string
  stay_logged_in?: boolean
}) {
  return apiRequest<{ detail: string }>("/auth/account/change-password/", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function requestAccountPhoneOtp(payload: { phone_number: string }) {
  return apiRequest<{ detail?: string; expires_in?: number; retry_after?: number } | void>(
    "/auth/account/phone/request-otp/",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  )
}

export function verifyAccountPhoneOtp(payload: { phone_number: string; code: string }) {
  return apiRequest<AuthUser>("/auth/account/phone/verify/", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function requestAccountEmailOtp(payload: { email: string }) {
  return apiRequest<{ detail?: string; expires_in?: number; retry_after?: number } | void>(
    "/auth/account/email/request-otp/",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  )
}

export function verifyAccountEmailOtp(payload: { email: string; code: string }) {
  return apiRequest<AuthUser>("/auth/account/email/verify/", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function confirmAccountNameChange(payload: {
  first_name: string
  middle_name?: string
  last_name: string
  ocr_first_name: string
  ocr_middle_name?: string
  ocr_last_name: string
}) {
  return apiRequest<AuthUser>("/auth/account/name-change/confirm/", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function listManagedAccountRequests(status?: string) {
  const params = new URLSearchParams()
  if (status && status !== "all") params.set("status", status)
  const query = params.toString() ? `?${params.toString()}` : ""
  return apiRequest<AccountRequest[]>(`/auth/account-requests/manage/${query}`)
}

export function reviewAccountRequest(id: number, payload: { status: "reviewed" | "completed" | "rejected"; staff_note?: string }) {
  return apiRequest<AccountRequest>(`/auth/account-requests/${id}/review/`, {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function listSensitiveAccessAudits(filters: { kind?: "all" | "media" | "export"; search?: string } = {}) {
  const params = new URLSearchParams()
  if (filters.kind && filters.kind !== "all") params.set("kind", filters.kind)
  if (filters.search?.trim()) params.set("search", filters.search.trim())
  const query = params.toString() ? `?${params.toString()}` : ""
  return apiRequest<SensitiveAccessAudit[]>(`/auth/audit/sensitive-access/${query}`)
}

export function listResidents(search?: string) {
  const params = new URLSearchParams()
  if (search?.trim()) params.set("search", search.trim())
  const query = params.toString() ? `?${params.toString()}` : ""
  return apiRequest<AuthUser[]>(`/auth/residents/${query}`)
}

/** Any authenticated user — for @mentions in comments (id + names only) */
export function searchResidentsForMention(search?: string) {
  const params = new URLSearchParams()
  if (search?.trim()) params.set("search", search.trim())
  const query = params.toString() ? `?${params.toString()}` : ""
  return apiRequest<
    { id: number; firstName: string; lastName: string; full_name: string }[]
  >(`/auth/residents/mentions/${query}`)
}

export function updateResidentStatus(id: number, status: UserStatus) {
  return apiRequest<AuthUser>(`/auth/residents/${id}/status/`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  })
}

export function createManagedUser(payload: {
  email: string
  phone_number: string
  password: string
  role: "barangay_official" | "first_responder"
  responder_unit?: AuthUser["responder_unit"]
}) {
  return apiRequest<AuthUser>("/auth/admin/users/", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function listResponders(search?: string) {
  const params = new URLSearchParams()
  if (search?.trim()) params.set("search", search.trim())
  const query = params.toString() ? `?${params.toString()}` : ""
  return apiRequest<AuthUser[]>(`/auth/responders/${query}`)
}

export function updateResponder(id: number, payload: { status?: UserStatus; responder_unit?: AuthUser["responder_unit"] }) {
  return apiRequest<AuthUser>(`/auth/responders/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  })
}

export function verifyOtp(payload: { channel: "email" | "sms"; purpose: "registration" | "password_reset"; code: string }) {
  return apiRequest<AuthUser>("/auth/otp/verify/", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function resendOtp(payload: { channel: "email" | "sms"; purpose: "registration" | "password_reset" }) {
  return apiRequest<void>("/auth/otp/resend/", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function requestPasswordReset(payload: { identifier: string; channel: "email" | "sms" }) {
  return apiRequest<void>("/auth/password-reset/request/", {
    method: "POST",
    body: JSON.stringify(payload),
  }, { auth: false })
}

export function verifyPasswordReset(payload: { identifier: string; channel: "email" | "sms"; code: string }) {
  return apiRequest<{ reset_token: string }>("/auth/password-reset/verify/", {
    method: "POST",
    body: JSON.stringify(payload),
  }, { auth: false })
}

export function completeOnboard() {
  return apiRequest<AuthUser>("/auth/onboard/complete/", { method: "POST" })
}

export function confirmPasswordReset(payload: { reset_token: string; password: string }) {
  return apiRequest<void>("/auth/password-reset/confirm/", {
    method: "POST",
    body: JSON.stringify(payload),
  }, { auth: false })
}
