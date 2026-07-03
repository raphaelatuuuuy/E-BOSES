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
  email_verified_at: string | null
  phone_verified_at: string | null
  verified_at: string | null
  firstName?: string
  lastName?: string
}

export interface AuthResponse {
  access: string
  user: AuthUser
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

export function confirmPasswordReset(payload: { reset_token: string; password: string }) {
  return apiRequest<void>("/auth/password-reset/confirm/", {
    method: "POST",
    body: JSON.stringify(payload),
  }, { auth: false })
}
