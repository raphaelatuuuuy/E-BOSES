import { ChevronRight, WrenchIcon, TreePineIcon, ShieldCheckIcon, FileQuestionIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { Link } from "react-router-dom"

import { Badge } from "@workspace/ui/components/badge"
import {
  Card,
} from "@workspace/ui/components/card"

import { Skeleton } from "@workspace/ui/components/skeleton"
import { usePageTitle } from "@/hooks/use-page-title"
import { useAuthSession } from "@/features/auth/auth-session"
import { Topbar } from "@/features/dashboard/components/topbar"
import { GreetingCard } from "@/features/dashboard/components/greeting-card"
import { CalendarBasic } from "@/features/dashboard/components/calendar-basic"
import {
  getDashboardSummary,
  listAnnouncements,
  listTodayBarangayEvents,
  type Announcement,
  type BarangayEvent,
  type Concern,
} from "@/features/dashboard/api"

function categoryLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
}

const categoryIcon: Record<string, React.ComponentType<{ className?: string }>> = {
  infrastructure: WrenchIcon,
  environment: TreePineIcon,
  public_safety: ShieldCheckIcon,
  others: FileQuestionIcon,
}

function statusLabel(value: string) {
  if (["submitted", "under_review", "in_progress", "appealed"].includes(value)) return "Active"
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value))
}

function HomeSkeleton() {
  return (
    <div className="flex-1 p-6 md:p-10">
      {/* Greeting skeleton */}
      <Skeleton className="h-48 w-full rounded-2xl md:h-72" />
      <div className="mt-6 grid gap-8 lg:grid-cols-5">
        <section className="flex flex-col gap-4 lg:col-span-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-7 w-36" />
            <Skeleton className="h-5 w-16" />
          </div>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-lg" />
          ))}
        </section>
        <aside className="flex flex-col gap-4 lg:col-span-2">
          <div className="flex items-center justify-between">
            <Skeleton className="h-7 w-44" />
            <Skeleton className="h-5 w-16" />
          </div>
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-52 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </aside>
      </div>
    </div>
  )
}

export default function HomePage() {
  usePageTitle("Home")
  const { loading: authLoading } = useAuthSession()
  const [loaded, setLoaded] = useState(false)
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [barangayEvents, setBarangayEvents] = useState<BarangayEvent[]>([])
  const [activeReports, setActiveReports] = useState<Concern[]>([])
  const [error, setError] = useState("")

  useEffect(() => {
    if (authLoading) return // wait for auth session to settle
    let cancelled = false
    async function loadHome() {
      setLoaded(false)
      setError("")
      try {
        const [nextAnnouncements, nextEvents, summary] = await Promise.all([
          listAnnouncements(),
          listTodayBarangayEvents(),
          getDashboardSummary(),
        ])
        if (cancelled) return
        setAnnouncements(nextAnnouncements)
        setBarangayEvents(nextEvents)
        setActiveReports(summary.active_reports)
      } catch {
        if (!cancelled) setError("Could not load dashboard data.")
      } finally {
        if (!cancelled) setLoaded(true)
      }
    }
    void loadHome()
    function refresh() { void loadHome() }
    window.addEventListener("eboses:report-created", refresh)
    return () => {
      cancelled = true
      window.removeEventListener("eboses:report-created", refresh)
    }
  }, [])

  if (!loaded)
    return (
      <div className="flex flex-col">
        <Topbar />
        <HomeSkeleton />
      </div>
    )

  return (
    <div className="flex flex-col">
      <Topbar />
      <div className="flex-1 overflow-x-hidden px-6 pb-6 md:px-10 md:pb-10">
        <GreetingCard />
        <div className="mt-6 grid gap-8 lg:grid-cols-5">
          {/* Left: Announcements column */}
          <section className="flex flex-col gap-4 lg:col-span-3 h-full">
            <div className="flex items-center gap-2">
              <h2 className="font-heading text-xl font-bold text-foreground">
                Announcements
              </h2>
              <div className="ml-auto">
                <Link
                  to="/dashboard/feed"
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary transition-colors hover:underline"
                >
                  View all
                  <ChevronRight className="size-3.5" />
                </Link>
              </div>
            </div>

            <div className="flex flex-1 flex-col gap-3">
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              {announcements.map((announcement) => (
                <div key={announcement.title} className="rounded-lg border border-border bg-card p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground break-words">
                        {announcement.title}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{announcement.date_label}</p>
                    </div>
                    <Badge variant="secondary" className="shrink-0">{announcement.tag}</Badge>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground break-words">
                    {announcement.body}
                  </p>
                </div>
              ))}
              {announcements.length === 0 && !error ? (
                <div className="rounded-lg border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
                  No announcements yet.
                </div>
              ) : null}
            </div>
          </section>

          {/* Right: sidebar */}
          <aside className="flex flex-col gap-4 lg:col-span-2 min-w-0">
            {/* Active Reports */}
            <div className="flex items-center gap-2">
              <h2 className="font-heading text-xl font-bold text-foreground">
                My Active Reports
              </h2>
              <div className="ml-auto">
                <Link
                  to="/dashboard/reports"
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary transition-colors hover:underline"
                >
                  View all
                  <ChevronRight className="size-3.5" />
                </Link>
              </div>
            </div>

            {activeReports.length > 0 ? (
              <Card className="bg-card overflow-hidden py-0 gap-0">
                <div className="divide-y divide-border">
                  {activeReports.map((report) => (
                    <Link
                      key={report.id}
                      to="/dashboard/reports"
                      className="flex items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-muted/50"
                    >
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
                        {(() => {
                          const Icon = categoryIcon[report.category] ?? FileQuestionIcon
                          return <Icon className="size-4 text-muted-foreground" />
                        })()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-foreground break-words">{report.title}</p>
                        <div className="mt-0.5 flex items-center gap-2 flex-wrap">
                          <span className="text-xs text-muted-foreground">{categoryLabel(report.category)} · {formatDate(report.created_at)}</span>
                          <Badge className="bg-green-100 text-green-700 border-0 text-[10px]">{statusLabel(report.status)}</Badge>
                        </div>
                      </div>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    </Link>
                  ))}
                </div>
              </Card>
            ) : (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card p-8 text-center">
                <p className="text-sm font-medium text-foreground">No active reports</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Submit a concern to track its progress here.
                </p>
              </div>
            )}

            {/* Today in Barangay */}
            <div className="rounded-lg border border-border bg-card">
              <div className="border-b border-border px-5 py-3.5">
                <h3 className="font-heading text-sm font-bold text-foreground">
                  Today in Barangay
                </h3>
              </div>
              <div className="divide-y divide-border">
                {barangayEvents.map((event) => (
                  <div key={event.title} className="flex items-center justify-between px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">{event.title}</p>
                      <p className="text-xs text-muted-foreground">{event.detail}</p>
                    </div>
                    <span className="shrink-0 text-xs font-medium text-foreground/70">{event.time_label}</span>
                  </div>
                ))}
                {barangayEvents.length === 0 ? (
                  <div className="px-5 py-3 text-sm text-muted-foreground">No events today.</div>
                ) : null}
              </div>
            </div>

            {/* Calendar */}
            <CalendarBasic />
          </aside>
        </div>
      </div>
    </div>
  )
}
