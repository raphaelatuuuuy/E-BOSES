import type { EmergencyAlert } from "@/features/dashboard/emergency-api"

const LEGACY_LABELS = /\b(?:detail|injuries|people affected)\s*:/i

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
