import { useEffect, useState } from "react"
import { InfoIcon, PhoneIcon, ShieldCheckIcon } from "lucide-react"
import { Link } from "react-router-dom"

import { usePageTitle } from "@/hooks/use-page-title"
import { useAuthSession } from "@/features/auth/auth-session"
import { Topbar } from "@/features/dashboard/components/topbar"
import { GreetingCard } from "@/features/dashboard/components/greeting-card"
import { AnnouncementsCard } from "@/features/dashboard/components/announcements-card"
import { ActiveReportsCard } from "@/features/dashboard/components/active-reports-card"
import { QuickActionsCard } from "@/features/dashboard/components/quick-actions-card"
import {
  getDashboardSummary,
  listAnnouncements,
  type Announcement,
  type Concern,
} from "@/features/dashboard/api"

function UrgentHelpCard() {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-border bg-white p-5 shadow-[0_10px_28px_rgba(15,23,42,0.08)]">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-base font-bold text-[#07145f]">Need urgent assistance?</h2>
          <p className="mt-3 max-w-[32ch] text-xs font-medium leading-5 text-[#46537d]">
            Tap the SOS button for immediate help from our barangay responders.
          </p>
        </div>
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#eef3ff] text-[#2447b3]">
          <ShieldCheckIcon className="size-5" strokeWidth={2} />
        </div>
      </div>

      <Link
        to="#"
        className="mt-4 flex items-center gap-2 text-sm font-semibold text-[#0047b3] transition-colors hover:text-[#003580]"
      >
        How it works
        <InfoIcon className="size-4" strokeWidth={2} />
      </Link>
    </section>
  )
}

export default function HomePage() {
  usePageTitle("Home")
  const { loading: authLoading } = useAuthSession()
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [activeReports, setActiveReports] = useState<Concern[]>([])
  const [error, setError] = useState("")

  useEffect(() => {
    if (authLoading) return
    let cancelled = false
    async function loadHome() {
      setError("")
      try {
        const [nextAnnouncements, summary] = await Promise.all([
          listAnnouncements(),
          getDashboardSummary(),
        ])
        if (cancelled) return
        setAnnouncements(nextAnnouncements)
        setActiveReports(summary.active_reports)
      } catch {
        if (!cancelled) setError("Could not load dashboard data.")
      }
    }
    void loadHome()
    function refresh() { void loadHome() }
    window.addEventListener("eboses:report-created", refresh)
    return () => {
      cancelled = true
      window.removeEventListener("eboses:report-created", refresh)
    }
  }, [authLoading])

  return (
    <div className="flex flex-col">
      <Topbar />
      <div className="flex-1 overflow-x-hidden overflow-y-auto bg-[#f7f8fc] px-5 pb-6 md:px-8 md:pb-8 xl:px-9">
        <div className="grid gap-5 max-w-full">
          <GreetingCard />
          <section className="grid gap-5 lg:grid-cols-[1fr_0.6fr]">
            <div className="grid content-start gap-5 min-w-0">
              <AnnouncementsCard announcements={announcements} />
              <QuickActionsCard />
            </div>
            <div className="grid content-start gap-5 min-w-0">
              <ActiveReportsCard reports={activeReports} />
              <UrgentHelpCard />
            </div>
          </section>
        </div>

        {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}
      </div>
    </div>
  )
}
