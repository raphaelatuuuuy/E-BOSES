import type { Concern } from "@/features/dashboard/api"

import {
  deriveConcernSeverity,
  derivePriority,
  severityLevel,
  type Severity,
} from "./severity"
import { toStatusView } from "./status"
import type { RecordAction, RecordFact, RecordSection, RecordView } from "./types"

/**
 * Maps a concern onto the shared record shape.
 *
 * Severity comes from the AI assessment — the YOLOv8 damage score, adjusted by
 * NLP relevance, floored by category. It deliberately ignores vote count and
 * anything about the reporter, because the whole point of AI severity in this
 * project is to rank on objective evidence rather than on who reported it or
 * where they live.
 *
 * Community support still influences ordering, but only through `priority`, and
 * only inside a severity band (see `rankConcerns`).
 */

/** Fallback only. The category row on the concern is preferred, so a renamed
 *  or newly added category shows correctly without touching this file. */
const LEGACY_CATEGORY_LABEL: Record<string, string> = {
  infrastructure: "Infrastructure",
  environment: "Environment",
  public_safety: "Public safety",
  others: "Other",
}

function categoryLabelOf(concern: Concern): string {
  return (
    concern.category_ref?.name ??
    LEGACY_CATEGORY_LABEL[concern.category] ??
    concern.category
  )
}

const TRACK: { key: string; label: string; reached: string[] }[] = [
  { key: "submitted", label: "Submitted", reached: ["submitted", "under_review", "assigned", "in_progress", "resolved"] },
  { key: "under_review", label: "Reviewed", reached: ["under_review", "assigned", "in_progress", "resolved"] },
  { key: "assigned", label: "Assigned", reached: ["assigned", "in_progress", "resolved"] },
  { key: "in_progress", label: "In progress", reached: ["in_progress", "resolved"] },
  { key: "resolved", label: "Resolved", reached: ["resolved"] },
]

function shortDate(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" })
}

export function concernSeverityOf(concern: Concern): { severity: Severity; assessed: boolean } {
  const assessment = concern.ai_assessment
  const completed = assessment?.status === "completed"

  return deriveConcernSeverity({
    category: concern.category,
    // `yolo_confidence` is the model's damage score. Left undefined until the
    // assessment completes, which makes the badge read "pending" rather than
    // presenting a category floor as a measurement.
    damageScore: completed ? (assessment?.yolo_confidence ?? null) : null,
    relevance: completed ? (assessment?.nlp_confidence ?? null) : null,
  })
}

export interface RankedConcern {
  concern: Concern
  severity: Severity
  assessed: boolean
  priority: number
}

/**
 * Rank a concern queue: severity band first, priority within it.
 *
 * The band comparison is the equity guarantee. No amount of community support
 * can lift a low-severity concern above a high-severity one, which is what the
 * research requires; support still decides ordering among concerns of equal
 * severity, which is what civic participation is meant to influence.
 */
export function rankConcerns(concerns: readonly Concern[], now: number): RankedConcern[] {
  return concerns
    .map((concern) => {
      const { severity, assessed } = concernSeverityOf(concern)
      return {
        concern,
        severity,
        assessed,
        priority: derivePriority({
          severity,
          hoursSinceStatusChange: (now - new Date(concern.updated_at).getTime()) / 3_600_000,
          voteCount: concern.vote_count,
        }),
      }
    })
    .sort((a, b) => {
      const band = severityLevel(b.severity) - severityLevel(a.severity)
      return band !== 0 ? band : b.priority - a.priority
    })
}

export interface ConcernAdapterOptions {
  now: number
  actions?: RecordAction[]
  sections?: RecordSection[]
}

export function toConcernRecordView(concern: Concern, options: ConcernAdapterOptions): RecordView {
  const { severity, assessed } = concernSeverityOf(concern)
  const status = toStatusView(concern.status)
  const assessment = concern.ai_assessment

  /**
   * Two facts, not five.
   *
   * Dropped, and why:
   *  · Category      — the header already prints it as the type badge, so the
   *                    card was showing "Others" twice, two lines apart.
   *  · Validation    — "Accepted" restated what the status badge above it
   *                    already said, in different words.
   *  · Tracking no.  — an audit identifier, not something an official decides
   *                    on. It belongs where someone looks a report up (search,
   *                    which already matches on it), not on the record they are
   *                    currently reading.
   *
   * What survives is what actually changes a decision: who is handling it, and
   * how many neighbours are behind it.
   */
  const facts: RecordFact[] = [
    {
      label: "Assigned unit",
      value: concern.assigned_department?.short_name || concern.assigned_department?.name || null,
      // Distinguishes "nobody has it" from a rendering failure.
      emptyHint: "Not routed to a unit yet",
    },
    {
      label: "Community support",
      value: `${concern.vote_count} ${concern.vote_count === 1 ? "vote" : "votes"}`,
    },
  ]

  if (assessment?.possible_duplicate) {
    facts.push({
      label: "Possible duplicate",
      value: assessment.duplicate_match?.tracking_id
        ? `of ${assessment.duplicate_match.tracking_id}`
        : "similar report nearby",
    })
  }

  const track = TRACK.map((step) => {
    const reached = step.reached.includes(concern.status)
    return {
      key: step.key,
      label: step.label,
      state: (step.key === concern.status ? "current" : reached ? "done" : "pending") as
        | "current"
        | "done"
        | "pending",
      at:
        step.key === "submitted"
          ? shortDate(concern.created_at)
          : step.key === concern.status
            ? shortDate(concern.updated_at)
            : undefined,
    }
  })

  return {
    id: String(concern.id),
    kind: "concern",
    typeLabel: categoryLabelOf(concern),
    severity,
    severityAssessed: assessed,
    status,
    priority: derivePriority({
      severity,
      hoursSinceStatusChange: (options.now - new Date(concern.updated_at).getTime()) / 3_600_000,
      voteCount: concern.vote_count,
    }),
    title: concern.title,
    address: concern.address?.trim() || concern.barangay || null,
    elapsedLabel: `Reported ${shortDate(concern.created_at)}`,
    facts,
    track:
      concern.status === "rejected" || concern.status === "appealed"
        ? [{ key: concern.status, label: status.label, state: "current" as const }]
        : track,
    assigneeLabel: concern.assigned_department
      ? concern.assigned_department.name
      : null,
    assigneeDetail: concern.assignments?.length
      ? `${concern.assignments.length} assignment${concern.assignments.length === 1 ? "" : "s"}`
      : null,
    actions: options.actions ?? [],
    sections: options.sections ?? [],
  }
}
