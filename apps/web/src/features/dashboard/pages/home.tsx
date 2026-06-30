import { ImageIcon } from "lucide-react"
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
            <div className="flex items-center justify-between gap-4">
              <h2 className="font-heading text-xl font-bold text-foreground">
                Announcements
              </h2>
              <Link
                to="/dashboard/feed"
                className="text-sm font-medium text-muted-foreground underline underline-offset-2 transition-colors hover:text-primary"
              >
                View feed
              </Link>
            </div>

            <div className="flex flex-1 flex-col gap-4">
              {announcements.map((announcement) => (
                <div key={announcement.title} className="flex flex-1 rounded-lg border border-border bg-white">
                  <div className="flex aspect-[16/9] w-full items-center justify-center rounded-t-lg bg-muted md:hidden">
                    <ImageIcon className="size-6 text-muted-foreground/40" />
                  </div>
                  <div className="flex w-full md:flex-row">
                    <div className="hidden w-44 shrink-0 items-center justify-center bg-muted md:flex">
                      <ImageIcon className="size-6 text-muted-foreground/40" />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col justify-between p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground">
                            {announcement.title}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{announcement.date}</p>
                        </div>
                        <Badge variant="secondary">{announcement.tag}</Badge>
                      </div>
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                        {announcement.description}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Right: Active Reports */}
          <aside className="flex flex-col gap-4 lg:col-span-2 min-w-0">
            <div className="flex items-center justify-between">
              <h2 className="font-heading text-xl font-bold text-foreground">
                My Active Reports
              </h2>
              <Link
                to="/dashboard/reports"
                className="text-sm font-medium text-muted-foreground underline underline-offset-2 transition-colors hover:text-primary"
              >
                View all
              </Link>
            </div>

            {activeReports.map((report) => (
              <Card key={report.id} className="bg-white">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-sm">{report.title}</CardTitle>
                      <CardDescription className="text-[11px]">{report.detail}</CardDescription>
                    </div>
                    <Badge className="bg-green-100 text-green-700 border-0">{report.status}</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <Link
                    to="/dashboard/reports"
                    className="text-sm font-medium text-primary underline underline-offset-2"
                  >
                    Review status
                  </Link>
                </CardContent>
              </Card>
            ))}

            {/* Calendar */}
            <CalendarBasic />
          </aside>
        </div>
      </div>
    </div>
  )
}
