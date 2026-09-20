import { useEffect, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"

import { Skeleton } from "@workspace/ui/components/skeleton"
import { useAuthSession } from "@/features/auth/auth-session"
import { geocodeCommunityStreet } from "@/features/auth/lib/forward-geocode"
import { usePageTitle } from "@/hooks/use-page-title"
import {
  getConcern,
  getResidentDashboardSummary,
  listAnnouncements,
  listFeedConcerns,
  listMyConcerns,
  type Announcement,
  type Concern,
  type ResidentReportOverview,
  type ResidentReportPeriod,
  type ResidentRoleSummary,
} from "@/features/dashboard/api"
import {
  listMyEmergencies,
  type EmergencyAlert,
} from "@/features/dashboard/emergency-api"
import { CreateReportDialog } from "@/features/dashboard/components/create-report-dialog"
import {
  LiveDot,
  liveDotAriaLabel,
} from "@/features/dashboard/components/home/live-dot"
import { streetLabelFromAddress } from "@/features/dashboard/components/feed-post-text"
import { railLiveMapSrc } from "@/features/dashboard/components/home/home-style"
import { ResidentNotificationsButton } from "@/features/dashboard/components/resident/resident-account-dialogs"
import { UserAvatar } from "@/features/dashboard/components/home/user-avatar"
import { openSettingsDialog } from "@/features/dashboard/components/settings/settings-event"
import { StatTiles } from "@/features/dashboard/components/resident-overview/stat-tiles"
import { WeekChart } from "@/features/dashboard/components/resident-overview/week-chart"
import { OverviewAnnouncements } from "@/features/dashboard/components/resident-overview/announcement-rows"
import { OverviewReports } from "@/features/dashboard/components/resident-overview/report-rows"
import { OverviewReportsSheet } from "@/features/dashboard/components/resident-overview/reports-sheet"
import { OverviewReportDetailSheet } from "@/features/dashboard/components/resident-overview/report-detail-sheet"
import { EmergencyTrackingSheet } from "@/features/dashboard/components/emergency-tracking-sheet"
import { isCriticalConcern } from "@/features/dashboard/lib/critical-concern"

export default function ResidentOverviewPage() {
  usePageTitle("Home")
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuthSession()
  const [summary, setSummary] = useState<ResidentRoleSummary | null>(null)
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [concerns, setConcerns] = useState<Concern[]>([])
  const [emergencies, setEmergencies] = useState<EmergencyAlert[]>([])
  const [feedConcerns, setFeedConcerns] = useState<Concern[]>([])
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [summaryErrorPeriod, setSummaryErrorPeriod] =
    useState<ResidentReportPeriod | null>(null)
  const [reportPeriod, setReportPeriod] = useState<ResidentReportPeriod>("week")
  const [createOpen, setCreateOpen] = useState(false)
  const [reportsOpen, setReportsOpen] = useState(false)
  const [detailPost, setDetailPost] = useState<Concern | null>(null)
  const [detailAlert, setDetailAlert] = useState<EmergencyAlert | null>(null)

  useEffect(() => {
    const trackConcernId = (location.state as { trackConcernId?: unknown } | null)
      ?.trackConcernId
    if (typeof trackConcernId !== "string" || !trackConcernId) return

    navigate(location.pathname, { replace: true, state: null })
    void getConcern(trackConcernId)
      .then((report) => setDetailPost(report))
      .catch(() => navigate(`/dashboard/reports/${trackConcernId}`))
  }, [location.pathname, location.state, navigate])

  useEffect(() => {
    function open() {
      setCreateOpen(true)
    }
    window.addEventListener("eboses:open-report", open)
    return () => window.removeEventListener("eboses:open-report", open)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [
          nextAnnouncements,
          nextConcerns,
          nextEmergencies,
          nextFeedConcerns,
        ] = await Promise.all([
          listAnnouncements().catch(() => [] as Announcement[]),
          listMyConcerns().catch(() => [] as Concern[]),
          listMyEmergencies().catch(() => [] as EmergencyAlert[]),
          listFeedConcerns("all", undefined, undefined, undefined, "all").catch(
            () => [] as Concern[]
          ),
        ])
        if (cancelled) return
        setAnnouncements(
          nextAnnouncements.filter((item) => item.is_published).slice(0, 3)
        )
        setConcerns(nextConcerns.slice(0, 5))
        setEmergencies(nextEmergencies)
        setFeedConcerns(nextFeedConcerns)
      } catch {
        if (!cancelled) setFailed(true)
      } finally {
        if (!cancelled) setLoaded(true)
      }
    }
    void load()
    const refresh = () => void load()
    const interval = window.setInterval(refresh, 30000)
    window.addEventListener("eboses:report-created", refresh)
    window.addEventListener("eboses:concern-updated", refresh)
    window.addEventListener("eboses:emergency-updated", refresh)
    return () => {
      cancelled = true
      window.clearInterval(interval)
      window.removeEventListener("eboses:report-created", refresh)
      window.removeEventListener("eboses:concern-updated", refresh)
      window.removeEventListener("eboses:emergency-updated", refresh)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    getResidentDashboardSummary(reportPeriod)
      .then((nextSummary) => {
        if (!cancelled) {
          setSummary(nextSummary)
          setSummaryErrorPeriod(null)
        }
      })
      .catch(() => {
        if (!cancelled) setSummaryErrorPeriod(reportPeriod)
      })
      .finally(() => {
        if (!cancelled) setSummaryLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [reportPeriod])

  const displayName =
    `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim() || "Resident"
  const community = (user?.barangay || "Your community").replace(
    /^Barangay\s+/i,
    ""
  )
  const streetLabel = streetLabelFromAddress(user?.address)
  const [railMap, setRailMap] = useState({ lat: 14.5995, lng: 120.9842 })
  const railMapSrc = railLiveMapSrc(railMap.lat, railMap.lng)
  const barangayActiveEmergencies = summary?.barangay_active_emergencies ?? 0
  const hasCriticalReports = feedConcerns.some(isCriticalConcern)
  const hasLiveCriticalActivity =
    barangayActiveEmergencies > 0 || hasCriticalReports
  const reportOverview: ResidentReportOverview | null =
    summary?.report_overview ?? null
  const reportSummaryLoading =
    summaryLoading ||
    (reportOverview?.period !== reportPeriod &&
      summaryErrorPeriod !== reportPeriod)

  useEffect(() => {
    let cancelled = false
    async function resolveRailMap() {
      if (!streetLabel) return
      const hit = await geocodeCommunityStreet(streetLabel, community)
      if (!cancelled && hit) setRailMap({ lat: hit.lat, lng: hit.lng })
    }
    void resolveRailMap()
    return () => {
      cancelled = true
    }
  }, [community, streetLabel])

  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-6">
      <div className="mt-5 flex items-center gap-2.5">
        <LiveDot
          src={railMapSrc}
          alert={hasLiveCriticalActivity}
          label={
            barangayActiveEmergencies > 0
              ? liveDotAriaLabel(community, true, barangayActiveEmergencies)
              : hasCriticalReports
                ? `Live map — critical reports in ${community}`
                : liveDotAriaLabel(community, false, 0)
          }
          to="/dashboard/alerts-map"
        />
        <p className="min-w-0 flex-1 truncate text-[16px] font-bold tracking-tight text-neutral-900">
          {community}
        </p>
        <ResidentNotificationsButton />
        <button
          type="button"
          onClick={() => openSettingsDialog()}
          aria-label="Open settings"
          className="flex size-10 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-neutral-50"
        >
          <UserAvatar user={user} online={Boolean(user)} size="sm" className="!size-9 text-[14px]" />
        </button>
      </div>

      <div className="mt-4">
        <h1 className="text-[30px] leading-tight font-bold tracking-tight text-neutral-900">
          Hello, <span className="text-brand-orange">{displayName}</span>
        </h1>
        <p className="mt-1 text-[14.5px] text-neutral-500">
          Stay informed. Build a better community.
        </p>
      </div>

      {!loaded ? (
        <div className="mt-4 flex flex-col gap-3">
          <Skeleton className="h-28 w-full rounded-2xl" />
          <Skeleton className="h-56 w-full rounded-2xl" />
          <Skeleton className="h-40 w-full rounded-2xl" />
        </div>
      ) : failed ? (
        <p className="mt-6 rounded-2xl border border-neutral-200 bg-white px-4 py-6 text-center text-[14px] text-neutral-500">
          Could not load the overview. Pull to refresh or try again later.
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <StatTiles
            total={summary?.reports_total ?? 0}
            active={summary?.reports_active ?? 0}
            resolved={summary?.reports_resolved ?? 0}
            onOpenReports={() => setReportsOpen(true)}
          />
          <WeekChart
            overview={reportOverview}
            period={reportPeriod}
            loading={reportSummaryLoading}
            error={
              summaryErrorPeriod === reportPeriod
                ? "Could not refresh your report activity."
                : null
            }
            onPeriodChange={setReportPeriod}
          />
          <OverviewAnnouncements
            items={announcements}
            onViewAll={() => navigate("/dashboard/feed")}
          />
          <OverviewReports
            items={concerns}
            emergencies={emergencies}
            onViewAll={() => setReportsOpen(true)}
            onOpenReport={setDetailPost}
            onOpenEmergency={setDetailAlert}
          />
        </div>
      )}

      <CreateReportDialog open={createOpen} onOpenChange={setCreateOpen} />
      <OverviewReportsSheet
        open={reportsOpen}
        onClose={() => setReportsOpen(false)}
        onSelectReport={(post) => {
          setReportsOpen(false)
          setDetailPost(post)
        }}
      />
      <OverviewReportDetailSheet
        post={detailPost}
        onClose={() => setDetailPost(null)}
      />
      <EmergencyTrackingSheet
        initialAlert={detailAlert}
        open={Boolean(detailAlert)}
        onOpenChange={(open) => {
          if (!open) setDetailAlert(null)
        }}
      />
    </div>
  )
}
