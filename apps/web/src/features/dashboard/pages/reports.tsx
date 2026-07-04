import { useEffect, useRef, useState } from "react"
import {
  ArrowUpIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  ClockIcon,
  FileTextIcon,
  GripHorizontalIcon,
  ImageIcon,
  MapPinIcon,
  Share2Icon,
} from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"

import {
  listMyConcerns,
  type Concern,
  type ConcernCategory,
  type ConcernStatus,
  type ConcernStatusEvent,
} from "@/features/dashboard/api"
import { Topbar } from "@/features/dashboard/components/topbar"
import { usePageTitle } from "@/hooks/use-page-title"

const filters = ["All", "Active", "Resolved", "Rejected", "Appealed"] as const

const activeStatuses: ConcernStatus[] = ["submitted", "under_review", "in_progress"]

const statusColors: Record<string, string> = {
  Active: "bg-blue-100 text-blue-700 border-blue-200",
  Resolved: "bg-green-100 text-green-700 border-green-200",
  Rejected: "bg-red-100 text-red-700 border-red-200",
  Appealed: "bg-orange-100 text-orange-700 border-orange-200",
}

const timelineDotColors: Record<string, string> = {
  Submitted: "bg-blue-500",
  "Under Review": "bg-amber-500",
  "In Progress": "bg-blue-500",
  Resolved: "bg-green-500",
  Rejected: "bg-red-500",
  Appealed: "bg-orange-500",
}

const categoryLabels: Record<ConcernCategory, string> = {
  infrastructure: "Infrastructure",
  environment: "Environment",
  public_safety: "Public Safety",
  others: "Others",
}

function statusLabel(status: ConcernStatus) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
}

function statusGroup(status: ConcernStatus) {
  if (activeStatuses.includes(status)) return "Active"
  return statusLabel(status)
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value))
}

function formatEventTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

function daysAgo(value: string) {
  const diffMs = Date.now() - new Date(value).getTime()
  return Math.max(0, Math.floor(diffMs / 86400000))
}

function filterReports(reports: Concern[], filter: string) {
  if (filter === "All") return reports
  return reports.filter((report) => statusGroup(report.status) === filter)
}

function reportUpdate(report: Concern) {
  return report.update_text || report.status_events.at(-1)?.note || "Your report was received."
}

function ReportMedia({ report }: { report: Concern }) {
  const media = report.media[0]

  if (!media) {
    return (
      <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border bg-muted/50">
        <div className="flex flex-col items-center gap-1 text-muted-foreground">
          <ImageIcon className="size-5" />
          <span className="text-xs">Photo evidence</span>
        </div>
      </div>
    )
  }

  if (media.mime_type.startsWith("image/")) {
    return (
      <img
        src={media.preview_url}
        alt={media.original_filename}
        className="h-24 w-full rounded-lg border border-border object-cover"
      />
    )
  }

  return (
    <a
      href={media.raw_url}
      target="_blank"
      rel="noreferrer"
      className="flex h-24 items-center justify-center gap-2 rounded-lg border border-border bg-muted/50 px-3 text-xs text-muted-foreground hover:text-primary"
    >
      <FileTextIcon className="size-5" />
      <span className="truncate">{media.original_filename}</span>
    </a>
  )
}

function Timeline({ report }: { report: Concern }) {
  const events: ConcernStatusEvent[] = report.status_events.length
    ? report.status_events
    : [
        {
          id: 0,
          status: report.status,
          note: reportUpdate(report),
          actor: report.reporter,
          created_at: report.created_at,
        },
      ]

  return (
    <div className="relative mt-2 space-y-0">
      {events.map((step, i) => {
        const label = statusLabel(step.status)
        const isLast = i === events.length - 1
        const dotColor = timelineDotColors[label] ?? "bg-muted-foreground"
        return (
          <div key={`${step.id}-${step.status}`} className="flex gap-2">
            <div className="flex flex-col items-center">
              <div className={cn("flex size-4 shrink-0 items-center justify-center rounded-full", dotColor, isLast && activeStatuses.includes(report.status) && "animate-pulse")} />
              {!isLast && <div className="mt-0.5 w-0.5 flex-1 rounded-full bg-border" />}
            </div>
            <div className={cn("flex-1 pb-3", isLast && "pb-0")}>
              <p className="text-xs font-medium text-foreground">{label}</p>
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span>{formatEventTime(step.created_at)}</span>
                {step.actor ? (
                  <>
                    <span>&middot;</span>
                    <span>{step.actor.full_name}</span>
                  </>
                ) : null}
              </div>
              {step.note ? <p className="mt-0.5 text-xs text-muted-foreground">{step.note}</p> : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function ReportsPage() {
  usePageTitle("Reports")
  const filterRailRef = useRef<HTMLDivElement>(null)
  const [loaded, setLoaded] = useState(false)
  const [activeFilter, setActiveFilter] = useState<string>("All")
  const [selectedReport, setSelectedReport] = useState<number | null>(null)
  const [timelineExpanded, setTimelineExpanded] = useState(true)
  const [reports, setReports] = useState<Concern[]>([])
  const [error, setError] = useState("")

  async function loadReports() {
    setLoaded(false)
    setError("")
    try {
      setReports(await listMyConcerns())
    } catch {
      setError("Could not load your reports.")
    } finally {
      setLoaded(true)
    }
  }

  useEffect(() => {
    void loadReports()
    function refresh() {
      void loadReports()
    }
    window.addEventListener("eboses:report-created", refresh)
    return () => window.removeEventListener("eboses:report-created", refresh)
  }, [])

  if (!loaded)
    return (
      <div className="flex min-h-svh flex-col">
        <Topbar />
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
  const selected =
    reports.find((report) => report.id === selectedReport) ?? filtered[0]

  function scrollFilterRail(direction: -1 | 1) {
    const rail = filterRailRef.current
    const buttons = Array.from(
      rail?.querySelectorAll<HTMLButtonElement>("[data-filter-option]") ?? [],
    )

    if (!rail || buttons.length === 0) return

    const currentIndex = buttons.findIndex(
      (button) => button.offsetLeft + button.offsetWidth > rail.scrollLeft + 4,
    )
    const fallbackIndex = direction > 0 ? 0 : buttons.length - 1
    const targetIndex = Math.min(
      buttons.length - 1,
      Math.max(0, (currentIndex === -1 ? fallbackIndex : currentIndex) + direction * 2),
    )

    rail.scrollTo({
      left: buttons[targetIndex].offsetLeft - buttons[0].offsetLeft,
      behavior: "smooth",
    })
  }

  return (
    <div className="flex min-h-svh flex-col">
      <Topbar />

      <div className="flex-1 p-4 md:p-10">
        <div className="rounded-2xl bg-primary px-6 py-4">
          <p className="text-xs text-[#020c4e]/70">Marikina Heights</p>
          <h1 className="font-heading text-2xl font-bold text-[#020c4e] md:text-3xl">
            My Reports
          </h1>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-5">
          <section className="flex min-w-0 flex-col gap-4 lg:col-span-3">
            <div className="relative w-full min-w-0">
              <button
                type="button"
                aria-label="Scroll filters left"
                onClick={() => scrollFilterRail(-1)}
                className="absolute left-0 top-1/2 z-10 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
              >
                <ChevronLeftIcon className="size-4" />
              </button>

              <div
                ref={filterRailRef}
                className="scrollbar-hide mx-10 min-w-0 overflow-x-hidden lg:mx-0 lg:overflow-visible"
              >
                <div className="flex min-w-max flex-nowrap gap-2 lg:grid lg:min-w-0 lg:grid-cols-5">
                  {filters.map((filter) => (
                    <Button
                      key={filter}
                      data-filter-option
                      type="button"
                      size="sm"
                      variant={activeFilter === filter ? "default" : "outline"}
                      aria-pressed={activeFilter === filter}
                      onClick={() => setActiveFilter(filter)}
                      className={cn("h-8 shrink-0 rounded-full px-3 text-xs whitespace-nowrap lg:w-full lg:min-w-0 lg:shrink", activeFilter !== filter && "bg-card")}
                    >
                      {filter}
                    </Button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                aria-label="Scroll filters right"
                onClick={() => scrollFilterRail(1)}
                className="absolute right-0 top-1/2 z-10 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
              >
                <ChevronRightIcon className="size-4" />
              </button>
            </div>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}

            <Card className="flex flex-col gap-0 overflow-hidden py-0">
              <div className="flex flex-col">
                {filtered.map((report, i) => {
                  const group = statusGroup(report.status)
                  return (
                    <button
                      key={report.id}
                      type="button"
                      onClick={() => setSelectedReport(report.id)}
                      className={cn(
                        "flex w-full items-center justify-between bg-card p-3 text-left transition-colors hover:bg-muted/50",
                        selected?.id === report.id && "bg-primary/5",
                        i < filtered.length - 1 && "border-b border-border/50",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-semibold text-foreground">
                            {report.title}
                          </p>
                          <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", statusColors[group])}>
                            {group}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {report.tracking_id} &middot; {categoryLabels[report.category]} &middot; {formatDate(report.created_at)}
                        </p>
                      </div>
                      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
                    </button>
                  )
                })}
                {filtered.length === 0 ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">
                    No reports match this filter.
                  </div>
                ) : null}
              </div>

              <div className="flex items-center justify-between border-t border-border/50 px-3 py-2.5">
                <p className="text-xs text-muted-foreground">
                  Showing {filtered.length} of {reports.length} reports
                </p>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="flex size-7 items-center justify-center rounded-md border border-border bg-card text-xs text-muted-foreground disabled:opacity-40"
                    disabled
                  >
                    <ChevronLeftIcon className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className="flex size-7 items-center justify-center rounded-md border border-primary bg-primary text-xs font-semibold text-primary-foreground"
                  >
                    1
                  </button>
                  <button
                    type="button"
                    className="flex size-7 items-center justify-center rounded-md border border-border bg-card text-xs text-muted-foreground disabled:opacity-40"
                    disabled
                  >
                    <ChevronRightIcon className="size-3.5" />
                  </button>
                </div>
              </div>
            </Card>
          </section>

          <aside className="hidden flex-col lg:col-span-2 lg:sticky lg:top-10 lg:flex">
            {selected ? (
              <Card>
                <CardHeader className="flex flex-row items-start justify-between gap-2 px-3 pb-1 pt-1.5">
                  <div className="min-w-0 flex-1">
                    <CardTitle className="text-sm">{selected.title}</CardTitle>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      <MapPinIcon className="mr-0.5 inline size-2.5 align-text-bottom" />
                      {selected.address || selected.barangay}
                    </p>
                  </div>
                  <span className={cn("shrink-0 self-start rounded-full border px-2 py-0.5 text-xs font-medium", statusColors[statusGroup(selected.status)])}>
                    {statusGroup(selected.status)}
                  </span>
                </CardHeader>

                <div className="border-t border-border/50" />

                <div className="px-3 py-1">
                  <ReportMedia report={selected} />
                </div>

                <div className="mx-3 border-t border-border/50" />

                <div className="px-3 py-1">
                  <p className="text-xs font-medium uppercase text-muted-foreground">Description</p>
                  <p className="mt-1 text-xs leading-relaxed text-foreground">{selected.description}</p>
                  <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <ClockIcon className="size-3" />
                    <span>Submitted {daysAgo(selected.created_at)} days ago &middot; {formatDate(selected.created_at)}</span>
                  </div>
                </div>

                <div className="mx-3 border-t border-border/50" />

                <div className="flex items-center justify-between px-3 py-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <Share2Icon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate text-xs text-foreground">Shared to community feed</span>
                    <Badge variant={selected.visibility === "community" ? "default" : "secondary"} className="shrink-0 text-xs px-1 py-0">
                      {selected.visibility === "community" ? "Public" : "Private"}
                    </Badge>
                  </div>
                  {selected.visibility === "community" && (
                    <div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                      <ArrowUpIcon className="size-3.5" />
                      <span>{selected.vote_count}</span>
                    </div>
                  )}
                </div>

                <div className="mx-3 border-t border-border/50" />

                <div className="px-3 py-1">
                  <button
                    type="button"
                    onClick={() => setTimelineExpanded(!timelineExpanded)}
                    className="flex w-full items-center justify-between"
                  >
                    <p className="text-xs font-semibold text-foreground">Status Timeline</p>
                    {timelineExpanded ? <ChevronUpIcon className="size-3.5 text-muted-foreground" /> : <ChevronDownIcon className="size-3.5 text-muted-foreground" />}
                  </button>
                  {timelineExpanded && <Timeline report={selected} />}
                </div>
              </Card>
            ) : (
              <Card className="flex h-full min-h-[300px] items-center justify-center">
                <CardContent>
                  <p className="text-center text-sm text-muted-foreground">
                    No reports match this filter.
                  </p>
                </CardContent>
              </Card>
            )}
          </aside>
        </div>
      </div>

      {selectedReport && selected ? (
        <div className="fixed inset-0 z-[200] md:hidden" onClick={() => setSelectedReport(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="absolute bottom-0 left-0 right-0 flex max-h-[55vh] flex-col rounded-t-2xl border border-border/50 bg-background shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 justify-center pt-2 pb-1">
              <GripHorizontalIcon className="size-5 text-muted-foreground/60" />
            </div>
            <div className="flex-1 overflow-y-auto px-4 pb-6">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">{selected.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    <MapPinIcon className="mr-0.5 inline size-2.5 align-text-bottom" />
                    {selected.address || selected.barangay}
                  </p>
                </div>
                <span className={cn("shrink-0 self-start rounded-full border px-2 py-0.5 text-xs font-medium", statusColors[statusGroup(selected.status)])}>
                  {statusGroup(selected.status)}
                </span>
              </div>

              <ReportMedia report={selected} />

              <div className="mt-3 space-y-3">
                <div>
                  <p className="text-xs font-medium uppercase text-muted-foreground">Description</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-foreground">{selected.description}</p>
                </div>

                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ClockIcon className="size-3" />
                  <span>Submitted {daysAgo(selected.created_at)} days ago</span>
                </div>

                <div className="flex items-center justify-between border-t border-border/50 pt-2">
                  <div className="flex items-center gap-1.5">
                    <Share2Icon className="size-3.5 text-muted-foreground" />
                    <span className="text-xs text-foreground">Shared to feed</span>
                    <Badge variant={selected.visibility === "community" ? "default" : "secondary"} className="text-xs px-1 py-0">
                      {selected.visibility === "community" ? "Public" : "Private"}
                    </Badge>
                  </div>
                  {selected.visibility === "community" && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <ArrowUpIcon className="size-3.5" />
                      <span>{selected.vote_count}</span>
                    </div>
                  )}
                </div>

                <div className="border-t border-border/50 pt-2">
                  <p className="mb-2 text-xs font-semibold text-foreground">Status Timeline</p>
                  <Timeline report={selected} />
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
