import type { Concern } from "@/features/dashboard/api"

export function isCriticalConcern(concern: Concern) {
  const severity = (concern.severity ?? "").toLowerCase()
  const assessment = concern.ai_assessment
  const activeHighRisk =
    assessment?.severity_estimate?.toLowerCase() === "high" &&
    assessment.current_danger === true &&
    assessment.incident_timing === "ongoing"

  return (
    severity === "critical" ||
    concern.urgent_attention === true ||
    assessment?.urgent_attention === true ||
    activeHighRisk ||
    Boolean(concern.escalated_alert)
  )
}
