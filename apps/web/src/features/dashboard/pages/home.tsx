import { ChevronRight } from "lucide-react"
import { Link } from "react-router-dom"

import { Badge } from "@workspace/ui/components/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

import { usePageTitle } from "@/hooks/use-page-title"
import { Topbar } from "@/features/dashboard/components/topbar"
import { GreetingCard } from "@/features/dashboard/components/greeting-card"
import { CalendarBasic } from "@/features/dashboard/components/calendar-basic"

const announcements = [
  {
    title: "Road clearing on Bayan-Bayanan Street",
    description:
      "Expect one-lane traffic while the maintenance team clears drainage debris.",
    tag: "Advisory",
    date: "Today, 9:00 AM",
  },
  {
    title: "Community cleanup registration",
    description:
      "Residents may register at the barangay hall for this weekend's cleanup drive.",
    tag: "Barangay",
    date: "Tomorrow",
  },
  {
    title: "Flood watch near low-lying streets",
    description:
      "Monitor official alerts and keep emergency contacts available during heavy rain.",
    tag: "Safety",
    date: "Jun 30, 2026",
  },
]

const barangayEvents = [
  { title: "Garbage collection", detail: "Zone 1 & 2", time: "6:00 AM" },
  { title: "Barangay health clinic", detail: "Free blood pressure check", time: "8:00 AM" },
]

const activeReports = [
  {
    id: "RPT-001",
    title: "Pothole on Bayan-Bayanan St.",
    status: "Active",
    detail: "Infrastructure · submitted Jun 28, 2026",
  },
]

export default function HomePage() {
  usePageTitle("Home")

  return (
    <div className="flex min-h-svh flex-col">
      <Topbar />
      <GreetingCard />

      <div className="flex-1 p-6 md:p-10">
        <div className="grid gap-8 lg:grid-cols-5">
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
              {announcements.map((announcement) => (
                <div key={announcement.title} className="rounded-lg border border-border bg-white p-4 transition-shadow hover:shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground break-words">
                        {announcement.title}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{announcement.date}</p>
                    </div>
                    <Badge variant="secondary" className="shrink-0">{announcement.tag}</Badge>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground break-words">
                    {announcement.description}
                  </p>
                </div>
              ))}
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
              activeReports.map((report) => (
                <Card key={report.id} className="bg-white">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-sm">{report.title}</CardTitle>
                        <CardDescription className="text-xs">{report.detail}</CardDescription>
                      </div>
                      <Badge className="bg-green-100 text-green-700 border-0">{report.status}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <Link
                      to="/dashboard/reports"
                      className="inline-flex items-center gap-1 text-sm font-medium text-primary transition-colors hover:underline"
                    >
                      Review status
                      <ChevronRight className="size-3.5" />
                    </Link>
                  </CardContent>
                </Card>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card p-8 text-center">
                <p className="text-sm font-medium text-foreground">No active reports</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Submit a concern to track its progress here.
                </p>
              </div>
            )}

            {/* Today in Barangay */}
            <div className="rounded-lg border border-border bg-white">
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
                    <span className="shrink-0 text-xs font-medium text-foreground/70">{event.time}</span>
                  </div>
                ))}
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
