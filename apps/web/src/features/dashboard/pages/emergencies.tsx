import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  SearchIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
} from "lucide-react"
import { toast } from "sonner"
import { useSearchParams } from "react-router-dom"

import { cn } from "@workspace/ui/lib/utils"
import { usePageTitle } from "@/hooks/use-page-title"
import { useAuthSession } from "@/features/auth/auth-session"
import { useIsDesktop } from "@/features/dashboard/lib/shell"
import {
  getOfficialDashboardSummary,
  listActiveResponders,
  type ActiveResponder,
  type OfficialRoleSummary,
} from "@/features/dashboard/api"
import {
  getEmergency,
  listEmergencyAppeals,
  listEmergencyQueue,
  type EmergencyAlert,
  type EmergencyAppeal,
} from "@/features/dashboard/emergency-api"

import {
  EMERGENCY_FILTERS,
  matchesEmergencyFilter,
  useMinWidth,
} from "@/features/dashboard/components/emergencies/lib"
import { usePaneCollapse } from "@/features/dashboard/components/responder/pane-collapse"
import { FilterRail } from "@/features/dashboard/components/workspace/filter-rail"
import { EmergencyAppealsPanel } from "@/features/dashboard/components/emergencies/queue-list"
import { QueueItem } from "@/features/dashboard/components/emergencies/queue-item"
import { QueueTableHeader } from "@/features/dashboard/components/workspace/queue-row"
import {
  triageAlerts,
} from "@/features/dashboard/components/record/emergency-adapter"
import { IncidentBoard } from "@/features/dashboard/components/emergencies/incident-board"
import { DispatchPanel } from "@/features/dashboard/components/emergencies/dispatch-panel"
import {
  OpsWorkspace,
  OpsPaneHeader,
  type OpsPaneSpec,
} from "@/features/dashboard/components/workspace/ops-workspace"
import { OpsBar, OpsBarButton, type OpsCounter } from "@/features/dashboard/components/workspace/ops-bar"

export default function EmergenciesPage() {
  usePageTitle("Emergency Ops")
  const { user } = useAuthSession()
  const [searchParams] = useSearchParams()
  const requestedAlertId = Number(searchParams.get("alert")) || null
  const [alerts, setAlerts] = useState<EmergencyAlert[]>([])
  const [responders, setResponders] = useState<ActiveResponder[]>([])
  const [appeals, setAppeals] = useState<EmergencyAppeal[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [summary, setSummary] = useState<OfficialRoleSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [activeFilter, setActiveFilter] = useState<string>("Active")
  const [search, setSearch] = useState("")

  const QUEUE_PAGE_SIZE = 5
  const [queuePage, setQueuePage] = useState(1)

  const [prevQueueKey, setPrevQueueKey] = useState("")
  const queueKey = `${activeFilter}|${search}`
  if (prevQueueKey !== queueKey) {
    setPrevQueueKey(queueKey)
    setQueuePage(1)
  }

  const isWideUp = useMinWidth(1440)
  const [queueCollapsed, setQueueCollapsed] = usePaneCollapse("eboses:ws:emergencies:queue:collapsed")
  const [recordCollapsed, setRecordCollapsed] = usePaneCollapse("eboses:ws:emergencies:record:collapsed")
  const [actionCollapsed, setActionCollapsed] = usePaneCollapse(
    "eboses:ws:emergencies:action:collapsed",
    !isWideUp,
  )
  const isOfficial = user?.role === "barangay_official" || user?.is_staff || user?.is_superuser

  const isLgUp = useIsDesktop()
  const [mobileView, setMobileView] = useState<"list" | "board">("list")
  const [asideOpen, setAsideOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const selected = useMemo(() => alerts.find((alert) => alert.id === selectedId) ?? alerts[0] ?? null, [alerts, selectedId])

  const counts = useMemo(() => ({
    active: summary?.active_emergencies ?? alerts.filter((alert) => matchesEmergencyFilter(alert, "Active")).length,
    respondersOnDuty: summary?.responders_on_duty ?? responders.length,
  }), [alerts, responders.length, summary])

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!user || !isOfficial) return
      setLoading(true)
      setError("")
      try {
        const [nextAlerts, nextResponders, nextSummary, requestedAlert, nextAppeals] = await Promise.all([

          listEmergencyQueue("all"),
          listActiveResponders(),
          getOfficialDashboardSummary(),
          requestedAlertId ? getEmergency(requestedAlertId).catch(() => null) : Promise.resolve(null),
          listEmergencyAppeals(),
        ])
        if (cancelled) return
        const mergedAlerts = requestedAlert && !nextAlerts.some((alert) => alert.id === requestedAlert.id)
          ? [requestedAlert, ...nextAlerts]
          : nextAlerts.map((alert) => alert.id === requestedAlert?.id ? requestedAlert : alert)
        setAlerts(mergedAlerts)
        setResponders(nextResponders)
        setSummary(nextSummary)
        setAppeals(nextAppeals)
        setSelectedId(requestedAlert?.id ?? mergedAlerts[0]?.id ?? null)
        if (requestedAlert) setMobileView("board")
      } catch {
        if (!cancelled) setError("Could not load emergency operations.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [user, isOfficial, requestedAlertId])

  function updateAlert(next: EmergencyAlert) {
    setAlerts((current) => current.map((alert) => (alert.id === next.id ? next : alert)))
    setSelectedId(next.id)
  }

  function selectAlert(id: number) {
    setSelectedId(id)
    if (!isLgUp) setMobileView("board")
  }

  if (!isOfficial) {
    return (
      <div className="p-4 md:p-6">
        <div className="rounded-panel border border-card-line bg-card p-8 text-center">
          <AlertTriangleIcon className="mx-auto size-10 text-severity-critical" />
          <h1 className="mt-3 font-heading text-title text-foreground">
            Emergency operations are staff-only
          </h1>
          <p className="mt-2 text-body text-muted-foreground">
            Residents can send SOS alerts from the SOS button.
          </p>
        </div>
      </div>
    )
  }

  const queryText = search.trim().toLowerCase()
  const visibleAlerts = alerts.filter((alert) => {
    if (!matchesEmergencyFilter(alert, activeFilter)) return false
    if (!queryText) return true
    return [
      alert.reporter_display,
      alert.type,
      alert.note,
      alert.display_location,
      alert.address,
      alert.reported_area,
      alert.barangay,
      alert.public_id,
    ].some((value) => value?.toLowerCase().includes(queryText))
  })

  const triaged = triageAlerts(visibleAlerts, now)

  const queueTotalPages = Math.max(1, Math.ceil(triaged.length / QUEUE_PAGE_SIZE))
  const currentQueuePage = Math.min(queuePage, queueTotalPages)
  const pagedTriaged = triaged.slice(
    (currentQueuePage - 1) * QUEUE_PAGE_SIZE,
    currentQueuePage * QUEUE_PAGE_SIZE,
  )

  const actionsPanel = (
    <DispatchPanel
      key={selected?.id ?? "none"}
      alert={selected}
      responders={responders}
      onChanged={updateAlert}
    />
  )

  const counters: OpsCounter[] = [
    { label: "active", value: counts.active, tone: counts.active > 0 ? "alert" : "good" },
    { label: "on duty", value: counts.respondersOnDuty, tone: "live" },
    { label: "in queue", value: alerts.length },
  ]

  const asideLabel = "Dispatch"

  const bar = (
    <OpsBar
      title="Dispatch console"
      context={user?.barangay || "Barangay Marikina Heights"}
      counters={counters}
    >
      <label className="hidden h-8 items-center gap-2 rounded-control border border-card-line bg-card px-2.5 md:flex">
        <SearchIcon className="size-3.5 shrink-0 text-subtle-foreground" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search alerts…"
          className="w-40 min-w-0 bg-transparent text-label text-foreground outline-none placeholder:text-faint-foreground lg:w-52"
        />
      </label>
      {!isLgUp ? (
        <OpsBarButton
          icon={SlidersHorizontalIcon}
          label={asideLabel}
          tone="primary"
          onClick={() => setAsideOpen(true)}
        />
      ) : null}
    </OpsBar>
  )

  const queuePane = (
    <>
      <OpsPaneHeader
        title="Alerts"
        collapsed={queueCollapsed}
        onToggleCollapse={() => setQueueCollapsed((value) => !value)}
      />
      <div className="space-y-3 p-3 pb-0">
        <FilterRail
          ariaLabel="Emergency queue filters"
          active={activeFilter}
          onSelect={setActiveFilter}
          options={EMERGENCY_FILTERS.map((filter) => ({
            label: filter,
            count: alerts.filter((alert) => matchesEmergencyFilter(alert, filter)).length,
          }))}
        />

        {error ? (
          <p className="rounded-control border border-severity-critical/40 bg-severity-critical-surface px-3 py-2 text-label text-severity-critical-ink">
            {error}
          </p>
        ) : null}

        {isOfficial && appeals.length > 0 ? (
          <EmergencyAppealsPanel
            appeals={appeals}
            onUpdated={(next) =>
              setAppeals((items) => items.map((item) => (item.id === next.id ? next : item)))
            }
          />
        ) : null}
      </div>

      {loading ? (
        <div className="m-3 rounded-panel border border-card-line bg-card p-6 text-body text-muted-foreground">
          Loading emergencies…
        </div>
      ) : triaged.length === 0 ? (
        <div className="border-t border-card-line bg-card px-4 py-10 text-center">
          <ShieldCheckIcon className="mx-auto size-8 text-status-closed" />
          <h2 className="mt-2.5 text-heading text-foreground">
            {search.trim()
              ? "No alerts match that search"
              : activeFilter === "Active" || activeFilter === "All"
                ? "No active emergencies"
                : `No ${activeFilter.toLowerCase()} alerts`}
          </h2>
          <p className="mt-1 text-body text-muted-foreground">
            New SOS alerts and assignments appear here.
          </p>
        </div>
      ) : (
        <>
          <div className="border-t border-card-line">
            <QueueTableHeader labels={{ title: "Emergency", unitAndTime: "Assigned Unit & When" }} />
            {pagedTriaged.map((entry) => (
              <QueueItem
                key={entry.alert.id}
                entry={entry}
                active={selected?.id === entry.alert.id}
                now={now}
                onSelect={() => selectAlert(entry.alert.id)}
              />
            ))}
          </div>

          {queueTotalPages > 1 ? (
            <div className="flex items-center justify-between gap-3 p-3">
              <p className="text-[12px] font-medium text-subtle-foreground">
                Page {currentQueuePage} of {queueTotalPages} · {triaged.length} total
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setQueuePage(Math.max(1, currentQueuePage - 1))}
                  disabled={currentQueuePage <= 1}
                  className="flex h-8 items-center gap-1 rounded-control border border-card-line px-2.5 text-[12px] font-semibold text-foreground transition-colors hover:bg-card-raised disabled:opacity-40"
                >
                  <ChevronLeftIcon className="size-3.5" /> Prev
                </button>
                <button
                  type="button"
                  onClick={() => setQueuePage(Math.min(queueTotalPages, currentQueuePage + 1))}
                  disabled={currentQueuePage >= queueTotalPages}
                  className="flex h-8 items-center gap-1 rounded-control border border-card-line px-2.5 text-[12px] font-semibold text-foreground transition-colors hover:bg-card-raised disabled:opacity-40"
                >
                  Next <ChevronRightIcon className="size-3.5" />
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </>
  )

  const recordPane = (
    <>
      {!isLgUp ? (
        <button
          type="button"
          onClick={() => setMobileView("list")}
          className="sticky top-0 z-10 flex w-full items-center gap-1 border-b border-card-line bg-canvas/85 px-4 py-2.5 text-label text-brand-orange backdrop-blur-md"
        >
          <ChevronLeftIcon className="size-4" /> Back to queue
        </button>
      ) : (
        <OpsPaneHeader
          title="Incident"
          collapsed={recordCollapsed}
          onToggleCollapse={() => setRecordCollapsed((value) => !value)}

          action={
            selected ? (
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(selected.public_id)
                  toast.success("Incident ID copied")
                }}
                className="flex items-center gap-1.5 text-micro text-subtle-foreground transition-colors duration-[--duration-micro] hover:text-foreground"
              >
                <CopyIcon className="size-3.5" aria-hidden />
                Copy ID
              </button>
            ) : undefined
          }
        />
      )}

      {selected ? (
        <div className="p-4">
          <IncidentBoard alert={selected} />
        </div>
      ) : (
        <div className="flex h-full items-center justify-center p-8 text-body text-muted-foreground">
          Select an alert from the queue.
        </div>
      )}
    </>
  )

  const panes: OpsPaneSpec[] = [
    {
      id: "queue",
      role: "list",
      initial: 380,
      min: 300,
      max: 760,
      label: "Alerts",
      collapsible: true,
      collapsed: queueCollapsed,
      onCollapsedChange: setQueueCollapsed,
      node: queuePane,
    },
    {
      id: "record",
      role: "detail",
      min: 460,
      label: "Incident",
      collapsible: true,
      collapsed: recordCollapsed,
      onCollapsedChange: setRecordCollapsed,
      node: recordPane,
    },
  ]

  panes.push({
    id: "action",
    role: "aside",
    initial: 360,
    min: 300,
    max: 480,
    label: asideLabel,
    collapsible: true,
    collapsed: actionCollapsed,
    onCollapsedChange: setActionCollapsed,
    node: (
      <>
        <OpsPaneHeader
          title={asideLabel}
          collapsed={actionCollapsed}
          onToggleCollapse={() => setActionCollapsed((value) => !value)}
        />
        <div className="p-3">{actionsPanel}</div>
      </>
    ),
  })

  return (
    <OpsWorkspace
      id="emergencies"
      bar={bar}
      panes={panes}
      mobileView={mobileView === "board" ? "detail" : "list"}
      asideOpen={asideOpen}
      onAsideOpenChange={setAsideOpen}
      className={cn(!isLgUp && "pb-24")}
    />
  )
}
