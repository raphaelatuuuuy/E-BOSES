import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  EyeOffIcon,
  MegaphoneIcon,
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
import { concernNeedsReview } from "@/features/dashboard/lib/concern-signals"
import { PRIVACY_STATE_BADGE, privacyState } from "@/features/dashboard/lib/plain-language"
import { ReviewAssistant } from "@/features/dashboard/components/concerns/review-assistant"
import { ConcernAppealsPanel } from "@/features/dashboard/components/concerns/concern-appeals-panel"
import { MediaBlurEditor } from "@/features/dashboard/components/concerns/media-blur-editor"
import { ReportChatPanel } from "@/features/dashboard/components/report-chat-panel"
import { ReportLocationMap } from "@/features/dashboard/components/report-location-map"
import { ReportStatusDialog, type StatusDialogMode } from "@/features/dashboard/components/report-status-dialog"
import { ConcernTimeline } from "@/features/dashboard/components/concerns/concern-timeline"
import { buildConcernTimelineEntries } from "@/features/dashboard/components/concerns/concern-timeline-lib"
import {
  activeStatuses,
  categoryLabels,
  concernCategoryLabel,
  filters,
  formatDate,
  openReportMedia,
  statusColors,
  statusGroup,
  useMinWidth,
} from "@/features/dashboard/components/concerns/concern-display"
import { ReportIcon } from "@/features/dashboard/components/concerns/report-icon"
import { ReportDetailsSidebar } from "@/features/dashboard/components/concerns/report-details-sidebar"
import { ConcernQueueItem } from "@/features/dashboard/components/concerns/concern-queue-item"

import { rankConcerns, toConcernRecordView } from "@/features/dashboard/components/record/concern-adapter"
import { OfficialStatusPanel } from "@/features/dashboard/components/concerns/official-status-panel"
import { ResidentFollowUpPanel } from "@/features/dashboard/components/concerns/resident-follow-up-panel"
import {
  AuthenticatedMediaImage,
  openAuthenticatedMedia,
} from "@/features/dashboard/components/authenticated-media"
import { useAuthSession } from "@/features/auth/auth-session"
import { usePageTitle } from "@/hooks/use-page-title"
import {
  OpsWorkspace,
  OpsPaneHeader,
  type OpsPaneSpec,
} from "@/features/dashboard/components/workspace/ops-workspace"
import { OpsBar, OpsBarButton } from "@/features/dashboard/components/workspace/ops-bar"
import { OpsTabs } from "@/features/dashboard/components/workspace/ops-tabs"

const residentReportsPageSize = 5

function filterReports(reports: Concern[], filter: string) {
  if (filter === "All") return reports
  if (filter === "Active") {
    return reports.filter((report) => activeStatuses.includes(report.status))
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

/**
 * Queue filters, rewritten around what an official is trying to do.
 *
 * The old set was ["All", "New", "In Review", "Validated", "Suspicious",
 * "Needs review"] and had two problems. "Validated" quietly merged in-progress
 * work with finished work, and "Suspicious" was the only route to a rejected
 * report — so there was no way to answer "show me what we closed this week",
 * and finished reports were effectively invisible once they left the active
 * statuses.
 *
 * `Open` is the default working set. `Resolved`, `Rejected` and `Appealed` are
 * the closed views that were missing entirely.
 */
const officialFilters = [
  "Open",
  "Needs review",
  "New",
  "In progress",
  "Resolved",
  "Rejected",
  "Appealed",
  "All",
] as const

const OPEN_STATUSES = ["submitted", "under_review", "assigned", "in_progress"]

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
    case "Open":
      return OPEN_STATUSES.includes(report.status)
    case "Needs review":
      return concernNeedsReview(report)
    case "New":
      return report.status === "submitted"
    case "In progress":
      return ["assigned", "in_progress"].includes(report.status)
    case "Resolved":
      return report.status === "resolved"
    case "Rejected":
      return report.status === "rejected"
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


function ReviewRail({ report }: { report: Concern }) {
  return <ConcernTimeline items={buildConcernTimelineEntries(report)} />
}

function EvidencePreviewGrid({ media }: { media: Concern["media"] }) {
  const previewMedia = media.slice(0, 3)
  const moreCount = Math.max(0, media.length - previewMedia.length)

  if (!media.length) return null

  return (
    <div className="mt-3 space-y-2">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {previewMedia.map((item) =>
          item.mime_type.startsWith("image/") ? (
            <button
              key={item.id}
              type="button"
              onClick={() => void openAuthenticatedMedia(item.raw_url, item.original_filename)}
              className="overflow-hidden rounded-control border border-card-line bg-canvas text-left transition hover:border-brand-orange"
            >
              <AuthenticatedMediaImage
                src={item.preview_url}
                alt={item.original_filename}
                className="h-28 w-full object-cover"
              />
              <span className="block truncate px-3 py-2 text-[12px] font-semibold text-muted-foreground">
                {item.original_filename}
              </span>
            </button>
          ) : (
            <a
              key={item.id}
              href={item.raw_url}
              target="_blank"
              rel="noreferrer"
              className="flex h-28 items-center justify-center rounded-control border border-card-line bg-canvas px-3 text-center text-[12px] font-semibold text-muted-foreground transition hover:border-brand-orange hover:text-foreground"
            >
              {item.original_filename}
            </a>
          ),
        )}
      </div>
      {moreCount > 0 ? <p className="text-[12px] font-medium text-muted-foreground">+{moreCount} more</p> : null}
    </div>
  )
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
  // Ranking and priority read the clock, which cannot happen during render.
  // Concern priority moves slowly (age is measured in hours), so a 5-minute
  // tick is ample.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 300_000)
    return () => window.clearInterval(timer)
  }, [])
  // Severity band first, then priority. Community support reorders within a
  // band but can never lift a concern past a more severe one — see
  // components/record/concern-adapter.ts.
  const ranked = useMemo(() => rankConcerns(filtered, now), [filtered, now])
  // One shared shape for the detail header, so a concern and an emergency
  // present the same way and neither module re-invents the layout.
  const concernRecord = useMemo(
    () => (current ? toConcernRecordView(current, { now }) : null),
    [current, now],
  )
  const [actionPaneOpen, setActionPaneOpen] = useState(false)
  const [recordTab, setRecordTab] = useState("details")
  // The photo an official is currently drawing blur boxes on, or null.
  const [blurTarget, setBlurTarget] = useState<ConcernMedia | null>(null)
  // Only decides whether the command bar offers a button for the AI pane; the
  // workspace itself owns the responsive ladder.
  const isWideUp = useMinWidth(1440)
  // Explicit pick only (not the desktop filtered[0] fallback) — gates the mobile
  // single-pane list<->detail toggle. lg/xl always show list+detail together.
  const hasExplicitSelection = Boolean(selected)

  const closedCase = current ? ["rejected", "resolved"].includes(current.status) : false
  const needsReviewCount = reports.filter(concernNeedsReview).length
  const openCount = reports.filter((report) => OPEN_STATUSES.includes(report.status)).length
  const appealCount = reports.filter(hasOpenAppeal).length

  const openAppealCount = current?.appeals?.filter((appeal) => appeal.status === "submitted").length ?? 0

  const facts = concernRecord?.facts ?? []
  const unitFact = facts.find((f) => f.label === "Assigned unit")
  const supportFact = facts.find((f) => f.label === "Community support")

  const detailsTabContent = current ? (
    <div className="space-y-4">
      {/* The appeal banner that used to sit here moved to the Appeals tab,
          which shows the same reason next to the Approve/Deny controls. Two
          copies of the resident's objection on one screen, only one of which
          could be acted on, was the confusing half. */}

      <div className="rounded-panel border border-card-line bg-card p-4">
        <p className="text-micro uppercase text-subtle-foreground">Reported by</p>
        <p className="mt-1.5 text-heading text-foreground">{current.reporter.full_name}</p>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 border-t border-card-line pt-3">
          <div>
            <dt className="text-micro uppercase text-subtle-foreground">Category</dt>
            <dd className="mt-0.5 text-sm font-semibold text-foreground">{concernCategoryLabel(current)}</dd>
          </div>
          {unitFact ? (
            <div>
              <dt className="text-micro uppercase text-subtle-foreground">Assigned unit</dt>
              <dd className="mt-0.5 text-sm font-semibold text-foreground">{unitFact.value || unitFact.emptyHint}</dd>
            </div>
          ) : null}
          {supportFact ? (
            <div>
              <dt className="text-micro uppercase text-subtle-foreground">Community support</dt>
              <dd className="mt-0.5 text-sm font-semibold text-foreground">{supportFact.value}</dd>
            </div>
          ) : null}
        </div>
      </div>

      <div className="rounded-panel border border-card-line bg-card p-4">
        <p className="text-micro uppercase text-subtle-foreground">Location</p>
        <div className="mt-3">
          <ReportLocationMap
            latitude={current.latitude}
            longitude={current.longitude}
            streetAddress={current.address}
            heightClassName="h-44"
          />
        </div>
      </div>

      {/* The flag chips that used to sit here are gone. They restated, in a
          third vocabulary, what the assistant below already says in sentences —
          and they were the half of the screen that could contradict it. */}

      <div className="rounded-panel border border-card-line bg-card p-4">
        <p className="text-micro uppercase text-subtle-foreground">What the resident reported</p>
        <p className="mt-2 text-body text-foreground">
          {current.description || "No description provided."}
        </p>
        <EvidencePreviewGrid media={current.media} />
      </div>

      {/* Guidance sits with the report it describes, not in a separate pane the
          official has to open. It is read-only. */}
      <ReviewAssistant report={current} />

      <div className="rounded-panel border border-card-line bg-card p-4">
        <h3 className="text-heading text-foreground">Updates</h3>
        <p className="mt-1 text-body text-muted-foreground">
          Every status change, with the note the resident was shown.
        </p>
        <div className="mt-3">
          <ReviewRail report={current} />
        </div>
      </div>
    </div>
  ) : null

  const evidenceTabContent = current ? (
    <div className="rounded-panel border border-card-line bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-heading text-foreground">Evidence</h3>
        {current.media.length > 0 ? (
          <button
            type="button"
            onClick={() => openReportMedia(current)}
            className="text-label text-brand-orange transition-colors duration-[--duration-micro] hover:text-brand-orange-strong"
          >
            View all media
          </button>
        ) : null}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {current.media.map((media) =>
          media.mime_type.startsWith("image/") ? (
            <figure key={media.id} className="overflow-hidden rounded-control border border-card-line">
              <AuthenticatedMediaImage
                src={media.preview_url}
                alt={media.original_filename}
                className="h-32 w-full object-cover"
              />
              <figcaption className="space-y-2 p-2.5">
                {/* The badge is what tells an official whether residents can
                    see this photo. Without it, a restricted image and a
                    published one look identical in the grid. */}
                <span
                  className={cn(
                    "inline-flex rounded-pill px-2 py-0.5 text-[11px] font-semibold",
                    media.privacy_state === "protected"
                      ? "bg-status-closed-surface text-status-closed-ink"
                      : media.public_visible
                        ? "bg-card-raised text-muted-foreground"
                        : "bg-severity-moderate-surface text-severity-moderate-ink",
                  )}
                >
                  {PRIVACY_STATE_BADGE[media.privacy_state] ?? "Needs Review"}
                </span>
                <p className="text-[12px] leading-5 text-muted-foreground">
                  {privacyState(media.privacy_state).help}
                </p>
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
            <a
              key={media.id}
              href={media.raw_url}
              target="_blank"
              rel="noreferrer"
              className="flex h-32 items-center justify-center rounded-control border border-card-line px-2 text-center text-label text-muted-foreground transition-colors duration-[--duration-micro] hover:bg-card-raised hover:text-foreground"
            >
              {media.original_filename}
            </a>
          ),
        )}
        {current.media.length === 0 ? (
          <div className="col-span-full flex h-32 items-center justify-center rounded-control border border-dashed border-card-line text-label text-subtle-foreground">
            No evidence uploaded
          </div>
        ) : null}
      </div>
    </div>
  ) : null

  /**
   * Chat only.
   *
   * This tab used to stack the status history (ConcernConversation) on top of
   * the message thread, so the first thing in "Chat" was a system entry reading
   * "Submitted · Raphael Andrei L. · Resident · Report submitted." — which is
   * not a message, and which the Updates list in Details already shows. A chat
   * tab should contain the conversation and nothing else.
   */
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

  const appealsTabContent = current ? (
    <ConcernAppealsPanel key={`appeals-${current.id}`} report={current} onRefresh={onRefresh} />
  ) : null

  const queuePane = (
    <>
      <OpsPaneHeader title="Incoming queue" />
      <div className="space-y-3 p-3">
        <div className="scrollbar-hide flex gap-1.5 overflow-x-auto touch-pan-x overscroll-x-contain">
          {officialFilters.map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => setActiveFilter(filter)}
              className={cn(
                "shrink-0 rounded-pill px-3 py-1.5 text-label transition-colors duration-[--duration-micro]",
                activeFilter === filter
                  ? "bg-brand-orange text-brand-orange-ink"
                  : "bg-card text-muted-foreground hover:bg-card-raised hover:text-foreground",
              )}
            >
              {filter}
              {/* Counted from the same predicate the filter uses, so a chip can
                  never promise results the queue does not contain. */}
              {(() => {
                const count = reports.filter((report) => matchesOfficialFilter(report, filter)).length
                return count > 0 ? (
                  <span className="ml-1.5 tabular-nums opacity-70">{count}</span>
                ) : null
              })()}
            </button>
          ))}
        </div>

        {error ? (
          <p className="rounded-control border border-severity-critical/40 bg-severity-critical-surface px-3 py-2 text-label text-severity-critical-ink">
            {error}
          </p>
        ) : null}

        <div className="space-y-2.5">
          {ranked.map((entry) => (
            <ConcernQueueItem
              key={entry.concern.id}
              entry={entry}
              active={current?.id === entry.concern.id}
              onSelect={() => onSelect(entry.concern)}
            />
          ))}
          {filtered.length === 0 ? (
            <p className="rounded-panel border border-card-line bg-card p-6 text-center text-body text-muted-foreground">
              No concerns match this queue.
            </p>
          ) : null}
        </div>

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

      <OpsPaneHeader title="Concern information" />
      <div className="space-y-4 p-4">
        <OpsTabs
          value={recordTab}
          onValueChange={setRecordTab}
          tabs={[
            { id: "details", label: "Details", content: detailsTabContent },
            { id: "evidence", label: "Photos", count: current.media.length, content: evidenceTabContent },
            { id: "chat", label: "Chat", content: chatTabContent },
            // Sits with the report it is about, so deciding an appeal needs no
            // navigation. The count is pending appeals only — a decided one is
            // history, not work.
            { id: "appeals", label: "Appeals", count: openAppealCount, content: appealsTabContent },
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
    { id: "queue", role: "list", initial: 340, min: 280, max: 460, node: queuePane },
    { id: "record", role: "detail", min: 420, node: recordPane },
  ]

  if (current) {
    panes.push({
      id: "action",
      role: "aside",
      initial: 340,
      min: 300,
      max: 460,
      label: "Update report",
      /**
       * The aside is now what the official *does*, not what the model thinks.
       *
       * It previously held the AI panel — four sections of read-only model
       * output plus a second decision form — while the one control that
       * actually moves the report and notifies the resident sat at the very
       * bottom of it. Guidance moved into Details, where it is read alongside
       * the report; this pane keeps only the status update.
       *
       * OfficialWorkflowPanel ("Assign to office/team", "Ask resident for
       * clarification", "Official remark") is gone: routing is automatic by
       * category, clarification is what the Chat tab is for, and a remark is
       * just a status update with a note.
       */
      node: (
        <>
          <OpsPaneHeader title="Update report" />
          <div className="p-3">
            <OfficialStatusPanel key={current.id} report={current} onUpdated={onUpdated} onRefresh={onRefresh} />
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
            // Counts of the actual working set, not the whole table. "open"
            // previously printed `reports.length` — every report ever filed,
            // including resolved and rejected ones — under the label "open".
            { label: "open", value: openCount },
            {
              label: "needs review",
              value: needsReviewCount,
              tone: needsReviewCount > 0 ? "alert" : "good",
              onClick: () => setActiveFilter("Needs review"),
            },
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
          {!isWideUp && current ? (
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
  // Read at the dialog but never set — the setter was unused, so the mode has
  // always been effectively constant. Declared as one rather than deleting the
  // state, which keeps the current behaviour explicit instead of hiding it.
  const statusDialogMode: StatusDialogMode = "assigned"
  const routeReportId = reportId ?? null
  const isOfficial = Boolean(
    user?.role === "barangay_official" || user?.is_staff || user?.is_superuser,
  )

  async function loadReports() {
    if (!hasLoadedRef.current) {
      setLoaded(false)
    }
    setError("")
    try {
      // Appeals ride along on each concern (`report.appeals`), so there is no
      // second list to fetch — the queue-wide appeals request this used to make
      // every 30 seconds fed a panel that was never rendered.
      setReports(isOfficial ? await listManagedConcerns() : await listMyConcerns())
    } catch {
      setError(isOfficial ? "Could not load report management queue." : "Could not load your reports.")
    } finally {
      hasLoadedRef.current = true
      setLoaded(true)
    }
  }

  useEffect(() => {
    void loadReports()
    function refresh() {
      void loadReports()
    }
    const interval = window.setInterval(refresh, 30000)
    window.addEventListener("eboses:report-created", refresh)
    window.addEventListener("eboses:concern-updated", refresh)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener("eboses:report-created", refresh)
      window.removeEventListener("eboses:concern-updated", refresh)
    }
  }, [isOfficial])

  useEffect(() => {
    if (routeReportId) {
      setSelectedReport(routeReportId)
    } else if (!routeReportId) {
      setSelectedReport(null)
    }
  }, [routeReportId])

  // Deep link from the official overview's "Pending reviews" tile
  // (`/dashboard/reports?ai=flagged`) → activate the "Needs review" chip, then
  // clear the param. Filter state otherwise lives purely in component state on
  // this page (chip clicks never touch the URL), so consume-on-load-and-clear
  // is the simplest pattern consistent with that — no continuous URL sync needed.
  useEffect(() => {
    if (!isOfficial) return
    if (searchParams.get("ai") === "flagged") {
      setActiveFilter("Needs review")
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

  // "Needs review" chip → refetch the managed list scoped to the backend's AI-flagged
  // queue (`ai=flagged`) and upsert into `reports` so the client-side filter (which
  // uses `concernNeedsReview()`) reflects the server's authoritative flag/decision state.
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

  useEffect(() => {
    setReportPage(1)
  }, [activeFilter])

  useEffect(() => {
    // Wait until list is loaded so we don't drop a deep-linked selection on first paint.
    if (!loaded || !selectedReport || reports.length === 0) return
    const inFilter = filterReports(reports, activeFilter).some(
      (report) => report.public_id === selectedReport || String(report.id) === selectedReport,
    )
    if (!inFilter) {
      setSelectedReport(null)
      if (routeReportId) navigate("/dashboard/reports", { replace: true })
    }
  }, [activeFilter, reports, selectedReport, routeReportId, navigate, loaded])

  // All hooks must run before any conditional return (Rules of Hooks).
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
  // Only show details when the user picks a row (or deep-links). Do not auto-open first row.
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

        {/* Filters + table: fixed custom width (not max-w utility) */}
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

          {/* Same width band as filters */}
          <div className="w-full overflow-hidden rounded-lg border border-neutral-200 bg-white">
            <div className="flex flex-col divide-y divide-neutral-100">
              {pagedReports.map((report) => {
                const group = statusGroup(report.status)
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
                    <span
                      className={cn(
                        "shrink-0 rounded-md border px-2.5 py-1 text-[11px] font-medium",
                        statusColors[group],
                      )}
                    >
                      {group}
                    </span>
                    <ChevronRightIcon className="size-4 shrink-0 text-neutral-300" />
                  </button>
                )
              })}
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center px-6 py-14 text-center text-sm text-neutral-500">
                  {activeFilter === "All"
                    ? "No reports yet."
                    : `No ${activeFilter.toLowerCase()} reports.`}
                </div>
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

      {/* Right details sidebar only — no dim/blur backdrop */}
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


