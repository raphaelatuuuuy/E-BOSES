import type { AuthUser } from "@/features/auth/api"

export function isResponderUser(user?: AuthUser | null) {
  return user?.role === "first_responder"
}

export function isOfficialUser(user?: AuthUser | null) {
  return Boolean(
    user &&
      !isResponderUser(user) &&
      (user.role === "barangay_official" || user.is_staff || user.is_superuser),
  )
}
