import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangleIcon,
  ChevronLeftIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
} from "lucide-react"
import { useSearchParams } from "react-router-dom"

import { cn } from "@workspace/ui/lib/utils"
import { usePageTitle } from "@/hooks/use-page-title"
import { useAuthSession } from "@/features/auth/auth-session"
import { useIsDesktop } from "@/features/dashboard/lib/shell"
import {
  getOfficialDashboardSummary,
  getResponderDashboardSummary,
  listActiveResponders,
  type ActiveResponder,
  type OfficialRoleSummary,
  type ResponderRoleSummary,
} from "@/features/dashboard/api"
import {
  getEmergency,
  listAssignedEmergencies,
  listEmergencyAppeals,
  listEmergencyQueue,
  type EmergencyAlert,
  type EmergencyAppeal,
} from "@/features/dashboard/emergency-api"

import { useMinWidth } from "@/features/dashboard/components/emergencies/lib"
import { EmergencyAppealsPanel } from "@/features/dashboard/components/emergencies/queue-list"
import { QueueItem } from "@/features/dashboard/components/emergencies/queue-item"
import {
  triageAlerts,
} from "@/features/dashboard/components/record/emergency-adapter"
import { IncidentBoard } from "@/features/dashboard/components/emergencies/incident-board"
import { DispatchPanel } from "@/features/dashboard/components/emergencies/dispatch-panel"
import { DutyPanel } from "@/features/dashboard/components/emergencies/responder-panels"
import { ResponderActions } from "@/features/dashboard/components/emergencies/responder-actions"
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
  const [summary, setSummary] = useState<OfficialRoleSummary | ResponderRoleSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const isOfficial = user?.role === "barangay_official" || user?.is_staff || user?.is_superuser
  const isResponder = user?.role === "first_responder"

  // OpsWorkspace owns the responsive ladder now; this only decides whether the
  // command bar needs to offer a button for the dispatch pane, which it does
  // whenever that pane is not inline (below 1440).
  const isWideUp = useMinWidth(1440)
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
    active: isOfficial
      ? (summary as OfficialRoleSummary | null)?.active_emergencies ?? alerts.length
      : (summary as ResponderRoleSummary | null)?.assigned_active_emergencies ?? alerts.length,
    unassigned: alerts.filter((alert) => !alert.current_assignment).length,
    enRoute: alerts.filter((alert) => ["acknowledged", "en_route", "nearby"].includes(alert.status)).length,
    respondersOnDuty: (summary as OfficialRoleSummary | null)?.responders_on_duty ?? responders.length,
    awaitingAck: (summary as ResponderRoleSummary | null)?.assigned_active_emergencies ?? alerts.length,
  }), [alerts, isOfficial, responders.length, summary])

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!user) return
      setLoading(true)
      setError("")
      try {
        const [nextAlerts, nextResponders, nextSummary, requestedAlert, nextAppeals] = await Promise.all([
          isOfficial ? listEmergencyQueue() : isResponder ? listAssignedEmergencies() : Promise.resolve([]),
          isOfficial ? listActiveResponders() : Promise.resolve([]),
          isOfficial ? getOfficialDashboardSummary() : isResponder ? getResponderDashboardSummary() : Promise.resolve(null),
          requestedAlertId ? getEmergency(requestedAlertId).catch(() => null) : Promise.resolve(null),
          isOfficial ? listEmergencyAppeals() : Promise.resolve([]),
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
  }, [user, isOfficial, isResponder, requestedAlertId])

  function updateAlert(next: EmergencyAlert) {
    setAlerts((current) => current.map((alert) => (alert.id === next.id ? next : alert)))
    setSelectedId(next.id)
  }

  function selectAlert(id: number) {
    setSelectedId(id)
    if (!isLgUp) setMobileView("board")
  }

  if (!isOfficial && !isResponder) {
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

  // Severity band first, priority within it — the same rule the concern queue
  // uses, so an official does not have to learn two orderings.
  const triaged = triageAlerts(alerts, now)
  const unassignedCount = alerts.filter((alert) => !alert.current_assignment).length

  // Keyed by incident so switching alerts remounts the panel with clean local
  // state, instead of rendering once with the previous incident's selection.
  const actionsPanel = isOfficial ? (
    <DispatchPanel
      key={selected?.id ?? "none"}
      alert={selected}
      responders={responders}
      onChanged={updateAlert}
    />
  ) : selected ? (
    <ResponderActions alert={selected} onChanged={updateAlert} />
  ) : null

  const counters: OpsCounter[] = isOfficial
    ? [
        { label: "active", value: counts.active, tone: counts.active > 0 ? "alert" : "good" },
        { label: "unassigned", value: unassignedCount, tone: unassignedCount > 0 ? "alert" : "default" },
        { label: "on duty", value: counts.respondersOnDuty, tone: "live" },
        { label: "in queue", value: alerts.length },
      ]
    : [
        { label: "assigned", value: counts.active, tone: counts.active > 0 ? "alert" : "good" },
        { label: "en route", value: counts.enRoute, tone: "live" },
      ]

  const asideLabel = isOfficial ? "Dispatch" : "Responder actions"

  const bar = (
    <OpsBar
      title={isOfficial ? "Dispatch console" : "Field dashboard"}
      context={user?.barangay || "Barangay Marikina Heights"}
      counters={counters}
    >
      {!isWideUp && actionsPanel ? (
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
        title={isOfficial ? "Triage queue" : "Assigned alerts"}
      />
      <div className="space-y-2.5 p-3">
        {error ? (
          <p className="rounded-control border border-severity-critical/40 bg-severity-critical-surface px-3 py-2 text-label text-severity-critical-ink">
            {error}
          </p>
        ) : null}

        {isResponder ? <DutyPanel user={user} /> : null}

        {isOfficial && appeals.length > 0 ? (
          <EmergencyAppealsPanel
            appeals={appeals}
            onUpdated={(next) =>
              setAppeals((items) => items.map((item) => (item.id === next.id ? next : item)))
            }
          />
        ) : null}

        {loading ? (
          <p className="rounded-panel border border-card-line bg-card p-6 text-body text-muted-foreground">
            Loading emergencies…
          </p>
        ) : triaged.length === 0 ? (
          <div className="rounded-panel border border-card-line bg-card p-6 text-center">
            <ShieldCheckIcon className="mx-auto size-8 text-status-closed" />
            <h2 className="mt-2.5 text-heading text-foreground">No active emergencies</h2>
            <p className="mt-1 text-body text-muted-foreground">
              New SOS alerts and assignments appear here.
            </p>
          </div>
        ) : (
          triaged.map((entry) => (
            <QueueItem
              key={entry.alert.id}
              entry={entry}
              active={selected?.id === entry.alert.id}
              now={now}
              onSelect={() => selectAlert(entry.alert.id)}
            />
          ))
        )}
      </div>
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
          meta={selected ? selected.public_id : undefined}
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
    { id: "queue", role: "list", initial: 340, min: 280, max: 460, node: queuePane },
    { id: "record", role: "detail", min: 420, node: recordPane },
  ]

  if (actionsPanel) {
    panes.push({
      id: "action",
      role: "aside",
      initial: 360,
      min: 300,
      max: 480,
      label: asideLabel,
      node: (
        <>
          <OpsPaneHeader title={asideLabel} />
          <div className="p-3">{actionsPanel}</div>
        </>
      ),
    })
  }

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
