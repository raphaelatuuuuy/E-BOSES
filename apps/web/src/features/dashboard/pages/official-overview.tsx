import { useCallback, useEffect, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"

import { Skeleton } from "@workspace/ui/components/skeleton"
import { useAuthSession } from "@/features/auth/auth-session"
import {
  getOfficialAnalytics,
  type Concern,
  getConcern,
  getResponderDashboardSummary,
  listAssignedConcerns,
  listUnitConcerns,
  type OfficialOverviewReport,
  listManagedConcerns,
  listAnnouncements,
  type Announcement,
  type OfficialAnalytics,
  type ResponderRoleSummary,
  type ResidentReportPeriod,
} from "@/features/dashboard/api"
import {
  getEmergency,
  listAssignedEmergencies,
  type EmergencyAlert,
} from "@/features/dashboard/emergency-api"
import { OverviewAnnouncements } from "@/features/dashboard/components/resident-overview/announcement-rows"
import { StatTiles } from "@/features/dashboard/components/resident-overview/stat-tiles"
import { WeekChart } from "@/features/dashboard/components/resident-overview/week-chart"
import { OfficialOverviewReports } from "@/features/dashboard/components/official-overview/report-rows"
import { compareReportPriority } from "@/features/dashboard/lib/report-priority"
import { shouldSkipPoll } from "@/features/dashboard/lib/visible-poll"
import { OverviewReportsSheet } from "@/features/dashboard/components/resident-overview/reports-sheet"
import { OverviewReportDetailSheet } from "@/features/dashboard/components/resident-overview/report-detail-sheet"
import { MobileEmergencyReportDetailPage } from "@/features/dashboard/components/concerns/mobile-report-detail"
import { useOfficialUnitScope } from "@/features/dashboard/hooks/use-official-unit"
import { emergencyTitleText } from "@/features/dashboard/lib/emergency-description"
import { usePageTitle } from "@/hooks/use-page-title"

const unitTileCopy = {
  total: {
    label: "Reports in your unit",
    caption: "Assigned to this unit",
  },
  active: {
    label: "Active reports",
    caption: "Still being handled",
  },
  resolved: {
    label: "Resolved",
    caption: "Marked as closed",
  },
} as const

function emergencyToOverviewReport(
  alert: EmergencyAlert
): OfficialOverviewReport {
  const status = ["resolved", "closed"].includes(alert.status)
    ? "resolved"
    : ["cancelled", "false_alarm", "invalid"].includes(alert.status)
      ? "rejected"
      : "in_progress"
  const address =
    alert.display_location ||
    alert.resolved_location ||
    alert.address ||
    alert.reported_area ||
    alert.barangay

  return {
    id: alert.id,
    record_type: "emergency",
    emergency_id: alert.id,
    public_id: alert.public_id,
    tracking_id: alert.tracking_id || alert.public_id,
    title: emergencyTitleText(alert),
    official_title: emergencyTitleText(alert),
    summary: "",
    category: "public_safety",
    category_ref: null,
    status,
    severity: "critical",
    address,
    barangay: alert.barangay,
    assigned_department: alert.responding_unit,
    created_at: alert.created_at,
  }
}

function buildResponderAnalytics(
  concerns: Concern[],
  period: ResidentReportPeriod,
  communityName: string,
  assignedUnit: ResponderRoleSummary["assigned_unit"],
  activeEmergencies: number,
  assignedEmergencies: EmergencyAlert[],
  dashboard?: Pick<
    ResponderRoleSummary,
    | "unit"
    | "community_name"
    | "unit_totals"
    | "community_totals"
    | "report_overview"
    | "recent_reports"
    | "critical_report"
  >
): OfficialAnalytics {
  const dayCount = period === "today" ? 1 : period === "month" ? 30 : 7
  const end = new Date()
  end.setHours(0, 0, 0, 0)
  const days = Array.from({ length: dayCount }, (_, index) => {
    const date = new Date(end)
    date.setDate(end.getDate() - (dayCount - index - 1))
    return {
      date: date.toISOString().slice(0, 10),
      submitted: 0,
      resolved: 0,
      critical: 0,
    }
  })
  const dayMap = new Map(days.map((day) => [day.date, day]))
  for (const concern of concerns) {
    const createdDate = new Date(concern.created_at).toISOString().slice(0, 10)
    const createdDay = dayMap.get(createdDate)
    if (createdDay) {
      createdDay.submitted += 1
      if (concern.severity === "critical") createdDay.critical += 1
    }
    if (concern.status === "resolved") {
      const resolvedDate = new Date(concern.updated_at)
        .toISOString()
        .slice(0, 10)
      const resolvedDay = dayMap.get(resolvedDate)
      if (resolvedDay) resolvedDay.resolved += 1
    }
  }
  const active = concerns.filter(
    (concern) => !["resolved", "rejected"].includes(concern.status)
  ).length
  const resolved = concerns.filter(
    (concern) => concern.status === "resolved"
  ).length
  const critical = concerns.filter(
    (concern) => concern.severity === "critical"
  ).length
  const reports = [...concerns]
    .sort(compareReportPriority)
    .slice(0, 5)
    .map<OfficialOverviewReport>((concern) => ({
      id: concern.id,
      public_id: concern.public_id,
      tracking_id: concern.tracking_id,
      title: concern.title,
      official_title: concern.official_title || concern.title,
      summary: concern.summary,
      category: concern.category,
      category_ref: concern.category_ref
        ? {
            id: concern.category_ref.id,
            code: concern.category_ref.code,
            name: concern.category_ref.name,
            icon_key: concern.category_ref.icon_key,
            custom_icon_label: concern.category_ref.custom_icon_label,
          }
        : null,
      status: concern.status,
      severity: concern.severity ?? "low",
      address: concern.address,
      barangay: concern.barangay,
      assigned_department: concern.assigned_department,
      created_at: concern.created_at,
    }))
  const periodLabel =
    period === "today"
      ? "Today"
      : period === "month"
        ? "This month"
        : "This week"
  const reportOverview = {
    period,
    label: periodLabel,
    comparison_label: "Compared with the previous period",
    start_date: days[0]?.date ?? end.toISOString().slice(0, 10),
    end_date: days[days.length - 1]?.date ?? end.toISOString().slice(0, 10),
    total: days.reduce((total, day) => total + day.submitted, 0),
    previous_total: 0,
    delta_count: days.reduce((total, day) => total + day.submitted, 0),
    delta_pct: null,
    critical_total: critical,
    previous_critical_total: 0,
    days,
  }
  const unit = assignedUnit
    ? {
        id: assignedUnit.id,
        code: assignedUnit.code,
        name: assignedUnit.name,
        short_name: assignedUnit.short_name,
      }
    : null
  const emergencyReports: OfficialOverviewReport[] =
    assignedEmergencies.map(emergencyToOverviewReport)
  const latestReports = [
    ...(dashboard?.recent_reports ?? [...reports, ...emergencyReports]),
  ]
    .sort(compareReportPriority)
    .slice(0, 3)
  return {
    window_days: dayCount,
    generated_at: new Date().toISOString(),
    totals: {
      open: active,
      working: concerns.filter((concern) => concern.status === "in_progress")
        .length,
      new_today: days[days.length - 1]?.submitted ?? 0,
      filed_window: reportOverview.total,
      closed_window: resolved,
      net_window: reportOverview.total - resolved,
    },
    share: { open: active, working: active, closed: resolved },
    series: days.map((day) => ({
      date: day.date,
      filed: day.submitted,
      closed: day.resolved,
    })),
    by_category: [],
    resolution: {
      rate_percent: concerns.length ? (resolved / concerns.length) * 100 : 0,
      resolved,
      settled: resolved,
      median_days: null,
    },
    emergencies: {
      active: activeEmergencies,
      responders_on_duty: 0,
      median_response_minutes: null,
    },
    attention: [],
    unit: dashboard?.unit ?? unit,
    community_name: dashboard?.community_name ?? communityName,
    unit_totals: dashboard?.unit_totals ?? {
      total: concerns.length,
      active,
      resolved,
    },
    community_totals: dashboard?.community_totals ?? {
      total: concerns.length,
      active,
      resolved,
    },
    report_overview: dashboard?.report_overview ?? reportOverview,
    recent_reports: latestReports,
    critical_report:
      dashboard?.critical_report ??
      reports.find((report) => report.severity === "critical") ??
      null,
  }
}

export default function OfficialOverviewPage({
  audience = "official",
}: {
  audience?: "official" | "responder"
}) {
  usePageTitle("Home")
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { user } = useAuthSession()
  const isResponder = audience === "responder"
  const { units, selectedUnit, selectedUnitId, selectUnit } =
    useOfficialUnitScope(user)
  const [analytics, setAnalytics] = useState<OfficialAnalytics | null>(null)
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [reportPeriod, setReportPeriod] = useState<ResidentReportPeriod>("week")
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [reportsOpen, setReportsOpen] = useState(false)
  const [detailPost, setDetailPost] = useState<Concern | null>(null)
  const [detailAlert, setDetailAlert] = useState<EmergencyAlert | null>(null)
  const reportQuery = searchParams.get("report")
  const alertQuery = searchParams.get("alert")

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        let nextAnalytics: OfficialAnalytics
        let nextAnnouncements: Announcement[]
        if (isResponder) {
          const [
            assigned,
            announcements,
            responderSummary,
            assignedEmergencies,
          ] = await Promise.all([
            listAssignedConcerns("all"),
            listAnnouncements().catch(() => [] as Announcement[]),
            getResponderDashboardSummary().catch(() => null),
            listAssignedEmergencies().catch(() => [] as EmergencyAlert[]),
          ])
          nextAnalytics = buildResponderAnalytics(
            assigned,
            reportPeriod,
            responderSummary?.community_name ||
              assigned[0]?.community?.name ||
              (user?.barangay || "Your community").replace(/^Barangay\s+/i, ""),
            responderSummary?.assigned_unit ?? null,
            responderSummary?.assigned_active_emergencies ?? 0,
            assignedEmergencies,
            responderSummary ?? undefined
          )
          nextAnnouncements = announcements
        } else {
          const [officialAnalytics, announcements] = await Promise.all([
            getOfficialAnalytics({
              unitId: selectedUnitId,
              period: reportPeriod,
            }),
            listAnnouncements().catch(() => [] as Announcement[]),
          ])
          nextAnalytics = officialAnalytics
          nextAnnouncements = announcements
        }
        if (cancelled) return
        setAnalytics(nextAnalytics)
        setAnnouncements(
          nextAnnouncements.filter((item) => item.is_published).slice(0, 3)
        )
        setFailed(false)
      } catch {
        if (!cancelled) setFailed(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    function refresh() {
      if (shouldSkipPoll()) return
      void load()
    }

    function refreshVisible() {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        refresh()
      }
    }

    void load()
    const interval = window.setInterval(refresh, 30000)
    window.addEventListener("eboses:report-created", refresh)
    window.addEventListener("eboses:notification-created", refresh)
    window.addEventListener("eboses:concern-updated", refresh)
    window.addEventListener("eboses:emergency-updated", refresh)
    document.addEventListener("visibilitychange", refreshVisible)
    return () => {
      cancelled = true
      window.clearInterval(interval)
      window.removeEventListener("eboses:report-created", refresh)
      window.removeEventListener("eboses:notification-created", refresh)
      window.removeEventListener("eboses:concern-updated", refresh)
      window.removeEventListener("eboses:emergency-updated", refresh)
      document.removeEventListener("visibilitychange", refreshVisible)
    }
  }, [isResponder, reportPeriod, selectedUnitId, user?.barangay])

  useEffect(() => {
    if (!reportQuery || !/^\d+$/.test(reportQuery)) return
    let cancelled = false
    void getConcern(Number(reportQuery))
      .then((next) => {
        if (!cancelled) setDetailPost(next)
      })
      .catch(() => {
        if (cancelled) return
        const next = new URLSearchParams(searchParams)
        next.delete("report")
        setSearchParams(next, { replace: true })
      })
    return () => {
      cancelled = true
    }
  }, [reportQuery, searchParams, setSearchParams])

  useEffect(() => {
    if (!alertQuery || !/^\d+$/.test(alertQuery)) return
    let cancelled = false
    void getEmergency(Number(alertQuery))
      .then((next) => {
        if (!cancelled) setDetailAlert(next)
      })
      .catch(() => {
        if (cancelled) return
        const next = new URLSearchParams(searchParams)
        next.delete("alert")
        setSearchParams(next, { replace: true })
      })
    return () => {
      cancelled = true
    }
  }, [alertQuery, searchParams, setSearchParams])

  const displayName =
    `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim() ||
    user?.full_name ||
    "Official"
  const unitName =
    analytics?.unit?.name ||
    selectedUnit?.name ||
    analytics?.unit?.short_name ||
    selectedUnit?.short_name ||
    "All units"
  const unitTotals = analytics?.unit_totals ?? {
    total: 0,
    active: 0,
    resolved: 0,
  }
  const reportOverview = analytics?.report_overview ?? null
  const loadUnitReports = useCallback(async () => {
    if (isResponder) return listUnitConcerns()
    const reports = await listManagedConcerns()
    if (selectedUnitId == null) return reports
    return reports.filter(
      (report) => report.assigned_department?.id === selectedUnitId
    )
  }, [isResponder, selectedUnitId])

  const closeReportDetail = useCallback(() => {
    setDetailPost(null)
    if (!searchParams.has("report")) return
    const next = new URLSearchParams(searchParams)
    next.delete("report")
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  const closeAlertDetail = useCallback(() => {
    setDetailAlert(null)
    if (!searchParams.has("alert")) return
    const next = new URLSearchParams(searchParams)
    next.delete("alert")
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  const openOfficialReport = useCallback(
    (report: OfficialOverviewReport) => {
      if (report.record_type === "emergency" && report.emergency_id != null) {
        void getEmergency(report.emergency_id)
          .then((next) => setDetailAlert(next))
          .catch(() =>
            navigate(`/dashboard/overview?alert=${report.emergency_id}`)
          )
        return
      }
      void getConcern(report.id)
        .then((next) => setDetailPost(next))
        .catch(() => navigate(`/dashboard/overview?report=${report.id}`))
    },
    [navigate]
  )
  const loadUnitEmergencies = useCallback(async () => {
    try {
      const alerts = await listAssignedEmergencies()
      return alerts.map(emergencyToOverviewReport)
    } catch {
      return []
    }
  }, [])
  const responderUnit = analytics?.unit ?? selectedUnit
  const unitOptions = isResponder
    ? responderUnit
      ? [
          {
            id: responderUnit.id,
            label: responderUnit.short_name || responderUnit.name,
          },
        ]
      : [{ id: null, label: "Unit not assigned" }]
    : user?.is_superuser
      ? [
          { id: null, label: "All units" },
          ...units.map((unit) => ({
            id: unit.id,
            label: unit.short_name || unit.name,
          })),
        ]
      : units.map((unit) => ({
          id: unit.id,
          label: unit.short_name || unit.name,
        }))

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-6 md:max-w-5xl md:px-8 lg:px-10">
      <div className="mt-5">
        <h1 className="text-[30px] leading-tight font-bold tracking-tight text-neutral-900">
          Hello, <span className="text-brand-orange">{displayName}</span>
        </h1>
        <p className="mt-1 text-[14.5px] text-neutral-500">
          Stay on top of your unit&apos;s reports.
        </p>
      </div>

      {loading && !analytics ? (
        <div className="mt-4 flex flex-col gap-3">
          <Skeleton className="h-28 w-full rounded-2xl" />
          <Skeleton className="h-56 w-full rounded-2xl" />
          <Skeleton className="h-40 w-full rounded-2xl" />
        </div>
      ) : failed && !analytics ? (
        <p className="mt-6 rounded-2xl border border-neutral-200 bg-white px-4 py-6 text-center text-[14px] text-neutral-500">
          Could not load the overview. Try again in a moment.
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <StatTiles
            total={unitTotals.total}
            active={unitTotals.active}
            resolved={unitTotals.resolved}
            copy={unitTileCopy}
          />

          <WeekChart
            overview={reportOverview}
            period={reportPeriod}
            loading={loading}
            error={failed ? "Could not refresh your unit activity." : null}
            onPeriodChange={setReportPeriod}
            subtitle={
              isResponder
                ? "All units reports received"
                : `${unitName} reports received`
            }
            activityLabel="Unit activity"
            activityVerb="received"
            unitOptions={unitOptions}
            selectedUnitId={
              isResponder ? (responderUnit?.id ?? null) : selectedUnitId
            }
            onUnitChange={isResponder ? () => undefined : selectUnit}
          />

          <OverviewAnnouncements
            items={announcements}
            onViewAll={() => navigate("/dashboard/feed")}
          />

          <OfficialOverviewReports
            items={analytics?.recent_reports ?? []}
            onViewAll={() => setReportsOpen(true)}
            onOpenReport={openOfficialReport}
          />
        </div>
      )}

      <OverviewReportsSheet
        open={reportsOpen}
        onClose={() => setReportsOpen(false)}
        showPriority
        onSelectReport={(post) => {
          setReportsOpen(false)
          setDetailPost(post)
        }}
        loadEmergencies={loadUnitEmergencies}
        onOpenEmergency={(report) => {
          setReportsOpen(false)
          openOfficialReport(report)
        }}
        loadReports={loadUnitReports}
        title={
          isResponder || selectedUnitId == null ? (
            <>All <span className="text-brand-orange">reports</span></>
          ) : (
            <>{unitName} <span className="text-brand-orange">reports</span></>
          )
        }
        description={
          isResponder
            ? "Every report assigned to your unit."
            : selectedUnitId == null
              ? "Every report across your units."
              : `Every report assigned to ${unitName}.`
        }
      />
      <OverviewReportDetailSheet
        post={detailPost}
        audience="official"
        onClose={closeReportDetail}
        onUpdated={(next) => setDetailPost(next)}
      />
      {detailAlert ? (
        <MobileEmergencyReportDetailPage
          alert={detailAlert}
          onBack={closeAlertDetail}
          onRefresh={async () => {
            const next = await getEmergency(detailAlert.id)
            setDetailAlert(next)
          }}
          audience={isResponder ? "responder" : "official"}
          viewerId={user?.id ?? null}
          onChanged={(next) => setDetailAlert(next)}
        />
      ) : null}
    </div>
  )
}
