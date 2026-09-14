import { AlertTriangleIcon, SearchIcon } from "lucide-react"

import type { Concern } from "@/features/dashboard/api"
import {
  SheetDialog,
  SheetPrimaryButton,
} from "@/features/dashboard/components/sheet-dialog"

function unitInitials(name: string, shortName?: string | null) {
  const compact = (shortName || "").trim()
  if (compact) return compact.slice(0, 4).toUpperCase()
  const words = name.split(/\s+/).filter(Boolean)
  if (!words.length) return "—"
  return words.length === 1
    ? words[0].slice(0, 2).toUpperCase()
    : words
        .map((word) => word[0])
        .join("")
        .slice(0, 4)
        .toUpperCase()
}

export function ReportDetailsDialog({
  open,
  report,
  onClose,
  onTrack,
}: {
  open: boolean
  report: Concern
  onClose: () => void
  onTrack: () => void
}) {
  const emergency = report.escalated_alert ?? null
  const rejected =
    report.validation_status === "rejected" || report.status === "rejected"
  const validationFailed = report.ai_assessment?.status === "failed"
  const waitingForValidation =
    report.validation_status !== "accepted" && !rejected
  const canShowAssignedUnit = report.validation_status === "accepted"
  const unit = emergency?.responding_unit
    ? {
        name: emergency.responding_unit.name,
        shortName: emergency.responding_unit.short_name,
      }
    : canShowAssignedUnit && report.assigned_department
      ? {
          name: report.assigned_department.name,
          shortName: report.assigned_department.short_name,
        }
      : null
  const validationFeedback =
    report.validation_summary?.trim() ||
    (validationFailed
      ? "Automated review could not be completed. Your report has not been assigned to a unit yet."
      : "This report was not accepted.")

  return (
    <SheetDialog
      open={open}
      onClose={onClose}
      title="Report details"
      size="compact"
    >
      <div className="flex flex-col items-center px-1 pt-3 pb-1 text-center">
        <p className="max-w-[18rem] text-[18px] leading-snug font-semibold text-neutral-900">
          {rejected
            ? "Not accepted"
            : validationFailed
              ? "Review could not be completed"
              : emergency
                ? "Your report was escalated to"
                : unit
                  ? "Your report was assigned to"
                  : "Report is being checked"}
        </p>

        {unit ? (
          <>
            <span className="mt-6 flex size-16 items-center justify-center rounded-full bg-slate-soft text-[17px] font-bold tracking-tight text-navy-muted">
              {unitInitials(unit.name, unit.shortName)}
            </span>
            <p className="mt-3 max-w-[19rem] text-[16px] leading-snug font-semibold text-neutral-900">
              {unit.name}
            </p>
          </>
        ) : (
          <div
            className={`mt-6 flex w-full items-start gap-3 rounded-[14px] border px-4 py-3 text-left text-[13px] leading-5 font-medium ${
              rejected
                ? "border-sos/25 bg-sos/10 text-sos"
                : "border-card-line bg-canvas text-neutral-600"
            }`}
          >
            {rejected || validationFailed ? (
              <AlertTriangleIcon
                className="mt-0.5 size-5 shrink-0"
                strokeWidth={2}
              />
            ) : null}
            <span>
              {rejected || validationFailed
                ? validationFeedback
                : waitingForValidation
                  ? "We’re checking your report before assigning it to a unit."
                  : "Your report has not been assigned to a unit yet."}
            </span>
          </div>
        )}

        <div className="mt-7 w-full space-y-2">
          <SheetPrimaryButton
            tone="accent"
            onClick={() => {
              onClose()
              onTrack()
            }}
          >
            <SearchIcon className="mr-2 size-5" strokeWidth={2.25} />
            Track report
          </SheetPrimaryButton>
        </div>
      </div>
    </SheetDialog>
  )
}
