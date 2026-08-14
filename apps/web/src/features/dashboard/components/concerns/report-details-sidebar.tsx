import { useEffect, useRef, useState, type ReactNode } from "react"
import {
  ArrowUpIcon,
  CalendarIcon,
  ClockIcon,
  CopyIcon,
  FileIcon,
  PlayIcon,
  Share2Icon,
  XIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import { CollapsibleSection } from "@/features/dashboard/components/concerns/collapsible-section"
import type { Concern } from "@/features/dashboard/api"
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
import { ConcernTimeline } from "@/features/dashboard/components/concerns/concern-timeline"
import { buildConcernTimelineEntries } from "@/features/dashboard/components/concerns/concern-timeline-lib"
import {
  concernCategoryLabel,
  categoryStyles,
  daysAgo,
  formatDate,
} from "@/features/dashboard/components/concerns/concern-display"
import { ReportIcon } from "@/features/dashboard/components/concerns/report-icon"
import { OfficialStatusPanelWithDraft } from "@/features/dashboard/components/concerns/official-status-panel"
import { EvidenceGrid } from "@/features/dashboard/components/record/evidence-grid"

/** Extracted verbatim from `pages/reports.tsx` (was inline in the same file as the panels it uses). */
function DetailSection({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-3", className)}>
      <h3 className="text-[13px] font-semibold tracking-wide text-neutral-500">{title}</h3>
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
  const timelineEntries = buildConcernTimelineEntries(report, openPreview)
  const showAppeals = !isOfficial && (
    report.status === "rejected" ||
    report.status === "appealed" ||
    Boolean(report.appeals?.length)
  )
  const resolutionEvidence = report.resolution_evidence ?? []

  const [lightbox, setLightbox] = useState<{ items: MediaPreviewItem[]; index: number } | null>(null)
  const [detailsWidth, setDetailsWidth] = useState<number | null>(() => {
    if (typeof window === "undefined") return null
    const saved = Number(window.localStorage.getItem("report-details-width"))
    return Number.isFinite(saved) && saved > 0 ? saved : null
  })
  const asideRef = useRef<HTMLElement>(null)
  const resizeStart = useRef<{ startX: number; startWidth: number } | null>(null)
  const appliedWidth =
    detailsWidth && typeof window !== "undefined" && window.innerWidth >= 1024 ? detailsWidth : null

  function openPreview(items: MediaPreviewItem[], index: number) {
    setLightbox({ items, index })
  }

  function beginResize(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault()
    resizeStart.current = {
      startX: event.clientX,
      startWidth: asideRef.current?.getBoundingClientRect().width ?? 448,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function moveResize(event: React.PointerEvent<HTMLDivElement>) {
    const start = resizeStart.current
    if (!start) return
    const nextWidth = Math.min(960, Math.max(340, start.startWidth + (start.startX - event.clientX)))
    setDetailsWidth(nextWidth)
  }

  function endResize() {
    if (!resizeStart.current) return
    resizeStart.current = null
    const width = asideRef.current?.getBoundingClientRect().width
    if (width) window.localStorage.setItem("report-details-width", String(Math.round(width)))
  }

  function onResizeKey(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    event.preventDefault()
    setDetailsWidth((current) => {
      const base = current ?? asideRef.current?.getBoundingClientRect().width ?? 448
      return event.key === "ArrowLeft" ? Math.max(340, base - 16) : Math.min(960, base + 16)
    })
  }

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
        ref={asideRef}
        role="dialog"
        aria-modal="true"
        aria-label="Report details"
        style={appliedWidth ? { width: `${appliedWidth}px`, maxWidth: `${appliedWidth}px` } : undefined}
        className={cn(
          "relative flex h-full w-full max-w-[min(100%,28rem)] flex-col bg-white",
          "border-l border-neutral-200 shadow-[-12px_0_32px_rgba(15,23,42,0.14)]",
          "sm:max-w-[30rem] md:max-w-[38rem] lg:max-w-[min(calc(100vw-3rem),54rem)]",
        )}
      >
        <header className="shrink-0 border-b border-neutral-200 px-5 py-4 sm:px-6 sm:py-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[12px] font-medium tracking-wide text-neutral-500">
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
          {/* Tracking ID */}
          <div className="mt-2 flex min-h-9 items-center gap-1.5">
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
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6 sm:px-6 sm:py-7">
          <div className="pb-[max(2rem,env(safe-area-inset-bottom))]">
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

            {/* One unified surface: every section stacks top-to-bottom with
                hairline dividers — no two-column rail, no stacked cards. */}
            <div className="mt-4 min-w-0">
              <div className="border-t border-neutral-200/80">
                <CollapsibleSection value="description" title="Description" defaultOpen>
                  <p className="text-[15px] leading-7 text-neutral-700 whitespace-pre-wrap">
                    {concernBodyText(report) || "No description provided."}
                  </p>
                  {report.media?.length ? <EvidenceGrid media={report.media} onPreview={openPreview} /> : null}
                </CollapsibleSection>
              </div>

              <div className="border-t border-neutral-200/80">
                <CollapsibleSection value="category" title="Category" defaultOpen>
                  <div className="flex items-center gap-4">
                    <ReportIcon report={report} size="md" forceIcon />
                    <div>
                      <p className="text-[15px] font-medium text-neutral-900">{concernCategoryLabel(report)}</p>
                      <p className="mt-0.5 text-[13px] text-neutral-500">
                        {categoryStyles[report.category as keyof typeof categoryStyles]?.sub ?? "General concern"}
                      </p>
                    </div>
                  </div>
                </CollapsibleSection>
              </div>

              <div className="border-t border-neutral-200/80">
                <CollapsibleSection value="location" title="Location" defaultOpen>
                  <ReportLocationMap
                    latitude={report.latitude}
                    longitude={report.longitude}
                    streetAddress={report.address}
                    heightClassName="h-56 sm:h-72"
                  />
                </CollapsibleSection>
              </div>

              {report.also_reported_count > 0 && report.visibility === "community" ? (
                <div className="border-t border-neutral-200/80">
                  <CollapsibleSection value="also-reported" title="Community reports" defaultOpen>
                    <p className="text-[15px] text-neutral-700">
                      Also reported by {report.also_reported_count}{" "}
                      {report.also_reported_count === 1 ? "other resident" : "other residents"}.
                    </p>
                    {report.also_reported_by?.length ? (
                      <ul className="mt-2 space-y-1">
                        {report.also_reported_by.map((name) => (
                          <li key={name} className="text-[13px] text-neutral-500">
                            {name}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </CollapsibleSection>
                </div>
              ) : null}

              {resolutionEvidence.length ? (
                <div className="border-t border-neutral-200/80">
                  <DetailSection title="Resolution evidence" className="py-6">
                    <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3">
                      <p className="text-[13px] font-semibold leading-5 text-neutral-700">
                        These photos were uploaded by the barangay as evidence of the completed resolution. They are visible only to you and authorized officials.
                      </p>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {resolutionEvidence.map((evidence, evidenceIndex) =>
                        evidence.mime_type.startsWith("image/") ? (
                          <button
                            key={evidence.id}
                            type="button"
                            onClick={() =>
                              openPreview(
                                resolutionEvidence.map((evidence) =>
                                  toMediaPreviewItem(mediaDisplaySource(evidence), evidence.original_filename, evidence.mime_type),
                                ),
                                evidenceIndex,
                              )
                            }
                            className="overflow-hidden rounded-xl border border-neutral-200 bg-white text-left transition-colors hover:border-brand-orange"
                          >
                            <AuthenticatedMediaImage
                              src={mediaDisplaySource(evidence)}
                              alt={`${evidence.original_filename} resolution photo`}
                              className="h-32 w-full object-cover sm:h-36"
                            />
                          </button>
                        ) : (
                          <button
                            key={evidence.id}
                            type="button"
                            onClick={() =>
                              openPreview(
                                resolutionEvidence.map((evidenceItem) =>
                                  toMediaPreviewItem(mediaDisplaySource(evidenceItem), evidenceItem.original_filename, evidenceItem.mime_type),
                                ),
                                evidenceIndex,
                              )
                            }
                            className="flex h-32 items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 text-center text-[12px] font-semibold text-neutral-700 transition-colors hover:border-brand-orange hover:text-neutral-900 sm:h-36"
                          >
                            {evidence.mime_type.startsWith("video/") ? (
                              <>
                                <PlayIcon className="size-5" /> Preview video
                              </>
                            ) : (
                              <>
                                <FileIcon className="size-5" /> Preview file
                              </>
                            )}
                          </button>
                        ),
                      )}
                    </div>
                  </DetailSection>
                </div>
              ) : null}

              {isOfficial ? (
                <div className="border-t border-neutral-200/80">
                  <CollapsibleSection value="official-actions" title="Official actions" defaultOpen>
                    <OfficialStatusPanelWithDraft key={report.id} report={report} onUpdated={onUpdated} />
                  </CollapsibleSection>
                </div>
              ) : null}

              <div className="border-t border-neutral-200/80">
                <CollapsibleSection
                  value="conversation"
                  title="Conversation"
                  subtitle={
                    ["rejected", "appealed", "resolved"].includes(report.status)
                      ? "This case is closed. Follow-ups go through the appeal section."
                      : "Follow-up messages and checked attachments stay with this case."
                  }
                  defaultOpen
                >
                  <ReportChatPanel
                    concernId={report.id}
                    open
                    disabled={["rejected", "appealed", "resolved"].includes(report.status)}
                    showHistory
                    plain
                    onMessageSent={onRefresh}
                  />
                </CollapsibleSection>
              </div>

              <div className="border-t border-neutral-200/80">
                <CollapsibleSection value="timeline" title="Timeline" defaultOpen>
                  <ConcernTimeline items={timelineEntries} />
                </CollapsibleSection>
              </div>

              {showAppeals ? (
                <div className="border-t border-neutral-200/80">
                  <CollapsibleSection value="appeals" title="Appeals" defaultOpen>
                    {residentFollowUp}
                  </CollapsibleSection>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {/* Resize grip on the panel's left edge (desktop only). Dragging
            left makes the panel wider — the report detail surfaces are
            intentionally roomy once space allows. */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize report panel"
          aria-valuemin={340}
          aria-valuemax={960}
          aria-valuenow={appliedWidth ?? undefined}
          tabIndex={0}
          onPointerDown={beginResize}
          onPointerMove={moveResize}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          onKeyDown={onResizeKey}
          className="group absolute inset-y-0 left-0 z-30 hidden w-2.5 cursor-col-resize touch-none items-center justify-center outline-none lg:flex"
        >
          <span className="h-10 w-1 rounded-full bg-neutral-300 transition-colors group-hover:bg-brand-orange group-focus-visible:bg-brand-orange" />
        </div>
      </aside>

      {lightbox ? (
        <MediaLightbox
          items={lightbox.items}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </div>
  )
}

