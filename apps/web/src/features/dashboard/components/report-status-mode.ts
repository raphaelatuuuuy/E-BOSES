// apps/web/src/features/dashboard/components/report-status-mode.ts

import type { Concern, ConcernStatus } from "@/features/dashboard/api"
import { isResolvedRecord } from "@/features/dashboard/components/alerts-map/lib"

export type StatusDialogMode = "submitted" | "assigned" | "rejected" | "resolved"

export function statusModeFromReport(
  report: Concern | { status: ConcernStatus },
): StatusDialogMode {
  if (report.status === "assigned" || report.status === "in_progress") return "assigned"
  if (report.status === "rejected") return "rejected"
  if (isResolvedRecord(report)) return "resolved"
  return "submitted"
}