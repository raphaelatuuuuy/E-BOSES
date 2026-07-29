import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { LoaderCircleIcon, SearchIcon, XIcon } from "lucide-react"
import { toast } from "sonner"
import { useLocation } from "react-router-dom"

import { cn } from "@workspace/ui/lib/utils"
import { Sheet, SheetContent } from "@workspace/ui/components/sheet"
import { usePageTitle } from "@/hooks/use-page-title"
import { useAuthSession } from "@/features/auth/auth-session"
import { MOBILE_NAV_CLEARANCE, useIsDesktop } from "@/features/dashboard/lib/shell"
import {
  DISPATCH_PANEL_EVENT,
  wantsDispatchPanel,
} from "@/features/dashboard/lib/dispatch-panel"
import { useResponderUnit } from "@/features/dashboard/hooks/use-responder-unit"
import { formatElapsed } from "@/features/dashboard/lib/responder-format"
import {
  getActiveResponderShift,
  listAssignedEmergencies,
  sendEmergencyLocationPing,
  type EmergencyAlert,
  type ResponderShift,
} from "@/features/dashboard/emergency-api"
import {
  commentOnConcern,
  listAssignedConcerns,
  listFeedConcerns,
  voteConcern,
  type Concern,
} from "@/features/dashboard/api"
import { ResponderLeafletMap } from "@/features/dashboard/components/responder/responder-leaflet-map"
import { IncidentPanel } from "@/features/dashboard/components/responder/incident-panel"

const SELECTED_DISPATCH_KEY = "eboses:responder-dispatch-id"

const ACTIVE_STATUSES = new Set([
  "submitted",
  "routed",
  "acknowledged",
  "en_route",
  "nearby",
  "arrived",
])

function distanceKm(
  aLat?: string | number | null,
  aLng?: string | number | null,
  bLat?: string | number | null,
  bLng?: string | number | null,
) {
  if (aLat == null || aLng == null || bLat == null || bLng == null) return null
  const lat1 = Number(aLat)
  const lng1 = Number(aLng)
  const lat2 = Number(bLat)
  const lng2 = Number(bLng)
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return null
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLng = (lng2 - lng1) * rad
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

function locationFailureMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  const code = typeof error === "object" && error && "code" in error
    ? Number(error.code)
    : 0
  if (code === 1) return "Location permission was denied. Allow location for E-Boses in your browser settings, then try again."
  if (code === 2) return "Your location is unavailable. Move to an open area or turn on device location, then try again."
  if (code === 3) return "Location request timed out. Check your GPS signal and try again."
  return "Your location could not be read. Check device location access and try again."
}

export default function ResponderMapPage() {
  usePageTitle("Responder Map")
  const location = useLocation()
  const { user } = useAuthSession()
  const isDesktop = useIsDesktop()
  const viewerId = user?.id ?? null
  const [alerts, setAlerts] = useState<EmergencyAlert[]>([])
  const [concerns, setConcerns] = useState<Concern[]>([])
  const [assignedConcerns, setAssignedConcerns] = useState<Concern[]>([])
  const [assignedChatId, setAssignedChatId] = useState<number | null>(null)
  const [replyOpenId, setReplyOpenId] = useState<number | null>(null)
  const [selectedConcernId, setSelectedConcernId] = useState<number | null>(null)
  const [replyDraft, setReplyDraft] = useState("")
  const [concernBusy, setConcernBusy] = useState<number | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [userPos, setUserPos] = useState<GeolocationPosition | null>(null)
  const [loading, setLoading] = useState(true)
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState("")
  const [mapSearch, setMapSearch] = useState("")
  const [searchOpen, setSearchOpen] = useState(false)
  const [activeShift, setActiveShift] = useState<ResponderShift | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const unit = useResponderUnit()
  // On a phone the panel is a sheet the responder opens from the nav; on
  // desktop it is a docked rail that is always there. Arriving with `?panel=1`
  // means the responder pressed Dispatch from another screen.
  const [panelOpen, setPanelOpen] = useState(() => wantsDispatchPanel(window.location.search))
  const autoPingInFlightRef = useRef(false)
  const lastAutoPingRef = useRef<Record<number, number>>({})
  const concernCardRefs = useRef<Record<number, HTMLElement | null>>({})

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
    () => selected?.assignments.filter(
      (assignment) => !["cancelled", "declined", "resolved"].includes(assignment.status),
    ) ?? [],
    [selected],
  )
  const selectedRouteGeometry = useMemo(() => {
    const ownAssignment = selectedActiveTeam.find((assignment) => assignment.responder.id === viewerId)
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
    return alerts.filter((alert) => alert.status === "routed" && alert.assignments.some(
      (assignment) => assignment.responder.id === viewerId && assignment.acknowledged_at == null,
    )).length
  }, [alerts, viewerId])

  const query = mapSearch.trim().toLowerCase()

  /** Dispatch queue narrowed by the search box. Empty query means everything. */
  const listedAlerts = useMemo(() => {
    if (!query) return alerts
    return alerts.filter((alert) =>
      [alert.type, alert.address, alert.barangay, alert.note, alert.status.replace(/_/g, " ")]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query),
    )
  }, [alerts, query])

  /** Community concerns within range, before any search is applied. */
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

  const visibleConcerns = useMemo(() => {
    if (!query) return nearbyConcerns
    return nearbyConcerns.filter((concern) =>
      [concern.title, concern.description, concern.address, concern.barangay]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query),
    )
  }, [nearbyConcerns, query])

  // The map keeps every pin regardless of the search. Filtering is for reading
  // the lists; dropping pins would take away the spatial context that is the
  // whole reason the responder is looking at a map.
  const mapConcerns = useMemo(() => {
    const byId = new Map<number, Concern>()
    for (const concern of [...nearbyConcerns, ...assignedConcerns]) byId.set(concern.id, concern)
    return [...byId.values()]
  }, [nearbyConcerns, assignedConcerns])

  const refresh = useCallback(async () => {
    setError("")
    const [next, nearbyConcerns, nextAssignedConcerns] = await Promise.all([
      listAssignedEmergencies(),
      listFeedConcerns(undefined, undefined, undefined, undefined).catch(() => []),
      listAssignedConcerns().catch(() => []),
    ])
    setAlerts(next)
    setConcerns(nearbyConcerns.filter((concern) => concern.visibility === "community").slice(0, 12))
    setAssignedConcerns(nextAssignedConcerns)
    setSelectedId((current) => {
      const nextId = [preferredDispatchId, current, next[0]?.id]
        .find((candidate) => candidate != null && next.some((alert) => alert.id === candidate)) ?? null
      if (nextId) window.localStorage.setItem(SELECTED_DISPATCH_KEY, String(nextId))
      return nextId
    })
  }, [preferredDispatchId])

  const selectConcernFromMap = useCallback((concernId: number) => {
    setSelectedConcernId(concernId)
    window.requestAnimationFrame(() => {
      concernCardRefs.current[concernId]?.scrollIntoView({ behavior: "smooth", block: "center" })
    })
  }, [])

  const selectDispatch = useCallback((alertId: number) => {
    window.localStorage.setItem(SELECTED_DISPATCH_KEY, String(alertId))
    setSelectedId(alertId)
    // Picking a pin off the map is a request to read it.
    setPanelOpen(true)
  }, [])

  // Pressing Dispatch while already on this screen.
  useEffect(() => {
    function open() {
      setPanelOpen(true)
    }
    window.addEventListener(DISPATCH_PANEL_EVENT, open)
    return () => window.removeEventListener(DISPATCH_PANEL_EVENT, open)
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let cancelled = false
    void getActiveResponderShift()
      .then((shift) => {
        if (!cancelled) setActiveShift(shift)
      })
      .catch(() => {
        // The duty readout is context, not the job. A failure here must not
        // take the map down with it.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const setConcernCardRef = useCallback((id: number, node: HTMLElement | null) => {
    concernCardRefs.current[id] = node
  }, [])

  const applyAlertChange = useCallback((next: EmergencyAlert) => {
    setAlerts((current) => current.map((alert) => (alert.id === next.id ? next : alert)))
  }, [])

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => void refresh()
      .catch(() => {
        if (!cancelled) setError("Could not load assigned emergencies.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      }), 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [refresh])

  useEffect(() => {
    function handleNotification(event: Event) {
      const notification = (event as CustomEvent<{ concern_id?: number | null }>).detail
      if (!notification?.concern_id) return
      void refresh().catch(() => setError("A concern assignment arrived, but the map could not refresh."))
    }
    window.addEventListener("eboses:notification-created", handleNotification)
    return () => window.removeEventListener("eboses:notification-created", handleNotification)
  }, [refresh])

  async function likeConcern(concern: Concern) {
    setConcernBusy(concern.id)
    try {
      const result = await voteConcern(concern.id, concern.user_vote === 1 ? 0 : 1)
      setConcerns((current) => current.map((item) => item.id === concern.id
        ? { ...item, user_vote: result.user_vote, vote_count: result.vote_count }
        : item))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update support.")
    } finally {
      setConcernBusy(null)
    }
  }

  async function replyToConcern(concern: Concern) {
    const body = replyDraft.trim()
    if (!body) return
    setConcernBusy(concern.id)
    try {
      const comment = await commentOnConcern(concern.id, { body })
      setConcerns((current) => current.map((item) => item.id === concern.id
        ? { ...item, comments: [...item.comments, comment], comment_count: item.comment_count + 1 }
        : item))
      setReplyDraft("")
      setReplyOpenId(null)
      toast.success("Response posted")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not post response.")
    } finally {
      setConcernBusy(null)
    }
  }

  const requestPosition = useCallback(() => {
    return new Promise<GeolocationPosition>((resolve, reject) => {
      if (!window.isSecureContext) {
        reject(new Error("Location requires a secure HTTPS connection. Open the secure E-Boses address and try again."))
        return
      }
      if (!navigator.geolocation) {
        reject(new Error("GPS is not available on this device."))
        return
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 20000,
      })
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!cancelled) setUserPos(position)
      },
      (positionError) => {
        if (!cancelled) setError(locationFailureMessage(positionError))
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    )
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        if (!cancelled) setUserPos(position)
      },
      (positionError) => {
        if (!cancelled) setError(locationFailureMessage(positionError))
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
    )
    return () => {
      cancelled = true
      navigator.geolocation.clearWatch(watchId)
    }
  }, [])

  // En-route is display-only in the stepper (C1.4) — this loop is the sole
  // source of the routed/acknowledged -> en_route/nearby transition. It keeps
  // publishing every 15s for the life of the dispatch so ETA/route stay live.
  useEffect(() => {
    if (!selected || !userPos || !["routed", "acknowledged", "en_route", "nearby", "arrived"].includes(selected.status)) {
      return
    }
    const alertId = selected.id
    const publish = async () => {
      const now = Date.now()
      if (autoPingInFlightRef.current || now - (lastAutoPingRef.current[alertId] ?? 0) < 15_000) return
      autoPingInFlightRef.current = true
      try {
        const next = await sendEmergencyLocationPing(alertId, {
          latitude: userPos.coords.latitude,
          longitude: userPos.coords.longitude,
          accuracy: userPos.coords.accuracy,
        })
        lastAutoPingRef.current[alertId] = Date.now()
        setAlerts((current) => current.map((alert) => (alert.id === next.id ? next : alert)))
        setError((current) => current === "Live GPS could not sync to this dispatch." ? "" : current)
      } catch {
        setError("Live GPS could not sync to this dispatch.")
      } finally {
        autoPingInFlightRef.current = false
      }
    }
    void publish()
    const timer = window.setInterval(() => void publish(), 15_000)
    return () => window.clearInterval(timer)
  }, [selected, userPos])

  async function locateMe() {
    setLocating(true)
    try {
      const pos = await requestPosition()
      setUserPos(pos)
      toast.success("Location updated")
    } catch (positionError) {
      const message = locationFailureMessage(positionError)
      setError(message)
      toast.error(message)
    } finally {
      setLocating(false)
    }
  }

  const activeCount = useMemo(
    () => alerts.filter((alert) => ACTIVE_STATUSES.has(alert.status)).length,
    [alerts],
  )

  return (
    <div className="flex h-[100svh] min-h-[500px] flex-col overflow-hidden bg-canvas md:h-[100svh] md:min-h-[560px]">
      {/*
        Identity, a working search, and live state. The bar previously carried an
        All-locations dropdown and an ACTIVATE ALERT button that were both inert
        (responders cannot raise alerts — the API rejects it), and a search box
        whose value was never read.
      */}
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-rail-line bg-nav-glass px-3 backdrop-blur md:px-4">
        {!searchOpen ? (
          <div className="flex min-w-0 flex-1 items-baseline gap-2 sm:flex-initial">
            <span className="truncate text-sm font-bold text-nav-text-active">
              {unit.shortName}
            </span>
            <span className="shrink-0 text-micro uppercase tracking-wide text-nav-muted">
              {activeShift ? `On duty ${formatElapsed(activeShift.started_at, now)}` : "Off duty"}
            </span>
          </div>
        ) : null}

        {/* Below sm the field takes the bar over rather than fighting the
            identity readout for 40px. */}
        <div className={cn("min-w-0 flex-1 sm:max-w-md", !searchOpen && "hidden sm:block")}>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-nav-muted" />
            <input
              value={mapSearch}
              onChange={(event) => setMapSearch(event.target.value)}
              placeholder="Filter dispatches and nearby reports"
              aria-label="Filter dispatches and nearby reports"
              className="h-9 w-full rounded-lg border border-card-line bg-card-raised pl-8 pr-8 text-sm text-foreground placeholder:text-faint-foreground focus:border-ice focus:outline-none"
            />
            {mapSearch ? (
              <button
                type="button"
                onClick={() => setMapSearch("")}
                aria-label="Clear filter"
                className="absolute right-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded text-nav-muted hover:text-nav-text-active"
              >
                <XIcon className="size-3.5" />
              </button>
            ) : null}
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            setSearchOpen((open) => !open)
            if (searchOpen) setMapSearch("")
          }}
          aria-label={searchOpen ? "Close filter" : "Filter dispatches"}
          aria-expanded={searchOpen}
          className="flex size-9 shrink-0 items-center justify-center rounded-lg text-nav-muted hover:text-nav-text-active sm:hidden"
        >
          {searchOpen ? <XIcon className="size-4" /> : <SearchIcon className="size-4" />}
        </button>

        <span
          className={cn(
            "flex shrink-0 items-center gap-1.5 text-micro uppercase tracking-wide",
            searchOpen && "hidden sm:flex",
          )}
        >
          <span
            className={cn(
              "relative flex size-1.5 rounded-full",
              activeCount > 0 ? "bg-sos text-sos" : "bg-status-closed",
            )}
          >
            {activeCount > 0 ? (
              <span aria-hidden className="ops-pulse absolute inset-0 rounded-full" />
            ) : null}
          </span>
          <span className={activeCount > 0 ? "text-sos" : "text-nav-muted"}>
            {activeCount > 0 ? `${activeCount} active` : "All clear"}
          </span>
        </span>
      </div>

      {/* Map + panels */}
      <div className="relative flex flex-1 min-h-0">
        <section className="absolute inset-0">
          {loading ? (
            <div className="flex h-full items-center justify-center bg-card">
              <LoaderCircleIcon className="size-8 animate-spin text-nav-muted" />
            </div>
          ) : (
            <ResponderLeafletMap
              alerts={alerts}
              concerns={mapConcerns}
              selectedId={selected?.id ?? null}
              selectedConcernId={selectedConcernId}
              userPos={userPos}
              routeGeometry={selectedRouteGeometry}
              onSelect={selectDispatch}
              onSelectConcern={selectConcernFromMap}
              onLocateMe={() => void locateMe()}
              locating={locating}
            />
          )}
        </section>

        {error ? (
          <div
            role="alert"
            className="absolute left-3 right-3 top-3 z-30 rounded-xl border border-severity-critical bg-popover px-3 py-2 text-xs font-semibold text-severity-critical-ink shadow-sm sm:left-4 sm:right-auto sm:max-w-sm"
          >
            {error}
          </div>
        ) : null}

        {isDesktop ? (
          <aside className="absolute inset-y-4 right-4 z-30 w-[390px] max-w-[calc(100vw-2rem)] space-y-3 overflow-y-auto rounded-3xl border border-rail-line bg-rail-glass p-3 shadow-2xl backdrop-blur">
            <IncidentPanel
              alerts={listedAlerts}
              selected={selected}
              selectedDistance={selectedDistance}
              selectedActiveTeam={selectedActiveTeam}
              viewerId={viewerId}
              awaitingAckCount={awaitingAckCount}
              onClose={null}
              onChanged={applyAlertChange}
              onRefresh={refresh}
              onSelectDispatch={selectDispatch}
              assignedConcerns={assignedConcerns}
              assignedChatId={assignedChatId}
              onToggleAssignedChat={(id) => setAssignedChatId((current) => current === id ? null : id)}
              onConcernMessageSent={refresh}
              visibleConcerns={visibleConcerns}
              selectedConcernId={selectedConcernId}
              concernBusy={concernBusy}
              replyOpenId={replyOpenId}
              replyDraft={replyDraft}
              onReplyDraftChange={setReplyDraft}
              onToggleReply={(id) => setReplyOpenId((current) => current === id ? null : id)}
              onLikeConcern={(concern) => void likeConcern(concern)}
              onReplyToConcern={(concern) => void replyToConcern(concern)}
              concernCardRef={setConcernCardRef}
            />
          </aside>
        ) : (
          <Sheet open={panelOpen} onOpenChange={setPanelOpen} lockScroll={false}>
            <SheetContent
              overlayClassName="hidden"
              aria-label="Dispatch panel"
              // Rests on top of the nav row rather than behind it, so Map and
              // Shift stay reachable while a dispatch is open.
              style={{ bottom: MOBILE_NAV_CLEARANCE }}
              className="z-20 flex max-h-[58svh] flex-col rounded-t-3xl border-rail-line bg-rail-glass/95 shadow-2xl backdrop-blur"
            >
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3">
                <IncidentPanel
                  alerts={listedAlerts}
                  selected={selected}
                  selectedDistance={selectedDistance}
                  selectedActiveTeam={selectedActiveTeam}
                  viewerId={viewerId}
                  awaitingAckCount={awaitingAckCount}
                  onClose={() => setPanelOpen(false)}
                  onChanged={applyAlertChange}
                  onRefresh={refresh}
                  onSelectDispatch={selectDispatch}
                  assignedConcerns={assignedConcerns}
                  assignedChatId={assignedChatId}
                  onToggleAssignedChat={(id) => setAssignedChatId((current) => current === id ? null : id)}
                  onConcernMessageSent={refresh}
                  visibleConcerns={visibleConcerns}
                  selectedConcernId={selectedConcernId}
                  concernBusy={concernBusy}
                  replyOpenId={replyOpenId}
                  replyDraft={replyDraft}
                  onReplyDraftChange={setReplyDraft}
                  onToggleReply={(id) => setReplyOpenId((current) => current === id ? null : id)}
                  onLikeConcern={(concern) => void likeConcern(concern)}
                  onReplyToConcern={(concern) => void replyToConcern(concern)}
                  concernCardRef={setConcernCardRef}
                />
              </div>
            </SheetContent>
          </Sheet>
        )}
      </div>
    </div>
  )
}
