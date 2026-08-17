import { createClient } from "@supabase/supabase-js"

const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? ""
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? ""

export const supabaseAuthEnabled = import.meta.env.VITE_AUTH_BACKEND === "supabase"
export const supabaseConfigured = Boolean(url && key)

export const supabase = supabaseConfigured
  ? createClient(url, key, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
        persistSession: true,
      },
    })
  : null

export function requireSupabase() {
  if (!supabase) {
    throw new Error("Supabase is not configured.")
  }
  return supabase
}
