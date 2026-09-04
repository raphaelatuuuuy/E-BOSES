import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react"
import { Link, useNavigate } from "react-router-dom"
import {
  AlertTriangleIcon,
  ChevronLeftIcon,
  CircleAlertIcon,
  CloudSunIcon,
  LogInIcon,
  ShieldCheckIcon,
  UserPlusIcon,
  UserRoundIcon,
} from "lucide-react"
import { toast } from "sonner"

import { useAuthSession } from "@/features/auth/auth-session"
import {
  getPublicReportMap,
  type Concern,
  type PublicReportMapConcern,
  type PublicReportMapEmergency,
  type PublicReportMapSnapshot,
} from "@/features/dashboard/api"
import { CreateReportDialog } from "@/features/dashboard/components/create-report-dialog"
import { FeedPostCard } from "@/features/dashboard/components/feed-post-card"
import { type AlertCardModel } from "@/features/dashboard/components/alerts-map/alert-card"
import {
  ALERT_FEED_CHIPS,
  AlertsFeed,
  type AlertFeedRow,
} from "@/features/dashboard/components/alerts-map/alerts-feed"
import type { LocationPickerAlertMarker } from "@/features/dashboard/components/location-picker"
import { MapFilterChips } from "@/features/dashboard/components/map/filter-chips"
import {
  MapWeatherIcon,
  useMapWeather,
  type MapWeatherState,
} from "@/features/dashboard/components/map-weather"
import type { Selection } from "@/features/dashboard/components/alerts-map/lib"
import {
  SheetDialog,
  SheetList,
  SheetOptionRow,
} from "@/features/dashboard/components/sheet-dialog"
import { timeAgo } from "@/features/dashboard/lib/format"
import { usePageTitle } from "@/hooks/use-page-title"

import { LandingPageShell } from "../components/landing-page-shell"

const PublicLocationPicker = lazy(
  () => import("@/features/dashboard/components/location-picker")
)

type SelectedAlert = { kind: "concern" | "emergency"; id: number }
type PublicAlert = PublicReportMapConcern | PublicReportMapEmergency
type PublicPanelProps = {
  panelRef?: RefObject<HTMLElement | null>
  panelStyle?: CSSProperties
  onResizeStart?: (event: ReactPointerEvent<HTMLDivElement>) => void
}

function alertKey(alert: PublicAlert) {
  return `${alert.kind}:${alert.id}`
}

function publicConcernAsFeedPost(alert: PublicReportMapConcern): Concern {
  const reporterName = alert.reporter_label || "Community resident"
  const initials = reporterName
    .split(/\s+/)
    .map((part) => part[0] || "")
    .join("")
    .slice(0, 2)
    .toUpperCase()

  return {
    id: alert.id,
    public_id: String(alert.id),
    tracking_id: "",
    validation_status: "accepted",
    validation_summary: "",
    summary: alert.summary,
    rejection_code: "",
    status_version: 0,
    community: alert.community,
    reporter_community: alert.community,
    is_cross_community: false,
    access_mode: "foreign_read_only",
    can_interact: false,
    is_anonymous: reporterName === "Anonymous",
    reporter: {
      id: 0,
      full_name: reporterName,
      initials,
      role: "resident",
      last_seen_at: null,
      street: alert.address,
      barangay: alert.community.name,
    },
    title: alert.title,
    description: alert.summary,
    category: ["infrastructure", "environment", "public_safety"].includes(
      alert.category
    )
      ? (alert.category as Concern["category"])
      : "others",
    category_ref: null,
    assigned_department: null,
    status: alert.status,
    address: alert.address,
    latitude: String(alert.latitude),
    longitude: String(alert.longitude),
    location_source: "public_map",
    location_accuracy: null,
    barangay: alert.community.name,
    update_text: "",
    visibility: "community",
    media: alert.preview_url
      ? [
          {
            id: alert.id,
            original_filename: "Concern attachment",
            mime_type: "image/jpeg",
            file_size: 0,
            preview_url: alert.preview_url,
            raw_url: "",
            validation_status: "accepted",
            validation_detail: "",
            privacy_state: "protected",
            public_visible: true,
            privacy_detected_classes: [],
            relevance_state: "relevant",
            relevance_reason: "",
            redactions: [],
            uploaded_at: alert.created_at,
          },
        ]
      : [],
    status_events: [],
    comments: [],
    vote_count: 0,
    comment_count: 0,
    priority_score: 0,
    user_vote: 0,
    also_reported_count: 0,
    also_reported_by: null,
    recurrence_of: null,
    official_title: alert.title,
    community_incident: undefined as unknown as Concern["community_incident"],
    archived_at: null,
    reopened_at: null,
    reopen_count: 0,
    created_at: alert.created_at,
    updated_at: alert.updated_at,
  }
}

function PublicAlertPanel({
  alert,
  onClose,
  panelRef,
  panelStyle,
  onResizeStart,
}: {
  alert: PublicAlert
  onClose: () => void
} & PublicPanelProps) {
  const isConcern = alert.kind === "concern"
  const closed = [
    "resolved",
    "closed",
    "cancelled",
    "false_alarm",
    "invalid",
  ].includes(alert.status)
  const street = alert.address || "Reported area"
  const model: AlertCardModel = {
    kind: isConcern ? "concern" : "emergency",
    id: alert.id,
    live: !closed,
    closed,
    title: isConcern
      ? alert.title
      : closed
        ? `${alert.type_label} emergency`
        : `Ongoing ${alert.type_label.toLowerCase()}${street ? ` around ${street}` : ""}`,
    meta: [alert.community.name, street, timeAgo(alert.updated_at)]
      .filter(Boolean)
      .join(" · "),
    status: null,
    snippet: isConcern
      ? alert.summary || "No public update available."
      : alert.display_description || `${alert.type_label} emergency reported.`,
    snippetLabel: null,
    actionLabel: null,
  }

  return (
    <aside
      ref={panelRef}
      style={panelStyle}
      className="absolute top-3 right-3 left-3 z-50 flex max-h-[min(72vh,620px)] flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_8px_28px_rgba(15,23,42,.12)] sm:top-4 sm:right-auto sm:left-4 sm:w-[min(100%,380px)]"
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-neutral-100 px-3">
        <CircleAlertIcon
          className="size-5 shrink-0 text-neutral-800"
          strokeWidth={2.25}
        />
        <button
          type="button"
          onClick={onClose}
          className="ml-auto flex size-7 shrink-0 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100"
          aria-label="Close alert details"
          title="Close alert details"
        >
          <ChevronLeftIcon className="size-4" strokeWidth={2.25} />
        </button>
      </div>
      {isConcern ? (
        <div className="flex min-h-0 flex-1 flex-col bg-white text-neutral-900">
          <div className="flex shrink-0 items-center gap-1 px-2 pt-3 pb-1">
            <button
              type="button"
              onClick={onClose}
              className="flex size-9 shrink-0 items-center justify-center rounded-full text-neutral-700 hover:bg-neutral-100"
              aria-label="Back to list"
            >
              <ChevronLeftIcon className="size-5" strokeWidth={2.25} />
            </button>
            <p className="min-w-0 flex-1 truncate text-left text-[15px] font-semibold text-neutral-600">
              Report
            </p>
          </div>
          <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
            <FeedPostCard
              post={publicConcernAsFeedPost(alert)}
              sessionUser={null}
              commentsExpanded={false}
              className="rounded-none border-0 shadow-none"
              hideMoreMenu
              onVote={() => undefined}
              onComment={async () => undefined}
              onEditComment={async () => undefined}
              onDeleteComment={async () => undefined}
            />
          </div>
        </div>
      ) : (
        <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto overscroll-contain bg-white px-4 pb-6 text-neutral-900">
          <div className="flex shrink-0 items-center gap-1 pt-3 pb-1">
            <p className="text-[15px] font-semibold text-neutral-600">
              Emergency
            </p>
          </div>
          <div className="mt-2 flex items-start gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-severity-critical-surface text-sos">
              <AlertTriangleIcon className="size-6" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold text-neutral-900">
                Community emergency alert
              </p>
              <p className="mt-0.5 text-[12px] text-neutral-500">
                {model.meta}
              </p>
            </div>
          </div>
          <h2 className="mt-5 text-[18px] leading-snug font-bold break-words text-neutral-900">
            {model.title}
          </h2>
          {model.snippet ? (
            <p className="mt-4 text-[14px] leading-relaxed break-words whitespace-pre-wrap text-neutral-800">
              {model.snippet}
            </p>
          ) : null}
        </div>
      )}
      {onResizeStart ? (
        <div
          onPointerDown={onResizeStart}
          className="absolute right-0 bottom-0 hidden size-5 cursor-nwse-resize touch-none sm:block"
          aria-hidden
        />
      ) : null}
    </aside>
  )
}

function PublicAlertsPanel({
  areaName,
  rows,
  filter,
  weather,
  weatherOpen,
  onFilterChange,
  onWeatherToggle,
  onSelect,
  onCollapse,
  panelRef,
  panelStyle,
  onResizeStart,
}: {
  areaName: string
  rows: AlertFeedRow[]
  filter: string
  weather: MapWeatherState
  weatherOpen: boolean
  onFilterChange: (value: string) => void
  onWeatherToggle: () => void
  onSelect: (selection: Selection) => void
  onCollapse: () => void
} & PublicPanelProps) {
  const weatherToggle = (
    <button
      type="button"
      onClick={onWeatherToggle}
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

  return (
    <aside
      ref={panelRef}
      style={panelStyle}
      className="w-[min(100% - 24px,380px)] absolute top-3 left-3 z-50 flex max-h-[min(72vh,620px)] flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_8px_28px_rgba(15,23,42,.12)] sm:top-4 sm:left-4 sm:w-[min(100%,380px)]"
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-neutral-100 px-3">
        <CircleAlertIcon
          className="size-5 shrink-0 text-neutral-800"
          strokeWidth={2.25}
        />
        <button
          type="button"
          onClick={onCollapse}
          className="ml-auto flex size-7 shrink-0 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100"
          aria-label="Collapse alerts"
          title="Collapse alerts"
        >
          <ChevronLeftIcon className="size-4" strokeWidth={2.25} />
        </button>
      </div>
      <div className="shrink-0 bg-white px-3 pt-2 pb-2">
        <MapFilterChips
          className="min-w-0"
          tone="light"
          chips={ALERT_FEED_CHIPS.filter((chip) => chip.key !== "announcements")}
          chip={weatherOpen ? "" : filter}
          onSelect={(value) => {
            onFilterChange(value)
            if (weatherOpen) onWeatherToggle()
          }}
          label="Alert types"
        />
      </div>
      <AlertsFeed
        areaName={areaName}
        total={rows.length}
        rows={rows}
        onSelect={onSelect}
        weatherMode={weatherOpen}
        weatherToggle={weatherToggle}
        weather={weather}
      />
      {onResizeStart ? (
        <div
          onPointerDown={onResizeStart}
          className="absolute right-0 bottom-0 hidden size-5 cursor-nwse-resize touch-none sm:block"
          aria-hidden
        />
      ) : null}
    </aside>
  )
}

function IdentityDialog({
  open,
  onClose,
  onGuest,
  onSignUp,
  onSignIn,
}: {
  open: boolean
  onClose: () => void
  onGuest: () => void
  onSignUp: () => void
  onSignIn: () => void
}) {
  return (
    <SheetDialog
      open={open}
      onClose={onClose}
      title="Report as"
      description="Choose how you want to send this concern."
    >
      <div className="space-y-4">
        <SheetList>
          <SheetOptionRow
            leading={<UserRoundIcon className="size-5" strokeWidth={1.8} />}
            title="Continue as guest"
            description="Anonymous submission. No account required."
            onClick={onGuest}
            showChevron
          />
          <SheetOptionRow
            leading={<UserPlusIcon className="size-5" strokeWidth={1.8} />}
            title="Create an account"
            description="Save reports and receive updates."
            onClick={onSignUp}
            showChevron
          />
          <SheetOptionRow
            leading={<LogInIcon className="size-5" strokeWidth={1.8} />}
            title="Sign in"
            description="Use your existing E-Boses account."
            onClick={onSignIn}
            showChevron
          />
        </SheetList>

        <p className="text-[13px] leading-5 text-neutral-500">
          Reports are routed to the community covering this location.
        </p>
      </div>
    </SheetDialog>
  )
}

export default function ReportIssuePage() {
  usePageTitle("Report an Issue")
  const navigate = useNavigate()
  const { user } = useAuthSession()
  const [snapshot, setSnapshot] = useState<PublicReportMapSnapshot | null>(null)
  const [selected, setSelected] = useState<SelectedAlert | null>(null)
  const [identityOpen, setIdentityOpen] = useState(false)
  const [guestOpen, setGuestOpen] = useState(false)
  const [authenticatedComposerOpen, setAuthenticatedComposerOpen] =
    useState(false)
  const [alertFilter, setAlertFilter] = useState("all")
  const [weatherOpen, setWeatherOpen] = useState(false)
  const [alertsPanelOpen, setAlertsPanelOpen] = useState(true)
  const [alertsPanelSize, setAlertsPanelSize] = useState<{
    width: number
    height: number
  } | null>(null)
  const alertsPanelRef = useRef<HTMLElement>(null)
  const [alertsPanelResizing, setAlertsPanelResizing] = useState(false)
  const alertsPanelResizeStartRef = useRef<{
    x: number
    y: number
    w: number
    h: number
  } | null>(null)

  // Map container height — null until the visitor drags the (invisible)
  // bottom-right handle, then it overrides the CSS default below.
  const mapSectionRef = useRef<HTMLDivElement>(null)
  const [mapHeight, setMapHeight] = useState<number | null>(null)
  const [mapResizing, setMapResizing] = useState(false)
  const mapResizeStartRef = useRef<{ y: number; h: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    void getPublicReportMap()
      .then((data) => {
        if (!cancelled) setSnapshot(data)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!user || authenticatedComposerOpen) return
    const shouldResume =
      window.sessionStorage.getItem("eboses-report-return") === "/report-issue"
    if (!shouldResume) return
    const frame = window.requestAnimationFrame(() => {
      setAuthenticatedComposerOpen(true)
      window.sessionStorage.removeItem("eboses-report-return")
    })
    return () => window.cancelAnimationFrame(frame)
  }, [user, authenticatedComposerOpen])

  useEffect(() => {
    if (!alertsPanelResizing) return
    function onMove(event: PointerEvent) {
      const start = alertsPanelResizeStartRef.current
      if (!start) return
      const maxWidth = Math.min(640, window.innerWidth - 32)
      // Cap the panel to the map container's real height so it can never
      // extend past the map's bottom edge and get clipped (hidden) by the
      // container's overflow-hidden.
      const containerHeight =
        mapSectionRef.current?.getBoundingClientRect().height ?? 620
      const maxHeight = Math.max(220, Math.floor(containerHeight) - 24)
      setAlertsPanelSize({
        width: Math.min(
          maxWidth,
          Math.max(280, start.w + event.clientX - start.x)
        ),
        height: Math.min(
          maxHeight,
          Math.max(220, start.h + event.clientY - start.y)
        ),
      })
    }
    function onUp() {
      setAlertsPanelResizing(false)
      alertsPanelResizeStartRef.current = null
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
    }
  }, [alertsPanelResizing])

  function onAlertsPanelResizeStart(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault()
    const rect = alertsPanelRef.current?.getBoundingClientRect()
    if (!rect) return
    alertsPanelResizeStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      w: rect.width,
      h: rect.height,
    }
    setAlertsPanelResizing(true)
  }

  // Map container height resize — no visible indicator, just an invisible
  // hit area in the bottom-right corner.
  useEffect(() => {
    if (!mapResizing) return
    function onMove(event: PointerEvent) {
      const start = mapResizeStartRef.current
      if (!start) return
      const max = Math.min(window.innerHeight - 120, 960)
      const nextHeight = Math.min(
        max,
        Math.max(460, start.h + event.clientY - start.y)
      )
      setMapHeight(nextHeight)
      // Keep the alerts panel inside the map when the map shrinks.
      setAlertsPanelSize((prev) =>
        prev
          ? { ...prev, height: Math.max(220, Math.min(prev.height, nextHeight - 24)) }
          : prev
      )
    }
    function onUp() {
      setMapResizing(false)
      mapResizeStartRef.current = null
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
    }
  }, [mapResizing])

  function onMapResizeStart(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault()
    const rect = mapSectionRef.current?.getBoundingClientRect()
    if (!rect) return
    mapResizeStartRef.current = { y: event.clientY, h: rect.height }
    setMapResizing(true)
  }

  const allAlerts = useMemo<PublicAlert[]>(
    () => [...(snapshot?.concerns ?? []), ...(snapshot?.emergencies ?? [])],
    [snapshot]
  )
  const selectedAlert = selected
    ? (allAlerts.find(
        (alert) => alert.kind === selected.kind && alert.id === selected.id
      ) ?? null)
    : null
  // Community focused via the map's "Communities we serve" list — drives the
  // panel heading and filters the list + markers to that community's alerts.
  const [viewedCommunity, setViewedCommunity] = useState<{
    id: string
    name: string
    center: { latitude: number; longitude: number }
  } | null>(null)
  // The panel always names one community: the focused one, else the first
  // community the public map serves (never "all communities").
  const firstCommunity = snapshot?.communities[0] ?? null
  const activeCommunity = viewedCommunity ?? firstCommunity
  const publicMapArea = selectedAlert
    ? selectedAlert.community.name
    : (activeCommunity?.name ?? "your area")
  // Weather follows the same community: the selected alert's, else the
  // focused one, else the first served community (never the raw map center).
  const publicWeatherCommunity = selectedAlert
    ? snapshot?.communities.find(
        (community) => community.id === selectedAlert.community.id
      ) ?? firstCommunity
    : activeCommunity
  const publicMapWeather = useMapWeather(
    publicWeatherCommunity?.center.latitude ?? null,
    publicWeatherCommunity?.center.longitude ?? null,
    publicMapArea
  )
  // One shared filter for the list AND the map markers, so the panel's
  // "N on the map" always matches the markers actually rendered. The panel
  // always belongs to one community: the selected alert's, else the focused
  // one, else the first community the public map serves.
  const communityIdInPanel =
    selectedAlert?.community.id ?? activeCommunity?.id
  const visibleAlerts = useMemo(
    () =>
      allAlerts
        .filter(
          (alert) =>
            !communityIdInPanel || alert.community.id === communityIdInPanel
        )
        .filter((alert) =>
          alertFilter === "concerns"
            ? alert.kind === "concern" || alert.kind === "emergency"
            : alertFilter === "announcements"
              ? false
              : true
        ),
    [allAlerts, alertFilter, communityIdInPanel]
  )
  const publicFeedRows = useMemo<AlertFeedRow[]>(() => {
    return visibleAlerts.map((alert) => {
      const isConcern = alert.kind === "concern"
      const closed = [
        "resolved",
        "closed",
        "cancelled",
        "false_alarm",
        "invalid",
      ].includes(alert.status)
      const street = alert.address || "Reported area"
      return {
        key: `${alert.kind}-${alert.id}`,
        selection: { kind: alert.kind, id: alert.id },
        icon: isConcern ? (
          <ShieldCheckIcon className="size-5" />
        ) : (
          <AlertTriangleIcon className="size-5" />
        ),
        model: {
          kind: isConcern ? "concern" : "emergency",
          id: alert.id,
          live: !closed,
          closed,
          title: isConcern
            ? alert.title
            : closed
              ? `${alert.type_label} emergency`
              : `Ongoing ${alert.type_label.toLowerCase()} around ${street}`,
          meta: [alert.community.name, street, timeAgo(alert.updated_at)]
            .filter(Boolean)
            .join(" · "),
          status: null,
          snippet: isConcern
            ? alert.summary || "No public update available."
            : alert.display_description ||
              `${alert.type_label} emergency reported.`,
          snippetLabel: null,
          actionLabel: isConcern ? "View the concern" : "View the emergency",
        },
        onAction: () => {
          setSelected({ kind: alert.kind, id: alert.id })
        },
      }
    })
  }, [visibleAlerts])
  const markerAlerts = useMemo<LocationPickerAlertMarker[]>(
    () =>
      visibleAlerts.map((alert) =>
        alert.kind === "concern"
          ? {
              id: alert.id,
              kind: "concern",
              latitude: alert.latitude,
              longitude: alert.longitude,
              title: alert.title,
              category: alert.category,
              categoryLabel: alert.category_label,
              status: alert.status,
              summary: alert.summary,
              meta: [
                alert.community.name,
                alert.address,
                timeAgo(alert.updated_at),
              ]
                .filter(Boolean)
                .join(" · "),
              date: alert.updated_at,
              image: alert.preview_url,
            }
          : {
              id: alert.id,
              kind: "emergency",
              latitude: alert.latitude,
              longitude: alert.longitude,
              title: `There is an ongoing ${alert.type_label.toLowerCase()} around ${
                alert.address || "the reported area"
              }`,
              typeLabel: alert.type_label,
              status: alert.status,
              summary:
                alert.display_description ||
                `${alert.type_label} emergency reported.`,
              meta: "Emergency",
              date: alert.updated_at,
            }
      ),
    [visibleAlerts]
  )
  const recentAlerts = useMemo(
    () =>
      [...allAlerts]
        .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
        .slice(0, 3),
    [allAlerts]
  )
  function storeReportReturn() {
    window.sessionStorage.setItem("eboses-report-return", "/report-issue")
  }

  function openIdentity() {
    setIdentityOpen(true)
  }

  function chooseSignUp() {
    storeReportReturn()
    setIdentityOpen(false)
    navigate("/sign-up?returnTo=/report-issue")
  }

  function chooseSignIn() {
    storeReportReturn()
    setIdentityOpen(false)
    navigate("/sign-in?returnTo=/report-issue")
  }

  return (
    <LandingPageShell>
      <section className="px-5 pt-10 pb-16 md:px-10 md:pt-14 md:pb-24 lg:px-16">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl">
            <h1 className="max-w-2xl text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">
              See what your community is dealing with.
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-white/55">
              Browse active community alerts, or start a concern report and
              provide its location in the reporting form.
            </p>
          </div>

          <div
            ref={mapSectionRef}
            style={mapHeight ? { height: mapHeight } : undefined}
            className="relative isolate z-0 mt-8 h-[min(84svh,860px)] min-h-[560px] overflow-hidden rounded-2xl border border-white/10 bg-neutral-100 shadow-2xl sm:mt-10"
          >
            <div className="absolute inset-0 z-0">
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center text-sm text-neutral-500">
                    Loading map…
                  </div>
                }
              >
                <PublicLocationPicker
                  open
                  renderInline
                  signup
                  publicBrowse
                  publicAlerts={markerAlerts}
                  selectedAlert={selected}
                  onAlertSelect={setSelected}
                  onCommunityView={(community) => {
                    // Choosing a community is a new browsing context. Clear
                    // an open alert so its community cannot keep overriding
                    // the weather panel after the visitor changes areas.
                    setViewedCommunity(community)
                    setSelected(null)
                    setWeatherOpen(false)
                  }}
                  onClose={() => undefined}
                  onConfirm={() => undefined}
                  onReportRequest={openIdentity}
                />
              </Suspense>
            </div>
            {/* Invisible map resize hit area — height only, no indicator */}
            <div
              onPointerDown={onMapResizeStart}
              className="absolute right-0 bottom-0 z-40 hidden size-5 cursor-ns-resize touch-none sm:block"
              aria-hidden
            />
            {alertsPanelOpen ? (
              selectedAlert ? (
                <PublicAlertPanel
                  alert={selectedAlert}
                  onClose={() => setSelected(null)}
                  panelRef={alertsPanelRef}
                  panelStyle={
                    alertsPanelSize
                      ? {
                          width: alertsPanelSize.width,
                          maxHeight: alertsPanelSize.height,
                        }
                      : undefined
                  }
                  onResizeStart={onAlertsPanelResizeStart}
                />
              ) : (
                <PublicAlertsPanel
                  areaName={publicMapArea}
                  rows={publicFeedRows}
                  filter={alertFilter}
                  weather={publicMapWeather}
                  weatherOpen={weatherOpen}
                  onFilterChange={setAlertFilter}
                  onWeatherToggle={() => setWeatherOpen((value) => !value)}
                  onSelect={(selection) => {
                    if (selection) {
                      setSelected({ kind: selection.kind, id: selection.id })
                    }
                  }}
                  onCollapse={() => setAlertsPanelOpen(false)}
                  panelRef={alertsPanelRef}
                  panelStyle={
                    alertsPanelSize
                      ? {
                          width: alertsPanelSize.width,
                          maxHeight: alertsPanelSize.height,
                        }
                      : undefined
                  }
                  onResizeStart={onAlertsPanelResizeStart}
                />
              )
            ) : (
              <button
                type="button"
                onClick={() => setAlertsPanelOpen(true)}
                aria-label="Open alerts"
                title="Open alerts"
                className="absolute top-3 left-3 z-50 flex size-10 items-center justify-center rounded-lg border border-neutral-200 bg-white shadow-md sm:top-4 sm:left-4"
              >
                <CircleAlertIcon
                  className="size-5 shrink-0 text-neutral-800"
                  strokeWidth={2.25}
                />
              </button>
            )}
          </div>

          <div className="mt-12">
            <div>
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="font-mono text-[10px] font-bold tracking-[0.2em] text-accent uppercase">
                    Recent public alerts
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-white">
                    Stay close to what matters.
                  </h2>
                </div>
                <Link
                  to="/communities"
                  className="hidden text-sm font-semibold text-white/60 transition-colors hover:text-white sm:block"
                >
                  Active communities
                </Link>
              </div>
              <div className="mt-5 grid gap-3">
                {recentAlerts.length === 0 ? (
                  <p className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-5 text-sm text-white/50">
                    No public alerts match these filters.
                  </p>
                ) : (
                  recentAlerts.map((alert) => (
                    <button
                      key={alertKey(alert)}
                      type="button"
                      onClick={() =>
                        setSelected({ kind: alert.kind, id: alert.id })
                      }
                      className="group flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-4 text-left transition-colors hover:border-white/20 hover:bg-white/[0.08]"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-white">
                          {alert.kind === "concern"
                            ? alert.title
                            : `${alert.type_label} emergency`}
                        </span>
                        <span className="mt-1 block truncate text-xs text-white/45">
                          {alert.community.name} ·{" "}
                          {alert.address || "Reported area"}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-white/40">
                        {timeAgo(alert.updated_at)}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      <IdentityDialog
        open={identityOpen}
        onClose={() => setIdentityOpen(false)}
        onGuest={() => {
          setIdentityOpen(false)
          setGuestOpen(true)
        }}
        onSignUp={chooseSignUp}
        onSignIn={chooseSignIn}
      />
      <CreateReportDialog
        open={guestOpen}
        onOpenChange={setGuestOpen}
        guest
        initialLocation={null}
        onGuestSubmitted={() =>
          toast.success(
            "Your anonymous report is in the community review queue."
          )
        }
      />
      <CreateReportDialog
        open={authenticatedComposerOpen}
        onOpenChange={setAuthenticatedComposerOpen}
        initialLocation={null}
      />
    </LandingPageShell>
  )
}
