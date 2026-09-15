import type { EmergencyAlert } from "@/features/dashboard/emergency-api"
import { streetSegment } from "@/features/dashboard/lib/location-text"

const LEGACY_LABELS = /\b(?:detail|injuries|people affected)\s*:/i
const MACHINE_TITLES = /\b(?:e-?boses status|reply (?:safe|cancel)|loc\s*:)/i

const TYPE_LABELS: Record<string, string> = {
  medical: "Medical",
  fire: "Fire",
  crime: "Crime",
  disaster: "Disaster",
  child_protection: "Child Protection",
  domestic_violence: "Domestic Violence",
}

export function emergencyTypeLabel(type?: string | null): string {
  const code = (type || "").trim().toLowerCase()
  return TYPE_LABELS[code] || "Emergency"
}

/**
 * The headline shown for an emergency row: the LLM-generated incident title
 * when the backend produced one, otherwise the type/street label.
 */
export function emergencyTitleText(alert: EmergencyAlert): string {
  const stored = alert.display_title?.trim() || ""
  if (stored && !LEGACY_LABELS.test(stored) && !MACHINE_TITLES.test(stored)) {
    return stored
  }
  const typeLabel = emergencyTypeLabel(alert.type)
  const location = streetSegment(
    alert.resolved_location || alert.address || alert.reported_area || alert.display_location
  )
  if (location) return `${typeLabel} around ${location}`
  return typeLabel === "Emergency" ? "Emergency report" : `${typeLabel} emergency`
}

export function emergencyDescription(alert: EmergencyAlert): string {
  const stored = alert.display_description?.trim() || ""
  if (stored && !LEGACY_LABELS.test(stored)) return stored

  const type = (alert.type || "emergency").replaceAll("_", " ").toLowerCase()
  // Emergency types always read as proper labels ("Flood", "Fire"), even
  // mid-sentence in the generated description.
  const typeLabel = type.charAt(0).toUpperCase() + type.slice(1)
  const location = (
    alert.resolved_location || alert.address || alert.reported_area || alert.display_location || ""
  ).trim()
  let subject = alert.note?.trim().replace(/\.$/, "") ||
    (["fire", "crime", "disaster"].includes(type) ? `a ${typeLabel}` : `a ${typeLabel} emergency`)
  if (location && !subject.toLowerCase().includes(location.toLowerCase())) {
    subject += ` around ${location}`
  }

  const triage = alert.triage || {}
  const clauses: string[] = []
  const detail = (triage.detail || "").replaceAll("_", " ").trim().toLowerCase()
  if (detail === "contained") clauses.push("that has been contained")
  else if (detail) clauses.push(`that is currently ${detail}`)
  const people = (triage.people_affected || "").replaceAll("_", " ").trim().toLowerCase()
  if (people) {
    const count = people === "few" ? "a few people" : people === "many" ? "several people" : people
    clauses.push(`affecting ${count}`)
  }
  const injuries = (triage.injuries || triage.is_anyone_injured || "").toLowerCase()
  if (["yes", "true"].includes(injuries)) clauses.push("with reported injuries")
  else if (["no", "false"].includes(injuries)) clauses.push("with no reported injuries")

  return `The resident reported ${subject}${clauses.length ? ` ${clauses.join(", ")}` : ""}.`
}
