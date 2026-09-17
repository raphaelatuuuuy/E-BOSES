import {
  createElement,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react"
import { useLocation, useNavigate } from "react-router-dom"
import {
  Check,
  ChevronLeftIcon,
  CloudSunIcon,
  LeafIcon,
  LogInIcon,
  SearchIcon,
  ShieldCheckIcon,
  TrafficConeIcon,
  TriangleAlertIcon,
  UserPlusIcon,
  UserRoundIcon,
} from "lucide-react"
import { useAuthSession } from "@/features/auth/auth-session"
import {
  getPublicReportMap,
  commentOnConcern,
  deleteConcernComment,
  updateConcernComment,
  type Concern,
  type PublicReportMapConcern,
  type PublicReportMapAnnouncement,
  type PublicReportMapEmergency,
  type PublicReportMapSnapshot,
} from "@/features/dashboard/api"
import { CreateReportDialog } from "@/features/dashboard/components/create-report-dialog"
import { FeedPostCard } from "@/features/dashboard/components/feed-post-card"
import { AnnouncementComments } from "@/features/dashboard/components/home/announcement-comments"
import { AnnouncementSummary } from "@/features/dashboard/components/home/announcement-summary"
import { type AlertCardModel } from "@/features/dashboard/components/alerts-map/alert-card"
import {
  AlertsFeed,
  type AlertFeedRow,
} from "@/features/dashboard/components/alerts-map/alerts-feed"
import { AlertsSearchRow } from "@/features/dashboard/components/alerts-map/alerts-search-row"
import type { LocationPickerAlertMarker } from "@/features/dashboard/components/location-picker"
import {
  MapWeatherIcon,
  useMapWeather,
  type MapWeatherState,
} from "@/features/dashboard/components/map-weather"
import {
  ANNOUNCEMENT_ACCENT,
  advisoryLabel,
  advisoryMeta,
} from "@/features/dashboard/components/community-content/advisory-tags"

import type { Selection } from "@/features/dashboard/components/alerts-map/lib"
import {
  SheetDialog,
  SheetList,
  SheetOptionRow,
} from "@/features/dashboard/components/sheet-dialog"
import { timeAgo } from "@/features/dashboard/lib/format"
import {
  announcementSummary,
  announcementTitle,
  formatAnnouncementDateTime,
} from "@/features/dashboard/lib/announcement-summary"
import { streetSegment } from "@/features/dashboard/lib/location-text"
import { usePageTitle } from "@/hooks/use-page-title"

import { SuccessAssignedDialog } from "@/features/dashboard/components/success-assigned-dialog"
import { resolveIconByKey } from "@/features/dashboard/components/concerns/resolve-icon"

const PublicLocationPicker = lazy(
  () => import("@/features/dashboard/components/location-picker")
)

type SelectedAlert = {
  kind: "concern" | "emergency" | "announcement"
  id: number
}
type PublicAlert =
  | PublicReportMapConcern
  | PublicReportMapEmergency
  | PublicReportMapAnnouncement

const PUBLIC_SETTLED_ALERT_STATUSES = new Set([
  "resolved",
  "partially_resolved",
  "closed",
  "cancelled",
  "false_alarm",
  "invalid",
  "rejected",
])

function publicAlertGroup(alert: PublicAlert) {
  if (alert.kind === "announcement") return 2
  return PUBLIC_SETTLED_ALERT_STATUSES.has(alert.status.toLowerCase()) ? 1 : 0
}

function publicAlertPriority(alert: PublicAlert) {
  if (alert.kind === "emergency") return 3
  if (alert.kind !== "concern") return 0

  switch ((alert.severity || "").toLowerCase()) {
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

type PublicPanelProps = {
  panelRef?: RefObject<HTMLElement | null>
  panelStyle?: CSSProperties
  onResizeStart?: (event: ReactPointerEvent<HTMLDivElement>) => void
}

function useDragDismiss(onDismiss: () => void) {
  const [dragY, setDragY] = useState(0)
  const [dragging, setDragging] = useState(false)
  const sheetRef = useRef<HTMLElement | null>(null)
  const startY = useRef(0)
  const lastY = useRef(0)
  const lastT = useRef(0)
  const flickV = useRef(0)

  useEffect(() => {
    if (!dragging) return
    function move(event: PointerEvent) {
      onMove(event as unknown as ReactPointerEvent<HTMLDivElement>)
    }
    function up(event: PointerEvent) {
      onUp(event as unknown as ReactPointerEvent<HTMLDivElement>)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", up)
    return () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", up)
    }
  })

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onDismiss()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onDismiss])

  function begin(clientY: number) {
    startY.current = clientY
    lastY.current = clientY
    lastT.current = performance.now()
    flickV.current = 0
    setDragging(true)
  }

  function onDown(event: ReactPointerEvent<HTMLDivElement>) {
    begin(event.clientY)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onHeaderDown(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button,input,textarea,a"))
      return
    begin(event.clientY)
  }

  function onMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragging) return
    const now = performance.now()
    const dt = Math.max(now - lastT.current, 1)
    flickV.current = (event.clientY - lastY.current) / dt
    lastY.current = event.clientY
    lastT.current = now
    setDragY(Math.max(event.clientY - startY.current, 0))
  }

  function onUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragging) return
    setDragging(false)
    const dy = event.clientY - startY.current
    const fresh = performance.now() - lastT.current < 120
    const velocity = fresh ? flickV.current : 0
    const height = sheetRef.current?.offsetHeight ?? 600
    if (dy > Math.min(140, height * 0.25) || (velocity > 0.6 && dy > 40)) {
      setDragY(0)
      onDismiss()
    } else {
      setDragY(0)
    }
  }

  return { dragY, dragging, sheetRef, onDown, onHeaderDown }
}

function announcementPinPosition(alert: PublicReportMapAnnouncement) {
  if (alert.latitude != null && alert.longitude != null) {
    return { latitude: alert.latitude, longitude: alert.longitude }
  }

  const ring = alert.area_geometry?.coordinates[0] ?? []
  if (ring.length > 0) {
    let latitude = 0
    let longitude = 0
    for (const [lng, lat] of ring) {
      latitude += lat
      longitude += lng
    }
    return {
      latitude: latitude / ring.length,
      longitude: longitude / ring.length,
    }
  }

  return alert.community.center
}

function PublicCategoryIcon({
  category,
  iconKey,
}: {
  category: string
  iconKey?: string
}) {
  const Resolved = resolveIconByKey(iconKey)
  if (Resolved) return createElement(Resolved, { className: "size-5" })
  if (category === "infrastructure")
    return <TrafficConeIcon className="size-5" />
  if (category === "environment") return <LeafIcon className="size-5" />
  if (category === "public_safety")
    return <ShieldCheckIcon className="size-5" />
  return <SearchIcon className="size-5" />
}

function publicConcernAsFeedPost(
  alert: PublicReportMapConcern,
  canInteract: boolean
): Concern {
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
    can_interact: canInteract,
    is_anonymous:
      reporterName === "Community Reporter" || reporterName === "Anonymous",
    reporter: { ...alert.reporter, initials },
    title: alert.title,
    description: alert.description,
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
    status_events: alert.resolved_at
      ? [
          {
            id: 0,
            status: "resolved",
            note: "",
            actor: null,
            created_at: alert.resolved_at,
          },
        ]
      : [],
    resolution_evidence: (alert.resolution_evidence ?? []).map((item) => ({
      id: 0,
      uploaded_by: null,
      original_filename: item.original_filename,
      mime_type: item.mime_type,
      file_size: 0,
      note: "",
      raw_url: "",
      preview_url: item.preview_url,
      privacy_state: "",
      privacy_detected_classes: [],
      created_at: alert.updated_at,
    })),
    comments: alert.comments,
    vote_count: 0,
    comment_count: alert.comment_count,
    severity: alert.severity,
    severity_assessed: alert.severity_assessed,
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
  sessionUser,
  onRefresh,
  onSignIn,
  onClose,
  panelRef,
  panelStyle,
  onResizeStart,
}: {
  alert: PublicAlert
  sessionUser: Concern["reporter"] | null
  onRefresh: () => Promise<void>
  onSignIn: () => void
  onClose: () => void
} & PublicPanelProps) {
  const isConcern = alert.kind === "concern"
  const isAnnouncement = alert.kind === "announcement"
  const alertStatus = isAnnouncement ? alert.status_label : alert.status
  const closed = [
    "resolved",
    "closed",
    "cancelled",
    "false_alarm",
    "invalid",
  ].includes(alertStatus)
  const location = isAnnouncement
    ? alert.place_label?.trim() ||
      alert.affected_streets.join(", ") ||
      alert.community.name
    : streetSegment(alert.address) || alert.community.name
  const TagIcon = isAnnouncement ? advisoryMeta(alert.tag).icon : null
  const model: AlertCardModel = {
    kind: isConcern ? "concern" : isAnnouncement ? "advisory" : "emergency",
    id: alert.id,
    live: !closed,
    closed,
    title: isConcern
      ? alert.title
      : isAnnouncement
        ? announcementTitle(alert)
        : closed
          ? `${alert.type_label} emergency`
          : `Ongoing ${alert.type_label.toLowerCase()} around ${location}`,
    meta: [location, timeAgo(alert.updated_at)].join(" · "),
    status: null,
    snippet: isConcern
      ? alert.summary || "No public update available."
      : isAnnouncement
        ? announcementSummary(alert)
        : alert.display_description ||
          `${alert.type_label} emergency reported.`,
    snippetLabel: null,
    actionLabel: null,
  }
  const sheetDrag = useDragDismiss(onClose)

  return (
    <aside
      ref={(node) => {
        if (panelRef) panelRef.current = node
        sheetDrag.sheetRef.current = node
      }}
      style={{
        ...(panelStyle ?? {}),
        ...(sheetDrag.dragY !== 0
          ? { transform: `translateY(${sheetDrag.dragY}px)` }
          : null),
      }}
      className={`absolute inset-x-0 bottom-0 z-[600] flex max-h-[min(75svh,620px)] min-w-0 flex-col overflow-hidden rounded-t-2xl border border-b-0 border-neutral-200 bg-white shadow-[0_8px_28px_rgba(15,23,42,.12)] sm:inset-x-auto sm:bottom-auto sm:top-4 sm:left-4 sm:w-[min(100%,380px)] sm:rounded-2xl sm:border ${sheetDrag.dragging ? "" : "transition-transform duration-200 ease-out"}`}
    >
      <div
        onPointerDown={sheetDrag.onDown}
        className="flex shrink-0 cursor-grab touch-none items-center justify-center py-2.5 select-none active:cursor-grabbing"
      >
        <span className="h-1 w-10 rounded-full bg-neutral-300" />
      </div>
      <div className="hidden shrink-0 items-center justify-end px-3 pb-1 sm:flex">
        <button
          type="button"
          onClick={onClose}
          className="rounded-full px-3 py-1.5 text-[13px] font-semibold text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
        >
          Back
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
              post={publicConcernAsFeedPost(alert, sessionUser != null)}
              sessionUser={sessionUser}
              commentsExpanded
              className="rounded-none border-0 shadow-none"
              hideMoreMenu
              onVote={() => undefined}
              onComment={async (postId, body, parent, media) => {
                if (!sessionUser) {
                  onSignIn()
                  return false
                }
                await commentOnConcern(postId, { body, parent, media })
                await onRefresh()
              }}
              onEditComment={async (postId, commentId, body) => {
                await updateConcernComment(postId, commentId, { body })
                await onRefresh()
              }}
              onDeleteComment={async (postId, commentId) => {
                await deleteConcernComment(postId, commentId)
                await onRefresh()
              }}
            />
            {!sessionUser ? (
              <div className="border-t border-neutral-100 px-4 py-3 text-center">
                <button
                  type="button"
                  onClick={onSignIn}
                  className="text-[13px] font-semibold text-neutral-900 underline decoration-neutral-300 underline-offset-4 transition-colors hover:decoration-neutral-900"
                >
                  Sign in to comment
                </button>
                <p className="mt-1.5 text-[12px] leading-5 text-neutral-500">
                  Join the conversation and keep track of your reports.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      ) : isAnnouncement ? (
        <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto overscroll-contain bg-white px-4 pb-6 text-neutral-900">
          <div className="flex shrink-0 items-center gap-1 pt-3 pb-1">
            <button
              type="button"
              onClick={onClose}
              className="flex size-9 shrink-0 items-center justify-center rounded-full text-neutral-700 hover:bg-neutral-100"
              aria-label="Back to list"
            >
              <ChevronLeftIcon className="size-5" strokeWidth={2.25} />
            </button>
            <p className="min-w-0 flex-1 truncate text-left text-[15px] font-semibold text-neutral-600">
              Advisory
            </p>
          </div>
          <div className="mt-4 flex items-start gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-severity-low-surface text-severity-low">
              {TagIcon ? (
                <TagIcon className="size-5" strokeWidth={2.1} aria-hidden />
              ) : null}
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="mt-1 text-[18px] leading-snug font-bold break-words">
                {alert.title}
              </h2>
            </div>
          </div>
          {alert.image_url ? (
            <img
              src={alert.image_url}
              alt={alert.image_alt || ""}
              className="mt-4 h-auto w-full rounded-xl border border-neutral-200 object-contain"
            />
          ) : null}
          <div className="mt-4 space-y-1">
            <p className="text-meta text-neutral-500">
              Posted on {formatAnnouncementDateTime(alert)}
            </p>
            <p className="text-[16px] leading-relaxed whitespace-pre-wrap text-neutral-800">
              {alert.body}
            </p>
          </div>
          <AnnouncementSummary announcement={alert} className="mt-4" />
          <div className="mt-5">
            <AnnouncementComments announcementId={alert.id} />
          </div>
        </div>
      ) : (
        <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto overscroll-contain bg-white px-4 pb-6 text-neutral-900">
          <div className="flex shrink-0 items-center gap-1 pt-3 pb-1">
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
          <div className="mt-2 flex items-start gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-severity-critical-surface text-sos">
              <TriangleAlertIcon className="size-6" strokeWidth={1.9} />
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
  query,
  filterOpen,
  weather,
  weatherOpen,
  onFilterChange,
  onQueryChange,
  onFilterToggle,
  onWeatherToggle,
  onSelect,
  onCollapse,
  signedIn,
  onSignIn,
  panelRef,
  panelStyle,
  onResizeStart,
}: {
  areaName: string
  rows: AlertFeedRow[]
  filter: string
  query: string
  filterOpen: boolean
  weather: MapWeatherState
  weatherOpen: boolean
  onFilterChange: (value: string) => void
  onQueryChange: (value: string) => void
  onFilterToggle: () => void
  onWeatherToggle: () => void
  onSelect: (selection: Selection) => void
  onCollapse: () => void
  signedIn: boolean
  onSignIn: () => void
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
  const sheetDrag = useDragDismiss(onCollapse)

  return (
    <aside
      ref={(node) => {
        if (panelRef) panelRef.current = node
        sheetDrag.sheetRef.current = node
      }}
      style={{
        ...(panelStyle ?? {}),
        ...(sheetDrag.dragY !== 0
          ? { transform: `translateY(${sheetDrag.dragY}px)` }
          : null),
      }}
      className={`absolute inset-x-0 bottom-0 z-[600] flex max-h-[min(75svh,620px)] min-w-0 flex-col overflow-hidden rounded-t-2xl border border-b-0 border-neutral-200 bg-white shadow-[0_8px_28px_rgba(15,23,42,.12)] sm:inset-x-auto sm:bottom-auto sm:top-4 sm:left-4 sm:w-[min(100%,380px)] sm:rounded-2xl sm:border ${sheetDrag.dragging ? "" : "transition-transform duration-200 ease-out"}`}
    >
      <div
        onPointerDown={sheetDrag.onDown}
        className="flex shrink-0 cursor-grab touch-none items-center justify-center py-2.5 select-none active:cursor-grabbing"
      >
        <span className="h-1 w-10 rounded-full bg-neutral-300" />
      </div>
      <div className="hidden shrink-0 items-center justify-end px-3 pb-1 sm:flex">
        <button
          type="button"
          onClick={onCollapse}
          className="rounded-full px-3 py-1.5 text-[13px] font-semibold text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
        >
          Close
        </button>
      </div>
      <AlertsFeed
        areaName={areaName}
        total={rows.length}
        rows={rows}
        onSelect={onSelect}
        weatherMode={weatherOpen}
        weatherToggle={weatherToggle}
        weather={weather}
        listToolbar={
          <div className="relative shrink-0 bg-white px-3 pb-2">
            <AlertsSearchRow
              query={query}
              onQuery={onQueryChange}
              filterOpen={filterOpen}
              onToggleFilter={onFilterToggle}
              chip={weatherOpen ? "" : filter}
              onSelectChip={(value) => {
                onFilterChange(value)
                if (weatherOpen) onWeatherToggle()
              }}
            />
          </div>
        }
        showRealIconWhenClosed
      />
      {!signedIn ? (
        <div className="shrink-0 border-t border-neutral-100 bg-white px-4 py-4 text-center">
          <button
            type="button"
            onClick={onSignIn}
            className="text-[13px] font-semibold text-neutral-900 underline decoration-neutral-300 underline-offset-4 transition-colors hover:decoration-neutral-900"
          >
            Sign in to comment
          </button>
          <p className="mt-1 text-[12px] leading-5 text-neutral-500">
            Join the conversation and keep track of your reports.
          </p>
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
            description="No account required."
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
      </div>
    </SheetDialog>
  )
}

export default function ReportIssuePage() {
  usePageTitle("Report an Issue")
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuthSession()
  const [snapshot, setSnapshot] = useState<PublicReportMapSnapshot | null>(null)
  const [selected, setSelected] = useState<SelectedAlert | null>(null)
  const [identityOpen, setIdentityOpen] = useState(false)
  const [guestOpen, setGuestOpen] = useState(false)
  const [guestSuccessOpen, setGuestSuccessOpen] = useState(false)
  const [authenticatedComposerOpen, setAuthenticatedComposerOpen] =
    useState(false)
  const [alertFilter, setAlertFilter] = useState("all")
  const [alertQuery, setAlertQuery] = useState("")
  const [alertFilterOpen, setAlertFilterOpen] = useState(false)
  const [weatherOpen, setWeatherOpen] = useState(false)
  const [alertsPanelOpen, setAlertsPanelOpen] = useState(false)
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

  const mapSectionRef = useRef<HTMLDivElement>(null)

  const refreshPublicReports = useCallback(async () => {
    const data = await getPublicReportMap()
    setSnapshot(data)
  }, [])

  const stateHighlightId = (
    location.state as { highlightConcernId?: unknown } | null
  )?.highlightConcernId
  const queryHighlightId = new URLSearchParams(location.search).get(
    "highlightConcernId"
  )
  const parsedHighlightId = Number(queryHighlightId ?? stateHighlightId)
  const highlightId = Number.isInteger(parsedHighlightId)
    ? parsedHighlightId
    : null
  const highlightConsumedRef = useRef<number | null>(null)

  useEffect(() => {
    if (highlightId == null || !snapshot) return
    if (highlightConsumedRef.current === highlightId) return
    highlightConsumedRef.current = highlightId
    const found = (snapshot.concerns ?? []).some(
      (item) => item.id === highlightId
    )
    if (!found) return
    // Syncing external navigation state into the map selection.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected({ kind: "concern", id: highlightId })
    setAlertsPanelOpen(true)
  }, [highlightId, snapshot])

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
    const handleReportCreated = () => {
      void refreshPublicReports().catch(() => undefined)
    }
    window.addEventListener("eboses:report-created", handleReportCreated)
    return () =>
      window.removeEventListener("eboses:report-created", handleReportCreated)
  }, [refreshPublicReports])

  const sessionUser = user
    ? {
        id: user.id,
        full_name: user.full_name || user.firstName || user.email,
        initials: (user.full_name || user.firstName || user.email)
          .split(/\s+/)
          .map((part) => part[0] || "")
          .join("")
          .slice(0, 2)
          .toUpperCase(),
        role: user.role,
        last_seen_at: user.last_seen_at ?? null,
        responder_unit: user.responder_unit,
        is_on_duty: user.is_on_duty,
        street: user.address,
        barangay: user.barangay,
      }
    : null

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

  const allAlerts = useMemo<PublicAlert[]>(
    () => [
      ...(snapshot?.concerns ?? []),
      ...(snapshot?.emergencies ?? []),
      ...(snapshot?.announcements ?? []),
    ],
    [snapshot]
  )
  const selectedAlert = selected
    ? (allAlerts.find(
        (alert) => alert.kind === selected.kind && alert.id === selected.id
      ) ?? null)
    : null
  const firstCommunity =
    snapshot?.communities.find(
      (community) => community.name.trim().toLowerCase() === "marikina heights"
    ) ??
    snapshot?.communities[0] ??
    null
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
            !communityIdForFilter || alert.community.id === communityIdForFilter
        )
        .filter((alert) =>
          alertFilter === "concerns"
            ? alert.kind === "concern" || alert.kind === "emergency"
            : alertFilter === "announcements"
              ? alert.kind === "announcement"
              : true
        ),
    [allAlerts, alertFilter, communityIdForFilter]
  )
  const visibleListAlerts = useMemo(() => {
    const query = alertQuery.trim().toLowerCase()
    if (!query) return visibleAlerts

    const matches = (values: Array<unknown>) =>
      values.some(
        (value) =>
          typeof value === "string" && value.toLowerCase().includes(query)
      )

    return visibleAlerts.filter((alert) => {
      if (alert.kind === "concern") {
        return matches([
          alert.title,
          alert.description,
          alert.summary,
          alert.address,
          alert.community.name,
          alert.category_label,
          alert.reporter_label,
        ])
      }
      if (alert.kind === "emergency") {
        return matches([
          alert.type,
          alert.type_label,
          alert.address,
          alert.community.name,
          alert.display_description,
        ])
      }
      return matches([
        alert.title,
        alert.body,
        alert.community.name,
        alert.tag,
        alert.place_label,
        ...alert.affected_streets,
      ])
    })
  }, [alertQuery, visibleAlerts])
  const publicFeedRows = useMemo<AlertFeedRow[]>(() => {
    const sorted = [...visibleListAlerts].sort((a, b) => {
      const aGroup = publicAlertGroup(a)
      const bGroup = publicAlertGroup(b)
      if (aGroup !== bGroup) return aGroup - bGroup
      const priorityDifference =
        publicAlertPriority(b) - publicAlertPriority(a)
      if (priorityDifference !== 0) return priorityDifference
      return Date.parse(b.updated_at) - Date.parse(a.updated_at)
    })
    return sorted.map((alert) => {
      const isConcern = alert.kind === "concern"
      const isAnnouncement = alert.kind === "announcement"
      const status = isAnnouncement ? alert.status_label : alert.status
      const closed = PUBLIC_SETTLED_ALERT_STATUSES.has(status.toLowerCase())
      const location = isAnnouncement
        ? alert.place_label?.trim() ||
          alert.affected_streets.join(", ") ||
          alert.community.name
        : isConcern
          ? streetSegment(alert.address) || alert.community.name
          : alert.address?.trim() || alert.community.name
      const TagIcon = isAnnouncement
        ? advisoryMeta((alert as PublicReportMapAnnouncement).tag).icon
        : null
      const criticalConcern =
        isConcern && (alert as PublicReportMapConcern).severity === "critical"
      return {
        key: `${alert.kind}-${alert.id}`,
        selection: isAnnouncement
          ? undefined
          : { kind: alert.kind, id: alert.id },
        icon: criticalConcern ? (
          <TriangleAlertIcon className="size-5 text-sos" strokeWidth={2.2} />
        ) : isConcern && closed ? (
          <Check className="size-5 text-emerald-600" strokeWidth={2.5} />
        ) : isConcern ? (
          <PublicCategoryIcon
            category={(alert as PublicReportMapConcern).category}
            iconKey={(alert as PublicReportMapConcern).icon_key}
          />
        ) : isAnnouncement && TagIcon ? (
          <TagIcon className="size-5" strokeWidth={1.9} />
        ) : (
          <TriangleAlertIcon className="size-5" strokeWidth={1.9} />
        ),
        model: {
          kind: isConcern
            ? "concern"
            : isAnnouncement
              ? "advisory"
              : "emergency",
          id: alert.id,
          live: !closed,
          closed,
          critical: criticalConcern,
          title: isConcern
            ? alert.title
            : isAnnouncement
              ? announcementTitle(alert)
              : closed
                ? `${alert.type_label} emergency`
                : `Ongoing ${alert.type_label.toLowerCase()} around ${location}`,
          meta: isAnnouncement
            ? `${advisoryLabel((alert as PublicReportMapAnnouncement).tag)} · ${timeAgo(alert.updated_at)}`
            : [location, timeAgo(alert.updated_at)].join(" · "),
          status: null,
          accent: isAnnouncement
            ? {
                soft: ANNOUNCEMENT_ACCENT.soft,
                color: ANNOUNCEMENT_ACCENT.color,
              }
            : null,
          snippet: isConcern
            ? alert.summary || "No public update available."
            : isAnnouncement
              ? announcementSummary(alert)
              : alert.display_description ||
                `${alert.type_label} emergency reported.`,
          snippetLabel: null,
          actionLabel: isAnnouncement
            ? "View the advisory"
            : "View the concern",
        },
        onAction: () => {
          setSelected({ kind: alert.kind, id: alert.id })
        },
      }
    })
  }, [visibleListAlerts])
  const markerAlerts = useMemo<LocationPickerAlertMarker[]>(
    () =>
      visibleAlerts.flatMap<LocationPickerAlertMarker>((alert) =>
        alert.kind === "concern"
          ? [
              {
                id: alert.id,
                kind: "concern",
                latitude: alert.latitude,
                longitude: alert.longitude,
                title: alert.title,
                category: alert.category,
                reporterName:
                  alert.reporter_label ||
                  alert.reporter?.full_name ||
                  undefined,
                categoryLabel: alert.category_label,
                iconKey: (alert as PublicReportMapConcern).icon_key,
                status: alert.status,
                description: alert.description,
                summary: alert.summary,
                severity: alert.severity,
                meta: streetSegment(alert.address) || alert.community.name,
                date: alert.updated_at,
                resolvedAt: alert.resolved_at ?? alert.updated_at,
                image: alert.preview_url,
                resolutionImage:
                  (alert.resolution_evidence ?? []).find((item) =>
                    item.mime_type.startsWith("image/")
                  )?.preview_url ?? null,
                resolutionCount: (alert.resolution_evidence ?? []).filter(
                  (item) => item.mime_type.startsWith("image/")
                ).length,
              },
            ]
          : alert.kind === "announcement"
            ? (() => {
                const position = announcementPinPosition(alert)
                return [
                  {
                    id: alert.id,
                    kind: "announcement" as const,
                    latitude: position.latitude,
                    longitude: position.longitude,
                    title: announcementTitle(alert),
                    tag: alert.tag,
                    expiresAt: alert.expires_at,
                    areaGeometry: alert.area_geometry ?? null,
                    status: alert.status_label,
                    summary: alert.body,
                    llmSummary: announcementSummary(alert),
                    meta: alert.place_label || alert.community.name,
                    date:
                      alert.starts_at ?? alert.published_at ?? alert.created_at,
                    image: alert.image_url,
                  },
                ]
              })()
            : [
                {
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
                  meta: streetSegment(alert.address) || alert.community.name,
                  date: alert.updated_at,
                },
              ]
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
    <div className="fixed inset-0 z-[200] bg-neutral-100">
      <div
        ref={mapSectionRef}
        className="relative isolate z-0 h-full w-full overflow-hidden bg-neutral-100"
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
                  onAlertSelect={(selection) => {
                    setSelected(selection)
                    if (selection) setAlertsPanelOpen(true)
                  }}
                  onClose={() => undefined}
                  onConfirm={() => undefined}
                  onReportRequest={openIdentity}
                  onBackRequest={() => {
                    if (window.history.length > 1) navigate(-1)
                    else navigate("/")
                  }}
                  onAlertsRequest={() => setAlertsPanelOpen(true)}
                  showAlertsButton={!alertsPanelOpen}
                />
              </Suspense>
            </div>
            {alertsPanelOpen ? (
              selectedAlert ? (
                <PublicAlertPanel
                  alert={selectedAlert}
                  sessionUser={sessionUser}
                  onRefresh={refreshPublicReports}
                  onSignIn={chooseSignIn}
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
                  query={alertQuery}
                  filterOpen={alertFilterOpen}
                  weather={publicMapWeather}
                  weatherOpen={weatherOpen}
                  onFilterChange={setAlertFilter}
                  onQueryChange={setAlertQuery}
                  onFilterToggle={() => setAlertFilterOpen((value) => !value)}
                  onWeatherToggle={() => setWeatherOpen((value) => !value)}
                  onSelect={(selection) => {
                    if (selection) {
                      setSelected({ kind: selection.kind, id: selection.id })
                    }
                  }}
                  onCollapse={() => setAlertsPanelOpen(false)}
                  signedIn={sessionUser != null}
                  onSignIn={chooseSignIn}
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
            ) : null}
          </div>

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
        onGuestSubmitted={() => {
          setGuestSuccessOpen(true)
        }}
      />
      <SuccessAssignedDialog
        open={guestSuccessOpen}
        onClose={() => setGuestSuccessOpen(false)}
      />
      <CreateReportDialog
        open={authenticatedComposerOpen}
        onOpenChange={setAuthenticatedComposerOpen}
        initialLocation={null}
      />
    </div>
  )
}
