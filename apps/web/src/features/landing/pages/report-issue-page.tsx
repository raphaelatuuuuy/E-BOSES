import {
  createElement,
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
import { useNavigate } from "react-router-dom"
import {
  AlertTriangleIcon,
  ChevronLeftIcon,
  CircleAlertIcon,
  CloudSunIcon,
  LeafIcon,
  LogInIcon,
  SearchIcon,
  ShieldCheckIcon,
  TrafficConeIcon,
  UserPlusIcon,
  UserRoundIcon,
} from "lucide-react"
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
import { SuccessAssignedDialog } from "@/features/dashboard/components/success-assigned-dialog"
import { resolveIconByKey } from "@/features/dashboard/components/concerns/resolve-icon"

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

function hoverMeta(address: string, communityName: string) {
  const a = (address || "").trim()
  const c = (communityName || "").trim()
  if (!a) return c
  if (!c) return a
  if (a.toLowerCase() === c.toLowerCase()) return a
  const aLower = a.toLowerCase()
  const cLower = c.toLowerCase()
  if (aLower.endsWith(", " + cLower) || aLower.endsWith(" " + cLower)) return a
  if (aLower.includes(cLower)) return a
  return `${a}, ${c}`
}

function PublicCategoryIcon({ category, iconKey }: { category: string; iconKey?: string }) {
  const Resolved = resolveIconByKey(iconKey)
  if (Resolved) return createElement(Resolved, { className: "size-5" })
  if (category === "infrastructure") return <TrafficConeIcon className="size-5" />
  if (category === "environment") return <LeafIcon className="size-5" />
  if (category === "public_safety") return <ShieldCheckIcon className="size-5" />
  return <SearchIcon className="size-5" />
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
    is_anonymous: reporterName === "Community Reporter" || reporterName === "Anonymous",
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
  const location = alert.address?.trim() || alert.community.name
  const model: AlertCardModel = {
    kind: isConcern ? "concern" : "emergency",
    id: alert.id,
    live: !closed,
    closed,
    title: isConcern
      ? alert.title
      : closed
        ? `${alert.type_label} emergency`
        : `Ongoing ${alert.type_label.toLowerCase()} around ${location}`,
    meta: [location, timeAgo(alert.updated_at)].join(" · "),
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
      className="absolute top-3 right-3 left-3 z-[600] flex min-w-0 max-w-full max-h-[min(72svh,620px)] flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_8px_28px_rgba(15,23,42,.12)] sm:top-4 sm:right-auto sm:left-4 sm:w-[min(100%,380px)] sm:max-w-none"
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
                {alert.type_label} emergency alert
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
  relatedRows,
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
  relatedRows?: AlertFeedRow[]
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
      className="absolute top-3 right-3 left-3 z-[600] flex min-w-0 max-w-full max-h-[min(72svh,620px)] flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_8px_28px_rgba(15,23,42,.12)] sm:top-4 sm:right-auto sm:left-4 sm:w-[min(100%,380px)] sm:max-w-none"
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
        showRealIconWhenClosed
      />
      {relatedRows && relatedRows.length > 0 ? (
        <div className="shrink-0 border-t border-neutral-100 bg-neutral-50 px-3 py-2">
          <p className="text-[11px] font-bold tracking-[0.12em] text-neutral-500 uppercase">
            Related concerns in {areaName}
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {relatedRows.slice(0, 5).map((row) => (
              <li key={`related-${row.key}`}>
                <button
                  type="button"
                  onClick={() => row.selection && onSelect(row.selection)}
                  className="w-full truncate rounded-md bg-white px-2.5 py-2 text-left text-[13px] font-medium text-neutral-800 hover:bg-neutral-100"
                >
                  {row.model.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
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
            description="Community Reporter submission. No account required."
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
  const [guestSuccessUnit, setGuestSuccessUnit] = useState<string | null>(null)
  const [guestSuccessOpen, setGuestSuccessOpen] = useState(false)
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
  const firstCommunity = snapshot?.communities.find(
    (community) => community.name.trim().toLowerCase() === "marikina heights"
  ) ?? snapshot?.communities[0] ?? null
  const communityIdForFilter = firstCommunity?.id ?? null
  const publicMapArea = firstCommunity?.name ?? "Marikina Heights"
  const publicWeatherCommunity = firstCommunity
  const publicMapWeather = useMapWeather(
    publicWeatherCommunity?.center.latitude ?? null,
    publicWeatherCommunity?.center.longitude ?? null,
    publicMapArea
  )
  const visibleAlerts = useMemo(
    () =>
      allAlerts
        .filter(
          (alert) =>
            !communityIdForFilter ||
            alert.community.id === communityIdForFilter
        )
        .filter((alert) =>
          alertFilter === "concerns"
            ? alert.kind === "concern" || alert.kind === "emergency"
            : alertFilter === "announcements"
              ? false
              : true
        ),
    [allAlerts, alertFilter, communityIdForFilter]
  )
  const publicFeedRows = useMemo<AlertFeedRow[]>(() => {
    const sorted = [...visibleAlerts].sort((a, b) => {
      const aClosed = [
        "resolved",
        "closed",
        "cancelled",
        "false_alarm",
        "invalid",
      ].includes(a.status)
      const bClosed = [
        "resolved",
        "closed",
        "cancelled",
        "false_alarm",
        "invalid",
      ].includes(b.status)
      const aGroup = aClosed ? 2 : a.kind === "emergency" ? 0 : 1
      const bGroup = bClosed ? 2 : b.kind === "emergency" ? 0 : 1
      if (aGroup !== bGroup) return aGroup - bGroup
      return Date.parse(b.updated_at) - Date.parse(a.updated_at)
    })
    return sorted.map((alert) => {
      const isConcern = alert.kind === "concern"
      const closed = [
        "resolved",
        "closed",
        "cancelled",
        "false_alarm",
        "invalid",
      ].includes(alert.status)
      const location = alert.address?.trim() || alert.community.name
      return {
        key: `${alert.kind}-${alert.id}`,
        selection: { kind: alert.kind, id: alert.id },
        icon: isConcern ? (
          <PublicCategoryIcon category={(alert as PublicReportMapConcern).category} iconKey={(alert as PublicReportMapConcern).icon_key} />
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
              : `Ongoing ${alert.type_label.toLowerCase()} around ${location}`,
          meta: [location, timeAgo(alert.updated_at)].join(" · "),
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
  const isFiltered =
    Boolean(communityIdForFilter) || alertFilter !== "all" || Boolean(selectedAlert)
  const relatedAlerts = useMemo(() => {
    if (!isFiltered) return []
    const visibleIds = new Set(
      visibleAlerts.map((a) => `${a.kind}:${a.id}`)
    )
    let candidates = allAlerts.filter(
      (a) => !visibleIds.has(`${a.kind}:${a.id}`) && a.kind === "concern"
    )
    if (communityIdForFilter) {
      const sameCommunity = candidates.filter(
        (a) => a.community.id === communityIdForFilter
      )
      if (sameCommunity.length) candidates = sameCommunity
    }
    const firstVisibleConcern = visibleAlerts.find(
      (a) => a.kind === "concern"
    ) as PublicReportMapConcern | undefined
    const selectedConcern =
      selectedAlert?.kind === "concern"
        ? (selectedAlert as PublicReportMapConcern)
        : null
    const baseCategory =
      firstVisibleConcern?.category ?? selectedConcern?.category ?? null
    if (baseCategory) {
      const sameCat = (candidates as PublicReportMapConcern[]).filter(
        (a) => a.category === baseCategory
      )
      if (sameCat.length) return sameCat.slice(0, 5)
    }
    return candidates.slice(0, 5)
  }, [allAlerts, visibleAlerts, communityIdForFilter, selectedAlert, isFiltered])
  const relatedFeedRows = useMemo<AlertFeedRow[]>(() => {
    return (relatedAlerts as PublicReportMapConcern[]).map((alert) => {
      const closed = [
        "resolved",
        "closed",
        "cancelled",
        "false_alarm",
        "invalid",
      ].includes(alert.status)
      return {
        key: `related-${alert.kind}-${alert.id}`,
        selection: { kind: alert.kind, id: alert.id },
        icon: <PublicCategoryIcon category={alert.category} iconKey={alert.icon_key} />,
        model: {
          kind: "concern" as const,
          id: alert.id,
          live: !closed,
          closed,
          title: alert.title,
          meta: [alert.community.name, alert.address, timeAgo(alert.updated_at)]
            .filter(Boolean)
            .join(" · "),
          status: null,
          snippet: alert.summary || "No public update available.",
          snippetLabel: null,
          actionLabel: "View the concern",
        },
        onAction: () => {
          setSelected({ kind: alert.kind, id: alert.id })
        },
      }
    })
  }, [relatedAlerts])
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
              iconKey: (alert as PublicReportMapConcern).icon_key,
              status: alert.status,
              summary: alert.summary,
              meta: hoverMeta(alert.address, alert.community.name),
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
              meta: hoverMeta(alert.address, alert.community.name),
              date: alert.updated_at,
            }
      ),
    [visibleAlerts]
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
                   relatedRows={relatedFeedRows}
                 />
              )
            ) : (
              <button
                type="button"
                onClick={() => setAlertsPanelOpen(true)}
                aria-label="Open alerts"
                title="Open alerts"
                className="absolute top-3 left-3 z-[600] flex size-10 items-center justify-center rounded-lg border border-neutral-200 bg-white shadow-md sm:top-4 sm:left-4"
              >
                <CircleAlertIcon
                  className="size-5 shrink-0 text-neutral-800"
                  strokeWidth={2.25}
                />
              </button>
            )}
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
        onGuestSubmitted={(assignedUnit) => {
          setGuestSuccessUnit(assignedUnit?.short_name || assignedUnit?.name || null)
          setGuestSuccessOpen(true)
        }}
      />
      <SuccessAssignedDialog
        open={guestSuccessOpen}
        onClose={() => setGuestSuccessOpen(false)}
        unitName={guestSuccessUnit}
      />
      <CreateReportDialog
        open={authenticatedComposerOpen}
        onOpenChange={setAuthenticatedComposerOpen}
        initialLocation={null}
      />
    </LandingPageShell>
  )
}
