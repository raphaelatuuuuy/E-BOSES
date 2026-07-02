import { useEffect, useRef, useState } from "react"
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  ClockIcon,
  ImageIcon,
  MapPinIcon,
  Share2Icon,
  ArrowUpIcon,
  GripHorizontalIcon,
} from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { cn } from "@workspace/ui/lib/utils"

import { Skeleton } from "@workspace/ui/components/skeleton"
import { usePageTitle } from "@/hooks/use-page-title"
import { Topbar } from "@/features/dashboard/components/topbar"

const filters = ["All", "Active", "Resolved", "Rejected", "Appealed"] as const

const sampleReports = [
  {
    id: "RPT-001",
    title: "Pothole on Bayan-Bayanan St.",
    status: "Active",
    date: "Jun 28, 2026",
    type: "Infrastructure",
    update: "Queued for barangay engineering inspection.",
    description: "Malaking butas sa kalsada malapit sa may pedestrian lane. Delikado lalo na sa gabi dahil walang ilaw. Ilang beses na pong may muntikang maaksidente.",
    address: "Bayan-Bayanan St., Brgy. Marikina Heights",
    daysAgo: 2,
    upvotes: 12,
    shared: true,
    timeline: [
      { status: "Submitted", time: "Jun 28, 8:15 AM", user: "You", done: true },
      { status: "Under Review", time: "Jun 29, 9:00 AM", user: "Barangay Staff", done: true },
      { status: "In Progress", time: "", user: "", done: false, current: true },
      { status: "Resolved", time: "", user: "", done: false },
    ],
  },
  {
    id: "RPT-002",
    title: "Flooding near Marikina River",
    status: "Active",
    date: "Jun 27, 2026",
    type: "Environment",
    update: "Forwarded to the disaster response desk for monitoring.",
    description: "Mataas na ang tubig sa ilog malapit sa may Riverside. Need po ng monitoring lalo na kung uulan pa.",
    address: "Riverside St., Brgy. Marikina Heights",
    daysAgo: 3,
    upvotes: 24,
    shared: true,
    timeline: [
      { status: "Submitted", time: "Jun 27, 10:30 AM", user: "You", done: true },
      { status: "Under Review", time: "Jun 28, 1:00 PM", user: "Barangay Staff", done: true },
      { status: "In Progress", time: "Jun 29, 8:00 AM", user: "BDRRMO", done: true },
      { status: "Resolved", time: "", user: "", done: false, current: true },
    ],
  },
  {
    id: "RPT-003",
    title: "Broken streetlight on J.P. Rizal",
    status: "Resolved",
    date: "Jun 20, 2026",
    type: "Infrastructure",
    update: "Streetlight replacement was completed by maintenance.",
    description: "Sirado ang poste ng ilaw sa may kanto ng J.P. Rizal at Bayan-Bayanan. Madilim sa gabi at delikado sa mga naglalakad.",
    address: "J.P. Rizal St., Brgy. Marikina Heights",
    daysAgo: 10,
    upvotes: 8,
    shared: false,
    timeline: [
      { status: "Submitted", time: "Jun 20, 6:00 PM", user: "You", done: true },
      { status: "Under Review", time: "Jun 21, 8:30 AM", user: "Barangay Staff", done: true },
      { status: "In Progress", time: "Jun 22, 9:00 AM", user: "Maintenance", done: true },
      { status: "Resolved", time: "Jun 25, 4:00 PM", user: "Barangay Staff", done: true },
    ],
  },
  {
    id: "RPT-004",
    title: "Noise complaint - construction",
    status: "Rejected",
    date: "Jun 15, 2026",
    type: "Public Safety",
    update: "Rejected because the reported work had a valid permit.",
    description: "Maingay po ang construction sa kabilang kalsada simula alas-5 ng umaga. Hindi po makatulog ang mga residente.",
    address: "Construction site, Bayan-Bayanan Ext., Brgy. Marikina Heights",
    daysAgo: 15,
    upvotes: 0,
    shared: false,
    timeline: [
      { status: "Submitted", time: "Jun 15, 5:30 AM", user: "You", done: true },
      { status: "Under Review", time: "Jun 15, 10:00 AM", user: "Barangay Staff", done: true },
      { status: "Rejected", time: "Jun 16, 2:00 PM", user: "Barangay Staff", done: true },
    ],
  },
  {
    id: "RPT-005",
    title: "Illegal dumping in vacant lot",
    status: "Appealed",
    date: "Jun 10, 2026",
    type: "Environment",
    update: "Appeal submitted for barangay review.",
    description: "May nagtatapon ng basura sa bakanteng lote sa may likod ng paaralan. Paano po ito maaaksyunan?",
    address: "Vacant lot, School Rd., Brgy. Marikina Heights",
    daysAgo: 20,
    upvotes: 5,
    shared: true,
    timeline: [
      { status: "Submitted", time: "Jun 10, 2:00 PM", user: "You", done: true },
      { status: "Under Review", time: "Jun 11, 9:00 AM", user: "Barangay Staff", done: true },
      { status: "Rejected", time: "Jun 14, 11:00 AM", user: "Barangay Staff", done: true },
      { status: "Appealed", time: "Jun 16, 8:00 AM", user: "You", done: true, current: true },
    ],
  },
]

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

export default function ReportsPage() {
  usePageTitle("Reports")
  const filterRailRef = useRef<HTMLDivElement>(null)
  const [loaded, setLoaded] = useState(false)
  const [activeFilter, setActiveFilter] = useState<string>("All")
  const [selectedReport, setSelectedReport] = useState<string | null>(null)
  const [timelineExpanded, setTimelineExpanded] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => setLoaded(true), 600)
    return () => clearTimeout(timer)
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

  const filtered =
    activeFilter === "All"
      ? sampleReports
      : sampleReports.filter((report) => report.status === activeFilter)
  const selected =
    sampleReports.find((report) => report.id === selectedReport) ?? filtered[0]

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
          {/* Left: Filters + Report list */}
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

            <Card className="flex flex-col gap-0 overflow-hidden py-0">
              <div className="flex flex-col">
                {filtered.map((report, i) => (
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
                        <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", statusColors[report.status])}>
                          {report.status}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {report.id} &middot; {report.type} &middot; {report.date}
                      </p>
                    </div>
                    <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                ))}
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between border-t border-border/50 px-3 py-2.5">
                <p className="text-xs text-muted-foreground">
                  Page 1 of 3
                </p>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="flex size-7 items-center justify-center rounded-md border border-border bg-card text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-40"
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
                    className="flex size-7 items-center justify-center rounded-md border border-border bg-card text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                  >
                    2
                  </button>
                  <button
                    type="button"
                    className="flex size-7 items-center justify-center rounded-md border border-border bg-card text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                  >
                    3
                  </button>
                  <button
                    type="button"
                    className="flex size-7 items-center justify-center rounded-md border border-border bg-card text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                  >
                    <ChevronRightIcon className="size-3.5" />
                  </button>
                </div>
              </div>
            </Card>
          </section>

          {/* Right: Detail view */}
          <aside className="hidden flex-col lg:col-span-2 lg:sticky lg:top-10 lg:flex">
            {selected ? (
              <Card>
                {/* Header with title + status */}
                <CardHeader className="flex flex-row items-start justify-between gap-2 px-3 pb-1 pt-1.5">
                  <div className="min-w-0 flex-1">
                    <CardTitle className="text-sm">{selected.title}</CardTitle>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      <MapPinIcon className="mr-0.5 inline size-2.5 align-text-bottom" />
                      {selected.address}
                    </p>
                  </div>
                  <span className={cn("shrink-0 self-start rounded-full border px-2 py-0.5 text-xs font-medium", statusColors[selected.status])}>
                    {selected.status}
                  </span>
                </CardHeader>

                <div className="border-t border-border/50" />

                {/* Image placeholder */}
                <div className="px-3 py-1">
                  <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border bg-muted/50">
                    <div className="flex flex-col items-center gap-1 text-muted-foreground">
                      <ImageIcon className="size-5" />
                      <span className="text-xs">Photo evidence</span>
                    </div>
                  </div>
                </div>

                <div className="mx-3 border-t border-border/50" />

                {/* Description */}
                <div className="px-3 py-1">
                  <p className="text-xs font-medium uppercase text-muted-foreground">Description</p>
                  <p className="mt-1 text-xs leading-relaxed text-foreground">{selected.description}</p>
                  <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <ClockIcon className="size-3" />
                    <span>Submitted {selected.daysAgo} days ago &middot; {selected.date}</span>
                  </div>
                </div>

                <div className="mx-3 border-t border-border/50" />

                {/* Sharing status */}
                <div className="flex items-center justify-between px-3 py-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Share2Icon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate text-xs text-foreground">Shared to community feed</span>
                    <Badge variant={selected.shared ? "default" : "secondary"} className="shrink-0 text-xs px-1 py-0">
                      {selected.shared ? "Public" : "Private"}
                    </Badge>
                  </div>
                  {selected.shared && (
                    <div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                      <ArrowUpIcon className="size-3.5" />
                      <span>{selected.upvotes}</span>
                    </div>
                  )}
                </div>

                <div className="mx-3 border-t border-border/50" />

                {/* Timeline */}
                <div className="px-3 py-1">
                  <button
                    type="button"
                    onClick={() => setTimelineExpanded(!timelineExpanded)}
                    className="flex w-full items-center justify-between"
                  >
                    <p className="text-xs font-semibold text-foreground">Status Timeline</p>
                    {timelineExpanded ? <ChevronUpIcon className="size-3.5 text-muted-foreground" /> : <ChevronDownIcon className="size-3.5 text-muted-foreground" />}
                  </button>
                  {timelineExpanded && (
                    <div className="relative mt-2 space-y-0">
                      {selected.timeline.map((step, i) => {
                        const isLast = i === selected.timeline.length - 1
                        const dotColor = timelineDotColors[step.status] ?? "bg-muted-foreground"
                        return (
                          <div key={step.status} className="flex gap-2">
                            <div className="flex flex-col items-center">
                              <div className={cn("flex size-4 shrink-0 items-center justify-center rounded-full", step.done || step.current ? dotColor : "bg-muted-foreground/30", step.current && "animate-pulse")} />
                              {!isLast && <div className="mt-0.5 w-0.5 flex-1 rounded-full bg-border" />}
                            </div>
                            <div className={cn("flex-1 pb-3", isLast && "pb-0")}>
                              <p className={cn("text-xs font-medium", step.done ? "text-foreground" : "text-muted-foreground")}>
                                {step.status}
                              </p>
                              {step.time && (
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                  <span>{step.time}</span>
                                  <span>&middot;</span>
                                  <span>{step.user}</span>
                                </div>
                              )}
                              {step.current && !step.time && (
                                <p className="mt-0.5 text-xs text-muted-foreground animate-pulse">{selected.update}</p>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
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

      {/* Mobile bottom sheet */}
      {selectedReport && (
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
                    {selected.address}
                  </p>
                </div>
                <span className={cn("shrink-0 self-start rounded-full border px-2 py-0.5 text-xs font-medium", statusColors[selected.status])}>
                  {selected.status}
                </span>
              </div>

              <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border bg-muted/50">
                <div className="flex flex-col items-center gap-1 text-muted-foreground">
                  <ImageIcon className="size-5" />
                  <span className="text-xs">Photo evidence</span>
                </div>
              </div>

              <div className="mt-3 space-y-3">
                <div>
                  <p className="text-xs font-medium uppercase text-muted-foreground">Description</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-foreground">{selected.description}</p>
                </div>

                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ClockIcon className="size-3" />
                  <span>Submitted {selected.daysAgo} days ago</span>
                </div>

                <div className="flex items-center justify-between border-t border-border/50 pt-2">
                  <div className="flex items-center gap-1.5">
                    <Share2Icon className="size-3.5 text-muted-foreground" />
                    <span className="text-xs text-foreground">Shared to feed</span>
                    <Badge variant={selected.shared ? "default" : "secondary"} className="text-xs px-1 py-0">
                      {selected.shared ? "Public" : "Private"}
                    </Badge>
                  </div>
                  {selected.shared && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <ArrowUpIcon className="size-3.5" />
                      <span>{selected.upvotes}</span>
                    </div>
                  )}
                </div>

                <div className="border-t border-border/50 pt-2">
                  <p className="mb-2 text-xs font-semibold text-foreground">Status Timeline</p>
                  <div className="space-y-0">
                    {selected.timeline.map((step, i) => {
                      const isLast = i === selected.timeline.length - 1
                      const dotColor = timelineDotColors[step.status] ?? "bg-muted-foreground"
                      return (
                        <div key={step.status} className="flex gap-2">
                          <div className="flex flex-col items-center">
                            <div className={cn("flex size-3.5 shrink-0 items-center justify-center rounded-full", step.done || step.current ? dotColor : "bg-muted-foreground/30", step.current && "animate-pulse")} />
                            {!isLast && <div className="mt-0.5 w-0.5 flex-1 rounded-full bg-border" />}
                          </div>
                          <div className="flex-1 pb-2.5">
                            <p className={cn("text-xs font-medium", step.done ? "text-foreground" : "text-muted-foreground")}>
                              {step.status}
                            </p>
                            {step.time && (
                              <div className="text-xs text-muted-foreground">
                                <span>{step.time} &middot; {step.user}</span>
                              </div>
                            )}
                            {step.current && !step.time && (
                              <p className="mt-0.5 text-xs text-muted-foreground animate-pulse">{selected.update}</p>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
