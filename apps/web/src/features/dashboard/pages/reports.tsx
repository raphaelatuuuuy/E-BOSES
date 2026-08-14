import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  EyeOffIcon,
  FileIcon,
  MegaphoneIcon,
  PlayIcon,
  SearchIcon,
  SlidersHorizontalIcon,
} from "lucide-react"

import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"

import {
  listManagedConcerns,
  listMyConcerns,
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
import { FilterRail } from "@/features/dashboard/components/workspace/filter-rail"
import { QueueTableHeader } from "@/features/dashboard/components/workspace/queue-row"
import { EmptyState } from "@/features/dashboard/components/record/empty-state"
import { ReportIcon } from "@/features/dashboard/components/concerns/report-icon"
import { ReportDetailsSidebar } from "@/features/dashboard/components/concerns/report-details-sidebar"
import { ConcernQueueItem } from "@/features/dashboard/components/concerns/concern-queue-item"

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
import { useIsDesktop } from "@/features/dashboard/lib/shell"
import { usePaneCollapse } from "@/features/dashboard/components/responder/pane-collapse"
import {
  OpsWorkspace,
  OpsPaneHeader,
  type OpsPaneSpec,
} from "@/features/dashboard/components/workspace/ops-workspace"
import { OpsBar, OpsBarButton } from "@/features/dashboard/components/workspace/ops-bar"
import { OpsTabs } from "@/features/dashboard/components/workspace/ops-tabs"

const residentReportsPageSize = 5

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
  const [recordTab, setRecordTab] = useState("details")

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
          <QueueTableHeader labels={{ title: "Concern", unitAndTime: "Assigned Unit & When" }} />
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
      <div className="space-y-4 p-4">
        <OpsTabs
          value={recordTab}
          onValueChange={setRecordTab}
          tabs={[
            { id: "details", label: "Details", content: detailsTabContent },
            { id: "evidence", label: "Photos", count: current.media.length, content: evidenceTabContent },
            { id: "chat", label: "Chat", content: chatTabContent },

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
  const [error, setError] = useState("")
  const [statusDialogOpen, setStatusDialogOpen] = useState(false)

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

      setReports(isOfficial ? await listManagedConcerns() : await listMyConcerns())
    } catch {
      setError(isOfficial ? "Could not load report management queue." : "Could not load your reports.")
    } finally {
      hasLoadedRef.current = true
      setLoaded(true)
    }
  }, [isOfficial])

  useEffect(() => {

    const first = window.setTimeout(() => void loadReports(), 0)
    function refresh() {
      void loadReports()
    }
    const interval = window.setInterval(refresh, 30000)
    window.addEventListener("eboses:report-created", refresh)
    window.addEventListener("eboses:concern-updated", refresh)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(interval)
      window.removeEventListener("eboses:report-created", refresh)
      window.removeEventListener("eboses:concern-updated", refresh)
    }

  }, [loadReports])

  const [prevRouteId, setPrevRouteId] = useState(routeReportId)
  if (prevRouteId !== routeReportId) {
    setPrevRouteId(routeReportId)
    if (routeReportId) setSelectedReport(routeReportId)
    else setSelectedReport(null)
  }

  const deepLinkFlagged = isOfficial && searchParams.get("ai") === "flagged"
  const [prevDeepLink, setPrevDeepLink] = useState(deepLinkFlagged)
  if (prevDeepLink !== deepLinkFlagged) {
    setPrevDeepLink(deepLinkFlagged)
    if (deepLinkFlagged) setActiveFilter("Needs review")
  }

  useEffect(() => {
    if (!isOfficial) return
    if (searchParams.get("ai") === "flagged") {
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

  useEffect(() => {
    if (!isOfficial || activeFilter !== "Needs review") return
    let cancelled = false
    void listManagedConcerns(undefined, undefined, undefined, "flagged")
      .then((flagged) => {
        if (cancelled) return
        setReports((current) => {
          const byId = new Map(current.map((report) => [report.id, report]))
          for (const report of flagged) byId.set(report.id, report)
          return Array.from(byId.values())
        })
      })
      .catch(() => {
        if (!cancelled) toast.error("Could not refresh AI-flagged concerns.")
      })
    return () => {
      cancelled = true
    }
  }, [isOfficial, activeFilter])

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

  const filtered = filterReports(reports, activeFilter)
  const totalPages = Math.max(1, Math.ceil(filtered.length / residentReportsPageSize))
  const currentPage = Math.min(reportPage, totalPages)
  const pagedReports = filtered.slice((currentPage - 1) * residentReportsPageSize, currentPage * residentReportsPageSize)
  const firstShown = filtered.length === 0 ? 0 : (currentPage - 1) * residentReportsPageSize + 1
  const lastShown = Math.min(filtered.length, currentPage * residentReportsPageSize)

  const selected = selectedReport
    ? reports.find(
        (report) => report.public_id === selectedReport || String(report.id) === selectedReport,
      ) ?? null
    : null

  function selectReport(report: Concern) {
    setSelectedReport(report.public_id)
    navigate(`/dashboard/reports/${report.public_id}`)
  }

  function updateReport(next: Concern) {
    setReports((current) => current.map((report) => report.id === next.id ? next : report))
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
        selected={reports.find(
          (report) => report.public_id === selectedReport || String(report.id) === selectedReport,
        )}
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

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <div
        className="min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(7.5rem+env(safe-area-inset-bottom))] pt-4 md:px-6 md:pb-10 md:pt-6 lg:px-6 lg:pb-8"
      >
        <div className="mb-5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="flex size-8 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100 md:hidden"
              aria-label="Go back"
            >
              <ChevronLeftIcon className="size-5" />
            </button>
            <h1 className="text-[20px] font-bold tracking-tight text-neutral-900 sm:text-2xl">
              My reports
            </h1>
          </div>
          <p className="mt-1 text-sm text-neutral-500">
            Track status and updates on reports you submitted.
          </p>
        </div>

        {}
        <section
          className="flex min-w-0 flex-col items-stretch gap-5"
          style={{ width: "min(100%, 52rem)" }}
        >
          <div
            className="scrollbar-hide w-full min-w-0 overflow-x-auto overscroll-x-contain pb-0.5 [-webkit-overflow-scrolling:touch] touch-pan-x"
            role="tablist"
            aria-label="Report status filters"
          >
            <div className="flex min-w-max flex-nowrap gap-2">
            {filters.map((filter) => (
              <button
                key={filter}
                type="button"
                role="tab"
                data-filter-option
                aria-selected={activeFilter === filter}
                aria-pressed={activeFilter === filter}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  setActiveFilter(filter)
                  setReportPage(1)
                }}
                className={cn(
                  "relative z-10 h-10 shrink-0 cursor-pointer rounded-full border px-4 text-[13px] font-semibold whitespace-nowrap transition-colors",
                  activeFilter === filter
                    ? "border-brand-orange bg-brand-orange text-white"
                    : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50",
                )}
              >
                {filter}
              </button>
            ))}
            </div>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          {}
          <div className="w-full overflow-hidden rounded-lg border border-neutral-200 bg-white">
            <div className="flex flex-col divide-y divide-neutral-100">
              {pagedReports.map((report) => {
                const isSelected = selected?.id === report.id
                return (
                  <button
                    key={report.id}
                    type="button"
                    onClick={() => selectReport(report)}
                    className={cn(
                      "flex min-h-[68px] w-full items-center gap-3 px-4 py-3.5 text-left transition-colors",
                      isSelected ? "bg-neutral-50" : "bg-white hover:bg-neutral-50/80",
                    )}
                  >
                    <ReportIcon report={report} size="sm" />
                    <div className="min-w-0 flex-1">
<p className="line-clamp-2 text-[15px] font-medium leading-snug text-neutral-900">
	                        {report.tracking_id}
	                      </p>
                      <p className="mt-0.5 truncate text-[13px] text-neutral-500">
                        {categoryLabels[report.category]}
                        <span className="mx-1 text-neutral-300">·</span>
                        {formatDate(report.created_at)}
                      </p>
                    </div>

                    <ChevronRightIcon className="size-4 shrink-0 text-neutral-300" />
                  </button>
                )
              })}
              {filtered.length === 0 ? (
                <EmptyState
                  title={
                    activeFilter === "All"
                      ? "No reports yet."
                      : `No ${activeFilter.toLowerCase()} reports.`
                  }
                />
              ) : null}
            </div>

            {filtered.length > 0 ? (
              <div className="flex items-center justify-between gap-3 border-t border-neutral-100 px-4 py-3">
                <p className="text-[12px] font-medium text-neutral-500">
                  {firstShown}–{lastShown} of {filtered.length}
                </p>
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => setReportPage((value) => Math.max(1, value - 1))}
                    className="flex size-8 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-50 disabled:opacity-40"
                    disabled={currentPage <= 1}
                    aria-label="Previous page"
                  >
                    <ChevronLeftIcon className="size-3.5" />
                  </button>
                  {Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => (
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
                    onClick={() => setReportPage((value) => Math.min(totalPages, value + 1))}
                    className="flex size-8 items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-50 disabled:opacity-40"
                    disabled={currentPage >= totalPages}
                    aria-label="Next page"
                  >
                    <ChevronRightIcon className="size-3.5" />
                  </button>
                </div>
              </div>
            ) : null}
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

