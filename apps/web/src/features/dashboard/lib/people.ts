import type { PublicUser } from "@/features/dashboard/api"

export const RESPONDER_UNIT_LABEL: Record<string, string> = {
  tanod: "Barangay Tanod",
  bhw: "BHW",
  bdrrmo: "BDRRMO",
  "": "Responder",
}

export function responderUnitLabel(unit?: string | null): string {
  return RESPONDER_UNIT_LABEL[(unit ?? "").trim()] ?? "Responder"
}

export function roleLabelOf(role?: string | null): string {
  const key = (role ?? "").trim()
  if (!key) return ""
  if (key === "resident") return "Resident"
  if (key === "barangay_official") return "Official"
  if (key === "first_responder") return "Responder"
  return key.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
}

export function roleLabel(user?: PublicUser | null): string {
  if (!user) return ""
  if (user.role === "first_responder" && user.responder_unit) {
    return responderUnitLabel(user.responder_unit)
  }
  return roleLabelOf(user.role)
}

export function initialsFor(user?: PublicUser | null): string {
  const source =
    user?.initials ||
    user?.full_name
      ?.split(/\s+/)
      .map((part) => part[0])
      .join("") ||
    "U"
  return source.slice(0, 2).toUpperCase()
}
