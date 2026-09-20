import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { useNavigate } from "react-router-dom"
import { Check, TriangleAlertIcon } from "lucide-react"

import { useAuthSession } from "@/features/auth/auth-session"
import {
  getPublicReportMap,
  type PublicReportMapAnnouncement,
  type PublicReportMapConcern,
  type PublicReportMapSnapshot,
} from "@/features/dashboard/api"
import { CreateReportDialog } from "@/features/dashboard/components/create-report-dialog"
import { IdentityDialog } from "@/features/dashboard/components/identity-dialog"
import type { LocationPickerAlertMarker } from "@/features/dashboard/components/location-picker"
import { SuccessAssignedDialog } from "@/features/dashboard/components/success-assigned-dialog"
import { type AlertFeedRow } from "@/features/dashboard/components/alerts-map/alerts-feed"
import { useMapWeather } from "@/features/dashboard/components/map-weather"
import {
  ANNOUNCEMENT_ACCENT,
  advisoryLabel,
  advisoryMeta,
} from "@/features/dashboard/components/community-content/advisory-tags"
import {
  PUBLIC_SETTLED_ALERT_STATUSES,
  PublicAlertPanel,
  PublicAlertsPanel,
  PublicCategoryIcon,
  announcementPinPosition,
  publicAlertGroup,
  publicAlertPriority,
  type PublicAlert,
} from "@/features/dashboard/components/public-alert-panels"
import {
  announcementSummary,
  announcementTitle,
} from "@/features/dashboard/lib/announcement-summary"
import { timeAgo } from "@/features/dashboard/lib/format"
import { streetSegment } from "@/features/dashboard/lib/location-text"
import { usePageTitle } from "@/hooks/use-page-title"

const PublicLocationPicker = lazy(
  () => import("@/features/dashboard/components/location-picker")
)

export default function GuestReportPage() {
  usePageTitle("Report an Issue")
  const navigate = useNavigate()
  const { user } = useAuthSession()
  const [snapshot, setSnapshot] = useState<PublicReportMapSnapshot | null>(null)
  const [selected, setSelected] = useState<{
    kind: "concern" | "emergency" | "announcement"
    id: number
  } | null>(null)
  const [identityOpen, setIdentityOpen] = useState(false)
  const [guestOpen, setGuestOpen] = useState(false)
  const [guestSuccessOpen, setGuestSuccessOpen] = useState(false)
  const [alertsPanelOpen, setAlertsPanelOpen] = useState(false)
  const [alertFilter, setAlertFilter] = useState("all")
  const [alertQuery, setAlertQuery] = useState("")
  const [alertFilterOpen, setAlertFilterOpen] = useState(false)
  const [weatherOpen, setWeatherOpen] = useState(false)
  const [alertsPanelSize, setAlertsPanelSize] = useState<{
    width: number
    height: number
  } | null>(null)
  const alertsPanelRef = useRef<HTMLElement | null>(null)
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
    if (!alertsPanelResizing) return
    function onMove(event: PointerEvent) {
      const start = alertsPanelResizeStartRef.current
      if (!start) return
      const maxWidth = Math.min(640, window.innerWidth - 32)
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

  function openIdentity() {
    setIdentityOpen(true)
  }

  function goBack() {
    if (window.history.length > 1) navigate(-1)
    else navigate("/sign-in")
  }

  function chooseSignUp() {
    setIdentityOpen(false)
    navigate("/sign-up?returnTo=/guest-report")
  }

  function chooseSignIn() {
    setIdentityOpen(false)
    navigate("/sign-in?returnTo=/guest-report")
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
              onBackRequest={goBack}
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
    </div>
  )
}
