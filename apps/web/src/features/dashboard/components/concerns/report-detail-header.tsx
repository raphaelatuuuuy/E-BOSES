import { useState } from "react"
import { PhoneIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import type { Concern } from "@/features/dashboard/api"
import { useAuthSession } from "@/features/auth/auth-session"
import {
  avatarTone,
  concernReporterName,
} from "@/features/dashboard/components/concerns/concern-queue-item"
import { concernSeverityOf } from "@/features/dashboard/components/record/concern-adapter"
import { unitShortTag } from "@/features/dashboard/components/concerns/concern-display"
import { UserAvatar } from "@/features/dashboard/components/home/user-avatar"

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

export function ReportDetailHeader({
  report,
  audience = "resident",
}: {
  report: Concern
  audience?: "resident" | "official"
}) {
  const fullName = concernReporterName(report)
  const isGuestReport =
    Boolean(report.is_anonymous) ||
    fullName.trim().toLowerCase() === "community reporter"
  const unit =
    report.validation_status === "accepted"
      ? (report.assigned_department ??
        report.community_incident?.assigned_unit ??
        null)
      : null
  const showAssignedUnit =
    audience === "resident" && Boolean(unit) && !isGuestReport
  const identityName = showAssignedUnit ? unit?.name : fullName
  const identityLabel = isGuestReport
    ? "Anonymous"
    : showAssignedUnit
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
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-neutral-500 tabular-nums">
            {submittedAt(report.created_at)}
          </span>
        </div>
      </div>

      <div className="mt-4 flex flex-col items-center text-center">
        {showAssignedUnit ? (
          <span
            className={cn(
              "flex size-14 items-center justify-center rounded-full px-1 text-center leading-none",
              avatarTone,
              "text-[13px] font-bold",
            )}
          >
            {unitShortTag(unit)}
          </span>
        ) : (
          <UserAvatar
            user={report.reporter}
            size="lg"
            online={report.reporter?.is_online}
            className={cn("!size-14 text-[18px]", avatarTone)}
          />
        )}
        <p className="mt-2 text-[18px] leading-tight font-bold text-balance text-foreground">
          {identityName || "Assigned response unit"}
        </p>
        <p className="text-[13px] text-neutral-500">{identityLabel}</p>
      </div>
    </div>
  )
}
