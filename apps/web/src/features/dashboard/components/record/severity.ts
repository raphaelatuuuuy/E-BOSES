/**
 * Severity and priority for concerns and emergencies.
 *
 * These are two different questions and are kept apart on purpose.
 *
 * SEVERITY is objective. It comes from AI assessment and incident facts, never
 * from votes, the reporter's identity, or where they live. The research this
 * system implements cites Schiff (2023), who found wealthier neighbourhoods
 * received faster responses, and positions AI severity as the correction:
 * ranking "based on objective data from submitted photos and text rather than
 * on the location or social standing of the reporter". Feeding community
 * support into severity would reintroduce exactly that bias.
 *
 * PRIORITY orders records and *does* include community support, because civic
 * engagement here is defined as residents contributing to prioritisation. The
 * guarantee that support cannot outrank objective severity is enforced by
 * `sortRecords` — sorting by severity band first — not by weight tuning, which
 * silently breaks the moment someone retunes a constant.
 */

export type Severity = "low" | "moderate" | "high" | "critical"

/** Ordered low → critical. Index doubles as the numeric level (0..3). */
export const SEVERITY_ORDER: readonly Severity[] = ["low", "moderate", "high", "critical"]

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "CRITICAL",
  high: "HIGH",
  moderate: "MODERATE",
  low: "LOW",
}

export function severityLevel(severity: Severity): number {
  return SEVERITY_ORDER.indexOf(severity)
}

function clampToSeverity(level: number): Severity {
  const bounded = Math.max(0, Math.min(SEVERITY_ORDER.length - 1, Math.round(level)))
  return SEVERITY_ORDER[bounded]
}

// --- Concerns -------------------------------------------------------------

/** Minimum severity a category holds when no photo or AI score exists. */
const CONCERN_CATEGORY_BASELINE: Record<string, number> = {
  public_safety: 2,
  infrastructure: 1,
  environment: 1,
  others: 0,
}

export interface ConcernSeverityInput {
  category?: string | null
  /** YOLOv8 damage score, 0..1. Absent while the assessment is still running. */
  damageScore?: number | null
  /** NLP relevance, 0..1. */
  relevance?: number | null
  /** Configured relevance threshold; below it the report reads as off-topic. */
  relevanceThreshold?: number | null
}

export interface SeverityResult {
  severity: Severity
  /** False when no AI assessment exists yet, so the UI can say so rather than
   *  presenting a category floor as a confident measurement. */
  assessed: boolean
}

export function deriveConcernSeverity(input: ConcernSeverityInput): SeverityResult {
  const baseline = CONCERN_CATEGORY_BASELINE[input.category ?? "others"] ?? 0
  const hasScore = typeof input.damageScore === "number" && Number.isFinite(input.damageScore)

  if (!hasScore) {
    return { severity: clampToSeverity(baseline), assessed: false }
  }

  // Quartiles of the damage score: [0,.25) low, [.25,.5) moderate,
  // [.5,.75) high, [.75,1] critical. Even bands, and simple to state when
  // defending how a concern was ranked. Rounding `3 * score` instead would
  // squeeze "low" into scores below 0.167 and push almost everything up.
  const score = Math.max(0, Math.min(1, input.damageScore as number))
  let level = Math.min(3, Math.floor(score * 4))
  level = Math.max(level, baseline)

  const threshold = input.relevanceThreshold ?? 0.65
  if (typeof input.relevance === "number" && input.relevance < threshold) {
    level -= 1
  }

  return { severity: clampToSeverity(level), assessed: true }
}

// --- Emergencies ----------------------------------------------------------

const EMERGENCY_TYPE_BASELINE: Record<string, number> = {
  fire: 3,
  medical: 2,
  disaster: 2,
  crime: 1,
  other: 0,
}

/** Minutes within which an alert of each type should be acknowledged. */
export const EMERGENCY_ACK_TARGET_MINUTES: Record<string, number> = {
  fire: 2,
  medical: 3,
  disaster: 3,
  crime: 5,
  other: 10,
}

export interface EmergencySeverityInput {
  type?: string | null
  /** Minutes since submission. */
  elapsedMinutes?: number | null
  acknowledged?: boolean
  /** Independent witness notifications for the same incident. */
  witnessCount?: number | null
}

export function deriveEmergencySeverity(input: EmergencySeverityInput): SeverityResult {
  const type = input.type ?? "other"
  let level = EMERGENCY_TYPE_BASELINE[type] ?? 0

  const target = EMERGENCY_ACK_TARGET_MINUTES[type] ?? 10
  const elapsed = input.elapsedMinutes ?? 0
  if (!input.acknowledged && elapsed > target) {
    level += 1
  }

  // Corroboration is a fact about the incident, not about the reporter's
  // standing: two independent devices reporting the same place is evidence.
  if ((input.witnessCount ?? 0) >= 2) {
    level += 1
  }

  return { severity: clampToSeverity(level), assessed: true }
}

// --- Priority -------------------------------------------------------------

export interface PriorityInput {
  severity: Severity
  /** Hours since the last status change, not since creation: acting on a
   *  record should relieve its age pressure rather than let it climb forever. */
  hoursSinceStatusChange?: number | null
  /** Community support (votes). Saturates, so a well-connected neighbourhood
   *  cannot accumulate unbounded advantage inside a band. */
  voteCount?: number | null
}

const AGE_SATURATION_HOURS = 72
const SUPPORT_SATURATION_VOTES = 25

/** 0..100, used for ordering *within* a severity band. */
export function derivePriority(input: PriorityInput): number {
  const severityNorm = severityLevel(input.severity) / (SEVERITY_ORDER.length - 1)
  const ageNorm = Math.min(Math.max(input.hoursSinceStatusChange ?? 0, 0) / AGE_SATURATION_HOURS, 1)
  const supportNorm = Math.min(Math.max(input.voteCount ?? 0, 0) / SUPPORT_SATURATION_VOTES, 1)

  return Math.round(60 * severityNorm + 25 * ageNorm + 15 * supportNorm)
}

// --- Ordering -------------------------------------------------------------

export interface SortableRecord {
  severity: Severity
  priority: number
}

/**
 * Severity band first, priority within it.
 *
 * This is the equity guarantee. Because the band is compared before the score,
 * no amount of community support or waiting can promote a record past a more
 * severe one — which a single blended score cannot promise.
 */
export function sortRecords<T extends SortableRecord>(records: readonly T[]): T[] {
  return [...records].sort((a, b) => {
    const bandDelta = severityLevel(b.severity) - severityLevel(a.severity)
    if (bandDelta !== 0) return bandDelta
    return b.priority - a.priority
  })
}
