import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  Check,
  ChevronLeftIcon,
  CircleAlertIcon,
  CloudSunIcon,
  LeafIcon,
  SearchIcon,
  ShieldCheckIcon,
  SignalHighIcon,
  SignalLowIcon,
  SignalMediumIcon,
  TrafficConeIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { resolveIconByKey } from "@/features/dashboard/components/concerns/resolve-icon"

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
import {
  announcementSummary,
  announcementTitle,
} from "@/features/dashboard/lib/announcement-summary"
import { timeAgo } from "@/features/dashboard/lib/format"
import {
  concernBodyText,
  concernTitleText,
} from "@/features/dashboard/components/feed-post-text"
import {
  ANNOUNCEMENT_ACCENT,
  advisoryLabel,
  advisoryMeta,
} from "@/features/dashboard/components/community-content/advisory-tags"
import {
  MapWeatherIcon,
  useMapWeather,
} from "@/features/dashboard/components/map-weather"
import { AlertsSearchRow } from "@/features/dashboard/components/alerts-map/alerts-search-row"
import {
  AlertsFeed,
  type AlertFeedRow,
} from "@/features/dashboard/components/alerts-map/alerts-feed"

import { AlertsLeafletMap } from "@/features/dashboard/components/alerts-map/leaflet-map"
import { DetailPanel } from "@/features/dashboard/components/alerts-map/detail-panel"
import {
  isMapDrawableConcern,
  isResolvedRecord,
  isActiveEmergency,
  isAdvisoryExpired,
  defaultLayers,
  emptyLiveMapSnapshot,
  mergeUpdate,
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
    assigned_unit: null,
    units: [],
    current_assignment: null,
    created_at: emergency.created_at,
    updated_at: emergency.updated_at,
    resolved_at: null,
    preview_url: null,
  }
}

function withPublicRecords(
  snapshot: LiveMapSnapshot,
  includePublic = true,
  // When the SOS unit filter is active the public pins must stay out: they are
  // not unit-scoped, so merging them would re-add rows the filter just removed.
  includePublicEmergencies = includePublic
): LiveMapSnapshot {
  if (!includePublic && !includePublicEmergencies) return snapshot
  const concernIds = new Set(
    snapshot.operational.concerns.map((item) => item.id)
  )
  const emergencyIds = new Set(
    snapshot.operational.emergencies.map((item) => item.id)
  )
  return {
    ...snapshot,
    concerns: includePublic
      ? [
          ...snapshot.operational.concerns,
          ...snapshot.public_concerns
            .filter((item) => !concernIds.has(item.id))
            .map(publicConcernAsLive),
        ]
      : snapshot.concerns,
    emergencies: includePublicEmergencies
      ? [
          ...snapshot.operational.emergencies,
          ...snapshot.public_emergencies
            .filter((item) => !emergencyIds.has(item.id))
            .map(publicEmergencyAsLive),
        ]
      : snapshot.emergencies,
  }
}

const SELECTION_LABEL: Record<"emergency" | "concern", string> = {
  emergency: "Emergency",
  concern: "Concern",
}

/* eslint-disable react-hooks/static-components -- resolveIconByKey returns a stable module-level Lucide component, never a new one */
function ConcernIcon({
  category,
  iconKey,
  className,
}: {
  category: ConcernCategory
  iconKey?: string
  className?: string
}) {
  const Resolved = resolveIconByKey(iconKey)
  if (Resolved) return <Resolved className={className} strokeWidth={1.9} />
  if (category === "infrastructure")
    return <TrafficConeIcon className={className} strokeWidth={1.9} />
  if (category === "environment")
    return <LeafIcon className={className} strokeWidth={1.9} />
  if (category === "public_safety")
    return <ShieldCheckIcon className={className} strokeWidth={1.9} />
  return <SearchIcon className={className} strokeWidth={1.9} />
}
/* eslint-enable react-hooks/static-components */

function titleCase(value: string) {
  const words = value.replace(/_/g, " ").trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : ""
}

function readableSeverity(value?: string | null) {
  if (!value) return ""
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function priorityBadge(value?: string | null, criticalUsesSignal = false) {
  const severity = (value || "").toLowerCase()
  if (!(severity in { critical: true, high: true, moderate: true, low: true }))
    return null
  const Icon = {
    critical: criticalUsesSignal ? SignalHighIcon : TriangleAlertIcon,
    high: SignalHighIcon,
    moderate: SignalMediumIcon,
    low: SignalLowIcon,
  }[severity as "critical" | "high" | "moderate" | "low"]
  const tone = {
    critical: "text-severity-critical-map-ink",
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

function withoutCommunitySuffix(value: string) {
  return value
    .replace(
      /(?:,|\s+in)\s+(?:Marikina Heights|Marist Village)(?=$|[.,])/i,
      ""
    )
    .replace(/\s{2,}/g, " ")
    .trim()
}

function concernMapCopy(concern: {
  title: string
  notification_subject?: string
  summary?: string
  description?: string
}) {
  const title = withoutCommunitySuffix(
    concernTitleText(concern).replace(/\s+/g, " ").trim() || "Report"
  )
  const body = concernBodyText(concern).replace(/\s+/g, " ").trim()
  const summary = (concern.summary || "").replace(/\s+/g, " ").trim()
  const generatedSummary =
    summary &&
    normaliseMapCopy(summary) !== normaliseMapCopy(title) &&
    normaliseMapCopy(summary) !== normaliseMapCopy(body)
      ? summary
      : ""
  const snippet =
    generatedSummary ||
    (normaliseMapCopy(body) !== normaliseMapCopy(title) ? body : "")
  return {
    title,
    snippet,
    snippetLabel: summary ? null : snippet ? "Report description" : null,
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
  const [alertQuery, setAlertQuery] = useState("")
  const [alertFilterOpen, setAlertFilterOpen] = useState(false)
  const [communityFilter, setCommunityFilter] = useState("all")
  const [unitFilter, setUnitFilter] = useState("all")
  const homeCommunityIdRef = useRef<string | null>(null)
  const unitFilterApplied = useRef(false)
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
    async (communityId?: string, unitId?: number | "unassigned") => {
      try {
        const nextSnapshot = withPublicRecords(
          await getOfficialLiveMap(communityId, unitId),
          !isResponder,
          !isResponder && unitId == null
        )
        const nextHomeCommunityId =
          nextSnapshot.home_community_id ??
          nextSnapshot.operational.community_id ??
          null
        if (!homeCommunityIdRef.current) homeCommunityIdRef.current = nextHomeCommunityId
        setHomeCommunityId((current) => current ?? nextHomeCommunityId)
        // Open on the signed-in official's community so foreign pins stay
        // hidden by default.
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

  // The unit filter is enforced server-side, so changing it refetches the
  // snapshot rather than filtering already-scoped rows on the client.
  useEffect(() => {
    if (!unitFilterApplied.current) {
      unitFilterApplied.current = true
      return
    }
    const unitId =
      unitFilter === "all"
        ? undefined
        : unitFilter === "unassigned"
          ? "unassigned"
          : Number(unitFilter)
    void load(homeCommunityIdRef.current ?? undefined, unitId)
  }, [unitFilter, load])

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
  // Mirrors the server rule so a live WebSocket push cannot slip an SOS from
  // another unit onto a unit-filtered map. "all" always matches.
  const unitFilterMatches = useCallback(
    (emergency: LiveMapEmergency) => {
      if (unitFilter === "all") return true
      if (unitFilter === "unassigned") return emergency.assigned_unit == null
      const unitId = Number(unitFilter)
      if (!Number.isFinite(unitId)) return true
      if (emergency.assigned_unit) return emergency.assigned_unit.id === unitId
      return emergency.units.some((unit) => unit.id === unitId)
    },
    [unitFilter]
  )

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
        unitFilterMatches(item) &&
        (ids.has(item.id) ||
          (snapshot.operational.community_id === selectedCommunityId &&
            snapshot.operational.emergencies.some(
              (entry) => entry.id === item.id
            )))
    )
  }, [snapshot, resolvedRecords, communityFilter, homeCommunityId, unitFilterMatches])
  const mapSelectedStreetNames = useMemo(() => new Set<string>(), [])

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
            ? `/dashboard/overview?report=${next.id}`
            : `/dashboard/overview?alert=${next.id}`
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

  const unitOptions = useMemo(() => {
    const options: { value: string; label: string }[] = [
      { value: "all", label: "All units" },
    ]
    for (const unit of snapshot?.units ?? []) {
      options.push({
        value: String(unit.id),
        label: unit.short_name || unit.name,
      })
    }
    options.push({ value: "unassigned", label: "Unassigned" })
    return options
  }, [snapshot?.units])

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

  const feedRows = useMemo<AlertFeedRow[]>(() => {
    if (!snapshot) return []
    const rows: Array<
      AlertFeedRow & { rank: number; priorityRank: number; time: number }
    > = []
    const streetOf = (record: { address?: string | null }) =>
      streetOnly(record.address?.trim())

    // Concerns is the operational reports view. It includes both routine
    // concerns and critical/emergency reports so staff never have to inspect
    // a second panel to find an active incident.
    if (feedChip === "all" || feedChip === "concerns") {
      for (const emergency of visibleEmergencies) {
        const live = isActiveEmergency(emergency)
        const street = streetOf(emergency)
        rows.push({
          key: `emergency-${emergency.id}`,
          selection: { kind: "emergency", id: emergency.id },
          icon: live ? (
            <TriangleAlertIcon className="size-5 text-sos" strokeWidth={2.2} />
          ) : (
            <Check className="size-5 text-emerald-600" strokeWidth={2.5} />
          ),
          rank: live ? 0 : 1,
          priorityRank: live ? 3 : 0,
          time: new Date(emergency.created_at).getTime(),
          model: {
            kind: "emergency",
            id: emergency.id,
            live,
            closed: !live,
            resolved: !isActiveEmergency(emergency),
            title: `${titleCase(emergency.type)} emergency${
              street ? ` around ${street}` : ""
            }`,
            meta: [street, timeAgo(emergency.created_at)]
              .filter(Boolean)
              .join(" · "),
            status: null,
            priority: live
              ? (priorityBadge("critical", true) ?? undefined)
              : undefined,
            snippet: emergency.display_description || emergency.note || "",
            actionLabel: "View full report",
          },
          onAction: () => navigate(`/dashboard/overview?alert=${emergency.id}`),
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
          icon:
            (concern.severity ?? concern.priority ?? "").toLowerCase() ===
            "critical" ? (
              <TriangleAlertIcon className="size-5 text-sos" strokeWidth={2.2} />
            ) : closed ? (
              <Check className="size-5 text-emerald-600" strokeWidth={2.5} />
            ) : (
              <ConcernIcon
                category={concern.category}
                iconKey={concern.category_ref?.icon_key}
                className="size-5"
              />
            ),
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
            critical:
              (concern.severity ?? concern.priority ?? "").toLowerCase() ===
              "critical",
            meta: [street, timeAgo(concern.created_at)]
              .filter(Boolean)
              .join(" · "),
            status: null,
            priority:
              concern.severity_assessed && concern.severity
                ? (priorityBadge(concern.severity, true) ?? undefined)
                : undefined,
            snippet: copy.snippet,
            snippetLabel: copy.snippetLabel,
            actionLabel: "View full report",
          },
          onAction: () => navigate(`/dashboard/overview?report=${concern.id}`),
        })
      }
    }

    if (feedChip === "all" || feedChip === "announcements") {
      const nowMs = snapshot?.generated_at
        ? Date.parse(snapshot.generated_at)
        : undefined
      for (const advisory of snapshot.advisories ?? []) {
        const startsAt = advisory.starts_at
        const TagIcon = advisoryMeta(advisory.tag).icon
        rows.push({
          key: `advisory-${advisory.id}`,
          icon: <TagIcon className="size-5" strokeWidth={1.9} />,
          rank: 4,
          priorityRank: 0,
          time: startsAt ? new Date(startsAt).getTime() : 0,
          model: {
            kind: "advisory",
            id: advisory.id,
            live: false,
            closed: isAdvisoryExpired(advisory, nowMs),
            title: announcementTitle(advisory),
            accent: {
              soft: ANNOUNCEMENT_ACCENT.soft,
              color: ANNOUNCEMENT_ACCENT.color,
            },
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
            snippet: announcementSummary(advisory),
            actionLabel: "View in feed",
          },
          onAction: () => navigate("/dashboard/feed"),
        })
      }
    }

    rows.sort(
      (a, b) =>
        a.rank - b.rank || b.priorityRank - a.priorityRank || b.time - a.time
    )

    const query = alertQuery.trim().toLowerCase()
    if (!query) return rows.slice(0, 50)
    const matches = (values: unknown[]) =>
      values.some(
        (value) =>
          typeof value === "string" && value.toLowerCase().includes(query)
      )
    return rows
      .filter((row) =>
        matches([
          row.model.title,
          row.model.meta,
          row.model.status,
          row.model.snippet,
          row.model.snippetLabel,
        ])
      )
      .slice(0, 50)
  }, [
    snapshot,
    visibleEmergencies,
    visibleConcerns,
    feedChip,
    navigate,
    alertQuery,
  ])

  const mapAlertCount =
    feedChip === "announcements"
      ? snapshot?.advisories?.length ?? 0
      : visibleConcerns.length +
        visibleEmergencies.length +
        (feedChip === "all" ? (snapshot?.advisories?.length ?? 0) : 0)

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
          total={mapAlertCount}
          rows={feedRows}
          onSelect={selectOnMap}
          weatherMode={weatherOpen}
          weatherToggle={weatherButton}
          weather={weather}
          showFullSnippet
          listToolbar={
            <div className="relative shrink-0 bg-white px-3 pb-2">
              <AlertsSearchRow
                query={alertQuery}
                onQuery={setAlertQuery}
                filterOpen={alertFilterOpen}
                onToggleFilter={() =>
                  setAlertFilterOpen((value) => !value)
                }
                chip={weatherOpen ? "" : feedChip}
                onSelectChip={(key) => {
                  setFeedChip(key)
                  setWeatherOpen(false)
                  clearSelection()
                }}
                units={isOfficial ? unitOptions : undefined}
                unitValue={unitFilter}
                onSelectUnit={(value) => {
                  setUnitFilter(value)
                  clearSelection()
                }}
              />
            </div>
          }
          emptyState={
            alertQuery.trim() ? (
              <div className="flex flex-col items-center px-6 py-10 text-center">
                <SearchIcon
                  className="size-8 text-neutral-300"
                  strokeWidth={1.8}
                  aria-hidden="true"
                />
                <p className="mt-3 text-[14px] text-neutral-500">
                  No alerts match this search.
                </p>
                <button
                  type="button"
                  onClick={() => setAlertQuery("")}
                  className="mt-2 text-[14px] font-semibold text-brand-orange"
                >
                  Clear search
                </button>
              </div>
            ) : null
          }
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
      {/* Mounted before the fetch resolves so the map's own chrome does not
          need a single record to be useful. The snapshot only fills it in. */}
      <AlertsLeafletMap
        snapshot={filteredSnapshot}
        layers={defaultLayers}
        selected={selected}
        selectedStreetNames={mapSelectedStreetNames}
        onSelect={selectOnMap}
        onMapInteract={collapseSheetForMap}
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
          navigate("/dashboard/overview")
        }
        aria-label="Back to the overview"
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
              {mapAlertCount > 0 ? ` · ${mapAlertCount}` : ""}
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
