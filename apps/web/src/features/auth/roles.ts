import type { AuthUser } from "@/features/auth/api"

export function isResponderUser(user?: AuthUser | null) {
  return user?.role === "first_responder"
}

export function isOfficialUser(user?: AuthUser | null) {
  return Boolean(
    user &&
      !isResponderUser(user) &&
      (user.role === "barangay_official" || user.is_superuser),
  )
}

export function isResidentUser(user?: AuthUser | null) {
  return Boolean(user && !isOfficialUser(user) && !isResponderUser(user))
}

export function isStaffUser(user?: AuthUser | null) {
  return isOfficialUser(user) || isResponderUser(user)
}
