import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLocation } from "react-router-dom"
import {
  LoaderCircleIcon,
  MapIcon,
  MessagesSquareIcon,
  ShieldCheckIcon,
} from "lucide-react"
import { toast } from "sonner"

import { cn } from "@workspace/ui/lib/utils"
import { usePageTitle } from "@/hooks/use-page-title"
import { useAuthSession } from "@/features/auth/auth-session"
import { MOBILE_BAR_CLEARANCE } from "@/features/dashboard/lib/shell"
import { distanceKm } from "@/features/dashboard/lib/responder-format"
import {
  listAssignedEmergencies,
  sendEmergencyLocationPing,
  type EmergencyAlert,
} from "@/features/dashboard/emergency-api"
import {
  listAssignedConcerns,
  listFeedConcerns,
  type Concern,
} from "@/features/dashboard/api"
import { ResponderLeafletMap } from "@/features/dashboard/components/responder/responder-leaflet-map"
import { DispatchOverviewCard } from "@/features/dashboard/components/responder/dispatch-header"
import { DispatchComms } from "@/features/dashboard/components/responder/dispatch-comms"
import { DispatchQueueRail } from "@/features/dashboard/components/responder/dispatch-queue-rail"
import {
  BackupFab,
  DispatchActionBar,
} from "@/features/dashboard/components/responder/dispatch-action-bar"
import {
  CollapsedStrip,
  DispatchCard,
  Pane,
} from "@/features/dashboard/components/responder/dispatch-surface"
import { usePaneCollapse } from "@/features/dashboard/components/responder/pane-collapse"
import { ResizableSplit } from "@/features/dashboard/components/workspace/resizable-split"
import { useIncidentActions } from "@/features/dashboard/components/responder/use-incident-actions"

/**
 * The responder dispatch console.
 *
 * Replaces the full-bleed map with a floating glass panel that carried the
 * dispatch, a stepper, a chat, two concern lists and the queue in one scroll.
 * Same data, laid out as a card stack: the dispatch and the responder's
 * progress on the left, the map and everything conversational on the right,
 * and exactly one action pinned where a thumb can reach it.
 *
 * State that used to live on the map page moves here wholesale — most
 * importantly the 15s auto-ping loop, which is the sole driver of the
 * routed/acknowledged -> en_route transition and therefore has to follow the
 * selected dispatch rather than be duplicated.
 */

const SELECTED_DISPATCH_KEY = "eboses:responder-dispatch-id"

// Active means "not settled": an emergency is still live through arrival, in
// progress, backup and escalation — only resolved/closed/cancelled/false
// alarm/invalid read as done. Mirrors ACTIVE_DISPATCH_STATUSES in
// use-assigned-dispatches.ts so the header count and the sidebar alarm agree.
const ACTIVE_STATUSES = new Set([
  "submitted",
  "routing",
  "routed",
  "awaiting_acknowledgment",
  "acknowledged",
  "en_route",
  "nearby",
  "arrived",
  "resident_safe",
  "backup_requested",
  "backup_assigned",
  "in_progress",
  "transfer_required",
  "escalation_required",
])

function locationFailureMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  const code = typeof error === "object" && error && "code" in error ? Number(error.code) : 0
  if (code === 1) return "Location permission was denied. Allow location for E-Boses in your browser settings, then try again."
  if (code === 2) return "Your location is unavailable. Move to an open area or turn on device location, then try again."
  if (code === 3) return "Location request timed out. Check your GPS signal and try again."
  return "Your location could not be read. Check device location access and try again."
}

export default function ResponderDispatchPage() {
  usePageTitle("Dispatch")
  const location = useLocation()
  const { user } = useAuthSession()
  const viewerId = user?.id ?? null

  const [alerts, setAlerts] = useState<EmergencyAlert[]>([])
  const [concerns, setConcerns] = useState<Concern[]>([])
  const [assignedConcerns, setAssignedConcerns] = useState<Concern[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [selectedConcernId, setSelectedConcernId] = useState<number | null>(null)
  const [userPos, setUserPos] = useState<GeolocationPosition | null>(null)
  const [loading, setLoading] = useState(true)
  const [locating, setLocating] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const autoPingInFlightRef = useRef(false)
  const lastAutoPingRef = useRef<Record<number, number>>({})
  // Errors surface as toasts, never as an inline banner — a banner that
  // appears and disappears in the page flow shoves the layout around. These
  // two refs keep the toasts from repeating every poll cycle while a problem
  // persists (a failing GPS ping fires every 15s; the geolocation watch can
  // fire more often than that).
  const gpsToastShownRef = useRef(false)
  const lastGeoErrorRef = useRef("")

  const reportGeoError = useCallback((message: string) => {
    if (lastGeoErrorRef.current === message) return
    lastGeoErrorRef.current = message
    toast.error(message)
  }, [])

  const preferredDispatchId = useMemo(() => {
    const queryId = Number(new URLSearchParams(location.search).get("alert"))
    const storedId = Number(window.localStorage.getItem(SELECTED_DISPATCH_KEY))
    return Number.isInteger(queryId) && queryId > 0
      ? queryId
      : Number.isInteger(storedId) && storedId > 0
        ? storedId
        : null
  }, [location.search])

  const selected = useMemo(
    () => alerts.find((alert) => alert.id === selectedId) ?? alerts[0] ?? null,
    [alerts, selectedId],
  )

  const selectedActiveTeam = useMemo(
    () =>
      selected?.assignments.filter(
        (assignment) => !["cancelled", "declined", "resolved"].includes(assignment.status),
      ) ?? [],
    [selected],
  )

  const selectedRouteGeometry = useMemo(() => {
    const ownAssignment = selectedActiveTeam.find(
      (assignment) => assignment.responder.id === viewerId,
    )
    return ownAssignment?.route?.geometry ?? selectedActiveTeam[0]?.route?.geometry ?? null
  }, [selectedActiveTeam, viewerId])

  const selectedDistance = useMemo(() => {
    if (!selected || !userPos) return null
    return distanceKm(
      userPos.coords.latitude,
      userPos.coords.longitude,
      selected.latitude,
      selected.longitude,
    )
  }, [selected, userPos])

  const awaitingAckCount = useMemo(() => {
    if (viewerId == null) return 0
    return alerts.filter(
      (alert) =>
        alert.status === "routed" &&
        alert.assignments.some(
          (assignment) => assignment.responder.id === viewerId && assignment.acknowledged_at == null,
        ),
    ).length
  }, [alerts, viewerId])

  /** Community concerns within range of the responder. */
  const nearbyConcerns = useMemo(() => {
    if (!userPos) return concerns
    return concerns.filter((concern) => {
      const distance = distanceKm(
        userPos.coords.latitude,
        userPos.coords.longitude,
        concern.latitude,
        concern.longitude,
      )
      return distance == null || distance <= 10
    })
  }, [concerns, userPos])

  const mapConcerns = useMemo(() => {
    const byId = new Map<number, Concern>()
    for (const concern of [...nearbyConcerns, ...assignedConcerns]) byId.set(concern.id, concern)
    return [...byId.values()]
  }, [nearbyConcerns, assignedConcerns])

  const refresh = useCallback(async () => {
    const [next, feedConcerns, nextAssignedConcerns] = await Promise.all([
      listAssignedEmergencies(),
      listFeedConcerns(undefined, undefined, undefined, undefined).catch(() => []),
      listAssignedConcerns().catch(() => []),
    ])
    setAlerts(next)
    setConcerns(feedConcerns.filter((concern) => concern.visibility === "community").slice(0, 12))
    setAssignedConcerns(nextAssignedConcerns)
    setSelectedId((current) => {
      const nextId =
        [preferredDispatchId, current, next[0]?.id].find(
          (candidate) => candidate != null && next.some((alert) => alert.id === candidate),
        ) ?? null
      if (nextId) window.localStorage.setItem(SELECTED_DISPATCH_KEY, String(nextId))
      return nextId
    })
  }, [preferredDispatchId])

  const selectDispatch = useCallback((alertId: number) => {
    window.localStorage.setItem(SELECTED_DISPATCH_KEY, String(alertId))
    setSelectedId(alertId)
  }, [])

  const selectConcernFromMap = useCallback((concernId: number) => {
    setSelectedConcernId(concernId)
  }, [])

  const applyAlertChange = useCallback((next: EmergencyAlert) => {
    setAlerts((current) => current.map((alert) => (alert.id === next.id ? next : alert)))
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(
      () =>
        void refresh()
          .catch(() => {
            if (!cancelled) toast.error("Could not load assigned emergencies.", { id: "assigned-load" })
          })
          .finally(() => {
            if (!cancelled) setLoading(false)
          }),
      0,
    )
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [refresh])

  useEffect(() => {
    function handleNotification(event: Event) {
      const notification = (event as CustomEvent<{ concern_id?: number | null }>).detail
      if (!notification?.concern_id) return
      void refresh().catch(() =>
        toast.error("A concern assignment arrived, but the dispatch could not refresh.", {
          id: "concern-arrive",
        }),
      )
    }
    window.addEventListener("eboses:notification-created", handleNotification)
    return () => window.removeEventListener("eboses:notification-created", handleNotification)
  }, [refresh])

  useEffect(() => {
    let cancelled = false
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!cancelled) setUserPos(position)
      },
      (positionError) => {
        if (!cancelled) reportGeoError(locationFailureMessage(positionError))
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    )
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        if (!cancelled) setUserPos(position)
      },
      (positionError) => {
        if (!cancelled) reportGeoError(locationFailureMessage(positionError))
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
    )
    return () => {
      cancelled = true
      navigator.geolocation.clearWatch(watchId)
    }
  }, [reportGeoError])

  // En-route is display-only in the timeline — this loop is the sole source of
  // the routed/acknowledged -> en_route/nearby transition. It keeps publishing
  // every 15s while the responder is travelling so ETA/route stay live, and
  // stops the moment they arrive: the loop's whole job is the journey, so a
  // responder parked on scene should not keep spamming pings (and status
  // events) forever — which is what it did when "arrived" was in this set.
  useEffect(() => {
    if (
      !selected ||
      !userPos ||
      !["routed", "acknowledged", "en_route", "nearby"].includes(selected.status)
    ) {
      return
    }
    const alertId = selected.id
    // Resolving mid-flight rejects the ping that was already on the wire. The
    // effect re-runs the moment the status changes, so this flag lets that
    // late rejection be ignored instead of showing a "GPS could not sync"
    // toast over a dispatch that is already closed.
    let cancelled = false
    const publish = async () => {
      const at = Date.now()
      if (autoPingInFlightRef.current || at - (lastAutoPingRef.current[alertId] ?? 0) < 15_000) return
      autoPingInFlightRef.current = true
      try {
        const next = await sendEmergencyLocationPing(alertId, {
          latitude: userPos.coords.latitude,
          longitude: userPos.coords.longitude,
          accuracy: userPos.coords.accuracy,
        })
        if (cancelled) return
        lastAutoPingRef.current[alertId] = Date.now()
        setAlerts((current) => current.map((alert) => (alert.id === next.id ? next : alert)))
        gpsToastShownRef.current = false
      } catch {
        if (!cancelled && !gpsToastShownRef.current) {
          gpsToastShownRef.current = true
          toast.error("Live GPS could not sync to this dispatch.", { id: "gps-sync" })
        }
      } finally {
        autoPingInFlightRef.current = false
      }
    }
    void publish()
    const timer = window.setInterval(() => void publish(), 15_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [selected, userPos])

  async function locateMe() {
    setLocating(true)
    try {
      if (!window.isSecureContext) {
        throw new Error("Location requires a secure HTTPS connection. Open the secure E-Boses address and try again.")
      }
      if (!navigator.geolocation) throw new Error("GPS is not available on this device.")
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 20000,
        })
      })
      setUserPos(pos)
      toast.success("Location updated", { id: "locate" })
    } catch (positionError) {
      toast.error(locationFailureMessage(positionError), { id: "locate" })
    } finally {
      setLocating(false)
    }
  }

  const activeCount = useMemo(
    () => alerts.filter((alert) => ACTIVE_STATUSES.has(alert.status)).length,
    [alerts],
  )

  const mapSurface = (
    <ResponderLeafletMap
      // The dispatch map shows exactly the incident being worked, not the
      // whole assignment list — that list lives in the queue rail, and a map
      // with pins for every assignment competes with the one that matters.
      // The full set of pins is on the responder Map screen instead.
      alerts={selected ? [selected] : []}
      concerns={mapConcerns}
      selectedId={selected?.id ?? null}
      selectedConcernId={selectedConcernId}
      userPos={userPos}
      routeGeometry={selectedRouteGeometry}
      onSelect={selectDispatch}
      onSelectConcern={selectConcernFromMap}
      onLocateMe={() => void locateMe()}
      locating={locating}
      overlay={
        <DispatchQueueRail
          alerts={alerts}
          selectedId={selected?.id ?? null}
          viewerId={viewerId}
          awaitingAckCount={awaitingAckCount}
          onSelect={selectDispatch}
          onRefresh={() => void refresh().catch(() => toast.error("Could not refresh dispatches.", { id: "refresh" }))}
        />
      }
    />
  )

  // The empty state has no incident column to split against, so the map keeps
  // its plain card here, with the "all clear" reading as a badge over it.
  const mapCard = (
    <DispatchCard padded={false} className="relative isolate z-0 h-[360px] sm:h-[420px] lg:h-full">
      {mapSurface}
      <div className="pointer-events-none absolute left-3 top-3 z-[1000] flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1.5 shadow-lg">
        <ShieldCheckIcon className="size-4" />
        <span className="text-[12.5px] font-bold leading-none text-white">All clear</span>
      </div>
    </DispatchCard>
  )

  if (loading) {
    return (
      <div className="flex min-h-[60svh] items-center justify-center lg:h-full">
        <LoaderCircleIcon className="size-8 animate-spin text-subtle-foreground" />
      </div>
    )
  }

  return (
    <div className="min-w-0 p-4 lg:h-full lg:overflow-hidden lg:p-6">
      {selected ? (
        <DispatchBody
          alert={selected}
          viewerId={viewerId}
          activeCount={activeCount}
          selectedDistance={selectedDistance}
          now={now}
          onAlertChanged={applyAlertChange}
          onRefresh={refresh}
          mapSurface={mapSurface}
        />
      ) : (
        <div className="mx-auto min-w-0 max-w-2xl lg:h-full lg:max-w-none">{mapCard}</div>
      )}
    </div>
  )
}

/**
 * Split out so the action hook, which needs a non-null alert, can be called
 * unconditionally rather than behind the empty-state branch.
 *
 * Desktop layout is two nested splits rather than a fixed grid:
 *
 *   ┌──────────────┬──────────────────────────┐
 *   │              │           Map            │
 *   │   Incident   ├ ─ ─ ─ drag ─ ─ ─ ─ ─ ─ ─ ┤
 *   │              │          Comms           │
 *   └──────╫───────┴──────────────────────────┘
 *          drag
 *
 * Every divider is draggable and remembers where it was left; every region
 * minimises and gives its space to its neighbour. The old layout hard-coded
 * `minmax(360px,400px)` for the incident column and a 3:2 flex ratio for the
 * map and comms, which is why nothing on the screen could be made bigger —
 * the chat in particular was stuck at two fifths of the right column no matter
 * how much of it a responder needed to read.
 *
 * Below the desktop breakpoint this reverts to one scrolling column: a phone
 * has no space to divide, and drag handles on a touch screen would fight the
 * map's own pan gesture.
 */
function DispatchBody({
  alert,
  viewerId,
  activeCount,
  selectedDistance,
  now,
  onAlertChanged,
  onRefresh,
  mapSurface,
}: {
  alert: EmergencyAlert
  viewerId: number | null
  activeCount: number
  selectedDistance: number | null
  now: number
  onAlertChanged: (next: EmergencyAlert) => void
  onRefresh: () => Promise<void>
  mapSurface: React.ReactNode
}) {
  const actions = useIncidentActions({
    alert,
    viewerId,
    onChanged: onAlertChanged,
    onRefresh,
  })

  const [incidentCollapsed, setIncidentCollapsed] = usePaneCollapse(
    "eboses:dispatch-pane-incident",
  )
  const [mapCollapsed, setMapCollapsed] = usePaneCollapse("eboses:dispatch-pane-map")
  const [commsCollapsed, setCommsCollapsed] = usePaneCollapse("eboses:dispatch-pane-comms")

  const activeTeamSize = alert.assignments.filter(
    (assignment) => !["cancelled", "declined", "resolved"].includes(assignment.status),
  ).length

  const incidentColumn = (
    <div className="ops-pane flex w-full min-w-0 flex-col gap-3 lg:pr-1">
      <DispatchOverviewCard
        alert={alert}
        viewerId={viewerId}
        distance={selectedDistance}
        now={now}
        onMinimise={() => setIncidentCollapsed(true)}
        className="shrink-0"
      />
      {/* Desktop keeps the action in the column it belongs to; on a phone it is
          pinned to the viewport instead (below). The canvas backdrop is what
          stops the column scrolling visibly under the pill. */}
      <DispatchActionBar
        actions={actions}
        className="sticky bottom-0 z-[800] hidden bg-canvas pb-3 pt-3 lg:block"
      />
    </div>
  )

  const mapPane = (
    <Pane
      title="Map"
      icon={MapIcon}
      collapsed={mapCollapsed}
      onCollapsedChange={setMapCollapsed}
      padded={false}
      bodyClassName="relative overflow-hidden"
      className="w-full"
    >
      {mapSurface}
      <BackupFab actions={actions} className="absolute bottom-4 left-4 z-[601]" />
    </Pane>
  )

  const commsPane = (
    <Pane
      title="Communication"
      icon={MessagesSquareIcon}
      collapsed={commsCollapsed}
      onCollapsedChange={setCommsCollapsed}
      padded={false}
      bodyClassName="flex flex-col overflow-hidden p-4"
      className="w-full"
    >
      <DispatchComms
        alert={alert}
        activeTeamSize={activeTeamSize}
        className="min-h-0 flex-1"
      />
    </Pane>
  )

  // A minimised pane shrinks to its 56px header rather than disappearing, so
  // the chevron that restores it is always on screen.
  const rightColumn =
    mapCollapsed || commsCollapsed ? (
      <div className="flex min-h-0 w-full flex-col gap-3">
        <div className={cn("flex min-h-0", mapCollapsed ? "shrink-0" : "flex-1")}>{mapPane}</div>
        <div className={cn("flex min-h-0", commsCollapsed ? "shrink-0" : "flex-1")}>
          {commsPane}
        </div>
      </div>
    ) : (
      <ResizableSplit
        orientation="horizontal"
        label="Resize map and comms"
        storageKey="eboses:dispatch-split-right"
        defaultSize={58}
        minSize={22}
        maxSize={78}
        className="w-full flex-1"
        first={mapPane}
        second={commsPane}
      />
    )

  return (
    <>
      {/* Desktop: two nested splits. */}
      <div className="hidden lg:flex lg:h-full lg:min-h-0 lg:gap-3">
        {incidentCollapsed ? (
          <>
            <CollapsedStrip label="Incident" onExpand={() => setIncidentCollapsed(false)} />
            <div className="flex min-h-0 min-w-0 flex-1">{rightColumn}</div>
          </>
        ) : (
          <ResizableSplit
            orientation="vertical"
            label="Resize incident column"
            storageKey="eboses:dispatch-split-main"
            defaultSize={32}
            minSize={22}
            maxSize={55}
            className="h-full flex-1"
            first={incidentColumn}
            second={rightColumn}
          />
        )}
      </div>

      {/* Mobile / tablet: one scrolling column, no handles. */}
      <div className="mx-auto flex min-w-0 max-w-2xl flex-col gap-3 lg:hidden">
        <DispatchOverviewCard
          alert={alert}
          viewerId={viewerId}
          distance={selectedDistance}
          now={now}
        />
        <DispatchCard padded={false} className="relative isolate z-0 h-[360px] overflow-hidden sm:h-[420px]">
          {mapSurface}
          <BackupFab actions={actions} className="absolute bottom-4 left-4 z-[601]" />
        </DispatchCard>
        <DispatchCard className="flex min-h-[420px] min-w-0 flex-col overflow-hidden">
          <DispatchComms
            alert={alert}
            activeTeamSize={activeTeamSize}
            className="min-h-0 flex-1"
          />
        </DispatchCard>
      </div>

      {/* Mobile: one action, always in the same place, above the nav bar. */}
      <div
        className={cn(
          "sticky z-[800] -mx-4 mt-3 border-t border-card-line bg-canvas/95 px-4 pb-3 pt-3 backdrop-blur lg:hidden",
        )}
        style={{ bottom: MOBILE_BAR_CLEARANCE }}
      >
        <DispatchActionBar actions={actions} />
        {activeCount > 1 ? (
          <p className="mt-2 text-center text-micro uppercase text-subtle-foreground">
            {activeCount} active dispatches assigned to you
          </p>
        ) : null}
      </div>
    </>
  )
}
