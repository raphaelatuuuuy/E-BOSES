import { useEffect, type ReactNode } from "react"
import {
  ArrowUpIcon,
  CalendarIcon,
  ClockIcon,
  CopyIcon,
  Share2Icon,
  XIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import { CollapsibleSection } from "@/features/dashboard/components/concerns/collapsible-section"
import type { Concern } from "@/features/dashboard/api"
import { concernBodyText } from "@/features/dashboard/components/feed-post-card"
import { ReportChatPanel } from "@/features/dashboard/components/report-chat-panel"
import {
  AuthenticatedMediaImage,
  openAuthenticatedMedia,
} from "@/features/dashboard/components/authenticated-media"
import {
  ReportLocationMap,
} from "@/features/dashboard/components/report-location-map"
import { ConcernTimeline } from "@/features/dashboard/components/concerns/concern-timeline"
import { buildConcernTimelineEntries } from "@/features/dashboard/components/concerns/concern-timeline-lib"
import {
  concernCategoryLabel,
  categoryStyles,
  daysAgo,
  formatDate,
  statusColors,
  statusGroup,
} from "@/features/dashboard/components/concerns/concern-display"
import { ReportIcon } from "@/features/dashboard/components/concerns/report-icon"
import { OfficialStatusPanel } from "@/features/dashboard/components/concerns/official-status-panel"

function EvidencePreviewGrid({ media }: { media: Concern["media"] }) {
  const previewMedia = media.slice(0, 3)
  const moreCount = Math.max(0, media.length - previewMedia.length)

  if (!media.length) return null

  return (
    <div className="mt-3 space-y-2">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {previewMedia.map((item) =>
          item.mime_type.startsWith("image/") ? (
            <button
              key={item.id}
              type="button"
              onClick={() => void openAuthenticatedMedia(item.raw_url, item.original_filename)}
              className="overflow-hidden rounded-xl border border-neutral-200 bg-white text-left transition-colors hover:border-brand-orange"
            >
              <AuthenticatedMediaImage
                src={item.preview_url}
                alt={item.original_filename}
                className="h-28 w-full object-cover"
              />
              <span className="block truncate px-3 py-2 text-[12px] font-semibold text-neutral-700">
                {item.original_filename}
              </span>
            </button>
          ) : (
            <a
              key={item.id}
              href={item.raw_url}
              target="_blank"
              rel="noreferrer"
              className="flex h-28 items-center justify-center rounded-xl border border-neutral-200 bg-white px-3 text-center text-[12px] font-semibold text-neutral-700 transition-colors hover:border-brand-orange hover:text-neutral-900"
            >
              {item.original_filename}
            </a>
          ),
        )}
      </div>
      {moreCount > 0 ? <p className="text-[12px] font-medium text-neutral-500">+{moreCount} more</p> : null}
    </div>
  )
}

/** Extracted verbatim from `pages/reports.tsx` (was inline in the same file as the panels it uses). */
function DetailSection({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-3", className)}>
      <h3 className="text-[13px] font-semibold tracking-wide text-neutral-500 uppercase">{title}</h3>
      {children}
    </section>
  )
}

/**
 * Extracted from `pages/reports.tsx`. Behavior-identical, with one structural change:
 * the resident-side follow-up/appeal UI (`ResidentFollowUpPanel`) stays inline and
 * untouched in `reports.tsx` (owned by a later phase) — it's passed in here as the
 * `residentFollowUp` node instead of being imported/moved, so its source never moves.
 */
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
  const group = statusGroup(report.status)
  const timelineEntries = buildConcernTimelineEntries(report)
  const showAppeals = !isOfficial && (
    report.status === "rejected" ||
    report.status === "appealed" ||
    Boolean(report.appeals?.length)
  )

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener("keydown", onKey)
    }
  }, [onClose])

  // Fixed right sidebar + solid dark dim (no blur)
  return (
    <div className="fixed inset-0 z-[200] flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-black/45"
        aria-label="Close report details"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Report details"
        className={cn(
          "relative flex h-full w-full max-w-[min(100%,28rem)] flex-col bg-white",
          "border-l border-neutral-200 shadow-[-12px_0_32px_rgba(15,23,42,0.14)]",
          "sm:max-w-[30rem] md:max-w-[32rem] lg:max-w-[34rem]",
        )}
      >
        <header className="shrink-0 border-b border-neutral-200 px-5 py-4 sm:px-6 sm:py-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[12px] font-medium tracking-wide text-neutral-500 uppercase">
              Report details
            </p>
            <button
              type="button"
              onClick={onClose}
              className="flex size-10 shrink-0 items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-100"
              aria-label="Close"
            >
              <XIcon className="size-5" />
            </button>
          </div>
          {/* Tracking ID + status on one aligned row */}
          <div className="mt-2 flex min-h-9 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-1.5">
<span className="truncate font-mono text-[17px] font-semibold tracking-wide text-neutral-900 sm:text-[18px]">
                {report.tracking_id}
              </span>
              <button
                type="button"
                onClick={onCopyTrackingId}
                className="flex size-8 shrink-0 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                aria-label="Copy tracking ID"
              >
                <CopyIcon className="size-4" />
              </button>
            </div>
            <span
              className={cn(
                "shrink-0 rounded-md border px-2.5 py-1 text-[12px] font-medium",
                statusColors[group],
              )}
            >
              {group}
            </span>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6 sm:px-6 sm:py-7">
          <div className="space-y-8 pb-[max(2rem,env(safe-area-inset-bottom))]">
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-neutral-500">
              <span className="inline-flex items-center gap-1.5">
                <CalendarIcon className="size-4 text-neutral-400" />
                Submitted {formatDate(report.created_at)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <ClockIcon className="size-4 text-neutral-400" />
                {daysAgo(report.created_at)} days ago
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Share2Icon className="size-4 text-neutral-400" />
                {report.visibility === "community" ? "Public" : "Private"}
              </span>
              {report.visibility === "community" ? (
                <span className="inline-flex items-center gap-1.5">
                  <ArrowUpIcon className="size-4 text-neutral-400" />
                  {report.vote_count} upvotes
                </span>
              ) : null}
            </div>

            {isOfficial ? (
              <DetailSection title="Official actions">
                <OfficialStatusPanel key={report.id} report={report} onUpdated={onUpdated} />
              </DetailSection>
            ) : null}

<CollapsibleSection value="description" title="Description">
            <p className="text-[15px] leading-7 text-neutral-700 whitespace-pre-wrap">
              {concernBodyText(report) || "No description provided."}
            </p>
            {report.media?.length ? <EvidencePreviewGrid media={report.media} /> : null}
          </CollapsibleSection>

<CollapsibleSection value="category" title="Category">
              <div className="flex items-center gap-4">
                <ReportIcon report={report} size="md" forceIcon />
                <div>
                  <p className="text-[15px] font-medium text-neutral-900">{concernCategoryLabel(report)}</p>
                  <p className="mt-0.5 text-[13px] text-neutral-500">{categoryStyles[report.category].sub}</p>
                </div>
              </div>
            </CollapsibleSection>

<CollapsibleSection value="location" title="Location">
                <ReportLocationMap
                  latitude={report.latitude}
                  longitude={report.longitude}
                  streetAddress={report.address}
                  heightClassName="h-56 sm:h-72"
                />
              </CollapsibleSection>

            {report.resolution_evidence?.length ? (
              <DetailSection title="Resolution evidence">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                  <p className="text-[13px] font-semibold leading-5 text-emerald-900">
                    These photos were uploaded by the barangay as evidence of the completed resolution. They are visible only to you and authorized officials.
                  </p>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {report.resolution_evidence.map((evidence) => (
                    <button
                      key={evidence.id}
                      type="button"
                      onClick={() => void openAuthenticatedMedia(evidence.raw_url, evidence.original_filename)}
                      className="overflow-hidden rounded-xl border border-neutral-200 bg-white text-left transition-colors hover:border-brand-orange"
                    >
                      <AuthenticatedMediaImage
                        src={evidence.raw_url}
                        alt={evidence.original_filename}
                        className="h-32 w-full object-cover sm:h-36"
                      />
                      <span className="block truncate px-3 py-2 text-[12px] font-semibold text-neutral-700">
                        {evidence.original_filename}
                      </span>
                    </button>
                  ))}
                </div>
              </DetailSection>
            ) : null}

<CollapsibleSection value="timeline" title="Timeline">
              <ConcernTimeline items={timelineEntries} />
            </CollapsibleSection>

<CollapsibleSection value="conversation" title="Conversation">
              <ReportChatPanel
                concernId={report.id}
                open
                disabled={["rejected", "appealed", "resolved"].includes(report.status)}
                showHistory
                title={["rejected", "appealed", "resolved"].includes(report.status) ? "Case chat closed" : "Message this case"}
                subtitle={["rejected", "appealed", "resolved"].includes(report.status) ? "This case is closed. Use the appeal section for further review." : "Follow-up messages and checked attachments stay with this case."}
                onMessageSent={onRefresh}
              />
            </CollapsibleSection>

            {showAppeals ? (
              <CollapsibleSection value="appeals" title="Appeals">
                {residentFollowUp}
              </CollapsibleSection>
            ) : null}
          </div>
        </div>

      </aside>
    </div>
  )
}

