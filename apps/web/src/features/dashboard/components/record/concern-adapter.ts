import type { Concern } from "@/features/dashboard/api"

import {
  deriveConcernSeverity,
  derivePriority,
  severityLevel,
  type Severity,
} from "./severity"
import { toStatusView } from "./status"
import { isResolvedRecord } from "@/features/dashboard/components/alerts-map/lib"
import type {
  RecordAction,
  RecordFact,
  RecordSection,
  RecordView,
} from "./types"

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
  {
    key: "submitted",
    label: "Submitted",
    reached: [
      "submitted",
      "under_review",
      "assigned",
      "in_progress",
      "resolved",
    ],
  },
  {
    key: "under_review",
    label: "Reviewed",
    reached: ["under_review", "assigned", "in_progress", "resolved"],
  },
  {
    key: "assigned",
    label: "Assigned",
    reached: ["assigned", "in_progress", "resolved"],
  },
  {
    key: "in_progress",
    label: "In progress",
    reached: ["in_progress", "resolved"],
  },
  { key: "resolved", label: "Resolved", reached: ["resolved"] },
]

function shortDate(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined
  return new Date(iso).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  })
}

export function concernSeverityOf(concern: Concern): {
  severity: Severity
  assessed: boolean
} {
  if (
    concern.severity === "low" ||
    concern.severity === "moderate" ||
    concern.severity === "high" ||
    concern.severity === "critical"
  ) {
    return {
      severity: concern.severity,
      assessed: concern.severity_assessed !== false,
    }
  }
  const assessment = concern.ai_assessment
  const completed = assessment?.status === "completed"

  return deriveConcernSeverity({
    category: concern.category,

    severityEstimate: completed
      ? (assessment?.severity_estimate ?? null)
      : null,
    currentDanger: completed ? (assessment?.current_danger ?? false) : false,
    incidentTiming: completed ? (assessment?.incident_timing ?? null) : null,
    relevance: completed ? (assessment?.nlp_confidence ?? null) : null,
  })
}

export interface RankedConcern {
  concern: Concern
  severity: Severity
  assessed: boolean
  priority: number
}

export function rankConcerns(
  concerns: readonly Concern[],
  now: number
): RankedConcern[] {
  return concerns
    .map((concern) => {
      const { severity, assessed } = concernSeverityOf(concern)
      return {
        concern,
        severity,
        assessed,
        priority: derivePriority({
          severity,
          hoursSinceStatusChange:
            (now - new Date(concern.updated_at).getTime()) / 3_600_000,
          voteCount: concern.vote_count,
        }),
      }
    })
    .sort((a, b) => {
      const settled =
        settledRank(a.concern.status) - settledRank(b.concern.status)
      if (settled !== 0) return settled
      const band = severityLevel(b.severity) - severityLevel(a.severity)
      return band !== 0 ? band : b.priority - a.priority
    })
}

function settledRank(status: string) {
  if (status === "rejected") return 2
  if (isResolvedRecord({ status })) return 1
  return 0
}

export interface ConcernAdapterOptions {
  now: number
  actions?: RecordAction[]
  sections?: RecordSection[]
}

export function toConcernRecordView(
  concern: Concern,
  options: ConcernAdapterOptions
): RecordView {
  const { severity, assessed } = concernSeverityOf(concern)
  const status = toStatusView(concern.status)
  const assessment = concern.ai_assessment
  const assignedDepartment =
    concern.validation_status === "accepted"
      ? concern.assigned_department
      : null

  const facts: RecordFact[] = [
    {
      label: "Assigned unit",
      value: assignedDepartment?.short_name || assignedDepartment?.name || null,

      emptyHint: "Not routed to a unit yet",
    },
  ]

  if (concern.visibility === "community") {
    facts.push({
      label: "Community support",
      value: `${concern.vote_count} ${concern.vote_count === 1 ? "vote" : "votes"}`,
    })
  }

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
      state: (step.key === concern.status
        ? "current"
        : reached
          ? "done"
          : "pending") as "current" | "done" | "pending",
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
      hoursSinceStatusChange:
        (options.now - new Date(concern.updated_at).getTime()) / 3_600_000,
      voteCount: concern.vote_count,
    }),
    title: concern.official_title || concern.title,
    address: concern.address?.trim() || concern.barangay || null,
    elapsedLabel: `Reported ${shortDate(concern.created_at)}`,
    facts,
    track:
      concern.status === "rejected" || concern.status === "appealed"
        ? [
            {
              key: concern.status,
              label: status.label,
              state: "current" as const,
            },
          ]
        : track,
    assigneeLabel: assignedDepartment ? assignedDepartment.name : null,
    assigneeDetail:
      assignedDepartment && concern.assignments?.length
        ? `${concern.assignments.length} assignment${concern.assignments.length === 1 ? "" : "s"}`
        : null,
    actions: options.actions ?? [],
    sections: options.sections ?? [],
  }
}
