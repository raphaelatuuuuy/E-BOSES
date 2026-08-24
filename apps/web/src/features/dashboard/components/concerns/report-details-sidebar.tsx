import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { useAuthSession } from "@/features/auth/auth-session"
import {
  ClockIcon,
  CopyIcon,
  FileIcon,
  InfoIcon,
  Network,
  HardHat,
  CircleCheck,
  CircleX,
  TriangleAlert,
  MessageCircleIcon,
  PlayIcon,
} from "lucide-react"
import { toast } from "sonner"

import { cn } from "@workspace/ui/lib/utils"

import type { Concern } from "@/features/dashboard/api"
import { listConcernChat } from "@/features/dashboard/api"
import { concernBodyText } from "@/features/dashboard/components/feed-post-text"
import { ReportChatPanel } from "@/features/dashboard/components/report-chat-panel"
import {
  AuthenticatedMediaImage,
  MediaLightbox,
} from "@/features/dashboard/components/authenticated-media"
import {
  mediaDisplaySource,
  toMediaPreviewItem,
  type MediaPreviewItem,
} from "@/features/dashboard/lib/authenticated-media"
import {
  ReportLocationMap,
} from "@/features/dashboard/components/report-location-map"
import {
  concernCategoryLabel,
  formatDate,
} from "@/features/dashboard/components/concerns/concern-display"
import { resolveIconByKey } from "@/features/dashboard/components/concerns/resolve-icon"
import { OfficialStatusPanelWithDraft } from "@/features/dashboard/components/concerns/official-status-panel"
import { EvidenceGrid } from "@/features/dashboard/components/record/evidence-grid"
import {
  SheetDialog,
  SheetIconButton,
} from "@/features/dashboard/components/sheet-dialog"
import { roleLabel } from "@/features/dashboard/lib/people"

/** Alert banner — icon + bg + border + text by status. */
function statusAlertStyle(status: string) {
  switch (status) {
    case "submitted": return { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700", icon: InfoIcon }
    case "under_review": return { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700", icon: InfoIcon }
    case "assigned": return { bg: "bg-indigo-50", border: "border-indigo-200", text: "text-indigo-700", icon: Network }
    case "in_progress": return { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", icon: HardHat }
    case "resolved": return { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", icon: CircleCheck }
    case "rejected": return { bg: "bg-red-50", border: "border-red-200", text: "text-red-700", icon: CircleX }
    case "appealed": return { bg: "bg-violet-50", border: "border-violet-200", text: "text-violet-700", icon: TriangleAlert }
    default: return { bg: "bg-neutral-50", border: "border-neutral-200", text: "text-neutral-600", icon: InfoIcon }
  }
}

/** Brief one-line status summary. */
function statusSummary(status: string) {
  switch (status) {
    case "submitted": return "Your report has been submitted and is pending review."
    case "under_review": return "An officer is currently reviewing your report."
    case "assigned": return "This report has been assigned to a unit for action."
    case "in_progress": return "Work is underway to address this issue."
    case "resolved": return "This issue has been resolved. Thank you for your report."
    case "rejected": return "This report was not accepted. You may submit an appeal."
    case "appealed": return "Your appeal is being reviewed by an officer."
    default: return "Your report is being processed."
  }
}

/** User-friendly timeline sentence. */
function friendlyTimelineText(status: string, note: string) {
  const n = (note || "").trim()
  switch (status) {
    case "submitted":
      return n && n !== "Report submitted." && n !== "Status updated."
        ? n
        : "Your report has been submitted and is now under review."
    case "under_review":
      return n && n !== "Status updated."
        ? n
        : "An officer is reviewing your report."
    case "assigned":
      return n && n !== "Status updated."
        ? n
        : "This report has been assigned to a unit."
    case "in_progress":
      return n && n !== "Status updated."
        ? n
        : "Work is underway to address this issue."
    case "resolved":
      return n && n !== "Status updated."
        ? n
        : "This issue has been resolved. Thank you for your report."
    case "rejected":
      return n && n !== "Status updated."
        ? n
        : "This report was not accepted. You may submit an appeal."
    case "appealed":
      return n && n !== "Status updated."
        ? n
        : "Your appeal is being reviewed by an officer."
    default:
      return n && n !== "Status updated." ? n : "Status updated."
  }
}

/** Actor footer label for timeline entries. */
function actorFooterLabel(status: string, actor: string, isOwnReport: boolean) {
  const name = isOwnReport ? "You" : (actor.split(" · ")[0] || "System")

  switch (status) {
    case "submitted": return `Submitted by ${name}`
    case "under_review": return `Reviewed by ${name}`
    case "assigned": return `Assigned by ${name}`
    case "in_progress": return `Updated by ${name}`
    case "resolved": return `Resolved by ${name}`
    case "rejected": return `Rejected by ${name}`
    case "appealed": return `Appealed by ${name}`
    default: return name
  }
}

function statusLabel(status: string) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatShortTime(value: string) {
  const date = new Date(value)
  const day = date.getDate()
  const suffix = day === 1 || day === 21 || day === 31 ? "st" : day === 2 || day === 22 ? "nd" : day === 3 || day === 23 ? "rd" : "th"
  const month = date.toLocaleDateString("en", { month: "long" })
  const time = date.toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" })
  return `${day}${suffix} ${month}, ${time}`
}

export function ReportDetailsSidebar({
  report,
  onClose,
  onCopyTrackingId,
  onRefresh,
  onUpdated,
  isOfficial,
  residentFollowUp,
}: {
  report: Concern
  onClose: () => void
  onCopyTrackingId: () => void
  onRefresh: () => Promise<void>
  onUpdated: (report: Concern) => void
  isOfficial: boolean
  residentFollowUp: ReactNode
}) {
  const [chatOpen, setChatOpen] = useState(false)
  const [timelineOpen, setTimelineOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [lightbox, setLightbox] = useState<{ items: MediaPreviewItem[]; index: number } | null>(null)
  const lastSeenIdRef = useRef<number | null>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const { user } = useAuthSession()
  const isOwnReport = user?.id === report.reporter?.id

  const showAppeals = !isOfficial && (
    report.status === "rejected" ||
    report.status === "appealed" ||
    Boolean(report.appeals?.length)
  )
  const resolutionEvidence = report.resolution_evidence ?? []

  // Build timeline entries from status_events
  const timelineEntries = (report.status_events ?? [])
    .filter((e) => !(e.status === "under_review" && e.note.trim() === "An officer is checking the details of this report."))
    .map((event, i, list) => ({
      id: String(event.id),
      status: event.status,
      time: event.created_at,
      badge: statusLabel(event.status),
      actor: event.actor?.full_name ? `${event.actor.full_name} · ${roleLabel(event.actor) || "System"}` : null,
      note: event.note?.trim() || "Status updated.",
      isLast: i === list.length - 1,
    }))

  function openPreview(items: MediaPreviewItem[], index: number) {
    setLightbox({ items, index })
  }

  function handleCopyTrackingId() {
    onCopyTrackingId()
    toast.success("Tracking ID copied")
  }

  // Reset chat mode when report changes
  useEffect(() => {
    setChatOpen(false)
    setTimelineOpen(false)
    setUnreadCount(0)
    lastSeenIdRef.current = null
  }, [report.id])

  // Close timeline on click outside
  useEffect(() => {
    if (!timelineOpen) return
    function handleClick(e: MouseEvent) {
      if (timelineRef.current && !timelineRef.current.contains(e.target as Node)) {
        setTimelineOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [timelineOpen])

  // Poll for unread messages
  const closedCase = ["rejected", "appealed", "resolved"].includes(report.status)

  const pollUnread = useCallback(async () => {
    if (chatOpen || closedCase) return
    try {
      const messages = await listConcernChat(report.id, { limit: 1 })
      if (messages.length === 0) return
      const latestId = messages[messages.length - 1].id
      if (lastSeenIdRef.current === null) {
        lastSeenIdRef.current = latestId
        return
      }
      if (latestId > lastSeenIdRef.current) {
        const newer = await listConcernChat(report.id, { afterId: lastSeenIdRef.current, limit: 20 })
        const newMessages = newer.filter((m) => !m.is_mine)
        setUnreadCount((prev) => prev + newMessages.length)
        lastSeenIdRef.current = latestId
      }
    } catch {
      // silent
    }
  }, [chatOpen, closedCase, report.id])

  useEffect(() => {
    if (chatOpen || closedCase) return
    void listConcernChat(report.id, { limit: 1 }).then((msgs) => {
      if (msgs.length > 0) lastSeenIdRef.current = msgs[msgs.length - 1].id
    }).catch(() => {})
    const timer = window.setInterval(() => {
      if (document.hidden) return
      void pollUnread()
    }, 30_000)
    return () => window.clearInterval(timer)
  }, [chatOpen, closedCase, report.id, pollUnread])

  useEffect(() => {
    if (chatOpen) setUnreadCount(0)
  }, [chatOpen])

  return (
    <>
      <SheetDialog
        open
        onClose={onClose}
        size="wide"
        onBack={chatOpen ? () => setChatOpen(false) : onClose}
        title={chatOpen ? "Chat" : "Report details"}
        description={
          chatOpen
            ? `${report.tracking_id} · Private thread`
            : (
              <span className="flex items-center gap-1.5 text-[13px] text-neutral-500">
                <span>{report.tracking_id}</span>
                <span className="text-neutral-300">·</span>
                <span className="inline-flex items-center gap-1">
                  {(() => {
                    const CatIcon = resolveIconByKey(report.category_ref?.icon_key)
                    return CatIcon ? <CatIcon className="size-3.5" /> : null
                  })()}
                  {concernCategoryLabel(report)}
                </span>
              </span>
            )
        }
        actions={
          chatOpen ? undefined : (
            <div ref={timelineRef} className="relative flex shrink-0 items-center gap-0.5">
              <SheetIconButton label="Chat" onClick={() => setChatOpen(true)} className="relative">
                <MessageCircleIcon className="size-[18px]" />
                {unreadCount > 0 ? (
                  <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-sos text-[9px] font-bold text-white">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                ) : null}
              </SheetIconButton>
              <SheetIconButton label="Copy tracking ID" onClick={handleCopyTrackingId}>
                <CopyIcon className="size-[18px]" />
              </SheetIconButton>
              <SheetIconButton label="Activity" onClick={() => setTimelineOpen((p) => !p)} className={cn(timelineOpen && "bg-neutral-100 text-neutral-900")}>
                <ClockIcon className="size-[18px]" />
              </SheetIconButton>

              {/* Timeline dropdown */}
              {timelineOpen ? (
                <div className="absolute right-0 top-full z-50 mt-2 w-80 max-h-[60vh] overflow-y-auto rounded-xl border border-neutral-200 bg-white shadow-lg animate-in fade-in slide-in-from-top-1 duration-150 fill-mode-both">
                  <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-2.5">
                    <p className="text-[13px] font-medium text-neutral-700">Activity</p>
                    <button type="button" onClick={() => setTimelineOpen(false)} className="text-[11px] text-neutral-400 hover:text-neutral-600">
                      Close
                    </button>
                  </div>
                  <div className="p-4">
                    {timelineEntries.length > 0 ? (
                      <div className="space-y-3">
                        {timelineEntries.map((entry) => (
                          <div key={entry.id} className="space-y-2">
                            {/* Date + actor divider */}
                            {entry.time ? (
                              <div className="flex items-center gap-3">
                                <span className="flex-1 h-px bg-neutral-200" />
                                <div className="shrink-0 text-center">
                                  <time className="text-[11px] tabular-nums text-neutral-400 block">
                                    {formatShortTime(entry.time)}
                                  </time>
                                  {entry.actor ? (
                                    <p className="text-[11px] text-neutral-400">
                                      {actorFooterLabel(entry.status, entry.actor, isOwnReport)}
                                    </p>
                                  ) : null}
                                </div>
                                <span className="flex-1 h-px bg-neutral-200" />
                              </div>
                            ) : null}
                            {/* Alert banner */}
                            {(() => {
                              const style = statusAlertStyle(entry.status)
                              const Icon = style.icon
                              return (
                                <div className={cn("flex items-start gap-2.5 rounded-md px-3 py-2.5", style.bg)}>
                                  <Icon className={cn("size-4 shrink-0 mt-0.5", style.text)} />
                                  <p className={cn("text-[12px] leading-snug", style.text)}>
                                    {friendlyTimelineText(entry.status, entry.note)}
                                  </p>
                                </div>
                              )
                            })()}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[13px] text-neutral-400 text-center py-4">No activity yet.</p>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          )
        }
        bodyClassName={chatOpen ? "px-0 pb-0" : undefined}
        className={cn(
          "max-w-[min(100%,42rem)] sm:max-w-[42rem] md:max-w-[48rem]",
          chatOpen && "!max-h-[min(900px,95vh)]",
        )}
      >
        {chatOpen ? (
          /* ── Chat mode ── */
          <div key="chat" className="min-h-0 flex-1 animate-in fade-in slide-in-from-right-2 duration-200 fill-mode-both">
            <ReportChatPanel
              concernId={report.id}
              open
              disabled={closedCase}
              showHistory
              plain
              title={closedCase ? "Chat closed" : "Messages"}
              subtitle={
                closedCase
                  ? "This report is closed. Follow-ups go through the appeal section."
                  : "Follow-up messages and checked attachments stay with this case."
              }
              emptyMessage="Message the barangay team about this report. Updates and questions stay here."
              onMessageSent={onRefresh}
              className="h-full border-0 rounded-none p-0"
            />
          </div>
        ) : (
          /* ── Details mode ── */
          <div key="details" className="animate-in fade-in slide-in-from-left-2 duration-200 fill-mode-both space-y-4">

            {/* Hero Map */}
            <div className="overflow-hidden rounded-lg border border-neutral-200">
              <ReportLocationMap
                latitude={report.latitude}
                longitude={report.longitude}
                streetAddress={report.address}
                category={report.category}
                iconKey={report.category_ref?.icon_key}
                heightClassName="h-44 sm:h-48"
                className="rounded-none border-0"
              />
            </div>

            {/* Content — reporter + description */}
              {/* Reporter + description + photos */}
              <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3.5 py-3 space-y-3">
                {/* Status banner — above avatar */}
                {(() => {
                  const style = statusAlertStyle(report.status)
                  const Icon = style.icon
                  return (
                    <div className={cn("flex items-center gap-2.5 rounded-lg px-3 py-2.5", style.bg)}>
                      <Icon className={cn("size-4 shrink-0", style.text)} />
                      <p className={cn("text-[13px] leading-snug", style.text)}>
                        {statusSummary(report.status)}
                      </p>
                    </div>
                  )
                })()}

                <div className="flex items-center gap-2.5">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#c5d0e6] text-[14px] font-bold text-[#43507f]">
                    {(report.reporter_full_name || report.reporter?.full_name || "R")[0]?.toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold text-neutral-900 truncate">
                      {isOwnReport ? "Reported by You" : (report.reporter_full_name || report.reporter?.full_name || "Resident")}
                    </p>
                    <p className="text-[12px] text-neutral-500 truncate">
                      {report.address || "Location pinned on map"} · {formatDate(report.created_at)} · {report.visibility === "community" ? "Public" : "Private"}
                    </p>
                  </div>
                </div>

                {/* Description + photos — aligned with street address */}
                <div className="pl-[50px] space-y-3">
                  <p className="text-[13px] leading-5 text-neutral-600 whitespace-pre-wrap">
                    {concernBodyText(report) || "No description provided."}
                  </p>
                  {report.media?.length ? (
                    <EvidenceGrid media={report.media} onPreview={openPreview} />
                  ) : null}
                </div>
              </div>

            {/* Community reports */}
            {report.also_reported_count > 0 && report.visibility === "community" ? (
              <p className="text-[13px] text-neutral-500">
                Also reported by {report.also_reported_count} other{" "}
                {report.also_reported_count === 1 ? "resident" : "residents"}.
              </p>
            ) : null}

            {/* Resolution evidence */}
            {resolutionEvidence.length ? (
              <div>
                <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-neutral-400">Resolution evidence</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {resolutionEvidence.map((evidence, evidenceIndex) =>
                    evidence.mime_type.startsWith("image/") ? (
                      <button
                        key={evidence.id}
                        type="button"
                        onClick={() =>
                          openPreview(
                            resolutionEvidence.map((e) =>
                              toMediaPreviewItem(mediaDisplaySource(e), e.original_filename, e.mime_type),
                            ),
                            evidenceIndex,
                          )
                        }
                        className="overflow-hidden rounded-xl border border-neutral-200 bg-white text-left transition-colors hover:border-neutral-400"
                      >
                        <AuthenticatedMediaImage
                          src={mediaDisplaySource(evidence)}
                          alt={evidence.original_filename}
                          className="h-24 w-full object-cover"
                        />
                      </button>
                    ) : (
                      <button
                        key={evidence.id}
                        type="button"
                        onClick={() =>
                          openPreview(
                            resolutionEvidence.map((e) =>
                              toMediaPreviewItem(mediaDisplaySource(e), e.original_filename, e.mime_type),
                            ),
                            evidenceIndex,
                          )
                        }
                        className="flex h-24 items-center justify-center gap-1.5 rounded-xl border border-neutral-200 bg-white text-[11px] font-medium text-neutral-500 transition-colors hover:border-neutral-400 hover:text-neutral-900"
                      >
                        {evidence.mime_type.startsWith("video/") ? (
                          <><PlayIcon className="size-4" /> Video</>
                        ) : (
                          <><FileIcon className="size-4" /> File</>
                        )}
                      </button>
                    ),
                  )}
                </div>
              </div>
            ) : null}

            {/* Official actions */}
            {isOfficial ? (
              <OfficialStatusPanelWithDraft key={report.id} report={report} onUpdated={onUpdated} />
            ) : null}

            {/* Action buttons */}
            {!closedCase ? (
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setChatOpen(true)}
                  className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-full border border-neutral-200 bg-white px-5 py-3 text-[14px] font-medium text-neutral-900 transition-colors hover:bg-neutral-50"
                >
                  <MessageCircleIcon className="size-4.5" />
                  Message
                </button>
                {report.status === "rejected" ? (
                  <button
                    type="button"
                    className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-full bg-orange-500 px-5 py-3 text-[14px] font-medium text-white transition-colors hover:bg-orange-600"
                  >
                    Appeal
                  </button>
                ) : null}
              </div>
            ) : null}

            {/* Appeals */}
            {showAppeals ? (
              <div>
                <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-neutral-400">Appeals</p>
                {residentFollowUp}
              </div>
            ) : null}
          </div>
        )}
      </SheetDialog>

      {lightbox ? (
        <MediaLightbox
          items={lightbox.items}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </>
  )
}
