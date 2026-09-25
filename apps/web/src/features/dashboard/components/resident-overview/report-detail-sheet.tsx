import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  MapPinIcon,
  NewspaperIcon,
  PencilLineIcon,
} from "lucide-react"

import { getConcern, type Concern } from "@/features/dashboard/api"
import { useAuthSession } from "@/features/auth/auth-session"
import {
  SheetDialog,
  SheetIconButton,
} from "@/features/dashboard/components/sheet-dialog"
import { ReportChatPanel } from "@/features/dashboard/components/report-chat-panel"
import { ReportLocationMap } from "@/features/dashboard/components/report-location-map"
import { ConcernTimeline } from "@/features/dashboard/components/concerns/concern-timeline"
import { buildConcernTimelineEntries } from "@/features/dashboard/components/concerns/concern-timeline-lib"
import { OfficialStatusPanelWithDraft } from "@/features/dashboard/components/concerns/official-status-panel"
import { MediaLightbox } from "@/features/dashboard/components/authenticated-media"
import type { MediaPreviewItem } from "@/features/dashboard/lib/authenticated-media"
import {
  ReportDescriptionCard,
  ReportAssignmentFooter,
  ReportReporterCard,
} from "@/features/dashboard/components/concerns/report-detail-content"

export function OverviewReportDetailSheet({
  post,
  onClose,
  audience = "resident",
  onUpdated,
}: {
  post: Concern | null
  onClose: () => void
  audience?: "resident" | "official"
  onUpdated?: (report: Concern) => void
}) {
  const navigate = useNavigate()
  const { user } = useAuthSession()
  const [detail, setDetail] = useState<Concern | null>(null)
  const [loading, setLoading] = useState(() => Boolean(post))
  const [failed, setFailed] = useState(false)
  const [view, setView] = useState<"details" | "chat" | "update">("details")
  const [proofPreview, setProofPreview] = useState<{
    items: MediaPreviewItem[]
    index: number
  } | null>(null)
  const postId = post?.id ?? null
  const [previousPostId, setPreviousPostId] = useState(postId)

  if (previousPostId !== postId) {
    setPreviousPostId(postId)
    setView("details")
    setDetail(null)
    setFailed(false)
    setLoading(Boolean(post))
  }

  useEffect(() => {
    if (!post) return
    let cancelled = false
    void getConcern(post.id)
      .then((next) => {
        if (!cancelled) setDetail(normalize(next))
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [post])

  function normalize(next: Concern): Concern {
    return {
      ...next,
      media: next.media ?? [],
      comments: next.comments ?? [],
      status_events: next.status_events ?? [],
      appeals: next.appeals ?? [],
      user_vote: next.user_vote ?? 0,
    }
  }

  function retry() {
    if (!post) return
    setFailed(false)
    setLoading(true)
    void getConcern(post.id)
      .then((next) => setDetail(normalize(next)))
      .catch(() => setFailed(true))
      .finally(() => setLoading(false))
  }

  const report = detail
  const closedCase = report
    ? ["rejected", "appealed", "resolved"].includes(report.status)
    : false
  const canFileAppeal = Boolean(
    report &&
      user?.id === report.reporter?.id &&
      report.status === "rejected" &&
      !(report.appeals ?? []).some((appeal) => appeal.status === "submitted")
  )
  const timeline = report
    ? buildConcernTimelineEntries(
        report,
        (items, index) => setProofPreview({ items, index }),
        null,
        true
      )
    : []

  function goToFeed() {
    if (!report) return
    onClose()
    navigate("/dashboard/feed", {
      state: { highlightConcernId: report.id },
    })
  }

  return (
    <>
      {proofPreview ? (
        <MediaLightbox
          items={proofPreview.items}
          index={proofPreview.index}
          simpleCounter
          onClose={() => setProofPreview(null)}
        />
      ) : null}
      <SheetDialog
        open={Boolean(post)}
        onClose={onClose}
        showClose={false}
        title={
          view === "chat"
            ? "Chat"
            : view === "update"
              ? "Update the status"
              : audience === "official"
                ? "Report details"
                : "Your report"
        }
        titleClassName={view === "chat" ? "text-center" : undefined}
        description={
          view === "update"
            ? "What the resident will see in the Updates timeline."
            : undefined
        }
        headerTop={
          post?.address?.split(",")[0]?.trim() || post?.barangay ? (
            <span className="inline-flex max-w-full items-center gap-1.5">
              <MapPinIcon className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">
                {post.address?.split(",")[0]?.trim() || post.barangay}
              </span>
            </span>
          ) : undefined
        }
        size="wide"
        onBack={view === "chat" ? () => setView("details") : undefined}
        backdropScrim={false}
        backdropInteractive
        className="h-auto max-h-[min(760px,72dvh)] sm:max-h-[min(760px,82vh)]"
        bodyClassName="pb-3"
        backdrop={
          post ? (
            <ReportLocationMap
              latitude={post.latitude}
              longitude={post.longitude}
              streetAddress={post.address || post.barangay}
              category={post.category}
              iconKey={post.category_ref?.icon_key}
              status={post.status}
              severity={post.severity}
              heightClassName="h-full"
              focusAboveSheet
              onBack={() =>
                view === "details" ? onClose() : setView("details")
              }
              className="h-full w-full rounded-none"
            />
          ) : null
        }
        actions={
          view === "details" ? (
            <div className="flex items-center gap-0.5">
              {audience === "official" && report ? (
                <SheetIconButton
                  label="Update report"
                  onClick={() => setView("update")}
                >
                  <PencilLineIcon className="size-5" strokeWidth={2} />
                </SheetIconButton>
              ) : null}
              <SheetIconButton label="View in feed" onClick={goToFeed}>
                <NewspaperIcon className="size-5" strokeWidth={2} />
              </SheetIconButton>
            </div>
          ) : undefined
        }
        footer={
          view === "details" ? (
            <div className="space-y-1.5">
              {report && audience === "official" ? (
                <ReportReporterCard
                  report={report}
                  onChat={() => setView("chat")}
                />
              ) : report ? (
                <ReportAssignmentFooter
                  report={report}
                  onChat={() => setView("chat")}
                />
              ) : null}
              <p className="text-center text-[11px] leading-4 text-neutral-400">
                {audience === "official"
                  ? report?.is_anonymous === true || report?.reporter?.id === 0
                    ? "This report was sent anonymously."
                    : "Contact the resident in case of follow-ups."
                  : "Status updates and messages from the barangay will appear here."}
              </p>
            </div>
          ) : undefined
        }
      >
        {loading || !report ? (
          failed ? (
            <div className="flex flex-col items-center py-10 text-center">
              <p className="text-[14px] text-neutral-500">
                Could not load this report.
              </p>
              <button
                type="button"
                onClick={retry}
                className="mt-3 h-11 rounded-full bg-neutral-900 px-6 text-[14px] font-bold text-white"
              >
                Try again
              </button>
            </div>
          ) : (
            <div
              className="flex flex-col gap-3 py-2"
              aria-label="Loading report"
            >
              <span className="h-24 animate-pulse rounded-2xl bg-neutral-100" />
              <span className="h-5 w-1/4 animate-pulse rounded bg-neutral-100" />
              <span className="h-16 animate-pulse rounded-2xl bg-neutral-100" />
            </div>
          )
        ) : view === "update" ? (
          <OfficialStatusPanelWithDraft
            report={report}
            variant="dialog"
            onDismiss={() => setView("details")}
            onUpdated={(next) => {
              const normalized = normalize(next)
              setDetail(normalized)
              onUpdated?.(normalized)
              setView("details")
            }}
          />
        ) : view === "chat" ? (
          <ReportChatPanel
            key={`overview-chat-${report.id}`}
            concernId={report.id}
            open
            showHistory
            plain
            disabled={closedCase}
            emptyMessage="Ask for updates, questions, extra photos, or access details here."
            appeals={report.appeals ?? []}
            canFileAppeal={canFileAppeal}
          />
        ) : (
          <div className="flex flex-col gap-3 pb-1">
            <ReportDescriptionCard
              report={report}
              onMediaPreview={(items, index) => setProofPreview({ items, index })}
            />
            <section>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <p className="text-[17px] font-bold tracking-tight text-neutral-900">
                  Status
                </p>
                <p className="text-[12px] font-normal text-neutral-500">
                  Track the process
                </p>
              </div>
              <ConcernTimeline
                key={report.id}
                items={timeline}
                collapsibleHistory
                large
                trackingId={report.tracking_id}
              />
            </section>
          </div>
        )}
      </SheetDialog>
    </>
  )
}
