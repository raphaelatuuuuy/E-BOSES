import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import {
  ArrowLeftIcon,
  LoaderCircleIcon,
  MapIcon,
  ShieldCheckIcon,
} from "lucide-react"
import { toast } from "sonner"

import { cn } from "@workspace/ui/lib/utils"
import { usePageTitle } from "@/hooks/use-page-title"
import { useAuthSession } from "@/features/auth/auth-session"
import { distanceKm } from "@/features/dashboard/lib/responder-format"
import { ACTIVE_EMERGENCY_STATUSES } from "@/features/dashboard/components/record/status"
import {
  getEmergencyRoute,
  listAssignedEmergencies,
  sendEmergencyLocationPing,
  setEmergencyRouteProfile,
  type EmergencyAlert,
  type EmergencyRoute,
  type TravelProfile,
} from "@/features/dashboard/emergency-api"
import {
  listAssignedConcerns,
  listFeedConcerns,
  type Concern,
} from "@/features/dashboard/api"
import { ResponderLeafletMap } from "@/features/dashboard/components/responder/responder-leaflet-map"
import { OpsContrastToggle } from "@/features/dashboard/components/responder/ops-contrast-toggle"
import { DutyToggle } from "@/features/dashboard/components/responder/duty-toggle"
import { DispatchOverviewCard } from "@/features/dashboard/components/responder/dispatch-header"
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
import {
  drainGpsPings,
  enqueueGpsPing,
} from "@/features/dashboard/lib/offline-gps-queue"
import {
  isPositionStale,
  readLastKnownPosition,
  writeLastKnownPosition,
  type KnownPosition,
} from "@/features/dashboard/lib/last-known-position"
import { latLngsFromGeoJson } from "@/features/dashboard/lib/route-line"
import {
  offRouteMeters,
  stepProgress,
  type StepProgress,
} from "@/features/dashboard/lib/route-progress"
import { ResizableSplit } from "@/features/dashboard/components/workspace/resizable-split"
import { MOBILE_NAV_CLEARANCE, useIsDesktop } from "@/features/dashboard/lib/shell"
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

/** Past this the responder is not on the planned line any more. */
const OFF_ROUTE_METERS = 40
/** Consecutive fixes required, so one wide reading is not a wrong turn. */
const OFF_ROUTE_FIXES = 2
const REROUTE_COOLDOWN_MS = 20_000

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
  const navigate = useNavigate()
  const { user } = useAuthSession()
  const viewerId = user?.id ?? null

  const [alerts, setAlerts] = useState<EmergencyAlert[]>([])
  const [concerns, setConcerns] = useState<Concern[]>([])
  const [assignedConcerns, setAssignedConcerns] = useState<Concern[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [selectedConcernId, setSelectedConcernId] = useState<number | null>(null)
  // Seeded from the last stored fix so a responder who opens the console
  // without a signal still sees where they were, and their route with it.
  const [userPos, setUserPos] = useState<KnownPosition | null>(() => readLastKnownPosition(viewerId))
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

  const ownAssignment = useMemo(
    () => selectedActiveTeam.find((assignment) => assignment.responder.id === viewerId) ?? null,
    [selectedActiveTeam, viewerId],
  )

  const listRoute = useMemo(
    () => ownAssignment?.route ?? selectedActiveTeam[0]?.route ?? null,
    [ownAssignment, selectedActiveTeam],
  )

  const [routeDetail, setRouteDetail] = useState<EmergencyRoute | null>(null)
  const [travelProfileBusy, setTravelProfileBusy] = useState(false)
  // Held only while a switch is in flight; the assignment is the source of truth.
  const [profileOverride, setProfileOverride] = useState<TravelProfile | null>(null)

  const selectedId_ = selected?.id ?? null
  const travelProfile = profileOverride ?? ownAssignment?.travel_profile ?? "car"
  const route = (routeDetail?.alert_id === selectedId_ ? routeDetail : null) ?? listRoute

  const positionStale = isPositionStale(userPos, now)

  const selectedDistance = useMemo(() => {
    if (!selected || !userPos) return null
    return distanceKm(
      userPos.latitude,
      userPos.longitude,
      selected.latitude,
      selected.longitude,
    )
  }, [selected, userPos])

  /** Community concerns within range of the responder. */
  const nearbyConcerns = useMemo(() => {
    if (!userPos) return concerns
    return concerns.filter((concern) => {
      const distance = distanceKm(
        userPos.latitude,
        userPos.longitude,
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

  // Back from a focused dispatch behaves like every other page: return to the
  // previous tab (Shift holds the pill's anchor). The old in-page "queue
  // list" landing was removed — the queue count lives on the bottom-nav badge
  // and the focused dispatch is the tab's whole content.
  const backToPreviousPage = useCallback(() => {
    const historyState = window.history.state as { idx?: number } | null
    if (historyState && typeof historyState.idx === "number" && historyState.idx > 0) {
      navigate(-1)
    } else {
      navigate("/dashboard/responders/shift", { replace: true })
    }
  }, [navigate])

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
    function handleOnline() {
      void refresh().catch(() => {})
    }
    window.addEventListener("online", handleOnline)
    return () => window.removeEventListener("online", handleOnline)
  }, [refresh])

  useEffect(() => {
    let cancelled = false
    if (!navigator.geolocation) return
    // A failed read never clears the position. The last fix is kept and shown
    // as remembered instead, so losing signal does not blank the map.
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!cancelled) setUserPos(writeLastKnownPosition(position, viewerId))
      },
      (positionError) => {
        if (!cancelled) reportGeoError(locationFailureMessage(positionError))
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    )
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        if (!cancelled) setUserPos(writeLastKnownPosition(position, viewerId))
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
  }, [reportGeoError, viewerId])

  // Turn-by-turn comes only from the single-alert endpoint, on the same 15s
  // cadence as the GPS loop below that moves the route's start point.
  useEffect(() => {
    if (selectedId_ == null) return
    let cancelled = false
    const load = async () => {
      try {
        const next = await getEmergencyRoute(selectedId_, { steps: true })
        if (!cancelled) setRouteDetail(next ?? null)
      } catch {
        // Keep the list route on screen rather than blanking the map.
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), 30_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [selectedId_])

  const routeGeometry = route?.geometry
  const routeSteps = route?.steps
  const roadPoints = useMemo(() => latLngsFromGeoJson(routeGeometry), [routeGeometry])

  const offRoute = useMemo(() => {
    if (!userPos || positionStale) return null
    return offRouteMeters(roadPoints, [userPos.latitude, userPos.longitude])
  }, [roadPoints, userPos, positionStale])

  const progress = useMemo(() => {
    if (!userPos || positionStale || !routeSteps?.length) return null
    return stepProgress(roadPoints, routeSteps, [userPos.latitude, userPos.longitude])
  }, [roadPoints, routeSteps, userPos, positionStale])

  /**
   * Re-route when the responder has actually left the line.
   *
   * Two consecutive readings, because a single wide fix in an urban canyon is
   * not a wrong turn. The ping goes first so the router plans from where they
   * are now rather than from the last 15s ping, and the cooldown means a
   * drifting GPS cannot turn this into a request loop.
   */
  const offRouteStreakRef = useRef(0)
  const lastRerouteRef = useRef(0)
  useEffect(() => {
    if (selectedId_ == null || offRoute == null || !userPos) return
    if (offRoute <= OFF_ROUTE_METERS) {
      offRouteStreakRef.current = 0
      return
    }
    offRouteStreakRef.current += 1
    if (offRouteStreakRef.current < OFF_ROUTE_FIXES) return
    if (Date.now() - lastRerouteRef.current < REROUTE_COOLDOWN_MS) return

    offRouteStreakRef.current = 0
    lastRerouteRef.current = Date.now()
    const alertId = selectedId_
    void (async () => {
      try {
        await sendEmergencyLocationPing(alertId, {
          latitude: userPos.latitude,
          longitude: userPos.longitude,
          accuracy: userPos.accuracy ?? undefined,
        }).catch(() => {})
        const next = await getEmergencyRoute(alertId, { steps: true, refresh: true })
        setRouteDetail(next ?? null)
      } catch {
        // Throttled or offline: the next deviation attempt will retry.
      }
    })()
  }, [offRoute, selectedId_, userPos])

  const changeTravelProfile = useCallback(
    async (next: TravelProfile) => {
      if (selectedId_ == null || next === travelProfile || travelProfileBusy) return
      setProfileOverride(next)
      setTravelProfileBusy(true)
      try {
        const updated = await setEmergencyRouteProfile(selectedId_, next)
        setRouteDetail(updated ?? null)
        await refresh().catch(() => {})
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not switch the travel profile.",
          { id: "travel-profile" },
        )
      } finally {
        setProfileOverride(null)
        setTravelProfileBusy(false)
      }
    },
    [selectedId_, travelProfile, travelProfileBusy, refresh],
  )

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
      // A remembered fix is kept on the map but never published: telling the
      // server you are somewhere you left minutes ago is worse than silence.
      isPositionStale(userPos) ||
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
          latitude: userPos.latitude,
          longitude: userPos.longitude,
          accuracy: userPos.accuracy ?? undefined,
        })
        if (cancelled) return
        gpsToastShownRef.current = false
        // Connection is back: replay any positions buffered while offline so
        // the server catches up to where the responder travelled.
        for (const ping of drainGpsPings(alertId)) {
          await sendEmergencyLocationPing(alertId, {
            latitude: ping.latitude,
            longitude: ping.longitude,
            accuracy: ping.accuracy,
          }).catch(() => {})
        }
        lastAutoPingRef.current[alertId] = Date.now()
        setAlerts((current) => current.map((alert) => (alert.id === next.id ? next : alert)))
      } catch {
        if (!cancelled) {
          // Keep the latest fix so a patch of dead signal does not cost the
          // journey; the queue flushes on the next successful sync.
          enqueueGpsPing({
            alertId,
            latitude: userPos.latitude,
            longitude: userPos.longitude,
            accuracy: userPos.accuracy ?? undefined,
          })
          if (!gpsToastShownRef.current) {
            gpsToastShownRef.current = true
            toast.error("Live GPS could not sync. It will resend when the connection returns.", {
              id: "gps-sync",
            })
          }
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
      setUserPos(writeLastKnownPosition(pos, viewerId))
      toast.success("Location updated", { id: "locate" })
    } catch (positionError) {
      toast.error(locationFailureMessage(positionError), { id: "locate" })
    } finally {
      setLocating(false)
    }
  }

  const activeCount = useMemo(
    () => alerts.filter((alert) => ACTIVE_EMERGENCY_STATUSES.has(alert.status)).length,
    [alerts],
  )

  const mapSurface = (
    <ResponderLeafletMap
      // The dispatch map shows exactly the incident being worked, not the
      // whole assignment list. The full set of pins is on the responder Map
      // screen instead.
      alerts={selected ? [selected] : []}
      concerns={mapConcerns}
      selectedId={selected?.id ?? null}
      selectedConcernId={selectedConcernId}
      position={userPos}
      positionStale={positionStale}
      route={route}
      onSelect={selectDispatch}
      onSelectConcern={selectConcernFromMap}
      onLocateMe={() => void locateMe()}
      locating={locating}
    />
  )

  /**
   * Nothing assigned. This used to be a fixed-height map with a floating "all
   * clear" chip and nothing under it, which on a phone left most of the screen
   * blank. Now the state says what it means in a card of its own and the map
   * takes every pixel that is left.
   */
  const emptyState = (
    <div className="mx-auto flex min-h-0 w-full min-w-0 max-w-2xl flex-1 flex-col gap-3 lg:max-w-none">
      <DispatchCard className="shrink-0">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-white">
            <ShieldCheckIcon className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[22px] font-bold leading-tight tracking-tight text-foreground">
              All clear
            </h2>
            <p className="mt-1 text-body leading-6 text-muted-foreground">
              No emergency is assigned to you. You will be alerted here the moment one is.
            </p>
            {assignedConcerns.length > 0 ? (
              <p className="mt-2 text-body text-subtle-foreground">
                {assignedConcerns.length} community{" "}
                {assignedConcerns.length === 1 ? "report is" : "reports are"} assigned to you.
              </p>
            ) : null}
          </div>
        </div>
        <DutyToggle className="mt-4" />
      </DispatchCard>
      <DispatchCard
        padded={false}
        className="relative isolate z-0 min-h-[260px] flex-1 overflow-hidden"
      >
        {mapSurface}
      </DispatchCard>
    </div>
  )

  if (loading) {
    return (
      <div className="flex min-h-[60svh] flex-1 items-center justify-center lg:h-full">
        <LoaderCircleIcon className="size-8 animate-spin text-subtle-foreground" />
      </div>
    )
  }

  return (
    // flex-1 so the empty state can fill the shell's mobile column instead of
    // ending at a fixed height with blank canvas under it. Inert on desktop,
    // where the shell's main is not a flex container and lg:h-full governs.
    <div className="flex min-w-0 flex-1 flex-col p-4 lg:h-full lg:overflow-hidden lg:p-6">
      {selected ? (
        <DispatchBody
          alert={selected}
          viewerId={viewerId}
          activeCount={activeCount}
          selectedDistance={selectedDistance}
          now={now}
          route={route}
          progress={progress}
          travelProfile={travelProfile}
          onTravelProfileChange={(next) => void changeTravelProfile(next)}
          travelProfileBusy={travelProfileBusy}
          onAlertChanged={applyAlertChange}
          onRefresh={refresh}
          mapSurface={mapSurface}
          onMobileBack={backToPreviousPage}
        />
      ) : (
        emptyState
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
 *   ┌──────────────┬──────────────────────┐
 *   │              │         Map          │
 *   │   Incident   ├ ─ ─ ─ drag ─ ─ ─ ─ ─ ┤
 *   │   (card)     │                      │
 *   └──────╫───────┴──────────────────────┘
 *          drag
 *
 * The divider is draggable and remembers where it was left; the incident
 * column minimises and gives its space to the map. The chat is not a pane
 * of its own anymore — it moved into the incident card's Chat tab, so the
 * right column is the map and nothing else.
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
  route,
  progress,
  travelProfile,
  onTravelProfileChange,
  travelProfileBusy,
  onAlertChanged,
  onRefresh,
  mapSurface,
  onMobileBack,
}: {
  alert: EmergencyAlert
  viewerId: number | null
  activeCount: number
  selectedDistance: number | null
  now: number
  route: EmergencyRoute | null
  progress: StepProgress | null
  travelProfile: TravelProfile
  onTravelProfileChange: (next: TravelProfile) => void
  travelProfileBusy: boolean
  onAlertChanged: (next: EmergencyAlert) => void
  onRefresh: () => Promise<void>
  mapSurface: React.ReactNode
  onMobileBack: () => void
}) {
  const actions = useIncidentActions({
    alert,
    viewerId,
    onChanged: onAlertChanged,
    onRefresh,
  })

  const isDesktop = useIsDesktop()

  const [incidentCollapsed, setIncidentCollapsed] = usePaneCollapse(
    "eboses:dispatch-pane-incident",
  )
  const [mapCollapsed, setMapCollapsed] = usePaneCollapse("eboses:dispatch-pane-map")

  const incidentColumn = (
    <div className="ops-pane flex w-full min-w-0 flex-col gap-3 lg:pr-1">
      <DispatchOverviewCard
        alert={alert}
        viewerId={viewerId}
        distance={selectedDistance}
        now={now}
        route={route}
        progress={progress}
        travelProfile={travelProfile}
        onTravelProfileChange={onTravelProfileChange}
        travelProfileBusy={travelProfileBusy}
        onMinimise={() => setIncidentCollapsed(true)}
        className="shrink-0"
      />
      {/* Desktop keeps the action in the column it belongs to; on a phone it is
          pinned to the viewport instead (below). The canvas backdrop is what
          stops the column scrolling visibly under the pill. */}
      <DispatchActionBar
        actions={actions}
        className="sticky bottom-0 z-30 hidden bg-canvas pb-3 pt-3 lg:block"
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
      bodyClassName="relative overflow-hidden isolate"
      className="w-full"
    >
      {mapSurface}
      <BackupFab actions={actions} className="absolute bottom-4 left-4 z-[601]" />
    </Pane>
  )

  // The map owns the right column — communication moved into the dispatch
  // card's Chat tab, so there is nothing left to split against.
  const rightColumn = (
    <div className="flex min-h-0 w-full flex-col gap-3">
      <div className={cn("flex min-h-0", mapCollapsed ? "shrink-0" : "flex-1")}>{mapPane}</div>
    </div>
  )

  return isDesktop ? (
    <div className="flex h-full min-h-0 gap-3">
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
  ) : (
    <div
      className="fixed inset-x-0 top-14 z-10 flex flex-col bg-canvas"
      style={{ bottom: MOBILE_NAV_CLEARANCE }}
    >
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-card-line bg-canvas px-3">
        <button
          type="button"
          onClick={onMobileBack}
          aria-label="Back to previous page"
          className="flex size-10 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-card-raised"
        >
          <ArrowLeftIcon className="size-5" />
        </button>
        <span className="min-w-0 flex-1 truncate text-heading font-semibold capitalize text-foreground">
          {alert.type} dispatch
        </span>
        <DutyToggle />
        <OpsContrastToggle />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-3">
        <div className="mx-auto flex min-w-0 max-w-2xl flex-col gap-3">
          <DispatchOverviewCard
            alert={alert}
            viewerId={viewerId}
            distance={selectedDistance}
            now={now}
            route={route}
            progress={progress}
            travelProfile={travelProfile}
            onTravelProfileChange={onTravelProfileChange}
            travelProfileBusy={travelProfileBusy}
            showDutyToggle={false}
          />
          <DispatchCard padded={false} className="relative isolate z-0 h-[360px] overflow-hidden sm:h-[420px]">
            {mapSurface}
            <BackupFab actions={actions} className="absolute bottom-4 left-4 z-[601]" />
          </DispatchCard>
        </div>
      </div>

      <div className="shrink-0 border-t border-card-line bg-canvas/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        <DispatchActionBar actions={actions} />
        {activeCount > 1 ? (
          <p className="mt-2 text-center text-micro text-subtle-foreground">
            {activeCount} active dispatches assigned to you
          </p>
        ) : null}
      </div>
    </div>
  )
}
