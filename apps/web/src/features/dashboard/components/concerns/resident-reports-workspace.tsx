import { useMemo, useState } from "react"
import {
  CircleCheck,
  CircleX,
  ClockIcon,
  InboxIcon,
  ScaleIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  UsersIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import type { Concern } from "@/features/dashboard/api"
import { useAuthSession } from "@/features/auth/auth-session"
import {
  OpsWorkspace,
  type OpsPaneSpec,
} from "@/features/dashboard/components/workspace/ops-workspace"
import { ConcernQueueItem } from "@/features/dashboard/components/concerns/concern-queue-item"
import { ReportDetailHeader } from "@/features/dashboard/components/concerns/report-detail-header"
import { ReportUpdatesPane } from "@/features/dashboard/components/concerns/report-updates-pane"
import {
  categoryLabels,
  filters,
} from "@/features/dashboard/components/concerns/concern-display"
import { ReportChatPanel } from "@/features/dashboard/components/report-chat-panel"
import { EmptyState } from "@/features/dashboard/components/record/empty-state"
import {
  concernSeverityOf,
  type RankedConcern,
} from "@/features/dashboard/components/record/concern-adapter"
import { MediaLightbox } from "@/features/dashboard/components/authenticated-media"
import { type MediaPreviewItem } from "@/features/dashboard/lib/authenticated-media"
import { MobileReportDetailPage } from "@/features/dashboard/components/concerns/mobile-report-detail"
import { useIsDesktop } from "@/features/dashboard/lib/shell"
import { isResolvedRecord } from "@/features/dashboard/components/alerts-map/lib"

export function filterResidentReports(reports: Concern[], filter: string) {
  if (filter === "All") return reports
  if (filter === "Active") {
    return reports.filter(
      (report) => !isResolvedRecord(report) && !["rejected", "appealed"].includes(report.status)
    )
  }
  if (filter === "Resolved") {
    return reports.filter((report) => isResolvedRecord(report))
  }
  if (filter === "Rejected") {
    return reports.filter((report) => report.status === "rejected")
  }
  if (filter === "Appealed") {
    return reports.filter(
      (report) =>
        report.status === "appealed" ||
        (report.appeals?.some((appeal) => appeal.status === "submitted") ??
          false)
    )
  }
  return reports
}

export function searchResidentReports(reports: Concern[], query: string) {
  const q = query.trim().toLowerCase()
  if (!q) return reports
  return reports.filter((report) =>
    [
      report.tracking_id,
      report.title,
      report.description,
      report.address,
      report.category_ref?.name ?? categoryLabels[report.category],
    ].some((v) => v?.toLowerCase().includes(q))
  )
}

const residentFilterMeta: Record<
  string,
  { icon: typeof ClockIcon; bg: string; subtext: string }
> = {
  All: { icon: UsersIcon, bg: "bg-neutral-700", subtext: "All reports" },
  Active: { icon: ClockIcon, bg: "bg-brand-orange", subtext: "Being handled" },
  Resolved: {
    icon: CircleCheck,
    bg: "bg-emerald-600",
    subtext: "Fixed issues",
  },
  Rejected: { icon: CircleX, bg: "bg-red-500", subtext: "Not accepted" },
  Appealed: { icon: ScaleIcon, bg: "bg-amber-500", subtext: "Under review" },
}

export function ResidentReportsWorkspace({
  reports,
  selected,
  initialDetail,
  activeFilter,
  setActiveFilter,
  search,
  setSearch,
  onSelect,
  onBack,
  onRefresh,
  onPublish,
  onLoadMore,
  loadingMore,
  canLoadMore,
  error,
}: {
  reports: Concern[]
  selected: Concern | null
  initialDetail?: Concern | null
  activeFilter: string
  setActiveFilter: (filter: string) => void
  search: string
  setSearch: (value: string) => void
  onSelect: (report: Concern) => void
  onBack: () => void
  onRefresh: () => Promise<void>
  onPublish: (report: Concern) => Promise<Concern>
  onLoadMore: () => void
  loadingMore: boolean
  canLoadMore: boolean
  error: string
}) {
  const { user } = useAuthSession()
  const isLgUp = useIsDesktop()

  const [filterOpen, setFilterOpen] = useState(false)
  const [asideOpen, setAsideOpen] = useState(false)
  const [queueWidth, setQueueWidth] = useState(380)
  const [proofPreview, setProofPreview] = useState<{
    items: MediaPreviewItem[]
    index: number
  } | null>(null)

  const visible = useMemo(
    () =>
      searchResidentReports(
        filterResidentReports(reports, activeFilter),
        search
      ),
    [reports, activeFilter, search]
  )

  const ranked = useMemo<RankedConcern[]>(
    () =>
      visible.map((concern) => ({
        concern,
        ...concernSeverityOf(concern),
        priority: 0,
      })),
    [visible]
  )

  const counts = useMemo(() => {
    const map: Record<string, number> = {}
    for (const filter of filters)
      map[filter] = filterResidentReports(reports, filter).length
    return map
  }, [reports])

  const hasExplicitSelection = Boolean(selected)
  const current = selected ?? initialDetail ?? ranked[0]?.concern ?? null
  const closedCase = current
    ? isResolvedRecord(current) || ["rejected", "appealed"].includes(current.status)
    : false
  const isOwnReport = current ? user?.id === current.reporter?.id : false
  const canFileAppeal = Boolean(
    current &&
    isOwnReport &&
    current.status === "rejected" &&
    !(current.appeals ?? []).some((appeal) => appeal.status === "submitted")
  )

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
        aria-label="Report status filters"
        className="absolute top-[64px] right-4 left-4 z-30 overflow-hidden rounded-[20px] bg-white p-1.5 shadow-lg ring-1 ring-neutral-200 lg:right-auto"
        style={{
          width: isLgUp
            ? queueWidth
              ? Math.max(queueWidth - 32, 240)
              : 300
            : undefined,
        }}
      >
        {filters.map((filter) => {
          const optionActive = activeFilter === filter
          const meta = residentFilterMeta[filter]
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
              className="flex w-full items-center gap-3 rounded-[12px] px-4 py-2.5 text-left text-[15px] transition hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:outline-none focus-visible:ring-inset"
            >
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-md text-white ring-1 ring-black/10",
                  meta.bg
                )}
              >
                <Icon className="size-3.5" strokeWidth={1.7} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-neutral-900">
                  {filter}
                </span>
                <span className="block text-[13px] text-neutral-500">
                  {meta.subtext} · {counts[filter] ?? 0}
                </span>
              </span>
              {optionActive && (
                <CircleCheck
                  className="size-4 shrink-0 text-green-600"
                  strokeWidth={2}
                />
              )}
            </button>
          )
        })}
      </div>
    </>
  )

  const queuePane = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="scrollbar-hide flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-4 pt-4 pb-4">
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
              variant="resident"
              active={current?.id === entry.concern.id}
              onSelect={() => onSelect(entry.concern)}
            />
          ))
        ) : (
          <div className="rounded-[24px] bg-white p-6 ring-1 ring-neutral-300">
            {activeFilter === "All" &&
            !search.trim() &&
            reports.length === 0 ? (
              <EmptyState
                icon={<InboxIcon className="size-8" />}
                title="No reports yet."
                body="Concerns you submit appear here with live status updates."
              />
            ) : (
              <EmptyState
                title={`No ${activeFilter.toLowerCase()} reports found.`}
              />
            )}
          </div>
        )}
      </div>
      {canLoadMore && ranked.length > 0 ? (
        <div className="flex shrink-0 items-center justify-between border-t border-neutral-100 px-4 py-2.5">
          <span className="text-[11.5px] text-neutral-500">
            {ranked.length} shown
          </span>
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-40"
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      ) : null}
    </div>
  )

  const detailPane = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 px-0 pt-0 pb-0 lg:px-4 lg:pt-3 lg:pb-4">
        {current ? (
          <div className="flex h-full min-h-0 flex-col overflow-hidden bg-transparent lg:rounded-[24px] lg:bg-white lg:ring-1 lg:ring-neutral-200">
            <ReportDetailHeader
              report={current}
              audience="resident"
              onPublish={onPublish}
            />

            <div className="min-h-0 flex-1 px-0 pt-3 pb-0 lg:px-4 lg:pb-4">
              <ReportChatPanel
                key={`resident-chat-${current.id}`}
                concernId={current.id}
                open
                showHistory
                plain
                disabled={closedCase}
                emptyMessage="Message the barangay team about this report — questions, extra photos, or access details stay here."
                appeals={current.appeals ?? []}
                canFileAppeal={canFileAppeal}
                onAppealsChanged={onRefresh}
                onMessageSent={onRefresh}
                className="h-full"
              />
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center rounded-[24px] bg-white ring-1 ring-neutral-300">
            <EmptyState
              icon={<InboxIcon className="size-8" />}
              title="Select a report"
              body="Open one from your list to see its conversation."
            />
          </div>
        )}
      </div>
    </div>
  )

  const panes: OpsPaneSpec[] = [
    {
      id: "queue",
      role: "list",
      initial: 380,
      min: 300,
      max: 760,
      label: "My reports",
      node: queuePane,
    },
    {
      id: "record",
      role: "detail",
      min: 460,
      label: "Report conversation",
      node: detailPane,
    },
  ]

  panes.push({
    id: "action",
    role: "aside",
    initial: 380,
    min: 300,
    max: 720,
    label: "Updates & details",
    className: "overflow-hidden bg-white",
    node: current ? (
      <ReportUpdatesPane
        report={current}
        onOpenProof={(items, index) => setProofPreview({ items, index })}
      />
    ) : (
      <div className="flex h-full min-h-0 flex-1 items-center justify-center">
        <EmptyState
          icon={<InboxIcon className="size-8" />}
          title="No report selected"
          body="Updates, location, and your submission appear here."
        />
      </div>
    ),
  })

  return (
    <>
      {proofPreview ? (
        <MediaLightbox
          items={proofPreview.items}
          index={proofPreview.index}
          onClose={() => setProofPreview(null)}
        />
      ) : null}
      <OpsWorkspace
        id="resident-concerns"
        mobileView="list"
        asideOpen={asideOpen}
        onAsideOpenChange={setAsideOpen}
        onMobileDetailClose={onBack}
        panes={panes}
        fullHeightAside
        fullHeightDetail={Boolean(current)}
        className="ops-plain bg-transparent"
        onListResize={setQueueWidth}
        bar={
          <header className="relative flex h-16 shrink-0 items-center justify-between gap-4 px-4">
            <label
              className="flex h-12 flex-1 items-center gap-2 rounded-full bg-white pr-1.5 pl-4 ring-1 ring-neutral-300 focus-within:ring-2 focus-within:ring-neutral-500 focus-within:ring-offset-2 lg:flex-none"
              style={{
                width: isLgUp
                  ? queueWidth
                    ? Math.max(queueWidth - 32, 240)
                    : 300
                  : undefined,
              }}
            >
              <SearchIcon
                className="size-5 shrink-0 text-neutral-600"
                aria-hidden="true"
              />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search my reports"
                className="min-w-0 flex-1 bg-transparent text-[13px] font-medium text-foreground outline-none placeholder:text-neutral-500"
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
                    : "text-neutral-600 hover:text-foreground",
                  "focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:ring-offset-1 focus-visible:outline-none"
                )}
              >
                <SlidersHorizontalIcon className="size-5" />
              </button>
            </label>
            {filterOpen ? filterDropdown : null}
          </header>
        }
      />

      {/* Mobile: SheetDialog overlays on top of the list when a report is selected */}
      {!isLgUp && hasExplicitSelection && current ? (
        <MobileReportDetailPage
          report={current}
          onBack={onBack}
          onRefresh={onRefresh}
          onPublish={onPublish}
        />
      ) : null}
    </>
  )
}
