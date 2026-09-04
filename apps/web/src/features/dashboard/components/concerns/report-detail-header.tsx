import { useState } from "react"
import { CheckIcon, PhoneIcon, Share2Icon } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@workspace/ui/lib/utils"

import type { Concern } from "@/features/dashboard/api"
import { useAuthSession } from "@/features/auth/auth-session"
import {
  avatarTone,
  concernReporterName,
  initialsOf,
} from "@/features/dashboard/components/concerns/concern-queue-item"
import { concernSeverityOf } from "@/features/dashboard/components/record/concern-adapter"
import { unitShortTag } from "@/features/dashboard/components/concerns/concern-display"
import {
  canPublishConcern,
  canShareConcern,
  shareConcernReport,
} from "@/features/dashboard/lib/share-report"

function submittedAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date)
}

/**
 * "Share to public" icon button, rendered in the container header beside
 * the submitted date (see ReportDetailHeader).
 */
export function ShareConcernButton({
  report,
  onPublish,
}: {
  report: Concern
  onPublish?: (report: Concern) => Promise<Concern>
}) {
  const [shared, setShared] = useState(false)
  const publishing = canPublishConcern(report)

  async function handleShare() {
    try {
      const shareableReport =
        publishing && onPublish ? await onPublish(report) : report
      const didShare = await shareConcernReport(shareableReport)
      if (didShare) {
        setShared(true)
        window.setTimeout(() => setShared(false), 1800)
      }
    } catch {
      toast.error("Could not share this report publicly.")
    }
  }

  const canShareAction =
    canShareConcern(report) || (publishing && Boolean(onPublish))
  if (!canShareAction) return null

  return (
    <button
      type="button"
      onClick={() => void handleShare()}
      title={publishing ? "Share to public" : "Share report"}
      aria-label={publishing ? "Share to public" : "Share report"}
      className="flex size-8 shrink-0 items-center justify-center rounded-full text-neutral-600 ring-1 ring-neutral-300 transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:ring-offset-2 focus-visible:outline-none"
    >
      {shared ? (
        <CheckIcon className="size-4" aria-hidden="true" />
      ) : (
        <Share2Icon className="size-4" aria-hidden="true" />
      )}
    </button>
  )
}

export function ReportDetailHeader({
  report,
  audience = "resident",
  onPublish,
}: {
  report: Concern
  audience?: "resident" | "official"
  onPublish?: (report: Concern) => Promise<Concern>
}) {
  const fullName = concernReporterName(report)
  const unit =
    report.validation_status === "accepted"
      ? (report.assigned_department ??
        report.community_incident?.assigned_unit ??
        null)
      : null
  const showAssignedUnit = audience === "resident" && Boolean(unit)
  const identityName = showAssignedUnit ? unit?.name : fullName
  const identityLabel = showAssignedUnit
    ? unit?.description?.trim() ||
      report.category_ref?.description?.trim() ||
      "Assigned response unit"
    : "Resident"
  const reporterPhone = report.reporter?.phone_number?.trim() || ""
  const [calling, setCalling] = useState(false)
  const { user } = useAuthSession()

  // Emergency/critical reports get a call button too — not just the official
  // view — so responders can reach the reporter immediately. The reporter
  // themselves never sees a call-to-self button.
  const severity = concernSeverityOf(report).severity
  const emergencyCritical =
    Boolean(report.escalated_alert) || severity === "critical"
  const isOwnReport = user?.id != null && report.reporter?.id === user.id
  const showCallButton =
    Boolean(reporterPhone) &&
    (audience === "official" || (emergencyCritical && !isOwnReport))

  // Same navigation style as the emergency tracking sheet's call buttons:
  // `window.location.href = tel:` makes the browser show its external-protocol
  // prompt ("Open Phone Link / FaceTime / dialer?") on desktop AND mobile,
  // whereas a plain <a href="tel:"> is silently swallowed by some desktops.
  function callReporter() {
    if (!reporterPhone || calling) return
    setCalling(true)
    window.location.href = `tel:${reporterPhone}`
    window.setTimeout(() => setCalling(false), 1000)
  }

  return (
    <div className="shrink-0 px-0 pt-0 lg:px-6 lg:pt-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {showCallButton ? (
            <button
              type="button"
              onClick={callReporter}
              disabled={calling}
              title={`Call ${identityName}`}
              aria-label={`Call ${identityName}`}
              className="flex size-8 items-center justify-center rounded-full text-neutral-600 ring-1 ring-neutral-300 transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-50"
            >
              <PhoneIcon className="size-4" aria-hidden="true" />
            </button>
          ) : null}
          {/* Residents never get the call button, so their share icon takes
              the left corner instead of crowding the date on the right. */}
          {audience === "resident" ? (
            <ShareConcernButton report={report} onPublish={onPublish} />
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-neutral-500 tabular-nums">
            {submittedAt(report.created_at)}
          </span>
        </div>
      </div>

      <div className="mt-4 flex flex-col items-center text-center">
        <span
          className={cn(
            "flex size-14 items-center justify-center rounded-full px-1 text-center leading-none",
            avatarTone,
            showAssignedUnit ? "text-[13px] font-bold" : "text-[18px] font-bold"
          )}
        >
          {showAssignedUnit
            ? unitShortTag(unit)
            : (report.reporter?.initials || initialsOf(fullName)).charAt(0)}
        </span>
        <p className="mt-2 text-[18px] leading-tight font-bold text-balance text-foreground">
          {identityName || "Assigned response unit"}
        </p>
        <p className="text-[13px] text-neutral-500">{identityLabel}</p>
      </div>
    </div>
  )
}
