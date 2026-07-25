import type { Concern, ConcernStatus } from "@/features/dashboard/api"

export type StatusDialogMode = "submitted" | "assigned" | "rejected" | "resolved"

export function statusModeFromReport(report: Concern | { status: ConcernStatus }): StatusDialogMode {
  if (report.status === "assigned" || report.status === "in_progress") return "assigned"
  if (report.status === "rejected") return "rejected"
  if (report.status === "resolved") return "resolved"
  return "submitted"
}
