import type { Concern } from "@/features/dashboard/api"

export function isCriticalConcern(concern: Concern) {
  const severity = (concern.severity ?? "").toLowerCase()
  return (
    severity === "critical" ||
    Boolean(concern.escalated_alert)
  )
}
