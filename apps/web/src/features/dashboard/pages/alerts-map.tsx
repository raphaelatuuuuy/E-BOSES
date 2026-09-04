import { useCallback, useEffect, useMemo, useState } from "react"
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
  SignalHighIcon,
  SignalIcon,
  SignalLowIcon,
  SignalMediumIcon,
  TrafficConeIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { useAuthSession } from "@/features/auth/auth-session"
import { isOfficialUser, isResponderUser } from "@/features/auth/roles"
import {
  getOfficialLiveMap,
  type ConcernCategory,
  type LiveMapConcern,
  type LiveMapEmergency,
  type ResidentMapConcern,
  type ResidentMapEmergency,
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
  MapWeatherIcon,
  useMapWeather,
} from "@/features/dashboard/components/map-weather"
import { MapFilterChips } from "@/features/dashboard/components/map/filter-chips"
import {
  ALERT_FEED_CHIPS,
  AlertsFeed,
  type AlertFeedRow,
} from "@/features/dashboard/components/alerts-map/alerts-feed"

import { AlertsLeafletMap } from "@/features/dashboard/components/alerts-map/leaflet-map"
import { DetailPanel } from "@/features/dashboard/components/alerts-map/detail-panel"
import {
  isMapDrawableConcern,
  isResolvedRecord,
  isActiveEmergency,
  defaultLayers,
  emptyLiveMapSnapshot,
  mergeUpdate,
  type LayerKey,
  type Selection,
} from "@/features/dashboard/components/alerts-map/lib"

/**
 * Stable identity, created once. The map is memoised on its props, so handing
 * it a fresh empty snapshot each render would rebuild every layer.
 */
const PENDING_SNAPSHOT = emptyLiveMapSnapshot()

function publicConcernAsLive(concern: ResidentMapConcern): LiveMapConcern {
  return {
    id: concern.id,
    tracking_id: concern.tracking_id,
    title: concern.title,
    notification_subject: concern.notification_subject,
    description: concern.description,
    summary: concern.summary,
    category: concern.category,
    category_ref: concern.category_ref,
    status: concern.status,
    address: concern.address,
    barangay: concern.barangay,
    latitude: concern.latitude,
    longitude: concern.longitude,
    reporter: {
      id: concern.reporter.id,
      full_name: concern.reporter.full_name,
      role: concern.reporter.role as "resident",
      barangay: concern.reporter.barangay,
      address: "",
      responder_unit: "",
      is_on_duty: false,
      latitude: null,
      longitude: null,
      location_updated_at: null,
    },
    created_at: concern.created_at,
    updated_at: concern.updated_at,
    priority: concern.priority,
    severity: concern.severity,
    severity_assessed: concern.severity_assessed,
    preview_url: concern.preview_url ?? "",
    media_count: concern.preview_url ? 1 : 0,
  }
}

function publicEmergencyAsLive(
  emergency: ResidentMapEmergency
): LiveMapEmergency {
  return {
    id: emergency.id,
    type: emergency.type,
    note: emergency.note,
    display_description: emergency.display_description,
    ai_summary: emergency.ai_summary,
    ai_assist_status: emergency.ai_assist_status,
    status: emergency.status,
    address: emergency.address,
    barangay: emergency.barangay,
    latitude: emergency.latitude,
    longitude: emergency.longitude,
    reporter: {
      id: 0,
      full_name: "Resident",
      role: "resident",
      barangay: emergency.barangay,
      address: "",
      responder_unit: "",
      is_on_duty: false,
      latitude: null,
      longitude: null,
      location_updated_at: null,
    },
    current_assignment: null,
    created_at: emergency.created_at,
    updated_at: emergency.updated_at,
    resolved_at: null,
    preview_url: null,
  }
}

function withPublicRecords(
  snapshot: LiveMapSnapshot,
  includePublic = true
): LiveMapSnapshot {
  if (!includePublic) return snapshot
  const concernIds = new Set(
    snapshot.operational.concerns.map((item) => item.id)
  )
  const emergencyIds = new Set(
    snapshot.operational.emergencies.map((item) => item.id)
  )
  return {
    ...snapshot,
    concerns: [
      ...snapshot.operational.concerns,
      ...snapshot.public_concerns
        .filter((item) => !concernIds.has(item.id))
        .map(publicConcernAsLive),
    ],
    emergencies: [
      ...snapshot.operational.emergencies,
      ...snapshot.public_emergencies
        .filter((item) => !emergencyIds.has(item.id))
        .map(publicEmergencyAsLive),
    ],
  }
}

const SELECTION_LABEL: Record<"emergency" | "concern", string> = {
  emergency: "Emergency",
  concern: "Concern",
}

function ConcernIcon({
  category,
  className,
}: {
  category: ConcernCategory
  className?: string
}) {
  if (category === "infrastructure")
    return <TrafficConeIcon className={className} strokeWidth={1.9} />
  if (category === "environment")
    return <LeafIcon className={className} strokeWidth={1.9} />
  if (category === "public_safety")
    return <ShieldCheckIcon className={className} strokeWidth={1.9} />
  return <SearchIcon className={className} strokeWidth={1.9} />
}

function titleCase(value: string) {
  const words = value.replace(/_/g, " ").trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : ""
}

function readableSeverity(value?: string | null) {
  if (!value) return ""
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function priorityBadge(value?: string | null) {
  const severity = (value || "").toLowerCase()
  if (!(severity in { critical: true, high: true, moderate: true, low: true }))
    return null
  const Icon = {
    critical: SignalIcon,
    high: SignalHighIcon,
    moderate: SignalMediumIcon,
    low: SignalLowIcon,
  }[severity as "critical" | "high" | "moderate" | "low"]
  const tone = {
    critical: "text-severity-critical-ink",
    high: "text-severity-high-ink",
    moderate: "text-severity-moderate-ink",
    low: "text-severity-low-ink",
  }[severity as "critical" | "high" | "moderate" | "low"]
  return {
    label: `${readableSeverity(severity)} priority`,
    icon: <Icon className="size-3.5 shrink-0" strokeWidth={2} />,
    className: tone,
  }
}

/** Highest-severity concerns should lead the queue in every concern view. */
function concernPriorityRank(value?: string | null) {
  switch ((value || "low").toLowerCase()) {
    case "critical":
      return 3
    case "high":
      return 2
    case "moderate":
    case "medium":
      return 1
    default:
      return 0
  }
}

function normaliseMapCopy(value: string) {
  return value
    .replace(/[“”‘’"']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

function concernMapCopy(concern: {
  title: string
  notification_subject?: string
  summary?: string
  description?: string
}) {
  const title = (
    concern.notification_subject ||
    concern.title ||
    "Report"
  ).trim()
  const summary = (concern.summary || concern.description || "").trim()
  const duplicate =
    Boolean(summary) && normaliseMapCopy(title) === normaliseMapCopy(summary)
  return {
    title,
    snippet: duplicate ? "" : summary,
    snippetLabel: duplicate
      ? null
      : concern.summary
        ? null
        : summary
          ? "Report description"
          : null,
  }
}

export default function AlertsMapPage() {
  usePageTitle("Alerts Map")
  const { user } = useAuthSession()
  const isOfficial = isOfficialUser(user)
  const isResponder = isResponderUser(user)
  const isDesktop = useIsDesktop()
  const navigate = useNavigate()
  const [snapshot, setSnapshot] = useState<LiveMapSnapshot | null>(null)
  const [homeCommunityId, setHomeCommunityId] = useState<string | null>(null)
  const [communityBoundaryVisible, setCommunityBoundaryVisible] =
    useState(false)
  const [layers, setLayers] = useState(defaultLayers)
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const [selected, setSelected] = useState<Selection>(() => {
    const alertId = Number(
      new URLSearchParams(window.location.search).get("alert")
    )
    return Number.isInteger(alertId) && alertId > 0
      ? { kind: "emergency", id: alertId }
      : null
  })
  const [feedChip, setFeedChip] = useState<string>("all")
  const [weatherOpen, setWeatherOpen] = useState(false)
  const [communityFilter, setCommunityFilter] = useState("all")
  const [weatherReady, setWeatherReady] = useState(false)

  const sheet = useBottomSheetSnap({ enabled: !isDesktop })

  const weatherCommunityId =
    communityFilter === "all" ? homeCommunityId : communityFilter
  const weatherCommunity = snapshot?.communities.find(
    (community) => community.id === weatherCommunityId
  )
  const weather = useMapWeather(
    weatherReady
      ? (weatherCommunity?.center.latitude ??
          snapshot?.map.center.latitude ??
          null)
      : null,
    weatherReady
      ? (weatherCommunity?.center.longitude ??
          snapshot?.map.center.longitude ??
          null)
      : null,
    weatherReady
      ? (weatherCommunity?.name ?? snapshot?.map.boundary.name ?? "")
      : ""
  )

  const weatherButton = (
    <button
      type="button"
      onClick={() => {
        setFeedChip("all")
        setWeatherOpen((value) => !value)
      }}
      aria-label={
        weatherOpen ? "Show the alerts list" : "Show the weather details"
      }
      aria-expanded={weatherOpen}
      title="Weather"
      className="flex shrink-0 items-center gap-1.5 text-[18px] leading-tight font-bold tracking-tight text-neutral-900 transition-opacity hover:opacity-70 sm:text-[20px]"
    >
      {weather.loading && weather.temperature == null ? (
        <CloudSunIcon className="size-5 shrink-0" />
      ) : (
        <MapWeatherIcon code={weather.code} className="size-5 shrink-0" />
      )}
      <span className="tabular-nums">
        {weather.temperature != null
          ? `${Math.round(weather.temperature)}°C`
          : "—"}
      </span>
    </button>
  )

  const collapseSheetForMap = useCallback(() => {
    if (isDesktop) return
    sheet.snapTo("hidden")
  }, [isDesktop, sheet])

  const load = useCallback(
    async (communityId?: string) => {
      try {
        const nextSnapshot = withPublicRecords(
          await getOfficialLiveMap(communityId),
          !isResponder
        )
        const nextHomeCommunityId =
          nextSnapshot.home_community_id ??
          nextSnapshot.operational.community_id ??
          null
        setHomeCommunityId((current) => current ?? nextHomeCommunityId)
        // Open on the signed-in official's community. Switching communities is
        // explicit through the map control, so foreign pins stay hidden by default.
        setCommunityFilter((current) =>
          current === "all" ? (nextHomeCommunityId ?? "all") : current
        )
        setSnapshot(nextSnapshot)
        setWeatherReady(true)
      } catch {
        setSnapshot((current) => current ?? PENDING_SNAPSHOT)
        setWeatherReady(false)
      }
    },
    [isResponder]
  )

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(), 0)
    return () => {
      window.clearTimeout(initialLoad)
    }
  }, [load])

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
      setSnapshot((current) =>
        current ? batch.reduce(mergeUpdate, current) : current
      )
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
          websocketUrl(
            `/ws/dashboard/live-map/?ticket=${encodeURIComponent(ticket)}`
          )
        )
      } catch {
        if (!closed) {
          reconnectTimer = window.setTimeout(
            () => void connect(),
            reconnectDelay()
          )
        }
        return
      }
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as LiveMapUpdate
          if (message.type === "concern.ai_assessment.updated") {
            window.dispatchEvent(
              new CustomEvent("eboses:concern-updated", {
                detail: {
                  concernId: message.payload.concern_id,
                  source: "ai_assessment",
                },
              })
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
          reconnectTimer = window.setTimeout(
            () => void connect(),
            reconnectDelay()
          )
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
      emergencies:
        snapshot?.emergencies.filter(
          (emergency) => !isActiveEmergency(emergency)
        ) ?? [],
    }),
    [snapshot]
  )
  const visibleConcerns = useMemo(() => {
    if (!snapshot) return []
    // Match the resident map: newly submitted public reports get a pin too,
    // while resolved reports remain visible in a neutral tone.
    const rows = snapshot.concerns.filter(isMapDrawableConcern)
    // The map opens on the official's current community. Treat the legacy
    // "all" state as unresolved until that home id is known; otherwise the
    // first paint briefly exposes every accessible community's pins.
    const selectedCommunityId =
      communityFilter === "all" ? homeCommunityId : communityFilter
    if (!selectedCommunityId) return []
    const ids = new Set(
      snapshot.public_concerns
        .filter((item) => item.community.id === selectedCommunityId)
        .map((item) => item.id)
    )
    return rows.filter(
      (item) =>
        ids.has(item.id) ||
        (snapshot.operational.community_id === selectedCommunityId &&
          snapshot.operational.concerns.some((entry) => entry.id === item.id))
    )
  }, [snapshot, communityFilter, homeCommunityId])
  const visibleEmergencies = useMemo(() => {
    const active = snapshot?.emergencies.filter(isActiveEmergency) ?? []
    const rows = [...active, ...resolvedRecords.emergencies]
    if (!snapshot) return []
    const selectedCommunityId =
      communityFilter === "all" ? homeCommunityId : communityFilter
    if (!selectedCommunityId) return []
    const ids = new Set(
      snapshot.public_emergencies
        .filter((item) => item.community.id === selectedCommunityId)
        .map((item) => item.id)
    )
    return rows.filter(
      (item) =>
        ids.has(item.id) ||
        (snapshot.operational.community_id === selectedCommunityId &&
          snapshot.operational.emergencies.some(
            (entry) => entry.id === item.id
          ))
    )
  }, [snapshot, resolvedRecords, communityFilter, homeCommunityId])
  const mapSelectedStreetNames = useMemo(() => new Set<string>(), [])

  const toggleLayer = useCallback((key: LayerKey) => {
    setLayers((current) => ({ ...current, [key]: !current[key] }))
  }, [])

  const resetLayers = useCallback(() => setLayers(defaultLayers), [])

  const selectOnMap = useCallback(
    (next: Selection) => {
      const concern =
        next?.kind === "concern"
          ? snapshot?.concerns.find((item) => item.id === next.id)
          : null
      const emergency =
        next?.kind === "emergency"
          ? snapshot?.emergencies.find((item) => item.id === next.id)
          : null
      const active =
        (concern &&
          isMapDrawableConcern(concern) &&
          !isResolvedRecord(concern)) ||
        (emergency && isActiveEmergency(emergency))
      if (
        (isOfficial || isResponder) &&
        next &&
        (active ||
          (next.kind === "concern"
            ? snapshot?.operational.concerns.some((item) => item.id === next.id)
            : snapshot?.operational.emergencies.some(
                (item) => item.id === next.id
              )))
      ) {
        navigate(
          next.kind === "concern"
            ? `/dashboard/reports/${next.id}`
            : `/dashboard/reports?alert=${next.id}`
        )
        return
      }
      setPanelCollapsed(false)
      setSelected(next)
    },
    [isOfficial, isResponder, navigate, snapshot]
  )

  const filteredSnapshot = useMemo(() => {
    if (!snapshot) return PENDING_SNAPSHOT
    const emergencyIds = new Set(visibleEmergencies.map((item) => item.id))
    return {
      ...snapshot,
      concerns: visibleConcerns,
      emergencies: visibleEmergencies,
      routes: snapshot.routes.filter((route) =>
        emergencyIds.has(route.alert_id)
      ),
    }
  }, [snapshot, visibleConcerns, visibleEmergencies])

  function changeCommunity(id: string) {
    setCommunityBoundaryVisible((visible) =>
      id === communityFilter ? !visible : true
    )
    setCommunityFilter(id)
    setSelected(null)
    if (id !== "all") void load(id)
  }

  const clearSelection = useCallback(() => setSelected(null), [])

  const updateEmergency = useCallback((next: LiveMapEmergency) => {
    setSnapshot((current) =>
      current
        ? {
            ...current,
            emergencies: current.emergencies.map((item) =>
              item.id === next.id ? next : item
            ),
          }
        : current
    )
  }, [])

  const concernCommunities = useMemo(
    () =>
      new Map(
        snapshot?.public_concerns.map((item) => [
          item.id,
          item.community.name,
        ]) ?? []
      ),
    [snapshot]
  )
  const emergencyCommunities = useMemo(
    () =>
      new Map(
        snapshot?.public_emergencies.map((item) => [
          item.id,
          item.community.name,
        ]) ?? []
      ),
    [snapshot]
  )

  const feedRows = useMemo<AlertFeedRow[]>(() => {
    if (!snapshot) return []
    const rows: Array<
      AlertFeedRow & { rank: number; priorityRank: number; time: number }
    > = []
    const streetOf = (record: {
      address?: string | null
      barangay?: string | null
    }) =>
      streetOnly(record.address?.trim()) ||
      (record.barangay ? `In ${record.barangay}` : "")

    // Concerns is the operational reports view. It includes both routine
    // concerns and critical/emergency reports so staff never have to inspect
    // a second panel to find an active incident.
    if (feedChip === "all" || feedChip === "concerns") {
      for (const emergency of visibleEmergencies) {
        const live = isActiveEmergency(emergency)
        const street = streetOf(emergency)
        const assignment = emergency.current_assignment
        const unit = responderUnitLabel(assignment?.responder.responder_unit)
        rows.push({
          key: `emergency-${emergency.id}`,
          selection: { kind: "emergency", id: emergency.id },
          icon: <AlertTriangleIcon className="size-5" strokeWidth={1.9} />,
          rank: live ? 0 : 1,
          priorityRank: live ? 3 : 0,
          time: new Date(emergency.created_at).getTime(),
          model: {
            kind: "emergency",
            id: emergency.id,
            live,
            closed: !live,
            resolved: ["resolved", "closed"].includes(emergency.status),
            title: `${titleCase(emergency.type)} emergency${
              emergency.address?.trim() || emergency.barangay?.trim()
                ? ` around ${emergency.address?.trim() || emergency.barangay.trim()}`
                : ""
            }`,
            meta: [
              emergencyCommunities.get(emergency.id),
              street,
              timeAgo(emergency.created_at),
            ]
              .filter(Boolean)
              .join(" · "),
            status: assignment
              ? [
                  assignment.responder.full_name,
                  unit,
                  titleCase(assignment.status),
                ]
                  .filter(Boolean)
                  .join(" · ")
              : null,
            priority: live
              ? (priorityBadge("critical") ?? undefined)
              : undefined,
            snippet: emergency.display_description || emergency.note || "",
            actionLabel: "Open full report",
          },
          onAction: () => navigate(`/dashboard/reports?alert=${emergency.id}`),
        })
      }
    }

    if (feedChip === "all" || feedChip === "concerns") {
      for (const concern of visibleConcerns) {
        const closed = isResolvedRecord(concern)
        const street = streetOf(concern)
        const copy = concernMapCopy(concern)
        rows.push({
          key: `concern-${concern.id}`,
          selection: { kind: "concern", id: concern.id },
          icon: <ConcernIcon category={concern.category} className="size-5" />,
          rank: closed ? 1 : 0,
          priorityRank: concernPriorityRank(
            concern.severity ?? concern.priority
          ),
          time: new Date(concern.created_at).getTime(),
          model: {
            kind: "concern",
            id: concern.id,
            live: false,
            closed,
            title: copy.title,
            meta: [
              concernCommunities.get(concern.id),
              concernCategoryLabel(concern),
              street,
              timeAgo(concern.created_at),
            ]
              .filter(Boolean)
              .join(" · "),
            status: concern.reporter.full_name,
            priority:
              concern.severity_assessed && concern.severity
                ? (priorityBadge(concern.severity) ?? undefined)
                : undefined,
            snippet: copy.snippet,
            snippetLabel: copy.snippetLabel,
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
          priorityRank: 0,
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

    rows.sort(
      (a, b) =>
        a.rank - b.rank || b.priorityRank - a.priorityRank || b.time - a.time
    )
    return rows.slice(0, 50)
  }, [
    snapshot,
    visibleEmergencies,
    visibleConcerns,
    feedChip,
    navigate,
    concernCommunities,
    emergencyCommunities,
  ])

  const mapCounts = useMemo(() => {
    return {
      concerns: visibleConcerns.length + visibleEmergencies.length,
      advisories: (snapshot?.advisories ?? []).length,
    }
  }, [snapshot, visibleConcerns, visibleEmergencies])

  const areaName =
    snapshot?.map.boundary.name ||
    snapshot?.communities.find(
      (community) => community.id === snapshot?.home_community_id
    )?.name ||
    snapshot?.communities[0]?.name ||
    ""

  // The resident alerts panel, exactly: one white pane, one 40px header row,
  // and the list swapped for the record in place.
  const panelBody = (
    <div className="flex h-full min-h-0 flex-col bg-white text-neutral-900">
      <div className="shrink-0 bg-white px-3 pt-2 pb-2">
        <MapFilterChips
          className="min-w-0"
          tone="light"
          chips={ALERT_FEED_CHIPS}
          chip={weatherOpen ? "" : feedChip}
          onSelect={(key) => {
            setFeedChip(key)
            setWeatherOpen(false)
            // A filter choice is a request for the matching list, not a
            // request to keep showing the previously opened alert detail.
            clearSelection()
          }}
          label="Alert types"
        />
      </div>
      {selected ? (
        <>
          <div className="flex shrink-0 items-center gap-1 px-2 pt-3 pb-1">
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
                snapshot={filteredSnapshot}
                audience={isResponder ? "responder" : "official"}
                viewerId={user?.id ?? null}
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
    <div className="relative h-full min-h-0 w-full flex-1 overflow-hidden bg-white">
      {/* Mounted before the fetch resolves: tiles, controls and the legend are
          the map's own chrome and do not need a single record to be useful.
          The snapshot only fills them in. */}
      <AlertsLeafletMap
        snapshot={filteredSnapshot}
        layers={layers}
        selected={selected}
        selectedStreetNames={mapSelectedStreetNames}
        onSelect={selectOnMap}
        onToggleLayer={toggleLayer}
        onResetLayers={resetLayers}
        onMapInteract={collapseSheetForMap}
        counts={mapCounts}
        communities={snapshot?.communities ?? []}
        currentCommunityId={
          homeCommunityId ??
          snapshot?.home_community_id ??
          snapshot?.operational.community_id ??
          null
        }
        boundaryVisible={communityBoundaryVisible}
        onCommunitySelect={changeCommunity}
      />

      {/* Desktop: the feed floats over the map instead of cutting a rail. */}
      {panelCollapsed ? (
        <button
          type="button"
          onClick={() => setPanelCollapsed(false)}
          aria-label="Open alerts"
          title="Open alerts"
          className="absolute top-4 left-4 z-[600] hidden size-10 items-center justify-center rounded-lg border border-neutral-200 bg-white shadow-md lg:flex"
        >
          <CircleAlertIcon
            className="size-5 shrink-0 text-neutral-800"
            strokeWidth={2.25}
          />
        </button>
      ) : (
        <aside className="absolute top-4 left-4 z-[600] hidden max-h-[min(72vh,620px)] w-[min(100%,380px)] flex-col overflow-hidden rounded-2xl bg-white shadow-[0_8px_28px_rgba(15,23,42,.12)] lg:flex">
          <div className="flex h-10 shrink-0 items-center gap-2 px-3">
            <CircleAlertIcon
              className="size-5 shrink-0 text-neutral-800"
              strokeWidth={2.25}
            />
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
        onClick={() =>
          navigate(isResponder ? "/dashboard/reports" : "/dashboard/overview")
        }
        aria-label={isResponder ? "Back to reports" : "Back to the overview"}
        className="absolute top-3 left-3 z-[600] flex size-10 items-center justify-center rounded-xl border border-neutral-200 bg-white/95 text-neutral-900 shadow-md backdrop-blur transition-colors hover:bg-neutral-100 lg:hidden"
      >
        <ChevronLeftIcon className="size-5" strokeWidth={2.2} />
      </button>

      {/* Mobile: one sheet for both the list and the detail, on the same three
          snap points the resident alerts map uses. Free dragging in between
          matters because how much map an official wants to keep visible depends
          on where the incident is. */}
      <div
        className={cn(
          "absolute right-0 bottom-0 left-0 z-[600] flex flex-col overflow-hidden rounded-t-3xl border border-b-0 border-neutral-200 bg-white shadow-[0_-10px_36px_rgba(15,23,42,.18)] lg:hidden",
          // Only animate on a snap; during a drag the height must track the
          // finger exactly or it feels like it is lagging behind.
          !sheet.dragging && "transition-[height] duration-200 ease-out"
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
          className="flex shrink-0 cursor-grab touch-none flex-col items-center bg-white px-3 pt-2 pb-1 active:cursor-grabbing"
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
            sheet.height <= sheet.snaps().hidden + 14 &&
              "pointer-events-none opacity-0"
          )}
        >
          {!isDesktop ? panelBody : null}
        </div>
      </div>
    </div>
  )
}
