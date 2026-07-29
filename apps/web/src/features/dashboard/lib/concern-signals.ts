import type { Concern } from "@/features/dashboard/api"

/**
 * Single source of truth for "this concern needs official review" — driven by the
 * backend soft validation gate (ConcernAiAssessment.flagged). The backend clears the
 * queue membership when an official records an ai-review decision, so the client
 * mirrors that rule: flagged AND no official decision yet.
 */
export function concernNeedsReview(concern: Pick<Concern, "ai_assessment">): boolean {
  const assessment = concern.ai_assessment
  if (!assessment) return false
  const flagged = (assessment as { flagged?: boolean }).flagged ?? false
  const decision = (assessment as { official_decision?: string }).official_decision ?? ""
  return flagged && decision === ""
}

export function concernFlagReasons(concern: Pick<Concern, "ai_assessment">): string[] {
  const assessment = concern.ai_assessment as { flag_reasons?: unknown } | null | undefined
  const reasons = assessment?.flag_reasons
  if (!Array.isArray(reasons)) return []
  return reasons
    .map((entry) =>
      typeof entry === "string"
        ? entry
        : typeof entry === "object" && entry !== null && "reason" in entry
          ? String((entry as { reason: unknown }).reason)
          : "",
    )
    .filter(Boolean)
}
