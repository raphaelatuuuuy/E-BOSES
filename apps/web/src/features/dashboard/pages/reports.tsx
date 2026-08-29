import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import {
  CircleCheck,
  CircleX,
  ClockIcon,
  MapPinIcon,
  PlusIcon,
  ScaleIcon,
  SearchIcon,
  SignalHighIcon,
  SignalIcon,
  SignalLowIcon,
  SignalMediumIcon,
  SlidersHorizontalIcon,
  TriangleAlert,
  UsersIcon,
} from "lucide-react"

import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"

import { useDebouncedCallback } from "@/hooks/use-debounced-callback"
import {
  getConcern,
  listManagedConcernsPage,
  listMyConcernsPage,
  type Concern,
  type PublicUser,
} from "@/features/dashboard/api"
import { ReportChatPanel } from "@/features/dashboard/components/report-chat-panel"
import { ReportLocationMap } from "@/features/dashboard/components/report-location-map"
import { ConcernTimeline } from "@/features/dashboard/components/concerns/concern-timeline"
import { buildConcernTimelineEntries } from "@/features/dashboard/components/concerns/concern-timeline-lib"
import { SheetDialog } from "@/features/dashboard/components/sheet-dialog"
import { ConcernQueueItem, avatarTone, concernReporterName, initialsOf } from "@/features/dashboard/components/concerns/concern-queue-item"
import {
  ResidentReportsWorkspace,
  filterResidentReports,
} from "@/features/dashboard/components/concerns/resident-reports-workspace"
import { streetOnly } from "@/features/dashboard/lib/location-text"
import { statusLabelOf } from "@/features/dashboard/lib/status-vocabulary"

import { rankConcerns } from "@/features/dashboard/components/record/concern-adapter"
import { OfficialStatusPanel } from "@/features/dashboard/components/concerns/official-status-panel"
import { useDecisionDraft } from "@/features/dashboard/components/concerns/use-decision-draft"
import {
  MediaLightbox,
} from "@/features/dashboard/components/authenticated-media"
import type { MediaPreviewItem } from "@/features/dashboard/lib/authenticated-media"
import { EmergencyQueueItem } from "@/features/dashboard/components/concerns/emergency-queue-item"
import { EmergencyChatPanel } from "@/features/dashboard/components/emergency-chat-panel"
import { EmergencyInfoPane } from "@/features/dashboard/components/emergencies/emergency-info-pane"
import { listEmergencyQueue, type EmergencyAlert } from "@/features/dashboard/emergency-api"
import { listActiveResponders, type ActiveResponder } from "@/features/dashboard/api"
import { hasCapability } from "@/features/dashboard/lib/capabilities"
import { isEmergencyActive } from "@/features/dashboard/lib/status-vocabulary"
import { useAuthSession } from "@/features/auth/auth-session"
import { usePageTitle } from "@/hooks/use-page-title"
import {
  OpsWorkspace,
  type OpsPaneSpec,
} from "@/features/dashboard/components/workspace/ops-workspace"
import { concernSeverityOf } from "@/features/dashboard/components/record/concern-adapter"
import { useIsDesktop } from "@/features/dashboard/lib/shell"

function ActionPane({ report, draft, viewer, onUpdated, onRefresh, onOpenProof }: { report: Concern; draft: ReturnType<typeof useDecisionDraft>; viewer?: PublicUser | null; onUpdated: (r: Concern) => void; onRefresh: () => Promise<void>; onOpenProof: (items: MediaPreviewItem[], index: number) => void }) {
  const [formOpen, setFormOpen] = useState(false)

  const timeline = buildConcernTimelineEntries(report, onOpenProof, viewer)

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 px-4 pb-4 pt-4">
      <section className="flex min-h-0 flex-col rounded-[24px] bg-white p-4 ring-1 ring-neutral-200">
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ClockIcon className="size-4 text-neutral-500" />
            <h3 className="text-[14px] font-medium text-neutral-800">Updates</h3>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => setFormOpen(true)}
              title="Update the status"
              className="flex size-8 items-center justify-center rounded-full text-neutral-500 ring-1 ring-neutral-200 transition-colors hover:bg-neutral-50 hover:text-neutral-800"
            >
              <PlusIcon className="size-4" />
            </button>
          </div>
        </div>
        <div className="scrollbar-hide mt-3 max-h-[clamp(12rem,42vh,32rem)] overflow-y-auto overscroll-contain pr-1">
          <ConcernTimeline key={report.id} items={timeline} collapsibleHistory />
        </div>
      </section>

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[24px] bg-white ring-1 ring-neutral-200">
        <div className="flex shrink-0 items-center gap-2.5 px-4 py-2.5">
          <MapPinIcon className="size-4 shrink-0 text-neutral-500" />
          <h3 className="shrink-0 text-[14px] font-medium text-neutral-800">Location</h3>
          {streetOnly(report.community_incident?.address || report.address) ? (
            <span className="min-w-0 truncate text-[12px] font-normal text-neutral-400">
              {streetOnly(report.community_incident?.address || report.address)}
            </span>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 px-4 pb-4">
          <ReportLocationMap
            latitude={report.latitude}
            longitude={report.longitude}
            streetAddress={report.community_incident?.address || report.address}
            category={report.category}
            iconKey={report.category_ref?.icon_key}
            heightClassName="h-full min-h-20"
            className="overflow-hidden rounded-[16px] border border-neutral-100"
          />
        </div>
      </section>

      <SheetDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title="Update the status"
        description="What the resident will see in the Updates timeline."
      >
        <OfficialStatusPanel
          variant="dialog"
          report={report}
          draft={draft}
          onUpdated={onUpdated}
          onRefresh={onRefresh}
          onDismiss={() => setFormOpen(false)}
        />
      </SheetDialog>
    </div>
  )
}

const statusFilters = [
  "Emergencies",
  "In Progress",
  "Resolved",
  "Rejected",
  "Appealed",
  "All",
] as const

const priorityFilters = ["Critical", "High", "Moderate", "Low"] as const

const SEVERITY_FILTERS: Record<string, string> = {
  Critical: "critical",
  High: "high",
  Moderate: "moderate",
  Low: "low",
}

const filterMeta: Record<string, { icon: typeof ClockIcon; bg: string; subtext: string }> = {
  Critical: { icon: SignalIcon, bg: "bg-[#d62018]", subtext: "Someone can be hurt" },
  High: { icon: SignalHighIcon, bg: "bg-[#cf4a40]", subtext: "Risk of injury" },
  Moderate: { icon: SignalMediumIcon, bg: "bg-severity-moderate", subtext: "Needs official action" },
  Low: { icon: SignalLowIcon, bg: "bg-neutral-400", subtext: "Nuisance or upkeep" },
  Emergencies: { icon: TriangleAlert, bg: "bg-neutral-700", subtext: "Urgent cases" },
  "In Progress": { icon: ClockIcon, bg: "bg-[#f97316]", subtext: "Active concerns" },
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
  const severityTarget = SEVERITY_FILTERS[filter]
  if (severityTarget) {
    if (report.severity_assessed === false) return false
    return (report.severity ?? concernSeverityOf(report).severity) === severityTarget
  }
  switch (filter) {
    case "All":
      return true
    case "Emergencies":
      return false
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

function OfficialConcernDashboard({
  reports,
  selected,
  viewer,
  activeFilter,
  setActiveFilter,
  search,
  setSearch,
  onSelect,
  onBack,
  onUpdated,
  onRefresh,
  error,
  alerts,
  responders,
  selectedAlert,
  onSelectAlert,
  onAlertUpdated,
}: {
  reports: Concern[]
  selected: Concern | undefined
  viewer?: PublicUser | null
  activeFilter: string
  setActiveFilter: (filter: string) => void
  search: string
  setSearch: (value: string) => void
  onSelect: (report: Concern) => void
  onBack: () => void
  onUpdated: (report: Concern) => void
  onRefresh: () => Promise<void>
  error: string
  alerts: EmergencyAlert[]
  responders: ActiveResponder[]
  selectedAlert: EmergencyAlert | null
  onSelectAlert: (alert: EmergencyAlert | null) => void
  onAlertUpdated: (alert: EmergencyAlert) => void
}) {
  const filtered = filterOfficialReports(reports, activeFilter, search)
  const current = selected ?? filtered[0]

  const liveAlerts = useMemo(() => alerts.filter((alert) => isEmergencyActive(alert.status)), [alerts])
  const queueAlerts = useMemo(() => {
    const base = activeFilter === "Emergencies" ? alerts : liveAlerts
    const q = search.trim().toLowerCase()
    if (!q) return base
    return base.filter((alert) =>
      [alert.type, alert.note, alert.address, alert.display_location, alert.barangay]
        .some((value) => value?.toLowerCase().includes(q)),
    )
  }, [alerts, liveAlerts, activeFilter, search])

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 300_000)
    return () => window.clearInterval(timer)
  }, [])

  const ranked = useMemo(() => rankConcerns(filtered, now), [filtered, now])

  const draft = useDecisionDraft(current)
  const isLgUp = useIsDesktop()
  const [actionPaneOpen, setActionPaneOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [filterMode, setFilterMode] = useState<"Status" | "Priority">("Status")
  const [queueWidth, setQueueWidth] = useState(380)

  const [evidencePreview, setEvidencePreview] = useState<{ items: MediaPreviewItem[]; index: number } | null>(null)

  const hasExplicitSelection = Boolean(selected)

  const closedCase = current ? ["rejected", "resolved"].includes(current.status) : false

  const refreshCurrentReport = useCallback(async () => {
    await onRefresh()
    if (!current) return
    try {
      const full = await getConcern(current.id)
      onUpdated(full)
    } catch {
      // The chat message was already sent; the next normal refresh can fill in
      // the detail timeline if this follow-up request is unavailable.
    }
  }, [current, onRefresh, onUpdated])

  const chatTabContent = current ? (
    <ReportChatPanel
      key={`official-chat-${current.id}`}
      concernId={current.id}
      open
      showHistory
      plain
      disabled={closedCase}
      emptyMessage="Ask the resident for anything you need — a clearer photo, an exact landmark, or a time you can visit."
      appeals={current.appeals ?? []}
      canDecideAppeals
      onAppealsChanged={refreshCurrentReport}
      onMessageSent={refreshCurrentReport}
      className="h-full"
    />
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
        className="absolute left-4 top-[64px] z-30 overflow-hidden rounded-[20px] bg-white p-1.5 shadow-lg ring-1 ring-neutral-200"
        style={{ width: queueWidth ? Math.max(queueWidth - 32, 240) : 300 }}
      >
        <div className="mb-1.5 flex gap-1 rounded-full bg-neutral-100 p-1">
          {(["Status", "Priority"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={filterMode === mode}
              onClick={() => setFilterMode(mode)}
              className={cn(
                "flex-1 rounded-full px-3 py-1.5 text-center text-[13px] font-semibold transition-colors",
                filterMode === mode
                  ? "bg-white text-neutral-900 shadow-sm"
                  : "text-neutral-500 hover:text-neutral-900",
              )}
            >
              {mode}
            </button>
          ))}
        </div>
        {(filterMode === "Priority" ? priorityFilters : statusFilters).map((filter) => {
          const optionActive = activeFilter === filter
          const emergencyOption = filter === "Emergencies"
          const count = emergencyOption
            ? liveAlerts.length
            : reports.filter((report) => matchesOfficialFilter(report, filter)).length
          const meta = filterMeta[filter]
          const Icon = meta.icon
          const tile = emergencyOption && liveAlerts.length > 0 ? "bg-sos" : meta.bg
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
              className="flex w-full items-center gap-3 rounded-[12px] px-4 py-2.5 text-left text-[15px] transition hover:bg-neutral-50"
            >
              <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-md text-white ring-1 ring-black/10", tile)}>
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
      <div className="scrollbar-hide flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-4 pb-4 pt-4">
        {error ? (
          <p className="rounded-[16px] border border-severity-critical/40 bg-severity-critical-surface px-3 py-2 text-label text-severity-critical-ink">
            {error}
          </p>
        ) : null}
        {queueAlerts.map((alert) => (
          <EmergencyQueueItem
            key={`alert-${alert.id}`}
            alert={alert}
            active={selectedAlert?.id === alert.id}
            onSelect={() => onSelectAlert(alert)}
          />
        ))}
        {activeFilter === "Emergencies" ? (
          queueAlerts.length === 0 ? (
            <div className="rounded-[24px] bg-white p-8 text-center text-[14px] font-normal text-foreground ring-1 ring-neutral-200">
              No emergencies in this queue.
            </div>
          ) : null
        ) : ranked.length > 0 ? (
          ranked.map((entry) => (
            <ConcernQueueItem
              key={entry.concern.id}
              entry={entry}
              active={!selectedAlert && current?.id === entry.concern.id}
              onSelect={() => onSelect(entry.concern)}
              tintBy={filterMode}
            />
          ))
        ) : (
          <div className="rounded-[24px] bg-white p-8 text-center text-[14px] font-normal text-foreground ring-1 ring-neutral-200">
            No concerns match this queue.
          </div>
        )}
      </div>
    </div>
  )

  const recordPane = current ? (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 px-0 pb-0 pt-0 lg:px-4 lg:pb-4 lg:pt-3">
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-transparent lg:rounded-[24px] lg:bg-white lg:ring-1 lg:ring-neutral-200">
          {(() => {
            const fullName = concernReporterName(current)
            const initials = (current.reporter?.initials || initialsOf(fullName)).charAt(0)
            const submitted = new Date(current.created_at)
            return (
              <div className="shrink-0 px-0 pt-0 lg:px-6 lg:pt-5">
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
                    Resident
                  </p>
                </div>
              </div>
            )
          })()}

          <div className="min-h-0 flex-1 px-0 pb-0 pt-3 lg:px-4 lg:pb-4">{chatTabContent}</div>
        </div>
      </div>
    </div>
  ) : null

  const alertRecordPane = selectedAlert ? (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 px-0 pb-0 pt-0 lg:px-4 lg:pb-4 lg:pt-3">
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-transparent lg:rounded-[24px] lg:bg-white lg:ring-1 lg:ring-neutral-200">
          {(() => {
            const reporterName = selectedAlert.reporter_display || selectedAlert.reporter?.full_name || "Unknown reporter"
            const initials = reporterName.charAt(0).toUpperCase()
            const submitted = new Date(selectedAlert.created_at)
            return (
              <div className="shrink-0 px-0 pt-0 lg:px-6 lg:pt-5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[13px] font-normal text-subtle-foreground">
                    {statusLabelOf(selectedAlert.status, "official", "emergency")}
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
                    {reporterName}
                  </p>
                  <p className="text-[12px] text-faint-foreground">
                    Resident
                  </p>
                </div>
              </div>
            )
          })()}

          <div className="min-h-0 flex-1 px-0 pb-0 pt-3 lg:px-4 lg:pb-4">
            <EmergencyChatPanel
              alertId={selectedAlert.id}
              open
              theme="light"
              variant="modern"
              bare
              disabled={selectedAlert.status === "cancelled" || selectedAlert.status === "resolved"}
              className="h-full"
            />
          </div>
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
      label: selectedAlert ? "Emergency chat" : "Concern information",
      node: selectedAlert ? alertRecordPane : recordPane,
    },
  ]

  if (selectedAlert) {
    panes.push({
      id: "action",
      role: "aside",
      initial: 380,
      min: 300,
      max: 720,
      label: "Emergency info",
      className: "overflow-hidden",
      node: (
        <EmergencyInfoPane
          alert={selectedAlert}
          responders={responders}
          onChanged={onAlertUpdated}
        />
      ),
    })
  } else if (current) {
    panes.push({
      id: "action",
      role: "aside",
      initial: 380,
      min: 300,
      max: 720,
      label: "Update report",
      className: "overflow-hidden",
      node: (
        <ActionPane report={current} draft={draft} viewer={viewer} onUpdated={onUpdated} onRefresh={onRefresh} onOpenProof={(items, index) => setEvidencePreview({ items, index })} />
      ),
    })
  }

  return (
    <>
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
      onMobileDetailClose={onBack}
      panes={panes}
      fullHeightAside
      fullHeightDetail={Boolean(selectedAlert || (current && !selectedAlert))}
      className="ops-plain bg-transparent"
      onListResize={setQueueWidth}
      bar={
        <header className="relative flex h-16 shrink-0 items-center justify-between gap-4 px-4">
          <label
            className="flex h-12 flex-1 items-center gap-2 rounded-full bg-white pl-4 pr-1.5 ring-1 ring-neutral-200 md:flex-none"
            style={{ width: isLgUp ? (queueWidth ? Math.max(queueWidth - 32, 240) : 300) : undefined }}
          >
            <SearchIcon className="size-5 shrink-0 text-faint-foreground" />
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
              <SlidersHorizontalIcon className="size-5" />
            </button>
          </label>
          {filterOpen ? filterDropdown : null}

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
  const [reports, setReports] = useState<Concern[]>([])
  const [nextReportPage, setNextReportPage] = useState<number | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [detailCache, setDetailCache] = useState<Record<string, Concern>>({})
  const [error, setError] = useState("")
  const [residentSearch, setResidentSearch] = useState("")
  const [alerts, setAlerts] = useState<EmergencyAlert[]>([])
  const [responders, setResponders] = useState<ActiveResponder[]>([])
  const [selectedAlertId, setSelectedAlertId] = useState<number | null>(null)

  const routeReportId = reportId ?? null
  const isOfficial = Boolean(
    user?.role === "barangay_official" || user?.is_staff || user?.is_superuser,
  )
  const canDispatch = Boolean(
    user?.is_staff || user?.is_superuser || hasCapability(user?.capabilities, "dispatch_emergencies"),
  )
  const timelineViewer: PublicUser | null = user
    ? {
        id: user.id,
        full_name: user.full_name || [user.firstName, user.middleName, user.lastName].filter(Boolean).join(" ") || user.email,
        initials: (user.full_name || user.firstName || user.email).charAt(0).toUpperCase(),
        role: user.role,
        last_seen_at: user.last_seen_at ?? null,
        avatar: user.avatar,
      }
    : null

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

  const loadAlerts = useCallback(async () => {
    if (!canDispatch) {
      setAlerts([])
      return
    }
    try {
      const [queue, onDuty] = await Promise.all([
        listEmergencyQueue("all"),
        listActiveResponders().catch(() => [] as ActiveResponder[]),
      ])
      setAlerts(queue)
      setResponders(onDuty)
    } catch {
      setAlerts([])
    }
  }, [canDispatch])

  useEffect(() => {
    void loadAlerts()
    const timer = window.setInterval(() => void loadAlerts(), 15_000)
    return () => window.clearInterval(timer)
  }, [loadAlerts])

  const refreshSelectedReport = useCallback(async () => {
    await loadReports()
    if (!selectedReport) return
    try {
      const full = await getConcern(selectedReport)
      setDetailCache((current) => ({ ...current, [selectedReport]: full }))
    } catch {
      // Keep the current detail visible if the follow-up request is unavailable.
    }
  }, [loadReports, selectedReport])

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

  const eventRefresh = useDebouncedCallback(() => void refreshSelectedReport(), 3000)

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

  useEffect(() => {

    if (!loaded || !selectedReport || reports.length === 0) return
    const inFilter = filterResidentReports(reports, activeFilter).some(
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

  const selected = selectedReport
    ? detailCache[selectedReport] ??
      reports.find(
        (report) => report.public_id === selectedReport || String(report.id) === selectedReport,
      ) ??
      null
    : null

  function selectReport(report: Concern) {
    setSelectedReport(report.public_id)
    setSelectedAlertId(null)
    void getConcern(report.public_id)
      .then((full) => setDetailCache((current) => ({ ...current, [report.public_id]: full })))
      .catch(() => {
        // The list row remains available while the detail request is retried.
      })
    navigate(`/dashboard/reports/${report.public_id}`)
  }

  function updateReport(next: Concern) {
    setReports((current) => current.map((report) => report.id === next.id ? next : report))
    setDetailCache((prev) => ({ ...prev, [next.public_id]: next }))
    setSelectedReport(next.public_id)
  }

  if (isOfficial) {
    return (
      <OfficialConcernDashboard
        reports={reports}
        viewer={timelineViewer}
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
        alerts={alerts}
        responders={responders}
        selectedAlert={alerts.find((alert) => alert.id === selectedAlertId) ?? null}
        onSelectAlert={(alert) => setSelectedAlertId(alert?.id ?? null)}
        onAlertUpdated={(next) => {
          setAlerts((current) => current.map((alert) => (alert.id === next.id ? next : alert)))
          setSelectedAlertId(next.id)
        }}
      />
    )
  }

  return (
    <ResidentReportsWorkspace
      reports={reports}
      selected={selected}
      activeFilter={activeFilter}
      setActiveFilter={setActiveFilter}
      search={residentSearch}
      setSearch={setResidentSearch}
      onSelect={selectReport}
      onBack={closeReportDetails}
        onRefresh={refreshSelectedReport}
      onLoadMore={() => void loadMoreReports()}
      loadingMore={loadingMore}
      canLoadMore={nextReportPage != null}
      error={error}
    />
  )
}

