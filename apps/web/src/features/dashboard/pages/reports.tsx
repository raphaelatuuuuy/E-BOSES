import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import {
  ReplyIcon,
  SendIcon,
  ArrowUpDownIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  ClockIcon,
  EyeOffIcon,
  FileIcon,
  GitMergeIcon,
  ImageIcon,
  MapPinIcon,
  MegaphoneIcon,
  PlayIcon,
  ScaleIcon,
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
  commentOnConcern,
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
} from "@/features/dashboard/components/concerns/concern-display"
import { resolveIconByKey } from "@/features/dashboard/components/concerns/resolve-icon"
import { EmptyState } from "@/features/dashboard/components/record/empty-state"
import { ReportIcon } from "@/features/dashboard/components/concerns/report-icon"
import { ReportDetailsSidebar } from "@/features/dashboard/components/concerns/report-details-sidebar"
import { ConcernQueueItem, avatarTone, concernReporterName, initialsOf } from "@/features/dashboard/components/concerns/concern-queue-item"
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
import {
  OpsWorkspace,
  type OpsPaneSpec,
} from "@/features/dashboard/components/workspace/ops-workspace"
import { OpsBarButton } from "@/features/dashboard/components/workspace/ops-bar"

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

function ActionPane({ report, draft, onUpdated, onRefresh }: { report: Concern; draft: ReturnType<typeof useDecisionDraft>; onUpdated: (r: Concern) => void; onRefresh: () => Promise<void> }) {
  const [locOpen, setLocOpen] = useState(true)

  return (
    <div className="scrollbar-hide min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 pb-4 pt-4">
      <section className="rounded-[24px] bg-white">
        <button type="button" onClick={() => setLocOpen(!locOpen)} className="flex w-full items-center justify-between p-5">
          <div className="flex items-center gap-2.5">
            <MapPinIcon className="size-4 text-neutral-500" />
            <h3 className="text-[14px] font-medium text-neutral-800">Location</h3>
          </div>
          {locOpen ? <ChevronUpIcon className="size-4 text-neutral-400" /> : <ChevronDownIcon className="size-4 text-neutral-400" />}
        </button>
        {locOpen ? (
          <div className="px-5 pb-5">
            <ReportLocationMap
              latitude={report.latitude}
              longitude={report.longitude}
              streetAddress={report.community_incident?.address || report.address}
              category={report.category}
              iconKey={report.category_ref?.icon_key}
              heightClassName="h-40"
              className="overflow-hidden rounded-[16px] border border-neutral-100"
            />
          </div>
        ) : null}
      </section>

      <div className="[&>section]:rounded-[24px] [&>section]:border-transparent [&>section]:bg-white">
        <OfficialStatusPanel report={report} draft={draft} onUpdated={onUpdated} onRefresh={onRefresh} />
      </div>

      <CommunitySignalSection concern={report} />
    </div>
  )
}

function CommunitySignalSection({ concern }: { concern: Concern }) {
  const [expanded, setExpanded] = useState(false)
  const [expandedRow, setExpandedRow] = useState<number | null>(null)
  const [commentDrafts, setCommentDrafts] = useState<Record<number, string>>({})
  const [commentLoading, setCommentLoading] = useState<number | null>(null)
  const [previewPhoto, setPreviewPhoto] = useState<{ items: MediaPreviewItem[]; index: number } | null>(null)
  const reports = concern.community_incident?.reports ?? []
  const photos = concern.community_incident?.photos ?? []
  const commentAuthors = (concern.comments ?? []).filter((c) => !c.parent).slice(0, 3).map((c) => (c.author?.full_name || "R").charAt(0).toUpperCase())
  const upvoterNames = reports.slice(0, 3).map((r) => (r.reporter_name || "R").charAt(0).toUpperCase())
  const reportAvatars = reports.slice(0, 3).map((r) => r.reporter_name?.charAt(0)?.toUpperCase() || "R")
  const isPublic = concern.visibility === "community"
  const tilesData = [
    { total: reports.length || 0, label: "reports", names: reportAvatars },
    ...(isPublic ? [
      { total: concern.vote_count ?? 0, label: "upvotes", names: upvoterNames },
      { total: concern.comment_count ?? 0, label: "comments", names: commentAuthors },
    ] : []),
  ]
  const hasItems = reports.length > 0 || (isPublic && (concern.comments?.length ?? 0) > 0)

  async function submitComment(reportId: number) {
    const body = (commentDrafts[reportId] ?? "").trim()
    if (!body) return
    setCommentLoading(reportId)
    try {
      await commentOnConcern(concern.id, { body })
      setCommentDrafts((prev) => ({ ...prev, [reportId]: "" }))
      toast.success("Comment posted")
    } catch {
      toast.error("Could not post comment.")
    } finally {
      setCommentLoading(null)
    }
  }

  return (
    <section className="rounded-[24px] bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <UsersIcon className="size-4 text-neutral-500" />
          <h3 className="text-[14px] font-medium text-neutral-800">Community signal</h3>
        </div>
        {hasItems ? (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-[11px] text-neutral-400 transition-colors hover:text-neutral-600"
          >
            {expanded ? "Hide" : "View all"}
          </button>
        ) : null}
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        {tilesData.map((tile) => (
          <div key={tile.label} className="rounded-[14px] bg-neutral-100 px-3.5 py-3">
            <p className="text-[11px] text-neutral-400">{tile.label}</p>
            {tile.names.length > 0 ? (
              <div className="mt-2 flex items-center gap-1">
                <div className="flex -space-x-1.5">
                  {tile.names.slice(0, 3).map((initial, i) => (
                    <span
                      key={i}
                      className="flex size-5 items-center justify-center rounded-full bg-slate-soft text-[8px] font-semibold text-navy-muted ring-1 ring-white"
                    >
                      {initial}
                    </span>
                  ))}
                </div>
                {tile.total > 3 ? <span className="text-[9px] text-neutral-400">+{tile.total - 3}</span> : null}
              </div>
            ) : (
              <p className="mt-2 text-[11px] text-neutral-300">none</p>
            )}
          </div>
        ))}
      </div>
      {expanded && (reports.length > 0 || concern.comments?.length > 0) ? (
        <>
          <div className="my-3 border-t border-neutral-100" />
          <div className="space-y-2">
          {reports.map((report) => {
            const photo = photos.find((p) => p.report_id === report.id)
            const rowOpen = expandedRow === report.id
            return (
              <div
                key={`report-${report.id}`}
                className="rounded-[14px] bg-neutral-100 p-3"
              >
                <button
                  type="button"
                  onClick={() => setExpandedRow(rowOpen ? null : report.id)}
                  className="flex w-full gap-3 text-left"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-soft text-[13px] font-semibold text-navy-muted">
                    {report.reporter_name?.charAt(0)?.toUpperCase() || "R"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-medium text-neutral-800">{report.reporter_name}</p>
                    <p className={`mt-0.5 text-[11px] text-neutral-500 ${rowOpen ? "" : "line-clamp-2"}`}>{report.description}</p>
                  </div>
                  {photo && !rowOpen ? (
                    <AuthenticatedMediaImage
                      src={photo.preview_url}
                      alt=""
                      className="size-12 shrink-0 rounded-[8px] object-cover"
                    />
                  ) : null}
                </button>
                {rowOpen && photo ? (
                  <button
                    type="button"
                    onClick={() => {
                      const items: MediaPreviewItem[] = [{ src: photo.preview_url, filename: photo.original_filename, kind: "image" }]
                      setPreviewPhoto({ items, index: 0 })
                    }}
                    className="mt-2 ml-12 block w-[calc(100%-3rem)] overflow-hidden rounded-[12px]"
                  >
                    <AuthenticatedMediaImage
                      src={photo.preview_url}
                      alt=""
                      className="w-full max-h-48 object-cover"
                    />
                  </button>
                ) : null}
                {rowOpen ? (
                  <div className="mt-2 ml-12 flex items-center gap-2">
                    <input
                      type="text"
                      value={commentDrafts[report.id] ?? ""}
                      onChange={(e) => setCommentDrafts((prev) => ({ ...prev, [report.id]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault()
                          void submitComment(report.id)
                        }
                      }}
                      placeholder="Write a comment..."
                      className="flex-1 rounded-full bg-white px-3.5 py-1.5 text-[12px] text-neutral-900 outline-none placeholder:text-neutral-400"
                    />
                    <button
                      type="button"
                      disabled={!commentDrafts[report.id]?.trim() || commentLoading === report.id}
                      onClick={() => void submitComment(report.id)}
                      className="flex size-7 items-center justify-center rounded-full bg-neutral-900 text-white disabled:opacity-40"
                    >
                      <SendIcon className="size-3" />
                    </button>
                  </div>
                ) : null}
              </div>
            )
          })}
          {isPublic && (concern.comments ?? []).filter((c) => !c.parent).map((comment) => (
            <div
              key={`comment-${comment.id}`}
              className="flex gap-3 rounded-[14px] bg-neutral-100 p-3"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-soft text-[13px] font-semibold text-navy-muted">
                {(comment.author?.full_name || "R").charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium text-neutral-800">{comment.author?.full_name || "Resident"}</p>
                <p className="mt-0.5 line-clamp-2 text-[11px] text-neutral-500">{comment.body}</p>
              </div>
            </div>
          ))}
        </div>
        </>
      ) : null}
      {previewPhoto ? (
        <MediaLightbox
          items={previewPhoto.items}
          index={previewPhoto.index}
          onClose={() => setPreviewPhoto(null)}
        />
      ) : null}
    </section>
  )
}

const officialFilters = [
  "In Progress",
  "Resolved",
  "Rejected",
  "Appealed",
  "All",
] as const

const filterMeta: Record<string, { icon: typeof ClockIcon; bg: string; subtext: string }> = {
  "In Progress": { icon: ClockIcon, bg: "bg-brand-navy", subtext: "Active concerns" },
  Resolved: { icon: CircleCheck, bg: "bg-emerald-600", subtext: "Closed concerns" },
  Rejected: { icon: CircleX, bg: "bg-red-500", subtext: "Declined concerns" },
  Appealed: { icon: ScaleIcon, bg: "bg-amber-500", subtext: "Under review" },
  All: { icon: UsersIcon, bg: "bg-neutral-700", subtext: "All concerns" },
}

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

  const draft = useDecisionDraft(current)
  const [actionPaneOpen, setActionPaneOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [queueWidth, setQueueWidth] = useState(380)

  const [recordTab, setRecordTab] = useState("chat")

  const [blurTarget, setBlurTarget] = useState<ConcernMedia | null>(null)
  const [evidencePreview, setEvidencePreview] = useState<{ items: MediaPreviewItem[]; index: number } | null>(null)

  const isLgUp = useIsDesktop()

  const hasExplicitSelection = Boolean(selected)

  const closedCase = current ? ["rejected", "resolved"].includes(current.status) : false

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
      plain
      disabled={closedCase}
      emptyMessage="Ask the resident for anything you need â€” a clearer photo, an exact landmark, or a time you can visit."
      onMessageSent={onRefresh}
      className="h-full"
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

  const filterDropdown = (
    <>
      <button
        type="button"
        aria-label="Close filters"
        onClick={() => setFilterOpen(false)}
        className="fixed inset-0 z-20 cursor-default"
      />
      <div
        role="listbox"
        aria-label="Concern queue filters"
        className="absolute left-4 top-[64px] z-30 overflow-hidden rounded-[20px] bg-white p-1.5 shadow-lg"
        style={{ width: queueWidth ? Math.max(queueWidth - 32, 240) : 300 }}
      >
        {officialFilters.map((filter) => {
          const optionActive = activeFilter === filter
          const count = reports.filter((report) => matchesOfficialFilter(report, filter)).length
          const meta = filterMeta[filter]
          const Icon = meta.icon
          return (
            <button
              key={filter}
              type="button"
              role="option"
              aria-selected={optionActive}
              onClick={() => {
                setActiveFilter(filter)
                setFilterOpen(false)
              }}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] transition hover:bg-neutral-50"
            >
              <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-md text-white", meta.bg)}>
                <Icon className="size-3.5" strokeWidth={1.7} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block font-medium text-neutral-900">{filter}</span>
                <span className="block text-[13px] text-neutral-500">{meta.subtext} · {count}</span>
              </span>
              {optionActive && <CircleCheck className="size-4 shrink-0 text-green-600" strokeWidth={2} />}
            </button>
          )
        })}
      </div>
    </>
  )

  const queuePane = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="scrollbar-hide min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 pb-4 pt-4">
        {error ? (
          <p className="rounded-[16px] border border-severity-critical/40 bg-severity-critical-surface px-3 py-2 text-label text-severity-critical-ink">
            {error}
          </p>
        ) : null}
        {ranked.length > 0 ? (
          ranked.map((entry) => (
            <ConcernQueueItem
              key={entry.concern.id}
              entry={entry}
              active={current?.id === entry.concern.id}
              onSelect={() => onSelect(entry.concern)}
            />
          ))
        ) : (
          <div className="rounded-[24px] bg-white p-8 text-center text-[14px] font-normal text-foreground">
            No concerns match this queue.
          </div>
        )}
      </div>
    </div>
  )

  const recordTabs = [
    { id: "details", label: "Details", icon: MapPinIcon, count: null as number | null },
    { id: "evidence", label: "Photos", icon: ImageIcon, count: current?.media?.length ?? 0 },
    { id: "appeals", label: "Appeals", icon: ScaleIcon, count: openAppealCount },
    { id: "merges", label: "Merges", icon: GitMergeIcon, count: null },
  ]

  const recordPane = current ? (
    <div className="flex h-full min-h-0 flex-col">
      {hasExplicitSelection ? (
        <button
          type="button"
          onClick={onBack}
          className="flex shrink-0 items-center gap-1 px-4 py-2 text-label text-brand-orange lg:hidden"
        >
          <ChevronLeftIcon className="size-4" /> Back to queue
        </button>
      ) : null}

      <div className="min-h-0 flex-1 px-4 pb-4 pt-3">
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[24px] bg-white">
          {(() => {
            const fullName = concernReporterName(current)
            const initials = current.reporter?.initials || initialsOf(fullName)
            const submitted = new Date(current.created_at)
            return (
              <div className="shrink-0 px-6 pt-5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[13px] font-normal text-subtle-foreground">
                    {statusLabelOf(current.status)}
                  </span>
                  <span className="text-[13px] font-normal text-faint-foreground">
                    {Number.isNaN(submitted.getTime())
                      ? ""
                      : new Intl.DateTimeFormat("en", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        }).format(submitted)}
                  </span>
                </div>

                <div className="mt-4 flex flex-col items-center text-center">
                  <span
                    className={cn(
                      "flex size-14 items-center justify-center rounded-full text-[18px] font-bold",
                      avatarTone,
                    )}
                  >
                    {initials}
                  </span>
                  <p className="mt-2 text-[17px] font-bold leading-tight text-foreground">
                    {fullName}
                  </p>
                  <p className="text-[12px] text-faint-foreground">
                    Resident · {streetOnly(current.address) || current.barangay}
                  </p>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-center gap-2 pb-4">
                  <button
                    type="button"
                    onClick={() => setRecordTab("chat")}
                    aria-pressed={recordTab === "chat"}
                    className="flex h-10 items-center gap-2 rounded-pill bg-gradient-to-b from-white to-neutral-200 px-4 text-[13px] font-semibold text-neutral-800 transition-all duration-[--duration-micro]"
                  >
                    <ReplyIcon className="size-4" /> Reply
                  </button>
                  {recordTabs.map(({ id, label, icon: Icon, count }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setRecordTab(id)}
                      aria-pressed={recordTab === id}
                      title={label}
                      className="relative flex size-10 items-center justify-center rounded-full bg-gradient-to-b from-white to-neutral-200 text-neutral-800 transition-all duration-[--duration-micro]"
                    >
                      <Icon className="size-4" />
                      {count ? (
                        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-pill bg-ink px-1 text-[10px] font-bold text-white">
                          {count}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
                <div className="mx-auto w-28 border-t border-card-line" />
              </div>
            )
          })()}

          {recordTab === "chat" ? (
            <div className="min-h-0 flex-1 px-4 pb-4 pt-3">{chatTabContent}</div>
          ) : (
            <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-6 pt-4">
              {recordTab === "details" ? detailsTabContent : null}
              {recordTab === "evidence" ? evidenceTabContent : null}
              {recordTab === "appeals" ? appealsTabContent : null}
              {recordTab === "merges" ? mergeTabContent : null}
            </div>
          )}
        </div>
      </div>
    </div>
  ) : null

  const panes: OpsPaneSpec[] = [
    {
      id: "queue",
      role: "list",
      initial: 380,
      min: 300,
      max: 760,
      label: "Incoming queue",
      node: queuePane,
    },
    {
      id: "record",
      role: "detail",
      min: 460,
      label: "Concern information",
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
      node: (
        <div className="flex h-full min-h-0 flex-col">
          <ActionPane report={current} draft={draft} onUpdated={onUpdated} onRefresh={onRefresh} />
        </div>
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
      className="ops-plain bg-transparent"
      onListResize={setQueueWidth}
      bar={
        <header className="relative flex h-16 shrink-0 items-center justify-between gap-4 px-4">
          <label
            className="hidden h-12 items-center gap-2 rounded-full bg-white pl-4 pr-1.5 md:flex"
            style={{ width: queueWidth ? Math.max(queueWidth - 32, 240) : 300 }}
          >
            <SearchIcon className="size-4 shrink-0 text-faint-foreground" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search concerns"
              className="min-w-0 flex-1 bg-transparent text-[13px] font-medium text-foreground outline-none placeholder:text-faint-foreground"
            />
            <button
              type="button"
              onClick={() => setFilterOpen((value) => !value)}
              title={filterOpen ? "Hide filters" : "Show filters"}
              aria-pressed={filterOpen}
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-full transition-colors duration-[--duration-micro]",
                filterOpen
                  ? "bg-card-raised text-foreground"
                  : "text-faint-foreground hover:text-foreground",
              )}
            >
              <SlidersHorizontalIcon className="size-4" />
            </button>
          </label>
          {filterOpen ? filterDropdown : null}

          <div className="ml-auto flex shrink-0 items-center gap-2.5">
            <button
              type="button"
              onClick={() => navigate("/dashboard/community-content")}
              title="Community"
              aria-label="Community"
              className="flex size-10 items-center justify-center rounded-full bg-white text-neutral-900 transition-colors duration-[--duration-micro] hover:bg-card-raised"
            >
              <MegaphoneIcon className="size-4" />
            </button>
            {!isLgUp && current ? (
              <OpsBarButton
                icon={SlidersHorizontalIcon}
                label="Update"
                tone="primary"
                onClick={() => setActionPaneOpen(true)}
              />
            ) : null}
          </div>
        </header>
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
                  placeholder="Search reportsâ€¦"
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
                          {(report.title ? report.title.length > 80 : report.description.length > 80) ? "â€¦" : ""}
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
                  {firstShown}â€“{lastShown} of {filtered.length}
                </p>
                <div className="flex items-center gap-2">
                  {nextReportPage && (
                    <button
                      type="button"
                      onClick={() => void loadMoreReports()}
                      disabled={loadingMore}
                      className="rounded-md border border-neutral-200 px-3 py-1.5 text-[12px] font-semibold text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-40"
                    >
                      {loadingMore ? "Loadingâ€¦" : "Load more"}
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

