import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import {
  ArrowUpDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EyeOffIcon,
  FileIcon,
  MapPinIcon,
  MegaphoneIcon,
  PlayIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  UsersIcon,
  InfoIcon,
  Network,
  HardHat,
  CircleCheck,
  CircleX,
  TriangleAlert,
} from "lucide-react"

import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"

import { useDebouncedCallback } from "@/hooks/use-debounced-callback"
import {
  getConcern,
  listManagedConcernsPage,
  listMyConcernsPage,
  type Concern,
  type ConcernMedia,
} from "@/features/dashboard/api"
import { CommunityIncidentDetails } from "@/features/dashboard/components/concerns/community-incident"
import { ConcernAppealsPanel } from "@/features/dashboard/components/concerns/concern-appeals-panel"
import { MergeReviewPanel } from "@/features/dashboard/components/concerns/merge-review-panel"
import { ConcernMergeControls } from "@/features/dashboard/components/concerns/concern-merge-controls"
import { MediaBlurEditor } from "@/features/dashboard/components/concerns/media-blur-editor"
import { ReportChatPanel } from "@/features/dashboard/components/report-chat-panel"
import { ReportLocationMap } from "@/features/dashboard/components/report-location-map"
import { ReportStatusDialog } from "@/features/dashboard/components/report-status-dialog"
import type { StatusDialogMode } from "@/features/dashboard/components/report-status-mode"
import { ConcernTimeline } from "@/features/dashboard/components/concerns/concern-timeline"
import { buildConcernTimelineEntries } from "@/features/dashboard/components/concerns/concern-timeline-lib"
import {
  categoryLabels,
  filters,
  formatDate,
  useMinWidth,
} from "@/features/dashboard/components/concerns/concern-display"
import { resolveIconByKey } from "@/features/dashboard/components/concerns/resolve-icon"
import { FilterRail } from "@/features/dashboard/components/workspace/filter-rail"
import { EmptyState } from "@/features/dashboard/components/record/empty-state"
import { ReportIcon } from "@/features/dashboard/components/concerns/report-icon"
import { ReportDetailsSidebar } from "@/features/dashboard/components/concerns/report-details-sidebar"
import { ConcernQueueItem, concernStatusAccent } from "@/features/dashboard/components/concerns/concern-queue-item"
import { streetOnly } from "@/features/dashboard/lib/location-text"
import { statusLabelOf } from "@/features/dashboard/lib/status-vocabulary"

import { rankConcerns } from "@/features/dashboard/components/record/concern-adapter"
import { OfficialStatusPanel } from "@/features/dashboard/components/concerns/official-status-panel"
import { useDecisionDraft } from "@/features/dashboard/components/concerns/use-decision-draft"
import { ResidentFollowUpPanel } from "@/features/dashboard/components/concerns/resident-follow-up-panel"
import {
  AuthenticatedMediaImage,
  MediaLightbox,
} from "@/features/dashboard/components/authenticated-media"
import {
  mediaDisplaySource,
  toMediaPreviewItem,
  type MediaPreviewItem,
} from "@/features/dashboard/lib/authenticated-media"
import { useAuthSession } from "@/features/auth/auth-session"
import { usePageTitle } from "@/hooks/use-page-title"
import { useWheelScroll } from "@/hooks/use-wheel-scroll"
import { useIsDesktop } from "@/features/dashboard/lib/shell"
import { usePaneCollapse } from "@/features/dashboard/components/responder/pane-collapse"
import {
  OpsWorkspace,
  OpsPaneHeader,
  type OpsPaneSpec,
} from "@/features/dashboard/components/workspace/ops-workspace"
import { OpsBar, OpsBarButton } from "@/features/dashboard/components/workspace/ops-bar"
import { OpsTabs } from "@/features/dashboard/components/workspace/ops-tabs"

const residentReportsPageSize = 10

type SortKey = "date" | "status" | "category"

function StatusIcon({ status, className }: { status: string; className?: string }) {
  const cls = cn("size-3.5 shrink-0", className)
  switch (status) {
    case "submitted":
    case "under_review":
      return <InfoIcon className={cls} />
    case "assigned":
      return <Network className={cls} />
    case "in_progress":
      return <HardHat className={cls} />
    case "resolved":
      return <CircleCheck className={cls} />
    case "rejected":
      return <CircleX className={cls} />
    case "appealed":
      return <TriangleAlert className={cls} />
    default:
      return <InfoIcon className={cls} />
  }
}

const RESIDENT_STATUS_TEXT: Record<string, string> = {
  submitted: "text-blue-600",
  under_review: "text-blue-600",
  assigned: "text-indigo-600",
  in_progress: "text-amber-600",
  resolved: "text-emerald-600",
  rejected: "text-red-600",
  appealed: "text-violet-600",
}

const RESIDENT_STATUS_LABEL: Record<string, string> = {
  submitted: "Submitted",
  under_review: "Under review",
  assigned: "Assigned",
  in_progress: "In progress",
  resolved: "Resolved",
  rejected: "Rejected",
  appealed: "Appealed",
}

const RELEVANCE_BADGE: Record<string, string> = {
  relevant: "Shows the issue",
  unrelated: "Unrelated",
  unclear: "Unclear",
  unsupported: "Not readable",
  unverified: "Not checked",
}

function filterReports(reports: Concern[], filter: string) {
  if (filter === "All") return reports
  if (filter === "Active") {
    return reports.filter((report) => !["resolved", "rejected", "appealed"].includes(report.status))
  }
  if (filter === "Resolved") {
    return reports.filter((report) => report.status === "resolved")
  }
  if (filter === "Rejected") {
    return reports.filter((report) => report.status === "rejected")
  }
  if (filter === "Appealed") {
    return reports.filter(
      (report) =>
        report.status === "appealed" ||
        (report.appeals?.some((appeal) => appeal.status === "submitted") ?? false),
    )
  }
  return reports
}

function searchReports(reports: Concern[], query: string) {
  const q = query.trim().toLowerCase()
  if (!q) return reports
  return reports.filter((report) => [
    report.tracking_id,
    report.title,
    report.description,
    report.address,
    categoryLabels[report.category],
  ].some((v) => v?.toLowerCase().includes(q)))
}

function sortReports(reports: Concern[], key: SortKey, asc: boolean) {
  const sorted = [...reports]
  sorted.sort((a, b) => {
    let cmp = 0
    if (key === "date") cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    else if (key === "status") cmp = a.status.localeCompare(b.status)
    else if (key === "category") cmp = a.category.localeCompare(b.category)
    return asc ? cmp : -cmp
  })
  return sorted
}

const officialFilters = [
  "In Progress",
  "Resolved",
  "Rejected",
  "Appealed",
  "All",
] as const

const CLOSED_STATUSES = ["resolved", "rejected"]

function isOpenStatus(status: string) {
  return !CLOSED_STATUSES.includes(status)
}

function hasOpenAppeal(report: Concern) {
  return (
    report.status === "appealed" ||
    (report.appeals?.some((appeal) => appeal.status === "submitted") ?? false)
  )
}

function matchesOfficialFilter(report: Concern, filter: string) {
  switch (filter) {
    case "All":
      return true
    case "In Progress":
      return isOpenStatus(report.status)
    case "Resolved":
      return report.status === "resolved"
    case "Rejected":
      return report.status === "rejected" && !hasOpenAppeal(report)
    case "Appealed":
      return hasOpenAppeal(report)
    default:
      return true
  }
}

function filterOfficialReports(reports: Concern[], filter: string, search: string) {
  const q = search.trim().toLowerCase()
  return reports.filter((report) => {
    const matchesSearch = !q || [
      report.title,
      report.description,
      report.reporter.full_name,
      report.address,
      report.barangay,
      report.tracking_id,
    ].some((value) => value?.toLowerCase().includes(q))
    return matchesOfficialFilter(report, filter) && matchesSearch
  })
}

function ReviewRail({
  report,
  onOpenProof,
}: {
  report: Concern
  onOpenProof: (items: MediaPreviewItem[], index: number) => void
}) {
  return <ConcernTimeline items={buildConcernTimelineEntries(report, onOpenProof)} />
}

function OfficialConcernDashboard({
  reports,
  selected,
  activeFilter,
  setActiveFilter,
  search,
  setSearch,
  onSelect,
  onBack,
  onUpdated,
  onRefresh,
  error,
}: {
  reports: Concern[]
  selected: Concern | undefined
  activeFilter: string
  setActiveFilter: (filter: string) => void
  search: string
  setSearch: (value: string) => void
  onSelect: (report: Concern) => void
  onBack: () => void
  onUpdated: (report: Concern) => void
  onRefresh: () => Promise<void>
  error: string
}) {
  const navigate = useNavigate()
  const filtered = filterOfficialReports(reports, activeFilter, search)
  const current = selected ?? filtered[0]

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 300_000)
    return () => window.clearInterval(timer)
  }, [])

  const ranked = useMemo(() => rankConcerns(filtered, now), [filtered, now])

  const QUEUE_PAGE_SIZE = 5
  const [queuePage, setQueuePage] = useState(1)
  const queueTotalPages = Math.max(1, Math.ceil(ranked.length / QUEUE_PAGE_SIZE))
  const currentQueuePage = Math.min(queuePage, queueTotalPages)
  const pagedRanked = ranked.slice(
    (currentQueuePage - 1) * QUEUE_PAGE_SIZE,
    currentQueuePage * QUEUE_PAGE_SIZE,
  )

  const [prevQueueKey, setPrevQueueKey] = useState(`${activeFilter}|${search}`)
  if (prevQueueKey !== `${activeFilter}|${search}`) {
    setPrevQueueKey(`${activeFilter}|${search}`)
    setQueuePage(1)
  }

  const draft = useDecisionDraft(current)
  const [actionPaneOpen, setActionPaneOpen] = useState(false)

  const isWideUp = useMinWidth(1440)
  const [queueCollapsed, setQueueCollapsed] = usePaneCollapse("eboses:ws:concerns:queue:collapsed")
  const [recordCollapsed, setRecordCollapsed] = usePaneCollapse("eboses:ws:concerns:record:collapsed")
  const [actionCollapsed, setActionCollapsed] = usePaneCollapse(
    "eboses:ws:concerns:action:collapsed",
    !isWideUp,
  )
  const [recordTab, setRecordTab] = useState("chat")

  const [blurTarget, setBlurTarget] = useState<ConcernMedia | null>(null)
  const [evidencePreview, setEvidencePreview] = useState<{ items: MediaPreviewItem[]; index: number } | null>(null)

  const isLgUp = useIsDesktop()

  const hasExplicitSelection = Boolean(selected)

  const closedCase = current ? ["rejected", "resolved"].includes(current.status) : false
  const openCount = reports.filter((report) => isOpenStatus(report.status)).length
  const appealCount = reports.filter(hasOpenAppeal).length

  const openAppealCount = current?.appeals?.filter((appeal) => appeal.status === "submitted").length ?? 0

  const detailsTabContent = current ? (
    <CommunityIncidentDetails
      report={current}
      onOpenPhoto={(photos, index) =>
        setEvidencePreview({
          items: photos.map((photo) =>
            toMediaPreviewItem(mediaDisplaySource(photo), photo.original_filename, photo.mime_type),
          ),
          index,
        })
      }
      onOpenProof={(items, index) => setEvidencePreview({ items, index })}
      onViewAllPhotos={() => setRecordTab("evidence")}
      locationSlot={
        <ReportLocationMap
          latitude={current.latitude}
          longitude={current.longitude}
          streetAddress={current.community_incident?.address || current.address}
          category={current.category}
          iconKey={current.category_ref?.icon_key}
          heightClassName="h-44"
        />
      }
      updatesSlot={
        <ReviewRail
          report={current}
          onOpenProof={(items, index) => setEvidencePreview({ items, index })}
        />
      }
    />
  ) : null

  const incidentPhotos = current?.community_incident?.photos ?? current?.media ?? []
  const evidenceTabContent = current ? (
    <div className="rounded-panel border border-card-line bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-heading text-foreground">Community evidence</h3>
        {incidentPhotos.length > 0 ? (
          <button
            type="button"
            onClick={() =>
              setEvidencePreview({
                items: incidentPhotos.map((media) =>
                  toMediaPreviewItem(mediaDisplaySource(media), media.original_filename, media.mime_type),
                ),
                index: 0,
              })
            }
            className="text-label text-brand-orange transition-colors duration-[--duration-micro] hover:text-brand-orange-strong"
          >
            View all media
          </button>
        ) : null}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {incidentPhotos.map((media, index) =>
          media.mime_type.startsWith("image/") ? (
            <figure key={media.id} className="overflow-hidden rounded-control border border-card-line">
              <AuthenticatedMediaImage
                src={media.preview_url}
                alt={media.original_filename}
                className="h-32 w-full object-cover"
              />
              <figcaption className="space-y-2 p-2.5">
                <p className="flex flex-wrap items-baseline justify-between gap-x-2 text-[12px] leading-4">
                  {"reporter_name" in media ? (
                    <span className="font-semibold text-foreground">
                      From {media.reporter_name}
                    </span>
                  ) : (
                    <span />
                  )}
                  <span className="text-subtle-foreground">{formatDate(media.uploaded_at)}</span>
                </p>
                {media.relevance_state === "unrelated" || media.relevance_state === "unclear" ? (
                  <div className="flex flex-wrap gap-1.5">
                    {media.relevance_state === "unrelated" || media.relevance_state === "unclear" ? (
                      <span
                        className={cn(
                          "inline-flex rounded-pill px-2 py-0.5 text-[11px] font-semibold",
                          media.relevance_state === "unrelated"
                            ? "bg-severity-critical-surface text-severity-critical-ink"
                            : "bg-severity-moderate-surface text-severity-moderate-ink",
                        )}
                      >
                        {RELEVANCE_BADGE[media.relevance_state]}
                      </span>
                    ) : null}
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => setBlurTarget(media)}
                  className="inline-flex items-center gap-1.5 text-label text-brand-orange transition-colors duration-[--duration-micro] hover:text-brand-orange-strong"
                >
                  <EyeOffIcon className="size-3.5" />
                  Blur an area
                </button>
              </figcaption>
            </figure>
          ) : (
            <button
              key={media.id}
              type="button"
              onClick={() =>
                setEvidencePreview({
                  items: incidentPhotos.map((item) =>
                    toMediaPreviewItem(mediaDisplaySource(item), item.original_filename, item.mime_type),
                  ),
                  index,
                })
              }
              className="flex h-32 items-center justify-center gap-2 rounded-control border border-card-line px-2 text-center text-label text-muted-foreground transition-colors duration-[--duration-micro] hover:bg-card-raised hover:text-foreground"
            >
              {media.mime_type.startsWith("video/") ? (
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
        {incidentPhotos.length === 0 ? (
          <div className="col-span-full flex h-32 items-center justify-center rounded-control border border-dashed border-card-line text-label text-subtle-foreground">
            No evidence uploaded
          </div>
        ) : null}
      </div>
    </div>
  ) : null

  const chatTabContent = current ? (
    <ReportChatPanel
      key={`official-chat-${current.id}`}
      concernId={current.id}
      open
      showHistory
      disabled={closedCase}
      title={closedCase ? "Chat closed" : "Messages"}
      subtitle={
        closedCase
          ? "This report is closed. Reopen it to continue the conversation."
          : "Talk to the resident. They see these messages."
      }
      emptyMessage="Ask the resident for anything you need — a clearer photo, an exact landmark, or a time you can visit."
      onMessageSent={onRefresh}
      className="border-card-line"
    />
  ) : null

  const mergeTabContent = current ? (
    <div className="space-y-4">
      <MergeReviewPanel onDecided={() => void onRefresh()} />
      <ConcernMergeControls report={current} onChanged={() => void onRefresh()} />
    </div>
  ) : null

  const appealsTabContent = current ? (
    <ConcernAppealsPanel key={`appeals-${current.id}`} report={current} onRefresh={onRefresh} />
  ) : null

  const queuePane = (
    <>
      <OpsPaneHeader
        title="Incoming queue"
        collapsed={queueCollapsed}
        onToggleCollapse={() => setQueueCollapsed((value) => !value)}
      />
      <div className="space-y-3 p-3 pb-0">
        <FilterRail
          ariaLabel="Concern queue filters"
          active={activeFilter}
          onSelect={setActiveFilter}
          options={officialFilters.map((filter) => ({
            label: filter,
            count: reports.filter((report) => matchesOfficialFilter(report, filter)).length,
          }))}
        />

        {error ? (
          <p className="rounded-control border border-severity-critical/40 bg-severity-critical-surface px-3 py-2 text-label text-severity-critical-ink">
            {error}
          </p>
        ) : null}
      </div>

      <div className="border-t border-card-line">
        {pagedRanked.length > 0 ? (
          <>
          {pagedRanked.map((entry) => (
            <ConcernQueueItem
              key={entry.concern.id}
              entry={entry}
              active={current?.id === entry.concern.id}
              onSelect={() => onSelect(entry.concern)}
            />
          ))}
          </>
        ) : (
          <div className="bg-card px-4 py-10 text-center text-body text-muted-foreground">
            No concerns match this queue.
          </div>
        )}
      </div>

      <div className="space-y-3 p-3">

        {}
        {queueTotalPages > 1 ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-[12px] font-medium text-subtle-foreground">
              Page {currentQueuePage} of {queueTotalPages} · {ranked.length} total
            </p>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setQueuePage(Math.max(1, currentQueuePage - 1))}
                disabled={currentQueuePage <= 1}
                className="flex h-8 items-center gap-1 rounded-control border border-card-line px-2.5 text-[12px] font-semibold text-foreground transition-colors hover:bg-card-raised disabled:opacity-40"
              >
                <ChevronLeftIcon className="size-3.5" /> Prev
              </button>
              <button
                type="button"
                onClick={() => setQueuePage(Math.min(queueTotalPages, currentQueuePage + 1))}
                disabled={currentQueuePage >= queueTotalPages}
                className="flex h-8 items-center gap-1 rounded-control border border-card-line px-2.5 text-[12px] font-semibold text-foreground transition-colors hover:bg-card-raised disabled:opacity-40"
              >
                Next <ChevronRightIcon className="size-3.5" />
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </>
  )

  const recordPane = current ? (
    <>
      {hasExplicitSelection ? (
        <button
          type="button"
          onClick={onBack}
          className="sticky top-0 z-10 flex w-full items-center gap-1 border-b border-card-line bg-canvas/85 px-4 py-2.5 text-label text-brand-orange backdrop-blur-md lg:hidden"
        >
          <ChevronLeftIcon className="size-4" /> Back to queue
        </button>
      ) : null}

      <OpsPaneHeader
        title="Concern information"
        collapsed={recordCollapsed}
        onToggleCollapse={() => setRecordCollapsed((value) => !value)}
      />
      {(() => {
        const fullName =
          current.reporter_full_name?.trim() ||
          current.reporter?.full_name?.trim() ||
          "Resident"
        const initials = current.reporter?.initials || "R"
        const accent = concernStatusAccent(current.status)
        const photoCount = current.community_incident?.photo_count ?? current.media?.length ?? 0
        return (
          <div className="flex flex-col items-center gap-1 border-b border-card-line px-4 pb-4 pt-5 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-slate-soft text-[14px] font-bold text-navy-muted">
              {initials}
            </span>
            <p className="text-[16px] font-bold leading-tight text-foreground">{fullName}</p>
            <p className="text-[12px] text-subtle-foreground">
              Resident · {streetOnly(current.address) || current.barangay}
            </p>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border border-card-line bg-card px-2.5 py-1 text-[11px] font-semibold text-foreground",
                )}
              >
                <span className={cn("size-1.5 rounded-full", accent.dot)} />
                {statusLabelOf(current.status)}
              </span>
              {photoCount > 0 ? (
                <span className="inline-flex items-center rounded-full border border-card-line bg-card px-2.5 py-1 text-[11px] font-semibold text-foreground">
                  {photoCount} photo{photoCount === 1 ? "" : "s"}
                </span>
              ) : null}
              <span className="inline-flex items-center rounded-full border border-card-line bg-card px-2.5 py-1 text-[11px] font-semibold text-foreground">
                {current.comment_count} messages
              </span>
            </div>
          </div>
        )
      })()}
      <div className="space-y-4 p-4">
        <OpsTabs
          value={recordTab}
          onValueChange={setRecordTab}
          tabs={[
            { id: "chat", label: "Chat", content: chatTabContent },
            { id: "details", label: "Details", content: detailsTabContent },
            { id: "evidence", label: "Photos", count: current.media?.length ?? 0, content: evidenceTabContent },
            { id: "appeals", label: "Appeals", count: openAppealCount, content: appealsTabContent },
            { id: "merges", label: "Merges", content: mergeTabContent },
          ]}
        />
      </div>
    </>
  ) : (
    <div className="flex h-full items-center justify-center p-8 text-body text-muted-foreground">
      Select a concern from the queue.
    </div>
  )

  const panes: OpsPaneSpec[] = [
    {
      id: "queue",
      role: "list",
      initial: 380,
      min: 300,
      max: 760,
      label: "Incoming queue",
      collapsible: true,
      collapsed: queueCollapsed,
      onCollapsedChange: setQueueCollapsed,
      node: queuePane,
    },
    {
      id: "record",
      role: "detail",
      min: 460,
      label: "Concern information",
      collapsible: true,
      collapsed: recordCollapsed,
      onCollapsedChange: setRecordCollapsed,
      node: recordPane,
    },
  ]

  if (current) {
    panes.push({
      id: "action",
      role: "aside",
      initial: 380,
      min: 300,
      max: 720,
      label: "Update report",
      collapsible: true,
      collapsed: actionCollapsed,
      onCollapsedChange: setActionCollapsed,
      node: (
        <>
          <OpsPaneHeader
            title="Update report"
            collapsed={actionCollapsed}
            onToggleCollapse={() => setActionCollapsed((value) => !value)}
          />
          <div className="p-3">
            <OfficialStatusPanel
              report={current}
              draft={draft}
              onUpdated={onUpdated}
              onRefresh={onRefresh}
            />
          </div>
          <div className="space-y-3 border-t border-card-line p-3">
            <section className="rounded-panel border border-card-line bg-card p-3">
              <div className="mb-2 flex items-center gap-2">
                <MapPinIcon className="size-4 text-subtle-foreground" />
                <h3 className="text-[13px] font-bold text-foreground">Location</h3>
              </div>
              <ReportLocationMap
                latitude={current.latitude}
                longitude={current.longitude}
                streetAddress={current.community_incident?.address || current.address}
                category={current.category}
                iconKey={current.category_ref?.icon_key}
                heightClassName="h-36"
                className="overflow-hidden rounded-control border border-card-line"
              />
              <p className="mt-2 text-[12px] font-semibold text-foreground">
                {streetOnly(current.community_incident?.address || current.address) ||
                  current.address ||
                  "Location pinned on the map"}
              </p>
              <p className="text-[11px] text-subtle-foreground">
                {current.location_source === "gps"
                  ? "Pinned by resident GPS"
                  : "Pinned on the map"}
              </p>
            </section>

            <section className="rounded-panel border border-card-line bg-card p-3">
              <div className="mb-2 flex items-center gap-2">
                <UsersIcon className="size-4 text-subtle-foreground" />
                <h3 className="text-[13px] font-bold text-foreground">Community signal</h3>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  {
                    value: current.community_incident?.report_count ?? 1,
                    caption: "reports",
                  },
                  { value: current.vote_count, caption: "upvotes" },
                  { value: current.comment_count, caption: "comments" },
                ].map((tile) => (
                  <div key={tile.caption} className="rounded-control bg-card-raised p-2.5">
                    <p className="text-[16px] font-bold leading-tight text-foreground">
                      {tile.value}
                    </p>
                    <p className="mt-0.5 text-[10.5px] font-medium text-subtle-foreground">
                      {tile.caption}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </>
      ),
    })
  }

  return (
    <>
    {blurTarget ? (
      <MediaBlurEditor
        media={blurTarget}
        onClose={() => setBlurTarget(null)}
        onUpdated={(media) => {
          setBlurTarget(media)
          void onRefresh()
        }}
      />
    ) : null}
    {evidencePreview ? (
      <MediaLightbox
        items={evidencePreview.items}
        index={evidencePreview.index}
        onClose={() => setEvidencePreview(null)}
      />
    ) : null}
    <OpsWorkspace
      id="concerns"
      mobileView={hasExplicitSelection ? "detail" : "list"}
      asideOpen={actionPaneOpen}
      onAsideOpenChange={setActionPaneOpen}
      panes={panes}
      bar={
        <OpsBar
          title="Concerns"
          counters={[

            { label: "in progress", value: openCount, onClick: () => setActiveFilter("In Progress") },
            {
              label: "appeals",
              value: appealCount,
              tone: appealCount > 0 ? "alert" : "default",
              onClick: () => setActiveFilter("Appealed"),
            },
          ]}
        >
          <label className="hidden h-8 items-center gap-2 rounded-control border border-card-line bg-card px-2.5 md:flex">
            <SearchIcon className="size-3.5 shrink-0 text-subtle-foreground" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search concerns…"
              className="w-40 min-w-0 bg-transparent text-label text-foreground outline-none placeholder:text-faint-foreground lg:w-52"
            />
          </label>
          <OpsBarButton
            icon={MegaphoneIcon}
            label="Community"
            onClick={() => navigate("/dashboard/community-content")}
          />
          {!isLgUp && current ? (
            <OpsBarButton
              icon={SlidersHorizontalIcon}
              label="Update"
              tone="primary"
              onClick={() => setActionPaneOpen(true)}
            />
          ) : null}
        </OpsBar>
      }
    />
    </>
  )
}

export default function ReportsPage() {
  usePageTitle("Reports")
  const navigate = useNavigate()
  const { reportId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const { user } = useAuthSession()
  const hasLoadedRef = useRef(false)
  const [loaded, setLoaded] = useState(false)
  const [activeFilter, setActiveFilter] = useState<string>("All")
  const [search, setSearch] = useState("")
  const [selectedReport, setSelectedReport] = useState<string | null>(null)
  const [reportPage, setReportPage] = useState(1)
  const [reports, setReports] = useState<Concern[]>([])
  const [nextReportPage, setNextReportPage] = useState<number | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [detailCache, setDetailCache] = useState<Record<string, Concern>>({})
  const [error, setError] = useState("")
  const [statusDialogOpen, setStatusDialogOpen] = useState(false)
  const filterScrollRef = useWheelScroll<HTMLDivElement>()
  const [residentSearch, setResidentSearch] = useState("")
  const [sortKey, setSortKey] = useState<SortKey>("date")
  const [sortAsc, setSortAsc] = useState(false)

  const statusDialogMode: StatusDialogMode = "assigned"
  const routeReportId = reportId ?? null
  const isOfficial = Boolean(
    user?.role === "barangay_official" || user?.is_staff || user?.is_superuser,
  )

  const loadReports = useCallback(async () => {
    if (!hasLoadedRef.current) {
      setLoaded(false)
    }
    setError("")
    try {

      const envelope = isOfficial
        ? await listManagedConcernsPage()
        : await listMyConcernsPage()
      setReports(envelope.results)
      setNextReportPage(envelope.next ? 2 : null)
    } catch {
      setError(isOfficial ? "Could not load report management queue." : "Could not load your reports.")
    } finally {
      hasLoadedRef.current = true
      setLoaded(true)
    }
  }, [isOfficial])

  const loadMoreReports = useCallback(async () => {
    if (!nextReportPage || loadingMore) return
    setLoadingMore(true)
    setError("")
    try {
      const envelope = isOfficial
        ? await listManagedConcernsPage(undefined, undefined, undefined, nextReportPage)
        : await listMyConcernsPage(undefined, undefined, undefined, nextReportPage)
      setReports((current) => [...current, ...envelope.results])
      setNextReportPage(envelope.next ? nextReportPage + 1 : null)
    } catch {
      setError("Could not load more reports.")
    } finally {
      setLoadingMore(false)
    }
  }, [isOfficial, nextReportPage, loadingMore])

  useEffect(() => {
    if (!selectedReport || detailCache[selectedReport]) return
    let cancelled = false
    getConcern(selectedReport)
      .then((full) => {
        if (!cancelled) setDetailCache((prev) => ({ ...prev, [selectedReport]: full }))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [selectedReport, detailCache])

  const eventRefresh = useDebouncedCallback(() => void loadReports(), 3000)

  useEffect(() => {

    const first = window.setTimeout(() => void loadReports(), 0)
    const interval = window.setInterval(eventRefresh, 30000)
    window.addEventListener("eboses:report-created", eventRefresh)
    window.addEventListener("eboses:concern-updated", eventRefresh)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(interval)
      window.removeEventListener("eboses:report-created", eventRefresh)
      window.removeEventListener("eboses:concern-updated", eventRefresh)
    }

  }, [loadReports, eventRefresh])

  const [prevRouteId, setPrevRouteId] = useState(routeReportId)
  if (prevRouteId !== routeReportId) {
    setPrevRouteId(routeReportId)
    if (routeReportId) setSelectedReport(routeReportId)
    else setSelectedReport(null)
  }

  useEffect(() => {
    if (!isOfficial) return
    if (searchParams.has("ai")) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.delete("ai")
          return next
        },
        { replace: true },
      )
    }
  }, [isOfficial, searchParams, setSearchParams])

  const [prevFilterChip, setPrevFilterChip] = useState(activeFilter)
  if (prevFilterChip !== activeFilter) {
    setPrevFilterChip(activeFilter)
    setReportPage(1)
  }

  useEffect(() => {

    if (!loaded || !selectedReport || reports.length === 0) return
    const inFilter = filterReports(reports, activeFilter).some(
      (report) => report.public_id === selectedReport || String(report.id) === selectedReport,
    )
    if (!inFilter) {

      queueMicrotask(() => setSelectedReport(null))
      if (routeReportId) navigate("/dashboard/reports", { replace: true })
    }
  }, [activeFilter, reports, selectedReport, routeReportId, navigate, loaded])

  const closeReportDetails = useCallback(() => {
    setSelectedReport(null)
    navigate("/dashboard/reports")
  }, [navigate])

  if (!loaded)
    return (
      <div className="flex flex-col">
        <div className="flex-1 p-4 md:p-10">
          <Skeleton className="h-28 w-full rounded-2xl" />
          <div className="scrollbar-hide mt-6 w-full max-w-full min-w-0 touch-pan-x overflow-x-scroll overscroll-x-contain [-webkit-overflow-scrolling:touch] lg:overflow-visible">
            <div className="flex min-w-max flex-nowrap gap-2 pb-1 lg:grid lg:min-w-0 lg:grid-cols-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-20 shrink-0 rounded-full lg:w-full" />
              ))}
            </div>
          </div>
          <div className="mt-4 grid gap-6 lg:grid-cols-5">
            <div className="flex flex-col gap-2 lg:col-span-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-[68px] rounded-lg" />
              ))}
            </div>
            <div className="hidden lg:col-span-2 lg:block">
              <Skeleton className="h-72 rounded-xl" />
            </div>
          </div>
        </div>
      </div>
    )

  const baseFiltered = filterReports(reports, activeFilter)
  const searched = searchReports(baseFiltered, residentSearch)
  const sorted = sortReports(searched, sortKey, sortAsc)
  const filtered = sorted
  const totalPages = Math.max(1, Math.ceil(filtered.length / residentReportsPageSize))
  const currentPage = Math.min(reportPage, totalPages)
  const pagedReports = filtered.slice((currentPage - 1) * residentReportsPageSize, currentPage * residentReportsPageSize)
  const firstShown = filtered.length === 0 ? 0 : (currentPage - 1) * residentReportsPageSize + 1
  const lastShown = Math.min(filtered.length, currentPage * residentReportsPageSize)

  const selected = selectedReport
    ? detailCache[selectedReport] ??
      reports.find(
        (report) => report.public_id === selectedReport || String(report.id) === selectedReport,
      ) ??
      null
    : null

  function selectReport(report: Concern) {
    setSelectedReport(report.public_id)
    navigate(`/dashboard/reports/${report.public_id}`)
  }

  function updateReport(next: Concern) {
    setReports((current) => current.map((report) => report.id === next.id ? next : report))
    setDetailCache((prev) => ({ ...prev, [next.public_id]: next }))
    setSelectedReport(next.public_id)
  }

  async function copyTrackingId(report: Concern) {
    await navigator.clipboard?.writeText(report.tracking_id)
    toast.success("Tracking ID copied")
  }

  if (isOfficial) {
    return (
      <OfficialConcernDashboard
        reports={reports}
        selected={
          (selectedReport ? detailCache[selectedReport] : undefined) ??
          reports.find(
            (report) => report.public_id === selectedReport || String(report.id) === selectedReport,
          ) ??
          undefined
        }
        activeFilter={activeFilter}
        setActiveFilter={setActiveFilter}
        search={search}
        setSearch={setSearch}
        onSelect={selectReport}
        onBack={closeReportDetails}
        onUpdated={updateReport}
        onRefresh={loadReports}
        error={error}
      />
    )
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc)
    else { setSortKey(key); setSortAsc(true) }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <div
        className="min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(7.5rem+env(safe-area-inset-bottom))] pt-4 md:px-6 md:pb-10 md:pt-6 lg:px-6 lg:pb-8"
      >
        {/* Header */}
        <div className="mb-5">
          <div className="flex items-center gap-2">
            <h1 className="text-[20px] font-bold tracking-tight text-neutral-900 sm:text-2xl">
              My reports
            </h1>
            <span className="ml-1 inline-flex h-5 items-center rounded-full bg-neutral-100 px-2 text-[11px] font-semibold text-neutral-500">
              {reports.length}
            </span>
          </div>
          <p className="mt-1 text-sm text-neutral-500">
            Track status and updates on reports you submitted.
          </p>
        </div>

        {/* Filters + Search + Sort row */}
        <section className="flex min-w-0 flex-col items-stretch gap-3">
          {/* Top bar: filters, search, sort */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {/* Filters */}
            <div
              ref={filterScrollRef}
              className="scrollbar-hide min-w-0 overflow-x-auto overscroll-x-contain pb-0.5 [-webkit-overflow-scrolling:touch] touch-pan-x"
              role="tablist"
              aria-label="Report status filters"
            >
              <div className="flex min-w-max flex-nowrap gap-2">
                {filters.map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    role="tab"
                    aria-selected={activeFilter === filter}
                    aria-pressed={activeFilter === filter}
                    onClick={(event) => {
                      event.preventDefault()
                      setActiveFilter(filter)
                      setReportPage(1)
                    }}
                    className={cn(
                      "relative z-10 h-9 shrink-0 cursor-pointer rounded-full border px-3.5 text-[12px] font-semibold whitespace-nowrap transition-colors",
                      activeFilter === filter
                        ? "border-brand-orange bg-brand-orange text-white"
                        : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50",
                    )}
                  >
                    {filter}
                    {filter === "All" && reports.length > 0 && (
                      <span className="ml-1.5 inline-flex h-4 items-center rounded-full bg-white/20 px-1 text-[10px]">
                        {reports.length}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Search + Sort */}
            <div className="flex items-center gap-2">
              <label className="flex h-9 items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 transition-colors focus-within:border-neutral-300">
                <SearchIcon className="size-3.5 shrink-0 text-neutral-400" />
                <input
                  value={residentSearch}
                  onChange={(e) => { setResidentSearch(e.target.value); setReportPage(1) }}
                  placeholder="Search reports…"
                  className="w-36 min-w-0 bg-transparent text-[13px] text-neutral-900 outline-none placeholder:text-neutral-400 sm:w-48"
                />
              </label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => toggleSort(sortKey === "date" ? "date" : sortKey)}
                  className="flex h-9 items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 text-[12px] font-medium text-neutral-600 transition-colors hover:bg-neutral-50"
                >
                  <ArrowUpDownIcon className="size-3.5" />
                  <span className="hidden sm:inline">{sortKey === "date" ? "Date" : sortKey === "status" ? "Status" : "Category"}</span>
                </button>
              </div>
            </div>
          </div>

          {error ? <p className="text-sm text-red-500">{error}</p> : null}

          {/* Table */}
          <div className="w-full overflow-hidden rounded-lg border border-neutral-200 bg-white">
            {/* Table header */}
            <div className="grid grid-cols-[3fr_1.2fr_1fr_0.8fr] items-center gap-2 border-b border-neutral-100 bg-neutral-50/80 px-4 py-2.5">
              <button type="button" onClick={() => toggleSort("date")} className="flex items-center gap-1 text-left text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                Report
                <ArrowUpDownIcon className="size-3" />
              </button>
              <button type="button" onClick={() => toggleSort("category")} className="flex items-center gap-1 text-left text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                Category
                <ArrowUpDownIcon className="size-3" />
              </button>
              <button type="button" onClick={() => toggleSort("status")} className="flex items-center gap-1 text-left text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                Status
                <ArrowUpDownIcon className="size-3" />
              </button>
              <span className="text-right text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Date</span>
            </div>

            {/* Table rows */}
            <div className="flex flex-col divide-y divide-neutral-50">
              {pagedReports.map((report) => {
                const isSelected = selected?.id === report.id
                return (
                  <button
                    key={report.id}
                    type="button"
                    onClick={() => selectReport(report)}
                    className={cn(
                      "grid grid-cols-[3fr_1.2fr_1fr_0.8fr] items-center gap-2 px-4 py-3 text-left transition-colors",
                      isSelected ? "bg-neutral-50" : "hover:bg-neutral-50/80",
                    )}
                  >
                    {/* Report: icon + description */}
                    <div className="min-w-0 flex items-center gap-2.5">
                      <ReportIcon report={report} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium text-neutral-800">
                          {report.title || report.description.slice(0, 80)}
                          {(report.title ? report.title.length > 80 : report.description.length > 80) ? "…" : ""}
                        </p>
                        <p className="mt-0.5 text-[11px] text-neutral-400">
                          {report.address?.replace(/,?\s*Marikina( Heights)?$/, "") || ""}
                        </p>
                      </div>
                    </div>

                    {/* Category: neutral icon, no bg */}
                    <div className="flex items-center gap-1.5">
                      {(() => {
                        const Icon = resolveIconByKey(report.category_ref?.icon_key)
                        return Icon ? <Icon className="size-3.5 shrink-0 text-neutral-500" /> : null
                      })()}
                      <span className="truncate text-[12px] text-neutral-600">
                        {categoryLabels[report.category]}
                      </span>
                    </div>

                    {/* Status: no badge, just icon + text */}
                    <div className="flex items-center gap-1">
                      <StatusIcon status={report.status} className={RESIDENT_STATUS_TEXT[report.status] ?? "text-neutral-500"} />
                      <span className={cn("text-[11px] font-medium uppercase", RESIDENT_STATUS_TEXT[report.status] ?? "text-neutral-500")}>
                        {RESIDENT_STATUS_LABEL[report.status] ?? report.status}
                      </span>
                    </div>

                    {/* Date + time */}
                    <div className="text-right">
                      <p className="text-[11px] font-normal text-neutral-400">
                        {formatDate(report.created_at)}
                      </p>
                      <p className="text-[10px] text-neutral-300">
                        {new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(report.created_at))}
                      </p>
                    </div>
                  </button>
                )
              })}

              {pagedReports.length === 0 && (
                <EmptyState
                  title={
                    activeFilter === "All" && !residentSearch
                      ? "No reports yet."
                      : `No ${activeFilter.toLowerCase()} reports found.`
                  }
                />
              )}
            </div>

            {/* Pagination footer */}
            {filtered.length > 0 && (
              <div className="flex items-center justify-between border-t border-neutral-100 px-4 py-3">
                <p className="text-[12px] text-neutral-500">
                  {firstShown}–{lastShown} of {filtered.length}
                </p>
                <div className="flex items-center gap-2">
                  {nextReportPage && (
                    <button
                      type="button"
                      onClick={() => void loadMoreReports()}
                      disabled={loadingMore}
                      className="rounded-md border border-neutral-200 px-3 py-1.5 text-[12px] font-semibold text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-40"
                    >
                      {loadingMore ? "Loading…" : "Load more"}
                    </button>
                  )}
                  <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => setReportPage((v) => Math.max(1, v - 1))}
                    disabled={currentPage <= 1}
                    className="flex size-8 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-50 disabled:opacity-40"
                    aria-label="Previous page"
                  >
                    <ChevronLeftIcon className="size-3.5" />
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                    <button
                      key={page}
                      type="button"
                      onClick={() => setReportPage(page)}
                      aria-current={page === currentPage ? "page" : undefined}
                      className={cn(
                        "flex size-8 items-center justify-center rounded-md text-xs font-semibold transition-colors",
                        page === currentPage
                          ? "border border-brand-orange bg-brand-orange text-white"
                          : "text-neutral-600 hover:bg-neutral-50",
                      )}
                    >
                      {page}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setReportPage((v) => Math.min(totalPages, v + 1))}
                    disabled={currentPage >= totalPages}
                    className="flex size-8 items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-50 disabled:opacity-40"
                    aria-label="Next page"
                  >
                    <ChevronRightIcon className="size-3.5" />
                  </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {}
      {selected ? (
        <ReportDetailsSidebar
          report={selected}
          onClose={closeReportDetails}
          onCopyTrackingId={() => void copyTrackingId(selected)}
          onRefresh={loadReports}
          onUpdated={updateReport}
          isOfficial={isOfficial}
          residentFollowUp={<ResidentFollowUpPanel report={selected} onRefresh={loadReports} />}
        />
      ) : null}

      {selected ? (
        <ReportStatusDialog
          open={statusDialogOpen}
          onOpenChange={setStatusDialogOpen}
          report={selected}
          mode={statusDialogMode}
          onTrack={() => selectReport(selected)}
        />
      ) : null}
    </div>
  )
}

