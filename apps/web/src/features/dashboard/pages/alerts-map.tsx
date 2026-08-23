import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { useNavigate } from "react-router-dom"
import {
  AlertTriangleIcon,
  ChevronLeftIcon,
  CircleAlertIcon,
  CloudSunIcon,
  LeafIcon,
  MegaphoneIcon,
  SearchIcon,
  ShieldCheckIcon,
  TrafficConeIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { useAuthSession } from "@/features/auth/auth-session"
import {
  getOfficialLiveMap,
  type ConcernCategory,
  type LiveMapEmergency,
  type LiveMapSnapshot,
  type LiveMapUpdate,
} from "@/features/dashboard/api"
import { useIsDesktop } from "@/features/dashboard/lib/shell"
import { useBottomSheetSnap } from "@/features/dashboard/lib/use-bottom-sheet-snap"
import { usePageTitle } from "@/hooks/use-page-title"
import { websocketTicket, websocketUrl } from "@/lib/api"

import { streetOnly } from "@/features/dashboard/lib/location-text"
import { timeAgo } from "@/features/dashboard/lib/format"
import { responderUnitLabel } from "@/features/dashboard/lib/people"
import { concernCategoryLabel } from "@/features/dashboard/components/concerns/concern-display"
import { advisoryLabel } from "@/features/dashboard/components/community-content/advisory-tags"
import {
  MapWeatherCard,
  MapWeatherIcon,
  useMapWeather,
  type MapWeatherState,
} from "@/features/dashboard/components/map-weather"
import {
  MapFilterChips,
  type MapFilterChip,
} from "@/features/dashboard/components/map/filter-chips"

import { AlertsLeafletMap } from "@/features/dashboard/components/alerts-map/leaflet-map"
import { DetailPanel } from "@/features/dashboard/components/alerts-map/detail-panel"
import {
  AlertCard,
  type AlertCardModel,
} from "@/features/dashboard/components/alerts-map/alert-card"
import {
  isActiveConcern,
  isResolvedRecord,
  isActiveEmergency,
  defaultLayers,
  emptyLiveMapSnapshot,
  mergeUpdate,
  validCoord,
  type LayerKey,
  type Selection,
} from "@/features/dashboard/components/alerts-map/lib"

/**
 * Stable identity, created once. The map is memoised on its props, so handing
 * it a fresh empty snapshot each render would rebuild every layer.
 */
const PENDING_SNAPSHOT = emptyLiveMapSnapshot()

const FEED_CHIPS: MapFilterChip[] = [
  { key: "all", label: "All" },
  { key: "emergencies", label: "Emergencies" },
  { key: "concerns", label: "Concerns" },
  { key: "announcements", label: "Announcements" },
  { key: "resolved", label: "Resolved" },
]

const SELECTION_LABEL: Record<"emergency" | "concern" | "person", string> = {
  emergency: "Emergency",
  concern: "Concern",
  person: "Person",
}

function ConcernIcon({ category, className }: { category: ConcernCategory; className?: string }) {
  if (category === "infrastructure") return <TrafficConeIcon className={className} strokeWidth={1.9} />
  if (category === "environment") return <LeafIcon className={className} strokeWidth={1.9} />
  if (category === "public_safety") return <ShieldCheckIcon className={className} strokeWidth={1.9} />
  return <SearchIcon className={className} strokeWidth={1.9} />
}

function titleCase(value: string) {
  return value.replace(/_/g, " ").trim()
}

type FeedRow = {
  key: string
  selection?: Selection
  model: AlertCardModel
  icon: ReactNode
  onAction?: () => void
}

const AlertsFeed = memo(function AlertsFeed({
  areaName,
  total,
  rows,
  onSelect,
  weatherMode = false,
  weatherToggle,
  weather,
}: {
  areaName: string
  total: number
  rows: FeedRow[]
  onSelect: (selection: Selection) => void
  weatherMode?: boolean
  weatherToggle?: ReactNode
  weather?: MapWeatherState
}) {
  const asOf = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  return (
    <>
      <div className="shrink-0 bg-white px-4 pb-2 pt-3 sm:pt-4">
        <div className="flex items-center gap-2.5">
          <div className="min-w-0 flex-1">
            <h1 className="text-[18px] font-bold leading-tight tracking-tight text-neutral-900 sm:text-[20px]">
              {weatherMode ? "Weather in" : "Alerts in"}{" "}
              <span className="text-brand-orange" style={{ color: "var(--color-brand-orange)" }}>
                {areaName}
              </span>
            </h1>
            <p className="mt-0.5 text-[12px] text-neutral-500">
              {weatherMode ? `As of ${asOf}` : `${total} on the map`}
            </p>
          </div>
          {!weatherMode && weatherToggle}
        </div>
      </div>

      <div
        className={cn(
          "scrollbar-hide relative min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4",
          weatherMode ? "px-4" : "px-3",
        )}
      >
        {weatherMode && weather ? (
          <MapWeatherCard weather={weather} framed={false} />
        ) : rows.length === 0 ? (
          <div className="px-3 py-10 text-center">
            <p className="text-[14px] font-semibold text-neutral-800 sm:text-[15px]">
              Nothing active right now
            </p>
            <p className="mt-1 text-[12px] text-neutral-500 sm:text-[13px]">
              New concerns and emergencies appear here the moment they are filed.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <li key={row.key}>
                <AlertCard
                  model={row.model}
                  icon={row.icon}
                  expanded={false}
                  onOpen={() => (row.selection ? onSelect(row.selection) : row.onAction?.())}
                  onAction={row.onAction}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
})

export default function AlertsMapPage() {
  usePageTitle("Alerts Map")
  const { user } = useAuthSession()
  const isDesktop = useIsDesktop()
  const navigate = useNavigate()
  const [snapshot, setSnapshot] = useState<LiveMapSnapshot | null>(null)
  const [layers, setLayers] = useState(defaultLayers)
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const [selected, setSelected] = useState<Selection>(() => {
    const alertId = Number(new URLSearchParams(window.location.search).get("alert"))
    return Number.isInteger(alertId) && alertId > 0 ? { kind: "emergency", id: alertId } : null
  })
  const [feedChip, setFeedChip] = useState<string>("all")
  const [weatherOpen, setWeatherOpen] = useState(false)

  const sheet = useBottomSheetSnap({ enabled: !isDesktop })

  const weatherBase = snapshot ?? PENDING_SNAPSHOT
  const weather = useMapWeather(
    weatherBase.map.center.latitude,
    weatherBase.map.center.longitude,
    weatherBase.map.boundary.name,
  )

  const weatherButton = (
    <button
      type="button"
      onClick={() => {
        setFeedChip("all")
        setWeatherOpen((value) => !value)
      }}
      aria-label={weatherOpen ? "Show the alerts list" : "Show the weather details"}
      aria-expanded={weatherOpen}
      title="Weather"
      className="flex shrink-0 items-center gap-1.5 text-[18px] font-bold leading-tight tracking-tight text-neutral-900 transition-opacity hover:opacity-70 sm:text-[20px]"
    >
      {weather.loading && weather.temperature == null ? (
        <CloudSunIcon className="size-5 shrink-0" />
      ) : (
        <MapWeatherIcon code={weather.code} className="size-5 shrink-0" />
      )}
      <span className="tabular-nums">
        {weather.temperature != null ? `${Math.round(weather.temperature)}°C` : "—"}
      </span>
    </button>
  )

  const collapseSheetForMap = useCallback(() => {
    if (isDesktop) return
    sheet.snapTo("hidden")
  }, [isDesktop, sheet])

  async function load() {
    try {
      setSnapshot(await getOfficialLiveMap())
    } catch {
      setSnapshot((current) => current ?? PENDING_SNAPSHOT)
    }
  }

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(), 0)
    return () => {
      window.clearTimeout(initialLoad)
    }
  }, [])

  useEffect(() => {
    let socket: WebSocket | null = null
    let reconnectTimer: number | undefined
    let closed = false
    let attempts = 0
    let pending: LiveMapUpdate[] = []
    let flushTimer: number | undefined

    const flushPending = () => {
      flushTimer = undefined
      if (!pending.length) return
      const batch = pending
      pending = []
      setSnapshot((current) => (current ? batch.reduce(mergeUpdate, current) : current))
    }

    const reconnectDelay = () => {
      attempts += 1
      const backoff = Math.min(30_000, 1500 * 2 ** attempts)
      return backoff / 2 + Math.random() * (backoff / 2)
    }

    async function connect() {
      try {
        const ticket = await websocketTicket()
        if (closed) return
        socket = new WebSocket(
          websocketUrl(`/ws/dashboard/live-map/?ticket=${encodeURIComponent(ticket)}`),
        )
      } catch {
        if (!closed) {
          reconnectTimer = window.setTimeout(() => void connect(), reconnectDelay())
        }
        return
      }
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as LiveMapUpdate
          if (message.type === "concern.ai_assessment.updated") {
            window.dispatchEvent(
              new CustomEvent("eboses:concern-updated", {
                detail: { concernId: message.payload.concern_id, source: "ai_assessment" },
              }),
            )
          }
          pending.push(message)
          if (flushTimer == null) {
            flushTimer = window.setTimeout(flushPending, 150)
          }
        } catch {
          // Polling keeps the page correct if a live patch is malformed.
        }
      }
      socket.onopen = () => {
        attempts = 0
      }
      socket.onclose = () => {
        if (!closed) {
          reconnectTimer = window.setTimeout(() => void connect(), reconnectDelay())
        }
      }
      socket.onerror = () => socket?.close()
    }

    void connect()
    return () => {
      closed = true
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
      if (flushTimer != null) window.clearTimeout(flushTimer)
      socket?.close()
    }
  }, [user?.id])

  // Memoised: this was recomputed on every render, handing a fresh array
  // identity to the two useMemos below and stopping either from ever hitting.
  const resolvedRecords = useMemo(
    () => ({
      concerns: snapshot?.concerns.filter(isResolvedRecord) ?? [],
      emergencies: snapshot?.emergencies.filter((emergency) => !isActiveEmergency(emergency)) ?? [],
    }),
    [snapshot],
  )
  const visibleConcerns = useMemo(() => {
    const active = snapshot?.concerns.filter(isActiveConcern) ?? []
    return layers.resolved ? [...active, ...resolvedRecords.concerns] : active
  }, [snapshot, layers.resolved, resolvedRecords])
  const visibleEmergencies = useMemo(() => {
    const active = snapshot?.emergencies.filter(isActiveEmergency) ?? []
    return layers.resolved ? [...active, ...resolvedRecords.emergencies] : active
  }, [snapshot, layers.resolved, resolvedRecords])
  const mapSelectedStreetNames = useMemo(() => new Set<string>(), [])

  const toggleLayer = useCallback((key: LayerKey) => {
    setLayers((current) => ({ ...current, [key]: !current[key] }))
  }, [])

  const resetLayers = useCallback(() => setLayers(defaultLayers), [])

  const selectOnMap = useCallback((next: Selection) => {
    setPanelCollapsed(false)
    setSelected(next)
  }, [])

  const clearSelection = useCallback(() => setSelected(null), [])

  const updateEmergency = useCallback((next: LiveMapEmergency) => {
    setSnapshot((current) => current ? { ...current, emergencies: current.emergencies.map((item) => item.id === next.id ? next : item) } : current)
  }, [])

  const feedRows = useMemo<FeedRow[]>(() => {
    if (!snapshot) return []
    const rows: Array<FeedRow & { rank: number; time: number }> = []
    const streetOf = (record: { address?: string | null; barangay?: string | null }) =>
      streetOnly(record.address?.trim()) || (record.barangay ? `In ${record.barangay}` : "")

    if (feedChip === "all" || feedChip === "emergencies") {
      for (const emergency of visibleEmergencies) {
        const live = isActiveEmergency(emergency)
        const street = streetOf(emergency)
        const assignment = emergency.current_assignment
        const unit = responderUnitLabel(assignment?.responder.responder_unit)
        rows.push({
          key: `emergency-${emergency.id}`,
          selection: { kind: "emergency", id: emergency.id },
          icon: <AlertTriangleIcon className="size-5" strokeWidth={1.9} />,
          rank: live ? (assignment ? 1 : 0) : 2,
          time: new Date(emergency.created_at).getTime(),
          model: {
            kind: "emergency",
            id: emergency.id,
            live,
            closed: !live,
            title: live
              ? `Ongoing ${titleCase(emergency.type)}${street ? ` around ${street}` : ""}`
              : `${titleCase(emergency.type)} emergency`,
            meta: [street, timeAgo(emergency.created_at)].filter(Boolean).join(" · "),
            status: assignment
              ? [assignment.responder.full_name, unit, titleCase(assignment.status)]
                  .filter(Boolean)
                  .join(" · ")
              : "Unassigned",
            snippet: emergency.note || "",
            actionLabel: assignment ? "Open in Emergency Ops" : "Assign a responder",
          },
          onAction: assignment
            ? () => navigate(`/dashboard/emergencies?alert=${emergency.id}`)
            : () => selectOnMap({ kind: "emergency", id: emergency.id }),
        })
      }
    }

    if (feedChip === "all" || feedChip === "concerns") {
      for (const concern of visibleConcerns) {
        const closed = isResolvedRecord(concern)
        const street = streetOf(concern)
        rows.push({
          key: `concern-${concern.id}`,
          selection: { kind: "concern", id: concern.id },
          icon: <ConcernIcon category={concern.category} className="size-5" />,
          rank: 3,
          time: new Date(concern.created_at).getTime(),
          model: {
            kind: "concern",
            id: concern.id,
            live: false,
            closed,
            title: concern.title,
            meta: [concernCategoryLabel(concern), street, timeAgo(concern.created_at)]
              .filter(Boolean)
              .join(" · "),
            status: [
              concern.priority === "high" ? "High priority" : null,
              concern.reporter.full_name,
            ]
              .filter(Boolean)
              .join(" · "),
            snippet: concern.description || "",
            actionLabel: "Open full report",
          },
          onAction: () => navigate(`/dashboard/reports/${concern.id}`),
        })
      }
    }

    if (feedChip === "announcements") {
      for (const advisory of snapshot.advisories ?? []) {
        const startsAt = advisory.starts_at ?? advisory.expires_at
        rows.push({
          key: `advisory-${advisory.id}`,
          icon: <MegaphoneIcon className="size-5" strokeWidth={1.9} />,
          rank: 4,
          time: startsAt ? new Date(startsAt).getTime() : 0,
          model: {
            kind: "advisory",
            id: advisory.id,
            live: false,
            closed: false,
            title: advisory.title,
            meta: [
              advisoryLabel(advisory.tag),
              advisory.affected_streets.length
                ? `${advisory.affected_streets.length} street${advisory.affected_streets.length > 1 ? "s" : ""}`
                : "",
              startsAt ? timeAgo(startsAt) : "",
            ]
              .filter(Boolean)
              .join(" · "),
            status: null,
            snippet: advisory.body || "",
            actionLabel: "Open in Community",
          },
          onAction: () => navigate("/dashboard/community-content"),
        })
      }
    }

    if (feedChip === "resolved") {
      for (const emergency of snapshot.emergencies) {
        if (isActiveEmergency(emergency)) continue
        const street = streetOf(emergency)
        rows.push({
          key: `emergency-${emergency.id}`,
          selection: { kind: "emergency", id: emergency.id },
          icon: <AlertTriangleIcon className="size-5" strokeWidth={1.9} />,
          rank: 2,
          time: new Date(emergency.updated_at || emergency.created_at).getTime(),
          model: {
            kind: "emergency",
            id: emergency.id,
            live: false,
            closed: true,
            title: `${titleCase(emergency.type)} emergency`,
            meta: [street, timeAgo(emergency.updated_at || emergency.created_at)]
              .filter(Boolean)
              .join(" · "),
            status: null,
            snippet: emergency.note || "",
            actionLabel: "Open in Emergency Ops",
          },
          onAction: () => navigate(`/dashboard/emergencies?alert=${emergency.id}`),
        })
      }
      for (const concern of snapshot.concerns) {
        if (!isResolvedRecord(concern)) continue
        const street = streetOf(concern)
        rows.push({
          key: `concern-${concern.id}`,
          selection: { kind: "concern", id: concern.id },
          icon: <ConcernIcon category={concern.category} className="size-5" />,
          rank: 3,
          time: new Date(concern.updated_at || concern.created_at).getTime(),
          model: {
            kind: "concern",
            id: concern.id,
            live: false,
            closed: true,
            title: concern.title,
            meta: [concernCategoryLabel(concern), street, timeAgo(concern.updated_at || concern.created_at)]
              .filter(Boolean)
              .join(" · "),
            status: null,
            snippet: concern.description || "",
            actionLabel: "Open full report",
          },
          onAction: () => navigate(`/dashboard/reports/${concern.id}`),
        })
      }
    }

    rows.sort((a, b) => a.rank - b.rank || b.time - a.time)
    return rows.slice(0, 50)
  }, [snapshot, visibleEmergencies, visibleConcerns, feedChip, navigate, selectOnMap])

  /**
   * Counts describe what is actually drawn, not the size of the roster.
   *
   * `summary.residents` is every verified resident in the barangay, but the map
   * can only pin someone whose device has reported a location — so the legend
   * read "Residents 15" beside a single dot. Counting `snapshot.people` instead
   * means the number and the pins can never disagree.
   */
  const mapCounts = useMemo(() => {
    const withLocation = (snapshot?.people ?? []).filter(
      (person) => validCoord(person.latitude, person.longitude) !== null,
    )
    const byRole = (role: string) => withLocation.filter((person) => person.role === role).length
    return {
      responders: byRole("first_responder"),
      emergencies: visibleEmergencies.length,
      concerns: visibleConcerns.length,
      advisories: (snapshot?.advisories ?? []).length,
    }
  }, [snapshot, visibleConcerns, visibleEmergencies])

  const areaName = snapshot?.map.boundary.name || "your coverage area"

  // The resident alerts panel, exactly: one white pane, one 40px header row,
  // and the list swapped for the record in place.
  const panelBody = (
    <div className="flex h-full min-h-0 flex-col bg-white text-neutral-900">
      <div className="shrink-0 bg-white px-3 pb-2 pt-2">
        <MapFilterChips
          className="min-w-0"
          tone="light"
          chips={FEED_CHIPS}
          chip={weatherOpen ? "" : feedChip}
          onSelect={(key) => {
            setFeedChip(key)
            setWeatherOpen(false)
          }}
          label="Alert types"
        />
      </div>
      {selected ? (
        <>
          <div className="flex shrink-0 items-center gap-1 px-2 pb-1 pt-3">
            <button
              type="button"
              onClick={clearSelection}
              className="flex size-9 shrink-0 items-center justify-center rounded-full text-neutral-700 hover:bg-neutral-100"
              aria-label="Back to list"
            >
              <ChevronLeftIcon className="size-5" strokeWidth={2.25} />
            </button>
            <p className="min-w-0 flex-1 truncate text-left text-[15px] font-semibold text-neutral-600">
              {SELECTION_LABEL[selected.kind]}
            </p>
          </div>
          <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
            {snapshot ? (
              <DetailPanel
                selected={selected}
                snapshot={snapshot}
                onEmergencyUpdated={updateEmergency}
              />
            ) : null}
          </div>
        </>
      ) : (
        <AlertsFeed
          areaName={areaName}
          total={feedRows.length}
          rows={feedRows}
          onSelect={selectOnMap}
          weatherMode={weatherOpen}
          weatherToggle={weatherButton}
          weather={weather}
        />
      )}
    </div>
  )

  return (
    // Both `h-full` and `flex-1` are required, because the shell wraps this
    // page in two different kinds of parent:
    //   desktop - <main> is a BLOCK with a definite height, so `h-full` wins
    //             and `flex-1` is inert.
    //   mobile  - <main> is a flex-col of auto height, so `height:100%` has
    //             nothing to resolve against and `flex-1` wins instead.
    // Shipping only one of them collapses the map to zero height on the other
    // breakpoint, which is what rendered the map area as blank.
    <div className="relative h-full min-h-0 w-full flex-1 overflow-hidden bg-nav-bg">
      {/* Mounted before the fetch resolves: tiles, controls and the legend are
          the map's own chrome and do not need a single record to be useful.
          The snapshot only fills them in. */}
      <AlertsLeafletMap
        snapshot={snapshot ?? PENDING_SNAPSHOT}
        layers={layers}
        selected={selected}
        selectedStreetNames={mapSelectedStreetNames}
        onSelect={selectOnMap}
        onToggleLayer={toggleLayer}
        onResetLayers={resetLayers}
        onMapInteract={collapseSheetForMap}
        counts={mapCounts}
      />

      {/* Desktop: the feed floats over the map instead of cutting a rail. */}
      {panelCollapsed ? (
        <button
          type="button"
          onClick={() => setPanelCollapsed(false)}
          aria-label="Open alerts"
          title="Open alerts"
          className="absolute left-4 top-4 z-[600] hidden size-10 items-center justify-center rounded-lg border border-neutral-200 bg-white shadow-md lg:flex"
        >
          <CircleAlertIcon className="size-5 shrink-0 text-neutral-800" strokeWidth={2.25} />
        </button>
      ) : (
        <aside className="absolute left-4 top-4 z-[600] hidden max-h-[min(72vh,620px)] w-[min(100%,380px)] flex-col overflow-hidden rounded-2xl bg-white shadow-[0_8px_28px_rgba(15,23,42,.12)] lg:flex">
          <div className="flex h-10 shrink-0 items-center gap-2 px-3">
            <CircleAlertIcon className="size-5 shrink-0 text-neutral-800" strokeWidth={2.25} />
            <button
              type="button"
              onClick={() => setPanelCollapsed(true)}
              className="ml-auto flex size-7 shrink-0 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100"
              aria-label="Collapse alerts"
              title="Collapse alerts"
            >
              <ChevronLeftIcon className="size-4" strokeWidth={2.25} />
            </button>
          </div>
          {isDesktop ? panelBody : null}
        </aside>
      )}

      {/* Mobile: back out of the map without hunting for the bottom nav, which
          this route hides so the map can run full-bleed. */}
      <button
        type="button"
        onClick={() => navigate("/dashboard/overview")}
        aria-label="Back to the overview"
        className="absolute left-3 top-3 z-[600] flex size-10 items-center justify-center rounded-xl border border-neutral-200 bg-white/95 text-neutral-900 shadow-md backdrop-blur transition-colors hover:bg-neutral-100 lg:hidden"
      >
        <ChevronLeftIcon className="size-5" strokeWidth={2.2} />
      </button>

      {/* Mobile: one sheet for both the list and the detail, on the same three
          snap points the resident alerts map uses. Free dragging in between
          matters because how much map an official wants to keep visible depends
          on where the incident is. */}
      <div
        className={cn(
          "absolute bottom-0 left-0 right-0 z-[600] flex flex-col overflow-hidden rounded-t-3xl border border-neutral-200 border-b-0 bg-white shadow-[0_-10px_36px_rgba(15,23,42,.18)] lg:hidden",
          // Only animate on a snap; during a drag the height must track the
          // finger exactly or it feels like it is lagging behind.
          !sheet.dragging && "transition-[height] duration-200 ease-out",
        )}
        style={{ height: sheet.height, maxHeight: "92svh" }}
        role="dialog"
        aria-label="Alerts sheet"
      >
        <div
          onPointerDown={sheet.onHandlePointerDown}
          onPointerMove={sheet.onHandlePointerMove}
          onPointerUp={sheet.onHandlePointerUp}
          onPointerCancel={sheet.onHandlePointerUp}
          aria-label="Drag sheet"
          className="flex shrink-0 touch-none cursor-grab flex-col items-center bg-white px-3 pb-1 pt-2 active:cursor-grabbing"
        >
          <span className="mb-1 h-1.5 w-11 rounded-full bg-neutral-300" />
          {sheet.height <= sheet.snaps().hidden + 8 ? (
            <p className="pb-1 text-[13px] font-semibold text-neutral-700">
              Alerts in {areaName}
              {feedRows.length > 0 ? ` · ${feedRows.length}` : ""}
            </p>
          ) : null}
        </div>

        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col overflow-hidden bg-white",
            sheet.height <= sheet.snaps().hidden + 14 && "pointer-events-none opacity-0",
          )}
        >
          {!isDesktop ? panelBody : null}
        </div>
      </div>
    </div>
  )
}
