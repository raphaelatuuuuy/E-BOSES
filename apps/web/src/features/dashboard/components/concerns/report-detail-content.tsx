import { useState } from "react"
import {
  Building2Icon,
  CircleCheck,
  CircleX,
  MessageCircleIcon,
  PhoneIcon,
  PlayIcon,
  SignalHighIcon,
  SignalIcon,
  SignalLowIcon,
  SignalMediumIcon,
  TriangleAlertIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import type { Concern } from "@/features/dashboard/api"
import { formatResolvedOn } from "@/features/dashboard/lib/responder-format"
import { useAuthSession } from "@/features/auth/auth-session"
import { isCriticalConcern } from "@/features/dashboard/lib/critical-concern"
import {
  SEVERITY_LABEL,
  type Severity,
} from "@/features/dashboard/components/record/severity"
import { ReportPhotoPreview } from "@/features/dashboard/components/concerns/resolved-photo"
import { UserAvatar } from "@/features/dashboard/components/home/user-avatar"
import {
  mediaDisplaySource,
  toMediaPreviewItem,
  type MediaPreviewItem,
} from "@/features/dashboard/lib/authenticated-media"

function tidySentence(value: string) {
  const clean = value.trim()
  if (!clean) return ""
  const lowered = /^[A-Z]/.test(clean)
    ? `${clean.slice(0, 1).toLowerCase()}${clean.slice(1)}`
    : clean
  return lowered.replace(/[.!?]+$/, "")
}

function sameText(a: string, b: string) {
  const norm = (v: string) =>
    v.trim().toLowerCase().replace(/[.!?]+$/, "").replace(/\s+/g, " ")
  return norm(a) === norm(b)
}

function reportSentence(report: Concern) {
  const raw = (
    report.summary?.trim() ||
    report.title?.trim() ||
    report.description?.trim() ||
    ""
  ).trim()
  if (!raw) return "The resident submitted this report."
  if (/^(the resident|the report|this report|a report)\b/i.test(raw)) {
    const sentence = `${raw.charAt(0).toUpperCase()}${raw.slice(1)}`
    return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`
  }
  const source = tidySentence(raw)
  return `The resident reports ${source}.`
}

const PRIORITY_META: Record<
  Severity,
  { icon: typeof SignalIcon; tone: string }
> = {
  critical: { icon: SignalIcon, tone: "text-severity-critical-map-ink" },
  high: { icon: SignalHighIcon, tone: "text-[#cf4a40]" },
  moderate: { icon: SignalMediumIcon, tone: "text-severity-moderate" },
  low: { icon: SignalLowIcon, tone: "text-neutral-600" },
}

export function ReportPriorityIndicator({
  severity,
  className,
}: {
  severity: Severity
  className?: string
}) {
  const meta = PRIORITY_META[severity]
  const Icon = meta.icon
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 text-[11px] font-medium leading-none",
        meta.tone,
        className
      )}
      aria-label={SEVERITY_LABEL[severity]}
    >
      <Icon className="size-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
      <span>{SEVERITY_LABEL[severity]}</span>
    </span>
  )
}

export function ReportDescriptionCard({
  report,
  onMediaPreview,
}: {
  report: Concern
  onMediaPreview?: (items: MediaPreviewItem[], index: number) => void
}) {
  const media = report.media ?? []
  const description = report.description?.trim() || ""
  const summaryText = report.summary?.trim() || ""
  const titleText = report.title?.trim() || ""
  const headlineSource = summaryText || titleText || description
  const readableDescription =
    description && headlineSource && !sameText(description, headlineSource)
      ? description
      : ""
  const critical = isCriticalConcern(report)
  const resolved = report.status === "resolved"
  const resolvedEvents = (report.status_events ?? []).filter(
    (event) => event.status === "resolved"
  )
  const resolvedAt = resolvedEvents.length
    ? resolvedEvents[resolvedEvents.length - 1].created_at
    : report.updated_at
  const reportImages = media.filter((item) =>
    item.mime_type?.startsWith("image/")
  )
  const firstReportImage = reportImages[0] ?? null
  const resolutionImages = (report.resolution_evidence ?? []).filter((item) =>
    item.mime_type?.startsWith("image/")
  )
  const firstResolutionImage = resolutionImages[0] ?? null
  const originalSrc = firstReportImage
    ? mediaDisplaySource(firstReportImage)
    : null
  const bareResolutionSrc = report.resolution_photo ?? null
  const resolutionSrc = firstResolutionImage
    ? firstResolutionImage.preview_url || firstResolutionImage.raw_url
    : bareResolutionSrc
  const displaySrc = resolutionSrc || originalSrc
  const previewItems: MediaPreviewItem[] = [
    ...media.map((entry) => ({
      ...toMediaPreviewItem(
        mediaDisplaySource(entry),
        entry.original_filename || "Report evidence",
        entry.mime_type,
        entry
      ),
      badge: "Reported issue",
    })),
    ...resolutionImages.map((entry) => ({
      ...toMediaPreviewItem(
        entry.preview_url || entry.raw_url,
        entry.original_filename || "Resolution photo",
        entry.mime_type
      ),
      badge: "Resolved case",
    })),
    ...(!firstResolutionImage && bareResolutionSrc
      ? [
          {
            src: bareResolutionSrc,
            filename: "Resolution photo",
            kind: "image" as const,
          },
        ]
      : []),
  ]

  function openSinglePreview() {
    if (!previewItems.length) return
    if (resolutionSrc) {
      onMediaPreview?.(previewItems, media.length)
      return
    }
    const index = firstReportImage ? media.indexOf(firstReportImage) : 0
    onMediaPreview?.(previewItems, index)
  }

  return (
    <article
      className={cn(
        "flex w-full items-start gap-2 rounded-2xl px-3.5 py-3 text-[15px] leading-relaxed",
        resolved
          ? "bg-emerald-50 text-emerald-900"
          : critical
            ? "bg-severity-critical-surface text-sos"
            : "bg-brand-orange-soft text-orange-800"
      )}
    >
      {resolved ? (
        <CircleCheck
          className="mt-[2px] size-5 shrink-0 text-emerald-600"
          strokeWidth={2.1}
          aria-hidden
        />
      ) : report.status === "rejected" ? (
        <CircleX
          className="mt-[2px] size-5 shrink-0 text-red-600"
          strokeWidth={2.1}
          aria-hidden
        />
      ) : (
        <TriangleAlertIcon
          className="mt-[2px] size-5 shrink-0"
          strokeWidth={1.9}
          aria-hidden
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="font-medium break-words whitespace-pre-wrap">
          {reportSentence(report)}
        </p>
        {resolved ? (
          <p className="mt-2 text-[13px] font-normal">
            This issue was resolved on {formatResolvedOn(resolvedAt)}.
          </p>
        ) : null}
        {readableDescription || media.length || displaySrc ? (
          <div className="mt-2 border-l-2 border-current/20 py-1 pl-3">
            {readableDescription ? (
              <p className="text-[14px] leading-relaxed break-words whitespace-pre-wrap">
                {readableDescription}
              </p>
            ) : null}
            {media.length || displaySrc ? (
              <div className={cn(readableDescription && "mt-3")}>
                {displaySrc ? (
                  <ReportPhotoPreview
                    originalSrc={originalSrc}
                    resolutionSrc={resolutionSrc}
                    alt={
                      firstReportImage?.original_filename || "Report evidence"
                    }
                    onOpen={openSinglePreview}
                  />
                ) : (
                  <button
                    type="button"
                    aria-label="Open report evidence"
                    className="flex h-24 w-full items-center justify-center gap-2 overflow-hidden rounded-2xl border border-neutral-200 bg-white text-[12px] font-semibold text-neutral-700 transition-colors hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:outline-none"
                    onClick={() => openSinglePreview()}
                  >
                    <PlayIcon className="size-4 shrink-0" />
                    Video evidence
                  </button>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  )
}

export function ReportReporterCard({
  report,
  onChat,
}: {
  report: Concern
  onChat?: () => void
}) {
  const { user } = useAuthSession()
  const [calling, setCalling] = useState(false)
  const name = report.reporter?.full_name?.trim() || report.reporter_full_name?.trim() || "Resident"
  const phone = report.reporter?.phone_number?.trim() || ""
  const isAnonymous = report.is_anonymous === true || report.reporter?.id === 0
  const redacted = report.status === "resolved"
  const canCall = Boolean(phone) && user?.id !== report.reporter?.id && !redacted

  function callReporter() {
    if (!canCall || calling) return
    setCalling(true)
    window.location.href = `tel:${phone}`
    window.setTimeout(() => setCalling(false), 1000)
  }

  if (report.is_cross_community) {
    return (
      <p className="text-center text-[13px] text-neutral-500">
        This report came from outside community.
      </p>
    )
  }

  return (
    <div className="flex items-center gap-3">
      <UserAvatar user={report.reporter} size="lg" />
      <div className="min-w-0 flex-1">
        <p className="break-words whitespace-normal text-[15px] font-semibold text-neutral-900">
          {name}
        </p>
        <p className="text-[12px] text-neutral-500">
          {redacted ? "Phone unavailable" : (phone || (isAnonymous ? "Anonymous report" : "Resident"))}
        </p>
      </div>
      {canCall ? (
        <button
          type="button"
          onClick={callReporter}
          disabled={calling}
          aria-label={`Call ${name}`}
          title={`Call ${name}`}
          className="inline-flex shrink-0 items-center gap-1 rounded-full px-1 py-0.5 text-[12px] font-normal text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-50"
        >
          <PhoneIcon className="size-4" aria-hidden="true" />
          <span>Call</span>
        </button>
      ) : null}
      {onChat && !isAnonymous ? (
        <button
          type="button"
          onClick={onChat}
          aria-label="Chat"
          title="Chat"
          className="inline-flex shrink-0 items-center gap-1 rounded-full px-1 py-0.5 text-[12px] font-normal text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          <MessageCircleIcon className="size-4" aria-hidden />
          <span>Chat</span>
        </button>
      ) : null}
    </div>
  )
}

export function ReportAssignmentFooter({
  report,
  onChat,
}: {
  report: Concern
  onChat?: () => void
}) {
  const unit =
    report.assigned_department ?? report.community_incident?.assigned_unit ?? null
  const name = unit?.name?.trim()
  if (!unit || !name) return null
  const shortName = unit.short_name?.trim() || unit.code?.trim() || ""

  return (
    <div className="flex items-center gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-soft text-navy-muted">
        <Building2Icon className="size-4.5" strokeWidth={1.9} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="break-words whitespace-normal text-[14px] font-semibold text-neutral-900">
          {name}{shortName ? ` (${shortName})` : ""}
        </p>
      </div>
      {onChat ? (
        <button
          type="button"
          onClick={onChat}
          aria-label="Chat"
          title="Chat"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-1.5 py-1 text-[13px] font-normal text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          <MessageCircleIcon className="size-4" aria-hidden />
          <span>Chat</span>
        </button>
      ) : null}
    </div>
  )
}
