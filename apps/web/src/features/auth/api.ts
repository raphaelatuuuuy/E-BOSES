import { apiRequest } from "@/lib/api"

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
  responder_unit?: "tanod" | "bhw" | "bdrrmo" | "other" | ""
  is_on_duty?: boolean
  current_latitude?: string | null
  current_longitude?: string | null
  location_updated_at?: string | null
}

export interface AuthResponse {
  access: string
  user: AuthUser
}

export interface ResidentSettings {
  push_alerts: boolean
  report_updates: boolean
  community_sharing: boolean
  location_confirmation: boolean
  sos_placement: "sidebar" | "inline" | "compact"
  updated_at: string
}

export interface AccountRequest {
  id: number
  user?: AuthUser
  type: "deletion" | "data_export"
  status: "submitted" | "reviewed" | "completed" | "rejected"
  note: string
  staff_note: string
  created_at: string
  updated_at: string
}

export function registerResident(formData: FormData) {
  return apiRequest<AuthResponse>("/auth/register/", {
    method: "POST",
    body: formData,
  }, { auth: false })
}

export function checkRegistrationProof(formData: FormData) {
  return apiRequest<void>("/auth/register/proof/check/", {
    method: "POST",
    body: formData,
  }, { auth: false })
}

export function requestRegistrationPhoneOtp(payload: { phone_number: string }) {
  return apiRequest<void>("/auth/register/phone-otp/request/", {
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

export function listResidents(search?: string) {
  const params = new URLSearchParams()
  if (search?.trim()) params.set("search", search.trim())
  const query = params.toString() ? `?${params.toString()}` : ""
  return apiRequest<AuthUser[]>(`/auth/residents/${query}`)
}

export function updateResidentStatus(id: number, status: UserStatus) {
  return apiRequest<AuthUser>(`/auth/residents/${id}/status/`, {
    method: "POST",
    body: JSON.stringify({ status }),
  })
}

export function listResponders(search?: string) {
  const params = new URLSearchParams()
  if (search?.trim()) params.set("search", search.trim())
  const query = params.toString() ? `?${params.toString()}` : ""
  return apiRequest<AuthUser[]>(`/auth/responders/${query}`)
}

export function updateResponder(id: number, payload: { status?: UserStatus; responder_unit?: AuthUser["responder_unit"]; is_on_duty?: boolean }) {
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
