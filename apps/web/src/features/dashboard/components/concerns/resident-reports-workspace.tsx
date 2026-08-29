import { useMemo, useState } from "react"
import { toast } from "sonner"
import {
  CircleCheck,
  CircleX,
  ClockIcon,
  CopyIcon,
  FileIcon,
  InboxIcon,
  MapPinIcon,
  PlayIcon,
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
import { ConcernQueueItem, avatarTone, concernReporterName, initialsOf } from "@/features/dashboard/components/concerns/concern-queue-item"
import {
  categoryLabels,
  filters,
  unitShortTag,
} from "@/features/dashboard/components/concerns/concern-display"
import { ConcernTimeline } from "@/features/dashboard/components/concerns/concern-timeline"
import { buildConcernTimelineEntries } from "@/features/dashboard/components/concerns/concern-timeline-lib"
import { ReportChatPanel } from "@/features/dashboard/components/report-chat-panel"
import { ReportLocationMap } from "@/features/dashboard/components/report-location-map"
import { EmptyState } from "@/features/dashboard/components/record/empty-state"
import {
  concernSeverityOf,
  type RankedConcern,
} from "@/features/dashboard/components/record/concern-adapter"
import {
  MediaLightbox,
  AuthenticatedMediaImage,
} from "@/features/dashboard/components/authenticated-media"
import {
  mediaDisplaySource,
  toMediaPreviewItem,
  type MediaPreviewItem,
} from "@/features/dashboard/lib/authenticated-media"
import { streetOnly } from "@/features/dashboard/lib/location-text"
import { statusLabelOf } from "@/features/dashboard/lib/status-vocabulary"
import { useIsDesktop } from "@/features/dashboard/lib/shell"

export function filterResidentReports(reports: Concern[], filter: string) {  if (filter === "All") return reports
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

function searchResidentReports(reports: Concern[], query: string) {
  const q = query.trim().toLowerCase()
  if (!q) return reports
  return reports.filter((report) =>
    [
      report.tracking_id,
      report.title,
      report.description,
      report.address,
      report.category_ref?.name ?? categoryLabels[report.category],
    ].some((v) => v?.toLowerCase().includes(q)),
  )
}

const residentFilterMeta: Record<string, { icon: typeof ClockIcon; bg: string; subtext: string }> = {
  All: { icon: UsersIcon, bg: "bg-neutral-700", subtext: "All reports" },
  Active: { icon: ClockIcon, bg: "bg-brand-orange", subtext: "Being handled" },
  Resolved: { icon: CircleCheck, bg: "bg-emerald-600", subtext: "Fixed issues" },
  Rejected: { icon: CircleX, bg: "bg-red-500", subtext: "Not accepted" },
  Appealed: { icon: ScaleIcon, bg: "bg-amber-500", subtext: "Under review" },
}

function submittedAt(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date)
}

async function copyTrackingId(report: Concern) {
  await navigator.clipboard?.writeText(report.tracking_id)
  toast.success("Tracking ID copied")
}

function UpdatesPane({
  report,
  onOpenProof,
}: {
  report: Concern
  onOpenProof: (items: MediaPreviewItem[], index: number) => void
}) {
  const timeline = buildConcernTimelineEntries(report, onOpenProof)
  const resolutionEvidence = report.resolution_evidence ?? []
  const proofItems = resolutionEvidence.map((evidence) =>
    toMediaPreviewItem(mediaDisplaySource(evidence), evidence.original_filename, evidence.mime_type),
  )

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 bg-white px-4 pb-4 pt-4">
      <section className="flex min-h-0 flex-col rounded-[24px] bg-white p-4 ring-1 ring-neutral-200">
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ClockIcon className="size-4 text-neutral-500" />
            <h3 className="text-[14px] font-medium text-neutral-800">Updates</h3>
          </div>
          <button
            type="button"
            onClick={() => void copyTrackingId(report)}
            title="Copy tracking ID"
            className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-faint-foreground transition-colors hover:bg-neutral-100 hover:text-neutral-700"
          >
            {report.tracking_id}
            <CopyIcon className="size-3" />
          </button>
        </div>
        <p className="text-[11px] text-neutral-400">Every status change and update on your report.</p>
        <div className="scrollbar-hide mt-3 max-h-[clamp(12rem,42vh,32rem)] overflow-y-auto overscroll-contain pr-1">
          <ConcernTimeline key={report.id} items={timeline} collapsibleHistory />
        </div>
      </section>

      {resolutionEvidence.length ? (
        <section className="shrink-0 rounded-[24px] bg-white p-4 ring-1 ring-neutral-200">
          <div className="mb-2 flex items-center gap-2">
            <CircleCheck className="size-4 text-emerald-600" />
            <h3 className="text-[14px] font-medium text-neutral-800">Resolution proof</h3>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {resolutionEvidence.map((evidence, index) =>
              evidence.mime_type.startsWith("image/") ? (
                <button
                  key={evidence.id}
                  type="button"
                  onClick={() => onOpenProof(proofItems, index)}
                  className="overflow-hidden rounded-xl border border-neutral-200 bg-white transition-colors hover:border-neutral-400"
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
                  onClick={() => onOpenProof(proofItems, index)}
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
        </section>
      ) : null}

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
    </div>
  )
}

export function ResidentReportsWorkspace({
  reports,
  selected,
  activeFilter,
  setActiveFilter,
  search,
  setSearch,
  onSelect,
  onBack,
  onRefresh,
  onLoadMore,
  loadingMore,
  canLoadMore,
  error,
}: {
  reports: Concern[]
  selected: Concern | null
  activeFilter: string
  setActiveFilter: (filter: string) => void
  search: string
  setSearch: (value: string) => void
  onSelect: (report: Concern) => void
  onBack: () => void
  onRefresh: () => Promise<void>
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
  const [proofPreview, setProofPreview] = useState<{ items: MediaPreviewItem[]; index: number } | null>(null)

  const visible = useMemo(
    () => searchResidentReports(filterResidentReports(reports, activeFilter), search),
    [reports, activeFilter, search],
  )

  const ranked = useMemo<RankedConcern[]>(
    () => visible.map((concern) => ({ concern, ...concernSeverityOf(concern), priority: 0 })),
    [visible],
  )

  const counts = useMemo(() => {
    const map: Record<string, number> = {}
    for (const filter of filters) map[filter] = filterResidentReports(reports, filter).length
    return map
  }, [reports])

  const hasExplicitSelection = Boolean(selected)
  const current = selected ?? ranked[0]?.concern ?? null
  const closedCase = current ? ["rejected", "appealed", "resolved"].includes(current.status) : false
  const isOwnReport = current ? user?.id === current.reporter?.id : false
  const canFileAppeal = Boolean(
    current &&
    isOwnReport &&
    ["rejected", "resolved"].includes(current.status) &&
    !(current.appeals ?? []).some((appeal) => appeal.status === "submitted"),
  )

  const fullName = current ? concernReporterName(current) : ""
  const initials = current ? (current.reporter?.initials || initialsOf(fullName)).charAt(0) : ""
  const unit = current ? current.assigned_department ?? current.community_incident?.assigned_unit ?? null : null
  const unitTag = unitShortTag(unit)
  const unitRole =
    unit?.description?.trim() ||
    current?.category_ref?.description?.trim() ||
    "No unit description"

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
        className="absolute left-4 top-[64px] z-30 overflow-hidden rounded-[20px] bg-white p-1.5 shadow-lg ring-1 ring-neutral-200"
        style={{ width: queueWidth ? Math.max(queueWidth - 32, 240) : 300 }}
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
              className="flex w-full items-center gap-3 rounded-[12px] px-4 py-2.5 text-left text-[15px] transition hover:bg-neutral-50"
            >
              <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-md text-white ring-1 ring-black/10", meta.bg)}>
                <Icon className="size-3.5" strokeWidth={1.7} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-neutral-900">{filter}</span>
                <span className="block text-[13px] text-neutral-500">{meta.subtext} · {counts[filter] ?? 0}</span>
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
          <div className="rounded-[24px] bg-white p-6 ring-1 ring-neutral-200">
            {activeFilter === "All" && !search.trim() && reports.length === 0 ? (
              <EmptyState
                icon={<InboxIcon className="size-8" />}
                title="No reports yet."
                body="Concerns you submit appear here with live status updates."
              />
            ) : (
              <EmptyState title={`No ${activeFilter.toLowerCase()} reports found.`} />
            )}
          </div>
        )}
      </div>
      {canLoadMore && ranked.length > 0 ? (
        <div className="flex shrink-0 items-center justify-between border-t border-neutral-100 px-4 py-2.5">
          <span className="text-[11.5px] text-faint-foreground">{ranked.length} shown</span>
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
      <div className="min-h-0 flex-1 px-0 pb-0 pt-0 lg:px-4 lg:pb-4 lg:pt-3">
        {current ? (
          <div className="flex h-full min-h-0 flex-col overflow-hidden bg-transparent lg:rounded-[24px] lg:bg-white lg:ring-1 lg:ring-neutral-200">
            <div className="shrink-0 px-0 pt-0 lg:px-6 lg:pt-5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] font-normal text-subtle-foreground">
                  {statusLabelOf(current.status)}
                </span>
                <span className="text-[13px] font-normal text-faint-foreground">
                  {submittedAt(current.created_at)}
                </span>
              </div>

              <div className="mt-4 flex flex-col items-center text-center">
                <span
                  className={cn(
                    "flex size-14 items-center justify-center rounded-full px-1 text-center leading-none",
                    avatarTone,
                    unit ? "text-[13px] font-bold" : "text-[18px] font-bold",
                  )}
                >
                  {unit ? unitTag : initials}
                </span>
                <p className="mt-2 text-[17px] font-bold leading-tight text-foreground">
                  {unit ? unit.name : fullName}
                </p>
                <p className="text-[12px] text-faint-foreground">
                  {unit ? unitRole : "Resident"}
                </p>
              </div>
            </div>

            <div className="min-h-0 flex-1 px-0 pb-0 pt-3 lg:px-4 lg:pb-4">
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
          <div className="flex h-full items-center justify-center rounded-[24px] bg-white ring-1 ring-neutral-200">
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
      <UpdatesPane
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
        mobileView={hasExplicitSelection ? "detail" : "list"}
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
              className="flex h-12 flex-1 items-center gap-2 rounded-full bg-white pl-4 pr-1.5 ring-1 ring-neutral-200 md:flex-none"
              style={{ width: isLgUp ? (queueWidth ? Math.max(queueWidth - 32, 240) : 300) : undefined }}
            >
              <SearchIcon className="size-5 shrink-0 text-faint-foreground" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search my reports"
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
