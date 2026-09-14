import { useState } from "react"
import {
  Building2Icon,
  CircleX,
  MessageCircleIcon,
  PhoneIcon,
  PlayIcon,
  TriangleAlertIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import type { Concern } from "@/features/dashboard/api"
import { useAuthSession } from "@/features/auth/auth-session"
import { isCriticalConcern } from "@/features/dashboard/lib/critical-concern"
import { AuthenticatedMediaImage } from "@/features/dashboard/components/authenticated-media"
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

function reportSentence(report: Concern) {
  const source = tidySentence(
    report.summary?.trim() || report.title?.trim() || report.description?.trim()
  )
  return source ? `The resident reports ${source}.` : "The resident submitted this report."
}

export function ReportDescriptionCard({
  report,
  onMediaPreview,
}: {
  report: Concern
  onMediaPreview?: (items: MediaPreviewItem[], index: number) => void
}) {
  const media = report.media ?? []
  const description = report.description?.trim()
  const critical = isCriticalConcern(report)

  return (
    <article
      className={cn(
        "flex w-full items-start gap-2 rounded-2xl px-3.5 py-3 text-[15px] leading-relaxed",
        critical
          ? "bg-severity-critical-surface text-sos"
          : "bg-brand-orange-soft text-orange-800"
      )}
    >
      {report.status === "rejected" ? (
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
        {description ? (
          <p className="mt-2 border-l-2 border-current/20 py-1 pl-3 text-[14px] leading-relaxed break-words whitespace-pre-wrap">
            {description}
          </p>
        ) : null}
        {media.length ? (
          <div className="mt-3 border-t border-current/15 pt-3">
            <div className="grid grid-cols-2 gap-2">
              {media.map((item, index) => {
                const isImage = item.mime_type?.startsWith("image/")
                const previewItems = media.map((entry) =>
                  toMediaPreviewItem(
                    mediaDisplaySource(entry),
                    entry.original_filename || "Report evidence",
                    entry.mime_type,
                    entry
                  )
                )
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-label="Open report evidence"
                    className={cn(
                      "overflow-hidden rounded-xl border border-current/15 bg-white text-left transition-colors hover:border-current/35 focus-visible:ring-2 focus-visible:ring-current focus-visible:outline-none",
                      !isImage && "flex h-24 items-center justify-center px-3"
                    )}
                    onClick={() => onMediaPreview?.(previewItems, index)}
                  >
                    {isImage ? (
                      <AuthenticatedMediaImage
                        src={mediaDisplaySource(item)}
                        alt={item.original_filename || "Report evidence"}
                        className="h-24 w-full object-cover"
                      />
                    ) : (
                      <PlayIcon className="size-4 shrink-0 text-neutral-500" />
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}
      </div>
    </article>
  )
}

export function ReportReporterCard({ report }: { report: Concern }) {
  const { user } = useAuthSession()
  const [calling, setCalling] = useState(false)
  const assignedUnit =
    report.assigned_department ?? report.community_incident?.assigned_unit ?? null
  const assignedUnitName = assignedUnit?.name?.trim() || ""
  const assignedUnitShort =
    assignedUnit?.short_name?.trim() || assignedUnit?.code?.trim() || ""
  const name = report.reporter?.full_name?.trim() || report.reporter_full_name?.trim() || "Resident"
  const phone = report.reporter?.phone_number?.trim() || ""
  const canCall = Boolean(phone) && user?.id !== report.reporter?.id

  function callReporter() {
    if (!canCall || calling) return
    setCalling(true)
    window.location.href = `tel:${phone}`
    window.setTimeout(() => setCalling(false), 1000)
  }

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-neutral-200 bg-white px-3.5 py-3">
      {assignedUnitName ? (
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-slate-soft text-navy-muted">
          <Building2Icon className="size-5" strokeWidth={1.9} aria-hidden />
        </span>
      ) : (
        <UserAvatar user={report.reporter} size="lg" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold tracking-wide text-neutral-500 uppercase">
          {assignedUnitName ? "Assigned unit" : "Reported by"}
        </p>
        <p className="break-words whitespace-normal text-[15px] font-semibold text-neutral-900">
          {assignedUnitName
            ? `${assignedUnitName}${assignedUnitShort ? ` (${assignedUnitShort})` : ""}`
            : name}
        </p>
        <p className="text-[12px] text-neutral-500">
          {assignedUnitName
            ? assignedUnit?.description?.trim() || "Response unit"
            : phone || "Resident"}
        </p>
      </div>
      {!assignedUnitName && canCall ? (
        <button
          type="button"
          onClick={callReporter}
          disabled={calling}
          aria-label={`Call ${name}`}
          title={`Call ${name}`}
          className="flex size-10 shrink-0 items-center justify-center rounded-full text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:outline-none disabled:opacity-50"
        >
          <PhoneIcon className="size-5" aria-hidden="true" />
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
