/**
 * Row sequencing for report lists: Critical → High → Moderate → Low →
 * Resolved → Rejected.
 *
 * Settled records (resolved, rejected) always sit below every open severity
 * band — closed work is not a live hazard — and a rejected record sorts below
 * a resolved one. Within a band, the most recent report wins.
 */

const SEVERITY_RANK: Record<string, number> = {
  low: 0,
  moderate: 1,
  high: 2,
  critical: 3,
}

export type ReportPriorityRecord = {
  severity?: string | null
  tracking_id?: string
  status?: string
  created_at: string
  id: number
}

export function reportSeverityRank(report: ReportPriorityRecord) {
  if (report.status === "resolved" || report.status === "closed") return -1
  if (report.status === "rejected") return -2
  if ("severity" in report && report.severity) {
    return SEVERITY_RANK[report.severity] ?? 0
  }
  // Emergency alerts arrive without a severity field and are live criticals.
  return "tracking_id" in report ? 3 : 0
}

export function compareReportPriority(
  left: ReportPriorityRecord,
  right: ReportPriorityRecord
) {
  return (
    reportSeverityRank(right) - reportSeverityRank(left) ||
    right.created_at.localeCompare(left.created_at) ||
    right.id - left.id
  )
}
