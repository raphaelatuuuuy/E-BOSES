import type { EmailOtpType, MobileOtpType } from "@supabase/supabase-js"

import { requireSupabase } from "@/lib/supabase"

export function requestSupabasePhoneOtp(phone: string, shouldCreateUser = false) {
  return requireSupabase().auth.signInWithOtp({
    phone,
    options: { shouldCreateUser },
  })
}

export function requestSupabaseEmailOtp(email: string, shouldCreateUser = false) {
  return requireSupabase().auth.signInWithOtp({
    email,
    options: { shouldCreateUser },
  })
}

export function signInSupabaseWithPassword(email: string, password: string) {
  return requireSupabase().auth.signInWithPassword({ email, password })
}

export function verifySupabasePhoneOtp(phone: string, token: string, type: MobileOtpType = "sms") {
  return requireSupabase().auth.verifyOtp({ phone, token, type })
}

export function verifySupabaseEmailOtp(email: string, token: string, type: EmailOtpType = "email") {
  return requireSupabase().auth.verifyOtp({ email, token, type })
}

export function getSupabaseSession() {
  return requireSupabase().auth.getSession()
}

export function signOutSupabase() {
  return requireSupabase().auth.signOut({ scope: "local" })
}

export function onSupabaseAuthChange(callback: (accessToken: string | null) => void) {
  return requireSupabase().auth.onAuthStateChange((_event, session) => {
    callback(session?.access_token ?? null)
  })
}
